import { describe, expect, test } from "@jest/globals";
import EmailSize, {
  EMAIL_TRUNCATED_TEXT_NOTE,
  EMAIL_TRUNCATED_TEXT_NOTE_HTML,
  EmailWithinLimit,
  MAX_EMAIL_BYTES,
  MAX_EMAIL_FIELD_HTML_BYTES,
} from "../../../../Server/Utils/Mail/EmailSize";
import {
  EmailInlineImage,
  EmailOwnImage,
  MaxEmailInlineImageBytes,
} from "../../../../Server/Utils/Mail/EmailInlineImages";
import EmailLogo from "../../../../Server/Utils/Mail/EmailLogo";
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

describe("EmailSize.attachWithinLimit - OneUptime's logo (EmailLogo)", () => {
  /*
   * The header of an email that shows OneUptime's branding carries its logo
   * (issue #5124: it used to load from res.cloudinary.com). It goes with
   * the email whatever else is left out, and it is counted.
   */
  const logoDataUrl: string = EmailLogo.getDataUrl() as string;
  const logoBase64Length: number =
    logoDataUrl.length - "data:image/png;base64,".length;
  const logoHeader: string = `<img src="${logoDataUrl}" width="32" height="32" alt="OneUptime">`;

  const contentIdsIn: (html: string) => Array<string> = (
    html: string,
  ): Array<string> => {
    return html
      .split('src="cid:')
      .slice(1)
      .map((rest: string): string => {
        return rest.slice(0, rest.indexOf('"'));
      });
  };

  // Every image the HTML points at is attached, and every attachment shown.
  const expectAttachmentsMatchTheHtml: (attached: EmailWithinLimit) => void = (
    attached: EmailWithinLimit,
  ): void => {
    expect([...new Set(contentIdsIn(attached.html))].sort()).toEqual(
      attached.inlineImages
        .map((image: EmailInlineImage): string => {
          return image.contentId;
        })
        .sort(),
    );
  };

  test("the logo in the shipped file is a few kilobytes", () => {
    expect(logoDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(logoBase64Length).toBeLessThan(11 * 1024);
  });

  test("an email that shows it carries it, as its first attachment", () => {
    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `${logoHeader}<p>Hello</p>`,
    );

    expect(attached.wasFitted).toBe(false);
    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.inlineImages[0]!.fileName).toBe("oneuptime-logo.png");
    expect(attached.html).toBe(
      `<img src="cid:${attached.inlineImages[0]!.contentId}" width="32" height="32" alt="OneUptime"><p>Hello</p>`,
    );
  });

  test("comes before the email's screenshots, which keep their own names", () => {
    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `${logoHeader}<p>Hello</p>${image(1000, "Shot")}`,
    );

    expect(
      attached.inlineImages.map((image: EmailInlineImage): string => {
        return image.fileName;
      }),
    ).toEqual(["oneuptime-logo.png", "image-1.png"]);
    expectAttachmentsMatchTheHtml(attached);
  });

  test("is not one of the twenty screenshots an email may carry", () => {
    const shots: string = Array.from(
      { length: 21 },
      (_: unknown, index: number): string => {
        return image(1000, `Shot ${index + 1}`);
      },
    ).join("");

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `${logoHeader}${shots}`,
    );

    expect(attached.inlineImages).toHaveLength(21);
    expect(attached.inlineImages[0]!.fileName).toBe("oneuptime-logo.png");
    expect(attached.html).toContain(
      "[Shot 21: image too large to include in this email]",
    );
    expectAttachmentsMatchTheHtml(attached);
  });

  test("stays when screenshots are left out to fit, and is counted", () => {
    const html: string = `${logoHeader}<p>${"a".repeat(2 * 1024 * 1024)}</p>${image(900000, "First")}${image(900000, "Second")}`;

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(html);

    expect(attached.wasFitted).toBe(true);
    expect(attached.inlineImages[0]!.fileName).toBe("oneuptime-logo.png");
    expect(attached.html).toContain("image too large to include in this email");
    expect(attached.html).not.toContain("OneUptime: image too large");
    expect(EmailSize.getSizeInBytes(attached)).toBeLessThanOrEqual(
      MAX_EMAIL_BYTES,
    );
    expectAttachmentsMatchTheHtml(attached);
  });

  test("stays when HTML too big on its own is cut, and is counted", () => {
    const html: string = `${logoHeader}${image(1000, "Small")}<p>${"word ".repeat(1000000)}</p>`;

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(html);

    expect(attached.wasFitted).toBe(true);
    expect(
      attached.inlineImages.map((image: EmailInlineImage): string => {
        return image.fileName;
      }),
    ).toEqual(["oneuptime-logo.png"]);
    expect(attached.html.startsWith('<img src="cid:')).toBe(true);
    expect(attached.html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
    expect(attached.html).toContain(
      "[Small: image too large to include in this email]",
    );
    // The whole email, the logo's base64 included, is within the limit.
    expect(EmailSize.getSizeInBytes(attached)).toBeLessThanOrEqual(
      MAX_EMAIL_BYTES,
    );
    expect(EmailSize.getHtmlSizeInBytes(attached.html)).toBeLessThanOrEqual(
      MAX_EMAIL_BYTES - logoBase64Length,
    );
    expectAttachmentsMatchTheHtml(attached);
  });

  test("a limit that is given holds the logo too", () => {
    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `${logoHeader}<p>${"x".repeat(20000)}</p>`,
      15000,
    );

    expect(attached.inlineImages).toHaveLength(1);
    expect(EmailSize.getSizeInBytes(attached)).toBeLessThanOrEqual(15000);
    expectAttachmentsMatchTheHtml(attached);
  });

  test("never an attachment the HTML no longer points at", () => {
    // A limit too small for the text before the logo cuts the logo away.
    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `<p>${"x".repeat(5000)}</p>${logoHeader}`,
      8000,
    );

    expect(attached.inlineImages).toEqual([]);
    expect(attached.html).not.toContain("cid:");
    expectAttachmentsMatchTheHtml(attached);
  });

  test("an email without it has no logo attachment", () => {
    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `<p>Hello</p>${image(1000, "Shot")}`,
    );

    expect(
      attached.inlineImages.map((image: EmailInlineImage): string => {
        return image.fileName;
      }),
    ).toEqual(["image-1.png"]);
  });
});

