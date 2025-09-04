import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use Node.js environment for CLI testing
    environment: 'node',
    
    // Include test files
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    
    // Exclude patterns
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test-fixtures/**',
      '**/test-output/**',
      '**/.contextpack/**'
    ],
    
    // Global test timeout (30 seconds for integration tests)
    testTimeout: 30000,
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts'
      ]
    },
    
    
    // Reporter configuration
    reporter: ['verbose']
  },
  
  // TypeScript configuration
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname
    }
  }
});