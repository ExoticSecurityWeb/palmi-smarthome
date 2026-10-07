// ============================================================
// PALMI-PLUG — Prise connectée Tuya "LSC Power Plug FR incl. Power meter"
// Communication exclusive via Tuya Cloud (aucun contrôle local).
// Réutilise TUYA_ACCESS_ID / TUYA_ACCESS_SECRET déjà configurés.
// Device ID : variable TUYA_PLUG_DEVICE_ID (obligatoire, rien en dur).
//
// FONCTIONS :
//  - on / off / status (avec conso : W, V, mA, kWh)
//  - règle batterie téléphone : coupe à >= X %, rallume à <= Y %
//    (le téléphone envoie son niveau à /plug/battery)
//  - coupure de nuit à heure fixe (réglable depuis Telegram)
//  - commandes Telegram en français (handleTelegramCommand)
//
// VARIABLES D'ENVIRONNEMENT :
//  TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_API_BASE (déjà là)
//  TUYA_PLUG_DEVICE_ID   (OBLIGATOIRE : l'ID de la prise dans Tuya IoT)
//  PLUG_BATTERY_KEY      (OBLIGATOIRE pour /plug/battery : secret
//                         partagé avec le téléphone)
// ============================================================

const crypto = require("crypto");
const axios = require("axios");
const express = require("express");
const fs = require("fs");
const path = require("path");

const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;

const API_BASE =
  process.env.TUYA_API_BASE ||
  "https://openapi.tuyaeu.com";

const PLUG_DEVICE_ID =
  process.env.TUYA_PLUG_DEVICE_ID;

const PLUG_BATTERY_KEY =
  process.env.PLUG_BATTERY_KEY;

const SETTINGS_FILE = path.join(
  __dirname,
  "plug-settings.json"
);

// ============================================================
// RÉGLAGES (sauvegardés dans plug-settings.json)
// ============================================================

const DEFAULT_SETTINGS = {
  autoBattery: true,
  batteryOff: 85,
  batteryOn: 20,
  nightCutEnabled: true,
  nightCutTime: "03:00"
};

const settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return;
    }

    const saved = JSON.parse(
      fs.readFileSync(SETTINGS_FILE, "utf8")
    );

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (saved[key] !== undefined) {
        settings[key] = saved[key];
      }
    }
  } catch (err) {
    console.error(
      "⚠️ Lecture plug-settings.json impossible :",
      err.message
    );
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(settings, null, 2)
    );
  } catch (err) {
    console.error(
      "⚠️ Écriture plug-settings.json impossible :",
      err.message
    );
  }
}

loadSettings();

// ============================================================
// ÉTAT EN MÉMOIRE
// ============================================================

const state = {
  battery: null, // { level, at }
  lastNightCutDate: null,
  switchCode: "switch_1"
};

let notify = async () => {};

function setNotifier(fn) {
  if (typeof fn === "function") {
    notify = fn;
  }
}

async function safeNotify(message) {
  try {
    await notify(message);
  } catch (err) {
    console.error(
      "⚠️ Notification prise impossible :",
      err.message
    );
  }
}

// ============================================================
// SIGNATURE TUYA
// ============================================================

function sha256(str) {
  return crypto
    .createHash("sha256")
    .update(str, "utf8")
    .digest("hex");
}

function hmacSha256(str, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(str, "utf8")
    .digest("hex")
    .toUpperCase();
}

function buildStringToSign(
  method,
  body,
  headersStr,
  url
) {
  return `${method}\n${sha256(body || "")}\n${headersStr}\n${url}`;
}

// ============================================================
// TOKEN TUYA (mis en cache jusqu'à expiration)
// ============================================================

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getToken() {
  if (!ACCESS_ID || !ACCESS_SECRET) {
    throw new Error(
      "Variables TUYA_ACCESS_ID / TUYA_ACCESS_SECRET manquantes."
    );
  }

  if (
    cachedToken &&
    Date.now() < cachedTokenExpiresAt
  ) {
    return cachedToken;
  }

  const t = Date.now().toString();
  const url = "/v1.0/token?grant_type=1";

  const stringToSign =
    buildStringToSign("GET", "", "", url);

  const sign = hmacSha256(
    `${ACCESS_ID}${t}${stringToSign}`,
    ACCESS_SECRET
  );

  const res = await axios.get(
    `${API_BASE}${url}`,
    {
      headers: {
        client_id: ACCESS_ID,
        sign,
        t,
        sign_method: "HMAC-SHA256"
      }
    }
  );

  if (!res.data.success) {
    throw new Error(
      `Erreur token Tuya: ${JSON.stringify(res.data)}`
    );
  }

  const expireSeconds =
    Number(res.data.result.expire_time) || 7200;

  cachedToken = res.data.result.access_token;
  cachedTokenExpiresAt =
    Date.now() + (expireSeconds - 120) * 1000;

  return cachedToken;
}

