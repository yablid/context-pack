/**
 * Paste Formatter - Generate copy-friendly paste output with stable separators
 */

import { SecretRedactor } from '../../core/security/secret-redaction.js';
import { TokenCounter } from '../../core/tokens/token-counter.js';
import type { PasteConfig, ScopedIndex, ScopedSymbolNode } from '../../core/contracts/scoped.js';
import type { FileInfo } from '../../core/types.js';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

// Stable separators from rewrite.md spec
export const PASTE_SEPARATORS = {
  SECTION_HEADER: '==== SECTION: HEADER ====',
  INDEX: '==== INDEX ====',
  FILE: (path: string, loc: number) => `==== FILE: ${path} (LOC ${loc}) ====`,
  EXCERPT: (path: string, startLine: number, endLine: number) => `==== EXCERPT: ${path} L${startLine}–L${endLine} ====`,
  SUMMARY: '==== SUMMARY ====',
  END: '==== END ====',
} as const;

export interface PasteSection {
  readonly type: 'header' | 'index' | 'file' | 'excerpt' | 'summary';
  readonly path?: string;
  readonly content: string;
  readonly tokens: number;
  readonly bytes: number;
  readonly lines: number;
}

export interface PasteResult {
  readonly sections: readonly PasteSection[];
  readonly totalTokens: number;
  readonly totalBytes: number;
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly omissionMarkers: readonly string[];
}

export class PasteFormatter {
  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Format scoped index as paste output with budget enforcement
   */
  formatToPaste(scopedIndex: ScopedIndex, config: PasteConfig, files: FileInfo[]): PasteResult {
    const sections: PasteSection[] = [];
    let totalTokens = 0;
    let totalBytes = 0;
    let totalLines = 0;
    const omissionMarkers: string[] = [];
    let truncated = false;

    // 1. Header Section
    const headerSection = this.createHeaderSection(scopedIndex);
    if (this.withinBudget(totalTokens + headerSection.tokens, totalBytes + headerSection.bytes, config)) {
      sections.push(headerSection);
      totalTokens += headerSection.tokens;
      totalBytes += headerSection.bytes;
      totalLines += headerSection.lines;
    }

    // 2. Index Section
    const indexSection = this.createIndexSection(scopedIndex);
    if (this.withinBudget(totalTokens + indexSection.tokens, totalBytes + indexSection.bytes, config)) {
      sections.push(indexSection);
      totalTokens += indexSection.tokens;
      totalBytes += indexSection.bytes;
      totalLines += indexSection.lines;
    }

    // 3. File Sections (sorted by relevance/path)
    const relevantFiles = this.getRelevantFiles(scopedIndex, files);
    const sortedFiles = this.sortFilesByRelevance(relevantFiles, scopedIndex);

    for (const fileInfo of sortedFiles) {
      if (config.budgetFiles && sections.filter(s => s.type === 'file').length >= config.budgetFiles) {
        const remainingCount = sortedFiles.length - sections.filter(s => s.type === 'file').length;
        omissionMarkers.push(`…omitted ${remainingCount} files due to file budget limit`);
        truncated = true;
        break;
      }

      const fileSection = this.createFileSection(fileInfo, config);
      if (this.withinBudget(totalTokens + fileSection.tokens, totalBytes + fileSection.bytes, config)) {
        sections.push(fileSection);
        totalTokens += fileSection.tokens;
        totalBytes += fileSection.bytes;
        totalLines += fileSection.lines;
      } else {
        const remainingCount = sortedFiles.length - sections.filter(s => s.type === 'file').length;
        omissionMarkers.push(`…omitted ${remainingCount} files due to budget constraints`);
        truncated = true;
        break;
      }
    }

    // 4. Summary Section
    const summarySection = this.createSummarySection(scopedIndex, totalTokens, totalBytes, truncated);
    if (this.withinBudget(totalTokens + summarySection.tokens, totalBytes + summarySection.bytes, config)) {
      sections.push(summarySection);
      totalTokens += summarySection.tokens;
      totalBytes += summarySection.bytes;
      totalLines += summarySection.lines;
    }

    return {
      sections,
      totalTokens,
      totalBytes,
      totalLines,
      truncated,
      omissionMarkers,
    };
  }

  /**
   * Convert paste result to final string
   */
  renderPaste(pasteResult: PasteResult): string {
    const parts: string[] = [];

    for (const section of pasteResult.sections) {
      parts.push(section.content);
    }

    // Add omission markers
    for (const marker of pasteResult.omissionMarkers) {
      parts.push(`\n${marker}\n`);
    }

    // End marker
    parts.push(PASTE_SEPARATORS.END);

    return parts.join('\n\n');
  }

  /**
   * Create header section
   */
  private createHeaderSection(scopedIndex: ScopedIndex): PasteSection {
    const content = [
      PASTE_SEPARATORS.SECTION_HEADER,
      `Seed: ${scopedIndex.seed}`,
      `Resolution: ${scopedIndex.resolution.success ? 'SUCCESS' : 'FAILED'}`,
      `Generated: ${scopedIndex.symbolGraph.generatedAt}`,
      `Nodes: ${scopedIndex.stats.totalNodes}`,
      `Edges: ${scopedIndex.stats.totalEdges}`,
      `Depth: ${scopedIndex.stats.depthFromSeed}`,
    ].join('\n');

    return {
      type: 'header',
      content,
      tokens: TokenCounter.countText(content).tokensAverage,
      bytes: Buffer.byteLength(content, 'utf8'),
      lines: content.split('\n').length,
    };
  }

