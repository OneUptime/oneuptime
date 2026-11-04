"use strict";

/**
 * The OpenStack agent's install.sh, run for real in a scratch directory with
 * `docker`, `curl`, `id` and `chown` replaced by recording stubs (no daemon,
 * network or cloud needed), and once with the real curl against a local server.
 *
 * What it must never get wrong:
 *  - a re-run is the upgrade, so it keeps every answer, and nothing is asked again;
 *  - a secret reaches the exporter exactly as typed, whatever it holds: the
 *    installer writes it into YAML and JSON, and any quoting mistake is a credential
 *    Keystone refuses, or worse, half of one;
 *  - a secret is never on a command line, never echoed, and in no program's
 *    environment;
 *  - clouds.yaml has one entry per region, NAMED FOR THE REGION, because the
 *    exporter's series do not say which region they are from and the collector
 *    stamps the entry's name;
 *  - clouds.yaml is readable by the user the exporter runs as and nobody else.
 *    The exporter's image runs as uid 65532, so a root-owned 0600 file locks it out;
 *  - a credential Keystone refuses stops the install before anything is written.
 *
 * The real `docker compose config` checks the .env where it is installed, which CI
 * requires; elsewhere that is skipped with the reason logged.
 *
 * OpenStackAgentWithoutDocker.test.js runs the same script with --without-docker.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawn, spawnSync } = require("child_process");
const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");
const { loadInstallScriptsCatalog } = require("./Utils/InstallScriptsCatalog");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "OpenStackAgent");
const SCRIPT = path.join(AGENT_DIR, "install.sh");
const INSTALL_NAME = "openstack-agent";

const URL = "https://oneuptime.example.com";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
const NEW_KEY = "7d0c2e1b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const AUTH_URL = "https://keystone.example.com:5000/v3";
const APP_ID = "4c2f7bd8a1e94f6b8d3c0e5a7f1b2c3d";
// What Compose, a shell, YAML and JSON would each mangle if it reached them bare.
const APP_SECRET = `s3cr$t'x"y\\ #: {z}`;
const PASSWORD = `pa$$w'ord"\\ #1: [x]`;

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-installer-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

// What a file holds, or nothing when it is not there or this user cannot read it.
function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function agentFile(name) {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

// What Keystone answers: a catalog listing these regions.
function catalogAnswer(regions) {
  return JSON.stringify({
    token: {
      project: { id: "own-project" },
      catalog: [
        {
          type: "compute",
          name: "nova",
          endpoints: regions.map((region) => {
            return {
              id: `compute-${region}`,
              interface: "public",
              region_id: region,
              region,
              url: `https://nova.example.com/${region}`,
            };
          }),
        },
      ],
    },
  });
}

/*
 * `docker` records every call with the directory it ran in, fails
 * `compose pull` / `compose up` when $STUB_DIR/pull.fail / up.fail exists, and at
 * `compose up` keeps the environment Compose was handed and the files it would
 * mount. `curl` serves the agent's files the way the OneUptime at URL does
 * (Utils/AgentFilesCurlStub says how a test makes it an older one), and at
 * <auth URL>/auth/tokens answers as Keystone: $STUB_DIR/keystone.answer says how
 * ("401", or "000 <curl exit>"), and what it was sent on stdin and the environment
 * it ran in are kept. `id` says uid 1000, or $FAKE_UID. `chown` records its calls.
 */
function installStubs(dir) {
  const bin = path.join(dir, "bin");
  if (fs.existsSync(bin)) {
    return bin;
  }
  fs.mkdirSync(bin);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
case "$*" in
  "info --format"*)
    cat "$STUB_DIR/docker-security-options" 2>/dev/null
    ;;
  "compose pull"*)
    [ -f "$STUB_DIR/pull.fail" ] && exit 1
    ;;
  "compose up"*)
    [ -f "$STUB_DIR/up.fail" ] && exit 1
    env | sort > "$STUB_DIR/env-at-up.txt"
    cp otel-collector-config.yaml "$STUB_DIR/config-at-up.yaml" 2>/dev/null || true
    cp clouds.yaml "$STUB_DIR/clouds-at-up.yaml" 2>/dev/null || true
    ;;
esac
exit 0
`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    agentFilesCurlStub({
      installName: INSTALL_NAME,
      agentDirectory: "OpenStackAgent",
      servedDir: AGENT_DIR,
      extraCases: `case "$url" in
  */auth/tokens)
    cat >> "$STUB_DIR/keystone-stdin.log"
    printf '\\n' >> "$STUB_DIR/keystone-stdin.log"
    env | sort > "$STUB_DIR/env-at-keystone.txt"
    answer="$(cat "$STUB_DIR/keystone.answer" 2>/dev/null || echo 201)"
    case "$answer" in
      "000 "*)
        echo "curl: (\${answer#000 }) no answer" >&2
        printf '\\n000'
        exit "\${answer#000 }"
        ;;
      201) cat "$STUB_DIR/keystone-catalog.json" 2>/dev/null ;;
      *) printf '{"error":{"code":%s,"message":"Refused"}}' "$answer" ;;
    esac
    printf '\\n%s' "$answer"
    exit 0
    ;;
esac`,
    }),
  );
  writeExecutable(
    path.join(bin, "id"),
    `#!/usr/bin/env bash
case "$1" in
  -u) echo "\${FAKE_UID:-1000}" ;;
  -g) echo "\${FAKE_UID:-1000}" ;;
  *) exit 1 ;;
esac
`,
  );
  writeExecutable(
    path.join(bin, "chown"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/chown.log"\n`,
  );
  fs.writeFileSync(
    path.join(dir, "keystone-catalog.json"),
    catalogAnswer(["RegionOne", "RegionTwo", "Region Three"]),
  );
  return bin;
}

function install(dir, { env = {}, input = "", args = [] } = {}) {
  const bin = installStubs(dir);
  const installDir = path.join(dir, "agent");
  const result = spawnSync("bash", [SCRIPT, ...args], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      STUB_DIR: dir,
      INSTALL_DIR: installDir,
      ...env,
    },
    input,
    encoding: "utf8",
    timeout: 120000,
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    installDir,
    envFile: readIfExists(path.join(installDir, ".env")),
    cloudsText: readIfExists(path.join(installDir, "clouds.yaml")),
    docker: readIfExists(path.join(dir, "docker.log")),
    curlLog: readIfExists(path.join(dir, "curl.log")),
    chownLog: readIfExists(path.join(dir, "chown.log")),
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

// URL, key, cloud name, auth URL, regions, yes to an application credential, its
// ID and secret, no CA.
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

// What Keystone was sent, each login parsed.
function keystoneRequests(dir) {
  return readIfExists(path.join(dir, "keystone-stdin.log"))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      return JSON.parse(line);
    });
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
      return (
        line.includes(" | compose ") && !line.endsWith("| compose version")
      );
    })
    .map((line) => {
      const [cwd, args] = line.split(" | ");
      return { cwd: fs.realpathSync(cwd), args };
    });
}

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

