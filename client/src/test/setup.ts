import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// ---- WebRTC + media globals -------------------------------------------------

class FakeMediaStreamTrack {
  kind: string;
  enabled = true;
  readyState: "live" | "ended" = "live";
  onended: (() => void) | null = null;
  constructor(kind: string) {
    this.kind = kind;
  }
  stop() {
    this.readyState = "ended";
    this.onended?.();
  }
}

class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[];
  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return [...this.tracks];
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

class FakeRTCSender {
  track: FakeMediaStreamTrack | null;
  constructor(track: FakeMediaStreamTrack | null) {
    this.track = track;
  }
  async replaceTrack(t: FakeMediaStreamTrack | null) {
    this.track = t;
  }
}

class FakeDataChannel {
  label: string;
  readyState: "connecting" | "open" | "closed" = "open";
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  constructor(label: string) {
    this.label = label;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = "closed";
  }
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];
  iceServers: RTCIceServer[];
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  senders: FakeRTCSender[] = [];
  dataChannels: FakeDataChannel[] = [];
  closed = false;
  onnegotiationneeded: ((this: FakeRTCPeerConnection) => void) | null = null;
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null =
    null;
  ontrack: ((e: { streams: FakeMediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: FakeDataChannel }) => void) | null = null;

  constructor(cfg?: RTCConfiguration) {
    this.iceServers = cfg?.iceServers ?? [];
    FakeRTCPeerConnection.instances.push(this);
  }
  addTrack(track: FakeMediaStreamTrack) {
    const sender = new FakeRTCSender(track);
    this.senders.push(sender);
    return sender;
  }
  getSenders() {
    return this.senders;
  }
  createDataChannel(label: string) {
    const dc = new FakeDataChannel(label);
    this.dataChannels.push(dc);
    return dc;
  }
  async setLocalDescription(desc?: RTCSessionDescriptionInit) {
    this.localDescription = desc ?? { type: "offer", sdp: "fake-local-sdp" };
  }
  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remoteDescription = desc;
  }
  async addIceCandidate(_c: RTCIceCandidateInit) {
    // no-op
  }
  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
  // helpers for tests
  fireConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  fireTrack(stream: FakeMediaStream) {
    this.ontrack?.({ streams: [stream] });
  }
  fireDataChannel(dc: FakeDataChannel) {
    this.ondatachannel?.({ channel: dc });
  }
  fireIce(candidate: RTCIceCandidate | null) {
    this.onicecandidate?.({ candidate });
  }
}

class FakeRTCIceCandidate {
  candidate: string;
  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate ?? "";
  }
  toJSON() {
    return { candidate: this.candidate };
  }
}

beforeEach(() => {
  FakeRTCPeerConnection.instances = [];

  // env stubs (Vitest hoists vi.stubEnv; do it here for explicitness)
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");

  // media + WebRTC globals
  Object.defineProperty(globalThis, "RTCPeerConnection", {
    configurable: true,
    writable: true,
    value: FakeRTCPeerConnection,
  });
  Object.defineProperty(globalThis, "RTCIceCandidate", {
    configurable: true,
    writable: true,
    value: FakeRTCIceCandidate,
  });
  Object.defineProperty(globalThis, "RTCSessionDescription", {
    configurable: true,
    writable: true,
    value: function (init: RTCSessionDescriptionInit) {
      return init;
    },
  });

  const fakeStream = new FakeMediaStream([
    new FakeMediaStreamTrack("audio"),
    new FakeMediaStreamTrack("video"),
  ]);
  const fakeDisplayStream = new FakeMediaStream([
    new FakeMediaStreamTrack("video"),
  ]);

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
      getDisplayMedia: vi.fn().mockResolvedValue(fakeDisplayStream),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

export { FakeMediaStream, FakeMediaStreamTrack, FakeRTCPeerConnection, FakeDataChannel };
