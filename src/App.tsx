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

interface SunkShipPopupState {
  active: boolean;
  shipName: string;
  side: 'player' | 'ai';
}

interface TargetLockState {
  active: boolean;
  x: number;
  y: number;
}

interface RadarSweepState {
  active: boolean;
}

interface CaptainAnnouncementState {
  active: boolean;
  text: string;
  type: 'confirm' | 'destroyed' | 'miss';
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
  const impactFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingShotRef = useRef<(() => void) | null>(null);

  // Banner state for "DIRECT HIT!" and "Ship Destroyed!"
  const [banner, setBanner] = useState<BannerState>({ active: false, text: '', type: 'hit' });
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Explosion state (pre-computed pixel position)
  const [explosion, setExplosion] = useState<ExplosionState>({ active: false, x: 0, y: 0 });
  const explosionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Vader popup state (shown when AI sinks 4/5 player ships)
  const [vaderPopup, setVaderPopup] = useState(false);
  const vaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sunk ship popup state (unique image per ship type)
  const [sunkShipPopup, setSunkShipPopup] = useState<SunkShipPopupState>({ active: false, shipName: '', side: 'player' });
  const sunkShipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Target lock reticle state
  const [targetLock, setTargetLock] = useState<TargetLockState>({ active: false, x: 0, y: 0 });
  const targetLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Radar sweep state (shown during AI turn)
  const [radarSweep, setRadarSweep] = useState<RadarSweepState>({ active: false });
  const radarSweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Screen shake state
  const [screenShake, setScreenShake] = useState(false);
  const screenShakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Captain announcement state
  const [captainAnnouncement, setCaptainAnnouncement] = useState<CaptainAnnouncementState>({ active: false, text: '', type: 'confirm' });
  const captainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Show sunk ship popup with unique image per ship type
  const showSunkShipImage = useCallback((shipName: string, side: 'player' | 'ai') => {
    if (sunkShipTimerRef.current) clearTimeout(sunkShipTimerRef.current);
    setSunkShipPopup({ active: true, shipName, side });
    sunkShipTimerRef.current = setTimeout(() => {
      setSunkShipPopup({ active: false, shipName: '', side: 'player' });
    }, 2500);
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

  // Show target lock reticle at a cell
  const showTargetLock = useCallback((row: number, col: number, isEnemyBoard: boolean) => {
    if (targetLockTimerRef.current) clearTimeout(targetLockTimerRef.current);
    const pos = getCellPosition(row, col, isEnemyBoard);
    setTargetLock({ active: true, x: pos.x, y: pos.y });
    targetLockTimerRef.current = setTimeout(() => {
      setTargetLock({ active: false, x: 0, y: 0 });
    }, 300);
  }, [getCellPosition]);

  // Show radar sweep over player board during AI turn
  const showRadarSweep = useCallback(() => {
    if (radarSweepTimerRef.current) clearTimeout(radarSweepTimerRef.current);
    setRadarSweep({ active: true });
    radarSweepTimerRef.current = setTimeout(() => {
      setRadarSweep({ active: false });
    }, 600);
  }, []);

  // Trigger screen shake
  const triggerScreenShake = useCallback(() => {
    if (screenShakeTimerRef.current) clearTimeout(screenShakeTimerRef.current);
    setScreenShake(true);
    screenShakeTimerRef.current = setTimeout(() => {
      setScreenShake(false);
    }, 500);
  }, []);

  // Show captain announcement
  const showCaptainAnnouncement = useCallback((text: string, type: 'confirm' | 'destroyed' | 'miss') => {
    if (captainTimerRef.current) clearTimeout(captainTimerRef.current);
    setCaptainAnnouncement({ active: true, text, type });
    captainTimerRef.current = setTimeout(() => {
      setCaptainAnnouncement({ active: false, text: '', type: 'confirm' });
    }, 1200);
  }, []);

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
        triggerScreenShake();
        showCaptainAnnouncement('Enemy ship destroyed!', 'destroyed');
        if (result.shipName) showSunkShipImage(result.shipName, 'ai');
      } else if (result.result === 'hit') {
        addMessage(`Player fired at ${coordLabel}: Hit on ${result.shipName}!`, 'hit');
        showBanner('DIRECT HIT!', 'hit');
        showExplosion(target.row, target.col, false);
        showCaptainAnnouncement('Target confirmed!', 'confirm');
      } else {
        addMessage(`Player fired at ${coordLabel}: Miss.`, 'miss');
        showSplash(target.row, target.col, false);
        showCaptainAnnouncement('Shot missed!', 'miss');
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
        triggerScreenShake();
        showCaptainAnnouncement('Our ship is going down!', 'destroyed');
        if (result.shipName) showSunkShipImage(result.shipName, 'player');

        // Check if AI has sunk 4 out of 5 player ships — trigger Vader popup
        const sunkCount = result.ships.filter((s) => s.hits.every((h) => h)).length;
        if (sunkCount === 4) {
          if (vaderTimerRef.current) clearTimeout(vaderTimerRef.current);
          setVaderPopup(true);
          vaderTimerRef.current = setTimeout(() => {
            setVaderPopup(false);
          }, 3500);
        }
      } else if (result.result === 'hit') {
        addMessage(`AI fired at ${coordLabel}: Hit on your ${result.shipName}!`, 'hit');
        showBanner('DIRECT HIT!', 'hit');
        showExplosion(target.row, target.col, true);
        showCaptainAnnouncement('We\'ve been hit!', 'confirm');
      } else {
        addMessage(`AI fired at ${coordLabel}: Miss.`, 'miss');
        showSplash(target.row, target.col, true);
        showCaptainAnnouncement('They missed!', 'miss');
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
  }, [addMessage, showBanner, showExplosion, showSplash, showSunkShipImage, triggerScreenShake, showCaptainAnnouncement]);

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

