import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * THE OPENSTACK POLICY AND REDACTOR, ON HOSTILE INPUT, IN A PROCESS THAT HAS BEEN
 * RUNNING A WHILE.
 *
 * What a model writes reaches the policy, and what a cloud answers reaches the
 * redactor: an instance's name and a fault's traceback are anyone's text, and a job's
 * payload is only as long as the server let it be. V8 backtracks on a stack that can
 * grow with every character a quantifier takes, and a process that has been up a while
 * compiles regular expressions unoptimized, so this runs in a node process started with
 * --no-regexp-optimization, the state such a process reaches (AGENTS.md). esbuild bundles
 * the modules there, as ScreenshotEmailInLongRunningProcess.test.ts does: it refuses to
 * load under the jsdom environment Common's jest uses. Only booleans and times come back,
 * so a failure never prints megabytes.
 *
 * Two things are held. Nothing throws, on sixteen megabytes of each shape in each place.
 * And the time grows with the length: each shape is read at two lengths, and four times
 * the text may cost at most ten times the time, with room left for a loaded machine.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface ProcessReport {
  ran: number;
  failures: Array<{ shape: string; worker: string; error: string }>;
  slowest: Array<{
    shape: string;
    worker: string;
    short: number;
    long: number;
  }>;
  noted: Record<string, boolean>;
}

