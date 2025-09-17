import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildConfig, FileInfo } from '../../core/types.js';
import { FileWalker } from '../../core/walker/file-walker.js';
import { DetectorRegistry } from './detectors/detector-registry.js';
import { getCollectorsForPreset } from './collectors/index.js';
import { validateInputPath, validateOutputPath } from '../../core/security/path-validator.js';
import type { Collector } from '../../core/contracts/collector.js';

export interface ContextPackPlan {
  rootPath: string;
  config: BuildConfig;
  files: FileInfo[];
  collectors: Collector[];
  detection: {
    preset?: { name: string } | null;
    languages: any[];
    monorepos: any[];
  };
  context: {
    rootPath: string;
    packages: string[];
    files: FileInfo[];
    budgetHint: number;
    riskProfile: string;
    verbose: boolean;
    timeout: number;
    memoryLimitMB: number;
  };
}

/**
 * Planning phase for context pack generation
 * Handles input validation, detection, file walking, and collector selection
 */
export class ContextPackPlanner {
  private rootPath: string;
  private config: BuildConfig;

  constructor(rootPath: string, config: BuildConfig) {
    this.rootPath = rootPath;
    this.config = config;
  }

  async createPlan(): Promise<ContextPackPlan> {
    // Step 0: Validate inputs
    await this.validateInputs();

    // Always show basic info
    console.log('=== Context Pack Generation ===\n');
    console.log(`Analyzing: ${this.rootPath}`);
    if (this.config.verbose) {
      console.log(`Preset: ${this.config.preset}`);
      console.log(`Level: ${this.config.level}`);
      console.log(`Budget: ${this.config.budgetBytes.toLocaleString()} bytes`);
    }
    console.log('');

    // Step 1: Detect ecosystem and validate preset
    console.log('Detecting ecosystems in:', this.rootPath);
    const detectorRegistry = new DetectorRegistry();
    const detection = await detectorRegistry.detectAll({
      rootPath: this.rootPath,
      verbose: this.config.verbose
    });

    if (this.config.verbose) {
      console.log(`Found ${detection.monorepos.length} monorepo indicators`);
      console.log(`Found ${detection.languages.length} language indicators`);
    }
    console.log(`Detected preset: ${detection.preset?.name || 'ts-simple'}`);

    // Step 2: Walk filesystem
    const fileWalker = await this.createFileWalker();
    const files = await fileWalker.walk(this.rootPath);

    console.log(`Found ${files.length} files`);

    // Step 3: Get active collectors
    const allCollectors = getCollectorsForPreset(this.config.preset);
    const collectors = [];

    for (const collector of allCollectors) {
      try {
        const canRun = await collector.detect(this.rootPath);
        if (canRun) collectors.push(collector);
      } catch {
        // If detection throws, treat as "not active" but keep going.
        continue;
      }
    }

    console.log(`Active collectors: ${collectors.map(c => c.name).join(', ')}`);

    if (this.config.verbose) {
      const estimatedTime = this.estimateProcessingTime(files.length, collectors.length);
      console.log(`Estimated processing time: ~${estimatedTime}s`);
    }

    // Step 4: Build execution context
    const budgetPerCollector = Math.floor(this.config.budgetBytes / collectors.length);
    const context = {
      rootPath: this.rootPath,
      packages: this.extractPackageDirs(files),
      files,
      budgetHint: budgetPerCollector,
      riskProfile: this.config.riskProfile,
      verbose: this.config.verbose,
      timeout: 30000, // 30 seconds
      memoryLimitMB: 500
    };

    return {
      rootPath: this.rootPath,
      config: this.config,
      files,
      collectors,
      detection,
      context
    };
  }

  /**
   * Validate input paths and configuration
   */
  private async validateInputs(): Promise<void> {
    // Validate input path
    await validateInputPath(this.rootPath);

    // Validate output path
    await validateOutputPath(this.config.out);
  }

  private async createFileWalker(): Promise<FileWalker> {
    const gitignoreContent = await this.loadGitignore();
    const ignoreRules = FileWalker.createDefaultIgnoreRules(gitignoreContent);

    if (this.config.exclude) {
      ignoreRules.user = this.config.exclude;
    }

    return new FileWalker(ignoreRules, {
      hashFiles: this.config.hashFiles,
      maxHashFileSizeMB: this.config.maxHashFileSizeMB
    });
  }

  private async loadGitignore(): Promise<string | undefined> {
    try {
      const gitignorePath = join(this.rootPath, '.gitignore');
      const content = await readFile(gitignorePath, 'utf-8');
      return content;
    } catch {
      // No .gitignore file or read error - use defaults only
      return undefined;
    }
  }

  private extractPackageDirs(files: FileInfo[]): string[] {
    // Extract unique directory paths that contain package.json files
    const packageDirs = new Set<string>();

    for (const file of files) {
      if (file.path.endsWith('package.json')) {
        const dir = file.path.substring(0, file.path.lastIndexOf('/'));
        packageDirs.add(dir || '.');
      }
    }

    return Array.from(packageDirs).sort();
  }

  private estimateProcessingTime(fileCount: number, collectorCount: number): number {
    // Rough estimation based on empirical data:
    // - Base time: 1-2 seconds
    // - File processing: ~0.1ms per file per collector
    // - TypeScript analysis: ~0.5ms per file for TS collectors
    const baseTime = 2;
    const fileProcessingTime = (fileCount * collectorCount * 0.0001);
    const tsAnalysisTime = fileCount > 50 ? (fileCount * 0.0005) : 0;

    return Math.max(1, Math.round(baseTime + fileProcessingTime + tsAnalysisTime));
  }
}