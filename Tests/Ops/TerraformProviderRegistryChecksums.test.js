"use strict";

/**
 * Scripts/TerraformProvider/RegistryChecksums.js: what the Terraform and
 * OpenTofu registries read for a provider version, against what its GitHub
 * release serves, checked as `terraform init` and `tofu init` check it
 * (#11016).
 *
 * A registry reads a version once, about a minute after its release is
 * published, keeps each zip's SHA-256, and sends every init to GitHub for
 * the files. A second release run of 14.3.0, 16.0.0, 17.0.0, 17.1.0 and
 * 17.2.0 built their assets again and uploaded them over the published
 * ones, so every init of them failed, on every platform:
 *
 *   checksum list has unexpected SHA-256 hash 4078aa… (expected d4a57a…)
 *
 * The release run checks each version it publishes with this script, and a
 * scheduled run every version published since 17.3.0.
 *
 * It runs here against what both registries and GitHub answered about
 * 17.2.0, which is broken that way, and 17.3.0, which is not:
 * Fixtures/TerraformProviderRegistry, recorded by its record.js. The
 * signature checks run the real gpg against OneUptime's real key and
 * signatures; without gpg they are skipped, saying so, except in CI, where
 * they fail. Nothing reaches the network.
 */

const crypto = require("crypto");
const fs = require("fs");
const { builtinModules } = require("module");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { stepCommand } = require("./Utils/WorkflowStep");

const {
  POLL_SECONDS,
  check,
  comparePlatform,
  diagnose,
  main,
  parseArgs,
} = require("../../Scripts/TerraformProvider/RegistryChecksums");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = "Scripts/TerraformProvider/RegistryChecksums.js";
const FIXTURES = path.join(__dirname, "Fixtures", "TerraformProviderRegistry");
const RECORDED = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "responses.json"), "utf8"),
).responses;

const TERRAFORM =
  "https://registry.terraform.io/v1/providers/oneuptime/oneuptime";
const OPENTOFU =
  "https://registry.opentofu.org/v1/providers/oneuptime/oneuptime";
const RELEASE_API =
  "https://api.github.com/repos/OneUptime/terraform-provider-oneuptime/releases/tags";
const DOWNLOAD =
  "https://github.com/OneUptime/terraform-provider-oneuptime/releases/download";
const PLATFORMS = ["darwin_arm64", "linux_amd64", "windows_amd64"];
const KEY_ID = "9D87E494AC016697";

/*
 * What the registries read for 17.2.0's linux_amd64 zip, and what its
 * release's SHA256SUMS, and the zip, have said since they were uploaded
 * again: init on linux_amd64 fails with "checksum list has unexpected
 * SHA-256 hash 0534cf… (expected f6cc9d…)".
 */
const READ_17_2_0 =
  "f6cc9d2b7aaefd772c86370691ba0c2be278f0e9b726d56d45d0fccf9253efdc";
const SERVED_17_2_0 =
  "0534cf54b2e77a630bee649c653936733d6282314cef3c9a0f653bc71ee37e63";

const HAS_GPG = !spawnSync("gpg", ["--version"]).error;
if (!HAS_GPG) {
  // eslint-disable-next-line no-console
  console.warn(
    `TerraformProviderRegistryChecksums: gpg is not on PATH, so the signature checks are skipped${process.env.CI ? " (and in CI that fails)" : ""}.`,
  );
}
const withGpg = HAS_GPG || process.env.CI ? test : test.skip;

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function recorded(url) {
  const answer = RECORDED[url];
  if (!answer) {
    throw new Error(`Not recorded: ${url}`);
  }
  return JSON.parse(JSON.stringify(answer));
}

function fileOf(name) {
  return fs.readFileSync(path.join(FIXTURES, name));
}

// An answer as fetch gives it, from a recorded one.
function respond(answer) {
  let body;
  if (answer.json !== undefined) {
    body = Buffer.from(JSON.stringify(answer.json));
  } else if (answer.file) {
    body = fileOf(answer.file);
  } else {
    body = Buffer.from(answer.body || "");
  }
  return {
    status: answer.status || 200,
    headers: {
      get: (name) => {
        return (answer.headers || {})[name.toLowerCase()] ?? null;
      },
    },
    text: async () => {
      return body.toString("utf8");
    },
    arrayBuffer: async () => {
      return body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      );
    },
  };
}

/*
 * The registries and GitHub as they answered, but for `answers`: URL to an
 * answer, or to a function of how many times it was asked that returns one
 * (or throws, as fetch does when the network fails). The clock moves only
 * when the script sleeps.
 */
