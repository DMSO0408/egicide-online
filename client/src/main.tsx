import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import type { ActionResult, Card, JoinResult, PlayerView, Suit } from "../../shared/types";
import "./styles.css";

const socket = io();
const storageKey = "egicide-session";

interface Session {
  roomCode: string;
  playerId: string;
  name: string;
}

function App() {
  const [name, setName] = useState(localStorage.getItem("egicide-name") || "玩家");
  const [roomCode, setRoomCode] = useState("");
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [view, setView] = useState<PlayerView | null>(null);
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

  const selectedCards = useMemo(() => view?.hand.filter((card) => selected.includes(card.id)) ?? [], [selected, view]);

  function saveSession(next: Session) {
    setSession(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    localStorage.setItem("egicide-name", next.name);
  }

  function clearSession() {
    setSession(null);
    setView(null);
    localStorage.removeItem(storageKey);
  }

  function createRoom() {
    socket.emit("room:create", name, (result: JoinResult) => {
      if (!result.ok || !result.roomCode || !result.playerId) return setError(result.error || "创建房间失败。");
      saveSession({ roomCode: result.roomCode, playerId: result.playerId, name });
    });
  }

  function joinRoom() {
    socket.emit("room:join", { roomCode, name }, (result: JoinResult) => {
      if (!result.ok || !result.roomCode || !result.playerId) return setError(result.error || "加入房间失败。");
      saveSession({ roomCode: result.roomCode, playerId: result.playerId, name });
    });
  }

  function handleActionResult(result: ActionResult) {
    if (!result.ok) setError(result.error || "操作失败。");
  }

  function startGame() {
    socket.emit("game:start", handleActionResult);
  }

  function skipTurn() {
    socket.emit("action:skip", handleActionResult);
  }

  function playSelected() {
    socket.emit("action:playCards", selected, handleActionResult);
  }

  function defendSelected() {
    socket.emit("action:defend", selected, handleActionResult);
  }

  if (!session || !view) {
    return (
      <main className="shell centered">
        <section className="entry">
          <h1>Egicide</h1>
          <label>
            昵称
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="entryActions">
            <button onClick={createRoom}>创建房间</button>
            <input placeholder="房间码" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
            <button onClick={joinRoom}>加入</button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  const isMyTurn = view.currentPlayerId === view.selfId;
  const isDefending = view.defendingPlayerId === view.selfId;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <strong>房间 {view.roomCode}</strong>
          <span>{phaseText(view)}</span>
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
          <div className="players">
            {view.players.map((player) => (
              <div className={player.id === view.selfId ? "player self" : "player"} key={player.id}>
                <span>{player.name}{player.id === view.selfId ? "（你）" : ""}</span>
                <span>{player.handCount} 张 {player.connected ? "" : "离线"}</span>
              </div>
            ))}
          </div>
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
            {view.phase === "lobby" && view.players.length === 2 && <button onClick={startGame}>开始游戏</button>}
            {view.phase === "playerAction" && isMyTurn && (
              <>
                <button disabled={!selected.length} onClick={playSelected}>出牌</button>
                <button className="secondary" onClick={skipTurn}>不出</button>
              </>
            )}
            {view.phase === "defense" && isDefending && <button disabled={!selected.length} onClick={defendSelected}>弃牌防御</button>}
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

      <section className="log">
        <h2>日志</h2>
        {view.log.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
      </section>
    </main>
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

function phaseText(view: PlayerView): string {
  if (view.phase === "lobby") return view.players.length < 2 ? "等待玩家加入" : "可以开始";
  if (view.phase === "won") return "挑战成功";
  if (view.phase === "lost") return "挑战失败";
  if (view.phase === "defense") return view.defendingPlayerId === view.selfId ? "你需要弃牌防御" : "等待队友防御";
  return view.currentPlayerId === view.selfId ? "轮到你行动" : "等待队友行动";
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

function cardName(card: Card): string {
  return `${suitSymbol[card.suit]}${card.rank}`;
}

createRoot(document.getElementById("root")!).render(<App />);
