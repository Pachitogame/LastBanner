import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine.js";
import { WinnerNotice } from "../src/winner-notice.js";

function finished() {
  let now = 0;
  const game = new Game(
    "REAL TWITCH",
    () => 0,
    () => now,
  );
  game.join("one", "First");
  game.join("two", "Second");
  game.lobbyOpen = false;
  game.start();
  game.select();
  game.notified();
  now = game.decisionMs;
  game.tick();
  assert.equal(game.phase, "finished");
  return game;
}

test("winner notice claims once before delivery; refresh/reconnect do not resend; next match can send", async () => {
  const gate = new WinnerNotice(),
    game = finished(),
    messages: string[] = [];
  let release!: () => void;
  const send = async (message: string) => {
    messages.push(message);
    await new Promise<void>((r) => (release = r));
  };
  await gate.announce(game, false, send);
  assert.equal(messages.length, 0);
  const pending = gate.announce(game, true, send);
  game.state(); // A browser refresh only reads this state.
  await gate.announce(game, true, send);
  await gate.announce(game, false, send);
  await gate.announce(game, true, send);
  assert.equal(messages.length, 1);
  assert.equal(
    messages[0],
    `Last Banner winner: ${game.players.find((p) => p.id === game.winner)!.name} — 1 territory.`,
  );
  release();
  await pending;
  await gate.announce(game, true, send);
  const next = finished();
  next.cells.forEach((c) => (c.owner = next.winner));
  await gate.announce(next, true, async (m) => {
    messages.push(m);
  });
  assert.equal(messages.length, 2);
  assert.match(messages[1], /2 territories\.$/);
});

test("ambiguous winner delivery is recorded and never retried; unfinished and simulated games stay silent", async () => {
  const gate = new WinnerNotice(),
    game = finished();
  let calls = 0;
  const send = async () => {
    calls++;
    throw Error("response lost");
  };
  await gate.announce(game, true, send);
  await gate.announce(game, true, send);
  assert.equal(calls, 1);
  assert.equal(
    game.events.filter((e) => e.type === "winner-notice-unconfirmed").length,
    1,
  );
  const lobby = new Game("REAL TWITCH");
  await gate.announce(lobby, true, send);
  const simulated = finished();
  simulated.mode = "SIMULATED PLAYERS";
  await gate.announce(simulated, true, send);
  assert.equal(calls, 1);
});
