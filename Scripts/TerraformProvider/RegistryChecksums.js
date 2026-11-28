#!/usr/bin/env node

/*
 * What the Terraform and OpenTofu registries say a provider version's zips
 * are, against what its GitHub release serves: the checks `terraform init`
 * and `tofu init` make before they install a provider, for every platform at
 * once (#11016).
 *
 * A registry reads a version once, about a minute after its GitHub release
 * is published: it verifies the release's SHA256SUMS against its signature,
 * keeps each zip's SHA-256 from it, and from then on sends every `init` to
 * GitHub for the files. It never reads them again. So when a published
 * release's assets are built again and uploaded over it, every `init` of the
 * version fails, on every platform, with
 *
 *   checksum list has unexpected SHA-256 hash <the rebuild's> (expected <what the registry read>)
 *
 * which is what a second release run of 14.3.0, 16.0.0, 17.0.0, 17.1.0 and
 * 17.2.0 did (OneUptime/oneuptime#11016, OneUptime/terraform-provider-
 * oneuptime#20). For each registry, version and platform, this asks:
 *
 *   - Does the line the release's SHA256SUMS has for the zip say the SHA-256
 *     the registry read? (init: "checksum list has unexpected SHA-256 hash")
 *   - Does the zip GitHub serves have that SHA-256? (init: "archive has
 *     incorrect checksum") By the SHA-256 GitHub keeps of each asset, or by
 *     downloading the zip with --zips download, or when GitHub keeps none.
 *   - Is the SHA256SUMS.sig a good signature of that SHA256SUMS by a key the
 *     registry has for the provider? (init: "error verifying checksum
 *     signature") With gpg, in a keyring of its own.
 *   - Are the zip, the SHA256SUMS and the signature the registry downloads
 *     the release's own assets?
 *
 * The release workflow runs it after it publishes the provider, and after
 * Republish a Terraform provider version publishes one again; a scheduled run
 * checks every version published whole since 17.3.0
 * (.github/workflows/terraform-provider-registry-checksums.yml). By hand:
 *
 *   node Scripts/TerraformProvider/RegistryChecksums.js --version 17.2.0
 *   node Scripts/TerraformProvider/RegistryChecksums.js --since 17.0.0 --platform linux_amd64
 *
 * It reads public pages only. GITHUB_TOKEN (or GH_TOKEN), when set, is sent
 * to GitHub's API, which answers 60 requests an hour without one.
 *
 * Exits 0 when everything matches, 1 when something does not (each said on
 * a line of its own), and 2 when it was asked something it does not know, or
 * could not read a registry or GitHub.
 *
 * Tests/Ops/TerraformProviderRegistryChecksums.test.js runs it against
 * registry and GitHub answers recorded from 17.2.0, whose assets were
 * replaced, and 17.3.0, whose were not
 * (Tests/Ops/Fixtures/TerraformProviderRegistry).
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  compareVersions,
  parseVersion,
} = require("../Release/GenerateReleaseNotes");
const { parseSums, sha256OfAsset } = require("./ProviderRelease");

const REPOSITORY = "OneUptime/terraform-provider-oneuptime";
const PROVIDER = "terraform-provider-oneuptime";
// The provider's address on both registries: registry.terraform.io/oneuptime/oneuptime.
const NAMESPACE = "oneuptime";
const TYPE = "oneuptime";
const DEFAULT_REGISTRIES = ["registry.terraform.io", "registry.opentofu.org"];
const GITHUB_API = "https://api.github.com";

// A failed request is asked again 5, 15 and 30 seconds later; an answer
// (2xx, 404) is not. A registry lists a new version within a minute or two.
const RETRY_DELAYS_SECONDS = [5, 15, 30];
const POLL_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 120000;

class UsageError extends Error {}

// A registry or GitHub could not be read: the check could not be made.
class ReadError extends Error {}

const USAGE = `Usage: RegistryChecksums.js (--version X.Y.Z ... | --since X.Y.Z [--latest N]) [options]

Compares, for each registry, version and platform, the SHA-256 the registry
read for the provider's zip with the release's SHA256SUMS and with the zip
GitHub serves, and checks the SHA256SUMS's signature: what terraform init and
tofu init check.

  --version X.Y.Z     a version to check (repeat it, or separate them with commas)
  --since X.Y.Z       every version a registry lists from this one on
  --latest N          with --since: the newest N of them
  --registry HOST     a registry to check (repeat it); by default
                      registry.terraform.io and registry.opentofu.org
  --platform OS_ARCH  only this platform, as linux_amd64 (repeat it)
  --wait SECONDS      how long to wait for a registry to list a version
                      published on GitHub (default 0)
  --if-listed         pass over a registry that does not list a version,
                      rather than fail
  --zips digest|download
                      compare each zip by the SHA-256 GitHub keeps of it
                      (digest, the default), or by downloading it
  --summary FILE      append the report, in Markdown, to FILE
                      (GitHub Actions' GITHUB_STEP_SUMMARY)
  -h, --help          show this

Exits 0 when everything matches, 1 when something does not, and 2 when the
check could not be made.`;

function short(sha256) {
  return sha256 ? `${sha256.slice(0, 16)}…` : "none";
}

function platformName(platform) {
  return `${platform.os}_${platform.arch}`;
}

function sumsName(version) {
  return `${PROVIDER}_${version}_SHA256SUMS`;
}

/*
 * "17.2.0" or "v17.2.0" as 17.2.0; anything else is no version.
 */
