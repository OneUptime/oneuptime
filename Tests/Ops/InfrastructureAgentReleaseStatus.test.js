"use strict";

/**
 * How a release of the OneUptime infrastructure agent is tracked once it is
 * out (agents/InfrastructureAgent/RELEASING.md): the "Infrastructure Agent
 * Release Status" workflow and the scripts it runs.
 *
 *   - Scripts/PackageManagers/ReleaseStatus.sh runs against a fake `gh` and a
 *     signed apt and yum site written here (served as file://), signed with
 *     keys made here: what it calls published, superseded, waiting,
 *     attention and problem, and what it exits with.
 *   - InstallFromPackageRepository.sh and InstallFromHomebrew.sh run against
 *     a fake `docker` and a fake `brew`: what they count as a failure.
 *   - The workflow: when it runs, that it holds no secret, and which job runs
 *     which script, when.
 *
 * Needs gpg, jq, python3, curl, openssl and gzip, as ReleaseStatus.sh does.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = "Scripts/PackageManagers";
const WORKFLOW = ".github/workflows/infrastructure-agent-release-status.yml";
const RELEASE = ".github/workflows/release.yml";
const DOCS =
  "packages/App/FeatureSet/Docs/Content/en/monitor/server-monitor.md";
const PACKAGE = "oneuptime-infrastructure-agent";
const VERSION = "1.2.3";
const OLDER = "1.2.2";
const WINGET_DIR = "manifests/o/OneUptime/InfrastructureAgent";
const CASK_ENDPOINT = `repos/OneUptime/homebrew-tap/contents/Casks/${PACKAGE}.rb?ref=main`;
const PUSHED_ENDPOINT =
  "repos/OneUptime/packages/contents/deb/dists/stable/main/binary-amd64/Packages?ref=main";

// What the package managers and the install script download from a release.
const ASSETS = [
  `${PACKAGE}_linux_amd64.tar.gz`,
  `${PACKAGE}_linux_arm64.tar.gz`,
  `${PACKAGE}_darwin_amd64.tar.gz`,
  `${PACKAGE}_darwin_arm64.tar.gz`,
  `${PACKAGE}_windows_amd64.zip`,
  `${PACKAGE}_windows_arm64.zip`,
  `${PACKAGE}_amd64.deb`,
  `${PACKAGE}_arm64.deb`,
  `${PACKAGE}_amd64.rpm`,
  `${PACKAGE}_arm64.rpm`,
  `${PACKAGE}-amd64.msi`,
  `${PACKAGE}-arm64.msi`,
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/*
 * A program, run with a list of arguments. No shell reads them, so nothing in
 * them is a command.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120000,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// An ISO 8601 time, some hours ago, as GitHub writes it.
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
}

// What a release's asset holds, here: something its digest is taken of.
function assetContent(name, version) {
  return `${name} ${version}\n`;
}

let work = "";
const keyrings = [];

// A short directory: gpg-agent's sockets go in each keyring, and a socket's
// path may not be longer than 103 bytes (macOS's temporary directory alone
// is about 50).
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
});

afterAll(() => {
  for (const home of keyrings) {
    spawnSync("gpgconf", ["--homedir", home, "--kill", "all"]);
  }
  fs.rmSync(work, { recursive: true, force: true });
});

// ─── Keys and a signed site ──────────────────────────────────────────────

function gpg(key, args) {
  const result = run("gpg", [
    "--homedir",
    key.home,
    "--batch",
    "--quiet",
    "--pinentry-mode",
    "loopback",
    "--passphrase",
    "",
    ...args,
  ]);
  if (result.status !== 0) {
    throw new Error(`gpg ${args.join(" ")}: ${result.stderr}`);
  }
  return result.stdout;
}

// A signing key in a keyring of its own; expiry as gpg takes it ("never", "30d").
function makeKey(name, expiry = "never") {
  const key = { home: path.join(work, `k${keyrings.length}`) };
  fs.mkdirSync(key.home, { mode: 0o700 });
  keyrings.push(key.home);
  gpg(key, [
    "--quick-generate-key",
    `${name} <key@oneuptime.com>`,
    "ed25519",
    "sign",
    expiry,
  ]);
  key.fingerprint = gpg(key, ["--with-colons", "--list-keys"])
    .split("\n")
    .find((line) => line.startsWith("fpr:"))
    .split(":")[9];
  return key;
}

/*
 * The site BuildPackageRepository.sh writes, in miniature: gpg.key, an apt
 * repository (InRelease clear-signed, the indexes by hash) and a yum one
 * (repomd.xml signed, primary.xml by hash).
 */
