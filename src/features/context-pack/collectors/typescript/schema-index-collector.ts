import * as ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, relative, extname, basename } from 'path';
import { BaseCollector } from '../base-collector.js';
import type { CollectorContext } from '../../../../core/contracts/collector.js';
import type { Artifact } from '../../../../core/types.js';
import { CanonicalJSON } from '../../../../core/io/canonical-json.js';

interface SchemaFile {
  file: string; // POSIX-style relative path
  type: 'schema' | 'zod' | 'yup' | 'contract' | 'validator' | 'other';
  exports: string[]; // exported identifier names only
}

interface SchemaIndexData {
  // Align with zod schema registry: use "schemas" not "files"
  schemas: Array<{
    path: string;
    framework?: 'zod' | 'yup' | 'joi' | 'ajv' | 'custom';
    exports: string[];
  }>;
  // Extra metadata (zod allows unknown keys by default)
  summary: {
    totalFiles: number;
    totalExports: number;
    byType: Record<string, number>;
    commonPatterns: string[];
  };
}

export class SchemaIndexCollector extends BaseCollector {
  readonly name = 'schema-index';
  readonly schemaIds = ['ts/80-schema-index'];

  // Configurable patterns - could be moved to config file
  private readonly schemaPatterns = [
    /.*schema.*\.ts$/i,
    /.*zod.*\.ts$/i,
    /.*yup.*\.ts$/i,
    /.*contract.*\.ts$/i,
    /.*validator.*\.ts$/i,
    /.*validation.*\.ts$/i,
    /.*types?\.ts$/i
  ];

  async detect(rootPath: string): Promise<boolean> {
    const candidates = ['tsconfig.json', 'jsconfig.json'];
    return candidates.some(config => existsSync(join(rootPath, config)));
  }

  async collect(ctx: CollectorContext): Promise<Artifact[]> {
    const schemaFiles = this.findSchemaFiles(ctx.rootPath);
    const analyzedFiles: SchemaFile[] = [];

    const tsConfigPath = this.findTsConfig(ctx.rootPath);
    if (!tsConfigPath) {
      console.warn('No tsconfig found - schema analysis will be limited');
    }

    for (const filePath of schemaFiles) {
      try {
        const schemaFile = this.analyzeSchemaFile(filePath, ctx.rootPath, tsConfigPath);
        analyzedFiles.push(schemaFile);
      } catch (error) {
        console.warn(`Failed to analyze schema file ${filePath}: ${error}`);
      }
    }

    // Deterministic order
    analyzedFiles.sort((a, b) => a.file.localeCompare(b.file));

    const summary = this.calculateSummary(analyzedFiles);
    
    const data: SchemaIndexData = {
      schemas: analyzedFiles.map(f => ({
        path: f.file,
        framework: this.mapTypeToFramework(f.type),
        exports: f.exports
      })),
      summary
    };

    return [{
      id: this.name,
      filename: 'ts/80-schema-index.json',
      kind: 'json',
      schemaId: this.schemaIds[0],
      sizeHint: Buffer.byteLength(CanonicalJSON.stringify(data), 'utf-8'),
      data
    }];
  }

  private findSchemaFiles(rootPath: string): string[] {
    const schemaFiles: string[] = [];
    const extensions = ['.ts', '.tsx'];
    
    const walkDir = (dir: string): void => {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            // Skip common directories that won't contain schemas
            if (!entry.startsWith('.') && 
                entry !== 'node_modules' && 
                entry !== 'dist' && 
                entry !== 'build' &&
                entry !== 'coverage') {
              walkDir(fullPath);
            }
          } else if (stat.isFile() && extensions.includes(extname(entry).toLowerCase())) {
            // Check if file matches schema patterns
            if (this.matchesSchemaPattern(entry)) {
              schemaFiles.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    walkDir(rootPath);
    return schemaFiles;
  }

  private matchesSchemaPattern(filename: string): boolean {
    return this.schemaPatterns.some(pattern => pattern.test(filename));
  }

  private findTsConfig(rootPath: string): string | null {
    const candidates = ['tsconfig.json', 'jsconfig.json'];
    for (const candidate of candidates) {
      const configPath = join(rootPath, candidate);
      if (existsSync(configPath)) {
        return configPath;
      }
    }
    return null;
  }

  private analyzeSchemaFile(filePath: string, rootPath: string, tsConfigPath: string | null): SchemaFile {
    const relativePath = this.toPosiXPath(relative(rootPath, filePath));
    const filename = basename(filePath);
    const fileType = this.classifySchemaType(filename);
    
    let exports: string[] = [];

    if (tsConfigPath) {
      try {
        exports = this.extractExportsWithTypeScript(filePath, tsConfigPath);
      } catch (error) {
        console.warn(`TypeScript analysis failed for ${relativePath}, falling back to text parsing: ${error}`);
        exports = this.extractExportsWithTextParsing(filePath);
      }
    } else {
      exports = this.extractExportsWithTextParsing(filePath);
    }

    return {
      file: relativePath,
      type: fileType,
      exports: [...new Set(exports)].sort() // dedupe and sort
    };
  }

  private classifySchemaType(filename: string): SchemaFile['type'] {
    const lower = filename.toLowerCase();
    
    if (lower.includes('zod')) return 'zod';
    if (lower.includes('yup')) return 'yup';
    if (lower.includes('contract')) return 'contract';
    if (lower.includes('validator') || lower.includes('validation')) return 'validator';
    if (lower.includes('schema')) return 'schema';
    
    return 'other';
  }

  private extractExportsWithTypeScript(filePath: string, tsConfigPath: string): string[] {
    // Create a minimal program for this single file
    const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(`Error reading tsconfig: ${configFile.error.messageText}`);
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(tsConfigPath)
    );

    const program = ts.createProgram({
      rootNames: [filePath],
      options: parsedConfig.options
    });

    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error('Could not get source file from TypeScript program');
    }

    const typeChecker = program.getTypeChecker();
    const exports: string[] = [];

    // Get module symbol and its exports
    const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol) {
      const moduleExports = typeChecker.getExportsOfModule(moduleSymbol);
      for (const exportSymbol of moduleExports) {
        const name = exportSymbol.getName();
        if (name !== '__export' && name !== 'default') {
          exports.push(name);
        }
      }
    }

