#!/usr/bin/env node

/*
 * Attaches files to this release run's own draft of OneUptime's GitHub
 * release, by the draft's id, and never to a published release
 * (finalize-github-release in .github/workflows/release.yml, #11466):
 *
 *   node Scripts/Release/AttachReleaseAssets.js --repository OneUptime/oneuptime \
 *     --release-id <id> --tag <version> [--when-published skip|verify-checksums] \
 *     <file>...
 *
 * A published release is never changed. The apt and yum indexes, the
 * Homebrew cask and the winget manifest record the SHA-256 of the
 * infrastructure agent's packages and archives on it, and keep them: a
 * release whose files were uploaded again with other bytes would fail every
 * install from them, as the Terraform provider's did (#11016). The release
 * used to be filled by softprops/action-gh-release, by its tag, which finds a
 * published release of the tag before a draft, and replaced each asset of the
 * same name on it: so a second release run of a published version would have
 * uploaded its own build over the published one.
 *
 * On a draft, each file is uploaded to the draft's own upload URL, by its id,
 * one at a time. Before each, the draft is read again, by its id, and
 * ReleaseAssets.uploadPlan says what to do: keep a file the draft holds whole
 * with the same bytes, upload one it does not hold, or replace one whose
 * upload did not finish (deleting it by its asset id first). A failed upload
 * is planned again from what GitHub holds, so an answer that was lost is not
 * sent twice. Once every file is there, the draft is read again and each file
 * must be on it, whole, with the size and SHA-256 it was built with.
 *
 * On a published release (a release run repeated for a version, or re-run
 * after it published), nothing is uploaded, and --when-published says what
 * the run does instead:
 *
 *   skip              say so, and succeed: the SBOMs and reports of the run
 *                     that published it stay as they are;
 *   verify-checksums  succeed only when the release holds the checksums file
 *                     among <file>s, byte for byte, and every file it lists,
 *                     each with the SHA-256 it lists: the files this run built
 *                     are the published ones, so the package managers this
 *                     run publishes to get the release's own checksums. A
 *                     second build of the same commit is the same bytes
 *                     (agents/InfrastructureAgent/.goreleaser.yaml);
 *   (none)            refuse, and fail.
 *
 * It reads GITHUB_TOKEN (or GH_TOKEN) and GITHUB_API_URL, as Actions sets
 * them. Tests/Ops/AttachReleaseAssets.test.js runs it against a stand-in
 * GitHub (GITHUB_UPLOADS_URL is where it sends what GitHub's upload URL
 * names, and ATTACH_RELEASE_ASSETS_DELAYS how long it waits between tries).
 */

"use strict";

const fs = require("fs");

const {
  assetsByName,
  describeFile,
  differencesFromFiles,
  isDraft,
  parseSums,
  sha256OfAsset,
  uploadPlan,
} = require("./ReleaseAssets");

const USAGE = `Usage:
  AttachReleaseAssets.js --repository <owner/name> --release-id <id> --tag <tag>
                         [--when-published skip|verify-checksums] <file>...`;

const WHEN_PUBLISHED = ["skip", "verify-checksums"];

// The seconds between one try and the next: three more tries after the first.
const DEFAULT_DELAYS = [5, 15, 30];

class UsageError extends Error {}

function parseArguments(argv) {
  const options = {
    repository: "",
    releaseId: "",
    tag: "",
    whenPublished: "",
    files: [],
  };
  const flags = {
    "--repository": "repository",
    "--release-id": "releaseId",
    "--tag": "tag",
    "--when-published": "whenPublished",
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (flags[argument]) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${argument} needs a value`);
      }
      options[flags[argument]] = value;
      index++;
    } else if (argument.startsWith("--")) {
      throw new UsageError(`unknown option ${argument}`);
    } else {
      options.files.push(argument);
    }
  }

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new UsageError("--repository must be <owner>/<name>");
  }
  if (!/^\d+$/.test(options.releaseId)) {
    throw new UsageError(
      `--release-id must be the draft's id, a number (got "${options.releaseId}")`,
    );
  }
  if (!options.tag) {
    throw new UsageError("--tag is needed");
  }
  if (
    options.whenPublished &&
    !WHEN_PUBLISHED.includes(options.whenPublished)
  ) {
    throw new UsageError(
      `--when-published is ${WHEN_PUBLISHED.join(" or ")} (got "${options.whenPublished}")`,
    );
  }
  if (options.files.length === 0) {
    throw new UsageError("name at least one file to attach");
  }
  return options;
}

