import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const CLI_PATH = path.join(process.cwd(), 'dist/cli.js');

describe('CLI Smoke Tests', () => {
  it('should show help', async () => {
    const { stdout } = await execAsync(`node ${CLI_PATH} --help`);
    
    expect(stdout).toContain('context-pack');
    expect(stdout).toContain('Usage:');
  });

  it('should show version', async () => {
    const { stdout } = await execAsync(`node ${CLI_PATH} --version`);
    
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should show detect command', async () => {
    const { stdout } = await execAsync(`node ${CLI_PATH} detect .`);
    
    expect(stdout).toContain('preset:');
  });

  it('should show schema command', async () => {
    const { stdout } = await execAsync(`node ${CLI_PATH} schema`);
    
    expect(stdout).toContain('schema');
  });
});