# Last Banner

A local Twitch territorial battle royale. One selected player commands an adjacent attack. A combat winner absorbs **every territory** of the losing player. Attacking gray captures its entire orthogonally connected component and **ends the turn**. No powers or surrender.

This is an independent project. It does not use Pressure Lines files, credentials, services or assets.

## Run on Windows

Tested with Node **24.14.0**, npm **11.9.0** and PowerShell. No Docker or database.

```powershell
# Open PowerShell in your extracted or cloned LastBanner folder.
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd start
```

- Host: **http://localhost:3101/host**
- OBS/public view: **http://localhost:3100**
- OAuth callback: **http://localhost:3102/oauth/callback**

All three listeners bind to loopback (`127.0.0.1`). No tunnel is required. Ports are fixed; if busy, startup fails without stopping the other process. Do not expose the host or callback through a tunnel. The host trusts the local OS user, checks Host/Origin/CSRF and uses an HttpOnly, SameSite cookie scoped to `/host`. Opening/reloading `/host` restores a stale session cookie after a server restart. It is not a remotely hosted administration service.

State is in memory. **A full server restart ends the game.** Refreshing host or OBS does not change results or reroll dice. Export events before restarting when you need an audit trail.

## Exact fixture

This route needs **no Twitch account, application, `.env`, tokens or developer credentials**. Install Node.js 24 and run the commands above on your own Windows computer. OBS is optional: the public view also works in a browser. Internet is needed for `npm ci`; the fixture then runs locally without Twitch. This is not a permanently hosted website.

1. Open the host. Select `FIXTURE`, click `New game / reset…`, type `RESET`.
2. Click `Next simulated turn`, then `Play fixture attack`.
3. Wait for each presentation before advancing. Repeat for turn 2. On turn 3, click `Expire current test window` instead of attacking.
4. Turns 4–6: `Next simulated turn`, then `Play fixture attack`.
5. Diego wins with six territories: **4 combat + 1 inactivity + 1 neutral = 6 turns**. There is no turn 7.

Click gray B2 after turn 3 to preview the component and turn-ending rule. Fixture selection and dice exist only in fixture mode. Its explicit 15-second clock advances only with the test-clock control; presentations use wall time. A premature next turn is rejected.

## Simulated players

Reset into `SIMULATED PLAYERS`; add 2–100 players, close the lobby, then start. Click an origin and adjacent destination to fill a command, or type `!attack A1 B1`. The test command acts as the selected fictitious player. It never impersonates a Twitch participant. Invalid commands do not consume the turn. Use `Next simulated turn` after a result. Advance the test clock to inspect inactivity; pause freezes the remaining decision time.

```powershell
npm.cmd run simulate
```

Reproducible policies and seeds are written to `evidence/simulations.json`. These are engine runs with artificial players, instant commands, an inactivity every seventh turn and no presentation delay. Compute times are **not** real match duration or human validation. Technical checks cover up to 100 players, not more.

## Dedicated Twitch application

The developer's application was tested, but its credentials are not distributed. Evaluators must register their own application and authorize their own broadcaster account using the steps below. A real match requires at least two distinct Twitch accounts. Do not reuse another project's application or tokens.

