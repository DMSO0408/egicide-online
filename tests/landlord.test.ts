import { describe, expect, it } from "vitest";
import type { LandlordCard, LandlordRank, Suit } from "../shared/types";
import {
  analyzeLandlordCards,
  bidLandlord,
  buildLandlordDeck,
  canBeat,
  chooseLandlordBotCards,
  createLandlordRoom,
  playLandlordCards,
  startLandlordGame
} from "../server/landlord";

describe("landlord rules", () => {
  it("builds a 54 card deck", () => {
    const deck = buildLandlordDeck();

    expect(deck).toHaveLength(54);
    expect(new Set(deck.map((card) => card.id)).size).toBe(54);
    expect(deck.filter((card) => card.rank === "SJ" || card.rank === "BJ")).toHaveLength(2);
  });

  it("recognizes common hand types", () => {
    expect(analyzeLandlordCards([c("3", "spades")])?.type).toBe("single");
    expect(analyzeLandlordCards([c("4", "spades"), c("4", "clubs")])?.type).toBe("pair");
    expect(analyzeLandlordCards([c("5", "spades"), c("5", "clubs"), c("5", "hearts")])?.type).toBe("triple");
    expect(analyzeLandlordCards([c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades")])?.type).toBe("straight");
    expect(analyzeLandlordCards([c("10", "spades"), c("J", "spades"), c("Q", "spades"), c("K", "spades"), c("A", "spades")])?.type).toBe("straight");
    expect(analyzeLandlordCards([c("J", "spades"), c("Q", "spades"), c("K", "spades"), c("A", "spades"), c("2", "spades")])).toBeUndefined();
    expect(analyzeLandlordCards([joker("SJ"), joker("BJ")])?.type).toBe("rocket");
  });

  it("compares plays with bombs and rockets", () => {
    const pairSix = analyzeLandlordCards([c("6", "spades"), c("6", "clubs")])!;
    const pairSeven = analyzeLandlordCards([c("7", "spades"), c("7", "clubs")])!;
    const bombThree = analyzeLandlordCards([c("3", "spades"), c("3", "clubs"), c("3", "diamonds"), c("3", "hearts")])!;
    const rocket = analyzeLandlordCards([joker("SJ"), joker("BJ")])!;

    expect(canBeat(pairSeven, pairSix)).toBe(true);
    expect(canBeat(pairSix, pairSeven)).toBe(false);
    expect(canBeat(bombThree, pairSeven)).toBe(true);
    expect(canBeat(rocket, bombThree)).toBe(true);
    expect(canBeat(bombThree, rocket)).toBe(false);
  });

  it("starts a solo game with two bots and assigns landlord after bidding", () => {
    const room = createLandlordRoom("LL001", "A", "p1", "solo");
    startLandlordGame(room);

    expect(room.players).toHaveLength(3);
    expect(room.players.filter((player) => player.bot)).toHaveLength(2);
    expect(room.players.every((player) => player.hand.length === 17)).toBe(true);
    expect(room.bottomCards).toHaveLength(3);

    bidLandlord(room, room.players[room.currentPlayerIndex].id, "call");
    while (room.phase === "bidding") {
      bidLandlord(room, room.players[room.currentPlayerIndex].id, "noGrab");
    }

    expect(room.phase).toBe("playing");
    expect(room.landlordIndex).toBeDefined();
    expect(room.players[room.landlordIndex!].hand).toHaveLength(20);
  });

  it("allows a landlord to play a legal hand", () => {
    const room = createLandlordRoom("LL002", "A", "p1", "solo");
    startLandlordGame(room);
    bidLandlord(room, room.players[room.currentPlayerIndex].id, "call");
    while (room.phase === "bidding") {
      bidLandlord(room, room.players[room.currentPlayerIndex].id, "noGrab");
    }

    const landlord = room.players[room.currentPlayerIndex];
    const firstCard = landlord.hand[0];
    playLandlordCards(room, landlord.id, [firstCard.id]);

    expect(room.phase).toBe("playing");
    expect(room.lastPlay?.type).toBe("single");
    expect(landlord.hand).not.toContain(firstCard);
  });

  it("bot leads with a compact straight instead of the lowest single", () => {
    const room = createLandlordRoom("LLAI1", "A", "p1", "solo");
    startLandlordGame(room);
    const bot = room.players[1];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = 0;
    room.players[0].role = "landlord";
    bot.role = "farmer";
    room.players[2].role = "farmer";
    bot.hand = [c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades"), c("9", "spades")];
    room.lastPlay = undefined;

    const choice = chooseLandlordBotCards(room, bot.id);

    expect(analyzeLandlordCards(choice)?.type).toBe("straight");
    expect(choice.map((card) => card.rank)).toEqual(["3", "4", "5", "6", "7"]);
  });

  it("farmer bot passes when the previous play belongs to the teammate", () => {
    const room = createLandlordRoom("LLAI2", "A", "p1", "solo");
    startLandlordGame(room);
    const teammate = room.players[1];
    const bot = room.players[2];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = 0;
    room.players[0].role = "landlord";
    teammate.role = "farmer";
    bot.role = "farmer";
    bot.hand = [c("8", "spades"), c("8", "clubs"), c("Q", "spades")];
    room.lastPlay = analyzeLandlordCards([c("7", "spades"), c("7", "clubs")], teammate.id, teammate.name);

    const choice = chooseLandlordBotCards(room, bot.id);

    expect(choice).toEqual([]);
  });

  it("farmer bot uses a bomb to stop a landlord who is nearly out", () => {
    const room = createLandlordRoom("LLAI3", "A", "p1", "solo");
    startLandlordGame(room);
    const landlord = room.players[0];
    const bot = room.players[1];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = landlord.seat;
    landlord.role = "landlord";
    bot.role = "farmer";
    room.players[2].role = "farmer";
    landlord.hand = [c("4", "spades")];
    bot.hand = [c("3", "spades"), c("3", "clubs"), c("3", "diamonds"), c("3", "hearts"), c("5", "spades")];
    room.lastPlay = analyzeLandlordCards([c("2", "spades")], landlord.id, landlord.name);

    const choice = chooseLandlordBotCards(room, bot.id);

    expect(analyzeLandlordCards(choice)?.type).toBe("bomb");
  });

  it("bot plays the whole hand when it can finish", () => {
    const room = createLandlordRoom("LLAI4", "A", "p1", "solo");
    startLandlordGame(room);
    const previous = room.players[0];
    const bot = room.players[1];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = previous.seat;
    previous.role = "landlord";
    bot.role = "farmer";
    room.players[2].role = "farmer";
    bot.hand = [c("9", "spades"), c("9", "clubs")];
    room.lastPlay = analyzeLandlordCards([c("8", "spades"), c("8", "clubs")], previous.id, previous.name);

    const choice = chooseLandlordBotCards(room, bot.id);

    expect(choice.map((card) => card.rank)).toEqual(["9", "9"]);
  });
});

function c(rank: LandlordRank, suit: Suit): LandlordCard {
  return { id: `${suit}-${rank}`, rank, suit, value: valueOf(rank) };
}

function joker(rank: "SJ" | "BJ"): LandlordCard {
  return { id: `joker-${rank}`, rank, value: valueOf(rank) };
}

function valueOf(rank: LandlordRank): number {
  const values: Record<LandlordRank, number> = {
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
    "2": 16,
    SJ: 17,
    BJ: 18
  };
  return values[rank];
}
