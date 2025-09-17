// Core graph analysis and scoring for structural signals
// Operates purely on graph data - no file system reads

export interface ImportNode {
  path: string;
  kind: 'source' | 'declaration' | 'package';
}

export interface ImportEdge {
  from: string;
  to: string;
  kind: 'import' | 'export' | 'reexport';
  specifier: string;
}

export interface ImportGraphData {
  nodes: ImportNode[];
  edges: ImportEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    sccCount: number;
    hasCycles: boolean;
    degrees: Record<string, { in: number; out: number }>;
    roots: string[];
    leaves: string[];
    isolatedNodes: string[];
    internalEdges: number;
    externalEdges: number;
    topExternalImports: [string, number][];
  };
  externalDeps: Record<string, string[]>;
}

export interface ExportedSymbol {
  name: string;
  kind: 'function' | 'class' | 'type' | 'interface' | 'enum' | 'var' | 'default' | 'reexport';
  isReexport: boolean;
  reexportFrom?: string;
}

export interface FileExports {
  path: string;
  exports: ExportedSymbol[];
  hasDefaultExport: boolean;
}

export interface ExportsData {
  files: FileExports[];
  summary: {
    totalFiles: number;
    totalExports: number;
    reexports: number;
    defaultExports: number;
    byKind: Record<string, number>;
  };
}

export interface GraphSignals {
  structural: {
    sccCount: number;
    hasCycles: boolean;
    totalNodes: number;
    totalEdges: number;
    internalEdges: number;
    externalEdges: number;
  };
  fanAnalysis: {
    topFanIn: Array<{ path: string; count: number }>;
    topFanOut: Array<{ path: string; count: number }>;
    highFanInThreshold: number;
    highFanOutThreshold: number;
  };
  reexportHubs: Array<{
    path: string;
    reexportCount: number;
    totalExports: number;
    reexportRatio: number;
  }>;
  externalReach: {
    totalExternalDeps: number;
    topExternalDeps: [string, number][];
    filesWithExternalDeps: number;
  };
  roleClassification: {
    roots: string[];
    leaves: string[];
    isolated: string[];
    orchestrators: string[];
    kernels: string[];
  };
  hotspots: Array<{
    path: string;
    score: number;
    reasons: string[];
  }>;
}

export class GraphScorer {
  private readonly fanInThreshold = 10;
  private readonly fanOutThreshold = 10;
  private readonly reexportThreshold = 5;

  computeSignals(importGraph: ImportGraphData, exports: ExportsData): GraphSignals {
    const structural = this.computeStructuralSignals(importGraph);
    const fanAnalysis = this.computeFanAnalysis(importGraph);
    const reexportHubs = this.computeReexportHubs(exports);
    const externalReach = this.computeExternalReach(importGraph);
    const roleClassification = this.computeRoleClassification(importGraph, fanAnalysis);
    const hotspots = this.computeHotspots(importGraph, exports, fanAnalysis);

    return {
      structural,
      fanAnalysis,
      reexportHubs,
      externalReach,
      roleClassification,
      hotspots,
    };
  }

  private computeStructuralSignals(graph: ImportGraphData): GraphSignals['structural'] {
    return {
      sccCount: graph.stats.sccCount,
      hasCycles: graph.stats.hasCycles,
      totalNodes: graph.stats.totalNodes,
      totalEdges: graph.stats.totalEdges,
      internalEdges: graph.stats.internalEdges,
      externalEdges: graph.stats.externalEdges,
    };
  }

  private computeFanAnalysis(graph: ImportGraphData): GraphSignals['fanAnalysis'] {
    const degrees = graph.stats.degrees;

    const fanInEntries = Object.entries(degrees)
      .map(([path, degree]) => ({ path, count: degree.in }))
      .sort((a, b) => b.count - a.count);

    const fanOutEntries = Object.entries(degrees)
      .map(([path, degree]) => ({ path, count: degree.out }))
      .sort((a, b) => b.count - a.count);

    return {
      topFanIn: fanInEntries.slice(0, 10),
      topFanOut: fanOutEntries.slice(0, 10),
      highFanInThreshold: this.fanInThreshold,
      highFanOutThreshold: this.fanOutThreshold,
    };
  }

