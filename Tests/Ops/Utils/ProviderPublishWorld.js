"use strict";

/**
 * A world to run Scripts/TerraformProvider/publish-terraform-provider.sh in,
 * end to end, with nothing outside it reached:
 *
 *  - the provider's repository is a bare git repository on disk, and the
 *    script's real git reaches it at the URLs it uses for GitHub (git's
 *    url.<base>.insteadOf);
 *  - GitHub is a stand-in `gh`, answering from a JSON state file of the
 *    repository's releases and their assets, as GitHub's REST API and gh's
 *    own commands answer, and logging every call;
 *  - GoReleaser is a stand-in that writes the release's assets, a zip per
 *    platform that is never the same bytes twice (as GoReleaser's are not),
 *    their SHA256SUMS and its signature;
 *  - the generator (`npm run generate-terraform-provider`) copies a provider
 *    tree the test writes; go, gpg and sleep are stand-ins that only log;
 *  - OneUptime's GitHub, for the release notes, is
 *    Utils/FakeOneUptimeGitHub.js over HTTP (GITHUB_API_URL).
 *
 * The script runs from a copy of it, with the Node.js files it runs, under a
 * project root of its own, so it generates, syncs and builds there.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const {
  fakeOneUptimeGitHub,
  serveFakeGitHub,
} = require("./FakeOneUptimeGitHub");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PROVIDER = "terraform-provider-oneuptime";
const REPOSITORY = "OneUptime/terraform-provider-oneuptime";
const TOKEN = "test-token";
const PLATFORMS = ["darwin_arm64", "linux_amd64"];
const MANIFEST =
  '{\n  "version": 1,\n  "metadata": {\n    "protocol_versions": ["6.0"]\n  }\n}\n';
// What the script keeps the provider repository's .gitignore holding.
const GITIGNORE = [
  "dist/",
  "builds/",
  "*.zip",
  "*.sig",
  "*SHA256SUMS*",
  "terraform-provider-oneuptime",
  "terraform-provider-oneuptime.exe",
  "",
].join("\n");

// The files the script runs, copied into the world's project root.
const SCRIPT_FILES = [
  "Scripts/TerraformProvider/publish-terraform-provider.sh",
  "Scripts/TerraformProvider/ProviderRelease.js",
  "Scripts/TerraformProvider/GenerateReleaseNotes.js",
  "Scripts/Release/GenerateReleaseNotes.js",
];

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assetsOf(version, { signature = true } = {}) {
  const files = new Map();
  for (const platform of PLATFORMS) {
    files.set(
      `${PROVIDER}_${version}_${platform}.zip`,
      Buffer.concat([
        Buffer.from(`zip of ${platform} ${version}\n`),
        crypto.randomBytes(32),
      ]),
    );
  }
  const manifestName = `${PROVIDER}_${version}_manifest.json`;
  const listed = [...files.keys(), manifestName].sort();
  const sumOf = (name) => {
    return sha256(
      name === manifestName ? Buffer.from(MANIFEST) : files.get(name),
    );
  };
  files.set(
    `${PROVIDER}_${version}_SHA256SUMS`,
    Buffer.from(
      listed
        .map((name) => {
          return `${sumOf(name)}  ${name}\n`;
        })
        .join(""),
    ),
  );
  if (signature) {
    files.set(`${PROVIDER}_${version}_SHA256SUMS.sig`, crypto.randomBytes(64));
  }
  return { files, manifestName };
}

/*
 * gh, as the script runs it. The state file holds the releases as GitHub's
 * REST API returns them, each asset with the path of its bytes. state.failures
 * fails the calls whose key contains `match`, `times` times, as GitHub does
 * when it is down; state.corruptUploads stores those assets as other bytes
 * than were uploaded.
 */