    // Also look for default export
    if (this.hasDefaultExport(sourceFile)) {
      exports.push('default');
    }

    return exports;
  }

  private hasDefaultExport(sourceFile: ts.SourceFile): boolean {
    let hasDefault = false;
    
    const visit = (node: ts.Node): void => {
      if (ts.isExportAssignment(node) && !node.isExportEquals) {
        hasDefault = true;
        return;
      }
      
      if (ts.isExportDeclaration(node) && !node.exportClause && !node.moduleSpecifier) {
        // export default ...
        hasDefault = true;
        return;
      }
      
      if ((ts.isFunctionDeclaration(node) || 
           ts.isClassDeclaration(node) || 
           ts.isInterfaceDeclaration(node) ||
           ts.isTypeAliasDeclaration(node)) &&
          node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) &&
          node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword)) {
        hasDefault = true;
        return;
      }
      
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return hasDefault;
  }

  private extractExportsWithTextParsing(filePath: string): string[] {
    const content = readFileSync(filePath, 'utf-8');
    const exports: string[] = [];

    // Simple regex-based extraction - not perfect but covers common cases
    const exportPatterns = [
      // export const/let/var name
      /^export\s+(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm,
      // export function name
      /^export\s+function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm,
      // export class name
      /^export\s+class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm,
      // export interface name
      /^export\s+interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm,
      // export type name
      /^export\s+type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm,
      // export enum name
      /^export\s+enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm,
      // export { name1, name2 }
      /^export\s*\{\s*([^}]+)\s*\}/gm
    ];

    for (const pattern of exportPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (pattern.source.includes('{')) {
          // Handle export { name1, name2 } case
          const exportList = match[1];
          if (exportList) {
            const names = exportList.split(',').map(name => 
              name.trim().replace(/\s+as\s+\w+/g, '').trim()
            );
            exports.push(...names);
          }
        } else {
          const name = match[1];
          if (name) {
            exports.push(name);
          }
        }
      }
    }

    // Check for default export
    if (/^export\s+default/gm.test(content)) {
      exports.push('default');
    }

    return exports.filter(name => name && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name));
  }

  private calculateSummary(files: SchemaFile[]) {
    let totalExports = 0;
    const byType: Record<string, number> = {};
    const allExports: string[] = [];

    for (const file of files) {
      totalExports += file.exports.length;
      byType[file.type] = (byType[file.type] || 0) + 1;
      allExports.push(...file.exports);
    }

    // Find common export patterns
    const exportCounts: Record<string, number> = {};
    for (const exportName of allExports) {
      exportCounts[exportName] = (exportCounts[exportName] || 0) + 1;
    }

    const commonPatterns = Object.entries(exportCounts)
      .filter(([_, count]) => count > 1)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 10)
      .map(([name, _]) => name);

    return {
      totalFiles: files.length,
      totalExports,
      byType,
      commonPatterns
    };
  }

  private toPosiXPath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  private mapTypeToFramework(
    t: SchemaFile['type']
  ): 'zod' | 'yup' | 'joi' | 'ajv' | 'custom' | undefined {
    if (t === 'zod') return 'zod';
    if (t === 'yup') return 'yup';
    // We don't detect joi/ajv specifically here; treat as custom
    if (t === 'schema' || t === 'contract' || t === 'validator' || t === 'other') return 'custom';
    return undefined;
  }
}