// A newer upstream whose config stamps a newer collector version.
function newerUpstream() {
  const upstream = path.join(scratch(), "upstream");
  fs.cpSync(AGENT_DIR, upstream, { recursive: true });
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
function composeVariables() {
  const compose = yaml.load(agentFile("docker-compose.yml"));
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

/*
 * The real Docker Compose, where it is installed: what it hands the containers
 * is the only proof that the quoting round-trips. CI (the Ops workflow's runner
 * has Docker) must run it; elsewhere it is skipped with the reason logged, never
 * passed.
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
        COMPOSE_PROBE.error ? COMPOSE_PROBE.error.message : COMPOSE_PROBE.stderr
      }). This round-trip must not pass by skipping.`,
    );
  }
  const result = spawnSync(
    "docker",
    ["compose", "config", "--format", "json"],
    {
      cwd: installDir,
      env: { PATH: process.env.PATH, HOME: installDir },
      encoding: "utf8",
      timeout: 120000,
    },
  );
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

/* =============================================================== a fresh install */

describe("agents/OpenStackAgent/install.sh, a fresh install", () => {
  test("asks one question at a time, and writes every variable, the user's values quoted, owner-only", () => {
    const dir = scratch();
    const run = install(dir, { input: FRESH });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toEqual({
      ONEUPTIME_URL: `'${URL}'`,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: `'${KEY}'`,
      // Unquoted, Compose would cut it at " #".
      OPENSTACK_CLOUD_NAME: "'prod #1'",
      OPENSTACK_AUTH_URL: `'${AUTH_URL}'`,
      OPENSTACK_EXPORTER_CLOUDS: "'[RegionOne,RegionTwo]'",
      OPENSTACK_EXPORTER_ADDRESS: "'openstack-exporter:9180'",
      // Run as uid 1000, which cannot give the file to the image's own user.
      OPENSTACK_EXPORTER_USER: "1000:1000",
      OPENSTACK_CA_FILE: "''",
      COMPOSE_PROFILES: "'openstack-exporter'",
    });
    expect(mode(path.join(run.installDir, ".env"))).toBe(0o600);
    expect(run.output).not.toContain("reusing it");
    expect(run.output).toContain(
      "An application credential is better: it can be limited to reading, it can expire,",
    );
    expect(run.output).toContain(
      "Keep it on a project of its own that holds nothing: where Cinder has enforce_new_defaults\noff, its own default, any role on a project can create that project's volumes.",
    );
  });

  test("writes clouds.yaml readable by its owner alone, one entry per region, named for the region", () => {
    const dir = scratch();
    const run = install(dir, { input: FRESH });

    expect(run.status).toBe(0);
    expect(mode(path.join(run.installDir, "clouds.yaml"))).toBe(0o600);
    const { clouds } = yaml.load(run.cloudsText);
    expect(Object.keys(clouds)).toEqual(["RegionOne", "RegionTwo"]);
    for (const region of ["RegionOne", "RegionTwo"]) {
      expect(clouds[region]).toEqual({
        region_name: region,
        identity_api_version: 3,
        auth_type: "v3applicationcredential",
        auth: {
          auth_url: AUTH_URL,
          application_credential_id: APP_ID,
          application_credential_secret: APP_SECRET,
        },
      });
    }
    // What the collector's relabelling needs, in the same order as the entries.
    expect(composeReadAll(run.envFile).OPENSTACK_EXPORTER_CLOUDS).toBe(
      `[${Object.keys(clouds).join(",")}]`,
    );
    // Nothing but the credential's own file holds the secret.
    expect(run.envFile).not.toContain(APP_ID);
    expect(run.envFile).not.toContain(APP_SECRET);
  });

  test("a username and password, folded behind the question, in clouds.yaml and sent to Keystone scoped to the project", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        URL,
        KEY,
        "prod",
        AUTH_URL,
        "RegionOne",
        "n",
        "monitor",
        PASSWORD,
        "monitoring",
        "",
        "ops-domain",
        "",
      ),
    });

    expect(run.status).toBe(0);
    expect(yaml.load(run.cloudsText).clouds.RegionOne).toEqual({
      region_name: "RegionOne",
      identity_api_version: 3,
      auth_type: "v3password",
      auth: {
        auth_url: AUTH_URL,
        username: "monitor",
        password: PASSWORD,
        project_name: "monitoring",
        user_domain_name: "Default",
        project_domain_name: "ops-domain",
      },
    });
    expect(keystoneRequests(dir)).toEqual([
      {
        auth: {
          identity: {
            methods: ["password"],
            password: {
              user: {
                name: "monitor",
                domain: { name: "Default" },
                password: PASSWORD,
              },
            },
          },
          scope: {
            project: { name: "monitoring", domain: { name: "ops-domain" } },
          },
        },
      },
    ]);
    expect(run.output).not.toContain(PASSWORD);
  });

  test("every answer also works as an environment variable, and then nothing is asked", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_URL: URL,
        ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
        OPENSTACK_CLOUD_NAME: "prod",
        OPENSTACK_AUTH_URL: AUTH_URL,
        OPENSTACK_EXPORTER_CLOUDS: "RegionOne",
        OPENSTACK_APPLICATION_CREDENTIAL_ID: APP_ID,
        OPENSTACK_APPLICATION_CREDENTIAL_SECRET: APP_SECRET,
      },
      // No input at all: any prompt would read EOF and stop the script.
    });

    expect(run.status).toBe(0);
    expect(run.output).not.toContain("Use an application credential");
    expect(composeReadAll(run.envFile)).toMatchObject({
      OPENSTACK_CLOUD_NAME: "prod",
      OPENSTACK_EXPORTER_CLOUDS: "[RegionOne]",
    });
    expect(
      yaml.load(run.cloudsText).clouds.RegionOne.auth
        .application_credential_secret,
    ).toBe(APP_SECRET);
  });

  test("an empty answer to a required question asks again, and the end of input stops the script", () => {
    const dir = scratch();
    const run = install(dir, { input: answers("", "", URL) });

    expect(run.status).not.toBe(0);
    expect(run.envFile).toBe("");
    expect(run.docker).not.toContain("compose up");
  });

  test("an auth URL is written with /v3 and no trailing slash, however it is typed", () => {
    for (const typed of [
      "https://keystone.example.com:5000",
      "https://keystone.example.com:5000/",
      "https://keystone.example.com:5000/v3/",
    ]) {
      const dir = scratch();
      const run = install(dir, {
        input: answers(
          URL,
          KEY,
          "prod",
          typed,
          "RegionOne",
          "",
          APP_ID,
          APP_SECRET,
          "",
        ),
      });

      expect({ typed, status: run.status }).toEqual({ typed, status: 0 });
      expect(composeReadAll(run.envFile).OPENSTACK_AUTH_URL).toBe(AUTH_URL);
      expect(run.curlLog).toContain(`${AUTH_URL}/auth/tokens`);
    }
  });

  test("an auth URL with no scheme stops the install", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(URL, KEY, "prod", "keystone.example.com:5000/v3"),
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      "the Keystone auth URL must start with http:// or https://",
    );
    expect(run.envFile).toBe("");
  });

  test("a trailing slash on the OneUptime URL is not written, so the collector never posts to //otlp", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        `${URL}/`,
        KEY,
        "prod",
        AUTH_URL,
        "RegionOne",
        "",
        APP_ID,
        APP_SECRET,
        "",
      ),
    });

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile).ONEUPTIME_URL).toBe(URL);
  });
});

/* ========================================================== the regions */

describe("the region names", () => {
  function withRegions(typed) {
    const dir = scratch();
    return install(dir, {
      input: answers(
        URL,
        KEY,
        "prod",
        AUTH_URL,
        typed,
        "",
        APP_ID,
        APP_SECRET,
        "",
      ),
    });
  }

  test("Enter takes RegionOne", () => {
    const run = withRegions("");

    expect(composeReadAll(run.envFile).OPENSTACK_EXPORTER_CLOUDS).toBe(
      "[RegionOne]",
    );
    expect(Object.keys(yaml.load(run.cloudsText).clouds)).toEqual([
      "RegionOne",
    ]);
  });

  test.each([
    ["RegionOne,RegionTwo"],
    ["RegionOne, RegionTwo"],
    ["[RegionOne,RegionTwo]"],
    ["[ RegionOne , RegionTwo ]"],
    ["RegionOne,RegionTwo,RegionOne"],
    ["RegionOne,,RegionTwo,"],
    ["[\"RegionOne\",'RegionTwo']"],
  ])("%s is the list the collector reads, and one entry each", (typed) => {
    const run = withRegions(typed);

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile).OPENSTACK_EXPORTER_CLOUDS).toBe(
      "[RegionOne,RegionTwo]",
    );
    expect(Object.keys(yaml.load(run.cloudsText).clouds)).toEqual([
      "RegionOne",
      "RegionTwo",
    ]);
  });

  test("a name with a space is one region", () => {
    const run = withRegions("Region Three,RegionOne");

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile).OPENSTACK_EXPORTER_CLOUDS).toBe(
      "[Region Three,RegionOne]",
    );
    // The list as YAML, which is how the collector reads it.
    expect(
      yaml.load(composeReadAll(run.envFile).OPENSTACK_EXPORTER_CLOUDS),
    ).toEqual(["Region Three", "RegionOne"]);
    expect(Object.keys(yaml.load(run.cloudsText).clouds)).toEqual([
      "Region Three",
      "RegionOne",
    ]);
  });

  test.each([
    ["Region: One"],
    ["Region#One"],
    ["$Region"],
    ["Region/One"],
    ["Region{One}"],
  ])(
    "%s cannot be a region name here: the list would not read back, and it stops before anything is written",
    (typed) => {
      const run = withRegions(typed);

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("cannot be a region name here");
      expect(run.envFile).toBe("");
      expect(run.docker).not.toContain("compose up");
    },
  );

  test("a region the cloud's catalog does not list stops the install, and says which it does", () => {
    const run = withRegions("regionone");

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      `Error: this cloud's service catalog has no region "regionone". It lists:`,
    );
    expect(run.output).toContain("  RegionOne");
    expect(run.output).toContain("  RegionTwo");
    expect(run.output).toContain("Region names are case sensitive.");
    expect(run.envFile).toBe("");
    expect(run.cloudsText).toBe("");
  });

  test("a catalog that lists nothing (a token with no catalog) is no reason to stop", () => {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(path.join(dir, "keystone-catalog.json"), '{"token":{}}');

    const run = install(dir, { input: FRESH });

    expect(run.status).toBe(0);
  });
});

/* ================================================= a secret, exactly as typed */

const HOSTILE_VALUES = [
  `s3cr$t'x"y`,
  "$HOME ${PATH} $(id) `id`",
  "a: b # c",
  "- [x, y]",
  "{z: 1}",
  "*alias",
  "&anchor",
  "!!tag",
  "| block",
  "> folded",
  "%directive",
  "@at",
  "? key",
  "~",
  "null",
  "true",
  "yes",
  "1e3",
  "0x1f",
  "back\\slash\\",
  '\\n \\t \\" \\\\',
  "'quoted'",
  '"quoted"',
  " leading and trailing ",
  "tab\there",
  "line\nbreak",
  "ünïcödé 秘密",
];

