"use strict";

/**
 * The Proxmox and Ceph agents' install.sh, run for real in a scratch
 * directory with `docker`, `curl` and `ceph` replaced by recording stubs (no
 * daemon, network or cluster needed).
 *
 * Running either script again is the upgrade (the dialog beside an outdated
 * agent version offers exactly that), so a re-run must keep the answers:
 *  - every variable docker-compose.yml reads is read back from .env the way
 *    Docker Compose reads it (quoted or not), an exported variable still
 *    overrides it, and nothing is asked again — not the AI agent's
 *    questions, not the offer to create the Ceph client;
 *  - values are written quoted for Compose, so a cluster name with " #" or a
 *    token secret with $ or a quote reaches the containers as typed (checked
 *    against the real `docker compose config` where Docker Compose is
 *    installed, which CI requires);
 *  - a file the reader edited is kept as <file>.bak.<timestamp> (a sha256
 *    record tells an edit from an upgrade), the images are pulled (a failed
 *    pull is not fatal) and the containers recreated from .env alone, so the
 *    collector starts on the config the run just downloaded.
 *
 * Before, a re-run asked every question again and rewrote .env without
 * ONEUPTIME_AI_INVESTIGATION, ONEUPTIME_AI_FIXES or a hand-set
 * PVE_VERIFY_SSL: AI investigations turned off on a cluster came back on.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const URL = "https://oneuptime.example.com";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
const NEW_KEY = "7d0c2e1b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const TOKEN_ID = "monitoring@pam!oneuptime";
// A secret Compose would mangle unquoted: a $, a ' and a ".
const TOKEN_SECRET = `s3cr$t'x"y`;

const AGENTS = {
  proxmox: {
    dir: "ProxmoxAgent",
    installDir: "/opt/oneuptime-proxmox-agent",
    unit: "systemd/oneuptime-proxmox-agent.service",
  },
  ceph: {
    dir: "CephAgent",
    installDir: "/opt/oneuptime-ceph-agent",
    unit: "systemd/oneuptime-ceph-agent.service",
  },
};

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxmox-ceph-installer-"));
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

function agentFile(agent, name) {
  return fs.readFileSync(
    path.join(REPO_ROOT, "agents", AGENTS[agent].dir, name),
    "utf8",
  );
}

/*
 * `docker` records every call with the directory it ran in, fails
 * `compose pull` / `compose up` when $STUB_DIR/pull.fail / up.fail exists,
 * and at `compose up` keeps the environment Compose was handed and the
 * collector config it would mount. `curl` serves the agent's files from this
 * checkout, or from $SERVE_DIR when set (a newer upstream). `ceph` answers
 * as an admin node only when $STUB_DIR/ceph.works exists, and writes the
 * keyring `-o` names.
 */
function installStubs(dir, agent) {
  const bin = path.join(dir, "bin");
  if (fs.existsSync(bin)) {
    return bin;
  }
  fs.mkdirSync(bin);
  const agentDir = path.join(REPO_ROOT, "agents", AGENTS[agent].dir);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
case "$*" in
  "compose pull"*)
    [ -f "$STUB_DIR/pull.fail" ] && exit 1
    ;;
  "compose up"*)
    [ -f "$STUB_DIR/up.fail" ] && exit 1
    env | sort > "$STUB_DIR/env-at-up.txt"
    cp otel-collector-config.yaml "$STUB_DIR/config-at-up.yaml" 2>/dev/null || true
    ;;
esac
exit 0
`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
url=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
rel="\${url#https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/${AGENTS[agent].dir}/}"
served="\${SERVE_DIR:-${agentDir}}"
[ -f "$served/$rel" ] || exit 22
cp "$served/$rel" "$out"
`,
  );
  writeExecutable(
    path.join(bin, "ceph"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/ceph.log"
[ -f "$STUB_DIR/ceph.works" ] || exit 1
out=""; prev=""
for arg in "$@"; do
  [ "$prev" = "-o" ] && out="$arg"
  prev="$arg"
done
case "$1 $2" in
  "--connect-timeout 10") exit 0 ;;
  "config generate-minimal-conf")
    printf '[global]\\n\\tfsid = 0b6a4e39\\n\\tmon_host = [v2:10.0.0.1:3300]\\n'
    exit 0 ;;
  "auth get")
    [ -f "$STUB_DIR/ceph.client-exists" ] || exit 2
    [ -n "$out" ] && printf '[%s]\\n\\tkey = AQBexisting==\\n' "$3" > "$out"
    exit 0 ;;
  "auth get-or-create")
    printf '[%s]\\n\\tkey = AQBcreated==\\n' "$3" > "$out"
    exit 0 ;;
