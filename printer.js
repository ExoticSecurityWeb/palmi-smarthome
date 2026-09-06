// ============================================================
// PALMI-PRINTER — Module externe imprimante
// Epson XP-2205
//
// Module indépendant de Palmi-Luma.js.
// Luma l'appelle directement via matchPrinterVoiceCommand(text, context).
//
// AUCUNE donnée n'est inventée ici : tout ce qui concerne l'état
// réel de l'imprimante ou de l'encre vient du bridge local
// (printer-bridge.py, sur le PC), qui seul a accès au réseau
// local où se trouve l'Epson XP-2205 (192.168.1.12).
//
// Si le bridge ne répond pas, ce module le dit honnêtement au
// lieu de fabriquer une valeur.
//
// Aucune route Express n'est créée ici.
// ============================================================

const axios = require("axios");

const PRINTER_IP =
  process.env.PRINTER_IP ||
  "192.168.1.12";

const PRINTER_NAME =
  process.env.PRINTER_NAME ||
  "Epson XP-2205";

const PRINTER_INK_MODEL =
  process.env.PRINTER_INK_MODEL ||
  "Référence de cartouche à vérifier";

// ------------------------------------------------------------
// Bridge local (tourne sur le PC, seul point d'accès réseau
// vers l'imprimante).
// ------------------------------------------------------------

const BRIDGE_URL =
  process.env.PRINTER_BRIDGE_URL;

const BRIDGE_TOKEN =
  process.env.PRINTER_BRIDGE_TOKEN;

function bridgeHeaders() {
  if (!BRIDGE_TOKEN) {
    return {};
  }

  return {
    Authorization: `Bearer ${BRIDGE_TOKEN}`
  };
}

function isBridgeConfigured() {
  return Boolean(BRIDGE_URL);
}

// ============================================================
// APPEL BRIDGE — STATUT + ENCRE
//
// Le bridge fait UN SEUL appel réel vers l'imprimante
// (page admin HTTPS) et renvoie l'état complet. On réutilise
// donc le même résultat pour le statut et pour l'encre plutôt
// que d'interroger deux fois.
//
// Retour :
//   { reachable: true,  printerOnline: true,  ink: {...} }
//   { reachable: true,  printerOnline: false, ink: null   }  → bridge OK, imprimante injoignable
//   { reachable: false, printerOnline: null,  ink: null   }  → bridge lui-même injoignable
// ============================================================

async function queryBridgePrinterStatus() {
  if (!isBridgeConfigured()) {
    return {
      reachable: false,
      printerOnline: null,
      ink: null,
      reason: "not_configured"
    };
  }

  try {
    const res = await axios.get(
      `${BRIDGE_URL}/printer/status`,
      {
        headers: bridgeHeaders(),
        timeout: 6000,
        validateStatus: () => true
      }
    );

    if (res.status !== 200 || !res.data || !res.data.ink) {
      // Le bridge a répondu, mais n'a pas réussi à joindre
      // l'imprimante elle-même (ex: éteinte, hors réseau).
      return {
        reachable: true,
        printerOnline: false,
        ink: null
      };
    }

    return {
      reachable: true,
      printerOnline: true,
      ink: res.data.ink
    };
  } catch (err) {
    // Le bridge lui-même est injoignable (PC éteint, service
    // arrêté, tunnel/port fermé, etc.)
    return {
      reachable: false,
      printerOnline: null,
      ink: null
    };
  }
}

// ============================================================
// TRADUCTION DES CODES BRIDGE (BK/Y/M/C) VERS NOS COULEURS
//
// Les pourcentages sont ceux du bridge (réels). Le statut
// (Vide/Moyen/OK) est recalculé ici selon NOS seuils, pas ceux
// du bridge (qui utilise 5 % / 20 %, différents de la demande).
// ============================================================

const BRIDGE_CODE_TO_COLOR = {
  BK: { color: "noire", name: "Noir" },
  Y: { color: "jaune", name: "Jaune" },
  M: { color: "magenta", name: "Magenta" },
  C: { color: "cyan", name: "Cyan" }
};

function getInkLevelName(level) {
  const value = Math.max(
    0,
    Math.min(100, Math.round(Number(level) || 0))
  );

  if (value <= 5) {
    return "Vide";
  }

  if (value <= 70) {
    return "Moyen";
  }

  return "OK";
}

function mapBridgeInk(bridgeInk) {
  return Object.entries(bridgeInk)
    .map(([code, data]) => {
      const meta = BRIDGE_CODE_TO_COLOR[code];

      if (!meta) {
        return null;
      }

      const level = Math.max(
        0,
        Math.min(100, Math.round(Number(data.percentage) || 0))
      );

      return {
        color: meta.color,
        name: meta.name,
        level,
        status: getInkLevelName(level),
        empty: level <= 5
      };
    })
    .filter(Boolean);
}

// ============================================================
// ÉTAT DE L'ENCRE (réel, via le bridge)
//
// Retourne :
//   { ok: true,  inks: [...] }
//   { ok: false, reason: "bridge_unreachable" | "printer_unreachable" | "not_configured" }
// ============================================================

