"use strict";

/**
 * Scripts/Install/SyncPackageVersions.js — the version gate.
 *
 * Two things depend on this script being right, and both fail in ways nobody
 * sees at the time:
 *
 *  - The pre-commit hook runs it on EVERY commit and re-stages whatever it
 *    rewrote. A bug that rewrites the wrong "version" string, or that walks
 *    into a directory it should not, silently dirties files nobody touched.
 *    That is not hypothetical: the .claude ignore entry exists because a
 *    version bump once rewrote the package.json of every in-flight agent
 *    worktree nested under the repo root.
 *  - release.yml runs `--check` as a release gate. If --check ever reported
 *    clean while drift existed, a release would ship with internal packages
 *    still claiming an older version — exactly the stale-version reading that
 *    vulnerability scanners flag and that this script exists to prevent. So
 *    --check must be strict AND must not write.
 *
 * The script derives its repo root from __dirname, so each test copies it into
 * a throwaway tree laid out the same way (<root>/Scripts/Install/...) and runs
 * it there. That exercises the real file rather than a reimplementation of it,
 * and keeps every assertion away from this repo's own package.json files.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_RELATIVE_PATH = path.join(
  "Scripts",
  "Install",
  "SyncPackageVersions.js",
);
const REAL_SCRIPT_PATH = path.join(REPO_ROOT, SCRIPT_RELATIVE_PATH);

const workspaces = [];

function makeWorkspace(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-package-versions-"));
  workspaces.push(dir);

  fs.mkdirSync(path.join(dir, "Scripts", "Install"), { recursive: true });
  fs.copyFileSync(REAL_SCRIPT_PATH, path.join(dir, SCRIPT_RELATIVE_PATH));
  fs.writeFileSync(path.join(dir, "VERSION"), `${version}\n`);

  return dir;
}

function writePackageJson(root, relativeDir, contents) {
  const dir = path.join(root, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "package.json");
  fs.writeFileSync(
    file,
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
  );
  return file;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(root, args) {
  return spawnSync(
    process.execPath,
    [path.join(root, SCRIPT_RELATIVE_PATH), ...(args || [])],
    { encoding: "utf8" },
  );
}

afterAll(() => {
  for (const dir of workspaces) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("syncing", () => {
  test("rewrites every package.json that is behind the VERSION file", () => {
    const root = makeWorkspace("13.0.2");
    const common = writePackageJson(root, "Common", {
      name: "common",
      version: "1.0.0",
    });
    const probe = writePackageJson(root, "Probe", {
      name: "probe",
      version: "12.0.1",
    });

    const result = run(root);

    expect(result.status).toBe(0);
    expect(readJson(common).version).toBe("13.0.2");
    expect(readJson(probe).version).toBe("13.0.2");
  });

  test("leaves a package.json that is already at the version byte-for-byte alone", () => {
    const root = makeWorkspace("13.0.2");
    const file = writePackageJson(root, "App", {
      name: "app",
      version: "13.0.2",
    });
    const before = fs.readFileSync(file, "utf8");

    run(root);

    // Not just equal JSON — an unnecessary rewrite would show up as a diff in
    // every commit the pre-commit hook touches.
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  test("changes nothing but the version field", () => {
    const root = makeWorkspace("13.0.2");
    const file = writePackageJson(root, "App", {
      name: "app",
      version: "1.0.0",
      dependencies: { express: "^4.18.0" },
      scripts: { test: "jest" },
    });

    run(root);

    expect(readJson(file)).toEqual({
      name: "app",
      version: "13.0.2",
      dependencies: { express: "^4.18.0" },
      scripts: { test: "jest" },
    });
  });

  test("does not touch a dependency whose own range looks like a version", () => {
    const root = makeWorkspace("13.0.2");
    const file = writePackageJson(root, "App", {
      name: "app",
      version: "1.0.0",
      dependencies: { "some-lib": "1.0.0", "other-lib": "~1.0.0" },
    });

    run(root);

    expect(readJson(file).dependencies).toEqual({
      "some-lib": "1.0.0",
      "other-lib": "~1.0.0",
    });
  });

  test("reports each file it changed, with the version it came from", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "Common", { name: "common", version: "12.0.9" });

    const result = run(root);

    expect(result.stdout).toContain("sync:");
    expect(result.stdout).toContain(path.join("Common", "package.json"));
    expect(result.stdout).toContain("12.0.9 -> 13.0.2");
  });

  test("says so plainly when there was nothing to do", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "Common", { name: "common", version: "13.0.2" });

    const result = run(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already at 13.0.2");
  });

  test("trims surrounding whitespace off the VERSION file", () => {
    const root = makeWorkspace("13.0.2");
    fs.writeFileSync(path.join(root, "VERSION"), "  13.0.2  \n\n");
    const file = writePackageJson(root, "Common", {
      name: "common",
      version: "1.0.0",
    });

    run(root);

    expect(readJson(file).version).toBe("13.0.2");
  });
});

describe("what it refuses to walk into", () => {
  test("ignores node_modules, build, dist and coverage", () => {
    const root = makeWorkspace("13.0.2");

    const vendored = [
      writePackageJson(root, path.join("Common", "node_modules", "lodash"), {
        name: "lodash",
        version: "4.17.21",
      }),
      writePackageJson(root, path.join("App", "build", "pkg"), {
        name: "built",
        version: "0.0.1",
      }),
      writePackageJson(root, path.join("App", "dist", "pkg"), {
        name: "dist",
        version: "0.0.1",
      }),
      writePackageJson(root, path.join("coverage", "pkg"), {
        name: "coverage",
        version: "0.0.1",
      }),
    ];

    run(root);

    for (const file of vendored) {
      expect(readJson(file).version).not.toBe("13.0.2");
    }
  });

  test("ignores .claude, so a nested agent worktree is not rewritten", () => {
    /*
     * The regression this entry was added for: agent worktrees are full
     * checkouts of this repo nested under the root, each with its own VERSION.
     * A bump used to rewrite all of their package.json files, dirtying dozens
     * of unrelated branches with a version their own VERSION file did not
     * carry.
     */
    const root = makeWorkspace("13.0.2");
    const nested = writePackageJson(
      root,
      path.join(".claude", "worktrees", "some-branch"),
      { name: "worktree", version: "12.0.1" },
    );

    run(root);

    expect(readJson(nested).version).toBe("12.0.1");
  });

  test("does not follow a symlinked directory back into the tree", () => {
    const root = makeWorkspace("13.0.2");
    const real = writePackageJson(root, "Real", {
      name: "real",
      version: "1.0.0",
    });
    fs.symlinkSync(path.join(root, "Real"), path.join(root, "Linked"), "dir");

    const result = run(root);

    // The real one is still synced; the link is simply not a second path to it.
    expect(result.status).toBe(0);
    expect(readJson(real).version).toBe("13.0.2");
    expect(result.stdout).not.toContain(path.join("Linked", "package.json"));
  });
});