esac
exit 0
`,
  );
  return bin;
}

function install(agent, dir, { env = {}, input = "" } = {}) {
  const bin = installStubs(dir, agent);
  const installDir = path.join(dir, "agent");
  const result = spawnSync(
    "bash",
    [path.join(REPO_ROOT, "agents", AGENTS[agent].dir, "install.sh")],
    {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        STUB_DIR: dir,
        INSTALL_DIR: installDir,
        ...env,
      },
      input,
      encoding: "utf8",
      timeout: 60000,
    },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    installDir,
    envFile: readIfExists(path.join(installDir, ".env")),
    docker: readIfExists(path.join(dir, "docker.log")),
    ceph: readIfExists(path.join(dir, "ceph.log")),
  };
}

/* The .env as written: NAME -> raw value, in file order. */
function envLines(envFile) {
  const values = {};
  for (const line of envFile.split("\n").filter(Boolean)) {
    const at = line.indexOf("=");
    values[line.slice(0, at)] = line.slice(at + 1);
  }
  return values;
}

/* A written value as Docker Compose reads it. */
function composeRead(raw) {
  if (raw.startsWith("'")) {
    return raw.slice(1, raw.lastIndexOf("'"));
  }
  if (raw.startsWith('"')) {
    return raw
      .slice(1, raw.lastIndexOf('"'))
      .replace(/\\(["\\])/g, "$1")
      .replace(/\$\$/g, "$");
  }
  return raw;
}

function composeReadAll(envFile) {
  const values = {};
  for (const [name, raw] of Object.entries(envLines(envFile))) {
    values[name] = composeRead(raw);
  }
  return values;
}

/* Answers to the prompts, one per line, in the order install.sh asks. */
function answers(...lines) {
  return `${lines.join("\n")}\n`;
}

// The variables a script's ENV_NAMES list names.
function envNames(script) {
  const match = script.match(/^ENV_NAMES="([^"]+)"$/m);
  expect(match).not.toBeNull();
  return match[1].replace(/\\\n/g, " ").split(/\s+/).filter(Boolean);
}

// The variables the heredoc that writes .env sets, in order.
function writtenNames(script) {
  const heredoc = script.match(
    /cat > "\$ENV_FILE" <<ENVEOF\n([\s\S]*?)\nENVEOF/,
  );
  expect(heredoc).not.toBeNull();
  return heredoc[1].split("\n").map((line) => {
    return line.split("=")[0];
  });
}

// Every ${VAR} docker-compose.yml interpolates ($$ is a literal $).
function composeVariables(agent) {
  const compose = yaml.load(agentFile(agent, "docker-compose.yml"));
  const text = JSON.stringify(compose).replace(/\$\$/g, "");
  return [
    ...new Set(
      Array.from(text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)).map(
        (match) => {
          return match[1];
        },
      ),
    ),
  ].sort();
}

function shellFunction(script, name) {
  const start = script.indexOf(`\n${name}() {\n`);
  expect(start).toBeGreaterThan(-1);
  const end = script.indexOf("\n}\n", start);
  return script.slice(start + 1, end + 2);
}

function backupsIn(installDir) {
  return fs
    .readdirSync(installDir)
    .filter((file) => {
      return file.includes(".bak.");
    })
    .sort();
}

function composeCalls(docker) {
  return docker
    .split("\n")
    .filter((line) => {
      return line.includes(" | compose ") && !line.endsWith("| compose version");
    })
    .map((line) => {
      const [cwd, args] = line.split(" | ");
      return { cwd: fs.realpathSync(cwd), args };
    });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// A newer upstream whose config stamps a newer collector version.
function newerUpstream(agent) {
  const upstream = path.join(scratch(), "upstream");
  fs.cpSync(path.join(REPO_ROOT, "agents", AGENTS[agent].dir), upstream, {
    recursive: true,
  });
  const config = path.join(upstream, "otel-collector-config.yaml");
  const bumped = fs
    .readFileSync(config, "utf8")
    .replace(
      /- key: oneuptime\.agent\.version\n(\s+)value: "[^"]+"/,
      '- key: oneuptime.agent.version\n$1value: "0.999.0"',
    );
  expect(bumped).toContain('value: "0.999.0"');
  fs.writeFileSync(config, bumped);
  return upstream;
}

/*
 * The real Docker Compose, where it is installed: what it hands the
 * containers is the only proof that the quoting round-trips. CI (the Ops
 * workflow's runner has Docker) must run it; elsewhere it is skipped with
 * the reason logged, never passed.
 */
const COMPOSE_PROBE = spawnSync("docker", ["compose", "version"], {
  encoding: "utf8",
});
const HAS_COMPOSE = !COMPOSE_PROBE.error && COMPOSE_PROBE.status === 0;
const IN_CI = Boolean(process.env["CI"]);

if (!HAS_COMPOSE && !IN_CI) {
  console.log(
    "Docker Compose round-trip checks skipped: `docker compose` is not available here (the Ops workflow's runner has it).",
  );
}

function realComposeConfig(installDir) {
  if (!HAS_COMPOSE) {
    throw new Error(
      `CI is set but \`docker compose\` does not run (${
        COMPOSE_PROBE.error
          ? COMPOSE_PROBE.error.message
          : COMPOSE_PROBE.stderr
      }). This round-trip must not pass by skipping.`,
    );
  }
  const result = spawnSync("docker", ["compose", "config", "--format", "json"], {
    cwd: installDir,
    env: { PATH: process.env.PATH, HOME: installDir },
    encoding: "utf8",
    timeout: 60000,
  });
  if (result.status !== 0) {
    throw new Error(`docker compose config failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

// A service's environment as the container gets it (config prints $ as $$).
function serviceEnvironment(config, service) {
  const values = {};
  for (const [name, value] of Object.entries(
    config.services[service].environment,
  )) {
    values[name] = value === null ? "" : String(value).replace(/\$\$/g, "$");
  }
  return values;
}

/* ================================================================ Proxmox */

describe("agents/ProxmoxAgent/install.sh", () => {
  // URL, key, cluster name, API host, bundled exporter, token id and
  // secret, no fixes.
  const FRESH_BUNDLED = answers(
    URL,
    KEY,
    "pve prod #1",
    "192.168.1.10",
    "",
    TOKEN_ID,
    TOKEN_SECRET,
    "n",
  );

  test("a fresh install writes every variable the compose file reads, the user's values quoted, owner-only", () => {
    const dir = scratch();
    const run = install("proxmox", dir, { input: FRESH_BUNDLED });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toEqual({
      ONEUPTIME_URL: `'${URL}'`,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: `'${KEY}'`,
      // Unquoted, Compose would cut it at " #".
      PROXMOX_CLUSTER_NAME: "'pve prod #1'",
      PVE_HOST: "'192.168.1.10'",
      PVE_PORT: "''",
      PVE_EXPORTER_URL: "'pve-exporter:9221'",
      PVE_API_TOKEN_ID: `'${TOKEN_ID}'`,
      // A ' cannot be single-quoted: double quotes, \" and $$.
      PVE_API_TOKEN_SECRET: '"s3cr$$t\'x\\"y"',
      PVE_VERIFY_SSL: "''",
      PVE_CA_FILE: "''",
      COMPOSE_PROFILES: "'pve-exporter'",
      ONEUPTIME_AI_INVESTIGATION: "''",
      ONEUPTIME_AI_FIXES: "''",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
      ONEUPTIME_AI_PVE_API_TOKEN_ID: "''",
      ONEUPTIME_AI_PVE_API_TOKEN_SECRET: "''",
      ONEUPTIME_AI_WRITE_TARGETS: "''",
      ONEUPTIME_AI_PROTECTED_TARGETS: "''",
      ONEUPTIME_AI_AGENT_RESOURCE_NAME: "''",
      LOG_LEVEL: "''",
    });
    expect(composeReadAll(run.envFile).PVE_API_TOKEN_SECRET).toBe(TOKEN_SECRET);
    // It holds the token secret.
    expect(fs.statSync(path.join(run.installDir, ".env")).mode & 0o777).toBe(
      0o600,
    );
    expect(run.output).not.toContain(TOKEN_SECRET);
    expect(run.output).not.toContain("reusing it");
  });

  test("your own exporter: its address, no profile, and the AI agent's token question", () => {
    const dir = scratch();
    const run = install("proxmox", dir, {
      // ... no bundled exporter, its address, no token for the AI agent,
      // no fixes.
      input: answers(URL, KEY, "pve-prod", "192.168.1.10", "n", "10.0.0.5:9221", "", "n"),
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toMatchObject({
      PVE_EXPORTER_URL: "'10.0.0.5:9221'",
      COMPOSE_PROFILES: "''",
      PVE_API_TOKEN_ID: "''",
      PVE_API_TOKEN_SECRET: "''",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
    });
    expect(run.output).toContain("has no Proxmox API token");
  });

  test("answering yes to fixes asks for the fixes token and the protected guests, once", () => {
    const dir = scratch();
    const run = install("proxmox", dir, {
      input: answers(
        URL,
        KEY,
        "pve-prod",
        "192.168.1.10",
        "",
        TOKEN_ID,
        TOKEN_SECRET,
        "y",
        "oneuptime-ai@pve!fixes",
        "fixes-secret",
        "100,101",
      ),
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toMatchObject({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_PVE_API_TOKEN_ID: "'oneuptime-ai@pve!fixes'",
      ONEUPTIME_AI_PVE_API_TOKEN_SECRET: "'fixes-secret'",
      ONEUPTIME_AI_PROTECTED_TARGETS: "'100,101'",
    });
    expect(run.output).not.toContain("fixes-secret");
  });

  test("a re-run reuses every value without asking anything, and writes the same .env", () => {
    const dir = scratch();
    const first = install("proxmox", dir, { input: FRESH_BUNDLED });
    expect(first.status).toBe(0);

    // No input at all: any prompt would read EOF and stop the script.
    const second = install("proxmox", dir);

    expect(second.status).toBe(0);
    expect(second.output).toContain(
      `Found an existing configuration in ${path.join(second.installDir, ".env")} — reusing it.`,
    );
    expect(second.envFile).toBe(first.envFile);
    expect(second.output).not.toContain("The OneUptime AI agent lets");
  });

  /*
   * The .env the previous install.sh wrote: unquoted, and without the
   * values it dropped (it rewrote only what it asked for). A re-run reads
   * it as Compose does, and keeps a value set by hand.
   */
  test("a re-run reads an .env from the previous installer as typed and keeps hand-set values", () => {
    const dir = scratch();
    const installDir = path.join(dir, "agent");
    fs.mkdirSync(installDir);
    fs.writeFileSync(
      path.join(installDir, ".env"),
      [
        `ONEUPTIME_URL=${URL}`,
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
        "PROXMOX_CLUSTER_NAME=pve-prod",
        "PVE_HOST=192.168.1.10",
        "PVE_EXPORTER_URL=10.0.0.5:9221",
        `PVE_API_TOKEN_ID=${TOKEN_ID}`,
        "PVE_API_TOKEN_SECRET=0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6",
        "COMPOSE_PROFILES=",
        "ONEUPTIME_AI_INVESTIGATION=false",
        "ONEUPTIME_AI_FIXES=ask-for-approval",
        "ONEUPTIME_AI_ALLOW_WRITES=false",
        "ONEUPTIME_AI_PVE_API_TOKEN_ID=",
        "ONEUPTIME_AI_PVE_API_TOKEN_SECRET=",
        "ONEUPTIME_AI_WRITE_TARGETS=",
        "ONEUPTIME_AI_PROTECTED_TARGETS=",
        // Added by hand, after the guide's environment table.
        "PVE_VERIFY_SSL=true",
        "PVE_CA_FILE=/etc/oneuptime/pve-root-ca.pem",
        "LOG_LEVEL=debug  # while we look into it",
        "",
      ].join("\n"),
    );

    const run = install("proxmox", dir);

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile)).toEqual({
      ONEUPTIME_URL: URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
      PROXMOX_CLUSTER_NAME: "pve-prod",
      PVE_HOST: "192.168.1.10",
      PVE_PORT: "",
      PVE_EXPORTER_URL: "10.0.0.5:9221",
      PVE_API_TOKEN_ID: TOKEN_ID,
      PVE_API_TOKEN_SECRET: "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6",
      PVE_VERIFY_SSL: "true",
      PVE_CA_FILE: "/etc/oneuptime/pve-root-ca.pem",
      COMPOSE_PROFILES: "",
      ONEUPTIME_AI_INVESTIGATION: "false",
      ONEUPTIME_AI_FIXES: "ask-for-approval",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
      ONEUPTIME_AI_PVE_API_TOKEN_ID: "",
      ONEUPTIME_AI_PVE_API_TOKEN_SECRET: "",
      ONEUPTIME_AI_WRITE_TARGETS: "",
      ONEUPTIME_AI_PROTECTED_TARGETS: "",
      ONEUPTIME_AI_AGENT_RESOURCE_NAME: "",
      LOG_LEVEL: "debug",
    });
  });

  test("an exported variable still overrides the .env on a re-run, and is written back", () => {
    const dir = scratch();
    expect(install("proxmox", dir, { input: FRESH_BUNDLED }).status).toBe(0);

    const run = install("proxmox", dir, {
      env: { ONEUPTIME_TELEMETRY_INGESTION_KEY: NEW_KEY },
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile).ONEUPTIME_TELEMETRY_INGESTION_KEY).toBe(
      `'${NEW_KEY}'`,
    );
    expect(envLines(run.envFile).PROXMOX_CLUSTER_NAME).toBe("'pve prod #1'");
  });

  test("a Docker Compose guide's .env (the profile, no exporter address) keeps the bundled exporter without asking", () => {
    const dir = scratch();
    const installDir = path.join(dir, "agent");
    fs.mkdirSync(installDir);
    fs.writeFileSync(
      path.join(installDir, ".env"),
      [
        `ONEUPTIME_URL=${URL}`,
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
        "PROXMOX_CLUSTER_NAME='my-proxmox-cluster'",
        "PVE_HOST=192.168.1.10",
        `PVE_API_TOKEN_ID=${TOKEN_ID}`,
        "PVE_API_TOKEN_SECRET=your-token-secret",
        "COMPOSE_PROFILES=pve-exporter",
        "",
      ].join("\n"),
    );

    const run = install("proxmox", dir);

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toMatchObject({
      PVE_EXPORTER_URL: "'pve-exporter:9221'",
      COMPOSE_PROFILES: "'pve-exporter'",
      PROXMOX_CLUSTER_NAME: "'my-proxmox-cluster'",
    });
  });

  test("a re-run never asks the AI agent's questions: fixes stay as .env says, an older .env stays read-only", () => {
    const dir = scratch();
    // Fixes on, with no token of the AI agent's own and no protected guests:
    // the fresh install's answers, which a re-run must not ask again.
    const first = install("proxmox", dir, {
      input: answers(URL, KEY, "pve-prod", "192.168.1.10", "", TOKEN_ID, TOKEN_SECRET, "y", "", ""),
    });
    expect(first.status).toBe(0);
    expect(envLines(first.envFile).ONEUPTIME_AI_ALLOW_WRITES).toBe("true");

    const rerun = install("proxmox", dir);
    expect(rerun.status).toBe(0);
    expect(rerun.envFile).toBe(first.envFile);

    // An .env from before the AI agent existed: no write switch at all.
    const env = path.join(rerun.installDir, ".env");
    fs.writeFileSync(
      env,
      fs
        .readFileSync(env, "utf8")
        .split("\n")
        .filter((line) => {
          return !line.startsWith("ONEUPTIME_AI_");
        })
        .join("\n"),
    );
    const older = install("proxmox", dir);
    expect(older.status).toBe(0);
    expect(envLines(older.envFile).ONEUPTIME_AI_ALLOW_WRITES).toBe("false");
  });

  test("reads the bundled exporter's token secret without echo", () => {
    const script = agentFile("proxmox", "install.sh");
    expect(script).toContain(
      'read -rsp "Proxmox API token secret: " PVE_API_TOKEN_SECRET',
    );
    expect(script).not.toContain(
      'read -rp "Proxmox API token secret: " PVE_API_TOKEN_SECRET',
    );
  });
});

/* =================================================================== Ceph */

describe("agents/CephAgent/install.sh", () => {
  // URL, key, the default cluster name, the mgrs without brackets, no fixes.
  const FRESH = answers(URL, KEY, "", "mon1:9283,mon2:9283", "n");

  test("a fresh install wraps the mgr list in brackets and writes every variable quoted, owner-only", () => {
    const dir = scratch();
    const run = install("ceph", dir, { input: FRESH });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toEqual({
      ONEUPTIME_URL: `'${URL}'`,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: `'${KEY}'`,
      CEPH_CLUSTER_NAME: "'ceph'",
      CEPH_MGR_ENDPOINTS: "'[mon1:9283,mon2:9283]'",
      // A validated client name stays bare.
      CEPH_CLIENT_ID: "oneuptime-ai",
      ONEUPTIME_AI_INVESTIGATION: "''",
      ONEUPTIME_AI_FIXES: "''",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
      ONEUPTIME_AI_WRITE_TARGETS: "''",
      ONEUPTIME_AI_PROTECTED_TARGETS: "''",
      ONEUPTIME_AI_AGENT_RESOURCE_NAME: "''",
      LOG_LEVEL: "''",
    });
    expect(fs.statSync(path.join(run.installDir, ".env")).mode & 0o777).toBe(
      0o600,
    );
    // No ceph admin access here: the AI agent waits for its client.
    expect(run.output).toContain("waits for its Ceph client");
  });

  test("a re-run reuses every value without asking anything, and writes the same .env", () => {
    const dir = scratch();
    const first = install("ceph", dir, { input: FRESH });
    expect(first.status).toBe(0);

    const second = install("ceph", dir);

    expect(second.status).toBe(0);
    expect(second.output).toContain("reusing it.");
    expect(second.envFile).toBe(first.envFile);
  });

  test("a re-run reads an .env from the previous installer as typed and keeps hand-set values", () => {
    const dir = scratch();
    const installDir = path.join(dir, "agent");
    fs.mkdirSync(installDir);
    fs.writeFileSync(
      path.join(installDir, ".env"),
      [
        `ONEUPTIME_URL=${URL}`,
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
        "CEPH_CLUSTER_NAME=ceph-prod",
        "CEPH_MGR_ENDPOINTS=[mon1:9283,mon2:9283,mon3:9283]",
        "CEPH_CLIENT_ID=oneuptime-ai",
        "ONEUPTIME_AI_INVESTIGATION=false",
        "ONEUPTIME_AI_FIXES=off",
        "ONEUPTIME_AI_ALLOW_WRITES=true",
        "ONEUPTIME_AI_WRITE_TARGETS=osd.*",
        "ONEUPTIME_AI_PROTECTED_TARGETS=cluster",
        // Added by hand.
        "ONEUPTIME_AI_AGENT_RESOURCE_NAME=ceph-prod-ai",
        "LOG_LEVEL=warn",
        "",
      ].join("\n"),
    );

    const run = install("ceph", dir);

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile)).toEqual({
      ONEUPTIME_URL: URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
      CEPH_CLUSTER_NAME: "ceph-prod",
      CEPH_MGR_ENDPOINTS: "[mon1:9283,mon2:9283,mon3:9283]",
      CEPH_CLIENT_ID: "oneuptime-ai",
      ONEUPTIME_AI_INVESTIGATION: "false",
      ONEUPTIME_AI_FIXES: "off",
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_WRITE_TARGETS: "osd.*",
      ONEUPTIME_AI_PROTECTED_TARGETS: "cluster",
      ONEUPTIME_AI_AGENT_RESOURCE_NAME: "ceph-prod-ai",
      LOG_LEVEL: "warn",
    });
  });

  test("a re-run keeps its own Ceph client id", () => {
    const dir = scratch();
    const first = install("ceph", dir, {
      input: FRESH,
      env: { CEPH_CLIENT_ID: "client.ai-reader" },
    });
    expect(first.status).toBe(0);
    expect(envLines(first.envFile).CEPH_CLIENT_ID).toBe("ai-reader");

    const second = install("ceph", dir);
    expect(second.status).toBe(0);
    expect(envLines(second.envFile).CEPH_CLIENT_ID).toBe("ai-reader");
    expect(second.output).toContain("ceph.client.ai-reader.keyring");
  });

  test("a fresh install on an admin node offers the AI agent's client and creates it read-only", () => {
    const dir = scratch();
    fs.writeFileSync(path.join(dir, "ceph.works"), "");
    installStubs(dir, "ceph");

    const run = install("ceph", dir, { input: `${FRESH}\n` });

    expect(run.status).toBe(0);
    expect(run.ceph).toContain(
      "auth get-or-create client.oneuptime-ai mon allow r mgr allow r osd allow r -o",
    );
    const keyring = path.join(
      run.installDir,
      "ceph",
      "ceph.client.oneuptime-ai.keyring",
    );
    expect(fs.readFileSync(keyring, "utf8")).toContain("AQBcreated==");
    expect(fs.statSync(keyring).mode & 0o777).toBe(0o600);
    expect(
      fs.readFileSync(path.join(run.installDir, "ceph", "ceph.conf"), "utf8"),
    ).toContain("mon_host");
  });

  /*
   * The answer to "Create the AI agent's Ceph client?" is not in .env: a
   * re-run must not ask it again (an Enter would create a client the
   * reader declined), and must not create one without asking.
   */
  test("a re-run never offers to create the Ceph client, even on an admin node", () => {
    const dir = scratch();
    // The first install declined the client.
    fs.writeFileSync(path.join(dir, "ceph.works"), "");
    installStubs(dir, "ceph");
    const first = install("ceph", dir, { input: `${FRESH}n\n` });
    expect(first.status).toBe(0);
    expect(first.ceph).not.toContain("auth get-or-create");
    fs.rmSync(path.join(dir, "ceph.log"));

    const rerun = install("ceph", dir);

    expect(rerun.status).toBe(0);
    expect(rerun.ceph).toBe("");
    expect(
      fs.existsSync(
        path.join(rerun.installDir, "ceph", "ceph.client.oneuptime-ai.keyring"),
      ),
    ).toBe(false);
    expect(rerun.output).toContain("waits for its Ceph client");
  });

  test("an exported mgr list without brackets is wrapped, and Compose is started from .env alone", () => {
    const dir = scratch();
    expect(install("ceph", dir, { input: FRESH }).status).toBe(0);

    const run = install("ceph", dir, {
      env: { CEPH_MGR_ENDPOINTS: "mon7:9283,mon8:9283" },
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile).CEPH_MGR_ENDPOINTS).toBe(
      "'[mon7:9283,mon8:9283]'",
    );
    // Compose reads every managed variable from .env, so the first start
    // runs what every later `docker compose up` will.
    const atUp = readIfExists(path.join(dir, "env-at-up.txt"));
    expect(atUp).not.toMatch(/^CEPH_MGR_ENDPOINTS=/m);
  });
});

/* ======================================================== both installers */

describe.each([["proxmox"], ["ceph"]])("%s install.sh, as the upgrade", (agent) => {
  // The answers after the OneUptime URL and key.
  const REST =
    agent === "proxmox"
      ? ["pve-prod", "192.168.1.10", "", TOKEN_ID, TOKEN_SECRET, "n"]
      : ["ceph-prod", "mon1:9283", "n"];
  const FRESH = answers(URL, KEY, ...REST);

  test("pulls the images, then recreates the containers in the install directory", () => {
    const dir = scratch();
    const run = install(agent, dir, { input: FRESH });

    expect(run.status).toBe(0);
    const installDir = fs.realpathSync(run.installDir);
    expect(composeCalls(run.docker)).toEqual([
      { cwd: installDir, args: "compose pull" },
      { cwd: installDir, args: "compose up -d --force-recreate" },
    ]);
  });

  test("a failed pull is not fatal: the agent still starts on the images it has", () => {
    const dir = scratch();
    installStubs(dir, agent);
    fs.writeFileSync(path.join(dir, "pull.fail"), "");

    const run = install(agent, dir, { input: FRESH });

    expect(run.status).toBe(0);
    expect(run.output).toContain(
      "Warning: could not pull the latest images; starting with the ones this machine has.",
    );
    expect(run.docker).toContain("| compose up -d --force-recreate");
  });

  test("a failed start fails the script", () => {
    const dir = scratch();
    installStubs(dir, agent);
    fs.writeFileSync(path.join(dir, "up.fail"), "");

    const run = install(agent, dir, { input: FRESH });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("is running!");
  });

  test("Compose gets no variable from the script's environment: it reads them all from .env", () => {
    const dir = scratch();
    // The setup guide's command carries the URL and key in the environment.
    const run = install(agent, dir, {
      input: answers(...REST),
      env: { ONEUPTIME_URL: URL, ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY },
    });

    expect(run.status).toBe(0);
    const atUp = readIfExists(path.join(dir, "env-at-up.txt"));
    expect(atUp).toContain("STUB_DIR=");
    for (const name of envNames(agentFile(agent, "install.sh"))) {
      expect({ name, inEnvironment: new RegExp(`^${name}=`, "m").test(atUp) }).toEqual({
        name,
        inEnvironment: false,
      });
    }
  });

  test("a re-run starts the collector on the config it just downloaded", () => {
    const dir = scratch();
    expect(install(agent, dir, { input: FRESH }).status).toBe(0);

    const upstream = newerUpstream(agent);
    const upgraded = install(agent, dir, { env: { SERVE_DIR: upstream } });

    expect(upgraded.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "config-at-up.yaml"), "utf8")).toBe(
      fs.readFileSync(path.join(upstream, "otel-collector-config.yaml"), "utf8"),
    );
    // Nobody edited the files: replaced, no copies, no notes.
    expect(backupsIn(upgraded.installDir)).toEqual([]);
    expect(upgraded.output).not.toContain("NOTE:");
  });

  test("records a sha256 of every file it installed, and leaves nothing from the download behind", () => {
    const dir = scratch();
    const run = install(agent, dir, { input: FRESH });
    expect(run.status).toBe(0);

    const record = fs
      .readFileSync(path.join(run.installDir, ".agent-files.sha256"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        return line.split(/\s+/);
      });
    expect(
      record.map(([, file]) => {
        return file;
      }),
    ).toEqual(["docker-compose.yml", "otel-collector-config.yaml"]);
    for (const [hash, file] of record) {
      expect(hash).toBe(sha256(path.join(run.installDir, file)));
      // The collector reads its config as a non-root user.
      expect(fs.statSync(path.join(run.installDir, file)).mode & 0o777).toBe(
        0o644,
      );
    }
    expect(
      fs.readdirSync(run.installDir).filter((file) => {
        return file.includes(".download") || file.endsWith(".new");
      }),
    ).toEqual([]);
  });

  test("an upgrade keeps a file you edited as <file>.bak.<timestamp>, and says so", () => {
    const dir = scratch();
    expect(install(agent, dir, { input: FRESH }).status).toBe(0);
    const config = path.join(dir, "agent", "otel-collector-config.yaml");
    const edited = `${fs.readFileSync(config, "utf8")}# my edit\n`;
    fs.writeFileSync(config, edited);

    const upgraded = install(agent, dir, {
      env: { SERVE_DIR: newerUpstream(agent) },
    });

    expect(upgraded.status).toBe(0);
    const backups = backupsIn(upgraded.installDir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^otel-collector-config\.yaml\.bak\.\d{14}$/);
    expect(
      fs.readFileSync(path.join(upgraded.installDir, backups[0]), "utf8"),
    ).toBe(edited);
    expect(upgraded.output).toContain(
      "NOTE: you had edited these files since install.sh installed them.",
    );
    expect(upgraded.output).toContain(backups[0]);
    expect(upgraded.output).not.toContain("no record");
  });

  test("without a record (an agent installed by an older script), every file that differs is kept", () => {
    const dir = scratch();
    const first = install(agent, dir, { input: FRESH });
    expect(first.status).toBe(0);
    fs.rmSync(path.join(first.installDir, ".agent-files.sha256"));

    const upgraded = install(agent, dir, {
      env: { SERVE_DIR: newerUpstream(agent) },
    });

    expect(upgraded.status).toBe(0);
    // Only the config changed upstream.
    expect(
      backupsIn(upgraded.installDir).map((file) => {
        return file.replace(/\.bak\.\d{14}$/, "");
      }),
    ).toEqual(["otel-collector-config.yaml"]);
    expect(upgraded.output).toContain(
      "There was no record\nof what install.sh had installed",
    );
    expect(
      fs.existsSync(path.join(upgraded.installDir, ".agent-files.sha256")),
    ).toBe(true);
  });

  test("ends by saying that running it again is the upgrade", () => {
    const dir = scratch();
    const run = install(agent, dir, { input: FRESH });
    expect(run.status).toBe(0);
    expect(run.output).toContain(
      `To upgrade:       run this installer again; it reuses ${path.join(run.installDir, ".env")}`,
    );
  });
});