function delaysFrom(env) {
  if (env.ATTACH_RELEASE_ASSETS_DELAYS === undefined) {
    return DEFAULT_DELAYS;
  }
  return env.ATTACH_RELEASE_ASSETS_DELAYS.split(",").map(Number);
}

/*
 * The files to attach, each as describeFile has it, with its path. A file
 * that is not there (a glob that matched nothing) stops the run, as a release
 * missing one of its files must not be published; so does a name given twice.
 */
function filesToAttach(paths) {
  const seen = new Set();
  return paths.map((file) => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new UsageError(`${file} is not a file: nothing was built there`);
    }
    const described = { ...describeFile(file), path: file };
    if (seen.has(described.name)) {
      throw new UsageError(`${described.name} is named twice`);
    }
    seen.add(described.name);
    return described;
  });
}

class GitHub {
  constructor({ token, apiUrl, uploadsUrl, fetchImpl }) {
    this.token = token;
    this.apiUrl = String(apiUrl || "https://api.github.com").replace(
      /\/+$/,
      "",
    );
    this.uploadsUrl = uploadsUrl ? String(uploadsUrl).replace(/\/+$/, "") : "";
    this.fetch = fetchImpl || fetch;
  }

  headers(extra = {}) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "oneuptime-release",
      ...extra,
    };
  }

  // Where GitHub's upload URL points, or the stand-in a test gives.
  uploadTarget(url) {
    if (!this.uploadsUrl) {
      return url;
    }
    const parsed = new URL(url);
    return `${this.uploadsUrl}${parsed.pathname}${parsed.search}`;
  }

  async request(method, url, { body, headers } = {}) {
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: this.headers(headers),
        body,
      });
    } catch (error) {
      return {
        status: 0,
        text: String(error && error.message ? error.message : error),
      };
    }
    const text = await response.text().catch(() => {
      return "";
    });
    return { status: response.status, text };
  }

  async release(repository, id) {
    return this.request(
      "GET",
      `${this.apiUrl}/repos/${repository}/releases/${id}`,
    );
  }

  async deleteAsset(repository, assetId) {
    return this.request(
      "DELETE",
      `${this.apiUrl}/repos/${repository}/releases/assets/${assetId}`,
    );
  }

  async upload(url, file) {
    const body = fs.readFileSync(file.path);
    return this.request("POST", this.uploadTarget(url), {
      body,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
      },
    });
  }
}

// What GitHub said, for a message: its own message when it gave one.
function said(answer) {
  if (answer.status === 0) {
    return `no answer (${answer.text})`;
  }
  try {
    const parsed = JSON.parse(answer.text);
    if (parsed && parsed.message) {
      return `HTTP ${answer.status}: ${parsed.message}`;
    }
  } catch {
    // Not JSON: say what it was.
  }
  return `HTTP ${answer.status}${answer.text ? `: ${answer.text.slice(0, 200)}` : ""}`;
}

function transient(answer) {
  return (
    answer.status === 0 ||
    answer.status === 429 ||
    answer.status >= 500 ||
    // GitHub's answer when a request's rate limit is spent.
    (answer.status === 403 && /rate limit/i.test(answer.text))
  );
}

/*
 * The release, by its id, as GitHub has it now: { release } or { problem }.
 * A transient failure is tried again; a release that is gone, or that is
 * not the version's, is a problem.
 */
