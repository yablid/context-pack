import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { BuildConfig, FileInfo, Artifact, CollectorHealth } from '../core/types.js';
import { FileWalker } from '../core/walker/file-walker.js';
import { BudgetManager } from '../core/tokens/budget-manager.js';
import { PackGenerator } from './pack-generator.js';
import { CanonicalJSON } from '../core/io/canonical-json.js';
import { DetectorRegistry } from '../features/context-pack/detectors/detector-registry.js';
import { getCollectorsForPreset } from '../features/context-pack/collectors/index.js';
import { schemaValidator, type ValidationStats } from '../core/validation/schema-validator.js';
import { CollectorRunner } from './collector-runner.js';
import { ErrorFormatter, createFormatterFromResults } from '../errors/error-formatter.js';
import { validateInputPath, validateOutputPath } from '../core/security/path-validator.js';
import { wrapError } from '../errors/public.js';
import { TokenCounter } from '../core/tokens/token-counter.js';
import { generatePackArtifacts, flattenArtifactPaths, type PackType } from './artifact-reducer.js';
// import { createScopedCollector } from '../collectors/scoped-collector.js';

export class ContextPackEngine {
  private rootPath: string;
  private config: BuildConfig;

  constructor(rootPath: string, config: BuildConfig) {
    this.rootPath = rootPath;
    this.config = config;
  }

