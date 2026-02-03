const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const cors = require("cors");
const franc = require("franc-min");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

function log(msg) {
  console.log(`[SERVER LOG] ${new Date().toISOString()} - ${msg}`);
}

// Detecta inglês (ISO 639-3 = "eng")
function isEnglish(text) {
  if (!text || text.length < 20) return false;
  const lang = franc(text);
  return lang === "eng";
}

wss.on("connection", ws => {
  log("Cliente conectado via WebSocket");

  ws.on("message", async message => {
    log("Texto recebido, iniciando processamento");

    const text = message.toString();
    const lines = text.split(/\n+/);

    let collecting = false;
    let buffer = "";
    let prompts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (/^prompt\s*\d*/i.test(line)) {
        if (buffer.trim() && isEnglish(buffer)) {
          prompts.push(buffer.trim());
          log(`Prompt aceito (${buffer.length} chars)`);
        }
        buffer = "";
        collecting = true;
      } else if (collecting) {
        buffer += " " + line;
      }

      ws.send(JSON.stringify({
        progress: Math.round((i / lines.length) * 100),
        found: prompts.length,
        line: line.slice(0, 60)
      }));

      await new Promise(r => setTimeout(r, 5));
    }

    if (buffer.trim() && isEnglish(buffer)) {
      prompts.push(buffer.trim());
      log("Último prompt aceito");
    }

    ws.send(JSON.stringify({
      done: true,
      prompts,
      total: prompts.length
    }));

    log(`Processamento concluído. Total: ${prompts.length}`);
  });

  ws.on("close", () => log("Cliente desconectado"));
});

server.listen(3000, () => {
  log("Servidor iniciado na porta 3000");
});
