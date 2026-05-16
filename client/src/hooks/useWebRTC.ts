import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type {
  ChatMessage,
  RemoteStreams,
  SignalData,
  SignalPayload,
} from "../types";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  ...(import.meta.env.VITE_TURN_URL
    ? [
        {
          urls: import.meta.env.VITE_TURN_URL,
          username: import.meta.env.VITE_TURN_USER,
          credential: import.meta.env.VITE_TURN_CRED,
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

type UseWebRTCArgs = {
  userId: string | null;
};

type UseWebRTCReturn = {
  roomId: string | null;
  peers: string[];
  localStream: MediaStream | null;
  remoteStreams: RemoteStreams;
  messages: ChatMessage[];
  micOn: boolean;
  camOn: boolean;
  screenSharing: boolean;
  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  toggleScreenShare: () => Promise<void>;
  sendChat: (text: string) => Promise<void>;
};

export function useWebRTC({ userId }: UseWebRTCArgs): UseWebRTCReturn {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);
  const callIdRef = useRef<string | null>(null);
  const callJoinedAtRef = useRef<number>(0);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [peers, setPeers] = useState<string[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);

  // ---- helpers ----------------------------------------------------------

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
          // ignore malformed
        }
      };
    },
    []
  );

  const sendSignal = useCallback((to: string, data: SignalData) => {
    if (!channelRef.current || !userId) return;
    const payload: SignalPayload = { to, from: userId, data };
    channelRef.current.send({
      type: "broadcast",
      event: "signal",
      payload,
    });
  }, [userId]);

  const createPeer = useCallback(
    (peerId: string, initiator: boolean): PeerState => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      if (!userId) throw new Error("createPeer: userId required");

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const polite = userId < peerId;

      const state: PeerState = {
        pc,
        polite,
        makingOffer: false,
        ignoreOffer: false,
      };
      peersRef.current.set(peerId, state);
      setPeers((curr) => (curr.includes(peerId) ? curr : [...curr, peerId]));

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onnegotiationneeded = async () => {
        try {
          state.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            sendSignal(peerId, { description: pc.localDescription });
          }
        } catch (err) {
          console.error("[onnegotiationneeded]", err);
        } finally {
          state.makingOffer = false;
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        sendSignal(peerId, { candidate });
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
    [attachDataChannel, removePeer, sendSignal, userId]
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
        if (pc.localDescription) {
          sendSignal(from, { description: pc.localDescription });
        }
      }
    },
    [sendSignal]
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

  // ---- media helpers ----------------------------------------------------

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

  // ---- chat persistence -------------------------------------------------

  const loadChatHistory = useCallback(async (room: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("room_id", room)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) {
      console.error("[loadChatHistory]", error);
      return;
    }
    setMessages(
      data.map((row) => ({
        id: row.id,
        from: row.sender_id,
        text: row.body,
        ts: new Date(row.created_at).getTime(),
        fromDB: true,
      }))
    );
  }, []);

  // ---- call history -----------------------------------------------------

  const startCallSession = useCallback(
    async (room: string) => {
      if (!userId) return;
      const { data, error } = await supabase
        .from("call_sessions")
        .insert({ room_id: room, initiator_id: userId })
        .select("id")
        .single();
      if (error) {
        console.error("[startCallSession]", error);
        return;
      }
      callIdRef.current = data.id;
      callJoinedAtRef.current = Date.now();
      await supabase
        .from("call_participants")
        .insert({ call_id: data.id, user_id: userId });
    },
    [userId]
  );

  const endCallSession = useCallback(async () => {
    if (!callIdRef.current || !userId) return;
    const callId = callIdRef.current;
    const durationSeconds = Math.round(
      (Date.now() - callJoinedAtRef.current) / 1000
    );
    await supabase
      .from("call_participants")
      .update({ left_at: new Date().toISOString(), duration_seconds: durationSeconds })
      .eq("call_id", callId)
      .eq("user_id", userId);
    await supabase
      .from("call_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", callId)
      .is("ended_at", null);
    callIdRef.current = null;
  }, [userId]);

  // ---- room lifecycle ---------------------------------------------------

  const joinRoom = useCallback(
    async (room: string) => {
      if (!userId) throw new Error("not authenticated");
      await ensureLocalStream();
      await loadChatHistory(room);
      await startCallSession(room);

      const topic = `room:${room}`;
      // Defensive: kill any stale channel for this topic (StrictMode / re-join races).
      for (const existing of supabase.getChannels()) {
        if (existing.topic === `realtime:${topic}` || existing.topic === topic) {
          await supabase.removeChannel(existing);
        }
      }

      const channel = supabase.channel(topic, {
        config: { presence: { key: userId } },
      });
      channelRef.current = channel;

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const present = Object.keys(state).filter((id) => id !== userId);
        present.forEach((peerId) => {
          if (!peersRef.current.has(peerId)) {
            createPeer(peerId, userId < peerId);
          }
        });
        peersRef.current.forEach((_, peerId) => {
          if (!present.includes(peerId)) removePeer(peerId);
        });
      });

      channel.on("broadcast", { event: "signal" }, ({ payload }) => {
        const sig = payload as SignalPayload;
        if (sig.to !== userId) return;
        handleSignal(sig.from, sig.data);
      });

      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${room}`,
        },
        (change) => {
          const row = change.new as {
            id: string;
            sender_id: string;
            body: string;
            created_at: string;
          };
          if (row.sender_id === userId) return;
          setMessages((curr) => {
            if (curr.some((m) => m.id === row.id)) return curr;
            return [
              ...curr,
              {
                id: row.id,
                from: row.sender_id,
                text: row.body,
                ts: new Date(row.created_at).getTime(),
                fromDB: true,
              },
            ];
          });
        }
      );

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ online_at: new Date().toISOString() });
        }
      });

      setRoomId(room);
    },
    [
      createPeer,
      ensureLocalStream,
      handleSignal,
      loadChatHistory,
      removePeer,
      startCallSession,
      userId,
    ]
  );

  const leaveRoom = useCallback(async () => {
    await endCallSession();
    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    peersRef.current.forEach((state) => state.pc.close());
    peersRef.current.clear();
    setPeers([]);
    setRemoteStreams({});
    setMessages([]);
    setRoomId(null);
  }, [endCallSession]);

  useEffect(() => {
    return () => {
      void endCallSession();
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
      peersRef.current.forEach((s) => s.pc.close());
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [endCallSession]);

  // ---- media controls ---------------------------------------------------

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

  const replaceVideoTrackOnPeers = useCallback((newTrack: MediaStreamTrack) => {
    peersRef.current.forEach((state) => {
      const sender = state.pc
        .getSenders()
        .find((s) => s.track?.kind === "video");
      sender?.replaceTrack(newTrack);
    });
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      const camTrack = camTrackRef.current;
      if (camTrack) replaceVideoTrackOnPeers(camTrack);
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      setScreenSharing(false);
      return;
    }
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
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

  // ---- chat send (DC fast path + DB durable) ----------------------------

  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !userId || !roomId) return;
      const ts = Date.now();
      const tempId = `${userId}-${ts}`;

      // 1. optimistic local
      setMessages((m) => [...m, { id: tempId, from: userId, text: trimmed, ts }]);

      // 2. DataChannel push to online peers
      const dcPayload = JSON.stringify({ text: trimmed, ts });
      peersRef.current.forEach((state) => {
        if (state.dataChannel?.readyState === "open") {
          state.dataChannel.send(dcPayload);
        }
      });

      // 3. DB persist (also triggers postgres_changes for offline peers)
      const { error } = await supabase
        .from("messages")
        .insert({ room_id: roomId, sender_id: userId, body: trimmed });
      if (error) console.error("[sendChat persist]", error);
    },
    [roomId, userId]
  );

  return {
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
