import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { OAuth2Client } from "google-auth-library";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom, getCubeServerStats, configureHostlAccountHooks } from "./WorldRoom.js";

const port = Number(process.env.PORT) || 2567;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const REWARDED_AD_SECRET = String(process.env.HOSTL_REWARDED_AD_SECRET || "").trim();
const REWARDED_ADS_CONFIGURED = REWARDED_AD_SECRET.length >= 32;
const HOSTL_DAILY_AD_CUBITS = 100;
const HOSTL_CUBIT_REVIVE_COST = 100;
const reviveAuthorizations = new Map();
// Account records are server-authoritative. For true persistence across Render deploys/restarts,
// HOSTL_DATA_DIR should point at a mounted persistent disk (recommended: /var/data/hostl).
// Without a persistent mount, the fallback project data folder can be replaced by the host.
const DATA_DIR = String(process.env.HOSTL_DATA_DIR || path.join(__dirname, "data")).trim();
const ACCOUNT_FILE = path.join(DATA_DIR, "accounts.json");
const ACCOUNT_BACKUP_FILE = path.join(DATA_DIR, "accounts.backup.json");
const SESSION_SECRET = String(process.env.HOSTL_SESSION_SECRET || crypto.randomBytes(32).toString("hex"));
// Keep recovery signatures independent from normal login-session rotation. Existing
// builds signed recovery snapshots with HOSTL_SESSION_SECRET, so verification below
// accepts both secrets for backward compatibility.
const RECOVERY_SECRET = String(process.env.HOSTL_RECOVERY_SECRET || process.env.HOSTL_SESSION_SECRET || SESSION_SECRET);
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

