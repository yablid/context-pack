/**
 * Integration test for plan-only scoped pack functionality
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PlanOnlyService } from '../../src/features/scoped-pack/plan-only-service.js';
import { TsProgramService } from '../../src/core/ts-program/service.js';
import { schemaValidator } from '../../src/core/validation/schema-validator.js';
import { join } from 'node:path';

describe('Scoped Plan-Only Integration', () => {
  let tsProgramService: TsProgramService;
  let planOnlyService: PlanOnlyService;
  const testProjectPath = join(__dirname, '../fixtures/small-project');

  beforeAll(async () => {
    tsProgramService = new TsProgramService(testProjectPath);
    await tsProgramService.initialize();
    planOnlyService = new PlanOnlyService(tsProgramService, testProjectPath);
  });

  it('should resolve symbol seed successfully', async () => {
    const config = {
      seed: 'src/index.ts#Calculator' as const,
      rootPath: testProjectPath,
      maxDepth: 2,
      includeTests: false,
      includeDocs: false,
    };

    const index = await planOnlyService.generateIndex(config);

    expect(index.seed).toBe(config.seed);
    expect(index.resolution.success).toBe(true);
    expect(index.resolution.location).toBeDefined();
    expect(index.resolution.location?.type).toBe('symbol');
    expect(index.resolution.location?.symbol).toBe('Calculator');

    // Should have at least the seed node
    expect(index.symbolGraph.nodes.length).toBeGreaterThan(0);
    expect(index.symbolGraph.seedNodeId).toBeTruthy();

    // Validate against schema
    const validation = schemaValidator.validate('scoped/plan-only-index', index);
    expect(validation.success).toBe(true);
    if (!validation.success) {
      console.log('Validation errors:', validation.errors);
    }
  });

  it('should resolve line:col seed successfully', async () => {
    const config = {
      seed: 'src/index.ts:15:0' as const,
      rootPath: testProjectPath,
      maxDepth: 1,
      includeTests: false,
      includeDocs: false,
    };

    const index = await planOnlyService.generateIndex(config);

    expect(index.seed).toBe(config.seed);
    expect(index.resolution.success).toBe(true);
    expect(index.resolution.location).toBeDefined();
    expect(index.resolution.location?.type).toBe('location');
    expect(index.resolution.location?.line).toBe(15);
    expect(index.resolution.location?.column).toBe(0);

    // Validate against schema
    const validation = schemaValidator.validate('scoped/plan-only-index', index);
    expect(validation.success).toBe(true);
  });

  it('should handle invalid seed gracefully', async () => {
    const config = {
      seed: 'src/nonexistent.ts#NonExistent' as const,
      rootPath: testProjectPath,
      maxDepth: 2,
      includeTests: false,
      includeDocs: false,
    };

    const index = await planOnlyService.generateIndex(config);

    expect(index.seed).toBe(config.seed);
    expect(index.resolution.success).toBe(false);
    expect(index.resolution.diagnostics.length).toBeGreaterThan(0);
    expect(index.symbolGraph.nodes.length).toBe(0);

    // Should still validate against schema
    const validation = schemaValidator.validate('scoped/plan-only-index', index);
    expect(validation.success).toBe(true);
  });

  it('should generate deterministic output', async () => {
    const config = {
      seed: 'src/utils.ts#isEven' as const,
      rootPath: testProjectPath,
      maxDepth: 1,
      includeTests: false,
      includeDocs: false,
    };

    // Generate twice and compare
    const index1 = await planOnlyService.generateIndex(config);
    const index2 = await planOnlyService.generateIndex(config);

    // Remove timestamps for comparison
    const { symbolGraph: graph1, ...rest1 } = index1;
    const { symbolGraph: graph2, ...rest2 } = index2;
    const { generatedAt: _, ...graph1NoTime } = graph1;
    const { generatedAt: __, ...graph2NoTime } = graph2;

    expect(rest1).toEqual(rest2);
    expect(graph1NoTime).toEqual(graph2NoTime);

    // Nodes should be sorted deterministically
    const nodeIds1 = graph1.nodes.map(n => n.id);
    const nodeIds2 = graph2.nodes.map(n => n.id);
    expect(nodeIds1).toEqual(nodeIds2);

    // Check that nodes are actually sorted
    const sortedIds = [...nodeIds1].sort();
    expect(nodeIds1).toEqual(sortedIds);
  });

  it('should respect maxDepth configuration', async () => {
    const seedConfig = 'src/index.ts#Calculator' as const;
    const baseConfig = {
      seed: seedConfig,
      rootPath: testProjectPath,
      includeTests: false,
      includeDocs: false,
    };

    const shallowIndex = await planOnlyService.generateIndex({
      ...baseConfig,
      maxDepth: 1,
    });

    const deepIndex = await planOnlyService.generateIndex({
      ...baseConfig,
      maxDepth: 3,
    });

    // Deeper should have same or more nodes
    expect(deepIndex.symbolGraph.nodes.length).toBeGreaterThanOrEqual(
      shallowIndex.symbolGraph.nodes.length
    );

    // Stats should reflect difference
    expect(deepIndex.stats.depthFromSeed).toBeGreaterThanOrEqual(
      shallowIndex.stats.depthFromSeed
    );
  });
});