"use strict";

/**
 * A published Terraform provider release is never changed, and a release is
 * published whole (OneUptime/terraform-provider-oneuptime#20).
 *
 * The Terraform and OpenTofu registries read a version's assets once, when it
 * is published, and keep each zip's SHA-256; `terraform init` and `tofu init`
 * check what GitHub serves against it. A second release run of a version -
 * one repeated after a failure elsewhere in the run - found the provider's
 * tag, "healed" the release by building its assets again, and uploaded them
 * over the published ones with --clobber. GoReleaser does not make the same
 * zip twice, so 14.3.0, 16.0.0, 17.0.0 and 17.1.0 (and older versions)
 * failed init with "checksum list has unexpected SHA-256 hash". The release
 * was also published before its assets were uploaded, so a registry could
 * read it with none.
 *
 * What has to hold now, each pinned here by running publish-terraform-
 * provider.sh itself against a stand-in GitHub, git remote and GoReleaser
 * (Utils/ProviderPublishWorld.js), and by the checks it runs
 * (Scripts/TerraformProvider/ProviderRelease.js):
 *
 *  - A run whose version is published, with every asset its SHA256SUMS lists,
 *    stops before it generates anything, and changes nothing: no build, no
 *    push, no upload. Published without them, or with an asset that is not
 *    what its SHA256SUMS says, it fails, and still changes nothing; so does
 *    --force.
 *  - A release is made as a draft, gets every asset once, is checked against
 *    what was built, and only then is published. A draft that does not match
 *    is never published.
 *  - A run that stopped after pushing its tag is followed by one that builds
 *    from that tag; one that stopped after making its draft, by one that
 *    deletes the draft, by its id, and makes it again.
 *  - What GitHub fails for a moment is asked again; what it cannot answer
 *    stops the run rather than reading as "not published".
 *  - --republish-from publishes a published version's provider again as a new
 *    version, from the same commit, pushing only its tag.
 *  - The release's notes are its own (#19): what changed since the release
 *    before, from both releases' pages, and OneUptime's changes to the
 *    provider between the commits they were generated from, which each
 *    release's commit names.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const {
  assetIdOf,
  describeFile,
  differencesFromBuilt,
  isLatest,
  main,
  parseSums,
  previousRelease,
  problemsOfBuiltAssets,
  problemsOfPublishedRelease,
} = require("../../Scripts/TerraformProvider/ProviderRelease");
const { pagePath, providerPage } = require("./Utils/ProviderDocsPages");
const { commitNamed, shaOf } = require("./Utils/FakeOneUptimeGitHub");
const {
  PLATFORMS,
  PROVIDER,
  ProviderPublishWorld,
  callsOf,
  writesToGitHub,
} = require("./Utils/ProviderPublishWorld");
const { stepCommand } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = "Scripts/TerraformProvider/publish-terraform-provider.sh";
const REPUBLISH_WORKFLOW = ".github/workflows/terraform-provider-republish.yml";
const RELEASES = "repos/OneUptime/terraform-provider-oneuptime/releases";

const RUN_TIMEOUT = 60000;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function sha(text) {
  return require("crypto").createHash("sha256").update(text).digest("hex");
}

function sumsOf(entries) {
  return entries
    .map(([name, hash]) => {
      return `${hash}  ${name}\n`;
    })
    .join("");
}

const VERSION = "1.1.0";
const ZIPS = PLATFORMS.map((platform) => {
  return `${PROVIDER}_${VERSION}_${platform}.zip`;
});
const SUMS = `${PROVIDER}_${VERSION}_SHA256SUMS`;
const SIGNATURE = `${SUMS}.sig`;
const MANIFEST = `${PROVIDER}_${VERSION}_manifest.json`;

function asset(name, hash, extra = {}) {
  return {
    id: extra.id || Math.floor(Math.random() * 1e6),
    name,
    size: extra.size === undefined ? 10 : extra.size,
    digest: hash === null ? null : `sha256:${hash}`,
    state: "uploaded",
    ...extra,
  };
}

// A whole published release of VERSION, with its SHA256SUMS.
function wholeRelease() {
  const hashes = {
    [ZIPS[0]]: sha("zip 0"),
    [ZIPS[1]]: sha("zip 1"),
    [MANIFEST]: sha("manifest"),
  };
  const sums = sumsOf(Object.entries(hashes));
  return {
    sums,
    release: {
      id: 7,
      tag_name: `v${VERSION}`,
      draft: false,
      assets: [
        ...Object.entries(hashes).map(([name, hash]) => {
          return asset(name, hash);
        }),
        asset(SUMS, sha(sums), { id: 99 }),
        asset(SIGNATURE, sha("signature")),
      ],
    },
  };
}

describe("ProviderRelease.js: what a release holds, against what it must", () => {
  test("a draft is a draft as GitHub's REST API says it (draft), or gh does (isDraft)", () => {
    const published =
      "it is published: a run only ever uploads to a draft of its own";
    for (const [release, expected] of [
      [{ draft: true, assets: [] }, []],
      [{ isDraft: true, assets: [] }, []],
      [{ draft: false, assets: [] }, [published]],
      [{ isDraft: false, assets: [] }, [published]],
    ]) {
      expect(differencesFromBuilt(release, [])).toEqual(expected);
    }
  });

  test("reads a SHA256SUMS as GoReleaser and sha256sum write it", () => {
    const upper = "A".repeat(64);
    expect(
      parseSums(
        `${"a".repeat(64)}  one.zip\r\n${"b".repeat(64)} *two.zip\n\nnot a line\n${upper}  three.json  \n`,
      ),
    ).toEqual(
      new Map([
        ["one.zip", "a".repeat(64)],
        ["two.zip", "b".repeat(64)],
        ["three.json", "a".repeat(64)],
      ]),
    );
  });

  describe("a published release", () => {
    test("whole: its SHA256SUMS, the signature, and every file listed, as listed", () => {
      const { release, sums } = wholeRelease();
      expect(problemsOfPublishedRelease(release, VERSION, sums)).toEqual([]);
    });

    test("without its SHA256SUMS, nothing else can be checked", () => {
      const { release, sums } = wholeRelease();
      release.assets = release.assets.filter((each) => {
        return each.name !== SUMS;
      });
      expect(problemsOfPublishedRelease(release, VERSION, sums)).toEqual([
        `it has no ${SUMS}`,
      ]);
    });

    test("without its signature, or a file its SHA256SUMS lists", () => {
      const { release, sums } = wholeRelease();
      release.assets = release.assets.filter((each) => {
        return each.name !== SIGNATURE && each.name !== ZIPS[1];
      });
      expect(problemsOfPublishedRelease(release, VERSION, sums)).toEqual([
        `it has no ${SIGNATURE}`,
        `it has no ${ZIPS[1]}, which its ${SUMS} lists`,
      ]);
    });

    test("with a file that is not what its SHA256SUMS says: rebuilt, as #20's were", () => {
      const { release, sums } = wholeRelease();
      release.assets[0].digest = `sha256:${sha("rebuilt")}`;
      expect(problemsOfPublishedRelease(release, VERSION, sums)).toEqual([
        `its ${ZIPS[0]} has SHA-256 ${sha("rebuilt")}, and its ${SUMS} says ${sha("zip 0")}`,
      ]);
    });

    test("an asset GitHub keeps no SHA-256 of is not taken for a mismatch", () => {
      const { release, sums } = wholeRelease();
      release.assets[0].digest = null;
      expect(problemsOfPublishedRelease(release, VERSION, sums)).toEqual([]);
    });

    test("a SHA256SUMS that lists no zip is no release", () => {
      const { release } = wholeRelease();
      expect(
        problemsOfPublishedRelease(
          release,
          VERSION,
          sumsOf([[MANIFEST, sha("manifest")]]),
        ),
      ).toEqual([`its ${SUMS} lists no zip`]);
    });

    test("the id of an asset, to read it by", () => {
      const { release } = wholeRelease();
      expect(assetIdOf(release, SUMS)).toBe("99");
      expect(assetIdOf(release, "nothing.zip")).toBeNull();
      expect(assetIdOf(null, SUMS)).toBeNull();
    });
  });

  describe("the files built for a release", () => {
    const built = () => {
      const files = [
        { name: ZIPS[0], size: 5, sha256: sha("zip 0") },
        { name: ZIPS[1], size: 5, sha256: sha("zip 1") },
        { name: MANIFEST, size: 8, sha256: sha("manifest") },
        { name: SIGNATURE, size: 3, sha256: sha("signature") },
      ];
      const sums = sumsOf(
        files
          .filter((file) => {
            return file.name !== SIGNATURE;
          })
          .map((file) => {
            return [file.name, file.sha256];
          }),
      );
      files.push({ name: SUMS, size: sums.length, sha256: sha(sums) });
      return { files, sums };
    };

    test("are the whole release", () => {
      const { files, sums } = built();
      expect(problemsOfBuiltAssets(VERSION, files, sums)).toEqual([]);
    });

    test("without a SHA256SUMS, or a signature", () => {
      const { files, sums } = built();
      expect(
        problemsOfBuiltAssets(
          VERSION,
          files.filter((file) => {
            return file.name !== SUMS;
          }),
          "",
        ),
      ).toEqual([`GoReleaser wrote no ${SUMS}`]);
      expect(
        problemsOfBuiltAssets(
          VERSION,
          files.filter((file) => {
            return file.name !== SIGNATURE;
          }),
          sums,
        ),
      ).toEqual([`GoReleaser wrote no ${SIGNATURE}`]);
    });

    test("a file listed and not built, one built and not listed, and one that is not what is listed", () => {
      const { files, sums } = built();
      const changed = files
        .filter((file) => {
          return file.name !== ZIPS[1];
        })
        .map((file) => {
          return file.name === MANIFEST
            ? { ...file, sha256: sha("another manifest") }
            : file;
        });
      changed.push({ name: "stray.zip", size: 1, sha256: sha("stray") });
      expect(problemsOfBuiltAssets(VERSION, changed, sums)).toEqual([
        `${ZIPS[1]} is listed in ${SUMS}, and was not built`,
        `${MANIFEST} has SHA-256 ${sha("another manifest")}, and ${SUMS} says ${sha("manifest")}`,
        `stray.zip was built, and ${SUMS} does not list it`,
      ]);
    });
  });

  describe("a draft, against the files built for it", () => {
    const files = [
      { name: ZIPS[0], size: 10, sha256: sha("zip 0") },
      { name: SUMS, size: 10, sha256: sha("sums") },
    ];
    const draft = (assets) => {
      return { id: 5, draft: true, assets };
    };

    test("holds exactly them", () => {
      expect(
        differencesFromBuilt(
          draft([asset(ZIPS[0], sha("zip 0")), asset(SUMS, sha("sums"))]),
          files,
        ),
      ).toEqual([]);
    });

    test("is never a published release", () => {
      expect(
        differencesFromBuilt(
          {
            draft: false,
            assets: [asset(ZIPS[0], sha("zip 0")), asset(SUMS, sha("sums"))],
          },
          files,
        ),
      ).toEqual([
        "it is published: a run only ever uploads to a draft of its own",
      ]);
      expect(differencesFromBuilt(null, files)).toEqual([
        "there is no release",
      ]);
    });

    test("an asset missing, cut short, other bytes, half uploaded, or not this run's", () => {
      expect(
        differencesFromBuilt(
          draft([
            asset(ZIPS[0], sha("other bytes"), { size: 9, state: "starter" }),
            asset("stale.txt", sha("stale")),
          ]),
          files,
        ),
      ).toEqual([
        `${ZIPS[0]} did not finish uploading (starter)`,
        `${ZIPS[0]} is 9 bytes there, and 10 as built`,
        `${ZIPS[0]} has SHA-256 ${sha("other bytes")} there, and ${sha("zip 0")} as built`,
        `${SUMS} is not on it`,
        "stale.txt is on it, and this run did not build it",
      ]);
    });

    test("describes a built file by its name, size and SHA-256", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "built-"));
      const file = path.join(directory, ZIPS[0]);
      fs.writeFileSync(file, "zip 0");
      try {
        expect(describeFile(file)).toEqual({
          name: ZIPS[0],
          size: 5,
          sha256: sha("zip 0"),
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  describe("the release a version follows, and whether it is the latest", () => {
    const listed = (tag, extra = {}) => {
      return { tagName: tag, isDraft: false, isPrerelease: false, ...extra };
    };
    // As gh lists them, newest first by date: v14.3.1 was published again last.
    const releases = [
      listed("v14.3.1"),
      listed("v17.2.0", { isDraft: true }),
      listed("v17.1.0"),
      listed("v17.1.0-test", { isDraft: true }),
      listed("v17.0.0"),
      listed("v16.9.9", { isPrerelease: true }),
      listed("untagged-123"),
      listed("v16.0.0"),
      listed("v14.3.0"),
    ];

    test("the newest published release older than it, by version, not by date", () => {
      expect(previousRelease(releases, "17.2.0")).toBe("v17.1.0");
      expect(previousRelease(releases, "17.1.0")).toBe("v17.0.0");
      expect(previousRelease(releases, "17.1.1")).toBe("v17.1.0");
      expect(previousRelease(releases, "17.0.0")).toBe("v16.0.0");
      expect(previousRelease(releases, "14.3.1")).toBe("v14.3.0");
      expect(previousRelease(releases, "14.3.0")).toBeNull();
      // A test release's version is read as its x.y.z.
      expect(previousRelease(releases, "17.2.0-test")).toBe("v17.1.0");
    });

    test("the latest unless a published release is newer: a republished older version is not", () => {
      expect(isLatest(releases, "17.2.0")).toBe(true);
      expect(isLatest(releases, "17.1.1")).toBe(true);
      expect(isLatest(releases, "17.1.0")).toBe(true);
      expect(isLatest(releases, "17.0.1")).toBe(false);
      expect(isLatest(releases, "14.3.1")).toBe(false);
      expect(isLatest([], "1.0.0")).toBe(true);
    });

    test("a version it cannot read is an error, not an answer", () => {
      expect(() => {
        return previousRelease(releases, "latest");
      }).toThrow(/not a version/);
    });
  });

  describe("its command line", () => {
    let directory;

    beforeAll(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-release-"));
    });

    afterAll(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    function cli(...argv) {
      const out = [];
      const err = [];
      const status = main(
        argv,
        {
          write: (text) => {
            out.push(text);
          },
        },
        {
          write: (text) => {
            err.push(text);
          },
        },
      );
      return { status, out: out.join(""), err: err.join("") };
    }

    function file(name, text) {
      const written = path.join(directory, name);
      fs.writeFileSync(written, text);
      return written;
    }

    test("says an asset's id, a previous release and whether it is the latest", () => {
      const { release, sums } = wholeRelease();
      const releaseFile = file("release.json", JSON.stringify(release));
      expect(cli("asset-id", releaseFile, SUMS)).toMatchObject({
        status: 0,
        out: "99\n",
      });
      expect(cli("asset-id", releaseFile, "nothing").out).toBe("\n");

      const releases = file(
        "releases.json",
        JSON.stringify([
          { tagName: "v1.1.0", isDraft: false, isPrerelease: false },
          { tagName: "v1.0.0", isDraft: false, isPrerelease: false },
        ]),
      );
      expect(cli("previous", "1.1.0", releases).out).toBe("v1.0.0\n");
      expect(cli("previous", "1.0.0", releases).out).toBe("\n");
      expect(cli("latest", "1.0.1", releases).out).toBe("false\n");
      expect(cli("latest", "1.2.0", releases).out).toBe("true\n");
      expect(cli("latest", "1.2.0", file("empty.json", "")).out).toBe("true\n");

      expect(
        cli("check-published", VERSION, releaseFile, file("sums", sums)),
      ).toMatchObject({ status: 0, out: "" });
    });

    test("a check that finds something exits 1, saying what, a line each", () => {
      const { release, sums } = wholeRelease();
      release.assets = release.assets.filter((each) => {
        return each.name !== SIGNATURE;
      });
      expect(
        cli(
          "check-published",
          VERSION,
          file("incomplete.json", JSON.stringify(release)),
          file("sums2", sums),
        ),
      ).toEqual({ status: 1, out: `it has no ${SIGNATURE}\n`, err: "" });

      const zip = file(ZIPS[0], "zip 0");
      expect(
        cli(
          "check-uploaded",
          file("draft.json", JSON.stringify({ draft: true, assets: [] })),
          zip,
        ),
      ).toEqual({ status: 1, out: `${ZIPS[0]} is not on it\n`, err: "" });
      expect(cli("check-built", VERSION, zip)).toEqual({
        status: 1,
        out: `GoReleaser wrote no ${SUMS}\n`,
        err: "",
      });
    });

    test("a command it does not know, or one short of its arguments, exits 2 with its usage", () => {
      for (const argv of [
        ["nope"],
        [],
        ["state", "release.json"],
        ["asset-id", "release.json"],
        ["check-uploaded", "x"],
      ]) {
        const result = cli(...argv);
        expect(result.status).toBe(2);
        expect(result.err).toMatch(/^Usage:/);
      }
    });
  });
});

/*
 * ------------------------------------------------------------------
 * The script, end to end
 * ------------------------------------------------------------------
 */

