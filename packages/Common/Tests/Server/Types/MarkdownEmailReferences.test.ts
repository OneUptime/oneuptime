import Markdown, {
  EMAIL_IMAGE_STYLE,
  MAX_EMAIL_COPIED_HTML_IN_REFERENCES,
  MAX_EMAIL_HELD_TEXT_IN_REFERENCES,
  MarkdownContentType,
} from "../../../Server/Types/Markdown";
import EmailInlineImages from "../../../Server/Utils/Mail/EmailInlineImages";
import EmailSize, {
  EMAIL_TRUNCATED_TEXT_NOTE_HTML,
  MAX_EMAIL_FIELD_HTML_BYTES,
} from "../../../Server/Utils/Mail/EmailSize";
import {
  OVER_LONG_LINE_KEPT_LENGTH,
  OVER_LONG_LINE_LENGTH,
} from "../../../Utils/Markdown/OverLongText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import crypto from "crypto";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { Renderer, marked } from "marked";

/*
 * ISSUES #6481 AND #6962: WHAT A LINK REFERENCE DEFINITION COPIES INTO AN
 * EMAIL.
 *
 * A description can show one screenshot several times: define it once as a
 * Markdown link reference definition and point several images at it.
 *
 *   ![Home][home]
 *   ![Home, again][home]
 *
 *   [home]: data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}}
 *
 * marked writes the definition's address and title into every reference
 * to it, and the email renderer put the screenshot's data back into each
 * one: a screenshot of 1 MB referenced 200 times was 280 MB of HTML before
 * its images went out as attachments, and one of 2.25 MB more than V8's
 * longest string, so the email went out as its Markdown in text. A
 * definition under 64 KB, with nothing held back, was copied whole into
 * every reference: 200 references to an address of 60 KB, or to a title of
 * 2 KB, were more HTML than an email field keeps, the field was cut, and
 * its references showed as Markdown (#6962).
 *
 * Now the first reference to a definition has the text's own copy, as an
 * image or a link has its own address, and renders as it always did. Copies
 * are counted in one render: copies of screenshots, which go out as
 * attachments, while they put back at most MAX_EMAIL_HELD_TEXT_IN_REFERENCES
 * (8 MiB); copies of every other address - a link's, an image's from the
 * web - and copies of titles, which stay in the email's HTML, while each
 * kind writes at most MAX_EMAIL_COPIED_HTML_IN_REFERENCES (64 KiB). Past its
 * budget, an image is the note an email leaves in place of an image too
 * large to include, a link is its text, and a title is left out. A copy of
 * a held-back title is never kept, and an address an email cannot keep - a
 * data: link above all - is not put back at all.
 *
 * These test the renderer: Markdown.convertToHTML, and where a test needs
 * addresses longer than an email field keeps, the renderer's step before
 * the field is held to its size (renderEmailMarkdown; MarkdownEmailSizeCap
 * tests that step). SyntheticScreenshotInEmail.test.ts runs the whole way
 * from the probe to the attachments, and HugeTextInLongRunningProcess runs
 * it where V8 compiles regular expressions unoptimized.
 */

const MOST: number = MAX_EMAIL_HELD_TEXT_IN_REFERENCES;
const COPIED: number = MAX_EMAIL_COPIED_HTML_IN_REFERENCES;

// What comes before a PNG screenshot's data in its address.
const PNG_PREFIX: string = "data:image/png;base64,";

/*
 * A JPEG's: a character longer. Data of any of these types is an inline
 * image whatever its bytes are, and is written as its bytes say.
 */
const JPEG_PREFIX: string = "data:image/jpeg;base64,";

// A real 1x1 PNG, as the probe reports a screenshot: too short to hold back.
const ONE_PIXEL_PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The bytes a PNG file starts with: what makes data an inline image.
const PNG_SIGNATURE: Buffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/*
 * A PNG screenshot as base64 of exactly `length` characters, a multiple of
 * four: a real signature, then `filler`. Two of one length with another
 * filler are two different screenshots.
 */
const screenshotOfLength: (length: number, filler?: number) => string = (
  length: number,
  filler: number = 0x5a,
): string => {
  if (length % 4 !== 0) {
    throw new Error(`Base64 without padding is a multiple of 4: ${length}`);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    Buffer.alloc((length / 4) * 3 - PNG_SIGNATURE.length, filler),
  ]).toString("base64");
};

/*
 * An https address of exactly `length` characters. On a definition's line
 * it makes the line longer than 64 KB, so its middle is held back from
 * marked, and every reference to it puts it back.
 */
const httpsAddressOfLength: (length: number) => string = (
  length: number,
): string => {
  const start: string = "https://status.example.com/";

  return start + "a".repeat(length - start.length);
};

