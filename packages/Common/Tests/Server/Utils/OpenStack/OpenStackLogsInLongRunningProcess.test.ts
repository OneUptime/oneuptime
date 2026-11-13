import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * AN OPENSTACK LOG LINE, HOWEVER LONG AND WHATEVER IT HOLDS, IN A PROCESS THAT HAS BEEN RUNNING
 * A WHILE.
 *
 * Logs are text anyone able to reach an API can write into: a server's name, a project's, a
 * request's path. The ingest reads every line of a cloud, and a stuck parser stops every project
 * on that worker. V8 backtracks on a stack that can grow with every character a quantifier takes,
 * and a process that has been up a while compiles regular expressions unoptimized, so this runs in
 * a node process started with --no-regexp-optimization, the state such a process reaches
 * (Docs/notifications/README.md, "Megabyte-long values"). esbuild bundles the modules there, as
 * ScreenshotEmailInLongRunningProcess.test.ts does: it refuses to load under the jsdom environment
 * Common's jest uses. Only booleans and times come back, so a failure never prints sixteen million
 * characters.
 *
 * Two things are held. Nothing throws on sixteen megabytes of each shape. And the time grows with
 * the length: each shape is read at two lengths, and four times the text may cost at most ten times
 * the time, with room left for a loaded machine.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const INPUTS_SCRIPT: string = String.raw`
  const UUID = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";
  const repeatTo = (unit, length) => {
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  };

  const HEAD = "2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [req-a req-b c d - - e f] ";

  // Every shape something in these parsers looks for, or could be made to look for again.
  const SHAPES = {
    "letters": "a",
    "spaces": " ",
    "newlines": "\n",
    "digits": "1234567890",
    "dashes": "-",
    "brackets": "[",
    "closing brackets": "]",
    "instance prefixes": "[instance: ",
    "instance words": "instance ",
    "almost UUIDs": "instance 1cd8b1e6-41ab-4e40-a4c6-",
    "request ids": "req-",
    "dates": "2026-10-30 10:00:00.123 ",
    "levels": "ERROR ",
    "loggers": "nova.compute.manager.",
    "braces": "{",
    "closing braces": "}",
    "quotes": '"',
    "single quotes": "'",
    "backslashes": "\\",
    "escaped quotes": '\\"',
    "password words": "password",
    "password keys": "password=",
    "quoted password keys": '"password": "',
    "unclosed quoted keys": "password='",
    "tokens": "token",
    "token keys": "token: ",
    "authorization": "Authorization: Bearer ",
    "cookies": "cookie: ",
    "secrets": "secret=",
    "url starts": "://",
    "url passwords": "://user:",
    "url at signs": "rabbit://u:p@",
    "at signs": "@",
    "colons": ":",
    "commas": ",",
    "private key begins": "-----BEGIN PRIVATE KEY-----",
    "private key markers": "PRIVATE KEY-----",
    "fernet starts": "gAAAA",
    "jwt starts": "eyJ",
    "pki starts": "MII",
    "colour starts": "\u001b[",
    "colours": "\u001b[01;31m",
    "unfinished colours": "\u001b[0",
    "signals": "AMQP server on ",
    "closing characters": "),]};&",
    "names after commas": ",abc=",
    "values with no end": "password=a,",
    "escaped keys": 'password\\\\\\": \\\\\\"',
    "other names for an instance": "device_id ",
    "consumers": "consumer ",
    "JSON opening": '{"a": ',
    "JSON closing": '"}',
    "uWSGI's request lines": "[pid: 1] GET ",
    "health check verbs": '"GET ',
    "notification loggers": "oslo.messaging.notification.",
    "event types": '"event_type"',
    "cadf": '"typeURI": "http://schemas.dmtf.org/cloud/audit/1.0/event",',
  };

  // The same long text in the places a line can hold it.
  const placed = (unit, length) => {
    const long = repeatTo(unit, length);

    return {
      "on its own": long,
      "as a message": HEAD + long,
      "in the context": "2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [" + long,
      "as a logger": "2026-10-30 10:00:00.123 1234 ERROR " + long,
      "as a notification's field": JSON.stringify({
        event_type: "instance.create.error",
        priority: "ERROR",
        payload: { "nova_object.data": { uuid: UUID, display_name: long, fault: { "nova_object.data": { exception_message: long } } } },
      }),
      "as a notification on a line": HEAD.replace("nova.compute.manager", "oslo.messaging.notification.x") + '{"event_type": "x", "payload": {"a": "' + long.split('"').join("") + '"}}',
      "as an audit event's field": JSON.stringify({
        event_type: "identity.authenticate",
        payload: { typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event", outcome: "failure", initiator: { id: long, username: long }, target: { id: long } },
      }),
    };
  };
`;

