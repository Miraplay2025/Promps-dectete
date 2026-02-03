const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const https = require("https");
const cors = require("cors");
const { Classifier } = require("fasttext.js"); // FastText moderno

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors()); // Permite chamadas externas
app.use(express.static(path.join(__dirname, "public")));

const MODEL_FILE = path.join(__dirname, "lid.176.bin");
const MODEL_URL = "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin";

const ft = new Classifier();
let modelReady = false;

// Baixa modelo automaticamente
async function downloadModel(url, dest) {
  if (fs.existsSync(dest)) return;
  console.log("Baixando modelo FastText, isso pode levar alguns minutos...");
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      if (response.statusCode !== 200) return reject(new Error("Falha ao baixar modelo: " + response.statusCode));
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", err => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// Carrega modelo de forma assíncrona
(async () => {
  try {
    await downloadModel(MODEL_URL, MODEL_FILE);
    await ft.loadModel(MODEL_FILE);
    modelReady = true;
    console.log("FastText model loaded");
  } catch (err) {
    console.error("Erro ao carregar modelo FastText:", err);
  }
})();

// Função para verificar se o texto é inglês
function isEnglish(text) {
  const result = ft.predict(text.replace(/\n/g, " "), 1);
  return result[0].label === "__label__en";
}

// WebSocket
wss.on("connection", ws => {
  ws.on("message", async message => {
    if (!modelReady) {
      ws.send(JSON.stringify({ error: "Modelo ainda não pronto, tente novamente em alguns segundos." }));
      return;
    }

    const text = message.toString();
    const lines = text.split(/\n+/);

    let collecting = false;
    let buffer = "";
    let prompts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^prompt\s*\d*/i.test(line.trim())) {
        if (buffer.trim() && isEnglish(buffer)) prompts.push(buffer.trim());
        buffer = "";
        collecting = true;
      } else if (collecting) {
        buffer += " " + line;
      }

      ws.send(JSON.stringify({
        progress: Math.round((i / lines.length) * 100),
        found: prompts.length
      }));

      await new Promise(r => setTimeout(r, 10));
    }

    if (buffer.trim() && isEnglish(buffer)) {
      prompts.push(buffer.trim());
    }

    ws.send(JSON.stringify({
      done: true,
      prompts,
      total: prompts.length
    }));
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
