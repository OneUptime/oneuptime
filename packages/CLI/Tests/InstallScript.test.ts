import { spawnSync, SpawnSyncReturns } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * Install/install.sh, which every OneUptime serves at /install/cli
 * (Common/Types/InstallScripts): it asks the OneUptime in ONEUPTIME_URL for
 * its version and installs the npm package of that version.
 *
 * Run for real with bash, against stand-ins for node, npm, curl and the
 * installed oneuptime on PATH, which write down how they were called: so
 * each case shows what the script ran, what it said, and how it exited,
 * with no network and nothing installed.
 */

const SCRIPT: string = path.resolve(__dirname, "..", "Install", "install.sh");

interface Result {
  status: number;
  stdout: string;
  stderr: string;
  // What the stand-ins were called with, one call a line.
  calls: Array<string>;
}

let bin: string;
let log: string;

/*
 * A stand-in command: logs "<name> <args>" and answers from the
 * environment the case sets.
 */
function writeStandIn(name: string, body: string): void {
  const file: string = path.join(bin, name);

  fs.writeFileSync(
    file,
    [
      "#!/bin/bash",
      `printf '%s\\n' "${name} $*" >> "$FAKE_LOG"`,
      body,
      "",
    ].join("\n"),
  );
  fs.chmodSync(file, 0o755);
}

function run(environment: Record<string, string>): Result {
  fs.writeFileSync(log, "");

  const result: SpawnSyncReturns<string> = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: bin,
      FAKE_LOG: log,
      FAKE_BIN: bin,
      FAKE_NODE_VERSION: "v22.11.0",
      FAKE_PREFIX: bin,
      ...environment,
    },
  });

  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter((line: string): boolean => {
        return line.length > 0;
      }),
  };
}

