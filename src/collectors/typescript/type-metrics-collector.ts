import * as ts from 'typescript';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { BaseCollector } from '../base-collector.js';
import type { Artifact, CollectorContext } from '../../types.js';
import { CanonicalJSON } from '../../engine/canonical-json.js';

interface FileMetrics {
  file: string; // POSIX-style relative path
  metrics: TypeMetrics;
}

interface TypeMetrics {
  anyCount: number;
  unknownCount: number;
  neverCount: number;
  satisfiesCount: number;
  asConstCount: number;
  totalNodes: number;
  typeAnnotations: number;
  assertions: number;
}

interface PackageMetrics {
  packageName: string;
  dir: string;
  files: FileMetrics[];
  aggregated: TypeMetrics;
  quality: {
    anyRatio: number; // any / totalNodes
    typeAnnotationRatio: number; // typeAnnotations / totalNodes
    unknownRatio: number; // unknown / totalNodes
  };
}

// Schema-aligned interface for TypeMetrics artifact
interface TypeMetricsData {
  summary: {
    totalFiles: number;
    anyCount: number;
    unknownCount: number;
    neverCount: number;
    satisfiesCount: number;
    asConstCount: number;
    verbatimModuleSyntax: number;
  };
  byFile: Array<{
    path: string;
    anyCount: number;
    unknownCount: number;
    neverCount: number;
    satisfiesCount: number;
    asConstCount: number;
  }>;
}

export class TypeMetricsCollector extends BaseCollector {
  readonly name = 'type-metrics';
  readonly schemaIds = ['ts/90-type-metrics'];

  async detect(rootPath: string): Promise<boolean> {
    const candidates = ['tsconfig.json', 'jsconfig.json'];
    return candidates.some(config => existsSync(join(rootPath, config)));
  }

  async collect(ctx: CollectorContext): Promise<Artifact[]> {
    const packages = this.findPackages(ctx.rootPath);
    const packageMetrics: PackageMetrics[] = [];
    
    for (const pkg of packages) {
      try {
        const metrics = this.analyzePackage(pkg.dir, pkg.name, ctx.rootPath);
        packageMetrics.push(metrics);
      } catch (error) {
        console.warn(`Failed to analyze package ${pkg.name}: ${error}`);
      }
    }

    const globalMetrics = this.calculateGlobalMetrics(packageMetrics, ctx.rootPath);
    
    // Transform to schema-aligned format
    const data: TypeMetricsData = {
      summary: {
        totalFiles: globalMetrics.totals.totalNodes, // Use totalNodes as totalFiles
        anyCount: globalMetrics.totals.anyCount,
        unknownCount: globalMetrics.totals.unknownCount,
        neverCount: globalMetrics.totals.neverCount,
        satisfiesCount: globalMetrics.totals.satisfiesCount,
        asConstCount: globalMetrics.totals.asConstCount,
        verbatimModuleSyntax: globalMetrics.verbatimModuleSyntaxUsage.enabled
      },
      byFile: this.extractByFileMetrics(packageMetrics)
    };

    return [{
      id: this.name,
      filename: 'ts/90-type-metrics.json',
      kind: 'json',
      schemaId: this.schemaIds[0],
      sizeHint: CanonicalJSON.byteSize(data),
      data
    }];
  }

