import { existsSync, readFileSync } from "node:fs";

const fail = (message: string): never => {
  console.error(`migration marker release check failed: ${message}`);
  process.exit(1);
};

const requireText = (path: string, requiredText: string): void => {
  if (!existsSync(path)) fail(`missing required file: ${path}`);
  const text = readFileSync(path, "utf8");
  if (!text.includes(requiredText)) fail(`${path} must include: ${requiredText}`);
};

const doc = "docs/MIGRATION_IDEMPOTENCY_MARKER_EXPERIMENT.md";
requireText(doc, "CANDIDATE PASS in CI #232");
requireText(doc, "CANDIDATE_MINIMAL_ATOMIC_MIGRATION_MARKER_SUFFICIENT");
requireText(doc, "exact physical rollback");
requireText(doc, "split-commit controls");
requireText(doc, "write-idempotency, not observation-neutrality");
requireText(doc, "No public migration API is authorized by this result.");
requireText("docs/README.md", "MIGRATION_IDEMPOTENCY_MARKER_EXPERIMENT.md");
requireText("docs/NEXT_WORK.md", "CANDIDATE_MINIMAL_ATOMIC_MIGRATION_MARKER_SUFFICIENT");
requireText("docs/NEXT_WORK.md", "Probe field deletion with active derived metadata");

console.log(JSON.stringify({
  check: "migration-marker-release-wording",
  experiment: "migration-idempotency-and-crash-retry-marker",
  pass: true,
}, null, 2));
