"use strict";

/**
 * The Storage Array Agent's install.sh and troubleshoot.sh, run for real in a
 * scratch directory with `docker` and `curl` replaced by recording stubs (no
 * daemon, network or array needed).
 *
 * install.sh: the array type the user picks decides three things that must
 * agree — the collector config compose mounts, the compose profile that
 * starts the exporter that config scrapes, and the platform stamped as
 * storage.system. It writes them, and the user's values quoted for Compose,
 * into a private .env; a re-run reuses that .env without asking again, keeps
 * an edited file before replacing it, stops every profile's exporter before
 * starting what .env selects, and recreates the containers, so the collector
 * starts on the config the run just downloaded (and reports the
 * oneuptime.agent.version that config stamps).
 *
 * troubleshoot.sh: its array probe asks the array the way the collector
 * does — the native endpoint with namespace=purefa, Pure's exporter with
 * endpoint=<array>, or NetApp Harvest on the compose network — and names
 * the cause: a refused API token, a FlashArray without the native
 * endpoint, an exporter whose profile is off, a certificate the collector
 * does not trust, Harvest serving nothing of the cluster. The API token
 * reaches curl on stdin, never on a command line, and an ONTAP user's
 * password never leaves .env and the container.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "StorageArrayAgent");
const INGESTION_KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
const FA_TOKEN = "3bc8f0a2-6d1e-4c57-9a0b-1f2e3d4c5b6a";
const FB_TOKEN = "T-7d0c2e1b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
// An ONTAP user's password: only Harvest reads it, so a $ and a space are fine.
const ONTAP_PASSWORD = "Harvest-r3ad$only pass";

/*
 * What install.sh downloads besides the compose file: every config, then
 * every platform's other files, in the PLATFORMS table's order (Dell's
 * exporter and syslog collector, then NetApp Harvest's).
 */
const CONFIG_FILES = [
  "otel-collector-config.yaml",
  "otel-collector-config.flasharray-exporter.yaml",
  "otel-collector-config.flashblade.yaml",
  "otel-collector-config.powerstore.yaml",
  "otel-collector-config.netapp-ontap.yaml",
];
const HARVEST_FILES = [
  "netapp-harvest.yml",
  "netapp-harvest-rest.yaml",
  "netapp-harvest-keyperf.yaml",
  "netapp-harvest-restperf.yaml",
];
const OTHER_FILES = [
  "powerstore-exporter.Dockerfile",
  "powerstore-syslog.yaml",
  ...HARVEST_FILES,
];
const INSTALLED_FILES = ["docker-compose.yml", ...CONFIG_FILES, ...OTHER_FILES];

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-array-agent-"));
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

/* ------------------------------------------------------------ install.sh */

/*
 * `docker` records every call with the directory it ran in, fails
 * `compose up` when $STUB_DIR/up.fail exists, and otherwise keeps the native
 * config as `compose up` found it in $STUB_DIR/config-at-up.yaml. It is also
 * the engine's containers, in $STUB_DIR/containers (one line per container:
 * name, the directory whose compose project runs it, id). A directory's
 * project is its name, as Compose writes it (lower case, a-z 0-9 _ -, no
 * leading _ or -), so two directories of one name are one project, as they
 * are to Compose. `compose up` gives the agent the name Compose would - the
 * docker-compose.yml's container_name, a ${VAR:-default} read from the
 * environment, else .env - and refuses, as Docker does, a name another
 * project's container holds; `compose up` and `compose down` remove the
 * project's containers first; `compose ps -a -q`, `ps -a --filter
 * label=com.docker.compose.project=...` (the working directories) and
 * `inspect -f {{.Name}}` answer from it. Every directory of $STUB_DIR shares
 * it: one machine. `curl` serves the agent's files the way the OneUptime at
 * ONEUPTIME_URL does, at <ONEUPTIME_URL>/install/storage-array-agent/<file>,
 * from this checkout or from $SERVE_DIR when set (a newer release):
 * Utils/AgentFilesCurlStub.
 */
function installStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
REGISTRY="$STUB_DIR/containers"
touch "$REGISTRY"
id_of() { printf '%s' "$1" | sha256sum | cut -c1-12; }
# A directory's Compose project: its name, as Compose writes it.
PROJECT_OF='function project(dir,  base) { base = dir; sub(/.*\\//, "", base); base = tolower(base); gsub(/[^a-z0-9_-]/, "", base); sub(/^[-_]+/, "", base); return base }'
# Every container but this directory's project's.
without_this_project() {
  awk -F '\\t' -v here="$PWD" "$PROJECT_OF"' project($2) != project(here)' "$REGISTRY" > "$REGISTRY.new"
  mv "$REGISTRY.new" "$REGISTRY"
}
# The agent's container name as Compose reads ./docker-compose.yml: written
# out, or \${VAR:-default} from the environment, else from ./.env.
agent_container_name() {
  local value var fallback
  value="$(grep -m 1 '^    container_name:' docker-compose.yml 2>/dev/null)"
  value="\${value#*container_name: }"
  case "$value" in
    '\${'*':-'*'}')
      var="\${value#??}"
      var="\${var%%:-*}"
      fallback="\${value#*:-}"
      fallback="\${fallback%\\}}"
      value="\${!var}"
      if [ -z "$value" ] && [ -f .env ]; then
        value="$(sed -n "s/^$var=//p" .env | tail -n 1)"
        value="\${value#\\'}"
        value="\${value%\\'}"
      fi
      [ -n "$value" ] || value="$fallback"
      ;;
  esac
  printf '%s' "$value"
}
case "$*" in
  "compose up"*)
    [ -f "$STUB_DIR/up.fail" ] && exit 1
    cp otel-collector-config.yaml "$STUB_DIR/config-at-up.yaml" 2>/dev/null || true
    name="$(agent_container_name)"
    holder="$(awk -F '\\t' -v name="$name" -v here="$PWD" "$PROJECT_OF"' $1 == name && project($2) != project(here) { print $2 }' "$REGISTRY")"
    if [ -n "$holder" ]; then
      echo "Error response from daemon: Conflict. The container name \\"/$name\\" is already in use by container \\"$(id_of "$name|$holder")\\". You have to remove (or rename) that container to be able to reuse that name." >&2
      exit 1
    fi
    without_this_project
    printf '%s\\t%s\\t%s\\n' "$name" "$PWD" "$(id_of "$name|$PWD")" >> "$REGISTRY"
    ;;
  "compose "*"down"*)
    without_this_project
    ;;
  "compose ps -a -q oneuptime-storage-array-agent")
    awk -F '\\t' -v here="$PWD" "$PROJECT_OF"' project($2) == project(here) { print $3 }' "$REGISTRY"
    ;;
  "ps -a --filter label=com.docker.compose.project="*)
    want="\${4#label=com.docker.compose.project=}"
    awk -F '\\t' -v want="$want" "$PROJECT_OF"' project($2) == want { print $2 }' "$REGISTRY"
    ;;
  "inspect -f {{.Name}} "*)
    id="\${!#}"
    name="$(awk -F '\\t' -v id="$id" '$3 == id { print $1 }' "$REGISTRY")"
    if [ -z "$name" ]; then
      echo "Error: No such object: $id" >&2
      exit 1
    fi
    printf '/%s\\n' "$name"
    ;;
