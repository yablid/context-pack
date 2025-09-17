import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { FileInfo, IgnoreRules } from '../types.js';
import picomatch from 'picomatch';
import ignore from 'ignore';

export class FileWalker {
  private ignoreRules: IgnoreRules;
  private gitignoreChecker: ReturnType<typeof ignore> | null = null;
  private userIgnoreMatchers: Array<(s: string) => boolean> = [];
  private hashFiles: boolean;
  private maxHashFileSizeMB: number;

  constructor(ignoreRules: IgnoreRules, options?: { hashFiles?: boolean; maxHashFileSizeMB?: number }) {
    this.ignoreRules = ignoreRules;
    this.hashFiles = options?.hashFiles ?? true;
    this.maxHashFileSizeMB = options?.maxHashFileSizeMB ?? 10;
    this.setupIgnoreMatchers();
  }

  private setupIgnoreMatchers(): void {
    // Setup proper .gitignore handling
    if (this.ignoreRules.gitignore.length > 0) {
      this.gitignoreChecker = ignore()
        .add(this.ignoreRules.defaults)  // Add default ignores
        .add(this.ignoreRules.gitignore); // Add .gitignore patterns
    } else {
      // Fallback to just defaults if no .gitignore
      this.gitignoreChecker = ignore().add(this.ignoreRules.defaults);
    }

    // User patterns still use picomatch for flexibility
    this.userIgnoreMatchers = this.ignoreRules.user.map(p => {
      return picomatch(p, { dot: true, nocase: true });
    });
  }

  private shouldIgnore(relativePath: string): string | null {
    const posixPath = relativePath.split(sep).join('/');
    
    // Check .gitignore patterns first (most important)
    if (this.gitignoreChecker?.ignores(posixPath)) {
      return 'matches .gitignore pattern';
    }

    // Check user patterns
    for (const match of this.userIgnoreMatchers) {
      if (match(posixPath)) {
        return 'matches user ignore pattern';
      }
    }
    
    return null;
  }

  private classifyFileKind(filePath: string): 'code' | 'config' | 'test' | 'asset' | 'docs' {
    const path = filePath.toLowerCase();
    const ext = path.split('.').pop() || '';
    
    // Test files
    if (path.includes('test') || path.includes('spec') || path.includes('__tests__')) {
      return 'test';
    }
    
    // Config files
    if ([
      'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'config',
      'eslintrc', 'prettierrc', 'gitignore', 'dockerignore'
    ].includes(ext) || path.includes('config')) {
      return 'config';
    }
    
    // Documentation
    if (['md', 'txt', 'rst', 'adoc'].includes(ext) || path.includes('readme') || path.includes('doc')) {
      return 'docs';
    }
    
    // Code files
    if ([
      'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
      'cs', 'rb', 'php', 'kt', 'swift', 'dart', 'scala', 'clj'
    ].includes(ext)) {
      return 'code';
    }
    
    return 'asset';
  }

  private classifyBucket(filePath: string): 'public' | 'internal' | 'unknown' {
    const path = filePath.toLowerCase();
    
    if (path.includes('internal') || path.includes('private')) {
      return 'internal';
    }
    
    if (path.includes('public') || path.includes('api') || path.includes('contracts')) {
      return 'public';
    }
    
    return 'unknown';
  }

