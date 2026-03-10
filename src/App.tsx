import { useState, useCallback, useRef, useEffect } from 'react';
import './App.css';
import type {
  Board,
  GamePhase,
  Ship,
  Orientation,
  Position,
  GameMessage,
} from './types';
import {
  BOARD_SIZE,
  SHIP_CONFIGS,
  ROW_LABELS,
  COL_LABELS,
} from './types';
import {
  createEmptyBoard,
  placeShip,
  canPlaceShip,
  processShot,
  allShipsSunk,
  getCoordinateLabel,
} from './gameLogic';
import type { AIState } from './ai';
import {
  placeShipsRandomly,
  createAIState,
  getAIShot,
  updateAIAfterShot,
} from './ai';

type SimTurn = 'player' | 'ai';

interface SimState {
  running: boolean;
  speed: number; // ms between shots
  turn: SimTurn;
  playerAI: AIState; // AI state for auto-playing the player side
}

interface ProjectileState {
  active: boolean;
  direction: 'left-to-right' | 'right-to-left'; // player fires right, AI fires left
  result: 'hit' | 'miss' | 'sunk' | null;
  targetRow: number;
  targetCol: number;
  startX: number; // px from left of boards-container
  startY: number; // px from top of boards-container
  endX: number;
  endY: number;
}

interface BannerState {
  active: boolean;
  text: string;
  type: 'hit' | 'sunk';
}

interface ExplosionState {
  active: boolean;
  x: number;
  y: number;
}