if (!process.env.HOSTL_SESSION_SECRET) {
  console.warn("HOSTL_SESSION_SECRET is not set. Login sessions will reset whenever the server restarts.");
}
if (!process.env.HOSTL_RECOVERY_SECRET && !process.env.HOSTL_SESSION_SECRET) {
  console.warn("HOSTL recovery signing has no stable secret. Browser recovery snapshots will become invalid after a server restart. Set HOSTL_RECOVERY_SECRET (recommended) or HOSTL_SESSION_SECRET.");
}
if (!GOOGLE_CLIENT_ID) {
  console.warn("GOOGLE_CLIENT_ID is not set. Google Sign-In will remain disabled.");
}
if (!REWARDED_ADS_CONFIGURED) {
  console.warn("HOSTL_REWARDED_AD_SECRET is not set (or is too short). Rewarded-ad grants are disabled until a server-verified ad provider is connected.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const ACCOUNT_STORAGE_PERSISTENT = !!process.env.HOSTL_DATA_DIR;
if (!ACCOUNT_STORAGE_PERSISTENT) {
  console.warn("HOSTL account storage is using the local filesystem fallback. Set HOSTL_DATA_DIR to a mounted persistent disk path for deploy-safe permanent accounts.");
}
function emptyAccountDb() {
  return { byId: {}, byGoogleSub: {}, globalCodeClaims: {}, friendChats: {}, tradeOffers: {} };
}
function normalizeAccountDbShape(parsed) {
  return {
    byId: parsed?.byId && typeof parsed.byId === "object" && !Array.isArray(parsed.byId) ? parsed.byId : {},
    byGoogleSub: parsed?.byGoogleSub && typeof parsed.byGoogleSub === "object" && !Array.isArray(parsed.byGoogleSub) ? parsed.byGoogleSub : {},
    globalCodeClaims: parsed?.globalCodeClaims && typeof parsed.globalCodeClaims === "object" && !Array.isArray(parsed.globalCodeClaims) ? parsed.globalCodeClaims : {},
    friendChats: parsed?.friendChats && typeof parsed.friendChats === "object" && !Array.isArray(parsed.friendChats) ? parsed.friendChats : {},
    tradeOffers: parsed?.tradeOffers && typeof parsed.tradeOffers === "object" && !Array.isArray(parsed.tradeOffers) ? parsed.tradeOffers : {}
  };
}
function readAccountFile(file) {
  const raw=fs.readFileSync(file,"utf8");
  const parsed=JSON.parse(raw);
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("account database root is not an object");
  return normalizeAccountDbShape(parsed);
}
function quarantineBrokenAccountFile(file,label="broken") {
  try {
    if(!fs.existsSync(file)) return "";
    const target=path.join(DATA_DIR,`accounts.${label}.${Date.now()}.json`);
    fs.copyFileSync(file,target);
    try{fs.unlinkSync(file);}catch(_){}
    console.error(`Preserved unreadable HOSTL account data at ${target}`);
    return target;
  } catch(err) {
    console.error("Could not preserve unreadable HOSTL account data:",err);
    return "";
  }
}
let ACCOUNT_LOAD_SOURCE = "empty";
let ACCOUNT_LOAD_HAD_ERROR = false;
function loadAccounts() {
  if (fs.existsSync(ACCOUNT_FILE)) {
    try {
      const db=readAccountFile(ACCOUNT_FILE);
      ACCOUNT_LOAD_SOURCE="primary";
      return db;
    } catch (err) {
      ACCOUNT_LOAD_HAD_ERROR=true;
      console.error("Failed to load HOSTL accounts.json:", err);
      quarantineBrokenAccountFile(ACCOUNT_FILE,"corrupt");
    }
  }
  if (fs.existsSync(ACCOUNT_BACKUP_FILE)) {
    try {
      const db=readAccountFile(ACCOUNT_BACKUP_FILE);
      ACCOUNT_LOAD_SOURCE="backup";
      console.warn("HOSTL restored account database from accounts.backup.json.");
      return db;
    } catch (err) {
      ACCOUNT_LOAD_HAD_ERROR=true;
      console.error("Failed to load HOSTL account backup:",err);
      quarantineBrokenAccountFile(ACCOUNT_BACKUP_FILE,"backup-corrupt");
    }
  }
  ACCOUNT_LOAD_SOURCE="empty";
  return emptyAccountDb();
}
let accountDb = loadAccounts();
let saveChain = Promise.resolve();
function saveAccounts() {
  saveChain = saveChain.then(async () => {
    const temp = `${ACCOUNT_FILE}.tmp`;
    const backupTemp = `${ACCOUNT_BACKUP_FILE}.tmp`;
    const json=JSON.stringify(accountDb);
    await fs.promises.writeFile(temp, json, "utf8");
    // Keep one known-previous full database before replacing the primary. This
    // protects against partial/corrupt writes while still using an atomic rename.
    if (fs.existsSync(ACCOUNT_FILE)) {
      try {
        await fs.promises.copyFile(ACCOUNT_FILE, backupTemp);
        await fs.promises.rename(backupTemp, ACCOUNT_BACKUP_FILE);
      } catch(err) {
        try{await fs.promises.unlink(backupTemp);}catch(_){}
        console.error("Failed to rotate HOSTL account backup:",err);
      }
    }
    await fs.promises.rename(temp, ACCOUNT_FILE);
    // Seed a backup on the first successful save or after restoring from a wiped path.
    if (!fs.existsSync(ACCOUNT_BACKUP_FILE)) {
      try { await fs.promises.copyFile(ACCOUNT_FILE, ACCOUNT_BACKUP_FILE); } catch(err) { console.error("Failed to seed HOSTL account backup:",err); }
    }
  }).catch(err => console.error("Failed to save HOSTL accounts:", err));
  return saveChain;
}
function safeText(value, max = 80) {
  return String(value ?? "").trim().slice(0, max);
}
function cleanDisplayName(value) {
  const raw = safeText(value, 20).replace(/\s+/g, " ");
  const cleaned = raw.replace(/[^A-Za-z0-9 _\-.'!]/g, "").trim();
  return cleaned.slice(0, 20);
}
// HOSTL has exactly one account currency: Gold Cubits.
// Older builds stored this balance under `cubits`; migrate it once and keep only
// `goldCubits` as the canonical saved-account field going forward.
function ensureGoldCubits(a) {
  if (!a || typeof a !== "object") return 0;
  if (!Number.isFinite(Number(a.goldCubits))) a.goldCubits = Number.isFinite(Number(a.cubits)) ? Number(a.cubits) : 0;
  a.goldCubits = Math.max(0, Math.min(1000000000, Math.floor(Number(a.goldCubits) || 0)));
  if (Object.prototype.hasOwnProperty.call(a, "cubits")) delete a.cubits;
  return a.goldCubits;
}
function setGoldCubits(a, value) { a.goldCubits = Math.max(0, Math.min(1000000000, Math.floor(Number(value) || 0))); return a.goldCubits; }
function addGoldCubits(a, delta) { return setGoldCubits(a, ensureGoldCubits(a) + Math.floor(Number(delta) || 0)); }
function allocateNumericUserId(used = new Set(Object.keys(accountDb?.byId || {}))) {
  for (let tries = 0; tries < 5000; tries++) {
    const candidate = String(1 + Math.floor(Math.random() * 99999));
    if (!used.has(candidate)) return candidate;
  }
  for (let i = 1; i <= 99999; i++) {
    const candidate = String(i);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("HOSTL player ID space is full");
}
function ensureTitleState(a) {
  if (!Array.isArray(a.unlockedTitles)) a.unlockedTitles = [];
  a.unlockedTitles = [...new Set(a.unlockedTitles.map(x => safeText(x, 32)).filter(Boolean))].slice(0, 100);
  // Migrate special staff titles to their final public names.
  if (Math.max(0, Math.floor(Number(a.testerRank)||0)) === 1) {
    a.unlockedTitles = a.unlockedTitles.filter(t => t !== "Tester");
    if (!a.unlockedTitles.includes("#1 Tester")) a.unlockedTitles.push("#1 Tester");
    if (safeText(a.title,32) === "Tester" || !safeText(a.title,32)) a.title = "#1 Tester";
  }
  if (Math.max(0, Math.floor(Number(a.ownerRank)||0)) === 1) {
    if (!a.unlockedTitles.includes("Owner")) a.unlockedTitles.push("Owner");
    if (!safeText(a.title,32)) a.title = "Owner";
  }
  const current = safeText(a.title, 32);
  if (current && !a.unlockedTitles.includes(current)) a.unlockedTitles.push(current);
  if (current && !a.unlockedTitles.includes(current)) a.title = "";
  return a;
}

const STARTER_PET_STAGE_RANK = { baby:0, adult:1, boss:2, superboss:3, bigmomma:4 };
const ACCOUNT_PET_TYPE_ALIASES = Object.freeze({ viper:"snake" });
function canonicalAccountPetType(type){
  const raw=safeText(type,24).toLowerCase();
  return ACCOUNT_PET_TYPE_ALIASES[raw] || raw;
}
function ensureStarterPetEntitlements(a) {
  if (!a || typeof a !== "object") return [];
  if (!a.ownedStarters || typeof a.ownedStarters !== "object" || Array.isArray(a.ownedStarters)) a.ownedStarters = {};
  const raw = Array.isArray(a.starterPetEntitlements) ? [...a.starterPetEntitlements] : [];
  if (a.starterPetEntitlement && typeof a.starterPetEntitlement === "object") raw.push(a.starterPetEntitlement);
  const byType = new Map();
  for (const ent of raw) {
    if (!ent || typeof ent !== "object") continue;
    const type = canonicalAccountPetType(ent.type);
    const stage = safeText(ent.stage,24).toLowerCase();
    if (!type) continue;
    const cleanStage = Object.prototype.hasOwnProperty.call(STARTER_PET_STAGE_RANK,stage) ? stage : "baby";
    const old = byType.get(type);
    if (!old || STARTER_PET_STAGE_RANK[cleanStage] > STARTER_PET_STAGE_RANK[old.stage]) byType.set(type,{type,stage:cleanStage});
  }
  a.starterPetEntitlements = [...byType.values()];
  // A code-granted starter pet is normal permanent starter ownership too. Keeping
  // this canonical flag means every client/menu sees it immediately through the
  // same path as pets unlocked with cards or Gold Cubits.
  for (const ent of a.starterPetEntitlements) if (ent?.type) a.ownedStarters[`start_${ent.type}`] = true;
  // Legacy field is kept so older clients still receive at least one entitlement.
  a.starterPetEntitlement = a.starterPetEntitlements[0] || null;
  return a.starterPetEntitlements;
}
function grantStarterPetEntitlement(a,type,stage="baby") {
  const t=canonicalAccountPetType(type);
  const st=safeText(stage,24).toLowerCase();
  if(!t)return false;
  const cleanStage=Object.prototype.hasOwnProperty.call(STARTER_PET_STAGE_RANK,st)?st:"baby";
  // A promo/code pet is not a separate pet record. Merge ownership into the same
  // canonical species progression used by normal card unlocks so old cards, stage
  // upgrades and stat upgrades remain intact forever.
  ensurePetProgressState(a);
  ensureStarterPetEntitlements(a);
  const before=JSON.stringify({
    owned:!!a.ownedStarters?.[`start_${t}`],
    stage:a.petStages?.[t]||"baby",
    upgrades:a.petStatUpgrades?.[t]||{},
    cards:a.speciesCards?.[t]||0,
    ents:a.starterPetEntitlements,
    legacy:a.starterPetEntitlement
  });
  if (!a.ownedStarters || typeof a.ownedStarters !== "object" || Array.isArray(a.ownedStarters)) a.ownedStarters={};
  if (!a.petStages || typeof a.petStages !== "object" || Array.isArray(a.petStages)) a.petStages={};
  if (!a.petStatUpgrades || typeof a.petStatUpgrades !== "object" || Array.isArray(a.petStatUpgrades)) a.petStatUpgrades={};
  if (!a.speciesCards || typeof a.speciesCards !== "object" || Array.isArray(a.speciesCards)) a.speciesCards={};
  a.ownedStarters[`start_${t}`]=true;
  if(!a.petStatUpgrades[t] || typeof a.petStatUpgrades[t]!=="object" || Array.isArray(a.petStatUpgrades[t]))a.petStatUpgrades[t]={};
  for(const stat of ["health","defense","attack","weight","regen","speed"]){
    a.petStatUpgrades[t][stat]=Math.max(0,Math.min(10,Math.floor(Number(a.petStatUpgrades[t][stat])||0)));
  }
  a.speciesCards[t]=Math.max(0,Math.floor(Number(a.speciesCards[t])||0));
  const currentStage=Object.prototype.hasOwnProperty.call(STARTER_PET_STAGE_RANK,a.petStages[t])?a.petStages[t]:"baby";
  if(STARTER_PET_STAGE_RANK[cleanStage]>STARTER_PET_STAGE_RANK[currentStage])a.petStages[t]=cleanStage;
  else a.petStages[t]=currentStage;
  const found=a.starterPetEntitlements.find(x=>x.type===t);
  if(found){ if(STARTER_PET_STAGE_RANK[cleanStage]>STARTER_PET_STAGE_RANK[found.stage]) found.stage=cleanStage; }
  else a.starterPetEntitlements.push({type:t,stage:cleanStage});
  // Prefer the newly granted entitlement in the legacy field for older clients.
  a.starterPetEntitlement={type:t,stage:(a.starterPetEntitlements.find(x=>x.type===t)||{}).stage||cleanStage};
  ensurePetProgressState(a);
  const after=JSON.stringify({
    owned:!!a.ownedStarters?.[`start_${t}`],
    stage:a.petStages?.[t]||"baby",
    upgrades:a.petStatUpgrades?.[t]||{},
    cards:a.speciesCards?.[t]||0,
    ents:a.starterPetEntitlements,
    legacy:a.starterPetEntitlement
  });
  return before!==after;
}
function grantStarterPetUnlockNormal(a,type,minStage="baby") {
  if(!a || typeof a!=="object") return false;
  const t=canonicalAccountPetType(type);
  if(!t || !ACCOUNT_PET_TYPES.has(t)) return false;
  const rawStage=safeText(minStage,24).toLowerCase();
  const cleanStage=Object.prototype.hasOwnProperty.call(STARTER_PET_STAGE_RANK,rawStage)?rawStage:"baby";
  ensurePetProgressState(a);
  if(!a.ownedStarters || typeof a.ownedStarters!=="object" || Array.isArray(a.ownedStarters))a.ownedStarters={};
  if(!a.petStages || typeof a.petStages!=="object" || Array.isArray(a.petStages))a.petStages={};
  if(!a.petStatUpgrades || typeof a.petStatUpgrades!=="object" || Array.isArray(a.petStatUpgrades))a.petStatUpgrades={};
  if(!a.speciesCards || typeof a.speciesCards!=="object" || Array.isArray(a.speciesCards))a.speciesCards={};
  const before=JSON.stringify({owned:!!a.ownedStarters[`start_${t}`],stage:a.petStages[t]||"baby",cards:a.speciesCards[t]||0,upgrades:a.petStatUpgrades[t]||{}});
  a.ownedStarters[`start_${t}`]=true;
  const current=Object.prototype.hasOwnProperty.call(STARTER_PET_STAGE_RANK,a.petStages[t])?a.petStages[t]:"baby";
  if(STARTER_PET_STAGE_RANK[cleanStage]>STARTER_PET_STAGE_RANK[current])a.petStages[t]=cleanStage;
  else a.petStages[t]=current;
  // Code unlocks never replace progression. Cards and stat upgrades remain exactly
  // where the normal pet systems saved them; the code only unlocks ownership and
  // can raise a pet to its promised minimum starting stage.
  a.speciesCards[t]=Math.max(0,Math.floor(Number(a.speciesCards[t])||0));
  if(!a.petStatUpgrades[t] || typeof a.petStatUpgrades[t]!=="object" || Array.isArray(a.petStatUpgrades[t]))a.petStatUpgrades[t]={};
  for(const stat of ["health","defense","attack","weight","regen","speed"]){
    a.petStatUpgrades[t][stat]=Math.max(0,Math.min(10,Math.floor(Number(a.petStatUpgrades[t][stat])||0)));
  }
  const after=JSON.stringify({owned:!!a.ownedStarters[`start_${t}`],stage:a.petStages[t]||"baby",cards:a.speciesCards[t]||0,upgrades:a.petStatUpgrades[t]||{}});
  return before!==after;
}
function repairSpecialPromoEntitlements(a) {
  if(!a || typeof a!=="object") return false;
  let changed=false;
  if(!a.specialRewardRepairs || typeof a.specialRewardRepairs!=="object" || Array.isArray(a.specialRewardRepairs)) a.specialRewardRepairs={};
  if(!a.speciesCards || typeof a.speciesCards!=="object" || Array.isArray(a.speciesCards)) a.speciesCards={};
  const codes=Array.isArray(a.redeemedCodes)?a.redeemedCodes.map(x=>String(x).toUpperCase()):[];
  const hasTester=codes.includes("SCCTT") || codes.includes("SCCTT2") || Math.max(0,Math.floor(Number(a.testerRank)||0))===1;
  if(hasTester){
    if(Math.max(0,Math.floor(Number(a.testerRank)||0))!==1){a.testerRank=1;changed=true;}
    ensureTitleState(a);
    if(!a.unlockedTitles.includes("#1 Tester")){a.unlockedTitles.push("#1 Tester");changed=true;}
    if(grantStarterPetUnlockNormal(a,"saber","adult"))changed=true;
    if(!a.specialRewardRepairs.sccttSaberCardsV1){
      const old=Math.max(0,Math.floor(Number(a.speciesCards.saber)||0));
      if(old<500){a.speciesCards.saber=500;changed=true;}
      a.specialRewardRepairs.sccttSaberCardsV1=Date.now(); changed=true;
    }
  }
  const hasOwnerCode=codes.includes("OVCC") || codes.includes("OVCC2");
  const hasOwner=hasOwnerCode || Math.max(0,Math.floor(Number(a.ownerRank)||0))===1;
  if(hasOwner){
    if(Math.max(0,Math.floor(Number(a.ownerRank)||0))!==1){a.ownerRank=1;changed=true;}
    ensureTitleState(a);
    if(!a.unlockedTitles.includes("Owner")){a.unlockedTitles.push("Owner");changed=true;}
    if(grantStarterPetUnlockNormal(a,"snake","adult"))changed=true;
    // OVCC was accidentally shipped without its Gold Cubits/cards in the reward
    // definition. Repair old claims once, without making the repair repeatable.
    if(hasOwnerCode && !a.specialRewardRepairs.ovccGoldCubits10000V1){
      ensureGoldCubits(a);
      addGoldCubits(a,10000);
      a.specialRewardRepairs.ovccGoldCubits10000V1=Date.now(); changed=true;
    }
    if(hasOwnerCode && !a.specialRewardRepairs.ovccViperCards500V1){
      const old=Math.max(0,Math.floor(Number(a.speciesCards.snake)||0));
      if(old<500){a.speciesCards.snake=500;changed=true;}
      a.specialRewardRepairs.ovccViperCards500V1=Date.now(); changed=true;
    }
    if(!a.specialRewardRepairs.ovccViperNormalUnlockV4){
      a.specialRewardRepairs.ovccViperNormalUnlockV4=Date.now(); changed=true;
    }
  }
  const hasSTC=codes.includes("STC");
  if(hasSTC){
    if(grantStarterPetUnlockNormal(a,"saber","adult"))changed=true;
    if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
    if(!a.unlockedThemes.includes("celestialCrown")){a.unlockedThemes.push("celestialCrown");changed=true;}
    if(!a.specialRewardRepairs.stcSaberCardsV2){
      const old=Math.max(0,Math.floor(Number(a.speciesCards.saber)||0));
      if(old<500){a.speciesCards.saber=500;changed=true;}
      a.specialRewardRepairs.stcSaberCardsV2=Date.now(); changed=true;
    }
  }
  ensureStarterPetEntitlements(a);
  ensurePetProgressState(a);
  return changed;
}


const MATERIAL_CATALOG = {
  // Prices are balanced against normal high-skill play (~100–150 Gold Cubits/minute once waves are active).
  // Drops/chests are intentionally the efficient route; buying is the guaranteed route.
  leather:{name:"Leather",price:150,rarity:"Common"},
  resin:{name:"Hard Resin",price:180,rarity:"Common"},
  wildHerb:{name:"Wild Herb",price:210,rarity:"Common"},
  iceCrystal:{name:"Ice Crystal",price:520,rarity:"Rare"},
  swiftFiber:{name:"Swift Fiber",price:300,rarity:"Uncommon"},
  ironBuckle:{name:"Iron Buckle",price:400,rarity:"Uncommon"},
  ironPlate:{name:"Iron Plate",price:650,rarity:"Rare"},
  animalNotes:{name:"Animal Field Notes",price:550,rarity:"Rare"},
  toolKit:{name:"Fine Tool Kit",price:1100,rarity:"Epic"},
  beastBook:{name:"Beast Language Book",price:1300,rarity:"Epic"},
  predatorStudy:{name:"Predator Study Kit",price:1200,rarity:"Epic"},
  sharpFang:{name:"Sharpened Fang",price:2500,rarity:"Legendary"},
  apexScale:{name:"Apex Scale",price:6500,rarity:"Mythical"}
};
const BUILD_RECIPES = {
  speedyBoots:{chance:.85,ingredients:{leather:4,swiftFiber:4,ironBuckle:2}},
  ironShell:{chance:.60,ingredients:{ironPlate:8,resin:5,leather:3}},
  herbalWrap:{chance:.82,ingredients:{wildHerb:8,resin:2,leather:2}},
  frostShell:{chance:.72,ingredients:{iceCrystal:7,ironPlate:3,resin:2}},
  hunterWrap:{chance:.75,ingredients:{leather:5,sharpFang:3,swiftFiber:3}},
  gatherGloves:{chance:.82,ingredients:{leather:4,swiftFiber:4,toolKit:1}},
  saddle:{chance:.92,ingredients:{leather:5,swiftFiber:2,ironBuckle:1}}
};
const LEARN_RECIPES = { animalWhisperer:{ingredients:{beastBook:1,animalNotes:5,predatorStudy:2,sharpFang:1}} };
const ANIMAL_RARITY={dog:"Common",cat:"Common",rabbit:"Common",wolf:"Uncommon",bear:"Uncommon",fox:"Uncommon",boar:"Rare",deer:"Rare",owl:"Rare",snake:"Legendary",saber:"Legendary",dragon:"Starter"};
const CHEST_SPECIES=["dog","cat","dragon","fox","wolf","bear","rabbit","owl","snake","deer","boar","saber"];
const CHEST_SPECIES_RARITY_WEIGHT={Common:2.4,Uncommon:1.5,Rare:.82,Legendary:.28,Starter:.55};
function chestSpeciesRarity(type){return ANIMAL_RARITY[type]||"Common";}
function randomChestSpecies(){
  const rows=CHEST_SPECIES.map(v=>({v,w:CHEST_SPECIES_RARITY_WEIGHT[chestSpeciesRarity(v)]||1}));
  let total=rows.reduce((n,x)=>n+x.w,0),roll=Math.random()*total;
  for(const row of rows){roll-=row.w;if(roll<=0)return row.v;}
  return rows[0]?.v||"dog";
}
const CHEST_THEMES=["fireElement","waterElement","lightningElement","powerElement","windElement","plantElement","stoneElement","earthElement","soundElement","arcticPulse","chromeWave","nightDrive","toxicReactor","solarPunk","viperwave","hologram","hyperwave","cyberCircuit","hacker","blackNeon","blackNight","thunderStorm","glitch","slime","auroraVale","prismTech","oceanAbyss","auroraBorealis","computerVirus","dragonForge","celestialCrown","titanStorm","goldenEclipse","saberFang","voidObsidian","bloodMoon","emberKingdom","crystalCavern","ancientRuins","explosion","castorianopsia"];
// Theme unlock assignment v1 (frozen).
// This list was randomized ONCE during development and is now hard-coded.
// Nothing here rolls, reshuffles, or changes a theme's unlock method at runtime.
// Classics stay free forever; every non-classic theme has exactly one fixed method.
const THEME_GUEST_FREE=new Set(["forestGold","blueEmber","sunsetJungle","royalStone","mossCream","lavaNight","mintTech","oceanCoral","frostPine","desertDusk","crimsonSteel","neonArcade"]);
const THEME_ACCOUNT_FREE=new Set(["stoneElement","strawberryMilk","honeyBee","candyComet","pumpkinMoon","arcticPulse","viperwave","hologram","hacker","blackNeon","thunderStorm","auroraVale","oceanAbyss","dragonForge","celestialCrown","goldenEclipse","crystalCavern","rainyWindow","owlNight","beardedDunes","moonPetal","kemonoCamp"]);
const THEME_AD=new Set(["waterElement","lightningElement","powerElement","windElement","soundElement","rabbitMeadow","cottonCandy","roseQuartz","nightDrive","hyperwave","blackNight","glitch","prismTech","auroraBorealis","emberKingdom","ancientRuins","explosion","castorianopsia","deerGrove","autumnHearth","goldenPrairie"]);
const THEME_GOLD=new Set(["fireElement","plantElement","earthElement","peachBunny","bubblegumSky","cozyPlush","blossomCandy","chromeWave","toxicReactor","solarPunk","cyberCircuit","slime","computerVirus","titanStorm","saberFang","voidObsidian","bloodMoon","sakuraBreeze","lavenderDream","quietMeadow","midnightGarden"]);
const THEME_ELEMENT=new Set(["fireElement","waterElement","lightningElement","powerElement","windElement","plantElement","stoneElement","earthElement","soundElement"]);
const THEME_EPIC=new Set(["dragonForge","celestialCrown","titanStorm","goldenEclipse","saberFang","voidObsidian","bloodMoon","emberKingdom","crystalCavern","ancientRuins","explosion","castorianopsia"]);
const THEME_COOL=new Set(["arcticPulse","chromeWave","nightDrive","toxicReactor","solarPunk","viperwave","hologram","hyperwave","cyberCircuit","hacker","blackNeon","blackNight","thunderStorm","glitch","slime","auroraVale","prismTech","oceanAbyss","auroraBorealis","computerVirus"]);
const THEME_CUTE=new Set(["strawberryMilk","peachBunny","bubblegumSky","honeyBee","cozyPlush","rabbitMeadow","blossomCandy","cottonCandy","candyComet","roseQuartz","pumpkinMoon"]);
const THEME_RELAX=new Set(["sakuraBreeze","lavenderDream","rainyWindow","quietMeadow","deerGrove","owlNight","beardedDunes","moonPetal","kemonoCamp","autumnHearth","midnightGarden","goldenPrairie"]);
function themeGoldPrice(id){
  if(THEME_ELEMENT.has(id))return 1800;
  if(THEME_EPIC.has(id))return ["bloodMoon","voidObsidian","goldenEclipse"].includes(id)?7000:5000;
  if(THEME_COOL.has(id))return ["glitch","hologram","hacker","computerVirus"].includes(id)?4200:3000;
  if(THEME_CUTE.has(id))return 2200;
  if(THEME_RELAX.has(id))return 2400;
  return 3000;
}
function isKnownTheme(id){return THEME_GUEST_FREE.has(id)||THEME_ACCOUNT_FREE.has(id)||THEME_AD.has(id)||THEME_GOLD.has(id);}
function accountCanUseTheme(a,id){return isKnownTheme(id) && (THEME_GUEST_FREE.has(id)||THEME_ACCOUNT_FREE.has(id)||(Array.isArray(a?.unlockedThemes)&&a.unlockedThemes.includes(id)));}

const ACCOUNT_PET_TYPES=new Set(["dog","cat","dragon","rabbit","fox","owl","deer","wolf","snake","boar","bear","saber"]);
const ACCOUNT_FREE_STARTER_PETS=new Set(["dog","cat","dragon"]);
const ACCOUNT_PET_UNLOCK={
  dog:{cards:0,cubits:0},cat:{cards:0,cubits:0},dragon:{cards:0,cubits:0},
  rabbit:{cards:55,cubits:600},fox:{cards:55,cubits:650},owl:{cards:60,cubits:750},deer:{cards:70,cubits:900},
  wolf:{cards:80,cubits:1100},snake:{cards:85,cubits:1200},boar:{cards:95,cubits:1400},bear:{cards:110,cubits:1800},saber:{cards:120,cubits:2200}
};
const ACCOUNT_PET_STAGE_ORDER=["baby","adult","boss","superboss"];
const ACCOUNT_PET_STAGE_COST={adult:20,boss:50,superboss:100};
const ACCOUNT_PET_STATS=new Set(["health","defense","attack","weight","regen","speed"]);
const ACCOUNT_PET_STAT_MAX=10;
const STARTER_SHOP_ITEMS={
  wood50:750,wood100:1800,stone20:700,stone50:1700,gold5:1200,gold15:3200,berries10:950,
  startAxe:2200,startPickaxe:2500,startSword:4200,startBow:5200,speedyBoots:6500,ironShell:12000,
  hunterWrap:8000,gatherGloves:6000,animalWhisperer:9500,saddle:1800
};
function accountOwnsPetStarter(a,type){
  type=canonicalAccountPetType(type); if(!ACCOUNT_PET_TYPES.has(type))return false;
  ensurePetProgressState(a); ensureStarterPetEntitlements(a);
  return ACCOUNT_FREE_STARTER_PETS.has(type) || !!a.ownedStarters?.[`start_${type}`] || a.starterPetEntitlements.some(x=>x?.type===type);
}
function accountStarterStage(a,type){
  type=canonicalAccountPetType(type); ensurePetProgressState(a); ensureStarterPetEntitlements(a);
  let stage=ACCOUNT_PET_STAGE_ORDER.includes(a.petStages?.[type])?a.petStages[type]:"baby";
  for(const ent of a.starterPetEntitlements||[]){
    if(ent?.type!==type)continue; const st=ACCOUNT_PET_STAGE_ORDER.includes(ent.stage)?ent.stage:(ent.stage==="bigmomma"?"superboss":"baby");
    if(ACCOUNT_PET_STAGE_ORDER.indexOf(st)>ACCOUNT_PET_STAGE_ORDER.indexOf(stage))stage=st;
  }
  return stage;
}
function cleanAccountStarterSelection(a,type,name,gender){
  ensurePetProgressState(a); type=canonicalAccountPetType(type);
  if(type && !accountOwnsPetStarter(a,type)) return false;
  a.starterPetType=type;
  a.starterPetName=type?safeText(name,20):"";
  a.starterPetGender=gender==="Female"?"Female":"Male";
  return true;
}
function timingSafeStringEqual(a,b){
  const aa=Buffer.from(String(a||"")),bb=Buffer.from(String(b||""));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function verifyRewardedAdProof(account,rawProof,expectedKind,expectedSubject){
  if(!REWARDED_ADS_CONFIGURED)return {ok:false,status:503,error:"rewarded_ads_not_configured"};
  try{
    const [body,sig]=String(rawProof||"").split("."); if(!body||!sig)return {ok:false,status:403,error:"missing_ad_proof"};
    const expected=crypto.createHmac("sha256",REWARDED_AD_SECRET).update(body).digest("base64url");
    if(!timingSafeStringEqual(sig,expected))return {ok:false,status:403,error:"invalid_ad_proof"};
    const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
    const now=Date.now(),uid=String(account?.userId||"");
    if(String(payload?.uid||"")!==uid || String(payload?.kind||"")!==String(expectedKind||"") || String(payload?.subject||"")!==String(expectedSubject||""))return {ok:false,status:403,error:"ad_proof_mismatch"};
    const iat=Number(payload?.iat||0),exp=Number(payload?.exp||0),jti=safeText(payload?.jti,120);
    if(!jti || exp<now || exp<iat || exp>iat+30*60*1000 || iat>now+60000 || iat<now-30*60*1000)return {ok:false,status:403,error:"expired_ad_proof"};
    payload.jti=jti;
    if(!account.rewardedAdClaims || typeof account.rewardedAdClaims!=="object" || Array.isArray(account.rewardedAdClaims))account.rewardedAdClaims={};
    if(account.rewardedAdClaims[String(payload.jti)])return {ok:false,status:409,error:"ad_proof_already_used"};
    return {ok:true,jti:String(payload.jti)};
  }catch(_){return {ok:false,status:403,error:"invalid_ad_proof"};}
}
function consumeRewardedAdProof(account,check){
  if(!check?.ok)return; if(!account.rewardedAdClaims || typeof account.rewardedAdClaims!=="object")account.rewardedAdClaims={};
  account.rewardedAdClaims[check.jti]=Date.now();
  const entries=Object.entries(account.rewardedAdClaims).sort((a,b)=>Number(b[1]||0)-Number(a[1]||0)).slice(0,200);
  account.rewardedAdClaims=Object.fromEntries(entries);
}

function ensureEconomyState(a){
  if(!a.materials||typeof a.materials!=="object"||Array.isArray(a.materials))a.materials={};
  for(const id of Object.keys(MATERIAL_CATALOG))a.materials[id]=Math.max(0,Math.min(100000,Math.floor(Number(a.materials[id])||0)));
  if(!Array.isArray(a.craftedStarters))a.craftedStarters=[]; a.craftedStarters=[...new Set(a.craftedStarters.map(x=>safeText(x,32)).filter(x=>BUILD_RECIPES[x]))];
  if(!Array.isArray(a.learnedSkills))a.learnedSkills=[]; a.learnedSkills=[...new Set(a.learnedSkills.map(x=>safeText(x,32)).filter(x=>LEARN_RECIPES[x]))];
  return a;
}
function ensurePetProgressState(a){
  if(!a || typeof a!=="object") return a;
  const validStages=new Set(["baby","adult","boss","superboss"]);
  const cleanStage=(value)=>{const st=safeText(value,20).toLowerCase();return st==="bigmomma"?"superboss":(validStages.has(st)?st:"baby");};
  const stageRank={baby:0,adult:1,boss:2,superboss:3};

  // Canonicalize legacy species names. Viper's internal key is `snake`; older
  // builds could leave progression under `viper`, which made the menu show one
  // stage while the actual starter spawned from a different key.
  const sourceCards=(a.speciesCards&&typeof a.speciesCards==="object"&&!Array.isArray(a.speciesCards))?a.speciesCards:{};
  const cards={};
  for(const [k,v] of Object.entries(sourceCards)){
    const type=canonicalAccountPetType(k); if(!type)continue;
    const amount=Math.max(0,Math.min(1000000,Math.floor(Number(v)||0)));
    cards[type]=Math.max(cards[type]||0,amount);
  }
  a.speciesCards=cards;

  const sourceOwned=(a.ownedStarters&&typeof a.ownedStarters==="object"&&!Array.isArray(a.ownedStarters))?a.ownedStarters:{};
  const owned={};
  for(const [k,v] of Object.entries(sourceOwned)){
    let key=safeText(k,40);
    if(key.startsWith("start_"))key=`start_${canonicalAccountPetType(key.slice(6))}`;
    if(key)owned[key]=!!v || !!owned[key];
  }
  a.ownedStarters=owned;

  const sourceStages=(a.petStages&&typeof a.petStages==="object"&&!Array.isArray(a.petStages))?a.petStages:{};
  const stages={};
  for(const [k,v] of Object.entries(sourceStages)){
    const type=canonicalAccountPetType(k); if(!type)continue;
    const st=cleanStage(v),old=stages[type]||"baby";
    if(!(type in stages)||stageRank[st]>stageRank[old])stages[type]=st;
  }
  a.petStages=stages;

  const sourceUpgrades=(a.petStatUpgrades&&typeof a.petStatUpgrades==="object"&&!Array.isArray(a.petStatUpgrades))?a.petStatUpgrades:{};
  const upgrades={};
  for(const [species,stats0] of Object.entries(sourceUpgrades)){
    const type=canonicalAccountPetType(species); if(!type)continue;
    const stats=(stats0&&typeof stats0==="object"&&!Array.isArray(stats0))?stats0:{};
    const clean=upgrades[type]||{};
    for(const stat of ["health","defense","attack","weight","regen","speed"]){
      const level=Math.max(0,Math.min(10,Math.floor(Number(stats[stat])||0)));
      clean[stat]=Math.max(clean[stat]||0,level);
    }
    upgrades[type]=clean;
  }
  a.petStatUpgrades=upgrades;

  a.starterPetType=canonicalAccountPetType(a.starterPetType||"");
  a.starterPetName=safeText(a.starterPetName||"",20);
  a.starterPetGender=a.starterPetGender==="Female"?"Female":"Male";
  ensureStarterPetEntitlements(a);
  return a;
}
function hasIngredients(a,ingredients){ensureEconomyState(a);return Object.entries(ingredients||{}).every(([id,n])=>(a.materials[id]||0)>=n);}
function consumeIngredients(a,ingredients){ensureEconomyState(a);for(const [id,n] of Object.entries(ingredients||{}))a.materials[id]=Math.max(0,(a.materials[id]||0)-n);}
function addMaterial(a,id,n){ensureEconomyState(a);if(MATERIAL_CATALOG[id])a.materials[id]=Math.min(100000,(a.materials[id]||0)+Math.max(0,Math.floor(Number(n)||0)));}
const MATERIAL_RARITY_WEIGHT={Common:48,Uncommon:28,Rare:14,Epic:7,Legendary:2.5,Mythical:.5};
function randomMaterialId(multiplier=1){
  const entries=Object.entries(MATERIAL_CATALOG).map(([id,m])=>[id,Math.max(.05,(MATERIAL_RARITY_WEIGHT[m.rarity]||1)*multiplier)]);
  let total=entries.reduce((a,[,w])=>a+w,0),roll=Math.random()*total;
  for(const [id,w] of entries){roll-=w;if(roll<=0)return id;}
  return entries[0]?.[0]||"leather";
}
async function rewardGameplayMaterial(userId,id,qty,source="gameplay"){
  const a=accountDb.byId[String(userId||"")]; if(!a||!MATERIAL_CATALOG[id])return {granted:false};
  addMaterial(a,id,qty); a.updatedAt=new Date().toISOString(); await saveAccounts();
  return {granted:true,id,qty:Math.max(1,Math.floor(Number(qty)||1)),name:MATERIAL_CATALOG[id].name,rarity:MATERIAL_CATALOG[id].rarity,source,account:publicAccount(a)};
}

// The material shop is one shared deterministic stock rotation for everyone.
// A rotation lasts exactly two UTC days. Duplicate material slots are intentional.
const SHOP_ROTATION_MS = 2 * 24 * 60 * 60 * 1000;
const SHOP_SLOT_COUNT = 30;
const SHOP_STOCK_WEIGHT = { Common:34, Uncommon:26, Rare:18, Epic:12, Legendary:7, Mythical:3 };
function shopRotationInfo(now=Date.now()) {
  const rotationId = Math.floor(Number(now) / SHOP_ROTATION_MS);
  return { rotationId, startsAt: rotationId * SHOP_ROTATION_MS, nextRefreshAt: (rotationId + 1) * SHOP_ROTATION_MS };
}
function seededShopRandom(seed) {
  let t = (Number(seed) ^ 0x6D2B79F5) >>> 0;
  return function(){ t += 0x6D2B79F5; let x=t; x=Math.imul(x^(x>>>15),x|1); x^=x+Math.imul(x^(x>>>7),x|61); return ((x^(x>>>14))>>>0)/4294967296; };
}
function weightedShopMaterial(rand) {
  const entries=Object.entries(MATERIAL_CATALOG).map(([id,m])=>[id,Math.max(.1,SHOP_STOCK_WEIGHT[m.rarity]||1)]);
  let total=entries.reduce((a,[,w])=>a+w,0), roll=rand()*total;
  for(const [id,w] of entries){ roll-=w; if(roll<=0)return id; }
  return entries[0]?.[0]||"leather";
}
function generateShopStock(rotationId) {
  const rand=seededShopRandom((rotationId+1)*104729);
  const ids=[];
  // Always give the rotation useful coverage, then fill the rest by rarity weight.
  const guaranteed=["leather","resin","swiftFiber","ironBuckle","ironPlate","animalNotes","toolKit","beastBook","predatorStudy","sharpFang"];
  for(const id of guaranteed) if(MATERIAL_CATALOG[id]) ids.push(id);
  // Mythical appears in about half of rotations; it remains obtainable from gameplay/chests even when absent.
  if(MATERIAL_CATALOG.apexScale && rand()<0.5) ids.push("apexScale");
  while(ids.length<SHOP_SLOT_COUNT) ids.push(weightedShopMaterial(rand));
  // Deterministically shuffle so guaranteed items are not always at the top.
  for(let i=ids.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [ids[i],ids[j]]=[ids[j],ids[i]]; }
  return ids.map((materialId,index)=>{
    const m=MATERIAL_CATALOG[materialId];
    return { slotId:`${rotationId}:${index}`, materialId, name:m.name, rarity:m.rarity, price:m.price, index };
  });
}
function ensureShopPurchases(a) {
  if(!a.shopPurchases || typeof a.shopPurchases!=="object" || Array.isArray(a.shopPurchases)) a.shopPurchases={};
  const current=shopRotationInfo().rotationId;
  for(const key of Object.keys(a.shopPurchases)) if(Number(key)<current-1 || Number(key)>current) delete a.shopPurchases[key];
  return a.shopPurchases;
}
function purchasedShopSlots(a, rotationId) {
  const map=ensureShopPurchases(a); const key=String(rotationId);
  if(!Array.isArray(map[key])) map[key]=[];
  map[key]=[...new Set(map[key].map(x=>String(x||"")).filter(Boolean))].slice(0,SHOP_SLOT_COUNT);
  return map[key];
}

function ensureSocialState(a) {
  if (!a || typeof a !== "object") return a;
  const cleanIds = arr => [...new Set((Array.isArray(arr) ? arr : []).map(x=>String(x||"")).filter(x=>/^\d{1,5}$/.test(x)))].slice(0,200);
  a.friends = cleanIds(a.friends);
  a.incomingFriendRequests = cleanIds(a.incomingFriendRequests).filter(id=>!a.friends.includes(id));
  a.outgoingFriendRequests = cleanIds(a.outgoingFriendRequests).filter(id=>!a.friends.includes(id));
  return a;
}
const WEB_PRESENCE = new Map();
const GAME_PRESENCE = new Map();
function markWebPresence(uid){ WEB_PRESENCE.set(String(uid), Date.now()); }
function isWebOnline(uid){ const t=WEB_PRESENCE.get(String(uid))||0; if(Date.now()-t>45000){ WEB_PRESENCE.delete(String(uid)); return false; } return true; }
function markGamePresence(uid,key,worldId){
  uid=String(uid||""); key=String(key||""); if(!uid||!key)return;
  if(!GAME_PRESENCE.has(uid)) GAME_PRESENCE.set(uid,new Map());
  GAME_PRESENCE.get(uid).set(key,{worldId:safeText(worldId,24)||"world1",at:Date.now()});
}
function clearGamePresence(uid,key){ uid=String(uid||""); const m=GAME_PRESENCE.get(uid); if(!m)return; m.delete(String(key||"")); if(!m.size)GAME_PRESENCE.delete(uid); }
function presenceFor(uid){
  const m=GAME_PRESENCE.get(String(uid)); const first=m&&m.size?[...m.values()][0]:null;
  return { online:!!first || isWebOnline(uid), playing:!!first, worldId:first?.worldId||"" };
}
function friendChatKey(a,b){ return [String(a),String(b)].sort((x,y)=>Number(x)-Number(y)).join(":"); }
function areFriends(a,b){ const aa=accountDb.byId[String(a)]; return !!aa && ensureSocialState(aa).friends.includes(String(b)); }
function friendPublicSummary(uid){
  const a=accountDb.byId[String(uid)]; if(!a)return null; ensureSocialState(a); const p=presenceFor(uid);
  return { userId:a.userId, username:a.username||"", displayName:a.displayName||"", title:a.title||"", online:p.online, playing:p.playing, worldId:p.worldId };
}
function socialRequestSummary(uid){ const a=accountDb.byId[String(uid)]; return a?{userId:a.userId,username:a.username||"",displayName:a.displayName||"",title:a.title||""}:null; }
function normalizedTransferPart(raw){
  const obj=raw&&typeof raw==="object"?raw:{};
  const goldCubits=Math.max(0,Math.min(100000000,Math.floor(Number(obj.goldCubits ?? obj.cubits)||0)));
  const species=safeText(obj.species,24).toLowerCase();
  const cards=Math.max(0,Math.min(1000000,Math.floor(Number(obj.cards)||0)));
  return {goldCubits,species,cards};
}
function hasTransfer(a,part){
  if(!a)return false; if(ensureGoldCubits(a)<part.goldCubits)return false;
  if(part.cards>0){ const owned=Math.floor(Number(a.speciesCards?.[part.species])||0); if(!part.species||owned<part.cards)return false; }
  return true;
}
function applyTransfer(from,to,part){
  if(part.goldCubits>0){ setGoldCubits(from,ensureGoldCubits(from)-part.goldCubits); addGoldCubits(to,part.goldCubits); }
  if(part.cards>0&&part.species){ if(!from.speciesCards||typeof from.speciesCards!=="object")from.speciesCards={}; if(!to.speciesCards||typeof to.speciesCards!=="object")to.speciesCards={}; from.speciesCards[part.species]=Math.max(0,Math.floor(Number(from.speciesCards[part.species])||0)-part.cards); to.speciesCards[part.species]=Math.max(0,Math.floor(Number(to.speciesCards[part.species])||0)+part.cards); }
}
function normalizeLoadedAccounts() {
  const oldById = accountDb.byId || {};
  const newById = {};
  const idMap = new Map();
  const used = new Set();
  for (const [oldId, a0] of Object.entries(oldById)) {
    const a = a0 && typeof a0 === "object" ? a0 : {};
    let newId = /^\d{1,5}$/.test(String(oldId)) && !used.has(String(oldId)) ? String(oldId) : allocateNumericUserId(used);
    used.add(newId);
    idMap.set(String(oldId), newId);
    a.userId = newId;
    a.username = cleanDisplayName(a.username || "");
    a.displayName = cleanDisplayName(a.displayName || "");
    ensureTitleState(a);
    ensureEconomyState(a);
    ensurePetProgressState(a);
    ensureSocialState(a);
    newById[newId] = a;
  }
  accountDb.byId = newById;
  const newByGoogleSub = {};
  for (const [sub, oldId] of Object.entries(accountDb.byGoogleSub || {})) {
    const mapped = idMap.get(String(oldId));
    const target=mapped?newById[mapped]:null;
    // Trust the lookup only when it points at a real account and does not
    // contradict that account's own Google subject.
    if (target && (!safeText(target.googleSub,200) || safeText(target.googleSub,200)===String(sub))) newByGoogleSub[sub] = mapped;
  }
  // The account record itself also stores googleSub. Rebuild missing/corrupt lookup
  // entries from those records so a damaged byGoogleSub map cannot create a blank duplicate account.
  // If an older bug already created two records for the same Google account, prefer
  // the record with more permanent progress; ties prefer the older identity.
  const bestGoogleRecord=new Map();
  for (const [id,a] of Object.entries(newById)) {
    const sub=safeText(a?.googleSub,200); if(!sub)continue;
    const row={id,a,score:recoveryProgressWeight(a)+(cleanDisplayName(a.username||"")||cleanDisplayName(a.displayName||"")?6:0),created:Date.parse(String(a.createdAt||"")),gold:ensureGoldCubits(a)};
    const old=bestGoogleRecord.get(sub);
    let better=!old || row.score>old.score;
    if(old && row.score===old.score){
      if(Number.isFinite(row.created)&&Number.isFinite(old.created)&&row.created!==old.created)better=row.created<old.created;
      else if(row.gold!==old.gold)better=row.gold>old.gold;
    }
    if(better)bestGoogleRecord.set(sub,row);
  }
  for(const [sub,row] of bestGoogleRecord) newByGoogleSub[sub]=row.id;
  accountDb.byGoogleSub = newByGoogleSub;
  const newClaims = {};
  for (const [code, oldId] of Object.entries(accountDb.globalCodeClaims || {})) {
    newClaims[code] = idMap.get(String(oldId)) || String(oldId);
  }
  // Rebuild code ownership from each account too. The redeem route only consults
  // this map for global-once codes, so retaining extra non-global entries is harmless.
  for(const [id,a] of Object.entries(newById)){
    for(const rawCode of Array.isArray(a?.redeemedCodes)?a.redeemedCodes:[]){
      const code=safeText(rawCode,40).toUpperCase();
      if(code && !newClaims[code]) newClaims[code]=id;
    }
  }
  accountDb.globalCodeClaims = newClaims;
}
normalizeLoadedAccounts();
for (const a of Object.values(accountDb.byId || {})) {
  ensureGoldCubits(a);
  ensurePetProgressState(a);
  ensureRewardedDailyCubitMode(a);
  repairSpecialPromoEntitlements(a);
}
saveAccounts();

// Deploy-safe account recovery backup.
// Render's free web-service filesystem can be replaced during a deploy. HOSTL therefore
// gives the browser an HMAC-signed snapshot of the account after every account response.
// On the next Google sign-in, that snapshot can rebuild the SAME Google-linked account
// if the server-side accounts.json disappeared. The browser cannot edit the snapshot
// without invalidating the signature, and Google identity must still match before restore.
function recoverySubHash(googleSub,secret=RECOVERY_SECRET) {
  return crypto.createHmac("sha256", secret).update(`hostl-account-recovery-sub:${String(googleSub||"")}`).digest("base64url");
}
function accountRecoverySnapshot(a) {
  ensureGoldCubits(a); ensureTitleState(a); ensureEconomyState(a); ensurePetProgressState(a); ensureSocialState(a); ensureStarterPetEntitlements(a); ensureShopPurchases(a); ensureRedeemedCodes(a);
  const cloneObj = value => JSON.parse(JSON.stringify(value && typeof value === "object" ? value : {}));
  return {
    userId:String(a.userId||""),
    username:cleanDisplayName(a.username||"").slice(0,14),
    displayName:cleanDisplayName(a.displayName||""),
    profileNamesInitialized:!!a.profileNamesInitialized,
    goldCubits:ensureGoldCubits(a),
    unlockedThemes:Array.isArray(a.unlockedThemes)?[...new Set(a.unlockedThemes.map(x=>safeText(x,40)).filter(Boolean))].slice(0,100):[],
    selectedTheme:accountCanUseTheme(a,safeText(a.selectedTheme||"",40))?safeText(a.selectedTheme,40):"",
    achievements:cloneObj(a.achievements),
    lastDailyCubits:safeText(a.lastDailyCubits||"",20),
    dailyCubitRewardMode:safeText(a.dailyCubitRewardMode||"",32),
    lastDailyChest:safeText(a.lastDailyChest||"",20),
    redeemedCodes:[...ensureRedeemedCodes(a)],
    speciesCards:cloneObj(a.speciesCards),
    ownedStarters:cloneObj(a.ownedStarters),
    petStages:cloneObj(a.petStages),
    petStatUpgrades:cloneObj(a.petStatUpgrades),
    starterPetType:safeText(a.starterPetType||"",24).toLowerCase(),
    starterPetName:safeText(a.starterPetName||"",20),
    starterPetGender:a.starterPetGender==="Female"?"Female":"Male",
    materials:cloneObj(a.materials),
    craftedStarters:Array.isArray(a.craftedStarters)?[...a.craftedStarters]:[],
    learnedSkills:Array.isArray(a.learnedSkills)?[...a.learnedSkills]:[],
    title:safeText(a.title||"",32),
    unlockedTitles:Array.isArray(a.unlockedTitles)?[...a.unlockedTitles]:[],
    testerRank:Math.max(0,Math.floor(Number(a.testerRank)||0)),
    ownerRank:Math.max(0,Math.floor(Number(a.ownerRank)||0)),
    starterPetEntitlements:ensureStarterPetEntitlements(a).map(x=>({...x})),
    starterPetEntitlement:a.starterPetEntitlement&&typeof a.starterPetEntitlement==="object"?{...a.starterPetEntitlement}:null,
    specialRewardRepairs:cloneObj(a.specialRewardRepairs),
    shopPurchases:cloneObj(a.shopPurchases),
    friends:[...ensureSocialState(a).friends],
    incomingFriendRequests:[...a.incomingFriendRequests],
    outgoingFriendRequests:[...a.outgoingFriendRequests],
    createdAt:safeText(a.createdAt||new Date().toISOString(),40)
  };
}
function signAccountRecovery(a) {
  if(!a?.googleSub) return "";
  // Do not mint a different token every time /api/friends polls. A stable token
  // until the account actually changes prevents good historical snapshots from
  // being pushed out of browser storage by heartbeat traffic.
  const updated=Date.parse(String(a.updatedAt||""));
  const created=Date.parse(String(a.createdAt||""));
  const iat=Number.isFinite(updated)?updated:(Number.isFinite(created)?created:Date.now());
  const payload={v:1,iat,subHash:recoverySubHash(a.googleSub,RECOVERY_SECRET),account:accountRecoverySnapshot(a)};
  const body=b64url(JSON.stringify(payload));
  const sig=crypto.createHmac("sha256",RECOVERY_SECRET).update(`hostl-recovery:${body}`).digest("base64url");
  return `${body}.${sig}`;
}
function verifyAccountRecoveryToken(token,googleSub) {
  try{
    const [body,sig]=String(token||"").split(".");
    if(!body||!sig)return null;
    const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
    if(Number(payload?.v)!==1 || !payload?.account || typeof payload.account!=="object") return null;
    const secrets=[...new Set([RECOVERY_SECRET,SESSION_SECRET].filter(Boolean))];
    for(const secret of secrets){
      const expected=crypto.createHmac("sha256",secret).update(`hostl-recovery:${body}`).digest("base64url");
      const aa=Buffer.from(sig),bb=Buffer.from(expected);
      if(aa.length!==bb.length||!crypto.timingSafeEqual(aa,bb))continue;
      if(payload?.subHash!==recoverySubHash(googleSub,secret))continue;
      return payload;
    }
    return null;
  }catch(_){return null;}
}
function restoreAccountFromRecovery(payload,googleProfile) {
  const snap=payload?.account||{};
  const desired=/^\d{1,5}$/.test(String(snap.userId||""))?String(snap.userId):"";
  let userId=desired && !accountDb.byId[desired] ? desired : allocateNumericUserId();
  const a={
    userId, googleSub:googleProfile.sub,
    username:cleanDisplayName(snap.username||"").slice(0,14), displayName:cleanDisplayName(snap.displayName||""), profileNamesInitialized:!!snap.profileNamesInitialized,
    email:safeText(googleProfile.email,120).toLowerCase(), picture:safeText(googleProfile.picture,500),
    goldCubits:Math.max(0,Math.min(1000000000,Math.floor(Number(snap.goldCubits)||0))),
    unlockedThemes:Array.isArray(snap.unlockedThemes)?snap.unlockedThemes:[], selectedTheme:safeText(snap.selectedTheme||"",40), achievements:(snap.achievements&&typeof snap.achievements==="object"&&!Array.isArray(snap.achievements))?snap.achievements:{},
    lastDailyCubits:safeText(snap.lastDailyCubits||"",20), dailyCubitRewardMode:safeText(snap.dailyCubitRewardMode||"",32), lastDailyChest:safeText(snap.lastDailyChest||"",20), redeemedCodes:Array.isArray(snap.redeemedCodes)?snap.redeemedCodes:[],
    speciesCards:(snap.speciesCards&&typeof snap.speciesCards==="object"&&!Array.isArray(snap.speciesCards))?snap.speciesCards:{}, ownedStarters:(snap.ownedStarters&&typeof snap.ownedStarters==="object"&&!Array.isArray(snap.ownedStarters))?snap.ownedStarters:{},
    petStages:(snap.petStages&&typeof snap.petStages==="object"&&!Array.isArray(snap.petStages))?snap.petStages:{}, petStatUpgrades:(snap.petStatUpgrades&&typeof snap.petStatUpgrades==="object"&&!Array.isArray(snap.petStatUpgrades))?snap.petStatUpgrades:{},
    starterPetType:safeText(snap.starterPetType||"",24).toLowerCase(), starterPetName:safeText(snap.starterPetName||"",20), starterPetGender:snap.starterPetGender==="Female"?"Female":"Male",
    materials:(snap.materials&&typeof snap.materials==="object"&&!Array.isArray(snap.materials))?snap.materials:{}, craftedStarters:Array.isArray(snap.craftedStarters)?snap.craftedStarters:[], learnedSkills:Array.isArray(snap.learnedSkills)?snap.learnedSkills:[],
    title:safeText(snap.title||"",32), unlockedTitles:Array.isArray(snap.unlockedTitles)?snap.unlockedTitles:[], testerRank:Math.max(0,Math.floor(Number(snap.testerRank)||0)), ownerRank:Math.max(0,Math.floor(Number(snap.ownerRank)||0)),
    starterPetEntitlements:Array.isArray(snap.starterPetEntitlements)?snap.starterPetEntitlements:[], starterPetEntitlement:snap.starterPetEntitlement&&typeof snap.starterPetEntitlement==="object"?snap.starterPetEntitlement:null,
    specialRewardRepairs:(snap.specialRewardRepairs&&typeof snap.specialRewardRepairs==="object"&&!Array.isArray(snap.specialRewardRepairs))?snap.specialRewardRepairs:{},
    shopPurchases:(snap.shopPurchases&&typeof snap.shopPurchases==="object"&&!Array.isArray(snap.shopPurchases))?snap.shopPurchases:{},
    friends:Array.isArray(snap.friends)?snap.friends:[], incomingFriendRequests:Array.isArray(snap.incomingFriendRequests)?snap.incomingFriendRequests:[], outgoingFriendRequests:Array.isArray(snap.outgoingFriendRequests)?snap.outgoingFriendRequests:[],
    createdAt:safeText(snap.createdAt||new Date().toISOString(),40), updatedAt:new Date().toISOString()
  };
  ensureGoldCubits(a); ensureTitleState(a); ensureEconomyState(a); ensurePetProgressState(a); ensureSocialState(a); ensureStarterPetEntitlements(a); ensureShopPurchases(a); ensureRedeemedCodes(a); repairSpecialPromoEntitlements(a);
  if(!accountCanUseTheme(a,a.selectedTheme)) a.selectedTheme="";
  accountDb.byId[userId]=a; accountDb.byGoogleSub[googleProfile.sub]=userId;
  // Rebuild global one-use code ownership when its rightful signed account returns after storage loss.
  for(const code of a.redeemedCodes){const def=PROMO_CODES.get(String(code).toUpperCase());if(def?.globalOnce&&!accountDb.globalCodeClaims[String(code).toUpperCase()])accountDb.globalCodeClaims[String(code).toUpperCase()]=userId;}
  return a;
}
function bestAccountRecoveryPayload(rawTokens, googleSub, current=null) {
  const supplied=Array.isArray(rawTokens)?rawTokens.slice(0,8):[];
  const valid=[];
  for(const raw of supplied){
    const candidate=verifyAccountRecoveryToken(safeText(raw,180000),googleSub);
    if(candidate) valid.push(candidate);
  }
  if(!valid.length) return null;

  // Group by historical HOSTL id. For normal recovery we use the newest snapshot
  // for each id, which avoids rolling legitimate purchases/spending backward. If a
  // freak replacement-account collision reused the SAME numeric id, also keep the
  // newest snapshot from before the replacement account was created.
  const byUser=new Map();
  for(const candidate of valid){
    const id=String(candidate?.account?.userId||""); if(!id)continue;
    if(!byUser.has(id))byUser.set(id,[]);
    byUser.get(id).push(candidate);
  }
  let choices=[];
  const currentCreated=current?Date.parse(String(current.createdAt||"")):NaN;
  for(const [id,rows] of byUser){
    rows.sort((a,b)=>Number(b.iat||0)-Number(a.iat||0));
    if(rows[0])choices.push(rows[0]);
    if(current && id===String(current.userId||"") && Number.isFinite(currentCreated)){
      const historical=rows.find(x=>Number(x.iat||0)>0 && Number(x.iat||0)<currentCreated);
      if(historical && historical!==rows[0])choices.push(historical);
    }
  }
  if(!choices.length)return null;

  if(current){
    const rescuers=choices.filter(candidate=>shouldRecoverOverExistingAccount(current,candidate));
    if(rescuers.length) choices=rescuers;
    else {
      const sameId=choices.filter(candidate=>String(candidate?.account?.userId||"")===String(current.userId||""));
      if(sameId.length){ sameId.sort((a,b)=>Number(b.iat||0)-Number(a.iat||0)); choices=[sameId[0]]; }
    }
  }
  choices.sort((a,b)=>{
    const scoreDiff=recoveryProgressWeight(b.account)-recoveryProgressWeight(a.account);
    if(Math.abs(scoreDiff)>0.001) return scoreDiff;
    const ac=Date.parse(String(a?.account?.createdAt||"")),bc=Date.parse(String(b?.account?.createdAt||""));
    if(Number.isFinite(ac)&&Number.isFinite(bc)&&ac!==bc) return ac-bc; // older account identity wins ties
    const ag=Math.max(0,Math.floor(Number(a?.account?.goldCubits)||0)),bg=Math.max(0,Math.floor(Number(b?.account?.goldCubits)||0));
    if(bg!==ag) return bg-ag;
    return Number(b.iat||0)-Number(a.iat||0);
  });
  return choices[0]||null;
}
function recoveryProgressWeight(snap={}) {
  let score=0;
  const cards=(snap.speciesCards&&typeof snap.speciesCards==="object")?snap.speciesCards:{};
  score += Object.values(cards).reduce((n,v)=>n+Math.min(200,Math.max(0,Math.floor(Number(v)||0))),0)*0.15;
  const owned=(snap.ownedStarters&&typeof snap.ownedStarters==="object")?snap.ownedStarters:{};
  score += Object.values(owned).filter(Boolean).length*18;
  const stageRank={baby:0,adult:1,boss:2,superboss:3,bigmomma:4};
  const stages=(snap.petStages&&typeof snap.petStages==="object")?snap.petStages:{};
  score += Object.values(stages).reduce((n,v)=>n+(stageRank[String(v||"baby")]||0)*14,0);
  const ups=(snap.petStatUpgrades&&typeof snap.petStatUpgrades==="object")?snap.petStatUpgrades:{};
  for(const stats of Object.values(ups)) if(stats&&typeof stats==="object") score += Object.values(stats).reduce((n,v)=>n+Math.max(0,Math.floor(Number(v)||0))*5,0);
  score += Object.keys((snap.achievements&&typeof snap.achievements==="object")?snap.achievements:{}).length*12;
  score += (Array.isArray(snap.unlockedThemes)?snap.unlockedThemes.length:0)*8;
  score += (Array.isArray(snap.craftedStarters)?snap.craftedStarters.length:0)*18;
  score += (Array.isArray(snap.learnedSkills)?snap.learnedSkills.length:0)*18;
  score += (Array.isArray(snap.redeemedCodes)?snap.redeemedCodes.length:0)*24;
  score += (Array.isArray(snap.friends)?snap.friends.length:0)*4;
  score += (Array.isArray(snap.starterPetEntitlements)?snap.starterPetEntitlements.length:0)*30;
  score += Math.max(0,Math.floor(Number(snap.testerRank)||0))*250 + Math.max(0,Math.floor(Number(snap.ownerRank)||0))*500;
  const mats=(snap.materials&&typeof snap.materials==="object")?snap.materials:{};
  score += Object.values(mats).reduce((n,v)=>n+Math.min(50,Math.max(0,Math.floor(Number(v)||0))),0)*0.08;
  return score;
}
function accountLooksLikeFreshReplacement(a) {
  if(!a||typeof a!=="object") return false;
  const snap=accountRecoverySnapshot(a);
  const noPermanentProgress=recoveryProgressWeight(snap)<1;
  const noCustomProfile=!cleanDisplayName(snap.username||"")&&!cleanDisplayName(snap.displayName||"");
  // New HOSTL accounts currently begin with 500 Gold Cubits. Allow a little room for
  // a daily reward or UI test so recovery still works after the player noticed the reset.
  const nearFreshCurrency=Math.max(0,Math.floor(Number(snap.goldCubits)||0))<=700;
  return noPermanentProgress && noCustomProfile && nearFreshCurrency;
}
function shouldRecoverOverExistingAccount(current,payload) {
  if(!current||!payload?.account) return false;
  const oldId=String(payload.account.userId||""),currentId=String(current.userId||"");
  if(!oldId) return false;
  const issued=Number(payload.iat||0),currentCreated=Date.parse(String(current.createdAt||""));
  // The replacement account must have been created after the signed old-account backup.
  // That is the fingerprint of "server save vanished, then a new device logged in first".
  if(!Number.isFinite(currentCreated)||!issued||currentCreated<=issued) return false;
  const oldScore=recoveryProgressWeight(payload.account),currentScore=recoveryProgressWeight(accountRecoverySnapshot(current));
  const oldGold=Math.max(0,Math.floor(Number(payload.account.goldCubits)||0));
  const currentGold=ensureGoldCubits(current);
  return accountLooksLikeFreshReplacement(current) || oldScore>currentScore+20 || oldGold>currentGold+500;
}
function recoverOverExistingAccount(current,payload,googleProfile) {
  if(!shouldRecoverOverExistingAccount(current,payload)) return null;
  const obsoleteId=String(current.userId||"");
  const desiredId=String(payload?.account?.userId||"");
  // Rare but possible: a replacement account can randomly receive the same numeric
  // ID as the lost account. Free that exact fresh record so recovery can restore the
  // original identity instead of unnecessarily allocating a second ID.
  const reuseSameId=obsoleteId && desiredId===obsoleteId && accountDb.byId[obsoleteId]===current && current.googleSub===googleProfile.sub;
  if(reuseSameId) delete accountDb.byId[obsoleteId];
  const restored=restoreAccountFromRecovery(payload,googleProfile);
  if(obsoleteId && obsoleteId!==String(restored.userId||"") && accountDb.byId[obsoleteId]?.googleSub===googleProfile.sub) delete accountDb.byId[obsoleteId];
  accountDb.byGoogleSub[googleProfile.sub]=restored.userId;
  return restored;
}

function publicAccount(a) {
  return {
    userId: a.userId,
    username: a.username || "",
    displayName: a.displayName || "",
    email: a.email || "",
    picture: a.picture || "",
    goldCubits: ensureGoldCubits(a),
    unlockedThemes: Array.isArray(a.unlockedThemes) ? a.unlockedThemes : [],
    selectedTheme: accountCanUseTheme(a, safeText(a.selectedTheme||"",40)) ? safeText(a.selectedTheme,40) : "",
    achievements: a.achievements && typeof a.achievements === "object" ? a.achievements : {},
    lastDailyCubits: a.lastDailyCubits || "",
    lastDailyChest: a.lastDailyChest || "",
    createdAt: a.createdAt || "",
    title: a.title || "",
    unlockedTitles: Array.isArray(a.unlockedTitles) ? a.unlockedTitles : [],
    testerRank: Math.max(0, Math.floor(Number(a.testerRank) || 0)),
    ownerRank: Math.max(0, Math.floor(Number(a.ownerRank) || 0)),
    speciesCards: ensurePetProgressState(a).speciesCards,
    ownedStarters: {...a.ownedStarters},
    petStages: Object.fromEntries([...ACCOUNT_PET_TYPES].map(type=>[type,accountStarterStage(a,type)])),
    petStatUpgrades: JSON.parse(JSON.stringify(a.petStatUpgrades||{})),
    starterPetType: a.starterPetType||"",
    starterPetName: a.starterPetName||"",
    starterPetGender: a.starterPetGender||"Male",
    materials: ensureEconomyState(a).materials,
    craftedStarters: [...a.craftedStarters],
    learnedSkills: [...a.learnedSkills],
    starterPetEntitlements: ensureStarterPetEntitlements(a).map(x=>({...x})),
    starterPetEntitlement: a.starterPetEntitlement && typeof a.starterPetEntitlement === "object" ? {...a.starterPetEntitlement} : null,
    friendCount: ensureSocialState(a).friends.length,
    recoveryToken: signAccountRecovery(a)
  };
}
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}
function signSession(userId) {
  const body = b64url(JSON.stringify({ uid: userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifySession(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.uid || Number(payload.exp) < Date.now()) return null;
    return accountDb.byId[payload.uid] ? payload.uid : null;
  } catch (_) { return null; }
}
function cookieValue(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const piece of raw.split(";")) {
    const i = piece.indexOf("=");
    if (i < 0) continue;
    const k = piece.slice(0, i).trim();
    if (k !== name) continue;
    try { return decodeURIComponent(piece.slice(i + 1).trim()); } catch (_) { return piece.slice(i + 1).trim(); }
  }
  return "";
}
function requestSessionToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return cookieValue(req, "hostl_session");
}
function setSessionCookie(res, token) {
  // HttpOnly keeps game JavaScript from accidentally deleting or exposing the session.
  res.setHeader("Set-Cookie", `hostl_session=${encodeURIComponent(token)}; Max-Age=${60*60*24*30}; Path=/; HttpOnly; Secure; SameSite=Lax`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "hostl_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
}
function requireAccount(req, res, next) {
  const token = requestSessionToken(req);
  const uid = verifySession(token);
  if (!uid) return res.status(401).json({ ok: false, error: "not_authenticated" });
  req.hostlUserId = uid;
  req.hostlSessionToken = token;
  next();
}
function utcDayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function ensureRewardedDailyCubitMode(account) {
  if (!account || typeof account !== "object") return false;
  if (account.dailyCubitRewardMode === "rewarded100v1") return false;
  // Builds before 664 granted a small daily login bonus automatically and reused
  // lastDailyCubits for it. Reset that legacy day once so every existing account
  // can enter the new rewarded-ad daily system cleanly.
  account.dailyCubitRewardMode = "rewarded100v1";
  account.lastDailyCubits = "";
  return true;
}
function issueReviveAuthorization(account, method, runId) {
  const token = crypto.randomBytes(24).toString("base64url");
  reviveAuthorizations.set(token, { uid:String(account?.userId||""), method:String(method||""), runId:safeText(runId,96), exp:Date.now()+2*60*1000 });
  if (reviveAuthorizations.size > 5000) {
    const now=Date.now();
    for (const [k,v] of reviveAuthorizations) if (!v || Number(v.exp||0) < now) reviveAuthorizations.delete(k);
  }
  return token;
}
function consumeReviveAuthorization(userId, token) {
  const key=String(token||"");
  const row=reviveAuthorizations.get(key);
  reviveAuthorizations.delete(key);
  if(!row || Number(row.exp||0)<Date.now() || String(row.uid||"")!==String(userId||"")) return null;
  return {ok:true,method:row.method,runId:row.runId};
}

// Official HOSTL promo codes. Add future codes here and redeploy.
// Rewards are applied server-side so each account can only claim a code once.
const PROMO_CODES = new Map([
  ["HOSTLSTART", { goldCubits: 150, themes: ["Golden"], label: "+150 Gold Cubits and the Golden theme" }],
  ["SCCTT", {
    goldCubits: 14000,
    speciesCards: { saber: 500 },
    title: "#1 Tester",
    testerRank: 1,
    starterPets: [{ type: "saber", stage: "adult" }],
    globalOnce: true,
    label: "+14,000 Gold Cubits, +500 Saber Cards, Adult Saber starter access, and the #1 Tester title"
  }],
  ["SCCTT2", {
    goldCubits: 14000,
    speciesCards: { saber: 500 },
    title: "#1 Tester",
    testerRank: 1,
    starterPets: [{ type: "saber", stage: "adult" }],
    globalOnce: true,
    label: "+14,000 Gold Cubits, +500 Saber Cards, Adult Saber starter access, and the #1 Tester title"
  }],
  ["OVCC", {
    goldCubits: 10000,
    speciesCards: { snake: 500 },
    title: "Owner",
    ownerRank: 1,
    starterPets: [{ type: "snake", stage: "adult" }],
    globalOnce: true,
    label: "+10,000 Gold Cubits, +500 Viper Cards, Adult Viper starter access, and the Owner title"
  }],
  ["OVCC2", {
    goldCubits: 10000,
    speciesCards: { snake: 500 },
    title: "Owner",
    ownerRank: 1,
    starterPets: [{ type: "snake", stage: "adult" }],
    globalOnce: true,
    label: "+10,000 Gold Cubits, +500 Viper Cards, Adult Viper starter access, and the Owner title"
  }],
  ["STC", {
    speciesCards: { saber: 500 },
    themes: ["celestialCrown"],
    starterPets: [{ type: "saber", stage: "adult" }],
    globalOnce: true,
    label: "+500 Saber Cards, Adult Saber starter access, and the Celestial Crown theme"
  }]
]);
function normalizePromoCode(value) {
  return safeText(value, 32).toUpperCase().replace(/\s+/g, "");
}
function ensureRedeemedCodes(account) {
  if (!Array.isArray(account.redeemedCodes)) account.redeemedCodes = [];
  return account.redeemedCodes;
}
function addSpeciesCardsNormal(a,species,amount){
  ensurePetProgressState(a);
  const type=canonicalAccountPetType(species);
  const qty=Math.max(0,Math.floor(Number(amount)||0));
  if(!type || !qty)return false;
  a.speciesCards[type]=Math.max(0,Math.floor(Number(a.speciesCards[type])||0)+qty);
  return true;
}
function unlockThemesNormal(a,themes){
  if(!Array.isArray(themes)||!themes.length)return false;
  if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
  const before=a.unlockedThemes.length;
  a.unlockedThemes=[...new Set([...a.unlockedThemes,...themes.map(x=>safeText(x,40)).filter(Boolean)])].slice(0,100);
  return a.unlockedThemes.length!==before;
}
function applyPromoRewardThroughNormalSystems(a,reward={}){
  ensureGoldCubits(a); ensurePetProgressState(a); ensureTitleState(a);
  if(Number.isFinite(Number(reward.goldCubits))&&Number(reward.goldCubits)>0)addGoldCubits(a,reward.goldCubits);
  unlockThemesNormal(a,reward.themes);
  if(reward.speciesCards&&typeof reward.speciesCards==="object"){
    for(const [species,raw] of Object.entries(reward.speciesCards))addSpeciesCardsNormal(a,species,raw);
  }
  if(reward.title){
    const grantedTitle=safeText(reward.title,32);
    if(grantedTitle&&!a.unlockedTitles.includes(grantedTitle))a.unlockedTitles.push(grantedTitle);
    if(!a.title&&grantedTitle)a.title=grantedTitle;
  }
  if(Number(reward.testerRank)>0)a.testerRank=Math.max(Math.max(0,Math.floor(Number(a.testerRank)||0)),Math.floor(Number(reward.testerRank)||0));
  if(Number(reward.ownerRank)>0){
    a.ownerRank=Math.max(Math.max(0,Math.floor(Number(a.ownerRank)||0)),Math.floor(Number(reward.ownerRank)||0));
    if(!a.unlockedTitles.includes("Owner"))a.unlockedTitles.push("Owner");
    if(!a.title)a.title="Owner";
  }
  const starterPets=Array.isArray(reward.starterPets)?reward.starterPets:[];
  for(const pet of starterPets){
    if(pet&&typeof pet==="object")grantStarterPetUnlockNormal(a,pet.type,pet.stage||"baby");
  }
  // Backward compatibility for any old code definition still using the legacy key.
  // It is immediately converted into normal pet ownership/progression, never a
  // separate code-only pet record.
  if(reward.starterPetEntitlement&&typeof reward.starterPetEntitlement==="object"){
    grantStarterPetUnlockNormal(a,reward.starterPetEntitlement.type,reward.starterPetEntitlement.stage||"baby");
  }
  return a;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, game: "HOSTL", multiplayer: true, serverBuild: 595, gameBuild: 682, rulesVersion: "667", chat: true, googleAuth: !!GOOGLE_CLIENT_ID, rewardedAdsConfigured: REWARDED_ADS_CONFIGURED, accountStoragePersistent: ACCOUNT_STORAGE_PERSISTENT, accountRecoveryBackup: true, accountRecoverySecretStable: !!(process.env.HOSTL_RECOVERY_SECRET||process.env.HOSTL_SESSION_SECRET), accountDbLoadSource:ACCOUNT_LOAD_SOURCE, accountDbLoadHadError:ACCOUNT_LOAD_HAD_ERROR, accountDataDir: DATA_DIR, ...getCubeServerStats() });
});

app.get("/status", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, ...getCubeServerStats(), maxPlayersPerRoom: 12, serverBuild: 595, gameBuild: 682, rulesVersion: "667" });
});

