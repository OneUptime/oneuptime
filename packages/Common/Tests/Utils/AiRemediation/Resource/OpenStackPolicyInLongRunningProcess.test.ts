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
 * --no-regexp-optimization, the state such a process reaches
 * (Docs/notifications/README.md, "Megabyte-long values"). esbuild bundles the modules
 * there, as ScreenshotEmailInLongRunningProcess.test.ts does: it refuses to load under
 * the jsdom environment Common's jest uses. Only booleans and times come back, so a
 * failure never prints megabytes.
 *
 * Two things are held. Nothing throws, on sixteen megabytes in each place the policy and
 * OpenStack's own redaction read, and where a change's words and what it touches are read. And the time grows with the length: each shape is read
 * at two lengths, and four times the text may cost at most ten times the time, with room
 * left for a loaded machine. The generic redactor under OpenStack's rules has its own
 * long-input tests (Docs/notifications/README.md, "Megabyte-long values"), so it runs here only on the shapes OpenStack adds, at a
 * megabyte: enough to show that the two together still finish.
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
        'export { getResourceOutputRedactionHooks, redactResourceCommandOutput } from "./Utils/AiRemediation/Resource/ResourceOutputRedactor";',
        'export { readOpenStackChangeReach, renderOpenStackChangeReach, buildOpenStackChangeReach } from "./Utils/AiRemediation/Resource/OpenStackChangeReach";',
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
    "zero width": "\u200b",
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

  const openStackHook = lib.getResourceOutputRedactionHooks("openstack")[0];
  const hook = (text) => openStackHook({ resourceType: "OpenStackCloud", program: "openstack", text });

  // Where a long text can arrive: a word of a command, or an answer from a cloud.
  const POLICY = (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", text]);
  const WORKERS = {
    "the policy, a command word": POLICY,
    "the policy, an ID": (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", "server", "show", text]),
    "the policy, an option": (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", "server", "list", "--" + text]),
    "the policy, a value": (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", "server", "list", "--host", text]),
    "the translation": (text) => lib.parseOpenStackCommand(["openstack", "server", "show", text]),
    "a change, its instance": (text) => lib.parseOpenStackCommand(["openstack", "server", "evacuate", text, text]),
    "a change, its reason": (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", "compute", "service", "set", "--disable", "--disable-reason", text, "compute-01", "nova-compute"]),
    "a dry run": (text) => lib.OpenStackCommandPolicy.evaluateArgv(["openstack", "dry-run", "server", "start", text]),
    "what a change touches, read back": (text) => lib.readOpenStackChangeReach("oneuptime-openstack-reach route server start\noneuptime-openstack-reach kind changes\noneuptime-openstack-reach instance x - - - - " + text),
    "what a change touches, rendered": (text) => lib.renderOpenStackChangeReach(lib.buildOpenStackChangeReach({ route: "server start", kind: "changes", instances: [{ id: "x", name: text, projectId: null, projectName: text, host: null, status: null }], projectNames: new Map(), hosts: [], leftBehind: [], isComplete: true, problems: [text], wouldBeRefused: text })),
    "the dispatcher, an argv": (text) => lib.ResourceCommandPolicy.evaluateArgv({ resourceType: "OpenStackCloud", argv: ["openstack", text] }),
    "the dispatcher, a line": (text) => lib.ResourceCommandPolicy.evaluateCommand({ resourceType: "OpenStackCloud", command: "openstack " + text }),
    "OpenStack's redaction": hook,
  };

  // The same redaction, of what a cloud wraps a long text in: made before the clock starts.
  const WRAPPED = {
    "OpenStack's redaction, in a value": (text) => JSON.stringify({ "OS-EXT-SRV-ATTR:user_data": text, name: text }),
    "OpenStack's redaction, a key: value line": (text) => "OS-EXT-SRV-ATTR:user_data: " + text,
  };

  // OpenStack's rules on the generic ones, end to end: the shapes OpenStack adds.
  const REDACTOR = (text) => lib.redactResourceCommandOutput({ resourceType: "OpenStackCloud", program: "openstack", text });
  const REDACTOR_SHAPES = ["user data pairs", "unclosed user data", "fernet starts", "table rows", "direct urls"];

  const SHORT = 1024 * 1024;
  const LONG = 4 * 1024 * 1024;
  const HUGE = 16 * 1024 * 1024;
  // The generic redactor has its own tests of length, and takes longer than these have.
  const REDACTOR_SHORT = 256 * 1024;
  const REDACTOR_LONG = 1024 * 1024;

  const timed = (work, text) => {
    let fastest = Infinity;

    // The fastest of a few: a loaded machine only ever makes it slower.
    for (let attempt = 0; attempt < 3; attempt++) {
      // What the last shape left is not this one's to pay for.
      global.gc();
      const startedAt = process.hrtime.bigint();
      work(text);
      const taken = Number(process.hrtime.bigint() - startedAt) / 1e6;
      fastest = Math.min(fastest, taken);
      if (fastest < 50) {
        break;
      }
    }

    return fastest;
  };

  const failures = [];
  const results = [];
  let ran = 0;

  const place = (shape, worker, work, wrap, shortLength, longLength) => {
    ran++;
    try {
      const unit = SHAPES[shape];
      const short = timed(work, wrap(repeatTo(unit, shortLength)));
      const long = timed(work, wrap(repeatTo(unit, longLength)));
      results.push({ shape, worker, short, long });
    } catch (error) {
      failures.push({
        shape,
        worker,
        error: String((error && error.message) || error).split("\n")[0].slice(0, 200),
      });
    }
  };
  const asIs = (text) => text;

  for (const shape of Object.keys(SHAPES)) {
    for (const [worker, work] of Object.entries(WORKERS)) {
      place(shape, worker, work, asIs, SHORT, LONG);
    }
    for (const [worker, wrap] of Object.entries(WRAPPED)) {
      place(shape, worker, hook, wrap, SHORT, LONG);
    }
  }

  for (const shape of REDACTOR_SHAPES) {
    place(shape, "the whole redactor", REDACTOR, asIs, REDACTOR_SHORT, REDACTOR_LONG);
  }

  // Sixteen megabytes, as a stuck process would see them: nothing throws.
  for (const shape of ["letters", "user data pairs", "unclosed user data", "fernet starts", "quotes", "newlines"]) {
    const huge = repeatTo(SHAPES[shape], HUGE);

    for (const [worker, work] of [
      ...Object.entries(WORKERS),
      ...Object.entries(WRAPPED).map(([worker, wrap]) => [worker, (text) => hook(wrap(text))]),
    ]) {
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
    text: JSON.stringify({ user_data: "hunter2".repeat(128 * 1024) }),
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
    [
      "--no-regexp-optimization",
      "--max-old-space-size=8192",
      "--expose-gc",
      "-e",
      SCRIPT,
    ],
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
    expect(report.ran).toBeGreaterThan(250);
  });

  test("nothing throws", () => {
    expect(report.failures).toEqual([]);
  });

  test("the time grows with the length", () => {
    const tooSlow: Array<unknown> = report.slowest.filter(
      (result: { short: number; long: number }): boolean => {
        /*
         * Under two seconds is not a trend. Refusing a word of quotes writes four times its
         * length, so what the collector charges that varies widely, while a read that really
         * grows with the square of four megabytes takes minutes or never ends.
         */
        return (
          result.long > 2000 && result.long > 10 * Math.max(result.short, 1)
        );
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