  private isBinaryFile(filePath: string, buffer?: Buffer): boolean {
    const ext = filePath.toLowerCase().split('.').pop() || '';
    
    // Known binary extensions
    const binaryExts = new Set([
      'exe', 'bin', 'dll', 'so', 'dylib', 'a', 'lib', 'o', 'obj',
      'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico',
      'mp3', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'wav', 'ogg',
      'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'woff', 'woff2', 'ttf', 'otf', 'eot'
    ]);
    
    if (binaryExts.has(ext)) {
      return true;
    }
    
    // If we have buffer content, check for null bytes
    if (buffer && buffer.length > 0) {
      const sample = buffer.subarray(0, Math.min(8000, buffer.length));
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) {
          return true;
        }
      }
    }
    
    return false;
  }

  private countLines(content: string): number {
    if (!content) return 0;
    return content.split('\n').length;
  }

  async walk(rootPath: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    
    const walkDir = async (currentPath: string): Promise<void> => {
      try {
        const entries = await readdir(currentPath);
        
        for (const entry of entries) {
          const fullPath = join(currentPath, entry);
          const relativePath = relative(rootPath, fullPath);
          
          // Check if should be ignored
          const ignoreReason = this.shouldIgnore(relativePath);
          if (ignoreReason) {
            continue; // Skip ignored files/directories
          }
          
          const stats = await stat(fullPath);
          
          if (stats.isDirectory()) {
            await walkDir(fullPath);
          } else if (stats.isFile()) {
            try {
              // Quick binary check by extension first
              if (this.isBinaryFile(fullPath)) {
                continue; // Skip binary files
              }

              // Read first chunk to detect binary content and get sample
              const peekSize = Math.min(8192, stats.size); // 8KB peek
              const peekBuffer = Buffer.allocUnsafe(peekSize);

              const fd = await (await import('node:fs/promises')).open(fullPath, 'r');
              await fd.read(peekBuffer, 0, peekSize, 0);

              // Double-check binary with content sample
              if (this.isBinaryFile(fullPath, peekBuffer)) {
                await fd.close();
                continue; // Skip binary files
              }

              // For text files, read full content if needed for LOC
              let fullBuffer: Buffer;
              let content: string;

              if (peekSize >= stats.size) {
                // Small file - we already have it all
                fullBuffer = peekBuffer.subarray(0, stats.size);
                content = fullBuffer.toString('utf-8');
              } else {
                // Larger file - read the rest
                fullBuffer = await readFile(fullPath);
                content = fullBuffer.toString('utf-8');
              }

              await fd.close();

              // Calculate hash only if enabled and file size is reasonable
              let sha256: string;
              if (this.hashFiles && stats.size <= this.maxHashFileSizeMB * 1024 * 1024) {
                sha256 = await this.calculateSha256(fullBuffer);
              } else {
                sha256 = 'skipped-large-file';
              }

              const fileInfo: FileInfo = {
                path: relativePath.split(sep).join('/'), // Normalize to POSIX
                bytes: stats.size,
                sha256,
                loc: this.countLines(content),
                kind: this.classifyFileKind(relativePath),
                bucket: this.classifyBucket(relativePath)
              };

              files.push(fileInfo);
            } catch (error) {
              // Skip files that can't be read
              if (process.env.NODE_ENV === 'development') {
                console.warn(`Warning: Could not read file ${fullPath}:`, error);
              }
            }
          }
        }
      } catch (error) {
        // Skip directories that can't be read
        if (process.env.NODE_ENV === 'development') {
          console.warn(`Warning: Could not read directory ${currentPath}:`, error);
        }
      }
    };
    
    await walkDir(rootPath);
    
    // Sort for deterministic output
    files.sort((a, b) => a.path.localeCompare(b.path));
    
    return files;
  }

  private async calculateSha256(buffer: Buffer): Promise<string> {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(buffer).digest('hex');
  }

  static createDefaultIgnoreRules(gitignoreContent?: string): IgnoreRules {
    const defaults = [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.turbo/**',
      '.svelte-kit/**',
      'coverage/**',
      '.nyc_output/**',
      '.next/**',
      '.nuxt/**',
      'target/**',
      '__pycache__/**',
      '*.pyc',
      '.git/**',
      '.hg/**',
      '.svn/**',
      '.DS_Store',
      'Thumbs.db',
      '*.log',
      '.env',
      '.env.local',
      '.env.*.local',
      '*.tmp',
      '*.swp',
      '*.swo'
    ];

    const gitignore = gitignoreContent ? 
      gitignoreContent.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
      : [];

    return {
      defaults,
      gitignore,
      user: []
    };
  }
}