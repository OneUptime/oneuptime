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
 *
 * And every converter reads text in time that grows with its length, never
 * with its square: 64 KB of each shape that a parser read in quadratic time
 * - emphasis, brackets or code spans that never close, a word of
 * punctuation, a long table or list, quotes nested thousands deep - took
 * marked, remark or slackify from seconds to over a minute here (see
 * Utils/Markdown/SlowMarkdown), and is held to a time budget now, so a
 * converter that slows down again fails here instead of stalling a worker.
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
   * code - so no line of them is held back as over-long: the run as a whole
   * is far more lines than a parser reads in good time.
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

  /*
   * 64 KB of each shape a parser read in time growing with its square, and
   * how long the slowest of marked, remark and slackify took on it here
   * before the converters held such text back.
   */
  const QUADRATIC_SIZE = 64 * 1024;

  const lines64 = (line) => {
    return line.repeat(Math.max(1, Math.floor(QUADRATIC_SIZE / line.length)));
  };

  const quadraticInputs = {
    // marked: 53 s. Emphasis that never closes.
    "star a space": () => repeatTo("*a ", QUADRATIC_SIZE),
    // remark: 9 s.
    "a star space": () => repeatTo("a* ", QUADRATIC_SIZE),
    // remark: 26 s.
    "a star": () => repeatTo("a*", QUADRATIC_SIZE),
    // marked: 14 s - an email address looked for from every "_".
    "underscore a": () => repeatTo("_a", QUADRATIC_SIZE),
    // marked: 6 s.
    "a bang": () => repeatTo("a!", QUADRATIC_SIZE),
    // remark: 14 s.
    "a tilde": () => repeatTo("a~", QUADRATIC_SIZE),
    // marked: 13 s, 20 s.
    "link openers": () => repeatTo("[a](", QUADRATIC_SIZE),
    "image openers": () => repeatTo("![a](", QUADRATIC_SIZE),
    // remark: 13 s; slackify: 26 s.
    "closing brackets": () => repeatTo("](", QUADRATIC_SIZE),
    "a closing bracket": () => repeatTo("a]", QUADRATIC_SIZE),
    // remark: over 40 s.
    "nested brackets": () =>
      "[".repeat(QUADRATIC_SIZE / 2) + "]".repeat(QUADRATIC_SIZE / 2),
    // marked: 3 s.
    "code span openers": () => repeatTo("\`a", QUADRATIC_SIZE),
    // remark: 8 s - an email address tried from every dot.
    "a dot": () => repeatTo("a.", QUADRATIC_SIZE),
    // remark with GFM: 0.9 s, quadratic.
    "snake_case words": () => repeatTo("foo_bar_baz ", QUADRATIC_SIZE),
    // slackify: 11 s each.
    "ampersand a": () => repeatTo("&a", QUADRATIC_SIZE),
    "a less than": () => repeatTo("a<", QUADRATIC_SIZE),
    "a backslash": () => repeatTo("a\\", QUADRATIC_SIZE),
    // remark: 6 s, 8 s; slackify: 10 s.
    "a long table": () => "| a | b |\n| --- | --- |\n" + lines64("| x | y |\n"),
    "many small tables": () => lines64("| a | b |\n| - | - |\n| c | d |\n\n"),
    "a long list": () => lines64("- a\n"),
    "a paragraph of lines": () => lines64("lorem ipsum dolor sit amet\n"),
    // Every parser ran out of stack.
    "quotes nested deep": () => repeatTo("> ", QUADRATIC_SIZE) + "a",
    "lists nested deep": () => {
      let text = "";
      for (let depth = 0; text.length < QUADRATIC_SIZE; depth++) {
        text += "  ".repeat(depth % 2000) + "- a\n";
      }
      return text;
    },
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
  let output: string;

  try {
    output = runProcess(entry, script);
  } catch (error) {
    /*
     * The error execFileSync throws refers to itself and carries all the
     * process wrote: a jest worker cannot send it back, and the suite would
     * fail with "Converting circular structure to JSON". Say what happened.
     */
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

function runProcess(entry: Array<string>, script: string): string {
  return childProcess.execFileSync(
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
  test("an email renders it, cut to what an email carries, with what is before it", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as Markdown, MarkdownContentType } from "./Server/Types/Markdown";',
        'export { default as MonitorTemplateUtil } from "./Server/Utils/Monitor/MonitorTemplateUtil";',
        'export { default as EmailSize, EMAIL_TRUNCATED_TEXT_NOTE_HTML, MAX_EMAIL_FIELD_HTML_BYTES } from "./Server/Utils/Mail/EmailSize";',
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
            const size = lib.EmailSize.getFieldSizeInBytes(html);
            // Spaces show as nothing, so there is nothing of them to keep.
            const isBlank = name === "a long run of spaces";

            return {
              "starts with the paragraph before": html.startsWith("<p>Before</p>"),
              "keeps the text's start": html.includes("HEAD"),
              "is cut, ending with the note": html.endsWith(lib.EMAIL_TRUNCATED_TEXT_NOTE_HTML),
              "is within what an email field carries": size <= lib.MAX_EMAIL_FIELD_HTML_BYTES,
              ...(isBlank
                ? {}
                : { "keeps most of what fits": size > lib.MAX_EMAIL_FIELD_HTML_BYTES / 4 }),
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

  test("an email, plain text and the dashboard show a long run of lines that are not plain", () => {
    /*
     * Nothing of these is held back as over-long - each line could be a
     * table row, HTML or code - so marked, and remark, would read all of
     * it: marked ran out of stack, and remark did not finish. The email
     * carries what an email field carries of it, cut with the note; plain
     * text keeps every line; and the dashboard holds the run back whole
     * (it is far more lines than remark reads in good time) and shows it as
     * it was written.
     */
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as Markdown, MarkdownContentType } from "./Server/Types/Markdown";',
        'export { holdBackForViewer } from "./UI/Components/Markdown.tsx/MarkdownViewerOverLongText";',
        'export { default as EmailSize, EMAIL_TRUNCATED_TEXT_NOTE_HTML, MAX_EMAIL_FIELD_HTML_BYTES } from "./Server/Utils/Mail/EmailSize";',
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
              "starts with the text before": html.startsWith("<p>Before</p>"),
              "keeps the text's start": html.includes("HEAD"),
              "is cut, ending with the note": html.endsWith(lib.EMAIL_TRUNCATED_TEXT_NOTE_HTML),
              "is within what an email field carries":
                lib.EmailSize.getFieldSizeInBytes(html) <= lib.MAX_EMAIL_FIELD_HTML_BYTES,
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
              "is held back whole, to be shown as written": heldBack.heldLines.length === 1,
              "leaves the parser next to nothing": heldBack.markdown.length < 1024,
            };
          });
        }
      `,
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results)).toHaveLength(9);
    expectEveryCheckPassed(report);
  }, 600000);

  /*
   * The most a converter may take on 64 KB of any one shape: the slowest
   * takes about a tenth of that on a developer's machine, and each took
   * from seconds to over a minute before.
   */
  const QUADRATIC_BUDGET_IN_MS: number = 2000;

  // Runs each shape through `convert`, timed; the time is in the check's name.
  const TIMED_SCRIPT: (convert: string) => string = (
    convert: string,
  ): string => {
    return (
      String.raw`
        const convert = ` +
      convert +
      String.raw`;

        // Loaded and compiled once, as in a server.
        await convert("warm *up* [a](https://a.b) | a |");

        for (const [name, markdownOf] of Object.entries(quadraticInputs)) {
          const markdown = markdownOf();
          const started = process.hrtime.bigint();

          results[name] = await attempt(async () => {
            await convert(markdown);
            const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);

            return { ["in under " + ` +
      String(QUADRATIC_BUDGET_IN_MS) +
      String.raw` + " ms (took " + ms + " ms)"]: ms < ` +
      String(QUADRATIC_BUDGET_IN_MS) +
      String.raw` };
          });
        }
      `
    );
  };

  test("an email and plain text read 64 KB of every shape that was slow in good time", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as Markdown, MarkdownContentType } from "./Server/Types/Markdown";',
      ],
      TIMED_SCRIPT(
        String.raw`async (markdown) => {
          await lib.Markdown.convertToHTML(markdown, lib.MarkdownContentType.Email);
          lib.Markdown.convertToPlainText(markdown);
        }`,
      ),
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results).length).toBeGreaterThan(20);
    expectEveryCheckPassed(report);
  }, 600000);

  test("the dashboard reads 64 KB of every shape that was slow in good time", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { holdBackForViewer, rehypePutBackHeldText } from "./UI/Components/Markdown.tsx/MarkdownViewerOverLongText";',
        'export { markdownUrlTransform } from "./UI/Components/Markdown.tsx/MarkdownUrlTransform";',
      ],
      String.raw`
        const React = require("react");
        const { renderToStaticMarkup } = require("react-dom/server");
        const ReactMarkdown = require("react-markdown").default;
        const remarkGfm = require("remark-gfm").default;
      ` +
        TIMED_SCRIPT(
          String.raw`async (markdown) => {
            const heldBack = lib.holdBackForViewer(markdown);

            if (heldBack.showAsText) {
              return;
            }

            renderToStaticMarkup(
              React.createElement(
                ReactMarkdown,
                {
                  remarkPlugins: [remarkGfm],
                  rehypePlugins:
                    heldBack.held.length > 0
                      ? [[lib.rehypePutBackHeldText, { held: heldBack.held, heldLines: heldBack.heldLines }]]
                      : undefined,
                  urlTransform: lib.markdownUrlTransform,
                },
                heldBack.markdown,
              ),
            );
          }`,
        ),
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results).length).toBeGreaterThan(20);
    expectEveryCheckPassed(report);
  }, 600000);

  test("Slack and Microsoft Teams read 64 KB of every shape that was slow in good time", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as SlackUtil } from "./Server/Utils/Workspace/Slack/Slack";',
        'export { default as MicrosoftTeamsUtil } from "./Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";',
      ],
      TIMED_SCRIPT(
        String.raw`async (markdown) => {
          const payloadMarkdownBlock = { _type: "WorkspacePayloadMarkdown", text: markdown };

          lib.SlackUtil.getMarkdownBlocks({ payloadMarkdownBlock });
          lib.SlackUtil.convertMarkdownToSlackRichText(markdown);
          lib.MicrosoftTeamsUtil["buildMessageCardFromMarkdown"](markdown);
          lib.MicrosoftTeamsUtil.getMarkdownBlock({ payloadMarkdownBlock });
        }`,
      ),
    );

    expectUnoptimizedProcess(report);
    expect(Object.keys(report.results).length).toBeGreaterThan(20);
    expectEveryCheckPassed(report);
  }, 600000);

  test("Slack converts an address with a % that starts no escape, as remark-gfm reads it", () => {
    const report: ProcessReport = runUnoptimized(
      [
        'export { default as SlackUtil } from "./Server/Utils/Workspace/Slack/Slack";',
      ],
      String.raw`
        for (const [name, markdown, expected] of [
          ["a bare address", "see www.example.com/%zz now", "<http://www.example.com/%25zz|www.example.com/%zz>"],
          ["a link", "[log](https://example.com/a%zz)", "<https://example.com/a%25zz|log>"],
          ["half an emoji", "cut \uD83D www.example.com/\uD83D", "\uFFFD"],
        ]) {
          results[name] = await attempt(() => {
            const text = lib.SlackUtil.slackify(markdown);

            return { "converts, the address whole": text.includes(expected) };
          });
        }
      `,
    );

    expect(Object.keys(report.results)).toHaveLength(3);
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