describe("a secret reaches the exporter as typed", () => {
  const script = agentFile("install.sh");
  const helpers = `${shellFunction(script, "json_string")}\n${shellFunction(script, "clouds_yaml_get")}`;

  /*
   * The two helpers, as the script uses them: what json_string makes of a value
   * is written into a clouds.yaml, and read back by a real YAML parser (which is
   * what the exporter has), by JSON (which is what Keystone has), and by this
   * script on a re-run.
   */
  test.each(HOSTILE_VALUES.map((value) => [value]))("%j", (value) => {
    const dir = scratch();
    const file = path.join(dir, "clouds.yaml");
    const result = spawnSync(
      "bash",
      [
        "-c",
        `${helpers}
CLOUDS_FILE="$1"
written="$(json_string "$VALUE")"
printf '%s\\n' "$written"
{
  printf 'clouds:\\n  "RegionOne":\\n    auth:\\n      application_credential_secret: %s\\n' "$written"
} > "$CLOUDS_FILE"
printf '%s' "$(clouds_yaml_get application_credential_secret)" > "$CLOUDS_FILE.read"
`,
        "bash",
        file,
      ],
      { env: { ...process.env, VALUE: value }, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toBe(value);
    expect(
      yaml.load(fs.readFileSync(file, "utf8")).clouds.RegionOne.auth
        .application_credential_secret,
    ).toBe(value);
    expect(fs.readFileSync(`${file}.read`, "utf8")).toBe(value);
  });

  test("typed at the prompt with a space at each end, it is kept, and read without echo", () => {
    const dir = scratch();
    const typed = `  ${APP_SECRET}  `;
    const run = install(dir, {
      input: answers(
        URL,
        KEY,
        "prod",
        AUTH_URL,
        "RegionOne",
        "",
        APP_ID,
        typed,
        "",
      ),
    });

    expect(run.status).toBe(0);
    expect(
      yaml.load(run.cloudsText).clouds.RegionOne.auth
        .application_credential_secret,
    ).toBe(typed);
    expect(keystoneRequests(dir)[0]).toEqual({
      auth: {
        identity: {
          methods: ["application_credential"],
          application_credential: { id: APP_ID, secret: typed },
        },
      },
    });
    expect(run.output).not.toContain(APP_SECRET);
  });

  test("a hostile value in the environment goes the same way", () => {
    for (const secret of ["line\nbreak", "tab\there", "back\\slash\\"]) {
      const dir = scratch();
      const run = install(dir, {
        env: {
          OPENSTACK_APPLICATION_CREDENTIAL_ID: APP_ID,
          OPENSTACK_APPLICATION_CREDENTIAL_SECRET: secret,
        },
        input: answers(URL, KEY, "prod", AUTH_URL, "RegionOne", ""),
      });

      expect(run.status).toBe(0);
      expect(
        yaml.load(run.cloudsText).clouds.RegionOne.auth
          .application_credential_secret,
      ).toBe(secret);
      expect(
        keystoneRequests(dir)[0].auth.identity.application_credential.secret,
      ).toBe(secret);
    }
  });

  test("a re-run sends Keystone the secret as typed, read back from clouds.yaml", () => {
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);

    const rerun = install(dir);

    expect(rerun.status).toBe(0);
    const logins = keystoneRequests(dir);
    expect(logins).toHaveLength(2);
    expect(logins[1]).toEqual(logins[0]);
    expect(logins[1].auth.identity.application_credential.secret).toBe(
      APP_SECRET,
    );
  });

  test("a clouds.yaml edited by hand, plain or single-quoted, is read as YAML reads it", () => {
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);
    const file = path.join(dir, "agent", "clouds.yaml");
    const text = `clouds:
  RegionOne:
    region_name: RegionOne
    auth:
      auth_url: ${AUTH_URL}   # the public one
      application_credential_id: ${APP_ID}
      application_credential_secret: 'it''s # kept'
  RegionTwo:
    region_name: RegionTwo
    auth:
      auth_url: ${AUTH_URL}
      application_credential_id: ${APP_ID}
      application_credential_secret: 'it''s # kept'
`;
    fs.writeFileSync(file, text);

    const rerun = install(dir);

    expect(rerun.status).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    expect(
      keystoneRequests(dir)[1].auth.identity.application_credential,
    ).toEqual({ id: APP_ID, secret: "it's # kept" });
    expect(backupsIn(rerun.installDir)).toEqual([]);
  });
});

/* ============================================ nothing secret on a command line */

describe("nothing secret goes on a command line", () => {
  const SECRETS = [APP_ID, APP_SECRET, PASSWORD];

  function expectNoSecretIn(text) {
    for (const secret of SECRETS) {
      expect(text).not.toContain(secret);
    }
  }

  test("curl gets the credential on stdin, and no program gets it in its environment, though it was exported", () => {
    const dir = scratch();
    const run = install(dir, {
      env: {
        ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
        OPENSTACK_APPLICATION_CREDENTIAL_ID: APP_ID,
        OPENSTACK_APPLICATION_CREDENTIAL_SECRET: APP_SECRET,
      },
      input: answers(URL, "prod", AUTH_URL, "RegionOne", ""),
    });

    expect(run.status).toBe(0);
    expectNoSecretIn(run.curlLog);
    expectNoSecretIn(run.docker);
    expectNoSecretIn(run.output);
    expect(run.curlLog).toContain("--data-binary @-");
    expect(
      keystoneRequests(dir)[0].auth.identity.application_credential,
    ).toEqual({ id: APP_ID, secret: APP_SECRET });

    const atKeystone = readIfExists(path.join(dir, "env-at-keystone.txt"));
    const atUp = readIfExists(path.join(dir, "env-at-up.txt"));
    expect(atKeystone).toContain("STUB_DIR=");
    expect(atUp).toContain("STUB_DIR=");
    expectNoSecretIn(atKeystone);
    expectNoSecretIn(atUp);
    expect(atKeystone).not.toContain(KEY);
    expect(atUp).not.toContain(KEY);
  });

  test("a password likewise", () => {
    const dir = scratch();
    const run = install(dir, {
      env: { OPENSTACK_PASSWORD: PASSWORD },
      input: answers(
        URL,
        KEY,
        "prod",
        AUTH_URL,
        "RegionOne",
        "monitor",
        "monitoring",
        "",
        "",
        "",
      ),
    });

    expect(run.status).toBe(0);
    expectNoSecretIn(run.curlLog);
    expectNoSecretIn(run.docker);
    expectNoSecretIn(run.output);
    expectNoSecretIn(readIfExists(path.join(dir, "env-at-keystone.txt")));
  });

  test("a refusal does not repeat what Keystone was sent", () => {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(path.join(dir, "keystone.answer"), "401");

    const run = install(dir, { input: FRESH });

    expect(run.status).not.toBe(0);
    expectNoSecretIn(run.output);
  });

  test("the script: a line naming a secret runs no program and prints nothing", () => {
    const lines = agentFile("install.sh")
      .split("\n")
      .filter((line) => {
        return (
          !line.trimStart().startsWith("#") &&
          /OPENSTACK_APPLICATION_CREDENTIAL_(ID|SECRET)|OPENSTACK_PASSWORD|ONEUPTIME_TELEMETRY_INGESTION_KEY\b/.test(
            line,
          )
        );
      });

    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect({
        line,
        runs: /\b(?:curl|docker|grep|sed|awk|tee|cat|cut|tr|echo)\b/.test(line),
      }).toEqual({ line, runs: false });
    }
  });

  test("the script reads every secret without echo", () => {
    const script = agentFile("install.sh");

    for (const name of [
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "OPENSTACK_APPLICATION_CREDENTIAL_ID",
      "OPENSTACK_APPLICATION_CREDENTIAL_SECRET",
      "OPENSTACK_PASSWORD",
    ]) {
      const reads = script.split("\n").filter((line) => {
        return /\bread -r/.test(line) && line.includes(name);
      });

      expect({ name, reads: reads.length }).toEqual({ name, reads: 1 });
      expect(reads[0]).toMatch(/\bread -rsp /);
    }
  });
});

/* ========================================================== whose file it is */

describe("clouds.yaml belongs to the user the exporter runs as", () => {
  test("the image runs as uid 65532: run as root, the file goes to that user, before it is in place", () => {
    const dir = scratch();
    const run = install(dir, { input: FRESH, env: { FAKE_UID: "0" } });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile).OPENSTACK_EXPORTER_USER).toBe("65532:65532");
    expect(run.chownLog).toMatch(
      /^65532:65532 .*\/agent\/\.clouds\.yaml\.[A-Za-z0-9]+\n$/,
    );
    expect(mode(path.join(run.installDir, "clouds.yaml"))).toBe(0o600);
  });

  test("run as another user, who cannot do that, the exporter runs as that user", () => {
    const dir = scratch();
    const run = install(dir, { input: FRESH, env: { FAKE_UID: "1001" } });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile).OPENSTACK_EXPORTER_USER).toBe("1001:1001");
    expect(run.chownLog).toBe("");
  });

  test("on rootless Docker the container's root is that user", () => {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(
      path.join(dir, "docker-security-options"),
      "[name=seccomp,profile=builtin name=rootless name=cgroupns]\n",
    );

    const run = install(dir, { input: FRESH, env: { FAKE_UID: "1001" } });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile).OPENSTACK_EXPORTER_USER).toBe("0:0");
  });

  test("a re-run as root puts the ownership right on a file it leaves as it is", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH, env: { FAKE_UID: "0" } });
    expect(first.status).toBe(0);
    const installed = path.join(first.installDir, "clouds.yaml");
    fs.chmodSync(installed, 0o644);
    fs.rmSync(path.join(dir, "chown.log"));

    const rerun = install(dir, { env: { FAKE_UID: "0" } });

    expect(rerun.status).toBe(0);
    expect(mode(installed)).toBe(0o600);
    expect(rerun.chownLog).toBe(`65532:65532 ${installed}\n`);
  });

  test("a value set by hand is kept, and the file follows it", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH, env: { FAKE_UID: "0" } });
    expect(first.status).toBe(0);
    const env = path.join(first.installDir, ".env");
    fs.writeFileSync(
      env,
      fs
        .readFileSync(env, "utf8")
        .replace(
          "OPENSTACK_EXPORTER_USER=65532:65532",
          "OPENSTACK_EXPORTER_USER=2000:2000",
        ),
    );
    fs.rmSync(path.join(dir, "chown.log"));

    const rerun = install(dir, { env: { FAKE_UID: "0" } });

    expect(rerun.status).toBe(0);
    expect(envLines(rerun.envFile).OPENSTACK_EXPORTER_USER).toBe("2000:2000");
    expect(rerun.chownLog).toContain("2000:2000 ");
  });

  test("anything but a uid:gid is refused", () => {
    const dir = scratch();
    const run = install(dir, {
      input: FRESH,
      env: { OPENSTACK_EXPORTER_USER: "nobody; rm -rf /" },
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("OPENSTACK_EXPORTER_USER must be a uid:gid");
    expect(run.envFile).toBe("");
  });

  test("a clouds.yaml this user cannot read says so, rather than asking for the credential again", () => {
    if (process.getuid && process.getuid() === 0) {
      // Root reads anything, so there is nothing to refuse.
      return;
    }
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);
    const installed = path.join(dir, "agent", "clouds.yaml");
    fs.chmodSync(installed, 0o000);

    const rerun = install(dir);
    fs.chmodSync(installed, 0o600);

    expect(rerun.status).not.toBe(0);
    expect(rerun.output).toContain("exists, but this user cannot read it");
  });
});