  private computeReexportHubs(exports: ExportsData): GraphSignals['reexportHubs'] {
    return exports.files
      .map(file => {
        const reexportCount = file.exports.filter(exp => exp.isReexport).length;
        const totalExports = file.exports.length;
        const reexportRatio = totalExports > 0 ? reexportCount / totalExports : 0;

        return {
          path: file.path,
          reexportCount,
          totalExports,
          reexportRatio,
        };
      })
      .filter(hub => hub.reexportCount >= this.reexportThreshold)
      .sort((a, b) => b.reexportCount - a.reexportCount);
  }

  private computeExternalReach(graph: ImportGraphData): GraphSignals['externalReach'] {
    const externalDeps = graph.externalDeps;
    const totalExternalDeps = Object.keys(externalDeps).length;
    const filesWithExternalDeps = Object.values(externalDeps).flat().length;

    const topExternalDeps = graph.stats.topExternalImports || [];

    return {
      totalExternalDeps,
      topExternalDeps,
      filesWithExternalDeps,
    };
  }

  private computeRoleClassification(
    graph: ImportGraphData,
    fanAnalysis: GraphSignals['fanAnalysis']
  ): GraphSignals['roleClassification'] {
    const highFanIn = new Set(
      fanAnalysis.topFanIn
        .filter(entry => entry.count >= this.fanInThreshold)
        .map(entry => entry.path)
    );

    const highFanOut = new Set(
      fanAnalysis.topFanOut
        .filter(entry => entry.count >= this.fanOutThreshold)
        .map(entry => entry.path)
    );

    return {
      roots: graph.stats.roots,
      leaves: graph.stats.leaves,
      isolated: graph.stats.isolatedNodes,
      orchestrators: fanAnalysis.topFanOut
        .filter(entry => entry.count >= this.fanOutThreshold)
        .map(entry => entry.path),
      kernels: fanAnalysis.topFanIn
        .filter(entry => entry.count >= this.fanInThreshold)
        .map(entry => entry.path),
    };
  }

  private computeHotspots(
    graph: ImportGraphData,
    exports: ExportsData,
    fanAnalysis: GraphSignals['fanAnalysis']
  ): GraphSignals['hotspots'] {
    const scores = new Map<string, { score: number; reasons: string[] }>();

    // Score based on fan-in (kernels with high dependence)
    fanAnalysis.topFanIn.forEach(entry => {
      const existing = scores.get(entry.path) || { score: 0, reasons: [] };
      if (entry.count >= this.fanInThreshold) {
        existing.score += entry.count;
        existing.reasons.push(`high fan-in (${entry.count})`);
      }
      scores.set(entry.path, existing);
    });

    // Score based on fan-out (orchestrators)
    fanAnalysis.topFanOut.forEach(entry => {
      const existing = scores.get(entry.path) || { score: 0, reasons: [] };
      if (entry.count >= this.fanOutThreshold) {
        existing.score += entry.count;
        existing.reasons.push(`high fan-out (${entry.count})`);
      }
      scores.set(entry.path, existing);
    });

    // Score based on re-export hubs
    exports.files.forEach(file => {
      const reexportCount = file.exports.filter(exp => exp.isReexport).length;
      if (reexportCount >= this.reexportThreshold) {
        const existing = scores.get(file.path) || { score: 0, reasons: [] };
        existing.score += reexportCount;
        existing.reasons.push(`re-export hub (${reexportCount})`);
        scores.set(file.path, existing);
      }
    });

    return Array.from(scores.entries())
      .map(([path, data]) => ({ path, score: data.score, reasons: data.reasons }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Top 20 hotspots
  }
}