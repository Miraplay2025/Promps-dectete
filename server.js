const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const FastText = require("fasttext.js");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

const MODEL_DIR = path.join(__dirname, "model");
const MODEL_PATH = path.join(MODEL_DIR, "lid.176.bin");
const MODEL_URL =
  "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin";

app.use(express.json({ limit: "30mb" }));
app.use(express.static("public"));

const ft = new FastText.Classifier();
let modelReady = false;

/* --------- DOWNLOAD AUTOMÁTICO --------- */
async function downloadModel() {
  if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR);
  if (fs.existsSync(MODEL_PATH)) return;

  const res = await fetch(MODEL_URL);
  const file = fs.createWriteStream(MODEL_PATH);

  await new Promise(resolve => {
    res.body.pipe(file);
    res.body.on("end", resolve);
  });
}

/* --------- LOAD --------- */
(async () => {
  await downloadModel();
  await ft.loadModel(MODEL_PATH);
  modelReady = true;
})();

/* --------- SOCKET --------- */
wss.on("connection", ws => {
  ws.on("message", async msg => {
    if (!modelReady) {
      ws.send(JSON.stringify({ type: "error", message: "Modelo carregando" }));
      return;
    }

    const { text } = JSON.parse(msg.toString());
    if (!text) return;

    // 🔹 divide pelos marcadores Prompt
    const blocks = text.split(/Prompt\s*\d*/gi).slice(1);
    const totalBlocks = blocks.length;

    ws.send(JSON.stringify({
      type: "init",
      total: totalBlocks
    }));

    let processed = 0;
    let valid = 0;
    const prompts = [];

    for (const block of blocks) {
      processed++;

      const cleaned = block
        .split(/Resumo:/i)[0]
        .replace(/\s+/g, " ")
        .trim();

      if (cleaned.length > 40) {
        try {
          const pred = ft.predict(cleaned.slice(0, 600), 1);
          if (pred[0]?.label === "__label__en") {
            prompts.push(cleaned);
            valid++;
          }
        } catch {
          ws.send(JSON.stringify({
            type: "error",
            message: "Erro ao processar um prompt"
          }));
        }
      }

      const percent = Math.round((processed / totalBlocks) * 100);

      ws.send(JSON.stringify({
        type: "progress",
        processed,
        valid,
        percent
      }));
    }

    ws.send(JSON.stringify({
      type: "done",
      total: valid,
      prompts
    }));
  });
});

server.listen(PORT, () => {
  console.log("Servidor ativo na porta " + PORT);
});
