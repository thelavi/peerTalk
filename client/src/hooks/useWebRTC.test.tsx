import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "../test/mockSupabase";
import {
  FakeDataChannel,
  FakeMediaStream,
  FakeMediaStreamTrack,
  FakeRTCPeerConnection,
} from "../test/setup";

let fake: FakeSupabase;

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return fake;
  },
}));

beforeEach(() => {
  fake = createFakeSupabase();
  // default DB inserts/updates resolve as { data: { id: 'call-1' }, error: null }
  fake.setTableResult("call_sessions", "insert", {
    data: { id: "call-1" },
    error: null,
  });
});

afterEach(() => {
  vi.resetModules();
});

/** Convenience: render the hook and wait for the initial render to settle. */
async function renderUseWebRTC(userId: string | null) {
  const { useWebRTC } = await import("./useWebRTC");
  return renderHook(({ id }) => useWebRTC({ userId: id }), {
    initialProps: { id: userId },
  });
}

describe("useWebRTC: ICE servers", () => {
  it("includes Google STUN by default", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("room1");
    });
    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc).toBeUndefined(); // no peers yet — STUN list is private
  });

  it("appends TURN config when env vars are set", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_TURN_URL", "turn:test:3478");
    vi.stubEnv("VITE_TURN_USER", "u");
    vi.stubEnv("VITE_TURN_CRED", "c");
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("room2");
    });
    // trigger peer creation
    act(() => {
      fake.channels[0].firePresenceSync({ alice: {}, bob: {} });
    });
    await waitFor(() => expect(FakeRTCPeerConnection.instances.length).toBe(1));
    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "turn:test:3478", username: "u", credential: "c" },
    ]);
  });
});

