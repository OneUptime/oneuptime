"use strict";

/**
 * The Iron Bank Preflight workflow's scripts (Scripts/IronBank), without the
 * network: IronBankApp.test.js runs PinRelease.js's `pin` on the real files,
 * and this checks the rest of what each script decides.
 *
 *   PinRelease.js   which image of a release's tag it pins (linux/amd64, from
 *                   an index or a single image), that the image is the
 *                   Community Edition of that very version with a commit, and
 *                   that it refuses what is not a release, a digest or a
 *                   commit, and a file that has a value twice or not at all.
 *   NewFindings.js  how it reads Grype's and Trivy's reports, merges what both
 *                   found under one advisory (a GHSA and its CVE), sorts
 *                   findings into inherited, justified and new, lists the
 *                   justifications nothing matches, writes the summary, and
 *                   exits 1 only for a new finding at or above --fail-on.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PinRelease = require("../../Scripts/IronBank/PinRelease");
const NewFindings = require("../../Scripts/IronBank/NewFindings");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const NEW_FINDINGS = path.join(REPO_ROOT, "Scripts/IronBank/NewFindings.js");

const AMD64 = `sha256:${"1".repeat(64)}`;
const ARM64 = `sha256:${"2".repeat(64)}`;
const COMMIT = "c".repeat(40);

function config(overrides = {}) {
  return {
    os: "linux",
    architecture: "amd64",
    ...overrides,
    config: {
      Env: [
        "PATH=/usr/local/bin:/usr/bin",
        "APP_VERSION=14.0.101",
        `GIT_SHA=${COMMIT}`,
        "NODE_OPTIONS=--a=b",
      ],
      Labels: { "com.oneuptime.edition": "community" },
      ...(overrides.config || {}),
    },
  };
}

describe("PinRelease.js", () => {
  test("pins a multi-platform tag's linux/amd64 image, never its attestations", () => {
    const index = {
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        {
          digest: `sha256:${"9".repeat(64)}`,
          platform: { os: "unknown", architecture: "unknown" },
        },
        { digest: ARM64, platform: { os: "linux", architecture: "arm64" } },
        { digest: AMD64, platform: { os: "linux", architecture: "amd64" } },
      ],
    };

    expect(PinRelease.platformDigest(index, `sha256:${"0".repeat(64)}`)).toBe(
      AMD64,
    );
    expect(() => {
      return PinRelease.platformDigest(
        { ...index, manifests: index.manifests.slice(0, 2) },
        null,
      );
    }).toThrow("no linux/amd64 image");
  });

  test("pins a single image by the digest the registry gives it", () => {
    const single = {
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {},
    };

    expect(PinRelease.platformDigest(single, AMD64)).toBe(AMD64);
    expect(() => {
      return PinRelease.platformDigest(single, null);
    }).toThrow("digest");
  });

  test("reads the commit from the Community Edition image of that version", () => {
    expect(PinRelease.releaseEnvironment(config(), "14.0.101")).toEqual({
      gitSha: COMMIT,
    });
  });

  test.each([
    ["another version", config(), "14.0.102", "APP_VERSION=14.0.101"],
    [
      "the Enterprise Edition",
      config({ config: { Labels: { "com.oneuptime.edition": "enterprise" } } }),
      "14.0.101",
      "enterprise edition",
    ],
    [
      "an image for another platform",
      config({ architecture: "arm64" }),
      "14.0.101",
      "linux/arm64",
    ],
    [
      "an image without a commit",
      config({ config: { Env: ["APP_VERSION=14.0.101", "GIT_SHA=unknown"] } }),
      "14.0.101",
      "GIT_SHA=unknown",
    ],
  ])("refuses %s", (_label, imageConfig, version, message) => {
    expect(() => {
      return PinRelease.releaseEnvironment(imageConfig, version);
    }).toThrow(message);
  });

  const files = {
    manifest: [
      "tags:",
      '  - "1.0.0"',
      '  - "latest"',
      "labels:",
      '  org.opencontainers.image.version: "1.0.0"',
      "resources:",
      '  - tag: "oneuptime/app:1.0.0"',
      `    url: "docker://docker.io/oneuptime/app@${ARM64}"`,
      "",
    ].join("\n"),
    dockerfile: [
      "FROM oneuptime/app:1.0.0 AS release",
      'LABEL org.opencontainers.image.revision="old"',
      "ENV APP_VERSION=1.0.0",
      "ENV GIT_SHA=old",
      "",
    ].join("\n"),
  };
  const release = { version: "2.3.4", digest: AMD64, gitSha: COMMIT };

  test("moves every value of both files to the release", () => {
    expect(PinRelease.pin(files, release)).toEqual({
      manifest: files.manifest
        .split("1.0.0")
        .join("2.3.4")
        .replace(ARM64, AMD64),
      dockerfile: files.dockerfile
        .split("1.0.0")
        .join("2.3.4")
        .split("old")
        .join(COMMIT),
    });
  });

  test.each([
    ["a version that is not a release", { version: "2.3" }, "release version"],
    ["a tag in place of a digest", { digest: "latest" }, "image digest"],
    ["a branch in place of a commit", { gitSha: "master" }, "commit"],
  ])("refuses %s", (_label, change, message) => {
    expect(() => {
      return PinRelease.pin(files, { ...release, ...change });
    }).toThrow(message);
  });

  test("refuses a file that has a value twice, or not at all", () => {
    expect(() => {
      return PinRelease.pin(
        {
          ...files,
          dockerfile: `${files.dockerfile}ENV APP_VERSION=1.0.0\n`,
        },
        release,
      );
    }).toThrow("Dockerfile: expected APP_VERSION once, found it 2 times");
    expect(() => {
      return PinRelease.pin(
        { ...files, manifest: files.manifest.replace("tags:", "tag:") },
        release,
      );
    }).toThrow(
      "hardening_manifest.yaml: expected the first tag once, found it 0 times",
    );
  });

  test("takes only a release version on its command line", () => {
    expect(PinRelease.parseArgs(["--version", "14.0.101", "--check"])).toEqual(
      expect.objectContaining({ version: "14.0.101", check: true }),
    );
    for (const argv of [
      [],
      ["--version", "14.0.101; rm -rf /"],
      ["--version", "v14.0.101"],
      ["--version", "14.0.101", "--force"],
    ]) {
      expect(() => {
        return PinRelease.parseArgs(argv);
      }).toThrow();
    }
  });
});

/*
 * A Grype match and a Trivy vulnerability, as their JSON reports write them.
 */
