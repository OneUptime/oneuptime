import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { Links, Renderer, marked } from "marked";
import Markdown, {
  EMAIL_IMAGE_STYLE,
  MarkdownContentType,
} from "../../../Server/Types/Markdown";
import EmailInlineImages, {
  EmailHtmlWithInlineImages,
} from "../../../Server/Utils/Mail/EmailInlineImages";
import EmailSize, {
  EMAIL_TRUNCATED_TEXT_NOTE_HTML,
  MAX_EMAIL_FIELD_HTML_BYTES,
} from "../../../Server/Utils/Mail/EmailSize";
import logger from "../../../Server/Utils/Logger";
import { getBase64Runs } from "../../../Utils/Markdown/Base64Data";
import {
  LinkReferenceDefinition,
  getLinkReferenceDefinitions,
} from "../../../Utils/Markdown/LinkReferenceDefinitions";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  MarkedReferences,
  isDefined,
  readMarkedReferences,
} from "../../Helpers/MarkedLinks";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * AN EMAIL FIELD IS NEVER MORE HTML THAN AN EMAIL CARRIES.
 *
 * A description, a note or a root cause can be megabytes - a response body
 * or a log a template placed - and a table's HTML is many times its
 * Markdown. A mail server refuses a message over its limit, and the email
 * is lost. So each Markdown field of an email renders to at most
 * MAX_EMAIL_FIELD_HTML_BYTES of HTML, measured as it is sent (its inline
 * images as the attachments they go out as): a field over it is cut and
 * ends with EMAIL_TRUNCATED_TEXT_NOTE_HTML. A field that fits renders
 * exactly as it always has. A field cut keeps the link reference
 * definitions its kept references need (#6963, below).
 */

const render: (markdown: string) => Promise<string> = (
  markdown: string,
): Promise<string> => {
  return Markdown.convertToHTML(markdown, MarkdownContentType.Email);
};

const renderWithMarkedAlone: (markdown: string) => Promise<string> = async (
  markdown: string,
): Promise<string> => {
  await render("");
  const renderer: Renderer = Markdown["getEmailRenderer"]();

  return await marked(markdown, { renderer: renderer });
};

// A PNG of about `bytes` bytes: its signature, then filler.
function png(bytes: number): string {
  const buffer: Buffer = Buffer.alloc(Math.ceil(bytes / 3) * 3, 1);

  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach(
    (byte: number, index: number): void => {
      buffer[index] = byte;
    },
  );

  return buffer.toString("base64");
}

// A real 1x1 PNG, as the probe reports a screenshot: too short to weigh nothing.
const ONE_PIXEL_PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// How many times `part` is in `text`.
function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Markdown email field - held to what an email carries", () => {
  test("a field that fits renders exactly as marked renders it", async () => {
    const markdown: string = `# Incident\n\n${"Some **bold** text and a [link](https://example.com).\n\n".repeat(500)}| Host | State |\n| --- | --- |\n${"| web-01 | down |\n".repeat(200)}`;

    const html: string = await render(markdown);

    expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThanOrEqual(
      MAX_EMAIL_FIELD_HTML_BYTES,
    );
    expect(html === (await renderWithMarkedAlone(markdown))).toBe(true);
  });

  test("a table whose HTML is over the budget is cut, ends with the note, and logs", async () => {
    const warned: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});
    const markdown: string = `| Host | State | Latency |\n| --- | --- | --- |\n${"| web-01 | down | 12 ms |\n".repeat(20000)}`;

    // The Markdown is under the budget; its HTML is far over it.
    expect(markdown.length).toBeLessThan(MAX_EMAIL_FIELD_HTML_BYTES * 2);
    expect((await renderWithMarkedAlone(markdown)).length).toBeGreaterThan(
      4 * MAX_EMAIL_FIELD_HTML_BYTES,
    );

    const html: string = await render(markdown);

    expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThanOrEqual(
      MAX_EMAIL_FIELD_HTML_BYTES,
    );
    expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
    // Most of what fits is kept: the cut is in proportion, with a margin.
    expect(EmailSize.getFieldSizeInBytes(html)).toBeGreaterThan(
      MAX_EMAIL_FIELD_HTML_BYTES / 2,
    );
    expect(html.startsWith("<table")).toBe(true);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(String(warned.mock.calls[0]![0])).toContain(
      "renders to more HTML than an email carries, and was cut to fit",
    );
  });

  test("sixteen megabytes of a log are cut to the budget, the start kept", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const markdown: string = `**Response:**\n\n${"2026-10-08T10:00:00Z INFO request served\n".repeat(400000)}`;

    const html: string = await render(markdown);

    expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThanOrEqual(
      MAX_EMAIL_FIELD_HTML_BYTES,
    );
    expect(html.startsWith("<p><strong>Response:</strong></p>")).toBe(true);
    expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
  });

  test("text in a script of three bytes a character is held to the budget in bytes", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const html: string = await render(
      `障害 ${"障害が発生しました。".repeat(20000)}`,
    );

    expect(EmailSize.getHtmlSizeInBytes(html)).toBeLessThanOrEqual(
      MAX_EMAIL_FIELD_HTML_BYTES,
    );
    expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
  });

  test("a screenshot does not count: it goes out as an attachment", async () => {
    const data: string = png(3 * 1024 * 1024);
    const markdown: string = `The page:\n\n![Screenshot](data:image/png;base64,${data})`;

    const html: string = await render(markdown);

    expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(false);
    expect(html.includes(data)).toBe(true);
    expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThan(1024);
  });

  test("a field cut before a screenshot leaves the screenshot out whole, never its base64 as text", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const data: string = png(30000);
    const markdown: string = `${"word ".repeat(80000)}\n\n![Screenshot](data:image/png;base64,${data})\n\nAfter`;

    const html: string = await render(markdown);

    expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
    expect(html.includes("base64")).toBe(false);
    expect(html.includes("![")).toBe(false);
  });
});

