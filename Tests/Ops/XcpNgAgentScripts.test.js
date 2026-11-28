"use strict";

/**
 * Runs the XCP-ng Agent's install.sh and troubleshoot.sh for real against a
 * stand-in Xen Orchestra (Utils/FakeXenOrchestra.js: HTTPS with a
 * certificate made here, the plugin's routes, secret check and 401 bodies,
 * and the recorded scrape), with the REAL curl and openssl. Only these are
 * stand-ins:
 *
 *   - docker: records its calls; `docker run <curl image> <args>` (the
 *     doctor's probes) runs this machine's curl with the same arguments,
 *     the files it mounts read from where they are mounted from, and
 *     OneUptime's answers come from files the test writes;
 *   - curl: the agent's files come from Utils/AgentFilesCurlStub (as every
 *     agent's installer suite does); a request to Xen Orchestra is the real
 *     curl;
 *   - xo.example.test resolves to this machine (curl --resolve, and
 *     openssl s_client -connect rewritten), so the certificate is checked
 *     against the name a real install uses.
 *
 * It pins what the scripts do with a person's Xen Orchestra:
 *
 *   - XO_URL becomes XO_SCHEME and XO_ADDRESS (IPv6 in brackets, the port
 *     the scheme implies), and anything that is not an address is refused;
 *   - the certificate is trusted exactly one way: pinned by its SHA-256
 *     fingerprint (any spelling), the CA bundle XO_CA_FILE names, or this
 *     machine's CA bundle when this machine trusts it - else its fingerprint
 *     is shown and pinned only when the person at the terminal confirms it.
 *     A fingerprint that does not match, a certificate with no
 *     subjectAltName (Xen Orchestra's own self-signed one), or a name the
 *     certificate does not list stops the install before anything is
 *     written, started, or sent the secret;
 *   - the secret is checked against Xen Orchestra (the plugin's 401 reasons
 *     read), never on a command line, never printed, written to a mode-600
 *     .env escaped for Compose and for the collector, and read back by a
 *     re-run as typed;
 *   - http:// works for a lab, with a warning;
 *   - a re-run is the upgrade: nothing asked again, the pin checked again;
 *   - the doctor names the first failing step - Xen Orchestra unreachable,
 *     its plugin off, a certificate that is not the pinned one or names no
 *     host, a refused secret, no pools - and never prints the secret.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");
const { createFakeXenOrchestra } = require("./Utils/FakeXenOrchestra");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "XcpNgAgent");
const INSTALL_SCRIPT = path.join(AGENT_DIR, "install.sh");
const DOCTOR_SCRIPT = path.join(AGENT_DIR, "troubleshoot.sh");
const URL = "https://oneuptime.example.com";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
const XO_HOST = "xo.example.test";
// Everything a secret can hold that a shell, Compose or the collector reads.
const SECRET = "s3cr$t'x\"y #z${HOME}";
const REAL_CURL = which("curl");
const REAL_OPENSSL = which("openssl");
const HAS_SCRIPT = Boolean(which("script"));
const IN_CI = Boolean(process.env["CI"]);

jest.setTimeout(120000);

function which(command) {
  const found = spawnSync("bash", ["-c", `command -v ${command}`], {
    encoding: "utf8",
  });
  return found.status === 0 ? found.stdout.trim() : "";
}

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcp-ng-agent-"));
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

/* ------------------------------------------------------------ certificates */

const CERTS_DIR = scratch();

function openssl(args, cwd = CERTS_DIR) {
  const run = spawnSync(REAL_OPENSSL, args, { cwd, encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`openssl ${args.join(" ")}: ${run.stderr}`);
  }
  return run.stdout;
}

/*
 * A certificate for the stand-in Xen Orchestra: self-signed, or issued by
 * `ca`, naming `san` (none when null), valid for `days`.
 */
function makeCertificate(name, { san, days = 400, ca = null, subject }) {
  const key = `${name}.key`;
  const cert = `${name}.pem`;
  const subj = subject || `/CN=${XO_HOST}`;
  if (!ca) {
    const args = ["req", "-x509", "-newkey", "rsa:2048", "-nodes"];
    args.push("-days", String(days), "-subj", subj);
    if (san) {
      args.push("-addext", `subjectAltName=${san}`);
    }
    args.push("-keyout", key, "-out", cert);
    openssl(args);
  } else {
    openssl([
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      subj,
      "-keyout",
      key,
      "-out",
      `${name}.csr`,
    ]);
    fs.writeFileSync(
      path.join(CERTS_DIR, `${name}.ext`),
      `basicConstraints=CA:FALSE\nsubjectAltName=${san}\n`,
    );
    openssl([
      "x509",
      "-req",
      "-in",
      `${name}.csr`,
      "-CA",
      `${ca}.pem`,
      "-CAkey",
      `${ca}.key`,
      "-CAcreateserial",
      "-days",
      String(days),
      "-extfile",
      `${name}.ext`,
      "-out",
      cert,
    ]);
  }
  return {
    name,
    certFile: path.join(CERTS_DIR, cert),
    keyFile: path.join(CERTS_DIR, key),
    cert: fs.readFileSync(path.join(CERTS_DIR, cert)),
    key: fs.readFileSync(path.join(CERTS_DIR, key)),
    fingerprint: openssl([
      "x509",
      "-in",
      cert,
      "-noout",
      "-fingerprint",
      "-sha256",
    ])
      .trim()
      .split("=")[1],
  };
}

const ALL_NAMES = `DNS:${XO_HOST},IP:127.0.0.1,IP:::1`;
const CA = makeCertificate("ca", {
  san: null,
  subject: "/CN=Lab Root CA",
  days: 800,
});
const OTHER_CA = makeCertificate("other-ca", {
  san: null,
  subject: "/CN=Another CA",
  days: 800,
});
const CERTS = {
  caSigned: makeCertificate("ca-signed", { san: ALL_NAMES, ca: "ca" }),
  selfSigned: makeCertificate("self-signed", { san: ALL_NAMES }),
  renewed: makeCertificate("renewed", { san: ALL_NAMES }),
  dnsOnly: makeCertificate("dns-only", { san: `DNS:${XO_HOST}` }),
  expiringSoon: makeCertificate("expiring-soon", { san: ALL_NAMES, days: 2 }),
  // The certificate Xen Orchestra makes for itself (@xen-orchestra/self-signed:
  // `openssl req -batch -new -x509 -days 360 -nodes -newkey rsa:2048`), with
  // the subject a Debian openssl.cnf gives it: no subjectAltName, no CN.
  xoAutoCert: makeCertificate("xo-autocert", {
    san: null,
    days: 360,
    subject: "/C=AU/ST=Some-State/O=Internet Widgits Pty Ltd",
  }),
};

function plainFingerprint(fingerprint) {
  return fingerprint.replace(/:/g, "").toLowerCase();
}

/* ------------------------------------------------------- the stand-in XO */

async function startXo(options = {}) {
  const certificate =
    options.certificate === undefined ? CERTS.selfSigned : options.certificate;
  const fake = createFakeXenOrchestra({
    secret: SECRET,
    ...options,
    cert: certificate ? certificate.cert : null,
    key: certificate ? certificate.key : null,
  });
  const port = await fake.listen(0, "::");
  return { fake, port };
}

// A port nothing listens on.
async function closedPort() {
  const { fake, port } = await startXo();
  await fake.close();
  return port;
}

/* ------------------------------------------------------------------ stubs */

function makeStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });

  writeExecutable(
    path.join(bin, "agent-files-curl"),
    agentFilesCurlStub({
      installName: "xcp-ng-agent",
      agentDirectory: "XcpNgAgent",
      servedDir: AGENT_DIR,
    }),
  );

  // install.sh's curl: the agent's files from the stub, Xen Orchestra for real.
  writeExecutable(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/all-curl.log"
for arg in "$@"; do
  case "$arg" in
    *oneuptime.example.com*|*raw.githubusercontent.com*) exec "$STUB_DIR/bin/agent-files-curl" "$@" ;;
  esac