  private findPackages(rootPath: string): Array<{name: string, dir: string}> {
    const packages = [{ name: 'root', dir: rootPath }];
    
    const workspacePatterns = this.getWorkspacePatterns(rootPath);
    for (const pattern of workspacePatterns) {
      if (!pattern.includes('*')) {
        const packageDir = join(rootPath, pattern);
        if (existsSync(packageDir)) {
          const packageName = this.getPackageName(packageDir) || pattern.replace(/\//g, '-');!
          packages.push({ name: packageName, dir: packageDir });
        }
      }
    }

    return packages;
  }

  private getWorkspacePatterns(rootPath: string): string[] {
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
      // Fall through
    }

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

  private getPackageName(packageDir: string): string | null {
    try {
      const packageJsonPath = join(packageDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.name || null;
      }
    } catch {
      // No package.json or parse error
    }
    return null;
  }

  private analyzePackage(packageDir: string, packageName: string, rootPath: string): PackageMetrics {
    const tsConfigPath = this.findTsConfig(packageDir);
    if (!tsConfigPath) {
      return {
        packageName,
        dir: this.toPosiXPath(relative(rootPath, packageDir)),
        files: [],
        aggregated: this.createEmptyMetrics(),
        quality: { anyRatio: 0, typeAnnotationRatio: 0, unknownRatio: 0 }
      };
    }

    const program = this.createTsProgram(tsConfigPath);
    const sourceFiles = program.getSourceFiles()
      .filter(sf => !sf.fileName.includes('node_modules') && 
                   !sf.fileName.includes('dist') && 
                   !sf.fileName.endsWith('.d.ts') &&
                   sf.fileName.startsWith(packageDir));

    const fileMetrics: FileMetrics[] = [];
    
    for (const sourceFile of sourceFiles) {
      const metrics = this.analyzeSourceFile(sourceFile);
      const relativePath = this.toPosiXPath(relative(rootPath, sourceFile.fileName));
      
      fileMetrics.push({
        file: relativePath,
        metrics
      });
    }

    const aggregated = this.aggregateMetrics(fileMetrics.map(f => f.metrics));
    const quality = this.calculateQuality(aggregated);

    return {
      packageName,
      dir: this.toPosiXPath(relative(rootPath, packageDir)),
      files: fileMetrics,
      aggregated,
      quality
    };
  }

  private findTsConfig(dir: string): string | null {
    const candidates = ['tsconfig.json', 'jsconfig.json'];
    for (const candidate of candidates) {
      const configPath = join(dir, candidate);
      if (existsSync(configPath)) {
        return configPath;
      }
    }
    return null;
  }

  private createTsProgram(configPath: string): ts.Program {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(`Error reading tsconfig: ${configFile.error.messageText}`);
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(configPath)
    );

    return ts.createProgram({
      rootNames: parsedConfig.fileNames,
      options: parsedConfig.options
    });
  }

  private analyzeSourceFile(sourceFile: ts.SourceFile): TypeMetrics {
    const metrics = this.createEmptyMetrics();
    
    const visit = (node: ts.Node): void => {
      metrics.totalNodes++;
      
      // Count 'any' type references
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        metrics.anyCount++;
      }
      
      // Count 'unknown' type references
      if (node.kind === ts.SyntaxKind.UnknownKeyword) {
        metrics.unknownCount++;
      }
      
      // Count 'never' type references
      if (node.kind === ts.SyntaxKind.NeverKeyword) {
        metrics.neverCount++;
      }
      
      // Count 'satisfies' expressions
      if (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node)) {
        metrics.satisfiesCount++;
      }
      
      // Count 'as const' assertions
      if (ts.isAsExpression(node)) {
        if (node.type.kind === ts.SyntaxKind.ConstKeyword) {
          metrics.asConstCount++;
        }
        metrics.assertions++;
      }
      
      // Count type assertions (angle bracket syntax)
      if (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(node)) {
        metrics.assertions++;
      }
      
