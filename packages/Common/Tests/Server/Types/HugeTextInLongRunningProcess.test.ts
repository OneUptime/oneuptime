import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

/*
 * A NOTIFICATION'S TEXT, HOWEVER LONG, SENT BY A PROCESS THAT HAS BEEN
 * RUNNING A WHILE.
 *
 * A notification carries what monitored systems and people put in it: a
 * response body or a log a description template places, a log line pasted
 * into a note. That can be sixteen megabytes on one line, or a paragraph of
 * two hundred thousand lines. V8 matches a regular expression with a
 * backtracking stack that can grow with every character a quantifier takes,
 * and once a process has compiled enough code - a server that has been up a
 * while, a CI jest worker that has run many test files - it compiles them
 * unoptimized. There marked ran out of stack ("Maximum call stack size
 * exceeded") on a line of about 3.5 million characters, and on a paragraph of
 * that size, and the email was never rendered, so never sent;
 * convertToPlainText did on a long URL, a run of spaces, a minified JSON
 * document or an unclosed tag; slackify (Slack) on most long lines, when it
 * had not run for minutes first; the Microsoft Teams message card on a JSON
 * line, a run of links or a long table.
 *
 * So every converter a notification's text goes through runs here, on
 * sixteen megabytes, in a node process started with
 * --no-regexp-optimization: the state such a process reaches. esbuild bundles
 * the modules in that process, as ScreenshotEmailInLongRunningProcess.test.ts
 * does: esbuild refuses to load under the jsdom environment Common's jest
 * uses. The checks are made in the process, so only booleans come back - a
 * failure never prints sixteen million characters.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

interface Attempt {
  ok: boolean;
  checks?: Record<string, boolean>;
  error?: string;
}

interface ProcessReport {
  // marked itself, on one sixteen-megabyte line: the state this is about.
  markedOnItsOwn: Attempt;
  results: Record<string, Attempt>;
}

/*
 * The inputs, built the same way in every process. Each single line starts
 * with "HEAD " and ends with " TAIL", so a converter that kept the line's
 * text has both.
 */