esac
exit 0
`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    agentFilesCurlStub({
      installName: "storage-array-agent",
      agentDirectory: "StorageArrayAgent",
      servedDir: AGENT_DIR,
    }),
  );
  return bin;
}

/*
 * install.sh into <dir>/<installDirName>: "agent" unless given, a directory
 * other than the default one, so the agent is named after it.
 */
function install(dir, { env = {}, input = "", installDirName = "agent" } = {}) {
  const bin = fs.existsSync(path.join(dir, "bin"))
    ? path.join(dir, "bin")
    : installStubs(dir);
  const installDir = path.join(dir, installDirName);
  const result = spawnSync("bash", [path.join(AGENT_DIR, "install.sh")], {
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
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    installDir,
    envFile: readIfExists(path.join(installDir, ".env")),
    docker: readIfExists(path.join(dir, "docker.log")),
  };
}

/* The .env as Compose reads it: NAME → raw value as written. */
function envLines(envFile) {
  const values = {};
  for (const line of envFile.split("\n").filter(Boolean)) {
    const at = line.indexOf("=");
    values[line.slice(0, at)] = line.slice(at + 1);
  }
  return values;
}

/* Answers to the prompts, one per line, in the order install.sh asks. */
function answers(...lines) {
  return `${lines.join("\n")}\n`;
}

describe("agents/StorageArrayAgent/install.sh", () => {
  test("a FlashArray with native metrics: the default config, no profile, the FlashArray platform", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        "https://oneuptime.example.com/",
        INGESTION_KEY,
        "1",
        "fa-prod-01",
        "https://fa-prod-01.example.com/",
        FA_TOKEN,
        "",
      ),
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toEqual({
      // The trailing slash goes: the collector appends /otlp itself.
      ONEUPTIME_URL: "'https://oneuptime.example.com'",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: `'${INGESTION_KEY}'`,
      STORAGE_ARRAY_NAME: "'fa-prod-01'",
      STORAGE_SYSTEM: "purestorage.flasharray",
      STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
      COMPOSE_PROFILES: "",
      // Scheme and path go: the collector wants the bare address.
      PURE_FA_ENDPOINT: "'fa-prod-01.example.com'",
      PURE_FA_API_TOKEN: `'${FA_TOKEN}'`,
      PURE_FB_ENDPOINT: "''",
      PURE_FB_API_TOKEN: "''",
      // Every other platform's settings stay empty: switching is an .env edit.
      POWERSTORE_ENDPOINT: "''",
      POWERSTORE_PASSWORD: "''",
      POWERSTORE_USERNAME: "''",
      POWERSTORE_BULK_METRICS: "''",
      POWERSTORE_API_VERSION: "''",
      POWERSTORE_REQUEST_LIMIT: "''",
      POWERSTORE_SYSLOG_PORT: "''",
      NETAPP_ONTAP_ENDPOINT: "''",
      NETAPP_ONTAP_USERNAME: "''",
      NETAPP_ONTAP_PASSWORD: "''",
      STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      // Named after its directory, <scratch>/agent: not the default one.
      STORAGE_ARRAY_AGENT_CONTAINER_NAME:
        "'oneuptime-storage-array-agent-agent'",
    });
    // It holds the array's API token.
    expect(fs.statSync(path.join(run.installDir, ".env")).mode & 0o777).toBe(
      0o600,
    );
    // The token was read without echo.
    expect(run.output).not.toContain(FA_TOKEN);
  });

  test("downloads the compose file, every config and every platform's other files, so switching the array type is an .env edit", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
        STORAGE_ARRAY_NAME: "fa-prod-01",
        PURE_FA_ENDPOINT: "fa-prod-01.example.com",
        PURE_FA_API_TOKEN: FA_TOKEN,
        STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      },
    });

    expect(run.status).toBe(0);
    for (const file of INSTALLED_FILES) {
      expect(fs.readFileSync(path.join(run.installDir, file), "utf8")).toBe(
        fs.readFileSync(path.join(AGENT_DIR, file), "utf8"),
      );
    }
  });

  test("downloads every file from the OneUptime it reports to, and points the diagnostic there", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com/",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
        STORAGE_ARRAY_NAME: "fa-prod-01",
        PURE_FA_ENDPOINT: "fa-prod-01.example.com",
        PURE_FA_API_TOKEN: FA_TOKEN,
        STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      },
    });
    const served = "https://oneuptime.example.com/install/storage-array-agent";
    const requested = fs
      .readFileSync(path.join(dir, "curl.log"), "utf8")
      .split("\n")
      .filter((line) => {
        return line.includes(" -w ");
      })
      .map((line) => {
        return line.split(" ").pop();
      });

    expect(run.status).toBe(0);
    expect(requested).toEqual(
      INSTALLED_FILES.map((file) => {
        return `${served}/${file}`;
      }),
    );
    expect(run.output).toContain(
      `If nothing shows up: curl -fsSL ${served}/troubleshoot.sh | bash -s -- -d ${run.installDir}`,
    );
    expect(run.output).not.toContain("raw.githubusercontent.com");
  });

  test("an older OneUptime's own page (HTTP 200, HTML) is never saved as a config: the files come from GitHub", () => {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(
      path.join(dir, "oneuptime.answer"),
      "200 text/html; charset=utf-8",
    );
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
        STORAGE_ARRAY_NAME: "fa-prod-01",
        PURE_FA_ENDPOINT: "fa-prod-01.example.com",
        PURE_FA_API_TOKEN: FA_TOKEN,
        STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      },
    });

    expect(run.status).toBe(0);
    expect(run.output).toContain("Downloading them from GitHub instead.");
    for (const file of INSTALLED_FILES) {
      expect(fs.readFileSync(path.join(run.installDir, file), "utf8")).toBe(
        fs.readFileSync(path.join(AGENT_DIR, file), "utf8"),
      );
    }
  });

  test("stops every profile's exporter in the install directory, then starts what .env selects", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
        STORAGE_ARRAY_NAME: "fa-prod-01",
        PURE_FA_ENDPOINT: "fa-prod-01.example.com",
        PURE_FA_API_TOKEN: FA_TOKEN,
        STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      },
    });

    const calls = run.docker
      .split("\n")
      .filter((line) => {
        return (
          line.includes("| compose ") && !line.endsWith("| compose version")
        );
      })
      .map((line) => {
        const [cwd, args] = line.split(" | ");
        return { cwd: fs.realpathSync(cwd), args };
      });
    const installDir = fs.realpathSync(run.installDir);
    expect(calls).toEqual([
      {
        cwd: installDir,
        args: "compose --profile flasharray-exporter --profile flashblade --profile powerstore --profile netapp-ontap down --remove-orphans",
      },
      { cwd: installDir, args: "compose up -d --force-recreate" },
    ]);
  });

  test("an older FlashArray: the exporter config and the flasharray-exporter profile, and no TLS question", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        "https://oneuptime.example.com",
        INGESTION_KEY,
        "2",
        "fa-legacy",
        "10.0.0.20",
        FA_TOKEN,
      ),
    });

    expect(run.status).toBe(0);
    const values = envLines(run.envFile);
    expect(values.STORAGE_ARRAY_COLLECTOR_CONFIG).toBe(
      "otel-collector-config.flasharray-exporter.yaml",
    );
    expect(values.COMPOSE_PROFILES).toBe("flasharray-exporter");
    expect(values.STORAGE_SYSTEM).toBe("purestorage.flasharray");
    expect(values.PURE_FA_ENDPOINT).toBe("'10.0.0.20'");
    expect(run.output).not.toContain("Verify the array's certificate");
  });

  test("a FlashBlade: the FlashBlade config, its profile, the FlashBlade platform and the PURE_FB_* pair", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        "https://oneuptime.example.com",
        INGESTION_KEY,
        "3",
        "fb-prod",
        "fb-prod.example.com",
        FB_TOKEN,
      ),
    });

    expect(run.status).toBe(0);
    const values = envLines(run.envFile);
    expect(values).toMatchObject({
      STORAGE_SYSTEM: "purestorage.flashblade",
      STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.flashblade.yaml",
      COMPOSE_PROFILES: "flashblade",
      PURE_FB_ENDPOINT: "'fb-prod.example.com'",
      PURE_FB_API_TOKEN: `'${FB_TOKEN}'`,
      PURE_FA_ENDPOINT: "''",
      PURE_FA_API_TOKEN: "''",
    });
  });

  test("an ONTAP cluster: the ONTAP config, its profile, the ONTAP platform, and the user and password Harvest logs in with", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        "https://oneuptime.example.com",
        INGESTION_KEY,
        "5",
        "ontap-prod-01",
        "https://ontap-prod-01.example.com/",
        "oneuptime",
        ONTAP_PASSWORD,
        "",
      ),
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toEqual({
      ONEUPTIME_URL: "'https://oneuptime.example.com'",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: `'${INGESTION_KEY}'`,
      STORAGE_ARRAY_NAME: "'ontap-prod-01'",
      STORAGE_SYSTEM: "netapp.ontap",
      STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.netapp-ontap.yaml",
      COMPOSE_PROFILES: "netapp-ontap",
      PURE_FA_ENDPOINT: "''",
      PURE_FA_API_TOKEN: "''",
      PURE_FB_ENDPOINT: "''",
      PURE_FB_API_TOKEN: "''",
      // Every other platform's settings are written too, empty.
      POWERSTORE_ENDPOINT: "''",
      POWERSTORE_PASSWORD: "''",
      POWERSTORE_USERNAME: "''",
      POWERSTORE_BULK_METRICS: "''",
      POWERSTORE_API_VERSION: "''",
      POWERSTORE_REQUEST_LIMIT: "''",
      POWERSTORE_SYSLOG_PORT: "''",
      // Scheme and path go: Harvest wants the bare address.
      NETAPP_ONTAP_ENDPOINT: "'ontap-prod-01.example.com'",
      NETAPP_ONTAP_USERNAME: "'oneuptime'",
      // Single-quoted: Compose hands Harvest exactly what was typed.
      NETAPP_ONTAP_PASSWORD: `'${ONTAP_PASSWORD}'`,
      STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      STORAGE_ARRAY_AGENT_CONTAINER_NAME:
        "'oneuptime-storage-array-agent-agent'",
    });
    // It holds the user's password, read without echo.
    expect(fs.statSync(path.join(run.installDir, ".env")).mode & 0o777).toBe(
      0o600,
    );
    expect(run.output).not.toContain(ONTAP_PASSWORD);
    // Harvest talks TLS to the cluster, so the certificate question is asked.
    expect(run.output).toContain(
      "ONTAP clusters ship a self-signed certificate, which the agent cannot verify.",
    );
    expect(run.output).toContain(
      "If nothing shows up: curl -fsSL https://oneuptime.example.com/install/storage-array-agent/troubleshoot.sh",
    );
    for (const file of HARVEST_FILES) {
      expect(fs.readFileSync(path.join(run.installDir, file), "utf8")).toBe(
        fs.readFileSync(path.join(AGENT_DIR, file), "utf8"),
      );
    }
  });

  test("an ONTAP password with a quote is written for Compose and read back exactly on a re-run", () => {
    const dir = scratch();
    const password = `it's$1"x`;
    const first = install(dir, {
      input: answers(
        "https://oneuptime.example.com",
        INGESTION_KEY,
        "5",
        "ontap-prod-01",
        "ontap-prod-01.example.com",
        "oneuptime",
        password,
        "y",
      ),
    });

    expect(first.status).toBe(0);
    // A ' cannot be single-quoted: double quotes, with \" and $$.
    expect(envLines(first.envFile).NETAPP_ONTAP_PASSWORD).toBe(
      '"it\'s$$1\\"x"',
    );
    expect(envLines(first.envFile).STORAGE_ARRAY_INSECURE_SKIP_VERIFY).toBe(
      "false",
    );
    expect(first.output).not.toContain(password);

    // No input at all: any prompt would read EOF and stop the script.
    const second = install(dir);
    expect(second.status).toBe(0);
    expect(second.output).toContain("reusing it");
    expect(second.envFile).toBe(first.envFile);
  });

  test("STORAGE_SYSTEM=netapp.ontap picks the ONTAP config without asking", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_SYSTEM: "netapp.ontap",
        STORAGE_ARRAY_NAME: "ontap-prod-01",
        NETAPP_ONTAP_ENDPOINT: "ontap-prod-01.example.com",
        NETAPP_ONTAP_USERNAME: "oneuptime",
        NETAPP_ONTAP_PASSWORD: ONTAP_PASSWORD,
        STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      },
    });

    expect(run.status).toBe(0);
    expect(run.output).not.toContain("Which array does this agent monitor?");
    expect(envLines(run.envFile)).toMatchObject({
      STORAGE_SYSTEM: "netapp.ontap",
      STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.netapp-ontap.yaml",
      COMPOSE_PROFILES: "netapp-ontap",
      NETAPP_ONTAP_PASSWORD: `'${ONTAP_PASSWORD}'`,
    });
  });

  test("STORAGE_SYSTEM=purestorage.flashblade picks the FlashBlade config without asking", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_SYSTEM: "purestorage.flashblade",
        STORAGE_ARRAY_NAME: "fb-prod",
        PURE_FB_ENDPOINT: "fb-prod.example.com",
        PURE_FB_API_TOKEN: FB_TOKEN,
      },
    });

    expect(run.status).toBe(0);
    expect(run.output).not.toContain("Which array does this agent monitor?");
    expect(envLines(run.envFile).COMPOSE_PROFILES).toBe("flashblade");
  });

  test("answering yes to the certificate question keeps TLS verification on", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        "https://oneuptime.example.com",
        INGESTION_KEY,
        "1",
        "fa-prod-01",
        "fa-prod-01.example.com",
        FA_TOKEN,
        "y",
      ),
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile).STORAGE_ARRAY_INSECURE_SKIP_VERIFY).toBe(
      "false",
    );
  });

  test("a re-run reuses every value in .env without asking, read back exactly as Compose reads it", () => {
    const dir = scratch();
    const first = install(dir, {
      input: answers(
        "https://oneuptime.example.com",
        INGESTION_KEY,
        "1",
        // Compose would cut an unquoted value at " #": it must stay quoted.
        "fa prod #1",
        "fa-prod-01.example.com",
        FA_TOKEN,
        "",
      ),
    });
    expect(first.status).toBe(0);
    expect(envLines(first.envFile).STORAGE_ARRAY_NAME).toBe("'fa prod #1'");

    // No input at all: any prompt would read EOF and stop the script.
    const second = install(dir);
    expect(second.status).toBe(0);
    expect(second.output).toContain("reusing it");
    expect(second.envFile).toBe(first.envFile);
  });

  test("keeps an edited file before replacing it, and says where", () => {
    const dir = scratch();
    const env = {
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
      STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
      STORAGE_ARRAY_NAME: "fa-prod-01",
      PURE_FA_ENDPOINT: "fa-prod-01.example.com",
      PURE_FA_API_TOKEN: FA_TOKEN,
      STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
    };
    expect(install(dir, { env }).status).toBe(0);

    const config = path.join(dir, "agent", "otel-collector-config.yaml");
    const edited = `${fs.readFileSync(config, "utf8")}# my edit\n`;
    fs.writeFileSync(config, edited);

    const run = install(dir, { env });
    expect(run.status).toBe(0);
    const backups = fs.readdirSync(run.installDir).filter((file) => {
      return file.startsWith("otel-collector-config.yaml.bak.");
    });
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(run.installDir, backups[0]), "utf8")).toBe(
      edited,
    );
    expect(fs.readFileSync(config, "utf8")).toBe(
      fs.readFileSync(
        path.join(AGENT_DIR, "otel-collector-config.yaml"),
        "utf8",
      ),
    );
    expect(run.output).toContain(backups[0]);
    // Files nobody edited are not backed up.
    expect(
      fs.readdirSync(run.installDir).filter((file) => {
        return file.includes(".bak.");
      }),
    ).toHaveLength(1);
  });

  /*
   * A re-run is the upgrade, and what it downloads may change only the
   * collector config — the oneuptime.agent.version it stamps, say. Compose
   * recreates a running container only when its service definition or
   * environment changed, never for a bind-mounted file's content, and the
   * collector reads its config only when it starts: every run recreates the
   * containers, so the collector starts on the config just downloaded.
   */
  test("a re-run recreates the agent on the config it just downloaded", () => {
    const dir = scratch();
    const env = {
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
      STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
      STORAGE_ARRAY_NAME: "fa-prod-01",
      PURE_FA_ENDPOINT: "fa-prod-01.example.com",
      PURE_FA_API_TOKEN: FA_TOKEN,
      STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
    };
    const first = install(dir, { env });
    expect(first.status).toBe(0);

    // A newer upstream whose config alone changed: a newer version stamp.
    const upstream = path.join(scratch(), "upstream");
    fs.cpSync(AGENT_DIR, upstream, { recursive: true });
    const upstreamConfig = path.join(upstream, "otel-collector-config.yaml");
    const newer = fs
      .readFileSync(upstreamConfig, "utf8")
      .replace(
        /- key: oneuptime\.agent\.version\n(\s+)value: "[^"]+"/,
        '- key: oneuptime.agent.version\n$1value: "0.999.0"',
      );
    expect(newer).toContain('value: "0.999.0"');
    fs.writeFileSync(upstreamConfig, newer);

    const upgraded = install(dir, { env: { ...env, SERVE_DIR: upstream } });

    expect(upgraded.status).toBe(0);
    expect(upgraded.envFile).toBe(first.envFile);
    const composeUps = upgraded.docker
      .split("\n")
      .filter((line) => {
        return line.includes("| compose up");
      })
      .map((line) => {
        return line.split(" | ")[1];
      });
    expect(composeUps).toEqual([
      "compose up -d --force-recreate",
      "compose up -d --force-recreate",
    ]);
    expect(fs.readFileSync(path.join(dir, "config-at-up.yaml"), "utf8")).toBe(
      newer,
    );
  });

  /*
   * A collector pin bump changes all three configs, so "differs from the new
   * download" cannot mean "edited": install.sh records a sha256 per file it
   * installed, and only a file that no longer matches its record is kept.
   */
  describe("which replaced files it keeps", () => {
    const env = {
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
      STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
      STORAGE_ARRAY_NAME: "fa-prod-01",
      PURE_FA_ENDPOINT: "fa-prod-01.example.com",
      PURE_FA_API_TOKEN: FA_TOKEN,
      STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
    };
    const AGENT_FILES = INSTALLED_FILES;
    const CONFIGS = AGENT_FILES.filter((file) => {
      return file.startsWith("otel-collector-config");
    });

    function sha256(file) {
      return crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
    }

    // A newer upstream that bumps the version every config stamps.
    function newerUpstream() {
      const upstream = path.join(scratch(), "upstream");
      fs.cpSync(AGENT_DIR, upstream, { recursive: true });
      for (const config of CONFIGS) {
        const file = path.join(upstream, config);
        const bumped = fs
          .readFileSync(file, "utf8")
          .replace(
            /- key: oneuptime\.agent\.version\n(\s+)value: "[^"]+"/,
            '- key: oneuptime.agent.version\n$1value: "0.999.0"',
          );
        expect(bumped).toContain('value: "0.999.0"');
        fs.writeFileSync(file, bumped);
      }
      return upstream;
    }

    function backupsIn(installDir) {
      return fs
        .readdirSync(installDir)
        .filter((file) => {
          return file.includes(".bak.");
        })
        .sort();
    }

    test("records a sha256 for every file it installed", () => {
      const dir = scratch();
      const run = install(dir, { env });
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
      ).toEqual(AGENT_FILES);
      for (const [hash, file] of record) {
        expect(hash).toBe(sha256(path.join(run.installDir, file)));
      }
      // Nothing is left behind from the download.
      expect(
        fs.readdirSync(run.installDir).filter((file) => {
          return file.endsWith(".download") || file.endsWith(".new");
        }),
      ).toEqual([]);
    });

    test("an upgrade replaces the files nobody edited without keeping copies", () => {
      const dir = scratch();
      expect(install(dir, { env }).status).toBe(0);

      const upstream = newerUpstream();
      const upgraded = install(dir, { env: { ...env, SERVE_DIR: upstream } });

      expect(upgraded.status).toBe(0);
      expect(backupsIn(upgraded.installDir)).toEqual([]);
      expect(upgraded.output).not.toContain("edited these files");
      expect(upgraded.output).not.toContain("no record");
      for (const config of CONFIGS) {
        expect(
          fs.readFileSync(path.join(upgraded.installDir, config), "utf8"),
        ).toBe(fs.readFileSync(path.join(upstream, config), "utf8"));
      }
      // The record follows the upgrade, so the next one reads it right too.
      const record = fs.readFileSync(
        path.join(upgraded.installDir, ".agent-files.sha256"),
        "utf8",
      );
      expect(record).toContain(
        `${sha256(path.join(upstream, "otel-collector-config.yaml"))}  otel-collector-config.yaml`,
      );
    });

    test("an upgrade keeps only the file you edited, and says you edited it", () => {
      const dir = scratch();
      expect(install(dir, { env }).status).toBe(0);
      const config = path.join(dir, "agent", "otel-collector-config.yaml");
      const edited = `${fs.readFileSync(config, "utf8")}# my edit\n`;
      fs.writeFileSync(config, edited);

      const upgraded = install(dir, {
        env: { ...env, SERVE_DIR: newerUpstream() },
      });

      expect(upgraded.status).toBe(0);
      const backups = backupsIn(upgraded.installDir);
      expect(backups).toHaveLength(1);
      expect(backups[0]).toMatch(/^otel-collector-config\.yaml\.bak\.\d{14}$/);
      expect(
        fs.readFileSync(path.join(upgraded.installDir, backups[0]), "utf8"),
      ).toBe(edited);
      expect(upgraded.output).toContain(
        "You had edited these files since install.sh installed them.",
      );
      expect(upgraded.output).toContain(backups[0]);
      expect(upgraded.output).not.toContain("no record");
    });

    test("without a record, it keeps every file that differs and says they may hold changes", () => {
      const dir = scratch();
      const first = install(dir, { env });
      expect(first.status).toBe(0);
      // An agent installed before install.sh kept the record.
      fs.rmSync(path.join(first.installDir, ".agent-files.sha256"));

      const upgraded = install(dir, {
        env: { ...env, SERVE_DIR: newerUpstream() },
      });

      expect(upgraded.status).toBe(0);
      // The three configs changed upstream; the compose file did not.
      expect(
        backupsIn(upgraded.installDir).map((file) => {
          return file.replace(/\.bak\.\d{14}$/, "");
        }),
      ).toEqual([...CONFIGS].sort());
      expect(upgraded.output).toContain(
        "There was no record of\nwhat install.sh had installed",
      );
      expect(upgraded.output).not.toContain("edited these files");
      // ...and the record is back for the next run.
      expect(
        fs.existsSync(path.join(upgraded.installDir, ".agent-files.sha256")),
      ).toBe(true);
    });
  });

  test("refuses a $ in a value the collector would expand again", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
        STORAGE_ARRAY_NAME: "fa$prod",
      },
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("STORAGE_ARRAY_NAME must not contain a $");
    expect(run.envFile).toBe("");
  });

  test("refuses a collector config it does not ship", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: "my-config.yaml",
      },
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("is not one of the");
  });

  test("explains a container name already in use when compose up fails", () => {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(path.join(dir, "up.fail"), "");
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
        STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
        STORAGE_ARRAY_NAME: "fa-prod-02",
        PURE_FA_ENDPOINT: "fa-prod-02.example.com",
        PURE_FA_API_TOKEN: FA_TOKEN,
        STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
      },
    });

    expect(run.status).not.toBe(0);
    // The name it tried, and how to give this agent another: never an edit
    // of docker-compose.yml, which the next upgrade would replace.
    expect(run.output).toContain(
      '"oneuptime-storage-array-agent-agent" is already in use, another container on this machine has it',
    );
    expect(run.output).toContain(
      `  STORAGE_ARRAY_AGENT_CONTAINER_NAME=oneuptime-storage-array-agent-<array> INSTALL_DIR=${run.installDir} bash install.sh`,
    );
    expect(run.output).toContain(
      `It is kept in ${run.installDir}/.env from then on`,
    );
    expect(run.output).not.toContain("container_name");
  });
});

