/*
 * What a GitHub release holds, against the files a release run built: the
 * rules every upload to a release follows, the Terraform provider's
 * (Scripts/TerraformProvider/ProviderRelease.js) and OneUptime's own
 * (AttachReleaseAssets.js).
 *
 * A published release is never changed. What it serves is what the
 * registries and package managers read once, and keep the SHA-256 of: the
 * Terraform and OpenTofu registries a provider's zips (#11016), the apt and
 * yum indexes, the Homebrew cask and the winget manifest the infrastructure
 * agent's packages and archives (#11466). So a run uploads only to a draft,
 * by the draft's id, never by its tag: a tag can name a published release
 * too, and gh's `release upload <tag> --clobber` replaced the assets of one
 * when it did.
 *
 * A release is GitHub's REST answer for it (`GET /repos/.../releases/<id>`:
 * draft, upload_url, and assets with id, name, size, state and digest), or
 * gh's (`gh release view --json`: isDraft). A file is describeFile's.
 *
 * Tests/Ops/TerraformProviderPublishedRelease.test.js and
 * Tests/Ops/AttachReleaseAssets.test.js test each.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// GitHub's REST API says `draft`, gh's --json says `isDraft`.
function isDraft(release) {
  return Boolean(release.draft === undefined ? release.isDraft : release.draft);
}

/*
 * The SHA-256 GitHub keeps of an asset, "sha256:<hex>", as hex; null for one
 * it keeps none of (GitHub has kept them only since mid 2025).
 */
function sha256OfAsset(asset) {
  const digest = asset ? asset.digest : null;
  if (typeof digest !== "string" || !digest.startsWith("sha256:")) {
    return null;
  }
  return digest.slice("sha256:".length).toLowerCase();
}

function assetsByName(release) {
  return new Map(
    ((release && release.assets) || []).map((asset) => {
      return [asset.name, asset];
    }),
  );
}

/*
 * The files a SHA256SUMS or a GoReleaser checksums file lists, name to
 * SHA-256. A line is a hash and a name, as GoReleaser and sha256sum write
 * it; "*" before the name is sha256sum's binary mode.
 */
function parseSums(text) {
  const sums = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})[ \t]+\*?(\S.*?)\s*$/.exec(line);
    if (match) {
      sums.set(match[2], match[1].toLowerCase());
    }
  }
  return sums;
}

function sha256OfFile(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

// A built file, as the checks below compare it.
function describeFile(file) {
  return {
    name: path.basename(file),
    size: fs.statSync(file).size,
    sha256: sha256OfFile(file),
  };
}

// The draft's own upload URL, which names it by its id, or null.
function uploadUrlOf(release) {
  const uploadUrl = String(release.upload_url || "").replace(/\{[^}]*\}$/, "");
  const match =
    /^https:\/\/[^/]+\/repos\/[^/]+\/[^/]+\/releases\/(\d+)\/assets$/.exec(
      uploadUrl,
    );
  if (!match || (release.id !== undefined && String(release.id) !== match[1])) {
    return null;
  }
  return uploadUrl;
}

/*
 * What uploading the files built for a release to its draft takes, one step
 * a file, without ever changing a published release:
 *
 *   keep     the draft holds it already, whole, the same bytes;
 *   upload   the draft does not hold it;
 *   replace  the draft holds an upload of it that did not finish, or other
 *            bytes: that asset is deleted, by its id, and the file uploaded
 *            again. Only ever on a draft, which nothing has read.
 *
 * A release that is not a draft gets no step at all: `refused` says why
 * (`published`, the reason its caller gives). Neither does one GitHub gives
 * no upload URL for, or one naming another release. Each upload goes to the draft's own upload
 * URL, by its id, never by its tag. `files` are describeFile's, each with
 * its `path`.
 */
function uploadPlan(release, files, { published } = {}) {
  if (!release) {
    return { refused: "there is no release", steps: [] };
  }
  if (!isDraft(release)) {
    return {
      refused:
        published ||
        "it is published, and a published release is never changed",
      steps: [],
    };
  }
  const uploadUrl = uploadUrlOf(release);
  if (!uploadUrl) {
    return {
      refused: `GitHub gives no upload URL for it (${release.upload_url || "none"})`,
      steps: [],
    };
  }

  const assets = assetsByName(release);
  const steps = files.map((file) => {
    const url = `${uploadUrl}?name=${encodeURIComponent(file.name)}`;
    const asset = assets.get(file.name);
    if (!asset) {
      return { action: "upload", name: file.name, path: file.path, url };
    }
    const whole = !asset.state || asset.state === "uploaded";
    if (
      whole &&
      asset.size === file.size &&
      sha256OfAsset(asset) === file.sha256
    ) {
      return { action: "keep", name: file.name };
    }
    return {
      action: "replace",
      name: file.name,
      path: file.path,
      url,
      assetId: String(asset.id),
    };
  });
  return { refused: null, steps };
}

/*
 * How a release differs from the files built for it, file by file: [] when
 * it holds each of them whole, with the same size and the same SHA-256.
 * With `only: true`, anything else it holds is a difference too.
 */
function differencesFromFiles(release, files, { only = false } = {}) {
  if (!release) {
    return ["there is no release"];
  }

  const differences = [];
  const assets = assetsByName(release);
  for (const file of files) {
    const asset = assets.get(file.name);
    if (!asset) {
      differences.push(`${file.name} is not on it`);
      continue;
    }
    if (asset.state && asset.state !== "uploaded") {
      differences.push(
        `${file.name} did not finish uploading (${asset.state})`,
      );
    }
    if (asset.size !== file.size) {
      differences.push(
        `${file.name} is ${asset.size} bytes there, and ${file.size} as built`,
      );
    }
    const actual = sha256OfAsset(asset);
    if (actual && actual !== file.sha256) {
      differences.push(
        `${file.name} has SHA-256 ${actual} there, and ${file.sha256} as built`,
      );
    }
  }

  if (only) {
    const built = new Set(
      files.map((file) => {
        return file.name;
      }),
    );
    for (const name of assets.keys()) {
      if (!built.has(name)) {
        differences.push(`${name} is on it, and this run did not build it`);
      }
    }
  }

  return differences;
}

module.exports = {
  assetsByName,
  describeFile,
  differencesFromFiles,
  isDraft,
  parseSums,
  sha256OfAsset,
  sha256OfFile,
  uploadPlan,
  uploadUrlOf,
};
