"use strict";

/**
 * The OpenStack agent without Docker: `install.sh --without-docker`, which runs
 * the collector and exporter releases the agent pins as systemd services. Checked
 * here without root, a cloud or systemd: the script runs for real with `id`,
 * `uname`, `useradd`, `chown`, `systemctl` and `curl` replaced by recording stubs,
 * and its files moved under a scratch directory.
 *
 *  - each release archive is held to a sha256 kept in the script, and a download
 *    that does not match stops the install before anything changes. The stubs'
 *    archives are not the real ones, so the tests that need one to pass run a copy
 *    of the script with its checksums replaced by theirs: the script has no way to
 *    be told another checksum;
 *  - the versions are the ones docker-compose.yml pins;
 *  - clouds.yaml belongs to a system user only the exporter runs as, and .env is
 *    quoted for systemd, which reads it by rules of its own;
 *  - a re-run is the upgrade, without the flag, and keeps every answer;
 *  - the README's uninstall removes what the install added, and nothing else;
 *  - the units: the files they run, the defaults and flags docker-compose.yml
 *    gives, the sandbox, and `systemd-analyze verify` where systemd is installed
 *    (CI must run it).
 *
 * What only a real machine can show (the release URLs, the archives' layout, systemd
 * running these units) is not shown here: Tests/Ops/vmware-agent-native-install.sh
 * does that for the VMware agent.
 *
 * troubleshoot.sh on such an install is in OpenStackAgentTroubleshoot.test.js.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");
const { loadInstallScriptsCatalog } = require("./Utils/InstallScriptsCatalog");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "OpenStackAgent");
const SCRIPT = path.join(AGENT_DIR, "install.sh");

const URL = "https://oneuptime.example.com";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
const AUTH_URL = "https://keystone.example.com:5000/v3";
const APP_ID = "4c2f7bd8a1e94f6b8d3c0e5a7f1b2c3d";
const APP_SECRET = `s3cr$t'x"y\\ #: {z}`;

const COLLECTOR_RELEASES =
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download";
const EXPORTER_RELEASES =
  "https://github.com/openstack-exporter/openstack-exporter/releases/download";
const DEFAULT_INSTALL_DIR = "/opt/oneuptime-openstack-agent";
const COLLECTOR_SERVICE = "oneuptime-openstack-agent";
const EXPORTER_SERVICE = "oneuptime-openstack-exporter";
const COLLECTOR_UNIT = "systemd/oneuptime-openstack-agent-native.service";
const EXPORTER_UNIT = "systemd/oneuptime-openstack-exporter-native.service";

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-native-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function agentFile(name) {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

const COMPOSE = yaml.load(agentFile("docker-compose.yml"));
const COLLECTOR_PIN =
  COMPOSE.services["oneuptime-openstack-agent"].image.split(":")[1];
const EXPORTER_PIN = COMPOSE.services["openstack-exporter"].image
  .split("@")[0]
  .split(":")[1];

/*
 * A fake release archive, laid out as the real one is (the binary, a LICENSE and a
 * README beside it, as `gh release download | tar -t` shows), the binary saying which
 * build it is.
 */
function writeRelease(releaseDir, archive, binary, build) {
  const work = fs.mkdtempSync(path.join(releaseDir, "build-"));
  writeExecutable(
    path.join(work, binary),
    `#!/bin/sh\necho "fake ${binary} ${build}"\n`,
  );
  fs.writeFileSync(path.join(work, "LICENSE"), "license\n");
  fs.writeFileSync(path.join(work, "README.md"), "# readme\n");
  const tar = spawnSync(
    "tar",
    [
      "-czf",
      path.join(releaseDir, archive),
      "-C",
      work,
      "LICENSE",
      "README.md",
      binary,
    ],
    { encoding: "utf8" },
  );
  expect(tar.status).toBe(0);
}

function collectorArchive(arch) {
  return `otelcol-contrib_${COLLECTOR_PIN}_linux_${arch}.tar.gz`;
}

function exporterArchive(arch) {
  return `openstack-exporter_${EXPORTER_PIN}_linux_${arch}.tar.gz`;
}

/*
 * `id` says root, and that the exporter's user exists once `useradd` has made it.
 * `uname` says Linux and $FAKE_ARCH. `useradd`, `chown` and `systemctl` record their
 * calls. `docker` records any call. `curl` answers as OneUptime and Keystone do, and
 * serves the release archives from $RELEASE_DIR.
 */