/* ------------------------------------------ install.sh: the container name */

/*
 * Two containers cannot share a name, so a second array's agent on the same
 * machine runs under a name of its own: STORAGE_ARRAY_AGENT_CONTAINER_NAME in
 * .env, which docker-compose.yml's container_name reads. Re-running
 * install.sh is the upgrade and replaces docker-compose.yml, never .env, so
 * the name survives it - and an agent set up before .env held the name, whose
 * docker-compose.yml was given its name by hand, keeps it too. These run
 * several installs against one stand-in engine (installStubs): one machine.
 */
const DEFAULT_CONTAINER = "oneuptime-storage-array-agent";
const CONTAINER_VARIABLE = "STORAGE_ARRAY_AGENT_CONTAINER_NAME";

// A FlashArray's settings, exported: nothing is asked.
function arrayEnv(name = "fa-prod-01") {
  return {
    ONEUPTIME_URL: "https://oneuptime.example.com",
    ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
    STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
    STORAGE_ARRAY_NAME: name,
    PURE_FA_ENDPOINT: `${name}.example.com`,
    PURE_FA_API_TOKEN: FA_TOKEN,
    STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
  };
}

// The stand-in engine's containers: name -> the directory that runs it.
function containersOn(dir) {
  const byName = {};
  for (const line of readIfExists(path.join(dir, "containers"))
    .split("\n")
    .filter(Boolean)) {
    const [name, project] = line.split("\t");
    byName[name] = project;
  }
  return byName;
}

// The id the stand-in engine gives a directory's container of that name.
function containerId(name, project) {
  return crypto
    .createHash("sha256")
    .update(`${name}|${project}`)
    .digest("hex")
    .slice(0, 12);
}

/*
 * What `docker compose up -d` in `project` leaves: its container, under
 * `name` (none when null), and no other of that directory.
 */
function runContainerAs(dir, project, name) {
  const registry = path.join(dir, "containers");
  const kept = readIfExists(registry)
    .split("\n")
    .filter((line) => {
      return line && line.split("\t")[1] !== project;
    });
  if (name) {
    kept.push(`${name}\t${project}\t${containerId(name, project)}`);
  }
  fs.writeFileSync(registry, kept.length ? `${kept.join("\n")}\n` : "");
}

// The container name .env holds, as Compose reads it.
function containerNameIn(run) {
  const raw = envLines(run.envFile)[CONTAINER_VARIABLE];
  return raw === undefined ? undefined : raw.replace(/^'(.*)'$/, "$1");
}

// What the docker-compose.yml of a release before .env held the name had.
function shippedBeforeEnvHeldTheName() {
  const text = fs
    .readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8")
    .replace(
      /^ {4}container_name: \$\{STORAGE_ARRAY_AGENT_CONTAINER_NAME:-oneuptime-storage-array-agent\}$/m,
      `    container_name: ${DEFAULT_CONTAINER}`,
    );
  expect(text).toContain(`\n    container_name: ${DEFAULT_CONTAINER}\n`);
  return text;
}