function grypeMatch(id, name, version, severity, extra = {}) {
  return {
    vulnerability: {
      id,
      severity,
      fix: { versions: extra.fixedIn || [] },
    },
    relatedVulnerabilities: (extra.related || []).map((related) => {
      return { id: related };
    }),
    artifact: {
      name,
      version,
      locations: [
        {
          path: extra.path || `/usr/src/app/node_modules/${name}/package.json`,
        },
      ],
    },
  };
}

function trivyVulnerability(id, name, version, severity, extra = {}) {
  return {
    VulnerabilityID: id,
    VendorIDs: extra.vendorIds,
    PkgName: name,
    InstalledVersion: version,
    FixedVersion: extra.fixedIn,
    Severity: severity,
    PkgPath: extra.path,
  };
}

describe("NewFindings.js", () => {
  const image = [
    ...NewFindings.fromGrype({
      matches: [
        grypeMatch("GHSA-aaaa-bbbb-cccc", "undici", "6.0.0", "High", {
          related: ["CVE-2026-0001"],
          fixedIn: ["6.0.1"],
        }),
        grypeMatch("CVE-2026-0002", "busybox", "1.37.0-r0", "Medium", {
          path: "/lib/apk/db/installed",
        }),
        grypeMatch("CVE-2026-0003", "tar", "7.0.0", "Critical"),
        grypeMatch("CVE-2026-0004", "debug", "4.0.0", "Low"),
      ],
    }),
    ...NewFindings.fromTrivy({
      Results: [
        {
          Target: "Node.js",
          Vulnerabilities: [
            trivyVulnerability("CVE-2026-0001", "undici", "6.0.0", "HIGH", {
              vendorIds: ["GHSA-aaaa-bbbb-cccc"],
              fixedIn: "6.0.1, 7.0.2",
              path: "usr/src/Common/node_modules/undici/package.json",
            }),
          ],
        },
        { Target: "oneuptime/app (alpine 3.24.1)", Vulnerabilities: null },
      ],
    }),
  ];
  const base = NewFindings.fromGrype({
    matches: [
      grypeMatch("CVE-2026-0002", "busybox", "1.37.0-r0", "Medium", {
        path: "/lib/apk/db/installed",
      }),
    ],
  });
  const justifications = [
    {
      id: "cve-2026-0004",
      package: "debug",
      justification: "The App never enables debug's output.",
    },
    {
      id: "CVE-2025-9999",
      package: "left-pad",
      justification: "Gone since 14.0.90.",
    },
  ];

  test("merges what Grype and Trivy found under one advisory, by its CVE", () => {
    const merged = [...NewFindings.merge(image).values()];
    const undici = merged.find((finding) => {
      return finding.package === "undici";
    });

    expect(merged).toHaveLength(4);
    expect(undici.id).toBe("CVE-2026-0001");
    expect([...undici.aliases]).toEqual(["GHSA-AAAA-BBBB-CCCC"]);
    expect([...undici.scanners].sort()).toEqual(["Grype", "Trivy"]);
    expect([...undici.fixedIn].sort()).toEqual(["6.0.1", "7.0.2"]);
    expect([...undici.paths].sort()).toEqual([
      "/usr/src/Common/node_modules/undici",
      "/usr/src/app/node_modules/undici",
    ]);
  });

  test("sorts findings into inherited, justified and new, and lists the justifications nothing matches", () => {
    const result = NewFindings.classify({ image, base, justifications });
    const ids = (findings) => {
      return findings.map((finding) => {
        return finding.id;
      });
    };

    expect(ids(result.inherited)).toEqual(["CVE-2026-0002"]);
    expect(ids(result.justified)).toEqual(["CVE-2026-0004"]);
    // Most severe first.
    expect(ids(result.new)).toEqual(["CVE-2026-0003", "CVE-2026-0001"]);
    expect(result.unused).toEqual([
      expect.objectContaining({ id: "CVE-2025-9999", package: "left-pad" }),
    ]);
  });

  test("a justification by one of the finding's aliases answers it too", () => {
    const result = NewFindings.classify({
      image,
      base,
      justifications: [
        {
          id: "GHSA-aaaa-bbbb-cccc",
          package: "undici",
          justification: "ProxyAgent is never used.",
        },
      ],
    });

    expect(
      result.justified.map((finding) => {
        return finding.package;
      }),
    ).toEqual(["undici"]);
  });

  test("counts only new findings at or above the threshold as failures", () => {
    const result = NewFindings.classify({ image, base, justifications });

    expect(NewFindings.failures(result, "critical")).toHaveLength(1);
    expect(NewFindings.failures(result, "high")).toHaveLength(2);
    // The medium one is inherited and the low one justified.
    expect(NewFindings.failures(result, "low")).toHaveLength(2);
  });

  test("writes a summary a person can act on", () => {
    const result = NewFindings.classify({ image, base, justifications });
    const markdown = NewFindings.summary(result, {
      title: "oneuptime/app 14.0.101",
      failOn: "high",
    });

    expect(markdown).toContain("oneuptime/app 14.0.101");
    expect(markdown).toContain(
      "| New: need a fix in the release, or a justification in VAT | 2 |",
    );
    expect(markdown).toContain(
      "| Critical | CVE-2026-0003 | tar | 7.0.0 | no fix yet | Grype | /usr/src/app/node_modules/tar |",
    );
    expect(markdown).toContain(
      "| High | CVE-2026-0001 (GHSA-AAAA-BBBB-CCCC) | undici | 6.0.0 | 6.0.1, 7.0.2 | Grype, Trivy |",
    );
    expect(markdown).toContain("- CVE-2025-9999 in left-pad");
    expect(markdown).toContain("**2 new finding(s) at high or above.**");
  });

  test.each([
    [{ id: "CVE-1" }, "has no package"],
    [
      { id: "CVE-1", package: "x", justification: "  " },
      "has no justification",
    ],
    ["CVE-1", "has no id"],
  ])("refuses a justification %j", (entry, message) => {
    expect(() => {
      return NewFindings.readJustifications([entry]);
    }).toThrow(message);
  });

  test("reads an empty justifications file as no justifications", () => {
    expect(NewFindings.readJustifications([])).toEqual([]);
    expect(NewFindings.readJustifications(null)).toEqual([]);
  });

  describe("on the command line", () => {
    let directory;

    beforeAll(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "iron-bank-findings-"));
      const write = (name, content) => {
        fs.writeFileSync(path.join(directory, name), JSON.stringify(content));
      };
      write("grype.json", {
        matches: [grypeMatch("CVE-2026-0004", "debug", "4.0.0", "Low")],
      });
      write("trivy.json", { Results: [] });
      write("justifications.json", []);
    });

    afterAll(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    function run(...extra) {
      return spawnSync(
        process.execPath,
        [
          NEW_FINDINGS,
          "--grype",
          path.join(directory, "grype.json"),
          "--trivy",
          path.join(directory, "trivy.json"),
          "--justifications",
          path.join(directory, "justifications.json"),
          ...extra,
        ],
        { encoding: "utf8" },
      );
    }

    test("exits 0 when no new finding reaches --fail-on, and prints the summary", () => {
      const result = run("--fail-on", "high");

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("| Low | CVE-2026-0004 | debug |");
    });

    test("exits 1 when one does", () => {
      expect(run("--fail-on", "low").status).toBe(1);
    });

    test("exits 2 on a mistake in its arguments", () => {
      const result = run("--fail-on", "severe");

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("--fail-on must be one of");
    });
  });
});
