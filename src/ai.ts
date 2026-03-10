import type {
  Board,
  Orientation,
  Position,
  Ship,
  ShipConfig,
} from './types';
import { BOARD_SIZE, SHIP_CONFIGS } from './types';
import { canPlaceShip, placeShip, createEmptyBoard } from './gameLogic';

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

export function placeShipsRandomly(): { board: Board; ships: Ship[] } {
  let board = createEmptyBoard();
  const ships: Ship[] = [];

  for (const config of SHIP_CONFIGS) {
    let placed = false;
    let attempts = 0;

    while (!placed && attempts < 1000) {
      const orientation: Orientation =
        Math.random() < 0.5 ? 'horizontal' : 'vertical';
      const startPos: Position = {
        row: randomInt(BOARD_SIZE),
        col: randomInt(BOARD_SIZE),
      };

      const result = placeShip(board, startPos, config, orientation);
      if (result) {
        board = result.board;
        ships.push(result.ship);
        placed = true;
      }
      attempts++;
    }
  }

  return { board, ships };
}

export interface AIState {
  shotsTaken: boolean[][];
  hitQueue: Position[];
  lastHit: Position | null;
  huntDirection: 'up' | 'down' | 'left' | 'right' | null;
  firstHitInChain: Position | null;
}

export function createAIState(): AIState {
  return {
    shotsTaken: Array.from({ length: BOARD_SIZE }, () =>
      new Array(BOARD_SIZE).fill(false)
    ),
    hitQueue: [],
    lastHit: null,
    huntDirection: null,
    firstHitInChain: null,
  };
}

function getAdjacentCells(pos: Position): Position[] {
  const adjacent: Position[] = [];
  if (pos.row > 0) adjacent.push({ row: pos.row - 1, col: pos.col });
  if (pos.row < BOARD_SIZE - 1)
    adjacent.push({ row: pos.row + 1, col: pos.col });
  if (pos.col > 0) adjacent.push({ row: pos.row, col: pos.col - 1 });
  if (pos.col < BOARD_SIZE - 1)
    adjacent.push({ row: pos.row, col: pos.col + 1 });
  return adjacent;
}

export function getAIShot(aiState: AIState): Position {
  // Target mode: follow up on hits
  while (aiState.hitQueue.length > 0) {
    const target = aiState.hitQueue.shift()!;
    if (!aiState.shotsTaken[target.row][target.col]) {
      return target;
    }
  }

  // Hunt mode: use checkerboard pattern for efficiency
  const candidates: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!aiState.shotsTaken[row][col] && (row + col) % 2 === 0) {
        candidates.push({ row, col });
      }
    }
  }

  // If checkerboard is exhausted, try remaining cells
  if (candidates.length === 0) {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (!aiState.shotsTaken[row][col]) {
          candidates.push({ row, col });
        }
      }
    }
  }

  return candidates[randomInt(candidates.length)];
}

export function updateAIAfterShot(
  aiState: AIState,
  target: Position,
  result: 'hit' | 'miss' | 'sunk',
  sunkShipPositions?: Position[]
): AIState {
  const newState: AIState = {
    shotsTaken: aiState.shotsTaken.map((row) => [...row]),
    hitQueue: [...aiState.hitQueue],
    lastHit: aiState.lastHit,
    huntDirection: aiState.huntDirection,
    firstHitInChain: aiState.firstHitInChain,
  };

  newState.shotsTaken[target.row][target.col] = true;

  if (result === 'hit') {
    // Add adjacent unsearched cells to the hit queue
    const adjacent = getAdjacentCells(target);
    for (const cell of adjacent) {
      if (
        !newState.shotsTaken[cell.row][cell.col] &&
        !newState.hitQueue.some(
          (q) => q.row === cell.row && q.col === cell.col
        )
      ) {
        newState.hitQueue.push(cell);
      }
    }
    newState.lastHit = target;
    if (!newState.firstHitInChain) {
      newState.firstHitInChain = target;
    }
  } else if (result === 'sunk') {
    // Ship sunk - only remove hit queue entries that are adjacent to
    // the sunk ship's positions. Preserve entries from other hit chains.
    if (sunkShipPositions && sunkShipPositions.length > 0) {
      const sunkAdjacent = new Set<string>();
      for (const pos of sunkShipPositions) {
        for (const adj of getAdjacentCells(pos)) {
          sunkAdjacent.add(`${adj.row},${adj.col}`);
        }
      }
      newState.hitQueue = newState.hitQueue.filter(
        (q) => !sunkAdjacent.has(`${q.row},${q.col}`)
      );
    } else {
      // Fallback: clear entire queue if no positions provided
      newState.hitQueue = [];
    }

    // Reset direction tracking but keep lastHit if queue still has entries
    // (meaning there's another ship being tracked)
    newState.huntDirection = null;
    newState.firstHitInChain = newState.hitQueue.length > 0 ? newState.lastHit : null;
    if (newState.hitQueue.length === 0) {
      newState.lastHit = null;
    }
  }

  return newState;
}

export function placeShipRandomlyForConfig(
  board: Board,
  config: ShipConfig
): { board: Board; ship: Ship } | null {
  let attempts = 0;
  while (attempts < 1000) {
    const orientation: Orientation =
      Math.random() < 0.5 ? 'horizontal' : 'vertical';
    const maxRow =
      orientation === 'vertical'
        ? BOARD_SIZE - config.size
        : BOARD_SIZE - 1;
    const maxCol =
      orientation === 'horizontal'
        ? BOARD_SIZE - config.size
        : BOARD_SIZE - 1;

    const startPos: Position = {
      row: randomInt(maxRow + 1),
      col: randomInt(maxCol + 1),
    };

    if (canPlaceShip(board, startPos, config.size, orientation)) {
      return placeShip(board, startPos, config, orientation);
    }
    attempts++;
  }
  return null;
}
