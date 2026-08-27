import { existsSync, readFileSync } from "node:fs";

type PackageExport = {
  types?: string;
  import?: string;
};

type CompletePackageExport = {
  types: string;
  import: string;
};

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  scripts?: Record<string, string>;
  exports?: Record<string, PackageExport>;
};

const fail = (message: string): never => {
  console.error(`release check failed: ${message}`);
  process.exit(1);
};

const requireFile = (path: string): void => {
  if (!existsSync(path)) fail(`missing required file: ${path}`);
};

const readText = (path: string): string => {
  requireFile(path);
  return readFileSync(path, "utf8");
};

const requireText = (path: string, requiredText: string): void => {
  const text = readText(path);
  if (!text.includes(requiredText)) fail(`${path} must include: ${requiredText}`);
};

const requireExport = (pkg: PackageJson, exportName: string): CompletePackageExport => {
  const entry = pkg.exports?.[exportName] ?? fail(`missing export entry: ${exportName}`);

  const importPath =
    typeof entry.import === "string" && entry.import.length > 0
      ? entry.import
      : fail(`missing import path for export: ${exportName}`);

  const typesPath =
    typeof entry.types === "string" && entry.types.length > 0
      ? entry.types
      : fail(`missing types path for export: ${exportName}`);

  return { import: importPath, types: typesPath };
};

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const releaseCheck = pkg.scripts?.["release:check"] ?? "";

if (pkg.name !== "@storekeeper/db") fail(`unexpected package name: ${pkg.name ?? "<missing>"}`);
if (pkg.version !== "0.1.0-alpha.0") fail(`unexpected alpha version: ${pkg.version ?? "<missing>"}`);
if (pkg.private !== false) fail("package.json private must be false for public alpha dry-run checks");
if (!releaseCheck.includes("pack:dry")) fail("release:check must include pack:dry");
if (!releaseCheck.includes("consumer:smoke")) fail("release:check must include consumer:smoke");
if (!releaseCheck.includes("experiment:durable-session:check")) {
  fail("release:check must include experiment:durable-session:check");
}
if (!releaseCheck.includes("scenario:issue-tracker:check")) {
  fail("release:check must include scenario:issue-tracker:check");
}
if (releaseCheck.includes("benchmark:check")) {
  fail("release:check must not include benchmark:check while benchmark timing is observational");
}
if (typeof pkg.scripts?.["consumer:smoke"] !== "string") fail("missing consumer:smoke script");
if (typeof pkg.scripts?.["experiment:durable-session"] !== "string") fail("missing durable-session experiment script");
if (typeof pkg.scripts?.["scenario:issue-tracker"] !== "string") fail("missing issue-tracker scenario script");

const expectedFileEntries = ["dist", "README.md", "LICENSE", "CHANGELOG.md", "docs"];
for (const entry of expectedFileEntries) {
  if (!pkg.files?.includes(entry)) fail(`package files must include ${entry}`);
}

const expectedExports = [".", "./core", "./node", "./react", "./experimental"];
for (const exportName of expectedExports) {
  const entry = requireExport(pkg, exportName);
  requireFile(entry.import.replace(/^\.\//, ""));
  requireFile(entry.types.replace(/^\.\//, ""));
}

const publicDocs = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "docs/README.md",
  "docs/ARCHITECTURE.md",
  "docs/DURABLE_VARIABLE_EXPERIMENT.md",
  "docs/ISSUE_TRACKER_EVALUATION.md",
  "docs/MANUAL.md",
  "docs/EVALUATION_LOOP.md",
  "docs/BENCHMARKS.md",
  "docs/ALPHA_RELEASE_DECISION.md",
  "docs/RELEASE_NOTES_0.1.0-alpha.0.md",
  "docs/DEMO.md",
  "docs/REACT_VERIFICATION.md",
  "docs/MAGIC_LIFECYCLE.md",
  "docs/MAGIC_REIMPORT_STATUS.md",
  "docs/DECAY.md",
  "docs/METADATA_COMPACTION.md",
  "docs/RELEASE.md",
  "docs/TRANSACTION_MODEL.md",
  "docs/BROWSER_BOUNDARY.md",
  "docs/RUNTIME_HARDENING.md",
  "docs/NEXT_WORK.md",
];

for (const path of publicDocs) requireFile(path);

const requiredPublicText: Array<[string, string]> = [
  ["README.md", "It is not a production database migration framework."],
  ["README.md", "Full browser adapter is not implemented."],
  ["README.md", "Run Node with `--experimental-sqlite`"],
  ["docs/ARCHITECTURE.md", "durable variable runtime"],
  ["docs/ARCHITECTURE.md", "discoverable durable state"],
  ["docs/DURABLE_VARIABLE_EXPERIMENT.md", "two separate Node processes"],
  ["docs/ISSUE_TRACKER_EVALUATION.md", "find() result mutation semantics"],
  ["docs/ISSUE_TRACKER_EVALUATION.md", "Do not change runtime behavior in the same PR"],
  ["docs/EVALUATION_LOOP.md", "Simple persistence should feel automatic. Hard persistence problems must remain observable and controllable."],
  ["docs/ALPHA_RELEASE_DECISION.md", "public alpha candidate"],
  ["docs/ALPHA_RELEASE_DECISION.md", "not a stable API release"],
  ["docs/ALPHA_RELEASE_DECISION.md", "npm publish --tag alpha"],
  ["docs/ALPHA_RELEASE_DECISION.md", "Do not publish as `latest`"],
  ["docs/RELEASE.md", "npm publish --tag alpha"],
  ["docs/RELEASE.md", "Do not publish from this checklist automatically."],
  ["docs/RELEASE_NOTES_0.1.0-alpha.0.md", "Known gaps"],
  ["docs/RELEASE_NOTES_0.1.0-alpha.0.md", "Full browser adapter is not implemented"],
  ["docs/BROWSER_BOUNDARY.md", "flush()"],
  ["docs/BENCHMARKS.md", "not a hard release latency gate"],
];

for (const [path, requiredText] of requiredPublicText) requireText(path, requiredText);

console.log(JSON.stringify({
  packageName: pkg.name,
  version: pkg.version,
  checkedExports: expectedExports.length,
  checkedDocs: publicDocs.length,
  checkedPublicText: requiredPublicText.length,
  hasConsumerSmoke: true,
  hasDurableSessionExperiment: true,
  hasIssueTrackerScenario: true,
  pass: true,
}, null, 2));
