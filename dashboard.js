const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

// 🌦️ Météo Heugas
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

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌴 Palmi Dashboard lancé sur le port ${PORT}`);
});