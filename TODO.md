# TODO - Context Pack Migration Completion

## Status: Completing rewrite.md migration (Steps 4-5 done, structural cleanup remaining)

### 🔄 IN PROGRESS: Complete Migration (Option A)

#### 1. Fix Import Paths ✅ COMPLETED
- ✅ Update all imports from deleted files to new core/ structure
- ✅ Fix relative import paths (../../) to use proper structure
- ✅ Remove references to `src/types.ts` → use `src/core/types.ts`
- ✅ Remove references to `src/engine/canonical-json.ts` → use `src/core/io/canonical-json.ts`
- ✅ Remove references to `src/errors/index.ts` → use `src/errors/public.ts`

#### 2. Complete Folder Migration ✅ COMPLETED
- ✅ Move `src/collectors/` → `src/features/context-pack/collectors/`
- ✅ Move `src/detectors/` → `src/features/context-pack/detectors/`
- ✅ Move `src/scoped/` → `src/features/scoped-pack/`
- [ ] Split `src/engine/` orchestrators into feature services

#### 3. Clean Git State
- [ ] Verify all imports work after migration
- [ ] Run build and tests to ensure no regressions
- [ ] Commit completed migration
- [ ] Remove deleted files from git

#### 4. Verification
- [ ] Test CLI commands work correctly
- [ ] Verify schema validation works
- [ ] Run golden tests if available
- [ ] Update documentation

### ✅ COMPLETED: Core Features (Steps 4-5)
- ✅ Step 4: Refactor-report with graph analysis implemented
- ✅ Step 5: Paste-pack for directory dumps implemented
- ✅ Schema validation for new features
- ✅ CLI integration for both features
- ✅ Core infrastructure migrated to src/core/

### 📋 Architecture Status
- **Core services**: ✅ Migrated to `src/core/`
- **New features**: ✅ Implemented in `src/features/`
- **Legacy structure**: 🔄 Being migrated
- **Import paths**: 🔄 Being updated