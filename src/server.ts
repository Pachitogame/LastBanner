import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { Game, seeded, type Mode } from "./engine.js";
import { fixture, fixtureAttack, fixtureSelect } from "./fixture.js";
import { Twitch } from "./twitch.js";
import { WinnerNotice } from "./winner-notice.js";
const winnerNotice = new WinnerNotice();
import { Presentation } from "./presentation.js";
const presentation = new Presentation();
const epoch = Date.now(),
  boot = performance.now();
const realNow = () => epoch + Math.floor(performance.now() - boot);
let virtualTime = 1000;
let recoveryAt = 0,
  lastErrorNotice = 0;
let actionQueue: Promise<unknown> = Promise.resolve();
let game = new Game(
  "SIMULATED PLAYERS",
  seeded(20261027),
  () => virtualTime,
  20261027,
);
let hostPaused = false,
  transportPaused = false,
  announcementBusy = false;
let channel = process.env.TWITCH_CHANNEL ?? "";
const session = randomBytes(32).toString("hex"),
  csrf = randomBytes(32).toString("hex");
const twitch = new Twitch(
  (msg) => {
    if (game.mode !== "REAL TWITCH") return;
    const isCommand = /^!(join|attack)\b/i.test(msg.text.trim());
    if (isCommand)
      game.log("chat-command-received", {
        messageId: msg.id,
        userId: msg.userId,
        name: msg.name,
        text: msg.text,
        twitchSentAt: msg.timestamp,
        phase: game.phase,
        selectedActor: game.actor,
        paused: game.paused,
        openedAt: game.openedAt,
        deadline: game.deadline,
      });
    const error = game.command(msg);
    // Capture a new result immediately, regardless of whether any OBS view is open.
    presentation.ready(game);
    if (isCommand)
      game.log("chat-command-validated", {
        messageId: msg.id,
        userId: msg.userId,
        outcome: error ? "rejected" : "accepted",
        reason: error,
        phaseAfter: game.phase,
      });
    if (
      error &&
      msg.userId === game.actor &&
      /^!attack/i.test(msg.text) &&
      Date.now() - lastErrorNotice > 2000
    ) {
      lastErrorNotice = Date.now();
      const current = game;
      void sendNotice(`@${msg.name} ${error}`).catch(() => {
        if (current === game) pauseTransport();
      });
    }
  },
  (connected) => {
    if (game.mode !== "REAL TWITCH") return;
    if (!connected) pauseTransport();
    else void recover();
  },
);
async function sendNotice(message: string) {
  const current = game;
  current.log("chat-notice-requested", { message });
  try {
    const receipt = await twitch.send(message);
    current.log("chat-notice-sent", { message, ...receipt });
  } catch {
    current.log("chat-notice-failed", { message });
    throw Error("Twitch notice delivery failed.");
  }
}
function pauseTransport() {
  if (game.mode !== "REAL TWITCH") return;
  recoveryAt = Date.now() + 2500;
  transportPaused = true;
  game.pause("Twitch connection or delivery failure");
}
function turnText() {
  return `Turn ${game.turn}: @${game.players.find((p) => p.id === game.actor)?.name}, you have ${Math.ceil(game.remaining / 1000)} seconds. Use !attack B3 C3 (your origin, adjacent target).`;
}
async function recover() {
  if (
    announcementBusy ||
    hostPaused ||
    !transportPaused ||
    !twitch.connected ||
    Date.now() < recoveryAt
  )
    return;
  announcementBusy = true;
  const current = game;
  try {
    await sendNotice(
      game.phase === "decision" || game.phase === "announcing"
        ? `Connection restored. ${turnText()}`
        : "Last Banner connection restored.",
    );
    if (current !== game || !twitch.connected) return;
    transportPaused = false;
    if (hostPaused) return;
    game.resume();
    if (game.phase === "announcing") game.notified();
  } catch {
    if (current === game) pauseTransport();
  } finally {
    announcementBusy = false;
  }
}
async function announce() {
  if (announcementBusy || game.paused || game.phase !== "ready") return;
  const current = game;
  if (game.mode === "FIXTURE") fixtureSelect(game);
  else game.select();
  if ((game.phase as string) !== "announcing") return;
  announcementBusy = true;
  try {
    if (game.mode === "REAL TWITCH") await sendNotice(turnText());
    if (game === current) game.notified();
  } catch {
    if (current === game) pauseTransport();
  } finally {
    announcementBusy = false;
  }
}
async function resumeHost() {
  if (!game.paused) return;
  if (announcementBusy)
    throw Error("Wait for the current notification to finish.");
  if (game.mode === "REAL TWITCH") {
    if (!twitch.connected) throw Error("Reconnect Twitch before resuming.");
    announcementBusy = true;
    try {
      await sendNotice(
        game.phase === "decision" || game.phase === "announcing"
          ? `Resuming. ${turnText()}`
          : "Last Banner resumed.",
      );
    } finally {
      announcementBusy = false;
    }
    if (!twitch.connected)
      throw Error("Twitch disconnected during the resume notice.");
  }
  hostPaused = false;
  transportPaused = false;
  game.resume();
  if (game.phase === "announcing") game.notified();
}
setInterval(() => {
  if (game.mode === "REAL TWITCH") {
    game.tick();
    if (presentation.ready(game)) {
      void winnerNotice.announce(game, twitch.connected, sendNotice);
      if (game.phase === "presentation" && !game.paused) game.presented();
    }
    if (game.phase === "ready" && !game.paused) void announce();
    if (transportPaused && twitch.connected) void recover();
  }
}, 100);
function publicState() {
  return {
    ...presentation.view(game),
    connection:
      game.mode === "REAL TWITCH"
        ? twitch.status
        : "Offline simulation — no Twitch commands",
  };
}
function json(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 8192) throw Error("Request too large");
  }
  return JSON.parse(data || "{}");
}
async function action(data: any) {
  switch (data.action) {
    case "reset": {
      if (data.confirm !== "RESET")
        throw Error("Type RESET to end the current game.");
      const mode: Mode = data.mode;
      if (!["FIXTURE", "SIMULATED PLAYERS", "REAL TWITCH"].includes(mode))
        throw Error("Invalid mode");
      twitch.disconnect();
      virtualTime = 1000;
      hostPaused = false;
      transportPaused = false;

      game =
        mode === "FIXTURE"
          ? fixture(() => virtualTime)
          : new Game(
              mode,
              mode === "REAL TWITCH" ? Math.random : seeded(20261027),
              mode === "REAL TWITCH" ? realNow : () => virtualTime,
              mode === "REAL TWITCH" ? undefined : 20261027,
            );
      break;
    }
    case "decision-time":
      game.setDecisionTime(data.seconds);
      break;
    case "add": {
      if (game.mode !== "SIMULATED PLAYERS")
        throw Error("Simulated participants are unavailable in this mode.");
      const n = Number(data.count);
      if (!Number.isInteger(n) || n < 1 || n > 100)
        throw Error("Choose 1–100 participants.");
      for (let i = 0; i < n; i++) {
        const k = game.players.length + 1;
        const error = game.join(`sim-${k}`, `Player ${k}`);
        if (error) throw Error(error);
      }
      break;
    }
    case "lobby":
      if (game.phase !== "lobby") throw Error("The game has already started.");
      game.lobbyOpen = Boolean(data.open);
      break;
    case "start":
      if (game.mode === "REAL TWITCH" && !twitch.connected)
        throw Error("Connect Twitch first.");
      game.start();
      await announce();
      break;
    case "next":
      if (!presentation.ready(game))
        throw Error("Wait for the current presentation to finish.");
      if (game.mode === "REAL TWITCH")
        throw Error("Real turns advance automatically.");
      game.presented();
      await announce();
      break;
    case "fixture":
      if (game.mode !== "FIXTURE") throw Error("Fixture mode required.");
      {
        const error = fixtureAttack(game);
        if (error) throw Error(error);
      }
      break;
    case "advance":
      if (game.mode === "REAL TWITCH")
        throw Error("Test clock is simulation-only.");
      {
        const ms = Number(data.ms);
        if (!Number.isFinite(ms) || ms < 0 || ms > 120000)
          throw Error("Invalid clock step.");
        virtualTime += ms;
        game.tick();
      }
      break;
    case "command":
      if (game.mode !== "SIMULATED PLAYERS")
        throw Error("Test commands are simulation-only.");
      {
        const error = game.command({
          id: randomUUID(),
          userId: game.actor ?? "",
          name: "Simulated",
          text: String(data.text),
          timestamp: game.now(),
        });
        if (error) throw Error(error);
      }
      break;
    case "pause":
      hostPaused = true;
      game.pause();
      break;
    case "resume":
      await resumeHost();
      break;
    case "connect":
      if (game.mode !== "REAL TWITCH" || game.phase !== "lobby")
        throw Error("Choose a real lobby before connecting.");
      channel = String(data.channel ?? "")
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9_]{1,25}$/.test(channel))
        throw Error("Enter the channel login, without URL or @.");
      await twitch.connect(channel);
      break;
    case "reconnect":
      if (game.mode !== "REAL TWITCH") throw Error("Real mode required.");
      await twitch.connect(channel);
      break;
    case "authorize":
      return { url: twitch.authorization() };
    default:
      throw Error("Unknown action");
  }
  presentation.ready(game);
  return { ok: true };
}
async function serve(req: IncomingMessage, res: ServerResponse, host: boolean) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  );
  const port = host ? 3101 : 3100;
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!allowed.includes(req.headers.host ?? ""))
    return json(res, 403, { error: "Invalid host" });
  const path = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;
  try {
    if (host) {
      if (req.headers["sec-fetch-site"] === "cross-site")
        return json(res, 403, {
          error: "Open the host directly on localhost.",
        });
      if (
        req.method === "GET" &&
        (path === "/" || path === "/host" || path === "/host/")
      ) {
        res.setHeader(
          "Set-Cookie",
          `lb_host=${session}; HttpOnly; SameSite=Strict; Path=/host`,
        );
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(await readFile("public/host.html"));
      }
      if (path.startsWith("/host/api")) {
        if (!req.headers.cookie?.split("; ").includes(`lb_host=${session}`))
          return json(res, 401, {
            error: "Reload the host page to restore your local session.",
          });
        if (req.method === "GET" && path === "/host/api/state")
          return json(res, 200, {
            ...publicState(),
            csrf,
            channel,
            configured: twitch.configured(),
            events: game.events.length,
          });
        if (req.method === "GET" && path === "/host/api/export") {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="last-banner-events.json"',
          );
          return json(res, 200, {
            session: "01a17e1f-8cda-7e10-9edb-2a313ceae747",
            state: publicState(),
            engineState: game.state(),
            events: game.events,
          });
        }
        if (req.method === "POST" && path === "/host/api/action") {
          if (
            !allowed
              .map((v) => "http://" + v)
              .includes(req.headers.origin ?? "") ||
            req.headers["x-csrf-token"] !== csrf
          )
            return json(res, 403, { error: "Invalid host request" });
          const data = await body(req);
          const job = actionQueue.then(() => action(data));
          actionQueue = job.catch(() => {});
          return json(res, 200, await job);
        }
      }
    } else {
      if (req.method === "GET" && path === "/api/state")
        return json(res, 200, publicState());
      if (req.method === "GET" && path === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(await readFile("public/index.html"));
      }
    }
    if (
      req.method === "GET" &&
      ["/app.js", "/style.css", "/audio.js", "/terrain.svg"].includes(path)
    ) {
      res.setHeader(
        "Content-Type",
        path.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : path.endsWith(".svg")
            ? "image/svg+xml"
            : "text/css; charset=utf-8",
      );
      return res.end(await readFile("public" + path));
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 400, {
      error: error instanceof Error ? error.message : "Request failed",
    });
  }
}
const servers = [
  createServer((q, s) => void serve(q, s, false)),
  createServer((q, s) => void serve(q, s, true)),
  createServer((req, res) => {
    void (async () => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      if (
        !["localhost:3102", "127.0.0.1:3102"].includes(req.headers.host ?? "")
      ) {
        res.writeHead(403);
        return res.end("Invalid host");
      }
      const url = new URL(req.url ?? "/", "http://localhost:3102");
      if (req.method !== "GET" || url.pathname !== "/oauth/callback") {
        res.writeHead(404);
        return res.end("Not found");
      }
      try {
        await twitch.callback(
          url.searchParams.get("code") ?? "",
          url.searchParams.get("state") ?? "",
        );
        res.end(
          "Last Banner authorized. Return to http://localhost:3101/host and connect.",
        );
      } catch {
        res.writeHead(400);
        res.end(
          "Authorization failed or expired. Return to the host and authorize again.",
        );
      }
    })();
  }),
];
for (const [i, s] of servers.entries()) {
  s.on("error", (err: NodeJS.ErrnoException) => {
    console.error(
      `Last Banner cannot listen on ${3100 + i}: ${err.code}. No other process was stopped.`,
    );
    for (const server of servers) server.close();
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 100);
  });
  s.listen(3100 + i, "127.0.0.1");
}
console.log(
  "Last Banner: OBS http://localhost:3100 | Host http://localhost:3101/host | OAuth http://localhost:3102/oauth/callback",
);