// A long string as a short one, so a failure never prints megabytes.
const fingerprint: (value: string) => string = (value: string): string => {
  return `${value.length}:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
};

/*
 * The value of every `attribute`="..." that follows `opening` in `html` -
 * read with indexOf: the HTML holds megabytes of base64.
 */
const valuesAfter: (html: string, opening: string) => Array<string> = (
  html: string,
  opening: string,
): Array<string> => {
  const values: Array<string> = [];

  for (
    let at: number = html.indexOf(opening);
    at !== -1;
    at = html.indexOf(opening, at + opening.length)
  ) {
    const start: number = at + opening.length;

    values.push(html.slice(start, html.indexOf('"', start)));
  }

  return values;
};

// The src of every <img> the renderer wrote, as fingerprints.
const imageSourcesIn: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return valuesAfter(html, '<img src="').map(fingerprint);
};

// The href of every <a> the renderer wrote, as fingerprints.
const linkAddressesIn: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return valuesAfter(html, '<a href="').map(fingerprint);
};

// How many times `part` is in `text`.
const countOf: (text: string, part: string) => number = (
  text: string,
  part: string,
): number => {
  return text.split(part).length - 1;
};

const render: (markdown: string) => Promise<string> = (
  markdown: string,
): Promise<string> => {
  return Markdown.convertToHTML(markdown, MarkdownContentType.Email);
};

/*
 * The renderer's step alone, before an email field is held to what an
 * email carries: for addresses longer than a field keeps (a link's address
 * stays in the HTML, where a screenshot goes out as an attachment), so a
 * test sees what the renderer put back.
 */
const renderOnePiece: (markdown: string) => Promise<string> = async (
  markdown: string,
): Promise<string> => {
  // The renderer set up as convertToHTML sets it up.
  await render("");

  return await Markdown["renderEmailMarkdown"](
    markdown,
    Markdown["getEmailRenderer"](),
  );
};

// What the email shows in place of an image past the budget.
const leftOut: (alt: string) => string = (alt: string): string => {
  return EmailInlineImages.getTooLargeImageNotice(alt);
};

/*
 * Every address the renderer judged (getEmailUrl), as their lengths: an
 * address an email cannot keep is not put back, so it is never judged
 * whole.
 */
const watchJudgedAddresses: () => SpyInstance<
  typeof Markdown.getEmailUrl
> = (): SpyInstance<typeof Markdown.getEmailUrl> => {
  return jest.spyOn(Markdown, "getEmailUrl");
};

const lengthsJudged: (
  judged: SpyInstance<typeof Markdown.getEmailUrl>,
) => Array<number> = (
  judged: SpyInstance<typeof Markdown.getEmailUrl>,
): Array<number> => {
  return judged.mock.calls.map(
    (call: Parameters<typeof Markdown.getEmailUrl>): number => {
      return String(call[0] ?? "").length;
    },
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Markdown email renderer - what references copy (#6481)", () => {
  test("copies may put back eight mebibytes in an email field", () => {
    expect(MAX_EMAIL_HELD_TEXT_IN_REFERENCES).toBe(8 * 1024 * 1024);
  });

  test("two references to one screenshot show it twice, each with its whole address", async () => {
    const shot: string = screenshotOfLength(40 * 1024);

    const html: string = await render(
      `![Home][home]\n![Home, again][home]\n\n[home]: ${PNG_PREFIX}${shot}`,
    );

    expect(imageSourcesIn(html)).toEqual([
      fingerprint(PNG_PREFIX + shot),
      fingerprint(PNG_PREFIX + shot),
    ]);
    expect(html).toContain('alt="Home"');
    expect(html).toContain('alt="Home, again"');
  });

  test("a screenshot referenced past the budget: the text's own and the copies within it are shown, every other reference is the note", async () => {
    const shot: string = screenshotOfLength(4 * 350 * 1024);
    const address: number = PNG_PREFIX.length + shot.length;
    const copiesKept: number = Math.floor(MOST / address);
    const references: Array<string> = [];

    for (let index: number = 0; index < 12; index++) {
      references.push(`![Home ${index}][home]`);
    }

    // The arithmetic the test stands on: some copies kept, some not.
    expect(copiesKept).toBe(5);

    const html: string = await render(
      `${references.join("\n")}\n\n[home]: ${PNG_PREFIX}${shot}`,
    );

    expect(imageSourcesIn(html)).toEqual(
      new Array<string>(1 + copiesKept).fill(fingerprint(PNG_PREFIX + shot)),
    );

    for (let index: number = 0; index < 12; index++) {
      expect(countOf(html, leftOut(`Home ${index}`))).toBe(
        index <= copiesKept ? 0 : 1,
      );
    }

    // In its place: the paragraph keeps every line, image or note.
    expect(html.startsWith('<p><img src="data:image/png;base64,')).toBe(true);
    expect(html.endsWith(`${leftOut("Home 11")}</p>\n`)).toBe(true);
  });

  test("the note is the one an email leaves for an image too large, its alt text escaped as marked wrote it", async () => {
    // One copy is more than the budget.
    const shot: string = screenshotOfLength(MOST);

    const html: string = await render(
      [
        "Before ![Home][home] and",
        '![a <b>bold</b> & "quoted" shot][home] after',
        "",
        `[home]: ${PNG_PREFIX}${shot}`,
      ].join("\n"),
    );

    expect(imageSourcesIn(html)).toEqual([fingerprint(PNG_PREFIX + shot)]);
    expect(
      html.endsWith(
        '\n<span style="color:#64748b;font-style:italic;">[a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; shot: image too large to include in this email]</span> after</p>\n',
      ),
    ).toBe(true);
  });

  test("an image with no alt text past the budget says so plainly", async () => {
    const shot: string = screenshotOfLength(MOST);

    const html: string = await render(
      `![][home] ![][home]\n\n[home]: ${PNG_PREFIX}${shot}`,
    );

    expect(imageSourcesIn(html)).toHaveLength(1);
    expect(html).toContain(
      '<span style="color:#64748b;font-style:italic;">[Image too large to include in this email]</span>',
    );
  });

  test("the text's own copy is put back however long: an image's own address", async () => {
    const shot: string = screenshotOfLength(MOST + 4);

    const html: string = await render(`![Home](${PNG_PREFIX}${shot})`);

    expect(imageSourcesIn(html)).toEqual([fingerprint(PNG_PREFIX + shot)]);
  });

  test("the text's own copy is put back however long: a definition's first reference", async () => {
    const shot: string = screenshotOfLength(MOST + 4);

    const html: string = await render(
      `![Home][home] ![Again][home]\n\n[home]: ${PNG_PREFIX}${shot}`,
    );

    expect(imageSourcesIn(html)).toEqual([fingerprint(PNG_PREFIX + shot)]);
    expect(html).toContain(leftOut("Again"));
  });

  test("two inline images of the same screenshot are each the text's own, however long", async () => {
    const shot: string = screenshotOfLength(MOST + 4);

    const html: string = await render(
      `![One](${PNG_PREFIX}${shot})\n\n![Two](${PNG_PREFIX}${shot})`,
    );

    expect(imageSourcesIn(html)).toEqual([
      fingerprint(PNG_PREFIX + shot),
      fingerprint(PNG_PREFIX + shot),
    ]);
  });

  test("references find their definition whatever its case, and are copies all the same", async () => {
    const shot: string = screenshotOfLength(MOST);

    const html: string = await render(
      `![One][Home] ![Two][HOME] ![Three][home]\n\n[home]: ${PNG_PREFIX}${shot}`,
    );

    expect(imageSourcesIn(html)).toHaveLength(1);
    expect(html).toContain(leftOut("Two"));
    expect(html).toContain(leftOut("Three"));
  });

  test("only the first definition of a label is read, as marked reads it: a second is never put back", async () => {
    const first: string = screenshotOfLength(64 * 1024, 0x41);
    const second: string = screenshotOfLength(64 * 1024, 0x42);

    const html: string = await render(
      [
        "![One][home] ![Two][home]",
        "",
        `[home]: ${PNG_PREFIX}${first}`,
        "",
        `[home]: ${PNG_PREFIX}${second}`,
      ].join("\n"),
    );

    expect(imageSourcesIn(html)).toEqual([
      fingerprint(PNG_PREFIX + first),
      fingerprint(PNG_PREFIX + first),
    ]);
    // "BBB" as base64: the second screenshot's filler.
    expect(html.indexOf("QkJCQkJC")).toBe(-1);
  });

  test("a definition no reference reads is never put back", async () => {
    const shot: string = screenshotOfLength(64 * 1024, 0x42);

    const html: string = await render(
      `Nothing refers to it.\n\n[home]: ${PNG_PREFIX}${shot}`,
    );

    expect(html).toBe("<p>Nothing refers to it.</p>\n");
  });

  test("a copy past the budget leaves what is left of it to a smaller copy after it", async () => {
    // Two copies of the big one are more than the budget; one is not.
    const big: string = screenshotOfLength(4 * 1200 * 1024, 0x41);
    const small: string = screenshotOfLength(4 * 300 * 1024, 0x42);

    expect(2 * (PNG_PREFIX.length + big.length)).toBeGreaterThan(MOST);
    expect(
      PNG_PREFIX.length + big.length + PNG_PREFIX.length + small.length,
    ).toBeLessThanOrEqual(MOST);

    const html: string = await render(
      [
        "![Big 1][big] ![Big 2][big] ![Big 3][big]",
        "![Small 1][small] ![Small 2][small]",
        "",
        `[big]: ${PNG_PREFIX}${big}`,
        `[small]: ${PNG_PREFIX}${small}`,
      ].join("\n"),
    );

    expect(imageSourcesIn(html)).toEqual([
      fingerprint(PNG_PREFIX + big),
      fingerprint(PNG_PREFIX + big),
      fingerprint(PNG_PREFIX + small),
      fingerprint(PNG_PREFIX + small),
    ]);
    expect(html).toContain(leftOut("Big 3"));
  });

  test("copies of an image from the web take nothing of what copies of screenshots may put back", async () => {
    // One copy of it is all but two characters of the budget.
    const shot: string = screenshotOfLength(MOST - 24);
    const references: Array<string> = [];

    expect(PNG_PREFIX.length + shot.length).toBe(MOST - 2);

    for (let index: number = 0; index < 50; index++) {
      references.push(`![Logo ${index}][logo]`);
    }

    const html: string = await render(
      [
        references.join(" "),
        "![Home][home] ![Again][home]",
        "",
        "[logo]: https://status.example.com/logo.png",
        `[home]: ${PNG_PREFIX}${shot}`,
      ].join("\n"),
    );

    // The shot's one copy is the whole budget, the logo's took none of it.
    expect(
      countOf(html, '<img src="https://status.example.com/logo.png"'),
    ).toBe(50);
    expect(imageSourcesIn(html).slice(50)).toEqual([
      fingerprint(PNG_PREFIX + shot),
      fingerprint(PNG_PREFIX + shot),
    ]);
  });

  test("each render starts afresh: the same text renders the same, however often", async () => {
    const shot: string = screenshotOfLength(4 * 1024 * 1024);
    const markdown: string = `![One][home] ![Two][home] ![Three][home]\n\n[home]: ${PNG_PREFIX}${shot}`;

    const first: string = await render(markdown);
    const second: string = await render(markdown);

    expect(fingerprint(second)).toBe(fingerprint(first));
    expect(imageSourcesIn(first)).toHaveLength(2);
  });
});

describe("Markdown email renderer - the budgets' boundaries (#6481, #6962)", () => {
  // How a reference is written: an image, or a link.
  type WriteReference = (text: string, label: string) => string;

  const image: WriteReference = (text: string, label: string): string => {
    return `![${text}][${label}]`;
  };

  const link: WriteReference = (text: string, label: string): string => {
    return `[${text}][${label}]`;
  };

  /*
   * Two definitions, each referenced twice: the second reference to each is
   * a copy, so the copies of the two come to exactly a budget, or to one
   * more.
   */
  const twoReferencedTwice: (
    write: WriteReference,
    one: string,
    two: string,
  ) => string = (write: WriteReference, one: string, two: string): string => {
    return [
      [
        write("One", "one"),
        write("One again", "one"),
        write("Two", "two"),
        write("Two again", "two"),
      ].join(" "),
      "",
      `[one]: ${one}`,
      `[two]: ${two}`,
    ].join("\n");
  };

  test("copies of addresses and of titles that stay in the HTML may each write a quarter of what a field keeps", () => {
    expect(COPIED).toBe(64 * 1024);
    expect(4 * COPIED).toBe(MAX_EMAIL_FIELD_HTML_BYTES);
  });

  describe("copies of screenshots", () => {
    const ONE: string = PNG_PREFIX + screenshotOfLength(4 * 1024 * 1024, 0x41);
    // The rest of the budget, as a PNG's data.
    const TWO_DATA: string = screenshotOfLength(
      MOST - ONE.length - PNG_PREFIX.length,
      0x42,
    );

    test("coming to exactly the budget, every copy is shown", async () => {
      const two: string = PNG_PREFIX + TWO_DATA;

      expect(ONE.length + two.length).toBe(MOST);

      const html: string = await render(twoReferencedTwice(image, ONE, two));

      expect(imageSourcesIn(html)).toEqual([
        fingerprint(ONE),
        fingerprint(ONE),
        fingerprint(two),
        fingerprint(two),
      ]);
    });

    test("one character more, and the last copy is the note", async () => {
      // A PNG under a JPEG's media type: an inline image all the same.
      const two: string = JPEG_PREFIX + TWO_DATA;

      expect(ONE.length + two.length).toBe(MOST + 1);

      const html: string = await render(twoReferencedTwice(image, ONE, two));

      // Written as its parser rebuilt it: a PNG's address.
      expect(imageSourcesIn(html)).toEqual([
        fingerprint(ONE),
        fingerprint(ONE),
        fingerprint(PNG_PREFIX + TWO_DATA),
      ]);
      expect(html.endsWith(`${leftOut("Two again")}</p>\n`)).toBe(true);
    });
  });

  describe("copies of addresses that stay in the HTML", () => {
    const HALF: string = httpsAddressOfLength(COPIED / 2);

    test.each([
      ["links", link, linkAddressesIn],
      ["images from the web", image, imageSourcesIn],
    ])(
      "%s: coming to exactly the budget, every copy is kept",
      async (
        _name: string,
        write: WriteReference,
        addressesIn: (html: string) => Array<string>,
      ) => {
        const two: string = httpsAddressOfLength(COPIED / 2);
        const html: string = await render(twoReferencedTwice(write, HALF, two));

        expect(addressesIn(html)).toEqual([
          fingerprint(HALF),
          fingerprint(HALF),
          fingerprint(two),
          fingerprint(two),
        ]);
      },
    );

    test("links: one character more, and the last copy is its text", async () => {
      const two: string = httpsAddressOfLength(COPIED / 2 + 1);
      const html: string = await render(twoReferencedTwice(link, HALF, two));

      expect(linkAddressesIn(html)).toEqual([
        fingerprint(HALF),
        fingerprint(HALF),
        fingerprint(two),
      ]);
      expect(html.endsWith("</a> Two again</p>\n")).toBe(true);
    });

    test("images from the web: one character more, and the last copy is the note", async () => {
      const two: string = httpsAddressOfLength(COPIED / 2 + 1);
      const html: string = await render(twoReferencedTwice(image, HALF, two));

      expect(imageSourcesIn(html)).toEqual([
        fingerprint(HALF),
        fingerprint(HALF),
        fingerprint(two),
      ]);
      expect(html.endsWith(`${leftOut("Two again")}</p>\n`)).toBe(true);
    });

    test("links and images from the web take of one budget, in the order of the text", async () => {
      const two: string = httpsAddressOfLength(COPIED / 2 + 1);
      const html: string = await render(
        [
          "[Link][one] [Link again][one] ![Image][two] ![Image again][two]",
          "",
          `[one]: ${HALF}`,
          `[two]: ${two}`,
        ].join("\n"),
      );

      expect(linkAddressesIn(html)).toHaveLength(2);
      expect(imageSourcesIn(html)).toEqual([fingerprint(two)]);
      expect(html.endsWith(`${leftOut("Image again")}</p>\n`)).toBe(true);
    });

    test("a copy costs the address as the HTML writes it: an ampersand is five characters", async () => {
      // Written "&amp;": one character over what fits, where as written it is three under.
      const two: string = `https://status.example.com/?x=1&y=${"a".repeat(32731)}`;
      const written: string = two.split("&").join("&amp;");

      expect(HALF.length + written.length).toBe(COPIED + 1);
      expect(HALF.length + two.length).toBe(COPIED - 3);

      const html: string = await render(twoReferencedTwice(link, HALF, two));

      expect(linkAddressesIn(html)).toEqual([
        fingerprint(HALF),
        fingerprint(HALF),
        fingerprint(written),
      ]);
      expect(html.endsWith("</a> Two again</p>\n")).toBe(true);
    });

    test("a copy costs the address as the HTML writes it: an é is six characters, percent-encoded", async () => {
      // 28 characters, then "é" again and again: written, 65,536 characters.
      const address: string = `https://status.example.com/?${"é".repeat(10918)}`;
      const written: string = address.split("é").join("%C3%A9");

      expect(written.length).toBe(COPIED);
      // Counted as written in the text, both copies would fit.
      expect(2 * address.length).toBeLessThan(COPIED);

      const html: string = await render(
        `[One][s] [Two][s] [Three][s]\n\n[s]: ${address}`,
      );

      expect(linkAddressesIn(html)).toEqual([
        fingerprint(written),
        fingerprint(written),
      ]);
      expect(html.endsWith("</a> Three</p>\n")).toBe(true);
    });
  });

  describe("copies of titles", () => {
    const titled: (titleOne: string, titleTwo: string) => string = (
      titleOne: string,
      titleTwo: string,
    ): string => {
      return twoReferencedTwice(
        image,
        `https://example.com/one.png "${titleOne}"`,
        `https://example.com/two.png "${titleTwo}"`,
      );
    };

    const titlesIn: (html: string) => Array<string> = (
      html: string,
    ): Array<string> => {
      return valuesAfter(html, ' title="').map(fingerprint);
    };

    test("coming to exactly the budget, every copy keeps its title", async () => {
      const one: string = "t".repeat(COPIED / 2);
      const two: string = "u".repeat(COPIED / 2);
      const html: string = await render(titled(one, two));

      expect(titlesIn(html)).toEqual([
        fingerprint(one),
        fingerprint(one),
        fingerprint(two),
        fingerprint(two),
      ]);
      expect(countOf(html, "<img ")).toBe(4);
    });

    test("one byte more, and the last copy goes without its title: still an image", async () => {
      const one: string = "t".repeat(COPIED / 2);
      const two: string = "u".repeat(COPIED / 2 + 1);
      const html: string = await render(titled(one, two));

      expect(titlesIn(html)).toEqual([
        fingerprint(one),
        fingerprint(one),
        fingerprint(two),
      ]);
      expect(
        html.endsWith(
          `<img src="https://example.com/two.png" alt="Two again" style="${EMAIL_IMAGE_STYLE}"></p>\n`,
        ),
      ).toBe(true);
    });

    test.each([
      [
        '">", written "&gt;": four bytes',
        `${" >".repeat(13000)}${"a".repeat(536)}`,
      ],
      ['"é": two bytes of UTF-8', "é".repeat(COPIED / 2)],
    ])(
      "a copy costs the title as the HTML writes it - %s",
      async (_name: string, title: string) => {
        // One copy of it is the whole budget; counted in characters, two would fit.
        expect(Buffer.byteLength(title.split(">").join("&gt;"), "utf8")).toBe(
          COPIED,
        );
        expect(2 * title.length).toBeLessThanOrEqual(COPIED);

        const html: string = await render(
          `![One][s] ![Two][s] ![Three][s]\n\n[s]: https://example.com/a.png "${title}"`,
        );

        expect(countOf(html, "<img ")).toBe(3);
        expect(countOf(html, " title=")).toBe(2);
        expect(
          html.endsWith(
            `<img src="https://example.com/a.png" alt="Three" style="${EMAIL_IMAGE_STYLE}"></p>\n`,
          ),
        ).toBe(true);
      },
    );
  });

  describe("the budgets are apart", () => {
    test("titles take nothing of what addresses may write, nor addresses of what titles may", async () => {
      // Each copy is most of a budget: shared, the second would not fit.
      const title: string = "t".repeat(60 * 1024);
      const address: string = httpsAddressOfLength(60 * 1024);

      const html: string = await render(
        [
          "![A][a] ![A again][a] ![B][b] ![B again][b]",
          "",
          `[a]: https://example.com/a.png "${title}"`,
          `[b]: ${address}`,
        ].join("\n"),
      );

      expect(countOf(html, ` title="${title}"`)).toBe(2);
      expect(imageSourcesIn(html)).toEqual([
        fingerprint("https://example.com/a.png"),
        fingerprint("https://example.com/a.png"),
        fingerprint(address),
        fingerprint(address),
      ]);
    });

    test("screenshots take nothing of what addresses in the HTML may write, nor those of what screenshots may", async () => {
      // A copy of each fits its own budget, and the two of them no budget.
      const shot: string = PNG_PREFIX + screenshotOfLength(4 * 2096896);
      const address: string = httpsAddressOfLength(60 * 1024);

      expect(shot.length).toBeLessThanOrEqual(MOST);
      expect(shot.length + address.length).toBeGreaterThan(MOST);

      const html: string = await render(
        [
          "![Shot][s] ![Shot again][s] [Status][l] [Status again][l]",
          "",
          `[s]: ${shot}`,
          `[l]: ${address}`,
        ].join("\n"),
      );

      expect(imageSourcesIn(html)).toEqual([
        fingerprint(shot),
        fingerprint(shot),
      ]);
      expect(linkAddressesIn(html)).toEqual([
        fingerprint(address),
        fingerprint(address),
      ]);
    });

    test("a screenshot short enough to hold nothing back is a screenshot all the same: a thousand copies show, past what the HTML's budget would hold", async () => {
      const address: string = PNG_PREFIX + ONE_PIXEL_PNG;
      const references: Array<string> = [];

      for (let index: number = 1; index <= 1000; index++) {
        references.push(`![Shot ${index}][s]`);
      }

      expect(999 * address.length).toBeGreaterThan(COPIED);

      // A paragraph each: a thousand in one are more than marked is given to read.
      const html: string = await render(
        `${references.join("\n\n")}\n\n[s]: ${address}`,
      );

      expect(countOf(html, `<img src="${address}"`)).toBe(1000);
      expect(countOf(html, "</p>\n")).toBe(1000);
      expect(html).not.toContain("image too large");
    });
  });
});