const FAKE_GH = String.raw`#!/usr/bin/env node
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const STATE = process.env.FAKE_GITHUB_STATE;
const REPOSITORY = "OneUptime/terraform-provider-oneuptime";
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
let logged = {};

function finish(status, out, err) {
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool: "gh", args, status, ...logged }) + "\n");
  if (out) {
    process.stdout.write(out);
  }
  if (err) {
    process.stderr.write(err + "\n");
  }
  process.exit(status);
}
function notFound() {
  finish(1, "", "gh: Not Found (HTTP 404)");
}
function publicOf(release) {
  return {
    ...release,
    assets: release.assets.map((asset) => {
      const { file, ...rest } = asset;
      return rest;
    }),
  };
}
function jq(filter, body) {
  if (!filter) {
    return JSON.stringify(body) + "\n";
  }
  const result = spawnSync("jq", ["-r", filter], { input: JSON.stringify(body), encoding: "utf8" });
  if (result.status !== 0) {
    finish(2, "", "fake gh: jq failed: " + result.stderr);
  }
  return result.stdout;
}
function byTag(tag) {
  // As gh finds a release by its tag: the published one, else a draft.
  return state.releases.find((release) => release.tag_name === tag && !release.draft) ||
    state.releases.find((release) => release.tag_name === tag && release.draft);
}
function store(release, name, buffer) {
  const directory = path.join(state.assetsDir, String(release.id));
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  fs.writeFileSync(file, buffer);
  return file;
}

let key = args.slice(0, 2).join(" ");
let method = "GET";
let endpoint = "";
let filter = "";
const headers = [];
const fields = {};
if (args[0] === "api") {
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-X" || arg === "--method") {
      method = args[++index];
    } else if (arg === "-H" || arg === "--header") {
      headers.push(args[++index]);
    } else if (arg === "-f" || arg === "--raw-field" || arg === "-F" || arg === "--field") {
      const [name, ...rest] = args[++index].split("=");
      let value = rest.join("=");
      if (arg === "-F" || arg === "--field") {
        if (value.startsWith("@")) {
          value = fs.readFileSync(value.slice(1), "utf8");
        } else if (value === "true" || value === "false") {
          value = value === "true";
        } else if (/^\d+$/.test(value)) {
          value = Number(value);
        }
      }
      fields[name] = value;
    } else if (arg === "--jq" || arg === "-q") {
      filter = args[++index];
    } else if (arg === "--paginate") {
      // One page holds them all here.
    } else if (!endpoint) {
      endpoint = arg;
    } else {
      finish(2, "", "fake gh: unexpected argument " + arg);
    }
  }
  key = "api " + method + " " + endpoint;
  logged = { method, endpoint, fields };
} else if (args[0] === "release") {
  key = "release " + args[1] + " " + args[2];
}

for (const failure of state.failures || []) {
  if (failure.times > 0 && key.includes(failure.match)) {
    failure.times -= 1;
    finish(1, "", "gh: " + (failure.message || "Bad Gateway (HTTP 502)"));
  }
}
// state.garble: calls answered, successfully, with what nothing can read.
for (const match of state.garble || []) {
  if (key.includes(match)) {
    finish(0, "this is not JSON\n");
  }
}

const releases = "repos/" + REPOSITORY + "/releases";
let match;
if (args[0] === "repo" && args[1] === "view") {
  finish(0, "name: " + REPOSITORY + "\n");
} else if (args[0] === "api") {
  if (method === "GET" && (match = endpoint.match(/^repos\/[^/]+\/[^/]+\/releases\/tags\/(.+)$/))) {
    const release = state.releases.find((each) => each.tag_name === match[1] && !each.draft);
    release ? finish(0, jq(filter, publicOf(release))) : notFound();
  } else if (method === "GET" && endpoint === releases + "?per_page=100") {
    finish(0, jq(filter, [...state.releases].reverse().map(publicOf)));
  } else if (method === "GET" && (match = endpoint.match(/^repos\/[^/]+\/[^/]+\/releases\/assets\/(\d+)$/))) {
    const asset = state.releases.flatMap((each) => each.assets).find((each) => String(each.id) === match[1]);
    if (!asset || !headers.includes("Accept: application/octet-stream")) {
      notFound();
    }
    finish(0, fs.readFileSync(asset.file, "utf8"));
  } else if (method === "GET" && (match = endpoint.match(/^repos\/[^/]+\/[^/]+\/releases\/(\d+)$/))) {
    const release = state.releases.find((each) => String(each.id) === match[1]);
    release ? finish(0, jq(filter, publicOf(release))) : notFound();
  } else if (method === "POST" && endpoint === releases) {
    const release = {
      id: state.nextId++,
      tag_name: fields.tag_name,
      name: fields.name,
      body: fields.body,
      draft: fields.draft === true,
      prerelease: fields.prerelease === true,
      assets: [],
    };
    state.releases.push(release);
    finish(0, jq(filter, publicOf(release)));
  } else if (method === "PATCH" && (match = endpoint.match(/^repos\/[^/]+\/[^/]+\/releases\/(\d+)$/))) {
    const release = state.releases.find((each) => String(each.id) === match[1]);
    if (!release) {
      notFound();
    }
    if (fields.draft === false) {
      release.draft = false;
      release.published_order = (state.publishedCount = (state.publishedCount || 0) + 1);
    }
    if (fields.make_latest !== undefined) {
      release.make_latest = fields.make_latest;
    }
    finish(0, jq(filter, publicOf(release)));
  } else if (method === "DELETE" && (match = endpoint.match(/^repos\/[^/]+\/[^/]+\/releases\/(\d+)$/))) {
    const index = state.releases.findIndex((each) => String(each.id) === match[1]);
    if (index === -1) {
      notFound();
    }
    state.releases.splice(index, 1);
    finish(0, "");
  } else {
    finish(2, "", "fake gh: no answer for " + method + " " + endpoint);
  }
} else if (args[0] === "release" && args[1] === "upload") {
  const [tag, file] = [args[2], args[3]];
  if (!args.includes("--repo") || args[args.indexOf("--repo") + 1] !== REPOSITORY) {
    finish(2, "", "fake gh: upload without --repo " + REPOSITORY);
  }
  const release = byTag(tag);
  if (!release) {
    finish(1, "", "release not found");
  }
  const name = path.basename(file);
  const existing = release.assets.findIndex((asset) => asset.name === name);
  if (existing !== -1 && !args.includes("--clobber")) {
    finish(1, "", "asset under the same name already exists: " + name);
  }
  let buffer = fs.readFileSync(file);
  if ((state.corruptUploads || []).includes(name)) {
    buffer = Buffer.concat([buffer, Buffer.from("corrupted")]);
  }
  const asset = {
    id: state.nextId++,
    name,
    size: buffer.length,
    digest: "sha256:" + crypto.createHash("sha256").update(buffer).digest("hex"),
    state: "uploaded",
    file: store(release, name, buffer),
  };
  if (existing !== -1) {
    release.assets.splice(existing, 1, asset);
  } else {
    release.assets.push(asset);
  }
  finish(0, "");
} else if (args[0] === "release" && args[1] === "list") {
  const listed = [...state.releases].reverse().map((release) => {
    return { tagName: release.tag_name, isDraft: release.draft, isPrerelease: release.prerelease };
  });
  finish(0, JSON.stringify(listed) + "\n");
} else {
  finish(2, "", "fake gh: no answer for " + args.join(" "));
}
`;

