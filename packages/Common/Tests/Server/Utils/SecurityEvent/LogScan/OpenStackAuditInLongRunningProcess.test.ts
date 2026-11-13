import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * THE AUDIT PARSER, ON WHATEVER ANYONE CAN WRITE, IN A PROCESS THAT HAS BEEN RUNNING A WHILE.
 *
 * An API call's path, a security group's fields and an image's name are text anyone able to reach
 * an API can write, and the log scan reads them for every project. V8 compiles regular expressions
 * unoptimized once a process has been up a while, and they can then run out of stack
 * (Docs/notifications/README.md, "Megabyte-long values"), so this runs in a node process started
 * with --no-regexp-optimization, as OpenStackLogsInLongRunningProcess.test.ts does for the rest of
 * what reads a cloud's lines. That one holds the parser to lines far over the longest it reads.
 * This holds it to lines just under: MAX_JSON_LINE_LENGTH is where the parser stops reading, so
 * that is where its work is greatest.
 *
 * Only booleans and times come back, so a failure never prints what it read.
 */

const COMMON_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

interface Result {
  shape: string;
  place: string;
  short: number;
  long: number;
  events: number;
  error?: string | undefined;
}

interface Report {
  ran: number;
  failures: Array<Result>;
  slowest: Array<Result>;
  pathLong: number;
  pathShort: number;
  // Whether a line just under the longest the parser reads was read at all.
  readAtTheLimit: boolean;
}

