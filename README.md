# peerTalk

Multi-peer WebRTC video chat with text DataChannel — built to demonstrate WebRTC depth, signaling design, and prod-leaning engineering practices.

> **Stack:** React 19 · TypeScript · Socket.IO 4 · Express 5 · Node 20 · coturn (STUN/TURN) · Docker

---

## Why this project

WebRTC interviews probe four areas — NAT traversal, signaling, peer negotiation, and media plumbing. This repo implements all four end-to-end:

- **Mesh topology up to 4 peers** — each peer holds an `RTCPeerConnection` per remote peer (`Map<peerId, RTCPeerConnection>`).
- **Perfect Negotiation pattern** (per [MDN spec](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)) — resolves SDP glare deterministically via polite/impolite roles.
- **Room-based signaling** — Socket.IO server tracks room membership and broadcasts `users-update` so peers know whom to call.
- **DataChannel chat** — text messages travel peer-to-peer over `RTCDataChannel`, not the signaling server.
- **STUN + TURN ready** — coturn `docker-compose.yml` included; client reads ICE servers from env.
- **Media controls** — mute mic, toggle camera, screen-share via `getDisplayMedia` + `replaceTrack`.

---

## Architecture

```
┌──────────────┐  signaling (Socket.IO)  ┌────────────────┐
│   Browser A  │ ─────────────────────▶ │ Express server │
│   (React)    │ ◀───────────────────── │   :5001        │
└──────┬───────┘                        └────────┬───────┘
       │                                         │
       │ ICE / SDP via signaling                 │
       │                                         │
       │            STUN / TURN                  │
       │       ┌────────────────────┐            │
       └─────▶ │   coturn :3478     │ ◀──────────┘
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

### Call setup sequence (2 peers)

```
A                Server               B
│  join-room ───▶ │                   │
│                 │ ──── users ────▶ B │
│                 │ ◀── join-room ── B │
│ ◀─── users ─────│                   │
│                                     │
│ createOffer + setLocalDescription   │
│ ── signal(offer) ──▶ Server ──▶ B   │
│                                     │ setRemoteDescription
│                                     │ createAnswer + setLocalDescription
│ ◀── Server ◀── signal(answer) ── B  │
│ setRemoteDescription                │
│                                     │
│ ── ICE candidates (trickled) ─────▶ │
│ ◀──────────────── ICE candidates ── │
│                                     │
│ ═══════════ SRTP media + DataChannel ═══════════
```

---

## Local dev

```bash
# 1. install
cd server && npm install
cd ../client && npm install

# 2. signaling server
cd server && npx ts-node index.ts        # :5001

# 3. client
cd client && npm start                    # :3000

# 4. (optional) coturn for TURN testing across NATs
docker compose -f infra/docker-compose.yml up coturn
```

Open `http://localhost:3000` in two browser windows (or two devices on the same LAN), enter the same room id, and dial.

### Env vars

`client/.env` (optional):

```
REACT_APP_SIGNALING_URL=http://localhost:5001
REACT_APP_TURN_URL=turn:localhost:3478
REACT_APP_TURN_USER=peertalk
REACT_APP_TURN_CRED=peertalk
```

`server/.env` (optional):

```
PORT=5001
CORS_ORIGIN=http://localhost:3000
```

---

## Key design decisions

| Decision | Why |
|---|---|
| **Mesh, not SFU** | No media server to run; bandwidth O(n²) is fine ≤ 4 peers; keeps signaling logic readable. SFU (e.g. mediasoup) is the next milestone. |
| **Perfect Negotiation** | Removes hand-coded glare handling. Polite peer rolls back, impolite peer ignores — both sides converge without bespoke flags. |
| **DataChannel for chat** | Demonstrates non-media DC usage; messages stay E2E without going through signaling. |
| **STUN public + TURN local** | Google's public STUN is fine for demo. TURN requires bandwidth (~$$) so it's containerised and opt-in. |
| **`Map<peerId, RTCPeerConnection>` in a ref** | State updates would re-init connections. Refs survive renders. |

---

## Known limits / future work

- **Mesh ceiling ≈ 4 peers** — bandwidth scales O(n²). Next: SFU via mediasoup.
- **No auth on signaling** — JWT-on-handshake is on the roadmap.
- **No Redis adapter** — single-instance Socket.IO today; Redis pub/sub adapter unlocks horizontal scale.
- **No recording** — `MediaRecorder` integration pending.
- **No persistence** — rooms are ephemeral in-memory.

---

## Talking points (interview prep)

- Why TURN exists: symmetric NAT / strict corp firewalls block direct UDP.
- ICE trickling vs. full-gather: latency win vs. cleanliness.
- DTLS-SRTP: WebRTC media encryption is mandatory.
- Glare: simultaneous offers; perfect negotiation's rollback solves it.
- Socket.IO vs. raw WebSocket: built-in reconnect, rooms, fallback.

---

## License

MIT — see [LICENSE](./LICENSE).