function world({ answers = {}, env = {}, gpg = "gpg" } = {}) {
  const requests = [];
  const unrecorded = [];
  const sleeps = [];
  const asked = new Map();
  let clock = Date.parse("2026-11-26T09:04:10Z");
  const out = [];
  const err = [];

  const fetch = async (url, init = {}) => {
    requests.push({ url, headers: init.headers || {} });
    asked.set(url, (asked.get(url) || 0) + 1);
    let answer = Object.prototype.hasOwnProperty.call(answers, url)
      ? answers[url]
      : RECORDED[url];
    if (typeof answer === "function") {
      answer = answer(asked.get(url));
    }
    if (!answer) {
      unrecorded.push(url);
      throw new Error(`fetch failed: nothing recorded for ${url}`);
    }
    return respond(answer);
  };

  const deps = {
    fetch,
    sleep: async (seconds) => {
      sleeps.push(seconds);
      clock += seconds * 1000;
    },
    now: () => {
      return clock;
    },
    env,
    gpg,
    out: {
      write: (text) => {
        out.push(text);
      },
    },
    err: {
      write: (text) => {
        err.push(text);
      },
    },
  };

  return {
    deps,
    requests,
    unrecorded,
    sleeps,
    requested: (url) => {
      return requests.filter((request) => {
        return request.url === url;
      }).length;
    },
    run: async (...argv) => {
      out.length = 0;
      err.length = 0;
      const status = await main(argv, deps);
      return { status, out: out.join(""), err: err.join("") };
    },
    check: (argv) => {
      return check({ ...deps, documents: new Map() }, parseArgs(argv));
    },
  };
}

// The line a registry's version has in the report.
function headlineOf(output, registry, version) {
  return output.split("\n").find((line) => {
    return line.slice(2).startsWith(`${registry} ${version}: `);
  });
}

describe(`${SCRIPT}: 17.3.0, whose assets are what both registries read`, () => {
  withGpg(
    "matches on both registries, every platform, and its SHA256SUMS is signed by OneUptime's key",
    async () => {
      const w = world();
      const result = await w.run("--version", "17.3.0");

      expect(result).toMatchObject({ status: 0, err: "" });
      expect(headlineOf(result.out, "registry.terraform.io", "17.3.0")).toBe(
        `✓ registry.terraform.io 17.3.0: 3 zips are what the registry read, and the SHA256SUMS is signed by ${KEY_ID}`,
      );
      expect(headlineOf(result.out, "registry.opentofu.org", "17.3.0")).toBe(
        "✓ registry.opentofu.org 17.3.0: 3 zips are what the registry read",
      );
      // OpenTofu's registry has no key for the provider: tofu init checks no
      // signature, and that is said, not failed.
      expect(result.out).toContain(
        "    (registry.opentofu.org has no signing key for the provider, so init does not check the SHA256SUMS's signature)",
      );
      expect(result.out.trim().split("\n").pop()).toBe(
        "Every registry's checksums match the releases (2 checked).",
      );
      expect(w.unrecorded).toEqual([]);
    },
  );

  test("reads each SHA256SUMS and signature once, however many platforms name it, and downloads no zip", async () => {
    const w = world();
    await w.run("--version", "17.3.0", "--registry", "registry.terraform.io");

    const sums = `${DOWNLOAD}/v17.3.0/terraform-provider-oneuptime_17.3.0_SHA256SUMS`;
    expect(w.requested(sums)).toBe(1);
    expect(w.requested(`${sums}.sig`)).toBe(1);
    expect(
      w.requests.filter((request) => {
        return request.url.endsWith(".zip");
      }),
    ).toEqual([]);
    expect(w.requested(`${RELEASE_API}/v17.3.0`)).toBe(1);
    for (const platform of PLATFORMS) {
      const [os_, arch] = platform.split("_");
      expect(w.requested(`${TERRAFORM}/17.3.0/download/${os_}/${arch}`)).toBe(
        1,
      );
    }
    expect(w.unrecorded).toEqual([]);
  });
});

