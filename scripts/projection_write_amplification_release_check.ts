import { existsSync, readFileSync } from "node:fs";

const fail = (message: string): never => {
  console.error(`projection write amplification release check failed: ${message}`);
  process.exit(1);
};

const requireText = (path: string, requiredText: string): void => {
  if (!existsSync(path)) fail(`missing required file: ${path}`);
  const text = readFileSync(path, "utf8");
  if (!text.includes(requiredText)) fail(`${path} must include: ${requiredText}`);
};

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};

const releaseCheck = pkg.scripts?.["release:check"] ?? "";
if (!releaseCheck.includes("experiment:projection-write-amplification:check")) {
  fail("release:check must include experiment:projection-write-amplification:check");
}
if (typeof pkg.scripts?.["experiment:projection-write-amplification"] !== "string") {
  fail("missing experiment:projection-write-amplification script");
}
if (typeof pkg.scripts?.["experiment:projection-write-amplification:check"] !== "string") {
  fail("missing experiment:projection-write-amplification:check script");
}

const doc = "docs/PROJECTION_WRITE_AMPLIFICATION_EXPERIMENT.md";
requireText(doc, "MEASURED in CI #258");
requireText(doc, "MEASURED_LINEAR_ITEM_REBUILD_WRITES_TIMING_OBSERVATIONAL");
requireText(doc, "W(P) = 2P");
requireText(doc, "Timing is observational only");
requireText(doc, "No runtime optimization or public API change is authorized by this result.");
requireText("docs/README.md", "PROJECTION_WRITE_AMPLIFICATION_EXPERIMENT.md");

console.log(JSON.stringify({
  check: "projection-write-amplification-release-wording",
  experiment: "projection-maintenance-write-amplification",
  pass: true,
}, null, 2));