describe("Markdown.cutEmailMarkdown", () => {
  test("Markdown within the weight is returned as it is", () => {
    expect(Markdown.cutEmailMarkdown("abc\ndef", 7)).toBe("abc\ndef");
  });

  test("cuts at the last line break in the second half of what fits", () => {
    expect(Markdown.cutEmailMarkdown("aaaa\nbbbb\ncccc", 12)).toBe(
      "aaaa\nbbbb",
    );
    // No line break in the second half: between characters.
    expect(Markdown.cutEmailMarkdown("a\nbbbbbbbbbbbbbb", 10)).toBe(
      "a\nbbbbbbbb",
    );
  });

  test("never between the halves of an emoji", () => {
    expect(Markdown.cutEmailMarkdown("😀😀😀", 3)).toBe("😀");
  });

  test("an inline image's data weighs nothing: an image before the cut stays whole", () => {
    const data: string = png(30000);
    const image: string = `![Shot](data:image/png;base64,${data})`;
    const markdown: string = `aaaa\n${image}\nbbbb\ncccc`;

    // "aaaa\n", the image's 31 characters around its data, "\nbbbb\n".
    expect(Markdown.cutEmailMarkdown(markdown, 46)).toBe(markdown);
    expect(Markdown.cutEmailMarkdown(markdown, 42)).toBe(
      `aaaa\n${image}\nbbbb`,
    );
  });

  test('an image the cut would split is left out, from its "!["', () => {
    const data: string = png(30000);
    const markdown: string = `${"a".repeat(100)} ![Shot](data:image/png;base64,${data} "A title") after`;

    // The cut falls inside the image's alt text and address.
    for (const weight of [103, 108, 115, 140]) {
      expect([weight, Markdown.cutEmailMarkdown(markdown, weight)]).toEqual([
        weight,
        "a".repeat(100),
      ]);
    }
  });
});

/*
 * ISSUE #6963: A FIELD CUT TO FIT KEEPS THE DEFINITIONS ITS KEPT REFERENCES
 * NEED.
 *
 * marked reads a link reference definition wherever it is, and a
 * description most often defines its screenshot once, at its end. A field
 * cut to fit kept "![Home][home]" at its start and dropped
 * "[home]: data:image/jpeg;base64,..." at its end, so the email showed
 * "![Home][home]" as text and attached no image. Now each definition of a
 * label the kept part refers to - in any case, as "![alt][label]",
 * "[text][label]", "[label][]" or "[label]" - comes along, before the kept
 * part with a blank line between, within the weight the field is cut to.
 */
