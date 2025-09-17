import * as ts from 'typescript';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { BaseCollector } from '../base-collector.js';
import type { CollectorContext } from '../../../../core/contracts/collector.js';
import type { Artifact } from '../../../../core/types.js';
import { CanonicalJSON } from '../../../../core/io/canonical-json.js';

interface TsConfigInfo {
  name: string; // package name or 'root'
  dir: string; // POSIX-style relative path
  configFile: string; // relative path to tsconfig file
  resolved: ResolvedTsConfig;
  delta: TsConfigDelta;
}

interface ResolvedTsConfig {
  compilerOptions: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
  extends?: string;
  files?: string[];
}

interface TsConfigDelta {
  strict: boolean | undefined;
  target: string | undefined;
  module: string | undefined;
  moduleResolution: string | undefined;
  verbatimModuleSyntax: boolean | undefined;
  declaration: boolean | undefined;
  declarationMap: boolean | undefined;
  sourceMap: boolean | undefined;
  esModuleInterop: boolean | undefined;
  allowSyntheticDefaultImports: boolean | undefined;
  noUncheckedIndexedAccess: boolean | undefined;
  exactOptionalPropertyTypes: boolean | undefined;
}

interface TsConfigData {
  configs: TsConfigInfo[];
  summary: {
    totalConfigs: number;
    strictCount: number;
    esmCount: number;
    declarationCount: number;
    targetDistribution: Record<string, number>;
    moduleDistribution: Record<string, number>;
  };
}

export class TsConfigCollector extends BaseCollector {
  readonly name = 'ts-config';
  readonly schemaIds = ['ts/50-tsconfigs'];

  async detect(rootPath: string): Promise<boolean> {
    const candidates = ['tsconfig.json', 'jsconfig.json'];
    return candidates.some(config => existsSync(join(rootPath, config)));
  }

  async collect(ctx: CollectorContext): Promise<Artifact[]> {
    const configs = this.findAllTsConfigs(ctx.rootPath);
    const configInfos: TsConfigInfo[] = [];

    for (const configPath of configs) {
      try {
        const configInfo = this.analyzeConfig(configPath, ctx.rootPath);
        configInfos.push(configInfo);
      } catch (error) {
        console.warn(`Failed to analyze config ${configPath}: ${error}`);
      }
    }

    // Deterministic ordering
    configInfos.sort((a, b) => {
      if (a.dir === b.dir) return a.name.localeCompare(b.name);
      return a.dir.localeCompare(b.dir);
    });

    const summary = this.calculateSummary(configInfos);
    
    const data: TsConfigData = {
      configs: configInfos,
      summary
    };

    return [{
      id: this.name,
      filename: 'ts/50-tsconfigs.json',
      kind: 'json',
      schemaId: this.schemaIds[0],
      sizeHint: Buffer.byteLength(CanonicalJSON.stringify(data), 'utf-8'),
      data
    }];
  }

  private findAllTsConfigs(rootPath: string): string[] {
    const configs: string[] = [];
    
    // Root config
    const rootConfigs = ['tsconfig.json', 'jsconfig.json'];
    for (const config of rootConfigs) {
      const configPath = join(rootPath, config);
      if (existsSync(configPath)) {
        configs.push(configPath);
        break; // Only add one root config
      }
    }

    // Workspace configs
    const workspacePatterns = this.getWorkspacePatterns(rootPath);
    for (const pattern of workspacePatterns) {
      // Simple pattern matching - should use glob in production
      if (!pattern.includes('*')) {
        const packagePath = join(rootPath, pattern);
        for (const config of rootConfigs) {
          const configPath = join(packagePath, config);
          if (existsSync(configPath)) {
            configs.push(configPath);
            break;
          }
        }
      }
    }

    return configs;
  }

