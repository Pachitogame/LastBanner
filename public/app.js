const host = document.body.classList.contains("host");
const $ = (id) => document.getElementById(id);
let state,
  csrf = "",
  selected = null,
  hover = null,
  lastKey = "",
  initialized = false,
  soundKey = "",
  previousWinner = null,
  sound;
const name = (id) =>
  state?.players.find((p) => p.id === id)?.name ?? "Unclaimed";
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function banner(id, large = false) {
  const p = state.players.find((p) => p.id === id),
    b = el(
      "span",
      p ? String(state.players.indexOf(p) + 1) : "—",
      "banner" + (large ? " big" : ""),
    );
  b.style.setProperty("--owner", p?.color ?? "#7f8375");
  return b;
}
function component(coord) {
  const first = state.cells.find((c) => c.coord === coord && c.owner === null);
  if (!first) return [];
  const found = [first];
  for (let i = 0; i < found.length; i++)
    for (const c of state.cells)
      if (
        c.owner === null &&
        !found.includes(c) &&
        Math.abs(c.x - found[i].x) + Math.abs(c.y - found[i].y) === 1
      )
        found.push(c);
  return found;
}
function inspect(c) {
  hover = c.coord;
  const p = state.players.find((p) => p.id === c.owner),
    gray = component(c.coord);
  $("frontier").textContent = gray.length
    ? `${gray.length} connected unclaimed territories · ${gray.map((c) => c.coord).join(", ")} · No dice · Ends the turn`
    : `${c.coord} · ${p?.name ?? "Unclaimed"} · Banner ${p ? state.players.indexOf(p) + 1 : "—"} · ${state.ranking.find((p) => p.id === c.owner)?.count ?? 0} territories`;
  document.querySelectorAll(".cell").forEach((n) =>
    n.classList.toggle(
      "preview",
      gray.some((c) => c.coord === n.dataset.coord),
    ),
  );
}
function ranks(target, all = false) {
  target.replaceChildren();
  const rows = all
    ? state.ranking
    : state.ranking.filter((p) => p.active).slice(0, 6);
  if (
    !all &&
    !state.winner &&
    state.actor &&
    !rows.some((p) => p.id === state.actor)
  ) {
    const p = state.ranking.find((p) => p.id === state.actor);
    if (p) rows.push(p);
  }
  for (const p of rows) {
    const row = el(
      "div",
      undefined,
      `rank ${p.id === state.actor ? "actor" : ""} ${p.active ? "" : "eliminated"}`,
    );
    row.append(
      el("span", String(p.rank), "place"),
      banner(p.id),
      el("span", p.name, "name"),
      el("b", String(p.count)),
    );
    row.title = p.name;
    target.append(row);
  }
}
function fitMap() {
  if (!state) return;
  const n = state.cells.length;
  if (!n) return;
  const cols = Math.ceil(Math.sqrt(n)),
    rows = Math.ceil(n / cols),
    stage = $("map-stage"),
    map = $("map");
  const availW = stage.clientWidth - 100,
    availH =
      state.winner && !host
        ? 440
        : Math.min(stage.clientHeight, host ? 550 : 708) - 20;
  const size = Math.floor(
    Math.max(
      30,
      Math.min(
        280,
        (availW - 40 - (cols - 1) * 4) / cols,
        (availH - 40 - (rows - 1) * 4) / rows,
      ),
    ),
  );
  map.style.setProperty("--cell", size + "px");
  map.style.gridTemplateColumns = `repeat(${cols},${size}px)`;
  map.classList.toggle("dense", n > 16);
  map.classList.toggle("crowded", n > 64);
  map.classList.toggle("duel", n === 2);
  camera();
}
function camera() {
  if (!state) return;
  const map = $("map"),
    stage = $("map-stage"),
    p = state.presentation;
  map.style.transform = "";
  if (
    host ||
    $("motion").checked ||
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    state.cells.length < 17 ||
    !p?.active ||
    ["resolve", "transfer", "claim", "complete"].includes(p.stage)
  )
    return;
  const r = state.last,
    from = state.cells.find((c) => c.coord === r?.from),
    to = state.cells.find((c) => c.coord === r?.to);
  if (!from || !to) return;
  const scale = Math.min(
    1.22,
    (stage.clientWidth - 36) / map.offsetWidth,
    (stage.clientHeight - 24) / map.offsetHeight,
  );
  if (scale < 1.025) return;
  const size = parseFloat(map.style.getPropertyValue("--cell")) + 4,
    cols = Math.ceil(Math.sqrt(state.cells.length)),
    rows = Math.ceil(state.cells.length / cols);
  const x = ((cols - 1) / 2 - (from.x + to.x) / 2) * size * (scale - 1),
    y = ((rows - 1) / 2 - (from.y + to.y) / 2) * size * (scale - 1);
  const dx = Math.max(
      0,
      (stage.clientWidth - map.offsetWidth * scale) / 2 - 10,
    ),
    dy = Math.max(0, (stage.clientHeight - map.offsetHeight * scale) / 2 - 10);
  map.style.transform = `translate(${Math.max(-dx, Math.min(dx, x))}px,${Math.max(-dy, Math.min(dy, y))}px) scale(${scale})`;
}
function board() {
  const map = $("map");
  const focused = document.activeElement?.dataset?.coord;
  map.replaceChildren();
  for (const c of state.cells) {
    const p = state.players.find((p) => p.id === c.owner),
      cell = el("button", undefined, "cell");
    cell.dataset.coord = c.coord;
    cell.style.setProperty("--owner", p?.color ?? "#7f8375");
    cell.classList.toggle("neutral", !p);
    cell.classList.toggle("current", c.owner === state.actor && !!p);
    cell.classList.toggle("selected", selected === c.coord);
    const active = !!state.presentation?.active;
    cell.classList.toggle("source", active && state.last?.from === c.coord);
    cell.classList.toggle("target", active && state.last?.to === c.coord);
    cell.classList.toggle(
      "departing",
      active &&
        state.presentation.stage === "resolve" &&
        !!state.last?.transferred?.includes(c.coord),
    );
    cell.classList.toggle(
      "transferred",
      active &&
        state.presentation.stage === "transfer" &&
        state.last?.transferred?.includes(c.coord),
    );
    cell.title = `${c.coord} · ${p?.name ?? "Unclaimed"} · Banner ${p ? state.players.indexOf(p) + 1 : "—"}`;
    cell.setAttribute("aria-label", cell.title);
    cell.append(
      el("strong", c.coord),
      banner(c.owner),
      el(
        "span",
        state.cells.length > 64
          ? (p?.name ?? "Gray").slice(0, 3)
          : (p?.name ?? "Unclaimed"),
        "owner-name",
      ),
    );
    cell.onfocus = () => inspect(c);
    cell.onmouseenter = () => inspect(c);
    cell.onclick = () => {
      const from = state.cells.find((x) => x.coord === selected);
      if (
        host &&
        from &&
        from.owner === state.actor &&
        c.owner !== from.owner &&
        Math.abs(c.x - from.x) + Math.abs(c.y - from.y) === 1
      )
        $("command").value = `!attack ${from.coord} ${c.coord}`;
      else selected = c.coord;
      document
        .querySelectorAll(".cell")
        .forEach((n) =>
          n.classList.toggle("selected", n.dataset.coord === selected),
        );
      inspect(c);
    };
    map.append(cell);
  }
  fitMap();
  if (focused)
    map
      .querySelector(`[data-coord="${focused}"]`)
      ?.focus({ preventScroll: true });
}
const pipPositions = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};
function die(v, discard = false, rolling = false) {
  const d = el(
    "span",
    undefined,
    "die" + (discard ? " discarded" : "") + (rolling ? " rolling unknown" : ""),
  );
  d.setAttribute(
    "aria-label",
    rolling ? "Rolling die" : `${v}${discard ? " discarded" : ""}`,
  );
  if (rolling) d.textContent = "?";
  else
    for (let i = 1; i <= 9; i++) {
      const dot = el("i");
      if (pipPositions[v]?.includes(i)) dot.className = "pip";
      d.append(dot);
    }
  return d;
}
function dice(box, label, values, discard = false, rolling = false) {
  box.append(el("p", label));
  const row = el("div", undefined, "dice");
  let removed = false;
  for (const v of values) {
    const out = discard && v === Math.min(...values) && !removed;
    if (out) removed = true;
    row.append(die(v, out, rolling));
  }
  box.append(row);
}
const shortName = (id, limit = 20) => {
  const n = name(id);
  return n.length > limit ? n.slice(0, limit - 1) + "…" : n;
};
function result() {
  const box = $("result");
  box.replaceChildren();
  const r = state.last,
    p = state.presentation;
  if (!r) {
    box.append(
      el("h3", "Every empire begins here."),
      el("p", "One territory. One banner. An uncertain frontier."),
    );
    return;
  }
  const active = p?.active,
    stage = p?.stage,
    revealed = !!r.transferred;
  if ($("result-label"))
    $("result-label").textContent = active
      ? "ON THE WAR TABLE"
      : "LAST CHAPTER";
  if (r.kind === "combat") {
    box.append(
      el(
        "h3",
        revealed
          ? `${shortName(r.winner)} prevails`
          : `${shortName(r.actor)} vs ${shortName(r.defender)}`,
      ),
    );
    if (stage === "frontier") {
      box.append(
        el("p", `${r.from} → ${r.to}`, "score"),
        el("p", "Two banners meet at the frontier."),
      );
      return;
    }
    const rolls = r.rolls;
    const sudden = stage?.startsWith("sudden-");
    if (!sudden) {
      dice(
        box,
        `${shortName(r.actor)} · attacker`,
        rolls?.attack ?? [1, 1, 1],
        !!rolls,
        !rolls,
      );
      const defender =
        r.defender ?? (r.actor === r.winner ? r.loser : r.winner);
      dice(
        box,
        `${shortName(defender)} · defender`,
        rolls?.defense ?? [1, 1],
        false,
        !rolls,
      );
    }
    if (rolls) {
      if (!sudden)
        box.append(
          el("p", "Attacker keeps the highest two. Crossed die is discarded."),
        );
      let a = 0,
        b = 0;
      for (const [i, c] of (rolls.comparisons ?? []).entries()) {
        if (c > 0) a++;
        if (c < 0) b++;
        const line = el("div", undefined, "comparison");
        line.append(
          el(
            "span",
            `${i === 0 ? "Highest" : "Second"}: ${rolls.kept[i]} ${c > 0 ? ">" : c < 0 ? "<" : "="} ${rolls.defense[i]}`,
          ),
          el("b", c === 0 ? "Tie · +0" : c > 0 ? "ATK +1" : "DEF +1"),
        );
        box.append(line);
      }
      if (rolls.comparisons?.length)
        box.append(el("p", `${a} — ${b}`, "score"));
      if (sudden) {
        const round = p.suddenRound;
        box.append(el("p", "SUDDEN DEATH", "transfer"));
        if (!round) box.append(el("p", "Points tied. One die per banner."));
        else {
          const pair = rolls.sudden?.[round - 1];
          const duel = el("div", undefined, "sudden-duel");
          box.append(el("p", `Roll ${round}`, "sudden-round"));
          for (const [i, id] of [r.actor, r.defender].entries()) {
            const side = el("div", undefined, "sudden-side");
            side.append(
              el("p", shortName(id)),
              die(pair?.[i] ?? 1, false, !pair),
            );
            duel.append(side);
          }
          box.append(duel);
          box.append(
            el(
              "p",
              !pair
                ? "Both banners roll…"
                : pair[0] === pair[1]
                  ? `${pair[0]} = ${pair[1]} · Tie. Roll again.`
                  : `${pair[0]} ${pair[0] > pair[1] ? ">" : "<"} ${pair[1]} · ${shortName(pair[0] > pair[1] ? r.actor : r.defender)} wins the duel.`,
              "sudden-verdict",
            ),
          );
          if (round > 1)
            box.append(
              el(
                "p",
                `Previous roll: ${rolls.sudden[round - 2].join(" = ")} · tied`,
              ),
            );
        }
      } else if (rolls.sudden?.length) {
        box.append(el("p", "SUDDEN DEATH", "transfer"));
        const pairs = rolls.sudden;
        const recent = pairs.slice(-4);
        if (pairs.length > 4)
          box.append(el("p", `${pairs.length - 4} earlier tied rolls`));
        for (const pair of recent)
          box.append(
            el(
              "p",
              `${pair[0]} : ${pair[1]}${pair[0] === pair[1] ? " · tied, roll again" : ""}`,
            ),
          );
      }
    }
  } else {
    box.append(
      el(
        "h3",
        r.kind === "neutral" ? "The unclaimed lands" : "Time has run out",
      ),
      el(
        "p",
        r.kind === "neutral"
          ? "The whole connected gray region is claimed. No dice. This ends the turn."
          : `${shortName(r.actor)} leaves the field. Every possession becomes unclaimed.`,
      ),
    );
  }
  if (revealed) {
    box.append(
      el(
        "p",
        `${r.transferred.length} ${r.kind === "inactivity" ? "territories abandoned" : "territories change hands"}`,
        "transfer",
      ),
    );
    if (r.winner) {
      const old = r.before.find((p) => p.id === r.winner)?.count,
        next = r.after.find((p) => p.id === r.winner)?.count;
      box.append(el("p", `${shortName(r.winner)} · ${old} → ${next}`, "score"));
    }
    if (r.loser) box.append(el("p", `${shortName(r.loser)} eliminated`));
  }
}
function render() {
  const s = state,
    p = s.presentation;
  document.body.classList.toggle(
    "long-name",
    name(s.winner ?? s.actor).length > 32,
  );
  document.body.classList.toggle(
    "battle-active",
    !!p?.active && s.last?.kind === "combat",
  );
  document.body.classList.toggle("victory-view", !!s.winner);
  $("mode").textContent = s.mode;
  $("connection").textContent = s.connection;
  $("phase").textContent =
    (s.paused ? "PAUSED · " : "") + s.phase.toUpperCase();
  $("headline").textContent = s.winner
    ? `${name(s.winner)} holds the last banner`
    : s.phase === "lobby"
      ? `${s.players.length} banners gathered`
      : s.phase === "presentation"
        ? s.last?.kind === "combat"
          ? "A clash at the frontier"
          : s.last?.kind === "neutral"
            ? "The frontier expands"
            : "A banner falls"
        : s.actor
          ? `${name(s.actor)} commands`
          : "The map awaits";
  $("instruction").textContent = s.winner
    ? `${s.turn} turns · ${s.counts.combat} combats · ${s.counts.neutral} claims · ${s.counts.inactivity} abandoned`
    : s.phase === "lobby"
      ? `${s.lobbyOpen ? "Join with !join" : "Registration closed"} · ${s.decisionMs / 1000}s per decision`
      : s.phase === "presentation"
        ? ""
        : "!attack B3 C3 · Your origin → adjacent target";
  $("clock").textContent =
    s.phase === "decision"
      ? `${Math.ceil(s.remaining / 1000)}s`
      : s.phase === "lobby"
        ? `${s.decisionMs / 1000}s`
        : "—";
  $("turn").textContent = `TURN ${s.turn}`;
  if ($("time-fill"))
    $("time-fill").style.width =
      (s.phase === "decision" ? (100 * s.remaining) / s.decisionMs : 0) + "%";
  $("territories").textContent =
    `${s.cells.length} territories · ${s.players.filter((p) => p.active).length} banners`;
  if ($("actor-banner")) {
    const b = banner(s.winner ?? s.actor, true);
    b.id = "actor-banner";
    $("actor-banner").replaceWith(b);
  }
  const key = JSON.stringify([
    s.matchId,
    s.cells,
    s.players,
    s.actor,
    s.last,
    p?.stage,
    p?.suddenRound,
    s.phase,
  ]);
  if (key !== lastKey) {
    lastKey = key;
    board();
    ranks($("ranking"));
    ranks($("all-ranking"), true);
    result();
    $("lobby").replaceChildren(
      ...(s.phase === "lobby" ? s.players.map((p) => el("span", p.name)) : []),
    );
    if (!hover)
      $("frontier").textContent =
        (s.winner ?? s.actor)
          ? `Banner ${s.players.findIndex((p) => p.id === (s.winner ?? s.actor)) + 1} · ${name(s.winner ?? s.actor)}`
          : "";
    if ($("victory")) {
      const v = $("victory");
      v.hidden = !s.winner;
      v.replaceChildren();
      if (s.winner)
        v.append(
          banner(s.winner),
          el("small", "THE LAST BANNER"),
          el("h2", name(s.winner)),
          el(
            "p",
            `${s.cells.filter((c) => c.owner === s.winner).length} territories · One surviving empire`,
          ),
        );
    }
  }
  // No historical audio or celebration on first load or on a new match loaded mid-event.
  const keySound = `${s.matchId}:${s.turn}:${p?.stage ?? s.phase}:${p?.suddenRound ?? 0}`;
  if (initialized && s.matchId === initialized && keySound !== soundKey) {
    let cue =
      p?.stage === "roll" || p?.stage === "sudden-roll"
        ? "roll"
        : p?.stage?.startsWith("compare") || p?.stage === "sudden-compare"
          ? "compare"
          : p?.stage === "sudden-intro"
            ? "sudden"
            : p?.stage === "transfer"
              ? "conquest"
              : s.phase === "decision"
                ? "turn"
                : null;
    if (s.winner && !previousWinner && (!p || p.elapsed < p.duration + 1000)) {
      cue = "victory";
      document.body.classList.add("victory-celebrate");
      setTimeout(
        () => document.body.classList.remove("victory-celebrate"),
        900,
      );
    }
    if (cue) sound?.cue(cue);
  }
  initialized = s.matchId;
  soundKey = keySound;
  previousWinner = s.winner;
  sound?.state(
    s.winner
      ? "final"
      : p?.active && s.last?.kind === "combat"
        ? "combat"
        : s.phase === "lobby"
          ? "lobby"
          : "game",
  );
  if (host) {
    csrf = s.csrf;
    $("configuration").textContent = s.configured
      ? "Application configured locally."
      : "Application not configured. See README.";
    if (!$("channel").value) $("channel").value = s.channel;
    const locked = s.phase !== "lobby" || s.mode === "FIXTURE";
    $("decision-time").disabled = locked;
    $("decision-setting").textContent =
      `${s.decisionMs / 1000}s per decision${locked ? " · locked" : ""}`;
    if (document.activeElement !== $("decision-time"))
      $("decision-time").value = s.decisionMs / 1000;
    document
      .querySelectorAll("[data-seconds]")
      .forEach((b) => (b.disabled = locked));
    for (const btn of document.querySelectorAll("[data-action]")) {
      const a = btn.dataset.action;
      btn.disabled =
        (a === "decision-time" && locked) ||
        (a === "add" && s.mode !== "SIMULATED PLAYERS") ||
        (["advance", "next"].includes(a) && s.mode === "REAL TWITCH") ||
        (a === "next" && p?.active) ||
        (a === "fixture" &&
          (s.mode !== "FIXTURE" || s.phase !== "decision" || s.turn === 3)) ||
        (a === "start" &&
          (s.phase !== "lobby" || s.lobbyOpen || s.players.length < 2));
    }
    $("command-form").hidden = s.mode !== "SIMULATED PLAYERS";
  }
}
async function poll() {
  try {
    const r = await fetch(host ? "/host/api/state" : "/api/state");
    if (r.status === 401 && host) {
      location.replace("/host");
      return;
    }
    if (!r.ok) throw Error();
    const next = await r.json();
    if (state?.matchId !== next.matchId) {
      selected = hover = null;
      lastKey = "";
    }
    state = next;
    render();
  } catch {
    $("connection").textContent = "SERVER UNAVAILABLE";
  } finally {
    setTimeout(poll, 150);
  }
}
async function send(data) {
  try {
    const r = await fetch("/host/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(data),
    });
    const out = await r.json();
    if (!r.ok) throw Error(out.error);
    $("feedback").classList.remove("error");
    $("feedback").textContent = "Done.";
    if (out.url) location.assign(out.url);
  } catch (e) {
    $("feedback").classList.add("error");
    $("feedback").textContent = e.message;
  }
}
if (host) {
  $("reset").onclick = () => {
    if (prompt("A reset ends this game. Type RESET to confirm.") === "RESET")
      void send({
        action: "reset",
        confirm: "RESET",
        mode: $("mode-select").value,
      });
  };
  for (const btn of document.querySelectorAll("[data-action]"))
    btn.onclick = () => {
      const a = btn.dataset.action,
        data = { action: a };
      if (a === "add") data.count = Number($("count").value);
      if (a === "decision-time")
        data.seconds = Number($("decision-time").value);
      if (a === "open" || a === "close") {
        data.action = "lobby";
        data.open = a === "open";
      }
      if (a === "advance") data.ms = state.remaining;
      if (a === "connect") data.channel = $("channel").value;
      void send(data);
    };
  for (const btn of document.querySelectorAll("[data-seconds]"))
    btn.onclick = () =>
      void send({
        action: "decision-time",
        seconds: Number(btn.dataset.seconds),
      });
  $("command-form").onsubmit = (e) => {
    e.preventDefault();
    void send({ action: "command", text: $("command").value });
  };
}
$("full-list").onclick = () => $("roster").showModal();
$("close-list").onclick = () => $("roster").close();
$("motion").checked =
  localStorage.getItem("reduce-motion") === "true" ||
  matchMedia("(prefers-reduced-motion: reduce)").matches;
document.body.classList.toggle("reduce-motion", $("motion").checked);
$("motion").onchange = () => {
  document.body.classList.toggle("reduce-motion", $("motion").checked);
  localStorage.setItem("reduce-motion", $("motion").checked);
  camera();
};
function resize() {
  if (!host) {
    const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
    document.querySelector(".arena-shell").style.transform = `scale(${scale})`;
  }
  fitMap();
}
addEventListener("resize", resize);
resize();
if (!host)
  import("/audio.js")
    .then(({ WarAudio }) => {
      sound = new WarAudio($("audio-status"));
      $("music").value = Math.round(sound.music * 100);
      $("effects").value = Math.round(sound.effects * 100);
      $("audio-enable").onclick = async () => {
        await sound.enable();
        $("mute").checked = false;
        sound.controls(
          Number($("music").value) / 100,
          Number($("effects").value) / 100,
          false,
        );
      };
      for (const id of ["music", "effects", "mute"])
        $(id).oninput = () =>
          sound.controls(
            Number($("music").value) / 100,
            Number($("effects").value) / 100,
            $("mute").checked,
          );
    })
    .catch(() => {
      $("audio-status").textContent = "Audio unavailable";
    });
void poll();