function sha256Of(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/*
 * An agent install.sh set up before .env held its container name, in
 * <dir>/<installDirName>: that release's docker-compose.yml, recorded in
 * .agent-files.sha256 as installed (unless `record` is false: an install
 * older than the record), an .env without STORAGE_ARRAY_AGENT_CONTAINER_NAME;
 * then `edit` made to docker-compose.yml - the name README.md asked a second
 * agent for, say - and `docker compose up -d`, so its container runs under
 * the name the edited file gives (none when `running` is false).
 */
function agentFromBefore(
  dir,
  {
    installDirName,
    arrayName = "fa-prod-01",
    edit = (text) => {
      return text;
    },
    record = true,
    running = true,
  },
) {
  const installed = install(dir, { env: arrayEnv(arrayName), installDirName });
  expect(installed.status).toBe(0);
  const installDir = installed.installDir;
  const composeFile = path.join(installDir, "docker-compose.yml");
  const shipped = shippedBeforeEnvHeldTheName();
  const recordFile = path.join(installDir, ".agent-files.sha256");
  if (record) {
    fs.writeFileSync(
      recordFile,
      fs
        .readFileSync(recordFile, "utf8")
        .replace(
          /^[0-9a-f]{64} {2}docker-compose\.yml$/m,
          `${sha256Of(shipped)}  docker-compose.yml`,
        ),
    );
  } else {
    fs.rmSync(recordFile);
  }
  fs.writeFileSync(
    path.join(installDir, ".env"),
    installed.envFile
      .split("\n")
      .filter((line) => {
        return !line.startsWith(`${CONTAINER_VARIABLE}=`);
      })
      .join("\n"),
  );
  const edited = edit(shipped);
  fs.writeFileSync(composeFile, edited);
  const named = /^ {4}container_name: "?([^"\s#]+)"?/m.exec(edited)[1];
  runContainerAs(dir, installDir, running ? named : null);
  fs.writeFileSync(path.join(dir, "docker.log"), "");
  return { installDir, shipped, edited };
}

// The hand edit README.md used to ask a second agent for.
function renameTo(name, { quoted = false, comment = "" } = {}) {
  return (text) => {
    return text.replace(
      `\n    container_name: ${DEFAULT_CONTAINER}\n`,
      `\n    container_name: ${quoted ? `"${name}"` : name}${comment}\n`,
    );
  };
}

function backupsIn(installDir) {
  return fs
    .readdirSync(installDir)
    .filter((file) => {
      return file.includes(".bak.");
    })
    .sort();
}

describe("agents/StorageArrayAgent/install.sh: each agent on a machine keeps its own container name", () => {
  test("a first agent, in the default directory, is named as it always was", () => {
    const dir = scratch();
    const run = install(dir, {
      env: arrayEnv(),
      installDirName: DEFAULT_CONTAINER,
    });

    expect(run.status).toBe(0);
    expect(containerNameIn(run)).toBe(DEFAULT_CONTAINER);
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: run.installDir,
    });
    // Nothing to say about a name nobody chose.
    expect(run.output).not.toContain("The agent's container");
    // The compose file is the shipped one: its name comes from .env.
    expect(
      fs.readFileSync(path.join(run.installDir, "docker-compose.yml"), "utf8"),
    ).toBe(fs.readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8"));
  });

  test("a second agent's install names its container after its directory, and both run", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: DEFAULT_CONTAINER,
    });
    expect(first.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    const second = install(dir, {
      env: arrayEnv("fa-prod-02"),
      installDirName: `${DEFAULT_CONTAINER}-fa02`,
    });

    expect(second.status).toBe(0);
    expect(containerNameIn(second)).toBe(`${DEFAULT_CONTAINER}-fa02`);
    expect(second.output).toContain(
      `The agent's container is ${DEFAULT_CONTAINER}-fa02, named after its directory, so it\ndoes not take the name of another array's agent on this machine.`,
    );
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      [`${DEFAULT_CONTAINER}-fa02`]: second.installDir,
    });
    // The second install ran nothing in the first agent's directory.
    expect(second.docker).toContain(`${second.installDir} | compose up`);
    expect(second.docker).not.toContain(`${first.installDir} | `);
    // ...and asked nothing new: no input at all was given.
    expect(second.output).not.toContain("container name (");
  });

  test("a re-run of the second agent - its upgrade - keeps its name, asks nothing, and starts beside the first", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: DEFAULT_CONTAINER,
    });
    const second = install(dir, {
      env: arrayEnv("fa-prod-02"),
      installDirName: `${DEFAULT_CONTAINER}-fa02`,
    });
    expect([first.status, second.status]).toEqual([0, 0]);

    // No input and nothing exported: any prompt would read EOF and stop it.
    const again = install(dir, { installDirName: `${DEFAULT_CONTAINER}-fa02` });

    expect(again.status).toBe(0);
    expect(again.output).toContain("reusing it");
    expect(again.envFile).toBe(second.envFile);
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      [`${DEFAULT_CONTAINER}-fa02`]: second.installDir,
    });
    // It came from .env, so there is nothing to say about where it came from.
    expect(again.output).not.toContain("named after its directory");
    expect(again.output).not.toContain("keeps its name");
  });

  test("an upgrade to newer files keeps the second agent's name, and the first agent's", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: DEFAULT_CONTAINER,
    });
    const second = install(dir, {
      env: arrayEnv("fa-prod-02"),
      installDirName: `${DEFAULT_CONTAINER}-fa02`,
    });
    expect([first.status, second.status]).toEqual([0, 0]);

    // A newer release, whose config alone changed.
    const upstream = path.join(scratch(), "upstream");
    fs.cpSync(AGENT_DIR, upstream, { recursive: true });
    const config = path.join(upstream, "otel-collector-config.yaml");
    fs.writeFileSync(
      config,
      fs
        .readFileSync(config, "utf8")
        .replace(
          /- key: oneuptime\.agent\.version\n(\s+)value: "[^"]+"/,
          '- key: oneuptime.agent.version\n$1value: "0.999.0"',
        ),
    );

    const upgradedSecond = install(dir, {
      env: { SERVE_DIR: upstream },
      installDirName: `${DEFAULT_CONTAINER}-fa02`,
    });
    const upgradedFirst = install(dir, {
      env: { SERVE_DIR: upstream },
      installDirName: DEFAULT_CONTAINER,
    });

    expect([upgradedSecond.status, upgradedFirst.status]).toEqual([0, 0]);
    expect(containerNameIn(upgradedSecond)).toBe(`${DEFAULT_CONTAINER}-fa02`);
    expect(containerNameIn(upgradedFirst)).toBe(DEFAULT_CONTAINER);
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      [`${DEFAULT_CONTAINER}-fa02`]: second.installDir,
    });
    expect(backupsIn(second.installDir)).toEqual([]);
  });

  test.each([
    ["fa02", `${DEFAULT_CONTAINER}-fa02`],
    ["FA02", `${DEFAULT_CONTAINER}-fa02`],
    // After the directory's Compose project: a-z 0-9 _ - only.
    ["Pure FA (02)", `${DEFAULT_CONTAINER}-purefa02`],
    [`${DEFAULT_CONTAINER}-fb`, `${DEFAULT_CONTAINER}-fb`],
    [`${DEFAULT_CONTAINER}2`, `${DEFAULT_CONTAINER}2`],
    ["arrays.lab_2", `${DEFAULT_CONTAINER}-arrayslab_2`],
  ])(
    "a directory named %j names the container %s",
    (installDirName, expected) => {
      const dir = scratch();
      const run = install(dir, { env: arrayEnv(), installDirName });

      expect(run.status).toBe(0);
      expect(containerNameIn(run)).toBe(expected);
      expect(containersOn(dir)).toEqual({ [expected]: run.installDir });
    },
  );

  test("an exported name is the agent's, and a re-run keeps it without it being exported again", () => {
    const dir = scratch();
    const run = install(dir, {
      env: { ...arrayEnv(), [CONTAINER_VARIABLE]: "array-two" },
      installDirName: `${DEFAULT_CONTAINER}-fa02`,
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)[CONTAINER_VARIABLE]).toBe("'array-two'");
    expect(run.output).toContain(
      `The agent's container is array-two (${CONTAINER_VARIABLE}).`,
    );
    expect(containersOn(dir)).toEqual({ "array-two": run.installDir });

    const again = install(dir, { installDirName: `${DEFAULT_CONTAINER}-fa02` });
    expect(again.status).toBe(0);
    expect(again.envFile).toBe(run.envFile);
    expect(containersOn(dir)).toEqual({ "array-two": run.installDir });
  });

  test("a name exported on a re-run replaces the one .env holds, and the container under the old name goes", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: `${DEFAULT_CONTAINER}-fa02`,
    });
    expect(containersOn(dir)).toEqual({
      [`${DEFAULT_CONTAINER}-fa02`]: first.installDir,
    });

    const renamed = install(dir, {
      env: { [CONTAINER_VARIABLE]: "fa02-agent" },
      installDirName: `${DEFAULT_CONTAINER}-fa02`,
    });

    expect(renamed.status).toBe(0);
    expect(containerNameIn(renamed)).toBe("fa02-agent");
    expect(containersOn(dir)).toEqual({ "fa02-agent": first.installDir });
    // Every other value is the one .env held.
    const { [CONTAINER_VARIABLE]: before, ...firstValues } = envLines(
      first.envFile,
    );
    const { [CONTAINER_VARIABLE]: after, ...renamedValues } = envLines(
      renamed.envFile,
    );
    expect([before, after]).toEqual([
      `'${DEFAULT_CONTAINER}-fa02'`,
      "'fa02-agent'",
    ]);
    expect(renamedValues).toEqual(firstValues);
  });

  test.each([
    "my agent",
    "-agent",
    "a",
    "agent$1",
    "agent/2",
    "ägent",
    "agent:2",
  ])(
    "refuses %j, a name Docker would refuse, before anything is written or started",
    (name) => {
      const dir = scratch();
      const run = install(dir, {
        env: { ...arrayEnv(), [CONTAINER_VARIABLE]: name },
      });

      expect(run.status).toBe(1);
      expect(run.output).toContain(
        `Error: ${CONTAINER_VARIABLE}="${name}" is not a container name: a letter or\na digit, then letters, digits, _, . or - (e.g. ${DEFAULT_CONTAINER}-fa02).`,
      );
      expect(fs.existsSync(run.installDir)).toBe(false);
      // Only the checks that Docker and Compose are there ran.
      expect(
        run.docker
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            return line.split(" | ")[1];
          }),
      ).toEqual(["info", "compose version"]);
    },
  );

  test("a name .env holds that Docker would refuse stops a re-run before it changes anything", () => {
    const dir = scratch();
    const first = install(dir, { env: arrayEnv() });
    expect(first.status).toBe(0);
    const envFile = path.join(first.installDir, ".env");
    const broken = first.envFile.replace(
      `${CONTAINER_VARIABLE}='${DEFAULT_CONTAINER}-agent'`,
      `${CONTAINER_VARIABLE}='my array agent'`,
    );
    expect(broken).not.toBe(first.envFile);
    fs.writeFileSync(envFile, broken);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    const again = install(dir);

    expect(again.status).toBe(1);
    expect(again.output).toContain(
      `Error: ${CONTAINER_VARIABLE}="my array agent" is not a container name`,
    );
    expect(fs.readFileSync(envFile, "utf8")).toBe(broken);
    expect(again.docker).not.toContain("compose up");
  });

  test("a name another directory's container holds stops the start, and says how to give this agent its own", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: DEFAULT_CONTAINER,
    });
    expect(first.status).toBe(0);

    const clash = install(dir, {
      env: {
        ...arrayEnv("fa-prod-02"),
        [CONTAINER_VARIABLE]: DEFAULT_CONTAINER,
      },
      installDirName: "fa02",
    });

    expect(clash.status).toBe(1);
    expect(clash.output).toContain(
      `The container name "/${DEFAULT_CONTAINER}" is already in use`,
    );
    expect(clash.output).toContain(
      `"${DEFAULT_CONTAINER}" is already in use, another container on this machine has it (another\narray's agent, say): give this agent a name of its own and run this again, e.g.`,
    );
    expect(clash.output).toContain(
      `  ${CONTAINER_VARIABLE}=${DEFAULT_CONTAINER}-<array> INSTALL_DIR=${clash.installDir} bash install.sh`,
    );
    // The first agent still runs, under its name.
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
    });

    // Doing what it says starts the second one.
    const fixed = install(dir, {
      env: { [CONTAINER_VARIABLE]: `${DEFAULT_CONTAINER}-fa02` },
      installDirName: "fa02",
    });
    expect(fixed.status).toBe(0);
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      [`${DEFAULT_CONTAINER}-fa02`]: clash.installDir,
    });
  });

  test("Compose is started from the docker-compose.yml just downloaded and .env with the name in it", () => {
    const dir = scratch();
    const run = install(dir, {
      env: arrayEnv(),
      installDirName: `${DEFAULT_CONTAINER}-fa02`,
    });

    expect(run.status).toBe(0);
    const ups = run.docker.split("\n").filter((line) => {
      return line.includes("| compose up");
    });
    expect(ups).toEqual([`${run.installDir} | compose up -d --force-recreate`]);
    expect(run.envFile.split("\n")).toContain(
      `${CONTAINER_VARIABLE}='${DEFAULT_CONTAINER}-fa02'`,
    );
  });
});

