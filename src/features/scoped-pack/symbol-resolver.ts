/**
 * Symbol Resolver - Resolve seeds to TypeScript symbols with comprehensive error handling
 */

import { relative } from 'node:path';
import * as path from 'node:path';
import type { TsProgramService, SymbolReference, FQN } from '../../core/ts-program/service.js';
import type {
  SeedGrammar,
  SeedLocation,
  SeedResolutionResult,
  SeedResolutionDiagnostic,
  ScopedSymbolNode,
  ScopedSymbolEdge,
  ScopedSymbolGraph
} from '../../core/contracts/scoped.js';
import { SeedParser } from './seed-parser.js';
import * as ts from 'typescript';

export class SymbolResolver {
  private readonly tsProgramService: TsProgramService;
  private readonly seedParser: SeedParser;
  private readonly rootPath: string;
  private cachedSeedSymbolRef?: SymbolReference;
  private includeNonExported: boolean = false;

  constructor(tsProgramService: TsProgramService, rootPath: string) {
    this.tsProgramService = tsProgramService;
    this.seedParser = new SeedParser(rootPath);
    this.rootPath = rootPath;
  }

  setIncludeNonExported(include: boolean) {
    this.includeNonExported = include;
  }

  /**
   * Resolve seed to symbol graph with comprehensive error handling
   */
  async resolveSeed(seed: SeedGrammar): Promise<SeedResolutionResult> {
    // Parse the seed first
    const parseResult = this.seedParser.parseSeed(seed);
    if (!parseResult.success || !parseResult.location) {
      return parseResult;
    }

    const location = parseResult.location;
    const diagnostics = [...parseResult.diagnostics];

    try {
      // Convert to FQN format for TsProgramService
      const fqn = this.locationToFqn(location);

      // Try to resolve the symbol
      const symbolRef = this.tsProgramService.resolveFqnToNode(fqn);

      if (!symbolRef) {
        diagnostics.push(SeedParser.createSeedNotFoundDiagnostic(seed, location.path));
        return {
          seed,
          success: false,
          location,
          diagnostics,
        };
      }

      // Check for failure modes
      const failureCheck = this.checkFailureModes(symbolRef, seed, location);
      if (failureCheck) {
        diagnostics.push(failureCheck);
        return {
          seed,
          success: false,
          location,
          diagnostics,
        };
      }

      // Cache the successful resolution for graph building
      this.cachedSeedSymbolRef = symbolRef;

      return {
        seed,
        success: true,
        location,
        diagnostics,
      };

    } catch (error) {
      diagnostics.push({
        code: 'SEED_NOT_FOUND',
        message: error instanceof Error ? error.message : 'Unknown resolution error',
        path: location.path,
        symbol: location.symbol,
      });

      return {
        seed,
        success: false,
        location,
        diagnostics,
      };
    }
  }

