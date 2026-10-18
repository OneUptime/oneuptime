"use strict";

/**
 * The OneUptime infrastructure agent in the package managers fleet tools
 * install from: the signed apt and yum repository at packages.oneuptime.com,
 * the Homebrew cask in OneUptime/homebrew-tap, and winget.
 *
 * GoReleaser generates the cask and the winget manifests in
 * infrastructure-agent-build (agents/InfrastructureAgent/.goreleaser.yaml),
 * and release.yml's publish-infrastructure-agent-* jobs publish them, and the
 * packages, with Scripts/PackageManagers once finalize-github-release has
 * published the release they download from.
 *
 * This suite reads the config and the jobs, and runs the Homebrew publish
 * against a local git repository and the winget publish against a fake `gh`.
 * package-repository-e2e.sh runs the apt and yum publish with the real
 * tools, and installs from what it publishes.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { needsOf, ancestorsOf, stepCommand } = require("./Utils/ReleaseWorkflow");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE = ".github/workflows/release.yml";
const GORELEASER = "agents/InfrastructureAgent/.goreleaser.yaml";
const SCRIPTS = "Scripts/PackageManagers";
const ENVIRONMENT = "package-managers";
const MANIFESTS_ARTIFACT = "infrastructure-agent-package-manifests";
const PACKAGES_ARTIFACT = "release-infrastructure-agent";
const VERSION_EXPRESSION = "${{ needs.read-version.outputs.major_minor }}";

const E2E_JOBS = [
  "test-e2e-release-saas",
  "test-e2e-release-self-hosted",
  "test-e2e-release-enterprise",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const jobs = yaml.load(read(RELEASE)).jobs;
const goreleaser = yaml.load(read(GORELEASER));
const cask = goreleaser.homebrew_casks[0];
const winget = goreleaser.winget[0];

/*
 * Each publish job, the script its last step runs, and exactly what that
 * step hands the script: the version and files it publishes, and its
 * secrets, which the job's first step checks.
 */
const PUBLISH_JOBS = {
  "publish-infrastructure-agent-apt-yum": {
    script: `${SCRIPTS}/PublishPackageRepository.sh`,
    secrets: ["PACKAGE_REPOSITORY_DEPLOY_KEY", "GPG_PRIVATE_KEY"],
    env: ["PACKAGE_VERSION", "PACKAGES_DIR"],
    artifact: PACKAGES_ARTIFACT,
  },
  "publish-infrastructure-agent-homebrew": {
    script: `${SCRIPTS}/PublishHomebrewCask.sh`,
    secrets: ["HOMEBREW_TAP_DEPLOY_KEY"],
    env: ["PACKAGE_VERSION", "CASK_FILE"],
    artifact: MANIFESTS_ARTIFACT,
  },
  "publish-infrastructure-agent-winget": {
    script: `${SCRIPTS}/PublishWingetManifests.sh`,
    secrets: ["WINGET_GITHUB_TOKEN"],
    env: ["PACKAGE_VERSION", "WINGET_MANIFESTS", "WINGET_FORK_OWNER"],
    artifact: MANIFESTS_ARTIFACT,
  },
};

const PUBLISH_JOB_NAMES = Object.keys(PUBLISH_JOBS);

// The release asset URL GoReleaser writes into the cask and the manifests.
const RELEASE_DOWNLOAD =
  "https://github.com/OneUptime/oneuptime/releases/download/{{ .Tag }}/{{ .ArtifactName }}";

function stepsUsing(job, action) {
  return (job.steps || []).filter((step) => {
    return (step.uses || "").startsWith(`${action}@`);
  });
}

function downloadOf(job, artifact) {
  return stepsUsing(job, "actions/download-artifact").find((step) => {
    return step.with.name === artifact;
  });
}

function publishStep(name) {
  const steps = jobs[name].steps;
  return steps[steps.length - 1];
}