app.get("/auth/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, googleClientId: GOOGLE_CLIENT_ID || "", rewardedAdsConfigured: REWARDED_ADS_CONFIGURED });
});

app.post("/auth/google", async (req, res) => {
  if (!googleClient || !GOOGLE_CLIENT_ID) return res.status(503).json({ ok: false, error: "google_auth_not_configured" });
  const credential = safeText(req.body?.credential, 10000);
  if (!credential) return res.status(400).json({ ok: false, error: "missing_credential" });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p?.email) return res.status(401).json({ ok: false, error: "invalid_google_account" });

    let userId = accountDb.byGoogleSub[p.sub];
    let account = userId ? accountDb.byId[userId] : null;
    let created = false;
    let recovered = false;
    const supplied = Array.isArray(req.body?.recoveryTokens) ? req.body.recoveryTokens.slice(0,8) : (req.body?.recoveryToken ? [req.body.recoveryToken] : []);
    const bestRecovery = bestAccountRecoveryPayload(supplied,p.sub,account);
    if(account && bestRecovery){
      const rescued=recoverOverExistingAccount(account,bestRecovery,p);
      if(rescued){ account=rescued; userId=account.userId; recovered=true; }
    }
    if (!account && bestRecovery) {
      account=restoreAccountFromRecovery(bestRecovery,p); userId=account.userId; recovered=true;
    }
    if (!account) {
      created = true;
      userId = allocateNumericUserId();
      account = {
        userId,
        googleSub: p.sub,
        username: "",
        displayName: "",
        profileNamesInitialized: true,
        email: safeText(p.email, 120).toLowerCase(),
        picture: safeText(p.picture, 500),
        goldCubits: 500,
        unlockedThemes: [],
        selectedTheme: "forestGold",
        achievements: {},
        lastDailyCubits: "",
        dailyCubitRewardMode: "rewarded100v1",
        lastDailyChest: "",
        redeemedCodes: [],
        speciesCards: {},
        ownedStarters: {}, petStages: {}, petStatUpgrades: {}, starterPetType:"", starterPetName:"", starterPetGender:"Male",
        materials: {}, craftedStarters: [], learnedSkills: [],
        title: "",
        unlockedTitles: [],
        testerRank: 0,
        ownerRank: 0,
        starterPetEntitlement: null,
        friends: [], incomingFriendRequests: [], outgoingFriendRequests: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      accountDb.byId[userId] = account;
      accountDb.byGoogleSub[p.sub] = userId;
    } else {
      account.email = safeText(p.email, 120).toLowerCase();
      account.picture = safeText(p.picture, 500);
      // Username and Display Name are HOSTL profile fields chosen by the player.
      // They are intentionally NOT connected to the Google profile name.
      if (!account.profileNamesInitialized) {
        const oldGoogleName = cleanDisplayName(p.given_name || p.name || "");
        const oldUser = cleanDisplayName(account.username || "");
        const oldDisplay = cleanDisplayName(account.displayName || "");
        // Migrate old test accounts that were auto-filled from Google by older HOSTL builds.
        if (oldGoogleName && oldUser === oldGoogleName) account.username = "";
        else account.username = oldUser;
        if (oldGoogleName && oldDisplay === oldGoogleName) account.displayName = "";
        else account.displayName = oldDisplay;
        account.profileNamesInitialized = true;
      } else {
        account.username = cleanDisplayName(account.username || "");
        account.displayName = cleanDisplayName(account.displayName || "");
      }
      ensureTitleState(account);
      ensureEconomyState(account);
      ensureSocialState(account);
      repairSpecialPromoEntitlements(account);
      account.updatedAt = new Date().toISOString();
    }
    const dailyModeMigrated = ensureRewardedDailyCubitMode(account);
    const dailyGranted = false;
    if (dailyModeMigrated) account.updatedAt = new Date().toISOString();
    await saveAccounts();
    const sessionToken = signSession(userId);
    setSessionCookie(res, sessionToken);
    res.json({ ok: true, created, recovered, dailyGranted, token: sessionToken, account: publicAccount(account) });
  } catch (err) {
    console.error("Google login failed:", err?.message || err);
    res.status(401).json({ ok: false, error: "google_verification_failed" });
  }
});