describe("agents/StorageArrayAgent/install.sh: an agent set up before .env held its container name", () => {
  test("a second agent whose docker-compose.yml was given its own name keeps it on upgrade, and the first agent is untouched", () => {
    const dir = scratch();
    const first = agentFromBefore(dir, { installDirName: DEFAULT_CONTAINER });
    const second = agentFromBefore(dir, {
      installDirName: "array-fb",
      arrayName: "fb-prod",
      edit: renameTo("storage-fb"),
    });
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      "storage-fb": second.installDir,
    });

    // The upgrade, as the docs give it: no input, nothing exported.
    const upgraded = install(dir, { installDirName: "array-fb" });

    expect(upgraded.status).toBe(0);
    // Its own name, not its directory's (oneuptime-storage-array-agent-array-fb).
    expect(containerNameIn(upgraded)).toBe("storage-fb");
    expect(upgraded.output).toContain(
      "The agent's container keeps its name, storage-fb, from its docker-compose.yml.",
    );
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      "storage-fb": second.installDir,
    });
    // The new docker-compose.yml is the shipped one, its name from .env.
    expect(
      fs.readFileSync(
        path.join(second.installDir, "docker-compose.yml"),
        "utf8",
      ),
    ).toBe(fs.readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8"));
    // The edited file is kept, and said to need nothing made again.
    const backups = backupsIn(second.installDir);
    expect(backups).toEqual([
      expect.stringMatching(/^docker-compose\.yml\.bak\.\d{14}$/),
    ]);
    expect(
      fs.readFileSync(path.join(second.installDir, backups[0]), "utf8"),
    ).toBe(second.edited);
    expect(upgraded.output).toContain(
      `Your docker-compose.yml gave the agent's container a name of its own, the one change\nyou had made to it. The new docker-compose.yml reads the name from .env\n(${CONTAINER_VARIABLE}=storage-fb), so there is nothing to make again.\nYour copy is kept: ${path.join(second.installDir, backups[0])}`,
    );
    expect(upgraded.output).not.toContain("You had edited these files");
    // It ran nothing in the first agent's directory.
    expect(upgraded.docker).toContain(`${second.installDir} | compose up`);
    expect(upgraded.docker).not.toContain(`${first.installDir} | `);

    // The first agent's own upgrade: the default name, and nothing to say.
    fs.writeFileSync(path.join(dir, "docker.log"), "");
    const firstUpgraded = install(dir, { installDirName: DEFAULT_CONTAINER });
    expect(firstUpgraded.status).toBe(0);
    expect(containerNameIn(firstUpgraded)).toBe(DEFAULT_CONTAINER);
    expect(firstUpgraded.output).not.toContain("The agent's container");
    expect(firstUpgraded.output).not.toContain("docker-compose.yml gave");
    expect(backupsIn(first.installDir)).toEqual([]);
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      "storage-fb": second.installDir,
    });

    // And the next upgrade of the second reads the name from .env.
    const third = install(dir, { installDirName: "array-fb" });
    expect(third.status).toBe(0);
    expect(containerNameIn(third)).toBe("storage-fb");
    expect(third.output).not.toContain("keeps its name");
    expect(backupsIn(second.installDir)).toEqual(backups);
  });

  test("a name written as Compose allows it - quoted, with a comment after it - is read as Compose reads it", () => {
    const dir = scratch();
    const second = agentFromBefore(dir, {
      installDirName: "array-fb",
      edit: renameTo("storage-fb", {
        quoted: true,
        comment: "  # the FlashBlade",
      }),
    });

    const upgraded = install(dir, { installDirName: "array-fb" });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe("storage-fb");
    expect(containersOn(dir)).toEqual({ "storage-fb": second.installDir });
    // Quoting it differently is still only the name.
    expect(upgraded.output).toContain("the one change\nyou had made to it");
  });

  test("the name and another edit: the other one is named as one to make again, and the name is not", () => {
    const dir = scratch();
    const second = agentFromBefore(dir, {
      installDirName: "array-fb",
      edit: (text) => {
        const renamed = renameTo("storage-fb")(text);
        // A bigger log of the collector's own.
        const edited = renamed.replace('max-size: "10m"', 'max-size: "50m"');
        expect(edited).not.toBe(renamed);
        return edited;
      },
    });

    const upgraded = install(dir, { installDirName: "array-fb" });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe("storage-fb");
    const backups = backupsIn(second.installDir);
    expect(backups).toHaveLength(1);
    expect(upgraded.output).toContain(
      `You had edited these files since install.sh installed them. They were replaced by\nthe current versions; your copies are kept next to them:\n  ${path.join(second.installDir, backups[0])}`,
    );
    expect(upgraded.output).toContain(
      `The new docker-compose.yml reads the agent's container name from .env\n(${CONTAINER_VARIABLE}=storage-fb): leave its container_name line\nas it is when you make your other changes again.`,
    );
    expect(upgraded.output).not.toContain("the one change");
  });

  test("after an older install.sh's upgrade put the default name back, the name comes back from the copy it kept", () => {
    const dir = scratch();
    const first = agentFromBefore(dir, { installDirName: DEFAULT_CONTAINER });
    const second = agentFromBefore(dir, {
      installDirName: "array-fb",
      edit: renameTo("storage-fb"),
    });
    /*
     * What the install.sh before this one did to it: kept the edited file,
     * installed (and recorded) the default name again, stopped the agent -
     * and could not start it, the first agent holding that name.
     */
    fs.copyFileSync(
      path.join(second.installDir, "docker-compose.yml"),
      path.join(second.installDir, "docker-compose.yml.bak.20261101090000"),
    );
    fs.writeFileSync(
      path.join(second.installDir, "docker-compose.yml"),
      second.shipped,
    );
    runContainerAs(dir, second.installDir, null);

    const upgraded = install(dir, { installDirName: "array-fb" });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe("storage-fb");
    expect(upgraded.output).toContain(
      "The agent's container keeps its name, storage-fb, from its docker-compose.yml, kept as a backup by an earlier upgrade.",
    );
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      "storage-fb": second.installDir,
    });
  });

  test("of several copies kept, the newest that gave the agent a name of its own is the one", () => {
    const dir = scratch();
    const second = agentFromBefore(dir, {
      installDirName: "array-fb",
      running: false,
    });
    const keep = (suffix, text) => {
      fs.writeFileSync(
        path.join(second.installDir, `docker-compose.yml.bak.${suffix}`),
        text,
      );
    };
    keep("20251001000000", renameTo("storage-fb-2025")(second.shipped));
    keep("20261101000000", renameTo("storage-fb")(second.shipped));
    // A later copy kept for another edit, with the default name in it.
    keep(
      "20261115000000",
      second.shipped.replace('max-size: "10m"', 'max-size: "20m"'),
    );

    const upgraded = install(dir, { installDirName: "array-fb" });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe("storage-fb");
    expect(containersOn(dir)).toEqual({ "storage-fb": second.installDir });
  });

  test("a container this directory runs under a name of its own keeps it when nothing else says it", () => {
    const dir = scratch();
    // The shipped docker-compose.yml of this release, and an .env without the
    // name (written by hand from an older guide, say).
    const installed = install(dir, {
      env: arrayEnv(),
      installDirName: "array-fb",
    });
    fs.writeFileSync(
      path.join(installed.installDir, ".env"),
      installed.envFile
        .split("\n")
        .filter((line) => {
          return !line.startsWith(`${CONTAINER_VARIABLE}=`);
        })
        .join("\n"),
    );
    runContainerAs(dir, installed.installDir, "fb-array-agent");

    const upgraded = install(dir, { installDirName: "array-fb" });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe("fb-array-agent");
    expect(upgraded.output).toContain(
      "The agent's container keeps its name, fb-array-agent, from the container it runs as.",
    );
    expect(containersOn(dir)).toEqual({
      "fb-array-agent": installed.installDir,
    });
  });

  test("an edited name wins over the container's, which only a `docker compose up` would have caught up with", () => {
    const dir = scratch();
    const second = agentFromBefore(dir, {
      installDirName: "array-fb",
      edit: renameTo("storage-fb"),
    });
    // The edit was never applied: the container still runs as the default.
    runContainerAs(dir, second.installDir, DEFAULT_CONTAINER);

    const upgraded = install(dir, { installDirName: "array-fb" });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe("storage-fb");
    expect(containersOn(dir)).toEqual({ "storage-fb": second.installDir });
  });

  test("an agent installed before install.sh kept a record: the name is kept, and the file said to differ", () => {
    const dir = scratch();
    const second = agentFromBefore(dir, {
      installDirName: "array-fb",
      edit: renameTo("storage-fb"),
      record: false,
    });

    const upgraded = install(dir, { installDirName: "array-fb" });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe("storage-fb");
    expect(upgraded.output).toContain(
      "There was no record of\nwhat install.sh had installed",
    );
    expect(
      backupsIn(second.installDir).map((file) => {
        return file.replace(/\.bak\.\d{14}$/, "");
      }),
    ).toContain("docker-compose.yml");
    expect(upgraded.output).toContain(
      "leave its container_name line\nas it is when you make your other changes again.",
    );
  });

  test("an older first agent in a directory of its own keeps the default name it runs under", () => {
    const dir = scratch();
    const first = agentFromBefore(dir, { installDirName: "storage-agent" });
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
    });

    const upgraded = install(dir, { installDirName: "storage-agent" });

    expect(upgraded.status).toBe(0);
    // Not oneuptime-storage-array-agent-storage-agent: an upgrade renames nothing.
    expect(containerNameIn(upgraded)).toBe(DEFAULT_CONTAINER);
    expect(upgraded.output).not.toContain("The agent's container");
    expect(backupsIn(first.installDir)).toEqual([]);
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
    });
  });

  test("...while one whose container is gone is named after its directory, like a new install there", () => {
    const dir = scratch();
    const first = agentFromBefore(dir, {
      installDirName: "storage-agent",
      running: false,
    });

    const upgraded = install(dir, { installDirName: "storage-agent" });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe(
      `${DEFAULT_CONTAINER}-storage-agent`,
    );
    expect(containersOn(dir)).toEqual({
      [`${DEFAULT_CONTAINER}-storage-agent`]: first.installDir,
    });
  });

  test("an exported name still wins over what the old docker-compose.yml said", () => {
    const dir = scratch();
    const second = agentFromBefore(dir, {
      installDirName: "array-fb",
      edit: renameTo("storage-fb"),
    });

    const upgraded = install(dir, {
      env: { [CONTAINER_VARIABLE]: "fb-agent" },
      installDirName: "array-fb",
    });

    expect(upgraded.status).toBe(0);
    expect(containerNameIn(upgraded)).toBe("fb-agent");
    expect(containersOn(dir)).toEqual({ "fb-agent": second.installDir });
    // The edit was the name alone, so the note says .env has the one in use.
    expect(upgraded.output).toContain(
      `(${CONTAINER_VARIABLE}=fb-agent), so there is nothing to make again.`,
    );
  });
});

/*
 * Compose names a directory's project after the directory, whatever its
 * parents: two agents in directories of one name are one project to it, and
 * the second install's `down` and `up` would remove the first agent and run
 * in its place, without a word. Such an install stops before it changes
 * anything.
 */
