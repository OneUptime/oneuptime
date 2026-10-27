import EmailInlineImages, {
  EmailHtmlWithInlineImages,
  EmailInlineImage,
  MaxEmailInlineImageBytes,
  MaxEmailInlineImageCount,
} from "../../../../Server/Utils/Mail/EmailInlineImages";
import Markdown, {
  MarkdownContentType,
} from "../../../../Server/Types/Markdown";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * Just before an email is sent, every inline raster image its HTML holds
 * becomes an attachment the HTML points at by Content-ID: Gmail and Outlook
 * show that, and not a data: URL, and the HTML stays small enough for Gmail
 * not to clip it.
 */

// Real 1x1 images, as Buffer.toString("base64") writes them.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const CONTENT_ID_PATTERN: RegExp = /^[0-9a-f-]{36}@oneuptime$/;

// A PNG of about `byteCount` bytes: a real signature, then filler.
function pngOfSize(byteCount: number, filler: number = 0x5a): string {
  return Buffer.concat([
    Buffer.from(PNG, "base64").subarray(0, 8),
    Buffer.alloc(byteCount - 8, filler),
  ]).toString("base64");
}

function image(base64: string, mimeType: string = "image/png"): string {
  return `<img src="data:${mimeType};base64,${base64}" alt="Shot">`;
}