describe(`${SCRIPT}: 17.2.0, whose assets were uploaded again after both registries read them (#11016)`, () => {
  test("fails on both registries, every platform, saying what terraform init says", async () => {
    const w = world();
    const result = await w.run("--version", "17.2.0");

    expect(result.status).toBe(1);
    for (const registry of ["registry.terraform.io", "registry.opentofu.org"]) {
      expect(headlineOf(result.out, registry, "17.2.0")).toBe(
        `✗ ${registry} 17.2.0: 3 of 3 zips differ from what the registry read`,
      );
    }
    // The customer's error, for the zip they install, with both hashes.
    expect(result.out).toContain(
      `    linux_amd64: the registry read SHA-256 ${READ_17_2_0}, and the release's SHA256SUMS says ${SERVED_17_2_0}, and so does the zip it serves: init fails with "checksum list has unexpected SHA-256 hash ${SERVED_17_2_0} (expected ${READ_17_2_0})"`,
    );
    // A line a platform, a registry: not one more for the zip, which init
    // never gets to.
    expect(
      result.out.match(
        /: init fails with "checksum list has unexpected SHA-256 hash/g,
      ),
    ).toHaveLength(6);
    expect(result.out).not.toContain("archive has incorrect checksum");
    expect(result.out.trim().split("\n").pop()).toBe(
      "2 of 2 registry versions do not match their releases: terraform init or tofu init fails for them.",
    );
    expect(w.unrecorded).toEqual([]);
  });

  test("says why: the release's assets agree with each other, and were uploaded after it was published", async () => {
    const result = await world().run(
      "--version",
      "17.2.0",
      "--registry",
      "registry.opentofu.org",
    );

    expect(result.out).toContain(
      "    v17.2.0's assets agree with each other, but they are not the files registry.opentofu.org read when it took the version: they were built and uploaded again after it was published. Its SHA256SUMS was uploaded at 2026-11-24T16:34:13Z, and the release was published at 2026-11-24T14:30:16Z. A registry never reads a version again, so this one cannot be mended in place: publish its provider again as the next patch version, with Republish a Terraform provider version (terraform-provider-republish.yml).",
    );
  });

  withGpg(
    "its SHA256SUMS is signed nonetheless, by OneUptime's key: the second build's, two hours after the release was published",
    async () => {
      const [terraform] = await world().check([
        "--version",
        "17.2.0",
        "--registry",
        "registry.terraform.io",
      ]);

      expect(terraform.signature).toEqual({
        checked: true,
        valid: true,
        fingerprint: expect.stringMatching(new RegExp(`${KEY_ID}$`)),
        signedAt: "2026-11-24T16:33:24.000Z",
      });
      expect(terraform.diagnosis).toContain(
        "v17.2.0's assets agree with each other, and its SHA256SUMS is signed, but they are not the files registry.terraform.io read",
      );
    },
  );

  test("the registries read the same first build: their hashes agree with each other, and not with the release", async () => {
    const [terraform, opentofu] = await world().check(["--version", "17.2.0"]);

    expect(terraform.registry).toBe("registry.terraform.io");
    expect(opentofu.registry).toBe("registry.opentofu.org");
    const read = (result) => {
      return result.platforms.map((platform) => {
        return [platform.platform, platform.expected];
      });
    };
    expect(read(opentofu)).toEqual(read(terraform));
    for (const platform of terraform.platforms) {
      expect(platform.listed).toBe(platform.served);
      expect(platform.listed).not.toBe(platform.expected);
    }
    expect(
      terraform.platforms.find((platform) => {
        return platform.platform === "linux_amd64";
      }),
    ).toMatchObject({
      expected: READ_17_2_0,
      listed: SERVED_17_2_0,
      served: SERVED_17_2_0,
    });
  });
});

describe(`${SCRIPT}: what it compares, platform by platform`, () => {
  const ZIP = "terraform-provider-oneuptime_1.0.0_linux_amd64.zip";
  const download = (extra = {}) => {
    return {
      filename: ZIP,
      shasum: sha("read"),
      download_url: `${DOWNLOAD}/v1.0.0/${ZIP}`,
      shasums_url: `${DOWNLOAD}/v1.0.0/terraform-provider-oneuptime_1.0.0_SHA256SUMS`,
      shasums_signature_url: `${DOWNLOAD}/v1.0.0/terraform-provider-oneuptime_1.0.0_SHA256SUMS.sig`,
      ...extra,
    };
  };
  const urls = new Set(
    [
      `${DOWNLOAD}/v1.0.0/${ZIP}`,
      `${DOWNLOAD}/v1.0.0/terraform-provider-oneuptime_1.0.0_SHA256SUMS`,
      `${DOWNLOAD}/v1.0.0/terraform-provider-oneuptime_1.0.0_SHA256SUMS.sig`,
    ].map((url) => {
      return url.toLowerCase();
    }),
  );
  const compare = (listed, served, extra) => {
    return comparePlatform({
      platform: "linux_amd64",
      download: download(extra),
      sums: new Map(listed === undefined ? [] : [[ZIP, listed]]),
      served,
      assetUrls: urls,
    }).problems;
  };

  test("the release's line and zip are what the registry read: nothing to say", () => {
    expect(compare(sha("read"), sha("read"))).toEqual([]);
  });

  test("both are another build's: one problem, init's first", () => {
    expect(compare(sha("again"), sha("again"))).toEqual([
      `the registry read SHA-256 ${sha("read")}, and the release's SHA256SUMS says ${sha("again")}, and so does the zip it serves: init fails with "checksum list has unexpected SHA-256 hash ${sha("again")} (expected ${sha("read")})"`,
    ]);
  });

  test("only the SHA256SUMS was replaced", () => {
    expect(compare(sha("again"), sha("read"))).toEqual([
      `the registry read SHA-256 ${sha("read")}, and the release's SHA256SUMS says ${sha("again")}: init fails with "checksum list has unexpected SHA-256 hash ${sha("again")} (expected ${sha("read")})"`,
    ]);
  });

  test("only the zip was replaced", () => {
    expect(compare(sha("read"), sha("again"))).toEqual([
      `the zip the release serves has SHA-256 ${sha("again")}, and the registry read ${sha("read")}: init fails with "archive has incorrect checksum ${sha("again")} (expected ${sha("read")})"`,
    ]);
  });

  test("the line and the zip disagree with each other too", () => {
    expect(compare(sha("again"), sha("third"))).toHaveLength(2);
  });

  test("no line for the zip, no zip, no SHA-256 from the registry", () => {
    expect(compare(undefined, sha("read"))).toEqual([
      `the release's SHA256SUMS has no line for ${ZIP}: init fails with "checksum list has no SHA-256 hash for \\"${ZIP}\\""`,
    ]);
    expect(compare(sha("read"), null)).toEqual([
      `the release serves no ${ZIP}: init cannot download it`,
    ]);
    expect(compare(sha("read"), sha("read"), { shasum: "" })).toContain(
      "the registry has no SHA-256 for it",
    );
  });

  test("the registry downloads from the release's own assets, whatever the case of the owner in the URL", () => {
    const lower = (url) => {
      return url.replace("/OneUptime/", "/oneuptime/");
    };
    const d = download();
    expect(
      compare(sha("read"), sha("read"), {
        download_url: lower(d.download_url),
        shasums_url: lower(d.shasums_url),
        shasums_signature_url: lower(d.shasums_signature_url),
      }),
    ).toEqual([]);
    expect(
      compare(sha("read"), sha("read"), {
        download_url: "https://example.com/provider.zip",
      }),
    ).toEqual([
      "the registry downloads the zip from https://example.com/provider.zip, which is not an asset of the release",
    ]);
  });

  test("says the release's assets were replaced only when every platform shows it", () => {
    const platform = (expected, listed, served) => {
      return { expected, listed, served, problems: [] };
    };
    const release = {
      published_at: "2026-11-24T14:30:16Z",
      assets: [
        {
          name: "terraform-provider-oneuptime_1.0.0_SHA256SUMS",
          updated_at: "2026-11-24T16:34:13Z",
        },
      ],
    };
    const result = (platforms) => {
      return {
        registry: "registry.terraform.io",
        version: "1.0.0",
        signature: null,
        platforms,
      };
    };

    expect(
      diagnose(
        result([
          platform(sha("a"), sha("b"), sha("b")),
          platform(sha("c"), sha("d"), sha("d")),
        ]),
        release,
      ),
    ).toContain(
      "they were built and uploaded again after it was published. Its SHA256SUMS was uploaded at 2026-11-24T16:34:13Z, and the release was published at 2026-11-24T14:30:16Z.",
    );
    // One platform as read: something else is wrong.
    expect(
      diagnose(
        result([
          platform(sha("a"), sha("b"), sha("b")),
          platform(sha("c"), sha("c"), sha("c")),
        ]),
        release,
      ),
    ).toBeNull();
    // The line agrees, the zip does not: not a rebuild of both.
    expect(
      diagnose(result([platform(sha("a"), sha("b"), sha("x"))]), release),
    ).toBeNull();
    expect(diagnose(result([]), release)).toBeNull();
  });
});