async function getInkStatus() {
  const status = await queryBridgePrinterStatus();

  if (!status.reachable) {
    return {
      ok: false,
      reason: isBridgeConfigured()
        ? "bridge_unreachable"
        : "not_configured"
    };
  }

  if (!status.printerOnline || !status.ink) {
    return {
      ok: false,
      reason: "printer_unreachable"
    };
  }

  return {
    ok: true,
    inks: mapBridgeInk(status.ink)
  };
}

// ============================================================
// MESSAGE — ÉTAT IMPRIMANTE (réel, via le bridge)
// ============================================================

async function getPrinterStatusMessage() {
  const status = await queryBridgePrinterStatus();

  if (!status.reachable) {
    if (!isBridgeConfigured()) {
      return (
        "🌴 Le bridge imprimante n'est pas configuré côté serveur " +
        "(PRINTER_BRIDGE_URL manquant), je ne peux pas vérifier."
      );
    }

    return (
      "🌴 Je n'arrive pas à joindre le bridge sur ton PC, donc je " +
      "ne peux pas savoir si l'imprimante est allumée."
    );
  }

  if (!status.printerOnline) {
    return (
      `🌴 Je n'arrive pas à joindre ${PRINTER_NAME} sur le réseau. ` +
      "Elle est peut-être éteinte."
    );
  }

  return (
    `🌴 Oui, ${PRINTER_NAME} est allumée et accessible sur le réseau. 🖨️`
  );
}

// ============================================================
// MESSAGE — MODULE
//
// Vérifie que le MODULE (ce fichier) est chargé, pas l'état de
// l'imprimante elle-même. C'est volontairement indépendant du
// bridge : cette réponse est vraie dès l'instant où ce code
// s'exécute.
// ============================================================

function getPrinterModuleMessage() {
  return (
    "🌴 Le module imprimante est chargé et disponible."
  );
}

// ============================================================
// MESSAGE — ENCRE, TOUTES COULEURS (réel, via le bridge)
// ============================================================

function formatUnavailableInkMessage(reason) {
  if (reason === "not_configured") {
    return (
      "🌴 Le bridge imprimante n'est pas configuré côté serveur, " +
      "je ne peux pas lire les niveaux d'encre."
    );
  }

  if (reason === "bridge_unreachable") {
    return (
      "🌴 Je n'arrive pas à joindre le bridge sur ton PC, donc je " +
      "ne peux pas lire les niveaux d'encre pour le moment."
    );
  }

  return (
    `🌴 Je n'arrive pas à joindre ${PRINTER_NAME} pour lire les ` +
    "niveaux d'encre. Elle est peut-être éteinte."
  );
}

async function getPrinterInkMessage() {
  const status = await getInkStatus();

  if (!status.ok) {
    return formatUnavailableInkMessage(status.reason);
  }

  const inks = status.inks;

  const empty = inks.filter((ink) => ink.empty);
  const medium = inks.filter((ink) => ink.status === "Moyen");

  if (empty.length > 0) {
    if (empty.length === 1) {
      const ink = empty[0];

      return (
        `🌴 La cartouche ${ink.color} est vide ` +
        `(${ink.level} %). Pour l'Epson XP-2205, ` +
        `il faut prendre une cartouche ${PRINTER_INK_MODEL} ` +
        `pour la couleur ${ink.name}.`
      );
    }

    const names =
      empty.map((ink) => ink.color).join(", ");

    return (
      `🌴 Les cartouches suivantes sont vides : ${names}. ` +
      `Elles sont à 5 % ou moins. Il faut prévoir les cartouches ` +
      `${PRINTER_INK_MODEL} pour l'Epson XP-2205.`
    );
  }

  if (medium.length > 0) {
    const details =
      medium
        .map((ink) => `${ink.color} (${ink.level} %)`)
        .join(", ");

    return (
      `🌴 L'encre est à un niveau moyen : ${details}.`
    );
  }

  return "🌴 Les niveaux d'encre sont OK.";
}

// ============================================================
// MESSAGE — POURCENTAGE D'UNE COULEUR PRÉCISE (réel)
// ============================================================

const COLOR_ALIASES = {
  noir: "noire",
  noire: "noire",
  black: "noire",

  cyan: "cyan",

  magenta: "magenta",

  jaune: "jaune",
  yellow: "jaune"
};

async function getPrinterInkColorMessage(color) {
  const wanted =
    COLOR_ALIASES[
      String(color || "").toLowerCase().trim()
    ];

  if (!wanted) {
    return (
      "🌴 Je peux donner le niveau du noir, " +
      "du cyan, du magenta ou du jaune."
    );
  }

  const status = await getInkStatus();

  if (!status.ok) {
    return formatUnavailableInkMessage(status.reason);
  }

  const ink = status.inks.find(
    (item) => item.color === wanted
  );

  if (!ink) {
    return (
      "🌴 Je ne trouve pas cette couleur dans les données du bridge."
    );
  }

  if (ink.empty) {
    return (
      `🌴 L'encre ${ink.color} est vide (${ink.level} %). ` +
      `Pour l'Epson XP-2205, il faut une cartouche ` +
      `${PRINTER_INK_MODEL} pour la couleur ${ink.name}.`
    );
  }

  return (
    `🌴 L'encre ${ink.color} est à ${ink.level} % : ${ink.status}.`
  );
}

