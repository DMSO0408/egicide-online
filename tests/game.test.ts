import { describe, expect, it } from "vitest";
import type { Card } from "../shared/types";
import { createRoom, getPlayerView, playCards, startGame } from "../server/game";

describe("game rules", () => {
  it("starts with two hidden hands and a jack monster", () => {
    const room = createReadyRoom();
    startGame(room);

    expect(room.players[0].hand).toHaveLength(7);
    expect(room.players[1].hand).toHaveLength(7);
    expect(room.currentMonster?.rank).toBe("J");
    expect(getPlayerView(room, "p1").hand).toHaveLength(7);
  });

  it("rejects invalid card combinations", () => {
    const room = createReadyRoom();
    startGame(room);
    room.players[0].hand = [card("x1", "hearts", "7", 7), card("x2", "clubs", "8", 8)];

    expect(() => playCards(room, "p1", ["x1", "x2"])).toThrow("出牌组合不合法");
    expect(room.players[0].hand).toHaveLength(2);
  });

  it("does not trigger same-suit club double damage", () => {
    const room = createReadyRoom();
    startGame(room);
    room.currentMonster = card("m", "clubs", "J", 10, true);
    room.players[0].hand = [card("c5", "clubs", "5", 5)];

    playCards(room, "p1", ["c5"]);

    expect(room.monsterDamage).toBe(5);
  });

  it("tames a monster on exact damage", () => {
    const room = createReadyRoom();
    startGame(room);
    room.currentMonster = card("m", "hearts", "J", 10, true);
    room.monsterPile = [];
    room.players[0].hand = [card("c10", "clubs", "10", 10)];

    playCards(room, "p1", ["c10"]);

    expect(room.drawPile[0].id).toBe("m");
    expect(room.phase).toBe("won");
  });

  it("does not require discards when spades reduce attack to zero", () => {
    const room = createReadyRoom();
    startGame(room);
    room.currentMonster = card("m", "hearts", "J", 10, true);
    room.players[0].hand = [card("s10", "spades", "10", 10)];

    playCards(room, "p1", ["s10"]);

    expect(room.phase).toBe("playerAction");
    expect(room.defendingPlayerIndex).toBeUndefined();
    expect(room.currentPlayerIndex).toBe(1);
    expect(room.players[0].hand).toHaveLength(0);
  });

  it("loses when a defender cannot cover the attack", () => {
    const room = createReadyRoom();
    startGame(room);
    room.currentMonster = card("m", "hearts", "J", 10, true);
    room.players[0].hand = [card("s2", "spades", "2", 2)];

    playCards(room, "p1", []);

    expect(room.phase).toBe("lost");
  });
});

function createReadyRoom() {
  const room = createRoom("ABC123", "A", "p1");
  room.players.push({ id: "p2", name: "B", hand: [], connected: true });
  return room;
}

function card(id: string, suit: Card["suit"], rank: Card["rank"], value: number, monster = false): Card {
  return { id, suit, rank, value, monster };
}
