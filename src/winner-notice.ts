import type { Game } from "./engine.js";

// Claim before awaiting delivery: refreshes, ticks and reconnects share this gate.
// An ambiguous network failure must not trigger a potentially duplicate send.
export class WinnerNotice {
  private attempted = new WeakSet<Game>();

  async announce(
    game: Game,
    connected: boolean,
    send: (message: string) => Promise<unknown>,
  ) {
    if (
      game.mode !== "REAL TWITCH" ||
      game.phase !== "finished" ||
      !game.winner ||
      !connected ||
      this.attempted.has(game)
    )
      return;
    const winner = game.players.find((p) => p.id === game.winner)!;
    const count = game.cells.filter((c) => c.owner === game.winner).length;
    this.attempted.add(game);
    try {
      await send(
        `Last Banner winner: ${winner.name} — ${count} ${count === 1 ? "territory" : "territories"}.`,
      );
    } catch {
      game.log("winner-notice-unconfirmed", {
        winner: winner.id,
        territories: count,
      });
    }
  }
}
