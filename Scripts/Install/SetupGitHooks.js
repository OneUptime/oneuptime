// Point git at the hooks tracked in .github/hooks. Runs as the root npm
// "prepare" script, so a plain `npm install` at the repository root sets it up.
//
// It never fails the install: outside a git checkout (a tarball, a CI cache
// without .git) or without git installed, it does nothing. It also leaves the
// config alone when this checkout is nested inside a different repository, so
// it cannot rewire someone else's hooks.
//
// Usage:
//   node Scripts/Install/SetupGitHooks.js

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOKS_PATH = ".github/hooks";

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

try {
  const topLevel = git(["rev-parse", "--show-toplevel"]);
  if (fs.realpathSync(topLevel) === fs.realpathSync(REPO_ROOT)) {
    git(["config", "core.hooksPath", HOOKS_PATH]);
  }
} catch {
  // Not a git checkout, or git is unavailable: nothing to set up.
}