describe("Markdown email renderer - addresses an email cannot keep are never put back (#6481)", () => {
  const SHOT: string = screenshotOfLength(4 * 350 * 1024);

  test("a data: link reference is its text, never put back, and takes nothing of the budget", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();
    const links: Array<string> = [];
    const images: Array<string> = [];

    for (let index: number = 0; index < 20; index++) {
      links.push(`[Open screenshot ${index}][home]`);
    }

    for (let index: number = 0; index < 6; index++) {
      images.push(`![Home ${index}][home]`);
    }

    const html: string = await render(
      [
        links.join("\n"),
        "",
        images.join("\n"),
        "",
        `[home]: ${PNG_PREFIX}${SHOT}`,
      ].join("\n"),
    );

    expect(html).not.toContain("<a ");
    expect(html).toContain("Open screenshot 0\nOpen screenshot 1\n");
    // Six images: the links took nothing of what the copies may put back.
    expect(imageSourcesIn(html)).toHaveLength(6);
    expect(Math.max(0, ...lengthsJudged(judged))).toBeLessThan(1024);
  });

  /*
   * Data not in base64 is text an email field holds to its size, so it is
   * just long enough that its line is over 64 KB: the start the line keeps
   * says what it is.
   */
  const TEXT: string = "A".repeat(OVER_LONG_LINE_LENGTH + 1024);

  test.each([
    ["an SVG", "data:image/svg+xml;base64,", SHOT],
    ["HTML", "data:text/html;base64,", SHOT],
    [
      "an image type with a parameter",
      "data:image/png;charset=utf-8;base64,",
      SHOT,
    ],
    ["an SVG as text", "data:image/svg+xml,", TEXT],
    ["a PNG not in base64", "data:image/png,", TEXT],
  ])(
    "an image reference to a data: URL of %s is its alt text, never put back",
    async (_label: string, prefix: string, data: string) => {
      const judged: SpyInstance<typeof Markdown.getEmailUrl> =
        watchJudgedAddresses();

      const html: string = await render(
        `![One][x] ![Two][x] ![Three][x]\n\n[x]: ${prefix}${data}`,
      );

      expect(html).toBe("<p>One Two Three</p>\n");
      expect(lengthsJudged(judged)).toEqual([]);
    },
  );

  test("an image reference to a data: URL whose kept start ends before its first comma is put back and judged whole: its alt text", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();
    /*
     * A media type so long that its line is over 64 KB without the data:
     * what the line keeps of its start ends inside it.
     */
    const address: string = `data:image/${"x".repeat(OVER_LONG_LINE_LENGTH)};base64,${SHOT}`;

    const html: string = await render(`![One][x] ![Two][x]\n\n[x]: ${address}`);

    expect(html).toBe("<p>One Two</p>\n");
    expect(lengthsJudged(judged)).toEqual([address.length, address.length]);
  });

  test("an image reference to a data:image/png URL is put back and judged whole: data that is no image is its alt text", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();
    const notAnImage: string = "A".repeat(4 * 1024);

    const html: string = await render(
      `![One][x] ![Two][x]\n\n[x]: ${PNG_PREFIX}${notAnImage}`,
    );

    expect(html).toBe("<p>One Two</p>\n");
    expect(lengthsJudged(judged)).toEqual([
      PNG_PREFIX.length + notAnImage.length,
      PNG_PREFIX.length + notAnImage.length,
    ]);
  });

  test("a javascript: link whose line is over 64 KB is its text, never put back", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();

    const html: string = await render(
      [
        "[Update][x] [Update again][x]",
        "",
        `[x]: javascript:alert(1)//${"a".repeat(OVER_LONG_LINE_LENGTH)}`,
      ].join("\n"),
    );

    expect(html).toBe("<p>Update Update again</p>\n");
    expect(lengthsJudged(judged)).toEqual([]);
  });

  test("a data: link of its own is its text, never put back", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();

    const html: string = await render(
      `[Open the screenshot](${PNG_PREFIX}${SHOT})`,
    );

    expect(html).toBe("<p>Open the screenshot</p>\n");
    expect(lengthsJudged(judged)).toEqual([]);
  });

  test("a link whose start does not say its scheme is put back and judged whole: a relative link is kept", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();
    // What the line keeps of its start is all "a": a scheme, or a path.
    const address: string = `${"a".repeat(2 * OVER_LONG_LINE_KEPT_LENGTH)}/${"b".repeat(OVER_LONG_LINE_LENGTH)}`;

    const html: string = await render(`[Status](${address})`);

    expect(linkAddressesIn(html)).toEqual([fingerprint(address)]);
    expect(lengthsJudged(judged)).toEqual([address.length]);
  });

  test("a link whose scheme was held back in two is put back and judged whole: javascript: is its text", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();
    const address: string = `javascript:alert(1)//${"a".repeat(OVER_LONG_LINE_LENGTH)}`;
    // A link text long enough that the line keeps "java" of its address.
    const text: string = "U".repeat(OVER_LONG_LINE_KEPT_LENGTH - 3 - 4);
    const markdown: string = `[${text}](${address})`;

    // The arithmetic the test stands on: what marked reads of the address.
    const heldBack: string = Markdown["holdBackFromMarked"](markdown).markdown;

    expect(heldBack.includes(`](java`)).toBe(true);
    expect(heldBack.includes(`](javas`)).toBe(false);

    const html: string = await render(markdown);

    expect(html).toBe(`<p>${text}</p>\n`);
    expect(lengthsJudged(judged)).toEqual([address.length]);
  });
});

