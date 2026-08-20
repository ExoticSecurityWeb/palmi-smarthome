// tv-bridge.js
// 🌴 Palmi TV Bridge — A10 / ZeroTier

const TV_BRIDGE_URL =
  process.env.PALMI_TV_BRIDGE_URL || "http://10.227.203.77:3001";

const TV_BRIDGE_TOKEN = process.env.PALMI_TV_BRIDGE_TOKEN;

const TV_COMMANDS = [
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
  "power",
];

async function tvCommand(command, count = 1) {
  if (!TV_BRIDGE_TOKEN) {
    throw new Error("PALMI_TV_BRIDGE_TOKEN manquante.");
  }

  if (!TV_COMMANDS.includes(command)) {
    throw new Error(`Commande TV inconnue : ${command}`);
  }

  const response = await fetch(`${TV_BRIDGE_URL}/${command}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TV_BRIDGE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      count: Math.max(1, Math.min(10, Number(count) || 1)),
    }),
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error || `TV Bridge HTTP ${response.status}`
    );
  }

  return data;
}

async function tvUp(count = 1) {
  return tvCommand("up", count);
}

async function tvDown(count = 1) {
  return tvCommand("down", count);
}

async function tvLeft(count = 1) {
  return tvCommand("left", count);
}

async function tvRight(count = 1) {
  return tvCommand("right", count);
}

async function tvOk(count = 1) {
  return tvCommand("ok", count);
}

async function tvBack(count = 1) {
  return tvCommand("back", count);
}

async function tvHome(count = 1) {
  return tvCommand("home", count);
}

async function tvVolumeUp(count = 1) {
  return tvCommand("volume_up", count);
}

async function tvVolumeDown(count = 1) {
  return tvCommand("volume_down", count);
}

async function tvMute(count = 1) {
  return tvCommand("mute", count);
}

async function tvPower(count = 1) {
  return tvCommand("power", count);
}

async function tvBridgeStatus() {
  if (!TV_BRIDGE_TOKEN) {
    return {
      connected: false,
      error: "PALMI_TV_BRIDGE_TOKEN manquante.",
    };
  }

  try {
    const response = await fetch(TV_BRIDGE_URL, {
      headers: {
        Authorization: `Bearer ${TV_BRIDGE_TOKEN}`,
      },
    });

    // L'API répond actuellement 405 sur GET :
    // cela suffit pour confirmer que le serveur est joignable.
    return {
      connected: response.status === 405 || response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message,
    };
  }
}

module.exports = {
  TV_BRIDGE_URL,
  tvCommand,
  tvBridgeStatus,
  tvUp,
  tvDown,
  tvLeft,
  tvRight,
  tvOk,
  tvBack,
  tvHome,
  tvVolumeUp,
  tvVolumeDown,
  tvMute,
  tvPower,
};