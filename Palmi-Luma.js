// ============================================================
// PALMI-LUMA — Ampoule connectée Tuya "Luma Séjour Caravane"
// Communication exclusive via Tuya Cloud (aucun contrôle local).
// Réutilise TUYA_ACCESS_ID / TUYA_ACCESS_SECRET déjà configurés
// pour la LED existante. Device ID dédié via TUYA_LUMA_DEVICE_ID.
//
// PRINTER :
// printer.js est un module externe.
// Luma l'appelle directement via handlePrinterVoiceCommand().
// printer.js parle lui-même au bridge local (sur le PC) pour
// l'impression réelle et les niveaux d'encre réels.
// Aucune route /luma/printer/... n'est créée.
// ============================================================

const crypto = require("crypto");
const axios = require("axios");
const express = require("express");

const printer = require("./printer");

const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;

const API_BASE =
  process.env.TUYA_API_BASE ||
  "https://openapi.tuyaeu.com";

const LUMA_DEVICE_ID =
  process.env.TUYA_LUMA_DEVICE_ID;

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
// TOKEN TUYA
// ============================================================

async function getToken() {
  if (!ACCESS_ID || !ACCESS_SECRET) {
    throw new Error(
      "Variables TUYA_ACCESS_ID / TUYA_ACCESS_SECRET manquantes."
    );
  }

  const t =
    Date.now().toString();

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
      `Erreur token Tuya (Luma): ${JSON.stringify(res.data)}`
    );
  }

  return res.data.result.access_token;
}

// ============================================================
// REQUÊTES SIGNÉES
// ============================================================

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
      url: `${API_BASE}${url}`,

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
// DEVICE ID
// ============================================================

function requireLumaDeviceId() {
  if (!LUMA_DEVICE_ID) {
    throw new Error(
      "Variable TUYA_LUMA_DEVICE_ID manquante."
    );
  }
}

// ============================================================
// HEX -> HSV
//
// Tuya colour_data_v2 :
// H = 0 → 360
// S = 0 → 1000
// V = 0 → 1000
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

    h *= 60;

    if (h < 0) {
      h += 360;
    }
  }

  const s =
    max === 0
      ? 0
      : (delta / max) * 1000;

  const v =
    max * 1000;

  return {
    h: Math.round(h),
    s: Math.round(s),
    v: Math.round(v)
  };
}

// ============================================================
// FONCTIONS TUYA GÉNÉRIQUES
// ============================================================

async function sendCommands(
  commands
) {
  requireLumaDeviceId();

  const token =
    await getToken();

  const url =
    `/v1.0/devices/${LUMA_DEVICE_ID}/commands`;

  return signedRequest(
    "POST",
    url,
    token,
    { commands }
  );
}

// ============================================================
// STATUS
// ============================================================

async function getLumaStatus() {
  requireLumaDeviceId();

  const token =
    await getToken();

  const url =
    `/v1.0/devices/${LUMA_DEVICE_ID}/status`;

  return signedRequest(
    "GET",
    url,
    token
  );
}

// ============================================================
// FUNCTIONS
// ============================================================

async function getLumaFunctions() {
  requireLumaDeviceId();

  const token =
    await getToken();

  const url =
    `/v1.0/devices/${LUMA_DEVICE_ID}/functions`;

  return signedRequest(
    "GET",
    url,
    token
  );
}

// ============================================================
// ON
// ============================================================

async function turnOnLuma() {
  return sendCommands([
    {
      code: "switch_led",
      value: true
    }
  ]);
}

// ============================================================
// OFF
// ============================================================

async function turnOffLuma() {
  return sendCommands([
    {
      code: "switch_led",
      value: false
    }
  ]);
}

// ============================================================
// LUMINOSITÉ
//
// bright_value_v2
// min = 10
// max = 1000
// ============================================================

async function setBrightnessLuma(
  percent
) {
  const brightness =
    Math.max(
      10,
      Math.min(
        1000,
        Math.round(
          (Number(percent) / 100) *
            1000
        )
      )
    );

  return sendCommands([
    {
      code: "bright_value_v2",
      value: brightness
    }
  ]);
}

// ============================================================
// BLANC
//
// temp_value_v2
// 0    = blanc très chaud
// 1000 = blanc très froid
//
// warmth = 100 -> maximum chaud
// warmth = 0   -> maximum froid
//
// Par défaut : 100 = BLANC CHAUD
// ============================================================