app.get("/api/account", requireAccount, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const a=accountDb.byId[req.hostlUserId];
  const dailyModeMigrated=ensureRewardedDailyCubitMode(a);
  if(dailyModeMigrated||repairSpecialPromoEntitlements(a)){a.updatedAt=new Date().toISOString();await saveAccounts();}
  // Returning the already-verified token lets the browser restore its local copy from
  // the HttpOnly cookie after a reload without asking Google to sign in again.
  res.json({ ok: true, token: req.hostlSessionToken, account: publicAccount(a) });
});

app.post("/api/account/recover", requireAccount, async (req,res)=>{
  const current=accountDb.byId[req.hostlUserId];
  if(!current?.googleSub) return res.status(404).json({ok:false,error:"account_missing"});
  const supplied=Array.isArray(req.body?.recoveryTokens)?req.body.recoveryTokens.slice(0,8):[];
  const best=bestAccountRecoveryPayload(supplied,current.googleSub,current);
  if(!best) return res.json({ok:true,recovered:false,account:publicAccount(current),token:req.hostlSessionToken});
  const profile={sub:current.googleSub,email:current.email||"",picture:current.picture||""};
  const restored=recoverOverExistingAccount(current,best,profile);
  if(!restored) return res.json({ok:true,recovered:false,account:publicAccount(current),token:req.hostlSessionToken});
  restored.updatedAt=new Date().toISOString();
  await saveAccounts();
  const token=signSession(restored.userId);
  setSessionCookie(res,token);
  return res.json({ok:true,recovered:true,token,account:publicAccount(restored)});
});

