import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import type { PackMetadata, BuildConfig, DownsamplingDecision } from '../types.js';
import { CanonicalJSON } from './canonical-json.js';

export class PackGenerator {
  private rootPath: string;
  private config: BuildConfig;

  constructor(rootPath: string, config: BuildConfig) {
    this.rootPath = rootPath;
    this.config = config;
  }

  async generatePackMetadata(
    actualBytes: number,
    downsampling: DownsamplingDecision[] = [],
    meta?: Record<string, unknown>
  ): Promise<PackMetadata> {
    const packageJson = await this.getPackageInfo();
    const gitInfo = await this.getGitInfo();

    return {
      specVersion: '1.0.0',
      generator: {
        name: 'context-pack',
        version: packageJson.version || '0.1.0'
      },
      createdAt: this.config.deterministic 
        ? CanonicalJSON.deterministicTimestamp() 
        : new Date().toISOString(),
      preset: this.config.preset,
      riskProfile: this.config.riskProfile,
      level: this.config.level,
      budgets: {
        targetBytes: this.config.budgetBytes,
        actualBytes
      },
      ...(gitInfo && { git: gitInfo }),
      downsampling,
      ...(meta && { meta })
    };
  }

  private async getPackageInfo(): Promise<{ version?: string }> {
    try {
      // Resolve relative to this file (works in ESM and dist/)
      const fromHere = fileURLToPath(new URL('../../package.json', import.meta.url));
      const content = await readFile(fromHere, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Fallback: try CWD (useful in dev)
      try {
        const cwdPath = join(process.cwd(), 'package.json');
        const content = await readFile(cwdPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        return {};
      }
    }
  }

  private async getGitInfo(): Promise<{ commit?: string; branch?: string; isDirty?: boolean } | undefined> {
    try {
      const commit = execSync('git rev-parse HEAD', { 
        cwd: this.rootPath, 
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();

      const branch = execSync('git rev-parse --abbrev-ref HEAD', { 
        cwd: this.rootPath, 
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();

      const isDirty = execSync('git status --porcelain', { 
        cwd: this.rootPath, 
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim().length > 0;

      return { commit, branch, isDirty };
    } catch {
      // Not a git repository or git not available
      return undefined;
    }
  }
}