// A child process that sees none of this machine's git configuration.
const ISOLATED_GIT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

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

describe(`${GORELEASER}: what the package managers are given`, () => {
  test("the packages carry the release's version, not GoReleaser's snapshot version", () => {
    // release.yml runs GoReleaser with --snapshot and GORELEASER_CURRENT_TAG.
    expect(goreleaser.snapshot.version_template).toBe("{{ .Version }}");
    expect(
      stepCommand(
        jobs["infrastructure-agent-build"].steps.find((step) => {
          return step.name === "Run GoReleaser";
        }),
      ),
    ).toContain(
      "GORELEASER_CURRENT_TAG=${{needs.read-version.outputs.major_minor}} && goreleaser release --clean --snapshot",
    );
  });

  test("builds the .deb and .rpm under the names the repository build reads", () => {
    const nfpm = goreleaser.nfpms[0];
    const build = read(`${SCRIPTS}/BuildPackageRepository.sh`);

    expect(nfpm.package_name).toBe("oneuptime-infrastructure-agent");
    expect(nfpm.formats).toEqual(expect.arrayContaining(["deb", "rpm"]));
    expect(nfpm.file_name_template).toBe(
      "oneuptime-infrastructure-agent_{{ .Arch }}.{{ .Format }}",
    );
    expect(build).toContain('readonly PACKAGE="oneuptime-infrastructure-agent"');
    expect(build).toContain('deb="$PACKAGES/${PACKAGE}_${arch}.deb"');
    expect(build).toContain('rpm_file="$PACKAGES/${PACKAGE}_${arch}.rpm"');
    expect(build).toContain("readonly ARCHES=(amd64 arm64)");
    expect(goreleaser.builds[0].goarch).toEqual(["amd64", "arm64"]);
  });

  test("the packages name a homepage that parses, and depend on nothing the agent does not run", () => {
    const nfpm = goreleaser.nfpms[0];

    expect(new URL(nfpm.homepage).origin).toBe("https://oneuptime.com");
    expect(nfpm.dependencies).not.toContain("git");
  });

  test("the cask installs the binary from this release's archives, and GoReleaser publishes it nowhere", () => {
    expect(cask.name).toBe("oneuptime-infrastructure-agent");
    expect(cask.binaries).toEqual(["oneuptime-infrastructure-agent"]);
    expect(cask.url.template).toBe(RELEASE_DOWNLOAD);
    expect(cask.url.verified).toBe("github.com/OneUptime/oneuptime/");
    expect(cask.directory).toBe("Casks");
    expect(cask.skip_upload).toBe(true);
    expect(cask.repository).toEqual(
      expect.objectContaining({ owner: "OneUptime", name: "homebrew-tap" }),
    );
    // The binary is not notarized: without this, Gatekeeper refuses it.
    expect(cask.hooks.post.install).toContain(
      '"com.apple.quarantine", "#{staged_path}/oneuptime-infrastructure-agent"',
    );
  });

  test("the winget manifests point at this release's zips, under the identifier the publish uses", () => {
    const publish = read(`${SCRIPTS}/PublishWingetManifests.sh`);

    expect(winget.package_identifier).toBe("OneUptime.InfrastructureAgent");
    expect(winget.url_template).toBe(RELEASE_DOWNLOAD);
    expect(winget.skip_upload).toBe(true);
    // A moniker is a command people type: GoReleaser writes the name as one.
    expect(winget.name).toMatch(/^[a-z0-9-]+$/);
    expect(publish).toContain(
      'readonly PACKAGE_ID="OneUptime.InfrastructureAgent"',
    );
    expect(publish).toContain(
      'readonly PACKAGE_DIR="manifests/o/OneUptime/InfrastructureAgent"',
    );
    expect(goreleaser.archives[0].format_overrides).toEqual([
      { goos: "windows", format: "zip" },
    ]);
  });
});