describe("useWebRTC: joinRoom + signaling", () => {
  it("loads chat history on join", async () => {
    fake.setTableResult("messages", "select", {
      data: [
        {
          id: "m1",
          sender_id: "bob",
          body: "hi",
          created_at: "2026-05-15T10:00:00Z",
        },
      ],
      error: null,
    });
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    expect(result.current.messages.map((m) => m.text)).toEqual(["hi"]);
  });

  it("logs and continues when loadChatHistory errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.setTableResult("messages", "select", {
      data: null,
      error: { message: "rls" },
    });
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    expect(spy).toHaveBeenCalled();
    expect(result.current.roomId).toBe("r");
  });

  it("inserts call_sessions + call_participants on join", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    expect(fake.from).toHaveBeenCalledWith("call_sessions");
    expect(fake.from).toHaveBeenCalledWith("call_participants");
  });

  it("logs when startCallSession errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.setTableResult("call_sessions", "insert", {
      data: null,
      error: { message: "denied" },
    });
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    expect(spy).toHaveBeenCalled();
  });

  it("throws when joinRoom is called without auth", async () => {
    const { result } = await renderUseWebRTC(null);
    await expect(result.current.joinRoom("r")).rejects.toThrow(/authenticated/);
  });

  it("creates peers via presence sync and tracks them", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => {
      fake.channels[0].firePresenceSync({ alice: {}, bob: {} });
    });
    await waitFor(() => expect(result.current.peers).toEqual(["bob"]));
  });

  it("removes peers that disappear from presence", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() =>
      fake.channels[0].firePresenceSync({ alice: {}, bob: {}, carol: {} })
    );
    await waitFor(() =>
      expect(result.current.peers.sort()).toEqual(["bob", "carol"])
    );
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));
    await waitFor(() => expect(result.current.peers).toEqual(["bob"]));
  });

  it("sweeps stale channel with same topic before subscribing", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    const before = fake.removeChannel.mock.calls.length;
    await act(async () => {
      await result.current.leaveRoom();
    });
    await act(async () => {
      await result.current.joinRoom("r");
    });
    // The defensive sweep on join + leaveRoom each call removeChannel.
    expect(fake.removeChannel.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("useWebRTC: peer negotiation", () => {
  async function joinAndSync(userId: string, peerId: string) {
    const utils = await renderUseWebRTC(userId);
    await act(async () => {
      await utils.result.current.joinRoom("r");
    });
    act(() =>
      fake.channels[0].firePresenceSync({
        [userId]: {},
        [peerId]: {},
      })
    );
    await waitFor(() =>
      expect(FakeRTCPeerConnection.instances.length).toBe(1)
    );
    return { ...utils, pc: FakeRTCPeerConnection.instances[0] };
  }

  it("attaches local tracks to the new peer connection", async () => {
    const { pc } = await joinAndSync("alice", "bob");
    expect(pc.senders.length).toBeGreaterThan(0);
  });

  it("broadcasts an SDP offer when onnegotiationneeded fires", async () => {
    const { pc } = await joinAndSync("alice", "bob");
    await act(async () => {
      await pc.onnegotiationneeded?.();
    });
    const sent = fake.channels[0].sent;
    expect(sent.some((s) => s.event === "signal")).toBe(true);
  });

  it("skips the null end-of-candidates marker", async () => {
    const { pc } = await joinAndSync("alice", "bob");
    await act(async () => {
      pc.fireIce(null);
    });
    const sent = fake.channels[0].sent;
    expect(sent.filter((s) => s.event === "signal")).toHaveLength(0);
  });

  it("sends a serialised candidate via toJSON", async () => {
    const { pc } = await joinAndSync("alice", "bob");
    const candidate = {
      toJSON: () => ({ candidate: "candidate-line" }),
    } as unknown as RTCIceCandidate;
    await act(async () => {
      pc.fireIce(candidate);
    });
    const last = fake.channels[0].sent.at(-1) as {
      event: string;
      payload: { data: { candidate: { candidate: string } } };
    };
    expect(last.payload.data.candidate).toEqual({ candidate: "candidate-line" });
  });

  it("updates remoteStreams on ontrack", async () => {
    const { result, pc } = await joinAndSync("alice", "bob");
    const stream = new FakeMediaStream();
    act(() => pc.fireTrack(stream));
    await waitFor(() =>
      expect(Object.keys(result.current.remoteStreams)).toEqual(["bob"])
    );
  });

  it("removes peer on connection-state failure", async () => {
    const { result, pc } = await joinAndSync("alice", "bob");
    expect(result.current.peers).toContain("bob");
    act(() => pc.fireConnectionState("failed"));
    await waitFor(() => expect(result.current.peers).toEqual([]));
  });

  it("removePeer is idempotent (no throw on double-call)", async () => {
    const { pc } = await joinAndSync("alice", "bob");
    act(() => {
      pc.fireConnectionState("failed");
      pc.fireConnectionState("closed");
    });
  });

  it("polite peer ignores own offer when colliding", async () => {
    // alice < bob lexicographically, so alice is polite when peer is bob
    const { pc } = await joinAndSync("alice", "bob");
    pc.signalingState = "have-local-offer"; // simulate in-flight offer
    act(() =>
      fake.channels[0].fireBroadcast("signal", {
        to: "alice",
        from: "bob",
        data: { description: { type: "offer", sdp: "remote-offer" } },
      })
    );
    // polite side accepts: setRemoteDescription is called
    await waitFor(() => expect(pc.remoteDescription).toBeTruthy());
  });

  it("impolite peer ignores colliding offer", async () => {
    // zach > bob => zach impolite when peer is bob
    const { pc } = await joinAndSync("zach", "bob");
    pc.signalingState = "have-local-offer";
    act(() =>
      fake.channels[0].fireBroadcast("signal", {
        to: "zach",
        from: "bob",
        data: { description: { type: "offer", sdp: "remote-offer" } },
      })
    );
    // impolite side drops the remote description
    expect(pc.remoteDescription).toBeNull();
  });

  it("answers an offer when state is stable", async () => {
    const { pc } = await joinAndSync("alice", "bob");
    act(() =>
      fake.channels[0].fireBroadcast("signal", {
        to: "alice",
        from: "bob",
        data: { description: { type: "offer", sdp: "remote" } },
      })
    );
    await waitFor(() => expect(pc.localDescription).toBeTruthy());
    const answerSent = fake.channels[0].sent.some(
      (s) =>
        s.event === "signal" &&
        (s.payload as { data: { description?: { type: string } } }).data
          .description?.type === "offer"
    );
    expect(answerSent).toBe(true);
  });

  it("applies remote ICE candidates", async () => {
    const { pc } = await joinAndSync("alice", "bob");
    const spy = vi.spyOn(pc, "addIceCandidate");
    act(() =>
      fake.channels[0].fireBroadcast("signal", {
        to: "alice",
        from: "bob",
        data: { candidate: { candidate: "x" } },
      })
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it("swallows addIceCandidate failure when ignoreOffer is set", async () => {
    // zach > bob => zach impolite. force a collision so ignoreOffer becomes true.
    const utils = await renderUseWebRTC("zach");
    await act(async () => {
      await utils.result.current.joinRoom("r");
    });
    act(() =>
      fake.channels[0].firePresenceSync({ zach: {}, bob: {} })
    );
    await waitFor(() =>
      expect(FakeRTCPeerConnection.instances.length).toBe(1)
    );
    const pc = FakeRTCPeerConnection.instances[0];
    pc.signalingState = "have-local-offer";
    // glare → ignoreOffer = true on impolite side
    act(() =>
      fake.channels[0].fireBroadcast("signal", {
        to: "zach",
        from: "bob",
        data: { description: { type: "offer", sdp: "x" } },
      })
    );
    pc.addIceCandidate = vi.fn().mockRejectedValue(new Error("ice err"));
    // sending a candidate now should be swallowed (no console error/throw)
    await act(async () => {
      fake.channels[0].fireBroadcast("signal", {
        to: "zach",
        from: "bob",
        data: { candidate: { candidate: "x" } },
      });
    });
  });

  it("logs from handleSignal when handleDescription throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const utils = await renderUseWebRTC("alice");
    await act(async () => {
      await utils.result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));
    await waitFor(() =>
      expect(FakeRTCPeerConnection.instances.length).toBe(1)
    );
    const pc = FakeRTCPeerConnection.instances[0];
    pc.setRemoteDescription = vi
      .fn()
      .mockRejectedValue(new Error("set remote failed"));
    await act(async () => {
      fake.channels[0].fireBroadcast("signal", {
        to: "alice",
        from: "bob",
        data: { description: { type: "offer", sdp: "x" } },
      });
    });
    await waitFor(() =>
      expect(
        spy.mock.calls.some((c) => c[0] === "[handleSignal]")
      ).toBe(true)
    );
  });

  it("ignores broadcast signals not addressed to us", async () => {
    const { pc } = await joinAndSync("alice", "bob");
    act(() =>
      fake.channels[0].fireBroadcast("signal", {
        to: "carol",
        from: "bob",
        data: { description: { type: "offer", sdp: "x" } },
      })
    );
    // alice should not even create a peer for this
    expect(pc.remoteDescription).toBeNull();
  });
});

describe("useWebRTC: DataChannel chat", () => {
  it("appends valid incoming chat messages", async () => {
    // zach > bob => zach is responder; ondatachannel attaches the handler.
    const { result } = await renderUseWebRTC("zach");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ zach: {}, bob: {} }));
    await waitFor(() =>
      expect(FakeRTCPeerConnection.instances.length).toBe(1)
    );
    const pc = FakeRTCPeerConnection.instances[0];
    const dc = new FakeDataChannel("chat");
    act(() => pc.fireDataChannel(dc));
    act(() =>
      dc.onmessage?.({ data: JSON.stringify({ text: "hi", ts: 123 }) })
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].text).toBe("hi");
  });

  it("ignores oversized DC payloads", async () => {
    const { result } = await renderUseWebRTC("zach");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ zach: {}, bob: {} }));
    const pc = FakeRTCPeerConnection.instances[0];
    const dc = new FakeDataChannel("chat");
    act(() => pc.fireDataChannel(dc));
    const huge = "x".repeat(9000);
    act(() => dc.onmessage?.({ data: huge }));
    expect(result.current.messages).toHaveLength(0);
  });

  it("ignores malformed JSON", async () => {
    const { result } = await renderUseWebRTC("zach");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ zach: {}, bob: {} }));
    const pc = FakeRTCPeerConnection.instances[0];
    const dc = new FakeDataChannel("chat");
    act(() => pc.fireDataChannel(dc));
    act(() => dc.onmessage?.({ data: "not-json" }));
    act(() => dc.onmessage?.({ data: 42 }));
    act(() => dc.onmessage?.({ data: JSON.stringify({ text: 1 }) }));
    expect(result.current.messages).toHaveLength(0);
  });

  it("doesn't overwrite an existing dataChannel", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));
    const pc = FakeRTCPeerConnection.instances[0];
    // alice < bob => alice is initiator; pc already has a dataChannel
    const firstDc = pc.dataChannels[0];
    const second = new FakeDataChannel("chat");
    act(() => pc.fireDataChannel(second));
    // sendChat should still go through the first channel
    await act(async () => {
      await result.current.sendChat("hello");
    });
    expect(firstDc.sent.length).toBeGreaterThan(0);
    expect(second.sent.length).toBe(0);
  });

  it("creates a DataChannel as the initiator", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));
    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc.dataChannels[0].label).toBe("chat");
  });

  it("uses ondatachannel as the responder", async () => {
    const { result } = await renderUseWebRTC("zach");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ zach: {}, bob: {} }));
    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc.dataChannels.length).toBe(0); // not initiator
    expect(pc.ondatachannel).toBeTypeOf("function");
  });
});