app.post("/auth/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok:true });
});

app.put("/api/account", requireAccount, async (req, res) => {
  const a = accountDb.byId[req.hostlUserId];
  const body = req.body || {};
  if (typeof body.username === "string") {
    const nextUsername = cleanDisplayName(body.username).slice(0, 14);
    if (nextUsername.length >= 2) { a.username = nextUsername; a.profileNamesInitialized = true; }
  }
  if (typeof body.displayName === "string") {
    const nextName = cleanDisplayName(body.displayName);
    if (nextName.length >= 2) { a.displayName = nextName; a.profileNamesInitialized = true; }
  }
  ensureTitleState(a);
  if (typeof body.title === "string") {
    const requestedTitle = safeText(body.title, 32);
    if (!requestedTitle) a.title = "";
    else if (a.unlockedTitles.includes(requestedTitle)) a.title = requestedTitle;
  }
  if (typeof body.selectedTheme === "string") {
    const requestedTheme=safeText(body.selectedTheme,40);
    if(accountCanUseTheme(a,requestedTheme)) a.selectedTheme=requestedTheme;
  }
  // Security: economy/progression fields are intentionally ignored here. Gold Cubits,
  // cards, unlocks, stages, stat upgrades, achievements and rewards are mutated only by
  // dedicated server-validated routes or authoritative multiplayer hooks.
  if (typeof body.starterPetType === "string" || typeof body.starterPetName === "string" || typeof body.starterPetGender === "string") {
    const type=typeof body.starterPetType==="string"?body.starterPetType:a.starterPetType;
    const name=typeof body.starterPetName==="string"?body.starterPetName:a.starterPetName;
    const gender=typeof body.starterPetGender==="string"?body.starterPetGender:a.starterPetGender;
    cleanAccountStarterSelection(a,type,name,gender);
  }
  ensurePetProgressState(a);
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  res.json({ ok: true, account: publicAccount(a) });
});

