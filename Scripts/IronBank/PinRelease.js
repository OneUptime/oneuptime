"use strict";

/**
 * Pins IronBank/App to one OneUptime release.
 *
 * Iron Bank does not build OneUptime from source. Its pipeline builds
 * IronBank/App/Dockerfile from the files beside it, without internet access,
 * and that Dockerfile copies /usr/src out of the release's Community Edition
 * image, which hardening_manifest.yaml lists as a resource pinned by digest
 * (IronBank/README.md). So moving the Iron Bank image to another release
 * changes seven values in two files, and this changes them together:
 *
 *   hardening_manifest.yaml  the first tag, the version label, and the
 *                            resource's tag and digest
 *   Dockerfile               the release stage's FROM, APP_VERSION, GIT_SHA
 *                            and the revision label
 *
 * The digest is the linux/amd64 image of the release's tag on Docker Hub.
 * APP_VERSION and GIT_SHA are read from that image's own environment, so the
 * Iron Bank image reports the version and commit the release does: a COPY
 * --from brings files and no environment, and without them the App says
 * "unknown" for both (packages/Common/Server/EnvironmentConfig.ts). The image
 * must also be the Community Edition: its com.oneuptime.edition label says so.
 *
 *   node Scripts/IronBank/PinRelease.js --version 14.0.101
 *   node Scripts/IronBank/PinRelease.js --version 14.0.101 --check
 *
 * --check changes nothing, and fails when the files are not pinned to that
 * release as Docker Hub has it. The Iron Bank Preflight workflow runs it on
 * pull requests, so a hand edit cannot leave a digest or a commit that is not
 * the release's. --dir points it at another copy of IronBank/App.
 *
 * Every value is found by a pattern that must match exactly once, so a file
 * whose layout drifted fails here instead of keeping the old release in one
 * place. Tests/Ops/IronBankApp.test.js runs `pin` on the real files.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DIRECTORY = path.join(REPO_ROOT, "IronBank", "App");

const REPOSITORY = "oneuptime/app";
const EDITION = "community";
const PLATFORM = { os: "linux", architecture: "amd64" };

const VERSION = /^\d+\.\d+\.\d+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

const INDEX_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];
const MANIFEST_TYPES = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
];

const ATTEMPTS = 4;

/*
 * The values a release changes, by file. `replace` gets the match's groups
 * and the release, and returns the line(s) that take the match's place.
 */
const FIELDS = {
  manifest: [
    {
      name: "the first tag",
      pattern: /^(tags:\n {2}- )"[^"\n]*"$/m,
      replace: (groups, release) => {
        return `${groups[1]}"${release.version}"`;
      },
    },
    {
      name: "the org.opencontainers.image.version label",
      pattern: /^( {2}org\.opencontainers\.image\.version: )"[^"\n]*"$/m,
      replace: (groups, release) => {
        return `${groups[1]}"${release.version}"`;
      },
    },
    {
      name: "the release resource",
      pattern:
        /^( {2}- tag: )"oneuptime\/app:[^"\n]*"(\n {4}url: )"docker:\/\/docker\.io\/oneuptime\/app@sha256:[0-9a-f]{64}"$/m,
      replace: (groups, release) => {
        return `${groups[1]}"${REPOSITORY}:${release.version}"${groups[2]}"docker://docker.io/${REPOSITORY}@${release.digest}"`;
      },
    },
  ],
  dockerfile: [
    {
      name: "the release stage",
      pattern: /^FROM oneuptime\/app:\S+ AS release$/m,
      replace: (groups, release) => {
        return `FROM ${REPOSITORY}:${release.version} AS release`;
      },
    },
    {
      name: "APP_VERSION",
      pattern: /^ENV APP_VERSION=\S*$/m,
      replace: (groups, release) => {
        return `ENV APP_VERSION=${release.version}`;
      },
    },
    {
      name: "GIT_SHA",
      pattern: /^ENV GIT_SHA=\S*$/m,
      replace: (groups, release) => {
        return `ENV GIT_SHA=${release.gitSha}`;
      },
    },
    {
      name: "the org.opencontainers.image.revision label",
      pattern: /^(LABEL org\.opencontainers\.image\.revision=)"[^"\n]*"$/m,
      replace: (groups, release) => {
        return `${groups[1]}"${release.gitSha}"`;
      },
    },
  ],
};

