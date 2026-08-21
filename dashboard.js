const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

// ============================================================
// 🌴 PALMI SMART HOME
// ============================================================

const SMARTHOME_URL =
    process.env.PALMI_SMARTHOME_URL ||
    "https://palmi-smarthome-production.up.railway.app";

// ============================================================
// 📺 WORKER TV
// ============================================================

const PALMI_TV_WORKER_URL =
    process.env.PALMI_TV_WORKER_URL ||
    "https://palmi-tv.vosprojets.workers.dev";

const PALMI_TV_TOKEN =
    process.env.PALMI_TV_TOKEN;

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
    "power"
];

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "dashboard.html")
    );
});


// ============================================================
// 🌦️ MÉTÉO HEUGAS
// ============================================================

app.get("/weather", async (req, res) => {

    try {

        const apiKey =
            process.env.OPENWEATHER_API_KEY;

        if (!apiKey) {

            return res.status(500).json({
                success: false,
                error:
                    "OPENWEATHER_API_KEY manquante"
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

        const response =
            await fetch(url);

        const data =
            await response.json();

        if (!response.ok) {

            return res
                .status(response.status)
                .json({
                    success: false,
                    error:
                        data.message ||
                        "Erreur OpenWeather"
                });

        }

        return res.json({

            success: true,

            city:
                data.name ||
                "Heugas",

            temperature:
                Math.round(
                    data.main.temp
                ),

            feelsLike:
                Math.round(
                    data.main.feels_like
                ),

            humidity:
                data.main.humidity,

            description:
                data.weather?.[0]
                    ?.description ||
                "",

            icon:
                data.weather?.[0]
                    ?.icon ||
                "",

            wind:
                Math.round(
                    (data.wind?.speed || 0) *
                    3.6
                )

        });

    } catch (error) {

        console.error(
            "Erreur météo :",
            error
        );

        return res.status(500).json({
            success: false,
            error:
                "Impossible de récupérer la météo"
        });

    }

});


// ============================================================
// 💡 LUMIÈRE — CHAMBRE
// ============================================================

app.get("/light/on", async (req, res) => {

    try {

        const response =
            await fetch(
                `${SMARTHOME_URL}/light/on`
            );

        const data =
            await response.json();

        return res
            .status(response.status)
            .json(data);

    } catch (error) {

        console.error(
            "Erreur proxy light/on :",
            error
        );

        return res.status(502).json({
            success: false,
            error:
                "palmi-smarthome injoignable"
        });

    }

});


app.get("/light/off", async (req, res) => {

    try {

        const response =
            await fetch(
                `${SMARTHOME_URL}/light/off`
            );

        const data =
            await response.json();

        return res
            .status(response.status)
            .json(data);

    } catch (error) {

        console.error(
            "Erreur proxy light/off :",
            error
        );

        return res.status(502).json({
            success: false,
            error:
                "palmi-smarthome injoignable"
        });

    }

});


app.get("/light/status", async (req, res) => {

    try {

        const response =
            await fetch(
                `${SMARTHOME_URL}/light/status`
            );

        const data =
            await response.json();

        return res
            .status(response.status)
            .json(data);

    } catch (error) {

        console.error(
            "Erreur proxy light/status :",
            error
        );

        return res.status(502).json({
            success: false,
            error:
                "palmi-smarthome injoignable"
        });

    }

});


app.post(
    "/light/brightness",
    async (req, res) => {

        try {

            const value =
                req.body?.brightness;

            if (
                typeof value !== "number" ||
                value < 0 ||
                value > 100
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "brightness invalide (0-100)"
                });

            }

            const response =
                await fetch(
                    `${SMARTHOME_URL}/light/brightness?value=${value}`
                );

            const data =
                await response.json();

            return res
                .status(response.status)
                .json(data);

        } catch (error) {

            console.error(
                "Erreur proxy light/brightness :",
                error
            );

            return res.status(502).json({
                success: false,
                error:
                    "palmi-smarthome injoignable"
            });

        }

    }
);


// ============================================================
// 💡 LUMA — SALON
// ============================================================

app.get("/luma/on", async (req, res) => {

    try {

        const response =
            await fetch(
                `${SMARTHOME_URL}/luma/on`
            );

        const data =
            await response.json();

        return res
            .status(response.status)
            .json(data);

    } catch (error) {

        console.error(
            "Erreur proxy luma/on :",
            error
        );

        return res.status(502).json({
            success: false,
            error:
                "palmi-smarthome injoignable"
        });

    }

});


app.get("/luma/off", async (req, res) => {

    try {

        const response =
            await fetch(
                `${SMARTHOME_URL}/luma/off`
            );

        const data =
            await response.json();

        return res
            .status(response.status)
            .json(data);

    } catch (error) {

        console.error(
            "Erreur proxy luma/off :",
            error
        );

        return res.status(502).json({
            success: false,
            error:
                "palmi-smarthome injoignable"
        });

    }

});


app.get("/luma/status", async (req, res) => {

    try {

        const response =
            await fetch(
                `${SMARTHOME_URL}/luma/status`
            );

        const data =
            await response.json();

        return res
            .status(response.status)
            .json(data);

    } catch (error) {

        console.error(
            "Erreur proxy luma/status :",
            error
        );

        return res.status(502).json({
            success: false,
            error:
                "palmi-smarthome injoignable"
        });

    }

});


app.get(
    "/luma/brightness",
    async (req, res) => {

        try {

            const value =
                Number(req.query.value);

            if (
                !Number.isFinite(value) ||
                value < 0 ||
                value > 100
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "value invalide (0-100)"
                });

            }

            const response =
                await fetch(
                    `${SMARTHOME_URL}/luma/brightness?value=${value}`
                );

            const data =
                await response.json();

            return res
                .status(response.status)
                .json(data);

        } catch (error) {

            console.error(
                "Erreur proxy luma/brightness :",
                error
            );

            return res.status(502).json({
                success: false,
                error:
                    "palmi-smarthome injoignable"
            });

        }

    }
);