function setup({ arch = "x86_64", uid = "0", kernel = "Linux" } = {}) {
  const dir = scratch();
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const releases = path.join(dir, "releases");
  fs.mkdirSync(releases);
  const units = path.join(dir, "units");
  fs.mkdirSync(units);
  writeRelease(
    releases,
    collectorArchive("amd64"),
    "otelcol-contrib",
    "amd64-1",
  );
  writeRelease(
    releases,
    collectorArchive("arm64"),
    "otelcol-contrib",
    "arm64-1",
  );
  writeRelease(
    releases,
    exporterArchive("amd64"),
    "openstack-exporter",
    "amd64-1",
  );
  writeRelease(
    releases,
    exporterArchive("arm64"),
    "openstack-exporter",
    "arm64-1",
  );

  writeExecutable(
    path.join(bin, "id"),
    `#!/usr/bin/env bash
case "$1" in
  -u|-g) echo "${uid}" ;;
  *) [ -f "$STUB_DIR/useradd.log" ] || exit 1 ;;
esac
`,
  );
  writeExecutable(
    path.join(bin, "uname"),
    `#!/usr/bin/env bash
case "$1" in
  -s) echo "${kernel}" ;;
  -m) echo "${arch}" ;;
esac
`,
  );
  for (const tool of ["useradd", "chown", "systemctl", "docker"]) {
    writeExecutable(
      path.join(bin, tool),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/${tool}.log"\n`,
    );
  }
  writeExecutable(
    path.join(bin, "curl"),
    agentFilesCurlStub({
      installName: "openstack-agent",
      agentDirectory: "OpenStackAgent",
      servedDir: AGENT_DIR,
      extraCases: `case "$url" in
  */auth/tokens)
    cat >> "$STUB_DIR/keystone-stdin.log"
    printf '\\n' >> "$STUB_DIR/keystone-stdin.log"
    printf '{"token":{}}\\n201'
    exit 0
    ;;
  ${COLLECTOR_RELEASES}/* | ${EXPORTER_RELEASES}/*)
    src="$RELEASE_DIR/\${url##*/}"
    [ -f "$src" ] || exit 22
    cp "$src" "$out"
    exit 0
    ;;
esac`,
    }),
  );

  /*
   * The script with its checksums replaced by those of this machine's fake archives,
   * so a download passes. The script itself takes no other checksum from anywhere.
   */
  function scriptWithFakePins() {
    const script = fs
      .readFileSync(SCRIPT, "utf8")
      .replace(
        /^COLLECTOR_SHA256_AMD64=.*$/m,
        `COLLECTOR_SHA256_AMD64="${sha256(path.join(releases, collectorArchive("amd64")))}"`,
      )
      .replace(
        /^COLLECTOR_SHA256_ARM64=.*$/m,
        `COLLECTOR_SHA256_ARM64="${sha256(path.join(releases, collectorArchive("arm64")))}"`,
      )
      .replace(
        /^EXPORTER_SHA256_AMD64=.*$/m,
        `EXPORTER_SHA256_AMD64="${sha256(path.join(releases, exporterArchive("amd64")))}"`,
      )
      .replace(
        /^EXPORTER_SHA256_ARM64=.*$/m,
        `EXPORTER_SHA256_ARM64="${sha256(path.join(releases, exporterArchive("arm64")))}"`,
      );
    const copy = path.join(dir, "install-with-fake-pins.sh");
    fs.writeFileSync(copy, script);
    return copy;
  }

  const installDir = path.join(dir, "agent");

  return {
    dir,
    releases,
    units,
    installDir,
    scriptWithFakePins,
    run({
      env = {},
      input = "",
      args = ["--without-docker"],
      real = false,
      script = null,
    } = {}) {
      const result = spawnSync(
        "bash",
        [real ? SCRIPT : script || scriptWithFakePins(), ...args],
        {
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            HOME: dir,
            STUB_DIR: dir,
            RELEASE_DIR: releases,
            INSTALL_DIR: installDir,
            SYSTEMD_UNIT_DIR: units,
            ...env,
          },
          input,
          encoding: "utf8",
          timeout: 120000,
        },
      );
      return {
        status: result.status,
        output: `${result.stdout}${result.stderr}`,
        envFile: readIfExists(path.join(installDir, ".env")),
        cloudsText: readIfExists(path.join(installDir, "clouds.yaml")),
      };
    },
    log(name) {
      const text = readIfExists(path.join(dir, `${name}.log`));
      return text ? text.trimEnd().split("\n") : [];
    },
    installed(name) {
      return path.join(installDir, name);
    },
    unit(service) {
      return path.join(units, `${service}.service`);
    },
  };
}

function answers(...lines) {
  return `${lines.join("\n")}\n`;
}

const FRESH = answers(
  URL,
  KEY,
  "prod #1",
  AUTH_URL,
  "RegionOne,RegionTwo",
  "",
  APP_ID,
  APP_SECRET,
  "",
);

/* The .env as systemd reads it: double quotes undo \\ and \", and $ is literal. */
function systemdRead(envFile) {
  const values = {};
  for (const line of envFile.split("\n").filter(Boolean)) {
    const at = line.indexOf("=");
    const raw = line.slice(at + 1);
    values[line.slice(0, at)] = raw.startsWith('"')
      ? raw.slice(1, -1).replace(/\\(.)/g, "$1")
      : raw;
  }
  return values;
}

function runBinary(file) {
  return spawnSync(file, [], { encoding: "utf8" }).stdout;
}

function backupsIn(dir) {
  return fs.readdirSync(dir).filter((file) => {
    return file.includes(".bak.");
  });
}

