#!/usr/bin/env node

/*
 * What a Terraform provider release on GitHub holds, against what it must:
 * the checks publish-terraform-provider.sh makes before it changes anything
 * in OneUptime/terraform-provider-oneuptime, as functions it runs through
 * the command line below.
 *
 * A published release is never changed. The Terraform and OpenTofu
 * registries read a version's assets once, when it is published, and keep
 * each zip's SHA-256; `terraform init` and `tofu init` check what GitHub
 * serves against it. A second release run of 14.3.0, 16.0.0, 17.0.0 and
 * 17.1.0 built their assets again and uploaded them over the published ones,
 * and GoReleaser does not make the same zip twice, so init refused those
 * versions: "checksum list has unexpected SHA-256 hash"
 * (OneUptime/terraform-provider-oneuptime#20). So the script builds a
 * release whole as a draft, checks the draft against what it built, and only
 * then publishes it; a run that finds its version published leaves it as it
 * is.
 *
 * Commands, each reading what gh wrote to a file. A release is GitHub's REST
 * answer for it (`gh api repos/.../releases/<id>`: draft, assets with name,
 * size, state and digest), or gh's own (`gh release view --json`: isDraft).
 *
 *   asset-id <release.json> <name>
 *       The id of the release's asset of that name, for reading it by its
 *       id; nothing when it has none.
 *   check-published <version> <release.json> <SHA256SUMS>
 *       Whether a published release holds its SHA256SUMS, the signature, and
 *       every file the SHA256SUMS lists, each with the SHA-256 it lists.
 *       Exits 1 and says what is wrong when it does not.
 *   check-built <version> <file>...
 *       Whether the files built for a release are all of it: the SHA256SUMS,
 *       its signature, and every file it lists, as it lists them. The script
 *       checks this before it pushes anything. Exits 1 and says what is
 *       wrong when they are not.
 *   upload-plan <release.json> <file>...
 *       What uploading the files to a draft takes, a line a file:
 *       `keep <name>`, `upload <url> <file>` or `replace <asset id> <url>
 *       <file>`, each URL the draft's own, by its id. Exits 1 with
 *       `refused <why>`, and no step, for a release that is not a draft: the
 *       guard that a published release's assets are never uploaded over
 *       (#11016).
 *   check-uploaded <release.json> <file>...
 *       Whether a draft holds exactly the files built for it: their names,
 *       sizes and SHA-256s, and nothing else. Exits 1 and says what differs
 *       when it does not.
 *   previous <version> <releases.json>
 *       The release a version follows: the newest published release older
 *       than it, from `gh release list --json tagName,isDraft,isPrerelease`.
 *       Prints nothing when there is none.
 *   latest <version> <releases.json>
 *       true when no published release is newer than the version, so that
 *       publishing it makes it the repository's latest, else false: a
 *       version published again after newer ones (--republish-from).
 *
 * Tests/Ops/TerraformProviderPublishedRelease.test.js tests each, and the
 * script that runs them.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const {
  compareVersions,
  parseVersion,
} = require("../Release/GenerateReleaseNotes");
// What every upload to a GitHub release follows, OneUptime's own too.
const ReleaseAssets = require("../Release/ReleaseAssets");

const { assetsByName, describeFile, isDraft, parseSums, sha256OfAsset } =
  ReleaseAssets;

const PROVIDER = "terraform-provider-oneuptime";

// 17.1.0, or 17.1.0-test as a test release is named: its x.y.z.
const VERSION_WITH_SUFFIX = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/;

function sumsName(version) {
  return `${PROVIDER}_${version}_SHA256SUMS`;
}

function signatureName(version) {
  return `${sumsName(version)}.sig`;
}

/*
 * What a published release lacks, or holds that is not what its SHA256SUMS
 * says: [] when nothing. A registry needs all of it - the SHA256SUMS, its
 * signature, and every file listed, the zips and the manifest.
 */