describe("Markdown.cutEmailMarkdown - the definitions its kept references need (#6963)", () => {
  const X: string = "x".repeat(50);
  const Y: string = "y".repeat(50);

  test("a kept reference's definition comes along, before the kept part, a blank line between", async () => {
    const markdown: string = [
      "![Home][home]",
      X,
      Y,
      "",
      "[home]: https://example.com/home.png",
    ].join("\n");

    /*
     * Cut at 115 the kept part leaves no room for the definition's 37
     * characters and blank line: it is cut again, at the last line break
     * before 120 - 39.
     */
    const cut: string = Markdown.cutEmailMarkdown(markdown, 120);

    expect(cut).toBe(
      `[home]: https://example.com/home.png\n\n![Home][home]\n${X}`,
    );
    expect(await render(cut)).toBe(
      `<p><img src="https://example.com/home.png" alt="Home" style="${EMAIL_IMAGE_STYLE}">\n${X}</p>\n`,
    );
  });

  test("a definition only the part cut off refers to does not come along", () => {
    const markdown: string = [
      "![Home][home]",
      X,
      Y,
      "![Login][login]",
      "",
      "[home]: https://example.com/home.png",
      "[login]: https://example.com/login.png",
    ].join("\n");

    expect(Markdown.cutEmailMarkdown(markdown, 120)).toBe(
      `[home]: https://example.com/home.png\n\n![Home][home]\n${X}`,
    );
  });

  test("labels match whatever their case, and collapsed and shortcut references find theirs: the definitions in the order of the text, and none no reference uses", async () => {
    const markdown: string = [
      "![Shot][HOME] [Status][] [runs]",
      "x".repeat(60),
      "y".repeat(60),
      "z".repeat(200),
      "",
      "[unused]: https://example.com/unused",
      "[Runs]: https://example.com/runs",
      "[home]: https://example.com/home.png",
      "[STATUS]: https://status.example.com",
    ].join("\n");

    const cut: string = Markdown.cutEmailMarkdown(markdown, 240);

    expect(cut).toBe(
      [
        "[Runs]: https://example.com/runs",
        "[home]: https://example.com/home.png",
        "[STATUS]: https://status.example.com",
        "",
        "![Shot][HOME] [Status][] [runs]",
        "x".repeat(60),
      ].join("\n"),
    );
    expect(await render(cut)).toBe(
      `<p><img src="https://example.com/home.png" alt="Shot" style="${EMAIL_IMAGE_STYLE}"> <a href="https://status.example.com">Status</a> <a href="https://example.com/runs">runs</a>\n${"x".repeat(60)}</p>\n`,
    );
  });

  test("a label the kept part defines brings nothing along; of two cut-off definitions of a label, the first comes, as marked reads the first", async () => {
    const markdown: string = [
      "[home]: https://example.com/home.png",
      "",
      "![Home][home] [Status][status]",
      "x".repeat(60),
      "y".repeat(60),
      "z".repeat(200),
      "",
      "[home]: https://example.com/other.png",
      "[Status]: https://status.example.com/first",
      "[STATUS]: https://status.example.com/second",
    ].join("\n");

    const cut: string = Markdown.cutEmailMarkdown(markdown, 240);

    expect(cut).toBe(
      [
        "[Status]: https://status.example.com/first",
        "",
        "[home]: https://example.com/home.png",
        "",
        "![Home][home] [Status][status]",
        "x".repeat(60),
        "y".repeat(60),
      ].join("\n"),
    );
    expect(await render(cut)).toBe(
      `<p><img src="https://example.com/home.png" alt="Home" style="${EMAIL_IMAGE_STYLE}"> <a href="https://status.example.com/first">Status</a>\n${"x".repeat(60)}\n${"y".repeat(60)}</p>\n`,
    );
  });

  test("a definition the cut would split is cut off whole - its references never link to half its address - and one too heavy to come comes empty: its references are their text, never Markdown", async () => {
    const markdown: string = `![Home][home] [Open it][home]\n\n[home]: https://example.com/${"a".repeat(200)}`;

    const cut: string = Markdown.cutEmailMarkdown(markdown, 100);

    expect(cut).toBe("[home]: <>\n\n![Home][home] [Open it][home]");
    expect(await render(cut)).toBe("<p>Home Open it</p>\n");
  });

  test.each([
    [
      160,
      '[home]: https://example.com/home.png "The home page, as the run left it"',
      60,
    ],
    [140, "[home]: https://example.com/home.png", 56],
  ])(
    "a definition comes whole where it fits, else without its title - cut to %i",
    (weight: number, definition: string, kept: number) => {
      const markdown: string = [
        "![Home][home]",
        "x".repeat(60),
        "y".repeat(60),
        "",
        '[home]: https://example.com/home.png "The home page, as the run left it"',
      ].join("\n");

      expect(Markdown.cutEmailMarkdown(markdown, weight)).toBe(
        `${definition}\n\n![Home][home]\n${"x".repeat(kept)}`,
      );
    },
  );

  test("room goes to the lightest definition first: a screenshot's, its data weighing nothing, before a long title's", async () => {
    const data: string = png(30 * 1024);
    const shot: string = `[shot]: data:image/png;base64,${data}`;
    const markdown: string = [
      "![Shot][shot] [Runs][runs]",
      "x".repeat(60),
      "y".repeat(60),
      "z".repeat(200),
      "",
      `[runs]: https://example.com/runs "${"t".repeat(100)}"`,
      shot,
    ].join("\n");

    const cut: string = Markdown.cutEmailMarkdown(markdown, 300);

    /*
     * Room for the screenshot's whole and the link's without its title,
     * written in the order of the text. Given in that order, the link's
     * whole would take the room, and the screenshot would come empty.
     * Compared without the data, so a failure does not print it.
     */
    expect(cut.split(data).join("<data>")).toBe(
      [
        "[runs]: https://example.com/runs",
        "[shot]: data:image/png;base64,<data>",
        "",
        "![Shot][shot] [Runs][runs]",
        "x".repeat(60),
        "y".repeat(60),
      ].join("\n"),
    );
    expect(countOf(cut, data)).toBe(1);
    expect(
      (await render(cut)) ===
        `<p><img src="data:image/png;base64,${data}" alt="Shot" style="${EMAIL_IMAGE_STYLE}"> <a href="https://example.com/runs">Runs</a>\n${"x".repeat(60)}\n${"y".repeat(60)}</p>\n`,
    ).toBe(true);
  });

  test("line breaks written \\r\\n are read as marked reads them: the definition after a blank line is found, and the cut text breaks lines with \\n", () => {
    const markdown: string = [
      "![Home][home]",
      X,
      Y,
      "",
      "[home]: https://example.com/home.png",
    ].join("\r\n");

    expect(Markdown.cutEmailMarkdown(markdown, 120)).toBe(
      `[home]: https://example.com/home.png\n\n![Home][home]\n${X}`,
    );
  });
});

/*
 * A definition in a block quote or a list item - or right after a setext
 * heading - is one marked reads, and a field cut to fit brings it along
 * (#7230): on a line of its own before the kept part, as marked reads it
 * there - without the quote's markers or the item's bullet and
 * indentation, which would make a quote or a list of it there.
 */
