"use strict";

/**
 * Scripts/Install/SyncPackageVersions.js — the version gate.
 *
 * Two things depend on this script being right, and both fail in ways nobody
 * sees at the time:
 *
 *  - The pre-commit hook (.github/hooks/pre-commit) runs it on EVERY commit
 *    and re-stages whatever it rewrote. A bug that rewrites the wrong
 *    "version" string, or that walks into a directory it should not, silently
 *    dirties files nobody touched.
 *    That is not hypothetical: the .claude ignore entry exists because a
 *    version bump once rewrote the package.json of every in-flight agent
 *    worktree nested under the repo root.
 *  - release.yml runs `--check` as a release gate. If --check ever reported
 *    clean while drift existed, a release would ship with internal packages
 *    still claiming an older version — exactly the stale-version reading that
 *    vulnerability scanners flag and that this script exists to prevent. So
 *    --check must be strict AND must not write.
 *
 * Each package's package-lock.json records the package's own version as well,
 * so the sync and --check cover it too - rewriting only those two fields, and
 * never reformatting a file npm did not write.
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

/*
 * A lockfile the way npm writes one: JSON.stringify with the file's
 * indentation, then a newline. A string is written verbatim.
 */
function writeLockfile(root, relativeDir, contents, indent) {
  const dir = path.join(root, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "package-lock.json");
  fs.writeFileSync(
    file,
    typeof contents === "string"
      ? contents
      : `${JSON.stringify(contents, null, indent || 2)}\n`,
  );
  return file;
}

// A lockfileVersion 3 lockfile for `name` at `version`, with one dependency
// whose own version is the same string, so a rewrite that reached past the
// package's own entries would show.
function lockfileFor(name, version) {
  return {
    name,
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name,
        version,
        dependencies: { "some-lib": version },
      },
      "node_modules/some-lib": {
        version,
        resolved: `https://registry.npmjs.org/some-lib/-/some-lib-${version}.tgz`,
        integrity: "sha512-fixture",
      },
    },
  };
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

/*
 * A package's lockfile records the package's own version too (top-level and
 * packages[""]), and an image's SBOM reads it from there. npm keeps it equal
 * to package.json on every install; the sync keeps it equal on a bump, which
 * is the one change that does not go through npm.
 */
