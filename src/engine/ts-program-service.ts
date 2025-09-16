import * as ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';

/**
 * FQN (Fully Qualified Name) represents a symbol location in code
 */
export interface FQN {
  /** File path relative to project root (POSIX style) */
  path: string;
  /** Symbol name or location */
  symbol: string;
  /** Type of symbol resolution */
  type: 'export' | 'class-member' | 'local' | 'line-col' | 'overload';
  /** Line/column for line-col type */
  line?: number;
  column?: number;
  /** Signature hash for overloads */
  signatureHash?: string;
}

/**
 * Symbol reference with location information
 */
export interface SymbolReference {
  /** TypeScript node */
  node: ts.Node;
  /** Source file */
  sourceFile: ts.SourceFile;
  /** Symbol if available */
  symbol?: ts.Symbol;
  /** Resolved FQN */
  fqn: FQN;
}

/**
 * Edge types for dependency graphs
 */
export type EdgeType = 'calls' | 'typeRef' | 'extends' | 'implements' | 'imports' | 'sameFileSibling' | 'testCovers' | 'docMentions';

/**
 * Dependency edge between symbols
 */
export interface SymbolEdge {
  /** From symbol FQN */
  from: FQN;
  /** To symbol FQN */
  to: FQN;
  /** Edge type */
  type: EdgeType;
  /** Confidence weight */
  weight: number;
  /** Reason for inclusion */
  reason: string;
}

/**
 * Shared TypeScript Program service for symbol analysis
 * Consolidates TS Program creation and provides symbol resolution utilities
 */
export class TsProgramService {
  private program?: ts.Program;
  private languageService?: ts.LanguageService;
  private typeChecker?: ts.TypeChecker;
  private moduleResolutionCache?: ts.ModuleResolutionCache;
  private rootPath: string;
  private configPath?: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Initialize the service with TypeScript configuration
   */
  async initialize(): Promise<void> {
    this.configPath = this.findTsConfig(this.rootPath);
    if (!this.configPath) {
      throw new Error('No tsconfig.json or jsconfig.json found');
    }

    this.program = this.createProgram(this.configPath);
    this.typeChecker = this.program.getTypeChecker();
    this.moduleResolutionCache = ts.createModuleResolutionCache(
      this.rootPath,
      p => ts.sys.useCaseSensitiveFileNames ? p : p.toLowerCase(),
      this.program.getCompilerOptions()
    );
  }

  /**
   * Get the TypeScript Program
   */
  getProgram(): ts.Program {
    if (!this.program) {
      throw new Error('TsProgramService not initialized');
    }
    return this.program;
  }

  /**
   * Get the TypeScript TypeChecker
   */
  getTypeChecker(): ts.TypeChecker {
    if (!this.typeChecker) {
      throw new Error('TsProgramService not initialized');
    }
    return this.typeChecker;
  }

  /**
   * Parse FQN string into structured FQN object
   * Supports formats: path#export, path#Class.method, path#line:N:col, path#fn(<sigHash>)
   */
  parseFQN(fqnString: string): FQN {
    const [path, symbolPart] = fqnString.split('#');
    if (!symbolPart) {
      throw new Error(`Invalid FQN format: ${fqnString} (expected path#symbol)`);
    }

    // Normalize path to POSIX
    const normalizedPath = path.replace(/\\/g, '/');

    // Check for line:col format
    const lineColMatch = symbolPart.match(/^line:(\d+):(\d+)$/);
    if (lineColMatch) {
      return {
        path: normalizedPath,
        symbol: symbolPart,
        type: 'line-col',
        line: parseInt(lineColMatch[1], 10),
        column: parseInt(lineColMatch[2], 10)
      };
    }

    // Check for overload format with signature hash
    const overloadMatch = symbolPart.match(/^(.+)\(<([^>]+)>\)$/);
    if (overloadMatch) {
      return {
        path: normalizedPath,
        symbol: overloadMatch[1],
        type: 'overload',
        signatureHash: overloadMatch[2]
      };
    }

    // Check for class member format
    if (symbolPart.includes('.')) {
      return {
        path: normalizedPath,
        symbol: symbolPart,
        type: 'class-member'
      };
    }

    // Default to export lookup
    return {
      path: normalizedPath,
      symbol: symbolPart,
      type: 'export'
    };
  }

  /**
   * Resolve FQN to TypeScript node
   */
  resolveFqnToNode(fqn: FQN | string): SymbolReference | null {
    const parsedFqn = typeof fqn === 'string' ? this.parseFQN(fqn) : fqn;

    if (!this.program || !this.typeChecker) {
      throw new Error('TsProgramService not initialized');
    }

    // Get source file
    const absolutePath = resolve(this.rootPath, parsedFqn.path);
    const sourceFile = this.program.getSourceFile(absolutePath);
    if (!sourceFile) {
      return null;
    }

    switch (parsedFqn.type) {
      case 'line-col':
        return this.resolveLineCol(parsedFqn, sourceFile);
      case 'export':
        return this.resolveExport(parsedFqn, sourceFile);
      case 'class-member':
        return this.resolveClassMember(parsedFqn, sourceFile);
      case 'overload':
        return this.resolveOverload(parsedFqn, sourceFile);
      default:
        return this.resolveLocal(parsedFqn, sourceFile);
    }
  }

