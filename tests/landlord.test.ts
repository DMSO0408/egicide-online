import { describe, expect, it } from "vitest";
import type { LandlordCard, LandlordRank, Suit } from "../shared/types";
import {
  analyzeLandlordCards,
  bidLandlord,
  buildLandlordDeck,
  canBeat,
  chooseLandlordBotCards,
  createLandlordRoom,
  getLandlordPlayerView,
  passLandlord,
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

  it("tracks bidding table states and lets the caller respond after another player grabs", () => {
    const room = createLandlordRoom("LLBID", "A", "p1", "solo");
    startLandlordGame(room);

    const caller = room.players[room.currentPlayerIndex];
    bidLandlord(room, caller.id, "call");
    let view = getLandlordPlayerView(room, caller.id);
    expect(view.bid?.states).toContainEqual({ playerId: caller.id, action: "call" });

    const grabber = room.players[room.currentPlayerIndex];
    bidLandlord(room, grabber.id, "grab");
    view = getLandlordPlayerView(room, caller.id);
    expect(view.bid?.states).toContainEqual({ playerId: grabber.id, action: "grab" });

    const passer = room.players[room.currentPlayerIndex];
    bidLandlord(room, passer.id, "noGrab");

    expect(room.phase).toBe("bidding");
    expect(room.currentPlayerIndex).toBe(caller.seat);

    bidLandlord(room, caller.id, "noGrab");

    expect(room.phase).toBe("playing");
    expect(room.landlordIndex).toBe(grabber.seat);
  });

  it("lets the caller grab back after another player grabs", () => {
    const room = createLandlordRoom("LLBACK", "A", "p1", "solo");
    startLandlordGame(room);

    const caller = room.players[room.currentPlayerIndex];
    bidLandlord(room, caller.id, "call");
    const grabber = room.players[room.currentPlayerIndex];
    bidLandlord(room, grabber.id, "grab");
    const passer = room.players[room.currentPlayerIndex];
    bidLandlord(room, passer.id, "noGrab");
    bidLandlord(room, caller.id, "grab");

    expect(room.phase).toBe("playing");
    expect(room.landlordIndex).toBe(caller.seat);
  });

  it("skips players who said no call during the grab phase", () => {
    const room = createLandlordRoom("LLSKIP", "A", "p1", "solo");
    startLandlordGame(room);

    const skipped = room.players[room.currentPlayerIndex];
    bidLandlord(room, skipped.id, "noCall");
    const caller = room.players[room.currentPlayerIndex];
    bidLandlord(room, caller.id, "call");
    const eligible = room.players.find((player) => player.id !== skipped.id && player.id !== caller.id)!;

    expect(room.phase).toBe("bidding");
    expect(room.currentPlayerIndex).toBe(eligible.seat);

    bidLandlord(room, eligible.id, "noGrab");

    expect(room.phase).toBe("playing");
    expect(room.landlordIndex).toBe(caller.seat);
  });

  it("redeals and clears bidding states when nobody calls landlord", () => {
    const room = createLandlordRoom("LLNONE", "A", "p1", "solo");
    startLandlordGame(room);

    for (let i = 0; i < 3; i += 1) {
      bidLandlord(room, room.players[room.currentPlayerIndex].id, "noCall");
    }

    expect(room.phase).toBe("bidding");
    expect(room.bidState?.mode).toBe("call");
    expect(room.bidState?.actions).toEqual([]);
    expect(room.players.every((player) => player.hand.length === 17)).toBe(true);
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

  it("plays counter-clockwise during the landlord play phase", () => {
    const room = createLandlordRoom("LLDIR", "A", "p1", "solo");
    startLandlordGame(room);
    room.phase = "playing";
    room.landlordIndex = 0;
    room.players[0].role = "landlord";
    room.players[1].role = "farmer";
    room.players[2].role = "farmer";
    room.players[0].hand = [c("3", "spades"), c("10", "spades")];
    room.players[1].hand = [c("4", "spades")];
    room.players[2].hand = [c("5", "spades")];
    room.currentPlayerIndex = 0;

    playLandlordCards(room, room.players[0].id, [room.players[0].hand[0].id]);
    expect(room.currentPlayerIndex).toBe(2);

    passLandlord(room, room.players[2].id);
    expect(room.currentPlayerIndex).toBe(1);

    passLandlord(room, room.players[1].id);
    expect(room.currentPlayerIndex).toBe(0);
    expect(room.lastPlay).toBeUndefined();
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

  it("farmer bot follows a teammate's small play to shed cheap cards", () => {
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

    expect(analyzeLandlordCards(choice)?.type).toBe("pair");
    expect(choice.map((card) => card.rank)).toEqual(["8", "8"]);
  });

  it("farmer bot still yields to a teammate's expensive play when it cannot gain tempo", () => {
    const room = createLandlordRoom("LLAI2B", "A", "p1", "solo");
    startLandlordGame(room);
    const teammate = room.players[1];
    const bot = room.players[2];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = 0;
    room.players[0].role = "landlord";
    teammate.role = "farmer";
    bot.role = "farmer";
    bot.hand = [c("K", "spades"), c("K", "clubs"), c("3", "spades"), c("4", "clubs"), c("6", "diamonds"), c("8", "hearts")];
    room.lastPlay = analyzeLandlordCards([c("Q", "spades"), c("Q", "clubs")], teammate.id, teammate.name);

    const choice = chooseLandlordBotCards(room, bot.id);

    expect(choice).toEqual([]);
  });

  it("farmer bot overtakes a teammate when a run gives it fast tempo", () => {
    const room = createLandlordRoom("LLAI2C", "A", "p1", "solo");
    startLandlordGame(room);
    const teammate = room.players[1];
    const bot = room.players[2];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = 0;
    room.players[0].role = "landlord";
    teammate.role = "farmer";
    bot.role = "farmer";
    bot.hand = [c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades"), c("8", "spades"), c("K", "clubs"), c("A", "hearts")];
    room.lastPlay = analyzeLandlordCards([c("3", "clubs"), c("4", "clubs"), c("5", "clubs"), c("6", "clubs"), c("7", "clubs")], teammate.id, teammate.name);

    const choice = chooseLandlordBotCards(room, bot.id);
    const play = analyzeLandlordCards(choice);

    expect(play?.type).toBe("straight");
    expect(canBeat(play!, room.lastPlay!)).toBe(true);
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

  it("bot contests an enemy's tiny play by splitting cheap cards", () => {
    const room = createLandlordRoom("LLAI3B", "A", "p1", "solo");
    startLandlordGame(room);
    const landlord = room.players[0];
    const bot = room.players[1];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = landlord.seat;
    landlord.role = "landlord";
    bot.role = "farmer";
    room.players[2].role = "farmer";
    landlord.hand = [c("5", "spades"), c("6", "spades"), c("7", "spades"), c("8", "spades"), c("9", "spades"), c("10", "spades")];
    bot.hand = [c("4", "spades"), c("4", "clubs"), c("9", "clubs"), c("J", "diamonds"), c("K", "hearts")];
    room.lastPlay = analyzeLandlordCards([c("3", "hearts")], landlord.id, landlord.name);

    const choice = chooseLandlordBotCards(room, bot.id);
    const play = analyzeLandlordCards(choice);

    expect(play?.type).toBe("single");
    expect(canBeat(play!, room.lastPlay!)).toBe(true);
  });

  it("landlord bot treats a farmer with seven cards as dangerous", () => {
    const room = createLandlordRoom("LLAI3C", "A", "p1", "solo");
    startLandlordGame(room);
    const bot = room.players[0];
    const farmer = room.players[1];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = bot.seat;
    bot.role = "landlord";
    farmer.role = "farmer";
    room.players[2].role = "farmer";
    farmer.hand = [c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades"), c("8", "spades"), c("9", "spades")];
    bot.hand = [c("4", "clubs"), c("4", "diamonds"), c("9", "clubs"), c("J", "diamonds"), c("A", "hearts")];
    room.lastPlay = analyzeLandlordCards([c("3", "hearts")], farmer.id, farmer.name);

    const choice = chooseLandlordBotCards(room, bot.id);
    const play = analyzeLandlordCards(choice);

    expect(play?.type).toBe("single");
    expect(canBeat(play!, room.lastPlay!)).toBe(true);
  });

  it("bot preserves rocket on lead when small cards still need to be cleared", () => {
    const room = createLandlordRoom("LLAI3D", "A", "p1", "solo");
    startLandlordGame(room);
    const bot = room.players[0];
    const farmer = room.players[1];
    room.phase = "playing";
    room.currentPlayerIndex = bot.seat;
    room.landlordIndex = bot.seat;
    bot.role = "landlord";
    farmer.role = "farmer";
    room.players[2].role = "farmer";
    farmer.hand = [c("3", "spades"), c("4", "spades"), c("5", "spades"), c("6", "spades"), c("7", "spades"), c("8", "spades"), c("9", "spades")];
    bot.hand = [c("4", "clubs"), c("4", "diamonds"), c("9", "clubs"), joker("SJ"), joker("BJ")];
    room.lastPlay = undefined;

    const choice = chooseLandlordBotCards(room, bot.id);
    const play = analyzeLandlordCards(choice);

    expect(play?.type).toBe("pair");
    expect(choice.map((card) => card.rank)).toEqual(["4", "4"]);
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
