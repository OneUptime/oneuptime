import { describe, expect, test } from "@jest/globals";
import EmailSize, {
  EMAIL_TRUNCATED_TEXT_NOTE,
  EMAIL_TRUNCATED_TEXT_NOTE_HTML,
  EmailWithinLimit,
  MAX_EMAIL_BYTES,
  MAX_EMAIL_FIELD_HTML_BYTES,
} from "../../../../Server/Utils/Mail/EmailSize";
import { MaxEmailInlineImageBytes } from "../../../../Server/Utils/Mail/EmailInlineImages";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";

/*
 * HOW BIG AN EMAIL IS (Server/Utils/Mail/EmailSize).
 *
 * A mail server refuses a message over its limit - Postfix takes 10 MB
 * unless told otherwise, Microsoft Graph refuses a sendMail request over
 * 4 MB - and the notification is lost. An email is held to MAX_EMAIL_BYTES,
 * its HTML and its attachments together.
 */

const PNG_SIGNATURE: ReadonlyArray<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];

let imagesMade: number = 0;

/*
 * A PNG of about `bytes` bytes, as a data: URL: its signature, then filler -
 * a different filler for every image, so none is the same image twice.
 */
function pngDataUri(bytes: number): string {
  const buffer: Buffer = Buffer.alloc(Math.ceil(bytes / 3) * 3, imagesMade++);

  PNG_SIGNATURE.forEach((byte: number, index: number): void => {
    buffer[index] = byte;
  });

  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function image(bytes: number, alt: string): string {
  return `<img src="${pngDataUri(bytes)}" alt="${alt}">`;
}

describe("EmailSize - the limits", () => {
  test("an email is held well under what every mail server and Graph take", () => {
    expect(MAX_EMAIL_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_EMAIL_BYTES).toBeLessThan(4 * 1000 * 1000);
    expect(MAX_EMAIL_FIELD_HTML_BYTES).toBe(256 * 1024);
    // A few long fields fit beside the images an email carries.
    expect(
      4 * MAX_EMAIL_FIELD_HTML_BYTES + (MaxEmailInlineImageBytes * 4) / 3,
    ).toBeLessThan(MAX_EMAIL_BYTES + 1024 * 1024);
  });

  test("a cut text ends with the words a cut chat message ends with", () => {
    expect(SlackUtil.TRUNCATED_SECTION_NOTE.trim()).toBe(
      `_${EMAIL_TRUNCATED_TEXT_NOTE}_`,
    );
    expect(EMAIL_TRUNCATED_TEXT_NOTE_HTML).toContain(EMAIL_TRUNCATED_TEXT_NOTE);
  });
});

describe("EmailSize - measuring", () => {
  test("HTML is measured as it is sent: UTF-8", () => {
    expect(EmailSize.getHtmlSizeInBytes("<p>abc</p>")).toBe(10);
    expect(EmailSize.getHtmlSizeInBytes("障害")).toBe(6);
    expect(EmailSize.getHtmlSizeInBytes("😀")).toBe(4);
  });

  test("a field's inline images count as the attachments they go out as", () => {
    const html: string = `<p>Before</p>${image(300000, "Screenshot")}<p>After</p>`;

    expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThan(200);
  });

  test("an email's size is its HTML and its attachments as base64", () => {
    expect(
      EmailSize.getSizeInBytes({
        html: "<p>a</p>",
        inlineImages: [
          {
            contentId: "x@oneuptime",
            fileName: "image-1.png",
            mimeType: "image/png",
            base64: "QUJD",
            byteLength: 3,
          },
        ],
      }),
    ).toBe(8 + 4);
  });
});

describe("EmailSize.attachWithinLimit", () => {
  test("an email within the limit is attached as it always was", () => {
    const html: string = `<p>Hello</p>${image(1000, "Screenshot")}`;

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(html);

    expect(attached.wasFitted).toBe(false);
    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.html).toMatch(/^<p>Hello<\/p><img src="cid:/);
  });

  test("images that do not fit beside the HTML are left out, each with a note", () => {
    const html: string = `<p>${"a".repeat(2 * 1024 * 1024)}</p>${image(900000, "First")}${image(900000, "Second")}`;

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(html);

    expect(attached.wasFitted).toBe(true);
    expect(EmailSize.getSizeInBytes(attached)).toBeLessThanOrEqual(
      MAX_EMAIL_BYTES,
    );
    expect(attached.inlineImages.length).toBeLessThan(2);
    expect(attached.html).toContain("image too large to include in this email");
    // The text is kept whole.
    expect(attached.html.includes("a".repeat(2 * 1024 * 1024))).toBe(true);
  });

  test("HTML too big on its own is cut, with the note, and carries no image", () => {
    const html: string = `${image(1000, "Small")}<p>${"word ".repeat(1000000)}</p>`;

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(html);

    expect(attached.wasFitted).toBe(true);
    expect(attached.inlineImages).toEqual([]);
    expect(EmailSize.getHtmlSizeInBytes(attached.html)).toBeLessThanOrEqual(
      MAX_EMAIL_BYTES,
    );
    expect(attached.html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
    // No image's base64 is left in the HTML.
    expect(attached.html.includes("base64,")).toBe(false);
  });

  test("the limit can be given", () => {
    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `<p>${"x".repeat(5000)}</p>`,
      1000,
    );

    expect(EmailSize.getHtmlSizeInBytes(attached.html)).toBeLessThanOrEqual(
      1000,
    );
  });
});

describe("EmailSize.cutHtml", () => {
  test("HTML that fits is returned as it is", () => {
    expect(EmailSize.cutHtml("<p>abc</p>", 100)).toBe("<p>abc</p>");
  });

  test("never cuts inside a tag", () => {
    const html: string = `<p>${"a".repeat(100)}<a href="https://example.com/${"x".repeat(200)}">link</a></p>`;
    const budget: number =
      EmailSize.getHtmlSizeInBytes(EMAIL_TRUNCATED_TEXT_NOTE_HTML) + 150;

    const cut: string = EmailSize.cutHtml(html, budget);

    expect(cut).toBe(`<p>${"a".repeat(100)}${EMAIL_TRUNCATED_TEXT_NOTE_HTML}`);
  });

  test("never cuts inside a character reference", () => {
    const html: string = `<p>${"&amp;".repeat(100)}</p>`;
    const onlyWholeReferences: RegExp = /^<p>(&amp;)*$/;

    for (let extra: number = 0; extra < 12; extra++) {
      const budget: number =
        EmailSize.getHtmlSizeInBytes(EMAIL_TRUNCATED_TEXT_NOTE_HTML) +
        40 +
        extra;
      const cut: string = EmailSize.cutHtml(html, budget);
      const kept: string = cut.slice(
        0,
        cut.length - EMAIL_TRUNCATED_TEXT_NOTE_HTML.length,
      );

      expect([extra, onlyWholeReferences.test(kept)]).toEqual([extra, true]);
      expect(EmailSize.getHtmlSizeInBytes(cut)).toBeLessThanOrEqual(budget);
    }
  });

  test("never cuts between the halves of an emoji, and counts UTF-8", () => {
    const html: string = `<p>${"😀".repeat(100)}</p>`;
    const budget: number =
      EmailSize.getHtmlSizeInBytes(EMAIL_TRUNCATED_TEXT_NOTE_HTML) + 3 + 10;

    const cut: string = EmailSize.cutHtml(html, budget);

    // "<p>" and two whole emoji (8 bytes) fit in 13 bytes.
    expect(cut).toBe(`<p>😀😀${EMAIL_TRUNCATED_TEXT_NOTE_HTML}`);
  });
});

describe("EmailSize - the note links to the record", () => {
  test("the record is the status page's page for a subscriber, else the first view link", () => {
    expect(
      EmailSize.getRecordLink({
        projectName: "Acme",
        incidentViewLink: "https://oneuptime.example.com/incidents/1",
        detailsUrl: "https://status.example.com/incidents/1",
      }),
    ).toBe("https://status.example.com/incidents/1");
    expect(
      EmailSize.getRecordLink({
        projectName: "Acme",
        monitorViewLink: "https://oneuptime.example.com/monitors/1",
        alertViewLink: "https://oneuptime.example.com/alerts/2",
      }),
    ).toBe("https://oneuptime.example.com/monitors/1");
  });

  test("only a web address is a link", () => {
    expect(EmailSize.getRecordLink(undefined)).toBeNull();
    expect(EmailSize.getRecordLink({})).toBeNull();
    expect(
      EmailSize.getRecordLink({
        incidentViewLink: "javascript:alert(1)",
        alertViewLink: "",
      }),
    ).toBeNull();
    expect(
      EmailSize.getRecordLink({
        incidentViewLink: "javascript:alert(1)",
        alertViewLink: " https://oneuptime.example.com/alerts/2 ",
      }),
    ).toBe("https://oneuptime.example.com/alerts/2");
  });

  test("every note links to the record, its address escaped", () => {
    const html: string = `<p>a</p>${EMAIL_TRUNCATED_TEXT_NOTE_HTML}<p>b</p>${EMAIL_TRUNCATED_TEXT_NOTE_HTML}`;

    const linked: string = EmailSize.linkTruncatedTextNotes(
      html,
      'https://oneuptime.example.com/i/1?a=1&b="2"',
    );

    expect(linked.includes(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(false);
    expect(
      linked.split(
        '<a href="https://oneuptime.example.com/i/1?a=1&amp;b=&quot;2&quot;" style="color:#64748b;">see OneUptime for the full text</a>',
      ),
    ).toHaveLength(3);
    // Linking again changes nothing.
    expect(
      EmailSize.linkTruncatedTextNotes(
        linked,
        'https://oneuptime.example.com/i/1?a=1&b="2"',
      ),
    ).toBe(linked);
  });

  test("HTML with no note, or an email with no link, is as it was", () => {
    expect(EmailSize.linkTruncatedTextNotes("<p>a</p>", "https://a.b")).toBe(
      "<p>a</p>",
    );
    expect(
      EmailSize.linkTruncatedTextNotes(EMAIL_TRUNCATED_TEXT_NOTE_HTML, null),
    ).toBe(EMAIL_TRUNCATED_TEXT_NOTE_HTML);
  });
});
