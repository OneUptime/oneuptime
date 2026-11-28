/*
 * Scripts/Release/AttachReleaseAssets.js: the files of a release run go to
 * its own draft of OneUptime's GitHub release, by the draft's id, and never
 * over a published release's (#11466).
 *
 * The apt and yum indexes, the Homebrew cask and the winget manifest record
 * the SHA-256 of the infrastructure agent's packages and archives on a
 * published release. finalize-github-release attached them with
 * softprops/action-gh-release, by the tag, which finds a published release of
 * the tag before a draft and replaced its assets of the same names: a second
 * release run of a published version would have put its own build there, as
 * the Terraform provider's second runs did to its zips (#11016).
 *
 * The script runs here against a stand-in GitHub (Utils/FakeGitHubReleases),
 * which, as GitHub does without immutable releases, takes uploads to a
 * published release too: each test says what reached it.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const {
  FakeGitHubReleases,
  REPOSITORY,
  sha256,
} = require("./Utils/FakeGitHubReleases");
const {
  DEFAULT_DELAYS,
  differencesFromChecksums,
  main,
  parseArguments,
} = require("../../Scripts/Release/AttachReleaseAssets");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "Scripts",
  "Release",
  "AttachReleaseAssets.js",
);
const TAG = "18.1.0";
const DRAFT = 4242;
const TOKEN = "ghs_standin";

let fake;
let dir;

beforeEach(async () => {
  fake = await new FakeGitHubReleases().start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "attach-release-assets-"));
});

afterEach(async () => {
  await fake.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

// A file this run built, in its own directory, as the artifact puts them.
function built(name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

// The infrastructure agent's files: two archives and the checksums file.
function agentBuild(suffix = "") {
  const archive = built(
    "oneuptime-infrastructure-agent_linux_amd64.tar.gz",
    `linux archive${suffix}`,
  );
  const zip = built(
    "oneuptime-infrastructure-agent_windows_amd64.zip",
    `windows zip${suffix}`,
  );
  const sums = built(
    `oneuptime_${TAG}_checksums.txt`,
    [archive, zip]
      .map((file) => {
        return `${sha256(fs.readFileSync(file))}  ${path.basename(file)}`;
      })
      .join("\n") + "\n",
  );
  return { archive, zip, sums, files: [archive, zip, sums] };
}

async function attach(
  files,
  { whenPublished, releaseId = DRAFT, tag = TAG, env = {} } = {},
) {
  let out = "";
  let err = "";
  const waits = [];
  const argv = [
    "--repository",
    REPOSITORY,
    "--release-id",
    String(releaseId),
    "--tag",
    tag,
    ...(whenPublished ? ["--when-published", whenPublished] : []),
    ...files,
  ];
  const status = await main(argv, {
    env: {
      GITHUB_TOKEN: TOKEN,
      GITHUB_API_URL: fake.url,
      GITHUB_UPLOADS_URL: fake.url,
      ...env,
    },
    out: {
      write: (text) => {
        out += text;
      },
    },
    err: {
      write: (text) => {
        err += text;
      },
    },
    wait: async (seconds) => {
      waits.push(seconds);
    },
  });
  return { status, out, err, waits };
}

function uploads() {
  return fake.requests.filter((request) => {
    return request.method === "POST";
  });
}

describe("on the run's own draft", () => {
  test("uploads each file once, to the draft's own upload URL, by its id", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const { files } = agentBuild();

    const result = await attach(files);

    expect(result.status).toBe(0);
    expect(result.err).toBe("");
    expect(
      uploads().map((request) => {
        return `${request.path}?name=${request.name}`;
      }),
    ).toEqual(
      files.map((file) => {
        return `/repos/${REPOSITORY}/releases/${DRAFT}/assets?name=${path.basename(file)}`;
      }),
    );
    for (const request of uploads()) {
      expect(request.contentType).toBe("application/octet-stream");
      expect(request.authorization).toBe(`Bearer ${TOKEN}`);
    }
    for (const file of files) {
      const asset = fake.assetNamed(DRAFT, path.basename(file));
      expect(asset).toMatchObject({
        size: fs.statSync(file).size,
        state: "uploaded",
        digest: `sha256:${sha256(fs.readFileSync(file))}`,
      });
    }
    expect(result.out).toContain(
      `Draft ${DRAFT} holds the 3 file(s), each whole, with the SHA-256 it was built with.`,
    );
  });

  test("reads the release by its id only, never by its tag", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    await attach(agentBuild().files);

    const reads = fake.requests.filter((request) => {
      return request.method === "GET";
    });
    expect(reads.length).toBeGreaterThan(0);
    for (const request of fake.requests) {
      expect(request.path).not.toContain("/releases/tags/");
      expect(request.path).not.toMatch(/\/releases$/);
    }
    for (const request of reads) {
      expect(request.path).toBe(`/repos/${REPOSITORY}/releases/${DRAFT}`);
    }
  });

  test("reads the draft again before each file, as GitHub has it then", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const { files } = agentBuild();
    await attach(files);

    // One read before anything, one before each file, one to check.
    expect(
      fake.requests.map((request) => {
        return request.method;
      }),
    ).toEqual(["GET", "GET", "POST", "GET", "POST", "GET", "POST", "GET"]);
  });

  test("keeps a file the draft holds whole with the same bytes, and sends it again never", async () => {
    const { archive, files } = agentBuild();
    fake.addRelease({
      id: DRAFT,
      tag: TAG,
      assets: [
        { name: path.basename(archive), bytes: fs.readFileSync(archive) },
      ],
    });

    const result = await attach(files);

    expect(result.status).toBe(0);
    expect(
      uploads().map((request) => {
        return request.name;
      }),
    ).toEqual(
      files.slice(1).map((file) => {
        return path.basename(file);
      }),
    );
    expect(result.out).toContain(
      `✓ ${path.basename(archive)} is on draft ${DRAFT} already`,
    );
  });

  test.each([
    ["did not finish uploading", { state: "starter" }],
    ["is other bytes", { bytes: "an earlier, other build" }],
    ["has no SHA-256 GitHub keeps", { digest: null }],
  ])(
    "replaces an upload that %s, deleting it by its id first",
    async (_why, held) => {
      const { archive, files } = agentBuild();
      fake.addRelease({ id: DRAFT, tag: TAG });
      const old = fake.addAsset(DRAFT, {
        name: path.basename(archive),
        bytes: fs.readFileSync(archive),
        ...held,
      });

      const result = await attach(files);

      expect(result.status).toBe(0);
      expect(fake.writes()[0]).toMatchObject({
        method: "DELETE",
        path: `/repos/${REPOSITORY}/releases/assets/${old.id}`,
      });
      expect(fake.writes()[1]).toMatchObject({
        method: "POST",
        name: path.basename(archive),
      });
      expect(fake.assetNamed(DRAFT, path.basename(archive))).toMatchObject({
        state: "uploaded",
        digest: `sha256:${sha256(fs.readFileSync(archive))}`,
      });
      expect(result.out).toContain(
        `holds an upload of ${path.basename(archive)} that did not finish, or other bytes (asset ${old.id}): replacing it`,
      );
    },
  );

  test("leaves the draft's other files alone: the SBOMs and apps share it", async () => {
    fake.addRelease({
      id: DRAFT,
      tag: TAG,
      assets: [{ name: "app-18.1.0-linux-amd64.cdx.json", bytes: "sbom" }],
    });

    const result = await attach(agentBuild().files);

    expect(result.status).toBe(0);
    expect(
      fake.assetNamed(DRAFT, "app-18.1.0-linux-amd64.cdx.json"),
    ).toBeDefined();
    expect(
      fake.writes().filter((request) => {
        return request.method === "DELETE";
      }),
    ).toEqual([]);
  });

  test("tries an upload that fails again, planned anew from what GitHub holds", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const { archive, files } = agentBuild();
    let failures = 2;
    fake.faults.push((request) => {
      if (request.method === "POST" && failures > 0) {
        failures--;
        return { status: 502, body: { message: "Bad Gateway" } };
      }
      return undefined;
    });

    const result = await attach(files);

    expect(result.status).toBe(0);
    expect(result.waits).toEqual([DEFAULT_DELAYS[0], DEFAULT_DELAYS[1]]);
    expect(
      uploads().filter((request) => {
        return request.name === path.basename(archive);
      }),
    ).toHaveLength(3);
    expect(result.out).toContain(
      `Uploading ${path.basename(archive)} failed (HTTP 502: Bad Gateway, try 1 of 4); trying again in 5s.`,
    );
    expect(fake.release(DRAFT).assets).toHaveLength(3);
  });

  test("an answer that was lost after GitHub kept the upload is not sent twice", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const { archive, files } = agentBuild();
    fake.faults.push((request) => {
      if (
        request.method === "POST" &&
        request.name === path.basename(archive)
      ) {
        return {
          once: true,
          passThrough: true,
          answer: { status: 504, body: { message: "Gateway Timeout" } },
        };
      }
      return undefined;
    });

    const result = await attach(files);

    expect(result.status).toBe(0);
    expect(
      uploads().filter((request) => {
        return request.name === path.basename(archive);
      }),
    ).toHaveLength(1);
    expect(result.out).toContain(
      `✓ ${path.basename(archive)} is on draft ${DRAFT} already`,
    );
  });

  test("an upload cut short is deleted by its id and made again", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const { archive, files } = agentBuild();
    // GitHub keeps an upload whose connection broke as "starter".
    fake.faults.push((request) => {
      if (
        request.method === "POST" &&
        request.name === path.basename(archive)
      ) {
        return {
          once: true,
          passThrough: true,
          keptState: "starter",
          answer: { destroy: true },
        };
      }
      return undefined;
    });

    const result = await attach(files);

    expect(result.status).toBe(0);
    const writes = fake.writes().map((request) => {
      return `${request.method} ${request.name || request.path}`;
    });
    expect(writes.slice(0, 3)).toEqual([
      `POST ${path.basename(archive)}`,
      expect.stringMatching(
        /^DELETE \/repos\/OneUptime\/oneuptime\/releases\/assets\/\d+$/,
      ),
      `POST ${path.basename(archive)}`,
    ]);
    expect(fake.assetNamed(DRAFT, path.basename(archive)).state).toBe(
      "uploaded",
    );
  });

  test("an upload that fails every time leaves the draft unpublished, and fails", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    fake.faults.push((request) => {
      return request.method === "POST"
        ? { status: 500, body: { message: "Internal Server Error" } }
        : undefined;
    });

    const result = await attach(agentBuild().files);

    expect(result.status).toBe(1);
    expect(result.waits).toEqual(DEFAULT_DELAYS);
    expect(result.err).toContain(
      "::error::could not upload oneuptime-infrastructure-agent_linux_amd64.tar.gz: HTTP 500: Internal Server Error",
    );
    expect(uploads()).toHaveLength(DEFAULT_DELAYS.length + 1);
    expect(fake.release(DRAFT).draft).toBe(true);
  });

  test("a draft published while it is filled gets nothing more", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const { files } = agentBuild();
    fake.afterRequest.push((request) => {
      if (request.method === "POST") {
        fake.release(DRAFT).draft = false;
      }
    });

    const result = await attach(files);

    expect(result.status).toBe(1);
    expect(uploads()).toHaveLength(1);
    expect(result.err).toContain(
      `::error::not attaching ${path.basename(files[1])} to release ${DRAFT}: it was published while this run filled it, and a published release is never changed`,
    );
  });

  test("a draft that does not hold what was sent, at the end, is not to be published", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const { archive, files } = agentBuild();
    // GitHub kept other bytes than were sent, and said it took them.
    fake.faults.push((request) => {
      if (
        request.method === "POST" &&
        request.name === path.basename(archive)
      ) {
        return {
          once: true,
          passThrough: true,
          keptBytes: "corrupted on the way",
          answer: { status: 201, body: {} },
        };
      }
      return undefined;
    });

    const result = await attach(files);

    expect(result.status).toBe(1);
    expect(result.err).toContain(
      `::error::${path.basename(archive)} is ${"corrupted on the way".length} bytes there, and ${fs.statSync(archive).size} as built`,
    );
    expect(result.err).toContain(
      `Draft ${DRAFT} of ${TAG} does not hold what this run built, so it must not be published.`,
    );
  });

  test("a release that is not the version's, or is gone, gets nothing", async () => {
    fake.addRelease({ id: DRAFT, tag: "18.0.9" });

    const other = await attach(agentBuild().files);
    expect(other.status).toBe(1);
    expect(other.err).toContain(
      `::error::release ${DRAFT} is 18.0.9's, not ${TAG}'s. Nothing was attached.`,
    );

    const gone = await attach(agentBuild().files, { releaseId: 99 });
    expect(gone.status).toBe(1);
    expect(gone.err).toContain(`release 99 of ${REPOSITORY} is gone`);
    expect(uploads()).toEqual([]);
  });

  test("a read GitHub fails is tried again, and one it keeps failing stops the run", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    let failures = 1;
    fake.faults.push((request) => {
      if (request.method === "GET" && failures > 0) {
        failures--;
        return {
          status: 503,
          body: {
            message:
              "No server is currently available to service your request.",
          },
        };
      }
      return undefined;
    });
    const recovered = await attach(agentBuild().files);
    expect(recovered.status).toBe(0);
    expect(recovered.waits).toEqual([DEFAULT_DELAYS[0]]);

    fake.faults.push((request) => {
      return request.method === "GET" ? { status: 503, body: {} } : undefined;
    });
    const failed = await attach(agentBuild(" again").files);
    expect(failed.status).toBe(1);
    expect(failed.err).toContain(
      `::error::could not read release ${DRAFT} of ${REPOSITORY}: HTTP 503`,
    );
  });

  test("a request refused for good (a token without access) is not tried again", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    fake.faults.push((request) => {
      return request.method === "GET"
        ? {
            status: 403,
            body: { message: "Resource not accessible by integration" },
          }
        : undefined;
    });

    const result = await attach(agentBuild().files);

    expect(result.status).toBe(1);
    expect(result.waits).toEqual([]);
    expect(result.err).toContain(
      "HTTP 403: Resource not accessible by integration",
    );
  });
});

describe("on a release that is published already", () => {
  // The first run's build, published, as the package managers recorded it.
  function published(build) {
    fake.addRelease({
      id: DRAFT,
      tag: TAG,
      draft: false,
      assets: build.files.map((file) => {
        return { name: path.basename(file), bytes: fs.readFileSync(file) };
      }),
    });
  }

  test("without --when-published, it refuses, and uploads nothing", async () => {
    published(agentBuild());

    const result = await attach(agentBuild().files);

    expect(result.status).toBe(1);
    expect(result.err).toContain(
      `::error::${TAG} is published already (release ${DRAFT}), and a published release is never changed: not attaching`,
    );
    expect(fake.writes()).toEqual([]);
  });

  test("--when-published skip says so, uploads nothing, and succeeds", async () => {
    fake.addRelease({
      id: DRAFT,
      tag: TAG,
      draft: false,
      assets: [
        {
          name: "app-18.1.0-linux-amd64.cdx.json",
          bytes: "the published SBOM",
        },
      ],
    });
    const sbom = built("app-18.1.0-linux-amd64.cdx.json", "this run's SBOM");

    const result = await attach([sbom], { whenPublished: "skip" });

    expect(result.status).toBe(0);
    expect(result.out).toContain(
      `${TAG} is published already (release ${DRAFT}), and a published release is never changed: not attaching app-18.1.0-linux-amd64.cdx.json.`,
    );
    expect(fake.writes()).toEqual([]);
    expect(fake.assetNamed(DRAFT, "app-18.1.0-linux-amd64.cdx.json").size).toBe(
      "the published SBOM".length,
    );
  });

  test("--when-published verify-checksums succeeds, uploading nothing, when this run built the published files", async () => {
    published(agentBuild());
    // A second build of the same commit: the same bytes.
    const again = agentBuild();
    // The MSIs are not in the checksums file, and are not compared.
    const msi = built(
      "oneuptime-infrastructure-agent-amd64.msi",
      "another MSI",
    );

    const result = await attach([...again.files, msi], {
      whenPublished: "verify-checksums",
    });

    expect(result.status).toBe(0);
    expect(result.out).toContain(
      `with exactly the files this run built (its oneuptime_${TAG}_checksums.txt and every file it lists): nothing to attach.`,
    );
    expect(fake.writes()).toEqual([]);
  });

  test("--when-published verify-checksums fails, uploading nothing, when this run built other bytes", async () => {
    published(agentBuild());
    const other = agentBuild(" built again with another toolchain");

    const result = await attach(other.files, {
      whenPublished: "verify-checksums",
    });

    expect(result.status).toBe(1);
    expect(fake.writes()).toEqual([]);
    expect(result.err).toContain(
      `::error::oneuptime_${TAG}_checksums.txt has SHA-256`,
    );
    expect(result.err).toContain(
      `::error::its oneuptime-infrastructure-agent_linux_amd64.tar.gz has SHA-256 ${sha256(Buffer.from("linux archive"))}, and this run built ${sha256(Buffer.from("linux archive built again with another toolchain"))}`,
    );
    expect(result.err).toContain(
      "and with other files than this run built: nothing was attached, and the jobs that publish them elsewhere must not run: apt, yum, Homebrew and winget must get the published files' checksums, not these.",
    );
  });

  test("--when-published verify-checksums fails when the release lacks a file the checksums list", async () => {
    const build = agentBuild();
    fake.addRelease({
      id: DRAFT,
      tag: TAG,
      draft: false,
      assets: [build.sums, build.archive].map((file) => {
        return { name: path.basename(file), bytes: fs.readFileSync(file) };
      }),
    });

    const result = await attach(build.files, {
      whenPublished: "verify-checksums",
    });

    expect(result.status).toBe(1);
    expect(result.err).toContain(
      `::error::oneuptime-infrastructure-agent_windows_amd64.zip is not on it, and oneuptime_${TAG}_checksums.txt lists it`,
    );
  });

  test("--when-published verify-checksums fails when GitHub keeps no SHA-256 to compare", async () => {
    const build = agentBuild();
    fake.addRelease({
      id: DRAFT,
      tag: TAG,
      draft: false,
      assets: build.files.map((file) => {
        return {
          name: path.basename(file),
          bytes: fs.readFileSync(file),
          digest: null,
        };
      }),
    });

    const result = await attach(build.files, {
      whenPublished: "verify-checksums",
    });

    expect(result.status).toBe(1);
    expect(result.err).toContain(
      "GitHub keeps no SHA-256 of its oneuptime-infrastructure-agent_linux_amd64.tar.gz, so it cannot be compared",
    );
  });

  test("--when-published verify-checksums needs this run's checksums file among the files", async () => {
    const build = agentBuild();
    published(build);

    const result = await attach([build.archive, build.zip], {
      whenPublished: "verify-checksums",
    });

    expect(result.status).toBe(1);
    expect(result.err).toContain(
      "this run built 0 checksums files (*_checksums.txt), so there is nothing to compare the release with",
    );
  });
});

describe("what it is given", () => {
  test.each([
    [[], "--repository must be <owner>/<name>"],
    [["--repository", "x"], "--repository must be <owner>/<name>"],
    [
      ["--repository", REPOSITORY, "--release-id", "latest"],
      `--release-id must be the draft's id, a number (got "latest")`,
    ],
    [["--repository", REPOSITORY, "--release-id", "5"], "--tag is needed"],
    [
      ["--repository", REPOSITORY, "--release-id", "5", "--tag", TAG],
      "name at least one file to attach",
    ],
    [
      [
        "--repository",
        REPOSITORY,
        "--release-id",
        "5",
        "--tag",
        TAG,
        "--when-published",
        "overwrite",
        "a",
      ],
      `--when-published is skip or verify-checksums (got "overwrite")`,
    ],
    [["--release-id"], "--release-id needs a value"],
    [["--clobber"], "unknown option --clobber"],
  ])("refuses %j", (argv, message) => {
    expect(() => {
      return parseArguments(argv);
    }).toThrow(message);
  });

  test("reads every option", () => {
    expect(
      parseArguments([
        "--repository",
        REPOSITORY,
        "--release-id",
        "7",
        "--tag",
        TAG,
        "--when-published",
        "verify-checksums",
        "a.zip",
        "b.zip",
      ]),
    ).toEqual({
      repository: REPOSITORY,
      releaseId: "7",
      tag: TAG,
      whenPublished: "verify-checksums",
      files: ["a.zip", "b.zip"],
    });
  });

  test("a glob that matched nothing stops it, before anything reaches GitHub", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });

    const result = await attach([
      path.join(dir, "release-assets", "sboms", "*.cdx.json"),
    ]);

    expect(result.status).toBe(2);
    expect(result.err).toContain(
      "*.cdx.json is not a file: nothing was built there",
    );
    expect(fake.requests).toEqual([]);
  });

  test("a file named twice stops it", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const archive = built("a.tar.gz", "a");
    fs.mkdirSync(path.join(dir, "other"));
    const same = path.join(dir, "other", "a.tar.gz");
    fs.writeFileSync(same, "a");

    const result = await attach([archive, same]);

    expect(result.status).toBe(2);
    expect(result.err).toContain("a.tar.gz is named twice");
  });

  test("it needs a token", async () => {
    const result = await attach([built("a.zip", "a")], {
      env: { GITHUB_TOKEN: "", GH_TOKEN: "" },
    });
    expect(result.status).toBe(2);
    expect(result.err).toContain("GITHUB_TOKEN (or GH_TOKEN) is not set");
  });

  test("differencesFromChecksums reads GoReleaser's checksums file", () => {
    const build = agentBuild();
    const files = build.files.map((file) => {
      return {
        name: path.basename(file),
        path: file,
        size: fs.statSync(file).size,
        sha256: sha256(fs.readFileSync(file)),
      };
    });
    const release = {
      assets: files.map((file, index) => {
        return {
          id: index,
          name: file.name,
          size: file.size,
          state: "uploaded",
          digest: `sha256:${file.sha256}`,
        };
      }),
    };
    expect(differencesFromChecksums(release, files)).toEqual([]);
    expect(
      differencesFromChecksums(
        {
          assets: release.assets.filter((asset) => {
            return !asset.name.endsWith("_checksums.txt");
          }),
        },
        files,
      ),
    ).toEqual([`oneuptime_${TAG}_checksums.txt is not on it`]);
  });
});

describe("as finalize-github-release runs it", () => {
  function runCli(args, env = {}) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        env: {
          PATH: process.env.PATH,
          GITHUB_TOKEN: TOKEN,
          GITHUB_API_URL: fake.url,
          GITHUB_UPLOADS_URL: fake.url,
          ATTACH_RELEASE_ASSETS_DELAYS: "0,0,0",
          ...env,
        },
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        err += chunk;
      });
      child.on("close", (status) => {
        resolve({ status, out, err });
      });
    });
  }

  test("exits 0 once the draft holds every file, 1 when a published release has other files, 2 for a usage error", async () => {
    fake.addRelease({ id: DRAFT, tag: TAG });
    const build = agentBuild();
    const args = [
      "--repository",
      REPOSITORY,
      "--release-id",
      String(DRAFT),
      "--tag",
      TAG,
    ];

    const filled = await runCli([...args, ...build.files]);
    expect(filled.status).toBe(0);
    expect(filled.out).toContain(
      `Attaching 3 file(s) to draft ${DRAFT} of ${TAG}...`,
    );

    fake.release(DRAFT).draft = false;
    const other = agentBuild(" rebuilt");
    const refused = await runCli([
      ...args,
      "--when-published",
      "verify-checksums",
      ...other.files,
    ]);
    expect(refused.status).toBe(1);
    expect(refused.err).toContain("::error::");

    const usage = await runCli(["--release-id", "x"]);
    expect(usage.status).toBe(2);
    expect(usage.err).toContain("Usage:");
  });
});