describe(`${RELEASE}: infrastructure-agent-build keeps the cask and the manifests`, () => {
  const build = jobs["infrastructure-agent-build"];
  const uploads = stepsUsing(build, "actions/upload-artifact");
  const manifests = uploads.find((step) => {
    return step.with.name === MANIFESTS_ARTIFACT;
  });

  test("as an artifact of their own, after the release's, replaced on a re-run, failing when empty", () => {
    expect(uploads.map((step) => step.with.name)).toEqual([
      PACKAGES_ARTIFACT,
      MANIFESTS_ARTIFACT,
    ]);
    expect(manifests.with).toEqual(
      expect.objectContaining({
        "if-no-files-found": "error",
        overwrite: true,
      }),
    );
    expect(manifests.with["retention-days"]).toBeGreaterThanOrEqual(30);
    expect(manifests.with.path.trim().split("\n")).toEqual([
      "agents/InfrastructureAgent/dist/homebrew",
      "agents/InfrastructureAgent/dist/winget",
    ]);
  });

  test("which the release does not attach", () => {
    expect(downloadOf(jobs["finalize-github-release"], MANIFESTS_ARTIFACT)).toBe(
      undefined,
    );
  });
});

describe.each(PUBLISH_JOB_NAMES)(`${RELEASE}: %s`, (name) => {
  const job = jobs[name];
  const expected = PUBLISH_JOBS[name];
  const steps = job.steps;
  const check = steps[0];
  const publish = publishStep(name);

  test("runs once the release is published, so only after the e2e jobs pass, and only for `release`", () => {
    expect(needsOf(job)).toEqual(
      expect.arrayContaining([
        "read-version",
        "infrastructure-agent-build",
        "finalize-github-release",
      ]),
    );
    const waitsFor = ancestorsOf(jobs, name);
    for (const e2e of E2E_JOBS) {
      expect({ e2e, waited: waitsFor.has(e2e) }).toEqual({ e2e, waited: true });
    }
    // No status function: Actions requires every job it needs to succeed.
    expect(job.if).toBe("github.ref == 'refs/heads/release'");
  });

  test(`reads its secrets in the ${ENVIRONMENT} environment, may read the repository and nothing else, and has a timeout`, () => {
    expect(job.environment).toBe(ENVIRONMENT);
    expect(job.permissions).toEqual({ contents: "read" });
    expect(Number.isInteger(job["timeout-minutes"])).toBe(true);
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
  });

  test("checks its secrets first, and every later step runs only when they are set", () => {
    expect(check.id).toBe("secrets");
    expect(Object.keys(check.env).sort()).toEqual([...expected.secrets].sort());
    for (const secret of expected.secrets) {
      expect(check.env[secret]).toBe(`\${{ secrets.${secret} }}`);
    }
    for (const step of steps.slice(1)) {
      expect({ step: step.name || step.uses, if: step.if }).toEqual({
        step: step.name || step.uses,
        if: "steps.secrets.outputs.publish == 'true'",
      });
    }
  });

  test("is skipped with a notice, not failed, while a secret is missing, and publishes once all are set", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "package-managers-check-"));
    try {
      const outcome = (values) => {
        const output = path.join(work, `output-${Object.values(values).join("-")}`);
        const result = run("bash", ["-e", "-c", check.run], {
          env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...values },
        });
        expect(result.status).toBe(0);
        return {
          output: fs.readFileSync(output, "utf8").trim(),
          notice: /^::notice /m.test(result.stdout),
        };
      };
      const all = Object.fromEntries(
        expected.secrets.map((secret) => [secret, "set"]),
      );

      expect(outcome(all)).toEqual({ output: "publish=true", notice: false });
      for (const secret of expected.secrets) {
        expect({ missing: secret, ...outcome({ ...all, [secret]: "" }) }).toEqual({
          missing: secret,
          output: "publish=false",
          notice: true,
        });
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  test("checks out the commit that triggered the run, and hands values to scripts only through env", () => {
    const checkouts = stepsUsing(job, "actions/checkout");
    expect(checkouts).toHaveLength(1);
    expect((checkouts[0].with || {}).ref).toBe(undefined);
    expect(
      steps
        .filter((step) => {
          return stepCommand(step).includes("${{");
        })
        .map((step) => step.name || step.uses),
    ).toEqual([]);
  });

  test("runs its script with the version, the files and the secrets it needs, and nothing else", () => {
    expect(publish.run).toBe(`bash ./${expected.script}`);
    expect(fs.existsSync(path.join(REPO_ROOT, expected.script))).toBe(true);
    expect(Object.keys(publish.env).sort()).toEqual(
      [...expected.env, ...expected.secrets].sort(),
    );
    expect(publish.env.PACKAGE_VERSION).toBe(VERSION_EXPRESSION);
    for (const secret of expected.secrets) {
      expect(publish.env[secret]).toBe(`\${{ secrets.${secret} }}`);
    }
    expect(downloadOf(job, expected.artifact)).toBeDefined();
  });

  test("is the only job that reads its deploy key or token", () => {
    const own = expected.secrets.filter((secret) => {
      return secret !== "GPG_PRIVATE_KEY";
    });
    for (const [other, definition] of Object.entries(jobs)) {
      if (other === name) {
        continue;
      }
      for (const secret of own) {
        expect({
          other,
          secret,
          reads: JSON.stringify(definition).includes(secret),
        }).toEqual({ other, secret, reads: false });
      }
    }
  });
});

