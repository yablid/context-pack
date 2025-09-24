#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

// Exit codes for agent workflows
const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC_ERROR: 1,
  INVALID_ARGS: 2,
  VALIDATION_FAILED: 3,
  BUDGET_EXCEEDED: 4,
  COLLECTOR_FAILURE: 5
} as const;

interface CLIArgs {
  path: string;
  preset: string;
  level: 'summary' | 'contracts' | 'full-api' | 'deep';
  budgetBytes: number;
  riskProfile: 'safe' | 'normal' | 'extended' | 'minimal';
  packages?: string[];
  exclude?: string[];
  out: string;
  format: 'json' | 'ndjson';
  verbose: boolean;
  strict: boolean;
  validateSchemas: boolean;
  validateOnly: boolean;
  deterministic: boolean;
  hashFiles: boolean;
  maxHashFileSizeMB: number;
  concurrency: number;
  // Scoped pack args
  scope?: string;
  scopeAllowCode: boolean;
  scopeBudget: number;
  scopeMode: 'static' | 'hybrid';
  scopeInclude?: string[];
  scopePlanOnly: boolean;
  scopeIncludeNonExported: boolean;
  scopeTsconfig?: string;
  // Refactor report args
  refactorReport: boolean;
  refactorFormat: 'json' | 'paste';
  refactorImportGraph?: string;
  refactorExports?: string;
  // Paste pack args
  pastePack: boolean;
  pasteAllowCode: boolean;
  pasteInclude?: string[];
  pasteExclude?: string[];
  pasteMaxFiles: number;
  pasteMaxLoc: number;
  pasteMaxBytes: number;
  // New intuitive aliases for paste filtering
  ex?: string[];
  only?: string[];
  // Agent-friendly output
  printJson: boolean;
  print?: 'slices' | 'graph' | 'scope' | 'index';
  emitPrompt: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);

  // Show help
  if (args.includes('--help-all')) {
    showAdvancedHelp();
    process.exit(0);
  }
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  // Show version
  if (args.includes('--version') || args.includes('-v')) {
    console.log(packageJson.version);
    process.exit(0);
  }

  // TODO: Handle subcommands later
  // if (args[0] === 'detect') {
  //   return handleDetectCommand(args.slice(1));
  // }

  // Main generate command
  const path = args.find(arg => !arg.startsWith('--')) || '.';

  const getFlag = (name: string): boolean => args.includes(`--${name}`);
  const getValue = (name: string, defaultValue: string): string => {
    const flag = args.find(arg => arg.startsWith(`--${name}=`));
    if (flag) return flag.split('=')[1];

    const flagIndex = args.findIndex(arg => arg === `--${name}`);
    if (flagIndex >= 0 && flagIndex < args.length - 1) {
      return args[flagIndex + 1];
    }

    return defaultValue;
  };

  const getNumber = (name: string, defaultValue: number): number => {
    const value = getValue(name, String(defaultValue));
    const parsed = parseInt(value);
    return isNaN(parsed) ? defaultValue : parsed;
  };

  const getArray = (name: string): string[] | undefined => {
    const value = getValue(name, '');
    return value ? value.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  };

  const result = {
    path,
    preset: getValue('preset', 'ts-pnpm'),
    level: getValue('level', 'contracts') as CLIArgs['level'],
    budgetBytes: getNumber('budget', getNumber('budget-bytes', 1500000)),
    riskProfile: getValue('risk-profile', getValue('risk', 'safe')) as CLIArgs['riskProfile'],
    packages: getArray('packages'),
    exclude: getArray('exclude'),
    out: getValue('out', './.contextpack'),
    format: getValue('format', 'json') as CLIArgs['format'],
    verbose: getFlag('verbose'),
    strict: getFlag('strict'),
    validateSchemas: !getFlag('no-validate'),
    validateOnly: getFlag('validate-only'),
    deterministic: !getFlag('no-deterministic'),
    hashFiles: !getFlag('no-hash-files'),
    maxHashFileSizeMB: getNumber('max-hash-file-size', 10),
    concurrency: getNumber('concurrency', 3),
    // Scoped pack flags
    scope: getValue('scope', '').trim() || undefined,
    scopeAllowCode: getFlag('scope-allow-code') || (!getFlag('no-code') && !!getValue('scope', '').trim()),
    scopeBudget: getNumber('scope-budget', 20000),
    scopeMode: getValue('scope-mode', 'static') as CLIArgs['scopeMode'],
    scopeInclude: getArray('scope-include'),
    scopePlanOnly: getFlag('scope-plan-only'),
    scopeIncludeNonExported: getFlag('scope-include-non-exported'),
    scopeTsconfig: getValue('scope-tsconfig', '').trim() || undefined,
    // Refactor report flags
    refactorReport: getFlag('refactor-report'),
    refactorFormat: getValue('refactor-format', 'json') as CLIArgs['refactorFormat'],
    refactorImportGraph: getValue('refactor-import-graph', '').trim() || undefined,
    refactorExports: getValue('refactor-exports', '').trim() || undefined,
    // Paste pack flags
    pastePack: getFlag('paste-pack') || getFlag('paste'),
    pasteAllowCode: getFlag('paste-allow-code'),
    pasteInclude: getArray('paste-include'),
    pasteExclude: getArray('paste-exclude'),
    pasteMaxFiles: getNumber('paste-max-files', 100),
    pasteMaxLoc: getNumber('paste-max-loc', 50000),
    pasteMaxBytes: getNumber('paste-max-bytes', 2000000),
    // New intuitive aliases for paste filtering
    ex: getArray('ex'),
    only: getArray('only'),
    // Agent-friendly output flags
    printJson: getFlag('print-json'),
    print: (getValue('print', '').trim() || undefined) as CLIArgs['print'],
    emitPrompt: getFlag('emit-prompt')
  };

  // Validate --print argument
  const parsed = getValue('print', '').trim();
  if (parsed && !['slices', 'graph', 'scope', 'index'].includes(parsed)) {
    console.error(`Invalid --print value: ${parsed}. Must be one of: slices, graph, scope, index`);
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  return result;
}