async function setWhiteLuma(
  warmth = 100,
  brightness = 100
) {
  const warmthValue =
    Math.max(
      0,
      Math.min(
        100,
        Number(warmth)
      )
    );

  const brightnessValue =
    Math.max(
      10,
      Math.min(
        100,
        Number(brightness)
      )
    );

  const temperature =
    Math.round(
      ((100 - warmthValue) / 100) *
        1000
    );

  const bright =
    Math.round(
      (brightnessValue / 100) *
        1000
    );

  return sendCommands([
    {
      code: "work_mode",
      value: "white"
    },
    {
      code: "temp_value_v2",
      value: temperature
    },
    {
      code: "bright_value_v2",
      value: bright
    }
  ]);
}

// ============================================================
// BLANC CHAUD DIRECT
// ============================================================

async function setWarmWhiteLuma(
  brightness = 100
) {
  return setWhiteLuma(
    100,
    brightness
  );
}

// ============================================================
// COULEUR
// ============================================================

async function setColorLuma(
  hex
) {
  hex = String(hex || "")
    .replace("#", "")
    .trim();

  if (
    !/^[0-9a-fA-F]{6}$/.test(hex)
  ) {
    throw new Error(
      "Couleur invalide. Format attendu : RRGGBB."
    );
  }

  const hsv =
    hexToHsv(hex);

  return sendCommands([
    {
      code: "work_mode",
      value: "colour"
    },
    {
      code: "colour_data_v2",
      value: {
        h: hsv.h,
        s: hsv.s,
        v: hsv.v
      }
    }
  ]);
}

// ============================================================
// IMPRIMANTE
//
// Point d'entrée UNIQUE pour la reconnaissance vocale imprimante.
// Reçoit le texte brut du message et, si un document a été
// fourni (ex: pièce jointe Telegram), son contenu en base64.
//
// Retourne :
//   - un message prêt à envoyer (string) si la phrase concerne
//     l'imprimante
//   - null si la phrase ne concerne pas l'imprimante
//
// Toute la logique réelle (bridge, impression, encre) vit dans
// printer.js. Ici, on ne fait que relayer.
// ============================================================

async function handlePrinterVoiceCommand(text, context) {
  return printer.matchPrinterVoiceCommand(text, context);
}

// ============================================================
// ROUTER EXPRESS
// ============================================================

const router =
  express.Router();

// ============================================================
// DEBUG FUNCTIONS
// ============================================================

router.get(
  "/debug-functions",
  async (req, res) => {
    try {
      res.json(
        await getLumaFunctions()
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// STATUS
// ============================================================

router.get(
  "/status",
  async (req, res) => {
    try {
      res.json(
        await getLumaStatus()
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// ON
// ============================================================

router.get(
  "/on",
  async (req, res) => {
    try {
      res.json(
        await turnOnLuma()
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// OFF
// ============================================================

router.get(
  "/off",
  async (req, res) => {
    try {
      res.json(
        await turnOffLuma()
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// BRIGHTNESS
// ============================================================

router.get(
  "/brightness",
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
        await setBrightnessLuma(
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

// ============================================================
// WHITE
//
// /luma/white
// /luma/white?warmth=100
// /luma/white?warmth=50
// /luma/white?warmth=0
// ============================================================

router.get(
  "/white",
  async (req, res) => {
    try {
      const warmth =
        req.query.warmth === undefined
          ? 100
          : parseInt(
              req.query.warmth,
              10
            );

      const brightness =
        req.query.brightness === undefined
          ? 100
          : parseInt(
              req.query.brightness,
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
        await setWhiteLuma(
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

// ============================================================
// BLANC CHAUD
//
// /luma/warm-white
// /luma/warm-white?brightness=80
// ============================================================

router.get(
  "/warm-white",
  async (req, res) => {
    try {
      const brightness =
        req.query.brightness === undefined
          ? 100
          : parseInt(
              req.query.brightness,
              10
            );

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
        await setWarmWhiteLuma(
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

// ============================================================
// COLOR
// ============================================================

router.get(
  "/color",
  async (req, res) => {
    try {
      const hex =
        String(
          req.query.hex || ""
        ).replace("#", "");

      if (
        !/^[0-9a-fA-F]{6}$/.test(hex)
      ) {
        return res.status(400).json({
          error:
            "Paramètre 'hex' requis, format RRGGBB. Exemple : ff0000."
        });
      }

      res.json(
        await setColorLuma(hex)
      );
    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  router,

  turnOnLuma,
  turnOffLuma,

  setBrightnessLuma,
  setWhiteLuma,
  setWarmWhiteLuma,
  setColorLuma,

  getLumaStatus,
  getLumaFunctions,

  // Module imprimante externe
  handlePrinterVoiceCommand
};
