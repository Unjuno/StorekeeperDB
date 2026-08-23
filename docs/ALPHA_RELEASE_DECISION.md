# Alpha release decision

This document records the publication decision for the current `0.1.0-alpha.0` line.

## Decision

`0.1.0-alpha.0` is acceptable as a public alpha candidate after `npm run release:check` passes on the release branch.

This is not a stable API release. It is a public prototype/runtime alpha intended to show the StorekeeperDB model:

```text
ordinary TypeScript state
  -> SQLite source rows
  -> scalar lookup projections when useful
  -> live local views
  -> inspectable debug surface
  -> rebuildable derived structures
  -> compactable metadata
```

## Publish posture

Publishing remains manual.

Do not publish automatically from CI. The intended command, when accepted by a human maintainer, is:

```bash
npm publish --tag alpha
```

Use the `alpha` dist-tag. Do not publish as `latest`.

## What is ready

The current public alpha includes:

- local synchronous SQLite-backed runtime
- ordinary mutable array/object state
- row-per-item source persistence
- nested object/array mutation persistence
- common durable array mutators
- scalar-path magic lookup projection through `find()`
- local realtime lookup through `liveFind()`
- React `useSyncExternalStore` adapter verification
- debug APIs for status, inspection, explanation, lifecycle, GC, rebuild, and metadata compaction
- manual derived projection lifecycle
- opt-in automatic derived decay
- metadata / observation compaction
- experimental async write-behind boundary model
- executable demo
- executable benchmark script
- public manual
- release checklist and package dry-run checks

## What is intentionally not ready

The alpha does not claim:

- stable API compatibility
- production database migration semantics
- full browser adapter support
- remote sync
- arbitrary JavaScript predicate compilation into SQL
- wall-clock-time-based lifecycle decay
- full metadata scoring policy
- production performance guarantees

## Required pre-publish checks

Run:

```bash
npm run release:check
```

This currently covers:

- TypeScript build
- runtime tests
- gate script
- executable demo
- package export artifact checks
- required public documentation checks
- `npm pack --dry-run`

Run the benchmark separately when release notes discuss observed runtime behavior:

```bash
npm run benchmark
```

Benchmark timings are observational and environment-sensitive. They are not a hard release gate.

## Manual review checklist

Before publishing, verify:

- README states the alpha scope and known gaps.
- `docs/MANUAL.md` matches the public API.
- `docs/BENCHMARKS.md` does not overclaim performance.
- `docs/RELEASE_NOTES_0.1.0-alpha.0.md` is suitable for a GitHub Release body.
- `CHANGELOG.md` describes the alpha accurately.
- Open follow-up issues still capture known gaps.
- The npm package name, version, files, and exports are intentional.

## Follow-up work after alpha publication

After publishing, continue through separate issues:

- browser adapter design
- explicit time-based lifecycle decay
- richer metadata scoring policy
- API naming freeze
- real examples using downstream prototype apps
- performance trend tracking on a stable runner
