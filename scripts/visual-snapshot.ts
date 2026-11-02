import { Game, seeded } from "../src/engine.js";
import { fixture, fixtureSelect, fixtureAttack } from "../src/fixture.js";
import { Presentation } from "../src/presentation.js";
import { writeFile } from "node:fs/promises";
const which = process.argv[2] ?? "six";
let now = 0,
  t = 0;
const p = new Presentation(() => t);
let g: Game;
if (
  ["six", "combat", "sudden", "victory", "neutral", "inactivity"].includes(
    which,
  )
) {
  g = fixture(() => now);
  const turns =
    which === "six"
      ? 0
      : which === "combat"
        ? 1
        : which === "inactivity"
          ? 3
          : which === "neutral"
            ? 4
            : 6;
  for (let turn = 1; turn <= turns; turn++) {
    g.presented();
    fixtureSelect(g);
    g.notified();
    if (turn === 3) {
      now += 15000;
      g.tick();
    } else fixtureAttack(g);
    p.view(g);
    if (turn < turns) t += 12000;
  }
  if (which === "combat") t += 4200;
  if (which === "sudden") t += Number(process.argv[3] ?? 6400);
  if (which === "victory") t += 12000;
  if (which === "neutral") t += 2000;
  if (which === "inactivity") t += 2000;
} else {
  const n = Number(which) || 100;
  g = new Game("SIMULATED PLAYERS", seeded(42), () => now);
  for (let i = 1; i <= n; i++)
    g.join(
      `p${i}`,
      i === 1
        ? "Alexandria_The_Unbroken_Banner_of_Northern_Lands"
        : `House ${i}`,
    );
  g.lobbyOpen = false;
  g.start();
  g.rng = () => 0;
  g.select();
  g.notified();
  if (process.argv[3] === "camera") {
    const from = g.cells.find((c) => c.owner === g.actor)!,
      to = g.cells.find((c) => c.owner !== g.actor && g.adjacent(c, from))!;
    const rolls = [6, 5, 1, 4, 2];
    g.command(
      {
        id: "visual",
        name: "Visual",
        userId: g.actor!,
        text: `!attack ${from.coord} ${to.coord}`,
        timestamp: now,
      },
      () => rolls.shift()!,
    );
    p.view(g);
    t += 3000;
  }
}
const s = { ...p.view(g), connection: "Visual test · simulated snapshot" };
await writeFile(".local/preview-state.json", JSON.stringify(s));
console.log(
  JSON.stringify({
    case: which,
    stage: s.presentation?.stage,
    cells: s.cells.length,
    winner: s.winner,
  }),
);
