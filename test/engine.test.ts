import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, battle, seeded } from "../src/engine.js";
import { fixture, fixtureSelect, fixtureAttack } from "../src/fixture.js";
test("notification gates the clock; disconnected timeout merges neutral components", () => {
  let now = 1000;
  const g = fixture(() => now);
  g.cells[5].owner = "elena";
  g.players.find((p) => p.id === "fabio")!.active = false;
  g.cells[1].owner = null;
  g.players.find((p) => p.id === "bruno")!.active = false;
  g.select("elena");
  now += 60000;
  assert.equal(g.tick(), false);
  assert.equal(g.phase, "announcing");
  g.notified();
  now += 14999;
  assert.equal(g.tick(), false);
  now++;
  assert.equal(g.tick(), true);
  assert.deepEqual(g.last.transferred, ["B2", "C2"]);
  assert.deepEqual(
    g
      .component("B1")
      .map((c) => c.coord)
      .sort(),
    ["B1", "B2", "C2"],
  );
  assert.equal(g.join("elena", "Elena"), "Registration is closed.");
  g.assert();
});
test("uniform active-index selection ignores territory size and permits repeat", () => {
  const g = fixture(() => 0);
  g.cells[1].owner = "ana";
  g.players[1].active = false;
  g.mode = "SIMULATED PLAYERS";
  g.rng = () => 0;
  g.select();
  assert.equal(g.actor, "ana");
  g.phase = "ready";
  g.select();
  assert.equal(g.actor, "ana");
  g.phase = "ready";
  g.rng = () => 0.999999;
  g.select();
  assert.equal(g.actor, "fabio");
});
test("exact six-turn fixture, full absorption and no seventh turn", () => {
  let now = 1000;
  const g = fixture(() => now);
  const expected = [
    [2, 0, 1, 1, 1, 1],
    [0, 0, 3, 1, 1, 1],
    [0, 0, 3, 1, 0, 1],
    [0, 0, 3, 2, 0, 1],
    [0, 0, 3, 3, 0, 0],
    [0, 0, 0, 6, 0, 0],
  ];
  for (let i = 0; i < 6; i++) {
    fixtureSelect(g);
    g.notified();
    if (i === 2) {
      now += 15000;
      g.tick();
    } else assert.equal(fixtureAttack(g), null);
    assert.deepEqual(
      g.players.map((p) => g.cells.filter((c) => c.owner === p.id).length),
      expected[i],
    );
    g.assert();
    g.presented();
  }
  assert.equal(g.winner, "diego");
  assert.equal(g.phase, "finished");
  assert.deepEqual(g.counts, { combat: 4, inactivity: 1, neutral: 1 });
  assert.deepEqual(g.last.rolls.sudden, [
    [4, 4],
    [2, 5],
  ]);
  assert.equal(g.select(), false);
  assert.equal(g.turn, 6);
});
function ready(n = 6) {
  let time = 1000;
  const g = new Game("SIMULATED PLAYERS", seeded(123), () => time, 123);
  g.setDecisionTime(15);
  for (let i = 0; i < n; i++) g.join(String(i), `Player ${i}`);
  g.lobbyOpen = false;
  g.start();
  g.select();
  g.notified();
  return { g, advance: (n: number) => (time += n) };
}
function msg(
  g: Game,
  text: string,
  id = "m",
  userId = g.actor!,
  timestamp = g.now(),
) {
  return { id, text, userId, name: userId, timestamp };
}
test("legal commands, stale, duplicate and timeout race", () => {
  const { g, advance } = ready();
  const from = g.cells.find((c) => c.owner === g.actor)!;
  const to = g.cells.find((c) => g.adjacent(c, from))!;
  const valid = `!attack ${from.coord} ${to.coord}`;
  const snapshot = JSON.stringify(g.state());
  for (const m of [
    msg(g, "!attack J99 A1", "a"),
    msg(g, valid, "b", "other"),
    msg(g, valid, "c", g.actor!, 999),
    msg(g, `!attack ${from.coord} ${from.coord}`, "d"),
  ])
    assert.ok(g.command(m));
  assert.equal(JSON.stringify(g.state()), snapshot);
  const m = msg(g, valid);
  assert.equal(g.command(m), null);
  assert.ok(g.command(m));
  advance(15000);
  assert.equal(g.tick(), false);
  assert.equal(g.counts.combat, 1);
  const r = ready();
  r.advance(15000);
  assert.equal(r.g.tick(), true);
  assert.ok(r.g.command(msg(r.g, valid)));
  assert.equal(r.g.counts.inactivity, 1);
});
test("pause freezes clock and rejects buffered messages on resume", () => {
  const { g, advance } = ready();
  advance(4000);
  g.pause();
  advance(60000);
  assert.equal(g.tick(), false);
  assert.equal(g.remaining, 11000);
  const old = g.openedAt;
  g.resume();
  assert.ok(g.command(msg(g, "!attack A1 B1", "old", g.actor!, old)));
  advance(10999);
  assert.equal(g.tick(), false);
  advance(1);
  assert.equal(g.tick(), true);
});
test("neutral component only, including merged abandoned lands, ends turn", () => {
  let t = 0;
  const g = fixture(() => t);
  g.cells.forEach((c) => (c.owner = null));
  g.cells[0].owner = "ana";
  g.cells[2].owner = "carla";
  g.cells[5].owner = "fabio";
  g.players.forEach(
    (p) => (p.active = ["ana", "carla", "fabio"].includes(p.id)),
  );
  g.select("ana");
  g.notified();
  assert.equal(g.component("B1").length, 3);
  assert.equal(
    g.command(msg(g, " !AtTaCk  A1   B1 "), () => {
      throw Error("No dice for gray");
    }),
    null,
  );
  assert.equal(g.phase, "presentation");
  assert.equal(g.active().length, 3);
  assert.equal(g.cells.filter((c) => c.owner === "ana").length, 4);
  assert.ok(g.command(msg(g, "!attack B1 C1", "second")));
});
test("disconnected neutral components and disconnected total absorption", () => {
  const g = fixture(() => 1);
  g.cells[1].owner = null;
  g.cells[3].owner = null;
  g.players.find((p) => p.id === "bruno")!.active = false;
  g.players.find((p) => p.id === "diego")!.active = false;
  assert.equal(g.component("B1").length, 1);
  g.cells[5].owner = "carla";
  g.players.find((p) => p.id === "fabio")!.active = false;
  g.select("elena");
  g.notified();
  let i = 0;
  const dice = [6, 6, 1, 1, 1];
  assert.equal(
    g.command(msg(g, "!attack B2 C2"), () => dice[i++]),
    null,
  );
  assert.equal(g.cells.filter((c) => c.owner === "elena").length, 3);
  assert.equal(
    g.cells.some((c) => c.owner === "carla"),
    false,
  );
});
test("timeout neutralizes disconnected empire; last active wins with gray", () => {
  const { g, advance } = ready(2);
  advance(15000);
  g.tick();
  assert.equal(g.phase, "finished");
  assert.equal(g.cells.filter((c) => c.owner === null).length, 1);
  assert.equal(g.select(), false);
});
test("board connected, unique assignment and tied ranks at checked sizes", () => {
  for (const n of [2, 10, 30, 100]) {
    const { g } = ready(n);
    assert.equal(new Set(g.cells.map((c) => c.owner)).size, n);
    assert.ok(g.ranking().every((p) => p.rank === 1));
    const visited = [g.cells[0]];
    for (let i = 0; i < visited.length; i++)
      for (const c of g.cells)
        if (!visited.includes(c) && g.adjacent(c, visited[i])) visited.push(c);
    assert.equal(visited.length, n);
    g.assert();
  }
});
test("dice comparisons, discarded minimum and repeated sudden death", () => {
  let i = 0;
  const d = [2, 6, 1, 6, 2, 4, 4, 2, 5];
  const b = battle(() => d[i++]);
  assert.deepEqual(b.kept, [6, 2]);
  assert.deepEqual(b.score, [0, 0]);
  assert.deepEqual(b.sudden, [
    [4, 4],
    [2, 5],
  ]);
  assert.equal(b.attackerWins, false);
});
