// Development-only visual harness: same public files, prerecorded simulated state, no Twitch/env.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const files: Record<string, string> = {
  "/": "index.html",
  "/app.js": "app.js",
  "/style.css": "style.css",
  "/audio.js": "audio.js",
  "/terrain.svg": "terrain.svg",
};
createServer(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/audio-check") {
      res.setHeader("Content-Type", "text/html");
      return res.end(await readFile("scripts/audio-signal.html"));
    }
    if (req.url === "/api/state") {
      res.setHeader("Content-Type", "application/json");
      return res.end(await readFile(".local/preview-state.json"));
    }
    const file = files[req.url ?? ""];
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : "text/html",
    );
    res.end(await readFile("public/" + file));
  } catch {
    res.writeHead(500);
    res.end();
  }
}).listen(3103, "127.0.0.1", () =>
  console.log(
    "Visual harness http://localhost:3103 — simulated snapshots only",
  ),
);