function plainVersion(text) {
  const parsed = parseVersion(String(text).trim());
  if (!parsed) {
    throw new UsageError(`"${text}" is not a version, as 17.2.0`);
  }
  return parsed.join(".");
}

function byVersionNewestFirst(left, right) {
  return compareVersions(parseVersion(right), parseVersion(left));
}

function parseArgs(argv) {
  const options = {
    versions: [],
    since: null,
    latest: null,
    registries: [],
    platforms: [],
    wait: 0,
    ifListed: false,
    zips: "digest",
    summary: null,
    help: false,
  };

  const valueOf = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`${flag} needs a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--version":
        for (const version of valueOf(index, arg).split(",")) {
          if (version.trim()) {
            options.versions.push(plainVersion(version));
          }
        }
        index += 1;
        break;
      case "--since":
        options.since = plainVersion(valueOf(index, arg));
        index += 1;
        break;
      case "--latest": {
        const value = valueOf(index, arg);
        if (!/^[1-9]\d*$/.test(value)) {
          throw new UsageError(
            `--latest takes a number of versions, as 25. Got: ${value}`,
          );
        }
        options.latest = Number(value);
        index += 1;
        break;
      }
      case "--registry": {
        const host = valueOf(index, arg)
          .replace(/^https:\/\//, "")
          .replace(/\/+$/, "");
        if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
          throw new UsageError(
            `--registry takes a registry's host name, as registry.terraform.io. Got: ${host}`,
          );
        }
        options.registries.push(host.toLowerCase());
        index += 1;
        break;
      }
      case "--platform": {
        const platform = valueOf(index, arg);
        if (!/^[a-z0-9]+_[a-z0-9]+$/.test(platform)) {
          throw new UsageError(
            `--platform takes an os_arch, as linux_amd64. Got: ${platform}`,
          );
        }
        options.platforms.push(platform);
        index += 1;
        break;
      }
      case "--wait": {
        const value = valueOf(index, arg);
        if (!/^\d+$/.test(value)) {
          throw new UsageError(
            `--wait takes a number of seconds. Got: ${value}`,
          );
        }
        options.wait = Number(value);
        index += 1;
        break;
      }
      case "--if-listed":
        options.ifListed = true;
        break;
      case "--zips": {
        const value = valueOf(index, arg);
        if (value !== "digest" && value !== "download") {
          throw new UsageError(
            `--zips takes digest or download. Got: ${value}`,
          );
        }
        options.zips = value;
        index += 1;
        break;
      }
      case "--summary":
        options.summary = valueOf(index, arg);
        index += 1;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new UsageError(`Unknown option: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }
  if (options.versions.length === 0 && !options.since) {
    throw new UsageError("Name the versions to check: --version, or --since");
  }
  if (options.versions.length > 0 && options.since) {
    throw new UsageError("--version and --since: use one or the other");
  }
  if (options.latest !== null && !options.since) {
    throw new UsageError("--latest goes with --since");
  }
  if (options.registries.length === 0) {
    options.registries = [...DEFAULT_REGISTRIES];
  }
  options.registries = [...new Set(options.registries)];
  options.versions = [...new Set(options.versions)];
  return options;
}

/*
 * GET, asked again when it fails for a moment. Resolves to { status, body }
 * for an answer (2xx, or a 404, which is an answer too); throws a ReadError
 * when there is none after every attempt.
 */
async function request(deps, url, { as = "json", headers = {} } = {}) {
  let lastProblem = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_SECONDS.length; attempt += 1) {
    if (attempt > 0) {
      await deps.sleep(RETRY_DELAYS_SECONDS[attempt - 1]);
    }
    let response;
    try {
      response = await deps.fetch(url, {
        headers: { "User-Agent": "oneuptime-registry-checksums", ...headers },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastProblem = error.message || String(error);
      continue;
    }

    if (response.status === 404) {
      return { status: 404, body: null };
    }
    if (response.status >= 200 && response.status < 300) {
      if (as === "json") {
        const text = await response.text();
        try {
          return { status: response.status, body: JSON.parse(text) };
        } catch {
          throw new ReadError(`${url} answered what is not JSON`);
        }
      }
      if (as === "text") {
        return { status: response.status, body: await response.text() };
      }
      return {
        status: response.status,
        body: Buffer.from(await response.arrayBuffer()),
      };
    }

    lastProblem = `HTTP ${response.status}`;
    // GitHub's API answers 60 requests an hour without a token, and says
    // when they are used up: asking again within the hour changes nothing.
    if (
      (response.status === 403 || response.status === 429) &&
      response.headers &&
      typeof response.headers.get === "function" &&
      response.headers.get("x-ratelimit-remaining") === "0"
    ) {
      throw new ReadError(
        `Could not read ${url}: GitHub's API rate limit is used up. Set GITHUB_TOKEN (or GH_TOKEN) to read it with a token.`,
      );
    }
    // Any other client error is an answer that asking again does not change.
    if (response.status < 500 && response.status !== 429) {
      break;
    }
  }
  throw new ReadError(`Could not read ${url}: ${lastProblem}`);
}