function problemsOfPublishedRelease(release, version, sumsText) {
  const assets = assetsByName(release);
  const sumsFile = sumsName(version);
  const problems = [];

  if (!assets.has(sumsFile)) {
    // Without it nothing else can be checked.
    return [`it has no ${sumsFile}`];
  }
  if (!assets.has(signatureName(version))) {
    problems.push(`it has no ${signatureName(version)}`);
  }

  const sums = parseSums(sumsText);
  const zips = [...sums.keys()].filter((name) => {
    return name.endsWith(".zip");
  });
  if (zips.length === 0) {
    problems.push(`its ${sumsFile} lists no zip`);
  }

  for (const [name, expected] of sums) {
    const asset = assets.get(name);
    if (!asset) {
      problems.push(`it has no ${name}, which its ${sumsFile} lists`);
      continue;
    }
    const actual = sha256OfAsset(asset);
    if (actual && actual !== expected) {
      problems.push(
        `its ${name} has SHA-256 ${actual}, and its ${sumsFile} says ${expected}`,
      );
    }
  }

  return problems;
}

/*
 * What the files built for a release lack, or hold that is not what their
 * SHA256SUMS says: [] when they are all of it. `files` are describeFile's,
 * and `sumsText` is the SHA256SUMS among them.
 */
function problemsOfBuiltAssets(version, files, sumsText) {
  const byName = new Map(
    files.map((file) => {
      return [file.name, file];
    }),
  );
  const sumsFile = sumsName(version);
  if (!byName.has(sumsFile)) {
    return [`GoReleaser wrote no ${sumsFile}`];
  }

  const problems = [];
  if (!byName.has(signatureName(version))) {
    problems.push(`GoReleaser wrote no ${signatureName(version)}`);
  }

  const sums = parseSums(sumsText);
  if (
    ![...sums.keys()].some((name) => {
      return name.endsWith(".zip");
    })
  ) {
    problems.push(`${sumsFile} lists no zip`);
  }
  for (const [name, expected] of sums) {
    const file = byName.get(name);
    if (!file) {
      problems.push(`${name} is listed in ${sumsFile}, and was not built`);
    } else if (file.sha256 !== expected) {
      problems.push(
        `${name} has SHA-256 ${file.sha256}, and ${sumsFile} says ${expected}`,
      );
    }
  }
  for (const name of byName.keys()) {
    if (
      name !== sumsFile &&
      name !== signatureName(version) &&
      !sums.has(name)
    ) {
      problems.push(`${name} was built, and ${sumsFile} does not list it`);
    }
  }
  return problems;
}

/*
 * How a draft differs from the files built for it: [] when it holds exactly
 * them, each whole and the same bytes, and nothing else.
 */
function differencesFromBuilt(release, files) {
  if (!release) {
    return ["there is no release"];
  }
  return [
    ...(isDraft(release)
      ? []
      : ["it is published: a run only ever uploads to a draft of its own"]),
    ...ReleaseAssets.differencesFromFiles(release, files, { only: true }),
  ];
}

/*
 * What uploading the files built for a release to its draft takes, one step
 * a file, without ever changing a published release (#11016): keep, upload
 * or replace, each to the draft's own upload URL, by its id
 * (ReleaseAssets.uploadPlan). A release that is not a draft gets no step at
 * all: gh's `release upload <tag> --clobber` replaced the assets of one
 * (OneUptime/terraform-provider-oneuptime#20). `files` are describeFile's,
 * each with its `path`.
 */
function uploadPlan(release, files) {
  return ReleaseAssets.uploadPlan(release, files, {
    published:
      "it is published, and a published release is never changed: the registries have read its assets",
  });
}

function versionParts(version) {
  const match = VERSION_WITH_SUFFIX.exec(String(version));
  if (!match) {
    throw new Error(`"${version}" is not a version`);
  }
  return match.slice(1, 4).map(Number);
}

// Published, and named as a release is: vX.Y.Z.
function publishedReleases(releases) {
  return (releases || [])
    .filter((release) => {
      return !release.isDraft && !release.isPrerelease;
    })
    .map((release) => {
      return { tag: release.tagName, parsed: parseVersion(release.tagName) };
    })
    .filter((release) => {
      return release.parsed !== null;
    });
}

