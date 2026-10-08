import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * marked as it is, except that a test can see what it was given, or make it
 * throw (its export cannot be spied on).
 */
jest.mock("marked", () => {
  const actual: typeof import("marked") = jest.requireActual(
    "marked",
  ) as typeof import("marked");

  return {
    ...actual,
    marked: (...args: Parameters<typeof actual.marked>): unknown => {
      mockMarkedState.calls.push(args[0]);

      if (mockMarkedState.failWith) {
        throw mockMarkedState.failWith;
      }

      return actual.marked(...args);
    },
  };
});

import { Renderer, marked } from "marked";
import Markdown, {
  EMAIL_IMAGE_STYLE,
  MAX_MARKED_EMAIL_MARKDOWN_LENGTH,
  MarkdownContentType,
} from "../../../Server/Types/Markdown";
import EmailInlineImages, {
  EmailHtmlWithInlineImages,
} from "../../../Server/Utils/Mail/EmailInlineImages";
import logger from "../../../Server/Utils/Logger";
import { OVER_LONG_LINE_LENGTH } from "../../../Utils/Markdown/OverLongText";

/*
 * EMAIL MARKDOWN OF ANY LENGTH.
 *
 * A description template that places a monitor's response body, or a log
 * pasted into a note, can be megabytes on one line or a paragraph of a
 * hundred thousand lines. marked reads a line, and a paragraph, with
 * regular expressions whose backtracking stack grows with the text, and ran
 * out of stack ("Maximum call stack size exceeded") on about three and a
 * half megabytes once V8 compiled them unoptimized - and the email was
 * never sent. Now the email renderer holds back from marked the middle of
 * every line over 64 KB and the plain lines of every run of lines over
 * 64 KB (Utils/Markdown/OverLongText), and writes them back, escaped, where
 * marked put the token.
 *
 * The promise these tests hold it to: text held back renders exactly as
 * marked would have rendered it, in every place Markdown can put text - so
 * a plain long line or run renders byte for byte as before - and text of at
 * most 64 KB is not touched at all. marked can still read the inputs here
 * (this process compiles regular expressions optimized, and they are a few
 * hundred kilobytes), so its own rendering is the expected one.
 * HugeTextInLongRunningProcess.test.ts renders sixteen megabytes where it
 * cannot.
 */

type RenderFunction = (markdown: string) => Promise<string>;

const render: RenderFunction = (markdown: string): Promise<string> => {
  return Markdown.convertToHTML(markdown, MarkdownContentType.Email);
};

// What marked makes of the Markdown with the email renderer, nothing held back.
const renderWithMarkedAlone: RenderFunction = async (
  markdown: string,
): Promise<string> => {
  // The renderer convertToHTML uses, raw HTML escaped as it sets it up.
  await render("");
  const renderer: Renderer = Markdown["getEmailRenderer"]();

  return await marked(markdown, { renderer: renderer });
};

/*
 * What the email renderer makes of one piece of Markdown, before an email
 * field is held to what an email carries (MarkdownEmailSizeCap.test.ts):
 * the last resort is a step of it.
 */
const renderOnePiece: RenderFunction = async (
  markdown: string,
): Promise<string> => {
  // The renderer set up as convertToHTML sets it up; that call is not counted.
  await render("");
  mockMarkedState.calls = [];

  return await Markdown["renderEmailMarkdown"](
    markdown,
    Markdown["getEmailRenderer"](),
  );
};

// Over 64 KB of plain words on one line, with no space at either end.
const LONG_WORDS: string = "word ".repeat(15000).trim();

// Over 64 KB of characters that are not a word: an address's path.
const LONG_PATH: string = "a".repeat(70000);

// Lines of a log, one after another: one run of lines over 64 KB.
const LOG_LINES: Array<string> = Array.from(
  { length: 2000 },
  (_: unknown, index: number) => {
    return `2026-10-08T10:00:${String(index % 60).padStart(2, "0")}Z INFO request ${index} served in 12 ms`;
  },
);

// What the stand-in for marked was given, and what it throws.
const mockMarkedState: { calls: Array<string>; failWith: Error | null } = {
  calls: [],
  failWith: null,
};

