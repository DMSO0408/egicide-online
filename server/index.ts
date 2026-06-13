import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types";
import { addPlayer, createRoom, defend, getPlayerView, markDisconnected, playCards, reconnectPlayer, startGame, type GameRoom } from "./game";

interface SocketData {
  roomCode?: string;
  playerId?: string;
}

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(httpServer, {
  cors: { origin: true }
});

const rooms = new Map<string, GameRoom>();
const port = Number(process.env.PORT ?? 3000);

const clientDist = path.resolve(process.cwd(), "dist/client");
app.get("/healthz", (_request, response) => {
  response.status(200).send("ok");
});
app.use(express.static(clientDist));
app.use((_request, response) => {
  response.sendFile(path.join(clientDist, "index.html"));
});

io.on("connection", (socket) => {
  socket.on("room:create", (name, ack) => {
    try {
      const roomCode = createRoomCode();
      const playerId = randomUUID();
      const room = createRoom(roomCode, name, playerId);
      rooms.set(roomCode, room);
      attach(socket, roomCode, playerId);
      ack({ ok: true, roomCode, playerId });
      broadcast(room);
    } catch (error) {
      ack({ ok: false, error: messageOf(error) });
    }
  });

  socket.on("room:join", (payload, ack) => {
    try {
      const roomCode = payload.roomCode.trim().toUpperCase();
      const room = getRoom(roomCode);
      const existingId = payload.playerId;
      if (existingId && reconnectPlayer(room, existingId)) {
        attach(socket, roomCode, existingId);
        ack({ ok: true, roomCode, playerId: existingId });
        broadcast(room);
        return;
      }
      const playerId = randomUUID();
      addPlayer(room, payload.name, playerId);
      attach(socket, roomCode, playerId);
      ack({ ok: true, roomCode, playerId });
      broadcast(room);
    } catch (error) {
      ack({ ok: false, error: messageOf(error) });
    }
  });

  socket.on("game:start", (ack) => {
    runAction(socket, ack, (room) => startGame(room));
  });

  socket.on("action:playCards", (cardIds, ack) => {
    runAction(socket, ack, (room, playerId) => playCards(room, playerId, cardIds));
  });

  socket.on("action:skip", (ack) => {
    runAction(socket, ack, (room, playerId) => playCards(room, playerId, []));
  });

  socket.on("action:defend", (cardIds, ack) => {
    runAction(socket, ack, (room, playerId) => defend(room, playerId, cardIds));
  });

  socket.on("disconnect", () => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    markDisconnected(room, playerId);
    broadcast(room);
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Egicide server listening on http://localhost:${port}`);
});

function attach(socket: Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>, roomCode: string, playerId: string): void {
  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
  socket.join(roomCode);
}

function runAction(
  socket: Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>,
  ack: unknown,
  action: (room: GameRoom, playerId: string) => void
): void {
  try {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) throw new Error("尚未加入房间。");
    const room = getRoom(roomCode);
    action(room, playerId);
    reply(ack, { ok: true });
    broadcast(room);
  } catch (error) {
    reply(ack, { ok: false, error: messageOf(error) });
  }
}

function reply(ack: unknown, result: { ok: boolean; error?: string }): void {
  if (typeof ack === "function") {
    (ack as (value: { ok: boolean; error?: string }) => void)(result);
  }
}

function broadcast(room: GameRoom): void {
  const socketIds = io.sockets.adapter.rooms.get(room.code);
  if (!socketIds) return;
  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    const playerId = socket?.data.playerId;
    if (socket && playerId) {
      socket.emit("state:update", getPlayerView(room, playerId));
    }
  }
}

function getRoom(roomCode: string): GameRoom {
  const room = rooms.get(roomCode);
  if (!room) throw new Error("找不到这个房间。");
  return room;
}

function createRoomCode(): string {
  let code = "";
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误。";
}
