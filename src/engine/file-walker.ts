import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { FileInfo, IgnoreRules } from '../types.js';
import picomatch from 'picomatch';

export class FileWalker {
  private ignoreRules: IgnoreRules;
  private ignoreMatchers: Array<(s: string) => boolean> = [];

  constructor(ignoreRules: IgnoreRules) {
    this.ignoreRules = ignoreRules;
    this.compileIgnorePatterns();
  }

  private compileIgnorePatterns(): void {
    const allPatterns = [
      ...this.ignoreRules.defaults,
      ...this.ignoreRules.gitignore,
      ...this.ignoreRules.user
    ];

    this.ignoreMatchers = allPatterns.map(p => {
      const matcher = picomatch(p, { dot: true, nocase: true });
      return (s: string) => matcher(s) || matcher(`/${s}`) || matcher(s.startsWith('./') ? s : `./${s}`);
    });
  }

  private shouldIgnore(relativePath: string): string | null {
    const posixPath = relativePath.split(sep).join('/');
    
    for (const match of this.ignoreMatchers) {
      if (match(posixPath)) {
        return `matches ignore pattern`;
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
      'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg',
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
              // Read first part of file to check if binary
              const buffer = await readFile(fullPath);
              
              if (this.isBinaryFile(fullPath, buffer)) {
                continue; // Skip binary files
              }
              
              const content = buffer.toString('utf-8');
              const fileInfo: FileInfo = {
                path: relativePath.split(sep).join('/'), // Normalize to POSIX
                bytes: stats.size,
                sha256: await this.calculateSha256(buffer),
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