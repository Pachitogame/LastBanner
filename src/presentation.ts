import { randomUUID } from "node:crypto";
import type { Game } from "./engine.js";
export function timing(result: any) {
  const suddenMs = result?.rolls?.sudden.length
    ? 500 + result.rolls.sudden.length * 1800
    : 0;
  const reveal = result.kind === "combat" ? 5100 + suddenMs : 1200;
  return {
    reveal,
    duration: reveal + (result.kind === "combat" ? 2400 : 1800),
    suddenMs,
  };
}
export class Presentation {
  private games = new WeakMap<Game, { id: string; last: any; start: number }>();
  constructor(private now: () => number = Date.now) {}
  private entry(g: Game) {
    let e = this.games.get(g);
    if (!e) {
      e = { id: randomUUID(), last: null, start: 0 };
      this.games.set(g, e);
    }
    if (g.last && e.last !== g.last) {
      e.last = g.last;
      e.start = this.now();
    }
    return e;
  }
  ready(g: Game) {
    const e = this.entry(g);
    return !e.last || this.now() >= e.start + timing(e.last).duration;
  }
  view(g: Game): any {
    const e = this.entry(g),
      s = structuredClone(g.state());
    const base = {
      ...s,
      matchId: e.id,
      viewTime: this.now(),
      presentation: null,
    };
    if (!e.last) return base;
    const r = e.last,
      t = timing(r),
      elapsed = Math.max(0, this.now() - e.start),
      active = elapsed < t.duration;
    let stage = "complete";
    if (active)
      stage =
        elapsed >= t.reveal
          ? elapsed < t.reveal + 650
            ? "resolve"
            : "transfer"
          : r.kind !== "combat"
            ? "claim"
            : elapsed < 900
              ? "frontier"
              : elapsed < 1800
                ? "roll"
                : elapsed < 2700
                  ? "keep"
                  : elapsed < 3900
                    ? "compare-1"
                    : elapsed < 5100
                      ? "compare-2"
                      : "sudden";
    const suddenOffset = elapsed - 5600;
    const suddenRound = Math.max(0, Math.floor(suddenOffset / 1800));
    if (stage === "sudden")
      stage =
        elapsed < 5600
          ? "sudden-intro"
          : suddenOffset % 1800 < 700
            ? "sudden-roll"
            : "sudden-compare";
    const p = {
      id: `${e.id}:${r.turn}`,
      startedAt: e.start,
      elapsed,
      duration: t.duration,
      revealAt: t.reveal,
      stage,
      active,
      suddenMs: t.suddenMs,
      suddenRound:
        stage.startsWith("sudden-") && stage !== "sudden-intro"
          ? suddenRound + 1
          : null,
    };
    const revealed = elapsed >= t.reveal;
    // Remove snapshots and computed outcomes until their scheduled reveal, even from public JSON.
    const last: any = {
      kind: r.kind,
      turn: r.turn,
      actor: r.actor,
      from: r.from,
      to: r.to,
    };
    if (r.kind === "combat") {
      last.defender = r.beforeCells.find((c: any) => c.coord === r.to)?.owner;
      if (elapsed >= 1800) {
        last.rolls = {
          attack: r.rolls.attack,
          defense: r.rolls.defense,
          kept: r.rolls.kept,
        };
      }
      if (elapsed >= 2700)
        last.rolls.comparisons = r.rolls.comparisons.slice(
          0,
          elapsed >= 3900 ? 2 : 1,
        );
      if (elapsed >= 5600 && r.rolls.sudden.length) {
        const n = Math.min(
          r.rolls.sudden.length,
          suddenRound + (suddenOffset % 1800 >= 700 ? 1 : 0),
        );
        last.rolls.sudden = r.rolls.sudden.slice(0, n);
      }
    }
    if (!revealed) {
      base.cells = structuredClone(r.beforeCells);
      base.players = r.before
        .slice()
        .sort((a: any, b: any) => a.order - b.order)
        .map(({ id, name, color, active }: any) => ({
          id,
          name,
          color,
          active,
        }));
      base.ranking = structuredClone(r.before);
      base.winner = null;
      base.phase = "presentation";
      base.counts[r.kind as "combat" | "neutral" | "inactivity"]--;
    } else {
      if (elapsed < t.reveal + 650) {
        base.cells = structuredClone(r.beforeCells);
        base.ranking = structuredClone(r.before);
        base.players = r.before
          .slice()
          .sort((a: any, b: any) => a.order - b.order)
          .map(({ id, name, color, active }: any) => ({
            id,
            name,
            color,
            active,
          }));
      }
      Object.assign(last, {
        winner: r.winner,
        loser: r.loser,
        transferred: r.transferred,
        before: r.before,
        after: r.after,
      });
      if (r.rolls) last.rolls = structuredClone(r.rolls);
      // Keep the victory composition until the complete transfer has been visible.
      if (active) {
        base.winner = null;
        base.phase = "presentation";
      }
    }
    return { ...base, last, presentation: p };
  }
}
