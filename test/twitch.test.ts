import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeChat, Twitch, REDIRECT, SCOPES } from "../src/twitch.js";
test("mock EventSub lifecycle: subscription, duplicate, handoff, outage retry, delivery failure", async (ctx) => {
  const oldId = process.env.TWITCH_CLIENT_ID,
    oldSecret = process.env.TWITCH_CLIENT_SECRET;
  process.env.TWITCH_CLIENT_ID = "mock-client";
  process.env.TWITCH_CLIENT_SECRET = "mock-secret";
  ctx.mock.timers.enable({ apis: ["setTimeout"] });
  class Socket {
    onmessage: any;
    onclose: any;
    onerror: any;
    closed = false;
    constructor(public url: string) {}
    close() {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.();
    }
    emit(frame: object) {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }
  const sockets: Socket[] = [],
    calls: { path: string; body: any }[] = [],
    messages: any[] = [],
    statuses: boolean[] = [];
  let delivered = true;
  const request = (async (url: any, init: any) => {
    const path = String(url);
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path.endsWith("/validate"))
      return Response.json({
        client_id: "mock-client",
        user_id: "42",
        login: "owner",
        scopes: SCOPES,
      });
    if (path.includes("users?")) return Response.json({ data: [{ id: "42" }] });
    if (path.endsWith("/chat/messages"))
      return Response.json({
        data: [{ is_sent: delivered, message_id: "notice-1" }],
      });
    return Response.json({ data: [{ status: "enabled" }] });
  }) as typeof fetch;
  const t = new Twitch(
    (m) => messages.push(m),
    (s) => statuses.push(s),
    request,
    (url) => {
      const s = new Socket(url);
      sockets.push(s);
      return s as unknown as WebSocket;
    },
  );
  Object.assign(t, {
    tokens: { access_token: "mock-only", refresh_token: "mock-only" },
  });
  const flush = async () => {
    for (let i = 0; i < 8; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const welcome = (s: Socket) =>
    s.emit({
      metadata: { message_type: "session_welcome" },
      payload: { session: { id: "session", keepalive_timeout_seconds: 10 } },
    });
  try {
    await t.connect("owner");
    assert.equal(t.connected, false);
    welcome(sockets[0]);
    await flush();
    assert.equal(t.connected, true);
    assert.equal(
      calls.filter((c) => c.path.endsWith("eventsub/subscriptions")).length,
      1,
    );
    const frame = {
      metadata: {
        message_type: "notification",
        message_id: "event-1",
        subscription_type: "channel.chat.message",
        message_timestamp: new Date().toISOString(),
      },
      payload: {
        subscription: { type: "channel.chat.message" },
        event: {
          broadcaster_user_id: "42",
          chatter_user_id: "7",
          chatter_user_name: "Player",
          message_id: "chat-1",
          message: { text: "!join" },
        },
      },
    };
    sockets[0].emit(frame);
    sockets[0].emit(frame);
    await flush();
    assert.equal(messages.length, 1);
    assert.deepEqual(await t.send("Turn 1"), {
      messageId: "notice-1",
      isSent: true,
    });
    delivered = false;
    await assert.rejects(t.send("Turn 2"), /did not deliver/);
    sockets[0].emit({
      metadata: { message_type: "session_reconnect" },
      payload: {
        session: {
          reconnect_url: "wss://eventsub.wss.twitch.tv/ws?reconnect=mock",
        },
      },
    });
    await flush();
    assert.equal(sockets[0].closed, false);
    welcome(sockets[1]);
    await flush();
    assert.equal(sockets[0].closed, true);
    assert.equal(t.connected, true);
    assert.equal(
      calls.filter((c) => c.path.endsWith("eventsub/subscriptions")).length,
      1,
    );
    sockets[1].close();
    assert.equal(t.connected, false);
    ctx.mock.timers.tick(2500);
    assert.equal(sockets.length, 3);
    sockets[2].close();
    ctx.mock.timers.tick(2500);
    assert.equal(sockets.length, 4);
    welcome(sockets[3]);
    await flush();
    assert.equal(t.connected, true);
    assert.equal(
      calls.filter((c) => c.path.endsWith("eventsub/subscriptions")).length,
      2,
    );
    ctx.mock.timers.tick(11000);
    assert.equal(t.connected, false);
    assert.ok(statuses.includes(false));
  } finally {
    t.disconnect();
    ctx.mock.timers.reset();
    if (oldId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = oldSecret;
  }
});
test("EventSub uses authenticated IDs, sent timestamp and exact channel/type", () => {
  const f = {
    metadata: {
      message_type: "notification",
      subscription_type: "channel.chat.message",
      message_timestamp: "2026-10-27T12:00:00.123456789Z",
    },
    payload: {
      subscription: { type: "channel.chat.message" },
      event: {
        broadcaster_user_id: "42",
        chatter_user_id: "7",
        chatter_user_name: "<img src=x>",
        message_id: "abc",
        message: { text: "!join" },
      },
    },
  };
  assert.deepEqual(decodeChat(f, "42"), {
    id: "abc",
    userId: "7",
    name: "<img src=x>",
    text: "!join",
    timestamp: 1793102400123,
  });
  assert.equal(decodeChat(f, "43"), null);
  assert.equal(
    decodeChat(
      { ...f, metadata: { ...f.metadata, message_timestamp: "bad" } },
      "42",
    ),
    null,
  );
  assert.equal(
    decodeChat(
      {
        ...f,
        metadata: { ...f.metadata, subscription_type: "channel.follow" },
      },
      "42",
    ),
    null,
  );
});
test("OAuth requests only chat scopes, fixed callback, rejects missing/forged state", async () => {
  const oldId = process.env.TWITCH_CLIENT_ID,
    oldSecret = process.env.TWITCH_CLIENT_SECRET;
  process.env.TWITCH_CLIENT_ID = "test-client";
  process.env.TWITCH_CLIENT_SECRET = "test-secret";
  try {
    const t = new Twitch(
      () => {},
      () => {},
      async () => {
        throw Error("Must not exchange invalid state");
      },
    );
    const u = new URL(t.authorization());
    assert.equal(u.searchParams.get("redirect_uri"), REDIRECT);
    assert.deepEqual(u.searchParams.get("scope")?.split(" "), SCOPES);
    assert.ok(u.searchParams.get("state")!.length >= 32);
    await assert.rejects(t.callback("code", ""));
    await assert.rejects(t.callback("code", "forged"));
  } finally {
    if (oldId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = oldSecret;
  }
});
