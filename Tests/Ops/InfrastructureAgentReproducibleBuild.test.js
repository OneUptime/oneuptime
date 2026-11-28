/*
 * The infrastructure agent's GoReleaser build makes the same files every
 * time it builds the same commit (#11466): every archive, package, SBOM and
 * the checksums file that lists them.
 *
 * The apt and yum indexes, the Homebrew cask and the winget manifest record
 * the SHA-256 of what they point to, as the Terraform and OpenTofu registries
 * did of the provider's zips. A second release run of a provider version
 * built its zips again, and GoReleaser stamped each file in them with when it
 * was built, so `terraform init` failed for 14.3.0 to 17.2.0 (#11016). The
 * agent's config had the same gap, and more: the build's time in each binary
 * (the default ldflags' main.date, which the linker hashes into the build
 * ID even with no such variable), each archived file, each package and each
 * SBOM; the checkout's path in each binary; the builder's user and umask in
 * each archive; and syft's random serial number in each SBOM.
 *
 * The build below needs goreleaser, go, syft, git and python3, as the
 * Infrastructure Agent Test workflow's reproducible-build job installs them
 * (.github/actions/setup-release-toolchain, the release's own). Without them
 * it is skipped, saying so; with RUN_AGENT_REPRODUCIBLE_BUILD=1, as that job
 * runs it, it fails instead.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "InfrastructureAgent");
const CONFIG_FILE = path.join(AGENT_DIR, ".goreleaser.yaml");
const SBOM_SCRIPT = path.join(AGENT_DIR, "sbom.sh");
const TAG = "1.2.3";

const configText = fs.readFileSync(CONFIG_FILE, "utf8");
const config = yaml.load(configText);

const scratchDirs = [];
afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function scratch(prefix = "agent-reproducible-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/* ------------------------------------------------------------- the config */