/*
 * Where a registry serves providers, from its service discovery document,
 * as terraform init finds it.
 */
async function providersBase(deps, host) {
  const discovery = `https://${host}/.well-known/terraform.json`;
  const { status, body } = await request(deps, discovery);
  if (status === 404 || !body || typeof body["providers.v1"] !== "string") {
    throw new ReadError(`${host} serves no providers (${discovery})`);
  }
  const base = new URL(body["providers.v1"], `https://${host}/`).href;
  return base.endsWith("/") ? base : `${base}/`;
}

/*
 * The versions a registry lists for the provider: version to its platforms
 * ("linux_amd64", ...), in order, as the report says them whatever order
 * the registry lists them in.
 */
async function listedVersions(deps, base) {
  const url = `${base}${NAMESPACE}/${TYPE}/versions`;
  const { status, body } = await request(deps, url);
  if (status === 404 || !body || !Array.isArray(body.versions)) {
    throw new ReadError(`${url} lists no versions`);
  }
  const versions = new Map();
  for (const entry of body.versions) {
    if (entry && parseVersion(entry.version)) {
      versions.set(
        entry.version,
        (entry.platforms || []).map(platformName).sort(),
      );
    }
  }
  return versions;
}

/*
 * The published release of a version on GitHub (null when it has none: a
 * draft is no release to anyone else), by GitHub's REST API.
 */
