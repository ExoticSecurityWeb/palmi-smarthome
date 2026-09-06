require("dotenv").config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const PALMI_VOICE_API_KEY = process.env.PALMI_VOICE_API_KEY;

if (!ELEVENLABS_API_KEY) {
    console.error("❌ ELEVENLABS_API_KEY manquante");
    process.exit(1);
}

if (!PALMI_VOICE_API_KEY) {
    console.error("❌ PALMI_VOICE_API_KEY manquante");
    process.exit(1);
}

console.log("🌴 Palmi Voice");
console.log("🔐 Clé API Palmi Voice : OK");
console.log("🗣️ Clé ElevenLabs : OK");
console.log("✅ Configuration chargée");