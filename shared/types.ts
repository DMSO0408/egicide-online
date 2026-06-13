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

export interface ClientToServerEvents {
  "room:create": (name: string, ack: (result: JoinResult) => void) => void;
  "room:join": (payload: { roomCode: string; name: string; playerId?: string }, ack: (result: JoinResult) => void) => void;
  "game:start": (ack: (result: ActionResult) => void) => void;
  "action:playCards": (cardIds: string[], ack: (result: ActionResult) => void) => void;
  "action:skip": (ack: (result: ActionResult) => void) => void;
  "action:defend": (cardIds: string[], ack: (result: ActionResult) => void) => void;
}

export interface ServerToClientEvents {
  "state:update": (view: PlayerView) => void;
}

export interface JoinResult {
  ok: boolean;
  roomCode?: string;
  playerId?: string;
  error?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}