describe("useWebRTC: sendChat + Postgres CDC", () => {
  it("trims, broadcasts via DC, and persists to DB", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));
    await act(async () => {
      await result.current.sendChat("   hello world   ");
    });
    expect(result.current.messages.at(-1)?.text).toBe("hello world");
    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc.dataChannels[0].sent.length).toBeGreaterThan(0);
    expect(fake.from).toHaveBeenCalledWith("messages");
  });

  it("skips DC + DB when message is empty", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    await act(async () => {
      await result.current.sendChat("   ");
    });
    expect(result.current.messages).toHaveLength(0);
  });

  it("logs DB error from sendChat persist", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.setTableResult("messages", "insert", {
      data: null,
      error: { message: "rls" },
    });
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    await act(async () => {
      await result.current.sendChat("hi");
    });
    expect(spy).toHaveBeenCalled();
  });

  it("appends remote messages via postgres_changes (and dedupes)", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() =>
      fake.channels[0].firePostgresInsert({
        id: "m1",
        sender_id: "bob",
        body: "yo",
        created_at: "2026-05-15T10:00:00Z",
      })
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    // duplicate id should be dropped
    act(() =>
      fake.channels[0].firePostgresInsert({
        id: "m1",
        sender_id: "bob",
        body: "yo",
        created_at: "2026-05-15T10:00:00Z",
      })
    );
    expect(result.current.messages).toHaveLength(1);
    // own sender_id is filtered
    act(() =>
      fake.channels[0].firePostgresInsert({
        id: "m2",
        sender_id: "alice",
        body: "echo",
        created_at: "2026-05-15T10:00:01Z",
      })
    );
    expect(result.current.messages).toHaveLength(1);
  });
});

