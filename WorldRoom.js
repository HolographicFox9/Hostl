// WorldRoom.js
// HOSTL full multiplayer room.
// Server-authoritative shared world: resources, gold, chests, wildlife, pets,
// hostile cubes, walls, towers, projectiles, combat, taming, and day/night.

import { Room } from "@colyseus/core";
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

const WORLD_W = 38000;
const WORLD_H = 28000;
const PLAYER_R = 18;
const GRID_CELL = 192;
const TAU = Math.PI * 2;
const THROW_AXE_RANGE=560, THROW_AXE_SPEED=590, THROW_AXE_RETURN_SPEED=680, THROW_AXE_LIFE=3.0;
const THROW_AXE_RETURN_AT=THROW_AXE_LIFE-(THROW_AXE_RANGE/THROW_AXE_SPEED);
const CREATURE_DYNAMIC_KINDS = new Set(["animal","pet"]);
const CUBE_SHARED_RULES_VERSION = "661";
let HOSTL_ACCOUNT_HOOKS = { resolveSession: () => null, refreshAccount: () => null, rewardTesterKill: async () => ({ granted:false }), rewardOwnerKill: async () => ({ granted:false }), rewardGameplayMaterial: async () => ({ granted:false }), grantWorldReward: async () => ({ granted:false }), recordAchievement: async () => ({ granted:false }), onPresenceJoin:()=>{}, onPresenceLeave:()=>{} };
export function configureHostlAccountHooks(hooks={}) {
  if (typeof hooks.resolveSession === "function") HOSTL_ACCOUNT_HOOKS.resolveSession = hooks.resolveSession;
  if (typeof hooks.refreshAccount === "function") HOSTL_ACCOUNT_HOOKS.refreshAccount = hooks.refreshAccount;
  if (typeof hooks.rewardTesterKill === "function") HOSTL_ACCOUNT_HOOKS.rewardTesterKill = hooks.rewardTesterKill;
  if (typeof hooks.rewardOwnerKill === "function") HOSTL_ACCOUNT_HOOKS.rewardOwnerKill = hooks.rewardOwnerKill;
  if (typeof hooks.rewardGameplayMaterial === "function") HOSTL_ACCOUNT_HOOKS.rewardGameplayMaterial = hooks.rewardGameplayMaterial;
  if (typeof hooks.grantWorldReward === "function") HOSTL_ACCOUNT_HOOKS.grantWorldReward = hooks.grantWorldReward;
  if (typeof hooks.recordAchievement === "function") HOSTL_ACCOUNT_HOOKS.recordAchievement = hooks.recordAchievement;
  if (typeof hooks.onPresenceJoin === "function") HOSTL_ACCOUNT_HOOKS.onPresenceJoin = hooks.onPresenceJoin;
  if (typeof hooks.onPresenceLeave === "function") HOSTL_ACCOUNT_HOOKS.onPresenceLeave = hooks.onPresenceLeave;
}


// ---------- Game 388 multiplayer chat safety ----------
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
  camel:{baseSpeed:64,friendly:true,flee:false,sizeMul:1.62,color:"#b99161",abilityCd:15,elem:"Water",coats:["#b99161","#caa777","#9f794e"]},
  scorpion:{baseSpeed:70,friendly:false,flee:false,sizeMul:.96,color:"#7e6548",abilityCd:13,elem:"Poison",coats:["#7e6548","#5e4d38","#a2845b"]},
  hyena:{baseSpeed:90,friendly:false,flee:false,sizeMul:1.26,color:"#ad9264",abilityCd:13,elem:"Fire",coats:["#ad9264","#947a52","#c2a879"]},
  caracal:{baseSpeed:108,friendly:false,flee:false,sizeMul:1.10,color:"#b7754d",abilityCd:11,elem:"Lightning",coats:["#b7754d","#a56545","#cd8e62"]},
  polarbear:{baseSpeed:52,friendly:false,flee:false,sizeMul:1.78,color:"#edf3f3",abilityCd:17,elem:"Ice",coats:["#edf3f3","#dce8ea","#f8fbfb"]},
  arcticfox:{baseSpeed:102,friendly:true,flee:true,sizeMul:1.02,color:"#e9f1f5",abilityCd:12,elem:"Ice",coats:["#e9f1f5","#d4e4ec","#f7fbff"]},
  walrus:{baseSpeed:42,friendly:false,flee:false,sizeMul:1.80,color:"#94735f",abilityCd:16,elem:"Stone",coats:["#94735f","#7c6050","#ad8970"]},
  muskox:{baseSpeed:58,friendly:false,flee:false,sizeMul:1.62,color:"#5d4838",abilityCd:16,elem:"Earth",coats:["#5d4838","#49392e","#765c47"]},
  snowyowl:{baseSpeed:76,friendly:true,flee:true,sizeMul:1.08,color:"#f0f2ee",abilityCd:13,elem:"Wind",coats:["#f0f2ee","#dde4e3","#fafcf8"]},
  mountaingoat:{baseSpeed:88,friendly:true,flee:false,sizeMul:1.18,color:"#b9b4a7",abilityCd:14,elem:"Earth",coats:["#b9b4a7","#a39d91","#d0ccc1"]},
  eagle:{baseSpeed:102,friendly:false,flee:false,sizeMul:1.20,color:"#8a6537",abilityCd:14,elem:"Lightning",coats:["#8a6537","#6d4e2c","#a67a43"]},
  cougar:{baseSpeed:105,friendly:false,flee:false,sizeMul:1.34,color:"#c39a68",abilityCd:12,elem:"Combat",coats:["#c39a68","#ad8558","#d6b07b"]},
  bighorn:{baseSpeed:78,friendly:false,flee:false,sizeMul:1.40,color:"#9a8064",abilityCd:15,elem:"Earth",coats:["#9a8064","#806a54","#b19a7c"]},
  marmot:{baseSpeed:74,friendly:true,flee:true,sizeMul:.86,color:"#8d6b4e",abilityCd:11,elem:"Sound",coats:["#8d6b4e","#74563f","#a58262"]},
  jaguar:{baseSpeed:100,friendly:false,flee:false,sizeMul:1.40,color:"#d2a23d",abilityCd:13,elem:"Shadow",coats:["#d2a23d","#bd8e32","#e2b85a"]},
  toucan:{baseSpeed:82,friendly:true,flee:true,sizeMul:.96,color:"#272523",abilityCd:12,elem:"Sound",coats:["#272523","#34302c","#1c1c1c"]},
  tapir:{baseSpeed:60,friendly:true,flee:false,sizeMul:1.48,color:"#5d5147",abilityCd:16,elem:"Earth",coats:["#5d5147","#4d433c","#706158"]},
  capybara:{baseSpeed:66,friendly:true,flee:false,sizeMul:1.22,color:"#9b7352",abilityCd:14,elem:"Water",coats:["#9b7352","#865f43","#ad8460"]},
  anaconda:{baseSpeed:60,friendly:false,flee:false,sizeMul:1.68,color:"#4f7040",abilityCd:15,elem:"Combat",coats:["#4f7040","#3d5e32","#69875a"]},
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
const BIG_MOMMA_HP_MUL = {bear:1.55,polarbear:1.65,walrus:1.55,camel:1.35,muskox:1.45,saber:1.45,jaguar:1.35,anaconda:1.50,scorpion:1.25,wolf:1.25,boar:1.35,bighorn:1.30,cougar:1.25,hyena:1.20,clouded:1.25,dragon:1.35,rabbit:.78,marmot:.82,fennec:.88,toucan:.82,owl:.90,snowyowl:.90};
const BIG_MOMMA_DEF_MUL = {bear:.68,polarbear:.64,walrus:.67,muskox:.72,saber:.72,anaconda:.73,scorpion:.78,boar:.75,camel:.82,bighorn:.80,wolf:.82,jaguar:.80,hyena:.84,clouded:.82,rabbit:1.08,marmot:1.04,fennec:1.02,toucan:1.04};
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
camel:{baby:{damage:30,per:0},adult:{damage:40,per:0},boss:{damage:50,per:0},superboss:{damage:60,per:0},bigmomma:{damage:68,per:0}},
scorpion:{baby:{grab:10,sting:20,dot:15,per:0},adult:{grab:15,sting:30,dot:20,per:0},boss:{grab:20,sting:40,dot:30,per:0},superboss:{grab:30,sting:50,dot:40,per:0},bigmomma:{grab:60,sting:80,dot:40,per:0}},
hyena:{baby:{damage:10,per:0},adult:{damage:30,per:0},boss:{damage:37,per:0},superboss:{damage:50,per:0},bigmomma:{damage:59,per:0}},
caracal:{baby:{pct:.25,per:0},adult:{pct:.30,per:0},boss:{pct:.35,per:0},superboss:{pct:.40,per:0},bigmomma:{pct:.50,per:0}},
polarbear:{baby:{damage:5,per:0},adult:{damage:15,per:0},boss:{damage:20,per:0},superboss:{damage:26,per:0},bigmomma:{damage:40,per:0}},
arcticfox:{baby:{damage:10,per:0},adult:{damage:18,per:0},boss:{damage:20,per:0},superboss:{damage:25,per:0},bigmomma:{damage:37,per:0}},
walrus:{baby:{damage:2,per:0},adult:{damage:10,per:0},boss:{damage:12,per:0},superboss:{damage:20,per:0},bigmomma:{damage:34,per:0}},
muskox:{baby:{damage:16,per:1},adult:{damage:24,per:1.5},boss:{damage:34,per:2},superboss:{damage:44,per:2.5},bigmomma:{damage:54,per:3}},
snowyowl:{baby:{damage:18,per:1},adult:{damage:26,per:1.5},boss:{damage:36,per:2},superboss:{damage:46,per:2.5},bigmomma:{damage:56,per:3}},
mountaingoat:{baby:{damage:10,per:1},adult:{damage:18,per:1.5},boss:{damage:28,per:2},superboss:{damage:38,per:2.5},bigmomma:{damage:48,per:3}},
eagle:{baby:{damage:12,per:1},adult:{damage:20,per:1.5},boss:{damage:30,per:2},superboss:{damage:40,per:2.5},bigmomma:{damage:50,per:3}},
cougar:{baby:{damage:14,per:1},adult:{damage:22,per:1.5},boss:{damage:32,per:2},superboss:{damage:42,per:2.5},bigmomma:{damage:52,per:3}},
bighorn:{baby:{damage:16,per:1},adult:{damage:24,per:1.5},boss:{damage:34,per:2},superboss:{damage:44,per:2.5},bigmomma:{damage:54,per:3}},
marmot:{baby:{damage:18,per:1},adult:{damage:26,per:1.5},boss:{damage:36,per:2},superboss:{damage:46,per:2.5},bigmomma:{damage:56,per:3}},
jaguar:{baby:{damage:10,per:1},adult:{damage:18,per:1.5},boss:{damage:28,per:2},superboss:{damage:38,per:2.5},bigmomma:{damage:48,per:3}},
toucan:{baby:{damage:12,per:1},adult:{damage:20,per:1.5},boss:{damage:30,per:2},superboss:{damage:40,per:2.5},bigmomma:{damage:50,per:3}},
tapir:{baby:{damage:14,per:1},adult:{damage:22,per:1.5},boss:{damage:32,per:2},superboss:{damage:42,per:2.5},bigmomma:{damage:52,per:3}},
capybara:{baby:{damage:16,per:1},adult:{damage:24,per:1.5},boss:{damage:34,per:2},superboss:{damage:44,per:2.5},bigmomma:{damage:54,per:3}},
anaconda:{baby:{damage:18,per:1},adult:{damage:26,per:1.5},boss:{damage:36,per:2},superboss:{damage:46,per:2.5},bigmomma:{damage:56,per:3}},
deer:{baby:{damage:16,per:2},adult:{damage:24,per:2},boss:{damage:34,per:2},superboss:{damage:40,per:2},bigmomma:{damage:60,per:2}},
boar:{baby:{damage:20,per:1},adult:{damage:25,per:1},boss:{damage:30,per:1},superboss:{damage:49,per:1},bigmomma:{damage:57,per:1}},
saber:{baby:{damage:34,per:1},adult:{damage:38,per:1},boss:{damage:47,per:1},superboss:{damage:50,per:1},bigmomma:{damage:65,per:1}}};
function petAbilityStats(p){const type=p?.type||"",stage=["baby","adult","boss","superboss","bigmomma"].includes(p?.stage)?p.stage:"adult",lv=Math.max(1,Number(p?.level)||1),row=PET_ABILITY_DAMAGE_TABLE[type]?.[stage]||PET_ABILITY_DAMAGE_TABLE[type]?.adult||{},bonus=(lv-1)*(Number(row.per)||0),out={...row};if(Number.isFinite(row.damage))out.damage=row.damage+bonus;if(Number.isFinite(row.blast))out.blast=row.blast+bonus;if(Number.isFinite(row.ring))out.ring=row.ring+bonus;return out;}
const PET_ABILITY_STAGE_SIZE={baby:.58,adult:1,boss:1.30,superboss:1.65,bigmomma:2.05};
const PET_PROJECTILE_STAGE_SIZE={baby:.64,adult:1,boss:1.24,superboss:1.48,bigmomma:1.76};
function petAbilityStageSize(stage){return PET_ABILITY_STAGE_SIZE[["baby","adult","boss","superboss","bigmomma"].includes(stage)?stage:"adult"]||1;}
function petProjectileStageSize(stage){return PET_PROJECTILE_STAGE_SIZE[["baby","adult","boss","superboss","bigmomma"].includes(stage)?stage:"adult"]||1;}
function petAbilityRangeFor(p,adultBase,radiusMul=0){const stageBase=adultBase*petAbilityStageSize(p?.stage);const bodyExtra=Math.max(0,(Number(p?.r)||18)-18)*Math.max(0,Number(radiusMul)||0)*.22;return stageBase+bodyExtra;}
function wallDamageForTool(toolName,w){const t=TOOL[toolName]||TOOL.Fist;return w?.kind==="stoneSpike"?(t.stoneWall||.5):(t.woodWall||1);}

// Keep online wildlife/card rarity in sync with the browser game.
// Bearded Dragon remains a starter species and is not part of normal wild rarity spawning.
const ANIMAL_RARITY={dog:"Common",cat:"Common",rabbit:"Common",wolf:"Uncommon",bear:"Uncommon",fox:"Uncommon",boar:"Rare",deer:"Rare",owl:"Rare",snake:"Legendary",saber:"Legendary",clouded:"Rare",fennec:"Common",camel:"Uncommon",scorpion:"Rare",hyena:"Uncommon",caracal:"Rare",polarbear:"Rare",arcticfox:"Common",walrus:"Uncommon",muskox:"Rare",snowyowl:"Rare",mountaingoat:"Common",eagle:"Rare",cougar:"Rare",bighorn:"Uncommon",marmot:"Common",jaguar:"Legendary",toucan:"Common",tapir:"Uncommon",capybara:"Common",anaconda:"Legendary",queenbee:"Rare",workerbee:"Uncommon",dronebee:"Common",dragon:"Starter"};
const RARITY_WILD_WEIGHT={Common:5.0,Uncommon:2.5,Rare:1.15,Legendary:.32,Starter:.45};
const RARITY_CARD_WEIGHT={Common:2.4,Uncommon:1.5,Rare:.82,Legendary:.28,Starter:.55};
const RARITY_TAME_CHANCE={Common:.50,Uncommon:.40,Rare:.28,Legendary:.18,Starter:.42};
function animalRarity(type){return ANIMAL_RARITY[type]||"Common";}
function randomWildSpecies(speciesList=WILD_SPECIES){return weighted((speciesList&&speciesList.length?speciesList:WILD_SPECIES).map(v=>({v,w:RARITY_WILD_WEIGHT[animalRarity(v)]||1})));}
const WILD_SPECIES = ["fox","wolf","bear","cat","dog","rabbit","owl","snake","deer","boar","saber","clouded","fennec","camel","scorpion","hyena","caracal","polarbear","arcticfox","walrus","muskox","snowyowl","mountaingoat","eagle","cougar","bighorn","marmot","jaguar","toucan","tapir","capybara","anaconda","queenbee","workerbee","dronebee","dragon"];
const WILD_PREY = {
  fox:new Set(["rabbit"]), wolf:new Set(["rabbit","deer","boar"]), bear:new Set(["rabbit","deer","boar"]),
  cat:new Set(["rabbit","snake"]), dog:new Set(["rabbit"]), rabbit:new Set(), owl:new Set(["rabbit","snake"]),
  snake:new Set(["rabbit"]), deer:new Set(), boar:new Set(), saber:new Set(["rabbit","deer","boar","wolf"]), clouded:new Set(["rabbit","deer","boar","fox"]),
  fennec:new Set(["marmot"]), camel:new Set(), scorpion:new Set(["fennec","marmot"]), hyena:new Set(["fennec","camel"]), caracal:new Set(["fennec","marmot"]),
  polarbear:new Set(["arcticfox","walrus"]), arcticfox:new Set(["marmot"]), walrus:new Set(), muskox:new Set(), snowyowl:new Set(["arcticfox","marmot"]),
  mountaingoat:new Set(), eagle:new Set(["marmot","rabbit"]), cougar:new Set(["mountaingoat","marmot"]), bighorn:new Set(), marmot:new Set(),
  jaguar:new Set(["capybara","tapir"]), toucan:new Set(), tapir:new Set(), capybara:new Set(), anaconda:new Set(["capybara","tapir"]),
  queenbee:new Set(), workerbee:new Set(), dronebee:new Set(),
  dragon:new Set(["rabbit","snake"]),
};
function wildCanPreyOn(predatorType,preyType){return !!predatorType&&!!preyType&&predatorType!==preyType&&!!WILD_PREY[predatorType]?.has(preyType);}
function randomAnimalGender(){return Math.random()<.5?"Male":"Female";}
function canonicalAnimalGender(type,requested=""){if(type==="queenbee")return "Female";if(type==="dronebee")return "Male";return requested==="Female"?"Female":requested==="Male"?"Male":randomAnimalGender();}

function skillXpNeededForLevel(level){level=Math.max(0,Math.floor(Number(level)||0));return Math.round(25+level*9+Math.floor(level*level*.05));}
function isSkillStatMilestone(level){level=Math.floor(Number(level)||0);return level>0&&level%10===0;}
function toolSkillAllowedChoices(s,level){level=Math.max(1,Math.floor(Number(level)||1));if(level===2)return new Set(["toolSword","toolAxe","toolWall"]);const path=s?.stoneChoice==="stoneSword"?"toolSword":s?.stoneChoice==="stoneAxe"?"toolAxe":"toolWall";const rot=level%3,extra=rot===0?["toolBow","toolTower"]:rot===1?["toolTower","toolPickaxe"]:["toolPickaxe","toolBow"];return new Set([path,...extra]);}

