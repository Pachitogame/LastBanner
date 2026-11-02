import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine.js";
for (const seconds of [15, 30, 60])
  test(`decision ${seconds}s gates, freezes, resumes and expires once`, () => {
    let now = 1000;
    const g = new Game(
      "SIMULATED PLAYERS",
      () => 0,
      () => now,
    );
    assert.equal(g.decisionMs, 30000);
    g.setDecisionTime(seconds);
    g.join("a", "A");
    g.join("b", "B");
    g.lobbyOpen = false;
    g.start();
    g.select();
    now += 100000;
    assert.equal(g.tick(), false);
    g.notified();
    assert.equal(g.deadline - now, seconds * 1000);
    now += 4000;
    g.pause("transport");
    const left = g.remaining;
    now += 90000;
    assert.equal(g.tick(), false);
    g.resume();
    assert.equal(g.deadline - now, left);
    assert.equal(left, seconds * 1000 - 4000);
    now += left - 1;
    assert.equal(g.tick(), false);
    now++;
    assert.equal(g.tick(), true);
    assert.equal(g.tick(), false);
    assert.equal(g.counts.inactivity, 1);
    assert.throws(() => g.setDecisionTime(30), /locked/);
  });
test("time validation and immutable after start, defaults reset for a new match", () => {
  const g = new Game("SIMULATED PLAYERS");
  for (const v of [14, 121, 15.5, NaN, Infinity, "30", null])
    assert.throws(() => g.setDecisionTime(v), /integer/);
  g.setDecisionTime(120);
  assert.equal(g.state().decisionMs, 120000);
  g.join("a", "A");
  g.join("b", "B");
  g.lobbyOpen = false;
  g.start();
  assert.throws(() => g.setDecisionTime(15), /locked/);
  assert.equal(new Game("REAL TWITCH").decisionMs, 30000);
});