const INPUTS_SCRIPT: string = String.raw`
  const MIB = 1024 * 1024;
  const SIZE = 16 * MIB;

  const repeatTo = (unit, length) => {
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  };

  const line = (body) => {
    return "HEAD " + repeatTo(body, SIZE) + " TAIL";
  };

  // Lines of a log, one after another with no blank line: one paragraph.
  const logLines = (prefix) => {
    const lines = repeatTo(
      prefix + "2026-10-08T10:00:00Z INFO request served in 12 ms for web-01\n",
      SIZE,
    );

    return (
      prefix +
      "HEAD\n" +
      lines.slice(0, lines.lastIndexOf("\n") + 1) +
      prefix +
      "TAIL"
    );
  };

  // A monitor's response body: one line of minified JSON.
  const jsonBody = () => {
    const item = '{"id":1,"name":"web-01","ok":true},';

    return (
      '{"head":"HEAD","items":[' +
      item.repeat(Math.ceil(SIZE / item.length)) +
      '{"id":0}],"tail":"TAIL"}'
    );
  };

  const singleLines = {
    letters: () => line("a"),
    words: () => line("lorem ipsum dolor "),
    json: () => "HEAD " + jsonBody() + " TAIL",
    url: () => "HEAD https://example.com/" + repeatTo("a", SIZE) + " TAIL",
    spaces: () => "HEAD " + repeatTo(" ", SIZE) + " TAIL",
    tag: () => "HEAD <" + repeatTo("a", SIZE) + " TAIL",
    links: () => line("[a]("),
  };

  const markdownInputs = {
    "a long line": () => "Before\n\n" + singleLines.letters() + "\n\nAfter",
    "a long line of words": () => "Before\n\n" + singleLines.words() + "\n\nAfter",
    "a long line of JSON": () => "Before\n\n" + singleLines.json() + "\n\nAfter",
    "a long URL": () => "Before\n\n" + singleLines.url() + "\n\nAfter",
    "a long run of spaces": () => "Before\n\n" + singleLines.spaces() + "\n\nAfter",
    "a long unclosed tag": () => "Before\n\n" + singleLines.tag() + "\n\nAfter",
    "a long run of link brackets": () => "Before\n\n" + singleLines.links() + "\n\nAfter",
    "a long paragraph of log lines": () => "Before\n\n" + logLines("") + "\n\nAfter",
    "a long quote of log lines": () => "Before\n\n" + logLines("> ") + "\n\nAfter",
  };

  /*
   * Runs of lines that are not plain - each could be a table row, HTML or
   * code - so none of them is held back: what is left is too long to read
   * as Markdown, and is shown as text.
   */
  const notPlainLines = (line) => {
    return "HEAD\n" + line.repeat(Math.ceil(SIZE / line.length)) + "TAIL";
  };

  const notPlainInputs = {
    "a long log whose lines hold a pipe": () =>
      "Before\n\n" +
      notPlainLines("2026-10-08T10:00:00Z | INFO | request served | 12 ms\n") +
      "\n\nAfter",
    "a long log whose lines hold an arrow": () =>
      "Before\n\n" +
      notPlainLines("2026-10-08T10:00:00Z INFO GET /api -> 200 in 12 ms\n") +
      "\n\nAfter",
    "a long table": () =>
      "Before\n\n| Host | State |\n| --- | --- |\n| HEAD | up |\n" +
      "| web-01 | down |\n".repeat(Math.ceil(SIZE / 18)) +
      "| TAIL | up |\n\nAfter",
  };

  // A description template that places a monitor's response body.
  const templatedInputs = (MonitorTemplateUtil) => {
    return {
      "a templated response body": () => {
        return (
          "Before\n\n" +
          MonitorTemplateUtil.processMarkdownTemplateString({
            value: "**Response:** {{responseBody}}",
            storageMap: { responseBody: jsonBody() },
          }) +
          "\n\nAfter"
        );
      },
      "a templated response body as a whole template": () => {
        return (
          "Before\n\n" +
          MonitorTemplateUtil.processMarkdownTemplateString({
            value: "{{responseBody}}",
            storageMap: { responseBody: JSON.parse(jsonBody()) },
          }) +
          "\n\nAfter"
        );
      },
    };
  };
`;

/*
 * Runs `script` in a node process that compiles regular expressions
 * unoptimized, with `lib` the bundle of the modules `entry` exports, and
 * returns what it writes.
 */
function runUnoptimized(entry: Array<string>, script: string): ProcessReport {
  const output: string = childProcess.execFileSync(
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
            contents: process.env.HUGE_TEXT_ENTRY,
            resolveDir: process.cwd(),
            loader: "ts",
            sourcefile: "huge-text.ts",
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
        String.raw`
        const attempt = async (work) => {
          try {
            return { ok: true, checks: await work() };
          } catch (error) {
            return {
              ok: false,
              error: String((error && error.message) || error).split("\n")[0].slice(0, 200),
            };
          }
        };

        const markedOnItsOwn = (() => {
          try {
            require("marked").marked(singleLines.letters());
            return { ok: true };
          } catch (error) {
            return { ok: false, error: String(error.message).split("\n")[0] };
          }
        })();

        (async () => {
          const results = {};

          try {
      ` +
        script +
        String.raw`
          } catch (error) {
            // Never the input itself, which can be sixteen megabytes.
            results["the process"] = {
              ok: false,
              error: String((error && error.message) || error).split("\n")[0].slice(0, 200),
            };
          }

          process.stdout.write(JSON.stringify({ markedOnItsOwn, results }));
          process.exit(0);
        })();
      `,
    ],
    {
      cwd: COMMON_ROOT,
      encoding: "utf8",
      env: { ...process.env, HUGE_TEXT_ENTRY: entry.join("\n") },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 540000,
    },
  );

  return JSON.parse(output) as ProcessReport;
}

/*
 * The process really is in that state: marked runs out of stack on one
 * sixteen-megabyte line there. If V8 ever stops doing that, these tests no
 * longer show anything and need a new way to get there.
 */