describe("the package-lock.json beside a package", () => {
  test("rewrites the package's own version in both places npm records it, and nothing else", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "App", { name: "app", version: "12.0.9" });
    const lockfile = writeLockfile(root, "App", lockfileFor("app", "12.0.9"));

    const result = run(root);

    const expected = lockfileFor("app", "12.0.9");
    expected.version = "13.0.2";
    expected.packages[""].version = "13.0.2";
    expect(result.status).toBe(0);
    // Byte-for-byte what npm itself would have written: only the two fields.
    expect(fs.readFileSync(lockfile, "utf8")).toBe(
      `${JSON.stringify(expected, null, 2)}\n`,
    );
    expect(readJson(lockfile).packages["node_modules/some-lib"].version).toBe(
      "12.0.9",
    );
  });

  test("syncs a lockfile that lags while its package.json is already at VERSION", () => {
    // How lockfiles got stuck: the bump synced package.json and nothing else.
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "App", { name: "app", version: "13.0.2" });
    const lockfile = writeLockfile(root, "App", lockfileFor("app", "12.0.9"));

    const result = run(root);

    expect(result.status).toBe(0);
    expect(readJson(lockfile).version).toBe("13.0.2");
    expect(readJson(lockfile).packages[""].version).toBe("13.0.2");
  });

  test("keeps the lockfile's own indentation", () => {
    // The repository root's and TestServer's lockfiles are indented by four.
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "TestServer", {
      name: "test-server",
      version: "12.0.9",
    });
    const lockfile = writeLockfile(
      root,
      "TestServer",
      lockfileFor("test-server", "12.0.9"),
      4,
    );

    run(root);

    const expected = lockfileFor("test-server", "12.0.9");
    expected.version = "13.0.2";
    expected.packages[""].version = "13.0.2";
    expect(fs.readFileSync(lockfile, "utf8")).toBe(
      `${JSON.stringify(expected, null, 4)}\n`,
    );
  });

  test("keeps CRLF line endings", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "App", { name: "app", version: "12.0.9" });
    const lockfile = writeLockfile(
      root,
      "App",
      `${JSON.stringify(lockfileFor("app", "12.0.9"), null, 2)}\n`.replace(
        /\n/g,
        "\r\n",
      ),
    );

    run(root);

    const contents = fs.readFileSync(lockfile, "utf8");
    expect(contents.replace(/\r\n/g, "")).not.toContain("\n");
    expect(JSON.parse(contents).version).toBe("13.0.2");
    expect(JSON.parse(contents).packages[""].version).toBe("13.0.2");
  });

  test("leaves a lockfile already at the version byte-for-byte alone", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "App", { name: "app", version: "13.0.2" });
    const lockfile = writeLockfile(root, "App", lockfileFor("app", "13.0.2"));
    const before = fs.readFileSync(lockfile, "utf8");

    const result = run(root);

    expect(fs.readFileSync(lockfile, "utf8")).toBe(before);
    expect(result.stdout).toContain(
      "1 package.json file(s) and 1 package-lock.json file(s) already at 13.0.2",
    );
  });

  test("syncs the top-level version of a lockfileVersion 1 file, which has no packages", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "Old", { name: "old", version: "12.0.9" });
    const lockfile = writeLockfile(root, "Old", {
      name: "old",
      version: "12.0.9",
      lockfileVersion: 1,
      requires: true,
      dependencies: { "some-lib": { version: "12.0.9" } },
    });

    run(root);

    expect(readJson(lockfile)).toEqual({
      name: "old",
      version: "13.0.2",
      lockfileVersion: 1,
      requires: true,
      dependencies: { "some-lib": { version: "12.0.9" } },
    });
  });

  test("reports the lockfile it changed, with the version it came from", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "App", { name: "app", version: "13.0.2" });
    writeLockfile(root, "App", lockfileFor("app", "12.0.9"));

    const result = run(root);

    expect(result.stdout).toContain(
      `sync: ${path.join("App", "package-lock.json")} (12.0.9 -> 13.0.2)`,
    );
  });

  test("leaves alone the lockfile of a package it does not sync", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "NoVersion", { name: "no-version" });
    const lockfile = writeLockfile(
      root,
      "NoVersion",
      lockfileFor("no-version", "12.0.9"),
    );
    const before = fs.readFileSync(lockfile, "utf8");

    const result = run(root, ["--check"]);

    expect(result.status).toBe(0);
    expect(fs.readFileSync(lockfile, "utf8")).toBe(before);
  });

  test("never reaches a lockfile under node_modules", () => {
    const root = makeWorkspace("13.0.2");
    const dir = path.join("Common", "node_modules", "lodash");
    writePackageJson(root, dir, { name: "lodash", version: "4.17.21" });
    const lockfile = writeLockfile(root, dir, lockfileFor("lodash", "4.17.21"));

    run(root);

    expect(readJson(lockfile).version).toBe("4.17.21");
  });

  test("does not reformat a lockfile npm did not write, says how to refresh it, and still counts it as drift", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "App", { name: "app", version: "12.0.9" });
    // Valid JSON, but on one line: rewriting it through JSON would reformat it.
    const lockfile = writeLockfile(
      root,
      "App",
      JSON.stringify(lockfileFor("app", "12.0.9")),
    );
    const before = fs.readFileSync(lockfile, "utf8");

    const result = run(root);

    // The pre-commit hook runs this on every commit, so it must not fail it.
    expect(result.status).toBe(0);
    expect(fs.readFileSync(lockfile, "utf8")).toBe(before);
    expect(result.stderr).toContain(
      `left alone: ${path.join("App", "package-lock.json")} (12.0.9)`,
    );
    expect(result.stderr).toContain("npm install --package-lock-only");

    const check = run(root, ["--check"]);

    expect(check.status).not.toBe(0);
    expect(check.stdout).toContain(
      `drift: ${path.join("App", "package-lock.json")} (12.0.9 -> 13.0.2)`,
    );
  });

  test("a lockfile that is not valid JSON does not stop the run", () => {
    const root = makeWorkspace("13.0.2");
    const pkg = writePackageJson(root, "App", {
      name: "app",
      version: "12.0.9",
    });
    writeLockfile(root, "App", "{ not json");

    const result = run(root);

    expect(result.status).toBe(0);
    expect(readJson(pkg).version).toBe("13.0.2");
  });
});

