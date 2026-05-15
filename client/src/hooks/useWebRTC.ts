import { useCallback, useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";
import type { ChatMessage, RemoteStreams, SignalData } from "../types";

const SIGNALING_URL =
  process.env.REACT_APP_SIGNALING_URL ?? "http://localhost:5001";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  ...(process.env.REACT_APP_TURN_URL
    ? [
        {
          urls: process.env.REACT_APP_TURN_URL,
          username: process.env.REACT_APP_TURN_USER,
          credential: process.env.REACT_APP_TURN_CRED,
        } as RTCIceServer,
      ]
    : []),
];

type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  dataChannel?: RTCDataChannel;
};

type UseWebRTCReturn = {
  myId: string;
  roomId: string | null;
  peers: string[];
  localStream: MediaStream | null;
  remoteStreams: RemoteStreams;
  messages: ChatMessage[];
  micOn: boolean;
  camOn: boolean;
  screenSharing: boolean;
  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  toggleScreenShare: () => Promise<void>;
  sendChat: (text: string) => void;
};

export function useWebRTC(): UseWebRTCReturn {
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);

  const [myId, setMyId] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [peers, setPeers] = useState<string[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);

  // ---- helpers ----------------------------------------------------------

  const upsertPeer = useCallback((peerId: string): string[] => {
    let next: string[] = [];
    setPeers((curr) => {
      if (curr.includes(peerId)) {
        next = curr;
        return curr;
      }
      next = [...curr, peerId];
      return next;
    });
    return next;
  }, []);

  const removePeer = useCallback((peerId: string) => {
    const state = peersRef.current.get(peerId);
    if (state) {
      state.dataChannel?.close();
      state.pc.close();
      peersRef.current.delete(peerId);
    }
    setPeers((curr) => curr.filter((id) => id !== peerId));
    setRemoteStreams((curr) => {
      if (!(peerId in curr)) return curr;
      const next = { ...curr };
      delete next[peerId];
      return next;
    });
  }, []);

  const attachDataChannel = useCallback(
    (peerId: string, dc: RTCDataChannel) => {
      const state = peersRef.current.get(peerId);
      if (state) state.dataChannel = dc;
      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as { text: string; ts: number };
          setMessages((m) => [
            ...m,
            {
              id: `${peerId}-${msg.ts}`,
              from: peerId,
              text: msg.text,
              ts: msg.ts,
            },
          ]);
        } catch {
          // swallow malformed
        }
      };
    },
    []
  );

  const createPeer = useCallback(
    (peerId: string, initiator: boolean): PeerState => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const polite = (socketRef.current?.id ?? "") < peerId;

      const state: PeerState = {
        pc,
        polite,
        makingOffer: false,
        ignoreOffer: false,
      };
      peersRef.current.set(peerId, state);

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onnegotiationneeded = async () => {
        try {
          state.makingOffer = true;
          await pc.setLocalDescription();
          socketRef.current?.emit("signal", {
            to: peerId,
            data: { description: pc.localDescription },
          });
        } catch (err) {
          console.error("[onnegotiationneeded]", err);
        } finally {
          state.makingOffer = false;
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        socketRef.current?.emit("signal", {
          to: peerId,
          data: { candidate },
        });
      };

      pc.ontrack = ({ streams: [stream] }) => {
        setRemoteStreams((curr) => ({ ...curr, [peerId]: stream }));
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          removePeer(peerId);
        }
      };

      if (initiator) {
        const dc = pc.createDataChannel("chat");
        attachDataChannel(peerId, dc);
      } else {
        pc.ondatachannel = (e) => attachDataChannel(peerId, e.channel);
      }

      return state;
    },
    [attachDataChannel, removePeer]
  );

  const handleDescription = useCallback(
    async (
      from: string,
      state: PeerState,
      description: RTCSessionDescriptionInit
    ) => {
      const { pc } = state;
      const offerCollision =
        description.type === "offer" &&
        (state.makingOffer || pc.signalingState !== "stable");
      state.ignoreOffer = !state.polite && offerCollision;
      if (state.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        socketRef.current?.emit("signal", {
          to: from,
          data: { description: pc.localDescription },
        });
      }
    },
    []
  );

  const handleCandidate = useCallback(
    async (state: PeerState, candidate: RTCIceCandidateInit | null) => {
      try {
        if (candidate) await state.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!state.ignoreOffer) throw err;
      }
    },
    []
  );

  const handleSignal = useCallback(
    async (from: string, data: SignalData) => {
      const state = createPeer(from, false);
      try {
        if ("description" in data && data.description) {
          await handleDescription(from, state, data.description);
        } else if ("candidate" in data) {
          await handleCandidate(state, data.candidate);
        }
      } catch (err) {
        console.error("[handleSignal]", err);
      }
    },
    [createPeer, handleDescription, handleCandidate]
  );

  // ---- socket lifecycle -------------------------------------------------

  useEffect(() => {
    const socket = io(SIGNALING_URL, { autoConnect: true });
    socketRef.current = socket;

    socket.on("connect", () => setMyId(socket.id ?? ""));

    socket.on("room-peers", ({ peers: existing }: { peers: string[] }) => {
      existing.forEach((peerId) => {
        upsertPeer(peerId);
        createPeer(peerId, true);
      });
    });

    socket.on("peer-joined", ({ peerId }: { peerId: string }) => {
      upsertPeer(peerId);
    });

    socket.on("peer-left", ({ peerId }: { peerId: string }) => {
      removePeer(peerId);
    });

    socket.on(
      "signal",
      ({ from, data }: { from: string; data: SignalData }) => {
        handleSignal(from, data);
      }
    );

    return () => {
      peersRef.current.forEach((state) => state.pc.close());
      peersRef.current.clear();
      socket.disconnect();
    };
  }, [createPeer, handleSignal, removePeer, upsertPeer]);

  // ---- actions ----------------------------------------------------------

  const ensureLocalStream = useCallback(async (): Promise<MediaStream> => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localStreamRef.current = stream;
    camTrackRef.current = stream.getVideoTracks()[0] ?? null;
    setLocalStream(stream);
    return stream;
  }, []);

  const joinRoom = useCallback(
    async (room: string) => {
      await ensureLocalStream();
      setRoomId(room);
      socketRef.current?.emit("join-room", { roomId: room });
    },
    [ensureLocalStream]
  );

  const leaveRoom = useCallback(() => {
    if (roomId) socketRef.current?.emit("leave-room", { roomId });
    peersRef.current.forEach((state) => state.pc.close());
    peersRef.current.clear();
    setPeers([]);
    setRemoteStreams({});
    setRoomId(null);
  }, [roomId]);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const toggleCam = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  }, []);

  const replaceVideoTrackOnPeers = useCallback(
    (newTrack: MediaStreamTrack) => {
      peersRef.current.forEach((state) => {
        const sender = state.pc
          .getSenders()
          .find((s) => s.track?.kind === "video");
        sender?.replaceTrack(newTrack);
      });
    },
    []
  );

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      const camTrack = camTrackRef.current;
      if (camTrack) replaceVideoTrackOnPeers(camTrack);
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      setScreenSharing(false);
      return;
    }
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const track = display.getVideoTracks()[0];
    screenTrackRef.current = track;
    replaceVideoTrackOnPeers(track);
    track.onended = () => {
      const camTrack = camTrackRef.current;
      if (camTrack) replaceVideoTrackOnPeers(camTrack);
      screenTrackRef.current = null;
      setScreenSharing(false);
    };
    setScreenSharing(true);
  }, [replaceVideoTrackOnPeers, screenSharing]);

  const sendChat = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const ts = Date.now();
      const payload = JSON.stringify({ text, ts });
      peersRef.current.forEach((state) => {
        if (state.dataChannel?.readyState === "open") {
          state.dataChannel.send(payload);
        }
      });
      setMessages((m) => [
        ...m,
        { id: `${myId}-${ts}`, from: myId, text, ts },
      ]);
    },
    [myId]
  );

  return {
    myId,
    roomId,
    peers,
    localStream,
    remoteStreams,
    messages,
    micOn,
    camOn,
    screenSharing,
    joinRoom,
    leaveRoom,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    sendChat,
  };
}