describe("install.sh --without-docker", () => {
  test("downloads the releases the agent pins, for the machine's architecture, and the agent's own files", () => {
    for (const [machine, release] of [
      ["x86_64", "amd64"],
      ["aarch64", "arm64"],
    ]) {
      const env = setup({ arch: machine });
      const run = env.run({ input: FRESH });

      expect({ machine, status: run.status, output: run.output }).toEqual({
        machine,
        status: 0,
        output: expect.stringContaining(
          "OneUptime OpenStack Agent is running!",
        ),
      });
      const downloads = env.log("curl").map((line) => {
        return line.split(" ").pop();
      });
      expect(downloads).toEqual([
        `${AUTH_URL}/auth/tokens`,
        `${COLLECTOR_RELEASES}/v${COLLECTOR_PIN}/otelcol-contrib_${COLLECTOR_PIN}_linux_${release}.tar.gz`,
        `${EXPORTER_RELEASES}/v${EXPORTER_PIN}/openstack-exporter_${EXPORTER_PIN}_linux_${release}.tar.gz`,
        `${URL}/install/openstack-agent/otel-collector-config.yaml`,
        `${URL}/install/openstack-agent/${COLLECTOR_UNIT}`,
        `${URL}/install/openstack-agent/${EXPORTER_UNIT}`,
      ]);
      expect(runBinary(env.installed("otelcol-contrib"))).toBe(
        `fake otelcol-contrib ${release}-1\n`,
      );
      expect(runBinary(env.installed("openstack-exporter"))).toBe(
        `fake openstack-exporter ${release}-1\n`,
      );
    }
  });

  test("a machine it has no release for stops before anything is asked or written", () => {
    const env = setup({ arch: "armv7l" });
    const run = env.run({ input: FRESH });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      "has releases pinned for x86_64 and arm64, not armv7l.",
    );
    expect(fs.existsSync(env.installDir)).toBe(false);
  });

  test("it needs root and Linux, and says so", () => {
    const notRoot = setup({ uid: "1000" }).run({ input: FRESH });
    expect(notRoot.status).not.toBe(0);
    expect(notRoot.output).toContain(
      "Try: sudo bash install.sh --without-docker",
    );

    const notLinux = setup({ kernel: "Darwin" }).run({ input: FRESH });
    expect(notLinux.status).not.toBe(0);
    expect(notLinux.output).toContain("so it needs Linux.");
  });

  test("OPENSTACK_AGENT_WITHOUT_DOCKER=true is the same as the flag", () => {
    const env = setup();
    const run = env.run({
      input: FRESH,
      args: [],
      env: { OPENSTACK_AGENT_WITHOUT_DOCKER: "true" },
    });

    expect(run.status).toBe(0);
    expect(fs.existsSync(env.installed("otelcol-contrib"))).toBe(true);
    expect(env.log("docker")).toEqual([]);
  });

  test("an argument it does not know stops it", () => {
    const run = setup().run({ args: ["--with-docker"] });

    expect(run.status).toBe(2);
    expect(run.output).toContain("unknown argument --with-docker");
  });

  test("never touches Docker, and starts the exporter, then the collector, on every boot", () => {
    const env = setup();
    const run = env.run({ input: FRESH });

    expect(run.status).toBe(0);
    expect(env.log("docker")).toEqual([]);
    expect(env.log("systemctl")).toEqual([
      "daemon-reload",
      `enable ${EXPORTER_SERVICE}`,
      `restart ${EXPORTER_SERVICE}`,
      `enable ${COLLECTOR_SERVICE}`,
      `restart ${COLLECTOR_SERVICE}`,
    ]);
    expect(run.output).toContain(
      `To check status:  systemctl status ${COLLECTOR_SERVICE} ${EXPORTER_SERVICE} --no-pager`,
    );
  });

  test("puts every file where the units run it from, readable by the services' users, whatever root's umask", () => {
    const env = setup();
    const copy = env.scriptWithFakePins();
    const result = spawnSync(
      "bash",
      ["-c", 'umask 077; exec bash "$0" --without-docker', copy],
      {
        env: {
          PATH: `${path.join(env.dir, "bin")}:${process.env.PATH}`,
          HOME: env.dir,
          STUB_DIR: env.dir,
          RELEASE_DIR: env.releases,
          INSTALL_DIR: env.installDir,
          SYSTEMD_UNIT_DIR: env.units,
        },
        input: FRESH,
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);

    expect(mode(env.installDir)).toBe(0o755);
    expect(mode(env.installed("otelcol-contrib"))).toBe(0o755);
    expect(mode(env.installed("openstack-exporter"))).toBe(0o755);
    expect(mode(env.installed("otel-collector-config.yaml"))).toBe(0o644);
    expect(mode(env.unit(COLLECTOR_SERVICE))).toBe(0o644);
    expect(mode(env.unit(EXPORTER_SERVICE))).toBe(0o644);
    expect(mode(env.installed(".env"))).toBe(0o600);
    expect(mode(env.installed("clouds.yaml"))).toBe(0o600);
    // Only the binaries come out of the archives, and nothing of the download stays.
    expect(fs.readdirSync(env.installDir).sort()).toEqual([
      ".agent-files.sha256",
      ".env",
      "clouds.yaml",
      "openstack-exporter",
      "otel-collector-config.yaml",
      "otelcol-contrib",
    ]);
  });

  test("clouds.yaml belongs to the exporter's system user alone, made once", () => {
    const env = setup();
    const run = env.run({ input: FRESH });

    expect(run.status).toBe(0);
    expect(env.log("useradd")).toEqual([
      "--system --user-group --no-create-home --shell /usr/sbin/nologin oneuptime-openstack",
    ]);
    expect(env.log("chown")).toEqual([
      expect.stringMatching(
        /^oneuptime-openstack:oneuptime-openstack .*\/\.clouds\.yaml\.[A-Za-z0-9]+$/,
      ),
    ]);
    expect(env.run().status).toBe(0);
    expect(env.log("useradd")).toHaveLength(1);
  });

  test("clouds.yaml is the same shape as the Docker install's, as typed", () => {
    const env = setup();
    const run = env.run({ input: FRESH });

    const { clouds } = yaml.load(run.cloudsText);
    expect(Object.keys(clouds)).toEqual(["RegionOne", "RegionTwo"]);
    expect(clouds.RegionTwo.auth).toEqual({
      auth_url: AUTH_URL,
      application_credential_id: APP_ID,
      application_credential_secret: APP_SECRET,
    });
    for (const line of env.log("curl")) {
      expect(line).not.toContain(APP_ID);
      expect(line).not.toContain(APP_SECRET);
    }
    expect(run.output).not.toContain(APP_SECRET);
  });

  test("a private CA is named where the exporter reads it on this machine", () => {
    const env = setup();
    const source = path.join(env.dir, "my-ca.pem");
    fs.writeFileSync(
      source,
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    );
    const run = env.run({
      input: answers(
        URL,
        KEY,
        "prod",
        AUTH_URL,
        "RegionOne",
        "",
        APP_ID,
        APP_SECRET,
        source,
      ),
    });

    expect(run.status).toBe(0);
    expect(mode(env.installed("ca.pem"))).toBe(0o644);
    expect(yaml.load(run.cloudsText).clouds.RegionOne.cacert).toBe(
      env.installed("ca.pem"),
    );
  });

  test(".env is quoted for systemd, so a hostile value reaches the collector as typed", () => {
    const env = setup();
    const name = `cost$$ly "east" #1 'x' \\ end`;
    const run = env.run({
      input: answers(
        URL,
        KEY,
        name,
        AUTH_URL,
        "RegionOne",
        "",
        APP_ID,
        APP_SECRET,
        "",
      ),
    });

    expect(run.status).toBe(0);
    expect(run.envFile).toContain(
      `OPENSTACK_CLOUD_NAME="cost$$ly \\"east\\" #1 'x' \\\\ end"`,
    );
    expect(systemdRead(run.envFile)).toEqual({
      ONEUPTIME_URL: URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
      OPENSTACK_CLOUD_NAME: name,
      OPENSTACK_AUTH_URL: AUTH_URL,
      OPENSTACK_EXPORTER_CLOUDS: "[RegionOne]",
      OPENSTACK_EXPORTER_ADDRESS: "127.0.0.1:9180",
      OPENSTACK_EXPORTER_USER: "",
      OPENSTACK_CA_FILE: "",
      COMPOSE_PROFILES: "",
    });
    // And a re-run reads it back by the same rules.
    const rerun = env.run({ args: [] });
    expect(rerun.status).toBe(0);
    expect(rerun.envFile).toBe(run.envFile);
  });

  test("a credential Keystone refuses stops it before anything is downloaded", () => {
    const env = setup();
    writeExecutable(
      path.join(env.dir, "bin", "curl"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/curl.log"
cat > /dev/null
printf '{"error":{"code":401}}\\n401'
`,
    );

    const run = env.run({ input: FRESH });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      "Error: Keystone refused this credential (HTTP 401).",
    );
    expect(env.log("curl")).toHaveLength(1);
    expect(fs.existsSync(env.installDir)).toBe(false);
    expect(env.log("systemctl")).toEqual([]);
  });
});

describe("what it downloads is held to a pinned sha256", () => {
  const script = agentFile("install.sh");

  test("the real script refuses an archive that does not match, and nothing changes", () => {
    // The fake archives are not the real ones, so the real pins refuse them.
    const env = setup();
    const run = env.run({ input: FRESH, real: true });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      `Error: otelcol-contrib_${COLLECTOR_PIN}_linux_amd64.tar.gz does not match the sha256 this installer pins, so it was not installed.`,
    );
    expect(run.output).toContain(
      `  got:      ${sha256(path.join(env.releases, collectorArchive("amd64")))}`,
    );
    expect(fs.existsSync(env.installed("otelcol-contrib"))).toBe(false);
    expect(run.envFile).toBe("");
    expect(run.cloudsText).toBe("");
    expect(env.log("systemctl")).toEqual([]);
    expect(env.log("useradd")).toEqual([]);
    // Nothing of the download stays.
    expect(fs.readdirSync(env.installDir)).toEqual([]);
  });

  test("the second archive failing leaves the first uninstalled too", () => {
    const env = setup();
    const copy = env.scriptWithFakePins();
    fs.writeFileSync(
      copy,
      fs
        .readFileSync(copy, "utf8")
        .replace(
          /^EXPORTER_SHA256_AMD64=.*$/m,
          `EXPORTER_SHA256_AMD64="${"0".repeat(64)}"`,
        ),
    );
    const result = spawnSync("bash", [copy, "--without-docker"], {
      env: {
        PATH: `${path.join(env.dir, "bin")}:${process.env.PATH}`,
        HOME: env.dir,
        STUB_DIR: env.dir,
        RELEASE_DIR: env.releases,
        INSTALL_DIR: env.installDir,
        SYSTEMD_UNIT_DIR: env.units,
      },
      input: FRESH,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(fs.existsSync(env.installed("otelcol-contrib"))).toBe(false);
    expect(fs.readdirSync(env.installDir)).toEqual([]);
  });

  test("a release it cannot download stops the install", () => {
    const env = setup();
    // The checksums are taken first: the archive is gone by the time it is asked for.
    const script = env.scriptWithFakePins();
    fs.rmSync(path.join(env.releases, exporterArchive("amd64")));

    const run = env.run({ input: FRESH, script });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      `Error: could not download ${EXPORTER_RELEASES}/v${EXPORTER_PIN}/${exporterArchive("amd64")}`,
    );
    expect(fs.existsSync(env.installed("otelcol-contrib"))).toBe(false);
  });

  test("an archive without the binary stops it, and an upgrade keeps what was running", () => {
    const env = setup();
    expect(env.run({ input: FRESH }).status).toBe(0);
    const work = fs.mkdtempSync(path.join(env.releases, "broken-"));
    fs.writeFileSync(path.join(work, "LICENSE"), "license\n");
    spawnSync("tar", [
      "-czf",
      path.join(env.releases, collectorArchive("amd64")),
      "-C",
      work,
      "LICENSE",
    ]);
    fs.rmSync(path.join(env.dir, "systemctl.log"));

    const run = env.run({ args: [] });

    expect(run.status).not.toBe(0);
    expect(runBinary(env.installed("otelcol-contrib"))).toBe(
      "fake otelcol-contrib amd64-1\n",
    );
    expect(env.log("systemctl")).toEqual([]);
  });

  test("the pins are the versions docker-compose.yml pins, and real sha256s", () => {
    const value = (name) => {
      const match = script.match(new RegExp(`^${name}="([^"]+)"$`, "m"));
      expect(match).not.toBeNull();
      return match[1];
    };
    expect(value("COLLECTOR_VERSION")).toBe(COLLECTOR_PIN);
    expect(value("EXPORTER_VERSION")).toBe(EXPORTER_PIN);

    const sums = [
      "COLLECTOR_SHA256_AMD64",
      "COLLECTOR_SHA256_ARM64",
      "EXPORTER_SHA256_AMD64",
      "EXPORTER_SHA256_ARM64",
    ].map(value);
    for (const sum of sums) {
      expect(sum).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(sums).size).toBe(sums.length);
  });

  test("the script takes no checksum from anywhere but itself", () => {
    for (const name of [
      "COLLECTOR_SHA256",
      "EXPORTER_SHA256",
      "COLLECTOR_VERSION",
      "EXPORTER_VERSION",
    ]) {
      expect(script).not.toContain(`\${${name}:-`);
    }
    // Assigned, never read in from a release's own checksums file.
    expect(script).not.toContain("checksums.txt");
    // The environment does not get to say otherwise: each is set unconditionally.
    expect(script).toMatch(/^COLLECTOR_SHA256_AMD64="[0-9a-f]{64}"$/m);
  });
});

