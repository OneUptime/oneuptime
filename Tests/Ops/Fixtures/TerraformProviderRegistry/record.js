#!/usr/bin/env node

/*
 * Records what registry.terraform.io, registry.opentofu.org and GitHub
 * answer about two versions of the OneUptime provider, for
 * Tests/Ops/TerraformProviderRegistryChecksums.test.js: 17.2.0, whose release
 * assets were built again and uploaded after both registries had read them
 * (#11016), and 17.3.0, whose were not.
 *
 *   node Tests/Ops/Fixtures/TerraformProviderRegistry/record.js
 *
 * It asks public pages only, with no token, as anyone would: two of GitHub's
 * 60 unauthenticated API requests an hour. Every answer is kept as it came,
 * but for two kinds that are long and that the check reads little of:
 *
 *   - each registry's list of versions is cut to VERSIONS, each with the
 *     PLATFORMS of its platforms (the registries list ~500 versions with 18
 *     platforms each);
 *   - each GitHub release keeps the fields RegistryChecksums.js reads, and
 *     the times its assets were uploaded.
 *
 * The SHA256SUMS and its signature are kept as files of their own, named as
 * the release names them.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const VERSIONS = ["15.0.0", "16.0.0", "17.0.0", "17.1.0", "17.2.0", "17.3.0"];
const RECORDED = ["17.2.0", "17.3.0"];
const PLATFORMS = ["darwin_arm64", "linux_amd64", "windows_amd64"];
const REGISTRIES = ["registry.terraform.io", "registry.opentofu.org"];
const RELEASE_FIELDS = [
  "tag_name",
  "draft",
  "prerelease",
  "immutable",
  "created_at",
  "published_at",
];
const ASSET_FIELDS = [
  "id",
  "name",
  "size",
  "digest",
  "state",
  "content_type",
  "browser_download_url",
  "created_at",
  "updated_at",
];

async function get(url, as) {
  const response = await fetch(url, {
    headers: { "User-Agent": "oneuptime-registry-checksums-fixtures" },
  });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return as === "json"
    ? response.json()
    : Buffer.from(await response.arrayBuffer());
}

function pick(object, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => {
        return field in object;
      })
      .map((field) => {
        return [field, object[field]];
      }),
  );
}

async function main() {
  const responses = {};

  for (const host of REGISTRIES) {
    const discovery = `https://${host}/.well-known/terraform.json`;
    responses[discovery] = { status: 200, json: await get(discovery, "json") };

    const versions = `https://${host}/v1/providers/oneuptime/oneuptime/versions`;
    const listed = await get(versions, "json");
    responses[versions] = {
      status: 200,
      json: {
        ...listed,
        versions: listed.versions
          .filter((entry) => {
            return VERSIONS.includes(entry.version);
          })
          .map((entry) => {
            return {
              ...entry,
              platforms: entry.platforms.filter((platform) => {
                return PLATFORMS.includes(`${platform.os}_${platform.arch}`);
              }),
            };
          }),
      },
    };

    for (const version of RECORDED) {
      for (const platform of PLATFORMS) {
        const [os, arch] = platform.split("_");
        const url = `https://${host}/v1/providers/oneuptime/oneuptime/${version}/download/${os}/${arch}`;
        const download = await get(url, "json");
        responses[url] = { status: 200, json: download };

        // The SHA256SUMS and its signature, by the URLs this registry gives.
        for (const field of ["shasums_url", "shasums_signature_url"]) {
          const file = path.basename(new URL(download[field]).pathname);
          if (!fs.existsSync(path.join(HERE, file))) {
            fs.writeFileSync(path.join(HERE, file), await get(download[field]));
          }
          responses[download[field]] = { status: 200, file };
        }
      }
    }
  }

  for (const version of RECORDED) {
    const url = `https://api.github.com/repos/OneUptime/terraform-provider-oneuptime/releases/tags/v${version}`;
    const release = await get(url, "json");
    responses[url] = {
      status: 200,
      json: {
        ...pick(release, RELEASE_FIELDS),
        upload_url: release.upload_url,
        assets: release.assets.map((asset) => {
          return pick(asset, ASSET_FIELDS);
        }),
      },
    };
  }

  fs.writeFileSync(
    path.join(HERE, "responses.json"),
    `${JSON.stringify({ recordedAt: new Date().toISOString(), responses }, null, 2)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