async function readRelease(github, options, delays, wait, log) {
  for (let attempt = 0; ; attempt++) {
    const answer = await github.release(options.repository, options.releaseId);
    if (answer.status === 200) {
      let release;
      try {
        release = JSON.parse(answer.text);
      } catch {
        return {
          problem: `GitHub answered release ${options.releaseId} with no release`,
        };
      }
      if (release.tag_name !== options.tag) {
        return {
          problem: `release ${options.releaseId} is ${release.tag_name || "no version"}'s, not ${options.tag}'s`,
        };
      }
      return { release };
    }
    if (answer.status === 404) {
      return {
        problem: `release ${options.releaseId} of ${options.repository} is gone (${said(answer)})`,
      };
    }
    if (!transient(answer) || attempt >= delays.length) {
      return {
        problem: `could not read release ${options.releaseId} of ${options.repository}: ${said(answer)}`,
      };
    }
    log(
      `Reading release ${options.releaseId} failed (${said(answer)}); trying again in ${delays[attempt]}s.`,
    );
    await wait(delays[attempt]);
  }
}

/*
 * Whether a published release holds the files this run built, as their
 * checksums file lists them: [] when it holds that file, byte for byte, and
 * every file it lists, each with the SHA-256 it lists.
 */
function differencesFromChecksums(release, files) {
  const sumsFiles = files.filter((file) => {
    return /_checksums\.txt$/.test(file.name);
  });
  if (sumsFiles.length !== 1) {
    return [
      `this run built ${sumsFiles.length} checksums files (*_checksums.txt), so there is nothing to compare the release with`,
    ];
  }
  const sumsFile = sumsFiles[0];
  const differences = differencesFromFiles(release, [sumsFile]);
  const assets = assetsByName(release);
  const sums = parseSums(fs.readFileSync(sumsFile.path, "utf8"));
  if (sums.size === 0) {
    differences.push(`${sumsFile.name} lists no file`);
  }
  for (const [name, expected] of sums) {
    const asset = assets.get(name);
    if (!asset) {
      differences.push(`${name} is not on it, and ${sumsFile.name} lists it`);
      continue;
    }
    const actual = sha256OfAsset(asset);
    if (!actual) {
      differences.push(
        `GitHub keeps no SHA-256 of its ${name}, so it cannot be compared`,
      );
    } else if (actual !== expected) {
      differences.push(
        `its ${name} has SHA-256 ${actual}, and this run built ${expected}`,
      );
    }
  }
  if (!sha256OfAsset(assets.get(sumsFile.name)) && assets.has(sumsFile.name)) {
    differences.push(
      `GitHub keeps no SHA-256 of its ${sumsFile.name}, so it cannot be compared`,
    );
  }
  return differences;
}

/*
 * Attaches one file to the draft, never over a published release: the plan
 * is made again from the draft as GitHub has it before each try.
 */
async function attachFile(github, options, file, delays, wait, log) {
  for (let attempt = 0; ; attempt++) {
    const read = await readRelease(github, options, delays, wait, log);
    if (read.problem) {
      return { problem: read.problem };
    }
    const plan = uploadPlan(read.release, [file], {
      published:
        "it was published while this run filled it, and a published release is never changed",
    });
    if (plan.refused) {
      return {
        problem: `not attaching ${file.name} to release ${options.releaseId}: ${plan.refused}`,
      };
    }
    const step = plan.steps[0];
    if (step.action === "keep") {
      log(`✓ ${file.name} is on draft ${options.releaseId} already`);
      return {};
    }

    let answer = { status: 200, text: "" };
    if (step.action === "replace") {
      log(
        `Draft ${options.releaseId} holds an upload of ${file.name} that did not finish, or other bytes (asset ${step.assetId}): replacing it`,
      );
      answer = await github.deleteAsset(options.repository, step.assetId);
      if (answer.status === 404) {
        // Gone already: the upload below is all that is left to do.
        answer = { status: 204, text: "" };
      }
    }
    if (answer.status >= 200 && answer.status < 300) {
      answer = await github.upload(step.url, file);
    }
    if (answer.status >= 200 && answer.status < 300) {
      log(`✓ Uploaded ${file.name}`);
      return {};
    }
    if (attempt >= delays.length) {
      return { problem: `could not upload ${file.name}: ${said(answer)}` };
    }
    log(
      `Uploading ${file.name} failed (${said(answer)}, try ${attempt + 1} of ${delays.length + 1}); trying again in ${delays[attempt]}s.`,
    );
    await wait(delays[attempt]);
  }
}