// Every src in the HTML.
function sourcesIn(html: string): Array<string> {
  return Array.from(
    html.matchAll(/\ssrc=["']([^"']*)["']/g),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("EmailInlineImages.attach - HTML with nothing to attach", () => {
  test.each([
    ["an empty body", ""],
    ["a body with no image", "<p>Hello <strong>world</strong></p>"],
    [
      "an https image",
      '<img src="https://oneuptime.example.com/logo.png" alt="Logo">',
    ],
    [
      "data: as text, not in an image",
      "<p>The response was data:image/png;base64,iVBORw0KGgo=</p>",
    ],
    [
      "an inline image in escaped text",
      `<p>&lt;img src="data:image/png;base64,${PNG}"&gt;</p>`,
    ],
    ["a data: link", `<a href="data:image/png;base64,${PNG}">Open</a>`],
    [
      "an image whose data: URL is an SVG",
      '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">',
    ],
    [
      "an image whose data: URL is not an image",
      '<img src="data:image/png;base64,AAAA" alt="x">',
    ],
    [
      "an inline image in another attribute",
      `<img data-src="data:image/png;base64,${PNG}" src="https://example.com/a.png">`,
    ],
    [
      "an inline image inside another attribute's value",
      `<img alt='see src="data:image/png;base64,${PNG}"' src="https://example.com/a.png">`,
    ],
    [
      "an image that is not an <img>",
      `<image src="data:image/png;base64,${PNG}">`,
    ],
  ])("leaves %s as it is", (_label: string, html: string) => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

    expect(attached.html).toBe(html);
    expect(attached.inlineImages).toEqual([]);
  });

  test("leaves a whole email with no inline image byte for byte as it is", async () => {
    const description: string = await Markdown.convertToHTML(
      "**API is down.**\n\n![Graph](https://cdn.example.com/g.png)\n\n| a | b |\n| - | - |\n| 1 | 2 |",
      MarkdownContentType.Email,
    );
    const html: string = `<!DOCTYPE html><html><body><table><tr><td>${description}</td></tr></table></body></html>`;

    expect(EmailInlineImages.attach(html)).toEqual({
      html: html,
      inlineImages: [],
    });
  });
});

describe("EmailInlineImages.attach - inline images", () => {
  test("moves an inline image into an attachment the HTML points at by Content-ID", () => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      `<p>Timeout 30000ms exceeded</p><p>${image(PNG)}</p>`,
    );

    expect(attached.inlineImages).toHaveLength(1);

    const attachment: EmailInlineImage = attached.inlineImages[0]!;

    expect(attachment.contentId).toMatch(CONTENT_ID_PATTERN);
    expect(attachment).toEqual({
      contentId: attachment.contentId,
      fileName: "image-1.png",
      mimeType: "image/png",
      base64: PNG,
      byteLength: Buffer.from(PNG, "base64").length,
    });
    expect(attached.html).toBe(
      `<p>Timeout 30000ms exceeded</p><p><img src="cid:${attachment.contentId}" alt="Shot"></p>`,
    );
    expect(attached.html).not.toContain("data:");
  });

  test("attaches each image as the type its bytes are", () => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      image(JPEG, "image/png"),
    );

    expect(attached.inlineImages[0]).toMatchObject({
      fileName: "image-1.jpg",
      mimeType: "image/jpeg",
      base64: JPEG,
    });
  });

  test("attaches several images in the order the HTML holds them", () => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      [image(PNG), "<p>and</p>", image(JPEG, "image/jpeg")].join(""),
    );

    expect(
      attached.inlineImages.map((attachment: EmailInlineImage) => {
        return [attachment.fileName, attachment.mimeType];
      }),
    ).toEqual([
      ["image-1.png", "image/png"],
      ["image-2.jpg", "image/jpeg"],
    ]);
    expect(sourcesIn(attached.html)).toEqual(
      attached.inlineImages.map((attachment: EmailInlineImage) => {
        return `cid:${attachment.contentId}`;
      }),
    );
    expect(attached.inlineImages[0]!.contentId).not.toBe(
      attached.inlineImages[1]!.contentId,
    );
  });

  test("attaches the same image once, however often the HTML shows it", () => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      [image(PNG), image(PNG), image(PNG, "image/gif")].join(""),
    );

    expect(attached.inlineImages).toHaveLength(1);
    expect(sourcesIn(attached.html)).toEqual([
      `cid:${attached.inlineImages[0]!.contentId}`,
      `cid:${attached.inlineImages[0]!.contentId}`,
      `cid:${attached.inlineImages[0]!.contentId}`,
    ]);
  });

  test("gives every email its own Content-IDs", () => {
    const first: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      image(PNG),
    );
    const second: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      image(PNG),
    );

    expect(first.inlineImages[0]!.contentId).not.toBe(
      second.inlineImages[0]!.contentId,
    );
  });

  test("keeps every other attribute, and the HTML around the image, as it is", () => {
    const html: string = `<div class="card"><img alt="Login &amp; &quot;form&quot;" src="data:image/png;base64,${PNG}" title="t" style="max-width:100%;height:auto;" width="400"></div>`;

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);
    const contentId: string = attached.inlineImages[0]!.contentId;

    expect(attached.html).toBe(
      `<div class="card"><img alt="Login &amp; &quot;form&quot;" src="cid:${contentId}" title="t" style="max-width:100%;height:auto;" width="400"></div>`,
    );
  });

  test.each([
    ["a single-quoted src", `<img src='data:image/png;base64,${PNG}'>`],
    ["an unquoted src", `<img src=data:image/png;base64,${PNG}>`],
    [
      "an upper-case tag and attribute",
      `<IMG SRC="data:image/png;base64,${PNG}">`,
    ],
    ["spaces around the =", `<img src = "data:image/png;base64,${PNG}">`],
    ["a self-closing tag", `<img src="data:image/png;base64,${PNG}" />`],
    ["a line break before src", `<img\nsrc="data:image/png;base64,${PNG}">`],
  ])("reads %s", (_label: string, html: string) => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.html).toContain(
      `cid:${attached.inlineImages[0]!.contentId}`,
    );
    expect(attached.html).not.toContain("data:");
  });

  test("reads the first src, as HTML does", () => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      `<img src="https://example.com/a.png" src="data:image/png;base64,${PNG}">`,
    );

    expect(attached.inlineImages).toEqual([]);
  });

  test("attaches what the email renderer wrote for a screenshot", async () => {
    const description: string = await Markdown.convertToHTML(
      `Timeout 30000ms exceeded\n![](data:image/png;base64,${PNG})`,
      MarkdownContentType.Email,
    );

    const attached: EmailHtmlWithInlineImages =
      EmailInlineImages.attach(description);

    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.html).toBe(
      `<p>Timeout 30000ms exceeded\n<img src="cid:${attached.inlineImages[0]!.contentId}" alt="" style="max-width:100%;height:auto;"></p>\n`,
    );
  });
});