describe("Markdown email renderer - copies of an address the renderer does not keep (#6481)", () => {
  /*
   * An address that says it is a PNG, whose data is no image: the renderer
   * shows each image of it as its alt text, as it always did. Its start
   * says nothing against it, so it is put back to be judged; each copy of
   * it is more than a sixth of the budget.
   */
  const NOT_AN_IMAGE_ADDRESS: string = PNG_PREFIX + "A".repeat(4 * 350 * 1024);

  // `count` texts: `label` 1, `label` 2 ...
  const numbered: (label: string, count: number) => Array<string> = (
    label: string,
    count: number,
  ): Array<string> => {
    const texts: Array<string> = [];

    for (let index: number = 1; index <= count; index++) {
      texts.push(`${label} ${index}`);
    }

    return texts;
  };

  test("data that is no image, referenced more often than the budget holds copies of it: every reference is its alt text, as it always was", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();
    const alts: Array<string> = numbered("Shot", 30);

    // The arithmetic the test stands on: counted, most copies would not fit.
    expect(Math.floor(MOST / NOT_AN_IMAGE_ADDRESS.length)).toBeLessThan(10);

    const html: string = await render(
      `${alts
        .map((alt: string): string => {
          return `![${alt}][x]`;
        })
        .join("\n")}\n\n[x]: ${NOT_AN_IMAGE_ADDRESS}`,
    );

    expect(html).toBe(`<p>${alts.join("\n")}</p>\n`);
    /*
     * Judged whole twice: the text's own by the renderer, and the first copy
     * before it took anything of the budget. No later copy was put back.
     */
    expect(lengthsJudged(judged)).toEqual([
      NOT_AN_IMAGE_ADDRESS.length,
      NOT_AN_IMAGE_ADDRESS.length,
    ]);
  });

  test("copies the renderer does not keep take none of the budget: a screenshot's copy after them still shows", async () => {
    const shot: string = screenshotOfLength(7 * 1024 * 1024);
    const alts: Array<string> = numbered("Not an image", 10);

    /*
     * The arithmetic the test stands on: the screenshot's copy fits the
     * budget alone, and not once a single copy of the data that is no image
     * has been counted.
     */
    expect(PNG_PREFIX.length + shot.length).toBeLessThanOrEqual(MOST);
    expect(
      NOT_AN_IMAGE_ADDRESS.length + PNG_PREFIX.length + shot.length,
    ).toBeGreaterThan(MOST);

    const html: string = await render(
      [
        alts
          .map((alt: string): string => {
            return `![${alt}][x]`;
          })
          .join("\n"),
        "![Home][home] ![Home again][home]",
        "",
        `[x]: ${NOT_AN_IMAGE_ADDRESS}`,
        `[home]: ${PNG_PREFIX}${shot}`,
      ].join("\n"),
    );

    expect(imageSourcesIn(html)).toEqual([
      fingerprint(PNG_PREFIX + shot),
      fingerprint(PNG_PREFIX + shot),
    ]);
    expect(html.startsWith(`<p>${alts.join("\n")}\n<img `)).toBe(true);
    expect(html).not.toContain("image too large");
  });

  test("a link whose address the renderer does not keep once put back - its held-back middle holds a lone surrogate - is its text at every reference, put back as a copy once", async () => {
    const judged: SpyInstance<typeof Markdown.getEmailUrl> =
      watchJudgedAddresses();
    const address: string = `https://status.example.com/${"a".repeat(40000)}${String.fromCharCode(0xd800)}${"a".repeat(40000)}`;
    const texts: Array<string> = numbered("Open", 20);

    const html: string = await render(
      `${texts
        .map((text: string): string => {
          return `[${text}][s]`;
        })
        .join("\n")}\n\n[s]: ${address}`,
    );

    expect(html).toBe(`<p>${texts.join("\n")}</p>\n`);
    expect(lengthsJudged(judged)).toEqual([address.length, address.length]);
  });

  test("images and links are judged apart: an address an image cannot show but a link keeps - a mailto: whose scheme was held back with the rest - is a link where a link's copy fits", async () => {
    /*
     * A label so long, and no space after its colon, that the definition's
     * line keeps "mail" of its address: the rest of its scheme is held back
     * with the rest of it. The address is short enough for one copy of it
     * to fit what copies of addresses may write, and no more.
     */
    const label: string = "s".repeat(OVER_LONG_LINE_KEPT_LENGTH - 7);
    const address: string = `mailto:ops@example.com?body=${"a".repeat(65000 - 28)}`;

    expect(address.length).toBe(65000);
    expect(label.length + address.length + 3).toBeGreaterThan(
      OVER_LONG_LINE_LENGTH,
    );
    const references: string = [
      `![Mail 1][${label}]`,
      `![Mail 2][${label}]`,
      `[Mail 3][${label}]`,
      `![Mail 4][${label}]`,
      `[Mail 5][${label}]`,
    ].join(" ");
    const markdown: string = `${references}\n\n[${label}]:${address}`;

    // The arithmetic the test stands on: what marked reads of the address.
    const heldBack: string = Markdown["holdBackFromMarked"](markdown).markdown;

    expect(heldBack.includes(`s]:mail\u{e005}`)).toBe(true);
    expect(heldBack.includes(`s]:mailt`)).toBe(false);

    const html: string = await renderOnePiece(markdown);
    const link: string = `<a href="${address}">`;

    // The image's own copy is the text's own: every link is a copy.
    expect(html).toBe(`<p>Mail 1 Mail 2 ${link}Mail 3</a> Mail 4 Mail 5</p>\n`);
  });
});