describe(`${SCRIPT}: a version GitHub has just published`, () => {
  // The registry's list of versions, without 17.3.0 the first `times`
  // times it is asked.
  const listingWithout = (times) => {
    return (asked) => {
      const answer = recorded(`${TERRAFORM}/versions`);
      if (asked <= times) {
        answer.json.versions = answer.json.versions.filter((entry) => {
          return entry.version !== "17.3.0";
        });
      }
      return answer;
    };
  };

  test("--wait asks the registry again every 30 seconds, until it lists it", async () => {
    const w = world({
      answers: { [`${TERRAFORM}/versions`]: listingWithout(3) },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
      "--wait",
      "1800",
    );

    expect(result.status).toBe(0);
    expect(w.sleeps).toEqual([POLL_SECONDS, POLL_SECONDS, POLL_SECONDS]);
    expect(POLL_SECONDS).toBe(30);
    expect(headlineOf(result.out, "registry.terraform.io", "17.3.0")).toMatch(
      /^✓ /,
    );
  });

  test("fails when the registry has not listed it by then, saying to resync it", async () => {
    const w = world({
      answers: { [`${TERRAFORM}/versions`]: listingWithout(Infinity) },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
      "--wait",
      "90",
    );

    expect(result.status).toBe(1);
    expect(w.sleeps).toEqual([30, 30, 30]);
    expect(result.out).toContain(
      "    registry.terraform.io does not list 17.3.0 after 90 seconds, which GitHub has published: init cannot find it. Resync the provider on the registry's settings page if its webhook did not tell it.",
    );
  });

  test("without --wait, a version the registry does not list fails at once", async () => {
    const w = world({
      answers: { [`${TERRAFORM}/versions`]: listingWithout(Infinity) },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(1);
    expect(w.sleeps).toEqual([]);
    expect(result.out).toContain(
      "registry.terraform.io does not list 17.3.0, which GitHub has published",
    );
  });

  test("--if-listed passes over a registry that does not list it yet", async () => {
    const listing = recorded(`${OPENTOFU}/versions`);
    listing.json.versions = listing.json.versions.filter((entry) => {
      return entry.version !== "17.3.0";
    });
    const w = world({ answers: { [`${OPENTOFU}/versions`]: listing } });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.opentofu.org",
      "--if-listed",
    );

    expect(result.status).toBe(0);
    expect(result.out).toContain(
      "✓ registry.opentofu.org 17.3.0: not listed yet\n    (registry.opentofu.org does not list 17.3.0 yet)",
    );
  });
});

describe(`${SCRIPT}: a version GitHub has no published release of`, () => {
  test("that no registry lists either has nothing to check, and is waited for by nobody", async () => {
    const w = world({
      answers: { [`${RELEASE_API}/v18.0.0`]: { status: 404 } },
    });
    const result = await w.run("--version", "18.0.0", "--wait", "1800");

    expect(result.status).toBe(0);
    expect(w.sleeps).toEqual([]);
    expect(result.out).toContain(
      "✓ registry.terraform.io 18.0.0: v18.0.0 is not published: nothing to check\n    (v18.0.0 is not published on GitHub, and registry.terraform.io does not list it: there is nothing to check)",
    );
  });

  test("that a registry lists fails: init cannot download it", async () => {
    const w = world({
      answers: { [`${RELEASE_API}/v17.3.0`]: { status: 404 } },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(1);
    expect(result.out).toContain(
      "registry.terraform.io lists 17.3.0, and GitHub has no published release v17.3.0: init cannot download it",
    );
  });
});

describe(`${SCRIPT}: the signature`, () => {
  const SUMS = `${DOWNLOAD}/v17.3.0/terraform-provider-oneuptime_17.3.0_SHA256SUMS`;

  withGpg(
    "of other text than the SHA256SUMS fails, naming the key the registry has",
    async () => {
      const w = world({
        answers: {
          // The same lines, and one more: the zips still match, the signature does not.
          [SUMS]: {
            body: `${fileOf("terraform-provider-oneuptime_17.3.0_SHA256SUMS")}\n`,
          },
        },
      });
      const result = await w.run(
        "--version",
        "17.3.0",
        "--registry",
        "registry.terraform.io",
      );

      expect(result.status).toBe(1);
      expect(result.out).toMatch(
        new RegExp(
          `the release's SHA256SUMS\\.sig is not a good signature of its SHA256SUMS by the key registry\\.terraform\\.io has \\(${KEY_ID}\\): init fails with "error verifying checksum signature" \\(gpg: BADSIG ${KEY_ID} OneUptime <key@oneuptime\\.com>\\)`,
        ),
      );
      expect(result.out).not.toContain("zips differ");
    },
  );

  withGpg("of another version's SHA256SUMS fails", async () => {
    const w = world({
      answers: {
        [`${SUMS}.sig`]: {
          file: "terraform-provider-oneuptime_17.2.0_SHA256SUMS.sig",
        },
      },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(1);
    expect(result.out).toContain("is not a good signature of its SHA256SUMS");
  });

  test("goes unchecked without gpg: a note, and in CI a failure", async () => {
    const options = [
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    ];
    const here = await world({ gpg: "/nonexistent/gpg" }).run(...options);
    expect(here.status).toBe(0);
    expect(here.out).toContain(
      "(the signature of 17.3.0's SHA256SUMS was not checked: gpg is not installed)",
    );

    const ci = await world({
      gpg: "/nonexistent/gpg",
      env: { CI: "true" },
    }).run(...options);
    expect(ci.status).toBe(1);
    expect(ci.out).toContain(
      "    the signature of 17.3.0's SHA256SUMS could not be checked: gpg is not installed",
    );
  });

  test("that the registry's SHA256SUMS or signature is not there fails, once", async () => {
    const w = world({ answers: { [`${SUMS}.sig`]: { status: 404 } } });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(1);
    expect(
      result.out.split(
        `the registry downloads the signature of 17.3.0 from ${SUMS}.sig, and it is not there: init fails to download it`,
      ),
    ).toHaveLength(2);
  });
});

describe(`${SCRIPT}: the zips`, () => {
  const zipUrl = (version, platform) => {
    return `${DOWNLOAD}/v${version}/terraform-provider-oneuptime_${version}_${platform}.zip`;
  };

  test("--zips download hashes each zip the release serves, once whichever registries name it", async () => {
    const answers = {};
    for (const platform of PLATFORMS) {
      answers[zipUrl("17.3.0", platform)] = { body: `not the ${platform} zip` };
    }
    const w = world({ answers });
    const result = await w.run("--version", "17.3.0", "--zips", "download");

    expect(result.status).toBe(1);
    const linux = recorded(`${TERRAFORM}/17.3.0/download/linux/amd64`).json
      .shasum;
    expect(result.out).toContain(
      `    linux_amd64: the zip the release serves has SHA-256 ${sha("not the linux_amd64 zip")}, and the registry read ${linux}: init fails with "archive has incorrect checksum ${sha("not the linux_amd64 zip")} (expected ${linux})"`,
    );
    for (const platform of PLATFORMS) {
      expect(w.requested(zipUrl("17.3.0", platform))).toBe(1);
    }
  });

  test("a zip GitHub keeps no SHA-256 of is downloaded and hashed, and only that one", async () => {
    const release = recorded(`${RELEASE_API}/v17.3.0`);
    for (const asset of release.json.assets) {
      if (asset.name.endsWith("_linux_amd64.zip")) {
        asset.digest = null;
      }
    }
    const w = world({
      answers: {
        [`${RELEASE_API}/v17.3.0`]: release,
        [zipUrl("17.3.0", "linux_amd64")]: { body: "another zip" },
      },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(1);
    expect(result.out).toContain(
      `linux_amd64: the zip the release serves has SHA-256 ${sha("another zip")}`,
    );
    expect(
      w.requests.filter((request) => {
        return request.url.endsWith(".zip");
      }),
    ).toHaveLength(1);
  });

  test("a zip the release does not hold fails", async () => {
    const release = recorded(`${RELEASE_API}/v17.3.0`);
    release.json.assets = release.json.assets.filter((asset) => {
      return !asset.name.endsWith("_windows_amd64.zip");
    });
    const result = await world({
      answers: { [`${RELEASE_API}/v17.3.0`]: release },
    }).run("--version", "17.3.0", "--registry", "registry.terraform.io");

    expect(result.status).toBe(1);
    expect(result.out).toContain(
      "windows_amd64: the release serves no terraform-provider-oneuptime_17.3.0_windows_amd64.zip: init cannot download it",
    );
    expect(result.out).toContain(
      "windows_amd64: the registry downloads the zip from https://github.com/OneUptime/terraform-provider-oneuptime/releases/download/v17.3.0/terraform-provider-oneuptime_17.3.0_windows_amd64.zip, which is not an asset of the release",
    );
  });
});

describe(`${SCRIPT}: what the registries and GitHub fail for a moment`, () => {
  test("is asked again 5, 15 and 30 seconds later", async () => {
    const w = world({
      answers: {
        [`${TERRAFORM}/versions`]: (asked) => {
          if (asked === 1) {
            return { status: 502 };
          }
          if (asked === 2) {
            throw new Error("fetch failed: ECONNRESET");
          }
          return recorded(`${TERRAFORM}/versions`);
        },
      },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(0);
    expect(w.sleeps).toEqual([5, 15]);
  });

  test("what never answers stops the check: exit 2, and why", async () => {
    const w = world({
      answers: { [`${TERRAFORM}/versions`]: { status: 503 } },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result).toEqual({
      status: 2,
      out: "",
      err: `The checksums could not be checked: Could not read ${TERRAFORM}/versions: HTTP 503\n`,
    });
    expect(w.sleeps).toEqual([5, 15, 30]);
  });

  test("a client error is an answer, and is not asked again", async () => {
    const w = world({
      answers: {
        "https://registry.terraform.io/.well-known/terraform.json": {
          status: 400,
        },
      },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(2);
    expect(w.sleeps).toEqual([]);
  });

  test("GitHub's used-up rate limit says to set GITHUB_TOKEN, at once", async () => {
    const w = world({
      answers: {
        [`${RELEASE_API}/v17.3.0`]: {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        },
      },
    });
    const result = await w.run(
      "--version",
      "17.3.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(2);
    expect(result.err).toBe(
      `The checksums could not be checked: Could not read ${RELEASE_API}/v17.3.0: GitHub's API rate limit is used up. Set GITHUB_TOKEN (or GH_TOKEN) to read it with a token.\n`,
    );
    expect(w.sleeps).toEqual([]);
  });

  test("GITHUB_TOKEN goes to GitHub's API, and nowhere else", async () => {
    const w = world({ env: { GITHUB_TOKEN: "the-token" } });
    await w.run("--version", "17.3.0", "--registry", "registry.terraform.io");

    for (const request of w.requests) {
      expect({
        url: request.url,
        authorization: request.headers.Authorization || null,
      }).toEqual({
        url: request.url,
        authorization: request.url.startsWith("https://api.github.com/")
          ? "Bearer the-token"
          : null,
      });
    }
  });
});

describe(`${SCRIPT}: which versions it checks`, () => {
  test("--since: every version a registry lists from it on, newest first", async () => {
    const w = world();
    const result = await w.run(
      "--since",
      "17.2.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(1);
    const lines = result.out.split("\n").filter((line) => {
      return /^[✓✗] /.test(line);
    });
    expect(lines).toEqual([
      expect.stringMatching(/^✓ registry\.terraform\.io 17\.3\.0: /),
      "✗ registry.terraform.io 17.2.0: 3 of 3 zips differ from what the registry read",
    ]);
  });

  test("--latest: the newest of them", async () => {
    const w = world();
    const result = await w.run(
      "--since",
      "15.0.0",
      "--latest",
      "1",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.status).toBe(0);
    expect(w.requested(`${RELEASE_API}/v17.3.0`)).toBe(1);
    expect(w.requested(`${RELEASE_API}/v17.2.0`)).toBe(0);
    expect(w.unrecorded).toEqual([]);
  });

  test("--platform: that platform only", async () => {
    const w = world();
    const result = await w.run(
      "--version",
      "17.2.0",
      "--registry",
      "registry.terraform.io",
      "--platform",
      "linux_amd64",
    );

    expect(result.status).toBe(1);
    expect(headlineOf(result.out, "registry.terraform.io", "17.2.0")).toBe(
      "✗ registry.terraform.io 17.2.0: 1 of 1 zip differs from what the registry read",
    );
    expect(w.requested(`${TERRAFORM}/17.2.0/download/darwin/arm64`)).toBe(0);
  });
});

describe(`${SCRIPT}: its report`, () => {
  test("--summary appends it in Markdown, for the job's summary", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "registry-checksums-"),
    );
    const summary = path.join(directory, "summary.md");
    fs.writeFileSync(summary, "Before\n");
    try {
      await world().run(
        "--version",
        "17.2.0",
        "--registry",
        "registry.terraform.io",
        "--platform",
        "linux_amd64",
        "--summary",
        summary,
      );
      const text = fs.readFileSync(summary, "utf8");

      expect(text).toMatch(
        /^Before\n## Terraform provider: the registries' checksums against the releases\n/,
      );
      expect(text).toContain(
        "| registry.terraform.io | 17.2.0 | ❌ 1 of 1 zip differs from what the registry read |",
      );
      expect(text).toContain(
        `### registry.terraform.io 17.2.0\n\n- \`linux_amd64\`: the registry read SHA-256 ${READ_17_2_0}`,
      );
      expect(text).toContain("terraform-provider-republish.yml");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("in GitHub Actions, a version that does not match is an error annotation", async () => {
    const result = await world({ env: { GITHUB_ACTIONS: "true" } }).run(
      "--version",
      "17.2.0",
      "--registry",
      "registry.terraform.io",
    );

    expect(result.out).toContain(
      "::error title=Terraform provider 17.2.0 on registry.terraform.io::3 of 3 zips differ from what the registry read. v17.2.0's assets agree with each other",
    );
  });
});

describe(`${SCRIPT}: its command line`, () => {
  test.each([
    [[], "Name the versions to check: --version, or --since"],
    [["--version", "17.2"], '"17.2" is not a version, as 17.2.0'],
    [
      ["--version", "17.2.0", "--since", "17.0.0"],
      "--version and --since: use one or the other",
    ],
    [["--version", "17.2.0", "--latest", "3"], "--latest goes with --since"],
    [
      ["--since", "17.0.0", "--latest", "0"],
      "--latest takes a number of versions, as 25. Got: 0",
    ],
    [
      ["--version", "17.2.0", "--zips", "all"],
      "--zips takes digest or download. Got: all",
    ],
    [
      ["--version", "17.2.0", "--wait", "soon"],
      "--wait takes a number of seconds. Got: soon",
    ],
    [
      ["--version", "17.2.0", "--registry", "registry.terraform.io/v1"],
      "--registry takes a registry's host name, as registry.terraform.io. Got: registry.terraform.io/v1",
    ],
    [
      ["--version", "17.2.0", "--platform", "linux"],
      "--platform takes an os_arch, as linux_amd64. Got: linux",
    ],
    [["--version"], "--version needs a value"],
    [["--version", "17.2.0", "--fast"], "Unknown option: --fast"],
  ])("%j: exits 2, saying %s", async (argv, said) => {
    const w = world();
    const result = await w.run(...argv);

    expect(result.status).toBe(2);
    expect(result.err.split("\n")[0]).toBe(said);
    expect(result.err).toContain("Usage: RegistryChecksums.js");
    expect(w.requests).toEqual([]);
  });

  test("reads versions as v17.2.0 or 17.2.0, several at once, and registries as hosts", () => {
    expect(
      parseArgs([
        "--version",
        "v17.2.0,17.3.0",
        "--version",
        "17.3.0",
        "--registry",
        "https://Registry.Terraform.io/",
      ]),
    ).toMatchObject({
      versions: ["17.2.0", "17.3.0"],
      registries: ["registry.terraform.io"],
      wait: 0,
      ifListed: false,
      zips: "digest",
    });
    expect(parseArgs(["--since", "17.0.0"]).registries).toEqual([
      "registry.terraform.io",
      "registry.opentofu.org",
    ]);
  });

  test("--help says its usage and exits 0", async () => {
    const result = await world().run("--help");
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/^Usage: RegistryChecksums\.js /);
  });

  test("runs as a program: no arguments exit 2 with its usage, and reach no network", () => {
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, SCRIPT)], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /^Name the versions to check: --version, or --since\nUsage: /,
    );
  });
});

/*
 * ------------------------------------------------------------------
 * The workflows that run it
 * ------------------------------------------------------------------
 */

const CHECK_WORKFLOW =
  ".github/workflows/terraform-provider-registry-checksums.yml";

function workflowOf(file) {
  return yaml.load(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
}

/*
 * The files a script reads through require(), its own and the ones they
 * read, relative to the repository, and the packages it needs installed.
 */
function requiredBy(file, seen = new Set(), packages = new Set()) {
  if (seen.has(file)) {
    return { files: seen, packages };
  }
  seen.add(file);
  const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  for (const match of text.matchAll(/require\("([^"]+)"\)/g)) {
    const required = match[1];
    if (required.startsWith(".")) {
      const resolved = path.relative(
        REPO_ROOT,
        require.resolve(path.join(REPO_ROOT, path.dirname(file), required)),
      );
      requiredBy(resolved, seen, packages);
    } else if (!builtinModules.includes(required.replace(/^node:/, ""))) {
      packages.add(required);
    }
  }
  return { files: seen, packages };
}

describe(CHECK_WORKFLOW, () => {
  const workflow = workflowOf(CHECK_WORKFLOW);
  const on = workflow.on === undefined ? workflow[true] : workflow.on;
  const job = workflow.jobs["check-registry-checksums"];
  const stepNamed = (prefix) => {
    const step = job.steps.find((each) => {
      return String(each.name || "").startsWith(prefix);
    });
    expect(step).toBeDefined();
    return step;
  };

  test("is called with a version, started by hand, and runs every day", () => {
    expect(Object.keys(on).sort()).toEqual([
      "schedule",
      "workflow_call",
      "workflow_dispatch",
    ]);
    expect(on.workflow_call.inputs).toEqual({
      version: expect.objectContaining({ type: "string", required: true }),
      wait: expect.objectContaining({
        type: "number",
        required: false,
        default: 1800,
      }),
    });
    expect(on.workflow_dispatch.inputs).toEqual({
      versions: expect.objectContaining({
        type: "string",
        required: false,
        default: "",
      }),
    });
    expect(on.schedule).toHaveLength(1);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.env).toEqual({ GITHUB_TOKEN: "${{ github.token }}" });
  });

  test("runs each check in a group of its own, cancelling none: one release's is never cancelled by the next's", () => {
    expect(workflow.concurrency).toEqual({
      group: "terraform-provider-registry-checksums-${{ github.run_id }}",
      "cancel-in-progress": false,
    });
  });

  test("checks out only what the check reads, and installs nothing", () => {
    const checkout = job.steps.find((step) => {
      return String(step.uses || "").startsWith("actions/checkout@");
    });
    const folders = checkout.with["sparse-checkout"].trim().split("\n");

    const { files, packages } = requiredBy(SCRIPT);
    expect([...packages]).toEqual([]);
    for (const file of files) {
      expect({
        file,
        checkedOut: folders.some((folder) => {
          return file.startsWith(`${folder}/`);
        }),
      }).toEqual({ file, checkedOut: true });
    }
    expect([...files].sort()).toEqual([
      "Scripts/Release/GenerateReleaseNotes.js",
      "Scripts/TerraformProvider/ProviderRelease.js",
      SCRIPT,
    ]);
    expect(
      job.steps.filter((step) => {
        return /\bnpm (ci|install)\b/.test(stepCommand(step));
      }),
    ).toEqual([]);
  });

  test("for a version: registry.terraform.io, waited for; then OpenTofu's, once it lists it, even after a failure", () => {
    const terraform = stepNamed("Compare registry.terraform.io's checksums");
    const opentofu = stepNamed("And registry.opentofu.org's");

    expect(terraform.if).toBe("${{ inputs.version || inputs.versions }}");
    expect(terraform.env).toEqual({
      VERSIONS: "${{ inputs.version || inputs.versions }}",
      WAIT: "${{ inputs.wait || 0 }}",
    });
    expect(stepCommand(terraform)).toBe(
      `node ${SCRIPT} --version "$VERSIONS" --registry registry.terraform.io --wait "$WAIT" --summary "$GITHUB_STEP_SUMMARY"`,
    );

    expect(opentofu.if).toBe(
      "${{ !cancelled() && (inputs.version || inputs.versions) }}",
    );
    expect(stepCommand(opentofu)).toBe(
      `node ${SCRIPT} --version "$VERSIONS" --registry registry.opentofu.org --if-listed --summary "$GITHUB_STEP_SUMMARY"`,
    );
  });

  test("every day: both registries, every version published whole since 17.3.0", () => {
    const daily = stepNamed(
      "Compare both registries' checksums with every version since 17.3.0",
    );

    expect(daily.if).toBe("${{ !inputs.version && !inputs.versions }}");
    expect(stepCommand(daily)).toBe(
      `node ${SCRIPT} --since 17.3.0 --latest 25 --if-listed --summary "$GITHUB_STEP_SUMMARY"`,
    );
  });

  test("never writes an input into a command: each reaches it through env", () => {
    for (const step of job.steps) {
      expect(stepCommand(step)).not.toMatch(/\$\{\{/);
    }
  });

  test("every command it runs is one the script takes", () => {
    const commands = job.steps.map(stepCommand).filter((command) => {
      return command.startsWith("node ");
    });
    expect(commands).toHaveLength(3);
    for (const command of commands) {
      const argv = command
        .replace(`node ${SCRIPT} `, "")
        .replace('"$VERSIONS"', "17.3.0")
        .replace('"$WAIT"', "1800")
        .replace('"$GITHUB_STEP_SUMMARY"', "summary.md")
        .split(" ");
      expect(() => {
        return parseArgs(argv);
      }).not.toThrow();
    }
  });
});

describe("the jobs that publish the provider check the registries after", () => {
  test("release.yml: after publish-terraform-provider, for its version, only for `release`", () => {
    const jobs = workflowOf(".github/workflows/release.yml").jobs;
    expect(jobs["check-terraform-provider-registries"]).toEqual({
      needs: ["read-version", "publish-terraform-provider"],
      if: "github.ref == 'refs/heads/release'",
      permissions: { contents: "read" },
      uses: `./${CHECK_WORKFLOW}`,
      with: { version: "${{ needs.read-version.outputs.major_minor }}" },
    });
    // The version publish-terraform-provider publishes.
    expect(JSON.stringify(jobs["publish-terraform-provider"].steps)).toContain(
      "needs.read-version.outputs.major_minor",
    );
  });

  test("terraform-provider-republish.yml: after it publishes, for the new version", () => {
    const jobs = workflowOf(
      ".github/workflows/terraform-provider-republish.yml",
    ).jobs;
    expect(jobs["check-registries"]).toEqual({
      needs: "republish-terraform-provider",
      permissions: { contents: "read" },
      uses: `./${CHECK_WORKFLOW}`,
      with: { version: "${{ inputs.version }}" },
    });
  });
});
