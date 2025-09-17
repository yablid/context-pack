import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CollectorContext } from '../../../core/contracts/collector.js';
import type { Artifact } from '../../../core/types.js';
import { BaseCollector } from './base-collector.js';

interface PackageInfo {
  name: string;
  dir: string;
  private?: boolean;
  type?: string;
  bin?: string[] | Record<string, string> | undefined;
  exportsKeys?: string[] | undefined;
  main?: string;
  module?: string;
  dependencies: {
    internal: string[];
    external: string[];
  };
}

interface WorkspaceInfo {
  root: string;
  packages: string[];
}

interface TopologyData {
  workspaces: WorkspaceInfo[];
  packages: PackageInfo[];
  lockfile?: {
    type: 'pnpm' | 'yarn' | 'npm';
    present: boolean;
  } | undefined;
}

export class TopologyCollector extends BaseCollector {
  readonly name = 'topology';
  readonly schemaIds = ['10-repo-topology'];

  async detect(rootPath: string): Promise<boolean> {
    // Check if there's any package structure
    try {
      await access(join(rootPath, 'package.json'));
      return true;
    } catch {
      return false;
    }
  }

  async collect(context: CollectorContext): Promise<Artifact[]> {
    this.log('Analyzing repository topology', context);

    const workspacePatterns = await this.detectWorkspacePatterns(context.rootPath);
    const packages = await this.analyzePackages(context.rootPath, workspacePatterns);
    const workspaces = await this.buildWorkspaceInfo(context.rootPath, workspacePatterns, packages);
    const lockfile = await this.detectLockfile(context.rootPath);

    const topologyData: TopologyData = {
      workspaces,
      packages,
      lockfile
    };

    const artifact = this.createArtifact(
      'topology',
      '10-repo-topology.json',
      '10-repo-topology',
      topologyData
    );

    this.log(`Found ${packages.length} packages in ${workspaces.length} workspaces`, context);

    return [artifact];
  }

  private async detectWorkspacePatterns(rootPath: string): Promise<string[]> {
    // Check pnpm-workspace.yaml
    try {
      const pnpmWorkspace = await readFile(join(rootPath, 'pnpm-workspace.yaml'), 'utf-8');
      const workspaces = this.parsePnpmWorkspace(pnpmWorkspace);
      if (workspaces.length > 0) {
        return workspaces;
      }
    } catch {
      // pnpm-workspace.yaml not found
    }

    // Check package.json workspaces
    try {
      const packageContent = await readFile(join(rootPath, 'package.json'), 'utf-8');
      const packageJson = JSON.parse(packageContent);
      
      if (packageJson.workspaces) {
        return Array.isArray(packageJson.workspaces) 
          ? packageJson.workspaces 
          : packageJson.workspaces.packages || [];
      }
    } catch {
      // package.json not found or invalid
    }

    // Single package repository
    return ['.'];
  }

  private parsePnpmWorkspace(content: string): string[] {
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
          break;
        }
      }
    }

    return packages;
  }

  private async analyzePackages(rootPath: string, workspaces: string[]): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = [];

    for (const workspace of workspaces) {
      const packageDirs = await this.expandWorkspaceGlob(rootPath, workspace);
      
      for (const packageDir of packageDirs) {
        try {
          const packageJsonPath = join(rootPath, packageDir, 'package.json');
          await access(packageJsonPath);
          
          const content = await readFile(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(content);
          
          if (packageJson.name) {
            const packageInfo = await this.analyzePackage(packageDir, packageJson, packages);
            packages.push(packageInfo);
          }
        } catch {
          // Skip directories without valid package.json
        }
      }
    }

    return packages;
  }

  private async buildWorkspaceInfo(rootPath: string, workspacePatterns: string[], packages: PackageInfo[]): Promise<WorkspaceInfo[]> {
    const workspaces: WorkspaceInfo[] = [];
    
    // Group packages by their workspace pattern  
    const workspaceMap = new Map<string, string[]>();
    
    for (const pattern of workspacePatterns) {
      const packageDirs = await this.expandWorkspaceGlob(rootPath, pattern);
      const packageNames: string[] = [];
      
      for (const packageDir of packageDirs) {
        const packageInfo = packages.find(p => p.dir === packageDir);
        if (packageInfo) {
          packageNames.push(packageInfo.name);
        }
      }
      
      workspaceMap.set(pattern, packageNames);
    }
    
    // Convert to WorkspaceInfo objects
    for (const [root, packageNames] of workspaceMap.entries()) {
      workspaces.push({
        root,
        packages: packageNames.sort() // Deterministic ordering
      });
    }
    
    return workspaces.sort((a, b) => a.root.localeCompare(b.root)); // Deterministic ordering
  }

  private async expandWorkspaceGlob(rootPath: string, glob: string): Promise<string[]> {
    // Simple glob expansion - would use proper glob library in production
    if (glob === '.') {
      return ['.'];
    }
    
    if (glob.endsWith('/*')) {
      // Very basic glob support
      const baseDir = glob.slice(0, -2);
      try {
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(join(rootPath, baseDir));
        const dirs: string[] = [];
        
        for (const entry of entries) {
          try {
            const { stat } = await import('node:fs/promises');
            const stats = await stat(join(rootPath, baseDir, entry));
            if (stats.isDirectory()) {
              dirs.push(join(baseDir, entry));
            }
          } catch {
            // Skip entries that can't be stat'd
          }
        }
        
        return dirs;
      } catch {
        return [];
      }
    }
    
    // Return as-is for non-glob patterns
    return [glob];
  }

  private async analyzePackage(
    dir: string, 
    packageJson: any, 
    allPackages: PackageInfo[]
  ): Promise<PackageInfo> {
    const allPackageNames = allPackages.map(p => p.name);
    
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};
    const peerDependencies = packageJson.peerDependencies || {};
    
    const allDeps = { ...dependencies, ...devDependencies, ...peerDependencies };
    
    const internal: string[] = [];
    const external: string[] = [];
    
    for (const depName of Object.keys(allDeps)) {
      if (allPackageNames.includes(depName)) {
        internal.push(depName);
      } else {
        external.push(depName);
      }
    }

    // Parse exports keys
    const exportsKeys: string[] = [];
    if (packageJson.exports && typeof packageJson.exports === 'object') {
      exportsKeys.push(...Object.keys(packageJson.exports));
    }

    // Parse bin
    let bin: string[] | Record<string, string> | undefined = undefined;
    if (packageJson.bin) {
      if (typeof packageJson.bin === 'string') {
        bin = [packageJson.bin];
      } else if (typeof packageJson.bin === 'object') {
        bin = packageJson.bin;
      }
    }

    return {
      name: packageJson.name,
      dir: dir.split('\\').join('/'), // Normalize to POSIX
      private: packageJson.private || false,
      type: packageJson.type,
      ...(bin && { bin }),
      ...(exportsKeys.length > 0 && { exportsKeys }),
      main: packageJson.main,
      module: packageJson.module,
      dependencies: {
        internal: internal.sort(),
        external: external.sort()
      }
    };
  }

  private async detectLockfile(rootPath: string): Promise<{ type: 'pnpm' | 'yarn' | 'npm'; present: boolean } | undefined> {
    const lockfiles = [
      { file: 'pnpm-lock.yaml', type: 'pnpm' as const },
      { file: 'yarn.lock', type: 'yarn' as const },
      { file: 'package-lock.json', type: 'npm' as const }
    ];

    for (const { file, type } of lockfiles) {
      try {
        await access(join(rootPath, file));
        return { type, present: true };
      } catch {
        // Lockfile not found
      }
    }

    return undefined;
  }
}