    // Show radar sweep for AI turn, target lock for player turn
    if (who === 'ai') {
      showRadarSweep();
    }
    // Show target lock reticle on the target cell
    showTargetLock(target.row, target.col, isEnemyBoard);

    // Launch projectile toward target cell (after brief target lock delay)
    const lockDelay = 150; // half of 300ms lock duration
    lockDelayTimerRef.current = setTimeout(() => {
      // Guard: don't fire if sim was paused/stopped during the lock delay
      if (!simRef.current.running) return;

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
        // Clear projectile after a brief impact flash (separate ref to avoid cleanup conflicts)
        if (impactFlashTimerRef.current) clearTimeout(impactFlashTimerRef.current);
        impactFlashTimerRef.current = setTimeout(() => {
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
    }, lockDelay);
  }, [applyShot, getCellPosition, showTargetLock, showRadarSweep]);

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
      if (lockDelayTimerRef.current) {
        clearTimeout(lockDelayTimerRef.current);
        lockDelayTimerRef.current = null;
      }
      if (projectileTimerRef.current) {
        clearTimeout(projectileTimerRef.current);
        projectileTimerRef.current = null;
      }
      if (impactFlashTimerRef.current) {
        clearTimeout(impactFlashTimerRef.current);
        impactFlashTimerRef.current = null;
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

      // Show radar sweep before AI fires in manual mode
      showRadarSweep();

      if (result.result === 'sunk') {
        addMessage(
          `AI fired at ${coordLabel}: Hit and sunk your ${result.shipName}!`,
          'sunk'
        );
        showBanner('SHIP DESTROYED!', 'sunk');
        showExplosion(target.row, target.col, true);
        triggerScreenShake();
        showCaptainAnnouncement('Our ship is going down!', 'destroyed');
        if (result.shipName) showSunkShipImage(result.shipName, 'player');

        // Check if AI has sunk 4 out of 5 player ships — trigger Vader popup
        const sunkCount = result.ships.filter((s) => s.hits.every((h) => h)).length;
        if (sunkCount === 4) {
          if (vaderTimerRef.current) clearTimeout(vaderTimerRef.current);
          setVaderPopup(true);
          vaderTimerRef.current = setTimeout(() => {
            setVaderPopup(false);
          }, 3500);
        }
      } else if (result.result === 'hit') {
        addMessage(
          `AI fired at ${coordLabel}: Hit on your ${result.shipName}!`,
          'hit'
        );
        showBanner('DIRECT HIT!', 'hit');
        showExplosion(target.row, target.col, true);
        showCaptainAnnouncement('We\'ve been hit!', 'confirm');
      } else {
        addMessage(`AI fired at ${coordLabel}: Miss.`, 'miss');
        showSplash(target.row, target.col, true);
        showCaptainAnnouncement('They missed!', 'miss');
      }

      if (allShipsSunk(result.ships)) {
        setPhase('gameOver');
        addMessage('The AI sunk all your ships! You lose.', 'win');
        return;
      }

      setTurn('player');
      isProcessingShot.current = false;
    },
    [addMessage, showBanner, showExplosion, showSplash, showSunkShipImage, showRadarSweep, triggerScreenShake, showCaptainAnnouncement]
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

