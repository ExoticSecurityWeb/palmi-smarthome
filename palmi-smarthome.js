const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
const API_BASE = process.env.TUYA_API_BASE || "https://openapi.tuyaeu.com";
const DEVICE_ID = process.env.TUYA_DEVICE_ID || "bf7d9913dd42da28899bnq";

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
    const data = await sendCommands([{ code: "switch_led", value: true }]);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/light/off", async (req, res) => {
  try {
    const data = await sendCommands([{ code: "switch_led", value: false }]);
    res.json(data);
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
    const tuyaValue = Math.round((percent / 100) * 1000);
    const data = await sendCommands([{ code: "bright_value", value: tuyaValue }]);
    res.json(data);
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

    const colourData = { h, s, v };

    const data = await sendCommands([
      { code: "work_mode", value: "colour" },
      { code: "colour_data", value: colourData },
    ]);

    res.json({ sent: colourData, result: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Palmi Smart Home — routes: /light/on, /light/off, /light/brightness?value=0-100, /light/color?hex=RRGGBB, /debug-functions");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Palmi Smart Home lancé sur le port ${PORT}`));
