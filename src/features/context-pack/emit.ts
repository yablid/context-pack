import { writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Artifact } from '../../core/types.js';
import { CanonicalJSON } from '../../core/io/canonical-json.js';
import { TokenCounter } from '../../core/tokens/token-counter.js';
import { generatePackArtifacts, flattenArtifactPaths, type PackType } from './artifact-reducer.js';
import { wrapError } from '../../errors/public.js';
import type { ContextPackPlan } from './plan.js';
import type { ContextPackRunResult } from './run.js';

export interface ContextPackEmitResult {
  success: boolean;
  outputDir: string;
  totalSize: number;
  tokenEstimate: any;
  elapsedTime: number;
}

/**
 * Output generation phase for context pack generation
 * Handles writing files, formatting output, and agent-friendly output
 */
export class ContextPackEmitter {
  private plan: ContextPackPlan;
  private result: ContextPackRunResult;

  constructor(plan: ContextPackPlan, result: ContextPackRunResult) {
    this.plan = plan;
    this.result = result;
  }

  async emit(startTime: number): Promise<ContextPackEmitResult> {
    try {
      // Step 1: Write output
      await this.writeOutput();

      const elapsedTime = Math.round((Date.now() - startTime) / 1000);

      // Calculate token estimate for AI context usage
      const tokenEstimate = TokenCounter.countArtifacts(this.result.artifacts);
      const totalSize = this.result.artifacts.reduce((sum, a) => sum + a.sizeHint, 0);

      console.log(`\nContext pack generated: ${this.plan.config.out}`);
      console.log(`Total size: ${totalSize.toLocaleString()} bytes`);
      console.log(`Estimated tokens: ${TokenCounter.formatEstimate(tokenEstimate, this.plan.config.verbose)}`);

      if (this.plan.config.verbose) {
        console.log(`Completed in ${elapsedTime}s`);

        // Show health summary
        if (this.result.healthSummary.failed > 0 || this.result.healthSummary.partial > 0) {
          console.log(`\nCollector Health:`);
          console.log(`  ✅ Successful: ${this.result.healthSummary.successful}`);
          if (this.result.healthSummary.partial > 0) console.log(`  ⚠️  Partial: ${this.result.healthSummary.partial}`);
          if (this.result.healthSummary.failed > 0) console.log(`  ❌ Failed: ${this.result.healthSummary.failed}`);
          if (this.result.healthSummary.timeout > 0) console.log(`  ⏱️  Timeout: ${this.result.healthSummary.timeout}`);
        }
      }

      // Show errors and warnings
      if (this.result.errorFormatter.hasCriticalErrors() || this.plan.config.verbose) {
        const errorOutput = this.result.errorFormatter.format('cli');
        if (errorOutput.trim()) {
          console.log(errorOutput);
        }
      }

      // Agent-friendly output (print JSON manifest to stdout)
      await this.handleAgentOutput();

      // Handle strict mode validation failure after successful pack generation
      if (this.result.strictValidationError) {
        throw this.result.strictValidationError;
      }

      return {
        success: true,
        outputDir: this.plan.config.out,
        totalSize,
        tokenEstimate,
        elapsedTime
      };

    } catch (error) {
      // Bubble a structured error; CLI will decide printing/exit.
      const wrappedError = wrapError(error);
      // Attach formatter with accumulated collector errors for the CLI.
      (wrappedError as any)._formatter = this.result.errorFormatter;
      throw wrappedError;
    }
  }

