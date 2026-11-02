export type Mode = "FIXTURE" | "SIMULATED PLAYERS" | "REAL TWITCH";
export type Player = {
  id: string;
  name: string;
  color: string;
  active: boolean;
};
export type Cell = {
  coord: string;
  x: number;
  y: number;
  owner: string | null;
};
export type Phase =
  "lobby" | "ready" | "announcing" | "decision" | "presentation" | "finished";
export type Chat = {
  id: string;
  userId: string;
  name: string;
  text: string;
  timestamp: number;
};
export function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function battle(die: () => number) {
  const roll = () => {
    const n = die();
    if (!Number.isInteger(n) || n < 1 || n > 6) throw Error("Invalid die");
    return n;
  };
  const attack = [roll(), roll(), roll()];
  const kept = [...attack].sort((a, b) => b - a).slice(0, 2);
  const defense = [roll(), roll()].sort((a, b) => b - a);
  const comparisons = kept.map((v, i) => Math.sign(v - defense[i]));
  const score = [
    comparisons.filter((v) => v > 0).length,
    comparisons.filter((v) => v < 0).length,
  ];
  const sudden: number[][] = [];
  let attackerWins = score[0] > score[1];
  if (score[0] === score[1]) {
    let a: number, b: number;
    do {
      a = roll();
      b = roll();
      sudden.push([a, b]);
    } while (a === b);
    attackerWins = a > b;
  }
  return { attack, kept, defense, comparisons, score, sudden, attackerWins };
}
export class Game {
  players: Player[] = [];
  cells: Cell[] = [];
  phase: Phase = "lobby";
  lobbyOpen = true;
  turn = 0;
  actor: string | null = null;
  winner: string | null = null;
  paused = false;
  decisionMs = 30000;
  remaining = 30000;
  deadline = 0;
  openedAt = 0;
  last: any = null;
  counts = { combat: 0, inactivity: 0, neutral: 0 };
  events: any[] = [];
  private seen = new Set<string>();
  constructor(
    public mode: Mode,
    public rng: () => number = Math.random,
    public now: () => number = Date.now,
    public seed?: number,
  ) {}
  setDecisionTime(seconds: unknown) {
    if (this.phase !== "lobby" || this.mode === "FIXTURE")
      throw Error("Decision time is locked for this match.");
    if (
      typeof seconds !== "number" ||
      !Number.isInteger(seconds) ||
      seconds < 15 ||
      seconds > 120
    )
      throw Error("Decision time must be an integer from 15 to 120 seconds.");
    this.decisionMs = seconds * 1000;
    this.remaining = this.decisionMs;
    this.log("decision-time", { decisionMs: this.decisionMs });
  }
  log(type: string, data: object = {}) {
    this.events.push({
      index: this.events.length,
      at: this.now(),
      turn: this.turn,
      type,
      ...data,
    });
  }
  join(id: string, name: string) {
    if (this.phase !== "lobby" || !this.lobbyOpen)
      return "Registration is closed.";
    if (this.players.some((p) => p.id === id)) return "Already registered.";
    if (this.players.length >= 100) return "Lobby is full (100 players).";
    this.players.push({
      id,
      name: name.slice(0, 50),
      active: true,
      color: `hsl(${(this.players.length * 137.508) % 360} 58% 48%)`,
    });
    this.log("join", { id, name });
    return null;
  }
  start() {
    if (this.phase !== "lobby" || this.lobbyOpen || this.players.length < 2)
      throw Error("Close a lobby with 2–100 players first.");
    const ids = this.players.map((p) => p.id);
    if (this.mode !== "FIXTURE")
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    const cols = Math.ceil(Math.sqrt(ids.length));
    this.cells = ids.map((owner, i) => ({
      owner,
      x: i % cols,
      y: Math.floor(i / cols),
      coord: `${String.fromCharCode(65 + (i % cols))}${Math.floor(i / cols) + 1}`,
    }));
    this.phase = "ready";
    this.log("start", {
      mode: this.mode,
      decisionMs: this.decisionMs,
      seed: this.seed,
      map: structuredClone(this.cells),
    });
    this.assert();
  }
  active() {
    return this.players.filter((p) => p.active);
  }
  select(forced?: string) {
    if (this.phase !== "ready" || this.paused) return false;
    if (forced && this.mode !== "FIXTURE")
      throw Error("Forced selection is fixture-only.");
    const active = this.active();
    this.actor = forced ?? active[Math.floor(this.rng() * active.length)].id;
    if (!active.some((p) => p.id === this.actor)) throw Error("Inactive actor");
    this.turn++;
    this.remaining = this.decisionMs;
    this.phase = "announcing";
    this.log("selected", { actor: this.actor, decisionMs: this.decisionMs });
    return true;
  }
  notified() {
    if (this.phase !== "announcing" || this.paused) return false;
    this.phase = "decision";
    this.openedAt = this.now();
    this.deadline = this.now() + this.remaining;
    this.log("window-open", { actor: this.actor, deadline: this.deadline });
    return true;
  }
  pause(reason = "Host pause") {
    if (this.paused) return;
    if (this.phase === "decision")
      this.remaining = Math.max(0, this.deadline - this.now());
    this.paused = true;
    this.log("pause", { reason, remaining: this.remaining });
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.phase === "decision") {
      this.openedAt = this.now();
      this.deadline = this.now() + this.remaining;
    }
    this.log("resume", { remaining: this.remaining });
  }
  tick() {
    if (
      this.phase === "decision" &&
      !this.paused &&
      this.now() >= this.deadline
    ) {
      const before = this.ranking();
      const beforeCells = structuredClone(this.cells);
      const loser = this.actor!;
      const transferred = this.cells
        .filter((c) => c.owner === loser)
        .map((c) => c.coord);
      this.cells.forEach((c) => {
        if (c.owner === loser) c.owner = null;
      });
      this.players.find((p) => p.id === loser)!.active = false;
      this.counts.inactivity++;
      this.finishResult({
        kind: "inactivity",
        loser,
        transferred,
        before,
        beforeCells,
      });
      return true;
    }
    return false;
  }
  component(coord: string) {
    const start = this.cells.find((c) => c.coord === coord && c.owner === null);
    if (!start) return [];
    const found = [start];
    for (let i = 0; i < found.length; i++)
      for (const c of this.cells)
        if (
          c.owner === null &&
          !found.includes(c) &&
          this.adjacent(found[i], c)
        )
          found.push(c);
    return found;
  }
  adjacent(a: Cell, b: Cell) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  }
  command(msg: Chat, die = () => 1 + Math.floor(this.rng() * 6)) {
    if (this.seen.has(msg.id)) return "Duplicate message.";
    this.seen.add(msg.id);
    if (this.seen.size > 20000)
      this.seen.delete(this.seen.values().next().value!);
    if (msg.text.trim().toLowerCase() === "!join")
      return this.join(msg.userId, msg.name);
    if (!/^!attack\b/i.test(msg.text.trim())) return null;
    if (this.phase !== "decision" || this.paused)
      return "No decision window is open.";
    if (msg.userId !== this.actor)
      return "Only the selected player may attack.";
    if (
      !Number.isFinite(msg.timestamp) ||
      msg.timestamp < this.openedAt ||
      msg.timestamp > this.now() + 2000
    )
      return "Message is outside the current turn window.";
    if (this.now() >= this.deadline || msg.timestamp >= this.deadline) {
      this.tick();
      return "The turn has expired.";
    }
    const match = /^!attack\s+([a-j]\d{1,2})\s+([a-j]\d{1,2})$/i.exec(
      msg.text.trim(),
    );
    if (!match) return "Use !attack B3 C3.";
    const from = this.cells.find((c) => c.coord === match[1].toUpperCase()),
      to = this.cells.find((c) => c.coord === match[2].toUpperCase());
    if (!from || !to) return "That coordinate does not exist.";
    if (from.owner !== this.actor) return "The origin must belong to you.";
    if (!this.adjacent(from, to))
      return "Choose an orthogonally adjacent destination.";
    if (to.owner === this.actor) return "You already own the destination.";
    const before = this.ranking();
    const beforeCells = structuredClone(this.cells);
    let result: any;
    if (to.owner === null) {
      const transferred = this.component(to.coord).map((c) => c.coord);
      this.cells
        .filter((c) => transferred.includes(c.coord))
        .forEach((c) => (c.owner = this.actor));
      this.counts.neutral++;
      result = { kind: "neutral", winner: this.actor, transferred };
    } else {
      const rolls = battle(die);
      const winner = rolls.attackerWins ? this.actor! : to.owner;
      const loser = rolls.attackerWins ? to.owner : this.actor!;
      const transferred = this.cells
        .filter((c) => c.owner === loser)
        .map((c) => c.coord);
      this.cells.forEach((c) => {
        if (c.owner === loser) c.owner = winner;
      });
      this.players.find((p) => p.id === loser)!.active = false;
      this.counts.combat++;
      result = { kind: "combat", winner, loser, rolls, transferred };
    }
    this.log("accepted", {
      messageId: msg.id,
      actor: this.actor,
      text: msg.text,
      timestamp: msg.timestamp,
    });
    this.finishResult({
      ...result,
      from: from.coord,
      to: to.coord,
      before,
      beforeCells,
    });
    return null;
  }
  private finishResult(result: any) {
    this.phase = "presentation";
    this.last = {
      ...result,
      turn: this.turn,
      actor: this.actor,
      after: this.ranking(),
    };
    this.log("result", this.last);
    if (this.active().length === 1) {
      this.winner = this.active()[0].id;
      this.phase = "finished";
      this.log("finished", { winner: this.winner, counts: { ...this.counts } });
    }
    this.assert();
  }
  presented() {
    if (this.phase === "presentation") this.phase = "ready";
  }
  ranking() {
    const rows = this.players
      .map((p, i) => ({
        ...p,
        count: this.cells.filter((c) => c.owner === p.id).length,
        order: i,
      }))
      .sort((a, b) => b.count - a.count || a.order - b.order);
    return rows.map((p, i) => ({
      ...p,
      rank: rows.findIndex((q) => q.count === p.count) + 1,
    }));
  }
  assert() {
    if (this.cells.length !== this.players.length)
      throw Error("Territory conservation failed");
    for (const c of this.cells)
      if (
        c.owner !== null &&
        !this.players.some((p) => p.id === c.owner && p.active)
      )
        throw Error("Inactive owner");
    for (const p of this.active())
      if (!this.cells.some((c) => c.owner === p.id))
        throw Error("Empty active empire");
  }
  state() {
    return {
      mode: this.mode,
      decisionMs: this.decisionMs,
      seed: this.seed,
      players: this.players,
      cells: this.cells,
      phase: this.phase,
      lobbyOpen: this.lobbyOpen,
      turn: this.turn,
      actor: this.actor,
      winner: this.winner,
      paused: this.paused,
      remaining:
        this.phase === "decision" && !this.paused
          ? Math.max(0, this.deadline - this.now())
          : this.remaining,
      last: this.last,
      counts: this.counts,
      ranking: this.ranking(),
      serverTime: this.now(),
    };
  }
}
