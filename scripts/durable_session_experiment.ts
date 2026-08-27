import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorekeeperDB, type Dict } from "../src/index.js";

const BOOTSTRAP_KEY = "__workspace";

 type WorkspaceManifest = {
  id: "workspace";
  schemaVersion: 1;
  currentGoal: string;
  activeTask: string;
  importantStateKeys: string[];
  checkpoint: {
    sequence: number;
    note: string;
  };
};

type Decision = {
  id: string;
  summary: string;
  status: "accepted" | "open";
};

type Finding = {
  id: string;
  kind: "architecture" | "api";
  note: string;
};

type ReaderResult = {
  phase: "reader";
  bootstrapKey: string;
  currentGoal: string;
  activeTask: string;
  checkpointSequence: number;
  discoveredStateKeys: string[];
  discoveredCounts: Record<string, number>;
  pass: boolean;
};

const writeSession = (dbPath: string): void => {
  const sk = new StorekeeperDB(dbPath);
  try {
    const workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []);
    const decisions = sk.state<Decision[]>("decisions", []);
    const findings = sk.state<Finding[]>("findings", []);

    workspace.push({
      id: "workspace",
      schemaVersion: 1,
      currentGoal: "Refine StorekeeperDB durable variable architecture",
      activeTask: "Resume from durable bootstrap state",
      importantStateKeys: ["decisions", "findings"],
      checkpoint: {
        sequence: 1,
        note: "writer process created workspace manifest",
      },
    });

    decisions.push({
      id: "decision-1",
      summary: "Keep session bootstrap above the persistence core until experiments justify a core API",
      status: "accepted",
    });

    findings.push({
      id: "finding-1",
      kind: "architecture",
      note: "Durability and discoverability are separate concerns",
    });

    workspace[0]!.checkpoint.sequence = 2;
    workspace[0]!.checkpoint.note = "writer process completed durable checkpoint";

    console.log(JSON.stringify({
      phase: "writer",
      bootstrapKey: BOOTSTRAP_KEY,
      checkpointSequence: workspace[0]!.checkpoint.sequence,
      durableStates: workspace[0]!.importantStateKeys,
      pass: true,
    }));
  } finally {
    sk.close();
  }
};

const readSession = (dbPath: string): ReaderResult => {
  const sk = new StorekeeperDB(dbPath);
  try {
    const workspace = sk.state<WorkspaceManifest[]>(BOOTSTRAP_KEY, []);
    const manifest = workspace[0];

    if (!manifest) {
      return {
        phase: "reader",
        bootstrapKey: BOOTSTRAP_KEY,
        currentGoal: "",
        activeTask: "",
        checkpointSequence: 0,
        discoveredStateKeys: [],
        discoveredCounts: {},
        pass: false,
      };
    }

    const discoveredCounts: Record<string, number> = {};
    for (const stateKey of manifest.importantStateKeys) {
      discoveredCounts[stateKey] = sk.state<Dict[]>(stateKey, []).length;
    }

    const discoveredStateKeys = Object.keys(discoveredCounts);
    const pass =
      manifest.currentGoal === "Refine StorekeeperDB durable variable architecture" &&
      manifest.activeTask === "Resume from durable bootstrap state" &&
      manifest.checkpoint.sequence === 2 &&
      discoveredStateKeys.length === manifest.importantStateKeys.length &&
      Object.values(discoveredCounts).every((count) => count > 0);

    return {
      phase: "reader",
      bootstrapKey: BOOTSTRAP_KEY,
      currentGoal: manifest.currentGoal,
      activeTask: manifest.activeTask,
      checkpointSequence: manifest.checkpoint.sequence,
      discoveredStateKeys,
      discoveredCounts,
      pass,
    };
  } finally {
    sk.close();
  }
};

const phase = process.argv[2];
const suppliedDbPath = process.argv[3];

if (phase === "--writer") {
  if (!suppliedDbPath) throw new Error("writer phase requires a database path");
  writeSession(suppliedDbPath);
  process.exit(0);
}

if (phase === "--reader") {
  if (!suppliedDbPath) throw new Error("reader phase requires a database path");
  const result = readSession(suppliedDbPath);
  console.log(JSON.stringify(result));
  if (!result.pass) process.exit(1);
  process.exit(0);
}

const scriptPath = process.argv[1];
if (!scriptPath) throw new Error("durable session experiment could not resolve its script path");

const dir = mkdtempSync(join(tmpdir(), "sk-durable-session-"));
const dbPath = join(dir, "workspace.sqlite");

try {
  execFileSync(process.execPath, ["--experimental-sqlite", scriptPath, "--writer", dbPath], {
    stdio: "inherit",
  });

  const readerOutput = execFileSync(process.execPath, ["--experimental-sqlite", scriptPath, "--reader", dbPath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const reader = JSON.parse(readerOutput.trim()) as ReaderResult;

  console.log(JSON.stringify({
    experiment: "durable-variable-session-bootstrap",
    processBoundary: "writer and reader executed as separate Node processes",
    bootstrapKey: BOOTSTRAP_KEY,
    reader,
    pass: reader.pass,
  }, null, 2));

  if (!reader.pass) process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