describe("a re-run, the upgrade", () => {
  test("needs no flag, asks nothing, keeps .env and clouds.yaml, and restarts on new binaries", () => {
    const env = setup();
    const first = env.run({ input: FRESH });
    expect(first.status).toBe(0);
    writeRelease(
      env.releases,
      collectorArchive("amd64"),
      "otelcol-contrib",
      "amd64-2",
    );
    writeRelease(
      env.releases,
      exporterArchive("amd64"),
      "openstack-exporter",
      "amd64-2",
    );
    fs.rmSync(path.join(env.dir, "systemctl.log"));

    const second = env.run({ args: [] });

    expect(second.status).toBe(0);
    expect(second.output).toContain("reusing it.");
    expect(second.envFile).toBe(first.envFile);
    expect(second.cloudsText).toBe(first.cloudsText);
    expect(runBinary(env.installed("otelcol-contrib"))).toBe(
      "fake otelcol-contrib amd64-2\n",
    );
    expect(runBinary(env.installed("openstack-exporter"))).toBe(
      "fake openstack-exporter amd64-2\n",
    );
    expect(env.log("systemctl")).toContain(`restart ${COLLECTOR_SERVICE}`);
    expect(env.log("docker")).toEqual([]);
    expect(backupsIn(env.installDir)).toEqual([]);
    expect(backupsIn(env.units)).toEqual([]);
    expect(second.output).not.toContain("NOTE:");
  });

  test("a unit you edited is kept next to it, and said", () => {
    const env = setup();
    expect(env.run({ input: FRESH }).status).toBe(0);
    const unit = env.unit(EXPORTER_SERVICE);
    const edited = fs
      .readFileSync(unit, "utf8")
      .replace(" --disable-metric=nova-quota_cores", "");
    fs.writeFileSync(unit, edited);

    const second = env.run({ args: [] });

    expect(second.status).toBe(0);
    const backups = backupsIn(env.units);
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(env.units, backups[0]), "utf8")).toBe(
      edited,
    );
    expect(second.output).toContain(
      "NOTE: you had edited these files since install.sh installed them.",
    );
    expect(second.output).toContain(
      `systemctl daemon-reload && systemctl restart ${EXPORTER_SERVICE} ${COLLECTOR_SERVICE}`,
    );
  });

  test("the units point at the folder it installed to, and a re-run does not take that for an edit", () => {
    const env = setup();
    expect(env.run({ input: FRESH }).status).toBe(0);

    for (const service of [COLLECTOR_SERVICE, EXPORTER_SERVICE]) {
      const unit = fs.readFileSync(env.unit(service), "utf8");
      expect(unit).not.toContain(DEFAULT_INSTALL_DIR);
      expect(unit).toContain(`${env.installDir}/`);
    }

    const second = env.run({ args: [] });
    expect(second.status).toBe(0);
    expect(backupsIn(env.units)).toEqual([]);
    expect(second.output).not.toContain("NOTE:");
  });

  test("from a Docker install's folder, it keeps the answers and turns them into what systemd reads", () => {
    const env = setup();
    fs.mkdirSync(env.installDir);
    fs.writeFileSync(
      env.installed(".env"),
      [
        `ONEUPTIME_URL='${URL}'`,
        `ONEUPTIME_TELEMETRY_INGESTION_KEY='${KEY}'`,
        "OPENSTACK_CLOUD_NAME='prod #1'",
        `OPENSTACK_AUTH_URL='${AUTH_URL}'`,
        "OPENSTACK_EXPORTER_CLOUDS='[RegionOne]'",
        "OPENSTACK_EXPORTER_ADDRESS='openstack-exporter:9180'",
        "OPENSTACK_EXPORTER_USER=65532:65532",
        "OPENSTACK_CA_FILE=''",
        "COMPOSE_PROFILES='openstack-exporter'",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      env.installed("clouds.yaml"),
      `clouds:
  "RegionOne":
    region_name: "RegionOne"
    auth_type: v3applicationcredential
    auth:
      auth_url: "${AUTH_URL}"
      application_credential_id: "${APP_ID}"
      application_credential_secret: "s3cret"
`,
    );

    const run = env.run();

    expect(run.status).toBe(0);
    expect(systemdRead(run.envFile)).toMatchObject({
      OPENSTACK_CLOUD_NAME: "prod #1",
      OPENSTACK_EXPORTER_ADDRESS: "127.0.0.1:9180",
      COMPOSE_PROFILES: "",
    });
    expect(env.log("chown")).toEqual([
      `oneuptime-openstack:oneuptime-openstack ${env.installed("clouds.yaml")}`,
    ]);
  });
});