      // Show target lock reticle on the clicked cell
      showTargetLock(row, col, true);

      if (result.result === 'sunk') {
        addMessage(
          `You fired at ${coordLabel}: Hit and sunk ${result.shipName}!`,
          'sunk'
        );
        showBanner('SHIP DESTROYED!', 'sunk');
        showExplosion(row, col, false);
        triggerScreenShake();
        showCaptainAnnouncement('Enemy ship destroyed!', 'destroyed');
        if (result.shipName) showSunkShipImage(result.shipName, 'ai');
      } else if (result.result === 'hit') {
        addMessage(
          `You fired at ${coordLabel}: Hit on ${result.shipName}!`,
          'hit'
        );
        showBanner('DIRECT HIT!', 'hit');
        showExplosion(row, col, false);
        showCaptainAnnouncement('Target confirmed!', 'confirm');
      } else {
        addMessage(`You fired at ${coordLabel}: Miss.`, 'miss');
        showSplash(row, col, false);
        showCaptainAnnouncement('Shot missed!', 'miss');
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
    [phase, turn, aiBoard, aiShips, aiState, playerBoard, playerShips, addMessage, doAITurn, sim.running, showBanner, showExplosion, showSplash, showSunkShipImage, showTargetLock, triggerScreenShake, showCaptainAnnouncement]
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
    setVaderPopup(false);
    setSunkShipPopup({ active: false, shipName: '', side: 'player' });
    setTargetLock({ active: false, x: 0, y: 0 });
    setRadarSweep({ active: false });
    setScreenShake(false);
    setCaptainAnnouncement({ active: false, text: '', type: 'confirm' });

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
    setVaderPopup(false);
    setSunkShipPopup({ active: false, shipName: '', side: 'player' });
    setTargetLock({ active: false, x: 0, y: 0 });
    setRadarSweep({ active: false });
    setScreenShake(false);
    setCaptainAnnouncement({ active: false, text: '', type: 'confirm' });
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
      // Sunk cells get wreck marker class for burning debris effect
      if (cellState === 'sunk') className += ' sunk wreck';
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
    if (cellState === 'sunk') className += ' sunk wreck';
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

  // Score tracker
  const playerSunk = aiShips.filter((s) => s.hits.every((h) => h)).length;
  const aiSunk = playerShips.filter((s) => s.hits.every((h) => h)).length;

  // Render inline SVG for each sinking ship type
  const renderSunkShipSVG = (shipName: string) => {
    switch (shipName) {
      case 'Carrier':
        return (
          <svg viewBox="0 0 320 120" xmlns="http://www.w3.org/2000/svg" className="sunk-ship-svg">
            {/* Large aircraft carrier sinking at an angle */}
            <defs>
              <linearGradient id="carrierGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#556" />
                <stop offset="100%" stopColor="#334" />
              </linearGradient>
            </defs>
            <g transform="rotate(12, 160, 60)">
              {/* Hull */}
              <path d="M20,70 L40,50 L280,50 L300,60 L300,80 L280,90 L40,90 L20,80 Z" fill="url(#carrierGrad)" stroke="#778" strokeWidth="1.5" />
              {/* Flight deck */}
              <rect x="50" y="45" width="220" height="8" rx="2" fill="#667" stroke="#889" strokeWidth="0.5" />
              {/* Island superstructure */}
              <rect x="190" y="28" width="35" height="22" rx="2" fill="#445" stroke="#667" strokeWidth="1" />
              <rect x="200" y="18" width="15" height="12" rx="1" fill="#556" stroke="#778" strokeWidth="0.5" />
              {/* Antenna mast */}
              <line x1="207" y1="18" x2="207" y2="5" stroke="#aab" strokeWidth="1.5" />
              <line x1="202" y1="10" x2="212" y2="10" stroke="#aab" strokeWidth="0.5" />
              {/* Aircraft on deck */}
              <rect x="70" y="46" width="12" height="5" rx="1" fill="#889" />
              <rect x="100" y="46" width="12" height="5" rx="1" fill="#889" />
              <rect x="130" y="46" width="12" height="5" rx="1" fill="#889" />
              {/* Water line & waves */}
              <path d="M10,85 Q30,78 50,85 Q70,92 90,85 Q110,78 130,85 Q150,92 170,85 Q190,78 210,85 Q230,92 250,85 Q270,78 290,85 Q310,92 320,85" fill="none" stroke="#4af" strokeWidth="2" opacity="0.6" />
              {/* Sinking water splash */}
              <ellipse cx="280" cy="88" rx="25" ry="8" fill="rgba(100,180,255,0.3)" />
            </g>
          </svg>
        );
      case 'Battleship':
        return (
          <svg viewBox="0 0 300 120" xmlns="http://www.w3.org/2000/svg" className="sunk-ship-svg">
            {/* Heavy battleship with guns sinking stern-first */}
            <defs>
              <linearGradient id="battleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#5a5a6a" />
                <stop offset="100%" stopColor="#3a3a4a" />
              </linearGradient>
            </defs>
            <g transform="rotate(8, 150, 60)">
              {/* Hull */}
              <path d="M30,65 L50,50 L250,50 L270,60 L270,78 L250,88 L50,88 L30,78 Z" fill="url(#battleGrad)" stroke="#7a7a8a" strokeWidth="1.5" />
              {/* Superstructure */}
              <rect x="120" y="30" width="60" height="22" rx="3" fill="#4a4a5a" stroke="#6a6a7a" strokeWidth="1" />
              <rect x="135" y="18" width="30" height="14" rx="2" fill="#555565" stroke="#777787" strokeWidth="0.5" />
              {/* Main gun turrets (fore and aft) */}
              <circle cx="80" cy="55" r="10" fill="#4a4a5a" stroke="#6a6a7a" strokeWidth="1" />
              <rect x="70" y="52" width="30" height="6" rx="2" fill="#555" />
              <circle cx="220" cy="55" r="10" fill="#4a4a5a" stroke="#6a6a7a" strokeWidth="1" />
              <rect x="210" y="52" width="30" height="6" rx="2" fill="#555" />
              {/* Funnel */}
              <rect x="155" y="22" width="12" height="10" rx="1" fill="#3a3a4a" stroke="#5a5a6a" strokeWidth="0.5" />
              {/* Mast */}
              <line x1="150" y1="18" x2="150" y2="2" stroke="#aab" strokeWidth="1.5" />
              {/* Water */}
              <path d="M20,82 Q40,75 60,82 Q80,89 100,82 Q120,75 140,82 Q160,89 180,82 Q200,75 220,82 Q240,89 260,82 Q280,75 290,82" fill="none" stroke="#4af" strokeWidth="2" opacity="0.6" />
              <ellipse cx="255" cy="85" rx="20" ry="6" fill="rgba(100,180,255,0.3)" />
            </g>
          </svg>
        );
      case 'Cruiser':
        return (
          <svg viewBox="0 0 280 120" xmlns="http://www.w3.org/2000/svg" className="sunk-ship-svg">
            {/* Sleek cruiser listing to one side */}
            <defs>
              <linearGradient id="cruiserGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#5c6370" />
                <stop offset="100%" stopColor="#3c4350" />
              </linearGradient>
            </defs>
            <g transform="rotate(-10, 140, 60)">
              {/* Hull - sleeker profile */}
              <path d="M25,62 L55,48 L225,48 L255,58 L255,72 L225,82 L55,82 L25,72 Z" fill="url(#cruiserGrad)" stroke="#7c8390" strokeWidth="1.5" />
              {/* Bridge */}
              <rect x="110" y="30" width="40" height="20" rx="3" fill="#4c5360" stroke="#6c7380" strokeWidth="1" />
              <rect x="120" y="22" width="20" height="10" rx="2" fill="#5c6370" />
              {/* Gun turret fore */}
              <circle cx="75" cy="52" r="7" fill="#4c5360" stroke="#6c7380" strokeWidth="1" />
              <rect x="68" y="49" width="22" height="5" rx="1.5" fill="#555" />
              {/* Gun turret aft */}
              <circle cx="200" cy="52" r="7" fill="#4c5360" stroke="#6c7380" strokeWidth="1" />
              <rect x="193" y="49" width="22" height="5" rx="1.5" fill="#555" />
              {/* Mast */}
              <line x1="130" y1="22" x2="130" y2="8" stroke="#aab" strokeWidth="1" />
              {/* Water */}
              <path d="M15,76 Q35,69 55,76 Q75,83 95,76 Q115,69 135,76 Q155,83 175,76 Q195,69 215,76 Q235,83 255,76 Q265,69 275,76" fill="none" stroke="#4af" strokeWidth="2" opacity="0.6" />
              <ellipse cx="40" cy="74" rx="18" ry="5" fill="rgba(100,180,255,0.3)" />
            </g>
          </svg>
        );
      case 'Submarine':
        return (
          <svg viewBox="0 0 280 120" xmlns="http://www.w3.org/2000/svg" className="sunk-ship-svg">
            {/* Submarine diving/sinking beneath waves */}
            <defs>
              <linearGradient id="subGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#445" />
                <stop offset="100%" stopColor="#223" />
              </linearGradient>
            </defs>
            {/* Water surface */}
            <path d="M0,50 Q20,43 40,50 Q60,57 80,50 Q100,43 120,50 Q140,57 160,50 Q180,43 200,50 Q220,57 240,50 Q260,43 280,50" fill="none" stroke="#4af" strokeWidth="2.5" opacity="0.7" />
            <rect x="0" y="50" width="280" height="70" fill="rgba(20,60,120,0.25)" />
            <g transform="rotate(15, 140, 70)">
              {/* Submarine hull (cigar shape) */}
              <ellipse cx="140" cy="70" rx="100" ry="18" fill="url(#subGrad)" stroke="#667" strokeWidth="1.5" />
              {/* Conning tower */}
              <rect x="125" y="48" width="30" height="14" rx="4" fill="#334" stroke="#556" strokeWidth="1" />
              {/* Periscope */}
              <line x1="140" y1="48" x2="140" y2="32" stroke="#889" strokeWidth="2" />
              <rect x="137" y="30" width="6" height="4" rx="1" fill="#778" />
              {/* Propeller */}
              <circle cx="242" cy="70" r="4" fill="#556" />
              <line x1="242" y1="62" x2="242" y2="78" stroke="#778" strokeWidth="1.5" />
              <line x1="234" y1="66" x2="250" y2="74" stroke="#778" strokeWidth="1.5" />
              {/* Dive planes */}
              <rect x="55" y="64" width="15" height="3" rx="1" fill="#556" transform="rotate(-10,62,65)" />
              <rect x="55" y="74" width="15" height="3" rx="1" fill="#556" transform="rotate(10,62,75)" />
              {/* Bubbles rising */}
              <circle cx="120" cy="45" r="3" fill="rgba(150,200,255,0.4)" />
              <circle cx="130" cy="38" r="2" fill="rgba(150,200,255,0.3)" />
              <circle cx="145" cy="42" r="2.5" fill="rgba(150,200,255,0.35)" />
              <circle cx="155" cy="35" r="1.5" fill="rgba(150,200,255,0.25)" />
            </g>
          </svg>
        );
      case 'Destroyer':
        return (
          <svg viewBox="0 0 260 120" xmlns="http://www.w3.org/2000/svg" className="sunk-ship-svg">
            {/* Fast destroyer breaking apart */}
            <defs>
              <linearGradient id="destroyerGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#606878" />
                <stop offset="100%" stopColor="#404858" />
              </linearGradient>
            </defs>
            <g transform="rotate(-6, 130, 60)">
              {/* Lean, fast hull */}
              <path d="M20,60 L50,46 L210,46 L240,55 L240,68 L210,78 L50,78 L20,68 Z" fill="url(#destroyerGrad)" stroke="#808898" strokeWidth="1.5" />
              {/* Small bridge */}
              <rect x="100" y="30" width="30" height="18" rx="2" fill="#505868" stroke="#707888" strokeWidth="1" />
              <rect x="108" y="24" width="14" height="8" rx="1" fill="#606878" />
              {/* Single gun fore */}
              <circle cx="65" cy="50" r="6" fill="#505868" stroke="#707888" strokeWidth="1" />
              <rect x="58" y="47" width="18" height="4" rx="1" fill="#555" />
              {/* Torpedo tubes midship */}
              <rect x="150" y="50" width="20" height="6" rx="2" fill="#505868" stroke="#707" strokeWidth="0.5" />
              <rect x="155" y="51" width="3" height="4" rx="0.5" fill="#333" />
              <rect x="160" y="51" width="3" height="4" rx="0.5" fill="#333" />
              <rect x="165" y="51" width="3" height="4" rx="0.5" fill="#333" />
              {/* Depth charge rack aft */}
              <rect x="200" y="52" width="12" height="5" rx="1" fill="#454d5d" />
              <circle cx="203" cy="54" r="2" fill="#333" />
              <circle cx="209" cy="54" r="2" fill="#333" />
              {/* Mast */}
              <line x1="115" y1="24" x2="115" y2="10" stroke="#aab" strokeWidth="1" />
              {/* Water */}
              <path d="M10,72 Q30,65 50,72 Q70,79 90,72 Q110,65 130,72 Q150,79 170,72 Q190,65 210,72 Q230,79 250,72" fill="none" stroke="#4af" strokeWidth="2" opacity="0.6" />
              {/* Smoke/fire from damage */}
              <ellipse cx="180" cy="38" rx="12" ry="8" fill="rgba(80,80,80,0.4)" />
              <ellipse cx="185" cy="30" rx="8" ry="6" fill="rgba(60,60,60,0.3)" />
              <ellipse cx="175" cy="42" rx="5" ry="4" fill="rgba(255,120,30,0.3)" />
            </g>
          </svg>
        );
      default:
        return null;
    }
  };

  // Render the scoreboard showing remaining ships for each side
  const renderScoreboard = () => {
    const playerShipStatus = SHIP_CONFIGS.map((config) => {
      const ship = playerShips.find((s) => s.name === config.name);
      const isSunk = ship ? ship.hits.every((h) => h) : false;
      return { name: config.name, size: config.size, sunk: isSunk };
    });
    const aiShipStatus = SHIP_CONFIGS.map((config) => {
      const ship = aiShips.find((s) => s.name === config.name);
      const isSunk = ship ? ship.hits.every((h) => h) : false;
      return { name: config.name, size: config.size, sunk: isSunk };
    });
    const playerRemaining = playerShipStatus.filter((s) => !s.sunk).length;
    const aiRemaining = aiShipStatus.filter((s) => !s.sunk).length;

    return (
      <div className="fleet-scoreboard">
        <div className="fleet-scoreboard-side player-side">
          <div className="fleet-scoreboard-header">
            <span className="fleet-side-label">YOUR FLEET</span>
            <span className="fleet-remaining">{playerRemaining}/5 Active</span>
          </div>
          <div className="fleet-ship-icons">
            {playerShipStatus.map((s) => (
              <div key={s.name} className={`fleet-ship-icon ${s.sunk ? 'sunk' : 'active'}`} title={s.name}>
                <div className="fleet-ship-bar" style={{ width: `${s.size * 14}px` }} />
                <span className="fleet-ship-name">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="fleet-scoreboard-divider">
          <div className="fleet-score-circle player-circle">{playerSunk}</div>
          <span className="fleet-vs">vs</span>
          <div className="fleet-score-circle ai-circle">{aiSunk}</div>
        </div>
        <div className="fleet-scoreboard-side ai-side">
          <div className="fleet-scoreboard-header">
            <span className="fleet-side-label">ENEMY FLEET</span>
            <span className="fleet-remaining">{aiRemaining}/5 Active</span>
          </div>
          <div className="fleet-ship-icons">
            {aiShipStatus.map((s) => (
              <div key={s.name} className={`fleet-ship-icon ${s.sunk ? 'sunk' : 'active'}`} title={s.name}>
                <div className="fleet-ship-bar" style={{ width: `${s.size * 14}px` }} />
                <span className="fleet-ship-name">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`game-container${screenShake ? ' screen-shake' : ''}`}>
      <h1 className="game-title">Battleship</h1>
      <p className="game-subtitle">Auto Battle Simulator</p>

      <div className={getStatusClass()}>{getStatusText()}</div>

      {/* Fleet scoreboard during play */}
      {phase !== 'placement' && renderScoreboard()}

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

      {/* Captain announcement near top of screen */}
      {captainAnnouncement.active && (
        <div className={`captain-announcement captain-${captainAnnouncement.type}`} key={captainAnnouncement.text}>
          {captainAnnouncement.text}
        </div>
      )}

      <div className="boards-container" ref={boardsContainerRef}>
        {renderBoard(playerBoard, true, phase === 'placement' ? 'Place Your Ships' : 'Your Ocean')}
        {/* Radar sweep overlay on player board during AI turn */}
        {radarSweep.active && (
          <div className="radar-sweep-container">
            <div className="radar-sweep-line" />
          </div>
        )}
        {phase !== 'placement' && (
          <>
            {/* Target lock reticle overlay */}
            {targetLock.active && (
              <div
                className="target-lock-overlay"
                style={{
                  left: `${targetLock.x}px`,
                  top: `${targetLock.y}px`,
                }}
              >
                <div className="target-lock-reticle" />
              </div>
            )}

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

      {/* Sunk ship popup with unique image per ship type */}
      {sunkShipPopup.active && (
        <div className="sunk-ship-overlay" key={`${sunkShipPopup.shipName}-${sunkShipPopup.side}`}>
          <div className="sunk-ship-content">
            {renderSunkShipSVG(sunkShipPopup.shipName)}
            <div className={`sunk-ship-banner ${sunkShipPopup.side === 'player' ? 'enemy-sunk' : 'player-sunk'}`}>
              {sunkShipPopup.side === 'player'
                ? `YOUR ${sunkShipPopup.shipName.toUpperCase()} HAS BEEN SUNK!`
                : `ENEMY ${sunkShipPopup.shipName.toUpperCase()} DESTROYED!`}
            </div>
          </div>
        </div>
      )}

      {/* Darth Vader "I HAVE YOU NOW!" popup when AI sinks 4/5 player ships */}
      {vaderPopup && (
        <div className="vader-overlay">
          <div className="vader-content">
            <svg className="vader-tie-fighter" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg">
              {/* Darth Vader helmet portrait */}
              <defs>
                <radialGradient id="vaderHelmetGrad" cx="50%" cy="40%" r="50%">
                  <stop offset="0%" stopColor="#444" />
                  <stop offset="100%" stopColor="#111" />
                </radialGradient>
                <radialGradient id="vaderFaceGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#333" />
                  <stop offset="100%" stopColor="#0a0a0a" />
                </radialGradient>
              </defs>
              <g>
                {/* Helmet dome */}
                <ellipse cx="100" cy="60" rx="72" ry="55" fill="url(#vaderHelmetGrad)" stroke="#555" strokeWidth="1.5" />
                {/* Helmet ridge line */}
                <path d="M100,8 L100,90" stroke="#555" strokeWidth="2" fill="none" />
                {/* Helmet side ridges */}
                <path d="M55,30 Q70,25 85,30" stroke="#555" strokeWidth="1" fill="none" />
                <path d="M115,30 Q130,25 145,30" stroke="#555" strokeWidth="1" fill="none" />
                {/* Face plate / mask */}
                <path d="M40,75 Q42,55 60,50 L80,48 Q100,46 120,48 L140,50 Q158,55 160,75 L155,130 Q150,155 140,165 L120,178 Q100,185 80,178 L60,165 Q50,155 45,130 Z" fill="url(#vaderFaceGrad)" stroke="#444" strokeWidth="1.5" />
                {/* Eye lenses - triangular */}
                <path d="M62,82 L88,75 L88,95 Z" fill="#111" stroke="#c00" strokeWidth="1.5" />
                <path d="M138,82 L112,75 L112,95 Z" fill="#111" stroke="#c00" strokeWidth="1.5" />
                {/* Eye lens inner glow */}
                <path d="M68,83 L85,78 L85,92 Z" fill="none" stroke="#ff2222" strokeWidth="0.5" opacity="0.6" />
                <path d="M132,83 L115,78 L115,92 Z" fill="none" stroke="#ff2222" strokeWidth="0.5" opacity="0.6" />
                {/* Nose ridge */}
                <path d="M95,95 L100,115 L105,95" fill="none" stroke="#555" strokeWidth="1.5" />
                {/* Mouth grille */}
                <path d="M72,125 Q86,118 100,118 Q114,118 128,125" fill="none" stroke="#444" strokeWidth="1" />
                <rect x="75" y="128" width="50" height="25" rx="4" fill="#0a0a0a" stroke="#444" strokeWidth="1" />
                {/* Grille lines */}
                <line x1="75" y1="133" x2="125" y2="133" stroke="#333" strokeWidth="0.8" />
                <line x1="75" y1="138" x2="125" y2="138" stroke="#333" strokeWidth="0.8" />
                <line x1="75" y1="143" x2="125" y2="143" stroke="#333" strokeWidth="0.8" />
                <line x1="75" y1="148" x2="125" y2="148" stroke="#333" strokeWidth="0.8" />
                {/* Grille vertical dividers */}
                <line x1="88" y1="128" x2="88" y2="153" stroke="#333" strokeWidth="0.5" />
                <line x1="100" y1="128" x2="100" y2="153" stroke="#333" strokeWidth="0.5" />
                <line x1="112" y1="128" x2="112" y2="153" stroke="#333" strokeWidth="0.5" />
                {/* Cheek details */}
                <path d="M50,100 Q55,90 60,85" stroke="#444" strokeWidth="1" fill="none" />
                <path d="M150,100 Q145,90 140,85" stroke="#444" strokeWidth="1" fill="none" />
                {/* Chin guard */}
                <path d="M70,160 Q85,175 100,178 Q115,175 130,160" fill="none" stroke="#444" strokeWidth="1.5" />
                {/* Neck / collar area */}
                <path d="M50,155 L40,185 Q45,200 65,210 L80,215 Q100,220 120,215 L135,210 Q155,200 160,185 L150,155" fill="#111" stroke="#333" strokeWidth="1" />
                {/* Collar details */}
                <path d="M55,185 Q100,195 145,185" fill="none" stroke="#333" strokeWidth="0.8" />
                {/* Chest plate top */}
                <rect x="80" y="205" width="40" height="20" rx="3" fill="#0a0a0a" stroke="#444" strokeWidth="1" />
                {/* Chest buttons */}
                <rect x="85" y="209" width="8" height="5" rx="1" fill="#c00" />
                <rect x="96" y="209" width="8" height="5" rx="1" fill="#09c" />
                <rect x="107" y="209" width="8" height="5" rx="1" fill="#888" />
                <rect x="85" y="217" width="8" height="5" rx="1" fill="#888" />
                <rect x="96" y="217" width="8" height="5" rx="1" fill="#c00" />
                <rect x="107" y="217" width="8" height="5" rx="1" fill="#09c" />
                {/* Helmet shine highlights */}
                <ellipse cx="80" cy="35" rx="15" ry="8" fill="rgba(255,255,255,0.06)" />
              </g>
            </svg>
            <div className="vader-quote">&ldquo;I HAVE YOU NOW!&rdquo;</div>
          </div>
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
