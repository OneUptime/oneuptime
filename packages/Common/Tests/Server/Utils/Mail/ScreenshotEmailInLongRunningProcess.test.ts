import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * A SCREENSHOT IN AN EMAIL, SENT BY A PROCESS THAT HAS BEEN RUNNING A WHILE.
 *
 * V8 matches a regular expression with a backtracking stack that can grow
 * with every character a quantifier takes, and once a process has compiled
 * enough code, V8 stops optimizing the regular expressions it compiles -
 * which roughly doubles that stack. A server that has been up a while gets
 * there, and so does a jest worker that has run a few hundred test files.
 * There, a synthetic monitor screenshot of three megabytes ran V8 out of
 * stack - "Maximum call stack size exceeded" - in marked and in the base64
 * check of the inline image parser, and the email was never rendered.
 * Whether it did depended on what the process had run before.
 *
 * So the whole path an email's screenshot takes - the inline image parser,
 * the email renderer and the attachments made from its HTML - runs here in
 * a node process started with --no-regexp-optimization, the state such a
 * process reaches. esbuild bundles the modules in that process, as
 * MermaidFromSource.test.ts does: esbuild refuses to load under the jsdom
 * environment Common's jest uses.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface Attempt<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface ScreenshotResult {
  megabytes: number;
  parsedByteLength: Attempt<number | null>;
  renderedWithImage: Attempt<boolean>;
  attached: Attempt<{
    images: number;
    sameData: boolean;
    pointsAtAttachment: boolean;
  }>;
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
              'export { default as Markdown, MarkdownContentType } from "./Server/Types/Markdown";',
              'export { default as EmailInlineImages } from "./Server/Utils/Mail/EmailInlineImages";',
              'export { parseInlineImageDataUri } from "./Utils/Markdown/InlineImageDataUri";',
            ].join("\n"),
            resolveDir: process.cwd(),
            loader: "ts",
            sourcefile: "screenshot-email.ts",
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
        const {
          Markdown,
          MarkdownContentType,
          EmailInlineImages,
          parseInlineImageDataUri,
        } = bundle.exports;

        // A PNG signature, then a screenshot's worth of bytes, as base64.
        const screenshot = (megabytes) => {
          return Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.alloc(megabytes * 1024 * 1024, 0x5a),
          ]).toString("base64");
        };

        const attempt = async (work) => {
          try {
            return { ok: true, value: await work() };
          } catch (error) {
            return { ok: false, error: String((error && error.message) || error).split("\n")[0] };
          }
        };

        (async () => {
          // The state this is about: the base64 check the parser used runs out of stack here.
          const oldBase64Pattern = await attempt(() => {
            return /^[A-Za-z0-9+/]+={0,2}$/.test(screenshot(3));
          });

          const screenshots = [];

          for (const megabytes of [3, 12]) {
            const base64 = screenshot(megabytes);
            const dataUri = "data:image/png;base64," + base64;
            let html = "";

            const parsedByteLength = await attempt(() => {
              const image = parseInlineImageDataUri(dataUri);
              return image ? image.byteLength : null;
            });

            const renderedWithImage = await attempt(async () => {
              html = await Markdown.convertToHTML(
                "Login failed\n\n![Login](" + dataUri + ")",
                MarkdownContentType.Email,
              );
              return html.includes('<img src="' + dataUri + '"');
            });

            const attached = await attempt(() => {
              const result = EmailInlineImages.attach(html, {
                maxTotalBytes: 64 * 1024 * 1024,
              });
              return {
                images: result.inlineImages.length,
                sameData:
                  result.inlineImages.length === 1 &&
                  result.inlineImages[0].base64 === base64,
                pointsAtAttachment:
                  result.inlineImages.length === 1 &&
                  result.html.includes('src="cid:' + result.inlineImages[0].contentId + '"'),
              };
            });

            screenshots.push({ megabytes, parsedByteLength, renderedWithImage, attached });
          }

          process.stdout.write(JSON.stringify({ oldBase64Pattern, screenshots }));
          process.exit(0);
        })();
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

describe("A screenshot in an email, where V8 compiles regular expressions unoptimized", () => {
  test("is parsed, rendered and attached at 3 and at 12 megabytes", () => {
    const report: ProcessReport = runWithUnoptimizedRegularExpressions();

    /*
     * The process really is in that state: the pattern the parser checked
     * base64 with runs out of stack on three megabytes there. If V8 ever
     * stops doing that, this test no longer shows anything and needs a new
     * way to get there.
     */
    expect(report.oldBase64Pattern.ok).toBe(false);
    expect(report.oldBase64Pattern.error).toBe(
      "Maximum call stack size exceeded",
    );

    expect(report.screenshots).toHaveLength(2);

    for (const screenshot of report.screenshots) {
      const bytes: number = 8 + screenshot.megabytes * 1024 * 1024;

      expect(screenshot.parsedByteLength).toEqual({ ok: true, value: bytes });
      expect(screenshot.renderedWithImage).toEqual({ ok: true, value: true });
      expect(screenshot.attached).toEqual({
        ok: true,
        value: { images: 1, sameData: true, pointsAtAttachment: true },
      });
    }
  }, 300000);
});
