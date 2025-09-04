import { ZodError, type ZodSchema } from 'zod';
import type { Artifact } from '../types.js';
import { SCHEMA_REGISTRY, type SchemaId } from '../schemas/zod-schemas.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  artifactId: string;
  schemaId: string;
  field: string;
  message: string;
  value?: unknown;
}

export interface ValidationWarning {
  artifactId: string;
  schemaId: string;
  field: string;
  message: string;
  suggestion?: string;
}

export interface ValidationStats {
  totalArtifacts: number;
  validArtifacts: number;
  errorCount: number;
  warningCount: number;
  schemasCovered: string[];
}

export class SchemaValidator {
  private schemas: Map<string, ZodSchema> = new Map();
  
  constructor() {
    // Load all schemas into cache
    for (const [schemaId, schema] of Object.entries(SCHEMA_REGISTRY)) {
      this.schemas.set(schemaId, schema);
    }
  }

  /**
   * Validate a single artifact against its schema
   */
  validateArtifact(artifact: Artifact): ValidationResult {
    const schema = this.schemas.get(artifact.schemaId);
    
    if (!schema) {
      return {
        valid: false,
        errors: [{
          artifactId: artifact.id,
          schemaId: artifact.schemaId,
          field: 'schema',
          message: `Unknown schema ID: ${artifact.schemaId}`
        }],
        warnings: []
      };
    }

    try {
      // For NDJSON files (files-manifest), validate each line (text) or each entry (array)
      if (artifact.schemaId === '20-files-manifest') {
        if (artifact.text) {
          return this.validateNDJSON(artifact, schema);
        }
        // Back-compat: allow pre-parsed arrays too
        if (Array.isArray(artifact.data)) {
          return this.validateArrayEntries(artifact, schema);
        }
      }
      
      // For regular JSON artifacts
      const data = artifact.data || (artifact.text ? JSON.parse(artifact.text) : null);
      schema.parse(data);
      
      return {
        valid: true,
        errors: [],
        warnings: this.generateWarnings(artifact, data)
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          valid: false,
          errors: error.issues.map((err: any) => ({
            artifactId: artifact.id,
            schemaId: artifact.schemaId,
            field: err.path.join('.'),
            message: err.message,
            value: err.received
          })),
          warnings: []
        };
      }
      
      return {
        valid: false,
        errors: [{
          artifactId: artifact.id,
          schemaId: artifact.schemaId,
          field: 'parse',
          message: error instanceof Error ? error.message : 'Unknown parsing error'
        }],
        warnings: []
      };
    }
  }

  /**
   * Validate NDJSON content line by line
   */
  private validateNDJSON(artifact: Artifact, schema: ZodSchema): ValidationResult {
    const lines = artifact.text!.trim().split('\n').filter(line => line.trim());
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let validLines = 0;

    for (let i = 0; i < lines.length; i++) {
      try {
        const data = JSON.parse(lines[i]);
        schema.parse(data);
        validLines++;
        warnings.push(...this.generateWarnings(artifact, data, i));
      } catch (error) {
        if (error instanceof ZodError) {
          errors.push(...error.issues.map((err: any) => ({
            artifactId: artifact.id,
            schemaId: artifact.schemaId,
            field: `line[${i}].${err.path.join('.')}`,
            message: err.message,
            value: err.received
          })));
        } else {
          errors.push({
            artifactId: artifact.id,
            schemaId: artifact.schemaId,
            field: `line[${i}]`,
            message: error instanceof Error ? error.message : 'JSON parse error'
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate an array of entries as if it were NDJSON lines
   */
  private validateArrayEntries(artifact: Artifact, schema: ZodSchema): ValidationResult {
    const arr = Array.isArray(artifact.data) ? artifact.data as unknown[] : [];
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    for (let i = 0; i < arr.length; i++) {
      try {
        schema.parse(arr[i]);
        warnings.push(...this.generateWarnings(artifact, arr[i], i));
      } catch (error) {
        if (error instanceof ZodError) {
          errors.push(...error.issues.map((err: any) => ({
            artifactId: artifact.id,
            schemaId: artifact.schemaId,
            field: `line[${i}].${err.path.join('.')}`,
            message: err.message,
            value: err.received
          })));
        } else {
          errors.push({
            artifactId: artifact.id,
            schemaId: artifact.schemaId,
            field: `line[${i}]`,
            message: error instanceof Error ? error.message : 'validation error'
          });
        }
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Generate helpful warnings for common issues
   */
  private generateWarnings(artifact: Artifact, data: unknown, lineIndex?: number): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    const fieldPrefix = lineIndex !== undefined ? `line[${lineIndex}].` : '';

    // Check for common performance/quality issues
    if (artifact.schemaId === '20-files-manifest' && typeof data === 'object' && data !== null) {
      const file = data as any;
      
      // Large files warning
      if (file.bytes && file.bytes > 1_000_000) {
        warnings.push({
          artifactId: artifact.id,
          schemaId: artifact.schemaId,
          field: `${fieldPrefix}bytes`,
          message: `Large file detected: ${file.bytes} bytes`,
          suggestion: 'Consider excluding large assets from analysis'
        });
      }
      
      // Missing LOC for code files
      if (file.kind === 'code' && (!file.loc || file.loc === 0) && file.bytes > 0) {
        warnings.push({
          artifactId: artifact.id,
          schemaId: artifact.schemaId,
          field: `${fieldPrefix}loc`,
          message: 'Code file with zero lines of code',
          suggestion: 'Verify file classification or LOC counting'
        });
      }
    }

    // TypeScript config warnings
    if (artifact.schemaId === 'ts/50-tsconfigs' && typeof data === 'object' && data !== null) {
      const tsconfig = data as any;
      
      if (tsconfig.configs) {
        for (const config of tsconfig.configs) {
          if (!config.resolved?.compilerOptions?.strict) {
            warnings.push({
              artifactId: artifact.id,
              schemaId: artifact.schemaId,
              field: 'compilerOptions.strict',
              message: `TypeScript strict mode disabled in ${config.name}`,
              suggestion: 'Consider enabling strict mode for better type safety'
            });
          }
        }
      }
    }

    return warnings;
  }

  /**
   * Validate multiple artifacts and return aggregated results
   */
  validateArtifacts(artifacts: Artifact[]): ValidationStats & { results: ValidationResult[] } {
    const results = artifacts.map(artifact => this.validateArtifact(artifact));
    
    const stats: ValidationStats = {
      totalArtifacts: artifacts.length,
      validArtifacts: results.filter(r => r.valid).length,
      errorCount: results.reduce((sum, r) => sum + r.errors.length, 0),
      warningCount: results.reduce((sum, r) => sum + r.warnings.length, 0),
      schemasCovered: [...new Set(artifacts.map(a => a.schemaId))]
    };

    return { ...stats, results };
  }

  /**
   * Check if schema exists for given ID
   */
  hasSchema(schemaId: string): boolean {
    return this.schemas.has(schemaId);
  }

  /**
   * Get available schema IDs
   */
  getAvailableSchemas(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Get schema by ID for external use
   */
  getSchema(schemaId: string): ZodSchema | undefined {
    return this.schemas.get(schemaId);
  }
}

// Singleton instance for global use
export const schemaValidator = new SchemaValidator();