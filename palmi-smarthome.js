// Railway sync 2026-08-15

const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
const API_BASE =
  process.env.TUYA_API_BASE || "https://openapi.tuyaeu.com";
const DEVICE_ID =
  process.env.TUYA_DEVICE_ID || "bf7d9913dd42da28899bnq";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const ALLOWED_CHAT_IDS = (
  process.env.TELEGRAM_ALLOWED_CHAT_IDS || ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ============================================================
// UTILITAIRES TEMPS — EUROPE/PARIS
// ============================================================

function getParisTime() {
  const now = new Date();
  const parisTime = new Date(
    now.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })
  );
  const hours = String(parisTime.getHours()).padStart(2, "0");
  const minutes = String(parisTime.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getParisDate() {
  const now = new Date();
  const parisTime = new Date(
    now.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })
  );
  return parisTime.toISOString().split("T")[0];
}

// ============================================================
// GESTION DES AUTOMATISATIONS (FICHIER + MÉMOIRE)
// ============================================================

const AUTOMATIONS_FILE = path.join(__dirname, "automations.json");

let automations = {
  night: false,
  custom: []
};

let lastAutomationRuns = {};

function loadAutomations() {
  try {
    if (fs.existsSync(AUTOMATIONS_FILE)) {
      const data = fs.readFileSync(AUTOMATIONS_FILE, "utf-8");
      const parsed = JSON.parse(data);
      automations.night = parsed.night ?? false;
      automations.custom = parsed.custom ?? [];
      console.log(
        `✅ Automatisations chargées: ${automations.custom.length} automatisation(s) custom`
      );
    } else {
      automations = { night: false, custom: [] };
      saveAutomations();
      console.log("📝 Fichier automations.json créé (premier lancement)");
    }
  } catch (err) {
    console.error("❌ Erreur chargement automations.json:", err.message);
    automations = { night: false, custom: [] };
  }
}

function saveAutomations() {
  try {
    fs.writeFileSync(
      AUTOMATIONS_FILE,
      JSON.stringify(automations, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("❌ Erreur sauvegarde automations.json:", err.message);
  }
}

// Charger les automatisations au démarrage
loadAutomations();

function hasRunToday(id, date) {
  return lastAutomationRuns[id] === date;
}

function markRun(id, date) {
  lastAutomationRuns[id] = date;
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

function buildStringToSign(method, body, headersStr, url) {
  const contentSha256 = sha256(body || "");

  return `${method}\n${contentSha256}\n${headersStr}\n${url}`;
}

// ============================================================
// AUTHENTIFICATION TUYA
// ============================================================

async function getToken() {
  const t = Date.now().toString();
  const method = "GET";
  const url = "/v1.0/token?grant_type=1";

  const stringToSign = buildStringToSign(method, "", "", url);

  const strToSign = `${ACCESS_ID}${t}${stringToSign}`;

  const sign = hmacSha256(strToSign, ACCESS_SECRET);

  const res = await axios.get(`${API_BASE}${url}`, {
    headers: {
      client_id: ACCESS_ID,
      sign,
      t,
      sign_method: "HMAC-SHA256"
    }
  });

  if (!res.data.success) {
    throw new Error(
      `Erreur token Tuya: ${JSON.stringify(res.data)}`
    );
  }

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
      "Content-Type": "application/json"
    },

    data: body || undefined
  });

  return res.data;
}

// ============================================================
// COMMANDES LED
// ============================================================

async function sendCommands(commands) {
  const token = await getToken();

  const url = `/v1.0/devices/${DEVICE_ID}/commands`;

  return signedRequest("POST", url, token, {
    commands
  });
}

// ============================================================
// ETAT DE LA LED
// ============================================================

async function getLightState() {
  const token = await getToken();

  const url = `/v1.0/devices/${DEVICE_ID}/status`;

  return signedRequest("GET", url, token);
}

// ============================================================
// HEX -> HSV
// ============================================================

