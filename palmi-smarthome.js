const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json());

const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
const API_BASE = process.env.TUYA_API_BASE || "https://openapi.tuyaeu.com";
const DEVICE_ID = process.env.TUYA_DEVICE_ID || "bf7d9913dd42da28899bnq";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// === Signature Tuya (HMAC-SHA256) ===

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function hmacSha256(str, secret) {
  return crypto.createHmac("sha256", secret).update(str, "utf8").digest("hex").toUpperCase();
}

function buildStringToSign(method, body, headersStr, url) {
  const contentSha256 = sha256(body || "");
  return `${method}\n${contentSha256}\n${headersStr}\n${url}`;
}

async function getToken() {
  const t = Date.now().toString();
  const method = "GET";
  const url = "/v1.0/token?grant_type=1";
  const stringToSign = buildStringToSign(method, "", "", url);
  const strToSign = `${ACCESS_ID}${t}${stringToSign}`;
  const sign = hmacSha256(strToSign, ACCESS_SECRET);

  const res = await axios.get(`${API_BASE}${url}`, {
    headers: { client_id: ACCESS_ID, sign, t, sign_method: "HMAC-SHA256" },
  });

  if (!res.data.success) throw new Error(`Erreur token Tuya: ${JSON.stringify(res.data)}`);
  return res.data.result.access_token;
}

async function signedRequest(method, url, token, body) {
  const t = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const stringToSign = buildStringToSign(method, bodyStr, "", url);
  const strToSign = `${ACCESS_ID}${token}${t}${stringToSign}`;
  const sign = hmacSha256(strToSign, ACCESS_SECRET);

  const res = await axios({
    method,
    url: `${API_BASE}${url}`,
    headers: {
      client_id: ACCESS_ID,
      access_token: token,
      sign,
      t,
      sign_method: "HMAC-SHA256",
      "Content-Type": "application/json",
    },
    data: body || undefined,
  });

  return res.data;
}

async function sendCommands(commands) {
  const token = await getToken();
  const url = `/v1.0/devices/${DEVICE_ID}/commands`;
  const data = await signedRequest("POST", url, token, { commands });
  return data;
}

function hexToHsv(hex) {
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) h = ((gNorm - bNorm) / delta) % 6;
    else if (max === gNorm) h = (bNorm - rNorm) / delta + 2;
    else h = (rNorm - gNorm) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : Math.round((delta / max) * 1000);
  const v = Math.round(max * 1000);

  return { h, s, v };
}

// === Fonctions haut niveau réutilisées par les routes HTTP ET le bot Telegram ===

async function turnOn() {
  return sendCommands([{ code: "switch_led", value: true }]);
}

async function turnOff() {
  return sendCommands([{ code: "switch_led", value: false }]);
}

async function setBrightness(percent) {
  const tuyaValue = Math.round((percent / 100) * 1000);
  return sendCommands([{ code: "bright_value", value: tuyaValue }]);
}

async function setColor(hex) {
  const colourData = hexToHsv(hex);
  return sendCommands([
    { code: "work_mode", value: "colour" },
    { code: "colour_data", value: colourData },
  ]);
}

// === ROUTES HTTP (toujours dispo, utile pour tester) ===

app.get("/debug-functions", async (req, res) => {
  try {
    const token = await getToken();
    const data = await signedRequest("GET", `/v1.0/devices/${DEVICE_ID}/functions`, token);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/light/on", async (req, res) => {
  try {
    res.json(await turnOn());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/light/off", async (req, res) => {
  try {
    res.json(await turnOff());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/light/brightness", async (req, res) => {
  try {
    const percent = parseInt(req.query.value, 10);
    if (isNaN(percent) || percent < 0 || percent > 100) {
      return res.status(400).json({ error: "Paramètre 'value' requis, entre 0 et 100." });
    }
    res.json(await setBrightness(percent));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/light/color", async (req, res) => {
  try {
    const hex = (req.query.hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      return res.status(400).json({ error: "Paramètre 'hex' requis, format RRGGBB, ex: ff0000." });
    }
    res.json(await setColor(hex));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Palmi Smart Home — routes: /light/on, /light/off, /light/brightness?value=0-100, /light/color?hex=RRGGBB, /debug-functions");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Palmi Smart Home lancé sur le port ${PORT}`));

// === BOT TELEGRAM ===

if (TELEGRAM_TOKEN) {
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

  function isAllowed(chatId) {
    if (ALLOWED_CHAT_IDS.length === 0) return true; // pas de restriction si vide
    return ALLOWED_CHAT_IDS.includes(String(chatId));
  }

  const NAMED_COLORS = {
    rouge: "ff0000",
    bleu: "0000ff",
    vert: "00ff00",
    jaune: "ffff00",
    violet: "800080",
    rose: "ff69b4",
    orange: "ffa500",
    blanc: "ffffff",
    cyan: "00ffff",
    turquoise: "40e0d0",
  };

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || "").toLowerCase().trim();

    if (!isAllowed(chatId)) {
      bot.sendMessage(chatId, "⛔ Tu n'es pas autorisé à utiliser ce bot.");
      return;
    }

    try {
      if (text.includes("allume")) {
        await turnOn();
        bot.sendMessage(chatId, "💡 Lumière allumée !");
        return;
      }

      if (text.includes("éteins") || text.includes("eteins") || text.includes("éteint")) {
        await turnOff();
        bot.sendMessage(chatId, "🌑 Lumière éteinte.");
        return;
      }

      const brightnessMatch = text.match(/luminosit[ée]\s*(?:à|a)?\s*(\d+)/) || text.match(/(\d+)\s*%/);
      if (brightnessMatch) {
        const value = Math.min(100, Math.max(0, parseInt(brightnessMatch[1], 10)));
        await setBrightness(value);
        bot.sendMessage(chatId, `🔆 Luminosité réglée à ${value}%.`);
        return;
      }

      if (text.includes("baisse") && text.includes("luminosit")) {
        await setBrightness(20);
        bot.sendMessage(chatId, "🔅 Luminosité baissée à 20%.");
        return;
      }

      if (text.includes("monte") && text.includes("luminosit")) {
        await setBrightness(100);
        bot.sendMessage(chatId, "🔆 Luminosité montée à 100%.");
        return;
      }

      for (const [name, hex] of Object.entries(NAMED_COLORS)) {
        if (text.includes(name)) {
          await setColor(hex);
          bot.sendMessage(chatId, `🎨 Couleur changée en ${name} !`);
          return;
        }
      }

      const hexMatch = text.match(/#?([0-9a-f]{6})\b/);
      if (hexMatch && text.includes("couleur")) {
        await setColor(hexMatch[1]);
        bot.sendMessage(chatId, `🎨 Couleur changée en #${hexMatch[1]} !`);
        return;
      }

      if (text === "/start" || text.includes("aide") || text === "/help") {
        bot.sendMessage(
          chatId,
          "👋 Salut, je suis Palmi Smart Home !\n\nCommandes :\n💡 « allume ma lumière »\n🌑 « éteins la lumière »\n🔆 « luminosité à 50 »\n🎨 « couleur rouge » (rouge, bleu, vert, jaune, violet, rose, orange, blanc, cyan, turquoise)"
        );
        return;
      }
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur : ${err.message}`);
    }
  });

  console.log("Bot Telegram Palmi Smart Home démarré (polling).");
} else {
  console.log("TELEGRAM_BOT_TOKEN absent, bot Telegram désactivé.");
}
