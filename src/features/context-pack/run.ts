import type { Artifact, CollectorHealth } from '../../core/types.js';
import { BudgetManager } from '../../core/tokens/budget-manager.js';
import { PackGenerator } from './pack-generator.js';
import { schemaValidator, type ValidationStats } from '../../core/validation/schema-validator.js';
import { CollectorRunner } from './collector-runner.js';
import { ErrorFormatter } from '../../errors/error-formatter.js';
import type { ContextPackPlan } from './plan.js';

export interface ContextPackRunResult {
  artifacts: Artifact[];
  scopedArtifacts: Artifact[];
  packMetadata: any;
  errorFormatter: ErrorFormatter;
  validationStats?: ValidationStats;
  healthSummary: {
    totalCollectors: number;
    successful: number;
    partial: number;
    failed: number;
    timeout: number;
    skipped: number;
    totalExecutionTime: number;
  };
  healths: CollectorHealth[];
  validationFailures: Array<{ artifactId: string; field: string; message: string }>;
  strictValidationError?: Error;
}

/**
 * Execution phase for context pack generation
 * Handles collector execution, budget management, and validation
 */
export class ContextPackRunner {
  private plan: ContextPackPlan;

  constructor(plan: ContextPackPlan) {
    this.plan = plan;
  }

  async execute(): Promise<ContextPackRunResult> {
    const errorFormatter = new ErrorFormatter();

    // Show progress for collector execution
    if (!this.plan.config.verbose) {
      for (const collector of this.plan.collectors) {
        console.log(`[${collector.name}] Processing ${this.plan.files.length} files`);
      }
    }

    // Step 1: Run collectors with error handling and health tracking
    const collectorResults = await CollectorRunner.runCollectors(this.plan.collectors, this.plan.context, {
      timeout: 30000,
      memoryLimitMB: 500,
      retries: this.plan.config.strict ? 0 : 1, // Retry once for non-strict mode
      concurrency: this.plan.config.concurrency ?? 3 // Bounded concurrency (default: 3)
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
    if (this.plan.config.strict && collectorErrors.some(e => !e.recoverable)) {
      throw new Error(`Critical collector failures in strict mode`);
    }

    // Step 2: Apply budget constraints
    const budgetManager = new BudgetManager({
      totalBytes: this.plan.config.budgetBytes
    });

    const { artifacts: finalArtifacts, downsampling } = budgetManager.enforce(allArtifacts);

    // Step 3: Optional scoped pack generation (disabled for now to avoid cycles)
    let scopedArtifacts: Artifact[] = [];
    // TODO: Re-enable scoped functionality after breaking cross-feature cycles
    // if (this.plan.config.scope) {
    //   // Scoped functionality temporarily disabled to break cycles
    // }

    // Show results for each successful collector
    for (const result of collectorResults) {
      if (result.artifacts.length > 0 && !result.error) {
        const size = result.artifacts.reduce((sum, a) => sum + a.sizeHint, 0);
        const sizeStr = this.plan.config.verbose ? ` (${size.toLocaleString()} bytes)` : '';
        console.log(`[${result.health.name}] Generated ${result.artifacts.length > 1 ? `${result.artifacts[0].kind} with ${result.artifacts.length} entries` : result.artifacts[0].kind}${sizeStr}`);
      }
    }

    if (this.plan.config.verbose && downsampling.length > 0) {
      console.log(`Applied ${downsampling.length} downsampling decisions`);
    }

    // Step 4: Schema validation
    let validationStats: ValidationStats | undefined;
    let validationFailures: Array<{ artifactId: string; field: string; message: string }> = [];
    const failedCollectorNames = CollectorRunner.getFailedCollectorNames(collectorResults);
    let strictValidationError: Error | undefined;

    if (this.plan.config.validateSchemas) {
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
      if (this.plan.config.verbose) {
        if (validation.errorCount > 0) {
          console.log(`  Validation errors: ${validation.errorCount}`);
        }
        if (validation.warningCount > 0) {
          console.log(`  Validation warnings: ${validation.warningCount}`);
        }
      }

      // Prepare validation errors for strict mode (but don't throw yet)
      if (this.plan.config.strict && validation.errorCount > 0) {
        console.error('\nValidation errors found:');
        for (const result of validation.results) {
          for (const error of result.errors) {
            console.error(`  ${error.artifactId}: ${error.field} - ${error.message}`);
          }
        }
        strictValidationError = new Error(`Schema validation failed: ${validation.errorCount} errors found`);
      }

      // Handle validate-only mode
      if (this.plan.config.validateOnly) {
        console.log(`\nValidation complete:`);
        console.log(`  Total artifacts: ${validation.totalArtifacts}`);
        console.log(`  Valid: ${validation.validArtifacts}`);
        console.log(`  Errors: ${validation.errorCount}`);
        console.log(`  Warnings: ${validation.warningCount}`);

        if (validation.errorCount > 0) {
          throw new Error(`Validation failed with ${validation.errorCount} errors`);
        }

        // Return early for validate-only mode
        return {
          artifacts: finalArtifacts,
          scopedArtifacts,
          packMetadata: {},
          errorFormatter,
          validationStats,
          healthSummary,
          healths,
          validationFailures,
          strictValidationError
        };
      }
    }

    // Step 5: Generate pack metadata with health information
    const packGenerator = new PackGenerator(this.plan.rootPath, this.plan.config);
    const totalSize = finalArtifacts.reduce((sum, a) => sum + a.sizeHint, 0);
    const packMetadata = await packGenerator.generatePackMetadata(
      totalSize,
      downsampling,
      {
        detectedPreset: this.plan.detection.preset?.name,
        collectorCount: this.plan.collectors.length,
        fileCount: this.plan.files.length,
        ...(validationStats && {
          validation: {
            enabled: this.plan.config.validateSchemas,
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

    return {
      artifacts: finalArtifacts,
      scopedArtifacts,
      packMetadata,
      errorFormatter,
      validationStats,
      healthSummary,
      healths,
      validationFailures,
      strictValidationError
    };
  }
}