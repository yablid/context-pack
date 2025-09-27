// Paste pack service - single-file directory dump with redaction and budgets
// Reuses existing core services for consistency

import { readFileSync } from 'node:fs';
import { resolve, relative, extname, join } from 'node:path';
import { FileWalker } from '../../core/walker/file-walker.js';
import { SecretRedactor } from '../../core/security/secret-redaction.js';
import { TokenCounter } from '../../core/tokens/token-counter.js';
import type {
  PastePackConfig,
  PastePackResult,
  PastePackFile,
  PastePackArtifact,
} from '../../core/contracts/paste-pack.js';
import type { FileInfo } from '../../core/types.js';

export class PastePackService {
  private readonly tokenCounter = new TokenCounter();

  async generatePack(config: PastePackConfig): Promise<{ result: PastePackResult; artifact: PastePackArtifact }> {
    // Walk directory to get file list
    const fileInfos = await this.walkDirectory(config);

    // Filter files based on include/exclude patterns
    const filteredFiles = this.filterFiles(fileInfos, config);

    // Read and process files within budget limits
    const processedFiles = await this.processFiles(filteredFiles, config);

    // Generate final paste content
    const content = this.generatePasteContent(processedFiles, config);

    // Create result
    const result = this.createResult(config, fileInfos, processedFiles, content);

    // Create artifact
    const artifact = this.createArtifact(content);

    return { result, artifact };
  }

  private async walkDirectory(config: PastePackConfig): Promise<FileInfo[]> {
    // Create default ignore rules
    const ignoreRules = {
      gitignore: [],
      defaults: [
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.contextpack/**',
        '**/*.log'
      ],
      user: []
    };

    const walker = new FileWalker(ignoreRules, { hashFiles: false });
    return await walker.walk(config.rootPath);
  }

  private filterFiles(fileInfos: FileInfo[], config: PastePackConfig): PastePackFile[] {
    return fileInfos.map(info => {
      let included = true;
      let excludeReason: string | undefined;

      // Check file extension includes
      if (config.include?.extensions) {
        const ext = extname(info.path);
        if (!config.include.extensions.includes(ext)) {
          included = false;
          excludeReason = `extension ${ext} not in include list`;
        }
      }

      // Check include patterns
      if (included && config.include?.patterns) {
        const matches = config.include.patterns.some(pattern =>
          this.matchesPattern(info.path, pattern)
        );
        if (!matches) {
          included = false;
          excludeReason = 'path does not match include patterns';
        }
      }

      // Check exclude patterns
      if (included && config.exclude?.patterns) {
        const matches = config.exclude.patterns.some(pattern =>
          this.matchesPattern(info.path, pattern)
        );
        if (matches) {
          included = false;
          excludeReason = 'path matches exclude patterns';
        }
      }

      // Check exclude directories
      if (included && config.exclude?.directories) {
        const matches = config.exclude.directories.some(dir =>
          info.path.startsWith(dir + '/')
        );
        if (matches) {
          included = false;
          excludeReason = 'path in excluded directory';
        }
      }

      // Default content for now (will be read later if needed)
      return {
        path: info.path,
        content: '',
        metadata: {
          size: info.bytes,
          loc: info.loc,
          extension: extname(info.path),
          included,
          excludeReason,
        },
      };
    });
  }