describe("your own exporter, without Docker", () => {
  const OWN = "10.0.0.5:9180";

  test("installs the collector alone, and localhost is allowed, since nothing is in a container", () => {
    for (const address of [OWN, "127.0.0.1:9198"]) {
      const env = setup();
      const run = env.run({
        input: answers(URL, KEY, "prod", "RegionOne"),
        env: { OPENSTACK_EXPORTER_ADDRESS: address },
      });

      expect({ address, status: run.status }).toEqual({ address, status: 0 });
      expect(fs.existsSync(env.installed("otelcol-contrib"))).toBe(true);
      expect(fs.existsSync(env.installed("openstack-exporter"))).toBe(false);
      expect(fs.existsSync(env.unit(EXPORTER_SERVICE))).toBe(false);
      expect(fs.existsSync(env.installed("clouds.yaml"))).toBe(false);
      expect(env.log("useradd")).toEqual([]);
      expect(env.log("systemctl")).toEqual([
        "daemon-reload",
        `disable --now ${EXPORTER_SERVICE}`,
        `enable ${COLLECTOR_SERVICE}`,
        `restart ${COLLECTOR_SERVICE}`,
      ]);
      expect(systemdRead(run.envFile).OPENSTACK_EXPORTER_ADDRESS).toBe(address);
    }
  });
});