done
exec "$REAL_CURL" --resolve "${XO_HOST}:\${FAKE_XO_PORT:-1}:127.0.0.1" "$@"
`,
  );

  // openssl s_client connects to this machine for xo.example.test.
  writeExecutable(
    path.join(bin, "openssl"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/openssl.log"
if [ "$1" = "s_client" ]; then
  args=()
  while [ $# -gt 0 ]; do
    if [ "$1" = "-connect" ]; then
      args+=(-connect "\${2/${XO_HOST}/127.0.0.1}")
      shift 2
    else
      args+=("$1")
      shift
    fi
  done
  exec "$REAL_OPENSSL" "\${args[@]}"
fi
exec "$REAL_OPENSSL" "$@"
`,
  );

  /*
   * docker: the installer's compose calls are recorded (with the XO_*,
   * ONEUPTIME_* and XCP_NG_* variables Compose would see), and the doctor's
   * probes run. It is also the engine's containers, in $STUB_DIR/containers
   * (one line per container: name, the directory whose compose project runs
   * it, id). A directory's project is its name, as Compose writes it (lower
   * case, a-z 0-9 _ -, no leading _ or -), so two directories of one name
   * are one project, as they are to Compose. `compose up` gives the agent
   * the name Compose would - the docker-compose.yml's container_name, a
   * ${VAR:-default} read from the environment, else .env - refuses, as
   * Docker does, a name another project's container holds, and recreates
   * the project's container; `compose ps -a -q`, `ps -a --filter
   * label=com.docker.compose.project=...` (the working directories) and
   * `inspect -f {{.Name}}` answer from it. Every directory of $STUB_DIR
   * shares it: one machine. $STUB_DIR/compose-ps, when there, is what
   * `compose ps` says instead (the doctor's tests).
   */
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
REGISTRY="$STUB_DIR/containers"
touch "$REGISTRY"
id_of() { printf '%s' "$1" | sha256sum | cut -c1-12; }
# A directory's Compose project: its name, as Compose writes it.
PROJECT_OF='function project(dir,  base) { base = dir; sub(/.*\\//, "", base); base = tolower(base); gsub(/[^a-z0-9_-]/, "", base); sub(/^[-_]+/, "", base); return base }'
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
case "$1" in
  info) exit 0 ;;
  ps)
    case "$*" in
      "ps -a --filter label=com.docker.compose.project="*)
        want="\${4#label=com.docker.compose.project=}"
        awk -F '\\t' -v want="$want" "$PROJECT_OF"' project($2) == want { print $2 }' "$REGISTRY"
        ;;
    esac
    exit 0 ;;
  compose)
    case "$2" in
      up)
        printf 'compose up sees: %s\\n' "$(env | grep -E '^(XO_|ONEUPTIME_|XCP_NG_)' | sort | tr '\\n' ' ')" >> "$STUB_DIR/docker.log"
        name="$(agent_container_name)"
        holder="$(awk -F '\\t' -v name="$name" -v here="$PWD" "$PROJECT_OF"' $1 == name && project($2) != project(here) { print $2 }' "$REGISTRY")"
        if [ -n "$holder" ]; then
          echo "Error response from daemon: Conflict. The container name \\"/$name\\" is already in use by container \\"$(id_of "$name|$holder")\\". You have to remove (or rename) that container to be able to reuse that name." >&2
          exit 1
        fi
        # --force-recreate: the project's container, under its new name.
        awk -F '\\t' -v here="$PWD" "$PROJECT_OF"' project($2) != project(here)' "$REGISTRY" > "$REGISTRY.new"
        mv "$REGISTRY.new" "$REGISTRY"
        printf '%s\\t%s\\t%s\\n' "$name" "$PWD" "$(id_of "$name|$PWD")" >> "$REGISTRY"
        ;;
      ps)
        if [ -f "$STUB_DIR/compose-ps" ]; then
          cat "$STUB_DIR/compose-ps"
        elif [ "$*" = "compose ps -a -q oneuptime-xcp-ng-agent" ]; then
          awk -F '\\t' -v here="$PWD" "$PROJECT_OF"' project($2) == project(here) { print $3 }' "$REGISTRY"
        fi
        ;;
    esac
    exit 0 ;;
  inspect)
    case "$*" in
      *Config.Env*) cat "$STUB_DIR/container.env" 2>/dev/null ;;
      *restarting*) cat "$STUB_DIR/container.state" 2>/dev/null || printf 'running restarting=false restarts=0\\n' ;;
      *.Name*)
        name="$(awk -F '\\t' -v id="\${!#}" '$3 == id { print $1 }' "$REGISTRY")"
        printf '/%s\\n' "\${name:-oneuptime-xcp-ng-agent}"
        ;;
    esac
    exit 0 ;;
  logs) cat "$STUB_DIR/collector.log" 2>/dev/null; exit 0 ;;
  run)
    shift
    mounts=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --rm|-i) shift ;;
        --network) shift 2 ;;
        -v) mounts+=("$2"); shift 2 ;;
        *) shift; break ;;
      esac
    done
    args=()
    while [ $# -gt 0 ]; do
      if [ "$1" = "--cacert" ]; then
        source_file="$2"
        for mount in "\${mounts[@]}"; do
          rest="\${mount#*:}"
          if [ "\${rest%%:*}" = "$2" ]; then source_file="\${mount%%:*}"; fi
        done
        args+=(--cacert "$source_file")
        shift 2
      else
        args+=("$1")
        shift
      fi
    done
    case "\${args[*]}" in
      *oneuptime.example.com/otlp/v1/validate*)
        cat >/dev/null
        printf '{"valid":true,"keyType":"Server"}\\nOUSTATUS:200\\n'
        exit 0 ;;
      *oneuptime.example.com*)
        cat >/dev/null
        printf '{}\\nOUSTATUS:200\\n'
        exit 0 ;;
      *127.0.0.1:8888/metrics*)
        printf 'otelcol_receiver_accepted_metric_points 500\\notelcol_exporter_sent_metric_points 500\\notelcol_exporter_send_failed_metric_points 0\\n'
        exit 0 ;;
    esac
    exec "$REAL_CURL" --resolve "${XO_HOST}:\${FAKE_XO_PORT:-1}:127.0.0.1" "\${args[@]}"
    ;;
esac
exit 0
`,
  );
  return bin;
}

function stubEnv(dir, port, extra = {}) {
  return {
    PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
    HOME: dir,
    STUB_DIR: dir,
    REAL_CURL,
    REAL_OPENSSL,
    FAKE_XO_PORT: String(port),
    ...extra,
  };
}

function run(command, args, { env, cwd, input = "" }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, detached: true });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.stdin.end(input);
    child.on("close", (status) => {
      resolve({ status, output });
    });
  });
}

/*
 * install.sh in `dir` (a fresh scratch directory unless given), against the
 * stand-in Xen Orchestra on `port`. `tty` runs it under script(1), so its
 * stdin is a terminal.
 */
async function install({
  port,
  env = {},
  input = "",
  dir = null,
  tty = false,
  // A directory other than the default one, so the agent is named after it.
  installDirName = "agent",
}) {
  const work = dir || scratch();
  if (!fs.existsSync(path.join(work, "bin"))) {
    makeStubs(work);
  }
  const installDir = path.join(work, installDirName);
  const fullEnv = stubEnv(work, port, { INSTALL_DIR: installDir, ...env });
  const result = tty
    ? await run("script", ["-qec", `bash ${INSTALL_SCRIPT}`, "/dev/null"], {
        env: fullEnv,
        cwd: work,
        input,
      })
    : await run("bash", [INSTALL_SCRIPT], { env: fullEnv, cwd: work, input });
  const envFile = path.join(installDir, ".env");
  return {
    ...result,
    dir: work,
    installDir,
    envFile,
    envText: readIfExists(envFile),
    caPem: readIfExists(path.join(installDir, "xo-ca.pem")),
    docker: readIfExists(path.join(work, "docker.log")),
    curlLog: readIfExists(path.join(work, "all-curl.log")),
    opensslLog: readIfExists(path.join(work, "openssl.log")),
  };
}

function freshEnv(port, extra = {}) {
  return {
    ONEUPTIME_URL: URL,
    ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
    XO_URL: `https://${XO_HOST}:${port}`,
    XO_OPENMETRICS_SECRET: SECRET,
    XO_NAME: "xo-lab",
    ...extra,
  };
}

// One .env variable, read as Docker Compose reads it (install.sh's dotenv_get).
function dotenv(envFile, name) {
  const helper = fs
    .readFileSync(INSTALL_SCRIPT, "utf8")
    .match(/\ndotenv_get\(\) \{\n[\s\S]*?\n\}\n/)[0];
  const result = spawnSync(
    "bash",
    ["-c", `${helper}\ndotenv_get "$1" "$2"`, "dotenv", name, envFile],
    { encoding: "utf8" },
  );
  return result.stdout;
}

function expectNothingInstalled(result) {
  expect(fs.existsSync(result.installDir)).toBe(false);
  expect(result.docker).not.toContain("compose up");
  expect(result.docker).not.toContain("compose pull");
}

function expectSecretNeverShown(result) {
  for (const text of [
    result.output,
    result.docker,
    result.curlLog,
    result.opensslLog,
  ]) {
    expect(text).not.toContain("s3cr$t");
  }
}

function metricsRequests(fake) {
  return fake.requests.filter((request) => {
    return request.url === "/openmetrics/metrics";
  });
}

/* ---------------------------------------------------- XO_URL, as parsed */

describe("install.sh reads XO_URL into the collector's scheme and address", () => {
  const helper = fs
    .readFileSync(INSTALL_SCRIPT, "utf8")
    .match(/\nparse_xo_url\(\) \{\n[\s\S]*?\n\}\n/)[0];

  function parse(url) {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `${helper}\nif parse_xo_url "$1"; then printf '%s|%s|%s|%s' "$XO_SCHEME" "$XO_ADDRESS" "$XO_HOST" "$XO_PORT"; else exit 1; fi`,
        "parse",
        url,
      ],
      { encoding: "utf8" },
    );
    return { status: result.status, out: result.stdout };
  }

  test.each([
    ["https://xo.example.com", "https|xo.example.com:443|xo.example.com|443"],
    ["https://xo.example.com/", "https|xo.example.com:443|xo.example.com|443"],
    [
      "https://xo.example.com:8443",
      "https|xo.example.com:8443|xo.example.com|8443",
    ],
    ["https://10.0.0.5:8443/", "https|10.0.0.5:8443|10.0.0.5|8443"],
    ["http://10.0.0.5", "http|10.0.0.5:80|10.0.0.5|80"],
    ["http://xo.lab:8080", "http|xo.lab:8080|xo.lab|8080"],
    ["xo.example.com", "https|xo.example.com:443|xo.example.com|443"],
    ["HTTPS://XO.Example.COM", "https|xo.example.com:443|xo.example.com|443"],
    [
      "  https://xo.example.com  ",
      "https|xo.example.com:443|xo.example.com|443",
    ],
    ["https://[fd00::5]", "https|[fd00::5]:443|fd00::5|443"],
    ["https://[FD00::5]:8443/", "https|[fd00::5]:8443|fd00::5|8443"],
    ["http://[::1]:8080", "http|[::1]:8080|::1|8080"],
    [
      "https://xo_internal.corp:443",
      "https|xo_internal.corp:443|xo_internal.corp|443",
    ],
    [
      "https://xo.example.com:08443",
      "https|xo.example.com:8443|xo.example.com|8443",
    ],
  ])("%s", (url, expected) => {
    expect(parse(url)).toEqual({ status: 0, out: expected });
  });

  test.each([
    ["", "XO_URL is empty"],
    ["ftp://xo.example.com", "must start with https://"],
    ["https://xo.example.com/xo", "without a path"],
    ["https://xo.example.com/openmetrics/metrics", "without a path"],
    ["https://xo.example.com?a=1", "without a path"],
    [
      "https://admin:pw@xo.example.com",
      "must not hold a user name or password",
    ],
    ["https://fd00::5", "square brackets"],
    [
      "https://[fd00::5",
      "not a host name or an IPv6 address in square brackets",
    ],
    ["https://[xo.example.com]", "is not an IPv6 address"],
    ["https://xo.example.com:http", "is not a number"],
    ["https://xo.example.com:70000", "is not a port"],
    ["https://xo.example.com:0", "is not a port"],
    ["https://-xo.example.com", "is not a host name"],
    ["https://xo example.com", "is not a host name"],
    ["https://", "is not a host name"],
  ])("refuses %j", (url, reason) => {
    const result = spawnSync(
      "bash",
      ["-c", `${helper}\nparse_xo_url "$1"`, "parse", url],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(reason);
  });
});

/* ---------------------------------------- install.sh: trusting Xen Orchestra */