/*
 * goreleaser release --clean ...: the assets of GORELEASER_CURRENT_TAG's
 * version, from the tree it runs in. FAKE_GORELEASER_NO_SIGNATURE leaves the
 * signature out; FAKE_GORELEASER_PUBLISH_MEANWHILE publishes the version in
 * GitHub's state while it builds, as another run would.
 */
const FAKE_GORELEASER = String.raw`#!/usr/bin/env node
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const tag = process.env.GORELEASER_CURRENT_TAG || "";
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool: "goreleaser", args: process.argv.slice(2), tag, head, fingerprint: process.env.GPG_FINGERPRINT }) + "\n");
if (!/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error("fake goreleaser: GORELEASER_CURRENT_TAG is not a version: " + tag);
  process.exit(1);
}
const version = tag.slice(1);
const dist = path.join(process.cwd(), "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const lines = [];
for (const platform of ["darwin_arm64", "linux_amd64"]) {
  const name = "terraform-provider-oneuptime_" + version + "_" + platform + ".zip";
  const bytes = Buffer.concat([Buffer.from("zip of " + platform + " " + version + "\n"), crypto.randomBytes(32)]);
  fs.writeFileSync(path.join(dist, name), bytes);
  lines.push(sha(bytes) + "  " + name);
}
// As checksum.extra_files: listed, and not copied into dist/.
lines.push(sha(fs.readFileSync("terraform-registry-manifest.json")) + "  terraform-provider-oneuptime_" + version + "_manifest.json");
lines.sort((left, right) => left.split("  ")[1].localeCompare(right.split("  ")[1]));
fs.writeFileSync(path.join(dist, "terraform-provider-oneuptime_" + version + "_SHA256SUMS"), lines.join("\n") + "\n");
if (!process.env.FAKE_GORELEASER_NO_SIGNATURE) {
  fs.writeFileSync(path.join(dist, "terraform-provider-oneuptime_" + version + "_SHA256SUMS.sig"), crypto.randomBytes(64));
}
// What GoReleaser leaves in dist/ besides, which is never a release asset.
fs.writeFileSync(path.join(dist, "artifacts.json"), "[]");
fs.writeFileSync(path.join(dist, "metadata.json"), "{}");
if (process.env.FAKE_GORELEASER_PUBLISH_MEANWHILE) {
  const state = JSON.parse(fs.readFileSync(process.env.FAKE_GITHUB_STATE, "utf8"));
  state.releases.push({ id: state.nextId++, tag_name: tag, name: tag, body: "Published by another run.", draft: false, prerelease: false, assets: [] });
  fs.writeFileSync(process.env.FAKE_GITHUB_STATE, JSON.stringify(state, null, 2));
}
`;

