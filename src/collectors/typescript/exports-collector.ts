import * as ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, extname } from 'path';
import { BaseCollector } from '../base-collector.js';
import type { Artifact, CollectorContext } from '../../types.js';
import { CanonicalJSON } from '../../engine/canonical-json.js';

interface ExportedSymbol {
  name: string;
  // Conform to zod schema: no 'const' or 'namespace' kinds
  kind: 'function' | 'class' | 'type' | 'interface' | 'enum' | 'var' | 'default' | 'reexport';
  isReexport: boolean;
  reexportFrom?: string; // -> target
}

interface FileExports {
  path: string; // POSIX-style relative path (schema expects 'path')
  exports: ExportedSymbol[];
  hasDefaultExport: boolean; // extra metadata (schema ignores unknown keys)
}

interface ExportsData {
  files: FileExports[];
  summary: {
    totalFiles: number;
    totalExports: number;
    reexports: number;
    defaultExports: number;
    byKind: Record<string, number>;
  };
}

export class ExportsCollector extends BaseCollector {
  readonly name = 'exports';
  readonly schemaIds = ['ts/60-exports'];

  async detect(rootPath: string): Promise<boolean> {
    try {
      const tsConfigPath = this.findTsConfig(rootPath);
      return tsConfigPath !== null;
    } catch {
      return false;
    }
  }

  async collect(ctx: CollectorContext): Promise<Artifact[]> {
    const tsConfigPath = this.findTsConfig(ctx.rootPath);
    if (!tsConfigPath) {
      throw new Error('No tsconfig.json found');
    }

    const sourceFiles = this.findSourceFiles(ctx.rootPath);
    const program = this.createTsProgram(tsConfigPath, sourceFiles);
    const typeChecker = program.getTypeChecker();
    
    const fileExports: FileExports[] = [];
    const programFiles = program.getSourceFiles().slice().sort((a, b) => a.fileName.localeCompare(b.fileName));
    for (const sourceFile of programFiles) {
      if (sourceFile.fileName.includes('node_modules') || 
          sourceFile.fileName.includes('dist') || 
          sourceFile.fileName.endsWith('.d.ts')) {
        continue;
      }

      const relativePath = this.toPosiXPath(relative(ctx.rootPath, sourceFile.fileName));
      if (!relativePath.startsWith('src/') && !relativePath.includes('/src/')) {
        continue; // Only analyze files under src/ directories
      }

      const exports = this.extractExports(sourceFile, typeChecker);
      // Detect default export explicitly
      if (this.hasDefaultExport(sourceFile)) {
        exports.push({ name: 'default', kind: 'default', isReexport: false });
      }
      // Deterministic order
      exports.sort((a, b) => a.name.localeCompare(b.name));
      const hasDefault = exports.some(exp => exp.kind === 'default');
      
      fileExports.push({
        path: relativePath,
        exports,
        hasDefaultExport: hasDefault
      });
    }

    // Deterministic files ordering
    fileExports.sort((a, b) => a.path.localeCompare(b.path));

    const summary = this.calculateSummary(fileExports);
    
    const exportsData: ExportsData = {
      files: fileExports,
      summary
    };

    return [{
      id: this.name,
      filename: 'ts/60-exports.json',
      kind: 'json',
      schemaId: this.schemaIds[0],
      sizeHint: Buffer.byteLength(CanonicalJSON.stringify(exportsData), 'utf-8'),
      data: exportsData
    }];
  }

  private findTsConfig(rootPath: string): string | null {
    const candidates = ['tsconfig.json', 'jsconfig.json'];
    for (const candidate of candidates) {
      try {
        const configPath = join(rootPath, candidate);
        readFileSync(configPath);
        return configPath;
      } catch {
        continue;
      }
    }
    return null;
  }