  async generate(): Promise<void> {
    const errorFormatter = new ErrorFormatter();
    const startTime = Date.now();

    try {
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

      // Step 4: Run collectors with error handling and health tracking
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

      // Show progress for collector execution
      if (!this.config.verbose) {
        for (const collector of collectors) {
          console.log(`[${collector.name}] Processing ${files.length} files`);
        }
      }

      const collectorResults = await CollectorRunner.runCollectors(collectors, context, {
        timeout: 30000,
        memoryLimitMB: 500,
        retries: this.config.strict ? 0 : 1, // Retry once for non-strict mode
        concurrency: this.config.concurrency ?? 3 // Bounded concurrency (default: 3)
      });

      // Collect all artifacts and health information
      const allArtifacts = collectorResults.flatMap(r => r.artifacts);
      const healthSummary = CollectorRunner.createHealthSummary(collectorResults);
      const healths = collectorResults.map(r => r.health);

      // Add any errors to the formatter
      const collectorErrors = collectorResults
        .filter(r => r.error)
        .map(r => r.error!);
      errorFormatter.addErrors(collectorErrors);

      // Handle strict mode failures
      if (this.config.strict && collectorErrors.some(e => !e.recoverable)) {
        throw new Error(`Critical collector failures in strict mode`);
      }

      // Step 5: Apply budget constraints
      const budgetManager = new BudgetManager({
        totalBytes: this.config.budgetBytes
      });

      const { artifacts: finalArtifacts, downsampling } = budgetManager.enforce(allArtifacts);

      // Step 5.1: Optional scoped pack generation
      let scopedArtifacts: Artifact[] = [];
      // TODO: Re-enable scoped functionality after breaking cross-feature cycles
      // if (this.config.scope) {
      //   // Scoped functionality temporarily disabled to break cycles
      // }

      // Show results for each successful collector
      for (const result of collectorResults) {
        if (result.artifacts.length > 0 && !result.error) {
          const size = result.artifacts.reduce((sum, a) => sum + a.sizeHint, 0);
          const sizeStr = this.config.verbose ? ` (${size.toLocaleString()} bytes)` : '';
          console.log(`[${result.health.name}] Generated ${result.artifacts.length > 1 ? `${result.artifacts[0].kind} with ${result.artifacts.length} entries` : result.artifacts[0].kind}${sizeStr}`);
        }
      }

      if (this.config.verbose && downsampling.length > 0) {
        console.log(`Applied ${downsampling.length} downsampling decisions`);
      }

      // Step 5.5: Schema validation
      let validationStats: ValidationStats | undefined;
      let validationFailures: Array<{ artifactId: string; field: string; message: string }> = [];
      const failedCollectorNames = CollectorRunner.getFailedCollectorNames(collectorResults);
      let strictValidationError: Error | undefined;
      
      if (this.config.validateSchemas) {
        console.log('Validating artifacts against schemas...');

        const validation = schemaValidator.validateArtifacts(finalArtifacts);
        validationStats = validation;

        // Extract validation failures for pack metadata (deterministic order)
        validationFailures = validation.results
          .flatMap(r => r.errors)
          .sort((a, b) => {
            const artifactCmp = a.artifactId.localeCompare(b.artifactId);
            if (artifactCmp !== 0) return artifactCmp;
            const fieldCmp = a.field.localeCompare(b.field);
            if (fieldCmp !== 0) return fieldCmp;
            return a.message.localeCompare(b.message);
          })
          .slice(0, 25)
          .map(({ artifactId, field, message }) => ({ artifactId, field, message }));

        // Log validation results
        console.log(`  Valid artifacts: ${validation.validArtifacts}/${validation.totalArtifacts}`);
        if (this.config.verbose) {
          if (validation.errorCount > 0) {
            console.log(`  Validation errors: ${validation.errorCount}`);
          }
          if (validation.warningCount > 0) {
            console.log(`  Validation warnings: ${validation.warningCount}`);
          }
        }

        // Prepare validation errors for strict mode (but don't throw yet)
        if (this.config.strict && validation.errorCount > 0) {
          console.error('\nValidation errors found:');
          for (const result of validation.results) {
            for (const error of result.errors) {
              console.error(`  ${error.artifactId}: ${error.field} - ${error.message}`);
            }
          }
          strictValidationError = new Error(`Schema validation failed: ${validation.errorCount} errors found`);
        }

        // Handle validate-only mode
        if (this.config.validateOnly) {
          console.log(`\nValidation complete:`);
          console.log(`  Total artifacts: ${validation.totalArtifacts}`);
          console.log(`  Valid: ${validation.validArtifacts}`);
          console.log(`  Errors: ${validation.errorCount}`);
          console.log(`  Warnings: ${validation.warningCount}`);
          
          if (validation.errorCount > 0) {
            throw new Error(`Validation failed with ${validation.errorCount} errors`);
          }
          return;
        }
      }

      // Step 6: Generate pack metadata with health information
      const packGenerator = new PackGenerator(this.rootPath, this.config);
      const totalSize = finalArtifacts.reduce((sum, a) => sum + a.sizeHint, 0);
      const packMetadata = await packGenerator.generatePackMetadata(
        totalSize,
        downsampling,
        {
          detectedPreset: detection.preset?.name,
          collectorCount: collectors.length,
          fileCount: files.length,
          ...(validationStats && {
            validation: {
              enabled: this.config.validateSchemas,
              stats: {
                totalArtifacts: validationStats.totalArtifacts,
                validArtifacts: validationStats.validArtifacts,
                errorCount: validationStats.errorCount,
                warningCount: validationStats.warningCount
              },
              ...(failedCollectorNames.length > 0 && { failedCollectors: failedCollectorNames }),
              ...(validationFailures.length > 0 && { failures: validationFailures })
            }
          }),
          health: {
            totalCollectors: healthSummary.totalCollectors,
            successful: healthSummary.successful,
            partial: healthSummary.partial,
            failed: healthSummary.failed,
            timeout: healthSummary.timeout,
            skipped: healthSummary.skipped,
            totalExecutionTime: healthSummary.totalExecutionTime,
            collectors: healths
          }
        }
      );

      // Step 7: Write output
      await this.writeOutput(packMetadata, finalArtifacts, scopedArtifacts);

      const elapsedTime = Math.round((Date.now() - startTime) / 1000);
      
      // Calculate token estimate for AI context usage
      const tokenEstimate = TokenCounter.countArtifacts(finalArtifacts);
      
      console.log(`\nContext pack generated: ${this.config.out}`);
      console.log(`Total size: ${totalSize.toLocaleString()} bytes`);
      console.log(`Estimated tokens: ${TokenCounter.formatEstimate(tokenEstimate, this.config.verbose)}`);
      
      if (this.config.verbose) {
        console.log(`Completed in ${elapsedTime}s`);
        
        // Show health summary
        if (healthSummary.failed > 0 || healthSummary.partial > 0) {
          console.log(`\nCollector Health:`);
          console.log(`  ✅ Successful: ${healthSummary.successful}`);
          if (healthSummary.partial > 0) console.log(`  ⚠️  Partial: ${healthSummary.partial}`);
          if (healthSummary.failed > 0) console.log(`  ❌ Failed: ${healthSummary.failed}`);
          if (healthSummary.timeout > 0) console.log(`  ⏱️  Timeout: ${healthSummary.timeout}`);
        }
      }

      // Show errors and warnings
      if (errorFormatter.hasCriticalErrors() || this.config.verbose) {
        const errorOutput = errorFormatter.format('cli');
        if (errorOutput.trim()) {
          console.log(errorOutput);
        }
      }

      // Agent-friendly output (print JSON manifest to stdout)
      await this.handleAgentOutput(finalArtifacts, scopedArtifacts);

      // Handle strict mode validation failure after successful pack generation
      if (strictValidationError) {
        throw strictValidationError;
      }

    } catch (error) {
      // Bubble a structured error; CLI will decide printing/exit.
      const wrappedError = wrapError(error);
      // Attach formatter with accumulated collector errors for the CLI.
      (wrappedError as any)._formatter = errorFormatter;
      throw wrappedError;
    }
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

  private async writeOutput(packMetadata: any, artifacts: Artifact[], scopedArtifacts: Artifact[] = []): Promise<void> {
    const outputDir = this.config.out;

    // Ensure output directory exists
    try {
      await access(outputDir);
    } catch {
      await mkdir(outputDir, { recursive: true });
    }

    // Generate the three pack types
    const packTypes: PackType[] = ['full', 'short', 'minimal'];
    const packTokenCounts: Record<PackType, any> = {} as any;

    for (const packType of packTypes) {
      const packDir = join(outputDir, packType);
      await mkdir(packDir, { recursive: true });

      // Generate artifacts for this pack type
      let packArtifacts = generatePackArtifacts(artifacts, packType);

      // For short/minimal, flatten ts/ paths to root level
      if (packType === 'short' || packType === 'minimal') {
        packArtifacts = flattenArtifactPaths(packArtifacts);
      }

      // Write pack metadata (include in all pack types for now)
      const packMetadataJson = CanonicalJSON.stringify({
        ...packMetadata,
        packType,
        artifactCount: packArtifacts.length
      }, !this.config.deterministic);
      await writeFile(join(packDir, '00-pack.json'), packMetadataJson, 'utf-8');

      // Calculate token count for this pack
      const packTokensEstimate = TokenCounter.countText(packMetadataJson);
      const artifactTokens = TokenCounter.countArtifacts(packArtifacts.map(a => ({
        text: a.text,
        data: a.data,
        kind: a.kind
      })));

      packTokenCounts[packType] = {
        characters: artifactTokens.characters + packTokensEstimate.characters,
        tokensConservative: artifactTokens.tokensConservative + packTokensEstimate.tokensConservative,
        tokensOptimistic: artifactTokens.tokensOptimistic + packTokensEstimate.tokensOptimistic,
        tokensAverage: artifactTokens.tokensAverage + packTokensEstimate.tokensAverage
      };

      // Write artifacts for this pack type
      for (const artifact of packArtifacts) {
        const filePath = join(packDir, artifact.filename);

        // Ensure subdirectory exists (for full pack with ts/ structure)
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dir !== packDir) {
          await mkdir(dir, { recursive: true });
        }

        if (artifact.kind === 'json') {
          const content = CanonicalJSON.stringify(artifact.data, !this.config.deterministic);
          await writeFile(filePath, content, 'utf-8');
        } else {
          await writeFile(filePath, artifact.text || '', 'utf-8');
        }
      }
    }

    // Write scoped pack artifacts if present
    if (scopedArtifacts.length > 0) {
      const seedHash = this.generateSeedHash();
      const scopedDir = join(outputDir, 'scoped', seedHash);
      await mkdir(scopedDir, { recursive: true });

      console.log(`Writing scoped pack to: ${scopedDir}`);

      for (const artifact of scopedArtifacts) {
        const filePath = join(scopedDir, artifact.filename.replace('scoped/', ''));

        // Ensure subdirectory exists
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dir !== scopedDir) {
          await mkdir(dir, { recursive: true });
        }

        if (artifact.kind === 'json') {
          const content = CanonicalJSON.stringify(artifact.data, !this.config.deterministic);
          await writeFile(filePath, content, 'utf-8');
        } else {
          await writeFile(filePath, artifact.text || '', 'utf-8');
        }
      }

      // Update main pack metadata to reference scoped pack
      if (this.config.scope) {
        // Add scoped pack reference to main pack metadata
        const scopedRef = {
          seed: this.config.scope.seed,
          path: `scoped/${seedHash}`,
          hash: seedHash
        };

        // We'll need to update the pack metadata files to include this reference
        // For now, just log it
        if (this.config.verbose) {
          console.log(`Scoped pack reference: ${JSON.stringify(scopedRef)}`);
        }
      }
    }

