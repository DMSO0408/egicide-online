import type {
  LandlordBidAction,
  LandlordCard,
  LandlordPhase,
  LandlordPlay,
  LandlordPlayType,
  LandlordPlayerMode,
  LandlordPlayerView,
  LandlordPublicPlayer,
  LandlordRank,
  LandlordRole,
  Suit
} from "../shared/types";

interface LandlordPlayerState {
  id: string;
  name: string;
  seat: number;
  hand: LandlordCard[];
  connected: boolean;
  bot: boolean;
  role?: LandlordRole;
}

interface BidState {
  mode: "call" | "grab";
  currentIndex: number;
  starterIndex: number;
  callPassCount: number;
  calledByIndex?: number;
  candidateIndex?: number;
  grabQueue: number[];
}

export interface LandlordRoom {
  gameType: "landlord";
  code: string;
  playerMode: LandlordPlayerMode;
  requiredHumans: number;
  players: LandlordPlayerState[];
  phase: LandlordPhase;
  deck: LandlordCard[];
  bottomCards: LandlordCard[];
  currentPlayerIndex: number;
  landlordIndex?: number;
  bidState?: BidState;
  lastPlay?: LandlordPlay;
  passCount: number;
  winner?: "landlord" | "farmers";
  log: string[];
}

const suits: Suit[] = ["spades", "clubs", "diamonds", "hearts"];
const suitLabel: Record<Suit, string> = {
  spades: "黑桃",
  clubs: "梅花",
  diamonds: "方块",
  hearts: "红心"
};

