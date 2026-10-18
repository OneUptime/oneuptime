"use strict";

/**
 * OneUptime Cloud's MCP server goes into the official MCP Registry
 * (registry.modelcontextprotocol.io) as com.oneuptime/mcp, at each release's
 * version, once the release is published: release.yml's publish-mcp-registry
 * job runs Scripts/MCP/PublishToMcpRegistry.sh on
 * packages/App/FeatureSet/MCP/server.json.
 *
 * The script runs here with a fake `curl`, which gives the registry's answers
 * to the lookup, and a fake `mcp-publisher` on PATH: what it publishes, at
 * which version, what it skips, and that it stops before signing in or
 * publishing when it cannot tell, or has no key. The job is read from the
 * workflow: when it runs, and how little it is given.
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
const SCRIPT = "Scripts/MCP/PublishToMcpRegistry.sh";
const SERVER_JSON = "packages/App/FeatureSet/MCP/server.json";
const JOB = "publish-mcp-registry";
const ENVIRONMENT = "mcp-registry-publish";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const jobs = yaml.load(read(RELEASE)).jobs;
const serverJson = JSON.parse(read(SERVER_JSON));

const VERSION = "9.9.9";
// An Ed25519 seed, in hex, as the secret holds one.
const KEY = "11".repeat(32);
const LOOKUP = `https://registry.modelcontextprotocol.io/v0.1/servers/com.oneuptime%2Fmcp/versions/${VERSION}?include_deleted=true`;

const E2E_JOBS = [
  "test-e2e-release-saas",
  "test-e2e-release-self-hosted",
  "test-e2e-release-enterprise",
];

describe(`${SCRIPT}`, () => {
  let workDir = "";
  let runs = 0;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-registry-release-"));
    fs.mkdirSync(path.join(workDir, "bin"));

    // The registry's answer to each lookup, in order; the last one repeats.
    fs.writeFileSync(
      path.join(workDir, "bin", "curl"),
      [
        "#!/usr/bin/env bash",
        "for url; do :; done",
        'printf "%s\\n" "$url" >>"$FAKE_LOG.curl"',
        'count_file="$FAKE_LOG.curl-count"',
        "count=0",
        '[ -f "$count_file" ] && count="$(cat "$count_file")"',
        'count=$((count + 1)); echo "$count" >"$count_file"',
        'status="$(sed -n "${count}p" "$FAKE_CURL_STATUSES")"',
        '[ -n "$status" ] || status="$(tail -n 1 "$FAKE_CURL_STATUSES")"',
        'printf "%s" "$status"',
        // curl's exit code when it could not connect, as it answers 000.
        '[ "$status" = "000" ] && exit 7',
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    // Keeps each command, and each server.json it is handed: the script removes its copy.
    fs.writeFileSync(
      path.join(workDir, "bin", "mcp-publisher"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$*" >>"$FAKE_LOG.publisher"',
        'case "$1" in',
        '  validate|publish) cp "$2" "$FAKE_LOG.$1.json" ;;',
        "esac",
        'if [ "$1" = "${FAKE_PUBLISHER_FAIL_ON:-}" ]; then',
        '  echo "Error: the registry refused $1" >&2; exit 1',
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  });

  afterAll(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  function runScript({
    statuses = ["404"],
    version = VERSION,
    key = KEY,
    failOn = "",
  } = {}) {
    runs += 1;
    const log = path.join(workDir, `run-${runs}`);
    const statusesFile = `${log}.statuses`;
    fs.writeFileSync(statusesFile, `${statuses.join("\n")}\n`);

    const result = spawnSync("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60000,
      env: {
        ...process.env,
        PATH: `${path.join(workDir, "bin")}${path.delimiter}${process.env.PATH}`,
        PACKAGE_VERSION: version,
        MCP_REGISTRY_PRIVATE_KEY: key,
        MCP_REGISTRY_LOOKUP_RETRY_DELAYS: "0 0 0",
        FAKE_LOG: log,
        FAKE_CURL_STATUSES: statusesFile,
        FAKE_PUBLISHER_FAIL_ON: failOn,
      },
    });

    const lines = (suffix) => {
      const file = `${log}.${suffix}`;
      if (!fs.existsSync(file)) {
        return [];
      }
      return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => {
          return line.length > 0;
        });
    };
    const handed = (command) => {
      const file = `${log}.${command}.json`;
      return fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, "utf8"))
        : undefined;
    };

    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      lookups: lines("curl"),
      // The temporary copy's path differs on every run.
      commands: lines("publisher").map((line) => {
        return line.replace(/\S*\/server\.json$/, "<copy of server.json>");
      }),
      validated: handed("validate"),
      published: handed("publish"),
    };
  }

  const SIGN_IN = `login dns --registry https://registry.modelcontextprotocol.io --domain oneuptime.com --private-key ${KEY}`;
  const PUBLISHES = [
    "validate <copy of server.json>",
    SIGN_IN,
    "publish <copy of server.json>",
  ];

  test("publishes server.json at the release's version when the registry does not have it", () => {
    const run = runScript({ statuses: ["404"] });

    expect(run.status).toBe(0);
    expect(run.lookups).toEqual([LOOKUP]);
    expect(run.commands).toEqual(PUBLISHES);
    expect(run.validated).toEqual({ ...serverJson, version: VERSION });
    expect(run.published).toEqual({ ...serverJson, version: VERSION });
    // The repository's copy keeps its placeholder.
    expect(JSON.parse(read(SERVER_JSON)).version).toBe("0.0.0");
  });

  test("skips a version the registry already has, and signs in to nothing", () => {
    const run = runScript({ statuses: ["200"] });

    expect(run.status).toBe(0);
    expect(run.output).toContain(
      `com.oneuptime/mcp ${VERSION} is already in the MCP Registry. Skipping.`,
    );
    expect(run.lookups).toEqual([LOOKUP]);
    expect(run.commands).toEqual([]);
  });

  test("asks again when the registry answers with an error, or not at all, and goes by its answer", () => {
    const published = runScript({ statuses: ["500", "000", "404"] });

    expect(published.status).toBe(0);
    expect(published.lookups).toEqual([LOOKUP, LOOKUP, LOOKUP]);
    expect(published.commands).toEqual(PUBLISHES);

    const skipped = runScript({ statuses: ["502", "200"] });

    expect(skipped.status).toBe(0);
    expect(skipped.lookups).toEqual([LOOKUP, LOOKUP]);
    expect(skipped.commands).toEqual([]);
  });

  test("fails, and publishes nothing, when the registry cannot say whether it has the version", () => {
    const run = runScript({ statuses: ["500"] });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      `::error::Could not tell whether the MCP Registry has com.oneuptime/mcp ${VERSION}`,
    );
    // The first lookup and the three retries the delays allow.
    expect(run.lookups).toEqual([LOOKUP, LOOKUP, LOOKUP, LOOKUP]);
    expect(run.commands).toEqual([]);
  });

  test("fails before signing in when the registry key is missing", () => {
    const run = runScript({ key: "" });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(
      "::error::MCP_REGISTRY_PRIVATE_KEY is not set",
    );
    expect(run.commands).toEqual([]);
  });

  test("needs the release's version, and asks the registry nothing without it", () => {
    const run = runScript({ version: "" });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("PACKAGE_VERSION is required");
    expect(run.lookups).toEqual([]);
    expect(run.commands).toEqual([]);
  });

  test("fails at the first step the registry refuses, and goes no further", () => {
    const commandsUpTo = {
      validate: ["validate <copy of server.json>"],
      login: ["validate <copy of server.json>", SIGN_IN],
      publish: PUBLISHES,
    };

    for (const [failOn, commands] of Object.entries(commandsUpTo)) {
      const run = runScript({ failOn });

      expect({
        failOn,
        failed: run.status !== 0,
        commands: run.commands,
      }).toEqual({ failOn, failed: true, commands });
    }
  });

  test("signs in as the domain whose namespace the entry is named in", () => {
    const domain = /--domain (\S+)/.exec(SIGN_IN)[1];
    const namespace = serverJson.name.split("/")[0];

    expect(domain.split(".").reverse().join(".")).toBe(namespace);
    expect(read(SCRIPT)).toContain(`DOMAIN="${domain}"`);
  });
});

describe(`${RELEASE}: ${JOB}`, () => {
  const job = jobs[JOB];
  const steps = (job && job.steps) || [];
  const publishStep = steps.find((step) => {
    return stepCommand(step).includes(SCRIPT);
  });
  const installStep = steps.find((step) => {
    return step.name === "Install mcp-publisher";
  });

  test("runs the script, at the release's version (the checks below are not vacuous)", () => {
    expect(job).toBeDefined();
    expect(publishStep).toBeDefined();
    expect(stepCommand(publishStep).trim()).toBe(`bash ./${SCRIPT}`);
    expect(publishStep.env.PACKAGE_VERSION).toBe(
      "${{ needs.read-version.outputs.major_minor }}",
    );
    expect(needsOf(job)).toContain("read-version");
  });

  test("runs once the GitHub release is published, and so only after the e2e jobs pass", () => {
    expect(needsOf(job)).toContain("finalize-github-release");
    expect(job.if).toBeUndefined();

    const waitsFor = ancestorsOf(jobs, JOB);
    for (const e2e of E2E_JOBS) {
      expect({ e2e, waited: waitsFor.has(e2e) }).toEqual({ e2e, waited: true });
    }
  });

  test(`reads the registry key from the ${ENVIRONMENT} environment, which no other job names`, () => {
    expect(job.environment).toBe(ENVIRONMENT);
    expect(publishStep.env.MCP_REGISTRY_PRIVATE_KEY).toBe(
      "${{ secrets.MCP_REGISTRY_PRIVATE_KEY }}",
    );

    for (const [name, other] of Object.entries(jobs)) {
      if (name === JOB) {
        continue;
      }
      expect({ name, environment: other.environment }).not.toEqual({
        name,
        environment: ENVIRONMENT,
      });
      expect({
        name,
        readsKey: JSON.stringify(other).includes("MCP_REGISTRY_PRIVATE_KEY"),
      }).toEqual({ name, readsKey: false });
    }
  });

  test("may read the repository and nothing else, and hands values to its scripts through env", () => {
    expect(job.permissions).toEqual({ contents: "read" });
    expect(
      steps
        .filter((step) => {
          return stepCommand(step).includes("${{");
        })
        .map((step) => {
          return step.name || step.uses;
        }),
    ).toEqual([]);
  });

  test("installs the mcp-publisher it pins, checked against its sha256 before it is unpacked", () => {
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.env.MCP_PUBLISHER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(job.env.MCP_PUBLISHER_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(installStep).toBeDefined();
    expect(steps.indexOf(installStep)).toBeLessThan(steps.indexOf(publishStep));

    const script = stepCommand(installStep);
    const download = script.indexOf(
      "releases/download/v${MCP_PUBLISHER_VERSION}/mcp-publisher_linux_amd64.tar.gz",
    );
    const check = script.indexOf(
      '"${MCP_PUBLISHER_SHA256}  $install_dir/mcp-publisher.tar.gz" | sha256sum --check --strict',
    );
    const unpack = script.indexOf("tar -xzf");

    expect(download).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(download);
    expect(unpack).toBeGreaterThan(check);
  });
});