/* ============================================================ Keystone says no */

describe("the check with Keystone, before anything is written or started", () => {
  function refused(answer, env = {}) {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(path.join(dir, "keystone.answer"), answer);
    return install(dir, { input: FRESH, env });
  }

  function expectNothingHappened(run) {
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Nothing was installed or changed.");
    expect(run.envFile).toBe("");
    expect(run.cloudsText).toBe("");
    expect(fs.existsSync(run.installDir)).toBe(false);
    expect(run.docker).not.toContain("compose up");
    expect(run.docker).not.toContain("compose pull");
    expect(run.output).not.toContain("is running!");
    // Asked of Keystone, and nothing downloaded after it.
    expect(run.curlLog.trim().split("\n")).toHaveLength(1);
  }

  test("a credential Keystone refuses stops the install, and says what is wrong", () => {
    const run = refused("401");

    expectNothingHappened(run);
    expect(run.output).toContain(
      "Error: Keystone refused this credential (HTTP 401).",
    );
    expect(run.output).toContain(
      "The ID, secret or password is wrong, the credential has expired or been deleted, or",
    );
  });

  test.each([
    ["403", "Error: Keystone refused this login (HTTP 403)."],
    ["404", `Error: nothing answers as Keystone at ${AUTH_URL} (HTTP 404).`],
    ["500", `Error: Keystone answered HTTP 500 at ${AUTH_URL}/auth/tokens`],
    [
      "000 6",
      `Error: this machine cannot resolve the host in ${AUTH_URL} (DNS).`,
    ],
    [
      "000 7",
      `Error: this machine could not connect to ${AUTH_URL} (refused, or no route).`,
    ],
    ["000 28", `Error: Keystone did not answer at ${AUTH_URL} in time.`],
    [
      "000 60",
      `Error: the TLS check of ${AUTH_URL} failed: this machine does not trust its certificate.`,
    ],
    ["000 99", `Error: could not ask Keystone at ${AUTH_URL} (curl exit 99).`],
  ])("%s stops it too", (answer, message) => {
    const run = refused(answer);

    expectNothingHappened(run);
    expect(run.output).toContain(message);
  });

  test("an install that cannot ask Keystone can go on when told to, and a refusal is never hidden", () => {
    const unreachable = refused("000 7");
    expect(unreachable.output).toContain(
      "install anyway with OPENSTACK_SKIP_KEYSTONE_CHECK=true in the environment.",
    );
    expect(refused("401").output).not.toContain(
      "OPENSTACK_SKIP_KEYSTONE_CHECK",
    );

    const skipped = refused("000 7", { OPENSTACK_SKIP_KEYSTONE_CHECK: "true" });
    expect(skipped.status).toBe(0);
    expect(skipped.output).toContain(
      "Skipping the check with Keystone (OPENSTACK_SKIP_KEYSTONE_CHECK).",
    );
    expect(skipped.curlLog).not.toContain("/auth/tokens");
    expect(skipped.docker).toContain("compose up");
  });

  test("on a re-run a refusal leaves the running agent and every file as they are", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH });
    expect(first.status).toBe(0);
    fs.rmSync(path.join(dir, "docker.log"));
    fs.writeFileSync(path.join(dir, "keystone.answer"), "401");

    const rerun = install(dir);

    expect(rerun.status).not.toBe(0);
    expect(rerun.envFile).toBe(first.envFile);
    expect(rerun.cloudsText).toBe(first.cloudsText);
    expect(rerun.docker).not.toContain("compose up");
  });

  test("a new credential that is refused does not replace the one that works", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH });
    expect(first.status).toBe(0);
    fs.writeFileSync(path.join(dir, "keystone.answer"), "401");

    const rerun = install(dir, {
      env: {
        OPENSTACK_APPLICATION_CREDENTIAL_ID: "new-id",
        OPENSTACK_APPLICATION_CREDENTIAL_SECRET: "new-secret",
      },
    });

    expect(rerun.status).not.toBe(0);
    expect(rerun.cloudsText).toBe(first.cloudsText);
    expect(backupsIn(rerun.installDir)).toEqual([]);
  });

  test("a clouds.yaml with no credential this script can read is left alone, and said to be unchecked", () => {
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);
    const file = path.join(dir, "agent", "clouds.yaml");
    const text = `clouds:
  RegionOne:
    region_name: RegionOne
    auth:
      auth_url: ${AUTH_URL}
  RegionTwo:
    region_name: RegionTwo
    auth:
      auth_url: ${AUTH_URL}
use_vault: true
`;
    fs.writeFileSync(file, text);

    const rerun = install(dir);

    expect(rerun.status).toBe(0);
    expect(rerun.output).toContain(
      "holds no credential this script can read, so it was left as it is, unchecked.",
    );
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    expect(keystoneRequests(dir)).toHaveLength(1);
  });
});

/* ==================================================================== a private CA */

describe("a private CA file", () => {
  const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

  function withCa(dir, caPath) {
    return install(dir, {
      input: answers(
        URL,
        KEY,
        "prod",
        AUTH_URL,
        "RegionOne",
        "",
        APP_ID,
        APP_SECRET,
        caPath,
      ),
    });
  }

  test("is copied next to clouds.yaml, named in it where the exporter sees it, and used for the check", () => {
    const dir = scratch();
    const source = path.join(dir, "my-ca.pem");
    fs.writeFileSync(source, PEM);
    fs.chmodSync(source, 0o600);

    const run = withCa(dir, source);

    expect(run.status).toBe(0);
    const installed = path.join(run.installDir, "ca.pem");
    expect(fs.readFileSync(installed, "utf8")).toBe(PEM);
    // The exporter reads it as a user of its own, and it is no secret.
    expect(mode(installed)).toBe(0o644);
    expect(composeReadAll(run.envFile).OPENSTACK_CA_FILE).toBe("./ca.pem");
    expect(yaml.load(run.cloudsText).clouds.RegionOne.cacert).toBe(
      "/etc/openstack/ca.pem",
    );
    expect(run.curlLog).toContain(`--cacert ${source} `);
  });

  test("a re-run keeps it, though the file it came from has gone", () => {
    const dir = scratch();
    const source = path.join(dir, "my-ca.pem");
    fs.writeFileSync(source, PEM);
    const first = withCa(dir, source);
    expect(first.status).toBe(0);
    fs.rmSync(source);
    fs.rmSync(path.join(dir, "curl.log"));

    const rerun = install(dir);

    expect(rerun.status).toBe(0);
    expect(rerun.envFile).toBe(first.envFile);
    expect(rerun.cloudsText).toBe(first.cloudsText);
    expect(rerun.curlLog).toContain(
      `--cacert ${path.join(rerun.installDir, "ca.pem")} `,
    );
    expect(backupsIn(rerun.installDir)).toEqual([]);
  });

  test("added on a re-run, clouds.yaml gets it", () => {
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);
    const source = path.join(dir, "my-ca.pem");
    fs.writeFileSync(source, PEM);

    const rerun = install(dir, { env: { OPENSTACK_CA_FILE: source } });

    expect(rerun.status).toBe(0);
    for (const region of ["RegionOne", "RegionTwo"]) {
      expect(yaml.load(rerun.cloudsText).clouds[region].cacert).toBe(
        "/etc/openstack/ca.pem",
      );
    }
  });

  test("a file that cannot be read, or is no certificate, stops the install", () => {
    const missing = withCa(scratch(), "/nonexistent/ca.pem");
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain(
      "Error: cannot read the CA file /nonexistent/ca.pem",
    );

    const dir = scratch();
    const notPem = path.join(dir, "key.pem");
    fs.writeFileSync(notPem, "-----BEGIN PRIVATE KEY-----\n");
    const wrong = withCa(dir, notPem);
    expect(wrong.status).not.toBe(0);
    expect(wrong.output).toContain("holds no PEM certificate");
    expect(wrong.envFile).toBe("");
  });

  test("a plain http:// Keystone is not asked about one", () => {
    const dir = scratch();
    const run = install(dir, {
      input: answers(
        URL,
        KEY,
        "prod",
        "http://keystone.example.com/identity",
        "RegionOne",
        "",
        APP_ID,
        APP_SECRET,
      ),
    });

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile).OPENSTACK_AUTH_URL).toBe(
      "http://keystone.example.com/identity/v3",
    );
  });
});

