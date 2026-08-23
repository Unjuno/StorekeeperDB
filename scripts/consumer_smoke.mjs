import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const workdir = mkdtempSync(join(tmpdir(), "sk-consumer-smoke-"));
let tarballPath = null;

const run = (command, args, options = {}) => {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...(options.env ?? {}) },
  });
};

try {
  const packOutput = run("npm", ["pack", "--silent"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .at(-1);

  if (!packOutput || !packOutput.endsWith(".tgz")) {
    throw new Error(`npm pack did not return a tarball name: ${packOutput ?? "<empty>"}`);
  }

  tarballPath = resolve(root, packOutput);

  writeFileSync(
    join(workdir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        private: true,
        scripts: {
          smoke: "node --experimental-sqlite smoke.mjs",
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(workdir, "smoke.mjs"),
    `import { StorekeeperDB, liveFind } from "@storekeeper/db";\n` +
      `import { StorekeeperDB as CoreStorekeeperDB } from "@storekeeper/db/core";\n` +
      `import { StorekeeperDB as NodeStorekeeperDB } from "@storekeeper/db/node";\n` +
      `import { externalStore } from "@storekeeper/db/react";\n` +
      `import { AsyncMemoryStorage, ExperimentalAsyncWriteBehindRuntime } from "@storekeeper/db/experimental";\n` +
      `import { mkdtempSync, rmSync } from "node:fs";\n` +
      `import { tmpdir } from "node:os";\n` +
      `import { join } from "node:path";\n\n` +
      `const dir = mkdtempSync(join(tmpdir(), "sk-consumer-app-"));\n` +
      `const dbPath = join(dir, "app.sqlite");\n` +
      `let pass = false;\n\n` +
      `try {\n` +
      `  if (CoreStorekeeperDB !== StorekeeperDB) throw new Error("core export mismatch");\n` +
      `  if (NodeStorekeeperDB !== StorekeeperDB) throw new Error("node export mismatch");\n` +
      `\n` +
      `  const sk = new StorekeeperDB(dbPath);\n` +
      `  const tasks = sk.state("tasks", []);\n` +
      `  tasks.push({ title: "Ship alpha", done: false, priority: "urgent" });\n` +
      `  tasks.push({ title: "Document gap", done: false, priority: "low" });\n` +
      `\n` +
      `  const urgent = sk.find("tasks", { priority: "urgent" });\n` +
      `  const liveUrgent = liveFind(sk, "tasks", { priority: "urgent" });\n` +
      `  const store = externalStore(liveUrgent);\n` +
      `  const snapshot = store.getSnapshot();\n` +
      `\n` +
      `  const storage = new AsyncMemoryStorage();\n` +
      `  const experimental = new ExperimentalAsyncWriteBehindRuntime(storage);\n` +
      `  const asyncTasks = await experimental.state("tasks", []);\n` +
      `  asyncTasks.push({ title: "Flush", done: false });\n` +
      `  const beforeFlush = experimental.status().durability;\n` +
      `  await experimental.flush();\n` +
      `  const afterFlush = experimental.status().durability;\n` +
      `\n` +
      `  pass = urgent.length === 1 && snapshot.value.length === 1 && beforeFlush === "dirty" && afterFlush === "clean";\n` +
      `  sk.close();\n` +
      `  console.log(JSON.stringify({ urgent: urgent.length, live: snapshot.value.length, beforeFlush, afterFlush, pass }, null, 2));\n` +
      `} finally {\n` +
      `  rmSync(dir, { recursive: true, force: true });\n` +
      `}\n\n` +
      `if (!pass) process.exit(1);\n`,
  );

  run("npm", ["install", "--no-audit", "--no-fund", tarballPath], { cwd: workdir, stdio: "inherit" });
  run("npm", ["run", "smoke"], { cwd: workdir, stdio: "inherit" });

  console.log(
    JSON.stringify(
      {
        smoke: "consumer-install",
        tarball: packOutput,
        pass: true,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(workdir, { recursive: true, force: true });
  if (tarballPath) rmSync(tarballPath, { force: true });
}
