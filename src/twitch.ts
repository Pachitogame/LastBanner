import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { Chat } from "./engine.js";
export const REDIRECT = "http://localhost:3102/oauth/callback";
export const SCOPES = ["user:read:chat", "user:write:chat"];
export function decodeChat(frame: any, channel: string): Chat | null {
  const m = frame?.metadata,
    e = frame?.payload?.event;
  if (
    m?.message_type !== "notification" ||
    m.subscription_type !== "channel.chat.message" ||
    frame?.payload?.subscription?.type !== "channel.chat.message" ||
    e?.broadcaster_user_id !== channel
  )
    return null;
  const timestamp = Date.parse(m.message_timestamp);
  if (
    !Number.isFinite(timestamp) ||
    typeof e.chatter_user_id !== "string" ||
    typeof e.message_id !== "string" ||
    typeof e.message?.text !== "string"
  )
    return null;
  return {
    id: e.message_id,
    userId: e.chatter_user_id,
    name: String(e.chatter_user_name),
    text: e.message.text,
    timestamp,
  };
}
type Tokens = { access_token: string; refresh_token: string };
export class Twitch {
  status = "Not configured";
  channel = "";
  userId = "";
  login = "";
  connected = false;
  private tokens: Tokens | null = null;
  private socket: WebSocket | null = null;
  private sockets = new Set<WebSocket>();
  private oauthState = "";
  private oauthExpires = 0;
  private timer: NodeJS.Timeout | null = null;
  private hourly: NodeJS.Timeout | null = null;
  private stopped = true;
  private generation = 0;
  private refreshJob: Promise<void> | null = null;
  private seen = new Set<string>();
  constructor(
    private onChat: (msg: Chat) => void,
    private onStatus: (connected: boolean) => void,
    private request: typeof fetch = fetch,
    private socketFactory: (url: string) => WebSocket = (url) =>
      new WebSocket(url),
  ) {}
  configured() {
    return Boolean(
      process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET,
    );
  }
  authorization() {
    if (!this.configured())
      throw Error(
        "Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env first.",
      );
    this.oauthState = randomBytes(32).toString("hex");
    this.oauthExpires = Date.now() + 600000;
    return (
      "https://id.twitch.tv/oauth2/authorize?" +
      new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID!,
        redirect_uri: REDIRECT,
        response_type: "code",
        scope: SCOPES.join(" "),
        state: this.oauthState,
        force_verify: "true",
      })
    );
  }
  async callback(code: string, state: string) {
    if (!state || state !== this.oauthState || Date.now() > this.oauthExpires)
      throw Error(
        "Invalid or expired OAuth state. Restart authorization from the host.",
      );
    this.oauthState = "";
    await this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
    });
    await this.validate();
    this.status = "Authorized; connect from the host.";
  }
  private async save() {
    await mkdir(".local", { recursive: true });
    await writeFile(".local/twitch-tokens.tmp", JSON.stringify(this.tokens), {
      mode: 0o600,
    });
    await rename(".local/twitch-tokens.tmp", ".local/twitch-tokens.json");
  }
  private async exchange(data: Record<string, string>) {
    const r = await this.request("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        ...data,
        client_id: process.env.TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw Error(
        `Twitch token exchange failed (${r.status}); authorize again.`,
      );
    const body: any = await r.json();
    if (!body.access_token || !body.refresh_token)
      throw Error("Invalid token response");
    this.tokens = body;
    await this.save();
  }
  private async refresh() {
    if (!this.refreshJob)
      this.refreshJob = this.exchange({
        grant_type: "refresh_token",
        refresh_token: this.tokens!.refresh_token,
      }).finally(() => (this.refreshJob = null));
    await this.refreshJob;
  }
  async validate(retry = true): Promise<void> {
    if (!this.tokens) throw Error("Authorize Twitch first.");
    const r = await this.request("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${this.tokens.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401 && retry) {
      await this.refresh();
      return this.validate(false);
    }
    if (!r.ok) throw Error("Twitch authorization is no longer valid.");
    const v: any = await r.json();
    if (
      v.client_id !== process.env.TWITCH_CLIENT_ID ||
      !SCOPES.every((s) => v.scopes?.includes(s))
    )
      throw Error("Wrong Twitch app or missing chat permissions.");
    this.userId = v.user_id;
    this.login = v.login;
  }
  private async api(path: string, body?: object, retry = true): Promise<any> {
    if (!this.tokens) throw Error("Authorize Twitch first.");
    const r = await this.request("https://api.twitch.tv/helix/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.tokens.access_token}`,
        "Client-Id": process.env.TWITCH_CLIENT_ID!,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401 && retry) {
      await this.refresh();
      return this.api(path, body, false);
    }
    if (!r.ok) throw Error(`Twitch API failed (${r.status}).`);
    return r.json();
  }
  async connect(channelLogin: string) {
    this.disconnect();
    if (!this.configured())
      throw Error("Configure this project’s Twitch application first.");
    if (!this.tokens) {
      try {
        this.tokens = JSON.parse(
          await readFile(".local/twitch-tokens.json", "utf8"),
        );
      } catch {
        throw Error("Authorize Twitch from the host first.");
      }
    }
    await this.validate();
    const users = await this.api(
      "users?login=" + encodeURIComponent(channelLogin),
    );
    this.channel = users.data?.[0]?.id;
    if (!this.channel || this.channel !== this.userId)
      throw Error(
        "Authorize the broadcaster account and enter its channel login.",
      );
    this.stopped = false;
    this.status = "Connecting";
    this.open();
    this.hourly = setInterval(() => {
      void this.validate().catch(() => {
        this.disconnect();
        this.status = "Authorization failed; authorize again.";
      });
    }, 3600000);
  }
  disconnect() {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    if (this.hourly) clearInterval(this.hourly);
    for (const s of this.sockets) s.close();
    this.sockets.clear();
    this.socket = null;
    this.connected = false;
    this.status = "Disconnected";
    this.onStatus(false);
  }
  private lost() {
    if (this.stopped) return;
    this.socket = null;
    this.connected = false;
    this.status = "Disconnected — retrying";
    this.onStatus(false);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), 2500);
  }
  private open(url = "wss://eventsub.wss.twitch.tv/ws", old?: WebSocket) {
    if (this.stopped) return;
    const gen = this.generation;
    const s = this.socketFactory(url);
    this.sockets.add(s);
    let watchdog: NodeJS.Timeout;
    let timeout = 10000;
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => s.close(), timeout + 1000);
    };
    arm();
    s.onmessage = (event) => {
      void (async () => {
        if (gen !== this.generation) return;
        const frame = JSON.parse(String(event.data));
        const m = frame.metadata;
        if (!m) return;
        if (m.message_type === "session_welcome") {
          timeout =
            frame.payload.session.keepalive_timeout_seconds * 1000 || 10000;
          arm();
          if (!old)
            await this.api("eventsub/subscriptions", {
              type: "channel.chat.message",
              version: "1",
              condition: {
                broadcaster_user_id: this.channel,
                user_id: this.userId,
              },
              transport: {
                method: "websocket",
                session_id: frame.payload.session.id,
              },
            });
          if (gen !== this.generation) return;
          this.socket = s;
          if (old) old.close();
          this.connected = true;
          this.status = "Connected";
          this.onStatus(true);
        } else if (m.message_type === "session_keepalive") arm();
        else if (m.message_type === "session_reconnect") {
          const next = frame.payload.session.reconnect_url;
          const u = new URL(next);
          if (u.protocol !== "wss:" || u.hostname !== "eventsub.wss.twitch.tv")
            throw Error("Invalid reconnect endpoint");
          this.open(next, s);
        } else if (m.message_type === "revocation") {
          this.disconnect();
          this.status = "Subscription revoked; authorize again.";
        } else if (m.message_type === "notification") {
          arm();
          if (this.seen.has(m.message_id)) return;
          this.seen.add(m.message_id);
          if (this.seen.size > 20000)
            this.seen.delete(this.seen.values().next().value!);
          const chat = decodeChat(frame, this.channel);
          if (chat && this.connected) this.onChat(chat);
        }
      })().catch(() => {
        this.status = "Twitch connection error";
        s.close();
      });
    };
    s.onerror = () => s.close();
    s.onclose = () => {
      clearTimeout(watchdog);
      this.sockets.delete(s);
      if (gen === this.generation && (this.socket === s || !this.socket))
        this.lost();
    };
  }
  async send(message: string) {
    if (!this.connected) throw Error("Twitch is disconnected.");
    const data = await this.api("chat/messages", {
      broadcaster_id: this.channel,
      sender_id: this.userId,
      message: message.slice(0, 490),
    });
    if (!data.data?.[0]?.is_sent)
      throw Error("Twitch did not deliver the message.");
    return { messageId: data.data[0].message_id, isSent: true };
  }
}