const rankValues: Record<LandlordRank, number> = {
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

const modeHumans: Record<LandlordPlayerMode, number> = {
  solo: 1,
  duo: 2,
  trio: 3
};

export function createLandlordRoom(code: string, hostName: string, hostId: string, playerMode: LandlordPlayerMode): LandlordRoom {
  return {
    gameType: "landlord",
    code,
    playerMode,
    requiredHumans: modeHumans[playerMode],
    players: [createPlayer(hostId, hostName || "玩家 1", 0, false)],
    phase: "lobby",
    deck: [],
    bottomCards: [],
    currentPlayerIndex: 0,
    passCount: 0,
    log: [`斗地主房间已创建，模式：${modeLabel(playerMode)}。`]
  };
}

export function addLandlordPlayer(room: LandlordRoom, name: string, playerId: string): void {
  if (room.phase !== "lobby") throw new Error("游戏已经开始，不能加入。");
  if (humanCount(room) >= room.requiredHumans) throw new Error("真人座位已满。");
  const seat = room.players.length;
  room.players.push(createPlayer(playerId, name || `玩家 ${seat + 1}`, seat, false));
  room.log.unshift(`${name || `玩家 ${seat + 1}`} 加入了斗地主房间。`);
}

export function reconnectLandlordPlayer(room: LandlordRoom, playerId: string): boolean {
  const player = room.players.find((item) => item.id === playerId && !item.bot);
  if (!player) return false;
  player.connected = true;
  return true;
}

export function markLandlordDisconnected(room: LandlordRoom, playerId: string): void {
  const player = room.players.find((item) => item.id === playerId && !item.bot);
  if (player) player.connected = false;
}

export function startLandlordGame(room: LandlordRoom): void {
  if (room.phase !== "lobby") throw new Error("游戏已经开始。");
  if (humanCount(room) < room.requiredHumans) throw new Error(`需要 ${room.requiredHumans} 名真人玩家才能开始。`);
  fillBots(room);
  dealForBidding(room, "游戏开始，开始叫地主。");
}

export function bidLandlord(room: LandlordRoom, playerId: string, action: LandlordBidAction): void {
  if (room.phase !== "bidding" || !room.bidState) throw new Error("当前不是叫地主阶段。");
  const bidder = room.players[room.bidState.currentIndex];
  if (!bidder || bidder.id !== playerId) throw new Error("还没轮到你叫地主。");

  if (room.bidState.mode === "call") {
    if (action === "call") {
      room.bidState.calledByIndex = room.bidState.currentIndex;
      room.bidState.candidateIndex = room.bidState.currentIndex;
      room.bidState.mode = "grab";
      room.bidState.grabQueue = nextIndexes(room.bidState.currentIndex, 2);
      room.bidState.currentIndex = room.bidState.grabQueue.shift() ?? room.bidState.currentIndex;
      room.currentPlayerIndex = room.bidState.currentIndex;
      room.log.unshift(`${bidder.name} 叫地主。`);
      return;
    }
    if (action !== "noCall") throw new Error("当前只能叫地主或不叫。");
    room.bidState.callPassCount += 1;
    room.log.unshift(`${bidder.name} 不叫。`);
    if (room.bidState.callPassCount >= 3) {
      dealForBidding(room, "无人叫地主，重新发牌。");
      return;
    }
    room.bidState.currentIndex = (room.bidState.currentIndex + 1) % 3;
    room.currentPlayerIndex = room.bidState.currentIndex;
    return;
  }

  if (action === "grab") {
    room.bidState.candidateIndex = room.bidState.currentIndex;
    room.log.unshift(`${bidder.name} 抢地主。`);
  } else if (action === "noGrab") {
    room.log.unshift(`${bidder.name} 不抢。`);
  } else {
    throw new Error("当前只能抢地主或不抢。");
  }

  const next = room.bidState.grabQueue.shift();
  if (next === undefined) {
    assignLandlord(room, room.bidState.candidateIndex ?? room.bidState.calledByIndex ?? room.bidState.currentIndex);
  } else {
    room.bidState.currentIndex = next;
    room.currentPlayerIndex = next;
  }
}

export function playLandlordCards(room: LandlordRoom, playerId: string, cardIds: string[]): void {
  if (room.phase !== "playing") throw new Error("当前不是出牌阶段。");
  const player = currentPlayer(room);
  if (player.id !== playerId) throw new Error("还没轮到你出牌。");
  if (cardIds.length === 0) throw new Error("请选择要出的牌。");

  const cards = takeCards(player.hand, cardIds);
  const play = analyzeLandlordCards(cards, player.id, player.name);
  if (!play) {
    player.hand.push(...cards);
    sortLandlordHand(player.hand);
    throw new Error("牌型不合法。");
  }
  if (room.lastPlay && room.lastPlay.playerId !== player.id && !canBeat(play, room.lastPlay)) {
    player.hand.push(...cards);
    sortLandlordHand(player.hand);
    throw new Error("这手牌压不过上一手。");
  }

  room.lastPlay = play;
  room.passCount = 0;
  room.log.unshift(`${player.name} 打出 ${formatLandlordCards(cards)}。`);
  if (player.hand.length === 0) {
    room.phase = "finished";
    room.winner = player.role === "landlord" ? "landlord" : "farmers";
    room.currentPlayerIndex = player.seat;
    room.log.unshift(room.winner === "landlord" ? "地主获胜。" : "农民获胜。");
    return;
  }
  room.currentPlayerIndex = nextIndex(room.currentPlayerIndex);
}

export function passLandlord(room: LandlordRoom, playerId: string): void {
  if (room.phase !== "playing") throw new Error("当前不是出牌阶段。");
  const player = currentPlayer(room);
  if (player.id !== playerId) throw new Error("还没轮到你。");
  if (!room.lastPlay || room.lastPlay.playerId === player.id) throw new Error("这一轮你必须出牌。");

  room.passCount += 1;
  room.log.unshift(`${player.name} 不出。`);
  if (room.passCount >= 2) {
    const leadIndex = room.players.findIndex((item) => item.id === room.lastPlay?.playerId);
    room.currentPlayerIndex = leadIndex;
    room.lastPlay = undefined;
    room.passCount = 0;
    room.log.unshift(`${room.players[leadIndex].name} 获得新一轮出牌权。`);
    return;
  }
  room.currentPlayerIndex = nextIndex(room.currentPlayerIndex);
}

export function getLandlordPlayerView(room: LandlordRoom, playerId: string): LandlordPlayerView {
  const self = room.players.find((player) => player.id === playerId);
  return {
    gameType: "landlord",
    roomCode: room.code,
    selfId: playerId,
    playerMode: room.playerMode,
    requiredHumans: room.requiredHumans,
    players: room.players.map(publicPlayer),
    hand: self ? [...self.hand] : [],
    phase: room.phase,
    currentPlayerId: room.players[room.currentPlayerIndex]?.id,
    landlordId: room.landlordIndex === undefined ? undefined : room.players[room.landlordIndex]?.id,
    bottomCards: room.phase === "lobby" || room.phase === "bidding" ? [] : [...room.bottomCards],
    lastPlay: room.lastPlay,
    passCount: room.passCount,
    bid: room.bidState
      ? {
          currentPlayerId: room.players[room.bidState.currentIndex]?.id,
          calledById: room.bidState.calledByIndex === undefined ? undefined : room.players[room.bidState.calledByIndex]?.id,
          candidateId: room.bidState.candidateIndex === undefined ? undefined : room.players[room.bidState.candidateIndex]?.id,
          mode: room.bidState.mode
        }
      : undefined,
    log: room.log.slice(0, 40),
    winner: room.winner
  };
}

export function isLandlordBotTurn(room: LandlordRoom): boolean {
  if (room.phase !== "bidding" && room.phase !== "playing") return false;
  return Boolean(room.players[room.currentPlayerIndex]?.bot);
}

export function runLandlordBotTurn(room: LandlordRoom): void {
  const bot = currentPlayer(room);
  if (!bot.bot) return;
  if (room.phase === "bidding" && room.bidState) {
    const score = handScore(bot.hand);
    if (room.bidState.mode === "call") {
      bidLandlord(room, bot.id, score >= 9 ? "call" : "noCall");
    } else {
      bidLandlord(room, bot.id, score >= 13 ? "grab" : "noGrab");
    }
    return;
  }
  if (room.phase === "playing") {
    const choice = chooseBotCards(room, bot);
    if (choice.length > 0) {
      playLandlordCards(room, bot.id, choice.map((card) => card.id));
    } else {
      passLandlord(room, bot.id);
    }
  }
}

export function analyzeLandlordCards(cards: LandlordCard[], playerId = "", playerName = ""): LandlordPlay | undefined {
  if (cards.length === 0) return undefined;
  const sorted = [...cards].sort((a, b) => a.value - b.value);
  const counts = countByValue(sorted);
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const values = entries.map(([value]) => value);
  const countValues = entries.map(([, count]) => count);
  const total = sorted.length;

  if (total === 2 && values.includes(rankValues.SJ) && values.includes(rankValues.BJ)) {
    return play("rocket", rankValues.BJ, 1);
  }
  if (total === 4 && entries.length === 1) return play("bomb", values[0], 1);
  if (total === 1) return play("single", values[0], 1);
  if (total === 2 && entries.length === 1) return play("pair", values[0], 1);
  if (total === 3 && entries.length === 1) return play("triple", values[0], 1);
  if (total === 4 && countValues.includes(3)) return play("tripleSingle", valueWithCount(entries, 3), 1);
  if (total === 5 && countValues.includes(3) && countValues.includes(2)) return play("triplePair", valueWithCount(entries, 3), 1);
  if (total >= 5 && entries.every(([, count]) => count === 1) && isSequence(values)) return play("straight", values.at(-1)!, values.length);
  if (total >= 6 && total % 2 === 0 && entries.every(([, count]) => count === 2) && isSequence(values)) {
    return play("pairSequence", values.at(-1)!, values.length);
  }

  const tripleValues = entries.filter(([, count]) => count === 3).map(([value]) => value);
  if (tripleValues.length >= 2 && isSequence(tripleValues)) {
    if (total === tripleValues.length * 3 && entries.every(([, count]) => count === 3)) {
      return play("airplane", tripleValues.at(-1)!, tripleValues.length);
    }
    if (total === tripleValues.length * 4 && entries.every(([value, count]) => tripleValues.includes(value) ? count === 3 : count === 1)) {
      return play("airplaneSingles", tripleValues.at(-1)!, tripleValues.length);
    }
    if (total === tripleValues.length * 5 && entries.every(([value, count]) => tripleValues.includes(value) ? count === 3 : count === 2)) {
      return play("airplanePairs", tripleValues.at(-1)!, tripleValues.length);
    }
  }

  const fourValue = entries.find(([, count]) => count === 4)?.[0];
  if (fourValue !== undefined && total === 6) return play("fourTwoSingles", fourValue, 1);
  if (fourValue !== undefined && total === 8 && entries.every(([value, count]) => value === fourValue ? count === 4 : count === 2)) {
    return play("fourTwoPairs", fourValue, 1);
  }

  return undefined;

  function play(type: LandlordPlayType, value: number, length: number): LandlordPlay {
    return { type, value, length, cards: sorted, playerId, playerName };
  }
}

export function canBeat(next: LandlordPlay, previous: LandlordPlay): boolean {
  if (next.type === "rocket") return previous.type !== "rocket";
  if (previous.type === "rocket") return false;
  if (next.type === "bomb" && previous.type !== "bomb") return true;
  if (previous.type === "bomb" && next.type !== "bomb") return false;
  return next.type === previous.type && next.length === previous.length && next.value > previous.value;
}

export function buildLandlordDeck(): LandlordCard[] {
  const ranks: Exclude<LandlordRank, "SJ" | "BJ">[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
  const regular = suits.flatMap((suit) =>
    ranks.map((rank) => ({
      id: `${suit}-${rank}`,
      rank,
      suit,
      value: rankValues[rank]
    }))
  );
  return [
    ...regular,
    { id: "joker-small", rank: "SJ", value: rankValues.SJ },
    { id: "joker-big", rank: "BJ", value: rankValues.BJ }
  ];
}

function createPlayer(id: string, name: string, seat: number, bot: boolean): LandlordPlayerState {
  return { id, name, seat, hand: [], connected: true, bot };
}

function fillBots(room: LandlordRoom): void {
  while (room.players.length < 3) {
    const seat = room.players.length;
    room.players.push(createPlayer(`bot-${seat + 1}`, `电脑 ${seat + 1}`, seat, true));
  }
}

function dealForBidding(room: LandlordRoom, message: string): void {
  room.deck = shuffle(buildLandlordDeck());
  room.bottomCards = room.deck.splice(51, 3);
  room.players.forEach((player) => {
    player.hand = [];
    player.role = undefined;
  });
  room.deck.forEach((card, index) => room.players[index % 3].hand.push(card));
  room.players.forEach((player) => sortLandlordHand(player.hand));
  room.phase = "bidding";
  room.landlordIndex = undefined;
  room.lastPlay = undefined;
  room.passCount = 0;
  room.winner = undefined;
  const starterIndex = Math.floor(Math.random() * 3);
  room.currentPlayerIndex = starterIndex;
  room.bidState = {
    mode: "call",
    currentIndex: starterIndex,
    starterIndex,
    callPassCount: 0,
    grabQueue: []
  };
  room.log.unshift(message);
}

function assignLandlord(room: LandlordRoom, landlordIndex: number): void {
  room.landlordIndex = landlordIndex;
  room.players.forEach((player, index) => {
    player.role = index === landlordIndex ? "landlord" : "farmer";
  });
  const landlord = room.players[landlordIndex];
  landlord.hand.push(...room.bottomCards);
  sortLandlordHand(landlord.hand);
  room.phase = "playing";
  room.currentPlayerIndex = landlordIndex;
  room.bidState = undefined;
  room.lastPlay = undefined;
  room.passCount = 0;
  room.log.unshift(`${landlord.name} 成为地主，获得底牌 ${formatLandlordCards(room.bottomCards)}。`);
}

function chooseBotCards(room: LandlordRoom, bot: LandlordPlayerState): LandlordCard[] {
  const wholeHand = analyzeLandlordCards(bot.hand, bot.id, bot.name);
  if (wholeHand && (!room.lastPlay || room.lastPlay.playerId === bot.id || canBeat(wholeHand, room.lastPlay))) return [...bot.hand];
  if (!room.lastPlay || room.lastPlay.playerId === bot.id) return [lowestCard(bot.hand)];
  const candidate = findSmallestCounter(bot.hand, room.lastPlay);
  return candidate ?? [];
}

function findSmallestCounter(hand: LandlordCard[], target: LandlordPlay): LandlordCard[] | undefined {
  if (target.type === "rocket") return undefined;
  const groups = groupCardsByValue(hand);
  const tryPlay = (cards: LandlordCard[] | undefined) => {
    if (!cards) return undefined;
    const play = analyzeLandlordCards(cards);
    return play && canBeat(play, target) ? cards : undefined;
  };

  if (target.type === "single") return tryPlay(firstGroup(groups, 1, target.value));
  if (target.type === "pair") return tryPlay(firstGroup(groups, 2, target.value));
  if (target.type === "triple") return tryPlay(firstGroup(groups, 3, target.value));
  if (target.type === "tripleSingle") {
    for (const triple of groupsWithCount(groups, 3, target.value)) {
      const kicker = lowestExcluding(hand, [triple[0].value], 1);
      const result = tryPlay([...triple, ...(kicker ?? [])]);
      if (result) return result;
    }
  }
  if (target.type === "triplePair") {
    for (const triple of groupsWithCount(groups, 3, target.value)) {
      const pair = firstGroup(groups, 2, 0, [triple[0].value]);
      const result = tryPlay(pair ? [...triple, ...pair] : undefined);
      if (result) return result;
    }
  }
  if (target.type === "straight") return tryPlay(findSequence(groups, 1, target.length, target.value));
  if (target.type === "pairSequence") return tryPlay(findSequence(groups, 2, target.length, target.value));
  if (target.type === "airplane" || target.type === "airplaneSingles" || target.type === "airplanePairs") {
    const triples = findSequence(groups, 3, target.length, target.value);
    if (triples) {
      const excluded = uniqueValues(triples);
      if (target.type === "airplane") return tryPlay(triples);
      if (target.type === "airplaneSingles") return tryPlay([...triples, ...(lowestExcluding(hand, excluded, target.length) ?? [])]);
      const pairs = lowestPairAttachments(groups, excluded, target.length);
      return tryPlay(pairs ? [...triples, ...pairs] : undefined);
    }
  }
  if (target.type === "fourTwoSingles") {
    for (const four of groupsWithCount(groups, 4, target.value)) {
      const extra = lowestExcluding(hand, [four[0].value], 2);
      const result = tryPlay(extra ? [...four, ...extra] : undefined);
      if (result) return result;
    }
  }
  if (target.type === "fourTwoPairs") {
    for (const four of groupsWithCount(groups, 4, target.value)) {
      const pairs = lowestPairAttachments(groups, [four[0].value], 2);
      const result = tryPlay(pairs ? [...four, ...pairs] : undefined);
      if (result) return result;
    }
  }
  if (target.type === "bomb") return tryPlay(firstGroup(groups, 4, target.value)) ?? rocket(hand);
  return firstBomb(groups) ?? rocket(hand);
}

function firstBomb(groups: Map<number, LandlordCard[]>): LandlordCard[] | undefined {
  return firstGroup(groups, 4, 0);
}

function rocket(hand: LandlordCard[]): LandlordCard[] | undefined {
  const small = hand.find((card) => card.rank === "SJ");
  const big = hand.find((card) => card.rank === "BJ");
  return small && big ? [small, big] : undefined;
}

function firstGroup(groups: Map<number, LandlordCard[]>, count: number, minValue: number, excluded: number[] = []): LandlordCard[] | undefined {
  for (const [value, cards] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (value > minValue && !excluded.includes(value) && cards.length >= count) return cards.slice(0, count);
  }
  return undefined;
}

function groupsWithCount(groups: Map<number, LandlordCard[]>, count: number, minValue: number): LandlordCard[][] {
  return [...groups.entries()]
    .filter(([value, cards]) => value > minValue && cards.length >= count)
    .sort((a, b) => a[0] - b[0])
    .map(([, cards]) => cards.slice(0, count));
}

function findSequence(groups: Map<number, LandlordCard[]>, count: number, length: number, minTopValue: number): LandlordCard[] | undefined {
  const values = [...groups.entries()]
    .filter(([value, cards]) => value <= rankValues.A && cards.length >= count)
    .map(([value]) => value)
    .sort((a, b) => a - b);
  for (let i = 0; i <= values.length - length; i += 1) {
    const window = values.slice(i, i + length);
    if (window.at(-1)! <= minTopValue || !isSequence(window)) continue;
    return window.flatMap((value) => groups.get(value)!.slice(0, count));
  }
  return undefined;
}

function lowestExcluding(hand: LandlordCard[], excluded: number[], count: number): LandlordCard[] | undefined {
  const cards = hand.filter((card) => !excluded.includes(card.value)).sort((a, b) => a.value - b.value);
  return cards.length >= count ? cards.slice(0, count) : undefined;
}

function lowestPairAttachments(groups: Map<number, LandlordCard[]>, excluded: number[], count: number): LandlordCard[] | undefined {
  const pairs = [...groups.entries()]
    .filter(([value, cards]) => !excluded.includes(value) && cards.length >= 2)
    .sort((a, b) => a[0] - b[0])
    .slice(0, count)
    .flatMap(([, cards]) => cards.slice(0, 2));
  return pairs.length === count * 2 ? pairs : undefined;
}

function takeCards(hand: LandlordCard[], ids: string[]): LandlordCard[] {
  const selected: LandlordCard[] = [];
  for (const id of ids) {
    const index = hand.findIndex((card) => card.id === id);
    if (index === -1) throw new Error("选择的牌不在手牌中。");
    selected.push(hand.splice(index, 1)[0]);
  }
  return selected;
}

function countByValue(cards: LandlordCard[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  return counts;
}

function groupCardsByValue(cards: LandlordCard[]): Map<number, LandlordCard[]> {
  const groups = new Map<number, LandlordCard[]>();
  for (const card of [...cards].sort((a, b) => a.value - b.value)) {
    const group = groups.get(card.value) ?? [];
    group.push(card);
    groups.set(card.value, group);
  }
  return groups;
}

function valueWithCount(entries: Array<[number, number]>, count: number): number {
  const value = entries.find(([, itemCount]) => itemCount === count)?.[0];
  if (value === undefined) throw new Error("invalid count lookup");
  return value;
}

function isSequence(values: number[]): boolean {
  if (values.some((value) => value > rankValues.A)) return false;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

function uniqueValues(cards: LandlordCard[]): number[] {
  return [...new Set(cards.map((card) => card.value))];
}

function sortLandlordHand(hand: LandlordCard[]): void {
  hand.sort((a, b) => a.value - b.value || suitSort(a.suit) - suitSort(b.suit));
}

function suitSort(suit?: Suit): number {
  return suit ? suits.indexOf(suit) : 9;
}

function lowestCard(hand: LandlordCard[]): LandlordCard {
  return [...hand].sort((a, b) => a.value - b.value)[0];
}

function nextIndex(index: number): number {
  return (index + 1) % 3;
}

function nextIndexes(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, offset) => (start + offset + 1) % 3);
}

function currentPlayer(room: LandlordRoom): LandlordPlayerState {
  return room.players[room.currentPlayerIndex];
}

function publicPlayer(player: LandlordPlayerState): LandlordPublicPlayer {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    handCount: player.hand.length,
    connected: player.connected,
    bot: player.bot,
    role: player.role
  };
}

function humanCount(room: LandlordRoom): number {
  return room.players.filter((player) => !player.bot).length;
}

function handScore(hand: LandlordCard[]): number {
  const groups = groupCardsByValue(hand);
  let score = 0;
  if (hand.some((card) => card.rank === "SJ")) score += 3;
  if (hand.some((card) => card.rank === "BJ")) score += 4;
  for (const card of hand) {
    if (card.rank === "2") score += 1.5;
    if (card.rank === "A") score += 0.8;
  }
  for (const cards of groups.values()) {
    if (cards.length === 4) score += 4;
    if (cards.length === 3) score += 1.5;
  }
  return score;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatLandlordCards(cards: LandlordCard[]): string {
  return cards.map(formatLandlordCard).join("、");
}

function formatLandlordCard(card: LandlordCard): string {
  if (card.rank === "SJ") return "小王";
  if (card.rank === "BJ") return "大王";
  return `${card.suit ? suitLabel[card.suit] : ""}${card.rank}`;
}

function modeLabel(mode: LandlordPlayerMode): string {
  if (mode === "solo") return "单人";
  if (mode === "duo") return "双人";
  return "三人";
}
