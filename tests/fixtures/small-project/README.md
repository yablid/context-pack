# Small Test Project

A minimal TypeScript project for testing context-pack functionality.

## Features

- Basic calculator with arithmetic operations
- Utility functions for common math operations
- TypeScript with strict type checking
- Simple project structure

## Usage

```typescript
import { Calculator, formatNumber } from './src/index.js';
import { isEven, clamp } from './src/utils.js';

const calc = new Calculator();
const result = calc.add(2, 3);
console.log(formatNumber(result)); // "5.00"

console.log(isEven(result)); // false
console.log(clamp(result, 0, 10)); // 5
```

## Build

```bash
npm run build
```