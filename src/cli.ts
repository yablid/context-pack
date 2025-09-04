#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

program
  .name('context-pack')
  .description('Deterministic CLI for creating language-aware context packs of codebases')
  .version(packageJson.version);

// Main command
program
  .argument('<path>', 'Path to the codebase to analyze')
  .option('--preset <name>', 'Preset configuration (e.g., ts-pnpm)', 'ts-pnpm')
  .option('--language <lang>', 'Force language detection (auto|ts|py)', 'auto')
  .option('--packages <globs>', 'Limit to specific packages (glob patterns)')
  // Tests expect --budget; keep --budget-bytes as a legacy alias
  .option('--budget <n>', 'Maximum pack size in bytes')
  .option('--budget-bytes <n>', 'Maximum pack size in bytes (alias of --budget)')

  .option('--exclude <globs>', 'Extra ignore patterns (comma-separated)')
  // Accept both, but only one default to avoid alias override.
  .option('--risk <profile>', 'Risk profile (safe|normal|extended)', 'safe')
  .option('--risk-profile <profile>', 'Risk profile alias (safe|normal|extended)')
  .option('--out <dir>', 'Output directory or zip file', './.contextpack')
  .option('--level <level>', 'Detail level (summary|contracts|full-api|deep)', 'contracts')
  .option('--deterministic', 'Ensure deterministic output', true)
  .option('--format <format>', 'Output format (json|ndjson)', 'json')
  .option('--verbose', 'Verbose output', false)
  .option('--strict', 'Strict mode - fail on validation errors', false)
  .option('--validate', 'Enable schema validation', true)
  .option('--validate-only', 'Only validate artifacts, do not generate pack', false)
  .option('--allow-api-change', 'Allow public API changes in CI mode', false)
  .action(async (path, options) => {
    try {
      console.log('Context Pack CLI v' + packageJson.version);
      
      // Import validation utilities
      const { CLIValidator } = await import('./utils/cli-validators.js');
      const { ContextPackEngine } = await import('./engine/context-pack-engine.js');
      const { BudgetManager } = await import('./engine/budget-manager.js');
      const { ErrorFormatter, formatError } = await import('./errors/error-formatter.js');
      
      // Validate CLI arguments
      const validatedOptions = CLIValidator.validateOptions({
        preset: options.preset,
        level: options.level,
        budgetBytes: options.budgetBytes,
        riskProfile: options.riskProfile ?? options.risk,
        packages: options.packages,
        exclude: options.exclude,
        out: options.out,
        format: options.format,
        strict: options.strict,
        validate: options.validate,
        validateOnly: options.validateOnly,
        verbose: options.verbose,
        deterministic: options.deterministic,
        allowApiChange: options.allowApiChange,
        language: options.language
      });

      const validatedPath = CLIValidator.validatePathArgument(path);

      // Override budget if explicitly provided
      const budgetInput = options.budget ?? options.budgetBytes;
      if (budgetInput) {
        // Already validated by CLIValidator
        validatedOptions.budgetBytes = CLIValidator.parseBudgetBytes(budgetInput);
      } else {
        // Use level-based budget
        validatedOptions.budgetBytes = BudgetManager.calculateBudgetForLevel(validatedOptions.level);
      }

      const engine = new ContextPackEngine(validatedPath, validatedOptions);
      await engine.generate();
      
    } catch (error) {
      // Centralized exit & printing here (engine should not call process.exit()).
      const { ErrorFormatter } = await import('./errors/error-formatter.js');
      const { wrapError } = await import('./errors/index.js');
      const wrapped = wrapError(error);
      // If engine attached a formatter (aggregated collector errors), use it.
      // Otherwise, create a fresh one for the wrapped error.
      const attached = (error as any)?._formatter;
      const formatter = attached && typeof attached.format === 'function'
        ? attached
        : new ErrorFormatter([wrapped]);
      console.error(formatter.format('cli'));
      process.exit(formatter.getExitCode());
    }
  });

