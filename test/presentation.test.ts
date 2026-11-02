import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, fixtureSelect, fixtureAttack } from "../src/fixture.js";
import { Presentation, timing } from "../src/presentation.js";

test("public presentation hides computed outcome and preserves every old owner until reveal", () => {
  let t = 0;
  const g = fixture(() => 0),
    p = new Presentation(() => t);
  fixtureSelect(g);
  g.notified();
  const old = structuredClone(g.cells);
  fixtureAttack(g);
  assert.equal(g.cells[1].owner, "ana");
  let v = p.view(g);
  const id = v.presentation.id;
  assert.deepEqual(v.cells, old);
  assert.equal(v.last.winner, undefined);
  assert.equal(v.last.rolls, undefined);
  assert.equal(v.winner, null);
  t = 2000;
  v = p.view(g);
  assert.deepEqual(v.last.rolls.attack, [6, 4, 1]);
  assert.equal(v.last.rolls.comparisons, undefined);
  t = 3000;
  v = p.view(g);
  assert.equal(v.last.rolls.comparisons.length, 1);
  assert.equal(v.last.rolls.score, undefined);
  t = 4000;
  v = p.view(g);
  assert.equal(v.last.rolls.comparisons.length, 2);
  assert.equal(v.last.winner, undefined);
  t = 5100;
  v = p.view(g);
  assert.equal(v.last.winner, "ana");
  assert.deepEqual(v.cells, old);
  assert.equal(v.presentation.stage, "resolve");
  t = 5800;
  v = p.view(g);
  assert.equal(v.cells[1].owner, "ana");
  assert.equal(v.presentation.stage, "transfer");
  assert.equal(v.presentation.id, id);
  assert.equal(p.ready(g), false);
  t = 7500;
  assert.equal(p.ready(g), true);
  assert.equal(p.view(g).presentation.stage, "complete");
  assert.equal(g.events.filter((e) => e.type === "result").length, 1);
});
test("six-turn fixture, neutral ends turn, all sudden-death rounds and delayed final without replay", () => {
  let now = 0,
    t = 0;
  const g = fixture(() => now),
    p = new Presentation(() => t);
  for (let turn = 1; turn <= 6; turn++) {
    g.presented();
    fixtureSelect(g);
    g.notified();
    if (turn === 3) {
      now += 15000;
      g.tick();
    } else fixtureAttack(g);
    const v = p.view(g);
    assert.equal(v.phase, "presentation");
    assert.equal(v.winner, null);
    if (turn === 4) {
      assert.equal(g.counts.neutral, 1);
      assert.equal(g.phase, "presentation");
      assert.equal(v.last.rolls, undefined);
    }
    if (turn === 6) {
      assert.equal(g.winner, "diego");
      assert.equal(v.cells.filter((c: any) => c.owner === "carla").length, 3);
      t += 5100;
      let mid = p.view(g);
      assert.equal(mid.presentation.stage, "sudden-intro");
      assert.equal(mid.last.rolls.sudden, undefined);
      t += 500;
      mid = p.view(g);
      assert.equal(mid.presentation.stage, "sudden-roll");
      assert.equal(mid.presentation.suddenRound, 1);
      assert.deepEqual(mid.last.rolls.sudden, []);
      t += 700;
      mid = p.view(g);
      assert.equal(mid.presentation.stage, "sudden-compare");
      assert.deepEqual(mid.last.rolls.sudden, [[4, 4]]);
      assert.equal(mid.last.winner, undefined);
      t += 1100;
      mid = p.view(g);
      assert.equal(mid.presentation.stage, "sudden-roll");
      assert.equal(mid.presentation.suddenRound, 2);
      assert.deepEqual(mid.last.rolls.sudden, [[4, 4]]);
      assert.deepEqual(mid.cells, v.cells);
      assert.deepEqual(mid.ranking, v.ranking);
      assert.equal(p.ready(g), false);
      t += 700;
      mid = p.view(g);
      assert.equal(mid.presentation.stage, "sudden-compare");
      assert.deepEqual(mid.last.rolls.sudden, [
        [4, 4],
        [2, 5],
      ]);
      assert.equal(mid.winner, null);
      assert.equal(mid.last.winner, undefined);
      assert.deepEqual(mid.cells, v.cells);
      assert.deepEqual(mid.ranking, v.ranking);
    }
    t += 12000;
    assert.equal(p.ready(g), true);
  }
  const final = p.view(g);
  assert.equal(final.winner, "diego");
  assert.equal(final.cells.filter((c: any) => c.owner === "diego").length, 6);
  const again = p.view(g);
  assert.equal(again.presentation.id, final.presentation.id);
  assert.equal(again.presentation.active, false);
  assert.equal(g.turn, 6);
  assert.deepEqual(g.counts, { combat: 4, inactivity: 1, neutral: 1 });
  assert.equal(
    timing({ kind: "combat", rolls: { sudden: Array(1000).fill([4, 4]) } })
      .duration,
    8000 + 1000 * 1800,
  );
});