const ONEUPTIME_PREVIOUS = shaOf(0x100);
const ONEUPTIME_CURRENT = shaOf(0x200);
const AS_A_RELEASE_RUN = { GITHUB_SHA: ONEUPTIME_CURRENT };

const MONITOR_1_0 = providerPage({
  name: "oneuptime_monitor",
  attributes: { required: { name: {} }, optional: { description: {} } },
});
const MONITOR_1_1 = providerPage({
  name: "oneuptime_monitor",
  attributes: {
    required: { name: {} },
    optional: { description: {}, timeout: { type: "Number" } },
  },
});
const LABEL = providerPage({
  name: "oneuptime_label",
  subcategory: "Labels",
  description: "A label groups resources. It has a color.",
  attributes: { required: { name: {} } },
});

const PAGES_1_0 = { [pagePath("oneuptime_monitor")]: MONITOR_1_0 };
const PAGES_1_1 = {
  [pagePath("oneuptime_monitor")]: MONITOR_1_1,
  [pagePath("oneuptime_label")]: LABEL,
};

const { providerTree } = require("./Utils/ProviderPublishWorld");

function expectRan(result, status = 0) {
  if (result.status !== status) {
    throw new Error(
      `The script exited ${result.status}, not ${status}:\n${result.output}`,
    );
  }
}