// Detect subcommand
program
  .command('detect')
  .argument('<path>', 'Path to analyze')
  .option('--verbose', 'Verbose output')
  .description('Detect ecosystems and available collectors')
  .action(async (path, options) => {
    try {
      const { DetectorRegistry } = await import('./detectors/detector-registry.js');
      const registry = new DetectorRegistry();
      
      const results = await registry.detectAll({
        rootPath: path,
        verbose: options.verbose
      });
      
      console.log('\n=== Detection Results ===\n');
      
      console.log('Monorepo indicators:');
      if (results.monorepos.length === 0) {
        console.log('  None detected');
      } else {
        for (const mono of results.monorepos) {
          console.log(`  ${mono.name} (confidence: ${Math.round(mono.confidence * 100)}%)`);
          if (options.verbose && mono.metadata) {
            console.log(`    metadata:`, mono.metadata);
          }
        }
      }
      
      console.log('\nLanguage indicators:');
      if (results.languages.length === 0) {
        console.log('  None detected');
      } else {
        for (const lang of results.languages) {
          console.log(`  ${lang.name} (confidence: ${Math.round(lang.confidence * 100)}%)`);
          if (options.verbose && lang.metadata) {
            console.log(`    metadata:`, lang.metadata);
          }
        }
      }
      
      console.log('\nRecommended preset:');
      if (results.preset) {
        console.log(`  ${results.preset.name} (confidence: ${Math.round(results.preset.confidence * 100)}%)`);
        console.log(`  ${results.preset.metadata.description}`);
        if (results.preset.metadata.collectors) {
          console.log(`  collectors: ${(results.preset.metadata.collectors as string[]).join(', ')}`);
        }
        if (results.preset.metadata.status === 'not-implemented') {
          console.log(`  ⚠️  This preset is not yet implemented`);
        }
      } else {
        console.log('  No suitable preset found');
      }
      
      console.log('\nAvailable presets:');
      for (const preset of registry.getAvailablePresets()) {
        console.log(`  ${preset}: ${registry.getPresetDescription(preset)}`);
      }
      
    } catch (error) {
      console.error('Detection failed:', error);
      process.exit(1);
    }
  });

