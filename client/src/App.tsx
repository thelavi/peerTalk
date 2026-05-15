import React, { useEffect, useRef, useState } from "react";
import { useWebRTC } from "./hooks";
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

const App: React.FC = () => {
  const {
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
  } = useWebRTC();

  const localRef = useRef<HTMLVideoElement>(null);
  const [roomInput, setRoomInput] = useState("");
  const [chatInput, setChatInput] = useState("");

  useEffect(() => {
    if (localRef.current && localStream) localRef.current.srcObject = localStream;
  }, [localStream]);

  const inCall = Boolean(roomId);

  return (
    <div className="app">
      <header className="app__header">
        <h1>peerTalk</h1>
        <div className="muted">
          you: <code>{myId.slice(0, 6) || "…"}</code>
          {roomId && (
            <>
              {" "}
              · room: <code>{roomId}</code> · {peers.length + 1} peer(s)
            </>
          )}
        </div>
      </header>

      {!inCall && (
        <section className="lobby">
          <input
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            placeholder="room id (e.g. demo)"
          />
          <button
            disabled={!roomInput.trim()}
            onClick={() => joinRoom(roomInput.trim())}
          >
            Join room
          </button>
        </section>
      )}

      {inCall && (
        <section className="call">
          <div className="grid">
            <div className="tile tile--self">
              <video ref={localRef} autoPlay playsInline muted>
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
            <div className="chat__log">
              {messages.length === 0 && (
                <p className="muted">no messages yet</p>
              )}
              {messages.map((m) => (
                <div key={m.id} className="chat__msg">
                  <strong>
                    {m.from === myId ? "you" : m.from.slice(0, 6)}
                  </strong>
                  : {m.text}
                </div>
              ))}
            </div>
            <form
              className="chat__form"
              onSubmit={(e) => {
                e.preventDefault();
                sendChat(chatInput);
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

export default App;
