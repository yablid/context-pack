import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PackMetadata, BuildConfig, DownsamplingDecision } from '../../core/types.js';
import { CanonicalJSON } from '../../core/io/canonical-json.js';
import { getGitInfo } from '../../core/git-info.js';

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
    const gitInfo = await getGitInfo(this.rootPath);

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

}