function hexToHsv(hex) {
  const r = parseInt(hex.substring(0, 2), 16);

  const g = parseInt(hex.substring(2, 4), 16);

  const b = parseInt(hex.substring(4, 6), 16);

  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);

  const min = Math.min(rNorm, gNorm, bNorm);

  const delta = max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta) % 6;
    } else if (max === gNorm) {
      h = (bNorm - rNorm) / delta + 2;
    } else {
      h = (rNorm - gNorm) / delta + 4;
    }

    h = Math.round(h * 60);

    if (h < 0) {
      h += 360;
    }
  }

  const s =
    max === 0 ? 0 : Math.round((delta / max) * 1000);

  const v = Math.round(max * 1000);

  return {
    h,
    s,
    v
  };
}

// ============================================================
// FONCTIONS LUMIERE
// ============================================================

async function turnOn() {
  return sendCommands([
    {
      code: "switch_led",
      value: true
    }
  ]);
}

async function turnOff() {
  return sendCommands([
    {
      code: "switch_led",
      value: false
    }
  ]);
}

async function setBrightness(percent) {
  const tuyaValue = Math.round((percent / 100) * 1000);

  return sendCommands([
    {
      code: "bright_value",
      value: tuyaValue
    }
  ]);
}

async function setWhite(warmth, brightness) {
  const tempValue = Math.round((warmth / 100) * 1000);

  const brightValue = Math.round((brightness / 100) * 1000);

  return sendCommands([
    {
      code: "work_mode",
      value: "white"
    },
    {
      code: "temp_value",
      value: tempValue
    },
    {
      code: "bright_value",
      value: brightValue
    }
  ]);
}

async function setColor(hex) {
  const colourData = hexToHsv(hex);

  return sendCommands([
    {
      code: "work_mode",
      value: "colour"
    },
    {
      code: "colour_data",
      value: colourData
    }
  ]);
}

// ============================================================
// ROUTES HTTP
// ============================================================

