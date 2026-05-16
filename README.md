# peerTalk

Multi-peer WebRTC video chat with auth, persistent rooms, and durable text chat — built to demonstrate WebRTC depth, signaling design, RLS-secured Postgres, and serverless deploy.

> **Stack:** React 19 · TypeScript · Vite · Supabase (Postgres + Auth + Realtime) · WebRTC · Vercel

🔗 **Live demo:** https://peertalk.vercel.app *(deploy in progress)*
📂 **Repo:** https://github.com/thelavi/peerTalk

---

## Why this project

WebRTC interviews probe four areas — NAT traversal, signaling, peer negotiation, media plumbing — plus the wider product stack: auth, DB modelling, real-time data, deployment. This repo implements all of it on a free tier:

- **Mesh topology up to 4 peers** — each peer holds an `RTCPeerConnection` per remote peer (`Map<peerId, RTCPeerConnection>`).
- **Perfect Negotiation pattern** (per [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)) — SDP glare resolved deterministically via polite/impolite roles.
- **No custom signaling server.** Supabase Realtime channels carry presence (room membership) and broadcast (offer/answer/ICE).
- **Hybrid chat.** Live messages travel peer-to-peer over `RTCDataChannel`; the same message is persisted in Postgres so offline peers / late joiners get history.
- **Email/password auth** with Supabase Auth, JWT auto-refresh, profile row auto-created via DB trigger.
- **Row-Level Security** policies on every table — clients talk Postgres directly without a backend layer.
- **STUN + TURN** — Google STUN by default; client reads ICE servers from env, so dropping in Metered.ca TURN creds enables full NAT traversal.
- **Media controls** — mute mic, toggle cam, screen-share via `getDisplayMedia` + `replaceTrack`.
- **Call history** — `call_sessions` + `call_participants` rows let users see their past calls.

---

## Architecture

```
┌────────────────┐                ┌──────────────────────────────┐
│  React (Vite)  │  signaling /   │  Supabase (managed)          │
│  on Vercel     │ ──────────────▶│   - Postgres (RLS)           │
│                │   chat persist │   - Auth (JWT)               │
│                │ ◀──────────────│   - Realtime (broadcast +    │
└──────┬─────────┘                │     presence + CDC)          │
       │                          └──────────────────────────────┘
       │                                       ▲
       │ ICE / SDP via Realtime broadcast      │
       │                                       │
       │            STUN / TURN                │
       │       ┌────────────────────┐          │
       └─────▶ │  Google STUN       │ ◀────────┘
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
│  presence.track()                                    │
│                         │ ─── presence sync ───▶ B   │
│ ◀── presence sync ──────│                            │
│                                                      │
│  createOffer + setLocalDescription                   │
│  broadcast('signal', {description})                  │
│                         │ ──────────▶ B (via Realtime) │
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

## Repo layout

```
peerTalk/
├── client/                 # React + Vite + TS
│   ├── src/
│   │   ├── hooks/          # useAuth, useWebRTC, useRooms
│   │   ├── components/     # AuthGate, LoginForm, SignupForm, CallHistory
│   │   ├── lib/            # supabase client singleton
│   │   ├── types/          # database + signaling types
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── index.html
│   ├── vite.config.ts
│   └── vercel.json
├── supabase/
│   └── migrations/
│       └── 0001_init.sql   # schema + RLS + triggers
└── README.md
```

---

## Local dev

### 1. Supabase project

1. Create a project at https://supabase.com/dashboard (free tier).
2. Open the SQL editor, paste `supabase/migrations/0001_init.sql`, run it.
3. Settings → API → copy `Project URL` and `anon public` key.
4. Authentication → Providers → enable Email; turn off "Confirm email" for dev.

### 2. Client

```bash
cd client
cp .env.example .env.local
# paste VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev          # http://localhost:3000
```

Open the URL in two browsers (or incognito + normal), sign up two users, create a room in one, join from the other.

### 3. (Optional) TURN

Sign up free at https://www.metered.ca/tools/openrelay/, paste the returned URL/user/credential into `.env.local`:

```
VITE_TURN_URL=turn:...
VITE_TURN_USER=...
VITE_TURN_CRED=...
```

---

## Database schema

| Table | Purpose |
|---|---|
| `profiles` | 1-1 with `auth.users`, holds username/display_name/avatar |
| `rooms` | named persistent rooms with slug, owner, privacy flag |
| `room_members` | who can enter a room (auto-populated for owner) |
| `messages` | durable chat; replicated to clients via Postgres CDC |
| `call_sessions` | one row per call instance |
| `call_participants` | per-user join/leave + duration |

All tables RLS-protected. A `is_room_member(uuid)` SECURITY DEFINER helper centralises membership checks. Triggers handle profile creation on signup and owner-as-member on room create.

---

## Key design decisions

| Decision | Why |
|---|---|
| **Mesh, not SFU** | No media server to run; bandwidth O(n²) is fine ≤ 4 peers. SFU (mediasoup / LiveKit) is the next milestone. |
| **Supabase Realtime over custom WS** | One provider, free tier covers demo, no signaling server to host. Trade-off: tied to Supabase. |
| **Perfect Negotiation** | Removes hand-coded glare handling. Polite peer rolls back, impolite ignores — both converge. |
| **DataChannel + DB fallback** | Live updates stay P2P; offline / late-joiner reads come from Postgres via `postgres_changes`. |
| **Direct DB access from client** | RLS policies = auth check at the row level. No backend API layer needed. |
| **`Map<peerId, RTCPeerConnection>` in a ref** | State updates would re-init connections. Refs survive renders. |

---

## Known limits / future work

- **Mesh ceiling ≈ 4 peers** — bandwidth scales O(n²). Next: SFU.
- **No friends / contacts UI** — schema-ready, UI deferred to v0.3.
- **No call recording** — `MediaRecorder` → Supabase Storage is on the roadmap.
- **No push notifications** — web push for incoming-call alerts.
- **Mesh re-negotiation under churn** — works but not battle-tested.

---

## Talking points (interview prep)

- Why TURN exists: symmetric NAT / strict corp firewalls block direct UDP.
- ICE trickling vs. full-gather: latency win vs. cleanliness.
- DTLS-SRTP: WebRTC media encryption is mandatory.
- Glare: simultaneous offers; perfect negotiation's rollback solves it.
- RLS vs. backend authz: pros (no API layer, JWT auto-applied) and cons (policy debugging is harder, performance traps with nested checks).
- Supabase Realtime presence: built on Phoenix Channels, uses CRDTs to converge membership state across clients.

---

## License

MIT — see [LICENSE](./LICENSE).