afterEach(() => {
  jest.restoreAllMocks();
  mockMarkedState.calls = [];
  mockMarkedState.failWith = null;
});

describe("Markdown email renderer - text longer than marked can read", () => {
  test("the inputs below are over 64 KB, so something is held back", () => {
    expect(LONG_WORDS.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
    expect(LONG_PATH.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
    expect(LOG_LINES.join("\n").length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
  });

  test.each([
    ["a paragraph", `Before\n\n${LONG_WORDS}\n\nAfter`],
    ["a heading", `# ${LONG_WORDS}`],
    ["a setext heading", `${LONG_WORDS}\n===`],
    ["a list item", `- first\n- ${LONG_WORDS}\n- last`],
    ["a numbered list item", `1. ${LONG_WORDS}`],
    ["a quote", `> ${LONG_WORDS}`],
    ["a list item in a quote", `> - ${LONG_WORDS}`],
    [
      "a table cell",
      `| Host | Body |\n| --- | --- |\n| web-01 | ${LONG_WORDS} |`,
    ],
    ["bold", `**${LONG_WORDS}**`],
    ["italic", `_${LONG_WORDS}_`],
    ["strikethrough", `~~${LONG_WORDS}~~`],
    ["a code span", `\`${LONG_WORDS}\``],
    ["a fenced code block", `\`\`\`\n${LONG_WORDS}\n\`\`\``],
    ["an indented code block", `    ${LONG_WORDS}`],
    ["a link's text", `[${LONG_WORDS}](https://example.com/report)`],
    ["a link's address", `[The report](https://example.com/${LONG_PATH})`],
    ["an image's alt text", `![${LONG_WORDS}](https://example.com/a.png)`],
    ["an image's address", `![Shot](https://example.com/${LONG_PATH}.png)`],
    ["an autolink", `<https://example.com/${LONG_PATH}>`],
    ["a bare address", `See https://example.com/${LONG_PATH} now`],
    ["raw HTML, which is escaped", `<div>${LONG_WORDS}</div>`],
    ["characters HTML escapes", `${"a < b & c > d \" e ' f ".repeat(4000)}end`],
    ["a paragraph of log lines", `Before\n\n${LOG_LINES.join("\n")}\n\nAfter`],
    [
      "a quote of log lines",
      LOG_LINES.map((line: string) => {
        return `> ${line}`;
      }).join("\n"),
    ],
    [
      "a nested quote of log lines",
      LOG_LINES.map((line: string) => {
        return `> > ${line}`;
      }).join("\n"),
    ],
    ["a code block of log lines", `\`\`\`\n${LOG_LINES.join("\n")}\n\`\`\``],
    ["a list item of log lines", `- ${LOG_LINES.join("\n")}`],
    [
      "log lines around a screenshot",
      `${LOG_LINES.join("\n")}\n![Login](https://example.com/login.png)\n${LOG_LINES.join("\n")}`,
    ],
    [
      "log lines around list items and a table",
      `${LOG_LINES.slice(0, 1000).join("\n")}\n- item\n${LOG_LINES.slice(0, 1000).join("\n")}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |`,
    ],
  ])(
    "renders exactly as marked alone does: %s",
    async (_label: string, markdown: string) => {
      const html: string = await render(markdown);
      const expected: string = await renderWithMarkedAlone(markdown);

      // A boolean, so a failure does not print hundreds of kilobytes.
      expect(html === expected).toBe(true);
    },
  );

  test("a long line keeps its own start and end Markdown, and shows the Markdown inside it as written", async () => {
    const markdown: string = `**Response:** ${LONG_WORDS} **bold** ${LONG_WORDS} _end_`;

    const html: string = await render(markdown);

    expect(html.startsWith("<p><strong>Response:</strong> word word")).toBe(
      true,
    );
    expect(html.endsWith("word <em>end</em></p>\n")).toBe(true);
    // The middle is shown as written: its bold is not drawn.
    expect(html.includes(" **bold** ")).toBe(true);
    expect(html.includes("<strong>bold</strong>")).toBe(false);
  });

  test("what is held back can never become markup", async () => {
    const markdown: string = `Before ${LONG_WORDS} <script>alert(1)</script> <img src=x onerror=alert(1)> ${LONG_WORDS}`;

    const html: string = await render(markdown);

    expect(html.includes("<script>")).toBe(false);
    expect(html.includes("<img")).toBe(false);
    expect(
      html.includes(
        "&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt;",
      ),
    ).toBe(true);
  });

  test("a link whose address is held back is still judged on the whole address", async () => {
    const html: string = await render(
      `[Open](javascript:${"void(0);".repeat(9000)}alert(1))`,
    );

    expect(html.includes("href=")).toBe(false);
    expect(html.startsWith("<p>Open</p>")).toBe(true);
  });

  test("Private Use Area characters already in the Markdown come through as they are", async () => {
    const text: string = "Odd \uE005 \uE006 \uE0050\uE006 text";

    const html: string = await render(
      `${text}\n\n${LONG_WORDS}\n\n\`${text}\``,
    );

    expect(html).toContain(`<p>${text}</p>`);
    expect(html).toContain(`>${text}</code>`);
    expect(html.includes(LONG_WORDS)).toBe(true);
  });

  test("line breaks written as \\r\\n are read as marked reads them", async () => {
    const markdown: string = `Before\r\n\r\n${LOG_LINES.join("\r\n")}\r\n\r\nAfter`;

    const html: string = await render(markdown);

    expect(html === (await renderWithMarkedAlone(markdown))).toBe(true);
  });

  test("Markdown of at most 64 KB goes to marked exactly as it was written", async () => {
    const markdown: string = `# Incident\n\n${"word ".repeat(12000)}\n\n- one\n- two\n\n\`\`\`\ncode\n\`\`\``;

    expect(markdown.length).toBeLessThanOrEqual(65536);

    await render(markdown);

    expect(mockMarkedState.calls).toHaveLength(1);
    expect(mockMarkedState.calls[0] === markdown).toBe(true);
  });
});

describe("Markdown email renderer - the last resort", () => {
  test("if marked still runs out of stack, the Markdown is sent as text, escaped, and logged", async () => {
    mockMarkedState.failWith = new RangeError(
      "Maximum call stack size exceeded",
    );
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    const html: string = await render(
      "# Disk full\n\n<b>web-01</b> & web-02\nare down",
    );

    expect(html).toBe(
      "<p># Disk full<br>\n<br>\n&lt;b&gt;web-01&lt;/b&gt; &amp; web-02<br>\nare down</p>\n",
    );
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]![0])).toContain(
      "could not be rendered, and is sent as text: Maximum call stack size exceeded",
    );
  });

  test("if marked still runs out of stack, a screenshot stays an image - attached as it is sent, never its base64 as text", async () => {
    mockMarkedState.failWith = new RangeError(
      "Maximum call stack size exceeded",
    );
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    // A real 1x1 PNG, as the probe reports a screenshot.
    const png: string =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const notAnImage: string = Buffer.from("not an image").toString("base64");

    const html: string = await render(
      `**Down** <b>\n\n![Screenshot of the page](data:image/png;base64,${png} "Shot")\n\nThen ![a file](data:text/plain;base64,${notAnImage}) and & more`,
    );

    expect(html).toBe(
      `<p>**Down** &lt;b&gt;<br>\n<br>\n<img src="data:image/png;base64,${png}" alt="Screenshot of the page" style="${EMAIL_IMAGE_STYLE}"><br>\n<br>\nThen a file and &amp; more</p>\n`,
    );

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.html.includes("base64")).toBe(false);
    expect(attached.html.includes(notAnImage)).toBe(false);
  });

  test("Markdown with more than a megabyte left once over-long text is held back is sent as text, and marked never reads it", async () => {
    const logged: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});
    /*
     * Table rows are not plain lines, and these cost marked little to read
     * (Utils/Markdown/SlowMarkdown): none of them is held back.
     */
    const rows: string = "| web-01 | down -> out & in |\n".repeat(
      Math.ceil(MAX_MARKED_EMAIL_MARKDOWN_LENGTH / 30) + 1,
    );

    const html: string = await renderOnePiece(`# Disk full\n\n${rows}\nAfter`);

    expect(mockMarkedState.calls).toHaveLength(0);
    // Booleans, so a failure does not print a megabyte.
    expect(
      html.startsWith(
        "<p># Disk full<br>\n<br>\n| web-01 | down -&gt; out &amp; in |<br>\n",
      ),
    ).toBe(true);
    expect(
      html.endsWith(
        "| web-01 | down -&gt; out &amp; in |<br>\n<br>\nAfter</p>\n",
      ),
    ).toBe(true);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]![0])).toContain(
      "is more than marked reads safely, and is sent as text",
    );
  });

  test("Markdown with exactly a megabyte left still goes to marked; one character more does not", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const lines: string = "a | b\n"
      .repeat(Math.ceil(MAX_MARKED_EMAIL_MARKDOWN_LENGTH / 6) + 1)
      .slice(0, MAX_MARKED_EMAIL_MARKDOWN_LENGTH);

    const html: string = await renderOnePiece(lines);

    expect(mockMarkedState.calls).toHaveLength(1);
    expect(mockMarkedState.calls[0] === lines).toBe(true);
    expect(html.startsWith("<p>a | b\na | b")).toBe(true);

    const text: string = await renderOnePiece(`${lines}a`);

    expect(mockMarkedState.calls).toHaveLength(0);
    expect(text.startsWith("<p>a | b<br>\na | b")).toBe(true);
  });

  test("Markdown that is long only for what is held back still goes to marked", async () => {
    const markdown: string = `# Disk full\n\n${"a".repeat(16 * 1024 * 1024)}\n\n${LOG_LINES.join("\n")}`;

    const html: string = await renderOnePiece(markdown);

    expect(mockMarkedState.calls).toHaveLength(1);
    expect(mockMarkedState.calls[0]!.length).toBeLessThan(16 * 1024);
    expect(html.startsWith("<h1")).toBe(true);
  });

  test("any other error from marked is not swallowed", async () => {
    mockMarkedState.failWith = new TypeError("not a rendering problem");

    await expect(render("Hello")).rejects.toThrow("not a rendering problem");
  });

  test("the docs and the blog are not touched: their errors are their own", async () => {
    mockMarkedState.failWith = new RangeError(
      "Maximum call stack size exceeded",
    );

    await expect(
      Markdown.convertToHTML("Hello", MarkdownContentType.Docs),
    ).rejects.toThrow("Maximum call stack size exceeded");
  });
});