    // Generate enhanced token count summary
    const tokenSummary = [
      'Context Pack Token Estimates',
      '============================',
      '',
      `Full pack: ~${packTokenCounts.full.tokensAverage.toLocaleString()} tokens (range: ${packTokenCounts.full.tokensConservative.toLocaleString()}-${packTokenCounts.full.tokensOptimistic.toLocaleString()})`,
      `Short pack: ~${packTokenCounts.short.tokensAverage.toLocaleString()} tokens (range: ${packTokenCounts.short.tokensConservative.toLocaleString()}-${packTokenCounts.short.tokensOptimistic.toLocaleString()})`,
      `Minimal pack: ~${packTokenCounts.minimal.tokensAverage.toLocaleString()} tokens (range: ${packTokenCounts.minimal.tokensConservative.toLocaleString()}-${packTokenCounts.minimal.tokensOptimistic.toLocaleString()})`,
      '',
      'Pack Contents:',
      '- full/: Complete analysis (all artifacts + TypeScript subdirectory)',
      '- short/: Essential structure (topology, manifest, filtered import-graph, tsconfig, exports)',
      '- minimal/: Quick context (filtered import-graph, tsconfig, exports only)',
      '',
      'Token estimates are approximate and vary by model tokenizer.',
      'Conservative estimates assume ~3 chars/token, optimistic assume ~5 chars/token.'
    ].join('\n');