function showHelp() {
  console.log(`
Context Pack CLI v${packageJson.version}

USAGE:
  context-pack [path]           Generate context pack (default)
  context-pack [path] --scope   Generate scoped pack for symbol
  context-pack [path] --paste   Generate single-file directory dump

COMMON OPTIONS:
  --out <dir>               Output directory (default: ./.contextpack)
  --level <level>           Detail level: summary|contracts|full-api|deep (default: contracts)
  --verbose                 Verbose output
  -h, --help                Show this help
  --help-all                Show all advanced options
  -v, --version             Show version

SCOPED PACK:
  --scope <fqn>             Symbol to analyze (path#symbol or path#line:col)
  --scope-budget <tokens>   Token budget (default: 20000)
  --scope-plan-only         Generate scope and graph only (for budget planning)
  --no-code                 Exclude code bodies (include by default)

PASTE PACK:
  --paste                   Alias for --paste-pack
  --paste-pack              Generate single-file directory dump (outputs to stdout)
  --paste-max-files <num>   Maximum files to include (default: 100)
  --paste-max-loc <num>     Maximum lines of code (default: 50000)
  --paste-allow-code        Include full code bodies
  --ex <patterns>           Exclude directories/files (comma-separated)
  --only <patterns>         Include only matching patterns (comma-separated)

EXAMPLES:
  context-pack                                    # Current directory
  context-pack /path/to/project                   # Specific directory
  context-pack . --scope src/api.ts#handleUser   # Function context
  context-pack . --paste > output.txt            # Directory dump to file
  context-pack . --paste --ex node_modules,dist > clean.txt  # Exclude directories
  context-pack . --paste --only "*.json" > packagejsonlist.txt  # JSON files only

ADVANCED OPTIONS (use --help-all for complete list):
  --preset, --budget, --packages, --exclude, --format, --concurrency
  --refactor-report, --print-json, --emit-prompt, and more...
`);
}