async function githubRelease(deps, version) {
  const api = (deps.env.GITHUB_API_URL || GITHUB_API).replace(/\/+$/, "");
  const token = deps.env.GITHUB_TOKEN || deps.env.GH_TOKEN || "";
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const { status, body } = await request(
    deps,
    `${api}/repos/${REPOSITORY}/releases/tags/v${version}`,
    { headers },
  );
  return status === 404 ? null : body;
}

/*
 * The SHA-256 of what a URL serves, null when it serves nothing: each zip
 * is downloaded once, whichever registries name it.
 */
async function sha256OfDownload(deps, url) {
  const key = `sha256 ${url.toLowerCase()}`;
  if (!deps.documents.has(key)) {
    deps.documents.set(
      key,
      request(deps, url, { as: "buffer" }).then(({ status, body }) => {
        return status === 404
          ? null
          : crypto.createHash("sha256").update(body).digest("hex");
      }),
    );
  }
  return deps.documents.get(key);
}

/*
 * Whether `signature` is a good signature of `document` by one of `keys`,
 * the ASCII-armored public keys a registry serves, with gpg in a keyring of
 * its own. { checked: false } when there is no gpg to ask.
 */
function verifySignature(deps, { document, signature, keys }) {
  const home = fs.mkdtempSync(
    path.join(os.tmpdir(), "registry-checksums-gpg-"),
  );
  try {
    fs.chmodSync(home, 0o700);
    const gpg = (args, input) => {
      return spawnSync(
        deps.gpg,
        ["--batch", "--no-tty", "--homedir", home, ...args],
        {
          input,
          encoding: input === undefined ? "utf8" : undefined,
        },
      );
    };

    for (const key of keys) {
      const imported = gpg(["--quiet", "--import"], key.ascii_armor || "");
      if (imported.error && imported.error.code === "ENOENT") {
        return { checked: false, reason: "gpg is not installed" };
      }
    }

    const documentFile = path.join(home, "SHA256SUMS");
    const signatureFile = path.join(home, "SHA256SUMS.sig");
    fs.writeFileSync(documentFile, document);
    fs.writeFileSync(signatureFile, signature);
    const verified = gpg([
      "--status-fd",
      "1",
      "--verify",
      signatureFile,
      documentFile,
    ]);
    if (verified.error && verified.error.code === "ENOENT") {
      return { checked: false, reason: "gpg is not installed" };
    }

    const status = String(verified.stdout || "");
    // VALIDSIG <fingerprint> <date> <timestamp> ...: a good signature, by a
    // key that has not expired or been revoked.
    const valid = /^\[GNUPG:\] VALIDSIG ([0-9A-F]+) \S+ (\d+)/m.exec(status);
    if (verified.status === 0 && valid) {
      return {
        checked: true,
        valid: true,
        fingerprint: valid[1],
        signedAt: new Date(Number(valid[2]) * 1000).toISOString(),
      };
    }
    const said =
      /^\[GNUPG:\] (BADSIG|ERRSIG|EXPKEYSIG|REVKEYSIG|NO_PUBKEY|NODATA)\b.*$/m.exec(
        status,
      );
    return {
      checked: true,
      valid: false,
      said: said
        ? said[0].replace("[GNUPG:] ", "")
        : `gpg exited ${verified.status}`,
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/*
 * One platform's zip, as a registry has it, against the release: the
 * SHA-256 the registry read (what init holds every file to), the line the
 * release's SHA256SUMS has for it, and the SHA-256 of the zip GitHub serves.
 * Each problem is said as what init then does.
 */
function comparePlatform({ platform, download, sums, served, assetUrls }) {
  const problems = [];
  const expected = String((download && download.shasum) || "").toLowerCase();
  const filename = download && download.filename;
  const listed = filename ? sums.get(filename) || null : null;

  if (!/^[0-9a-f]{64}$/.test(expected)) {
    problems.push("the registry has no SHA-256 for it");
  }
  // init checks the SHA256SUMS's line first, and stops at the first that
  // fails: each problem is said as what it then reports.
  if (!filename) {
    problems.push("the registry names no zip for it");
  } else if (!listed) {
    problems.push(
      `the release's SHA256SUMS has no line for ${filename}: init fails with "checksum list has no SHA-256 hash for \\"${filename}\\""`,
    );
  } else if (expected && listed !== expected) {
    const zipToo = served === listed ? ", and so does the zip it serves" : "";
    problems.push(
      `the registry read SHA-256 ${expected}, and the release's SHA256SUMS says ${listed}${zipToo}: init fails with "checksum list has unexpected SHA-256 hash ${listed} (expected ${expected})"`,
    );
  }

  if (served === null) {
    problems.push(`the release serves no ${filename}: init cannot download it`);
  } else if (served && expected && served !== expected && served !== listed) {
    problems.push(
      `the zip the release serves has SHA-256 ${served}, and the registry read ${expected}: init fails with "archive has incorrect checksum ${served} (expected ${expected})"`,
    );
  }

  // The registry downloads the zip, the SHA256SUMS and its signature from
  // the release itself, by the URLs GitHub gives its assets. GitHub reads
  // the owner and repository in them whatever their case, and OpenTofu's
  // registry writes them in lower case.
  if (assetUrls && download) {
    for (const [field, what] of [
      ["download_url", "the zip"],
      ["shasums_url", "the SHA256SUMS"],
      ["shasums_signature_url", "the signature"],
    ]) {
      if (
        download[field] &&
        !assetUrls.has(String(download[field]).toLowerCase())
      ) {
        problems.push(
          `the registry downloads ${what} from ${download[field]}, which is not an asset of the release`,
        );
      }
    }
  }

  return {
    platform,
    filename: filename || null,
    expected: expected || null,
    listed,
    served,
    problems,
  };
}

/*
 * What a version's problems on a registry come to, for whoever reads them:
 * the release whose assets agree with each other and not with what the
 * registry read is #11016's, its assets built again after it was published.
 */
function diagnose(result, release) {
  const compared = result.platforms.filter((platform) => {
    return platform.expected && platform.listed;
  });
  const replaced = compared.filter((platform) => {
    return (
      platform.listed !== platform.expected &&
      (platform.served === undefined || platform.served === platform.listed)
    );
  });
  if (replaced.length === 0 || replaced.length !== compared.length) {
    return null;
  }

  const sums = ((release && release.assets) || []).find((asset) => {
    return asset.name === sumsName(result.version);
  });
  const when =
    sums && release && release.published_at && sums.updated_at
      ? ` Its SHA256SUMS was uploaded at ${sums.updated_at}, and the release was published at ${release.published_at}.`
      : "";
  const signed =
    result.signature && result.signature.valid
      ? ", and its SHA256SUMS is signed,"
      : ",";
  return (
    `v${result.version}'s assets agree with each other${signed} but they are not the files ${result.registry} read when it took the version: they were built and uploaded again after it was published.${when} ` +
    `A registry never reads a version again, so this one cannot be mended in place: publish its provider again as the next patch version, with Republish a Terraform provider version (terraform-provider-republish.yml).`
  );
}

/*
 * Checks one version on one registry. Resolves to a result with
 * `outcome`: "ok", "problems", "not-listed" (passed over, with --if-listed)
 * or "not-published" (no GitHub release, and no registry lists it).
 */
async function checkVersionOnRegistry(deps, options, context) {
  const { registry, base, version, release, assetUrls, listing } = context;
  const result = {
    registry,
    version,
    outcome: "ok",
    platforms: [],
    problems: [],
    notes: [],
    signature: null,
    diagnosis: null,
  };

  let platforms = listing.get(version);
  if (!platforms && release && options.wait > 0) {
    // Published on GitHub a moment ago: the registry reads it within a
    // minute or two of the release's "published" event.
    const deadline = deps.now() + options.wait * 1000;
    while (!platforms && deps.now() < deadline) {
      await deps.sleep(POLL_SECONDS);
      const listed = await listedVersions(deps, base);
      platforms = listed.get(version);
    }
  }

  if (!platforms) {
    if (!release) {
      result.outcome = "not-published";
      result.notes.push(
        `v${version} is not published on GitHub, and ${registry} does not list it: there is nothing to check`,
      );
      return result;
    }
    if (options.ifListed) {
      result.outcome = "not-listed";
      result.notes.push(`${registry} does not list ${version} yet`);
      return result;
    }
    result.outcome = "problems";
    result.problems.push(
      `${registry} does not list ${version}${options.wait > 0 ? ` after ${options.wait} seconds` : ""}, which GitHub has published: init cannot find it. Resync the provider on the registry's settings page if its webhook did not tell it.`,
    );
    return result;
  }

  if (!release) {
    result.outcome = "problems";
    result.problems.push(
      `${registry} lists ${version}, and GitHub has no published release v${version}: init cannot download it`,
    );
    return result;
  }

  const wanted =
    options.platforms.length > 0
      ? platforms.filter((platform) => {
          return options.platforms.includes(platform);
        })
      : platforms;
  if (wanted.length === 0) {
    result.notes.push(
      `${registry} lists none of ${options.platforms.join(", ")} for ${version}`,
    );
    return result;
  }

  // The SHA256SUMS and its signature, each read once however many platforms
  // name it; one that is not there is said once.
  const readDocument = async (url, what) => {
    if (!deps.documents.has(url)) {
      deps.documents.set(url, request(deps, url, { as: "buffer" }));
    }
    const answer = await deps.documents.get(url);
    if (answer.status === 404) {
      const problem = `the registry downloads ${what} of ${version} from ${url}, and it is not there: init fails to download it`;
      if (!result.problems.includes(problem)) {
        result.problems.push(problem);
      }
      return null;
    }
    return answer.body;
  };

  let firstDownload = null;
  const assets = new Map(
    (release.assets || []).map((asset) => {
      return [asset.name, asset];
    }),
  );

  for (const platform of wanted) {
    const [os_, arch] = platform.split("_");
    const { status, body: download } = await request(
      deps,
      `${base}${NAMESPACE}/${TYPE}/${version}/download/${os_}/${arch}`,
    );
    if (status === 404 || !download) {
      result.platforms.push({
        platform,
        filename: null,
        expected: null,
        listed: null,
        problems: [
          `${registry} lists ${platform} for ${version}, and has no download for it`,
        ],
      });
      continue;
    }
    firstDownload = firstDownload || download;

    let sums = new Map();
    if (download.shasums_url) {
      const document = await readDocument(
        download.shasums_url,
        "the SHA256SUMS",
      );
      sums = document ? parseSums(document.toString("utf8")) : new Map();
    }

    let served;
    const asset = assets.get(download.filename);
    if (!asset) {
      served = null;
    } else if (options.zips === "download" || !sha256OfAsset(asset)) {
      served = await sha256OfDownload(
        deps,
        asset.browser_download_url || download.download_url,
      );
    } else {
      served = sha256OfAsset(asset);
    }

    result.platforms.push(
      comparePlatform({ platform, download, sums, served, assetUrls }),
    );
  }

  if (
    firstDownload &&
    firstDownload.shasums_url &&
    firstDownload.shasums_signature_url
  ) {
    const keys = (
      (firstDownload.signing_keys || {}).gpg_public_keys || []
    ).filter((key) => {
      return key && key.ascii_armor;
    });
    if (keys.length === 0) {
      // OpenTofu's registry has none for this provider: tofu init installs
      // it without checking the signature.
      result.notes.push(
        `${registry} has no signing key for the provider, so init does not check the SHA256SUMS's signature`,
      );
    } else {
      const document = await readDocument(
        firstDownload.shasums_url,
        "the SHA256SUMS",
      );
      const signature = await readDocument(
        firstDownload.shasums_signature_url,
        "the signature",
      );
      if (document && signature) {
        result.signature = verifySignature(deps, { document, signature, keys });
        if (!result.signature.checked) {
          // Without gpg the signature goes unchecked; in CI that is no pass.
          if (deps.env.CI) {
            result.problems.push(
              `the signature of ${version}'s SHA256SUMS could not be checked: ${result.signature.reason}`,
            );
          } else {
            result.notes.push(
              `the signature of ${version}'s SHA256SUMS was not checked: ${result.signature.reason}`,
            );
          }
        } else if (!result.signature.valid) {
          result.problems.push(
            `the release's SHA256SUMS.sig is not a good signature of its SHA256SUMS by the key ${registry} has (${keys
              .map((key) => {
                return key.key_id;
              })
              .join(
                ", ",
              )}): init fails with "error verifying checksum signature" (gpg: ${result.signature.said})`,
          );
        }
      }
    }
  }

  const failing = result.platforms.some((platform) => {
    return platform.problems.length > 0;
  });
  if (failing || result.problems.length > 0) {
    result.outcome = "problems";
    result.diagnosis = diagnose(result, release);
  }
  return result;
}

/*
 * Runs every check the options ask for. Resolves to the results, one per
 * registry and version, newest version first.
 */
async function check(deps, options) {
  const registries = [];
  for (const host of options.registries) {
    const base = await providersBase(deps, host);
    registries.push({ host, base, listing: await listedVersions(deps, base) });
  }

  let versions = options.versions;
  if (options.since) {
    const since = parseVersion(options.since);
    const all = new Set();
    for (const registry of registries) {
      for (const version of registry.listing.keys()) {
        if (compareVersions(parseVersion(version), since) >= 0) {
          all.add(version);
        }
      }
    }
    versions = [...all].sort(byVersionNewestFirst);
    if (options.latest !== null) {
      versions = versions.slice(0, options.latest);
    }
  } else {
    versions = [...versions].sort(byVersionNewestFirst);
  }

  const results = [];
  for (const version of versions) {
    const release = await githubRelease(deps, version);
    const assetUrls = release
      ? new Set(
          (release.assets || []).map((asset) => {
            return String(asset.browser_download_url).toLowerCase();
          }),
        )
      : null;
    for (const registry of registries) {
      results.push(
        await checkVersionOnRegistry(deps, options, {
          registry: registry.host,
          base: registry.base,
          version,
          release,
          assetUrls,
          listing: registry.listing,
        }),
      );
    }
  }
  return results;
}

function failed(result) {
  return result.outcome === "problems";
}

function headline(result) {
  const count = result.platforms.length;
  const differing = result.platforms.filter((platform) => {
    return platform.problems.length > 0;
  }).length;
  switch (result.outcome) {
    case "not-published":
      return `v${result.version} is not published: nothing to check`;
    case "not-listed":
      return `not listed yet`;
    case "ok":
      if (count === 0) {
        return "nothing to check";
      }
      return `${count} ${count === 1 ? "zip is" : "zips are"} what the registry read${result.signature && result.signature.valid ? ", and the SHA256SUMS is signed by " + result.signature.fingerprint.slice(-16) : ""}`;
    default:
      if (differing > 0) {
        return `${differing} of ${count} ${count === 1 ? "zip differs" : "zips differ"} from what the registry read`;
      }
      return "the version cannot be installed";
  }
}

// The report, as lines of text for the job's log.
function formatReport(results) {
  const lines = [];
  for (const result of results) {
    const mark = failed(result) ? "✗" : "✓";
    lines.push(
      `${mark} ${result.registry} ${result.version}: ${headline(result)}`,
    );
    for (const platform of result.platforms) {
      for (const problem of platform.problems) {
        lines.push(`    ${platform.platform}: ${problem}`);
      }
    }
    for (const problem of result.problems) {
      lines.push(`    ${problem}`);
    }
    for (const note of result.notes) {
      lines.push(`    (${note})`);
    }
    if (result.diagnosis) {
      lines.push(`    ${result.diagnosis}`);
    }
  }
  const failures = results.filter(failed).length;
  lines.push(
    failures === 0
      ? `Every registry's checksums match the releases (${results.length} checked).`
      : `${failures} of ${results.length} registry versions do not match their releases: terraform init or tofu init fails for them.`,
  );
  return lines;
}

// The report in Markdown, for the job's summary.
function formatSummary(results) {
  const lines = [
    "## Terraform provider: the registries' checksums against the releases",
    "",
    "| Registry | Version | Result |",
    "| --- | --- | --- |",
  ];
  for (const result of results) {
    lines.push(
      `| ${result.registry} | ${result.version} | ${failed(result) ? "❌" : "✅"} ${headline(result)} |`,
    );
  }
  const failing = results.filter(failed);
  for (const result of failing) {
    lines.push("", `### ${result.registry} ${result.version}`, "");
    for (const platform of result.platforms) {
      for (const problem of platform.problems) {
        lines.push(`- \`${platform.platform}\`: ${problem}`);
      }
    }
    for (const problem of result.problems) {
      lines.push(`- ${problem}`);
    }
    if (result.diagnosis) {
      lines.push("", result.diagnosis);
    }
  }
  return `${lines.join("\n")}\n`;
}

function defaultDeps() {
  return {
    fetch: globalThis.fetch,
    sleep: (seconds) => {
      return new Promise((resolve) => {
        setTimeout(resolve, seconds * 1000);
      });
    },
    now: () => {
      return Date.now();
    },
    env: process.env,
    gpg: "gpg",
    out: process.stdout,
    err: process.stderr,
  };
}

/*
 * Runs the command line. Resolves to its exit code: 0, 1 when something does
 * not match (said on `out`, a line each), 2 when it was asked something it
 * does not know or could not read a registry or GitHub (said on `err`).
 */
async function main(argv, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides, documents: new Map() };
  const say = (stream, line) => {
    stream.write(`${line}\n`);
  };

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      say(deps.err, error.message);
      say(deps.err, USAGE);
      return 2;
    }
    throw error;
  }
  if (options.help) {
    say(deps.out, USAGE);
    return 0;
  }

  let results;
  try {
    results = await check(deps, options);
  } catch (error) {
    if (error instanceof ReadError) {
      say(deps.err, `The checksums could not be checked: ${error.message}`);
      return 2;
    }
    throw error;
  }

  for (const line of formatReport(results)) {
    say(deps.out, line);
  }
  if (deps.env.GITHUB_ACTIONS === "true") {
    for (const result of results.filter(failed)) {
      say(
        deps.out,
        `::error title=Terraform provider ${result.version} on ${result.registry}::${headline(result)}. ${result.diagnosis || "terraform init fails for it: see the job's log."}`,
      );
    }
  }
  if (options.summary) {
    fs.appendFileSync(options.summary, formatSummary(results));
  }
  return results.some(failed) ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `RegistryChecksums: ${error.stack || error.message}\n`,
      );
      process.exitCode = 2;
    },
  );
}

module.exports = {
  DEFAULT_REGISTRIES,
  POLL_SECONDS,
  RETRY_DELAYS_SECONDS,
  check,
  comparePlatform,
  diagnose,
  formatReport,
  formatSummary,
  main,
  parseArgs,
  verifySignature,
};
