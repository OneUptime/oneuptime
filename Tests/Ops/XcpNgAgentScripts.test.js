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
   * docker: the installer's compose calls are recorded (with the XO_* and
   * ONEUPTIME_* variables Compose would see), and the doctor's probes run.
   */
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
case "$1" in
  info) exit 0 ;;
  compose)
    case "$2" in
      up) printf 'compose up sees: %s\\n' "$(env | grep -E '^(XO_|ONEUPTIME_)' | sort | tr '\\n' ' ')" >> "$STUB_DIR/docker.log" ;;
      ps) cat "$STUB_DIR/compose-ps" 2>/dev/null ;;
    esac
    exit 0 ;;
  inspect)
    case "$*" in
      *Config.Env*) cat "$STUB_DIR/container.env" 2>/dev/null ;;
      *restarting*) cat "$STUB_DIR/container.state" 2>/dev/null || printf 'running restarting=false restarts=0\\n' ;;
      *.Name*) printf '/oneuptime-xcp-ng-agent\\n' ;;
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
}) {
  const work = dir || scratch();
  if (!fs.existsSync(path.join(work, "bin"))) {
    makeStubs(work);
  }
  const installDir = path.join(work, "agent");
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