async function signedRequest(
  method,
  url,
  token,
  body
) {
  const t = Date.now().toString();

  const bodyStr = body
    ? JSON.stringify(body)
    : "";

  const stringToSign = buildStringToSign(
    method,
    bodyStr,
    "",
    url
  );

  const sign = hmacSha256(
    `${ACCESS_ID}${token}${t}${stringToSign}`,
    ACCESS_SECRET
  );

  const res = await axios({
    method,
    url: `${API_BASE}${url}`,
    headers: {
      client_id: ACCESS_ID,
      access_token: token,
      sign,
      t,
      sign_method: "HMAC-SHA256",
      "Content-Type": "application/json"
    },
    data: body || undefined
  });

  return res.data;
}

async function tuya(method, url, body) {
  if (!PLUG_DEVICE_ID) {
    throw new Error(
      "Variable TUYA_PLUG_DEVICE_ID manquante."
    );
  }

  let token = await getToken();
  let data = await signedRequest(
    method,
    url,
    token,
    body
  );

  // Token invalide / expiré : on le renouvelle une fois
  if (
    data &&
    data.success === false &&
    (data.code === 1010 || data.code === 1011)
  ) {
    cachedToken = null;
    token = await getToken();
    data = await signedRequest(
      method,
      url,
      token,
      body
    );
  }

  return data;
}

// ============================================================
// STATUT (avec conso)
// ============================================================

const SWITCH_CODES = ["switch_1", "switch"];

async function getPlugRawStatus() {
  const data = await tuya(
    "GET",
    `/v1.0/devices/${PLUG_DEVICE_ID}/status`
  );

  if (!data || !data.success || !data.result) {
    throw new Error(
      `Réponse Tuya invalide : ${JSON.stringify(data)}`
    );
  }

  return data.result;
}

function parseStatus(result) {
  const dps = {};

  for (const item of result) {
    dps[item.code] = item.value;
  }

  const switchCode =
    SWITCH_CODES.find((c) => c in dps) ||
    state.switchCode;

  state.switchCode = switchCode;

  const num = (v) =>
    typeof v === "number" ? v : null;

  // Échelles Tuya usuelles pour les prises avec compteur :
  // cur_power = 0.1 W, cur_voltage = 0.1 V,
  // cur_current = mA, add_ele = 0.001 kWh.
  // Vérifie avec /plug/status?raw=1 si une valeur te semble bizarre.
  const power = num(dps.cur_power);
  const voltage = num(dps.cur_voltage);
  const current = num(dps.cur_current);
  const energy = num(dps.add_ele);

  return {
    on: dps[switchCode] === true,
    power:
      power === null
        ? null
        : Math.round(power) / 10,
    voltage:
      voltage === null
        ? null
        : Math.round(voltage) / 10,
    current,
    energy:
      energy === null
        ? null
        : Math.round(energy) / 1000,
    dps
  };
}

async function getPlugStatus() {
  return parseStatus(await getPlugRawStatus());
}

async function getPlugFunctions() {
  return tuya(
    "GET",
    `/v1.0/devices/${PLUG_DEVICE_ID}/functions`
  );
}

// ============================================================
// COMMANDES ON / OFF
// ============================================================