describe("Markdown.cutEmailMarkdown - a definition in a quote or a list item, or after a setext heading, comes along (#7230)", () => {
  const X: string = "x".repeat(50);
  const Y: string = "y".repeat(50);
  const DEFINITION: string = "[home]: https://example.com/home.png";

  test.each([
    ["in a block quote", `> ${DEFINITION}`],
    ["in a block quote, no space after its marker", `>${DEFINITION}`],
    ["in a block quote in a block quote", `> > ${DEFINITION}`],
    [
      "in a block quote, after its paragraph and a blank line",
      `> Screenshot:\n>\n> ${DEFINITION}`,
    ],
    ["in a list item", `- ${DEFINITION}`],
    ["in a numbered list item", `1. ${DEFINITION}`],
    ["in a task list item", `- [ ] ${DEFINITION}`],
    ["in a block quote in a list item", `- > ${DEFINITION}`],
    ["in a list item, after a blank line", `- Screenshot\n\n  ${DEFINITION}`],
    [
      "in a list item, indented four spaces",
      `- Screenshot\n\n    ${DEFINITION}`,
    ],
    ["right after a setext heading of '='", `Screenshot\n===\n${DEFINITION}`],
    ["right after a setext heading of '-'", `Screenshot\n---\n${DEFINITION}`],
    ["right after an HTML comment", `<!-- the screenshot -->\n${DEFINITION}`],
  ])(
    "%s: written on a line of its own, without markers, before the kept part",
    async (_name: string, ending: string) => {
      const markdown: string = ["![Home][home]", X, Y, "", ending].join("\n");

      const cut: string = Markdown.cutEmailMarkdown(markdown, 120);

      expect(cut).toBe(`${DEFINITION}\n\n![Home][home]\n${X}`);
      expect(await render(cut)).toBe(
        `<p><img src="https://example.com/home.png" alt="Home" style="${EMAIL_IMAGE_STYLE}">\n${X}</p>\n`,
      );
    },
  );

  test.each([
    [
      "> ",
      160,
      '[home]: https://example.com/home.png "The home page, as the run left it"',
      60,
    ],
    ["> ", 140, "[home]: https://example.com/home.png", 56],
    [
      "- ",
      160,
      '[home]: https://example.com/home.png "The home page, as the run left it"',
      60,
    ],
    ["- ", 140, "[home]: https://example.com/home.png", 56],
  ])(
    "after %j, a definition comes whole where it fits, else without its title - cut to %i",
    (nesting: string, weight: number, definition: string, kept: number) => {
      const markdown: string = [
        "![Home][home]",
        "x".repeat(60),
        "y".repeat(60),
        "",
        `${nesting}[home]: https://example.com/home.png "The home page, as the run left it"`,
      ].join("\n");

      expect(Markdown.cutEmailMarkdown(markdown, weight)).toBe(
        `${definition}\n\n![Home][home]\n${"x".repeat(kept)}`,
      );
    },
  );

  test("a title over lines of a block quote comes over lines, without their markers", async () => {
    const markdown: string = [
      "![Home][home]",
      X,
      Y,
      "",
      "> [home]: https://example.com/home.png",
      '> "The home',
      '> page"',
    ].join("\n");

    const cut: string = Markdown.cutEmailMarkdown(markdown, 140);

    expect(cut).toBe(
      `[home]: https://example.com/home.png\n"The home\npage"\n\n![Home][home]\n${X}`,
    );
    expect(await render(cut)).toBe(
      `<p><img src="https://example.com/home.png" alt="Home" title="The home\npage" style="${EMAIL_IMAGE_STYLE}">\n${X}</p>\n`,
    );
  });

  test("a label over lines of a block quote, too heavy to come whole, comes empty without the quote's marker: its references are their text, never Markdown", async () => {
    const markdown: string = `![Home][Home Page] [Open it][home page]\n\n> [Home\n> Page]: https://example.com/${"a".repeat(200)}`;

    const cut: string = Markdown.cutEmailMarkdown(markdown, 100);

    expect(cut).toBe(
      "[Home\nPage]: <>\n\n![Home][Home Page] [Open it][home page]",
    );
    expect(await render(cut)).toBe("<p>Home Open it</p>\n");
  });

  test("a screenshot defined in a block quote weighs only its line's text: it comes whole where a short line fits", () => {
    const data: string = png(30 * 1024);
    const markdown: string = [
      "![Home][home]",
      X,
      Y,
      "",
      `> [home]: data:image/png;base64,${data}`,
    ].join("\n");

    const cut: string = Markdown.cutEmailMarkdown(markdown, 120);

    // Compared without the data, so a failure does not print it.
    expect(cut.split(data).join("<data>")).toBe(
      `[home]: data:image/png;base64,<data>\n\n![Home][home]\n${X}`,
    );
    expect(countOf(cut, data)).toBe(1);
  });

  test("of a label defined in a block quote and again on a line of its own, the first comes, as marked reads the first", () => {
    const markdown: string = [
      "![Home][home]",
      X,
      Y,
      "",
      "> [home]: https://example.com/first.png",
      "",
      "[home]: https://example.com/second.png",
    ].join("\n");

    expect(Markdown.cutEmailMarkdown(markdown, 120)).toBe(
      `[home]: https://example.com/first.png\n\n![Home][home]\n${X}`,
    );
  });
});