function showAdvancedHelp() {
  console.log(`
Context Pack CLI v${packageJson.version} - Advanced Options

GENERATION OPTIONS:
  --preset <name>           Preset configuration (default: ts-pnpm)
  --budget <bytes>          Maximum pack size in bytes (default: 1500000)
  --risk-profile <profile>  Risk profile: safe|normal|extended|minimal (default: safe)
  --packages <globs>        Limit to specific packages (comma-separated)
  --exclude <globs>         Extra ignore patterns (comma-separated)
  --format <format>         Output format: json|ndjson (default: json)
  --strict                  Strict mode - fail on validation errors
  --no-validate             Disable schema validation
  --no-deterministic        Disable deterministic output
  --no-hash-files           Disable SHA-256 hashing of files
  --max-hash-file-size <mb> Maximum file size to hash in MB (default: 10)
  --concurrency <num>       Max concurrent collectors (default: 3)

SCOPED PACK (ADVANCED):
  --scope-allow-code        Explicit code bodies flag (enabled by default)
  --scope-mode <mode>       Analysis mode: static|hybrid (default: static)
  --scope-include <list>    Include tests,docs (comma-separated)
  --scope-include-non-exported  Include non-exported symbols (default: false)
  --scope-tsconfig <path>   Override tsconfig.json path

REFACTOR REPORT:
  --refactor-report         Generate structural refactor report
  --refactor-format <fmt>   Output format: json|paste (default: json)
  --refactor-import-graph <path>  Path to import-graph.json (optional)
  --refactor-exports <path> Path to exports.json (optional)

PASTE PACK (ADVANCED):
  --paste-include <globs>   Include patterns (comma-separated)
  --paste-exclude <globs>   Exclude patterns (comma-separated)
  --ex <patterns>           Exclude directories/files (alias for exclude)
  --only <patterns>         Include only matching patterns (alias for include)
  --paste-max-bytes <num>   Maximum bytes (default: 2000000)

  NOTE: Paste pack outputs to stdout. Use redirection: context-pack . --paste > file.txt
  EXAMPLES: --ex node_modules,dist,*.log  --only "*.ts,*.js"

AGENT-FRIENDLY OUTPUT:
  --print-json              Print artifact paths as JSON to stdout after success
  --print <artifact>        Print specific artifact to stdout (slices|graph|scope|index)
  --emit-prompt             Generate 99-prompt.txt for direct LLM consumption
`);
}

// TODO: Add subcommands back later

// Main execution
async function main() {
  try {
    const config = parseArgs();
    console.log('Context Pack CLI v' + packageJson.version);

    // Handle scoped pack separately for clean integration
    if (config.scope) {
      await handleScopedPack(config);
      return;
    }

    // Handle refactor report separately
    if (config.refactorReport) {
      await handleRefactorReport(config);
      return;
    }

    // Handle paste pack separately
    if (config.pastePack) {
      await handlePastePack(config);
      return;
    }

    const { ContextPackEngine } = await import('./engine/context-pack-engine.js');

    if (config.validateOnly) {
      console.log('TODO: Implement validate-only mode');
      return;
    }

    const buildConfig = {
      level: config.level,
      budgetBytes: config.budgetBytes,
      riskProfile: config.riskProfile,
      preset: config.preset,
      packages: config.packages,
      exclude: config.exclude,
      deterministic: config.deterministic,
      format: config.format,
      verbose: config.verbose,
      strict: config.strict,
      validateSchemas: config.validateSchemas,
      validateOnly: config.validateOnly,
      out: config.out,
      hashFiles: config.hashFiles,
      maxHashFileSizeMB: config.maxHashFileSizeMB,
      // Scope configuration
      ...(config.scope && {
        scope: {
          seed: config.scope,
          budgetTokens: config.scopeBudget,
          budgetBytes: config.budgetBytes,
          mode: config.scopeMode,
          allowCodeBodies: config.scopeAllowCode,
          include: {
            tests: config.scopeInclude?.includes('tests'),
            docs: config.scopeInclude?.includes('docs')
          },
          planOnly: config.scopePlanOnly
        }
      }),
      // Agent-friendly output configuration
      ...(config.printJson || config.print || config.emitPrompt ? {
        agentOutput: {
          printJson: config.printJson,
          printArtifact: config.print,
          emitPrompt: config.emitPrompt
        }
      } : {})
    };

    const engine = new ContextPackEngine(config.path, buildConfig);
    await engine.generate();

  } catch (error: any) {
    const { formatError } = await import('./errors/error-formatter.js');
    const { BaseError } = await import('./errors/public.js');

    console.error(formatError(error));

    // Get proper exit code
    let exitCode = 1;
    if (error instanceof BaseError) {
      exitCode = error.getExitCode();
    } else if (typeof error.code === 'number') {
      exitCode = error.code;
    }

    process.exit(exitCode);
  }
}

