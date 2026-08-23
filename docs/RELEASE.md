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
- Consumer install posture: simulated through local `npm pack` tarball install
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
7. Prepublish wording inspection for the alpha boundary.
8. `npm pack --dry-run`.
9. Consumer install smoke test from a generated local tarball.

## Consumer install smoke test

`release:check` runs:

```bash
npm run consumer:smoke
```

This script creates a real local package tarball with `npm pack`, installs that tarball into a temporary consumer project, and imports the public subpaths:

```text
@storekeeper/db
@storekeeper/db/core
@storekeeper/db/node
@storekeeper/db/react
@storekeeper/db/experimental
```

It also checks a minimal runtime flow:

- create source state
- run a supported `find()`
- read a `liveFind()` snapshot through the React adapter shape
- run the experimental async write-behind `flush()` boundary

This does not publish to npm and does not verify registry behavior. It verifies that the packed package is consumable from a clean local project.

## Prepublish wording inspection

`release:check` includes a lightweight inspection of public release wording.

It verifies that the public docs still say:

- the release is an alpha, not a stable API release
- publishing must use `npm publish --tag alpha`
- the package must not be published as `latest`
- the full browser adapter is not implemented
- Node's `--experimental-sqlite` flag is required
- benchmark timings are observational and not a hard release latency gate

This check is intentionally conservative. It does not replace human review, but it prevents the most important alpha disclaimers from disappearing accidentally.

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
- Confirm `npm run consumer:smoke` passes if package boundary changes were made.
- Confirm `CHANGELOG.md` describes the version being published.
- Confirm open issues for browser, time-based decay, and metadata scoring are still accurately scoped.
- Run `npm run release:check` on a clean checkout.
- Use an alpha tag until the API is intentionally frozen.

Suggested publish command, when intentionally accepted:

```bash
npm publish --tag alpha
```

Do not publish from this checklist automatically.
