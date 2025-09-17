import { execSync } from 'node:child_process';

export interface GitInfo {
  commit?: string;
  branch?: string;
  isDirty?: boolean;
}

/**
 * Get git repository information from the specified directory
 * Unified implementation to prevent drift between pack generator and scoped packager
 */
export async function getGitInfo(cwd: string): Promise<GitInfo> {
  try {
    // Get commit hash
    const commit = execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    // Get branch name
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    // Check if working directory is dirty (has uncommitted changes)
    // Use git status --porcelain for consistency (more comprehensive than git diff --quiet)
    const isDirty = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim().length > 0;

    return { commit, branch, isDirty };
  } catch (error) {
    // Not a git repository or git not available
    return {};
  }
}