const TOOL = {
  Fist:    { dmg: 1.0, range: 42, cadence: 0.50, gather: 0.06, resourcePower: 0.08, woodWall:1.0, stoneWall:0.45 },
  Axe:     { dmg: 5.5, range: 50, cadence: 0.58, gather: 2.4,  resourcePower: 0.95, woodWall:9.0, stoneWall:2.0 },
  Pickaxe: { dmg: 5.0, range: 50, cadence: 0.50, gather: 2.5,  resourcePower: 1.15, woodWall:4.0, stoneWall:14.0 },
  Sword:   { dmg: 8.0, range: 54, cadence: 0.42, gather: 0.08, resourcePower: 0.10, woodWall:4.0, stoneWall:1.8 },
  Bow:     { dmg: 9.0, range: 46, cadence: 0.55, gather: 0.12, resourcePower: 0.18, woodWall:2.0, stoneWall:1.5 },
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
    this.color = "#3fa7ff"; this.tool = "Fist"; this.heldSpecial = ""; this.ridingPetId = "";
    this.moveX = 0; this.moveY = 0; this.moving = false; this.animalCarryT = 0;
    this.kills = 0; this.gold = 0; this.title = ""; this.testerRank = 0; this.ownerRank = 0;
    this.skillLevel = 0; this.skillXp = 0; this.skillSpeed = 0; this.skillStrength = 0; this.skillDefense = 0; this.skillPendingMilestone = 0;
    this.hydration = 100; this.bucketWater = true; this.bucketSips = BUCKET_MAX_SIPS;
  }
}
defineTypes(PlayerState, {
  id:"string", username:"string", x:"number", y:"number", angle:"number",
  health:"number", maxHealth:"number", dead:"boolean", color:"string", tool:"string", heldSpecial:"string", ridingPetId:"string",
  moveX:"number", moveY:"number", moving:"boolean", animalCarryT:"number", kills:"number", gold:"number", title:"string", testerRank:"number", ownerRank:"number",
  skillLevel:"number", skillXp:"number", skillSpeed:"number", skillStrength:"number", skillDefense:"number", skillPendingMilestone:"number", hydration:"number", bucketWater:"boolean", bucketSips:"number"
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
  }
}
defineTypes(AnimalState, {
  type:"string", stage:"string", x:"number", y:"number", angle:"number", r:"number",
  hp:"number", maxHp:"number", coat:"string", spotCol:"string", spotsJson:"string", speed:"number",
  sleeping:"boolean", tailPhase:"number", attackAnim:"number", flash:"number", atkCd:"number", abilityCd:"number",
  combat:"number", recentHit:"number", wanderT:"number", wanderA:"number", fleeUntil:"number", enraged:"boolean",
  tameFailedAggro:"boolean", desperateAggro:"boolean", releasedWild:"boolean", hostileRiderMount:"boolean", level:"number", exp:"number", petName:"string",
  gender:"string", motherId:"string", fatherId:"string", bredChild:"boolean"
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
  upHealth:"number", upDefense:"number", upAttack:"number", upWeight:"number", upRegen:"number", upSpeed:"number",
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
  constructor() { super(); this.x=0; this.y=0; this.cd=0.5; this.ownerId=""; this.tier=0; }
}
defineTypes(TowerState, { x:"number", y:"number", cd:"number", ownerId:"string", tier:"number" });

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

const ANIMAL_PLANT_EATERS=new Set(["rabbit","deer","camel","muskox","mountaingoat","bighorn","marmot","tapir","capybara"]);
function animalDietSizeMultiplier(type){
  if(ANIMAL_PLANT_EATERS.has(type))return .88;
  if(type==="scorpion")return 1.32;
  return 1.14;
}
function animalRadius(type, stage) {
  const mul=(PET_TYPES[type]?.sizeMul)||1,dietMul=animalDietSizeMultiplier(type); let base=22;
  if(stage==="adult") base=45; else if(stage==="boss") base=68; else if(stage==="superboss") base=96; else if(stage==="bigmomma") base=140;
  let extra=1;
  if(["boss","superboss","bigmomma"].includes(stage)) extra=(type==="bear"||type==="saber"||type==="clouded")?1.28:(type==="polarbear"||type==="walrus"||type==="camel"||type==="muskox"||type==="anaconda"||type==="tapir")?1.20:(type==="wolf"||type==="boar"||type==="jaguar"||type==="bighorn"||type==="cougar")?1.16:1.08;
  return base*mul*dietMul*extra;
}
function uploadedAnimalVisibleDimensions(type,stage){
  const speciesHeight={dog:1.06,cat:1.02,dragon:1.00,fox:1.06,wolf:1.10,bear:1.18,rabbit:.98,owl:1.48,snake:.68,deer:.98}[type];
  if(!speciesHeight)return null;
  const stageScale={baby:1.78,adult:1.52,boss:1.43,superboss:1.40,bigmomma:1.38}[stage]||1.45;
  const lengthMul={dog:1.62,cat:1.58,dragon:1.92,fox:1.70,wolf:1.72,bear:1.42,rabbit:1.42,owl:1.05,snake:3.70,deer:1.78}[type]||1.55;
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
    boss:{len:1.04,body:1.04,head:1.08},
    superboss:{len:1.06,body:1.05,head:1.10},
    bigmomma:{len:1.08,body:1.06,head:1.12}
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
    owl:{len:1.00,body:1.02,head:1.05}
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

function animalHitCircles(a) {
  const ang=a?.angle||0,ca=Math.cos(ang),sa=Math.sin(ang);
  const fit=animalHitboxFit(a?.type,a?.stage);
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
      deer:[[-.28,.13],[-.09,.20],[.12,.24],[.33,.21],[.49,.16],[.61,.11]]
    }[a.type];

    return cfg.map(([xf,rf],i)=>{
      const headish=i>=cfg.length-2;
      const noseTip=i===cfg.length-1;
      const forward=d.w*xf*(headish?fit.head:fit.len);
      const rr=Math.max(8,d.h*rf*(headish?fit.head:fit.body));
      const drop=noseTip?d.h*.05*fit.head:headish?d.h*.03*fit.head:0;
      return{x:a.x+ca*forward-sa*drop,y:a.y+sa*forward+ca*drop,r:rr};
    });
  }

  const r=a?.r||18;
  let parts;
  if(a.type==="snake") parts=[[-1.00,0,.31],[-.76,0,.41],[-.24,0,.49],[.32,0,.47],[.80,0,.41],[1.16,0,.33],[1.42,0,.24]];
  else if(a.type==="boar") parts=[[-.74,0,.53],[-.48,0,.73],[.08,0,.83],[.68,0,.68],[1.08,0,.50],[1.42,0,.39],[1.66,0,.28]];
  else if(a.type==="saber"||a.type==="clouded") parts=[[-.58,0,.42],[-.34,0,.56],[.08,0,.64],[.48,0,.53],[.80,0,.40],[1.04,0,.30],[1.22,0,.21]];
  else if(a.type==="deer") parts=[[-.68,0,.38],[-.40,0,.54],[.06,0,.61],[.54,0,.46],[.90,0,.34],[1.18,0,.25],[1.38,0,.18]];
  else if(a.type==="rabbit") parts=[[-.52,0,.43],[-.28,0,.62],[.25,0,.67],[.74,0,.51],[1.10,0,.40],[1.36,0,.31],[1.55,0,.23]];
  else if(a.type==="owl") parts=[[-.42,0,.47],[-.18,0,.69],[.28,0,.71],[.68,0,.55],[.98,0,.42],[1.24,0,.32],[1.42,0,.23]];
  else parts=[[-.64,0,.47],[-.39,0,.69],[.10,0,.77],[.65,0,.61],[1.02,0,.45],[1.34,0,.35],[1.56,0,.25]];

  return parts.map(([f,side,rad],i)=>{
    const fromEnd=parts.length-1-i;
    const headish=fromEnd<=2;
    const headDrop=fromEnd===0?.14:fromEnd===1?.10:fromEnd===2?.06:0;
    const lenMul=headish?fit.head:fit.len;
    const bodyMul=headish?fit.head:fit.body;
    const localSide=(side+headDrop)*bodyMul;
    return{x:a.x+ca*(f*r*lenMul)-sa*(localSide*r),y:a.y+sa*(f*r*lenMul)+ca*(localSide*r),r:Math.max(8,r*rad*bodyMul)};
  });
}
function animalPhysicalCircles(a){
  // Hostl Rider mounts always use the Wolf movement-collision profile, even if
  // their visible mount is a Boar/Bear/Dog/Saber. Damage geometry stays real.
  const riderWolfCollision=!!a?.hostileRiderMount;
  const collisionAnimal=riderWolfCollision?Object.assign({},a,{type:"wolf"}):a;
  // Movement collision keeps the torso plus a smaller solid skull/head circle.
  // Only the final muzzle/snout-tip circle is non-solid, so the nose can overlap
  // an obstacle a little without allowing the whole head to pass through it.
  const hits=animalHitCircles(collisionAnimal);
  if(!hits.length)return hits;
  if(collisionAnimal?.type==="boar") {
    const ang=Number(collisionAnimal.angle)||0;
    const r=Math.max(8,Number(collisionAnimal.r)||18);
    const body=hits[Math.max(0,Math.min(hits.length-1,Math.floor((hits.length-1)*.45)))]||hits[0];
    const skull=hits[Math.max(0,hits.length-2)]||hits[hits.length-1]||body;
    const stageBody={baby:.43,adult:.52,boss:.55,superboss:.57,bigmomma:.59}[collisionAnimal.stage]||.52;
    const stageHead={baby:.25,adult:.31,boss:.30,superboss:.29,bigmomma:.28}[collisionAnimal.stage]||.31;
    const cutBack={baby:.16,adult:.18,boss:.20,superboss:.22,bigmomma:.24}[collisionAnimal.stage]||.18;
    const mounted=a?._mountedCollision?0.92:1;
    return [
      {x:body.x,y:body.y,r:Math.max(3,r*stageBody*mounted)},
      {x:skull.x-Math.cos(ang)*r*cutBack,y:skull.y-Math.sin(ang)*r*cutBack,r:Math.max(2.4,r*stageHead*mounted)}
    ];
  }
  const physical=hits.length>1?hits.slice(0,hits.length-1):hits.slice();
  // Movement collision hugs the visible silhouette; the omitted last circle is
  // the muzzle tip, and the remaining skull is pulled back slightly below.
  let radiusMul=.94;
  if(collisionAnimal?.stage==="baby")radiusMul*=.60;
  if(collisionAnimal?.type==="snake")radiusMul*=.72;
  if(collisionAnimal?.type==="wolf"){
    const ownedWolf=!!collisionAnimal?.ownerId;
    if(collisionAnimal?.stage==="boss")radiusMul*=.60;
    else if(!ownedWolf)radiusMul*=.70;
    else radiusMul*=.78;
  }
  if(collisionAnimal?.type==="bear")radiusMul*=.84;
  if(collisionAnimal?.type==="dog")radiusMul*=.92;
  if(collisionAnimal?.type==="boar"){
    if(collisionAnimal?.stage==="baby")radiusMul*=.52;
    else if(collisionAnimal?.stage==="boss")radiusMul*=.68;
    else radiusMul*=.66;
  }
  if(collisionAnimal?.type==="deer"){
    if(collisionAnimal?.stage==="adult")radiusMul*=.60;
    else if(collisionAnimal?.stage==="boss")radiusMul*=.64;
    else radiusMul*=.68;
  }
  // Riding uses the same real multi-circle body, just slightly forgiving so
  // shoulders/head do not snag on tiny seams between nearby obstacles.
  if(a?._mountedCollision)radiusMul*=.92;
  const last=physical.length-1;
  return physical.map((h,i)=>{
    let rMul=radiusMul;
    const bossBoarFront=collisionAnimal?.type==="boar"&&(collisionAnimal?.stage==="boss"||collisionAnimal?.stage==="superboss")&&i>=last-1;
    if(bossBoarFront){
      const isSkull=i===last;
      const frontMul=collisionAnimal?.stage==="superboss"?(isSkull?.12:.28):(isSkull?.16:.34);
      rMul*=frontMul;
    }else if(i===last&&physical.length>1){
      let headMul=.64;
      if(collisionAnimal?.type==="boar"&&collisionAnimal?.stage==="baby")headMul=.30;
      else if(collisionAnimal?.type==="boar"&&collisionAnimal?.stage==="bigmomma")headMul=.20;
      else if(collisionAnimal?.type==="boar")headMul=.62;
      else if(collisionAnimal?.type==="deer"&&collisionAnimal?.stage==="adult")headMul=.54;
      else if(collisionAnimal?.type==="deer"&&collisionAnimal?.stage==="boss")headMul=.46;
      else if(collisionAnimal?.type==="deer")headMul=.58;
      else if(collisionAnimal?.stage==="baby")headMul=.68;
      rMul*=headMul;
    }
    const compactBoarHead=i===last&&collisionAnimal?.type==="boar"&&(collisionAnimal?.stage==="boss"||collisionAnimal?.stage==="superboss"||collisionAnimal?.stage==="bigmomma");
    let minPhysicalR=collisionAnimal?.stage==="baby"?3.0:4;
    if(i===last&&collisionAnimal?.type==="boar"&&collisionAnimal?.stage==="baby")minPhysicalR=2.3;
    else if(i===last&&collisionAnimal?.stage==="baby")minPhysicalR=2.6;
    else if(bossBoarFront)minPhysicalR=i===last?1.6:2.2;
    else if(compactBoarHead)minPhysicalR=3;
    const out={...h,r:Math.max(minPhysicalR,h.r*rMul)};
    if(bossBoarFront){
      const ang=Number(a?.angle)||0,r=Number(a?.r)||18;
      const back=(i===last)?(collisionAnimal?.stage==="superboss"?.34:.30)*r:(collisionAnimal?.stage==="superboss"?.14:.11)*r;
      out.x-=Math.cos(ang)*back;out.y-=Math.sin(ang)*back;
    }else if(compactBoarHead){
      const back=.20*(Number(a?.r)||18),ang=Number(a?.angle)||0;
      out.x-=Math.cos(ang)*back;out.y-=Math.sin(ang)*back;
    }else if(i===last&&physical.length>1){
      const ang=Number(a?.angle)||0,back=(Number(a?.r)||18)*.08;
      out.x-=Math.cos(ang)*back;out.y-=Math.sin(ang)*back;
    }
    return out;
  });
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
function animalFaceGeometry(a){
  const r=a?.r||18;
  let forward=1.14,radiusMul=.46;
  if(a.type==="bear"){forward=1.08;radiusMul=.49;}
  else if(a.type==="rabbit"){forward=1.12;radiusMul=.42;}
  else if(a.type==="cat"){forward=1.17;radiusMul=.43;}
  else if(a.type==="fox"){forward=1.20;radiusMul=.44;}
  else if(a.type==="wolf"||a.type==="dog"){forward=1.20;radiusMul=.44;}
  else if(a.type==="owl"){forward=1.05;radiusMul=.49;}
  else if(a.type==="deer"){forward=1.12;radiusMul=.34;}
  else if(a.type==="boar"){forward=1.18;radiusMul=.45;}
  else if(a.type==="saber"){forward=1.00;radiusMul=.34;}
  else if(a.type==="snake"){forward=1.26;radiusMul=.29;}
  else if(a.type==="dragon"){forward=1.22;radiusMul=.40;}

  const stageMul=a.stage==="baby"?1.04:a.stage==="boss"?1.05:a.stage==="superboss"?1.07:a.stage==="bigmomma"?1.09:1;
  const angle=a.angle||0,ca=Math.cos(angle),sa=Math.sin(angle),side=.10;
  return{
    x:a.x+ca*r*forward-sa*r*side,
    y:a.y+sa*r*forward+ca*r*side,
    r:Math.max(8,r*radiusMul*stageMul)
  };
}
function animalTargetDamageCircles(ref,target){
  if(!target)return[];
  if(ref?.kind==="animal"||ref?.kind==="pet"){
    const hits=animalHitCircles(target).map(h=>({...h}));
    const head=animalFaceGeometry(target);if(head)hits.push(head);
    return hits;
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
    if(dist(h.x,h.y,th.x,th.y)<=h.r+th.r+3+grace)return true;
  }
  return false;
}
function petAttackContact(a,ref,target){
  if(animalAttackContact(a,ref,target))return true;
  if(!a||!target||a.stage!=="baby")return false;
  const toward=angTo(a.x,a.y,target.x,target.y);
  if(Math.abs(angleDiff(a.angle||0,toward))>.92)return false;
  const grace=clamp((a.r||18)*.22,3.2,5.8);
  return animalAttackContact(a,ref,target,grace);
}
function animalTargetOverlap(a,ref,target){
  if(!a||!target)return 0;
  const tr=ref?.kind==="player"?PLAYER_R*.82:Math.max(8,(target.r||16)*.82);
  let deepest=0;
  for(const h of animalPhysicalCircles(a)){
    const d=dist(h.x,h.y,target.x,target.y);
    // +3 is only contact tolerance for network sampling. The target still moves
    // by the animal's exact delta; there is no knockback/extra force.
    deepest=Math.max(deepest,h.r+tr+3-d);
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
function petAtkDmg(p) {
  const m=p.stage==="baby"?.55:p.stage==="adult"?1:p.stage==="boss"?1.65:p.stage==="superboss"?2.25:2.6;
  const speciesMul=Math.max(.72,Math.min(1.55,animalBalance(p.type).attack/7.5));
  return (6+(p.r||15)*.15)*m*(1+(p.level||1)*.12)*speciesMul*petUpgradeMultiplier(p,"attack");
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
const ISLAND_CX=WORLD_W*.5,ISLAND_CY=WORLD_H*.5,ISLAND_RADIUS=Math.min(WORLD_W,WORLD_H)*.415,ISLAND_SHORE_WIDTH=230;
const BIOME_ZONES={
  forest:{id:"forest",cx:WORLD_W*.41,cy:WORLD_H*.57},
  rainforest:{id:"rainforest",cx:WORLD_W*.65,cy:WORLD_H*.57},
  arctic:{id:"arctic",cx:WORLD_W*.50,cy:WORLD_H*.25},
  desert:{id:"desert",cx:WORLD_W*.50,cy:WORLD_H*.80},
  mountains:{id:"mountains",cx:WORLD_W*.13,cy:WORLD_H*.52}
};
const BIOME_ORDER=["forest","rainforest","arctic","desert","mountains"];
const BIOME_PROFILES={
  forest:{id:"forest",name:"Forest",species:["fox","dog","cat","rabbit","deer","boar","owl","wolf","bear","saber"]},
  rainforest:{id:"rainforest",name:"Rain Forest",species:["queenbee","workerbee","dronebee","clouded","jaguar","toucan","tapir","capybara","anaconda","dragon"]},
  arctic:{id:"arctic",name:"Arctic",species:["polarbear","arcticfox","walrus","muskox","snowyowl"]},
  desert:{id:"desert",name:"Desert",species:["fennec","camel","scorpion","hyena","caracal","snake"]},
  mountains:{id:"mountains",name:"Mountains",species:["mountaingoat","eagle","cougar","bighorn","marmot"]},
  ocean:{id:"ocean",name:"Ocean",species:[]}
};
const BIOME_RESOURCE_INFO=Object.freeze({
  forestHerb:{biome:"forest",material:"wildHerb",name:"Wild Herb",color:"#8dcf68",category:"soft",hp:3},
  forestResin:{biome:"forest",material:"treeResin",name:"Tree Resin",color:"#d69a45",category:"wood",hp:4},
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
  rainforestHive:{biome:"rainforest",material:"honeycomb",name:"Giant Hive",color:"#d0ad4c",category:"soft",hp:14}
});
function islandDistance(x,y){return Math.hypot(x-ISLAND_CX,y-ISLAND_CY);}
function islandAngleDelta(a,b){let d=(a-b)%TAU;if(d>Math.PI)d-=TAU;else if(d<-Math.PI)d+=TAU;return d;}
function islandRadiusAtAngle(angle,pad=0){
  const theta=Number(angle)||0;
  let scale=1
    +Math.sin(theta*2.15+.35)*.085
    +Math.sin(theta*4.7-1.1)*.055
    +Math.sin(theta*7.9+2.2)*.025;
  scale+=Math.exp(-Math.pow(islandAngleDelta(theta,.42)/.42,2))*.11;
  scale+=Math.exp(-Math.pow(islandAngleDelta(theta,-.78)/.48,2))*.07;
  scale-=Math.exp(-Math.pow(islandAngleDelta(theta,2.35)/.52,2))*.13;
  scale-=Math.exp(-Math.pow(islandAngleDelta(theta,-2.55)/.34,2))*.06;
  // Mountains live on added western land instead of replacing the original Forest.
  scale+=Math.exp(-Math.pow(islandAngleDelta(theta,Math.PI)/.62,2))*.60;
  scale=Math.max(.74,Math.min(1.75,scale));
  return Math.max(80,ISLAND_RADIUS*scale-(Number(pad)||0));
}
function isInsideIsland(x,y,pad=0){const dx=x-ISLAND_CX,dy=y-ISLAND_CY,d=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);return d<=islandRadiusAtAngle(angle,pad);}
function islandConstrainedPoint(x,y,pad=0){const dx=x-ISLAND_CX,dy=y-ISLAND_CY,d=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),maxR=islandRadiusAtAngle(angle,pad);if(!Number.isFinite(d)||d<=maxR)return{x:clamp(x,0,WORLD_W),y:clamp(y,0,WORLD_H)};const q=d>0?maxR/d:0;return{x:ISLAND_CX+dx*q,y:ISLAND_CY+dy*q};}
function keepObjectOnIsland(obj,pad=20){if(!obj)return;const p=islandConstrainedPoint(Number(obj.x)||ISLAND_CX,Number(obj.y)||ISLAND_CY,pad);obj.x=p.x;obj.y=p.y;}
function forestRainBoundaryX(y){const yn=(y-ISLAND_CY)/Math.max(1,ISLAND_RADIUS);return ISLAND_CX+Math.sin(yn*Math.PI*1.25)*WORLD_W*.035+Math.sin(yn*Math.PI*2.8+1.2)*WORLD_W*.012;}
function arcticBoundaryY(x){const xn=(x-ISLAND_CX)/Math.max(1,ISLAND_RADIUS);return ISLAND_CY-ISLAND_RADIUS*.22+Math.sin(xn*Math.PI*1.8+.45)*WORLD_H*.024+Math.sin(xn*Math.PI*4.4-1.1)*WORLD_H*.010;}
function desertBoundaryY(x){const xn=(x-ISLAND_CX)/Math.max(1,ISLAND_RADIUS);return ISLAND_CY+ISLAND_RADIUS*.22+Math.sin(xn*Math.PI*1.55-.35)*WORLD_H*.020+Math.sin(xn*Math.PI*3.2+1.4)*WORLD_H*.008;}
function mountainBoundaryX(y){const yn=(y-ISLAND_CY)/Math.max(1,ISLAND_RADIUS);return ISLAND_CX-ISLAND_RADIUS*1.10+Math.sin(yn*Math.PI*1.7+.6)*WORLD_H*.012+Math.sin(yn*Math.PI*3.9-.9)*WORLD_H*.004;}
function worldBiomeAt(x,y){if(!isInsideIsland(x,y,0))return "ocean";if(y<=arcticBoundaryY(x))return "arctic";if(y>=desertBoundaryY(x))return "desert";if(x<=mountainBoundaryX(y))return "mountains";return x<=forestRainBoundaryX(y)?"forest":"rainforest";}
function randomBiomeZoneId(){return BIOME_ORDER[randi(0,BIOME_ORDER.length-1)]||"forest";}
function speciesHomeBiome(type){for(const id of BIOME_ORDER)if((BIOME_PROFILES[id]?.species||[]).includes(type))return id;return "forest";}
function randomPointInBiome(biomeId,pad=120){const wanted=BIOME_ORDER.includes(biomeBaseId(biomeId))?biomeBaseId(biomeId):"forest",safePad=Math.max(0,Number(pad)||0),maxR=Math.max(180,ISLAND_RADIUS-safePad-70);if(wanted==="mountains"){for(let tries=0;tries<520;tries++){const y=rand(ISLAND_CY-ISLAND_RADIUS*.48,ISLAND_CY+ISLAND_RADIUS*.48),edge=mountainBoundaryX(y)-safePad-25;if(edge<=safePad+40)continue;const x=rand(Math.max(safePad,120),edge);if(worldBiomeAt(x,y)===wanted&&isInsideIsland(x,y,safePad))return{x,y};}}for(let tries=0;tries<360;tries++){const a=rand(0,TAU),rr=Math.sqrt(Math.random())*maxR,x=ISLAND_CX+Math.cos(a)*rr,y=ISLAND_CY+Math.sin(a)*rr;if(worldBiomeAt(x,y)===wanted&&isInsideIsland(x,y,safePad))return{x,y};}const zone=BIOME_ZONES[wanted]||BIOME_ZONES.forest;return{x:zone.cx,y:zone.cy};}
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
    this.playerAttackCd=new Map(); this.playerShootCd=new Map(); this.enemyAggro=new Map(); this.animalAggro=new Map();
    // Mirrors offline a.fleeFrom and hostile wild Dog wall ownership without
    // adding server-only targeting objects to the synchronized schema.
    this.animalFleeFrom=new Map(); this.hostileWildWalls=new Map();
    this.petFocusTargets=new Map();
    this.petHuntState=new Map();
    // Server-only idle-wander/follow state. Keeping this out of the Colyseus
    // schema avoids sending wander targets and stuck timers over the network.
    this.petFollowState=new Map();
    this.petChaseState=new Map();
    this.playerRunShop=new Map(); this.playerSkillProgress=new Map(); this.tamePendingPlayers=new Set();
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
    // Every named HOSTL world has a permanent generation seed. This means a
    // world rebuild/restart produces the exact same resource, gold, chest and
    // starting-wildlife layout for every player who chooses that world.
    const originalRandom = Math.random;
    Math.random = makeSeededRandom(hashWorldSeed(`HOSTL:${this.worldId}:resources:v1`));
    try { this.generateWorld(); } finally { Math.random = originalRandom; }
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
    this.onMessage("goldHit",(client,data={})=>this.handleGoldHit(client,data));
    this.onMessage("attack",(client,data={})=>this.handleAttack(client,data));
    this.onMessage("throwAxe",(client,data={})=>this.handleThrowAxe(client,data));
    this.onMessage("biomeFood",(client,data={})=>this.handleBiomeFood(client,data));
    this.onMessage("shoot",(client,data={})=>this.handleShoot(client,data));
    this.onMessage("tame",(client,data={})=>this.handleTame(client,data));
    this.onMessage("runShopBuy",(client,data={})=>this.handleRunShopBuy(client,data));
    this.onMessage("skillChoice",(client,data={})=>this.handleSkillChoice(client,data));
    this.onMessage("build",(client,data={})=>this.handleBuild(client,data));
    this.onMessage("heal",(client,data={})=>this.handleHeal(client,data));
    this.onMessage("waterAction",(client,data={})=>this.handleWaterAction(client,data));
    this.onMessage("respawn",(client,data={})=>this.handleRespawn(client,data));
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
    for(const s of this.nearbySolids(x,y,r+150)) if(dist(x,y,s.x,s.y)<r+s.r+6) return false;
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
          if(r.type==="log"){
            let best=null,bestOverlap=0;
            const body=animalPhysicalCircles(obj);
            for(const h of body)for(const q of logParts(r)){const d=dist(h.x,h.y,q.x,q.y),overlap=h.r*.9+q.r-d;if(overlap>bestOverlap){bestOverlap=overlap;best={h,q,d,overlap};}}
            if(best&&best.d>.1){const a=angTo(best.q.x,best.q.y,best.h.x,best.h.y);obj.x+=Math.cos(a)*best.overlap;obj.y+=Math.sin(a)*best.overlap;obj._lastResourceContactId=solid.id;}
          }else{const c=resourceCenter(r);if(pushCreatureFrom(c.x,c.y,r.solidR))obj._lastResourceContactId=solid.id;}
        }else if(solid.kind==="gold"){const g=this.state.gold.get(solid.id);if(!g||(!g.infinite&&g.goldLeft<=0))continue;const h=goldHit(g);pushCreatureFrom(h.x,h.y,h.r);}
        else if(solid.kind==="chest"){const c=this.state.chests.get(solid.id);if(!c||c.opened)continue;const h=chestHit(c);pushCreatureFrom(h.x,h.y,h.r);}
      }
      // Creature-vs-wall collision uses the same torso-only circles as other solids.
      for(const[,w]of this.state.walls){
        let best=null,bestOverlap=0;
        for(const h of animalPhysicalCircles(obj)){const d=dist(h.x,h.y,w.x,w.y),overlap=h.r+w.r-d;if(overlap>bestOverlap){bestOverlap=overlap;best={h,d,overlap};}}
        if(best&&best.d>.1){const a=angTo(w.x,w.y,best.h.x,best.h.y);obj.x+=Math.cos(a)*best.overlap;obj.y+=Math.sin(a)*best.overlap;}
      }
      obj.x=clamp(obj.x,20,WORLD_W-20);obj.y=clamp(obj.y,20,WORLD_H-20);keepObjectOnIsland(obj,Math.max(22,(Number(obj.r)||18)*.78));return;
    }

    if(isPlayer){
      for(const solid of this.nearbySolids(obj.x,obj.y,260)){
        if(solid.kind==="water")continue;
        if(solid.kind==="resource"){
          const r=this.state.resources.get(solid.id);if(!r||!r.alive)continue;
          if(r.type==="log"){
            let best=null,bestOverlap=0;for(const q of logParts(r)){const d=dist(obj.x,obj.y,q.x,q.y),overlap=PLAYER_R+q.r-d;if(overlap>bestOverlap){bestOverlap=overlap;best={q,d,overlap};}}
            if(best&&best.d>.1){const a=angTo(best.q.x,best.q.y,obj.x,obj.y);obj.x+=Math.cos(a)*best.overlap;obj.y+=Math.sin(a)*best.overlap;}
          }else{
            const c=resourceCenter(r),pr=(r.type==="tree"||r.type==="bush")?PLAYER_R*.7:PLAYER_R;
            const d=dist(obj.x,obj.y,c.x,c.y),min=r.solidR+pr;if(d<min&&d>.01){const a=angTo(c.x,c.y,obj.x,obj.y);obj.x=c.x+Math.cos(a)*min;obj.y=c.y+Math.sin(a)*min;}
          }
        }else if(solid.kind==="gold"){const g=this.state.gold.get(solid.id);if(!g||(!g.infinite&&g.goldLeft<=0))continue;const h=goldHit(g),d=dist(obj.x,obj.y,h.x,h.y),min=h.r+PLAYER_R;if(d<min&&d>.01){const a=angTo(h.x,h.y,obj.x,obj.y);obj.x=h.x+Math.cos(a)*min;obj.y=h.y+Math.sin(a)*min;}}
        else if(solid.kind==="chest"){const c=this.state.chests.get(solid.id);if(!c||c.opened)continue;const h=chestHit(c),d=dist(obj.x,obj.y,h.x,h.y),min=h.r+PLAYER_R*.9;if(d<min&&d>.01){const a=angTo(h.x,h.y,obj.x,obj.y);obj.x=h.x+Math.cos(a)*min;obj.y=h.y+Math.sin(a)*min;}}
      }
      for(const[,w]of this.state.walls){const d=dist(obj.x,obj.y,w.x,w.y),min=PLAYER_R+w.r;if(d<min&&d>.01){const a=angTo(w.x,w.y,obj.x,obj.y);obj.x=w.x+Math.cos(a)*min;obj.y=w.y+Math.sin(a)*min;}}
      obj.x=clamp(obj.x,PLAYER_R,WORLD_W-PLAYER_R);obj.y=clamp(obj.y,PLAYER_R,WORLD_H-PLAYER_R);keepObjectOnIsland(obj,PLAYER_R+10);return;
    }

    for(const solid of this.nearbySolids(obj.x,obj.y,radius+100)){
      if(solid.kind==="water")continue;
      if(solid.kind==="resource"){const r=this.state.resources.get(solid.id);if(r&&!r.alive)continue;}
      if(solid.kind==="gold"){const g=this.state.gold.get(solid.id);if(g&&!g.infinite&&g.goldLeft<=0)continue;}
      if(solid.kind==="chest"){const c=this.state.chests.get(solid.id);if(c?.opened)continue;}
      const d=dist(obj.x,obj.y,solid.x,solid.y),min=radius+solid.r;if(d<min){const a=d>.01?angTo(solid.x,solid.y,obj.x,obj.y):(obj.angle||0);obj.x=solid.x+Math.cos(a)*min;obj.y=solid.y+Math.sin(a)*min;}
    }
    for(const[,w]of this.state.walls){const d=dist(obj.x,obj.y,w.x,w.y),min=radius+w.r;if(d<min){const a=d>.01?angTo(w.x,w.y,obj.x,obj.y):(obj.angle||0);obj.x=w.x+Math.cos(a)*min;obj.y=w.y+Math.sin(a)*min;}}
    obj.x=clamp(obj.x,20,WORLD_W-20);obj.y=clamp(obj.y,20,WORLD_H-20);keepObjectOnIsland(obj,Math.max(22,(Number(radius)||18)+8));
  }

  resourceBlocksCreaturePath(obj,r){
    if(!obj||!r||!r.alive||r.type==="pond"||r.type==="river")return false;
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
    for(const [,w] of this.state.walls){if(dist(x,y,w.x,w.y)<PLAYER_R+w.r+35)return false;}
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

  addResource(type,x,y,hp,solidR,canopyR,scale,rot){const r=new ResourceState();Object.assign(r,{type,x,y,hp,maxHp:hp,alive:true,solidR,canopyR,scale,rot});const id=`r${this.nextResourceId++}`;this.state.resources.set(id,r);if(type==="pond"||type==="river")this.addSolid(x,y,solidR+(type==="pond"?58:30),"water",id);else this.addSolid(x,y,type==="log"?solidR*1.35:solidR,"resource",id);}
  addGold(x,y,size,r,goldLeft,infinite=false,pure=false){const g=new GoldState();Object.assign(g,{x,y,size,r,goldLeft:infinite?999999999:goldLeft,infinite,pure});const id=`g${this.nextGoldId++}`;this.state.gold.set(id,g);this.addSolid(x,y+(pure?r*.06:r*.03),r*(pure?.78:size==="huge"?.75:.72),"gold",id);}
  addChest(x,y){const c=new ChestState();Object.assign(c,{x,y,r:18,hp:4,maxHp:4,opened:false,pulse:0,shine:rand(0,TAU),chipSide:Math.random()<.5?"wood":"stone"});const id=`c${this.nextChestId++}`;this.state.chests.set(id,c);this.chestRewards.set(id,this.makeChestReward());this.addSolid(x,y+8,18,"chest",id);}

  isWildBeeType(type){ return type==="queenbee"||type==="workerbee"||type==="dronebee"; }
  isNeutralBeeType(type){return type==="queenbee"||type==="workerbee";}
  droneBeeShouldFlee(a){return !!(a&&a.type==="dronebee"&&a.hp>0&&a.maxHp>0&&a.hp/a.maxHp<=.26);}
  setBeeHomeForAnimal(a,hiveId){if(!a||!this.isWildBeeType(a.type))return null;const hive=this.state.resources.get(String(hiveId||""));if(hive&&hive.alive&&hive.type==="rainforestHive"){a._hiveHomeId=String(hiveId);return hive;}return this.beeHomeResourceForAnimal(a);}
  hiveResourceCenter(r){ return r&&r.type==="tree"?{x:r.x,y:r.y+4*(r.scale||1)}:{x:r?.x||0,y:r?.y||0}; }
  nearestHiveResourceId(x,y){ let best="",bestD=Infinity; for(const[id,r] of this.state.resources){ if(!r||!r.alive||r.type!=="rainforestHive")continue; const c=this.hiveResourceCenter(r),d=dist(x,y,c.x,c.y); if(d<bestD){bestD=d;best=id;} } return best; }
  beeHomeResourceForAnimal(a){ if(!a||!this.isWildBeeType(a.type))return null; const cur=a._hiveHomeId&&this.state.resources.get(a._hiveHomeId); if(cur&&cur.alive&&cur.type==="rainforestHive")return cur; const id=this.nearestHiveResourceId(a.x,a.y); a._hiveHomeId=id||""; return id?this.state.resources.get(id):null; }
  settleBeeNearHome(a,slot=0){ const hive=this.beeHomeResourceForAnimal(a); if(!hive)return false; const ringStep=a.type==="queenbee"?0:a.type==="workerbee"?1:2; const ring=Math.floor(slot/6)+ringStep; const perRing=6+ring*2; const angle=((slot%perRing)/perRing)*TAU + (ring*0.37); const base=(hive.solidR||48)+Math.max(20,(a.r||18)*.70)+22+ring*18+(a.type==="queenbee"?0:(a.type==="workerbee"?8:14)); const tx=clamp(hive.x+Math.cos(angle)*base,24,WORLD_W-24),ty=clamp(hive.y+Math.sin(angle)*(base*.78),24,WORLD_H-24); if(!this.collidesSolid(tx,ty,Math.max(8,(a.r||18)*.52),"")){ a.x=tx; a.y=ty; } a.wanderA=angle+Math.PI*.5; a.wanderT=rand(.35,1.1); a.sleeping=false; a._hiveOrbitA=angle; a._hiveOrbitDir=a._hiveOrbitDir||((Math.random()<.5)?-1:1); return true; }
  organizeRainforestHives(){ const counts=new Map(); for(const[,a] of this.state.animals){ if(!a||a.dead||a.hp<=0||!this.isWildBeeType(a.type))continue; const hive=this.beeHomeResourceForAnimal(a); if(!hive)continue; const key=a._hiveHomeId||""; const slot=counts.get(key)||0; this.settleBeeNearHome(a,slot); counts.set(key,slot+1); } }
  hiveBeeStage(type,hiveOrdinal=0,first=false){if(type==="queenbee"){if(first&&hiveOrdinal===0)return "bigmomma";const q=Math.random();return q<.58?"adult":q<.88?"boss":"superboss";}const q=Math.random();return q<.38?"baby":q<.88?"adult":"boss";}
  spawnHiveBee(hiveId,hive,type,stage){if(!hive||!hive.alive||hive.type!=="rainforestHive")return null;const footprint=animalSpawnFootprint(type,stage);for(let t=0;t<45;t++){const aa=rand(0,TAU),dd=(hive.solidR||90)+footprint+rand(28,90),x=clamp(hive.x+Math.cos(aa)*dd,24,WORLD_W-24),y=clamp(hive.y+Math.sin(aa)*dd*.78,24,WORLD_H-24);if(!this.canPlace(x,y,footprint,0))continue;const id=this.addAnimal(type,stage,x,y,{sleeping:Math.random()<beeSleepSpawnChance(type,stage)}),bee=this.state.animals.get(id);if(!bee)return null;bee._hiveHomeId=hiveId;bee._hiveOrbitA=aa;bee._hiveOrbitDir=Math.random()<.5?-1:1;return bee;}return null;}
  populateRainforestHives(first=false){let ordinal=0;for(const[hiveId,hive]of this.state.resources){if(!hive||!hive.alive||hive.type!=="rainforestHive")continue;const counts={dronebee:0,workerbee:0,queenbee:0};for(const[,a]of this.state.animals)if(a&&a.hp>0&&this.isWildBeeType(a.type)&&a._hiveHomeId===hiveId)counts[a.type]=(counts[a.type]||0)+1;const desired={dronebee:4,workerbee:2,queenbee:1};for(const type of ["dronebee","workerbee","queenbee"]){while((counts[type]||0)<desired[type]){if(!this.spawnHiveBee(hiveId,hive,type,this.hiveBeeStage(type,ordinal,first)))break;counts[type]++;}}hive._beeSpawnT=Number.isFinite(hive._beeSpawnT)?hive._beeSpawnT:rand(28,48);ordinal++;}}
  updateHiveBeeSpawners(dt){for(const[hiveId,hive]of this.state.resources){if(!hive||!hive.alive||hive.type!=="rainforestHive")continue;hive._beeSpawnT=(Number(hive._beeSpawnT)||rand(28,48))-dt;if(hive._beeSpawnT>0)continue;const counts={dronebee:0,workerbee:0,queenbee:0};for(const[,a]of this.state.animals)if(a&&a.hp>0&&this.isWildBeeType(a.type)&&a._hiveHomeId===hiveId)counts[a.type]=(counts[a.type]||0)+1;let type="";if(counts.dronebee<4)type="dronebee";else if(counts.workerbee<2)type="workerbee";else if(counts.queenbee<1)type="queenbee";if(type)this.spawnHiveBee(hiveId,hive,type,this.hiveBeeStage(type,99,false));hive._beeSpawnT=rand(32,55);}}
  updateBeeHomeBehavior(id,a,dt){ const hive=this.beeHomeResourceForAnimal(a); if(!hive)return false; const c=this.hiveResourceCenter(hive); a._hiveOrbitDir=Number.isFinite(a._hiveOrbitDir)?a._hiveOrbitDir:(Math.random()<.5?-1:1); a._hiveOrbitA=(Number.isFinite(a._hiveOrbitA)?a._hiveOrbitA:rand(0,TAU)) + dt*(a.type==="dronebee"?0.95:a.type==="workerbee"?0.72:0.52)*a._hiveOrbitDir; const orbitBase=(hive.solidR||52)+(a.type==="queenbee"?22:(a.type==="workerbee"?34:44)); const tx=c.x+Math.cos(a._hiveOrbitA)*(orbitBase+Math.sin(this.state.worldTime*0.8+(a.x+a.y)*0.002)*8); const ty=c.y+Math.sin(a._hiveOrbitA)*(orbitBase*.76+Math.cos(this.state.worldTime*0.7+(a.x-a.y)*0.002)*6); const d=dist(a.x,a.y,c.x,c.y); if(d<Math.max(24,(hive.solidR||52)*0.72)){ const pushA=angTo(c.x,c.y,a.x,a.y); a.wanderA=pushA; smoothTurn(a,pushA,dt,4.8); this.moveCreatureSwept(a,(a.speed||60)*0.60,dt); return true; } a.wanderT=(a.wanderT||0)-dt; if(d>orbitBase+90||a.wanderT<=0){ a.wanderA=angTo(a.x,a.y,tx,ty); a.wanderT=d>orbitBase+90?rand(.22,.55):rand(.45,1.05); } smoothTurn(a,a.wanderA||0,dt,4.2); this.moveCreatureSwept(a,(a.speed||60)*(d>orbitBase+90?.76:.52),dt); return true; }

  addAnimal(type,stage,x,y,opts={}) {
    if(stage==="bigmomma"&&Array.from(this.state.animals.values()).filter(q=>q&&q.hp>0&&q.stage==="bigmomma").length>=5)stage="superboss";
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
      if(w&&dist(x,y,w.x,w.y)<clearR+Math.max(8,w.r||20)){this.state.walls.delete(id);this.hostileWildWalls.delete(id);broken++;}
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
  addTower(x,y,ownerId="",tier=0){const t=new TowerState();Object.assign(t,{x,y,cd:.5,ownerId,tier:clamp(Math.floor(Number(tier)||0),0,2)});const id=`t${this.nextTowerId++}`;this.state.towers.set(id,t);return id;}
  addProjectile(data){const p=new ProjectileState();Object.assign(p,data);const id=`q${this.nextProjectileId++}`;this.state.projectiles.set(id,p);return id;}

  scatter(type,count,hp,minCenter){for(let i=0;i<count;i++){for(let tries=0;tries<85;tries++){let scale=1,solid=12,canopy=0;if(type==="tree"){scale=rand(1.2,2.3);solid=8.8*scale;canopy=46*scale;}else if(type==="rock"){scale=rand(1,2.05);solid=26.5*scale;}else if(type==="log"){scale=rand(1,1.6);solid=17.5*scale;}else if(type==="bush"){scale=rand(1.08,1.7);solid=10.8*scale;canopy=24*scale;}const pos=randomLandPoint(Math.max(120,solid+80)),x=pos.x,y=pos.y,biome=worldBiomeAt(x,y);const chance=biome==="arctic"?(type==="tree"?.34:type==="bush"?.44:type==="log"?.40:.86):biome==="desert"?(type==="tree"?.18:type==="bush"?.22:type==="log"?.08:.92):biome==="mountains"?(type==="tree"?.26:type==="bush"?.34:type==="log"?.20:.98):type==="tree"?(biome==="rainforest"?1:.88):type==="bush"?(biome==="rainforest"?1:.82):type==="log"?(biome==="rainforest"?.90:.78):(biome==="rainforest"?.56:.68);if(Math.random()>chance)continue;if(!this.canPlace(x,y,solid,minCenter))continue;this.addResource(type,x,y,hp,solid,canopy,scale,type==="log"?rand(0,TAU):0);break;}}}
  placeBiomeFeatures(){
    for(let i=0;i<72;i++)for(let t=0;t<20;t++){const pos=randomPointInBiome("rainforest",80),scale=rand(1.05,1.65),solid=10.8*scale;if(!this.canPlace(pos.x,pos.y,solid+10,0))continue;this.addResource("bush",pos.x,pos.y,8,solid,24*scale,scale,0);break;}
    const placeUnique=(type,count,biome)=>{const info=BIOME_RESOURCE_INFO[type];for(let i=0;i<count;i++)for(let t=0;t<50;t++){const pos=randomPointInBiome(biome,72),isCactus=type==="desertCactusGood"||type==="desertCactusBad",isHive=type==="rainforestHive",scale=isHive?rand(4.0,4.8):(isCactus?rand(1.55,2.15):rand(.9,1.35)),solid=isHive?(27*scale):((info.category==="stone"?17:(isCactus?14:12))*scale),hp=isHive?Math.round(info.hp*2.15):info.hp;if(!this.canPlace(pos.x,pos.y,solid+12,0))continue;this.addResource(type,pos.x,pos.y,hp,solid,0,scale,rand(-.35,.35));break;}};
    placeUnique("forestHerb",24,"forest");placeUnique("forestResin",22,"forest");placeUnique("rainforestVine",26,"rainforest");placeUnique("rainforestFruit",24,"rainforest");placeUnique("rainforestHive",6,"rainforest");placeUnique("arcticIceCrystal",30,"arctic");placeUnique("arcticFrostBerry",26,"arctic");placeUnique("desertCactusGood",22,"desert");placeUnique("desertCactusBad",18,"desert");placeUnique("desertSandstone",24,"desert");placeUnique("mountainIron",30,"mountains");placeUnique("mountainQuartz",26,"mountains");placeUnique("mountainGem",22,"mountains");placeUnique("mountainStoneFruit",24,"mountains");
  }
  generateWorld(){
    this.addGold(WORLD_W/2,WORLD_H/2,"pure",176,999999999,true,true);
    const nonDesert=BIOME_ORDER.filter(id=>id!=="desert");
    for(const biome of nonDesert){for(let i=0;i<16;i++)for(let t=0;t<90;t++){const radius=rand(78,134),squish=rand(.64,.84),pos=randomPointInBiome(biome,radius+120);if(dist(pos.x,pos.y,WORLD_W/2,WORLD_H/2)<520||!this.canPlace(pos.x,pos.y,radius+72,0)||!waterPlacementClear(this.state.resources,pos.x,pos.y,radius,radius*squish,42))continue;this.addResource("pond",pos.x,pos.y,1,radius,radius*squish,1,rand(0,TAU));break;}}
    for(let i=0;i<12;i++)for(let t=0;t<90;t++){const radius=rand(72,122),squish=rand(.64,.84),pos=randomLandPoint(radius+120);if(worldBiomeAt(pos.x,pos.y)==="desert")continue;if(dist(pos.x,pos.y,WORLD_W/2,WORLD_H/2)<520||!this.canPlace(pos.x,pos.y,radius+70,0)||!waterPlacementClear(this.state.resources,pos.x,pos.y,radius,radius*squish,42))continue;this.addResource("pond",pos.x,pos.y,1,radius,radius*squish,1,rand(0,TAU));break;}
    let oasisA=null;for(let i=0;i<2;i++)for(let t=0;t<180;t++){const radius=rand(96,136),squish=rand(.68,.92),pos=randomPointInBiome("desert",radius+150);if(oasisA&&dist(pos.x,pos.y,oasisA.x,oasisA.y)<WORLD_W*.24)continue;if(!this.canPlace(pos.x,pos.y,radius+80,0)||!waterPlacementClear(this.state.resources,pos.x,pos.y,radius,radius*squish,48))continue;this.addResource("pond",pos.x,pos.y,1,radius,radius*squish,1,rand(0,TAU));if(!oasisA)oasisA={x:pos.x,y:pos.y};break;}
    for(let ri=0;ri<nonDesert.length;ri++){const riverBiome=nonDesert[ri]||"forest",start=randomPointInBiome(riverBiome,720),baseAngle=rand(-Math.PI,Math.PI);let cx=start.x,cy=start.y;for(let seg=0;seg<6;seg++){const ang=baseAngle+Math.sin(seg*.9+ri)*.18,rx=rand(300,390),ry=rand(52,72);if(seg){cx+=Math.cos(ang)*rx*.86;cy+=Math.sin(ang)*rx*.86;}const cp=islandConstrainedPoint(cx,cy,rx+180);cx=cp.x;cy=cp.y;if(worldBiomeAt(cx,cy)==="desert"||!this.canPlace(cx,cy,ry+38,0)||!waterPlacementClear(this.state.resources,cx,cy,rx,ry,34))continue;this.addResource("river",cx,cy,1,rx,ry,1,ang);}}
    this.placeBiomeFeatures();
    this.scatter("tree",620,9,240);this.scatter("rock",360,4,240);this.scatter("log",240,2.4,180);this.scatter("bush",410,8,180);
    for(let i=0;i<10;i++)for(let t=0;t<70;t++){const pos=randomLandPoint(500);if(dist(pos.x,pos.y,WORLD_W/2,WORLD_H/2)<500||!this.canPlace(pos.x,pos.y,48,0))continue;this.addGold(pos.x,pos.y,"huge",48,40);break;}
    for(let i=0;i<82;i++)for(let t=0;t<55;t++){const pos=randomLandPoint(170);if(!this.canPlace(pos.x,pos.y,16,0))continue;this.addGold(pos.x,pos.y,"small",16,6);break;}
    for(let i=0;i<48;i++)for(let t=0;t<65;t++){const pos=randomLandPoint(180),x=pos.x,y=pos.y;if(dist(x,y,WORLD_W/2,WORLD_H/2)<280||!this.canPlace(x,y,20,0))continue;this.addChest(x,y);break;}
    const randomGroupStage=()=>{const roll=Math.random();return roll<.50?"baby":roll<.90?"adult":roll<.98?"boss":"superboss";};
    const spawnWild=(forced=null,typeOverride=null,anchor=null,biomeOverride=null)=>{
      const biomeHint=anchor?biomeBaseId(worldBiomeAt(anchor.x,anchor.y)):(biomeOverride?biomeBaseId(biomeOverride):(typeOverride?speciesHomeBiome(typeOverride):randomBiomeZoneId()));
      const species=(BIOME_PROFILES[biomeHint]?.species||WILD_SPECIES).filter(type=>WILD_SPECIES.includes(type));
      const type=typeOverride||randomWildSpecies(species);let stage=forced;if(!stage){const roll=Math.random();stage=roll<.46?"baby":roll<.84?"adult":roll<.95?"boss":"superboss";}
      const footprint=animalSpawnFootprint(type,stage);
      for(let t=0;t<(anchor?110:80);t++){let x,y;if(anchor){const aa=rand(0,TAU),anchorR=animalSpawnFootprint(anchor.type,anchor.stage),minD=Math.max(78,footprint+anchorR+18),maxD=Math.max(minD+28,Math.min(310,minD+170)),dd=rand(minD,maxD);x=anchor.x+Math.cos(aa)*dd;y=anchor.y+Math.sin(aa)*dd;const cp=islandConstrainedPoint(x,y,footprint+45);x=cp.x;y=cp.y;}else{const pos=randomPointInBiome(biomeHint,footprint+60);x=pos.x;y=pos.y;}if(!this.canPlace(x,y,footprint,0))continue;let crowded=false;for(const[,a]of this.state.animals){if(!a||a.hp<=0)continue;const gap=anchor?8:36;if(dist(x,y,a.x,a.y)<footprint+animalSpawnFootprint(a.type,a.stage)+gap){crowded=true;break;}}if(crowded)continue;const id=this.addAnimal(type,stage,x,y);return this.state.animals.get(id)||null;}return null;
    };
    const STARTING_WILD_PER_SPECIES_BY_BIOME={forest:7,rainforest:9,arctic:12,desert:10,mountains:12};
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
        const targetPerSpecies=STARTING_WILD_PER_SPECIES_BY_BIOME[biome]||7;
        let made=0;
        for(const stage of stages){let spawned=false;for(let attempt=0;attempt<5&&!spawned;attempt++)spawned=!!spawnWild(stage,type,null,biome);if(spawned)made++;}
        for(let retry=0;made<targetPerSpecies&&retry<targetPerSpecies*7;retry++){const extraIndex=Math.max(0,made-STARTING_STAGE_PLAN.length),stage=EXTRA_STAGE_PLAN[(extraIndex+retry)%EXTRA_STAGE_PLAN.length];if(spawnWild(stage,type,null,biome))made++;}
        speciesOrdinal++;
      }
    }
    let bigMommaCount=Array.from(this.state.animals.values()).filter(a=>a&&a.hp>0&&a.stage==="bigmomma").length;
    for(let pass=0;bigMommaCount<5&&pass<25;pass++){const target=bigMommaTargets[pass%Math.max(1,bigMommaTargets.length)]||{type:"bear",biome:"forest"};if(spawnWild("bigmomma",target.type,null,target.biome))bigMommaCount++;}
    console.log(`Island world generated: ${this.state.resources.size} resources, ${this.state.gold.size} gold, ${this.state.chests.size} chests, ${this.state.animals.size} wildlife`);
  }

  randomPlayerPosition(){const vals=Array.from(this.state.players.values()).filter(p=>!p.dead);return vals.length?pick(vals):{x:WORLD_W/2,y:WORLD_H/2};}
  validTool(name){return TOOL[name]?name:"Fist";}
  toolStats(name,tier=0){const base=TOOL[this.validTool(name)],t={...base};tier=clamp(Math.floor(Number(tier)||0),0,2);if(name==="Axe"&&tier>=1)Object.assign(t,{dmg:8,gather:3.6,resourcePower:1.35,woodWall:14,cadence:.52});if(name==="Axe"&&tier>=2)Object.assign(t,{dmg:11,gather:4.6,resourcePower:1.65,woodWall:18,cadence:.48});if(name==="Sword"&&tier>=1)Object.assign(t,{dmg:13,range:56,cadence:.37});if(name==="Sword"&&tier>=2)Object.assign(t,{dmg:18,range:58,cadence:.34});if(name==="Pickaxe"&&tier>=1)Object.assign(t,{dmg:7,gather:3.4,resourcePower:1.45,stoneWall:18});if(name==="Pickaxe"&&tier>=2)Object.assign(t,{dmg:9,gather:4.5,resourcePower:1.8,stoneWall:23});if(name==="Bow"&&tier>=1)Object.assign(t,{dmg:13,cadence:.46});return t;}
  specializedToolStats(ownerId,name,tier=0){const t=this.toolStats(name,tier),spec=String(this.skillState(ownerId).weaponChoice||"");if(name==="Sword"){if(spec==="daggers")Object.assign(t,{dmg:7.2,range:44,cadence:.22,doubleHit:true});else if(spec==="longSword")Object.assign(t,{dmg:21,range:74,cadence:.50});else if(spec==="spear")Object.assign(t,{dmg:16,range:96,cadence:.46});}if(name==="Axe"){if(spec==="doubleAxe")Object.assign(t,{dmg:8.8,range:66,cadence:.72,gather:4,resourcePower:1.5,doubleHit:true});else if(spec==="throwingAxe")Object.assign(t,{dmg:16,range:50,cadence:.72,gather:1.7,resourcePower:.72,throwing:true});else if(spec==="battleAxe")Object.assign(t,{dmg:20,range:78,cadence:.68,gather:2.3,resourcePower:.95,woodWall:11});}return t;}
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
    if(typeof input.tool==="string"&&input.tool.length<24)p.tool=this.validTool(input.tool);
    if(typeof input.heldSpecial==="string")p.heldSpecial=["Berry","JungleBerry","FrostBerry","GoodCactus","BadCactus","StoneFruit","Honey","HoneyComb","Bucket","Wall","Saddle","Tower"].includes(input.heldSpecial)?input.heldSpecial:"";
    if(typeof input.ridingPetId==="string"){
      const requested=input.ridingPetId.slice(0,32);
      if(!requested)p.ridingPetId="";
      else{
        const mount=this.state.pets.get(requested);
        p.ridingPetId=(mount&&mount.ownerId===client.sessionId&&!mount.dead&&["adult","boss","superboss"].includes(mount.stage))?requested:"";
      }
    }

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
      let tx=clamp(clientX,PLAYER_R,WORLD_W-PLAYER_R),ty=clamp(clientY,PLAYER_R,WORLD_H-PLAYER_R);
      // The previous fixed 52px mounted packet cap could lag behind a fast mount
      // after a browser/network hitch, making the next state patch look like a
      // backward push. Scale the allowed catch-up distance from the mount's real
      // speed and actual packet gap, while still bounding impossible teleports.
      const slowMul=(Number(p._abilitySlowUntil)||0)>this.state.worldTime?(Number(p._abilitySlowMul)||.55):1;
      const inputMag=clamp(Math.hypot(p.moveX||0,p.moveY||0),0,1);
      const hydrationMul=this.hydrationMoveMul(p.hydration);
      let expectedSpeed=148*inputMag*this.runPerks(client.sessionId).moveMul*hydrationMul;
      if(rideMount&&!rideMount.dead)expectedSpeed=Math.max(24,Number(rideMount.speed)||148)*2.30*inputMag;
      if(p.heldSpecial==="Wall")expectedSpeed*=.64;
      expectedSpeed*=slowMul;
      const minStep=rideMount?52:34;
      const maxCap=rideMount?190:110;
      const maxStep=clamp(expectedSpeed*packetDt*1.90+16,minStep,maxCap);
      let dx=tx-p.x,dy=ty-p.y;const len=Math.hypot(dx,dy);
      if(len>maxStep){dx=dx/len*maxStep;dy=dy/len*maxStep;tx=p.x+dx;ty=p.y+dy;}
      const steps=Math.max(1,Math.min(24,Math.ceil(Math.hypot(tx-p.x,ty-p.y)/5.5)));
      const sx=(tx-p.x)/steps,sy=(ty-p.y)/steps;
      if(rideMount&&!rideMount.dead)rideMount._lastResourceContactId="";
      for(let i=0;i<steps;i++){
        p.x=clamp(p.x+sx,PLAYER_R,WORLD_W-PLAYER_R);p.y=clamp(p.y+sy,PLAYER_R,WORLD_H-PLAYER_R);
        const mount=p.ridingPetId?this.state.pets.get(p.ridingPetId):null;
        if(mount&&!mount.dead){
          mount._mountedCollision=true;mount.x=p.x;mount.y=p.y;
          this.resolveStatic(mount,(mount.r||18)*.72);
          p.x=mount.x;p.y=mount.y;
        }else this.resolveStatic(p,PLAYER_R*.82);
      }
      this.applyMovementHydration(p,inputMag,packetDt);
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
    const amount=clamp(+data.amount||0,0,40);if(amount<=0)return;
    if(data?.target==="mount"&&p.ridingPetId){
      const mount=this.state.pets.get(p.ridingPetId);
      if(mount&&!mount.dead&&mount.ownerId===client.sessionId){mount.hp=clamp(mount.hp+amount,0,mount.maxHp);return;}
    }
    p.health=clamp(p.health+amount,0,p.maxHealth);
  }
  handleRespawn(client,data={}){const p=this.state.players.get(client.sessionId);if(!p)return;this.playerCombatReadyAt.set(client.sessionId,this.state.worldTime+1.15);this.playerSurvivalSeconds.set(client.sessionId,0);this.playerSurvivalAwards.set(client.sessionId,new Set());this.playerNightSeen.delete(client.sessionId);this.playerRunShop.set(client.sessionId,{purchased:new Set(),hat:"",cape:"",armor:""});this.playerSkillProgress.set(client.sessionId,{level:0,xp:0,speed:0,strength:0,defense:0,stoneChoice:"",weaponChoice:"",milestones:{}});this.playerBiomeMaterials.set(client.sessionId,{});this.sendSkillState(client.sessionId);this.tamePendingPlayers.delete(client.sessionId);const oldX=p.x,oldY=p.y;const requested=Math.max(0,Math.min(3200,Number(data?.minDistance)||2400));const s=this.safeSpawn(oldX,oldY,requested);p.x=s.x;p.y=s.y;p.angle=rand(-Math.PI,Math.PI);p.health=p.maxHealth;p.hydration=100;p.bucketWater=true;p.bucketSips=BUCKET_MAX_SIPS;p.dead=false;p.heldSpecial="";p.ridingPetId="";p.animalCarryT=0;p._jungleHotUntil=0;p._jungleHotRate=0;p._cactusGoodUntil=0;p._cactusHealRate=0;p._cactusHydrateRate=0;p._badCactusUntil=0;p._badCactusDamageRate=0;p._badCactusHydrateRate=0;p._cactusSpineCd=0;p._desertHydrationWait=2.5;p._stoneFruitUntil=0;p._honeyRushUntil=0;p._honeyHealRate=0;p._honeyHasteMul=1;this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);this.pendingAnimalPushes.delete(client.sessionId);let i=0;for(const[id,pet]of this.state.pets){if(!pet||pet.ownerId!==client.sessionId)continue;const pos=this.safePetSpawnNear(p.x,p.y,pet.r||18);pet.x=pos.x;pet.y=pos.y;pet.angle=p.angle;pet.targetX=0;pet.targetY=0;pet.follow=true;pet.orderMode="follow";this.petFollowState.delete(id);this.petChaseState.delete(id);if(pet.dead){pet.dead=false;pet.hp=pet.maxHp;this.petDeathTimers.delete(id);}i++;}client.send("respawned",{x:p.x,y:p.y,movedFrom:{x:oldX,y:oldY}});}

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

  handleResourceHit(client,data,options={}){const id=String(data.id||""),r=this.state.resources.get(id);if(!r||!r.alive||r.type==="pond"||r.type==="river"||(!options.projectile&&!this.playerCanReach(client,r.x,r.y,Math.min(80,r.solidR))))return;this.addSkillXp(client.sessionId,1);const toolName=this.validTool(String(data.tool||"Fist")),t=this.specializedToolStats(client.sessionId,toolName,data.tier);const p=this.state.players.get(client.sessionId),biomeInfo=BIOME_RESOURCE_INFO[r.type];if(!options.skipHydration)this.consumeHydration(client.sessionId,biomeInfo?.category==="soft"?.9:(r.type==="bush"?.65:1.2));this.broadcast("playerAction",{playerId:client.sessionId,action:"resourceHit",tool:toolName,angle:p?.angle||0,heldSpecial:p?.heldSpecial||"",targetKind:"resource",targetId:id});this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:biomeInfo?.color||(r.type==="bush"?"#d1315c":(r.type==="rock"?"#a9b3bd":"#c99a5b"))});if(biomeInfo){if(r.type==="rainforestHive"){const amount=toolName==="Axe"?2:1,honeyAmt=1,inv=this.playerBiomeMaterials.get(client.sessionId)||{};inv.honeycomb=(inv.honeycomb||0)+amount;inv.honey=(inv.honey||0)+honeyAmt;this.playerBiomeMaterials.set(client.sessionId,inv);client.send("resourceReward",{id,kind:"biomeMaterial",material:"honeycomb",amount,label:"Honey Comb",color:biomeInfo.color});client.send("resourceReward",{id,kind:"biomeMaterial",material:"honey",amount:honeyAmt,label:"Honey",color:"#f4bd42"});this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:biomeInfo.color});return;}const correct=(biomeInfo.category==="wood"&&toolName==="Axe")||(biomeInfo.category==="stone"&&toolName==="Pickaxe")||(biomeInfo.category==="soft"&&(toolName==="Fist"||toolName==="Axe"));let damage=(t.resourcePower==null?1:t.resourcePower)*(correct?1.25:.68);if(toolName==="Sword")damage*=.35;r.hp=Math.max(0,r.hp-damage);const amount=correct?2:1,inv=this.playerBiomeMaterials.get(client.sessionId)||{};inv[biomeInfo.material]=(inv[biomeInfo.material]||0)+amount;this.playerBiomeMaterials.set(client.sessionId,inv);client.send("resourceReward",{id,kind:"biomeMaterial",material:biomeInfo.material,amount,label:biomeInfo.name,color:biomeInfo.color});this.broadcastEntityHealth("resource",id,r);if(r.hp<=0){r.alive=false;this.resourceRespawns.set(id,rand(18,30));this.broadcastEntityHealth("resource",id,r);const accountId=this.playerAccountIds.get(client.sessionId),homeMap={treeResin:"resin",wildHerb:"wildHerb",jungleVine:"swiftFiber",iceCrystal:"iceCrystal"},homeId=homeMap[biomeInfo.material];if(accountId&&homeId){Promise.resolve(HOSTL_ACCOUNT_HOOKS.rewardGameplayMaterial(String(accountId),homeId,1,`biome:${r.type}`)).then(result=>{if(result?.granted)client.send("accountMaterialReward",result);}).catch(()=>{});}}return;}if(r.type==="bush"){r.hp=Math.max(0,r.hp-Math.max(.5,t.gather*.9));client.send("resourceReward",{id,kind:"berries",amount:Math.max(1,Math.round(randi(1,2)*this.runPerks(client.sessionId).gatherMul))});}else{const isWood=r.type==="tree"||r.type==="log",correctAxe=toolName==="Axe"&&isWood,correctPick=toolName==="Pickaxe"&&r.type==="rock";let damage=t.resourcePower;if(r.type==="log")damage*=1.35;if(toolName==="Fist")damage*=r.type==="log"?1.25:.82;if(toolName==="Axe"&&!correctAxe)damage*=.32;if(toolName==="Pickaxe"&&!correctPick)damage*=.32;r.hp=Math.max(0,r.hp-damage);let y=1;if(r.type==="log")y=toolName==="Fist"?2:correctAxe?6:toolName==="Sword"?1:2;else if(correctAxe||correctPick)y=t.gather;else if(toolName==="Fist")y=t.gather;else if(toolName==="Sword")y=.12;else if(toolName==="Bow")y=.35;else y=.45;y*=this.runPerks(client.sessionId).gatherMul;const key=`${client.sessionId}:${id}`,credit=(this.harvestCredits.get(key)||0)+y,whole=Math.floor(credit+1e-6);this.harvestCredits.set(key,credit-whole);if(whole>0)client.send("resourceReward",{id,kind:isWood?"wood":"stone",amount:whole});else if(toolName==="Sword")client.send("resourceReward",{id,kind:isWood?"wood":"stone",amount:0,tiny:true});}this.broadcastEntityHealth("resource",id,r);if(r.hp<=0){r.hp=0;r.alive=false;this.broadcastEntityHealth("resource",id,r);this.resourceRespawns.set(id,rand(12,22));}}
  handleGoldHit(client,data){const id=String(data.id||""),g=this.state.gold.get(id);if(!g||(!g.infinite&&g.goldLeft<=0)||!this.playerCanReach(client,g.x,g.y,Math.min(150,g.r)))return;this.addSkillXp(client.sessionId,1);const tool=this.validTool(String(data.tool||"Fist"));const p=this.state.players.get(client.sessionId);this.consumeHydration(client.sessionId,1.05);this.broadcast("playerAction",{playerId:client.sessionId,action:"goldHit",tool,angle:p?.angle||0,heldSpecial:p?.heldSpecial||"",targetKind:"gold",targetId:id});this.broadcastFx({kind:"hit",x:g.x,y:g.y,text:"",color:g.pure?"#fff19a":"#ffd23f"});let take=0,tiny=false;if(tool==="Fist"){const key=`${client.sessionId}:${id}`;let c=(this.goldHandCredits.get(key)||0)+.12;if(c>=1){take=1;c-=1;}else tiny=true;this.goldHandCredits.set(key,c);}else take=g.pure?3:g.size==="huge"?randi(2,4):1;if(!g.infinite)take=Math.min(take,Math.max(0,g.goldLeft));if(take>0){if(!g.infinite)g.goldLeft=Math.max(0,g.goldLeft-take);take=Math.max(1,Math.round(take*this.runPerks(client.sessionId).gatherMul));const p=this.state.players.get(client.sessionId);if(p)p.gold=Math.max(0,Math.floor((Number(p.gold)||0)+take));client.send("resourceReward",{id,kind:"gold",amount:take,pure:!!g.pure,balance:p?p.gold:undefined});}else client.send("resourceReward",{id,kind:"gold",amount:0,tiny});}

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

  hitWild(id,a,dmg,attackerId,crit=false,attackerRef=null){
    if(!a||a.hp<=0)return;
    dmg=animalDamageTaken(a.type,a.stage,dmg);
    const ref=attackerRef||{kind:"player",id:attackerId};
    if(ref.kind==="pet"&&ref.id)this.markPetXpContribution("animal",id,ref.id,dmg);
    if(ref.kind==="player"&&attackerId)this.addSkillXp(attackerId,1);
    a.hp=Math.max(0,a.hp-dmg);a.flash=.12;a.recentHit=4.2;a.sleeping=false;a.enraged=true;a.combat=8;this.broadcastEntityHealth("animal",id,a);
    const guardOwner=this.enemyOwnerByPet.get(id);
    if(guardOwner){a.fleeUntil=0;a.tameFailedAggro=true;this.animalFleeFrom.delete(id);this.animalAggro.set(id,ref);}
    else this.setWildReactionToAttacker(id,a,ref);
    this.broadcastFx({kind:"hit",x:a.x,y:a.y,text:(crit?"CRIT ":"")+Math.round(dmg),color:crit?"#ffe08a":"#f2836a"});
    if(a.hp<=0){if(guardOwner){this.enemyOwnerByPet.delete(id);if(this.enemyPetByEnemy.get(guardOwner)===id)this.enemyPetByEnemy.delete(guardOwner);const owner=this.state.enemies.get(guardOwner);if(owner){owner.guardPetId="";owner.ridingPetId="";owner.hasGuard=false;}}for(const[petId,focus]of Array.from(this.petFocusTargets.entries())){if(focus&&focus.kind==="animal"&&focus.id===id){this.petFocusTargets.delete(petId);this.petHuntState.delete(petId);this.petFollowState.delete(petId);this.petChaseState.delete(petId);const pet=this.state.pets.get(petId);if(pet){pet.orderMode="follow";pet.targetX=-1;pet.targetY=-1;}}}this.awardPetXpContributors("animal",id,a,ref.kind==="pet"?ref.id:"");this.maybeRewardWildMaterial(attackerId,a);this.broadcastSpectateKill("animal",id,ref.kind,ref.id);this.state.animals.delete(id);this.animalAggro.delete(id);this.animalFleeFrom.delete(id);this.rewardKill(attackerId,"animal",a.x,a.y,a.type);}
  }
  hitEnemy(id,en,dmg,attackerId,crit=false,attackerRef=null){
    if(!en||en.hp<=0)return;
    const ref=attackerRef||{kind:"player",id:attackerId};
    if(ref.kind==="pet"&&ref.id)this.markPetXpContribution("enemy",id,ref.id,dmg);
    if(ref.kind==="player"&&attackerId)this.addSkillXp(attackerId,1);
    en.hp=Math.max(0,en.hp-dmg);en.flash=.12;this.broadcastEntityHealth("enemy",id,en);this.enemyAggro.set(id,ref.kind==="pet"?{kind:"pet",id:ref.id}:{kind:"player",id:attackerId});
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

  handleAttack(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead||(Number(p._abilityStunUntil)||0)>this.state.worldTime)return;const now=this.state.worldTime,next=this.playerAttackCd.get(client.sessionId)||0;if(now<next)return;const tool=this.validTool(String(data.tool||p.tool||"Fist")),t=this.specializedToolStats(client.sessionId,tool,data.tier),runDmg=this.runPerks(client.sessionId).damageMul*((Number(p._abilityWeakUntil)||0)>this.state.worldTime?(Number(p._abilityWeakMul)||.68):1),splitDouble=tool==="Axe"&&String(this.skillState(client.sessionId).weaponChoice||"")==="doubleAxe";if(tool==="Axe"&&t.throwing)return this.handleThrowAxe(client,data);this.playerAttackCd.set(client.sessionId,now+(t.cadence||.3));this.consumeHydration(client.sessionId,.9);const angle=Number.isFinite(+data.angle)?+data.angle:p.angle;p.angle=angle;this.broadcast("playerAction",{playerId:client.sessionId,action:"attack",tool,angle,heldSpecial:p.heldSpecial||"",weaponChoice:String(this.skillState(client.sessionId).weaponChoice||"")});this.mountedPetAttack(client.sessionId,p);
    // PvP is at most 11 targets, so keep it direct.
    for(const [pid,target] of this.state.players){if(pid===client.sessionId||target.dead)continue;if(dist(p.x,p.y,target.x,target.y)<t.range+PLAYER_R&&facing(p.x,p.y,angle,target.x,target.y,.95)){const crit=Math.random()<.12,dmg=t.dmg*runDmg*(t.doubleHit&&!splitDouble?2:1)*(crit?2:1);const hit=()=>{const q=this.state.players.get(pid);if(q&&!q.dead){this.damageTarget({kind:"player",id:pid},dmg,"player",client.sessionId);this.broadcastFx({kind:"hit",x:q.x,y:q.y-8,text:(crit?"CRIT ":"")+Math.round(dmg),color:crit?"#ffe08a":"#f2836a"});}};if(splitDouble){setTimeout(hit,220);setTimeout(hit,385);}else hit();}}

    // Creature/enemy melee now queries only nearby dynamic buckets instead of
    // scanning every animal and enemy in the 14,400 x 14,400 world per swing.
    const attackKinds=new Set(["enemy","animal"]),nearby=this.nearbyDynamic(p.x,p.y,t.range+165,attackKinds);
    for(const rec of nearby){if(rec.kind!=="enemy")continue;const en=rec.obj;if(en&&dist(p.x,p.y,en.x,en.y)<t.range+en.r&&facing(p.x,p.y,angle,en.x,en.y,.9)){const crit=Math.random()<.15,dmg=t.dmg*runDmg*(t.doubleHit&&!splitDouble?2:1)*(crit?2:1);const eid=rec.id,hit=()=>{const q=this.state.enemies.get(eid);if(q&&q.hp>0)this.hitEnemy(eid,q,dmg,client.sessionId,crit);};if(splitDouble){setTimeout(hit,220);setTimeout(hit,385);}else hit();}}

    // If the client identified the exact animal under this swing, validate it
    // server-side and hit it whether it is asleep or awake.
    const aimedId=String(data.animalId||"");let aimedHit=false;
    if(aimedId){const a=this.state.animals.get(aimedId);if(a&&animalMeleeTouch(a,p.x,p.y,t.range+10,angle,1.18)){const crit=Math.random()<.12,dmg=t.dmg*runDmg*(t.doubleHit&&!splitDouble?2:1)*(crit?2:1);const hit=()=>{const q=this.state.animals.get(aimedId);if(q&&q.hp>0)this.hitWild(aimedId,q,dmg,client.sessionId,crit);};if(splitDouble){setTimeout(hit,220);setTimeout(hit,385);}else hit();aimedHit=true;}}
    for(const rec of nearby){if(rec.kind!=="animal"||(aimedHit&&rec.id===aimedId))continue;const a=rec.obj;if(a&&animalMeleeTouch(a,p.x,p.y,t.range,angle,1.05)){const crit=Math.random()<.12,dmg=t.dmg*runDmg*(t.doubleHit&&!splitDouble?2:1)*(crit?2:1);const rid=rec.id,hit=()=>{const q=this.state.animals.get(rid);if(q&&q.hp>0)this.hitWild(rid,q,dmg,client.sessionId,crit);};if(splitDouble){setTimeout(hit,220);setTimeout(hit,385);}else hit();}}

    let wallBest=null,wallBestD=Infinity;for(const [wid,w] of this.state.walls){if(w.hp<=0)continue;const d=dist(p.x,p.y,w.x,w.y);if(d<t.range+w.r+4&&facing(p.x,p.y,angle,w.x,w.y,1.12)&&d<wallBestD){wallBest={wid,w};wallBestD=d;}}if(wallBest){const wd=wallDamageForTool(tool,wallBest.w);wallBest.w.hp=Math.max(0,wallBest.w.hp-wd);this.broadcastEntityHealth("wall",wallBest.wid,wallBest.w);this.broadcastFx({kind:"hit",x:wallBest.w.x,y:wallBest.w.y,text:Math.round(wd),color:wallBest.w.kind==="stoneSpike"?"#d9e0e6":"#c99a5b"});if(wallBest.w.kind==="stoneSpike")client.send("worldReward",{kind:"resource",resource:"stone",amount:1,x:wallBest.w.x,y:wallBest.w.y});if(wallBest.w.hp<=0){this.state.walls.delete(wallBest.wid);this.hostileWildWalls.delete(wallBest.wid);}}

    let best=null,bestD=Infinity;for(const [id,c] of this.state.chests){if(c.opened)continue;const d=dist(p.x,p.y,c.x,c.y+8);if(d<t.range+c.r+8&&facing(p.x,p.y,angle,c.x,c.y+8,1.15)&&d<bestD){best={id,c};bestD=d;}}if(best)this.hitChest(client,best.id,best.c);
  }
  hitChest(client,id,c){if(!c||c.opened)return;this.addSkillXp(client.sessionId,1);c.hp=Math.max(0,c.hp-1);c.pulse=1;this.broadcastEntityHealth("chest",id,c);if(c.hp<=0){c.opened=true;this.addSkillXp(client.sessionId,12);const reward=this.chestRewards.get(id)||this.makeChestReward();this.chestRewards.delete(id);const accountId=this.playerAccountIds.get(client.sessionId);if(accountId&&(reward?.kind==="cards"||reward?.kind==="goldCubits")){Promise.resolve(HOSTL_ACCOUNT_HOOKS.grantWorldReward(String(accountId),reward,{chest:true,id})).then(result=>{if(result?.granted)client.send("chestReward",{id,reward,account:result.account||null,serverVerified:true});}).catch(()=>{});}else client.send("chestReward",{id,reward});this.broadcastFx({kind:"chest",x:c.x,y:c.y});}else{const first=c.chipSide||"wood",second=first==="wood"?"stone":"wood",bonus=Math.random()<.45;c.chipSide=second;client.send("worldReward",{kind:"resource",resource:first,amount:1,x:c.x,y:c.y});if(bonus)client.send("worldReward",{kind:"resource",resource:second,amount:1,x:c.x,y:c.y});}}
  makeChestReward(){const roll=Math.random();if(roll<.34)return{kind:"goldCubits",amount:Math.random()<.1?randi(12,18):randi(5,10)};if(roll<.52)return{kind:"cards",species:weighted(WILD_SPECIES.map(v=>({v,w:RARITY_CARD_WEIGHT[animalRarity(v)]||1}))),amount:Math.random()<.14?25:10};const res=weighted([{v:"wood",w:2.8},{v:"stone",w:2.3},{v:"berries",w:1.8},{v:"gold",w:1.1}]);const amount=res==="wood"?randi(16,28):res==="stone"?randi(12,22):res==="berries"?randi(6,12):randi(3,6);return{kind:"resource",resource:res,amount};}

  handleThrowAxe(client,data={}){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const s=this.skillState(client.sessionId);if(s.weaponChoice!=="throwingAxe")return;for(const[,q]of this.state.projectiles){if(q&&q.kind==="throwAxe"&&q.ownerId===client.sessionId)return;}const now=this.state.worldTime,next=this.playerAttackCd.get(client.sessionId)||0;if(now<next)return;const tier=clamp(Math.floor(Number(data.tier)||0),0,2),st=this.specializedToolStats(client.sessionId,"Axe",tier);this.playerAttackCd.set(client.sessionId,now+(st.cadence||.72));this.consumeHydration(client.sessionId,.9);const a=Number.isFinite(+data.angle)?+data.angle:p.angle;p.angle=a;this.broadcast("playerAction",{playerId:client.sessionId,action:"attack",tool:"Axe",angle:a,heldSpecial:"",throwing:true,weaponChoice:"throwingAxe",toolTier:tier});this.mountedPetAttack(client.sessionId,p);this.addProjectile({x:p.x+Math.cos(a)*28,y:p.y+Math.sin(a)*28,vx:Math.cos(a)*THROW_AXE_SPEED,vy:Math.sin(a)*THROW_AXE_SPEED,life:THROW_AXE_LIFE,r:9,hostile:false,kind:"throwAxe",color:"#c7b77b",dmg:st.dmg*this.runPerks(client.sessionId).damageMul,ownerId:client.sessionId,petBlast:false,knock:0,returning:false,toolTier:tier});}
  handleBiomeFood(client,data={}){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const food=String(data.food||"");const inv=this.playerBiomeMaterials?.get(client.sessionId)||{};if(food==="jungleBerry"){if((inv.jungleBerry||0)<1)return;inv.jungleBerry--;p._jungleHotUntil=this.state.worldTime+8;p._jungleHotRate=4;client.send("biomeFoodResult",{food,count:inv.jungleBerry,health:p.health,hydration:p.hydration,message:"Jungle Fruit — healing over time"});}else if(food==="frostBerry"){if((inv.frostBerry||0)<1)return;inv.frostBerry--;p.health=Math.min(p.maxHealth,p.health+14);p.hydration=clamp((Number(p.hydration)||0)+18,0,100);client.send("biomeFoodResult",{food,count:inv.frostBerry,health:p.health,hydration:p.hydration,message:"Frost Berry — +14 HP, +18 hydration"});}else if(food==="goodCactus"){if((inv.goodCactus||0)<1)return;inv.goodCactus--;p._cactusGoodUntil=this.state.worldTime+10;p._cactusHealRate=2.6;p._cactusHydrateRate=3.8;client.send("biomeFoodResult",{food,count:inv.goodCactus,health:p.health,hydration:p.hydration,message:"This cactus was good — healing and hydrating over time"});}else if(food==="badCactus"){if((inv.badCactus||0)<1)return;inv.badCactus--;p.health=Math.max(0,p.health-8);p.hydration=clamp((Number(p.hydration)||0)-14,0,100);if(p.health<=0)this.damageTarget({kind:"player",id:client.sessionId},999,"world","");p._badCactusUntil=this.state.worldTime+7;p._badCactusDamageRate=2.5;p._badCactusHydrateRate=4.5;client.send("biomeFoodResult",{food,count:inv.badCactus,health:p.health,hydration:p.hydration,message:"This cactus was bad — it hurts and dehydrates you"});}else if(food==="stoneFruit"){if((inv.stoneFruit||0)<1)return;inv.stoneFruit--;p.hydration=clamp((Number(p.hydration)||0)-20,0,100);p._stoneFruitUntil=this.state.worldTime+20;client.send("biomeFoodResult",{food,count:inv.stoneFruit,health:p.health,hydration:p.hydration,message:"Stone Fruit — +20% strength for 20s, -20 hydration"});}else if(food==="honey"){if((inv.honey||0)<1)return;inv.honey--;p.health=Math.min(p.maxHealth,p.health+20);p.hydration=clamp((Number(p.hydration)||0)+12,0,100);p._honeyRushUntil=this.state.worldTime+12;p._honeyHealRate=4.6;p._honeyHasteMul=1.2;client.send("biomeFoodResult",{food,count:inv.honey,health:p.health,hydration:p.hydration,message:"Honey — +20 HP, sweet healing and a speed boost"});}this.playerBiomeMaterials.set(client.sessionId,inv);}
  handleShoot(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead||(Number(p._abilityStunUntil)||0)>this.state.worldTime)return;const now=this.state.worldTime,next=this.playerShootCd.get(client.sessionId)||0;if(now<next)return;this.playerShootCd.set(client.sessionId,now+.45);const a=Number.isFinite(+data.angle)?+data.angle:p.angle;p.angle=a;this.broadcast("playerAction",{playerId:client.sessionId,action:"shoot",tool:"Bow",angle:a,heldSpecial:""});this.mountedPetAttack(client.sessionId,p);this.addProjectile({x:p.x+Math.cos(a)*26,y:p.y+Math.sin(a)*26,vx:Math.cos(a)*640,vy:Math.sin(a)*640,life:1.15,r:5,hostile:false,kind:"arrow",color:"#7ec0ee",dmg:this.toolStats("Bow",data.tier).dmg*this.runPerks(client.sessionId).damageMul*((Number(p._abilityWeakUntil)||0)>this.state.worldTime?(Number(p._abilityWeakMul)||.68):1),ownerId:client.sessionId,petBlast:false,knock:0});}

  skillState(ownerId){
    let s=this.playerSkillProgress.get(ownerId);
    if(!s){s={level:0,xp:0,speed:0,strength:0,defense:0,stoneChoice:"",weaponChoice:"",milestones:{}};this.playerSkillProgress.set(ownerId,s);}
    if(typeof s.weaponChoice!=="string")s.weaponChoice="";
    return s;
  }
  pendingSkillMilestone(s){
    const level=Math.max(0,Math.floor(Number(s?.level)||0));
    if(!s.milestones||typeof s.milestones!=="object")s.milestones={};
    for(let m=1;m<=level;m++){
      if(m===1){if(!s.stoneChoice)return 1;continue;}
      if(m===6&&(s.stoneChoice==="stoneSword"||s.stoneChoice==="stoneAxe")){if(!s.weaponChoice)return 6;continue;}
      if(!s.milestones[m])return m;
    }
    return 0;
  }
  skillSnapshot(ownerId){
    const s=this.skillState(ownerId),pending=this.pendingSkillMilestone(s),p=this.state.players.get(ownerId);
    if(p){p.skillLevel=s.level;p.skillXp=s.xp;p.skillSpeed=s.speed;p.skillStrength=s.strength;p.skillDefense=s.defense;p.skillPendingMilestone=pending;}
    return {level:s.level,xp:s.xp,next:skillXpNeededForLevel(s.level),speed:s.speed,strength:s.strength,defense:s.defense,stoneChoice:String(s.stoneChoice||""),weaponChoice:String(s.weaponChoice||""),pendingStoneChoice:s.level>=1&&!s.stoneChoice,pendingWeaponChoice:s.level>=6&&(s.stoneChoice==="stoneSword"||s.stoneChoice==="stoneAxe")&&!s.weaponChoice,pendingMilestone:pending,milestones:{...s.milestones}};
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
      if(s.stoneChoice||!["stoneWall","stoneSword","stoneAxe"].includes(choice)){this.sendSkillState(client.sessionId);return;}
      s.stoneChoice=choice;this.sendSkillState(client.sessionId);return;
    }
    if(milestone===6&&(s.stoneChoice==="stoneSword"||s.stoneChoice==="stoneAxe")){
      const valid=s.stoneChoice==="stoneSword"?["daggers","longSword","spear"]:["doubleAxe","throwingAxe","battleAxe"];
      if(s.weaponChoice||!valid.includes(choice)){this.sendSkillState(client.sessionId);return;}
      s.weaponChoice=choice;this.sendSkillState(client.sessionId);return;
    }
    if(isSkillStatMilestone(milestone)){
      if(!["speed","strength","defense"].includes(choice)){this.sendSkillState(client.sessionId);return;}
      s.milestones[milestone]=choice;s[choice]=Math.max(0,Math.floor(Number(s[choice])||0))+1;this.sendSkillState(client.sessionId);return;
    }
    if(!toolSkillAllowedChoices(s,milestone).has(choice)){this.sendSkillState(client.sessionId);return;}
    s.milestones[milestone]=choice;this.sendSkillState(client.sessionId);
  }

  runShopState(ownerId){
    let s=this.playerRunShop.get(ownerId);
    if(!s){s={purchased:new Set(),hat:"",cape:"",armor:""};this.playerRunShop.set(ownerId,s);}
    return s;
  }
  runPerks(ownerId){
    const s=this.runShopState(ownerId),skill=this.skillState(ownerId),p=this.state.players.get(ownerId);
    const stoneFruitMul=p&&(Number(p._stoneFruitUntil)||0)>this.state.worldTime?1.20:1;const honeyMoveMul=p&&(Number(p._honeyRushUntil)||0)>this.state.worldTime?(Number(p._honeyHasteMul)||1.2):1;
    return {
      gatherMul:s.hat==="minerHat"?1.25:1,
      regen:s.hat==="healerHood"?.7:0,
      moveMul:(1+Math.max(0,skill.speed||0)*.08)*honeyMoveMul,
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
  tameChanceFor(ownerId,type){const held=String(this.state.players.get(ownerId)?.heldSpecial||"");const combBonus=held==="HoneyComb" ? .22 : 0;return clamp((TAME_BASE_CHANCE[type]??.38)+this.runPerks(ownerId).tameBonus+combBonus,.08,.95);}
  handleTame(client,data){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;
    if(this.tamePendingPlayers.has(client.sessionId)){client.send("tameResult",{pending:true,reason:"busy"});return;}
    const id=String(data.id||""),a=this.state.animals.get(id);
    if(!a||a.stage!=="baby"||!a.sleeping||dist(p.x,p.y,a.x,a.y)>78)return;
    let count=0;for(const[,pet]of this.state.pets)if(pet.ownerId===client.sessionId&&!pet.dead&&!pet.bredChild)count++;
    if(count>=4){client.send("tameResult",{success:false,reason:"max"});return;}
    const chance=this.tameChanceFor(client.sessionId,a.type);
    this.tamePendingPlayers.add(client.sessionId);
    client.send("tameResult",{pending:true,type:a.type,chance});
    this.clock.setTimeout(()=>{
      this.tamePendingPlayers.delete(client.sessionId);
      const current=this.state.animals.get(id),owner=this.state.players.get(client.sessionId);
      if(!current||!owner||current.stage!=="baby"||dist(owner.x,owner.y,current.x,current.y)>100){client.send("tameResult",{success:false,reason:"moved",type:a.type});return;}
      if(Math.random()<chance){
        this.state.animals.delete(id);this.animalAggro.delete(id);this.animalFleeFrom.delete(id);
        const petId=this.addPet(client.sessionId,current.type,current.stage,current.x,current.y,{hp:current.maxHp,coat:current.coat,spotCol:current.spotCol,spotsJson:current.spotsJson,petName:current.type,gender:current.gender});
        client.send("tameResult",{success:true,type:current.type,petId,chance});
        this.addSkillXp(client.sessionId,25);
        this.sendReward(client.sessionId,{kind:"cards",species:current.type,amount:1},{x:current.x,y:current.y,tame:true});
        this.recordAccountAchievement(client.sessionId,"first_tame",{species:current.type});this.recordAccountAchievement(client.sessionId,`tame_${current.type}`,{species:current.type});
      }else{
        current.sleeping=false;current.enraged=true;current.tameFailedAggro=true;current.desperateAggro=false;current.fleeUntil=0;current.combat=9999;
        this.animalAggro.set(id,{kind:"player",id:client.sessionId});
        client.send("tameResult",{success:false,type:current.type,chance});
      }
    },600);
  }

  handleBuild(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const kind=String(data.kind||"");const angle=Number.isFinite(+data.angle)?+data.angle:p.angle;if(kind==="wall"){const tier=clamp(Math.floor(Number(data.wallTier)||0),0,2),hp=tier>=2?190:tier>=1?125:72,wkind=tier>=2?"iron":tier>=1?"stone":"wood";this.addWall(p.x+Math.cos(angle)*48,p.y+Math.sin(angle)*48,20,-1,client.sessionId,{hp,kind:wkind});}else if(kind==="tower")this.addTower(p.x+Math.cos(angle)*55,p.y+Math.sin(angle)*55,client.sessionId,data.towerTier);}
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
    const now=this.state.worldTime,groups=[this.state.players,this.state.pets,this.state.animals,this.state.enemies];
    for(const group of groups)for(const[,o]of group){if(!o)continue;if(o._abilitySlowUntil&&now>=o._abilitySlowUntil){if(Number.isFinite(Number(o._abilityBaseSpeed)))o.speed=o._abilityBaseSpeed;delete o._abilityBaseSpeed;delete o._abilitySlowUntil;delete o._abilitySlowMul;}if(o._abilityWeakUntil&&now>=o._abilityWeakUntil){if(Number.isFinite(Number(o._abilityBaseDmg)))o.dmg=o._abilityBaseDmg;delete o._abilityBaseDmg;delete o._abilityWeakUntil;delete o._abilityWeakMul;}}
    for(const[key,dot]of Array.from(this.abilityDots.entries())){dot.time-=dt;dot.tick-=dt;if(dot.time<=0||!this.abilityStatusAlive(dot.ref)){this.abilityDots.delete(key);continue;}if(dot.tick<=0){dot.tick+=1;const o=this.targetObject(dot.ref);if(!o){this.abilityDots.delete(key);continue;}if(dot.sourceAnimalId)this.damageTarget(dot.ref,dot.dps,"animal",dot.sourceAnimalId);else if(dot.ref.kind==="enemy")this.hitEnemy(dot.ref.id,o,dot.dps,dot.ownerId,false,{kind:"pet",id:dot.sourcePetId});else if(dot.ref.kind==="animal")this.hitWild(dot.ref.id,o,dot.dps,dot.ownerId,false,{kind:"pet",id:dot.sourcePetId});else this.damageTarget(dot.ref,dot.dps,"pet",dot.sourcePetId);}}
  }
  petAbilityTarget(ownerId,petId,p,range=520){const focus=this.petFocusTargets.get(petId);if(focus&&this.abilityStatusAlive(focus)){const o=this.targetObject(focus),d=dist(p.x,p.y,o.x,o.y);if(d<=range)return{ref:focus,obj:o,d};}let best=null,bestD=range;for(const[id,en]of this.state.enemies){if(en.dead)continue;const d=dist(p.x,p.y,en.x,en.y);if(d<bestD){best={ref:{kind:"enemy",id},obj:en,d};bestD=d;}}for(const[id,a]of this.state.animals){if(a.dead||a.hp<=0)continue;const d=dist(p.x,p.y,a.x,a.y);if(d<bestD){best={ref:{kind:"animal",id},obj:a,d};bestD=d;}}for(const[id,pl]of this.state.players){if(id===ownerId||pl.dead)continue;const d=dist(p.x,p.y,pl.x,pl.y);if(d<bestD){best={ref:{kind:"player",id},obj:pl,d};bestD=d;}}for(const[id,q]of this.state.pets){if(q.dead||q.ownerId===ownerId)continue;const d=dist(p.x,p.y,q.x,q.y);if(d<bestD){best={ref:{kind:"pet",id},obj:q,d};bestD=d;}}return best;}
  petAbilityDamage(ref,raw,ownerId,petId){const o=this.targetObject(ref);if(!o)return false;if(ref.kind==="enemy"){this.hitEnemy(ref.id,o,raw,ownerId,false,{kind:"pet",id:petId});return true;}if(ref.kind==="animal"){this.hitWild(ref.id,o,raw,ownerId,false,{kind:"pet",id:petId});return true;}return this.damageTarget(ref,raw,"pet",petId);}
  petAbilityArea(ownerId,petId,p,x,y,range,damage,opts={}){const refs=[];for(const[id,en]of this.state.enemies)if(!en.dead&&dist(x,y,en.x,en.y)<=range+(en.r||16)*.25)refs.push({ref:{kind:"enemy",id},obj:en});for(const[id,a]of this.state.animals)if(!a.dead&&a.hp>0&&dist(x,y,a.x,a.y)<=range+(a.r||18)*.25)refs.push({ref:{kind:"animal",id},obj:a});for(const[id,pl]of this.state.players)if(id!==ownerId&&!pl.dead&&dist(x,y,pl.x,pl.y)<=range+PLAYER_R*.25)refs.push({ref:{kind:"player",id},obj:pl});for(const[id,q]of this.state.pets)if(q.ownerId!==ownerId&&!q.dead&&dist(x,y,q.x,q.y)<=range+(q.r||18)*.25)refs.push({ref:{kind:"pet",id},obj:q});for(const h of refs){this.petAbilityDamage(h.ref,damage,ownerId,petId);if(opts.stun)this.applyAbilityStun(h.ref,opts.stun);if(opts.slowWeak)this.applyAbilitySlowWeak(h.ref,opts.slowWeak,opts.slowMul||.55,opts.weakMul||.68);if((opts.knock||opts.pull)&&this.abilityStatusAlive(h.ref)){const pulling=!!opts.pull,q=pulling?angTo(h.obj.x,h.obj.y,x,y):angTo(x,y,h.obj.x,h.obj.y),force=pulling?opts.pull:opts.knock,mul=(h.ref.kind==="animal"||h.ref.kind==="pet")?animalKnockbackScale(h.obj):1;h.obj.x=clamp(h.obj.x+Math.cos(q)*force*mul,20,WORLD_W-20);h.obj.y=clamp(h.obj.y+Math.sin(q)*force*mul,20,WORLD_H-20);if(h.ref.kind==="player")this.resolveStatic(h.obj,PLAYER_R*.82);else if(h.ref.kind==="animal"||h.ref.kind==="pet")this.resolveStatic(h.obj,(h.obj.r||18)*.68);}}return refs;}
  healPetTeam(ownerId,amount){const heal=Math.max(0,Number(amount)||0),owner=this.state.players.get(ownerId);if(owner&&!owner.dead)owner.health=clamp(owner.health+heal,0,owner.maxHealth);for(const[,q]of this.state.pets)if(q.ownerId===ownerId&&!q.dead)q.hp=clamp(q.hp+heal,0,q.maxHp);}

  handlePetAbility(client,data,inherited=false){
    const id=String(data?.id||""),p=this.ownedPet(client,id);if(!p||p.dead||(!inherited&&p.abilityCd>0)||(!inherited&&p.bredChild&&!this.isOlderSiblingLeaderPet(id,p)))return;
    const info=PET_TYPES[p.type],ownerId=client.sessionId,owner=this.state.players.get(ownerId),stats=petAbilityStats(p);p.abilityCd=inherited?0:info.abilityCd;
    const angle=Number.isFinite(p.angle)?p.angle:(owner?.angle||0),elem=info.elem;
    const sendFx=(fxType,extra={})=>this.broadcast("abilityEvent",{petId:id,ownerId,elem,x:p.x,y:p.y,r:p.r,stage:p.stage,fxType,...extra,inherited});
    this.petDamageResourcesAround(ownerId,p,p.x,p.y,p.r+42,true);

    if(p.type==="clouded"){
      const dmg=stats.damage||5,t=this.petAbilityTarget(ownerId,id,p,650),ps=petProjectileStageSize(p.stage),pid=this.addProjectile({x:p.x+Math.cos(angle)*(p.r+12),y:p.y+Math.sin(angle)*(p.r+12),vx:Math.cos(angle)*300,vy:Math.sin(angle)*300,life:2.8,r:19*ps,hostile:false,kind:"tornado",color:"#d9f6ff",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});const q=this.state.projectiles.get(pid);if(q){q._targetRef=t?{kind:t.ref.kind,id:t.ref.id}:null;q._wander=angle;q._wanderSeed=Math.random()*10;}sendFx("owlWave",{angle,range:petAbilityRangeFor(p,80,1.5),life:.45});
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
      const a=angle,blast=stats.blast||5,ring=stats.ring||7,range=petAbilityRangeFor(p,120,2.65),projScale=petProjectileStageSize(p.stage);this.addProjectile({x:p.x+Math.cos(a)*(p.r+6),y:p.y+Math.sin(a)*(p.r+6),vx:Math.cos(a)*430,vy:Math.sin(a)*430,life:1.25,r:8*projScale,hostile:false,kind:"leaf",color:"#5cb85c",dmg:blast,ownerId,petBlast:true,knock:0,sourcePetId:id});this.petAbilityArea(ownerId,id,p,p.x,p.y,range,ring,{});this.healPetTeam(ownerId,blast*.5);this.petDamageResourcesAround(ownerId,p,p.x,p.y,range,true);sendFx("plantRing",{range,life:7,angle:a});
    }else if(elem==="Wind"){
      const a=angle,dmg=stats.damage||10,projScale=petProjectileStageSize(p.stage);this.addProjectile({x:p.x+Math.cos(a)*(p.r+8),y:p.y+Math.sin(a)*(p.r+8),vx:Math.cos(a)*560,vy:Math.sin(a)*560,life:1.25,r:18*projScale,hostile:false,kind:"owlSound",color:"#bdeaff",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});sendFx("owlWave",{angle:a,range:petAbilityRangeFor(p,100,2.2),life:.65});
    }else if(elem==="Poison"){
      const a=angle,dmg=stats.damage||5,projScale=petProjectileStageSize(p.stage);this.addProjectile({x:p.x+Math.cos(a)*(p.r+7),y:p.y+Math.sin(a)*(p.r+7),vx:Math.cos(a)*500,vy:Math.sin(a)*500,life:1.3,r:9*projScale,hostile:false,kind:"poison",color:"#65cc65",dmg,ownerId,petBlast:true,knock:0,sourcePetId:id});sendFx("poisonMuzzle",{angle:a,life:.5});
    }else if(elem==="Light"){
      const range=petAbilityRangeFor(p,155,3.15),dmg=stats.damage||16;this.petAbilityArea(ownerId,id,p,p.x,p.y,range,dmg,{});this.healPetTeam(ownerId,dmg*.5);this.petDamageResourcesAround(ownerId,p,p.x,p.y,range,true);sendFx("lightRingBurst",{range,life:7});
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

  setWildReactionToAttacker(id,a,ref){
    if(!a||!ref)return;
    const target=this.targetObject(ref);
    const info=PET_TYPES[a.type]||{};
    if(this.isNeutralBeeType(a.type)||(a.type==="dronebee"&&!this.droneBeeShouldFlee(a))){a.sleeping=false;a.enraged=true;a.desperateAggro=false;a.combat=Math.max(a.combat||0,8);a.fleeUntil=0;this.animalFleeFrom.delete(id);this.animalAggro.set(id,ref);return;}
    if(this.droneBeeShouldFlee(a)){a.sleeping=false;a.enraged=false;a.desperateAggro=false;a.combat=Math.max(a.combat||0,4);this.animalAggro.delete(id);this.animalFleeFrom.set(id,ref);a.fleeUntil=this.state.worldTime+5.5;if(target)a.wanderA=angTo(target.x,target.y,a.x,a.y);return;}
    if(ref.kind==="animal"&&target&&target.type&&!wildCanPreyOn(a.type,target.type)){
      a.sleeping=false;a.enraged=false;a.desperateAggro=false;a.combat=Math.max(a.combat||0,4);
      this.animalAggro.delete(id);this.animalFleeFrom.set(id,ref);a.fleeUntil=this.state.worldTime+4;
      a.wanderA=angTo(target.x,target.y,a.x,a.y);return;
    }
    const shouldFleeFirst=a.stage==="baby"||!!info.flee;
    const lowHealthFight=shouldFleeFirst&&a.hp>0&&a.maxHp>0&&a.hp/a.maxHp<=.32;
    a.sleeping=false;a.enraged=true;a.combat=Math.max(a.combat||0,8);
    if(lowHealthFight){
      a.desperateAggro=true;a.fleeUntil=0;this.animalFleeFrom.delete(id);this.animalAggro.set(id,ref);
    }else if(shouldFleeFirst&&!a.tameFailedAggro&&!a.desperateAggro){
      this.animalAggro.delete(id);this.animalFleeFrom.set(id,ref);a.fleeUntil=this.state.worldTime+4;
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
    if(!["clouded","fennec","camel","scorpion","hyena","caracal","polarbear","arcticfox","walrus"].includes(a.type))this.broadcast("abilityEvent",{petId:"",ownerId:"",elem,x:a.x,y:a.y,r:a.r,wildAnimalId:id});
    const d=dist(a.x,a.y,target.x,target.y);
    // New biome wildlife keeps the same species-specific move it uses after taming.
    if(a.type==="clouded"){
      const dmg=petAbilityStats(a).damage||10,ang=Number.isFinite(a.angle)?a.angle:angTo(a.x,a.y,target.x,target.y),pid=this.addProjectile({x:a.x+Math.cos(ang)*(a.r+12),y:a.y+Math.sin(ang)*(a.r+12),vx:Math.cos(ang)*330,vy:Math.sin(ang)*330,life:2.8,r:Math.max(16,18*petProjectileStageSize(a.stage)),hostile:true,kind:"tornado",color:"#d9f6ff",dmg,ownerId:id,petBlast:false,knock:0,sourcePetId:""});const q=this.state.projectiles.get(pid);if(q){q._targetRef={kind:ref.kind,id:ref.id};q._sourceAnimalId=id;q._wander=ang;q._wanderSeed=Math.random()*TAU;}this.broadcastFx({kind:"ability",x:a.x,y:a.y,text:"TORNADO TRAP",color:"#d9f6ff"});
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
    else if(a.type==="workerbee"){const st=petAbilityStats(a),dmg=st.damage||14,dot=st.dot||10;if(d<185){const aa=angTo(a.x,a.y,target.x,target.y),dash=Math.min(95,Math.max(24,d-Math.max(8,target.r||PLAYER_R))),ox=a.x,oy=a.y;a.x=clamp(a.x+Math.cos(aa)*dash,20,WORLD_W-20);a.y=clamp(a.y+Math.sin(aa)*dash,20,WORLD_H-20);this.resolveStatic(a,(a.r||18)*.68);if(dist(a.x,a.y,target.x,target.y)<=a.r+(target.r||PLAYER_R)+24){this.damageTarget(ref,dmg,"animal",id);this.applyAbilityFixedDot(ref,dot,5,"","",id);}this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Poison",fxType:"pounce",x:a.x,y:a.y,fromX:ox,fromY:oy,targetX:a.x,targetY:a.y,angle:aa,r:a.r,stage:a.stage,life:.55,shockScale:.3});}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"POISON CHARGE",color:"#90de68"});}
    else if(a.type==="dronebee"){const dmg=petAbilityStats(a).damage||20;if(d<210){const aa=angTo(a.x,a.y,target.x,target.y),dash=Math.min(120,Math.max(40,d-Math.max(10,target.r||PLAYER_R))),ox=a.x,oy=a.y;a.x=clamp(a.x+Math.cos(aa)*dash,20,WORLD_W-20);a.y=clamp(a.y+Math.sin(aa)*dash,20,WORLD_H-20);this.resolveStatic(a,(a.r||18)*.68);if(dist(a.x,a.y,target.x,target.y)<=a.r+(target.r||PLAYER_R)+26)this.damageTarget(ref,dmg,"animal",id);this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:id,elem:"Normal",fxType:"pounce",x:a.x,y:a.y,fromX:ox,fromY:oy,targetX:a.x,targetY:a.y,angle:aa,r:a.r,stage:a.stage,life:.6,shockScale:.42});}this.broadcastFx({kind:"ability",x:target.x,y:target.y,text:"RAM",color:"#f3f3e8"});}
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
    if(!a||a.dead||a.sleeping||a.enraged||(a.combat||0)>0||this.animalAggro.has(id)||!(a.type==="deer"||a.type==="rabbit"))return false;
    if((Number(a._berryCooldownUntil)||0)>this.state.worldTime)return false;
    let bid=String(a._berryTargetId||""),b=bid?this.state.resources.get(bid):null;
    if(!b||!b.alive||b.type!=="bush"||dist(a.x,a.y,b.x,b.y)>430){bid="";b=null;for(const s of this.nearbySolids(a.x,a.y,320+(a.speed||60)*.8)){if(s.kind!=="resource")continue;const q=this.state.resources.get(s.id);if(!q||!q.alive||q.type!=="bush")continue;if(!b||dist(a.x,a.y,q.x,q.y)<dist(a.x,a.y,b.x,b.y)){b=q;bid=s.id;}}a._berryTargetId=bid;}
    if(!b)return false;const d=dist(a.x,a.y,b.x,b.y);if(d>(a.r||18)+(b.solidR||12)+8){smoothTurn(a,angTo(a.x,a.y,b.x,b.y),dt,3.6);this.moveCreatureSwept(a,(a.speed||60)*.48,dt);return true;}
    const bite=Math.max(.25,(b.maxHp||8)*.035);b.hp=Math.max(0,b.hp-bite);a.hp=Math.min(a.maxHp,a.hp+a.maxHp*.06);a._berryCooldownUntil=this.state.worldTime+rand(8,15);a._berryTargetId="";this.broadcastEntityHealth("resource",bid,b);if(b.hp<=0){b.alive=false;this.resourceRespawns.set(bid,rand(12,22));}return true;
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

    // Creature-vs-creature collision can hold bodies just outside the exact
    // head circle. Allow a small face-to-face grace reach so wildlife fights
    // don't stall with both creatures touching but never landing a bite.
    if(preferred&&preferredRef&&(preferredRef.kind==="animal"||preferredRef.kind==="enemy")){
      const tr=this.targetRadius(preferredRef,preferred),reach=Math.max(18,(a.r||18)*.78+tr*.72+10);
      const d=dist(a.x,a.y,preferred.x,preferred.y);
      if(d<=reach){
        const face=angTo(a.x,a.y,preferred.x,preferred.y);
        let diff=face-(a.angle||0);while(diff>Math.PI)diff-=TAU;while(diff<-Math.PI)diff+=TAU;
        if(Math.abs(diff)<.78)return{ref:preferredRef,obj:preferred};
      }
    }
    return null;
  }

  animalAttackCooldown(a){
    return animalAttackCooldown(a.type,a.stage,false);
  }

  wildAttackConnects(a,ref,target){
    if(!a||!ref||!target)return false;
    if(animalAttackContact(a,ref,target))return true;
    // Match offline: saber gets no invisible grace reach.
    if(a.type==="saber")return false;
    const tr=ref.kind==="player"?PLAYER_R:Math.max(10,Number(target.r)||16);
    const reach=Math.max(18,(a.r||18)*.78+tr*.72+10);
    const d=dist(a.x,a.y,target.x,target.y);if(d>reach)return false;
    return Math.abs(angleDiff(a.angle||0,angTo(a.x,a.y,target.x,target.y)))<.78;
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
        const mx=(female.x+male.x)*.5,my=(female.y+male.y)*.5;
        const babyId=this.addAnimal(a.type,"baby",clamp(mx+rand(-18,18),24,WORLD_W-24),clamp(my+rand(-18,18),24,WORLD_H-24),{gender:canonicalAnimalGender(a.type),motherId:a.gender==="Female"?id:mateId,fatherId:a.gender==="Male"?id:mateId,bredChild:true,sleeping:false});
        this.wildLastBreedDay.set(id,this.state.dayCount);this.wildLastBreedDay.set(mateId,this.state.dayCount);
        const baby=this.state.animals.get(babyId);if(baby){this.broadcastFx({kind:"familyBirth",x:baby.x,y:baby.y});this.broadcastFx({kind:"hit",x:baby.x,y:baby.y,text:`Baby ${PET_TYPES[a.type]?.name||a.type}!`,color:"#ffd9e6"});}
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
      if(this.keepWildInHomeBiome(id,a,dt))continue;
      const forcedActive=this.enemyOwnerByPet.has(id)||this.animalAggro.has(id)||this.wildMateTargets.has(id)||a.tameFailedAggro||a.desperateAggro||(a.recentHit||0)>0;
      if(!forcedActive&&!this.hasNearbyPlayerOrPet(a.x,a.y,1650))continue;
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
      if(a.type==="queenbee"&&a.stage==="bigmomma"&&!a.dead){a._broodCd=(Number(a._broodCd)||rand(145,215))-dt;if(a._broodCd<=0){if((a.sleeping||!a.enraged)&&(a.combat||0)<=0)this.spawnQueenBeeBrood(id,a);a._broodCd=rand(160,245);}}

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
      if(!ref&&a.wildFightScan<=0){
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
          a.enraged=false;a.combat=0;a.sleeping=true;a.hp=Math.min(a.maxHp,a.hp+15);
        }

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
              a.sleeping=false;this.animalFleeFrom.set(id,playerRef);a.fleeUntil=Math.max(a.fleeUntil||0,this.state.worldTime+.55);
              const fleeA=angTo(playerObj.x,playerObj.y,a.x,a.y);a.wanderA=fleeA;smoothTurn(a,fleeA,dt,4.5);
              this.moveCreatureSwept(a,(a.speed||60)*1.24,dt);
            }else{
              const neutralBeeCalm=this.isNeutralBeeType(a.type)&&!a.enraged&&!a.tameFailedAggro&&!a.desperateAggro&&!this.animalAggro.has(id);
              const isHostile=!neutralBeeCalm&&(a.enraged||(!isFriendly&&!babyAlwaysFlees)||
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
                  if(Math.random()<beeNapChance(a.type,a.stage,!!a.enraged))a.sleeping=true;
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
      const raw=Math.max(0,Number(dmg)||0);if(raw<=0)return false;
      if(attackerId&&attackerId!==ref.id&&["player","playerProjectile","projectile"].includes(String(attackerKind))&&this.state.players.has(String(attackerId)))this.addSkillXp(String(attackerId),1);
      // While riding, the mount is the rider's body and takes the entire hit first.
      // A killing blow can knock the rider off, but the same hit never spills into
      // rider health; only a later hit can hurt the now-dismounted player.
      if(obj.ridingPetId){
        const mountId=obj.ridingPetId;
        const mount=this.state.pets.get(mountId);
        if(mount&&!mount.dead&&mount.ownerId===ref.id){
          const mountAmount=animalDamageTaken(mount.type,mount.stage,raw)*petUpgradeMultiplier(mount,"defense");
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
        obj.health=0;obj.dead=true;obj.ridingPetId="";this.firstLightReadyPlayers.delete(ref.id);this.playerSurvivalSeconds.set(ref.id,0);this.playerSurvivalAwards.set(ref.id,new Set());this.playerNightSeen.delete(ref.id);this.recordAccountAchievement(ref.id,"first_death",{});this.broadcastSpectateKill("player",ref.id,attackerKind,attackerId);
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
    if(ref.kind==="pet"){if(obj.dead)return false;const amount=animalDamageTaken(obj.type,obj.stage,Math.max(0,Number(dmg)||0))*petUpgradeMultiplier(obj,"defense");if(amount<=0)return false;obj.hp=Math.max(0,obj.hp-amount);obj.flash=.15;obj.combat=6;this.broadcastEntityHealth("pet",ref.id,obj);if(attackerId&&!obj.dead){let threat=null;if(this.state.animals.has(attackerId))threat={kind:"animal",id:attackerId};else if(this.state.enemies.has(attackerId))threat={kind:"enemy",id:attackerId};if(threat&&obj.ownerId)this.ownerThreat.set(obj.ownerId,{...threat,until:this.state.worldTime+7});}if(obj.hp<=0){obj.dead=true;this.broadcastSpectateKill("pet",ref.id,attackerKind,attackerId);this.petDeathTimers.set(ref.id,3);}return true;}
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
      if(obj.hp<=0){obj.dead=true;this.awardPetXpContributors("animal",ref.id,obj,"");if(attackerKind==="animal"&&attackerId&&this.state.animals.has(attackerId))this.giveWildKillExp(attackerId,this.state.animals.get(attackerId),obj);if(attackerKind==="player")this.maybeRewardWildMaterial(attackerId,obj);this.state.animals.delete(ref.id);this.animalAggro.delete(ref.id);this.animalFleeFrom.delete(ref.id);}
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
    const base=kind==="animal"?petKillXpForAnimal(victim):petKillXpForEnemy(victim);
    const total=Math.max(.01,Array.from(map.values()).reduce((a,b)=>a+Math.max(0,Number(b)||0),0));
    for(const[petId,dealt]of map){const pet=this.state.pets.get(petId);if(!pet||pet.dead)continue;const killer=petId===String(killerPetId||"");const share=Math.max(0,Number(dealt)||0)/total;const mul=killer?1:clamp(.55+share*.35,.55,.85);this.givePetExp(petId,pet,Math.max(1,Math.round(base*mul)));}
  }
  giveWildKillExp(id,a,victim){
    if(!a||a.dead||a.hp<=0||!victim)return;
    const need={baby:4,adult:65,boss:210,superboss:560}[a.stage];if(!need)return;
    a.exp=Math.max(0,Number(a.exp)||0)+petKillXpForAnimal(victim);a.level=Math.max(1,Number(a.level)||1)+1;
    if(a.exp<need)return;
    let next={baby:"adult",adult:"boss",boss:"superboss",superboss:"bigmomma"}[a.stage];if(!next)return;
    if(next==="bigmomma"&&Array.from(this.state.animals.values()).filter(q=>q&&q.hp>0&&q.stage==="bigmomma").length>=5){a.exp=Math.min(a.exp,need-1);return;}
    a.exp=Math.max(0,a.exp-need);a.stage=next;a.level=1;a.r=animalRadius(a.type,next);a.maxHp=typeHp(a.type,next);a.hp=a.maxHp;a.speed=animalSpeed(a.type,next,false);a.sleeping=false;a.enraged=false;a._abilityFightKey="";
    this.broadcastFx({kind:"text",x:a.x,y:a.y-(a.r||18)-18,text:`${next.toUpperCase()}!`,color:"#ffe66d"});
  }
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
  petHitResource(ownerId,p,rid,r,ability=false){if(!p||!r||!r.alive)return false;if(r.type==="rainforestHive"){this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:"#d0ad4c"});return true;}const dmg=this.petResourceDamage(p,r,ability);r.hp=Math.max(0,(r.hp||1)-dmg);const key=r.type==="bush"?"berries":(r.type==="rock"?"stone":"wood");const amount=ability?Math.max(1,Math.round(dmg*.25)):1;const c=this.clientById(ownerId);if(c)c.send("resourceReward",{id:rid||"",kind:key,amount});this.broadcastFx({kind:"hit",x:r.x,y:r.y,text:"",color:key==="wood"?"#c99a5b":key==="stone"?"#a9b3bd":"#d1315c"});this.broadcastEntityHealth("resource",rid,r);if(r.hp<=0){r.hp=0;r.alive=false;this.broadcastEntityHealth("resource",rid,r);this.resourceRespawns.set(rid,rand(12,22));}return true;}
  petDamageResourcesAround(ownerId,p,x,y,range,ability=true){for(const s of this.nearbySolids(x,y,range+120)){if(s.kind!=="resource")continue;const r=this.state.resources.get(s.id);if(!r||!r.alive)continue;if(dist(x,y,s.x,s.y)<=range+s.r)this.petHitResource(ownerId,p,s.id,r,ability);}}
  petAttackStuckResource(ownerId,p,opts={}){
    if(!p||p.dead)return false;
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
    if(naturalChaser){const near=this.nearestPlayer(a.x,a.y,chaseRange);if(near){this.animalAggro.set(id,{kind:"player",id:near.id});a.sleeping=false;a.enraged=true;a.combat=Math.max(a.combat||0,5);a._blockingResourceId="";return true;}}
    return false;
  }
  wildAttackBlockingResource(id,a){
    if(!a||a.hp<=0)return false;
    if(this.wildResourceCombatInterrupt(id,a))return false;
    let rid=a._blockingResourceId||"",r=rid?this.state.resources.get(rid):null;
    if(!this.resourceBlocksCreaturePath(a,r)){const found=this.findBlockingResourceForCreature(a);rid=found?.id||"";r=found?.r||null;}
    if(!rid||!r){a._blockingResourceId="";return false;}
    a._blockingResourceId=rid;a.sleeping=false;
    if((a.atkCd||0)>0)return true;
    a.atkCd=animalAttackCooldown(a.type,a.stage,false);a.attackAnim=.22;
    const blockers=this.blockingResourcesForCreature(a,6);if(!blockers.length)blockers.push({id:rid,r});
    for(const b of blockers){if(b.r.type==="rainforestHive"){this.broadcastFx({kind:"hit",x:b.r.x,y:b.r.y,text:"",color:"#d0ad4c"});continue;}const dmg=this.petResourceDamage(a,b.r,false);b.r.hp=Math.max(0,(b.r.hp||1)-dmg);this.broadcastFx({kind:"hit",x:b.r.x,y:b.r.y,text:"",color:b.r.type==="bush"?"#d1315c":(b.r.type==="rock"?"#a9b3bd":"#c99a5b")});this.broadcastEntityHealth("resource",b.id,b.r);if(b.r.hp<=0){b.r.hp=0;b.r.alive=false;this.broadcastEntityHealth("resource",b.id,b.r);this.resourceRespawns.set(b.id,rand(12,22));}}
    if(!r.alive)a._blockingResourceId="";
    return true;
  }
  mountedPetAttack(ownerId,owner){if(!owner?.ridingPetId)return false;const pet=this.state.pets.get(owner.ridingPetId);if(!pet||pet.dead||pet.atkCd>0)return false;let target=this.nearestHostile(pet.x,pet.y,Math.max(70,(pet.r||18)*2.6));if(!target)return false;const face=animalFaceGeometry(pet);const contact=target.kind==="animal"?petAttackContact(pet,{kind:"animal",id:target.id},target.obj):dist(face.x,face.y,target.obj.x,target.obj.y)<=face.r+(target.obj.r||18)+16;if(!contact)return false;const raw=petAtkDmg(pet);pet.atkCd=animalAttackCooldown(pet.type,pet.stage,true);pet.attackAnim=.18;if(target.kind==="enemy")this.hitEnemy(target.id,target.obj,raw,ownerId,false,{kind:"pet",id:owner.ridingPetId});else this.hitWild(target.id,target.obj,raw,ownerId,false,{kind:"pet",id:owner.ridingPetId});return true;}

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
        const d=dist(x,y,w.x,w.y),min=pr+w.r+5;
        if(d<min){const a=d>.01?angTo(w.x,w.y,x,y):(p.angle||0);x=w.x+Math.cos(a)*min;y=w.y+Math.sin(a)*min;}
      }
    }
    return{x:clamp(x,24,WORLD_W-24),y:clamp(y,24,WORLD_H-24)};
  }

  keepWildInHomeBiome(id,a,dt){
    // state.animals also contains Hostl guard/mount animals. Those are pets and
    // must be allowed to follow their owner across biomes without damage.
    if(!a||a.hp<=0||a.owned||this.enemyOwnerByPet.has(id))return false;
    const home=biomeBaseId(a.biome||speciesHomeBiome(a.type));
    const here=biomeBaseId(worldBiomeAt(a.x,a.y));
    if(here===home||here==="ocean"){a._wrongBiomeTime=0;return false;}

    a.sleeping=false;
    a.enraged=false;
    a.tameFailedAggro=false;
    a.desperateAggro=false;
    a.combat=0;
    this.animalAggro.delete(id);
    this.animalFleeFrom.delete(id);
    this.clearWildMate(id);
    a._wrongBiomeTime=(Number(a._wrongBiomeTime)||0)+dt;

    const loss=Math.max(.55,(Number(a.maxHp)||40)*.055)*dt;
    a.hp=Math.max(0,(Number(a.hp)||0)-loss);
    a._biomeDamageFxT=(Number(a._biomeDamageFxT)||0)-dt;
    if(a._biomeDamageFxT<=0){a._biomeDamageFxT=.48;a.flash=Math.max(Number(a.flash)||0,.11);this.broadcastEntityHealth("animal",id,a);}
    if(a.hp<=0){
      a.hp=0;a.dead=true;this.broadcastEntityHealth("animal",id,a);this.clearWildMate(id);
      this.state.animals.delete(id);this.animalAggro.delete(id);this.animalFleeFrom.delete(id);
      return true;
    }

    const zone=BIOME_ZONES[home]||BIOME_ZONES.forest;
    if(!a._homeReturnPoint||biomeBaseId(worldBiomeAt(a._homeReturnPoint.x,a._homeReturnPoint.y))!==home){
      a._homeReturnPoint={x:zone.cx+rand(-220,220),y:zone.cy+rand(-220,220)};
      if(biomeBaseId(worldBiomeAt(a._homeReturnPoint.x,a._homeReturnPoint.y))!==home)a._homeReturnPoint={x:zone.cx,y:zone.cy};
    }
    const homePoint=a._homeReturnPoint;
    const aTo=angTo(a.x,a.y,homePoint.x,homePoint.y);
    smoothTurn(a,aTo,dt,5.4);
    this.moveCreatureSwept(a,(a.speed||60)*1.32,dt);
    this.resolveStatic(a,(a.r||18)*.68);
    return true;
  }

  updatePets(dt){
    for(const[id,p]of this.state.pets){
      if(p.dead)continue;
      const _petAlwaysX=p.x,_petAlwaysY=p.y;
      p.abilityCd=Math.max(0,p.abilityCd-dt);
      p.atkCd=Math.max(0,p.atkCd-dt);
      p.combat=Math.max(0,p.combat-dt);
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
          this.movePetChaseWithRecovery(id,p,target.obj,p.speed*chaseBoost,dt);
        }else{
          p.angle+=((String(id).length&1)?1:-1)*.45*dt;
          this.moveCreatureSwept(p,Math.max(8,(Number(p.speed)||60)*.16),dt);
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
        this.moveCreatureSwept(p,p.speed*.85,dt);
      }else if(p.orderMode==="set"&&p.targetX>=0){
        const d=dist(p.x,p.y,p.targetX,p.targetY);
        if(d>12){
          const a=angTo(p.x,p.y,p.targetX,p.targetY);
          smoothTurn(p,a,dt,4.6);
          this.moveCreatureSwept(p,p.speed*1.3,dt);
        }else{
          p.targetX=-1;p.targetY=-1;p.orderMode="follow";
        }
      }else{
        const followX=owner.x,followY=owner.y;
        const ownerDistance=dist(p.x,p.y,followX,followY);
        const followRange=petFollowRangeFor(p);
        const inputMag=clamp(Math.hypot(owner.moveX||0,owner.moveY||0),0,1);
        let ownerMoveSpeed=148*inputMag*this.hydrationMoveMul(owner.hydration);
        if(owner.ridingPetId){
          const mount=this.state.pets.get(owner.ridingPetId);
          if(mount&&!mount.dead)ownerMoveSpeed=Math.max(24,mount.speed||148)*2.30*inputMag;
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
          let followSpeed=Math.max((Number(p.speed)||60)*1.16,ownerMoveSpeed*1.02+8);
          if(ownerDistance>=followRange.dash)followSpeed=Math.max((Number(p.speed)||60)*2.75,ownerMoveSpeed*1.72+40);
          else if(ownerDistance>=followRange.run)followSpeed=Math.max((Number(p.speed)||60)*1.72,ownerMoveSpeed*1.20+16);
          else if(ownerDistance<followRange.settle+45)followSpeed=Math.max(24,(Number(p.speed)||60)*.72);

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
          const roamSpeed=Math.max(20,(Number(p.speed)||60)*.42);
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
      if(guard&&en.ridingPetId!==gid){const min=en.r+Math.max(18,(guard.r||18)*.72)+12,d=dist(en.x,en.y,guard.x,guard.y);if(d<min&&d>.01){const a=angTo(en.x,en.y,guard.x,guard.y),push=min-d;guard.x+=Math.cos(a)*push;guard.y+=Math.sin(a)*push;this.resolveStatic(guard,(guard.r||18)*.68);}}
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
      for(const[wid,w]of this.state.walls){if(w.hp<=0)continue;consider(segmentCircleT(x0,y0,x1,y1,w.x,w.y,p.r+w.r),"wall",{wid,w});}

      if(best.t<=1){
        p.x=x0+(x1-x0)*best.t;p.y=y0+(y1-y0)*best.t;
        if(best.type==="player")this.damageTarget({kind:"player",id:best.pid},p.dmg,"projectile",p.ownerId);
        else if(best.type==="pet")this.damageTarget({kind:"pet",id:best.petId},p.dmg,"projectile",p.ownerId);
        else if(best.type==="pvp"){this.damageTarget({kind:"player",id:best.pid},p.dmg,"playerProjectile",p.ownerId);this.broadcastFx({kind:"hit",x:best.pl.x,y:best.pl.y-8,text:Math.round(p.dmg),color:"#8fd4ff"});}
        else if(best.type==="enemy"){this.hitEnemy(best.eid,best.en,p.dmg,p.ownerId,false,p.sourcePetId?{kind:"pet",id:p.sourcePetId}:null);if(p.knock&&this.state.enemies.has(best.eid)){const a=Math.atan2(p.vy,p.vx);best.en.x+=Math.cos(a)*p.knock;best.en.y+=Math.sin(a)*p.knock;}}
        else if(best.type==="wild"){
          if(p.hostile){const a=best.a,dmg=animalDamageTaken(a.type,a.stage,p.dmg);a.hp=Math.max(0,a.hp-dmg);a.flash=.12;a.recentHit=4;a.sleeping=false;a.enraged=true;a.combat=8;if(a.hp>0&&this.state.enemies.has(p.ownerId))this.setWildReactionToAttacker(best.aid,a,{kind:"enemy",id:p.ownerId});if(a.hp<=0){this.awardPetXpContributors("animal",best.aid,a,"");this.broadcastSpectateKill("animal",best.aid,"projectile",p.ownerId);this.state.animals.delete(best.aid);this.animalAggro.delete(best.aid);this.animalFleeFrom.delete(best.aid);}}
          else{this.hitWild(best.aid,best.a,p.dmg,p.ownerId,false,p.sourcePetId?{kind:"pet",id:p.sourcePetId}:null);if(p.knock&&this.state.animals.has(best.aid)){const q=Math.atan2(p.vy,p.vx),push=p.knock*animalKnockbackScale(best.a);best.a.x+=Math.cos(q)*push;best.a.y+=Math.sin(q)*push;this.resolveStatic(best.a,(best.a.r||18)*.68);}}
        }
        else if(best.type==="solid"&&p.kind==="throwAxe"&&best.solid?.kind==="resource"){
          const c=this.clientById(p.ownerId),r=this.state.resources.get(best.solid.id);
          if(c&&r&&r.alive)this.handleResourceHit(c,{id:best.solid.id,tool:"Axe",tier:p.toolTier},{projectile:true});
        }
        else if(best.type==="solid"&&p.petBlast&&best.solid?.kind==="resource"&&p.sourcePetId){const pet=this.state.pets.get(p.sourcePetId),r=this.state.resources.get(best.solid.id);if(pet&&r)this.petHitResource(p.ownerId,pet,best.solid.id,r,true);}
        if(p.hostile&&p.kind==="tornado"){
          let ref=null,hit=null;if(best.type==="player"){ref={kind:"player",id:best.pid};hit=best.pl;}else if(best.type==="pet"){ref={kind:"pet",id:best.petId};hit=best.pet;}else if(best.type==="wild"){ref={kind:"animal",id:best.aid};hit=best.a;}
          if(ref&&this.abilityStatusAlive(ref)){this.applyAbilityStun(ref,2.2);this.broadcast("abilityEvent",{petId:"",ownerId:"",wildAnimalId:String(p._sourceAnimalId||""),elem:"Wind",fxType:"tornadoTrap",x:p.x,y:p.y,targetX:hit?.x||p.x,targetY:hit?.y||p.y,r:Math.max(30,(hit?.r||PLAYER_R)+18),life:2.2});}
        }
        if(p.petBlast&&p.sourcePetId&&(p.kind==="owlSound"||p.kind==="poison"||p.kind==="tornado")){
          const source=this.state.pets.get(p.sourcePetId),stats=source?petAbilityStats(source):{};let ref=null;
          if(best.type==="enemy")ref={kind:"enemy",id:best.eid};else if(best.type==="wild")ref={kind:"animal",id:best.aid};else if(best.type==="pvp")ref={kind:"player",id:best.pid};
          if(ref&&this.abilityStatusAlive(ref)){if(p.kind==="owlSound")this.applyAbilityStun(ref,stats.stun||2);else if(p.kind==="tornado"){this.applyAbilityStun(ref,2.2);const hit=this.targetObject(ref);this.broadcast("abilityEvent",{petId:p.sourcePetId,ownerId:p.ownerId,elem:"Wind",fxType:"tornadoTrap",x:p.x,y:p.y,targetX:hit?.x||p.x,targetY:hit?.y||p.y,r:Math.max(30,(hit?.r||PLAYER_R)+18),life:2.2});}else this.applyAbilityPoison(ref,p.dmg,p.ownerId,p.sourcePetId);}
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
      if(w.hp<=0||(w.ttl!==-1&&w.ttl<=0)){this.state.walls.delete(id);this.hostileWildWalls.delete(id);continue;}

      // Hostile cubes can eventually break any wall they are pressing against.
      let breaker=null;
      for(const rec of this.nearbyDynamic(w.x,w.y,w.r+90,wallEnemyKinds)){const en=rec.obj;if(!en||en.dead)continue;if(dist(w.x,w.y,en.x,en.y)<=w.r+en.r+4){breaker={eid:rec.id,en};break;}}
      if(breaker){const key=`${id}:${breaker.eid}`,next=this.wallEnemyNext.get(key)||0;if(now>=next){const wd=Math.max(2.5,(breaker.en.dmg||6)*.7);w.hp=Math.max(0,w.hp-wd);this.wallEnemyNext.set(key,now+.9);this.broadcastFx({kind:"hit",x:w.x,y:w.y,text:Math.round(wd),color:w.kind==="stoneSpike"?"#d9e0e6":"#c99a5b"});if(w.hp<=0){this.state.walls.delete(id);this.hostileWildWalls.delete(id);continue;}}}

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
    for(const[,t]of this.state.towers){
      t.cd-=dt;if(t.cd>0)continue;const tier=clamp(Math.floor(Number(t.tier)||0),0,2),range=tier>=2?380:tier>=1?310:250;let target=null,best=range;
      for(const rec of this.nearbyDynamic(t.x,t.y,range+120,new Set(["enemy","animal"]))){const o=rec.obj;if(!o||o.dead||o.hp<=0)continue;const d=dist(t.x,t.y,o.x,o.y);if(d<best){best=d;target={kind:rec.kind,id:rec.id,obj:o};}}
      for(const[pid,pl]of this.state.players){if(pid===t.ownerId||pl.dead)continue;const d=dist(t.x,t.y,pl.x,pl.y);if(d<best){best=d;target={kind:"player",id:pid,obj:pl};}}
      if(!target)continue;const a=angTo(t.x,t.y,target.obj.x,target.obj.y),dmg=tier>=2?19:tier>=1?14:9,speed=tier>=2?650:tier>=1?570:510;
      this.addProjectile({x:t.x+Math.cos(a)*18,y:t.y+Math.sin(a)*18,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:1.05,r:tier>=2?6:5,hostile:false,kind:"towerRock",color:tier>=1?"#aeb7bf":"#8f8174",dmg,ownerId:t.ownerId,petBlast:false,knock:0});t.cd=tier>=2?.58:tier>=1?.76:1.0;
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
      if(!p.dead&&(Number(p._badCactusUntil)||0)>this.state.worldTime){p.health=Math.max(0,p.health-(Number(p._badCactusDamageRate)||2.5)*dt);p.hydration=clamp((Number(p.hydration)||0)-(Number(p._badCactusHydrateRate)||4.5)*dt,0,100);if(p.health<=0)this.damageTarget({kind:"player",id},999,"world","");}if(!p.dead&&(Number(p._honeyRushUntil)||0)>this.state.worldTime&&p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+(Number(p._honeyHealRate)||4.6)*dt);
      if(!p.dead){if((p._cactusSpineCd||0)>0)p._cactusSpineCd=Math.max(0,(p._cactusSpineCd||0)-dt);if(!(p._cactusSpineCd>0)){for(const[,r]of this.state.resources){if(!r||!r.alive||(r.type!=="desertCactusGood"&&r.type!=="desertCactusBad"))continue;const c=resourceCenter(r);if(dist(p.x,p.y,c.x,c.y)<(r.solidR||12)+12){p._cactusSpineCd=.7;this.damageTarget({kind:"player",id},3,"world","");break;}}}const activePhase=TIME_PHASES[this.state.dayPhase]?.name||"";if(activePhase==="Night"||activePhase==="Midnight")this.playerNightSeen.add(id);const t=(this.playerSurvivalSeconds.get(id)||0)+dt;this.playerSurvivalSeconds.set(id,t);let awards=this.playerSurvivalAwards.get(id);if(!awards){awards=new Set();this.playerSurvivalAwards.set(id,awards);}if(t>=300&&!awards.has("survive_5")){awards.add("survive_5");this.recordAccountAchievement(id,"survive_5",{});}if(t>=600&&!awards.has("survive_10")){awards.add("survive_10");this.recordAccountAchievement(id,"survive_10",{});}}
    }
    for(const[id,left]of this.resourceRespawns){
      const n=left-dt;
      if(n<=0){const r=this.state.resources.get(id);if(r){r.hp=r.maxHp;r.alive=true;}this.resourceRespawns.delete(id);}
      else this.resourceRespawns.set(id,n);
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
    const s=this.safeSpawn(),p=new PlayerState();this.playerCombatReadyAt.set(client.sessionId,Infinity);p.id=client.sessionId;p.username=String(options.username||"Cube").slice(0,14);p.x=s.x;p.y=s.y;p.angle=0;p.health=100;p.maxHealth=100;p.hydration=100;p.bucketWater=true;p.bucketSips=BUCKET_MAX_SIPS;p.color=typeof options.color==="string"?options.color:"#3fa7ff";p.tool="Fist";p._jungleHotUntil=0;p._jungleHotRate=0;p._cactusGoodUntil=0;p._cactusHealRate=0;p._cactusHydrateRate=0;p._badCactusUntil=0;p._badCactusDamageRate=0;p._badCactusHydrateRate=0;p._cactusSpineCd=0;p._desertHydrationWait=2.5;p._stoneFruitUntil=0;
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

  onLeave(client){const presenceUid=this.playerAccountIds?.get(client.sessionId);if(presenceUid){try{HOSTL_ACCOUNT_HOOKS.onPresenceLeave(String(presenceUid),`${this.roomId||"world"}:${client.sessionId}`);}catch(_){}}const populationKey=this.populationKeys.get(client.sessionId);if(populationKey){ACTIVE_CUBE_PLAYER_KEYS.delete(populationKey);this.populationKeys.delete(client.sessionId);}this.state.players.delete(client.sessionId);this.playerAccountIds?.delete(client.sessionId);this.playerAccountEntitlements?.delete(client.sessionId);this.playerSurvivalSeconds?.delete(client.sessionId);this.playerSurvivalAwards?.delete(client.sessionId);this.playerNightSeen?.delete(client.sessionId);this.playerCombatReadyAt?.delete(client.sessionId);this.playerInputNetState?.delete(client.sessionId);this.firstLightReadyPlayers.delete(client.sessionId);this.playerPetStatUpgrades.delete(client.sessionId);this.playerRunShop.delete(client.sessionId);this.playerSkillProgress.delete(client.sessionId);this.tamePendingPlayers.delete(client.sessionId);this.chatLastSent.delete(client.sessionId);this.playerAttackCd.delete(client.sessionId);this.playerShootCd.delete(client.sessionId);this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);this.pendingPlayerHits.delete(client.sessionId);this.pendingAnimalPushes.delete(client.sessionId);this.ownerThreat.delete(client.sessionId);const prefix=`${client.sessionId}:`;for(const k of Array.from(this.harvestCredits.keys()))if(k.startsWith(prefix))this.harvestCredits.delete(k);for(const k of Array.from(this.goldHandCredits.keys()))if(k.startsWith(prefix))this.goldHandCredits.delete(k);for(const[id,p]of Array.from(this.state.pets.entries()))if(p.ownerId===client.sessionId){this.petFocusTargets.delete(id);this.petFollowState.delete(id);this.petHuntState.delete(id);this.petChaseState.delete(id);this.petDeathTimers.delete(id);this.state.pets.delete(id);}}
  onDispose(){for(const key of this.populationKeys.values())ACTIVE_CUBE_PLAYER_KEYS.delete(key);this.populationKeys.clear();}

}