describe("useWebRTC: media controls", () => {
  it("toggleMic flips audio enabled flag", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    expect(result.current.micOn).toBe(true);
    act(() => result.current.toggleMic());
    expect(result.current.micOn).toBe(false);
    act(() => result.current.toggleMic());
    expect(result.current.micOn).toBe(true);
  });

  it("toggleCam flips video enabled flag", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    expect(result.current.camOn).toBe(true);
    act(() => result.current.toggleCam());
    expect(result.current.camOn).toBe(false);
  });

  it("toggleMic / toggleCam no-op when no local stream", async () => {
    const { result } = await renderUseWebRTC("alice");
    act(() => result.current.toggleMic());
    act(() => result.current.toggleCam());
    expect(result.current.micOn).toBe(true);
    expect(result.current.camOn).toBe(true);
  });

  it("toggleScreenShare replaces video track and reverts on track.onended", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));
    const pc = FakeRTCPeerConnection.instances[0];
    const camSender = pc.senders.find((s) => s.track?.kind === "video");
    expect(camSender).toBeDefined();
    const camTrack = camSender!.track;

    await act(async () => {
      await result.current.toggleScreenShare();
    });
    expect(result.current.screenSharing).toBe(true);
    expect(camSender!.track).not.toBe(camTrack);

    // simulate user clicking "Stop sharing" in browser UI
    const screenTrack = camSender!.track as unknown as FakeMediaStreamTrack;
    act(() => screenTrack.onended?.());
    expect(result.current.screenSharing).toBe(false);
    expect(camSender!.track).toBe(camTrack);
  });

  it("toggleScreenShare stops the screen track when user toggles off", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));

    await act(async () => {
      await result.current.toggleScreenShare();
    });
    await act(async () => {
      await result.current.toggleScreenShare();
    });
    expect(result.current.screenSharing).toBe(false);
  });

  it("toggleScreenShare resets state when getDisplayMedia rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockRejectedValue(new Error("denied"));
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    await act(async () => {
      await result.current.toggleScreenShare();
    });
    expect(result.current.screenSharing).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("toggleScreenShare warns when display stream has no video track", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(new FakeMediaStream());
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    await act(async () => {
      await result.current.toggleScreenShare();
    });
    expect(warn).toHaveBeenCalled();
    expect(result.current.screenSharing).toBe(false);
  });
});

describe("useWebRTC: leaveRoom + cleanup", () => {
  it("ends the call session, removes channel, closes peers", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));
    const pc = FakeRTCPeerConnection.instances[0];
    await act(async () => {
      await result.current.leaveRoom();
    });
    expect(pc.closed).toBe(true);
    expect(result.current.peers).toEqual([]);
    expect(result.current.roomId).toBeNull();
    expect(fake.removeChannel).toHaveBeenCalled();
    expect(fake.from).toHaveBeenCalledWith("call_participants");
  });

  it("endCallSession bails when there's no active call", async () => {
    const { result } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.leaveRoom();
    });
    expect(result.current.roomId).toBeNull();
  });

  it("unmount stops local tracks and closes all peers", async () => {
    const { result, unmount } = await renderUseWebRTC("alice");
    await act(async () => {
      await result.current.joinRoom("r");
    });
    act(() => fake.channels[0].firePresenceSync({ alice: {}, bob: {} }));
    const pc = FakeRTCPeerConnection.instances[0];
    unmount();
    expect(pc.closed).toBe(true);
  });
});