interface ShapeResult {
  shape: string;
  place: string;
  worker: string;
  short: number;
  long: number;
  error?: string | undefined;
}

interface ProcessReport {
  ran: number;
  failures: Array<ShapeResult>;
  // The slowest growth seen, by what it read.
  slowest: Array<ShapeResult>;
  noted: Record<string, boolean>;
}

const WORKERS_SCRIPT: string = String.raw`
  const WORKERS = {
    "the stamp": (text) => lib.stampOpenStackLogRecord({ attributes: {}, body: text, severityNumber: 0 }),
    "the journal's stamp": (text) => lib.stampOpenStackLogRecord({
      attributes: { "journald.exception_info": text, "journald.unit": "devstack@n-cpu.service" },
      body: text,
      severityNumber: 0,
    }),
    "the line": (text) => lib.readOpenStackLogLine(text),
    "the scrub": (text) => lib.scrubOpenStackSecrets(text),
    "the colours": (text) => lib.stripAnsiCodes(text),
    "the signal": (text) => lib.readOpenStackLogSignal({ level: "ERROR", text }),
    "the audit parser": (text) => lib.OpenStackAuditLogParser.parse({
      body: text,
      attributes: { "resource.openstack.cloud.name": "production" },
      time: new Date(0),
    }),
    "the prefilter": (text) => lib.matchesSecurityLogPrefilter(text),
    "the unit's name": (text) => lib.getOpenStackServiceOfUnit(text),
    "the file's name": (text) => lib.getOpenStackServiceOfFile(text),
  };
`;