describe("install.sh trusts Xen Orchestra's certificate one way, and stops otherwise", () => {
  test("a certificate this machine trusts: its CA bundle becomes xo-ca.pem, and the agent starts", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.caSigned });
    const result = await install({
      port,
      env: freshEnv(port, { CURL_CA_BUNDLE: CA.certFile }),
    });
    await fake.close();

    expect(result.output).toContain(
      `This machine trusts Xen Orchestra's certificate: the agent trusts the same CA bundle (${CA.certFile}).`,
    );
    expect(result.status).toBe(0);
    expect(result.caPem).toBe(CA.cert.toString());
    expect(
      (
        fs.statSync(path.join(result.installDir, "xo-ca.pem")).mode & 0o777
      ).toString(8),
    ).toBe("644");
    expect(result.output).toContain(
      "Xen Orchestra accepts the secret and reports 2 pool(s): Production, (a pool with no name)",
    );
    // It asked for the metrics once, with the secret, after checking the certificate.
    expect(metricsRequests(fake)).toHaveLength(1);
    expect(metricsRequests(fake)[0].authorization).toBe(`Bearer ${SECRET}`);
    expect(dotenv(result.envFile, "XO_TLS_FINGERPRINT")).toBe("");
    expect(dotenv(result.envFile, "XO_CA_FILE")).toBe("");
    expect(result.docker).toContain(`${result.installDir} | compose pull`);
    expect(result.docker).toContain(
      `${result.installDir} | compose up -d --force-recreate`,
    );
    expectSecretNeverShown(result);
  });

  test("XO_TLS_FINGERPRINT: Xen Orchestra's own certificate is pinned, and nothing else trusted", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const result = await install({
      port,
      env: freshEnv(port, { XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "Xen Orchestra's certificate matches XO_TLS_FINGERPRINT: the agent trusts it, and only it.",
    );
    expect(result.caPem).toBe(CERTS.selfSigned.cert.toString());
    expect(dotenv(result.envFile, "XO_TLS_FINGERPRINT")).toBe(
      CERTS.selfSigned.fingerprint,
    );
    expect(metricsRequests(fake)).toHaveLength(1);
    expectSecretNeverShown(result);
  });

  test("a fingerprint is read in any spelling openssl or a person gives it", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.caSigned });
    for (const spelling of [
      plainFingerprint(CERTS.caSigned.fingerprint),
      `sha256 Fingerprint=${CERTS.caSigned.fingerprint}`,
      CERTS.caSigned.fingerprint.toLowerCase().replace(/:/g, " "),
    ]) {
      const result = await install({
        port,
        env: freshEnv(port, { XO_TLS_FINGERPRINT: spelling }),
      });
      expect({ spelling, status: result.status }).toEqual({
        spelling,
        status: 0,
      });
      // A certificate a CA issued, pinned as itself: the leaf is what is trusted.
      expect(result.caPem).toBe(CERTS.caSigned.cert.toString());
    }
    await fake.close();
  });

  test("a fingerprint that does not match stops everything, and the secret is never sent", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.renewed });
    const result = await install({
      port,
      env: freshEnv(port, { XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: Xen Orchestra's certificate is NOT the one XO_TLS_FINGERPRINT pins.",
    );
    expect(result.output).toContain(
      `  XO_TLS_FINGERPRINT:    ${CERTS.selfSigned.fingerprint}`,
    );
    expect(result.output).toContain(
      `  Xen Orchestra presents: ${CERTS.renewed.fingerprint}`,
    );
    expect(metricsRequests(fake)).toHaveLength(0);
    expectNothingInstalled(result);
    expectSecretNeverShown(result);
  });

  test("a value that is no SHA-256 fingerprint is refused before Xen Orchestra is asked anything", async () => {
    const { fake, port } = await startXo();
    const result = await install({
      port,
      env: freshEnv(port, { XO_TLS_FINGERPRINT: "AB:CD:EF" }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "XO_TLS_FINGERPRINT is not a SHA-256 fingerprint",
    );
    expect(fake.requests).toHaveLength(0);
    expectNothingInstalled(result);
  });

  test("XO_CA_FILE: the bundle is checked against Xen Orchestra, copied as xo-ca.pem and kept by its full path", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.caSigned });
    const dir = scratch();
    fs.copyFileSync(CA.certFile, path.join(dir, "lab-ca.pem"));
    const result = await install({
      port,
      dir,
      // Relative to where the script was started.
      env: freshEnv(port, { XO_CA_FILE: "lab-ca.pem" }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "Xen Orchestra's certificate checks out against XO_CA_FILE: the agent trusts that CA bundle.",
    );
    expect(result.caPem).toBe(CA.cert.toString());
    expect(dotenv(result.envFile, "XO_CA_FILE")).toBe(
      path.join(dir, "lab-ca.pem"),
    );
  });

  test("XO_CA_FILE that did not issue the certificate stops the install", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.caSigned });
    const result = await install({
      port,
      env: freshEnv(port, { XO_CA_FILE: OTHER_CA.certFile }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: Xen Orchestra's certificate does not check out against XO_CA_FILE",
    );
    expect(metricsRequests(fake)).toHaveLength(0);
    expectNothingInstalled(result);
  });

  test("a certificate nobody vouches for, with no one at a terminal: its fingerprint is shown and nothing installed", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const result = await install({ port, env: freshEnv(port) });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "This machine does not trust Xen Orchestra's certificate",
    );
    expect(result.output).toContain(
      `    SHA-256 fingerprint: ${CERTS.selfSigned.fingerprint}`,
    );
    expect(result.output).toContain(
      `  XO_TLS_FINGERPRINT=${CERTS.selfSigned.fingerprint}`,
    );
    expect(result.output).toContain("Nobody is at a terminal to confirm it");
    expect(metricsRequests(fake)).toHaveLength(0);
    expectNothingInstalled(result);
  });

  const describeWithScript = HAS_SCRIPT || IN_CI ? describe : describe.skip;
  if (!HAS_SCRIPT && !IN_CI) {
    // eslint-disable-next-line no-console
    console.log(
      "script(1) is not installed here: the terminal confirmations are skipped.",
    );
  }

  describeWithScript(
    "at a terminal, the person confirms the fingerprint",
    () => {
      test("yes pins it, and writes the fingerprint to .env", async () => {
        const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
        const result = await install({
          port,
          env: freshEnv(port),
          input: "y\n",
          tty: true,
        });
        await fake.close();

        expect(result.output).toContain(
          "Is it the same? Trust this certificate, and only it? [y/N]:",
        );
        expect(result.status).toBe(0);
        expect(result.output).toContain(
          `Pinned: XO_TLS_FINGERPRINT=${CERTS.selfSigned.fingerprint}`,
        );
        expect(result.caPem).toBe(CERTS.selfSigned.cert.toString());
        expect(dotenv(result.envFile, "XO_TLS_FINGERPRINT")).toBe(
          CERTS.selfSigned.fingerprint,
        );
      });

      test("anything else trusts nothing", async () => {
        const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
        const result = await install({
          port,
          env: freshEnv(port),
          input: "n\n",
          tty: true,
        });
        await fake.close();

        expect(result.status).toBe(1);
        expect(result.output).toContain("Not trusted: nothing was installed.");
        expect(metricsRequests(fake)).toHaveLength(0);
        expectNothingInstalled(result);
      });
    },
  );

  test("Xen Orchestra's own self-signed certificate names no host: refused even pinned, and why", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.xoAutoCert });
    const result = await install({
      port,
      env: freshEnv(port, { XO_TLS_FINGERPRINT: CERTS.xoAutoCert.fingerprint }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: Xen Orchestra's certificate is issued to no name (it has no subjectAltName):",
    );
    expect(result.output).toContain(
      "It is most likely the self-signed certificate Xen Orchestra makes for itself.",
    );
    expect(result.output).toContain('"Xen Orchestra\'s certificate"');
    expect(metricsRequests(fake)).toHaveLength(0);
    expectNothingInstalled(result);
  });

  test("an address the certificate does not list: the name it does list is checked instead (XO_TLS_SERVER_NAME)", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.dnsOnly });
    const result = await install({
      port,
      env: freshEnv(port, {
        XO_URL: `https://127.0.0.1:${port}`,
        XO_TLS_FINGERPRINT: CERTS.dnsOnly.fingerprint,
      }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      `Xen Orchestra's certificate is not issued to 127.0.0.1 but to ${XO_HOST}`,
    );
    expect(dotenv(result.envFile, "XO_TLS_SERVER_NAME")).toBe(XO_HOST);
    expect(dotenv(result.envFile, "XO_ADDRESS")).toBe(`127.0.0.1:${port}`);
    // The secret went to 127.0.0.1, checked as xo.example.test.
    expect(result.curlLog).toContain(
      `--connect-to ${XO_HOST}:${port}:127.0.0.1:${port}`,
    );
    expect(metricsRequests(fake)).toHaveLength(1);
    // And the loopback warning: inside the container, 127.0.0.1 is the container.
    expect(result.output).toContain(
      "Warning: XO_URL names this machine's loopback (127.0.0.1).",
    );
  });

  test("an XO_TLS_SERVER_NAME the certificate does not list stops the install", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const result = await install({
      port,
      env: freshEnv(port, {
        XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
        XO_TLS_SERVER_NAME: "other.example.test",
      }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: Xen Orchestra's certificate is not issued to XO_TLS_SERVER_NAME (other.example.test).",
    );
    expectNothingInstalled(result);
  });

  test("an IPv6 address, in brackets, with the certificate checked against it", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const result = await install({
      port,
      env: freshEnv(port, {
        XO_URL: `https://[::1]:${port}`,
        XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
        XO_NAME: "",
      }),
      // Enter at the name's prompt.
      input: "\n",
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(dotenv(result.envFile, "XO_ADDRESS")).toBe(`[::1]:${port}`);
    expect(dotenv(result.envFile, "XO_SCHEME")).toBe("https");
    expect(dotenv(result.envFile, "XO_TLS_SERVER_NAME")).toBe("");
    // The name defaults to the address's host.
    expect(dotenv(result.envFile, "XO_NAME")).toBe("::1");
    expect(metricsRequests(fake)).toHaveLength(1);
  });

  test("a certificate that expires within 30 days is said so", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.expiringSoon });
    const result = await install({
      port,
      env: freshEnv(port, {
        XO_TLS_FINGERPRINT: CERTS.expiringSoon.fingerprint,
      }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "Warning: Xen Orchestra's certificate expires within 30 days",
    );
  });

  test("Xen Orchestra not answering a fresh install stops it", async () => {
    const port = await closedPort();
    const result = await install({ port, env: freshEnv(port) });

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: could not read Xen Orchestra's certificate at",
    );
    expectNothingInstalled(result);
  });
});

/* ----------------------------------------------- install.sh: the secret */

