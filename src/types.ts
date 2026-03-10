export type CellState = 'empty' | 'ship' | 'hit' | 'miss' | 'sunk';

export type Orientation = 'horizontal' | 'vertical';

export interface Position {
  row: number;
  col: number;
}

export interface Ship {
  name: string;
  size: number;
  positions: Position[];
  hits: boolean[];
}

export interface ShipConfig {
  name: string;
  size: number;
}

export type Board = CellState[][];

export type GamePhase = 'placement' | 'playing' | 'gameOver';

export type Turn = 'player' | 'ai';

export interface GameMessage {
  text: string;
  type: 'info' | 'hit' | 'miss' | 'sunk' | 'win';
}

export const BOARD_SIZE = 10;

export const SHIP_CONFIGS: ShipConfig[] = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];

export const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
export const COL_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