describe("EmailInlineImages.attach - what one email may carry", () => {
  test("allows two megabytes in twenty images by default", () => {
    expect(MaxEmailInlineImageBytes).toBe(2 * 1024 * 1024);
    expect(MaxEmailInlineImageCount).toBe(20);
  });

  test("attaches images up to the total, and leaves the rest out with a note", () => {
    const first: string = pngOfSize(600, 0x41);
    const second: string = pngOfSize(300, 0x42);
    const third: string = pngOfSize(200, 0x43);

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      [
        `<img src="data:image/png;base64,${first}" alt="Chromium">`,
        `<img src="data:image/png;base64,${second}" alt="Firefox">`,
        `<img src="data:image/png;base64,${third}" alt="Webkit">`,
      ].join(""),
      { maxTotalBytes: 1000 },
    );

    // 600 + 300 fits in 1000; 200 more does not.
    expect(
      attached.inlineImages.map((attachment: EmailInlineImage) => {
        return attachment.byteLength;
      }),
    ).toEqual([600, 300]);
    expect(attached.html).toContain(
      `<img src="cid:${attached.inlineImages[0]!.contentId}" alt="Chromium">`,
    );
    expect(attached.html).toContain(
      `<img src="cid:${attached.inlineImages[1]!.contentId}" alt="Firefox">`,
    );
    expect(attached.html).toContain(
      '<span style="color:#64748b;font-style:italic;">[Webkit: image too large to include in this email]</span>',
    );
    expect(attached.html).not.toContain("data:");
  });

  test("a smaller image after one that did not fit is still attached", () => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      [
        image(pngOfSize(900, 0x41)),
        image(pngOfSize(500, 0x42)),
        image(pngOfSize(50, 0x43)),
      ].join(""),
      { maxTotalBytes: 1000 },
    );

    expect(
      attached.inlineImages.map((attachment: EmailInlineImage) => {
        return attachment.byteLength;
      }),
    ).toEqual([900, 50]);
    expect(attached.html.match(/image too large/g)).toHaveLength(1);
  });

  test("an image larger than the whole allowance is left out on its own", () => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      `<p>Before</p><img src="data:image/png;base64,${pngOfSize(5000)}" alt=""><p>After</p>`,
      { maxTotalBytes: 1000 },
    );

    expect(attached.inlineImages).toEqual([]);
    expect(attached.html).toBe(
      '<p>Before</p><span style="color:#64748b;font-style:italic;">[Image too large to include in this email]</span><p>After</p>',
    );
  });

  test("a repeat of an attached image costs nothing more", () => {
    const shot: string = pngOfSize(600);

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      [image(shot), image(shot), image(shot)].join(""),
      { maxTotalBytes: 1000 },
    );

    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.html).not.toContain("too large");
  });

  test("attaches no more images than the count allows", () => {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      [1, 2, 3, 4]
        .map((filler: number) => {
          return image(pngOfSize(20, filler));
        })
        .join(""),
      { maxCount: 3 },
    );

    expect(attached.inlineImages).toHaveLength(3);
    expect(attached.html.match(/cid:/g)).toHaveLength(3);
    expect(attached.html.match(/image too large/g)).toHaveLength(1);
  });

  test("the default allowance keeps a request to Microsoft Graph under its 4 MB", () => {
    const shots: Array<string> = [0x41, 0x42, 0x43].map((filler: number) => {
      return pngOfSize(900 * 1024, filler);
    });

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      shots
        .map((shot: string) => {
          return image(shot);
        })
        .join(""),
    );

    // Two screenshots of 900 KB fit in 2 MB; a third does not.
    expect(attached.inlineImages).toHaveLength(2);

    const base64Bytes: number = attached.inlineImages.reduce(
      (total: number, attachment: EmailInlineImage) => {
        return total + attachment.base64.length;
      },
      0,
    );

    expect(base64Bytes + attached.html.length).toBeLessThan(3.5 * 1024 * 1024);
  });

  test("the note keeps a left-out image's alt text, escaped as it was", async () => {
    const description: string = await Markdown.convertToHTML(
      `![a <b>bold</b> & "quoted" shot](data:image/png;base64,${pngOfSize(5000)})`,
      MarkdownContentType.Email,
    );

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      description,
      { maxTotalBytes: 1000 },
    );

    expect(attached.inlineImages).toEqual([]);
    expect(attached.html).toBe(
      '<p><span style="color:#64748b;font-style:italic;">[a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; shot: image too large to include in this email]</span></p>\n',
    );
  });

  test("an <img> with a raw < or > in an attribute is not read as an image at all", () => {
    const html: string = `<img src="data:image/png;base64,${PNG}" alt='a <b>bold</b> shot'>`;

    expect(EmailInlineImages.attach(html)).toEqual({
      html: html,
      inlineImages: [],
    });
  });
});

