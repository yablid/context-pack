// Zod schemas for paste pack validation

import { z } from 'zod';

export const PastePackConfigSchema = z.object({
  rootPath: z.string(),
  outputPath: z.string().optional(),
  allowCodeBodies: z.boolean(),
  format: z.literal('paste'),
  budgets: z.object({
    maxFiles: z.number().int().min(1).optional(),
    maxLoc: z.number().int().min(1).optional(),
    maxBytes: z.number().int().min(1).optional(),
  }).strict(),
  include: z.object({
    patterns: z.array(z.string()).optional(),
    extensions: z.array(z.string()).optional(),
  }).strict().optional(),
  exclude: z.object({
    patterns: z.array(z.string()).optional(),
    directories: z.array(z.string()).optional(),
  }).strict().optional(),
}).strict();

export const PastePackFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  metadata: z.object({
    size: z.number().int().min(0),
    loc: z.number().int().min(0),
    extension: z.string(),
    included: z.boolean(),
    excludeReason: z.string().optional(),
  }).strict(),
}).strict();

export const PastePackResultSchema = z.object({
  metadata: z.object({
    generatedAt: z.string(),
    rootPath: z.string(),
    config: PastePackConfigSchema,
  }).strict(),
  summary: z.object({
    totalFilesScanned: z.number().int().min(0),
    filesIncluded: z.number().int().min(0),
    filesExcluded: z.number().int().min(0),
    totalLoc: z.number().int().min(0),
    totalBytes: z.number().int().min(0),
    truncated: z.boolean(),
    truncationReason: z.string().optional(),
  }).strict(),
  files: z.array(PastePackFileSchema),
  content: z.string(),
}).strict();

export type PastePackConfig = z.infer<typeof PastePackConfigSchema>;
export type PastePackFile = z.infer<typeof PastePackFileSchema>;
export type PastePackResult = z.infer<typeof PastePackResultSchema>;