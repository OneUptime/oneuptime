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
 * an edited file before replacing it, and stops every profile's exporter
 * before starting what .env selects.
 *
 * troubleshoot.sh: its array probe asks the array the way the collector
 * does — the native endpoint with namespace=purefa, or Pure's exporter with
 * endpoint=<array> — and names the cause: a refused API token, a FlashArray
 * without the native endpoint, an exporter whose profile is off, a
 * certificate the collector does not trust. The API token reaches curl on
 * stdin, never on a command line.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "StorageArrayAgent");
const INGESTION_KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
const FA_TOKEN = "3bc8f0a2-6d1e-4c57-9a0b-1f2e3d4c5b6a";
const FB_TOKEN = "T-7d0c2e1b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

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
 * `docker` records every call with the directory it ran in, and fails
 * `compose up` when $STUB_DIR/up.fail exists. `curl` serves the agent's files
 * from this checkout.
 */
function installStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
case "$*" in
  "compose up"*) [ -f "$STUB_DIR/up.fail" ] && exit 1 ;;
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
rel="\${url#https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/}"
[ -f "${AGENT_DIR}/$rel" ] || exit 22
cp "${AGENT_DIR}/$rel" "$out"
`,
  );
  return bin;
}

function install(dir, { env = {}, input = "" } = {}) {
  const bin = fs.existsSync(path.join(dir, "bin"))
    ? path.join(dir, "bin")
    : installStubs(dir);
  const installDir = path.join(dir, "agent");
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
      STORAGE_ARRAY_INSECURE_SKIP_VERIFY: "true",
    });
    // It holds the array's API token.
    expect(fs.statSync(path.join(run.installDir, ".env")).mode & 0o777).toBe(
      0o600,
    );
    // The token was read without echo.
    expect(run.output).not.toContain(FA_TOKEN);
  });

  test("downloads the compose file and all three configs, so switching the array type is an .env edit", () => {
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
    for (const file of [
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "otel-collector-config.flasharray-exporter.yaml",
      "otel-collector-config.flashblade.yaml",
    ]) {
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
        args: "compose --profile flasharray-exporter --profile flashblade down --remove-orphans",
      },
      { cwd: installDir, args: "compose up -d" },
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
    expect(run.output).toContain("container_name");
  });
});

/* ------------------------------------------------------- troubleshoot.sh */

/*
 * `docker` answers the runtime checks as a healthy install would, reads the
 * container's environment from container.env, answers the OneUptime token
 * probe as a server that accepts the key, and answers the array probe
 * (any /metrics/array URL) from array.out with array.exit as curl's exit
 * code. A `docker run -i` (the array probe) records what it read on stdin.
 * `compose ps` prints compose-ps.out; `inspect` of that id prints
 * container.name.
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
      *restarting*) printf 'running restarting=false restarts=0\\n' ;;
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
      */metrics/array*)
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
function doctor(env, { body = "", status = "200", curlExit = 0, name } = {}) {
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

/* The `docker run` calls that probed the array. */
function arrayProbes(run) {
  return run.docker.split("\n").filter((line) => {
    return line.startsWith("run ") && line.includes("/metrics/array");
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