describe("the CLI's install script", () => {
  beforeAll(() => {
    bin = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-cli-install-"));
    log = path.join(bin, "calls.log");

    writeStandIn("node", 'echo "$FAKE_NODE_VERSION"');
    writeStandIn(
      "curl",
      [
        'if [ -n "${FAKE_CURL_FAIL:-}" ]; then exit 22; fi',
        "printf '%s' \"$FAKE_VERSION_ANSWER\"",
      ].join("\n"),
    );
    writeStandIn(
      "npm",
      [
        'if [ "$1" = "config" ]; then echo "$FAKE_PREFIX"; exit 0; fi',
        'if [ -n "${FAKE_NPM_FAIL:-}" ]; then exit 1; fi',
        // The last argument is the package spec: @oneuptime/cli[@version].
        'spec="${@: -1}"',
        'version="${spec#@oneuptime/cli}"',
        'version="${version#@}"',
        '[ -z "$version" ] && version="14.0.200"',
        'printf \'#!/bin/bash\\necho %s\\n\' "$version" > "$FAKE_BIN/oneuptime"',
        'chmod +x "$FAKE_BIN/oneuptime"',
      ].join("\n"),
    );
  });

  afterAll(() => {
    fs.rmSync(bin, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(path.join(bin, "oneuptime"), { force: true });
  });

  it("is bash a shell reads without error", () => {
    const check: SpawnSyncReturns<string> = spawnSync("bash", ["-n", SCRIPT], {
      encoding: "utf8",
    });

    expect(check.status).toBe(0);
  });

  it("asks the OneUptime it is given for its version, and installs the CLI of that version", () => {
    const result: Result = run({
      ONEUPTIME_URL: "https://oneuptime.example.com/",
      FAKE_VERSION_ANSWER: '{"version":"14.0.101","commit":"abc123"}',
    });

    expect(result.status).toBe(0);
    expect(result.calls).toContain(
      "curl -fsS --max-time 30 https://oneuptime.example.com/api/version",
    );
    expect(result.calls).toContain(
      "npm install --global --no-fund --no-audit @oneuptime/cli@14.0.101",
    );
    expect(result.stdout).toContain(
      "https://oneuptime.example.com is OneUptime 14.0.101: installing the OneUptime CLI of the same version.",
    );
    expect(result.stdout).toContain("Installed the OneUptime CLI 14.0.101.");
    // The next step, with this OneUptime's address, the slash gone.
    expect(result.stdout).toContain(
      'export ONEUPTIME_URL="https://oneuptime.example.com"',
    );
    expect(result.stdout).toContain("oneuptime whoami --check");
  });

  it("installs the newest CLI for a OneUptime that names no release", () => {
    const result: Result = run({
      ONEUPTIME_URL: "http://localhost:3000",
      FAKE_VERSION_ANSWER: '{"version":"1.0.0","commit":"dev"}',
    });

    expect(result.status).toBe(0);
    expect(result.calls).toContain(
      "npm install --global --no-fund --no-audit @oneuptime/cli",
    );
    expect(result.stdout).toContain(
      "http://localhost:3000 did not say which release it is: installing the newest OneUptime CLI.",
    );
  });

  it("installs the newest CLI without an address, and says how to match a OneUptime", () => {
    const result: Result = run({});

    expect(result.status).toBe(0);
    expect(result.calls.some((call: string) => call.startsWith("curl"))).toBe(
      false,
    );
    expect(result.calls).toContain(
      "npm install --global --no-fund --no-audit @oneuptime/cli",
    );
    expect(result.stdout).toContain(
      "Installing the newest OneUptime CLI. To install the one of your OneUptime's version, run this script with ONEUPTIME_URL set to its address.",
    );
  });

  it("installs the version ONEUPTIME_CLI_VERSION names, and refuses one that is no version", () => {
    const chosen: Result = run({
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_CLI_VERSION: "14.0.99",
      FAKE_VERSION_ANSWER: '{"version":"14.0.101"}',
    });

    expect(chosen.status).toBe(0);
    expect(chosen.calls).toContain(
      "npm install --global --no-fund --no-audit @oneuptime/cli@14.0.99",
    );
    expect(chosen.calls.some((call: string) => call.startsWith("curl"))).toBe(
      false,
    );

    const wrong: Result = run({ ONEUPTIME_CLI_VERSION: "latest; rm -rf /" });

    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain(
      'ONEUPTIME_CLI_VERSION takes a version such as 14.0.101, and "latest; rm -rf /" is not one.',
    );
    expect(
      wrong.calls.some((call: string) => call.startsWith("npm install")),
    ).toBe(false);
  });

  it("stops before npm on a Node.js older than 22, saying where to get one", () => {
    const result: Result = run({ FAKE_NODE_VERSION: "v20.18.0" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "The OneUptime CLI needs Node.js 22 or later, and this is Node.js v20.18.0. Install a newer one from https://nodejs.org, then run this script again.",
    );
    expect(result.calls.some((call: string) => call.startsWith("npm"))).toBe(
      false,
    );
  });

  it("stops when the address does not answer, naming what to check", () => {
    const result: Result = run({
      ONEUPTIME_URL: "https://wrong.example.com",
      FAKE_CURL_FAIL: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Could not reach https://wrong.example.com/api/version. Check ONEUPTIME_URL: it is the address you open OneUptime at, such as https://oneuptime.com.",
    );
  });

  it("says how to give npm a folder it may write when its global one is not", () => {
    const result: Result = run({
      FAKE_NPM_FAIL: "1",
      FAKE_PREFIX: "/usr/local-not-writable-by-anyone",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "npm could not write to its global folder, /usr/local-not-writable-by-anyone. Run this script with sudo, or give npm a folder of your own",
    );
  });

  it("downloads nothing but the server's version answer", () => {
    const script: string = fs.readFileSync(SCRIPT, "utf8");
    // Its code, not the comments that show how to run it.
    const fetches: Array<string> = script
      .split("\n")
      .filter((line: string): boolean => {
        return !line.trim().startsWith("#") && line.includes("curl ");
      })
      .filter((line: string): boolean => {
        return !line.includes("command -v curl");
      });

    expect(script.toLowerCase()).not.toContain("github");
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toContain('"${ONEUPTIME_URL}/api/version"');
  });
});