function uploadsOf(result) {
  return callsOf(result, "gh")
    .filter((call) => {
      return call.args[0] === "release" && call.args[1] === "upload";
    })
    .map((call) => {
      return path.basename(call.args[3]);
    });
}

function namesAndDigests(release) {
  return new Map(
    release.assets.map((each) => {
      return [each.name, each.digest.replace(/^sha256:/, "")];
    }),
  );
}

describe(`${SCRIPT}, end to end`, () => {
  let world;

  beforeEach(async () => {
    world = await new ProviderPublishWorld().start();
    world.seedRelease("1.0.0", providerTree("1.0.0", PAGES_1_0), {
      oneUptimeCommit: ONEUPTIME_PREVIOUS,
    });
    world.generates(VERSION, PAGES_1_1);
    world.oneUptime.ranges[`${ONEUPTIME_PREVIOUS}...${ONEUPTIME_CURRENT}`] = [
      commitNamed(1, "fix(terraform): a permission is written as its key"),
      commitNamed(2, "fix(ui): a crumb gives way"),
    ];
  });

  afterEach(async () => {
    await world.remove();
  });

  describe("a version not published yet", () => {
    test(
      "is published whole: a draft first, every asset once, checked, then published",
      async () => {
        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result);

        // One commit and its tag, pushed, naming the OneUptime commit.
        const tagged = world.remoteRef(`v${VERSION}`);
        expect(world.remoteRef("master")).toBe(tagged);
        expect(world.commitMessage(`v${VERSION}`)).toMatch(
          new RegExp(`\\n\\nOneUptime-Commit: ${ONEUPTIME_CURRENT}$`),
        );

        // Built once, from that commit.
        const builds = callsOf(result, "goreleaser");
        expect(builds).toHaveLength(1);
        expect(builds[0]).toMatchObject({ tag: `v${VERSION}`, head: tagged });

        // The draft, then each asset once (the signature too), then publishing.
        const writes = writesToGitHub(result);
        expect(writes[0]).toMatchObject({
          method: "POST",
          endpoint: RELEASES,
          fields: {
            tag_name: `v${VERSION}`,
            name: `v${VERSION}`,
            draft: true,
            prerelease: false,
          },
        });
        const built = world.built();
        expect(uploadsOf(result).sort()).toEqual([...built.keys()].sort());
        expect([...built.keys()].sort()).toEqual(
          [...ZIPS, MANIFEST, SUMS, SIGNATURE].sort(),
        );
        const last = writes[writes.length - 1];
        expect(last).toMatchObject({
          method: "PATCH",
          fields: { draft: false, make_latest: "true" },
        });
        expect(writes).toHaveLength(2 + built.size);

        // The draft was read back, and checked, before it was published.
        const draftId = last.endpoint.split("/").pop();
        const calls = callsOf(result, "gh");
        const check = calls.findIndex((call) => {
          return (
            call.method === "GET" && call.endpoint === `${RELEASES}/${draftId}`
          );
        });
        expect(check).toBeGreaterThan(
          calls.findLastIndex((call) => {
            return call.args[1] === "upload";
          }),
        );
        expect(check).toBeLessThan(
          calls.indexOf(
            calls.find((call) => {
              return call.method === "PATCH";
            }),
          ),
        );

        // Published, holding exactly what was built.
        const releases = world.releasesOf(`v${VERSION}`);
        expect(releases).toHaveLength(1);
        expect(releases[0]).toMatchObject({
          draft: false,
          make_latest: "true",
        });
        expect(namesAndDigests(releases[0])).toEqual(built);
        expect(result.output).toContain(
          `Published GitHub release v${VERSION}, the latest`,
        );
      },
      RUN_TIMEOUT,
    );

    test(
      "with notes of its own: what changed since the release before, and OneUptime's changes to the provider",
      async () => {
        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result);

        const body = world.releasesOf(`v${VERSION}`)[0].body;
        expect(body).toMatch(
          /^The provider for \[OneUptime 1\.1\.0\]\(https:\/\/github\.com\/OneUptime\/oneuptime\/releases\/tag\/1\.1\.0\), generated from its API\. \*\*1 new resource, 1 changed resource and 1 change to the provider since \[v1\.0\.0\]/,
        );
        expect(body).toContain(
          "- [`oneuptime_label`](https://registry.terraform.io/providers/oneuptime/oneuptime/1.1.0/docs/resources/label): A label groups resources.",
        );
        expect(body).toContain("- `oneuptime_monitor`: new `timeout`.");
        expect(body).toContain(
          "## 🐛 Bug fixes\n\n- A permission is written as its key",
        );
        expect(body).not.toContain("crumb");
        expect(body).toContain(
          "**Full changelog:** https://github.com/OneUptime/terraform-provider-oneuptime/compare/v1.0.0...v1.1.0",
        );
        expect(body).toContain(
          `**OneUptime's changes:** https://github.com/OneUptime/oneuptime/compare/${ONEUPTIME_PREVIOUS}...${ONEUPTIME_CURRENT}`,
        );

        // OneUptime's GitHub was asked with the run's token, over its URL.
        expect(world.oneUptimeGitHub.requests.length).toBeGreaterThan(0);
        expect(world.oneUptimeGitHub.requests[0]).toEqual({
          url: expect.stringContaining(
            `/repos/OneUptime/oneuptime/compare/${ONEUPTIME_PREVIOUS}...${ONEUPTIME_CURRENT}?`,
          ),
          authorization: "Bearer test-token",
        });

        // And the job's summary shows them.
        expect(result.summary).toContain(`## Terraform provider v${VERSION}`);
        expect(result.summary).toContain(
          "- `oneuptime_monitor`: new `timeout`.",
        );
      },
      RUN_TIMEOUT,
    );

    test(
      "outside a release run, its commit names this checkout's commit",
      async () => {
        const result = await world.run(["--version", VERSION], {
          env: { GITHUB_SHA: undefined },
        });
        expectRan(result);
        expect(world.commitMessage(`v${VERSION}`)).toMatch(
          new RegExp(`OneUptime-Commit: ${world.rootCommit}$`),
        );
      },
      RUN_TIMEOUT,
    );

    test(
      "when GitHub's list of releases cannot be read, it is still published, as the latest, with notes that compare it with none",
      async () => {
        world.changeState((state) => {
          state.garble = ["release list"];
        });
        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result);

        const [release] = world.releasesOf(`v${VERSION}`);
        expect(release).toMatchObject({ draft: false, make_latest: "true" });
        expect(namesAndDigests(release)).toEqual(world.built());
        expect(release.body).toContain(
          "There is no earlier release to compare it with.",
        );
      },
      RUN_TIMEOUT,
    );

    test(
      "what GitHub fails for a moment is asked again",
      async () => {
        world.changeState((state) => {
          state.failures = [{ match: `release upload v${VERSION}`, times: 1 }];
        });
        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result);

        expect(
          callsOf(result, "sleep").map((call) => {
            return call.seconds;
          }),
        ).toEqual(["5"]);
        const uploads = uploadsOf(result);
        expect(uploads).toHaveLength(world.built().size + 1);
        expect(new Set(uploads).size).toBe(world.built().size);
        expect(namesAndDigests(world.releasesOf(`v${VERSION}`)[0])).toEqual(
          world.built(),
        );
      },
      RUN_TIMEOUT,
    );

    test(
      "GitHub that cannot say whether it is published stops the run before anything is generated",
      async () => {
        world.changeState((state) => {
          state.failures = [{ match: "releases/tags/v1.1.0", times: 4 }];
        });
        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result, 1);

        expect(result.output).toContain(
          "Could not tell whether v1.1.0 of OneUptime/terraform-provider-oneuptime is published. GitHub said: gh: Bad Gateway (HTTP 502)",
        );
        expect(
          callsOf(result, "sleep").map((call) => {
            return call.seconds;
          }),
        ).toEqual(["5", "15", "30"]);
        expect(callsOf(result, "npm")).toEqual([]);
        expect(world.remoteRefOrNull(`v${VERSION}`)).toBeNull();
      },
      RUN_TIMEOUT,
    );
  });

  describe("a version published already", () => {
    test(
      "is left as it is: a second run builds, pushes and uploads nothing (#20)",
      async () => {
        expectRan(
          await world.run(["--version", VERSION], { env: AS_A_RELEASE_RUN }),
        );
        const published = world.releasesOf(`v${VERSION}`);
        const master = world.remoteRef("master");
        const tag = world.remoteRef(`v${VERSION}`);

        // A generation now would differ: the release run is repeated later.
        world.generates(VERSION, {
          ...PAGES_1_1,
          [pagePath("oneuptime_team")]: providerPage({
            name: "oneuptime_team",
          }),
        });
        const again = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(again);

        expect(again.output).toContain(
          `v${VERSION} is published already, with every asset its SHA256SUMS lists. A published release is never changed: there is nothing to do.`,
        );
        expect(writesToGitHub(again)).toEqual([]);
        expect(callsOf(again, "npm")).toEqual([]);
        expect(callsOf(again, "goreleaser")).toEqual([]);
        expect(
          callsOf(again, "go").map((call) => {
            return call.args;
          }),
        ).toEqual(["version"]);
        expect(world.releasesOf(`v${VERSION}`)).toEqual(published);
        expect(world.remoteRef("master")).toBe(master);
        expect(world.remoteRef(`v${VERSION}`)).toBe(tag);
      },
      RUN_TIMEOUT,
    );

    test(
      "without every asset, fails, uploads nothing, and says to publish a new version",
      async () => {
        world.publishOnGitHub(`v${VERSION}`);
        world.changeState((state) => {
          const release = state.releases.find((each) => {
            return each.tag_name === `v${VERSION}`;
          });
          release.assets = release.assets.filter((each) => {
            return each.name !== ZIPS[1];
          });
        });
        const before = world.releasesOf(`v${VERSION}`);

        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result, 1);

        expect(result.output).toContain(`v${VERSION} is published, but:`);
        expect(result.output).toContain(
          `  - it has no ${ZIPS[1]}, which its ${SUMS} lists`,
        );
        expect(result.output).toContain(
          "A published release is never changed, since the registries may have read it already. Publish the provider as a new version: bump VERSION, or run this script with --republish-from v1.1.0 --version <the next patch version>.",
        );
        expect(writesToGitHub(result)).toEqual([]);
        expect(callsOf(result, "goreleaser")).toEqual([]);
        expect(world.releasesOf(`v${VERSION}`)).toEqual(before);
      },
      RUN_TIMEOUT,
    );

    test(
      "with an asset that is not what its SHA256SUMS says, fails and changes nothing",
      async () => {
        world.publishOnGitHub(`v${VERSION}`);
        world.changeState((state) => {
          const release = state.releases.find((each) => {
            return each.tag_name === `v${VERSION}`;
          });
          release.assets.find((each) => {
            return each.name === ZIPS[0];
          }).digest = `sha256:${sha("rebuilt")}`;
        });

        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result, 1);
        expect(result.output).toContain(
          `  - its ${ZIPS[0]} has SHA-256 ${sha("rebuilt")}, and its ${SUMS} says`,
        );
        expect(writesToGitHub(result)).toEqual([]);
      },
      RUN_TIMEOUT,
    );

    test(
      "is not changed by --force either",
      async () => {
        world.publishOnGitHub(`v${VERSION}`);
        const before = world.state().releases;
        const result = await world.run(["--version", VERSION, "--force"], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result, 1);
        expect(result.output).toContain(
          "v1.1.0 is published, and --force does not change a published release either",
        );
        expect(writesToGitHub(result)).toEqual([]);
        expect(callsOf(result, "npm")).toEqual([]);
        expect(world.state().releases).toEqual(before);
      },
      RUN_TIMEOUT,
    );

    test(
      "while this run built its assets: nothing is uploaded",
      async () => {
        const result = await world.run(["--version", VERSION], {
          env: { ...AS_A_RELEASE_RUN, FAKE_GORELEASER_PUBLISH_MEANWHILE: "1" },
        });
        expectRan(result, 1);
        expect(result.output).toContain(
          "v1.1.0 was published while this run built its assets. A published release is never changed: this run uploads nothing.",
        );
        expect(writesToGitHub(result)).toEqual([]);
        expect(world.releasesOf(`v${VERSION}`)).toEqual([
          expect.objectContaining({ draft: false, assets: [] }),
        ]);
      },
      RUN_TIMEOUT,
    );
  });

  describe("a version an earlier run stopped halfway", () => {
    test(
      "after pushing its tag: is built from that tag, not from a new generation, and pushes nothing",
      async () => {
        world.changeState((state) => {
          state.failures = [{ match: `api POST ${RELEASES}`, times: 4 }];
        });
        const stopped = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(stopped, 1);
        const tag = world.remoteRef(`v${VERSION}`);
        const master = world.remoteRef("master");
        expect(world.releasesOf(`v${VERSION}`)).toEqual([]);

        world.generates(VERSION, {
          ...PAGES_1_1,
          [pagePath("oneuptime_team")]: providerPage({
            name: "oneuptime_team",
          }),
        });
        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result);

        expect(result.output).toContain(
          "Healing mode: the release will be built from the exact commit the remote tag points to.",
        );
        expect(callsOf(result, "goreleaser")[0].head).toBe(tag);
        expect(world.remoteRef(`v${VERSION}`)).toBe(tag);
        expect(world.remoteRef("master")).toBe(master);
        const [release] = world.releasesOf(`v${VERSION}`);
        expect(release.draft).toBe(false);
        expect(namesAndDigests(release)).toEqual(world.built());
        // Its notes are the tag's: no oneuptime_team in them.
        expect(release.body).not.toContain("oneuptime_team");
        expect(release.body).toContain("oneuptime_label");
      },
      RUN_TIMEOUT,
    );

    test(
      "after making its draft: the draft is deleted, by its id, and made again",
      async () => {
        world.changeState((state) => {
          state.failures = [{ match: "api PATCH", times: 4 }];
        });
        expectRan(
          await world.run(["--version", VERSION], { env: AS_A_RELEASE_RUN }),
          1,
        );
        const [left] = world.releasesOf(`v${VERSION}`);
        expect(left.draft).toBe(true);
        // What a run before this fix might have left on it, too.
        world.changeState((state) => {
          state.releases
            .find((each) => {
              return each.id === left.id;
            })
            .assets.push(
              asset("stale.txt", sha("stale"), { file: "/dev/null" }),
            );
        });

        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result);

        const writes = writesToGitHub(result);
        expect(writes[0]).toMatchObject({
          method: "DELETE",
          endpoint: `${RELEASES}/${left.id}`,
        });
        expect(writes[1]).toMatchObject({ method: "POST", endpoint: RELEASES });
        const releases = world.releasesOf(`v${VERSION}`);
        expect(releases).toHaveLength(1);
        expect(releases[0].id).not.toBe(left.id);
        expect(releases[0].draft).toBe(false);
        expect(namesAndDigests(releases[0])).toEqual(world.built());
      },
      RUN_TIMEOUT,
    );
  });

  describe("a release that is not what was built", () => {
    test(
      "a draft whose asset is other bytes is never published",
      async () => {
        world.changeState((state) => {
          state.corruptUploads = [ZIPS[1]];
        });
        const result = await world.run(["--version", VERSION], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result, 1);

        expect(result.output).toMatch(
          /Draft \d+ of v1\.1\.0 is not what was built, so it is not published:/,
        );
        expect(result.output).toContain(`  - ${ZIPS[1]} is `);
        expect(
          writesToGitHub(result).filter((call) => {
            return call.method === "PATCH";
          }),
        ).toEqual([]);
        expect(world.releasesOf(`v${VERSION}`)[0].draft).toBe(true);
      },
      RUN_TIMEOUT,
    );

    test(
      "a build without its signature pushes nothing",
      async () => {
        const master = world.remoteRef("master");
        const result = await world.run(["--version", VERSION], {
          env: { ...AS_A_RELEASE_RUN, FAKE_GORELEASER_NO_SIGNATURE: "1" },
        });
        expectRan(result, 1);

        expect(result.output).toContain(
          "The release assets GoReleaser built are not a whole release:",
        );
        expect(result.output).toContain(`  - GoReleaser wrote no ${SIGNATURE}`);
        expect(world.remoteRefOrNull(`v${VERSION}`)).toBeNull();
        expect(world.remoteRef("master")).toBe(master);
        expect(writesToGitHub(result)).toEqual([]);
      },
      RUN_TIMEOUT,
    );

    test(
      "a provider whose tests fail pushes nothing",
      async () => {
        const result = await world.run(["--version", VERSION], {
          env: { ...AS_A_RELEASE_RUN, FAKE_GO_TEST_FAILS: "1" },
        });
        expectRan(result, 1);
        expect(result.output).toContain(
          "go test failed. Aborting before anything is pushed or released.",
        );
        expect(callsOf(result, "goreleaser")).toEqual([]);
        expect(world.remoteRefOrNull(`v${VERSION}`)).toBeNull();
        expect(writesToGitHub(result)).toEqual([]);
      },
      RUN_TIMEOUT,
    );
  });

  describe("--republish-from", () => {
    beforeEach(() => {
      world.seedRelease(VERSION, providerTree(VERSION, PAGES_1_1), {
        oneUptimeCommit: ONEUPTIME_CURRENT,
      });
    });

    test(
      "publishes a published version's provider again, from its commit, pushing only the new tag",
      async () => {
        const master = world.remoteRef("master");
        const original = world.remoteRef("v1.0.0");

        const result = await world.run(
          ["--republish-from", "v1.0.0", "--version", "1.0.1"],
          { env: AS_A_RELEASE_RUN },
        );
        expectRan(result);

        expect(callsOf(result, "npm")).toEqual([]);
        expect(world.remoteRef("v1.0.1")).toBe(original);
        expect(world.remoteRef("master")).toBe(master);
        expect(callsOf(result, "goreleaser")[0]).toMatchObject({
          tag: "v1.0.1",
          head: original,
        });

        const [release] = world.releasesOf("v1.0.1");
        expect(release).toMatchObject({ draft: false, make_latest: "false" });
        expect([...namesAndDigests(release).keys()].sort()).toEqual(
          [
            `${PROVIDER}_1.0.1_darwin_arm64.zip`,
            `${PROVIDER}_1.0.1_linux_amd64.zip`,
            `${PROVIDER}_1.0.1_manifest.json`,
            `${PROVIDER}_1.0.1_SHA256SUMS`,
            `${PROVIDER}_1.0.1_SHA256SUMS.sig`,
          ].sort(),
        );
        expect(release.body).toMatch(
          /^This is \[v1\.0\.0\]\(https:\/\/github\.com\/OneUptime\/terraform-provider-oneuptime\/releases\/tag\/v1\.0\.0\)'s provider, published again as v1\.0\.1/,
        );
        // The release it publishes again is not touched.
        expect(world.releasesOf("v1.0.0")[0].assets).toHaveLength(5);
        expect(result.output).toContain(
          "Published v1.0.0's provider again, as v1.0.1!",
        );

        // Run again: published already, so nothing.
        const again = await world.run(
          ["--republish-from", "v1.0.0", "--version", "1.0.1"],
          { env: AS_A_RELEASE_RUN },
        );
        expectRan(again);
        expect(writesToGitHub(again)).toEqual([]);
        expect(callsOf(again, "goreleaser")).toEqual([]);
      },
      RUN_TIMEOUT,
    );

    test(
      "of the newest version, the new one is the latest",
      async () => {
        const result = await world.run(
          ["--republish-from", "1.1.0", "--version", "1.1.1"],
          { env: AS_A_RELEASE_RUN },
        );
        expectRan(result);
        expect(world.releasesOf("v1.1.1")[0]).toMatchObject({
          draft: false,
          make_latest: "true",
        });
      },
      RUN_TIMEOUT,
    );

    test(
      "when GitHub's list of releases cannot be read, the version published again is not made the latest",
      async () => {
        world.changeState((state) => {
          state.garble = ["release list"];
        });
        const result = await world.run(
          ["--republish-from", "v1.0.0", "--version", "1.0.1"],
          { env: AS_A_RELEASE_RUN },
        );
        expectRan(result);
        expect(world.releasesOf("v1.0.1")[0]).toMatchObject({
          draft: false,
          make_latest: "false",
        });
      },
      RUN_TIMEOUT,
    );

    test(
      "of a version that is not published, stops before it builds anything",
      async () => {
        const result = await world.run(
          ["--republish-from", "v0.9.0", "--version", "0.9.1"],
          { env: AS_A_RELEASE_RUN },
        );
        expectRan(result, 1);
        expect(result.output).toContain(
          "v0.9.0 is not a published release of OneUptime/terraform-provider-oneuptime, so there is no provider of it to publish again.",
        );
        expect(callsOf(result, "goreleaser")).toEqual([]);
        expect(world.remoteRefOrNull("v0.9.1")).toBeNull();
      },
      RUN_TIMEOUT,
    );

    test(
      "takes neither its own version nor --force, nor a tag that is not a version",
      async () => {
        for (const [args, said] of [
          [
            ["--republish-from", "v1.0.0", "--version", "1.0.0"],
            "--version must name another one",
          ],
          [
            ["--republish-from", "v1.0.0", "--version", "1.0.1", "--force"],
            "use one or the other",
          ],
          [
            ["--republish-from", "latest", "--version", "1.0.1"],
            "--republish-from takes a published release's tag, as v17.1.0. Got: latest",
          ],
        ]) {
          const result = await world.run(args, { env: AS_A_RELEASE_RUN });
          expectRan(result, 1);
          expect(result.output).toContain(said);
          expect(result.calls).toEqual([]);
        }
      },
      RUN_TIMEOUT,
    );
  });

  describe("runs that publish nothing", () => {
    test(
      "a provider that did not change is not published",
      async () => {
        world.generates("1.0.5", PAGES_1_0);
        const result = await world.run(["--version", "1.0.5"], {
          env: AS_A_RELEASE_RUN,
        });
        expectRan(result);
        expect(result.output).toContain(
          "No provider changes detected compared to remote (ignoring VERSION). Skipping publish entirely for v1.0.5.",
        );
        expect(world.remoteRefOrNull("v1.0.5")).toBeNull();
        expect(writesToGitHub(result)).toEqual([]);
        expect(callsOf(result, "goreleaser")).toEqual([]);
      },
      RUN_TIMEOUT,
    );

    test(
      "a dry run asks GitHub nothing, and still writes the notes to the job's summary",
      async () => {
        const master = world.remoteRef("master");
        const result = await world.run(
          ["--version", "1.1.0-test", "--test-release", "--dry-run"],
          { withToken: false, env: AS_A_RELEASE_RUN },
        );
        expectRan(result);

        expect(callsOf(result, "gh")).toEqual([]);
        expect(callsOf(result, "goreleaser")).toHaveLength(1);
        expect(world.remoteRef("master")).toBe(master);
        expect(world.remoteRefOrNull("v1.1.0-test")).toBeNull();
        expect(result.summary).toContain("## Terraform provider v1.1.0-test");
        expect(result.summary).toContain(
          "There is no earlier release to compare it with.",
        );
      },
      RUN_TIMEOUT,
    );

    test(
      "a test release is left a draft, whole and checked",
      async () => {
        const result = await world.run(
          ["--version", "1.1.0-test", "--test-release"],
          { env: AS_A_RELEASE_RUN },
        );
        expectRan(result);
        const [release] = world.releasesOf("v1.1.0-test");
        expect(release.draft).toBe(true);
        expect(namesAndDigests(release)).toEqual(world.built());
        expect(
          writesToGitHub(result).filter((call) => {
            return call.method === "PATCH";
          }),
        ).toEqual([]);
        expect(result.output).toContain("stays a draft (it is not published)");
      },
      RUN_TIMEOUT,
    );
  });
});

