"use strict";

/**
 * Nothing tells anyone to download a script, or a file an agent installs,
 * from GitHub's copy of this repository.
 *
 * Every OneUptime serves its agents' install scripts and the files they
 * download at /install/<agent> (packages/Common/Types/InstallScripts lists
 * them; packages/App/FeatureSet/Install serves them), so an install command
 * names the reader's own OneUptime and gets the files of the release it
 * runs. GitHub's master branch is newer than most OneUptimes, and its
 * address names neither a self-hosted install's host nor its version.
 *
 * This reads every tracked text file for an address that downloads from
 * the repository on GitHub (raw.githubusercontent.com/OneUptime/oneuptime/
 * or github.com/OneUptime/oneuptime/raw/) and allows one only where it is
 * written on purpose, below, each with its reason and the number of times
 * it is written. Tests may name such an address to refuse it, or to stand
 * in for GitHub. A file that no longer names GitHub leaves the list, so the
 * list only shrinks.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadInstallScriptsCatalog } = require("./Utils/InstallScriptsCatalog");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The addresses that download a file of this repository from GitHub, in lower case.
const GITHUB_DOWNLOADS = [
  "raw.githubusercontent.com/oneuptime/oneuptime/",
  "github.com/oneuptime/oneuptime/raw/",
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".ejs",
  ".go",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".sh",
  ".tpl",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

// A test may name the address: to refuse it, or to answer for GitHub.
const TEST_FILE = /(?:^|\/)Tests\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/*
 * The agents' install scripts fall back to GitHub for one case only: a
 * OneUptime older than /install answers 404 (or its own page), and the
 * script then downloads the agent's files from its folder on GitHub, as
 * every script did before, so a command an older OneUptime shows keeps
 * working. Once, in the block "Where the agent's files come from"
 * (AgentInstallScriptsServed holds the block).
 */
const OLDER_ONEUPTIME_FALLBACK =
  "the fallback for a OneUptime older than /install, which answers 404: the agent's files then come from its GitHub folder, as before";

function agentsWithTheFallback() {
  const { INSTALL_SCRIPTS } = loadInstallScriptsCatalog();
  const allowed = {};

  for (const entry of INSTALL_SCRIPTS) {
    const script = path.join(
      REPO_ROOT,
      entry.sourceDirectory,
      entry.script || "",
    );

    if (
      entry.script &&
      entry.sourceDirectory.startsWith("agents/") &&
      fs.readFileSync(script, "utf8").includes("fetch_agent_file()")
    ) {
      allowed[`${entry.sourceDirectory}/${entry.script}`] = {
        times: 1,
        reason: OLDER_ONEUPTIME_FALLBACK,
      };
    }
  }

  return allowed;
}

const ALLOWED = {
  ...agentsWithTheFallback(),
  "HelmChart/Public/oneuptime/docs/troubleshooting.md": {
    times: 1,
    reason:
      "diagnose.sh looks into a OneUptime that is slow or down, so it cannot be downloaded from that OneUptime",
  },
};

function trackedTextFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }

  return result.stdout.split("\0").filter((file) => {
    return TEXT_FILE_EXTENSIONS.has(path.extname(file).toLowerCase());
  });
}

// How many times a text names an address that downloads from GitHub.
function timesNamed(text) {
  const lower = text.toLowerCase();
  let times = 0;

  for (const address of GITHUB_DOWNLOADS) {
    let at = lower.indexOf(address);

    while (at !== -1) {
      times++;
      at = lower.indexOf(address, at + address.length);
    }
  }

  return times;
}

describe("downloads from GitHub's copy of the repository", () => {
  const files = trackedTextFiles();
  const named = {};

  for (const file of files) {
    if (TEST_FILE.test(file)) {
      continue;
    }

    const absolute = path.join(REPO_ROOT, file);

    if (!fs.existsSync(absolute)) {
      continue;
    }

    const times = timesNamed(fs.readFileSync(absolute, "utf8"));

    if (times > 0) {
      named[file] = times;
    }
  }

  test("are found the way the files write them", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(
      timesNamed(
        "curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent/install.sh",
      ),
    ).toBe(1);
    expect(
      timesNamed(
        "https://RAW.githubusercontent.com/oneuptime/OneUptime/release/x.sh",
      ),
    ).toBe(1);
    expect(
      timesNamed("https://github.com/OneUptime/oneuptime/raw/master/x.sh"),
    ).toBe(1);
    // Reading the source on GitHub, another repository, or OneUptime itself are not downloads.
    expect(
      timesNamed(
        "https://github.com/OneUptime/oneuptime/tree/master/agents/ProxmoxAgent",
      ),
    ).toBe(0);
    expect(
      timesNamed(
        "https://raw.githubusercontent.com/OneUptime/back-to-metal/main/cover.jpg",
      ),
    ).toBe(0);
    expect(
      timesNamed(
        "curl -fsSL https://oneuptime.com/install/proxmox-agent -o install.sh",
      ),
    ).toBe(0);
  });

  test("are written only where they are allowed, as many times as allowed", () => {
    const unexpected = Object.entries(named)
      .filter(([file, times]) => {
        return !ALLOWED[file] || ALLOWED[file].times !== times;
      })
      .map(([file, times]) => {
        return `${file}: ${times} (allowed: ${ALLOWED[file] ? ALLOWED[file].times : 0})`;
      });

    expect(unexpected).toEqual([]);
  });

  test("every allowed file still writes one, so the list only shrinks", () => {
    const gone = Object.keys(ALLOWED).filter((file) => {
      return !named[file];
    });

    expect(gone).toEqual([]);
  });

  test("the agents that fall back to GitHub are the ones whose scripts download files", () => {
    expect(
      Object.keys(ALLOWED)
        .filter((file) => {
          return ALLOWED[file].reason === OLDER_ONEUPTIME_FALLBACK;
        })
        .sort(),
    ).toEqual([
      "agents/CephAgent/install.sh",
      "agents/DatabaseAgent/install.sh",
      "agents/DockerSwarmAgent/install.sh",
      "agents/HostAIAgent/install.sh",
      "agents/ProxmoxAgent/install.sh",
      "agents/StorageArrayAgent/install.sh",
      "agents/VMwareAgent/install.sh",
    ]);
  });
});
