// tv-bridge.js
const TV_BRIDGE_URL =
  process.env.PALMI_TV_BRIDGE_URL || "http://10.227.203.77:3001";

const TV_BRIDGE_TOKEN = process.env.PALMI_TV_BRIDGE_TOKEN;

const COMMANDS = [
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

async function tvCommand(command, count = 1) {
  if (!TV_BRIDGE_TOKEN) {
    throw new Error("PALMI_TV_BRIDGE_TOKEN manquante.");
  }

  if (!COMMANDS.includes(command)) {
    throw new Error(`Commande TV invalide : ${command}`);
  }

  const response = await fetch(`${TV_BRIDGE_URL}/${command}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TV_BRIDGE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      count: Math.max(1, Math.min(10, Number(count) || 1))
    })
  });

  let data = {};

  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(
      data.error || `TV Bridge HTTP ${response.status}`
    );
  }

  return data;
}

async function tvStatus() {
  try {
    const response = await fetch(TV_BRIDGE_URL, {
      headers: {
        Authorization: `Bearer ${TV_BRIDGE_TOKEN}`
      }
    });

    return {
      connected: response.status === 405 || response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
}

module.exports = {
  tvCommand,
  tvStatus,

  tvUp: count => tvCommand("up", count),
  tvDown: count => tvCommand("down", count),
  tvLeft: count => tvCommand("left", count),
  tvRight: count => tvCommand("right", count),
  tvOk: count => tvCommand("ok", count),
  tvBack: count => tvCommand("back", count),
  tvHome: count => tvCommand("home", count),
  tvVolumeUp: count => tvCommand("volume_up", count),
  tvVolumeDown: count => tvCommand("volume_down", count),
  tvMute: count => tvCommand("mute", count),
  tvPower: count => tvCommand("power", count)
};