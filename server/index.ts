import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import type { ClientToServerEvents, CreateRoomPayload, GameType, LandlordPlayerMode, ServerToClientEvents } from "../shared/types";
import {
  addPlayer,
  createRoom,
  defend,
  getPlayerView,
  markDisconnected,
  playCards,
  reconnectPlayer,
  startGame,
  type GameRoom
} from "./game";
import {
  addLandlordPlayer,
  bidLandlord,
  createLandlordRoom,
  getLandlordPlayerView,
  isLandlordBotTurn,
  markLandlordDisconnected,
  passLandlord,
  playLandlordCards,
  reconnectLandlordPlayer,
  runLandlordBotTurn,
  startLandlordGame,
  type LandlordRoom
} from "./landlord";

type AnyRoom = GameRoom | LandlordRoom;

interface SocketData {
  roomCode?: string;
  playerId?: string;
}

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(httpServer, {
  cors: { origin: true }
});

const rooms = new Map<string, AnyRoom>();
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
  socket.on("room:create", (payload, ack) => {
    try {
      const request = normalizeCreatePayload(payload);
      const roomCode = createRoomCode();
      const playerId = randomUUID();
      const room =
        request.gameType === "landlord"
          ? createLandlordRoom(roomCode, request.name, playerId, request.playerMode ?? "solo")
          : createRoom(roomCode, request.name, playerId);
      rooms.set(roomCode, room);
      attach(socket, roomCode, playerId);
      ack({ ok: true, roomCode, playerId, gameType: room.gameType });
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
      if (existingId && reconnectRoomPlayer(room, existingId)) {
        attach(socket, roomCode, existingId);
        ack({ ok: true, roomCode, playerId: existingId, gameType: room.gameType });
        broadcast(room);
        return;
      }
      const playerId = randomUUID();
      if (room.gameType === "landlord") addLandlordPlayer(room, payload.name, playerId);
      else addPlayer(room, payload.name, playerId);
      attach(socket, roomCode, playerId);
      ack({ ok: true, roomCode, playerId, gameType: room.gameType });
      broadcast(room);
    } catch (error) {
      ack({ ok: false, error: messageOf(error) });
    }
  });

  socket.on("game:start", (ack) => {
    runAction(socket, ack, (room) => {
      if (room.gameType === "landlord") startLandlordGame(room);
      else startGame(room);
    });
  });

  socket.on("action:playCards", (cardIds, ack) => {
    runAction(socket, ack, (room, playerId) => {
      if (room.gameType !== "egicide") throw new Error("当前房间不是 Egicide。");
      playCards(room, playerId, cardIds);
    });
  });

  socket.on("action:skip", (ack) => {
    runAction(socket, ack, (room, playerId) => {
      if (room.gameType !== "egicide") throw new Error("当前房间不是 Egicide。");
      playCards(room, playerId, []);
    });
  });

  socket.on("action:defend", (cardIds, ack) => {
    runAction(socket, ack, (room, playerId) => {
      if (room.gameType !== "egicide") throw new Error("当前房间不是 Egicide。");
      defend(room, playerId, cardIds);
    });
  });

  socket.on("landlord:bid", (action, ack) => {
    runAction(socket, ack, (room, playerId) => {
      if (room.gameType !== "landlord") throw new Error("当前房间不是斗地主。");
      bidLandlord(room, playerId, action);
    });
  });

  socket.on("landlord:play", (cardIds, ack) => {
    runAction(socket, ack, (room, playerId) => {
      if (room.gameType !== "landlord") throw new Error("当前房间不是斗地主。");
      playLandlordCards(room, playerId, cardIds);
    });
  });

  socket.on("landlord:pass", (ack) => {
    runAction(socket, ack, (room, playerId) => {
      if (room.gameType !== "landlord") throw new Error("当前房间不是斗地主。");
      passLandlord(room, playerId);
    });
  });

  socket.on("disconnect", () => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.gameType === "landlord") markLandlordDisconnected(room, playerId);
    else markDisconnected(room, playerId);
    broadcast(room);
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Card room server listening on http://localhost:${port}`);
});

function normalizeCreatePayload(payload: CreateRoomPayload | string): CreateRoomPayload {
  if (typeof payload === "string") return { gameType: "egicide", name: payload };
  return {
    gameType: payload.gameType,
    name: payload.name,
    playerMode: normalizePlayerMode(payload.playerMode)
  };
}

function normalizePlayerMode(mode?: LandlordPlayerMode): LandlordPlayerMode | undefined {
  return mode === "solo" || mode === "duo" || mode === "trio" ? mode : undefined;
}

function attach(socket: Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>, roomCode: string, playerId: string): void {
  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
  socket.join(roomCode);
}

function runAction(
  socket: Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>,
  ack: unknown,
  action: (room: AnyRoom, playerId: string) => void
): void {
  try {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) throw new Error("尚未加入房间。");
    const room = getRoom(roomCode);
    action(room, playerId);
    reply(ack, { ok: true });
    broadcast(room);
    scheduleBots(room);
  } catch (error) {
    reply(ack, { ok: false, error: messageOf(error) });
  }
}

function reply(ack: unknown, result: { ok: boolean; error?: string }): void {
  if (typeof ack === "function") {
    (ack as (value: { ok: boolean; error?: string }) => void)(result);
  }
}

function broadcast(room: AnyRoom): void {
  const socketIds = io.sockets.adapter.rooms.get(room.code);
  if (!socketIds) return;
  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    const playerId = socket?.data.playerId;
    if (socket && playerId) {
      socket.emit("state:update", room.gameType === "landlord" ? getLandlordPlayerView(room, playerId) : getPlayerView(room, playerId));
    }
  }
}

function scheduleBots(room: AnyRoom): void {
  if (room.gameType !== "landlord" || !isLandlordBotTurn(room) || botTimers.has(room.code)) return;
  const delayMs = 500 + Math.floor(Math.random() * 700);
  const timer = setTimeout(() => {
    botTimers.delete(room.code);
    const latest = rooms.get(room.code);
    if (!latest || latest.gameType !== "landlord" || !isLandlordBotTurn(latest)) return;
    try {
      runLandlordBotTurn(latest);
    } catch (error) {
      latest.log.unshift(`电脑行动失败：${messageOf(error)}`);
    }
    broadcast(latest);
    scheduleBots(latest);
  }, delayMs);
  botTimers.set(room.code, timer);
}

function reconnectRoomPlayer(room: AnyRoom, playerId: string): boolean {
  return room.gameType === "landlord" ? reconnectLandlordPlayer(room, playerId) : reconnectPlayer(room, playerId);
}

function getRoom(roomCode: string): AnyRoom {
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