function writeSite(
  name,
  {
    key,
    signer = key,
    versions = [OLDER, VERSION],
    debContent = assetContent,
  } = {},
) {
  const site = path.join(work, `site-${name}`);
  write(
    path.join(site, "gpg.key"),
    gpg(key, ["--armor", "--export", key.fingerprint]),
  );

  const dists = path.join(site, "deb", "dists", "stable");
  let release = [
    "Acquire-By-Hash: yes",
    "Architectures: amd64 arm64",
    "Codename: stable",
    "Components: main",
    "Suite: stable",
    "SHA256:",
    "",
  ].join("\n");
  for (const arch of ["amd64", "arm64"]) {
    const stanzas = versions.map((version) => {
      const file = `pool/main/o/${PACKAGE}/${PACKAGE}_${version}_${arch}.deb`;
      const content = debContent(`${PACKAGE}_${arch}.deb`, version);
      write(path.join(site, "deb", file), content);
      return [
        `Package: ${PACKAGE}`,
        `Architecture: ${arch}`,
        `Version: ${version}`,
        `Filename: ${file}`,
        `Size: ${Buffer.byteLength(content)}`,
        `SHA256: ${sha256(content)}`,
      ].join("\n");
    });
    const packages = `${stanzas.join("\n\n")}\n`;
    const index = path.join(dists, "main", `binary-${arch}`);
    write(path.join(index, "Packages"), packages);
    write(path.join(index, "by-hash", "SHA256", sha256(packages)), packages);
    release += ` ${sha256(packages)} ${Buffer.byteLength(packages)} main/binary-${arch}/Packages\n`;
  }
  write(path.join(dists, "Release"), release);
  gpg(signer, [
    "--yes",
    "--local-user",
    signer.fingerprint,
    "--clearsign",
    "--output",
    path.join(dists, "InRelease"),
    path.join(dists, "Release"),
  ]);

  const rpm = path.join(site, "rpm");
  const entries = [];
  for (const version of versions) {
    for (const rpmArch of ["x86_64", "aarch64"]) {
      const href = `Packages/${PACKAGE}-${version}-1.${rpmArch}.rpm`;
      const content = `signed rpm ${version} ${rpmArch}\n`;
      write(path.join(rpm, href), content);
      entries.push(
        `<package type="rpm"><name>${PACKAGE}</name><arch>${rpmArch}</arch>` +
          `<version epoch="0" ver="${version}" rel="1"/>` +
          `<checksum type="sha256" pkgid="YES">${sha256(content)}</checksum>` +
          `<location href="${href}"/></package>`,
      );
    }
  }
  const primary = zlib.gzipSync(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" ' +
      `packages="${entries.length}">\n${entries.join("\n")}\n</metadata>\n`,
  );
  const primaryHref = `repodata/${sha256(primary)}-primary.xml.gz`;
  write(path.join(rpm, primaryHref), primary);
  write(
    path.join(rpm, "repodata", "repomd.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<repomd xmlns="http://linux.duke.edu/metadata/repo" xmlns:rpm="http://linux.duke.edu/metadata/rpm">',
      "  <revision>1</revision>",
      '  <data type="primary">',
      `    <checksum type="sha256">${sha256(primary)}</checksum>`,
      `    <location href="${primaryHref}"/>`,
      "  </data>",
      "</repomd>",
      "",
    ].join("\n"),
  );
  gpg(signer, [
    "--yes",
    "--local-user",
    signer.fingerprint,
    "--armor",
    "--detach-sign",
    "--output",
    path.join(rpm, "repodata", "repomd.xml.asc"),
    path.join(rpm, "repodata", "repomd.xml"),
  ]);
  write(path.join(rpm, "oneuptime.repo"), "[oneuptime]\n");
  return site;
}

// ─── What GitHub answers ─────────────────────────────────────────────────

function releaseJson(version, age, { without = [] } = {}) {
  return {
    tag_name: version,
    prerelease: false,
    published_at: hoursAgo(age),
    assets: ASSETS.filter((name) => !without.includes(name)).map((name) => {
      return {
        name,
        digest: `sha256:${sha256(assetContent(name, version))}`,
        browser_download_url: `https://example.invalid/${version}/${name}`,
      };
    }),
  };
}

function cask(version, { digests = assetContent } = {}) {
  const lines = [
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    `cask "${PACKAGE}" do`,
    `  version "${version}"`,
    "",
    "  on_macos do",
  ];
  for (const [block, arch] of [
    ["on_arm", "arm64"],
    ["on_intel", "amd64"],
  ]) {
    const asset = `${PACKAGE}_darwin_${arch}.tar.gz`;
    lines.push(
      `    ${block} do`,
      `      sha256 "${sha256(digests(asset, version))}"`,
      `      url "https://github.com/OneUptime/oneuptime/releases/download/#{version}/${asset}"`,
      "    end",
    );
  }
  lines.push("  end", "end", "");
  return lines.join("\n");
}