  /**
   * Find all references to a symbol
   */
  findReferences(symbolRef: SymbolReference): SymbolReference[] {
    if (!this.program || !this.typeChecker) {
      throw new Error('TsProgramService not initialized');
    }

    const references: SymbolReference[] = [];

    if (!symbolRef.symbol) {
      return references;
    }

    // Use TypeScript's findReferencedSymbols
    // Note: This API might not be available in all TypeScript versions
    try {
      const referencedSymbols = (ts as any).FindAllReferences?.findReferencedSymbols?.(
        this.typeChecker,
        symbolRef.node.pos,
        symbolRef.sourceFile,
        this.program,
        this.program.getSourceFiles()
      );

    if (referencedSymbols) {
      for (const referencedSymbol of referencedSymbols) {
        for (const reference of referencedSymbol.references) {
          const refSourceFile = reference.fileName === symbolRef.sourceFile.fileName
            ? symbolRef.sourceFile
            : this.program.getSourceFile(reference.fileName);

          if (refSourceFile) {
            const refNode = this.getNodeAtPosition(refSourceFile, reference.textSpan.start);
            if (refNode) {
              references.push({
                node: refNode,
                sourceFile: refSourceFile,
                symbol: symbolRef.symbol,
                fqn: {
                  path: this.toPosiXPath(relative(this.rootPath, reference.fileName)),
                  symbol: symbolRef.fqn.symbol,
                  type: 'export'
                }
              });
            }
          }
        }
      }
    }
    } catch (error) {
      // FindAllReferences API not available, continue without references
      console.warn('FindAllReferences API not available in this TypeScript version');
    }

    return references;
  }

  /**
   * Get type references from a symbol
   */
  getTypeRefs(symbolRef: SymbolReference): SymbolEdge[] {
    if (!this.typeChecker) {
      throw new Error('TsProgramService not initialized');
    }

    const edges: SymbolEdge[] = [];
    const node = symbolRef.node;

    // Handle function/method return types
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      if (node.type) {
        const typeRefs = this.extractTypeReferences(node.type);
        for (const typeRef of typeRefs) {
          edges.push({
            from: symbolRef.fqn,
            to: typeRef,
            type: 'typeRef',
            weight: 2.5,
            reason: 'return-type'
          });
        }
      }
    }

    // Handle class extends/implements
    if (ts.isClassDeclaration(node)) {
      if (node.heritageClauses) {
        for (const heritage of node.heritageClauses) {
          const edgeType = heritage.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
          for (const typeNode of heritage.types) {
            const typeRefs = this.extractTypeReferences(typeNode);
            for (const typeRef of typeRefs) {
              edges.push({
                from: symbolRef.fqn,
                to: typeRef,
                type: edgeType,
                weight: 2.0,
                reason: edgeType
              });
            }
          }
        }
      }
    }

    // Handle interface extends
    if (ts.isInterfaceDeclaration(node) && node.heritageClauses) {
      for (const heritage of node.heritageClauses) {
        for (const typeNode of heritage.types) {
          const typeRefs = this.extractTypeReferences(typeNode);
          for (const typeRef of typeRefs) {
            edges.push({
              from: symbolRef.fqn,
              to: typeRef,
              type: 'extends',
              weight: 2.0,
              reason: 'interface-extends'
            });
          }
        }
      }
    }

