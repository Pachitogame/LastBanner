import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
let server: ChildProcess;
async function start() {
  server = spawn(process.execPath, ["dist/server.js"], {
    cwd: process.cwd(),
    stdio: "pipe",
    windowsHide: true,
  });
  let output = "";
  server.stdout?.on("data", (d) => (output += d));
  server.stderr?.on("data", (d) => (output += d));
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw Error(output);
    try {
      const r = await fetch("http://localhost:3100/api/state");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Server startup timed out: " + output);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill();
  });
}
process.env.PLAYWRIGHT_BROWSERS_PATH = ".local/browsers";
const { chromium } = await import("@playwright/test");
await mkdir("evidence", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await start();
  await page.goto("http://localhost:3101/host");
  await page.waitForFunction(
    () => document.querySelector("#mode")?.textContent === "SIMULATED PLAYERS",
  );
  async function state() {
    return page.evaluate(async () => {
      return (await fetch("/host/api/state")).json();
    });
  }
  async function action(data: object) {
    return page.evaluate(async (data) => {
      const s = await (await fetch("/host/api/state")).json();
      const r = await fetch("/host/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": s.csrf },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    }, data);
  }
  await action({ action: "reset", mode: "FIXTURE", confirm: "RESET" });
  const arena = await context.newPage();
  await arena.goto("http://localhost:3100");
  await arena.waitForSelector(".cell");
  await arena.screenshot({
    path: "evidence/fixture-initial.png",
    fullPage: true,
  });
  for (let turn = 1; turn <= 6; turn++) {
    await action({ action: "next" });
    assert.equal((await state()).turn, turn);
    if (turn === 3) await action({ action: "advance", ms: 15000 });
    else await action({ action: "fixture" });
    await arena.waitForFunction(
      () =>
        document.querySelector("#result-label")?.textContent === "LAST CHAPTER",
      {},
      { timeout: 15000 },
    );
    if (turn === 3) {
      await page.waitForTimeout(350);
      await page.locator('[data-coord="B2"]').click();
      assert.match(
        await page.locator("#frontier").innerText(),
        /1 connected unclaimed/,
      );
      await page.screenshot({
        path: "evidence/host-neutral-preview.png",
        fullPage: true,
      });
    }
    if (turn === 4) {
      assert.equal((await state()).phase, "presentation");
      assert.equal((await state()).counts.neutral, 1);
    }
  }
  assert.equal((await state()).winner, "diego");
  await arena.waitForFunction(
    () =>
      document.querySelector("#headline")?.textContent ===
      "Diego holds the last banner",
  );
  await arena.screenshot({
    path: "evidence/fixture-final.png",
    fullPage: true,
  });
  const exportData = await page.evaluate(async () => {
    return (await fetch("/host/api/export")).json();
  });
  await writeFile("evidence/fixture.json", JSON.stringify(exportData, null, 2));
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#headline")?.textContent ===
      "Diego holds the last banner",
  );
  for (const n of [2, 6, 30, 100]) {
    await action({
      action: "reset",
      mode: "SIMULATED PLAYERS",
      confirm: "RESET",
    });
    await action({ action: "add", count: n });
    await action({ action: "lobby", open: false });
    await action({ action: "start" });
    await arena.waitForFunction(
      (n) => document.querySelectorAll(".cell").length === n,
      n,
    );
    await arena.screenshot({ path: `evidence/board-${n}.png`, fullPage: true });
    assert.equal(await arena.locator(".cell").count(), n);
    assert.equal(
      await arena.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      await arena.evaluate(
        () => document.documentElement.scrollHeight > innerHeight,
      ),
      false,
      "OBS must fit 1080p",
    );
    const timings: number[] = [];
    let bytes = 0;
    for (let sample = 0; sample < 25; sample++) {
      const begin = performance.now();
      const response = await fetch("http://localhost:3100/api/state");
      const text = await response.text();
      bytes = Buffer.byteLength(text);
      timings.push(performance.now() - begin);
    }
    timings.sort((a, b) => a - b);
    await writeFile(
      `evidence/http-${n}.json`,
      JSON.stringify(
        {
          players: n,
          samples: 25,
          scope:
            "Sequential loopback GET /api/state including response body; not Twitch throughput",
          medianMs: +timings[12].toFixed(2),
          p95Ms: +timings[23].toFixed(2),
          bytes,
        },
        null,
        2,
      ),
    );
  }
  assert.equal(
    (await fetch("http://localhost:3100/host/api/state")).status,
    404,
  );
  assert.equal(
    (await fetch("http://localhost:3101/host/api/state")).status,
    401,
  );
  assert.equal(
    (
      await fetch("http://localhost:3101/host", {
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch("http://localhost:3102/oauth/callback?code=x&state=forged"))
      .status,
    400,
  );
  const denied = await page.evaluate(async () => {
    return (
      await fetch("/host/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"action":"pause"}',
      })
    ).status;
  });
  assert.equal(denied, 403);
  const publicBody = await (
    await fetch("http://localhost:3100/api/state")
  ).text();
  assert.doesNotMatch(
    publicBody,
    /csrf|access_token|refresh_token|client_secret|lb_host/,
  );
  const cookies = await context.cookies("http://localhost:3100/");
  assert.equal(
    cookies.some((c) => c.name === "lb_host"),
    false,
  );
  await stop();
  await start();
  await page.waitForFunction(
    () =>
      document.querySelector("#headline")?.textContent === "0 banners gathered",
    {},
    { timeout: 10000 },
  );
  assert.equal((await state()).phase, "lobby");
  assert.deepEqual(errors, []);
  await writeFile(
    "evidence/ui-check.json",
    JSON.stringify(
      {
        passed: true,
        browser: "Chromium headless",
        viewport: "1920x1080",
        checks: [
          "exact fixture through host API",
          "gray preview",
          "10/30/100 boards",
          "refresh",
          "server restart same tab stale-cookie recovery",
          "public isolation",
          "CSRF",
          "OAuth state",
          "no public admin cookie",
          "no browser errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("UI, fixture, restart recovery and HTTP security checks passed.");
} finally {
  await browser.close();
  await stop();
}
