# Release checklist

StorekeeperDB is currently an alpha package. Do not publish a package only because CI is green; publish only when the runtime boundary and public wording are intentionally accepted.

## Current package posture

- Package name: `@storekeeper/db`
- Version line: `0.1.0-alpha.x`
- Runtime target: Node local synchronous SQLite
- Required Node flag for tests and runtime experiments: `--experimental-sqlite`
- Browser runtime: not implemented
- React runtime verification: covered by the test suite
- Benchmark posture: observational timings, not a hard release gate
- Alpha publish posture: manual only, `npm publish --tag alpha`, never `latest`

## Required checks before publishing

Run:

```bash
npm run release:check
```

This performs:

1. TypeScript build.
2. Runtime tests.
3. Gate script.
4. Demo script.
5. Export artifact check for all package subpaths.
6. Public documentation file check.
7. `npm pack --dry-run`.

## Benchmark policy

`npm run benchmark` prints timing observations and semantic counts.

The benchmark is intentionally outside `release:check` for now. Runtime timings are environment-sensitive, and the release gate should remain deterministic and fast.

Run it manually when evaluating runtime-sensitive changes:

```bash
npm run benchmark
```

## Alpha decision policy

Before publishing an alpha, read:

- `docs/ALPHA_RELEASE_DECISION.md`
- `docs/RELEASE_NOTES_0.1.0-alpha.0.md`

The decision document states what is accepted for alpha and what remains explicitly out of scope. The release notes file is intended to be reused as a GitHub Release body.

## Package contents policy

The package should include:

- `dist/`
- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `docs/`

The package should not include:

- local SQLite databases
- temporary experiment artifacts
- generated tarballs outside npm pack output
- local `node_modules/`

## Export policy

All package exports must have both JavaScript and declaration outputs:

```text
@storekeeper/db
@storekeeper/db/core
@storekeeper/db/node
@storekeeper/db/react
@storekeeper/db/experimental
```

The release check verifies the compiled files referenced by `package.json` exist under `dist/`.

## Publication policy

Before any npm publish:

- Confirm README examples match the current runtime.
- Confirm `docs/MANUAL.md` matches the current public API.
- Confirm `docs/BENCHMARKS.md` describes the benchmark without overclaiming latency guarantees.
- Confirm `docs/ALPHA_RELEASE_DECISION.md` still reflects the accepted alpha boundary.
- Confirm `docs/RELEASE_NOTES_0.1.0-alpha.0.md` is suitable for the GitHub release body.
- Run `npm run benchmark` manually if release notes will mention runtime observations.
- Confirm `CHANGELOG.md` describes the version being published.
- Confirm open issues for browser, time-based decay, and metadata scoring are still accurately scoped.
- Run `npm run release:check` on a clean checkout.
- Use an alpha tag until the API is intentionally frozen.

Suggested publish command, when intentionally accepted:

```bash
npm publish --tag alpha
```

Do not publish from this checklist automatically.
