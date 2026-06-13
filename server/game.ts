import type { Card, Phase, PlayerView, PublicMonster, Suit } from "../shared/types";

interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  connected: boolean;
}

export interface GameRoom {
  code: string;
  players: PlayerState[];
  phase: Phase;
  drawPile: Card[];
  discardPile: Card[];
  monsterPile: Card[];
  currentMonster?: Card;
  currentPlayerIndex: number;
  defendingPlayerIndex?: number;
  monsterDamage: number;
  shield: number;
  tableCards: Card[];
  log: string[];
}

const suits: Suit[] = ["spades", "clubs", "diamonds", "hearts"];
const suitLabel: Record<Suit, string> = {
  spades: "黑桃",
  clubs: "梅花",
  diamonds: "方块",
  hearts: "红心"
};

const rankValues: Record<Card["rank"], number> = {
  A: 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 10,
  Q: 15,
  K: 20
};

const monsterStats: Record<"J" | "Q" | "K", { health: number; attack: number }> = {
  J: { health: 20, attack: 10 },
  Q: { health: 30, attack: 15 },
  K: { health: 40, attack: 20 }
};

export function createRoom(code: string, hostName: string, hostId: string): GameRoom {
  return {
    code,
    players: [{ id: hostId, name: hostName || "玩家 1", hand: [], connected: true }],
    phase: "lobby",
    drawPile: [],
    discardPile: [],
    monsterPile: [],
    currentPlayerIndex: 0,
    monsterDamage: 0,
    shield: 0,
    tableCards: [],
    log: ["房间已创建，等待第二名玩家加入。"]
  };
}

export function addPlayer(room: GameRoom, name: string, playerId: string): void {
  if (room.players.length >= 2) throw new Error("房间已满。");
  room.players.push({ id: playerId, name: name || `玩家 ${room.players.length + 1}`, hand: [], connected: true });
  room.log.unshift(`${name || "玩家 2"} 加入了房间。`);
}

export function reconnectPlayer(room: GameRoom, playerId: string): boolean {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) return false;
  player.connected = true;
  return true;
}

export function markDisconnected(room: GameRoom, playerId: string): void {
  const player = room.players.find((item) => item.id === playerId);
  if (player) player.connected = false;
}

export function startGame(room: GameRoom): void {
  if (room.phase !== "lobby") throw new Error("游戏已经开始。");
  if (room.players.length !== 2) throw new Error("需要两名玩家才能开始。");

  const allCards = buildDeck();
  const jacks = shuffle(allCards.filter((card) => card.rank === "J").map(asMonster));
  const queens = shuffle(allCards.filter((card) => card.rank === "Q").map(asMonster));
  const kings = shuffle(allCards.filter((card) => card.rank === "K").map(asMonster));
  room.monsterPile = [...jacks, ...queens, ...kings];
  room.drawPile = shuffle(allCards.filter((card) => !["J", "Q", "K"].includes(card.rank)));
  room.discardPile = [];
  room.players.forEach((player) => {
    player.hand = drawCards(room, 7);
  });
  revealNextMonster(room);
  room.phase = "playerAction";
  room.currentPlayerIndex = 0;
  room.log.unshift("游戏开始。");
}

export function playCards(room: GameRoom, playerId: string, cardIds: string[]): void {
  assertPhase(room, "playerAction");
  assertCurrentPlayer(room, playerId);
  if (cardIds.length === 0) {
    enterDefense(room);
    return;
  }

  const player = currentPlayer(room);
  const cards = takeCards(player.hand, cardIds);
  try {
    validatePlay(cards);
  } catch (error) {
    player.hand.push(...cards);
    sortHand(player.hand);
    throw error;
  }

  room.tableCards.push(...cards);
  const total = cards.reduce((sum, card) => sum + card.value, 0);
  const activeSuits = new Set(cards.filter((card) => card.suit !== room.currentMonster?.suit).map((card) => card.suit));
  const diamondValue = cards.filter((card) => activeSuits.has("diamonds") && card.suit === "diamonds").reduce((sum, card) => sum + card.value, 0);
  const heartValue = cards.filter((card) => activeSuits.has("hearts") && card.suit === "hearts").reduce((sum, card) => sum + card.value, 0);
  const spadeValue = cards.filter((card) => activeSuits.has("spades") && card.suit === "spades").reduce((sum, card) => sum + card.value, 0);
  const clubActive = activeSuits.has("clubs");

  if (diamondValue > 0) recycleDiscard(room, diamondValue);
  if (heartValue > 0) healPlayers(room, heartValue);
  if (spadeValue > 0) room.shield += spadeValue;

  const damage = total * (clubActive ? 2 : 1);
  room.monsterDamage += damage;
  room.log.unshift(`${player.name} 打出 ${formatCards(cards)}，造成 ${damage} 点伤害。`);
  if (spadeValue > 0) room.log.unshift(`黑桃护盾增加到 ${room.shield}。`);

  const monster = getMonster(room);
  const stats = monsterStats[monster.rank as "J" | "Q" | "K"];
  if (room.monsterDamage >= stats.health) {
    defeatMonster(room, room.monsterDamage === stats.health);
  } else {
    enterDefense(room);
  }
}