function run(): Report {
  const output: string = childProcess.execFileSync(
    process.execPath,
    [
      "--no-regexp-optimization",
      "--max-old-space-size=4096",
      "-e",
      String.raw`
        const path = require("path");
        const esbuild = require("esbuild");

        const built = esbuild.buildSync({
          stdin: {
            contents: [
              'export { default as OpenStackAuditLogParser, readOpenStackPartOfPath } from "./Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";',
              'export { MAX_JSON_LINE_LENGTH } from "./Utils/SecurityEvent/LogParsers/SecurityLogLine";',
            ].join("\n"),
            resolveDir: process.cwd(),
            loader: "ts",
            sourcefile: "openstack-audit.ts",
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

        const CADF = "http://schemas.dmtf.org/cloud/audit/1.0/event";
        const UUID = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";
        const SHAPES = {
          "letters": "a",
          "spaces": " ",
          "slashes": "/",
          "path words": "/servers/",
          "almost UUIDs": "/servers/1cd8b1e6-41ab-4e40-a4c6-",
          "whole UUIDs": "/servers/" + UUID,
          "question marks": "?",
          "digits": "1234567890",
          "dots": ".",
          "colons": ":",
          "percents": "%",
          "project words": "project ",
          "unknowns": "unknown",
          "braces": "{",
          "quotes": '"',
          "backslashes": "\\",
        };
        const repeatTo = (unit, length) => {
          return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
        };

        // One long field in each place: what the JSON around it adds stays under the limit.
        const PLACES = {
          "an API call's path": (long) => ({
            event_type: "audit.http.response",
            message_id: "m",
            payload: { typeURI: CADF, action: "update", outcome: "success", requestPath: long, initiator: { id: "u", name: "n", host: { address: "203.0.113.7" } }, target: { typeURI: "unknown", id: "unknown", name: "unknown" } },
          }),
          "an API call's initiator": (long) => ({
            event_type: "audit.http.response",
            message_id: "m",
            payload: { typeURI: CADF, action: "update", outcome: "success", requestPath: "/servers/" + UUID, initiator: { id: long, name: long.slice(0, 1000), project_id: long.slice(0, 1000), host: { address: long.slice(0, 1000) } } },
          }),
          "a login's user": (long) => ({
            event_type: "identity.authenticate",
            message_id: "m",
            payload: { typeURI: CADF, outcome: "failure", initiator: { user_id: long, username: long.slice(0, 1000), host: { address: long.slice(0, 1000) } } },
          }),
          "a role grant's project": (long) => ({
            event_type: "identity.role_assignment.created",
            message_id: "m",
            payload: { typeURI: CADF, outcome: "success", role: long.slice(0, 1000), project: long, user: long.slice(0, 1000) },
          }),
          "a security group rule's fields": (long) => ({
            event_type: "security_group_rule.create.end",
            message_id: "m",
            payload: { security_group_rule: { direction: "ingress", security_group_id: long, project_id: long.slice(0, 1000), protocol: long.slice(0, 1000), port_range_min: long.slice(0, 1000), port_range_max: long.slice(0, 1000) } },
          }),
          "an image's name": (long) => ({
            event_type: "image.update",
            message_id: "m",
            payload: { id: long.slice(0, 1000), name: long, owner: long.slice(0, 1000), visibility: "public" },
          }),
        };

        const parse = (message) => {
          return lib.OpenStackAuditLogParser.parse({
            body: message,
            attributes: { "resource.openstack.cloud.name": "production", "openstack.user_name": "alice" },
            time: new Date(0),
          });
        };

        const timed = (work, attempts = 3, enough = 5) => {
          let fastest = Infinity;
          for (let attempt = 0; attempt < attempts; attempt++) {
            const startedAt = process.hrtime.bigint();
            work();
            fastest = Math.min(fastest, Number(process.hrtime.bigint() - startedAt) / 1e6);
            if (fastest < enough) {
              break;
            }
          }
          return fastest;
        };

        // JSON.stringify can double a character, so a text this long always stays readable.
        const LONG = Math.floor(lib.MAX_JSON_LINE_LENGTH / 2) - 4096;
        const SHORT = Math.floor(LONG / 4);
        const results = [];
        const failures = [];
        let ran = 0;
        let readAtTheLimit = false;

        for (const [shape, unit] of Object.entries(SHAPES)) {
          for (const [place, build] of Object.entries(PLACES)) {
            ran++;
            try {
              const short = JSON.stringify(build(repeatTo(unit, SHORT)));
              const long = JSON.stringify(build(repeatTo(unit, LONG)));
              let events = 0;
              const shortTime = timed(() => parse(short));
              const longTime = timed(() => {
                events = parse(long).length;
              });
              readAtTheLimit = readAtTheLimit || events > 0;
              results.push({ shape, place, short: shortTime, long: longTime, events });
            } catch (error) {
              failures.push({ shape, place, short: 0, long: 0, events: 0, error: String((error && error.message) || error).slice(0, 200) });
            }
          }
        }

        // A list of rules, at its longest.
        ran++;
        try {
          const rule = { direction: "ingress", remote_ip_prefix: "0.0.0.0/0", security_group_id: "g", port_range_min: 22, port_range_max: 22 };
          parse(JSON.stringify({ event_type: "security_group_rule.create.end", payload: { security_group_rules: new Array(2500).fill(rule) } }));
        } catch (error) {
          failures.push({ shape: "rules", place: "a list of rules", short: 0, long: 0, events: 0, error: String((error && error.message) || error).slice(0, 200) });
        }

        // The path alone, however long: it is only ever read after being cut, but it should not need to be.
        const pathShort = timed(() => lib.readOpenStackPartOfPath(repeatTo("/servers", 1024 * 1024)));
        // Half a million strings, so on a busy machine the garbage collector is most of one
        // reading: the fastest of ten is the code's own time, and a machine only makes it slower.
        const pathLong = timed(() => lib.readOpenStackPartOfPath(repeatTo("/servers", 4 * 1024 * 1024)), 10, 200);

        results.sort((a, b) => b.long / Math.max(b.short, 1) - a.long / Math.max(a.short, 1));

        process.stdout.write(JSON.stringify({ ran, failures, slowest: results.slice(0, 10), pathShort, pathLong, readAtTheLimit }));
        process.exit(0);
      `,
    ],
    {
      cwd: COMMON_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return JSON.parse(output) as Report;
}

describe("the audit parser, in a process that compiles regular expressions unoptimized", () => {
  const TIME_LIMIT_MS: number = 11 * 60 * 1000;
  let report: Report | null = null;

  const reportOf: () => Report = (): Report => {
    report = report || run();

    return report;
  };

  test(
    "nothing throws, whatever a field holds, up to the longest line it reads",
    () => {
      const read: Report = reportOf();

      expect(read.ran).toBeGreaterThan(90);
      expect(read.failures).toEqual([]);
      // Or none of this says anything: every line would be refused for being too long.
      expect(read.readAtTheLimit).toBe(true);
    },
    TIME_LIMIT_MS,
  );

  test(
    "four times the text costs at most about four times the time",
    () => {
      const tooSlow: Array<Result> = reportOf().slowest.filter(
        (result: Result): boolean => {
          return result.long > 200 && result.long > result.short * 10;
        },
      );

      expect(tooSlow).toEqual([]);
    },
    TIME_LIMIT_MS,
  );

  test(
    "a path of nothing but words a part could follow is read once",
    () => {
      const read: Report = reportOf();

      expect(read.pathLong <= 200 || read.pathLong <= read.pathShort * 10).toBe(
        true,
      );
    },
    TIME_LIMIT_MS,
  );
});