describe("Markdown email field - a screenshot defined once, cut to fit (#6963)", () => {
  test("the issue's case: a screenshot defined at the end of 300 KB of text is attached and shown, and the text is cut with the note", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const data: string = png(30 * 1024);
    const markdown: string = `![Home][home]\n\n${"The login form did not load in time.\n".repeat(8200)}\n[home]: data:image/png;base64,${data}`;

    const html: string = await render(markdown);
    const email: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

    expect(
      html.startsWith(
        `<p><img src="data:image/png;base64,${data}" alt="Home" style="${EMAIL_IMAGE_STYLE}"></p>\n<p>The login form did not load in time.\n`,
      ),
    ).toBe(true);
    expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
    expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThanOrEqual(
      MAX_EMAIL_FIELD_HTML_BYTES,
    );
    expect(email.inlineImages).toHaveLength(1);
    expect(email.inlineImages[0]!.base64 === data).toBe(true);
    expect(countOf(email.html, '<img src="cid:')).toBe(1);
    expect(email.html.includes("![Home")).toBe(false);
    expect(email.html.includes("base64")).toBe(false);
  });

  test("a field cut inside fenced code: the definition comes before the code, so the screenshot shows - never its reference, nor its base64, as code", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const data: string = png(30 * 1024);
    const markdown: string = [
      "![Home][home]",
      "",
      "```",
      "2026-10-08T10:00:00Z INFO request served\n".repeat(8000).trimEnd(),
      "```",
      "",
      `[home]: data:image/png;base64,${data}`,
    ].join("\n");

    const html: string = await render(markdown);
    const email: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

    expect(
      html.startsWith(
        `<p><img src="data:image/png;base64,${data}" alt="Home" style="${EMAIL_IMAGE_STYLE}"></p>\n<pre`,
      ),
    ).toBe(true);
    expect(
      html.endsWith(`</code></pre>\n${EMAIL_TRUNCATED_TEXT_NOTE_HTML}`),
    ).toBe(true);
    expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThanOrEqual(
      MAX_EMAIL_FIELD_HTML_BYTES,
    );
    expect(email.inlineImages).toHaveLength(1);
    expect(email.html.includes("![Home")).toBe(false);
    expect(email.html.includes("base64")).toBe(false);
  });
});

/*
 * The issue's case with the screenshot defined where #7230 found marked
 * reads it and the cut did not look: in a block quote, in a list item
 * indented four spaces, and right after a setext heading.
 */
describe("Markdown email field - a screenshot defined in a quote, a list item or after a setext heading, cut to fit (#7230)", () => {
  test.each([
    ["in a block quote", "> "],
    ["in a list item, indented four spaces", "- Screenshot\n\n    "],
    ["right after a setext heading of '='", "Screenshot\n===\n"],
  ])(
    "%s, at the end of 300 KB of text: attached once and shown, and the text cut with the note",
    async (_name: string, before: string) => {
      jest.spyOn(logger, "warn").mockImplementation((): void => {});
      const data: string = png(30 * 1024);
      const markdown: string = `![Home][home]\n\n${"The login form did not load in time.\n".repeat(8200)}\n${before}[home]: data:image/png;base64,${data}`;

      const html: string = await render(markdown);
      const email: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

      expect(
        html.startsWith(
          `<p><img src="data:image/png;base64,${data}" alt="Home" style="${EMAIL_IMAGE_STYLE}"></p>\n<p>The login form did not load in time.\n`,
        ),
      ).toBe(true);
      expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
      expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThanOrEqual(
        MAX_EMAIL_FIELD_HTML_BYTES,
      );
      expect(email.inlineImages).toHaveLength(1);
      expect(email.inlineImages[0]!.base64 === data).toBe(true);
      expect(countOf(email.html, '<img src="cid:')).toBe(1);
      expect(email.html.includes("![Home")).toBe(false);
      expect(email.html.includes("[home]")).toBe(false);
      expect(email.html.includes("base64")).toBe(false);
    },
  );
});

// A kind of definition the generated fields below are made of.
interface GeneratedDefinitionKind {
  // Whether its address is a screenshot, which goes out as an attachment.
  isScreenshot: boolean;
  // Whether it is light enough to come before the references.
  mayComeFirst: boolean;
  // Its definition of `label`.
  write: (label: string) => string;
}