describe(`agents/OpenStackAgent/${COLLECTOR_UNIT}`, () => {
  const unit = agentFile(COLLECTOR_UNIT);

  function values(key, text = unit) {
    return text
      .split("\n")
      .filter((line) => {
        return line.startsWith(`${key}=`);
      })
      .map((line) => {
        return line.slice(key.length + 1);
      });
  }

  test("runs the binary and the config the installer puts down, with the .env it writes", () => {
    expect(values("ExecStart")).toHaveLength(1);
    expect(values("ExecStart")[0]).toMatch(
      new RegExp(
        `^${DEFAULT_INSTALL_DIR}/otelcol-contrib --config=${DEFAULT_INSTALL_DIR}/otel-collector-config\\.yaml `,
      ),
    );
    expect(values("EnvironmentFile")).toEqual([`${DEFAULT_INSTALL_DIR}/.env`]);
  });

  test("gives the settings docker-compose.yml defaults the same defaults, but for the exporter's address", () => {
    const defaults = {};
    for (const entry of COMPOSE.services["oneuptime-openstack-agent"]
      .environment) {
      const match = entry.match(/^([A-Z_]+)=\$\{[A-Z_]+:-([^}]*)\}$/);
      if (match) {
        defaults[match[1]] = match[2];
      }
    }
    const unitDefaults = {};
    for (const assignment of values("Environment")) {
      const at = assignment.indexOf("=");
      unitDefaults[assignment.slice(0, at)] = assignment.slice(at + 1);
    }
    expect(Object.keys(unitDefaults).sort()).toEqual(
      Object.keys(defaults).sort(),
    );
    expect(unitDefaults.OPENSTACK_CLOUD_NAME).toBe(
      defaults.OPENSTACK_CLOUD_NAME,
    );
    expect(unitDefaults.OPENSTACK_EXPORTER_CLOUDS).toBe(
      defaults.OPENSTACK_EXPORTER_CLOUDS,
    );
    expect(unitDefaults.OPENSTACK_EXPORTER_ADDRESS).toBe("127.0.0.1:9180");
  });

  test("runs the collector as a throwaway user with no capabilities, its own metrics off port 8888 and the VMware agent's 8890", () => {
    expect(values("DynamicUser")).toEqual(["yes"]);
    expect(values("User")).toEqual([]);
    expect(values("CapabilityBoundingSet")).toEqual([""]);
    expect(values("NoNewPrivileges")).toEqual(["yes"]);
    expect(values("ProtectSystem")).toEqual(["strict"]);
    expect(values("ExecStart")[0]).toContain(
      '"--set=service::telemetry::metrics::readers=[{pull: {exporter: {prometheus: {host: 127.0.0.1, port: 8891}}}}]"',
    );
  });

  test("the exporter's unit runs the release with the flags docker-compose.yml gives it, on this machine alone", () => {
    const exporter = agentFile(EXPORTER_UNIT);
    const [start] = values("ExecStart", exporter);
    const words = start.split(" ");

    expect(words[0]).toBe(`${DEFAULT_INSTALL_DIR}/openstack-exporter`);
    const composed = COMPOSE.services["openstack-exporter"].command;
    for (const flag of composed) {
      if (flag.startsWith("--os-client-config=")) {
        expect(words).toContain(
          `--os-client-config=${DEFAULT_INSTALL_DIR}/clouds.yaml`,
        );
      } else {
        expect(words).toContain(flag);
      }
    }
    expect(words).toContain("--web.listen-address=127.0.0.1:9180");
    expect(words).toHaveLength(composed.length + 2);
    // In the same order, so the two read the same side by side.
    const disabled = (flags) => {
      return flags.filter((flag) => {
        return flag.startsWith("--disable");
      });
    };
    expect(disabled(words)).toEqual(disabled(composed));
  });

  test("the exporter's unit runs it as the one account that can read clouds.yaml, with no capabilities", () => {
    const exporter = agentFile(EXPORTER_UNIT);

    expect(values("User", exporter)).toEqual(["oneuptime-openstack"]);
    expect(values("Group", exporter)).toEqual(["oneuptime-openstack"]);
    expect(values("DynamicUser", exporter)).toEqual([]);
    expect(values("CapabilityBoundingSet", exporter)).toEqual([""]);
    expect(values("NoNewPrivileges", exporter)).toEqual(["yes"]);
    expect(values("ProtectSystem", exporter)).toEqual(["strict"]);
    expect(agentFile("install.sh")).toContain(
      'EXPORTER_SYSTEM_USER="oneuptime-openstack"',
    );
  });

  test("the Docker install's unit wraps Compose in the folder install.sh uses", () => {
    const docker = agentFile("systemd/oneuptime-openstack-agent.service");

    expect(values("WorkingDirectory", docker)).toEqual([DEFAULT_INSTALL_DIR]);
    expect(values("ExecStart", docker)).toEqual([
      "/usr/bin/docker compose up --remove-orphans",
    ]);
    expect(values("Requires", docker)).toEqual(["docker.service"]);
  });

  /*
   * systemd-analyze verify loads the units as systemd would: an unknown directive,
   * a bad value or an ExecStart that is not executable fails it. Their paths are
   * moved under a scratch root with stand-in binaries. Skipped without systemd,
   * except in CI, where a check that cannot run must not pass.
   */
  test("load cleanly in systemd-analyze verify", () => {
    const which = spawnSync("sh", ["-c", "command -v systemd-analyze"], {
      encoding: "utf8",
    });
    if (which.status !== 0) {
      if (process.env.CI) {
        throw new Error(
          "systemd-analyze is not installed, and CI must verify the units.",
        );
      }
      // eslint-disable-next-line no-console
      console.log("Skipped: systemd-analyze is not installed here.");
      return;
    }
    const dir = scratch();
    const root = path.join(dir, "root");
    const installDir = path.join(root, DEFAULT_INSTALL_DIR);
    fs.mkdirSync(installDir, { recursive: true });
    for (const binary of ["otelcol-contrib", "openstack-exporter"]) {
      writeExecutable(path.join(installDir, binary), "#!/bin/sh\nexit 0\n");
    }
    fs.writeFileSync(path.join(installDir, ".env"), "");
    const files = [
      [COLLECTOR_UNIT, `${COLLECTOR_SERVICE}.service`],
      [EXPORTER_UNIT, `${EXPORTER_SERVICE}.service`],
    ].map(([unitFile, name]) => {
      const file = path.join(dir, name);
      fs.writeFileSync(
        file,
        agentFile(unitFile).split(DEFAULT_INSTALL_DIR).join(installDir),
      );
      return file;
    });

    const verify = spawnSync("systemd-analyze", ["verify", ...files], {
      encoding: "utf8",
    });
    expect({
      status: verify.status,
      output: `${verify.stdout}${verify.stderr}`.trim(),
    }).toEqual({ status: 0, output: "" });
  });
});