describe("--check, the release gate", () => {
  test("reports a lagging lockfile as drift, and does not write it", () => {
    const root = makeWorkspace("13.0.2");
    writePackageJson(root, "App", { name: "app", version: "13.0.2" });
    const lockfile = writeLockfile(root, "App", lockfileFor("app", "12.0.9"));
    const before = fs.readFileSync(lockfile, "utf8");

    const result = run(root, ["--check"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(
      `drift: ${path.join("App", "package-lock.json")} (12.0.9 -> 13.0.2)`,
    );
    expect(result.stderr).toContain("out of sync with VERSION (13.0.2)");
    expect(fs.readFileSync(lockfile, "utf8")).toBe(before);
  });

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

/*
 * .github/hooks/pre-commit runs the sync and stages what it rewrote, so the
 * commit that bumps VERSION carries every file --check will look at. Run here
 * for real, in a throwaway repository.
 */
describe("the pre-commit hook", () => {
  const REAL_HOOK_PATH = path.join(REPO_ROOT, ".github", "hooks", "pre-commit");

  // No inherited GIT_* state (a hook or rebase running these tests), and node
  // on PATH for the hook's own `node` call.
  function cleanEnv() {
    const env = { ...process.env, HUSKY: "" };
    for (const key of Object.keys(env)) {
      if (key.startsWith("GIT_")) {
        delete env[key];
      }
    }
    env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || ""}`;
    return env;
  }

  function git(cwd, args) {
    return spawnSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, encoding: "utf8", env: cleanEnv() },
    );
  }

  test("stages the lockfiles a bump rewrote, but not one holding unstaged changes of its own", () => {
    const root = makeWorkspace("13.0.1");
    fs.mkdirSync(path.join(root, ".github", "hooks"), { recursive: true });
    fs.copyFileSync(
      REAL_HOOK_PATH,
      path.join(root, ".github", "hooks", "pre-commit"),
    );
    writePackageJson(root, "App", { name: "app", version: "13.0.1" });
    writeLockfile(root, "App", lockfileFor("app", "13.0.1"));
    writePackageJson(root, "Other", { name: "other", version: "13.0.1" });
    const otherLockfile = writeLockfile(
      root,
      "Other",
      lockfileFor("other", "13.0.1"),
    );
    expect(git(root, ["init", "-q"]).status).toBe(0);
    expect(git(root, ["add", "-A"]).status).toBe(0);
    expect(
      git(root, ["commit", "-q", "--no-verify", "-m", "fixture"]).status,
    ).toBe(0);

    // The bump, staged as a developer would.
    fs.writeFileSync(path.join(root, "VERSION"), "13.0.2\n");
    expect(git(root, ["add", "VERSION"]).status).toBe(0);
    // An npm install in Other that the developer has not chosen to commit.
    const installed = lockfileFor("other", "13.0.1");
    installed.packages["node_modules/unrelated"] = { version: "1.0.0" };
    writeLockfile(root, "Other", installed);

    const hook = spawnSync(
      "sh",
      [path.join(".github", "hooks", "pre-commit")],
      {
        cwd: root,
        encoding: "utf8",
        env: cleanEnv(),
      },
    );

    expect({ status: hook.status, stderr: hook.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    expect(
      git(root, ["diff", "--cached", "--name-only"]).stdout.trim().split("\n"),
    ).toEqual([
      "App/package-lock.json",
      "App/package.json",
      "Other/package.json",
      "VERSION",
    ]);
    // Rewritten, with the developer's own change kept, and left to them.
    expect(readJson(otherLockfile).version).toBe("13.0.2");
    expect(readJson(otherLockfile).packages["node_modules/unrelated"]).toEqual({
      version: "1.0.0",
    });
  });
});

describe("this repository", () => {
  test("every internal package.json, and its lockfile, already matches VERSION", () => {
    /*
     * The same assertion release.yml makes, run on every PR rather than only
     * at release time — a bump that missed a package.json or a lockfile
     * should fail here, where it is cheap to fix, not on the release branch.
     */
    const result = spawnSync(process.execPath, [REAL_SCRIPT_PATH, "--check"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });

    expect(result.stdout + result.stderr).toContain("already at");
    expect(result.status).toBe(0);
  });
});
