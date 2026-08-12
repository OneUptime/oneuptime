/*
 * ---------------------------------------------------------------------------
 * Unit tests for WorkspaceManager.
 *
 * WorkspaceManager is the Runner's sandbox for a task's on-disk work: it hands
 * out per-task directories under a single base inside os.tmpdir(), and its
 * whole safety story is that nothing it deletes ever escapes that base. These
 * tests exercise the real filesystem (through Common's LocalFile) rather than
 * mocking it, because the contract that matters — "a created workspace really
 * exists", "delete refuses paths outside the base", "cleanup only reaps old
 * task dirs" — is only meaningful against real inodes.
 *
 * Every test cleans up the concrete directories it creates, and an afterAll
 * sweep removes anything a failing assertion might have left behind so a bad
 * run cannot poison the next one.
 * ---------------------------------------------------------------------------
 */

import WorkspaceManager, { WorkspaceInfo } from "../../Utils/WorkspaceManager";
import fs from "fs";
import os from "os";
import path from "path";

const BASE_DIR: string = path.join(os.tmpdir(), "oneuptime-ai-agent");

// Directories this test file creates directly (outside the base) for cleanup.
const strayPaths: Array<string> = [];

function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

afterAll(() => {
  // Reap every task directory these tests created under the shared base.
  if (fs.existsSync(BASE_DIR)) {
    for (const name of fs.readdirSync(BASE_DIR)) {
      if (name.startsWith("task-")) {
        rmrf(path.join(BASE_DIR, name));
      }
    }
  }
  for (const p of strayPaths) {
    rmrf(p);
  }
});

describe("getBaseTempDir", () => {
  test("points at a single oneuptime-ai-agent dir inside the OS temp dir", () => {
    expect(WorkspaceManager.getBaseTempDir()).toBe(BASE_DIR);
    expect(WorkspaceManager.getBaseTempDir().startsWith(os.tmpdir())).toBe(
      true,
    );
  });
});

describe("createWorkspace", () => {
  test("creates a real directory under the base and reports it back", async () => {
    const info: WorkspaceInfo =
      await WorkspaceManager.createWorkspace("task-1");

    try {
      expect(info.taskId).toBe("task-1");
      expect(info.createdAt).toBeInstanceOf(Date);
      expect(info.workspacePath.startsWith(BASE_DIR)).toBe(true);
      expect(fs.existsSync(info.workspacePath)).toBe(true);
      expect(fs.statSync(info.workspacePath).isDirectory()).toBe(true);
    } finally {
      rmrf(info.workspacePath);
    }
  });

  test("hands out a distinct path on every call for the same task id", async () => {
    const a: WorkspaceInfo = await WorkspaceManager.createWorkspace("dupe");
    const b: WorkspaceInfo = await WorkspaceManager.createWorkspace("dupe");

    try {
      expect(a.workspacePath).not.toBe(b.workspacePath);
    } finally {
      rmrf(a.workspacePath);
      rmrf(b.workspacePath);
    }
  });

  test("encodes the task id into the directory name", async () => {
    const info: WorkspaceInfo =
      await WorkspaceManager.createWorkspace("myTaskId");

    try {
      expect(path.basename(info.workspacePath)).toContain("-myTaskId-");
    } finally {
      rmrf(info.workspacePath);
    }
  });

  /*
   * The timestamp leads, and is separated from the task id by a hyphen that
   * cannot occur inside it. cleanupOldWorkspaces reads the age back out of
   * this name, and a task id is a UUID — full of hyphens — so any layout
   * that makes the sweeper parse PAST the task id to reach the timestamp
   * cannot work. That is exactly what the old `task-<taskId>-<timestamp>-`
   * layout did, and why the sweeper silently reaped nothing.
   */
  test("puts a parseable timestamp first, before the hyphen-bearing task id", async () => {
    const before: number = Date.now();
    const info: WorkspaceInfo = await WorkspaceManager.createWorkspace(
      "550e8400-e29b-41d4-a716-446655440000",
    );

    try {
      const name: string = path.basename(info.workspacePath);
      const timestamp: number | null =
        WorkspaceManager.timestampFromWorkspaceName(name);

      expect(timestamp).not.toBeNull();
      expect(timestamp as number).toBeGreaterThanOrEqual(before);
      expect(timestamp as number).toBeLessThanOrEqual(Date.now());
    } finally {
      rmrf(info.workspacePath);
    }
  });
});

describe("createSubdirectory", () => {
  test("creates a nested directory and returns its full path", async () => {
    const info: WorkspaceInfo = await WorkspaceManager.createWorkspace("sub");

    try {
      const subPath: string = await WorkspaceManager.createSubdirectory(
        info.workspacePath,
        "repo",
      );

      expect(subPath).toBe(path.join(info.workspacePath, "repo"));
      expect(fs.existsSync(subPath)).toBe(true);
      expect(fs.statSync(subPath).isDirectory()).toBe(true);
    } finally {
      rmrf(info.workspacePath);
    }
  });
});

