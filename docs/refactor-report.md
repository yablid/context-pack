# Refactor Reports Guide

Refactor reports provide graph-driven, metadata-only signals to prioritize structural fixes in your codebase. They analyze existing context pack artifacts to identify architectural concerns without reading source code bodies.

## Overview

Refactor reports answer critical architectural questions:

- Where are the circular dependencies?
- Which files have excessive fan-in/fan-out?
- What are the largest re-export hubs?
- Which modules have the highest refactoring risk?
- Where should we make architectural cuts?

Reports operate purely on graph data and TypeScript exports - no source code bodies are analyzed.

## Basic Usage

### Generating Reports

```bash
# Generate report from existing context pack
context-pack . --refactor-report

# Same result using alternative syntax
context-pack . --refactor-report

# Generate in paste format for easy reading
context-pack . --refactor-report --refactor-format paste

# Custom artifact paths
context-pack . --refactor-report \
  --refactor-import-graph ./artifacts/import-graph.json \
  --refactor-exports ./artifacts/exports.json
```

**Prerequisites:** Refactor reports require existing context pack artifacts, specifically:
- `30-import-graph.json` (import/export dependencies)
- `ts/60-exports.json` (TypeScript exports)

Generate these first with: `context-pack . --level contracts`

### Output Formats

```bash
# JSON format (default) - machine readable
context-pack . --refactor-report --refactor-format json

# Paste format - human readable
context-pack . --refactor-report --refactor-format paste
```

## Report Structure

### JSON Format

Reports are written to `.contextpack/refactor-report.json`:

```json
{
  "metadata": {
    "generatedAt": "2024-01-15T10:30:00Z",
    "analysisType": "structural-signals",
    "sourceArtifacts": {
      "importGraph": "path/to/import-graph.json",
      "exports": "path/to/exports.json"
    }
  },
  "structural": {
    "sccCount": 0,
    "hasCycles": false,
    "totalNodes": 85,
    "totalEdges": 142,
    "internalEdges": 128,
    "externalEdges": 14,
    "suggestedCuts": []
  },
  "fanAnalysis": {
    "topFanIn": [{"path": "src/types.ts", "count": 22}],
    "topFanOut": [{"path": "src/engine.ts", "count": 15}],
    "thresholds": {"fanIn": 8, "fanOut": 10}
  },
  "reexportHubs": [
    {
      "path": "src/index.ts",
      "reexportCount": 12,
      "totalExports": 15,
      "reexportRatio": 0.8
    }
  ],
  "summary": {
    "primaryConcerns": ["No major structural concerns detected"],
    "recommendedActions": ["Maintain current architecture patterns"],
    "riskAssessment": "low"
  }
}
```

### Paste Format

Human-readable format written to `.contextpack/refactor-report.txt`:

```
==== SECTION: REFACTOR REPORT ====
Generated: 2024-01-15T10:30:00Z
Analysis: structural-signals

==== STRUCTURAL ANALYSIS ====
Nodes: 85
Edges: 142 (128 internal, 14 external)
Cycles: NO

==== TOP FAN-IN (Dependencies) ====
src/types.ts: 22
src/core/validation.ts: 11
src/utils/path-validator.ts: 8

==== TOP FAN-OUT (Orchestrators) ====
src/engine/context-pack-engine.ts: 15
src/scoped/packager.ts: 12
src/cli.ts: 10

==== HOTSPOTS ====
src/types.ts: score=34 (high fan-in, central)
src/engine.ts: score=28 (high fan-out, orchestrator)

==== SUMMARY ====
Risk Assessment: LOW

Primary Concerns:
- No major structural concerns detected

Recommended Actions:
- Maintain current architecture patterns

==== END ====
```

## Analysis Categories

### Structural Analysis

**Cycles and SCCs (Strongly Connected Components):**
- Detects circular dependencies in the import graph
- Counts SCCs to measure circular complexity
- Identifies problematic dependency cycles

**Edge Analysis:**
- Total nodes and edges in the dependency graph
- Internal vs external dependency ratios
- Graph density and connectivity metrics