  /**
   * Create index section
   */
  private createIndexSection(scopedIndex: ScopedIndex): PasteSection {
    const lines: string[] = [PASTE_SEPARATORS.INDEX];

    // Sort nodes by path then symbol for deterministic output
    const sortedNodes = [...scopedIndex.symbolGraph.nodes].sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.symbol.localeCompare(b.symbol);
    });

    for (const node of sortedNodes) {
      const isLeaf = !scopedIndex.symbolGraph.edges.some(e => e.from === node.id);
      const isRoot = node.id === scopedIndex.symbolGraph.seedNodeId;
      const prefix = isRoot ? '🌱' : isLeaf ? '🍃' : '🔗';

      lines.push(`${prefix} ${node.path}#${node.symbol} (${node.kind})`);
    }

    const content = lines.join('\n');

    return {
      type: 'index',
      content,
      tokens: TokenCounter.countText(content).tokensAverage,
      bytes: Buffer.byteLength(content, 'utf8'),
      lines: content.split('\n').length,
    };
  }

  /**
   * Create file section
   */
  private createFileSection(fileInfo: FileInfo, config: PasteConfig): PasteSection {
    const relativePath = this.toProjectRelativePosix(fileInfo.path);
    let content = PASTE_SEPARATORS.FILE(relativePath, fileInfo.loc);

    if (config.allowCodeBodies) {
      try {
        let fileContent = readFileSync(fileInfo.path, 'utf8');

        // Apply secret redaction if enabled
        if (config.redactSecrets) {
          const redactionResult = SecretRedactor.scanContent(fileContent);
          if (redactionResult.hasSecrets && redactionResult.redactedContent) {
            fileContent = redactionResult.redactedContent;
          }
        }

        // Normalize line endings
        fileContent = fileContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        content += '\n' + fileContent;
      } catch (error) {
        content += '\n// Error reading file: ' + (error instanceof Error ? error.message : 'Unknown error');
      }
    } else {
      content += '\n// Code bodies not included (allowCodeBodies: false)';
    }

    return {
      type: 'file',
      path: relativePath,
      content,
      tokens: TokenCounter.countText(content).tokensAverage,
      bytes: Buffer.byteLength(content, 'utf8'),
      lines: content.split('\n').length,
    };
  }

  /**
   * Create summary section
   */
  private createSummarySection(
    scopedIndex: ScopedIndex,
    totalTokens: number,
    totalBytes: number,
    truncated: boolean
  ): PasteSection {
    const lines = [
      PASTE_SEPARATORS.SUMMARY,
      `Total tokens: ${totalTokens}`,
      `Total bytes: ${totalBytes}`,
      `Truncated: ${truncated ? 'Yes' : 'No'}`,
    ];

    if (scopedIndex.resolution.diagnostics.length > 0) {
      lines.push('Diagnostics:');
      for (const diagnostic of scopedIndex.resolution.diagnostics) {
        lines.push(`  - ${diagnostic.code}: ${diagnostic.message}`);
      }
    }

    const content = lines.join('\n');

    return {
      type: 'summary',
      content,
      tokens: TokenCounter.countText(content).tokensAverage,
      bytes: Buffer.byteLength(content, 'utf8'),
      lines: content.split('\n').length,
    };
  }

  /**
   * Get relevant files from symbol graph
   */
  private getRelevantFiles(scopedIndex: ScopedIndex, allFiles: FileInfo[]): FileInfo[] {
    const relevantPaths = new Set(scopedIndex.symbolGraph.nodes.map(node =>
      this.resolveAbsolutePath(node.path)
    ));

    return allFiles.filter(file => relevantPaths.has(file.path));
  }

  /**
   * Sort files by relevance (seed file first, then alphabetically)
   */
  private sortFilesByRelevance(files: FileInfo[], scopedIndex: ScopedIndex): FileInfo[] {
    const seedPath = scopedIndex.resolution.location?.path;

    return files.sort((a, b) => {
      // Seed file comes first
      if (seedPath) {
        if (a.path === seedPath) return -1;
        if (b.path === seedPath) return 1;
      }

      // Then alphabetically by relative path
      const pathA = this.toProjectRelativePosix(a.path);
      const pathB = this.toProjectRelativePosix(b.path);
      return pathA.localeCompare(pathB);
    });
  }

  /**
   * Check if content fits within budget
   */
  private withinBudget(tokens: number, bytes: number, config: PasteConfig): boolean {
    return tokens <= config.budgetTokens && bytes <= config.budgetBytes;
  }

  /**
   * Convert to project-relative POSIX path
   */
  private toProjectRelativePosix(absolutePath: string): string {
    const relativePath = relative(this.rootPath, absolutePath);
    return relativePath.replace(/\\/g, '/');
  }

  /**
   * Resolve relative path to absolute
   */
  private resolveAbsolutePath(relativePath: string): string {
    return require('node:path').resolve(this.rootPath, relativePath);
  }
}