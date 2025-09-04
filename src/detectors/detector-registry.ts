import type { DetectorResult } from '../types.js';
import { MonorepoDetector } from './monorepo-detector.js';
import { LanguageDetector } from './language-detector.js';

export interface DetectionContext {
  rootPath: string;
  verbose?: boolean;
}

export interface PresetResult {
  name: string;
  confidence: number;
  monorepo?: DetectorResult;
  language?: DetectorResult;
  packageManager?: string;
  metadata: Record<string, unknown>;
}

export class DetectorRegistry {
  private monorepoDetector = new MonorepoDetector();
  private languageDetector = new LanguageDetector();

  async detectAll(context: DetectionContext): Promise<{
    monorepos: DetectorResult[];
    languages: DetectorResult[];
    preset: PresetResult | null;
  }> {
    if (context.verbose) {
      console.log(`Detecting ecosystems in: ${context.rootPath}`);
    }

    const [monorepos, languages] = await Promise.all([
      this.monorepoDetector.detect(context.rootPath),
      this.languageDetector.detect(context.rootPath)
    ]);

    if (context.verbose) {
      console.log(`Found ${monorepos.length} monorepo indicators`);
      console.log(`Found ${languages.length} language indicators`);
    }

    const preset = this.selectPreset(monorepos, languages);

    return {
      monorepos,
      languages,
      preset
    };
  }

  private selectPreset(
    monorepos: DetectorResult[], 
    languages: DetectorResult[]
  ): PresetResult | null {
    // Sort by confidence (copy to avoid mutating inputs)
    const topMonorepo = [...monorepos].sort((a, b) => b.confidence - a.confidence)[0];
    const topLanguage = [...languages].sort((a, b) => b.confidence - a.confidence)[0];

    if (!topMonorepo && !topLanguage) {
      return null;
    }

    // TypeScript + pnpm (highest priority)
    if (this.hasDetection(monorepos, 'pnpm-workspace') && 
        this.hasDetection(languages, 'typescript')) {
      return {
        name: 'ts-pnpm',
        confidence: 0.95,
        monorepo: this.getDetection(monorepos, 'pnpm-workspace')!,
        language: this.getDetection(languages, 'typescript')!,
        packageManager: 'pnpm',
        metadata: {
          description: 'TypeScript monorepo with pnpm workspaces',
          collectors: ['topology', 'import-graph', 'ts-config', 'exports', 'public-api', 'schema-index', 'type-metrics', 'duplication']
        }
      };
    }

    // TypeScript + npm/yarn
    if (this.hasDetection(monorepos, 'npm-workspaces') && 
        this.hasDetection(languages, 'typescript')) {
      const monorepo = this.getDetection(monorepos, 'npm-workspaces')!;
      return {
        name: 'ts-npm',
        confidence: 0.85,
        monorepo,
        language: this.getDetection(languages, 'typescript')!,
        packageManager: monorepo.metadata?.lockfile as string || 'npm',
        metadata: {
          description: 'TypeScript monorepo with npm/yarn workspaces',
          collectors: ['topology', 'import-graph', 'ts-config', 'exports', 'public-api', 'schema-index', 'type-metrics', 'duplication']
        }
      };
    }

    // Python + Poetry (future)
    if (this.hasDetection(languages, 'python')) {
      return {
        name: 'py-poetry',
        confidence: 0.7,
        language: this.getDetection(languages, 'python')!,
        packageManager: 'poetry',
        metadata: {
          description: 'Python project with Poetry',
          collectors: ['topology', 'import-graph', 'py-config'],
          status: 'not-implemented'
        }
      };
    }

    // Rust + Cargo (future)
    if (this.hasDetection(languages, 'rust')) {
      return {
        name: 'rust-cargo',
        confidence: 0.8,
        language: this.getDetection(languages, 'rust')!,
        packageManager: 'cargo',
        metadata: {
          description: 'Rust project with Cargo',
          collectors: ['topology', 'rust-analyzer'],
          status: 'not-implemented'
        }
      };
    }

    // Fallback to just TypeScript
    if (topLanguage?.name === 'typescript') {
      return {
        name: 'ts-simple',
        confidence: 0.6,
        language: topLanguage,
        packageManager: 'npm',
        metadata: {
          description: 'TypeScript project (non-monorepo)',
          collectors: ['exports', 'public-api', 'type-metrics']
        }
      };
    }

    return null;
  }

  private hasDetection(results: DetectorResult[], name: string): boolean {
    return results.some(r => r.name === name);
  }

  private getDetection(results: DetectorResult[], name: string): DetectorResult | undefined {
    return results.find(r => r.name === name);
  }

  getAvailablePresets(): string[] {
    return [
      'ts-pnpm',
      'ts-npm', 
      'ts-simple',
      'py-poetry',
      'rust-cargo'
    ];
  }

  getPresetDescription(preset: string): string {
    const descriptions: Record<string, string> = {
      'ts-pnpm': 'TypeScript monorepo with pnpm workspaces',
      'ts-npm': 'TypeScript monorepo with npm/yarn workspaces',
      'ts-simple': 'TypeScript project (non-monorepo)',
      'py-poetry': 'Python project with Poetry (not implemented)',
      'rust-cargo': 'Rust project with Cargo (not implemented)'
    };

    return descriptions[preset] || 'Unknown preset';
  }
}