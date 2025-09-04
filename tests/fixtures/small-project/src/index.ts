/**
 * Main entry point for the small test project
 */
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
  
  subtract(a: number, b: number): number {
    return a - b;
  }
  
  multiply(a: number, b: number): number {
    return a * b;
  }
  
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    return a / b;
  }
}

export const defaultCalculator = new Calculator();

// Simple utility function
export function formatNumber(num: number, decimals = 2): string {
  return num.toFixed(decimals);
}