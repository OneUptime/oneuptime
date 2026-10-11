import { beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * TEXT FROM OUTSIDE, A MEGABYTE LONG, READ BY A PROCESS THAT HAS BEEN
 * RUNNING A WHILE.
 *
 * Three readers take markup out of text from outside: the quote of a token
 * endpoint's answer in an OAuth error (OAuth2TokenClient; an answer may be
 * a megabyte), the Dynamics 365 note template's script, which reads a
 * note's HTML (a note's text can be as long) and places it with the
 * asWritten helper every Jira and Dynamics 365 script carries, and the
 * Microsoft Teams reader of a pinned message (ReactionNoteSync.htmlToText).
 * V8 matches a regular expression with a backtracking stack that can grow
 * with every character a quantifier takes, and a process that has run a
 * while compiles them without optimization - so, as AGENTS.md
 * ("Megabyte-long values") asks, none runs a pattern with a quantifier over
 * the whole text: each reads it with loops and indexOf.
 *
 * All three run here in a node process started with
 * --no-regexp-optimization, the state such a process reaches, on a megabyte
 * of each shape that a quantified pattern would take whole. esbuild bundles
 * the modules in that process, as ScreenshotEmailInLongRunningProcess.test.ts
 * does. The note script runs as the workflow runner runs it, as the body of
 * a function given its arguments, with its step swapped for a few lines that
 * call its readers.
 *
 * The Teams reader is also held to time. It took the spaces before each line
 * break out with /[ \t]+\n/g and attachment elements with
 * /<attachment\b[^>]*>[\s\S]*?<\/attachment>/gi, which start again from
 * every place a match could start: in this state, two seconds for 28 KB of
 * spaces (a Teams message's largest) and half a minute for 100 KB. Each
 * shape below is read well inside a second.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

/*
 * Each shape is read in about 50 ms on a developer machine. The patterns
 * this replaced took minutes on a megabyte of the slow ones.
 */
const TEAMS_READ_LIMIT_IN_MS: number = 1000;

interface Attempt {
  ok: boolean;
  error?: string;
  // Whether what came out holds a "<" that starts markup.
  markup?: boolean;
}

interface ProcessReport {
  oldBase64Pattern: Attempt;
  answers: Array<{ shape: string; read: Attempt }>;
  notes: Array<{ shape: string; read: Attempt }>;
  teamsMessages: Array<{ shape: string; read: Attempt; ms: number }>;
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
              'export { default as OAuth2TokenClient } from "./Server/Utils/Workflow/OAuth2TokenClient";',
              'export { OAuth2GrantType } from "./Types/Workflow/WorkflowVariableOAuth";',
              'export { getTemplateGraphSpec } from "./Types/Workflow/Templates";',
              'export { default as MicrosoftTeamsReactionNoteSync } from "./Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync";',
            ].join("\n"),
            resolveDir: process.cwd(),
            loader: "ts",
            sourcefile: "markup-readers.ts",
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
          OAuth2TokenClient,
          OAuth2GrantType,
          getTemplateGraphSpec,
          MicrosoftTeamsReactionNoteSync,
        } = bundle.exports;

        const MEGABYTE = 1024 * 1024;
        const repeatTo = (unit) => unit.repeat(Math.floor(MEGABYTE / unit.length));
        const MARKUP_START = new RegExp("<[A-Za-z/!?]");

        const attempt = (work) => {
          try {
            return { ok: true, markup: MARKUP_START.test(work()) };
          } catch (error) {
            return { ok: false, error: String((error && error.message) || error).split("\n")[0] };
          }
        };

        /*
         * The state this is about: the pattern the inline image parser used
         * runs out of stack here on a three-megabyte screenshot, as in
         * ScreenshotEmailInLongRunningProcess.test.ts.
         */
        const oldBase64Pattern = attempt(() => {
          const screenshot = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.alloc(3 * MEGABYTE, 0x5a),
          ]).toString("base64");

          return String(new RegExp("^[A-Za-z0-9+/]+={0,2}$").test(screenshot));
        });

        const SHAPES = [
          ["spaces", repeatTo(" ") + "x"],
          ["tabs and line breaks", repeatTo("\t\n") + "x"],
          ["control characters", repeatTo("\u0001") + "x"],
          ["line breaks", "<p>a" + repeatTo("\n") + "b</p>"],
          ["tags that never close", repeatTo("<a") + "&amp;"],
          ["a run of '<' before an unclosed value", repeatTo("<") + 'a="&amp;'],
          ["script elements that never close", repeatTo("<script ")],
          ["a line of backticks", "<p>" + repeatTo(String.fromCharCode(96)) + "</p>"],
          ["one long line break", "<p>a<br" + repeatTo(" ") + ">b</p>"],
          ["entities", repeatTo("&amp;&lt;")],
        ];

        const answers = SHAPES.map(([shape, text]) => {
          return {
            shape,
            read: attempt(() => {
              try {
                OAuth2TokenClient.parseTokenResponse(
                  { statusCode: 502, bodyText: text, headers: { "content-type": "text/html" } },
                  { grantType: OAuth2GrantType.ClientCredentials, now: new Date() },
                );
              } catch (error) {
                if (error && error.name !== "RangeError" && typeof error.message === "string" && error.message.startsWith("The token endpoint")) {
                  return error.message;
                }
                throw error;
              }
              throw new Error("The answer was read as a token.");
            }),
          };
        });

        const spec = getTemplateGraphSpec("dynamics-case-note-to-incident-private-note");
        const code = spec.nodes.find((node) => node.componentId === "read-note-1").args.code;
        const step = "// ---- Reading the note ----";
        const readers = new Function(
          "args",
          code.slice(0, code.indexOf(step)) +
            "return { htmlToText: htmlToText, asWritten: asWritten };",
        )({});

        const notes = SHAPES.map(([shape, text]) => {
          return {
            shape,
            read: attempt(() => {
              return readers.asWritten(readers.htmlToText(text));
            }),
          };
        });

        // A Teams message body as Graph hands it over: HTML, its attachments as elements.
        const TEAMS_SHAPES = [
          ...SHAPES,
          ["spaces with no line break after them", "<p>" + repeatTo(" ") + "x</p>"],
          ["non-breaking spaces", "<p>" + repeatTo("&nbsp;") + "x</p>"],
          ["attachment elements that never close", repeatTo('<attachment id="1">')],
          ["attachment start tags with no '>'", repeatTo("<attachment ")],
          ["attachment elements", repeatTo('<attachment id="1"></attachment>')],
        ];

        const teamsMessages = TEAMS_SHAPES.map(([shape, text]) => {
          const started = Date.now();
          const read = attempt(() => {
            return MicrosoftTeamsReactionNoteSync.htmlToText(text);
          });

          return { shape, read, ms: Date.now() - started };
        });

        process.stdout.write(
          JSON.stringify({ oldBase64Pattern, answers, notes, teamsMessages }),
        );
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