// Validate subcommand
program
  .command('validate')
  .argument('<pack>', 'Path to context pack directory to validate')
  .option('--verbose', 'Verbose validation output', false)
  .option('--strict', 'Fail on any validation errors', false)
  .description('Validate existing context pack against schemas')
  .action(async (pack, options) => {
    try {
      const { schemaValidator } = await import('./engine/schema-validator.js');
      const { readFile, readdir, stat } = await import('node:fs/promises');
      const { join, extname } = await import('node:path');
      
      console.log(`Validating context pack: ${pack}\n`);
      
      // Recursively load artifacts from the pack directory and parse content
      const artifacts: any[] = [];
      const walk = async (dir: string, rel: string = ''): Promise<void> => {
        const entries = await readdir(dir);
        for (const name of entries) {
          const full = join(dir, name);
          const relPath = rel ? `${rel}/${name}` : name;
          const st = await stat(full);
          if (st.isDirectory()) {
            await walk(full, relPath);
            continue;
          }
          if (!(name.endsWith('.json') || name.endsWith('.ndjson') || name.endsWith('.d.ts'))) continue;
          const content = await readFile(full, 'utf-8');
          // Determine schema ID from relative path
          let schemaId: string | undefined;
          if (relPath === '00-pack.json') schemaId = '00-pack';
          else if (relPath === '10-repo-topology.json') schemaId = '10-repo-topology';
          else if (relPath === '20-files-manifest.ndjson') schemaId = '20-files-manifest';
          else if (relPath === '30-import-graph.json') schemaId = '30-import-graph';
          else if (relPath === '40-duplication-report.json') schemaId = '40-duplication-report';
          else if (relPath.startsWith('ts/')) {
            const base = relPath.replace(/^ts\//, '').replace(/\.json$|\.d\.ts$/g, '');
            schemaId = `ts/${base}`;
          }
          if (!schemaId) continue; // Skip unknowns
          const ext = extname(name);
          const isJsonLike = ext === '.json' || ext === '.ndjson';
          const artifact: any = {
            id: relPath,
            filename: relPath,
            kind: isJsonLike ? 'json' : 'text',
            schemaId,
            sizeHint: Buffer.byteLength(content, 'utf-8'),
          };
          if (ext === '.ndjson') {
            // Keep as text for line-by-line validation in SchemaValidator
            artifact.text = content;
          } else if (ext === '.json') {
            artifact.data = JSON.parse(content);
          } else {
            artifact.text = content;
          }
          artifacts.push(artifact);
        }
      };
      await walk(pack);
      
      if (artifacts.length === 0) {
        console.log('No artifacts found to validate');
        process.exit(1);
      }
      
      console.log(`Found ${artifacts.length} artifacts to validate\n`);
      
      // Perform validation
      const validation = schemaValidator.validateArtifacts(artifacts);
      
      // Report results
      console.log('=== Validation Results ===');
      console.log(`Total artifacts: ${validation.totalArtifacts}`);
      console.log(`Valid artifacts: ${validation.validArtifacts}`);
      console.log(`Errors: ${validation.errorCount}`);
      console.log(`Warnings: ${validation.warningCount}`);
      console.log(`Schemas covered: ${validation.schemasCovered.join(', ')}`);
      
      if (options.verbose || validation.errorCount > 0) {
        console.log('\n=== Detailed Results ===');
        for (let i = 0; i < validation.results.length; i++) {
          const result = validation.results[i];
          const artifact = artifacts[i];
          
          if (result.errors.length > 0 || (options.verbose && result.warnings.length > 0)) {
            console.log(`\n${artifact.id} (${artifact.schemaId}):`);
            
            for (const error of result.errors) {
              console.log(`  ❌ ${error.field}: ${error.message}`);
            }
            
            if (options.verbose) {
              for (const warning of result.warnings) {
                console.log(`  ⚠️  ${warning.field}: ${warning.message}`);
                if (warning.suggestion) {
                  console.log(`      💡 ${warning.suggestion}`);
                }
              }
            }
          } else if (options.verbose) {
            console.log(`\n${artifact.id} (${artifact.schemaId}): ✅ Valid`);
          }
        }
      }
      
      const hasErrors = validation.errorCount > 0;
      if (hasErrors) {
        console.log('\n❌ Validation failed');
        if (options.strict) {
          process.exit(1);
        }
      } else {
        console.log('\n✅ All artifacts are valid');
      }
      
    } catch (error) {
      console.error('Validation failed:', error);
      process.exit(1);
    }
  });

// Schema subcommand
program
  .command('schema')
  .option('--id <schemaId>', 'Print specific schema by ID')
  .description('Print JSON schemas for artifact validation')
  .action(async (options) => {
    try {
      const { readFile, readdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      // Resolve schemas relative to installed package (fallback to CWD)
      const candidates = [
        fileURLToPath(new URL('../schemas', import.meta.url)),
        fileURLToPath(new URL('../../schemas', import.meta.url)),
        join(process.cwd(), 'schemas'),
      ];
      let schemaDir: string | undefined;
      for (const c of candidates) {
        try { await readdir(c); schemaDir = c; break; } catch {}
      }
      if (!schemaDir) {
        console.error('Could not locate schemas directory.');
        process.exit(1);
      }
      
      if (options.id) {
        // Print specific schema
        try {
          const schemaPath = join(schemaDir, options.id);
          const schema = await readFile(schemaPath, 'utf-8');
          console.log(schema);
        } catch (error) {
          console.error(`Schema not found: ${options.id}`);
          process.exit(1);
        }
      } else {
        // Print all schemas
        try {
          const files = await readdir(schemaDir);
          const schemaFiles = files
            .filter(f => f.endsWith('.json'))
            .map(f => join(schemaDir, f));
          
          console.log('Available JSON Schemas:\n');
          
          for (const schemaFile of schemaFiles.sort()) {
            const fileName = schemaFile.split('/').pop() || '';
            const content = await readFile(schemaFile, 'utf-8');
            const schema = JSON.parse(content);
            
            console.log(`=== ${fileName} ===`);
            console.log(`Title: ${schema.title}`);
            console.log(`ID: ${schema.$id || 'N/A'}`);
            if (schema.description) {
              console.log(`Description: ${schema.description}`);
            }
            console.log('');
          }
          
          console.log('Use --id <schema-file> to output a specific schema for validation.');
          
        } catch (error) {
          console.error('Could not read schemas:', error);
          process.exit(1);
        }
      }
    } catch (error) {
      console.error('Schema command failed:', error);
      process.exit(1);
    }
  });

// Summarize subcommand
program
  .command('summarize')
  .argument('<pack>', 'Path to context pack directory')
  .description('Generate human-readable summary of context pack')
  .action((pack) => {
    console.log('Summarizing pack:', pack);
    console.log('Implementation coming soon...');
    process.exit(1);
  });

program.parse();