  /**
   * Build symbol graph from resolved seed
   */
  async buildSymbolGraph(
    seedResolution: SeedResolutionResult,
    maxDepth: number = 2
  ): Promise<ScopedSymbolGraph> {
    if (!seedResolution.success || !seedResolution.location) {
      throw new Error('Cannot build graph from failed seed resolution');
    }

    // Use cached symbol reference from successful resolution
    const symbolRef = this.cachedSeedSymbolRef;
    if (!symbolRef) {
      throw new Error('No cached symbol reference - call resolveSeed first');
    }

    const nodes: ScopedSymbolNode[] = [];
    const edges: ScopedSymbolEdge[] = [];
    const visited = new Set<string>();

    // Create seed node
    const seedNode = this.symbolRefToNode(symbolRef);
    const seedNodeId = seedNode.id;
    nodes.push(seedNode);
    visited.add(seedNodeId);

    // Build graph with BFS to respect depth limit
    const queue: Array<{ symbolRef: SymbolReference; depth: number }> = [{ symbolRef, depth: 0 }];

    while (queue.length > 0) {
      const { symbolRef: currentRef, depth } = queue.shift()!;

      if (depth >= maxDepth) continue;

      const currentNodeId = this.createStableId(currentRef.fqn);

      // Get type references
      const typeEdges = this.tsProgramService.getTypeRefs(currentRef);
      for (const edge of typeEdges) {
        const targetRef = this.tsProgramService.resolveFqnToNode(edge.to);
        if (targetRef) {
          const targetNode = this.symbolRefToNode(targetRef);
          const targetId = targetNode.id;

          if (!visited.has(targetId)) {
            nodes.push(targetNode);
            visited.add(targetId);
            queue.push({ symbolRef: targetRef, depth: depth + 1 });
          }

          edges.push({
            from: currentNodeId,
            to: targetId,
            type: this.mapEdgeType(edge.type),
            line: this.getNodeLine(currentRef.node),
          });
        }
      }

      // Get call graph edges
      const callEdges = this.tsProgramService.getCallGraphEdges(currentRef);
      for (const edge of callEdges) {
        const targetRef = this.tsProgramService.resolveFqnToNode(edge.to);
        if (targetRef) {
          const targetNode = this.symbolRefToNode(targetRef);
          const targetId = targetNode.id;

          if (!visited.has(targetId)) {
            nodes.push(targetNode);
            visited.add(targetId);
            queue.push({ symbolRef: targetRef, depth: depth + 1 });
          }

          edges.push({
            from: currentNodeId,
            to: targetId,
            type: 'calls',
            line: this.getNodeLine(currentRef.node),
          });
        }
      }
    }

    // Sort for deterministic output
    nodes.sort((a, b) => a.id.localeCompare(b.id));
    edges.sort((a, b) => {
      const fromCmp = a.from.localeCompare(b.from);
      if (fromCmp !== 0) return fromCmp;
      return a.to.localeCompare(b.to);
    });

    return {
      nodes,
      edges,
      seedNodeId,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Convert location to FQN format with canonical path
   */
  private locationToFqn(location: SeedLocation): FQN {
    // Canonicalize path to project-relative POSIX format (same as TsProgramService)
    const canonicalPath = this.toProjectRelativePosix(location.path);

    if (location.type === 'symbol') {
      return {
        path: canonicalPath,
        symbol: location.symbol!,
        type: 'export',
      };
    } else {
      return {
        path: canonicalPath,
        symbol: `${location.line}:${location.column}`,
        type: 'line-col',
        line: location.line,
        column: location.column,
      };
    }
  }

  /**
   * Convert absolute path to project-relative POSIX format
   */
  private toProjectRelativePosix(absolutePath: string): string {
    const relativePath = relative(this.rootPath, absolutePath);
    return relativePath.replace(/\\/g, '/');
  }

  /**
   * Convert SymbolReference to ScopedSymbolNode
   */
  private symbolRefToNode(symbolRef: SymbolReference): ScopedSymbolNode {
    const fqn = symbolRef.fqn;
    const node = symbolRef.node;

    return {
      id: this.createStableId(fqn),
      path: fqn.path,
      symbol: fqn.symbol,
      kind: this.getSymbolKind(node),
      line: this.getNodeLine(node),
      column: this.getNodeColumn(node),
      exported: this.isExported(symbolRef),
    };
  }

  /**
   * Create stable ID for symbol node using canonical paths
   */
  private createStableId(fqn: FQN): string {
    // Ensure path is project-relative POSIX for deterministic IDs
    const canonicalPath = path.isAbsolute(fqn.path)
      ? this.toProjectRelativePosix(fqn.path)
      : fqn.path.replace(/\\/g, '/'); // Already relative, just normalize separators
    return `${canonicalPath}#${fqn.symbol}`;
  }

  /**
   * Get symbol kind from TypeScript node
   */
  private getSymbolKind(node: ts.Node): ScopedSymbolNode['kind'] {
    if (ts.isClassDeclaration(node)) return 'class';
    if (ts.isInterfaceDeclaration(node)) return 'interface';
    if (ts.isFunctionDeclaration(node)) return 'function';
    if (ts.isVariableDeclaration(node)) return 'variable';
    if (ts.isTypeAliasDeclaration(node)) return 'type';
    if (ts.isEnumDeclaration(node)) return 'enum';
    if (ts.isModuleDeclaration(node)) return 'namespace';
    return 'variable'; // fallback
  }

  /**
   * Check if symbol is exported
   */
  private isExported(symbolRef: SymbolReference): boolean {
    const node = symbolRef.node;

    if (ts.canHaveModifiers(node)) {
      const modifiers = ts.getModifiers(node);
      return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    }

    return false;
  }

  /**
   * Get line number from node
   */
  private getNodeLine(node: ts.Node): number | undefined {
    const sourceFile = node.getSourceFile();
    if (!sourceFile) return undefined;

    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return line + 1; // Convert to 1-based
  }

  /**
   * Get column number from node
   */
  private getNodeColumn(node: ts.Node): number | undefined {
    const sourceFile = node.getSourceFile();
    if (!sourceFile) return undefined;

    const { character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return character + 1; // Convert to 1-based like line numbers
  }

  /**
   * Map TsProgramService edge type to scoped edge type
   */
  private mapEdgeType(edgeType: string): ScopedSymbolEdge['type'] {
    switch (edgeType) {
      case 'calls': return 'calls';
      case 'typeRef': return 'references';
      case 'extends': return 'extends';
      case 'implements': return 'implements';
      case 'imports': return 'imports';
      default: return 'references';
    }
  }

  /**
   * Check for common failure modes
   */
  private checkFailureModes(
    symbolRef: SymbolReference,
    seed: SeedGrammar,
    location: SeedLocation
  ): SeedResolutionDiagnostic | null {
    const node = symbolRef.node;
    const symbol = symbolRef.symbol;

    // Check for ambient types (ambient types typically have module flag)
    if (symbol && (symbol.flags & ts.SymbolFlags.Module) && symbol.valueDeclaration === undefined) {
      return SeedParser.createAmbientTypeDiagnostic(seed, location.symbol || 'unknown');
    }

    // Check for external project references (downgrade to warning if in same VCS root)
    const sourceFile = node.getSourceFile();
    if (sourceFile && !sourceFile.fileName.startsWith(this.rootPath)) {
      // Check if it's in the same git repo (more lenient)
      const isInSameVcsRoot = this.isInSameVcsRoot(sourceFile.fileName);
      if (!isInSameVcsRoot) {
        return SeedParser.createProjectReferenceDiagnostic(seed, sourceFile.fileName);
      }
      // Otherwise, just warn but allow resolution
    }

    // Check if symbol is exported (only if includeNonExported is false)
    if (!this.includeNonExported && symbol && location.symbol) {
      const isExported = this.isSymbolExported(symbol, sourceFile);
      if (!isExported) {
        return {
          code: 'SEED_NOT_FOUND',
          message: `Symbol '${location.symbol}' is not exported. Use --scope-include-non-exported to include non-exported symbols.`,
          path: location.path,
          symbol: location.symbol,
        };
      }
    }

    return null;
  }

  /**
   * Check if a file is in the same VCS root (git repository)
   */
  private isInSameVcsRoot(filePath: string): boolean {
    // Simple heuristic: check if both paths share a common parent with .git
    // This could be made more sophisticated if needed
    const resolvedRoot = path.resolve(this.rootPath);
    const resolvedFile = path.resolve(filePath);

    // If the file path contains the root path, it's likely in the same repo
    return resolvedFile.includes(resolvedRoot) || resolvedRoot.includes(resolvedFile);
  }

  /**
   * Check if a symbol is exported from its source file
   */
  private isSymbolExported(symbol: ts.Symbol, sourceFile: ts.SourceFile): boolean {
    // Get module symbol for the source file
    const moduleSymbol = this.tsProgramService.getTypeChecker().getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) return false;

    // Check if the symbol is in the exports
    const exports = this.tsProgramService.getTypeChecker().getExportsOfModule(moduleSymbol);
    return exports.some(exportSymbol => exportSymbol === symbol || exportSymbol.name === symbol.name);
  }
}