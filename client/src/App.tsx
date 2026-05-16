import React, { useCallback, useEffect, useRef, useState } from "react";
import { useWebRTC } from "./hooks/useWebRTC";
import { useAuth } from "./hooks/useAuth";
import { useRooms } from "./hooks/useRooms";
import { AuthGate } from "./components/AuthGate";
import { CallHistory } from "./components/CallHistory";
import "./App.css";

const RemoteVideo: React.FC<{ stream: MediaStream; peerId: string }> = ({
  stream,
  peerId,
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="tile">
      <video ref={ref} autoPlay playsInline>
        <track kind="captions" />
      </video>
      <span className="tile__label">{peerId.slice(0, 6)}</span>
    </div>
  );
};

const Shell: React.FC = () => {
  const { user, signOut } = useAuth();
  const userId = user?.id ?? null;
  const {
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
  } = useWebRTC({ userId });
  const { rooms, createRoom, joinRoomMembership, refresh } = useRooms(userId);

  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);

  const attachLocal = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && localStream && el.srcObject !== localStream) {
        el.srcObject = localStream;
      }
    },
    [localStream]
  );

  // auto-scroll chat to bottom on new message
  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const inCall = Boolean(roomId);

  const handleSignOut = useCallback(async () => {
    try {
      if (roomId) await leaveRoom();
    } finally {
      await signOut();
    }
  }, [leaveRoom, roomId, signOut]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const room = await createRoom(newSlug, newName);
      await joinRoomMembership(room.id);
      await joinRoom(room.id);
      setNewSlug("");
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    }
  };

  const handleJoin = async (id: string) => {
    setError(null);
    try {
      await joinRoomMembership(id);
      await joinRoom(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "join failed");
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>peerTalk</h1>
        <div className="muted">
          <code>{user?.email}</code>
          {roomId && (
            <>
              {" · room "}
              <code>{roomId.slice(0, 8)}</code>
              {" · "}
              {peers.length + 1} peer(s)
            </>
          )}
          <button className="link" type="button" onClick={handleSignOut}>
            sign out
          </button>
        </div>
      </header>

      {!inCall && (
        <section className="lobby">
          <div>
            <h2>Create a room</h2>
            <form className="lobby__create" onSubmit={handleCreate}>
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="slug (e.g. demo)"
                required
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="display name (optional)"
              />
              <button type="submit" disabled={!newSlug.trim()}>
                Create + join
              </button>
            </form>
            {error && <p className="error">{error}</p>}
          </div>

          <div>
            <h2>Available rooms</h2>
            {rooms.length === 0 && (
              <p className="muted">no rooms yet — create one above</p>
            )}
            <ul className="rooms">
              {rooms.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <code>{r.slug}</code>
                  </div>
                  <button onClick={() => handleJoin(r.id)}>Join</button>
                </li>
              ))}
            </ul>
          </div>

          {userId && (
            <div>
              <h2>Recent calls</h2>
              <CallHistory userId={userId} />
            </div>
          )}
        </section>
      )}

      {inCall && (
        <section className="call">
          <div className="grid">
            <div className="tile tile--self">
              <video ref={attachLocal} autoPlay playsInline muted>
                <track kind="captions" />
              </video>
              <span className="tile__label">you</span>
            </div>
            {Object.entries(remoteStreams).map(([peerId, stream]) => (
              <RemoteVideo key={peerId} peerId={peerId} stream={stream} />
            ))}
          </div>

          <div className="controls">
            <button onClick={toggleMic}>{micOn ? "Mute" : "Unmute"}</button>
            <button onClick={toggleCam}>{camOn ? "Cam off" : "Cam on"}</button>
            <button onClick={toggleScreenShare}>
              {screenSharing ? "Stop share" : "Share screen"}
            </button>
            <button className="danger" onClick={leaveRoom}>
              Leave
            </button>
          </div>

          <aside className="chat">
            <h3>chat</h3>
            <div className="chat__log" ref={chatLogRef}>
              {messages.length === 0 && (
                <p className="muted">no messages yet</p>
              )}
              {messages.map((m) => (
                <div key={m.id} className="chat__msg">
                  <strong>
                    {m.from === userId ? "you" : m.from.slice(0, 6)}
                  </strong>
                  : {m.text}
                </div>
              ))}
            </div>
            <form
              className="chat__form"
              onSubmit={(e) => {
                e.preventDefault();
                void sendChat(chatInput);
                setChatInput("");
              }}
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="message peers…"
              />
              <button type="submit" disabled={!chatInput.trim()}>
                Send
              </button>
            </form>
          </aside>
        </section>
      )}
    </div>
  );
};

const App: React.FC = () => (
  <AuthGate>
    <Shell />
  </AuthGate>
);

export default App;
