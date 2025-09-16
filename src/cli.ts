#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

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
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);

  // Show help
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

  return {
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
    scopeAllowCode: getFlag('scope-allow-code'),
    scopeBudget: getNumber('scope-budget', 20000),
    scopeMode: getValue('scope-mode', 'static') as CLIArgs['scopeMode'],
    scopeInclude: getArray('scope-include')
  };
}

function showHelp() {
  console.log(`
Context Pack CLI v${packageJson.version}

USAGE:
  context-pack <path>           Generate context pack for directory
  context-pack detect <path>    Detect ecosystem and presets
  context-pack validate <path>  Validate existing context pack
  context-pack schema [id]      Show JSON schemas

OPTIONS:
  --preset <name>           Preset configuration (default: ts-pnpm)
  --level <level>           Detail level: summary|contracts|full-api|deep (default: contracts)
  --budget <bytes>          Maximum pack size in bytes (default: 1500000)
  --risk-profile <profile>  Risk profile: safe|normal|extended|minimal (default: safe)
  --packages <globs>        Limit to specific packages (comma-separated)
  --exclude <globs>         Extra ignore patterns (comma-separated)
  --out <dir>               Output directory (default: ./.contextpack)
  --format <format>         Output format: json|ndjson (default: json)
  --verbose                 Verbose output
  --strict                  Strict mode - fail on validation errors
  --no-validate             Disable schema validation
  --validate-only           Only validate artifacts, do not generate pack
  --no-deterministic        Disable deterministic output
  --no-hash-files           Disable SHA-256 hashing of files
  --max-hash-file-size <mb> Maximum file size to hash in MB (default: 10)
  --concurrency <num>       Max concurrent collectors (default: 3)

SCOPED PACK OPTIONS:
  --scope <fqn>             Generate scoped pack for symbol (path#symbol)
  --scope-allow-code        Allow code bodies in scoped pack (security risk)
  --scope-budget <tokens>   Token budget for scoped pack (default: 20000)
  --scope-mode <mode>       Analysis mode: static|hybrid (default: static)
  --scope-include <list>    Include tests,docs (comma-separated)

  -h, --help                Show this help
  -v, --version             Show version

EXAMPLES:
  context-pack .
  context-pack . --level summary --verbose
  context-pack . --no-hash-files --preset ts-simple
  context-pack detect .
  context-pack validate ./.contextpack --strict

SCOPED PACK EXAMPLES:
  context-pack . --scope src/engine/engine.ts#createEngine
  context-pack . --scope src/types.ts#BuildConfig --scope-allow-code
  context-pack . --scope src/utils/helper.ts#line:42:10 --scope-budget 10000
`);
}

// TODO: Add subcommands back later

// Main execution
async function main() {
  try {
    const config = parseArgs();
    console.log('Context Pack CLI v' + packageJson.version);

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
          mode: config.scopeMode,
          allowCodeBodies: config.scopeAllowCode,
          include: {
            tests: config.scopeInclude?.includes('tests'),
            docs: config.scopeInclude?.includes('docs')
          }
        }
      })
    };

    const engine = new ContextPackEngine(config.path, buildConfig);
    await engine.generate();

  } catch (error: any) {
    const { formatError } = await import('./errors/error-formatter.js');
    console.error(formatError(error));
    process.exit(error.code || 1);
  }
}

main();