describe("Markdown email renderer - titles references copy (#6481)", () => {
  test("a definition's title on a line over 64 KB: every reference is an image, the first with the title, the others without", async () => {
    const title: string = "Failed".repeat(20000);
    const references: Array<string> = [];

    for (let index: number = 0; index < 200; index++) {
      references.push(`![Shot ${index}][s]`);
    }

    const html: string = await render(
      `${references.join("\n")}\n\n[s]: https://example.com/shot.png "${title}"`,
    );

    expect(
      countOf(
        html,
        `<img src="https://example.com/shot.png" alt="Shot 0" title="${title}" style="${EMAIL_IMAGE_STYLE}">`,
      ),
    ).toBe(1);
    expect(
      countOf(
        html,
        `<img src="https://example.com/shot.png" alt="Shot 199" style="${EMAIL_IMAGE_STYLE}">`,
      ),
    ).toBe(1);
    expect(countOf(html, '<img src="https://example.com/shot.png"')).toBe(200);
    expect(countOf(html, " title=")).toBe(1);
    // Not cut to fit: it fits, and no reference is left as Markdown.
    expect(html.length).toBeLessThan(MAX_EMAIL_FIELD_HTML_BYTES);
    expect(html).not.toContain("![Shot");
  });

  test("a link's held-back title goes the same way", async () => {
    const title: string = "Failed".repeat(20000);

    const html: string = await render(
      `[One][s] [Two][s]\n\n[s]: https://status.example.com "${title}"`,
    );

    expect(
      html.startsWith(
        `<p><a href="https://status.example.com" title="${title}">One</a> `,
      ),
    ).toBe(true);
    expect(
      html.endsWith('<a href="https://status.example.com">Two</a></p>\n'),
    ).toBe(true);
  });

  /*
   * #7229: the address longer than the line's kept start, so the line's
   * middle starts inside it. Held back in one piece with the title, the
   * definition was none, and every reference was its Markdown.
   */
  test("a definition whose address is over 1 KB, its title taking the line over 64 KB: every reference links to the address, the first with the title (#7229)", async () => {
    const title: string = "Checkout failed. ".repeat(4000);
    const address: string = `https://status.example.com/${"a".repeat(2000)}`;
    const references: Array<string> = [];

    // As many as copies of an address of 2 KB may write.
    for (let index: number = 0; index < 20; index++) {
      references.push(`[Run ${index}][s]`);
    }

    const html: string = await render(
      `${references.join("\n")}\n\n[s]: ${address} "${title}"`,
    );

    expect(linkAddressesIn(html)).toEqual(
      references.map((): string => {
        return fingerprint(address);
      }),
    );
    expect(
      html.startsWith(
        `<p><a href="${address}" title="${title}">Run 0</a>\n<a href="${address}">Run 1</a>\n`,
      ),
    ).toBe(true);
    expect(countOf(html, " title=")).toBe(1);
    expect(html).not.toContain("[Run ");
    expect(html).not.toContain("[s]:");
  });

  test("a short title is copied into every reference, as it always was", async () => {
    const html: string = await render(
      `![One][s] ![Two][s] ![Three][s]\n\n[s]: https://example.com/shot.png "Home page"`,
    );

    expect(countOf(html, ' title="Home page"')).toBe(3);
  });

  test("a screenshot copy keeps its address while its held-back title is left out", async () => {
    const shot: string = screenshotOfLength(64 * 1024);
    const title: string = "Failed".repeat(20000);

    const html: string = await render(
      `![One][s] ![Two][s]\n\n[s]: ${PNG_PREFIX}${shot} "${title}"`,
    );

    expect(imageSourcesIn(html)).toEqual([
      fingerprint(PNG_PREFIX + shot),
      fingerprint(PNG_PREFIX + shot),
    ]);
    expect(countOf(html, ` title="${title}"`)).toBe(1);
    expect(countOf(html, " title=")).toBe(1);
  });
});

