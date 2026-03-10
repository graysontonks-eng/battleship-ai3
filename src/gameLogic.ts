import type {
  Board,
  CellState,
  Orientation,
  Position,
  Ship,
  ShipConfig,
} from './types';
import { BOARD_SIZE } from './types';

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from<CellState>({ length: BOARD_SIZE }).fill('empty')
  );
}

export function canPlaceShip(
  board: Board,
  startPos: Position,
  size: number,
  orientation: Orientation
): boolean {
  for (let i = 0; i < size; i++) {
    const row = orientation === 'vertical' ? startPos.row + i : startPos.row;
    const col = orientation === 'horizontal' ? startPos.col + i : startPos.col;

    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      return false;
    }

    if (board[row][col] !== 'empty') {
      return false;
    }
  }
  return true;
}

export function placeShip(
  board: Board,
  startPos: Position,
  config: ShipConfig,
  orientation: Orientation
): { board: Board; ship: Ship } | null {
  if (!canPlaceShip(board, startPos, config.size, orientation)) {
    return null;
  }

  const newBoard = board.map((row) => [...row]);
  const positions: Position[] = [];

  for (let i = 0; i < config.size; i++) {
    const row =
      orientation === 'vertical' ? startPos.row + i : startPos.row;
    const col =
      orientation === 'horizontal' ? startPos.col + i : startPos.col;
    newBoard[row][col] = 'ship';
    positions.push({ row, col });
  }

  const ship: Ship = {
    name: config.name,
    size: config.size,
    positions,
    hits: new Array(config.size).fill(false),
  };

  return { board: newBoard, ship };
}

export function processShot(
  board: Board,
  ships: Ship[],
  target: Position
): {
  board: Board;
  ships: Ship[];
  result: 'hit' | 'miss' | 'sunk';
  shipName?: string;
} {
  const newBoard = board.map((row) => [...row]);
  const newShips = ships.map((s) => ({
    ...s,
    positions: [...s.positions],
    hits: [...s.hits],
  }));

  const cell = newBoard[target.row][target.col];

  if (cell === 'hit' || cell === 'miss' || cell === 'sunk') {
    return { board: newBoard, ships: newShips, result: 'miss' };
  }

  if (cell === 'ship') {
    newBoard[target.row][target.col] = 'hit';

    for (const ship of newShips) {
      const hitIndex = ship.positions.findIndex(
        (p) => p.row === target.row && p.col === target.col
      );
      if (hitIndex !== -1) {
        ship.hits[hitIndex] = true;

        const isSunk = ship.hits.every((h) => h);
        if (isSunk) {
          for (const pos of ship.positions) {
            newBoard[pos.row][pos.col] = 'sunk';
          }
          return {
            board: newBoard,
            ships: newShips,
            result: 'sunk',
            shipName: ship.name,
          };
        }

        return {
          board: newBoard,
          ships: newShips,
          result: 'hit',
          shipName: ship.name,
        };
      }
    }
  }

  newBoard[target.row][target.col] = 'miss';
  return { board: newBoard, ships: newShips, result: 'miss' };
}

export function allShipsSunk(ships: Ship[]): boolean {
  return ships.every((ship) => ship.hits.every((h) => h));
}

export function getCoordinateLabel(pos: Position): string {
  const rowLabel = String.fromCharCode(65 + pos.row);
  const colLabel = String(pos.col + 1);
  return `${rowLabel}-${colLabel}`;
}