/**
 * Handle scoped pack generation
 */
async function handleScopedPack(config: CLIArgs) {
  const { PlanOnlyService } = await import('./features/scoped-pack/plan-only-service.js');
  const { TsProgramService } = await import('./core/ts-program/service.js');
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  try {
    // Find appropriate tsconfig for the seed
    let tsconfigPath = config.scopeTsconfig;
    if (!tsconfigPath && config.scope) {
      const seedPath = config.scope.split('#')[0].split(':')[0];
      tsconfigPath = TsProgramService.findNearestTsConfig(seedPath);
    }

    // Initialize services
    const tsService = new TsProgramService(config.path, tsconfigPath);
    await tsService.initialize();

    const planOnlyService = new PlanOnlyService(tsService, config.path);

    // Build scoped configuration
    const scopedConfig = {
      planOnly: {
        seed: config.scope as any,
        rootPath: config.path,
        maxDepth: 2,
        maxFiles: 50,
        maxLoc: 10000,
        maxBytes: 500000,
        includeTests: config.scopeInclude?.includes('tests'),
        includeDocs: config.scopeInclude?.includes('docs'),
        includeNonExported: config.scopeIncludeNonExported,
        tsconfig: tsconfigPath,
      },
      paste: config.scopePlanOnly ? undefined : {
        budgetTokens: config.scopeBudget,
        budgetBytes: config.budgetBytes,
        budgetFiles: 50,
        budgetLoc: 10000,
        allowCodeBodies: config.scopeAllowCode,
        redactSecrets: true,
      },
    };

    if (config.scopePlanOnly) {
      // Generate plan-only output (JSON)
      const index = await planOnlyService.generateIndex(scopedConfig.planOnly);

      // Handle output
      if (config.printJson || config.print === 'scope') {
        console.log(JSON.stringify(index, null, 2));
      } else {
        const outputDir = join(config.out, 'scoped');
        await mkdir(outputDir, { recursive: true });
        const outputPath = join(outputDir, '00-scope.json');
        await writeFile(outputPath, JSON.stringify(index, null, 2));
        console.log(`✓ Scoped plan written to ${outputPath}`);
        console.log(`  - Total nodes: ${index.stats.totalNodes}`);
        console.log(`  - Total edges: ${index.stats.totalEdges}`);
        console.log(`  - Files: ${index.stats.filesEmitted}`);
        console.log(`  - Depth: ${index.stats.depthUsed}`);
        console.log(`  - Truncated: ${index.stats.truncated}`);
      }
    } else {
      // Generate paste output
      const files: any[] = []; // TODO: Get actual file info if needed
      const pasteString = await planOnlyService.generatePasteString(scopedConfig as any, files);

      // Handle output
      if (config.print === 'slices' || config.printJson) {
        console.log(pasteString);
      } else {
        const outputDir = join(config.out, 'scoped');
        await mkdir(outputDir, { recursive: true });
        const outputPath = join(outputDir, '99-paste.txt');
        await writeFile(outputPath, pasteString);
        console.log(`✓ Scoped paste written to ${outputPath}`);

        // Extract metrics from paste
        const lines = pasteString.split('\n');
        const summaryIndex = lines.findIndex(l => l.includes('==== SUMMARY ===='));
        if (summaryIndex > 0 && summaryIndex < lines.length - 5) {
          console.log('Summary:');
          for (let i = summaryIndex + 1; i < Math.min(summaryIndex + 10, lines.length); i++) {
            const line = lines[i];
            if (line.includes('====')) break;
            console.log(`  ${line}`);
          }
        }
      }
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error: any) {
    const { formatError } = await import('./errors/error-formatter.js');
    console.error(formatError(error));

    // Map error to exit code
    let exitCode: number = EXIT_CODES.GENERIC_ERROR;
    if (error.message?.includes('Invalid seed') || error.message?.includes('SEED_NOT_FOUND')) {
      exitCode = EXIT_CODES.INVALID_ARGS;
    } else if (error.message?.includes('budget') || error.message?.includes('truncated')) {
      exitCode = EXIT_CODES.BUDGET_EXCEEDED;
    } else if (error.message?.includes('validation')) {
      exitCode = EXIT_CODES.VALIDATION_FAILED;
    }

    process.exit(exitCode);
  }
}

/**
 * Handle paste pack generation
 */
async function handlePastePack(config: CLIArgs) {
  try {
    const { PastePackService } = await import('./features/paste-pack/service.js');

    const pasteConfig = {
      rootPath: config.path,
      outputPath: config.out,
      allowCodeBodies: config.pasteAllowCode,
      format: 'paste' as const,
      budgets: {
        maxFiles: config.pasteMaxFiles,
        maxLoc: config.pasteMaxLoc,
        maxBytes: config.pasteMaxBytes,
      },
      include: (config.pasteInclude || config.only) ? {
        patterns: [...(config.pasteInclude || []), ...(config.only || [])],
      } : undefined,
      exclude: (config.pasteExclude || config.ex) ? {
        patterns: [...(config.pasteExclude || []), ...(config.ex || [])],
      } : undefined,
    };

    if (config.verbose) {
      console.log('Generating paste pack...');
      console.log(`Root path: ${pasteConfig.rootPath}`);
      console.log(`Allow code bodies: ${pasteConfig.allowCodeBodies}`);
      console.log(`Budget: ${pasteConfig.budgets.maxFiles} files, ${pasteConfig.budgets.maxLoc} LOC, ${pasteConfig.budgets.maxBytes} bytes`);
      if (pasteConfig.include?.patterns) {
        console.log(`Include patterns: ${pasteConfig.include.patterns.join(', ')}`);
      }
      if (pasteConfig.exclude?.patterns) {
        console.log(`Exclude patterns: ${pasteConfig.exclude.patterns.join(', ')}`);
      }
    }

    const service = new PastePackService();
    const { result, artifact } = await service.generatePack(pasteConfig);

    // Output the paste content
    console.log(artifact.text);

    if (config.verbose) {
      console.log('\nPaste Pack Summary:');
      console.log(`Files scanned: ${result.summary.totalFilesScanned}`);
      console.log(`Files included: ${result.summary.filesIncluded}`);
      console.log(`Files excluded: ${result.summary.filesExcluded}`);
      console.log(`Total LOC: ${result.summary.totalLoc}`);
      console.log(`Total bytes: ${result.summary.totalBytes}`);
      console.log(`Truncated: ${result.summary.truncated ? 'YES' : 'NO'}`);
      if (result.summary.truncationReason) {
        console.log(`Truncation reason: ${result.summary.truncationReason}`);
      }
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error: any) {
    const { formatError } = await import('./errors/error-formatter.js');
    console.error(formatError(error));
    process.exit(EXIT_CODES.GENERIC_ERROR);
  }
}

/**
 * Handle refactor report generation
 */
async function handleRefactorReport(config: CLIArgs) {
  try {
    const { RefactorReportService } = await import('./features/refactor-report/service.js');

    const reportConfig = {
      rootPath: config.path,
      importGraphPath: config.refactorImportGraph,
      exportsPath: config.refactorExports,
      format: config.refactorFormat,
      outputPath: config.out,
    };

    if (config.verbose) {
      console.log('Generating refactor report...');
      console.log(`Root path: ${reportConfig.rootPath}`);
      console.log(`Format: ${reportConfig.format}`);
      if (reportConfig.importGraphPath) {
        console.log(`Import graph: ${reportConfig.importGraphPath}`);
      }
      if (reportConfig.exportsPath) {
        console.log(`Exports: ${reportConfig.exportsPath}`);
      }
    }

    const service = new RefactorReportService();
    const result = await service.generateReport(reportConfig);

    // Output based on format
    if (config.refactorFormat === 'paste') {
      console.log(result.artifacts[0].text);
    } else {
      console.log(JSON.stringify(result.report, null, 2));
    }

    if (config.verbose) {
      console.log('\nRefactor Report Summary:');
      console.log(`Risk Assessment: ${result.report.summary.riskAssessment.toUpperCase()}`);
      console.log(`Cycles: ${result.report.structural.hasCycles ? 'YES' : 'NO'}`);
      console.log(`Hotspots: ${result.report.hotspots.length}`);
      console.log(`Re-export hubs: ${result.report.reexportHubs.length}`);
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error: any) {
    const { formatError } = await import('./errors/error-formatter.js');
    console.error(formatError(error));
    process.exit(EXIT_CODES.GENERIC_ERROR);
  }
}

main();