// npm run generate-terraform-provider: the generator's output is the tree in FAKE_PROVIDER_SOURCE.
const FAKE_NPM = String.raw`#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool: "npm", args }) + "\n");
if (args.join(" ") !== "run generate-terraform-provider") {
  console.error("fake npm: " + args.join(" "));
  process.exit(2);
}
const terraform = path.join(process.cwd(), "Terraform");
fs.rmSync(terraform, { recursive: true, force: true });
fs.cpSync(process.env.FAKE_PROVIDER_SOURCE, path.join(terraform, "terraform-provider-oneuptime"), { recursive: true });
`;

const FAKE_GO = `#!/bin/sh
printf '{"tool":"go","args":"%s"}\\n' "$*" >> "$FAKE_LOG"
if [ "$1" = "version" ]; then
  echo "go version go1.25.4 linux/amd64"
fi
if [ "$1" = "test" ] && [ -n "$FAKE_GO_TEST_FAILS" ]; then
  echo "--- FAIL: TestSomething" >&2
  exit 1
fi
exit 0
`;

const FAKE_GPG = `#!/bin/sh
printf '{"tool":"gpg","args":"%s"}\\n' "$*" >> "$FAKE_LOG"
echo "sec   rsa4096/83F2C1DDF58A0524 2024-01-01 [SC]"
echo "      83F2C1DDF58A052464C4A1729D87E494AC016697"
`;

// sleep, without the wait: the retries are logged, in order with the calls.
const FAKE_SLEEP = `#!/bin/sh
printf '{"tool":"sleep","seconds":"%s"}\\n' "$1" >> "$FAKE_LOG"
`;

/**
 * A provider tree as the generator writes it, with these pages.
 * @param {string} version
 * @param {Object<string, string>} pages - path in docs/ to text
 * @param {Object<string, string>} [files] - more files, path to text
 * @returns {Object<string, string>}
 */
function providerTree(version, pages = {}, files = {}) {
  return {
    "main.go": "package main\n\nfunc main() {}\n",
    "go.mod":
      "module github.com/oneuptime/terraform-provider-oneuptime\n\ngo 1.24\n",
    ".goreleaser.yml": "version: 2\n",
    "terraform-registry-manifest.json": MANIFEST,
    VERSION: `${version}\n# This file is auto-generated from the root VERSION file.\n`,
    "README.md": "# OneUptime Terraform Provider\n",
    ...pages,
    ...files,
  };
}

function writeTree(directory, tree) {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [file, text] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), text);
  }
}