function App() {
  // Game phase
  const [phase, setPhase] = useState<GamePhase>('placement');
  const [turn, setTurn] = useState<SimTurn>('player');

  // Player state
  const [playerBoard, setPlayerBoard] = useState<Board>(createEmptyBoard());
  const [playerShips, setPlayerShips] = useState<Ship[]>([]);

  // AI state
  const [aiBoard, setAiBoard] = useState<Board>(createEmptyBoard());
  const [aiShips, setAiShips] = useState<Ship[]>([]);
  const [aiState, setAiState] = useState<AIState>(createAIState());

  // Placement state
  const [currentShipIndex, setCurrentShipIndex] = useState(0);
  const [orientation, setOrientation] = useState<Orientation>('horizontal');
  const [hoverPos, setHoverPos] = useState<Position | null>(null);

  // Shot processing lock to prevent rapid double-click race condition
  const isProcessingShot = useRef(false);

  // Auto-simulation state
  const [sim, setSim] = useState<SimState>({
    running: false,
    speed: 400,
    turn: 'player',
    playerAI: createAIState(),
  });
  const simRef = useRef(sim);
  const playerBoardRef = useRef(playerBoard);
  const playerShipsRef = useRef(playerShips);
  const aiBoardRef = useRef(aiBoard);
  const aiShipsRef = useRef(aiShips);
  const aiStateRef = useRef(aiState);
  const phaseRef = useRef(phase);

  // Keep refs in sync with latest state for use in simulation callbacks
  useEffect(() => {
    simRef.current = sim;
  }, [sim]);
  useEffect(() => {
    playerBoardRef.current = playerBoard;
  }, [playerBoard]);
  useEffect(() => {
    playerShipsRef.current = playerShips;
  }, [playerShips]);
  useEffect(() => {
    aiBoardRef.current = aiBoard;
  }, [aiBoard]);
  useEffect(() => {
    aiShipsRef.current = aiShips;
  }, [aiShips]);
  useEffect(() => {
    aiStateRef.current = aiState;
  }, [aiState]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Last shot highlight
  const [lastPlayerShot, setLastPlayerShot] = useState<Position | null>(null);
  const [lastAIShot, setLastAIShot] = useState<Position | null>(null);

  // Projectile animation state
  const [projectile, setProjectile] = useState<ProjectileState>({
    active: false,
    direction: 'left-to-right',
    result: null,
    targetRow: 0,
    targetCol: 0,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  });
  const projectileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingShotRef = useRef<(() => void) | null>(null);

  // Banner state for "DIRECT HIT!" and "Ship Destroyed!"
  const [banner, setBanner] = useState<BannerState>({ active: false, text: '', type: 'hit' });
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Explosion state (pre-computed pixel position)
  const [explosion, setExplosion] = useState<ExplosionState>({ active: false, x: 0, y: 0 });
  const explosionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Board grid refs for calculating projectile coordinates
  const playerGridRef = useRef<HTMLDivElement | null>(null);
  const enemyGridRef = useRef<HTMLDivElement | null>(null);
  const boardsContainerRef = useRef<HTMLDivElement | null>(null);

  // Messages
  const [messages, setMessages] = useState<GameMessage[]>([
    { text: 'Place your ships to begin!', type: 'info' },
  ]);

  const addMessage = useCallback((text: string, type: GameMessage['type']) => {
    setMessages((prev) => [{ text, type }, ...prev]);
  }, []);

  // Ship placement
  const currentShipConfig =
    currentShipIndex < SHIP_CONFIGS.length
      ? SHIP_CONFIGS[currentShipIndex]
      : null;

  const handlePlacementClick = useCallback(
    (row: number, col: number) => {
      if (!currentShipConfig) return;

      const result = placeShip(
        playerBoard,
        { row, col },
        currentShipConfig,
        orientation
      );

      if (result) {
        setPlayerBoard(result.board);
        setPlayerShips((prev) => [...prev, result.ship]);
        addMessage(
          `Placed ${currentShipConfig.name} at ${getCoordinateLabel({ row, col })}`,
          'info'
        );

        if (currentShipIndex + 1 >= SHIP_CONFIGS.length) {
          // All ships placed, start game
          const aiResult = placeShipsRandomly();
          setAiBoard(aiResult.board);
          setAiShips(aiResult.ships);
          setPhase('playing');
          setCurrentShipIndex(currentShipIndex + 1);
          addMessage('All ships placed! Battle begins! Your turn to fire.', 'info');
        } else {
          setCurrentShipIndex(currentShipIndex + 1);
        }
      }
    },
    [playerBoard, currentShipConfig, orientation, currentShipIndex, addMessage]
  );

  const handlePlacementHover = useCallback(
    (row: number, col: number) => {
      setHoverPos({ row, col });
    },
    []
  );

  const handlePlacementLeave = useCallback(() => {
    setHoverPos(null);
  }, []);

  const toggleOrientation = useCallback(() => {
    setOrientation((prev) =>
      prev === 'horizontal' ? 'vertical' : 'horizontal'
    );
  }, []);

  // Calculate pixel position of a cell relative to boards-container
  const getCellPosition = useCallback((row: number, col: number, isEnemyBoard: boolean): { x: number; y: number } => {
    const containerEl = boardsContainerRef.current;
    const gridEl = isEnemyBoard ? enemyGridRef.current : playerGridRef.current;
    if (!containerEl || !gridEl) return { x: 0, y: 0 };

    const containerRect = containerEl.getBoundingClientRect();
    const gridRect = gridEl.getBoundingClientRect();
    const cellX = gridRect.left - containerRect.left + 28 + 1 + col * 37 + 18;
    const cellY = gridRect.top - containerRect.top + 28 + 1 + row * 37 + 18;
    return { x: cellX, y: cellY };
  }, []);

  // Show a banner ("DIRECT HIT!" or "Ship Destroyed!")
  const showBanner = useCallback((text: string, type: 'hit' | 'sunk') => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    setBanner({ active: true, text, type });
    bannerTimerRef.current = setTimeout(() => {
      setBanner({ active: false, text: '', type: 'hit' });
    }, 1000);
  }, []);

  // Show explosion at a cell (pre-compute position to avoid ref access in render)
  const showExplosion = useCallback((row: number, col: number, isPlayerBoard: boolean) => {
    if (explosionTimerRef.current) clearTimeout(explosionTimerRef.current);
    const pos = getCellPosition(row, col, !isPlayerBoard);
    setExplosion({ active: true, x: pos.x, y: pos.y });
    explosionTimerRef.current = setTimeout(() => {
      setExplosion({ active: false, x: 0, y: 0 });
    }, 800);
  }, [getCellPosition]);

  // Show splash at a cell for misses (pre-compute position)
  const [splash, setSplash] = useState<ExplosionState>({ active: false, x: 0, y: 0 });
  const splashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSplash = useCallback((row: number, col: number, isPlayerBoard: boolean) => {
    if (splashTimerRef.current) clearTimeout(splashTimerRef.current);
    const pos = getCellPosition(row, col, !isPlayerBoard);
    setSplash({ active: true, x: pos.x, y: pos.y });
    splashTimerRef.current = setTimeout(() => {
      setSplash({ active: false, x: 0, y: 0 });
    }, 600);
  }, [getCellPosition]);

  // Apply the actual shot result (called after projectile animation completes)
  // target is pre-computed in doSimStep so projectile knows where to fly
  const applyShot = useCallback((who: 'player' | 'ai', target: Position) => {
    if (phaseRef.current !== 'playing') return;
    const currentSim = simRef.current;

    if (who === 'player') {
      const result = processShot(aiBoardRef.current, aiShipsRef.current, target);
      setAiBoard(result.board);
      setAiShips(result.ships);
      setLastPlayerShot(target);

      let sunkShipPositions: Position[] | undefined;
      if (result.result === 'sunk' && result.shipName) {
        const sunkShip = result.ships.find((s) => s.name === result.shipName);
        if (sunkShip) sunkShipPositions = sunkShip.positions;
      }
      const newPlayerAI = updateAIAfterShot(currentSim.playerAI, target, result.result, sunkShipPositions);

      const coordLabel = getCoordinateLabel(target);
      if (result.result === 'sunk') {
        addMessage(`Player fired at ${coordLabel}: Hit and sunk ${result.shipName}!`, 'sunk');
        showBanner('SHIP DESTROYED!', 'sunk');
        showExplosion(target.row, target.col, false);
      } else if (result.result === 'hit') {
        addMessage(`Player fired at ${coordLabel}: Hit on ${result.shipName}!`, 'hit');
        showBanner('DIRECT HIT!', 'hit');
        showExplosion(target.row, target.col, false);
      } else {
        addMessage(`Player fired at ${coordLabel}: Miss.`, 'miss');
        showSplash(target.row, target.col, false);
      }

      // Show impact result on projectile briefly
      setProjectile((prev) => ({ ...prev, result: result.result }));

      if (allShipsSunk(result.ships)) {
        setPhase('gameOver');
        addMessage('Player sunk all enemy ships! Player wins!', 'win');
        setSim((prev) => ({ ...prev, running: false, playerAI: newPlayerAI }));
        setProjectile((prev) => ({ ...prev, active: false, result: null }));
        return;
      }

      setTurn('ai');
      setSim((prev) => ({ ...prev, turn: 'ai', playerAI: newPlayerAI }));
    } else {
      const result = processShot(playerBoardRef.current, playerShipsRef.current, target);
      setPlayerBoard(result.board);
      setPlayerShips(result.ships);
      setLastAIShot(target);

      let sunkShipPositions: Position[] | undefined;
      if (result.result === 'sunk' && result.shipName) {
        const sunkShip = result.ships.find((s) => s.name === result.shipName);
        if (sunkShip) sunkShipPositions = sunkShip.positions;
      }
      const newAiState = updateAIAfterShot(aiStateRef.current, target, result.result, sunkShipPositions);
      setAiState(newAiState);

      const coordLabel = getCoordinateLabel(target);
      if (result.result === 'sunk') {
        addMessage(`AI fired at ${coordLabel}: Hit and sunk your ${result.shipName}!`, 'sunk');
        showBanner('SHIP DESTROYED!', 'sunk');
        showExplosion(target.row, target.col, true);
      } else if (result.result === 'hit') {
        addMessage(`AI fired at ${coordLabel}: Hit on your ${result.shipName}!`, 'hit');
        showBanner('DIRECT HIT!', 'hit');
        showExplosion(target.row, target.col, true);
      } else {
        addMessage(`AI fired at ${coordLabel}: Miss.`, 'miss');
        showSplash(target.row, target.col, true);
      }

      setProjectile((prev) => ({ ...prev, result: result.result }));

      if (allShipsSunk(result.ships)) {
        setPhase('gameOver');
        addMessage('AI sunk all your ships! AI wins!', 'win');
        setSim((prev) => ({ ...prev, running: false }));
        setProjectile((prev) => ({ ...prev, active: false, result: null }));
        return;
      }

      setTurn('player');
      setSim((prev) => ({ ...prev, turn: 'player' }));
    }
  }, [addMessage, showBanner, showExplosion, showSplash]);

  // Execute one simulation step: launch projectile, then apply shot on impact
  const doSimStep = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    const currentSim = simRef.current;
    const who = currentSim.turn;
    const direction = who === 'player' ? 'left-to-right' as const : 'right-to-left' as const;

    // Pre-compute the target so projectile knows where to fly
    const target = who === 'player'
      ? getAIShot(currentSim.playerAI)
      : getAIShot(aiStateRef.current);

    // Calculate start and end positions
    const isEnemyBoard = who === 'player'; // player fires at enemy board
    const startPos = getCellPosition(5, 5, !isEnemyBoard); // fire from center of own board
    const endPos = getCellPosition(target.row, target.col, isEnemyBoard);

    // Calculate projectile flight duration based on sim speed
    const flightDuration = Math.max(80, Math.min(400, currentSim.speed * 0.4));

    // Launch projectile toward target cell
    setProjectile({
      active: true,
      direction,
      result: null,
      targetRow: target.row,
      targetCol: target.col,
      startX: startPos.x,
      startY: startPos.y,
      endX: endPos.x,
      endY: endPos.y,
    });

    // Store the pending shot application with pre-computed target
    pendingShotRef.current = () => {
      applyShot(who, target);
      // Clear projectile after a brief impact flash
      projectileTimerRef.current = setTimeout(() => {
        setProjectile((prev) => ({ ...prev, active: false, result: null }));
      }, Math.max(50, flightDuration * 0.3));
    };

    // Apply shot after projectile reaches target
    projectileTimerRef.current = setTimeout(() => {
      if (pendingShotRef.current) {
        pendingShotRef.current();
        pendingShotRef.current = null;
      }
    }, flightDuration);
  }, [applyShot, getCellPosition]);

  // Simulation loop via useEffect
  const simTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sim.running && phase === 'playing') {
      simTimerRef.current = setTimeout(() => {
        doSimStep();
      }, sim.speed);
    }
    return () => {
      if (simTimerRef.current) {
        clearTimeout(simTimerRef.current);
        simTimerRef.current = null;
      }
      if (projectileTimerRef.current) {
        clearTimeout(projectileTimerRef.current);
        projectileTimerRef.current = null;
      }
    };
  }, [sim.running, sim.speed, sim.turn, phase, doSimStep, playerBoard, aiBoard, playerShips, aiShips, aiState]);

  // AI turn logic (for manual play)
  const doAITurn = useCallback(
    (currentAiState: AIState, currentPlayerBoard: Board, currentPlayerShips: Ship[]) => {
      const target = getAIShot(currentAiState);
      const result = processShot(currentPlayerBoard, currentPlayerShips, target);

      setPlayerBoard(result.board);
      setPlayerShips(result.ships);
      setLastAIShot(target);

      let sunkShipPositions: Position[] | undefined;
      if (result.result === 'sunk' && result.shipName) {
        const sunkShip = result.ships.find((s) => s.name === result.shipName);
        if (sunkShip) {
          sunkShipPositions = sunkShip.positions;
        }
      }

      const newAiState = updateAIAfterShot(currentAiState, target, result.result, sunkShipPositions);
      setAiState(newAiState);

      const coordLabel = getCoordinateLabel(target);

      if (result.result === 'sunk') {
        addMessage(
          `AI fired at ${coordLabel}: Hit and sunk your ${result.shipName}!`,
          'sunk'
        );
        showBanner('SHIP DESTROYED!', 'sunk');
        showExplosion(target.row, target.col, true);
      } else if (result.result === 'hit') {
        addMessage(
          `AI fired at ${coordLabel}: Hit on your ${result.shipName}!`,
          'hit'
        );
        showBanner('DIRECT HIT!', 'hit');
        showExplosion(target.row, target.col, true);
      } else {
        addMessage(`AI fired at ${coordLabel}: Miss.`, 'miss');
        showSplash(target.row, target.col, true);
      }

      if (allShipsSunk(result.ships)) {
        setPhase('gameOver');
        addMessage('The AI sunk all your ships! You lose.', 'win');
        return;
      }

      setTurn('player');
      isProcessingShot.current = false;
    },
    [addMessage, showBanner, showExplosion, showSplash]
  );

  // Player attack (manual mode)
  const handlePlayerAttack = useCallback(
    (row: number, col: number) => {
      if (sim.running) return; // Disable manual clicks during sim
      if (isProcessingShot.current) return;
      if (phase !== 'playing' || turn !== 'player') return;
      isProcessingShot.current = true;

      const cell = aiBoard[row][col];
      if (cell === 'hit' || cell === 'miss' || cell === 'sunk') {
        isProcessingShot.current = false;
        return;
      }

      const result = processShot(aiBoard, aiShips, { row, col });
      setAiBoard(result.board);
      setAiShips(result.ships);
      setLastPlayerShot({ row, col });

      const coordLabel = getCoordinateLabel({ row, col });

      if (result.result === 'sunk') {
        addMessage(
          `You fired at ${coordLabel}: Hit and sunk ${result.shipName}!`,
          'sunk'
        );
        showBanner('SHIP DESTROYED!', 'sunk');
        showExplosion(row, col, false);
      } else if (result.result === 'hit') {
        addMessage(
          `You fired at ${coordLabel}: Hit on ${result.shipName}!`,
          'hit'
        );
        showBanner('DIRECT HIT!', 'hit');
        showExplosion(row, col, false);
      } else {
        addMessage(`You fired at ${coordLabel}: Miss.`, 'miss');
        showSplash(row, col, false);
      }

      if (allShipsSunk(result.ships)) {
        setPhase('gameOver');
        addMessage('You sunk all enemy ships! You win!', 'win');
        isProcessingShot.current = false;
        return;
      }

      setTurn('ai');

      // AI takes its turn after a short delay
      setTimeout(() => {
        doAITurn(aiState, playerBoard, playerShips);
      }, 600);
    },
    [phase, turn, aiBoard, aiShips, aiState, playerBoard, playerShips, addMessage, doAITurn, sim.running, showBanner, showExplosion, showSplash]
  );

  // Auto-place ships and start auto-sim
  const startAutoSim = useCallback(() => {
    const playerResult = placeShipsRandomly();
    const aiResult = placeShipsRandomly();

    setPlayerBoard(playerResult.board);
    setPlayerShips(playerResult.ships);
    setAiBoard(aiResult.board);
    setAiShips(aiResult.ships);
    setAiState(createAIState());
    setPhase('playing');
    setTurn('player');
    setCurrentShipIndex(SHIP_CONFIGS.length);
    setLastPlayerShot(null);
    setLastAIShot(null);
    setMessages([{ text: 'Auto Battle started! Watch the action unfold.', type: 'info' }]);
    setProjectile({ active: false, direction: 'left-to-right', result: null, targetRow: 0, targetCol: 0, startX: 0, startY: 0, endX: 0, endY: 0 });
    setBanner({ active: false, text: '', type: 'hit' });
    setExplosion({ active: false, x: 0, y: 0 });
    setSplash({ active: false, x: 0, y: 0 });

    setSim({
      running: true,
      speed: 400,
      turn: 'player',
      playerAI: createAIState(),
    });
    isProcessingShot.current = false;
  }, []);

  // Toggle simulation pause/resume
  const toggleSim = useCallback(() => {
    setSim((prev) => ({ ...prev, running: !prev.running }));
  }, []);

  // Adjust sim speed
  const setSimSpeed = useCallback((speed: number) => {
    setSim((prev) => ({ ...prev, speed }));
  }, []);

  // Reset game
  const resetGame = useCallback(() => {
    setPhase('placement');
    setTurn('player');
    setPlayerBoard(createEmptyBoard());
    setPlayerShips([]);
    setAiBoard(createEmptyBoard());
    setAiShips([]);
    setAiState(createAIState());
    setCurrentShipIndex(0);
    setOrientation('horizontal');
    setHoverPos(null);
    setLastPlayerShot(null);
    setLastAIShot(null);
    setProjectile({ active: false, direction: 'left-to-right', result: null, targetRow: 0, targetCol: 0, startX: 0, startY: 0, endX: 0, endY: 0 });
    setBanner({ active: false, text: '', type: 'hit' });
    setExplosion({ active: false, x: 0, y: 0 });
    setSplash({ active: false, x: 0, y: 0 });
    setMessages([{ text: 'Place your ships to begin!', type: 'info' }]);
    setSim({
      running: false,
      speed: 400,
      turn: 'player',
      playerAI: createAIState(),
    });
    isProcessingShot.current = false;
  }, []);

  // Get preview cells for placement
  const getPreviewCells = useCallback((): {
    positions: Position[];
    valid: boolean;
  } => {
    if (!hoverPos || !currentShipConfig) return { positions: [], valid: false };

    const positions: Position[] = [];
    for (let i = 0; i < currentShipConfig.size; i++) {
      const row =
        orientation === 'vertical' ? hoverPos.row + i : hoverPos.row;
      const col =
        orientation === 'horizontal' ? hoverPos.col + i : hoverPos.col;
      positions.push({ row, col });
    }

    const valid = canPlaceShip(
      playerBoard,
      hoverPos,
      currentShipConfig.size,
      orientation
    );

    return { positions, valid };
  }, [hoverPos, currentShipConfig, orientation, playerBoard]);

  // Get status text
  const getStatusText = (): string => {
    if (phase === 'placement') {
      if (currentShipConfig) {
        return `Place your ${currentShipConfig.name} (${currentShipConfig.size} cells)`;
      }
      return 'Starting battle...';
    }
    if (phase === 'gameOver') {
      return allShipsSunk(aiShips) ? 'Victory! Player wins!' : 'Defeat! AI wins!';
    }
    if (sim.running) {
      return turn === 'player'
        ? 'AUTO BATTLE - Player firing...'
        : 'AUTO BATTLE - AI firing...';
    }
    return turn === 'player'
      ? 'Your turn - Click on the enemy grid to fire!'
      : 'AI is taking its shot...';
  };

  const getStatusClass = (): string => {
    if (phase === 'gameOver') return 'status-bar game-over';
    if (phase === 'placement') return 'status-bar';
    if (sim.running) return turn === 'player' ? 'status-bar auto-player' : 'status-bar auto-ai';
    return turn === 'player' ? 'status-bar your-turn' : 'status-bar ai-turn';
  };

  // Render a grid cell
  const renderCell = (
    board: Board,
    row: number,
    col: number,
    isPlayerBoard: boolean
  ) => {
    const cellState = board[row][col];
    let className = 'cell';

    // Determine if this is the last shot position (for highlight)
    const isLastShot = isPlayerBoard
      ? lastAIShot?.row === row && lastAIShot?.col === col
      : lastPlayerShot?.row === row && lastPlayerShot?.col === col;

    if (isPlayerBoard && phase === 'placement') {
      // Show ship preview
      const preview = getPreviewCells();
      const isPreview = preview.positions.some(
        (p) => p.row === row && p.col === col
      );

      if (isPreview) {
        className += preview.valid ? ' ship-preview' : ' ship-preview-invalid';
      } else if (cellState === 'ship') {
        className += ' ship';
      } else {
        className += ' water clickable';
      }

      return (
        <div
          key={`${row}-${col}`}
          className={className}
          onClick={() => handlePlacementClick(row, col)}
          onMouseEnter={() => handlePlacementHover(row, col)}
          onMouseLeave={handlePlacementLeave}
        />
      );
    }

    if (isPlayerBoard) {
      // Player's own board during gameplay - show ships and hits with silhouettes
      if (cellState === 'sunk') className += ' sunk';
      else if (cellState === 'hit') className += ' hit';
      else if (cellState === 'miss') className += ' miss';
      else if (cellState === 'ship') {
        className += ' ship';
        const shapeClass = getShipShapeClass(row, col, playerShips);
        if (shapeClass) className += ` ${shapeClass}`;
      } else className += ' water';

      if (isLastShot) className += ' last-shot';

      return <div key={`${row}-${col}`} className={className} />;
    }

    // AI board - hide ships, show hits/misses
    if (cellState === 'sunk') className += ' sunk';
    else if (cellState === 'hit') className += ' hit';
    else if (cellState === 'miss') className += ' miss';
    else {
      className += ' water';
      if (phase === 'playing' && turn === 'player' && !sim.running) {
        className += ' clickable';
      }
    }

    if (isLastShot) className += ' last-shot';

    const canClick =
      phase === 'playing' &&
      turn === 'player' &&
      !sim.running &&
      cellState !== 'hit' &&
      cellState !== 'miss' &&
      cellState !== 'sunk';

    return (
      <div
        key={`${row}-${col}`}
        className={className}
        onClick={canClick ? () => handlePlayerAttack(row, col) : undefined}
      />
    );
  };

  // Get ship shape CSS class for a cell position on player board
  const getShipShapeClass = (row: number, col: number, ships: Ship[]): string => {
    for (const ship of ships) {
      const posIndex = ship.positions.findIndex((p) => p.row === row && p.col === col);
      if (posIndex === -1) continue;
      const isHorizontal = ship.positions.length > 1 && ship.positions[0].row === ship.positions[1].row;
      const orient = isHorizontal ? 'h' : 'v';
      if (posIndex === 0) return `ship-piece ship-bow-${orient} ship-${ship.name.toLowerCase()}`;
      if (posIndex === ship.positions.length - 1) return `ship-piece ship-stern-${orient} ship-${ship.name.toLowerCase()}`;
      return `ship-piece ship-mid-${orient} ship-${ship.name.toLowerCase()}`;
    }
    return '';
  };

  // Render a complete board grid
  const renderBoard = (board: Board, isPlayerBoard: boolean, label: string) => (
    <div className="board-section">
      <div className="board-label">{label}</div>
      <div
        className="grid grid-10"
        ref={isPlayerBoard ? playerGridRef : enemyGridRef}
      >
        {/* Corner */}
        <div className="grid-corner grid-header" />
        {/* Column headers */}
        {COL_LABELS.map((c) => (
          <div key={`col-${c}`} className="grid-header">
            {c}
          </div>
        ))}
        {/* Rows */}
        {Array.from({ length: BOARD_SIZE }, (_, row) => (
          <div key={`row-${row}`} style={{ display: 'contents' }}>
            <div className="grid-header">
              {ROW_LABELS[row]}
            </div>
            {Array.from({ length: BOARD_SIZE }, (_, col) =>
              renderCell(board, row, col, isPlayerBoard)
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // Render ship legend
  const renderShipLegend = (ships: Ship[]) => (
    <div className="ship-legend">
      {SHIP_CONFIGS.map((config) => {
        const ship = ships.find((s) => s.name === config.name);
        const isSunk = ship ? ship.hits.every((h) => h) : false;
        const isPlaced = !!ship;

        return (
          <div key={config.name} className="ship-legend-item">
            <div className="ship-legend-blocks">
              {Array.from({ length: config.size }, (_, i) => (
                <div
                  key={i}
                  className={`ship-legend-block${isSunk ? ' sunk-block' : isPlaced ? ' placed' : ''}`}
                />
              ))}
            </div>
            <span style={{ textDecoration: isSunk ? 'line-through' : 'none' }}>
              {config.name}
            </span>
          </div>
        );
      })}
    </div>
  );

  // Score tracker
  const playerSunk = aiShips.filter((s) => s.hits.every((h) => h)).length;
  const aiSunk = playerShips.filter((s) => s.hits.every((h) => h)).length;

  return (
    <div className="game-container">
      <h1 className="game-title">Battleship</h1>
      <p className="game-subtitle">Auto Battle Simulator</p>

      <div className={getStatusClass()}>{getStatusText()}</div>

      {/* Score display during play */}
      {phase !== 'placement' && (
        <div className="score-display">
          <div className="score-item player-score">
            <span className="score-label">Player</span>
            <span className="score-value">{playerSunk}</span>
          </div>
          <div className="score-divider">vs</div>
          <div className="score-item ai-score">
            <span className="score-label">AI</span>
            <span className="score-value">{aiSunk}</span>
          </div>
        </div>
      )}

      {phase === 'placement' && currentShipConfig && (
        <div className="placement-controls">
          <div className="placement-info">
            Placing: <span className="ship-name">{currentShipConfig.name}</span>{' '}
            <span className="ship-size">({currentShipConfig.size} cells)</span>
            {' - '}
            <span className="ship-size">{orientation}</span>
          </div>
          <div className="placement-buttons">
            <button className="btn" onClick={toggleOrientation}>
              Rotate (R)
            </button>
            <button className="btn btn-auto" onClick={startAutoSim}>
              Auto Battle
            </button>
          </div>
        </div>
      )}

      {/* Auto-sim controls during gameplay */}
      {phase === 'playing' && (
        <div className="sim-controls">
          {!sim.running && (
            <button className="btn btn-auto" onClick={startAutoSim}>
              New Auto Battle
            </button>
          )}
          <button className="btn" onClick={toggleSim}>
            {sim.running ? 'Pause' : 'Resume Auto'}
          </button>
          <div className="speed-controls">
            <span className="speed-label">Speed:</span>
            <button
              className={`btn btn-sm${sim.speed === 800 ? ' btn-active' : ''}`}
              onClick={() => setSimSpeed(800)}
            >
              Slow
            </button>
            <button
              className={`btn btn-sm${sim.speed === 400 ? ' btn-active' : ''}`}
              onClick={() => setSimSpeed(400)}
            >
              Normal
            </button>
            <button
              className={`btn btn-sm${sim.speed === 150 ? ' btn-active' : ''}`}
              onClick={() => setSimSpeed(150)}
            >
              Fast
            </button>
            <button
              className={`btn btn-sm${sim.speed === 50 ? ' btn-active' : ''}`}
              onClick={() => setSimSpeed(50)}
            >
              Blitz
            </button>
          </div>
        </div>
      )}

      {phase !== 'placement' && (
        <>
          <div style={{ marginBottom: '0.25rem', color: '#667', fontSize: '0.8rem' }}>
            YOUR FLEET
          </div>
          {renderShipLegend(playerShips)}
          <div style={{ marginBottom: '0.25rem', color: '#667', fontSize: '0.8rem' }}>
            ENEMY FLEET
          </div>
          {renderShipLegend(aiShips)}
        </>
      )}

      <div className="boards-container" ref={boardsContainerRef}>
        {renderBoard(playerBoard, true, phase === 'placement' ? 'Place Your Ships' : 'Your Ocean')}
        {phase !== 'placement' && (
          <>
            {/* Targeted projectile animation overlay */}
            {projectile.active && (
              <div className="projectile-container">
                <div
                  className={`projectile-targeted ${projectile.result ? `impact-${projectile.result}` : ''}`}
                  style={{
                    '--start-x': `${projectile.startX}px`,
                    '--start-y': `${projectile.startY}px`,
                    '--end-x': `${projectile.endX}px`,
                    '--end-y': `${projectile.endY}px`,
                  } as React.CSSProperties}
                >
                  <div className="projectile-body" />
                  <div className={`projectile-trail ${projectile.direction}`} />
                </div>
              </div>
            )}

            {/* Explosion overlay */}
            {explosion.active && (
              <div
                className="explosion-overlay"
                style={{
                  left: `${explosion.x}px`,
                  top: `${explosion.y}px`,
                }}
              >
                <div className="explosion-ring explosion-ring-1" />
                <div className="explosion-ring explosion-ring-2" />
                <div className="explosion-ring explosion-ring-3" />
                <div className="explosion-core" />
              </div>
            )}

            {/* Water splash overlay for misses */}
            {splash.active && (
              <div
                className="splash-overlay"
                style={{
                  left: `${splash.x}px`,
                  top: `${splash.y}px`,
                }}
              >
                <div className="splash-ripple splash-ripple-1" />
                <div className="splash-ripple splash-ripple-2" />
                <div className="splash-ripple splash-ripple-3" />
                <div className="splash-drop splash-drop-1" />
                <div className="splash-drop splash-drop-2" />
                <div className="splash-drop splash-drop-3" />
                <div className="splash-drop splash-drop-4" />
              </div>
            )}

            {renderBoard(aiBoard, false, sim.running ? 'Enemy Waters' : 'Enemy Waters (Click to Fire)')}
          </>
        )}
      </div>

      {/* DIRECT HIT / SHIP DESTROYED banner */}
      {banner.active && (
        <div className={`battle-banner banner-${banner.type}`}>
          <div className="banner-text">{banner.text}</div>
        </div>
      )}

      {phase === 'gameOver' && (
        <div className="game-actions">
          <button className="btn btn-primary" onClick={resetGame}>
            Play Again
          </button>
          <button className="btn btn-auto" onClick={startAutoSim}>
            Auto Battle Again
          </button>
        </div>
      )}

      <div className="message-log">
        <div className="message-log-title">Battle Log</div>
        <div className="message-list">
          {messages.map((msg, i) => (
            <div key={i} className={`message-item ${msg.type}`}>
              {msg.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
