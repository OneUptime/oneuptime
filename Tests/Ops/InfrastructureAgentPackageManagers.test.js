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

const {
  needsOf,
  ancestorsOf,
  stepCommand,
} = require("./Utils/ReleaseWorkflow");

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

/*
 * A program, run with a list of arguments: a script's path, a repository's
 * path. No shell reads them, so nothing in them is a command.
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

/*
 * A release.yml step's script, run the way the step runs it (bash -e). The
 * one command line this suite hands a shell: kept apart from run(), so no
 * path passed to a program is ever read as part of one.
 */
function runStepScript(script, options = {}) {
  const result = spawnSync("bash", ["-e", "-c", script], {
    encoding: "utf8",
    timeout: 120000,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

// Whether shellcheck is installed, asked of shellcheck itself.
function hasShellcheck() {
  const result = spawnSync("shellcheck", ["--version"], {
    encoding: "utf8",
    timeout: 120000,
  });
  return !result.error && result.status === 0;
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
    expect(build).toContain(
      'readonly PACKAGE="oneuptime-infrastructure-agent"',
    );
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
    expect(cask.directory).toBe("Casks");
    expect(cask.skip_upload).toBe(true);
    expect(cask.repository).toEqual(
      expect.objectContaining({ owner: "OneUptime", name: "homebrew-tap" }),
    );
  });

  /*
   * Homebrew 7 deprecates the `verified:` url parameter and `postflight`
   * blocks, and every brew command that read a cask with either printed a
   * warning asking users to report it to the tap. GoReleaser writes
   * hooks.post.install as `postflight`, and writes each line of its caveats
   * field as a string of its own in a `caveats do` block, where Ruby keeps
   * only the last: brew showed only the line about restarting after an
   * upgrade. So the cask's Ruby is written in custom_block instead.
   */
  test("the cask uses nothing Homebrew 7 deprecates, and shows every line of its caveats", () => {
    expect(cask.url.verified).toBeUndefined();
    expect(cask.hooks).toBeUndefined();
    expect(cask.caveats).toBeUndefined();
    expect(cask.custom_block).not.toMatch(/^\s*postflight do/m);
    expect(cask.custom_block).toContain("caveats <<~EOS\n");
    expect(cask.custom_block).toContain(
      "  sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com\n",
    );
    expect(cask.custom_block).toContain(
      "  sudo oneuptime-infrastructure-agent start\n",
    );
  });

  /*
   * The binary is not notarized, and Homebrew quarantines what a cask
   * downloads, so without this Gatekeeper refuses to run it. GoReleaser
   * templates the cask, so the step's {{staged_path}} is written escaped.
   */
  test("the cask takes the quarantine off the binary in a postflight step that cannot fail the install", () => {
    expect(cask.custom_block).toContain(
      [
        "postflight_steps do",
        "  on_macos do",
        '    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{ "{{staged_path}}" }}/oneuptime-infrastructure-agent"], must_succeed: false',
        "  end",
        "end",
      ].join("\n"),
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
    expect(
      downloadOf(jobs["finalize-github-release"], MANIFESTS_ARTIFACT),
    ).toBe(undefined);
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
    const work = fs.mkdtempSync(
      path.join(os.tmpdir(), "package-managers-check-"),
    );
    try {
      const outcome = (values) => {
        const output = path.join(
          work,
          `output-${Object.values(values).join("-")}`,
        );
        const result = runStepScript(check.run, {
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
        expect({
          missing: secret,
          ...outcome({ ...all, [secret]: "" }),
        }).toEqual({
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

  /*
   * Once its pull request is open, PublishWingetManifests.sh waits for
   * Microsoft's CLA bot: up to WINGET_CLA_WAIT_SECONDS for its Needs-CLA
   * label, then up to WINGET_CLA_CLEAR_WAIT_SECONDS for the label to go. A
   * job that timed out in those waits would fail the release over a pull
   * request that is open.
   */
  test("winget: the job outlasts the script's waits for Microsoft's CLA bot, and keeps the 15 minutes it had for the rest", () => {
    const script = read(`${SCRIPTS}/PublishWingetManifests.sh`);
    const defaultSeconds = (setting) => {
      const match = script.match(new RegExp(`"\\$\\{${setting}:-(\\d+)\\}"`));
      return match ? Number(match[1]) : NaN;
    };
    const waits =
      defaultSeconds("WINGET_CLA_WAIT_SECONDS") +
      defaultSeconds("WINGET_CLA_CLEAR_WAIT_SECONDS");

    expect(waits).toBe(900 + 300);
    expect(
      jobs["publish-infrastructure-agent-winget"]["timeout-minutes"] * 60,
    ).toBeGreaterThanOrEqual(waits + 15 * 60);
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
      "InstallFromHomebrew.sh",
      "InstallFromPackageRepository.sh",
      "PublishHomebrewCask.sh",
      "PublishPackageRepository.sh",
      "PublishWingetManifests.sh",
      "ReleaseStatus.sh",
    ]);
  });

  test.each(scripts)(
    "%s parses, and passes shellcheck when it is installed",
    (script) => {
      const file = path.join(REPO_ROOT, SCRIPTS, script);
      expect(run("bash", ["-n", file]).status).toBe(0);

      if (hasShellcheck()) {
        const result = run(
          "shellcheck",
          ["-x", "--source-path=SCRIPTDIR", file],
          {
            cwd: path.join(REPO_ROOT, SCRIPTS),
          },
        );
        expect(result.stdout + result.stderr).toBe("");
      }
    },
  );

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

  function publish(
    version,
    { caskFile = caskFor(version), key = "deploy key" } = {},
  ) {
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
    const result = run(
      "git",
      ["--git-dir", tap, "log", "--format=%s", "main"],
      {
        env: { ...process.env, ...ISOLATED_GIT },
      },
    );
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
  // The pull request a run opens (the fake's answer), and one a re-run finds
  // open.
  const OPENED = 4242;
  const WAITING = 4001;
  // What the account comments to agree to Microsoft's CLA: the bot asks on
  // every pull request.
  const CLA_AGREEMENT =
    '@microsoft-github-policy-service agree company="HackerBay, Inc."';
  // How long the script waits for Microsoft's CLA bot, and how often it
  // looks: unset in every run but those that set them.
  const CLA_SETTINGS = [
    "WINGET_CLA_WAIT_SECONDS",
    "WINGET_CLA_CLEAR_WAIT_SECONDS",
    "WINGET_CLA_POLL_SECONDS",
  ];
  let work = "";
  let runs = 0;

  function urlOf(number) {
    return `https://github.com/microsoft/winget-pkgs/pull/${number}`;
  }

  /*
   * A pull request in winget-pkgs: by default the account's own, open, for a
   * version of this package, titled and from the branch the script gives it.
   */
  function pullFor(
    number,
    version,
    {
      owner = "oneuptime-bot",
      packageId = "OneUptime.InfrastructureAgent",
      kind = "version",
      state = "open",
    } = {},
  ) {
    return {
      number,
      title: `New ${kind}: ${packageId} version ${version}`,
      head: `${owner}:${packageId}-${version}`,
      state,
    };
  }

  // A re-run's state: this version's pull request, WAITING, is open already.
  function rerunState({ pulls = [], ...state } = {}) {
    return { pulls: [pullFor(WAITING, VERSION), ...pulls], ...state };
  }

  // The pull request a run opened.
  function pullRequestOf(result) {
    return result.writes.find((call) => {
      return (
        call.method === "POST" &&
        call.endpoint === "repos/microsoft/winget-pkgs/pulls"
      );
    });
  }

  // A pull request as the run left it.
  function pullIn(result, number) {
    return result.pulls.find((pull) => pull.number === number);
  }

  /*
   * The GitHub API as the script asks it, answered from a JSON state file
   * that it keeps up to date, and logged with each answer. Answers made from
   * state.pulls (winget-pkgs' pull requests) go through the script's --jq
   * with jq, as gh runs it, so what the script reads out of them is its own;
   * the others are written as the script's --jq prints them.
   *
   * state.bot is Microsoft's CLA bot on the pull requests it names, as
   * winget-pkgs showed it: it labels one Needs-CLA once it has started on it
   * (asked, or once the labels have been read more than askAfterReads
   * times), ignores an agreement posted before then, and for one posted after
   * takes the label off once the labels have been read clearAfterReads more
   * times (never, with honours: false). It never asks on a pull request it
   * does not name. state.failures fails requests to an endpoint, saying
   * state.failureText: that many first ones, or those a list counts out
   * ([2] fails the second).
   */
  const FAKE_GH = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const { spawnSync } = require("child_process");
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
function finish(status, output) {
  fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
  fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ command: args[0], method, endpoint, fields, jq, status, output }) + "\\n");
  if (status !== 0) {
    console.error(output);
  } else if (output) {
    process.stdout.write(output + "\\n");
  }
  process.exit(status);
}
function answer(value) {
  finish(0, value);
}
function notFound() {
  finish(1, "gh: Not Found (HTTP 404)");
}
function answerJson(body) {
  const result = spawnSync("jq", ["-r", jq || "."], { input: JSON.stringify(body), encoding: "utf8" });
  if (result.error || result.status !== 0) {
    finish(2, "fake gh: jq failed: " + (result.error || result.stderr));
  }
  answer(result.stdout.trimEnd());
}
const failures = state.failures || {};
const requests = state.requests || (state.requests = {});
requests[endpoint] = (requests[endpoint] || 0) + 1;
const failing = failures[endpoint];
if (Array.isArray(failing) ? failing.includes(requests[endpoint]) : failing > 0) {
  if (!Array.isArray(failing)) {
    failures[endpoint] -= 1;
  }
  finish(1, state.failureText || "gh: Bad Gateway (HTTP 502)");
}
if (state.failing && endpoint.includes(state.failing)) {
  finish(1, "gh: Bad Gateway (HTTP 502)");
}
const upstream = "microsoft/winget-pkgs";
const pulls = state.pulls || (state.pulls = []);
const bot = state.bot || {};
function pullOf(number) {
  return pulls.find((pull) => String(pull.number) === String(number));
}
function labelsOf(number) {
  const pull = bot[number];
  const cleared = pull && pull.agreedAt !== undefined && pull.reads - pull.agreedAt > (pull.clearAfterReads || 0);
  return pull && pull.asked && !cleared ? [{ name: "Needs-CLA" }] : [];
}
// As GitHub's head= filter: the owner in any case, the branch exactly.
function fromHead(pull, head) {
  const [owner, branch] = pull.head.split(":");
  const [wantedOwner, wantedBranch] = head.split(":");
  return owner.toLowerCase() === wantedOwner.toLowerCase() && branch === wantedBranch;
}
function listed(pull) {
  return { number: pull.number, html_url: "https://github.com/" + upstream + "/pull/" + pull.number, title: pull.title, state: pull.state, head: { label: pull.head }, labels: labelsOf(pull.number) };
}
let match;
if (method === "GET" && endpoint === "user") {
  answer(state.login);
} else if (method === "GET" && (match = endpoint.match(/^repos\\/microsoft\\/winget-pkgs\\/contents\\/(.*)\\?ref=master$/))) {
  state.upstreamPaths.includes(match[1]) ? answer("{}") : notFound();
} else if (method === "GET" && (match = endpoint.match(/^repos\\/microsoft\\/winget-pkgs\\/pulls\\?state=open&head=(.*)$/))) {
  answerJson(pulls.filter((pull) => pull.state === "open" && fromHead(pull, match[1])).map(listed));
} else if (method === "GET" && endpoint === "search/issues") {
  // As search finds them, near enough: the package's in the title.
  const open = (fields.q || "").split(" ").includes("is:open");
  const items = pulls.filter((pull) => pull.title.includes("OneUptime.InfrastructureAgent") && (!open || pull.state === "open")).map(listed);
  answerJson({ total_count: items.length, incomplete_results: false, items });
} else if (method === "GET" && (match = endpoint.match(/^repos\\/microsoft\\/winget-pkgs\\/issues\\/(\\d+)$/))) {
  const asking = bot[match[1]];
  if (asking) {
    asking.reads = (asking.reads || 0) + 1;
    if (asking.reads > asking.askAfterReads) {
      asking.asked = true;
    }
  }
  answerJson({ number: Number(match[1]), state: "open", labels: labelsOf(match[1]) });
} else if (method === "POST" && (match = endpoint.match(/^repos\\/microsoft\\/winget-pkgs\\/issues\\/(\\d+)\\/comments$/))) {
  const pull = pullOf(match[1]);
  if (pull) {
    pull.comments = (pull.comments || []).concat(fields.body);
  }
  const asking = bot[match[1]];
  if (asking && fields.body.startsWith("@microsoft-github-policy-service agree")) {
    if (!asking.asked) {
      asking.ignored = (asking.ignored || 0) + 1;
    } else if (asking.honours !== false && asking.agreedAt === undefined) {
      asking.agreedAt = asking.reads || 0;
    }
  }
  answer("{}");
} else if (method === "PATCH" && (match = endpoint.match(/^repos\\/microsoft\\/winget-pkgs\\/pulls\\/(\\d+)$/))) {
  const pull = pullOf(match[1]);
  if (!pull) {
    notFound();
  }
  pull.state = fields.state || pull.state;
  answerJson(listed(pull));
} else if (method === "POST" && endpoint === "repos/" + upstream + "/pulls") {
  const pull = { number: 4242, title: fields.title, head: fields.head, state: "open" };
  pulls.push(pull);
  answerJson(listed(pull));
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
} else if (method !== "GET") {
  answer("{}");
} else {
  finish(2, "fake gh: no answer for " + method + " " + endpoint);
}
`;

  // sleep, without the wait: it logs how long the script asked for, in the
  // fake gh's log, so a test sees the two in order.
  const FAKE_SLEEP = `#!/bin/sh
printf '{"command":"sleep","seconds":"%s"}\\n' "$1" >>"$FAKE_GH_LOG"
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
    env = {},
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
        // The CLA bot has asked on the pull request a run opens by the time
        // its labels are first read, and accepts the agreement.
        bot: { [OPENED]: { askAfterReads: 0 } },
        ...state,
      }),
    );
    fs.writeFileSync(log, "");

    const base = {
      ...process.env,
      PATH: `${path.join(work, "bin")}${path.delimiter}${process.env.PATH}`,
      PACKAGE_VERSION: version,
      WINGET_MANIFESTS: manifests,
      WINGET_GITHUB_TOKEN: token,
      WINGET_FORK_OWNER: forkOwner,
      WINGET_RETRY_DELAY_SECONDS: "0",
      // Not a GitHub Actions job unless a test says so, though CI runs this
      // suite in one.
      GITHUB_ACTIONS: "",
      FAKE_GH_STATE: stateFile,
      FAKE_GH_LOG: log,
    };
    for (const setting of CLA_SETTINGS) {
      delete base[setting];
    }
    const result = run("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...base, ...env },
    });
    const timeline = fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const calls = timeline.filter((entry) => entry.command !== "sleep");
    const after = JSON.parse(fs.readFileSync(stateFile, "utf8"));

    return {
      ...result,
      timeline,
      calls,
      writes: calls.filter((call) => call.method !== "GET"),
      bot: after.bot,
      pulls: after.pulls || [],
    };
  }

  /*
   * What a run did about the CLA on a pull request once it had opened it, or
   * found it open, in order: each read of its labels and whether it had
   * Needs-CLA ("Needs-CLA? true", "Needs-CLA? false", or "Needs-CLA? failed"
   * when GitHub did not answer), each sleep ("sleep 20"), and each agreement
   * posted ("agree", or "agree failed").
   */
  function claSteps(result, number = OPENED) {
    const opened = result.timeline.findIndex((entry) => {
      return (
        entry.method === "POST" &&
        entry.endpoint === "repos/microsoft/winget-pkgs/pulls"
      );
    });
    const found = result.timeline.findIndex((entry) => {
      return (entry.endpoint || "").startsWith(
        "repos/microsoft/winget-pkgs/pulls?state=open",
      );
    });
    return result.timeline
      .slice((opened >= 0 ? opened : found) + 1)
      .flatMap((entry) => {
        if (entry.command === "sleep") {
          return [`sleep ${entry.seconds}`];
        }
        if (entry.endpoint === `repos/microsoft/winget-pkgs/issues/${number}`) {
          return [`Needs-CLA? ${entry.status === 0 ? entry.output : "failed"}`];
        }
        if (
          entry.endpoint ===
            `repos/microsoft/winget-pkgs/issues/${number}/comments` &&
          entry.fields.body === CLA_AGREEMENT
        ) {
          return [entry.status === 0 ? "agree" : "agree failed"];
        }
        return [];
      });
  }

  /*
   * What a run asked of the pull requests it superseded, in order: each
   * close ("close #4100") and each comment ("#4100: Superseded by ..."),
   * with "(failed)" when GitHub did not answer.
   */
  function closings(result) {
    return result.writes.flatMap((call) => {
      const failed = call.status === 0 ? "" : " (failed)";
      const closed = call.endpoint.match(
        /^repos\/microsoft\/winget-pkgs\/pulls\/(\d+)$/,
      );
      if (closed && call.method === "PATCH") {
        return [`close #${closed[1]}${failed}`];
      }
      const commented = call.endpoint.match(
        /^repos\/microsoft\/winget-pkgs\/issues\/(\d+)\/comments$/,
      );
      if (commented && call.fields.body !== CLA_AGREEMENT) {
        return [`#${commented[1]}: ${call.fields.body}${failed}`];
      }
      return [];
    });
  }

  // The warning a run gives when the label stays after its agreement.
  function labelStayed(number, seconds) {
    return `Microsoft's CLA bot had not taken the Needs-CLA label off #${number} ${seconds} seconds after the CLA agreement was posted. If the label is still there, comment this on ${urlOf(number)} by hand, from the account that opened it: ${CLA_AGREEMENT}`;
  }

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "winget-publish-"));
    fs.mkdirSync(path.join(work, "bin"));
    fs.writeFileSync(path.join(work, "bin", "gh"), FAKE_GH, { mode: 0o755 });
    fs.writeFileSync(path.join(work, "bin", "sleep"), FAKE_SLEEP, {
      mode: 0o755,
    });
  });

  afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  test("opens the pull request for a new version: a branch at winget-pkgs' newest commit, the three manifests as written, from the fork", () => {
    const manifests = writeManifests(VERSION);
    const result = publish({ manifests });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Opened ${urlOf(OPENED)}`);

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

    const [pull, agreement] = rest.slice(MANIFESTS.length);
    expect(rest).toHaveLength(MANIFESTS.length + 2);
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
    expect(agreement).toEqual(
      expect.objectContaining({
        method: "POST",
        endpoint: `repos/microsoft/winget-pkgs/issues/${OPENED}/comments`,
        fields: { body: CLA_AGREEMENT },
      }),
    );
    expect(result.stdout).toContain(
      `Posted the CLA agreement for HackerBay, Inc. on #${OPENED}.`,
    );
  });

  test("calls the first one a new package", () => {
    const result = publish({ state: { upstreamPaths: [] } });

    expect(result.status).toBe(0);
    expect(pullRequestOf(result).fields.title).toBe(
      `New package: OneUptime.InfrastructureAgent version ${VERSION}`,
    );
  });

  /*
   * GitHub refused the branch's creation once on 14.0.93's release
   * (2026-10-27) - "Reference update failed (HTTP 422)" - and the fork had
   * winget-pkgs' newest commit when it was looked at again.
   */
  test("asks again for a branch GitHub will not make at first, and still opens the pull request", () => {
    const refs = "repos/oneuptime-bot/winget-pkgs/git/refs";
    const result = publish({
      state: {
        failures: { [refs]: 1 },
        failureText: "gh: Reference update failed (HTTP 422)",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Opened ${urlOf(OPENED)}`);
    expect(
      result.calls
        .filter((call) => {
          return call.endpoint === refs;
        })
        .map((call) => {
          return call.method;
        }),
    ).toEqual(["POST", "POST"]);
    expect(result.stderr).toContain(
      `Pointing oneuptime-bot/winget-pkgs's ${BRANCH} at ${UPSTREAM_SHA} failed (attempt 1 of 4); asking again. GitHub said: gh: Reference update failed (HTTP 422)`,
    );
  });

  test("stops the job, saying what GitHub said, when it never makes the branch, and opens no pull request", () => {
    const refs = "repos/oneuptime-bot/winget-pkgs/git/refs";
    const result = publish({
      state: {
        failures: { [refs]: 100 },
        failureText: "gh: Reference update failed (HTTP 422)",
      },
    });

    expect(result.status).not.toBe(0);
    expect(
      result.calls.filter((call) => {
        return call.endpoint === refs;
      }),
    ).toHaveLength(4);
    expect(result.stderr).toContain(
      `PublishWingetManifests: could not point oneuptime-bot/winget-pkgs's ${BRANCH} at microsoft/winget-pkgs's ${UPSTREAM_SHA}: gh: Reference update failed (HTTP 422)`,
    );
    expect(
      result.writes.filter((call) => {
        return call.endpoint === "repos/microsoft/winget-pkgs/pulls";
      }),
    ).toEqual([]);
  });

  test("opens nothing for a version winget-pkgs has, or one with a pull request open, and agrees to nothing the CLA bot has not asked for", () => {
    const merged = publish({
      state: { upstreamPaths: [PACKAGE_DIR, `${PACKAGE_DIR}/${VERSION}`] },
    });
    expect(merged.status).toBe(0);
    expect(merged.stdout).toContain("already has");
    expect(merged.writes).toEqual([]);

    const waiting = publish({ state: rerunState() });
    expect(waiting.status).toBe(0);
    expect(waiting.stdout).toContain(`already waiting in ${urlOf(WAITING)}`);
    expect(waiting.stdout).toContain(
      `#${WAITING} has no Needs-CLA label, so no CLA agreement is posted. If Microsoft's CLA bot asks for one later, re-run this job.`,
    );
    expect(waiting.writes).toEqual([]);
    expect(claSteps(waiting, WAITING)).toEqual([]);
  });

  test("agrees to the CLA on a pull request a re-run finds waiting with the Needs-CLA label, opens nothing, and waits for the bot to take the label off", () => {
    // The bot asked on it before this run.
    const result = publish({
      state: rerunState({ bot: { [WAITING]: { asked: true } } }),
    });

    expect(result.status).toBe(0);
    expect(result.writes).toEqual([
      expect.objectContaining({
        method: "POST",
        endpoint: `repos/microsoft/winget-pkgs/issues/${WAITING}/comments`,
        fields: { body: CLA_AGREEMENT },
      }),
    ]);
    expect(claSteps(result, WAITING)).toEqual(["agree", "Needs-CLA? false"]);
    expect(result.stdout).toContain(
      `Microsoft's CLA bot took the Needs-CLA label off #${WAITING}: the CLA is agreed.`,
    );
  });

  test("warns, and passes, when the label stays on a pull request a re-run agreed on", () => {
    const result = publish({
      state: rerunState({
        bot: { [WAITING]: { asked: true, honours: false } },
      }),
      env: { WINGET_CLA_CLEAR_WAIT_SECONDS: "40" },
    });

    expect(result.status).toBe(0);
    expect(claSteps(result, WAITING)).toEqual([
      "agree",
      "Needs-CLA? true",
      "sleep 20",
      "Needs-CLA? true",
      "sleep 20",
      "Needs-CLA? true",
    ]);
    expect(result.stderr).toContain(
      `PublishWingetManifests: warning: ${labelStayed(WAITING, 40)}`,
    );
  });

  test("tries the CLA agreement again, then stops saying what to comment, leaving the pull request open, as a re-run does", () => {
    const result = publish({
      state: { failing: `/issues/${OPENED}/comments` },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`Opened ${urlOf(OPENED)}`);
    expect(result.stderr).toContain(
      `could not post the CLA agreement on #${OPENED}; comment it there by hand from the account that opened it: ${CLA_AGREEMENT}`,
    );
    expect(claSteps(result)).toEqual([
      "Needs-CLA? true",
      "agree failed",
      "sleep 0",
      "agree failed",
      "sleep 0",
      "agree failed",
      "sleep 0",
      "agree failed",
    ]);
    expect(pullRequestOf(result)).toBeDefined();

    const rerun = publish({
      state: rerunState({
        bot: { [WAITING]: { asked: true } },
        failing: `/issues/${WAITING}/comments`,
      }),
    });
    expect(rerun.status).not.toBe(0);
    expect(rerun.stderr).toContain(
      `could not post the CLA agreement on #${WAITING}; comment it there by hand from the account that opened it: ${CLA_AGREEMENT}`,
    );
    expect(
      claSteps(rerun, WAITING).filter((step) => step === "agree failed"),
    ).toHaveLength(4);
    expect(pullRequestOf(rerun)).toBeUndefined();
  });

  /*
   * The stand-in bot holds the tests below to what winget-pkgs showed: an
   * agreement posted before the bot has asked is ignored, and the label
   * stays. That is what happened to #456419's, posted a second after the
   * pull request was opened.
   */
  test("the stand-in CLA bot ignores an agreement posted before it asks, as the real one did on #456419", () => {
    const state = path.join(work, "bot-state.json");
    const env = {
      ...process.env,
      FAKE_GH_STATE: state,
      FAKE_GH_LOG: path.join(work, "bot.log"),
    };
    const gh = (...args) => {
      return run(path.join(work, "bin", "gh"), args, { env }).stdout.trim();
    };
    const needsCla = () => {
      return gh(
        "api",
        `repos/microsoft/winget-pkgs/issues/${OPENED}`,
        "--jq",
        'any(.labels[]; .name == "Needs-CLA")',
      );
    };
    const agree = () => {
      return gh(
        "api",
        "--method",
        "POST",
        `repos/microsoft/winget-pkgs/issues/${OPENED}/comments`,
        "-f",
        `body=${CLA_AGREEMENT}`,
      );
    };
    fs.writeFileSync(
      state,
      JSON.stringify({ bot: { [OPENED]: { askAfterReads: 1 } } }),
    );

    agree();
    expect([needsCla(), needsCla(), needsCla()]).toEqual([
      "false",
      "true",
      "true",
    ]);
    agree();
    expect(needsCla()).toBe("false");
  });

  test("waits for the CLA bot's Needs-CLA label, reading the labels every 20 seconds, then agrees and waits for the bot to take the label off", () => {
    const result = publish({
      state: { bot: { [OPENED]: { askAfterReads: 3 } } },
    });

    expect(result.status).toBe(0);
    expect(claSteps(result)).toEqual([
      "Needs-CLA? false",
      "sleep 20",
      "Needs-CLA? false",
      "sleep 20",
      "Needs-CLA? false",
      "sleep 20",
      "Needs-CLA? true",
      "agree",
      "Needs-CLA? false",
    ]);
    expect(result.stdout).toContain(
      `Microsoft's CLA bot labelled #${OPENED} Needs-CLA.`,
    );
    expect(result.stdout).toContain(
      `Microsoft's CLA bot took the Needs-CLA label off #${OPENED}: the CLA is agreed.`,
    );
    expect(result.stderr).toBe("");
  });

  test.each([0, 1, 6])(
    "never posts the agreement before the label is seen, so the CLA bot never ignores it (the bot asks at read %i)",
    (askAfterReads) => {
      const result = publish({
        state: { bot: { [OPENED]: { askAfterReads } } },
      });
      const steps = claSteps(result);
      const asked = steps.indexOf("Needs-CLA? true");

      expect(result.status).toBe(0);
      expect(asked).toBe(askAfterReads * 2);
      expect(steps.slice(0, asked)).not.toContain("agree");
      expect(steps.indexOf("agree")).toBe(asked + 1);
      expect(steps.filter((step) => step === "agree")).toHaveLength(1);
      expect(steps[steps.length - 1]).toBe("Needs-CLA? false");
      expect(result.bot[OPENED].ignored).toBeUndefined();
    },
  );

  test("posts nothing, and passes, when the CLA bot has not labelled the pull request Needs-CLA within WINGET_CLA_WAIT_SECONDS", () => {
    const result = publish({
      state: { bot: {} },
      env: { WINGET_CLA_WAIT_SECONDS: "60" },
    });

    expect(result.status).toBe(0);
    expect(claSteps(result)).toEqual([
      "Needs-CLA? false",
      "sleep 20",
      "Needs-CLA? false",
      "sleep 20",
      "Needs-CLA? false",
      "sleep 20",
      "Needs-CLA? false",
    ]);
    expect(result.stdout).toContain(
      `#${OPENED} had no Needs-CLA label after 60 seconds, so no CLA agreement was posted: Microsoft's CLA bot has not asked for one. If it asks later, re-run this job, or comment this on ${urlOf(OPENED)} by hand from the account that opened it: ${CLA_AGREEMENT}`,
    );
    expect(result.stderr).toBe("");

    const once = publish({
      state: { bot: {} },
      env: { WINGET_CLA_WAIT_SECONDS: "0" },
    });
    expect(once.status).toBe(0);
    expect(claSteps(once)).toEqual(["Needs-CLA? false"]);
  });

  test("warns, naming the pull request and the comment to post by hand, and passes, when the label stays WINGET_CLA_CLEAR_WAIT_SECONDS after the agreement", () => {
    const state = { bot: { [OPENED]: { askAfterReads: 0, honours: false } } };
    const result = publish({
      state,
      env: { WINGET_CLA_CLEAR_WAIT_SECONDS: "40" },
    });

    expect(result.status).toBe(0);
    expect(claSteps(result)).toEqual([
      "Needs-CLA? true",
      "agree",
      "Needs-CLA? true",
      "sleep 20",
      "Needs-CLA? true",
      "sleep 20",
      "Needs-CLA? true",
    ]);
    expect(result.stderr).toBe(
      `PublishWingetManifests: warning: ${labelStayed(OPENED, 40)}\n`,
    );
    expect(result.stdout).not.toContain("::warning");

    // In a GitHub Actions job, a warning on the run as well.
    const inActions = publish({
      state,
      env: { WINGET_CLA_CLEAR_WAIT_SECONDS: "40", GITHUB_ACTIONS: "true" },
    });
    expect(inActions.status).toBe(0);
    expect(inActions.stdout).toContain(
      `\n::warning title=Needs-CLA on winget #${OPENED}::${labelStayed(OPENED, 40)}\n`,
    );
  });

  test("says the CLA is agreed once the bot takes the label off, however many reads that takes within WINGET_CLA_CLEAR_WAIT_SECONDS", () => {
    const result = publish({
      state: { bot: { [OPENED]: { askAfterReads: 0, clearAfterReads: 2 } } },
    });

    expect(result.status).toBe(0);
    expect(claSteps(result)).toEqual([
      "Needs-CLA? true",
      "agree",
      "Needs-CLA? true",
      "sleep 20",
      "Needs-CLA? true",
      "sleep 20",
      "Needs-CLA? false",
    ]);
    expect(result.stdout).toContain(
      `Microsoft's CLA bot took the Needs-CLA label off #${OPENED}: the CLA is agreed.`,
    );
    expect(result.stderr).toBe("");
  });

  test("reads the labels again at the next poll when GitHub does not answer, and never stops the job for it", () => {
    const issue = `repos/microsoft/winget-pkgs/issues/${OPENED}`;
    const result = publish({ state: { failures: { [issue]: 2 } } });

    expect(result.status).toBe(0);
    expect(claSteps(result)).toEqual([
      "Needs-CLA? failed",
      "sleep 20",
      "Needs-CLA? failed",
      "sleep 20",
      "Needs-CLA? true",
      "agree",
      "Needs-CLA? false",
    ]);
    expect(result.stderr).toContain(
      `Reading the labels of #${OPENED} failed. GitHub said: gh: Bad Gateway (HTTP 502)`,
    );

    // Never answered: nothing is posted, and the job still passes.
    const silent = publish({
      state: { failures: { [issue]: 100 } },
      env: { WINGET_CLA_WAIT_SECONDS: "40" },
    });
    expect(silent.status).toBe(0);
    expect(claSteps(silent)).toEqual([
      "Needs-CLA? failed",
      "sleep 20",
      "Needs-CLA? failed",
      "sleep 20",
      "Needs-CLA? failed",
    ]);
    expect(silent.stdout).toContain("so no CLA agreement was posted");

    // A read after the agreement that fails is no sign the bot took the
    // label off.
    const after = publish({
      state: {
        bot: { [OPENED]: { askAfterReads: 0, honours: false } },
        failures: { [issue]: [2] },
      },
      env: { WINGET_CLA_CLEAR_WAIT_SECONDS: "40" },
    });
    expect(after.status).toBe(0);
    expect(claSteps(after)).toEqual([
      "Needs-CLA? true",
      "agree",
      "Needs-CLA? failed",
      "sleep 20",
      "Needs-CLA? true",
      "sleep 20",
      "Needs-CLA? true",
    ]);
    expect(after.stdout).not.toContain("the CLA is agreed");
    expect(after.stderr).toContain(labelStayed(OPENED, 40));
  });

  test("waits 900 seconds for the label and 300 for it to go, reading every 20, unless WINGET_CLA_WAIT_SECONDS, WINGET_CLA_CLEAR_WAIT_SECONDS and WINGET_CLA_POLL_SECONDS say otherwise", () => {
    const defaults = publish();
    expect(defaults.status).toBe(0);
    expect(defaults.stdout).toContain(
      `Waiting up to 900 seconds for Microsoft's CLA bot to label #${OPENED} Needs-CLA, reading its labels every 20 seconds.`,
    );
    expect(defaults.stdout).toContain(
      `Waiting up to 300 seconds for Microsoft's CLA bot to take the Needs-CLA label off #${OPENED}.`,
    );

    // Each window ends with a sleep cut to what is left of it.
    const set = {
      WINGET_CLA_WAIT_SECONDS: "50",
      WINGET_CLA_CLEAR_WAIT_SECONDS: "25",
      WINGET_CLA_POLL_SECONDS: "15",
    };
    const asked = publish({
      state: { bot: { [OPENED]: { askAfterReads: 2, honours: false } } },
      env: set,
    });
    expect(asked.status).toBe(0);
    expect(asked.stdout).toContain(
      `Waiting up to 50 seconds for Microsoft's CLA bot to label #${OPENED} Needs-CLA, reading its labels every 15 seconds.`,
    );
    expect(claSteps(asked)).toEqual([
      "Needs-CLA? false",
      "sleep 15",
      "Needs-CLA? false",
      "sleep 15",
      "Needs-CLA? true",
      "agree",
      "Needs-CLA? true",
      "sleep 15",
      "Needs-CLA? true",
      "sleep 10",
      "Needs-CLA? true",
    ]);
    expect(asked.stderr).toContain(labelStayed(OPENED, 25));

    const never = publish({ state: { bot: {} }, env: set });
    expect(never.status).toBe(0);
    expect(claSteps(never)).toEqual([
      "Needs-CLA? false",
      "sleep 15",
      "Needs-CLA? false",
      "sleep 15",
      "Needs-CLA? false",
      "sleep 15",
      "Needs-CLA? false",
      "sleep 5",
      "Needs-CLA? false",
    ]);

    // No wait at all: one read each.
    const none = publish({
      state: { bot: { [OPENED]: { askAfterReads: 0, honours: false } } },
      env: { WINGET_CLA_WAIT_SECONDS: "0", WINGET_CLA_CLEAR_WAIT_SECONDS: "0" },
    });
    expect(none.status).toBe(0);
    expect(claSteps(none)).toEqual([
      "Needs-CLA? true",
      "agree",
      "Needs-CLA? true",
    ]);
    expect(none.stderr).toContain(labelStayed(OPENED, 0));
  });

  test.each([
    ["WINGET_CLA_WAIT_SECONDS", "15m", "a whole number of seconds: '15m'"],
    ["WINGET_CLA_WAIT_SECONDS", "-1", "a whole number of seconds: '-1'"],
    [
      "WINGET_CLA_CLEAR_WAIT_SECONDS",
      "2.5",
      "a whole number of seconds: '2.5'",
    ],
    // Bash would read it as octal: 010 seconds would be 8.
    [
      "WINGET_CLA_CLEAR_WAIT_SECONDS",
      "010",
      "a whole number of seconds: '010'",
    ],
    [
      "WINGET_CLA_POLL_SECONDS",
      "0",
      "a whole number of seconds, at least 1: '0'",
    ],
  ])(
    "refuses %s=%s before asking GitHub anything",
    (setting, value, message) => {
      const result = publish({ env: { [setting]: value } });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${setting} must be ${message}`);
      expect(result.calls).toEqual([]);
    },
  );

  test("closes the account's open pull requests for older versions, each with a comment naming this version's", () => {
    const result = publish({
      state: {
        pulls: [
          pullFor(4100, "1.2.2"),
          pullFor(4099, "1.1.10"),
          pullFor(4098, "0.9.0", { kind: "package" }),
        ],
      },
    });
    const superseded = `Superseded by #${OPENED} (OneUptime.InfrastructureAgent ${VERSION}).`;

    expect(result.status).toBe(0);
    expect(closings(result)).toEqual([
      "close #4100",
      `#4100: ${superseded}`,
      "close #4099",
      `#4099: ${superseded}`,
      "close #4098",
      `#4098: ${superseded}`,
    ]);
    expect(result.pulls.map((pull) => [pull.number, pull.state])).toEqual([
      [4100, "closed"],
      [4099, "closed"],
      [4098, "closed"],
      [OPENED, "open"],
    ]);
    expect(result.stdout).toContain(
      `Closed #4100 (OneUptime.InfrastructureAgent 1.2.2): superseded by #${OPENED}.`,
    );
    // Found by title among winget-pkgs' open pull requests.
    expect(
      result.calls.find((call) => call.endpoint === "search/issues").fields,
    ).toEqual({
      q: "repo:microsoft/winget-pkgs is:pr is:open in:title OneUptime.InfrastructureAgent",
      per_page: "100",
    });
    // The CLA after it, as ever.
    expect(result.stdout).toContain("the CLA is agreed");
    expect(result.stderr).toBe("");
  });

  test("leaves newer versions', other accounts', other packages' and closed pull requests alone", () => {
    const others = [
      pullFor(4300, "1.2.4"),
      // Newer, number by number, though not as text.
      pullFor(4301, "1.2.10"),
      pullFor(4302, "1.10.0"),
      pullFor(4303, "1.2.2", { owner: "someone-else" }),
      pullFor(4304, "1.2.2", {
        packageId: "OneUptime.InfrastructureAgentBeta",
      }),
      pullFor(4305, "1.2.2", { packageId: "Contoso.Agent" }),
      pullFor(4306, "1.2.1", { state: "closed" }),
    ];
    const result = publish({
      state: { pulls: [...others, pullFor(4307, "1.2.2")] },
    });

    expect(result.status).toBe(0);
    expect(closings(result)).toEqual([
      "close #4307",
      `#4307: Superseded by #${OPENED} (OneUptime.InfrastructureAgent ${VERSION}).`,
    ]);
    expect(
      others.map((pull) => {
        return pullIn(result, pull.number);
      }),
    ).toEqual(others);
    expect(result.stdout).toContain(
      "Leaving #4300 (OneUptime.InfrastructureAgent 1.2.4) open: it is not older than 1.2.3.",
    );
    expect(result.stdout).toContain(
      "Leaving #4301 (OneUptime.InfrastructureAgent 1.2.10) open: it is not older than 1.2.3.",
    );
    expect(result.stdout).toContain(
      "Leaving #4303 (OneUptime.InfrastructureAgent 1.2.2) open: it is not from oneuptime-bot's fork.",
    );
  });

  test("on a re-run, closes the older ones as superseded by this version's pull request, open already; a re-run of an older release closes nothing newer", () => {
    const result = publish({
      state: rerunState({
        pulls: [pullFor(4000, "1.2.2"), pullFor(4300, "1.2.4")],
      }),
    });

    expect(result.status).toBe(0);
    expect(pullRequestOf(result)).toBeUndefined();
    expect(closings(result)).toEqual([
      "close #4000",
      `#4000: Superseded by #${WAITING} (OneUptime.InfrastructureAgent ${VERSION}).`,
    ]);
    expect(pullIn(result, WAITING).state).toBe("open");
    expect(pullIn(result, 4300).state).toBe("open");

    // 1.2.2's run again, with 1.2.3's pull request open.
    const older = publish({
      version: "1.2.2",
      state: {
        pulls: [pullFor(4000, "1.2.2"), pullFor(WAITING, "1.2.3")],
      },
    });
    expect(older.status).toBe(0);
    expect(older.stdout).toContain(`already waiting in ${urlOf(4000)}`);
    expect(closings(older)).toEqual([]);
    expect(older.pulls.map((pull) => pull.state)).toEqual(["open", "open"]);
    expect(older.stdout).toContain(
      `Leaving #${WAITING} (OneUptime.InfrastructureAgent 1.2.3) open: it is not older than 1.2.2.`,
    );
  });

  test("warns, naming the pull request, when one is not closed or not commented on, asks once more first, and still passes", () => {
    const result = publish({
      state: {
        pulls: [
          pullFor(4100, "1.2.2"),
          pullFor(4101, "1.2.1"),
          pullFor(4102, "1.2.0"),
          pullFor(4103, "1.1.0"),
        ],
        failures: {
          // Twice: not closed. Once: closed when asked again.
          "repos/microsoft/winget-pkgs/pulls/4100": 2,
          "repos/microsoft/winget-pkgs/pulls/4101": 1,
          "repos/microsoft/winget-pkgs/issues/4102/comments": 2,
          "repos/microsoft/winget-pkgs/pulls?state=open&head=oneuptime-bot:OneUptime.InfrastructureAgent-1.1.0": 2,
        },
      },
    });
    const superseded = `Superseded by #${OPENED} (OneUptime.InfrastructureAgent ${VERSION}).`;

    expect(result.status).toBe(0);
    expect(closings(result)).toEqual([
      "close #4100 (failed)",
      "close #4100 (failed)",
      "close #4101 (failed)",
      "close #4101",
      `#4101: ${superseded}`,
      "close #4102",
      `#4102: ${superseded} (failed)`,
      `#4102: ${superseded} (failed)`,
    ]);
    expect(result.pulls.map((pull) => [pull.number, pull.state])).toEqual([
      [4100, "open"],
      [4101, "closed"],
      [4102, "closed"],
      [4103, "open"],
      [OPENED, "open"],
    ]);
    const warnings = result.stderr
      .split("\n")
      .filter((line) => line.startsWith("PublishWingetManifests: warning: "));
    expect(warnings).toEqual([
      `PublishWingetManifests: warning: Could not close #4100 (OneUptime.InfrastructureAgent 1.2.2), superseded by #${OPENED}: close it by hand. GitHub said: gh: Bad Gateway (HTTP 502)`,
      `PublishWingetManifests: warning: Closed #4102 (OneUptime.InfrastructureAgent 1.2.0) as superseded by #${OPENED}, but could not comment that on it. GitHub said: gh: Bad Gateway (HTTP 502)`,
      `PublishWingetManifests: warning: Could not check whether #4103 (OneUptime.InfrastructureAgent 1.1.0) is from oneuptime-bot's fork, so it was not closed as superseded by #${OPENED}. GitHub said: gh: Bad Gateway (HTTP 502)`,
    ]);
    // The CLA after it, as ever.
    expect(result.stdout).toContain("the CLA is agreed");
  });

  test("warns, and still passes, when GitHub will not list the open pull requests; in a GitHub Actions job, on the run as well", () => {
    const result = publish({
      state: {
        pulls: [pullFor(4100, "1.2.2")],
        failures: { "search/issues": 2 },
        failureText: "gh: Bad Gateway (HTTP 502)\n100% of searches failed",
      },
      env: { GITHUB_ACTIONS: "true" },
    });
    const warning = `Could not list the open pull requests for OneUptime.InfrastructureAgent, so none was closed as superseded by #${OPENED}. GitHub said: gh: Bad Gateway (HTTP 502)`;

    expect(result.status).toBe(0);
    expect(closings(result)).toEqual([]);
    expect(pullIn(result, 4100).state).toBe("open");
    expect(
      result.calls.filter((call) => call.endpoint === "search/issues"),
    ).toHaveLength(2);
    expect(result.stderr).toContain(
      `PublishWingetManifests: warning: ${warning}\n100% of searches failed\n`,
    );
    // A workflow command is one line.
    expect(result.stdout).toContain(
      `\n::warning title=Older winget pull requests not closed::${warning}%0A100%25 of searches failed\n`,
    );
  });

  test("closes nothing when no other pull request for an older version is open", () => {
    const result = publish();

    expect(result.status).toBe(0);
    expect(closings(result)).toEqual([]);
    expect(result.stdout).toContain(
      "No other open pull request is for an older version of OneUptime.InfrastructureAgent: none to close.",
    );

    // Nor for a version that is not whole numbers: nothing compares with it.
    const odd = publish({
      version: "1.2.3-rc.1",
      state: { pulls: [pullFor(4100, "1.2.2")] },
    });
    expect(odd.status).toBe(0);
    expect(closings(odd)).toEqual([]);
    expect(pullIn(odd, 4100).state).toBe("open");
    expect(odd.stdout).toContain(
      "Closing no older pull requests: 1.2.3-rc.1 is not whole numbers joined by dots, so no version can be compared with it.",
    );
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
      state: {
        forks: { "OneUptime/winget-pkgs": "microsoft/winget-pkgs" },
        pulls: [
          pullFor(4100, "1.2.2", { owner: "OneUptime" }),
          pullFor(4101, "1.2.2", { owner: "oneuptime-bot" }),
        ],
      },
    });

    expect(result.status).toBe(0);
    expect(result.calls.some((call) => call.endpoint === "user")).toBe(false);
    expect(pullRequestOf(result).fields.head).toBe(`OneUptime:${BRANCH}`);
    // Its pull requests are the ones it supersedes.
    expect(closings(result)).toEqual([
      "close #4100",
      `#4100: Superseded by #${OPENED} (OneUptime.InfrastructureAgent ${VERSION}).`,
    ]);
  });

  test("stops, writing nothing, without a fork of winget-pkgs", () => {
    const missing = publish({ state: { forks: {} } });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain(
      "fork microsoft/winget-pkgs into oneuptime-bot first",
    );
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
    const wrong = publish({
      version: "1.2.4",
      manifests: writeManifests("1.2.3"),
    });
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain("is not for version 1.2.4");
    expect(wrong.calls).toEqual([]);

    const tokenless = publish({ token: "" });
    expect(tokenless.status).not.toBe(0);
    expect(tokenless.stderr).toContain("WINGET_GITHUB_TOKEN is required");
    expect(tokenless.calls).toEqual([]);
  });
});

describe("how this suite starts processes", () => {
  test("a step's script runs as release.yml runs it, under bash -e: a failing command ends it", () => {
    const failing = runStepScript('false\necho "after a failure"');

    expect(failing.status).not.toBe(0);
    expect(failing.stdout).toBe("");
    expect(runStepScript('echo "a step"').stdout).toBe("a step\n");
  });

  test("a path handed to a program is an argument, never part of a command line", () => {
    const work = fs.mkdtempSync(
      path.join(os.tmpdir(), "package-managers-run-"),
    );
    try {
      const script = path.join(work, "a step; touch ran-as-a-command.sh");
      fs.writeFileSync(script, 'echo "read as a script"\n');

      const result = run("bash", [script], { cwd: work });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("read as a script\n");
      expect(fs.readdirSync(work)).toEqual([path.basename(script)]);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  test("shellcheck is looked for without a shell, and found where it is installed", () => {
    const installed = spawnSync("shellcheck", ["--version"]);

    expect(hasShellcheck()).toBe(!installed.error && installed.status === 0);
  });
});
