import type { CollectorContext, Artifact, FileInfo } from '../types.js';
import { BaseCollector } from './base-collector.js';
import { CanonicalJSON } from '../engine/canonical-json.js';

export class FilesManifestCollector extends BaseCollector {
  readonly name = 'files-manifest';
  readonly schemaIds = ['20-files-manifest'];

  async detect(_rootPath: string): Promise<boolean> {
    // This collector always runs - it provides the basic file inventory
    return true;
  }

  async collect(context: CollectorContext): Promise<Artifact[]> {
    this.log(`Processing ${context.files.length} files`, context);

    // Sort files for deterministic output
    const sortedFiles = context.files.sort((a, b) => a.path.localeCompare(b.path));
    
    // Apply budget constraints if needed
    let finalFiles = sortedFiles;
    if (context.budgetHint && this.estimateSize(sortedFiles) > context.budgetHint) {
      finalFiles = this.applyBudgetConstraints(sortedFiles, context.budgetHint, context);
    }

    // Convert to NDJSON format
    const ndjsonContent = CanonicalJSON.stringifyNDJSON(finalFiles);
    
    const artifact = this.createArtifact(
      'files-manifest',
      '20-files-manifest.ndjson',
      '20-files-manifest',
      undefined,
      ndjsonContent
    );

    this.log(`Generated manifest with ${finalFiles.length} files (${artifact.sizeHint} bytes)`, context);

    return [artifact];
  }

  private estimateSize(files: FileInfo[]): number {
    // Estimate JSON size - rough calculation using canonical JSON
    return files.reduce((total, file) => {
      return total + CanonicalJSON.byteSize(file); // Use canonical byte size
    }, 0);
  }

  private applyBudgetConstraints(
    files: FileInfo[], 
    budget: number, 
    context: CollectorContext
  ): FileInfo[] {
    // Simple strategy: prioritize by file importance and size
    const scored = files.map(file => ({
      file,
      score: this.calculateFileScore(file)
    })).sort((a, b) => b.score - a.score);

    const result: FileInfo[] = [];
    let currentSize = 0;

    for (const { file } of scored) {
      const estimatedSize = CanonicalJSON.byteSize(file);
      if (currentSize + estimatedSize <= budget) {
        result.push(file);
        currentSize += estimatedSize;
      }
    }

    if (result.length < files.length) {
      this.log(`Downsampled from ${files.length} to ${result.length} files due to budget constraints`, context);
    }

    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  private calculateFileScore(file: FileInfo): number {
    let score = 1000; // Base score

    // Prioritize by file kind
    switch (file.kind) {
      case 'code':
        score += 100;
        break;
      case 'config':
        score += 80;
        break;
      case 'docs':
        score += 60;
        break;
      case 'test':
        score += 40;
        break;
      case 'asset':
        score += 20;
        break;
    }

    // Prioritize public files
    if (file.bucket === 'public') {
      score += 50;
    } else if (file.bucket === 'internal') {
      score += 30;
    }

    // Prioritize important file patterns
    if (file.path.includes('index.') || file.path.includes('main.')) {
      score += 100;
    }
    if (file.path.includes('config') || file.path.includes('package.json')) {
      score += 80;
    }

    // Penalize very large files
    if (file.bytes > 100000) { // > 100KB
      score -= 200;
    }

    return score;
  }
}