function previousRelease(releases, version) {
  const current = versionParts(version);
  let previous = null;

  for (const release of publishedReleases(releases)) {
    if (
      compareVersions(release.parsed, current) < 0 &&
      (!previous || compareVersions(release.parsed, previous.parsed) > 0)
    ) {
      previous = release;
    }
  }

  return previous ? previous.tag : null;
}

function isLatest(releases, version) {
  const current = versionParts(version);
  return publishedReleases(releases).every((release) => {
    return compareVersions(release.parsed, current) <= 0;
  });
}

function readJson(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  return text ? JSON.parse(text) : null;
}

function assetIdOf(release, name) {
  const asset = assetsByName(release).get(name);
  return asset && asset.id !== undefined ? String(asset.id) : null;
}

const USAGE = `Usage:
  ProviderRelease.js asset-id <release.json> <name>
  ProviderRelease.js check-published <version> <release.json> <SHA256SUMS>
  ProviderRelease.js check-built <version> <file>...
  ProviderRelease.js upload-plan <release.json> <file>...
  ProviderRelease.js check-uploaded <release.json> <file>...
  ProviderRelease.js previous <version> <releases.json>
  ProviderRelease.js latest <version> <releases.json>`;

/*
 * Runs one command. Returns its exit code: 0, 1 when a check found
 * something (said on `out`, one line each), 2 for a command it does not know.
 */
function main(argv, out = process.stdout, err = process.stderr) {
  const [command, ...args] = argv;
  const say = (line) => {
    out.write(`${line}\n`);
  };

  switch (command) {
    case "asset-id":
      if (args.length !== 2) {
        break;
      }
      say(assetIdOf(readJson(args[0]), args[1]) || "");
      return 0;
    case "check-published": {
      if (args.length !== 3) {
        break;
      }
      const [version, releaseFile, sumsFile] = args;
      const problems = problemsOfPublishedRelease(
        readJson(releaseFile),
        version,
        fs.readFileSync(sumsFile, "utf8"),
      );
      problems.forEach(say);
      return problems.length > 0 ? 1 : 0;
    }
    case "check-built": {
      if (args.length < 2) {
        break;
      }
      const [version, ...files] = args;
      const sums = files.find((file) => {
        return path.basename(file) === sumsName(version);
      });
      const problems = problemsOfBuiltAssets(
        version,
        files.map(describeFile),
        sums ? fs.readFileSync(sums, "utf8") : "",
      );
      problems.forEach(say);
      return problems.length > 0 ? 1 : 0;
    }
    case "upload-plan": {
      if (args.length < 2) {
        break;
      }
      const [releaseFile, ...files] = args;
      const plan = uploadPlan(
        readJson(releaseFile),
        files.map((file) => {
          return { ...describeFile(file), path: file };
        }),
      );
      if (plan.refused) {
        say(`refused ${plan.refused}`);
        return 1;
      }
      for (const step of plan.steps) {
        if (step.action === "keep") {
          say(`keep ${step.name}`);
        } else if (step.action === "upload") {
          say(`upload ${step.url} ${step.path}`);
        } else {
          say(`replace ${step.assetId} ${step.url} ${step.path}`);
        }
      }
      return 0;
    }
    case "check-uploaded": {
      if (args.length < 2) {
        break;
      }
      const [releaseFile, ...files] = args;
      const differences = differencesFromBuilt(
        readJson(releaseFile),
        files.map(describeFile),
      );
      differences.forEach(say);
      return differences.length > 0 ? 1 : 0;
    }
    case "previous":
      if (args.length !== 2) {
        break;
      }
      say(previousRelease(readJson(args[1]) || [], args[0]) || "");
      return 0;
    case "latest":
      if (args.length !== 2) {
        break;
      }
      say(String(isLatest(readJson(args[1]) || [], args[0])));
      return 0;
    default:
      break;
  }

  err.write(`${USAGE}\n`);
  return 2;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ProviderRelease: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  assetIdOf,
  describeFile,
  differencesFromBuilt,
  isLatest,
  main,
  parseSums,
  previousRelease,
  problemsOfBuiltAssets,
  problemsOfPublishedRelease,
  sha256OfAsset,
  signatureName,
  sumsName,
  uploadPlan,
};