app.get("/debug-functions", async (req, res) => {
  try {
    const token = await getToken();

    const data = await signedRequest(
      "GET",
      `/v1.0/devices/${DEVICE_ID}/functions`,
      token
    );

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/light/on", async (req, res) => {
  try {
    res.json(await turnOn());
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/light/off", async (req, res) => {
  try {
    res.json(await turnOff());
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/light/brightness", async (req, res) => {
  try {
    const percent = parseInt(req.query.value, 10);

    if (isNaN(percent) || percent < 0 || percent > 100) {
      return res.status(400).json({
        error: "Paramètre 'value' requis, entre 0 et 100."
      });
    }

    res.json(await setBrightness(percent));
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/light/white", async (req, res) => {
  try {
    const warmth = parseInt(req.query.warmth ?? "50", 10);

    const brightness = parseInt(req.query.brightness ?? "100", 10);

    if (isNaN(warmth) || warmth < 0 || warmth > 100) {
      return res.status(400).json({
        error: "warmth doit être compris entre 0 et 100."
      });
    }

    if (isNaN(brightness) || brightness < 0 || brightness > 100) {
      return res.status(400).json({
        error: "brightness doit être compris entre 0 et 100."
      });
    }

    res.json(await setWhite(warmth, brightness));
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/light/color", async (req, res) => {
  try {
    const hex = (req.query.hex || "").replace("#", "");

    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      return res.status(400).json({
        error: "Paramètre 'hex' requis, format RRGGBB, ex: ff0000."
      });
    }

    res.json(await setColor(hex));
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/", (req, res) => {
  res.send(
    "Palmi Smart Home — routes: /light/on, /light/off, /light/brightness?value=0-100, /light/white?warmth=50&brightness=100, /light/color?hex=RRGGBB, /debug-functions"
  );
});

// ============================================================
// SERVEUR
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Palmi Smart Home lancé sur le port ${PORT}`);
});

// ============================================================
// BOT TELEGRAM
// ============================================================

if (TELEGRAM_TOKEN) {
  const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: true
  });

  const knownChatIds = new Set(ALLOWED_CHAT_IDS);

  // État conversationnel pour /add automation
  const addAutomationState = {};

  function isAllowed(chatId) {
    if (ALLOWED_CHAT_IDS.length === 0) {
      return true;
    }

    return ALLOWED_CHAT_IDS.includes(String(chatId));
  }

  // ============================================================
  // EXÉCUTION AUTOMATISATION NUIT (03:00 EXISTANTE)
  // ============================================================

  async function runNightAutomation() {
    if (!automations.night) {
      return;
    }

    try {
      const data = await getLightState();
      const statusList = data.result || [];

      const switchStatus = statusList.find(
        (item) =>
          item.code === "switch_led" || item.code === "switch"
      );

      const isOn = switchStatus && switchStatus.value === true;

      if (!isOn) {
        console.log("🌙 03:00 : lumière déjà éteinte.");
        return;
      }

      await turnOff();

      console.log("🌙 03:00 : lumière éteinte.");

      for (const chatId of knownChatIds) {
        try {
          await bot.sendMessage(
            chatId,
            "🌙 Tu dors pas ? Tu as sûrement rallumé la lumière.\n" +
              "💡 Je l'éteins pour toi.\n" +
              "Dors bien ! 😴"
          );
        } catch (sendErr) {
          console.error(
            `❌ Erreur notification ${chatId}:`,
            sendErr.message
          );
        }
      }
    } catch (err) {
      console.error(
        "❌ Erreur automatisation 03:00:",
        err.message
      );
    }
  }

  // ============================================================
  // EXÉCUTION AUTOMATISATIONS PERSONNALISÉES
  // ============================================================

  async function executeCustomAutomation(automation) {
    try {
      const action = automation.action.toLowerCase().trim();
      let executed = false;

      if (action === "allumer") {
        await turnOn();
        executed = true;
      } else if (
        action === "éteindre" ||
        action === "eteindre"
      ) {
        await turnOff();
        executed = true;
      } else if (action.includes("luminosité")) {
        const match = action.match(/\d+/);
        if (match) {
          const brightness = parseInt(match[0], 10);
          await setBrightness(brightness);
          executed = true;
        }
      } else if (action === "blanc") {
        await setWhite(50, 100);
        executed = true;
      } else if (action.includes("couleur")) {
        const parts = action.split(" ");
        const color = parts[parts.length - 1];
        const NAMED_COLORS = {
          rouge: "ff0000",
          bleu: "0000ff",
          vert: "00ff00",
          jaune: "ffff00",
          violet: "800080",
          rose: "ff69b4",
          orange: "ffa500",
          cyan: "00ffff",
          turquoise: "40e0d0"
        };
        if (NAMED_COLORS[color]) {
          await setColor(NAMED_COLORS[color]);
          executed = true;
        }
      }

      if (executed && automation.message) {
        for (const chatId of knownChatIds) {
          try {
            await bot.sendMessage(chatId, automation.message);
          } catch (sendErr) {
            console.error(
              `❌ Erreur message ${chatId}:`,
              sendErr.message
            );
          }
        }
      }

      if (executed) {
        console.log(
          `✅ Automatisation '${automation.name}' exécutée`
        );
      }
    } catch (err) {
      console.error(
        `❌ Erreur exécution automatisation '${automation.name}':`,
        err.message
      );
    }
  }

  // ============================================================
  // BOUCLE PRINCIPALE — AUTOMATISATIONS
  // ============================================================

  setInterval(async () => {
    const currentTime = getParisTime();
    const currentDate = getParisDate();

    // Automatisation nuit existante (03:00)
    if (
      automations.night &&
      currentTime === "03:00" &&
      !hasRunToday("night_03:00", currentDate)
    ) {
      markRun("night_03:00", currentDate);
      await runNightAutomation();
    }

    // Automatisations personnalisées
    for (const automation of automations.custom) {
      const runId = `${automation.name}_${currentDate}`;
      if (
        currentTime === automation.time &&
        !hasRunToday(runId, currentDate)
      ) {
        markRun(runId, currentDate);
        await executeCustomAutomation(automation);
      }
    }
  }, 1000);

  console.log(
    "🌙 Automatisations Palmi prêtes — Europe/Paris"
  );

  // ============================================================
  // COULEURS
  // ============================================================

  const NAMED_COLORS = {
    rouge: "ff0000",
    bleu: "0000ff",
    vert: "00ff00",
    jaune: "ffff00",
    violet: "800080",
    rose: "ff69b4",
    orange: "ffa500",
    cyan: "00ffff",
    turquoise: "40e0d0"
  };

  // ============================================================
  // MESSAGES TELEGRAM
  // ============================================================

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    const text = (msg.text || "").toLowerCase().trim();

    if (!isAllowed(chatId)) {
      await bot.sendMessage(
        chatId,
        "⛔ Tu n'es pas autorisé à utiliser ce bot."
      );

      return;
    }

    knownChatIds.add(String(chatId));

    try {
      // ======================================================
      // COMMANDE /add — CRÉATEUR AUTOMATISATION
      // ======================================================

      if (text === "/add") {
        addAutomationState[chatId] = {
          step: 1,
          name: null,
          time: null,
          description: null,
          action: null,
          message: null
        };

        await bot.sendMessage(
          chatId,
          "🤖 Palmi va créer une automatisation pour toi !\n\n" +
            "🎯 Étape 1/5 : Comment veux-tu appeler cette automatisation ?\n" +
            "(Exemple: « Lumière du matin »)"
        );

        return;
      }

      // ======================================================
      // GESTION CONVERSATION /add
      // ======================================================

      if (addAutomationState[chatId]) {
        const state = addAutomationState[chatId];

        if (state.step === 1) {
          state.name = text;
          state.step = 2;

          await bot.sendMessage(
            chatId,
            `✅ Nom : "${text}"\n\n` +
              "⏰ Étape 2/5 : À quelle heure doit-elle s'exécuter ?\n" +
              "(Format: HH:MM — Exemple: 07:30)"
          );

          return;
        }

        if (state.step === 2) {
          if (!/^\d{2}:\d{2}$/.test(text)) {
            await bot.sendMessage(
              chatId,
              "❌ Format invalide. Utilise HH:MM (Exemple: 07:30)"
            );

            return;
          }

          state.time = text;
          state.step = 3;

          await bot.sendMessage(
            chatId,
            `✅ Heure : ${text}\n\n` +
              "📝 Étape 3/5 : Ajoute une description\n" +
              "(Exemple: « Allume la lumière pour te réveiller »)"
          );

          return;
        }

        if (state.step === 3) {
          state.description = text;
          state.step = 4;

          await bot.sendMessage(
            chatId,
            `✅ Description : "${text}"\n\n` +
              "⚡ Étape 4/5 : Quelle action doit-elle exécuter ?\n" +
              "Accepte: « allumer », « éteindre », « luminosité 30 »,\n" +
              "« luminosité 100 », « blanc », « couleur rouge »"
          );

          return;
        }

        if (state.step === 4) {
          state.action = text;
          state.step = 5;

          await bot.sendMessage(
            chatId,
            `✅ Action : "${text}"\n\n` +
              "💬 Étape 5/5 : Quel message Palmi doit-elle envoyer ?\n" +
              "(Laisse vide ou écris le message)"
          );

          return;
        }

        if (state.step === 5) {
          state.message = text || null;

          const newAutomation = {
            name: state.name,
            time: state.time,
            description: state.description,
            action: state.action,
            message: state.message
          };

          automations.custom.push(newAutomation);
          saveAutomations();

          delete addAutomationState[chatId];

          const recap =
            `✅ Automatisation créée !\n\n` +
            `📌 Nom: ${newAutomation.name}\n` +
            `⏰ Heure: ${newAutomation.time}\n` +
            `📝 Description: ${newAutomation.description}\n` +
            `⚡ Action: ${newAutomation.action}\n`;

          if (newAutomation.message) {
            `💬 Message: ${newAutomation.message}`;
          }

          await bot.sendMessage(chatId, recap);

          return;
        }
      }

      // ======================================================
      // /AUTOMATIONS — LISTE
      // ======================================================

      if (text === "/automations") {
        let msg =
          "🤖 Automatisations Palmi\n\n";

        if (automations.night) {
          msg +=
            "🌙 Nuit : ✅ Activée\n" +
            "⏰ 03:00 — Éteint la lumière\n" +
            "☀️❄️ Europe/Paris\n\n";
        }

        if (
          automations.custom &&
          automations.custom.length > 0
        ) {
          msg += "⚙️ Automatisations personnalisées:\n";

          for (const auto of automations.custom) {
            msg +=
              `\n📌 ${auto.name}\n` +
              `   ⏰ ${auto.time}\n` +
              `   📝 ${auto.description}\n` +
              `   ⚡ ${auto.action}`;

            if (auto.message) {
              msg += `\n   💬 ${auto.message}`;
            }
          }
        } else if (!automations.night) {
          msg += "Aucune automatisation activée.";
        }

        await bot.sendMessage(chatId, msg);

        return;
      }

      // ======================================================
      // /REMOVE — SUPPRESSION
      // ======================================================

      if (text === "/remove") {
        if (!automations.custom || automations.custom.length === 0) {
          await bot.sendMessage(
            chatId,
            "❌ Aucune automatisation à supprimer."
          );

          return;
        }

        let msg = "🗑️ Quelle automatisation supprimer ?\n\n";

        for (const auto of automations.custom) {
          msg += `• ${auto.name}\n`;
        }

        msg += "\n(Écris le nom exact)";

        await bot.sendMessage(chatId, msg);

        addAutomationState[chatId] = {
          step: "remove"
        };

        return;
      }

      // Gestion suppression
      if (
        addAutomationState[chatId] &&
        addAutomationState[chatId].step === "remove"
      ) {
        const idx = automations.custom.findIndex(
          (a) =>
            a.name.toLowerCase() ===
            text.toLowerCase()
        );

        if (idx === -1) {
          await bot.sendMessage(
            chatId,
            "❌ Automatisation non trouvée."
          );

          delete addAutomationState[chatId];

          return;
        }

        const removed = automations.custom[idx];
        automations.custom.splice(idx, 1);
        saveAutomations();

        delete addAutomationState[chatId];

        await bot.sendMessage(
          chatId,
          `✅ Automatisation "${removed.name}" supprimée.`
        );

        return;
      }

      // ======================================================
      // ANCIENNES COMMANDES /add_automation ET /add automation
      // ======================================================

      if (
        text === "/add automation" ||
        text === "/add_automation"
      ) {
        automations.night = true;

        saveAutomations();

        bot.sendMessage(
          chatId,
          "🌙 Automatisation nuit activée !\n\n" +
            "⏰ Tous les jours à 03:00 (heure de Paris)\n" +
            "💡 Si la lumière est allumée, Palmi l'éteindra.\n" +
            "😴 Puis Palmi t'enverra son message.\n\n" +
            "☀️❄️ L'heure été/hiver est automatique."
        );

        return;
      }

      if (
        text === "/remove automation" ||
        text === "/remove_automation"
      ) {
        automations.night = false;

        saveAutomations();

        bot.sendMessage(
          chatId,
          "🌙 Automatisation nuit désactivée."
        );

        return;
      }

      // ======================================================
      // START / AIDE
      // ======================================================

      if (
        text === "/start" ||
        text === "/help" ||
        text === "aide"
      ) {
        bot.sendMessage(
          chatId,
          "👋 Salut ! Je suis Palmi Smart Home 🌴🤖\n\n" +
            "💡 Commandes lumière :\n" +
            "• « allume ma lumière »\n" +
            "• « éteins la lumière »\n" +
            "• « lumière blanche »\n" +
            "• « luminosité à 50 »\n" +
            "• « baisse la luminosité »\n" +
            "• « monte la luminosité »\n" +
            "• « couleur rouge »\n" +
            "• « couleur bleu »\n\n" +
            "🤖 Automatisations :\n" +
            "• /add — créer une automatisation\n" +
            "• /automations — voir toutes\n" +
            "• /remove — supprimer une\n" +
            "• /add automation — nuit (03:00)\n" +
            "• /remove automation — désactiver nuit\n\n" +
            "☀️❄️ Heure : Europe/Paris"
        );

        return;
      }

      // ======================================================
      // ALLUMER
      // ======================================================

      if (text.includes("allume")) {
        await turnOn();

        bot.sendMessage(chatId, "💡 Lumière allumée !");

        return;
      }

      // ======================================================
      // ÉTEINDRE
      // ======================================================

      if (
        text.includes("éteins") ||
        text.includes("eteins") ||
        text.includes("éteint")
      ) {
        await turnOff();

        bot.sendMessage(chatId, "🌑 Lumière éteinte.");

        return;
      }

      // ======================================================
      // MODE BLANC
      // ======================================================

      if (text.includes("blanc")) {
        await setWhite(50, 100);

        bot.sendMessage(chatId, "🤍 Lumière en blanc !");

        return;
      }

      // ======================================================
      // LUMINOSITÉ
      // ======================================================

      const brightnessMatch =
        text.match(/luminosit[ée]\s*(?:à|a)?\s*(\d+)/) ||
        text.match(/(\d+)\s*%/);

      if (brightnessMatch) {
        const value = Math.min(
          100,
          Math.max(0, parseInt(brightnessMatch[1], 10))
        );

        await setBrightness(value);

        bot.sendMessage(
          chatId,
          `🔆 Luminosité réglée à ${value}%.`
        );

        return;
      }

      // ======================================================
      // BAISSER LUMINOSITÉ
      // ======================================================

      if (
        text.includes("baisse") &&
        text.includes("luminosit")
      ) {
        await setBrightness(20);

        bot.sendMessage(chatId, "🔅 Luminosité baissée à 20%.");

        return;
      }

      // ======================================================
      // MONTER LUMINOSITÉ
      // ======================================================

      if (
        text.includes("monte") &&
        text.includes("luminosit")
      ) {
        await setBrightness(100);

        bot.sendMessage(chatId, "🔆 Luminosité montée à 100%.");

        return;
      }

      // ======================================================
      // COULEURS NOMMÉES
      // ======================================================

      for (const [name, hex] of Object.entries(NAMED_COLORS)) {
        if (text.includes(name)) {
          await setColor(hex);

          bot.sendMessage(chatId, `🎨 Couleur changée en ${name} !`);

          return;
        }
      }

      // ======================================================
      // COULEUR HEX
      // ======================================================

      const hexMatch = text.match(/#?([0-9a-f]{6})\b/);

      if (hexMatch && text.includes("couleur")) {
        await setColor(hexMatch[1]);

        bot.sendMessage(
          chatId,
          `🎨 Couleur changée en #${hexMatch[1]} !`
        );

        return;
      }
    } catch (err) {
      console.error("❌ Erreur Telegram :", err);

      bot.sendMessage(chatId, `❌ Erreur : ${err.message}`);
    }
  });

  bot.on("polling_error", (err) => {
    console.error(
      "❌ Telegram polling error :",
      err.message
    );
  });

  console.log(
    "🤖 Bot Telegram Palmi Smart Home démarré (polling)."
  );
} else {
  console.log(
    "TELEGRAM_BOT_TOKEN absent, bot Telegram désactivé."
  );
}