// The installer manifest GoReleaser writes, as far as the script reads it.
function installerManifest(version, { digests = assetContent } = {}) {
  const lines = [`PackageVersion: ${version}`, "Installers:"];
  for (const [arch, name] of [
    ["arm64", "arm64"],
    ["x64", "amd64"],
  ]) {
    const asset = `${PACKAGE}_windows_${name}.zip`;
    lines.push(
      `  - Architecture: ${arch}`,
      `    InstallerUrl: https://github.com/OneUptime/oneuptime/releases/download/${version}/${asset}`,
      `    InstallerSha256: ${sha256(digests(asset, version))}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function pull(number, version, options = {}) {
  return {
    number,
    title: `New version: OneUptime.InfrastructureAgent version ${version}`,
    state: options.state || "open",
    labels: (options.labels || []).map((name) => {
      return { name };
    }),
    created_at: hoursAgo(options.age || 20),
    pull_request: { merged_at: options.merged || null },
  };
}

/*
 * GitHub, for a release out for `age` hours and published everywhere:
 * pushed to OneUptime/packages, in the tap, merged into winget-pkgs.
 */
function github({ age = 30 } = {}) {
  return {
    "repos/OneUptime/oneuptime/releases/latest": releaseJson(VERSION, age),
    [`repos/OneUptime/oneuptime/releases/tags/${OLDER}`]: releaseJson(
      OLDER,
      age + 48,
    ),
    [PUSHED_ENDPOINT]: `Package: ${PACKAGE}\nVersion: ${OLDER}\n\nPackage: ${PACKAGE}\nVersion: ${VERSION}\n`,
    "repos/OneUptime/packages/actions/runs?per_page=1": {
      workflow_runs: [
        {
          status: "queued",
          conclusion: null,
          created_at: hoursAgo(0.5),
        },
      ],
    },
    [CASK_ENDPOINT]: cask(VERSION),
    [`repos/microsoft/winget-pkgs/contents/${WINGET_DIR}/${VERSION}`]: [],
    [`repos/microsoft/winget-pkgs/contents/${WINGET_DIR}/${VERSION}/OneUptime.InfrastructureAgent.installer.yaml`]:
      installerManifest(VERSION),
    "search/issues": { items: [] },
  };
}

// The GitHub API as the script asks it, answered from a JSON state file.
const FAKE_GH = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
const args = process.argv.slice(2);
let method = "GET";
let endpoint = "";
const headers = [];
const fields = {};
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === "-H") {
    headers.push(args[++i]);
  } else if (arg === "-X" || arg === "--method") {
    method = args[++i];
  } else if (arg === "-f" || arg === "-F") {
    const [key, ...value] = args[++i].split("=");
    fields[key] = value.join("=");
  } else if (!endpoint) {
    endpoint = arg;
  } else {
    console.error("fake gh: unexpected argument " + arg);
    process.exit(2);
  }
}
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ command: args[0], method, endpoint, headers, fields }) + "\\n");
if (args[0] !== "api" || method !== "GET") {
  console.error("fake gh: only reads are answered, not gh " + args[0] + " " + method);
  process.exit(2);
}
if (state.failing && endpoint.includes(state.failing)) {
  console.error("gh: Bad Gateway (HTTP 502)");
  process.exit(1);
}
const body = state.responses[endpoint];
if (body === undefined) {
  console.error("gh: Not Found (HTTP 404)");
  process.exit(1);
}
process.stdout.write(typeof body === "string" ? body : JSON.stringify(body));
`;

// ─── ReleaseStatus.sh ────────────────────────────────────────────────────

describe(`${SCRIPTS}/ReleaseStatus.sh`, () => {
  let key;
  let site;
  let runs = 0;

  beforeAll(() => {
    fs.mkdirSync(path.join(work, "bin"));
    fs.writeFileSync(path.join(work, "bin", "gh"), FAKE_GH, { mode: 0o755 });
    key = makeKey("release");
    site = writeSite("published", { key });
  });

  function status({
    responses = github(),
    failing = "",
    args = [],
    siteDirectory = site,
    signingKey = key,
    env = {},
  } = {}) {
    runs += 1;
    const files = {
      state: path.join(work, `state-${runs}.json`),
      log: path.join(work, `gh-${runs}.log`),
      output: path.join(work, `output-${runs}`),
      summary: path.join(work, `summary-${runs}.md`),
    };
    fs.writeFileSync(files.state, JSON.stringify({ responses, failing }));
    for (const file of [files.log, files.output, files.summary]) {
      fs.writeFileSync(file, "");
    }

    const result = run(
      "bash",
      [path.join(REPO_ROOT, SCRIPTS, "ReleaseStatus.sh"), ...args],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PATH: `${path.join(work, "bin")}${path.delimiter}${process.env.PATH}`,
          FAKE_GH_STATE: files.state,
          FAKE_GH_LOG: files.log,
          PACKAGE_REPOSITORY_URL: `file://${siteDirectory}`,
          PACKAGE_SIGNING_KEY_FINGERPRINT: signingKey.fingerprint,
          RELEASE_STATUS_RETRY_SECONDS: "0",
          GITHUB_OUTPUT: files.output,
          GITHUB_STEP_SUMMARY: files.summary,
          GITHUB_ACTIONS: "",
          ...env,
        },
      },
    );

    const outputs = {};
    for (const line of fs.readFileSync(files.output, "utf8").split("\n")) {
      if (line) {
        const at = line.indexOf("=");
        outputs[line.slice(0, at)] = line.slice(at + 1);
      }
    }
    const rows = {};
    for (const line of result.stdout.split("\n")) {
      const match = line.match(/^\| (.+?) \| \S+ (\w+) \| (.*) \|$/);
      if (match) {
        rows[match[1]] = { state: match[2], details: match[3] };
      }
    }
    const calls = fs
      .readFileSync(files.log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        return JSON.parse(line);
      });

    return {
      ...result,
      outputs,
      rows,
      calls,
      summary: fs.readFileSync(files.summary, "utf8"),
    };
  }

  test("calls a release that is everywhere published, exits 0, and writes the table to the run's summary", () => {
    const result = status();

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.outputs).toEqual({
      github: "published",
      key: "published",
      apt: "published",
      yum: "published",
      homebrew: "published",
      winget: "published",
      version: VERSION,
      latest: "true",
    });
    expect(result.rows["GitHub release"].details).toContain(
      `with the ${ASSETS.length} archives, packages and MSIs`,
    );
    expect(result.rows.apt.details).toBe(
      `${VERSION} for amd64 and arm64, signed by the release key`,
    );
    expect(result.rows["Signing key"].details).toContain("does not expire");
    expect(result.summary).toBe(result.stdout);
    expect(result.summary).toContain(`### Infrastructure agent ${VERSION}`);
    expect(result.summary).toContain(
      "https://github.com/OneUptime/oneuptime/blob/master/agents/InfrastructureAgent/RELEASING.md",
    );
    // No HTTPS row for a site that is not on https.
    expect(Object.keys(result.rows)).not.toContain("HTTPS certificate");
  });

  test("only reads GitHub, and asks winget-pkgs for this package's pull requests", () => {
    const responses = github();
    delete responses[
      `repos/microsoft/winget-pkgs/contents/${WINGET_DIR}/${VERSION}`
    ];
    const result = status({ responses });

    expect(result.calls.length).toBeGreaterThan(0);
    for (const call of result.calls) {
      expect(call.command).toBe("api");
      expect(call.method).toBe("GET");
    }
    const search = result.calls.find((call) => {
      return call.endpoint === "search/issues";
    });
    expect(search.fields.q).toBe(
      "repo:microsoft/winget-pkgs is:pr in:title OneUptime.InfrastructureAgent",
    );
  });

  test("a young release the site has not caught up with is waiting, saying why, and exits 0", () => {
    const behind = writeSite("behind", { key, versions: [OLDER] });
    const responses = github({ age: 1 });
    delete responses[
      `repos/microsoft/winget-pkgs/contents/${WINGET_DIR}/${VERSION}`
    ];
    const result = status({ responses, siteDirectory: behind });

    expect(result.status).toBe(0);
    expect(result.outputs.apt).toBe("waiting");
    expect(result.outputs.yum).toBe("waiting");
    expect(result.rows.apt.details).toContain(
      `the site has ${OLDER}, not ${VERSION}`,
    );
    expect(result.rows.apt.details).toContain(
      "OneUptime/packages has it; its latest Pages deploy",
    );
    expect(result.rows.apt.details).toContain("is queued");
    expect(result.outputs.winget).toBe("waiting");
    expect(result.rows.winget.details).toContain("no pull request yet");
  });

  test("after RELEASE_STATUS_GRACE_HOURS, the same is a problem, and it exits 1", () => {
    const behind = writeSite("behind-long", { key, versions: [OLDER] });
    const responses = github({ age: 30 });
    responses[PUSHED_ENDPOINT] = `Package: ${PACKAGE}\nVersion: ${OLDER}\n`;
    const result = status({ responses, siteDirectory: behind });

    expect(result.status).toBe(1);
    expect(result.outputs.apt).toBe("problem");
    expect(result.outputs.yum).toBe("problem");
    expect(result.rows.apt.details).toContain(
      "OneUptime/packages does not have it either: see publish-infrastructure-agent-apt-yum",
    );
  });

  /*
   * 14.0.95: the Android build failed on the network, so the publish jobs
   * that wait for it ran in the release run's re-run, ten hours after the
   * release. The status check that follows the run started five seconds
   * after the Pages deploy of the new packages was queued, and called the
   * site's lag a problem.
   */
  describe("a version OneUptime/packages got after the release's grace, as a re-run publishes it", () => {
    const PAGES_ENDPOINT = "repos/OneUptime/packages/actions/runs?per_page=1";
    let behind;

    beforeAll(() => {
      behind = writeSite("behind-rerun", { key, versions: [OLDER] });
    });

    function withDeploy(deploy, env = {}) {
      // A release out for 30 hours that OneUptime/packages has, as github() says.
      const responses = github({ age: 30 });
      responses[PAGES_ENDPOINT] = { workflow_runs: [deploy] };
      return status({ responses, siteDirectory: behind, env });
    }

    test("is waiting while its Pages deploy waits for a runner, saying so, and exits 0", () => {
      const result = withDeploy({
        status: "queued",
        conclusion: null,
        created_at: hoursAgo(0.01),
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.outputs.apt).toBe("waiting");
      expect(result.outputs.yum).toBe("waiting");
      expect(result.rows.apt.details).toContain(
        `the site has ${OLDER}, not ${VERSION}`,
      );
      expect(result.rows.apt.details).toContain(
        "OneUptime/packages has it; its latest Pages deploy",
      );
      expect(result.rows.apt.details).toContain("is queued");
      // The rest of the release is checked as ever.
      expect(result.outputs.key).toBe("published");
      expect(result.outputs.homebrew).toBe("published");
    });

    test("is waiting while the deploy runs, and just after it, while the site's cache still serves the old index", () => {
      for (const deploy of [
        { status: "in_progress", conclusion: null, created_at: hoursAgo(0.2) },
        {
          status: "completed",
          conclusion: "success",
          created_at: hoursAgo(0.1),
        },
      ]) {
        const result = withDeploy(deploy);

        expect(result.status).toBe(0);
        expect(result.outputs.apt).toBe("waiting");
        expect(result.outputs.yum).toBe("waiting");
      }
    });

    test("is a problem once its deploy started RELEASE_STATUS_GRACE_HOURS ago, and it exits 1", () => {
      const stale = withDeploy({
        status: "queued",
        conclusion: null,
        created_at: hoursAgo(7),
      });

      expect(stale.status).toBe(1);
      expect(stale.outputs.apt).toBe("problem");
      expect(stale.outputs.yum).toBe("problem");

      // The same window as the release's: RELEASE_STATUS_GRACE_HOURS sets both.
      const shortGrace = { RELEASE_STATUS_GRACE_HOURS: "1" };
      expect(
        withDeploy(
          { status: "queued", conclusion: null, created_at: hoursAgo(2) },
          shortGrace,
        ).outputs.apt,
      ).toBe("problem");
      expect(
        withDeploy(
          { status: "queued", conclusion: null, created_at: hoursAgo(0.5) },
          shortGrace,
        ).outputs.apt,
      ).toBe("waiting");
    });

    test("is a problem at once when that deploy failed or was cancelled, naming how it ended", () => {
      for (const conclusion of ["failure", "cancelled"]) {
        const result = withDeploy({
          status: "completed",
          conclusion,
          created_at: hoursAgo(0.5),
        });

        expect(result.status).toBe(1);
        expect(result.outputs.apt).toBe("problem");
        expect(result.outputs.yum).toBe("problem");
        expect(result.rows.apt.details).toContain(
          `is completed (${conclusion})`,
        );
      }
    });

    test("is a problem whatever the deploy does when OneUptime/packages does not have it", () => {
      const responses = github({ age: 30 });
      responses[PUSHED_ENDPOINT] = `Package: ${PACKAGE}\nVersion: ${OLDER}\n`;
      responses[PAGES_ENDPOINT] = {
        workflow_runs: [
          { status: "queued", conclusion: null, created_at: hoursAgo(0.01) },
        ],
      };
      const result = status({ responses, siteDirectory: behind });

      expect(result.status).toBe(1);
      expect(result.outputs.apt).toBe("problem");
      expect(result.rows.apt.details).toContain(
        "OneUptime/packages does not have it either",
      );
    });

    test("is a problem when OneUptime/packages has no Pages deploy to wait for", () => {
      const responses = github({ age: 30 });
      responses[PAGES_ENDPOINT] = { workflow_runs: [] };
      const result = status({ responses, siteDirectory: behind });

      expect(result.status).toBe(1);
      expect(result.outputs.apt).toBe("problem");
      expect(result.rows.apt.details).toContain(
        "OneUptime/packages has it, and has no Pages deploy",
      );
    });

    test("asks GitHub for the Pages deploy once, however many rows wait on it", () => {
      const result = withDeploy({
        status: "queued",
        conclusion: null,
        created_at: hoursAgo(0.01),
      });

      expect(
        result.calls.filter((call) => {
          return call.endpoint === PAGES_ENDPOINT;
        }),
      ).toHaveLength(1);
    });
  });

  test("a site that does not answer is waiting while the release is young, and a problem after", () => {
    const nowhere = path.join(work, "no-site");

    const young = status({
      responses: github({ age: 1 }),
      siteDirectory: nowhere,
    });
    expect(young.status).toBe(0);
    expect(young.outputs.key).toBe("waiting");
    expect(young.outputs.apt).toBe("waiting");

    const old = status({
      responses: github({ age: 30 }),
      siteDirectory: nowhere,
    });
    expect(old.status).toBe(1);
    expect(old.outputs.key).toBe("problem");
    expect(old.outputs.apt).toBe("problem");
    expect(old.rows["Signing key"].details).toContain("could not download");
  });

  test("a package that is not the release's is a problem even for a young release", () => {
    const tampered = writeSite("tampered", {
      key,
      debContent: (name, version) => {
        return version === VERSION
          ? "not the release's\n"
          : assetContent(name, version);
      },
    });
    const result = status({
      responses: github({ age: 1 }),
      siteDirectory: tampered,
    });

    expect(result.status).toBe(1);
    expect(result.outputs.apt).toBe("problem");
    expect(result.rows.apt.details).toContain(
      `is not the release's ${PACKAGE}_amd64.deb`,
    );
  });

  test("indexes another key signed are a problem: apt and dnf refuse them", () => {
    const other = makeKey("other");
    const forged = writeSite("forged", { key, signer: other });
    const result = status({
      responses: github({ age: 1 }),
      siteDirectory: forged,
    });

    expect(result.status).toBe(1);
    expect(result.outputs.key).toBe("published");
    expect(result.outputs.apt).toBe("problem");
    expect(result.outputs.yum).toBe("problem");
    expect(result.rows.apt.details).toContain(
      "InRelease is not signed by the release key",
    );
    expect(result.rows["yum and dnf"].details).toContain(
      "repomd.xml is not signed by the release key",
    );
  });

  test("a gpg.key that is not the release key is a problem, and nothing is verified with it", () => {
    const other = makeKey("impostor");
    const impostor = writeSite("impostor", { key: other });
    const result = status({
      responses: github({ age: 30 }),
      siteDirectory: impostor,
    });

    expect(result.status).toBe(1);
    expect(result.outputs.key).toBe("problem");
    expect(result.rows["Signing key"].details).toContain(
      `is ${other.fingerprint}, not the release key ${key.fingerprint}`,
    );
    expect(result.rows.apt.details).toContain("nothing to verify it with");
  });

  test("a key that stops signing within 90 days needs attention, which does not fail the run", () => {
    const expiring = makeKey("expiring", "30d");
    const expiringSite = writeSite("expiring", { key: expiring });
    const result = status({
      signingKey: expiring,
      siteDirectory: expiringSite,
    });

    expect(result.status).toBe(0);
    expect(result.outputs.key).toBe("attention");
    expect(result.rows["Signing key"].details).toContain("expires on");
    expect(result.outputs.apt).toBe("published");
  });

  test("an older cask after the grace period, or one with other checksums, is a problem", () => {
    const behind = github({ age: 30 });
    behind[CASK_ENDPOINT] = cask(OLDER);
    const old = status({ responses: behind });
    expect(old.status).toBe(1);
    expect(old.outputs.homebrew).toBe("problem");
    expect(old.rows.Homebrew.details).toContain(
      `the tap has ${OLDER}, not ${VERSION}`,
    );

    const wrong = github({ age: 1 });
    wrong[CASK_ENDPOINT] = cask(VERSION, {
      digests: () => {
        return "something else";
      },
    });
    const tampered = status({ responses: wrong });
    expect(tampered.status).toBe(1);
    expect(tampered.outputs.homebrew).toBe("problem");
    expect(tampered.rows.Homebrew.details).toContain(
      "brew refuses the download",
    );
  });

  test("an older version: published where it is still kept, superseded where a newer one replaced it", () => {
    const responses = github();
    responses[`repos/microsoft/winget-pkgs/contents/${WINGET_DIR}/${OLDER}`] =
      [];
    responses[
      `repos/microsoft/winget-pkgs/contents/${WINGET_DIR}/${OLDER}/OneUptime.InfrastructureAgent.installer.yaml`
    ] = installerManifest(OLDER);
    const result = status({ responses, args: [OLDER] });

    expect(result.status).toBe(0);
    expect(result.outputs.version).toBe(OLDER);
    expect(result.outputs.latest).toBe("false");
    expect(result.rows["GitHub release"].details).toContain(
      `${VERSION} is the latest, which the install script installs`,
    );
    expect(result.outputs.apt).toBe("published");
    expect(result.outputs.homebrew).toBe("superseded");
    expect(result.rows.Homebrew.details).toBe(`the tap has ${VERSION}`);

    const pruned = writeSite("pruned", { key, versions: [VERSION] });
    const gone = status({ responses, args: [OLDER], siteDirectory: pruned });
    expect(gone.outputs.apt).toBe("superseded");
    expect(gone.rows.apt.details).toBe(`the repository has ${VERSION}`);
  });

  test("a release without one of the files the package managers download is a problem", () => {
    const responses = github();
    responses["repos/OneUptime/oneuptime/releases/latest"] = releaseJson(
      VERSION,
      30,
      {
        without: [`${PACKAGE}-arm64.msi`],
      },
    );
    const result = status({ responses });

    expect(result.status).toBe(1);
    expect(result.outputs.github).toBe("problem");
    expect(result.rows["GitHub release"].details).toContain(
      `without ${PACKAGE}-arm64.msi`,
    );
  });

  describe("winget", () => {
    function winget(items, { age = 30, merged = false, digests } = {}) {
      const responses = github({ age });
      const directory = `repos/microsoft/winget-pkgs/contents/${WINGET_DIR}/${VERSION}`;
      if (!merged) {
        delete responses[directory];
      }
      if (digests) {
        responses[`${directory}/OneUptime.InfrastructureAgent.installer.yaml`] =
          installerManifest(VERSION, { digests });
      }
      responses["search/issues"] = { items };
      return status({ responses });
    }

    test.each([
      [
        "validated, a new package",
        ["New-Package", "Azure-Pipeline-Passed", "Validation-Completed"],
        "waiting",
        "validated, waiting for a moderator to review the new package",
      ],
      [
        "validated",
        ["Validation-Completed"],
        "waiting",
        "validated, waiting to merge",
      ],
      [
        "approved",
        ["Moderator-Approved"],
        "waiting",
        "approved, waiting to merge",
      ],
      [
        "being validated",
        [],
        "waiting",
        "in Microsoft's validation (labels: none yet)",
      ],
      [
        "hit by Microsoft's own error",
        ["Internal-Error-Dynamic-Scan"],
        "waiting",
        "in Microsoft's validation",
      ],
      ["asking for the CLA", ["Needs-CLA"], "problem", "needs us: Needs-CLA"],
      [
        "asking the author",
        ["Needs-Author-Feedback", "Validation-Completed"],
        "problem",
        "needs us: Needs-Author-Feedback",
      ],
      [
        "failing to install",
        ["Validation-Installation-Error"],
        "problem",
        "needs us: Validation-Installation-Error",
      ],
      [
        "with a hash that does not match",
        ["Error-Hash-Mismatch"],
        "problem",
        "needs us: Error-Hash-Mismatch",
      ],
    ])("an open pull request %s is %s", (_, labels, state, details) => {
      const result = winget([pull(42, VERSION, { labels })]);

      expect(result.outputs.winget).toBe(state);
      expect(result.rows.winget.details).toContain(
        "[#42](https://github.com/microsoft/winget-pkgs/pull/42)",
      );
      expect(result.rows.winget.details).toContain(details);
      expect(result.status).toBe(state === "problem" ? 1 : 0);
    });

    test("a pull request closed without merging is a problem", () => {
      const result = winget([pull(42, VERSION, { state: "closed" })]);

      expect(result.outputs.winget).toBe("problem");
      expect(result.rows.winget.details).toContain(
        "was closed without merging",
      );
    });

    test("no pull request after the grace period is a problem, naming the others still open", () => {
      const result = winget([
        pull(7, OLDER, { labels: ["Validation-Completed"] }),
      ]);

      expect(result.outputs.winget).toBe("problem");
      expect(result.rows.winget.details).toContain(
        "no pull request to microsoft/winget-pkgs: see publish-infrastructure-agent-winget",
      );
      expect(result.rows.winget.details).toContain(`also open: #7 (${OLDER})`);
    });

    test("a merged version must install the release's zips", () => {
      const result = winget([], {
        merged: true,
        digests: () => {
          return "something else";
        },
      });

      expect(result.outputs.winget).toBe("problem");
      expect(result.rows.winget.details).toContain(
        `does not install the release's ${PACKAGE}_windows_amd64.zip`,
      );
    });
  });

  test("annotates a problem on the run when it runs in GitHub Actions", () => {
    const behind = github({ age: 30 });
    behind[CASK_ENDPOINT] = cask(OLDER);
    const result = status({
      responses: behind,
      env: { GITHUB_ACTIONS: "true" },
    });

    expect(result.stdout).toMatch(
      /^::error title=Homebrew::the tap has 1\.2\.2/m,
    );
  });

  test("stops with exit 2 when GitHub does not answer, rather than reporting a state", () => {
    const result = status({ failing: "releases/latest" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "could not ask GitHub for repos/OneUptime/oneuptime/releases/latest",
    );
    expect(result.outputs).toEqual({});
  });
});

// ─── InstallFromPackageRepository.sh ─────────────────────────────────────

describe(`${SCRIPTS}/InstallFromPackageRepository.sh`, () => {
  // `docker pull --quiet <image>` and
  // `docker run --rm -v <dir>:/work:ro <image> bash /work/install.sh <version>`,
  // answered per image from FAKE_DOCKER_RESULTS. It keeps the commands the
  // container would have run.
  const FAKE_DOCKER = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
if (args[0] === "pull") {
  const pulled = JSON.parse(process.env.FAKE_DOCKER_RESULTS)[args[args.length - 1]].pulled !== false;
  if (!pulled) {
    console.error("toomanyrequests: Rate exceeded");
  }
  process.exit(pulled ? 0 : 1);
}
const mount = args[args.indexOf("-v") + 1].split(":")[0];
const image = args[args.indexOf("-v") + 2];
for (const file of ["apt.sh", "dnf.sh", "install.sh"]) {
  fs.copyFileSync(path.join(mount, file), path.join(process.env.FAKE_DOCKER_SEEN, file));
}
const result = JSON.parse(process.env.FAKE_DOCKER_RESULTS)[image];
process.stdout.write(result.output + "\\n");
process.exit(result.status);
`;

  let bin = "";
  let seen = "";

  beforeAll(() => {
    bin = path.join(work, "docker-bin");
    seen = path.join(work, "docker-seen");
    fs.mkdirSync(bin);
    fs.mkdirSync(seen);
    fs.writeFileSync(path.join(bin, "docker"), FAKE_DOCKER, { mode: 0o755 });
  });

  function install(results) {
    return run(
      "bash",
      [
        path.join(REPO_ROOT, SCRIPTS, "InstallFromPackageRepository.sh"),
        VERSION,
        ...Object.keys(results),
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          FAKE_DOCKER_RESULTS: JSON.stringify(results),
          FAKE_DOCKER_SEEN: seen,
          INSTALL_RETRY_SECONDS: "0",
          GITHUB_ACTIONS: "",
          GITHUB_STEP_SUMMARY: "",
        },
      },
    );
  }

  // The page's fenced bash block that contains `needle`.
  function docsBlock(needle) {
    const blocks = read(DOCS)
      .split("```bash\n")
      .slice(1)
      .map((block) => {
        return block.split("```")[0];
      });
    return blocks.find((block) => {
      return block.includes(needle);
    });
  }

  test("runs the docs' apt and dnf blocks as written, against packages.oneuptime.com", () => {
    const result = install({ "debian:12": { output: VERSION, status: 0 } });

    expect(result.status).toBe(0);
    const apt = fs.readFileSync(path.join(seen, "apt.sh"), "utf8");
    const dnf = fs.readFileSync(path.join(seen, "dnf.sh"), "utf8");
    expect(apt).toBe(
      docsBlock("apt-get install oneuptime-infrastructure-agent"),
    );
    expect(dnf).toBe(docsBlock("dnf install oneuptime-infrastructure-agent"));
    expect(apt).toContain("https://packages.oneuptime.com/gpg.key");
    expect(dnf).toContain("https://packages.oneuptime.com/rpm/oneuptime.repo");
  });

  test("checks the version the package manager installed, and that the program runs", () => {
    install({ "debian:12": { output: VERSION, status: 0 } });
    const inside = fs.readFileSync(path.join(seen, "install.sh"), "utf8");

    expect(inside).toContain(
      "dpkg-query --show --showformat '${Version}' oneuptime-infrastructure-agent",
    );
    expect(inside).toContain(
      "rpm --query --queryformat '%{VERSION}' oneuptime-infrastructure-agent",
    );
    expect(inside).toContain("oneuptime-infrastructure-agent help");
    expect(inside).toContain('[ "$installed" = "$expected" ]');
    expect(inside).toContain("umask 077");
  });

  test("passes when every image installed the version, and fails naming each one that did not", () => {
    const passing = install({
      "debian:12": { output: VERSION, status: 0 },
      "rockylinux:9": { output: VERSION, status: 0 },
    });
    expect(passing.status).toBe(0);
    expect(passing.stdout).toContain(
      `| \`debian:12\` | ✅ installed ${VERSION} |`,
    );
    expect(passing.stdout).toContain(
      `| \`rockylinux:9\` | ✅ installed ${VERSION} |`,
    );

    const failing = install({
      "debian:12": { output: VERSION, status: 0 },
      "ubuntu:24.04": { output: OLDER, status: 1 },
      "fedora:latest": {
        output: "Error: Failed to download metadata for repo 'oneuptime'",
        status: 1,
      },
    });
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain(
      `| \`ubuntu:24.04\` | ❌ installed ${OLDER}, not ${VERSION} |`,
    );
    expect(failing.stdout).toContain(
      "| `fedora:latest` | ❌ did not install: see the log |",
    );

    const unpulled = install({
      "almalinux:10": { pulled: false, output: "", status: 0 },
    });
    expect(unpulled.status).toBe(1);
    expect(unpulled.stdout).toContain(
      "| `almalinux:10` | ❌ could not pull the image |",
    );
    expect(unpulled.stdout).toContain("toomanyrequests: Rate exceeded");
  });
});