describe("Markdown email renderer - Markdown of at most 64 KB", () => {
  /*
   * Seeded, so every run renders the same texts: pieces of every kind of
   * Markdown an email carries, put together at random, each text at most
   * 64 KB. With nothing in them long enough to hold back, each renders
   * exactly as marked alone renders it - as every email did before.
   */
  const PIECES: Array<string> = [
    "# Heading",
    "Plain text with **bold**, _italic_, ~~struck~~ and `code`.",
    "- item one\n- item two\n  - nested",
    "1. first\n2. second",
    "> quoted\n> more",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
    '```json\n{"a": 1}\n```',
    "[link](https://example.com/a?b=c&d=e)",
    '![image](https://example.com/i.png "title")',
    "<https://example.com/auto>",
    "<div>raw & html</div>",
    "a < b > c & d \" e ' f",
    "line with two spaces  \nnext line",
    "---",
    "2026-10-08T10:00:00Z INFO served",
    "[ref]\n\n[ref]: https://example.com/ref",
    "text with \\*escaped\\* stars",
    "Odd \uE005 and \uE006 characters",
    "word ".repeat(400),
  ];

  function makeRandom(seed: number): () => number {
    let state: number = seed >>> 0;

    return (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 4294967296;
    };
  }

  test("renders exactly as marked alone does, for 400 texts", async () => {
    const random: () => number = makeRandom(4559);

    for (let run: number = 0; run < 400; run++) {
      const pieces: Array<string> = [];
      const count: number = 1 + Math.floor(random() * 12);

      for (let index: number = 0; index < count; index++) {
        pieces.push(PIECES[Math.floor(random() * PIECES.length)]!);
      }

      const markdown: string = pieces.join(random() < 0.5 ? "\n\n" : "\n");

      expect(markdown.length).toBeLessThanOrEqual(65536);
      expect([run, await render(markdown)]).toEqual([
        run,
        await renderWithMarkedAlone(markdown),
      ]);
    }
  });
});