describe("Markdown email field - generated fields cut to fit (#6962, #6963)", () => {
  /*
   * Whole fields, generated: references in short paragraphs to up to four
   * definitions of every kind - a screenshot, an https address of 60 KB or
   * of 200 KB, a title of 2 KB, a short one - then up to a megabyte of one
   * kind of block, and the definitions at the end, the light ones now and
   * then at the top. Each renders as an email field does, cut to fit when
   * it is more than a field keeps.
   */
  const screenshot: string = png(30 * 1024);

  const KINDS: ReadonlyArray<GeneratedDefinitionKind> = [
    {
      isScreenshot: true,
      mayComeFirst: true,
      write: (label: string): string => {
        return `[${label}]: data:image/png;base64,${screenshot}`;
      },
    },
    {
      isScreenshot: false,
      mayComeFirst: false,
      write: (label: string): string => {
        return `[${label}]: https://example.com/${"a".repeat(60 * 1024)}`;
      },
    },
    {
      isScreenshot: false,
      mayComeFirst: false,
      write: (label: string): string => {
        return `[${label}]: https://example.com/${"b".repeat(200 * 1024)}`;
      },
    },
    {
      isScreenshot: false,
      mayComeFirst: true,
      write: (label: string): string => {
        return `[${label}]: https://example.com/x.png "${"Checkout failed. ".repeat(120)}"`;
      },
    },
    {
      isScreenshot: false,
      mayComeFirst: true,
      write: (label: string): string => {
        return `[${label}]: https://example.com/short.png "Short"`;
      },
    },
  ];

  /*
   * Each repeated up to 20,000 times: a log, tables, a list, code blocks -
   * which a cut can end inside - fences that open and close in turn, so
   * the definitions after them are code when the fences are odd, HTML and
   * a quote.
   */
  const FILLERS: ReadonlyArray<string> = [
    "The login form did not load in time.\n",
    "| Step | Result |\n| --- | --- |\n| Login | Timed out |\n\n",
    "- Retried the request\n- Timed out again\n\n",
    "```\n2026-11-12T10:00:00Z ERROR request failed\n2026-11-12T10:00:01Z ERROR retry failed\n```\n\n",
    "```\n2026-11-12T10:00:00Z ERROR request failed\n",
    "<div>The checkout page</div>\n\n",
    "> The probe reported a timeout.\n",
  ];

  /*
   * Whether `html` holds a character of Unicode's private use area: a
   * definition's mark, or the token of a held-back text, left in the email.
   */
  const holdsPrivateUseCharacter: (html: string) => boolean = (
    html: string,
  ): boolean => {
    for (let index: number = 0; index < html.length; index++) {
      const code: number = html.charCodeAt(index);

      if (code >= 0xe000 && code <= 0xf8ff) {
        return true;
      }
    }

    return false;
  };

  /*
   * Where each definition is written: on lines of its own, mostly, else in
   * a block quote or a list item, or right after a setext heading (#7230).
   * Drawn from a generator of its own, so the fields are what they were
   * before but for that.
   */
  const NESTINGS: ReadonlyArray<string> = [
    "",
    "",
    "",
    "> ",
    "- ",
    "- Screenshot\n\n    ",
    "Screenshot\n===\n",
  ];

  test("every field fits, holds no mark nor base64, shows no reference to a definition as Markdown, and attaches a screenshot an image refers to", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const random: SeededRandom = seededRandom(7198);
    const nestingRandom: SeededRandom = seededRandom(7230);
    const problems: Array<string> = [];
    let cutFields: number = 0;
    let screenshotFields: number = 0;
    let nestedScreenshotFields: number = 0;

    for (let round: number = 0; round < 24; round++) {
      const labels: Array<string> = [];
      const screenshotLabels: Set<string> = new Set<string>();
      // The screenshots defined in a quote or a list item, or after a setext heading.
      const nestedScreenshotLabels: Set<string> = new Set<string>();
      const first: Array<string> = [];
      const last: Array<string> = [];
      const definitionCount: number = 1 + random(4);

      for (let index: number = 0; index < definitionCount; index++) {
        const label: string = `l${index}`;
        const kind: GeneratedDefinitionKind = KINDS[random(KINDS.length)]!;

        labels.push(label);

        if (kind.isScreenshot) {
          screenshotLabels.add(label);
        }

        const nesting: string = NESTINGS[nestingRandom(NESTINGS.length)]!;

        if (kind.isScreenshot && nesting !== "") {
          nestedScreenshotLabels.add(label);
        }

        // At the end, as a description defines its screenshot; now and then first.
        (kind.mayComeFirst && random(4) === 0 ? first : last).push(
          `${nesting}${kind.write(label)}`,
        );
      }

      // Paragraphs of one to ten references, each to any of the labels.
      const paragraphs: Array<string> = [];
      const screenshotImages: Set<string> = new Set<string>();
      const referenceCount: number = 1 + random(300);
      let written: number = 0;

      while (written < referenceCount) {
        const references: Array<string> = [];
        const inParagraph: number = Math.min(
          1 + random(10),
          referenceCount - written,
        );

        for (let index: number = 0; index < inParagraph; index++) {
          const label: string = labels[random(labels.length)]!;
          const isImage: boolean = random(2) === 0;

          if (isImage && screenshotLabels.has(label)) {
            screenshotImages.add(label);
          }

          references.push(
            isImage
              ? `![Shot ${written}][${label}]`
              : `[Run ${written}][${label}]`,
          );
          written++;
        }

        paragraphs.push(references.join(" "));
      }

      const filler: string = FILLERS[random(FILLERS.length)]!.repeat(
        1 + random(20000),
      );
      const markdown: string = [...first, ...paragraphs, filler, ...last].join(
        "\n\n",
      );
      const name: string = `round ${round} (${definitionCount} definitions, ${referenceCount} references, ${markdown.length} characters)`;

      const html: string = await render(markdown);
      const email: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);
      // The definitions marked reads of the whole text: none in a code block.
      const full: MarkedReferences = readMarkedReferences(markdown);
      const size: number = EmailSize.getFieldSizeInBytes(html);

      if (html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)) {
        cutFields++;
      }

      if (size > MAX_EMAIL_FIELD_HTML_BYTES) {
        problems.push(`${name}: ${size} bytes`);
      }

      if (holdsPrivateUseCharacter(html)) {
        problems.push(`${name}: a mark in the HTML`);
      }

      if (email.html.includes("base64")) {
        problems.push(`${name}: base64 in the email`);
      }

      for (const label of labels) {
        if (isDefined(full.links, label) && html.includes(`][${label}]`)) {
          problems.push(`${name}: a reference to ${label} as Markdown`);
        }
      }

      if (
        Array.from(screenshotImages).some((label: string): boolean => {
          return isDefined(full.links, label);
        })
      ) {
        screenshotFields++;

        if (email.inlineImages.length === 0) {
          problems.push(`${name}: the screenshot is not attached`);
        }
      }

      if (
        Array.from(screenshotImages).some((label: string): boolean => {
          return (
            nestedScreenshotLabels.has(label) && isDefined(full.links, label)
          );
        })
      ) {
        nestedScreenshotFields++;
      }
    }

    expect(problems).toEqual([]);
    /*
     * The rounds reach what they test: most fields cut, many with a
     * screenshot, some defined in a quote, a list item or after a heading.
     */
    expect(cutFields).toBeGreaterThanOrEqual(16);
    expect(screenshotFields).toBeGreaterThanOrEqual(8);
    expect(nestedScreenshotFields).toBeGreaterThanOrEqual(4);
  });
});