describe(`${RELEASE}: what each publish job publishes`, () => {
  test("only these jobs run in the package-managers environment", () => {
    expect(
      Object.keys(jobs)
        .filter((name) => {
          return jobs[name].environment === ENVIRONMENT;
        })
        .sort(),
    ).toEqual([...PUBLISH_JOB_NAMES].sort());
  });

  test("apt and yum: this release's .deb and .rpm, the release key, and the tools the build needs, one run at a time", () => {
    const name = "publish-infrastructure-agent-apt-yum";
    const job = jobs[name];
    const download = downloadOf(job, PACKAGES_ARTIFACT);
    const install = job.steps.find((step) => {
      return step.name === "Install the repository tools";
    });

    expect(publishStep(name).env.PACKAGES_DIR).toBe(download.with.path);
    expect(stepCommand(install)).toContain(
      "install -y --no-install-recommends apt-utils createrepo-c rpm",
    );
    expect(job.concurrency).toEqual({
      group: "infrastructure-agent-package-repository",
      "cancel-in-progress": false,
    });
  });

  test("Homebrew: the cask GoReleaser wrote, from where the artifact puts it", () => {
    const name = "publish-infrastructure-agent-homebrew";
    const download = downloadOf(jobs[name], MANIFESTS_ARTIFACT);

    expect(publishStep(name).env.CASK_FILE).toBe(
      `${download.with.path}/homebrew/${cask.directory}/${cask.name}.rb`,
    );
    expect(jobs[name].concurrency).toEqual({
      group: "infrastructure-agent-homebrew-tap",
      "cancel-in-progress": false,
    });
  });

  test("winget: this version's manifests, from where the artifact puts them", () => {
    const name = "publish-infrastructure-agent-winget";
    const download = downloadOf(jobs[name], MANIFESTS_ARTIFACT);

    expect(publishStep(name).env.WINGET_MANIFESTS).toBe(
      `${download.with.path}/winget/manifests/o/OneUptime/InfrastructureAgent/${VERSION_EXPRESSION}`,
    );
    expect(publishStep(name).env.WINGET_FORK_OWNER).toBe(
      "${{ vars.WINGET_FORK_OWNER }}",
    );
  });
});