async function setPlug(value) {
  // S'assure d'avoir le bon code (switch_1 ou switch)
  try {
    await getPlugStatus();
  } catch (_) {
    // on tente quand même avec le code par défaut
  }

  const data = await tuya(
    "POST",
    `/v1.0/devices/${PLUG_DEVICE_ID}/commands`,
    {
      commands: [
        {
          code: state.switchCode,
          value
        }
      ]
    }
  );

  if (!data || data.success === false) {
    throw new Error(
      `Commande refusée : ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function turnOnPlug() {
  return setPlug(true);
}

async function turnOffPlug() {
  return setPlug(false);
}

// ============================================================
// RÈGLE BATTERIE TÉLÉPHONE
// ============================================================

async function applyBatteryRule(level) {
  state.battery = {
    level,
    at: Date.now()
  };

  if (!settings.autoBattery) {
    return {
      action: "none",
      reason: "automatisation batterie désactivée"
    };
  }

  if (level >= settings.batteryOff) {
    const status = await getPlugStatus();

    if (status.on) {
      await turnOffPlug();

      await safeNotify(
        `🔋 Téléphone à ${level} % : prise coupée.`
      );

      return { action: "off" };
    }

    return {
      action: "none",
      reason: "prise déjà coupée"
    };
  }

  if (level <= settings.batteryOn) {
    const status = await getPlugStatus();

    if (!status.on) {
      await turnOnPlug();

      await safeNotify(
        `🪫 Téléphone à ${level} % : prise rallumée.`
      );

      return { action: "on" };
    }

    return {
      action: "none",
      reason: "prise déjà allumée"
    };
  }

  return {
    action: "none",
    reason: "niveau entre les deux seuils"
  };
}

// ============================================================
// COUPURE DE NUIT (appelée chaque seconde par le scheduler)
// ============================================================

function parisNow() {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const get = (type) =>
    parts.find((p) => p.type === type).value;

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`
  };
}

async function tick() {
  if (!settings.nightCutEnabled) {
    return;
  }

  const { date, time } = parisNow();

  if (
    time !== settings.nightCutTime ||
    state.lastNightCutDate === date
  ) {
    return;
  }

  state.lastNightCutDate = date;

  try {
    const status = await getPlugStatus();

    if (status.on) {
      await turnOffPlug();

      await safeNotify(
        `🌙 ${settings.nightCutTime} : prise du téléphone coupée.`
      );
    }
  } catch (err) {
    console.error(
      "❌ Coupure de nuit prise :",
      err.message
    );

    await safeNotify(
      `❌ Coupure de nuit de la prise impossible : ${err.message}`
    );
  }
}

// ============================================================
// TEXTE (Telegram)
// ============================================================

function timeAgo(ts) {
  const min = Math.round(
    (Date.now() - ts) / 60000
  );

  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;

  const h = Math.floor(min / 60);

  if (h < 24) return `il y a ${h} h`;

  return `il y a ${Math.floor(h / 24)} j`;
}

function settingsText() {
  return (
    "⚙️ Réglages prise :\n" +
    `• Auto batterie : ${
      settings.autoBattery ? "activée" : "désactivée"
    } (coupe à ${settings.batteryOff} %, rallume à ${settings.batteryOn} %)\n` +
    `• Coupure de nuit : ${
      settings.nightCutEnabled
        ? settings.nightCutTime
        : "désactivée"
    }`
  );
}

async function statusText() {
  const s = await getPlugStatus();

  let text = `🔌 Prise : ${
    s.on ? "allumée ✅" : "éteinte ⛔"
  }`;

  const bits = [];

  if (s.power !== null) bits.push(`${s.power} W`);
  if (s.voltage !== null) bits.push(`${s.voltage} V`);
  if (s.current !== null) bits.push(`${s.current} mA`);

  if (bits.length) {
    text += `\n⚡ ${bits.join(" · ")}`;
  }

  if (s.energy !== null) {
    text += `\n📊 Compteur : ${s.energy} kWh`;
  }

  if (state.battery) {
    text += `\n🔋 Téléphone : ${state.battery.level} % (${timeAgo(
      state.battery.at
    )})`;
  }

  return `${text}\n\n${settingsText()}`;
}

// ============================================================
// COMMANDES TELEGRAM
// Retourne un texte de réponse, ou null si ce n'est pas pour la prise.
// ============================================================

async function handleTelegramCommand(rawText) {
  const text = (rawText || "")
    .trim()
    .toLowerCase()
    .replace(/^(\/\w+)@\w+/, "$1");

  if (!text) {
    return null;
  }

  // ---- /seuil 85 : coupe à 85 %
  let m = text.match(/^\/seuil\s+(\d{1,3})$/);

  if (m) {
    const v = parseInt(m[1], 10);

    if (v < 30 || v > 100 || v <= settings.batteryOn + 4) {
      return `❌ Le seuil de coupure doit être entre 30 et 100 % et au-dessus de ${
        settings.batteryOn + 4
      } %.`;
    }

    settings.batteryOff = v;
    saveSettings();

    return `✅ La prise se coupera à ${v} %.\n\n${settingsText()}`;
  }

  // ---- /seuil_on 20 : rallume à 20 %
  m = text.match(/^\/seuil_on\s+(\d{1,3})$/);

  if (m) {
    const v = parseInt(m[1], 10);

    if (v < 5 || v >= settings.batteryOff - 4) {
      return `❌ Le seuil de rallumage doit être entre 5 et ${
        settings.batteryOff - 5
      } %.`;
    }

    settings.batteryOn = v;
    saveSettings();

    return `✅ La prise se rallumera à ${v} %.\n\n${settingsText()}`;
  }

  // ---- /heure_coupure 03:00 | off
  m = text.match(
    /^\/heure_coupure\s+(off|([01]?\d|2[0-3])[:h]([0-5]\d))$/
  );

  if (m) {
    if (m[1] === "off") {
      settings.nightCutEnabled = false;
      saveSettings();

      return `✅ Coupure de nuit désactivée.\n\n${settingsText()}`;
    }

    settings.nightCutEnabled = true;
    settings.nightCutTime = `${m[2].padStart(2, "0")}:${m[3]}`;
    saveSettings();

    return `✅ La prise se coupera chaque nuit à ${settings.nightCutTime}.\n\n${settingsText()}`;
  }

  if (text.startsWith("/heure_coupure")) {
    return "❌ Exemple : /heure_coupure 03:00 (ou /heure_coupure off)";
  }

  // ---- /prise_auto on|off
  m = text.match(/^\/prise_auto\s+(on|off)$/);

  if (m) {
    settings.autoBattery = m[1] === "on";
    saveSettings();

    return `✅ Auto batterie ${
      settings.autoBattery ? "activée" : "désactivée"
    }.\n\n${settingsText()}`;
  }

  if (text.startsWith("/prise_auto")) {
    return "❌ Exemple : /prise_auto on (ou /prise_auto off)";
  }

  // ---- /prise_reglages
  if (text === "/prise_reglages") {
    return settingsText();
  }

  // ---- statut
  if (
    text === "/prise" ||
    /^(état|etat|statut|conso)\b.*\bprise\b/.test(text) ||
    /^(la )?conso\b/.test(text)
  ) {
    return statusText();
  }

  // ---- langage naturel : "allume la prise" / "éteins la prise"
  if (/\bprise\b/.test(text)) {
    if (
      /(éteins|eteins|éteint|eteint|éteindre|eteindre|coupe|couper|arrête|arrete)/.test(
        text
      )
    ) {
      await turnOffPlug();
      return "🔌 Prise éteinte ⛔";
    }

    if (/(allume|allumer|rallume|rallumer)/.test(text)) {
      await turnOnPlug();
      return "🔌 Prise allumée ✅";
    }
  }

  return null;
}

// ============================================================
// ROUTES HTTP (montées sur /plug)
// ============================================================

const router = express.Router();

function sendError(res, err) {
  res.status(500).json({
    success: false,
    error: err.message
  });
}

router.get("/debug-functions", async (req, res) => {
  try {
    res.json(await getPlugFunctions());
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/status", async (req, res) => {
  try {
    const s = await getPlugStatus();

    const body = {
      success: true,
      on: s.on,
      power: s.power,
      voltage: s.voltage,
      current: s.current,
      energy: s.energy,
      battery: state.battery,
      settings
    };

    if (req.query.raw === "1") {
      body.raw = s.dps;
    }

    res.json(body);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/on", async (req, res) => {
  try {
    await turnOnPlug();
    res.json({ success: true, on: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/off", async (req, res) => {
  try {
    await turnOffPlug();
    res.json({ success: true, on: false });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/settings", (req, res) => {
  res.json({ success: true, settings });
});

// Le téléphone appelle cette route à chaque changement de batterie :
// /plug/battery?level=85&key=TON_SECRET
async function batteryHandler(req, res) {
  try {
    if (!PLUG_BATTERY_KEY) {
      return res.status(503).json({
        success: false,
        error: "PLUG_BATTERY_KEY non configurée sur le serveur."
      });
    }

    const provided = String(
      req.query.key ||
        (req.body && req.body.key) ||
        ""
    );

    const a = Buffer.from(provided);
    const b = Buffer.from(PLUG_BATTERY_KEY);

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) {
      return res.status(403).json({
        success: false,
        error: "Clé invalide."
      });
    }

    const level = parseInt(
      req.query.level ??
        (req.body && req.body.level),
      10
    );

    if (
      Number.isNaN(level) ||
      level < 0 ||
      level > 100
    ) {
      return res.status(400).json({
        success: false,
        error: "Paramètre 'level' requis, entre 0 et 100."
      });
    }

    const result = await applyBatteryRule(level);

    res.json({ success: true, level, ...result });
  } catch (err) {
    sendError(res, err);
  }
}

router.get("/battery", batteryHandler);
router.post("/battery", batteryHandler);

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  router,

  turnOnPlug,
  turnOffPlug,

  getPlugStatus,
  getPlugFunctions,

  applyBatteryRule,
  tick,
  setNotifier,

  handleTelegramCommand,

  settings
};