describe("Markdown.cutEmailMarkdown - generated texts (#6963)", () => {
  /*
   * Pieces of a description: references to four labels in every form and
   * case, one to a label nothing defines, and text, code and links around
   * them. No piece makes a definition: they come at the end.
   */
  const BODY: ReadonlyArray<string> = [
    "![Shot][home]",
    "[Run][HOME]",
    "[home][]",
    "[Home]",
    "![Runs][runs]",
    "[runs]",
    "[Runs][]",
    "[shot]",
    "![x][SHOT]",
    "[none]",
    " ",
    "word ",
    "Some longer words of text. ",
    "\n",
    "\n\n",
    "```\n",
    "`[home]` ",
    "**bold** ",
    "x".repeat(40),
    "\\[home] ",
    "[link](https://example.com/a) ",
    "# Heading\n",
  ];

  /*
   * The definitions at the end, a line each: one label defined twice in
   * two cases, one no reference uses. Every label is four characters, so
   * every empty definition is too: one that does not fit means none does.
   */
  const DEFINITIONS: ReadonlyArray<string> = [
    "[HOME]: https://example.com/other.png\n",
    "[home]: https://example.com/home.png\n",
    '[Runs]: /runs "Every run"\n',
    `[shot]: data:image/png;base64,${ONE_PIXEL_PNG}\n`,
    "[gone]: https://example.com/gone\n",
  ];

  // A line the cut can write: a definition whole, without its title, or empty.
  const WRITTEN: Set<string> = new Set<string>(
    DEFINITIONS.flatMap((line: string): Array<string> => {
      const whole: string = line.trimEnd();

      return [
        whole,
        whole.split(' "')[0]!,
        `${whole.slice(0, whole.indexOf("]") + 1)}: <>`,
      ];
    }),
  );

  // An empty definition of a four-character label, its line break, and a blank line.
  const EMPTY_WEIGHT: number = "[home]: <>\n".length + 1;

  // What is wrong with `cut`, the text cut to `weight`; null when nothing is.
  const problemWith: (
    text: string,
    whole: MarkedReferences,
    cut: string,
    weight: number,
  ) => string | null = (
    text: string,
    whole: MarkedReferences,
    cut: string,
    weight: number,
  ): string | null => {
    // The data here is too short to weigh nothing: a character weighs one.
    if (cut.length > weight) {
      return `weighs ${cut.length}`;
    }

    const lines: Array<string> = cut.split("\n");
    let count: number = 0;

    while (count < lines.length && WRITTEN.has(lines[count]!)) {
      count++;
    }

    if (count > 0 && lines[count] !== "") {
      return "no blank line after the definitions";
    }

    const kept: string = count > 0 ? lines.slice(count + 1).join("\n") : cut;

    if (!text.startsWith(kept)) {
      return "the kept part is not the start of the text";
    }

    const read: MarkedReferences = readMarkedReferences(cut);
    const labels: Set<string> = new Set<string>();

    for (const line of lines.slice(0, count)) {
      const label: string = line.slice(1, line.indexOf("]")).toLowerCase();
      const got: Links[string] | undefined = read.links[label];
      const want: Links[string] | undefined = whole.links[label];

      if (labels.has(label)) {
        return `[${label}] comes twice`;
      }

      labels.add(label);

      if (!kept.toLowerCase().includes(`[${label}]`)) {
        return `[${label}] comes, and the kept part does not refer to it`;
      }

      if (!got || !want) {
        return `[${label}] comes, and the text does not define it`;
      }

      const asWhole: boolean =
        got.href === want.href &&
        (got.title === want.title || got.title === undefined);
      const asEmpty: boolean = got.href === "" && got.title === undefined;

      if (!asWhole && !asEmpty) {
        return `[${label}] is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`;
      }
    }

    for (const label of read.lookedUp) {
      if (
        isDefined(whole.links, label) &&
        !isDefined(read.links, label) &&
        cut.length + EMPTY_WEIGHT <= weight
      ) {
        return `[${label}] lost its definition with room for an empty one`;
      }
    }

    return null;
  };

  test("the cut text never weighs more than it may; it is definitions and the start of the text; each definition is marked's own, whole, without its title or empty, of a label the kept part refers to; and every reference marked reads keeps its definition while an empty one fits", () => {
    const bodies: Array<string> = generatedTexts(1500, 6963, BODY, 40);
    const endings: Array<string> = generatedTexts(1500, 6964, DEFINITIONS, 6);
    const problems: Array<string> = [];
    let cuts: number = 0;
    let broughtAlong: number = 0;
    let emptied: number = 0;

    bodies.forEach((body: string, index: number): void => {
      const text: string = `${body}\n\n${endings[index]!}`;
      const whole: MarkedReferences = readMarkedReferences(text);
      const length: number = text.length;

      for (const weight of [
        0,
        1,
        9,
        40,
        Math.floor(length / 4),
        Math.floor(length / 2),
        Math.floor((3 * length) / 4),
        length - 1,
      ]) {
        const cut: string = Markdown.cutEmailMarkdown(text, weight);
        const problem: string | null = problemWith(text, whole, cut, weight);

        cuts++;

        if (problem !== null) {
          problems.push(
            `${problem}: ${JSON.stringify(text)} cut to ${weight}: ${JSON.stringify(cut)}`,
          );
        }

        if (!text.startsWith(cut)) {
          broughtAlong++;
        }

        if (cut.includes("]: <>\n")) {
          emptied++;
        }
      }
    });

    expect(problems.slice(0, 3)).toEqual([]);
    // The texts reach every case: many cuts bring definitions, some empty.
    expect(cuts).toBe(12000);
    expect(broughtAlong).toBeGreaterThan(2500);
    expect(emptied).toBeGreaterThan(1000);
  });

  /*
   * The same definitions in block quotes and list items - indented four
   * spaces too - and right after a setext heading or an HTML comment
   * (#7230). marked reads each there as the line of DEFINITIONS it is, so
   * a cut writes it as that line: whole, without its title, or empty.
   */
  const NESTING: ReadonlyArray<string> = [
    "> ",
    ">",
    "> > ",
    "- ",
    "1. ",
    "- [ ] ",
    "- > ",
    "> - ",
    "- Screenshot\n\n  ",
    "- Screenshot\n\n    ",
    "Screenshot\n===\n",
    "<!-- the screenshot -->\n",
  ];
  const NESTED_DEFINITIONS: ReadonlyArray<string> = [
    ...DEFINITIONS,
    ...DEFINITIONS.flatMap((line: string): Array<string> => {
      return NESTING.map((nesting: string): string => {
        return `${nesting}${line}`;
      });
    }),
    "\n",
  ];

  test("in quotes, list items and after setext headings too: the same holds, and each comes as a line of its own", () => {
    const bodies: Array<string> = generatedTexts(1500, 7230, BODY, 40);
    const endings: Array<string> = generatedTexts(
      1500,
      7231,
      NESTED_DEFINITIONS,
      6,
    );
    const problems: Array<string> = [];
    let cuts: number = 0;
    let nestedBroughtAlong: number = 0;
    let emptied: number = 0;

    bodies.forEach((body: string, index: number): void => {
      const text: string = `${body}\n\n${endings[index]!}`;
      const whole: MarkedReferences = readMarkedReferences(text);
      const length: number = text.length;
      // The labels whose first definition, the one marked reads, is in a quote or a list item.
      const nestedLabels: Set<string> = new Set<string>();
      const seen: Set<string> = new Set<string>();

      for (const definition of getLinkReferenceDefinitions(text)) {
        if (!seen.has(definition.label) && definition.nested) {
          nestedLabels.add(definition.label);
        }

        seen.add(definition.label);
      }

      for (const weight of [
        0,
        1,
        9,
        40,
        Math.floor(length / 4),
        Math.floor(length / 2),
        Math.floor((3 * length) / 4),
        length - 1,
      ]) {
        const cut: string = Markdown.cutEmailMarkdown(text, weight);
        const problem: string | null = problemWith(text, whole, cut, weight);

        cuts++;

        if (problem !== null) {
          problems.push(
            `${problem}: ${JSON.stringify(text)} cut to ${weight}: ${JSON.stringify(cut)}`,
          );
        }

        // The definitions written before the kept part, a blank line after them.
        const written: string = text.startsWith(cut)
          ? ""
          : cut.slice(0, cut.indexOf("\n\n"));

        if (
          getLinkReferenceDefinitions(written).some(
            (definition: LinkReferenceDefinition): boolean => {
              return nestedLabels.has(definition.label);
            },
          )
        ) {
          nestedBroughtAlong++;
        }

        if (cut.includes("]: <>\n")) {
          emptied++;
        }
      }
    });

    expect(problems.slice(0, 3)).toEqual([]);
    // The texts reach every case: many cuts bring a definition from a quote or a list item.
    expect(cuts).toBe(12000);
    expect(nestedBroughtAlong).toBeGreaterThan(1900);
    expect(emptied).toBeGreaterThan(950);
  });
});