    return edges;
  }

  /**
   * Get call graph edges from a symbol
   */
  getCallGraphEdges(symbolRef: SymbolReference): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    const node = symbolRef.node;

    // Walk the AST looking for call expressions
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callTarget = this.resolveCallTarget(n);
        if (callTarget) {
          edges.push({
            from: symbolRef.fqn,
            to: callTarget,
            type: 'calls',
            weight: 3.0,
            reason: 'direct-call'
          });
        }
      }
      ts.forEachChild(n, visit);
    };

    visit(node);
    return edges;
  }

  /**
   * Get JSDoc comment for a node
   */
  getJsDoc(node: ts.Node): string | undefined {
    const jsDocTags = ts.getJSDocTags(node);
    if (jsDocTags.length === 0) {
      return undefined;
    }

    const comments: string[] = [];
    for (const tag of jsDocTags) {
      if (tag.comment) {
        if (typeof tag.comment === 'string') {
          comments.push(tag.comment);
        } else {
          // Handle JSDocComment[] case
          comments.push(tag.comment.map(c => c.text).join(''));
        }
      }
    }

    return comments.length > 0 ? comments.join('\n') : undefined;
  }

  // Private helper methods

  private findTsConfig(rootPath: string): string | undefined {
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
    return undefined;
  }

  private createProgram(configPath: string): ts.Program {
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
      options: parsedConfig.options,
      configFileParsingDiagnostics: parsedConfig.errors
    });
  }

  private resolveLineCol(fqn: FQN, sourceFile: ts.SourceFile): SymbolReference | null {
    if (fqn.line === undefined || fqn.column === undefined) {
      return null;
    }

    const position = ts.getPositionOfLineAndCharacter(sourceFile, fqn.line - 1, fqn.column - 1);
    const node = this.getNodeAtPosition(sourceFile, position);
    if (!node) {
      return null;
    }

    const symbol = this.typeChecker?.getSymbolAtLocation(node);
    return {
      node,
      sourceFile,
      symbol,
      fqn
    };
  }

  private resolveExport(fqn: FQN, sourceFile: ts.SourceFile): SymbolReference | null {
    if (!this.typeChecker) {
      return null;
    }

    // Handle default export
    if (fqn.symbol === 'default') {
      const defaultExport = this.findDefaultExport(sourceFile);
      if (defaultExport) {
        const symbol = this.typeChecker.getSymbolAtLocation(defaultExport);
        return {
          node: defaultExport,
          sourceFile,
          symbol,
          fqn
        };
      }
      return null;
    }

    // Get module symbol and look for named export
    const moduleSymbol = this.typeChecker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      return null;
    }

    const exportSymbol = this.typeChecker.tryGetMemberInModuleExports(fqn.symbol, moduleSymbol);
    if (!exportSymbol || !exportSymbol.valueDeclaration) {
      return null;
    }

    return {
      node: exportSymbol.valueDeclaration,
      sourceFile,
      symbol: exportSymbol,
      fqn
    };
  }

  private resolveClassMember(fqn: FQN, sourceFile: ts.SourceFile): SymbolReference | null {
    const [className, memberName] = fqn.symbol.split('.');
    if (!memberName) {
      return null;
    }

    // First find the class
    const classRef = this.resolveExport({
      ...fqn,
      symbol: className,
      type: 'export'
    }, sourceFile);

    if (!classRef || !ts.isClassDeclaration(classRef.node)) {
      return null;
    }

    // Find the member in the class
    const classDecl = classRef.node;
    for (const member of classDecl.members) {
      if (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        if (member.name && ts.isIdentifier(member.name) && member.name.text === memberName) {
          const symbol = this.typeChecker?.getSymbolAtLocation(member.name);
          return {
            node: member,
            sourceFile,
            symbol,
            fqn
          };
        }
      }
    }

    return null;
  }

  private resolveOverload(fqn: FQN, sourceFile: ts.SourceFile): SymbolReference | null {
    // For now, just resolve to the implementation signature
    // TODO: Add signature hash matching for proper overload disambiguation
    return this.resolveExport({
      ...fqn,
      symbol: fqn.symbol,
      type: 'export'
    }, sourceFile);
  }

  private resolveLocal(fqn: FQN, sourceFile: ts.SourceFile): SymbolReference | null {
    // Search for local const/let/var declarations with the given name
    let foundNode: ts.Node | null = null;

    const visit = (node: ts.Node): void => {
      if (foundNode) return;

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === fqn.symbol) {
        foundNode = node;
        return;
      }

      if (ts.isFunctionDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === fqn.symbol) {
        foundNode = node;
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (!foundNode) {
      return null;
    }

    const symbol = this.typeChecker?.getSymbolAtLocation(foundNode);
    return {
      node: foundNode,
      sourceFile,
      symbol,
      fqn
    };
  }

  private findDefaultExport(sourceFile: ts.SourceFile): ts.Node | null {
    let defaultExport: ts.Node | null = null;

    const visit = (node: ts.Node): void => {
      if (defaultExport) return;

      // export default expression
      if (ts.isExportAssignment(node) && !node.isExportEquals) {
        defaultExport = node.expression;
        return;
      }

      // export default function/class/etc
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
          node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
          node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        defaultExport = node;
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return defaultExport;
  }

  private getNodeAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node | null {
    const getContainingNode = (node: ts.Node): ts.Node => {
      let result = node;
      ts.forEachChild(node, child => {
        if (child.pos <= position && position < child.end) {
          result = getContainingNode(child);
        }
      });
      return result;
    };

    const result = getContainingNode(sourceFile);
    return result === sourceFile ? null : result;
  }

  private extractTypeReferences(typeNode: ts.TypeNode): FQN[] {
    const typeRefs: FQN[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        // TODO: Resolve type reference to its definition
        typeRefs.push({
          path: 'unknown', // Need to resolve this properly
          symbol: node.typeName.text,
          type: 'export'
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(typeNode);
    return typeRefs;
  }

  private resolveCallTarget(callExpr: ts.CallExpression): FQN | null {
    if (ts.isIdentifier(callExpr.expression)) {
      // Simple function call
      return {
        path: 'unknown', // Need to resolve this properly
        symbol: callExpr.expression.text,
        type: 'export'
      };
    }

    if (ts.isPropertyAccessExpression(callExpr.expression) && ts.isIdentifier(callExpr.expression.name)) {
      // Method call like obj.method()
      return {
        path: 'unknown', // Need to resolve this properly
        symbol: callExpr.expression.name.text,
        type: 'export'
      };
    }

    return null;
  }

  private toPosiXPath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}