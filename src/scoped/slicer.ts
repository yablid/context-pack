import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RankedNode } from './ranker.js';
import type { ScopedSlice } from '../schemas/scoped-slices.js';
import { TokenCounter } from '../utils/token-counter.js';

export interface CodeSlice {
  path: string;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
  symbolId: string;
  symbolName: string;
  symbolKind: string;
  doc?: string;
  body?: string;
  reasons: string[];
  context: {
    before: number;
    after: number;
  };
  tokens?: {
    conservative: number;
    optimistic: number;
    average: number;
  };
}

export interface SlicerConfig {
  allowCodeBodies: boolean;
  contextLines: number;
  mergeOverlapping: boolean;
}

/**
 * Slicer extracts minimal code ranges for ranked symbols
 * Includes JSDoc, symbol body, and context lines
 * Merges overlapping ranges for efficiency
 */
export class Slicer {
  private config: SlicerConfig;
  private fileCache = new Map<string, string>();

  constructor(config: SlicerConfig) {
    this.config = config;
  }

  /**
   * Extract code slices for all included ranked nodes
   */
  async extractSlices(rankedNodes: RankedNode[], rootPath: string): Promise<CodeSlice[]> {
    const slicesByFile = new Map<string, CodeSlice[]>();

    // Group nodes by file
    for (const node of rankedNodes) {
      if (!node.included) continue;

      const filePath = node.symbol.fqn.path;
      if (!slicesByFile.has(filePath)) {
        slicesByFile.set(filePath, []);
      }

      const slice = await this.createSliceForNode(node, rootPath);
      if (slice) {
        slicesByFile.get(filePath)!.push(slice);
      }
    }

    // Merge overlapping slices in each file
    const allSlices: CodeSlice[] = [];
    for (const [filePath, fileSlices] of slicesByFile) {
      const mergedSlices = this.config.mergeOverlapping
        ? await this.mergeOverlappingSlices(fileSlices, filePath, rootPath)
        : fileSlices;

      allSlices.push(...mergedSlices);
    }

    // Sort for deterministic output
    allSlices.sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.startLine - b.startLine;
    });

    return allSlices;
  }

  private async createSliceForNode(node: RankedNode, rootPath: string): Promise<CodeSlice | null> {
    const filePath = node.symbol.fqn.path;
    const absolutePath = resolve(rootPath, filePath);

    try {
      // Load file content
      let fileContent = this.fileCache.get(absolutePath);
      if (!fileContent) {
        fileContent = await readFile(absolutePath, 'utf-8');
        this.fileCache.set(absolutePath, fileContent);
      }

      // Get symbol location
      const symbolLocation = await this.findSymbolLocation(node, fileContent);
      if (!symbolLocation) {
        return null;
      }

      // Calculate slice bounds with context
      const lines = fileContent.split('\n');
      const startLine = Math.max(1, symbolLocation.startLine - this.config.contextLines);
      const endLine = Math.min(lines.length, symbolLocation.endLine + this.config.contextLines);

      // Calculate character offsets
      const startChar = this.getCharOffset(lines, startLine - 1);
      const endChar = this.getCharOffset(lines, endLine);

      // Extract JSDoc if present
      const doc = await this.extractJSDoc(node, fileContent, symbolLocation);

      // Extract body if allowed
      const body = this.config.allowCodeBodies
        ? lines.slice(startLine - 1, endLine).join('\n')
        : undefined;

      // Calculate token estimate
      const contentForTokens = doc || body || '';
      const tokens = TokenCounter.countText(contentForTokens);

      const slice: CodeSlice = {
        path: filePath,
        startLine,
        endLine,
        startChar,
        endChar,
        symbolId: this.createSymbolId(node),
        symbolName: node.symbol.fqn.symbol,
        symbolKind: this.inferSymbolKind(node),
        doc,
        body,
        reasons: node.reasons,
        context: {
          before: symbolLocation.startLine - startLine,
          after: endLine - symbolLocation.endLine
        },
        tokens: {
          conservative: tokens.tokensConservative,
          optimistic: tokens.tokensOptimistic,
          average: tokens.tokensAverage
        }
      };

      return slice;

    } catch (error) {
      console.warn(`Failed to create slice for ${filePath}:`, error);
      return null;
    }
  }

  private async findSymbolLocation(
    node: RankedNode,
    fileContent: string
  ): Promise<{ startLine: number; endLine: number } | null> {
    // If we have explicit line numbers from FQN, use those
    if (node.symbol.fqn.line && node.symbol.fqn.column) {
      // Expand to find the full symbol definition
      return this.expandAroundLine(fileContent, node.symbol.fqn.line);
    }

    // Otherwise, search for the symbol by name
    return this.findSymbolByName(fileContent, node.symbol.fqn.symbol);
  }

  private expandAroundLine(fileContent: string, centerLine: number): { startLine: number; endLine: number } {
    const lines = fileContent.split('\n');
    const centerIndex = centerLine - 1; // Convert to 0-based

    if (centerIndex < 0 || centerIndex >= lines.length) {
      return { startLine: centerLine, endLine: centerLine };
    }

    // Simple heuristic: expand until we find balanced braces or reach function/class boundaries
    let startLine = centerIndex;
    let endLine = centerIndex;

    const centerLineText = lines[centerIndex].trim();

    // If it's a simple declaration (const, let, type), keep it small
    if (centerLineText.match(/^(const|let|var|type|interface)\s+/)) {
      // Find the end of the statement (semicolon or closing brace)
      for (let i = centerIndex; i < lines.length; i++) {
        endLine = i;
        if (lines[i].includes(';') || lines[i].includes('}')) {
          break;
        }
        // Safety limit
        if (i - centerIndex > 10) break;
      }
      return { startLine: startLine + 1, endLine: endLine + 1 };
    }

    // For functions/classes, find the full body
    let braceCount = 0;
    let foundOpenBrace = false;

    // Find start (look for function/class keyword)
    for (let i = centerIndex; i >= Math.max(0, centerIndex - 5); i--) {
      const line = lines[i].trim();
      if (line.match(/^(export\s+)?(function|class|interface|enum)\s+/) ||
          line.match(/^(const|let)\s+\w+\s*=\s*(\(|async\s*\()/)) {
        startLine = i;
        break;
      }
    }

    // Find end (balanced braces)
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (foundOpenBrace && braceCount === 0) {
        endLine = i;
        break;
      }

      // Safety limit
      if (i - startLine > 100) {
        endLine = Math.min(i, startLine + 50);
        break;
      }
    }

    return { startLine: startLine + 1, endLine: endLine + 1 };
  }

  private findSymbolByName(
    fileContent: string,
    symbolName: string
  ): { startLine: number; endLine: number } | null {
    const lines = fileContent.split('\n');

    // Look for export declarations
    const patterns = [
      new RegExp(`^export\\s+(function|class|interface|type|enum)\\s+${symbolName}\\b`),
      new RegExp(`^(function|class|interface|type|enum)\\s+${symbolName}\\b`),
      new RegExp(`^export\\s+(const|let)\\s+${symbolName}\\b`),
      new RegExp(`^(const|let)\\s+${symbolName}\\b`),
      new RegExp(`^\\s*${symbolName}\\s*[:=]`) // Object property or assignment
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          return this.expandAroundLine(fileContent, i + 1);
        }
      }
    }

    return null;
  }

  private async extractJSDoc(
    node: RankedNode,
    fileContent: string,
    location: { startLine: number; endLine: number }
  ): Promise<string | undefined> {
    const lines = fileContent.split('\n');

    // Look for JSDoc comment immediately before the symbol
    const symbolStartLine = location.startLine - 1; // Convert to 0-based
    let docEndLine = -1;

    // Search backwards for JSDoc comment
    for (let i = symbolStartLine - 1; i >= 0; i--) {
      const line = lines[i].trim();

      if (line === '*/') {
        docEndLine = i;
      } else if (line.startsWith('/**')) {
        // Found start of JSDoc
        const docLines = lines.slice(i, docEndLine + 1);
        return docLines
          .map(line => line.replace(/^\s*\*\s?/, '').replace(/^\s*\/\*\*\s?/, '').replace(/^\s*\*\/\s?/, ''))
          .join('\n')
          .trim();
      } else if (line === '' || line.startsWith('//')) {
        // Skip empty lines and single-line comments
        continue;
      } else {
        // Found non-comment content, stop looking
        break;
      }
    }

    return undefined;
  }

  private async mergeOverlappingSlices(
    slices: CodeSlice[],
    filePath: string,
    rootPath: string
  ): Promise<CodeSlice[]> {
    if (slices.length <= 1) return slices;

    // Sort by start line
    slices.sort((a, b) => a.startLine - b.startLine);

    const merged: CodeSlice[] = [];
    let current = { ...slices[0] };

    for (let i = 1; i < slices.length; i++) {
      const next = slices[i];

      // Check for overlap or adjacency (with small gap allowance)
      const gap = next.startLine - current.endLine;
      if (gap <= 2) {
        // Merge the slices
        current = {
          ...current,
          endLine: Math.max(current.endLine, next.endLine),
          endChar: Math.max(current.endChar, next.endChar),
          reasons: [...new Set([...current.reasons, ...next.reasons])],
          // Combine other properties as needed
          symbolName: current.symbolName + (current.symbolName !== next.symbolName ? `, ${next.symbolName}` : ''),
          doc: [current.doc, next.doc].filter(Boolean).join('\n\n'),
          // Update body if we're allowing code bodies
          body: this.config.allowCodeBodies ? await this.reextractMergedBody(current, rootPath) : undefined
        };
      } else {
        // No overlap, add current to results and start new current
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
    return merged;
  }

  private async reextractMergedBody(slice: CodeSlice, rootPath: string): Promise<string | undefined> {
    if (!this.config.allowCodeBodies) return undefined;

    const absolutePath = resolve(rootPath, slice.path);
    let fileContent = this.fileCache.get(absolutePath);
    if (!fileContent) {
      fileContent = await readFile(absolutePath, 'utf-8');
      this.fileCache.set(absolutePath, fileContent);
    }

    const lines = fileContent.split('\n');
    return lines.slice(slice.startLine - 1, slice.endLine).join('\n');
  }

  private getCharOffset(lines: string[], lineIndex: number): number {
    let offset = 0;
    for (let i = 0; i < Math.min(lineIndex, lines.length); i++) {
      offset += lines[i].length + 1; // +1 for newline character
    }
    return offset;
  }

  private createSymbolId(node: RankedNode): string {
    const location = node.symbol.fqn.line && node.symbol.fqn.column
      ? `@${node.symbol.fqn.line}:${node.symbol.fqn.column}`
      : '';
    return `${node.symbol.fqn.path}#${node.symbol.fqn.symbol}${location}`;
  }

  private inferSymbolKind(node: RankedNode): string {
    // Infer symbol kind from the FQN type or symbol name patterns
    if (node.symbol.fqn.type === 'class-member') {
      return 'method';
    }

    const symbolName = node.symbol.fqn.symbol;

    // Common patterns
    if (symbolName[0]?.toUpperCase() === symbolName[0] && !symbolName.includes('_')) {
      return 'class'; // PascalCase likely indicates class
    }

    if (symbolName.startsWith('I') && symbolName[1]?.toUpperCase() === symbolName[1]) {
      return 'interface';
    }

    return 'function'; // Default assumption
  }
}