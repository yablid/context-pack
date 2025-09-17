/**
 * Integration test for scoped paste functionality
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PlanOnlyService } from '../../src/features/scoped-pack/plan-only-service.js';
import { TsProgramService } from '../../src/core/ts-program/service.js';
import { schemaValidator } from '../../src/core/validation/schema-validator.js';
import { join } from 'node:path';
import { readFileSync, statSync } from 'node:fs';

describe('Scoped Paste Integration', () => {
  let tsProgramService: TsProgramService;
  let planOnlyService: PlanOnlyService;
  const testProjectPath = join(__dirname, '../fixtures/small-project');

  beforeAll(async () => {
    tsProgramService = new TsProgramService(testProjectPath);
    await tsProgramService.initialize();
    planOnlyService = new PlanOnlyService(tsProgramService, testProjectPath);
  });

  it('should generate paste output with stable separators', async () => {
    const scopedConfig = {
      planOnly: {
        seed: 'src/index.ts#Calculator' as const,
        rootPath: testProjectPath,
        maxDepth: 2,
        includeTests: false,
        includeDocs: false,
      },
      paste: {
        budgetTokens: 5000,
        budgetBytes: 50000,
        budgetFiles: 10,
        allowCodeBodies: true,
        redactSecrets: true,
      },
    };

    // Mock file info for the test
    const mockFiles = [
      {
        path: join(testProjectPath, 'src/index.ts'),
        bytes: 1000,
        sha256: 'abc123',
        loc: 30,
        kind: 'code' as const,
        bucket: 'public' as const,
      },
      {
        path: join(testProjectPath, 'src/utils.ts'),
        bytes: 800,
        sha256: 'def456',
        loc: 25,
        kind: 'code' as const,
        bucket: 'public' as const,
      },
    ];

    const pasteResult = await planOnlyService.generatePaste(scopedConfig, mockFiles);

    // Check structure
    expect(pasteResult).toBeDefined();
    expect(pasteResult.sections.length).toBeGreaterThan(0);
    expect(pasteResult.totalTokens).toBeGreaterThan(0);
    expect(pasteResult.totalBytes).toBeGreaterThan(0);

    // Check section types
    const sectionTypes = pasteResult.sections.map(s => s.type);
    expect(sectionTypes).toContain('header');
    expect(sectionTypes).toContain('index');
    expect(sectionTypes).toContain('summary');

    // Check budget enforcement
    expect(pasteResult.totalTokens).toBeLessThanOrEqual(scopedConfig.paste.budgetTokens);
    expect(pasteResult.totalBytes).toBeLessThanOrEqual(scopedConfig.paste.budgetBytes);

    // Check deterministic structure
    const headerSection = pasteResult.sections.find(s => s.type === 'header');
    expect(headerSection).toBeDefined();
    expect(headerSection!.content).toContain('==== SECTION: HEADER ====');
    expect(headerSection!.content).toContain('Seed: src/index.ts#Calculator');
    expect(headerSection!.content).toContain('Resolution: SUCCESS');

    const indexSection = pasteResult.sections.find(s => s.type === 'index');
    expect(indexSection).toBeDefined();
    expect(indexSection!.content).toContain('==== INDEX ====');
  });

  it('should generate complete paste string with stable separators', async () => {
    const scopedConfig = {
      planOnly: {
        seed: 'src/utils.ts#isEven' as const,
        rootPath: testProjectPath,
        maxDepth: 1,
        includeTests: false,
        includeDocs: false,
      },
      paste: {
        budgetTokens: 3000,
        budgetBytes: 30000,
        allowCodeBodies: true,
        redactSecrets: true,
      },
    };

    const mockFiles = [
      {
        path: join(testProjectPath, 'src/utils.ts'),
        bytes: 800,
        sha256: 'def456',
        loc: 25,
        kind: 'code' as const,
        bucket: 'public' as const,
      },
    ];

    const pasteString = await planOnlyService.generatePasteString(scopedConfig, mockFiles);

    // Check stable separators are present
    expect(pasteString).toContain('==== SECTION: HEADER ====');
    expect(pasteString).toContain('==== INDEX ====');
    expect(pasteString).toContain('==== FILE: src/utils.ts (LOC 25) ====');
    expect(pasteString).toContain('==== SUMMARY ====');
    expect(pasteString).toContain('==== END ====');

    // Check file content is included
    expect(pasteString).toContain('export function isEven');

    // Check summary contains stats
    expect(pasteString).toContain('Total tokens:');
    expect(pasteString).toContain('Total bytes:');
    expect(pasteString).toContain('Truncated:');
  });

  it('should handle budget limits gracefully', async () => {
    const scopedConfig = {
      planOnly: {
        seed: 'src/index.ts#Calculator' as const,
        rootPath: testProjectPath,
        maxDepth: 2,
        includeTests: false,
        includeDocs: false,
      },
      paste: {
        budgetTokens: 100, // Very low budget
        budgetBytes: 500,  // Very low budget
        allowCodeBodies: true,
        redactSecrets: true,
      },
    };

    const mockFiles = [
      {
        path: join(testProjectPath, 'src/index.ts'),
        bytes: 1000,
        sha256: 'abc123',
        loc: 30,
        kind: 'code' as const,
        bucket: 'public' as const,
      },
    ];

    const pasteResult = await planOnlyService.generatePaste(scopedConfig, mockFiles);

    // Should respect budget constraints
    expect(pasteResult.totalTokens).toBeLessThanOrEqual(scopedConfig.paste.budgetTokens);
    expect(pasteResult.totalBytes).toBeLessThanOrEqual(scopedConfig.paste.budgetBytes);

    // Should indicate truncation
    if (pasteResult.truncated) {
      expect(pasteResult.omissionMarkers.length).toBeGreaterThan(0);
    }
  });

  it('should handle code bodies disabled', async () => {
    const scopedConfig = {
      planOnly: {
        seed: 'src/index.ts#Calculator' as const,
        rootPath: testProjectPath,
        maxDepth: 1,
        includeTests: false,
        includeDocs: false,
      },
      paste: {
        budgetTokens: 5000,
        budgetBytes: 50000,
        allowCodeBodies: false, // No code bodies
        redactSecrets: true,
      },
    };

    const mockFiles = [
      {
        path: join(testProjectPath, 'src/index.ts'),
        bytes: 1000,
        sha256: 'abc123',
        loc: 30,
        kind: 'code' as const,
        bucket: 'public' as const,
      },
    ];

    const pasteString = await planOnlyService.generatePasteString(scopedConfig, mockFiles);

    // Should not contain actual code bodies
    expect(pasteString).toContain('// Code bodies not included (allowCodeBodies: false)');
    expect(pasteString).not.toContain('export class Calculator');
  });

  it('should produce deterministic output across runs', async () => {
    const scopedConfig = {
      planOnly: {
        seed: 'src/utils.ts#formatNumber' as const,
        rootPath: testProjectPath,
        maxDepth: 1,
        includeTests: false,
        includeDocs: false,
      },
      paste: {
        budgetTokens: 3000,
        budgetBytes: 30000,
        allowCodeBodies: true,
        redactSecrets: true,
      },
    };

    const mockFiles = [
      {
        path: join(testProjectPath, 'src/utils.ts'),
        bytes: 800,
        sha256: 'def456',
        loc: 25,
        kind: 'code' as const,
        bucket: 'public' as const,
      },
    ];

    // Generate twice
    const pasteResult1 = await planOnlyService.generatePaste(scopedConfig, mockFiles);
    const pasteResult2 = await planOnlyService.generatePaste(scopedConfig, mockFiles);

    // Remove timestamps for comparison
    const result1Copy = { ...pasteResult1 };
    const result2Copy = { ...pasteResult2 };

    // Filter out header sections which contain timestamps
    result1Copy.sections = result1Copy.sections.filter(s => s.type !== 'header');
    result2Copy.sections = result2Copy.sections.filter(s => s.type !== 'header');

    // Should be identical (except timestamps)
    expect(result1Copy.sections).toEqual(result2Copy.sections);
    expect(result1Copy.totalTokens).toBe(result2Copy.totalTokens);
    expect(result1Copy.totalBytes).toBe(result2Copy.totalBytes);
  });
});