function expectUnoptimizedProcess(report: ProcessReport): void {
  expect(report.markedOnItsOwn.ok).toBe(false);
  expect(report.markedOnItsOwn.error).toBe("Maximum call stack size exceeded");
}

function expectEveryCheckPassed(report: ProcessReport): void {
  for (const [name, result] of Object.entries(report.results)) {
    // The name goes with the result, so a failure says which input it was.
    expect({ name: name, ...result }).toEqual({
      name: name,
      ok: true,
      checks: Object.fromEntries(
        Object.keys(result.checks || { converted: true }).map(
          (check: string): [string, boolean] => {
            return [check, true];
          },
        ),
      ),
    });
  }
}

describe("Sixteen megabytes of text, where V8 compiles regular expressions unoptimized", () => {
  test("an email renders it, and still renders what is around it", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as Markdown, MarkdownContentType } from "./Server/Types/Markdown";',
        'export { default as MonitorTemplateUtil } from "./Server/Utils/Monitor/MonitorTemplateUtil";',
      ],
      String.raw`
        const inputs = { ...markdownInputs, ...templatedInputs(lib.MonitorTemplateUtil) };

        for (const [name, markdownOf] of Object.entries(inputs)) {
          const markdown = markdownOf();

          results[name] = await attempt(async () => {
            const html = await lib.Markdown.convertToHTML(
              markdown,
              lib.MarkdownContentType.Email,
            );

            return {
              "starts with the paragraph before": html.startsWith("<p>Before</p>"),
              "ends with the paragraph after": html.endsWith("<p>After</p>\n"),
              "keeps the text's start": html.includes("HEAD"),
              "keeps the text's end": html.includes("TAIL"),
              // Quote markers are not text; everything else is, escaped.
              "keeps all of the text": html.length > 0.9 * markdown.length,
            };
          });
        }
      `,
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results)).toHaveLength(11);
    expectEveryCheckPassed(report);
  }, 600000);

  test("plain text (SMS, push, calls, subjects) keeps it, and what is around it", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as Markdown } from "./Server/Types/Markdown";',
        'export { default as MonitorTemplateUtil } from "./Server/Utils/Monitor/MonitorTemplateUtil";',
      ],
      String.raw`
        const inputs = { ...markdownInputs, ...templatedInputs(lib.MonitorTemplateUtil) };

        for (const [name, markdownOf] of Object.entries(inputs)) {
          const markdown = markdownOf();

          results[name] = await attempt(() => {
            const text = lib.Markdown.convertToPlainText(markdown);

            return {
              "starts with the text before": text.startsWith("Before"),
              "ends with the text after": text.endsWith("After"),
              "keeps the text's start": text.includes("HEAD"),
              "keeps the text's end": text.includes("TAIL"),
            };
          });
        }
      `,
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results)).toHaveLength(11);
    expectEveryCheckPassed(report);
  }, 600000);

  test("Slack gets it as sections it accepts, cut short with a note", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as SlackUtil } from "./Server/Utils/Workspace/Slack/Slack";',
        'export { default as MonitorTemplateUtil } from "./Server/Utils/Monitor/MonitorTemplateUtil";',
      ],
      String.raw`
        const SlackUtil = lib.SlackUtil;
        const all = {
          ...markdownInputs,
          ...notPlainInputs,
          ...templatedInputs(lib.MonitorTemplateUtil),
        };
        const inputs = {};

        for (const name of [
          "a long line",
          "a long line of JSON",
          "a long run of link brackets",
          "a long paragraph of log lines",
          "a long table",
          "a templated response body",
        ]) {
          inputs[name] = all[name];
        }

        for (const [name, markdownOf] of Object.entries(inputs)) {
          const markdown = markdownOf();

          results["bot message: " + name] = await attempt(() => {
            const sections = SlackUtil.getMarkdownBlocks({
              payloadMarkdownBlock: {
                _type: "WorkspacePayloadMarkdown",
                text: markdown,
              },
            });
            const texts = sections.map((section) => section.text.text);

            return {
              "is at most as many sections as a block may take":
                sections.length >= 1 &&
                sections.length <= SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
              "has no section Slack would refuse": texts.every((text) => {
                return text.length <= SlackUtil.SECTION_TEXT_MAX_LENGTH;
              }),
              "starts with the text before": texts[0].startsWith("Before"),
              "ends with the note": texts[texts.length - 1].endsWith(
                SlackUtil.TRUNCATED_SECTION_NOTE,
              ),
            };
          });

          results["incoming webhook: " + name] = await attempt(() => {
            const text = SlackUtil.convertMarkdownToSlackRichText(markdown);

            return {
              "starts with the text before": text.startsWith("Before"),
              "is cut short": text.length < 1024 * 1024,
              "ends with the note": text.endsWith(SlackUtil.TRUNCATED_SECTION_NOTE),
            };
          });
        }
      `,
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results)).toHaveLength(12);
    expectEveryCheckPassed(report);
  }, 600000);

  test("Microsoft Teams gets it as a card and a text block it accepts, cut short with a note", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as MicrosoftTeamsUtil } from "./Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";',
        'export { default as MonitorTemplateUtil } from "./Server/Utils/Monitor/MonitorTemplateUtil";',
      ],
      String.raw`
        const MicrosoftTeamsUtil = lib.MicrosoftTeamsUtil;
        const all = {
          ...markdownInputs,
          ...notPlainInputs,
          ...templatedInputs(lib.MonitorTemplateUtil),
        };
        const inputs = {};

        for (const name of [
          "a long line",
          "a long line of JSON",
          "a long run of link brackets",
          "a long paragraph of log lines",
          "a long table",
          "a templated response body",
        ]) {
          inputs[name] = all[name];
        }

        for (const [name, markdownOf] of Object.entries(inputs)) {
          const markdown = markdownOf();

          results["incoming webhook card: " + name] = await attempt(() => {
            const card = MicrosoftTeamsUtil["buildMessageCardFromMarkdown"](markdown);
            const text = (card.sections && card.sections[0] && card.sections[0].text) || "";

            return {
              "is titled with the first line": card.title === "Before",
              "fits the budget, as Teams counts it": JSON.stringify(card).length * 2 <= 80 * 1024,
              "ends with the note": text.endsWith("_… (truncated — see OneUptime for the full text)_"),
            };
          });

          results["bot text block: " + name] = await attempt(() => {
            const block = MicrosoftTeamsUtil.getMarkdownBlock({
              payloadMarkdownBlock: {
                _type: "WorkspacePayloadMarkdown",
                text: markdown,
              },
            });

            return {
              "starts with the text before": block.text.startsWith("Before"),
              "fits the budget, as Teams counts it": JSON.stringify(block.text).length * 2 <= 80 * 1024,
              "ends with the note": block.text.endsWith("_… (truncated — see OneUptime for the full text)_"),
            };
          });
        }
      `,
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results)).toHaveLength(12);
    expectEveryCheckPassed(report);
  }, 600000);

  test("the dashboard renders it, and still renders what is around it", () => {
    /*
     * What MarkdownViewer does with a text: react-markdown with remark-gfm,
     * the held-back text put back by the viewer's rehype plugin, and the
     * viewer's urlTransform - rendered to HTML as a browser would get it.
     */
    const report: ProcessReport = runUnoptimized(
      [
        'export { holdBackForViewer, rehypePutBackHeldText } from "./UI/Components/Markdown.tsx/MarkdownViewerOverLongText";',
        'export { markdownUrlTransform } from "./UI/Components/Markdown.tsx/MarkdownUrlTransform";',
        'export { default as MonitorTemplateUtil } from "./Server/Utils/Monitor/MonitorTemplateUtil";',
      ],
      String.raw`
        const React = require("react");
        const { renderToStaticMarkup } = require("react-dom/server");
        const ReactMarkdown = require("react-markdown").default;
        const remarkGfm = require("remark-gfm").default;

        const renderAsViewer = (text) => {
          const heldBack = lib.holdBackForViewer(text);

          // These are held back enough to be read as Markdown.
          if (heldBack.showAsText) {
            throw new Error("The viewer would show this as text.");
          }

          return renderToStaticMarkup(
            React.createElement(
              ReactMarkdown,
              {
                remarkPlugins: [remarkGfm],
                rehypePlugins:
                  heldBack.held.length > 0
                    ? [[lib.rehypePutBackHeldText, { held: heldBack.held }]]
                    : undefined,
                urlTransform: lib.markdownUrlTransform,
              },
              heldBack.markdown,
            ),
          );
        };

        const inputs = { ...markdownInputs, ...templatedInputs(lib.MonitorTemplateUtil) };

        for (const [name, markdownOf] of Object.entries(inputs)) {
          const markdown = markdownOf();

          results[name] = await attempt(() => {
            const html = renderAsViewer(markdown);

            return {
              "starts with the paragraph before": html.startsWith("<p>Before</p>"),
              "ends with the paragraph after": html.endsWith("<p>After</p>"),
              "keeps the text's start": html.includes("HEAD"),
              "keeps the text's end": html.includes("TAIL"),
              "keeps all of the text": html.length > 0.9 * markdown.length,
            };
          });
        }
      `,
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results)).toHaveLength(11);
    expectEveryCheckPassed(report);
  }, 600000);

  test("an email, plain text and the dashboard show a long run of lines that are not plain as text", () => {
    /*
     * Nothing of these is held back - each line could be a table row, HTML
     * or code - so marked, and remark, would read all of it: marked ran out
     * of stack, and remark did not finish. The email sends the Markdown as
     * text, plain text keeps every line, and the dashboard shows the text as
     * it was written.
     */
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as Markdown, MarkdownContentType } from "./Server/Types/Markdown";',
        'export { holdBackForViewer } from "./UI/Components/Markdown.tsx/MarkdownViewerOverLongText";',
      ],
      String.raw`
        for (const [name, markdownOf] of Object.entries(notPlainInputs)) {
          const markdown = markdownOf();

          results["email: " + name] = await attempt(async () => {
            const html = await lib.Markdown.convertToHTML(
              markdown,
              lib.MarkdownContentType.Email,
            );

            return {
              "is the text, line by line": html.startsWith("<p>Before<br>\n<br>\n"),
              "ends with the text after": html.endsWith("<br>\nAfter</p>\n"),
              "keeps the text's start": html.includes("HEAD"),
              "keeps the text's end": html.includes("TAIL"),
              "keeps all of the text": html.length > markdown.length,
            };
          });

          results["plain text: " + name] = await attempt(() => {
            const text = lib.Markdown.convertToPlainText(markdown);

            return {
              "starts with the text before": text.startsWith("Before"),
              "ends with the text after": text.endsWith("After"),
              "keeps the text's start": text.includes("HEAD"),
              "keeps the text's end": text.includes("TAIL"),
            };
          });

          results["dashboard: " + name] = await attempt(() => {
            const heldBack = lib.holdBackForViewer(markdown);

            return {
              "is shown as text, not read as Markdown": heldBack.showAsText === true,
            };
          });
        }
      `,
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results)).toHaveLength(9);
    expectEveryCheckPassed(report);
  }, 600000);

  test("a feed line shows a plain text of two hundred thousand lines", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as FeedMarkdown } from "./Utils/Markdown/FeedMarkdown";',
      ],
      String.raw`
        const text = logLines("");

        results["a plain text of many lines"] = await attempt(() => {
          const markdown = lib.FeedMarkdown.multilineText(text).toString();

          return {
            "keeps the text's start": markdown.startsWith("HEAD"),
            "keeps the text's end": markdown.endsWith("TAIL"),
            "keeps every line": markdown.split("\n").length === text.split("\n").length,
          };
        });
      `,
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results)).toHaveLength(1);
    expectEveryCheckPassed(report);
  }, 600000);
});