export function defend(room: GameRoom, playerId: string, cardIds: string[]): void {
  assertPhase(room, "defense");
  const defender = room.players[room.defendingPlayerIndex ?? -1];
  if (!defender || defender.id !== playerId) throw new Error("现在不是你承受攻击。");

  const monster = getMonster(room);
  const attack = Math.max(0, monsterStats[monster.rank as "J" | "Q" | "K"].attack - room.shield);
  const cards = takeCards(defender.hand, cardIds);
  const total = cards.reduce((sum, card) => sum + card.value, 0);
  if (total < attack) {
    defender.hand.push(...cards);
    sortHand(defender.hand);
    throw new Error(`弃牌点数不足，需要至少 ${attack}。`);
  }

  room.discardPile.push(...cards);
  finishDefense(room);
  room.log.unshift(`${defender.name} 弃掉 ${formatCards(cards)}，承受了攻击。`);
}

export function getPlayerView(room: GameRoom, playerId: string): PlayerView {
  const self = room.players.find((player) => player.id === playerId);
  return {
    roomCode: room.code,
    selfId: playerId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      handCount: player.hand.length,
      connected: player.connected
    })),
    hand: self ? [...self.hand] : [],
    phase: room.phase,
    currentPlayerId: room.players[room.currentPlayerIndex]?.id,
    defendingPlayerId: room.defendingPlayerIndex === undefined ? undefined : room.players[room.defendingPlayerIndex]?.id,
    monster: room.currentMonster ? publicMonster(room) : undefined,
    drawCount: room.drawPile.length,
    discardCount: room.discardPile.length,
    monstersLeft: room.monsterPile.length + (room.currentMonster ? 1 : 0),
    tableCards: [...room.tableCards],
    log: room.log.slice(0, 30),
    winner: room.phase === "won"
  };
}

export function canSurvive(room: GameRoom): boolean {
  const defender = room.players[room.defendingPlayerIndex ?? room.currentPlayerIndex];
  const monster = getMonster(room);
  const attack = Math.max(0, monsterStats[monster.rank as "J" | "Q" | "K"].attack - room.shield);
  return defender.hand.reduce((sum, card) => sum + card.value, 0) >= attack;
}

function buildDeck(): Card[] {
  const ranks: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  return suits.flatMap((suit) =>
    ranks.map((rank) => ({
      id: `${suit}-${rank}`,
      suit,
      rank,
      value: rankValues[rank]
    }))
  );
}