describe(`${SCRIPTS}: the scripts`, () => {
  const scripts = fs
    .readdirSync(path.join(REPO_ROOT, SCRIPTS))
    .filter((file) => file.endsWith(".sh"));

  test("are all here (the checks below are not vacuous)", () => {
    expect(scripts.sort()).toEqual([
      "BuildPackageRepository.sh",
      "GitHubDeployKey.sh",
      "PublishHomebrewCask.sh",
      "PublishPackageRepository.sh",
      "PublishWingetManifests.sh",
    ]);
  });

  test.each(scripts)("%s parses, and passes shellcheck when it is installed", (script) => {
    const file = path.join(REPO_ROOT, SCRIPTS, script);
    expect(run("bash", ["-n", file]).status).toBe(0);

    if (run("sh", ["-c", "command -v shellcheck"]).status === 0) {
      const result = run("shellcheck", ["-x", "--source-path=SCRIPTDIR", file], {
        cwd: path.join(REPO_ROOT, SCRIPTS),
      });
      expect(result.stdout + result.stderr).toBe("");
    }
  });

  test("ssh trusts github.com's own host key, and nothing else", () => {
    const helper = read(`${SCRIPTS}/GitHubDeployKey.sh`);

    expect(helper).toContain(
      "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
    );
    expect(helper).toContain("-o StrictHostKeyChecking=yes");
    expect(helper).toContain("-o HostKeyAlgorithms=ssh-ed25519");
  });

  test("the site pushes one commit in place of the last, never over one it did not clone", () => {
    const publish = read(`${SCRIPTS}/PublishPackageRepository.sh`);

    expect(publish).toContain('checkout --quiet --orphan "publish-$VERSION"');
    expect(publish).toContain('--force-with-lease="refs/heads/$BRANCH:$BASE"');
  });
});

describe(`${SCRIPTS}/PublishHomebrewCask.sh`, () => {
  const SCRIPT = `${SCRIPTS}/PublishHomebrewCask.sh`;
  let work = "";
  let tap = "";

  function caskFor(version) {
    const file = path.join(work, `cask-${version}`, `${cask.name}.rb`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        "# This file was generated by GoReleaser. DO NOT EDIT.",
        `cask "${cask.name}" do`,
        `  name "${cask.name}"`,
        `  version "${version}"`,
        `  binary "${cask.name}"`,
        "end",
        "",
      ].join("\n"),
    );
    return file;
  }

  function publish(version, { caskFile = caskFor(version), key = "deploy key" } = {}) {
    return run("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...ISOLATED_GIT,
        PACKAGE_VERSION: version,
        CASK_FILE: caskFile,
        HOMEBREW_TAP_DEPLOY_KEY: key,
        HOMEBREW_TAP_REPOSITORY: tap,
      },
    });
  }

  function tapLog() {
    const result = run("git", ["--git-dir", tap, "log", "--format=%s", "main"], {
      env: { ...process.env, ...ISOLATED_GIT },
    });
    return result.status === 0 ? result.stdout.trim().split("\n") : [];
  }

  function tapCaskVersion() {
    const result = run(
      "git",
      ["--git-dir", tap, "show", `main:Casks/${cask.name}.rb`],
      { env: { ...process.env, ...ISOLATED_GIT } },
    );
    return (result.stdout.match(/^ {2}version "(.*)"$/m) || [])[1];
  }

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "homebrew-tap-"));
    tap = path.join(work, "homebrew-tap.git");
    expect(
      run("git", ["init", "--quiet", "--bare", "--initial-branch=main", tap], {
        env: { ...process.env, ...ISOLATED_GIT },
      }).status,
    ).toBe(0);
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  test("commits the cask to an empty tap, under Casks/", () => {
    const result = publish("1.2.3");

    expect(result.status).toBe(0);
    expect(tapLog()).toEqual([`${cask.name} 1.2.3`]);
    expect(tapCaskVersion()).toBe("1.2.3");
  });

  test("commits nothing for a version the tap has, or for an older one", () => {
    expect(publish("1.2.10").status).toBe(0);

    const again = publish("1.2.10");
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("already has");

    const older = publish("1.2.9");
    expect(older.status).toBe(0);
    expect(older.stdout).toContain("newer than 1.2.9");

    expect(tapLog()).toEqual([`${cask.name} 1.2.10`]);
    expect(tapCaskVersion()).toBe("1.2.10");
  });

  test("replaces the cask with a newer version's", () => {
    expect(publish("1.2.3").status).toBe(0);
    expect(publish("1.3.0").status).toBe(0);

    expect(tapLog()).toEqual([`${cask.name} 1.3.0`, `${cask.name} 1.2.3`]);
    expect(tapCaskVersion()).toBe("1.3.0");
  });

  test("refuses a cask written for another version, and a missing key, before touching the tap", () => {
    const wrong = publish("1.2.4", { caskFile: caskFor("1.2.3") });
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain("is for version '1.2.3', not 1.2.4");

    const keyless = publish("1.2.3", { key: "" });
    expect(keyless.status).not.toBe(0);
    expect(keyless.stderr).toContain("HOMEBREW_TAP_DEPLOY_KEY is required");

    expect(tapLog()).toEqual([]);
  });
});

