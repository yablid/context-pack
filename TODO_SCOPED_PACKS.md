# Scoped Packs Implementation Progress

## Phase 1: Foundation ✅
- [x] Create TsProgramService with shared TypeScript Program/LanguageService
- [x] Implement FQN resolver with full specification support
- [x] Create schema definitions for 5 scoped artifacts
- [x] Register schemas in existing system
- [x] Add CLI flags: --scope, --scope-allow-code, --scope-budget, --scope-mode, --scope-include
- [x] Extend BuildConfig interface for scope options

## Phase 2: Core Pipeline
- [ ] Create ScopedCollector (extends BaseCollector, not registered)
- [ ] Implement GraphBuilder for dependency graph construction
- [ ] Implement Ranker with weighted BFS + token budgeting
- [ ] Implement Slicer for code range extraction
- [ ] Implement StubGenerator for .d.ts generation

## Phase 3: Integration
- [ ] Modify ContextPackEngine to conditionally invoke ScopedCollector
- [ ] Test scoped pack generation end-to-end

## Phase 4: Testing & Validation
- [ ] Unit tests for all components
- [ ] Golden tests with fixtures
- [ ] Determinism test (SHA256 comparison)
- [ ] Compilation test for generated stubs
- [ ] Security test for risk gating

## Current Status: Phase 1 Complete ✅, Starting Phase 2
Phase 1 completed:
- TsProgramService with comprehensive FQN resolution
- 5 schema definitions for scoped artifacts
- CLI flags and configuration plumbing
- All schemas registered in SCHEMA_REGISTRY

Next: Implement core pipeline components