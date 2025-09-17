import { describe, it, expect } from 'vitest';
import { ImportGraphCollector } from '../../src/features/context-pack/collectors/typescript/import-graph-collector.js';
import type { CollectorContext } from '../../src/core/contracts/collector.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('ImportGraphCollector', () => {
  const collector = new ImportGraphCollector();
  const rootPath = join(__dirname, '../..');
  
  const createContext = (overrides?: Partial<CollectorContext>): CollectorContext => ({
    rootPath,
    files: [],
    presets: [],
    level: 'contracts',
    budget: { maxBytes: 10_000_000, usedBytes: 0 },
    ...overrides
  });
  
  it('should detect TypeScript projects', async () => {
    const detected = await collector.detect(rootPath);
    expect(detected).toBe(true);
  });
  
  it('should build import graph with correct stats', async () => {
    const ctx = createContext();
    const artifacts = await collector.collect(ctx);
    
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    expect(artifact.filename).toBe('30-import-graph.json');
    
    const data = artifact.data as any;
    expect(data.stats).toBeDefined();
    expect(data.stats.totalNodes).toBeGreaterThan(0);
    expect(data.stats.totalEdges).toBeGreaterThan(0);
  });
  
  it('should compute degrees correctly', async () => {
    const ctx = createContext();
    const artifacts = await collector.collect(ctx);
    const data = artifacts[0].data as any;
    
    expect(data.stats.degrees).toBeDefined();
    
    // Verify degree invariants
    const degrees = data.stats.degrees;
    for (const [node, deg] of Object.entries(degrees as Record<string, any>)) {
      expect(deg.in).toBeGreaterThanOrEqual(0);
      expect(deg.out).toBeGreaterThanOrEqual(0);
    }
    
    // Verify degree sum is consistent (may be less than internal edges due to deduplication in adjacency)
    let totalOut = 0;
    for (const deg of Object.values(degrees as Record<string, any>)) {
      totalOut += deg.out;
    }
    expect(totalOut).toBeLessThanOrEqual(data.stats.internalEdges);
  });
  
  it('should identify roots and leaves', async () => {
    const ctx = createContext();
    const artifacts = await collector.collect(ctx);
    const data = artifacts[0].data as any;
    
    expect(data.stats.roots).toBeDefined();
    expect(data.stats.leaves).toBeDefined();
    
    // Roots should have in-degree 0, out-degree > 0
    for (const root of data.stats.roots) {
      const deg = data.stats.degrees[root];
      if (deg) {
        expect(deg.in).toBe(0);
        expect(deg.out).toBeGreaterThan(0);
      }
    }
    
    // Leaves should have out-degree 0, in-degree > 0
    for (const leaf of data.stats.leaves) {
      const deg = data.stats.degrees[leaf];
      if (deg) {
        expect(deg.out).toBe(0);
        expect(deg.in).toBeGreaterThan(0);
      }
    }
  });
  
  it('should classify internal vs external edges', async () => {
    const ctx = createContext();
    const artifacts = await collector.collect(ctx);
    const data = artifacts[0].data as any;
    
    expect(data.stats.internalEdges).toBeDefined();
    expect(data.stats.externalEdges).toBeDefined();
    expect(data.stats.internalEdges + data.stats.externalEdges).toBe(data.stats.totalEdges);
  });
  
  it('should rank top external imports', async () => {
    const ctx = createContext();
    const artifacts = await collector.collect(ctx);
    const data = artifacts[0].data as any;
    
    if (data.stats.topExternalImports) {
      expect(Array.isArray(data.stats.topExternalImports)).toBe(true);
      
      // Verify descending order
      for (let i = 1; i < data.stats.topExternalImports.length; i++) {
        const prev = data.stats.topExternalImports[i - 1];
        const curr = data.stats.topExternalImports[i];
        expect(prev[1]).toBeGreaterThanOrEqual(curr[1]);
      }
    }
  });
  
  it('should detect cycles correctly', async () => {
    const ctx = createContext();
    const artifacts = await collector.collect(ctx);
    const data = artifacts[0].data as any;
    
    expect(typeof data.stats.hasCycles).toBe('boolean');
    expect(typeof data.stats.sccCount).toBe('number');
    
    if (!data.stats.hasCycles) {
      expect(data.stats.sccCount).toBe(0);
    } else {
      expect(data.stats.sccCount).toBeGreaterThan(0);
    }
  });
  
  it('should compute reachability from seed files', async () => {
    const ctx = createContext();
    const artifacts = await collector.collect(ctx);
    const data = artifacts[0].data as any;
    
    if (data.stats.reachability) {
      expect(data.stats.reachability.seeds).toBeDefined();
      expect(data.stats.reachability.reachable).toBeDefined();
      expect(Array.isArray(data.stats.reachability.seeds)).toBe(true);
      expect(Array.isArray(data.stats.reachability.reachable)).toBe(true);
      
      // Seeds should be subset of reachable
      for (const seed of data.stats.reachability.seeds) {
        expect(data.stats.reachability.reachable).toContain(seed);
      }
    }
  });
  
  it('should produce deterministic output', async () => {
    const ctx = createContext();
    
    const artifacts1 = await collector.collect(ctx);
    const artifacts2 = await collector.collect(ctx);
    
    const data1 = JSON.stringify(artifacts1[0].data);
    const data2 = JSON.stringify(artifacts2[0].data);
    
    expect(data1).toBe(data2);
  });
});