// Refactor report service - generates structural analysis from graph artifacts
// No file system reads - operates purely on existing graph + exports data

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GraphScorer } from '../../core/graph/scorer.js';
import type {
  RefactorReportConfig,
  RefactorReport,
  RefactorReportResult,
  SuggestedCut
} from '../../core/contracts/refactor-report.js';
import type {
  ImportGraphData,
  ExportsData,
  GraphSignals
} from '../../core/graph/scorer.js';

export class RefactorReportService {
  private readonly scorer = new GraphScorer();

  async generateReport(config: RefactorReportConfig): Promise<RefactorReportResult> {
    const importGraph = this.loadImportGraph(config);
    const exports = this.loadExports(config);

    const signals = this.scorer.computeSignals(importGraph, exports);
    const report = this.buildReport(signals, config);

    const artifacts = config.format === 'json'
      ? this.createJsonArtifacts(report)
      : this.createPasteArtifacts(report);

    return { report, artifacts };
  }

  private loadImportGraph(config: RefactorReportConfig): ImportGraphData {
    const graphPath = config.importGraphPath ||
      resolve(config.rootPath, '.contextpack/full/30-import-graph.json');

    try {
      const content = readFileSync(graphPath, 'utf-8');
      return JSON.parse(content) as ImportGraphData;
    } catch (error) {
      throw new Error(`Failed to load import graph from ${graphPath}: ${error}`);
    }
  }

  private loadExports(config: RefactorReportConfig): ExportsData {
    const exportsPath = config.exportsPath ||
      resolve(config.rootPath, '.contextpack/full/ts/60-exports.json');

    try {
      const content = readFileSync(exportsPath, 'utf-8');
      return JSON.parse(content) as ExportsData;
    } catch (error) {
      throw new Error(`Failed to load exports from ${exportsPath}: ${error}`);
    }
  }

  private buildReport(signals: GraphSignals, config: RefactorReportConfig): RefactorReport {
    const suggestedCuts = this.generateSuggestedCuts(signals);
    const summary = this.generateSummary(signals);

    return {
      metadata: {
        generatedAt: new Date().toISOString(),
        analysisType: 'structural-signals',
        sourceArtifacts: {
          importGraph: config.importGraphPath,
          exports: config.exportsPath,
        },
      },
      structural: {
        sccCount: signals.structural.sccCount,
        hasCycles: signals.structural.hasCycles,
        totalNodes: signals.structural.totalNodes,
        totalEdges: signals.structural.totalEdges,
        internalEdges: signals.structural.internalEdges,
        externalEdges: signals.structural.externalEdges,
        suggestedCuts,
      },
      fanAnalysis: {
        topFanIn: signals.fanAnalysis.topFanIn,
        topFanOut: signals.fanAnalysis.topFanOut,
        thresholds: {
          fanIn: signals.fanAnalysis.highFanInThreshold,
          fanOut: signals.fanAnalysis.highFanOutThreshold,
        },
      },
      reexportHubs: signals.reexportHubs,
      externalReach: signals.externalReach,
      roleClassification: signals.roleClassification,
      hotspots: signals.hotspots,
      summary,
    };
  }

  private generateSuggestedCuts(signals: GraphSignals): SuggestedCut[] {
    const cuts: SuggestedCut[] = [];

    // Suggest cutting edges from orchestrators with very high fan-out
    signals.fanAnalysis.topFanOut
      .filter(entry => entry.count > 15) // Very high threshold
      .forEach(entry => {
        cuts.push({
          edge: {
            from: entry.path,
            to: '**/*', // Placeholder - would need actual edge analysis
            kind: 'import',
            specifier: 'multiple',
          },
          reason: `Orchestrator with excessive fan-out (${entry.count}) should be split`,
          impact: 'high',
          alternatives: ['Split into smaller, focused modules', 'Extract common dependencies'],
        });
      });

    // Suggest reducing re-export hubs
    signals.reexportHubs
      .filter(hub => hub.reexportRatio > 0.8 && hub.reexportCount > 10)
      .forEach(hub => {
        cuts.push({
          edge: {
            from: '**/*',
            to: hub.path,
            kind: 'reexport',
            specifier: 'barrel',
          },
          reason: `Large re-export hub (${hub.reexportCount} re-exports) creates coupling`,
          impact: 'medium',
          alternatives: ['Direct imports instead of barrel', 'Split into smaller, focused barrels'],
        });
      });

    return cuts;
  }