describe("install.sh checks the secret with Xen Orchestra, and keeps it", () => {
  test("a wrong secret is refused with the plugin's reason, nothing installed, and it is never shown", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const result = await install({
      port,
      env: freshEnv(port, {
        XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
        XO_OPENMETRICS_SECRET: "s3cr$t-but-wrong",
      }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: Xen Orchestra refused the secret: it is not the OpenMetrics plugin's secret.",
    );
    expect(metricsRequests(fake)[0].verdict).toBe("wrong-secret");
    expectNothingInstalled(result);
    expectSecretNeverShown(result);
  });

  test("the plugin turned off: Xen Orchestra's proxy error is read as such", async () => {
    const { fake, port } = await startXo({
      certificate: CERTS.selfSigned,
      plugin: "off",
    });
    const result = await install({
      port,
      env: freshEnv(port, { XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: Xen Orchestra answers, but its OpenMetrics plugin does not (HTTP 500).",
    );
    expectNothingInstalled(result);
  });

  test("a Xen Orchestra connected to no pool installs, and says the pools come later", async () => {
    const { fake, port } = await startXo({
      certificate: CERTS.selfSigned,
      noPools: true,
    });
    const result = await install({
      port,
      env: freshEnv(port, { XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "Xen Orchestra accepts the secret, but is connected to no pool yet",
    );
  });

  test("the .env is mode 600, quoted for Compose, the secret escaped once more for the collector", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const result = await install({
      port,
      env: freshEnv(port, {
        XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
        XO_NAME: "Lab XO #2",
      }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect((fs.statSync(result.envFile).mode & 0o777).toString(8)).toBe("600");
    const lines = result.envText.split("\n");
    expect(lines[0]).toBe(
      "# XO_OPENMETRICS_SECRET is escaped for the collector: every $ is written as $$.",
    );
    // Compose reads back the secret with every $ doubled: what the collector
    // turns into the secret as typed.
    expect(dotenv(result.envFile, "XO_OPENMETRICS_SECRET")).toBe(
      SECRET.replace(/\$/g, "$$$$"),
    );
    expect(dotenv(result.envFile, "XO_NAME")).toBe("Lab XO #2");
    expect(dotenv(result.envFile, "XO_URL")).toBe(`https://${XO_HOST}:${port}`);
    expect(dotenv(result.envFile, "XO_SCHEME")).toBe("https");
    expect(dotenv(result.envFile, "XO_ADDRESS")).toBe(`${XO_HOST}:${port}`);
    expect(lines).toContain("XO_SCHEME=https");
    // Compose was started from .env alone: none of these in its environment.
    expect(result.docker).toContain("compose up sees: \n");
  });

  /*
   * The .env read by the real Docker Compose, as the container gets it: the
   * secret (a $, both quotes, a #, a space and a ${...}) with every $
   * doubled, which the collector turns back into the secret as typed
   * (xcp-ng-agent-scrape-behaviour.sh shows it reach Xen Orchestra so). The
   * Ops workflow's runner has Compose and must run this; elsewhere it is
   * skipped with the reason logged.
   */
  const COMPOSE_PROBE = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  const HAS_COMPOSE = !COMPOSE_PROBE.error && COMPOSE_PROBE.status === 0;
  if (!HAS_COMPOSE && !IN_CI) {
    // eslint-disable-next-line no-console
    console.log(
      "The Docker Compose round trip is skipped: `docker compose` is not available here.",
    );
  }
  (HAS_COMPOSE || IN_CI ? test : test.skip)(
    "the real Docker Compose hands the container what the collector needs, as typed",
    async () => {
      const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
      const result = await install({
        port,
        env: freshEnv(port, {
          XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
          XO_NAME: "Lab XO #2",
        }),
      });
      await fake.close();
      expect(result.status).toBe(0);

      const rendered = spawnSync(
        "docker",
        ["compose", "config", "--format", "json"],
        {
          cwd: result.installDir,
          env: { PATH: process.env.PATH, HOME: result.installDir },
          encoding: "utf8",
          timeout: 60000,
        },
      );
      expect(rendered.stderr).not.toContain("error");
      expect(rendered.status).toBe(0);
      const service = JSON.parse(rendered.stdout).services[
        "oneuptime-xcp-ng-agent"
      ];
      const environment = {};
      for (const [name, value] of Object.entries(service.environment)) {
        // `config` prints a literal $ as $$.
        environment[name] =
          value === null ? "" : String(value).replace(/\$\$/g, "$");
      }
      expect(environment).toEqual({
        ONEUPTIME_URL: URL,
        ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
        XO_SCHEME: "https",
        XO_ADDRESS: `${XO_HOST}:${port}`,
        XO_OPENMETRICS_SECRET: SECRET.replace(/\$/g, "$$$$"),
        XO_NAME: "Lab XO #2",
        XO_TLS_SERVER_NAME: "",
      });
      // The certificates install.sh wrote, where the config reads them.
      expect(
        service.volumes.find((volume) => {
          return volume.target === "/etc/oneuptime/xo-ca.pem";
        }),
      ).toEqual(
        expect.objectContaining({
          type: "bind",
          source: path.join(result.installDir, "xo-ca.pem"),
          read_only: true,
        }),
      );
    },
  );

  test("a prompted install takes each answer in turn, and never shows the secret", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.caSigned });
    const result = await install({
      port,
      env: { CURL_CA_BUNDLE: CA.certFile },
      input: [
        URL,
        KEY,
        `https://${XO_HOST}:${port}`,
        SECRET,
        "", // the name: Enter keeps the address's host
        "",
      ].join("\n"),
    });
    await fake.close();

    expect(result.status).toBe(0);
    // Each answer went where it belongs (bash shows a prompt on a terminal only).
    expect(dotenv(result.envFile, "ONEUPTIME_URL")).toBe(URL);
    expect(dotenv(result.envFile, "ONEUPTIME_TELEMETRY_INGESTION_KEY")).toBe(
      KEY,
    );
    expect(dotenv(result.envFile, "XO_URL")).toBe(`https://${XO_HOST}:${port}`);
    expect(dotenv(result.envFile, "XO_NAME")).toBe(XO_HOST);
    expect(metricsRequests(fake)[0].authorization).toBe(`Bearer ${SECRET}`);
    expectSecretNeverShown(result);
  });

  test("http:// works in a lab, with a warning, and the collector still gets a CA bundle", async () => {
    const { fake, port } = await startXo({ certificate: null });
    const result = await install({
      port,
      env: freshEnv(port, {
        XO_URL: `http://${XO_HOST}:${port}`,
        CURL_CA_BUNDLE: CA.certFile,
      }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "WARNING: XO_URL uses http://. The OpenMetrics secret, and everything Xen Orchestra",
    );
    expect(result.opensslLog).not.toContain("s_client");
    expect(dotenv(result.envFile, "XO_SCHEME")).toBe("http");
    expect(result.caPem).toContain("BEGIN CERTIFICATE");
    expect(metricsRequests(fake)).toHaveLength(1);
    expectSecretNeverShown(result);
  });
});

/* ------------------------------------------------ install.sh: the upgrade */

describe("install.sh run again is the upgrade", () => {
  test("nothing is asked, the pin is checked again, and the secret read back as typed", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const first = await install({
      port,
      env: freshEnv(port, { XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint }),
    });
    expect(first.status).toBe(0);
    // An edit of the reader's to the config.
    fs.appendFileSync(
      path.join(first.installDir, "otel-collector-config.yaml"),
      "# my edit\n",
    );

    const again = await install({ port, dir: first.dir, env: {}, input: "" });
    await fake.close();

    expect(again.status).toBe(0);
    expect(again.output).toContain("Found an existing configuration in");
    expect(again.output).not.toContain("OneUptime URL (e.g.");
    expect(again.output).toContain(
      "Xen Orchestra's certificate matches XO_TLS_FINGERPRINT",
    );
    expect(
      metricsRequests(fake).map((request) => request.authorization),
    ).toEqual([`Bearer ${SECRET}`, `Bearer ${SECRET}`]);
    expect(again.envText).toBe(first.envText);
    expect(
      fs.readdirSync(again.installDir).filter((file) => file.includes(".bak.")),
    ).toEqual([expect.stringMatching(/^otel-collector-config\.yaml\.bak\./)]);
    expect(
      again.docker.split("compose up -d --force-recreate").length - 1,
    ).toBe(2);
  });

  test("Xen Orchestra's certificate changed since: the upgrade stops, and the installed agent is left as it was", async () => {
    const original = await startXo({ certificate: CERTS.selfSigned });
    const first = await install({
      port: original.port,
      env: freshEnv(original.port, {
        XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
      }),
    });
    await original.fake.close();
    expect(first.status).toBe(0);

    const renewed = await startXo({ certificate: CERTS.renewed });
    // The same address: the .env names the first port.
    const envText = first.envText
      .split(String(original.port))
      .join(String(renewed.port));
    fs.writeFileSync(first.envFile, envText);
    const again = await install({
      port: renewed.port,
      dir: first.dir,
      env: {},
    });
    await renewed.fake.close();

    expect(again.status).toBe(1);
    expect(again.output).toContain(
      "Error: Xen Orchestra's certificate is NOT the one XO_TLS_FINGERPRINT pins.",
    );
    expect(again.envText).toBe(envText);
    expect(again.caPem).toBe(CERTS.selfSigned.cert.toString());
    expect(metricsRequests(renewed.fake)).toHaveLength(0);
  });

  test("Xen Orchestra down during the upgrade: the trusted certificate is kept and the upgrade goes on", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const first = await install({
      port,
      env: freshEnv(port, { XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint }),
    });
    await fake.close();
    expect(first.status).toBe(0);

    const again = await install({ port, dir: first.dir, env: {} });

    expect(again.status).toBe(0);
    expect(again.output).toContain("Warning: could not reach Xen Orchestra at");
    expect(again.output).toContain(
      "Keeping the certificates the agent already trusts",
    );
    expect(again.caPem).toBe(CERTS.selfSigned.cert.toString());
    expect(again.envText).toBe(first.envText);
  });
});

/* ---------------------------------------- install.sh: the container name */

/*
 * Two containers cannot share a name, so a second Xen Orchestra's agent on
 * the same machine runs under a name of its own: XCP_NG_AGENT_CONTAINER_NAME
 * in .env, which docker-compose.yml's container_name reads. Re-running
 * install.sh is the upgrade and replaces docker-compose.yml, never .env, so
 * the name survives it - and an agent set up before .env held the name, whose
 * docker-compose.yml was given its name by hand, keeps it too. These run
 * several installs against one stand-in engine (makeStubs): one machine.
 */
const DEFAULT_CONTAINER = "oneuptime-xcp-ng-agent";
const CONTAINER_VARIABLE = "XCP_NG_AGENT_CONTAINER_NAME";

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

// What `docker compose up -d` in `project` leaves: its container under `name`.
function runContainerAs(dir, project, name) {
  const registry = path.join(dir, "containers");
  const kept = readIfExists(registry)
    .split("\n")
    .filter((line) => {
      return line && line.split("\t")[1] !== project;
    });
  if (name) {
    const id = crypto
      .createHash("sha256")
      .update(`${name}|${project}`)
      .digest("hex")
      .slice(0, 12);
    kept.push(`${name}\t${project}\t${id}`);
  }
  fs.writeFileSync(registry, kept.length ? `${kept.join("\n")}\n` : "");
}

// What the docker-compose.yml of a release before .env held the name had.
function shippedBeforeEnvHeldTheName() {
  const text = fs
    .readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8")
    .replace(
      /^ {4}container_name: \$\{XCP_NG_AGENT_CONTAINER_NAME:-oneuptime-xcp-ng-agent\}$/m,
      `    container_name: ${DEFAULT_CONTAINER}`,
    );
  expect(text).toContain(`\n    container_name: ${DEFAULT_CONTAINER}\n`);
  return text;
}

function renameTo(name) {
  return (text) => {
    return text.replace(
      `\n    container_name: ${DEFAULT_CONTAINER}\n`,
      `\n    container_name: ${name}\n`,
    );
  };
}

// An agent, pinned to this Xen Orchestra, in <dir>/<installDirName>.
async function pinnedAgent({ port, dir, installDirName, env = {} }) {
  const result = await install({
    port,
    dir,
    installDirName,
    env: freshEnv(port, {
      XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
      ...env,
    }),
  });
  expect(result.status).toBe(0);
  return result;
}

/*
 * An agent install.sh set up before .env held its container name: that
 * release's docker-compose.yml, recorded in .agent-files.sha256 as installed,
 * an .env without XCP_NG_AGENT_CONTAINER_NAME; then `edit` made to
 * docker-compose.yml (the name README.md asked a second agent for) and
 * `docker compose up -d`, so its container runs under the name it gives.
 */
async function agentFromBefore({
  port,
  dir,
  installDirName,
  edit = (text) => {
    return text;
  },
  running = true,
}) {
  const installed = await pinnedAgent({ port, dir, installDirName });
  const shipped = shippedBeforeEnvHeldTheName();
  const recordFile = path.join(installed.installDir, ".agent-files.sha256");
  fs.writeFileSync(
    recordFile,
    fs
      .readFileSync(recordFile, "utf8")
      .replace(
        /^[0-9a-f]{64} {2}docker-compose\.yml$/m,
        `${crypto.createHash("sha256").update(shipped).digest("hex")}  docker-compose.yml`,
      ),
  );
  fs.writeFileSync(
    installed.envFile,
    installed.envText
      .split("\n")
      .filter((line) => {
        return !line.startsWith(`${CONTAINER_VARIABLE}=`);
      })
      .join("\n"),
  );
  const edited = edit(shipped);
  fs.writeFileSync(
    path.join(installed.installDir, "docker-compose.yml"),
    edited,
  );
  const named = /^ {4}container_name: (\S+)$/m.exec(edited)[1];
  runContainerAs(dir, installed.installDir, running ? named : null);
  return { installDir: installed.installDir, shipped, edited };
}

function backupsIn(installDir) {
  return fs
    .readdirSync(installDir)
    .filter((file) => {
      return file.includes(".bak.");
    })
    .sort();
}

describe("install.sh gives each agent on a machine its own container name, and keeps it", () => {
  test("a first agent, in the default directory, is named as it always was", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const result = await pinnedAgent({
      port,
      dir,
      installDirName: DEFAULT_CONTAINER,
    });
    await fake.close();

    expect(dotenv(result.envFile, CONTAINER_VARIABLE)).toBe(DEFAULT_CONTAINER);
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: result.installDir,
    });
    expect(result.output).not.toContain("The agent's container");
    expect(
      fs.readFileSync(
        path.join(result.installDir, "docker-compose.yml"),
        "utf8",
      ),
    ).toBe(fs.readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8"));
  });

  test("a second Xen Orchestra's agent is named after its directory, both run, and its upgrade keeps the name", async () => {
    const production = await startXo({ certificate: CERTS.selfSigned });
    const lab = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const first = await pinnedAgent({
      port: production.port,
      dir,
      installDirName: DEFAULT_CONTAINER,
    });
    const second = await pinnedAgent({
      port: lab.port,
      dir,
      installDirName: `${DEFAULT_CONTAINER}-lab`,
      env: { XO_NAME: "xo-lab" },
    });

    expect(dotenv(second.envFile, CONTAINER_VARIABLE)).toBe(
      `${DEFAULT_CONTAINER}-lab`,
    );
    expect(second.output).toContain(
      `The agent's container is ${DEFAULT_CONTAINER}-lab, named after its directory, so it does\nnot take the name of another Xen Orchestra's agent on this machine.`,
    );
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      [`${DEFAULT_CONTAINER}-lab`]: second.installDir,
    });

    // The upgrade: no input, nothing exported.
    const again = await install({
      port: lab.port,
      dir,
      installDirName: `${DEFAULT_CONTAINER}-lab`,
    });
    await production.fake.close();
    await lab.fake.close();

    expect(again.status).toBe(0);
    expect(again.output).toContain("Found an existing configuration in");
    expect(again.envText).toBe(second.envText);
    expect(again.output).not.toContain("named after its directory");
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      [`${DEFAULT_CONTAINER}-lab`]: second.installDir,
    });
  });

  test("an exported name is the agent's, written to .env, and never handed to Compose from the shell", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const result = await pinnedAgent({
      port,
      dir,
      installDirName: "lab",
      env: { [CONTAINER_VARIABLE]: "xo-lab-agent" },
    });

    expect(result.envText.split("\n")).toContain(
      `${CONTAINER_VARIABLE}='xo-lab-agent'`,
    );
    expect(result.output).toContain(
      `The agent's container is xo-lab-agent (${CONTAINER_VARIABLE}).`,
    );
    expect(containersOn(dir)).toEqual({ "xo-lab-agent": result.installDir });
    // Compose read it from .env, as every later `docker compose up` will.
    expect(result.docker).toContain("compose up sees: \n");

    const again = await install({ port, dir, installDirName: "lab" });
    await fake.close();
    expect(again.status).toBe(0);
    expect(again.envText).toBe(result.envText);
    expect(containersOn(dir)).toEqual({ "xo-lab-agent": result.installDir });
  });

  test.each(["my agent", "-agent", "x", "agent$1", "agent/2"])(
    "refuses %j, a name Docker would refuse, before Xen Orchestra is asked anything",
    async (name) => {
      const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
      const result = await install({
        port,
        env: freshEnv(port, {
          XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
          [CONTAINER_VARIABLE]: name,
        }),
      });
      await fake.close();

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `Error: ${CONTAINER_VARIABLE}="${name}" is not a container name: a letter or a\ndigit, then letters, digits, _, . or - (e.g. ${DEFAULT_CONTAINER}-lab).`,
      );
      expect(fake.requests).toHaveLength(0);
      expectNothingInstalled(result);
    },
  );

  test("a name another directory's container holds stops the start, and says how to give this agent its own", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const first = await pinnedAgent({
      port,
      dir,
      installDirName: DEFAULT_CONTAINER,
    });
    const clash = await install({
      port,
      dir,
      installDirName: "lab",
      env: freshEnv(port, {
        XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
        [CONTAINER_VARIABLE]: DEFAULT_CONTAINER,
      }),
    });
    await fake.close();

    expect(clash.status).toBe(1);
    expect(clash.output).toContain(
      `"${DEFAULT_CONTAINER}" is already in use, another container on this machine has it (another\nXen Orchestra's agent, say): give this agent a name of its own and run this again, e.g.`,
    );
    expect(clash.output).toContain(
      `  ${CONTAINER_VARIABLE}=${DEFAULT_CONTAINER}-<name> INSTALL_DIR=${clash.installDir} bash install.sh`,
    );
    expect(clash.output).not.toContain("container_name in");
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
    });
  });
});