Register an application in the [Twitch developer console](https://dev.twitch.tv/console/apps):

| Field | Value |
| --- | --- |
| Name | `Last Banner Local` (append your channel if this globally unique name is unavailable; code does not depend on the display name) |
| OAuth Redirect URL | `http://localhost:3102/oauth/callback` |
| Category | `Game Integration` |
| Client type | `Confidential` |

Create a client secret and put values **only in the local `.env` file**:

```powershell
Copy-Item .env.example .env
notepad .env
```

```dotenv
TWITCH_CLIENT_ID=your_new_application_client_id
TWITCH_CLIENT_SECRET=your_new_application_client_secret
TWITCH_CHANNEL=your_broadcaster_login
```

`TWITCH_CHANNEL` is the lowercase login without `@` or a URL. The broadcaster account must be the account that authorizes the application. Do not send secrets through chat. `.env` and `.local/` are excluded from Git. Tokens are stored in `.local/twitch-tokens.json`, outside every static route; protect this directory with your Windows account permissions. Tokens are local plaintext, not an OS credential vault; never share this folder or diagnostic copies of it.

Restart Last Banner after editing `.env`. In the host, select `REAL TWITCH` and reset, click `Authorize Twitch`, authorize the broadcaster account, then return to the host and click `Connect`. Authorization requests exactly **`user:read:chat user:write:chat`**. No moderation, email, Bits or subscription scopes. OAuth uses one-time state, a ten-minute authorization window and the authorization-code flow. Tokens are validated on connection and hourly while connected; a 401 triggers a serialized refresh.

This follows Twitch's [installed chatbot authentication](https://dev.twitch.tv/docs/chat/authenticating/), [authorization-code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/), [validation](https://dev.twitch.tv/docs/authentication/validate-tokens/) and [refresh](https://dev.twitch.tv/docs/authentication/refresh-tokens/) guidance.

## Real match

1. Connect in a real lobby. Open registration. Participants (including the streamer if desired) send a real `!join` in the connected Twitch channel.
2. Choose **Decision time** before starting: an integer from **15 to 120 seconds**, default **30**. Presets are 15/30/45/60, plus numeric input and `Apply seconds`. The public lobby displays the value. It locks when the match starts; a new normal match resets to 30. Close the lobby at 2–100 unique Twitch user IDs and start.
3. The selected player receives a chat notification with the turn number and command format. The configured window opens **after successful chat delivery**. Only the first valid command from that Twitch ID is accepted. `B3 C3` is a format example, not a map-specific recommendation. The engine and private server validate configuration; public requests cannot change it.
4. Combat is calculated once. The server presents frontier, rolling, discard, two comparisons, optional sudden death, whole-empire highlight and transfer in order. Combat takes 7.5 seconds; sudden death adds a 0.5-second introduction and 1.8 seconds per recorded pair (0.7 rolling, 1.1 reveal/comparison). The two-pair fixture takes 11.6 seconds. The deadline is calculated from the actual recorded rounds, never a browser acknowledgment; no round is skipped to meet a global animation cap. Neutral and inactivity take 3 seconds. No next-player clock runs during presentation. The next real selection follows automatically; gray capture consumes the turn without dice.
5. If Twitch disconnects or notification delivery fails, decisions pause. Reconnection communicates and preserves the exact remaining milliseconds, never resetting the configured duration. Host pause remains paused until explicitly resumed. Lost events are not reconstructed. Exports include `decisionMs`, deadlines and pause/resume records.
6. Export the event log from the host. Reset requires typing `RESET`.

EventSub WebSocket uses `channel.chat.message` version `1`, filtered to the configured broadcaster's real ID. Both EventSub delivery IDs and chat message IDs are deduplicated. The engine rejects metadata timestamps preceding the current opening/resumption and commands received at or after the server deadline. As documented in the [WebSocket reference](https://dev.twitch.tv/docs/eventsub/websocket-reference/), `message_timestamp` means **the time Twitch sent the notification**, not when a viewer originally typed the message. EventSub does not provide an original chat-send timestamp in this event. This is the available temporal boundary, not proof of viewer intent; timestamps are normalized to milliseconds. Keep the Windows clock synchronized. A network failure can only be paused when detected (socket closure or missing keepalive), not retroactively inferred. [WebSocket lifecycle documentation](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/) describes reconnect handoff and the absence of replay after a lost connection.

## OBS and reading the board

Add a Browser Source with URL `http://localhost:3100`, width **1920**, height **1080**. No admin URL, cookies or tokens are needed. The scene scales uniformly for reduced previews. Square territories have permanent coordinates, numbered banners, names/abbreviations and ownership borders. At 100 cells, focus/selection shows full identity below the map. Open `All banners` for the complete ranking; ties share a rank. Gray focus highlights its entire component. `Reduce motion` and the OS preference disable movement without hiding information.

The rebuilt war table uses original SVG/CSS artwork, with no external art, fonts or samples. `src/presentation.ts` separates the calculated engine result from its public reveal: old ownership, active players and ranking remain until the scheduled reveal. A 650 ms stage highlights every losing possession before transfer, including disconnected possessions. The camera returns to overview for transfer; dense boards get a small bounded zoom when it fits, while large cells do not zoom. The private export includes both `engineState` and projected `state`.

The next turn depends on the server timeline, never a browser acknowledgment. Refreshes/late arrivals join the current stage, not the history. Finished-state reloads and late reconnections do not replay celebration or effects. Each sudden-death pair has a numbered rolling phase with hidden values, then its actual comparison. A tie leads to another pair; neither future dice nor the new owners/ranking are exposed early. The unique chat winner announcement waits for the completed final presentation.


## Evaluation checks

Run npm.cmd run check and npm.cmd test. The tests include the six-turn fixture, repeated sudden death, total empire transfer, neutral capture, decision-time validation, pause/reconnect mocks, presentation redaction and winner-notice deduplication. npm.cmd run simulate writes reproducible artificial-player results to evidence/. No real Twitch users are simulated by those runs. Browser automation and browser downloads are optional and not required for the offline route.

## Audio in OBS

Use one Browser Source at http://localhost:3100, 1920 by 1080, with Control audio via OBS. Source → Interact → Enable audio; start with Music 25 and Effects 40. Reload requires explicit activation. The private host never plays sound. Avoid a second audible public browser view. Monitor Off still sends audio to the recording; headphone monitoring is a separate route and must not be captured again through Desktop Audio. At final, the score ends without replaying the celebration on reload. Reduce motion and Mute do not affect game rules.

## Validation and limits

Real chat integration, accepted attacks, controlled application reconnection and winner delivery were checked with two real Twitch accounts controlled by one human operator. Larger populations up to 100 were simulated, not community-tested. The approved demo combines a real Twitch match (two accounts controlled by one operator), a separately labelled simulated fixture, and an authentic Codex session reviewing an existing change. No guarantee of fun, balance, retention or 100-user live throughput is claimed. Raw private development logs are deliberately excluded from this evaluation package. A single winner submission is claimed before delivery; ambiguous network failure is logged without automatic retry.

## License and assets

See ATTRIBUTIONS.md. First-party code and original assets are MIT licensed, copyright (c) 2026 Diego Martin Iglesias. See LICENSE. Source assets are included; no private credentials or paid asset downloads are required.