// ============================================================
// IMPRESSION RÉELLE (via le bridge)
//
// context.fileBase64 / context.fileName doivent venir du système
// appelant (ex: pièce jointe Telegram). Ce module n'invente
// JAMAIS de document : sans fichier fourni, il le dit clairement.
// ============================================================

async function printDocument(fileBase64, fileName) {
  if (!isBridgeConfigured()) {
    return {
      ok: false,
      message:
        "🌴 Le bridge imprimante n'est pas configuré côté serveur, " +
        "je ne peux pas envoyer le document."
    };
  }

  try {
    const res = await axios.post(
      `${BRIDGE_URL}/printer/print`,
      {
        filename: fileName || "document",
        file_base64: fileBase64
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...bridgeHeaders()
        },
        timeout: 20000,
        validateStatus: () => true
      }
    );

    if (res.status !== 200 || !res.data || res.data.status !== "ok") {
      return {
        ok: false,
        message:
          "🌴 Je n'arrive pas à envoyer le document à l'imprimante " +
          "pour le moment."
      };
    }

    return {
      ok: true,
      message:
        `🌴 D'accord, j'envoie le document à ${PRINTER_NAME}. 🖨️`
    };
  } catch (err) {
    return {
      ok: false,
      message:
        "🌴 Je n'arrive pas à envoyer le document à l'imprimante " +
        "pour le moment."
    };
  }
}

// ============================================================
// RECONNAISSANCE VOCALE — CŒUR DU MODULE
//
// text    : texte brut du message (ou de la légende du fichier)
// context : { fileBase64, fileName } si un document accompagne
//           le message, sinon undefined/{}
//
// Retourne un message (string) si la phrase concerne
// l'imprimante, sinon null.
//
// Async car les réponses réelles nécessitent d'interroger le
// bridge local — le dispatcher doit faire un `await`.
// ============================================================

async function matchPrinterVoiceCommand(text, context) {
  const lowerText =
    String(text || "").toLowerCase();

  const ctx = context || {};

  // ----------------------------------------------------------
  // 1. Module imprimante (le plus spécifique → vérifié en 1er)
  // ----------------------------------------------------------

  if (
    lowerText.includes("module imprimante") ||
    lowerText.includes("module d'imprimante") ||
    lowerText.includes("module de l'imprimante") ||
    lowerText.includes("module d’imprimante")
  ) {
    return getPrinterModuleMessage();
  }

  // ----------------------------------------------------------
  // 2. État général de l'imprimante (réel)
  // ----------------------------------------------------------

  if (
    lowerText.includes("imprimante") &&
    (
      lowerText.includes("allumée") ||
      lowerText.includes("allumee") ||
      lowerText.includes("allume") ||
      lowerText.includes("marche") ||
      lowerText.includes("disponible") ||
      lowerText.includes("fonctionne")
    )
  ) {
    return getPrinterStatusMessage();
  }

  // ----------------------------------------------------------
  // 3 & 4. Encre — couleur précise ou niveau général (réel)
  // ----------------------------------------------------------

  const mentionsInkWord =
    lowerText.includes("encre") ||
    lowerText.includes("cartouche");

  const asksLevel =
    lowerText.includes("combien") ||
    lowerText.includes("niveau") ||
    lowerText.includes("comment") ||
    lowerText.includes("état") ||
    lowerText.includes("etat");

  const inkColorWords = [
    "noire",
    "noir",
    "cyan",
    "magenta",
    "jaune"
  ];

  const colorFound =
    inkColorWords.find(
      (word) => lowerText.includes(word)
    );

  if (colorFound && (mentionsInkWord || asksLevel)) {
    return getPrinterInkColorMessage(colorFound);
  }

  if (mentionsInkWord && asksLevel) {
    return getPrinterInkMessage();
  }

  // ----------------------------------------------------------
  // 5. Lancer une impression RÉELLE
  //    "imprimante" ne contient jamais "imprime" comme
  //    sous-chaîne, donc aucun conflit avec les blocs 1 et 2.
  // ----------------------------------------------------------

  if (lowerText.includes("imprime")) {
    if (!ctx.fileBase64) {
      return (
        "🌴 Je n'ai pas de document à imprimer. Envoie-moi le " +
        "fichier (en pièce jointe) avec ta demande."
      );
    }

    const result =
      await printDocument(ctx.fileBase64, ctx.fileName);

    return result.message;
  }

  return null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getPrinterStatusMessage,
  getPrinterModuleMessage,
  getPrinterInkMessage,
  getPrinterInkColorMessage,
  getInkStatus,
  getInkLevelName,
  printDocument,
  matchPrinterVoiceCommand
};
