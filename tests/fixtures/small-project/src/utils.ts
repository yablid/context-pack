// Utility functions for the test project

export function isEven(n: number): boolean {
  return n % 2 === 0;
}

export function isOdd(n: number): boolean {
  return !isEven(n);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const CONSTANTS = {
  PI: Math.PI,
  E: Math.E,
  GOLDEN_RATIO: 1.618033988749895
} as const;

type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide';

export function performOperation(
  operation: MathOperation,
  a: number,
  b: number
): number {
  switch (operation) {
    case 'add':
      return a + b;
    case 'subtract':
      return a - b;
    case 'multiply':
      return a * b;
    case 'divide':
      if (b === 0) throw new Error('Division by zero');
      return a / b;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}