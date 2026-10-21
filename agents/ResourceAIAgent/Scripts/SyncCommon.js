#!/usr/bin/env node
"use strict";

/*
 * Copies the pure resource command policy closure from packages/Common into
 * this agent, byte for byte.
 *
 * The agent is a standalone package: its image is built from
 * agents/ResourceAIAgent alone and carries no Common npm dependency, so it
 * cannot import packages/Common at runtime. But the rules it enforces before
 * running anything must be EXACTLY the server's — ResourceCommandPolicy
 * tiers the argv and bounds where a write may land, the output redactor
 * masks secrets — or the two sides of the trust boundary disagree about a
 * command. So the files are copied, under Common/ with the same relative
 * layout (their relative imports resolve unchanged), and never edited here.
 *
 *   npm run sync-common    copy every file below from its source, and remove
 *                          copies whose source is gone
 *   npm run check-common   exit 1 when any copy is missing, differs from its
 *                          source, or has no source any more
 *
 * What is copied is in CommonCopies.json (so the parity test can read the
 * list without running this script):
 *   commonPolicyDirectories  directories relative to packages/Common; EVERY
 *                            file in them (recursively, dotfiles aside) is
 *                            copied, so a new tool module a kit adds is
 *                            picked up without touching the list;
 *   commonPolicyFiles        single files relative to packages/Common;
 *   otherCopies              other verbatim copies: repository-relative
 *                            source -> agent-relative target.
 *
 * packages/Common/Tests/Utils/AiRemediation/
 * ResourceAiAgentPolicyCopyParity.test.ts fails when a copy is missing or
 * drifts, or when the closure starts importing a file that is not copied.
 */

const fs = require("fs");
const path = require("path");

const AGENT_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(AGENT_ROOT, "..", "..");

function resolveRoots(options) {
  const agentRoot = (options && options.agentRoot) || AGENT_ROOT;
  const repoRoot = (options && options.repoRoot) || REPO_ROOT;
  return { agentRoot, repoRoot };
}

function loadCopyList(options) {
  const { agentRoot } = resolveRoots(options);
  const list = JSON.parse(
    fs.readFileSync(path.join(agentRoot, "Scripts", "CommonCopies.json"), "utf8"),
  );

  return {
    commonPolicyDirectories: list.commonPolicyDirectories || [],
    commonPolicyFiles: list.commonPolicyFiles || [],
    otherCopies: list.otherCopies || [],
  };
}

// Every regular file under dir (recursively, dotfiles skipped), relative and "/"-separated, sorted.
function listFilesRecursively(dir) {
  const files = [];

  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const full = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(full, relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };

  walk(dir, "");
  return files.sort();
}

/*
 * The Common-relative paths of every copied Common file: each directory's
 * files, then the single files, without duplicates, sorted. Throws when a
 * listed directory or file does not exist in packages/Common.
 */
function getCommonRelativePaths(options) {
  const { repoRoot } = resolveRoots(options);
  const list = loadCopyList(options);
  const commonRoot = path.join(repoRoot, "packages", "Common");
  const relativePaths = new Set();

  for (const directory of list.commonPolicyDirectories) {
    const sourceDir = path.join(commonRoot, directory);

    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      throw new Error(
        `packages/Common/${directory} (in Scripts/CommonCopies.json) is not a directory.`,
      );
    }

    for (const file of listFilesRecursively(sourceDir)) {
      relativePaths.add(`${directory}/${file}`);
    }
  }

  for (const file of list.commonPolicyFiles) {
    if (!fs.existsSync(path.join(commonRoot, file))) {
      throw new Error(
        `packages/Common/${file} (in Scripts/CommonCopies.json) does not exist.`,
      );
    }

    relativePaths.add(file);
  }

  return Array.from(relativePaths).sort();
}

