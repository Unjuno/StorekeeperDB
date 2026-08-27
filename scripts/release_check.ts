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
if (!releaseCheck.includes("experiment:durable-session:check")) fail("release:check must include experiment:durable-session:check");
if (!releaseCheck.includes("experiment:change-amplification:check")) fail("release:check must include experiment:change-amplification:check");
if (!releaseCheck.includes("experiment:cli-change-amplification:check")) fail("release:check must include experiment:cli-change-amplification:check");
if (!releaseCheck.includes("experiment:root-state-semantics:check")) fail("release:check must include experiment:root-state-semantics:check");
if (!releaseCheck.includes("experiment:singleton-object-surface:check")) fail("release:check must include experiment:singleton-object-surface:check");
if (!releaseCheck.includes("experiment:agent-decision-burden:check")) fail("release:check must include experiment:agent-decision-burden:check");
if (!releaseCheck.includes("experiment:agent-project-convention:check")) fail("release:check must include experiment:agent-project-convention:check");
if (!releaseCheck.includes("experiment:declaration-key-rename:check")) fail("release:check must include experiment:declaration-key-rename:check");
if (!releaseCheck.includes("experiment:collection-rename-projection:check")) fail("release:check must include experiment:collection-rename-projection:check");
if (!releaseCheck.includes("experiment:multi-step-declaration-rename:check")) fail("release:check must include experiment:multi-step-declaration-rename:check");
if (!releaseCheck.includes("experiment:state-split-merge-boundary:check")) fail("release:check must include experiment:state-split-merge-boundary:check");
if (!releaseCheck.includes("scenario:issue-tracker:check")) fail("release:check must include scenario:issue-tracker:check");
if (releaseCheck.includes("benchmark:check")) fail("release:check must not include benchmark:check while benchmark timing is observational");

