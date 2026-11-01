import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * MEGABYTE-LONG VALUES, SCANNED BY A PROCESS THAT HAS BEEN RUNNING A WHILE.
 *
 * Data Security scans whatever a store or a log holds: a synthetic
 * monitor's screenshot as several megabytes of base64 on one line, a log
 * pasted as a paragraph of a hundred thousand lines. V8 matches a regular
 * expression with a backtracking stack that can grow with every character a
 * quantifier takes, and a process that has compiled enough code compiles
 * regular expressions unoptimized, where that stack runs out on about three
 * megabytes (AGENTS.md, "Megabyte-long values"). The scanner keeps every
 * detector's quantifiers bounded and hands each pattern a window of 64 KB,
 * so neither shape can do that.
 *
 * So both run here in a node process started with --no-regexp-optimization,
 * the state such a process reaches, with TextScanner bundled by esbuild as
 * ScreenshotEmailInLongRunningProcess.test.ts does. Each scan is timed once,
 * in that process: the child is a deadline run to its end, and the budget
 * is far above the linear time the scan takes.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

// The most one scan of either shape may take, unoptimized, on a slow runner.
const SCAN_BUDGET_IN_MS: number = 90_000;

interface Attempt<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface ScanResult {
  length: number;
  inMs: number;
  found: Attempt<Record<string, number>>;
}

interface ProcessReport {
  oldBase64Pattern: Attempt<boolean>;
  base64Line: ScanResult;
  paragraph: ScanResult;
}

function scanLongValuesUnoptimized(): ProcessReport {
  const output: string = childProcess.execFileSync(
    process.execPath,
    [
      "--no-regexp-optimization",
      "-e",
      String.raw`
        const path = require("path");
        const esbuild = require("esbuild");

        const built = esbuild.buildSync({
          stdin: {
            contents:
              'export { findSensitiveValues } from "./Utils/DataSecurity/TextScanner";',
            resolveDir: process.cwd(),
            loader: "ts",
            sourcefile: "long-values.ts",
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
        const { findSensitiveValues } = bundle.exports;

        const attempt = (work) => {
          try {
            return { ok: true, value: work() };
          } catch (error) {
            return { ok: false, error: String((error && error.message) || error).split("\n")[0] };
          }
        };

        const scan = (text) => {
          const started = Date.now();
          const found = attempt(() => {
            const counts = {};

            for (const match of findSensitiveValues(text)) {
              counts[match.dataTypeId] = (counts[match.dataTypeId] || 0) + 1;
            }

            return counts;
          });

          return { length: text.length, inMs: Date.now() - started, found };
        };

        // Bytes of every value, in a fixed order, as a screenshot's base64 holds them.
        const bytes = Buffer.alloc(4.5 * 1024 * 1024);

        for (let index = 0; index < bytes.length; index++) {
          bytes[index] = (index * index + 3 * index + (index >> 8)) & 255;
        }

        const base64 = bytes.toString("base64");

        // The state this is about: a quantifier over the whole value runs out of stack here.
        const oldBase64Pattern = attempt(() => {
          return /^[A-Za-z0-9+/]+={0,2}$/.test(base64);
        });

        // Six megabytes on one line, with an email before it and a card two megabytes in.
        const base64Line =
          "screenshot by jane.doe@acme.io: data:image/png;base64," +
          base64.slice(0, 2 * 1024 * 1024) +
          " card 4539 1488 0343 6467 " +
          base64.slice(2 * 1024 * 1024);

        // A hundred thousand lines and no blank one, an email every 5,000.
        const lines = [];

        for (let index = 0; index < 100000; index++) {
          lines.push(
            index % 5000 === 0
              ? "page ops" + index + "@acme.io now"
              : "INFO request " + index + " ok in 12 ms",
          );
        }

        process.stdout.write(
          JSON.stringify({
            oldBase64Pattern,
            base64Line: scan(base64Line),
            paragraph: scan(lines.join("\n")),
          }),
        );
        process.exit(0);
      `,
    ],
    {
      cwd: COMMON_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 280000,
    },
  );

  return JSON.parse(output) as ProcessReport;
}

describe("Megabyte-long values, where V8 compiles regular expressions unoptimized", () => {
  test("a 6 MB line of base64 and a paragraph of 100,000 lines are scanned without running out of stack", () => {
    const report: ProcessReport = scanLongValuesUnoptimized();

    /*
     * The process really is in that state: one quantifier over the value
     * runs out of stack there. If V8 ever stops doing that, this test no
     * longer shows anything and needs a new way to get there.
     */
    expect(report.oldBase64Pattern).toEqual({
      ok: false,
      error: "Maximum call stack size exceeded",
    });

    expect(report.base64Line.length).toBeGreaterThan(6 * 1024 * 1024);
    expect(report.base64Line.found).toEqual({
      ok: true,
      value: { "email-address": 1, "credit-card-number": 1 },
    });
    expect(report.base64Line.inMs).toBeLessThan(SCAN_BUDGET_IN_MS);

    expect(report.paragraph.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(report.paragraph.found).toEqual({
      ok: true,
      value: { "email-address": 20 },
    });
    expect(report.paragraph.inMs).toBeLessThan(SCAN_BUDGET_IN_MS);
  }, 300000);
});
