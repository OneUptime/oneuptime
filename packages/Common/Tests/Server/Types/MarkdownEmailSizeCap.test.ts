import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { Renderer, marked } from "marked";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import EmailSize, {
  EMAIL_TRUNCATED_TEXT_NOTE_HTML,
  MAX_EMAIL_FIELD_HTML_BYTES,
} from "../../../Server/Utils/Mail/EmailSize";
import logger from "../../../Server/Utils/Logger";

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
 * exactly as it always has.
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