// Every copy as absolute paths, plus a label for messages.
function getCopies(options) {
  const { agentRoot, repoRoot } = resolveRoots(options);
  const list = loadCopyList(options);

  const copies = getCommonRelativePaths(options).map((relativePath) => {
    return {
      label: `Common/${relativePath}`,
      source: path.join(repoRoot, "packages", "Common", relativePath),
      target: path.join(agentRoot, "Common", relativePath),
    };
  });

  for (const copy of list.otherCopies) {
    copies.push({
      label: copy.target,
      source: path.join(repoRoot, copy.source),
      target: path.join(agentRoot, copy.target),
    });
  }

  return copies;
}

function readOrNull(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

// The copies whose target is missing or differs from its source.
function findDrift(options) {
  return getCopies(options).filter((copy) => {
    const source = fs.readFileSync(copy.source);
    const target = readOrNull(copy.target);
    return target === null || !source.equals(target);
  });
}

/*
 * Files under the agent's Common/ that are no copy's target: a module that
 * was removed or renamed in packages/Common. Left in place it would still
 * compile into the agent, and could be imported by mistake.
 */
function findStray(options) {
  const { agentRoot } = resolveRoots(options);
  const commonDir = path.join(agentRoot, "Common");

  if (!fs.existsSync(commonDir)) {
    return [];
  }

  const targets = new Set(
    getCopies(options).map((copy) => {
      return copy.target;
    }),
  );

  return listFilesRecursively(commonDir)
    .map((relative) => {
      return {
        label: `Common/${relative}`,
        target: path.join(commonDir, ...relative.split("/")),
      };
    })
    .filter((file) => {
      return !targets.has(file.target);
    });
}

function removeEmptyDirectories(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(path.join(dir, entry.name));
    }
  }

  if (fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
}

// Copy what drifted, remove what has no source; returns both lists.
function sync(options) {
  const { agentRoot } = resolveRoots(options);
  const copied = findDrift(options);
  const removed = findStray(options);

  for (const copy of copied) {
    fs.mkdirSync(path.dirname(copy.target), { recursive: true });
    fs.copyFileSync(copy.source, copy.target);
  }

  for (const stray of removed) {
    fs.rmSync(stray.target, { force: true });
  }

  if (removed.length > 0) {
    removeEmptyDirectories(path.join(agentRoot, "Common"));
  }

  return { copied, removed };
}

module.exports = {
  AGENT_ROOT,
  REPO_ROOT,
  loadCopyList,
  listFilesRecursively,
  getCommonRelativePaths,
  getCopies,
  findDrift,
  findStray,
  sync,
};

function formatLabels(items) {
  return items
    .map((item) => {
      return `  ${item.label}`;
    })
    .join("\n");
}

if (require.main === module) {
  const argv = process.argv.slice(2);

  if (argv.includes("--list")) {
    // The Common-relative paths, as JSON: the parity test compares them with its own reading.
    process.stdout.write(`${JSON.stringify(getCommonRelativePaths())}\n`);
  } else if (argv.includes("--check")) {
    const drifted = findDrift();
    const stray = findStray();

    if (drifted.length > 0 || stray.length > 0) {
      const sections = [];

      if (drifted.length > 0) {
        sections.push(
          `These copies are missing or differ from their source:\n${formatLabels(drifted)}`,
        );
      }

      if (stray.length > 0) {
        sections.push(
          `These copies no longer have a source:\n${formatLabels(stray)}`,
        );
      }

      // eslint-disable-next-line no-console
      console.error(`${sections.join("\n")}\nRun npm run sync-common.`);
      process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.log(`All ${getCopies().length} copies match their source.`);
  } else {
    const result = sync();

    if (result.copied.length === 0 && result.removed.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`All ${getCopies().length} copies were already up to date.`);
    } else {
      if (result.copied.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `Updated ${result.copied.length} copies:\n${formatLabels(result.copied)}`,
        );
      }

      if (result.removed.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `Removed ${result.removed.length} copies without a source:\n${formatLabels(result.removed)}`,
        );
      }
    }
  }
}
