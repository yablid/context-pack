import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const CLI_PATH = path.join(process.cwd(), 'dist/cli.js');

describe('Golden Test', () => {
  it('should generate deterministic output', async () => {
    // Test that the CLI produces consistent output on the same input
    const { stdout: run1 } = await execAsync(`node ${CLI_PATH} . --level summary --budget 100KB`);
    const { stdout: run2 } = await execAsync(`node ${CLI_PATH} . --level summary --budget 100KB`);
    
    // Should produce consistent output (ignoring timestamps)
    const normalize = (output: string) => output.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'TIMESTAMP');
    
    expect(normalize(run1)).toBe(normalize(run2));
  });
});