describe("Markdown email renderer - references within the budget render as they always did (#6481)", () => {
  /*
   * The same Markdown with long data and with short, which holds nothing
   * back: within the budget, the long renders exactly as the short, the
   * data aside.
   */
  const PNG: string =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const LONG: string = Buffer.concat([
    Buffer.from(PNG, "base64"),
    Buffer.alloc(3 * 100 * 1024, 0x5a),
  ]).toString("base64");

  test("the long data is long enough to be held back, and padded like the short", () => {
    expect(LONG.length).toBeGreaterThan(4096);
    expect(LONG.endsWith("==")).toBe(true);
    expect(PNG.endsWith("==")).toBe(true);
  });

  test.each([
    [
      "two references",
      (data: string): string => {
        return `![One][s] ![Two][s]\n\n[s]: ${PNG_PREFIX}${data}`;
      },
    ],
    [
      "references with a title",
      (data: string): string => {
        return `![One][s] ![Two][s]\n\n[s]: ${PNG_PREFIX}${data} "Login page"`;
      },
    ],
    [
      "a reference and an inline image of the same data",
      (data: string): string => {
        return `![One](${PNG_PREFIX}${data}) ![Two][s]\n\n[s]: ${PNG_PREFIX}${data}`;
      },
    ],
    [
      "references in a table, a list and a quote",
      (data: string): string => {
        return [
          "| Browser | Screenshot |",
          "| --- | --- |",
          "| Chromium | ![Chromium][s] |",
          "",
          "- ![Firefox][s]",
          "",
          "> ![Webkit][s]",
          "",
          `[s]: ${PNG_PREFIX}${data}`,
        ].join("\n");
      },
    ],
    [
      "references inside links",
      (data: string): string => {
        return `[![One][s]](https://oneuptime.example.com/1) [![Two][s]][page]\n\n[s]: ${PNG_PREFIX}${data}\n[page]: https://oneuptime.example.com/2`;
      },
    ],
    [
      "data: link references beside image references",
      (data: string): string => {
        return `[Open][s] ![One][s] [Open again][s] ![Two][s]\n\n[s]: ${PNG_PREFIX}${data}`;
      },
    ],
    [
      "a shortcut and a collapsed reference",
      (data: string): string => {
        return `![s] ![s][]\n\n[s]: ${PNG_PREFIX}${data}`;
      },
    ],
    [
      "references in headings",
      (data: string): string => {
        return `# ![One][s]\n\n## Two ![Two][s]\n\n[s]: ${PNG_PREFIX}${data}`;
      },
    ],
  ])(
    "long data renders as short data does: %s",
    async (_label: string, markdownWith: (data: string) => string) => {
      const short: string = await render(markdownWith(PNG));
      const long: string = await render(markdownWith(LONG));

      expect(long.split(LONG).join(PNG)).toBe(short);
      expect(short).toContain("<img ");
    },
  );
});

