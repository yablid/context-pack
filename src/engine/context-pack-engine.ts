import { writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildConfig, FileInfo, Artifact, CollectorHealth } from '../types.js';
import { FileWalker } from './file-walker.js';
import { BudgetManager } from './budget-manager.js';
import { PackGenerator } from './pack-generator.js';
import { CanonicalJSON } from './canonical-json.js';
import { DetectorRegistry } from '../detectors/detector-registry.js';
import { CollectorRegistry } from '../collectors/collector-registry.js';
import { schemaValidator, type ValidationStats } from './schema-validator.js';
import { CollectorRunner } from './collector-runner.js';
import { ErrorFormatter, createFormatterFromResults } from '../errors/error-formatter.js';
import { validateInputPath, validateOutputPath } from '../utils/path-validator.js';
import { wrapError } from '../errors/index.js';
import { TokenCounter } from '../utils/token-counter.js';
import { generatePackArtifacts, flattenArtifactPaths, type PackType } from './artifact-reducer.js';

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
      const fileWalker = this.createFileWalker();
      const files = await fileWalker.walk(this.rootPath);

      console.log(`Found ${files.length} files`);

      // Step 3: Get active collectors
      const collectorRegistry = new CollectorRegistry();
      const collectors = await collectorRegistry.getActiveCollectors(this.rootPath, this.config.preset);

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
        retries: this.config.strict ? 0 : 1 // Retry once for non-strict mode
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
      await this.writeOutput(packMetadata, finalArtifacts);

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

  private createFileWalker(): FileWalker {
    const gitignoreContent = this.loadGitignore();
    const ignoreRules = FileWalker.createDefaultIgnoreRules(gitignoreContent);
    
    if (this.config.exclude) {
      ignoreRules.user = this.config.exclude;
    }

    return new FileWalker(ignoreRules);
  }

  private loadGitignore(): string | undefined {
    // This would load .gitignore in a real implementation
    // For now, return undefined to use defaults only
    return undefined;
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

  private async writeOutput(packMetadata: any, artifacts: Artifact[]): Promise<void> {
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
}