// ─── InstallFromHomebrew.sh ──────────────────────────────────────────────

describe(`${SCRIPTS}/InstallFromHomebrew.sh`, () => {
  // brew, as far as the script uses it. install puts a program that runs
  // under <prefix>/bin and prints FAKE_BREW_INSTALL_OUTPUT.
  const FAKE_BREW = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const prefix = process.env.FAKE_BREW_PREFIX;
fs.appendFileSync(process.env.FAKE_BREW_LOG, args.join(" ") + "\\n");
const program = path.join(prefix, "bin", "oneuptime-infrastructure-agent");
switch (args[0]) {
  case "--prefix":
    console.log(prefix);
    break;
  case "update":
    break;
  case "install":
    fs.mkdirSync(path.dirname(program), { recursive: true });
    fs.writeFileSync(program, "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
    console.log(process.env.FAKE_BREW_INSTALL_OUTPUT);
    break;
  case "list":
    console.log(process.env.FAKE_BREW_INSTALLED);
    break;
  case "info":
    console.log("==> oneuptime/tap/oneuptime-infrastructure-agent");
    break;
  case "uninstall":
    fs.rmSync(program, { force: true });
    break;
  default:
    console.error("fake brew: no answer for " + args.join(" "));
    process.exit(2);
}
`;

  let bin = "";
  let calls = 0;

  beforeAll(() => {
    bin = path.join(work, "brew-bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "brew"), FAKE_BREW, { mode: 0o755 });
  });

  function install({
    output = "==> Installing Cask oneuptime-infrastructure-agent",
    installed = `${PACKAGE} ${VERSION}`,
  } = {}) {
    calls += 1;
    const log = path.join(work, `brew-${calls}.log`);
    fs.writeFileSync(log, "");
    const result = run(
      "bash",
      [path.join(REPO_ROOT, SCRIPTS, "InstallFromHomebrew.sh"), VERSION],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          FAKE_BREW_PREFIX: path.join(work, `brew-prefix-${calls}`),
          FAKE_BREW_LOG: log,
          FAKE_BREW_INSTALL_OUTPUT: output,
          FAKE_BREW_INSTALLED: installed,
          GITHUB_ACTIONS: "",
          GITHUB_STEP_SUMMARY: "",
        },
      },
    );
    return {
      ...result,
      brew: fs.readFileSync(log, "utf8").split("\n").filter(Boolean),
    };
  }

  test("installs with the docs' command, then uninstalls, and passes when nothing is wrong", () => {
    const result = install();

    expect(result.status).toBe(0);
    expect(read(DOCS)).toContain(`\nbrew install oneuptime/tap/${PACKAGE}\n`);
    expect(result.brew).toEqual(
      expect.arrayContaining([
        "update --quiet",
        `install oneuptime/tap/${PACKAGE}`,
        `info --cask oneuptime/tap/${PACKAGE}`,
        `uninstall --cask ${PACKAGE}`,
      ]),
    );
    expect(result.stdout).toContain(`| Version | ✅ ${VERSION} |`);
    expect(result.stdout).toContain("| Program | ✅ runs |");
    expect(result.stdout).toContain(
      "| Warnings | ✅ brew called nothing in the cask deprecated |",
    );
  });

  test("fails on anything brew calls deprecated while it reads the cask", () => {
    const warning =
      "Warning: Calling `postflight` is deprecated! Use `postflight_steps` instead.";
    const result = install({
      output: `==> Installing Cask ${PACKAGE}\n${warning}`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`| Warnings | ❌ ${warning} |`);
  });

  test("reports a warning brew writes as a workflow command, as it does in GitHub Actions, by its message", () => {
    const result = install({
      output: [
        `==> Installing Cask ${PACKAGE}`,
        "::warning::Calling `postflight` is deprecated! Use `postflight_steps` instead.%0A" +
          "Please report this issue to the oneuptime/homebrew-tap tap (not Homebrew/* repositories), " +
          "or even better, submit a PR to fix it:%0A" +
          `  /opt/homebrew/Library/Taps/oneuptime/homebrew-tap/Casks/${PACKAGE}.rb:36%0A%0A`,
      ].join("\n"),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "| Warnings | ❌ Calling `postflight` is deprecated! Use `postflight_steps` instead. |",
    );
  });

  test("fails when brew installed another version", () => {
    const result = install({ installed: `${PACKAGE} ${OLDER}` });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `| Version | ❌ brew installed '${PACKAGE} ${OLDER}', not ${VERSION} |`,
    );
  });
});

// ─── The workflow ────────────────────────────────────────────────────────

describe(WORKFLOW, () => {
  const text = read(WORKFLOW);
  const workflow = yaml.load(text);
  const jobs = workflow.jobs;

  function scriptOf(job) {
    return job.steps
      .map((step) => {
        return step.run || "";
      })
      .find((command) => {
        return command.includes(`./${SCRIPTS}/`);
      });
  }

  test("runs after each release run, every day, by hand for any version, and for a pull request that changes it", () => {
    const releaseName = yaml.load(read(RELEASE)).name;

    expect(workflow.on.workflow_run).toEqual({
      workflows: [releaseName],
      types: ["completed"],
      branches: ["release"],
    });
    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.on.workflow_dispatch.inputs.version.type).toBe("string");

    // Not a release's gate pull request into `release`.
    expect(workflow.on.pull_request.branches).toEqual(["master"]);
    const paths = workflow.on.pull_request.paths;
    expect(paths).toContain(WORKFLOW);
    for (const job of Object.values(jobs)) {
      const script = scriptOf(job).match(
        /\.\/(Scripts\/PackageManagers\/\S+\.sh)/,
      )[1];
      expect(paths).toContain(script);
      expect(fs.existsSync(path.join(REPO_ROOT, script))).toBe(true);
    }
  });

  test("reads the repository and nothing else, and uses no secret", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(jobs)) {
      expect(job.permissions).toBeUndefined();
      expect(job["timeout-minutes"]).toBeGreaterThan(0);
    }
    expect(text).not.toMatch(/secrets\./);
  });

  test("status runs ReleaseStatus.sh with the run's token and hands its states to the other jobs", () => {
    const step = jobs.status.steps.find((candidate) => {
      return candidate.id === "status";
    });

    expect(step.run).toBe(
      `bash ./${SCRIPTS}/ReleaseStatus.sh \${VERSION:+"$VERSION"}`,
    );
    expect(step.env).toEqual({
      GH_TOKEN: "${{ github.token }}",
      VERSION: "${{ inputs.version }}",
    });
    expect(jobs.status.outputs).toEqual({
      version: "${{ steps.status.outputs.version }}",
      apt: "${{ steps.status.outputs.apt }}",
      yum: "${{ steps.status.outputs.yum }}",
      homebrew: "${{ steps.status.outputs.homebrew }}",
    });
  });

  test("apt-dnf installs, on x64 and Arm, once the site has the version, from every family the docs cover", () => {
    const job = jobs["apt-dnf"];

    expect(job.needs).toBe("status");
    expect(job.if).toContain("!cancelled()");
    expect(job.if).toContain("needs.status.outputs.apt == 'published'");
    expect(job.if).toContain("needs.status.outputs.yum == 'published'");
    expect(
      job.strategy.matrix.include.map((entry) => entry.runner).sort(),
    ).toEqual(["ubuntu-24.04-arm", "ubuntu-latest"]);

    const command = scriptOf(job);
    expect(command).toContain('InstallFromPackageRepository.sh "$VERSION"');
    const images = command
      .split(/\s+/)
      .filter((word) => word.includes(":") && !word.includes("$"));
    for (const image of images) {
      expect(image).toMatch(/^mirror\.gcr\.io\/library\//);
    }
    for (const family of [
      "debian",
      "ubuntu",
      "rockylinux",
      "almalinux",
      "fedora",
      "amazonlinux",
    ]) {
      expect(images.some((image) => image.includes(`/${family}:`))).toBe(true);
    }
    expect(job.steps.at(-1).env).toEqual({
      VERSION: "${{ needs.status.outputs.version }}",
    });
  });

  test("homebrew installs on macOS once the tap has the version", () => {
    const job = jobs.homebrew;

    expect(job.needs).toBe("status");
    expect(job["runs-on"]).toMatch(/^macos-/);
    expect(job.if).toContain("!cancelled()");
    expect(job.if).toContain("needs.status.outputs.homebrew == 'published'");
    expect(scriptOf(job)).toBe(
      `bash ./${SCRIPTS}/InstallFromHomebrew.sh "$VERSION"`,
    );
    expect(job.steps.at(-1).env).toEqual({
      VERSION: "${{ needs.status.outputs.version }}",
    });
  });
});
