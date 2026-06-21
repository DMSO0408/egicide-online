import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import type {
  ActionResult,
  AppView,
  Card,
  CreateRoomPayload,
  GameType,
  JoinResult,
  LandlordBidAction,
  LandlordCard,
  LandlordPlayType,
  LandlordPlayerMode,
  LandlordPlayerView,
  PlayerView,
  Suit
} from "../../shared/types";
import "./styles.css";

const socket = io();
const storageKey = "card-room-session-v2";

interface Session {
  gameType: GameType;
  roomCode: string;
  playerId: string;
  name: string;
}

function App() {
  const [name, setName] = useState(localStorage.getItem("card-room-name") || "玩家");
  const [roomCode, setRoomCode] = useState("");
  const [gameType, setGameType] = useState<GameType>("landlord");
  const [playerMode, setPlayerMode] = useState<LandlordPlayerMode>("solo");
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [view, setView] = useState<AppView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  React.useEffect(() => {
    socket.on("state:update", (next) => {
      setView(next);
      setSelected([]);
      setError("");
    });
    if (session) {
      socket.emit("room:join", { roomCode: session.roomCode, name: session.name, playerId: session.playerId }, (result: JoinResult) => {
        if (!result.ok) clearSession();
      });
    }
    return () => {
      socket.off("state:update");
    };
  }, []);

  function saveSession(next: Session) {
    setSession(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    localStorage.setItem("card-room-name", next.name);
  }

  function clearSession() {
    setSession(null);
    setView(null);
    setSelected([]);
    localStorage.removeItem(storageKey);
  }

  function createSelectedRoom() {
    const payload: CreateRoomPayload = { gameType, name, playerMode: gameType === "landlord" ? playerMode : undefined };
    socket.emit("room:create", payload, (result: JoinResult) => {
      if (!result.ok || !result.roomCode || !result.playerId || !result.gameType) return setError(result.error || "创建房间失败。");
      saveSession({ roomCode: result.roomCode, playerId: result.playerId, name, gameType: result.gameType });
    });
  }

  function joinRoom() {
    socket.emit("room:join", { roomCode, name }, (result: JoinResult) => {
      if (!result.ok || !result.roomCode || !result.playerId || !result.gameType) return setError(result.error || "加入房间失败。");
      saveSession({ roomCode: result.roomCode, playerId: result.playerId, name, gameType: result.gameType });
    });
  }

  function handleActionResult(result: ActionResult) {
    if (!result.ok) setError(result.error || "操作失败。");
  }

  if (!session || !view) {
    return (
      <main className="shell centered">
        <section className="entry">
          <h1>Card Room</h1>
          <label>
            昵称
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="gameChoices">
            <button className={gameType === "landlord" ? "choice active" : "choice"} onClick={() => setGameType("landlord")}>斗地主</button>
            <button className={gameType === "egicide" ? "choice active" : "choice"} onClick={() => setGameType("egicide")}>Egicide</button>
          </div>
          {gameType === "landlord" && (
            <div className="gameChoices">
              <button className={playerMode === "solo" ? "choice active" : "choice"} onClick={() => setPlayerMode("solo")}>单人</button>
              <button className={playerMode === "duo" ? "choice active" : "choice"} onClick={() => setPlayerMode("duo")}>双人</button>
              <button className={playerMode === "trio" ? "choice active" : "choice"} onClick={() => setPlayerMode("trio")}>三人</button>
            </div>
          )}
          <div className="entryActions">
            <button onClick={createSelectedRoom}>创建房间</button>
            <input placeholder="房间码" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
            <button onClick={joinRoom}>加入</button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return view.gameType === "landlord" ? (
    <LandlordTable
      view={view}
      selected={selected}
      setSelected={setSelected}
      error={error}
      clearSession={clearSession}
      handleActionResult={handleActionResult}
    />
  ) : (
    <EgicideTable
      view={view}
      selected={selected}
      setSelected={setSelected}
      error={error}
      clearSession={clearSession}
      handleActionResult={handleActionResult}
    />
  );
}

function EgicideTable({
  view,
  selected,
  setSelected,
  error,
  clearSession,
  handleActionResult
}: {
  view: PlayerView;
  selected: string[];
  setSelected: (value: string[]) => void;
  error: string;
  clearSession: () => void;
  handleActionResult: (result: ActionResult) => void;
}) {
  const selectedCards = useMemo(() => view.hand.filter((card) => selected.includes(card.id)), [selected, view.hand]);
  const isMyTurn = view.currentPlayerId === view.selfId;
  const isDefending = view.defendingPlayerId === view.selfId;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <strong>Egicide · {view.roomCode}</strong>
          <span>{egicidePhaseText(view)}</span>
        </div>
        <button className="secondary" onClick={clearSession}>离开</button>
      </header>

      <section className="board">
        <div className="monsterPanel">
          {view.monster ? (
            <>
              <CardFace card={view.monster.card} large />
              <div className="meter">
                <span>血量 {Math.max(0, view.monster.health - view.monster.damage)} / {view.monster.health}</span>
                <span>攻击 {Math.max(0, view.monster.attack - view.monster.shield)} / {view.monster.attack}</span>
                <span>护盾 {view.monster.shield}</span>
              </div>
            </>
          ) : (
            <div className="empty">没有当前怪物</div>
          )}
        </div>

        <aside className="side">
          <div className="stats">
            <span>抽牌堆 {view.drawCount}</span>
            <span>弃牌堆 {view.discardCount}</span>
            <span>怪物 {view.monstersLeft}</span>
          </div>
          <PlayerList players={view.players.map((player) => ({ ...player, seat: 0, bot: false }))} selfId={view.selfId} />
        </aside>
      </section>

      <section className="table">
        <h2>场上</h2>
        <div className="cards compact">
          {view.tableCards.length ? view.tableCards.map((card) => <CardFace card={card} key={card.id} />) : <span className="muted">暂无出牌</span>}
        </div>
      </section>

      <section className="hand">
        <div className="handHeader">
          <h2>手牌</h2>
          <div className="actions">
            {view.phase === "lobby" && view.players.length === 2 && <button onClick={() => socket.emit("game:start", handleActionResult)}>开始游戏</button>}
            {view.phase === "playerAction" && isMyTurn && (
              <>
                <button disabled={!selected.length} onClick={() => socket.emit("action:playCards", selected, handleActionResult)}>出牌</button>
                <button className="secondary" onClick={() => socket.emit("action:skip", handleActionResult)}>不出</button>
              </>
            )}
            {view.phase === "defense" && isDefending && <button disabled={!selected.length} onClick={() => socket.emit("action:defend", selected, handleActionResult)}>弃牌防御</button>}
          </div>
        </div>
        <div className="cards">
          {view.hand.map((card) => (
            <button className={selected.includes(card.id) ? "cardButton selected" : "cardButton"} key={card.id} onClick={() => toggle(selected, setSelected, card.id)}>
              <CardFace card={card} />
            </button>
          ))}
        </div>
        {selectedCards.length > 0 && <p className="hint">已选 {selectedCards.map(cardName).join("、")}，合计 {selectedCards.reduce((sum, card) => sum + card.value, 0)}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <GameLog log={view.log} />
    </main>
  );
}

function LandlordTable({
  view,
  selected,
  setSelected,
  error,
  clearSession,
  handleActionResult
}: {
  view: LandlordPlayerView;
  selected: string[];
  setSelected: (value: string[]) => void;
  error: string;
  clearSession: () => void;
  handleActionResult: (result: ActionResult) => void;
}) {
  const selectedCards = useMemo(() => view.hand.filter((card) => selected.includes(card.id)), [selected, view.hand]);
  const isMyTurn = view.currentPlayerId === view.selfId;
  const isBidTurn = view.phase === "bidding" && view.bid?.currentPlayerId === view.selfId;
  const humans = view.players.filter((player) => !player.bot).length;
  const canStart = view.phase === "lobby" && humans >= view.requiredHumans;
  const canPass = isMyTurn && Boolean(view.lastPlay && view.lastPlay.playerId !== view.selfId);
  const seats = landlordSeats(view);

  return (
    <main className="shell landlordShell">
      <header className="topbar">
        <div>
          <strong>斗地主 · {view.roomCode}</strong>
          <span>{landlordPhaseText(view)}</span>
        </div>
        <button className="secondary" onClick={clearSession}>离开</button>
      </header>

      <section className="landlordBoard">
        <PlayerSeat className="leftSeat" player={seats.left} selfId={view.selfId} />
        <PlayerSeat className="rightSeat" player={seats.right} selfId={view.selfId} />

        <div className="landlordTable">
          <div className="bottomCards">
            <span>底牌</span>
            <div className="miniCards">
              {view.bottomCards.length ? view.bottomCards.map((card) => <LandlordCardFace card={card} compact key={card.id} />) : <span className="muted">未揭示</span>}
            </div>
          </div>
          <TurnStateBox className="turnLeft" player={seats.left} view={view} />
          <TurnStateBox className="turnRight" player={seats.right} view={view} />
          <TurnStateBox className="turnSelf" player={seats.self} view={view} />
          <div className="tableCenterStatus">{landlordCenterText(view)}</div>
        </div>
      </section>

      <section className="landlordHandPanel">
        <div className="handHeader">
          <h2>我的手牌 · {view.hand.length} 张</h2>
          <div className="actions">
            <span className="muted">真人 {humans} / {view.requiredHumans} · {modeLabel(view.playerMode)}</span>
            {canStart && <button onClick={() => socket.emit("game:start", handleActionResult)}>开始游戏</button>}
            {isBidTurn && view.bid?.mode === "call" && (
              <>
                <button onClick={() => bid("call", handleActionResult)}>叫地主</button>
                <button className="secondary" onClick={() => bid("noCall", handleActionResult)}>不叫</button>
              </>
            )}
            {isBidTurn && view.bid?.mode === "grab" && (
              <>
                <button onClick={() => bid("grab", handleActionResult)}>抢地主</button>
                <button className="secondary" onClick={() => bid("noGrab", handleActionResult)}>不抢</button>
              </>
            )}
            {view.phase === "playing" && isMyTurn && (
              <>
                <button disabled={!selected.length} onClick={() => socket.emit("landlord:play", selected, handleActionResult)}>出牌</button>
                <button className="secondary" disabled={!canPass} onClick={() => socket.emit("landlord:pass", handleActionResult)}>不出</button>
              </>
            )}
          </div>
        </div>
        <div className="landlordHand" aria-label="我的手牌">
          {view.hand.map((card) => (
            <button className={selected.includes(card.id) ? "cardButton selected" : "cardButton"} key={card.id} onClick={() => toggle(selected, setSelected, card.id)}>
              <LandlordCardFace card={card} />
            </button>
          ))}
        </div>
        {selectedCards.length > 0 && <p className="hint">已选 {selectedCards.map(landlordCardName).join("、")}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <GameLog log={view.log} />
    </main>
  );
}

function PlayerSeat({
  player,
  selfId,
  className
}: {
  player?: { id: string; name: string; handCount: number; connected: boolean; seat: number; bot: boolean; role?: string };
  selfId: string;
  className: string;
}) {
  if (!player) return <div className={`landlordSeat ${className} emptySeat`}>等待玩家</div>;
  return (
    <div className={`landlordSeat ${className} ${player.id === selfId ? "self" : ""}`}>
      <div className="avatarMark" aria-hidden="true" />
      <strong>{player.name}{player.id === selfId ? "（你）" : ""}</strong>
      <span>{player.bot ? "电脑" : player.connected ? "在线" : "离线"}{player.role ? ` · ${player.role === "landlord" ? "地主" : "农民"}` : ""}</span>
      <b>{player.handCount}</b>
    </div>
  );
}

function TurnStateBox({
  player,
  view,
  className
}: {
  player?: { id: string; name: string };
  view: LandlordPlayerView;
  className: string;
}) {
  if (!player) return null;
  const state = view.turnStates.find((item) => item.playerId === player.id);
  const isCurrent = view.currentPlayerId === player.id && view.phase !== "finished";
  const label = turnStateLabel(state);
  return (
    <div className={`turnState ${className} ${isCurrent ? "current" : ""}`}>
      <div className="turnStateHeader">
        <span>{player.name}</span>
        <strong>{label}</strong>
      </div>
      {state?.status === "played" && state.play ? (
        <div className="turnCards">
          {state.play.cards.map((card) => <LandlordCardFace card={card} compact key={card.id} />)}
        </div>
      ) : null}
    </div>
  );
}

function bid(action: LandlordBidAction, handleActionResult: (result: ActionResult) => void) {
  socket.emit("landlord:bid", action, handleActionResult);
}

function PlayerList({
  players,
  selfId
}: {
  players: Array<{ id: string; name: string; handCount: number; connected: boolean; seat: number; bot: boolean; role?: string }>;
  selfId: string;
}) {
  return (
    <div className="players">
      {players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((player) => (
          <div className={player.id === selfId ? "player self" : "player"} key={player.id}>
            <span>
              {player.name}{player.id === selfId ? "（你）" : ""}{player.bot ? " · 电脑" : ""}{player.role === "landlord" ? " · 地主" : player.role === "farmer" ? " · 农民" : ""}
            </span>
            <span>{player.handCount} 张 {player.connected ? "" : "离线"}</span>
          </div>
        ))}
    </div>
  );
}

function GameLog({ log }: { log: string[] }) {
  return (
    <section className="log">
      <h2>日志</h2>
      {log.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
    </section>
  );
}

function readSession(): Session | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function toggle(selected: string[], setSelected: (value: string[]) => void, id: string) {
  setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
}

function egicidePhaseText(view: PlayerView): string {
  if (view.phase === "lobby") return view.players.length < 2 ? "等待玩家加入" : "可以开始";
  if (view.phase === "won") return "挑战成功";
  if (view.phase === "lost") return "挑战失败";
  if (view.phase === "defense") return view.defendingPlayerId === view.selfId ? "你需要弃牌防御" : "等待队友防御";
  return view.currentPlayerId === view.selfId ? "轮到你行动" : "等待队友行动";
}

function landlordPhaseText(view: LandlordPlayerView): string {
  if (view.phase === "lobby") return "等待开始";
  if (view.phase === "bidding") {
    if (view.bid?.currentPlayerId === view.selfId) return view.bid.mode === "call" ? "轮到你叫地主" : "轮到你抢地主";
    const player = view.players.find((item) => item.id === view.bid?.currentPlayerId);
    return `${player?.name ?? "玩家"} 思考中`;
  }
  if (view.phase === "finished") return view.winner === "landlord" ? "地主胜利" : "农民胜利";
  return view.currentPlayerId === view.selfId ? "轮到你出牌" : "等待出牌";
}

const suitSymbol: Record<Suit, string> = {
  spades: "♠",
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥"
};

function CardFace({ card, large = false }: { card: Card; large?: boolean }) {
  const red = card.suit === "diamonds" || card.suit === "hearts";
  return (
    <div className={`${large ? "card large" : "card"} ${red ? "red" : "black"}`}>
      <span>{card.rank}</span>
      <strong>{suitSymbol[card.suit]}</strong>
      <small>{card.value}</small>
    </div>
  );
}

function LandlordCardFace({ card, compact = false }: { card: LandlordCard; compact?: boolean }) {
  const red = card.suit === "diamonds" || card.suit === "hearts" || card.rank === "BJ";
  return (
    <div className={`card landlordCard ${compact ? "compactCard" : ""} ${red ? "red" : "black"}`}>
      <span>{landlordRankLabel(card)}</span>
      <strong>{card.suit ? suitSymbol[card.suit] : "王"}</strong>
      <small>{card.value}</small>
    </div>
  );
}

function cardName(card: Card): string {
  return `${suitSymbol[card.suit]}${card.rank}`;
}

function landlordCardName(card: LandlordCard): string {
  return `${card.suit ? suitSymbol[card.suit] : ""}${landlordRankLabel(card)}`;
}

function landlordRankLabel(card: LandlordCard): string {
  if (card.rank === "SJ") return "小";
  if (card.rank === "BJ") return "大";
  return card.rank;
}

function modeLabel(mode: LandlordPlayerMode): string {
  if (mode === "solo") return "单人";
  if (mode === "duo") return "双人";
  return "三人";
}

function landlordSeats(view: LandlordPlayerView) {
  const sorted = view.players.slice().sort((a, b) => a.seat - b.seat);
  const self = sorted.find((player) => player.id === view.selfId) ?? sorted[0];
  const left = sorted[(self.seat + 1) % 3];
  const right = sorted[(self.seat + 2) % 3];
  return { self, left, right };
}

function turnStateLabel(state: LandlordPlayerView["turnStates"][number] | undefined): string {
  if (!state || state.status === "waiting") return "等待";
  if (state.status === "passed") return "不出";
  return state.play ? landlordPlayTypeLabel(state.play.type) : "已出";
}

function landlordPlayTypeLabel(type: LandlordPlayType): string {
  const labels: Record<LandlordPlayType, string> = {
    single: "单张",
    pair: "对子",
    triple: "三张",
    tripleSingle: "三带一",
    triplePair: "三带二",
    straight: "顺子",
    pairSequence: "连对",
    airplane: "飞机",
    airplaneSingles: "飞机带单",
    airplanePairs: "飞机带对",
    fourTwoSingles: "四带二",
    fourTwoPairs: "四带两对",
    bomb: "炸弹",
    rocket: "王炸"
  };
  return labels[type] ?? "已出";
}

function landlordCenterText(view: LandlordPlayerView): string {
  if (view.phase === "lobby") return "等待开始";
  if (view.phase === "bidding") return view.bid?.mode === "call" ? "叫地主" : "抢地主";
  if (view.phase === "finished") return view.winner === "landlord" ? "地主胜利" : "农民胜利";
  if (!view.lastPlay) return "新一轮";
  return `${view.lastPlay.playerName} · ${landlordPlayTypeLabel(view.lastPlay.type)}`;
}

createRoot(document.getElementById("root")!).render(<App />);