  private generateSummary(signals: GraphSignals): RefactorReport['summary'] {
    const concerns: string[] = [];
    const actions: string[] = [];

    if (signals.structural.hasCycles) {
      concerns.push(`${signals.structural.sccCount} circular dependencies detected`);
      actions.push('Break circular dependencies by extracting interfaces or common modules');
    }

    const highFanOut = signals.fanAnalysis.topFanOut.filter(entry => entry.count > 15);
    if (highFanOut.length > 0) {
      concerns.push(`${highFanOut.length} files with excessive fan-out (>15 dependencies)`);
      actions.push('Split large orchestrators into smaller, focused modules');
    }

    const largeReexportHubs = signals.reexportHubs.filter(hub => hub.reexportCount > 20);
    if (largeReexportHubs.length > 0) {
      concerns.push(`${largeReexportHubs.length} large re-export hubs (>20 re-exports)`);
      actions.push('Consider direct imports instead of large barrel files');
    }

    if (concerns.length === 0) {
      concerns.push('No major structural concerns detected');
      actions.push('Maintain current architecture patterns');
    }

    const riskAssessment = this.assessRisk(signals);

    return {
      primaryConcerns: concerns,
      recommendedActions: actions,
      riskAssessment,
    };
  }

  private assessRisk(signals: GraphSignals): 'low' | 'medium' | 'high' {
    let riskScore = 0;

    if (signals.structural.hasCycles) riskScore += 3;
    if (signals.fanAnalysis.topFanOut.some(entry => entry.count > 20)) riskScore += 2;
    if (signals.reexportHubs.some(hub => hub.reexportCount > 30)) riskScore += 2;
    if (signals.hotspots.some(spot => spot.score > 50)) riskScore += 1;

    if (riskScore >= 5) return 'high';
    if (riskScore >= 3) return 'medium';
    return 'low';
  }

  private createJsonArtifacts(report: RefactorReport): RefactorReportResult['artifacts'] {
    const jsonContent = JSON.stringify(report, null, 2);

    return [{
      id: 'refactor-report',
      filename: 'refactor-report.json',
      kind: 'json',
      schemaId: 'refactor-report',
      sizeHint: jsonContent.length,
      data: report,
    }];
  }

  private createPasteArtifacts(report: RefactorReport): RefactorReportResult['artifacts'] {
    const pasteContent = this.formatAsPaste(report);

    return [{
      id: 'refactor-report',
      filename: 'refactor-report.txt',
      kind: 'text',
      schemaId: 'refactor-report-paste',
      sizeHint: pasteContent.length,
      text: pasteContent,
    }];
  }

  private formatAsPaste(report: RefactorReport): string {
    const lines: string[] = [];

    lines.push('==== SECTION: REFACTOR REPORT ====');
    lines.push(`Generated: ${report.metadata.generatedAt}`);
    lines.push(`Analysis: ${report.metadata.analysisType}`);
    lines.push('');

    lines.push('==== STRUCTURAL ANALYSIS ====');
    lines.push(`Nodes: ${report.structural.totalNodes}`);
    lines.push(`Edges: ${report.structural.totalEdges} (${report.structural.internalEdges} internal, ${report.structural.externalEdges} external)`);
    lines.push(`Cycles: ${report.structural.hasCycles ? `YES (${report.structural.sccCount} SCCs)` : 'NO'}`);
    lines.push('');

    lines.push('==== TOP FAN-IN (Dependencies) ====');
    report.fanAnalysis.topFanIn.slice(0, 10).forEach(entry => {
      lines.push(`${entry.path}: ${entry.count}`);
    });
    lines.push('');

    lines.push('==== TOP FAN-OUT (Orchestrators) ====');
    report.fanAnalysis.topFanOut.slice(0, 10).forEach(entry => {
      lines.push(`${entry.path}: ${entry.count}`);
    });
    lines.push('');

    if (report.reexportHubs.length > 0) {
      lines.push('==== RE-EXPORT HUBS ====');
      report.reexportHubs.slice(0, 10).forEach(hub => {
        lines.push(`${hub.path}: ${hub.reexportCount}/${hub.totalExports} (${Math.round(hub.reexportRatio * 100)}%)`);
      });
      lines.push('');
    }

    lines.push('==== HOTSPOTS ====');
    report.hotspots.slice(0, 10).forEach(spot => {
      lines.push(`${spot.path}: score=${spot.score} (${spot.reasons.join(', ')})`);
    });
    lines.push('');

    lines.push('==== SUMMARY ====');
    lines.push(`Risk Assessment: ${report.summary.riskAssessment.toUpperCase()}`);
    lines.push('');
    lines.push('Primary Concerns:');
    report.summary.primaryConcerns.forEach(concern => {
      lines.push(`- ${concern}`);
    });
    lines.push('');
    lines.push('Recommended Actions:');
    report.summary.recommendedActions.forEach(action => {
      lines.push(`- ${action}`);
    });
    lines.push('');

    lines.push('==== END ====');

    return lines.join('\n');
  }
}