describe("workspaceExists", () => {
  test("is true for a directory that was created", async () => {
    const info: WorkspaceInfo =
      await WorkspaceManager.createWorkspace("exists");

    try {
      expect(await WorkspaceManager.workspaceExists(info.workspacePath)).toBe(
        true,
      );
    } finally {
      rmrf(info.workspacePath);
    }
  });

  test("is false for a path that does not exist", async () => {
    const missing: string = path.join(BASE_DIR, "task-never-created-000-zzzz");
    expect(await WorkspaceManager.workspaceExists(missing)).toBe(false);
  });
});

describe("writeFile / readFile", () => {
  test("round-trips content through a file in the workspace", async () => {
    const info: WorkspaceInfo = await WorkspaceManager.createWorkspace("rw");

    try {
      const written: string = await WorkspaceManager.writeFile(
        info.workspacePath,
        "notes.txt",
        "hello world",
      );

      expect(written).toBe(path.join(info.workspacePath, "notes.txt"));
      expect(
        await WorkspaceManager.readFile(info.workspacePath, "notes.txt"),
      ).toBe("hello world");
    } finally {
      rmrf(info.workspacePath);
    }
  });

  test("creates missing parent directories for a nested relative path", async () => {
    const info: WorkspaceInfo =
      await WorkspaceManager.createWorkspace("nested");

    try {
      await WorkspaceManager.writeFile(
        info.workspacePath,
        "a/b/c/deep.txt",
        "deep",
      );

      expect(
        fs.existsSync(path.join(info.workspacePath, "a", "b", "c", "deep.txt")),
      ).toBe(true);
      expect(
        await WorkspaceManager.readFile(info.workspacePath, "a/b/c/deep.txt"),
      ).toBe("deep");
    } finally {
      rmrf(info.workspacePath);
    }
  });
});

describe("fileExists", () => {
  test("is true after a file is written and false before", async () => {
    const info: WorkspaceInfo = await WorkspaceManager.createWorkspace("fe");

    try {
      expect(
        await WorkspaceManager.fileExists(info.workspacePath, "x.txt"),
      ).toBe(false);

      await WorkspaceManager.writeFile(info.workspacePath, "x.txt", "1");

      expect(
        await WorkspaceManager.fileExists(info.workspacePath, "x.txt"),
      ).toBe(true);
    } finally {
      rmrf(info.workspacePath);
    }
  });
});

describe("deleteFile", () => {
  test("removes a file from the workspace", async () => {
    const info: WorkspaceInfo = await WorkspaceManager.createWorkspace("del");

    try {
      await WorkspaceManager.writeFile(info.workspacePath, "gone.txt", "bye");
      expect(
        await WorkspaceManager.fileExists(info.workspacePath, "gone.txt"),
      ).toBe(true);

      await WorkspaceManager.deleteFile(info.workspacePath, "gone.txt");

      expect(
        await WorkspaceManager.fileExists(info.workspacePath, "gone.txt"),
      ).toBe(false);
    } finally {
      rmrf(info.workspacePath);
    }
  });
});

describe("listFiles", () => {
  test("returns the names of the entries in the workspace", async () => {
    const info: WorkspaceInfo = await WorkspaceManager.createWorkspace("list");

    try {
      await WorkspaceManager.writeFile(info.workspacePath, "one.txt", "1");
      await WorkspaceManager.writeFile(info.workspacePath, "two.txt", "2");
      await WorkspaceManager.createSubdirectory(info.workspacePath, "adir");

      const names: Array<string> = await WorkspaceManager.listFiles(
        info.workspacePath,
      );

      expect(names.sort()).toEqual(["adir", "one.txt", "two.txt"]);
    } finally {
      rmrf(info.workspacePath);
    }
  });
});

describe("getFullPath", () => {
  test("joins the workspace path and a relative path without touching disk", () => {
    expect(WorkspaceManager.getFullPath("/base/ws", "src/index.ts")).toBe(
      path.join("/base/ws", "src/index.ts"),
    );
  });
});

describe("deleteWorkspace", () => {
  test("removes a workspace and all of its contents", async () => {
    const info: WorkspaceInfo = await WorkspaceManager.createWorkspace("rm");
    await WorkspaceManager.writeFile(info.workspacePath, "a/file.txt", "x");

    await WorkspaceManager.deleteWorkspace(info.workspacePath);

    expect(fs.existsSync(info.workspacePath)).toBe(false);
  });

  test("refuses to delete a path outside the workspace base", async () => {
    // A real directory well outside the base — deleteWorkspace must leave it.
    const outside: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "not-a-workspace-"),
    );
    strayPaths.push(outside);
    const canary: string = path.join(outside, "keep.txt");
    fs.writeFileSync(canary, "do not delete");

    /*
     * deleteWorkspace swallows the security error internally (it logs rather
     * than throws), so we assert on the filesystem, not on a rejection.
     */
    await WorkspaceManager.deleteWorkspace(outside);

    expect(fs.existsSync(canary)).toBe(true);
  });

  test("refuses a base-prefix traversal that resolves outside the base", async () => {
    // Looks like it starts under the base but climbs out via "..".
    const escaping: string = path.join(BASE_DIR, "..", "escape-target");
    const resolved: string = path.normalize(escaping);
    strayPaths.push(resolved);
    fs.mkdirSync(resolved, { recursive: true });
    fs.writeFileSync(path.join(resolved, "keep.txt"), "keep");

    await WorkspaceManager.deleteWorkspace(escaping);

    expect(fs.existsSync(path.join(resolved, "keep.txt"))).toBe(true);
  });
});

