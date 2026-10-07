"use strict";

/**
 * The VMware agent without Docker: the collector release the agent pins,
 * run by systemd (agents/VMwareAgent/systemd/
 * oneuptime-vmware-agent-native.service), installed with the commands the
 * docs give for it. Checked here without root, a vCenter or systemd:
 *
 *  - the docs' own commands, run for real with the install's /opt and
 *    /etc/systemd/system moved under a scratch root, and `sudo`, `sudoedit`,
 *    `systemctl`, `curl` and `uname` replaced by recording stubs: the
 *    release the agent pins is downloaded for the machine's architecture,
 *    every file lands where the unit runs it from with a mode the service's
 *    throwaway user can read (whatever root's umask), .env is root's alone
 *    before the password goes in, and the service is started; the upgrade
 *    replaces the binary, the config and the unit, keeps .env and restarts;
 *    the uninstall removes exactly what the install added;
 *  - the unit: the files it runs, the defaults docker-compose.yml gives, the
 *    sandbox, and `systemd-analyze verify` where systemd is installed (CI
 *    must run it);
 *  - troubleshoot.sh, pointed at such an install, says it runs without
 *    Docker and where to look instead, and never calls docker.
 *
 * Tests/Ops/vmware-agent-native-install.sh runs the same commands as root,
 * in a systemd container, against a vCenter simulator.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "VMwareAgent");
const DOCS_PAGE = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en/telemetry/vmware.md",
);

const UNIT_FILE = "systemd/oneuptime-vmware-agent-native.service";
const SERVICE = "oneuptime-vmware-agent";
const INSTALL_DIR = "/opt/oneuptime-vmware-agent";
const UNIT_DIR = "/etc/systemd/system";
const RAW_URL =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent";
const RELEASES_URL =
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download";

const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";
// What the reader puts in the editor: a password and an AD user systemd must keep.
const PASSWORD = `Sp3c$ial #pass "q" \\ end`;
const USERNAME = "VSPHERE\\oneuptime";

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vmware-without-docker-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

function mode(file) {
  return (fs.statSync(file).mode & 0o777).toString(8);
}

function agentFile(name) {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
}

// The collector release docker-compose.yml pins (and the config reports).
const PIN = yaml
  .load(agentFile("docker-compose.yml"))
  .services["oneuptime-vmware-agent"].image.split(":")[1];

/* The body of one "## Heading" section, up to the next heading of the same or a higher level. */
function section(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });
  const level = heading.match(/^#+/)[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^(#{1,6})\s/);
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

const DOCS = fs.readFileSync(DOCS_PAGE, "utf8");
const WITHOUT_DOCKER = bashBlocks(
  section(DOCS, "## Alternative — Without Docker"),
);
const [INSTALL, ENV_FILE_COMMANDS, ENV_CONTENT, START] = WITHOUT_DOCKER;
const UPGRADE = bashBlocks(section(DOCS, "## Upgrading the Agent")).find(
  (block) => {
    return block.startsWith('cd "$(mktemp -d)"');
  },
);
const UNINSTALL = bashBlocks(section(DOCS, "## Uninstalling the Agent")).find(
  (block) => {
    return block.startsWith("sudo systemctl disable");
  },
);

// The docs' settings, filled in as a reader would in the editor.
const ENV = ENV_CONTENT.replace(
  "ONEUPTIME_URL=YOUR_ONEUPTIME_URL",
  "ONEUPTIME_URL=https://oneuptime.example.com",
)
  .replace(
    "ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN",
    `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
  )
  .replace(
    "VCENTER_USERNAME='oneuptime@vsphere.local'",
    `VCENTER_USERNAME='${USERNAME}'`,
  )
  .replace(
    "VCENTER_PASSWORD='a-strong-password'",
    `VCENTER_PASSWORD='${PASSWORD}'`,
  );

/*
 * The install's absolute paths, moved under a scratch root so the commands
 * run unprivileged. Nothing else in them changes.
 */
function rooted(commands, root) {
  return commands
    .split(INSTALL_DIR)
    .join(root + INSTALL_DIR)
    .split(UNIT_DIR)
    .join(root + UNIT_DIR);
}

/*
 * A fake release archive: what the real one holds (README.md and the
 * otelcol-contrib binary), the binary saying which build it is.
 */
function writeRelease(releaseDir, arch, build) {
  const work = fs.mkdtempSync(path.join(releaseDir, "build-"));
  writeExecutable(
    path.join(work, "otelcol-contrib"),
    `#!/bin/sh\necho "fake otelcol-contrib ${build}"\n`,
  );
  fs.writeFileSync(path.join(work, "README.md"), "# otelcol-contrib\n");
  const archive = path.join(
    releaseDir,
    `otelcol-contrib_${PIN}_linux_${arch}.tar.gz`,
  );
  const tar = spawnSync(
    "tar",
    ["-czf", archive, "-C", work, "README.md", "otelcol-contrib"],
    { encoding: "utf8" },
  );
  expect(tar.status).toBe(0);
}