const requiredScripts = [
  "consumer:smoke",
  "experiment:durable-session",
  "experiment:change-amplification",
  "experiment:cli-change-amplification",
  "experiment:root-state-semantics",
  "experiment:singleton-object-surface",
  "experiment:agent-decision-burden",
  "experiment:agent-project-convention",
  "experiment:declaration-key-rename",
  "experiment:collection-rename-projection",
  "experiment:multi-step-declaration-rename",
  "experiment:state-split-merge-boundary",
  "scenario:issue-tracker",
];
for (const script of requiredScripts) {
  if (typeof pkg.scripts?.[script] !== "string") fail(`missing ${script} script`);
}

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
  "docs/FIND_SEMANTICS_EVALUATION.md",
  "docs/CHANGE_AMPLIFICATION_EXPERIMENT.md",
  "docs/CLI_METADATA_CHANGE_AMPLIFICATION_EXPERIMENT.md",
  "docs/ROOT_STATE_SEMANTICS_EVALUATION.md",
  "docs/AGENT_DECISION_BURDEN_EXPERIMENT.md",
  "docs/AGENT_PROJECT_CONVENTION_EXPERIMENT.md",
  "docs/DECLARATION_KEY_RENAME_EXPERIMENT.md",
  "docs/COLLECTION_RENAME_PROJECTION_EXPERIMENT.md",
  "docs/MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md",
  "docs/STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md",
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
  ["README.md", "`find()` returns durable item handles"],
  ["README.md", "`liveFind()` intentionally uses detached snapshots"],
  ["docs/ARCHITECTURE.md", "durable variable runtime"],
  ["docs/ARCHITECTURE.md", "discoverable durable state"],
  ["docs/ARCHITECTURE.md", "command-capable durable item handles"],
  ["docs/DURABLE_VARIABLE_EXPERIMENT.md", "two separate Node processes"],
  ["docs/ISSUE_TRACKER_EVALUATION.md", "find() result item is a durable handle"],
  ["docs/ISSUE_TRACKER_EVALUATION.md", "find() result array remains local"],
  ["docs/FIND_SEMANTICS_EVALUATION.md", "hybrid durable-handle design selected and implemented"],
  ["docs/FIND_SEMANTICS_EVALUATION.md", "current state membership by durable item id"],
  ["docs/CHANGE_AMPLIFICATION_EXPERIMENT.md", "CANDIDATE PASS in CI #116"],
  ["docs/CHANGE_AMPLIFICATION_EXPERIMENT.md", "reduced explicit persistence edit surface"],
  ["docs/CHANGE_AMPLIFICATION_EXPERIMENT.md", "JSON-blob"],
  ["docs/CLI_METADATA_CHANGE_AMPLIFICATION_EXPERIMENT.md", "MIXED in CI #122"],
  ["docs/CLI_METADATA_CHANGE_AMPLIFICATION_EXPERIMENT.md", "singleton-list-boundary"],
  ["docs/CLI_METADATA_CHANGE_AMPLIFICATION_EXPERIMENT.md", "MIXED_EDIT_ADVANTAGE_WITH_CONCEPT_COST"],
  ["docs/ROOT_STATE_SEMANTICS_EVALUATION.md", "PREFER_NARROW_SINGLETON_OBJECT_PROTOTYPE"],
  ["docs/ROOT_STATE_SEMANTICS_EVALUATION.md", "memoryDurableDivergenceAfterOldHandleWrite"],
  ["docs/ROOT_STATE_SEMANTICS_EVALUATION.md", "primitive mutable-reference"],
  ["docs/AGENT_DECISION_BURDEN_EXPERIMENT.md", "CANDIDATE PASS in CI #147"],
  ["docs/AGENT_DECISION_BURDEN_EXPERIMENT.md", "does **not** inspect or claim access to model chain-of-thought"],
  ["docs/AGENT_DECISION_BURDEN_EXPERIMENT.md", "StorekeeperDB | **14** | **7**"],
  ["docs/AGENT_DECISION_BURDEN_EXPERIMENT.md", "singleton-list-adaptation"],
  ["docs/AGENT_PROJECT_CONVENTION_EXPERIMENT.md", "CANDIDATE PASS in CI #159"],
  ["docs/AGENT_PROJECT_CONVENTION_EXPERIMENT.md", "project board | 7 | **5** | 2"],
  ["docs/AGENT_PROJECT_CONVENTION_EXPERIMENT.md", "property rename is now persistence-significant"],
  ["docs/AGENT_PROJECT_CONVENTION_EXPERIMENT.md", "`find()` remains scalar-predicate-only"],
  ["docs/DECLARATION_KEY_RENAME_EXPERIMENT.md", "CANDIDATE PASS in CI #168"],
  ["docs/DECLARATION_KEY_RENAME_EXPERIMENT.md", "CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST"],
  ["docs/DECLARATION_KEY_RENAME_EXPERIMENT.md", "Naive property rename silently initializes fresh state"],
  ["docs/DECLARATION_KEY_RENAME_EXPERIMENT.md", "The alias does not physically rename the StorekeeperDB state key."],
  ["docs/DECLARATION_KEY_RENAME_EXPERIMENT.md", "No public API decision is made by this experiment."],
  ["docs/COLLECTION_RENAME_PROJECTION_EXPERIMENT.md", "CANDIDATE PASS"],
  ["docs/COLLECTION_RENAME_PROJECTION_EXPERIMENT.md", "CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE"],
  ["docs/COLLECTION_RENAME_PROJECTION_EXPERIMENT.md", "The experiment does **not** show successful migration of projection metadata"],
  ["docs/COLLECTION_RENAME_PROJECTION_EXPERIMENT.md", "manifest binds workItems -> tasks"],
  ["docs/COLLECTION_RENAME_PROJECTION_EXPERIMENT.md", "No public API surface is authorized by this result."],
  ["docs/MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md", "CANDIDATE PASS in CI #183"],
  ["docs/MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md", "CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY"],
  ["docs/MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md", "The tested manifest behaves as a **current identity binding**, not a rename-history registry."],
  ["docs/MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md", "Rename source settings does not exist."],
  ["docs/MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md", "No public project-store or rename API is authorized by this result."],
  ["docs/STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md", "BOUNDARY CONFIRMED in CI #192"],
  ["docs/STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md", "BOUNDARY_CONFIRMED_SPLIT_REQUIRES_EXPLICIT_ATOMIC_MIGRATION"],
  ["docs/STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md", "One-to-one rename aliasing is not a general migration mechanism."],
  ["docs/STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md", "The injected failure restored source, targets, manifest, and derived metadata."],
  ["docs/STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md", "No public migration API is authorized by this result."],
  ["docs/NEXT_WORK.md", "Persistence should normally not enter the coding agent's planning loop."],
  ["docs/NEXT_WORK.md", "CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST"],
  ["docs/NEXT_WORK.md", "CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE"],
  ["docs/NEXT_WORK.md", "CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY"],
  ["docs/NEXT_WORK.md", "BOUNDARY_CONFIRMED_SPLIT_REQUIRES_EXPLICIT_ATOMIC_MIGRATION"],
  ["docs/NEXT_WORK.md", "Test many-to-one merge semantics"],
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
  hasChangeAmplificationExperiment: true,
  hasCliChangeAmplificationReplication: true,
  hasRootStateSemanticsExperiment: true,
  hasSingletonObjectSurfaceExperiment: true,
  hasAgentDecisionBurdenExperiment: true,
  hasAgentProjectConventionExperiment: true,
  hasDeclarationKeyRenameExperiment: true,
  hasCollectionRenameProjectionExperiment: true,
  hasMultiStepDeclarationRenameExperiment: true,
  hasStateSplitMergeBoundaryExperiment: true,
  hasIssueTrackerScenario: true,
  hasFindSemanticsDecision: true,
  pass: true,
}, null, 2));
