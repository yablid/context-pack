import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { join, resolve, relative, dirname } from 'path';
import { BaseCollector } from '../base-collector.js';
import type { CollectorContext } from '../../../../core/contracts/collector.js';
import type { Artifact } from '../../../../core/types.js';
import { CanonicalJSON } from '../../../../core/io/canonical-json.js';

interface ImportNode {
  path: string; // POSIX-style relative path (renamed from 'file')
  package?: string; // Optional package name
  kind: 'source' | 'declaration' | 'package'; // Required by schema
}

interface ImportEdge {
  from: string;
  to: string;
  kind: 'import' | 'export' | 'reexport'; // Required by schema 
  specifier: string; // Required by schema - module name being imported
}

interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  packages: number;
  stronglyConnectedComponents?: number; // Deprecated
  sccCount?: number;
  degrees?: Record<string, {in: number; out: number}>;
  roots?: string[];
  leaves?: string[];
  isolatedNodes?: string[];
  internalEdges?: number;
  externalEdges?: number;
  hasCycles?: boolean;
  topExternalImports?: [string, number][];
  reachability?: {
    seeds: string[];
    reachable: string[];
    reachabilityTruncated?: boolean;
  };
}

interface ImportGraphData {
  nodes: ImportNode[];
  edges: ImportEdge[];
  stats: GraphStats;
  externalDeps: Record<string, string[]>; // Renamed from 'packageExternalDeps'
}

export class ImportGraphCollector extends BaseCollector {
  readonly name = 'import-graph';
  readonly schemaIds = ['30-import-graph'];
  private moduleResolutionCache?: ts.ModuleResolutionCache;
  private workspacePackages?: Set<string>;
  private rootPath?: string;

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

    const program = this.createTsProgram(tsConfigPath);
    this.rootPath = ctx.rootPath;
    this.moduleResolutionCache = ts.createModuleResolutionCache(
      this.rootPath,
      p => ts.sys.useCaseSensitiveFileNames ? p : p.toLowerCase(),
      program.getCompilerOptions()
    );
    this.workspacePackages = await this.loadWorkspacePackages(ctx);
    
    const sourceFiles = program.getSourceFiles()
      .filter(sf => !sf.fileName.includes('node_modules') && 
                   !sf.fileName.includes('dist') && 
                   !sf.fileName.includes('.d.ts'));

    const importGraph = this.buildImportGraph(sourceFiles, ctx.rootPath, program);
    
    // Build adjacency list for internal nodes
    const adj = this.buildAdjacency(importGraph.nodes, importGraph.edges);
    
    // Compute comprehensive stats
    const stats = this.computeGraphStats(importGraph.nodes, importGraph.edges, adj, program);
    
    const graphData: ImportGraphData = {
      nodes: importGraph.nodes,
      edges: importGraph.edges,
      externalDeps: this.aggregateExternalDependencies(importGraph.nodes, importGraph.edges),
      stats
    };