      // Count type annotations
      if (this.hasTypeAnnotation(node)) {
        metrics.typeAnnotations++;
      }
      
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return metrics;
  }

  private hasTypeAnnotation(node: ts.Node): boolean {
    // Check for explicit type annotations
    if (ts.isVariableDeclaration(node) && node.type) return true;
    if (ts.isParameter(node) && node.type) return true;
    if (ts.isFunctionDeclaration(node) && node.type) return true;
    if (ts.isMethodDeclaration(node) && node.type) return true;
    if (ts.isPropertyDeclaration(node) && node.type) return true;
    if (ts.isPropertySignature(node) && node.type) return true;
    if (ts.isGetAccessorDeclaration(node) && node.type) return true;
    if (ts.isSetAccessorDeclaration(node) && node.type) return true;
    
    return false;
  }

  private createEmptyMetrics(): TypeMetrics {
    return {
      anyCount: 0,
      unknownCount: 0,
      neverCount: 0,
      satisfiesCount: 0,
      asConstCount: 0,
      totalNodes: 0,
      typeAnnotations: 0,
      assertions: 0
    };
  }

  private aggregateMetrics(metrics: TypeMetrics[]): TypeMetrics {
    const result = this.createEmptyMetrics();
    
    for (const metric of metrics) {
      result.anyCount += metric.anyCount;
      result.unknownCount += metric.unknownCount;
      result.neverCount += metric.neverCount;
      result.satisfiesCount += metric.satisfiesCount;
      result.asConstCount += metric.asConstCount;
      result.totalNodes += metric.totalNodes;
      result.typeAnnotations += metric.typeAnnotations;
      result.assertions += metric.assertions;
    }
    
    return result;
  }

  private calculateQuality(metrics: TypeMetrics) {
    const { totalNodes, anyCount, unknownCount, typeAnnotations } = metrics;
    
    return {
      anyRatio: totalNodes > 0 ? anyCount / totalNodes : 0,
      typeAnnotationRatio: totalNodes > 0 ? typeAnnotations / totalNodes : 0,
      unknownRatio: totalNodes > 0 ? unknownCount / totalNodes : 0
    };
  }

  private calculateGlobalMetrics(packageMetrics: PackageMetrics[], rootPath: string) {
    const totals = this.aggregateMetrics(packageMetrics.map(p => p.aggregated));
    const quality = this.calculateQuality(totals);
    
    // Calculate verbatimModuleSyntax usage
    const verbatimStats = this.calculateVerbatimModuleSyntaxUsage(packageMetrics, rootPath);
    
    return {
      totals,
      quality,
      verbatimModuleSyntaxUsage: verbatimStats
    };
  }

  private calculateVerbatimModuleSyntaxUsage(packageMetrics: PackageMetrics[], rootPath: string) {
    let enabled = 0;
    let total = 0;
    
    for (const pkg of packageMetrics) {
      const tsConfigPath = this.findTsConfig(join(rootPath, pkg.dir));
      if (tsConfigPath) {
        total++;
        try {
          const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            dirname(tsConfigPath)
          );
          
          if (parsedConfig.options.verbatimModuleSyntax === true) {
            enabled++;
          }
        } catch {
          // Ignore config parsing errors
        }
      }
    }
    
    return {
      enabled,
      total,
      ratio: total > 0 ? enabled / total : 0
    };
  }

  // Extract byFile metrics from package metrics for schema compliance
  private extractByFileMetrics(packageMetrics: PackageMetrics[]): Array<{
    path: string;
    anyCount: number;
    unknownCount: number;
    neverCount: number;
    satisfiesCount: number;
    asConstCount: number;
  }> {
    const byFile: Array<{
      path: string;
      anyCount: number;
      unknownCount: number;
      neverCount: number;
      satisfiesCount: number;
      asConstCount: number;
    }> = [];

    for (const pkg of packageMetrics) {
      for (const fileMetric of pkg.files) {
        byFile.push({
          path: fileMetric.file,
          anyCount: fileMetric.metrics.anyCount,
          unknownCount: fileMetric.metrics.unknownCount,
          neverCount: fileMetric.metrics.neverCount,
          satisfiesCount: fileMetric.metrics.satisfiesCount,
          asConstCount: fileMetric.metrics.asConstCount
        });
      }
    }

    // Sort by path for deterministic output
    return byFile.sort((a, b) => a.path.localeCompare(b.path));
  }

  private toPosiXPath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}