/*
 * `sudo` runs the command as is. `sudoedit` keeps the mode the file has when
 * the editor opens it, then writes what the reader typed ($STUB_DIR/typed).
 * `systemctl` records each call. `uname -m` answers $FAKE_ARCH. `curl`
 * serves the release archives from $RELEASE_DIR and the agent's files from
 * this checkout, records each URL, and fails (as -f does) on anything else.
 */
function setup(options = {}) {
  const dir = scratch();
  const root = path.join(dir, "root");
  fs.mkdirSync(path.join(root, "opt"), { recursive: true });
  fs.mkdirSync(path.join(root, UNIT_DIR), { recursive: true });
  const stubs = path.join(dir, "stubs");
  fs.mkdirSync(stubs);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const releases = path.join(dir, "releases");
  fs.mkdirSync(releases);
  writeRelease(releases, "amd64", "amd64-1");
  writeRelease(releases, "arm64", "arm64-1");
  fs.writeFileSync(path.join(stubs, "typed"), `${ENV}\n`);

  writeExecutable(
    path.join(bin, "sudo"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/sudo.log"\nexec "$@"\n`,
  );
  writeExecutable(
    path.join(bin, "sudoedit"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/sudoedit.log"
ls -l "$1" | cut -c1-10 > "$STUB_DIR/mode-at-edit"
cat "$STUB_DIR/typed" > "$1"
`,
  );
  writeExecutable(
    path.join(bin, "systemctl"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/systemctl.log"\n`,
  );
  writeExecutable(
    path.join(bin, "uname"),
    `#!/usr/bin/env bash\nif [ "$1" = "-m" ]; then echo "$FAKE_ARCH"; else exec /usr/bin/uname "$@"; fi\n`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
url=""; out=""; remote=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*O*) remote=1; shift ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$STUB_DIR/curl.log"
[ "$remote" = 1 ] && out="\${url##*/}"
case "$url" in
  ${RELEASES_URL}/v*/*)
    src="$RELEASE_DIR/\${url##*/}" ;;
  ${RAW_URL}/*)
    src="${AGENT_DIR}/\${url#${RAW_URL}/}" ;;
  *)
    exit 22 ;;
esac
[ -f "$src" ] || exit 22
cp "$src" "$out"
`,
  );

  return {
    dir,
    root,
    stubs,
    releases,
    run(commands, extra = {}) {
      return spawnSync(
        "bash",
        ["-euo", "pipefail", "-c", rooted(commands, root)],
        {
          cwd: dir,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            STUB_DIR: stubs,
            RELEASE_DIR: releases,
            FAKE_ARCH: options.arch || "x86_64",
            ...extra,
          },
        },
      );
    },
    log(name) {
      const file = path.join(stubs, `${name}.log`);
      return fs.existsSync(file)
        ? fs.readFileSync(file, "utf8").trimEnd().split("\n")
        : [];
    },
    installed(name) {
      return path.join(root, INSTALL_DIR, name);
    },
    unit() {
      return path.join(root, UNIT_DIR, `${SERVICE}.service`);
    },
  };
}

function install(env, prefix = "") {
  const result = env.run(
    [prefix, INSTALL, ENV_FILE_COMMANDS, START].filter(Boolean).join("\n"),
  );
  expect({ status: result.status, stderr: result.stderr }).toEqual({
    status: 0,
    stderr: expect.any(String),
  });
  return result;
}

describe("the docs' install without Docker", () => {
  test("is four blocks: the files, a private .env, its settings, the service", () => {
    expect(WITHOUT_DOCKER).toHaveLength(4);
    expect(INSTALL.split("\n")[0]).toBe('cd "$(mktemp -d)"');
    expect(ENV_CONTENT.split("\n")[0]).toBe("ONEUPTIME_URL=YOUR_ONEUPTIME_URL");
    expect(START).toBe(
      `sudo systemctl daemon-reload\nsudo systemctl enable ${SERVICE}\nsudo systemctl restart ${SERVICE}`,
    );
    expect(UPGRADE).toBeDefined();
    expect(UNINSTALL).toBeDefined();
  });

  test("downloads the release the agent pins, for the machine's architecture, and the agent's own files", () => {
    for (const [machine, release] of [
      ["x86_64", "amd64"],
      ["aarch64", "arm64"],
    ]) {
      const env = setup({ arch: machine });
      install(env);
      expect(env.log("curl")).toEqual([
        `${RELEASES_URL}/v${PIN}/otelcol-contrib_${PIN}_linux_${release}.tar.gz`,
        `${RAW_URL}/otel-collector-config.yaml`,
        `${RAW_URL}/${UNIT_FILE}`,
      ]);
      expect(
        spawnSync(env.installed("otelcol-contrib"), [], {
          encoding: "utf8",
        }).stdout,
      ).toBe(`fake otelcol-contrib ${release}-1\n`);
    }
  });

  test("puts every file where the unit runs it from, readable by the service's user", () => {
    const env = setup();
    install(env);

    expect(mode(path.join(env.root, INSTALL_DIR))).toBe("755");
    expect(mode(env.installed("otelcol-contrib"))).toBe("755");
    expect(fs.readFileSync(env.installed("otel-collector-config.yaml"), "utf8")).toBe(
      agentFile("otel-collector-config.yaml"),
    );
    expect(mode(env.installed("otel-collector-config.yaml"))).toBe("644");
    expect(fs.readFileSync(env.unit(), "utf8")).toBe(agentFile(UNIT_FILE));
    expect(mode(env.unit())).toBe("644");
    // Only the binary comes out of the release archive.
    expect(fs.readdirSync(path.join(env.root, INSTALL_DIR)).sort()).toEqual([
      ".env",
      "otel-collector-config.yaml",
      "otelcol-contrib",
    ]);
  });

  test("keeps those modes when root's umask would hide the files from the service's user", () => {
    const env = setup();
    install(env, "umask 077");
    expect(mode(path.join(env.root, INSTALL_DIR))).toBe("755");
    expect(mode(env.installed("otelcol-contrib"))).toBe("755");
    expect(mode(env.installed("otel-collector-config.yaml"))).toBe("644");
    expect(mode(env.unit())).toBe("644");
    expect(mode(env.installed(".env"))).toBe("600");
  });

  test("makes .env root's alone before the settings go in, and the settings are what was typed", () => {
    const env = setup();
    install(env);
    expect(
      fs.readFileSync(path.join(env.stubs, "mode-at-edit"), "utf8").trim(),
    ).toBe("-rw-------");
    expect(mode(env.installed(".env"))).toBe("600");
    expect(fs.readFileSync(env.installed(".env"), "utf8")).toBe(`${ENV}\n`);
    expect(env.log("sudoedit")).toEqual([
      path.join(env.root, INSTALL_DIR, ".env"),
    ]);
  });

  test("starts the service, and has it start on every boot", () => {
    const env = setup();
    install(env);
    expect(env.log("systemctl")).toEqual([
      "daemon-reload",
      `enable ${SERVICE}`,
      `restart ${SERVICE}`,
    ]);
  });

  test("running it again keeps the settings", () => {
    const env = setup();
    install(env);
    install(env);
    expect(fs.readFileSync(env.installed(".env"), "utf8")).toBe(`${ENV}\n`);
    expect(mode(env.installed(".env"))).toBe("600");
  });

  test("stops at a release it cannot download, before anything is installed", () => {
    const env = setup({ arch: "armv7l" });
    const result = env.run(INSTALL);
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(path.join(env.root, INSTALL_DIR))).toBe(false);
    expect(fs.existsSync(env.unit())).toBe(false);
  });

  test("the upgrade replaces the binary, the config and the unit, keeps .env, and restarts", () => {
    const env = setup();
    install(env);
    // A config edit, a stale unit and a new build of the pinned release.
    fs.appendFileSync(env.installed("otel-collector-config.yaml"), "# edited\n");
    fs.writeFileSync(env.unit(), "[Unit]\nDescription=stale\n");
    writeRelease(env.releases, "amd64", "amd64-2");
    fs.rmSync(path.join(env.stubs, "systemctl.log"));

    const result = env.run(UPGRADE);
    expect(result.status).toBe(0);
    expect(
      spawnSync(env.installed("otelcol-contrib"), [], { encoding: "utf8" })
        .stdout,
    ).toBe("fake otelcol-contrib amd64-2\n");
    expect(fs.readFileSync(env.installed("otel-collector-config.yaml"), "utf8")).toBe(
      agentFile("otel-collector-config.yaml"),
    );
    expect(fs.readFileSync(env.unit(), "utf8")).toBe(agentFile(UNIT_FILE));
    expect(fs.readFileSync(env.installed(".env"), "utf8")).toBe(`${ENV}\n`);
    expect(mode(env.installed(".env"))).toBe("600");
    expect(env.log("systemctl")).toEqual([
      "daemon-reload",
      `restart ${SERVICE}`,
    ]);
    expect(env.log("sudoedit")).toHaveLength(1);
  });

  test("the uninstall removes the service and its folder, and nothing else", () => {
    const env = setup();
    install(env);
    fs.mkdirSync(path.join(env.root, "opt", "something-else"));
    fs.writeFileSync(path.join(env.root, UNIT_DIR, "other.service"), "");
    fs.rmSync(path.join(env.stubs, "systemctl.log"));

    const result = env.run(UNINSTALL);
    expect(result.status).toBe(0);
    expect(env.log("systemctl")).toEqual([
      `disable --now ${SERVICE}`,
      "daemon-reload",
    ]);
    expect(fs.existsSync(path.join(env.root, INSTALL_DIR))).toBe(false);
    expect(fs.existsSync(env.unit())).toBe(false);
    expect(fs.existsSync(path.join(env.root, "opt", "something-else"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(env.root, UNIT_DIR, "other.service"))).toBe(
      true,
    );
  });
});

describe(`agents/VMwareAgent/${UNIT_FILE}`, () => {
  const unit = agentFile(UNIT_FILE);

  function values(key) {
    return unit
      .split("\n")
      .filter((line) => {
        return line.startsWith(`${key}=`);
      })
      .map((line) => {
        return line.slice(key.length + 1);
      });
  }

  test("runs the binary and the config the docs install, with the .env they write", () => {
    expect(values("ExecStart")).toHaveLength(1);
    expect(values("ExecStart")[0]).toMatch(
      new RegExp(
        `^${INSTALL_DIR}/otelcol-contrib --config=${INSTALL_DIR}/otel-collector-config\\.yaml `,
      ),
    );
    expect(values("EnvironmentFile")).toEqual([`${INSTALL_DIR}/.env`]);
    expect(INSTALL).toContain(
      `-C ${INSTALL_DIR} otelcol-contrib`,
    );
    expect(INSTALL).toContain(
      `${INSTALL_DIR}/otel-collector-config.yaml`,
    );
    expect(INSTALL).toContain(`${UNIT_DIR}/${SERVICE}.service`);
  });

  test("gives the settings docker-compose.yml defaults the same defaults", () => {
    const compose = yaml.load(agentFile("docker-compose.yml"));
    const defaults = {};
    for (const entry of compose.services["oneuptime-vmware-agent"]
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
    expect(unitDefaults).toEqual(defaults);
    expect(Object.keys(defaults).length).toBe(3);
  });

  test("runs the collector as a throwaway user with no capabilities, its own metrics off port 8888", () => {
    expect(values("DynamicUser")).toEqual(["yes"]);
    expect(values("User")).toEqual([]);
    expect(values("CapabilityBoundingSet")).toEqual([""]);
    expect(values("NoNewPrivileges")).toEqual(["yes"]);
    expect(values("ProtectSystem")).toEqual(["strict"]);
    expect(values("ExecStart")[0]).toContain(
      '"--set=service::telemetry::metrics::readers=[{pull: {exporter: {prometheus: {host: 127.0.0.1, port: 8890}}}}]"',
    );
  });

  /*
   * systemd-analyze verify loads the unit as systemd would: an unknown
   * directive, a bad value or an ExecStart that is not executable fails it.
   * The unit's paths are moved under a scratch root with a stand-in binary.
   * Skipped without systemd, except in CI, where a check that cannot run must
   * not pass.
   */
  test("loads cleanly in systemd-analyze verify", () => {
    const which = spawnSync("sh", ["-c", "command -v systemd-analyze"], {
      encoding: "utf8",
    });
    if (which.status !== 0) {
      if (process.env.CI) {
        throw new Error(
          "systemd-analyze is not installed, and CI must verify the unit.",
        );
      }
      // eslint-disable-next-line no-console
      console.log("Skipped: systemd-analyze is not installed here.");
      return;
    }
    const dir = scratch();
    const root = path.join(dir, "root");
    fs.mkdirSync(path.join(root, INSTALL_DIR), { recursive: true });
    writeExecutable(
      path.join(root, INSTALL_DIR, "otelcol-contrib"),
      "#!/bin/sh\nexit 0\n",
    );
    fs.writeFileSync(path.join(root, INSTALL_DIR, ".env"), "");
    const file = path.join(dir, `${SERVICE}.service`);
    fs.writeFileSync(file, rooted(unit, root));

    const verify = spawnSync("systemd-analyze", ["verify", file], {
      encoding: "utf8",
    });
    expect({
      status: verify.status,
      output: `${verify.stdout}${verify.stderr}`.trim(),
    }).toEqual({ status: 0, output: "" });
  });
});

