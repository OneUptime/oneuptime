import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * A SCREENSHOT LEFT OUT OF A PROMPT, BY A PROCESS THAT HAS BEEN RUNNING A
 * WHILE (issue #4587).
 *
 * V8 matches a regular expression with a backtracking stack that can grow
 * with every character a quantifier takes, and once a process has compiled
 * enough code, V8 stops optimizing the regular expressions it compiles. A
 * server that has been up a while gets there, and so does a jest worker that
 * has run a few hundred test files: /^[A-Za-z0-9+/]+={0,2}$/ then runs out
 * of stack on a three-megabyte screenshot (ScreenshotEmailInLongRunningProcess
 * pins the same for emails).
 *
 * Leaving a screenshot out of what a model reads must work there too - an
 * investigation runs in exactly such a server - so the whole path a
 * screenshot takes on its way to a prompt runs here in a node process
 * started with --no-regexp-optimization: PromptText (the sanitizer, the
 * field, the messages backstop) and the tool-result serializer (whose
 * secret-redacting rules must never read the screenshot's megabytes).
 * esbuild bundles the modules in that process, as MermaidFromSource.test.ts
 * does: esbuild refuses to load under the jsdom environment Common's jest
 * uses.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

interface Attempt<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface ScreenshotResult {
  megabytes: number;
  omitted: Attempt<string>;
  field: Attempt<string>;
  messages: Attempt<string>;
  serialized: Attempt<string>;
  rawRun: Attempt<string>;
  serializedRawRun: Attempt<string>;
}

interface ProcessReport {
  oldBase64Pattern: Attempt<boolean>;
  screenshots: Array<ScreenshotResult>;
}

function runWithUnoptimizedRegularExpressions(): ProcessReport {
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
            contents: [
              'export { default as PromptText } from "./Utils/AI/PromptText";',
              'export { default as ToolResultSerializer } from "./Server/Utils/AI/Toolbox/Serializer";',
            ].join("\n"),
            resolveDir: process.cwd(),
            loader: "ts",
            sourcefile: "prompt-text.ts",
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
        const { PromptText, ToolResultSerializer } = bundle.exports;

        // A JPEG's first bytes, then a photo's noise, as base64.
        const screenshot = (megabytes) => {
          const bytes = Buffer.alloc(megabytes * 1024 * 1024);
          let seed = 9;
          for (let index = 0; index < bytes.length; index++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            bytes[index] = (seed >> 8) & 0xff;
          }
          bytes[0] = 0xff;
          bytes[1] = 0xd8;
          bytes[2] = 0xff;
          bytes[3] = 0xe0;
          return bytes.toString("base64");
        };

        const attempt = (work) => {
          try {
            return { ok: true, value: work() };
          } catch (error) {
            return { ok: false, error: String((error && error.message) || error).split("\n")[0] };
          }
        };

        // The state this is about: the base64 check the image parser used runs out of stack here.
        const oldBase64Pattern = attempt(() => {
          return /^[A-Za-z0-9+/]+={0,2}$/.test(screenshot(3));
        });

        const screenshots = [];

        for (const megabytes of [3, 12]) {
          const base64 = screenshot(megabytes);
          const description =
            "Checkout failed.\n\n![Login](data:image/jpeg;base64," + base64 + ")\n\nAfter it.";

          screenshots.push({
            megabytes,
            omitted: attempt(() => PromptText.omitEmbeddedData(description).text),
            field: attempt(() => PromptText.field(description)),
            messages: attempt(
              () =>
                PromptText.omitEmbeddedDataFromMessages([
                  { role: "user", content: description },
                ]).messages[0].content,
            ),
            serialized: attempt(
              () => ToolResultSerializer.serializeRows([{ description }]).text,
            ),
            // The same screenshot placed without its data: prefix.
            rawRun: attempt(
              () => PromptText.omitEmbeddedData("Screenshot: " + base64 + " end").text,
            ),
            serializedRawRun: attempt(
              () =>
                ToolResultSerializer.serializeText("Screenshot: " + base64 + " end", 1)
                  .text,
            ),
          });
        }

        process.stdout.write(JSON.stringify({ oldBase64Pattern, screenshots }));
        process.exit(0);
      `,
    ],
    {
      cwd: COMMON_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 240000,
    },
  );

  return JSON.parse(output) as ProcessReport;
}

describe("A screenshot left out of a prompt, where V8 compiles regular expressions unoptimized", () => {
  test("is a short note at 3 and at 12 megabytes, on every path to a prompt", () => {
    const report: ProcessReport = runWithUnoptimizedRegularExpressions();

    /*
     * The process really is in that state: the pattern the image parser
     * checked base64 with runs out of stack on three megabytes there. If V8
     * ever stops doing that, this test no longer shows anything and needs a
     * new way to get there.
     */
    expect(report.oldBase64Pattern.ok).toBe(false);
    expect(report.oldBase64Pattern.error).toBe(
      "Maximum call stack size exceeded",
    );

    expect(report.screenshots).toHaveLength(2);

    for (const screenshot of report.screenshots) {
      const note: string = `[image omitted: JPEG, ${screenshot.megabytes} MB]`;
      const description: string = `Checkout failed.\n\n![Login](${note})\n\nAfter it.`;

      expect(screenshot.omitted).toEqual({ ok: true, value: description });
      expect(screenshot.field).toEqual({ ok: true, value: description });
      expect(screenshot.messages).toEqual({ ok: true, value: description });
      expect(screenshot.serialized).toEqual({
        ok: true,
        value: `- description=${description}`,
      });
      expect(screenshot.rawRun).toEqual({
        ok: true,
        value: `Screenshot: ${note} end`,
      });
      expect(screenshot.serializedRawRun).toEqual({
        ok: true,
        value: `Screenshot: ${note} end`,
      });
    }
  }, 300000);
});