function run(): ProcessReport {
  let output: string;

  try {
    output = childProcess.execFileSync(
      process.execPath,
      [
        "--no-regexp-optimization",
        "--max-old-space-size=8192",
        "-e",
        String.raw`
          const path = require("path");
          const esbuild = require("esbuild");

          const built = esbuild.buildSync({
            stdin: {
              contents: [
                'export { stampOpenStackLogRecord, readOpenStackLogLine, readOpenStackLogSignal, getOpenStackServiceOfUnit, getOpenStackServiceOfFile } from "./Utils/OpenStack/OpenStackLogs";',
                'export { scrubOpenStackSecrets, stripAnsiCodes, removeOpenStackSecretFields } from "./Utils/OpenStack/OpenStackLogScrub";',
                'export { readOpenStackNotification } from "./Utils/OpenStack/OpenStackNotifications";',
                'export { default as OpenStackAuditLogParser } from "./Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";',
                'export { matchesSecurityLogPrefilter } from "./Utils/SecurityEvent/LogParsers/SecurityLogParser";',
              ].join("\n"),
              resolveDir: process.cwd(),
              loader: "ts",
              sourcefile: "openstack-logs.ts",
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
        ` +
          INPUTS_SCRIPT +
          WORKERS_SCRIPT +
          String.raw`
          const SHORT = 64 * 1024;
          const LONG = 256 * 1024;
          const HUGE = 16 * 1024 * 1024;

          const timed = (work, text) => {
            let fastest = Infinity;

            // The fastest of a few: a loaded machine only ever makes it slower.
            for (let attempt = 0; attempt < 3; attempt++) {
              const startedAt = process.hrtime.bigint();
              work(text);
              const taken = Number(process.hrtime.bigint() - startedAt) / 1e6;
              fastest = Math.min(fastest, taken);
              if (fastest < 20) {
                break;
              }
            }

            return fastest;
          };

          const failures = [];
          const results = [];
          let ran = 0;

          for (const [shape, unit] of Object.entries(SHAPES)) {
            const shorts = placed(unit, SHORT);
            const longs = placed(unit, LONG);

            for (const place of Object.keys(shorts)) {
              for (const [worker, work] of Object.entries(WORKERS)) {
                ran++;
                try {
                  const short = timed(work, shorts[place]);
                  const long = timed(work, longs[place]);
                  results.push({ shape, place, worker, short, long });
                } catch (error) {
                  failures.push({
                    shape,
                    place,
                    worker,
                    short: 0,
                    long: 0,
                    error: String((error && error.message) || error).split("\n")[0].slice(0, 200),
                  });
                }
              }
            }
          }

          // Sixteen megabytes, as a stuck process would see them: nothing throws.
          for (const shape of ["letters", "password keys", "url passwords", "brackets", "fernet starts", "newlines", "quotes"]) {
            const huge = placed(SHAPES[shape], HUGE);

            for (const place of Object.keys(huge)) {
              for (const [worker, work] of Object.entries(WORKERS)) {
                ran++;
                try {
                  work(huge[place]);
                } catch (error) {
                  failures.push({
                    shape,
                    place,
                    worker,
                    short: 0,
                    long: 0,
                    error: String((error && error.message) || error).split("\n")[0].slice(0, 200),
                  });
                }
              }
            }
          }

          // A slow reading is taken again before it counts, after a pause and more than once:
          // real growth is there every time, and a moment when the machine was busy is not.
          const pause = new Int32Array(new SharedArrayBuffer(4));

          for (const result of results) {
            for (let again = 0; again < 4 && result.long > 200 && result.long > result.short * 10; again++) {
              Atomics.wait(pause, 0, 0, 1000);
              const work = WORKERS[result.worker];
              result.long = Math.min(result.long, timed(work, placed(SHAPES[result.shape], LONG)[result.place]));
            }
          }

          results.sort((a, b) => b.long / Math.max(b.short, 1) - a.long / Math.max(a.short, 1));

          const hugeStamp = lib.stampOpenStackLogRecord({
            attributes: {},
            body: "password=" + "x".repeat(HUGE),
            severityNumber: 0,
          });

          process.stdout.write(
            JSON.stringify({
              ran,
              failures,
              slowest: results.slice(0, 25),
              noted: {
                "a huge record is cut": hugeStamp.body.length < HUGE,
                "and says so": hugeStamp.body.endsWith("(truncated by OneUptime)"),
                "and the secret does not stay": !hugeStamp.body.includes("xxxx"),
              },
            }),
          );
          process.exit(0);
        `,
      ],
      {
        cwd: COMMON_ROOT,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 20 * 60 * 1000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const failed: {
      status?: number | null;
      signal?: string | null;
      code?: string;
      stderr?: string | Buffer;
    } = error as {
      status?: number | null;
      signal?: string | null;
      code?: string;
      stderr?: string | Buffer;
    };

    throw new Error(
      `The process did not finish (status ${String(failed.status)}, signal ${String(failed.signal)}${failed.code ? `, ${failed.code}` : ""}): ${String(failed.stderr ?? "").slice(0, 1000)}`,
    );
  }

  return JSON.parse(output) as ProcessReport;
}

describe("in a process that compiles regular expressions unoptimized", () => {
  const TIME_LIMIT_MS: number = 22 * 60 * 1000;
  let report: ProcessReport | null = null;
  let failure: Error | null = null;

  // One run for all three, whether it finished or not: it takes many minutes.
  const reportOf: () => ProcessReport = (): ProcessReport => {
    if (failure) {
      throw failure;
    }

    if (!report) {
      try {
        report = run();
      } catch (error) {
        failure = error as Error;
        throw failure;
      }
    }

    return report;
  };

  test(
    "nothing throws on any shape, at any length",
    () => {
      const read: ProcessReport = reportOf();

      expect(read.ran).toBeGreaterThan(1000);
      expect(read.failures).toEqual([]);
    },
    TIME_LIMIT_MS,
  );

  test(
    "four times the text costs at most about four times the time",
    () => {
      const read: ProcessReport = reportOf();

      /*
       * Anything under 200 ms at the longer length is too quick to say anything about its growth,
       * on a machine doing other work.
       */
      const tooSlow: Array<ShapeResult> = read.slowest.filter(
        (result: ShapeResult): boolean => {
          return result.long > 200 && result.long > result.short * 10;
        },
      );

      expect(tooSlow).toEqual([]);
    },
    TIME_LIMIT_MS,
  );

  test(
    "a huge record is cut, says so, and its secret does not stay",
    () => {
      expect(reportOf().noted).toEqual({
        "a huge record is cut": true,
        "and says so": true,
        "and the secret does not stay": true,
      });
    },
    TIME_LIMIT_MS,
  );
});