  private async writeOutput(): Promise<void> {
    const outputDir = this.plan.config.out;

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
      let packArtifacts = generatePackArtifacts(this.result.artifacts, packType);

      // For short/minimal, flatten ts/ paths to root level
      if (packType === 'short' || packType === 'minimal') {
        packArtifacts = flattenArtifactPaths(packArtifacts);
      }

      // Write pack metadata (include in all pack types for now)
      const packMetadataJson = CanonicalJSON.stringify({
        ...this.result.packMetadata,
        packType,
        artifactCount: packArtifacts.length
      }, !this.plan.config.deterministic);
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
          const content = CanonicalJSON.stringify(artifact.data, !this.plan.config.deterministic);
          await writeFile(filePath, content, 'utf-8');
        } else {
          await writeFile(filePath, artifact.text || '', 'utf-8');
        }
      }
    }

    // Write scoped pack artifacts if present
    if (this.result.scopedArtifacts.length > 0) {
      const seedHash = this.generateSeedHash();
      const scopedDir = join(outputDir, 'scoped', seedHash);
      await mkdir(scopedDir, { recursive: true });

      console.log(`Writing scoped pack to: ${scopedDir}`);

      for (const artifact of this.result.scopedArtifacts) {
        const filePath = join(scopedDir, artifact.filename.replace('scoped/', ''));

        // Ensure subdirectory exists
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dir !== scopedDir) {
          await mkdir(dir, { recursive: true });
        }

        if (artifact.kind === 'json') {
          const content = CanonicalJSON.stringify(artifact.data, !this.plan.config.deterministic);
          await writeFile(filePath, content, 'utf-8');
        } else {
          await writeFile(filePath, artifact.text || '', 'utf-8');
        }
      }

      // Update main pack metadata to reference scoped pack
      if (this.plan.config.scope) {
        // Add scoped pack reference to main pack metadata
        const scopedRef = {
          seed: this.plan.config.scope.seed,
          path: `scoped/${seedHash}`,
          hash: seedHash
        };

        // We'll need to update the pack metadata files to include this reference
        // For now, just log it
        if (this.plan.config.verbose) {
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
    if (!this.plan.config.scope) {
      return 'unknown';
    }

    // Create a deterministic hash based on scope configuration
    const hashInput = JSON.stringify({
      seed: this.plan.config.scope.seed,
      mode: this.plan.config.scope.mode,
      budgetTokens: this.plan.config.scope.budgetTokens,
      allowCodeBodies: this.plan.config.scope.allowCodeBodies,
      include: this.plan.config.scope.include
    });

    return createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
  }

  /**
   * Handle agent-friendly output options
   */
  private async handleAgentOutput(): Promise<void> {
    if (!this.plan.config.agentOutput) {
      return;
    }

    const { printJson, printArtifact, emitPrompt } = this.plan.config.agentOutput;

    // Build pack paths structure
    const packPaths = {
      outputDir: this.plan.config.out,
      scopedDir: this.plan.config.scope ? join(this.plan.config.out, 'scoped', this.generateSeedHash()) : undefined,
      scopedHash: this.plan.config.scope ? this.generateSeedHash() : undefined
    };

    // Handle --print <artifact> (stream specific artifact to stdout)
    if (printArtifact) {
      await this.printArtifact(this.result.scopedArtifacts.length > 0 ? this.result.scopedArtifacts : this.result.artifacts, printArtifact);
      return; // Early return - don't mix with other output
    }

    // Handle --print-json (emit JSON manifest to stdout)
    if (printJson) {
      await this.printJsonManifest(this.result.scopedArtifacts.length > 0 ? this.result.scopedArtifacts : this.result.artifacts, packPaths);
    }

    // Handle --emit-prompt (generate 99-prompt.txt file)
    if (emitPrompt && this.plan.config.scope) {
      await this.generatePromptFile(this.result.scopedArtifacts.length > 0 ? this.result.scopedArtifacts : this.result.artifacts, packPaths);
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
      scoped: this.plan.config.scope ? {
        dir: packPaths.scopedDir,
        hash: packPaths.scopedHash,
        scope: this.plan.config.scope.seed,
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
    if (!this.plan.config.scope) {
      return;
    }

    let promptContent = '';

    // Add header with context information
    promptContent += `# Scoped Context Pack\n\n`;
    promptContent += `**Scope:** ${this.plan.config.scope.seed}\n`;
    promptContent += `**Mode:** ${this.plan.config.scope.mode}\n`;
    promptContent += `**Budget:** ${this.plan.config.scope.budgetTokens} tokens\n\n`;

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