describe("the agent's .goreleaser.yaml", () => {
  const build = config.builds[0];
  const archive = config.archives[0];

  test("names the project, so the checksums file and the build directories are named the same from any clone", () => {
    // build-msi.sh reads ./dist/oneuptime_windows_<arch>_*/.
    expect(config.project_name).toBe("oneuptime");
    expect(
      fs.readFileSync(path.join(AGENT_DIR, "build-msi.sh"), "utf8"),
    ).toContain(
      "./dist/oneuptime_windows_amd64_v1/oneuptime-infrastructure-agent.exe",
    );
  });

  test("stamps each binary with the commit's time, and builds it with no path of the machine", () => {
    expect(build.mod_timestamp).toBe("{{ .CommitTimestamp }}");
    expect(build.flags).toContain("-trimpath");
  });

  test("gives the linker the commit's date, never the build's", () => {
    expect(build.ldflags).toEqual([
      "-s -w -X main.version={{ .Version }} -X main.commit={{ .Commit }} -X main.date={{ .CommitDate }} -X main.builtBy=goreleaser",
    ]);
  });

  /*
   * The modes as written: GoReleaser reads `mode: 0755` as octal, as Go's
   * YAML does (the archives built below hold -rwxr-xr-x and -rw-r--r--),
   * where js-yaml, reading YAML 1.2, has the decimal 755.
   */
  test("archives each file as root's, with a fixed mode and the commit's time", () => {
    expect(configText).toContain(
      '    builds_info:\n      owner: root\n      group: root\n      mode: 0755\n      mtime: "{{ .CommitDate }}"\n',
    );
    for (const src of ["LICENSE", "README.md"]) {
      expect(configText).toContain(
        `      - src: ${src}\n        info:\n          owner: root\n          group: root\n          mode: 0644\n          mtime: "{{ .CommitDate }}"\n`,
      );
      expect(fs.existsSync(path.join(AGENT_DIR, src))).toBe(true);
    }
    // Those two and nothing else: without `files`, GoReleaser adds every
    // README*, LICENSE* and CHANGELOG* it finds, with their times on disk.
    expect(
      archive.files.map((file) => {
        return file.src;
      }),
    ).toEqual(["LICENSE", "README.md"]);
    expect(archive.builds_info).toMatchObject({
      owner: "root",
      group: "root",
      mtime: "{{ .CommitDate }}",
    });
  });

  test("stamps each package with the commit's time", () => {
    expect(config.nfpms).toHaveLength(1);
    expect(config.nfpms[0].mtime).toBe("{{ .CommitDate }}");
  });

  test("makes each SBOM through sbom.sh, with the commit's time", () => {
    expect(
      config.sboms.map((sbom) => {
        return sbom.id;
      }),
    ).toEqual(["archives", "binaries"]);
    for (const sbom of config.sboms) {
      expect(sbom).toMatchObject({
        cmd: "../sbom.sh",
        env: ["SBOM_TIMESTAMP={{ .CommitDate }}"],
        args: ["$artifact", "$document"],
        disable: false,
      });
    }
  });

  test("puts no build time anywhere: no .Date, .Now or .Timestamp", () => {
    expect(configText).not.toMatch(/\{\{\s*\.(Date|Now|Timestamp)\b/);
  });

  test("sbom.sh is executable, as GoReleaser runs it", () => {
    expect(fs.statSync(SBOM_SCRIPT).mode & 0o111).toBe(0o111);
    const tracked = spawnSync(
      "git",
      ["ls-files", "-s", "agents/InfrastructureAgent/sbom.sh"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );
    expect(tracked.stdout).toMatch(/^100755 /);
  });
});

/* ----------------------------------------------------------------- sbom.sh */

/*
 * A stand-in syft: the CycloneDX document syft writes, on one line, with a
 * random serial number and the time it ran, as syft does, and the artifact's
 * SHA-256 so another artifact makes another document.
 */
const FAKE_SYFT = `#!/usr/bin/env python3
import hashlib, sys, uuid, datetime
artifact, output = sys.argv[1], sys.argv[3]
assert sys.argv[2] == "--output" and output.startswith("cyclonedx-json="), sys.argv
digest = hashlib.sha256(open(artifact, "rb").read()).hexdigest()
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
open(output[len("cyclonedx-json="):], "w").write(
    '{"$schema":"http://cyclonedx.org/schema/bom-1.7.schema.json","bomFormat":"CycloneDX","specVersion":"1.7",'
    '"serialNumber":"' + uuid.uuid4().urn + '","version":1,'
    '"metadata":{"timestamp":"' + now + '","tools":{"components":[{"type":"application","author":"anchore","name":"syft","version":"1.57.2"}]},'
    '"component":{"bom-ref":"x","type":"file","name":"agent \\\\u003cbinary\\\\u003e"}},'
    '"components":[{"type":"library","name":"golang.org/x/sys","version":"v0.44.0","hashes":[{"alg":"SHA-256","content":"' + digest + '"}]}]}\\n'
)
`;

function sbomTools() {
  const bin = path.join(scratch("agent-sbom-"), "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "syft"), FAKE_SYFT, { mode: 0o755 });
  return bin;
}

function runSbom(args, { env = {}, bin = sbomTools(), cwd } = {}) {
  return spawnSync("bash", [SBOM_SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, ...env },
  });
}

describe("sbom.sh: syft's SBOM, the same bytes for the same file", () => {
  const TIMESTAMP = "2026-11-28T09:54:12Z";

  function sbomOf(artifactText, dir = scratch("agent-sbom-")) {
    const artifact = path.join(
      dir,
      "oneuptime-infrastructure-agent_linux_amd64.tar.gz",
    );
    fs.writeFileSync(artifact, artifactText);
    const document = path.join(dir, `${path.basename(artifact)}.cdx.json`);
    const result = runSbom([artifact, document], {
      env: { SBOM_TIMESTAMP: TIMESTAMP },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    return fs.readFileSync(document, "utf8");
  }

  test("twice for one file is the same document, though syft wrote two", () => {
    const first = sbomOf("the same archive");
    const second = sbomOf("the same archive");
    expect(second).toBe(first);
  });

  test("with the commit's time, and a serial number of everything else in it", () => {
    const text = sbomOf("an archive");
    const document = JSON.parse(text);
    expect(document.metadata.timestamp).toBe(TIMESTAMP);
    // urn:uuid of version 5: a name-based UUID, not a random one.
    expect(document.serialNumber).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("another file is another document, with another serial number", () => {
    const one = JSON.parse(sbomOf("one archive"));
    const other = JSON.parse(sbomOf("another archive"));
    expect(other.serialNumber).not.toBe(one.serialNumber);
    expect(other.components[0].hashes[0].content).toBe(
      sha256(Buffer.from("another archive")),
    );
  });

  test("keeps every other byte syft wrote: its order, its escapes, its one line", () => {
    const text = sbomOf("an archive");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain('"name":"agent \\u003cbinary\\u003e"');
    expect(text.indexOf('"serialNumber"')).toBeLessThan(
      text.indexOf('"metadata"'),
    );
    expect(text).toMatch(
      /^\{"\$schema":"http:\/\/cyclonedx\.org\/schema\/bom-1\.7\.schema\.json","bomFormat":"CycloneDX","specVersion":"1\.7","serialNumber":"urn:uuid:/,
    );
  });

  test.each([
    [[], { SBOM_TIMESTAMP: TIMESTAMP }],
    [["one"], { SBOM_TIMESTAMP: TIMESTAMP }],
    [["one", "two"], {}],
  ])("refuses to run as %j with %j", (args, env) => {
    const result = runSbom(args, { env });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "Usage: SBOM_TIMESTAMP=<RFC 3339 time> sbom.sh <artifact> <document>",
    );
  });

  test("fails when syft fails, and on a document that is not the one syft writes", () => {
    const dir = scratch("agent-sbom-");
    const artifact = path.join(dir, "agent");
    fs.writeFileSync(artifact, "binary");

    const failing = path.join(dir, "failing-bin");
    fs.mkdirSync(failing);
    fs.writeFileSync(
      path.join(failing, "syft"),
      "#!/bin/sh\necho 'syft: no catalogers' >&2\nexit 3\n",
      { mode: 0o755 },
    );
    const failed = runSbom([artifact, path.join(dir, "a.cdx.json")], {
      env: { SBOM_TIMESTAMP: TIMESTAMP },
      bin: failing,
    });
    expect(failed.status).toBe(3);

    const other = path.join(dir, "other-bin");
    fs.mkdirSync(other);
    fs.writeFileSync(
      path.join(other, "syft"),
      `#!/bin/sh\nprintf '%s\\n' '{"bomFormat":"CycloneDX","metadata":{"timestamp":"now"}}' > "\${3#cyclonedx-json=}"\n`,
      { mode: 0o755 },
    );
    const refused = runSbom([artifact, path.join(dir, "b.cdx.json")], {
      env: { SBOM_TIMESTAMP: TIMESTAMP },
      bin: other,
    });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(
      "is not the CycloneDX document syft writes",
    );
  });
});

/* --------------------------------------------------- what the release takes */

describe("what the release attaches from dist/", () => {
  const release = yaml.load(
    fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "release.yml"),
      "utf8",
    ),
  );
  const collect = release.jobs["infrastructure-agent-build"].steps.find(
    (step) => {
      return step.name === "Collect the files the release attaches";
    },
  );

  test("is the agent's files and the checksums file, and none of GoReleaser's own", () => {
    const work = scratch("agent-collect-");
    const dist = path.join(work, "agents", "InfrastructureAgent", "dist");
    fs.mkdirSync(path.join(dist, "oneuptime_linux_amd64_v1"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(dist, "homebrew", "Casks"), { recursive: true });
    const agentFiles = [
      "oneuptime-infrastructure-agent_linux_amd64.tar.gz",
      "oneuptime-infrastructure-agent_linux_amd64.tar.gz.cdx.json",
      "oneuptime-infrastructure-agent_linux_amd64.cdx.json",
      "oneuptime-infrastructure-agent_windows_amd64.zip",
      "oneuptime-infrastructure-agent_amd64.deb",
      "oneuptime-infrastructure-agent_amd64.rpm",
      "oneuptime-infrastructure-agent_amd64.apk",
      "oneuptime-infrastructure-agent_amd64.archlinux.pkg.tar.zst",
      "oneuptime-infrastructure-agent-amd64.msi",
      "oneuptime-infrastructure-agent-amd64.msi.cdx.json",
      `oneuptime_${TAG}_checksums.txt`,
    ];
    for (const file of [
      ...agentFiles,
      "artifacts.json",
      "metadata.json",
      "config.yaml",
      ".hidden",
      "oneuptime_linux_amd64_v1/oneuptime-infrastructure-agent",
      "homebrew/Casks/oneuptime-infrastructure-agent.rb",
    ]) {
      fs.writeFileSync(path.join(dist, file), file);
    }
    const runnerTemp = path.join(work, "runner-temp");
    fs.mkdirSync(runnerTemp);

    const result = spawnSync("bash", ["-e", "-c", collect.run], {
      cwd: work,
      encoding: "utf8",
      env: { PATH: process.env.PATH, RUNNER_TEMP: runnerTemp },
    });

    expect(result.status).toBe(0);
    expect(
      fs
        .readdirSync(path.join(runnerTemp, "release-infrastructure-agent"))
        .sort(),
    ).toEqual([...agentFiles].sort());
  });
});

/* ------------------------------------------------ built twice, for real */

function run(command, args, cwd, env = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      ...env,
    },
  });
}

function runOrThrow(command, args, cwd, env = {}) {
  const result = run(command, args, cwd, env);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function missingTools() {
  return ["goreleaser", "go", "syft", "git", "python3"].filter((tool) => {
    const probe = {
      go: ["version"],
      syft: ["version"],
    }[tool] || ["--version"];
    return run(tool, probe, os.tmpdir()).error;
  });
}

/*
 * The config for linux/amd64 and windows/amd64 only: a tar.gz, a zip and the
 * four packages, which take what makes a file the same twice from the same
 * settings as every other target, and build in a minute.
 */
function forTwoTargets(goreleaserConfig) {
  const narrowed = goreleaserConfig.replace(
    /^ {4}goos:\n(?: {6}- .*\n)+ {4}goarch:\n(?: {6}- .*\n)+ {4}goarm:\n(?: {6}- .*\n)+/m,
    "    goos:\n      - linux\n      - windows\n    goarch:\n      - amd64\n",
  );
  if (narrowed === goreleaserConfig) {
    throw new Error("Could not narrow .goreleaser.yaml to two targets");
  }
  return narrowed;
}

/*
 * The config as it was before #11466: the project named after the clone, no
 * mod_timestamp, no -trimpath, GoReleaser's own ldflags, no builds_info or
 * files, no package mtime, and syft run straight.
 */
function asBefore(goreleaserConfig) {
  const before = goreleaserConfig
    // Its comments say what each setting does: they go, with the settings.
    .replace(/^[ \t]*#.*\n/gm, "")
    .replace(/^project_name: .*\n/m, "")
    .replace(/^ {4}mtime: "\{\{ \.CommitDate \}\}"\n/m, "")
    .replace(/^ {4}mod_timestamp: .*\n/m, "")
    .replace(/^ {4}flags:\n {6}- -trimpath\n/m, "")
    .replace(/^ {4}ldflags:\n {6}- .*\n/m, "")
    .replace(/^ {4}builds_info:\n(?: {6}.*\n)+/m, "")
    .replace(/^ {4}files:\n(?: {6}.*\n| {8}.*\n| {10}.*\n)+/m, "")
    .replace(
      /^ {4}cmd: \.\.\/sbom\.sh\n {4}env:\n {6}- SBOM_TIMESTAMP=.*\n/gm,
      "",
    )
    .replace(
      /args: \["\$artifact", "\$document"\]/g,
      'args: ["$artifact", "--output", "cyclonedx-json=$document"]',
    );
  for (const setting of [
    "project_name",
    "mod_timestamp",
    "-trimpath",
    "ldflags",
    "builds_info",
    "- src:",
    "sbom.sh",
    "{{ .CommitDate }}",
  ]) {
    if (before.includes(setting)) {
      throw new Error(`Could not take ${setting} out of .goreleaser.yaml`);
    }
  }
  return before;
}

// The files release.yml attaches from dist/ (the collect step above).
function attachedFiles(dist) {
  return fs
    .readdirSync(dist)
    .filter((file) => {
      return (
        fs.statSync(path.join(dist, file)).isFile() &&
        (file.startsWith("oneuptime-infrastructure-agent") ||
          /^[a-z0-9-]+_.+_checksums\.txt$/.test(file))
      );
    })
    .sort();
}

/*
 * Builds TAG of the agent with this config twice, each from a clone of its
 * own made a few seconds after the other, as a second release run on a fresh
 * runner does. Returns each build's attached files, name to SHA-256, and
 * each build's dist/ and commit time.
 */
function buildTwice(goreleaserConfig) {
  const work = scratch("agent-double-build-");
  const origin = path.join(work, "origin");
  fs.cpSync(AGENT_DIR, origin, {
    recursive: true,
    filter: (source) => {
      return !source.includes(`${path.sep}dist`);
    },
  });
  fs.writeFileSync(path.join(origin, ".goreleaser.yaml"), goreleaserConfig);
  runOrThrow("git", ["init", "-q", "-b", "master"], origin);
  runOrThrow("git", ["add", "-A"], origin);
  runOrThrow("git", ["commit", "-q", "-m", "agent"], origin);
  runOrThrow("git", ["tag", "-a", TAG, "-m", `Release ${TAG}`], origin);

  const commitTime = runOrThrow(
    "git",
    ["log", "-1", "--format=%cI"],
    origin,
  ).trim();
  const dists = [];
  const builds = ["a", "b"].map((name, index) => {
    if (index > 0) {
      // A later checkout: its files' times on disk are later too.
      spawnSync("sleep", ["2"]);
    }
    const clone = path.join(work, name);
    runOrThrow("git", ["clone", "-q", origin, clone], work);
    runOrThrow("git", ["checkout", "-q", TAG], clone);
    runOrThrow(
      "goreleaser",
      ["release", "--clean", "--snapshot", "--parallelism", "1"],
      clone,
      { GORELEASER_CURRENT_TAG: TAG, GOFLAGS: "-modcacherw" },
    );
    const dist = path.join(clone, "dist");
    dists.push(dist);
    return new Map(
      attachedFiles(dist).map((file) => {
        return [file, sha256(fs.readFileSync(path.join(dist, file)))];
      }),
    );
  });
  return Object.assign(builds, { dists, commitTime });
}

describe("the agent built twice from the same commit", () => {
  const missing = missingTools();
  const required = process.env["RUN_AGENT_REPRODUCIBLE_BUILD"] === "1";
  const canBuild = missing.length === 0;
  const buildTest = canBuild || required ? test : test.skip;

  if (!canBuild) {
    // eslint-disable-next-line no-console
    console.warn(
      `InfrastructureAgentReproducibleBuild: ${missing.join(", ")} not on PATH, so the agent is not built twice here${
        required ? " (and with RUN_AGENT_REPRODUCIBLE_BUILD=1 that fails)" : ""
      }.`,
    );
  }

  buildTest(
    "is the same archives, packages, SBOMs and checksums file",
    () => {
      expect(missing).toEqual([]);
      const builds = buildTwice(forTwoTargets(configText));
      const [first, second] = builds;

      expect([...first.keys()]).toEqual([
        "oneuptime-infrastructure-agent_amd64.apk",
        "oneuptime-infrastructure-agent_amd64.archlinux.pkg.tar.zst",
        "oneuptime-infrastructure-agent_amd64.deb",
        "oneuptime-infrastructure-agent_amd64.rpm",
        "oneuptime-infrastructure-agent_linux_amd64.cdx.json",
        "oneuptime-infrastructure-agent_linux_amd64.tar.gz",
        "oneuptime-infrastructure-agent_linux_amd64.tar.gz.cdx.json",
        "oneuptime-infrastructure-agent_windows_amd64.cdx.json",
        "oneuptime-infrastructure-agent_windows_amd64.zip",
        "oneuptime-infrastructure-agent_windows_amd64.zip.cdx.json",
        `oneuptime_${TAG}_checksums.txt`,
      ]);
      expect(second).toEqual(first);

      // What is in an archive: root's files, with fixed modes and the
      // commit's time, never the builder's or the checkout's.
      const listing = runOrThrow(
        "tar",
        [
          "--list",
          "--verbose",
          "--numeric-owner",
          "--full-time",
          "--gzip",
          "--file",
          path.join(
            builds.dists[0],
            "oneuptime-infrastructure-agent_linux_amd64.tar.gz",
          ),
        ],
        os.tmpdir(),
        { TZ: "UTC" },
      );
      const commitTime = new Date(builds.commitTime)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, "");
      const entries = listing
        .trim()
        .split("\n")
        .map((line) => {
          const [mode, owner, , day, time, name] = line.trim().split(/\s+/);
          return { mode, owner, time: `${day} ${time}`, name };
        });
      expect(entries).toEqual([
        { mode: "-rw-r--r--", owner: "0/0", time: commitTime, name: "LICENSE" },
        {
          mode: "-rw-r--r--",
          owner: "0/0",
          time: commitTime,
          name: "README.md",
        },
        {
          mode: "-rwxr-xr-x",
          owner: "0/0",
          time: commitTime,
          name: "oneuptime-infrastructure-agent",
        },
      ]);
    },
    900000,
  );

  buildTest(
    "was other archives, packages, SBOMs and checksums, with the config as it was before #11466",
    () => {
      expect(missing).toEqual([]);
      const [first, second] = buildTwice(asBefore(forTwoTargets(configText)));

      const differ = [...first.keys()].filter((file) => {
        return second.get(file) !== first.get(file);
      });
      // Every one of them: not one file of the release was the same twice.
      expect(differ).toEqual([...first.keys()]);
      expect(differ).toEqual(
        expect.arrayContaining([
          "oneuptime-infrastructure-agent_linux_amd64.tar.gz",
          "oneuptime-infrastructure-agent_windows_amd64.zip",
          "oneuptime-infrastructure-agent_amd64.deb",
          "oneuptime-infrastructure-agent_amd64.rpm",
        ]),
      );
    },
    900000,
  );
});