const FILES = {
  manifest: "hardening_manifest.yaml",
  dockerfile: "Dockerfile",
};

/**
 * The files' text pinned to a release.
 * @param {{manifest: string, dockerfile: string}} files - Their current text
 * @param {{version: string, digest: string, gitSha: string}} release
 * @returns {{manifest: string, dockerfile: string}}
 */
function pin(files, release) {
  if (!VERSION.test(release.version)) {
    throw new Error(`Not a release version: ${release.version}`);
  }
  if (!DIGEST.test(release.digest)) {
    throw new Error(`Not an image digest: ${release.digest}`);
  }
  if (!GIT_SHA.test(release.gitSha)) {
    throw new Error(`Not a commit: ${release.gitSha}`);
  }

  const pinned = {};
  for (const [file, fields] of Object.entries(FIELDS)) {
    let text = files[file];
    for (const field of fields) {
      const count = (text.match(new RegExp(field.pattern.source, "gm")) || [])
        .length;
      if (count !== 1) {
        throw new Error(
          `${FILES[file]}: expected ${field.name} once, found it ${count} times`,
        );
      }
      text = text.replace(field.pattern, (...groups) => {
        return field.replace(groups, release);
      });
    }
    pinned[file] = text;
  }

  return pinned;
}

/**
 * The digest of the linux/amd64 image a tag names: from its index when it
 * is a multi-platform tag, or the tag's own digest when it is one image.
 * @param {object} manifest - What the registry answered for the tag
 * @param {string|null} tagDigest - Its Docker-Content-Digest header
 * @returns {string}
 */
function platformDigest(manifest, tagDigest) {
  if (INDEX_TYPES.includes(manifest.mediaType) || manifest.manifests) {
    const entry = (manifest.manifests || []).find((candidate) => {
      const platform = candidate.platform || {};
      return (
        platform.os === PLATFORM.os &&
        platform.architecture === PLATFORM.architecture
      );
    });
    if (!entry) {
      throw new Error(
        `The release has no ${PLATFORM.os}/${PLATFORM.architecture} image`,
      );
    }
    return entry.digest;
  }

  if (!tagDigest || !DIGEST.test(tagDigest)) {
    throw new Error("The registry did not say the image's digest");
  }
  return tagDigest;
}

/**
 * What an image's config says about the release it is: its commit, after
 * checking it is the Community Edition of that version for linux/amd64.
 * @param {object} config - The image's config blob
 * @param {string} version - The release it must be
 * @returns {{gitSha: string}}
 */