describe("EmailInlineImages.attach - linear time", () => {
  test("a body full of unclosed <img tags", () => {
    const html: string = `${"<img src='data:image/png;base64,".repeat(20000)}`;

    const timed: FastestRun<EmailHtmlWithInlineImages> = fastestRun({
      run: (): EmailHtmlWithInlineImages => {
        return EmailInlineImages.attach(html);
      },
      limitInMs: 5000,
    });
    const attached: EmailHtmlWithInlineImages = timed.result;

    expect(timed.inMs).toBeLessThan(5000);
    expect(attached.html).toBe(html);
  });

  test("a long tag with an unterminated quote before its src", () => {
    const html: string = `<img a='${" b=c".repeat(50000)} src="data:image/png;base64,${PNG}">`;

    const timed: FastestRun<EmailHtmlWithInlineImages> = fastestRun({
      run: (): EmailHtmlWithInlineImages => {
        return EmailInlineImages.attach(html);
      },
      limitInMs: 5000,
    });
    const attached: EmailHtmlWithInlineImages = timed.result;

    expect(timed.inMs).toBeLessThan(5000);
    expect(attached.inlineImages).toHaveLength(1);
  });

  test("an email with a screenshot of several megabytes", () => {
    const shot: string = pngOfSize(1536 * 1024);
    const html: string = `<html><body>${"<p>text</p>".repeat(1000)}${image(shot)}</body></html>`;

    const timed: FastestRun<EmailHtmlWithInlineImages> = fastestRun({
      run: (): EmailHtmlWithInlineImages => {
        return EmailInlineImages.attach(html);
      },
      limitInMs: 5000,
    });
    const attached: EmailHtmlWithInlineImages = timed.result;

    expect(timed.inMs).toBeLessThan(5000);
    expect(attached.inlineImages[0]!.base64).toBe(shot);
    expect(attached.html.length).toBeLessThan(20000);
  });
});

describe("EmailInlineImages.attachImage - an image of the email's own", () => {
  /*
   * OneUptime's logo in an email's header (EmailLogo): attached by the
   * name it is given, held to no limit and never left out - the caller
   * counts it (EmailSize.attachWithinLimit).
   */
  const own: { dataUri: string; fileName: string } = {
    dataUri: `data:image/png;base64,${PNG}`,
    fileName: "oneuptime-logo.png",
  };

  test("every <img> that shows it points at one attachment by its name", () => {
    const html: string = `${image(PNG)}<p>Hi</p>${image(PNG)}`;

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attachImage(
      html,
      own,
    );

    expect(attached.inlineImages).toHaveLength(1);

    const attachment: EmailInlineImage = attached.inlineImages[0]!;

    expect(attachment).toEqual({
      contentId: attachment.contentId,
      fileName: "oneuptime-logo.png",
      mimeType: "image/png",
      base64: PNG,
      byteLength: Buffer.from(PNG, "base64").length,
    });
    expect(attachment.contentId).toMatch(CONTENT_ID_PATTERN);
    expect(sourcesIn(attached.html)).toEqual([
      `cid:${attachment.contentId}`,
      `cid:${attachment.contentId}`,
    ]);
  });

  test("leaves every other image alone, an inline one included", () => {
    const html: string = `${image(JPEG, "image/jpeg")}<img src="https://oneuptime.example.com/a.png" alt="A">`;

    expect(EmailInlineImages.attachImage(html, own)).toEqual({
      html: html,
      inlineImages: [],
    });
  });

  test("is held to no limit: it is the caller's to count", () => {
    const big: string = pngOfSize(MaxEmailInlineImageBytes + 1024);

    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attachImage(
      image(big),
      { dataUri: `data:image/png;base64,${big}`, fileName: "big.png" },
    );

    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.html).not.toContain("too large");
  });

  test.each([
    ["an empty body", ""],
    ["a body without it", "<p>Hello</p>"],
    ["its data: URL only as text", `<p>data:image/png;base64,${PNG}</p>`],
    [
      "its data: URL only in another attribute",
      `<img data-src="data:image/png;base64,${PNG}" src="https://example.com/a.png">`,
    ],
  ])("%s comes back exactly as it was", (_label: string, html: string) => {
    expect(EmailInlineImages.attachImage(html, own)).toEqual({
      html: html,
      inlineImages: [],
    });
  });

  test("an image that is not an inline raster image is never attached", () => {
    const svg: string = "data:image/svg+xml;base64,PHN2Zy8+";
    const html: string = `<img src="${svg}" alt="x">`;

    expect(
      EmailInlineImages.attachImage(html, { dataUri: svg, fileName: "x.svg" }),
    ).toEqual({ html: html, inlineImages: [] });
  });

  test("a body full of unclosed <img tags, in linear time", () => {
    const html: string = `${"<img src='data:image/png;base64,".repeat(20000)}data:image/png;base64,${PNG}`;

    const timed: FastestRun<EmailHtmlWithInlineImages> = fastestRun({
      run: (): EmailHtmlWithInlineImages => {
        return EmailInlineImages.attachImage(html, own);
      },
      limitInMs: 2000,
    });
    const attached: EmailHtmlWithInlineImages = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(attached.html).toBe(html);
  });
});

