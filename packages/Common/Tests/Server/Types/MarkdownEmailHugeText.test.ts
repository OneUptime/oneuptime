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
import { FastestRun, fastestRunAsync } from "../../Helpers/FastestRun";
import { seededRandom } from "../../Helpers/SeededRandom";

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

/*
 * ISSUE #7229: A LINK ACROSS THE START OF AN OVER-LONG LINE'S MIDDLE.
 *
 * A link, an image or a link reference definition whose address is longer
 * than an over-long line's kept start (1 KB), with a title that takes the
 * line over 64 KB - a signed URL or a dashboard link with a long query,
 * and an error message or a log for its title. The middle of the line was
 * held back from marked in one piece, from the address to the title, and
 * marked read no link: the email showed "[Run](" as text, then a link to
 * the address, the space, the quote and the whole title, percent-encoded.
 * Now the rest of the address and the rest of the title are held back
 * apart, what parts them stays in view, and each renders as marked alone
 * renders it.
 */
describe("Markdown email renderer - a link across the start of an over-long line's middle (#7229)", () => {
  // The issue's title: 68 KB, so each of its rows is a line of about 70 KB.
  const TITLE: string = "Checkout failed. ".repeat(4000);
  const ADDRESS: string = `https://example.com/${"a".repeat(2000)}`;
  const WORDS: string = "lorem ipsum ".repeat(6000).trim();

  test.each([
    ["the issue's link with its title", `[Run](${ADDRESS} "${TITLE}")`],
    ["the issue's image with its title", `![Shot](${ADDRESS}.png "${TITLE}")`],
    [
      "the issue's reference, its definition with the title",
      `[Run][s]\n\n[s]: ${ADDRESS} "${TITLE}"`,
    ],
    [
      "the issue's 500-character row",
      `[Run](https://example.com/${"a".repeat(500)} "${TITLE}")`,
    ],
    [
      "an address of more than 64 KB with a title",
      `[Run](https://example.com/${"a".repeat(70000)} "${TITLE}")`,
    ],
    [
      "an address of more than 64 KB, in a definition with a title",
      `![Shot][s]\n\n[s]: https://example.com/${"a".repeat(70000)}.png "${TITLE}"`,
    ],
    ["an address in angle brackets", `[Run](<${ADDRESS}> "${TITLE}")`],
    ["a title in single quotes", `[Run](${ADDRESS} '${TITLE}')`],
    ["a title in parentheses", `[Run](${ADDRESS} (${TITLE}))`],
    ["a definition in a quote", `[Run][s]\n\n> [s]: ${ADDRESS} "${TITLE}"`],
    ["a definition in a list item", `[Run][s]\n\n- [s]: ${ADDRESS} "${TITLE}"`],
    [
      "a link in a list item, in a quote",
      `> - See [Run](${ADDRESS} "${TITLE}")`,
    ],
    ["a link that ends in the middle", `[Run](${ADDRESS}), then ${WORDS}`],
    [
      "a title that ends in the middle",
      `[Run](${ADDRESS} "Checkout failed") and then ${WORDS}`,
    ],
    [
      "a title the cut is inside of",
      `[Run](https://example.com/x "${"Checkout failed. ".repeat(200)}") then ${WORDS}`,
    ],
    ["a bare address, then a period", `See ${ADDRESS}. Then ${WORDS}`],
    ["a bare address in parentheses", `(see ${ADDRESS}) then ${WORDS}`],
    ["an autolink", `See <${ADDRESS}> and ${WORDS}`],
  ])(
    "renders exactly as marked alone does: %s",
    async (_label: string, markdown: string) => {
      const html: string = await render(markdown);
      const expected: string = await renderWithMarkedAlone(markdown);

      expect(markdown.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
      // A boolean, so a failure does not print hundreds of kilobytes.
      expect(html === expected).toBe(true);
    },
  );

  test("the issue's rows: a link and an image to the address, with the title - and no address holds the title", async () => {
    const link: string = await render(`[Run](${ADDRESS} "${TITLE}")`);
    const image: string = await render(`![Shot](${ADDRESS}.png "${TITLE}")`);
    const reference: string = await render(
      `[Run][s]\n\n[s]: ${ADDRESS} "${TITLE}"`,
    );

    expect(link).toBe(`<p><a href="${ADDRESS}" title="${TITLE}">Run</a></p>\n`);
    expect(
      image.startsWith(
        `<p><img src="${ADDRESS}.png" alt="Shot" title="${TITLE}"`,
      ),
    ).toBe(true);
    expect(reference).toBe(
      `<p><a href="${ADDRESS}" title="${TITLE}">Run</a></p>\n`,
    );

    for (const html of [link, image, reference]) {
      expect(html).not.toContain("%20%22Checkout");
      expect(html).not.toContain("[Run](");
      expect(html).not.toContain("![Shot](");
    }
  });

  test("a megabyte line of such links renders in time in line with its length: the first a link with its title, the rest as written", async () => {
    const title: string = "Checkout failed: the payment step timed out";
    const link: string = `[Run](${ADDRESS} "${title}") `;
    const markdown: string = link.repeat(
      Math.ceil((1024 * 1024) / link.length),
    );
    let html: string = "";

    const run: FastestRun<string> = await fastestRunAsync({
      run: async (): Promise<string> => {
        html = await render(markdown);

        return html;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(
      html.startsWith(
        `<p><a href="${ADDRESS}" title="${title}">Run</a> [Run](${ADDRESS} &quot;${title}&quot;) `,
      ),
    ).toBe(true);
    /*
     * One link: the rest of the line is its middle, shown as written - and
     * the field is cut to fit before the line's last link.
     */
    expect(html.split("<a ")).toHaveLength(2);
    expect(html).not.toContain("%20");
  });
});

/*
 * The other end of an over-long line's middle: a link or an image whose
 * address is longer than the line's kept end (1 KB), at the end of a long
 * line - a dashboard link with a long query after a log. Its "[text](" was
 * held back with the middle, and the email showed "[Run](https://..." as
 * text. Now its "[" and "](" stay in view and each renders as marked alone
 * renders it.
 */
describe("Markdown email renderer - a link across the end of an over-long line's middle (#7229)", () => {
  const ADDRESS: string = `https://example.com/${"a".repeat(2000)}`;
  const QUERY: string = `https://grafana.example.com/d/abc/checkout?${Array.from(
    { length: 200 },
    (_: unknown, index: number): string => {
      return `k${index}=v${index}`;
    },
  ).join("&")}`;
  const WORDS: string = "lorem ipsum ".repeat(6000).trim();

  test.each([
    ["a link", `${WORDS} see [Run](${ADDRESS}) now`],
    ["a link with a title", `${WORDS} see [Run](${ADDRESS} "Checkout failed")`],
    ["an image", `${WORDS} ![Shot](${ADDRESS}.png)`],
    ["an image with a title", `${WORDS} ![Shot](${ADDRESS}.png "Home page")`],
    [
      "a dashboard link with a long query",
      `${WORDS} see [the dashboard](${QUERY}) for the run.`,
    ],
    [
      "an address in angle brackets",
      `${WORDS} see [Run](<${ADDRESS}> "t") now`,
    ],
    ["an autolink", `${WORDS} see <${ADDRESS}> now`],
    [
      "a link's text with emphasis",
      `${WORDS} see [**Run 42**](${ADDRESS}) now`,
    ],
    [
      "a title the middle ends inside of",
      `${WORDS} see [Run](https://example.com/x "${"Checkout failed. ".repeat(100)}") now`,
    ],
    [
      "a link across each end",
      `[Run](${ADDRESS} "Checkout failed") ${WORDS} see [Again](${ADDRESS}) now`,
    ],
    ["a link in a list item, in a quote", `> - ${WORDS} see [Run](${ADDRESS})`],
  ])(
    "renders exactly as marked alone does: %s",
    async (_label: string, markdown: string) => {
      const html: string = await render(markdown);
      const expected: string = await renderWithMarkedAlone(markdown);

      expect(markdown.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
      // A boolean, so a failure does not print hundreds of kilobytes.
      expect(html === expected).toBe(true);
    },
  );

  test("a link, an image and a query link at a long line's end: each to its whole address, and none of their Markdown is shown", async () => {
    const link: string = await render(`${WORDS} see [Run](${ADDRESS}) now`);
    const image: string = await render(`${WORDS} ![Shot](${ADDRESS}.png)`);
    const query: string = await render(
      `${WORDS} see [the dashboard](${QUERY}) for the run.`,
    );

    expect(link.endsWith(` see <a href="${ADDRESS}">Run</a> now</p>\n`)).toBe(
      true,
    );
    expect(image).toContain(`<img src="${ADDRESS}.png" alt="Shot"`);
    expect(query).toContain(
      `<a href="${QUERY.split("&").join("&amp;")}">the dashboard</a> for the run.`,
    );

    for (const html of [link, image, query]) {
      expect(html).not.toContain("[Run](");
      expect(html).not.toContain("![Shot](");
      expect(html).not.toContain("[the dashboard](");
    }
  });

  test("a link at a long line's end is a link even after white space too long to keep before an earlier link's ')'", async () => {
    const html: string = await render(
      `[Run](${ADDRESS}${" ".repeat(64)}) ${WORDS} see [Again](${ADDRESS}) now`,
    );

    expect(html.endsWith(` see <a href="${ADDRESS}">Again</a> now</p>\n`)).toBe(
      true,
    );
    expect(html).not.toContain("[Again](");
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

  test("if marked still runs out of stack, a screenshot defined once is an image where its definition was - never its base64 as text - and its references are text (#6962)", async () => {
    mockMarkedState.failWith = new RangeError(
      "Maximum call stack size exceeded",
    );
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    // A real 1x1 PNG, as the probe reports a screenshot.
    const png: string =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const notAnImage: string = Buffer.from("not an image").toString("base64");

    const html: string = await render(
      [
        "**Down**: ![Home][home] & ![Home, again][HOME]",
        "",
        `[home]: data:image/png;base64,${png} "Shot"`,
        "[runs]: https://example.com/runs",
        `[file]: <data:text/plain;base64,${notAnImage}>`,
        "[query]: https://example.com/?q=;base64,QUJD",
      ].join("\n"),
    );

    /*
     * The screenshot's definition is its image, its label for alt text; the
     * definition of data that is no image, its label. Definitions of other
     * addresses are text, as every line is - one whose query says
     * ";base64," too.
     */
    expect(html).toBe(
      `<p>**Down**: ![Home][home] &amp; ![Home, again][HOME]<br>\n<br>\n<img src="data:image/png;base64,${png}" alt="home" style="${EMAIL_IMAGE_STYLE}"><br>\n[runs]: https://example.com/runs<br>\nfile<br>\n[query]: https://example.com/?q=;base64,QUJD</p>\n`,
    );

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.html.includes(png)).toBe(false);
    expect(attached.html.includes(notAnImage)).toBe(false);
  });

  test("if marked still runs out of stack, a screenshot defined in a block quote or a list item is an image where its definition was, its label as marked reads it there for alt text (#7230)", async () => {
    mockMarkedState.failWith = new RangeError(
      "Maximum call stack size exceeded",
    );
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    // A real 1x1 PNG, as the probe reports a screenshot.
    const png: string =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const html: string = await render(
      [
        "**Down**: ![Home][home page] ![Login][login]",
        "",
        "> [Home",
        `> Page]: data:image/png;base64,${png}`,
        "",
        "- Screenshot",
        "",
        `    [login]: data:image/png;base64,${png}`,
      ].join("\n"),
    );

    /*
     * Each definition is its image, from its line's start - the quote's
     * markers and the item's indentation too - and its label without the
     * quote's marker on the line it runs over.
     */
    expect(html).toBe(
      `<p>**Down**: ![Home][home page] ![Login][login]<br>\n<br>\n<img src="data:image/png;base64,${png}" alt="Home\nPage" style="${EMAIL_IMAGE_STYLE}"><br>\n<br>\n- Screenshot<br>\n<br>\n<img src="data:image/png;base64,${png}" alt="login" style="${EMAIL_IMAGE_STYLE}"></p>\n`,
    );

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.html.includes(png)).toBe(false);
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

  test("renders exactly as marked alone does, for 400 texts", async () => {
    const random: () => number = seededRandom(4559);

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
