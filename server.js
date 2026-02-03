const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const https = require("https");
const cors = require("cors");
const FastText = require("fasttext"); // Nativo Node.js

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const MODEL_FILE = path.join(__dirname, "lid.176.bin");
const MODEL_URL = "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin";

let ft = null;
let modelReady = false;

// Logs detalhados
function log(message) {
  console.log(`[SERVER LOG] ${new Date().toISOString()} - ${message}`);
}

// Baixa modelo automaticamente
async function downloadModel(url, dest) {
  if (fs.existsSync(dest)) {
    log("Modelo já existe, pulando download.");
    return;
  }
  log("Baixando modelo FastText...");
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      if (response.statusCode !== 200) return reject(new Error("Falha ao baixar modelo: " + response.statusCode));
      response.pipe(file);
      file.on("finish", () => file.close(() => {
        log("Download do modelo concluído.");
        resolve();
      }));
    }).on("error", err => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// Carrega modelo corretamente de forma assíncrona
(async () => {
  try {
    await downloadModel(MODEL_URL, MODEL_FILE);
    ft = await FastText.loadModel(MODEL_FILE);
    modelReady = true;
    log("FastText model loaded e pronto!");
  } catch (err) {
    console.error("Erro ao carregar modelo FastText:", err);
  }
})();

// Verifica se texto é inglês
async function isEnglish(text) {
  const res = await ft.predict(text.replace(/\n/g, " "), 1);
  return res[0].label === "__label__en";
}

// WebSocket
wss.on("connection", ws => {
  log("Cliente conectado via WebSocket");

  ws.on("message", async message => {
    log("Mensagem recebida do cliente, iniciando processamento...");
    if (!modelReady) {
      ws.send(JSON.stringify({ error: "Modelo ainda não pronto, tente novamente em alguns segundos." }));
      log("Modelo não pronto, encerrando processamento.");
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
        if (buffer.trim() && await isEnglish(buffer)) {
          prompts.push(buffer.trim());
          log(`Prompt detectado: "${buffer.trim().slice(0, 50)}..."`);
        }
        buffer = "";
        collecting = true;
      } else if (collecting) {
        buffer += " " + line;
      }

      ws.send(JSON.stringify({
        progress: Math.round((i / lines.length) * 100),
        found: prompts.length,
        currentLine: line.slice(0, 50)
      }));

      await new Promise(r => setTimeout(r, 5));
    }

    if (buffer.trim() && await isEnglish(buffer)) {
      prompts.push(buffer.trim());
      log(`Último prompt detectado: "${buffer.trim().slice(0, 50)}..."`);
    }

    ws.send(JSON.stringify({
      done: true,
      prompts,
      total: prompts.length
    }));

    log(`Processamento concluído. Total de prompts: ${prompts.length}`);
  });

  ws.on("close", () => log("Cliente desconectado."));
});

server.listen(3000, () => {
  log("Server rodando na porta 3000");
});
