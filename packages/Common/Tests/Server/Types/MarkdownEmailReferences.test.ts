import Markdown, {
  EMAIL_IMAGE_STYLE,
  MAX_EMAIL_HELD_TEXT_IN_REFERENCES,
  MarkdownContentType,
} from "../../../Server/Types/Markdown";
import EmailInlineImages from "../../../Server/Utils/Mail/EmailInlineImages";
import { MAX_EMAIL_FIELD_HTML_BYTES } from "../../../Server/Utils/Mail/EmailSize";
import {
  OVER_LONG_LINE_KEPT_LENGTH,
  OVER_LONG_LINE_LENGTH,
} from "../../../Utils/Markdown/OverLongText";
import crypto from "crypto";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUE #6481: WHAT A LINK REFERENCE DEFINITION COPIES INTO AN EMAIL.
 *
 * A description can show one screenshot several times: define it once as a
 * Markdown link reference definition and point several images at it.
 *
 *   ![Home][home]
 *   ![Home, again][home]
 *
 *   [home]: data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}}
 *
 * marked writes the definition's address into every reference to it, and
 * the email renderer put the screenshot's data back into each one: a
 * screenshot of 1 MB referenced 200 times was 280 MB of HTML before its
 * images went out as attachments, and one of 2.25 MB more than V8's longest
 * string, so the email went out as its Markdown in text.
 *
 * Now the text's own copy of what was held back goes back as it always did
 * - an image's or a link's own address, or the first reference to a
 * definition - and copies only while they come to at most
 * MAX_EMAIL_HELD_TEXT_IN_REFERENCES in one render: past that, an image is
 * the note an email leaves in place of an image too large to include, and a
 * link is its text. A copy of a held-back title is never put back, and an
 * address an email cannot keep - a data: link above all - is not put back
 * at all.
 *
 * These test the renderer: Markdown.convertToHTML, and where a test needs
 * addresses longer than an email field keeps, the renderer's step before
 * the field is held to its size (renderEmailMarkdown; MarkdownEmailSizeCap
 * tests that step). SyntheticScreenshotInEmail.test.ts runs the whole way
 * from the probe to the attachments, and HugeTextInLongRunningProcess runs
 * it where V8 compiles regular expressions unoptimized.
 */

const MOST: number = MAX_EMAIL_HELD_TEXT_IN_REFERENCES;

// What comes before a PNG screenshot's data in its address.
const PNG_PREFIX: string = "data:image/png;base64,";

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

  test("an address that holds nothing held back takes none of the budget", async () => {
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

describe("Markdown email renderer - the budget's boundary, images and links alike (#6481)", () => {
  /*
   * A screenshot's address and a long https link's together, as copies:
   * their references come second, so the first of each is the text's own.
   */
  const SHOT: string = screenshotOfLength(4 * 600 * 1024);
  const SHOT_ADDRESS: string = PNG_PREFIX + SHOT;

  const markdownWith: (linkLength: number, linksFirst: boolean) => string = (
    linkLength: number,
    linksFirst: boolean,
  ): string => {
    const images: string = "![Home][home] ![Home again][home]";
    const links: string = "[Status][status] [Status again][status]";

    return [
      linksFirst ? `${links}\n${images}` : `${images}\n${links}`,
      "",
      `[home]: ${SHOT_ADDRESS}`,
      `[status]: ${httpsAddressOfLength(linkLength)}`,
    ].join("\n");
  };

  test("the link's address is long enough to be held back, the line it is on over 64 KB", () => {
    expect(MOST - SHOT_ADDRESS.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
  });

  test("exactly at it, every copy is put back", async () => {
    const linkLength: number = MOST - SHOT_ADDRESS.length;
    const html: string = await renderOnePiece(markdownWith(linkLength, false));

    expect(imageSourcesIn(html)).toEqual([
      fingerprint(SHOT_ADDRESS),
      fingerprint(SHOT_ADDRESS),
    ]);
    expect(linkAddressesIn(html)).toEqual([
      fingerprint(httpsAddressOfLength(linkLength)),
      fingerprint(httpsAddressOfLength(linkLength)),
    ]);
  });

  test("one character more, and the last copy is left out: a link is its text", async () => {
    const linkLength: number = MOST - SHOT_ADDRESS.length + 1;
    const html: string = await renderOnePiece(markdownWith(linkLength, false));

    expect(imageSourcesIn(html)).toHaveLength(2);
    expect(linkAddressesIn(html)).toEqual([
      fingerprint(httpsAddressOfLength(linkLength)),
    ]);
    expect(html.endsWith("</a> Status again</p>\n")).toBe(true);
  });

  test("links take of it as images do, in the order of the text: the link copy first, the image left out", async () => {
    const linkLength: number = MOST - SHOT_ADDRESS.length + 1;
    const html: string = await renderOnePiece(markdownWith(linkLength, true));

    expect(linkAddressesIn(html)).toHaveLength(2);
    expect(imageSourcesIn(html)).toEqual([fingerprint(SHOT_ADDRESS)]);
    expect(html.endsWith(`${leftOut("Home again")}</p>\n`)).toBe(true);
  });

  test("a link copy past it keeps its text's formatting", async () => {
    const html: string = await renderOnePiece(
      [
        "[**First** status][status] [**Second** status][status]",
        "",
        `[status]: ${httpsAddressOfLength(MOST + 1)}`,
      ].join("\n"),
    );

    expect(linkAddressesIn(html)).toHaveLength(1);
    expect(html.endsWith("</a> <strong>Second</strong> status</p>\n")).toBe(
      true,
    );
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