// ============================================================
// 📺 TV 1 — GOOGLE TV STICK
// ============================================================

app.post(
    "/tv/:number/:action",
    async (req, res) => {

        const number =
            String(req.params.number);

        const action =
            String(req.params.action);

        const count =
            Math.max(
                1,
                Math.min(
                    10,
                    Number(
                        req.body?.count
                    ) || 1
                )
            );

        if (number !== "1") {

            return res.status(501).json({
                success: false,
                error:
                    "TV 2 n'est pas encore branchée."
            });

        }

        if (
            !TV_COMMANDS.includes(action)
        ) {

            return res.status(400).json({
                success: false,
                error:
                    "Commande TV invalide",
                commands:
                    TV_COMMANDS
            });

        }

        if (!PALMI_TV_TOKEN) {

            return res.status(500).json({
                success: false,
                error:
                    "PALMI_TV_TOKEN manquante dans Railway"
            });

        }

        try {

            console.log(
                `📺 TV 1 → ${action} x${count}`
            );

            const response =
                await fetch(
                    `${PALMI_TV_WORKER_URL}/command`,
                    {
                        method: "POST",

                        headers: {
                            "Authorization":
                                `Bearer ${PALMI_TV_TOKEN}`,

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                action,
                                count
                            })
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {

                return res
                    .status(response.status)
                    .json(data);

            }

            return res.json({

                success: true,

                tv: 1,

                action,

                count,

                command:
                    data.command ||
                    null

            });

        } catch (error) {

            console.error(
                "Erreur Worker TV :",
                error
            );

            return res.status(502).json({
                success: false,
                error:
                    "Palmi TV Worker injoignable"
            });

        }

    }
);


// ============================================================
// 🚀 DÉMARRAGE
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🌴 Palmi Dashboard lancé sur le port ${PORT}`
        );

        console.log(
            `   Proxy lumières : ${SMARTHOME_URL}`
        );

        console.log(
            `   Worker TV : ${PALMI_TV_WORKER_URL}`
        );

    }
);