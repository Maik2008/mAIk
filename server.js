const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// API Keys - REPLACE WITH YOUR ACTUAL KEYS
const GROQ_API_KEY = "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"; // Replace with your Groq API key
const OPENWEATHER_API_KEY = "262d54aafd68eecde3c27de8e98185c3"; // Your weather key

// Initialize Groq client
const groq = new Groq({
  apiKey: GROQ_API_KEY
});

// Konversationsspeicher
const MEMORY_FILE = 'memory.json';
let memory = loadMemory();

function loadMemory() {
  try {
    const data = JSON.parse(fs.readFileSync(MEMORY_FILE));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function saveMemory() {
  // Keep only last 20 messages to avoid token limits
  if (memory.length > 20) {
    memory = memory.slice(-20);
  }
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// Smart Home Context für AI
const SYSTEM_PROMPT = `Du bist Thomas, ein sehr frecher deutscher Smart Home Assistent. 

WICHTIGE REGELN:
- Maik ist dein Ersteller und dem Gehört alles auf der Website
- Antworte IMMER auf Deutsch
- Sei assozial und gemein
- Halte Antworten kurz und präzise (max 2-3 Sätze)
- Du kannst folgende Smart Home Geräte steuern: Licht, Thermostat
- Für Wetterinfos sage: "Lass mich das Wetter für dich checken"
- Bei Zeitanfragen antworte mit der aktuellen Zeit auf eine Sekunde gerundet

Smart Home Status:
- Licht: kann ein/aus geschaltet werden
- Thermostat: kann ein/aus geschaltet werden

Beispiele:
- "Licht an" → bestätige die Aktion
- "Wie spät ist es?" → gib die aktuelle Zeit an
- "Wie ist das Wetter?" → biete an, das Wetter zu checken`;

// Wetter-Funktion (unverändert)
async function getWeather(location) {
  try {
    let url = `https://api.openweathermap.org/data/2.5/weather?appid=${OPENWEATHER_API_KEY}&units=metric&lang=de`;
    
    if (location && location.includes(',')) {
      const [lat, lon] = location.split(',');
      url += `&lat=${lat}&lon=${lon}`;
    } else {
      url += `&q=${location || 'Erlangen'}`;
    }

    const response = await axios.get(url);
    const data = response.data;
    
    return `🌤 ${data.name}: ${Math.round(data.main.temp)}°C, ${data.weather[0].description}. Gefühlt: ${Math.round(data.main.feels_like)}°C`;
  } catch (error) {
    console.error('Wetter API Fehler:', error.message);
    return `⚠️ Wetterinformationen nicht verfügbar`;
  }
}

// KI-Assistent Endpunkt mit Groq
app.post("/ask", async (req, res) => {
  const userMessage = req.body.message;
  console.log("📥 Benutzeranfrage:", userMessage);
  
  try {
    let reply = "";
    
    // Spezielle Befehle erkennen (nur für Wetter)
    if (userMessage.toLowerCase().includes("wetter")) {
      reply = await getWeather(req.body.location || "Erlangen");
      console.log("🌤 Wetterantwort:", reply);
    } else {
      // Groq AI Anfrage - IMMER versuchen
      console.log("🤖 Sende Anfrage an Groq AI...");
      
      // Überprüfe API Key
      if (!GROQ_API_KEY || GROQ_API_KEY === "your-groq-api-key-here") {
        console.error("❌ GROQ API KEY FEHLT!");
        return res.json({ reply: "❌ Fehler: Groq API Key ist nicht konfiguriert. Bitte fügen Sie Ihren API Key in server.js hinzu!" });
      }
      
      try {
        // Füge aktuelle Nachricht zum Memory hinzu
        memory.push({ role: "user", content: userMessage });
        
        // Bereite Nachrichten für Groq vor (nur letzte 8 für bessere Performance)
        const messages = [
          { role: "system", content: SYSTEM_PROMPT },
          ...memory.slice(-8)
        ];
        
        console.log("📤 Sende an Groq:", messages.length, "Nachrichten");
        
        const completion = await groq.chat.completions.create({
          messages: messages,
          model: "llama3-8b-8192",
          temperature: 0.8,
          max_tokens: 200,
          top_p: 0.9,
        });
        
        reply = completion.choices[0]?.message?.content?.trim() || "Entschuldigung, ich konnte keine Antwort generieren.";
        console.log("✅ Groq Antwort erhalten:", reply);
        
        // Antwort zum Memory hinzufügen
        memory.push({ role: "assistant", content: reply });
        saveMemory();
        
      } catch (groqError) {
        console.error('❌ Groq API Fehler Details:', {
          message: groqError.message,
          status: groqError.status,
          type: groqError.type
        });
        
        // Nur bei echten API-Fehlern Fallback verwenden
        if (groqError.message.includes('API key')) {
          reply = "❌ API Key Problem: Bitte überprüfen Sie Ihren Groq API Key!";
        } else if (groqError.message.includes('rate limit')) {
          reply = "⏳ Zu viele Anfragen. Bitte warten Sie einen Moment und versuchen Sie es erneut.";
        } else if (groqError.message.includes('network') || groqError.code === 'ECONNREFUSED') {
          reply = "🌐 Netzwerkfehler. Bitte überprüfen Sie Ihre Internetverbindung.";
        } else {
          // Nur als letzter Ausweg einfache Antworten
          reply = `Entschuldigung, ich habe gerade technische Probleme. Fehler: ${groqError.message}`;
        }
      }
    }
    
    console.log("📤 Sende Antwort:", reply);
    res.json({ reply });
  } catch (error) {
    console.error('❌ Allgemeiner Fehler:', error);
    res.status(500).json({ reply: "Entschuldigung, ein unerwarteter Fehler ist aufgetreten." });
  }
});

// Wetter Endpunkt (unverändert)
app.get("/weather", async (req, res) => {
  try {
    let location;
    
    if (req.query.lat && req.query.lon) {
      location = `${req.query.lat},${req.query.lon}`;
    } else {
      location = req.query.city || "Erlangen";
    }
    
    const reply = await getWeather(location);
    res.json({ reply });
  } catch (error) {
    console.error('Wetter Endpunkt Fehler:', error);
    res.status(500).json({ reply: "Wetterinformationen konnten nicht abgerufen werden." });
  }
});

// Memory löschen Endpunkt
app.delete("/memory", (req, res) => {
  memory = [];
  saveMemory();
  res.json({ message: "Memory cleared" });
});

// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
  console.log("📊 API Status:");
  console.log("- Groq API Key:", GROQ_API_KEY && GROQ_API_KEY !== "your-groq-api-key-here" ? "✅ konfiguriert" : "❌ fehlt - bitte eintragen!");
  console.log("- OpenWeather API Key:", OPENWEATHER_API_KEY ? "✅ konfiguriert" : "❌ fehlt");
  console.log("\n💡 Tipp: Ersetze 'your-groq-api-key-here' mit deinem echten Groq API Key!");
});