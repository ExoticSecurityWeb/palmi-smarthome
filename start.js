// start.js — entrypoint unique pour le plan Zenode (1 instance, 1 port exposé)
// Lance palmi-smarthome.js et dashboard.js en interne, et route le trafic
// externe vers le bon service selon le chemin demandé.
//
// - dashboard.js  écoute en interne sur PORT_DASHBOARD (8080)
// - palmi-smarthome.js écoute en interne sur PORT_SMARTHOME (3000)
// - Ce script écoute sur le port EXPOSÉ par Zenode (SERVER_PORT) et route :
//     /tv-bridge, /cast-bridge (WebSocket A10 -> serveur)  -> smarthome (3000)
//     tout le reste (dashboard web + assets)                -> dashboard (8080)
//
// Le dashboard parle au smarthome en interne via http://localhost:3000
// (PALMI_SMARTHOME_URL est fixée automatiquement ci-dessous, pas besoin
// de la définir dans le panel).

const { spawn } = require("child_process");
const http = require("http");
const httpProxy = require("http-proxy");

const PORT_SMARTHOME = 3000;
const PORT_DASHBOARD = 8080;

// Port réellement exposé par Zenode/Pelican.
// Le nom exact de la variable dépend de l'egg (SERVER_PORT le plus courant
// sur Pterodactyl/Pelican). On couvre les cas fréquents avec un fallback.
const EXPOSED_PORT =
  process.env.SERVER_PORT ||
  process.env.PORT_ALLOCATION ||
  process.env.PORT ||
  25565;

function startChild(name, script, env) {
  const child = spawn("node", [script], {
    env: { ...process.env, ...env },
    stdio: "inherit"
  });
  child.on("exit", (code) => {
    console.error(`[start.js] ${name} s'est arrêté (code ${code}). Redémarrage dans 3s...`);
    setTimeout(() => startChild(name, script, env), 3000);
  });
  return child;
}

startChild("palmi-smarthome", "palmi-smarthome.js", {
  PORT: String(PORT_SMARTHOME)
});

startChild("palmi-dashboard", "dashboard.js", {
  PORT: String(PORT_DASHBOARD),
  PALMI_SMARTHOME_URL: `http://localhost:${PORT_SMARTHOME}`
});

// --- Proxy externe ---
const proxySmarthome = httpProxy.createProxyServer({
  target: `http://localhost:${PORT_SMARTHOME}`,
  ws: true
});
const proxyDashboard = httpProxy.createProxyServer({
  target: `http://localhost:${PORT_DASHBOARD}`,
  ws: true
});

proxySmarthome.on("error", (err) => console.error("[proxy smarthome]", err.message));
proxyDashboard.on("error", (err) => console.error("[proxy dashboard]", err.message));

function isSmarthomePath(pathname) {
  return pathname === "/tv-bridge" || pathname === "/cast-bridge";
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (isSmarthomePath(pathname)) {
    proxySmarthome.web(req, res);
  } else {
    proxyDashboard.web(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (isSmarthomePath(pathname)) {
    proxySmarthome.ws(req, socket, head);
  } else {
    proxyDashboard.ws(req, socket, head);
  }
});

// Petite attente pour laisser les 2 apps internes démarrer avant d'ouvrir le port public
setTimeout(() => {
  server.listen(EXPOSED_PORT, () => {
    console.log(`[start.js] Proxy public en écoute sur le port ${EXPOSED_PORT}`);
    console.log(`[start.js] -> /tv-bridge, /cast-bridge routés vers smarthome (${PORT_SMARTHOME})`);
    console.log(`[start.js] -> tout le reste routé vers dashboard (${PORT_DASHBOARD})`);
  });
}, 2000);
