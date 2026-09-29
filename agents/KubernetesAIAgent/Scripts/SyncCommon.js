#!/usr/bin/env node
"use strict";

/*
 * Copies the pure kubectl policy closure from packages/Common (and the
 * Runner's argv guard) into this agent, byte for byte.
 *
 * The agent is a standalone package: its image is built from
 * agents/KubernetesAIAgent alone and carries no Common npm dependency, so it
 * cannot import packages/Common at runtime. But the rules it enforces before
 * spawning kubectl must be EXACTLY the server's — KubectlPolicy tiers the
 * argv, KubectlWriteScope bounds where a write may land — or the two sides
 * of the trust boundary disagree about a command. So the files are copied,
 * under Common/ with the same relative layout (their relative imports
 * resolve unchanged), and never edited here.
 *
 *   npm run sync-common    copy every file below from its source
 *   npm run check-common   exit 1 when any copy differs from its source
 *
 * packages/Common/Tests/Utils/AiRemediation/
 * KubernetesAiAgentPolicyCopyParity.test.ts fails when a copy drifts, or when
 * the closure starts importing a file that is not in the list — add it to
 * CommonCopies.json and run sync-common.
 */

const fs = require("fs");
const path = require("path");

const AGENT_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(AGENT_ROOT, "..", "..");

/*
 * What is copied, in CommonCopies.json (so the parity test can read the list
 * without running this script):
 *   commonPolicyFiles  paths relative to packages/Common, copied to
 *                      <agent>/Common/<same path>;
 *   otherCopies        other verbatim copies: repository-relative source ->
 *                      agent-relative target.
 */
const COPIES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "CommonCopies.json"), "utf8"),
);
const COMMON_POLICY_FILES = COPIES.commonPolicyFiles;
const OTHER_COPIES = COPIES.otherCopies;

// Every copy as absolute paths, plus a label for messages.
function getCopies() {
  const copies = COMMON_POLICY_FILES.map((relativePath) => {
    return {
      label: `Common/${relativePath}`,
      source: path.join(REPO_ROOT, "packages", "Common", relativePath),
      target: path.join(AGENT_ROOT, "Common", relativePath),
    };
  });

  for (const copy of OTHER_COPIES) {
    copies.push({
      label: copy.target,
      source: path.join(REPO_ROOT, copy.source),
      target: path.join(AGENT_ROOT, copy.target),
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
function findDrift() {
  return getCopies().filter((copy) => {
    const source = fs.readFileSync(copy.source);
    const target = readOrNull(copy.target);
    return target === null || !source.equals(target);
  });
}

function sync() {
  const drifted = findDrift();

  for (const copy of drifted) {
    fs.mkdirSync(path.dirname(copy.target), { recursive: true });
    fs.copyFileSync(copy.source, copy.target);
  }

  return drifted;
}

module.exports = {
  AGENT_ROOT,
  REPO_ROOT,
  COMMON_POLICY_FILES,
  OTHER_COPIES,
  getCopies,
  findDrift,
  sync,
};

if (require.main === module) {
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    const drifted = findDrift();

    if (drifted.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `These copies differ from their source; run npm run sync-common:\n${drifted
          .map((copy) => {
            return `  ${copy.label}`;
          })
          .join("\n")}`,
      );
      process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.log(`All ${getCopies().length} copies match their source.`);
  } else {
    const copied = sync();

    // eslint-disable-next-line no-console
    console.log(
      copied.length === 0
        ? `All ${getCopies().length} copies were already up to date.`
        : `Updated ${copied.length} copies:\n${copied
            .map((copy) => {
              return `  ${copy.label}`;
            })
            .join("\n")}`,
    );
  }
}