app.post("/api/pets/unlock", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensurePetProgressState(a);
  const species=canonicalAccountPetType(req.body?.species), method=safeText(req.body?.method,16).toLowerCase();
  const def=ACCOUNT_PET_UNLOCK[species]; if(!def)return res.status(404).json({ok:false,error:"unknown_species"});
  if(accountOwnsPetStarter(a,species))return res.json({ok:true,alreadyOwned:true,account:publicAccount(a)});
  if(method==="cards"){
    const have=Math.max(0,Math.floor(Number(a.speciesCards[species])||0)); if(have<def.cards)return res.status(409).json({ok:false,error:"not_enough_cards",cost:def.cards,have,account:publicAccount(a)});
    a.speciesCards[species]=have-def.cards;
  }else if(method==="cubits"){
    if(ensureGoldCubits(a)<def.cubits)return res.status(409).json({ok:false,error:"not_enough_cubits",cost:def.cubits,account:publicAccount(a)});
    setGoldCubits(a,ensureGoldCubits(a)-def.cubits);
  }else return res.status(400).json({ok:false,error:"bad_unlock_method"});
  a.ownedStarters[`start_${species}`]=true; a.petStages[species]="baby"; a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,species,method,account:publicAccount(a)});
});

app.post("/api/pets/upgrade-stage", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensurePetProgressState(a); const species=canonicalAccountPetType(req.body?.species);
  if(!ACCOUNT_PET_TYPES.has(species))return res.status(404).json({ok:false,error:"unknown_species"});
  if(!accountOwnsPetStarter(a,species))return res.status(403).json({ok:false,error:"pet_locked"});
  const current=accountStarterStage(a,species), idx=ACCOUNT_PET_STAGE_ORDER.indexOf(current), next=idx>=0&&idx<ACCOUNT_PET_STAGE_ORDER.length-1?ACCOUNT_PET_STAGE_ORDER[idx+1]:null;
  if(!next)return res.status(409).json({ok:false,error:"max_stage",account:publicAccount(a)}); const cost=ACCOUNT_PET_STAGE_COST[next]||0;
  const have=Math.max(0,Math.floor(Number(a.speciesCards[species])||0)); if(have<cost)return res.status(409).json({ok:false,error:"not_enough_cards",cost,have,account:publicAccount(a)});
  a.speciesCards[species]=have-cost; a.petStages[species]=next; a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,species,stage:next,cost,account:publicAccount(a)});
});

app.post("/api/pets/upgrade-stat", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensurePetProgressState(a); const species=canonicalAccountPetType(req.body?.species),stat=safeText(req.body?.stat,16).toLowerCase();
  if(!ACCOUNT_PET_TYPES.has(species)||!ACCOUNT_PET_STATS.has(stat))return res.status(404).json({ok:false,error:"unknown_upgrade"});
  if(!accountOwnsPetStarter(a,species))return res.status(403).json({ok:false,error:"pet_locked"});
  if(!a.petStatUpgrades[species])a.petStatUpgrades[species]={}; const level=Math.max(0,Math.min(ACCOUNT_PET_STAT_MAX,Math.floor(Number(a.petStatUpgrades[species][stat])||0)));
  if(level>=ACCOUNT_PET_STAT_MAX)return res.status(409).json({ok:false,error:"max_stat",account:publicAccount(a)}); const cost=5+level*5;
  const have=Math.max(0,Math.floor(Number(a.speciesCards[species])||0)); if(have<cost)return res.status(409).json({ok:false,error:"not_enough_cards",cost,have,account:publicAccount(a)});
  a.speciesCards[species]=have-cost; a.petStatUpgrades[species][stat]=level+1; a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,species,stat,level:level+1,cost,account:publicAccount(a)});
});

app.post("/api/starters/buy", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensurePetProgressState(a); const id=safeText(req.body?.id,40),price=STARTER_SHOP_ITEMS[id];
  if(!Number.isFinite(price))return res.status(404).json({ok:false,error:"unknown_starter"});
  if(a.ownedStarters[id])return res.json({ok:true,alreadyOwned:true,account:publicAccount(a)});
  if(ensureGoldCubits(a)<price)return res.status(409).json({ok:false,error:"not_enough_cubits",cost:price,account:publicAccount(a)});
  setGoldCubits(a,ensureGoldCubits(a)-price); a.ownedStarters[id]=true; a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,id,price,account:publicAccount(a)});
});


