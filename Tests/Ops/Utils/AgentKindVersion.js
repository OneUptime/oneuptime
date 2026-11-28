"use strict";

/**
 * A pinned-collector agent's version as the Dashboard reads it, for the Ops
 * tests of the agent's files.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const AGENT_KIND_FILE = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind.ts",
);

/*
 * The version an agent's files stamp as oneuptime.agent.version, and the
 * one the sign beside an agent compares with: the constant AgentKind.ts
 * declares (STORAGE_ARRAY_AGENT_VERSION ...). The collector the agent's
 * compose file pins, until its files change on that collector
 * (packages/Common/Tests/App/Dashboard/AgentFilesVersion.test.ts).
 */
function agentKindVersion(constant) {
  const match = fs
    .readFileSync(AGENT_KIND_FILE, "utf8")
    .match(
      new RegExp(
        `^export const ${constant}: string = "(\\d+\\.\\d+\\.\\d+)";$`,
        "m",
      ),
    );

  if (!match) {
    throw new Error(`AgentKind.ts declares no ${constant}`);
  }

  return match[1];
}

module.exports = { agentKindVersion };