/* ======================================================= your own exporter */

describe("bring your own exporter", () => {
  const OWN = "10.0.0.5:9180";
  // URL, key, cloud name, regions: no Keystone, no credential, no CA.
  const BYO = answers(URL, KEY, "prod", "RegionOne,RegionTwo");

  function ownExporter(dir, env = {}) {
    return install(dir, {
      input: BYO,
      env: { OPENSTACK_EXPORTER_ADDRESS: OWN, ...env },
    });
  }

  test("asks for no credential, asks Keystone nothing, writes no clouds.yaml, and turns the profile off", () => {
    const dir = scratch();
    const run = ownExporter(dir);

    expect(run.status).toBe(0);
    expect(envLines(run.envFile)).toMatchObject({
      OPENSTACK_AUTH_URL: "''",
      OPENSTACK_EXPORTER_CLOUDS: "'[RegionOne,RegionTwo]'",
      OPENSTACK_EXPORTER_ADDRESS: `'${OWN}'`,
      OPENSTACK_EXPORTER_USER: "",
      COMPOSE_PROFILES: "''",
    });
    expect(fs.existsSync(path.join(run.installDir, "clouds.yaml"))).toBe(false);
    expect(run.curlLog).not.toContain("/auth/tokens");
    expect(run.output).toContain(
      `NOTE: the agent reads your exporter at ${OWN}. It must run with --multi-cloud, and`,
    );
    expect(run.output).toContain(
      "its clouds.yaml needs an entry named for each region: [RegionOne,RegionTwo].",
    );
  });

  test("a re-run keeps it, and asks nothing", () => {
    const dir = scratch();
    const first = ownExporter(dir);
    expect(first.status).toBe(0);

    const rerun = install(dir);

    expect(rerun.status).toBe(0);
    expect(rerun.envFile).toBe(first.envFile);
  });

  test("a scheme or trailing slash on the address is taken off", () => {
    const run = ownExporter(scratch(), {
      OPENSTACK_EXPORTER_ADDRESS: `http://${OWN}/`,
    });

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile).OPENSTACK_EXPORTER_ADDRESS).toBe(OWN);
  });

  test.each([["localhost:9180"], ["127.0.0.1:9180"], ["127.0.0.1:9198"]])(
    "%s is the agent's own container, so it is refused",
    (address) => {
      const run = ownExporter(scratch(), {
        OPENSTACK_EXPORTER_ADDRESS: address,
      });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain(
        "and the agent runs in a container,\nwhere that is the container itself.",
      );
      expect(run.envFile).toBe("");
    },
  );

  test("the bundled exporter's own address is the bundled exporter", () => {
    const dir = scratch();
    const run = install(dir, {
      input: FRESH,
      env: { OPENSTACK_EXPORTER_ADDRESS: "openstack-exporter:9180" },
    });

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile).COMPOSE_PROFILES).toBe(
      "openstack-exporter",
    );
    expect(run.cloudsText).not.toBe("");
  });
});

/* ======================== an exporter without --multi-cloud, and what the cloud stands on */

describe("an exporter already running without --multi-cloud, as Kolla-Ansible runs it", () => {
  const KOLLA = "10.0.0.254:9198";

  function kolla(dir, env = {}, input = answers(URL, KEY, "prod")) {
    return install(dir, {
      input,
      env: {
        OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS: KOLLA,
        OPENSTACK_CONTROL_PLANE_REGION: "RegionOne",
        ...env,
      },
    });
  }

  test("asks for no credential, starts no exporter, and asks it for nothing by region", () => {
    const run = kolla(scratch());

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile)).toMatchObject({
      OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS: `[${KOLLA}]`,
      OPENSTACK_CONTROL_PLANE_REGION: "RegionOne",
      // The per-service jobs read this list, and this exporter has no /probe to ask.
      OPENSTACK_EXPORTER_CLOUDS: "[]",
      OPENSTACK_AUTH_URL: "",
      COMPOSE_PROFILES: "",
    });
    expect(fs.existsSync(path.join(run.installDir, "clouds.yaml"))).toBe(false);
    expect(run.curlLog).not.toContain("/auth/tokens");
  });

  test("says what it reads, and that 1.7.0 says less", () => {
    const run = kolla(scratch());

    expect(run.output).toContain(
      `NOTE: the agent reads your exporter at [${KOLLA}] on /metrics, for region`,
    );
    expect(run.output).toContain(
      "Exporter 1.7.0 says less than the bundled one: README.md says what the pages go without.",
    );
  });

  test("asks which region it reads, because a series from it does not say", () => {
    const run = install(scratch(), {
      input: answers(URL, KEY, "prod", "RegionTwo"),
      env: { OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS: KOLLA },
    });

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile).OPENSTACK_CONTROL_PLANE_REGION).toBe(
      "RegionTwo",
    );
  });

  test("it reads one region, so two is refused, and how to do two is said", () => {
    const run = kolla(scratch(), {
      OPENSTACK_CONTROL_PLANE_REGION: "RegionOne,RegionTwo",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      "an exporter in single-cloud mode reads one region",
    );
    expect(run.output).toContain("Run one agent for each region");
    expect(run.envFile).toBe("");
  });

  test("a re-run keeps it, and asks nothing", () => {
    const dir = scratch();
    const first = kolla(dir);
    expect(first.status).toBe(0);

    const rerun = install(dir);

    expect(rerun.status).toBe(0);
    expect(rerun.envFile).toBe(first.envFile);
    expect(rerun.output).toContain("on /metrics, for region");
  });

  test("the plain bring-your-own note points to it, for whoever has this kind", () => {
    const run = install(scratch(), {
      input: answers(URL, KEY, "prod", "RegionOne"),
      env: { OPENSTACK_EXPORTER_ADDRESS: "10.0.0.5:9180" },
    });

    expect(run.output).toContain(
      "Started without --multi-cloud, as Kolla-Ansible starts it? Set OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS instead.",
    );
  });
});

describe("what the cloud stands on, as lists of targets", () => {
  const LISTS = [
    "OPENSTACK_RABBITMQ_TARGETS",
    "OPENSTACK_MARIADB_TARGETS",
    "OPENSTACK_MEMCACHED_TARGETS",
    "OPENSTACK_HAPROXY_TARGETS",
    "OPENSTACK_NETWORK_EXPORTER_TARGETS",
    "OPENSTACK_LIBVIRT_HEALTH_TARGETS",
  ];

  function withLists(dir, lists) {
    return install(dir, {
      input: FRESH,
      env: lists,
    });
  }

  test("nothing named is an empty list in .env, and nothing is asked", () => {
    const run = withLists(scratch(), {});

    expect(run.status).toBe(0);
    for (const name of LISTS) {
      expect(composeReadAll(run.envFile)[name]).toBe("[]");
    }
    expect(run.output).not.toContain("15692");
  });

  test.each([
    ["10.0.0.11:15692", "[10.0.0.11:15692]"],
    ["[10.0.0.11:15692]", "[10.0.0.11:15692]"],
    [
      " 10.0.0.11:15692 , 10.0.0.12:15692 ",
      "[10.0.0.11:15692,10.0.0.12:15692]",
    ],
    [
      "[10.0.0.11:15692,RegionTwo@10.1.0.11:15692]",
      "[10.0.0.11:15692,RegionTwo@10.1.0.11:15692]",
    ],
    ["rabbit-1.example.com:15692", "[rabbit-1.example.com:15692]"],
    ["[fd00::11]:15692", '["[fd00::11]:15692"]'],
    [
      '["[fd00::11]:15692","[fd00::12]:15692"]',
      '["[fd00::11]:15692","[fd00::12]:15692"]',
    ],
  ])("%s is written as the collector reads a list: %s", (typed, written) => {
    const run = withLists(scratch(), { OPENSTACK_RABBITMQ_TARGETS: typed });

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile).OPENSTACK_RABBITMQ_TARGETS).toBe(written);
    // It is valid YAML with one entry per target.
    expect(yaml.load(written).length).toBe(written.split(",").length);
  });

  test.each([
    ["10.0.0.11", "which has no port"],
    ["10.0.0.11:", "which is not a host:port to scrape"],
    ["http://10.0.0.11:15692", "which is not a host:port to scrape"],
    ["10.0.0.11:15692;reboot", "which is not a host:port to scrape"],
  ])("%s stops the install, and says why", (typed, why) => {
    const run = withLists(scratch(), { OPENSTACK_RABBITMQ_TARGETS: typed });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      `Error: OPENSTACK_RABBITMQ_TARGETS holds "${typed}", ${why}`,
    );
    expect(run.envFile).toBe("");
  });

  test.each([["localhost:15692"], ["127.0.0.1:15692"]])(
    "%s is the agent's own container, so it is refused",
    (typed) => {
      const run = withLists(scratch(), { OPENSTACK_MARIADB_TARGETS: typed });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("OPENSTACK_MARIADB_TARGETS");
      expect(run.output).toContain("where that is the");
      expect(run.envFile).toBe("");
    },
  );

  test("a re-run keeps every list, the VM agent's too", () => {
    const dir = scratch();
    const first = withLists(dir, {
      OPENSTACK_RABBITMQ_TARGETS: "10.0.0.11:15692",
      OPENSTACK_NETWORK_EXPORTER_TARGETS: "10.0.0.11:1981",
      OPENSTACK_LIBVIRT_EXPORTER_TARGETS: "10.0.0.21:9177",
      OPENSTACK_CEILOMETER_EXPORTER_TARGETS: "10.0.0.21:9101",
    });
    expect(first.status).toBe(0);

    const rerun = install(dir);

    expect(rerun.status).toBe(0);
    expect(composeReadAll(rerun.envFile)).toMatchObject({
      OPENSTACK_RABBITMQ_TARGETS: "[10.0.0.11:15692]",
      OPENSTACK_NETWORK_EXPORTER_TARGETS: "[10.0.0.11:1981]",
      OPENSTACK_LIBVIRT_EXPORTER_TARGETS: "[10.0.0.21:9177]",
      OPENSTACK_CEILOMETER_EXPORTER_TARGETS: "[10.0.0.21:9101]",
    });
  });

  test("a target's region defaults to the cloud's first", () => {
    const run = withLists(scratch(), {});

    expect(composeReadAll(run.envFile).OPENSTACK_CONTROL_PLANE_REGION).toBe(
      "RegionOne",
    );
  });

  test("a region given by hand is kept", () => {
    const run = withLists(scratch(), {
      OPENSTACK_CONTROL_PLANE_REGION: "RegionTwo",
    });

    expect(composeReadAll(run.envFile).OPENSTACK_CONTROL_PLANE_REGION).toBe(
      "RegionTwo",
    );
  });

  test("the compose file reads every one of them", () => {
    const compose = agentFile("docker-compose.yml");

    for (const name of [
      ...LISTS,
      "OPENSTACK_CONTROL_PLANE_REGION",
      "OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS",
    ]) {
      expect(compose).toContain(`\${${name}:-`);
    }
  });
});

