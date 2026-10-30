import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * AN EXCEPTION OF SIXTEEN MEGABYTES, EXPLAINED BY A PROCESS THAT HAS BEEN
 * RUNNING A WHILE.
 *
 * What OneUptime AI is told about an exception is built from what
 * applications sent: a message, a stack trace or a log body can be megabytes
 * on one line, and the scrubbers (ExceptionSanitizer) run regular expressions
 * with quantifiers. A process that has compiled enough code compiles them
 * unoptimized, and V8 then runs out of stack on a few megabytes (AGENTS.md,
 * "Megabyte-long values"). ExceptionExplanationPrompt cuts every value to a
 * fixed length before anything reads it, and reads the model's answer with
 * indexOf.
 *
 * So the prompt is built here from sixteen megabytes of each, and an answer
 * of sixteen megabytes is read, in a node process started with
 * --no-regexp-optimization, the module bundled by esbuild as
 * HugeTextInLongRunningProcess.test.ts does. Only booleans come back.
 */

const COMMON_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

interface Report {
  regexpOnItsOwn: boolean;
  results: Record<
    string,
    { ok: boolean; checks?: Record<string, boolean>; error?: string }
  >;
}

function runUnoptimized(script: string): Report {
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
            contents:
              'export * from "./Server/Utils/AI/TelemetryAi/ExceptionExplanationPrompt";\n' +
              'export * from "./Server/Utils/AI/TelemetryAi/ExceptionDigestPrompt";',
            resolveDir: process.cwd(),
            loader: "ts",
            sourcefile: "explanation-huge-text.ts",
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

        const SIZE = 16 * 1024 * 1024;
        const repeatTo = (unit, length) => {
          return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
        };
        const line = (body) => "HEAD " + repeatTo(body, SIZE) + " TAIL";

        // The state this is about: a quantifier over sixteen megabytes overflows.
        let regexpOnItsOwn = true;
        try {
          /(?:a|b)*c/.test(repeatTo("ab", SIZE));
        } catch (error) {
          regexpOnItsOwn = false;
        }

        const results = {};
        const attempt = (name, work) => {
          try {
            results[name] = { ok: true, checks: work() };
          } catch (error) {
            results[name] = {
              ok: false,
              error: String((error && error.message) || error).split("\n")[0].slice(0, 200),
            };
          }
        };
      ` +
        script +
        String.raw`
        process.stdout.write(JSON.stringify({ regexpOnItsOwn, results }));
        process.exit(0);
      `,
    ],
    {
      cwd: COMMON_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 540000,
    },
  );

  return JSON.parse(output) as Report;
}

function expectEveryCheckPassed(report: Report): void {
  for (const [name, result] of Object.entries(report.results)) {
    expect({ name, ...result }).toEqual({
      name,
      ok: true,
      checks: Object.fromEntries(
        Object.keys(result.checks || { built: true }).map(
          (check: string): [string, boolean] => {
            return [check, true];
          },
        ),
      ),
    });
  }
}

describe("Sixteen megabytes of an exception, where V8 compiles regular expressions unoptimized", () => {
  test("the prompt is built, bounded, from every kind of long value, and a long answer is read", () => {
    const report: Report = runUnoptimized(String.raw`
      const evidenceOf = (overrides) => ({
        exceptionType: "Error",
        message: "",
        stackTrace: "",
        occurrenceCount: 1,
        unhandled: false,
        isResolved: false,
        spans: [],
        logs: [],
        changes: [],
        ...overrides,
      });

      const shapes = {
        "a message of one line of letters": () => evidenceOf({ message: line("ab") }),
        "a message of one line of hex": () => evidenceOf({ message: line("0123456789abcdef") }),
        "a message of emails": () => evidenceOf({ message: line("priya@example.com ") }),
        "a stack trace of one line": () => evidenceOf({ stackTrace: line("x") }),
        "a stack trace of many frames": () =>
          evidenceOf({ stackTrace: "Error: x\n" + repeatTo("    at f (/app/src/a.ts:1:1)\n", SIZE) }),
        "a log body of one line": () =>
          evidenceOf({ logs: [{ severity: "Error", body: line("ab") }] }),
        "a span name of one line": () =>
          evidenceOf({ spans: [{ name: line("GET /x "), kind: "Server", isExceptionSpan: true }] }),
        "a release of one line": () =>
          evidenceOf({ lastSeenInRelease: line("1.2.3.") }),
      };

      for (const [name, evidenceFor] of Object.entries(shapes)) {
        attempt(name, () => {
          const evidence = evidenceFor();
          const started = Date.now();
          const prompt = lib.buildExceptionExplanationPrompt(evidence);

          return {
            "is bounded": prompt.length < 64 * 1024,
            "took under ten seconds": Date.now() - started < 10000,
          };
        });
      }

      attempt("an answer of sixteen megabytes", () => {
        const started = Date.now();
        const answer =
          '{"summary": "' + repeatTo("s", 1000) + '", "rootCause": "r"}' + line("{ab}");
        lib.parseExceptionExplanationResponse(answer, line("frame "));
        const unclosed = "{" + line('"a": ');
        const nothing = lib.parseExceptionExplanationResponse(unclosed, "");

        return {
          "an unclosed answer is none": nothing === null,
          "took under ten seconds": Date.now() - started < 10000,
        };
      });
    `);

    // The process really is in that state.
    expect(report.regexpOnItsOwn).toBe(false);
    expectEveryCheckPassed(report);
    expect(Object.keys(report.results)).toHaveLength(9);
  }, 600000);

  /*
   * The day's digest (ExceptionDigestPrompt) is built from the same values,
   * twenty exceptions at a time: each is cut before it is scrubbed, and the
   * stack trace before its top frame is read.
   */
  test("the digest's prompt is built, bounded, from twenty long exceptions, and a long answer is read", () => {
    const report: Report = runUnoptimized(String.raw`
      const exceptionOf = (overrides) => ({
        telemetryExceptionId: "id",
        kind: "new",
        exceptionType: "Error",
        message: "",
        stackTrace: "",
        occurrenceCount: 1,
        unhandled: false,
        ...overrides,
      });

      const shapes = {
        "messages of one line of letters": () => exceptionOf({ message: line("ab") }),
        "messages of emails": () => exceptionOf({ message: line("priya@example.com ") }),
        "stack traces of one line": () => exceptionOf({ stackTrace: line("x") }),
        "stack traces of many frames": () =>
          exceptionOf({ stackTrace: "Error: x\n" + repeatTo("    at f (/app/src/a.ts:1:1)\n", SIZE) }),
        "types, services and releases of one line": () =>
          exceptionOf({
            exceptionType: line("Type"),
            resourceName: line("svc "),
            environment: line("prod "),
            release: line("1.2.3."),
          }),
      };

      for (const [name, exceptionFor] of Object.entries(shapes)) {
        attempt(name, () => {
          const one = exceptionFor();
          const exceptions = Array.from({ length: 20 }, (_, index) => ({
            ...one,
            telemetryExceptionId: "id-" + index,
          }));
          const started = Date.now();
          const prompt = lib.buildExceptionDigestPrompt(exceptions);

          return {
            "is bounded": prompt.length < 64 * 1024,
            "took under ten seconds": Date.now() - started < 10000,
          };
        });
      }

      attempt("a digest answer of sixteen megabytes", () => {
        const started = Date.now();
        const given = [exceptionOf({ message: line("ab") })];
        const answer =
          '{"headline": "' + repeatTo("h", 1000) + '", "items": [{"ref": "E1", "summary": "s"}]}' +
          line("{ab}");
        lib.parseExceptionDigestResponse(answer, given);
        const unclosed = "{" + line('"a": ');
        const nothing = lib.parseExceptionDigestResponse(unclosed, given);

        return {
          "an unclosed answer is none": nothing === null,
          "took under ten seconds": Date.now() - started < 10000,
        };
      });
    `);

    expect(report.regexpOnItsOwn).toBe(false);
    expectEveryCheckPassed(report);
    expect(Object.keys(report.results)).toHaveLength(6);
  }, 600000);
});