class ProviderPublishWorld {
  constructor() {
    this.work = fs.mkdtempSync(path.join(os.tmpdir(), "provider-publish-"));
    this.root = path.join(this.work, "root");
    this.bin = path.join(this.work, "bin");
    this.remote = path.join(this.work, "remote.git");
    this.source = path.join(this.work, "source");
    this.stateFile = path.join(this.work, "github.json");
    this.logFile = path.join(this.work, "calls.log");
    this.summaryFile = path.join(this.work, "summary.md");
    this.home = path.join(this.work, "home");
    this.runs = 0;

    fs.mkdirSync(this.home, { recursive: true });
    fs.mkdirSync(this.bin, { recursive: true });
    for (const [name, text] of Object.entries({
      gh: FAKE_GH,
      goreleaser: FAKE_GORELEASER,
      npm: FAKE_NPM,
      go: FAKE_GO,
      gpg: FAKE_GPG,
      sleep: FAKE_SLEEP,
    })) {
      fs.writeFileSync(path.join(this.bin, name), text, { mode: 0o755 });
    }

    // The project root: the scripts, a package.json, and a commit of its own.
    for (const file of SCRIPT_FILES) {
      fs.mkdirSync(path.dirname(path.join(this.root, file)), {
        recursive: true,
      });
      fs.copyFileSync(path.join(REPO_ROOT, file), path.join(this.root, file));
    }
    fs.writeFileSync(path.join(this.root, "package.json"), "{}\n");
    this.git(this.root, "init", "-q", "-b", "main");
    this.git(this.root, "add", "-A");
    this.git(
      this.root,
      "commit",
      "-q",
      "-m",
      "The OneUptime this provider is generated from",
    );
    this.rootCommit = this.git(this.root, "rev-parse", "HEAD");

    this.git(this.work, "init", "-q", "--bare", "-b", "master", this.remote);
    fs.writeFileSync(
      this.stateFile,
      JSON.stringify({
        nextId: 1000,
        releases: [],
        assetsDir: path.join(this.work, "assets"),
      }),
    );
    fs.writeFileSync(this.logFile, "");

    // OneUptime's repository as the release notes read it; a test fills it.
    this.oneUptime = { ranges: {}, pullRequestsOf: {}, releases: [] };
    this.oneUptimeGitHub = fakeOneUptimeGitHub(this.oneUptime);
    this.server = null;
  }

  // Serves OneUptime's stand-in GitHub, which every run's notes ask.
  async start() {
    this.server = await serveFakeGitHub(this.oneUptimeGitHub);
    return this;
  }

  git(cwd, ...args) {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...this.gitEnvironment(),
        PATH: process.env.PATH,
        HOME: this.home,
      },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  // git as the script runs it: no configuration of the machine's, and the
  // provider's GitHub URLs on the bare repository.
  gitEnvironment() {
    const remote = `file://${this.remote}`;
    return {
      ...GIT_IDENTITY,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`,
      GIT_CONFIG_VALUE_0: `https://github.com/${REPOSITORY}.git`,
      GIT_CONFIG_KEY_1: `url.${remote}.insteadOf`,
      GIT_CONFIG_VALUE_1: `https://x-access-token:${TOKEN}@github.com/${REPOSITORY}.git`,
    };
  }