describe("Markdown email renderer - what is never a copy (#6962)", () => {
  const ADDRESS: string = httpsAddressOfLength(60 * 1024);

  test("an image's or a link's own address is the text's own, however long, and however often the text holds it", async () => {
    // A paragraph each: on one line, they would make a line over 64 KB.
    const html: string = await renderOnePiece(
      [
        `[One](${ADDRESS})`,
        `[Two](${ADDRESS})`,
        `![Three](${ADDRESS})`,
        `![Four](${ADDRESS})`,
      ].join("\n\n"),
    );

    expect(linkAddressesIn(html)).toEqual([
      fingerprint(ADDRESS),
      fingerprint(ADDRESS),
    ]);
    expect(imageSourcesIn(html)).toEqual([
      fingerprint(ADDRESS),
      fingerprint(ADDRESS),
    ]);
  });

  test("two definitions of one address each have the text's own copy: the copies after them are counted", async () => {
    const html: string = await render(
      `[One][a] [Two][b] [Three][a] [Four][b]\n\n[a]: ${ADDRESS}\n[b]: ${ADDRESS}`,
    );

    // One and Two are each a definition's own; Three is a copy within the budget, Four past it.
    expect(linkAddressesIn(html)).toHaveLength(3);
    expect(html.endsWith("</a> Four</p>\n")).toBe(true);
  });

  test("copies of an address the renderer does not keep take nothing of the budget, however long", async () => {
    // A javascript: link under 64 KB: never held back, its text at every reference.
    const refused: string = `javascript:alert(1)//${"a".repeat(60 * 1024)}`;
    const runs: Array<string> = [];

    for (let index: number = 1; index <= 10; index++) {
      runs.push(`[Run ${index}][x]`);
    }

    const html: string = await render(
      [
        runs.join(" "),
        "[Status][l] [Status again][l]",
        "",
        `[x]: ${refused}`,
        `[l]: ${ADDRESS}`,
      ].join("\n"),
    );

    expect(html.startsWith("<p>Run 1 Run 2 ")).toBe(true);
    expect(html).not.toContain("javascript:");
    expect(linkAddressesIn(html)).toEqual([
      fingerprint(ADDRESS),
      fingerprint(ADDRESS),
    ]);
  });

  test("a reference that finds no definition is its Markdown, as it always was, and takes nothing", async () => {
    const html: string = await render(
      `![One][missing] [Two][s] [Three][s]\n\n[s]: ${ADDRESS}`,
    );

    expect(html.startsWith("<p>![One][missing] <a ")).toBe(true);
    expect(linkAddressesIn(html)).toHaveLength(2);
  });
});