### Fan Analysis

**Fan-In (Dependencies):**
- Files with many incoming dependencies
- Indicates shared utilities or core types
- High fan-in suggests stable, reusable modules

**Fan-Out (Orchestrators):**
- Files with many outgoing dependencies
- Indicates orchestrators or entry points
- High fan-out suggests potential splitting opportunities

**Dynamic Thresholds:**
- Calculated based on graph statistics
- Typically 75th percentile for fan-in/fan-out
- Adaptive to codebase size and structure

### Re-export Hubs

**Barrel Analysis:**
- Files that primarily re-export other modules
- Re-export ratio: proportion of exports that are re-exports
- Large hubs can create coupling and circular dependencies

**Hub Metrics:**
- Total exports vs re-exports
- Re-export ratio (0.0 to 1.0)
- Impact on dependency graph structure

### Hotspots

**Risk Scoring:**
- Combines multiple architectural signals
- Weights fan-in, fan-out, re-exports, and centrality
- Identifies files most likely to need refactoring

**Hotspot Reasons:**
- High fan-in (widely depended upon)
- High fan-out (orchestrator complexity)
- Large re-export hub
- Central to import graph structure

## Suggested Cuts

When architectural problems are detected, reports include specific suggestions:

### Cut Types

**Import Cuts:**
```json
{
  "edge": {
    "from": "src/orchestrator.ts",
    "to": "**/*",
    "kind": "import",
    "specifier": "multiple"
  },
  "reason": "Orchestrator with excessive fan-out should be split",
  "impact": "high",
  "alternatives": [
    "Split into smaller, focused modules",
    "Extract common dependencies"
  ]
}
```

**Re-export Cuts:**
```json
{
  "edge": {
    "from": "**/*",
    "to": "src/index.ts",
    "kind": "reexport",
    "specifier": "barrel"
  },
  "reason": "Large re-export hub creates coupling",
  "impact": "medium",
  "alternatives": [
    "Direct imports instead of barrel",
    "Split into smaller, focused barrels"
  ]
}
```

### Cut Impact Levels

- **High**: Significantly improves architecture, requires careful planning
- **Medium**: Moderate improvement, manageable refactoring
- **Low**: Small improvement, easy to implement

## Risk Assessment

### Risk Levels

**Low Risk:**
- No cycles detected
- Reasonable fan-in/fan-out distribution
- Few large re-export hubs
- Well-structured module boundaries

**Medium Risk:**
- Some architectural concerns present
- Moderate fan-out or re-export hub size
- Manageable complexity increases

**High Risk:**
- Circular dependencies present
- Excessive fan-out (>20 dependencies)
- Large re-export hubs (>30 re-exports)
- Multiple hotspots with high scores

### Scoring Algorithm

Risk score is calculated from:
- **Cycles**: +3 points if present
- **High fan-out**: +2 points if any file >20 dependencies
- **Large re-export hubs**: +2 points if any hub >30 re-exports
- **Hotspots**: +1 point if any hotspot score >50

Total score determines risk level:
- 0-2: Low risk
- 3-4: Medium risk
- 5+: High risk

## Use Cases

### For Development Teams

1. **Architecture Review**: Identify structural problems before they become technical debt
2. **Refactoring Planning**: Prioritize which modules to refactor first
3. **Code Review**: Check if changes introduce new architectural concerns
4. **Technical Debt**: Quantify and track architectural complexity over time

### For Coding Agents

1. **Change Impact**: Understand which modules are most interconnected
2. **Safe Refactoring**: Identify low-risk vs high-risk refactoring targets
3. **Dependency Planning**: See which modules should be split or merged
4. **Architecture Guidance**: Get data-driven suggestions for structural improvements

## Example Workflows

### Regular Architecture Health Check

```bash
# Generate context pack if needed
context-pack . --level contracts

# Generate refactor report
context-pack . --refactor-report --refactor-format paste

# Review report for concerns
cat .contextpack/refactor-report.txt
```

### Pre-Refactoring Analysis

