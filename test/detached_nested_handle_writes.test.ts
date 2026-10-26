import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { StorekeeperDB, type Dict } from "../src/index.js";

type Routing = { queue: string; details: { code: string }; tags: string[] };
type Job = { id: string; routing?: Routing; backup: { queue: string } };

const physicalSnapshot = (path: string): string => {
  const db = new DatabaseSync(path);
  const state = {
    items: db.prepare("SELECT * FROM __sk_items ORDER BY state_key,id").all(),
    projections: db.prepare("SELECT * FROM __sk_projection ORDER BY state_key,path,item_id").all(),
    paths: db.prepare("SELECT * FROM __sk_paths ORDER BY state_key,path").all(),
    derivations: db.prepare("SELECT * FROM __sk_derivations ORDER BY state_key,path,kind").all(),
    magic: db.prepare("SELECT * FROM __sk_magic_log ORDER BY id").all(),
  };
  db.close();
  return JSON.stringify(state);
};

const audit = (path: string, install: boolean): number => {
  const db = new DatabaseSync(path);
  if (install) {
    db.exec(`
      CREATE TABLE __nested_handle_test_audit (op TEXT NOT NULL);
      CREATE TRIGGER __nested_handle_item_change AFTER UPDATE ON __sk_items
      BEGIN INSERT INTO __nested_handle_test_audit VALUES('item-update'); END;
      CREATE TRIGGER __nested_handle_proj_delete AFTER DELETE ON __sk_projection
      BEGIN INSERT INTO __nested_handle_test_audit VALUES('projection-delete'); END;
      CREATE TRIGGER __nested_handle_proj_insert AFTER INSERT ON __sk_projection
      BEGIN INSERT INTO __nested_handle_test_audit VALUES('projection-insert'); END;
    `);
  }
  const count = (db.prepare("SELECT count(*) as n FROM __nested_handle_test_audit").get() as { n: number }).n;
  db.close();
  return count;
};

test("detached nested proxies reject writes without source, metadata or projection side effects", () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-detached-nested-"));
  const path = join(dir, "app.sqlite");
  try {
    const sk = new StorekeeperDB(path);
    const jobs = sk.state<Job[]>("jobs", [{
      id: "JOB-1",
      routing: { queue: "critical", details: { code: "a" }, tags: ["seed"] },
      backup: { queue: "backup" },
    }]);

    assert.equal(sk.find<Dict>("jobs", { "routing.queue": "critical" }).length, 1);
    assert.equal(sk.find<Dict>("jobs", { "routing.details.code": "a" }).length, 1);
    assert.equal(sk.find<Dict>("jobs", { "backup.queue": "backup" }).length, 1);
    audit(path, true);

    const capturedRouting = jobs[0]!.routing!;
    const capturedDetails = capturedRouting.details;
    const capturedTags = capturedRouting.tags;
    delete jobs[0]!.routing;

    const baselineAfterDeletion = physicalSnapshot(path);
    const auditBefore = audit(path, false);
    assert.throws(() => { capturedRouting.queue = "stale"; }, /Stale Storekeeper nested proxy/);
    assert.throws(() => { capturedDetails.code = "stale"; }, /Stale Storekeeper nested proxy/);
    assert.throws(() => { capturedTags.push("stale"); }, /Stale Storekeeper nested proxy/);
    assert.throws(() => { delete capturedRouting.details; }, /Stale Storekeeper nested proxy/);
    assert.equal(physicalSnapshot(path), baselineAfterDeletion);
    assert.equal(audit(path, false), auditBefore);
    assert.equal(capturedRouting.queue, "critical");
    assert.equal(capturedDetails.code, "a");
    assert.equal(capturedTags.length, 1);

    jobs[0]!.routing = { queue: "normal", details: { code: "new" }, tags: ["first"] };
    const liveRouting = jobs[0]!.routing!;
    const liveDetails = liveRouting.details;
    const liveTags = liveRouting.tags;
    liveRouting.queue = "urgent";
    liveDetails.code = "fresh";
    liveTags.push("second");
    assert.equal(sk.find<Dict>("jobs", { "routing.queue": "urgent" }).length, 1);
    assert.equal(sk.find<Dict>("jobs", { "routing.details.code": "fresh" }).length, 1);

    jobs[0]!.routing = { queue: "replacement", details: { code: "newer" }, tags: [] };
    const baselineAfterReplacement = physicalSnapshot(path);
    const auditBeforeReplacement = audit(path, false);
    assert.throws(() => { liveRouting.queue = "stale"; }, /Stale Storekeeper nested proxy/);
    assert.throws(() => { liveDetails.code = "stale"; }, /Stale Storekeeper nested proxy/);
    assert.throws(() => { liveTags.push("stale"); }, /Stale Storekeeper nested proxy/);
    assert.equal(physicalSnapshot(path), baselineAfterReplacement);
    assert.equal(audit(path, false), auditBeforeReplacement);
    assert.equal(jobs[0]!.routing!.queue, "replacement");

    jobs[0]!.routing!.details.code = "still-live";
    sk.close();

    const reopened = new StorekeeperDB(path);
    const read = reopened.state<Job[]>("jobs", []);
    assert.equal(read[0]?.routing?.queue, "replacement");
    assert.equal(read[0]?.routing?.details.code, "still-live");
    assert.equal(read[0]?.routing?.tags.length, 0);
    assert.equal(read[0]?.backup.queue, "backup");
    assert.equal(reopened.find<Dict>("jobs", { "routing.details.code": "still-live" }).length, 1);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