/*
 * An email a mail service would not take with its images goes once more
 * without them (MailService, InlineImageRefusal): each image a text placed
 * becomes a note, as an image too large for the email does, saying it could
 * not be included.
 */
describe("EmailInlineImages.leaveOut - an email without its images", () => {
  test("each inline image becomes a note with its alt text", () => {
    expect(
      EmailInlineImages.leaveOut(
        `<p>Before</p>${image(PNG)}<p>After</p>${image(JPEG, "image/jpeg")}`,
      ),
    ).toBe(
      '<p>Before</p><span style="color:#64748b;font-style:italic;">[Shot: image could not be included in this email]</span><p>After</p><span style="color:#64748b;font-style:italic;">[Shot: image could not be included in this email]</span>',
    );
  });

  test("an image without alt text says so plainly", () => {
    expect(
      EmailInlineImages.leaveOut(
        `<img src="data:image/png;base64,${PNG}" alt="">`,
      ),
    ).toBe(
      '<span style="color:#64748b;font-style:italic;">[Image could not be included in this email]</span>',
    );
  });

  test("the note keeps the alt text escaped, as the renderer wrote it", async () => {
    const description: string = await Markdown.convertToHTML(
      `![a <b>bold</b> & "quoted" shot](data:image/png;base64,${PNG})`,
      MarkdownContentType.Email,
    );

    expect(EmailInlineImages.leaveOut(description)).toBe(
      '<p><span style="color:#64748b;font-style:italic;">[a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; shot: image could not be included in this email]</span></p>\n',
    );
  });

  test("leaves out exactly what attach() would attach, and nothing else", () => {
    const html: string = [
      image(PNG),
      '<img src="https://oneuptime.example.com/logo.png" alt="Logo">',
      `<img src="data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}" alt="Vector">`,
      "<p>The response was data:image/png;base64,iVBORw0KGgo=</p>",
      `<img alt="Second" src="data:image/png;base64,${PNG}">`,
    ].join("");

    const left: string = EmailInlineImages.leaveOut(html);

    expect(sourcesIn(left)).toEqual(
      sourcesIn(EmailInlineImages.attach(html).html).filter(
        (source: string): boolean => {
          return !source.startsWith("cid:");
        },
      ),
    );
    expect(left).toContain(
      '<img src="https://oneuptime.example.com/logo.png" alt="Logo">',
    );
    expect(left).toContain('alt="Vector"');
    expect(left).toContain(
      "<p>The response was data:image/png;base64,iVBORw0KGgo=</p>",
    );
    expect(left).toContain("[Second: image could not be included");
    expect(left).not.toContain(PNG);
  });

  test("no limit applies: every image is left out, however small or few", () => {
    const html: string = `${image(PNG)}${image(PNG)}`;

    expect(
      EmailInlineImages.leaveOut(html).match(/could not be included/g),
    ).toHaveLength(2);
    expect(EmailInlineImages.attach(EmailInlineImages.leaveOut(html))).toEqual({
      html: EmailInlineImages.leaveOut(html),
      inlineImages: [],
    });
  });

  test.each([
    ["an empty body", ""],
    ["a body with no image", "<p>Hello <strong>world</strong></p>"],
    [
      "an https image",
      '<img src="https://oneuptime.example.com/logo.png" alt="Logo">',
    ],
    ["an image already a Content-ID", '<img src="cid:a@oneuptime" alt="">'],
  ])("%s comes back exactly as it was", (_name: string, html: string) => {
    expect(EmailInlineImages.leaveOut(html)).toBe(html);
  });

  test("is done once: leaving out again changes nothing", () => {
    const once: string = EmailInlineImages.leaveOut(image(PNG));

    expect(EmailInlineImages.leaveOut(once)).toBe(once);
  });

  test("a body full of unclosed <img tags, in linear time", () => {
    const html: string = `${"<img src='data:image/png;base64,".repeat(20000)}`;

    const run: FastestRun<string> = fastestRun({
      run: (): string => {
        return EmailInlineImages.leaveOut(html);
      },
      limitInMs: 2000,
    });

    expect(html.length).toBeGreaterThan(400000);
    expect(run.inMs).toBeLessThan(2000);
    expect(run.result).toBe(html);
  });
});