describe("EmailSize.attachWithinLimit - a logo the email carries (EmailCarriedLogos)", () => {
  /*
   * A logo an operator uploaded - the installation's own, a status page's -
   * goes inside the email in place of its address (EmailCarriedLogos), and
   * out as an attachment as OneUptime's logo does: first, counted first,
   * and never left out to make the email fit.
   */
  const carriedLogo: (bytes: number) => EmailOwnImage = (
    bytes: number,
  ): EmailOwnImage => {
    return { dataUri: pngDataUri(bytes), fileName: "logo.png" };
  };

  const logoTag: (logo: EmailOwnImage) => string = (
    logo: EmailOwnImage,
  ): string => {
    return `<img src="${logo.dataUri}" height="40" alt="Acme Status">`;
  };

  const fileNames: (attached: EmailWithinLimit) => Array<string> = (
    attached: EmailWithinLimit,
  ): Array<string> => {
    return attached.inlineImages.map((image: EmailInlineImage): string => {
      return image.fileName;
    });
  };

  const pointsAtEveryAttachment: (attached: EmailWithinLimit) => void = (
    attached: EmailWithinLimit,
  ): void => {
    for (const image of attached.inlineImages) {
      expect(attached.html).toContain(`src="cid:${image.contentId}"`);
    }

    expect(attached.html).not.toContain("data:image");
  };

  test("goes out as an attachment the HTML points at, under the name it was given", () => {
    const logo: EmailOwnImage = carriedLogo(20000);

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `${logoTag(logo)}<p>Hello</p>`,
      MAX_EMAIL_BYTES,
      [logo],
    );

    expect(attached.wasFitted).toBe(false);
    expect(fileNames(attached)).toEqual(["logo.png"]);
    expect(attached.html).toBe(
      `<img src="cid:${attached.inlineImages[0]!.contentId}" height="40" alt="Acme Status"><p>Hello</p>`,
    );
    expect(attached.inlineImages[0]!.base64).toBe(
      logo.dataUri.slice("data:image/png;base64,".length),
    );
  });

  test("comes after OneUptime's logo and before the screenshots, and is not one of them", () => {
    const logo: EmailOwnImage = carriedLogo(20000);
    const oneUptimeLogo: string = `<img src="${EmailLogo.getDataUrl() as string}" width="32" height="32" alt="OneUptime">`;
    const shots: string = Array.from(
      { length: 20 },
      (_: unknown, index: number): string => {
        return image(1000, `Shot ${index + 1}`);
      },
    ).join("");

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `${oneUptimeLogo}${logoTag(logo)}${shots}`,
      MAX_EMAIL_BYTES,
      [logo],
    );

    expect(fileNames(attached).slice(0, 3)).toEqual([
      "oneuptime-logo.png",
      "logo.png",
      "image-1.png",
    ]);
    // Twenty screenshots still fit beside the two logos.
    expect(attached.inlineImages).toHaveLength(22);
    pointsAtEveryAttachment(attached);
  });

  test("stays when screenshots are left out to fit, and is counted", () => {
    const logo: EmailOwnImage = carriedLogo(500000);
    const html: string = `${logoTag(logo)}<p>${"a".repeat(1024 * 1024)}</p>${image(900000, "First")}${image(900000, "Second")}`;

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      html,
      MAX_EMAIL_BYTES,
      [logo],
    );

    expect(attached.wasFitted).toBe(true);
    expect(fileNames(attached)[0]).toBe("logo.png");
    expect(attached.html).toContain("image too large to include in this email");
    expect(attached.html).not.toContain("Acme Status: image too large");
    expect(EmailSize.getSizeInBytes(attached)).toBeLessThanOrEqual(
      MAX_EMAIL_BYTES,
    );
    pointsAtEveryAttachment(attached);
  });

  test("stays when HTML too big on its own is cut, and the whole is within the limit", () => {
    const logo: EmailOwnImage = carriedLogo(300000);
    const html: string = `${logoTag(logo)}<p>${"word ".repeat(1000000)}</p>`;

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      html,
      MAX_EMAIL_BYTES,
      [logo],
    );

    expect(attached.wasFitted).toBe(true);
    expect(fileNames(attached)).toEqual(["logo.png"]);
    expect(attached.html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
    expect(EmailSize.getSizeInBytes(attached)).toBeLessThanOrEqual(
      MAX_EMAIL_BYTES,
    );
    pointsAtEveryAttachment(attached);
  });

  test("is not attached when the HTML that showed it was cut away", () => {
    const logo: EmailOwnImage = carriedLogo(2000);

    // The logo's 2,668 characters of base64 leave too little for the text.
    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `<p>${"x".repeat(5000)}</p>${logoTag(logo)}`,
      7000,
      [logo],
    );

    expect(attached.wasFitted).toBe(true);
    expect(attached.inlineImages).toEqual([]);
    expect(attached.html).not.toContain("cid:");
  });

  test("a logo the HTML does not show is not attached", () => {
    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      "<p>Hello</p>",
      MAX_EMAIL_BYTES,
      [carriedLogo(2000)],
    );

    expect(attached.inlineImages).toEqual([]);
    expect(attached.html).toBe("<p>Hello</p>");
  });

  test("two logos the email carries each go once, in the order given", () => {
    const first: EmailOwnImage = carriedLogo(2000);
    const second: EmailOwnImage = {
      dataUri: pngDataUri(3000),
      fileName: "status-logo.png",
    };

    const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
      `${logoTag(second)}${logoTag(first)}${logoTag(first)}`,
      MAX_EMAIL_BYTES,
      [first, second],
    );

    expect(fileNames(attached)).toEqual(["logo.png", "status-logo.png"]);
    pointsAtEveryAttachment(attached);
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