describe("install.sh keeps the name of an agent set up before .env held it", () => {
  test("a second agent whose docker-compose.yml was given its own name keeps it on upgrade, and the first is untouched", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const first = await agentFromBefore({
      port,
      dir,
      installDirName: DEFAULT_CONTAINER,
    });
    const second = await agentFromBefore({
      port,
      dir,
      installDirName: "xo-lab",
      edit: renameTo("xen-lab"),
    });
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      "xen-lab": second.installDir,
    });

    const upgraded = await install({ port, dir, installDirName: "xo-lab" });

    expect(upgraded.status).toBe(0);
    // Its own name, not its directory's (oneuptime-xcp-ng-agent-xo-lab).
    expect(dotenv(upgraded.envFile, CONTAINER_VARIABLE)).toBe("xen-lab");
    expect(upgraded.output).toContain(
      "The agent's container keeps its name, xen-lab, from its docker-compose.yml.",
    );
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      "xen-lab": second.installDir,
    });
    const backups = backupsIn(second.installDir);
    expect(backups).toEqual([
      expect.stringMatching(/^docker-compose\.yml\.bak\.\d{14}$/),
    ]);
    expect(
      fs.readFileSync(path.join(second.installDir, backups[0]), "utf8"),
    ).toBe(second.edited);
    expect(upgraded.output).toContain(
      `Your docker-compose.yml gave the agent's container a name of its own, the one change\nyou had made to it. The new docker-compose.yml reads the name from .env\n(${CONTAINER_VARIABLE}=xen-lab), so there is nothing to make again.\nYour copy is kept: ${path.join(second.installDir, backups[0])}`,
    );
    expect(upgraded.output).not.toContain("You had edited these files");

    // The first agent's upgrade: the default name, and nothing to say.
    const firstUpgraded = await install({
      port,
      dir,
      installDirName: DEFAULT_CONTAINER,
    });
    await fake.close();
    expect(firstUpgraded.status).toBe(0);
    expect(dotenv(firstUpgraded.envFile, CONTAINER_VARIABLE)).toBe(
      DEFAULT_CONTAINER,
    );
    expect(firstUpgraded.output).not.toContain("The agent's container");
    expect(backupsIn(first.installDir)).toEqual([]);
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      "xen-lab": second.installDir,
    });
  });

  test("the name and another edit: the other one is named as one to make again, and the name is not", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const second = await agentFromBefore({
      port,
      dir,
      installDirName: "xo-lab",
      edit: (text) => {
        const edited = renameTo("xen-lab")(text).replace(
          'max-size: "10m"',
          'max-size: "50m"',
        );
        expect(edited).toContain('max-size: "50m"');
        return edited;
      },
    });

    const upgraded = await install({ port, dir, installDirName: "xo-lab" });
    await fake.close();

    expect(upgraded.status).toBe(0);
    expect(dotenv(upgraded.envFile, CONTAINER_VARIABLE)).toBe("xen-lab");
    const backups = backupsIn(second.installDir);
    expect(upgraded.output).toContain(
      `the current versions; your copies are kept next to them:\n  ${path.join(second.installDir, backups[0])}`,
    );
    expect(upgraded.output).toContain(
      `The new docker-compose.yml reads the agent's container name from .env\n(${CONTAINER_VARIABLE}=xen-lab): leave its container_name line\nas it is when you make your other changes again.`,
    );
  });

  test("after an older install.sh's upgrade put the default name back, the name comes back from the copy it kept", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const first = await agentFromBefore({
      port,
      dir,
      installDirName: DEFAULT_CONTAINER,
    });
    const second = await agentFromBefore({
      port,
      dir,
      installDirName: "xo-lab",
      edit: renameTo("xen-lab"),
    });
    // What the install.sh before this one did: kept the edited file, put the
    // default name back, and could not start the agent beside the first.
    fs.copyFileSync(
      path.join(second.installDir, "docker-compose.yml"),
      path.join(second.installDir, "docker-compose.yml.bak.20261101090000"),
    );
    fs.writeFileSync(
      path.join(second.installDir, "docker-compose.yml"),
      second.shipped,
    );
    runContainerAs(dir, second.installDir, null);

    const upgraded = await install({ port, dir, installDirName: "xo-lab" });
    await fake.close();

    expect(upgraded.status).toBe(0);
    expect(dotenv(upgraded.envFile, CONTAINER_VARIABLE)).toBe("xen-lab");
    expect(upgraded.output).toContain(
      "The agent's container keeps its name, xen-lab, from its docker-compose.yml, kept as a backup by an earlier upgrade.",
    );
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
      "xen-lab": second.installDir,
    });
  });

  test("a container this directory runs under a name of its own keeps it when nothing else says it", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const installed = await pinnedAgent({
      port,
      dir,
      installDirName: "xo-lab",
    });
    fs.writeFileSync(
      installed.envFile,
      installed.envText
        .split("\n")
        .filter((line) => {
          return !line.startsWith(`${CONTAINER_VARIABLE}=`);
        })
        .join("\n"),
    );
    runContainerAs(dir, installed.installDir, "xen-lab");

    const upgraded = await install({ port, dir, installDirName: "xo-lab" });
    await fake.close();

    expect(upgraded.status).toBe(0);
    expect(dotenv(upgraded.envFile, CONTAINER_VARIABLE)).toBe("xen-lab");
    expect(upgraded.output).toContain(
      "The agent's container keeps its name, xen-lab, from the container it runs as.",
    );
  });

  test("an older first agent in a directory of its own keeps the default name it runs under", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const first = await agentFromBefore({
      port,
      dir,
      installDirName: "xcp-ng",
    });

    const upgraded = await install({ port, dir, installDirName: "xcp-ng" });
    await fake.close();

    expect(upgraded.status).toBe(0);
    // Not oneuptime-xcp-ng-agent-xcp-ng: an upgrade renames nothing.
    expect(dotenv(upgraded.envFile, CONTAINER_VARIABLE)).toBe(
      DEFAULT_CONTAINER,
    );
    expect(upgraded.output).not.toContain("The agent's container");
    expect(containersOn(dir)).toEqual({
      [DEFAULT_CONTAINER]: first.installDir,
    });
  });

  test("a second agent in a directory of the first one's name stops before Xen Orchestra is asked anything", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const first = await pinnedAgent({
      port,
      dir,
      installDirName: "prod/agent",
    });
    const requestsBefore = fake.requests.length;

    const second = await install({
      port,
      dir,
      installDirName: "lab/agent",
      env: freshEnv(port, {
        XO_TLS_FINGERPRINT: CERTS.selfSigned.fingerprint,
        XO_NAME: "xo-lab",
      }),
    });

    expect(second.status).toBe(1);
    expect(second.output).toContain(
      `Error: ${first.installDir} already runs containers in the Docker Compose project\n"agent": Compose names a project after its directory, and gives ${second.installDir}\nthat name too. Installing here would recreate them and run this agent in their place. Install\nit into a directory of another name instead, e.g. INSTALL_DIR=${second.installDir}-2 bash install.sh`,
    );
    expect(fake.requests.length).toBe(requestsBefore);
    expect(fs.existsSync(second.installDir)).toBe(false);
    expect(containersOn(dir)).toEqual({
      [`${DEFAULT_CONTAINER}-agent`]: first.installDir,
    });

    // Its own upgrade is no other directory's.
    const again = await install({ port, dir, installDirName: "prod/agent" });
    await fake.close();
    expect(again.status).toBe(0);
    expect(again.output).not.toContain("already runs containers");
  });

  test("a new agent is named after the Compose project of its directory", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
    const dir = scratch();
    const result = await pinnedAgent({
      port,
      dir,
      installDirName: "Xen Lab (2)",
    });
    await fake.close();

    expect(dotenv(result.envFile, CONTAINER_VARIABLE)).toBe(
      `${DEFAULT_CONTAINER}-xenlab2`,
    );
  });

  test("its helpers are the Storage Array agent's, for its own service and name", () => {
    const helper = (script, name) => {
      const match = new RegExp(
        `\\n${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`,
      ).exec(script);
      expect(match).not.toBeNull();
      return match[0];
    };
    const xcpNg = fs.readFileSync(INSTALL_SCRIPT, "utf8");
    const storageArray = fs.readFileSync(
      path.join(REPO_ROOT, "agents", "StorageArrayAgent", "install.sh"),
      "utf8",
    );
    for (const name of [
      "is_container_name",
      "compose_container_name",
      "existing_container_name",
      "backup_container_name",
      "directory_container_name",
      "only_container_name_edited",
      "absolute_install_dir",
      "compose_project_name",
      "same_directory",
      "other_project_directory",
    ]) {
      expect(helper(xcpNg, name)).toBe(helper(storageArray, name));
    }
    // choose_container_name sets each agent's own variable.
    expect(
      helper(xcpNg, "choose_container_name").replaceAll(
        CONTAINER_VARIABLE,
        "STORAGE_ARRAY_AGENT_CONTAINER_NAME",
      ),
    ).toBe(helper(storageArray, "choose_container_name"));
    expect(xcpNg).toContain(`AGENT_SERVICE="${DEFAULT_CONTAINER}"`);
    expect(xcpNg).toContain(`DEFAULT_CONTAINER_NAME="${DEFAULT_CONTAINER}"`);
  });
});