app.get("/api/time", (req,res)=>{
  const now=Date.now(); const d=new Date(now); const next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1));
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,serverNow:now,utcDay:d.toISOString().slice(0,10),nextUtcDayAt:next.getTime()});
});
app.get("/api/shop/stock", (req,res)=>{
  const now=Date.now(); const info=shopRotationInfo(now); const stock=generateShopStock(info.rotationId);
  const uid=verifySession(requestSessionToken(req)); const a=uid?accountDb.byId[uid]:null;
  const purchased=a?purchasedShopSlots(a,info.rotationId):[];
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,serverNow:now,utcDay:new Date(now).toISOString().slice(0,10),rotationId:info.rotationId,nextRefreshAt:info.nextRefreshAt,
    listings:stock.map(x=>({...x,purchased:purchased.includes(x.slotId)}))});
});
app.post("/api/shop/buy-stock", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a);
  const info=shopRotationInfo(); const stock=generateShopStock(info.rotationId);
  const slotId=safeText(req.body?.slotId,64); const listing=stock.find(x=>x.slotId===slotId);
  if(!listing)return res.status(409).json({ok:false,error:"shop_refreshed",rotationId:info.rotationId,nextRefreshAt:info.nextRefreshAt,account:publicAccount(a)});
  const bought=purchasedShopSlots(a,info.rotationId);
  if(bought.includes(slotId))return res.status(409).json({ok:false,error:"already_purchased",account:publicAccount(a)});
  const item=MATERIAL_CATALOG[listing.materialId];
  if(ensureGoldCubits(a)<item.price)return res.status(409).json({ok:false,error:"not_enough_cubits",cost:item.price,account:publicAccount(a)});
  setGoldCubits(a,ensureGoldCubits(a)-item.price); addMaterial(a,listing.materialId,1); bought.push(slotId);
  a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,listing:{...listing,purchased:true},account:publicAccount(a),rotationId:info.rotationId,nextRefreshAt:info.nextRefreshAt});
});
// Legacy direct purchase endpoint kept for older clients only. New builds use rotating stock slots.
app.post("/api/shop/buy-material", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a);
  const id=safeText(req.body?.id,32); const item=MATERIAL_CATALOG[id]; if(!item)return res.status(404).json({ok:false,error:"unknown_material"});
  if(ensureGoldCubits(a)<item.price)return res.status(409).json({ok:false,error:"not_enough_cubits",cost:item.price,account:publicAccount(a)});
  setGoldCubits(a,ensureGoldCubits(a)-item.price); addMaterial(a,id,1); a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,material:id,account:publicAccount(a)});
});
app.post("/api/build-starter", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a); const id=safeText(req.body?.id,32); const recipe=BUILD_RECIPES[id];
  if(!recipe)return res.status(404).json({ok:false,error:"unknown_recipe"}); if(a.craftedStarters.includes(id))return res.status(409).json({ok:false,error:"already_owned",account:publicAccount(a)});
  if(!hasIngredients(a,recipe.ingredients))return res.status(409).json({ok:false,error:"missing_materials",account:publicAccount(a)});
  consumeIngredients(a,recipe.ingredients); const success=Math.random()<recipe.chance; if(success)a.craftedStarters.push(id); a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,success,account:publicAccount(a)});
});
app.post("/api/learn-skill", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a); const id=safeText(req.body?.id,32); const recipe=LEARN_RECIPES[id];
  if(!recipe)return res.status(404).json({ok:false,error:"unknown_skill"}); if(a.learnedSkills.includes(id))return res.status(409).json({ok:false,error:"already_owned",account:publicAccount(a)});
  if(!hasIngredients(a,recipe.ingredients))return res.status(409).json({ok:false,error:"missing_materials",account:publicAccount(a)});
  consumeIngredients(a,recipe.ingredients); a.learnedSkills.push(id); a.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,account:publicAccount(a)});
});
app.post("/api/themes/buy", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
  const id=safeText(req.body?.themeId,40);
  if(!THEME_GOLD.has(id))return res.status(404).json({ok:false,error:"theme_not_for_sale"});
  if(a.unlockedThemes.includes(id))return res.json({ok:true,alreadyOwned:true,account:publicAccount(a)});
  const price=themeGoldPrice(id); if(ensureGoldCubits(a)<price)return res.status(409).json({ok:false,error:"not_enough_cubits",price,account:publicAccount(a)});
  setGoldCubits(a,ensureGoldCubits(a)-price); a.unlockedThemes.push(id); a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,themeId:id,price,account:publicAccount(a)});
});
app.post("/api/themes/ad-unlock", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
  const id=safeText(req.body?.themeId,40); if(!THEME_AD.has(id))return res.status(404).json({ok:false,error:"theme_not_ad_unlock"});
  if(a.unlockedThemes.includes(id))return res.json({ok:true,alreadyOwned:true,themeId:id,account:publicAccount(a)});
  const proof=verifyRewardedAdProof(a,req.body?.adProof,"theme",id); if(!proof.ok)return res.status(proof.status).json({ok:false,error:proof.error,rewardedAdsConfigured:REWARDED_ADS_CONFIGURED});
  consumeRewardedAdProof(a,proof); a.unlockedThemes.push(id); a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,themeId:id,account:publicAccount(a)});
});

app.post("/api/daily-cubits", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId];
  ensureRewardedDailyCubitMode(a);
  const day=utcDayKey();
  if(a.lastDailyCubits===day)return res.status(409).json({ok:false,error:"already_claimed",account:publicAccount(a)});
  const proof=verifyRewardedAdProof(a,req.body?.adProof,"dailyCubits",day);
  if(!proof.ok)return res.status(proof.status).json({ok:false,error:proof.error,rewardedAdsConfigured:REWARDED_ADS_CONFIGURED,account:publicAccount(a)});
  consumeRewardedAdProof(a,proof);
  addGoldCubits(a,HOSTL_DAILY_AD_CUBITS);
  a.lastDailyCubits=day;
  a.updatedAt=new Date().toISOString();
  await saveAccounts();
  res.json({ok:true,amount:HOSTL_DAILY_AD_CUBITS,account:publicAccount(a)});
});

app.post("/api/revive-authorization", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId];
  const method=safeText(req.body?.method,16).toLowerCase();
  const runId=safeText(req.body?.runId,96);
  if(!runId)return res.status(400).json({ok:false,error:"missing_run_id"});
  if(method==="ad"){
    const proof=verifyRewardedAdProof(a,req.body?.adProof,"revive",runId);
    if(!proof.ok)return res.status(proof.status).json({ok:false,error:proof.error,rewardedAdsConfigured:REWARDED_ADS_CONFIGURED,account:publicAccount(a)});
    consumeRewardedAdProof(a,proof);
  }else if(method==="cubits"){
    if(ensureGoldCubits(a)<HOSTL_CUBIT_REVIVE_COST)return res.status(409).json({ok:false,error:"not_enough_cubits",cost:HOSTL_CUBIT_REVIVE_COST,account:publicAccount(a)});
    setGoldCubits(a,ensureGoldCubits(a)-HOSTL_CUBIT_REVIVE_COST);
  }else return res.status(400).json({ok:false,error:"unknown_revive_method"});
  a.updatedAt=new Date().toISOString();
  await saveAccounts();
  const reviveToken=issueReviveAuthorization(a,method,runId);
  res.json({ok:true,method,cost:method==="cubits"?HOSTL_CUBIT_REVIVE_COST:0,reviveToken,account:publicAccount(a)});
});

app.post("/api/open-chest", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a); if(!a.speciesCards||typeof a.speciesCards!=="object")a.speciesCards={}; if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
  const kind=safeText(req.body?.kind,20).toLowerCase(); const daily=kind==="daily"; const forest=kind==="forest"; if(!daily&&!forest)return res.status(400).json({ok:false,error:"unknown_chest"});
  const day=new Date().toISOString().slice(0,10); const cost=forest?600:0; if(daily&&a.lastDailyChest===day)return res.status(409).json({ok:false,error:"already_claimed",account:publicAccount(a)});
  let adProof=null; if(daily){ adProof=verifyRewardedAdProof(a,req.body?.adProof,"dailyChest",day); if(!adProof.ok)return res.status(adProof.status).json({ok:false,error:adProof.error,rewardedAdsConfigured:REWARDED_ADS_CONFIGURED,account:publicAccount(a)}); }
  if(ensureGoldCubits(a)<cost)return res.status(409).json({ok:false,error:"not_enough_cubits",cost,account:publicAccount(a)}); if(cost)setGoldCubits(a,ensureGoldCubits(a)-cost);
  const rewards=[]; const rand=(lo,hi)=>lo+Math.floor(Math.random()*(hi-lo+1));
  const goldCubits=daily?rand(18,45):rand(260,620); addGoldCubits(a,goldCubits); rewards.push(`+${goldCubits} Gold Cubits`);
  const materialRolls=daily?rand(1,2):rand(2,4);
  const matRewards={}; for(let i=0;i<materialRolls;i++){const id=randomMaterialId(); const rarity=MATERIAL_CATALOG[id]?.rarity||"Common"; const qty=(rarity==="Common"||rarity==="Uncommon")?(daily?rand(1,2):rand(1,3)):1; addMaterial(a,id,qty); matRewards[id]=(matRewards[id]||0)+qty;}
  for(const [id,qty] of Object.entries(matRewards))rewards.push(`+${qty} ${MATERIAL_CATALOG[id].name}`);
  const species=randomChestSpecies(); const cards=daily?rand(3,8):rand(8,20); a.speciesCards[species]=Math.max(0,Math.floor(Number(a.speciesCards[species])||0)+cards); rewards.push(`+${cards} ${species.charAt(0).toUpperCase()+species.slice(1)} Cards`);
  const themeChance=daily?.10:.35; if(Math.random()<themeChance){const choices=CHEST_THEMES.filter(t=>!a.unlockedThemes.includes(t)); if(choices.length){const t=choices[rand(0,choices.length-1)];a.unlockedThemes.push(t);rewards.push(`${t} theme unlocked permanently`);}}
  if(daily){consumeRewardedAdProof(a,adProof);a.lastDailyChest=day;} a.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,rewards,account:publicAccount(a)});
});