describe("Markdown.cutEmailMarkdown - a line megabytes long before the definitions (#6963)", () => {
  const data: string = png(30 * 1024);
  const screenshot: string = `[home]: data:image/png;base64,${data}`;

  // Ten thousand definitions of links, then the screenshot's.
  const definitions: string = [
    ...Array.from({ length: 10000 }, (_: unknown, index: number): string => {
      return `[d${index}]: https://example.com/runs/${index}`;
    }),
    screenshot,
  ].join("\n");

  /*
   * A line of at least four megabytes, of `piece` again and again: long
   * enough that reading ahead from each bracket of the kept part to the
   * next "]" - past the line's end - takes seconds.
   */
  const megabytesOf: (piece: (index: number) => string) => string = (
    piece: (index: number) => string,
  ): string => {
    const pieces: Array<string> = [];
    let length: number = 0;

    for (let index: number = 0; length < 4 * 1024 * 1024; index++) {
      pieces.push(piece(index));
      length += pieces[pieces.length - 1]!.length;
    }

    return pieces.join("");
  };

  test.each([
    [
      "references to every label the text defines",
      megabytesOf((index: number): string => {
        return `[x][d${index % 10000}] `;
      }),
    ],
    [
      "brackets that never close",
      megabytesOf((): string => {
        return "[a ";
      }),
    ],
  ])(
    "%s: cut in time that grows with the text, within the weight, the screenshot's definition whole",
    (_name: string, line: string) => {
      const markdown: string = `![Home][home]\n\n${line}\n\n${definitions}`;

      const timed: FastestRun<string> = fastestRun({
        run: (): string => {
          return Markdown.cutEmailMarkdown(
            markdown,
            MAX_EMAIL_FIELD_HTML_BYTES,
          );
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);

      const cut: string = timed.result;

      // Booleans, so a failure does not print megabytes.
      expect(cut.includes(`${screenshot}\n\n![Home][home]\n\n`)).toBe(true);
      expect(
        Markdown["getEmailMarkdownWeight"](cut, getBase64Runs(cut)),
      ).toBeLessThanOrEqual(MAX_EMAIL_FIELD_HTML_BYTES);
    },
  );
});
