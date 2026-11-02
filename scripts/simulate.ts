import { Game, seeded } from "../src/engine.js";
import { writeFileSync, mkdirSync } from "node:fs";
const results = [];
for (const n of [10, 30, 100]) {
  const seed = 20261027 + n;
  let time = 0;
  const g = new Game("SIMULATED PLAYERS", seeded(seed), () => time, seed);
  for (let i = 0; i < n; i++) g.join(`sim-${i}`, `Sim ${i + 1}`);
  g.lobbyOpen = false;
  g.start();
  const start = performance.now();
  while (g.phase !== "finished" && g.turn < 10000) {
    g.select();
    g.notified();
    if (g.turn % 7 === 0) {
      time += g.decisionMs;
      g.tick();
    } else {
      const options = g.cells.flatMap((a) =>
        a.owner === g.actor
          ? g.cells
              .filter((b) => b.owner !== a.owner && g.adjacent(a, b))
              .map((b) => [a, b])
          : [],
      );
      const [a, b] = options[Math.floor(g.rng() * options.length)];
      const error = g.command({
        id: `sim-${g.turn}`,
        userId: g.actor!,
        name: "Sim",
        text: `!attack ${a.coord} ${b.coord}`,
        timestamp: time,
      });
      if (error) throw Error(error);
    }
    g.assert();
    g.presented();
  }
  if (!g.winner) throw Error("Did not terminate");
  results.push({
    players: n,
    seed,
    policy:
      "Uniform legal frontier; every seventh turn times out; no presentation delay",
    turns: g.turn,
    counts: g.counts,
    computeMs: +(performance.now() - start).toFixed(2),
    winner: g.winner,
    neutral: g.cells.filter((c) => c.owner === null).length,
  });
  mkdirSync("evidence", { recursive: true });
  writeFileSync(
    `evidence/simulation-${n}.json`,
    JSON.stringify({ summary: results.at(-1), events: g.events }, null, 2),
  );
}
writeFileSync("evidence/simulations.json", JSON.stringify(results, null, 2));
console.log(results);