  private matchesPattern(path: string, pattern: string): boolean {
    // Simple glob pattern matching - could be enhanced with picomatch
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(path);
    }
    return path.includes(pattern);
  }

  private async processFiles(files: PastePackFile[], config: PastePackConfig): Promise<PastePackFile[]> {
    const maxLoc = config.budgets.maxLoc || 50000;
    const maxBytes = config.budgets.maxBytes || 2000000;

    let totalLoc = 0;
    let totalBytes = 0;
    const processedFiles: PastePackFile[] = [];

    for (const file of files) {
      if (!file.metadata.included) {
        processedFiles.push(file);
        continue;
      }

      // Check if adding this file would exceed budget
      if (totalLoc + file.metadata.loc > maxLoc || totalBytes + file.metadata.size > maxBytes) {
        processedFiles.push({
          ...file,
          metadata: {
            ...file.metadata,
            included: false,
            excludeReason: 'budget exceeded',
          },
        });
        continue;
      }

      try {
        // Read file content
        const fullPath = resolve(config.rootPath, file.path);
        let content = readFileSync(fullPath, 'utf-8');

        // Apply redaction if needed
        if (config.allowCodeBodies) {
          const redactionResult = SecretRedactor.scanContent(content);
          content = redactionResult.redactedContent || content;
        } else {
          // If code bodies not allowed, only include headers/signatures
          content = this.extractSignatures(content, file.metadata.extension);
        }

        totalLoc += file.metadata.loc;
        totalBytes += file.metadata.size;

        processedFiles.push({
          ...file,
          content,
        });
      } catch (error) {
        processedFiles.push({
          ...file,
          metadata: {
            ...file.metadata,
            included: false,
            excludeReason: `read error: ${error}`,
          },
        });
      }
    }

    return processedFiles;
  }

  private extractSignatures(content: string, extension: string): string {
    // Extract signatures, interfaces, types, but not function bodies
    if (extension === '.ts' || extension === '.tsx' || extension === '.js' || extension === '.jsx') {
      const lines = content.split('\n');
      const result: string[] = [];
      let inFunctionBody = false;
      let braceDepth = 0;
      let inInterface = false;
      let inType = false;
      let inClass = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track interface/type/class blocks
        if (trimmed.startsWith('interface ') || trimmed.startsWith('export interface ')) {
          inInterface = true;
          inFunctionBody = false;
          braceDepth = 0;
        } else if (trimmed.startsWith('type ') || trimmed.startsWith('export type ')) {
          inType = true;
          inFunctionBody = false;
          braceDepth = 0;
        } else if (trimmed.startsWith('class ') || trimmed.startsWith('export class ')) {
          inClass = true;
          inFunctionBody = false;
          braceDepth = 0;
        }

        // Always include imports, comments, and type definitions
        if (trimmed.startsWith('import') ||
            trimmed.startsWith('export') && !trimmed.includes('function') && !trimmed.includes('const') ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*') ||
            inInterface ||
            inType) {
          result.push(line);
        }
        // For functions and methods, only include signatures
        else if (trimmed.startsWith('function ') ||
                 trimmed.startsWith('export function ') ||
                 trimmed.startsWith('async function ') ||
                 trimmed.startsWith('export async function ')) {
          // Include the signature line
          const openBrace = line.indexOf('{');
          if (openBrace !== -1) {
            // Replace body with semicolon
            result.push(line.substring(0, openBrace).trimEnd() + ';');
            inFunctionBody = true;
          } else {
            result.push(line);
          }
        }
        // For const/let with type annotations, include them
        else if ((trimmed.startsWith('const ') || trimmed.startsWith('let ') ||
                  trimmed.startsWith('export const ') || trimmed.startsWith('export let ')) &&
                 trimmed.includes(':')) {
          const openBrace = line.indexOf('{');
          if (openBrace !== -1 && !trimmed.includes('=>')) {
            // Object literal - skip
            continue;
          }
          // Arrow function - just show signature
          if (trimmed.includes('=>')) {
            const arrowIndex = line.indexOf('=>');
            result.push(line.substring(0, arrowIndex + 2).trimEnd() + ' { /* ... */ }');
          } else {
            result.push(line);
          }
        }
        // In class - include method signatures
        else if (inClass && !inFunctionBody) {
          if (trimmed.includes('(') && trimmed.includes(')')) {
            const openBrace = line.indexOf('{');
            if (openBrace !== -1) {
              result.push(line.substring(0, openBrace).trimEnd() + ' { /* ... */ }');
              inFunctionBody = true;
            } else {
              result.push(line);
            }
          } else if (trimmed) {
            // Property definitions
            result.push(line);
          }
        }

        // Track brace depth to know when we exit blocks
        for (const char of trimmed) {
          if (char === '{') braceDepth++;
          if (char === '}') {
            braceDepth--;
            if (braceDepth === 0) {
              inInterface = false;
              inType = false;
              inClass = false;
              inFunctionBody = false;
            } else if (braceDepth === 1 && inClass) {
              // Exited a method body but still in class
              inFunctionBody = false;
            }
          }
        }
      }

      return result.join('\n');
    }

    // For non-code files, show more content
    const lines = content.split('\n');
    if (lines.length <= 50) {
      return content; // Small files - show everything
    }
    // For larger files, show first 30 lines
    return lines.slice(0, 30).join('\n') + '\n\n... (content truncated after 30 lines)';
  }

  private generatePasteContent(files: PastePackFile[], config: PastePackConfig): string {
    const lines: string[] = [];

    lines.push('==== SECTION: HEADER ====');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Root: ${config.rootPath}`);
    lines.push(`Allow Code Bodies: ${config.allowCodeBodies}`);
    lines.push('');

    // Generate index
    lines.push('==== INDEX ====');
    const includedFiles = files.filter(f => f.metadata.included);
    const excludedFiles = files.filter(f => !f.metadata.included);

    lines.push('Included Files:');
    includedFiles.forEach(file => {
      lines.push(`  ${file.path} (${file.metadata.loc} LOC, ${file.metadata.size} bytes)`);
    });

    if (excludedFiles.length > 0) {
      lines.push('');
      lines.push('Excluded Files:');
      excludedFiles.slice(0, 20).forEach(file => {
        lines.push(`  ${file.path} - ${file.metadata.excludeReason}`);
      });
      if (excludedFiles.length > 20) {
        lines.push(`  ... and ${excludedFiles.length - 20} more`);
      }
    }
    lines.push('');

    // Generate file contents
    for (const file of includedFiles) {
      lines.push(`==== FILE: ${file.path} (LOC ${file.metadata.loc}) ====`);
      lines.push(file.content);
      lines.push('');
    }

    lines.push('==== SUMMARY ====');
    const totalLoc = includedFiles.reduce((sum, f) => sum + f.metadata.loc, 0);
    const totalBytes = includedFiles.reduce((sum, f) => sum + f.metadata.size, 0);
    lines.push(`Total: ${includedFiles.length} files, ${totalLoc} LOC, ${totalBytes} bytes`);
    lines.push(`Excluded: ${excludedFiles.length} files`);
    lines.push('');

    lines.push('==== END ====');

    return lines.join('\n');
  }

  private createResult(
    config: PastePackConfig,
    allFiles: FileInfo[],
    processedFiles: PastePackFile[],
    content: string
  ): PastePackResult {
    const includedFiles = processedFiles.filter(f => f.metadata.included);
    const excludedFiles = processedFiles.filter(f => !f.metadata.included);
    const totalLoc = includedFiles.reduce((sum, f) => sum + f.metadata.loc, 0);
    const totalBytes = includedFiles.reduce((sum, f) => sum + f.metadata.size, 0);

    const maxLoc = config.budgets.maxLoc || 50000;
    const maxBytes = config.budgets.maxBytes || 2000000;
    const truncated = totalLoc >= maxLoc || totalBytes >= maxBytes;

    return {
      metadata: {
        generatedAt: new Date().toISOString(),
        rootPath: config.rootPath,
        config,
      },
      summary: {
        totalFilesScanned: allFiles.length,
        filesIncluded: includedFiles.length,
        filesExcluded: excludedFiles.length,
        totalLoc,
        totalBytes,
        truncated,
        truncationReason: truncated ? 'budget limits exceeded' : undefined,
      },
      files: processedFiles,
      content,
    };
  }

  private createArtifact(content: string): PastePackArtifact {
    return {
      id: 'paste-pack',
      filename: 'paste-pack.txt',
      kind: 'text',
      schemaId: 'paste-pack',
      sizeHint: content.length,
      text: content,
    };
  }
}