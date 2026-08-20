// Railway sync 2026-08-15 — VERSION CORRIGÉE

const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const http = require("http");

const app = express();
app.use(express.json());

// ============================================================
// CONFIGURATION
// ============================================================

const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;

const API_BASE =
  process.env.TUYA_API_BASE ||
  "https://openapi.tuyaeu.com";

const DEVICE_ID =
  process.env.TUYA_DEVICE_ID ||
  "bf7d9913dd42da28899bnq";

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const ALLOWED_CHAT_IDS = (
  process.env.TELEGRAM_ALLOWED_CHAT_IDS || ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const AUTOMATIONS_FILE = path.join(
  __dirname,
  "automations.json"
);

// ============================================================
// AUTOMATISATIONS
// ============================================================

const automations = {
  night: true,
  custom: []
};

const automationCreation = {};

function loadAutomations() {
  try {
    if (!fs.existsSync(AUTOMATIONS_FILE)) {
      return;
    }

    const data = JSON.parse(
      fs.readFileSync(
        AUTOMATIONS_FILE,
        "utf8"
      )
    );

    if (typeof data.night === "boolean") {
      automations.night = data.night;
    }

    if (Array.isArray(data.custom)) {
      automations.custom = data.custom;
    }
  } catch (err) {
    console.error(
      "❌ Impossible de charger les automatisations :",
      err.message
    );
  }
}

function saveAutomations() {
  try {
    fs.writeFileSync(
      AUTOMATIONS_FILE,
      JSON.stringify(
        automations,
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    console.error(
      "❌ Impossible de sauvegarder les automatisations :",
      err.message
    );
  }
}

loadAutomations();

// ============================================================
// HEURE EUROPE/PARIS
// ============================================================

function getParisParts() {
  const parts =
    new Intl.DateTimeFormat(
      "fr-FR",
      {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }
    ).formatToParts(new Date());

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  return result;
}

function getParisTime() {
  const p = getParisParts();
  return `${p.hour}:${p.minute}`;
}

function getParisDate() {
  const p = getParisParts();
  return `${p.year}-${p.month}-${p.day}`;
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
  const contentSha256 =
    sha256(body || "");

  return `${method}\n${contentSha256}\n${headersStr}\n${url}`;
}

// ============================================================
// AUTHENTIFICATION TUYA
// ============================================================

async function getToken() {
  if (
    !ACCESS_ID ||
    !ACCESS_SECRET
  ) {
    throw new Error(
      "Variables TUYA_ACCESS_ID / TUYA_ACCESS_SECRET manquantes."
    );
  }

  const t = Date.now().toString();

  const url =
    "/v1.0/token?grant_type=1";

  const stringToSign =
    buildStringToSign(
      "GET",
      "",
      "",
      url
    );

  const sign =
    hmacSha256(
      `${ACCESS_ID}${t}${stringToSign}`,
      ACCESS_SECRET
    );

  const res =
    await axios.get(
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
      `Erreur token Tuya: ${JSON.stringify(
        res.data
      )}`
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
  const t =
    Date.now().toString();

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

  const sign =
    hmacSha256(
      `${ACCESS_ID}${token}${t}${stringToSign}`,
      ACCESS_SECRET
    );

  const res =
    await axios({
      method,
      url:
        `${API_BASE}${url}`,

      headers: {
        client_id: ACCESS_ID,
        access_token: token,
        sign,
        t,
        sign_method: "HMAC-SHA256",
        "Content-Type":
          "application/json"
      },

      data:
        body || undefined
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
// ETAT LED
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
  const r =
    parseInt(
      hex.substring(0, 2),
      16
    ) / 255;

  const g =
    parseInt(
      hex.substring(2, 4),
      16
    ) / 255;

  const b =
    parseInt(
      hex.substring(4, 6),
      16
    ) / 255;

  const max =
    Math.max(r, g, b);

  const min =
    Math.min(r, g, b);

  const delta =
    max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === r) {
      h =
        ((g - b) / delta) % 6;
    } else if (max === g) {
      h =
        (b - r) / delta + 2;
    } else {
      h =
        (r - g) / delta + 4;
    }

    h =
      Math.round(h * 60);

    if (h < 0) {
      h += 360;
    }
  }

  return {
    h,
    s:
      max === 0
        ? 0
        : Math.round(
            (delta / max) * 1000
          ),
    v:
      Math.round(
        max * 1000
      )
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
  return sendCommands([
    {
      code: "bright_value",
      value:
        Math.round(
          (percent / 100) * 1000
        )
    }
  ]);
}

async function setWhite(
  warmth,
  brightness
) {
  return sendCommands([
    {
      code: "work_mode",
      value: "white"
    },
    {
      code: "temp_value",
      value:
        Math.round(
          (warmth / 100) * 1000
        )
    },
    {
      code: "bright_value",
      value:
        Math.round(
          (brightness / 100) * 1000
        )
    }
  ]);
}

async function setColor(hex) {
  return sendCommands([
    {
      code: "work_mode",
      value: "colour"
    },
    {
      code: "colour_data",
      value: hexToHsv(hex)
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
        Number.isNaN(percent) ||
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
        Number.isNaN(warmth) ||
        warmth < 0 ||
        warmth > 100
      ) {
        return res.status(400).json({
          error:
            "warmth doit être compris entre 0 et 100."
        });
      }

      if (
        Number.isNaN(brightness) ||
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
      const hex =
        (
          req.query.hex ||
          ""
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

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(
    `Palmi Smart Home lancé sur le port ${PORT}`
  );
});

// ============================================================
// PONT TV — WebSocket Railway <-> Termux (A10)
// ============================================================

const VALID_TV_ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "ok",
  "back",
  "home",
  "volume_up",
  "volume_down",
  "mute",
  "power"
];

const TV_BRIDGE_TOKEN = process.env.PALMI_TV_BRIDGE_TOKEN;
let tvGatewaySocket = null;
const pendingTvCommands = new Map();

const wssTv = new WebSocketServer({ noServer: true });

wssTv.on("connection", (ws, req) => {
  const token = new URL(req.url, "http://localhost").searchParams.get("token");

  if (!TV_BRIDGE_TOKEN || token !== TV_BRIDGE_TOKEN) {
    console.log("Connexion TV Bridge refusee (token invalide).");
    ws.close(4001, "Token invalide");
    return;
  }

  console.log("TV Bridge connectee (Termux).");
  tvGatewaySocket = ws;

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === "tv_result" && data.id && pendingTvCommands.has(data.id)) {
        const pending = pendingTvCommands.get(data.id);
        clearTimeout(pending.timeout);
        pendingTvCommands.delete(data.id);
        if (data.success) pending.resolve(data);
        else pending.reject(new Error(data.error || "Erreur TV inconnue"));
      }
    } catch (err) {
      console.error("Message TV Bridge invalide :", err.message);
    }
  });

  ws.on("close", () => {
    console.log("TV Bridge deconnectee (Termux).");
    if (tvGatewaySocket === ws) tvGatewaySocket = null;
  });

  ws.on("error", (err) => {
    console.error("Erreur WebSocket TV Bridge :", err.message);
  });
});

function sendTvCommand(action, count = 1) {
  return new Promise((resolve, reject) => {
    if (!VALID_TV_ACTIONS.includes(action)) {
      return reject(new Error(`Commande TV invalide : ${action}`));
    }

    if (!tvGatewaySocket || tvGatewaySocket.readyState !== 1) {
      return reject(new Error("La TV Bridge (Termux) n'est pas connectee."));
    }

    const id = Date.now().toString() + Math.random().toString(36).slice(2, 7);
    const payload = { type: "tv_command", id, action, count };

    const timeout = setTimeout(() => {
      pendingTvCommands.delete(id);
      reject(new Error("Timeout : pas de reponse de la TV Bridge."));
    }, 10000);

    pendingTvCommands.set(id, { resolve, reject, timeout });
    tvGatewaySocket.send(JSON.stringify(payload));
  });
}

// ============================================================
// PONT CAST — WebSocket Railway <-> Termux
// ============================================================

const CAST_BRIDGE_TOKEN =
  process.env.PALMI_CAST_BRIDGE_TOKEN;

let castGatewaySocket = null;

const pendingCastCommands =
  new Map();

const wssCast =
  new WebSocketServer({
    noServer: true
  });

wssCast.on(
  "connection",
  (ws, req) => {
    const token =
      new URL(
        req.url,
        "http://localhost"
      )
        .searchParams
        .get("token");

    if (
      !CAST_BRIDGE_TOKEN ||
      token !== CAST_BRIDGE_TOKEN
    ) {
      console.log(
        "Connexion Cast Bridge refusee (token invalide)."
      );

      ws.close(
        4001,
        "Token invalide"
      );

      return;
    }

    console.log(
      "Cast Bridge connectee (Termux)."
    );

    castGatewaySocket = ws;

    ws.on(
      "message",
      (raw) => {
        try {
          const data =
            JSON.parse(
              raw.toString()
            );

          if (
            data.type ===
              "cast_result" &&
            data.id &&
            pendingCastCommands.has(
              data.id
            )
          ) {
            const pending =
              pendingCastCommands.get(
                data.id
              );

            clearTimeout(
              pending.timeout
            );

            pendingCastCommands.delete(
              data.id
            );

            if (data.success) {
              pending.resolve(
                data
              );
            } else {
              pending.reject(
                new Error(
                  data.error ||
                    "Erreur Cast inconnue"
                )
              );
            }
          }
        } catch (err) {
          console.error(
            "Message Cast Bridge invalide :",
            err.message
          );
        }
      }
    );

    ws.on(
      "close",
      () => {
        console.log(
          "Cast Bridge deconnectee (Termux)."
        );

        if (
          castGatewaySocket ===
          ws
        ) {
          castGatewaySocket =
            null;
        }
      }
    );

    ws.on(
      "error",
      (err) => {
        console.error(
          "Erreur WebSocket Cast Bridge :",
          err.message
        );
      }
    );
  }
);

// ============================================================
// ROUTEUR WEBSOCKET
// ============================================================

server.on(
  "upgrade",
  (req, socket, head) => {
    const {
      pathname
    } = new URL(
      req.url,
      "http://localhost"
    );

    if (
      pathname ===
      "/cast-bridge"
    ) {
      wssCast.handleUpgrade(
        req,
        socket,
        head,
        (ws) => {
          wssCast.emit(
            "connection",
            ws,
            req
          );
        }
      );
    } else if (
      pathname ===
      "/tv-bridge"
    ) {
      wssTv.handleUpgrade(
        req,
        socket,
        head,
        (ws) => {
          wssTv.emit(
            "connection",
            ws,
            req
          );
        }
      );
    } else {
      socket.destroy();
    }
  }
);

const VALID_CAST_ACTIONS = [
  "play",
  "pause",
  "stop",
  "volume_up",
  "volume_down",
  "mute",
  "youtube"
];

function sendCastCommand(
  action,
  param
) {
  return new Promise(
    (resolve, reject) => {
      if (
        !castGatewaySocket ||
        castGatewaySocket.readyState !==
          1
      ) {
        return reject(
          new Error(
            "La Cast Bridge (Termux) n'est pas connectee."
          )
        );
      }

      const id =
        Date.now().toString() +
        Math.random()
          .toString(36)
          .slice(2, 7);

      const payload = {
        type: "cast_command",
        id,
        action,
        param
      };

      const timeout =
        setTimeout(
          () => {
            pendingCastCommands.delete(
              id
            );

            reject(
              new Error(
                "Timeout : pas de reponse de la Cast Bridge (le chargement YouTube peut prendre du temps)."
              )
            );
          },
          25000
        );

      pendingCastCommands.set(
        id,
        {
          resolve,
          reject,
          timeout
        }
      );

      castGatewaySocket.send(
        JSON.stringify(payload)
      );
    }
  );
}// ============================================================
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

  const knownChatIds =
    new Set(
      ALLOWED_CHAT_IDS
    );

  function isAllowed(chatId) {
    return (
      ALLOWED_CHAT_IDS.length === 0 ||
      ALLOWED_CHAT_IDS.includes(
        String(chatId)
      )
    );
  }

  function rememberChat(chatId) {
    knownChatIds.add(
      String(chatId)
    );
  }

  async function notifyAll(message) {
    for (
      const chatId of knownChatIds
    ) {
      try {
        await bot.sendMessage(
          chatId,
          message
        );
      } catch (err) {
        console.error(
          `❌ Notification ${chatId}:`,
          err.message
        );
      }
    }
  }

  // ==========================================================
  // AUTOMATISATION 03:00
  // ==========================================================

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
            item.code ===
              "switch_led" ||
            item.code ===
              "switch"
        );

      const isOn =
        switchStatus &&
        switchStatus.value === true;

      if (!isOn) {
        console.log(
          "🌙 03:00 : lumière déjà éteinte."
        );

        return;
      }

      await turnOff();

      await notifyAll(
        "🌙 Tu dors pas ? Tu as sûrement rallumé la lumière.\n" +
          "💡 Je l'éteins pour toi.\n" +
          "Dors bien ! 😴"
      );
    } catch (err) {
      console.error(
        "❌ Erreur automatisation 03:00 :",
        err.message
      );
    }
  }

  // ==========================================================
  // AUTOMATISATION 02:00
  // ==========================================================

  async function run02Automation() {
    try {
      await turnOff();

      await notifyAll(
        "🌙 Oh, Palmi a vu que la lumière était allumée, je l'ai éteinte pour toi. Bonne nuit ! 🌙"
      );
    } catch (err) {
      console.error(
        "❌ Erreur automatisation 02:00 :",
        err.message
      );
    }
  }

  // ==========================================================
  // AUTOMATISATION 00:36
  // ==========================================================

  async function run0036Automation() {
    try {
      await setBrightness(30);

      await notifyAll(
        "Bonne nuit ! Palmi 🌴 baisse la luminosité de la lumière. Extinction automatique à 2h ⏰. Si elle est rallumée, nouvelle tentative à 3h"
      );
    } catch (err) {
      console.error(
        "❌ Erreur automatisation 00:36 :",
        err.message
      );
    }
  }

  // ==========================================================
  // AUTOMATISATION 19:15
  // ==========================================================

  async function runDinnerAutomation() {
    try {
      await turnOn();

      await setBrightness(100);

      await notifyAll(
        "🍽️ Il est l'heure du dîner ! Palmi a allumé la lumière à 100 %. 🌴💡"
      );
    } catch (err) {
      console.error(
        "❌ Erreur automatisation dîner :",
        err.message
      );
    }
  }

  // ==========================================================
  // AUTOMATISATIONS PERSONNALISEES
  // ==========================================================

  async function runCustomAutomations(
    currentTime,
    runId
  ) {
    for (
      const automation of
        automations.custom
    ) {
      if (
        automation.enabled === false ||
        automation.time !== currentTime
      ) {
        continue;
      }

      if (
        automation.lastRun === runId
      ) {
        continue;
      }

      automation.lastRun =
        runId;

      await notifyAll(
        `🌴 ${automation.message}`
      );

      saveAutomations();
    }
  }

  // ==========================================================
  // SCHEDULER
  // ==========================================================

  const fixedRuns =
    new Set();

  setInterval(
    async () => {
      const currentTime =
        getParisTime();

      const date =
        getParisDate();

      try {
        if (
          currentTime === "00:36" &&
          !fixedRuns.has(
            `${date}-0036`
          )
        ) {
          fixedRuns.add(
            `${date}-0036`
          );

          await run0036Automation();
        }

        if (
          currentTime === "02:00" &&
          !fixedRuns.has(
            `${date}-0200`
          )
        ) {
          fixedRuns.add(
            `${date}-0200`
          );

          await run02Automation();
        }

        if (
          currentTime === "03:00" &&
          !fixedRuns.has(
            `${date}-0300`
          )
        ) {
          fixedRuns.add(
            `${date}-0300`
          );

          await runNightAutomation();
        }

        if (
          currentTime === "19:15" &&
          !fixedRuns.has(
            `${date}-1915`
          )
        ) {
          fixedRuns.add(
            `${date}-1915`
          );

          await runDinnerAutomation();
        }

        await runCustomAutomations(
          currentTime,
          `${date}-${currentTime}`
        );
      } catch (err) {
        console.error(
          "❌ Erreur scheduler :",
          err.message
        );
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
  // BOT TELEGRAM
  // ==========================================================

  bot.on(
    "message",
    async (msg) => {
      const chatId =
        msg.chat.id;

      const text =
        (
          msg.text ||
          ""
        ).trim();

      const lowerText =
        text.toLowerCase();

      if (!isAllowed(chatId)) {
        await bot.sendMessage(
          chatId,
          "⛔ Tu n'es pas autorisé à utiliser ce bot."
        );

        return;
      }

      rememberChat(chatId);

      // ======================================================
      // COMMANDES TV
      // ======================================================

      if (text.startsWith("/tv")) {
        const TV_FRENCH_ALIASES = {
          "haut": "up",
          "monter": "up",
          "bas": "down",
          "descendre": "down",
          "gauche": "left",
          "droite": "right",
          "valider": "ok",
          "retour": "back",
          "accueil": "home",
          "maison": "home",
          "volume_plus": "volume_up",
          "volume+": "volume_up",
          "volume_moins": "volume_down",
          "volume-": "volume_down",
          "muet": "mute",
          "silence": "mute",
          "eteindre": "power",
          "éteindre": "power",
          "allumer": "power",
          "power": "power"
        };

        const parts =
          text
            .split(/\s+/)
            .slice(1);

        const rawAction =
          (
            parts[0] || ""
          ).toLowerCase();

        const action =
          TV_FRENCH_ALIASES[
            rawAction
          ] || rawAction;

        let count =
          parseInt(
            parts[1],
            10
          );

        if (
          !VALID_TV_ACTIONS.includes(
            action
          )
        ) {
          await bot.sendMessage(
            chatId,
            "Commande TV invalide.\n\n" +
              "Utilise : /tv [action] [nombre optionnel]\n\n" +
              "Actions en francais : haut, bas, gauche, droite, valider, retour, accueil, volume_plus, volume_moins, muet\n" +
              "Actions en anglais : up, down, left, right, ok, back, home, volume_up, volume_down, mute"
          );

          return;
        }

        if (
          isNaN(count) ||
          count < 1
        ) {
          count = 1;
        }

        if (count > 10) {
          count = 10;
        }

        try {
          await sendTvCommand(
            action,
            count
          );

          await bot.sendMessage(
            chatId,
            `Commande envoyee : ${action} x${count}`
          );
        } catch (err) {
          await bot.sendMessage(
            chatId,
            `Erreur : ${err.message}`
          );
        }

        return;
      }

      // ======================================================
      // COMMANDES CAST
      // ======================================================

      if (text.startsWith("/cast")) {
        const parts =
          text
            .split(/\s+/)
            .slice(1);

        const rawAction =
          (
            parts[0] || ""
          ).toLowerCase();

        const CAST_FRENCH_ALIASES = {
          "lecture": "play",
          "jouer": "play",
          "pause": "pause",
          "stop": "stop",
          "arreter": "stop",
          "arrêter": "stop",
          "volume_plus": "volume_up",
          "volume+": "volume_up",
          "volume_moins": "volume_down",
          "volume-": "volume_down",
          "muet": "mute",
          "silence": "mute",
          "youtube": "youtube"
        };

        const action =
          CAST_FRENCH_ALIASES[
            rawAction
          ] || rawAction;

        if (
          !VALID_CAST_ACTIONS.includes(
            action
          )
        ) {
          await bot.sendMessage(
            chatId,
            "Commande Cast invalide.\n\n" +
              "Utilise :\n" +
              "/cast play (ou lecture)\n" +
              "/cast pause\n" +
              "/cast stop (ou arreter)\n" +
              "/cast volume_plus\n" +
              "/cast volume_moins\n" +
              "/cast muet\n" +
              "/cast youtube <url ou id video>"
          );

          return;
        }

        let param = null;

        if (
          action === "youtube"
        ) {
          param =
            text
              .split(/\s+/)
              .slice(2)
              .join(" ");

          if (!param) {
            await bot.sendMessage(
              chatId,
              "Donne une URL ou un ID YouTube.\n\nExemple : /cast youtube https://youtu.be/abc123"
            );

            return;
          }
        }

        try {
          if (
            action === "youtube"
          ) {
            await bot.sendMessage(
              chatId,
              "Extraction et lancement de la video, patiente quelques secondes..."
            );
          }

          await sendCastCommand(
            action,
            param
          );

          await bot.sendMessage(
            chatId,
            `Commande Cast envoyee : ${action}`
          );
        } catch (err) {
          await bot.sendMessage(
            chatId,
            `Erreur : ${err.message}`
          );
        }

        return;
      }

      try {
        // ======================================================
        // /CANCEL
        // ======================================================

        if (
          lowerText === "/cancel" ||
          lowerText === "/annuler" ||
          lowerText === "annuler"
        ) {
          delete automationCreation[
            chatId
          ];

          await bot.sendMessage(
            chatId,
            "❌ Création de l'automatisation annulée."
          );

          return;
        }

        // ======================================================
        // COMMANDES LUMIERE PRIORITAIRES
        // ======================================================

        const wantsOff =
          (
            lowerText.includes("éteins") ||
            lowerText.includes("eteins") ||
            lowerText.includes("éteint") ||
            lowerText.includes("eteint") ||
            lowerText.includes("éteindre") ||
            lowerText.includes("eteindre")
          ) &&
          (
            lowerText.includes("lumière") ||
            lowerText.includes("lumiere")
          );

        if (wantsOff) {
          delete automationCreation[
            chatId
          ];

          await turnOff();

          await bot.sendMessage(
            chatId,
            "💡 Lumière éteinte ! 🌴"
          );

          return;
        }

        const wantsOn =
          lowerText.includes(
            "allume"
          ) &&
          (
            lowerText.includes("lumière") ||
            lowerText.includes("lumiere")
          );

        if (wantsOn) {
          delete automationCreation[
            chatId
          ];

          await turnOn();

          await bot.sendMessage(
            chatId,
            "💡 Lumière allumée ! 🌴"
          );

          return;
        }

        const brightnessMatch =
          lowerText.match(
            /(?:luminosité|luminosite).*?(\d{1,3})/
          );

        if (brightnessMatch) {
          const percent =
            parseInt(
              brightnessMatch[1],
              10
            );

          if (
            percent >= 0 &&
            percent <= 100
          ) {
            delete automationCreation[
              chatId
            ];

            await setBrightness(
              percent
            );

            await bot.sendMessage(
              chatId,
              `💡 Luminosité réglée à ${percent} %.`
            );

            return;
          }
        }

        if (
          lowerText.includes(
            "baisse la luminosité"
          ) ||
          lowerText.includes(
            "baisse la luminosite"
          )
        ) {
          delete automationCreation[
            chatId
          ];

          await setBrightness(
            30
          );

          await bot.sendMessage(
            chatId,
            "💡 Luminosité baissée à 30 %. 🌴"
          );

          return;
        }

        if (
          lowerText.includes(
            "monte la luminosité"
          ) ||
          lowerText.includes(
            "monte la luminosite"
          )
        ) {
          delete automationCreation[
            chatId
          ];

          await setBrightness(
            100
          );

          await bot.sendMessage(
            chatId,
            "💡 Luminosité montée à 100 %. 🌴"
          );

          return;
        }

        if (
          lowerText.includes(
            "lumière blanche"
          ) ||
          lowerText.includes(
            "lumiere blanche"
          )
        ) {
          delete automationCreation[
            chatId
          ];

          await setWhite(
            50,
            100
          );

          await bot.sendMessage(
            chatId,
            "🤍 Lumière blanche activée !"
          );

          return;
        }

        for (
          const [
            name,
            hex
          ] of Object.entries(
            NAMED_COLORS
          )
        ) {
          if (
            lowerText.includes(
              `couleur ${name}`
            )
          ) {
            delete automationCreation[
              chatId
            ];

            await setColor(
              hex
            );

            await bot.sendMessage(
              chatId,
              `🎨 Couleur ${name} activée ! 🌴`
            );

            return;
          }
        }        // ======================================================
        // CREATION AUTOMATISATION
        // ======================================================

        const creation =
          automationCreation[
            chatId
          ];

        if (creation) {
          if (
            creation.step === "name"
          ) {
            creation.name =
              text;

            creation.step =
              "time";

            await bot.sendMessage(
              chatId,
              "⏰ À quelle heure doit-elle s'exécuter ?\n\n" +
                "Exemple : 19:15\n\n" +
                "❌ Pour annuler : /cancel"
            );

            return;
          }

          if (
            creation.step === "time"
          ) {
            const cleanTime =
              text
                .trim()
                .replace(
                  ".",
                  ":"
                );

            if (
              !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(
                cleanTime
              )
            ) {
              await bot.sendMessage(
                chatId,
                "❌ Heure invalide.\n\n" +
                  "Utilise le format HH:MM.\n" +
                  "Exemple : 19:15\n\n" +
                  "❌ Pour annuler : /cancel"
              );

              return;
            }

            creation.time =
              cleanTime;

            creation.step =
              "description";

            await bot.sendMessage(
              chatId,
              "📝 Décris ce que cette automatisation doit faire."
            );

            return;
          }

          if (
            creation.step ===
            "description"
          ) {
            creation.description =
              text;

            creation.step =
              "message";

            await bot.sendMessage(
              chatId,
              "💬 Quel message Palmi doit-il envoyer quand l'automatisation s'exécute ?"
            );

            return;
          }

          if (
            creation.step ===
            "message"
          ) {
            const automation = {
              id:
                Date.now().toString(),

              name:
                creation.name,

              time:
                creation.time,

              description:
                creation.description,

              message:
                text,

              enabled:
                true
            };

            automations.custom.push(
              automation
            );

            delete automationCreation[
              chatId
            ];

            saveAutomations();

            await bot.sendMessage(
              chatId,
              "✅ Automatisation créée !\n\n" +
                "🌴 Nom : " +
                automation.name +
                "\n" +
                "⏰ Heure : " +
                automation.time +
                "\n" +
                "📝 Description : " +
                automation.description +
                "\n" +
                "💬 Message : " +
                automation.message
            );

            return;
          }

          if (
            creation.step === "remove"
          ) {
            const index =
              parseInt(
                text,
                10
              ) - 1;

            if (
              Number.isNaN(index) ||
              index < 0 ||
              index >=
                automations.custom.length
            ) {
              await bot.sendMessage(
                chatId,
                "❌ Numéro invalide."
              );

              return;
            }

            const removed =
              automations.custom.splice(
                index,
                1
              )[0];

            delete automationCreation[
              chatId
            ];

            saveAutomations();

            await bot.sendMessage(
              chatId,
              "🗑️ Automatisation supprimée !\n\n" +
                "🌴 " +
                removed.name
            );

            return;
          }
        }

        // ======================================================
        // /ADD
        // ======================================================

        if (
          lowerText === "/add" ||
          lowerText ===
            "/add_automation" ||
          lowerText ===
            "/add automation"
        ) {
          automationCreation[
            chatId
          ] = {
            step: "name"
          };

          await bot.sendMessage(
            chatId,
            "🌴 Palmi va créer une nouvelle automatisation !\n\n" +
              "🏷️ Donne-moi le nom de ton automatisation.\n" +
              "Exemple : Dîner 🍽️\n\n" +
              "❌ Pour annuler : /cancel"
          );

          return;
        }

        // ======================================================
        // /AUTOMATIONS
        // ======================================================

        if (
          lowerText ===
          "/automations"
        ) {
          let message =
            "🤖🌴 Automatisations Palmi\n\n";

          message +=
            `🌙 Nuit 03:00 : ${
              automations.night
                ? "✅ Activée"
                : "❌ Désactivée"
            }\n`;

          message +=
            "⏰ 00:36 : baisse à 30 %\n";

          message +=
            "⏰ 02:00 : extinction\n";

          message +=
            "⏰ 19:15 : lumière à 100 % + notification\n\n";

          if (
            automations.custom.length ===
            0
          ) {
            message +=
              "🌴 Aucune automatisation personnalisée.\n\n" +
              "Utilise /add pour en créer une.";
          } else {
            message +=
              "📋 Automatisations personnalisées :\n\n";

            automations.custom.forEach(
              (
                automation,
                index
              ) => {
                message +=
                  `${index + 1}. 🌴 ${automation.name}\n` +
                  `⏰ ${automation.time}\n` +
                  `📝 ${automation.description}\n\n`;
              }
            );
          }

          await bot.sendMessage(
            chatId,
            message
          );

          return;
        }

        // ======================================================
        // /REMOVE
        // ======================================================

        if (
          lowerText === "/remove" ||
          lowerText ===
            "/remove_automation" ||
          lowerText ===
            "/remove automation"
        ) {
          if (
            automations.custom.length ===
            0
          ) {
            await bot.sendMessage(
              chatId,
              "🌴 Tu n'as aucune automatisation personnalisée à supprimer."
            );

            return;
          }

          let message =
            "🗑️ Quelle automatisation personnalisée veux-tu supprimer ?\n\n";

          automations.custom.forEach(
            (
              automation,
              index
            ) => {
              message +=
                `${index + 1}. ${automation.name} — ${automation.time}\n`;
            }
          );

          message +=
            "\nRéponds avec le numéro.";

          automationCreation[
            chatId
          ] = {
            step: "remove"
          };

          await bot.sendMessage(
            chatId,
            message
          );

          return;
        }

        // ======================================================
        // AUTOMATISATION NUIT
        // ======================================================

        if (
          lowerText ===
            "/add automation" ||
          lowerText ===
            "/add_automation"
        ) {
          automations.night =
            true;

          saveAutomations();

          await bot.sendMessage(
            chatId,
            "🌙 Automatisation nuit activée !\n\n" +
              "⏰ Tous les jours à 03:00 (heure de Paris)\n" +
              "💡 Si la lumière est allumée, Palmi l'éteindra.\n" +
              "😴 Puis Palmi t'enverra son message."
          );

          return;
        }

        if (
          lowerText ===
          "/remove automation"
        ) {
          automations.night =
            false;

          saveAutomations();

          await bot.sendMessage(
            chatId,
            "🌙 Automatisation nuit désactivée."
          );

          return;
        }

        // ======================================================
        // /START / HELP
        // ======================================================

        if (
          lowerText === "/start" ||
          lowerText === "/help" ||
          lowerText === "aide"
        ) {
          await bot.sendMessage(
            chatId,
            "👋 Salut ! Je suis Palmi Smart Home 🌴🤖\n\n" +
              "💡 Commandes lumière :\n" +
              "• allume ma lumière\n" +
              "• éteins la lumière\n" +
              "• luminosité à 50\n" +
              "• baisse la luminosité\n" +
              "• monte la luminosité\n" +
              "• lumière blanche\n" +
              "• couleur rouge/bleu/vert/etc.\n\n" +
              "📺 Commandes TV (francais ou anglais) :\n" +
              "• /tv haut / up [nombre]\n" +
              "• /tv bas / down [nombre]\n" +
              "• /tv gauche / left [nombre]\n" +
              "• /tv droite / right [nombre]\n" +
              "• /tv valider / ok\n" +
              "• /tv retour / back\n" +
              "• /tv accueil / home\n" +
              "• /tv volume_plus / volume_up [nombre]\n" +
              "• /tv volume_moins / volume_down [nombre]\n" +
              "• /tv muet / mute\n\n" +
              "📽️ Commandes Chromecast :\n" +
              "• /cast play (ou lecture)\n" +
              "• /cast pause\n" +
              "• /cast stop (ou arreter)\n" +
              "• /cast volume_plus\n" +
              "• /cast volume_moins\n" +
              "• /cast muet\n" +
              "• /cast youtube <url ou id>\n" +
              "   Exemple : /cast youtube https://youtu.be/h4T2X2x7RFU\n" +
              "   Colle simplement le lien YouTube (partagé depuis l'app ou copié dans la barre d'adresse), les paramètres en trop (?si=...) sont ignorés automatiquement.\n\n" +
              "🤖 Automatisations :\n" +
              "• /add — créer une automatisation\n" +
              "• /automations — voir les automatisations\n" +
              "• /remove — supprimer une automatisation\n" +
              "• /cancel — annuler une création"
          );

          return;
        }

        // ======================================================
        // MESSAGE INCOMPRIS
        // ======================================================

        await bot.sendMessage(
          chatId,
          "🌴 Je n'ai pas compris. Utilise /help pour voir les commandes."
        );
      } catch (err) {
        console.error(
          "❌ Erreur Telegram :",
          err
        );

        try {
          await bot.sendMessage(
            chatId,
            `❌ Une erreur est survenue : ${err.message}`
          );
        } catch (sendErr) {
          console.error(
            "❌ Impossible d'envoyer l'erreur Telegram :",
            sendErr.message
          );
        }
      }
    }
  );

  console.log(
    "🤖 Bot Telegram Palmi connecté."
  );
} else {
  console.log(
    "⚠️ TELEGRAM_BOT_TOKEN absent : bot Telegram désactivé."
  );
}