export type GameType = "egicide" | "landlord";

export type Suit = "spades" | "clubs" | "diamonds" | "hearts";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type Phase = "lobby" | "playerAction" | "defense" | "won" | "lost";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
  monster?: boolean;
}

export interface PublicPlayer {
  id: string;
  name: string;
  handCount: number;
  connected: boolean;
}

export interface PublicMonster {
  card: Card;
  health: number;
  attack: number;
  damage: number;
  shield: number;
}

export interface PlayerView {
  gameType: "egicide";
  roomCode: string;
  selfId: string;
  players: PublicPlayer[];
  hand: Card[];
  phase: Phase;
  currentPlayerId?: string;
  defendingPlayerId?: string;
  monster?: PublicMonster;
  drawCount: number;
  discardCount: number;
  monstersLeft: number;
  tableCards: Card[];
  log: string[];
  winner?: boolean;
  error?: string;
}

export type LandlordPlayerMode = "solo" | "duo" | "trio";
export type LandlordRank = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A" | "2" | "SJ" | "BJ";
export type LandlordPhase = "lobby" | "bidding" | "playing" | "finished";
export type LandlordRole = "landlord" | "farmer";
export type LandlordBidAction = "call" | "noCall" | "grab" | "noGrab";
export type LandlordPlayType =
  | "single"
  | "pair"
  | "triple"
  | "tripleSingle"
  | "triplePair"
  | "straight"
  | "pairSequence"
  | "airplane"
  | "airplaneSingles"
  | "airplanePairs"
  | "fourTwoSingles"
  | "fourTwoPairs"
  | "bomb"
  | "rocket";

export interface LandlordCard {
  id: string;
  rank: LandlordRank;
  suit?: Suit;
  value: number;
}

export interface LandlordPlay {
  type: LandlordPlayType;
  value: number;
  length: number;
  cards: LandlordCard[];
  playerId: string;
  playerName: string;
}

export interface LandlordPublicPlayer {
  id: string;
  name: string;
  seat: number;
  handCount: number;
  connected: boolean;
  bot: boolean;
  role?: LandlordRole;
}

export interface LandlordTurnState {
  playerId: string;
  status: "waiting" | "played" | "passed";
  play?: LandlordPlay;
}

export interface LandlordBidView {
  currentPlayerId?: string;
  calledById?: string;
  candidateId?: string;
  mode: "call" | "grab";
}

export interface LandlordPlayerView {
  gameType: "landlord";
  roomCode: string;
  selfId: string;
  playerMode: LandlordPlayerMode;
  requiredHumans: number;
  players: LandlordPublicPlayer[];
  hand: LandlordCard[];
  phase: LandlordPhase;
  currentPlayerId?: string;
  landlordId?: string;
  bottomCards: LandlordCard[];
  lastPlay?: LandlordPlay;
  turnStates: LandlordTurnState[];
  passCount: number;
  bid?: LandlordBidView;
  log: string[];
  winner?: "landlord" | "farmers";
  error?: string;
}

export type AppView = PlayerView | LandlordPlayerView;

export interface CreateRoomPayload {
  gameType: GameType;
  name: string;
  playerMode?: LandlordPlayerMode;
}

export interface ClientToServerEvents {
  "room:create": (payload: CreateRoomPayload | string, ack: (result: JoinResult) => void) => void;
  "room:join": (payload: { roomCode: string; name: string; playerId?: string }, ack: (result: JoinResult) => void) => void;
  "game:start": (ack: (result: ActionResult) => void) => void;
  "action:playCards": (cardIds: string[], ack: (result: ActionResult) => void) => void;
  "action:skip": (ack: (result: ActionResult) => void) => void;
  "action:defend": (cardIds: string[], ack: (result: ActionResult) => void) => void;
  "landlord:bid": (action: LandlordBidAction, ack: (result: ActionResult) => void) => void;
  "landlord:play": (cardIds: string[], ack: (result: ActionResult) => void) => void;
  "landlord:pass": (ack: (result: ActionResult) => void) => void;
}

export interface ServerToClientEvents {
  "state:update": (view: AppView) => void;
}

export interface JoinResult {
  ok: boolean;
  roomCode?: string;
  playerId?: string;
  gameType?: GameType;
  error?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}
