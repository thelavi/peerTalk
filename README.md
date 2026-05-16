<div align="center">

# peerTalk

**Browser-to-browser video, voice & chat — built end-to-end on free tier.**

[![Live demo](https://img.shields.io/badge/live%20demo-peer--talk--six.vercel.app-4f8cff?style=for-the-badge)](https://peer-talk-six.vercel.app)
[![Tests](https://img.shields.io/badge/tests-95%20passing-22c55e?style=for-the-badge)](#testing)
[![Coverage](https://img.shields.io/badge/coverage-96%25-22c55e?style=for-the-badge)](#testing)
[![Stack](https://img.shields.io/badge/stack-React%2019%20·%20TS%20·%20Vite%20·%20Supabase%20·%20WebRTC-1f2937?style=for-the-badge)](#tech-stack)

A production-leaning WebRTC playground that proves out NAT traversal, signaling design, RLS-secured Postgres, and a $0 deploy stack — written to be read.

</div>

---

## TL;DR for recruiters

I built this to demonstrate **WebRTC depth** (mesh topology, Perfect Negotiation, DataChannel chat), **product-grade auth + DB modelling** (Supabase Postgres with Row-Level Security policies on every table), and **serverless deploy discipline** (Vercel for the static client, Supabase for everything backend, Metered.ca for TURN — total hosting cost: $0).

It is **not** a wrapper around a third-party SDK. The negotiation logic, signaling state machine, channel cleanup, and DataChannel framing are written from scratch. The DB schema is hand-modelled with RLS policies and triggers. ~96% test coverage with Vitest + Testing Library.

🔗 **Try it:** [peer-talk-six.vercel.app](https://peer-talk-six.vercel.app) — open in two browser windows, sign up two accounts, create a room, join from the second window.

---

## What it does

| Feature | How it's built |
|---|---|
| **Multi-peer video + voice** | Mesh topology, `Map<peerId, RTCPeerConnection>`, SRTP encryption (browser-default), supports up to ~4 peers before O(n²) bandwidth bites. |
| **Real-time text chat** | Hybrid: peer-to-peer `RTCDataChannel` for live messages, Postgres + CDC replication as durable fallback for offline / late-joining peers. |
| **Email/password auth** | Supabase Auth with JWT auto-refresh. A Postgres trigger auto-creates the `profiles` row on signup. |
| **Persistent rooms** | Named rooms with slugs (`/room/demo`), private/public flag, owner role, member auto-add via DB trigger. |
| **Screen sharing** | `getDisplayMedia` + `RTCRtpSender.replaceTrack` — no renegotiation needed. |
| **Mute / cam toggle** | Drives `MediaStreamTrack.enabled`; instant, no signaling. |
| **Call history** | Every call writes `call_sessions` + per-user `call_participants` with duration tracking; recent-calls view on the lobby. |
| **Connection robustness** | Defensive channel-cache sweep on join, idempotent peer cleanup, ICE-candidate end marker skipped, DataChannel size cap (8 KB) against malicious peers. |

---

## Architecture

```
┌────────────────┐                ┌──────────────────────────────┐
│  React (Vite)  │  signaling /   │  Supabase (managed)          │
│  on Vercel     │ ──────────────▶│   - Postgres (with RLS)      │
│                │   chat persist │   - Auth (JWT)               │
│                │ ◀──────────────│   - Realtime channels        │
└──────┬─────────┘                │     (broadcast + presence)   │
       │                          └──────────────────────────────┘
       │
       │ ICE / SDP relayed via Realtime broadcast
       │
       │            STUN / TURN
       │       ┌────────────────────┐
       └─────▶ │  Google STUN       │
              │  + Metered.ca TURN │
              └────────────────────┘
                       ▲
                       │
              media (SRTP) peer-to-peer
                       │
                       ▼
                ┌──────────────┐
                │   Browser B  │
                └──────────────┘
```

### Two-peer call sequence

```
A                        Supabase                       B
│   POST /auth/login ───▶ │                            │
│ ◀── access JWT ─────────│                            │
│                                                      │
│  channel('room:demo').subscribe()                    │
│  channel.track({ online_at })       (presence join)  │
│                         │ ─── presence sync ───▶ B   │
│ ◀── presence sync ──────│                            │
│                                                      │
│  createOffer + setLocalDescription                   │
│  broadcast('signal', {description})                  │
│                         │ ──────────▶ B              │
│                                                      │ setRemoteDescription
│                                                      │ createAnswer + setLocalDescription
│ ◀───── broadcast('signal', {description}) ─────────  │
│  setRemoteDescription                                │
│                                                      │
│  broadcast('signal', {candidate}) ×N ──────────────▶ │
│ ◀──────────────── broadcast('signal', {candidate}) ── │
│                                                      │
│ ═════════════════ SRTP media + DataChannel ═════════════════
│
│  also: supabase.from('messages').insert(...)   ──▶  DB
│        → postgres_changes event delivers to B
```

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Client | **React 19 + Vite + TypeScript** | Vite is faster than CRA, smaller bundles, modern. Strict TS catches the boring bugs. |
| Realtime signaling | **Supabase Realtime** (Phoenix channels) | Removes the need to host a Socket.IO server. Free tier covers the demo. |
| DB + Auth | **Supabase Postgres + Auth** | RLS policies live next to the data; client talks DB directly via JWT, no API layer. |
| ICE | **Google STUN + Metered.ca TURN** | STUN solves ~70% of NATs; TURN relays the rest. Both have free tiers. |
| Hosting | **Vercel** (static SPA) | Push to `main` → live in ~60s. |
| Tests | **Vitest + Testing Library + jsdom** | Same Vite pipeline; in-memory WebRTC fakes for deterministic peer simulation. |

---

## Why this project is worth reviewing

| Topic | Where to look | What's interesting |
|---|---|---|
| **Perfect Negotiation** | [`client/src/hooks/useWebRTC.ts`](client/src/hooks/useWebRTC.ts) (`handleDescription`) | Resolves SDP "glare" (simultaneous offers) without bespoke flags — polite peer rolls back, impolite ignores, both converge. Implementation follows [MDN's reference](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation). |
| **Hybrid chat** | `useWebRTC.ts` (`sendChat`, `attachDataChannel`) | DataChannel for live, Postgres + CDC for offline durability. One UI path, two transports, dedup by message id. |
| **RLS as the security layer** | [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) | Every table has policies; `is_room_member()` is a `SECURITY DEFINER` helper that breaks RLS recursion on the `messages` table. |
| **Channel lifecycle** | `useWebRTC.ts` (`joinRoom`, `leaveRoom`) | Supabase JS caches channels by topic — naive `unsubscribe()` leaves stale instances. Defensive sweep + `removeChannel()` fix the `cannot add presence callbacks after subscribe()` bug. |
| **Auth + leak cleanup** | [`client/src/App.tsx`](client/src/App.tsx) (`handleSignOut`) | Sign-out mid-call closes peer connections + stops local tracks first, so the browser releases the camera. |
| **Mock-first tests** | [`client/src/test/setup.ts`](client/src/test/setup.ts) + [`mockSupabase.ts`](client/src/test/mockSupabase.ts) | Hand-built fakes for `RTCPeerConnection`, `MediaStream`, and Supabase channel + auth + query builder. Tests drive glare, ICE candidates, presence sync, postgres_changes — without a network. |

---

## Repo map

```
peerTalk/
├── client/                          # React + Vite + TS app
│   ├── src/
│   │   ├── App.tsx                  # Shell: lobby + call view + chat panel
│   │   ├── hooks/
│   │   │   ├── useAuth.ts           # Supabase Auth wrapper
│   │   │   ├── useRooms.ts          # rooms CRUD + membership
│   │   │   └── useWebRTC.ts         # ⭐ the WebRTC core (~540 lines)
│   │   ├── components/
│   │   │   ├── AuthGate.tsx         # gates the app behind login
│   │   │   ├── LoginForm.tsx
│   │   │   ├── SignupForm.tsx       # friendly error mapping (email/username taken)
│   │   │   └── CallHistory.tsx      # recent-calls list with duration
│   │   ├── lib/supabase.ts          # singleton client + env guard
│   │   ├── types/database.ts        # hand-rolled Supabase row types
│   │   └── test/                    # fakes for WebRTC + Supabase
│   ├── vite.config.ts
│   ├── vitest.config.ts             # coverage thresholds enforced in CI
│   └── vercel.json                  # SPA rewrites that don't break /assets
├── supabase/
│   └── migrations/0001_init.sql     # schema + RLS + triggers + Realtime publication
└── README.md
```

---

## Run locally

```bash
git clone https://github.com/thelavi/peerTalk.git
cd peerTalk/client
cp .env.example .env.local           # paste VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                          # http://localhost:3000
```

For the backend: create a Supabase project (free tier), open SQL editor, paste `supabase/migrations/0001_init.sql`, run it. Done.

For TURN (optional, only needed if peers sit behind symmetric NAT / corporate firewalls): sign up free at [metered.ca](https://www.metered.ca/tools/openrelay/) and paste the credentials into `.env.local`.

---

## <a name="testing"></a> Testing

```bash
npm test               # one-shot
npm run test:watch     # watch mode
npm run coverage       # generates coverage/ HTML report
```

**95 tests across 9 files** · ~96% statements / lines, 100% functions on every hook + every component, 87% branches.

Notable test patterns:

- **Hand-built WebRTC fakes** (`src/test/setup.ts`) — `FakeRTCPeerConnection` exposes `fireIce`, `fireTrack`, `fireDataChannel`, `fireConnectionState` so tests can drive any path through the negotiation state machine deterministically.
- **Glare simulation** — tests force `signalingState = "have-local-offer"` then deliver a remote offer to assert the polite peer accepts and the impolite peer drops it.
- **Postgres CDC simulation** — fake Supabase channel exposes `firePostgresInsert` to validate the de-dup + own-sender filter in `useWebRTC`.

Thresholds are enforced in `vitest.config.ts` — coverage regressions fail the test command.

---

## Known limits / future work

- **Mesh ceiling ≈ 4 peers** — bandwidth scales O(n²). Next milestone: SFU via mediasoup or LiveKit.
- **Friends / contacts UI** — schema is ready (`friendships` table), UI deferred.
- **Call recording** — `MediaRecorder` → Supabase Storage on the roadmap.
- **Web push** for incoming-call alerts.
- **GitHub Actions CI** — Vitest on PR, currently runs locally only.

---

## Interview talking points (for me, in case it helps)

- Why TURN exists at all (symmetric NAT / strict corp firewalls block direct UDP).
- ICE trickling vs full-gather (latency vs cleanliness).
- DTLS-SRTP — WebRTC media encryption is non-optional.
- Glare and how Perfect Negotiation's rollback solves it.
- RLS vs backend authz: pros (no API layer, JWT auto-applied) and cons (debug policies is harder, nested checks can be slow).
- Supabase Realtime presence: built on Phoenix Channels, uses CRDTs to converge membership state.
- Why I picked mesh over SFU for this size (no media server to host, simpler signaling logic, fine ≤4 peers).

---

## About

I'm Lavi — frontend engineer. peerTalk is one of my self-directed projects to keep WebRTC, signaling, and Postgres modelling fresh.

- GitHub: [@thelavi](https://github.com/thelavi)
- LinkedIn: [`lavi-sharma`](https://www.linkedin.com/in/lavi-sharma/) *(update before sending)*

If you want to chat about the code or a role, please reach out.

---

## License

MIT — see [LICENSE](./LICENSE).