/*
 * Runs one attach. Returns its exit code: 0 when every file is on the draft
 * (or, published, as --when-published allows), 1 when it is not, 2 for a
 * usage error. Says what it did on `out`, each problem on `err`.
 */
async function main(
  argv,
  {
    env = process.env,
    out = process.stdout,
    err = process.stderr,
    fetchImpl,
    wait = (seconds) => {
      return new Promise((resolve) => {
        setTimeout(resolve, seconds * 1000);
      });
    },
  } = {},
) {
  const log = (line) => {
    out.write(`${line}\n`);
  };
  const fail = (line) => {
    err.write(`::error::${line}\n`);
    return 1;
  };

  let options;
  let files;
  try {
    options = parseArguments(argv);
    files = filesToAttach(options.files);
  } catch (error) {
    if (error instanceof UsageError) {
      err.write(`AttachReleaseAssets: ${error.message}\n${USAGE}\n`);
      return 2;
    }
    throw error;
  }

  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) {
    err.write("AttachReleaseAssets: GITHUB_TOKEN (or GH_TOKEN) is not set\n");
    return 2;
  }
  const github = new GitHub({
    token,
    apiUrl: env.GITHUB_API_URL,
    uploadsUrl: env.GITHUB_UPLOADS_URL,
    fetchImpl,
  });
  const delays = delaysFrom(env);
  const names = files
    .map((file) => {
      return file.name;
    })
    .join(", ");

  const first = await readRelease(github, options, delays, wait, log);
  if (first.problem) {
    return fail(`${first.problem}. Nothing was attached.`);
  }

  if (!isDraft(first.release)) {
    const published = `${options.tag} is published already (release ${options.releaseId}), and a published release is never changed`;
    if (options.whenPublished === "skip") {
      log(`${published}: not attaching ${names}.`);
      return 0;
    }
    if (options.whenPublished === "verify-checksums") {
      const differences = differencesFromChecksums(first.release, files);
      if (differences.length > 0) {
        for (const difference of differences) {
          err.write(`::error::${difference}\n`);
        }
        return fail(
          `${published}, and with other files than this run built: nothing was attached, and the jobs that publish them elsewhere must not run. A release run repeated for a published version builds its files again; publish what the first run did not from that run instead (Re-run failed jobs).`,
        );
      }
      log(
        `${published}, with exactly the files this run built (its ${
          files.find((file) => {
            return /_checksums\.txt$/.test(file.name);
          }).name
        } and every file it lists): nothing to attach.`,
      );
      return 0;
    }
    return fail(`${published}: not attaching ${names}.`);
  }

  log(
    `Attaching ${files.length} file(s) to draft ${options.releaseId} of ${options.tag}...`,
  );
  for (const file of files) {
    const attached = await attachFile(github, options, file, delays, wait, log);
    if (attached.problem) {
      return fail(attached.problem);
    }
  }

  const last = await readRelease(github, options, delays, wait, log);
  if (last.problem) {
    return fail(last.problem);
  }
  const differences = differencesFromFiles(last.release, files);
  if (!isDraft(last.release)) {
    differences.unshift(
      "it was published while this run filled it: a run only ever uploads to a draft of its own",
    );
  }
  if (differences.length > 0) {
    for (const difference of differences) {
      err.write(`::error::${difference}\n`);
    }
    return fail(
      `Draft ${options.releaseId} of ${options.tag} does not hold what this run built, so it must not be published. Run the job again: it replaces what did not arrive whole.`,
    );
  }
  log(
    `Draft ${options.releaseId} holds the ${files.length} file(s), each whole, with the SHA-256 it was built with.`,
  );
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`AttachReleaseAssets: ${error.stack || error}\n`);
      process.exitCode = 2;
    },
  );
}

module.exports = {
  DEFAULT_DELAYS,
  differencesFromChecksums,
  main,
  parseArguments,
};
