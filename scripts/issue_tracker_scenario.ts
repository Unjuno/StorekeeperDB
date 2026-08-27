import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorekeeperDB } from "@storekeeper/db";

type IssueV1 = {
  id: string;
  title: string;
  status: "open" | "closed";
};

type Comment = {
  author: string;
  body: string;
};

type IssueV2 = IssueV1 & {
  priority?: "low" | "high" | "urgent";
  labels?: string[];
  comments?: Comment[];
};

type ScenarioFinding = {
  kind: "positive" | "surprise" | "boundary";
  code: string;
  detail: string;
};

const dir = mkdtempSync(join(tmpdir(), "sk-issue-tracker-"));
const dbPath = join(dir, "issues.sqlite");

let pass = false;

try {
  // Iteration 1: start with the smallest useful issue shape.
  let sk = new StorekeeperDB(dbPath);
  let issuesV1 = sk.state<IssueV1[]>("issues", []);
  issuesV1.push({ id: "ISSUE-1", title: "Persist prototype state", status: "open" });
  issuesV1.push({ id: "ISSUE-2", title: "Document query semantics", status: "open" });
  sk.close();

  // Iteration 2: reopen the same data with an evolved application shape.
  sk = new StorekeeperDB(dbPath);
  const issues = sk.state<IssueV2[]>("issues", []);

  const initialCountAfterShapeChange = issues.length;
  const noMigrationRequired =
    initialCountAfterShapeChange === 2 &&
    issues[0]!.priority === undefined &&
    issues[0]!.labels === undefined &&
    issues[0]!.comments === undefined;

  // Add new nested fields through the durable proxy.
  issues[0]!.priority = "urgent";
  issues[0]!.labels = [];
  issues[0]!.labels!.push("alpha");
  issues[0]!.comments = [];
  issues[0]!.comments!.push({ author: "agent", body: "Shape evolved without a migration layer." });

  // Exercise a genuine scalar lookup.
  const queryResult = sk.find<IssueV2>("issues", { id: "ISSUE-1" });
  const queryCopy = queryResult[0];
  if (!queryCopy) throw new Error("expected ISSUE-1 from find()");

  // Deliberately mutate the query result to observe whether it is a durable handle.
  queryCopy.status = "closed";
  const queryMutationIsDetached = issues[0]!.status === "open";

  // Mutate through the state proxy to perform the actual durable update.
  issues[0]!.status = "closed";

  const urgent = sk.find<IssueV2>("issues", { priority: "urgent" });
  const projectionCreated = sk.explain("issues", "priority").storage === "projection";
  sk.close();

  // Iteration 3: prove the evolved shape and durable mutation survived reopen.
  sk = new StorekeeperDB(dbPath);
  const reopened = sk.state<IssueV2[]>("issues", []);
  const reopenedIssue = reopened[0];

  const evolvedShapePersisted =
    reopenedIssue?.priority === "urgent" &&
    reopenedIssue.labels?.length === 1 &&
    reopenedIssue.labels[0] === "alpha" &&
    reopenedIssue.comments?.length === 1 &&
    reopenedIssue.comments[0]?.author === "agent";

  const durableStatusPersisted = reopenedIssue?.status === "closed";

  const findings: ScenarioFinding[] = [
    {
      kind: "positive",
      code: "compatible-shape-evolution",
      detail: "Optional fields were added after reopen without a repository layer, table migration, or direct SQL.",
    },
    {
      kind: "surprise",
      code: "find-result-is-detached-snapshot",
      detail: "Mutating an object returned by find() does not mutate durable state; mutation must go through the state proxy.",
    },
    {
      kind: "boundary",
      code: "root-state-is-list",
      detail: "The scenario naturally uses an issues list; the current public state() contract is still array-of-objects rather than arbitrary root values.",
    },
  ];

  pass =
    noMigrationRequired &&
    urgent.length === 1 &&
    projectionCreated &&
    queryMutationIsDetached &&
    evolvedShapePersisted &&
    durableStatusPersisted;

  console.log(JSON.stringify({
    scenario: "realistic-issue-tracker",
    publicEntrypoint: "@storekeeper/db",
    iterations: 3,
    counts: {
      initialAfterShapeChange: initialCountAfterShapeChange,
      urgent: urgent.length,
      reopened: reopened.length,
    },
    checks: {
      noMigrationRequired,
      projectionCreated,
      queryMutationIsDetached,
      evolvedShapePersisted,
      durableStatusPersisted,
    },
    findings,
    pass,
  }, null, 2));

  sk.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (!pass) process.exit(1);