/*
 * The real Docker Compose, rendering what install.sh wrote (no container is
 * started): the container_name it reads from .env.
 */
const COMPOSE_RENDER_PROBE = spawnSync("docker", ["compose", "version"], {
  encoding: "utf8",
});
const CAN_RENDER =
  (!COMPOSE_RENDER_PROBE.error && COMPOSE_RENDER_PROBE.status === 0) || IN_CI;

describe("the real Docker Compose names the agent's container as .env says", () => {
  (CAN_RENDER ? test : test.skip)(
    "a first agent and a second, each under its own",
    async () => {
      const { fake, port } = await startXo({ certificate: CERTS.selfSigned });
      const dir = scratch();
      const first = await pinnedAgent({
        port,
        dir,
        installDirName: DEFAULT_CONTAINER,
      });
      const second = await pinnedAgent({ port, dir, installDirName: "lab" });
      await fake.close();

      for (const [installed, expected] of [
        [first, DEFAULT_CONTAINER],
        [second, `${DEFAULT_CONTAINER}-lab`],
      ]) {
        const rendered = spawnSync(
          "docker",
          ["compose", "config", "--format", "json"],
          {
            cwd: installed.installDir,
            env: { PATH: process.env.PATH, HOME: installed.installDir },
            encoding: "utf8",
            timeout: 60000,
          },
        );
        expect(rendered.status).toBe(0);
        expect(
          JSON.parse(rendered.stdout).services[DEFAULT_CONTAINER]
            .container_name,
        ).toBe(expected);
      }
    },
  );
});

/* ------------------------------------- install.sh and the XCP-ng AI agent */

/*
 * The XCP-ng AI agent beside the collector (docker-compose.yml's
 * oneuptime-xcp-ng-ai-agent, under its profile): it runs exactly when it has
 * a read-only Xen Orchestra token, which Xen Orchestra is asked whether it
 * knows before anything is installed. The tokens reach curl on stdin, are
 * kept in the mode-600 .env, and are never shown.
 */
const READ_TOKEN = "Rk7ZQxN3pD0vL2mW9sT4yB8cH1jF6gU5aE_oI-nKqMx";
const WRITE_TOKEN = "Wq2HnV8cT5xL1mZ9pR4sK7dJ3fG6bY0aU_eO-iNtQwE";
const READ_USER = "c8715f02-20e7-4881-8b02-28ce2260c39f";
const FIX_USER = "e8715f02-20e7-4881-8b02-28ce2260c3a1";

function restTokens() {
  return { [READ_TOKEN]: READ_USER, [WRITE_TOKEN]: FIX_USER };
}

function tokenRequests(fake) {
  return fake.requests.filter((request) => {
    return request.url === "/rest/v0/users/me";
  });
}

function expectTokensNeverShown(result) {
  for (const text of [
    result.output,
    result.docker,
    result.curlLog,
    result.opensslLog,
  ]) {
    expect(text).not.toContain(READ_TOKEN);
    expect(text).not.toContain(WRITE_TOKEN);
  }
}

