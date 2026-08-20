const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

// URL publique du service palmi-smarthome — c'est lui qui possède
// les vraies routes lumières/TV/Cast. Ce dashboard n'est qu'un proxy léger,
// on ne touche à rien côté palmi-smarthome.
const SMARTHOME_URL =
  process.env.PALMI_SMARTHOME_URL ||
  "https://palmi-smarthome-production.up.railway.app";

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

// 🌦️ Météo Heugas (inchangé)
app.get("/weather", async (req, res) => {
    try {
        const apiKey = process.env.OPENWEATHER_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                success: false,
                error: "OPENWEATHER_API_KEY manquante"
            });
        }

        const latitude = 43.643;
        const longitude = -1.069;

        const url =
            `https://api.openweathermap.org/data/2.5/weather` +
            `?lat=${latitude}` +
            `&lon=${longitude}` +
            `&appid=${apiKey}` +
            `&units=metric` +
            `&lang=fr`;

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                error: data.message || "Erreur OpenWeather"
            });
        }

        res.json({
            success: true,
            city: data.name || "Heugas",
            temperature: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            humidity: data.main.humidity,
            description: data.weather?.[0]?.description || "",
            icon: data.weather?.[0]?.icon || "",
            wind: Math.round((data.wind?.speed || 0) * 3.6)
        });

    } catch (error) {
        console.error("Erreur météo :", error);

        res.status(500).json({
            success: false,
            error: "Impossible de récupérer la météo"
        });
    }
});

// 💡 Lumières — proxy vers palmi-smarthome (routes GET existantes, inchangées)
app.get("/light/on", async (req, res) => {
    try {
        const r = await fetch(`${SMARTHOME_URL}/light/on`);
        const data = await r.json();
        res.status(r.status).json(data);
    } catch (error) {
        console.error("Erreur proxy light/on :", error);
        res.status(502).json({ success: false, error: "palmi-smarthome injoignable" });
    }
});

app.get("/light/off", async (req, res) => {
    try {
        const r = await fetch(`${SMARTHOME_URL}/light/off`);
        const data = await r.json();
        res.status(r.status).json(data);
    } catch (error) {
        console.error("Erreur proxy light/off :", error);
        res.status(502).json({ success: false, error: "palmi-smarthome injoignable" });
    }
});

// Le dashboard envoie du POST + JSON {brightness}, mais palmi-smarthome attend
// du GET + ?value=. On adapte ici, sans rien changer côté palmi-smarthome.
app.post("/light/brightness", async (req, res) => {
    try {
        const value = req.body?.brightness;

        if (typeof value !== "number" || value < 0 || value > 100) {
            return res.status(400).json({ success: false, error: "brightness invalide (0-100)" });
        }

        const r = await fetch(`${SMARTHOME_URL}/light/brightness?value=${value}`);
        const data = await r.json();
        res.status(r.status).json(data);
    } catch (error) {
        console.error("Erreur proxy light/brightness :", error);
        res.status(502).json({ success: false, error: "palmi-smarthome injoignable" });
    }
});

// 📺 TV 1 / TV 2 — pas encore câblées (le stick TV et le Chromecast ne sont
// pilotables que via le bot Telegram pour l'instant, pas d'endpoint HTTP direct
// exposé côté palmi-smarthome). On répond proprement au lieu de planter,
// à finir demain.
app.post("/tv/:number/:action", (req, res) => {
    res.status(501).json({
        success: false,
        error: "Contrôle TV pas encore branché sur le dashboard — utilise /tv ou /cast sur Telegram pour le moment."
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌴 Palmi Dashboard lancé sur le port ${PORT}`);
    console.log(`   Proxy vers : ${SMARTHOME_URL}`);
});
