const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { Classifier } = require("fasttext.js"); // Corrigido

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const ft = new Classifier(); // instância correta
let modelReady = false;

(async () => {
  try {
    await ft.loadModel("lid.176.bin");
    modelReady = true;
    console.log("FastText model loaded");
  } catch (err) {
    console.error("Erro ao carregar modelo FastText:", err);
  }
})();

function isEnglish(text) {
  const result = ft.predict(text.replace(/\n/g, " "), 1);
  return result[0].label === "__label__en";
}

wss.on("connection", ws => {
  ws.on("message", async message => {
    if (!modelReady) {
      ws.send(JSON.stringify({ error: "Model not ready yet" }));
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