    return [{
      id: this.name,
      filename: '30-import-graph.json',
      kind: 'json',
      schemaId: this.schemaIds[0],
      sizeHint: CanonicalJSON.byteSize(graphData),
      data: graphData
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
      options: parsedConfig.options,
      configFileParsingDiagnostics: parsedConfig.errors
    });
  }

  private buildImportGraph(sourceFiles: ts.SourceFile[], rootPath: string, program: ts.Program): {
    nodes: ImportNode[];
    edges: ImportEdge[];
  } {
    const nodes: ImportNode[] = [];
    const edges: ImportEdge[] = [];
    const nodeSet = new Set<string>();

    // First pass: collect all nodes
    for (const sourceFile of sourceFiles) {
      const relativePath = this.toPosiXPath(relative(rootPath, sourceFile.fileName));
      nodes.push({
        path: relativePath,
        kind: this.determineNodeKind(relativePath),
        package: this.determinePackageName(relativePath, rootPath)
      });
      nodeSet.add(relativePath);
    }

    // Second pass: collect edges using proper resolution
    for (const sourceFile of sourceFiles) {
      ts.forEachChild(sourceFile, (node) => {
        this.processImportNode(node, sourceFile, program, edges, nodeSet);
      });
    }

    // Sort for determinism
    nodes.sort((a, b) => a.path.localeCompare(b.path));
    edges.sort((a, b) => {
      const fromCmp = a.from.localeCompare(b.from);
      if (fromCmp !== 0) return fromCmp;
      const toCmp = a.to.localeCompare(b.to);
      if (toCmp !== 0) return toCmp;
      return a.specifier.localeCompare(b.specifier);
    });

    return { nodes, edges };
  }

  private processImportNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    program: ts.Program,
    edges: ImportEdge[],
    nodeSet: Set<string>
  ): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        const specifier = moduleSpecifier.text;
        const fromPath = this.toPosiXPath(relative(this.rootPath!, sourceFile.fileName));
        
        const resolved = this.resolveImport(specifier, sourceFile.fileName, program);
        
        let edgeKind: 'import' | 'export' | 'reexport' = 'import';
        if (ts.isExportDeclaration(node)) {
          edgeKind = node.exportClause ? 'reexport' : 'export';
        }
        
        if (resolved.isInternal && resolved.canonicalPath) {
          // Internal edge
          edges.push({
            from: fromPath,
            to: resolved.canonicalPath,
            kind: edgeKind,
            specifier: specifier
          });
          
          // Add internal target as a node if not already present
          if (!nodeSet.has(resolved.canonicalPath)) {
            nodeSet.add(resolved.canonicalPath);
          }
        } else if (resolved.packageName) {
          // External edge
          edges.push({
            from: fromPath,
            to: resolved.packageName,
            kind: edgeKind,
            specifier: specifier
          });
        }
      }
    }
  }

  // Removed deprecated methods - now using ts.resolveModuleName instead

  // Aggregate external dependencies from edges (replaces node.externalDependencies)  
  private aggregateExternalDependencies(nodes: ImportNode[], edges: ImportEdge[]): Record<string, string[]> {
    const byId = this.buildNodeIndex(nodes);
    const acc: Record<string, Set<string>> = {};

    for (const e of edges) {
      const toNode = byId.get(e.to);
      const isPackageNode = toNode?.kind === 'package';
      const isBareImport = !this.isRelativeSpecifier(e.specifier);

      if (!isPackageNode && !isBareImport) continue;

      const pkg = isPackageNode
        ? (toNode!.package || this.parsePackageName(e.specifier))
        : this.parsePackageName(e.specifier);

      if (!pkg) continue;

      if (!acc[pkg]) acc[pkg] = new Set();
      acc[pkg].add(e.specifier);
    }

    // Materialize to arrays sorted for determinism
    const out: Record<string, string[]> = {};
    for (const [pkg, specs] of Object.entries(acc)) {
      out[pkg] = Array.from(specs).sort();
    }
    return out;
  }


  private findCircularDependencies(graph: { nodes: ImportNode[]; edges: ImportEdge[] }): string[][] {
    // Deprecated - kept for backwards compatibility
    const { sccCount } = this.computeSCCs(this.buildAdjacency(graph.nodes, graph.edges));
    const cycles: string[][] = [];
    // Return empty array, sccCount is now used instead
    return cycles;
  }
  
  private computeSCCs(adj: Map<string, Set<string>>): { hasCycles: boolean; sccCount: number } {
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    let indexCounter = 0;
    
    const strongconnect = (v: string): void => {
      index.set(v, indexCounter);
      lowlink.set(v, indexCounter);
      indexCounter++;
      stack.push(v);
      onStack.add(v);
      
      const neighbors = adj.get(v) || new Set();
      for (const w of neighbors) {
        if (!index.has(w)) {
          strongconnect(w);
          lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
        }
      }
      
      if (lowlink.get(v) === index.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        
        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    };
    
    for (const node of adj.keys()) {
      if (!index.has(node)) {
        strongconnect(node);
      }
    }
    
    return {
      hasCycles: sccs.length > 0,
      sccCount: sccs.length
    };
  }

  // Build adjacency list from edges (internal → internal only)
  private buildAdjacency(nodes: ImportNode[], edges: ImportEdge[]): Map<string, Set<string>> {
    const byId = this.buildNodeIndex(nodes);
    const adj = new Map<string, Set<string>>();

    // Initialize all internal vertices to ensure deterministic presence
    for (const n of nodes) {
      if (this.isInternalNode(n)) adj.set(n.path, new Set());
    }

    for (const e of edges) {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (!this.isInternalNode(from) || !this.isInternalNode(to)) continue;
      adj.get(from!.path)!.add(to!.path);
    }

    return adj;
  }

  // Core utility functions for edge-centric model
  private isRelativeSpecifier(spec: string): boolean {
    return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/');
  }

  // @scope/pkg/sub/path  -> @scope/pkg
  // react/jsx-runtime    -> react  
  // react                -> react
  private parsePackageName(spec: string): string {
    if (!spec || this.isRelativeSpecifier(spec)) return '';
    if (spec.startsWith('@')) {
      const parts = spec.split('/');
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
    }
    const idx = spec.indexOf('/');
    return idx === -1 ? spec : spec.slice(0, idx);
  }

  private isInternalNode(n: ImportNode | undefined): boolean {
    return !!n && (n.kind === 'source' || n.kind === 'declaration');
  }

  private buildNodeIndex(nodes: ImportNode[]): Map<string, ImportNode> {
    const m = new Map<string, ImportNode>();
    for (const n of nodes) m.set(n.path, n);
    return m;
  }

  private determineNodeKind(path: string): 'source' | 'declaration' | 'package' {
    if (path.endsWith('.d.ts')) {
      return 'declaration';
    }
    if (path.includes('package.json')) {
      return 'package';
    }
    return 'source';
  }

  private determinePackageName(filePath: string, rootPath: string): string | undefined {
    // For single-package repos, return undefined (optional field)
    // In multi-package repos, this would determine which package the file belongs to
    return undefined;
  }

  private countUniquePackages(nodes: ImportNode[]): number {
    const packages = new Set(nodes.map(n => n.package).filter(p => p !== undefined));
    return packages.size || 1; // At least 1 package (root)
  }
  
  private computeReachability(
    rootPath: string,
    adj: Map<string, Set<string>>,
    program: ts.Program
  ): { seeds: string[]; reachable: string[]; reachabilityTruncated?: boolean } | undefined {
    const seeds: string[] = [];
    
    // Find seed files
    try {
      const pkgJson = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf8'));
      
      // 1. Bin entries
      if (pkgJson.bin) {
        const binPaths = typeof pkgJson.bin === 'string' 
          ? [pkgJson.bin] 
          : Object.values(pkgJson.bin as Record<string, string>);
        
        for (const binPath of binPaths) {
          // Handle dist/ paths by mapping to src/
          let sourcePath = binPath;
          if (binPath.startsWith('dist/') && binPath.endsWith('.js')) {
            sourcePath = binPath.replace('dist/', 'src/').replace(/\.js$/, '.ts');
            // Check if the source file exists
            try {
              readFileSync(join(rootPath, sourcePath));
              seeds.push(this.toPosiXPath(sourcePath));
              continue;
            } catch {
              // Fall back to trying the original path
            }
          }
          
          const resolved = this.resolveImport(sourcePath, join(rootPath, 'package.json'), program);
          if (resolved.isInternal && resolved.canonicalPath) {
            seeds.push(resolved.canonicalPath);
          }
        }
      }
      
      // 2. Exports/main/module fields
      for (const field of ['exports', 'main', 'module']) {
        if (typeof pkgJson[field] === 'string') {
          const resolved = this.resolveImport(pkgJson[field], join(rootPath, 'package.json'), program);
          if (resolved.isInternal && resolved.canonicalPath) {
            seeds.push(resolved.canonicalPath);
          }
        }
      }
    } catch {}
    
    // 3. Fallback to src/index.ts
    if (seeds.length === 0) {
      try {
        readFileSync(join(rootPath, 'src/index.ts'));
        seeds.push('src/index.ts');
      } catch {}
    }
    
    if (seeds.length === 0) return undefined;
    
    // BFS for reachability
    const visited = new Set<string>();
    const queue = [...seeds];
    
    while (queue.length > 0 && visited.size < 10000) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      
      visited.add(node);
      const neighbors = adj.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    
    const reachable = Array.from(visited).sort();
    const result: any = { 
      seeds: seeds.sort(), 
      reachable 
    };
    
    if (visited.size >= 10000) {
      result.reachabilityTruncated = true;
    }
    
    return result;
  }
  
  private computeGraphStats(
    nodes: ImportNode[],
    edges: ImportEdge[],
    adj: Map<string, Set<string>>,
    program: ts.Program
  ): GraphStats {
    // Compute degrees (internal nodes only)
    const degrees: Record<string, {in: number; out: number}> = {};
    for (const node of adj.keys()) {
      degrees[node] = { in: 0, out: adj.get(node)?.size || 0 };
    }
    for (const [_, neighbors] of adj) {
      for (const neighbor of neighbors) {
        if (degrees[neighbor]) {
          degrees[neighbor].in++;
        }
      }
    }
    
    // Find roots, leaves, isolated
    const roots: string[] = [];
    const leaves: string[] = [];
    const isolatedNodes: string[] = [];
    
    for (const [node, deg] of Object.entries(degrees)) {
      if (deg.in === 0 && deg.out === 0) isolatedNodes.push(node);
      else if (deg.in === 0 && deg.out > 0) roots.push(node);
      else if (deg.out === 0 && deg.in > 0) leaves.push(node);
    }
    
    // Count edge types
    const nodeSet = new Set(nodes.filter(n => n.kind !== 'package').map(n => n.path));
    let internalEdges = 0;
    let externalEdges = 0;
    
    for (const edge of edges) {
      if (nodeSet.has(edge.from) && nodeSet.has(edge.to)) {
        internalEdges++;
      } else {
        externalEdges++;
      }
    }
    
    // Top external imports (by package frequency)
    const externalCounts = new Map<string, number>();
    for (const edge of edges) {
      if (!nodeSet.has(edge.to)) {
        const pkg = this.parsePackageName(edge.specifier) || edge.to;
        externalCounts.set(pkg, (externalCounts.get(pkg) || 0) + 1);
      }
    }
    
    const topExternalImports = Array.from(externalCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20);
    
    // SCCs
    const { hasCycles, sccCount } = this.computeSCCs(adj);
    
    // Reachability (optional)
    const reachability = this.computeReachability(this.rootPath!, adj, program);
    
    // Sort everything for determinism
    roots.sort();
    leaves.sort();
    isolatedNodes.sort();
    
    // Build sorted degrees object
    const sortedDegrees: Record<string, {in: number; out: number}> = {};
    for (const key of Object.keys(degrees).sort()) {
      sortedDegrees[key] = degrees[key];
    }
    
    const stats: GraphStats = {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      packages: this.countUniquePackages(nodes),
      stronglyConnectedComponents: sccCount, // Deprecated but kept for compatibility
      sccCount,
      degrees: sortedDegrees,
      roots,
      leaves,
      isolatedNodes,
      internalEdges,
      externalEdges,
      hasCycles
    };
    
    if (topExternalImports.length > 0) {
      stats.topExternalImports = topExternalImports;
    }
    
    if (reachability) {
      stats.reachability = reachability;
    }
    
    return stats;
  }

  private toPosiXPath(path: string): string {
    return path.replace(/\\/g, '/');
  }
  
  private async loadWorkspacePackages(ctx: CollectorContext): Promise<Set<string>> {
    const packages = new Set<string>();
    
    // Load root package name
    try {
      const rootPkg = JSON.parse(
        readFileSync(join(ctx.rootPath, 'package.json'), 'utf8')
      );
      if (rootPkg.name) packages.add(rootPkg.name);
    } catch {}
    
    // Load workspace package names from ctx.packages
    if (ctx.packages) {
      for (const pkgDir of ctx.packages) {
        try {
          const pkgJson = JSON.parse(
            readFileSync(join(ctx.rootPath, pkgDir, 'package.json'), 'utf8')
          );
          if (pkgJson.name) packages.add(pkgJson.name);
        } catch {}
      }
    }
    
    return packages;
  }
  
  private resolveImport(
    specifier: string,
    containingFile: string,
    program: ts.Program
  ): { isInternal: boolean; canonicalPath?: string; packageName?: string } {
    // Use TypeScript's module resolution
    const resolved = ts.resolveModuleName(
      specifier,
      containingFile,
      program.getCompilerOptions(),
      ts.sys,
      this.moduleResolutionCache
    );
    
    if (resolved.resolvedModule?.resolvedFileName) {
      const fileName = resolved.resolvedModule.resolvedFileName;
      const isNodeModule = fileName.includes('node_modules');
      
      if (!isNodeModule) {
        // Internal: canonicalize to POSIX project-relative path
        return {
          isInternal: true,
          canonicalPath: this.toPosiXPath(relative(this.rootPath!, fileName))
        };
      }
    }
    
    // External or unresolved - check if it's a workspace package
    const packageName = this.parsePackageName(specifier);
    if (packageName && this.workspacePackages?.has(packageName)) {
      // Until we resolve to a real file, treat as external to prevent bogus internal edges
      return {
        isInternal: false,
        packageName
      };
    }
    
    // External package
    return {
      isInternal: false,
      packageName: packageName || specifier
    };
  }
}