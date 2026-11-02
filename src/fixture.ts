import { Game, seeded } from "./engine.js";
export const steps = [
  { actor: "ana", command: "!attack A1 B1", dice: [6, 4, 1, 5, 3] },
  { actor: "ana", command: "!attack B1 C1", dice: [4, 2, 1, 6, 3] },
  { actor: "elena", command: null, dice: [] },
  { actor: "diego", command: "!attack A2 B2", dice: [] },
  { actor: "diego", command: "!attack B2 C2", dice: [5, 4, 1, 5, 2] },
  {
    actor: "carla",
    command: "!attack B1 B2",
    dice: [6, 2, 1, 6, 2, 4, 4, 2, 5],
  },
];
export function fixture(now: () => number) {
  const g = new Game("FIXTURE", seeded(6), now, 6);
  g.decisionMs = g.remaining = 15000;
  for (const name of ["Ana", "Bruno", "Carla", "Diego", "Elena", "Fabio"])
    g.join(name.toLowerCase(), name);
  g.lobbyOpen = false;
  g.start();
  return g;
}
export function fixtureSelect(g: Game) {
  const step = steps[g.turn];
  if (step) g.select(step.actor);
}
export function fixtureAttack(g: Game) {
  const step = steps[g.turn - 1];
  if (!step?.command) throw Error("This fixture turn must expire.");
  let i = 0;
  return g.command(
    {
      id: `fixture-${g.turn}`,
      userId: step.actor,
      name: step.actor,
      text: step.command,
      timestamp: g.now(),
    },
    () => {
      if (i >= step.dice.length) throw Error("Unexpected fixture die");
      return step.dice[i++];
    },
  );
}