  private findSourceFiles(rootPath: string): string[] {
    const sourceFiles: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    
    const walkDir = (dir: string): void => {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            if (!entry.startsWith('.') && 
                entry !== 'node_modules' && 
                entry !== 'dist' && 
                entry !== 'build') {
              walkDir(fullPath);
            }
          } else if (stat.isFile() && extensions.includes(extname(entry).toLowerCase())) {
            sourceFiles.push(fullPath);
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    walkDir(rootPath);
    return sourceFiles;
  }

  private createTsProgram(configPath: string, sourceFiles: string[]): ts.Program {
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
      rootNames: sourceFiles.length > 0 ? sourceFiles : parsedConfig.fileNames,
      options: parsedConfig.options
    });
  }

  private extractExports(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker): ExportedSymbol[] {
    const exports: ExportedSymbol[] = [];
    
    // Get module symbol
    const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      return exports;
    }

    // Get exports from module symbol
    const moduleExports = typeChecker.getExportsOfModule(moduleSymbol);
    
    for (const exportSymbol of moduleExports) {
      const exportInfo = this.analyzeExportSymbol(exportSymbol, typeChecker);
      if (exportInfo) {
        exports.push(exportInfo);
      }
    }

    // Also check for explicit export statements to catch re-exports
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isExportDeclaration(node)) {
        const reexportInfo = this.analyzeReexport(node, typeChecker);
        exports.push(...reexportInfo);
      }
    });

    return exports;
  }

  private analyzeExportSymbol(symbol: ts.Symbol, typeChecker: ts.TypeChecker): ExportedSymbol | null {
    const name = symbol.getName();
    if (name === '__export' || name === 'default') {
      return null; // Skip internal symbols, handle default separately
    }

    let kind: ExportedSymbol['kind'] = 'var';
    
    if (symbol.flags & ts.SymbolFlags.Function) {
      kind = 'function';
    } else if (symbol.flags & ts.SymbolFlags.Class) {
      kind = 'class';
    } else if (symbol.flags & ts.SymbolFlags.Interface) {
      kind = 'interface';
    } else if (symbol.flags & ts.SymbolFlags.TypeAlias) {
      kind = 'type';
    } else if (symbol.flags & ts.SymbolFlags.Enum) {
      kind = 'enum';
    } else if (symbol.flags & ts.SymbolFlags.BlockScopedVariable) {
      // Check if it's const or let/var
      const declarations = symbol.declarations;
      if (declarations && declarations.length > 0) {
        const decl = declarations[0];
        if (decl && ts.isVariableDeclaration(decl) && decl.parent && ts.isVariableDeclarationList(decl.parent)) {
          // canonicalize 'const' to 'var' for schema compatibility
          kind = 'var';
        }
      }
    }

    return {
      name,
      kind,
      isReexport: false
    };
  }

  private analyzeReexport(node: ts.ExportDeclaration, _typeChecker: ts.TypeChecker): ExportedSymbol[] {
    const exports: ExportedSymbol[] = [];
    
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
      return exports;
    }

    const moduleSpecifier = node.moduleSpecifier.text;
    
    if (node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        // export { foo, bar } from './module'
        for (const element of node.exportClause.elements) {
          const name = element.name.text;
          exports.push({
            name,
            kind: 'reexport',
            isReexport: true,
            reexportFrom: moduleSpecifier
          });
        }
      }
    } else {
      // export * from './module'
      exports.push({
        name: '*',
        kind: 'reexport',
        isReexport: true,
        reexportFrom: moduleSpecifier
      });
    }

    return exports;
  }

  private calculateSummary(fileExports: FileExports[]) {
    let totalExports = 0;
    let reexports = 0;
    let defaultExports = 0;
    const byKind: Record<string, number> = {};

    for (const file of fileExports) {
      totalExports += file.exports.length;
      if (file.hasDefaultExport) {
        defaultExports++;
      }
      
      for (const exp of file.exports) {
        if (exp.isReexport) {
          reexports++;
        }
        byKind[exp.kind] = (byKind[exp.kind] || 0) + 1;
      }
    }

    return {
      totalFiles: fileExports.length,
      totalExports,
      reexports,
      defaultExports,
      byKind
    };
  }

  private toPosiXPath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  private hasDefaultExport(sourceFile: ts.SourceFile): boolean {
    let hasDefault = false;
    const visit = (node: ts.Node): void => {
      if (ts.isExportAssignment(node) && !node.isExportEquals) {
        hasDefault = true;
        return;
      }
      if (
        (ts.isFunctionDeclaration(node) ||
         ts.isClassDeclaration(node) ||
         ts.isInterfaceDeclaration(node) ||
         ts.isTypeAliasDeclaration(node)) &&
        node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
        node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)
      ) {
        hasDefault = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return hasDefault;
  }
}