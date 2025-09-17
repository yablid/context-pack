// Zod schemas for refactor report validation

import { z } from 'zod';

export const SuggestedCutSchema = z.object({
  edge: z.object({
    from: z.string(),
    to: z.string(),
    kind: z.string(),
    specifier: z.string(),
  }).strict(),
  reason: z.string(),
  impact: z.enum(['low', 'medium', 'high']),
  alternatives: z.array(z.string()).optional(),
}).strict();

export const RefactorReportSchema = z.object({
  metadata: z.object({
    generatedAt: z.string(),
    analysisType: z.literal('structural-signals'),
    sourceArtifacts: z.object({
      importGraph: z.string().optional(),
      exports: z.string().optional(),
    }).strict(),
  }).strict(),
  structural: z.object({
    sccCount: z.number().int().min(0),
    hasCycles: z.boolean(),
    totalNodes: z.number().int().min(0),
    totalEdges: z.number().int().min(0),
    internalEdges: z.number().int().min(0),
    externalEdges: z.number().int().min(0),
    suggestedCuts: z.array(SuggestedCutSchema),
  }).strict(),
  fanAnalysis: z.object({
    topFanIn: z.array(z.object({
      path: z.string(),
      count: z.number().int().min(0),
    }).strict()),
    topFanOut: z.array(z.object({
      path: z.string(),
      count: z.number().int().min(0),
    }).strict()),
    thresholds: z.object({
      fanIn: z.number().int().min(0),
      fanOut: z.number().int().min(0),
    }).strict(),
  }).strict(),
  reexportHubs: z.array(z.object({
    path: z.string(),
    reexportCount: z.number().int().min(0),
    totalExports: z.number().int().min(0),
    reexportRatio: z.number().min(0).max(1),
  }).strict()),
  externalReach: z.object({
    totalExternalDeps: z.number().int().min(0),
    topExternalDeps: z.array(z.tuple([z.string(), z.number().int().min(0)])),
    filesWithExternalDeps: z.number().int().min(0),
  }).strict(),
  roleClassification: z.object({
    roots: z.array(z.string()),
    leaves: z.array(z.string()),
    isolated: z.array(z.string()),
    orchestrators: z.array(z.string()),
    kernels: z.array(z.string()),
  }).strict(),
  hotspots: z.array(z.object({
    path: z.string(),
    score: z.number().min(0),
    reasons: z.array(z.string()),
  }).strict()),
  summary: z.object({
    primaryConcerns: z.array(z.string()),
    recommendedActions: z.array(z.string()),
    riskAssessment: z.enum(['low', 'medium', 'high']),
  }).strict(),
}).strict();

export type RefactorReport = z.infer<typeof RefactorReportSchema>;
export type SuggestedCut = z.infer<typeof SuggestedCutSchema>;