  /*
   * A release published by an earlier run: its tree on master, tagged, and
   * on GitHub with every asset. `message` is its commit's.
   */
  seedRelease(version, tree, { message, oneUptimeCommit } = {}) {
    const checkout = path.join(this.work, `seed-${version}`);
    if (!fs.existsSync(checkout)) {
      this.git(this.work, "clone", "-q", this.remote, checkout);
    }
    for (const file of this.git(checkout, "ls-files")
      .split("\n")
      .filter(Boolean)) {
      fs.rmSync(path.join(checkout, file));
    }
    // The repository's own .gitignore, as the script's first run left it.
    for (const [file, text] of Object.entries({
      ...tree,
      ".gitignore": GITIGNORE,
    })) {
      fs.mkdirSync(path.dirname(path.join(checkout, file)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(checkout, file), text);
    }
    this.git(checkout, "add", "-A");
    const trailer = oneUptimeCommit
      ? `\n\nOneUptime-Commit: ${oneUptimeCommit}`
      : "";
    this.git(
      checkout,
      "commit",
      "-q",
      "-m",
      message || `chore: generate provider for version v${version}${trailer}`,
    );
    this.git(checkout, "tag", "-a", `v${version}`, "-m", `Release v${version}`);
    this.git(checkout, "push", "-q", "origin", "HEAD:master", `v${version}`);
    fs.rmSync(checkout, { recursive: true, force: true });

    this.publishOnGitHub(`v${version}`);
  }

  // A published release of `tag` on GitHub, with a whole set of assets.
  publishOnGitHub(tag, { draft = false } = {}) {
    const state = this.state();
    const release = {
      id: state.nextId++,
      tag_name: tag,
      name: tag,
      body: `The notes of ${tag}.`,
      draft,
      prerelease: false,
      assets: [],
    };
    const { files } = assetsOf(tag.slice(1));
    files.set(
      `${PROVIDER}_${tag.slice(1)}_manifest.json`,
      Buffer.from(MANIFEST),
    );
    for (const [name, buffer] of files) {
      const directory = path.join(state.assetsDir, String(release.id));
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, name), buffer);
      release.assets.push({
        id: state.nextId++,
        name,
        size: buffer.length,
        digest: `sha256:${sha256(buffer)}`,
        state: "uploaded",
        file: path.join(directory, name),
      });
    }
    state.releases.push(release);
    this.writeState(state);
    return release;
  }

  // What the generator writes on the next run.
  generates(version, pages, files) {
    writeTree(this.source, providerTree(version, pages, files));
  }

  state() {
    return JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
  }

  writeState(state) {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  changeState(change) {
    const state = this.state();
    change(state);
    this.writeState(state);
  }

  releasesOf(tag) {
    return this.state().releases.filter((release) => {
      return release.tag_name === tag;
    });
  }

  remoteRef(ref) {
    const line = this.git(
      this.work,
      "--git-dir",
      this.remote,
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    );
    return line || null;
  }

  remoteRefOrNull(ref) {
    try {
      return this.remoteRef(ref);
    } catch {
      return null;
    }
  }

  commitMessage(ref) {
    return this.git(
      this.work,
      "--git-dir",
      this.remote,
      "log",
      "-1",
      "--format=%B",
      ref,
    );
  }

  calls() {
    return fs
      .readFileSync(this.logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        return JSON.parse(line);
      });
  }

  // The dist/ the last build wrote, name to SHA-256: what a release must hold.
  built() {
    const dist = path.join(this.root, "Terraform", PROVIDER, "dist");
    return new Map(
      fs
        .readdirSync(dist)
        .filter((name) => {
          return /(\.zip|_SHA256SUMS|_SHA256SUMS\.sig|_manifest\.json)$/.test(
            name,
          );
        })
        .map((name) => {
          return [name, sha256(fs.readFileSync(path.join(dist, name)))];
        }),
    );
  }

  /**
   * Runs the script, as release.yml does, with these arguments.
   * @param {Array<string>} args - after --github-token
   * @param {Object} [options]
   * @param {Object} [options.env] - more environment; a key set to
   *        undefined is left out
   * @param {boolean} [options.withToken]
   * @returns {Promise<{status: number, stdout: string, stderr: string, output: string, calls: Array}>}
   */
  run(args, { env = {}, withToken = true } = {}) {
    this.runs += 1;
    fs.writeFileSync(this.logFile, "");
    fs.writeFileSync(this.summaryFile, "");

    const environment = {
      PATH: `${this.bin}${path.delimiter}${process.env.PATH}`,
      HOME: this.home,
      LANG: "C.UTF-8",
      TMPDIR: os.tmpdir(),
      ...this.gitEnvironment(),
      FAKE_GITHUB_STATE: this.stateFile,
      FAKE_LOG: this.logFile,
      FAKE_PROVIDER_SOURCE: this.source,
      GITHUB_STEP_SUMMARY: this.summaryFile,
      // Never GitHub itself: the notes ask the stand-in.
      GITHUB_API_URL: this.server.url,
      ...env,
    };
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) {
        delete environment[name];
      }
    }

    const script = path.join(this.root, SCRIPT_FILES[0]);
    const fullArgs = [
      script,
      ...args,
      ...(withToken ? ["--github-token", TOKEN] : []),
    ];

    return new Promise((resolve) => {
      const child = spawn("bash", fullArgs, {
        cwd: this.root,
        env: environment,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (status) => {
        // Without the colours, so a test reads the words.
        const plain = (text) => {
          return text.replace(/\x1b\[[0-9;]*m/g, "");
        };
        resolve({
          status,
          stdout: plain(stdout),
          stderr: plain(stderr),
          output: plain(stdout + stderr),
          calls: this.calls(),
          summary: fs.readFileSync(this.summaryFile, "utf8"),
        });
      });
    });
  }

  async remove() {
    if (this.server) {
      await this.server.close();
    }
    fs.rmSync(this.work, { recursive: true, force: true });
  }
}

/*
 * The calls of one tool in a run, and the GitHub calls that change
 * something: anything but a read.
 */
function callsOf(result, tool) {
  return result.calls.filter((call) => {
    return call.tool === tool;
  });
}

function writesToGitHub(result) {
  return callsOf(result, "gh").filter((call) => {
    if (call.args[0] === "api") {
      return call.method !== "GET";
    }
    return (
      call.args[0] === "release" &&
      !["list", "view", "download"].includes(call.args[1])
    );
  });
}

module.exports = {
  PLATFORMS,
  PROVIDER,
  REPOSITORY,
  TOKEN,
  ProviderPublishWorld,
  callsOf,
  providerTree,
  writesToGitHub,
};
