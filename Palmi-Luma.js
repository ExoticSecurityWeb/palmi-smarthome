// ============================================================
// PALMI-LUMA — Ampoule connectée Tuya "Luma Séjour Caravane"
// Communication exclusive via Tuya Cloud (aucun contrôle local).
// Réutilise TUYA_ACCESS_ID / TUYA_ACCESS_SECRET déjà configurés
// pour la LED existante. Device ID dédié via TUYA_LUMA_DEVICE_ID.
// ============================================================

const crypto = require("crypto");
const axios = require("axios");
const express = require("express");

const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;

const API_BASE =
  process.env.TUYA_API_BASE ||
  "https://openapi.tuyaeu.com";

const LUMA_DEVICE_ID = process.env.TUYA_LUMA_DEVICE_ID;

// ============================================================
// SIGNATURE TUYA (identique à palmi-smarthome.js)
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

async function getToken() {
  if (!ACCESS_ID || !ACCESS_SECRET) {
    throw new Error(
      "Variables TUYA_ACCESS_ID / TUYA_ACCESS_SECRET manquantes."
    );
  }

  const t = Date.now().toString();
  const url = "/v1.0/token?grant_type=1";
  const stringToSign = buildStringToSign("GET", "", "", url);

  const sign = hmacSha256(
    `${ACCESS_ID}${t}${stringToSign}`,
    ACCESS_SECRET
  );

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
      `Erreur token Tuya (Luma): ${JSON.stringify(res.data)}`
    );
  }

  return res.data.result.access_token;
}

async function signedRequest(method, url, token, body) {
  const t = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const stringToSign = buildStringToSign(method, bodyStr, "", url);

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

function requireLumaDeviceId() {
  if (!LUMA_DEVICE_ID) {
    throw new Error(
      "Variable TUYA_LUMA_DEVICE_ID manquante."
    );
  }
}

// ============================================================
// HEX -> HSV (identique à palmi-smarthome.js)
// ============================================================

function hexToHsv(hex) {
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }

    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  return {
    h,
    s: max === 0 ? 0 : Math.round((delta / max) * 1000),
    v: Math.round(max * 1000)
  };
}

// ============================================================
// FONCTIONS TUYA GÉNÉRIQUES
// ============================================================

async function sendCommands(commands) {
  requireLumaDeviceId();

  const token = await getToken();
  const url = `/v1.0/devices/${LUMA_DEVICE_ID}/commands`;

  return signedRequest("POST", url, token, { commands });
}

async function getLumaStatus() {
  requireLumaDeviceId();

  const token = await getToken();
  const url = `/v1.0/devices/${LUMA_DEVICE_ID}/status`;

  return signedRequest("GET", url, token);
}

// Permet de vérifier les DPS réellement supportés par Luma
// avant de s'appuyer dessus (ne jamais supposer les codes).
async function getLumaFunctions() {
  requireLumaDeviceId();

  const token = await getToken();
  const url = `/v1.0/devices/${LUMA_DEVICE_ID}/functions`;

  return signedRequest("GET", url, token);
}

// ============================================================
// COMMANDES LUMA
// Codes DPS alignés sur ceux de la LED existante (catégorie
// Tuya "dj" — ampoule/strip standard). À confirmer via
// GET /luma/debug-functions avant mise en prod : si un code
// diffère, adapter uniquement les valeurs ci-dessous.
// ============================================================

async function turnOnLuma() {
  return sendCommands([{ code: "switch_led", value: true }]);
}

async function turnOffLuma() {
  return sendCommands([{ code: "switch_led", value: false }]);
}

async function setBrightnessLuma(percent) {
  return sendCommands([
    {
      code: "bright_value",
      value: Math.round((percent / 100) * 1000)
    }
  ]);
}

async function setWhiteLuma(warmth, brightness) {
  return sendCommands([
    { code: "work_mode", value: "white" },
    {
      code: "temp_value",
      value: Math.round((warmth / 100) * 1000)
    },
    {
      code: "bright_value",
      value: Math.round((brightness / 100) * 1000)
    }
  ]);
}

async function setColorLuma(hex) {
  return sendCommands([
    { code: "work_mode", value: "colour" },
    { code: "colour_data", value: hexToHsv(hex) }
  ]);
}

// ============================================================
// ROUTES HTTP OPTIONNELLES (montées via app.use("/luma", ...))
// ============================================================

const router = express.Router();

router.get("/debug-functions", async (req, res) => {
  try {
    res.json(await getLumaFunctions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/status", async (req, res) => {
  try {
    res.json(await getLumaStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/on", async (req, res) => {
  try {
    res.json(await turnOnLuma());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/off", async (req, res) => {
  try {
    res.json(await turnOffLuma());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/brightness", async (req, res) => {
  try {
    const percent = parseInt(req.query.value, 10);

    if (Number.isNaN(percent) || percent < 0 || percent > 100) {
      return res.status(400).json({
        error: "Paramètre 'value' requis, entre 0 et 100."
      });
    }

    res.json(await setBrightnessLuma(percent));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/white", async (req, res) => {
  try {
    const warmth = parseInt(req.query.warmth ?? "50", 10);
    const brightness = parseInt(req.query.brightness ?? "100", 10);

    res.json(await setWhiteLuma(warmth, brightness));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/color", async (req, res) => {
  try {
    const hex = (req.query.hex || "").replace("#", "");

    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      return res.status(400).json({
        error: "Paramètre 'hex' requis, format RRGGBB, ex: ff0000."
      });
    }

    res.json(await setColorLuma(hex));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router,
  turnOnLuma,
  turnOffLuma,
  setBrightnessLuma,
  setWhiteLuma,
  setColorLuma,
  getLumaStatus,
  getLumaFunctions
};