    await writeFile(join(outputDir, 'TOKEN_COUNTS.txt'), tokenSummary, 'utf-8');
  }

  private generateSeedHash(): string {
    if (!this.config.scope) {
      return 'unknown';
    }

    // Create a deterministic hash based on scope configuration
    const hashInput = JSON.stringify({
      seed: this.config.scope.seed,
      mode: this.config.scope.mode,
      budgetTokens: this.config.scope.budgetTokens,
      allowCodeBodies: this.config.scope.allowCodeBodies,
      include: this.config.scope.include
    });

    return createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
  }

  /**
   * Handle agent-friendly output options
   */
  private async handleAgentOutput(finalArtifacts: Artifact[], scopedArtifacts: Artifact[]): Promise<void> {
    if (!this.config.agentOutput) {
      return;
    }

    const { printJson, printArtifact, emitPrompt } = this.config.agentOutput;

    // Build pack paths structure
    const packPaths = {
      outputDir: this.config.out,
      scopedDir: this.config.scope ? join(this.config.out, 'scoped', this.generateSeedHash()) : undefined,
      scopedHash: this.config.scope ? this.generateSeedHash() : undefined
    };

    // Handle --print <artifact> (stream specific artifact to stdout)
    if (printArtifact) {
      await this.printArtifact(scopedArtifacts.length > 0 ? scopedArtifacts : finalArtifacts, printArtifact);
      return; // Early return - don't mix with other output
    }

    // Handle --print-json (emit JSON manifest to stdout)
    if (printJson) {
      await this.printJsonManifest(scopedArtifacts.length > 0 ? scopedArtifacts : finalArtifacts, packPaths);
    }

    // Handle --emit-prompt (generate 99-prompt.txt file)
    if (emitPrompt && this.config.scope) {
      await this.generatePromptFile(scopedArtifacts.length > 0 ? scopedArtifacts : finalArtifacts, packPaths);
    }
  }

  /**
   * Print specific artifact to stdout
   */
  private async printArtifact(artifacts: Artifact[], artifactType: string): Promise<void> {
    // Map artifact types to their file patterns
    const typeToPattern: Record<string, string> = {
      'scope': '00-scope.json',
      'graph': '10-symbol-graph.json',
      'slices': '20-slices.ndjson',
      'index': '40-index.ndjson'
    };

    const pattern = typeToPattern[artifactType];
    if (!pattern) {
      return;
    }

    // Find the matching artifact
    const artifact = artifacts.find(a => a.id.endsWith(pattern));
    if (!artifact) {
      return;
    }

    // Print the artifact content to stdout (no prefixes, no logs)
    if (typeof artifact.data === 'string') {
      console.log(artifact.data);
    } else {
      console.log(CanonicalJSON.stringify(artifact.data));
    }
  }

  /**
   * Print JSON manifest to stdout
   */
  private async printJsonManifest(artifacts: Artifact[], packPaths: any): Promise<void> {
    const manifest = {
      outDir: packPaths.outputDir,
      scoped: this.config.scope ? {
        dir: packPaths.scopedDir,
        hash: packPaths.scopedHash,
        scope: this.config.scope.seed,
        artifacts: this.buildArtifactPaths(artifacts, packPaths.scopedDir)
      } : undefined
    };

    console.log(CanonicalJSON.stringify(manifest));
  }

  /**
   * Build artifact paths for JSON manifest
   */
  private buildArtifactPaths(artifacts: Artifact[], scopedDir: string): Record<string, string> {
    const paths: Record<string, string> = {};

    for (const artifact of artifacts) {
      const fileName = artifact.id.split('/').pop();
      if (!fileName) continue;

      const fullPath = join(scopedDir, fileName);

      if (fileName.startsWith('00-scope.json')) {
        paths.scope = fullPath;
      } else if (fileName.startsWith('10-symbol-graph.json')) {
        paths.graph = fullPath;
      } else if (fileName.startsWith('20-slices.ndjson')) {
        paths.slices = fullPath;
      } else if (fileName.startsWith('30-stubs.d.ts')) {
        paths.stubs = fullPath;
      } else if (fileName.startsWith('40-index.ndjson')) {
        paths.index = fullPath;
      }
    }

    return paths;
  }

  /**
   * Generate 99-prompt.txt for direct LLM consumption
   */
  private async generatePromptFile(artifacts: Artifact[], packPaths: any): Promise<void> {
    if (!this.config.scope) {
      return;
    }

    let promptContent = '';

    // Add header with context information
    promptContent += `# Scoped Context Pack\n\n`;
    promptContent += `**Scope:** ${this.config.scope.seed}\n`;
    promptContent += `**Mode:** ${this.config.scope.mode}\n`;
    promptContent += `**Budget:** ${this.config.scope.budgetTokens} tokens\n\n`;

    // Add code slices
    const slicesArtifact = artifacts.find(a => a.id.includes('20-slices.ndjson'));
    if (slicesArtifact && typeof slicesArtifact.data === 'string') {
      const lines = slicesArtifact.data.trim().split('\n');

      promptContent += `## Code Context\n\n`;

      for (const line of lines) {
        try {
          const slice = JSON.parse(line);
          promptContent += `### ${slice.filePath}#${slice.symbolName}\n`;
          if (slice.reason) {
            promptContent += `*Included: ${slice.reason}*\n\n`;
          }
          if (slice.content) {
            promptContent += `\`\`\`typescript\n${slice.content}\n\`\`\`\n\n`;
          }
        } catch (e) {
          // Skip malformed lines
        }
      }
    }

    // Add footer
    promptContent += `---\n*Generated by context-pack scoped analyzer*\n`;

    // Write the prompt file
    const promptPath = join(packPaths.scopedDir, '99-prompt.txt');
    await writeFile(promptPath, promptContent, 'utf-8');
  }
}