describe("agents/StorageArrayAgent/install.sh: a directory named like another one's on the machine", () => {
  // The registry's containers as Compose's project names group them.
  function project(dir) {
    return path
      .basename(dir)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/^[-_]+/, "");
  }

  test("a second agent in a directory of the first one's name stops before it changes anything", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: "fa01/agent",
    });
    expect(first.status).toBe(0);
    const running = containersOn(dir);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    const second = install(dir, {
      env: arrayEnv("fa-prod-02"),
      installDirName: "fa02/agent",
    });

    expect(project(first.installDir)).toBe(project(second.installDir));
    expect(second.status).toBe(1);
    expect(second.output).toContain(
      `Error: ${first.installDir} already runs containers in the Docker Compose project\n"agent": Compose names a project after its directory, and gives ${second.installDir}\nthat name too. Installing here would stop them and run this agent in their place. Install it\ninto a directory of another name instead, e.g. INSTALL_DIR=${second.installDir}-2 bash install.sh`,
    );
    // Nothing written, nothing stopped, nothing started.
    expect(fs.existsSync(second.installDir)).toBe(false);
    expect(second.docker).not.toContain("| compose up");
    expect(second.docker).not.toContain("down");
    expect(containersOn(dir)).toEqual(running);

    // Doing what it says installs it beside the first.
    const renamed = install(dir, {
      env: arrayEnv("fa-prod-02"),
      installDirName: "fa02/agent-2",
    });
    expect(renamed.status).toBe(0);
    expect(containersOn(dir)).toEqual({
      ...running,
      [`${DEFAULT_CONTAINER}-agent-2`]: renamed.installDir,
    });
  });

  test("the agent's own upgrade, from its own directory, is no other directory's", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: "fa01/agent",
    });
    expect(first.status).toBe(0);

    const again = install(dir, { installDirName: "fa01/agent" });

    expect(again.status).toBe(0);
    expect(again.output).not.toContain("already runs containers");
    expect(containersOn(dir)).toEqual({
      [`${DEFAULT_CONTAINER}-agent`]: first.installDir,
    });
  });

  test("its own directory, reached through a symlink or with a trailing /, is its own", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: "fa01/agent",
    });
    expect(first.status).toBe(0);
    fs.mkdirSync(path.join(dir, "alias"));
    fs.symlinkSync(first.installDir, path.join(dir, "alias", "agent"));

    const throughLink = install(dir, { installDirName: "alias/agent" });
    expect(throughLink.status).toBe(0);
    expect(throughLink.output).not.toContain("already runs containers");

    const withSlash = install(dir, { installDirName: "fa01/agent/" });
    expect(withSlash.status).toBe(0);
    expect(withSlash.output).not.toContain("already runs containers");
  });

  test("anyone else's Compose project of that name stops it too", () => {
    const dir = scratch();
    installStubs(dir);
    // An app of someone's, in a directory named like the agent's.
    const app = path.join(dir, "apps", "agent");
    fs.mkdirSync(app, { recursive: true });
    runContainerAs(dir, app, "agent-web-1");

    const run = install(dir, { env: arrayEnv(), installDirName: "fa01/agent" });

    expect(run.status).toBe(1);
    expect(run.output).toContain(
      `Error: ${app} already runs containers in the Docker Compose project\n"agent"`,
    );
    expect(containersOn(dir)).toEqual({ "agent-web-1": app });
  });

  test("containers whose directory is gone - an agent moved elsewhere - are this one's to replace", () => {
    const dir = scratch();
    installStubs(dir);
    runContainerAs(
      dir,
      path.join(dir, "moved-from", "agent"),
      `${DEFAULT_CONTAINER}-agent`,
    );

    const run = install(dir, { env: arrayEnv(), installDirName: "fa01/agent" });

    expect(run.status).toBe(0);
    expect(containersOn(dir)).toEqual({
      [`${DEFAULT_CONTAINER}-agent`]: run.installDir,
    });
  });

  test("an exported COMPOSE_PROJECT_NAME is the project's name, as it is to Compose", () => {
    const dir = scratch();
    const first = install(dir, {
      env: arrayEnv(),
      installDirName: "fa01/agent",
    });
    expect(first.status).toBe(0);

    const second = install(dir, {
      env: { ...arrayEnv("fa-prod-02"), COMPOSE_PROJECT_NAME: "fa02" },
      installDirName: "fa02/agent",
    });

    // Not the first agent's project: nothing to stop.
    expect(second.output).not.toContain("already runs containers");
    expect(second.docker).toContain(`${second.installDir} | compose up`);
  });
});
/*
 * The real Docker Compose, which renders a project (`config`, no container is
 * started) for the tests below that hold the script to it. The Ops workflow's
 * runner has Compose and must run them; elsewhere they are skipped with the
 * reason logged.
 */
const COMPOSE_PROBE = spawnSync("docker", ["compose", "version"], {
  encoding: "utf8",
});
const HAS_COMPOSE = !COMPOSE_PROBE.error && COMPOSE_PROBE.status === 0;
if (!HAS_COMPOSE && !process.env["CI"]) {
  // eslint-disable-next-line no-console
  console.log(
    "The Docker Compose rendering is skipped: `docker compose` is not available here.",
  );
}

/* ---------------------------------- install.sh's container name, its helpers */

describe("agents/StorageArrayAgent/install.sh: the container name helpers", () => {
  const script = fs.readFileSync(path.join(AGENT_DIR, "install.sh"), "utf8");
  const helpers = [
    "dotenv_get",
    "is_container_name",
    "compose_container_name",
    "absolute_install_dir",
    "compose_project_name",
    "directory_container_name",
    "file_sha256",
    "only_container_name_edited",
  ]
    .map((name) => {
      const match = new RegExp(
        `\\n${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`,
      ).exec(script);
      expect(match).not.toBeNull();
      return match[0];
    })
    .join("\n");

  function shell(body, args = [], env = {}) {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `AGENT_SERVICE=${DEFAULT_CONTAINER}\nDEFAULT_CONTAINER_NAME=${DEFAULT_CONTAINER}\n${helpers}\n${body}`,
        "helpers",
        ...args,
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, ...env } },
    );
    return { status: result.status, out: result.stdout };
  }

  test("the shipped values are the compose file's", () => {
    expect(script).toContain(`AGENT_SERVICE="${DEFAULT_CONTAINER}"`);
    expect(script).toContain(`DEFAULT_CONTAINER_NAME="${DEFAULT_CONTAINER}"`);
    expect(
      fs.readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8"),
    ).toContain(`\n  ${DEFAULT_CONTAINER}:\n`);
  });

  test.each([
    ["ab", true],
    ["fa02", true],
    ["Storage_FA.02-b", true],
    ["0array", true],
    ["", false],
    ["a", false],
    ["-a", false],
    [".a", false],
    ["_a", false],
    ["a b", false],
    ["a/b", false],
    ["a$b", false],
    ["a:b", false],
    ["ärray", false],
    ["a\nb", false],
  ])("is_container_name %j is %s, as Docker's own rule", (name, valid) => {
    expect(shell('is_container_name "$1"', [name]).status).toBe(valid ? 0 : 1);
  });

  test.each([
    ["/opt/oneuptime-storage-array-agent", DEFAULT_CONTAINER],
    ["/opt/oneuptime-storage-array-agent/", DEFAULT_CONTAINER],
    ["/opt/oneuptime-storage-array-agent//", DEFAULT_CONTAINER],
    ["/srv/oneuptime-storage-array-agent", DEFAULT_CONTAINER],
    ["/opt/oneuptime-storage-array-agent-fa02", `${DEFAULT_CONTAINER}-fa02`],
    ["/opt/fa02", `${DEFAULT_CONTAINER}-fa02`],
    ["/opt/FA02", `${DEFAULT_CONTAINER}-fa02`],
    ["/opt/My Array (2)", `${DEFAULT_CONTAINER}-myarray2`],
    ["/opt/--x--", `${DEFAULT_CONTAINER}-x--`],
    ["/opt/a.b_c", `${DEFAULT_CONTAINER}-ab_c`],
    ["/opt/über", `${DEFAULT_CONTAINER}-ber`],
    ["relative/fa02", `${DEFAULT_CONTAINER}-fa02`],
    ["/", DEFAULT_CONTAINER],
    [".", DEFAULT_CONTAINER],
  ])("directory_container_name of %j is %s", (installDir, expected) => {
    const run = shell("directory_container_name", [], {
      INSTALL_DIR: installDir,
    });
    expect(run).toEqual({ status: 0, out: expected });
    expect(shell('is_container_name "$1"', [run.out]).status).toBe(0);
  });

  test("directory_container_name follows an exported COMPOSE_PROJECT_NAME, and one in .env", () => {
    expect(
      shell("directory_container_name", [], {
        INSTALL_DIR: "/opt/agent",
        COMPOSE_PROJECT_NAME: "fa02",
      }),
    ).toEqual({ status: 0, out: `${DEFAULT_CONTAINER}-fa02` });

    const envFile = path.join(scratch(), ".env");
    fs.writeFileSync(envFile, "COMPOSE_PROJECT_NAME='fb-lab'\n");
    expect(
      shell("directory_container_name", [], {
        INSTALL_DIR: "/opt/agent",
        ENV_FILE: envFile,
      }),
    ).toEqual({ status: 0, out: `${DEFAULT_CONTAINER}-fb-lab` });
  });

  /*
   * compose_project_name against the real Docker Compose: the name it gives
   * each directory's project (rendered with `config`, nothing started).
   */
  (HAS_COMPOSE || process.env["CI"] ? test : test.skip)(
    "compose_project_name is the name the real Docker Compose gives the directory's project",
    () => {
      const parent = scratch();
      for (const name of [
        "fa02",
        "FA02",
        "My Array (2)",
        "_x-y",
        "a.b_c",
        "-lead",
        "9lives",
        "x y",
        DEFAULT_CONTAINER,
      ]) {
        const projectDir = path.join(parent, name);
        fs.mkdirSync(projectDir);
        fs.writeFileSync(
          path.join(projectDir, "docker-compose.yml"),
          "services:\n  s:\n    image: busybox\n",
        );
        const rendered = spawnSync(
          "docker",
          ["compose", "config", "--format", "json"],
          {
            cwd: projectDir,
            env: { PATH: process.env.PATH, HOME: projectDir },
            encoding: "utf8",
            timeout: 60000,
          },
        );
        expect(rendered.status).toBe(0);
        expect({
          name,
          project: shell("compose_project_name", [], {
            INSTALL_DIR: projectDir,
          }).out,
        }).toEqual({ name, project: JSON.parse(rendered.stdout).name });
      }
    },
  );

  function composeWith(text) {
    const file = path.join(scratch(), "docker-compose.yml");
    fs.writeFileSync(file, text);
    return file;
  }

  test.each([
    [`    container_name: ${DEFAULT_CONTAINER}`, DEFAULT_CONTAINER],
    ["    container_name: storage-fb", "storage-fb"],
    ['    container_name: "storage-fb"', "storage-fb"],
    ["    container_name: 'storage-fb'", "storage-fb"],
    ["    container_name: storage-fb   # the FlashBlade", "storage-fb"],
    ["    container_name: storage-fb   ", "storage-fb"],
    [
      "    container_name: ${STORAGE_ARRAY_AGENT_CONTAINER_NAME:-oneuptime-storage-array-agent}",
      "",
    ],
    ["    container_name: ${NAME}", ""],
    ["    container_name: not a name", ""],
    ["    image: x", ""],
  ])("compose_container_name reads %j as %j", (line, expected) => {
    const file = composeWith(
      `services:\n  ${DEFAULT_CONTAINER}:\n    image: otel/opentelemetry-collector-contrib:0.165.0\n${line}\n    restart: unless-stopped\n`,
    );
    expect(shell('compose_container_name "$1"', [file])).toEqual({
      status: 0,
      out: expected,
    });
  });

  test("compose_container_name reads the agent's service alone, however the file is indented", () => {
    const sidecarFirst = composeWith(
      [
        "services:",
        "  pure-fa-exporter:",
        "    container_name: not-the-agent",
        "  # The collector.",
        `  ${DEFAULT_CONTAINER}:  # the agent`,
        "",
        "    image: x",
        "    container_name: storage-fb",
        "  pure-fb-exporter:",
        "    container_name: not-this-one-either",
        "",
      ].join("\n"),
    );
    expect(shell('compose_container_name "$1"', [sidecarFirst]).out).toBe(
      "storage-fb",
    );

    const agentWithout = composeWith(
      [
        "services:",
        `    ${DEFAULT_CONTAINER}:`,
        "        image: x",
        "    pure-fa-exporter:",
        "        container_name: not-the-agent",
        "",
      ].join("\n"),
    );
    expect(shell('compose_container_name "$1"', [agentWithout]).out).toBe("");

    const fourSpaces = composeWith(
      [
        "services:",
        `    ${DEFAULT_CONTAINER}:`,
        "        image: x",
        "        container_name: storage-fb",
        "",
      ].join("\n"),
    );
    expect(shell('compose_container_name "$1"', [fourSpaces]).out).toBe(
      "storage-fb",
    );

    expect(
      shell('compose_container_name "$1"', [path.join(scratch(), "none.yml")]),
    ).toEqual({ status: 0, out: "" });
  });

  test("only_container_name_edited: the name alone, in any spelling, is that edit; anything more is not", () => {
    const shipped = shippedBeforeEnvHeldTheName();
    const recorded = sha256Of(shipped);
    const check = (text) => {
      return shell('only_container_name_edited "$1" "$2"', [
        composeWith(text),
        recorded,
      ]).status;
    };

    expect(check(renameTo("storage-fb")(shipped))).toBe(0);
    expect(
      check(
        renameTo("storage-fb", { quoted: true, comment: " # mine" })(shipped),
      ),
    ).toBe(0);
    expect(
      check(
        renameTo("storage-fb")(shipped).replace(
          'max-size: "10m"',
          'max-size: "50m"',
        ),
      ),
    ).toBe(1);
    // Another service renamed is another edit.
    expect(
      check(
        shipped.replace(
          "\n  pure-fa-exporter:\n",
          "\n  pure-fa-exporter:\n    container_name: my-exporter\n",
        ),
      ),
    ).toBe(1);
    // Without a record nothing can be told apart.
    expect(
      shell('only_container_name_edited "$1" ""', [
        composeWith(renameTo("storage-fb")(shipped)),
      ]).status,
    ).toBe(1);
  });
});

