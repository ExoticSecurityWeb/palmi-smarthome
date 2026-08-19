const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.DASHBOARD_PORT || 3001;

// Fichiers du dashboard
app.use(express.static(__dirname));

// Page principale
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "dashboard.html")
    );
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `🌴 Palmi Dashboard lancé sur le port ${PORT}`
    );
});