function releaseEnvironment(config, version) {
  if (
    config.os !== PLATFORM.os ||
    config.architecture !== PLATFORM.architecture
  ) {
    throw new Error(
      `The image is for ${config.os}/${config.architecture}, not ${PLATFORM.os}/${PLATFORM.architecture}`,
    );
  }

  const settings = config.config || {};
  const environment = {};
  for (const entry of settings.Env || []) {
    const separator = entry.indexOf("=");
    if (separator > 0) {
      environment[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
  }
  const edition = (settings.Labels || {})["com.oneuptime.edition"];

  if (edition !== EDITION) {
    throw new Error(
      `The image is the ${edition || "unlabelled"} edition, not the ${EDITION} edition`,
    );
  }
  if (environment["APP_VERSION"] !== version) {
    throw new Error(
      `The image says APP_VERSION=${environment["APP_VERSION"]}, not ${version}`,
    );
  }
  if (!GIT_SHA.test(environment["GIT_SHA"] || "")) {
    throw new Error(
      `The image says GIT_SHA=${environment["GIT_SHA"]}, which is not a commit`,
    );
  }

  return { gitSha: environment["GIT_SHA"] };
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/*
 * GET, retrying network errors, 429s and 5xxs: Docker Hub has bad minutes.
 */
async function get(url, headers) {
  for (let attempt = 1; ; attempt++) {
    let response = null;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      if (attempt >= ATTEMPTS) {
        throw new Error(`GET ${url} failed: ${error.message}`);
      }
    }
    if (response && response.ok) {
      return response;
    }
    if (response) {
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= ATTEMPTS) {
        throw new Error(`GET ${url} answered HTTP ${response.status}`);
      }
    }
    await sleep(attempt * 2000);
  }
}

/**
 * The release as Docker Hub has it.
 * @param {string} version
 * @returns {Promise<{version: string, digest: string, gitSha: string}>}
 */
async function readRelease(version) {
  const token = (
    await (
      await get(
        `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REPOSITORY}:pull`,
      )
    ).json()
  ).token;
  const authorization = { Authorization: `Bearer ${token}` };
  const registry = `https://registry-1.docker.io/v2/${REPOSITORY}`;

  const tag = await get(`${registry}/manifests/${version}`, {
    ...authorization,
    Accept: [...INDEX_TYPES, ...MANIFEST_TYPES].join(", "),
  });
  const digest = platformDigest(
    await tag.json(),
    tag.headers.get("docker-content-digest"),
  );

  const manifest = await (
    await get(`${registry}/manifests/${digest}`, {
      ...authorization,
      Accept: MANIFEST_TYPES.join(", "),
    })
  ).json();
  // The blob is served from a CDN; fetch drops the Authorization header on
  // that cross-origin redirect.
  const config = await (
    await get(`${registry}/blobs/${manifest.config.digest}`, authorization)
  ).json();

  return { version, digest, ...releaseEnvironment(config, version) };
}

/**
 * @param {Array<string>} argv
 * @returns {{version: string, directory: string, check: boolean}}
 */
function parseArgs(argv) {
  const options = { version: "", directory: DEFAULT_DIRECTORY, check: false };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--version") {
      options.version = argv[++index] || "";
    } else if (argument === "--dir") {
      options.directory = path.resolve(argv[++index] || "");
    } else if (argument === "--check") {
      options.check = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!VERSION.test(options.version)) {
    throw new Error(
      "Usage: PinRelease.js --version <major.minor.patch> [--check] [--dir <IronBank/App>]",
    );
  }

  return options;
}

/*
 * The lines that differ between two versions of a file that `pin` produced
 * from one another (it replaces lines in place, so they line up).
 */
function changedLines(before, after) {
  const old = before.split("\n");
  return after
    .split("\n")
    .map((line, index) => {
      return line === old[index] ? null : `- ${old[index]}\n+ ${line}`;
    })
    .filter(Boolean);
}

async function main(argv) {
  const options = parseArgs(argv);
  const current = {};
  for (const [file, name] of Object.entries(FILES)) {
    current[file] = fs.readFileSync(path.join(options.directory, name), "utf8");
  }

  const release = await readRelease(options.version);
  const pinned = pin(current, release);
  const stale = Object.keys(FILES).filter((file) => {
    return pinned[file] !== current[file];
  });
  const summary = `${REPOSITORY}:${release.version} (${release.digest}, commit ${release.gitSha})`;

  if (options.check) {
    if (stale.length > 0) {
      for (const file of stale) {
        console.error(`${FILES[file]}:`);
        console.error(changedLines(current[file], pinned[file]).join("\n"));
      }
      console.error(
        `The Iron Bank files are not pinned to ${summary}. Run: node Scripts/IronBank/PinRelease.js --version ${release.version}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`The Iron Bank files are pinned to ${summary}.`);
    return;
  }

  for (const file of stale) {
    fs.writeFileSync(path.join(options.directory, FILES[file]), pinned[file]);
  }
  console.log(
    stale.length > 0
      ? `Pinned the Iron Bank files to ${summary}.`
      : `The Iron Bank files were already pinned to ${summary}.`,
  );
}

module.exports = {
  FILES,
  pin,
  platformDigest,
  releaseEnvironment,
  parseArgs,
  readRelease,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