describe(`${SCRIPTS}/PublishWingetManifests.sh`, () => {
  const SCRIPT = `${SCRIPTS}/PublishWingetManifests.sh`;
  const VERSION = "1.2.3";
  const PACKAGE_DIR = "manifests/o/OneUptime/InfrastructureAgent";
  const BRANCH = `OneUptime.InfrastructureAgent-${VERSION}`;
  const UPSTREAM_SHA = "1111111111111111111111111111111111111111";
  const MANIFESTS = [
    "OneUptime.InfrastructureAgent.yaml",
    "OneUptime.InfrastructureAgent.installer.yaml",
    "OneUptime.InfrastructureAgent.locale.en-US.yaml",
  ];
  let work = "";
  let runs = 0;

  // The GitHub API as the script asks it, answered from a JSON state file.
  const FAKE_GH = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
const args = process.argv.slice(2);
let method = "GET";
let endpoint = "";
let jq = "";
const fields = {};
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--method") {
    method = args[++i];
  } else if (arg === "-f" || arg === "-F") {
    const [key, ...value] = args[++i].split("=");
    fields[key] = value.join("=");
  } else if (arg === "--jq") {
    jq = args[++i];
  } else if (!endpoint) {
    endpoint = arg;
  } else {
    console.error("fake gh: unexpected argument " + arg);
    process.exit(2);
  }
}
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ command: args[0], method, endpoint, fields, jq }) + "\\n");
function answer(value) {
  if (value) {
    process.stdout.write(value + "\\n");
  }
  process.exit(0);
}
function notFound() {
  console.error("gh: Not Found (HTTP 404)");
  process.exit(1);
}
if (state.failing && endpoint.includes(state.failing)) {
  console.error("gh: Bad Gateway (HTTP 502)");
  process.exit(1);
}
const upstream = "microsoft/winget-pkgs";
let match;
if (method === "GET" && endpoint === "user") {
  answer(state.login);
} else if (method === "GET" && (match = endpoint.match(/^repos\\/microsoft\\/winget-pkgs\\/contents\\/(.*)\\?ref=master$/))) {
  state.upstreamPaths.includes(match[1]) ? answer("{}") : notFound();
} else if (method === "GET" && (match = endpoint.match(/^repos\\/microsoft\\/winget-pkgs\\/pulls\\?state=open&head=(.*)$/))) {
  answer((state.openPulls || {})[match[1]] || "");
} else if (method === "GET" && endpoint === "repos/" + upstream + "/git/ref/heads/master") {
  answer(state.upstreamSha);
} else if (method === "GET" && (match = endpoint.match(/^repos\\/([^/]+\\/winget-pkgs)$/))) {
  const parent = (state.forks || {})[match[1]];
  if (parent === undefined) {
    notFound();
  }
  answer(jq ? parent : "{}");
} else if (method === "GET" && (match = endpoint.match(/^repos\\/[^/]+\\/winget-pkgs\\/git\\/ref\\/heads\\/(.*)$/))) {
  (state.forkBranches || []).includes(match[1]) ? answer("{}") : notFound();
} else if (method === "POST" && endpoint === "repos/" + upstream + "/pulls") {
  answer("https://github.com/microsoft/winget-pkgs/pull/4242");
} else if (method !== "GET") {
  answer("{}");
} else {
  console.error("fake gh: no answer for " + method + " " + endpoint);
  process.exit(2);
}
`;

  function writeManifests(version) {
    const directory = path.join(work, `manifests-${version}`);
    fs.mkdirSync(directory, { recursive: true });
    for (const manifest of MANIFESTS) {
      fs.writeFileSync(
        path.join(directory, manifest),
        [
          "# This file was generated by GoReleaser. DO NOT EDIT.",
          "PackageIdentifier: OneUptime.InfrastructureAgent",
          `PackageVersion: ${version}`,
          `ManifestType: ${manifest}`,
          "",
        ].join("\n"),
      );
    }
    return directory;
  }

  function publish({
    state = {},
    version = VERSION,
    manifests = writeManifests(version),
    token = "token",
    forkOwner = "",
  } = {}) {
    runs += 1;
    const log = path.join(work, `gh-${runs}.log`);
    const stateFile = path.join(work, `state-${runs}.json`);
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        login: "oneuptime-bot",
        upstreamSha: UPSTREAM_SHA,
        upstreamPaths: [PACKAGE_DIR],
        forks: { "oneuptime-bot/winget-pkgs": "microsoft/winget-pkgs" },
        ...state,
      }),
    );
    fs.writeFileSync(log, "");

    const result = run("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${path.join(work, "bin")}${path.delimiter}${process.env.PATH}`,
        PACKAGE_VERSION: version,
        WINGET_MANIFESTS: manifests,
        WINGET_GITHUB_TOKEN: token,
        WINGET_FORK_OWNER: forkOwner,
        WINGET_RETRY_DELAY_SECONDS: "0",
        FAKE_GH_STATE: stateFile,
        FAKE_GH_LOG: log,
      },
    });
    const calls = fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return {
      ...result,
      calls,
      writes: calls.filter((call) => call.method !== "GET"),
    };
  }

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "winget-publish-"));
    fs.mkdirSync(path.join(work, "bin"));
    fs.writeFileSync(path.join(work, "bin", "gh"), FAKE_GH, { mode: 0o755 });
  });

  afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  test("opens the pull request for a new version: a branch at winget-pkgs' newest commit, the three manifests as written, from the fork", () => {
    const manifests = writeManifests(VERSION);
    const result = publish({ manifests });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Opened https://github.com/microsoft/winget-pkgs/pull/4242",
    );

    const [branch, ...rest] = result.writes;
    expect(branch).toEqual(
      expect.objectContaining({
        method: "POST",
        endpoint: "repos/oneuptime-bot/winget-pkgs/git/refs",
        fields: { ref: `refs/heads/${BRANCH}`, sha: UPSTREAM_SHA },
      }),
    );

    const files = rest.slice(0, MANIFESTS.length);
    expect(files.map((call) => [call.method, call.endpoint])).toEqual(
      MANIFESTS.map((manifest) => [
        "PUT",
        `repos/oneuptime-bot/winget-pkgs/contents/${PACKAGE_DIR}/${VERSION}/${manifest}`,
      ]),
    );
    files.forEach((call, index) => {
      expect(call.fields.branch).toBe(BRANCH);
      expect(Buffer.from(call.fields.content, "base64").toString("utf8")).toBe(
        fs.readFileSync(path.join(manifests, MANIFESTS[index]), "utf8"),
      );
    });

    const pull = rest[MANIFESTS.length];
    expect(rest).toHaveLength(MANIFESTS.length + 1);
    expect(pull).toEqual(
      expect.objectContaining({
        method: "POST",
        endpoint: "repos/microsoft/winget-pkgs/pulls",
      }),
    );
    expect(pull.fields).toEqual(
      expect.objectContaining({
        title: `New version: OneUptime.InfrastructureAgent version ${VERSION}`,
        head: `oneuptime-bot:${BRANCH}`,
        base: "master",
      }),
    );
  });

  test("calls the first one a new package", () => {
    const result = publish({ state: { upstreamPaths: [] } });

    expect(result.status).toBe(0);
    expect(result.writes[result.writes.length - 1].fields.title).toBe(
      `New package: OneUptime.InfrastructureAgent version ${VERSION}`,
    );
  });

  test("opens nothing for a version winget-pkgs has, or one with a pull request open", () => {
    const merged = publish({
      state: { upstreamPaths: [PACKAGE_DIR, `${PACKAGE_DIR}/${VERSION}`] },
    });
    expect(merged.status).toBe(0);
    expect(merged.stdout).toContain("already has");
    expect(merged.writes).toEqual([]);

    const waiting = publish({
      state: {
        openPulls: {
          [`oneuptime-bot:${BRANCH}`]:
            "https://github.com/microsoft/winget-pkgs/pull/4000",
        },
      },
    });
    expect(waiting.status).toBe(0);
    expect(waiting.stdout).toContain("already waiting");
    expect(waiting.writes).toEqual([]);
  });

  test("moves a branch a stopped run left behind, instead of making it again", () => {
    const result = publish({ state: { forkBranches: [BRANCH] } });

    expect(result.status).toBe(0);
    expect(result.writes[0]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        endpoint: `repos/oneuptime-bot/winget-pkgs/git/refs/heads/${BRANCH}`,
        fields: { sha: UPSTREAM_SHA, force: "true" },
      }),
    );
  });

  test("uses the fork WINGET_FORK_OWNER names", () => {
    const result = publish({
      forkOwner: "OneUptime",
      state: { forks: { "OneUptime/winget-pkgs": "microsoft/winget-pkgs" } },
    });

    expect(result.status).toBe(0);
    expect(result.calls.some((call) => call.endpoint === "user")).toBe(false);
    expect(result.writes[result.writes.length - 1].fields.head).toBe(
      `OneUptime:${BRANCH}`,
    );
  });

  test("stops, writing nothing, without a fork of winget-pkgs", () => {
    const missing = publish({ state: { forks: {} } });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("fork microsoft/winget-pkgs into oneuptime-bot first");
    expect(missing.writes).toEqual([]);

    const other = publish({
      state: { forks: { "oneuptime-bot/winget-pkgs": "someone/winget-pkgs" } },
    });
    expect(other.status).not.toBe(0);
    expect(other.stderr).toContain("is not a fork of microsoft/winget-pkgs");
    expect(other.writes).toEqual([]);
  });

  test("asks again when GitHub does not answer, and then stops, writing nothing", () => {
    const result = publish({ state: { failing: "/contents/" } });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("could not ask GitHub");
    expect(
      result.calls.filter((call) => call.endpoint.includes("/contents/")),
    ).toHaveLength(4);
    expect(result.writes).toEqual([]);
  });

  test("refuses manifests for another version, and a missing token, before asking GitHub anything", () => {
    const wrong = publish({ version: "1.2.4", manifests: writeManifests("1.2.3") });
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain("is not for version 1.2.4");
    expect(wrong.calls).toEqual([]);

    const tokenless = publish({ token: "" });
    expect(tokenless.status).not.toBe(0);
    expect(tokenless.stderr).toContain("WINGET_GITHUB_TOKEN is required");
    expect(tokenless.calls).toEqual([]);
  });
});
