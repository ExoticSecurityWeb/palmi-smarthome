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
// AUTOMATISATIONS PALMI
// ============================================================

const AUTOMATION_FILE = path.join(
  __dirname,
  "automations.json"
);

const AUTOMATION_TIMEZONE = "Europe/Paris";

let automations = {
  night: false
};

try {
  if (fs.existsSync(AUTOMATION_FILE)) {
    const saved = JSON.parse(
      fs.readFileSync(AUTOMATION_FILE, "utf8")
    );

    automations = {
      ...automations,
      ...saved
    };
  }
} catch (err) {
  console.error(
    "❌ Erreur lecture automations.json :",
    err.message
  );
}

function saveAutomations() {
  try {
    fs.writeFileSync(
      AUTOMATION_FILE,
      JSON.stringify(automations, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error(
      "❌ Erreur sauvegarde automatisations :",
      err.message
    );
  }
}

function getParisTime() {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: AUTOMATION_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function getParisDate() {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: AUTOMATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
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

  const stringToSign = buildStringToSign(
    method,
    "",
    "",
    url
  );

  const strToSign =
    `${ACCESS_ID}${t}${stringToSign}`;

  const sign =
    hmacSha256(
      strToSign,
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

  return res.data.result.access_token;
}

async function signedRequest(
  method,
  url,
  token,
  body
) {
  const t = Date.now().toString();

  const bodyStr =
    body
      ? JSON.stringify(body)
      : "";

  const stringToSign =
    buildStringToSign(
      method,
      bodyStr,
      "",
      url
    );

  const strToSign =
    `${ACCESS_ID}${token}${t}${stringToSign}`;

  const sign =
    hmacSha256(
      strToSign,
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

// ============================================================
// COMMANDES LED
// ============================================================

async function sendCommands(commands) {
  const token =
    await getToken();

  const url =
    `/v1.0/devices/${DEVICE_ID}/commands`;

  return signedRequest(
    "POST",
    url,
    token,
    {
      commands
    }
  );
}

// ============================================================
// ETAT DE LA LED
// ============================================================

async function getLightState() {
  const token =
    await getToken();

  const url =
    `/v1.0/devices/${DEVICE_ID}/status`;

  return signedRequest(
    "GET",
    url,
    token
  );
}

// ============================================================
// HEX -> HSV
// ============================================================

function hexToHsv(hex) {
  const r = parseInt(
    hex.substring(0, 2),
    16
  );

  const g = parseInt(
    hex.substring(2, 4),
    16
  );

  const b = parseInt(
    hex.substring(4, 6),
    16
  );

  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(
    rNorm,
    gNorm,
    bNorm
  );

  const min = Math.min(
    rNorm,
    gNorm,
    bNorm
  );

  const delta =
    max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === rNorm) {
      h =
        ((gNorm - bNorm) / delta) %
        6;
    } else if (max === gNorm) {
      h =
        (bNorm - rNorm) /
          delta +
        2;
    } else {
      h =
        (rNorm - gNorm) /
          delta +
        4;
    }

    h = Math.round(h * 60);

    if (h < 0) {
      h += 360;
    }
  }

  const s =
    max === 0
      ? 0
      : Math.round(
          (delta / max) * 1000
        );

  const v =
    Math.round(
      max * 1000
    );

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
  const tuyaValue =
    Math.round(
      (percent / 100) * 1000
    );

  return sendCommands([
    {
      code: "bright_value",
      value: tuyaValue
    }
  ]);
}

async function setWhite(
  warmth,
  brightness
) {
  const tempValue =
    Math.round(
      (warmth / 100) * 1000
    );

  const brightValue =
    Math.round(
      (brightness / 100) * 1000
    );

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
  const colourData =
    hexToHsv(hex);

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

app.get(
  "/debug-functions",
  async (req, res) => {
    try {
      const token =
        await getToken();

      const data =
        await signedRequest(
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
  }
);

app.get(
  "/light/on",
  async (req, res) => {
    try {
      res.json(
        await turnOn()
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

app.get(
  "/light/off",
  async (req, res) => {
    try {
      res.json(
        await turnOff()
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

app.get(
  "/light/brightness",
  async (req, res) => {
    try {
      const percent =
        parseInt(
          req.query.value,
          10
        );

      if (
        isNaN(percent) ||
        percent < 0 ||
        percent > 100
      ) {
        return res.status(400).json({
          error:
            "Paramètre 'value' requis, entre 0 et 100."
        });
      }

      res.json(
        await setBrightness(
          percent
        )
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

app.get(
  "/light/white",
  async (req, res) => {
    try {
      const warmth =
        parseInt(
          req.query.warmth ?? "50",
          10
        );

      const brightness =
        parseInt(
          req.query.brightness ?? "100",
          10
        );

      if (
        isNaN(warmth) ||
        warmth < 0 ||
        warmth > 100
      ) {
        return res.status(400).json({
          error:
            "warmth doit être compris entre 0 et 100."
        });
      }

      if (
        isNaN(brightness) ||
        brightness < 0 ||
        brightness > 100
      ) {
        return res.status(400).json({
          error:
            "brightness doit être compris entre 0 et 100."
        });
      }

      res.json(
        await setWhite(
          warmth,
          brightness
        )
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

app.get(
  "/light/color",
  async (req, res) => {
    try {
      const hex = (
        req.query.hex || ""
      ).replace("#", "");

      if (
        !/^[0-9a-fA-F]{6}$/.test(hex)
      ) {
        return res.status(400).json({
          error:
            "Paramètre 'hex' requis, format RRGGBB, ex: ff0000."
        });
      }

      res.json(
        await setColor(hex)
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

app.get(
  "/",
  (req, res) => {
    res.send(
      "Palmi Smart Home — routes: /light/on, /light/off, /light/brightness?value=0-100, /light/white?warmth=50&brightness=100, /light/color?hex=RRGGBB, /debug-functions"
    );
  }
);

// ============================================================
// SERVEUR
// ============================================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    console.log(
      `Palmi Smart Home lancé sur le port ${PORT}`
    );
  }
);

// ============================================================
// BOT TELEGRAM
// ============================================================

if (TELEGRAM_TOKEN) {
  const bot =
    new TelegramBot(
      TELEGRAM_TOKEN,
      {
        polling: true
      }
    );

  // Les conversations autorisées ayant parlé au bot
  // sont mémorisées pour les notifications automatiques.
  const knownChatIds = new Set(
    ALLOWED_CHAT_IDS
  );

  function isAllowed(chatId) {
    if (
      ALLOWED_CHAT_IDS.length === 0
    ) {
      return true;
    }

    return ALLOWED_CHAT_IDS.includes(
      String(chatId)
    );
  }

  // ==========================================================
  // AUTOMATISATION NUIT
  // ==========================================================

  let lastNightRun = "";

  async function runNightAutomation() {
    if (!automations.night) {
      return;
    }

    try {
      const data =
        await getLightState();

      const statusList =
        data.result || [];

      const switchStatus =
        statusList.find(
          (item) =>
            item.code === "switch_led" ||
            item.code === "switch"
        );

      const isOn =
        switchStatus &&
        switchStatus.value === true;

      if (!isOn) {
        console.log(
          "🌙 Automatisation nuit : lumière déjà éteinte."
        );

        return;
      }

      await turnOff();

      console.log(
        "🌙 Automatisation nuit : lumière éteinte."
      );

      for (
        const chatId of knownChatIds
      ) {
        try {
          await bot.sendMessage(
            chatId,
            "🌙 Tu dors pas ? Tu as sûrement rallumé la lumière.\n" +
              "💡 Je l'éteins pour toi.\n" +
              "Dors bien ! 😴"
          );
        } catch (sendErr) {
          console.error(
            `❌ Impossible d'envoyer la notification à ${chatId} :`,
            sendErr.message
          );
        }
      }
    } catch (err) {
      console.error(
        "❌ Erreur automatisation nuit :",
        err.message
      );
    }
  }

  // Vérification chaque seconde.
  // Europe/Paris gère automatiquement
  // l'heure d'été et l'heure d'hiver.

  setInterval(
    async () => {
      const currentTime =
        getParisTime();

      const currentDate =
        getParisDate();

      const runId =
        `${currentDate}-03:00`;

      if (
        automations.night &&
        currentTime === "03:00" &&
        lastNightRun !== runId
      ) {
        lastNightRun =
          runId;

        await runNightAutomation();
      }
    },
    1000
  );

  console.log(
    "🌙 Automatisations Palmi prêtes — Europe/Paris"
  );

  // ==========================================================
  // COULEURS
  // ==========================================================

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

  // ==========================================================
  // MESSAGES TELEGRAM
  // ==========================================================

  bot.on(
    "message",
    async (msg) => {
      const chatId =
        msg.chat.id;

      const text = (
        msg.text || ""
      )
        .toLowerCase()
        .trim();

      if (
        !isAllowed(chatId)
      ) {
        await bot.sendMessage(
          chatId,
          "⛔ Tu n'es pas autorisé à utiliser ce bot."
        );

        return;
      }

      // Permet aux notifications automatiques
      // d'utiliser ce chat après une interaction.
      knownChatIds.add(
        String(chatId)
      );

      try {
        // ======================================================
        // AUTOMATISATIONS
        // ======================================================

        if (
          text === "/add automation" ||
          text === "/add_automation"
        ) {
          automations.night =
            true;

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
          text === "/automations"
        ) {
          bot.sendMessage(
            chatId,
            "🤖 Automatisations Palmi\n\n" +
              `🌙 Nuit : ${
                automations.night
                  ? "✅ Activée"
                  : "❌ Désactivée"
              }\n` +
              "⏰ 03:00 — Europe/Paris\n" +
              "☀️❄️ Passage été/hiver automatique."
          );

          return;
        }

        if (
          text === "/remove automation" ||
          text === "/remove_automation"
        ) {
          automations.night =
            false;

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
              "• « couleur bleu »\n" +
              "• « couleur vert »\n" +
              "• « couleur jaune »\n" +
              "• « couleur violet »\n" +
              "• « couleur rose »\n" +
              "• « couleur orange »\n" +
              "• « couleur cyan »\n" +
              "• « couleur turquoise »\n\n" +
              "🤖 Automatisations :\n" +
              "• /add automation\n" +
              "• /automations\n" +
              "• /remove automation\n\n" +
              "🌙 Automatisation nuit : 03:00\n" +
              "☀️❄️ Heure été/hiver automatique."
          );

          return;
        }

        // ======================================================
        // ALLUMER
        // ======================================================

        if (
          text.includes("allume")
        ) {
          await turnOn();

          bot.sendMessage(
            chatId,
            "💡 Lumière allumée !"
          );

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

          bot.sendMessage(
            chatId,
            "🌑 Lumière éteinte."
          );

          return;
        }

        // ======================================================
        // MODE BLANC
        // ======================================================

        if (
          text.includes("blanc")
        ) {
          await setWhite(
            50,
            100
          );

          bot.sendMessage(
            chatId,
            "🤍 Lumière en blanc !"
          );

          return;
        }

        // ======================================================
        // LUMINOSITÉ
        // ======================================================

        const brightnessMatch =
          text.match(
            /luminosit[ée]\s*(?:à|a)?\s*(\d+)/
          ) ||
          text.match(
            /(\d+)\s*%/
          );

        if (
          brightnessMatch
        ) {
          const value =
            Math.min(
              100,
              Math.max(
                0,
                parseInt(
                  brightnessMatch[1],
                  10
                )
              )
            );

          await setBrightness(
            value
          );

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
          await setBrightness(
            20
          );

          bot.sendMessage(
            chatId,
            "🔅 Luminosité baissée à 20%."
          );

          return;
        }

        // ======================================================
        // MONTER LUMINOSITÉ
        // ======================================================

        if (
          text.includes("monte") &&
          text.includes("luminosit")
        ) {
          await setBrightness(20);

          bot.sendMessage(
            chatId,
            "🔅 Luminosité baissée à 20%."
          );

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

          bot.sendMessage(
            chatId,
            "🔆 Luminosité montée à 100%."
          );

          return;
        }

        // ======================================================
        // COULEURS NOMMÉES
        // ======================================================

        for (
          const [name, hex] of Object.entries(NAMED_COLORS)
        ) {
          if (text.includes(name)) {
            await setColor(hex);

            bot.sendMessage(
              chatId,
              `🎨 Couleur changée en ${name} !`
            );

            return;
          }
        }

        // ======================================================
        // COULEUR HEX
        // ======================================================

        const hexMatch =
          text.match(/#?([0-9a-f]{6})\b/);

        if (
          hexMatch &&
          text.includes("couleur")
        ) {
          await setColor(hexMatch[1]);

          bot.sendMessage(
            chatId,
            `🎨 Couleur changée en #${hexMatch[1]} !`
          );

          return;
        }

        // ======================================================
        // FIN / AIDE
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
            "• allume ma lumière\n" +
            "• éteins la lumière\n" +
            "• lumière blanche\n" +
            "• luminosité à 50\n" +
            "• couleur rouge\n\n" +
            "🤖 Automatisations :\n" +
            "• /add automation\n" +
            "• /automations\n" +
            "• /remove automation\n\n" +
            "🌙 Automatisation nuit : 03:00\n" +
            "☀️❄️ Heure été/hiver automatique."
          );

          return;
        }

      } catch (err) {
        console.error(
          "❌ Erreur Telegram :",
          err
        );

        bot.sendMessage(
          chatId,
          `❌ Erreur : ${err.message}`
        );
      }
    }
  );

  bot.on(
    "polling_error",
    (err) => {
      console.error(
        "❌ Telegram polling error :",
        err.message
      );
    }
  );

  console.log(
    "🤖 Bot Telegram Palmi Smart Home démarré (polling)."
  );

} else {
  console.log(
    "TELEGRAM_BOT_TOKEN absent, bot Telegram désactivé."
  );
}