/*
 * The real Docker Compose, rendering what install.sh wrote (no container is
 * started): the container_name it reads from .env.
 */

describe("agents/StorageArrayAgent: the real Docker Compose reads the name from .env", () => {
  function renderedName(installDir) {
    const rendered = spawnSync(
      "docker",
      ["compose", "config", "--format", "json"],
      {
        cwd: installDir,
        env: { PATH: process.env.PATH, HOME: installDir },
        encoding: "utf8",
        timeout: 60000,
      },
    );
    expect(rendered.stderr).not.toContain("error");
    expect(rendered.status).toBe(0);
    return JSON.parse(rendered.stdout).services[DEFAULT_CONTAINER]
      .container_name;
  }

  (HAS_COMPOSE || process.env["CI"] ? test : test.skip)(
    "a first agent, a second, and one given a name, each under its own",
    () => {
      const dir = scratch();
      const first = install(dir, {
        env: arrayEnv(),
        installDirName: DEFAULT_CONTAINER,
      });
      const second = install(dir, {
        env: arrayEnv("fa-prod-02"),
        installDirName: "fa02",
      });
      const named = install(dir, {
        env: { ...arrayEnv("fa-prod-03"), [CONTAINER_VARIABLE]: "array-three" },
        installDirName: "fa03",
      });
      expect([first.status, second.status, named.status]).toEqual([0, 0, 0]);

      expect(renderedName(first.installDir)).toBe(DEFAULT_CONTAINER);
      expect(renderedName(second.installDir)).toBe(`${DEFAULT_CONTAINER}-fa02`);
      expect(renderedName(named.installDir)).toBe("array-three");

      // An .env without the name (written by hand) gets the default.
      fs.writeFileSync(
        path.join(second.installDir, ".env"),
        second.envFile
          .split("\n")
          .filter((line) => {
            return !line.startsWith(`${CONTAINER_VARIABLE}=`);
          })
          .join("\n"),
      );
      expect(renderedName(second.installDir)).toBe(DEFAULT_CONTAINER);
    },
  );
});

/* ------------------------------------------------------- troubleshoot.sh */

/*
 * `docker` answers the runtime checks as a healthy install would, reads the
 * container's environment from container.env, answers the OneUptime token
 * probe as a server that accepts the key, and answers the array probe
 * (any /metrics/array URL, or Harvest's /metrics) from array.out with
 * array.exit as curl's exit code. A `docker run -i` (the array probe) records what it read on stdin.
 * `compose ps` prints compose-ps.out; `inspect` of that id prints
 * container.name. With $STUB_DIR/missing, no container exists at all.
 */
function troubleshootStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
# One line per call: curl's -w format carries a newline.
printf '%s' "$*" | tr '\\n' ' ' >> "$STUB_DIR/docker.log"
printf '\\n' >> "$STUB_DIR/docker.log"
case "$1" in
  info) exit 0 ;;
  compose)
    case "$*" in
      *" ps "*) cat "$STUB_DIR/compose-ps.out" 2>/dev/null ;;
    esac
    exit 0 ;;
  inspect)
    case "$*" in
      *Config.Env*) cat "$STUB_DIR/container.env" ;;
      *restarting*) [ -f "$STUB_DIR/missing" ] || printf 'running restarting=false restarts=0\\n' ;;
      *"{{.Name}}"*) printf '/%s\\n' "$(cat "$STUB_DIR/container.name")" ;;
    esac
    exit 0 ;;
  logs) cat "$STUB_DIR/collector.log" 2>/dev/null; exit 0 ;;
  run)
    for arg in "$@"; do
      [ "$arg" = "-i" ] && cat >> "$STUB_DIR/stdin.log"
    done
    case "$*" in
      */otlp/v1/validate*) printf '{"valid":true,"keyType":"Server"}\\nOUSTATUS:200\\n' ;;
      *127.0.0.1:8888/metrics*)
        printf 'otelcol_receiver_accepted_metric_points 10\\notelcol_exporter_sent_metric_points 10\\notelcol_exporter_send_failed_metric_points 0\\n' ;;
      */metrics/array*|*netapp-harvest:12990/metrics*)
        cat "$STUB_DIR/array.out"
        exit "$(cat "$STUB_DIR/array.exit" 2>/dev/null || echo 0)" ;;
    esac
    exit 0 ;;