const SCRIPT: string = String.raw`
  const esbuild = require("esbuild");
  const path = require("path");

  const built = esbuild.buildSync({
    stdin: {
      contents: [
        'export { default as OpenStackCommandPolicy, parseOpenStackCommand } from "./Utils/AiRemediation/Resource/OpenStackCommandPolicy";',
        'export { default as ResourceCommandPolicy } from "./Utils/AiRemediation/Resource/ResourceCommandPolicy";',
        'export { redactResourceCommandOutput } from "./Utils/AiRemediation/Resource/ResourceOutputRedactor";',
      ].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts",
      sourcefile: "openstack-policy.ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    tsconfig: path.join(process.cwd(), "tsconfig.json"),
    write: false,
    logLevel: "silent",
  });

  const bundle = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(
    bundle,
    bundle.exports,
    require,
  );
  const lib = bundle.exports;

  const repeatTo = (unit, length) => {
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  };

  const SHAPES = {
    "letters": "a",
    "spaces": " ",
    "digits": "1234567890",
    "dashes": "-",
    "flags": "--limit ",
    "flag with equals": "--limit=10 ",
    "double dashes": "-- ",
    "quotes": '"',
    "single quotes": "'",
    "backslashes": "\\",
    "escaped quotes": '\\"',
    "equals": "=",
    "slashes": "/",
    "dots": "../",
    "percent": "%2f",
    "cyrillic": "ѕ",
    "full-width": "１",
    "zero width": "​",
    "uuid heads": "358ee736-ba74-40ba-",
    "hex": "abcdef0123",
    "newlines": "\n",
    "colons": ":",
    "user data keys": 'user_data',
    "user data pairs": '"user_data": "',
    "unclosed user data": 'OS-EXT-SRV-ATTR:user_data: ',
    "table rows": "| user_data | ",
    "direct urls": '"direct_url": "',
    "fernet starts": "gAAAA",
    "password pairs": '"password": "',
    "password keys": "password=",
    "url passwords": "://user:",
    "braces": "{",
  };

  // Where a long text can arrive: a word of a command, or an answer from a cloud.
  const POLICY = (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", text]);
  const WORKERS = {
    "the policy, a command word": POLICY,
    "the policy, an ID": (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", "server", "show", text]),
    "the policy, an option": (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", "server", "list", "--" + text]),
    "the policy, a value": (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", "server", "list", "--host", text]),
    "the translation": (text) => lib.parseOpenStackCommand(["openstack", "server", "show", text]),
    "the dispatcher, an argv": (text) => lib.ResourceCommandPolicy.evaluateArgv({ resourceType: "OpenStackCloud", argv: ["openstack", text] }),
    "the dispatcher, a line": (text) => lib.ResourceCommandPolicy.evaluateCommand({ resourceType: "OpenStackCloud", command: "openstack " + text }),
    "the redactor": (text) => lib.redactResourceCommandOutput({ resourceType: "OpenStackCloud", program: "openstack", text }),
    "the redactor, in a value": (text) => lib.redactResourceCommandOutput({ resourceType: "OpenStackCloud", program: "openstack", text: JSON.stringify({ "OS-EXT-SRV-ATTR:user_data": text, name: text }) }),
    "the redactor, a key: value line": (text) => lib.redactResourceCommandOutput({ resourceType: "OpenStackCloud", program: "openstack", text: "OS-EXT-SRV-ATTR:user_data: " + text }),
  };

  const SHORT = 256 * 1024;
  const LONG = 1024 * 1024;
  const HUGE = 16 * 1024 * 1024;

  const timed = (work, text) => {
    let fastest = Infinity;

    // The fastest of a few: a loaded machine only ever makes it slower.
    for (let attempt = 0; attempt < 3; attempt++) {
      const startedAt = process.hrtime.bigint();
      work(text);
      const taken = Number(process.hrtime.bigint() - startedAt) / 1e6;
      fastest = Math.min(fastest, taken);
      if (fastest < 5) {
        break;
      }
    }

    return fastest;
  };

  const failures = [];
  const results = [];
  let ran = 0;

  for (const [shape, unit] of Object.entries(SHAPES)) {
    for (const [worker, work] of Object.entries(WORKERS)) {
      ran++;
      try {
        const short = timed(work, repeatTo(unit, SHORT));
        const long = timed(work, repeatTo(unit, LONG));
        results.push({ shape, worker, short, long });
      } catch (error) {
        failures.push({
          shape,
          worker,
          error: String((error && error.message) || error).split("\n")[0].slice(0, 200),
        });
      }
    }
  }

  // Sixteen megabytes, as a stuck process would see them: nothing throws.
  for (const shape of ["letters", "user data pairs", "unclosed user data", "fernet starts", "quotes", "newlines"]) {
    const huge = repeatTo(SHAPES[shape], HUGE);

    for (const [worker, work] of Object.entries(WORKERS)) {
      ran++;
      try {
        work(huge);
      } catch (error) {
        failures.push({
          shape,
          worker,
          error: String((error && error.message) || error).split("\n")[0].slice(0, 200),
        });
      }
    }
  }

  results.sort((a, b) => b.long / Math.max(b.short, 1) - a.long / Math.max(a.short, 1));

  const refused = POLICY("a".repeat(HUGE));
  const masked = lib.redactResourceCommandOutput({
    resourceType: "OpenStackCloud",
    program: "openstack",
    text: JSON.stringify({ user_data: "hunter2".repeat(1024 * 1024) }),
  });

  process.stdout.write(
    JSON.stringify({
      ran,
      failures,
      slowest: results.slice(0, 25),
      noted: {
        "a huge word is refused": refused.tier === "Denied",
        "and its reason stays short": refused.reason.length < 500,
        "a huge value of user data is masked": !masked.includes("hunter2"),
      },
    }),
  );
  process.exit(0);
`;

function runInLongRunningProcess(): ProcessReport {
  const output: string = childProcess.execFileSync(
    process.execPath,
    ["--no-regexp-optimization", "--stack-size=984", "-e", SCRIPT],
    {
      cwd: COMMON_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return JSON.parse(output) as ProcessReport;
}

describe("the OpenStack policy and redactor, unoptimized, on long hostile input", () => {
  const report: ProcessReport = runInLongRunningProcess();

  test("every shape, in every place, ran", () => {
    expect(report.ran).toBeGreaterThan(300);
  });

  test("nothing throws", () => {
    expect(report.failures).toEqual([]);
  });

  test("the time grows with the length", () => {
    const tooSlow: Array<unknown> = report.slowest.filter(
      (result: { short: number; long: number }): boolean => {
        // Under 50 ms is not a trend: a loaded machine's noise.
        return result.long > 50 && result.long > 10 * Math.max(result.short, 1);
      },
    );

    expect(tooSlow).toEqual([]);
  });

  test("what must hold on a huge input holds", () => {
    expect(report.noted).toEqual({
      "a huge word is refused": true,
      "and its reason stays short": true,
      "a huge value of user data is masked": true,
    });
  });
});