describe("files it skips rather than fails on", () => {
  test("a package.json with no version field is left alone", () => {
    const root = makeWorkspace("13.0.2");
    const file = writePackageJson(root, "NoVersion", { name: "no-version" });

    const result = run(root);

    expect(result.status).toBe(0);
    expect(readJson(file)).toEqual({ name: "no-version" });
  });

  test("a package.json that is not valid JSON does not stop the run", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "Broken", "{ not json");
    const good = writePackageJson(root, "Good", {
      name: "good",
      version: "1.0.0",
    });

    const result = run(root);

    expect(result.status).toBe(0);
    expect(readJson(good).version).toBe("13.0.2");
  });
});

describe("--check, the release gate", () => {
  test("exits non-zero and names the drift", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "Common", { name: "common", version: "12.0.9" });

    const result = run(root, ["--check"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("drift:");
    expect(result.stderr).toContain("out of sync with VERSION (13.0.2)");
  });

  test("tells the reader how to fix it", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "Common", { name: "common", version: "12.0.9" });

    const result = run(root, ["--check"]);

    expect(result.stderr).toContain("npm run sync-package-versions");
  });

  test("does not write — a check that repaired the drift would hide it", () => {
    const root = makeWorkspace("13.0.2");
    const file = writePackageJson(root, "Common", {
      name: "common",
      version: "12.0.9",
    });
    const before = fs.readFileSync(file, "utf8");

    run(root, ["--check"]);

    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  test("exits zero when everything already matches", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "Common", { name: "common", version: "13.0.2" });
    writePackageJson(root, "App", { name: "app", version: "13.0.2" });

    const result = run(root, ["--check"]);

    expect(result.status).toBe(0);
  });

  test("a file it skips is not reported as drift", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "NoVersion", { name: "no-version" });
    writePackageJson(root, "Broken", "{ not json");

    const result = run(root, ["--check"]);

    expect(result.status).toBe(0);
  });
});

describe("an unusable VERSION file", () => {
  test("an empty VERSION is an error, not a sync to the empty string", () => {
    const root = makeWorkspace("13.0.2");
    fs.writeFileSync(path.join(root, "VERSION"), "   \n");
    const file = writePackageJson(root, "Common", {
      name: "common",
      version: "12.0.9",
    });

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VERSION file is empty");
    expect(readJson(file).version).toBe("12.0.9");
  });
});

describe("this repository", () => {
  test("every internal package.json already matches VERSION", () => {
    /*
     * The same assertion release.yml makes, run on every PR rather than only
     * at release time — a bump that missed a package.json should fail here,
     * where it is cheap to fix, not on the release branch.
     */
    const result = spawnSync(process.execPath, [REAL_SCRIPT_PATH, "--check"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });

    expect(result.stdout + result.stderr).toContain("already at");
    expect(result.status).toBe(0);
  });
});
