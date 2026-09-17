"use strict";

/**
 * Scripts/Install/SetupGitHooks.js — wires .github/hooks into git.
 *
 * It runs as the root npm "prepare" script, so it executes on every root
 * `npm install`, on every platform. It has to set core.hooksPath in a normal
 * checkout, and it must never fail the install or touch a repository it does
 * not belong to.
 *
 * Like the other Ops script tests, each case copies the real script into a
 * throwaway tree laid out as <root>/Scripts/Install/... and runs it there.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_RELATIVE_PATH = path.join(
  "Scripts",
  "Install",
  "SetupGitHooks.js",
);
const REAL_SCRIPT_PATH = path.join(REPO_ROOT, SCRIPT_RELATIVE_PATH);

const workspaces = [];

function makeTree(parent) {
  const dir = fs.mkdtempSync(
    path.join(parent || os.tmpdir(), "setup-git-hooks-"),
  );
  if (!parent) {
    workspaces.push(dir);
  }
  fs.mkdirSync(path.join(dir, "Scripts", "Install"), { recursive: true });
  fs.copyFileSync(REAL_SCRIPT_PATH, path.join(dir, SCRIPT_RELATIVE_PATH));
  return dir;
}

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function hooksPath(cwd) {
  return git(cwd, [
    "config",
    "--local",
    "--get",
    "core.hooksPath",
  ]).stdout.trim();
}

function runScript(root) {
  return spawnSync(process.execPath, [path.join(root, SCRIPT_RELATIVE_PATH)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(root) },
  });
}

afterAll(() => {
  for (const dir of workspaces) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SetupGitHooks.js", () => {
  test("points core.hooksPath at .github/hooks in a git checkout", () => {
    const root = makeTree();
    expect(git(root, ["init", "-q"]).status).toBe(0);

    const result = runScript(root);

    expect(result.status).toBe(0);
    expect(hooksPath(root)).toBe(".github/hooks");
  });

  test("exits 0 and writes nothing outside a git checkout", () => {
    const root = makeTree();

    const result = runScript(root);

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".git"))).toBe(false);
  });

  test("leaves an enclosing repository's hooks alone", () => {
    const outer = fs.mkdtempSync(
      path.join(os.tmpdir(), "setup-git-hooks-outer-"),
    );
    workspaces.push(outer);
    expect(git(outer, ["init", "-q"]).status).toBe(0);
    const inner = makeTree(outer);

    const result = spawnSync(
      process.execPath,
      [path.join(inner, SCRIPT_RELATIVE_PATH)],
      { cwd: inner, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(hooksPath(outer)).toBe("");
  });

  test("is what the root package.json prepare script runs", () => {
    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );

    expect(rootPackage.scripts.prepare).toBe(
      "node ./Scripts/Install/SetupGitHooks.js",
    );
    expect(
      fs.statSync(path.join(REPO_ROOT, ".github", "hooks", "pre-commit")).mode &
        0o111,
    ).not.toBe(0);
  });
});
