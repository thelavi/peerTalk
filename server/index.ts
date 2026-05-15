import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";

const PORT = Number(process.env.PORT ?? 5001);
const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(",") ?? "*";

type SignalPayload = {
  to: string;
  data: unknown;
};

type JoinPayload = {
  roomId: string;
};

const rooms = new Map<string, Set<string>>();

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", rooms: rooms.size });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN },
});

function getRoomPeers(roomId: string, exclude?: string): string[] {
  const peers = rooms.get(roomId);
  if (!peers) return [];
  return [...peers].filter((id) => id !== exclude);
}

function removeFromAllRooms(socketId: string): string[] {
  const affected: string[] = [];
  for (const [roomId, members] of rooms) {
    if (members.delete(socketId)) {
      affected.push(roomId);
      if (members.size === 0) rooms.delete(roomId);
    }
  }
  return affected;
}

io.on("connection", (socket: Socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("join-room", ({ roomId }: JoinPayload) => {
    if (!roomId) return;
    socket.join(roomId);
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId)!.add(socket.id);

    const peers = getRoomPeers(roomId, socket.id);
    socket.emit("room-peers", { roomId, peers });
    socket.to(roomId).emit("peer-joined", { peerId: socket.id });
    console.log(`[join] ${socket.id} -> ${roomId} (${peers.length + 1} total)`);
  });

  socket.on("leave-room", ({ roomId }: JoinPayload) => {
    socket.leave(roomId);
    const members = rooms.get(roomId);
    if (members) {
      members.delete(socket.id);
      if (members.size === 0) rooms.delete(roomId);
    }
    socket.to(roomId).emit("peer-left", { peerId: socket.id });
  });

  socket.on("signal", ({ to, data }: SignalPayload) => {
    if (!to) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    const affected = removeFromAllRooms(socket.id);
    for (const roomId of affected) {
      socket.to(roomId).emit("peer-left", { peerId: socket.id });
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`peerTalk signaling on http://localhost:${PORT}`);
});
