import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
test("audio explicit activation, separate gains, mute, suspension and one scheduler; no melody restart on battle", async () => {
  const intervals = new Set<Function>(),
    events: any = {},
    nodes: any[] = [];
  class Param {
    value = 0;
    targets: number[] = [];
    setTargetAtTime(v: number) {
      this.targets.push(v);
      this.value = v;
    }
    setValueAtTime(v: number) {
      this.value = v;
    }
    linearRampToValueAtTime(v: number) {
      this.value = v;
    }
    exponentialRampToValueAtTime(v: number) {
      this.value = v;
    }
    cancelScheduledValues() {}
  }
  class Node {
    gain = new Param();
    frequency = new Param();
    threshold = new Param();
    ratio = new Param();
    connect() {}
    disconnect() {}
    start() {}
    stop() {}
    getFloatTimeDomainData(samples: Float32Array) {
      samples.fill(0);
    }
    type = "";
  }
  class Context {
    state = "suspended";
    currentTime = 0;
    destination = {};
    onstatechange = () => {};
    createGain() {
      const n = new Node();
      nodes.push(n);
      return n;
    }
    createDynamicsCompressor() {
      return new Node();
    }
    createAnalyser() {
      return new Node();
    }
    createOscillator() {
      return new Node();
    }
    createBiquadFilter() {
      return new Node();
    }
    async resume() {
      this.state = "running";
      this.onstatechange();
    }
    suspend() {
      this.state = "suspended";
      this.onstatechange();
    }
  }
  const doc = {
    hidden: false,
    addEventListener: (k: string, fn: Function) => (events[k] = fn),
  };
  const source = (await readFile("public/audio.js", "utf8")).replace(
    "export class WarAudio",
    "globalThis.WarAudio = class WarAudio",
  );
  const sandbox: any = {
    AudioContext: Context,
    document: doc,
    localStorage: {
      getItem: () => '{"music":0.25,"effects":0.4}',
      setItem: () => {},
    },
    setInterval: (fn: Function) => {
      intervals.add(fn);
      return fn;
    },
    clearInterval: (fn: Function) => intervals.delete(fn),
  };
  vm.runInNewContext(source, sandbox);
  const a = new sandbox.WarAudio({ textContent: "", dataset: {} });
  assert.equal(a.ctx, undefined);
  assert.equal(intervals.size, 0);
  await a.enable();
  assert.equal(intervals.size, 1);
  a.controls(0.2, 0.7, false);
  assert.equal(a.musicGain.gain.value, 0.06);
  assert.ok(Math.abs(a.fxGain.gain.value - 0.245) < 1e-9);
  a.schedule();
  const step = a.step;
  a.state("combat");
  assert.equal(a.step, step);
  a.controls(0.2, 0.7, true);
  assert.equal(a.master.gain.value, 0);
  doc.hidden = true;
  events.visibilitychange();
  assert.equal(intervals.size, 1);
  assert.equal(a.ctx.state, "running");
  a.ctx.suspend();
  assert.equal(intervals.size, 0);
  assert.equal(a.ctx.state, "suspended");
  doc.hidden = false;
  events.visibilitychange();
  assert.equal(intervals.size, 1);
  assert.equal(a.muted, true);
  await a.enable();
  await a.enable();
  assert.equal(intervals.size, 1);
  assert.equal(a.step, step);
  a.controls(NaN, 2, false);
  assert.equal(a.music, 0);
  assert.equal(a.effects, 1);
});
