#!/usr/bin/env node

/*
 * The toolchain every release build of the Terraform provider and the
 * infrastructure agent uses: Go, GoReleaser and syft, each pinned to an exact
 * version in .github/actions/setup-release-toolchain/versions.env, which that
 * action installs (#11464).
 *
 *   node Scripts/Release/ReleaseToolchain.js describe [--with-syft]
 *       The toolchain as a release's notes name it: "Go 1.27.4, GoReleaser
 *       v2.20.3 and syft v1.57.2".
 *   node Scripts/Release/ReleaseToolchain.js check [--keep-issue]
 *       Which pins are behind (findStalePins says what that means), from
 *       go.dev and GitHub's releases. --keep-issue keeps the one issue that
 *       lists them, as the weekly Release Toolchain Pins workflow runs it
 *       (GH_TOKEN and GH_REPO set): opens it when something is behind,
 *       rewrites it while it is open, and closes it, saying so, once nothing
 *       is. A pin that is behind fails nothing, the issue says so; it fails
 *       when the releases cannot be read.
 *
 * Pinned, a version built again from its tag weeks later is built the same
 * way, and so is the same bytes (the builds are reproducible:
 * agents/InfrastructureAgent/.goreleaser.yaml and the provider's, written by
 * Scripts/TerraformProvider/Core/TerraformProviderGenerator.ts). But a pin
 * left alone ages a toolchain that builds programs making HTTPS calls, so
 * this says when one falls behind. No update bot reads the pins: the
 * repository runs neither Renovate nor Dependabot.
 *
 * Tests/Ops/ReleaseToolchain.test.js tests it, and holds every release build
 * to the pins.
 */

"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const PINS_FILE = ".github/actions/setup-release-toolchain/versions.env";

const ISSUE_TITLE =
  "Release toolchain: a pinned Go, GoReleaser or syft is behind";
// The labels it is opened with: the ones #11464, which asked for it, has.
const ISSUE_LABELS = ["follow-up", "enhancement"];

const GO_RELEASES = "https://go.dev/dl/?mode=json";
const GITHUB_API = "https://api.github.com";

/*
 * Each pin: its variable in versions.env, the shape it must have (an exact
 * version: a range would move), and where its releases are.
 */
const PINS = [
  {
    key: "go",
    name: "Go",
    variable: "GO_VERSION",
    shape: /^\d+\.\d+\.\d+$/,
  },
  {
    key: "goreleaser",
    name: "GoReleaser",
    variable: "GORELEASER_VERSION",
    shape: /^v2\.\d+\.\d+$/,
    repository: "goreleaser/goreleaser",
  },
  {
    key: "syft",
    name: "syft",
    variable: "SYFT_VERSION",
    shape: /^v\d+\.\d+\.\d+$/,
    repository: "anchore/syft",
  },
];

/*
 * The pins as versions.env has them, as the action reads it: NAME=value
 * lines, the last one of a name winning, a comment after the value allowed.
 */
