import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { createHash } from 'crypto';
import { BaseCollector } from '../base-collector.js';
import type { Artifact, CollectorContext } from '../../types.js';
import { CanonicalJSON } from '../../engine/canonical-json.js';

interface FileFingerprint {
  file: string; // POSIX-style relative path
  hash: string;
  normalizedContent: string;
  size: number;
  shingles: string[];
}

interface DuplicationCluster {
  id: string;
  size: number; // number of files in cluster
  totalBytes: number;
  representativeFile: string;
  similarFiles: string[];
  similarity: number; // 0-1, average similarity within cluster
}

interface DuplicationData {
  clusters: DuplicationCluster[];
  summary: {
    totalFiles: number;
    duplicatedFiles: number;
    duplicatedBytes: number;
    largestClusterSize: number;
    compressionRatio: number; // potential space savings
  };
}

export class DuplicationCollector extends BaseCollector {
  readonly name = 'duplication';
  readonly schemaIds = ['40-duplication-report'];

  private readonly shingleSize = 5; // n-gram size
  private readonly minShingles = 10; // minimum shingles for comparison
  private readonly similarityThreshold = 0.7; // threshold for clustering

  async detect(_rootPath: string): Promise<boolean> {
    // Always available - works on any codebase
    return true;
  }

  async collect(ctx: CollectorContext): Promise<Artifact[]> {
    const sourceFiles = this.findSourceFiles(ctx.rootPath);
    const fingerprints = this.generateFingerprints(sourceFiles, ctx.rootPath);
    const clusters = this.clusterSimilarFiles(fingerprints);
    const summary = this.calculateSummary(fingerprints, clusters);

    const data: DuplicationData = {
      clusters,
      summary
    };

    return [{
      id: this.name,
      filename: '40-duplication-report.json',
      kind: 'json',
      schemaId: this.schemaIds[0],
      sizeHint: CanonicalJSON.byteSize(data),
      data
    }];
  }

  private findSourceFiles(rootPath: string): string[] {
    const sourceFiles: string[] = [];
    const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go'];
    
    const walkDir = (dir: string): void => {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            // Skip excluded directories
            if (!entry.startsWith('.') && 
                entry !== 'node_modules' && 
                entry !== 'dist' && 
                entry !== 'build' &&
                entry !== 'coverage' &&
                entry !== '__pycache__' &&
                entry !== 'target') {
              walkDir(fullPath);
            }
          } else if (stat.isFile() && 
                     codeExtensions.includes(extname(entry).toLowerCase()) &&
                     !this.isExcludedFile(entry, fullPath)) {
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

  private isExcludedFile(filename: string, fullPath: string): boolean {
    // Exclude generated files, test snapshots, etc.
    const excludePatterns = [
      /\.d\.ts$/,
      /\.min\.js$/,
      /\.bundle\.js$/,
      /\.generated\./,
      /\.snap$/,
      /\.lock$/,
      /__generated__/,
      /__snapshots__/,
      /\.test\./,
      /\.spec\./,
      /LICENSE/i,
      /README/i
    ];

    return excludePatterns.some(pattern => 
      pattern.test(filename) || pattern.test(fullPath)
    );
  }

  private generateFingerprints(filePaths: string[], rootPath: string): FileFingerprint[] {
    const fingerprints: FileFingerprint[] = [];

    for (const filePath of filePaths) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const normalizedContent = this.normalizeContent(content);
        
        // Skip very small files
        if (normalizedContent.length < 100) {
          continue;
        }

        const shingles = this.generateShingles(normalizedContent);
        
        // Skip files with too few shingles
        if (shingles.length < this.minShingles) {
          continue;
        }

        const hash = createHash('sha256')
          .update(normalizedContent)
          .digest('hex')
          .substring(0, 16);

        fingerprints.push({
          file: this.toPosiXPath(relative(rootPath, filePath)),
          hash,
          normalizedContent,
          size: content.length,
          shingles
        });
      } catch (error) {
        console.warn(`Failed to fingerprint ${filePath}: ${error}`);
      }
    }

    return fingerprints;
  }

  private normalizeContent(content: string): string {
    return content
      // Remove comments (simple regex - not perfect but good enough)
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/.*$/gm, '') // line comments
      .replace(/#.*$/gm, '') // Python/shell comments
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove common license headers and imports (they create false positives)
      .replace(/^import\s+.*$/gm, '')
      .replace(/^from\s+.*import\s+.*$/gm, '')
      .replace(/^use\s+.*$/gm, '') // Rust
      .replace(/^\s*$\n/gm, '') // empty lines
      .trim();
  }

  private generateShingles(content: string): string[] {
    const words = content.split(/\s+/).filter(word => word.length > 0);
    const shingles: string[] = [];

    for (let i = 0; i <= words.length - this.shingleSize; i++) {
      const shingle = words.slice(i, i + this.shingleSize).join(' ');
      shingles.push(this.hashShingle(shingle));
    }

    return shingles;
  }

  private hashShingle(shingle: string): string {
    return createHash('md5').update(shingle).digest('hex').substring(0, 8);
  }

  private clusterSimilarFiles(fingerprints: FileFingerprint[]): DuplicationCluster[] {
    const clusters: DuplicationCluster[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < fingerprints.length; i++) {
      const currentFile = fingerprints[i];
      if (!currentFile) continue;
      
      if (processed.has(currentFile.file)) {
        continue;
      }

      const similarFiles: string[] = [];
      let totalBytes = currentFile.size;
      const similarities: number[] = [];

      for (let j = i + 1; j < fingerprints.length; j++) {
        const otherFile = fingerprints[j];
        if (!otherFile) continue;
        
        if (processed.has(otherFile.file)) {
          continue;
        }

        const similarity = this.calculateSimilarity(currentFile.shingles, otherFile.shingles);
        
        if (similarity >= this.similarityThreshold) {
          similarFiles.push(otherFile.file);
          totalBytes += otherFile.size;
          similarities.push(similarity);
          processed.add(otherFile.file);
        }
      }

      // Only create clusters with multiple files
      if (similarFiles.length > 0) {
        const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
        
        clusters.push({
          id: `cluster-${currentFile.hash}`,
          size: similarFiles.length + 1,
          totalBytes,
          representativeFile: currentFile.file,
          similarFiles,
          similarity: avgSimilarity
        });

        processed.add(currentFile.file);
      }
    }

    // Sort clusters by total bytes (largest first)
    return clusters.sort((a, b) => b.totalBytes - a.totalBytes);
  }

  private calculateSimilarity(shingles1: string[], shingles2: string[]): number {
    const set1 = new Set(shingles1);
    const set2 = new Set(shingles2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    // Jaccard similarity
    return intersection.size / union.size;
  }

  private calculateSummary(fingerprints: FileFingerprint[], clusters: DuplicationCluster[]) {
    const totalFiles = fingerprints.length;
    let duplicatedFiles = 0;
    let duplicatedBytes = 0;
    let largestClusterSize = 0;

    for (const cluster of clusters) {
      duplicatedFiles += cluster.size;
      duplicatedBytes += cluster.totalBytes;
      largestClusterSize = Math.max(largestClusterSize, cluster.size);
    }

    const totalBytes = fingerprints.reduce((sum, fp) => sum + fp.size, 0);
    const compressionRatio = totalBytes > 0 ? duplicatedBytes / totalBytes : 0;

    return {
      totalFiles,
      duplicatedFiles,
      duplicatedBytes,
      largestClusterSize,
      compressionRatio
    };
  }

  private toPosiXPath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}