/* ===================================================== the scripts' shape */

describe.each([["proxmox"], ["ceph"]])("%s install.sh, statically", (agent) => {
  const script = agentFile(agent, "install.sh");

  test("keeps every variable docker-compose.yml reads, and writes exactly those", () => {
    const names = envNames(script);
    const expected = composeVariables(agent);
    if (agent === "proxmox") {
      // Compose itself reads which profiles to start from .env.
      expected.push("COMPOSE_PROFILES");
    }
    expect([...names].sort()).toEqual(expected.sort());
    expect(writtenNames(script)).toEqual(names);
  });

  test("quotes every value but the validated ones for Compose", () => {
    const bare = agent === "proxmox"
      ? ["ONEUPTIME_AI_ALLOW_WRITES"]
      : ["CEPH_CLIENT_ID", "ONEUPTIME_AI_ALLOW_WRITES"];
    const heredoc = script.match(
      /cat > "\$ENV_FILE" <<ENVEOF\n([\s\S]*?)\nENVEOF/,
    )[1];
    for (const name of envNames(script)) {
      const line = bare.includes(name)
        ? `${name}=$${name}`
        : `${name}=$(compose_env_quote "$${name}")`;
      expect(heredoc.split("\n")).toContain(line);
    }
  });

  test("reads an existing .env back with the helper VMware's installer uses", () => {
    const vmware = fs.readFileSync(
      path.join(REPO_ROOT, "agents/VMwareAgent/install.sh"),
      "utf8",
    );
    for (const name of ["compose_env_quote", "dotenv_get"]) {
      expect(shellFunction(script, name)).toBe(shellFunction(vmware, name));
    }
    expect(script).toContain(
      'printf -v "$name" \'%s\' "$(dotenv_get "$name" "$ENV_FILE")"',
    );
  });

  test("keeps edited files with the helper the Database agent's installer uses", () => {
    const database = fs.readFileSync(
      path.join(REPO_ROOT, "agents/DatabaseAgent/install.sh"),
      "utf8",
    );
    for (const name of ["file_sha256", "download_agent_file"]) {
      expect(shellFunction(script, name)).toBe(shellFunction(database, name));
    }
  });

  test("starts the agent once, recreating it, so a re-run runs the files it downloaded", () => {
    const starts = script.split("\n").filter((line) => {
      return /^\s*docker compose up\b/.test(line);
    });
    expect(starts).toEqual(["    docker compose up -d --force-recreate"]);
  });

  test("installs where the systemd unit and the doctor script look", () => {
    const installDir = AGENTS[agent].installDir;
    expect(script).toContain(`INSTALL_DIR="\${INSTALL_DIR:-${installDir}}"`);
    expect(agentFile(agent, AGENTS[agent].unit)).toContain(
      `WorkingDirectory=${installDir}\n`,
    );
    expect(agentFile(agent, "troubleshoot.sh")).toContain(`DIR="${installDir}"`);
  });

  test("the doctor reads a quoted .env the way install.sh writes it", () => {
    const vmware = fs.readFileSync(
      path.join(REPO_ROOT, "agents/VMwareAgent/troubleshoot.sh"),
      "utf8",
    );
    const doctor = agentFile(agent, "troubleshoot.sh");
    expect(shellFunction(doctor, "dotenv_get")).toBe(
      shellFunction(vmware, "dotenv_get"),
    );
    expect(doctor).toContain('v=$(dotenv_get "$1" "$ENV_FILE")');
    expect(doctor).not.toContain('sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE"');
  });

  test("passes bash -n", () => {
    const result = spawnSync("bash", ["-n", "-c", script], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

/* ========================================== what the real Compose reads */

describe("the .env the installers write, as the real Docker Compose reads it (required in CI)", () => {
  const maybe = HAS_COMPOSE || IN_CI ? test : test.skip;

  maybe("Proxmox: the profile starts the bundled exporter and every value reaches its container as typed", () => {
    const dir = scratch();
    const run = install("proxmox", dir, {
      input: answers(URL, KEY, "pve prod #1", "192.168.1.10", "", TOKEN_ID, TOKEN_SECRET, "n"),
    });
    expect(run.status).toBe(0);

    const config = realComposeConfig(run.installDir);
    expect(Object.keys(config.services).sort()).toEqual([
      "oneuptime-proxmox-agent",
      "oneuptime-proxmox-ai-agent",
      "pve-exporter",
    ]);
    expect(serviceEnvironment(config, "oneuptime-proxmox-agent")).toMatchObject({
      ONEUPTIME_URL: URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
      PROXMOX_CLUSTER_NAME: "pve prod #1",
      PVE_HOST: "192.168.1.10",
      PVE_EXPORTER_URL: "pve-exporter:9221",
    });
    expect(serviceEnvironment(config, "pve-exporter")).toMatchObject({
      PVE_API_TOKEN_ID: TOKEN_ID,
      PVE_TOKEN_VALUE: TOKEN_SECRET,
      PVE_VERIFY_SSL: "false",
    });
    expect(serviceEnvironment(config, "oneuptime-proxmox-ai-agent")).toMatchObject({
      PVE_API_TOKEN_SECRET: TOKEN_SECRET,
      ONEUPTIME_AI_ALLOW_WRITES: "false",
      LOG_LEVEL: "info",
    });
  });

  maybe("Proxmox: your own exporter starts no bundled one", () => {
    const dir = scratch();
    const run = install("proxmox", dir, {
      input: answers(URL, KEY, "pve-prod", "192.168.1.10", "n", "10.0.0.5:9221", "", "n"),
    });
    expect(run.status).toBe(0);

    const config = realComposeConfig(run.installDir);
    expect(Object.keys(config.services)).not.toContain("pve-exporter");
    expect(serviceEnvironment(config, "oneuptime-proxmox-agent").PVE_EXPORTER_URL).toBe(
      "10.0.0.5:9221",
    );
  });

  maybe("Ceph: the bracketed mgr list and a protected-target list with spaces reach the containers as typed", () => {
    const dir = scratch();
    const run = install("ceph", dir, {
      input: answers(URL, KEY, "ceph #prod", "mon1:9283,mon2:9283", "n"),
      env: { ONEUPTIME_AI_PROTECTED_TARGETS: "osd.0, osd.1 #hot" },
    });
    expect(run.status).toBe(0);

    const config = realComposeConfig(run.installDir);
    expect(serviceEnvironment(config, "oneuptime-ceph-agent")).toMatchObject({
      CEPH_CLUSTER_NAME: "ceph #prod",
      CEPH_MGR_ENDPOINTS: "[mon1:9283,mon2:9283]",
    });
    expect(serviceEnvironment(config, "oneuptime-ceph-ai-agent")).toMatchObject({
      CEPH_CLIENT_ID: "oneuptime-ai",
      ONEUPTIME_AI_PROTECTED_TARGETS: "osd.0, osd.1 #hot",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
    });
  });
});
