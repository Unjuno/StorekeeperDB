# Release checklist

StorekeeperDB is currently an alpha package. Do not publish a package only because CI is green; publish only when the runtime boundary and public wording are intentionally accepted.

## Current package posture

- Package name: `@storekeeper/db`
- Version line: `0.1.0-alpha.x`
- Runtime target: Node local synchronous SQLite
- Required Node flag for tests and runtime experiments: `--experimental-sqlite`
- Browser runtime: not implemented
- React runtime verification: covered by the test suite
- Benchmark posture: observational timings plus semantic regression checks

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
5. Benchmark semantic check.
6. Export artifact check for all package subpaths.
7. Public documentation file check.
8. `npm pack --dry-run`.

## Benchmark policy

`npm run benchmark` prints timing observations and semantic counts.

`release:check` runs `benchmark:check`, but benchmark latency is not a hard release gate yet. The check fails only when semantic invariants fail, such as wrong lookup counts, broken reopen behavior, or incorrect live update behavior.

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
- Confirm `CHANGELOG.md` describes the version being published.
- Confirm open issues for browser, time-based decay, and metadata scoring are still accurately scoped.
- Run `npm run release:check` on a clean checkout.
- Use an alpha tag until the API is intentionally frozen.

Suggested publish command, when intentionally accepted:

```bash
npm publish --tag alpha
```

Do not publish from this checklist automatically.