function parsePins(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([A-Z_]+)=([^\s#]*)/.exec(line);
    if (match) {
      values[match[1]] = match[2];
    }
  }
  const pins = {};
  for (const pin of PINS) {
    const value = values[pin.variable];
    if (!value || !pin.shape.test(value)) {
      throw new Error(
        `${PINS_FILE} gives ${pin.variable} "${value || ""}", and it must be an exact version, as ${pin.shape}`,
      );
    }
    pins[pin.key] = value;
  }
  return pins;
}

function readPins(root = REPOSITORY_ROOT) {
  return parsePins(fs.readFileSync(path.join(root, PINS_FILE), "utf8"));
}

/*
 * The toolchain as a release's notes name it. `go` is a version, with or
 * without go's own "go" before it, the others with their "v".
 */
function describeToolchain({ go, goreleaser, syft }) {
  const parts = [
    `Go ${String(go).replace(/^go/, "")}`,
    `GoReleaser ${goreleaser.startsWith("v") ? goreleaser : `v${goreleaser}`}`,
  ];
  if (syft) {
    parts.push(`syft ${syft.startsWith("v") ? syft : `v${syft}`}`);
  }
  return parts.length === 2
    ? `${parts[0]} and ${parts[1]}`
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(
    String(version).replace(/^go/, ""),
  );
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

function newest(versions) {
  return versions
    .filter((version) => {
      return versionParts(version) !== null;
    })
    .sort(compareVersions)
    .pop();
}

/*
 * What each pin should be at: Go, the newest release of the pinned minor
 * while Go still supports it (go.dev lists the supported ones: security
 * fixes come to both), else the newest of all; GoReleaser and syft, their
 * newest release of the pinned major (a new major renames what the config
 * says, and is a move of its own).
 *
 * `releases` is { go: [x.y.z...] as go.dev lists the stable ones,
 * goreleaser: [tags], syft: [tags] }, each tag a published, not
 * pre-released one. Returns [{ name, variable, pinned, newest, why }].
 */
function findStalePins(pins, releases) {
  const stale = [];

  const goReleases = (releases.go || []).map((version) => {
    return String(version).replace(/^go/, "");
  });
  const [major, minor] = versionParts(pins.go);
  const sameMinor = goReleases.filter((version) => {
    const parts = versionParts(version);
    return parts && parts[0] === major && parts[1] === minor;
  });
  const goTarget = newest(sameMinor) || newest(goReleases);
  if (goTarget && compareVersions(goTarget, pins.go) > 0) {
    stale.push({
      name: "Go",
      variable: "GO_VERSION",
      pinned: pins.go,
      newest: goTarget,
      why:
        sameMinor.length > 0
          ? `Go ${goTarget} is the newest release of Go ${major}.${minor}`
          : `Go ${major}.${minor} is no longer supported, and Go ${goTarget} is the newest release`,
    });
  }

  for (const pin of PINS.filter((candidate) => {
    return candidate.repository;
  })) {
    const pinnedMajor = versionParts(pins[pin.key])[0];
    const target = newest(
      (releases[pin.key] || []).filter((tag) => {
        const parts = versionParts(tag);
        return /^v/.test(tag) && parts && parts[0] === pinnedMajor;
      }),
    );
    if (target && compareVersions(target, pins[pin.key]) > 0) {
      stale.push({
        name: pin.name,
        variable: pin.variable,
        pinned: pins[pin.key],
        newest: target,
        why: `${pin.name} ${target} is its newest v${pinnedMajor} release`,
      });
    }
  }

  return stale;
}

function renderIssue(stale, runUrl) {
  return [
    `The release toolchain pinned in \`${PINS_FILE}\` is behind (#11464):`,
    "",
    "| Tool | Pinned | Newest | Why |",
    "| --- | --- | --- | --- |",
    ...stale.map((pin) => {
      return `| ${pin.name} (\`${pin.variable}\`) | ${pin.pinned} | ${pin.newest} | ${pin.why} |`;
    }),
    "",
    "Every release build of the Terraform provider and the infrastructure agent installs these (`.github/actions/setup-release-toolchain`), so a security fix in one reaches them only once the pin moves.",
    "",
    "**To move a pin:** change it in `versions.env`, in a pull request of its own. The Terraform Provider Generation and Infrastructure Agent Test workflows install it and build the provider and the agent twice, which must give the same bytes. A release built with the new pin names it in its notes.",
    "",
    runUrl
      ? `This issue is kept by the [Release Toolchain Pins](${runUrl}) workflow, which closes it once no pin is behind.`
      : "This issue is kept by the Release Toolchain Pins workflow, which closes it once no pin is behind.",
  ].join("\n");
}

/*
 * What to do with the issue: create it, update it, close it, or nothing.
 */
function issueAction(openIssue, stale) {
  if (stale.length > 0) {
    return openIssue ? "update" : "create";
  }
  return openIssue ? "close" : "none";
}

async function fetchJson(url, { token, fetchImpl = fetch } = {}) {
  const headers = { "User-Agent": "oneuptime-release-toolchain" };
  if (token && url.startsWith(GITHUB_API)) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response.json();
}

// The releases findStalePins reads, from go.dev and GitHub.
async function fetchReleases({ token, fetchImpl } = {}) {
  const go = (await fetchJson(GO_RELEASES, { fetchImpl }))
    .filter((release) => {
      return release.stable;
    })
    .map((release) => {
      return String(release.version).replace(/^go/, "");
    });
  const releases = { go };
  for (const pin of PINS.filter((candidate) => {
    return candidate.repository;
  })) {
    releases[pin.key] = (
      await fetchJson(
        `${GITHUB_API}/repos/${pin.repository}/releases?per_page=100`,
        {
          token,
          fetchImpl,
        },
      )
    )
      .filter((release) => {
        return !release.draft && !release.prerelease;
      })
      .map((release) => {
        return release.tag_name;
      });
  }
  return releases;
}

// The open issue with exactly the title, or null. `gh` runs gh, its output back.
function findOpenIssue(gh) {
  const listed = JSON.parse(
    gh([
      "issue",
      "list",
      "--state",
      "open",
      "--search",
      `"${ISSUE_TITLE}" in:title`,
      "--json",
      "number,title",
      "--limit",
      "20",
    ]) || "[]",
  );
  const issue = listed.find((candidate) => {
    return candidate.title === ISSUE_TITLE;
  });
  return issue ? issue.number : null;
}

function keepIssue({ stale, gh, bodyFile }) {
  const openIssue = findOpenIssue(gh);
  const action = issueAction(openIssue, stale);
  if (action === "create") {
    gh([
      "issue",
      "create",
      "--title",
      ISSUE_TITLE,
      "--body-file",
      bodyFile,
      ...ISSUE_LABELS.flatMap((label) => {
        return ["--label", label];
      }),
    ]);
  } else if (action === "update") {
    gh(["issue", "edit", String(openIssue), "--body-file", bodyFile]);
  } else if (action === "close") {
    gh([
      "issue",
      "close",
      String(openIssue),
      "--comment",
      "Go, GoReleaser and syft are each at their newest release again.",
    ]);
  }
  return { action, openIssue };
}

/*
 * Runs a command; returns its exit code. `tools` stands in for the world in
 * tests: root, out, err, env, fetchImpl, gh.
 */
async function main(argv, tools = {}) {
  const out = tools.out || process.stdout;
  const err = tools.err || process.stderr;
  const env = tools.env || process.env;
  const say = (line) => {
    out.write(`${line}\n`);
  };
  const [command, ...flags] = argv;

  if (command === "describe") {
    const pins = readPins(tools.root);
    say(
      describeToolchain({
        go: pins.go,
        goreleaser: pins.goreleaser,
        syft: flags.includes("--with-syft") ? pins.syft : null,
      }),
    );
    return 0;
  }

  if (command === "check") {
    const pins = readPins(tools.root);
    const stale = findStalePins(
      pins,
      await fetchReleases({
        token: env.GH_TOKEN || env.GITHUB_TOKEN,
        fetchImpl: tools.fetchImpl,
      }),
    );
    if (stale.length === 0) {
      say(`Every pin is at its newest release: ${describeToolchain(pins)}.`);
    } else {
      for (const pin of stale) {
        say(`${pin.name}: ${pin.pinned} -> ${pin.newest} (${pin.why})`);
      }
    }
    if (!flags.includes("--keep-issue")) {
      return 0;
    }
    const runUrl =
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : undefined;
    const bodyFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "release-toolchain-")),
      "issue.md",
    );
    fs.writeFileSync(bodyFile, renderIssue(stale, runUrl));
    const gh =
      tools.gh ||
      ((args) => {
        return execFileSync("gh", args, { encoding: "utf8" });
      });
    const { action, openIssue } = keepIssue({ stale, gh, bodyFile });
    say(
      {
        create: "Opened the issue.",
        update: `Rewrote issue #${openIssue}.`,
        close: `Closed issue #${openIssue}.`,
        none: "No issue to keep.",
      }[action],
    );
    return 0;
  }

  err.write(
    "Usage:\n  ReleaseToolchain.js describe [--with-syft]\n  ReleaseToolchain.js check [--keep-issue]\n",
  );
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`ReleaseToolchain: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  ISSUE_LABELS,
  ISSUE_TITLE,
  PINS_FILE,
  describeToolchain,
  fetchReleases,
  findOpenIssue,
  findStalePins,
  issueAction,
  keepIssue,
  main,
  parsePins,
  readPins,
  renderIssue,
};