/* =================================================================== a re-run */

describe("install.sh, as the upgrade", () => {
  test("a re-run reuses every value without asking anything, and writes the same files", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH });
    expect(first.status).toBe(0);

    // No input at all: any prompt would read EOF and stop the script.
    const second = install(dir);

    expect(second.status).toBe(0);
    expect(second.output).toContain(
      `Found an existing configuration in ${path.join(second.installDir, ".env")} — reusing it.`,
    );
    expect(second.envFile).toBe(first.envFile);
    expect(second.cloudsText).toBe(first.cloudsText);
    expect(backupsIn(second.installDir)).toEqual([]);
  });

  test("a re-run reads a hand-written .env as Compose does, and keeps what it says", () => {
    const dir = scratch();
    const installDir = path.join(dir, "agent");
    fs.mkdirSync(installDir);
    fs.writeFileSync(
      path.join(installDir, ".env"),
      [
        `ONEUPTIME_URL=${URL}`,
        `ONEUPTIME_TELEMETRY_INGESTION_KEY="${KEY}"`,
        "OPENSTACK_CLOUD_NAME='cost$$ly' # not a comment inside quotes",
        `OPENSTACK_AUTH_URL=${AUTH_URL}  # the public one`,
        "OPENSTACK_EXPORTER_CLOUDS=[RegionOne,RegionTwo]",
        "COMPOSE_PROFILES=openstack-exporter",
        "",
      ].join("\n"),
    );

    const run = install(dir, {
      env: {
        OPENSTACK_APPLICATION_CREDENTIAL_ID: APP_ID,
        OPENSTACK_APPLICATION_CREDENTIAL_SECRET: APP_SECRET,
      },
    });

    expect(run.status).toBe(0);
    expect(composeReadAll(run.envFile)).toEqual({
      ONEUPTIME_URL: URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
      OPENSTACK_CLOUD_NAME: "cost$$ly",
      OPENSTACK_AUTH_URL: AUTH_URL,
      OPENSTACK_EXPORTER_CLOUDS: "[RegionOne,RegionTwo]",
      OPENSTACK_EXPORTER_ADDRESS: "openstack-exporter:9180",
      OPENSTACK_EXPORTER_USER: "1000:1000",
      OPENSTACK_CA_FILE: "",
      COMPOSE_PROFILES: "openstack-exporter",
    });
  });

  test("an exported variable still overrides the .env on a re-run, and is written back", () => {
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);

    const run = install(dir, {
      env: { ONEUPTIME_TELEMETRY_INGESTION_KEY: NEW_KEY },
    });

    expect(run.status).toBe(0);
    expect(envLines(run.envFile).ONEUPTIME_TELEMETRY_INGESTION_KEY).toBe(
      `'${NEW_KEY}'`,
    );
    expect(envLines(run.envFile).OPENSTACK_CLOUD_NAME).toBe("'prod #1'");
  });

  test("adding a region keeps the credential, and the old clouds.yaml, as private as it was", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH });
    expect(first.status).toBe(0);

    const run = install(dir, {
      env: { OPENSTACK_EXPORTER_CLOUDS: "RegionOne,RegionTwo,Region Three" },
    });

    expect(run.status).toBe(0);
    const { clouds } = yaml.load(run.cloudsText);
    expect(Object.keys(clouds)).toEqual([
      "RegionOne",
      "RegionTwo",
      "Region Three",
    ]);
    expect(clouds["Region Three"].auth.application_credential_secret).toBe(
      APP_SECRET,
    );
    expect(mode(path.join(run.installDir, "clouds.yaml"))).toBe(0o600);

    const [backup] = backupsIn(run.installDir);
    expect(backup).toMatch(/^clouds\.yaml\.bak\.\d{14}$/);
    expect(fs.readFileSync(path.join(run.installDir, backup), "utf8")).toBe(
      first.cloudsText,
    );
    expect(mode(path.join(run.installDir, backup))).toBe(0o600);
    expect(run.output).toContain("NOTE: clouds.yaml changed.");
    expect(run.output).toContain(
      "It holds the old credential: delete it once the agent reports with the new file.",
    );
  });

  test("a region .env lists but clouds.yaml does not is written too", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH });
    expect(first.status).toBe(0);
    const env = path.join(first.installDir, ".env");
    fs.writeFileSync(
      env,
      fs
        .readFileSync(env, "utf8")
        .replace("[RegionOne,RegionTwo]", "[RegionOne,RegionTwo,Region Three]"),
    );

    const run = install(dir);

    expect(run.status).toBe(0);
    expect(Object.keys(yaml.load(run.cloudsText).clouds)).toHaveLength(3);
  });

  test("replacing the credential: the new one is checked, then written for every region", () => {
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);

    const run = install(dir, {
      env: {
        OPENSTACK_APPLICATION_CREDENTIAL_ID: "new-id",
        OPENSTACK_APPLICATION_CREDENTIAL_SECRET: "new-secret",
      },
    });

    expect(run.status).toBe(0);
    expect(
      keystoneRequests(dir)[1].auth.identity.application_credential,
    ).toEqual({ id: "new-id", secret: "new-secret" });
    const { clouds } = yaml.load(run.cloudsText);
    expect(Object.values(clouds)).toHaveLength(2);
    for (const entry of Object.values(clouds)) {
      expect(entry.auth.application_credential_id).toBe("new-id");
      expect(entry.auth.application_credential_secret).toBe("new-secret");
    }
    // The agent starts on it.
    expect(readIfExists(path.join(dir, "clouds-at-up.yaml"))).toContain(
      "new-secret",
    );
  });

  test("a clouds.yaml moved aside asks for the credential alone", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH });
    expect(first.status).toBe(0);
    fs.renameSync(
      path.join(first.installDir, "clouds.yaml"),
      path.join(dir, "old-clouds.yaml"),
    );

    const run = install(dir, { input: answers("", "new-id", "new-secret") });

    expect(run.status).toBe(0);
    expect(run.envFile).toBe(first.envFile);
    expect(
      yaml.load(run.cloudsText).clouds.RegionTwo.auth.application_credential_id,
    ).toBe("new-id");
  });

  test("an edit to clouds.yaml is left alone by a re-run that has no reason to touch it", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH });
    expect(first.status).toBe(0);
    const file = path.join(first.installDir, "clouds.yaml");
    const edited = first.cloudsText.replace(
      "    identity_api_version: 3\n",
      "    identity_api_version: 3\n    verify: true\n",
    );
    expect(edited).not.toBe(first.cloudsText);
    fs.writeFileSync(file, edited);

    const run = install(dir);

    expect(run.status).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(edited);
    expect(backupsIn(run.installDir)).toEqual([]);
    expect(run.output).not.toContain("NOTE:");
  });

  test("pulls the images, then recreates the containers in the install directory", () => {
    const dir = scratch();
    const run = install(dir, { input: FRESH });

    expect(run.status).toBe(0);
    const installDir = fs.realpathSync(run.installDir);
    expect(composeCalls(run.docker)).toEqual([
      { cwd: installDir, args: "compose pull" },
      { cwd: installDir, args: "compose up -d --force-recreate" },
    ]);
  });

  test("a failed pull is not fatal: the agent still starts on the images it has", () => {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(path.join(dir, "pull.fail"), "");

    const run = install(dir, { input: FRESH });

    expect(run.status).toBe(0);
    expect(run.output).toContain(
      "Warning: could not pull the latest images; starting with the ones this machine has.",
    );
    expect(run.docker).toContain("| compose up -d --force-recreate");
  });

  test("a failed start fails the script", () => {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(path.join(dir, "up.fail"), "");

    const run = install(dir, { input: FRESH });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("is running!");
  });

  test("Compose gets no variable from the script's environment: it reads them all from .env", () => {
    const dir = scratch();
    // The setup guide's command carries the URL and key in the environment.
    const run = install(dir, {
      input: answers("prod", AUTH_URL, "RegionOne", "", APP_ID, APP_SECRET, ""),
      env: { ONEUPTIME_URL: URL, ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY },
    });

    expect(run.status).toBe(0);
    const atUp = readIfExists(path.join(dir, "env-at-up.txt"));
    expect(atUp).toContain("STUB_DIR=");
    for (const name of envNames(agentFile("install.sh"))) {
      expect({
        name,
        inEnvironment: new RegExp(`^${name}=`, "m").test(atUp),
      }).toEqual({ name, inEnvironment: false });
    }
  });

  test("a re-run starts the collector on the config it just downloaded", () => {
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);

    const upstream = newerUpstream();
    const upgraded = install(dir, { env: { SERVE_DIR: upstream } });

    expect(upgraded.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "config-at-up.yaml"), "utf8")).toBe(
      fs.readFileSync(
        path.join(upstream, "otel-collector-config.yaml"),
        "utf8",
      ),
    );
    // Nobody edited the files: replaced, no copies, no notes.
    expect(backupsIn(upgraded.installDir)).toEqual([]);
    expect(upgraded.output).not.toContain("NOTE:");
  });

  test("records a sha256 of every file it installed, and leaves nothing from the download behind", () => {
    const dir = scratch();
    const run = install(dir, { input: FRESH });
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
      expect(mode(path.join(run.installDir, file))).toBe(0o644);
    }
    expect(
      fs.readdirSync(run.installDir).filter((file) => {
        return (
          file.includes(".download") ||
          file.endsWith(".new") ||
          file.startsWith(".clouds")
        );
      }),
    ).toEqual([]);
    // A secret's hash can be guessed at, so clouds.yaml has no line in the record.
    expect(
      fs.readFileSync(path.join(run.installDir, ".agent-files.sha256"), "utf8"),
    ).not.toContain("clouds.yaml");
  });

  test("an upgrade keeps a file you edited as <file>.bak.<timestamp>, and says so", () => {
    const dir = scratch();
    expect(install(dir, { input: FRESH }).status).toBe(0);
    const config = path.join(dir, "agent", "otel-collector-config.yaml");
    const edited = `${fs.readFileSync(config, "utf8")}# my edit\n`;
    fs.writeFileSync(config, edited);

    const upgraded = install(dir, { env: { SERVE_DIR: newerUpstream() } });

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

  test("without a record, every file that differs is kept", () => {
    const dir = scratch();
    const first = install(dir, { input: FRESH });
    expect(first.status).toBe(0);
    fs.rmSync(path.join(first.installDir, ".agent-files.sha256"));

    const upgraded = install(dir, { env: { SERVE_DIR: newerUpstream() } });

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

  test("ends by saying that running it again is the upgrade, and where to look if nothing shows up", () => {
    const dir = scratch();
    const run = install(dir, { input: FRESH });
    expect(run.status).toBe(0);
    expect(run.output).toContain(
      `To upgrade:       run this installer again; it reuses ${path.join(run.installDir, ".env")}`,
    );
    expect(run.output).toContain(
      `If nothing shows up: curl -fsSL ${URL}/install/${INSTALL_NAME}/troubleshoot.sh | bash -s -- -d ${run.installDir}`,
    );
    expect(run.output).toContain(
      "That script also says what this credential can read, what each gap costs, and whether\nits project holds anything it might be able to write to.",
    );
  });
});

/* ===================================================== where the files come from */

describe("where its files come from", () => {
  const SERVED = `${URL}/install/${INSTALL_NAME}`;
  const GITHUB =
    "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/OpenStackAgent";

  function downloads(dir) {
    return readIfExists(path.join(dir, "curl.log"))
      .split("\n")
      .filter((line) => {
        return line.includes(" -w ") && !line.includes("/auth/tokens");
      });
  }

  test("downloads every file from the OneUptime it reports to, never from GitHub", () => {
    const dir = scratch();
    const run = install(dir, { input: FRESH });

    expect(run.status).toBe(0);
    expect(
      downloads(dir).map((call) => {
        return call.split(" ").pop();
      }),
    ).toEqual([
      `${SERVED}/docker-compose.yml`,
      `${SERVED}/otel-collector-config.yaml`,
    ]);
    expect(run.curlLog).not.toContain("raw.githubusercontent.com");
    expect(run.output).not.toContain("GitHub");
    for (const file of ["docker-compose.yml", "otel-collector-config.yaml"]) {
      expect(fs.readFileSync(path.join(run.installDir, file), "utf8")).toBe(
        agentFile(file),
      );
    }
  });

  test("a OneUptime older than the script answers 404: the files come from GitHub, and it says so", () => {
    const dir = scratch();
    installStubs(dir);
    fs.writeFileSync(path.join(dir, "oneuptime.answer"), "404 text/html");

    const run = install(dir, { input: FRESH });

    expect(run.status).toBe(0);
    expect(run.output).toContain("Downloading them from GitHub instead.");
    expect(downloads(dir).join("\n")).toContain(
      `${GITHUB}/otel-collector-config.yaml`,
    );
    expect(run.docker).toContain("| compose up -d --force-recreate");
  });

  test.each([
    [
      "a server error",
      "500 text/plain; charset=utf-8",
      "answered 500, not the file",
    ],
    ["no answer at all", "000", "Error: could not reach"],
  ])(
    "%s from the OneUptime stops the install before it writes or starts anything",
    (_what, answer, message) => {
      const dir = scratch();
      installStubs(dir);
      fs.writeFileSync(path.join(dir, "oneuptime.answer"), answer);

      const run = install(dir, { input: FRESH });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain(message);
      expect(run.envFile).toBe("");
      expect(run.cloudsText).toBe("");
      expect(run.docker).not.toContain("compose up");
      expect(
        fs.readdirSync(run.installDir).filter((file) => {
          return file.includes(".download.");
        }),
      ).toEqual([]);
    },
  );
});

/* =============================================================== the script's shape */

describe("agents/OpenStackAgent/install.sh, statically", () => {
  const script = agentFile("install.sh");

  test("keeps every variable docker-compose.yml reads and writes exactly those, with what it and the doctor read", () => {
    const names = envNames(script);
    const expected = [
      ...composeVariables(),
      // Compose itself reads which profiles to start from .env.
      "COMPOSE_PROFILES",
      // This script and troubleshoot.sh.
      "OPENSTACK_AUTH_URL",
    ];
    expect([...names].sort()).toEqual(expected.sort());
    expect(writtenNames(script)).toEqual(names);
  });

  test("quotes every value but the validated one for what reads the file", () => {
    const heredoc = script.match(
      /cat > "\$ENV_FILE" <<ENVEOF\n([\s\S]*?)\nENVEOF/,
    )[1];
    for (const name of envNames(script)) {
      const line =
        name === "OPENSTACK_EXPORTER_USER"
          ? `${name}=$${name}`
          : `${name}=$(env_value "$${name}")`;
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
    const installDir = "/opt/oneuptime-openstack-agent";
    expect(script).toContain(`INSTALL_DIR="\${INSTALL_DIR:-${installDir}}"`);
    expect(agentFile("systemd/oneuptime-openstack-agent.service")).toContain(
      `WorkingDirectory=${installDir}\n`,
    );
    expect(agentFile("troubleshoot.sh")).toContain(`DIR="${installDir}"`);
  });

  test("clouds.yaml is generated, so it is no file OneUptime serves", () => {
    const entry = loadInstallScriptsCatalog().INSTALL_SCRIPTS.find(
      (candidate) => {
        return candidate.name === INSTALL_NAME;
      },
    );
    expect(entry.files).not.toContain("clouds.yaml");
    expect(fs.existsSync(path.join(AGENT_DIR, "clouds.yaml"))).toBe(false);
  });

  test("passes bash -n", () => {
    for (const file of ["install.sh", "troubleshoot.sh"]) {
      const result = spawnSync("bash", ["-n", path.join(AGENT_DIR, file)], {
        encoding: "utf8",
      });
      expect({ file, stderr: result.stderr, status: result.status }).toEqual({
        file,
        stderr: "",
        status: 0,
      });
    }
  });
});

describe("the compose file, for the installer", () => {
  const compose = yaml.load(agentFile("docker-compose.yml"));

  test("starts the bundled exporter by a profile, and the collector asks for it by nothing Compose would refuse", () => {
    expect(compose.services["openstack-exporter"].profiles).toEqual([
      "openstack-exporter",
    ]);
    /*
     * A service with no profile that depends on one whose profile is off is an
     * error to Compose: your-own-exporter would not start at all.
     */
    expect(compose.services["oneuptime-openstack-agent"].depends_on).toBe(
      undefined,
    );
  });

  test("runs the exporter as the user that owns clouds.yaml, and it only reads", () => {
    const exporter = compose.services["openstack-exporter"];
    expect(exporter.user).toBe("${OPENSTACK_EXPORTER_USER:-65532:65532}");
    expect(exporter.read_only).toBe(true);
    expect(exporter.cap_drop).toEqual(["ALL"]);
    expect(exporter.security_opt).toEqual(["no-new-privileges:true"]);
    expect(exporter.volumes).toEqual([
      "./clouds.yaml:/etc/openstack/clouds.yaml:ro",
      "${OPENSTACK_CA_FILE:-/dev/null}:/etc/openstack/ca.pem:ro",
    ]);
  });
});

/* ========================================== what the real Compose reads */

describe("the .env the installer writes, as the real Docker Compose reads it (required in CI)", () => {
  const maybe = HAS_COMPOSE || IN_CI ? test : test.skip;

  maybe(
    "the profile starts the bundled exporter, every value reaches its container as typed, and the exporter runs as the file's owner",
    () => {
      const dir = scratch();
      const cloudName = `prod "east" #1 $HOME'x`;
      const run = install(dir, {
        input: answers(
          URL,
          KEY,
          cloudName,
          AUTH_URL,
          "RegionOne,RegionTwo",
          "",
          APP_ID,
          APP_SECRET,
          "",
        ),
      });
      expect(run.status).toBe(0);

      const config = realComposeConfig(run.installDir);
      expect(Object.keys(config.services).sort()).toEqual([
        "oneuptime-openstack-agent",
        "openstack-exporter",
      ]);
      expect(
        serviceEnvironment(config, "oneuptime-openstack-agent"),
      ).toMatchObject({
        ONEUPTIME_URL: URL,
        ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
        OPENSTACK_CLOUD_NAME: cloudName,
        // The YAML list the collector's scrape targets read.
        OPENSTACK_EXPORTER_CLOUDS: "[RegionOne,RegionTwo]",
        OPENSTACK_EXPORTER_ADDRESS: "openstack-exporter:9180",
      });
      const exporter = config.services["openstack-exporter"];
      expect(exporter.user).toBe("1000:1000");
      // No credential reaches a container but through the file.
      expect(exporter.environment).toBe(undefined);
      expect(JSON.stringify(config)).not.toContain(APP_ID);
      expect(
        exporter.volumes.map((volume) => {
          return `${path.basename(volume.source)}:${volume.target}:${volume.read_only}`;
        }),
      ).toEqual([
        "clouds.yaml:/etc/openstack/clouds.yaml:true",
        // Mounts a file nothing reads, and Compose makes no folder for a missing CA.
        "null:/etc/openstack/ca.pem:true",
      ]);
    },
  );

  maybe.each([
    ["a space and a comment sign", "prod east #1"],
    ["a trailing backslash", "prod\\"],
    ["a single quote and a dollar", "it's $5"],
    ["a double dollar", "cost$$ly"],
  ])("a cloud name with %s reaches the collector as typed", (_what, name) => {
    const dir = scratch();
    const run = install(dir, {
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
    expect(composeReadAll(run.envFile).OPENSTACK_CLOUD_NAME).toBe(name);

    const config = realComposeConfig(run.installDir);
    expect(
      serviceEnvironment(config, "oneuptime-openstack-agent")
        .OPENSTACK_CLOUD_NAME,
    ).toBe(name);
  });

  maybe("a private CA is mounted where clouds.yaml names it", () => {
    const dir = scratch();
    const source = path.join(dir, "my-ca.pem");
    fs.writeFileSync(
      source,
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    );
    const run = install(dir, {
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

    const config = realComposeConfig(run.installDir);
    const mount = config.services["openstack-exporter"].volumes.find(
      (volume) => {
        return volume.target === "/etc/openstack/ca.pem";
      },
    );
    expect(mount.source).toBe(
      path.join(fs.realpathSync(run.installDir), "ca.pem"),
    );
  });

  maybe(
    "your own exporter starts no bundled one, and needs no clouds.yaml",
    () => {
      const dir = scratch();
      const run = install(dir, {
        input: answers(URL, KEY, "prod", "RegionOne"),
        env: { OPENSTACK_EXPORTER_ADDRESS: "10.0.0.5:9180" },
      });
      expect(run.status).toBe(0);

      const config = realComposeConfig(run.installDir);
      expect(Object.keys(config.services)).toEqual([
        "oneuptime-openstack-agent",
      ]);
      expect(
        serviceEnvironment(config, "oneuptime-openstack-agent")
          .OPENSTACK_EXPORTER_ADDRESS,
      ).toBe("10.0.0.5:9180");
    },
  );

  maybe(
    "the README's hand-written .env gives the same exporter, and its default user is the image's",
    () => {
      const installDir = scratch();
      for (const file of ["docker-compose.yml", "otel-collector-config.yaml"]) {
        fs.copyFileSync(
          path.join(AGENT_DIR, file),
          path.join(installDir, file),
        );
      }
      fs.writeFileSync(path.join(installDir, "clouds.yaml"), "clouds: {}\n");
      fs.writeFileSync(
        path.join(installDir, ".env"),
        [
          `ONEUPTIME_URL=${URL}`,
          `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
          "OPENSTACK_CLOUD_NAME=my-cloud",
          "OPENSTACK_EXPORTER_CLOUDS=[RegionOne,RegionTwo]",
          "COMPOSE_PROFILES=openstack-exporter",
          "",
        ].join("\n"),
      );

      const config = realComposeConfig(installDir);
      expect(config.services["openstack-exporter"].user).toBe("65532:65532");
      expect(
        serviceEnvironment(config, "oneuptime-openstack-agent")
          .OPENSTACK_EXPORTER_ADDRESS,
      ).toBe("openstack-exporter:9180");
    },
  );
});

/* ================================================ with the real curl and a server */

describe("with the real curl, against a server that answers as OneUptime and Keystone do", () => {
  jest.setTimeout(120000);

  let server = null;
  let baseUrl = "";
  const logins = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        if (request.url.startsWith("/identity/v3/auth/tokens")) {
          logins.push({
            method: request.method,
            type: request.headers["content-type"],
            body: JSON.parse(body),
          });
          response.writeHead(201, {
            "Content-Type": "application/json",
            "X-Subject-Token": "issued-token",
          });
          response.end(catalogAnswer(["RegionOne"]));
          return;
        }
        const served = request.url.match(/^\/install\/openstack-agent\/(.+)$/);
        if (served) {
          response.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end(agentFile(served[1]));
          return;
        }
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found\n");
      });
    });
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test("the credential arrives as typed, the files are the real ones, and the agent starts", async () => {
    const dir = scratch();
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    writeExecutable(
      path.join(bin, "docker"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/docker.log"\nexit 0\n`,
    );
    const installDir = path.join(dir, "agent");

    const run = await new Promise((resolve) => {
      const child = spawn("bash", [SCRIPT], {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: dir,
          STUB_DIR: dir,
          INSTALL_DIR: installDir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("close", (status) => {
        resolve({ status, output });
      });
      child.stdin.end(
        answers(
          baseUrl,
          KEY,
          "prod",
          `${baseUrl}/identity`,
          "RegionOne",
          "",
          APP_ID,
          APP_SECRET,
        ),
      );
    });

    expect({ status: run.status, output: run.output }).toEqual({
      status: 0,
      output: expect.stringContaining("OneUptime OpenStack Agent is running!"),
    });
    expect(logins).toEqual([
      {
        method: "POST",
        type: "application/json",
        body: {
          auth: {
            identity: {
              methods: ["application_credential"],
              application_credential: { id: APP_ID, secret: APP_SECRET },
            },
          },
        },
      },
    ]);
    expect(
      fs.readFileSync(path.join(installDir, "docker-compose.yml"), "utf8"),
    ).toBe(agentFile("docker-compose.yml"));
    expect(
      yaml.load(fs.readFileSync(path.join(installDir, "clouds.yaml"), "utf8"))
        .clouds.RegionOne.auth.application_credential_secret,
    ).toBe(APP_SECRET);
    expect(readIfExists(path.join(dir, "docker.log"))).toContain(
      "compose up -d --force-recreate",
    );
  });

  test("a Keystone that says no, with the real curl, stops it", async () => {
    const dir = scratch();
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    writeExecutable(
      path.join(bin, "docker"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/docker.log"\nexit 0\n`,
    );
    const refuser = http.createServer((_request, response) => {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end('{"error":{"code":401,"message":"Unauthorized"}}');
    });
    await new Promise((resolve) => {
      refuser.listen(0, "127.0.0.1", resolve);
    });
    const installDir = path.join(dir, "agent");

    const run = await new Promise((resolve) => {
      const child = spawn("bash", [SCRIPT], {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: dir,
          STUB_DIR: dir,
          INSTALL_DIR: installDir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("close", (status) => {
        resolve({ status, output });
      });
      child.stdin.end(
        answers(
          baseUrl,
          KEY,
          "prod",
          `http://127.0.0.1:${refuser.address().port}/v3`,
          "RegionOne",
          "",
          APP_ID,
          APP_SECRET,
        ),
      );
    });
    await new Promise((resolve) => {
      refuser.close(resolve);
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      "Error: Keystone refused this credential (HTTP 401).",
    );
    expect(fs.existsSync(installDir)).toBe(false);
    expect(readIfExists(path.join(dir, "docker.log"))).not.toContain(
      "compose up",
    );
  });

  test("a port nothing listens on, with the real curl, reads as no answer", async () => {
    const dir = scratch();
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    writeExecutable(path.join(bin, "docker"), "#!/usr/bin/env bash\nexit 0\n");
    const probe = http.createServer();
    await new Promise((resolve) => {
      probe.listen(0, "127.0.0.1", resolve);
    });
    const closedPort = probe.address().port;
    await new Promise((resolve) => {
      probe.close(resolve);
    });

    const run = await new Promise((resolve) => {
      const child = spawn("bash", [SCRIPT], {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: dir,
          STUB_DIR: dir,
          INSTALL_DIR: path.join(dir, "agent"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("close", (status) => {
        resolve({ status, output });
      });
      child.stdin.end(
        answers(
          baseUrl,
          KEY,
          "prod",
          `http://127.0.0.1:${closedPort}/v3`,
          "RegionOne",
          "",
          APP_ID,
          APP_SECRET,
        ),
      );
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("this machine could not connect to");
    expect(run.output).toContain("Nothing was installed or changed.");
  });
});