function asMonster(card: Card): Card {
  return { ...card, monster: true, value: monsterStats[card.rank as "J" | "Q" | "K"].attack };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function drawCards(room: GameRoom, count: number): Card[] {
  return room.drawPile.splice(0, count);
}

function revealNextMonster(room: GameRoom): void {
  room.currentMonster = room.monsterPile.shift();
  room.monsterDamage = 0;
  room.shield = 0;
  room.tableCards = [];
  if (room.currentMonster) {
    const stats = monsterStats[room.currentMonster.rank as "J" | "Q" | "K"];
    room.log.unshift(`新的怪物出现：${formatCard(room.currentMonster)}，血量 ${stats.health}，攻击 ${stats.attack}。`);
  }
}

function validatePlay(cards: Card[]): void {
  if (cards.length === 1) return;
  if (cards.length === 2 && cards.some((card) => card.rank === "A")) return;
  const sameRank = cards.every((card) => card.rank === cards[0].rank);
  const total = cards.reduce((sum, card) => sum + card.value, 0);
  if (sameRank && total <= 10) return;
  throw new Error("出牌组合不合法。");
}

function recycleDiscard(room: GameRoom, count: number): void {
  const recycled = shuffle(room.discardPile).slice(0, count);
  room.discardPile = room.discardPile.filter((card) => !recycled.some((item) => item.id === card.id));
  room.drawPile.push(...recycled);
  if (recycled.length > 0) room.log.unshift(`方块后勤回收 ${recycled.length} 张牌到牌堆底。`);
}

function healPlayers(room: GameRoom, count: number): void {
  let index = room.currentPlayerIndex;
  let healed = 0;
  let misses = 0;
  while (healed < count && room.drawPile.length > 0 && misses < room.players.length) {
    const player = room.players[index];
    if (player.hand.length < 7) {
      const drawn = drawCards(room, 1);
      player.hand.push(...drawn);
      healed += drawn.length;
      misses = 0;
    } else {
      misses += 1;
    }
    index = (index + 1) % room.players.length;
  }
  room.players.forEach((player) => sortHand(player.hand));
  if (healed > 0) room.log.unshift(`红心回血补充 ${healed} 张手牌。`);
}

function defeatMonster(room: GameRoom, tamed: boolean): void {
  const monster = getMonster(room);
  const player = currentPlayer(room);
  if (tamed) {
    room.drawPile.unshift(monster);
    room.discardPile.push(...room.tableCards);
    room.log.unshift(`${player.name} 精准击败并驯服了 ${formatCard(monster)}。`);
  } else {
    room.discardPile.push(...room.tableCards, monster);
    room.log.unshift(`${player.name} 击败了 ${formatCard(monster)}。`);
  }
  if (room.monsterPile.length === 0) {
    room.phase = "won";
    room.currentMonster = undefined;
    room.tableCards = [];
    room.log.unshift("最后一个 King 被击败，挑战成功。");
    return;
  }
  revealNextMonster(room);
  room.phase = "playerAction";
}

function enterDefense(room: GameRoom): void {
  room.phase = "defense";
  room.defendingPlayerIndex = room.currentPlayerIndex;
  const defender = currentPlayer(room);
  const monster = getMonster(room);
  const attack = Math.max(0, monsterStats[monster.rank as "J" | "Q" | "K"].attack - room.shield);
  if (attack === 0) {
    finishDefense(room);
    room.log.unshift(`${defender.name} blocks the attack completely with spades.`);
    return;
  }
  if (!canSurvive(room)) {
    room.phase = "lost";
    room.log.unshift(`${defender.name} 无法承受 ${attack} 点攻击，挑战失败。`);
    return;
  }
  room.log.unshift(`${defender.name} 需要弃牌承受 ${attack} 点攻击。`);
}

function finishDefense(room: GameRoom): void {
  room.tableCards = [];
  room.phase = "playerAction";
  room.defendingPlayerIndex = undefined;
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
}

function publicMonster(room: GameRoom): PublicMonster {
  const monster = getMonster(room);
  const stats = monsterStats[monster.rank as "J" | "Q" | "K"];
  return {
    card: monster,
    health: stats.health,
    attack: stats.attack,
    damage: room.monsterDamage,
    shield: room.shield
  };
}

function takeCards(hand: Card[], ids: string[]): Card[] {
  const selected: Card[] = [];
  for (const id of ids) {
    const index = hand.findIndex((card) => card.id === id);
    if (index === -1) throw new Error("选择的牌不在手牌中。");
    selected.push(hand.splice(index, 1)[0]);
  }
  return selected;
}

function assertPhase(room: GameRoom, phase: Phase): void {
  if (room.phase !== phase) throw new Error("当前阶段不能执行这个操作。");
}

function assertCurrentPlayer(room: GameRoom, playerId: string): void {
  if (currentPlayer(room).id !== playerId) throw new Error("还没轮到你。");
}

function currentPlayer(room: GameRoom): PlayerState {
  return room.players[room.currentPlayerIndex];
}

function getMonster(room: GameRoom): Card {
  if (!room.currentMonster) throw new Error("当前没有怪物。");
  return room.currentMonster;
}

function sortHand(hand: Card[]): void {
  hand.sort((a, b) => a.value - b.value || suits.indexOf(a.suit) - suits.indexOf(b.suit));
}

function formatCards(cards: Card[]): string {
  return cards.map(formatCard).join("、");
}

function formatCard(card: Card): string {
  return `${suitLabel[card.suit]}${card.rank}`;
}
