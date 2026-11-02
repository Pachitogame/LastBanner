// Original procedural score for Last Banner. No samples, external audio or game melodies.
export class WarAudio {
  constructor(status) {
    this.status = status;
    this.mode = "lobby";
    this.music = 0.25;
    this.effects = 0.4;
    this.muted = true;
    this.step = 0;
    this.timer = null;
    this.enabled = false;
    try {
      const saved = JSON.parse(
        localStorage.getItem("last-banner-audio") || "null",
      );
      if (saved) {
        this.music = this.level(saved.music, 0.25);
        this.effects = this.level(saved.effects, 0.4);
      }
    } catch {
      /* Storage can be unavailable in an embedded browser. */
    }
    document.addEventListener("visibilitychange", () => {
      // OBS rendering/capture must not stop when its interaction window closes.
      if (!document.hidden && this.enabled && this.ctx?.state === "suspended")
        void this.ctx.resume().catch(() => this.report());
    });
  }
  level(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : fallback;
  }
  start() {
    if (!this.enabled || this.ctx?.state !== "running" || this.timer) return;
    this.next = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => {
      this.schedule();
      this.report();
    }, 100);
  }
  report() {
    const running = this.ctx?.state === "running";
    const readings = {};
    for (const [name, meter] of Object.entries(this.meters ?? {})) {
      meter.getFloatTimeDomainData(this.samples);
      readings[name] = Math.max(...this.samples.map(Math.abs));
    }
    this.status.dataset.audio = JSON.stringify({
      context: this.ctx?.state ?? "off",
      enabled: this.enabled,
      muted: this.muted,
      music: this.music,
      effects: this.effects,
      mode: this.mode,
      peaks: readings,
    });
    this.status.textContent = !this.enabled
      ? "Audio off · Enable audio"
      : !running
        ? "Audio suspended · Enable audio"
        : this.muted
          ? "Muted"
          : this.mode === "final" && !(readings.output > 0.00001)
            ? "Audio ready · score ended"
            : readings.output > 0.00001
              ? "Audio signal"
              : "Audio ready · quiet";
  }
  async enable() {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.fxGain = this.ctx.createGain();
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -15;
        this.compressor.ratio.value = 4;
        this.musicGain.connect(this.master);
        this.fxGain.connect(this.master);
        this.master.connect(this.compressor);
        this.meters = {};
        for (const [name, source] of Object.entries({
          music: this.musicGain,
          effects: this.fxGain,
          output: this.compressor,
        })) {
          const meter = this.ctx.createAnalyser();
          meter.fftSize = 2048;
          source.connect(meter);
          this.meters[name] = meter;
        }
        this.samples = new Float32Array(2048);
        this.meters.output.connect(this.ctx.destination);
        this.master.gain.value = 0;
        this.ctx.onstatechange = () => {
          if (this.ctx.state !== "running") this.clear();
          else this.start();
          this.report();
        };
      }
      await this.ctx.resume();
      this.enabled = true;
      this.muted = false;
      this.start();
      this.apply();
    } catch {
      this.status.textContent = "Audio unavailable";
    }
  }
  clear() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  controls(music, effects, muted) {
    this.music = this.level(music);
    this.effects = this.level(effects);
    this.muted = !!muted;
    try {
      localStorage.setItem(
        "last-banner-audio",
        JSON.stringify({ music: this.music, effects: this.effects }),
      );
    } catch {}
    this.apply();
  }
  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.52, t, 0.08);
    this.musicGain.gain.setTargetAtTime(this.music * 0.3, t, 0.15);
    this.fxGain.gain.setTargetAtTime(this.effects * 0.35, t, 0.06);
    this.report();
  }
  state(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
  }
  tone(note, start, duration, gain, bus, type = "triangle") {
    const c = this.ctx,
      o = c.createOscillator(),
      v = c.createGain(),
      filter = c.createBiquadFilter();
    o.type = type;
    o.frequency.value = 440 * 2 ** ((note - 69) / 12);
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    v.gain.setValueAtTime(0, start);
    v.gain.linearRampToValueAtTime(gain, start + 0.015);
    v.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    o.connect(filter);
    filter.connect(v);
    v.connect(bus);
    o.start(start);
    o.stop(start + duration + 0.02);
    o.onended = () => {
      o.disconnect();
      filter.disconnect();
      v.disconnect();
    };
  }
  schedule() {
    if (!this.ctx || this.ctx.state !== "running") return;
    if (this.next < this.ctx.currentTime - 0.5)
      this.next = this.ctx.currentTime + 0.05;
    let guard = 0;
    while (this.next < this.ctx.currentTime + 0.22 && guard++ < 5) {
      const i = this.step++,
        beat = i % 16,
        roots = [45, 41, 48, 43],
        root = roots[Math.floor(i / 16) % 4];
      if (this.mode !== "final") {
        const notes = [0, 7, 12, 7, 3, 7, 10, 7, 0, 7, 15, 12, 10, 7, 3, 7];
        if (this.mode !== "lobby" || i % 2 === 0)
          this.tone(
            root + 12 + notes[beat],
            this.next,
            0.55,
            0.22,
            this.musicGain,
            "triangle",
          );
        if (beat % 4 === 0)
          this.tone(root - 12, this.next, 1.25, 0.23, this.musicGain, "sine");
        if (this.mode === "combat" && beat % 2 === 0)
          this.tone(root + 7, this.next, 0.18, 0.1, this.musicGain, "square");
      }
      this.next += 0.27;
    }
  }
  cue(kind) {
    if (!this.enabled || this.muted || this.ctx?.state !== "running") return;
    const t = this.ctx.currentTime + 0.015;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(this.music * 0.09, t, 0.035);
    this.musicGain.gain.setTargetAtTime(this.music * 0.3, t + 0.7, 0.25);
    const scores = {
      turn: [60, 67],
      roll: [43, 46, 50, 45],
      compare: [62],
      conquest: [55, 62, 67],
      sudden: [68, 56, 68],
      victory: [55, 62, 67, 71, 74],
    };
    for (const [i, n] of (scores[kind] ?? []).entries())
      this.tone(
        n,
        t + i * (kind === "victory" ? 0.16 : 0.075),
        kind === "victory" ? 0.65 : 0.22,
        0.36,
        this.fxGain,
        kind === "roll" ? "triangle" : "sine",
      );
  }
}