app.post("/api/presence", requireAccount, (req,res)=>{ markWebPresence(req.hostlUserId); res.json({ok:true}); });
app.get("/api/friends", requireAccount, (req,res)=>{
  markWebPresence(req.hostlUserId);
  const a=ensureSocialState(accountDb.byId[req.hostlUserId]);
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true, account:publicAccount(a),
    friends:a.friends.map(friendPublicSummary).filter(Boolean),
    incoming:a.incomingFriendRequests.map(socialRequestSummary).filter(Boolean),
    outgoing:a.outgoingFriendRequests.map(socialRequestSummary).filter(Boolean)
  });
});
app.post("/api/friends/request", requireAccount, async (req,res)=>{
  const a=ensureSocialState(accountDb.byId[req.hostlUserId]); const targetId=String(req.body?.playerId||"").trim(); const b=accountDb.byId[targetId]?ensureSocialState(accountDb.byId[targetId]):null;
  if(!b)return res.status(404).json({ok:false,error:"player_not_found"}); if(targetId===a.userId)return res.status(400).json({ok:false,error:"cannot_friend_self"});
  if(a.friends.includes(targetId))return res.status(409).json({ok:false,error:"already_friends"});
  if(a.incomingFriendRequests.includes(targetId)){
    a.incomingFriendRequests=a.incomingFriendRequests.filter(x=>x!==targetId); b.outgoingFriendRequests=b.outgoingFriendRequests.filter(x=>x!==a.userId);
    if(!a.friends.includes(targetId))a.friends.push(targetId); if(!b.friends.includes(a.userId))b.friends.push(a.userId);
    await saveAccounts(); return res.json({ok:true,accepted:true,friend:friendPublicSummary(targetId)});
  }
  if(!a.outgoingFriendRequests.includes(targetId))a.outgoingFriendRequests.push(targetId); if(!b.incomingFriendRequests.includes(a.userId))b.incomingFriendRequests.push(a.userId);
  await saveAccounts(); res.json({ok:true,sent:true});
});
app.post("/api/friends/respond", requireAccount, async (req,res)=>{
  const a=ensureSocialState(accountDb.byId[req.hostlUserId]); const targetId=String(req.body?.playerId||"").trim(); const b=accountDb.byId[targetId]?ensureSocialState(accountDb.byId[targetId]):null;
  if(!b||!a.incomingFriendRequests.includes(targetId))return res.status(404).json({ok:false,error:"request_not_found"});
  a.incomingFriendRequests=a.incomingFriendRequests.filter(x=>x!==targetId); b.outgoingFriendRequests=b.outgoingFriendRequests.filter(x=>x!==a.userId);
  if(req.body?.accept){ if(!a.friends.includes(targetId))a.friends.push(targetId); if(!b.friends.includes(a.userId))b.friends.push(a.userId); }
  await saveAccounts(); res.json({ok:true,accepted:!!req.body?.accept});
});
app.delete("/api/friends/:id", requireAccount, async (req,res)=>{
  const a=ensureSocialState(accountDb.byId[req.hostlUserId]); const targetId=String(req.params.id||""); const b=accountDb.byId[targetId]?ensureSocialState(accountDb.byId[targetId]):null;
  a.friends=a.friends.filter(x=>x!==targetId); a.incomingFriendRequests=a.incomingFriendRequests.filter(x=>x!==targetId); a.outgoingFriendRequests=a.outgoingFriendRequests.filter(x=>x!==targetId);
  if(b){ b.friends=b.friends.filter(x=>x!==a.userId); b.incomingFriendRequests=b.incomingFriendRequests.filter(x=>x!==a.userId); b.outgoingFriendRequests=b.outgoingFriendRequests.filter(x=>x!==a.userId); }
  await saveAccounts(); res.json({ok:true});
});
app.get("/api/friends/chat/:id", requireAccount, (req,res)=>{
  const targetId=String(req.params.id||""); if(!areFriends(req.hostlUserId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  const key=friendChatKey(req.hostlUserId,targetId); const messages=Array.isArray(accountDb.friendChats[key])?accountDb.friendChats[key].slice(-100):[];
  res.setHeader("Cache-Control","no-store"); res.json({ok:true,messages});
});
app.post("/api/friends/chat/:id", requireAccount, async (req,res)=>{
  const targetId=String(req.params.id||""); if(!areFriends(req.hostlUserId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  let message=safeText(req.body?.message,240).replace(/[<>]/g,""); if(!message)return res.status(400).json({ok:false,error:"empty_message"});
  const key=friendChatKey(req.hostlUserId,targetId); if(!Array.isArray(accountDb.friendChats[key]))accountDb.friendChats[key]=[];
  const item={id:crypto.randomUUID(),from:req.hostlUserId,to:targetId,message,at:Date.now()}; accountDb.friendChats[key].push(item); accountDb.friendChats[key]=accountDb.friendChats[key].slice(-100); await saveAccounts(); res.json({ok:true,message:item});
});
app.post("/api/friends/gift", requireAccount, async (req,res)=>{
  const from=accountDb.byId[req.hostlUserId], targetId=String(req.body?.playerId||""); const to=accountDb.byId[targetId]; if(!to||!areFriends(from.userId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  const part=normalizedTransferPart(req.body||{}); if(part.goldCubits<=0&&part.cards<=0)return res.status(400).json({ok:false,error:"nothing_to_gift"}); if(!hasTransfer(from,part))return res.status(409).json({ok:false,error:"not_enough"});
  applyTransfer(from,to,part); from.updatedAt=to.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,account:publicAccount(from),friend:friendPublicSummary(targetId)});
});
app.get("/api/friends/trades", requireAccount, (req,res)=>{
  const uid=req.hostlUserId; const offers=Object.values(accountDb.tradeOffers||{}).filter(o=>o&&o.status==="pending"&&(o.from===uid||o.to===uid)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50);
  res.setHeader("Cache-Control","no-store"); res.json({ok:true,offers});
});
app.post("/api/friends/trade", requireAccount, async (req,res)=>{
  const from=accountDb.byId[req.hostlUserId], targetId=String(req.body?.playerId||""); if(!accountDb.byId[targetId]||!areFriends(from.userId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  const give=normalizedTransferPart(req.body?.give), want=normalizedTransferPart(req.body?.want); if(give.goldCubits<=0&&give.cards<=0&&want.goldCubits<=0&&want.cards<=0)return res.status(400).json({ok:false,error:"empty_trade"}); if(!hasTransfer(from,give))return res.status(409).json({ok:false,error:"not_enough"});
  const id=crypto.randomUUID(); const offer={id,from:from.userId,to:targetId,give,want,status:"pending",createdAt:Date.now()}; accountDb.tradeOffers[id]=offer; await saveAccounts(); res.json({ok:true,offer});
});
app.post("/api/friends/trade/:id/respond", requireAccount, async (req,res)=>{
  const offer=accountDb.tradeOffers?.[String(req.params.id||"")]; if(!offer||offer.status!=="pending"||offer.to!==req.hostlUserId)return res.status(404).json({ok:false,error:"trade_not_found"});
  if(!req.body?.accept){ offer.status="declined"; offer.closedAt=Date.now(); await saveAccounts(); return res.json({ok:true,accepted:false}); }
  const from=accountDb.byId[offer.from], to=accountDb.byId[offer.to]; if(!from||!to||!areFriends(from.userId,to.userId))return res.status(409).json({ok:false,error:"not_friends"}); if(!hasTransfer(from,offer.give)||!hasTransfer(to,offer.want))return res.status(409).json({ok:false,error:"trade_inventory_changed"});
  applyTransfer(from,to,offer.give); applyTransfer(to,from,offer.want); offer.status="accepted"; offer.closedAt=Date.now(); from.updatedAt=to.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,accepted:true,account:publicAccount(to)});
});

app.post("/api/redeem-code", requireAccount, async (req, res) => {
  const a = accountDb.byId[req.hostlUserId];
  const code = normalizePromoCode(req.body?.code);
  if (!code) return res.status(400).json({ ok:false, error:"missing_code" });
  const reward = PROMO_CODES.get(code);
  if (!reward) return res.status(404).json({ ok:false, error:"invalid_code" });
  const redeemed = ensureRedeemedCodes(a);
  if (redeemed.includes(code)) {
    const repaired=repairSpecialPromoEntitlements(a);
    if(repaired){a.updatedAt=new Date().toISOString();await saveAccounts();}
    return res.status(409).json({ ok:false, error:"already_redeemed", repaired, account:publicAccount(a) });
  }
  if (!accountDb.globalCodeClaims || typeof accountDb.globalCodeClaims !== "object") accountDb.globalCodeClaims = {};
  const existingGlobalClaim = accountDb.globalCodeClaims[code];
  if (reward.globalOnce && existingGlobalClaim && existingGlobalClaim !== a.userId) return res.status(409).json({ ok:false, error:"code_already_claimed" });

  applyPromoRewardThroughNormalSystems(a,reward);
  // A newly redeemed OVCC already received these rewards above. Mark the repair
  // versions now so a later login does not mistake the old broken-code repair for
  // an unpaid reward and grant the 10,000 Cubits a second time.
  if(code==="OVCC" || code==="OVCC2"){
    if(!a.specialRewardRepairs || typeof a.specialRewardRepairs!=="object" || Array.isArray(a.specialRewardRepairs))a.specialRewardRepairs={};
    a.specialRewardRepairs.ovccGoldCubits10000V1=Date.now();
    a.specialRewardRepairs.ovccViperCards500V1=Date.now();
    a.specialRewardRepairs.ovccViperNormalUnlockV4=a.specialRewardRepairs.ovccViperNormalUnlockV4||Date.now();
  }
  // Mark/repair special pet rewards idempotently. This also repairs older tester/owner claims.
  repairSpecialPromoEntitlements(a);
  if (reward.globalOnce) accountDb.globalCodeClaims[code]=a.userId;
  redeemed.push(code);
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  res.json({ ok:true, code, message:`Code redeemed: ${reward.label || "reward added"}.`, account:publicAccount(a) });
});

async function rewardTesterKill(accountId) {
  const a = accountDb.byId[String(accountId || "")];
  if (!a) return { granted:false, reason:"account_missing" };
  if (!a.achievements || typeof a.achievements !== "object") a.achievements = {};
  const achievementId = "tester_hunter_1";
  if (a.achievements[achievementId]) return { granted:false, account:publicAccount(a) };
  const goldCubits = 3000, saberCards = 100;
  addGoldCubits(a, goldCubits);
  if (!a.speciesCards || typeof a.speciesCards !== "object") a.speciesCards = {};
  a.speciesCards.saber = Math.max(0, Math.floor(Number(a.speciesCards.saber)||0) + saberCards);
  const rewardSummary = `+${goldCubits.toLocaleString()} Gold Cubits · +${saberCards} Saber Cards`;
  a.achievements[achievementId] = { at:Date.now(), species:"saber", rewardSummary, serverVerified:true };
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  return { granted:true, rewardSummary, goldCubits, saberCards, account:publicAccount(a) };
}

async function rewardOwnerKill(accountId) {
  const a = accountDb.byId[String(accountId || "")];
  if (!a) return { granted:false, reason:"account_missing" };
  if (!a.achievements || typeof a.achievements !== "object") a.achievements = {};
  const achievementId = "owner_hunter_1";
  if (a.achievements[achievementId]) return { granted:false, account:publicAccount(a) };
  const goldCubits = 7500, viperCards = 250;
  addGoldCubits(a, goldCubits);
  if (!a.speciesCards || typeof a.speciesCards !== "object") a.speciesCards = {};
  a.speciesCards.snake = Math.max(0, Math.floor(Number(a.speciesCards.snake)||0) + viperCards);
  const rewardSummary = `+${goldCubits.toLocaleString()} Gold Cubits · +${viperCards} Viper Cards`;
  a.achievements[achievementId] = { at:Date.now(), species:"snake", rewardSummary, serverVerified:true };
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  return { granted:true, rewardSummary, goldCubits, viperCards, account:publicAccount(a) };
}

function verifiedAchievementReward(id,context={}){
  const species=safeText(context?.species,24).toLowerCase();
  if(id==="first_tame")return {goldCubits:20,cards:2,species};
  if(id==="first_death")return {goldCubits:8};
  if(id==="moonmark_hunter")return {goldCubits:100};
  if(id==="survive_5")return {goldCubits:35};
  if(id==="survive_night")return {goldCubits:25};
  if(id==="survive_10")return {goldCubits:60};
  if(id==="tame_all")return {goldCubits:150};
  if(id==="breed_three")return {goldCubits:50};
  if(id.startsWith("tame_")&&ACCOUNT_PET_TYPES.has(id.slice(5)))return {goldCubits:10,cards:4,species:id.slice(5)};
  if(id.startsWith("breed_")&&ACCOUNT_PET_TYPES.has(id.slice(6)))return {goldCubits:12,cards:6,species:id.slice(6)};
  return null;
}
function applyVerifiedAchievement(a,id,context={}){
  if(!a.achievements||typeof a.achievements!=="object"||Array.isArray(a.achievements))a.achievements={};
  if(a.achievements[id])return null;
  const reward=verifiedAchievementReward(id,context); if(!reward)return null;
  if(reward.goldCubits)addGoldCubits(a,reward.goldCubits);
  if(reward.cards&&reward.species){ensurePetProgressState(a);a.speciesCards[reward.species]=Math.max(0,Math.floor(Number(a.speciesCards[reward.species])||0)+reward.cards);}
  const bits=[];if(reward.goldCubits)bits.push(`+${reward.goldCubits} Gold Cubits`);if(reward.cards&&reward.species)bits.push(`+${reward.cards} ${reward.species} Cards`);
  const record={at:Date.now(),species:safeText(context?.species||reward.species||"",24).toLowerCase(),rewardSummary:bits.join(" · ")||"Achievement unlocked",serverVerified:true};
  a.achievements[id]=record;return {id,rewardSummary:record.rewardSummary,species:record.species};
}
async function recordVerifiedAchievement(userId,id,context={}){
  const a=accountDb.byId[String(userId||"")];if(!a)return {granted:false};
  ensurePetProgressState(a);const granted=[];const primary=applyVerifiedAchievement(a,safeText(id,64),context);if(primary)granted.push(primary);
  const sid=safeText(id,64);
  if(sid.startsWith("tame_")&&sid!=="tame_all"){
    const all=[...ACCOUNT_PET_TYPES].every(sp=>!!a.achievements[`tame_${sp}`]);if(all){const bonus=applyVerifiedAchievement(a,"tame_all",{});if(bonus)granted.push(bonus);}
  }
  if(sid.startsWith("breed_")&&sid!=="breed_three"){
    const n=[...ACCOUNT_PET_TYPES].filter(sp=>!!a.achievements[`breed_${sp}`]).length;if(n>=3){const bonus=applyVerifiedAchievement(a,"breed_three",{});if(bonus)granted.push(bonus);}
  }
  if(!granted.length)return {granted:false,account:publicAccount(a)};
  a.updatedAt=new Date().toISOString();await saveAccounts();return {granted:true,achievements:granted,account:publicAccount(a)};
}

async function grantWorldAccountReward(userId,reward,source={}){
  const a=accountDb.byId[String(userId||"")]; if(!a||!reward||typeof reward!=="object")return {granted:false};
  ensurePetProgressState(a); let changed=false;
  if(reward.kind==="goldCubits"){
    const amount=Math.max(0,Math.min(10000,Math.floor(Number(reward.amount)||0))); if(amount>0){addGoldCubits(a,amount);changed=true;}
  }else if(reward.kind==="cards"){
    const species=safeText(reward.species,24).toLowerCase(),amount=Math.max(0,Math.min(500,Math.floor(Number(reward.amount)||0)));
    if(ACCOUNT_PET_TYPES.has(species)&&amount>0){a.speciesCards[species]=Math.max(0,Math.floor(Number(a.speciesCards[species])||0)+amount);changed=true;}
  }
  if(!changed)return {granted:false}; a.updatedAt=new Date().toISOString(); await saveAccounts();
  return {granted:true,reward:{...reward},source,account:publicAccount(a)};
}

configureHostlAccountHooks({
  resolveSession(token) {
    const uid = verifySession(token);
    if (!uid) return null;
    const a = accountDb.byId[uid];
    if (!a) return null;
    ensurePetProgressState(a); ensureStarterPetEntitlements(a);
    return { userId:uid, username:a.username||"", title:a.title||"", testerRank:Math.max(0,Math.floor(Number(a.testerRank)||0)), ownerRank:Math.max(0,Math.floor(Number(a.ownerRank)||0)),
      petStatUpgrades:JSON.parse(JSON.stringify(a.petStatUpgrades||{})), petStages:Object.fromEntries([...ACCOUNT_PET_TYPES].map(type=>[type,accountStarterStage(a,type)])), ownedStarters:{...(a.ownedStarters||{})},
      starterPetEntitlements:(a.starterPetEntitlements||[]).map(x=>({...x})), starterPetType:a.starterPetType||"", starterPetName:a.starterPetName||"", starterPetGender:a.starterPetGender||"Male" };
  },
  refreshAccount(userId) {
    const uid=String(userId||"");
    const a=accountDb.byId[uid];
    if(!a)return null;
    ensurePetProgressState(a); ensureStarterPetEntitlements(a);
    return { userId:uid, username:a.username||"", title:a.title||"", testerRank:Math.max(0,Math.floor(Number(a.testerRank)||0)), ownerRank:Math.max(0,Math.floor(Number(a.ownerRank)||0)),
      petStatUpgrades:JSON.parse(JSON.stringify(a.petStatUpgrades||{})), petStages:Object.fromEntries([...ACCOUNT_PET_TYPES].map(type=>[type,accountStarterStage(a,type)])), ownedStarters:{...(a.ownedStarters||{})},
      starterPetEntitlements:(a.starterPetEntitlements||[]).map(x=>({...x})), starterPetType:a.starterPetType||"", starterPetName:a.starterPetName||"", starterPetGender:a.starterPetGender||"Male" };
  },
  rewardTesterKill,
  rewardOwnerKill,
  rewardGameplayMaterial,
  grantWorldReward:grantWorldAccountReward,
  recordAchievement:recordVerifiedAchievement,
  consumeReviveAuthorization(userId,token){ return consumeReviveAuthorization(userId,token); },
  onPresenceJoin(userId,key,worldId){ markGamePresence(userId,key,worldId); },
  onPresenceLeave(userId,key){ clearGamePresence(userId,key); }
});

app.delete("/api/account", requireAccount, async (req, res) => {
  const a = accountDb.byId[req.hostlUserId];
  if (a?.googleSub) delete accountDb.byGoogleSub[a.googleSub];
  if(a){ ensureSocialState(a); for(const fid of a.friends){ const f=accountDb.byId[fid]; if(f){ ensureSocialState(f); f.friends=f.friends.filter(x=>x!==a.userId); f.incomingFriendRequests=f.incomingFriendRequests.filter(x=>x!==a.userId); f.outgoingFriendRequests=f.outgoingFriendRequests.filter(x=>x!==a.userId); } } }
  for(const [id,o] of Object.entries(accountDb.tradeOffers||{})){ if(o?.from===req.hostlUserId||o?.to===req.hostlUserId) delete accountDb.tradeOffers[id]; }
  for(const key of Object.keys(accountDb.friendChats||{})){ if(key.split(":").includes(req.hostlUserId)) delete accountDb.friendChats[key]; }
  WEB_PRESENCE.delete(req.hostlUserId); GAME_PRESENCE.delete(req.hostlUserId);
  delete accountDb.byId[req.hostlUserId];
  await saveAccounts();
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.redirect("/index.html?server=self");
});
app.use(express.static(publicDir, { index: false, maxAge: 0, etag: false, setHeaders(res){ res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate"); } }));

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("world", WorldRoom).filterBy(["worldId"]);
await gameServer.listen(port);

console.log(`HOSTL multiplayer listening on port ${port}`);
console.log(`Local game: http://localhost:${port}`);
console.log("On Render, open the service's HTTPS URL. The game auto-connects with WSS.");
