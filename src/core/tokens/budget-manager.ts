import type { Artifact, DownsamplingDecision } from '../types.js';

export interface BudgetConfig {
  totalBytes: number;
  artifactLimits?: Record<string, number>;
}

export interface ValueScorer {
  score(artifact: Artifact): number;
}

export class DefaultValueScorer implements ValueScorer {
  score(artifact: Artifact): number {
    // Higher scores for smaller, more valuable artifacts
    let score = 1000 / Math.max(1, artifact.sizeHint);
    
    // Boost core artifacts
    if (artifact.id.includes('topology') || artifact.id.includes('import-graph')) {
      score *= 2;
    }
    
    // Boost public API artifacts
    if (artifact.id.includes('public-api') || artifact.id.includes('exports')) {
      score *= 1.5;
    }
    
    return score;
  }
}

export class BudgetManager {
  private config: BudgetConfig;
  private scorer: ValueScorer;
  private downsampling: DownsamplingDecision[] = [];

  constructor(config: BudgetConfig, scorer: ValueScorer = new DefaultValueScorer()) {
    this.config = config;
    this.scorer = scorer;
  }

  /**
   * Enforce budget constraints on a set of artifacts
   * Returns the artifacts that fit within budget, possibly downsampled
   */
  enforce(artifacts: Artifact[]): { artifacts: Artifact[]; downsampling: DownsamplingDecision[] } {
    this.downsampling = [];
    let processedArtifacts = [...artifacts];

    // First pass: check artifact-specific limits
    processedArtifacts = this.enforceArtifactLimits(processedArtifacts);

    // Second pass: check total budget
    processedArtifacts = this.enforceTotalBudget(processedArtifacts);

    return {
      artifacts: processedArtifacts,
      downsampling: this.downsampling
    };
  }

  private enforceArtifactLimits(artifacts: Artifact[]): Artifact[] {
    if (!this.config.artifactLimits) {
      return artifacts;
    }

    return artifacts.map(artifact => {
      const limit = this.config.artifactLimits?.[artifact.filename];
      if (limit && artifact.sizeHint > limit) {
        const downsampled = this.downsampleArtifact(artifact, limit);
        this.recordDownsampling(artifact.id, 'artifact-limit', 1, 1, 'size-reduction');
        return downsampled;
      }
      return artifact;
    });
  }

  private enforceTotalBudget(artifacts: Artifact[]): Artifact[] {
    const totalSize = artifacts.reduce((sum, a) => sum + a.sizeHint, 0);
    
    if (totalSize <= this.config.totalBytes) {
      return artifacts;
    }

    // Sort by value score (highest first)
    const scored = artifacts
      .map(artifact => ({ artifact, score: this.scorer.score(artifact) }))
      .sort((a, b) => b.score - a.score);

    const result: Artifact[] = [];
    let currentSize = 0;
    let removedCount = 0;

    for (const { artifact } of scored) {
      if (currentSize + artifact.sizeHint <= this.config.totalBytes) {
        result.push(artifact);
        currentSize += artifact.sizeHint;
      } else {
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.recordDownsampling(
        'total-budget',
        'budget-exceeded',
        artifacts.length,
        result.length,
        'value-scoring'
      );
    }

    return result;
  }

  private downsampleArtifact(artifact: Artifact, targetSize: number): Artifact {
    // Simple downsampling strategy - could be enhanced per artifact type
    if (artifact.kind === 'json' && artifact.data) {
      return this.downsampleJSONData(artifact, targetSize);
    }
    
    if (artifact.kind === 'text' && artifact.text) {
      return this.downsampleTextData(artifact, targetSize);
    }

    return artifact;
  }

  private downsampleJSONData(artifact: Artifact, targetSize: number): Artifact {
    const data = artifact.data;
    
    // If it's an array, take the first N items that fit
    if (Array.isArray(data)) {
      const ratio = targetSize / artifact.sizeHint;
      let targetCount = Math.floor(data.length * ratio);
      if (data.length > 0) targetCount = Math.max(1, targetCount);
      
      return {
        ...artifact,
        data: data.slice(0, targetCount),
        sizeHint: targetSize
      };
    }

    // For objects, could implement field prioritization
    return artifact;
  }

  private downsampleTextData(artifact: Artifact, targetSize: number): Artifact {
    if (!artifact.text) return artifact;
    
    const ratio = targetSize / artifact.sizeHint;
    const targetLength = Math.floor(artifact.text.length * ratio);
    
    return {
      ...artifact,
      text: artifact.text.substring(0, targetLength) + '\n// ... truncated for budget',
      sizeHint: targetSize
    };
  }

  private recordDownsampling(
    artifactId: string,
    reason: string,
    originalCount: number,
    finalCount: number,
    strategy: string
  ): void {
    this.downsampling.push({
      artifactId,
      reason,
      originalCount,
      finalCount,
      strategy
    });
  }

  getDownsamplingDecisions(): DownsamplingDecision[] {
    return [...this.downsampling];
  }

  static calculateBudgetForLevel(level: 'summary' | 'contracts' | 'full-api' | 'deep'): number {
    switch (level) {
      case 'summary': return 500_000; // 500 KB
      case 'contracts': return 1_500_000; // 1.5 MB
      case 'full-api': return 2_000_000; // 2 MB
      case 'deep': return 10_000_000; // 10 MB (custom)
      default: return 2_000_000;
    }
  }
}