// WorldRoom.js
// HOSTL full multiplayer room.
// Server-authoritative shared world: resources, gold, chests, wildlife, pets,
// hostile cubes, walls, towers, projectiles, combat, taming, and day/night.

import { Room } from "@colyseus/core";
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

const WORLD_W = 84000;
const WORLD_H = 70000;
const PLAYER_R = 18;
const GRID_CELL = 192;
const TAU = Math.PI * 2;
const THROW_AXE_RANGE=560, THROW_AXE_SPEED=590, THROW_AXE_RETURN_SPEED=680, THROW_AXE_LIFE=3.0;
const THROW_AXE_RETURN_AT=THROW_AXE_LIFE-(THROW_AXE_RANGE/THROW_AXE_SPEED);
const CREATURE_DYNAMIC_KINDS = new Set(["animal","pet"]);
const CUBE_SHARED_RULES_VERSION = "745";
function biomeBaseId(id){return String(id||"forest").replace(/_edge$/g,"")||"forest";}
let HOSTL_ACCOUNT_HOOKS = { resolveSession: () => null, refreshAccount: () => null, rewardTesterKill: async () => ({ granted:false }), rewardOwnerKill: async () => ({ granted:false }), rewardGameplayMaterial: async () => ({ granted:false }), grantWorldReward: async () => ({ granted:false }), recordAchievement: async () => ({ granted:false }), consumeReviveAuthorization: () => null, onPresenceJoin:()=>{}, onPresenceLeave:()=>{} };
export function configureHostlAccountHooks(hooks={}) {
  if (typeof hooks.resolveSession === "function") HOSTL_ACCOUNT_HOOKS.resolveSession = hooks.resolveSession;
  if (typeof hooks.refreshAccount === "function") HOSTL_ACCOUNT_HOOKS.refreshAccount = hooks.refreshAccount;
  if (typeof hooks.rewardTesterKill === "function") HOSTL_ACCOUNT_HOOKS.rewardTesterKill = hooks.rewardTesterKill;
  if (typeof hooks.rewardOwnerKill === "function") HOSTL_ACCOUNT_HOOKS.rewardOwnerKill = hooks.rewardOwnerKill;
  if (typeof hooks.rewardGameplayMaterial === "function") HOSTL_ACCOUNT_HOOKS.rewardGameplayMaterial = hooks.rewardGameplayMaterial;
  if (typeof hooks.grantWorldReward === "function") HOSTL_ACCOUNT_HOOKS.grantWorldReward = hooks.grantWorldReward;
  if (typeof hooks.recordAchievement === "function") HOSTL_ACCOUNT_HOOKS.recordAchievement = hooks.recordAchievement;
  if (typeof hooks.consumeReviveAuthorization === "function") HOSTL_ACCOUNT_HOOKS.consumeReviveAuthorization = hooks.consumeReviveAuthorization;
  if (typeof hooks.onPresenceJoin === "function") HOSTL_ACCOUNT_HOOKS.onPresenceJoin = hooks.onPresenceJoin;
  if (typeof hooks.onPresenceLeave === "function") HOSTL_ACCOUNT_HOOKS.onPresenceLeave = hooks.onPresenceLeave;
}


// ---------- Game 388 multiplayer chat safety ----------

// Invisible duplicate hitboxes traced from the same five uploaded biome rock SVG silhouettes.
// Keep this geometry in sync with the browser client so multiplayer correction never
// snaps a player back to the old oversized circular rock collision.
const BASIC_ROCK_HITBOX_POLYS = Object.freeze({
  forest:[[8.17,-24.04],[-14.45,-18.42],[-26.58,-1.67],[-8.58,22.33],[19.92,15.08],[26.67,-10.67]],
  rainforest:[[18.56,-19.38],[8.18,-23.13],[-5.69,-22.88],[-14.69,-17.50],[-22.32,-15.88],[-26.57,-0.38],[-19.94,13.00],[-8.82,23.00],[5.56,22.75],[19.68,15.87],[25.68,4.62],[26.43,-9.75]],
  mountains:[[-11.53,-26.39],[-23.90,-10.89],[-28.15,2.49],[-15.28,20.49],[3.10,27.61],[26.10,16.49],[28.85,-7.39],[17.72,-22.26]],
  desert:[[-32.77,2.86],[-17.64,15.99],[-8.39,15.86],[7.23,22.11],[18.98,21.24],[23.73,18.24],[26.48,-5.51],[16.73,-20.76],[11.11,-14.39],[3.36,-23.14],[-14.02,-24.51],[-22.77,-7.89]],
  arctic:[[9.43,-29.23],[3.56,-23.36],[-10.07,-25.48],[-22.19,-11.36],[-26.94,2.64],[-15.94,14.39],[-11.82,30.02],[0.43,27.14],[17.93,27.14],[25.68,16.64],[21.93,9.89],[23.93,-14.48]]
});
function rockPointInsidePoly(px,py,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/((yj-yi)||1e-9)+xi))inside=!inside;}return inside;}
function rockCirclePolyPenetration(cx,cy,cr,poly){let bestD2=Infinity,bx=0,by=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],vx=b[0]-a[0],vy=b[1]-a[1],den=vx*vx+vy*vy,t=den>1e-9?clamp(((cx-a[0])*vx+(cy-a[1])*vy)/den,0,1):0,qx=a[0]+vx*t,qy=a[1]+vy*t,dx=cx-qx,dy=cy-qy,d2=dx*dx+dy*dy;if(d2<bestD2){bestD2=d2;bx=qx;by=qy;}}const inside=rockPointInsidePoly(cx,cy,poly),d=Math.sqrt(Math.max(0,bestD2));if(!inside&&d>=cr)return null;let nx=1,ny=0,overlap=0;if(inside){if(d>1e-6){nx=(bx-cx)/d;ny=(by-cy)/d;}overlap=cr+d;}else{if(d>1e-6){nx=(cx-bx)/d;ny=(cy-by)/d;}overlap=cr-d;}return{nx,ny,overlap:Math.max(0,overlap),distance:d,inside};}
function basicRockCirclePenetration(r,x,y,radius=0){if(!r||r.type!=="rock")return null;const poly=BASIC_ROCK_HITBOX_POLYS[biomeBaseId(worldBiomeAt(r.x,r.y))];if(!poly)return null;const sc=Math.max(.01,Number(r.scale)||1),p=rockCirclePolyPenetration((x-r.x)/sc,(y-r.y)/sc,Math.max(0,Number(radius)||0)/sc,poly);return p?{nx:p.nx,ny:p.ny,overlap:p.overlap*sc,distance:p.distance*sc,inside:p.inside}:null;}
function basicRockBoundRadius(r){if(!r||r.type!=="rock")return Math.max(8,Number(r?.solidR)||12);return 34*Math.max(.01,Number(r.scale)||1);}

const CHAT_MAX_LENGTH = 120;
const CHAT_COOLDOWN_MS = 650;

// Chat is intentionally stricter than player display names.
// This protects the public chat without removing player names from the game.
const CHAT_BLOCKED_WORDS = [
  "fuck","fucker","fucking","shit","bullshit","bitch","bitches","asshole","ass",
  "dick","cock","pussy","cunt","motherfucker","nigger","nigga","faggot",
  "retard","whore","slut","bum",
  // Requested phonetic / workaround spellings.
  "ahh","fuh","fah","greened","dih","puh"
];

const CHAT_BLOCKED_SOCIALS = [
  "discord","disscord","dischord",
  "snapchat","snap",
  "instagram","insta",
  "tiktok",
  "telegram",
  "whatsapp",
  "signal",
  "kik",
  "facebook",
  "messenger",
  "twitter",
  "reddit",
  "youtube",
  "twitch",
  "steam",
  "roblox",
  "guilded",
  "revolt",
  "bereal",
  "wechat",
  "lineapp",
  "viber",
  "groupme",
  "skype",
  "teamspeak",
  "yubo",
  "hoop",
  "wink",
  "meetme"
];

const CHAT_BLOCKED_CHAT_TERMS = [
  "username","user name","user-name",
  "handle","gamertag","gamer tag",
  "email","e mail","e-mail",
  "gmail","outlook","hotmail","protonmail",
  "phone number","phone #","cell number",
  "private chat","private message",
  "dm me","d m me","pm me","p m me",
  "message me","text me","call me",
  "add me","follow me","contact me",
  "find me on","talk to me on","chat with me on",
  "my snap","your snap","my insta","your insta",
  "my discord","your discord","my telegram","your telegram",
  "send me your","give me your",
  "what is your username","whats your username","what's your username",
  "what is your user name","whats your user name","what's your user name",
  "real name","full name",
  "where do you live","what city do you live","what state do you live",
  "how old are you","what age are you","what is your age",
  "send a pic","send pic","send a photo","send photo",
  "meet up","meet in real life","meet irl"
];

// Sexual / adult-content terms get their own stricter category.
// These are blocked even when they are not conventional curse words.
const CHAT_BLOCKED_SEXUAL_TERMS = [
  "porn","porno","pornography","pornographic",
  "xxx","nsfw","adult content","adult site","adult video","adult videos",
  "hentai","rule34","rule 34","r34",
  "nude","nudes","naked","nudity",
  "sex","sexual","sexy","sext","sexting","sextortion",
  "erotic","erotica","horny",
  "onlyfans","fansly","pornhub","xvideos","xnxx","redtube","youporn",
  "camgirl","cam boy","camboy","webcam sex","sex cam",
  "strip","stripper","stripping",
  "fetish","kink","bdsm",
  "boob","boobs","breast","breasts","tits","tit",
  "penis","vagina","vulva","anus","anal",
  "dildo","vibrator",
  "blowjob","handjob","rimjob",
  "orgasm","cum","semen",
  "masturbate","masturbation","jerk off",
  "69","sixty nine",
  "send nudes","send nude","send naked","send sexy",
  "show me your body","show your body","take your clothes off",
  "take off your clothes","what are you wearing",
  "sexual roleplay","sex roleplay","erp","erotic roleplay"
];

// Terms and patterns that commonly signal grooming, sextortion, or attempts
// to get private sexual material/contact. These are intentionally strict.
const CHAT_BLOCKED_GROOMING_TERMS = [
  "keep this secret","dont tell your parents","don't tell your parents",
  "dont tell your mom","don't tell your mom",
  "dont tell your dad","don't tell your dad",
  "our secret","between us","no one has to know",
  "prove you trust me","if you love me","if you trust me",
  "send another pic","send another photo",
  "send me a picture","send me a photo",
  "send me a video","send a video",
  "turn on your camera","turn your camera on",
  "video call me","facetime me",
  "are you alone","home alone","parents home",
  "meet me","come meet me","meet in person","meet irl",
  "hotel","motel","pick you up",
  "ill pay you","i'll pay you","pay you for pics","pay for pics",
  "gift card for pics","money for pics",
  "delete the messages","delete this chat","clear the chat"
];

// Extra off-platform / identity services and adult-content sites.
// Keeping these separate makes it easy to expand without touching display names.
const CHAT_BLOCKED_SITE_TERMS = [
  "omegle","ome tv","ometv","chatroulette","monkey app","monkeyapp",
  "onlyfans","fansly","pornhub","xvideos","xnxx","redtube","youporn",
  "discord","snapchat","instagram","tiktok","telegram","whatsapp",
  "signal","kik","facebook","messenger","twitter","x dot com",
  "reddit","youtube","twitch","steam","roblox","guilded","revolt",
  "bereal","wechat","line","viber","groupme","skype","teamspeak",
  "yubo","hoop","wink","meetme"
];

// Brainrot / meme-slang category.
// Kept separate from profanity and safety categories so it can be maintained independently.
const CHAT_BLOCKED_BRAINROT_TERMS = [
  "brainrot","brain rot",
  "skibidi","skibidi toilet",
  "rizz","w rizz","l rizz","unspoken rizz",
  "gyat","gyatt",
  "sigma grindset","what the sigma","sigma boy",
  "fanum","fanum tax","fanum taxed",
  "only in ohio","ohio final boss",
  "mewing",
  "looksmaxxing","looks maxxing","looksmax",
  "67","6 7","6-7","six seven","six-seven",
  "huzz",
  "crash out","crashout",
  "delulu",
  "low taper fade","taper fade meme",
  "mogging","mogged",
  "gooning",
  "glazing","glazer",
  "ratioed",
  "grimace shake",
  "baby gronk","livvy dunne",
  "kai cenat","ishowspeed",
  "rizzler",
  "goofy ahh","goofy ah",
  "opium bird",
  "smurf cat",
  "sticking out your gyat",
  "goon",
  "sigma",
  "beta male",
  "alpha male"
];



function chatAsciiFold(value) {
  return String(value || "")
    // Remove invisible formatting characters commonly used to split words.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Common Greek/Cyrillic lookalikes.
    .replace(/[аɑα]/g, "a")
    .replace(/[еε]/g, "e")
    .replace(/[іι]/g, "i")
    .replace(/[оο]/g, "o")
    .replace(/[рρ]/g, "p")
    .replace(/[сϲ]/g, "c")
    .replace(/[хχ]/g, "x")
    .replace(/[уγ]/g, "y")
    .replace(/[кκ]/g, "k")
    .replace(/[мμ]/g, "m")
    .replace(/[н]/g, "h")
    .replace(/[тτ]/g, "t");
}

function normalizeChatForFilter(value) {
  return chatAsciiFold(value)
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[7+]/g, "t")
    .replace(/[8]/g, "b")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactChatForFilter(value) {
  return normalizeChatForFilter(value).replace(/\s+/g, "");
}

function collapseChatRepeats(value) {
  return String(value || "").replace(/([a-z0-9])\1{1,}/g, "$1");
}

function chatForms(value) {
  const spaced = normalizeChatForFilter(value);
  const compact = spaced.replace(/\s+/g, "");
  return {
    spaced,
    compact,
    collapsedSpaced: collapseChatRepeats(spaced),
    collapsedCompact: collapseChatRepeats(compact)
  };
}

function escapedRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function chatTokenList(value) {
  return normalizeChatForFilter(value).split(/\s+/).filter(Boolean);
}

function limitedEditDistance(a, b, limit = 1) {
  a = String(a || "");
  b = String(b || "");
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a === b) return 0;
  const prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j < cur.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function chatTermMatches(value, term, fuzzy = false) {
  const forms = chatForms(value);
  const normalizedTerm = normalizeChatForFilter(term);
  if (!normalizedTerm) return false;

  const compactTerm = normalizedTerm.replace(/\s+/g, "");
  const collapsedTerm = collapseChatRepeats(compactTerm);

  if (forms.spaced.includes(normalizedTerm)) return true;
  if (forms.collapsedSpaced.includes(collapseChatRepeats(normalizedTerm))) return true;
  if (compactTerm.length >= 4 && forms.compact.includes(compactTerm)) return true;
  if (collapsedTerm.length >= 4 && forms.collapsedCompact.includes(collapsedTerm)) return true;

  // Catch f.u.c.k / p o r n / n-s-f-w and similar inserted separators.
  if (compactTerm.length >= 3) {
    const splitPattern = new RegExp(compactTerm.split("").map(escapedRegex).join("\\s*"));
    if (splitPattern.test(forms.spaced.replace(/\s+/g, " "))) return true;
  }

  // Small edit-distance matching catches one-character substitutions/deletions
  // and two edits on long high-risk terms without trying to fuzzy-match every word.
  if (fuzzy && compactTerm.length >= 5) {
    const limit = compactTerm.length >= 9 ? 2 : 1;
    const tokens = chatTokenList(value);
    const candidates = new Set([
      ...tokens,
      ...tokens.map(collapseChatRepeats),
      forms.compact,
      forms.collapsedCompact
    ]);
    for (const candidate of candidates) {
      if (candidate.length < 4) continue;
      if (limitedEditDistance(candidate, compactTerm, limit) <= limit) return true;
    }
  }
  return false;
}

function chatHasSexualContent(value) {
  return CHAT_BLOCKED_SEXUAL_TERMS.some(term => chatTermMatches(value, term, true));
}

function chatHasGroomingContent(value) {
  return CHAT_BLOCKED_GROOMING_TERMS.some(term => chatTermMatches(value, term, true));
}

function chatHasBlockedSite(value) {
  return CHAT_BLOCKED_SITE_TERMS.some(term => chatTermMatches(value, term, true));
}

function chatHasBlockedWord(value) {
  return CHAT_BLOCKED_WORDS.some(word => {
    const compact = compactChatForFilter(word);
    // Short terms can create false positives inside innocent words, so keep them exact.
    if (compact.length < 4) {
      const forms = chatForms(value);
      return forms.spaced.split(/\s+/).includes(compact) ||
             forms.collapsedSpaced.split(/\s+/).includes(collapseChatRepeats(compact));
    }
    return chatTermMatches(value, word, true);
  });
}

function chatHasBlockedSocial(value) {
  return CHAT_BLOCKED_SOCIALS.some(name => chatTermMatches(value, name, true)) ||
         chatHasBlockedSite(value);
}

function chatHasBlockedContactPhrase(value) {
  const forms = chatForms(value);
  return CHAT_BLOCKED_CHAT_TERMS.some(term => {
    const t = normalizeChatForFilter(term);
    if (!t) return false;
    if (forms.spaced.includes(t) || forms.collapsedSpaced.includes(collapseChatRepeats(t))) return true;
    const tc = t.replace(/\s+/g, "");
    return tc.length >= 5 &&
      (forms.compact.includes(tc) || forms.collapsedCompact.includes(collapseChatRepeats(tc)));
  });
}

function chatHasLinkOrContact(value) {
  const raw = chatAsciiFold(value).trim();
  const normalized = normalizeChatForFilter(value);
  const squashed = raw.replace(/\s+/g, "");
  const compact = compactChatForFilter(value);

  // URLs / domains / invites.
  if (/\b(?:https?|ftp)\s*:\s*\/\//i.test(raw)) return true;
  if (/\bwww\s*(?:\.|dot)\s*/i.test(raw)) return true;
  if (/\b(?:discord\s*(?:\.|dot)\s*gg|discord\s*(?:\.|dot)\s*com\s*\/\s*invite|t\s*(?:\.|dot)\s*me|youtu\s*(?:\.|dot)\s*be)\b/i.test(raw)) return true;
  if (/\b[a-z0-9][a-z0-9-]{0,62}\s*(?:\.|\bdot\b|\bd0t\b)\s*(?:com|net|org|gg|io|co|app|dev|me|tv|xyz|us|uk|ca|edu|gov)\b/i.test(raw)) return true;

  // Email / handles / IPv4 / likely phone numbers.
  if (/\b[a-z0-9._%+-]+\s*@\s*[a-z0-9.-]+\s*(?:\.|\bdot\b)\s*[a-z]{2,}\b/i.test(raw)) return true;
  if (/@/.test(raw)) return true;
  if (/\b(?:\d{1,3}\s*\.\s*){3}\d{1,3}(?::\d{2,5})?\b/.test(raw)) return true;
  if (/(?:^|\D)(?:\+?\d[\s().-]*){7,15}(?:\D|$)/.test(raw)) return true;

  // Spoken / disguised URL pieces.
  if (/\b(?:dot|d0t|period)\s+(?:com|net|org|gg|io|co|app|dev|me|tv|xyz)\b/i.test(normalized)) return true;
  if (/\b(?:slash|forward slash)\s+(?:invite|join)\b/i.test(normalized)) return true;
  // Common written-out contact/address evasions.
  if (/\b(?:at|at sign)\s+[a-z0-9._-]+\s+(?:dot|d0t|period)\s+[a-z]{2,}\b/i.test(normalized)) return true;
  if (/\b(?:my|add|follow|message|dm|text)\s+[a-z0-9._-]{2,}\s+(?:on|at)\b/i.test(normalized)) return true;
  // Long digit strings with separators or number words often represent phone/contact info.
  if (/(?:^|\D)(?:\d[\s()._\-]*){6,16}(?:\D|$)/.test(raw)) return true;
  if (/\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)){5,}\b/i.test(normalized)) return true;
  // "dotcom", "d0tcom", etc. after normalization.
  if (/(?:dot|d0t)(?:com|net|org|gg|io|co|app|dev|me|tv|xyz)/i.test(compact)) return true;

  return false;
}


function chatHasBrainrot(value) {
  return CHAT_BLOCKED_BRAINROT_TERMS.some(term => chatTermMatches(value, term, true));
}

function chatBlockReason(value) {
  // HOSTL public chat blocks profanity/sexual terms/brainrot, plus links and off-platform socials.
  // Allowed exceptions include: aura, aura farming, unc, and gg.
  if (chatHasSexualContent(value)) return "sexual/adult content";
  if (chatHasBrainrot(value)) return "brainrot/meme slang";
  if (chatHasLinkOrContact(value)) return "links/contact info";
  if (chatHasBlockedSocial(value)) return "social apps/sites";
  if (chatHasBlockedWord(value)) return "language";
  return "";
}

function chatHasLink(value) {
  return chatHasLinkOrContact(value) || chatHasBlockedSocial(value) || chatHasBlockedContactPhrase(value);
}

function cleanChatText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}


function safeChatUsername(value) {
  const name = cleanChatText(value).slice(0, 14) || "Cube";
  return (
    chatHasSexualContent(name) ||
    chatHasBlockedWord(name)
  ) ? "Cube" : name;
}


const TIME_PHASES = [
  { name: "Day", duration: 120, safe: true,  spawn: false, strong: false },
  { name: "Dawn", duration: 48,  safe: false, spawn: true,  strong: false },
  { name: "Night", duration: 70,  safe: false, spawn: true,  strong: false },
  { name: "Midnight", duration: 36, safe: false, spawn: true, strong: true },
  { name: "Morning", duration: 14, safe: true, spawn: false, strong: false },
];

function chooseHostlRole(phaseName){
  const roll=Math.random();
  if(phaseName==="Dawn")return roll<.55?"Swordsman":"Brawler";
  if(phaseName==="Night")return roll<.28?"Swordsman":roll<.46?"Brawler":roll<.72?"Rider":"Tamer";
  if(phaseName==="Midnight")return roll<.16?"Swordsman":roll<.26?"Brawler":roll<.42?"Rider":roll<.58?"Tamer":roll<.80?"Ranger":"Chimest";
  return roll<.55?"Swordsman":"Brawler";
}

const PET_TYPES = {
  dog:    { baseSpeed: 78, friendly: true,  flee: false, sizeMul: 1.15, color: "#c9a06a", abilityCd: 14, elem: "Stone", coats:["#c9a06a","#8b6914","#e8d5b7","#5c4033","#d2b48c"] },
  cat:    { baseSpeed: 72, friendly: true,  flee: true,  sizeMul: 1.00, color: "#e8b8a0", abilityCd: 12, elem: "Sound", coats:["#e8b8a0","#f5d0a9","#c4a882","#8b7355","#f0e6d2"] },
  dragon: { baseSpeed: 38, friendly: true,  flee: true,  sizeMul: 1.05, color: "#d4a050", abilityCd: 16, elem: "Fire", coats:["#d4a050","#c4783a","#e8b86d","#a06030"] },
  fox:    { baseSpeed: 92, friendly: true,  flee: false, sizeMul: 1.08, color: "#e07a40", abilityCd: 13, elem: "Lightning", coats:["#e07a40","#d4652a","#f09550","#c85820"] },
  wolf:   { baseSpeed: 88, friendly: false, flee: false, sizeMul: 1.35, color: "#7a8a9a", abilityCd: 15, elem: "Ice", coats:["#7a8a9a","#9aa8b5","#5a6a7a","#b0bcc8","#4a5560"] },
  bear:   { baseSpeed: 48, friendly: false, flee: false, sizeMul: 1.55, color: "#8a6040", abilityCd: 17, elem: "Water", coats:["#8a6040","#6b4423","#a07850","#5c3a1e","#c4a882"] },
  rabbit: { baseSpeed: 108, friendly: true,  flee: true,  sizeMul: 0.85, color: "#e8e0d4", abilityCd: 11, elem: "Plant", coats:["#e8e0d4","#f5f0e8","#d4c8b8","#c9b8a0","#fff8f0"] },
  owl:    { baseSpeed: 70, friendly: true,  flee: true,  sizeMul: 1.05, color: "#c4a882", abilityCd: 13, elem: "Wind", coats:["#c4a882","#a89070","#e8d5b7","#8b7355"] },
  snake:  { baseSpeed: 68, friendly: false, flee: false, sizeMul: 1.10, color: "#5cb85c", abilityCd: 14, elem: "Poison", coats:["#5cb85c","#3a8a40","#7ec850","#2d6a30"] },
  deer:   { baseSpeed: 85, friendly: true,  flee: true,  sizeMul: 1.20, color: "#c9a06a", abilityCd: 15, elem: "Light", coats:["#c9a06a","#a07850","#e8d5b7","#8b6914"] },
  boar:   { baseSpeed: 55, friendly: false, flee: false, sizeMul: 1.40, color: "#6b4423", abilityCd: 16, elem: "Earth", coats:["#6b4423","#8a6040","#5c3a1e","#a07850"] },
  saber:  { baseSpeed:100, friendly: false, flee: false, sizeMul: 1.45, color: "#d4a060", abilityCd: 11, elem: "Combat", coats:["#d4a060","#c49050","#e8c080","#a07040","#f0d0a0"] },
  clouded:{ baseSpeed:98,friendly:false,flee:false,sizeMul:1.28,color:"#c9ac7c",abilityCd:11,elem:"Wind",coats:["#c9ac7c","#b99669","#d6bc8d","#aa8b60"]},

  fennec:{baseSpeed:104,friendly:true,flee:true,sizeMul:.90,color:"#e5b86d",abilityCd:12,elem:"Fire",coats:["#e5b86d","#d8a45d","#f0cc8b"]},

  queenbee:{baseSpeed:74,friendly:true,flee:false,sizeMul:1.42,color:"#d2b33b",abilityCd:15,elem:"Poison",coats:["#d2b33b","#f0d35e","#8a5d20"]},
  workerbee:{baseSpeed:92,friendly:true,flee:false,sizeMul:1.06,color:"#d9b84b",abilityCd:11,elem:"Poison",coats:["#d9b84b","#f0d774","#8b6a22"]},
  dronebee:{baseSpeed:86,friendly:false,flee:false,sizeMul:.90,color:"#f3f3f0",abilityCd:10,elem:"Normal",coats:["#f3f3f0","#dfddd8","#c3bfb5"]},};

const ANIMAL_BALANCE = {
  dog:    { hpMul:1.15, damageTaken:0.88, attack:6.5 },
  cat:    { hpMul:0.90, damageTaken:1.05, attack:7.2 },
  dragon: { hpMul:1.05, damageTaken:0.93, attack:6.2 },
  fox:    { hpMul:0.92, damageTaken:1.05, attack:8.5 },
  wolf:   { hpMul:1.20, damageTaken:0.82, attack:9.5 },
  bear:   { hpMul:1.78, damageTaken:0.64, attack:8.5 },
  rabbit: { hpMul:0.72, damageTaken:1.15, attack:4.25 },
  owl:    { hpMul:0.88, damageTaken:1.02, attack:6.0 },
  snake:  { hpMul:0.84, damageTaken:1.10, attack:9.0 },
  deer:   { hpMul:1.08, damageTaken:0.94, attack:6.0 },
  boar:   { hpMul:1.62, damageTaken:0.70, attack:9.0 },
  saber:  { hpMul:1.00, babyHpMul:1.78, damageTaken:0.98, attack:12.0 },
  clouded:{ hpMul:0.98, babyHpMul:1.52, damageTaken:0.96, attack:11.1 },
  queenbee:{ hpMul:1.28, damageTaken:0.92, attack:10.5 },
  workerbee:{ hpMul:1.02, damageTaken:0.98, attack:9.2 },
  dronebee:{ hpMul:0.94, damageTaken:1.02, attack:10.8 },
};
const ANIMAL_STAGE_HP = { baby:28, adult:100, boss:320, superboss:900, bigmomma:5200 };
const ANIMAL_STAGE_ATTACK = { baby:0.55, adult:1.15, boss:1.80, superboss:2.45, bigmomma:3.00 };
const ANIMAL_STAGE_DAMAGE_TAKEN = { baby:1.04, adult:1.00, boss:0.96, superboss:0.92, bigmomma:0.58 };
const BIG_MOMMA_HP_MUL = {bear:1.55,saber:1.45,wolf:1.25,boar:1.35,clouded:1.25,dragon:1.35,rabbit:.78,fennec:.88,owl:.90};
const BIG_MOMMA_DEF_MUL = {bear:.68,saber:.72,boar:.75,wolf:.82,clouded:.82,rabbit:1.08,fennec:1.02};
const ANIMAL_RESOURCE_STAGE_PERCENT = Object.freeze({ baby:.08, adult:.13, boss:.18, superboss:.24, bigmomma:.34 });
function animalBalance(type){ return ANIMAL_BALANCE[type]||{hpMul:1,babyHpMul:1,damageTaken:1,attack:7}; }
function animalDamageTaken(type,stage,raw){raw=Math.max(0,Number(raw)||0);if(raw<=0)return 0;const speciesStage=stage==="bigmomma"?(BIG_MOMMA_DEF_MUL[type]??1):1;return Math.max(.1,raw*animalBalance(type).damageTaken*(ANIMAL_STAGE_DAMAGE_TAKEN[stage]??1)*speciesStage);}
function dogWallStats(stage,level=1){const lv=Math.max(1,Number(level)||1),t={baby:{hp:90,base:10,per:1.5},adult:{hp:120,base:15,per:2},boss:{hp:165,base:22,per:2.8},superboss:{hp:220,base:30,per:3.8},bigmomma:{hp:280,base:40,per:5}}[stage]||{hp:120,base:15,per:2};const steps=stage==="superboss"?Math.floor((lv-1)/2):(lv-1);return{hp:t.hp,spikeDmg:t.base+steps*t.per};}
const PET_ABILITY_DAMAGE_TABLE={
cat:{baby:{damage:15,per:2},adult:{damage:19,per:2},boss:{damage:30,per:2},superboss:{damage:35,per:2},bigmomma:{damage:50,per:2}},
dragon:{baby:{damage:11,per:3},adult:{damage:20,per:3},boss:{damage:35,per:3},superboss:{damage:40,per:3},bigmomma:{damage:48,per:3}},
fox:{baby:{damage:5,per:1,stun:3,shockStun:2},adult:{damage:20,per:1,stun:4,shockStun:3},boss:{damage:30,per:1,stun:4,shockStun:4},superboss:{damage:50,per:1,stun:4,shockStun:4},bigmomma:{damage:60,per:1,stun:4,shockStun:3}},
wolf:{baby:{damage:10,per:2},adult:{damage:20,per:2},boss:{damage:30,per:2},superboss:{damage:40,per:2},bigmomma:{damage:45,per:2}},
bear:{baby:{damage:16,per:1},adult:{damage:20,per:1},boss:{damage:27,per:1},superboss:{damage:30,per:1},bigmomma:{damage:34,per:1}},
rabbit:{baby:{blast:5,ring:7,per:1},adult:{blast:10,ring:18,per:1},boss:{blast:28,ring:20,per:1},superboss:{blast:39,ring:34,per:1},bigmomma:{blast:50,ring:40,per:1}},
owl:{baby:{damage:10,per:2,stun:2},adult:{damage:16,per:2,stun:6},boss:{damage:18,per:2,stun:6},superboss:{damage:20,per:2,stun:6},bigmomma:{damage:25,per:2,stun:6}},
snake:{baby:{damage:8,per:2},adult:{damage:15,per:2},boss:{damage:26,per:2},superboss:{damage:36,per:2},bigmomma:{damage:42,per:2}},
clouded:{baby:{damage:5,per:1},adult:{damage:10,per:1},boss:{damage:15,per:1},superboss:{damage:20,per:1},bigmomma:{damage:25,per:1}},
queenbee:{baby:{damage:8,dot:8,per:0},adult:{damage:16,dot:14,per:0},boss:{damage:22,dot:20,per:0},superboss:{damage:30,dot:28,per:0},bigmomma:{damage:42,dot:40,per:0}},
workerbee:{baby:{damage:8,dot:6,per:0},adult:{damage:14,dot:10,per:0},boss:{damage:20,dot:14,per:0},superboss:{damage:26,dot:18,per:0},bigmomma:{damage:34,dot:24,per:0}},
dronebee:{baby:{damage:12,per:0},adult:{damage:20,per:0},boss:{damage:28,per:0},superboss:{damage:38,per:0},bigmomma:{damage:50,per:0}},
fennec:{baby:{damage:15,per:0},adult:{damage:20,per:0},boss:{damage:25,per:0},superboss:{damage:40,per:0},bigmomma:{damage:50,per:0}},

deer:{baby:{damage:16,per:2},adult:{damage:24,per:2},boss:{damage:34,per:2},superboss:{damage:40,per:2},bigmomma:{damage:60,per:2}},
boar:{baby:{damage:20,per:1},adult:{damage:25,per:1},boss:{damage:30,per:1},superboss:{damage:49,per:1},bigmomma:{damage:57,per:1}},
saber:{baby:{damage:34,per:1},adult:{damage:38,per:1},boss:{damage:47,per:1},superboss:{damage:50,per:1},bigmomma:{damage:65,per:1}}};
function petStoneFruitStrengthMul(p){return 1+Math.max(0,Math.floor(Number(p?.stoneFruitStacks)||0))*.20;}
function petStoneFruitMoveMul(p){return Math.max(.50,1-Math.max(0,Math.floor(Number(p?.stoneFruitStacks)||0))*.10);}
function petAbilityStats(p){const type=p?.type||"",stage=["baby","adult","boss","superboss","bigmomma"].includes(p?.stage)?p.stage:"adult",lv=Math.max(1,Number(p?.level)||1),row=PET_ABILITY_DAMAGE_TABLE[type]?.[stage]||PET_ABILITY_DAMAGE_TABLE[type]?.adult||{},bonus=(lv-1)*(Number(row.per)||0),out={...row};if(Number.isFinite(row.damage))out.damage=row.damage+bonus;if(Number.isFinite(row.blast))out.blast=row.blast+bonus;if(Number.isFinite(row.ring))out.ring=row.ring+bonus;const strengthMul=petStoneFruitStrengthMul(p);for(const key of["damage","blast","ring","dot","sting","grab"])if(Number.isFinite(out[key]))out[key]*=strengthMul;return out;}
const PET_ABILITY_STAGE_SIZE={baby:.58,adult:1,boss:1.30,superboss:1.65,bigmomma:2.05};
const PET_PROJECTILE_STAGE_SIZE={baby:.64,adult:1,boss:1.24,superboss:1.48,bigmomma:1.76};
function petAbilityStageSize(stage){return PET_ABILITY_STAGE_SIZE[["baby","adult","boss","superboss","bigmomma"].includes(stage)?stage:"adult"]||1;}
function petProjectileStageSize(stage){return PET_PROJECTILE_STAGE_SIZE[["baby","adult","boss","superboss","bigmomma"].includes(stage)?stage:"adult"]||1;}
function petAbilityRangeFor(p,adultBase,radiusMul=0){const stageBase=adultBase*petAbilityStageSize(p?.stage);const bodyExtra=Math.max(0,(Number(p?.r)||18)-18)*Math.max(0,Number(radiusMul)||0)*.22;return stageBase+bodyExtra;}
function wallDamageForTool(toolName,w){const t=TOOL[toolName]||TOOL.Fist;return w?.kind==="stoneSpike"?(t.stoneWall||.5):(t.woodWall||1);}

// Keep online wildlife/card rarity in sync with the browser game.
// Bearded Dragon remains a starter species and is not part of normal wild rarity spawning.
const ANIMAL_RARITY={dog:"Common",cat:"Common",rabbit:"Common",wolf:"Uncommon",bear:"Uncommon",fox:"Uncommon",boar:"Rare",deer:"Rare",owl:"Rare",snake:"Legendary",saber:"Legendary",clouded:"Rare",fennec:"Common",queenbee:"Rare",workerbee:"Uncommon",dronebee:"Common",dragon:"Starter"};
const RARITY_WILD_WEIGHT={Common:5.0,Uncommon:2.5,Rare:1.15,Legendary:.32,Starter:.45};
const RARITY_CARD_WEIGHT={Common:2.4,Uncommon:1.5,Rare:.82,Legendary:.28,Starter:.55};
const RARITY_TAME_CHANCE={Common:.50,Uncommon:.40,Rare:.28,Legendary:.18,Starter:.42};
function animalRarity(type){return ANIMAL_RARITY[type]||"Common";}
function randomWildSpecies(speciesList=WILD_SPECIES){return weighted((speciesList&&speciesList.length?speciesList:WILD_SPECIES).map(v=>({v,w:RARITY_WILD_WEIGHT[animalRarity(v)]||1})));}
const WILD_SPECIES = ["fox","wolf","bear","cat","dog","rabbit","owl","snake","deer","boar","saber","clouded","fennec","queenbee","workerbee","dronebee","dragon"];
const WILD_PREY = {
  fox:new Set(["rabbit"]), wolf:new Set(["rabbit","deer","boar"]), bear:new Set(["rabbit","deer","boar"]),
  cat:new Set(["rabbit","snake"]), dog:new Set(["rabbit"]), rabbit:new Set(), owl:new Set(["rabbit","snake"]),
  snake:new Set(["rabbit"]), deer:new Set(), boar:new Set(), saber:new Set(["rabbit","deer","boar","wolf"]), clouded:new Set(["rabbit","deer","boar","fox"]),
  fennec:new Set(), queenbee:new Set(), workerbee:new Set(), dronebee:new Set(), dragon:new Set(["rabbit","snake"]),
};
function wildCanPreyOn(predatorType,preyType){return !!predatorType&&!!preyType&&predatorType!==preyType&&!!WILD_PREY[predatorType]?.has(preyType);}
function randomAnimalGender(){return Math.random()<.5?"Male":"Female";}
function canonicalAnimalGender(type,requested=""){if(type==="queenbee"||type==="workerbee")return "Female";if(type==="dronebee")return "Male";return requested==="Female"?"Female":requested==="Male"?"Male":randomAnimalGender();}

function skillXpNeededForLevel(level){level=Math.max(0,Math.floor(Number(level)||0));return Math.round(25+level*9+Math.floor(level*level*.05));}
function skillMilestoneKind(level){level=Math.floor(Number(level)||0);if(level===1)return "weaponChoose";if(level<2)return "";return ["craftUpgrade","craftNew","weaponUpgrade","stat"][(level-2)%4];}
function isSkillStatMilestone(level){return skillMilestoneKind(level)==="stat";}
const STARTER_WEAPON_BY_CHOICE={weaponAxe:"Axe",weaponSword:"Sword",weaponPickaxe:"Pickaxe",weaponBow:"Bow",weaponTigerClaws:"TigerClaws",weaponBoxingGloves:"BoxingGloves"};
const WEAPON_SPECIAL_IDS={Axe:["doubleAxe","throwingAxe","battleAxe"],Sword:["daggers","longSword","spear"]};
function starterWeaponFromSkillChoice(choice){return STARTER_WEAPON_BY_CHOICE[String(choice||"")]||"";}
function skillChoiceCount(s,id){let n=0;for(const v of Object.values(s?.milestones||{}))if(v===id)n++;return n;}
function weaponTierFromSkill(s){return clamp(skillChoiceCount(s,"weaponTier"),0,2);}
const STARTING_CRAFT_IDS=["Wall","Tower","Saddle","Windmill"];
const NEW_CRAFT_GROUPS=[
  {id:"travel",ids:["Boat","Sub","Chakrams","Flute","DivingSuit"]},
  {id:"support",ids:["BattleBot","PetArmor","RepairBuilding"]}
];
const NEW_CRAFT_IDS=NEW_CRAFT_GROUPS.flatMap(g=>g.ids);
const ALL_CRAFT_IDS=[...STARTING_CRAFT_IDS,...NEW_CRAFT_IDS];
const BUILD_MAX_TIER={Wall:3,Tower:3,Saddle:3,Windmill:3,Boat:3,Sub:3,Chakrams:3,Flute:3,DivingSuit:3,BattleBot:3,PetArmor:3,RepairBuilding:3};
const BUILD_FINAL_VARIANTS={
  Wall:["ruby","emerald","diamond"],Tower:["ruby","emerald","diamond"],Saddle:["ruby","emerald","diamond"],Windmill:["ruby","emerald","diamond"],
  Boat:["ruby","emerald","diamond"],Sub:["ruby","emerald","diamond"],Chakrams:["ruby","emerald","diamond"],Flute:["ruby","emerald","diamond"],DivingSuit:["ruby","emerald","diamond"],
  PetArmor:["ruby","emerald","diamond"],BattleBot:["water","fire","lightning","plant","void","light"]
};
function parseBuildUpgradeChoice(raw){const m=String(raw||"").match(/^build([A-Za-z]+)(?:@([A-Za-z]+))?$/);return m?{build:m[1],variant:(m[2]||"").toLowerCase()}:null;}
function buildUpgradeCountFromSkill(s,build){let n=0;for(const raw of Object.values(s?.milestones||{})){const p=parseBuildUpgradeChoice(raw);if(p&&p.build===build)n++;}return n;}
function buildTierFromSkill(s,build){return clamp(buildUpgradeCountFromSkill(s,build),0,BUILD_MAX_TIER[build]||0);}
function buildVariantFromSkill(s,build){let v="";for(const raw of Object.values(s?.milestones||{})){const p=parseBuildUpgradeChoice(raw);if(p&&p.build===build&&p.variant)v=p.variant;}return v;}
function newCraftGroupForBuildServer(id){return NEW_CRAFT_GROUPS.find(g=>g.ids.includes(id))||null;}
function selectedNewCraftPathFromSkill(s,groupId=""){const group=groupId?NEW_CRAFT_GROUPS.find(g=>g.id===groupId):null;for(const raw of Object.values(s?.milestones||{})){const m=String(raw).match(/^unlock([A-Za-z]+)$/);if(!m||!NEW_CRAFT_IDS.includes(m[1]))continue;if(!group||group.ids.includes(m[1]))return m[1];}return "";}
function selectedStartingCraftPathFromSkill(s){for(const raw of Object.values(s?.milestones||{})){const p=parseBuildUpgradeChoice(raw);if(p&&STARTING_CRAFT_IDS.includes(p.build))return p.build;}return "";}
function buildKnownFromSkill(s,build){if(STARTING_CRAFT_IDS.includes(build))return true;if(!NEW_CRAFT_IDS.includes(build))return false;const group=newCraftGroupForBuildServer(build);return !!group&&selectedNewCraftPathFromSkill(s,group.id)===build;}
function buildUpgradeAllowedIds(s,build){
  if(!buildKnownFromSkill(s,build))return [];
  const tier=buildTierFromSkill(s,build),max=BUILD_MAX_TIER[build]||0;if(tier>=max)return [];
  if(tier===max-1&&(BUILD_FINAL_VARIANTS[build]||[]).length)return BUILD_FINAL_VARIANTS[build].map(v=>`build${build}@${v}`);
  return [`build${build}`];
}
function skillRewardCapForState(){return 31;}
function craftNewGroupForLevelServer(level){level=Math.floor(Number(level)||0);if(skillMilestoneKind(level)!=="craftNew")return null;const ordinal=Math.max(0,Math.floor((level-3)/4));return NEW_CRAFT_GROUPS[ordinal%NEW_CRAFT_GROUPS.length]||null;}
function toolSkillAllowedChoices(s,level){
  level=Math.max(2,Math.floor(Number(level)||2));const kind=skillMilestoneKind(level);
  if(kind==="stat")return new Set(["speed","strength","defense"]);
  if(kind==="craftNew"){
    const group=craftNewGroupForLevelServer(level);if(!group)return new Set(["speed","strength","defense"]);
    const path=selectedNewCraftPathFromSkill(s,group.id);
    if(!path)return new Set(group.ids.map(b=>`unlock${b}`));
    const a=buildUpgradeAllowedIds(s,path);return new Set(a.length?a:["speed","strength","defense"]);
  }
  if(kind==="craftUpgrade"){
    const path=selectedStartingCraftPathFromSkill(s);
    if(!path)return new Set(STARTING_CRAFT_IDS.flatMap(b=>buildUpgradeAllowedIds(s,b)));
    const a=buildUpgradeAllowedIds(s,path);return new Set(a.length?a:["speed","strength","defense"]);
  }
  if(kind==="weaponUpgrade"){
    const weapon=starterWeaponFromSkillChoice(s?.stoneChoice),tier=weaponTierFromSkill(s);
    if(weapon&&tier<2)return new Set(["weaponTier"]);
    if(tier>=2&&!s?.weaponChoice)return new Set(WEAPON_SPECIAL_IDS[weapon]||[]);
    return new Set(["speed","strength","defense"]);
  }
  return new Set();
}

const TOOL = {
  Fist:    { dmg: 1.0, range: 42, cadence: 0.50, gather: 0.06, resourcePower: 0.08, woodWall:1.0, stoneWall:0.45 },
  Axe:     { dmg: 5.5, range: 50, cadence: 0.58, gather: 2.4,  resourcePower: 0.95, woodWall:9.0, stoneWall:2.0 },
  Pickaxe: { dmg: 5.0, range: 50, cadence: 0.50, gather: 2.5,  resourcePower: 1.15, woodWall:4.0, stoneWall:14.0 },
  Sword:   { dmg: 8.0, range: 62, cadence: 0.42, gather: 0.08, resourcePower: 0.10, woodWall:4.0, stoneWall:1.8 },
  Bow:     { dmg: 9.0, range: 46, cadence: 0.55, gather: 0.12, resourcePower: 0.18, woodWall:2.0, stoneWall:1.5 },
  TigerClaws:{ dmg:7.0, range:44, cadence:.30, gather:.16, resourcePower:.20, woodWall:2.8, stoneWall:1.6 },
  BoxingGloves:{ dmg:6.2, range:48, cadence:.34, gather:.10, resourcePower:.12, woodWall:2.2, stoneWall:1.4 },
};
const HYDRATION_NORMAL_SPEED_AT = 35;
const BUCKET_MAX_SIPS = 5;
const BUCKET_SIP_HYDRATION = 14;

class PlayerState extends Schema {
  constructor() {
    super();
    this.id = ""; this.username = "Cube";
    this.x = WORLD_W / 2; this.y = WORLD_H / 2; this.angle = 0;
    this.health = 100; this.maxHealth = 100; this.dead = false;
    this.color = "#3fa7ff"; this.tool = "Fist"; this.heldSpecial = ""; this.ridingPetId = ""; this.vehicleType = ""; this.vehicleTier=0; this.vehicleVariant="";
    this.moveX = 0; this.moveY = 0; this.moving = false; this.animalCarryT = 0;
    this.kills = 0; this.gold = 0; this.title = ""; this.testerRank = 0; this.ownerRank = 0;
    this.skillLevel = 0; this.skillXp = 0; this.skillSpeed = 0; this.skillStrength = 0; this.skillDefense = 0; this.skillPendingMilestone = 0;
    this.hydration = 100; this.bucketWater = true; this.bucketSips = BUCKET_MAX_SIPS; this.saddleTier = 0; this.saddleVariant=""; this.divingSuitTier=-1; this.divingSuitVariant=""; this.oxygen=0; this.oxygenMax=0;
  }
}
defineTypes(PlayerState, {
  id:"string", username:"string", x:"number", y:"number", angle:"number",
  health:"number", maxHealth:"number", dead:"boolean", color:"string", tool:"string", heldSpecial:"string", ridingPetId:"string", vehicleType:"string", vehicleTier:"number", vehicleVariant:"string",
  moveX:"number", moveY:"number", moving:"boolean", animalCarryT:"number", kills:"number", gold:"number", title:"string", testerRank:"number", ownerRank:"number",
  skillLevel:"number", skillXp:"number", skillSpeed:"number", skillStrength:"number", skillDefense:"number", skillPendingMilestone:"number", hydration:"number", bucketWater:"boolean", bucketSips:"number", saddleTier:"number", saddleVariant:"string", divingSuitTier:"number", divingSuitVariant:"string", oxygen:"number", oxygenMax:"number"
});

class ResourceState extends Schema {
  constructor() {
    super();
    this.type="rock"; this.x=0; this.y=0; this.hp=1; this.maxHp=1; this.alive=true;
    this.solidR=12; this.canopyR=0; this.scale=1; this.rot=0;
  }
}
defineTypes(ResourceState, { type:"string", x:"number", y:"number", hp:"number", maxHp:"number", alive:"boolean", solidR:"number", canopyR:"number", scale:"number", rot:"number" });

class GoldState extends Schema {
  constructor() { super(); this.x=0; this.y=0; this.size="small"; this.r=16; this.goldLeft=6; this.infinite=false; this.pure=false; }
}
defineTypes(GoldState, { x:"number", y:"number", size:"string", r:"number", goldLeft:"number", infinite:"boolean", pure:"boolean" });

class ChestState extends Schema {
  constructor() { super(); this.x=0; this.y=0; this.r=18; this.hp=4; this.maxHp=4; this.opened=false; this.pulse=0; this.shine=0; this.chipSide="wood"; }
}
defineTypes(ChestState, { x:"number", y:"number", r:"number", hp:"number", maxHp:"number", opened:"boolean", pulse:"number", shine:"number", chipSide:"string" });

class AnimalState extends Schema {
  constructor() {
    super();
    this.type="dog"; this.stage="baby"; this.x=0; this.y=0; this.angle=0; this.r=18;
    this.hp=26; this.maxHp=26; this.coat="#c9a06a"; this.spotCol="#8b6a45"; this.spotsJson="[]";
    this.speed=60; this.sleeping=false; this.tailPhase=0; this.attackAnim=0; this.flash=0;
    this.atkCd=0; this.abilityCd=0; this.combat=0; this.recentHit=0; this.wanderT=1; this.wanderA=0;
    this.fleeUntil=0; this.enraged=false; this.tameFailedAggro=false; this.desperateAggro=false;
    this.releasedWild=false; this.hostileRiderMount=false; this.level=1; this.exp=0; this.petName="";
    this.gender="Male"; this.motherId=""; this.fatherId=""; this.bredChild=false;
    this.pollenCollecting=false; this.pollenProgress=0;
  }
}
defineTypes(AnimalState, {
  type:"string", stage:"string", x:"number", y:"number", angle:"number", r:"number",
  hp:"number", maxHp:"number", coat:"string", spotCol:"string", spotsJson:"string", speed:"number",
  sleeping:"boolean", tailPhase:"number", attackAnim:"number", flash:"number", atkCd:"number", abilityCd:"number",
  combat:"number", recentHit:"number", wanderT:"number", wanderA:"number", fleeUntil:"number", enraged:"boolean",
  tameFailedAggro:"boolean", desperateAggro:"boolean", releasedWild:"boolean", hostileRiderMount:"boolean", level:"number", exp:"number", petName:"string",
  gender:"string", motherId:"string", fatherId:"string", bredChild:"boolean", pollenCollecting:"boolean", pollenProgress:"number"
});

class PetState extends Schema {
  constructor() {
    super();
    this.ownerId=""; this.type="dog"; this.stage="baby"; this.x=0; this.y=0; this.angle=0; this.r=18;
    this.hp=26; this.maxHp=26; this.coat="#c9a06a"; this.spotCol="#8b6a45"; this.spotsJson="[]";
    this.speed=80; this.sleeping=false; this.tailPhase=0; this.attackAnim=0; this.flash=0;
    this.abilityCd=0; this.atkCd=0; this.combat=0; this.level=1; this.exp=0; this.petName="Pet";
    this.orderMode="follow"; this.targetX=-1; this.targetY=-1; this.dead=false;
    this.upHealth=0; this.upDefense=0; this.upAttack=0; this.upWeight=0; this.upRegen=0; this.upSpeed=0;
    this.stoneFruitStacks=0; this.armorTier=-1; this.armorGem="";
    this.gender="Male"; this.motherId=""; this.fatherId=""; this.bredChild=false;
    this.olderBrotherId=""; this.olderSisterId="";
    this.wanderT=rand(.6,2.2); this.wanderA=rand(0,TAU);
  }
}
defineTypes(PetState, {
  ownerId:"string", type:"string", stage:"string", x:"number", y:"number", angle:"number", r:"number",
  hp:"number", maxHp:"number", coat:"string", spotCol:"string", spotsJson:"string", speed:"number", sleeping:"boolean",
  tailPhase:"number", attackAnim:"number", flash:"number", abilityCd:"number", atkCd:"number", combat:"number",
  level:"number", exp:"number", petName:"string", orderMode:"string", targetX:"number", targetY:"number", dead:"boolean",
  upHealth:"number", upDefense:"number", upAttack:"number", upWeight:"number", upRegen:"number", upSpeed:"number", stoneFruitStacks:"number", armorTier:"number", armorGem:"string",
  gender:"string", motherId:"string", fatherId:"string", bredChild:"boolean", olderBrotherId:"string", olderSisterId:"string", wanderT:"number", wanderA:"number"
});

class EnemyState extends Schema {
  constructor() {
    super();
    this.x=0; this.y=0; this.angle=0; this.r=17; this.speed=60; this.weapon="Fist";
    this.dmg=6; this.hp=18; this.maxHp=18; this.strong=false; this.armed=false; this.ranged=false;
    this.hue="#e0563f"; this.attackAnim=0; this.flash=0; this.atkCd=0; this.wanderA=0; this.wanderT=1;
    this.strafeDir=1; this.strafeT=1; this.dead=false;
    this.guardPetId=""; this.ridingPetId=""; this.hasGuard=false;
    this.role="Brawler"; this.moonMarked=false; this.moonBiome="";
  }
}
defineTypes(EnemyState, {
  x:"number", y:"number", angle:"number", r:"number", speed:"number", weapon:"string", dmg:"number", hp:"number", maxHp:"number",
  strong:"boolean", armed:"boolean", ranged:"boolean", hue:"string", attackAnim:"number", flash:"number", atkCd:"number",
  wanderA:"number", wanderT:"number", strafeDir:"number", strafeT:"number", dead:"boolean",
  guardPetId:"string", ridingPetId:"string", hasGuard:"boolean", role:"string", moonMarked:"boolean", moonBiome:"string"
});

class WallState extends Schema {
  constructor() {
    super();
    this.x=0; this.y=0; this.r=20; this.ttl=-1; this.ownerId="";
    this.hp=72; this.maxHp=72; this.kind="wood"; this.spiked=false; this.spikeDmg=0; this.sourcePetId="";
  }
}
defineTypes(WallState, {
  x:"number", y:"number", r:"number", ttl:"number", ownerId:"string",
  hp:"number", maxHp:"number", kind:"string", spiked:"boolean", spikeDmg:"number", sourcePetId:"string"
});

class TowerState extends Schema {
  constructor() { super(); this.x=0; this.y=0; this.cd=0.5; this.ownerId=""; this.tier=0; this.hp=120; this.maxHp=120; this.kind="tower"; this.variant=""; this.angle=0; }
}
defineTypes(TowerState, { x:"number", y:"number", cd:"number", ownerId:"string", tier:"number", hp:"number", maxHp:"number", kind:"string", variant:"string", angle:"number" });

class ProjectileState extends Schema {
  constructor() {
    super(); this.x=0; this.y=0; this.vx=0; this.vy=0; this.life=1; this.r=5; this.hostile=false;
    this.kind="arrow"; this.color="#7ec0ee"; this.dmg=10; this.ownerId=""; this.petBlast=false; this.knock=0; this.sourcePetId=""; this.returning=false; this.toolTier=0;
  }
}
defineTypes(ProjectileState, { x:"number", y:"number", vx:"number", vy:"number", life:"number", r:"number", hostile:"boolean", kind:"string", color:"string", dmg:"number", ownerId:"string", petBlast:"boolean", knock:"number", sourcePetId:"string", returning:"boolean", toolTier:"number" });

class WorldState extends Schema {
  constructor() {
    super();
    this.players=new MapSchema(); this.resources=new MapSchema(); this.gold=new MapSchema(); this.chests=new MapSchema();
    this.animals=new MapSchema(); this.pets=new MapSchema(); this.enemies=new MapSchema(); this.walls=new MapSchema();
    this.towers=new MapSchema(); this.projectiles=new MapSchema();
    this.dayPhase=0; this.phaseTimer=TIME_PHASES[0].duration; this.dayCount=1; this.wave=0; this.worldTime=0;
    this.rulesVersion=CUBE_SHARED_RULES_VERSION; this.worldId="world1";
    this.worldReady=false; this.initialAnimalCount=0; this.wildlifeCount=0;
  }
}
defineTypes(WorldState, {
  players:{map:PlayerState}, resources:{map:ResourceState}, gold:{map:GoldState}, chests:{map:ChestState},
  animals:{map:AnimalState}, pets:{map:PetState}, enemies:{map:EnemyState}, walls:{map:WallState}, towers:{map:TowerState}, projectiles:{map:ProjectileState},
  dayPhase:"number", phaseTimer:"number", dayCount:"number", wave:"number", worldTime:"number", rulesVersion:"string", worldId:"string",
  worldReady:"boolean", initialAnimalCount:"number", wildlifeCount:"number"
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function randi(lo, hi) { return Math.floor(rand(lo, hi + 1)); }

function normalizeWorldId(value) {
  const id = String(value || "world1").trim().toLowerCase();
  return /^world[1-4]$/.test(id) ? id : "world1";
}
function hashWorldSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeSeededRandom(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function angTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function angleDiff(a,b) { return Math.atan2(Math.sin(b-a), Math.cos(b-a)); }
function smoothTurn(obj, target, dt, speed=8) { obj.angle += clamp(angleDiff(obj.angle, target), -speed*dt, speed*dt); }

// Match the client riding rule: faster pets steer faster while slower pets
// steer more gradually. Proportional scaling prevents high-speed mounts from
// having much larger turning arcs than the slower species.
function mountedPetTurnSpeed(pet) {
  if(!pet)return 2.15;
  // Use the live upgraded speed formula so both Speed and Weight upgrades
  // immediately affect mounted steering in multiplayer as well.
  const finalSpeed=Math.max(24,
    animalSpeed(pet.type,pet.stage,true,petUpgradeMultiplier(pet,"weight"))*
    petUpgradeMultiplier(pet,"speed")
  );
  return clamp(2.15*(finalSpeed/90),1.05,5.60);
}
function facing(px,py,pa,tx,ty,max=0.95) { return Math.abs(angleDiff(pa, angTo(px,py,tx,ty))) < max; }

const PRECISE_WEAPON_GEOMETRY={
  axeWood:{kind:"axe",head:[-36,18],r:9},axeStone:{kind:"axe",head:[-40,15],r:10},axeIron:{kind:"axe",head:[-38,23],r:9},
  axeDouble:{kind:"doubleAxe",heads:[[-69,24],[67,24]],r:11},axeThrow:{kind:"axe",head:[45,19],r:9},axeWar:{kind:"axe",head:[-75,8],r:12},
  swordWood:{kind:"sword",blade:[-75,6,-18,6],r:5},swordStone:{kind:"sword",blade:[-71,9,-18,9],r:5},swordIron:{kind:"sword",blade:[-80,10,-18,10],r:5},
  longSword:{kind:"sword",blade:[-116,-7,-22,-7],r:5}
};
function preciseWeaponPoseKey(tool,tier,choice){
  tier=clamp(Math.floor(Number(tier)||0),0,2);choice=String(choice||"");
  if(tool==="Axe"){if(choice==="doubleAxe")return"axeDouble";if(choice==="throwingAxe")return"axeThrow";if(choice==="battleAxe")return"axeWar";return tier<=0?"axeWood":tier===1?"axeStone":"axeIron";}
  if(tool==="Sword"){if(choice==="longSword")return"longSword";if(choice==="daggers"||choice==="spear")return"";return tier<=0?"swordWood":tier===1?"swordStone":"swordIron";}
  return"";
}
function preciseSwingTransform(poseKey,t){
  const isAxe=String(poseKey||"").startsWith("axe");let rot=0,dx=0,dy=0;t=clamp(Number(t)||0,0,1);
  const ease=q=>{q=clamp(q,0,1);return q*q*(3-2*q);};
  if(isAxe){if(t<=0){}else if(t<.20){const q=ease(t/.20);rot=.16*q;dx=1.5*q;dy=-q;}else if(t<.68){const q=ease((t-.20)/.48);rot=.16+(-1.20-.16)*q;dx=1.5-4.5*q;dy=-1+5*q;}else{const q=ease((t-.68)/.32);rot=-1.20*(1-q);dx=-3*(1-q);dy=4*(1-q);}}
  else{if(t<.70){const q=ease(t/.70);rot=-1.22*q;dx=3.5*q;dy=6*q;}else{const q=ease((t-.70)/.30);rot=-1.22*(1-q);dx=3.5*(1-q);dy=6*(1-q);}}
  return{rot,dx,dy};
}
function preciseRotateLocal(x,y,px,py,rot,dx=0,dy=0){const rx=x-px,ry=y-py,c=Math.cos(rot),s=Math.sin(rot);return{x:px+dx+rx*c-ry*s,y:py+dy+rx*s+ry*c};}
function preciseLocalToWorld(p,lx,ly,angle){const a=angle-Math.PI/2,c=Math.cos(a),s=Math.sin(a);return{x:p.x+lx*c-ly*s,y:p.y+lx*s+ly*c};}
function preciseWeaponShape(p,poseKey,angle,attackT){
  const g=PRECISE_WEAPON_GEOMETRY[poseKey];if(!g)return null;const circles=[],segments=[];
  if(g.kind==="doubleAxe"){
    let rot=0,t=clamp(Number(attackT)||0,0,1),ease=q=>{q=clamp(q,0,1);return q*q*(3-2*q);};
    if(t>0){if(t<.30)rot=-.38*ease(t/.30);else if(t<.72){const q=ease((t-.30)/.42);rot=-.38+1.48*q;}else{const q=ease((t-.72)/.28);rot=1.10*(1-q);}}
    for(const h of g.heads){const lp=preciseRotateLocal(h[0],h[1],0,7,rot),wp=preciseLocalToWorld(p,lp.x,lp.y,angle);circles.push({x:wp.x,y:wp.y,r:g.r});}
  }else{
    const tr=preciseSwingTransform(poseKey,attackT);
    if(g.kind==="axe"){const lp=preciseRotateLocal(g.head[0],g.head[1],0,7,tr.rot,tr.dx,tr.dy),wp=preciseLocalToWorld(p,lp.x,lp.y,angle);circles.push({x:wp.x,y:wp.y,r:g.r});}
    else{const a=preciseRotateLocal(g.blade[0],g.blade[1],0,7,tr.rot,tr.dx,tr.dy),b=preciseRotateLocal(g.blade[2],g.blade[3],0,7,tr.rot,tr.dx,tr.dy),aw=preciseLocalToWorld(p,a.x,a.y,angle),bw=preciseLocalToWorld(p,b.x,b.y,angle);segments.push({ax:aw.x,ay:aw.y,bx:bw.x,by:bw.y,r:g.r});}
  }
  return{circles,segments};
}
function precisePointSegmentDistance(px,py,ax,ay,bx,by){const vx=bx-ax,vy=by-ay,wx=px-ax,wy=py-ay,d=vx*vx+vy*vy,t=d>1e-8?clamp((wx*vx+wy*vy)/d,0,1):0,qx=ax+vx*t,qy=ay+vy*t;return Math.hypot(px-qx,py-qy);}
function preciseShapeTouchesCircle(shape,x,y,r=0){if(!shape)return false;for(const c of shape.circles||[])if(dist(c.x,c.y,x,y)<=Math.max(0,r)+(c.r||0))return true;for(const s of shape.segments||[])if(precisePointSegmentDistance(x,y,s.ax,s.ay,s.bx,s.by)<=Math.max(0,r)+(s.r||0))return true;return false;}
function preciseShapeTouchesAnimal(shape,a){for(const h of animalTargetDamageCircles({kind:"animal"},a))if(preciseShapeTouchesCircle(shape,h.x,h.y,h.r))return true;return false;}
function preciseShapeTouchesResource(shape,r){
  if(!shape||!r)return false;
  if(r.type==="rock"){
    for(const c of shape.circles||[])if(basicRockCirclePenetration(r,c.x,c.y,c.r||0))return true;
    for(const s of shape.segments||[]){const len=Math.hypot(s.bx-s.ax,s.by-s.ay),steps=Math.max(1,Math.ceil(len/4));for(let i=0;i<=steps;i++){const t=i/steps;if(basicRockCirclePenetration(r,s.ax+(s.bx-s.ax)*t,s.ay+(s.by-s.ay)*t,s.r||0))return true;}}
    return false;
  }
  if(r.type==="log"){
    const sc=Number(r.scale)||1,ang=Number(r.rot)||0,ca=Math.cos(ang),sa=Math.sin(ang),half=27*sc,rr=8.8*sc;
    for(const t of[-.82,-.41,0,.41,.82])if(preciseShapeTouchesCircle(shape,r.x+ca*(half*t),r.y+sa*(half*t),rr))return true;
    return false;
  }
  const cx=r.x,cy=r.type==="tree"?r.y+4*(Number(r.scale)||1):r.y,rr=Math.max(8,(Number(r.solidR)||12)+(r.type==="tree"?8:6));
  return preciseShapeTouchesCircle(shape,cx,cy,rr);
}
function preciseShapeTouchesGold(shape,g){
  if(!shape||!g)return false;const rr=(Number(g.r)||18)*(g.pure?.78:g.size==="huge"?.75:.72),cy=g.y+(Number(g.r)||18)*(g.pure?.06:g.size==="huge"?.04:.03);
  return preciseShapeTouchesCircle(shape,g.x,cy,rr);
}
function segmentCircleT(x0,y0,x1,y1,cx,cy,r){
  const dx=x1-x0,dy=y1-y0,len2=dx*dx+dy*dy;
  let t=len2>1e-8?((cx-x0)*dx+(cy-y0)*dy)/len2:0;
  t=clamp(t,0,1);
  const qx=x0+dx*t,qy=y0+dy*t;
  return dist(qx,qy,cx,cy)<=r?t:null;
}
function animalProjectileSegmentT(a,x0,y0,x1,y1,radius=0){
  let best=null;
  // Every animal damage test uses torso/body circles AND the explicit head.
  for(const h of animalTargetDamageCircles({kind:"animal"},a)){
    const t=segmentCircleT(x0,y0,x1,y1,h.x,h.y,radius+h.r);
    if(t!=null&&(best==null||t<best))best=t;
  }
  return best;
}
function pick(list) { return list[Math.floor(Math.random()*list.length)]; }
function weighted(list) { const total=list.reduce((s,x)=>s+x.w,0); let n=rand(0,total); for(const x of list){ if((n-=x.w)<=0) return x.v; } return list[list.length-1].v; }
function shadeHex(hex, amt) {
  try { const n=parseInt(hex.replace("#",""),16); const r=clamp((n>>16)+amt,0,255), g=clamp(((n>>8)&255)+amt,0,255), b=clamp((n&255)+amt,0,255); return `#${((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}`; } catch { return hex; }
}

const ANIMAL_PLANT_EATERS=new Set(["rabbit","deer"]);
function animalDietSizeMultiplier(type){
  if(ANIMAL_PLANT_EATERS.has(type))return .88;
  return 1.14;
}
function animalRadius(type, stage) {
  const mul=(PET_TYPES[type]?.sizeMul)||1,dietMul=animalDietSizeMultiplier(type); let base=22;
  if(stage==="adult") base=45; else if(stage==="boss") base=68; else if(stage==="superboss") base=96; else if(stage==="bigmomma") base=140;
  let extra=1;
  if(["boss","superboss","bigmomma"].includes(stage)) extra=(type==="bear"||type==="saber"||type==="clouded")?1.28:(type==="wolf"||type==="boar")?1.16:1.08;
  return base*mul*dietMul*extra;
}
function uploadedAnimalVisibleDimensions(type,stage){
  const speciesHeight={dog:1.06,cat:1.02,dragon:1.00,fox:1.06,wolf:1.10,bear:1.18,rabbit:.98,owl:1.48,snake:.68,deer:.98,boar:.92,saber:1.10,clouded:1.02,fennec:.92}[type];
  if(!speciesHeight)return null;
  const stageScale={baby:1.78,adult:1.52,boss:1.43,superboss:1.40,bigmomma:1.38}[stage]||1.45;
  const lengthMul={dog:1.62,cat:1.58,dragon:1.92,fox:1.70,wolf:1.72,bear:1.42,rabbit:1.42,owl:1.05,snake:3.70,deer:1.78,boar:1.58,saber:1.66,clouded:1.64,fennec:1.73}[type]||1.55;
  const h=animalRadius(type,stage)*speciesHeight*stageScale;
  return{h,w:h*lengthMul};
}
function petUpgradeLevel(p,stat){
  const map={health:"upHealth",defense:"upDefense",attack:"upAttack",weight:"upWeight",regen:"upRegen",speed:"upSpeed"};
  const key=map[stat];return key?Math.max(0,Math.min(10,Number(p?.[key])||0)):0;
}
function petUpgradeMultiplier(p,stat){
  const lv=petUpgradeLevel(p,stat);
  if(stat==="defense")return Math.max(.55,1-.045*lv);
  const per=stat==="health"?.08:stat==="attack"?.075:stat==="weight"?.12:stat==="regen"?.12:stat==="speed"?.04:0;
  return 1+per*lv;
}

function animalWeight(aOrType,stageMaybe=null){
  const type=typeof aOrType==="string"?aOrType:(aOrType?.type||"dog");
  const stage=stageMaybe||(typeof aOrType==="object"?aOrType?.stage:null)||"adult";
  const stageMass={baby:.78,adult:1.35,boss:2.10,superboss:3.25,bigmomma:5.10}[stage]||1.35;
  const speciesMass={rabbit:.58,cat:.72,fox:.82,dragon:.88,dog:1,owl:.72,deer:1.05,snake:.78,wolf:1.28,boar:1.42,saber:1.38,clouded:1.30,bear:1.75}[type]||1;
  const d=uploadedAnimalVisibleDimensions(type,stage);
  let sizeMass=1;
  if(d){
    const area=Math.max(1,d.w*d.h);
    sizeMass=Math.max(.82,Math.min(1.42,Math.sqrt(area/4200)));
  }else{
    const r=animalRadius(type,stage);
    sizeMass=Math.max(.85,Math.min(1.4,r/34));
  }
  let result=Math.max(.35,stageMass*speciesMass*sizeMass);
  if(typeof aOrType==="object"&&aOrType&&"upWeight" in aOrType)result*=petUpgradeMultiplier(aOrType,"weight");
  return result;
}
function animalPushMobility(a){
  const w=animalWeight(a);
  return Math.max(.08,Math.min(.92,1/(.55+w)));
}

function animalHitboxFit(type,stage){
  const stageFit={
    baby:{len:1.04,body:1.04,head:1.08},
    adult:{len:.90,body:.90,head:.88},
    // Large stages already use larger visible art; avoid double-inflating collision.
    boss:{len:.99,body:1.00,head:1.02},
    superboss:{len:1.00,body:1.00,head:1.03},
    bigmomma:{len:1.01,body:1.00,head:1.04}
  }[stage]||{len:1.04,body:1.04,head:1.08};

  const speciesFit={
    dog:{len:1.02,body:1.03,head:1.04},
    cat:{len:1.02,body:1.00,head:1.04},
    dragon:{len:1.07,body:.99,head:1.08},
    fox:{len:1.03,body:1.01,head:1.05},
    wolf:{len:1.03,body:1.04,head:1.05},
    bear:{len:.99,body:1.08,head:1.05},
    rabbit:{len:1.02,body:1.00,head:1.08},
    snake:{len:.84,body:.74,head:.82},
    boar:{len:1.03,body:1.04,head:1.06},
    saber:{len:.88,body:.88,head:.90},
    clouded:{len:.92,body:.90,head:.93},
    deer:{len:.82,body:.74,head:.78},
    owl:{len:1.00,body:1.02,head:1.05},
    fennec:{len:.92,body:.88,head:.84},
    queenbee:{len:.78,body:.78,head:.72},
    workerbee:{len:.72,body:.72,head:.68},
    dronebee:{len:.75,body:.75,head:.70}
  }[type]||{len:1.02,body:1.02,head:1.05};

  return{
    len:stageFit.len*speciesFit.len,
    body:stageFit.body*speciesFit.body,
    head:stageFit.head*speciesFit.head
  };
}

function animalSpawnFootprint(type,stage){
  const fit=animalHitboxFit(type,stage);
  const d=uploadedAnimalVisibleDimensions(type,stage);
  if(d)return Math.hypot(d.w*.5*fit.len,d.h*.5*Math.max(fit.body,fit.head))*.92;
  const r=animalRadius(type,stage);
  const m=stage==="bigmomma"?1.62:stage==="superboss"?1.52:stage==="boss"?1.44:stage==="adult"?1.36:1.28;
  return r*m*Math.max(fit.len,fit.body,fit.head);
}

const BEE_COPIED_TORSO_HEAD = Object.freeze({
  baby:{queenbee:[[-.145,1.235],[1.076,.913]],workerbee:[[-.126,1.071],[.933,.791]],dronebee:[[-.111,.941],[.820,.696]]},
  adult:{queenbee:[[-.123,1.235],[.917,1.051]],workerbee:[[-.107,1.071],[.795,.911]],dronebee:[[-.094,.941],[.699,.801]]},
  boss:{queenbee:[[-.169,1.245],[.860,1.045]],workerbee:[[-.146,1.080],[.746,.906]],dronebee:[[-.129,.949],[.655,.797]]},
  superboss:{queenbee:[[-.100,1.270],[.945,1.071]],workerbee:[[-.087,1.102],[.820,.929]],dronebee:[[-.076,.968],[.721,.816]]},
  bigmomma:{queenbee:[[-.050,1.193],[.931,1.005]],workerbee:[[-.044,1.034],[.808,.872]],dronebee:[[-.038,.909],[.710,.766]]}
});
function copiedBeeTorsoHeadCircles(a){
  if(!a || !["queenbee","workerbee","dronebee"].includes(a.type)) return null;
  const stage=(a.stage==="baby"||a.stage==="boss"||a.stage==="superboss"||a.stage==="bigmomma")?a.stage:"adult";
  const pair=BEE_COPIED_TORSO_HEAD[stage]?.[a.type]; if(!pair)return null;
  const r=Math.max(4,Number(a.r)||18),ang=Number(a.angle)||0,ca=Math.cos(ang),sa=Math.sin(ang);
  return pair.map(([forward,rad])=>({x:(Number(a.x)||0)+ca*forward*r,y:(Number(a.y)||0)+sa*forward*r,r:rad*r}));
}

function animalHitCircles(a) {
  const beeCopy=copiedBeeTorsoHeadCircles(a); if(beeCopy)return beeCopy;
  const ang=a?.angle||0,ca=Math.cos(ang),sa=Math.sin(ang);
  // 739: body/head copies keep the renderer's exact scale; no extra fit/enlargement.
  const fit={len:1,body:1,head:1};
  const d=uploadedAnimalVisibleDimensions(a?.type,a?.stage);

  if(d){
    const cfg={
      dog:[[-.34,.17],[-.17,.26],[.05,.31],[.27,.28],[.43,.23],[.54,.17]],
      cat:[[-.35,.16],[-.18,.24],[.04,.29],[.26,.25],[.43,.21],[.54,.16]],
      dragon:[[-.39,.14],[-.22,.21],[.02,.26],[.28,.22],[.46,.18],[.60,.13]],
      rabbit:[[-.28,.16],[-.10,.22],[.08,.27],[.26,.24],[.41,.20],[.51,.15]],
      owl:[[-.24,.19],[-.08,.27],[.10,.31],[.27,.28],[.40,.23],[.50,.18]],
      snake:[[-.44,.22],[-.32,.27],[-.19,.30],[-.05,.31],[.10,.31],[.24,.30],[.37,.27],[.47,.23]],
      fox:[[-.37,.17],[-.19,.25],[.04,.30],[.27,.26],[.44,.21],[.56,.16]],
      wolf:[[-.36,.18],[-.18,.27],[.05,.32],[.28,.28],[.45,.23],[.57,.17]],
      bear:[[-.30,.21],[-.14,.32],[.07,.38],[.28,.34],[.43,.27],[.54,.20]],
      deer:[[-.28,.13],[-.09,.20],[.12,.24],[.33,.21],[.49,.16],[.61,.11]],
      boar:[[-.31,.20],[-.14,.30],[.07,.34],[.28,.31],[.44,.25],[.55,.18]],
      saber:[[-.34,.17],[-.17,.25],[.05,.30],[.27,.27],[.44,.22],[.55,.16]],
      clouded:[[-.35,.16],[-.18,.24],[.04,.29],[.26,.25],[.43,.20],[.54,.15]],
      fennec:[[-.31,.14],[-.13,.21],[.07,.25],[.27,.21],[.41,.16],[.51,.11]]
    }[a.type];

    return cfg.map(([xf,rf],i)=>{
      const headish=i>=cfg.length-2;
      const forward=d.w*xf*(headish?fit.head:fit.len);
      const rr=d.h*rf;
      return{x:a.x+ca*forward,y:a.y+sa*forward,r:rr};
    });
  }

  // Unknown/future species fallback only. Every active species is covered above;
  // never revive the old species-radius collision table here.
  const r=Math.max(4,Number(a?.r)||18),generic=[[-.22,.30],[.08,.34],[.37,.27],[.61,.19]];
  return generic.map(([f,rad])=>({x:a.x+ca*f*r,y:a.y+sa*f*r,r:r*rad}));
}
function animalPhysicalCirclesBase(a){
  // Movement collision uses the copied visible torso+head hitboxes only.
  if(!a)return[];
  return animalTorsoHeadCircles(a).map(h=>({...h}));
}

function animalPhysicalCircles(a){
  // Already includes the copied visible torso+head hitboxes; do not add any extra hidden head hitbox.
  return animalPhysicalCirclesBase(a).map(h=>({...h}));
}
function animalMeleeTouch(a,px,py,range,angle,maxFacing=1.05){
  for(const h of animalTargetDamageCircles({kind:"animal"},a)){
    if(dist(px,py,h.x,h.y)<range+h.r&&facing(px,py,angle,h.x,h.y,maxFacing))return true;
  }
  return false;
}
function animalProjectileTouch(a,x,y,radius=0){
  for(const h of animalTargetDamageCircles({kind:"animal"},a))if(dist(x,y,h.x,h.y)<radius+h.r)return true;
  return false;
}
function animalHeadCopyPartCount(a){
  if(!a)return 0;
  const hits=animalHitCircles(a),total=hits.length;
  if(!total)return 0;
  if(["queenbee","workerbee","dronebee"].includes(a.type))return 1;
  return Math.min(total,2);
}
function animalTorsoHeadCopyPartCount(a){
  if(!a)return 0;
  const hits=animalHitCircles(a),total=hits.length;
  if(!total)return 0;
  if(a.type==="snake")return total;
  if(["queenbee","workerbee","dronebee"].includes(a.type))return total;
  return total<=2?total:total-1;
}
function expandCopiedAnimalCrossSection(a,h){
  const ang=Number(a?.angle)||0,sa=Math.sin(ang),ca=Math.cos(ang),type=String(a?.type||""),stage=String(a?.stage||"");
  let sizeMul=1;
  if(stage==="baby"&&!["queenbee","workerbee","dronebee"].includes(type))sizeMul*=0.93;
  if(stage==="bigmomma"&&!["queenbee","workerbee","dronebee"].includes(type))sizeMul*=0.94;
  if(["queenbee","workerbee","dronebee"].includes(type))sizeMul*=1.07;
  const sourceR=Math.max(1,Number(h?.r)||1)*sizeMul,rr=sourceR*.74,side=sourceR*.26;
  return[
    {x:h.x-sa*side,y:h.y+ca*side,r:rr,_copyCenterX:h.x,_copyCenterY:h.y},
    {x:h.x+sa*side,y:h.y-ca*side,r:rr,_copyCenterX:h.x,_copyCenterY:h.y}
  ];
}
function expandCopiedAnimalParts(a,parts){const out=[];for(const h of parts||[])out.push(...expandCopiedAnimalCrossSection(a,h));return out;}
function animalTorsoCircles(a){
  const hits=animalHitCircles(a);
  if(!hits.length)return[];
  const keep=animalTorsoHeadCopyPartCount(a), headCount=animalHeadCopyPartCount(a);
  const start=Math.max(0,hits.length-keep),end=Math.max(start,hits.length-headCount);
  return expandCopiedAnimalParts(a,hits.slice(start,end));
}
function animalTorsoHeadCircles(a){
  const hits=animalHitCircles(a);
  if(!hits.length)return[];
  const keep=animalTorsoHeadCopyPartCount(a);
  return expandCopiedAnimalParts(a,hits.slice(Math.max(0,hits.length-keep)));
}
function animalVisibleHeadBaseGeometries(a){
  if(!a)return[];const hits=animalHitCircles(a);if(!hits.length)return[];const count=animalHeadCopyPartCount(a);return hits.slice(Math.max(0,hits.length-count)).map(h=>({x:h.x,y:h.y,r:h.r}));
}
function animalVisibleHeadGeometries(a){
  if(!a)return[];
  const base=animalVisibleHeadBaseGeometries(a);if(base.length)return expandCopiedAnimalParts(a,base);
  const ang=Number(a.angle)||0,ca=Math.cos(ang),sa=Math.sin(ang),r=Math.max(4,Number(a.r)||18);
  return expandCopiedAnimalParts(a,[{x:(Number(a.x)||0)+ca*r*.92,y:(Number(a.y)||0)+sa*r*.92,r:Math.max(3,r*.34)}]);
}
function animalSolidHeadGeometries(a){return animalVisibleHeadGeometries(a);}
function animalFaceGeometry(a){
  // Bite/attack range is a separate contact zone immediately in front of the
  // solid head copy, never a replacement for the head collision itself.
  const heads=animalVisibleHeadBaseGeometries(a),ang=Number(a?.angle)||0,ca=Math.cos(ang),sa=Math.sin(ang);
  if(heads.length){
    const ax=Number(a?.x)||0,ay=Number(a?.y)||0;let front=heads[0],frontEdge=-Infinity;
    for(const h of heads){const along=(h.x-ax)*ca+(h.y-ay)*sa+h.r;if(along>frontEdge){frontEdge=along;front=h;}}
    const attackR=Math.max(2.2,front.r*.34),forward=front.r+attackR*.72;
    return{x:front.x+ca*forward,y:front.y+sa*forward,r:attackR};
  }
  const r=Math.max(4,Number(a?.r)||18);
  return{x:(Number(a?.x)||0)+ca*r*1.28,y:(Number(a?.y)||0)+sa*r*1.28,r:Math.max(2.2,r*.14)};
}
function animalSolidHeadGeometry(a){const hs=animalSolidHeadGeometries(a);if(!hs.length)return null;return hs.reduce((best,h)=>!best||h.r>best.r?h:best,null);}
function animalTargetDamageCircles(ref,target){
  if(!target)return[];
  if(ref?.kind==="animal"||ref?.kind==="pet"){
    return animalTorsoHeadCircles(target).map(h=>({...h}));
  }
  const rr=ref?.kind==="player"?PLAYER_R*.82:Math.max(2,(target.r||16)*.78);
  return[{x:target.x,y:target.y,r:rr}];
}
function animalAttackContact(a,ref,target,extraGrace=0){
  if(!a||!target)return false;
  if(ref?.kind==="player"&&(target.dead||target.health<=0))return false;
  if(ref?.kind==="pet"&&(target.dead||target.hp<=0))return false;
  const h=animalFaceGeometry(a),grace=Math.max(0,Number(extraGrace)||0);
  for(const th of animalTargetDamageCircles(ref,target)){
    const toward=angTo(a.x,a.y,th.x,th.y);
    if(Math.abs(angleDiff(a.angle||0,toward))>1.22)continue;
    if(dist(h.x,h.y,th.x,th.y)<=h.r+th.r+2+grace)return true;
  }
  return false;
}
function petAttackContact(a,ref,target){
  return animalAttackContact(a,ref,target);
}
function animalTargetOverlap(a,ref,target){
  if(!a||!target)return 0;
  const source=animalPhysicalCircles(a);
  const targets=(ref?.kind==="animal"||ref?.kind==="pet")
    ? animalPhysicalCircles(target)
    : [{x:target.x,y:target.y,r:ref?.kind==="player"?PLAYER_R*.82:Math.max(8,(target.r||16)*.82)}];
  let deepest=0;
  for(const h of source)for(const th of targets){
    const d=dist(h.x,h.y,th.x,th.y);
    // +3 is only contact tolerance for network sampling. Animal/pet targets use
    // their copied torso+head geometry too, never a center-radius shortcut.
    deepest=Math.max(deepest,h.r+th.r+3-d);
  }
  return Math.max(0,deepest);
}
function typeHp(type, stage) {
  const base=ANIMAL_STAGE_HP[stage]??ANIMAL_STAGE_HP.adult;
  const b=animalBalance(type),babyMul=stage==="baby"?(b.babyHpMul||1):1,bigMul=stage==="bigmomma"?(BIG_MOMMA_HP_MUL[type]??1):1;
  return Math.max(12,Math.round(base*b.hpMul*babyMul*bigMul));
}
function typeDmg(type, stage) {
  return animalBalance(type).attack*(ANIMAL_STAGE_ATTACK[stage]??1);
}
function animalWeightSpeedFactor(weight){
  const w=Math.max(.45,Number(weight)||1);
  return clamp(Math.pow(1.45/w,.18),.62,1.15);
}
function animalKnockbackScale(a){
  return clamp(animalPushMobility(a)*1.22,.10,1);
}
const ANIMAL_SPECIES_SPEED_PROFILE=Object.freeze({
  dog:{baby:1.08,adult:1,boss:.96,superboss:.93,bigmomma:.90,massBlend:.60},
  cat:{baby:1.15,adult:1.08,boss:1.03,superboss:1,bigmomma:.96,massBlend:.45},
  dragon:{baby:1,adult:.96,boss:.92,superboss:.88,bigmomma:.84,massBlend:.65},
  fox:{baby:1.18,adult:1.12,boss:1.08,superboss:1.04,bigmomma:1,massBlend:.40},
  wolf:{baby:1.12,adult:1.08,boss:1.04,superboss:1,bigmomma:.96,massBlend:.55},
  bear:{baby:.95,adult:.90,boss:.84,superboss:.78,bigmomma:.72,massBlend:1},
  rabbit:{baby:1.22,adult:1.16,boss:1.12,superboss:1.08,bigmomma:1.04,massBlend:.25},
  owl:{baby:1.12,adult:1.10,boss:1.08,superboss:1.06,bigmomma:1.04,massBlend:.30},
  snake:{baby:1.28,adult:1.25,boss:1.22,superboss:1.20,bigmomma:1.18,massBlend:.18},
  deer:{baby:1.14,adult:1.10,boss:1.07,superboss:1.04,bigmomma:1,massBlend:.50},
  boar:{baby:1.03,adult:.98,boss:.93,superboss:.88,bigmomma:.84,massBlend:.85},
  saber:{baby:1.15,adult:1.12,boss:1.08,superboss:1.04,bigmomma:1,massBlend:.55},
  clouded:{baby:1.18,adult:1.14,boss:1.10,superboss:1.06,bigmomma:1.02,massBlend:.50},
  queenbee:{baby:1.08,adult:1.02,boss:.99,superboss:.96,bigmomma:.92,massBlend:.26},
  workerbee:{baby:1.18,adult:1.13,boss:1.08,superboss:1.03,bigmomma:.98,massBlend:.18},
  dronebee:{baby:1.14,adult:1.09,boss:1.04,superboss:1,bigmomma:.96,massBlend:.22}
});
function animalSpeed(type, stage, owned=false, extraWeightMul=1) {
  const base=PET_TYPES[type]?.baseSpeed||60,profile=ANIMAL_SPECIES_SPEED_PROFILE[type]||ANIMAL_SPECIES_SPEED_PROFILE.dog;
  const stageMul=Number(profile[stage])||1;
  const effectiveWeight=animalWeight(type,stage)*Math.max(.55,Number(extraWeightMul)||1);
  const rawMassFactor=animalWeightSpeedFactor(effectiveWeight),massBlend=clamp(Number(profile.massBlend)||.6,0,1);
  const speciesMassFactor=1+(rawMassFactor-1)*massBlend;
  return base*stageMul*(owned?1.55:1)*speciesMassFactor;
}

function animalAttackCooldown(type, stage, owned=false){
  if(type==="rabbit"){
    return owned
      ? (stage==="baby"?.46:stage==="adult"?.35:stage==="boss"?.28:.24)
      : (stage==="bigmomma"?.84:stage==="superboss"?.74:stage==="boss"?.62:.78);
  }
  return owned
    ? (stage==="baby"?.55:stage==="adult"?.4:stage==="boss"?.32:.28)
    : (stage==="bigmomma"?1.25:stage==="superboss"?.95:stage==="boss"?.8:1.05);
}
function petArmorDefenseMul(p){const raw=Number(p?.armorTier),tier=Number.isFinite(raw)?Math.floor(raw):-1;if(tier<0)return 1;let m=[.92,.82,.70,.62][clamp(tier,0,3)];if(tier>=3&&String(p?.armorGem||"")==="diamond")m*=.72;return m;}
function petArmorAttackMul(p){return Number(p?.armorTier)>=3&&String(p?.armorGem||"")==="ruby"?1.25:1;}
function petArmorHealFrac(p){return Number(p?.armorTier)>=3&&String(p?.armorGem||"")==="emerald"?.24:0;}
function petAtkDmg(p) {
  const m=p.stage==="baby"?.55:p.stage==="adult"?1:p.stage==="boss"?1.65:p.stage==="superboss"?2.25:2.6;
  const speciesMul=Math.max(.72,Math.min(1.55,animalBalance(p.type).attack/7.5));
  return (6+(p.r||15)*.15)*m*(1+(p.level||1)*.12)*speciesMul*petUpgradeMultiplier(p,"attack")*petStoneFruitStrengthMul(p)*petArmorAttackMul(p);
}
function expNeed(stage, level) { return stage==="baby"?40+level*8:stage==="adult"?70+level*12:stage==="boss"?160+level*26:stage==="superboss"?420+level*45:9999; }
const RUN_SHOP_ITEMS = {
  minerHat:{cat:"hat",cost:25},healerHood:{cat:"hat",cost:35},warriorHelm:{cat:"hat",cost:45},
  tamerCape:{cat:"cape",cost:40},cardCape:{cat:"cape",cost:45},mentorCape:{cat:"cape",cost:50},
  leatherArmor:{cat:"armor",cost:30},ironArmor:{cat:"armor",cost:55},guardianArmor:{cat:"armor",cost:90}
};
const TAME_BASE_CHANCE=Object.assign(Object.fromEntries(Object.keys(PET_TYPES).map(type=>[type,RARITY_TAME_CHANCE[animalRarity(type)]??.38])),{workerbee:.28,queenbee:.12,dronebee:.62});
function beeSleepSpawnChance(type,stage){ if(type!=="queenbee"&&type!=="workerbee"&&type!=="dronebee") return stage==="bigmomma"?0.96:stage==="superboss"?0.88:stage==="boss"?0.75:stage==="baby"?0.65:0; if(type==="queenbee"&&stage==="bigmomma") return 0.985; if(stage==="baby") return 0.84; if(stage==="boss") return 0.28; if(stage==="superboss") return 0.12; if(stage==="bigmomma") return 0.58; return 0.18; }
function beeNapChance(type,stage,enraged=false){ if(type!=="queenbee"&&type!=="workerbee"&&type!=="dronebee") return stage==="baby"?0.10:(["boss","superboss","bigmomma"].includes(stage)&&!enraged?(stage==="bigmomma"?0.22:0.08):0); if(stage==="baby") return 0.20; if(stage==="boss") return enraged?0:0.035; if(stage==="superboss") return enraged?0:0.02; if(stage==="bigmomma") return enraged?0:0.34; return enraged?0:0.014; }
const CURRENT_BIOME_ID="forest";
const MOONMARK_BIOMES={
  forest:{id:"forest",name:"Forest Warden",element:"Forest",color:"#4fa35b",accent:"#d8ef8a",mapColor:"#0b542f",xp:320},
  desert:{id:"desert",name:"Dune Titan",element:"Sand",color:"#d2a24f",accent:"#ffe1a4",mapColor:"#7a4b16",xp:320},
  arctic:{id:"arctic",name:"Frost Crown",element:"Ice",color:"#8dd9ff",accent:"#e7fbff",mapColor:"#39749f",xp:320},
  mountains:{id:"mountains",name:"Peak Crusher",element:"Stone",color:"#9d9aa6",accent:"#ddd9ef",mapColor:"#4f4f58",xp:320},
  rainforest:{id:"rainforest",name:"Jungle Howl",element:"Vine",color:"#2fb06a",accent:"#ccffd6",mapColor:"#165b34",xp:320}
};
const MOONMARK_RADIUS=390;
// Expanded main island: Forest + Rain Forest + Arctic.
// Arctic wildlife now has a real home instead of spawning in the Forest.
const MAIN_WORLD_W=44000,MAIN_WORLD_H=34000;
const ISLAND_CX=WORLD_W*.5,ISLAND_CY=WORLD_H*.5;
const MAIN_WORLD_LEFT=ISLAND_CX-MAIN_WORLD_W*.5,MAIN_WORLD_RIGHT=ISLAND_CX+MAIN_WORLD_W*.5,MAIN_WORLD_TOP=ISLAND_CY-MAIN_WORLD_H*.5,MAIN_WORLD_BOTTOM=ISLAND_CY+MAIN_WORLD_H*.5;
const ISLAND_RADIUS=Math.min(MAIN_WORLD_W,MAIN_WORLD_H)*.415,ISLAND_SHORE_WIDTH=230;
const OUTER_ISLANDS=Object.freeze([
  {id:"reef_isle",cx:ISLAND_CX+22000,cy:ISLAND_CY-4200,r:1080,biome:"rainforest",seed:.73},
  {id:"sunbar_isle",cx:ISLAND_CX+26000,cy:ISLAND_CY+27000,r:920,biome:"desert",seed:1.91},
  {id:"frost_isle",cx:ISLAND_CX+7000,cy:ISLAND_CY-28500,r:820,biome:"arctic",seed:3.17},
  {id:"westwood_isle",cx:ISLAND_CX-21000,cy:ISLAND_CY+11200,r:980,biome:"forest",seed:4.23},
  {id:"southwest_isle",cx:ISLAND_CX-25000,cy:ISLAND_CY+24500,r:900,biome:"desert",seed:5.31},
  {id:"southcap_isle",cx:ISLAND_CX-2500,cy:ISLAND_CY+29200,r:850,biome:"desert",seed:6.47},
  {id:"northeast_isle",cx:ISLAND_CX+24500,cy:ISLAND_CY-23500,r:960,biome:"rainforest",seed:7.53},
  {id:"northwest_isle",cx:ISLAND_CX-24500,cy:ISLAND_CY-23000,r:930,biome:"mountains",seed:8.69},
  {id:"galaxaytropic",cx:ISLAND_CX-30500,cy:ISLAND_CY-1200,r:6200,biome:"galaxytropic",seed:9.77,huge:true}
]);
const OCEAN_DIVE_START=360,OCEAN_SURFACE_NEAR_SHORE=245,BLUE_SEAWEED_DURATION=20,CELEST_FRUIT_DURATION=300;
const OCEAN_DEEP_DAMAGE_START=820,OCEAN_DEEP_DAMAGE_FULL=2200,OCEAN_DEEP_DAMAGE_MIN=4,OCEAN_DEEP_DAMAGE_MAX=16;
const BIOME_ZONES={
  forest:{id:"forest",cx:MAIN_WORLD_LEFT+MAIN_WORLD_W*.41,cy:MAIN_WORLD_TOP+MAIN_WORLD_H*.51},
  rainforest:{id:"rainforest",cx:MAIN_WORLD_LEFT+MAIN_WORLD_W*.74,cy:MAIN_WORLD_TOP+MAIN_WORLD_H*.51},
  arctic:{id:"arctic",cx:MAIN_WORLD_LEFT+MAIN_WORLD_W*.51,cy:MAIN_WORLD_TOP+MAIN_WORLD_H*.12},
  desert:{id:"desert",cx:MAIN_WORLD_LEFT+MAIN_WORLD_W*.53,cy:MAIN_WORLD_TOP+MAIN_WORLD_H*.91},
  mountains:{id:"mountains",cx:MAIN_WORLD_LEFT+MAIN_WORLD_W*.15,cy:MAIN_WORLD_TOP+MAIN_WORLD_H*.49}
};
const BIOME_ORDER=["forest","rainforest","arctic","desert","mountains"];
const BIOME_PROFILES={
  forest:{id:"forest",name:"Forest",species:["dog","cat","boar","fox","bear","owl","deer","wolf","saber","rabbit","snake","queenbee","workerbee","dronebee"]},
  rainforest:{id:"rainforest",name:"Rain Forest",species:["snake","dragon","clouded","saber","queenbee","workerbee","dronebee"]},
  arctic:{id:"arctic",name:"Arctic",species:["rabbit"]},
  desert:{id:"desert",name:"Desert",species:["fennec","snake","dragon","boar"]},
  mountains:{id:"mountains",name:"Mountains",species:["dog","wolf","saber","queenbee","workerbee","dronebee"]},
  ocean:{id:"ocean",name:"Ocean",species:[]},
  galaxytropic:{id:"galaxytropic",name:"Galaxaytropic",species:[]}
};
const BIOME_RESOURCE_INFO=Object.freeze({
  forestHerb:{biome:"forest",material:"wildHerb",name:"Wild Herb",color:"#8dcf68",category:"soft",hp:3},
  forestResin:{biome:"forest",material:"treeResin",name:"Tree Resin",color:"#d69a45",category:"wood",hp:4},
  forestGiantFlower:{biome:"forest",material:"pollen",name:"Giant Flower",color:"#ef8ac4",category:"flower",hp:9999},
  desertCactusGood:{biome:"desert",material:"goodCactus",name:"Cactus",color:"#7fbb69",category:"soft",hp:4},
  desertCactusBad:{biome:"desert",material:"badCactus",name:"Cactus",color:"#6aaa57",category:"soft",hp:4},
  desertSandstone:{biome:"desert",material:"sandstone",name:"Sandstone",color:"#d6b66f",category:"stone",hp:5},
  arcticIceCrystal:{biome:"arctic",material:"iceCrystal",name:"Ice Crystal",color:"#8ee7ff",category:"stone",hp:5},
  arcticFrostBerry:{biome:"arctic",material:"frostBerry",name:"Frost Berry",color:"#b8d8ff",category:"soft",hp:3},
  mountainIron:{biome:"mountains",material:"ironOre",name:"Iron Ore",color:"#8d979d",category:"stone",hp:7},
  mountainQuartz:{biome:"mountains",material:"mountainQuartz",name:"Crystal Rock",color:"#ddd8ee",category:"stone",hp:6},
  mountainGem:{biome:"mountains",material:"mountainGem",name:"Gem Cluster",color:"#8dc7d9",category:"stone",hp:7},
  mountainStoneFruit:{biome:"mountains",material:"stoneFruit",name:"Stone Fruit",color:"#9a8cad",category:"soft",hp:4},
  rainforestVine:{biome:"rainforest",material:"jungleVine",name:"Jungle Vine",color:"#4f9f56",category:"wood",hp:4},
  rainforestFruit:{biome:"rainforest",material:"jungleBerry",name:"Jungle Fruit",color:"#f06d55",category:"soft",hp:3},
  rainforestGiantFlower:{biome:"rainforest",material:"pollen",name:"Giant Flower",color:"#8edbff",category:"flower",hp:9999},
  rainforestHive:{biome:"rainforest",material:"honeycomb",name:"Giant Hive",color:"#f2bf35",category:"soft",hp:14},
  oceanUrchin:{biome:"ocean",material:"seaFruit",name:"Sea Fruit",color:"#d58bd7",category:"soft",hp:4},
  oceanAnemone:{biome:"ocean",material:"seaFruit",name:"Sea Fruit",color:"#ef8fae",category:"soft",hp:5},
  oceanBlueSeaweed:{biome:"ocean",material:"blueSeaweed",name:"Blue Seaweed",color:"#59c7de",category:"soft",hp:4},
  oceanGreenSeaweed:{biome:"ocean",material:"greenSeaweed",name:"Green Seaweed",color:"#54c878",category:"soft",hp:4},
  galaxyCelestFruit:{biome:"galaxytropic",material:"celestFruit",name:"Celest Fruit",color:"#d9a6ff",category:"soft",hp:5}
});
function islandDistance(x,y){return Math.hypot(x-ISLAND_CX,y-ISLAND_CY);}
function islandAngleDelta(a,b){let d=(a-b)%TAU;if(d>Math.PI)d-=TAU;else if(d<-Math.PI)d+=TAU;return d;}
function islandRadiusAtAngle(angle,pad=0){
  const a=Number(angle)||0,c=Math.cos(a),s=Math.sin(a),rx=MAIN_WORLD_W*.5,ry=MAIN_WORLD_H*.5;
  const base=1/Math.sqrt((c*c)/(rx*rx)+(s*s)/(ry*ry));
  let scale=.920+Math.sin(a*3.00+.35)*.045+Math.sin(a*5.00-1.10)*.028+Math.sin(a*9.00+1.70)*.014;
  scale+=Math.exp(-Math.pow(islandAngleDelta(a,-Math.PI*.5)/.55,2))*.055;
  scale+=Math.exp(-Math.pow(islandAngleDelta(a,Math.PI)/.60,2))*.045;
  scale+=Math.exp(-Math.pow(islandAngleDelta(a,.30)/.45,2))*.025;
  scale-=Math.exp(-Math.pow(islandAngleDelta(a,2.20)/.32,2))*.075;
  scale-=Math.exp(-Math.pow(islandAngleDelta(a,-.65)/.30,2))*.045;
  scale=clamp(scale,.78,1.04);
  return Math.max(80,base*scale-(Number(pad)||0));
}
function isInsideIsland(x,y,pad=0){const dx=Number(x)-ISLAND_CX,dy=Number(y)-ISLAND_CY,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx);return d<=islandRadiusAtAngle(a,pad);}
function outerIslandRadiusAtAngle(spec,angle,pad=0){const ss=Number(spec?.seed)||0,base=Math.max(120,Number(spec?.r)||700),a=Number(angle)||0,scale=1+Math.sin(a*3.0+ss)*.10+Math.sin(a*5.1-ss*.7)*.05+Math.sin(a*7.3+ss*1.4)*.025;return Math.max(80,base*clamp(scale,.78,1.24)-(Number(pad)||0));}
function isInsideOuterIsland(spec,x,y,pad=0){if(!spec)return false;const dx=x-spec.cx,dy=y-spec.cy,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx);return d<=outerIslandRadiusAtAngle(spec,a,pad);}
function outerIslandAt(x,y,pad=0){for(const spec of OUTER_ISLANDS)if(isInsideOuterIsland(spec,x,y,pad))return spec;return null;}
function isInsideAnyLand(x,y,pad=0){return isInsideIsland(x,y,pad)||!!outerIslandAt(x,y,pad);}
function mainIslandSignedCoastDistance(x,y){const dx=Number(x)-ISLAND_CX,dy=Number(y)-ISLAND_CY,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx);return d-islandRadiusAtAngle(a,0);}
function outerIslandSignedCoastDistance(spec,x,y){const dx=x-spec.cx,dy=y-spec.cy,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx);return d-outerIslandRadiusAtAngle(spec,a,0);}
function oceanDepthAt(x,y){if(!Number.isFinite(x)||!Number.isFinite(y)||isInsideAnyLand(x,y,0))return 0;let best=Math.max(0,mainIslandSignedCoastDistance(x,y));for(const spec of OUTER_ISLANDS)best=Math.min(best,Math.max(0,outerIslandSignedCoastDistance(spec,x,y)));return Math.max(0,best);}
function landDepthToCoastAt(x,y){let best=Infinity;const main=-mainIslandSignedCoastDistance(x,y);if(main>=0)best=Math.min(best,main);for(const spec of OUTER_ISLANDS){const d=-outerIslandSignedCoastDistance(spec,x,y);if(d>=0)best=Math.min(best,d);}return Number.isFinite(best)?best:0;}
function nearOceanShore(x,y,range=190){return worldBiomeAt(x,y)==="ocean"?oceanDepthAt(x,y)<=range:landDepthToCoastAt(x,y)<=range;}
const VEHICLE_BEACH_INLAND=125,VEHICLE_PLACE_COAST_RANGE=135;
function placedVehicleType(w){const k=String(w?.kind||"");return k.startsWith("vehicleSub")?"Sub":k.startsWith("vehicleBoat")?"Boat":"";}
function placedVehicleTier(w){const m=String(w?.kind||"").match(/^vehicle(?:Boat|Sub)(\d+)/);return clamp(Math.floor(Number(m?.[1])||0),0,3);}
function placedVehicleVariant(w){const m=String(w?.kind||"").match(/@([a-z]+)$/i);return String(m?.[1]||"").toLowerCase();}
function vehicleSpeedMul(type,tier=0,variant=""){tier=clamp(Math.floor(Number(tier)||0),0,3);let m=type==="Sub"?[1.38,1.72,2.08,2.34][tier]:[1.55,1.92,2.32,2.56][tier];if(tier>=3&&variant==="ruby")m*=1.16;else if(tier>=3&&variant==="emerald")m*=1.08;else if(tier>=3&&variant==="diamond")m*=1.04;return m;}
function divingSuitMoveMulServer(p){const tier=clamp(Math.floor(Number(p?.divingSuitTier)||0),0,3);let m=[.86,.93,1,1.05][tier];if(tier>=3&&String(p?.divingSuitVariant||"")==="ruby")m=1.14;return m;}
function divingSuitOxygenMaxServer(p){const tier=clamp(Math.floor(Number(p?.divingSuitTier)||0),0,3),v=String(p?.divingSuitVariant||"");let sec=[45,60,80,100][tier]||45;if(tier>=3&&v==="diamond")sec=120;return sec;}
function divingSuitOxygenDrainMulServer(p){return clamp(Math.floor(Number(p?.divingSuitTier)||0),0,3)>=3&&String(p?.divingSuitVariant||"")==="emerald"?.65:1;}
function divingSuitSuffocationMulServer(p){return clamp(Math.floor(Number(p?.divingSuitTier)||0),0,3)>=3&&String(p?.divingSuitVariant||"")==="diamond"?.68:1;}
function isPlacedVehicleWall(w){return !!placedVehicleType(w);}
function vehicleTravelAllowed(x,y){return worldBiomeAt(x,y)==="ocean"||landDepthToCoastAt(x,y)<=VEHICLE_BEACH_INLAND;}
function vehiclePlacementAllowed(x,y){return nearOceanShore(x,y,VEHICLE_PLACE_COAST_RANGE)&&vehicleTravelAllowed(x,y);}
function vehicleAngleValue(a){a=Number(a)||0;return((a%TAU)+TAU)%TAU;}
function randomOceanFloorPoint(minDepth=390,maxDepth=1900){
  minDepth=Math.max(120,Number(minDepth)||390);maxDepth=Math.max(minDepth+40,Number(maxDepth)||1900);
  for(let tries=0;tries<90;tries++){
    const useOuter=Math.random()<.14&&OUTER_ISLANDS.length;let x,y;
    if(useOuter){const spec=OUTER_ISLANDS[randi(0,OUTER_ISLANDS.length-1)],a=rand(0,TAU),coast=outerIslandRadiusAtAngle(spec,a,0),dd=rand(minDepth,Math.min(maxDepth,1400));x=spec.cx+Math.cos(a)*(coast+dd);y=spec.cy+Math.sin(a)*(coast+dd);}
    else{const a=rand(0,TAU),coast=islandRadiusAtAngle(a,0),dd=rand(minDepth,maxDepth);x=ISLAND_CX+Math.cos(a)*(coast+dd);y=ISLAND_CY+Math.sin(a)*(coast+dd);}
    if(x<80||x>WORLD_W-80||y<80||y>WORLD_H-80||worldBiomeAt(x,y)!=="ocean")continue;
    const d=oceanDepthAt(x,y);if(d>=minDepth&&d<=maxDepth)return{x,y};
  }
  const a=rand(0,TAU),coast=islandRadiusAtAngle(a,0),dd=minDepth+80;
  return{x:clamp(ISLAND_CX+Math.cos(a)*(coast+dd),80,WORLD_W-80),y:clamp(ISLAND_CY+Math.sin(a)*(coast+dd),80,WORLD_H-80)};
}
function oceanDepthDamageRateAt(x,y){const d=oceanDepthAt(x,y);if(d<=OCEAN_DEEP_DAMAGE_START)return 0;const q=clamp((d-OCEAN_DEEP_DAMAGE_START)/Math.max(1,OCEAN_DEEP_DAMAGE_FULL-OCEAN_DEEP_DAMAGE_START),0,1);return OCEAN_DEEP_DAMAGE_MIN+(OCEAN_DEEP_DAMAGE_MAX-OCEAN_DEEP_DAMAGE_MIN)*q;}
function islandConstrainedPoint(x,y,pad=0){const px=Number(x)||ISLAND_CX,py=Number(y)||ISLAND_CY,dx=px-ISLAND_CX,dy=py-ISLAND_CY,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx),r=islandRadiusAtAngle(a,Math.max(0,Number(pad)||0));if(d<=r||d<1e-6)return{x:px,y:py};const q=r/d;return{x:ISLAND_CX+dx*q,y:ISLAND_CY+dy*q};}
function keepObjectOnIsland(obj,pad=20){if(!obj)return;const p=islandConstrainedPoint(Number(obj.x)||ISLAND_CX,Number(obj.y)||ISLAND_CY,pad);obj.x=p.x;obj.y=p.y;}
function outerIslandById(id){return OUTER_ISLANDS.find(spec=>spec.id===String(id||""))||null;}
function outerIslandConstrainedPoint(spec,x,y,pad=0){if(!spec)return{x:Number(x)||ISLAND_CX,y:Number(y)||ISLAND_CY};const px=Number(x)||spec.cx,py=Number(y)||spec.cy,dx=px-spec.cx,dy=py-spec.cy,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx),r=outerIslandRadiusAtAngle(spec,a,Math.max(0,Number(pad)||0));if(d<=r||d<1e-6)return{x:px,y:py};const q=r/d;return{x:spec.cx+dx*q,y:spec.cy+dy*q};}
function keepObjectOnLandmass(obj,pad=20){if(!obj)return;const spec=outerIslandById(obj._outerIslandId);if(spec){const p=outerIslandConstrainedPoint(spec,Number(obj.x)||spec.cx,Number(obj.y)||spec.cy,pad);obj.x=p.x;obj.y=p.y;return;}keepObjectOnIsland(obj,pad);}
function randomPointOnOuterIsland(spec,pad=80){if(!spec)return{x:ISLAND_CX,y:ISLAND_CY};const safe=Math.max(24,Number(pad)||0);for(let tries=0;tries<120;tries++){const a=rand(0,TAU),coast=outerIslandRadiusAtAngle(spec,a,safe),rr=Math.sqrt(Math.random())*Math.max(24,coast*.88),x=spec.cx+Math.cos(a)*rr,y=spec.cy+Math.sin(a)*rr;if(isInsideOuterIsland(spec,x,y,safe))return{x,y};}return{x:spec.cx,y:spec.cy};}
const BIOME_SCORE_SHAPES=Object.freeze({mountains:{cx:-.70,cy:-.03,sx:.48,sy:.82,bias:.09,seed:1.7},forest:{cx:-.18,cy:.02,sx:.66,sy:.78,bias:.10,seed:3.1},rainforest:{cx:.48,cy:.02,sx:.62,sy:.78,bias:.10,seed:4.4},arctic:{cx:.02,cy:-.83,sx:.92,sy:.44,bias:-.05,seed:5.6},desert:{cx:.06,cy:.84,sx:.94,sy:.43,bias:-.06,seed:7.2}});
function biomeOrganicNoise(nx,ny,seed){return Math.sin(nx*5.3+ny*2.1+seed)*.24+Math.sin(nx*2.2-ny*6.1+seed*1.6)*.18+Math.sin((nx+ny)*9.2+seed*.7)*.11+Math.sin(nx*12.7-ny*4.8+seed*.37)*.09+Math.sin(nx*18.2+ny*14.1+seed*1.13)*.055;}
function biomeScoresAt(x,y){const nx=(Number(x)-ISLAND_CX)/Math.max(1,MAIN_WORLD_W*.5),ny=(Number(y)-ISLAND_CY)/Math.max(1,MAIN_WORLD_H*.5),out={};for(const id of BIOME_ORDER){const q=BIOME_SCORE_SHAPES[id],dx=(nx-q.cx)/q.sx,dy=(ny-q.cy)/q.sy;out[id]=-(dx*dx+dy*dy)+q.bias+biomeOrganicNoise(nx,ny,q.seed);}return out;}
function forestRainBoundaryX(y){const yn=(y-ISLAND_CY)/Math.max(1,ISLAND_RADIUS);return ISLAND_CX+MAIN_WORLD_W*.04+Math.sin(yn*Math.PI*1.25)*MAIN_WORLD_W*.035+Math.sin(yn*Math.PI*2.8+1.2)*MAIN_WORLD_W*.012;}
function arcticBoundaryY(x){const xn=(x-ISLAND_CX)/Math.max(1,ISLAND_RADIUS);return ISLAND_CY-ISLAND_RADIUS*.55+Math.sin(xn*Math.PI*1.8+.45)*MAIN_WORLD_H*.024+Math.sin(xn*Math.PI*4.4-1.1)*MAIN_WORLD_H*.010;}
function desertBoundaryY(x){const xn=(x-ISLAND_CX)/Math.max(1,ISLAND_RADIUS);return ISLAND_CY+ISLAND_RADIUS*.55+Math.sin(xn*Math.PI*1.55-.35)*MAIN_WORLD_H*.020+Math.sin(xn*Math.PI*3.2+1.4)*MAIN_WORLD_H*.008;}
function mountainBoundaryX(y){const yn=(y-ISLAND_CY)/Math.max(1,ISLAND_RADIUS);return ISLAND_CX-ISLAND_RADIUS*.72+Math.sin(yn*Math.PI*1.7+.6)*MAIN_WORLD_H*.012+Math.sin(yn*Math.PI*3.9-.9)*MAIN_WORLD_H*.004;}
function worldBiomeAt(x,y){const outer=outerIslandAt(x,y,0);if(outer)return outer.biome;if(!isInsideIsland(x,y,0))return "ocean";const scores=biomeScoresAt(x,y);let best="forest",bestScore=-Infinity;for(const id of BIOME_ORDER){const sc=Number(scores[id]);if(sc>bestScore){bestScore=sc;best=id;}}return best;}
let BIOME_AREA_COUNT_CACHE=null;
function biomeAreaCounts(){if(BIOME_AREA_COUNT_CACHE)return BIOME_AREA_COUNT_CACHE;const counts=Object.fromEntries(BIOME_ORDER.map(id=>[id,0])),cols=72,rows=56;for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){const x=MAIN_WORLD_LEFT+(gx+.5)/cols*MAIN_WORLD_W,y=MAIN_WORLD_TOP+(gy+.5)/rows*MAIN_WORLD_H;if(!isInsideIsland(x,y,0))continue;const id=biomeBaseId(worldBiomeAt(x,y));if(counts[id]!=null)counts[id]++;}BIOME_AREA_COUNT_CACHE=counts;return counts;}
function biomeAreaScale(id){const counts=biomeAreaCounts(),total=BIOME_ORDER.reduce((n,k)=>n+(counts[k]||0),0),avg=total/Math.max(1,BIOME_ORDER.length),v=(counts[biomeBaseId(id)]||avg)/Math.max(1,avg);return clamp(v,.65,1.65);}
function scaledBiomeSpawnCount(base,biome,minCount=1){return Math.max(minCount,Math.round(Math.max(0,Number(base)||0)*biomeAreaScale(biome)));}
function resourceBiomeAreaScale(id){const counts=biomeAreaCounts(),total=BIOME_ORDER.reduce((n,k)=>n+(counts[k]||0),0),avg=total/Math.max(1,BIOME_ORDER.length),v=(counts[biomeBaseId(id)]||avg)/Math.max(1,avg);return clamp(Math.pow(Math.max(.05,v),1.18),.58,2.15);}
function scaledBiomeResourceCount(base,biome,minCount=1){return Math.max(minCount,Math.round(Math.max(0,Number(base)||0)*1.8*resourceBiomeAreaScale(biome)));}
function randomBiomeZoneId(){const counts=biomeAreaCounts(),total=BIOME_ORDER.reduce((n,id)=>n+(counts[id]||0),0);let roll=Math.random()*Math.max(1,total);for(const id of BIOME_ORDER){roll-=counts[id]||0;if(roll<=0)return id;}return "forest";}
function speciesAllowedBiomes(type){const out=[];for(const id of BIOME_ORDER)if((BIOME_PROFILES[id]?.species||[]).includes(type))out.push(id);return out.length?out:["forest"];}
function speciesHomeBiome(type){return speciesAllowedBiomes(type)[0]||"forest";}
function nearestAllowedBiomeFor(type,x,y,preferred=""){const allowed=speciesAllowedBiomes(type),p=biomeBaseId(preferred);if(allowed.includes(p))return p;let best=allowed[0]||"forest",bestD=Infinity;for(const id of allowed){const z=BIOME_ZONES[id]||BIOME_ZONES.forest,d=dist(x,y,z.cx,z.cy);if(d<bestD){bestD=d;best=id;}}return best;}
function randomPointInBiome(biomeId,pad=120){const wanted=BIOME_ORDER.includes(biomeBaseId(biomeId))?biomeBaseId(biomeId):"forest",safePad=Math.max(0,Number(pad)||0),l=MAIN_WORLD_LEFT+safePad,r=MAIN_WORLD_RIGHT-safePad,t=MAIN_WORLD_TOP+safePad,b=MAIN_WORLD_BOTTOM-safePad;for(let tries=0;tries<900;tries++){const x=rand(l,r),y=rand(t,b);if(worldBiomeAt(x,y)===wanted)return{x,y};}const zone=BIOME_ZONES[wanted]||BIOME_ZONES.forest;return{x:zone.cx,y:zone.cy};}
function randomLandPoint(pad=120){ return randomPointInBiome(randomBiomeZoneId(),pad); }
function isHotDryBiome(id){return String(id||"").startsWith("desert");}
function pondShapeFactor(r,theta){
  const seed=Number(r?.rot)||0;
  const f=1
    +Math.sin(theta*3+seed*1.73)*.085
    +Math.sin(theta*5-seed*.91+1.2)*.052
    +Math.sin(theta*7+seed*2.27-.8)*.026;
  return clamp(f,.82,1.18);
}
function riverCenterOffsetLocal(r,x,rx,ry){const u=clamp(x/Math.max(1,rx),-1,1),seed=Number(r?.rot)||0;return Math.sin((u+1)*Math.PI*1.35+seed*2.1)*ry*.28+Math.sin((u+1)*Math.PI*2.7-seed*.8)*ry*.10;}
function riverHalfWidthLocal(r,x,rx,ry){const u=clamp(x/Math.max(1,rx),-1,1),seed=Number(r?.rot)||0,taper=Math.sqrt(Math.max(.05,1-u*u)),variation=1+Math.sin((u+1)*Math.PI*3.0+seed*1.7)*.16+Math.sin((u+1)*Math.PI*5.0-seed*.9)*.07;return Math.max(8,ry*taper*variation);}
function waterNearPoint(r,x,y,extra=78){
  if(!r||(r.type!=="pond"&&r.type!=="river"))return false;
  const ang=-(Number(r.rot)||0),ca=Math.cos(ang),sa=Math.sin(ang),dx=x-r.x,dy=y-r.y;
  const lx=dx*ca-dy*sa,ly=dx*sa+dy*ca,rx=Math.max(1,Number(r.solidR)||90),ry=Math.max(1,Number(r.canopyR)||rx*.72);
  const edgePad=Math.max(0,Number(extra)||0)/Math.max(20,Math.min(rx,ry));
  const nx=lx/rx,ny=ly/ry,n=Math.hypot(nx,ny);
  if(r.type==="pond")return n<=pondShapeFactor(r,Math.atan2(ny,nx))+edgePad;
  const center=riverCenterOffsetLocal(r,lx,rx,ry),half=riverHalfWidthLocal(r,lx,rx,ry),pad=Math.max(0,Number(extra)||0);
  return Math.abs(lx)<=rx+pad&&Math.abs(ly-center)<=half+pad;
}
function waterPlacementClear(resources,x,y,solidR,canopyR,gap=34){
  const candidateR=Math.max(1,Number(solidR)||90,Number(canopyR)||0);
  for(const[,r]of resources){
    if(!r||!r.alive||(r.type!=="pond"&&r.type!=="river"))continue;
    const existingR=Math.max(1,Number(r.solidR)||90,Number(r.canopyR)||0);
    if(dist(x,y,r.x,r.y)<candidateR+existingR+Math.max(0,Number(gap)||0))return false;
  }
  return true;
}
const PET_KILL_STAGE_XP={baby:3,adult:14,boss:38,superboss:86,bigmomma:155};
const PET_ANIMAL_KILL_CARD_CHANCE=0.35;
const TAME_SPECIES_CARD_REWARD=1;
const PET_KILL_SPECIES_XP={rabbit:.65,dog:.85,cat:.90,fox:1.0,deer:1.05,dragon:1.15,wolf:1.25,bear:1.65,boar:1.30,snake:1.15,owl:1.10,saber:2.0,clouded:1.55};
const PET_KILL_HOSTL_XP={Brawler:12,Swordsman:16,Rider:24,Tamer:26,Ranger:30,Chimest:34};
function petKillXpForAnimal(a){return Math.max(1,Math.round((PET_KILL_STAGE_XP[a?.stage]??14)*(PET_KILL_SPECIES_XP[a?.type]??1)));}
function petKillXpForEnemy(en){if(!en)return 0;if(en.moonMarked)return MOONMARK_BIOMES[en.moonBiome||CURRENT_BIOME_ID]?.xp||320;return PET_KILL_HOSTL_XP[en.role]??(en.strong?30:14);}

function petFollowRangeFor(p){
  const bodyR=Math.max(10,Number(p?.r)||18),moveSpeed=Math.max(24,Number(p?.speed)||60);
  // Personal space is based on physical size. Roaming freedom is based on speed:
  // fast pets may wander farther, slow pets naturally stay closer.
  const stop=clamp(PLAYER_R+bodyR*.76+16,48,150);
  const roamBand=clamp(34+moveSpeed*.72,58,230);
  const wanderMax=stop+roamBand;
  const settle=stop+roamBand*.55;
  const start=wanderMax+22;
  const run=start+clamp(85+moveSpeed*.42,105,235);
  const dash=run+clamp(125+moveSpeed*.55,150,320);
  return{stop,settle,start,run,dash,sprint:dash,wanderMax};
}
function wildPlayerAggroRange(a){
  if(a?.tameFailedAggro)return 330;
  if(a?.desperateAggro)return 290;
  if(a?.enraged){
    if(a.stage==="bigmomma")return 360;
    if(a.stage==="superboss")return 320;
    if(a.stage==="boss")return 290;
    return 260;
  }
  if(a&&["boss","superboss","bigmomma"].includes(a.stage))return 220;
  return a?.type==="bear"?165:180;
}
function wildAggroForgetRange(a){return Math.min(430,wildPlayerAggroRange(a)+70);}


const ACTIVE_CUBE_PLAYER_KEYS = new Set();
export function getCubeServerStats() {
  return { playersOnline: ACTIVE_CUBE_PLAYER_KEYS.size };
}

export class WorldRoom extends Room {
  maxClients=12;

  onCreate(options = {}) {
    this.setState(new WorldState());
    this.worldId = normalizeWorldId(options?.worldId);
    this.state.worldId = this.worldId;
    this.nextResourceId=1; this.nextGoldId=1; this.nextChestId=1; this.nextAnimalId=1; this.nextPetId=1;
    this.playerPetStatUpgrades=new Map();
    this.nextEnemyId=1; this.nextWallId=1; this.nextTowerId=1; this.nextProjectileId=1;
    this.resourceRespawns=new Map(); this.harvestCredits=new Map(); this.goldHandCredits=new Map(); this.playerBiomeMaterials=new Map();
    this.playerAttackCd=new Map(); this.playerShootCd=new Map(); this.playerStoneFruitStacks=new Map(); this.enemyAggro=new Map(); this.animalAggro=new Map();
    // Mirrors offline a.fleeFrom and hostile wild Dog wall ownership without
    // adding server-only targeting objects to the synchronized schema.
    this.animalFleeFrom=new Map(); this.hostileWildWalls=new Map();
    this.petFocusTargets=new Map();
    this.petHuntState=new Map();
    // Server-only idle-wander/follow state. Keeping this out of the Colyseus
    // schema avoids sending wander targets and stuck timers over the network.
    this.petFollowState=new Map();
    this.petChaseState=new Map();
    this.playerRunShop=new Map(); this.playerSkillProgress=new Map(); this.tamePendingPlayers=new Set(); this.playerHiveSessions=new Map();
    this.playerCarryUntil=new Map(); this.playerCarryAnimal=new Map();
    this.wallSpikeNext=new Map(); this.wallEnemyNext=new Map();
    this.enemyPetByEnemy=new Map(); this.enemyOwnerByPet=new Map(); this.ownerThreat=new Map();
    this.firstLightReadyPlayers=new Set(); this.midnightMarkSpawned=false; this.petXpContrib=new Map();
    this.wildMateTargets=new Map(); this.wildLastBreedDay=new Map();
    this.populationKeys=new Map();this.playerAccountIds=new Map();this.playerAccountEntitlements=new Map();this.playerSurvivalSeconds=new Map();this.playerSurvivalAwards=new Map();this.playerNightSeen=new Set();
    // A connected client is not a combat participant until its Play transition
    // is finished. This prevents Hostls/wildlife/PvP from damaging a player
    // while the browser is still joining or preparing the first frame.
    this.playerCombatReadyAt=new Map();
    // Track input timing/sequence so fast mounts can send a position after a lag
    // gap without the server clamping it back to an old fixed-distance limit.
    this.playerInputNetState=new Map();
    this.fxQueue=[]; this.fxFlushAccum=0; this.pendingPlayerHits=new Map(); this.hitFlushAccum=0;
    this.pendingAnimalPushes=new Map(); this.pushFlushAccum=0;
    this.petDeathTimers=new Map(); this.abilityDots=new Map(); this.activePetAbilities=[]; this.activeWildAbilities=[]; this.solidGrid=new Map(); this.dynamicGrid=new Map(); this.chestRewards=new Map(); this.chatLastSent=new Map(); this.waveTimer=4;
    // Terrain/biomes are fixed and shared, but resources, chests and wildlife are
    // live room state. A new room gets fresh random placements; every client in
    // that room receives the same authoritative live positions.
    this.generateWorld();
    // Organize rainforest bees around their giant hives before clients see the
    // initial wildlife snapshot.
    this.organizeRainforestHives();
    // Explicitly publish when the complete starting wildlife set exists. The
    // browser keeps the Play button loading until it has received this many
    // animals, so wildlife never visibly pops in after gameplay begins.
    this.state.initialAnimalCount = this.state.animals.size;
    this.state.wildlifeCount = this.state.animals.size;
    this.state.worldReady = true;
    this.rebuildDynamicGrid();

    // Keep combat/physics at 20 TPS, but send state patches at 10 Hz. The client
    // interpolates moving entities, cutting multiplayer bandwidth substantially.
    if (typeof this.setPatchRate === "function") this.setPatchRate(100);
    else this.patchRate = 100;
    this.setSimulationInterval((delta)=>this.update(delta/1000),1000/20);

    this.onMessage("input",(client,input={})=>this.handleInput(client,input));
    this.onMessage("resourceHit",(client,data={})=>this.handleResourceHit(client,data));
    this.onMessage("subClaw",(client,data={})=>this.handleSubClaw(client,data));
    this.onMessage("goldHit",(client,data={})=>this.handleGoldHit(client,data));
    this.onMessage("attack",(client,data={})=>this.handleAttack(client,data));
    this.onMessage("throwAxe",(client,data={})=>this.handleThrowAxe(client,data));
    this.onMessage("throwChakram",(client,data={})=>this.handleThrowChakram(client,data));
    this.onMessage("playFlute",(client,data={})=>this.handlePlayFlute(client,data));
    this.onMessage("biomeFood",(client,data={})=>this.handleBiomeFood(client,data));
    this.onMessage("shoot",(client,data={})=>this.handleShoot(client,data));
    this.onMessage("tame",(client,data={})=>this.handleTame(client,data));
    this.onMessage("hiveEnter",(client,data={})=>this.handleHiveEnter(client,data));
    this.onMessage("hiveTameLarva",(client,data={})=>this.handleHiveTameLarva(client,data));
    this.onMessage("hiveDamage",(client,data={})=>this.handleHiveDamage(client,data));
    this.onMessage("hiveExit",(client,data={})=>this.handleHiveExit(client,data));
    this.onMessage("runShopBuy",(client,data={})=>this.handleRunShopBuy(client,data));
    this.onMessage("skillChoice",(client,data={})=>this.handleSkillChoice(client,data));
    this.onMessage("build",(client,data={})=>this.handleBuild(client,data));
    this.onMessage("vehicleBoard",(client,data={})=>this.handleVehicleBoard(client,data));
    this.onMessage("equipPetArmor",(client,data={})=>this.handleEquipPetArmor(client,data));
    this.onMessage("heal",(client,data={})=>this.handleHeal(client,data));
    this.onMessage("waterAction",(client,data={})=>this.handleWaterAction(client,data));
    this.onMessage("respawn",(client,data={})=>this.handleRespawn(client,data));
    this.onMessage("revive",(client,data={})=>this.handleRevive(client,data));
    this.onMessage("playerReady",(client)=>this.handlePlayerReady(client));
    this.onMessage("playerPreview",(client)=>this.handlePlayerPreview(client));
    this.onMessage("playerProfile",(client,data={})=>this.handlePlayerProfile(client,data));
    this.onMessage("petOrder",(client,data={})=>this.handlePetOrder(client,data));
    this.onMessage("petAbility",(client,data={})=>this.handlePetAbility(client,data));
    this.onMessage("petBreed",(client,data={})=>this.handlePetBreed(client,data));
    this.onMessage("petRelease",(client,data={})=>this.handlePetRelease(client,data));
    this.onMessage("petRename",(client,data={})=>this.handlePetRename(client,data));
    this.onMessage("ensureStarterPet",(client,data={})=>this.handleEnsureStarterPet(client,data));
    this.onMessage("chat",(client,data={})=>this.handleChat(client,data));
  }


  isPlayerCombatReady(playerId){
    const p=this.state.players.get(String(playerId||""));
    if(!p||p.dead)return false;
    const at=this.playerCombatReadyAt.get(String(playerId||""));
    return Number.isFinite(at) && this.state.worldTime>=at;
  }
  handlePlayerReady(client){
    const id=client?.sessionId||"",p=this.state.players.get(id);if(!p)return;
    // Give the first visible frame a short safe grace period as well. This is
    // not a loading pause; the player is already in the world and can move.
    this.playerCombatReadyAt.set(id,this.state.worldTime+1.15);
    p.health=p.maxHealth;p.dead=false;
    this.pendingPlayerHits.delete(id);this.pendingAnimalPushes.delete(id);this.ownerThreat.delete(id);
  }
  handlePlayerPreview(client){
    const id=client?.sessionId||"",p=this.state.players.get(id);if(!p)return;
    // If the run ended and the player actually returns Home, clear any crafted
    // structures that survived death-decay. Shared wildlife/resources remain live.
    if(p.dead){
      for(const[wid,w]of Array.from(this.state.walls.entries()))if(w&&w.ownerId===id&&!w.sourcePetId){this.state.walls.delete(wid);this.hostileWildWalls.delete(wid);}
      for(const[tid,t]of Array.from(this.state.towers.entries()))if(t&&t.ownerId===id)this.state.towers.delete(tid);
    }
    // Home is a connected preview state: keep the Cube in the shared room so
    // the client can watch live players/wildlife, but remove it from combat.
    this.playerCombatReadyAt.delete(id);
    this.pendingPlayerHits.delete(id);this.pendingAnimalPushes.delete(id);this.ownerThreat.delete(id);
    p.moveX=0;p.moveY=0;p.moving=false;
  }
  handlePlayerProfile(client,data={}){
    const p=this.state.players.get(client?.sessionId||"");if(!p)return;
    const username=String(data?.username||"").trim().replace(/\s+/g," ").slice(0,14);
    if(username)p.username=username;
    const color=String(data?.color||"");
    if(/^#[0-9a-f]{6}$/i.test(color))p.color=color;
  }

  handleChat(client,data={}) {
    const player=this.state.players.get(client.sessionId);
    if(!player)return;

    const now=Date.now();
    const last=this.chatLastSent.get(client.sessionId)||0;
    if(now-last<CHAT_COOLDOWN_MS)return;

    const message=cleanChatText(data?.message ?? data?.text ?? "");
    if(!message || chatBlockReason(message))return;

    this.chatLastSent.set(client.sessionId,now);
    const payload={username:safeChatUsername(player.username),message};

    // The sender already renders its own message instantly in Game 366.
    // Broadcast to everyone else so it does not appear twice for the sender.
    this.broadcast("chat",payload,{except:client});
  }

  gridKey(cx,cy){return `${cx},${cy}`;}
  addSolid(x,y,r,kind="static",id="") {
    const key=this.gridKey(Math.floor(x/GRID_CELL),Math.floor(y/GRID_CELL));
    let b=this.solidGrid.get(key); if(!b){b=[];this.solidGrid.set(key,b);} b.push({x,y,r,kind,id});
  }
  nearbySolids(x,y,range) {
    const out=[]; const a=Math.floor((x-range)/GRID_CELL),b=Math.floor((x+range)/GRID_CELL),c=Math.floor((y-range)/GRID_CELL),d=Math.floor((y+range)/GRID_CELL);
    for(let cy=c;cy<=d;cy++)for(let cx=a;cx<=b;cx++){const bucket=this.solidGrid.get(this.gridKey(cx,cy));if(bucket)out.push(...bucket);} return out;
  }
  moveResourceSolid(id,r,oldX,oldY){
    const key=this.gridKey(Math.floor((Number(oldX)||0)/GRID_CELL),Math.floor((Number(oldY)||0)/GRID_CELL)),bucket=this.solidGrid.get(key);
    if(bucket){for(let i=bucket.length-1;i>=0;i--){const s=bucket[i];if(s&&s.id===id&&(s.kind==="resource"||s.kind==="water"))bucket.splice(i,1);}if(!bucket.length)this.solidGrid.delete(key);}
    if(r.type==="pond"||r.type==="river")this.addSolid(r.x,r.y,r.solidR+(r.type==="pond"?58:30),"water",id);
    else this.addSolid(r.x,r.y,r.type==="log"?r.solidR*1.35:(r.type==="rock"?basicRockBoundRadius(r):r.solidR),"resource",id);
  }
  respawnResourceElsewhere(id,r){
    if(!r||r.alive||r.type==="pond"||r.type==="river"||r.type==="rainforestHive"||this.isBeeFlowerResource(r))return false;
    const oldX=Number(r.x)||0,oldY=Number(r.y)||0,solid=Math.max(8,Number(r.solidR)||12),pad=Math.max(120,solid+90),info=BIOME_RESOURCE_INFO[r.type],originOuter=outerIslandAt(oldX,oldY,0),galaxyOuter=originOuter?.id==="galaxaytropic"?originOuter:null,biome=info&&info.category!=="flower"&&info.biome!=="ocean"&&info.biome!=="galaxytropic"?biomeBaseId(info.biome):"",oceanFloor=r.type==="oceanRock"||info?.biome==="ocean";
    for(let tries=0;tries<120;tries++){
      const pos=oceanFloor?randomOceanFloorPoint(OCEAN_DIVE_START+35,1900):(galaxyOuter?randomPointOnOuterIsland(galaxyOuter,pad):(biome?randomPointInBiome(biome,pad):randomLandPoint(pad)));if(!pos)continue;
      if(dist(pos.x,pos.y,oldX,oldY)<760)continue;
      let nearPlayer=false;for(const[,p]of this.state.players){if(!p.dead&&dist(pos.x,pos.y,p.x,p.y)<360+solid){nearPlayer=true;break;}}if(nearPlayer)continue;
      if(oceanFloor){let blocked=false;for(const q of this.nearbySolids(pos.x,pos.y,solid+48)){if(q.kind!=="resource")continue;const rr=this.state.resources.get(q.id);if(!rr||!rr.alive||q.id===id)continue;const oi=rr.type==="oceanRock"||BIOME_RESOURCE_INFO[rr.type]?.biome==="ocean";if(oi&&dist(pos.x,pos.y,rr.x,rr.y)<solid+(Number(rr.solidR)||7)+18){blocked=true;break;}}if(blocked)continue;}
      else if(galaxyOuter){if(!this.canPlaceOuterIsland(galaxyOuter,pos.x,pos.y,solid+10))continue;}
      else if(!this.canPlace(pos.x,pos.y,solid+10,0))continue;
      r.x=pos.x;r.y=pos.y;if(r.type==="log")r.rot=rand(0,TAU);r.hp=r.maxHp;r.alive=true;
      this.moveResourceSolid(id,r,oldX,oldY);return true;
    }
    return false;
  }
  addDynamic(kind,id,obj){
    if(!obj)return;
    const key=this.gridKey(Math.floor(obj.x/GRID_CELL),Math.floor(obj.y/GRID_CELL));
    let b=this.dynamicGrid.get(key);if(!b){b=[];this.dynamicGrid.set(key,b);}b.push({kind,id,obj});
  }
  rebuildDynamicGrid(){
    this.dynamicGrid.clear();
    for(const[id,a]of this.state.animals)if(a&&a.hp>0)this.addDynamic("animal",id,a);
    for(const[id,p]of this.state.pets)if(p&&!p.dead&&p.hp>0)this.addDynamic("pet",id,p);
    for(const[id,en]of this.state.enemies)if(en&&!en.dead&&en.hp>0)this.addDynamic("enemy",id,en);
  }
  nearbyDynamic(x,y,range,kinds=null){
    const out=[];const minX=Math.floor((x-range)/GRID_CELL),maxX=Math.floor((x+range)/GRID_CELL),minY=Math.floor((y-range)/GRID_CELL),maxY=Math.floor((y+range)/GRID_CELL);
    for(let cy=minY;cy<=maxY;cy++)for(let cx=minX;cx<=maxX;cx++){
      const bucket=this.dynamicGrid.get(this.gridKey(cx,cy));if(!bucket)continue;
      for(const rec of bucket){if(!kinds||kinds.has(rec.kind))out.push(rec);}
    }
    return out;
  }
  canPlace(x,y,r,minCenter=0) {
    if(!isInsideIsland(x,y,Math.max(50,(Number(r)||0)+34)))return false;
    if(x<120+r||x>WORLD_W-120-r||y<120+r||y>WORLD_H-120-r)return false;
    if(minCenter&&dist(x,y,WORLD_W/2,WORLD_H/2)<minCenter)return false;
    for(const s of this.nearbySolids(x,y,r+150)){
      if(s.kind==="resource"){const rr=this.state.resources.get(s.id);if(!rr||!rr.alive)continue;}
      else if(s.kind==="gold"){const gg=this.state.gold.get(s.id);if(!gg||(!gg.infinite&&gg.goldLeft<=0))continue;}
      else if(s.kind==="chest"){const cc=this.state.chests.get(s.id);if(!cc||cc.opened)continue;}
      if(dist(x,y,s.x,s.y)<r+s.r+6)return false;
    }
    return true;
  }
  canPlaceOuterIsland(spec,x,y,r){
    if(!spec||!isInsideOuterIsland(spec,x,y,Math.max(26,(Number(r)||0)+18)))return false;
    if(x<80+r||x>WORLD_W-80-r||y<80+r||y>WORLD_H-80-r)return false;
    for(const s of this.nearbySolids(x,y,r+150)){
      if(s.kind==="resource"){
        const rr=this.state.resources.get(s.id);if(!rr||!rr.alive)continue;
        if(rr.type==="oceanRock"||BIOME_RESOURCE_INFO[rr.type]?.biome==="ocean")continue;
      }else if(s.kind==="gold"){const gg=this.state.gold.get(s.id);if(!gg||(!gg.infinite&&gg.goldLeft<=0))continue;}
      else if(s.kind==="chest"){const cc=this.state.chests.get(s.id);if(!cc||cc.opened)continue;}
      if(dist(x,y,s.x,s.y)<r+s.r+6)return false;
    }
    return true;
  }
  resolveStatic(obj,radius) {
    if(!obj)return;
    const isCreature=!!(PET_TYPES[obj.type]&&obj.stage);
    const isPlayer=typeof obj.username==="string"&&("moveX" in obj)&&("health" in obj);

    const resourceCenter=(r)=>r.type==="tree"?{x:r.x,y:r.y+4*(r.scale||1)}:{x:r.x,y:r.y};
    const logParts=(r)=>{
      const sc=r.scale||1,ang=r.rot||0,ca=Math.cos(ang),sa=Math.sin(ang),halfLen=27*sc,rr=8.8*sc;
      return[-.82,-.41,0,.41,.82].map(t=>({x:r.x+ca*(halfLen*t),y:r.y+sa*(halfLen*t),r:rr}));
    };
    const goldHit=(g)=>({x:g.x,y:g.y+g.r*(g.pure?.06:g.size==="huge"?.04:.03),r:g.r*(g.pure?.78:g.size==="huge"?.75:.72)});
    const chestHit=(c)=>({x:c.x,y:c.y+8,r:c.r||18});

    if(isCreature){
      const pushCreatureFrom=(cx,cy,cr)=>{
        let best=null,bestOverlap=0;
        for(const h of animalPhysicalCircles(obj)){const d=dist(h.x,h.y,cx,cy),overlap=h.r+cr-d;if(overlap>bestOverlap){bestOverlap=overlap;best={h,d,overlap};}}
        if(best&&best.d>.1){const a=angTo(cx,cy,best.h.x,best.h.y);obj.x+=Math.cos(a)*best.overlap;obj.y+=Math.sin(a)*best.overlap;return true;}
        return false;
      };
      const range=Math.max(260,(obj.r||18)+190);
      for(const solid of this.nearbySolids(obj.x,obj.y,range)){
        if(solid.kind==="water")continue;
        if(solid.kind==="resource"){
          const r=this.state.resources.get(solid.id);if(!r||!r.alive)continue;
          if(r.type==="oceanRock"||BIOME_RESOURCE_INFO[r.type]?.biome==="ocean")continue;
          if(r.type==="log"){
            let best=null,bestOverlap=0;
            const body=animalPhysicalCircles(obj);
            for(const h of body)for(const q of logParts(r)){const d=dist(h.x,h.y,q.x,q.y),overlap=h.r*.9+q.r-d;if(overlap>bestOverlap){bestOverlap=overlap;best={h,q,d,overlap};}}
            if(best&&best.d>.1){const a=angTo(best.q.x,best.q.y,best.h.x,best.h.y);obj.x+=Math.cos(a)*best.overlap;obj.y+=Math.sin(a)*best.overlap;obj._lastResourceContactId=solid.id;}
          }else if(r.type==="rock"){
            let best=null;for(const h of animalPhysicalCircles(obj)){const p=basicRockCirclePenetration(r,h.x,h.y,h.r*.9);if(p&&(!best||p.overlap>best.overlap))best=p;}
            if(best){obj.x+=best.nx*best.overlap;obj.y+=best.ny*best.overlap;obj._lastResourceContactId=solid.id;}
          }else{const c=resourceCenter(r);if(pushCreatureFrom(c.x,c.y,r.solidR))obj._lastResourceContactId=solid.id;}
        }else if(solid.kind==="gold"){const g=this.state.gold.get(solid.id);if(!g||(!g.infinite&&g.goldLeft<=0))continue;const h=goldHit(g);pushCreatureFrom(h.x,h.y,h.r);}
        else if(solid.kind==="chest"){const c=this.state.chests.get(solid.id);if(!c||c.opened)continue;const h=chestHit(c);pushCreatureFrom(h.x,h.y,h.r);}
      }
      // Creature-vs-wall collision uses the canonical torso+head copied circles as other solids.
      for(const[,w]of this.state.walls){
        if(isPlacedVehicleWall(w))continue;
        let best=null,bestOverlap=0;
        for(const h of animalPhysicalCircles(obj)){const d=dist(h.x,h.y,w.x,w.y),overlap=h.r+w.r-d;if(overlap>bestOverlap){bestOverlap=overlap;best={h,d,overlap};}}
        if(best&&best.d>.1){const a=angTo(w.x,w.y,best.h.x,best.h.y);obj.x+=Math.cos(a)*best.overlap;obj.y+=Math.sin(a)*best.overlap;}
      }
      obj.x=clamp(obj.x,20,WORLD_W-20);obj.y=clamp(obj.y,20,WORLD_H-20);if(!obj.ownerId)keepObjectOnLandmass(obj,Math.max(22,(Number(obj.r)||18)*.78));return;
    }

    if(isPlayer){
      for(const solid of this.nearbySolids(obj.x,obj.y,260)){
        if(solid.kind==="water")continue;
        if(solid.kind==="resource"){
          const r=this.state.resources.get(solid.id);if(!r||!r.alive)continue;
          const oceanFloorResource=r.type==="oceanRock"||BIOME_RESOURCE_INFO[r.type]?.biome==="ocean";
          if(oceanFloorResource){const onFloor=worldBiomeAt(obj.x,obj.y)==="ocean"&&oceanDepthAt(obj.x,obj.y)>=OCEAN_DIVE_START&&(obj.vehicleType!=="Boat");if(!onFloor)continue;}
          if(r.type==="log"){
            let best=null,bestOverlap=0;for(const q of logParts(r)){const d=dist(obj.x,obj.y,q.x,q.y),overlap=PLAYER_R+q.r-d;if(overlap>bestOverlap){bestOverlap=overlap;best={q,d,overlap};}}
            if(best&&best.d>.1){const a=angTo(best.q.x,best.q.y,obj.x,obj.y);obj.x+=Math.cos(a)*best.overlap;obj.y+=Math.sin(a)*best.overlap;}
          }else if(r.type==="rock"){
            const hit=basicRockCirclePenetration(r,obj.x,obj.y,PLAYER_R);if(hit){obj.x+=hit.nx*hit.overlap;obj.y+=hit.ny*hit.overlap;}
          }else{
            const c=resourceCenter(r),pr=(r.type==="tree"||r.type==="bush")?PLAYER_R*.7:PLAYER_R;
            const d=dist(obj.x,obj.y,c.x,c.y),min=r.solidR+pr;if(d<min&&d>.01){const a=angTo(c.x,c.y,obj.x,obj.y);obj.x=c.x+Math.cos(a)*min;obj.y=c.y+Math.sin(a)*min;}
          }
        }else if(solid.kind==="gold"){const g=this.state.gold.get(solid.id);if(!g||(!g.infinite&&g.goldLeft<=0))continue;const h=goldHit(g),d=dist(obj.x,obj.y,h.x,h.y),min=h.r+PLAYER_R;if(d<min&&d>.01){const a=angTo(h.x,h.y,obj.x,obj.y);obj.x=h.x+Math.cos(a)*min;obj.y=h.y+Math.sin(a)*min;}}
        else if(solid.kind==="chest"){const c=this.state.chests.get(solid.id);if(!c||c.opened)continue;const h=chestHit(c),d=dist(obj.x,obj.y,h.x,h.y),min=h.r+PLAYER_R*.9;if(d<min&&d>.01){const a=angTo(h.x,h.y,obj.x,obj.y);obj.x=h.x+Math.cos(a)*min;obj.y=h.y+Math.sin(a)*min;}}
      }
      for(const[,w]of this.state.walls){if(isPlacedVehicleWall(w))continue;const d=dist(obj.x,obj.y,w.x,w.y),min=PLAYER_R+w.r;if(d<min&&d>.01){const a=angTo(w.x,w.y,obj.x,obj.y);obj.x=w.x+Math.cos(a)*min;obj.y=w.y+Math.sin(a)*min;}}
      obj.x=clamp(obj.x,PLAYER_R,WORLD_W-PLAYER_R);obj.y=clamp(obj.y,PLAYER_R,WORLD_H-PLAYER_R);return;
    }

    for(const solid of this.nearbySolids(obj.x,obj.y,radius+100)){
      if(solid.kind==="water")continue;
      if(solid.kind==="resource"){const r=this.state.resources.get(solid.id);if(r&&!r.alive)continue;if(r?.type==="rock"){const hit=basicRockCirclePenetration(r,obj.x,obj.y,radius);if(hit){obj.x+=hit.nx*hit.overlap;obj.y+=hit.ny*hit.overlap;}continue;}}
      if(solid.kind==="gold"){const g=this.state.gold.get(solid.id);if(g&&!g.infinite&&g.goldLeft<=0)continue;}
      if(solid.kind==="chest"){const c=this.state.chests.get(solid.id);if(c?.opened)continue;}
      const d=dist(obj.x,obj.y,solid.x,solid.y),min=radius+solid.r;if(d<min){const a=d>.01?angTo(solid.x,solid.y,obj.x,obj.y):(obj.angle||0);obj.x=solid.x+Math.cos(a)*min;obj.y=solid.y+Math.sin(a)*min;}
    }
    for(const[,w]of this.state.walls){if(isPlacedVehicleWall(w))continue;const d=dist(obj.x,obj.y,w.x,w.y),min=radius+w.r;if(d<min){const a=d>.01?angTo(w.x,w.y,obj.x,obj.y):(obj.angle||0);obj.x=w.x+Math.cos(a)*min;obj.y=w.y+Math.sin(a)*min;}}
    obj.x=clamp(obj.x,20,WORLD_W-20);obj.y=clamp(obj.y,20,WORLD_H-20);keepObjectOnIsland(obj,Math.max(22,(Number(radius)||18)+8));
  }

  resourceBlocksCreaturePath(obj,r){
    if(!obj||!r||!r.alive||r.type==="pond"||r.type==="river"||r.type==="oceanRock"||BIOME_RESOURCE_INFO[r.type]?.biome==="ocean"||this.isBeeFlowerResource(r))return false;
    const rx=r.x,ry=r.type==="tree"?r.y+4*(r.scale||1):r.y;
    const rr=r.type==="log"?Math.max((r.solidR||10)*1.35,32*(r.scale||1)):(r.solidR||14);
    const d=dist(obj.x,obj.y,rx,ry);
    const near=d<Math.max(42,(obj.r||18)*1.22+rr+34);
    if(!near)return false;
    return Math.abs(angleDiff(Number(obj.angle)||0,angTo(obj.x,obj.y,rx,ry)))<1.18;
  }

  blockingResourcesForCreature(obj,limit=6){const out=[];if(!obj)return out;for(const solid of this.nearbySolids(obj.x,obj.y,Math.max(135,(obj.r||18)+115))){if(solid.kind!=="resource")continue;const r=this.state.resources.get(solid.id);if(!this.resourceBlocksCreaturePath(obj,r))continue;out.push({id:solid.id,r,d:dist(obj.x,obj.y,r.x,r.y)});}out.sort((a,b)=>a.d-b.d);return out.slice(0,Math.max(1,limit));}

  findBlockingResourceForCreature(obj){
    if(!obj)return null;let best=null,bestD=Infinity;
    for(const solid of this.nearbySolids(obj.x,obj.y,Math.max(125,(obj.r||18)+105))){
      if(solid.kind!=="resource")continue;const r=this.state.resources.get(solid.id);
      if(!this.resourceBlocksCreaturePath(obj,r))continue;const d=dist(obj.x,obj.y,r.x,r.y);
      if(d<bestD){bestD=d;best={id:solid.id,r};}
    }
    return best;
  }

  moveCreatureSwept(obj,speed,dt){
    if(!obj||obj.dead||!Number.isFinite(speed)||!Number.isFinite(dt)||dt<=0)return;
    const dx=Math.cos(Number(obj.angle)||0)*speed*dt,dy=Math.sin(Number(obj.angle)||0)*speed*dt;
    const distance=Math.hypot(dx,dy);if(distance<=.0001)return;
    const startX=obj.x,startY=obj.y;obj._lastResourceContactId="";
    const steps=Math.max(1,Math.min(12,Math.ceil(distance/5.5))),sx=dx/steps,sy=dy/steps;
    for(let i=0;i<steps;i++){obj.x=clamp(obj.x+sx,20,WORLD_W-20);obj.y=clamp(obj.y+sy,20,WORLD_H-20);this.resolveStatic(obj,(obj.r||18)*.72);}
    const actual=dist(startX,startY,obj.x,obj.y);
    if(actual<Math.max(.18,distance*.24)){
      let rid=obj._lastResourceContactId||"",r=rid?this.state.resources.get(rid):null;
      if(!this.resourceBlocksCreaturePath(obj,r)){const found=this.findBlockingResourceForCreature(obj);rid=found?.id||"";r=found?.r||null;}
      if(rid&&r)obj._blockingResourceId=rid;
    }else if(obj._blockingResourceId){
      const r=this.state.resources.get(obj._blockingResourceId);if(!this.resourceBlocksCreaturePath(obj,r))obj._blockingResourceId="";
    }
  }

  spawnClearOfCreatures(x,y) {
    for(const [,a] of this.state.animals){
      if(!a||a.hp<=0)continue;
      const extra=a.stage==="bigmomma"?460:a.stage==="superboss"?380:a.stage==="boss"?330:a.stage==="adult"?180:140;
      if(dist(x,y,a.x,a.y)<PLAYER_R+(a.r||18)+extra)return false;
    }
    for(const [,en] of this.state.enemies){
      if(!en||en.dead||en.hp<=0)continue;
      if(dist(x,y,en.x,en.y)<PLAYER_R+(en.r||18)+320)return false;
    }
    for(const [,pet] of this.state.pets){
      if(!pet||pet.dead)continue;
      if(dist(x,y,pet.x,pet.y)<PLAYER_R+(pet.r||16)+90)return false;
    }
    for(const [,p] of this.state.players){
      if(!p||p.dead)continue;
      if(dist(x,y,p.x,p.y)<PLAYER_R*2+90)return false;
    }
    for(const [,w] of this.state.walls){if(isPlacedVehicleWall(w))continue;if(dist(x,y,w.x,w.y)<PLAYER_R+w.r+35)return false;}
    return true;
  }

  isSafePlayerSpawn(x,y) {
    if(dist(x,y,WORLD_W/2,WORLD_H/2)<700)return false;
    if(!this.canPlace(x,y,PLAYER_R+55,0))return false;
    return this.spawnClearOfCreatures(x,y);
  }

  spawnCandidateNearWater(pad=650){
    const waters=[];
    for(const[,r]of this.state.resources)if(r&&r.alive&&(r.type==="pond"||r.type==="river"))waters.push(r);
    if(!waters.length)return null;
    const w=pick(waters),a=rand(0,TAU),edge=Math.max(50,Number(w.solidR)||80),d=edge+rand(190,430);
    return{x:clamp(w.x+Math.cos(a)*d,pad,WORLD_W-pad),y:clamp(w.y+Math.sin(a)*d,pad,WORLD_H-pad)};
  }

  safeSpawn(avoidX=null,avoidY=null,minDistance=0) {
    // Random attempts first, then a deterministic grid fallback. Never return an
    // unchecked random point: a joining/respawning player cannot appear in a boss.
    const hasAvoid=Number.isFinite(avoidX)&&Number.isFinite(avoidY)&&minDistance>0;
    for(let i=0;i<520;i++){
      const point=(i<280?this.spawnCandidateNearWater(650):null)||(i<430?randomPointInBiome(randomBiomeZoneId(),650):{x:rand(650,WORLD_W-650),y:rand(650,WORLD_H-650)});
      const x=point.x,y=point.y;
      if(hasAvoid&&dist(x,y,avoidX,avoidY)<minDistance)continue;
      if(this.isSafePlayerSpawn(x,y))return{x,y};
    }
    for(let y=700;y<WORLD_H-700;y+=420){
      for(let x=700;x<WORLD_W-700;x+=420){
        if(hasAvoid&&dist(x,y,avoidX,avoidY)<minDistance*.75)continue;
        if(this.isSafePlayerSpawn(x,y))return{x,y};
      }
    }
    // The world is far too large for this to normally run. Keep the final point
    // static-safe and relocate nearby creatures before use as a last-resort guard.
    let fallback=randomPointInBiome(Math.random()<.5?"forest":"rainforest",760),x=fallback.x,y=fallback.y;
    if(hasAvoid&&dist(x,y,avoidX,avoidY)<minDistance*.6){fallback=randomPointInBiome(worldBiomeAt(x,y)==="forest"?"rainforest":"forest",760);x=fallback.x;y=fallback.y;}
    for(const [id,a] of this.state.animals){
      if(a&&dist(x,y,a.x,a.y)<650){a.x=clamp(a.x+900,40,WORLD_W-40);a.y=clamp(a.y+900,40,WORLD_H-40);}
    }
    for(const [id,en] of this.state.enemies){
      if(en&&dist(x,y,en.x,en.y)<650){en.x=clamp(en.x+900,40,WORLD_W-40);en.y=clamp(en.y+900,40,WORLD_H-40);}
    }
    return{x,y};
  }

  safePetSpawnNear(x,y,r=18) {
    const radii=[58,76,96,118];
    for(const rr of radii){
      for(let i=0;i<12;i++){
        const a=(i/12)*TAU;
        const px=clamp(x+Math.cos(a)*rr,40,WORLD_W-40),py=clamp(y+Math.sin(a)*rr,40,WORLD_H-40);
        if(!this.canPlace(px,py,r+8,0))continue;
        let blocked=false;
        for(const [,wild] of this.state.animals){if(wild&&wild.hp>0&&dist(px,py,wild.x,wild.y)<r+(wild.r||18)+35){blocked=true;break;}}
        if(!blocked)return{x:px,y:py};
      }
    }
    return{x:clamp(x+70,40,WORLD_W-40),y};
  }

  addResource(type,x,y,hp,solidR,canopyR,scale,rot){const r=new ResourceState();Object.assign(r,{type,x,y,hp,maxHp:hp,alive:true,solidR,canopyR,scale,rot});const id=`r${this.nextResourceId++}`;this.state.resources.set(id,r);if(type==="pond"||type==="river")this.addSolid(x,y,solidR+(type==="pond"?58:30),"water",id);else this.addSolid(x,y,type==="log"?solidR*1.35:(type==="rock"?basicRockBoundRadius(r):solidR),"resource",id);}
  addGold(x,y,size,r,goldLeft,infinite=false,pure=false){const g=new GoldState();Object.assign(g,{x,y,size,r,goldLeft:infinite?999999999:goldLeft,infinite,pure});const id=`g${this.nextGoldId++}`;this.state.gold.set(id,g);this.addSolid(x,y+(pure?r*.06:r*.03),r*(pure?.78:size==="huge"?.75:.72),"gold",id);}
  addChest(x,y){const c=new ChestState();Object.assign(c,{x,y,r:18,hp:4,maxHp:4,opened:false,pulse:0,shine:rand(0,TAU),chipSide:Math.random()<.5?"wood":"stone"});const id=`c${this.nextChestId++}`;this.state.chests.set(id,c);this.chestRewards.set(id,this.makeChestReward());this.addSolid(x,y+8,18,"chest",id);}

  isWildBeeType(type){ return type==="queenbee"||type==="workerbee"||type==="dronebee"; }
  isNeutralBeeType(type){return type==="queenbee"||type==="workerbee";}
  droneBeeShouldFlee(a){return !!(a&&a.type==="dronebee"&&a.hp>0&&a.maxHp>0&&a.hp/a.maxHp<=.26);}
  isBeeFlowerResource(r){return !!r&&r.alive&&(r.type==="forestGiantFlower"||r.type==="rainforestGiantFlower");}
  setBeeHomeForAnimal(a,hiveId){if(!a||!this.isWildBeeType(a.type))return null;const hive=this.state.resources.get(String(hiveId||""));if(hive&&hive.alive&&hive.type==="rainforestHive"){a._hiveHomeId=String(hiveId);return hive;}return this.beeHomeResourceForAnimal(a);}
  hiveResourceCenter(r){ return r&&r.type==="tree"?{x:r.x,y:r.y+4*(r.scale||1)}:{x:r?.x||0,y:r?.y||0}; }
  nearestHiveResourceId(x,y){let best="",bestD=Infinity;for(const[id,r]of this.state.resources){if(!r||!r.alive||r.type!=="rainforestHive")continue;const c=this.hiveResourceCenter(r),d=dist(x,y,c.x,c.y);if(d<bestD){bestD=d;best=id;}}return best;}
  beeHomeResourceForAnimal(a){if(!a||!this.isWildBeeType(a.type))return null;const cur=a._hiveHomeId&&this.state.resources.get(a._hiveHomeId);if(cur&&cur.alive&&cur.type==="rainforestHive")return cur;const id=this.nearestHiveResourceId(a.x,a.y);a._hiveHomeId=id||"";return id?this.state.resources.get(id):null;}
  nearestBeeFlowerResourceId(a,maxRange=3400,preferredBiome=""){let best="",bestD=Math.max(120,Number(maxRange)||3400);for(const[id,r]of this.state.resources){if(!this.isBeeFlowerResource(r))continue;if(preferredBiome==="forest"&&r.type!=="forestGiantFlower")continue;if(preferredBiome==="rainforest"&&r.type!=="rainforestGiantFlower")continue;const d=dist(a.x,a.y,r.x,r.y);if(d<bestD){best=id;bestD=d;}}return best;}
  settleBeeNearHome(a,slot=0){const hive=this.beeHomeResourceForAnimal(a);if(!hive)return false;const ringStep=a.type==="queenbee"?2:a.type==="workerbee"?1:0;const ring=Math.floor(slot/6)+ringStep,perRing=6+ring*2,angle=((slot%perRing)/perRing)*TAU+(ring*.37);const base=(hive.solidR||48)+Math.max(20,(a.r||18)*.70)+22+ring*18+(a.type==="queenbee"?72:(a.type==="workerbee"?22:10));const tx=clamp(hive.x+Math.cos(angle)*base,24,WORLD_W-24),ty=clamp(hive.y+Math.sin(angle)*(base*.78),24,WORLD_H-24);if(this.canPlace(tx,ty,Math.max(8,(a.r||18)*.52),0)){a.x=tx;a.y=ty;}a.wanderA=angle+Math.PI*.5;a.wanderT=rand(.35,1.1);a._hiveOrbitA=angle;a._hiveOrbitDir=a._hiveOrbitDir||((Math.random()<.5)?-1:1);a.sleeping=a.stage==="baby"?Math.random()<.93:false;return true;}
  organizeRainforestHives(){const counts=new Map();for(const[,a]of this.state.animals){if(!a||a.dead||a.hp<=0||!this.isWildBeeType(a.type))continue;const hive=this.beeHomeResourceForAnimal(a);if(!hive)continue;const key=a._hiveHomeId||"",slot=counts.get(key)||0;this.settleBeeNearHome(a,slot);counts.set(key,slot+1);}}
  hiveBeeStage(type,hiveOrdinal=0,first=false){if(type==="queenbee")return "bigmomma";return Math.random()<.55?"baby":"adult";}
  weightedHiveBeeType(){const q=Math.random();return q<.62?"dronebee":q<.92?"workerbee":"queenbee";}
  hiveHatchStage(type){if(type==="workerbee"){const q=Math.random();return q<.28?"boss":q<.78?"adult":"baby";}return Math.random()<.56?"baby":"adult";}
  spawnHiveBee(hiveId,hive,type,stage){if(!hive||!hive.alive||hive.type!=="rainforestHive")return null;const footprint=animalSpawnFootprint(type,stage);for(let t=0;t<45;t++){const aa=rand(0,TAU),dd=(hive.solidR||90)+footprint+rand(28,90),x=clamp(hive.x+Math.cos(aa)*dd,24,WORLD_W-24),y=clamp(hive.y+Math.sin(aa)*dd*.78,24,WORLD_H-24);if(!this.canPlace(x,y,footprint,0))continue;const id=this.addAnimal(type,stage,x,y,{sleeping:stage==="baby"?Math.random()<.93:Math.random()<beeSleepSpawnChance(type,stage),gender:canonicalAnimalGender(type)}),bee=this.state.animals.get(id);if(!bee)return null;bee._hiveHomeId=hiveId;bee._hiveOrbitA=aa;bee._hiveOrbitDir=Math.random()<.5?-1:1;return bee;}return null;}
  populateRainforestHives(first=false){let ordinal=0;for(const[hiveId,hive]of this.state.resources){if(!hive||!hive.alive||hive.type!=="rainforestHive")continue;const counts={dronebee:0,workerbee:0,queenbee:0};for(const[,a]of this.state.animals)if(a&&a.hp>0&&this.isWildBeeType(a.type)&&a._hiveHomeId===hiveId)counts[a.type]=(counts[a.type]||0)+1;const desired={dronebee:4,workerbee:2,queenbee:1};for(const type of ["dronebee","workerbee","queenbee"]){while((counts[type]||0)<desired[type]){let made=null;for(let attempt=0;attempt<8&&!made;attempt++)made=this.spawnHiveBee(hiveId,hive,type,this.hiveBeeStage(type,ordinal,first));if(!made)break;counts[type]++;}}hive._beeSpawnT=300;hive._beeBroodNight=0;ordinal++;}}
  updateHiveBeeSpawners(dt){this._beeSpawnerTickAccum=(Number(this._beeSpawnerTickAccum)||0)+dt;if(this._beeSpawnerTickAccum<1)return;const step=this._beeSpawnerTickAccum;this._beeSpawnerTickAccum=0;for(const[hiveId,hive]of this.state.resources){if(!hive||!hive.alive||hive.type!=="rainforestHive")continue;hive._beeSpawnT=(Number.isFinite(Number(hive._beeSpawnT))?Number(hive._beeSpawnT):300)-step;if(hive._beeSpawnT>0)continue;let hiveCount=0;for(const[,a]of this.state.animals)if(a&&a.hp>0&&this.isWildBeeType(a.type)&&a._hiveHomeId===hiveId)hiveCount++;if(hiveCount<14){const type=this.weightedHiveBeeType();this.spawnHiveBee(hiveId,hive,type,this.hiveHatchStage(type));}hive._beeSpawnT=300;}}
  breedHiveBeesEveryTenNights(){if(this.state.dayCount%10!==0)return;for(const[hiveId,hive]of this.state.resources){if(!hive||!hive.alive||hive.type!=="rainforestHive"||hive._beeBroodNight===this.state.dayCount)continue;let queen=null,drone=null,count=0;for(const[,a]of this.state.animals){if(!a||a.dead||a.hp<=0||a._hiveHomeId!==hiveId||!this.isWildBeeType(a.type))continue;count++;if(a.stage!=="baby"&&a.type==="queenbee")queen=a;if(a.stage!=="baby"&&a.type==="dronebee")drone=a;}hive._beeBroodNight=this.state.dayCount;if(!queen||!drone||count>=14)continue;const baby=this.spawnHiveBee(hiveId,hive,this.weightedHiveBeeType(),"baby");if(!baby)continue;baby.bredChild=true;baby.sleeping=Math.random()<.94;this.broadcastFx({kind:"familyBirth",x:hive.x,y:hive.y});}}
  growHiveFromPollen(hive){if(!hive)return;hive.scale=Math.min(5.75,(Number(hive.scale)||4.2)+.035);}
  spreadBeeFlowerFromPollen(a){
    const src=this.state.resources.get(String(a?._beeFlowerId||""));if(!this.isBeeFlowerResource(src))return false;
    a._flowerSeedPollen=(Math.floor(Number(a._flowerSeedPollen)||0)+1);if(a._flowerSeedPollen<3)return false;a._flowerSeedPollen=0;
    let total=0;for(const[,r]of this.state.resources)if(this.isBeeFlowerResource(r))total++;if(total>=78)return false;
    const biome=worldBiomeAt(src.x,src.y);
    for(let tries=0;tries<12;tries++){
      const q=rand(0,TAU),d=rand(85,240),x=clamp(src.x+Math.cos(q)*d,30,WORLD_W-30),y=clamp(src.y+Math.sin(q)*d,30,WORLD_H-30);
      if(worldBiomeAt(x,y)!==biome||!this.canPlace(x,y,22,0))continue;
      const scale=rand(1.0,1.32);this.addResource(src.type,x,y,9999,18,0,scale,rand(-.35,.35));this.broadcastFx({kind:"familyBirth",x,y});return true;
    }
    return false;
  }
  updateWorkerBeeJob(a,dt,hive){
    if(a.stage==="baby"){a.pollenCollecting=false;a.pollenProgress=0;return false;}
    const c=this.hiveResourceCenter(hive);let state=a._beeWorkState||"seek";
    if(state==="seek"){
      a.pollenCollecting=false;a.pollenProgress=0;a._beePollen=false;
      if(!a._beePreferBiome)a._beePreferBiome=Math.random()<.38?"forest":"rainforest";
      let fid=this.nearestBeeFlowerResourceId(a,3400,a._beePreferBiome);if(!fid)fid=this.nearestBeeFlowerResourceId(a,3400,"");
      if(!fid){a._beeWorkWait=(Number(a._beeWorkWait)||0)-dt;if(a._beeWorkWait<=0){a._beeWorkWait=rand(3,7);a._beePreferBiome="";}return false;}
      a._beeFlowerId=fid;a._beeWorkState="flower";state="flower";
    }
    if(state==="flower"){
      const f=this.state.resources.get(a._beeFlowerId||"");if(!this.isBeeFlowerResource(f)){a._beeWorkState="seek";a.pollenCollecting=false;a.pollenProgress=0;return true;}
      const d=dist(a.x,a.y,f.x,f.y),aim=angTo(a.x,a.y,f.x,f.y);smoothTurn(a,aim,dt,5.1);
      if(d>Math.max(22,(f.solidR||18)+12))this.moveCreatureSwept(a,(a.speed||60)*.82,dt);
      else{a._beeWorkState="collect";a._beeCollectDuration=rand(2.6,3.6);a.pollenProgress=0;a.pollenCollecting=true;a._beePollen=false;}
      return true;
    }
    if(state==="collect"){
      const f=this.state.resources.get(a._beeFlowerId||"");if(!this.isBeeFlowerResource(f)){a._beeWorkState="seek";a.pollenCollecting=false;a.pollenProgress=0;return true;}
      const duration=Math.max(.4,Number(a._beeCollectDuration)||3);a.pollenCollecting=true;a.pollenProgress=clamp((Number(a.pollenProgress)||0)+dt/duration,0,1);smoothTurn(a,angTo(a.x,a.y,f.x,f.y),dt,4.5);
      if(a.pollenProgress>=.999){a.pollenProgress=1;a.pollenCollecting=false;a._beePollen=true;a._beeWorkState="home";}
      return true;
    }
    if(state==="home"){
      a.pollenCollecting=false;const d=dist(a.x,a.y,c.x,c.y),aim=angTo(a.x,a.y,c.x,c.y);smoothTurn(a,aim,dt,5.2);const stop=(hive.solidR||70)+Math.max(20,(a.r||18)*.7)+12;
      if(d>stop)this.moveCreatureSwept(a,(a.speed||60)*.88,dt);else{a._beeWorkState="deposit";a._beeWorkTimer=rand(1.2,2.0);}return true;
    }
    if(state==="deposit"){
      a.pollenCollecting=false;a._beeWorkTimer=(Number(a._beeWorkTimer)||0)-dt;
      if(a._beeWorkTimer<=0){if(a._beePollen){this.growHiveFromPollen(hive);this.spreadBeeFlowerFromPollen(a);this.giveWildExp("",a,6,"pollen");}a._beePollen=false;a.pollenProgress=0;a._beeWorkState="seek";a._beeWorkWait=rand(2,5);a._beePreferBiome="";}return true;
    }
    a._beeWorkState="seek";a.pollenCollecting=false;a.pollenProgress=0;return false;
  }
  updateDroneBeeHiveLife(a,dt,hive){if(a.stage==="baby")return false;const c=this.hiveResourceCenter(hive);a._beeHoneyT=(Number.isFinite(Number(a._beeHoneyT))?Number(a._beeHoneyT):rand(16,36))-dt;if(a._beeEatingHoney){a._beeHoneyPause=(Number(a._beeHoneyPause)||0)-dt;if(a._beeHoneyPause<=0){a._beeEatingHoney=false;a._beeHoneyT=rand(18,42);}return true;}if(a._beeHoneyT<=0){const d=dist(a.x,a.y,c.x,c.y),aim=angTo(a.x,a.y,c.x,c.y);smoothTurn(a,aim,dt,5);if(d>(hive.solidR||70)+18)this.moveCreatureSwept(a,(a.speed||60)*.72,dt);else{a._beeEatingHoney=true;a._beeHoneyPause=rand(1.2,2.8);}return true;}a._hiveOrbitDir=Number.isFinite(a._hiveOrbitDir)?a._hiveOrbitDir:(Math.random()<.5?-1:1);a._hiveOrbitA=(Number.isFinite(a._hiveOrbitA)?a._hiveOrbitA:rand(0,TAU))+dt*.90*a._hiveOrbitDir;const orbitBase=(hive.solidR||70)+48,tx=c.x+Math.cos(a._hiveOrbitA)*(orbitBase+8*Math.sin(this.state.worldTime*.8+a.x*.002)),ty=c.y+Math.sin(a._hiveOrbitA)*(orbitBase*.76+6*Math.cos(this.state.worldTime*.7+a.y*.002));smoothTurn(a,angTo(a.x,a.y,tx,ty),dt,4.4);this.moveCreatureSwept(a,(a.speed||60)*.54,dt);return true;}
  updateQueenBeeHiveLife(a,dt,hive){if(a.stage==="baby")return false;const c=this.hiveResourceCenter(hive);a._queenRoamT=(Number(a._queenRoamT)||0)-dt;if(a._queenRoamT<=0||!Number.isFinite(a._queenRoamX)||dist(a._queenRoamX,a._queenRoamY,c.x,c.y)>(hive.solidR||70)+430){const aa=rand(0,TAU),rr=rand((hive.solidR||70)+150,(hive.solidR||70)+330);a._queenRoamX=clamp(c.x+Math.cos(aa)*rr,30,WORLD_W-30);a._queenRoamY=clamp(c.y+Math.sin(aa)*rr*.78,30,WORLD_H-30);a._queenRoamT=rand(3.5,7.5);}const d=dist(a.x,a.y,a._queenRoamX,a._queenRoamY);smoothTurn(a,angTo(a.x,a.y,a._queenRoamX,a._queenRoamY),dt,3.8);if(d>28)this.moveCreatureSwept(a,(a.speed||60)*.47,dt);return true;}
  updateBeeHomeBehavior(id,a,dt){const hive=this.beeHomeResourceForAnimal(a);if(!hive)return false;if(a.stage==="baby"){if(!a.sleeping&&this.wildCanSleepNow(id,a)&&Math.random()<dt*.055){a.sleeping=true;return true;}const c=this.hiveResourceCenter(hive),d=dist(a.x,a.y,c.x,c.y),near=(hive.solidR||70)+80;if(d>near){const aim=angTo(a.x,a.y,c.x,c.y);smoothTurn(a,aim,dt,4.2);this.moveCreatureSwept(a,(a.speed||60)*.50,dt);}else{a.wanderT=(a.wanderT||0)-dt;if(a.wanderT<=0){a.wanderA=rand(0,TAU);a.wanderT=rand(1.8,4.0);}smoothTurn(a,a.wanderA||0,dt,3.4);this.moveCreatureSwept(a,(a.speed||60)*.22,dt);}return true;}if(a.type==="workerbee"&&this.updateWorkerBeeJob(a,dt,hive))return true;if(a.type==="dronebee"&&this.updateDroneBeeHiveLife(a,dt,hive))return true;if(a.type==="queenbee"&&this.updateQueenBeeHiveLife(a,dt,hive))return true;return false;}

  addAnimal(type,stage,x,y,opts={}) {
    if(stage==="bigmomma"&&type!=="queenbee"&&Array.from(this.state.animals.values()).filter(q=>q&&q.hp>0&&q.type!=="queenbee"&&q.stage==="bigmomma").length>=5)stage="superboss";
    const a=new AnimalState(); const info=PET_TYPES[type]; const r=animalRadius(type,stage),hp=typeHp(type,stage); const coat=pick(info.coats||[info.color]);
    const hasSpots=(type==="dog"&&Math.random()<.55)||(type==="cat"&&Math.random()<.35)||(type==="rabbit"&&Math.random()<.25);
    const spots=hasSpots?Array.from({length:randi(3,7)},()=>({x:rand(-.5,.5),y:rand(-.4,.4),s:rand(.12,.22)})):[];
    const sleeping=opts.sleeping??(Math.random()<beeSleepSpawnChance(type,stage));
    Object.assign(a,{type,stage,x,y,angle:rand(0,TAU),r,hp,maxHp:hp,coat,spotCol:shadeHex(coat,Math.random()<.5?-35:30),spotsJson:JSON.stringify(spots),speed:animalSpeed(type,stage,false),biome:biomeBaseId(opts.biome||worldBiomeAt(x,y)),sleeping,tailPhase:rand(0,TAU),abilityCd:rand(3,info.abilityCd),wanderT:rand(1,3),wanderA:rand(0,TAU),releasedWild:!!opts.releasedWild,level:opts.level||1,exp:opts.exp||0,petName:opts.petName||"",gender:canonicalAnimalGender(type,opts.gender),motherId:String(opts.motherId||""),fatherId:String(opts.fatherId||""),bredChild:!!opts.bredChild});
    if(opts.hp!=null)a.hp=clamp(opts.hp,1,a.maxHp); if(opts.enraged)a.enraged=true; if(opts.tameFailedAggro)a.tameFailedAggro=true; if(opts.desperateAggro)a.desperateAggro=true;
    const id=`a${this.nextAnimalId++}`;this.state.animals.set(id,a); if(this.isWildBeeType(type))this.beeHomeResourceForAnimal(a); return id;
  }
  petUpgradeSet(ownerId,type){
    const all=this.playerPetStatUpgrades.get(ownerId)||{};
    const src=(all&&typeof all==="object"&&all[type]&&typeof all[type]==="object")?all[type]:{};
    const clean={};for(const k of ["health","defense","attack","weight","regen","speed"])clean[k]=Math.max(0,Math.min(10,Math.floor(Number(src[k])||0)));
    return clean;
  }
  applyPetUpgradeFields(p,ownerId,type){
    const u=this.petUpgradeSet(ownerId,type);
    p.upHealth=u.health;p.upDefense=u.defense;p.upAttack=u.attack;p.upWeight=u.weight;p.upRegen=u.regen;p.upSpeed=u.speed;return u;
  }

  addPet(ownerId,type,stage,x,y,opts={}) {
    const info=PET_TYPES[type];if(!info)return null;stage=["baby","adult","boss","superboss"].includes(stage)?stage:(stage==="bigmomma"?"superboss":"baby");const p=new PetState();const r=animalRadius(type,stage);this.applyPetUpgradeFields(p,ownerId,type);
    const baseHp=typeHp(type,stage),hp=Math.max(12,Math.round(baseHp*petUpgradeMultiplier(p,"health")));const coat=opts.coat||pick(info.coats||[info.color]);
    const speed=animalSpeed(type,stage,true,petUpgradeMultiplier(p,"weight"))*petUpgradeMultiplier(p,"speed");
    Object.assign(p,{ownerId,type,stage,x,y,angle:opts.angle||0,r,hp:opts.hp!=null?Math.min(hp,opts.hp):hp,maxHp:hp,coat,spotCol:opts.spotCol||shadeHex(coat,-30),spotsJson:opts.spotsJson||"[]",speed,sleeping:false,tailPhase:rand(0,TAU),abilityCd:0,atkCd:0,combat:0,level:opts.level||1,exp:opts.exp||0,petName:String(opts.petName||type).slice(0,14),orderMode:"follow",targetX:-1,targetY:-1,dead:false,gender:canonicalAnimalGender(type,opts.gender),motherId:String(opts.motherId||""),fatherId:String(opts.fatherId||""),bredChild:!!opts.bredChild,olderBrotherId:String(opts.olderBrotherId||""),olderSisterId:String(opts.olderSisterId||"")});
    const id=`p${this.nextPetId++}`;this.state.pets.set(id,p);return id;
  }
  enemySpawnPoint(anchor=null) {
    // Hostile cubes spawn uniformly around the whole map rather than around a
    // player. Keep a modest no-pop-in radius from living players when possible.
    let fallback=randomLandPoint(120);
    for(let tries=0;tries<48;tries++){
      const pos=randomLandPoint(120),x=pos.x,y=pos.y;
      fallback={x,y};
      if(!this.canPlace(x,y,24,120))continue;
      let tooClose=false;
      for(const[,pl]of this.state.players){
        if(!pl.dead&&dist(x,y,pl.x,pl.y)<560){tooClose=true;break;}
      }
      if(!tooClose)return{x,y};
    }
    return fallback;
  }

  moonmarkSpawnPoint(radius=52,biomeId=CURRENT_BIOME_ID){
    const pad=Math.max(76,radius+26);
    const blockedByPureGold=(x,y)=>{for(const[,g]of this.state.gold){if(!g||!(g.pure||g.infinite))continue;const h=goldHit(g);if(dist(x,y,h.x,h.y)<radius+h.r+14)return true;}return false;};
    const base=biomeBaseId(biomeId),live=Array.from(this.state.players.values()).filter(p=>p&&!p.dead&&worldBiomeAt(p.x,p.y)===base);
    const zone=BIOME_ZONES[base]||BIOME_ZONES.forest;
    const anchor=live.length?pick(live):{x:zone.cx,y:zone.cy};
    for(let tries=0;tries<160;tries++){
      const a=rand(0,TAU),d=rand(220,760),x=clamp(anchor.x+Math.cos(a)*d,pad,WORLD_W-pad),y=clamp(anchor.y+Math.sin(a)*d,pad,WORLD_H-pad);
      if(worldBiomeAt(x,y)!==base||blockedByPureGold(x,y))continue;
      return{x,y};
    }
    for(let tries=0;tries<220;tries++){
      const pos=randomPointInBiome(base,pad);
      if(!blockedByPureGold(pos.x,pos.y))return pos;
    }
    return null;
  }

  clearMoonmarkSpawnArea(x,y,radius=36){
    const clearR=radius+16;
    let broken=0;
    for(const[id,r]of this.state.resources){
      if(!r||!r.alive||r.type==="rainforestHive")continue;
      const c=resourceCenter(r),rr=r.type==="log"?Math.max(r.solidR*1.35,18):r.solidR;
      if(dist(x,y,c.x,c.y)>=clearR+rr)continue;
      r.hp=0;r.alive=false;this.resourceRespawns.set(id,rand(12,22));broken++;
    }
    for(const[,g]of this.state.gold){
      if(!g||g.pure||g.infinite||g.goldLeft<=0)continue;
      const h=goldHit(g);if(dist(x,y,h.x,h.y)<clearR+h.r){g.goldLeft=0;broken++;}
    }
    for(const[id,c]of this.state.chests){
      if(!c||c.opened)continue;
      const h=chestHit(c);if(dist(x,y,h.x,h.y)<clearR+h.r){c.hp=0;c.opened=true;this.chestRewards.delete(id);broken++;}
    }
    for(const[id,w]of this.state.walls){
      if(w&&!isPlacedVehicleWall(w)&&dist(x,y,w.x,w.y)<clearR+Math.max(8,w.r||20)){this.state.walls.delete(id);this.hostileWildWalls.delete(id);broken++;}
    }
    for(const[id,t]of this.state.towers){
      if(t&&dist(x,y,t.x,t.y)<clearR+24){this.state.towers.delete(id);broken++;}
    }
    const shove=(o,rr)=>{
      if(!o||o.dead||(o.hp!=null&&o.hp<=0)||(o.health!=null&&o.health<=0))return;
      const minD=clearR+Math.max(8,Number(rr)||18)+4,d=dist(x,y,o.x,o.y);if(d>=minD)return;
      const a=d>.01?angTo(x,y,o.x,o.y):rand(0,TAU);
      o.x=clamp(x+Math.cos(a)*minD,20,WORLD_W-20);o.y=clamp(y+Math.sin(a)*minD,20,WORLD_H-20);
    };
    for(const[,p]of this.state.players)if(p&&!p.dead)shove(p,PLAYER_R);
    for(const[,p]of this.state.pets)if(p&&!p.dead)shove(p,p.r);
    for(const[,a]of this.state.animals)if(a&&a.hp>0)shove(a,a.r);
    for(const[,en]of this.state.enemies)if(en&&en.hp>0)shove(en,en.r);
    if(broken>0)this.broadcastFx({kind:"hit",x,y,text:`SPAWN CRUSH x${broken}`,color:"#d8ef8a"});
    return broken;
  }

  spawnEnemyGuardPet(enemyId,en,strong=false,rider=false){
    if(!enemyId||!en||this.enemyPetByEnemy.has(enemyId))return null;
    const type=pick(rider?(strong?["wolf","boar","bear","saber"]:["wolf","boar","dog","saber"]):(strong?["wolf","dog","boar","fox","bear"]:["dog","fox","wolf","cat","boar"]));
    const stage=rider?(strong&&Math.random()<.30?"boss":"adult"):(strong&&Math.random()<.24?"boss":"adult");
    const rr=animalRadius(type,stage);
    const pos=rider?{x:en.x,y:en.y}:this.safePetSpawnNear(en.x,en.y,rr);
    const aid=this.addAnimal(type,stage,pos.x,pos.y,{sleeping:false,enraged:true,petName:`Raider ${PET_TYPES[type]?.name||type}`});
    const a=this.state.animals.get(aid);
    if(a){a.sleeping=false;a.enraged=true;a.combat=9999;a.wanderT=rand(.5,1.5);a.hostileRiderMount=!!rider;}
    this.enemyPetByEnemy.set(enemyId,aid);
    this.enemyOwnerByPet.set(aid,enemyId);
    en.guardPetId=aid; en.hasGuard=true; en.ridingPetId=rider?aid:"";
    return aid;
  }

  detachEnemyGuard(enemyId,attackerId="",remove=false){
    const en=this.state.enemies.get(enemyId);
    if(en){en.guardPetId="";en.ridingPetId="";en.hasGuard=false;}
    const aid=this.enemyPetByEnemy.get(enemyId);
    if(!aid)return;
    this.enemyPetByEnemy.delete(enemyId);
    this.enemyOwnerByPet.delete(aid);
    const a=this.state.animals.get(aid);
    if(!a)return;
    if(remove){this.state.animals.delete(aid);this.animalAggro.delete(aid);this.animalFleeFrom.delete(aid);return;}
    a.hostileRiderMount=false;a.enraged=true;a.sleeping=false;a.combat=10;a.tameFailedAggro=true;
    if(attackerId)this.animalAggro.set(aid,{kind:"player",id:attackerId});
  }

  releaseEnemyGuardToWild(enemyId){
    const en=this.state.enemies.get(enemyId);
    if(en){en.guardPetId="";en.ridingPetId="";en.hasGuard=false;}

    const aid=this.enemyPetByEnemy.get(enemyId);
    if(!aid)return;

    this.enemyPetByEnemy.delete(enemyId);
    this.enemyOwnerByPet.delete(aid);

    const a=this.state.animals.get(aid);
    if(!a)return;

    // Convert the former hostile-cube mount/guard into ordinary wildlife.
    this.animalAggro.delete(aid);
    a.hostileRiderMount=false;
    a.enraged=false;
    a.sleeping=false;
    a.combat=0;
    a.tameFailedAggro=false;
    a.desperateAggro=false;
    a.recentHit=0;
    a.flash=0;
    a.atkCd=0;
    a.targetX=0;
    a.targetY=0;
    a.wanderA=rand(0,TAU);
    a.wanderT=rand(.7,2.5);
  }

  addEnemy(strong=false,anchor=null,forcedRole="",moonMarked=false,moonBiomeId="") {
    if(this.state.enemies.size>=70){
      if(!moonMarked)return null;
      // The Midnight boss must never be blocked by a full ordinary Hostl wave.
      for(const[id,en]of this.state.enemies){if(en&&!en.moonMarked){this.detachEnemyGuard(id,"",true);this.state.enemies.delete(id);break;}}
      if(this.state.enemies.size>=70)return null;
    }
    const en=new EnemyState();
    const chosenMoonBiome=moonMarked?(biomeBaseId(moonBiomeId)||randomBiomeZoneId()):"";
    const pos=moonMarked?this.moonmarkSpawnPoint(MOONMARK_RADIUS,chosenMoonBiome):this.enemySpawnPoint(anchor);
    if(!pos)return null;
    const x=pos.x,y=pos.y;
    if(moonMarked)this.clearMoonmarkSpawnArea(x,y,MOONMARK_RADIUS);
    const phaseName=TIME_PHASES[this.state.dayPhase]?.name||"Dawn";
    let role=forcedRole||chooseHostlRole(phaseName);
    const moonProfile=moonMarked?(MOONMARK_BIOMES[chosenMoonBiome]||MOONMARK_BIOMES.forest):null;
    let roleStrong=!!strong&&(role==="Ranger"||role==="Chimest");
    let weapon=role==="Ranger"?"Bow":role==="Chimest"?"Staff":role==="Swordsman"?"Sword":"Fist";
    let ranged=role==="Ranger"||role==="Chimest",armed=weapon!=="Fist";
    let speed=(roleStrong?rand(58,98):rand(48,92))*(weapon==="Staff"?.94:weapon==="Bow"?.98:weapon==="Sword"?1.03:1);
    let dmg=weapon==="Bow"?(roleStrong?rand(11,16):rand(8,12)):weapon==="Staff"?(roleStrong?rand(13,18):rand(9,13)):weapon==="Sword"?(roleStrong?rand(14,20):rand(9,14)):(roleStrong?rand(8,12):rand(4,8));
    const hpBase=weapon==="Bow"?(roleStrong?40:24):weapon==="Staff"?(roleStrong?48:28):weapon==="Sword"?(roleStrong?44:28):(roleStrong?34:18);
    let hp=hpBase+this.state.wave*(roleStrong?3.9:3.2);
    let hue=role==="Ranger"?(roleStrong?"#4b5dcf":"#3f76b5"):role==="Chimest"?(roleStrong?"#6b1a8f":"#7c47a8"):role==="Tamer"?"#64734f":role==="Rider"?"#595451":role==="Swordsman"?"#8f2e6b":"#e0563f";
    if(moonProfile){role=moonProfile.name;roleStrong=true;weapon=moonProfile.element;ranged=true;armed=true;speed=0;dmg=48+Math.min(30,this.state.wave*.6);hp=18000+this.state.wave*160;hue=moonProfile.color;}
    const hasGuard=!moonMarked&&(role==="Rider"||role==="Tamer");
    const rider=role==="Rider";
    if(hasGuard){hp*=.64;dmg*=.72;hue=rider?"#595451":"#64734f";}
    if(rider){hp*=.58;dmg*=.48;weapon="Fist";ranged=false;armed=false;speed*=.82;}
    Object.assign(en,{x,y,angle:0,r:moonMarked?MOONMARK_RADIUS:(roleStrong?20:(rider?18:17)),speed,weapon,dmg,hp,maxHp:hp,strong:roleStrong,armed,ranged,hue,atkCd:rand(.15,.9),wanderA:rand(0,TAU),wanderT:rand(.6,2),strafeDir:Math.random()<.5?-1:1,strafeT:rand(.6,1.5),hasGuard,guardPetId:"",ridingPetId:"",role,moonMarked:!!moonMarked,moonBiome:moonMarked?chosenMoonBiome:""});
    if(moonMarked){en._moonAnchorX=x;en._moonAnchorY=y;}
    en._forestCd=moonMarked?rand(1.2,2.0):0; en._moonNovaCd=moonMarked?rand(2.8,4.2):0;
    const id=`e${this.nextEnemyId++}`;this.state.enemies.set(id,en);
    if(hasGuard)this.spawnEnemyGuardPet(id,en,strong,rider);
    return id;
  }
  addWall(x,y,r=20,ttl=-1,ownerId="",opts={}){const w=new WallState();const hp=Math.max(1,Number(opts.hp)||72);Object.assign(w,{x,y,r,ttl,ownerId,hp,maxHp:Math.max(hp,Number(opts.maxHp)||hp),kind:String(opts.kind||"wood"),spiked:!!opts.spiked,spikeDmg:Math.max(0,Number(opts.spikeDmg)||0),sourcePetId:String(opts.sourcePetId||"")});const id=`w${this.nextWallId++}`;this.state.walls.set(id,w);return id;}
  bounceAnimalsFromNewDogWall(x,y,r,sourcePetId="",sourceAnimalId=""){
    const bounceOne=(id,o,isPet)=>{
      if(!o||o.dead||o.hp<=0)return;
      if((isPet&&id===sourcePetId)||(!isPet&&id===sourceAnimalId))return;
      const ar=Math.max(8,Number(o.r)||18),minD=r+ar*.82+4;
      let d=dist(x,y,o.x,o.y);if(d>=minD)return;
      const fallback=isPet&&this.state.pets.get(sourcePetId)?.angle||(!isPet&&this.state.animals.get(sourceAnimalId)?.angle)||0;
      const a=d>.05?angTo(x,y,o.x,o.y):fallback,nx=Math.cos(a),ny=Math.sin(a);
      const clear=Math.max(0,minD-d)+2,bounce=Math.max(14,r*.58)*animalKnockbackScale(o),push=clear+bounce;
      o.x=clamp(o.x+nx*push,20,WORLD_W-20);o.y=clamp(o.y+ny*push,20,WORLD_H-20);
      this.resolveStatic(o,(o.r||18)*.68);
      d=dist(x,y,o.x,o.y);
      if(d<minD){const a2=d>.05?angTo(x,y,o.x,o.y):a;o.x=clamp(x+Math.cos(a2)*minD,20,WORLD_W-20);o.y=clamp(y+Math.sin(a2)*minD,20,WORLD_H-20);}
    };
    for(const[id,a]of this.state.animals)bounceOne(id,a,false);
    for(const[id,p]of this.state.pets)bounceOne(id,p,true);
  }
  addTower(x,y,ownerId="",tier=0,opts={}){const t=new TowerState(),tt=clamp(Math.floor(Number(tier)||0),0,3),kind=String(opts.kind||"tower"),variant=String(opts.variant||"");let hp=kind==="battlebot"?[520,760,1050,1350][tt]:[120,180,260,350][tt];if(kind==="tower"&&tt>=3&&variant==="diamond")hp=500;Object.assign(t,{x,y,cd:.5,ownerId,tier:tt,hp,maxHp:hp,kind,variant,angle:Number(opts.angle)||0});const id=`t${this.nextTowerId++}`;this.state.towers.set(id,t);return id;}
  addProjectile(data){const p=new ProjectileState();Object.assign(p,data);const id=`q${this.nextProjectileId++}`;this.state.projectiles.set(id,p);return id;}

  scatter(type,count,hp,minCenter){for(let i=0;i<count;i++){for(let tries=0;tries<85;tries++){let scale=1,solid=12,canopy=0;if(type==="tree"){scale=rand(1.2,2.3);solid=8.8*scale;canopy=46*scale;}else if(type==="rock"){scale=rand(1,2.05);solid=26.5*scale;}else if(type==="log"){scale=rand(1,1.6);solid=17.5*scale;}else if(type==="bush"){scale=rand(1.08,1.7);solid=10.8*scale;canopy=24*scale;}const pos=randomLandPoint(Math.max(120,solid+80)),x=pos.x,y=pos.y,biome=worldBiomeAt(x,y);const chance=biome==="arctic"?(type==="tree"?.34:type==="bush"?.44:type==="log"?.40:.86):biome==="desert"?(type==="tree"?.18:type==="bush"?.22:type==="log"?.08:.92):biome==="mountains"?(type==="tree"?.26:type==="bush"?.34:type==="log"?.20:.98):type==="tree"?(biome==="rainforest"?1:.88):type==="bush"?(biome==="rainforest"?1:.82):type==="log"?(biome==="rainforest"?.90:.78):(biome==="rainforest"?.56:.68);if(Math.random()>chance)continue;if(!this.canPlace(x,y,solid,minCenter))continue;this.addResource(type,x,y,hp,solid,canopy,scale,type==="log"?rand(0,TAU):0);break;}}}
  placeBiomeFeatures(){
    for(let i=0;i<scaledBiomeResourceCount(72,"rainforest",24);i++)for(let t=0;t<20;t++){const pos=randomPointInBiome("rainforest",80),scale=rand(1.05,1.65),solid=10.8*scale;if(!this.canPlace(pos.x,pos.y,solid+10,0))continue;this.addResource("bush",pos.x,pos.y,8,solid,24*scale,scale,0);break;}
    const placeUnique=(type,count,biome)=>{const info=BIOME_RESOURCE_INFO[type];count=scaledBiomeResourceCount(count,biome,1);for(let i=0;i<count;i++)for(let t=0;t<50;t++){const pos=randomPointInBiome(biome,72),isCactus=type==="desertCactusGood"||type==="desertCactusBad",isHive=type==="rainforestHive",isFlower=type==="forestGiantFlower"||type==="rainforestGiantFlower",scale=isHive?rand(4.0,4.8):(isFlower?rand(2.0,2.85):(isCactus?rand(1.55,2.15):rand(.9,1.35))),solid=isHive?(27*scale):(isFlower?8.5*scale:((info.category==="stone"?17:(isCactus?14:12))*scale)),hp=isHive?Math.round(info.hp*2.15):info.hp;if(!this.canPlace(pos.x,pos.y,solid+12,0))continue;this.addResource(type,pos.x,pos.y,hp,solid,0,scale,rand(-.35,.35));break;}};
    placeUnique("forestHerb",24,"forest");placeUnique("forestResin",22,"forest");placeUnique("forestGiantFlower",20,"forest");placeUnique("rainforestHive",2,"forest");placeUnique("rainforestVine",26,"rainforest");placeUnique("rainforestFruit",24,"rainforest");placeUnique("rainforestGiantFlower",24,"rainforest");placeUnique("rainforestHive",2,"rainforest");placeUnique("rainforestHive",2,"mountains");placeUnique("arcticIceCrystal",30,"arctic");placeUnique("arcticFrostBerry",26,"arctic");placeUnique("desertCactusGood",22,"desert");placeUnique("desertCactusBad",18,"desert");placeUnique("desertSandstone",24,"desert");placeUnique("mountainIron",30,"mountains");placeUnique("mountainQuartz",26,"mountains");placeUnique("mountainGem",22,"mountains");placeUnique("mountainStoneFruit",24,"mountains");
  }
  placeUnderwaterFeatures(){
    const add=(type,count,hp,solidBase,minScale,maxScale)=>{for(let i=0;i<count;i++)for(let tries=0;tries<65;tries++){const pos=randomOceanFloorPoint(OCEAN_DIVE_START+35,1900);if(!pos)continue;const scale=rand(minScale,maxScale),solid=Math.max(4,solidBase*scale);let blocked=false;for(const q of this.nearbySolids(pos.x,pos.y,72)){if(q.kind!=="resource")continue;const rr=this.state.resources.get(q.id);if(!rr||!rr.alive)continue;const oceanThing=rr.type==="oceanRock"||BIOME_RESOURCE_INFO[rr.type]?.biome==="ocean";if(oceanThing&&dist(pos.x,pos.y,rr.x,rr.y)<solid+(Number(rr.solidR)||7)+18){blocked=true;break;}}if(blocked)continue;this.addResource(type,pos.x,pos.y,hp,solid,0,scale,rand(-.5,.5));break;}};
    add("oceanRock",1450,4,10,.48,2.65);add("oceanUrchin",190,4,6.5,.88,1.35);add("oceanAnemone",180,5,5.5,.94,1.45);add("oceanBlueSeaweed",300,4,6,1.35,2.25);add("oceanGreenSeaweed",360,4,6,1.45,2.45);
  }
  placeGalaxaytropicFeatures(){
    const spec=outerIslandById("galaxaytropic");if(!spec)return;
    const place=(type,count,hp,minScale,maxScale)=>{for(let i=0;i<count;i++)for(let tries=0;tries<110;tries++){const scale=rand(minScale,maxScale),solid=type==="tree"?8.8*scale:type==="rock"?26.5*scale:type==="bush"?10.8*scale:11*scale,canopy=type==="tree"?46*scale:type==="bush"?24*scale:0,pos=randomPointOnOuterIsland(spec,Math.max(90,solid+55));if(!this.canPlaceOuterIsland(spec,pos.x,pos.y,solid))continue;this.addResource(type,pos.x,pos.y,hp,solid,canopy,scale,type==="galaxyCelestFruit"?rand(-.35,.35):0);break;}};
    place("tree",250,9,1.15,2.1);place("rock",210,4,.85,1.95);place("bush",185,8,1.0,1.65);place("galaxyCelestFruit",72,5,1.05,1.55);
  }

  generateWorld(){
    this.addGold(WORLD_W/2,WORLD_H/2,"pure",176,999999999,true,true);
    const nonDesert=BIOME_ORDER.filter(id=>id!=="desert");
    for(const biome of nonDesert){for(let i=0;i<16;i++)for(let t=0;t<90;t++){const radius=rand(78,134),squish=rand(.64,.84),pos=randomPointInBiome(biome,radius+120);if(dist(pos.x,pos.y,WORLD_W/2,WORLD_H/2)<520||!this.canPlace(pos.x,pos.y,radius+72,0)||!waterPlacementClear(this.state.resources,pos.x,pos.y,radius,radius*squish,42))continue;this.addResource("pond",pos.x,pos.y,1,radius,radius*squish,1,rand(0,TAU));break;}}
    for(let i=0;i<12;i++)for(let t=0;t<90;t++){const radius=rand(72,122),squish=rand(.64,.84),pos=randomLandPoint(radius+120);if(worldBiomeAt(pos.x,pos.y)==="desert")continue;if(dist(pos.x,pos.y,WORLD_W/2,WORLD_H/2)<520||!this.canPlace(pos.x,pos.y,radius+70,0)||!waterPlacementClear(this.state.resources,pos.x,pos.y,radius,radius*squish,42))continue;this.addResource("pond",pos.x,pos.y,1,radius,radius*squish,1,rand(0,TAU));break;}
    let oasisA=null;for(let i=0;i<2;i++)for(let t=0;t<180;t++){const radius=rand(96,136),squish=rand(.68,.92),pos=randomPointInBiome("desert",radius+150);if(oasisA&&dist(pos.x,pos.y,oasisA.x,oasisA.y)<WORLD_W*.24)continue;if(!this.canPlace(pos.x,pos.y,radius+80,0)||!waterPlacementClear(this.state.resources,pos.x,pos.y,radius,radius*squish,48))continue;this.addResource("pond",pos.x,pos.y,1,radius,radius*squish,1,rand(0,TAU));if(!oasisA)oasisA={x:pos.x,y:pos.y};break;}
    for(let ri=0;ri<nonDesert.length;ri++){const riverBiome=nonDesert[ri]||"forest",start=randomPointInBiome(riverBiome,720),baseAngle=rand(-Math.PI,Math.PI);let cx=start.x,cy=start.y;for(let seg=0;seg<6;seg++){const ang=baseAngle+Math.sin(seg*.9+ri)*.18,rx=rand(300,390),ry=rand(52,72);if(seg){cx+=Math.cos(ang)*rx*.86;cy+=Math.sin(ang)*rx*.86;}const cp=islandConstrainedPoint(cx,cy,rx+180);cx=cp.x;cy=cp.y;if(worldBiomeAt(cx,cy)==="desert"||!this.canPlace(cx,cy,ry+38,0)||!waterPlacementClear(this.state.resources,cx,cy,rx,ry,34))continue;this.addResource("river",cx,cy,1,rx,ry,1,ang);}}
    this.placeBiomeFeatures();
    this.placeUnderwaterFeatures();
    this.placeGalaxaytropicFeatures();
    this.scatter("tree",1450,9,240);this.scatter("rock",860,4,240);this.scatter("log",540,2.4,180);this.scatter("bush",980,8,180);
    for(let i=0;i<10;i++)for(let t=0;t<70;t++){const pos=randomLandPoint(500);if(dist(pos.x,pos.y,WORLD_W/2,WORLD_H/2)<500||!this.canPlace(pos.x,pos.y,48,0))continue;this.addGold(pos.x,pos.y,"huge",48,40);break;}
    for(let i=0;i<82;i++)for(let t=0;t<55;t++){const pos=randomLandPoint(170);if(!this.canPlace(pos.x,pos.y,16,0))continue;this.addGold(pos.x,pos.y,"small",16,6);break;}
    for(let i=0;i<48;i++)for(let t=0;t<65;t++){const pos=randomLandPoint(180),x=pos.x,y=pos.y;if(dist(x,y,WORLD_W/2,WORLD_H/2)<280||!this.canPlace(x,y,20,0))continue;this.addChest(x,y);break;}
    const randomGroupStage=()=>{const roll=Math.random();return roll<.50?"baby":roll<.90?"adult":roll<.98?"boss":"superboss";};
    const spawnWild=(forced=null,typeOverride=null,anchor=null,biomeOverride=null,outerSpec=null)=>{
      const biomeHint=anchor?biomeBaseId(worldBiomeAt(anchor.x,anchor.y)):(outerSpec?biomeBaseId(outerSpec.biome):(biomeOverride?biomeBaseId(biomeOverride):(typeOverride?speciesHomeBiome(typeOverride):randomBiomeZoneId())));
      const species=(BIOME_PROFILES[biomeHint]?.species||WILD_SPECIES).filter(type=>WILD_SPECIES.includes(type));
      const type=typeOverride||randomWildSpecies(species);let stage=forced;if(!stage){const roll=Math.random();stage=roll<.46?"baby":roll<.84?"adult":roll<.95?"boss":"superboss";}
      const footprint=animalSpawnFootprint(type,stage);
      for(let t=0;t<(outerSpec?115:(anchor?110:80));t++){let x,y;if(anchor){const aa=rand(0,TAU),anchorR=animalSpawnFootprint(anchor.type,anchor.stage),minD=Math.max(78,footprint+anchorR+18),maxD=Math.max(minD+28,Math.min(310,minD+170)),dd=rand(minD,maxD);x=anchor.x+Math.cos(aa)*dd;y=anchor.y+Math.sin(aa)*dd;const cp=islandConstrainedPoint(x,y,footprint+45);x=cp.x;y=cp.y;}else if(outerSpec){const pos=randomPointOnOuterIsland(outerSpec,footprint+34);x=pos.x;y=pos.y;}else{const pos=randomPointInBiome(biomeHint,footprint+60);x=pos.x;y=pos.y;}if(outerSpec?!this.canPlaceOuterIsland(outerSpec,x,y,footprint):!this.canPlace(x,y,footprint,0))continue;let crowded=false;for(const[,a]of this.state.animals){if(!a||a.hp<=0)continue;const gap=outerSpec?16:(anchor?8:36);if(dist(x,y,a.x,a.y)<footprint+animalSpawnFootprint(a.type,a.stage)+gap){crowded=true;break;}}if(crowded)continue;const id=this.addAnimal(type,stage,x,y,{biome:biomeHint}),made=this.state.animals.get(id);if(made&&outerSpec)made._outerIslandId=outerSpec.id;return made||null;}return null;
    };
    // Much denser wildlife across the enormous main island.
    const STARTING_WILD_PER_SPECIES_BY_BIOME={forest:12,rainforest:16,arctic:22,desert:18,mountains:20};
    const STARTING_STAGE_PLAN=["baby","baby","adult","adult","adult","boss","superboss"];
    const EXTRA_STAGE_PLAN=["baby","adult","adult","baby","adult"];
    const BIG_MOMMA_SPECIES_INDEXES=new Set([0,7,14,21,28]);
    const bigMommaTargets=[];
    let speciesOrdinal=0;
    this.populateRainforestHives(true);
    for(const biome of BIOME_ORDER){
      for(const type of (BIOME_PROFILES[biome]?.species||[])){
        if(this.isWildBeeType(type)){speciesOrdinal++;continue;}
        const wantsBigMomma=BIG_MOMMA_SPECIES_INDEXES.has(speciesOrdinal);
        if(wantsBigMomma)bigMommaTargets.push({type,biome});
        const stages=[...STARTING_STAGE_PLAN];if(wantsBigMomma)stages[stages.length-1]="bigmomma";
        const basePerSpecies=type==="fennec"?28:(STARTING_WILD_PER_SPECIES_BY_BIOME[biome]||12),targetPerSpecies=Math.max(STARTING_STAGE_PLAN.length,scaledBiomeSpawnCount(basePerSpecies,biome,STARTING_STAGE_PLAN.length));
        let made=0;
        for(const stage of stages){let spawned=false;for(let attempt=0;attempt<5&&!spawned;attempt++)spawned=!!spawnWild(stage,type,null,biome);if(spawned)made++;}
        for(let retry=0;made<targetPerSpecies&&retry<targetPerSpecies*7;retry++){const extraIndex=Math.max(0,made-STARTING_STAGE_PLAN.length),stage=EXTRA_STAGE_PLAN[(extraIndex+retry)%EXTRA_STAGE_PLAN.length];if(spawnWild(stage,type,null,biome))made++;}
        speciesOrdinal++;
      }
    }
    let bigMommaCount=Array.from(this.state.animals.values()).filter(a=>a&&a.hp>0&&a.type!=="queenbee"&&a.stage==="bigmomma").length;
    for(let pass=0;bigMommaCount<5&&pass<25;pass++){const target=bigMommaTargets[pass%Math.max(1,bigMommaTargets.length)]||{type:"bear",biome:"forest"};if(spawnWild("bigmomma",target.type,null,target.biome))bigMommaCount++;}

    // The outer islands are no longer empty. Give each island a dense local
    // population using species that already belong to that island's biome.
    const OUTER_ISLAND_WILDLIFE_TARGETS={reef_isle:28,sunbar_isle:24,frost_isle:20,westwood_isle:24,southwest_isle:22,southcap_isle:21,northeast_isle:24,northwest_isle:23};
    for(const spec of OUTER_ISLANDS){
      if(spec.id==="galaxaytropic")continue;
      const pool=(BIOME_PROFILES[spec.biome]?.species||WILD_SPECIES).filter(type=>WILD_SPECIES.includes(type)&&!this.isWildBeeType(type));
      const target=OUTER_ISLAND_WILDLIFE_TARGETS[spec.id]||18;let made=0;
      for(let attempt=0;attempt<target*10&&made<target;attempt++){
        const type=randomWildSpecies(pool),roll=Math.random(),stage=roll<.52?"baby":roll<.93?"adult":roll<.995?"boss":"superboss";
        if(spawnWild(stage,type,null,spec.biome,spec))made++;
      }
    }
    console.log(`Island world generated: ${this.state.resources.size} resources, ${this.state.gold.size} gold, ${this.state.chests.size} chests, ${this.state.animals.size} wildlife`);
  }

  randomPlayerPosition(){const vals=Array.from(this.state.players.values()).filter(p=>!p.dead);return vals.length?pick(vals):{x:WORLD_W/2,y:WORLD_H/2};}
  validTool(name){return TOOL[name]?name:"Fist";}
  chosenWeapon(ownerId){return starterWeaponFromSkillChoice(this.skillState(ownerId).stoneChoice);}
  allowedTool(ownerId,requested="Fist"){const chosen=this.chosenWeapon(ownerId);if(!chosen)return "Fist";return this.validTool(requested)===chosen?chosen:chosen;}
  weaponTierForOwner(ownerId){return weaponTierFromSkill(this.skillState(ownerId));}
  buildTierForOwner(ownerId,build){return buildTierFromSkill(this.skillState(ownerId),build);}
  buildVariantForOwner(ownerId,build){return buildVariantFromSkill(this.skillState(ownerId),build);}
  toolStats(name,tier=0){const base=TOOL[this.validTool(name)],t={...base};tier=clamp(Math.floor(Number(tier)||0),0,2);if(name==="Axe"&&tier>=1)Object.assign(t,{dmg:8,gather:3.6,resourcePower:1.35,woodWall:14,cadence:.52});if(name==="Axe"&&tier>=2)Object.assign(t,{dmg:11,gather:4.6,resourcePower:1.65,woodWall:18,cadence:.48});if(name==="Sword"&&tier>=1)Object.assign(t,{dmg:13,range:56,cadence:.37});if(name==="Sword"&&tier>=2)Object.assign(t,{dmg:18,range:58,cadence:.34});if(name==="Pickaxe"&&tier>=1)Object.assign(t,{dmg:7,gather:3.4,resourcePower:1.45,stoneWall:18});if(name==="Pickaxe"&&tier>=2)Object.assign(t,{dmg:9,gather:4.5,resourcePower:1.8,stoneWall:23});if(name==="Bow"&&tier>=1)Object.assign(t,{dmg:13,cadence:.46});if(name==="Bow"&&tier>=2)Object.assign(t,{dmg:17,cadence:.40});if(name==="TigerClaws"&&tier>=1)Object.assign(t,{dmg:9.5,range:47,cadence:.26});if(name==="TigerClaws"&&tier>=2)Object.assign(t,{dmg:13,range:50,cadence:.22,doubleHit:true});if(name==="BoxingGloves"&&tier>=1)Object.assign(t,{dmg:9.2,range:51,cadence:.30});if(name==="BoxingGloves"&&tier>=2)Object.assign(t,{dmg:13.5,range:54,cadence:.28});return t;}
  specializedToolStats(ownerId,name,tier=0){
    const t=this.toolStats(name,this.weaponTierForOwner(ownerId)),spec=String(this.skillState(ownerId).weaponChoice||"");
    if(name==="Sword"){
      if(spec==="daggers")Object.assign(t,{dmg:7.2,range:44,cadence:.36,doubleHit:true});
      else if(spec==="longSword")Object.assign(t,{dmg:21,range:74,cadence:.50});
      else if(spec==="spear")Object.assign(t,{dmg:16,range:96,cadence:.46});
    }else if(name==="Axe"){
      if(spec==="doubleAxe")Object.assign(t,{dmg:8.8,range:66,cadence:.72,gather:4.0,resourcePower:1.50,doubleHit:true});
      else if(spec==="throwingAxe")Object.assign(t,{dmg:16,range:50,cadence:.72,gather:1.7,resourcePower:.72,throwing:true});
      else if(spec==="battleAxe")Object.assign(t,{dmg:20,range:78,cadence:.68,gather:2.3,resourcePower:.95,woodWall:11});
    }
    return t;
  }
  playerCanReach(client,x,y,extra=0){const p=this.state.players.get(client.sessionId);return !!p&&!p.dead&&dist(p.x,p.y,x,y)<=105+extra;}
  clientById(id){return this.clients.find(c=>c.sessionId===id)||null;}
  recordAccountAchievement(ownerId,id,context={}){
    const accountId=this.playerAccountIds.get(String(ownerId||"")),c=this.clientById(ownerId);if(!accountId||!c)return;
    Promise.resolve(HOSTL_ACCOUNT_HOOKS.recordAchievement(String(accountId),String(id||""),context)).then(result=>{
      if(result?.account)c.send("achievementReward",result);
    }).catch(()=>{});
  }
  sendReward(ownerId,reward,source={}){
    const p=this.state.players.get(ownerId);
    if(p&&reward&&reward.kind==="resource"&&reward.resource==="gold"&&!source?.kill){
      p.gold=Math.max(0,Math.floor((Number(p.gold)||0)+Math.max(0,Number(reward.amount)||0)));
    }
    const c=this.clientById(ownerId); if(!c)return;
    const payload={...reward,...source,balance:(reward?.kind==="resource"&&reward?.resource==="gold"&&p)?p.gold:undefined};
    const accountId=this.playerAccountIds.get(String(ownerId||""));
    if(accountId && (reward?.kind==="cards" || reward?.kind==="goldCubits")){
      Promise.resolve(HOSTL_ACCOUNT_HOOKS.grantWorldReward(String(accountId),reward,source)).then(result=>{
        if(result?.granted)c.send("worldReward",{...payload,account:result.account||null,serverVerified:true});
      }).catch(()=>{});
      return;
    }
    c.send("worldReward",payload);
  }
  broadcastFx(data){
    if(!data)return;
    // Queue effects instead of broadcasting one message per hit. They are also
    // distance-filtered per client during flush so fights across the map cost nothing.
    if(this.fxQueue.length<128)this.fxQueue.push(data);
  }
  queuePlayerHit(playerId,data){
    if(!playerId||!data)return;
    const prev=this.pendingPlayerHits.get(playerId);
    if(prev){
      prev.dmg=(prev.dmg||0)+(data.dmg||0);
      prev.health=data.health;prev.maxHealth=data.maxHealth;prev.dead=data.dead;prev.attackerKind=data.attackerKind;prev.attackerId=data.attackerId;
    }else this.pendingPlayerHits.set(playerId,{...data});
  }
  queueAnimalPush(playerId,data){
    if(!playerId||!data)return;
    const prev=this.pendingAnimalPushes.get(playerId);
    if(prev){
      prev.dx=(prev.dx||0)+(data.dx||0);prev.dy=(prev.dy||0)+(data.dy||0);
      prev.x=data.x;prev.y=data.y;prev.animalId=data.animalId||prev.animalId;
    }else this.pendingAnimalPushes.set(playerId,{...data});
  }
  flushNetworkEvents(dt){
    this.fxFlushAccum+=dt;this.hitFlushAccum+=dt;this.pushFlushAccum+=dt;
    if(this.fxFlushAccum>=.08){
      this.fxFlushAccum%=.08;
      if(this.fxQueue.length){
        const batch=this.fxQueue.splice(0,48);
        for(const c of this.clients){
          const p=this.state.players.get(c.sessionId);if(!p)continue;
          const local=[];
          for(const fx of batch){
            const x=Number(fx?.x),y=Number(fx?.y);
            if(!Number.isFinite(x)||!Number.isFinite(y)||((x-p.x)*(x-p.x)+(y-p.y)*(y-p.y)<=1250*1250)){
              local.push(fx);if(local.length>=28)break;
            }
          }
          if(local.length)c.send("worldFxBatch",local);
        }
        if(this.fxQueue.length>128)this.fxQueue.splice(0,this.fxQueue.length-128);
      }
    }
    if(this.hitFlushAccum>=.08){
      this.hitFlushAccum%=.08;
      for(const[playerId,data]of this.pendingPlayerHits){const c=this.clientById(playerId);if(c)c.send("playerHit",data);}
      this.pendingPlayerHits.clear();
    }
    if(this.pushFlushAccum>=.05){
      this.pushFlushAccum%=.05;
      for(const[playerId,data]of this.pendingAnimalPushes){const c=this.clientById(playerId);if(c)c.send("animalPush",data);}
      this.pendingAnimalPushes.clear();
    }
  }

  handleInput(client,input){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;
    const abilityStunned=(Number(p._abilityStunUntil)||0)>this.state.worldTime;

    // Ignore duplicate/stale input packets and measure the actual gap since the
    // previous accepted packet. WebSocket normally preserves order, but keeping a
    // sequence guard also prevents an old queued position from pulling a fast rider back.
    const seq=Number(input?.seq)||0,now=Number(this.state.worldTime)||0;
    let ns=this.playerInputNetState.get(client.sessionId);
    if(!ns){ns={seq:0,time:now};this.playerInputNetState.set(client.sessionId,ns);}
    if(seq>0&&ns.seq>0&&seq<=ns.seq)return;
    const packetDt=clamp(now-(Number(ns.time)||now),1/120,.35);
    if(seq>0)ns.seq=seq;
    ns.time=now;

    if(Number.isFinite(+input.moveX))p.moveX=clamp(+input.moveX,-1,1);
    if(Number.isFinite(+input.moveY))p.moveY=clamp(+input.moveY,-1,1);
    p.moving=typeof input.moving==="boolean"?input.moving:Math.hypot(p.moveX,p.moveY)>.05;
    if(Number.isFinite(+input.angle))p.angle=+input.angle;
    if(typeof input.color==="string"&&input.color.length<32)p.color=input.color;
    if(typeof input.tool==="string"&&input.tool.length<24)p.tool=this.allowedTool(client.sessionId,input.tool);
    if(typeof input.heldSpecial==="string")p.heldSpecial=["Berry","JungleBerry","FrostBerry","GoodCactus","BadCactus","StoneFruit","SeaFruit","BlueSeaweed","Honey","HoneyComb","Bucket","Wall","Saddle","Tower","Windmill","Boat","Sub","Chakrams","Flute","BattleBot","PetArmor","RepairBuilding"].includes(input.heldSpecial)?input.heldSpecial:"";
    if(Number.isFinite(+input.saddleTier))p.saddleTier=clamp(Math.floor(+input.saddleTier),0,this.buildTierForOwner(client.sessionId,"Saddle"));
    if(typeof input.saddleVariant==="string"){const v=this.buildVariantForOwner(client.sessionId,"Saddle");p.saddleVariant=p.saddleTier>=3&&input.saddleVariant===v?v:"";}
    {
      const s=this.skillState(client.sessionId),known=buildKnownFromSkill(s,"DivingSuit"),active=input.divingSuitActive===true&&known,wasActive=Number(p.divingSuitTier)>=0;
      if(active){const maxTier=this.buildTierForOwner(client.sessionId,"DivingSuit");p.divingSuitTier=clamp(Math.floor(Number(input.divingSuitTier)||0),0,maxTier);const v=this.buildVariantForOwner(client.sessionId,"DivingSuit");p.divingSuitVariant=p.divingSuitTier>=3&&String(input.divingSuitVariant||"")===v?v:"";const oldMax=Math.max(0,Number(p.oxygenMax)||0),old=Math.max(0,Number(p.oxygen)||0),nextMax=divingSuitOxygenMaxServer(p);p.oxygenMax=nextMax;if(!wasActive||oldMax<=0)p.oxygen=nextMax;else p.oxygen=clamp(old/oldMax*nextMax,0,nextMax);}
      else{p.divingSuitTier=-1;p.divingSuitVariant="";p.oxygen=0;p.oxygenMax=0;}
    }
    if(typeof input.ridingPetId==="string"){
      const requested=input.ridingPetId.slice(0,32);
      if(!requested)p.ridingPetId="";
      else{
        const mount=this.state.pets.get(requested);
        p.ridingPetId=(mount&&mount.ownerId===client.sessionId&&!mount.dead&&["adult","boss","superboss"].includes(mount.stage))?requested:"";
      }
    }
    if(typeof input.vehicleType==="string"){
      const requested=["Boat","Sub"].includes(input.vehicleType)?input.vehicleType:"";
      const explicitExit=input.vehicleExit===true;
      if(!requested){
        // Exiting parks the same vehicle back into the world. Empty/stale packets
        // cannot board or eject anything by themselves.
        if(explicitExit&&p.vehicleType){const old=p.vehicleType,tt=clamp(Math.floor(Number(p.vehicleTier)||0),0,3),vv=String(p.vehicleVariant||""),hp=(old==="Sub"?220:170)*(1+tt*.22)*(tt>=3&&vv==="diamond"?1.55:1);this.addWall(p.x,p.y,old==="Sub"?31:29,-1,client.sessionId,{hp,kind:`vehicle${old}${tt}${vv?`@${vv}`:""}`,spikeDmg:vehicleAngleValue(p.angle)});p.vehicleType="";p.vehicleTier=0;p.vehicleVariant="";}
      }else if(p.vehicleType===requested){
        p.vehicleType=requested;
      }
      // Boarding is authoritative through vehicleBoard only; movement packets can
      // never create a vehicle ride just by claiming a vehicleType.
    }
    if(p.vehicleType)p.ridingPetId="";

    const rideMount=p.ridingPetId?this.state.pets.get(p.ridingPetId):null;
    if(rideMount&&!rideMount.dead&&Number.isFinite(+input.ridingAngle)){
      const target=+input.ridingAngle;
      let diff=Math.atan2(Math.sin(target-(Number(rideMount.angle)||0)),Math.cos(target-(Number(rideMount.angle)||0)));
      // Allow normal client prediction plus a little latency tolerance, but never
      // accept an impossible instant rotation from the client.
      const maxTurn=mountedPetTurnSpeed(rideMount)*packetDt*2.35+.12;
      diff=clamp(diff,-maxTurn,maxTurn);
      rideMount.angle=(Number(rideMount.angle)||0)+diff;
    }

    // Escape input wins immediately over a stale carry window. This is the key
    // anti-hook rule: pressing away from the animal can never be ignored for a frame.
    const carriedById=this.playerCarryAnimal.get(client.sessionId)||"";
    const carriedAnimal=carriedById?this.state.animals.get(carriedById):null;
    if(carriedAnimal&&this.playerEscapingAnimal(p,carriedAnimal)){
      p.animalCarryT=0;this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);
    }

    // Animals never own the player's movement anymore; they only block entry.
    p.animalCarryT=0;this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);
    const clientX=Number.isFinite(+input.clientX)?+input.clientX:+input.x;
    const clientY=Number.isFinite(+input.clientY)?+input.clientY:+input.y;
    if(abilityStunned){p.moveX=0;p.moveY=0;p.moving=false;return;}
    if(Number.isFinite(clientX)&&Number.isFinite(clientY)){
      const moveStartX=p.x,moveStartY=p.y;
      let tx=clamp(clientX,PLAYER_R,WORLD_W-PLAYER_R),ty=clamp(clientY,PLAYER_R,WORLD_H-PLAYER_R);
      // The previous fixed 52px mounted packet cap could lag behind a fast mount
      // after a browser/network hitch, making the next state patch look like a
      // backward push. Scale the allowed catch-up distance from the mount's real
      // speed and actual packet gap, while still bounding impossible teleports.
      const slowMul=(Number(p._abilitySlowUntil)||0)>this.state.worldTime?(Number(p._abilitySlowMul)||.55):1;
      const inputMag=clamp(Math.hypot(p.moveX||0,p.moveY||0),0,1);
      const hydrationMul=this.hydrationMoveMul(p.hydration);
      let expectedSpeed=148*inputMag*this.runPerks(client.sessionId).moveMul*hydrationMul;
      if(p.vehicleType)expectedSpeed*=vehicleSpeedMul(p.vehicleType,p.vehicleTier||0,p.vehicleVariant||"");
      if(rideMount&&!rideMount.dead)expectedSpeed=Math.max(24,Number(rideMount.speed)||148)*petStoneFruitMoveMul(rideMount)*2.30*inputMag;
      const onOceanFloor=!p.vehicleType&&!rideMount&&worldBiomeAt(p.x,p.y)==="ocean"&&oceanDepthAt(p.x,p.y)>=OCEAN_DIVE_START;
      if(onOceanFloor&& !((Number(p._blueSeaweedUntil)||0)>this.state.worldTime)){if(Number(p.divingSuitTier)>=0)expectedSpeed*=divingSuitMoveMulServer(p);else expectedSpeed*=.72;}
      if(p.heldSpecial==="Wall")expectedSpeed*=.64;
      expectedSpeed*=slowMul;
      const minStep=rideMount?52:(p.vehicleType?44:34);
      const maxCap=rideMount?190:(p.vehicleType?155:110);
      const maxStep=clamp(expectedSpeed*packetDt*1.90+16,minStep,maxCap);
      let dx=tx-p.x,dy=ty-p.y;const len=Math.hypot(dx,dy);
      if(len>maxStep){dx=dx/len*maxStep;dy=dy/len*maxStep;tx=p.x+dx;ty=p.y+dy;}
      const steps=Math.max(1,Math.min(24,Math.ceil(Math.hypot(tx-p.x,ty-p.y)/5.5)));
      const sx=(tx-p.x)/steps,sy=(ty-p.y)/steps;
      if(rideMount&&!rideMount.dead)rideMount._lastResourceContactId="";
      for(let i=0;i<steps;i++){
        const nx=clamp(p.x+sx,PLAYER_R,WORLD_W-PLAYER_R),ny=clamp(p.y+sy,PLAYER_R,WORLD_H-PLAYER_R);
        if(p.vehicleType&&!vehicleTravelAllowed(nx,ny))break;
        p.x=nx;p.y=ny;
        const mount=p.ridingPetId?this.state.pets.get(p.ridingPetId):null;
        if(mount&&!mount.dead){
          mount._mountedCollision=true;mount.x=p.x;mount.y=p.y;
          this.resolveStatic(mount,(mount.r||18)*.72);
          p.x=mount.x;p.y=mount.y;
        }else this.resolveStatic(p,PLAYER_R*.82);
      }
      this.applyMovementHydration(p,inputMag,packetDt);
      const pushedDx=p.x-moveStartX,pushedDy=p.y-moveStartY,pushedLen=Math.hypot(pushedDx,pushedDy);
      if(!rideMount&&!p.vehicleType&&pushedLen>.05&&worldBiomeAt(p.x,p.y)==="ocean"&&oceanDepthAt(p.x,p.y)>=OCEAN_DIVE_START){
        for(const q of this.nearbySolids(p.x,p.y,62)){if(q.kind!=="resource")continue;const r=this.state.resources.get(q.id);if(!r||!r.alive||r.type!=="oceanAnemone")continue;const rr=Math.max(5,Number(r.solidR)||6);if(dist(p.x,p.y,r.x,r.y)>PLAYER_R+rr+5)continue;const oldX=r.x,oldY=r.y,step=Math.min(9,pushedLen*.72),nx=pushedDx/pushedLen,ny=pushedDy/pushedLen,txr=clamp(r.x+nx*step,18,WORLD_W-18),tyr=clamp(r.y+ny*step,18,WORLD_H-18);if(worldBiomeAt(txr,tyr)!=="ocean"||oceanDepthAt(txr,tyr)<OCEAN_DIVE_START-40)continue;r.x=txr;r.y=tyr;this.moveResourceSolid(q.id,r,oldX,oldY);}
      }
      if(rideMount&&!rideMount.dead&&rideMount._lastResourceContactId&&dist(p.x,p.y,tx,ty)>2.5){
        const r=this.state.resources.get(rideMount._lastResourceContactId);
        if(this.resourceBlocksCreaturePath(rideMount,r)){
          rideMount._blockingResourceId=rideMount._lastResourceContactId;
          rideMount._blockingResourceUntil=this.state.worldTime+.24;
        }
      }else if(rideMount&&!rideMount.dead&&(Number(rideMount._blockingResourceUntil)||0)<this.state.worldTime){
        rideMount._blockingResourceId="";
      }
    }
  }
  handleHeal(client,data){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;
    const amount=clamp(+data.amount||0,0,40),source=String(data?.source||"");

    // Normal berries never hydrate. While mounted, a berry can only heal the
    // currently ridden pet and is rejected if that pet is already full health.
    if(source==="berry"&&p.ridingPetId){
      const mount=this.state.pets.get(p.ridingPetId);
      if(!mount||mount.dead||mount.ownerId!==client.sessionId||mount.hp>=mount.maxHp-.01)return;
      if(amount>0)mount.hp=clamp(mount.hp+amount,0,mount.maxHp);
      this.broadcastEntityHealth("pet",p.ridingPetId,mount);
      return;
    }
    if(source==="berry"){
      if(p.health>=p.maxHealth-.01)return;
      if(amount>0)p.health=clamp(p.health+amount,0,p.maxHealth);
      return;
    }

    // Keep legacy non-berry healing packets working without allowing them to
    // bypass the mounted target chosen by the server.
    if(data?.target==="mount"&&p.ridingPetId){
      const mount=this.state.pets.get(p.ridingPetId);
      if(mount&&!mount.dead&&mount.ownerId===client.sessionId&&mount.hp<mount.maxHp-.01){mount.hp=clamp(mount.hp+amount,0,mount.maxHp);this.broadcastEntityHealth("pet",p.ridingPetId,mount);}
      return;
    }
    if(amount>0)p.health=clamp(p.health+amount,0,p.maxHealth);
  }
  handleRespawn(client,data={}){const p=this.state.players.get(client.sessionId);if(!p)return;this.playerCombatReadyAt.set(client.sessionId,this.state.worldTime+1.15);this.playerSurvivalSeconds.set(client.sessionId,0);this.playerSurvivalAwards.set(client.sessionId,new Set());this.playerNightSeen.delete(client.sessionId);this.playerRunShop.set(client.sessionId,{purchased:new Set(),hat:"",cape:"",armor:""});this.playerSkillProgress.set(client.sessionId,{level:0,xp:0,speed:0,strength:0,defense:0,stoneChoice:"",weaponChoice:"",milestones:{}});this.playerBiomeMaterials.set(client.sessionId,{});this.playerStoneFruitStacks.set(client.sessionId,[]);this.sendSkillState(client.sessionId);this.tamePendingPlayers.delete(client.sessionId);const oldX=p.x,oldY=p.y;const requested=Math.max(0,Math.min(3200,Number(data?.minDistance)||2400));const s=this.safeSpawn(oldX,oldY,requested);p.x=s.x;p.y=s.y;p.angle=rand(-Math.PI,Math.PI);p.health=p.maxHealth;p.hydration=100;p.bucketWater=true;p.bucketSips=BUCKET_MAX_SIPS;p.dead=false;p.tool="Fist";p.heldSpecial="";p.ridingPetId="";p.vehicleType="";p.vehicleTier=0;p.vehicleVariant="";p.saddleTier=0;p.saddleVariant="";p.divingSuitTier=-1;p.divingSuitVariant="";p.oxygen=0;p.oxygenMax=0;p.animalCarryT=0;p._jungleHotUntil=0;p._jungleHotRate=0;p._cactusGoodUntil=0;p._cactusHealRate=0;p._cactusHydrateRate=0;p._badCactusUntil=0;p._badCactusDamageRate=0;p._badCactusHydrateRate=0;p._cactusSpineCd=0;p._desertHydrationWait=2.5;p._stoneFruitUntil=0;p._blueSeaweedUntil=0;this.playerStoneFruitStacks.set(client.sessionId,[]);p._honeyRushUntil=0;p._honeyHealUntil=0;p._honeyHealRate=0;p._honeyHasteMul=1;p._mountedCactusHydrateUntil=0;p._mountedCactusHydrateRate=0;p._mountedBadCactusUntil=0;p._mountedBadCactusHydrateRate=0;this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);this.pendingAnimalPushes.delete(client.sessionId);let i=0;for(const[id,pet]of this.state.pets){if(!pet||pet.ownerId!==client.sessionId)continue;const pos=this.safePetSpawnNear(p.x,p.y,pet.r||18);pet.x=pos.x;pet.y=pos.y;pet.angle=p.angle;pet.targetX=0;pet.targetY=0;pet.follow=true;pet.orderMode="follow";this.petFollowState.delete(id);this.petChaseState.delete(id);if(pet.dead){pet.dead=false;pet.hp=pet.maxHp;this.petDeathTimers.delete(id);}i++;}client.send("respawned",{x:p.x,y:p.y,movedFrom:{x:oldX,y:oldY}});}
  handleRevive(client,data={}){
    const p=this.state.players.get(client.sessionId); if(!p||!p.dead)return;
    const accountId=this.playerAccountIds.get(client.sessionId);
    let auth=null; try{ if(accountId)auth=HOSTL_ACCOUNT_HOOKS.consumeReviveAuthorization(String(accountId),String(data?.reviveToken||"")); }catch(_){auth=null;}
    if(!auth?.ok){client.send("reviveDenied",{error:"revive_not_authorized"});return;}
    const oldX=p.x,oldY=p.y,s=this.safeSpawn(oldX,oldY,760);
    this.playerCombatReadyAt.set(client.sessionId,this.state.worldTime+1.35);
    p.x=s.x;p.y=s.y;p.angle=rand(-Math.PI,Math.PI);p.health=Math.max(1,p.maxHealth*.60);p.hydration=65;p.bucketWater=true;p.bucketSips=Math.min(BUCKET_MAX_SIPS,2);p.dead=false;p.heldSpecial="";p.ridingPetId="";p.vehicleType="";p.vehicleTier=0;p.vehicleVariant="";p.divingSuitTier=-1;p.divingSuitVariant="";p.oxygen=0;p.oxygenMax=0;p.animalCarryT=0;
    p.gold=Math.max(0,Math.floor((Number(p.gold)||0)*.35));
    const inv=this.playerBiomeMaterials.get(client.sessionId)||{};for(const k of Object.keys(inv))inv[k]=Math.max(0,Math.floor((Number(inv[k])||0)*.35));this.playerBiomeMaterials.set(client.sessionId,inv);
    p._jungleHotUntil=0;p._jungleHotRate=0;p._cactusGoodUntil=0;p._cactusHealRate=0;p._cactusHydrateRate=0;p._badCactusUntil=0;p._badCactusDamageRate=0;p._badCactusHydrateRate=0;p._cactusSpineCd=0;p._desertHydrationWait=2.5;p._stoneFruitUntil=0;p._blueSeaweedUntil=0;this.playerStoneFruitStacks.set(client.sessionId,[]);p._honeyRushUntil=0;p._honeyHealUntil=0;p._honeyHealRate=0;p._honeyHasteMul=1;p._mountedCactusHydrateUntil=0;p._mountedCactusHydrateRate=0;p._mountedBadCactusUntil=0;p._mountedBadCactusHydrateRate=0;
    this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);this.pendingAnimalPushes.delete(client.sessionId);this.tamePendingPlayers.delete(client.sessionId);
    for(const[id,pet]of this.state.pets){if(!pet||pet.ownerId!==client.sessionId)continue;const pos=this.safePetSpawnNear(p.x,p.y,pet.r||18);pet.x=pos.x;pet.y=pos.y;pet.angle=p.angle;pet.targetX=0;pet.targetY=0;pet.follow=true;pet.orderMode="follow";pet.dead=false;pet.hp=Math.max(1,pet.maxHp*.60);this.petDeathTimers.delete(id);this.petFollowState.delete(id);this.petChaseState.delete(id);}
    client.send("revived",{x:p.x,y:p.y,health:p.health,hydration:p.hydration,bucketSips:p.bucketSips,gold:p.gold,biomeMaterials:inv,method:auth.method||""});
  }

  refreshVerifiedAccount(ownerId){
    const key=String(ownerId||""),accountId=this.playerAccountIds.get(key);
    if(!accountId)return this.playerAccountEntitlements.get(key)||null;
    try{
      const fresh=HOSTL_ACCOUNT_HOOKS.refreshAccount(String(accountId));
      if(fresh&&typeof fresh==="object"){
        this.playerAccountEntitlements.set(key,fresh);
        const upgrades=(fresh.petStatUpgrades&&typeof fresh.petStatUpgrades==="object")?fresh.petStatUpgrades:{};
        this.playerPetStatUpgrades.set(key,upgrades);
        return fresh;
      }
    }catch(_){}
    return this.playerAccountEntitlements.get(key)||null;
  }
  verifiedAccountFor(ownerId){return this.playerAccountEntitlements.get(String(ownerId||""))||null;}
  accountCanStartPet(ownerId,type){
    const a=this.verifiedAccountFor(ownerId); if(!a)return true;
    type=String(type||""); if(!PET_TYPES[type])return false;
    if(type==="dog"||type==="cat"||type==="dragon")return true;
    if(a.ownedStarters?.[`start_${type}`])return true;
    return Array.isArray(a.starterPetEntitlements)&&a.starterPetEntitlements.some(x=>x&&x.type===type);
  }
  accountStarterStage(ownerId,type,requested="baby"){
    const order=["baby","adult","boss","superboss"],a=this.verifiedAccountFor(ownerId);
    type=String(type||"")==="viper"?"snake":String(type||"");
    if(!a)return order.includes(requested)?requested:"baby";
    let stage=order.includes(a.petStages?.[type])?a.petStages[type]:"baby";
    for(const ent of Array.isArray(a.starterPetEntitlements)?a.starterPetEntitlements:[]){
      const entType=String(ent?.type||"")==="viper"?"snake":String(ent?.type||"");
      if(entType!==type)continue;const st=ent.stage==="bigmomma"?"superboss":ent.stage;if(order.includes(st)&&order.indexOf(st)>order.indexOf(stage))stage=st;
    }
    return stage;
  }

  applyStarterStageToExistingPet(p,ownerId,targetStage){
    if(!p)return false;
    const order=["baby","adult","boss","superboss"],current=order.includes(p.stage)?p.stage:"baby";
    const validTarget=order.includes(targetStage)?targetStage:current;
    const stageUpgraded=order.indexOf(validTarget)>order.indexOf(current);
    const oldMax=Math.max(1,Number(p.maxHp)||typeHp(p.type,current)),oldHp=Math.max(0,Number(p.hp)||oldMax),hpRatio=clamp(oldHp/oldMax,0,1);
    if(stageUpgraded){p.stage=validTarget;p.r=animalRadius(p.type,validTarget);p.level=1;p.exp=0;}
    // Always refresh permanent card/stat upgrades, even when the stage did not
    // change. Home preview rooms can stay connected while the player upgrades a
    // code pet, so waiting for a reconnect would leave the live pet stale.
    this.applyPetUpgradeFields(p,ownerId,p.type);
    p.maxHp=Math.max(12,Math.round(typeHp(p.type,p.stage)*petUpgradeMultiplier(p,"health")));
    p.hp=stageUpgraded?p.maxHp:Math.max(1,Math.min(p.maxHp,p.maxHp*hpRatio));
    p.speed=animalSpeed(p.type,p.stage,true,petUpgradeMultiplier(p,"weight"))*petUpgradeMultiplier(p,"speed");
    return stageUpgraded;
  }

  ensureStarterPetFor(client,type,stage,opts={}){
    if(!client)return null;
    type=String(type||"")==="viper"?"snake":String(type||"");
    this.refreshVerifiedAccount(client.sessionId);
    if(!PET_TYPES[type])return null;
    if(!this.accountCanStartPet(client.sessionId,type)){client.send("starterPetDenied",{type,reason:"not_owned"});return null;}
    const validStage=this.accountStarterStage(client.sessionId,type,stage);
    const defaultName=PET_TYPES[type].name||type;
    const petName=(String(opts.petName||"").trim().replace(/\s+/g," ").slice(0,14)||defaultName.slice(0,14));
    const gender=String(opts.gender||"")==="Female"?"Female":"Male";

    // Starter repair must enforce the configured stage, not merely notice that
    // some owned pet exists. This fixes lower-stage pets surviving a join/sync
    // race after the account has already unlocked Boss or Super Boss starts.
    for(const [id,p] of this.state.pets){
      if(!p||p.ownerId!==client.sessionId||p.dead||p.type!==type)continue;
      const upgraded=this.applyStarterStageToExistingPet(p,client.sessionId,validStage);
      if(petName)p.petName=petName;if(opts.gender)p.gender=gender;
      client.send("starterPetEnsured",{id,type:p.type,stage:p.stage,petName:p.petName,gender:p.gender,existing:true,stageCorrected:upgraded});
      return id;
    }
    const owner=this.state.players.get(client.sessionId);if(!owner)return null;
    const rr=animalRadius(type,validStage),pos=this.safePetSpawnNear(owner.x,owner.y,rr);
    const id=this.addPet(client.sessionId,type,validStage,pos.x,pos.y,{petName,gender});
    if(id)client.send("starterPetEnsured",{id,type,stage:validStage,petName,gender,existing:false});
    return id;
  }

  handleEnsureStarterPet(client,data={}){
    const type=String(data.type||"");
    const stage=String(data.stage||"baby");
    this.ensureStarterPetFor(client,type,stage,{petName:data.petName,gender:data.gender});
  }

  hydrationMoveMul(value){const h=clamp(Number(value)||0,0,100);return h>=HYDRATION_NORMAL_SPEED_AT?1:(.60+(h/HYDRATION_NORMAL_SPEED_AT)*.40);}
  consumeHydration(ownerId,amount){const p=this.state.players.get(ownerId);if(!p||p.dead)return;const loss=Math.max(0,Number(amount)||0);if(loss<=0)return;p.hydration=clamp((Number(p.hydration)||0)-loss,0,100);}
  applyMovementHydration(p,inputMag,dt){if(!p||p.dead||!(inputMag>0.02)||!(dt>0))return;const biome=worldBiomeAt(p.x,p.y);if(!isHotDryBiome(biome)){p._desertHydrationWait=2.5;return;}const rate=1.85*(0.45+Math.min(1,Number(inputMag)||0)*0.55);if(!Number.isFinite(Number(p._desertHydrationWait)))p._desertHydrationWait=2.5;p._desertHydrationWait=Math.max(0,Number(p._desertHydrationWait)-dt);if(p._desertHydrationWait<=0){p.hydration=clamp((Number(p.hydration)||0)-rate*2.5,0,100);p._desertHydrationWait=2.5;}}
  handleWaterAction(client,data={}){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const action=String(data.action||"");
    if(action==="drink"){
      let sips=clamp(Math.floor(Number(p.bucketSips)||0),0,BUCKET_MAX_SIPS);
      if(sips<=0&&p.bucketWater)sips=BUCKET_MAX_SIPS; // migrate players connected from the older full/empty bucket state
      if(sips<=0){p.bucketWater=false;p.bucketSips=0;client.send("waterResult",{ok:false,message:"Your bucket is empty",hydration:p.hydration,bucketWater:false,bucketSips:0});return;}
      sips--;p.bucketSips=sips;p.bucketWater=sips>0;p.hydration=clamp((Number(p.hydration)||0)+BUCKET_SIP_HYDRATION,0,100);
      client.send("waterResult",{ok:true,message:sips>0?`Sip taken — ${sips} sip${sips===1?"":"s"} left`:`Last sip — bucket empty`,hydration:p.hydration,bucketWater:p.bucketWater,bucketSips:sips});return;
    }
    if(action!=="fill")return;let near=false;for(const[,r]of this.state.resources){if(!r||!r.alive||(r.type!=="pond"&&r.type!=="river"))continue;if(waterNearPoint(r,p.x,p.y,78)){near=true;break;}}
    if(!near){client.send("waterResult",{ok:false,message:"Move closer to a pond or river to fill the bucket",hydration:p.hydration,bucketWater:!!p.bucketWater,bucketSips:clamp(Math.floor(Number(p.bucketSips)||0),0,BUCKET_MAX_SIPS)});return;}
    p.bucketSips=BUCKET_MAX_SIPS;p.bucketWater=true;client.send("waterResult",{ok:true,message:"Bucket filled — 5 sips",hydration:p.hydration,bucketWater:true,bucketSips:BUCKET_MAX_SIPS});
  }

  handleResourceHit(client,data,options={}){const id=String(data.id||""),r=this.state.resources.get(id);if(!r||!r.alive||r.type==="pond"||r.type==="river")return;if(!options.projectile){if(data.preciseWeapon){const pp=this.state.players.get(client.sessionId),preTool=this.allowedTool(client.sessionId,String(data.tool||"Fist")),preTier=this.weaponTierForOwner(client.sessionId),prePose=preciseWeaponPoseKey(preTool,preTier,String(this.skillState(client.sessionId).weaponChoice||"")),preAng=Number.isFinite(+data.angle)?+data.angle:(pp?.angle||0),preShape=pp&&prePose?preciseWeaponShape(pp,prePose,preAng,clamp(Number(data.attackT)||.54,0,1)):null;if(!preShape||!preciseShapeTouchesResource(preShape,r))return;}else if(!this.playerCanReach(client,r.x,r.y,Math.min(80,r.solidR)))return;}if(this.isBeeFlowerResource(r)){this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:BIOME_RESOURCE_INFO[r.type]?.color||"#ef8ac4"});return;}this.addSkillXp(client.sessionId,1);const toolName=this.allowedTool(client.sessionId,String(data.tool||"Fist")),t=this.specializedToolStats(client.sessionId,toolName,this.weaponTierForOwner(client.sessionId));const p=this.state.players.get(client.sessionId),biomeInfo=BIOME_RESOURCE_INFO[r.type];if(!options.skipHydration)this.consumeHydration(client.sessionId,biomeInfo?.category==="soft"?.9:(r.type==="bush"?.65:1.2));this.broadcast("playerAction",{playerId:client.sessionId,action:"resourceHit",tool:toolName,angle:p?.angle||0,heldSpecial:p?.heldSpecial||"",targetKind:"resource",targetId:id});this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:biomeInfo?.color||(r.type==="bush"?"#d1315c":((r.type==="rock"||r.type==="oceanRock")?"#a9b3bd":"#c99a5b"))});if(biomeInfo){if(r.type==="forestGiantFlower"||r.type==="rainforestGiantFlower"){this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:biomeInfo.color});return;}if(r.type==="rainforestHive"){const gotComb=Math.random()<.26,honeyAmt=1,inv=this.playerBiomeMaterials.get(client.sessionId)||{};if(gotComb)inv.honeycomb=(inv.honeycomb||0)+1;inv.honey=(inv.honey||0)+honeyAmt;this.playerBiomeMaterials.set(client.sessionId,inv);if(gotComb)client.send("resourceReward",{id,kind:"biomeMaterial",material:"honeycomb",amount:1,label:"Honey Comb",color:biomeInfo.color});else client.send("resourceReward",{id,kind:"hiveMiss",material:"honeycomb",amount:0,label:"No Honey Comb",color:"#e7c66d"});client.send("resourceReward",{id,kind:"biomeMaterial",material:"honey",amount:honeyAmt,label:"Honey",color:"#f4bd42"});this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:gotComb?"+ Honey Comb":"No comb",color:gotComb?biomeInfo.color:"#e7c66d"});return;}const correct=(biomeInfo.category==="wood"&&toolName==="Axe")||(biomeInfo.category==="stone"&&toolName==="Pickaxe")||(biomeInfo.category==="soft"&&(toolName==="Fist"||toolName==="Axe"));let damage=(t.resourcePower==null?1:t.resourcePower)*(correct?1.25:.68);if(toolName==="Sword")damage*=.35;r.hp=Math.max(0,r.hp-damage);const amount=correct?2:1,inv=this.playerBiomeMaterials.get(client.sessionId)||{};inv[biomeInfo.material]=(inv[biomeInfo.material]||0)+amount;this.playerBiomeMaterials.set(client.sessionId,inv);client.send("resourceReward",{id,kind:"biomeMaterial",material:biomeInfo.material,amount,label:biomeInfo.name,color:biomeInfo.color});this.broadcastEntityHealth("resource",id,r);if(r.hp<=0){r.alive=false;this.resourceRespawns.set(id,rand(18,30));this.broadcastEntityHealth("resource",id,r);const accountId=this.playerAccountIds.get(client.sessionId),homeMap={treeResin:"resin",wildHerb:"wildHerb",jungleVine:"swiftFiber",iceCrystal:"iceCrystal"},homeId=homeMap[biomeInfo.material];if(accountId&&homeId){Promise.resolve(HOSTL_ACCOUNT_HOOKS.rewardGameplayMaterial(String(accountId),homeId,1,`biome:${r.type}`)).then(result=>{if(result?.granted)client.send("accountMaterialReward",result);}).catch(()=>{});}}return;}if(r.type==="bush"){r.hp=Math.max(0,r.hp-Math.max(.5,t.gather*.9));client.send("resourceReward",{id,kind:"berries",amount:Math.max(1,Math.round(randi(1,2)*this.runPerks(client.sessionId).gatherMul))});}else{const isWood=r.type==="tree"||r.type==="log",correctAxe=toolName==="Axe"&&isWood,correctPick=toolName==="Pickaxe"&&(r.type==="rock"||r.type==="oceanRock");let damage=t.resourcePower;if(r.type==="log")damage*=1.35;if(toolName==="Fist")damage*=r.type==="log"?1.25:.82;if(toolName==="Axe"&&!correctAxe)damage*=.32;if(toolName==="Pickaxe"&&!correctPick)damage*=.32;r.hp=Math.max(0,r.hp-damage);let y=1;if(r.type==="log")y=toolName==="Fist"?2:correctAxe?6:toolName==="Sword"?1:2;else if(correctAxe||correctPick)y=t.gather;else if(toolName==="Fist")y=t.gather;else if(toolName==="Sword")y=.12;else if(toolName==="Bow")y=1;else y=.45;y*=this.runPerks(client.sessionId).gatherMul;const key=`${client.sessionId}:${id}`,credit=(this.harvestCredits.get(key)||0)+y,whole=Math.floor(credit+1e-6);this.harvestCredits.set(key,credit-whole);if(whole>0)client.send("resourceReward",{id,kind:isWood?"wood":"stone",amount:whole});else if(toolName==="Sword")client.send("resourceReward",{id,kind:isWood?"wood":"stone",amount:0,tiny:true});}this.broadcastEntityHealth("resource",id,r);if(r.hp<=0){r.hp=0;r.alive=false;this.broadcastEntityHealth("resource",id,r);this.resourceRespawns.set(id,rand(12,22));}}
  handleSubClaw(client,data={}){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead||p.vehicleType!=="Sub")return;
    const now=this.state.worldTime,next=this.playerAttackCd.get(client.sessionId)||0;if(now<next)return;this.playerAttackCd.set(client.sessionId,now+.34);
    const id=String(data.id||""),r=this.state.resources.get(id);if(!r||!r.alive)return;
    const info=BIOME_RESOURCE_INFO[r.type],isOceanRock=r.type==="oceanRock",isOceanResource=!!info&&info.biome==="ocean";if(!isOceanRock&&!isOceanResource)return;
    const tier=Math.min(clamp(Math.floor(Number(data.tier)||0),0,3),this.buildTierForOwner(client.sessionId,"Sub"));
    const a=Number.isFinite(+data.angle)?+data.angle:p.angle;p.angle=a;const c=resourceCenter(r),dx=c.x-p.x,dy=c.y-p.y,d=Math.hypot(dx,dy),range=108+Math.max(5,Number(r.solidR)||6);if(d>range)return;
    if(d>18){const dot=(dx/d)*Math.cos(a)+(dy/d)*Math.sin(a);if(dot<-.08)return;}
    this.broadcast("playerAction",{playerId:client.sessionId,action:"subClaw",tool:"Sub",angle:a,heldSpecial:"Sub",targetKind:"resource",targetId:id});
    this.broadcastFx({kind:"hit",x:c.x,y:c.y,text:"",color:info?.color||(isOceanRock?"#a9b3bd":"#59c7de")});
    if(isOceanRock){r.hp=Math.max(0,r.hp-(1.65+tier*.42));const amount=tier>=2?2:1;client.send("resourceReward",{id,kind:"stone",amount});}
    else{r.hp=Math.max(0,r.hp-(1.45+tier*.34));const amount=tier>=3?2:1,inv=this.playerBiomeMaterials.get(client.sessionId)||{};inv[info.material]=(inv[info.material]||0)+amount;this.playerBiomeMaterials.set(client.sessionId,inv);client.send("resourceReward",{id,kind:"biomeMaterial",material:info.material,amount,label:info.name,color:info.color});}
    this.broadcastEntityHealth("resource",id,r);if(r.hp<=0){r.hp=0;r.alive=false;this.broadcastEntityHealth("resource",id,r);this.resourceRespawns.set(id,rand(12,22));}
  }
  handleGoldHit(client,data){const id=String(data.id||""),g=this.state.gold.get(id);if(!g||(!g.infinite&&g.goldLeft<=0))return;if(data.preciseWeapon){const pp=this.state.players.get(client.sessionId),preTool=this.allowedTool(client.sessionId,String(data.tool||"Fist")),preTier=this.weaponTierForOwner(client.sessionId),prePose=preciseWeaponPoseKey(preTool,preTier,String(this.skillState(client.sessionId).weaponChoice||"")),preAng=Number.isFinite(+data.angle)?+data.angle:(pp?.angle||0),preShape=pp&&prePose?preciseWeaponShape(pp,prePose,preAng,clamp(Number(data.attackT)||.54,0,1)):null;if(!preShape||!preciseShapeTouchesGold(preShape,g))return;}else if(!this.playerCanReach(client,g.x,g.y,Math.min(150,g.r)))return;this.addSkillXp(client.sessionId,1);const tool=this.allowedTool(client.sessionId,String(data.tool||"Fist"));const p=this.state.players.get(client.sessionId);this.consumeHydration(client.sessionId,1.05);this.broadcast("playerAction",{playerId:client.sessionId,action:"goldHit",tool,angle:p?.angle||0,heldSpecial:p?.heldSpecial||"",targetKind:"gold",targetId:id});this.broadcastFx({kind:"hit",x:g.x,y:g.y,text:"",color:g.pure?"#fff19a":"#ffd23f"});let take=0,tiny=false;if(tool==="Fist"){const key=`${client.sessionId}:${id}`;let c=(this.goldHandCredits.get(key)||0)+.12;if(c>=1){take=1;c-=1;}else tiny=true;this.goldHandCredits.set(key,c);}else take=g.pure?3:g.size==="huge"?randi(2,4):1;if(!g.infinite)take=Math.min(take,Math.max(0,g.goldLeft));if(take>0){if(!g.infinite)g.goldLeft=Math.max(0,g.goldLeft-take);take=Math.max(1,Math.round(take*this.runPerks(client.sessionId).gatherMul));const p=this.state.players.get(client.sessionId);if(p)p.gold=Math.max(0,Math.floor((Number(p.gold)||0)+take));client.send("resourceReward",{id,kind:"gold",amount:take,pure:!!g.pure,balance:p?p.gold:undefined});}else client.send("resourceReward",{id,kind:"gold",amount:0,tiny});}

  maybeRewardWildMaterial(attackerId,a){
    const userId=this.playerAccountIds?.get(String(attackerId||"")); if(!userId||!a)return;
    let id="",qty=0;
    // Legendary gameplay drop: Super Boss snakes can drop one or two Sharpened Fangs.
    if(a.type==="snake"&&a.stage==="superboss"&&Math.random()<.45){id="sharpFang";qty=Math.random()<.25?2:1;}
    // Mythical gameplay drop: the strongest dragons can very rarely drop an Apex Scale.
    else if(a.type==="dragon"&&(a.stage==="superboss"||a.stage==="bigmomma")&&Math.random()<(a.stage==="bigmomma"?.14:.06)){id="apexScale";qty=1;}
    // Ordinary boss wildlife can still produce useful common materials.
    else if(["bear","boar","deer"].includes(a.type)&&["boss","superboss","bigmomma"].includes(a.stage)&&Math.random()<.28){id="leather";qty=1+(a.stage==="bigmomma"&&Math.random()<.35?1:0);}
    if(!id||qty<=0)return;
    const c=this.clientById(String(attackerId||""));
    Promise.resolve(HOSTL_ACCOUNT_HOOKS.rewardGameplayMaterial(String(userId),id,qty,`wild:${a.stage}:${a.type}`)).then(result=>{
      if(result?.granted&&c)c.send("accountMaterialReward",result);
    }).catch(()=>{});
  }

  spawnQueenBroodFromBoss(a){
    if(!a||a.type!=="queenbee"||!["superboss","bigmomma"].includes(a.stage))return 0;
    const count=a.stage==="bigmomma"?10:randi(2,4);let made=0;
    const biome=biomeBaseId(worldBiomeAt(a.x,a.y)),foot=animalSpawnFootprint("queenbee","baby");
    for(let i=0;i<count;i++){
      const ring=i<5?Math.max(72,(a.r||18)*.56):Math.max(118,(a.r||18)*.78),aa=(i%5)/5*TAU+(i>=5?.34:0);
      let x=clamp(a.x+Math.cos(aa)*ring,24,WORLD_W-24),y=clamp(a.y+Math.sin(aa)*ring*.78,24,WORLD_H-24);
      const bid=this.addAnimal("queenbee","baby",x,y,{sleeping:true,gender:"Female",motherId:"",bredChild:true,biome}),baby=this.state.animals.get(bid);if(!baby)continue;
      baby.enraged=false;baby.tameFailedAggro=false;baby.desperateAggro=false;baby.combat=0;if(a._hiveHomeId)baby._hiveHomeId=a._hiveHomeId;
      this.resolveStatic(baby,Math.max(6,foot*.55));this.broadcastFx({kind:"familyBirth",x:baby.x,y:baby.y});made++;
    }
    return made;
  }

  hitWild(id,a,dmg,attackerId,crit=false,attackerRef=null){
    if(!a||a.hp<=0)return;
    dmg=animalDamageTaken(a.type,a.stage,dmg);
    const ref=attackerRef||{kind:"player",id:attackerId};
    if(ref.kind==="pet"&&ref.id)this.markPetXpContribution("animal",id,ref.id,dmg);
    if(ref.kind==="player"&&attackerId)this.addSkillXp(attackerId,1);
    a.hp=Math.max(0,a.hp-dmg);if(ref.kind==="pet"){const pet=this.state.pets.get(ref.id),f=petArmorHealFrac(pet);if(pet&&f>0)pet.hp=Math.min(pet.maxHp,pet.hp+dmg*f);}a.flash=.12;a.recentHit=4.2;this.markWildStayAwake(a,6.7);a.sleeping=false;a.enraged=true;a.combat=8;this.broadcastEntityHealth("animal",id,a);
    const guardOwner=this.enemyOwnerByPet.get(id);
    if(guardOwner){a.fleeUntil=0;a.tameFailedAggro=true;this.animalFleeFrom.delete(id);this.animalAggro.set(id,ref);}
    else this.setWildReactionToAttacker(id,a,ref);
    this.broadcastFx({kind:"hit",x:a.x,y:a.y,text:(crit?"CRIT ":"")+Math.round(dmg),color:crit?"#ffe08a":"#f2836a"});
    if(a.hp<=0){if(guardOwner){this.enemyOwnerByPet.delete(id);if(this.enemyPetByEnemy.get(guardOwner)===id)this.enemyPetByEnemy.delete(guardOwner);const owner=this.state.enemies.get(guardOwner);if(owner){owner.guardPetId="";owner.ridingPetId="";owner.hasGuard=false;}}for(const[petId,focus]of Array.from(this.petFocusTargets.entries())){if(focus&&focus.kind==="animal"&&focus.id===id){this.petFocusTargets.delete(petId);this.petHuntState.delete(petId);this.petFollowState.delete(petId);this.petChaseState.delete(petId);const pet=this.state.pets.get(petId);if(pet){pet.orderMode="follow";pet.targetX=-1;pet.targetY=-1;}}}this.awardPetXpContributors("animal",id,a,ref.kind==="pet"?ref.id:"");this.maybeRewardWildMaterial(attackerId,a);this.spawnQueenBroodFromBoss(a);this.broadcastSpectateKill("animal",id,ref.kind,ref.id);this.state.animals.delete(id);this.animalAggro.delete(id);this.animalFleeFrom.delete(id);this.rewardKill(attackerId,"animal",a.x,a.y,a.type);}
  }
  hitEnemy(id,en,dmg,attackerId,crit=false,attackerRef=null){
    if(!en||en.hp<=0)return;
    const ref=attackerRef||{kind:"player",id:attackerId};
    if(ref.kind==="pet"&&ref.id)this.markPetXpContribution("enemy",id,ref.id,dmg);
    if(ref.kind==="player"&&attackerId)this.addSkillXp(attackerId,1);
    en.hp=Math.max(0,en.hp-dmg);if(ref.kind==="pet"){const pet=this.state.pets.get(ref.id),f=petArmorHealFrac(pet);if(pet&&f>0)pet.hp=Math.min(pet.maxHp,pet.hp+dmg*f);}en.flash=.12;this.broadcastEntityHealth("enemy",id,en);this.enemyAggro.set(id,ref.kind==="pet"?{kind:"pet",id:ref.id}:{kind:"player",id:attackerId});
    const guardId=this.enemyPetByEnemy.get(id),guard=guardId&&this.state.animals.get(guardId);
    if(guard){guard.sleeping=false;guard.enraged=true;guard.combat=10;guard.tameFailedAggro=true;this.animalAggro.set(guardId,{kind:"player",id:attackerId});}
    this.broadcastFx({kind:"hit",x:en.x,y:en.y,text:(crit?"CRIT ":"")+Math.round(dmg),color:crit?"#ffe08a":"#f2836a"});
    if(en.hp<=0){
      this.awardPetXpContributors("enemy",id,en,ref.kind==="pet"?ref.id:"");
      if(en.moonMarked&&attackerId){this.firstLightReadyPlayers.add(attackerId);const c=this.clientById(attackerId);if(c)c.send("moonmarkClaimed",{x:en.x,y:en.y,biome:en.moonBiome||CURRENT_BIOME_ID,boss:en.role||"Forest Warden"});}
      for(const[petId,focus]of Array.from(this.petFocusTargets.entries())){if(focus&&focus.kind==="enemy"&&focus.id===id){this.petFocusTargets.delete(petId);this.petHuntState.delete(petId);this.petFollowState.delete(petId);this.petChaseState.delete(petId);const pet=this.state.pets.get(petId);if(pet){pet.orderMode="follow";pet.targetX=-1;pet.targetY=-1;}}}
      this.broadcastSpectateKill("enemy",id,ref.kind,ref.id||attackerId);this.state.enemies.delete(id);this.enemyAggro.delete(id);this.detachEnemyGuard(id,attackerId,false);if(en.moonMarked)this.rewardMoonmarkKill(attackerId,en.x,en.y);else this.rewardKill(attackerId,"enemy",en.x,en.y);
    }
  }
  rewardMoonmarkKill(ownerId,x,y){
    const owner=this.state.players.get(ownerId);if(!ownerId||!owner)return;
    const goldReward=75,cardReward=30,species=randomWildSpecies()||"dog";
    owner.kills=Math.max(0,(owner.kills||0)+1);owner.gold=Math.max(0,Math.floor((Number(owner.gold)||0)+goldReward));
    this.sendReward(ownerId,{kind:"resource",resource:"gold",amount:goldReward},{x,y,kill:true});this.sendReward(ownerId,{kind:"cards",species,amount:cardReward},{x,y});
    for(const[petId,p]of this.state.pets)if(p&&p.ownerId===ownerId)this.promotePetOneStage(petId,p);
    this.advanceSkillLevels(ownerId,3);
    const accountId=this.playerAccountIds.get(ownerId),c=this.clientById(ownerId),cache={ironPlate:2,toolKit:1,animalNotes:3,predatorStudy:1};
    if(accountId)for(const[id,qty]of Object.entries(cache)){Promise.resolve(HOSTL_ACCOUNT_HOOKS.rewardGameplayMaterial(String(accountId),id,qty,"moonmark-cache")).then(result=>{if(result?.granted&&c)c.send("accountMaterialReward",result);}).catch(()=>{});}
    if(c)c.send("moonmarkRewardSummary",{gold:goldReward,petXp:"bonus",cards:cardReward,species,skillLevels:3,cache,x,y});
    this.recordAccountAchievement(ownerId,"moonmark_hunter",{species});
  }
  rewardKill(ownerId,kind,x,y,species=""){const owner=this.state.players.get(ownerId);if(owner)owner.kills=Math.max(0,(owner.kills||0)+1);this.addSkillXp(ownerId,10);const drop=weighted([{v:"wood",w:3},{v:"stone",w:2},{v:"gold",w:1}]),amount=drop==="gold"?1:2;if(owner&&drop==="gold")owner.gold=Math.max(0,Math.floor((Number(owner.gold)||0)+amount));this.sendReward(ownerId,{kind:"resource",resource:drop,amount},{x,y,kill:true});if(kind==="enemy"&&Math.random()<Math.min(.45,.1*this.runPerks(ownerId).cardMul)){const sp=weighted([{v:"dog",w:2},{v:"cat",w:2},{v:"rabbit",w:2},{v:"fox",w:2},{v:"dragon",w:1},{v:"wolf",w:1},{v:"bear",w:1}]);this.sendReward(ownerId,{kind:"cards",species:sp,amount:1},{x,y});}if(kind==="animal"&&species&&Math.random()<Math.min(.35,.08*this.runPerks(ownerId).cardMul)){this.sendReward(ownerId,{kind:"cards",species,amount:1},{x,y});}}

  handleAttack(client,data={}){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead||(Number(p._abilityStunUntil)||0)>this.state.worldTime)return;
    const now=this.state.worldTime,next=this.playerAttackCd.get(client.sessionId)||0;if(now<next)return;
    const tool=this.allowedTool(client.sessionId,String(data.tool||p.tool||"Fist")),tier=this.weaponTierForOwner(client.sessionId),t=this.specializedToolStats(client.sessionId,tool,tier);
    const choice=String(this.skillState(client.sessionId).weaponChoice||""),poseKey=preciseWeaponPoseKey(tool,tier,choice),attackT=clamp(Number(data.attackT)||.54,0,1);
    const angle=Number.isFinite(+data.angle)?+data.angle:p.angle;p.angle=angle;
    const precise=!!data.preciseWeapon&&!!poseKey,shape=precise?preciseWeaponShape(p,poseKey,angle,attackT):null;
    if(precise&&!shape)return;
    const runDmg=this.runPerks(client.sessionId).damageMul*((Number(p._abilityWeakUntil)||0)>this.state.worldTime?(Number(p._abilityWeakMul)||.68):1);
    const splitDouble=tool==="Axe"&&choice==="doubleAxe";
    // Throwing Axe only leaves the hand when this is an actual throw. A precise
    // contact packet means its held axe head is touching a nearby resource/target.
    if(tool==="Axe"&&t.throwing&&!precise)return this.handleThrowAxe(client,data);
    this.playerAttackCd.set(client.sessionId,now+(t.cadence||.3));this.consumeHydration(client.sessionId,.9);
    this.broadcast("playerAction",{playerId:client.sessionId,action:"attack",tool,angle,heldSpecial:p.heldSpecial||"",weaponChoice:choice});this.mountedPetAttack(client.sessionId,p);
    const touches=(x,y,r,legacyMax=.95)=>precise?preciseShapeTouchesCircle(shape,x,y,r):(dist(p.x,p.y,x,y)<t.range+r&&facing(p.x,p.y,angle,x,y,legacyMax));

    for(const [pid,target] of this.state.players){
      if(pid===client.sessionId||target.dead||!touches(target.x,target.y,PLAYER_R,.95))continue;
      const crit=Math.random()<.12,dmg=t.dmg*runDmg*(t.doubleHit&&!splitDouble?2:1)*(crit?2:1);
      const hit=()=>{const q=this.state.players.get(pid);if(q&&!q.dead){this.damageTarget({kind:"player",id:pid},dmg,"player",client.sessionId);this.broadcastFx({kind:"hit",x:q.x,y:q.y-8,text:(crit?"CRIT ":"")+Math.round(dmg),color:crit?"#ffe08a":"#f2836a"});}};
      if(splitDouble){setTimeout(hit,220);setTimeout(hit,385);}else hit();
    }

    const attackKinds=new Set(["enemy","animal"]),nearby=this.nearbyDynamic(p.x,p.y,t.range+165,attackKinds);
    for(const rec of nearby){
      if(rec.kind!=="enemy")continue;const en=rec.obj;if(!en)continue;
      const ok=precise?preciseShapeTouchesCircle(shape,en.x,en.y,en.r):dist(p.x,p.y,en.x,en.y)<t.range+en.r&&facing(p.x,p.y,angle,en.x,en.y,.9);
      if(!ok)continue;
      const crit=Math.random()<.15,dmg=t.dmg*runDmg*(t.doubleHit&&!splitDouble?2:1)*(crit?2:1),eid=rec.id;
      const hit=()=>{const q=this.state.enemies.get(eid);if(q&&q.hp>0)this.hitEnemy(eid,q,dmg,client.sessionId,crit);};
      if(splitDouble){setTimeout(hit,220);setTimeout(hit,385);}else hit();
    }

    const aimedId=String(data.animalId||"");let aimedHit=false;
    if(aimedId){const a=this.state.animals.get(aimedId),ok=a&&(precise?preciseShapeTouchesAnimal(shape,a):animalMeleeTouch(a,p.x,p.y,t.range+10,angle,1.18));if(ok){const crit=Math.random()<.12,dmg=t.dmg*runDmg*(t.doubleHit&&!splitDouble?2:1)*(crit?2:1);const hit=()=>{const q=this.state.animals.get(aimedId);if(q&&q.hp>0)this.hitWild(aimedId,q,dmg,client.sessionId,crit);};if(splitDouble){setTimeout(hit,220);setTimeout(hit,385);}else hit();aimedHit=true;}}
    for(const rec of nearby){
      if(rec.kind!=="animal"||(aimedHit&&rec.id===aimedId))continue;const a=rec.obj;if(!a)continue;
      const ok=precise?preciseShapeTouchesAnimal(shape,a):animalMeleeTouch(a,p.x,p.y,t.range,angle,1.05);if(!ok)continue;
      const crit=Math.random()<.12,dmg=t.dmg*runDmg*(t.doubleHit&&!splitDouble?2:1)*(crit?2:1),rid=rec.id;
      const hit=()=>{const q=this.state.animals.get(rid);if(q&&q.hp>0)this.hitWild(rid,q,dmg,client.sessionId,crit);};if(splitDouble){setTimeout(hit,220);setTimeout(hit,385);}else hit();
    }

    let wallBest=null,wallBestD=Infinity;
    for(const [wid,w] of this.state.walls){if(w.hp<=0||isPlacedVehicleWall(w))continue;const d=dist(p.x,p.y,w.x,w.y),ok=precise?preciseShapeTouchesCircle(shape,w.x,w.y,w.r):(d<t.range+w.r+4&&facing(p.x,p.y,angle,w.x,w.y,1.12));if(ok&&d<wallBestD){wallBest={wid,w};wallBestD=d;}}
    if(wallBest){const wd=wallDamageForTool(tool,wallBest.w);wallBest.w.hp=Math.max(0,wallBest.w.hp-wd);this.broadcastEntityHealth("wall",wallBest.wid,wallBest.w);this.broadcastFx({kind:"hit",x:wallBest.w.x,y:wallBest.w.y,text:Math.round(wd),color:wallBest.w.kind==="stoneSpike"?"#d9e0e6":"#c99a5b"});if(wallBest.w.kind==="stoneSpike")client.send("worldReward",{kind:"resource",resource:"stone",amount:1,x:wallBest.w.x,y:wallBest.w.y});if(wallBest.w.hp<=0){this.state.walls.delete(wallBest.wid);this.hostileWildWalls.delete(wallBest.wid);}}

    let best=null,bestD=Infinity;
    for(const [id,c] of this.state.chests){if(c.opened)continue;const tx=c.x,ty=c.y+8,d=dist(p.x,p.y,tx,ty),ok=precise?preciseShapeTouchesCircle(shape,tx,ty,c.r):(d<t.range+c.r+8&&facing(p.x,p.y,angle,tx,ty,1.15));if(ok&&d<bestD){best={id,c};bestD=d;}}
    if(best)this.hitChest(client,best.id,best.c);
  }

  hitChest(client,id,c){if(!c||c.opened)return;this.addSkillXp(client.sessionId,1);c.hp=Math.max(0,c.hp-1);c.pulse=1;this.broadcastEntityHealth("chest",id,c);if(c.hp<=0){c.opened=true;this.addSkillXp(client.sessionId,12);const reward=this.chestRewards.get(id)||this.makeChestReward();this.chestRewards.delete(id);const accountId=this.playerAccountIds.get(client.sessionId);if(accountId&&(reward?.kind==="cards"||reward?.kind==="goldCubits")){Promise.resolve(HOSTL_ACCOUNT_HOOKS.grantWorldReward(String(accountId),reward,{chest:true,id})).then(result=>{if(result?.granted)client.send("chestReward",{id,reward,account:result.account||null,serverVerified:true});}).catch(()=>{});}else client.send("chestReward",{id,reward});this.broadcastFx({kind:"chest",x:c.x,y:c.y});}else{const first=c.chipSide||"wood",second=first==="wood"?"stone":"wood",bonus=Math.random()<.45;c.chipSide=second;client.send("worldReward",{kind:"resource",resource:first,amount:1,x:c.x,y:c.y});if(bonus)client.send("worldReward",{kind:"resource",resource:second,amount:1,x:c.x,y:c.y});}}
  makeChestReward(){const roll=Math.random();if(roll<.34)return{kind:"goldCubits",amount:Math.random()<.1?randi(12,18):randi(5,10)};if(roll<.52)return{kind:"cards",species:weighted(WILD_SPECIES.map(v=>({v,w:RARITY_CARD_WEIGHT[animalRarity(v)]||1}))),amount:Math.random()<.14?25:10};const res=weighted([{v:"wood",w:2.8},{v:"stone",w:2.3},{v:"berries",w:1.8},{v:"gold",w:1.1}]);const amount=res==="wood"?randi(16,28):res==="stone"?randi(12,22):res==="berries"?randi(6,12):randi(3,6);return{kind:"resource",resource:res,amount};}

  handleThrowAxe(client,data={}){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const s=this.skillState(client.sessionId);if(s.weaponChoice!=="throwingAxe")return;for(const[,q]of this.state.projectiles){if(q&&q.kind==="throwAxe"&&q.ownerId===client.sessionId)return;}const now=this.state.worldTime,next=this.playerAttackCd.get(client.sessionId)||0;if(now<next)return;const tier=clamp(Math.floor(Number(data.tier)||0),0,2),st=this.specializedToolStats(client.sessionId,"Axe",tier);this.playerAttackCd.set(client.sessionId,now+(st.cadence||.72));this.consumeHydration(client.sessionId,.9);const a=Number.isFinite(+data.angle)?+data.angle:p.angle;p.angle=a;this.broadcast("playerAction",{playerId:client.sessionId,action:"attack",tool:"Axe",angle:a,heldSpecial:"",throwing:true,weaponChoice:"throwingAxe",toolTier:tier});this.mountedPetAttack(client.sessionId,p);this.addProjectile({x:p.x+Math.cos(a)*28,y:p.y+Math.sin(a)*28,vx:Math.cos(a)*THROW_AXE_SPEED,vy:Math.sin(a)*THROW_AXE_SPEED,life:THROW_AXE_LIFE,r:9,hostile:false,kind:"throwAxe",color:"#c7b77b",dmg:st.dmg*this.runPerks(client.sessionId).damageMul,ownerId:client.sessionId,petBlast:false,knock:0,returning:false,toolTier:tier});}
  handleBiomeFood(client,data={}){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;
    const food=String(data.food||""),inv=this.playerBiomeMaterials?.get(client.sessionId)||{};
    const mount=p.ridingPetId?this.state.pets.get(p.ridingPetId):null;
    const validMount=!!(mount&&!mount.dead&&mount.ownerId===client.sessionId);
    const mountedHealingFood=validMount&&["jungleBerry","frostBerry","goodCactus","seaFruit","greenSeaweed","honey"].includes(food);
    const send=(message,extra={})=>client.send("biomeFoodResult",{food,count:Math.max(0,inv[food]||0),health:p.health,hydration:p.hydration,mounted:validMount,mountId:validMount?p.ridingPetId:"",mountHp:validMount?mount.hp:undefined,mountMaxHp:validMount?mount.maxHp:undefined,message,...extra});

    // Healing foods cannot be consumed while riding a full-health pet, even if
    // the rider could use hydration. The mounted pet is the health target.
    if(mountedHealingFood&&mount.hp>=mount.maxHp-.01){send("Your mounted pet is already at full health",{blocked:true});return;}

    const full=p.health>=p.maxHealth-.01&&(Number(p.hydration)||0)>=99.99;
    if(!validMount&&food==="greenSeaweed"&&p.health>=p.maxHealth-.01){send("You are already at full health",{blocked:true});return;}
    if(!validMount&&(food==="frostBerry"||food==="goodCactus"||food==="badCactus"||food==="seaFruit")&&full){send("You are already full health and hydration",{blocked:true});return;}

    if(food==="jungleBerry"){
      if((inv.jungleBerry||0)<1)return;inv.jungleBerry--;
      if(validMount){mount._foodJungleUntil=this.state.worldTime+8;mount._foodJungleRate=4;send("Jungle Fruit — healing your mounted pet over time");}
      else{p._jungleHotUntil=this.state.worldTime+8;p._jungleHotRate=4;send("Jungle Fruit — healing over time");}
    }
    else if(food==="frostBerry"){
      if((inv.frostBerry||0)<1)return;inv.frostBerry--;
      if(validMount){mount.hp=Math.min(mount.maxHp,mount.hp+14);p.hydration=clamp((Number(p.hydration)||0)+18,0,100);this.broadcastEntityHealth("pet",p.ridingPetId,mount);send("Frost Berry — pet +14 HP, rider +18 hydration");}
      else{p.health=Math.min(p.maxHealth,p.health+14);p.hydration=clamp((Number(p.hydration)||0)+18,0,100);send("Frost Berry — +14 HP, +18 hydration");}
    }
    else if(food==="goodCactus"){
      if((inv.goodCactus||0)<1)return;inv.goodCactus--;
      if(validMount){mount._foodGoodCactusUntil=this.state.worldTime+10;mount._foodGoodCactusRate=2.6;p._mountedCactusHydrateUntil=this.state.worldTime+10;p._mountedCactusHydrateRate=3.8;send("Good Cactus — healing your pet and hydrating you over time");}
      else{p._cactusGoodUntil=this.state.worldTime+10;p._cactusHealRate=2.6;p._cactusHydrateRate=3.8;send("This cactus was good — healing and hydrating over time");}
    }
    else if(food==="badCactus"){
      if((inv.badCactus||0)<1)return;inv.badCactus--;
      if(validMount){this.damageTarget({kind:"pet",id:p.ridingPetId},8,"world","");p.hydration=clamp((Number(p.hydration)||0)-14,0,100);if(!mount.dead){mount._foodBadCactusUntil=this.state.worldTime+7;mount._foodBadCactusRate=2.5;}p._mountedBadCactusUntil=this.state.worldTime+7;p._mountedBadCactusHydrateRate=4.5;send("Bad Cactus — hurts your mounted pet and dehydrates you");}
      else{p.health=Math.max(0,p.health-8);p.hydration=clamp((Number(p.hydration)||0)-14,0,100);if(p.health<=0)this.damageTarget({kind:"player",id:client.sessionId},999,"world","");p._badCactusUntil=this.state.worldTime+7;p._badCactusDamageRate=2.5;p._badCactusHydrateRate=4.5;send("This cactus was bad — it hurts and dehydrates you");}
    }
    else if(food==="stoneFruit"){
      if((inv.stoneFruit||0)<1)return;inv.stoneFruit--;p.hydration=clamp((Number(p.hydration)||0)-20,0,100);
      if(validMount){
        if(!Array.isArray(mount._stoneFruitStackExpiries))mount._stoneFruitStackExpiries=[];
        mount._stoneFruitStackExpiries=mount._stoneFruitStackExpiries.filter(t=>Number(t)>this.state.worldTime);mount._stoneFruitStackExpiries.push(this.state.worldTime+20);mount.stoneFruitStacks=mount._stoneFruitStackExpiries.length;
        send(`Stone Fruit ×${mount.stoneFruitStacks} — pet +${mount.stoneFruitStacks*20}% strength, pet -${mount.stoneFruitStacks*10}% speed; rider -20 hydration; this stack lasts 20s`,{petStoneStacks:mount.stoneFruitStacks});
      }else{
        let stacks=(this.playerStoneFruitStacks.get(client.sessionId)||[]).filter(t=>Number(t)>this.state.worldTime);stacks.push(this.state.worldTime+20);this.playerStoneFruitStacks.set(client.sessionId,stacks);send(`Stone Fruit ×${stacks.length} — -20 hydration, +${stacks.length*20}% strength, -${stacks.length*10}% speed; this stack lasts 20s`,{stoneStacks:stacks.length});
      }
    }
    else if(food==="seaFruit"){
      if((inv.seaFruit||0)<1)return;inv.seaFruit--;
      if(validMount){mount.hp=Math.min(mount.maxHp,mount.hp+12);p.hydration=clamp((Number(p.hydration)||0)+10,0,100);this.broadcastEntityHealth("pet",p.ridingPetId,mount);send("Sea Fruit — pet +12 HP, rider +10 hydration");}
      else{p.health=Math.min(p.maxHealth,p.health+12);p.hydration=clamp((Number(p.hydration)||0)+10,0,100);send("Sea Fruit — +12 HP, +10 hydration");}
    }
    else if(food==="greenSeaweed"){
      if((inv.greenSeaweed||0)<1)return;inv.greenSeaweed--;
      if(validMount){mount.hp=Math.min(mount.maxHp,mount.hp+30);this.broadcastEntityHealth("pet",p.ridingPetId,mount);send("Green Seaweed — powerful healing for your mounted pet");}
      else{p.health=Math.min(p.maxHealth,p.health+30);send("Green Seaweed — +30 HP");}
    }
    else if(food==="blueSeaweed"){
      if((inv.blueSeaweed||0)<1)return;inv.blueSeaweed--;p._blueSeaweedUntil=Math.max(Number(p._blueSeaweedUntil)||0,this.state.worldTime+BLUE_SEAWEED_DURATION);send(`Blue Seaweed — deep-ocean protection and full movement for ${BLUE_SEAWEED_DURATION}s`,{duration:BLUE_SEAWEED_DURATION});
    }
    else if(food==="celestFruit"){
      if((inv.celestFruit||0)<1)return;inv.celestFruit--;
      if(Math.random()<.5){p.ridingPetId="";this.damageTarget({kind:"player",id:client.sessionId},999999,"world","");send("Celest Fruit backfired — it killed you!",{killed:true,duration:0});}
      else{p._blueSeaweedUntil=Math.max(Number(p._blueSeaweedUntil)||0,this.state.worldTime+CELEST_FRUIT_DURATION);send("Celest Fruit succeeded — underwater protection for 5 minutes!",{duration:CELEST_FRUIT_DURATION});}
    }
    else if(food==="honey"){
      if((inv.honey||0)<1)return;inv.honey--;
      p._honeyRushUntil=this.state.worldTime+12;p._honeyHasteMul=1.2;
      if(validMount){mount.hp=Math.min(mount.maxHp,mount.hp+20);mount._foodHoneyUntil=this.state.worldTime+12;mount._foodHoneyRate=4.6;this.broadcastEntityHealth("pet",p.ridingPetId,mount);send("Honey — healing your mounted pet and giving a speed rush");}
      else{p.health=Math.min(p.maxHealth,p.health+20);p._honeyHealUntil=this.state.worldTime+12;p._honeyHealRate=4.6;send("Honey — +20 HP, sweet healing and a speed boost");}
    }
    this.playerBiomeMaterials.set(client.sessionId,inv);
  }
  handleThrowChakram(client,data={}){
    const p=this.state.players.get(client.sessionId),s=this.skillState(client.sessionId);if(!p||p.dead||p.heldSpecial!=="Chakrams"||!buildKnownFromSkill(s,"Chakrams"))return;
    const now=this.state.worldTime,next=this.playerShootCd.get(client.sessionId)||0;if(now<next)return;this.playerShootCd.set(client.sessionId,now+.34);
    const tier=Math.min(clamp(Math.floor(Number(data.tier)||0),0,3),this.buildTierForOwner(client.sessionId,"Chakrams")),variant=tier>=3?this.buildVariantForOwner(client.sessionId,"Chakrams"):"",side=Number(data.side)<0?-1:1,a=Number.isFinite(+data.angle)?+data.angle:p.angle,px=-Math.sin(a)*side*8,py=Math.cos(a)*side*8,dmg=(tier>=3&&variant==="ruby"?25:[7,10,14,19][tier])*this.runPerks(client.sessionId).damageMul;
    p.angle=a;this.broadcast("playerAction",{playerId:client.sessionId,action:"shoot",tool:"Chakrams",angle:a,heldSpecial:"Chakrams"});
    this.addProjectile({x:p.x+Math.cos(a)*25+px,y:p.y+Math.sin(a)*25+py,vx:Math.cos(a)*610,vy:Math.sin(a)*610,life:tier>=3&&variant==="diamond"?1.48:1.15,r:7,hostile:false,kind:"chakram",color:variant==="ruby"?"#ef5961":variant==="emerald"?"#55d681":variant==="diamond"?"#bcecff":"#d9dde0",dmg,ownerId:client.sessionId,petBlast:false,knock:tier>=3&&variant==="diamond"?72:0});
  }
  handlePlayFlute(client,data={}){
    const p=this.state.players.get(client.sessionId),s=this.skillState(client.sessionId);if(!p||p.dead||p.heldSpecial!=="Flute"||!buildKnownFromSkill(s,"Flute"))return;
    const now=this.state.worldTime,next=this.playerAttackCd.get(client.sessionId)||0;if(now<next)return;this.playerAttackCd.set(client.sessionId,now+1.05);
    const tier=Math.min(clamp(Math.floor(Number(data.tier)||0),0,3),this.buildTierForOwner(client.sessionId,"Flute")),variant=tier>=3?this.buildVariantForOwner(client.sessionId,"Flute"):"",range=tier>=3&&variant==="ruby"?900:[360,500,650,730][tier],duration=tier>=3&&variant==="emerald"?18:[7,9,11,13][tier];let affected=0;
    for(const[id,a]of this.state.animals){if(!a||a.hp<=0||a.owned||dist(p.x,p.y,a.x,a.y)>range)continue;affected++;
      if(a.type==="snake"){a._fluteTier=tier;a._fluteVariant=variant;a._fluteCalmUntil=now+duration;a.sleeping=false;a.enraged=false;a.tameFailedAggro=false;a.desperateAggro=false;a.combat=0;a.fleeUntil=0;this.animalAggro.delete(id);this.animalFleeFrom.delete(id);this.broadcastFx({kind:"hit",x:a.x,y:a.y-(a.r||18),text:"calm",color:"#a0e0ff"});}
      else{a.sleeping=true;a.enraged=false;a.tameFailedAggro=false;a.desperateAggro=false;a.combat=0;a.recentHit=0;a.fleeUntil=0;a._stayAwakeUntil=0;this.animalAggro.delete(id);this.animalFleeFrom.delete(id);this.broadcastFx({kind:"hit",x:a.x,y:a.y-(a.r||18),text:"zzz",color:"#a0e0ff"});}
    }
    client.send("fluteResult",{affected});this.broadcast("playerAction",{playerId:client.sessionId,action:"flute",tool:"Flute",angle:p.angle,heldSpecial:"Flute"});
  }
  handleShoot(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead||(Number(p._abilityStunUntil)||0)>this.state.worldTime||this.chosenWeapon(client.sessionId)!=="Bow")return;const now=this.state.worldTime,next=this.playerShootCd.get(client.sessionId)||0;if(now<next)return;const bowStats=this.toolStats("Bow",this.weaponTierForOwner(client.sessionId));this.playerShootCd.set(client.sessionId,now+(bowStats.cadence||.45));const a=Number.isFinite(+data.angle)?+data.angle:p.angle;p.angle=a;this.broadcast("playerAction",{playerId:client.sessionId,action:"shoot",tool:"Bow",angle:a,heldSpecial:""});this.mountedPetAttack(client.sessionId,p);this.addProjectile({x:p.x+Math.cos(a)*26,y:p.y+Math.sin(a)*26,vx:Math.cos(a)*640,vy:Math.sin(a)*640,life:1.15,r:5,hostile:false,kind:"arrow",color:"#7ec0ee",dmg:bowStats.dmg*this.runPerks(client.sessionId).damageMul*((Number(p._abilityWeakUntil)||0)>this.state.worldTime?(Number(p._abilityWeakMul)||.68):1),ownerId:client.sessionId,petBlast:false,knock:0,toolTier:this.weaponTierForOwner(client.sessionId)});}

  skillState(ownerId){
    let s=this.playerSkillProgress.get(ownerId);
    if(!s){s={level:0,xp:0,speed:0,strength:0,defense:0,stoneChoice:"",weaponChoice:"",milestones:{}};this.playerSkillProgress.set(ownerId,s);}
    if(typeof s.weaponChoice!=="string")s.weaponChoice="";
    return s;
  }
  pendingSkillMilestone(s){
    const level=Math.max(0,Math.floor(Number(s?.level)||0));
    if(!s.milestones||typeof s.milestones!=="object")s.milestones={};
    const cap=Math.min(level,skillRewardCapForState(s));
    for(let m=1;m<=cap;m++){
      if(m===1){if(!starterWeaponFromSkillChoice(s.stoneChoice))return 1;continue;}
      if(!s.milestones[m])return m;
    }
    return 0;
  }
  skillSnapshot(ownerId){
    const s=this.skillState(ownerId),pending=this.pendingSkillMilestone(s),p=this.state.players.get(ownerId);
    if(p){p.skillLevel=s.level;p.skillXp=s.xp;p.skillSpeed=s.speed;p.skillStrength=s.strength;p.skillDefense=s.defense;p.skillPendingMilestone=pending;}
    return {level:s.level,xp:s.xp,next:skillXpNeededForLevel(s.level),speed:s.speed,strength:s.strength,defense:s.defense,stoneChoice:String(s.stoneChoice||""),weaponChoice:String(s.weaponChoice||""),pendingStoneChoice:s.level>=1&&!starterWeaponFromSkillChoice(s.stoneChoice),pendingWeaponChoice:false,pendingMilestone:pending,milestones:{...s.milestones}};
  }
  sendSkillState(ownerId){
    const c=this.clientById(ownerId);if(c)c.send("skillState",this.skillSnapshot(ownerId));else this.skillSnapshot(ownerId);
  }
  addSkillXp(ownerId,amount){
    if(!ownerId||!this.state.players.has(ownerId))return;
    amount=Math.max(0,Number(amount)||0);if(!amount)return;
    const s=this.skillState(ownerId);s.xp+=amount;
    while(s.xp>=skillXpNeededForLevel(s.level)){s.xp-=skillXpNeededForLevel(s.level);s.level++;}
    this.sendSkillState(ownerId);
  }
  advanceSkillLevels(ownerId,count=3){
    if(!ownerId||!this.state.players.has(ownerId))return;const s=this.skillState(ownerId);s.level=Math.max(0,Math.floor(Number(s.level)||0))+Math.max(0,Math.floor(Number(count)||0));this.sendSkillState(ownerId);
  }
  promotePetOneStage(id,p){
    if(!p)return;const next={baby:"adult",adult:"boss",boss:"superboss"}[p.stage]||"";
    if(next){p.stage=next;p.r=animalRadius(p.type,next);p.maxHp=Math.max(12,Math.round(typeHp(p.type,next)*petUpgradeMultiplier(p,"health")));p.hp=p.maxHp;p.speed=animalSpeed(p.type,next,true,petUpgradeMultiplier(p,"weight"))*petUpgradeMultiplier(p,"speed");p.level=1;p.exp=0;const c=this.clientById(p.ownerId);if(c)c.send("petGrew",{id,stage:next,type:p.type,moonmark:true});}
    const bonus=Math.max(20,Math.round(expNeed(p.stage,p.level||1)*.28));if(p.dead)p.exp=Math.max(0,Number(p.exp)||0)+bonus;else this.givePetExp(id,p,bonus);
  }
  handleSkillChoice(client,data={}){
    const s=this.skillState(client.sessionId),pending=this.pendingSkillMilestone(s);
    const milestone=Math.max(0,Math.floor(Number(data.milestone)||0)),choice=String(data.choice||"");
    // Choices are consumed in skill-number order. If XP jumps multiple levels,
    // the player receives each missed choice one after another instead of losing it.
    if(!pending||milestone!==pending){this.sendSkillState(client.sessionId);return;}
    if(milestone===1){
      if(starterWeaponFromSkillChoice(s.stoneChoice)||!starterWeaponFromSkillChoice(choice)){this.sendSkillState(client.sessionId);return;}
      s.stoneChoice=choice;s.weaponChoice="";const p=this.state.players.get(client.sessionId);if(p)p.tool=starterWeaponFromSkillChoice(choice);this.sendSkillState(client.sessionId);return;
    }
    const kind=skillMilestoneKind(milestone),allowed=toolSkillAllowedChoices(s,milestone);if(!allowed.has(choice)){this.sendSkillState(client.sessionId);return;}
    s.milestones[milestone]=choice;
    const effectiveKind=["speed","strength","defense"].includes(choice)?"stat":kind;
    if(effectiveKind==="stat")s[choice]=Math.max(0,Math.floor(Number(s[choice])||0))+1;
    if(kind==="weaponUpgrade"&&["doubleAxe","throwingAxe","battleAxe","daggers","longSword","spear"].includes(choice))s.weaponChoice=choice;
    this.sendSkillState(client.sessionId);
  }

  runShopState(ownerId){
    let s=this.playerRunShop.get(ownerId);
    if(!s){s={purchased:new Set(),hat:"",cape:"",armor:""};this.playerRunShop.set(ownerId,s);}
    return s;
  }
  runPerks(ownerId){
    const s=this.runShopState(ownerId),skill=this.skillState(ownerId),p=this.state.players.get(ownerId);
    let stoneStacks=(this.playerStoneFruitStacks.get(ownerId)||[]).filter(t=>Number(t)>this.state.worldTime);this.playerStoneFruitStacks.set(ownerId,stoneStacks);const stoneFruitMul=1+stoneStacks.length*.20,stoneMoveMul=Math.max(.50,1-stoneStacks.length*.10);const honeyMoveMul=p&&(Number(p._honeyRushUntil)||0)>this.state.worldTime?(Number(p._honeyHasteMul)||1.2):1;
    return {
      gatherMul:s.hat==="minerHat"?1.25:1,
      regen:s.hat==="healerHood"?.7:0,
      moveMul:(1+Math.max(0,skill.speed||0)*.08)*honeyMoveMul*stoneMoveMul,
      damageMul:(s.hat==="warriorHelm"?1.18:1)*(1+Math.max(0,skill.strength||0)*.08)*stoneFruitMul,
      tameBonus:s.cape==="tamerCape"?.10:0,
      cardMul:s.cape==="cardCape"?1.75:1,
      petXpMul:s.cape==="mentorCape"?1.50:1,
      defenseMul:(s.armor==="guardianArmor"?.66:s.armor==="ironArmor"?.78:s.armor==="leatherArmor"?.88:1)*Math.pow(.92,Math.max(0,skill.defense||0))
    };
  }
  handleRunShopBuy(client,data={}){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;
    const id=String(data.id||""),item=RUN_SHOP_ITEMS[id];if(!item){client.send("runShopResult",{success:false,reason:"item"});return;}
    const s=this.runShopState(client.sessionId);
    if(!s.purchased.has(id)){
      if((p.gold||0)<item.cost){client.send("runShopResult",{success:false,reason:"gold",id,gold:p.gold||0});return;}
      p.gold=Math.max(0,(p.gold||0)-item.cost);s.purchased.add(id);
    }
    s[item.cat]=id;client.send("runShopResult",{success:true,id,gold:p.gold||0});
  }
  tameChanceFor(ownerId,type){const held=String(this.state.players.get(ownerId)?.heldSpecial||"");const inv=this.playerBiomeMaterials?.get(ownerId)||{};const combReady=this.isWildBeeType(type)&&held==="HoneyComb"&&(inv.honeycomb||0)>0;const combBonus=combReady ? (type==="queenbee"?.10:.22) : 0;return clamp((TAME_BASE_CHANCE[type]??.38)+this.runPerks(ownerId).tameBonus+combBonus,.08,.95);}
  tameInteractionRange(a){if(!a)return 82;const footprint=animalSpawnFootprint(a.type,a.stage),speciesBonus=a.type==="fennec"?24:0;return clamp(Math.max(88,PLAYER_R+footprint+28+speciesBonus),88,128);}
  handleHiveEnter(client,data={}){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const id=String(data.id||""),h=this.state.resources.get(id);
    if(!h||!h.alive||h.type!=="rainforestHive"){client.send("hiveEnterResult",{success:false});return;}
    const c=this.hiveResourceCenter(h);if(dist(p.x,p.y,c.x,c.y)>Math.max(125,(h.solidR||70)+58)){client.send("hiveEnterResult",{success:false});return;}
    this.playerHiveSessions.set(client.sessionId,{hiveId:id,tamed:false,enteredAt:this.state.worldTime,lastDamageAt:-999});p.ridingPetId="";p.vehicleType="";p.vehicleTier=0;p.vehicleVariant="";client.send("hiveEnterResult",{success:true,hiveId:id});
  }
  handleHiveTameLarva(client,data={}){
    const p=this.state.players.get(client.sessionId),sess=this.playerHiveSessions.get(client.sessionId);if(!p||p.dead||!sess||sess.tamed)return;
    if(String(data.hiveId||"")&&String(data.hiveId)!==String(sess.hiveId)){client.send("hiveTameResult",{success:false,reason:"hive"});return;}
    let count=0;for(const[,pet]of this.state.pets)if(pet.ownerId===client.sessionId&&!pet.dead&&!pet.bredChild)count++;if(count>=4){client.send("hiveTameResult",{success:false,reason:"max"});return;}
    if(Math.random()>=.5){client.send("hiveTameResult",{success:false,chance:.5});return;}
    const roll=Math.random(),type=roll<.12?"queenbee":roll<.72?"workerbee":"dronebee";sess.tamed=true;sess.aggro=true;
    const petId=this.addPet(client.sessionId,type,"baby",p.x,p.y,{petName:`${PET_TYPES[type]?.name||"Bee"} Larva`,gender:Math.random()<.5?"Female":"Male"});
    this.addSkillXp(client.sessionId,25);this.sendReward(client.sessionId,{kind:"cards",species:type,amount:TAME_SPECIES_CARD_REWARD},{x:p.x,y:p.y,tame:true,hiveLarva:true,guaranteed:true});this.recordAccountAchievement(client.sessionId,"first_tame",{species:type});this.recordAccountAchievement(client.sessionId,`tame_${type}`,{species:type});
    client.send("hiveTameResult",{success:true,type,petId,chance:.5});
  }
  handleHiveDamage(client,data={}){
    const sess=this.playerHiveSessions.get(client.sessionId),p=this.state.players.get(client.sessionId);if(!sess||!sess.aggro||!p||p.dead)return;const now=Number(this.state.worldTime)||0;if(now-(Number(sess.lastDamageAt)||-999)<.30)return;sess.lastDamageAt=now;const amount=clamp(Number(data.amount)||6,1,14);this.damageTarget({kind:"player",id:client.sessionId},amount,"hiveBee",`hive:${sess.hiveId}`);
  }
  handleHiveExit(client,data={}){
    const sess=this.playerHiveSessions.get(client.sessionId);if(!sess)return;if(String(data.hiveId||"")&&String(data.hiveId)!==String(sess.hiveId))return;this.playerHiveSessions.delete(client.sessionId);
  }
  handleTame(client,data){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;
    if(this.tamePendingPlayers.has(client.sessionId)){client.send("tameResult",{pending:true,reason:"busy"});return;}
    const id=String(data.id||""),a=this.state.animals.get(id);
    if(!a||a.stage!=="baby"||!a.sleeping||dist(p.x,p.y,a.x,a.y)>this.tameInteractionRange(a))return;
    let count=0;for(const[,pet]of this.state.pets)if(pet.ownerId===client.sessionId&&!pet.dead&&!pet.bredChild)count++;
    if(count>=4){client.send("tameResult",{success:false,reason:"max"});return;}
    const chance=this.tameChanceFor(client.sessionId,a.type),inv=this.playerBiomeMaterials?.get(client.sessionId)||{};
    const usedComb=this.isWildBeeType(a.type)&&String(p.heldSpecial||"")==="HoneyComb"&&(inv.honeycomb||0)>0;
    if(usedComb){inv.honeycomb=Math.max(0,(inv.honeycomb||0)-1);this.playerBiomeMaterials.set(client.sessionId,inv);if(inv.honeycomb<=0)p.heldSpecial="";}
    this.tamePendingPlayers.add(client.sessionId);
    client.send("tameResult",{pending:true,type:a.type,animalId:id,x:a.x,y:a.y,r:a.r,chance,usedComb,honeycomb:Math.max(0,inv.honeycomb||0)});
    this.clock.setTimeout(()=>{
      this.tamePendingPlayers.delete(client.sessionId);
      const current=this.state.animals.get(id),owner=this.state.players.get(client.sessionId);
      if(!current||!owner||current.stage!=="baby"||dist(owner.x,owner.y,current.x,current.y)>this.tameInteractionRange(current)+28){client.send("tameResult",{success:false,reason:"moved",type:a.type,animalId:id,x:current?.x??a.x,y:current?.y??a.y,r:current?.r??a.r,honeycomb:Math.max(0,inv.honeycomb||0)});return;}
      if(Math.random()<chance){
        this.state.animals.delete(id);this.animalAggro.delete(id);this.animalFleeFrom.delete(id);
        const bonusXp=usedComb&&this.isWildBeeType(current.type)?30:0;
        const petId=this.addPet(client.sessionId,current.type,current.stage,current.x,current.y,{hp:current.maxHp,coat:current.coat,spotCol:current.spotCol,spotsJson:current.spotsJson,petName:current.type,gender:current.gender,exp:bonusXp,level:1});
        client.send("tameResult",{success:true,type:current.type,animalId:id,x:current.x,y:current.y,r:current.r,petId,chance,usedComb,bonusXp,honeycomb:Math.max(0,inv.honeycomb||0)});
        this.addSkillXp(client.sessionId,25);
        this.sendReward(client.sessionId,{kind:"cards",species:current.type,amount:TAME_SPECIES_CARD_REWARD},{x:current.x,y:current.y,tame:true,guaranteed:true});
        this.recordAccountAchievement(client.sessionId,"first_tame",{species:current.type});this.recordAccountAchievement(client.sessionId,`tame_${current.type}`,{species:current.type});
      }else{
        current.sleeping=false;current.enraged=true;current.tameFailedAggro=true;current.desperateAggro=false;current.fleeUntil=0;current.combat=9999;
        this.animalAggro.set(id,{kind:"player",id:client.sessionId});
        client.send("tameResult",{success:false,type:current.type,animalId:id,x:current.x,y:current.y,r:current.r,chance,usedComb,honeycomb:Math.max(0,inv.honeycomb||0)});
      }
    },600);
  }

  handleBuild(client,data){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const kind=String(data.kind||""),angle=Number.isFinite(+data.angle)?+data.angle:p.angle,s=this.skillState(client.sessionId);
    const validVariant=(build,requested)=>{const actual=buildVariantFromSkill(s,build);return requested&&requested===actual?actual:"";};
    if(kind==="wall"){
      const tier=Math.min(clamp(Math.floor(Number(data.wallTier)||0),0,3),this.buildTierForOwner(client.sessionId,"Wall")),variant=tier>=3?validVariant("Wall",String(data.variant||"")):"";
      let hp=[72,125,190,285][tier],wkind=tier>=3?`wall3@${variant||"diamond"}`:tier>=2?"iron":tier>=1?"stone":"wood";if(tier>=3&&variant==="diamond")hp=430;
      this.addWall(p.x+Math.cos(angle)*48,p.y+Math.sin(angle)*48,20,-1,client.sessionId,{hp,kind:wkind});
    }else if(kind==="tower"){
      const tier=Math.min(clamp(Math.floor(Number(data.towerTier)||0),0,3),this.buildTierForOwner(client.sessionId,"Tower")),variant=tier>=3?validVariant("Tower",String(data.variant||"")):"";
      this.addTower(p.x+Math.cos(angle)*55,p.y+Math.sin(angle)*55,client.sessionId,tier,{kind:"tower",variant,angle});
    }else if(kind==="windmill"){
      const tier=Math.min(clamp(Math.floor(Number(data.windmillTier)||0),0,3),this.buildTierForOwner(client.sessionId,"Windmill")),variant=tier>=3?validVariant("Windmill",String(data.variant||"")):"";
      let hp=[95,160,240,330][tier];if(tier>=3&&variant==="diamond")hp*=1.35;
      const wkind=`windmill${tier}${variant?`@${variant}`:""}`;this.addWall(p.x+Math.cos(angle)*58,p.y+Math.sin(angle)*58,25,-1,client.sessionId,{hp,kind:wkind});
      const amount=tier>=3&&variant==="ruby"?7:tier>=3&&variant==="diamond"?5:[1,2,3,4][tier];p.gold=Math.max(0,(p.gold||0)+amount);client.send("resourceReward",{kind:"gold",amount,x:p.x,y:p.y,source:"windmill"});
    }else if(kind==="battlebot"){
      if(!buildKnownFromSkill(s,"BattleBot"))return;const tier=Math.min(clamp(Math.floor(Number(data.botTier)||0),0,3),this.buildTierForOwner(client.sessionId,"BattleBot")),variant=tier>=3?validVariant("BattleBot",String(data.variant||"")):"";
      this.addTower(p.x+Math.cos(angle)*62,p.y+Math.sin(angle)*62,client.sessionId,tier,{kind:"battlebot",variant,angle});
    }else if(kind==="repair"){
      if(!buildKnownFromSkill(s,"RepairBuilding"))return;const tier=Math.min(clamp(Math.floor(Number(data.repairTier)||0),0,3),this.buildTierForOwner(client.sessionId,"RepairBuilding")),hp=[150,220,310,430][tier];
      this.addWall(p.x+Math.cos(angle)*55,p.y+Math.sin(angle)*55,26,-1,client.sessionId,{hp,kind:`repair${tier}`});
    }else if(kind==="boat"||kind==="sub"){
      const type=kind==="sub"?"Sub":"Boat";if(!buildKnownFromSkill(s,type))return;
      const tier=Math.min(clamp(Math.floor(Number(data.vehicleTier)||0),0,3),this.buildTierForOwner(client.sessionId,type)),variant=validVariant(type,String(data.variant||""));
      const d=type==="Sub"?58:55,defaultX=p.x+Math.cos(angle)*d,defaultY=p.y+Math.sin(angle)*d;
      const reqX=Number(data.x),reqY=Number(data.y),useRequested=Number.isFinite(reqX)&&Number.isFinite(reqY)&&dist(p.x,p.y,reqX,reqY)<=96;
      const x=useRequested?reqX:defaultX,y=useRequested?reqY:defaultY;if(!vehiclePlacementAllowed(x,y))return;
      const hp=(type==="Sub"?220:170)*(1+tier*.22)*(tier>=3&&variant==="diamond"?1.55:1);this.addWall(x,y,type==="Sub"?31:29,-1,client.sessionId,{hp,kind:`vehicle${type}${tier}${variant?`@${variant}`:""}`,spikeDmg:vehicleAngleValue(angle)});
    }
  }
  handleVehicleBoard(client,data={}){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead||p.vehicleType)return;
    const id=String(data.id||""),w=this.state.walls.get(id),type=placedVehicleType(w);if(!w||!type||w.ownerId!==client.sessionId)return;
    if(dist(p.x,p.y,w.x,w.y)>104||!vehicleTravelAllowed(w.x,w.y))return;
    p.x=w.x;p.y=w.y;p.angle=Number(w.spikeDmg)||p.angle;p.vehicleType=type;p.vehicleTier=placedVehicleTier(w);p.vehicleVariant=placedVehicleVariant(w);p.ridingPetId="";this.state.walls.delete(id);this.hostileWildWalls.delete(id);
  }
  handleEquipPetArmor(client,data={}){
    const pet=this.ownedPet(client,String(data.id||""));if(!pet||pet.dead)return;const s=this.skillState(client.sessionId);if(!buildKnownFromSkill(s,"PetArmor"))return;
    const tier=Math.min(clamp(Math.floor(Number(data.tier)||0),0,3),this.buildTierForOwner(client.sessionId,"PetArmor")),actual=buildVariantFromSkill(s,"PetArmor"),variant=tier>=3&&String(data.variant||"")===actual?actual:"";
    pet.armorTier=tier;pet.armorGem=variant;client.send("petArmorEquipped",{id:String(data.id||""),tier,variant});
  }
  ownedPet(client,id){const p=this.state.pets.get(String(id||""));return p&&p.ownerId===client.sessionId?p:null;}
  handlePetOrder(client,data){
    const id=String(data.id||""),p=this.ownedPet(client,id);if(!p||p.dead)return;
    const mode=String(data.mode||"follow");
    this.petFollowState.delete(id);
    this.petChaseState.delete(id);

    if(mode==="focus"){
      const kind=String(data.targetKind||"");
      const targetId=String(data.targetId||"");
      const obj=kind==="animal"?this.state.animals.get(targetId):kind==="enemy"?this.state.enemies.get(targetId):kind==="player"?this.state.players.get(targetId):null;
      const valid=!!obj&&(
        (kind==="animal"&&obj.hp>0)||
        (kind==="enemy"&&!obj.dead&&obj.hp>0)||
        (kind==="player"&&targetId!==client.sessionId&&!obj.dead&&obj.health>0)
      );
      if(valid){
        this.petFocusTargets.set(id,{kind,id:targetId});
        p.orderMode="defend";
        p.targetX=-1;p.targetY=-1;
      }
      return;
    }

    this.petFocusTargets.delete(id);
    if(["follow","defend","combat","set"].includes(mode))p.orderMode=mode;
    if(Number.isFinite(+data.x)&&Number.isFinite(+data.y)){
      p.targetX=clamp(+data.x,20,WORLD_W-20);p.targetY=clamp(+data.y,20,WORLD_H-20);
    }else if(mode!=="set"){p.targetX=-1;p.targetY=-1;}
  }
  handlePetRename(client,data){const p=this.ownedPet(client,data.id);if(!p)return;const name=String(data.name||"").replace(/[<>]/g,"").trim().slice(0,14);if(name)p.petName=name;}
  handlePetRelease(client,data){const id=String(data.id||""),p=this.ownedPet(client,id);if(!p)return;this.petFocusTargets.delete(id);this.petFollowState.delete(id);this.petHuntState.delete(id);this.petChaseState.delete(id);const aid=this.addAnimal(p.type,p.stage,p.x,p.y,{releasedWild:true,hp:p.hp,level:p.level,exp:p.exp,petName:p.petName,enraged:true,tameFailedAggro:true,desperateAggro:true,gender:p.gender,motherId:p.motherId,fatherId:p.fatherId,bredChild:p.bredChild});const a=this.state.animals.get(aid);a.coat=p.coat;a.spotCol=p.spotCol;a.spotsJson=p.spotsJson;a.sleeping=false;this.animalAggro.set(aid,{kind:"player",id:client.sessionId});this.state.pets.delete(id);const owner=this.state.players.get(client.sessionId);if(owner?.ridingPetId===id)owner.ridingPetId="";client.send("petReleased",{id,animalId:aid,name:p.petName});}

  handlePetBreed(client,data={}){
    let motherId=String(data.motherId||""),fatherId=String(data.fatherId||"");
    let mother=this.ownedPet(client,motherId),father=this.ownedPet(client,fatherId);
    if(!mother||!father||mother.dead||father.dead||motherId===fatherId){client.send("petBreedResult",{success:false,reason:"invalid"});return;}
    if(mother.type!==father.type){client.send("petBreedResult",{success:false,reason:"species"});return;}
    if(mother.gender===father.gender||!mother.gender||!father.gender){client.send("petBreedResult",{success:false,reason:"gender"});return;}
    if(mother.stage==="baby"||father.stage==="baby"){client.send("petBreedResult",{success:false,reason:"age"});return;}
    if(mother.gender!=="Female"){const t=mother;mother=father;father=t;const ti=motherId;motherId=fatherId;fatherId=ti;}
    const type=mother.type,info=PET_TYPES[type],x=clamp((mother.x+father.x)*.5+rand(-14,14),24,WORLD_W-24),y=clamp((mother.y+father.y)*.5+rand(-14,14),24,WORLD_H-24);
    const babyId=this.addPet(client.sessionId,type,"baby",x,y,{petName:`Baby ${info.name}`,gender:canonicalAnimalGender(type),motherId,fatherId,bredChild:true,coat:Math.random()<.5?mother.coat:father.coat});
    const baby=this.state.pets.get(babyId);if(baby){baby.abilityCd=0;baby.orderMode="follow";}
    this.sendReward(client.sessionId,{kind:"cards",species:type,amount:1},{x,y,breed:true});
    this.addSkillXp(client.sessionId,20);
    this.recordAccountAchievement(client.sessionId,`breed_${type}`,{species:type});
    client.send("petBreedResult",{success:true,id:babyId,type,gender:baby?.gender||"",motherId,fatherId});
    this.broadcastFx({kind:"familyBirth",x,y});
    this.broadcastFx({kind:"hit",x,y,text:`Baby ${info.name}!`,color:"#ffd9e6"});
  }

  promoteOlderSiblingPet(id,p){
    if(!p||p.dead||p.stage!=="baby")return false;
    p.stage="adult";p.r=animalRadius(p.type,"adult");
    p.maxHp=Math.max(12,Math.round(typeHp(p.type,"adult")*petUpgradeMultiplier(p,"health")));p.hp=p.maxHp;
    p.speed=animalSpeed(p.type,"adult",true,petUpgradeMultiplier(p,"weight"))*petUpgradeMultiplier(p,"speed");
    p.level=1;p.exp=0;const c=this.clientById(p.ownerId);if(c)c.send("petGrew",{id,stage:"adult",type:p.type,reason:"olderSibling"});return true;
  }
  convertLoneOrphanToNormal(childId,p){
    if(!p||p.dead||!p.bredChild)return false;
    for(const pid of [p.motherId,p.fatherId]){const q=pid?this.state.pets.get(pid):null;if(q&&!q.dead&&q.ownerId===p.ownerId)return false;}
    const living=[];for(const[id,q]of this.state.pets)if(q&&!q.dead&&q.ownerId===p.ownerId)living.push([id,q]);
    if(living.length!==1||living[0][0]!==childId)return false;
    p.bredChild=false;p.motherId="";p.fatherId="";p.olderBrotherId="";p.olderSisterId="";
    p.orderMode="follow";p.targetX=-1;p.targetY=-1;this.petFocusTargets.delete(childId);this.petHuntState.delete(childId);this.petFollowState.delete(childId);this.petChaseState.delete(childId);
    const c=this.clientById(p.ownerId);if(c)c.send("familyPromotedNormal",{id:childId});
    return true;
  }
  familyLeaderIds(childId,p){
    if(!p||!p.bredChild)return[];
    const parents=[p.motherId,p.fatherId].filter(pid=>{const q=pid?this.state.pets.get(pid):null;return !!(q&&!q.dead&&q.ownerId===p.ownerId);});
    if(parents.length)return parents;
    if(p.stage!=="baby")return[];
    this.ensureOrphanOlderSiblings(childId,p);
    if(!p.bredChild)return[];
    return[p.olderBrotherId,p.olderSisterId].filter(pid=>pid&&pid!==childId).filter(pid=>{const q=this.state.pets.get(pid);return !!(q&&!q.dead&&q.ownerId===p.ownerId);});
  }
  chooseOlderSiblingLeaders(candidates){
    if(!candidates.length)return[];
    const males=candidates.filter(([,q])=>q.gender==="Male"),females=candidates.filter(([,q])=>q.gender==="Female");
    if(males.length&&females.length){const m=males[randi(0,males.length-1)],fp=females.filter(([id])=>id!==m[0]);if(fp.length)return[m,fp[randi(0,fp.length-1)]];}
    return[candidates[randi(0,candidates.length-1)]];
  }
  ensureOrphanOlderSiblings(childId,p){
    if(!p||p.dead||!p.bredChild||p.stage!=="baby")return false;
    for(const pid of [p.motherId,p.fatherId]){const q=pid?this.state.pets.get(pid):null;if(q&&!q.dead&&q.ownerId===p.ownerId)return false;}
    if(this.convertLoneOrphanToNormal(childId,p))return false;
    const brother=p.olderBrotherId?this.state.pets.get(p.olderBrotherId):null;
    const sister=p.olderSisterId?this.state.pets.get(p.olderSisterId):null;
    if((brother&&!brother.dead&&p.olderBrotherId!==childId)||(sister&&!sister.dead&&p.olderSisterId!==childId))return true;
    const familyIds=[];
    for(const[id,q]of this.state.pets){if(!q||q.dead||q.ownerId!==p.ownerId||!q.bredChild||q.stage!=="baby")continue;if(q.motherId===p.motherId&&q.fatherId===p.fatherId)familyIds.push(id);}
    const familySet=new Set(familyIds);let candidates=[];
    for(const[id,q]of this.state.pets){if(!q||q.dead||q.ownerId!==p.ownerId||familySet.has(id)||id===p.motherId||id===p.fatherId)continue;candidates.push([id,q]);}
    // If the parents were the only other pets and several children remain,
    // one or two of those children can grow up into the older sibling role.
    if(!candidates.length&&familyIds.length>1)candidates=familyIds.filter(id=>id!==childId).map(id=>[id,this.state.pets.get(id)]).filter(([,q])=>q&&!q.dead);
    const leaders=this.chooseOlderSiblingLeaders(candidates);if(!leaders.length)return false;
    for(const[id,q]of leaders)this.promoteOlderSiblingPet(id,q);
    const male=leaders.find(([,q])=>q.gender==="Male"),female=leaders.find(([,q])=>q.gender==="Female");
    const brotherId=male?male[0]:"",sisterId=female?female[0]:"";
    for(const bid of familyIds){const baby=this.state.pets.get(bid);if(!baby||baby.dead||baby.stage!=="baby")continue;baby.olderBrotherId=brotherId;baby.olderSisterId=sisterId;}
    const c=this.clientById(p.ownerId);if(c)c.send("familyOlderSiblings",{brotherId,sisterId,motherId:p.motherId,fatherId:p.fatherId});
    return true;
  }
  isOlderSiblingLeaderPet(id,p){
    if(!p||p.dead)return false;
    for(const[,child]of this.state.pets){if(!child||child.dead||!child.bredChild||child.ownerId!==p.ownerId||child.stage!=="baby")continue;if(child.olderBrotherId===id||child.olderSisterId===id)return true;}
    return false;
  }

  abilityStatusAlive(ref){const o=this.targetObject(ref);if(!o)return false;if(ref.kind==="player"&&!this.isPlayerCombatReady(ref.id))return false;if(ref.kind==="pet"&&o.ownerId&&!this.isPlayerCombatReady(o.ownerId))return false;return ref.kind==="player"?!o.dead&&o.health>0:!o.dead&&o.hp>0;}
  applyAbilityStun(ref,seconds){const o=this.targetObject(ref);if(!o)return;o._abilityStunUntil=Math.max(Number(o._abilityStunUntil)||0,this.state.worldTime+Math.max(0,Number(seconds)||0));}
  applyTornadoTrap(ref,seconds,cx,cy){const o=this.targetObject(ref);if(!o)return;const t=Math.max(.1,Number(seconds)||2.2);this.applyAbilityStun(ref,t);o._tornadoTrapUntil=Math.max(Number(o._tornadoTrapUntil)||0,this.state.worldTime+t);o._tornadoTrapMax=t;o._tornadoCenterX=Number.isFinite(Number(cx))?Number(cx):o.x;o._tornadoCenterY=Number.isFinite(Number(cy))?Number(cy):o.y;o._tornadoPhase=Math.atan2(o.y-o._tornadoCenterY,o.x-o._tornadoCenterX);o._tornadoRadius=clamp(Math.max(20,Math.hypot(o.x-o._tornadoCenterX,o.y-o._tornadoCenterY)),20,52);}
  applyAbilitySlowWeak(ref,seconds,slowMul=.55,weakMul=.68){const o=this.targetObject(ref);if(!o)return;const until=this.state.worldTime+Math.max(0,Number(seconds)||0);o._abilitySlowUntil=Math.max(Number(o._abilitySlowUntil)||0,until);o._abilityWeakUntil=Math.max(Number(o._abilityWeakUntil)||0,until);o._abilitySlowMul=Math.min(Number(o._abilitySlowMul)||1,slowMul);o._abilityWeakMul=Math.min(Number(o._abilityWeakMul)||1,weakMul);if(Number.isFinite(Number(o.speed))){if(!Number.isFinite(Number(o._abilityBaseSpeed)))o._abilityBaseSpeed=Number(o.speed)||0;o.speed=o._abilityBaseSpeed*o._abilitySlowMul;}if(Number.isFinite(Number(o.dmg))){if(!Number.isFinite(Number(o._abilityBaseDmg)))o._abilityBaseDmg=Number(o.dmg)||0;o.dmg=o._abilityBaseDmg*o._abilityWeakMul;}}
  applyAbilityPoison(ref,impactDamage,ownerId,sourcePetId){if(!this.abilityStatusAlive(ref))return;const key=`poison:${ref.kind}:${ref.id}:${sourcePetId||ownerId||"wild"}`;this.abilityDots.set(key,{ref:{kind:ref.kind,id:ref.id},time:5,tick:1,dps:Math.max(.6,(Number(impactDamage)||0)*.32),ownerId,sourcePetId,sourceKind:"pet"});}
  applyAbilityFixedDot(ref,totalDamage,duration=5,ownerId="",sourcePetId="",sourceAnimalId=""){
    if(!this.abilityStatusAlive(ref))return;const dur=Math.max(.5,Number(duration)||5),total=Math.max(0,Number(totalDamage)||0),key=`fixed:${ref.kind}:${ref.id}:${sourcePetId||sourceAnimalId||ownerId||"world"}`;
    this.abilityDots.set(key,{ref:{kind:ref.kind,id:ref.id},time:dur,tick:1,dps:total/dur,ownerId,sourcePetId,sourceAnimalId,sourceKind:sourceAnimalId?"animal":"pet"});
  }
  damagePercentRef(ref,pct,attackerKind="animal",attackerId=""){
    const o=this.targetObject(ref);if(!o)return false;const max=ref.kind==="player"?Math.max(1,Number(o.maxHealth)||100):Math.max(1,Number(o.maxHp)||Number(o.hp)||1);return this.damageTarget(ref,max*clamp(Number(pct)||0,0,1),attackerKind,attackerId);
  }
  abilityTargetsAround(ownerId,x,y,range){const out=[];for(const[id,en]of this.state.enemies)if(!en.dead&&dist(x,y,en.x,en.y)<=range+(en.r||16)*.25)out.push({ref:{kind:"enemy",id},obj:en});for(const[id,a]of this.state.animals)if(!a.dead&&a.hp>0&&dist(x,y,a.x,a.y)<=range+(a.r||18)*.25)out.push({ref:{kind:"animal",id},obj:a});for(const[id,pl]of this.state.players)if(id!==ownerId&&!pl.dead&&dist(x,y,pl.x,pl.y)<=range+PLAYER_R*.25)out.push({ref:{kind:"player",id},obj:pl});for(const[id,q]of this.state.pets)if(q.ownerId!==ownerId&&!q.dead&&dist(x,y,q.x,q.y)<=range+(q.r||18)*.25)out.push({ref:{kind:"pet",id},obj:q});return out;}
  launchArcticShardVolley(ownerId,petId,p,target,damage){if(!p||!target)return;const base=angTo(p.x,p.y,target.obj.x,target.obj.y),ps=petProjectileStageSize(p.stage);for(let i=0;i<3;i++){const pid=this.addProjectile({x:p.x+Math.cos(base+i*.12)*(p.r+10),y:p.y+Math.sin(base+i*.12)*(p.r+10),vx:Math.cos(base+i*.04)*560,vy:Math.sin(base+i*.04)*560,life:1.8,r:13*ps,hostile:false,kind:"iceShard",color:"#bfeeff",dmg:damage,ownerId,petBlast:true,knock:0,sourcePetId:petId});const q=this.state.projectiles.get(pid);if(q)q._targetRef={kind:target.ref.kind,id:target.ref.id};}}
  updateActivePetAbilities(dt){
    const now=this.state.worldTime,next=[];
    for(const fx of this.activePetAbilities){fx.time-=dt;const p=this.state.pets.get(fx.petId);if(!p||p.dead||fx.time<=0)continue;
      if(fx.type==="fennecOrbit"){
        if(!fx.hits)fx.hits=new Map();const orbit=Math.max(p.r+24,fx.orbitR||46),phase=(fx.phase=(fx.phase||0)+dt*6.5);
        for(let i=0;i<3;i++){const a=phase+i*TAU/3,bx=p.x+Math.cos(a)*orbit,by=p.y+Math.sin(a)*orbit;for(const h of this.abilityTargetsAround(fx.ownerId,bx,by,15)){const key=`${i}:${h.ref.kind}:${h.ref.id}`,n=fx.hits.get(key)||0;if(now<n)continue;fx.hits.set(key,now+.75);this.petAbilityDamage(h.ref,fx.damage,fx.ownerId,fx.petId);}}
      }else if(fx.type==="hyenaFireField"){
        if(!fx.hit)fx.hit=new Set();for(const h of this.abilityTargetsAround(fx.ownerId,p.x,p.y,fx.range)){const key=`${h.ref.kind}:${h.ref.id}`;if(fx.hit.has(key))continue;fx.hit.add(key);this.petAbilityDamage(h.ref,fx.damage,fx.ownerId,fx.petId);this.applyAbilityFixedDot(h.ref,fx.damage*.5,5,fx.ownerId,fx.petId,"");}
      }else if(fx.type==="arcticShardOrbit"){
        const t=this.petAbilityTarget(fx.ownerId,fx.petId,p,600);if(t){this.launchArcticShardVolley(fx.ownerId,fx.petId,p,t,fx.damage);this.broadcast("abilityEvent",{petId:fx.petId,ownerId:fx.ownerId,elem:"Ice",x:p.x,y:p.y,r:p.r,stage:p.stage,fxType:"owlWave",angle:angTo(p.x,p.y,t.obj.x,t.obj.y),range:95,life:.45});continue;}
      }
      next.push(fx);
    }
    this.activePetAbilities=next;
  }
  wildAbilityTargetsAround(x,y,range){const out=[];for(const[id,pl]of this.state.players)if(!pl.dead&&this.isPlayerCombatReady(id)&&dist(x,y,pl.x,pl.y)<=range+PLAYER_R*.25)out.push({ref:{kind:"player",id},obj:pl});for(const[id,q]of this.state.pets)if(!q.dead&&this.isPlayerCombatReady(q.ownerId)&&dist(x,y,q.x,q.y)<=range+(q.r||18)*.25)out.push({ref:{kind:"pet",id},obj:q});return out;}
  launchWildArcticShardVolley(animalId,a,target,damage){if(!a||!target)return;const base=angTo(a.x,a.y,target.obj.x,target.obj.y),ps=petProjectileStageSize(a.stage);for(let i=0;i<3;i++){const pid=this.addProjectile({x:a.x+Math.cos(base+i*.12)*(a.r+10),y:a.y+Math.sin(base+i*.12)*(a.r+10),vx:Math.cos(base+i*.04)*560,vy:Math.sin(base+i*.04)*560,life:1.8,r:13*ps,hostile:true,kind:"iceShard",color:"#bfeeff",dmg:damage,ownerId:animalId,petBlast:false,knock:0,sourcePetId:""});const q=this.state.projectiles.get(pid);if(q){q._targetRef={kind:target.ref.kind,id:target.ref.id};q._sourceAnimalId=animalId;}}}
  updateActiveWildAbilities(dt){
    const now=this.state.worldTime,next=[];
    for(const fx of this.activeWildAbilities){fx.time-=dt;const a=this.state.animals.get(fx.animalId);if(!a||a.dead||a.hp<=0||fx.time<=0)continue;
      if(fx.type==="fennecOrbit"){
        if(!fx.hits)fx.hits=new Map();const orbit=Math.max((a.r||18)+24,fx.orbitR||46),phase=(fx.phase=(fx.phase||0)+dt*6.5);
        for(let i=0;i<3;i++){const q=phase+i*TAU/3,bx=a.x+Math.cos(q)*orbit,by=a.y+Math.sin(q)*orbit;for(const h of this.wildAbilityTargetsAround(bx,by,15)){const key=`${i}:${h.ref.kind}:${h.ref.id}`,n=fx.hits.get(key)||0;if(now<n)continue;fx.hits.set(key,now+.75);this.damageTarget(h.ref,fx.damage,"animal",fx.animalId);}}
      }else if(fx.type==="hyenaFireField"){
        if(!fx.hit)fx.hit=new Set();for(const h of this.wildAbilityTargetsAround(a.x,a.y,fx.range)){const key=`${h.ref.kind}:${h.ref.id}`;if(fx.hit.has(key))continue;fx.hit.add(key);this.damageTarget(h.ref,fx.damage,"animal",fx.animalId);this.applyAbilityFixedDot(h.ref,fx.damage*.5,5,"","",fx.animalId);}
      }
      next.push(fx);
    }
    this.activeWildAbilities=next;
  }
  updateAbilityStatuses(dt){
    const now=this.state.worldTime,groups=[["player",this.state.players],["pet",this.state.pets],["animal",this.state.animals],["enemy",this.state.enemies]];
    for(const[kind,group]of groups)for(const[,o]of group){if(!o)continue;if(o._tornadoTrapUntil&&now<o._tornadoTrapUntil){const max=Math.max(.1,Number(o._tornadoTrapMax)||2.2),remain=Math.max(0,o._tornadoTrapUntil-now),frac=clamp(remain/max,0,1);o._tornadoPhase=(Number(o._tornadoPhase)||0)+dt*8.8;const radius=Math.max(5,(Number(o._tornadoRadius)||30)*(.34+.66*frac));o.x=clamp((Number(o._tornadoCenterX)||o.x)+Math.cos(o._tornadoPhase)*radius,20,WORLD_W-20);o.y=clamp((Number(o._tornadoCenterY)||o.y)+Math.sin(o._tornadoPhase)*radius,20,WORLD_H-20);if(kind==="player")this.resolveStatic(o,PLAYER_R*.82);else this.resolveStatic(o,(o.r||18)*.68);}else if(o._tornadoTrapUntil&&now>=o._tornadoTrapUntil){delete o._tornadoTrapUntil;delete o._tornadoTrapMax;delete o._tornadoCenterX;delete o._tornadoCenterY;delete o._tornadoPhase;delete o._tornadoRadius;}if(o._abilitySlowUntil&&now>=o._abilitySlowUntil){if(Number.isFinite(Number(o._abilityBaseSpeed)))o.speed=o._abilityBaseSpeed;delete o._abilityBaseSpeed;delete o._abilitySlowUntil;delete o._abilitySlowMul;}if(o._abilityWeakUntil&&now>=o._abilityWeakUntil){if(Number.isFinite(Number(o._abilityBaseDmg)))o.dmg=o._abilityBaseDmg;delete o._abilityBaseDmg;delete o._abilityWeakUntil;delete o._abilityWeakMul;}}
    for(const[key,dot]of Array.from(this.abilityDots.entries())){dot.time-=dt;dot.tick-=dt;if(dot.time<=0||!this.abilityStatusAlive(dot.ref)){this.abilityDots.delete(key);continue;}if(dot.tick<=0){dot.tick+=1;const o=this.targetObject(dot.ref);if(!o){this.abilityDots.delete(key);continue;}if(dot.sourceAnimalId)this.damageTarget(dot.ref,dot.dps,"animal",dot.sourceAnimalId);else if(dot.ref.kind==="enemy")this.hitEnemy(dot.ref.id,o,dot.dps,dot.ownerId,false,{kind:"pet",id:dot.sourcePetId});else if(dot.ref.kind==="animal")this.hitWild(dot.ref.id,o,dot.dps,dot.ownerId,false,{kind:"pet",id:dot.sourcePetId});else this.damageTarget(dot.ref,dot.dps,"pet",dot.sourcePetId);}}
  }
  petAbilityTarget(ownerId,petId,p,range=520){const focus=this.petFocusTargets.get(petId);if(focus&&this.abilityStatusAlive(focus)){const o=this.targetObject(focus),d=dist(p.x,p.y,o.x,o.y);if(d<=range)return{ref:focus,obj:o,d};}let best=null,bestD=range;for(const[id,en]of this.state.enemies){if(en.dead)continue;const d=dist(p.x,p.y,en.x,en.y);if(d<bestD){best={ref:{kind:"enemy",id},obj:en,d};bestD=d;}}for(const[id,a]of this.state.animals){if(a.dead||a.hp<=0)continue;const d=dist(p.x,p.y,a.x,a.y);if(d<bestD){best={ref:{kind:"animal",id},obj:a,d};bestD=d;}}for(const[id,pl]of this.state.players){if(id===ownerId||pl.dead)continue;const d=dist(p.x,p.y,pl.x,pl.y);if(d<bestD){best={ref:{kind:"player",id},obj:pl,d};bestD=d;}}for(const[id,q]of this.state.pets){if(q.dead||q.ownerId===ownerId)continue;const d=dist(p.x,p.y,q.x,q.y);if(d<bestD){best={ref:{kind:"pet",id},obj:q,d};bestD=d;}}return best;}
  petSkillHealFromDamage(petId,dealt){const p=this.state.pets.get(petId);if(!p||p.dead||!(p.type==="rabbit"||p.type==="deer"))return 0;const heal=Math.max(0,Number(dealt)||0)*.50,before=Math.max(0,Number(p.hp)||0);p.hp=clamp(before+heal,0,p.maxHp);return Math.max(0,p.hp-before);}
  petAbilityDamage(ref,raw,ownerId,petId){const o=this.targetObject(ref);if(!o)return 0;const before=ref.kind==="player"?Math.max(0,Number(o.health)||0):Math.max(0,Number(o.hp)||0);if(ref.kind==="enemy")this.hitEnemy(ref.id,o,raw,ownerId,false,{kind:"pet",id:petId});else if(ref.kind==="animal")this.hitWild(ref.id,o,raw,ownerId,false,{kind:"pet",id:petId});else this.damageTarget(ref,raw,"pet",petId);const after=ref.kind==="player"?Math.max(0,Number(o.health)||0):Math.max(0,Number(o.hp)||0),dealt=Math.max(0,before-after);if(dealt>0)this.petSkillHealFromDamage(petId,dealt);return dealt;}
  petAbilityArea(ownerId,petId,p,x,y,range,damage,opts={}){const refs=[];for(const[id,en]of this.state.enemies)if(!en.dead&&dist(x,y,en.x,en.y)<=range+(en.r||16)*.25)refs.push({ref:{kind:"enemy",id},obj:en});for(const[id,a]of this.state.animals)if(!a.dead&&a.hp>0&&dist(x,y,a.x,a.y)<=range+(a.r||18)*.25)refs.push({ref:{kind:"animal",id},obj:a});for(const[id,pl]of this.state.players)if(id!==ownerId&&!pl.dead&&dist(x,y,pl.x,pl.y)<=range+PLAYER_R*.25)refs.push({ref:{kind:"player",id},obj:pl});for(const[id,q]of this.state.pets)if(q.ownerId!==ownerId&&!q.dead&&dist(x,y,q.x,q.y)<=range+(q.r||18)*.25)refs.push({ref:{kind:"pet",id},obj:q});for(const h of refs){this.petAbilityDamage(h.ref,damage,ownerId,petId);if(opts.stun)this.applyAbilityStun(h.ref,opts.stun);if(opts.slowWeak)this.applyAbilitySlowWeak(h.ref,opts.slowWeak,opts.slowMul||.55,opts.weakMul||.68);if((opts.knock||opts.pull)&&this.abilityStatusAlive(h.ref)){const pulling=!!opts.pull,q=pulling?angTo(h.obj.x,h.obj.y,x,y):angTo(x,y,h.obj.x,h.obj.y),force=pulling?opts.pull:opts.knock,mul=(h.ref.kind==="animal"||h.ref.kind==="pet")?animalKnockbackScale(h.obj):1;h.obj.x=clamp(h.obj.x+Math.cos(q)*force*mul,20,WORLD_W-20);h.obj.y=clamp(h.obj.y+Math.sin(q)*force*mul,20,WORLD_H-20);if(h.ref.kind==="player")this.resolveStatic(h.obj,PLAYER_R*.82);else if(h.ref.kind==="animal"||h.ref.kind==="pet")this.resolveStatic(h.obj,(h.obj.r||18)*.68);}}return refs;}
  healPetTeam(ownerId,amount){const heal=Math.max(0,Number(amount)||0),owner=this.state.players.get(ownerId);if(owner&&!owner.dead)owner.health=clamp(owner.health+heal,0,owner.maxHealth);for(const[,q]of this.state.pets)if(q.ownerId===ownerId&&!q.dead)q.hp=clamp(q.hp+heal,0,q.maxHp);}

  handlePetAbility(client,data,inherited=false){
    const id=String(data?.id||""),p=this.ownedPet(client,id);if(!p||p.dead||(!inherited&&p.abilityCd>0)||(!inherited&&p.bredChild&&!this.isOlderSiblingLeaderPet(id,p)))return;
    const info=PET_TYPES[p.type],ownerId=client.sessionId,owner=this.state.players.get(ownerId),stats=petAbilityStats(p);p.abilityCd=inherited?0:info.abilityCd;
    const angle=Number.isFinite(p.angle)?p.angle:(owner?.angle||0),elem=info.elem;
    const sendFx=(fxType,extra={})=>this.broadcast("abilityEvent",{petId:id,ownerId,elem,x:p.x,y:p.y,r:p.r,stage:p.stage,fxType,...extra,inherited});
    this.petDamageResourcesAround(ownerId,p,p.x,p.y,p.r+42,true);

    if(p.type==="clouded"){
      const dmg=stats.damage||5,t=this.petAbilityTarget(ownerId,id,p,650),fireAngle=t?angTo(p.x,p.y,t.obj.x,t.obj.y):angle,ps=petProjectileStageSize(p.stage);p.angle=fireAngle;const pid=this.addProjectile({x:p.x+Math.cos(fireAngle)*(p.r+12),y:p.y+Math.sin(fireAngle)*(p.r+12),vx:Math.cos(fireAngle)*300,vy:Math.sin(fireAngle)*300,life:2.8,r:19*ps,hostile:false,kind:"tornado",color:"#d9f6ff",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});const q=this.state.projectiles.get(pid);if(q){q._targetRef=t?{kind:t.ref.kind,id:t.ref.id}:null;q._wander=fireAngle;q._wanderSeed=Math.random()*10;}sendFx("owlWave",{angle:fireAngle,range:petAbilityRangeFor(p,80,1.5),life:.45});
    }else if(p.type==="fennec"){
      const dmg=stats.damage||15,orbitR=Math.max(p.r+24,petAbilityRangeFor(p,48,.6));this.activePetAbilities.push({type:"fennecOrbit",petId:id,ownerId,time:4,damage:dmg,orbitR,phase:0,hits:new Map()});sendFx("fennecOrbit",{range:orbitR,life:4});
    }else if(p.type==="camel"){
      const dmg=stats.damage||30,ps=petProjectileStageSize(p.stage);this.addProjectile({x:p.x+Math.cos(angle)*(p.r+10),y:p.y+Math.sin(angle)*(p.r+10),vx:Math.cos(angle)*520,vy:Math.sin(angle)*520,life:1.55,r:12*ps,hostile:false,kind:"spit",color:"#cfe89a",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});sendFx("fireMuzzle",{angle,range:60,life:.3});
    }else if(p.type==="scorpion"){
      const t=this.petAbilityTarget(ownerId,id,p,175);if(t){const grab=stats.grab||10,sting=stats.sting||20,dot=stats.dot||15;this.applyAbilityStun(t.ref,1.25);this.petAbilityDamage(t.ref,grab,ownerId,id);this.petAbilityDamage(t.ref,sting,ownerId,id);this.applyAbilityFixedDot(t.ref,dot,5,ownerId,id,"");sendFx("scorpionGrab",{targetX:t.obj.x,targetY:t.obj.y,life:.8,range:36});}else sendFx("poisonMuzzle",{angle,life:.35});
    }else if(p.type==="hyena"){
      const dmg=stats.damage||10,range=petAbilityRangeFor(p,125,2.2);this.activePetAbilities.push({type:"hyenaFireField",petId:id,ownerId,time:5,damage:dmg,range,hit:new Set()});sendFx("hyenaFireField",{range,life:5});
    }else if(p.type==="caracal"){
      const t=this.petAbilityTarget(ownerId,id,p,145),pct=Number(stats.pct)||.25;if(t){this.damagePercentRef(t.ref,pct,"pet",id);this.applyAbilityStun(t.ref,1.8);sendFx("lightningStrike",{fromX:p.x,fromY:p.y,targetX:t.obj.x,targetY:t.obj.y,range:42,life:.65});}
    }else if(p.type==="polarbear"){
      const t=this.petAbilityTarget(ownerId,id,p,165),dmg=stats.damage||5;if(t){this.petAbilityDamage(t.ref,dmg,ownerId,id);const ref={kind:t.ref.kind,id:t.ref.id};setTimeout(()=>{if(this.abilityStatusAlive(ref))this.petAbilityDamage(ref,dmg,ownerId,id);},300);sendFx("iceClaws",{targetX:t.obj.x,targetY:t.obj.y,range:Math.max(48,(t.obj.r||18)*1.35),life:.9});}
    }else if(p.type==="arcticfox"){
      const dmg=stats.damage||10,t=this.petAbilityTarget(ownerId,id,p,600);if(t){this.launchArcticShardVolley(ownerId,id,p,t,dmg);sendFx("owlWave",{angle:angTo(p.x,p.y,t.obj.x,t.obj.y),range:95,life:.45});}else{this.activePetAbilities=this.activePetAbilities.filter(f=>!(f.type==="arcticShardOrbit"&&f.petId===id));this.activePetAbilities.push({type:"arcticShardOrbit",petId:id,ownerId,time:1e9,damage:dmg});sendFx("arcticShardOrbit",{range:Math.max(p.r+28,48),life:1e9});}
    }else if(p.type==="walrus"){
      const t=this.petAbilityTarget(ownerId,id,p,300),dmg=stats.damage||2;if(t){const stage=uploadedAnimalStageKey(p.stage),mul={baby:.72,adult:1,boss:1.2,superboss:1.45,bigmomma:1.75}[stage]||1,ring=Math.max((t.obj.r||PLAYER_R)+34,62*mul),wallR=clamp(13*mul,11,27);for(let i=0;i<6;i++){const a=i/6*TAU,wx=t.obj.x+Math.cos(a)*ring,wy=t.obj.y+Math.sin(a)*ring;this.addWall(wx,wy,wallR,4,ownerId,{hp:999,kind:"stoneSpike",spiked:true,spikeDmg:dmg,sourcePetId:id});}sendFx("earthRingBurst",{targetX:t.obj.x,targetY:t.obj.y,range:ring+wallR,life:.8});}
    }else if(p.type==="queenbee"){const range=petAbilityRangeFor(p,135,2.8),dmg=stats.damage||16,dot=stats.dot||14,hits=this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg*.42,{knock:12});for(const h of hits)this.applyAbilityFixedDot(h.ref,dot,5,ownerId,id,"");sendFx("beeSwarm",{range,life:1.2,color:"#ffe27c"});
    }else if(p.type==="workerbee"){const t=this.petAbilityTarget(ownerId,id,p,180),dmg=stats.damage||14,dot=stats.dot||10;if(t){this.petAbilityDamage(t.ref,dmg,ownerId,id);this.applyAbilityFixedDot(t.ref,dot,5,ownerId,id,"");const aa=angTo(p.x,p.y,t.obj.x,t.obj.y),dash=Math.min(95,Math.max(24,t.d-18)),ox=p.x,oy=p.y;p.x=clamp(p.x+Math.cos(aa)*dash,20,WORLD_W-20);p.y=clamp(p.y+Math.sin(aa)*dash,20,WORLD_H-20);this.resolveStatic(p,(p.r||18)*.68);sendFx("pounce",{fromX:ox,fromY:oy,targetX:p.x,targetY:p.y,angle:aa,life:.55,shockScale:.36});}
    }else if(p.type==="dronebee"){const t=this.petAbilityTarget(ownerId,id,p,210),dmg=stats.damage||20;if(t){const aa=angTo(p.x,p.y,t.obj.x,t.obj.y),dash=Math.min(120,Math.max(40,t.d-Math.max(10,t.obj.r||18))),ox=p.x,oy=p.y;p.x=clamp(p.x+Math.cos(aa)*dash,20,WORLD_W-20);p.y=clamp(p.y+Math.sin(aa)*dash,20,WORLD_H-20);this.resolveStatic(p,(p.r||18)*.68);this.petAbilityDamage(t.ref,dmg,ownerId,id);sendFx("pounce",{fromX:ox,fromY:oy,targetX:p.x,targetY:p.y,angle:aa,life:.62,shockScale:.46});}
    }else if(p.type==="muskox"){const range=petAbilityRangeFor(p,125,2.3),dmg=stats.damage||18;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{knock:18});sendFx("earthRingBurst",{range,life:1});
    }else if(p.type==="snowyowl"){const dmg=stats.damage||14,ps=petProjectileStageSize(p.stage);for(const off of[-.28,-.14,0,.14,.28])this.addProjectile({x:p.x,y:p.y,vx:Math.cos(angle+off)*520,vy:Math.sin(angle+off)*520,life:1,r:10*ps,hostile:false,kind:"owlSound",color:"#ecfbff",dmg:dmg*.42,ownerId,petBlast:true,knock:0,sourcePetId:id});sendFx("owlWave",{angle,range:120,life:.75});
    }else if(p.type==="mountaingoat"){const t=this.petAbilityTarget(ownerId,id,p,180),dmg=stats.damage||18;if(t){this.petAbilityDamage(t.ref,dmg,ownerId,id);const q=angTo(p.x,p.y,t.obj.x,t.obj.y);t.obj.x=clamp(t.obj.x+Math.cos(q)*75,20,WORLD_W-20);t.obj.y=clamp(t.obj.y+Math.sin(q)*75,20,WORLD_H-20);}sendFx("earthRingBurst",{range:65,life:.6});
    }else if(p.type==="eagle"){const t=this.petAbilityTarget(ownerId,id,p,560),dmg=stats.damage||19;if(t){this.petAbilityDamage(t.ref,dmg,ownerId,id);this.applyAbilityStun(t.ref,1.4);sendFx("lightningStrike",{fromX:t.obj.x,fromY:t.obj.y-120,targetX:t.obj.x,targetY:t.obj.y,range:55,life:.7});}}
    else if(p.type==="cougar"){const t=this.petAbilityTarget(ownerId,id,p,175),dmg=stats.damage||18;if(t)for(let i=0;i<3;i++)this.petAbilityDamage(t.ref,dmg*.38,ownerId,id);sendFx("pounce",{fromX:p.x,fromY:p.y,targetX:p.x,targetY:p.y,angle,life:.45,shockScale:.4});
    }else if(p.type==="bighorn"){const ox=p.x,oy=p.y,dmg=stats.damage||18;p.x=clamp(p.x+Math.cos(angle)*110,20,WORLD_W-20);p.y=clamp(p.y+Math.sin(angle)*110,20,WORLD_H-20);this.resolveStatic(p,(p.r||18)*.68);this.petAbilityArea(ownerId,id,p,p.x,p.y,petAbilityRangeFor(p,65,1.4),dmg,{knock:80});sendFx("earthRingBurst",{range:70,life:.7});
    }else if(p.type==="marmot"){const range=petAbilityRangeFor(p,120,2),dmg=stats.damage||12;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{stun:2});sendFx("sonicBurst",{range,life:.9});
    }else if(p.type==="jaguar"){const range=petAbilityRangeFor(p,95,1.8),dmg=stats.damage||20;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{knock:18});sendFx("sonicBurst",{range,life:.55,color:"#7c5ba7"});
    }else if(p.type==="toucan"){const dmg=stats.damage||13,ps=petProjectileStageSize(p.stage);this.addProjectile({x:p.x,y:p.y,vx:Math.cos(angle)*590,vy:Math.sin(angle)*590,life:1.2,r:9*ps,hostile:false,kind:"owlSound",color:"#f0b64a",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});sendFx("owlWave",{angle,range:100,life:.5});
    }else if(p.type==="tapir"){const dmg=stats.damage||17;for(let i=1;i<=3;i++){const x=p.x+Math.cos(angle)*i*42,y=p.y+Math.sin(angle)*i*42;this.petAbilityArea(ownerId,id,p,x,y,petAbilityRangeFor(p,45,1),dmg*.38,{knock:12});}sendFx("earthRingBurst",{range:140,life:.8});
    }else if(p.type==="capybara"){const range=petAbilityRangeFor(p,130,2.2),dmg=stats.damage||14;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg*.35,{knock:22});this.healPetTeam(ownerId,dmg*.8);sendFx("whirlpool",{range,life:1});
    }else if(p.type==="anaconda"){const t=this.petAbilityTarget(ownerId,id,p,150),dmg=stats.damage||20;if(t){this.petAbilityDamage(t.ref,dmg,ownerId,id);this.applyAbilitySlowWeak(t.ref,3.5,.28,.88);}sendFx("earthRingBurst",{range:45,life:.7});
    }else if(elem==="Stone"){
      const ws=dogWallStats(p.stage,p.level||1),wallR=27,wallDist=Math.max(48,(p.r||18)*.72+wallR+8),wx=p.x+Math.cos(angle)*wallDist,wy=p.y+Math.sin(angle)*wallDist;this.addWall(wx,wy,wallR,-1,ownerId,{hp:ws.hp,kind:"stoneSpike",spiked:true,spikeDmg:ws.spikeDmg,sourcePetId:id});this.bounceAnimalsFromNewDogWall(wx,wy,wallR,id,"");sendFx("stone",{targetX:wx,targetY:wy,life:.8});
    }else if(elem==="Sound"){
      const range=petAbilityRangeFor(p,145,3.35),dmg=stats.damage||15;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{knock:58});this.petDamageResourcesAround(ownerId,p,p.x,p.y,range,true);sendFx("sonicBurst",{range,life:1.35});
    }else if(elem==="Fire"){
      const a=angle,dmg=stats.damage||11,projScale=petProjectileStageSize(p.stage);this.addProjectile({x:p.x+Math.cos(a)*(p.r+8),y:p.y+Math.sin(a)*(p.r+8),vx:Math.cos(a)*520,vy:Math.sin(a)*520,life:1.35,r:11*projScale,hostile:false,kind:"fire",color:"#ff6a2a",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});sendFx("fireMuzzle",{angle:a,life:.45});
    }else if(elem==="Lightning"){
      const t=this.petAbilityTarget(ownerId,id,p,520),dmg=stats.damage||5,stun=stats.stun||3,shockStun=stats.shockStun||2,tx=t?.obj?.x??p.x+Math.cos(angle)*150,ty=t?.obj?.y??p.y+Math.sin(angle)*150;if(t){this.petAbilityDamage(t.ref,dmg,ownerId,id);this.applyAbilityStun(t.ref,stun);}const shockR=petAbilityRangeFor(p,90,2.25);const refs=[];for(const[eid,en]of this.state.enemies)if(!en.dead&&(!t||t.ref.kind!=="enemy"||t.ref.id!==eid)&&dist(tx,ty,en.x,en.y)<=shockR)refs.push({kind:"enemy",id:eid});for(const[aid,a]of this.state.animals)if(!a.dead&&(!t||t.ref.kind!=="animal"||t.ref.id!==aid)&&dist(tx,ty,a.x,a.y)<=shockR)refs.push({kind:"animal",id:aid});for(const[pid,pl]of this.state.players)if(pid!==ownerId&&!pl.dead&&(!t||t.ref.kind!=="player"||t.ref.id!==pid)&&dist(tx,ty,pl.x,pl.y)<=shockR)refs.push({kind:"player",id:pid});for(const[qid,q]of this.state.pets)if(q.ownerId!==ownerId&&!q.dead&&(!t||t.ref.kind!=="pet"||t.ref.id!==qid)&&dist(tx,ty,q.x,q.y)<=shockR)refs.push({kind:"pet",id:qid});for(const ref of refs)this.applyAbilityStun(ref,shockStun);sendFx("lightningStrike",{fromX:p.x,fromY:p.y,targetX:tx,targetY:ty,range:shockR,life:.75});
    }else if(elem==="Ice"){
      const range=petAbilityRangeFor(p,130,2.85),dmg=stats.damage||10;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{slowWeak:4,slowMul:.55,weakMul:.68});this.petDamageResourcesAround(ownerId,p,p.x,p.y,range,true);sendFx("iceRing",{range,life:7});
    }else if(elem==="Water"){
      const range=petAbilityRangeFor(p,185,3.65),dmg=stats.damage||16,hits=this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{pull:46});p.hp=clamp(p.hp+dmg*.45*Math.max(1,Math.min(5,hits.length)),0,p.maxHp);this.petDamageResourcesAround(ownerId,p,p.x,p.y,range,true);sendFx("whirlpool",{range,life:7});
    }else if(elem==="Plant"){
      const a=angle,blast=stats.blast||5,ring=stats.ring||7,range=petAbilityRangeFor(p,120,2.65),projScale=petProjectileStageSize(p.stage);this.addProjectile({x:p.x+Math.cos(a)*(p.r+6),y:p.y+Math.sin(a)*(p.r+6),vx:Math.cos(a)*430,vy:Math.sin(a)*430,life:1.25,r:8*projScale,hostile:false,kind:"leaf",color:"#5cb85c",dmg:blast,ownerId,petBlast:true,knock:0,sourcePetId:id});this.petAbilityArea(ownerId,id,p,p.x,p.y,range,ring,{});this.petDamageResourcesAround(ownerId,p,p.x,p.y,range,true);sendFx("plantRing",{range,life:7,angle:a});
    }else if(elem==="Wind"){
      const a=angle,dmg=stats.damage||10,projScale=petProjectileStageSize(p.stage);this.addProjectile({x:p.x+Math.cos(a)*(p.r+8),y:p.y+Math.sin(a)*(p.r+8),vx:Math.cos(a)*560,vy:Math.sin(a)*560,life:1.25,r:18*projScale,hostile:false,kind:"owlSound",color:"#bdeaff",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});sendFx("owlWave",{angle:a,range:petAbilityRangeFor(p,100,2.2),life:.65});
    }else if(elem==="Poison"){
      const a=angle,dmg=stats.damage||5,projScale=petProjectileStageSize(p.stage);this.addProjectile({x:p.x+Math.cos(a)*(p.r+7),y:p.y+Math.sin(a)*(p.r+7),vx:Math.cos(a)*500,vy:Math.sin(a)*500,life:1.3,r:9*projScale,hostile:false,kind:"poison",color:"#65cc65",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});sendFx("poisonMuzzle",{angle:a,life:.5});
    }else if(elem==="Light"){
      const range=petAbilityRangeFor(p,155,3.15),dmg=stats.damage||16;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{});this.petDamageResourcesAround(ownerId,p,p.x,p.y,range,true);sendFx("lightRingBurst",{range,life:7});
    }else if(elem==="Earth"){
      const range=petAbilityRangeFor(p,145,2.95),dmg=stats.damage||20;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{knock:12});this.petDamageResourcesAround(ownerId,p,p.x,p.y,range,true);sendFx("earthRingBurst",{range,life:7});
    }else if(elem==="Combat"){
      const t=this.petAbilityTarget(ownerId,id,p,430),dmg=stats.damage||34,a=t?angTo(p.x,p.y,t.obj.x,t.obj.y):angle,targetR=t?(t.obj.r||PLAYER_R):18,dd=t?Math.min(180,Math.max(0,t.d-(p.r+targetR)*.62)):110,ox=p.x,oy=p.y;p.x=clamp(p.x+Math.cos(a)*dd,20,WORLD_W-20);p.y=clamp(p.y+Math.sin(a)*dd,20,WORLD_H-20);p.angle=a;this.resolveStatic(p,(p.r||18)*.72);if(t&&dist(p.x,p.y,t.obj.x,t.obj.y)<=p.r+targetR+28)this.petAbilityDamage(t.ref,dmg,ownerId,id);sendFx("pounce",{fromX:ox,fromY:oy,targetX:p.x,targetY:p.y,angle:a,life:.95,shockScale:petAbilityStageSize(p.stage)});
    }
    if(!inherited)for(const[cid,child]of this.state.pets){if(!child||child.dead||!child.bredChild||child.ownerId!==ownerId)continue;if(child.motherId===id||child.fatherId===id||child.olderBrotherId===id||child.olderSisterId===id)this.handlePetAbility(client,{id:cid},true);}
  }

  nearestHostile(x,y,range=Infinity){
    let best=null,bestD=range;
    if(Number.isFinite(range)){
      const kinds=new Set(["enemy","animal"]);
      for(const rec of this.nearbyDynamic(x,y,range+120,kinds)){
        const o=rec.obj;if(!o||o.dead||o.hp<=0)continue;const d=dist(x,y,o.x,o.y);if(d<bestD){best={kind:rec.kind,id:rec.id,obj:o,d};bestD=d;}
      }
      return best;
    }
    for(const[id,en]of this.state.enemies){const d=dist(x,y,en.x,en.y);if(d<bestD){best={kind:"enemy",id,obj:en,d};bestD=d;}}
    for(const[id,a]of this.state.animals){const d=dist(x,y,a.x,a.y);if(d<bestD){best={kind:"animal",id,obj:a,d};bestD=d;}}
    return best;
  }
  chooseCombatHuntTarget(p){
    const candidates=[];
    for(const[id,en]of this.state.enemies)if(en&&!en.dead&&en.hp>0)candidates.push({kind:"enemy",id,obj:en,d:dist(p.x,p.y,en.x,en.y)});
    for(const[id,a]of this.state.animals)if(a&&a.hp>0)candidates.push({kind:"animal",id,obj:a,d:dist(p.x,p.y,a.x,a.y)});
    if(!candidates.length)return null;
    const nearby=candidates.filter(c=>c.d<1100),pool=nearby.length?nearby:candidates;
    return pool[Math.floor(Math.random()*pool.length)]||null;
  }

  targetObject(ref){if(!ref)return null;if(ref.kind==="player")return this.state.players.get(ref.id)||null;if(ref.kind==="pet")return this.state.pets.get(ref.id)||null;if(ref.kind==="animal")return this.state.animals.get(ref.id)||null;if(ref.kind==="enemy")return this.state.enemies.get(ref.id)||null;return null;}
  targetRadius(ref,obj){return ref?.kind==="player"?PLAYER_R:(obj?.r||16);}
  nearestPlayerOrPet(x,y,range=Infinity){let best=null,bestD=range;for(const[id,p]of this.state.players){if(p.dead||!this.isPlayerCombatReady(id))continue;const d=dist(x,y,p.x,p.y);if(d<bestD){best={kind:"player",id,obj:p,d};bestD=d;}}for(const[id,p]of this.state.pets){if(p.dead||!this.isPlayerCombatReady(p.ownerId))continue;const d=dist(x,y,p.x,p.y);if(d<bestD){best={kind:"pet",id,obj:p,d};bestD=d;}}return best;}
  nearestPlayer(x,y,range=Infinity){let best=null,bestD=range;for(const[id,p]of this.state.players){if(p.dead||!this.isPlayerCombatReady(id))continue;const d=dist(x,y,p.x,p.y);if(d<bestD){best={kind:"player",id,obj:p,d};bestD=d;}}return best;}

  snakeFluteCalmActive(a){if(!a||a.type!=="snake")return false;const tier=clamp(Math.floor(Number(a._fluteTier)||0),0,3),variant=String(a._fluteVariant||""),minSafeHp=tier>=3&&variant==="diamond"?.008:[.25,.10,.03,.018][tier];if(a.hp>0&&a.hp/Math.max(1,a.maxHp)<=minSafeHp){a._fluteCalmUntil=0;return false;}return(Number(a._fluteCalmUntil)||0)>this.state.worldTime;}
  markWildStayAwake(a,seconds=6){if(a)a._stayAwakeUntil=Math.max(Number(a._stayAwakeUntil)||0,this.state.worldTime+Math.max(0,Number(seconds)||0));}
  wildCanSleepNow(id,a){if(!a||a.hp<=0)return false;if(this.animalAggro.has(id))return false;if((Number(a.recentHit)||0)>0||a.enraged||a.tameFailedAggro||a.desperateAggro||(Number(a.combat)||0)>0)return false;if(a.fleeUntil&&this.state.worldTime<a.fleeUntil)return false;if((Number(a._stayAwakeUntil)||0)>this.state.worldTime)return false;return true;}
  setWildReactionToAttacker(id,a,ref){
    if(!a||!ref)return;
    if(a.type==="clouded"&&ref.kind==="pet"){const attackingPet=this.state.pets.get(ref.id);if(attackingPet?.ownerId&&this.state.players.has(attackingPet.ownerId))ref={kind:"player",id:attackingPet.ownerId};}
    const target=this.targetObject(ref);
    const info=PET_TYPES[a.type]||{};this.markWildStayAwake(a,6.5);
    a.sleeping=false;
    if(this.snakeFluteCalmActive(a)){a.enraged=false;a.desperateAggro=false;a.tameFailedAggro=false;a.combat=0;a.fleeUntil=0;this.animalFleeFrom.delete(id);this.animalAggro.delete(id);return;}
    if(this.isNeutralBeeType(a.type)||(a.type==="dronebee"&&!this.droneBeeShouldFlee(a))){a.sleeping=false;a.enraged=true;a.desperateAggro=false;a.combat=Math.max(a.combat||0,8);a.fleeUntil=0;this.animalFleeFrom.delete(id);this.animalAggro.set(id,ref);return;}
    if(this.droneBeeShouldFlee(a)){a.sleeping=false;a.enraged=false;a.desperateAggro=false;a.combat=Math.max(a.combat||0,4);this.animalAggro.delete(id);this.animalFleeFrom.set(id,ref);a.fleeUntil=this.state.worldTime+5.5;this.markWildStayAwake(a,8);if(target)a.wanderA=angTo(target.x,target.y,a.x,a.y);return;}
    if(ref.kind==="animal"&&target&&target.type&&!wildCanPreyOn(a.type,target.type)){
      a.sleeping=false;a.enraged=false;a.desperateAggro=false;a.combat=Math.max(a.combat||0,4);
      this.animalAggro.delete(id);this.animalFleeFrom.set(id,ref);a.fleeUntil=this.state.worldTime+4;this.markWildStayAwake(a,6.5);
      a.wanderA=angTo(target.x,target.y,a.x,a.y);return;
    }
    const shouldFleeFirst=a.stage==="baby"||!!info.flee;
    const lowHealthFight=shouldFleeFirst&&a.hp>0&&a.maxHp>0&&a.hp/a.maxHp<=.32;
    a.sleeping=false;a.enraged=true;a.combat=Math.max(a.combat||0,8);
    if(lowHealthFight){
      a.desperateAggro=true;a.fleeUntil=0;this.animalFleeFrom.delete(id);this.animalAggro.set(id,ref);
    }else if(shouldFleeFirst&&!a.tameFailedAggro&&!a.desperateAggro){
      this.animalAggro.delete(id);this.animalFleeFrom.set(id,ref);a.fleeUntil=this.state.worldTime+4;this.markWildStayAwake(a,6.5);
      if(target)a.wanderA=angTo(target.x,target.y,a.x,a.y);
    }else{
      a.fleeUntil=0;this.animalFleeFrom.delete(id);this.animalAggro.set(id,ref);
    }
  }

  pushWildAbilityTarget(ref,target,fromX,fromY,amount){
    if(!ref||!target||amount<=0)return;
    const q=angTo(fromX,fromY,target.x,target.y);
    let push=amount;
    if(ref.kind==="pet"||ref.kind==="animal")push*=animalKnockbackScale(target);
    target.x=clamp(target.x+Math.cos(q)*push,20,WORLD_W-20);
    target.y=clamp(target.y+Math.sin(q)*push,20,WORLD_H-20);
    if(ref.kind==="player")this.resolveStatic(target,PLAYER_R*.82);
    else if(ref.kind==="pet"||ref.kind==="animal")this.resolveStatic(target,(target.r||18)*.68);
  }

  pullWildAbilityTarget(ref,target,toX,toY,amount){if(!ref||!target||amount<=0)return;const q=angTo(target.x,target.y,toX,toY);let pull=amount;if(ref.kind==="pet"||ref.kind==="animal")pull*=animalKnockbackScale(target);target.x=clamp(target.x+Math.cos(q)*pull,20,WORLD_W-20);target.y=clamp(target.y+Math.sin(q)*pull,20,WORLD_H-20);if(ref.kind==="player")this.resolveStatic(target,PLAYER_R*.82);else if(ref.kind==="pet"||ref.kind==="animal")this.resolveStatic(target,(target.r||18)*.68);}

  wildUseAbility(id,a,ref,target){
    if(!a||!target||a.stage==="baby"||(a.abilityCd||0)>0||a.sleeping||a.hp<=0)return false;
    const info=PET_TYPES[a.type]||{};const elem=info.elem||"";
    a.abilityCd=Math.max(3.2,(info.abilityCd||12)*.55);
    if(!["clouded","fennec"].includes(a.type))this.broadcast("abilityEvent",{petId:"",ownerId:"",elem,x:a.x,y:a.y,r:a.r,wildAnimalId:id});
    const d=dist(a.x,a.y,target.x,target.y);
    // New biome wildlife keeps the same species-specific move it uses after taming.
    if(a.type==="clouded"){
      const dmg=petAbilityStats(a).damage||10,ang=angTo(a.x,a.y,target.x,target.y);a.angle=ang;const pid=this.addProjectile({x:a.x+Math.cos(ang)*(a.r+12),y:a.y+Math.sin(ang)*(a.r+12),vx:Math.cos(ang)*330,vy:Math.sin(ang)*330,life:2.8,r:Math.max(16,18*petProjectileStageSize(a.stage)),hostile:true,kind:"tornado",color:"#d9f6ff",dmg,ownerId:id,petBlast:false,knock:0,sourcePetId:""});const q=this.state.projectiles.get(pid);if(q){q._targetRef={kind:ref.kind,id:ref.id};q._sourceAnimalId=id;q._wander=ang;q._wanderSeed=Math.random()*TAU;}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"TORNADO TRAP",color:"#d9f6ff"});
    }
    else if(a.type==="fennec"){
      const dmg=petAbilityStats(a).damage||15,orbitR=Math.max((a.r||18)+24,48);this.activeWildAbilities.push({type:"fennecOrbit",animalId:id,time:4,damage:dmg,orbitR,phase:0,hits:new Map()});this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Fire",fxType:"fennecOrbit",x:a.x,y:a.y,r:a.r,stage:a.stage,range:orbitR,life:4});this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"FIRE ORBIT",color:"#ff8b36"});
    }
    else if(a.type==="camel"){
      const dmg=petAbilityStats(a).damage||30,ang=Number.isFinite(a.angle)?a.angle:angTo(a.x,a.y,target.x,target.y);this.addProjectile({x:a.x+Math.cos(ang)*(a.r+10),y:a.y+Math.sin(ang)*(a.r+10),vx:Math.cos(ang)*620,vy:Math.sin(ang)*620,life:1.35,r:11*petProjectileStageSize(a.stage),hostile:true,kind:"spit",color:"#b9d76a",dmg,ownerId:id,petBlast:false,knock:0,sourcePetId:""});this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"SPIT",color:"#b9d76a"});
    }
    else if(a.type==="scorpion"){
      const st=petAbilityStats(a);if(d<145){this.applyAbilityStun(ref,1.25);this.damageTarget(ref,st.grab||10,"animal",id);this.damageTarget(ref,st.sting||20,"animal",id);this.applyAbilityFixedDot(ref,st.dot||15,5,"","",id);this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Poison",fxType:"scorpionGrab",x:a.x,y:a.y,targetX:target.x,targetY:target.y,r:a.r,stage:a.stage,life:.7});}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"CLAW + STING",color:"#78d66a"});
    }
    else if(a.type==="hyena"){
      const dmg=petAbilityStats(a).damage||10,range=Math.max(125,(a.r||18)*2.2);this.activeWildAbilities.push({type:"hyenaFireField",animalId:id,time:5,damage:dmg,range,hit:new Set()});this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Fire",fxType:"hyenaFireField",x:a.x,y:a.y,r:a.r,stage:a.stage,range,life:5});this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"FIRE CIRCLE",color:"#ff6b35"});
    }
    else if(a.type==="caracal"){
      const pct=petAbilityStats(a).pct||.25;if(d<155){this.damagePercentRef(ref,pct,"animal",id);this.applyAbilityStun(ref,1.8);this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Lightning",fxType:"lightningStrike",x:a.x,y:a.y,fromX:a.x,fromY:a.y,targetX:target.x,targetY:target.y,r:a.r,stage:a.stage,life:.75});}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"LIGHTNING BITE",color:"#ffe14f"});
    }
    else if(a.type==="polarbear"){
      const dmg=petAbilityStats(a).damage||5;if(d<175){this.damageTarget(ref,dmg,"animal",id);const hitRef={kind:ref.kind,id:ref.id};setTimeout(()=>{if(this.abilityStatusAlive(hitRef))this.damageTarget(hitRef,dmg,"animal",id);},300);this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Ice",fxType:"iceClaws",x:a.x,y:a.y,targetX:target.x,targetY:target.y,r:a.r,stage:a.stage,range:Math.max(48,(target.r||18)*1.35),life:.9});}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"ICE CLAWS ×2",color:"#bcecff"});
    }
    else if(a.type==="arcticfox"){
      const dmg=petAbilityStats(a).damage||10;this.launchWildArcticShardVolley(id,a,{ref,obj:target},dmg);this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"ICE SHARDS ×3",color:"#bfeeff"});
    }
    else if(a.type==="walrus"){
      const dmg=petAbilityStats(a).damage||2;if(d<320){const stage=uploadedAnimalStageKey(a.stage),mul={baby:.72,adult:1,boss:1.2,superboss:1.45,bigmomma:1.75}[stage]||1,ring=Math.max((target.r||PLAYER_R)+34,62*mul),wallR=clamp(13*mul,11,27);for(let i=0;i<6;i++){const aa=i/6*TAU,wx=target.x+Math.cos(aa)*ring,wy=target.y+Math.sin(aa)*ring,wid=this.addWall(wx,wy,wallR,4,"",{hp:999,kind:"stoneSpike",spiked:true,spikeDmg:dmg,sourcePetId:""});this.hostileWildWalls.set(wid,id);}this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Stone",fxType:"earthRingBurst",x:a.x,y:a.y,targetX:target.x,targetY:target.y,r:a.r,stage:a.stage,range:ring+wallR,life:.8});}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"SPIKE PRISON",color:"#a9a9a2"});
    }
    else if(a.type==="queenbee"){const st=petAbilityStats(a),dmg=st.damage||16,dot=st.dot||14,range=Math.max(130,(a.r||18)*2.6),hits=this.wildAbilityTargetsAround(a.x,a.y,range);for(const h of hits){this.damageTarget(h.ref,dmg*.42,"animal",id);this.applyAbilityFixedDot(h.ref,dot,5,"","",id);}this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Poison",fxType:"beeSwarm",x:a.x,y:a.y,r:a.r,stage:a.stage,range,life:1.2,color:"#ffe27c"});this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"ROYAL SWARM",color:"#ffe27c"});}
    else if(a.type==="workerbee"){const st=petAbilityStats(a),dmg=st.damage||14,dot=st.dot||10;if(d<185){const aa=angTo(a.x,a.y,target.x,target.y),dash=Math.min(95,Math.max(24,d-Math.max(8,target.r||PLAYER_R))),ox=a.x,oy=a.y;a.x=clamp(a.x+Math.cos(aa)*dash,20,WORLD_W-20);a.y=clamp(a.y+Math.sin(aa)*dash,20,WORLD_H-20);this.resolveStatic(a,(a.r||18)*.68);if(animalAttackContact(a,ref,target,8)){this.damageTarget(ref,dmg,"animal",id);this.applyAbilityFixedDot(ref,dot,5,"","",id);}this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Poison",fxType:"pounce",x:a.x,y:a.y,fromX:ox,fromY:oy,targetX:a.x,targetY:a.y,angle:aa,r:a.r,stage:a.stage,life:.55,shockScale:.3});}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"POISON CHARGE",color:"#90de68"});}
    else if(a.type==="dronebee"){const dmg=petAbilityStats(a).damage||20;if(d<210){const aa=angTo(a.x,a.y,target.x,target.y),dash=Math.min(120,Math.max(40,d-Math.max(10,target.r||PLAYER_R))),ox=a.x,oy=a.y;a.x=clamp(a.x+Math.cos(aa)*dash,20,WORLD_W-20);a.y=clamp(a.y+Math.sin(aa)*dash,20,WORLD_H-20);this.resolveStatic(a,(a.r||18)*.68);if(animalAttackContact(a,ref,target,10))this.damageTarget(ref,dmg,"animal",id);this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Normal",fxType:"pounce",x:a.x,y:a.y,fromX:ox,fromY:oy,targetX:a.x,targetY:a.y,angle:aa,r:a.r,stage:a.stage,life:.6,shockScale:.42});}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"RAM",color:"#f3f3e8"});}
    else if(a.type==="muskox"){if(d<145){this.damageTarget(ref,18,"animal",id);this.pushWildAbilityTarget(ref,target,a.x,a.y,18);}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"GROUND BRACE",color:"#9c805c"});}
    else if(a.type==="snowyowl"){if(d<210)this.damageTarget(ref,14,"animal",id);this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"WHITEOUT FAN",color:"#ecfbff"});}
    else if(a.type==="mountaingoat"){if(d<125){this.damageTarget(ref,18,"animal",id);this.pushWildAbilityTarget(ref,target,a.x,a.y,72);}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"CLIFF KICK",color:"#b99c72"});}
    else if(a.type==="eagle"){if(d<260){this.damageTarget(ref,19,"animal",id);this.applyAbilityStun(ref,1.4);}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"THUNDER DIVE",color:"#ffe46f"});}
    else if(a.type==="cougar"){if(d<125){for(let i=0;i<3;i++)this.damageTarget(ref,7,"animal",id);}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"RAKE COMBO",color:"#d8b487"});}
    else if(a.type==="bighorn"){if(d<155){this.damageTarget(ref,18,"animal",id);this.pushWildAbilityTarget(ref,target,a.x,a.y,82);}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"HORN CHARGE",color:"#a88b69"});}
    else if(a.type==="marmot"){if(d<145){this.damageTarget(ref,11,"animal",id);this.applyAbilityStun(ref,1.8);}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"ALARM WHISTLE",color:"#f3d59b"});}
    else if(a.type==="jaguar"){if(d<120)this.damageTarget(ref,20,"animal",id);this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"SHADOW RAKE",color:"#7c5ba7"});}
    else if(a.type==="toucan"){if(d<200)this.damageTarget(ref,13,"animal",id);this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"BEAK CALL",color:"#f0b64a"});}
    else if(a.type==="tapir"){if(d<145){this.damageTarget(ref,17,"animal",id);this.pushWildAbilityTarget(ref,target,a.x,a.y,14);}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"MUD ROLL",color:"#8f704b"});}
    else if(a.type==="capybara"){if(d<140){this.damageTarget(ref,6,"animal",id);this.pushWildAbilityTarget(ref,target,a.x,a.y,20);}a.hp=clamp(a.hp+10,0,a.maxHp);this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"CALM CURRENT",color:"#6fcadd"});}
    else if(a.type==="anaconda"){if(d<130){this.damageTarget(ref,20,"animal",id);this.applyAbilitySlowWeak(ref,3.5,.28,.88);}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"CONSTRICT",color:"#72875b"});}
    else if(elem==="Stone"){
      const ws=dogWallStats(a.stage,a.level||1),wallR=25,wallDist=Math.max(45,(a.r||18)*.72+wallR+8),wx=a.x+Math.cos(a.angle)*wallDist,wy=a.y+Math.sin(a.angle)*wallDist;
      const wid=this.addWall(wx,wy,wallR,-1,"",{hp:ws.hp,kind:"stoneSpike",spiked:true,spikeDmg:ws.spikeDmg,sourcePetId:""});
      this.hostileWildWalls.set(wid,id);
      this.bounceAnimalsFromNewDogWall(wx,wy,wallR,"",id);
    }else if(elem==="Sound"&&d<100){this.damageTarget(ref,6,"animal",id);this.pushWildAbilityTarget(ref,target,a.x,a.y,22);}
    else if(elem==="Fire"&&d<85)this.damageTarget(ref,10,"animal",id);
    else if(elem==="Lightning"&&d<140)this.damageTarget(ref,11,"animal",id);
    else if(elem==="Ice"&&d<110)this.damageTarget(ref,9,"animal",id);
    else if(elem==="Water"&&d<120){const dmg=petAbilityStats(a).damage||10;if(this.damageTarget(ref,dmg,"animal",id))a.hp=clamp(a.hp+dmg*.50,0,a.maxHp);this.pullWildAbilityTarget(ref,target,a.x,a.y,42);}
    else if(elem==="Plant"&&d<100)this.damageTarget(ref,5,"animal",id);
    return true;
  }

  tryWildEatBerry(id,a,dt){
    if(!a||a.dead||a.sleeping||a.enraged||(a.combat||0)>0||this.animalAggro.has(id)||this.isWildBeeType(a.type))return false;
    if((Number(a._berryCooldownUntil)||0)>this.state.worldTime)return false;
    let bid=String(a._berryTargetId||""),b=bid?this.state.resources.get(bid):null;
    if(!b||!b.alive||b.type!=="bush"||dist(a.x,a.y,b.x,b.y)>430){bid="";b=null;for(const s of this.nearbySolids(a.x,a.y,320+(a.speed||60)*.8)){if(s.kind!=="resource")continue;const q=this.state.resources.get(s.id);if(!q||!q.alive||q.type!=="bush")continue;if(!b||dist(a.x,a.y,q.x,q.y)<dist(a.x,a.y,b.x,b.y)){b=q;bid=s.id;}}a._berryTargetId=bid;}
    if(!b)return false;const d=dist(a.x,a.y,b.x,b.y);if(d>(a.r||18)+(b.solidR||12)+8){smoothTurn(a,angTo(a.x,a.y,b.x,b.y),dt,3.6);this.moveCreatureSwept(a,(a.speed||60)*.48,dt);return true;}
    const bite=Math.max(.18,(b.maxHp||8)*.022);b.hp=Math.max(0,b.hp-bite);a.hp=Math.min(a.maxHp,a.hp+a.maxHp*.06);this.giveWildExp(id,a,3,"eat");a._berryCooldownUntil=this.state.worldTime+rand(11,20);a._berryTargetId="";this.broadcastEntityHealth("resource",bid,b);if(b.hp<=0){b.alive=false;this.resourceRespawns.set(bid,rand(12,22));}return true;
  }
  nearestWildlifeOpponent(selfId,a,range=230){
    let best=null,bestD=range;const babyHunter=a?.stage==="baby";
    const kinds=babyHunter?new Set(["animal"]):new Set(["enemy","animal"]);
    for(const rec of this.nearbyDynamic(a.x,a.y,range+90,kinds)){if(!rec||!rec.obj)continue;const o=rec.obj;
      if(rec.kind==="animal"){if(rec.id===selfId||o.dead||o.hp<=0||this.enemyOwnerByPet.has(rec.id))continue;if(babyHunter&&o.stage!=="baby")continue;if(!babyHunter&&o.stage==="baby")continue;if(!wildCanPreyOn(a.type,o.type))continue;}
      else if(rec.kind==="enemy"){if(babyHunter||o.dead||o.hp<=0)continue;}else continue;
      const d=dist(a.x,a.y,o.x,o.y);if(d<bestD){best={kind:rec.kind,id:rec.id,obj:o,d};bestD=d;}
    }return best;
  }
  touchingPlayerForAnimal(a,preferredId=""){
    if(preferredId){
      const p=this.state.players.get(preferredId);
      if(p&&animalAttackContact(a,{kind:"player",id:preferredId},p))return{kind:"player",id:preferredId,obj:p};
    }
    for(const[id,p]of this.state.players){
      if(animalAttackContact(a,{kind:"player",id},p))return{kind:"player",id,obj:p};
    }
    return null;
  }

  animalBiteVictim(a,preferredRef){
    // preferredRef may be player, pet, animal, or enemy. Wildlife-vs-wildlife
    // bites intentionally remain supported here.
    const preferred=this.targetObject(preferredRef);

    if(preferredRef?.kind==="player"&&preferred&&animalAttackContact(a,preferredRef,preferred)){
      return{ref:preferredRef,obj:preferred};
    }

    // A player physically in front of a pet-targeted animal can take the bite.
    for(const[id,p]of this.state.players){
      const ref={kind:"player",id};
      if(animalAttackContact(a,ref,p))return{ref,obj:p};
    }

    if(preferred&&animalAttackContact(a,preferredRef,preferred)){
      return{ref:preferredRef,obj:preferred};
    }

    return null;
  }

  animalAttackCooldown(a){
    return animalAttackCooldown(a.type,a.stage,false);
  }

  wildAttackConnects(a,ref,target){
    return !!(a&&ref&&target&&animalAttackContact(a,ref,target));
  }

  playerEscapingAnimal(player,a){
    if(!player||!a)return false;
    let mx=player.moveX||0,my=player.moveY||0;const ml=Math.hypot(mx,my);if(ml<.08)return false;
    mx/=ml;my/=ml;let ax=player.x-a.x,ay=player.y-a.y;const al=Math.hypot(ax,ay)||1;ax/=al;ay/=al;
    return mx*ax+my*ay>.02;
  }

  pushTargetWithAnimal(animalId,a,ref,target,moveDx,moveDy){
    if(!a||!ref||!target)return false;
    if(Math.hypot(moveDx,moveDy)<.001)return false;
    if(animalTargetOverlap(a,ref,target)<=0)return false;
    // Moving animal bodies never carry players. A player can be blocked when
    // they walk into an animal, but the animal's own movement cannot drag them.
    if(ref.kind==="player")return false;
    if(ref.kind==="pet"){
      if(target.dead)return false;
      target.x=clamp(target.x+moveDx,20,WORLD_W-20);
      target.y=clamp(target.y+moveDy,20,WORLD_H-20);
      this.resolveStatic(target,(target.r||18)*.72);
      return true;
    }
    return false;
  }

  carryEverythingTouchedByAnimal(animalId,a,moveDx,moveDy){
    if(!a||Math.hypot(moveDx,moveDy)<.001)return;
    // Players are intentionally excluded: wildlife cannot hook/carry a player.
    for(const[id,p]of this.state.pets){
      if(p.dead)continue;
      const ref={kind:"pet",id};
      if(animalTargetOverlap(a,ref,p)>0)this.pushTargetWithAnimal(animalId,a,ref,p,moveDx,moveDy);
    }
  }

  performAnimalBite(id,a,victim){
    if(!victim||a.atkCd>0)return false;
    const base=Math.max(1,(typeDmg(a.type,a.stage)||6)*((Number(a._abilityWeakUntil)||0)>this.state.worldTime?(Number(a._abilityWeakMul)||.68):1));
    const dmg=rand(base*.80,base*1.15);
    if(!this.damageTarget(victim.ref,dmg,"animal",id))return false;

    // IMPORTANT: animation means a REAL bite happened.
    a.atkCd=this.animalAttackCooldown(a);
    a.attackAnim=.18;
    a.flash=.07;
    a.combat=8;
    a.enraged=true;
    a.sleeping=false;

    if(victim.ref.kind==="player"){
      this.animalAggro.set(id,{kind:"player",id:victim.ref.id});
    }

    this.broadcastFx({
      kind:"hit",
      x:victim.obj.x,
      y:victim.obj.y-(victim.ref.kind==="player"?8:Math.max(8,(victim.obj.r||16)*.7)),
      text:Math.round(dmg),
      color:"#f2836a"
    });
    return true;
  }

  hasNearbyPlayerOrPet(x,y,range=1600){
    const r2=range*range;
    for(const [,p] of this.state.players){if(p&&!p.dead){const dx=p.x-x,dy=p.y-y;if(dx*dx+dy*dy<=r2)return true;}}
    for(const [,p] of this.state.pets){if(p&&!p.dead){const dx=p.x-x,dy=p.y-y;if(dx*dx+dy*dy<=r2)return true;}}
    return false;
  }

  updateEnemyGuardPet(id,a,enemyId,en,dt){
    if(!a||!en)return false;
    const rider=en.ridingPetId===id;
    a.sleeping=false;a.enraged=true;a.combat=Math.max(a.combat||0,2);
    const phase=TIME_PHASES[this.state.dayPhase];
    if(phase&&phase.safe){
      // Morning/daylight makes mounts and Tamer guards flee with their Hostl owner
      // instead of continuing to fight while the cube is trying to escape.
      const edge=angTo(WORLD_W/2,WORLD_H/2,a.x,a.y);smoothTurn(a,edge,dt,10.5);
      const bx=a.x,by=a.y;a.x+=Math.cos(a.angle)*(a.speed||60)*1.42*dt;a.y+=Math.sin(a.angle)*(a.speed||60)*1.42*dt;
      a.x=clamp(a.x,20,WORLD_W-20);a.y=clamp(a.y,20,WORLD_H-20);this.resolveStatic(a,(a.r||18)*.68);this.carryEverythingTouchedByAnimal(id,a,a.x-bx,a.y-by);
      if(rider){en.x=a.x;en.y=a.y;en.angle=a.angle;}
      return true;
    }
    let ref=this.animalAggro.get(id)||null,target=this.targetObject(ref);
    if(ref&&(!target||(ref.kind==="player"?(target.dead||target.health<=0):(target.dead||target.hp<=0)))){this.animalAggro.delete(id);ref=null;target=null;}
    if(!target){const near=this.nearestPlayerOrPet(a.x,a.y,rider?330:250);if(near){ref={kind:near.kind,id:near.id};target=near.obj;this.animalAggro.set(id,ref);}}
    if(target){
      const face=angTo(a.x,a.y,target.x,target.y);smoothTurn(a,face,dt,rider?8.2:7.4);
      const step=(a.speed||60)*(rider?1.18:1.10);const bx=a.x,by=a.y;
      a.x+=Math.cos(a.angle)*step*dt;a.y+=Math.sin(a.angle)*step*dt;this.resolveStatic(a,(a.r||18)*.68);
      const victim=this.animalBiteVictim(a,ref);if(victim&&a.atkCd<=0)this.performAnimalBite(id,a,victim);
      if(!rider&&dist(a.x,a.y,en.x,en.y)>540&&!a.tameFailedAggro)this.animalAggro.delete(id);
      this.carryEverythingTouchedByAnimal(id,a,a.x-bx,a.y-by);
    }else if(rider){
      a.wanderT=(a.wanderT||0)-dt;
      if(a.wanderT<=0){a.wanderA=rand(0,TAU);a.wanderT=rand(1.1,2.6);}
      smoothTurn(a,a.wanderA,dt,4.2);const bx=a.x,by=a.y;
      a.x+=Math.cos(a.angle)*(a.speed||60)*.42*dt;a.y+=Math.sin(a.angle)*(a.speed||60)*.42*dt;this.resolveStatic(a,(a.r||18)*.68);
      this.carryEverythingTouchedByAnimal(id,a,a.x-bx,a.y-by);
    }else{
      const d=dist(a.x,a.y,en.x,en.y);
      const standOff=en.r+Math.max(18,(a.r||18)*.72)+18;
      if(d>standOff+8){const face=angTo(a.x,a.y,en.x,en.y);smoothTurn(a,face,dt,6.2);const mul=d>210?1.56:d>125?1.30:.94;const bx=a.x,by=a.y;a.x+=Math.cos(a.angle)*(a.speed||60)*mul*dt;a.y+=Math.sin(a.angle)*(a.speed||60)*mul*dt;this.resolveStatic(a,(a.r||18)*.68);this.carryEverythingTouchedByAnimal(id,a,a.x-bx,a.y-by);}
      else if(d<standOff){const away=angTo(en.x,en.y,a.x,a.y);const push=standOff-d+1;a.x+=Math.cos(away)*push;a.y+=Math.sin(away)*push;this.resolveStatic(a,(a.r||18)*.68);}
      else a.angle+=dt*.28;
    }
    a.x=clamp(a.x,20,WORLD_W-20);a.y=clamp(a.y,20,WORLD_H-20);
    if(rider){en.x=a.x;en.y=a.y;en.angle=a.angle;}
    return true;
  }

  wildBreedingBabyCount(a,b){const lvl=Math.max(1,Number(a?.level)||1,Number(b?.level)||1),order=["baby","adult","boss","superboss","bigmomma"],stageBonus=Math.max(order.indexOf(a?.stage),order.indexOf(b?.stage));return clamp(1+Math.floor((lvl-1)/2)+(stageBonus>=3?1:0),1,3);}

  startWildMorningBreeding(){
    const day=this.state.dayCount;
    const eligible=[];
    for(const[id,a]of this.state.animals){
      if(!a||a.hp<=0||a.stage==="baby"||this.enemyOwnerByPet.has(id)||a.enraged||a.tameFailedAggro||a.desperateAggro)continue;
      if((this.wildLastBreedDay.get(id)||-1)===day)continue;
      eligible.push({id,a});
    }
    for(let i=eligible.length-1;i>0;i--){const j=randi(0,i),t=eligible[i];eligible[i]=eligible[j];eligible[j]=t;}
    const used=new Set();let pairs=0;
    for(const rec of eligible){
      if(pairs>=12||used.has(rec.id)||Math.random()>.46)continue;
      let mate=null,bestD=900;
      for(const other of eligible){
        if(other.id===rec.id||used.has(other.id)||other.a.type!==rec.a.type||other.a.gender===rec.a.gender)continue;
        const d=dist(rec.a.x,rec.a.y,other.a.x,other.a.y);if(d<bestD){bestD=d;mate=other;}
      }
      if(!mate)continue;
      this.wildMateTargets.set(rec.id,mate.id);this.wildMateTargets.set(mate.id,rec.id);
      rec.a.sleeping=false;mate.a.sleeping=false;used.add(rec.id);used.add(mate.id);pairs++;
    }
  }

  clearWildMate(id){
    const mateId=this.wildMateTargets.get(id);this.wildMateTargets.delete(id);
    if(mateId&&this.wildMateTargets.get(mateId)===id)this.wildMateTargets.delete(mateId);
  }

  spawnQueenBeeBrood(id,mom){ if(!mom||mom.dead||mom.type!=="queenbee"||mom.stage!=="bigmomma") return null; const roll=Math.random(); const babyType=roll<.66?"dronebee":roll<.94?"workerbee":"queenbee"; const babyId=this.addAnimal(babyType,"baby",mom.x+rand(-28,28),mom.y+rand(-24,24),{sleeping:false,gender:canonicalAnimalGender(babyType),motherId:id,bredChild:true}); const baby=this.state.animals.get(babyId); if(!baby)return null; baby.combat=0; baby.wanderT=rand(.8,2.4); baby.wanderA=rand(0,TAU); this.setBeeHomeForAnimal(baby,mom._beeHomeId||""); this.broadcastFx({kind:"familyBirth",x:mom.x,y:mom.y}); return baby; }

  updateWildMating(id,a,dt){
    const mateId=this.wildMateTargets.get(id);if(!mateId)return false;
    const phase=TIME_PHASES[this.state.dayPhase],mate=this.state.animals.get(mateId);
    if(!phase||phase.name!=="Morning"||!mate||mate.hp<=0||mate.type!==a.type||mate.gender===a.gender){this.clearWildMate(id);return false;}
    a.sleeping=false;const face=angTo(a.x,a.y,mate.x,mate.y);smoothTurn(a,face,dt,4.0);
    this.moveCreatureSwept(a,(a.speed||60)*.78,dt);
    const touchD=Math.max(14,(a.r||18)*.42+(mate.r||18)*.42);
    if(dist(a.x,a.y,mate.x,mate.y)<=touchD){
      const female=a.gender==="Female"?a:(mate.gender==="Female"?mate:null),male=a.gender==="Male"?a:(mate.gender==="Male"?mate:null);
      if(female&&male){
        const mx=(female.x+male.x)*.5,my=(female.y+male.y)*.5,babyCount=this.wildBreedingBabyCount(female,male);
        this.wildLastBreedDay.set(id,this.state.dayCount);this.wildLastBreedDay.set(mateId,this.state.dayCount);
        const outerId=a._outerIslandId||mate._outerIslandId||"";
        const outerSpec=outerId?outerIslandById(outerId):null;
        for(let n=0;n<babyCount;n++){
          let bx=clamp(mx+rand(-24,24),24,WORLD_W-24),by=clamp(my+rand(-24,24),24,WORLD_H-24);
          if(outerSpec){const fixed=outerIslandConstrainedPoint(outerSpec,bx,by,30);bx=fixed.x;by=fixed.y;}
          const babyId=this.addAnimal(a.type,"baby",bx,by,{gender:canonicalAnimalGender(a.type),motherId:a.gender==="Female"?id:mateId,fatherId:a.gender==="Male"?id:mateId,bredChild:true,sleeping:false});
          const baby=this.state.animals.get(babyId);if(baby){if(outerId)baby._outerIslandId=outerId;this.broadcastFx({kind:"familyBirth",x:baby.x,y:baby.y});this.broadcastFx({kind:"hit",x:baby.x,y:baby.y,text:`Baby ${PET_TYPES[a.type]?.name||a.type}!`,color:"#ffd9e6"});}
        }
      }
      this.clearWildMate(id);
    }
    return true;
  }

  updateAnimals(dt){
    this.updateHiveBeeSpawners(dt);
    // Multiplayer adaptation of the offline wildlife loop. The target selection
    // uses the nearest living player because online can have several players,
    // but the movement speeds, ranges, flee rules, bite contact and ability
    // timing intentionally match the offline rules.
    for(const[id,a]of this.state.animals){const _alwaysMoveX=a.x,_alwaysMoveY=a.y;
      if(!a||a.hp<=0)continue;
      const forcedActive=this.enemyOwnerByPet.has(id)||this.animalAggro.has(id)||this.wildMateTargets.has(id)||a.tameFailedAggro||a.desperateAggro||(a.recentHit||0)>0;
      if(!forcedActive&&!this.hasNearbyPlayerOrPet(a.x,a.y,1250))continue;
      if(this.keepWildInHomeBiome(id,a,dt))continue;
      const moveStartX=a.x,moveStartY=a.y;

      a.flash=Math.max(0,(a.flash||0)-dt);
      a.atkCd=Math.max(0,(a.atkCd||0)-dt);
      a.abilityCd=Math.max(0,(a.abilityCd||0)-dt);
      a.combat=Math.max(0,(a.combat||0)-dt);
      a.recentHit=Math.max(0,(a.recentHit||0)-dt);
      a.attackAnim=Math.max(0,(a.attackAnim||0)-dt);
      a.tailPhase=(a.tailPhase||0)+dt*(2.2+(a.speed||60)*.02);
      if(!a.sleeping)this.moveCreatureSwept(a,Math.max(5,(Number(a.speed)||60)*.06),dt);
      if((Number(a._abilityStunUntil)||0)>this.state.worldTime){a.attackAnim=0;this.resolveStatic(a,(a.r||18)*.68);continue;}

      const enemyOwnerId=this.enemyOwnerByPet.get(id);
      if(enemyOwnerId){
        const ownerEnemy=this.state.enemies.get(enemyOwnerId);
        if(!ownerEnemy){
          this.enemyOwnerByPet.delete(id);this.enemyPetByEnemy.delete(enemyOwnerId);
          this.state.animals.delete(id);this.animalAggro.delete(id);this.animalFleeFrom.delete(id);continue;
        }
        this.updateEnemyGuardPet(id,a,enemyOwnerId,ownerEnemy,dt);
        continue;
      }

      if(a.recentHit<=0&&a.hp<a.maxHp)a.hp=Math.min(a.maxHp,a.hp+Math.max(.8,a.maxHp*.018)*dt);

      if(this.wildAttackBlockingResource(id,a)){this.resolveStatic(a,(a.r||18)*.68);continue;}
      if(this.tryWildEatBerry(id,a,dt)){this.resolveStatic(a,(a.r||18)*.68);continue;}

      if(this.updateWildMating(id,a,dt)){a.x=clamp(a.x,20,WORLD_W-20);a.y=clamp(a.y,20,WORLD_H-20);this.resolveStatic(a,(a.r||18)*.68);if(!a.sleeping&&!a.dead&&dist(_alwaysMoveX,_alwaysMoveY,a.x,a.y)<.10){this.moveCreatureSwept(a,Math.max(14,(Number(a.speed)||60)*.24),dt);this.resolveStatic(a,(a.r||18)*.68);}continue;}
      // Hive bee reproduction is handled by the 5-minute hatch cycle and the every-10-nights queen/drone brood event.

      const info=PET_TYPES[a.type]||{};
      const lowHealthFight=!!info.flee&&a.hp>0&&a.maxHp>0&&a.hp/a.maxHp<=.32;
      if(lowHealthFight){
        a.desperateAggro=true;
        if(!this.animalAggro.has(id)){
          const fleeRef=this.animalFleeFrom.get(id);
          if(fleeRef&&this.targetObject(fleeRef))this.animalAggro.set(id,fleeRef);
        }
      }
      if(a.tameFailedAggro||a.desperateAggro){a.enraged=true;a.sleeping=false;a.fleeUntil=0;this.animalFleeFrom.delete(id);}

      let ref=this.animalAggro.get(id)||null;
      let target=this.targetObject(ref);
      if(ref&&(!target||(ref.kind==="player"?(target.dead||target.health<=0):(target.dead||target.hp<=0)))){
        this.animalAggro.delete(id);a._abilityFightKey="";ref=null;target=null;
      }
      if(ref&&target&&dist(a.x,a.y,target.x,target.y)>wildAggroForgetRange(a)){
        const forgotPlayer=ref.kind==="player"||ref.kind==="pet";
        this.animalAggro.delete(id);a._abilityFightKey="";ref=null;target=null;a.combat=0;
        if(forgotPlayer){a.tameFailedAggro=false;if(!a.desperateAggro)a.enraged=false;}
      }

      if(ref&&target&&this.droneBeeShouldFlee(a)){this.animalAggro.delete(id);this.animalFleeFrom.set(id,ref);a.fleeUntil=Math.max(a.fleeUntil||0,this.state.worldTime+5.5);a.enraged=false;a.desperateAggro=false;a._abilityFightKey="";ref=null;target=null;}

      // Same periodic wildlife-vs-wildlife / hostile-cube fight scan as offline.
      a.wildFightScan=(a.wildFightScan||0)-dt;
      if(!ref&&!this.snakeFluteCalmActive(a)&&a.wildFightScan<=0){
        a.wildFightScan=rand(.30,.65);
        const naturallyAggressive=!info.friendly&&a.type!=="fox"&&!this.isNeutralBeeType(a.type);
        const babyPredator=a.stage==="baby"&&!this.isNeutralBeeType(a.type)&&(WILD_PREY[a.type]?.size||0)>0;
        if(babyPredator||naturallyAggressive||a.enraged||a.desperateAggro||a.tameFailedAggro){
          const foe=this.nearestWildlifeOpponent(id,a,230);
          if(foe){
            ref={kind:foe.kind,id:foe.id};target=foe.obj;
            this.animalAggro.set(id,ref);a.sleeping=false;a.enraged=true;a.combat=Math.max(a.combat||0,6);
          }
        }
      }

      if(ref&&target){
        const fightKey=`${ref.kind}:${ref.id}`;
        if(a.stage!=="baby"&&a._abilityFightKey!==fightKey&&dist(a.x,a.y,target.x,target.y)<220){a._abilityFightKey=fightKey;a.abilityCd=0;this.wildUseAbility(id,a,ref,target);}
        // Exact offline hostileTarget behavior: always keep moving toward the
        // locked target; bite only when the visible head reaches it.
        a.sleeping=false;a.enraged=true;a.combat=Math.max(a.combat||0,2);
        const face=angTo(a.x,a.y,target.x,target.y);
        smoothTurn(a,face,dt,5.0);
        this.moveCreatureSwept(a,(a.speed||60)*1.05,dt);
        if(this.wildAttackConnects(a,ref,target)&&a.atkCd<=0)this.performAnimalBite(id,a,{ref,obj:target});
        if(a.stage!=="baby"&&a.abilityCd<=0&&dist(a.x,a.y,target.x,target.y)<220)this.wildUseAbility(id,a,ref,target);
      }else{
        const nearestPlayer=this.nearestPlayer(a.x,a.y,Infinity);
        const dPlayer=nearestPlayer?nearestPlayer.d:Infinity;
        const playerRef=nearestPlayer?{kind:"player",id:nearestPlayer.id}:null;
        const playerObj=nearestPlayer?.obj||null;
        if((a.combat||0)<=0&&(!playerObj||dPlayer>620))a._abilityFightKey="";
        const isFriendly=!!info.friendly;
        const skittishType=!!info.flee;
        const babyAlwaysFlees=a.stage==="baby"&&!this.isWildBeeType(a.type);

        // Boss-tier reset/sleep range matches offline when there is no explicit
        // attacker lock.
        if(["boss","superboss","bigmomma"].includes(a.stage)&&a.enraged&&dPlayer>wildAggroForgetRange(a)){
          a.enraged=false;a.combat=0;a.recentHit=0;a._stayAwakeUntil=0;a.sleeping=true;a.hp=Math.min(a.maxHp,a.hp+15);
        }

        // Never let a stale sleep flag pause an active fight or flee. Fresh
        // aggro/hits and the short post-flee wake window always win over sleep.
        if(a.sleeping&&!this.wildCanSleepNow(id,a))a.sleeping=false;
        if(!a.sleeping){
          // Hit-triggered flee remembers the actual attacker, just like offline.
          if(!a.tameFailedAggro&&!a.desperateAggro&&a.fleeUntil&&this.state.worldTime<a.fleeUntil){
            let fleeRef=this.animalFleeFrom.get(id)||playerRef;
            let fleeObj=this.targetObject(fleeRef)||playerObj;
            if(fleeObj){
              const fleeA=angTo(fleeObj.x,fleeObj.y,a.x,a.y);a.wanderA=fleeA;smoothTurn(a,fleeA,dt,4.5);
              this.moveCreatureSwept(a,(a.speed||60)*1.15,dt);
            }
          }else{
            if(a.fleeUntil&&this.state.worldTime>=a.fleeUntil){a.fleeUntil=0;this.animalFleeFrom.delete(id);}

            // Babies naturally run only from players in proximity. Pets only
            // become a flee source after they actually attack the animal.
            const ambientFlee=!a.enraged&&!a.tameFailedAggro&&!a.desperateAggro&&playerObj&&babyAlwaysFlees&&dPlayer<185;
            if(ambientFlee){
              a.sleeping=false;this.animalFleeFrom.set(id,playerRef);a.fleeUntil=Math.max(a.fleeUntil||0,this.state.worldTime+.55);this.markWildStayAwake(a,3.1);
              const fleeA=angTo(playerObj.x,playerObj.y,a.x,a.y);a.wanderA=fleeA;smoothTurn(a,fleeA,dt,4.5);
              this.moveCreatureSwept(a,(a.speed||60)*1.24,dt);
            }else{
              const neutralBeeCalm=this.isNeutralBeeType(a.type)&&!a.enraged&&!a.tameFailedAggro&&!a.desperateAggro&&!this.animalAggro.has(id);
              const fluteSnakeCalm=this.snakeFluteCalmActive(a);
              if(fluteSnakeCalm){a.enraged=false;a.tameFailedAggro=false;a.desperateAggro=false;a.combat=0;a.fleeUntil=0;this.animalAggro.delete(id);this.animalFleeFrom.delete(id);}
              const isHostile=!fluteSnakeCalm&&!neutralBeeCalm&&(a.enraged||(!isFriendly&&!babyAlwaysFlees)||
                (["boss","superboss","bigmomma"].includes(a.stage)&&!skittishType&&!babyAlwaysFlees&&a.type!=="fox"&&!this.isNeutralBeeType(a.type)));
              const aggroRange=wildPlayerAggroRange(a),forgetRange=wildAggroForgetRange(a);
              if(playerObj&&dPlayer>forgetRange&&(a.enraged||a.tameFailedAggro)&&!a.desperateAggro){
                a.enraged=false;a.tameFailedAggro=false;a.combat=0;a._abilityFightKey="";
              }

              const calmWanderRadius=PLAYER_R+Math.max(14,(Number(a.r)||18)*.82)+34;
              if(!isHostile&&playerObj&&dPlayer<calmWanderRadius){
                a.wanderT=(a.wanderT||0)-dt;
                if(a.wanderT<=0||!Number.isFinite(a._nearPlayerWanderSide)){
                  if(!Number.isFinite(a._nearPlayerWanderSide))a._nearPlayerWanderSide=Math.random()<.5?-1:1;
                  if(Math.random()<.22)a._nearPlayerWanderSide*=-1;
                  const awayA=angTo(playerObj.x,playerObj.y,a.x,a.y);
                  const tooClose=dPlayer<PLAYER_R+Math.max(10,(Number(a.r)||18)*.62)+10;
                  a.wanderA=tooClose?awayA+rand(-.34,.34):awayA+a._nearPlayerWanderSide*rand(.72,1.20);
                  a.wanderT=rand(.55,1.35);
                }
                smoothTurn(a,a.wanderA||0,dt,3.9);this.moveCreatureSwept(a,(a.speed||60)*.46,dt);
              }else if(isHostile&&playerObj&&dPlayer<aggroRange){
                if(a.type==="clouded"&&playerRef&&!this.animalAggro.has(id))this.animalAggro.set(id,{kind:"player",id:playerRef.id});
                const playerFightKey=`player:${playerRef?.id||""}`;
                if(a.stage!=="baby"&&a._abilityFightKey!==playerFightKey&&dPlayer<150){a._abilityFightKey=playerFightKey;a.abilityCd=0;this.wildUseAbility(id,a,playerRef,playerObj);}
                const moveA=angTo(a.x,a.y,playerObj.x,playerObj.y);smoothTurn(a,moveA,dt,4.8);
                this.moveCreatureSwept(a,(a.speed||60)*.90,dt);
                if(this.wildAttackConnects(a,playerRef,playerObj)&&a.atkCd<=0)this.performAnimalBite(id,a,{ref:playerRef,obj:playerObj});
                // Adult wildlife deliberately uses its species power during combat.
                // Wild babies never cast; tamed baby pets still can.
                if(a.stage!=="baby"&&a.abilityCd<=0&&dist(a.x,a.y,playerObj.x,playerObj.y)<220)this.wildUseAbility(id,a,playerRef,playerObj);
              }else if(!isHostile&&isFriendly&&playerObj&&dPlayer<300&&dPlayer>45){
                a.wanderT=(a.wanderT||0)-dt;
                if(a.wanderT<=0){
                  const orbit=rand(90,200),ang=rand(0,TAU);
                  a.wanderA=angTo(a.x,a.y,playerObj.x+Math.cos(ang)*orbit,playerObj.y+Math.sin(ang)*orbit);
                  a.wanderT=rand(.9,2.2);
                }
                smoothTurn(a,a.wanderA||0,dt,3.8);this.moveCreatureSwept(a,(a.speed||60)*.55,dt);
              }else if(isHostile&&(a.tameFailedAggro||a.desperateAggro)&&playerObj&&dPlayer<forgetRange){
                const moveA=angTo(a.x,a.y,playerObj.x,playerObj.y);smoothTurn(a,moveA,dt,4.1);
                this.moveCreatureSwept(a,(a.speed||60)*(a.tameFailedAggro?.92:.82),dt);
              }else if(this.isWildBeeType(a.type)&&this.updateBeeHomeBehavior(id,a,dt)){
                // Giant hive wildlife gathers around its hive while calm.
              }else{
                a.wanderT=(a.wanderT||0)-dt;
                if(a.wanderT<=0){
                  a.wanderA=rand(0,TAU);a.wanderT=rand(1.2,3.2);
                  if(this.wildCanSleepNow(id,a)&&Math.random()<beeNapChance(a.type,a.stage,!!a.enraged))a.sleeping=true;
                }
                smoothTurn(a,a.wanderA||0,dt,3.6);this.moveCreatureSwept(a,(a.speed||60)*.50,dt);
              }
            }
          }
        }
      }

      a.x=clamp(a.x,20,WORLD_W-20);a.y=clamp(a.y,20,WORLD_H-20);
      this.resolveStatic(a,(a.r||18)*.68);
      if(!a.sleeping&&!a.dead&&a.hp>0&&dist(_alwaysMoveX,_alwaysMoveY,a.x,a.y)<.10){
        this.moveCreatureSwept(a,Math.max(14,(Number(a.speed)||60)*.24),dt);
        this.resolveStatic(a,(a.r||18)*.68);
      }
      this.carryEverythingTouchedByAnimal(id,a,a.x-moveStartX,a.y-moveStartY);
    }
  }

  applyPlayerCreaturePushes(){
    const kinds=new Set(["animal","pet"]);
    const pushOne=(player,obj,isPet=false,playerId="",objId="")=>{
      if(!obj||obj.dead)return;
      // A ridden mount is already the player's collision body.
      if(player.ridingPetId&&isPet&&player.ridingPetId===objId)return;
      let hit=null,bestOverlap=0;
      for(const h of animalPhysicalCircles(obj)){
        const d=dist(player.x,player.y,h.x,h.y),overlap=PLAYER_R*.82+h.r-d;
        if(overlap>bestOverlap){bestOverlap=overlap;hit={h,d,overlap};}
      }
      if(!hit||hit.d<=.1||hit.overlap<=0)return;

      const nx=(player.x-hit.h.x)/hit.d,ny=(player.y-hit.h.y)/hit.d;
      let mx=player.moveX||0,my=player.moveY||0,ml=Math.hypot(mx,my);
      if(ml>.05){mx/=ml;my/=ml;}else{mx=0;my=0;}
      const movingInto=ml>.05&&(mx*(-nx)+my*(-ny))>.02;
      const correction=Math.min(hit.overlap+.04,2.15+Math.sqrt(Math.max(0,hit.overlap))*.68);

      const mobility=animalPushMobility(obj);
      let animalShare=Math.max(.18,Math.min(.72,.18+mobility*.62));
      const ownPet=isPet&&obj.ownerId===playerId;
      if(ownPet)animalShare=Math.min(.80,animalShare+.10);
      if(movingInto)animalShare=Math.min(.82,animalShare+.08);
      const playerShare=1-animalShare;

      const oldPX=player.x,oldPY=player.y;
      player.x=clamp(player.x+nx*correction*playerShare,PLAYER_R,WORLD_W-PLAYER_R);
      player.y=clamp(player.y+ny*correction*playerShare,PLAYER_R,WORLD_H-PLAYER_R);
      obj.x=clamp(obj.x-nx*correction*animalShare,20,WORLD_W-20);
      obj.y=clamp(obj.y-ny*correction*animalShare,20,WORLD_H-20);
      this.resolveStatic(obj,(obj.r||18)*(isPet?.72:.68));
      this.resolveStatic(player,PLAYER_R*.82);

      if(playerId){
        const dx=player.x-oldPX,dy=player.y-oldPY;
        if(Math.hypot(dx,dy)>.001)this.queueAnimalPush(playerId,{animalId:objId||"",dx,dy,x:player.x,y:player.y});
      }
    };

    for(const[id,p]of this.state.players){
      if(p.dead||!this.isPlayerCombatReady(id))continue;
      const mount=p.ridingPetId?this.state.pets.get(p.ridingPetId):null;
      if(mount&&!mount.dead){p.x=mount.x;p.y=mount.y;continue;}
      for(const rec of this.nearbyDynamic(p.x,p.y,180,kinds)){
        const obj=rec.obj;if(!obj)continue;
        if(rec.kind==="pet"&&p.ridingPetId===rec.id)continue;
        const rr=(obj.r||18)*2.35+PLAYER_R+46,dx=p.x-obj.x,dy=p.y-obj.y;if(dx*dx+dy*dy>rr*rr)continue;
        pushOne(p,obj,rec.kind==="pet",id,rec.id);
      }
    }
  }

  broadcastSpectateKill(victimKind,victimId,killerKind,killerId){
    victimKind=String(victimKind||"");victimId=String(victimId||"");
    killerKind=String(killerKind||"");killerId=String(killerId||"");
    if(!victimId||!killerId)return;
    this.broadcast("spectateKill",{victimKind,victimId,killerKind,killerId});
  }

  broadcastEntityHealth(kind,id,obj){
    if(!kind||!id||!obj)return;
    const hp=kind==="player"?Number(obj.health):Number(obj.hp);
    const maxHp=kind==="player"?Number(obj.maxHealth):Number(obj.maxHp);
    this.broadcast("entityHealth",{kind:String(kind),id:String(id),hp:Math.max(0,Number.isFinite(hp)?hp:0),maxHp:Math.max(1,Number.isFinite(maxHp)?maxHp:1),dead:!!obj.dead,serverTime:Number(this.state.worldTime)||0});
  }

  damageTarget(ref,dmg,attackerKind="world",attackerId=""){
    const obj=this.targetObject(ref);if(!obj)return false;
    if(ref.kind==="player"&&!this.isPlayerCombatReady(ref.id))return false;
    if(ref.kind==="pet"&&obj.ownerId&&!this.isPlayerCombatReady(obj.ownerId))return false;
    if(ref.kind==="player"){
      if(obj.dead)return false;
      if(this.playerHiveSessions?.has(ref.id) && String(attackerKind)!=="hiveBee") return false;
      const raw=Math.max(0,Number(dmg)||0);if(raw<=0)return false;
      if(attackerId&&attackerId!==ref.id&&["player","playerProjectile","projectile"].includes(String(attackerKind))&&this.state.players.has(String(attackerId)))this.addSkillXp(String(attackerId),1);
      // While riding, the mount is the rider's body and takes the entire hit first.
      // A killing blow can knock the rider off, but the same hit never spills into
      // rider health; only a later hit can hurt the now-dismounted player.
      if(obj.ridingPetId){
        const mountId=obj.ridingPetId;
        const mount=this.state.pets.get(mountId);
        if(mount&&!mount.dead&&mount.ownerId===ref.id){
          const saddle=clamp(Math.floor(Number(obj.saddleTier)||0),0,3),sv=String(obj.saddleVariant||""),saddleDefense=saddle>=3&&sv==="diamond"?.60:saddle>=2?.82:saddle>=1?.90:1;const mountAmount=animalDamageTaken(mount.type,mount.stage,raw)*petUpgradeMultiplier(mount,"defense")*petArmorDefenseMul(mount)*saddleDefense;
          if(mountAmount>0){
            mount.hp=Math.max(0,mount.hp-mountAmount);mount.flash=.15;mount.combat=6;
            if(mount.hp<=0){mount.hp=0;mount.dead=true;obj.ridingPetId="";this.broadcastSpectateKill("pet",mountId,attackerKind,attackerId);this.petDeathTimers.set(mountId,3);}
            if(attackerId&&!mount.dead){
              let threat=null;if(this.state.animals.has(attackerId))threat={kind:"animal",id:attackerId};else if(this.state.enemies.has(attackerId))threat={kind:"enemy",id:attackerId};
              if(threat)this.ownerThreat.set(ref.id,{...threat,until:this.state.worldTime+7});
            }
            return true;
          }
        }else obj.ridingPetId="";
      }
      const amount=raw*this.runPerks(ref.id).defenseMul;if(amount<=0)return false;
      obj.health=Math.max(0,obj.health-amount);if(obj.health<=0){
        obj.health=0;obj.dead=true;obj.ridingPetId="";obj.vehicleType="";obj.vehicleTier=0;obj.vehicleVariant="";this.playerHiveSessions?.delete(ref.id);this.firstLightReadyPlayers.delete(ref.id);this.playerSurvivalSeconds.set(ref.id,0);this.playerSurvivalAwards.set(ref.id,new Set());this.playerNightSeen.delete(ref.id);this.recordAccountAchievement(ref.id,"first_death",{});this.broadcastSpectateKill("player",ref.id,attackerKind,attackerId);
        let killerSessionId="";
        if (["player","playerProjectile","projectile"].includes(String(attackerKind)) && this.state.players.has(String(attackerId))) killerSessionId=String(attackerId);
        else if (String(attackerKind)==="pet") { const kp=this.state.pets.get(String(attackerId)); if(kp?.ownerId) killerSessionId=String(kp.ownerId); }
        if (killerSessionId && killerSessionId!==ref.id) {
          const killer=this.state.players.get(killerSessionId); if(killer) killer.kills=Math.max(0,(killer.kills||0)+1);
          if (Number(obj.testerRank)===1) {
            const killerAccountId=this.playerAccountIds?.get(killerSessionId)||"";
            const c=this.clientById(killerSessionId);
            if (killerAccountId && c) {
              Promise.resolve(HOSTL_ACCOUNT_HOOKS.rewardTesterKill(killerAccountId)).then(result=>{
                if(result?.granted) c.send("testerKillReward",{...result,victimName:obj.username||"Tester",testerRank:1});
                else if(result?.account) c.send("testerKillReward",{...result,victimName:obj.username||"Tester",testerRank:1});
              }).catch(()=>{});
            }
            this.broadcast("testerDown",{victimName:obj.username||"Tester",killerName:killer?.username||"Player",testerRank:1});
          }
          if (Number(obj.ownerRank)===1) {
            const killerAccountId=this.playerAccountIds?.get(killerSessionId)||"";
            const c=this.clientById(killerSessionId);
            if (killerAccountId && c) {
              Promise.resolve(HOSTL_ACCOUNT_HOOKS.rewardOwnerKill(killerAccountId)).then(result=>{
                if(result?.granted) c.send("ownerKillReward",{...result,victimName:obj.username||"Owner",ownerRank:1});
                else if(result?.account) c.send("ownerKillReward",{...result,victimName:obj.username||"Owner",ownerRank:1});
              }).catch(()=>{});
            }
            this.broadcast("ownerDown",{victimName:obj.username||"Owner",killerName:killer?.username||"Player",ownerRank:1});
          }
        }
      }
      if(attackerId&&!obj.dead){
        let threat=null;
        if(this.state.animals.has(attackerId))threat={kind:"animal",id:attackerId};
        else if(this.state.enemies.has(attackerId))threat={kind:"enemy",id:attackerId};
        if(threat)this.ownerThreat.set(ref.id,{...threat,until:this.state.worldTime+7});
      }
      const hit={dmg:amount,health:obj.health,maxHealth:obj.maxHealth,dead:obj.dead,attackerKind,attackerId};
      if(obj.dead){const c=this.clientById(ref.id);if(c)c.send("playerHit",hit);this.pendingPlayerHits.delete(ref.id);}
      else this.queuePlayerHit(ref.id,hit);
      return true;
    }
    if(ref.kind==="pet"){if(obj.dead)return false;const amount=animalDamageTaken(obj.type,obj.stage,Math.max(0,Number(dmg)||0))*petUpgradeMultiplier(obj,"defense")*petArmorDefenseMul(obj);if(amount<=0)return false;obj.hp=Math.max(0,obj.hp-amount);obj.flash=.15;obj.combat=6;this.broadcastEntityHealth("pet",ref.id,obj);if(attackerId&&!obj.dead){let threat=null;if(this.state.animals.has(attackerId))threat={kind:"animal",id:attackerId};else if(this.state.enemies.has(attackerId))threat={kind:"enemy",id:attackerId};if(threat&&obj.ownerId)this.ownerThreat.set(obj.ownerId,{...threat,until:this.state.worldTime+7});}if(obj.hp<=0){obj.dead=true;this.broadcastSpectateKill("pet",ref.id,attackerKind,attackerId);this.petDeathTimers.set(ref.id,3);}return true;}
    if(ref.kind==="animal"){
      // Wild animals only damage other wild animals that are normal prey.
      if(attackerKind==="animal"&&attackerId&&this.state.animals.has(attackerId)){
        const attacker=this.state.animals.get(attackerId);
        if(attacker&&attacker.type&&!wildCanPreyOn(attacker.type,obj.type))return false;
      }
      // Multiplayer animal bites route here through performAnimalBite().
      if(obj.dead||obj.hp<=0)return false;
      const raw=Math.max(0,Number(dmg)||0);
      const amount=animalDamageTaken(obj.type,obj.stage,raw);
      if(amount<=0)return false;
      obj.hp=Math.max(0,obj.hp-amount);obj.flash=.15;obj.combat=8;obj.enraged=true;obj.sleeping=false;obj.recentHit=4;this.broadcastEntityHealth("animal",ref.id,obj);
      if(attackerKind==="animal"&&attackerId&&this.state.animals.has(attackerId))this.animalAggro.set(ref.id,{kind:"animal",id:attackerId});
      else if(attackerKind==="enemy"&&attackerId&&this.state.enemies.has(attackerId))this.animalAggro.set(ref.id,{kind:"enemy",id:attackerId});
      if(obj.hp<=0){obj.dead=true;this.awardPetXpContributors("animal",ref.id,obj,"");if(attackerKind==="animal"&&attackerId&&this.state.animals.has(attackerId))this.giveWildKillExp(attackerId,this.state.animals.get(attackerId),obj);if(attackerKind==="player")this.maybeRewardWildMaterial(attackerId,obj);this.spawnQueenBroodFromBoss(obj);this.state.animals.delete(ref.id);this.animalAggro.delete(ref.id);this.animalFleeFrom.delete(ref.id);}
      return true;
    }
    if(ref.kind==="enemy"){
      if(obj.dead||obj.hp<=0)return false;
      const amount=Math.max(0,Number(dmg)||0);if(amount<=0)return false;
      obj.hp=Math.max(0,obj.hp-amount);obj.flash=.15;this.broadcastEntityHealth("enemy",ref.id,obj);
      if(attackerKind==="animal"&&attackerId&&this.state.animals.has(attackerId))this.enemyAggro.set(ref.id,{kind:"animal",id:attackerId});
      if(obj.hp<=0){obj.dead=true;this.awardPetXpContributors("enemy",ref.id,obj,"");this.releaseEnemyGuardToWild(ref.id);this.state.enemies.delete(ref.id);this.enemyAggro.delete(ref.id);}
      return true;
    }
    return false;
  }

  markPetXpContribution(kind,targetId,petId,dmg){
    if(!petId||!(dmg>0))return;const pet=this.state.pets.get(String(petId));if(!pet||pet.dead)return;
    const key=`${kind}:${targetId}`;let map=this.petXpContrib.get(key);if(!map){map=new Map();this.petXpContrib.set(key,map);}
    map.set(String(petId),(map.get(String(petId))||0)+Math.max(0,Number(dmg)||0));
  }
  awardPetXpContributors(kind,targetId,victim,killerPetId=""){
    const key=`${kind}:${targetId}`,map=this.petXpContrib.get(key)||new Map();
    if(killerPetId&&this.state.pets.has(String(killerPetId))&&!map.has(String(killerPetId)))map.set(String(killerPetId),.01);
    this.petXpContrib.delete(key);if(!map.size)return;
    // Owned pet killing blow on an animal: flat 35% chance for one card of
    // the killer pet's species. This is separate from victim-species drops.
    if(kind==="animal"&&killerPetId&&victim){
      const killerPet=this.state.pets.get(String(killerPetId));
      if(killerPet&&!killerPet.dead&&killerPet.ownerId&&PET_TYPES[killerPet.type]&&Math.random()<PET_ANIMAL_KILL_CARD_CHANCE){
        this.sendReward(killerPet.ownerId,{kind:"cards",species:killerPet.type,amount:1},{x:victim.x,y:victim.y,petKill:true,killerPetId:String(killerPetId)});
      }
    }
    const base=kind==="animal"?petKillXpForAnimal(victim):petKillXpForEnemy(victim);
    const total=Math.max(.01,Array.from(map.values()).reduce((a,b)=>a+Math.max(0,Number(b)||0),0));
    for(const[petId,dealt]of map){const pet=this.state.pets.get(petId);if(!pet||pet.dead)continue;const killer=petId===String(killerPetId||"");const share=Math.max(0,Number(dealt)||0)/total;const mul=killer?1:clamp(.55+share*.35,.55,.85);this.givePetExp(petId,pet,Math.max(1,Math.round(base*mul)));}
  }
  wildExpNeed(a){const base={baby:28,adult:72,boss:150,superboss:300,bigmomma:999999}[a?.stage]||999999;return Math.round(base*(1+Math.max(0,(Number(a?.level)||1)-1)*.18));}
  giveWildExp(id,a,amount,reason="wild"){
    if(!a||a.dead||a.hp<=0||a.stage==="bigmomma")return;amount=Math.max(0,Number(amount)||0);if(amount<=0)return;a.exp=Math.max(0,Number(a.exp)||0)+amount;a.level=Math.max(1,Math.floor(Number(a.level)||1));let safety=0;
    while(safety++<12){const need=this.wildExpNeed(a);if(a.exp<need)break;a.exp-=need;a.level++;const growAt={baby:3,adult:4,boss:5,superboss:6}[a.stage]||999;if(a.level<growAt)continue;const next={baby:"adult",adult:"boss",boss:"superboss",superboss:"bigmomma"}[a.stage];if(!next)break;if(next==="bigmomma"&&a.type!=="queenbee"&&Array.from(this.state.animals.values()).filter(q=>q&&q.hp>0&&q.type!=="queenbee"&&q.stage==="bigmomma").length>=5){a.exp=Math.min(a.exp,need-1);a.level=growAt-1;break;}a.stage=next;a.level=1;a.r=animalRadius(a.type,next);a.maxHp=typeHp(a.type,next);a.hp=a.maxHp;a.speed=animalSpeed(a.type,next,false);a.sleeping=false;a.enraged=false;a._abilityFightKey="";this.broadcastFx({kind:"hit",x:a.x,y:a.y-(a.r||18)-18,text:`${next.toUpperCase()}!`,color:"#ffe66d"});}
  }
  giveWildKillExp(id,a,victim){if(!a||!victim)return;this.giveWildExp(id,a,petKillXpForAnimal(victim),"hunt");}
  givePetExp(id,p,amount){
    if(!p||p.dead)return;
    if(p.stage==="bigmomma"){p.stage="superboss";p.r=animalRadius(p.type,"superboss");p.maxHp=Math.max(12,Math.round(typeHp(p.type,"superboss")*petUpgradeMultiplier(p,"health")));p.hp=Math.min(p.hp||p.maxHp,p.maxHp);p.speed=animalSpeed(p.type,"superboss",true,petUpgradeMultiplier(p,"weight"))*petUpgradeMultiplier(p,"speed");}
    amount=Math.max(0,Number(amount)||0)*this.runPerks(p.ownerId).petXpMul;if(amount<=0)return;p.exp+=amount;let safety=0;
    while(safety++<24){const need=expNeed(p.stage,p.level);if(p.exp<need)break;p.exp-=need;p.level++;let next=null;if(p.stage==="baby"&&p.level>=4)next="adult";else if(p.stage==="adult"&&p.level>=5)next="boss";else if(p.stage==="boss"&&p.level>=6)next="superboss";if(next){p.stage=next;p.r=animalRadius(p.type,next);p.maxHp=Math.max(12,Math.round(typeHp(p.type,next)*petUpgradeMultiplier(p,"health")));p.hp=p.maxHp;p.speed=animalSpeed(p.type,next,true,petUpgradeMultiplier(p,"weight"))*petUpgradeMultiplier(p,"speed");p.level=1;const c=this.clientById(p.ownerId);if(c)c.send("petGrew",{id,stage:next,type:p.type});}}
  }

  resolveCreaturePairPhysical(a,b){
    if(!a||!b||a===b||a.dead||b.dead||a.hp<=0||b.hp<=0)return false;
    let moved=false;
    for(let pass=0;pass<2;pass++){
      const ah=animalPhysicalCircles(a),bh=animalPhysicalCircles(b);
      let best=null,bestOverlap=0;
      for(const ca of ah)for(const cb of bh){
        const dx=cb.x-ca.x,dy=cb.y-ca.y,rr=ca.r+cb.r,d2=dx*dx+dy*dy;
        if(d2>=rr*rr)continue;
        const d=Math.sqrt(Math.max(.0001,d2)),ov=rr-d;
        if(ov>bestOverlap){bestOverlap=ov;best={dx,dy,d};}
      }
      if(!best||bestOverlap<=.01)break;
      let nx=best.dx/best.d,ny=best.dy/best.d;
      if(!Number.isFinite(nx)||!Number.isFinite(ny)){
        const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;nx=dx/d;ny=dy/d;
      }
      const wa=animalWeight(a),wb=animalWeight(b),ia=1/Math.max(.2,wa),ib=1/Math.max(.2,wb),sum=ia+ib||1;
      const correction=Math.min(bestOverlap+.35,16);
      const ma=correction*(ia/sum),mb=correction*(ib/sum);
      a.x-=nx*ma;a.y-=ny*ma;b.x+=nx*mb;b.y+=ny*mb;moved=true;
    }
    return moved;
  }

  resolveMountedCreaturePair(anchor,mover){
    if(!anchor||!mover||anchor.dead||mover.dead)return false;
    let best=null,bestOverlap=0;
    for(const ca of animalPhysicalCircles(anchor))for(const cb of animalPhysicalCircles(mover)){
      const dx=cb.x-ca.x,dy=cb.y-ca.y,rr=ca.r+cb.r,d2=dx*dx+dy*dy;
      if(d2>=rr*rr)continue;
      const d=Math.sqrt(Math.max(.0001,d2)),ov=rr-d;
      if(ov>bestOverlap){bestOverlap=ov;best={dx,dy,d};}
    }
    if(!best||bestOverlap<=.01)return false;
    let nx=best.dx/best.d,ny=best.dy/best.d;
    if(!Number.isFinite(nx)||!Number.isFinite(ny)){const dx=mover.x-anchor.x,dy=mover.y-anchor.y,d=Math.hypot(dx,dy)||1;nx=dx/d;ny=dy/d;}
    // Match the client solver exactly so online riding does not get corrected
    // back and forth between two slightly different collision responses.
    const mountShare=clamp(.16+(1-animalPushMobility(mover))*.10,.16,.28);
    const correction=Math.min(bestOverlap+.08,5.5+Math.sqrt(Math.max(0,bestOverlap))*.55);
    anchor.x-=nx*correction*mountShare;anchor.y-=ny*correction*mountShare;
    mover.x+=nx*correction*(1-mountShare);mover.y+=ny*correction*(1-mountShare);
    return true;
  }

  resolveAnimalAnimalCollisions(){
    const all=[];
    // Only solve creature-vs-creature physics in active player regions. Distant
    // wildlife is already low-frequency simulated, so rebuilding/solving the
    // entire world every server tick wastes CPU and can cause network stalls.
    for(const[id,a]of this.state.animals){
      if(!a||a.hp<=0)continue;
      const forced=this.animalAggro.has(id)||this.enemyOwnerByPet.has(id)||a.tameFailedAggro||a.desperateAggro||(a.recentHit||0)>0;
      if(forced||this.hasNearbyPlayerOrPet(a.x,a.y,1850))all.push({kind:"animal",id,obj:a});
    }
    for(const[id,p]of this.state.pets)if(p&&!p.dead&&p.hp>0)all.push({kind:"pet",id,obj:p});

    const CELL=220,grid=new Map(),moved=new Set();
    for(let i=0;i<all.length;i++){
      const o=all[i].obj;if(!Number.isFinite(o.x)||!Number.isFinite(o.y))continue;
      const cx=Math.floor(o.x/CELL),cy=Math.floor(o.y/CELL),k=`${cx},${cy}`;
      let b=grid.get(k);if(!b){b=[];grid.set(k,b);}b.push(i);
    }

    for(let i=0;i<all.length;i++){
      const a=all[i].obj;if(!Number.isFinite(a.x)||!Number.isFinite(a.y))continue;
      const cx=Math.floor(a.x/CELL),cy=Math.floor(a.y/CELL);
      for(let gx=cx-1;gx<=cx+1;gx++)for(let gy=cy-1;gy<=cy+1;gy++){
        const bucket=grid.get(`${gx},${gy}`);if(!bucket)continue;
        for(const j of bucket){
          if(j<=i)continue;
          const recA=all[i],recB=all[j],b=recB.obj;if(!b||!Number.isFinite(b.x)||!Number.isFinite(b.y))continue;
          const broad=animalSpawnFootprint(a.type,a.stage)+animalSpawnFootprint(b.type,b.stage);
          const dx=b.x-a.x,dy=b.y-a.y;if(dx*dx+dy*dy>broad*broad)continue;
          const aOwner=recA.kind==="pet"?this.state.players.get(a.ownerId):null;
          const bOwner=recB.kind==="pet"?this.state.players.get(b.ownerId):null;
          const aMounted=!!(aOwner&&aOwner.ridingPetId===recA.id);
          const bMounted=!!(bOwner&&bOwner.ridingPetId===recB.id);
          if(aMounted&&!bMounted){a._mountedCollision=true;if(this.resolveMountedCreaturePair(a,b)){moved.add(a);moved.add(b);}}
          else if(bMounted&&!aMounted){b._mountedCollision=true;if(this.resolveMountedCreaturePair(b,a)){moved.add(a);moved.add(b);}}
          else if(!aMounted&&!bMounted&&this.resolveCreaturePairPhysical(a,b)){moved.add(a);moved.add(b);}
        }
      }
    }

    for(const o of moved){
      o.x=clamp(o.x,20,WORLD_W-20);o.y=clamp(o.y,20,WORLD_H-20);
      this.resolveStatic(o,(o.r||18)*.68);
    }
  }

  animalResourceStrengthMultiplier(a){const raw=animalBalance(a?.type).attack/7.5;return clamp(1+(raw-1)*.45,.72,1.35);}
  petResourceDamage(p,r=null,ability=false){const maxHp=Math.max(1,Number(r?.maxHp)||Number(r?.hp)||1),pct=ANIMAL_RESOURCE_STAGE_PERCENT[p?.stage]??ANIMAL_RESOURCE_STAGE_PERCENT.adult,abilityMul=ability?1.25:1;return Math.max(.05,maxHp*pct*this.animalResourceStrengthMultiplier(p)*abilityMul);}
  petHitResource(ownerId,p,rid,r,ability=false){if(!p||!r||!r.alive)return false;if(r.type==="rainforestHive"||this.isBeeFlowerResource(r)){this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:this.isBeeFlowerResource(r)?"#ef8ac4":"#d0ad4c"});return true;}const dmg=this.petResourceDamage(p,r,ability);r.hp=Math.max(0,(r.hp||1)-dmg);const key=r.type==="bush"?"berries":(r.type==="rock"?"stone":"wood");const amount=ability?Math.max(1,Math.round(dmg*.25)):1;const c=this.clientById(ownerId);if(c)c.send("resourceReward",{id:rid||"",kind:key,amount});this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:key==="wood"?"#c99a5b":key==="stone"?"#a9b3bd":"#d1315c"});this.broadcastEntityHealth("resource",rid,r);if(r.hp<=0){r.hp=0;r.alive=false;this.broadcastEntityHealth("resource",rid,r);this.resourceRespawns.set(rid,rand(12,22));}return true;}
  petDamageResourcesAround(ownerId,p,x,y,range,ability=true){for(const s of this.nearbySolids(x,y,range+120)){if(s.kind!=="resource")continue;const r=this.state.resources.get(s.id);if(!r||!r.alive)continue;if(dist(x,y,s.x,s.y)<=range+s.r)this.petHitResource(ownerId,p,s.id,r,ability);}}
  petAttackStuckResource(ownerId,p,opts={}){
    if(!p||p.dead||p.sleeping)return false;
    const owner=this.state.players.get(ownerId);
    const mounted=!!(owner?.ridingPetId&&this.state.pets.get(owner.ridingPetId)===p);
    if(!mounted&&p.orderMode==="follow"&&owner){
      // Following remains the movement goal, but a physically stuck pet may bite
      // the obstacle while it keeps trying to route around it. Never replace the
      // owner with the resource as a target.
      const ownerDistance=dist(p.x,p.y,owner.x,owner.y);
      if(ownerDistance>petFollowRangeFor(p).sprint+900){p._blockingResourceId="";return false;}
    }
    let rid=p._blockingResourceId||"",r=rid?this.state.resources.get(rid):null;
    // Riding uses only a resource that the mount physically contacted very recently.
    // Never scan for a nearby resource while mounted: a blocker is an obstacle to
    // bite on contact, not a combat target to acquire or steer toward.
    const contactOnly=!!opts.contactOnly||mounted;
    const contactFresh=!contactOnly||((Number(p._blockingResourceUntil)||0)>=this.state.worldTime);
    if(!contactFresh||!this.resourceBlocksCreaturePath(p,r)){
      if(contactOnly){p._blockingResourceId="";return false;}
      const found=this.findBlockingResourceForCreature(p);rid=found?.id||"";r=found?.r||null;
    }
    if(!rid||!r){p._blockingResourceId="";return false;}
    p._blockingResourceId=rid;
    // IMPORTANT: do not smoothTurn toward resources. The pet keeps its movement/
    // rider steering heading and simply attacks the thing currently blocking it.
    if((p.atkCd||0)>0)return true;
    p.atkCd=animalAttackCooldown(p.type,p.stage,true);p.attackAnim=.22;
    const blockers=this.blockingResourcesForCreature(p,6);if(!blockers.length)blockers.push({id:rid,r});
    for(const b of blockers)this.petHitResource(ownerId,p,b.id,b.r,false);
    if(!r.alive)p._blockingResourceId="";
    return true;
  }
  wildResourceCombatInterrupt(id,a){
    if(!a||a.hp<=0)return false;
    const locked=this.animalAggro.get(id),lockedObj=this.targetObject(locked);
    if(locked&&lockedObj&&!(locked.kind==="player"?(lockedObj.dead||lockedObj.health<=0):(lockedObj.dead||lockedObj.hp<=0))){a._blockingResourceId="";return true;}
    const fleeRef=this.animalFleeFrom.get(id),fleeObj=this.targetObject(fleeRef);
    if(a.fleeUntil&&this.state.worldTime<a.fleeUntil&&fleeObj){a._blockingResourceId="";return true;}
    const info=PET_TYPES[a.type]||{},naturalChaser=a.stage!=="baby"&&!info.friendly;
    const chaseRange=wildPlayerAggroRange(a);
    if(naturalChaser&&!this.snakeFluteCalmActive(a)){const near=this.nearestPlayer(a.x,a.y,chaseRange);if(near){this.animalAggro.set(id,{kind:"player",id:near.id});a.sleeping=false;a.enraged=true;a.combat=Math.max(a.combat||0,5);a._blockingResourceId="";return true;}}
    return false;
  }
  wildAttackBlockingResource(id,a){
    if(!a||a.hp<=0||a.sleeping)return false;
    if(this.wildResourceCombatInterrupt(id,a))return false;
    let rid=a._blockingResourceId||"",r=rid?this.state.resources.get(rid):null;
    if(!this.resourceBlocksCreaturePath(a,r)){const found=this.findBlockingResourceForCreature(a);rid=found?.id||"";r=found?.r||null;}
    if(!rid||!r){a._blockingResourceId="";return false;}
    a._blockingResourceId=rid;
    if((a.atkCd||0)>0)return true;
    a.atkCd=animalAttackCooldown(a.type,a.stage,false);a.attackAnim=.22;
    const blockers=this.blockingResourcesForCreature(a,6);if(!blockers.length)blockers.push({id:rid,r});
    for(const b of blockers){if(b.r.type==="rainforestHive"||this.isBeeFlowerResource(b.r)){this.broadcastFx({kind:"hit",x:b.r.x,y:b.r.y,text:"",color:this.isBeeFlowerResource(b.r)?"#ef8ac4":"#d0ad4c"});continue;}const dmg=this.petResourceDamage(a,b.r,false);b.r.hp=Math.max(0,(b.r.hp||1)-dmg);this.broadcastFx({kind:"hit",x:b.r.x,y:b.r.y,text:"",color:b.r.type==="bush"?"#d1315c":(b.r.type==="rock"?"#a9b3bd":"#c99a5b")});this.broadcastEntityHealth("resource",b.id,b.r);if(b.r.hp<=0){b.r.hp=0;b.r.alive=false;this.broadcastEntityHealth("resource",b.id,b.r);this.resourceRespawns.set(b.id,rand(12,22));}}
    if(!r.alive)a._blockingResourceId="";
    return true;
  }
  mountedPetAttack(ownerId,owner){if(!owner?.ridingPetId)return false;const pet=this.state.pets.get(owner.ridingPetId);if(!pet||pet.dead||pet.atkCd>0)return false;let target=this.nearestHostile(pet.x,pet.y,Math.max(70,(pet.r||18)*2.6));if(!target)return false;const face=animalFaceGeometry(pet);const contact=target.kind==="animal"?petAttackContact(pet,{kind:"animal",id:target.id},target.obj):dist(face.x,face.y,target.obj.x,target.obj.y)<=face.r+(target.obj.r||18)+16;if(!contact)return false;const saddle=clamp(Math.floor(Number(owner.saddleTier)||0),0,3),sv=String(owner.saddleVariant||""),raw=petAtkDmg(pet)*(saddle>=3&&sv==="ruby"?1.36:saddle>=2?1.15:saddle>=1?1.07:1);pet.atkCd=animalAttackCooldown(pet.type,pet.stage,true);pet.attackAnim=.18;if(target.kind==="enemy")this.hitEnemy(target.id,target.obj,raw,ownerId,false,{kind:"pet",id:owner.ridingPetId});else this.hitWild(target.id,target.obj,raw,ownerId,false,{kind:"pet",id:owner.ridingPetId});if(saddle>=3&&sv==="emerald")pet.hp=Math.min(pet.maxHp,pet.hp+raw*.18);return true;}

  movePetChaseWithRecovery(id,p,target,speed,dt){
    if(!p||p.dead||!target||!Number.isFinite(speed)||!Number.isFinite(dt)||dt<=0)return;
    let cs=this.petChaseState.get(id);
    const targetKey=String(target.netId||target.id||"")||target;
    if(!cs||cs.targetKey!==targetKey){
      let seed=11;for(const ch of String(id))seed=((seed*33)+ch.charCodeAt(0))|0;
      cs={targetKey,stuckT:0,avoidSide:(Math.abs(seed)&1)?1:-1};this.petChaseState.set(id,cs);
    }
    const sx=p.x,sy=p.y;this.moveCreatureSwept(p,speed,dt);
    const moved=dist(sx,sy,p.x,p.y),expected=Math.max(.001,speed*dt);
    if(moved>=Math.max(.18,expected*.22)){cs.stuckT=Math.max(0,cs.stuckT-dt*3.2);return;}
    cs.stuckT+=dt;
    // Resource blockers are intentionally chewed on the next server tick.
    if(p._blockingResourceId&&cs.stuckT>.14)this.petAttackStuckResource(p.ownerId,p);
    if(cs.stuckT<.11)return;
    const direct=angTo(p.x,p.y,target.x,target.y);p.angle=direct+cs.avoidSide*.76;
    const ax=p.x,ay=p.y;this.moveCreatureSwept(p,speed*.88,dt);
    if(dist(ax,ay,p.x,p.y)<Math.max(.15,expected*.12))cs.avoidSide*=-1;
  }

  safePetFollowPoint(p,tx,ty){
    let x=clamp(tx,24,WORLD_W-24),y=clamp(ty,24,WORLD_H-24);
    const pr=Math.max(10,(p.r||18)*.72+5),range=pr+130;
    for(let pass=0;pass<2;pass++){
      for(const s of this.nearbySolids(x,y,range)){
        if(s.kind==="water")continue;
        if(s.kind==="resource"){const r=this.state.resources.get(s.id);if(r&&!r.alive)continue;}
        if(s.kind==="gold"){const g=this.state.gold.get(s.id);if(g&&!g.infinite&&g.goldLeft<=0)continue;}
        if(s.kind==="chest"){const c=this.state.chests.get(s.id);if(c?.opened)continue;}
        const d=dist(x,y,s.x,s.y),min=pr+s.r+4;
        if(d<min){const a=d>.01?angTo(s.x,s.y,x,y):(p.angle||0);x=s.x+Math.cos(a)*min;y=s.y+Math.sin(a)*min;}
      }
      for(const[,w]of this.state.walls){
        if(isPlacedVehicleWall(w))continue;
        const d=dist(x,y,w.x,w.y),min=pr+w.r+5;
        if(d<min){const a=d>.01?angTo(w.x,w.y,x,y):(p.angle||0);x=w.x+Math.cos(a)*min;y=w.y+Math.sin(a)*min;}
      }
    }
    return{x:clamp(x,24,WORLD_W-24),y:clamp(y,24,WORLD_H-24)};
  }

  wrongBiomeGraceForStage(stage){return({baby:4,adult:8,boss:12,superboss:17,bigmomma:24})[String(stage||"adult")]||8;}
  keepWildInHomeBiome(id,a,dt){
    if(!a||a.hp<=0||a.owned||this.enemyOwnerByPet.has(id))return false;
    const allowed=speciesAllowedBiomes(a.type),here=biomeBaseId(worldBiomeAt(a.x,a.y));
    if(allowed.includes(here)){
      a.biome=here;
      a._wrongBiomeTime=0;
      if((Number(a._biomeReturnCommit)||0)>0&&a._homeReturnPoint){
        a._biomeReturnCommit=Math.max(0,(Number(a._biomeReturnCommit)||0)-dt);
        const p=a._homeReturnPoint,d=dist(a.x,a.y,p.x,p.y);
        if(d>55&&a._biomeReturnCommit>0){a.sleeping=false;smoothTurn(a,angTo(a.x,a.y,p.x,p.y),dt,5.4);this.moveCreatureSwept(a,(a.speed||60)*1.24,dt);this.resolveStatic(a,(a.r||18)*.68);return true;}
        a._biomeReturnCommit=0;a._homeReturnPoint=null;a._homeReturnBiome="";
      }
      return false;
    }
    if(here==="ocean")return false;

    a._wrongBiomeTime=(Number(a._wrongBiomeTime)||0)+dt;
    if(a._wrongBiomeTime<this.wrongBiomeGraceForStage(a.stage))return false;
    // The wrong-biome grace period is safe. After it expires, force a return
    // home without draining health just for crossing a biome boundary.
    a.sleeping=false;a.enraged=false;a.tameFailedAggro=false;a.desperateAggro=false;a.combat=0;
    this.animalAggro.delete(id);this.animalFleeFrom.delete(id);this.clearWildMate(id);

    const preferred=allowed.includes(biomeBaseId(a.biome))?biomeBaseId(a.biome):"";
    const home=nearestAllowedBiomeFor(a.type,a.x,a.y,preferred);
    if(!a._homeReturnPoint||a._homeReturnBiome!==home||biomeBaseId(worldBiomeAt(a._homeReturnPoint.x,a._homeReturnPoint.y))!==home){a._homeReturnPoint=randomPointInBiome(home,260);a._homeReturnBiome=home;}
    a._biomeReturnCommit=1.65;
    const p=a._homeReturnPoint;smoothTurn(a,angTo(a.x,a.y,p.x,p.y),dt,5.4);this.moveCreatureSwept(a,(a.speed||60)*1.32,dt);this.resolveStatic(a,(a.r||18)*.68);return true;
  }

  updatePets(dt){
    for(const[id,p]of this.state.pets){
      if(p.dead)continue;
      const _petAlwaysX=p.x,_petAlwaysY=p.y;
      p.abilityCd=Math.max(0,p.abilityCd-dt);
      p.atkCd=Math.max(0,p.atkCd-dt);
      if(Array.isArray(p._stoneFruitStackExpiries)){p._stoneFruitStackExpiries=p._stoneFruitStackExpiries.filter(t=>Number(t)>this.state.worldTime);p.stoneFruitStacks=p._stoneFruitStackExpiries.length;}else if(p.stoneFruitStacks)p.stoneFruitStacks=0;
      p.combat=Math.max(0,p.combat-dt);
      if((Number(p._foodJungleUntil)||0)>this.state.worldTime&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+(Number(p._foodJungleRate)||4)*dt);
      if((Number(p._foodGoodCactusUntil)||0)>this.state.worldTime&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+(Number(p._foodGoodCactusRate)||2.6)*dt);
      if((Number(p._foodHoneyUntil)||0)>this.state.worldTime&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+(Number(p._foodHoneyRate)||4.6)*dt);
      if((Number(p._foodBadCactusUntil)||0)>this.state.worldTime){this.damageTarget({kind:"pet",id},(Number(p._foodBadCactusRate)||2.5)*dt,"world","");if(p.dead)continue;}
      if(p.combat<=0&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+Math.max(1.2,p.maxHp*.024)*petUpgradeMultiplier(p,"regen")*dt);
      p.flash=Math.max(0,p.flash-dt);
      p.attackAnim=Math.max(0,p.attackAnim-dt);
      p.tailPhase=(p.tailPhase||0)+dt*(.34+Math.min(.55,Math.max(0,Number(p.speed)||0)*.003));
      if((Number(p._abilityStunUntil)||0)>this.state.worldTime){p.attackAnim=0;this.resolveStatic(p,(p.r||18)*.72);continue;}

      const owner=this.state.players.get(p.ownerId);
      if(!owner)continue;
      if(p.bredChild)this.convertLoneOrphanToNormal(id,p);
      // A sleeping pet wakes as soon as its owner actually leaves it behind.
      // Follow pets are never allowed to remain asleep/unresponsive while the owner travels.
      const wakeRange=petFollowRangeFor(p);
      if(p.sleeping&&(owner.moving||Math.hypot(owner.moveX||0,owner.moveY||0)>.05||dist(p.x,p.y,owner.x,owner.y)>wakeRange.stop))p.sleeping=false;

      if(owner.ridingPetId===id){
        p._mountedCollision=true;p.x=owner.x;p.y=owner.y;
        const ml=Math.hypot(owner.moveX||0,owner.moveY||0);
        if(ml>.05)smoothTurn(p,Math.atan2(owner.moveY||0,owner.moveX||0),dt,mountedPetTurnSpeed(p));
        if(owner.moving&&p._blockingResourceId)this.petAttackStuckResource(p.ownerId,p,{contactOnly:true});
        else if((Number(p._blockingResourceUntil)||0)<this.state.worldTime)p._blockingResourceId="";
        this.resolveStatic(p,(p.r||18)*.72);
        owner.x=p.x;owner.y=p.y;
        continue;
      }
      p._mountedCollision=false;
      if(p.sleeping){this.resolveStatic(p,(p.r||18)*.72);continue;}

      let target=null;
      let targetSource="";

      const focus=this.petFocusTargets.get(id);
      if(focus){
        const obj=focus.kind==="animal"?this.state.animals.get(focus.id):focus.kind==="enemy"?this.state.enemies.get(focus.id):focus.kind==="player"?this.state.players.get(focus.id):null;
        if(obj&&((focus.kind==="animal"&&obj.hp>0)||(focus.kind==="enemy"&&!obj.dead&&obj.hp>0)||(focus.kind==="player"&&!obj.dead&&obj.health>0))){
          target={kind:focus.kind,id:focus.id,obj,d:dist(p.x,p.y,obj.x,obj.y)};
          targetSource="manual";
        }else{
          this.petFocusTargets.delete(id);
          this.petChaseState.delete(id);
          p.orderMode="follow";
          p.targetX=-1;p.targetY=-1;
          this.petHuntState.delete(id);
          this.petFollowState.delete(id);
        }
      }

      const threat=this.ownerThreat.get(p.ownerId);
      if(!target&&threat&&threat.until>this.state.worldTime){
        const obj=threat.kind==="animal"?this.state.animals.get(threat.id):this.state.enemies.get(threat.id);
        if(obj&&((threat.kind==="animal"&&obj.hp>0)||(threat.kind==="enemy"&&!obj.dead&&obj.hp>0))){
          const ownerToThreat=dist(owner.x,owner.y,obj.x,obj.y);
          const petToOwner=dist(p.x,p.y,owner.x,owner.y);
          if(ownerToThreat<500&&petToOwner<430){
            target={kind:threat.kind,id:threat.id,obj,d:dist(p.x,p.y,obj.x,obj.y)};
            targetSource="defense";
          }
        }
      }else if(threat&&threat.until<=this.state.worldTime)this.ownerThreat.delete(p.ownerId);

      if(!target&&p.orderMode==="combat"){
        let hs=this.petHuntState.get(id);
        if(!hs){hs={kind:"",targetId:"",retarget:0,wanderT:0,tx:null,ty:null};this.petHuntState.set(id,hs);}
        hs.retarget-=dt;
        let current=null;
        if(hs.kind&&hs.targetId){
          const obj=hs.kind==="animal"?this.state.animals.get(hs.targetId):this.state.enemies.get(hs.targetId);
          if(obj&&((hs.kind==="animal"&&obj.hp>0)||(hs.kind==="enemy"&&!obj.dead&&obj.hp>0)))current={kind:hs.kind,id:hs.targetId,obj,d:dist(p.x,p.y,obj.x,obj.y)};
        }
        if(!current||hs.retarget<=0){
          current=this.chooseCombatHuntTarget(p);
          hs.kind=current?.kind||"";hs.targetId=current?.id||"";hs.retarget=rand(7,13);
        }
        if(current){target=current;targetSource="combat";}
      }
      // Family babies join whatever their living parents are fighting. If both
      // parents are gone before Adult, their two older siblings become the leaders.
      if(!target&&p.bredChild){
        for(const parentId of this.familyLeaderIds(id,p)){
          if(!parentId)continue;
          const parent=this.state.pets.get(parentId);if(!parent||parent.dead)continue;
          const pf=this.petFocusTargets.get(parentId);
          if(pf){const obj=pf.kind==="animal"?this.state.animals.get(pf.id):pf.kind==="enemy"?this.state.enemies.get(pf.id):pf.kind==="player"?this.state.players.get(pf.id):null;const alive=obj&&(pf.kind==="player"?!obj.dead&&obj.health>0:!obj.dead&&obj.hp>0);if(alive){target={kind:pf.kind,id:pf.id,obj,d:dist(p.x,p.y,obj.x,obj.y)};targetSource="family";break;}}
          const ph=this.petHuntState.get(parentId);
          if(ph&&ph.kind&&ph.targetId){const obj=ph.kind==="animal"?this.state.animals.get(ph.targetId):this.state.enemies.get(ph.targetId);if(obj&&obj.hp>0&&!obj.dead){target={kind:ph.kind,id:ph.targetId,obj,d:dist(p.x,p.y,obj.x,obj.y)};targetSource="family";break;}}
        }
      }

      // Follow / Defend / Set do not start random fights. Defend still responds
      // to ownerThreat above, and manual right-click focus remains allowed.

      // Combat/defense has priority over obstacle chewing. Only keep attacking a
      // resource when there is no live target worth reacting to.
      if(target){
        p._blockingResourceId="";
      }else{
        const followRangeNow=petFollowRangeFor(p);
        const ownerMovingNow=!!owner.moving||Math.hypot(owner.moveX||0,owner.moveY||0)>.05;
        const followNeedsMovement=p.orderMode==="follow"&&(ownerMovingNow||dist(p.x,p.y,owner.x,owner.y)>followRangeNow.stop+18);
        if(followNeedsMovement)p._blockingResourceId="";
        else if(p._blockingResourceId){
          // Bite the blocker without turning it into a target or pausing the rest
          // of the pet AI for the whole time the resource is alive.
          this.petAttackStuckResource(p.ownerId,p);
        }
      }

      if(target){
        const a=angTo(p.x,p.y,target.obj.x,target.obj.y);
        const turnRate=targetSource==="combat"?4.8:5.2;
        smoothTurn(p,a,dt,turnRate);
        // Match offline: a bite only lands when the pet's actual face/head reaches
        // the target. Center-distance overlap is not enough.
        const touch=petAttackContact(p,{kind:target.kind,id:target.id},target.obj);
        if(!touch){
          const chaseBoost=targetSource==="combat"?(target.d>350?1.45:1.28):1.28;
          this.movePetChaseWithRecovery(id,p,target.obj,p.speed*petStoneFruitMoveMul(p)*chaseBoost,dt);
        }else{
          p.angle+=((String(id).length&1)?1:-1)*.45*dt;
          this.moveCreatureSwept(p,Math.max(8,(Number(p.speed)||60)*petStoneFruitMoveMul(p)*.16),dt);
          if(p.atkCd<=0){
          const rawDmg=petAtkDmg(p);
          const dmg=target.kind==="animal"?animalDamageTaken(target.obj.type,target.obj.stage,rawDmg):rawDmg;
          p.atkCd=animalAttackCooldown(p.type,p.stage,true);
          p.attackAnim=.18;
          if(target.kind==="enemy"){
            this.enemyAggro.set(target.id,{kind:"pet",id});
            const before=this.state.enemies.has(target.id);
            this.hitEnemy(target.id,target.obj,dmg,p.ownerId,false,{kind:"pet",id});
            if(before&&!this.state.enemies.has(target.id)){this.petFocusTargets.delete(id);this.petHuntState.delete(id);this.petChaseState.delete(id);if(targetSource==="manual"){p.orderMode="follow";p.targetX=-1;p.targetY=-1;this.petFollowState.delete(id);}}
          }else if(target.kind==="player"){
            const aliveBefore=!target.obj.dead&&target.obj.health>0;
            this.damageTarget({kind:"player",id:target.id},rawDmg,"pet",id);
            this.broadcastFx({kind:"hit",x:target.obj.x,y:target.obj.y-8,text:Math.round(rawDmg),color:"#7be08a"});
            if(aliveBefore&&(target.obj.dead||target.obj.health<=0)){this.petFocusTargets.delete(id);this.petHuntState.delete(id);this.petChaseState.delete(id);if(targetSource==="manual"){p.orderMode="follow";p.targetX=-1;p.targetY=-1;this.petFollowState.delete(id);}}
          }else{
            const before=this.state.animals.has(target.id);
            this.hitWild(target.id,target.obj,rawDmg,p.ownerId,false,{kind:"pet",id});
            if(before&&!this.state.animals.has(target.id)){this.petFocusTargets.delete(id);this.petHuntState.delete(id);this.petChaseState.delete(id);if(targetSource==="manual"){p.orderMode="follow";p.targetX=-1;p.targetY=-1;this.petFollowState.delete(id);}}
          }
          }
        }
      }else if(p.orderMode==="combat"){
        // Match offline Combat mode: no owner-follow fallback. If there is no
        // living target, keep roaming independently until a hunt target exists.
        let hs=this.petHuntState.get(id);
        if(!hs){hs={kind:"",targetId:"",retarget:0,wanderT:0,tx:null,ty:null};this.petHuntState.set(id,hs);}
        hs.wanderT=(hs.wanderT||0)-dt;
        if(hs.wanderT<=0||hs.tx==null||dist(p.x,p.y,hs.tx,hs.ty)<18){
          const ang=rand(0,TAU),rad=rand(220,650);
          hs.tx=clamp(p.x+Math.cos(ang)*rad,40,WORLD_W-40);
          hs.ty=clamp(p.y+Math.sin(ang)*rad,40,WORLD_H-40);
          hs.wanderT=rand(2.5,6);
        }
        const a=angTo(p.x,p.y,hs.tx,hs.ty);smoothTurn(p,a,dt,4.2);
        this.moveCreatureSwept(p,p.speed*petStoneFruitMoveMul(p)*.85,dt);
      }else if(p.orderMode==="set"&&p.targetX>=0){
        const d=dist(p.x,p.y,p.targetX,p.targetY);
        if(d>12){
          const a=angTo(p.x,p.y,p.targetX,p.targetY);
          smoothTurn(p,a,dt,4.6);
          this.moveCreatureSwept(p,p.speed*petStoneFruitMoveMul(p)*1.3,dt);
        }else{
          p.targetX=-1;p.targetY=-1;p.orderMode="follow";
        }
      }else{
        const followX=owner.x,followY=owner.y;
        const ownerDistance=dist(p.x,p.y,followX,followY);
        const followRange=petFollowRangeFor(p);
        const inputMag=clamp(Math.hypot(owner.moveX||0,owner.moveY||0),0,1);
        let ownerMoveSpeed=148*inputMag*this.hydrationMoveMul(owner.hydration);
        if(owner.vehicleType)ownerMoveSpeed*=vehicleSpeedMul(owner.vehicleType,owner.vehicleTier||0,owner.vehicleVariant||"");
        if(owner.ridingPetId){
          const mount=this.state.pets.get(owner.ridingPetId);
          if(mount&&!mount.dead)ownerMoveSpeed=Math.max(24,mount.speed||148)*petStoneFruitMoveMul(mount)*2.30*inputMag*(1+(clamp(Math.floor(Number(owner.saddleTier)||0),0,2)*.09));
        }
        if(owner.heldSpecial==="Wall")ownerMoveSpeed*=.64;

        let fs=this.petFollowState.get(id);
        if(!fs){
          let seed=7;for(const ch of String(id))seed=((seed*31)+ch.charCodeAt(0))|0;
          fs={returning:false,roamT:0,roamX:null,roamY:null,stuckT:0,roamStuckT:0,avoidSide:(Math.abs(seed)&1)?1:-1};
          this.petFollowState.set(id,fs);
        }

        // Distance alone controls follow. Being in motion does NOT force a nearby
        // pet to glue itself to the player; it may keep wandering inside its leash.
        if(!fs.returning&&ownerDistance>followRange.start)fs.returning=true;
        if(fs.returning&&ownerDistance<=followRange.settle){
          fs.returning=false;fs.roamT=0;fs.roamX=null;fs.roamY=null;fs.stuckT=0;
        }

        if(fs.returning){
          // Aim for a point on the safe ring on the pet's current side of the
          // owner. This prevents the pet from charging through the player's body.
          let radial=ownerDistance>.001?angTo(followX,followY,p.x,p.y):(owner.angle||0)+Math.PI;
          if(inputMag>.08&&ownerDistance>followRange.run)radial=Math.atan2(owner.moveY||0,owner.moveX||0)+Math.PI;
          const targetR=followRange.settle;
          const returnPoint=this.safePetFollowPoint(p,followX+Math.cos(radial)*targetR,followY+Math.sin(radial)*targetR);
          const targetAngle=angTo(p.x,p.y,returnPoint.x,returnPoint.y);
          smoothTurn(p,targetAngle,dt,ownerDistance>=followRange.dash?7.4:ownerDistance>=followRange.run?6.2:5.0);

          // Too far = run back. Very far = dash. As the pet reaches the owner,
          // ease back to a controlled walk before switching to wander mode.
          const stoneMove=petStoneFruitMoveMul(p);
          let followSpeed=Math.max((Number(p.speed)||60)*1.16,ownerMoveSpeed*1.02+8);
          if(ownerDistance>=followRange.dash)followSpeed=Math.max((Number(p.speed)||60)*2.75,ownerMoveSpeed*1.72+40);
          else if(ownerDistance>=followRange.run)followSpeed=Math.max((Number(p.speed)||60)*1.72,ownerMoveSpeed*1.20+16);
          else if(ownerDistance<followRange.settle+45)followSpeed=Math.max(24,(Number(p.speed)||60)*.72);
          followSpeed=Math.max(12,followSpeed*stoneMove);

          const sx=p.x,sy=p.y;this.moveCreatureSwept(p,followSpeed,dt);
          const moved=dist(sx,sy,p.x,p.y),expected=Math.max(.001,followSpeed*dt);
          if(moved<Math.max(.18,expected*.18)){
            fs.stuckT+=dt;
            if(fs.stuckT>.28)this.petAttackStuckResource(p.ownerId,p);
            if(fs.stuckT>.10){
              p.angle=targetAngle+fs.avoidSide*.72;
              const ax=p.x,ay=p.y;this.moveCreatureSwept(p,followSpeed*.88,dt);
              if(dist(ax,ay,p.x,p.y)<.16)fs.avoidSide*=-1;
            }
          }else fs.stuckT=Math.max(0,fs.stuckT-dt*3.2);

          if(ownerDistance>followRange.dash+650||fs.stuckT>1.05){
            const rescueA=inputMag>.08?Math.atan2(owner.moveY||0,owner.moveX||0)+Math.PI:radial;
            const rescue=this.safePetFollowPoint(p,followX+Math.cos(rescueA)*followRange.settle,followY+Math.sin(rescueA)*followRange.settle);
            p.x=rescue.x;p.y=rescue.y;p.angle=angTo(p.x,p.y,followX,followY);fs.stuckT=0;p._blockingResourceId="";
          }
        }else{
          // Close pets continuously wander from point to point around the owner.
          // Faster pets get a larger wander ring from petFollowRangeFor().
          const tooClose=ownerDistance<followRange.stop;
          fs.roamT=(Number(fs.roamT)||0)-dt;
          const targetBad=!Number.isFinite(fs.roamX)||!Number.isFinite(fs.roamY)||dist(fs.roamX,fs.roamY,followX,followY)>followRange.wanderMax+24;
          const reached=!targetBad&&dist(p.x,p.y,fs.roamX,fs.roamY)<Math.max(15,(p.r||18)*.65);
          if(tooClose||targetBad||reached||fs.roamT<=0){
            let a=rand(0,TAU),r=rand(followRange.stop+16,followRange.wanderMax*.94);
            if(tooClose){a=angTo(followX,followY,p.x,p.y)+rand(-.55,.55);r=Math.max(followRange.stop+30,followRange.settle*.82);}
            const pt=this.safePetFollowPoint(p,followX+Math.cos(a)*r,followY+Math.sin(a)*r);
            fs.roamX=pt.x;fs.roamY=pt.y;fs.roamT=rand(.9,2.2);
          }
          const a=angTo(p.x,p.y,fs.roamX,fs.roamY);smoothTurn(p,a,dt,2.8);
          const roamSpeed=Math.max(20,(Number(p.speed)||60)*petStoneFruitMoveMul(p)*.42);
          const sx=p.x,sy=p.y;this.moveCreatureSwept(p,roamSpeed,dt);
          const moved=dist(sx,sy,p.x,p.y);
          if(moved<Math.max(.14,roamSpeed*dt*.18)){
            fs.roamStuckT=(Number(fs.roamStuckT)||0)+dt;fs.roamT=0;fs.avoidSide*=-1;
            p.angle=a+fs.avoidSide*.85;this.moveCreatureSwept(p,roamSpeed*.9,dt);
            if(fs.roamStuckT>.85){fs.roamT=0;fs.roamStuckT=0;}
          }else fs.roamStuckT=Math.max(0,(Number(fs.roamStuckT)||0)-dt*3);
        }
      }
      p.x=clamp(p.x,20,WORLD_W-20);
      p.y=clamp(p.y,20,WORLD_H-20);
      this.resolveStatic(p,p.r*.72);
    }

    for(const[id,left]of this.petDeathTimers){
      const n=left-dt;
      if(n<=0){this.petFollowState.delete(id);this.petHuntState.delete(id);this.petChaseState.delete(id);this.state.pets.delete(id);this.petDeathTimers.delete(id);}
      else this.petDeathTimers.set(id,n);
    }
  }

  resolveEnemyCreatureContacts(en){
    if(!en||en.dead)return;
    const er=(en.r||17)*.90;
    for(const rec of this.nearbyDynamic(en.x,en.y,er+180,CREATURE_DYNAMIC_KINDS)){
      const obj=rec.obj;if(!obj||obj.dead||(obj.hp!=null&&obj.hp<=0))continue;
      let best=null,bestOverlap=0;
      for(const h of animalPhysicalCircles(obj)){
        const dx=en.x-h.x,dy=en.y-h.y,d2=dx*dx+dy*dy,rr=er+h.r;
        if(d2>=rr*rr)continue;const d=Math.sqrt(Math.max(.0001,d2)),overlap=rr-d;
        if(overlap>bestOverlap){bestOverlap=overlap;best={dx,dy,d};}
      }
      if(!best||bestOverlap<=.01)continue;
      let nx=best.dx/best.d,ny=best.dy/best.d;
      if(!Number.isFinite(nx)||!Number.isFinite(ny)){const q=angTo(obj.x,obj.y,en.x,en.y);nx=Math.cos(q);ny=Math.sin(q);}
      const correction=Math.min(bestOverlap+.04,7.5);
      en.x+=nx*correction;en.y+=ny*correction;
    }
  }

  updateEnemies(dt){
    const phase=TIME_PHASES[this.state.dayPhase];
    for(const[id,en]of this.state.enemies){
      en.flash=Math.max(0,en.flash-dt);en.atkCd=Math.max(0,en.atkCd-dt);en._forestCd=Math.max(0,(en._forestCd||0)-dt);en.attackAnim=Math.max(0,en.attackAnim-dt);
      const mount=en.ridingPetId?this.state.animals.get(en.ridingPetId):null;
      if((Number(en._abilityStunUntil)||0)>this.state.worldTime){en.attackAnim=0;this.resolveStatic(en,en.r*.9);continue;}
      if(en.ridingPetId&&!mount){en.ridingPetId="";en.guardPetId="";en.hasGuard=false;}
      if(mount){
        en.x=mount.x;en.y=mount.y;en.angle=mount.angle;
        if(phase.safe&&!en.moonMarked){en.hp-=18*dt;if(en.hp<=0){this.releaseEnemyGuardToWild(id);this.state.enemies.delete(id);this.enemyAggro.delete(id);continue;}}
        // Rider cube is intentionally weak; its mount is the weapon and movement.
        continue;
      }
      if(phase.safe&&!en.moonMarked){
        const edge=angTo(WORLD_W/2,WORLD_H/2,en.x,en.y);smoothTurn(en,edge,dt,12);en.x+=Math.cos(edge)*en.speed*1.35*dt;en.y+=Math.sin(edge)*en.speed*1.35*dt;en.hp-=18*dt;
        if(en.hp<=0){this.awardPetXpContributors("enemy",id,en,"");this.releaseEnemyGuardToWild(id);this.state.enemies.delete(id);this.enemyAggro.delete(id);continue;}
        if(en.x<5||en.x>WORLD_W-5||en.y<5||en.y>WORLD_H-5){this.petXpContrib.delete(`enemy:${id}`);this.releaseEnemyGuardToWild(id);this.state.enemies.delete(id);this.enemyAggro.delete(id);continue;}
        this.resolveEnemyCreatureContacts(en);this.resolveStatic(en,en.r*.9);continue;
      }
      let ref=this.enemyAggro.get(id),target=this.targetObject(ref);if(ref&&!target){this.enemyAggro.delete(id);ref=null;}if(!target){const near=this.nearestPlayerOrPet(en.x,en.y,en.moonMarked?980:(en.ranged?430:280));if(near){ref={kind:near.kind,id:near.id};target=near.obj;}}
      if(target){
        const d=dist(en.x,en.y,target.x,target.y),a=angTo(en.x,en.y,target.x,target.y);smoothTurn(en,a,dt,en.moonMarked?7.5:10);const tr=this.targetRadius(ref,target);
        if(en.moonMarked){
          const moon=MOONMARK_BIOMES[en.moonBiome||"forest"]||MOONMARK_BIOMES.forest;
          if(en.atkCd<=0){
            const shockR=en.r+150;
            for(const[pid,pl]of this.state.players)if(pl&&!pl.dead&&dist(en.x,en.y,pl.x,pl.y)<=shockR)this.damageTarget({kind:"player",id:pid},en.dmg,"enemy",id);
            for(const[petId,pet]of this.state.pets)if(pet&&!pet.dead&&dist(en.x,en.y,pet.x,pet.y)<=shockR)this.damageTarget({kind:"pet",id:petId},en.dmg,"enemy",id);
            this.broadcastFx({kind:"ability",x:en.x,y:en.y,text:"360 SHOCK",color:moon.accent,range:shockR});en.atkCd=1.6;en.attackAnim=.30;
          }
          if((en._forestCd||0)<=0&&d<980){
            for(let i=0;i<12;i++){const q=(i/12)*TAU+this.state.worldTime*.18;this.addProjectile({x:en.x+Math.cos(q)*(en.r+18),y:en.y+Math.sin(q)*(en.r+18),vx:Math.cos(q)*410,vy:Math.sin(q)*410,life:1.75,r:12,hostile:true,kind:"forestThorn",color:moon.color,dmg:Math.max(14,en.dmg*.55),ownerId:id,petBlast:false,knock:0});}
            this.broadcastFx({kind:"ability",x:en.x,y:en.y,text:`${moon.element.toUpperCase()} RING`,color:moon.color,range:en.r+110});en._forestCd=rand(1.9,2.6);
          }
          if((en._moonNovaCd||0)<=0&&d<1050){
            for(let i=0;i<20;i++){const q=(i/20)*TAU+Math.PI/20;this.addProjectile({x:en.x+Math.cos(q)*(en.r+24),y:en.y+Math.sin(q)*(en.r+24),vx:Math.cos(q)*330,vy:Math.sin(q)*330,life:2,r:13,hostile:true,kind:"forestThorn",color:moon.accent,dmg:Math.max(16,en.dmg*.48),ownerId:id,petBlast:false,knock:0});}
            this.broadcastFx({kind:"ability",x:en.x,y:en.y,text:"MOON NOVA 360",color:moon.accent,range:en.r+185});en._moonNovaCd=rand(3.5,4.4);
          }
        }else if(en.ranged){const desired=en.weapon==="Bow"?235:205;en.strafeT-=dt;if(en.strafeT<=0){en.strafeDir*=-1;en.strafeT=rand(.7,1.7);}if(d>desired+42){en.x+=Math.cos(a)*en.speed*.92*dt;en.y+=Math.sin(a)*en.speed*.92*dt;}else if(d<desired-34){en.x-=Math.cos(a)*en.speed*.82*dt;en.y-=Math.sin(a)*en.speed*.82*dt;}else{const q=a+en.strafeDir*Math.PI/2;en.x+=Math.cos(q)*en.speed*.62*dt;en.y+=Math.sin(q)*en.speed*.62*dt;}if(en.atkCd<=0){const isBow=en.weapon==="Bow";this.addProjectile({x:en.x+Math.cos(a)*(en.r+10),y:en.y+Math.sin(a)*(en.r+10),vx:Math.cos(a)*(isBow?560:470),vy:Math.sin(a)*(isBow?560:470),life:isBow?1.15:1.3,r:isBow?4.5:6,hostile:true,kind:isBow?"enemyArrow":"arcaneBolt",color:isBow?"#8fd4ff":"#c77dff",dmg:en.dmg,ownerId:id,petBlast:false,knock:0});en.atkCd=isBow?rand(1.25,1.55):rand(1.6,1.95);en.attackAnim=.28;}}
        else if(d>en.r+tr-3){en.x+=Math.cos(a)*en.speed*dt;en.y+=Math.sin(a)*en.speed*dt;}else if(en.atkCd<=0){this.damageTarget(ref,en.dmg,"enemy",id);en.atkCd=en.weapon==="Sword"?.72:.85;en.attackAnim=.22;}
      }else{en.wanderT-=dt;if(en.wanderT<=0){en.wanderA=Math.random()<.55?angTo(en.x,en.y,WORLD_W*.5+rand(-WORLD_W*.3,WORLD_W*.3),WORLD_H*.5+rand(-WORLD_H*.3,WORLD_H*.3)):rand(0,TAU);en.wanderT=rand(1.5,3.5);}smoothTurn(en,en.wanderA,dt,6);en.x+=Math.cos(en.angle)*en.speed*.55*dt;en.y+=Math.sin(en.angle)*en.speed*.55*dt;}
      if(en.moonMarked){en.x=Number(en._moonAnchorX)||en.x;en.y=Number(en._moonAnchorY)||en.y;}else{this.resolveEnemyCreatureContacts(en);this.resolveStatic(en,en.r*.9);}
      // A non-riding guard is a separate body; never let it sit inside its cube.
      const gid=this.enemyPetByEnemy.get(id),guard=gid&&this.state.animals.get(gid);
      if(guard&&en.ridingPetId!==gid){let best=null,bestOverlap=0;for(const h of animalPhysicalCircles(guard)){const d=dist(en.x,en.y,h.x,h.y),overlap=(en.r||18)+h.r+12-d;if(overlap>bestOverlap){bestOverlap=overlap;best={h,d,overlap};}}if(best&&best.d>.01){const a=angTo(en.x,en.y,best.h.x,best.h.y);guard.x+=Math.cos(a)*best.overlap;guard.y+=Math.sin(a)*best.overlap;this.resolveStatic(guard,(guard.r||18)*.68);}}
    }
  }

  updateProjectiles(dt){
    const dynKinds=new Set(["enemy","animal"]);
    for(const[id,p]of this.state.projectiles){
      p.life-=dt;
      if(p.kind==="throwAxe"){
        if(!p.returning&&p.life<=THROW_AXE_RETURN_AT)p.returning=true;
        if(p.returning){const owner=this.state.players.get(p.ownerId);if(!owner||owner.dead){this.state.projectiles.delete(id);continue;}const dx=owner.x-p.x,dy=owner.y-p.y,d=Math.hypot(dx,dy);if(d<28||p.life<=0){this.state.projectiles.delete(id);continue;}p.vx=dx/Math.max(1,d)*THROW_AXE_RETURN_SPEED;p.vy=dy/Math.max(1,d)*THROW_AXE_RETURN_SPEED;}
      }
      if((p.kind==="tornado"||p.kind==="iceShard")&&p._targetRef&&this.abilityStatusAlive(p._targetRef)){const o=this.targetObject(p._targetRef),ta=angTo(p.x,p.y,o.x,o.y),spd=p.kind==="tornado"?330:560,cur=Math.atan2(p.vy,p.vx),delta=Math.atan2(Math.sin(ta-cur),Math.cos(ta-cur)),na=cur+clamp(delta,-2.8*dt,2.8*dt);p.vx=Math.cos(na)*spd;p.vy=Math.sin(na)*spd;}else if(p.kind==="tornado"){p._wander=(Number(p._wander)||Math.atan2(p.vy,p.vx))+Math.sin((this.state.worldTime+(p._wanderSeed||0))*3.4)*.9*dt;const spd=300;p.vx=Math.cos(p._wander)*spd;p.vy=Math.sin(p._wander)*spd;}
      const x0=p.x,y0=p.y,x1=p.x+p.vx*dt,y1=p.y+p.vy*dt;
      p.x=x1;p.y=y1;
      if(p.life<=0||p.x<0||p.y<0||p.x>WORLD_W||p.y>WORLD_H){this.state.projectiles.delete(id);continue;}
      if(p.kind==="throwAxe"&&p.returning)continue;
      let best={t:2,type:""};
      const consider=(t,type,data)=>{if(t!=null&&t<best.t)best={t,type,...data};};

      if(p.hostile){
        for(const[pid,pl]of this.state.players){if(pl.dead)continue;consider(segmentCircleT(x0,y0,x1,y1,pl.x,pl.y,p.r+PLAYER_R),"player",{pid,pl});}
        for(const[petId,pet]of this.state.pets){if(pet.dead)continue;consider(animalProjectileSegmentT(pet,x0,y0,x1,y1,p.r),"pet",{petId,pet});}
        const mx=(x0+x1)*.5,my=(y0+y1)*.5,range=Math.hypot(x1-x0,y1-y0)*.5+180;
        for(const rec of this.nearbyDynamic(mx,my,range,new Set(["animal"]))){
          if(this.enemyOwnerByPet.has(rec.id))continue; // hostile cubes don't shoot their own guard animals
          if(p.kind==="tornado"&&p._sourceAnimalId&&rec.id===p._sourceAnimalId)continue; // wild Clouded Leopard is immune to its own tornado
          consider(animalProjectileSegmentT(rec.obj,x0,y0,x1,y1,p.r),"wild",{aid:rec.id,a:rec.obj});
        }
      }else{
        for(const[pid,pl]of this.state.players){if(pid===p.ownerId||pl.dead)continue;consider(segmentCircleT(x0,y0,x1,y1,pl.x,pl.y,p.r+PLAYER_R),"pvp",{pid,pl});}
        const mx=(x0+x1)*.5,my=(y0+y1)*.5,range=Math.hypot(x1-x0,y1-y0)*.5+180;
        for(const rec of this.nearbyDynamic(mx,my,range,dynKinds)){
          if(rec.kind==="enemy")consider(segmentCircleT(x0,y0,x1,y1,rec.obj.x,rec.obj.y,p.r+rec.obj.r),"enemy",{eid:rec.id,en:rec.obj});
          else consider(animalProjectileSegmentT(rec.obj,x0,y0,x1,y1,p.r),"wild",{aid:rec.id,a:rec.obj});
        }
      }

      // Static world pieces compete by hit order, so a tree/rock in front of an animal blocks the shot.
      const mx=(x0+x1)*.5,my=(y0+y1)*.5,travel=Math.hypot(x1-x0,y1-y0),range=travel*.5+150;
      for(const solid of this.nearbySolids(mx,my,range)){
        if(solid.kind==="water")continue;
        if(solid.kind==="resource"){const r=this.state.resources.get(solid.id);if(!r||!r.alive)continue;}
        if(solid.kind==="gold"){const g=this.state.gold.get(solid.id);if(!g||(!g.infinite&&g.goldLeft<=0))continue;}
        if(solid.kind==="chest"){const c=this.state.chests.get(solid.id);if(!c||c.opened)continue;}
        consider(segmentCircleT(x0,y0,x1,y1,solid.x,solid.y,p.r+solid.r*.94),"solid",{solid});
      }
      for(const[wid,w]of this.state.walls){if(w.hp<=0||isPlacedVehicleWall(w))continue;consider(segmentCircleT(x0,y0,x1,y1,w.x,w.y,p.r+w.r),"wall",{wid,w});}

      if(best.t<=1){
        p.x=x0+(x1-x0)*best.t;p.y=y0+(y1-y0)*best.t;
        if(best.type==="player"){if(p.petBlast&&p.sourcePetId)this.petAbilityDamage({kind:"player",id:best.pid},p.dmg,p.ownerId,p.sourcePetId);else this.damageTarget({kind:"player",id:best.pid},p.dmg,"projectile",p.ownerId);}
        else if(best.type==="pet"){if(p.petBlast&&p.sourcePetId)this.petAbilityDamage({kind:"pet",id:best.petId},p.dmg,p.ownerId,p.sourcePetId);else this.damageTarget({kind:"pet",id:best.petId},p.dmg,"projectile",p.ownerId);}
        else if(best.type==="pvp"){if(p.petBlast&&p.sourcePetId)this.petAbilityDamage({kind:"player",id:best.pid},p.dmg,p.ownerId,p.sourcePetId);else this.damageTarget({kind:"player",id:best.pid},p.dmg,"playerProjectile",p.ownerId);this.broadcastFx({kind:"hit",x:best.pl.x,y:best.pl.y-8,text:Math.round(p.dmg),color:"#8fd4ff"});}
        else if(best.type==="enemy"){if(p.petBlast&&p.sourcePetId)this.petAbilityDamage({kind:"enemy",id:best.eid},p.dmg,p.ownerId,p.sourcePetId);else this.hitEnemy(best.eid,best.en,p.dmg,p.ownerId,false,p.sourcePetId?{kind:"pet",id:p.sourcePetId}:null);if(p.knock&&this.state.enemies.has(best.eid)){const a=Math.atan2(p.vy,p.vx);best.en.x+=Math.cos(a)*p.knock;best.en.y+=Math.sin(a)*p.knock;}}
        else if(best.type==="wild"){
          if(p.hostile){const a=best.a,dmg=animalDamageTaken(a.type,a.stage,p.dmg);a.hp=Math.max(0,a.hp-dmg);a.flash=.12;a.recentHit=4;this.markWildStayAwake(a,6.5);a.sleeping=false;a.enraged=true;a.combat=8;if(a.hp>0&&this.state.enemies.has(p.ownerId))this.setWildReactionToAttacker(best.aid,a,{kind:"enemy",id:p.ownerId});if(a.hp<=0){this.awardPetXpContributors("animal",best.aid,a,"");this.broadcastSpectateKill("animal",best.aid,"projectile",p.ownerId);this.state.animals.delete(best.aid);this.animalAggro.delete(best.aid);this.animalFleeFrom.delete(best.aid);}}
          else{if(p.petBlast&&p.sourcePetId)this.petAbilityDamage({kind:"animal",id:best.aid},p.dmg,p.ownerId,p.sourcePetId);else this.hitWild(best.aid,best.a,p.dmg,p.ownerId,false,p.sourcePetId?{kind:"pet",id:p.sourcePetId}:null);if(p.knock&&this.state.animals.has(best.aid)){const q=Math.atan2(p.vy,p.vx),push=p.knock*animalKnockbackScale(best.a);best.a.x+=Math.cos(q)*push;best.a.y+=Math.sin(q)*push;this.resolveStatic(best.a,(best.a.r||18)*.68);}}
        }
        else if(best.type==="solid"&&(p.kind==="throwAxe"||p.kind==="arrow")&&best.solid?.kind==="resource"){
          const c=this.clientById(p.ownerId),r=this.state.resources.get(best.solid.id);
          if(c&&r&&r.alive)this.handleResourceHit(c,{id:best.solid.id,tool:p.kind==="arrow"?"Bow":"Axe",tier:p.toolTier},{projectile:true,skipHydration:true});
        }
        if(p.kind==="chakram"&&["enemy","wild","pvp"].includes(best.type)){
          const owner=this.state.players.get(p.ownerId),variant=this.buildVariantForOwner(p.ownerId,"Chakrams");
          if(owner&&variant==="emerald")owner.health=Math.min(owner.maxHealth,owner.health+Math.max(1,(Number(p.dmg)||0)*.22));
        }
        else if(best.type==="solid"&&p.petBlast&&best.solid?.kind==="resource"&&p.sourcePetId){const pet=this.state.pets.get(p.sourcePetId),r=this.state.resources.get(best.solid.id);if(pet&&r)this.petHitResource(p.ownerId,pet,best.solid.id,r,true);}
        if(p.hostile&&p.kind==="tornado"){
          let ref=null,hit=null;if(best.type==="player"){ref={kind:"player",id:best.pid};hit=best.pl;}else if(best.type==="pet"){ref={kind:"pet",id:best.petId};hit=best.pet;}else if(best.type==="wild"){ref={kind:"animal",id:best.aid};hit=best.a;}
          if(ref&&this.abilityStatusAlive(ref)){this.applyTornadoTrap(ref,2.2,p.x,p.y);this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:String(p._sourceAnimalId||""),elem:"Wind",fxType:"tornadoTrap",x:p.x,y:p.y,targetX:hit?.x||p.x,targetY:hit?.y||p.y,r:Math.max(30,(hit?.r||PLAYER_R)+18),life:2.2});}
        }
        if(p.petBlast&&p.sourcePetId&&(p.kind==="owlSound"||p.kind==="poison"||p.kind==="tornado")){
          const source=this.state.pets.get(p.sourcePetId),stats=source?petAbilityStats(source):{};let ref=null;
          if(best.type==="enemy")ref={kind:"enemy",id:best.eid};else if(best.type==="wild")ref={kind:"animal",id:best.aid};else if(best.type==="pvp")ref={kind:"player",id:best.pid};
          if(ref&&this.abilityStatusAlive(ref)){if(p.kind==="owlSound")this.applyAbilityStun(ref,stats.stun||2);else if(p.kind==="tornado"){this.applyTornadoTrap(ref,2.2,p.x,p.y);const hit=this.targetObject(ref);this.broadcast("abilityEvent",{petId:p.sourcePetId,ownerId:p.ownerId,elem:"Wind",fxType:"tornadoTrap",x:p.x,y:p.y,targetX:hit?.x||p.x,targetY:hit?.y||p.y,r:Math.max(30,(hit?.r||PLAYER_R)+18),life:2.2});}else this.applyAbilityPoison(ref,p.dmg,p.ownerId,p.sourcePetId);}
        }
        if(p.kind==="throwAxe"){p.returning=true;p.life=Math.max(p.life,.72);}else this.state.projectiles.delete(id);
      }
    }
  }

  updateWallsTowers(dt){
    const now=this.state.worldTime;
    const wallEnemyKinds=new Set(["enemy"]),spikeKinds=new Set(["enemy","animal"]);
    for(const[id,w]of this.state.walls){
      if(w.ttl>0)w.ttl-=dt;
      const owner=w.ownerId?this.state.players.get(w.ownerId):null;
      if(owner&&owner.dead&&w.ttl===-1&&!w.sourcePetId){w.hp=Math.max(0,w.hp-(Math.max(1,w.maxHp||w.hp||72)/75)*dt);}
      if(w.hp<=0||(w.ttl!==-1&&w.ttl<=0)){this.state.walls.delete(id);this.hostileWildWalls.delete(id);continue;}
      if(isPlacedVehicleWall(w))continue;
      const wk=String(w.kind||"");
      if(owner&&!owner.dead&&wk.startsWith("windmill")){
        const m=wk.match(/^windmill(\d)(?:@([a-z]+))?/),tier=clamp(Number(m?.[1])||0,0,3),v=String(m?.[2]||"");let amount=[1,2,3,4][tier],interval=[12,9,6,5][tier];if(tier>=3&&v==="ruby")amount=7;if(tier>=3&&v==="emerald")interval=3.2;if(tier>=3&&v==="diamond"){amount=5;interval=4.5;}
        if(!Number.isFinite(w._incomeNext))w._incomeNext=now+interval;
        if(now>=w._incomeNext){w._incomeNext=now+interval;owner.gold=Math.max(0,(owner.gold||0)+amount);const c=this.clientById(w.ownerId);if(c)c.send("resourceReward",{kind:"gold",amount,x:w.x,y:w.y,source:"windmill"});}
      }else if(owner&&!owner.dead&&wk.startsWith("repair")){
        const tier=clamp(Number((wk.match(/^repair(\d)/)||[])[1])||0,0,3),rate=[3,5.5,8.5,13][tier]*dt;
        for(const[,b]of this.state.walls){if(b===w||b.ownerId!==w.ownerId||b.hp<=0)continue;b.hp=Math.min(b.maxHp,b.hp+rate);}
        for(const[,t]of this.state.towers){if(t.ownerId!==w.ownerId||t.hp<=0)continue;t.hp=Math.min(t.maxHp,t.hp+rate);}
        w.hp=Math.min(w.maxHp,w.hp+rate*.35);
      }else if(owner&&!owner.dead&&wk==="wall3@emerald")w.hp=Math.min(w.maxHp,w.hp+2.5*dt);

      // Hostile cubes can eventually break any wall they are pressing against.
      let breaker=null;
      for(const rec of this.nearbyDynamic(w.x,w.y,w.r+90,wallEnemyKinds)){const en=rec.obj;if(!en||en.dead)continue;if(dist(w.x,w.y,en.x,en.y)<=w.r+en.r+4){breaker={eid:rec.id,en};break;}}
      if(breaker){const key=`${id}:${breaker.eid}`,next=this.wallEnemyNext.get(key)||0;if(now>=next){const wd=Math.max(2.5,(breaker.en.dmg||6)*.7)*(String(w.kind||"")==="wall3@diamond"?.62:1);w.hp=Math.max(0,w.hp-wd);if(String(w.kind||"")==="wall3@ruby")this.hitEnemy(breaker.eid,breaker.en,10,w.ownerId,false,null);this.wallEnemyNext.set(key,now+.9);this.broadcastFx({kind:"hit",x:w.x,y:w.y,text:Math.round(wd),color:w.kind==="stoneSpike"?"#d9e0e6":"#c99a5b"});if(w.hp<=0){this.state.walls.delete(id);this.hostileWildWalls.delete(id);continue;}}}

      if(w.spiked&&w.spikeDmg>0){
        // Per-target contact timers: anything that stays on the spikes keeps
        // taking damage every half-second until it moves away. Multiple targets
        // can be hurt by the same wall at the same time.
        for(const rec of this.nearbyDynamic(w.x,w.y,w.r+110,spikeKinds)){
          const o=rec.obj;if(!o)continue;
          const contact=rec.kind==="enemy"
            ?(!o.dead&&dist(w.x,w.y,o.x,o.y)<=w.r+o.r+3)
            :(w.sourcePetId&&o.hp>0&&animalProjectileTouch(o,w.x,w.y,w.r+2));
          if(!contact)continue;
          const key=`${id}:${rec.kind}:${rec.id}`,next=this.wallSpikeNext.get(key)||0;
          if(now<next)continue;
          if(rec.kind==="enemy")this.hitEnemy(rec.id,o,w.spikeDmg,w.ownerId,false,w.sourcePetId?{kind:"pet",id:w.sourcePetId}:null);
          else this.hitWild(rec.id,o,w.spikeDmg,w.ownerId,false,{kind:"pet",id:w.sourcePetId});
          this.wallSpikeNext.set(key,now+.50);
        }
        // Player-owned pet spike walls (including Walrus prisons) can hurt enemy players/pets on contact.
        if(w.sourcePetId&&w.ownerId){
          for(const[pid,pl]of this.state.players){if(pid===w.ownerId||pl.dead||dist(w.x,w.y,pl.x,pl.y)>w.r+PLAYER_R)continue;const key=`${id}:player:${pid}`,next=this.wallSpikeNext.get(key)||0;if(now<next)continue;this.damageTarget({kind:"player",id:pid},w.spikeDmg,"pet",w.sourcePetId);this.wallSpikeNext.set(key,now+.50);}
          for(const[petId,pet]of this.state.pets){if(pet.ownerId===w.ownerId||pet.dead||!animalProjectileTouch(pet,w.x,w.y,w.r+2))continue;const key=`${id}:pet:${petId}`,next=this.wallSpikeNext.get(key)||0;if(now<next)continue;this.damageTarget({kind:"pet",id:petId},w.spikeDmg,"pet",w.sourcePetId);this.wallSpikeNext.set(key,now+.50);}
        }
        // A wild spike wall can repeatedly damage every player or pet who remains on it.
        const wildAnimalId=this.hostileWildWalls.get(id);
        if(wildAnimalId){
          for(const[pid,pl]of this.state.players){
            if(pl.dead||dist(w.x,w.y,pl.x,pl.y)>w.r+PLAYER_R)continue;
            const key=`${id}:player:${pid}`,next=this.wallSpikeNext.get(key)||0;
            if(now<next)continue;
            this.damageTarget({kind:"player",id:pid},w.spikeDmg||10,"animal",wildAnimalId);
            this.wallSpikeNext.set(key,now+.50);
          }
          for(const[petId,pet]of this.state.pets){
            if(pet.dead||!animalProjectileTouch(pet,w.x,w.y,w.r+2))continue;
            const key=`${id}:pet:${petId}`,next=this.wallSpikeNext.get(key)||0;
            if(now<next)continue;
            this.damageTarget({kind:"pet",id:petId},w.spikeDmg||10,"animal",wildAnimalId);
            this.wallSpikeNext.set(key,now+.50);
          }
        }
      }
    }
    for(const[id,t]of this.state.towers){
      const owner=t.ownerId?this.state.players.get(t.ownerId):null;
      if(owner&&owner.dead){t.hp=Math.max(0,t.hp-(Math.max(1,t.maxHp||t.hp||120)/75)*dt);if(t.hp<=0){this.state.towers.delete(id);continue;}}
      if(t.kind==="battlebot"){
        if(owner&&!owner.dead){const od=dist(t.x,t.y,owner.x,owner.y);if(od>105){const a=angTo(t.x,t.y,owner.x,owner.y),spd=88+clamp(Number(t.tier)||0,0,3)*10;t.angle=a;t.x=clamp(t.x+Math.cos(a)*spd*dt,20,WORLD_W-20);t.y=clamp(t.y+Math.sin(a)*spd*dt,20,WORLD_H-20);this.resolveStatic(t,18);}}
        t.cd-=dt;if(t.cd>0)continue;const tier=clamp(Math.floor(Number(t.tier)||0),0,3),v=String(t.variant||""),range=tier>=3&&v==="water"?650:[285,325,365,380][tier];
        let target=null,best=range;
        for(const rec of this.nearbyDynamic(t.x,t.y,range+100,new Set(["enemy","animal"]))){const o=rec.obj;if(!o||o.dead||o.hp<=0)continue;const d=dist(t.x,t.y,o.x,o.y);if(d<best){best=d;target={kind:rec.kind==="animal"?"animal":"enemy",id:rec.id,obj:o};}}
        for(const[pid,pl]of this.state.players){if(pid===t.ownerId||pl.dead)continue;const d=dist(t.x,t.y,pl.x,pl.y);if(d<best){best=d;target={kind:"player",id:pid,obj:pl};}}
        if(!target){t.cd=.18;continue;}
        let dmg=[22,30,38,42][tier],cd=[.85,.72,.60,.58][tier];if(tier>=3&&v==="water"){dmg=34;cd=.56;}else if(tier>=3&&v==="fire"){dmg=48;cd=.64;}else if(tier>=3&&v==="lightning"){dmg=58;cd=.78;}else if(tier>=3&&v==="plant"){dmg=35;cd=.62;}else if(tier>=3&&v==="void"){dmg=45;cd=.75;}else if(tier>=3&&v==="light"){dmg=39;cd=.58;}
        const before=target.kind==="player"?target.obj.health:target.obj.hp;
        if(target.kind==="enemy")this.hitEnemy(target.id,target.obj,dmg,t.ownerId,false,null);else if(target.kind==="animal")this.hitWild(target.id,target.obj,dmg,t.ownerId,false,null);else this.damageTarget({kind:"player",id:target.id},dmg,"projectile",t.ownerId);
        const after=target.kind==="player"?target.obj.health:target.obj.hp,dealt=Math.max(0,(Number(before)||0)-(Number(after)||0)),ref={kind:target.kind,id:target.id};
        if(v==="fire"&&this.abilityStatusAlive(ref))this.applyAbilityFixedDot(ref,Math.max(18,dealt*.65),5,t.ownerId,"","");
        else if(v==="lightning")this.applyAbilityStun(ref,4);
        else if(v==="plant"&&owner){owner.health=Math.min(owner.maxHealth,owner.health+dealt);for(const[,pet]of this.state.pets)if(pet.ownerId===t.ownerId&&!pet.dead)pet.hp=Math.min(pet.maxHp,pet.hp+dealt);}
        else if((v==="void"||v==="light")&&target.obj){const rr=120,force=v==="void"?60:72;for(const rec of this.nearbyDynamic(target.obj.x,target.obj.y,rr,new Set(["enemy","animal"]))){const o=rec.obj;if(!o||o.dead)continue;const a=v==="void"?angTo(o.x,o.y,target.obj.x,target.obj.y):angTo(target.obj.x,target.obj.y,o.x,o.y),mul=rec.kind==="animal"?animalKnockbackScale(o):1;o.x=clamp(o.x+Math.cos(a)*force*mul,20,WORLD_W-20);o.y=clamp(o.y+Math.sin(a)*force*mul,20,WORLD_H-20);this.resolveStatic(o,(o.r||18)*.68);}this.broadcast("abilityEvent",{petId:"",ownerId:t.ownerId,wildAnimalId:"",elem:v==="void"?"Void":"Light",fxType:"pulse",x:target.obj.x,y:target.obj.y,range:rr,life:.55});}
        t.angle=angTo(t.x,t.y,target.obj.x,target.obj.y);t.cd=cd;this.broadcastFx({kind:"ability",x:target.obj.x,y:target.obj.y,text:v?v.toUpperCase():"BOT",color:v==="fire"?"#ff754d":v==="lightning"?"#ffe56b":v==="plant"?"#77dd72":v==="void"?"#b27cff":v==="light"?"#fff2a3":"#64cfff"});continue;
      }
      t.cd-=dt;if(t.cd>0)continue;const tier=clamp(Math.floor(Number(t.tier)||0),0,3),variant=String(t.variant||""),range=tier>=3&&variant==="diamond"?460:tier>=3?400:tier>=2?380:tier>=1?310:250;let target=null,best=range;
      for(const rec of this.nearbyDynamic(t.x,t.y,range+120,new Set(["enemy","animal"]))){const o=rec.obj;if(!o||o.dead||o.hp<=0)continue;const d=dist(t.x,t.y,o.x,o.y);if(d<best){best=d;target={kind:rec.kind,id:rec.id,obj:o};}}
      for(const[pid,pl]of this.state.players){if(pid===t.ownerId||pl.dead)continue;const d=dist(t.x,t.y,pl.x,pl.y);if(d<best){best=d;target={kind:"player",id:pid,obj:pl};}}
      if(!target)continue;const a=angTo(t.x,t.y,target.obj.x,target.obj.y),dmg=tier>=3?(variant==="ruby"?31:24):tier>=2?19:tier>=1?14:9,speed=tier>=2?650:tier>=1?570:510;
      this.addProjectile({x:t.x+Math.cos(a)*18,y:t.y+Math.sin(a)*18,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:1.05,r:tier>=2?6:5,hostile:false,kind:"towerRock",color:variant==="ruby"?"#ef5b62":variant==="emerald"?"#5dde84":variant==="diamond"?"#b7edff":tier>=1?"#aeb7bf":"#8f8174",dmg,ownerId:t.ownerId,petBlast:false,knock:0});
      if(variant==="emerald"&&owner){owner.health=Math.min(owner.maxHealth,owner.health+3);for(const[,pet]of this.state.pets)if(pet.ownerId===t.ownerId&&!pet.dead&&dist(t.x,t.y,pet.x,pet.y)<280)pet.hp=Math.min(pet.maxHp,pet.hp+3);}
      t.cd=tier>=3&&variant==="diamond"?.44:tier>=3?.55:tier>=2?.58:tier>=1?.76:1.0;
    }
  }

  triggerFirstLight(){
    if(!this.firstLightReadyPlayers.size)return;
    for(const playerId of Array.from(this.firstLightReadyPlayers)){
      const p=this.state.players.get(playerId);if(!p||p.dead)continue;
      p.health=Math.min(p.maxHealth,p.health+Math.min(30,p.maxHealth*.30));
      for(const[,pet]of this.state.pets)if(pet.ownerId===playerId&&!pet.dead)pet.hp=Math.min(pet.maxHp,pet.hp+pet.maxHp*.22);
      for(const[id,en]of this.state.enemies){
        const d=dist(p.x,p.y,en.x,en.y);if(d>720||d<.01)continue;
        const a=angTo(p.x,p.y,en.x,en.y),push=95*(1-Math.min(.55,d/1500));en.x+=Math.cos(a)*push;en.y+=Math.sin(a)*push;en.hp=Math.max(0,en.hp-16);en.flash=.16;
        if(en.hp<=0){this.awardPetXpContributors("enemy",id,en,"");this.releaseEnemyGuardToWild(id);this.state.enemies.delete(id);this.enemyAggro.delete(id);}
      }
      const c=this.clientById(playerId);if(c)c.send("firstLight",{x:p.x,y:p.y});
      this.broadcastFx({kind:"ability",x:p.x,y:p.y,text:"FIRST LIGHT",color:"#fff2a6"});
    }
    this.firstLightReadyPlayers.clear();
  }

  updateTime(dt){
    this.state.worldTime+=dt;
    this.state.phaseTimer-=dt;
    if(this.state.phaseTimer<=0){
      this.state.dayPhase=(this.state.dayPhase+1)%TIME_PHASES.length;
      if(this.state.dayPhase===0)this.state.dayCount++;
      const phase=TIME_PHASES[this.state.dayPhase];
      this.state.phaseTimer=phase.duration;
      if(phase.spawn)this.waveTimer=Math.min(this.waveTimer||0,.65);
      if(phase.name==="Dawn")this.midnightMarkSpawned=false;
      if(phase.name==="Night")this.breedHiveBeesEveryTenNights();
      if(phase.name==="Midnight"){const hasMoon=Array.from(this.state.enemies.values()).some(en=>en&&en.hp>0&&en.moonMarked);if(this.state.dayCount%5===0&&!hasMoon){const moonBiome=randomBiomeZoneId(),mid=this.addEnemy(true,null,"",true,moonBiome);if(mid){const boss=this.state.enemies.get(mid);if(boss)this.broadcast("moonmarkSpawned",{id:mid,x:boss.x,y:boss.y,biome:boss.moonBiome||moonBiome,boss:boss.role,day:this.state.dayCount});}}}
      if(phase.name==="Morning"){this.startWildMorningBreeding();this.triggerFirstLight();for(const[pid,pl]of this.state.players)if(pl&&!pl.dead&&this.playerNightSeen.has(pid))this.recordAccountAchievement(pid,"survive_night",{});this.playerNightSeen.clear();}
      this.broadcast("phaseEvent",{phase:this.state.dayPhase,dayCount:this.state.dayCount});
    }
    const phase=TIME_PHASES[this.state.dayPhase];
    if(phase.spawn){
      this.waveTimer-=dt;
      if(this.waveTimer<=0){
        this.state.wave++;
        let base=3,cap=9,interval=10.5;
        if(phase.name==="Night"){base=4;cap=12;interval=8.0;}
        if(phase.name==="Midnight"){base=4;cap=12;interval=5.8;}
        this.waveTimer=interval;
        const count=Math.min(base+Math.floor(this.state.wave*1.35),cap);
        for(let i=0;i<count&&this.state.enemies.size<70;i++)this.addEnemy(phase.strong);
        if(phase.name==="Midnight"&&Math.random()<.38)for(let i=0;i<2&&this.state.enemies.size<70;i++)this.addEnemy(true);
      }
    }
  }
  update(dt){
    // Stability guard: bound dt so a stalled process never tries to catch up in one giant tick.
    if(!Number.isFinite(dt)||dt<0)dt=0;
    dt=Math.min(dt,.05);
    this.updateTime(dt);
    this.updateAbilityStatuses(dt);
    this.updateActivePetAbilities(dt);
    this.updateActiveWildAbilities(dt);
    for(const[id,p]of this.state.players){
      p.animalCarryT=0;const regen=this.runPerks(id).regen;
      if(regen>0&&!p.dead&&p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+regen*dt);
      if(!p.dead&&(Number(p._jungleHotUntil)||0)>this.state.worldTime&&p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+(Number(p._jungleHotRate)||4)*dt);
      if(!p.dead&&(Number(p._cactusGoodUntil)||0)>this.state.worldTime){if(p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+(Number(p._cactusHealRate)||2.6)*dt);p.hydration=clamp((Number(p.hydration)||0)+(Number(p._cactusHydrateRate)||3.8)*dt,0,100);}
      if(!p.dead&&(Number(p._badCactusUntil)||0)>this.state.worldTime){p.health=Math.max(0,p.health-(Number(p._badCactusDamageRate)||2.5)*dt);p.hydration=clamp((Number(p.hydration)||0)-(Number(p._badCactusHydrateRate)||4.5)*dt,0,100);if(p.health<=0)this.damageTarget({kind:"player",id},999,"world","");}if(!p.dead&&(Number(p._mountedCactusHydrateUntil)||0)>this.state.worldTime)p.hydration=clamp((Number(p.hydration)||0)+(Number(p._mountedCactusHydrateRate)||3.8)*dt,0,100);if(!p.dead&&(Number(p._mountedBadCactusUntil)||0)>this.state.worldTime)p.hydration=clamp((Number(p.hydration)||0)-(Number(p._mountedBadCactusHydrateRate)||4.5)*dt,0,100);if(!p.dead&&(Number(p._honeyHealUntil)||0)>this.state.worldTime&&p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+(Number(p._honeyHealRate)||4.6)*dt);
      {
        const biome=worldBiomeAt(p.x,p.y),depth=biome==="ocean"?oceanDepthAt(p.x,p.y):0,nearShore=biome!=="ocean"||depth<=OCEAN_SURFACE_NEAR_SHORE;
        const onFloor=!p.vehicleType&&biome==="ocean"&&depth>=OCEAN_DIVE_START&&!nearShore,waterPower=(Number(p._blueSeaweedUntil)||0)>this.state.worldTime,suit=Number(p.divingSuitTier)>=0;
        if(suit){const max=divingSuitOxygenMaxServer(p);p.oxygenMax=max;if(!Number.isFinite(Number(p.oxygen)))p.oxygen=max;if(nearShore)p.oxygen=Math.min(max,(Number(p.oxygen)||0)+Math.max(10,max*.24)*dt);else if(onFloor&&!waterPower)p.oxygen=Math.max(0,(Number(p.oxygen)||0)-divingSuitOxygenDrainMulServer(p)*dt);}
        else{p.oxygen=0;p.oxygenMax=0;}
        if(!p.dead&&!p.vehicleType&&biome==="ocean"&&!waterPower){
          const outOfAir=suit&&onFloor&&(Number(p.oxygen)||0)<=.001;let rate=suit?(outOfAir?Math.max(6,oceanDepthDamageRateAt(p.x,p.y))*divingSuitSuffocationMulServer(p):0):oceanDepthDamageRateAt(p.x,p.y);
          if(rate>0){
            // Deep-ocean pressure / empty oxygen damages the player directly; riding a pet
            // is not a substitute for a Boat/Sub. Temporarily detach the mount from damage routing.
            const mountId=p.ridingPetId;p.ridingPetId="";this.damageTarget({kind:"player",id},rate*dt,"world","");
            if(!p.dead&&mountId){const mount=this.state.pets.get(mountId);if(mount&&!mount.dead&&mount.ownerId===id)p.ridingPetId=mountId;}
          }
        }
      }
      if(!p.dead){if((p._cactusSpineCd||0)>0)p._cactusSpineCd=Math.max(0,(p._cactusSpineCd||0)-dt);if(!(p._cactusSpineCd>0)){for(const[,r]of this.state.resources){if(!r||!r.alive||(r.type!=="desertCactusGood"&&r.type!=="desertCactusBad"))continue;const c=resourceCenter(r);if(dist(p.x,p.y,c.x,c.y)<(r.solidR||12)+12){p._cactusSpineCd=.7;this.damageTarget({kind:"player",id},3,"world","");break;}}}const activePhase=TIME_PHASES[this.state.dayPhase]?.name||"";if(activePhase==="Night"||activePhase==="Midnight")this.playerNightSeen.add(id);const t=(this.playerSurvivalSeconds.get(id)||0)+dt;this.playerSurvivalSeconds.set(id,t);let awards=this.playerSurvivalAwards.get(id);if(!awards){awards=new Set();this.playerSurvivalAwards.set(id,awards);}if(t>=300&&!awards.has("survive_5")){awards.add("survive_5");this.recordAccountAchievement(id,"survive_5",{});}if(t>=600&&!awards.has("survive_10")){awards.add("survive_10");this.recordAccountAchievement(id,"survive_10",{});}}
    }
    for(const[id,left]of this.resourceRespawns){
      const n=left-dt;
      if(n<=0){
        const r=this.state.resources.get(id);
        if(r&&this.respawnResourceElsewhere(id,r))this.resourceRespawns.delete(id);
        else if(r)this.resourceRespawns.set(id,rand(4,8));
        else this.resourceRespawns.delete(id);
      } else this.resourceRespawns.set(id,n);
    }
    for(const[,c]of this.state.chests)c.pulse=Math.max(0,c.pulse-dt*3);
    this.updateAnimals(dt);this.updatePets(dt);this.resolveAnimalAnimalCollisions();
    this.state.wildlifeCount=this.state.animals.size;
    this.updateEnemies(dt);this.rebuildDynamicGrid();this.applyPlayerCreaturePushes();
    this.updateWallsTowers(dt);this.updateProjectiles(dt);this.flushNetworkEvents(dt);
  }

  onJoin(client,options={}){
    const populationKey=`${this.roomId||"world"}:${client.sessionId}`;
    this.populationKeys.set(client.sessionId,populationKey);ACTIVE_CUBE_PLAYER_KEYS.add(populationKey);
    const s=this.safeSpawn(),p=new PlayerState();this.playerCombatReadyAt.set(client.sessionId,Infinity);p.id=client.sessionId;p.username=String(options.username||"Cube").slice(0,14);p.x=s.x;p.y=s.y;p.angle=0;p.health=100;p.maxHealth=100;p.hydration=100;p.bucketWater=true;p.bucketSips=BUCKET_MAX_SIPS;p.color=typeof options.color==="string"?options.color:"#3fa7ff";p.tool="Fist";p.oxygen=0;p.oxygenMax=0;p._jungleHotUntil=0;p._jungleHotRate=0;p._cactusGoodUntil=0;p._cactusHealRate=0;p._cactusHydrateRate=0;p._badCactusUntil=0;p._badCactusDamageRate=0;p._badCactusHydrateRate=0;p._cactusSpineCd=0;p._desertHydrationWait=2.5;p._stoneFruitUntil=0;p._blueSeaweedUntil=0;
    let verifiedAccount=null;try{verifiedAccount=HOSTL_ACCOUNT_HOOKS.resolveSession(String(options.accountToken||""));}catch(_){verifiedAccount=null;}
    if(verifiedAccount?.userId){this.playerAccountIds.set(client.sessionId,String(verifiedAccount.userId));this.playerAccountEntitlements.set(client.sessionId,verifiedAccount);if(verifiedAccount.username)p.username=String(verifiedAccount.username).slice(0,14);p.title=String(verifiedAccount.title||"").slice(0,32);p.testerRank=Math.max(0,Math.floor(Number(verifiedAccount.testerRank)||0));p.ownerRank=Math.max(0,Math.floor(Number(verifiedAccount.ownerRank)||0));try{HOSTL_ACCOUNT_HOOKS.onPresenceJoin(String(verifiedAccount.userId),`${this.roomId||"world"}:${client.sessionId}`,this.worldId);}catch(_){}}
    let upgrades={};if(verifiedAccount?.userId)upgrades=(verifiedAccount.petStatUpgrades&&typeof verifiedAccount.petStatUpgrades==="object")?verifiedAccount.petStatUpgrades:{};else try{const parsed=JSON.parse(String(options.petStatUpgrades||"{}"));if(parsed&&typeof parsed==="object")upgrades=parsed;}catch(_){}
    this.playerPetStatUpgrades.set(client.sessionId,upgrades);this.playerSurvivalSeconds.set(client.sessionId,0);this.playerSurvivalAwards.set(client.sessionId,new Set());this.state.players.set(client.sessionId,p);this.playerSkillProgress.set(client.sessionId,{level:0,xp:0,speed:0,strength:0,defense:0,stoneChoice:"",weaponChoice:"",milestones:{}});
    const clientRules=String(options.rulesVersion||"");
    if(clientRules&&clientRules!==CUBE_SHARED_RULES_VERSION)client.send("rulesMismatch",{serverRulesVersion:CUBE_SHARED_RULES_VERSION,clientRulesVersion:clientRules});
    let start=String(options.startPet||"");if(start==="viper")start="snake";
    const requestedStage=String(options.startPetStage||"baby"),startStage=this.accountStarterStage(client.sessionId,start,["baby","adult","boss","superboss"].includes(requestedStage)?requestedStage:"baby");
    if(PET_TYPES[start])this.ensureStarterPetFor(client,start,startStage,{petName:options.startPetName,gender:options.startPetGender});client.send("serverReady",{fullWorld:true,rulesVersion:CUBE_SHARED_RULES_VERSION});this.sendSkillState(client.sessionId);
  }

  onLeave(client){for(const[wid,w]of Array.from(this.state.walls.entries()))if(w&&w.ownerId===client.sessionId&&!w.sourcePetId){this.state.walls.delete(wid);this.hostileWildWalls.delete(wid);}for(const[tid,t]of Array.from(this.state.towers.entries()))if(t&&t.ownerId===client.sessionId)this.state.towers.delete(tid);const presenceUid=this.playerAccountIds?.get(client.sessionId);if(presenceUid){try{HOSTL_ACCOUNT_HOOKS.onPresenceLeave(String(presenceUid),`${this.roomId||"world"}:${client.sessionId}`);}catch(_){}}const populationKey=this.populationKeys.get(client.sessionId);if(populationKey){ACTIVE_CUBE_PLAYER_KEYS.delete(populationKey);this.populationKeys.delete(client.sessionId);}this.state.players.delete(client.sessionId);this.playerAccountIds?.delete(client.sessionId);this.playerAccountEntitlements?.delete(client.sessionId);this.playerSurvivalSeconds?.delete(client.sessionId);this.playerSurvivalAwards?.delete(client.sessionId);this.playerNightSeen?.delete(client.sessionId);this.playerCombatReadyAt?.delete(client.sessionId);this.playerInputNetState?.delete(client.sessionId);this.firstLightReadyPlayers.delete(client.sessionId);this.playerPetStatUpgrades.delete(client.sessionId);this.playerRunShop.delete(client.sessionId);this.playerSkillProgress.delete(client.sessionId);this.tamePendingPlayers.delete(client.sessionId);this.playerHiveSessions?.delete(client.sessionId);this.chatLastSent.delete(client.sessionId);this.playerAttackCd.delete(client.sessionId);this.playerShootCd.delete(client.sessionId);this.playerStoneFruitStacks.delete(client.sessionId);this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);this.pendingPlayerHits.delete(client.sessionId);this.pendingAnimalPushes.delete(client.sessionId);this.ownerThreat.delete(client.sessionId);const prefix=`${client.sessionId}:`;for(const k of Array.from(this.harvestCredits.keys()))if(k.startsWith(prefix))this.harvestCredits.delete(k);for(const k of Array.from(this.goldHandCredits.keys()))if(k.startsWith(prefix))this.goldHandCredits.delete(k);for(const[id,p]of Array.from(this.state.pets.entries()))if(p.ownerId===client.sessionId){this.petFocusTargets.delete(id);this.petFollowState.delete(id);this.petHuntState.delete(id);this.petChaseState.delete(id);this.petDeathTimers.delete(id);this.state.pets.delete(id);}}
  onDispose(){for(const key of this.populationKeys.values())ACTIVE_CUBE_PLAYER_KEYS.delete(key);this.populationKeys.clear();}

}