/*
 * ------------------------------------------------------------------
 * The order of the script, and the workflows that run it
 * ------------------------------------------------------------------
 */

// The names of the functions `main` calls, in order.
function callsInMain(script) {
  const start = script.indexOf("\nmain() {");
  const body = script.slice(start, script.indexOf("\n}\n", start));
  return body
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return /^[a-z_]+$/.test(line);
    });
}

describe(`${SCRIPT}'s order`, () => {
  const calls = callsInMain(read(SCRIPT));
  const at = (name) => {
    expect(calls).toContain(name);
    return calls.indexOf(name);
  };

  test("asks whether the version is published before it generates anything", () => {
    expect(at("check_published_release")).toBeLessThan(at("generate_provider"));
  });

  test("builds, pushes, writes the notes, drafts, uploads, checks, then publishes", () => {
    const order = [
      "build_release_assets",
      "push_repository_changes",
      "write_release_notes",
      "create_draft_release",
      "upload_release_assets",
      "verify_release_assets",
      "publish_release",
    ].map(at);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  test("makes and publishes a release by its id, and replaces an asset only on its own draft", () => {
    // The script's code, without its comments.
    const code = read(SCRIPT)
      .split("\n")
      .filter((line) => {
        return !line.trim().startsWith("#");
      })
      .join("\n");

    // gh finds a release by its tag as a published one or a draft, whichever
    // it finds first: `release create` and `release edit` are not used.
    expect(code).not.toMatch(/release (create|edit|delete)\b/);
    // --clobber goes with the one upload, to this run's own draft.
    expect(code.match(/--clobber/g)).toHaveLength(1);
    expect(code).toMatch(
      /release upload "v\$VERSION" "\$file" --repo "\$REPOSITORY" --clobber/,
    );
    // Every DELETE names a draft listed by id.
    expect(code.match(/api -X DELETE/g)).toHaveLength(1);
    expect(code).toContain(
      'select(.draft and .tag_name == \\"v$VERSION\\") | .id',
    );
  });
});

function jobOf(workflowFile, id) {
  return yaml.load(read(workflowFile)).jobs[id];
}

describe("the jobs that publish the provider", () => {
  const release = jobOf(
    ".github/workflows/release.yml",
    "publish-terraform-provider",
  );
  const republish = jobOf(REPUBLISH_WORKFLOW, "republish-terraform-provider");

  test.each([
    ["release.yml publish-terraform-provider", release],
    [
      "terraform-provider-republish.yml republish-terraform-provider",
      republish,
    ],
  ])("%s publishes one at a time, cancelling none", (_name, job) => {
    expect(job.concurrency).toEqual({
      group: "terraform-provider-repository",
      "cancel-in-progress": false,
    });
  });
});

describe(REPUBLISH_WORKFLOW, () => {
  const workflow = yaml.load(read(REPUBLISH_WORKFLOW));
  const job = workflow.jobs["republish-terraform-provider"];
  const steps = job.steps;
  const publish = steps.find((step) => {
    return step.name === "Publish the provider again";
  });

  test("is run by hand, with the version to publish again and the new one", () => {
    const on = workflow.on === undefined ? workflow[true] : workflow.on;
    expect(Object.keys(on)).toEqual(["workflow_dispatch"]);
    expect(on.workflow_dispatch.inputs).toEqual({
      from: expect.objectContaining({ required: true, type: "string" }),
      version: expect.objectContaining({ required: true, type: "string" }),
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  test("runs the publish script with --republish-from, its inputs and secrets through env", () => {
    expect(stepCommand(publish)).toBe(
      `bash ./${SCRIPT} --republish-from "$FROM" --version "$VERSION"`,
    );
    expect(publish.env).toEqual({
      FROM: "${{ inputs.from }}",
      VERSION: "${{ inputs.version }}",
      GITHUB_TOKEN: "${{ secrets.SIMLARSEN_GITHUB_PAT }}",
      GPG_PRIVATE_KEY: "${{ secrets.GPG_PRIVATE_KEY }}",
      TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY:
        "${{ secrets.TERRAFORM_PROVIDER_GITHUB_REPO_DEPLOY_KEY }}",
    });
    for (const step of steps) {
      expect(stepCommand(step)).not.toMatch(/\$\{\{\s*(inputs|secrets)\./);
    }
  });

  test("builds as the release does: Go's memory limit, no Go cache, GoReleaser v2, the signing key checked first", () => {
    const limit = read("Scripts/TerraformProvider/Core/GoCommand.ts").match(
      /^export const GO_MEMORY_LIMIT: string = "([^"]+)";$/m,
    )[1];
    expect(job.env.GOMEMLIMIT).toBe(limit);

    const uses = (prefix) => {
      return steps.find((step) => {
        return String(step.uses || "").startsWith(prefix);
      });
    };
    expect(uses("actions/setup-go@").with).toMatchObject({ cache: false });
    expect(uses("goreleaser/goreleaser-action@").with).toMatchObject({
      "install-only": true,
      version: "~> v2",
    });
    // The commit that the run is for, as every checkout here.
    expect(uses("actions/checkout@").with).toBeUndefined();

    const gpg = steps.findIndex((step) => {
      return step.name === "Import GPG key";
    });
    expect(gpg).toBeGreaterThan(-1);
    expect(gpg).toBeLessThan(steps.indexOf(publish));
    expect(stepCommand(steps[gpg])).toContain(
      "gpg --list-secret-keys --keyid-format=long | grep -q '^sec'",
    );
  });
});