/* ---------------------------------------------------------- the README's commands */

describe("the README", () => {
  const readme = agentFile("README.md");

  // The body of one "## Heading" section, up to the next heading of its level.
  function section(heading) {
    const lines = readme.split("\n");
    const start = lines.indexOf(heading);
    expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });
    const level = heading.match(/^#+/)[0].length;
    const body = [];
    let fenced = false;
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith("```")) {
        fenced = !fenced;
      }
      const match = fenced ? null : line.match(/^(#{1,6})\s/);
      if (match && match[1].length <= level) {
        break;
      }
      body.push(line);
    }
    return body.join("\n");
  }

  function bashBlocks(markdown) {
    return Array.from(markdown.matchAll(/^```bash\n([\s\S]*?)\n```$/gm)).map(
      (match) => {
        return match[1];
      },
    );
  }

  test("the uninstall without Docker removes the services, their user and the folder, and nothing else", () => {
    const env = setup();
    expect(env.run({ input: FRESH }).status).toBe(0);
    const bin = path.join(env.dir, "bin");
    writeExecutable(
      path.join(bin, "sudo"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/sudo.log"\nexec "$@"\n`,
    );
    writeExecutable(
      path.join(bin, "userdel"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/userdel.log"\n`,
    );
    fs.writeFileSync(path.join(env.units, "other.service"), "");
    fs.mkdirSync(path.join(env.dir, "something-else"));
    fs.rmSync(path.join(env.dir, "systemctl.log"));

    const uninstall = bashBlocks(section("## Uninstalling")).find((block) => {
      return block.startsWith("sudo systemctl disable");
    });
    expect(uninstall).toBeDefined();
    const result = spawnSync(
      "bash",
      [
        "-euo",
        "pipefail",
        "-c",
        uninstall
          .split("/etc/systemd/system")
          .join(env.units)
          .split(DEFAULT_INSTALL_DIR)
          .join(env.installDir),
      ],
      {
        cwd: env.dir,
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: env.dir,
          STUB_DIR: env.dir,
        },
      },
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    expect(env.log("systemctl")).toEqual([
      `disable --now ${COLLECTOR_SERVICE} ${EXPORTER_SERVICE}`,
      "daemon-reload",
    ]);
    expect(env.log("userdel")).toEqual(["oneuptime-openstack"]);
    expect(fs.existsSync(env.installDir)).toBe(false);
    expect(fs.readdirSync(env.units)).toEqual(["other.service"]);
    expect(fs.existsSync(path.join(env.dir, "something-else"))).toBe(true);
  });

  test("says the interval each job has, and each timeout, as the collector's config does", () => {
    const config = yaml.load(agentFile("otel-collector-config.yaml"));
    const jobs = config.receivers.prometheus.config.scrape_configs;
    const table = section("## Collected metrics");

    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      const minutes = Number.parseInt(job.scrape_interval, 10) / 60;
      const timeout = Number.parseInt(job.scrape_timeout, 10);
      expect(table).toContain(
        `| \`${job.job_name}\` | ${minutes} minutes | ${timeout} s |`,
      );
    }
  });

  test("names every line docker-compose.yml leaves out, how to take it out and what that costs, and the three upstream issues", () => {
    const text = section("## What it costs");
    const flags = COMPOSE.services["openstack-exporter"].command.filter(
      (flag) => {
        return flag.startsWith("--disable");
      },
    );
    expect(flags.length).toBeGreaterThan(0);
    // Every line it leaves out, by name or as the four the per-port series take.
    for (const flag of flags) {
      expect({
        flag,
        named: flag.startsWith("--disable-metric=neutron-port")
          ? text.includes("the four `--disable-metric=neutron-port*` lines")
          : text.includes(`\`${flag}\``),
      }).toEqual({ flag, named: true });
    }
    expect(
      flags.filter((flag) => {
        return flag.startsWith("--disable-metric=neutron-port");
      }),
    ).toHaveLength(4);
    expect(text).toContain(
      "delete the `--disable-metric` line for what you want",
    );
    expect(text).toContain("one call per project per scrape");
    // Named only to say why it is not used.
    expect(flags).not.toContain("--disable-slow-metrics");
    expect(text).toContain(
      "Do not use the exporter's own `--disable-slow-metrics` instead",
    );
    for (const issue of [540, 660, 244]) {
      expect(text).toContain(
        `https://github.com/openstack-exporter/openstack-exporter/issues/${issue}`,
      );
    }
  });

  /*
   * Found on a real cloud: once a policy file oslo.policy has read is gone, Flamingo
   * and Epoxy fail every check, and Keystone failing that way stops the whole cloud.
   */
  test("says to empty a policy file and never delete it, where it says to merge them, and what to do if it is gone", () => {
    const text = section("### Level 2: Infrastructure only");

    expect(text).toContain("empty the file (`{}`) and never delete it");
    expect(text).toContain("the whole cloud answers `503`");
    expect(text).toContain("If it has already happened, restart the service.");
    expect(section("## Uninstalling")).toContain("Never delete the file.");
    // As each file's own header says.
    for (const file of fs.readdirSync(
      path.join(AGENT_DIR, "access", "policy"),
    )) {
      expect({
        file,
        says: agentFile(path.join("access", "policy", file)).includes(
          "empty the file rather than deleting it",
        ),
      }).toEqual({ file, says: true });
    }
  });

  /*
   * Found on real clouds: where Cinder has enforce_new_defaults off, any role on a
   * project can create its volumes. So the role lives on a project that holds
   * nothing and has no quota, exactly as the rig sets it up.
   */
  test("level 2 puts the role on a project that holds nothing and has zero quota, with the rig's own commands", () => {
    const text = section("### Level 2: Infrastructure only");
    const rig = fs.readFileSync(
      path.join(__dirname, "openstack-e2e", "access-matrix.sh"),
      "utf8",
    );
    const quotas = rig.split("\n").filter((line) => {
      return line.startsWith("openstack quota set ");
    });

    expect(quotas).toHaveLength(3);
    for (const line of quotas) {
      expect(text).toContain(
        line.replace(/ ou-monitoring$/, " oneuptime-monitoring"),
      );
    }
    expect(text).toContain(
      "openstack role add --project oneuptime-monitoring --user oneuptime-monitoring oneuptime_monitoring",
    );
    expect(text).toContain(
      "openstack role add --project oneuptime-monitoring --user oneuptime-monitoring reader",
    );
    expect(text).toContain(
      "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off.",
    );
    expect(text).toContain(
      "every write answered `403`, or `409` and `413` from quota",
    );
    expect(text).toContain("answers this project `409 Quota exceeded`");
  });

  test("level 2 has no policy file for Cinder, says why, and says only level 1 sees its services and pools", () => {
    const text = section("### Level 2: Infrastructure only");

    expect(readme).not.toContain("cinder.yaml");
    expect(text).toContain("There is no file for Cinder.");
    expect(text).toContain(
      "That comes from Cinder's own code requiring an admin context, after policy has already passed, so no override can open them.",
    );
    expect(text).toContain(
      "So this level does not see `cinder-volume` or `cinder-scheduler` state or storage pools. Only level 1 does",
    );
  });

  test("level 3 says it shows no instances through the agent, and that reader may write", () => {
    const text = section("### Level 3: Project view");

    expect(text).toContain("Through the agent it shows no instances at all.");
    expect(text).toContain(
      "The exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.",
    );
    expect(text).toContain(
      "On a cloud where Cinder has `enforce_new_defaults` off, plain `reader` can create volumes in its project too.",
    );
    expect(text).toContain(
      "On Epoxy, Flamingo and Gazpacho it did (`202`), and on Hibiscus it was refused (`403`), because DevStack only turns `enforce_new_defaults` on there. Cinder's own default is off.",
    );
  });

  test("level 1 fits the access rules to the cloud, with the tool OneUptime serves, as its docstring says", () => {
    const text = section("### Level 1: Full view");
    const tool = agentFile("access/access-rules-for-cloud.py");

    expect(tool).toContain("openstack catalog list -f json |");
    expect(text).toContain(
      "openstack catalog list -f json | python3 access-rules-for-cloud.py \\\n  application-credential-access-rules.json > access-rules-for-this-cloud.json",
    );
    expect(text).toContain(
      '--access-rules "$(cat access-rules-for-this-cloud.json)"',
    );
    expect(text).toContain(
      "/install/openstack-agent/access/access-rules-for-cloud.py",
    );
    expect(text).toContain(
      "every read answered `200` and every write `401`, on every release we record",
    );
    expect(text).toContain("except Keystone's users and groups, on purpose");
    expect(text).toContain("Keystone needs nothing.");
    expect(text).toContain(
      "The rules also carry `volumev3`, for a Cinder configured that way.",
    );
  });

  test("every download from OneUptime fails on an error answer, and names no GitHub copy", () => {
    const downloads = readme.split("\n").filter((line) => {
      return (
        line.includes("/install/openstack-agent") && line.includes("curl ")
      );
    });
    expect(downloads.length).toBeGreaterThan(5);
    for (const line of downloads) {
      expect({ line, flags: line.match(/curl -(\S*)/)[1] }).toEqual({
        line,
        flags: expect.stringContaining("f"),
      });
    }
    expect(readme).not.toContain("raw.githubusercontent.com");
  });

  test("every file it says to download is one OneUptime serves", () => {
    const entry = loadInstallScriptsCatalog().INSTALL_SCRIPTS.find(
      (candidate) => {
        return candidate.name === "openstack-agent";
      },
    );
    const named = Array.from(
      readme.matchAll(/\/install\/openstack-agent\/([^\s"`]+)/g),
    ).map((match) => {
      return match[1];
    });
    expect(named.length).toBeGreaterThan(5);
    for (const file of named) {
      expect({ file, served: entry.files.includes(file) }).toEqual({
        file,
        served: true,
      });
    }
  });

  test("the anchors its links name are headings it has", () => {
    const anchors = readme
      .split("\n")
      .filter((line) => {
        return /^#{1,6}\s/.test(line);
      })
      .map((line) => {
        return line
          .replace(/^#+\s+/, "")
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, "")
          .replace(/ /g, "-");
      });
    const links = Array.from(readme.matchAll(/\]\(#([^)]+)\)/g)).map(
      (match) => {
        return match[1];
      },
    );
    expect(links.length).toBeGreaterThan(3);
    for (const link of links) {
      expect({ link, found: anchors.includes(link) }).toEqual({
        link,
        found: true,
      });
    }
  });

  test("the doctor's advice names sections the README has", () => {
    const doctor = agentFile("troubleshoot.sh");
    expect(doctor).toContain("Level 2: Infrastructure only");
    for (const name of ["Level 1: Full view", "Access"]) {
      expect(doctor).toContain(`README.md, \\"${name}\\"`);
    }
    expect(readme).toContain("### Level 1: Full view");
    expect(readme).toContain("### Level 2: Infrastructure only");
    expect(readme).toContain("## Access");
  });
});
