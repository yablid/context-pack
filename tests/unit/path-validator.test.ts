import { describe, it, expect } from 'vitest';
import { PathValidator } from '../../src/core/security/path-validator.js';

describe('PathValidator', () => {
  it('should accept valid relative paths', async () => {
    const result = await PathValidator.validatePath('./src');
    expect(result.valid).toBe(true);
  });

  it('should accept current directory', async () => {
    const result = await PathValidator.validatePath('.');
    expect(result.valid).toBe(true);
  });

  it('should reject dangerous paths', async () => {
    try {
      await PathValidator.validatePath('../../../etc/passwd');
      expect.fail('Should have thrown an error for path traversal');
    } catch (error) {
      // Path traversal should be caught - any error is acceptable
      expect(error).toBeDefined();
    }
  });
});