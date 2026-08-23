import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorekeeperDB, liveFind } from "../src/index.js";

type Task = {
  title: string;
  done: boolean;
  priority: "low" | "high" | "urgent";
  status: "open" | "closed";
  lane: "backlog" | "active" | "done";
  meta: { labels: string[] };
};

type Timed<T> = {
  value: T;
  ms: number;
};

const N = 3_000;
const REPEATED_LOOKUPS = 20;

const round = (value: number): number => Math.round(value * 1_000) / 1_000;

const time = <T>(fn: () => T): Timed<T> => {
  const start = process.hrtime.bigint();
  const value = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
  return { value, ms: round(ms) };
};

const urgentCountFor = (n: number): number => Math.floor((n - 1) / 100) + 1;

const dir = mkdtempSync(join(tmpdir(), "sk-benchmark-"));
const dbPath = join(dir, "app.sqlite");

let sk = new StorekeeperDB(dbPath);
let pass = false;

try {
  const tasks = sk.state<Task[]>("tasks", []);

  const insert = time(() => {
    sk.batch(() => {
      for (let i = 0; i < N; i++) {
        tasks.push({
          title: `Task ${i}`,
          done: false,
          priority: i % 100 === 0 ? "urgent" : i % 10 === 0 ? "high" : "low",
          status: i % 3 === 0 ? "open" : "closed",
          lane: i % 5 === 0 ? "backlog" : i % 2 === 0 ? "active" : "done",
          meta: { labels: [] },
        });
      }
      tasks[0]!.meta.labels.push("benchmark");
    });
  });

  const firstPriorityLookup = time(() => sk.find<Task>("tasks", { priority: "urgent" }));
  const repeatedPriorityLookup = time(() => {
    let total = 0;
    for (let i = 0; i < REPEATED_LOOKUPS; i++) {
      total += sk.find<Task>("tasks", { priority: "urgent" }).length;
    }
    return total;
  });
  const statusLookup = time(() => sk.find<Task>("tasks", { status: "open" }));
  const laneLookup = time(() => sk.find<Task>("tasks", { lane: "backlog" }));

  const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
  let liveRenders = 0;
  const unsubscribe = liveUrgent.subscribe(() => {
    liveRenders += 1;
  });
  const liveBefore = liveUrgent.getSnapshot().value.length;
  const unrelatedMutation = time(() => {
    tasks[1]!.title = "Renamed non-urgent task";
  });
  const relatedMutation = time(() => {
    tasks[2]!.priority = "urgent";
  });
  const liveAfter = liveUrgent.getSnapshot().value.length;
  unsubscribe();

  const debug = sk.debug();
  const compactMetadata = time(() =>
    debug.compactMetadata({
      maxMagicLogEntries: 25,
      pathCountDecayFactor: 0.5,
      dropPathStatsBelow: -1,
    }),
  );

  const statusBeforeClose = sk.status();
  const priorityStorageBeforeClose = sk.explain("tasks", "priority").storage;
  const derivationsBeforeClose = debug.derivations("tasks");
  const recentMagicCount = debug.recentMagic(1_000).length;
  sk.close();

  sk = new StorekeeperDB(dbPath);
  const reopenedTasks = sk.state<Task[]>("tasks", []);
  const reopenLookup = time(() => sk.find<Task>("tasks", { priority: "urgent" }));
  const statusAfterReopen = sk.status();

  const initialUrgentExpected = urgentCountFor(N);
  const urgentAfterMutationExpected = initialUrgentExpected + 1;
  const expectedRepeatedTotal = initialUrgentExpected * REPEATED_LOOKUPS;

  pass =
    tasks.length === N &&
    firstPriorityLookup.value.length === initialUrgentExpected &&
    repeatedPriorityLookup.value === expectedRepeatedTotal &&
    statusLookup.value.length === Math.ceil(N / 3) &&
    laneLookup.value.length === Math.ceil(N / 5) &&
    liveBefore === initialUrgentExpected &&
    liveAfter === urgentAfterMutationExpected &&
    liveRenders === 1 &&
    reopenedTasks.length === N &&
    reopenLookup.value.length === urgentAfterMutationExpected &&
    priorityStorageBeforeClose === "projection" &&
    statusAfterReopen.items === N;

  console.log(
    JSON.stringify(
      {
        benchmark: "storekeeperdb-alpha-runtime",
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        n: N,
        repeatedLookups: REPEATED_LOOKUPS,
        timingsMs: {
          insertBatch: insert.ms,
          firstPriorityLookup: firstPriorityLookup.ms,
          repeatedPriorityLookup: repeatedPriorityLookup.ms,
          statusLookup: statusLookup.ms,
          laneLookup: laneLookup.ms,
          unrelatedMutation: unrelatedMutation.ms,
          relatedMutation: relatedMutation.ms,
          compactMetadata: compactMetadata.ms,
          reopenPriorityLookup: reopenLookup.ms,
        },
        counts: {
          initialUrgent: firstPriorityLookup.value.length,
          repeatedUrgentTotal: repeatedPriorityLookup.value,
          open: statusLookup.value.length,
          backlog: laneLookup.value.length,
          liveBefore,
          liveAfter,
          liveRenders,
          reopenedLength: reopenedTasks.length,
          urgentAfterReopen: reopenLookup.value.length,
          recentMagicCount,
        },
        storage: {
          priorityBeforeClose: priorityStorageBeforeClose,
          projectionCellsBeforeClose: statusBeforeClose.projectionCells,
          projectionCellsAfterReopen: statusAfterReopen.projectionCells,
          derivationsBeforeClose,
        },
        metadataCompaction: compactMetadata.value,
        pass,
      },
      null,
      2,
    ),
  );
} finally {
  sk.close();
  rmSync(dir, { recursive: true, force: true });
}

if (!pass) process.exit(1);