describe("Markdown email renderer - a definition under 64 KB referenced 200 times (#6962)", () => {
  const SHOT: string = "https://example.com/shot.png";

  // 200 lines, `write` making each from its number.
  const twoHundred: (write: (index: number) => string) => Array<string> = (
    write: (index: number) => string,
  ): Array<string> => {
    return Array.from({ length: 200 }, (_: unknown, index: number): string => {
      return write(index + 1);
    });
  };

  const imageReferences: string = twoHundred((index: number): string => {
    return `![Shot ${index}][s]`;
  }).join("\n");

  const paragraphOf: (lines: Array<string>) => string = (
    lines: Array<string>,
  ): string => {
    return `<p>${lines.join("\n")}</p>\n`;
  };

  // Booleans, so a failure does not print a quarter of a megabyte.
  const expectFieldNotCut: (html: string) => void = (html: string): void => {
    expect(html.includes("![Shot")).toBe(false);
    expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(false);
    expect(EmailSize.getFieldSizeInBytes(html)).toBeLessThanOrEqual(
      MAX_EMAIL_FIELD_HTML_BYTES,
    );
  };

  test("a title of 2 KB: every reference is an image, the field is not cut, and the copies within the budget keep the title", async () => {
    const title: string = "Checkout failed: the card form did not load. "
      .repeat(46)
      .slice(0, 2048);
    const titledCopies: number = Math.floor(COPIED / title.length);

    // The arithmetic the test stands on: some copies keep it, most do not.
    expect(titledCopies).toBe(32);

    const html: string = await render(
      `${imageReferences}\n\n[s]: ${SHOT} "${title}"`,
    );
    const expected: string = paragraphOf(
      twoHundred((index: number): string => {
        const titled: string =
          index <= 1 + titledCopies ? ` title="${title}"` : "";

        return `<img src="${SHOT}" alt="Shot ${index}"${titled} style="${EMAIL_IMAGE_STYLE}">`;
      }),
    );

    expect(fingerprint(html)).toBe(fingerprint(expected));
    expectFieldNotCut(html);
  });

  test("an https address of 60 KB: the references within the budget are images, the rest the note - never Markdown", async () => {
    const address: string = httpsAddressOfLength(60 * 1024);

    const html: string = await render(`${imageReferences}\n\n[s]: ${address}`);
    const expected: string = paragraphOf(
      twoHundred((index: number): string => {
        // The text's own, and the one copy within the budget.
        return index <= 2
          ? `<img src="${address}" alt="Shot ${index}" style="${EMAIL_IMAGE_STYLE}">`
          : leftOut(`Shot ${index}`);
      }),
    );

    expect(fingerprint(html)).toBe(fingerprint(expected));
    expectFieldNotCut(html);
  });

  test("a short title and a short address: every reference renders exactly as it always has", async () => {
    const html: string = await render(
      `${imageReferences}\n\n[s]: ${SHOT} "Home page"`,
    );

    expect(html).toBe(
      paragraphOf(
        twoHundred((index: number): string => {
          return `<img src="${SHOT}" alt="Shot ${index}" title="Home page" style="${EMAIL_IMAGE_STYLE}">`;
        }),
      ),
    );
  });

  test("links the same way: an address of 60 KB is a link within the budget, its text after it", async () => {
    const address: string = httpsAddressOfLength(60 * 1024);
    const links: string = twoHundred((index: number): string => {
      return `[Run ${index}][s]`;
    }).join("\n");

    const html: string = await render(`${links}\n\n[s]: ${address}`);
    const expected: string = paragraphOf(
      twoHundred((index: number): string => {
        return index <= 2
          ? `<a href="${address}">Run ${index}</a>`
          : `Run ${index}`;
      }),
    );

    expect(fingerprint(html)).toBe(fingerprint(expected));
    expect(html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(false);
  });

  test("links the same way: a short address and title, exactly as always", async () => {
    const links: string = twoHundred((index: number): string => {
      return `[Run ${index}][s]`;
    }).join("\n");

    const html: string = await render(
      `${links}\n\n[s]: https://status.example.com/runs "Every run"`,
    );

    expect(html).toBe(
      paragraphOf(
        twoHundred((index: number): string => {
          return `<a href="https://status.example.com/runs" title="Every run">Run ${index}</a>`;
        }),
      ),
    );
  });
});

describe("Markdown email renderer - a definition's title (#6962)", () => {
  /*
   * marked escapes a reference's title as it escapes a link's own: the
   * renderer escapes a definition's once (its tokenizer gives marked a mark
   * in its place), and must write exactly what marked would have.
   */
  const asReferences: (title: string) => string = (title: string): string => {
    return `[Status][s] ![Shot][s]\n\n[s]: https://example.com/a.png "${title}"`;
  };

  const asOwn: (title: string) => string = (title: string): string => {
    return `[Status](https://example.com/a.png "${title}") ![Shot](https://example.com/a.png "${title}")`;
  };

  test.each([
    ["an ampersand", "Tom & Jerry"],
    [
      "character references marked leaves as they are",
      "&amp; &lt; &copy; &#39; &#x27; &#X41; &a_1;",
    ],
    [
      "ampersands that start no character reference",
      "&#12345678; &#x1234567; &bogus &; &#; &#x; &-x; & ;",
    ],
    ["angle brackets and an apostrophe", "<b>bold</b> it's 1 < 2 > 0"],
    ["escaped quotes", 'say \\"hi\\" and \\\\ done'],
    ["text in other scripts", "émoji 😀 ü 障害"],
    ["an ampersand at its end", "Q&A &"],
  ])(
    "a reference's title is what marked writes for a link's own: %s",
    async (_name: string, title: string) => {
      const references: string = await render(asReferences(title));

      expect(references).toBe(await render(asOwn(title)));
      expect(countOf(references, " title=")).toBe(2);
    },
  );

  test("generated titles: a reference's is what marked writes for a link's own", async () => {
    const titles: Array<string> = generatedTexts(1500, 6962, [
      "&",
      "#",
      "x",
      "X",
      "1",
      "9",
      "a",
      "F",
      "g",
      "_",
      ";",
      "<",
      ">",
      "'",
      '\\"',
      " ",
      "é",
      "&amp;",
      "&#39;",
      "&#x27;",
      "&#1234567;",
      "&#x10FFFF;",
    ]);
    const differences: Array<string> = [];

    for (const title of titles) {
      if (!title.trim()) {
        continue;
      }

      const references: string = await render(asReferences(title));
      const own: string = await render(asOwn(title));

      if (references !== own) {
        differences.push(`${JSON.stringify(title)}: ${references} / ${own}`);
      }
    }

    expect(differences.slice(0, 5)).toEqual([]);
  });

  test("a title of 60 KB with quotes in it, referenced 10,000 times, renders in time that grows with the text: marked holds a mark for each reference, not a copy", async () => {
    const title: string = 'The "card" form did not load. '.repeat(2048);
    // A paragraph each: ten thousand in one are more than marked is given to read.
    const markdown: string = `${"[Run][s]\n\n".repeat(10000)}[s]: https://example.com/runs '${title}'`;

    // The arithmetic the test stands on: the title is under 64 KB, so nothing is held back.
    expect(title.length).toBeLessThan(OVER_LONG_LINE_LENGTH - 64);

    // The renderer set up as convertToHTML sets it up.
    await render("");

    /*
     * marked renders at once: the work is done before renderEmailMarkdown
     * first awaits, so each attempt times it.
     */
    const timed: FastestRun<Promise<string>> = fastestRun({
      run: (): Promise<string> => {
        return Markdown["renderEmailMarkdown"](
          markdown,
          Markdown["getEmailRenderer"](),
        );
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);

    const html: string = await timed.result;

    // The text's own title, once; a copy of it is more than its budget.
    expect(countOf(html, "<p>")).toBe(10000);
    expect(countOf(html, " title=")).toBe(1);
    expect(countOf(html, ">Run</a>")).toBe(1 + Math.floor(COPIED / 24));
  });
});

describe("Markdown email renderer - the tokenizer's marks change nothing within the budgets (#6962)", () => {
  /*
   * The email's tokenizer gives marked a mark in place of each definition's
   * address and title, and the renderer puts the definition back from the
   * mark. Within the budgets, what it writes must be exactly what marked
   * writes with the definition itself: wherever marked reads a definition -
   * in a quote, a list item, with its title on a line of its own, its label
   * in another case or with an escaped bracket - and wherever it reads one
   * only as text: the second of a label, a paragraph's next line, a code
   * block's. These generate texts of references, definitions of every kind
   * and the blocks around them, and render each both ways.
   */
  const PIECES: ReadonlyArray<string> = [
    "![Shot][home]",
    "[Run][HOME]",
    "[home][]",
    "[Home]",
    "![Runs][runs]",
    "[runs]",
    "[x][t]",
    "![y][t]",
    "[none]",
    "[f][foo bar]",
    "![g][FOO   BAR]",
    "[e][a\\]b]",
    "[![Shot][home]](https://example.com/page)",
    '[a](https://example.com/a "A & b")',
    "![b](https://example.com/b.png 'it''s')",
    "[c](mailto:ops@example.com)",
    "[d](javascript:alert(1))",
    "[e][js]",
    "![f][js]",
    "[g][data]",
    "![h][data]",
    " ",
    "word ",
    "**bold** ",
    "`[home]` ",
    "\n",
    "\n\n",
    "> ",
    "- ",
    "1. ",
    "| a | [home] |\n|---|---|\n| ![s][home] | [t] |\n",
    "# Heading\n",
    "Setext\n---\n",
    "```\n",
    "    ",
    "<b>",
    "&amp; ",
    "\\[home] ",
    "\n\n[home]: https://example.com/home.png \"Home &amp; <away> 'q' &copy; &#39;\"\n\n",
    "\n\n[HOME]: <https://example.com/other one.png>\n\n",
    "\n\n[runs]: /runs (Every run)\n\n",
    "\n\n[t]: https://example.com/t 'single \"quoted\"'\n\n",
    "\n\n[Foo  Bar]: https://example.com/foo\n  'On a line of its own'\n\n",
    "\n\n[a\\]b]: https://example.com/escaped\n\n",
    "\n[t]: https://example.com/continued\n",
    "\n\n> [t]: https://example.com/quoted\n\n",
    "\n\n- [runs]: https://example.com/in-list\n\n",
    '\n\n[js]: javascript:alert(1) "x"\n\n',
    `\n\n[data]: ${PNG_PREFIX}${ONE_PIXEL_PNG} "Shot"\n\n`,
  ];

  /*
   * Whether `html` holds a character of Unicode's private use area: a mark,
   * or the token of a held-back text, left in the email.
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

  test("generated texts render exactly as marked renders them with the definitions themselves, and no mark is ever left in the HTML", async () => {
    // The renderer set up as convertToHTML sets it up.
    await render("");

    const emailRenderer: Renderer = Markdown["getEmailRenderer"]();
    // An address only a definition gives, and the texts that rendered it.
    const definedAddresses: Map<string, number> = new Map<string, number>([
      ["https://example.com/home.png", 0],
      ["https://example.com/other%20one.png", 0],
      ["/runs", 0],
      ["https://example.com/t", 0],
      ["https://example.com/foo", 0],
      ["https://example.com/escaped", 0],
      ["https://example.com/quoted", 0],
      ["https://example.com/in-list", 0],
      [`${PNG_PREFIX}${ONE_PIXEL_PNG}`, 0],
    ]);
    const differences: Array<string> = [];
    let marksLeft: number = 0;

    for (const text of generatedTexts(3000, 7198, PIECES, 30)) {
      const html: string = await render(text);
      /*
       * marked writes its options into the renderer it is given, so it is
       * given one of its own, made from the email's.
       */
      const own: string = await marked(text, {
        renderer: Object.create(emailRenderer) as Renderer,
      });

      if (holdsPrivateUseCharacter(html)) {
        marksLeft++;
      }

      if (html !== own) {
        differences.push(`${JSON.stringify(text)}\n${html}\n${own}`);
      }

      for (const [address, count] of definedAddresses) {
        if (html.includes(`="${address}"`)) {
          definedAddresses.set(address, count + 1);
        }
      }
    }

    expect(marksLeft).toBe(0);
    expect(differences.slice(0, 3)).toEqual([]);

    // The texts reach every definition, so each was put back from its mark.
    for (const [address, count] of definedAddresses) {
      expect(`${address}: ${count > 20}`).toBe(`${address}: true`);
    }
  });
});