describe("install.sh and the XCP-ng AI agent", () => {
  test("a read token Xen Orchestra knows: its profile is on, the tokens are kept, and never shown", async () => {
    const { fake, port } = await startXo({
      certificate: CERTS.caSigned,
      restTokens: restTokens(),
    });
    const result = await install({
      port,
      env: freshEnv(port, {
        CURL_CA_BUNDLE: CA.certFile,
        ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
        ONEUPTIME_AI_XO_WRITE_TOKEN: WRITE_TOKEN,
        XCP_NG_POOL_ID: "b7569d99-30f8-178a-7d94-801de3e29b5b",
        ONEUPTIME_AI_ALLOW_WRITES: "true",
      }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "Xen Orchestra knows the XCP-ng AI agent's read token.",
    );
    expect(result.output).toContain(
      "The XCP-ng AI agent runs too (oneuptime-xcp-ng-ai-agent)",
    );
    expect(dotenv(result.envFile, "COMPOSE_PROFILES")).toBe("xcp-ng-ai-agent");
    expect(dotenv(result.envFile, "ONEUPTIME_AI_XO_READ_TOKEN")).toBe(READ_TOKEN);
    expect(dotenv(result.envFile, "ONEUPTIME_AI_XO_WRITE_TOKEN")).toBe(
      WRITE_TOKEN,
    );
    expect(dotenv(result.envFile, "XCP_NG_POOL_ID")).toBe(
      "b7569d99-30f8-178a-7d94-801de3e29b5b",
    );
    expect(dotenv(result.envFile, "ONEUPTIME_AI_ALLOW_WRITES")).toBe("true");
    expect(fs.statSync(result.envFile).mode & 0o777).toBe(0o600);
    // Both tokens asked about, each in the cookie, over the trusted TLS.
    expect(
      tokenRequests(fake).map((request) => {
        return [request.token, request.verdict];
      }),
    ).toEqual([
      ["present", "rest-me"],
      ["present", "rest-me"],
    ]);
    // Started as the .env says, not removed.
    expect(result.docker).not.toContain("rm -sf");
    expect(result.docker).toContain("compose up -d --force-recreate");
    expectTokensNeverShown(result);
    expectSecretNeverShown(result);
  });

  test("a read token Xen Orchestra refuses stops the install, and nothing is installed", async () => {
    const { fake, port } = await startXo({
      certificate: CERTS.caSigned,
      restTokens: restTokens(),
    });
    const result = await install({
      port,
      env: freshEnv(port, {
        CURL_CA_BUNDLE: CA.certFile,
        ONEUPTIME_AI_XO_READ_TOKEN: "expired-Tok3nXoForgotItAfterItsExpiration_1",
      }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: Xen Orchestra refused ONEUPTIME_AI_XO_READ_TOKEN, which is wrong or has expired.",
    );
    expectNothingInstalled(result);
    expect(result.output).not.toContain(
      "expired-Tok3nXoForgotItAfterItsExpiration_1",
    );
  });

  test("a token for changes Xen Orchestra refuses stops the install too", async () => {
    const { fake, port } = await startXo({
      certificate: CERTS.caSigned,
      restTokens: { [READ_TOKEN]: READ_USER },
    });
    const result = await install({
      port,
      env: freshEnv(port, {
        CURL_CA_BUNDLE: CA.certFile,
        ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
        ONEUPTIME_AI_XO_WRITE_TOKEN: WRITE_TOKEN,
      }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: Xen Orchestra refused ONEUPTIME_AI_XO_WRITE_TOKEN",
    );
    expectNothingInstalled(result);
    expectTokensNeverShown(result);
  });

  test("the read token as the token for changes is refused before Xen Orchestra is asked", async () => {
    const { fake, port } = await startXo({
      certificate: CERTS.caSigned,
      restTokens: restTokens(),
    });
    const result = await install({
      port,
      env: freshEnv(port, {
        CURL_CA_BUNDLE: CA.certFile,
        ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
        ONEUPTIME_AI_XO_WRITE_TOKEN: READ_TOKEN,
      }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: ONEUPTIME_AI_XO_WRITE_TOKEN is the read token.",
    );
    expect(tokenRequests(fake)).toEqual([]);
    expectNothingInstalled(result);
  });

  test("a Xen Orchestra without the REST API says which version the AI agent needs", async () => {
    const { fake, port } = await startXo({
      certificate: CERTS.caSigned,
      rest: "absent",
    });
    const result = await install({
      port,
      env: freshEnv(port, {
        CURL_CA_BUNDLE: CA.certFile,
        ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
      }),
    });
    await fake.close();

    expect(result.status).toBe(1);
    expect(result.output).toContain("Error: Xen Orchestra has no REST API at /rest/v0");
    expect(result.output).toContain("Orchestra 6.9 or later.");
    expectNothingInstalled(result);
  });

  test("without a token: no profile, an AI agent started before is stopped, and how to turn it on is said", async () => {
    const { fake, port } = await startXo({ certificate: CERTS.caSigned });
    const result = await install({
      port,
      env: freshEnv(port, { CURL_CA_BUNDLE: CA.certFile }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(dotenv(result.envFile, "COMPOSE_PROFILES")).toBe("");
    expect(tokenRequests(fake)).toEqual([]);
    expect(result.docker).toContain(
      "compose --profile xcp-ng-ai-agent rm -sf oneuptime-xcp-ng-ai-agent",
    );
    expect(result.output).toContain(
      "OneUptime AI can look at your pools too: set ONEUPTIME_AI_XO_READ_TOKEN",
    );
  });

  test("http:// never starts the AI agent: its tokens would cross the network in clear", async () => {
    const { fake, port } = await startXo({
      certificate: null,
      restTokens: restTokens(),
    });
    const result = await install({
      port,
      env: freshEnv(port, {
        XO_URL: `http://${XO_HOST}:${port}`,
        CURL_CA_BUNDLE: CA.certFile,
        ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
      }),
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "it is not started while XO_URL uses http://",
    );
    expect(tokenRequests(fake)).toEqual([]);
    expect(dotenv(result.envFile, "COMPOSE_PROFILES")).toBe("");
    expect(result.docker).toContain("rm -sf oneuptime-xcp-ng-ai-agent");
    expectTokensNeverShown(result);
  });

  test("the upgrade keeps the AI agent and its tokens, another profile someone set, and drops the agent with its token", async () => {
    const { fake, port } = await startXo({
      certificate: CERTS.caSigned,
      restTokens: restTokens(),
    });
    const first = await install({
      port,
      env: freshEnv(port, {
        CURL_CA_BUNDLE: CA.certFile,
        ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
        COMPOSE_PROFILES: "my-sidecar",
      }),
    });
    expect(first.status).toBe(0);
    expect(dotenv(first.envFile, "COMPOSE_PROFILES")).toBe(
      "my-sidecar,xcp-ng-ai-agent",
    );

    const again = await install({
      port,
      dir: first.dir,
      env: { CURL_CA_BUNDLE: CA.certFile },
    });
    expect(again.status).toBe(0);
    expect(again.envText).toBe(first.envText);
    expect(again.output).not.toContain("Read-only Xen Orchestra token");

    // The reader takes the token out of .env: the agent stops with it.
    fs.writeFileSync(
      first.envFile,
      fs
        .readFileSync(first.envFile, "utf8")
        .replace(/^ONEUPTIME_AI_XO_READ_TOKEN=.*$/m, "ONEUPTIME_AI_XO_READ_TOKEN=''"),
    );
    const without = await install({
      port,
      dir: first.dir,
      env: { CURL_CA_BUNDLE: CA.certFile },
    });
    await fake.close();

    expect(without.status).toBe(0);
    expect(dotenv(without.envFile, "COMPOSE_PROFILES")).toBe("my-sidecar");
    expect(without.docker).toContain(
      "compose --profile xcp-ng-ai-agent rm -sf oneuptime-xcp-ng-ai-agent",
    );
    expectTokensNeverShown(again);
    expectTokensNeverShown(without);
  });

  test("at a terminal, a first install asks for the read token once, without echoing it", async () => {
    if (!HAS_SCRIPT) {
      expect(IN_CI).toBe(false);
      return;
    }
    const { fake, port } = await startXo({
      certificate: CERTS.caSigned,
      restTokens: restTokens(),
    });
    const result = await install({
      port,
      env: freshEnv(port, { CURL_CA_BUNDLE: CA.certFile }),
      input: `${READ_TOKEN}\n`,
      tty: true,
    });
    await fake.close();

    expect(result.status).toBe(0);
    expect(result.output).toContain("Read-only Xen Orchestra token:");
    expect(dotenv(result.envFile, "ONEUPTIME_AI_XO_READ_TOKEN")).toBe(READ_TOKEN);
    expect(dotenv(result.envFile, "COMPOSE_PROFILES")).toBe("xcp-ng-ai-agent");
    /*
     * Read with echo off (read -s, pinned statically above): after its
     * prompt nothing shows it. Before the prompt, the terminal echoes what
     * this test types ahead, as any terminal would.
     */
    const afterPrompt = result.output.slice(
      result.output.indexOf("Read-only Xen Orchestra token:"),
    );
    expect(afterPrompt).not.toContain(READ_TOKEN);
    expect(result.docker).not.toContain(READ_TOKEN);
    expect(result.curlLog).not.toContain(READ_TOKEN);
  });
});

/* ------------------------------------------------------------ the doctor */

/*
 * An installed agent, as install.sh leaves it, with its container running
 * on what that .env says; then the doctor, against the stand-in Xen
 * Orchestra as `xo` serves it.
 */
async function installedAgent({
  certificate = CERTS.selfSigned,
  pin = true,
  env = {},
} = {}) {
  const { fake, port } = await startXo({ certificate });
  const installEnv = pin
    ? freshEnv(port, { XO_TLS_FINGERPRINT: certificate.fingerprint, ...env })
    : freshEnv(port, env);
  const result = await install({ port, env: installEnv });
  await fake.close();
  expect(result.status).toBe(0);
  return result;
}

function containerEnv(installed, overrides = {}) {
  const names = [
    "ONEUPTIME_URL",
    "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    "XO_SCHEME",
    "XO_ADDRESS",
    "XO_OPENMETRICS_SECRET",
    "XO_NAME",
    "XO_TLS_SERVER_NAME",
  ];
  const values = {};
  for (const name of names) {
    values[name] = dotenv(installed.envFile, name);
  }
  return names
    .map((name) => {
      return `${name}=${name in overrides ? overrides[name] : values[name]}`;
    })
    .join("\n");
}

async function doctor(
  installed,
  { xo = {}, port: givenPort, env = {}, logs = "" } = {},
) {
  let fake = null;
  let port = givenPort;
  if (!port) {
    const started = await startXo({ certificate: CERTS.selfSigned, ...xo });
    fake = started.fake;
    port = started.port;
  }
  const address = dotenv(installed.envFile, "XO_ADDRESS").replace(
    /:\d+$/,
    `:${port}`,
  );
  fs.writeFileSync(
    path.join(installed.dir, "container.env"),
    `${containerEnv(installed, { XO_ADDRESS: address, ...env })}\n`,
  );
  fs.writeFileSync(path.join(installed.dir, "collector.log"), logs);
  fs.writeFileSync(path.join(installed.dir, "docker.log"), "");
  const result = await run(
    "bash",
    [DOCTOR_SCRIPT, "-d", installed.installDir, "--no-color"],
    { env: stubEnv(installed.dir, port), cwd: installed.dir },
  );
  if (fake) {
    await fake.close();
  }
  return {
    ...result,
    fake,
    docker: readIfExists(path.join(installed.dir, "docker.log")),
  };
}

function expectStep(result, line) {
  expect(result.output.split("\n").map((text) => text.trim())).toContain(line);
}

describe("troubleshoot.sh names the first step that fails", () => {
  test("a healthy agent: every step passes, the pools are counted, the secret never shown", async () => {
    const installed = await installedAgent();
    const result = await doctor(installed);

    expect(result.output).toMatch(
      /✔ Xen Orchestra answers at https:\/\/xo\.example\.test:\d+ \(HTTP 200 on \/openmetrics\/health\)\./,
    );
    expectStep(result, '✔ The OpenMetrics plugin answers: {"status":"ok"}.');
    expectStep(
      result,
      "✔ Xen Orchestra's certificate checks out against xo-ca.pem.",
    );
    expectStep(
      result,
      `✔ It is the pinned certificate (SHA-256 ${CERTS.selfSigned.fingerprint}).`,
    );
    expectStep(
      result,
      "✔ Xen Orchestra accepts the secret (/openmetrics/metrics → 200).",
    );
    expectStep(
      result,
      "✔ The answer is OpenMetrics (application/openmetrics-text; version=1.0.0; charset=utf-8).",
    );
    expect(result.output).toMatch(
      /✔ Xen Orchestra reports 2 pool\(s\): Production, \(a pool with no name\) — \d+ xcp_\* series\./,
    );
    expect(result.output).toContain("1 host(s) are not running");
    expect(result.output).toContain(
      "The agent looks healthy and OneUptime accepts the token.",
    );
    expect(result.status).toBe(0);
    expect(metricsRequests(result.fake)[0].authorization).toBe(
      `Bearer ${SECRET}`,
    );
    expect(result.output).not.toContain("s3cr$t");
    expect(result.docker).not.toContain("s3cr$t");
    expect(result.docker).not.toContain(KEY);
  });

  test("Xen Orchestra does not answer: step 2", async () => {
    const installed = await installedAgent();
    const port = await closedPort();
    const result = await doctor(installed, { port });

    expect(result.output).toMatch(
      /✗ Xen Orchestra does not answer at https:\/\/xo\.example\.test:\d+ from the agent's network \(curl exit 7\)\./,
    );
    expect(result.output).toContain(
      "ROOT CAUSE: the agent cannot reach Xen Orchestra (step 2).",
    );
    expect(result.status).toBe(1);
  });

  test("the plugin is off: step 3", async () => {
    const installed = await installedAgent();
    const result = await doctor(installed, { xo: { plugin: "off" } });

    expectStep(
      result,
      '✗ Xen Orchestra answers, but its OpenMetrics plugin does not (HTTP 500: "There was a problem proxying this request.").',
    );
    expect(result.output).toContain(
      "ROOT CAUSE: Xen Orchestra's OpenMetrics plugin does not answer (step 3).",
    );
  });

  test("Xen Orchestra presents another certificate than the pinned one: step 4, with both fingerprints", async () => {
    const installed = await installedAgent();
    const result = await doctor(installed, {
      xo: { certificate: CERTS.renewed },
    });

    expectStep(
      result,
      "✗ Xen Orchestra presents a certificate that is NOT the pinned one.",
    );
    expectStep(
      result,
      `XO_TLS_FINGERPRINT:     ${CERTS.selfSigned.fingerprint}`,
    );
    expectStep(result, `Xen Orchestra presents: ${CERTS.renewed.fingerprint}`);
    expect(result.output).toContain(
      "ROOT CAUSE: Xen Orchestra's certificate is no longer the one the agent pinned (step 4).",
    );
    // The secret is never sent to a certificate the agent does not trust.
    expect(metricsRequests(result.fake)).toHaveLength(0);
  });

  test("a certificate that names no host: step 4 says it can never be checked", async () => {
    const installed = await installedAgent();
    const result = await doctor(installed, {
      xo: { certificate: CERTS.xoAutoCert },
    });

    expectStep(
      result,
      "✗ Xen Orchestra's certificate is issued to no name (no subjectAltName), so it can never be checked.",
    );
    expect(result.output).toContain(
      "ROOT CAUSE: Xen Orchestra's certificate names no host, so it can never be checked (step 4).",
    );
  });

  test("a CA bundle that does not issue the certificate any more: step 4", async () => {
    const installed = await installedAgent({
      certificate: CERTS.caSigned,
      pin: false,
      env: { CURL_CA_BUNDLE: CA.certFile },
    });
    const result = await doctor(installed, {
      xo: { certificate: CERTS.selfSigned },
    });

    expectStep(
      result,
      "✗ Xen Orchestra's certificate does not check out against xo-ca.pem.",
    );
    expect(result.output).toContain(
      "ROOT CAUSE: the agent does not trust Xen Orchestra's certificate (step 4).",
    );
  });

  test("a refused secret: step 5, with the plugin's own reason", async () => {
    const installed = await installedAgent();
    const result = await doctor(installed, {
      env: { XO_OPENMETRICS_SECRET: "an-old-secret" },
    });

    expectStep(
      result,
      '✗ Xen Orchestra REFUSED the secret (401: "Query authentication does not match server setting").',
    );
    expect(result.output).toContain(
      "ROOT CAUSE: Xen Orchestra refuses the OpenMetrics secret (step 5).",
    );
    expect(result.output).not.toContain("an-old-secret");
  });

  test("no pools: step 6", async () => {
    const installed = await installedAgent();
    const result = await doctor(installed, { xo: { noPools: true } });

    expectStep(
      result,
      "▲ Xen Orchestra is connected to no pool: there is nothing to report.",
    );
    expect(result.output).toContain(
      "ROOT CAUSE: Xen Orchestra is connected to no pool, so there is nothing to report (step 6).",
    );
  });

  test("xo-ca.pem missing: section 1 says the collector reads nothing, and install.sh writes it", async () => {
    const installed = await installedAgent();
    fs.rmSync(path.join(installed.installDir, "xo-ca.pem"));
    const result = await doctor(installed);

    expect(result.output).toContain(
      "xo-ca.pem is missing: the collector cannot check Xen Orchestra's certificate, so it reads nothing.",
    );
    expect(result.status).toBe(1);
  });

  test("localhost in XO_ADDRESS is the container itself", async () => {
    const installed = await installedAgent();
    const result = await doctor(installed, {
      env: { XO_ADDRESS: "localhost:443" },
    });

    expect(result.output).toContain(
      "✗ XO_ADDRESS points at localhost (localhost) — inside the agent container that is the agent itself, not Xen Orchestra.",
    );
    expect(result.output).toContain(
      "ROOT CAUSE: the Xen Orchestra settings in .env are incomplete or invalid.",
    );
  });

  test("http:// is read, with the warning, and no certificate step", async () => {
    const { fake, port } = await startXo({ certificate: null });
    const installed = await install({
      port,
      env: freshEnv(port, {
        XO_URL: `http://${XO_HOST}:${port}`,
        CURL_CA_BUNDLE: CA.certFile,
      }),
    });
    await fake.close();
    expect(installed.status).toBe(0);
    const result = await doctor(installed, { xo: { certificate: null } });

    expect(result.output).toContain(
      "▲ XO_SCHEME is http: the OpenMetrics secret and everything Xen Orchestra reports cross the network in clear.",
    );
    expect(result.output).toContain(
      "Skipped: XO_URL uses http:// — there is no certificate to check",
    );
    expect(result.output).toMatch(/✔ Xen Orchestra reports 2 pool\(s\)/);
  });

  test("the collector's own log lines are read for the step that failed", async () => {
    const installed = await installedAgent();
    const result = await doctor(installed, {
      logs: [
        '2026-11-24T17:53:28.976Z\twarn\tinternal/transaction.go:130\tFailed to scrape Prometheus endpoint\t{"error": "server returned HTTP status 401 Unauthorized"}',
        '2026-11-24T17:54:04.333Z\twarn\tinternal/transaction.go:130\tFailed to scrape Prometheus endpoint\t{"error": "Get \\"https://xo:443/openmetrics/metrics\\": tls: failed to verify certificate: x509: certificate is not valid for any names, but wanted to match xo"}',
        '2026-11-24T17:54:21.579Z\terror\terror creating new scrape pool\t{"err": "error creating HTTP client: unable to read CA cert: unable to read file /etc/oneuptime/xo-ca.pem: open /etc/oneuptime/xo-ca.pem: no such file or directory"}',
      ].join("\n"),
    });

    expect(result.output).toContain(
      "The collector log shows Xen Orchestra refusing the scrape (401)",
    );
    expect(result.output).toContain(
      "The collector log shows Xen Orchestra's certificate is issued to no name",
    );
    expect(result.output).toContain(
      "The collector log shows it cannot read xo-ca.pem",
    );
  });

  test("a secret with $ in it, held doubled by the container, reaches Xen Orchestra as typed", async () => {
    const installed = await installedAgent();
    // install.sh wrote it escaped for the collector; the container holds it so.
    expect(containerEnv(installed)).toContain(
      `XO_OPENMETRICS_SECRET=${SECRET.replace(/\$/g, "$$$$")}`,
    );
    const result = await doctor(installed);

    expect(metricsRequests(result.fake)[0].authorization).toBe(
      `Bearer ${SECRET}`,
    );
    expect(result.output).toContain("✔ Xen Orchestra accepts the secret");
  });
});

describe("troubleshoot.sh finds the agent's container whatever it is named", () => {
  test("a second Xen Orchestra's agent, by the name its .env gives it, when compose cannot tell", async () => {
    const installed = await installedAgent({
      env: { XCP_NG_AGENT_CONTAINER_NAME: "xo-lab-agent" },
    });
    // The engine knows no container of that directory.
    fs.rmSync(path.join(installed.dir, "containers"));
    const result = await doctor(installed);

    expect(result.output).toContain(
      "✔ Container 'xo-lab-agent' is running (running restarting=false restarts=0)",
    );
    // Every probe runs in that container's network, as the collector does.
    expect(result.docker).toContain("--network container:xo-lab-agent");
    expect(result.docker).not.toContain(
      "--network container:oneuptime-xcp-ng-agent ",
    );
    expect(result.status).toBe(0);
  });

  test("the container compose runs for the directory wins over the name in .env", async () => {
    const installed = await installedAgent({
      env: { XCP_NG_AGENT_CONTAINER_NAME: "xo-lab-agent" },
    });
    runContainerAs(installed.dir, installed.installDir, "xen-lab");
    const result = await doctor(installed);

    expect(result.output).toContain("✔ Container 'xen-lab' is running");
    expect(result.docker).toContain("--network container:xen-lab");
  });

  test("an agent whose container is gone is named as its .env names it", async () => {
    const installed = await installedAgent({
      env: { XCP_NG_AGENT_CONTAINER_NAME: "xo-lab-agent" },
    });
    fs.rmSync(path.join(installed.dir, "containers"));
    fs.writeFileSync(path.join(installed.dir, "container.state"), "");
    const result = await doctor(installed);

    expect(result.output).toContain(
      "✗ Container 'xo-lab-agent' does not exist.",
    );
    expect(result.status).toBe(1);
  });
});

/* ---------------------------------------------------------------- hygiene */

describe("the stand-ins themselves", () => {
  test("the stand-in Xen Orchestra answers as the plugin does", async () => {
    const { fake, port } = await startXo({ certificate: null });
    const base = `http://127.0.0.1:${port}/openmetrics`;
    // spawnSync blocks the loop the stand-in answers on: ask from a child.
    const answers = await run(
      "bash",
      [
        "-c",
        [
          `"$1" -s ${base}/health; echo`,
          `"$1" -s ${base}/metrics; echo`,
          `"$1" -s -H 'Authorization: Bearer nope' ${base}/metrics; echo`,
          `printf 'Authorization: Bearer %s\\n' "$2" | "$1" -s -H @- ${base}/nothing; echo`,
          `printf 'Authorization: Bearer %s\\n' "$2" | "$1" -s -D - -o /dev/null ${base}/metrics -H @- | grep -i '^content-type'`,
        ].join("\n"),
        "probe",
        REAL_CURL,
        SECRET,
      ],
      { env: process.env },
    );
    await fake.close();
    expect(answers.output.split("\n").map((line) => line.trim())).toEqual([
      '{"status":"ok"}',
      '{"error":"Query is not authenticated"}',
      '{"error":"Query authentication does not match server setting"}',
      '{"error":"Not found"}',
      "Content-Type: application/openmetrics-text; version=1.0.0; charset=utf-8",
      "",
    ]);
  });

  test("certificates made here are what each case says", () => {
    const names = (certificate) => {
      return openssl(["x509", "-in", certificate.certFile, "-noout", "-text"]);
    };
    expect(names(CERTS.xoAutoCert)).not.toContain("Subject Alternative Name");
    expect(names(CERTS.dnsOnly)).toContain(`DNS:${XO_HOST}`);
    expect(names(CERTS.dnsOnly)).not.toContain("IP Address");
    expect(CERTS.renewed.fingerprint).not.toBe(CERTS.selfSigned.fingerprint);
    expect(
      crypto
        .createHash("sha256")
        .update(new crypto.X509Certificate(CERTS.selfSigned.cert).raw)
        .digest("hex"),
    ).toBe(plainFingerprint(CERTS.selfSigned.fingerprint));
  });
});