describe("Markup read out of megabyte-long text, where V8 compiles regular expressions unoptimized", () => {
  let report: ProcessReport;

  beforeAll(() => {
    report = runWithUnoptimizedRegularExpressions();
  }, 300000);

  test("the OAuth error quote and the Dynamics 365 note script read every shape without running out of stack", () => {
    /*
     * The process really is in that state: a quantified pattern over three
     * megabytes runs out of stack there. If V8 ever stops doing that, this
     * test no longer shows anything and needs a new way to get there.
     */
    expect(report.oldBase64Pattern).toEqual({
      ok: false,
      error: "Maximum call stack size exceeded",
    });

    expect(report.answers).toHaveLength(10);
    expect(report.notes).toHaveLength(10);

    for (const { shape, read } of [...report.answers, ...report.notes]) {
      // No error, and no "<" that starts markup in what was read.
      expect({ shape, read }).toEqual({
        shape,
        read: { ok: true, markup: false },
      });
    }
  });

  test("the Teams reader of a pinned message reads every shape, each in well under a second", () => {
    // A megabyte of each shape: the ten above, and five a Teams message can take.
    expect(report.teamsMessages).toHaveLength(15);

    for (const { shape, read, ms } of report.teamsMessages) {
      expect({ shape, read, fast: ms < TEAMS_READ_LIMIT_IN_MS }).toEqual({
        shape,
        read: { ok: true, markup: false },
        fast: true,
      });
    }
  });
});
