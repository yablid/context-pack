import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { DetectorResult } from '../../../core/types.js';

export class MonorepoDetector {
  async detect(rootPath: string): Promise<DetectorResult[]> {
    const results: DetectorResult[] = [];

    // Check for pnpm workspace (highest priority)
    try {
      await access(join(rootPath, 'pnpm-workspace.yaml'));
      const content = await readFile(join(rootPath, 'pnpm-workspace.yaml'), 'utf-8');
      const packages = this.parsePnpmWorkspace(content);
      
      results.push({
        name: 'pnpm-workspace',
        confidence: 0.95,
        metadata: { packages, lockfile: 'pnpm-lock.yaml' }
      });
    } catch {
      // pnpm-workspace.yaml not found
    }

    // Check for npm/yarn workspaces in package.json
    try {
      const packagePath = join(rootPath, 'package.json');
      await access(packagePath);
      const packageContent = await readFile(packagePath, 'utf-8');
      const packageJson = JSON.parse(packageContent);
      
      if (packageJson.workspaces) {
        const packages = Array.isArray(packageJson.workspaces) 
          ? packageJson.workspaces 
          : packageJson.workspaces.packages || [];
        
        // Determine which lock file exists
        let lockfile = 'package-lock.json';
        let confidence = 0.8;
        
        try {
          await access(join(rootPath, 'yarn.lock'));
          lockfile = 'yarn.lock';
          confidence = 0.85;
        } catch {
          // yarn.lock not found, stick with npm
        }
        
        results.push({
          name: 'npm-workspaces',
          confidence,
          metadata: { packages, lockfile }
        });
      }
    } catch {
      // package.json not found or invalid
    }

    // Check for Rush monorepo
    try {
      await access(join(rootPath, 'rush.json'));
      const content = await readFile(join(rootPath, 'rush.json'), 'utf-8');
      const rushConfig = JSON.parse(content);
      const packages = rushConfig.projects?.map((p: any) => p.packageName) || [];
      
      results.push({
        name: 'rush',
        confidence: 0.9,
        metadata: { packages, tool: 'rush' }
      });
    } catch {
      // rush.json not found
    }

    // Check for Turbo config (can coexist with other monorepo tools)
    try {
      await access(join(rootPath, 'turbo.json'));
      results.push({
        name: 'turbo',
        confidence: 0.7,
        metadata: { tool: 'turbo' }
      });
    } catch {
      // turbo.json not found
    }

    // Check for Lerna
    try {
      await access(join(rootPath, 'lerna.json'));
      const content = await readFile(join(rootPath, 'lerna.json'), 'utf-8');
      const lernaConfig = JSON.parse(content);
      const packages = lernaConfig.packages || [];
      
      results.push({
        name: 'lerna',
        confidence: 0.75,
        metadata: { packages, tool: 'lerna' }
      });
    } catch {
      // lerna.json not found
    }

    return results;
  }

  private parsePnpmWorkspace(content: string): string[] {
    // Simple YAML parsing for packages array
    const lines = content.split('\n');
    const packages: string[] = [];
    let inPackagesSection = false;

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed === 'packages:') {
        inPackagesSection = true;
        continue;
      }
      
      if (inPackagesSection) {
        if (trimmed.startsWith('- ')) {
          const packagePath = trimmed.substring(2).replace(/['"]/g, '');
          packages.push(packagePath);
        } else if (!trimmed.startsWith(' ') && trimmed !== '') {
          // End of packages section
          break;
        }
      }
    }

    return packages;
  }
}