describe("cleanupOldWorkspaces", () => {
  test("deletes workspaces older than the cutoff and keeps fresh ones", async () => {
    await WorkspaceManager.initialize();

    const now: number = Date.now();
    const oldStamp: number = now - 48 * 60 * 60 * 1000; // 48h ago
    const freshStamp: number = now; // just now

    const oldDir: string = path.join(BASE_DIR, `task-${oldStamp}-old-aaaa1111`);
    const freshDir: string = path.join(
      BASE_DIR,
      `task-${freshStamp}-fresh-bbbb2222`,
    );
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(freshDir, { recursive: true });

    try {
      const cleaned: number = await WorkspaceManager.cleanupOldWorkspaces(24);

      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(oldDir)).toBe(false);
      expect(fs.existsSync(freshDir)).toBe(true);
    } finally {
      rmrf(oldDir);
      rmrf(freshDir);
    }
  });

  /*
   * REGRESSION. The sweeper used to be dead code in production while its
   * own tests passed, because the tests hand-wrote directory names that
   * happened to fit the pattern and real task ids do not: a task id is the
   * AIRun's UUID, so a real workspace was named
   * `task-<8hex>-<4hex>-<4hex>-<4hex>-<12hex>-<timestamp>-<uid>` and the
   * `task-[^-]+-(\d+)-` pattern could never match it. Every abandoned
   * workspace — a full repository clone each — stayed on disk forever.
   *
   * So this test builds its fixture the way production does: through
   * createWorkspace, with an actual UUID.
   */
  test("reaps a workspace created for a real UUID task id", async () => {
    const info: WorkspaceInfo = await WorkspaceManager.createWorkspace(
      "9f8e7d6c-5b4a-4938-8271-615243342516",
    );

    try {
      expect(fs.existsSync(info.workspacePath)).toBe(true);

      /*
       * The sweeper reaps a workspace strictly OLDER than the cutoff, so at
       * maxAgeHours = 0 it needs at least one whole millisecond to have
       * passed. On a fast machine the create and the sweep land in the same
       * millisecond and nothing is due — which is a property of the clock,
       * not of the name parsing this test is about.
       */
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 5);
      });

      // maxAgeHours = 0: everything this manager owns is now due for reaping.
      const cleaned: number = await WorkspaceManager.cleanupOldWorkspaces(0);

      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(info.workspacePath)).toBe(false);
    } finally {
      rmrf(info.workspacePath);
    }
  });

  test("timestampFromWorkspaceName refuses names that are not ours", () => {
    expect(
      WorkspaceManager.timestampFromWorkspaceName("some-other-directory"),
    ).toBeNull();
    // A task-prefixed name whose first field is not a number.
    expect(
      WorkspaceManager.timestampFromWorkspaceName("task-notanumber-abc"),
    ).toBeNull();
    // The OLD layout must not be reaped by accident either.
    expect(
      WorkspaceManager.timestampFromWorkspaceName(
        "task-550e8400-e29b-41d4-a716-446655440000-1723363200000-9ab3cd12",
      ),
    ).toBeNull();
    expect(
      WorkspaceManager.timestampFromWorkspaceName("task-1723363200000-x-y"),
    ).toBe(1723363200000);
  });

  test("ignores directories whose names do not match the task pattern", async () => {
    await WorkspaceManager.initialize();

    const unrelated: string = path.join(BASE_DIR, "some-other-directory");
    fs.mkdirSync(unrelated, { recursive: true });

    try {
      await WorkspaceManager.cleanupOldWorkspaces(0);

      /*
       * maxAgeHours=0 would reap any *task-* dir, but a non-matching name is
       * left untouched because the timestamp regex never matches it.
       */
      expect(fs.existsSync(unrelated)).toBe(true);
    } finally {
      rmrf(unrelated);
    }
  });

  test("never returns a negative count and does not throw on a normal base", async () => {
    /*
     * cleanupOldWorkspaces owns its base path (BASE_TEMP_DIR) and swallows all
     * errors, so its external contract is only: resolve to a non-negative
     * count without throwing. The base-absent branch (return 0) can't be
     * exercised without racing other Runner suites that share the same base
     * dir, so this pins the safe, observable half of the contract.
     */
    const cleaned: number = await WorkspaceManager.cleanupOldWorkspaces(24);
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });
});

describe("initialize", () => {
  test("creates the base directory and is safe to call repeatedly", async () => {
    await WorkspaceManager.initialize();
    expect(fs.existsSync(BASE_DIR)).toBe(true);

    // Idempotent: a second call must not throw even though the dir exists.
    await WorkspaceManager.initialize();
    expect(fs.existsSync(BASE_DIR)).toBe(true);
  });
});