  private getWorkspacePatterns(rootPath: string): string[] {
    // Try pnpm-workspace.yaml
    try {
      const workspacePath = join(rootPath, 'pnpm-workspace.yaml');
      if (existsSync(workspacePath)) {
        const content = readFileSync(workspacePath, 'utf-8');
        const match = content.match(/packages:\s*\n((?:\s*-\s*['"]?[^'"]*['"]?\s*\n)*)/);
        if (match) {
          return match[1]
            .split('\n')
            .map(line => line.trim().replace(/^-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
            .filter(Boolean);
        }
      }
    } catch {
      // Fall through to package.json
    }

    // Try package.json workspaces
    try {
      const packageJsonPath = join(rootPath, 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.workspaces) {
          return Array.isArray(packageJson.workspaces) 
            ? packageJson.workspaces 
            : packageJson.workspaces.packages || [];
        }
      }
    } catch {
      // No workspace config
    }

    return [];
  }

  private analyzeConfig(configPath: string, rootPath: string): TsConfigInfo {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(`Error reading config: ${configFile.error.messageText}`);
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(configPath)
    );
    
    if (!parsedConfig.options) {
      throw new Error('Failed to parse TypeScript configuration');
    }

    const relativeDir = this.toPosiXPath(relative(rootPath, dirname(configPath)));
    const relativeConfigFile = this.toPosiXPath(relative(rootPath, configPath));
    
    const packageName = this.inferPackageName(relativeDir, configPath);

    const resolved: ResolvedTsConfig = {
      compilerOptions: parsedConfig.options || {},
      ...(configFile.config.include && { include: configFile.config.include }),
      ...(configFile.config.exclude && { exclude: configFile.config.exclude }),
      ...(configFile.config.extends && { extends: configFile.config.extends }),
      ...(configFile.config.files && { files: configFile.config.files })
    };

    const delta = this.extractDelta(parsedConfig.options);

    return {
      name: packageName,
      dir: relativeDir || '.',
      configFile: relativeConfigFile,
      resolved,
      delta
    };
  }

  private inferPackageName(relativeDir: string, configPath: string): string {
    if (!relativeDir || relativeDir === '.') {
      return 'root';
    }

    // Try to get package name from package.json
    try {
      const packageJsonPath = join(dirname(configPath), 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.name) {
          return packageJson.name;
        }
      }
    } catch {
      // Fall back to directory name
    }

    return relativeDir.replace(/\//g, '-');
  }

  private extractDelta(options: ts.CompilerOptions): TsConfigDelta {
    return {
      strict: options.strict,
      target: options.target !== undefined ? ts.ScriptTarget[options.target] : undefined,
      module: options.module !== undefined ? ts.ModuleKind[options.module] : undefined,
      moduleResolution: options.moduleResolution !== undefined ? 
        ts.ModuleResolutionKind[options.moduleResolution] : undefined,
      verbatimModuleSyntax: options.verbatimModuleSyntax,
      declaration: options.declaration,
      declarationMap: options.declarationMap,
      sourceMap: options.sourceMap,
      esModuleInterop: options.esModuleInterop,
      allowSyntheticDefaultImports: options.allowSyntheticDefaultImports,
      noUncheckedIndexedAccess: options.noUncheckedIndexedAccess,
      exactOptionalPropertyTypes: options.exactOptionalPropertyTypes
    };
  }

  private calculateSummary(configs: TsConfigInfo[]) {
    let strictCount = 0;
    let esmCount = 0;
    let declarationCount = 0;
    const targetDistribution: Record<string, number> = {};
    const moduleDistribution: Record<string, number> = {};

    for (const config of configs) {
      const { delta } = config;
      
      if (delta.strict === true) strictCount++;
      if (delta.declaration === true) declarationCount++;
      if (delta.module === 'ESNext' || delta.module === 'ES2022' || delta.module === 'ES2020') {
        esmCount++;
      }

      if (delta.target) {
        targetDistribution[delta.target] = (targetDistribution[delta.target] || 0) + 1;
      }
      
      if (delta.module) {
        moduleDistribution[delta.module] = (moduleDistribution[delta.module] || 0) + 1;
      }
    }

    return {
      totalConfigs: configs.length,
      strictCount,
      esmCount,
      declarationCount,
      targetDistribution,
      moduleDistribution
    };
  }

  private toPosiXPath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}