```bash
# Full analysis before major changes
context-pack . --level full-api

# Generate detailed report
context-pack . --refactor-report --refactor-format json

# Analyze specific concerns
jq '.hotspots[] | select(.score > 40)' .contextpack/refactor-report.json
```

### CI/CD Integration

```bash
# Generate report in CI
context-pack . --refactor-report --refactor-format json

# Check for high-risk indicators
jq '.summary.riskAssessment' .contextpack/refactor-report.json

# Fail build if risk too high
if [ "$(jq -r '.summary.riskAssessment' .contextpack/refactor-report.json)" = "high" ]; then
  echo "High architectural risk detected"
  exit 1
fi
```

## Best Practices

### Regular Monitoring

1. **Weekly Reports**: Generate reports regularly to track architectural drift
2. **Trend Analysis**: Compare reports over time to see improvements/regressions
3. **Threshold Alerts**: Set up alerts when risk assessment changes

### Refactoring Strategy

1. **Start with Hotspots**: Focus on highest-scoring modules first
2. **Break Cycles**: Eliminate circular dependencies before other changes
3. **Split Orchestrators**: Reduce high fan-out modules gradually
4. **Trim Barrels**: Replace large re-export hubs with direct imports

### Team Coordination

1. **Share Reports**: Include reports in architecture reviews
2. **Document Decisions**: Track which suggested cuts were implemented
3. **Measure Impact**: Generate before/after reports to validate improvements

## Limitations

### Current Limitations

1. **TypeScript Only**: Currently only analyzes TypeScript projects
2. **Static Analysis**: No runtime dependency information
3. **Import-Based**: Only sees explicit import/export relationships
4. **No Semantics**: Doesn't understand business logic relationships

### Planned Extensions

1. **Multi-Language**: Support for JavaScript, Python, Go, Rust
2. **Runtime Analysis**: Integration with coverage and profiling data
3. **Semantic Analysis**: Understanding of business domain relationships
4. **Historical Trends**: Tracking architectural metrics over time

## Troubleshooting

### Common Issues

**"No artifacts found":**
- Generate context pack first: `context-pack . --level contracts`
- Verify artifacts exist in `.contextpack/full/`

**"Empty or minimal report":**
- Check that import graph has sufficient data
- Ensure TypeScript compilation succeeds
- Verify exports are properly detected

**"All metrics show zero":**
- Project may be too small for meaningful analysis
- Check artifact file sizes and content
- Ensure graph contains internal dependencies

### Debug Information

```bash
# Check artifact availability
ls -la .contextpack/full/30-import-graph.json
ls -la .contextpack/full/ts/60-exports.json

# Verify graph content
jq '.stats' .contextpack/full/30-import-graph.json

# Check exports data
jq 'keys' .contextpack/full/ts/60-exports.json
```

## Integration

### With Context Packs

Refactor reports are designed to work with existing context pack workflows:

```bash
# Generate context pack and refactor report together
context-pack . --level contracts --refactor-report

# Use both for comprehensive analysis
context-pack . --scope src/types.ts#Config --scope-allow-code --refactor-report
```

### With CI/CD

```yaml
# GitHub Actions example
- name: Generate Refactor Report
  run: |
    context-pack . --level contracts
    context-pack . --refactor-report --refactor-format json

- name: Check Architecture Risk
  run: |
    RISK=$(jq -r '.summary.riskAssessment' .contextpack/refactor-report.json)
    echo "Architecture risk: $RISK"
    if [ "$RISK" = "high" ]; then
      echo "::warning::High architectural risk detected"
    fi
```

### Programmatic Access

```typescript
import { RefactorReportService } from 'context-pack/features/refactor-report';

const service = new RefactorReportService();
const result = await service.generateReport({
  rootPath: './project',
  format: 'json',
  importGraphPath: './artifacts/import-graph.json',
  exportsPath: './artifacts/exports.json'
});

console.log('Risk level:', result.report.summary.riskAssessment);
console.log('Hotspots:', result.report.hotspots);
```

Refactor reports provide essential architectural intelligence for maintaining healthy, scalable codebases through data-driven insights and actionable recommendations.