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
    // Extract only type signatures, interfaces, function declarations
    if (extension === '.ts' || extension === '.js') {
      const lines = content.split('\n');
      const signatures: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith('export') ||
          trimmed.startsWith('interface') ||
          trimmed.startsWith('type ') ||
          trimmed.startsWith('class ') ||
          trimmed.startsWith('function ') ||
          trimmed.startsWith('const ') && trimmed.includes(':') ||
          trimmed.startsWith('import') ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('*')
        ) {
          signatures.push(line);
        }
      }

      return signatures.join('\n');
    }

    // For other files, return first few lines as sample
    return content.split('\n').slice(0, 10).join('\n') + '\n... (content truncated)';
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