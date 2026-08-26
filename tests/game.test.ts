import { describe, expect, it } from "vitest";
import type { Card } from "../shared/types";
import { createRoom, getPlayerView, playCards, requestOpenHands, respondOpenHands, startGame } from "../server/game";

describe("game rules", () => {
  it("starts with two hidden hands and a jack monster", () => {
    const room = createReadyRoom();
    startGame(room);

    expect(room.players[0].hand).toHaveLength(7);
    expect(room.players[1].hand).toHaveLength(7);
    expect(room.currentMonster?.rank).toBe("J");
    expect(getPlayerView(room, "p1").hand).toHaveLength(7);
    expect(getPlayerView(room, "p1").teammateHand).toBeUndefined();
  });

  it("reveals both hands only after the teammate accepts the request", () => {
    const room = createReadyRoom();
    startGame(room);

    requestOpenHands(room, "p1");
    expect(getPlayerView(room, "p1").openHandsRequest).toEqual({ requesterId: "p1" });
    expect(getPlayerView(room, "p2").teammateHand).toBeUndefined();

    respondOpenHands(room, "p2", true);

    const p1View = getPlayerView(room, "p1");
    const p2View = getPlayerView(room, "p2");
    expect(p1View.handsRevealed).toBe(true);
    expect(p1View.teammateHand).toEqual(room.players[1].hand);
    expect(p2View.teammateHand).toEqual(room.players[0].hand);
  });

  it("keeps hands hidden when the teammate declines an open-hands request", () => {
    const room = createReadyRoom();
    startGame(room);

    requestOpenHands(room, "p1");
    respondOpenHands(room, "p2", false);

    expect(getPlayerView(room, "p1").handsRevealed).toBe(false);
    expect(getPlayerView(room, "p1").teammateHand).toBeUndefined();
    expect(getPlayerView(room, "p1").openHandsRequest).toBeUndefined();
  });

  it("restarts in the same room after a win or loss", () => {
    const room = createReadyRoom();
    startGame(room);
    room.phase = "lost";
    room.players[0].hand = [];
    room.players[1].hand = [];
    room.tableCards = [card("old", "spades", "3", 3)];
    room.defendingPlayerIndex = 1;

    startGame(room);

    expect(room.phase).toBe("playerAction");
    expect(room.players[0].hand).toHaveLength(7);
    expect(room.players[1].hand).toHaveLength(7);
    expect(room.tableCards).toHaveLength(0);
    expect(room.defendingPlayerIndex).toBeUndefined();

    room.phase = "won";
    room.players[0].hand = [];
    startGame(room);

    expect(room.phase).toBe("playerAction");
    expect(room.players[0].hand).toHaveLength(7);
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