describe("troubleshoot.sh on an install without Docker", () => {
  function runDoctor(withBinary) {
    const dir = scratch();
    const installDir = path.join(dir, "agent");
    fs.mkdirSync(installDir);
    if (withBinary) {
      writeExecutable(
        path.join(installDir, "otelcol-contrib"),
        "#!/bin/sh\nexit 0\n",
      );
    }
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    // Any docker call is recorded; it answers like a daemon with no agent.
    writeExecutable(
      path.join(bin, "docker"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${dir}/docker.log"\nexit 0\n`,
    );
    const result = spawnSync(
      "bash",
      [
        path.join(AGENT_DIR, "troubleshoot.sh"),
        "-d",
        installDir,
        "--no-color",
        "--skip-egress",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        timeout: 60000,
      },
    );
    return {
      result,
      dockerCalls: fs.existsSync(path.join(dir, "docker.log"))
        ? fs.readFileSync(path.join(dir, "docker.log"), "utf8")
        : "",
    };
  }

  test("says it runs without Docker, where to look instead, and never calls docker", () => {
    const { result, dockerCalls } = runDoctor(true);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `runs without Docker, as the systemd service ${SERVICE} — this script checks Docker installs only.`,
    );
    expect(result.stdout).toContain(
      `systemctl status ${SERVICE} --no-pager`,
    );
    expect(result.stdout).toContain(
      `sudo journalctl -u ${SERVICE} -n 100 --no-pager`,
    );
    expect(result.stdout).toContain('"Installed without Docker"');
    expect(dockerCalls).toBe("");
  });

  test("a Docker install is diagnosed as before", () => {
    const { result, dockerCalls } = runDoctor(false);
    expect(result.stdout).not.toContain("runs without Docker");
    expect(dockerCalls).toContain("info");
  });

  test("the README section it points at exists", () => {
    expect(agentFile("README.md")).toContain("### Installed without Docker");
  });
});
