import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { DetectorResult } from '../../../core/types.js';

export class LanguageDetector {
  async detect(rootPath: string): Promise<DetectorResult[]> {
    const results: DetectorResult[] = [];

    // TypeScript detection
    const tsResult = await this.detectTypeScript(rootPath);
    if (tsResult) {
      results.push(tsResult);
    }

    // Python detection
    const pyResult = await this.detectPython(rootPath);
    if (pyResult) {
      results.push(pyResult);
    }

    // Rust detection
    const rustResult = await this.detectRust(rootPath);
    if (rustResult) {
      results.push(rustResult);
    }

    // Go detection
    const goResult = await this.detectGo(rootPath);
    if (goResult) {
      results.push(goResult);
    }

    return results;
  }

  private async detectTypeScript(rootPath: string): Promise<DetectorResult | null> {
    let confidence = 0;
    const metadata: Record<string, unknown> = {};

    // Check for tsconfig.json
    try {
      await access(join(rootPath, 'tsconfig.json'));
      confidence += 0.4;
      metadata.hasRootTsConfig = true;

      const content = await readFile(join(rootPath, 'tsconfig.json'), 'utf-8');
      const tsConfig = JSON.parse(content);
      
      // Check for strict mode
      if (tsConfig.compilerOptions?.strict) {
        confidence += 0.1;
        metadata.strict = true;
      }
      
      // Check for ESM configuration
      if (tsConfig.compilerOptions?.module === 'ESNext' || 
          tsConfig.compilerOptions?.moduleResolution === 'Bundler') {
        confidence += 0.1;
        metadata.esm = true;
      }
    } catch {
      // No root tsconfig, check for any tsconfig files
      // This would be enhanced with a glob search in a real implementation
    }

    // Check package.json for TypeScript indicators
    try {
      const packageContent = await readFile(join(rootPath, 'package.json'), 'utf-8');
      const packageJson = JSON.parse(packageContent);
      
      if (packageJson.type === 'module') {
        confidence += 0.15;
        metadata.packageType = 'module';
      }
      
      if (packageJson.devDependencies?.typescript || packageJson.dependencies?.typescript) {
        confidence += 0.2;
        metadata.hasTypeScript = true;
      }
      
      if (packageJson.devDependencies?.['@types/node']) {
        confidence += 0.1;
        metadata.hasNodeTypes = true;
      }
    } catch {
      // package.json not found or invalid
    }

    // Must have some confidence to be valid
    if (confidence > 0.2) {
      return {
        name: 'typescript',
        confidence: Math.min(confidence, 0.95),
        metadata
      };
    }

    return null;
  }

  private async detectPython(rootPath: string): Promise<DetectorResult | null> {
    let confidence = 0;
    const metadata: Record<string, unknown> = {};

    // Check for pyproject.toml
    try {
      await access(join(rootPath, 'pyproject.toml'));
      confidence += 0.4;
      metadata.hasProjectToml = true;
    } catch {
      // pyproject.toml not found
    }

    // Check for requirements.txt
    try {
      await access(join(rootPath, 'requirements.txt'));
      confidence += 0.2;
      metadata.hasRequirements = true;
    } catch {
      // requirements.txt not found
    }

    // Check for setup.py
    try {
      await access(join(rootPath, 'setup.py'));
      confidence += 0.2;
      metadata.hasSetupPy = true;
    } catch {
      // setup.py not found
    }

    // Check for Pipfile (Pipenv)
    try {
      await access(join(rootPath, 'Pipfile'));
      confidence += 0.3;
      metadata.hasPipfile = true;
    } catch {
      // Pipfile not found
    }

    if (confidence > 0.2) {
      return {
        name: 'python',
        confidence: Math.min(confidence, 0.9),
        metadata
      };
    }

    return null;
  }

  private async detectRust(rootPath: string): Promise<DetectorResult | null> {
    try {
      await access(join(rootPath, 'Cargo.toml'));
      
      const metadata: Record<string, unknown> = {
        hasCargoToml: true
      };

      // Check for workspace
      try {
        const content = await readFile(join(rootPath, 'Cargo.toml'), 'utf-8');
        if (content.includes('[workspace]')) {
          metadata.isWorkspace = true;
        }
      } catch {
        // Could not read Cargo.toml
      }

      return {
        name: 'rust',
        confidence: 0.95,
        metadata
      };
    } catch {
      return null;
    }
  }

  private async detectGo(rootPath: string): Promise<DetectorResult | null> {
    let confidence = 0;
    const metadata: Record<string, unknown> = {};

    // Check for go.mod
    try {
      await access(join(rootPath, 'go.mod'));
      confidence += 0.5;
      metadata.hasGoMod = true;
    } catch {
      // go.mod not found
    }

    // Check for go.work (Go workspaces)
    try {
      await access(join(rootPath, 'go.work'));
      confidence += 0.4;
      metadata.hasGoWork = true;
    } catch {
      // go.work not found
    }

    if (confidence > 0.3) {
      return {
        name: 'go',
        confidence: Math.min(confidence, 0.9),
        metadata
      };
    }

    return null;
  }
}