esac
exit 0
`,
  );
  return bin;
}

const FA_INFO =
  'purefa_info{array_name="fa-prod-01",os="Purity//FA",system_id="9f2c",version="6.7.3"} 1';
const FB_INFO =
  'purefb_info{array_name="fb-prod",os="Purity//FB",system_id="7a1d",version="4.5.6"} 1';

const NATIVE_ENV = {
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
  STORAGE_ARRAY_NAME: "fa-prod-01",
  STORAGE_SYSTEM: "purestorage.flasharray",
  STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.yaml",
  COMPOSE_PROFILES: "",
  PURE_FA_ENDPOINT: "fa-prod-01.example.com",
  PURE_FA_API_TOKEN: FA_TOKEN,
  STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
};

const FA_EXPORTER_ENV = {
  ...NATIVE_ENV,
  STORAGE_ARRAY_COLLECTOR_CONFIG:
    "otel-collector-config.flasharray-exporter.yaml",
  COMPOSE_PROFILES: "flasharray-exporter",
};

const HARVEST_BODY = [
  'netapp_cluster_new_status{cluster="ontap-prod-01",datacenter="ontap-prod-01"} 1',
  'netapp_volume_size_used_percent{cluster="ontap-prod-01",svm="svm1",volume="vol1"} 42',
].join("\n");

const ONTAP_ENV = {
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
  STORAGE_ARRAY_NAME: "ontap-prod-01",
  STORAGE_SYSTEM: "netapp.ontap",
  STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.netapp-ontap.yaml",
  COMPOSE_PROFILES: "netapp-ontap",
  NETAPP_ONTAP_ENDPOINT: "ontap-prod-01.example.com",
  NETAPP_ONTAP_USERNAME: "oneuptime",
  NETAPP_ONTAP_PASSWORD: ONTAP_PASSWORD,
  STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
};

const FLASHBLADE_ENV = {
  ONEUPTIME_URL: "https://oneuptime.example.com",
  ONEUPTIME_TELEMETRY_INGESTION_KEY: INGESTION_KEY,
  STORAGE_ARRAY_NAME: "fb-prod",
  STORAGE_SYSTEM: "purestorage.flashblade",
  STORAGE_ARRAY_COLLECTOR_CONFIG: "otel-collector-config.flashblade.yaml",
  COMPOSE_PROFILES: "flashblade",
  PURE_FB_ENDPOINT: "fb-prod.example.com",
  PURE_FB_API_TOKEN: FB_TOKEN,
};

/*
 * Run the doctor against an install whose container sees `env`, with the
 * array probe answering `body` / `status` (curl exit `curlExit`).
 */
function doctor(
  env,
  { body = "", status = "200", curlExit = 0, name, missing = false } = {},
) {
  const dir = scratch();
  const bin = troubleshootStubs(dir);
  const envText = `${Object.entries(env)
    .map(([key, value]) => {
      return `${key}=${value}`;
    })
    .join("\n")}\n`;
  fs.writeFileSync(path.join(dir, "container.env"), envText);
  fs.writeFileSync(
    path.join(dir, "array.out"),
    `${body}\nOUSTATUS:${status}\n`,
  );
  fs.writeFileSync(path.join(dir, "array.exit"), `${curlExit}\n`);
  if (name) {
    fs.writeFileSync(path.join(dir, "compose-ps.out"), "4f1c2b3a9d8e\n");
    fs.writeFileSync(path.join(dir, "container.name"), name);
  }
  if (missing) {
    fs.writeFileSync(path.join(dir, "missing"), "");
  }

  const installDir = path.join(dir, "agent");
  fs.mkdirSync(installDir);
  for (const file of fs.readdirSync(AGENT_DIR)) {
    if (file.endsWith(".yml") || file.endsWith(".yaml")) {
      fs.copyFileSync(path.join(AGENT_DIR, file), path.join(installDir, file));
    }
  }
  fs.writeFileSync(path.join(installDir, ".env"), envText);

  const result = spawnSync(
    "bash",
    [path.join(AGENT_DIR, "troubleshoot.sh"), "-d", installDir, "--no-color"],
    {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir },
      input: "",
      encoding: "utf8",
      timeout: 60000,
    },
  );

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    docker: readIfExists(path.join(dir, "docker.log")),
    stdin: readIfExists(path.join(dir, "stdin.log")),
  };
}

/* The ✔ / ✗ / ▲ lines of the array section, in order. */
function arrayCheckLines(output) {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => {
    return line === "── 2. Array endpoint & API token ──";
  });
  expect(start).toBeGreaterThan(-1);
  const end = lines.findIndex((line, index) => {
    return index > start && /^── .* ──$/.test(line);
  });
  return lines
    .slice(start + 1, end)
    .filter((line) => {
      return /^ {2}[✔✗▲] /.test(line);
    })
    .map((line) => {
      return line.trim();
    });
}

/* The `docker run` calls that probed the array (or, for ONTAP, Harvest). */
function arrayProbes(run) {
  return run.docker.split("\n").filter((line) => {
    return (
      line.startsWith("run ") &&
      (line.includes("/metrics/array") ||
        line.includes("netapp-harvest:12990/metrics"))
    );
  });
}

describe("agents/StorageArrayAgent/troubleshoot.sh", () => {
  test("a FlashArray serving native metrics passes, and names the array it reached", () => {
    const run = doctor(NATIVE_ENV, { body: FA_INFO });

    expect(arrayCheckLines(run.output)).toEqual([
      "✔ PURE_FA_API_TOKEN is set and shaped like a FlashArray API token (a UUID).",
      "✔ The array answers with metrics: fa-prod-01 (Purity//FA 6.7.3), 1 purefa_* series on /metrics/array.",
    ]);
    expect(run.output).toContain(
      "The agent looks healthy and OneUptime accepts the token.",
    );
    expect(run.status).toBe(0);
  });

  test("probes the native endpoint the way the collector scrapes it, skipping verification only when the collector does", () => {
    const skipping = arrayProbes(doctor(NATIVE_ENV, { body: FA_INFO }));
    expect(skipping).toHaveLength(1);
    expect(skipping[0]).toContain(
      "https://fa-prod-01.example.com/metrics/array?namespace=purefa",
    );
    expect(skipping[0].split(" ")).toContain("-k");

    const verifying = arrayProbes(
      doctor(
        { ...NATIVE_ENV, STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "false" },
        { body: FA_INFO },
      ),
    );
    expect(verifying[0].split(" ")).not.toContain("-k");
  });

  test("hands the API token to curl on stdin and never puts it on a command line", () => {
    for (const [env, token] of [
      [NATIVE_ENV, FA_TOKEN],
      [FLASHBLADE_ENV, FB_TOKEN],
    ]) {
      const run = doctor(env, {
        body: env === NATIVE_ENV ? FA_INFO : FB_INFO,
      });
      expect(run.stdin).toContain(`Authorization: Bearer ${token}\n`);
      expect(run.docker).not.toContain(token);
      expect(run.output).not.toContain(token);
    }
  });

  test("a token the array refuses is the root cause", () => {
    const run = doctor(NATIVE_ENV, {
      body: '{"errors":[{"message":"Invalid API token."}]}',
      status: "401",
    });

    expect(arrayCheckLines(run.output)).toContain(
      "✗ The array REJECTED the API token (HTTP 401).",
    );
    expect(run.output).toContain(
      "ROOT CAUSE: the array rejects the API token.",
    );
    expect(run.status).toBe(1);
  });

  test("a FlashArray without the native endpoint is told to use the exporter config", () => {
    const run = doctor(NATIVE_ENV, {
      body: "404 page not found",
      status: "404",
    });

    expect(run.output).toContain(
      "ROOT CAUSE: the FlashArray has no native OpenMetrics endpoint (Purity//FA < 6.7).",
    );
    expect(run.output).toContain(
      "STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml and COMPOSE_PROFILES=flasharray-exporter",
    );
    expect(run.status).toBe(1);
  });

  test("a self-signed certificate the collector verifies is a TLS finding, not an unreachable array", () => {
    const run = doctor(
      { ...NATIVE_ENV, STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "false" },
      {
        body: "curl: (60) SSL certificate problem: self-signed certificate",
        status: "000",
        curlExit: 60,
      },
    );

    expect(run.output).toContain(
      "ROOT CAUSE: the collector does not trust the array's TLS certificate.",
    );
    expect(run.status).toBe(1);
  });

  test("probes Pure's exporter with endpoint=<array> through the compose network", () => {
    const run = doctor(FA_EXPORTER_ENV, { body: FA_INFO });

    expect(arrayProbes(run)[0]).toContain(
      "http://pure-fa-exporter:9490/metrics/array?endpoint=fa-prod-01.example.com",
    );
    expect(arrayCheckLines(run.output)).toContain(
      "✔ COMPOSE_PROFILES includes 'flasharray-exporter' (starts the exporter this config scrapes).",
    );
    expect(run.status).toBe(0);
  });

  test("the exporter's failed login is a refused token", () => {
    const run = doctor(FA_EXPORTER_ENV, {
      body: "failed to login to FlashArray, check API Token",
      status: "400",
    });

    expect(arrayCheckLines(run.output)).toContain(
      "✗ Pure's exporter could not log in to the array with the API token (HTTP 400).",
    );
    expect(run.output).toContain(
      "ROOT CAUSE: the array rejects the API token.",
    );
  });

  test("an exporter config without its profile: the exporter never starts", () => {
    const run = doctor(
      { ...FA_EXPORTER_ENV, COMPOSE_PROFILES: "" },
      {
        body: "curl: (6) Could not resolve host: pure-fa-exporter",
        status: "000",
        curlExit: 6,
      },
    );

    expect(arrayCheckLines(run.output)).toContain(
      "✗ COMPOSE_PROFILES='' does not include 'flasharray-exporter' — the exporter this config scrapes never starts.",
    );
    expect(run.output).toContain(
      "ROOT CAUSE: Pure's exporter service is not running.",
    );
    expect(run.status).toBe(1);
  });

  test("a FlashBlade is probed through pure-fb-exporter and checked for purefb_info", () => {
    const run = doctor(FLASHBLADE_ENV, { body: FB_INFO });

    expect(arrayProbes(run)[0]).toContain(
      "http://pure-fb-exporter:9491/metrics/array?endpoint=fb-prod.example.com",
    );
    expect(arrayCheckLines(run.output)).toEqual([
      "✔ COMPOSE_PROFILES includes 'flashblade' (starts the exporter this config scrapes).",
      "✔ PURE_FB_API_TOKEN is set and shaped like a FlashBlade API token (T-…).",
      "✔ The array answers with metrics: fb-prod (Purity//FB 4.5.6), 1 purefb_* series on /metrics/array.",
    ]);
    expect(run.status).toBe(0);
  });

  test("an ONTAP cluster Harvest reads passes, and names the cluster", () => {
    const run = doctor(ONTAP_ENV, { body: HARVEST_BODY });

    expect(arrayCheckLines(run.output)).toEqual([
      "✔ COMPOSE_PROFILES includes 'netapp-ontap' (starts the exporter this config scrapes).",
      "✔ NETAPP_ONTAP_USERNAME and NETAPP_ONTAP_PASSWORD are set.",
      "✔ Harvest reads the cluster: ontap-prod-01, 2 netapp_* series.",
    ]);
    expect(run.output).toContain(
      "The agent looks healthy and OneUptime accepts the token.",
    );
    expect(run.status).toBe(0);
  });

  test("probes Harvest on the compose network as the collector scrapes it, and the password goes nowhere", () => {
    const run = doctor(ONTAP_ENV, { body: HARVEST_BODY });

    const probes = arrayProbes(run);
    expect(probes).toHaveLength(1);
    expect(probes[0]).toContain("http://netapp-harvest:12990/metrics");
    // Harvest holds the login: the probe sends no credential at all.
    expect(probes[0]).not.toContain("Authorization");
    expect(run.stdin).toBe("");
    expect(run.docker).not.toContain(ONTAP_PASSWORD);
    expect(run.output).not.toContain(ONTAP_PASSWORD);
  });

  test("Harvest not answering is the root cause, and the fix is its profile", () => {
    const run = doctor(ONTAP_ENV, {
      body: "curl: (6) Could not resolve host: netapp-harvest",
      status: "000",
      curlExit: 6,
    });

    expect(arrayCheckLines(run.output)).toContain(
      "✗ No answer from http://netapp-harvest:12990/metrics (curl exit 6).",
    );
    expect(run.output).toContain("ROOT CAUSE: NetApp Harvest is not running.");
    expect(run.output).toContain("COMPOSE_PROFILES=netapp-ontap");
    expect(run.status).toBe(1);
  });

  test("an ONTAP config without its profile: Harvest never starts", () => {
    const run = doctor(
      { ...ONTAP_ENV, COMPOSE_PROFILES: "" },
      {
        body: "curl: (6) Could not resolve host: netapp-harvest",
        status: "000",
        curlExit: 6,
      },
    );

    expect(arrayCheckLines(run.output)).toContain(
      "✗ COMPOSE_PROFILES='' does not include 'netapp-ontap' — the exporter this config scrapes never starts.",
    );
    expect(run.output).toContain("ROOT CAUSE: NetApp Harvest is not running.");
    expect(run.status).toBe(1);
  });

  test("Harvest serving nothing of the cluster points at its login, its address and its log", () => {
    const run = doctor(ONTAP_ENV, {
      body: 'netapp_poller_status{poller="ontap-prod-01"} 1',
    });

    expect(arrayCheckLines(run.output)).toContain(
      "✗ Harvest answers, but has not read the cluster: no netapp_cluster_new_status series.",
    );
    expect(run.output).toContain(
      "ROOT CAUSE: NetApp Harvest cannot read the cluster (login / address / network).",
    );
    expect(run.output).toContain(
      "docker compose logs --tail 200 netapp-harvest",
    );
    expect(run.status).toBe(1);
  });

  test("an ONTAP install without its user or password is a misconfiguration, and Harvest is not probed", () => {
    const noUser = doctor({ ...ONTAP_ENV, NETAPP_ONTAP_USERNAME: "" });
    expect(arrayCheckLines(noUser.output)).toContain(
      "✗ NETAPP_ONTAP_USERNAME is not set — Harvest has no user to log in to the cluster with.",
    );
    expect(arrayProbes(noUser)).toEqual([]);
    expect(noUser.output).toContain(
      "ROOT CAUSE: the array settings in .env are incomplete or invalid.",
    );

    const noPassword = doctor({ ...ONTAP_ENV, NETAPP_ONTAP_PASSWORD: "" });
    expect(arrayCheckLines(noPassword.output)).toContain(
      "✗ NETAPP_ONTAP_PASSWORD is not set — the cluster refuses Harvest without the read-only user's password.",
    );
    expect(arrayProbes(noPassword)).toEqual([]);
  });

  test("an ONTAP config stamped as a FlashArray is flagged", () => {
    const run = doctor(
      { ...ONTAP_ENV, STORAGE_SYSTEM: "purestorage.flasharray" },
      { body: HARVEST_BODY },
    );

    expect(arrayCheckLines(run.output)).toContain(
      "▲ STORAGE_SYSTEM='purestorage.flasharray' but otel-collector-config.netapp-ontap.yaml reads a NetApp ONTAP cluster (netapp.ontap).",
    );
  });

  test("a FlashBlade config stamped as a FlashArray is flagged", () => {
    const run = doctor(
      { ...FLASHBLADE_ENV, STORAGE_SYSTEM: "purestorage.flasharray" },
      { body: FB_INFO },
    );

    expect(arrayCheckLines(run.output)).toContain(
      "▲ STORAGE_SYSTEM='purestorage.flasharray' but otel-collector-config.flashblade.yaml reads a FlashBlade (purestorage.flashblade).",
    );
  });

  test("an endpoint written as a URL is a misconfiguration, and the array is not probed", () => {
    const run = doctor({
      ...NATIVE_ENV,
      PURE_FA_ENDPOINT: "https://fa-prod-01.example.com",
    });

    expect(arrayCheckLines(run.output)).toContain(
      "✗ PURE_FA_ENDPOINT='https://fa-prod-01.example.com' has a scheme — it must be the bare host name or IP.",
    );
    expect(arrayProbes(run)).toEqual([]);
    expect(run.output).toContain(
      "ROOT CAUSE: the array settings in .env are incomplete or invalid.",
    );
  });

  test("a missing array name fails the stamping check", () => {
    const run = doctor(
      { ...NATIVE_ENV, STORAGE_ARRAY_NAME: "" },
      { body: FA_INFO },
    );

    expect(run.output).toContain(
      "✗ STORAGE_ARRAY_NAME is empty — the collector refuses to start without it, and no array can register.",
    );
    expect(run.output).toContain(
      "ROOT CAUSE: STORAGE_ARRAY_NAME is missing — no array can register.",
    );
    expect(run.status).toBe(1);
  });

  test("finds a second array's agent by the name its .env gives it, which docker-compose.yml reads", () => {
    const run = doctor(
      {
        ...NATIVE_ENV,
        STORAGE_ARRAY_AGENT_CONTAINER_NAME:
          "'oneuptime-storage-array-agent-fa02'",
      },
      { body: FA_INFO },
    );

    expect(run.output).toContain(
      "✔ Container 'oneuptime-storage-array-agent-fa02' is running",
    );
    expect(run.docker).toContain(
      "inspect -f {{.State.Status}} restarting={{.State.Restarting}} restarts={{.RestartCount}} oneuptime-storage-array-agent-fa02",
    );
    // Every probe runs in that container's network, as the collector does.
    expect(run.docker).toContain(
      "--network container:oneuptime-storage-array-agent-fa02",
    );
    expect(run.docker).not.toContain(
      "--network container:oneuptime-storage-array-agent ",
    );
  });

  test("the container compose runs for the directory wins over the name in .env", () => {
    const run = doctor(
      {
        ...NATIVE_ENV,
        STORAGE_ARRAY_AGENT_CONTAINER_NAME: "'array-two'",
      },
      { body: FA_INFO, name: "array-two-renamed" },
    );

    expect(run.output).toContain("✔ Container 'array-two-renamed' is running");
    expect(run.docker).toContain("--network container:array-two-renamed");
  });

  test("an agent whose container is gone is named as its .env names it, with how to start it", () => {
    const run = doctor(
      {
        ...NATIVE_ENV,
        STORAGE_ARRAY_AGENT_CONTAINER_NAME:
          "'oneuptime-storage-array-agent-fa02'",
      },
      { body: FA_INFO, missing: true },
    );

    expect(run.output).toContain(
      "✗ Container 'oneuptime-storage-array-agent-fa02' does not exist.",
    );
    expect(run.output).toContain("docker compose up -d");
    expect(run.status).toBe(1);
  });

  test("without a name in .env, nor a container compose knows, it looks for the default one", () => {
    const run = doctor(NATIVE_ENV, { body: FA_INFO });

    expect(run.output).toContain(
      "✔ Container 'oneuptime-storage-array-agent' is running",
    );
    expect(run.docker).toContain(
      "--network container:oneuptime-storage-array-agent ",
    );
  });

  test("finds a second array's agent by the container compose runs for its directory", () => {
    const run = doctor(NATIVE_ENV, {
      body: FA_INFO,
      name: "oneuptime-storage-array-agent-fa02",
    });

    expect(run.output).toContain(
      "✔ Container 'oneuptime-storage-array-agent-fa02' is running",
    );
    expect(run.docker).toContain(
      "--network container:oneuptime-storage-array-agent-fa02",
    );
  });
});
