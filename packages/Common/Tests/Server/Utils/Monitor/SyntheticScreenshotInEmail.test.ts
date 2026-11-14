import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import Markdown, {
  MAX_EMAIL_HELD_TEXT_IN_REFERENCES,
  MarkdownContentType,
} from "../../../../Server/Types/Markdown";
import EmailInlineImages, {
  EmailHtmlWithInlineImages,
  EmailInlineImage,
  MaxEmailInlineImageBytes,
} from "../../../../Server/Utils/Mail/EmailInlineImages";
import { JSONObject } from "../../../../Types/JSON";
import BrowserType from "../../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import Screenshots from "../../../../Types/Monitor/SyntheticMonitors/Screenshot";
import SyntheticMonitorResponse from "../../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EmailSize, {
  EMAIL_TRUNCATED_TEXT_NOTE_HTML,
  MAX_EMAIL_FIELD_HTML_BYTES,
} from "../../../../Server/Utils/Mail/EmailSize";
import logger from "../../../../Server/Utils/Logger";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { FastestRun, fastestRunAsync } from "../../../Helpers/FastestRun";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUE #4532: A SYNTHETIC MONITOR'S SCREENSHOT IN THE INCIDENT EMAIL.
 *
 * The probe reports each screenshot as base64, and the only way a monitor's
 * incident or alert description template can show one is an image of its
 * own around that text:
 *
 *   {{syntheticResponses.0.scriptError}}
 *   ![](data:image/png;base64,{{syntheticResponses.0.screenshots.my_error_shot}})
 *
 * Since ea611c316 the email renderer kept only http and https images, so the
 * screenshot rendered as its alt text - nothing - and the on-call engineer
 * got the error without the page it happened on. Each test here runs the
 * whole way an incident's description takes to an email: the probe's
 * response, the template's storage map, the description it renders, the
 * email's HTML, and the inline attachment the screenshot is sent as.
 */

// Real 1x1 images, as the probe's Buffer.toString("base64") writes them.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const GIF: string = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// The description template from the issue.
const ISSUE_TEMPLATE: string =
  "{{syntheticResponses.0.scriptError}}\n![](data:image/png;base64,{{syntheticResponses.0.screenshots.my_error_shot}})";

function run(
  overrides: Partial<SyntheticMonitorResponse> & {
    screenshots?: Screenshots | undefined;
  },
): SyntheticMonitorResponse {
  return {
    result: undefined,
    scriptError: "Timeout 30000ms exceeded",
    logMessages: [],
    capturedMetrics: [],
    executionTimeInMS: 30000,
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    ...overrides,
  };
}

function storageMapFor(runs: Array<SyntheticMonitorResponse>): JSONObject {
  const response: ProbeMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "1 of 1 runs failed",
    monitoredAt: new Date("2026-10-07T22:00:00.000Z"),
    syntheticMonitorResponse: runs,
  };

  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.SyntheticMonitor,
    dataToProcess: response,
  });
}

// The description a template renders, as the incident stores it.
function describeIncident(
  template: string,
  runs: Array<SyntheticMonitorResponse>,
): string {
  return MonitorTemplateUtil.processMarkdownTemplateString({
    value: template,
    storageMap: storageMapFor(runs),
  });
}

// The description as an email sends it: its HTML, and the images attached.
async function emailFor(
  description: string,
): Promise<EmailHtmlWithInlineImages> {
  return EmailInlineImages.attach(
    await Markdown.convertToHTML(description, MarkdownContentType.Email),
  );
}

describe("a synthetic monitor's screenshot, from the probe to the incident email", () => {
  test("the issue's template: the error, and the screenshot attached and shown", async () => {
    const description: string = describeIncident(ISSUE_TEMPLATE, [
      run({ screenshots: { my_error_shot: PNG } }),
    ]);

    // The description keeps the screenshot exactly as the probe sent it.
    expect(description).toBe(
      `Timeout 30000ms exceeded\n![](data:image/png;base64,${PNG})`,
    );

    const email: EmailHtmlWithInlineImages = await emailFor(description);

    expect(email.inlineImages).toHaveLength(1);
    expect(email.inlineImages[0]).toMatchObject({
      fileName: "image-1.png",
      mimeType: "image/png",
      base64: PNG,
    });
    expect(email.html).toBe(
      `<p>Timeout 30000ms exceeded\n<img src="cid:${email.inlineImages[0]!.contentId}" alt="" style="max-width:100%;height:auto;"></p>\n`,
    );
  });

  test("the bracket index form of the same template", async () => {
    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(
        "![Failure](data:image/png;base64,{{syntheticResponses[0].screenshots.my_error_shot}})",
        [run({ screenshots: { my_error_shot: PNG } })],
      ),
    );

    expect(
      email.inlineImages.map((image: EmailInlineImage) => {
        return image.base64;
      }),
    ).toEqual([PNG]);
  });

  // The example in docs/monitor/incident-alert-templating, as written there.
  test("the docs' example: a screenshot whose name has a hyphen", async () => {
    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(
        "{{syntheticResponses[0].scriptError}}\n\n![Login page](data:image/png;base64,{{syntheticResponses[0].screenshots.login-page}})",
        [run({ screenshots: { "login-page": PNG } })],
      ),
    );

    expect(
      email.inlineImages.map((image: EmailInlineImage) => {
        return image.base64;
      }),
    ).toEqual([PNG]);
    expect(email.html).toContain("<p>Timeout 30000ms exceeded</p>");
    expect(email.html).toContain('alt="Login page"');
  });

  // The loop example in the same docs, as written there.
  test("the docs' loop example: each failed run's screenshot", async () => {
    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(
        [
          "### What the page looked like",
          "{{#each syntheticResponses}}",
          "**{{browserType}} / {{screenSizeType}}**: {{scriptError}}",
          "",
          "![{{browserType}} {{screenSizeType}}](data:image/png;base64,{{screenshots.failure}})",
          "",
          "{{/each}}",
        ].join("\n"),
        [
          run({ screenshots: { failure: PNG } }),
          run({
            browserType: BrowserType.Firefox,
            screenSizeType: ScreenSizeType.Mobile,
            screenshots: { failure: JPEG },
          }),
        ],
      ),
    );

    expect(
      email.inlineImages.map((image: EmailInlineImage) => {
        return image.base64;
      }),
    ).toEqual([PNG, JPEG]);
    expect(email.html).toContain('alt="Chromium Desktop"');
    expect(email.html).toContain('alt="Firefox Mobile"');
  });

  test("every run's screenshot, from an {{#each syntheticResponses}} loop", async () => {
    const description: string = describeIncident(
      [
        "{{#each syntheticResponses}}",
        "**{{browserType}} / {{screenSizeType}}**: {{scriptError}}",
        "",
        "![{{browserType}}](data:image/png;base64,{{screenshots.final}})",
        "",
        "{{/each}}",
      ].join("\n"),
      [
        run({
          browserType: BrowserType.Chromium,
          screenshots: { final: PNG },
        }),
        run({
          browserType: BrowserType.Firefox,
          scriptError: "Element not found: #login",
          screenshots: { final: JPEG },
        }),
        run({
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Mobile,
          screenshots: { final: GIF },
        }),
      ],
    );

    const email: EmailHtmlWithInlineImages = await emailFor(description);

    expect(
      email.inlineImages.map((image: EmailInlineImage) => {
        return [image.fileName, image.base64];
      }),
    ).toEqual([
      ["image-1.png", PNG],
      ["image-2.jpg", JPEG],
      ["image-3.gif", GIF],
    ]);
    expect(email.html).toContain("Element not found: #login");
    expect(email.html.match(/<img src="cid:/g)).toHaveLength(3);
    expect(email.html).not.toContain("data:");
  });

  test("a JPEG screenshot in the image/png template is sent as a JPEG", async () => {
    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(ISSUE_TEMPLATE, [
        run({ screenshots: { my_error_shot: JPEG } }),
      ]),
    );

    expect(email.inlineImages[0]).toMatchObject({
      fileName: "image-1.jpg",
      mimeType: "image/jpeg",
      base64: JPEG,
    });
  });

  test("a run that took no screenshot leaves the error, and no broken image", async () => {
    const description: string = describeIncident(ISSUE_TEMPLATE, [
      run({ screenshots: {} }),
    ]);
    const email: EmailHtmlWithInlineImages = await emailFor(description);

    expect(email.inlineImages).toEqual([]);
    expect(email.html).toContain("Timeout 30000ms exceeded");
    expect(email.html).not.toContain("<img");
    expect(email.html.toLowerCase()).not.toContain("src=");
  });
});

/*
 * ISSUE #6010: THE DASHBOARD SHOWED THE SAME DESCRIPTION'S SCREENSHOT AS TEXT.
 *
 * Its viewer read a real screenshot - tens of kilobytes of base64 - as
 * Markdown too costly to read, and showed the description as text; past
 * 64 KB of a line it drew an empty image. The email was right all along:
 * it holds a screenshot's data back from marked, which the viewer now does
 * as well, with the same code (Utils/Markdown/Base64Data). These keep the
 * email right at every size the viewer got wrong, through the template of
 * the issue.
 */
describe("a screenshot of any size, from the probe to the incident email (#6010)", () => {
  const KB: number = 1024;
  const JPEG_SIGNATURE: ReadonlyArray<number> = [0xff, 0xd8, 0xff, 0xe0];
  const TEMPLATE: string =
    "Monitor is down - {{syntheticResponses.0.scriptError}}\n![](data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}})";

  // A JPEG of `byteCount` bytes as the probe reports it: its pixels random.
  const screenshot: (byteCount: number) => string = (
    byteCount: number,
  ): string => {
    const random: SeededRandom = seededRandom(byteCount);
    const bytes: Buffer = Buffer.alloc(byteCount);

    Buffer.from(JPEG_SIGNATURE).copy(bytes);

    for (
      let index: number = JPEG_SIGNATURE.length;
      index < byteCount;
      index++
    ) {
      bytes[index] = random(256);
    }

    return bytes.toString("base64");
  };

  const SIZES: Array<[string, number]> = [
    ["8 KB, which the dashboard drew", 8 * KB],
    ["12 KB, which the dashboard showed as text", 12 * KB],
    ["30 KB, the issue's", 30 * KB],
    ["47 KB, a line just under 64 KB", 47 * KB],
    ["49 KB, a line over it", 49 * KB],
    ["100 KB", 100 * KB],
    ["1 MB", 1024 * KB],
  ];

  for (const [label, byteCount] of SIZES) {
    test(`a JPEG of ${label}: the error, and the screenshot attached whole`, async () => {
      const shot: string = screenshot(byteCount);
      const description: string = describeIncident(TEMPLATE, [
        run({ screenshots: { home: shot } }),
      ]);

      expect(
        description ===
          `Monitor is down - Timeout 30000ms exceeded\n![](data:image/jpeg;base64,${shot})`,
      ).toBe(true);

      const email: EmailHtmlWithInlineImages = await emailFor(description);

      expect(email.inlineImages).toHaveLength(1);
      expect(email.inlineImages[0]).toMatchObject({
        fileName: "image-1.jpg",
        mimeType: "image/jpeg",
      });
      // Compared whole, not printed: it is up to a megabyte long.
      expect(email.inlineImages[0]!.base64.length).toBe(shot.length);
      expect(email.inlineImages[0]!.base64 === shot).toBe(true);
      expect(email.html).toBe(
        `<p>Monitor is down - Timeout 30000ms exceeded\n<img src="cid:${email.inlineImages[0]!.contentId}" alt="" style="max-width:100%;height:auto;"></p>\n`,
      );
    });
  }

  test("the issue's description holds no base64 in its email's HTML, at any size", async () => {
    for (const [, byteCount] of SIZES) {
      const email: EmailHtmlWithInlineImages = await emailFor(
        describeIncident(TEMPLATE, [
          run({ screenshots: { home: screenshot(byteCount) } }),
        ]),
      );

      // The HTML around the attachment's reference is the same few bytes.
      expect(email.html.length).toBeLessThan(200);
      expect(email.html).not.toContain(";base64,");
    }
  });
});

/*
 * What a monitored system reports is still only text. The template's author
 * writes the image; a reported value cannot make one, or turn the author's
 * image into something else.
 */
describe("a monitored system's text still cannot make an image", () => {
  test("an error message that holds an inline image's Markdown shows as text", async () => {
    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident("{{syntheticResponses.0.scriptError}}", [
        run({
          scriptError: `Error: ![x](data:image/png;base64,${PNG}) and ![y](https://tracker.example/p.png)`,
        }),
      ]),
    );

    expect(email.inlineImages).toEqual([]);
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("data:image/png;base64,");
  });

  test("log messages that hold an image's Markdown show as text", async () => {
    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(
        "{{#each syntheticResponses}}{{#each logMessages}}- {{this}}\n{{/each}}{{/each}}",
        [
          run({
            logMessages: [
              `![x](data:image/png;base64,${PNG})`,
              "<img src=x onerror=alert(1)>",
            ],
          }),
        ],
      ),
    );

    expect(email.inlineImages).toEqual([]);
    expect(email.html).not.toContain("<img");
  });

  /*
   * The ")" closes the author's image on the screenshot's own bytes, which
   * the value supplies anyway; the image it then tries to add is text.
   */
  test("a screenshot value that tries to add an image of its own adds only text", async () => {
    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(ISSUE_TEMPLATE, [
        run({
          screenshots: {
            my_error_shot: `${PNG}) ![tracker](https://tracker.example/p.png`,
          },
        }),
      ]),
    );

    expect(
      email.inlineImages.map((image: EmailInlineImage) => {
        return image.base64;
      }),
    ).toEqual([PNG]);
    expect(email.html.match(/<img /g)).toHaveLength(1);
    expect(email.html).not.toContain('src="https://tracker.example');
    expect(email.html).toContain("tracker");
  });

  test("a screenshot value that is not base64 shows no image", async () => {
    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(ISSUE_TEMPLATE, [
        run({ screenshots: { my_error_shot: "not a screenshot <b>" } }),
      ]),
    );

    expect(email.inlineImages).toEqual([]);
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<b>");
  });

  test("a screenshot value that is an SVG is not shown", async () => {
    const svg: string = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    ).toString("base64");

    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(
        "![](data:image/svg+xml;base64,{{syntheticResponses.0.screenshots.my_error_shot}})",
        [run({ screenshots: { my_error_shot: svg } })],
      ),
    );

    expect(email.inlineImages).toEqual([]);
    expect(email.html).not.toContain("<img");
  });
});

/*
 * ISSUE #6481: A SCREENSHOT A DESCRIPTION REFERENCES MANY TIMES.
 *
 * A description can show one screenshot several times: define it once as a
 * Markdown reference, and point several images at it - the issue's
 * template, below. marked writes the definition's address into every
 * reference, and the renderer put the screenshot's data back into each
 * one: a screenshot of 1 MB referenced 200 times was 280 MB of HTML before
 * attach() and took seconds, and one of 2.25 MB more than V8's longest
 * string, so the email went out as its Markdown, in text. Now the copies a
 * field's references make put back at most MAX_EMAIL_HELD_TEXT_IN_REFERENCES
 * of it: the references past that show the note an email leaves for an
 * image too large, and those within it the one attachment.
 */
describe("a screenshot a description references many times, from the probe to the incident email (#6481)", () => {
  const KB: number = 1024;
  const MB: number = 1024 * KB;
  const MOST: number = MAX_EMAIL_HELD_TEXT_IN_REFERENCES;
  const JPEG_SIGNATURE: ReadonlyArray<number> = [0xff, 0xd8, 0xff, 0xe0];
  const PNG_SIGNATURE: ReadonlyArray<number> = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ];
  const JPEG_PREFIX: string = "data:image/jpeg;base64,";
  const PNG_PREFIX: string = "data:image/png;base64,";
  const TOO_LARGE: string = "image too large to include in this email]";
  const STARTS: string = "<p>Monitor is down - Timeout 30000ms exceeded\n";

  // A JPEG of `byteCount` bytes as the probe reports it: its pixels random.
  const jpegOfSize: (byteCount: number) => string = (
    byteCount: number,
  ): string => {
    const random: SeededRandom = seededRandom(byteCount);
    const bytes: Buffer = Buffer.alloc(byteCount);

    Buffer.from(JPEG_SIGNATURE).copy(bytes);

    for (
      let index: number = JPEG_SIGNATURE.length;
      index < byteCount;
      index++
    ) {
      bytes[index] = random(256);
    }

    return bytes.toString("base64");
  };

  // A PNG whose base64 is exactly `length` characters: a signature, then `filler`.
  const pngOfBase64Length: (length: number, filler: number) => string = (
    length: number,
    filler: number,
  ): string => {
    return Buffer.concat([
      Buffer.from(PNG_SIGNATURE),
      Buffer.alloc((length / 4) * 3 - PNG_SIGNATURE.length, filler),
    ]).toString("base64");
  };

  // How many times `part` is in `text`.
  const countOf: (text: string, part: string) => number = (
    text: string,
    part: string,
  ): number => {
    return text.split(part).length - 1;
  };

  // `count` lines, each a reference to the screenshot `write` makes of its index.
  const referencesTo: (
    count: number,
    write: (index: number) => string,
  ) => string = (count: number, write: (index: number) => string): string => {
    const lines: Array<string> = [];

    for (let index: number = 1; index <= count; index++) {
      lines.push(write(index));
    }

    return lines.join("\n");
  };

  // The issue's template, with `count` references to its screenshot.
  const templateReferencing: (count: number) => string = (
    count: number,
  ): string => {
    return [
      "Monitor is down - {{syntheticResponses.0.scriptError}}",
      referencesTo(count, (index: number): string => {
        return `![Home ${index}][home]`;
      }),
      "",
      "[home]: data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}}",
    ].join("\n");
  };

  interface RenderedEmail {
    // The HTML before attach(), as the notification service is sent it.
    html: string;
    email: EmailHtmlWithInlineImages;
  }

  // The description as an email sends it, timed: the fastest of a few tries.
  const timedEmailFor: (
    description: string,
    limitInMs: number,
  ) => Promise<FastestRun<RenderedEmail>> = (
    description: string,
    limitInMs: number,
  ): Promise<FastestRun<RenderedEmail>> => {
    return fastestRunAsync({
      run: async (): Promise<RenderedEmail> => {
        const html: string = await Markdown.convertToHTML(
          description,
          MarkdownContentType.Email,
        );

        return { html: html, email: EmailInlineImages.attach(html) };
      },
      limitInMs: limitInMs,
    });
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the issue's template: two references, the screenshot shown twice from one attachment", async () => {
    const shot: string = jpegOfSize(30 * KB);

    const email: EmailHtmlWithInlineImages = await emailFor(
      describeIncident(
        [
          "Monitor is down - {{syntheticResponses.0.scriptError}}",
          "![Home][home]",
          "![Home, again][home]",
          "",
          "[home]: data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}}",
        ].join("\n"),
        [run({ screenshots: { home: shot } })],
      ),
    );

    expect(email.inlineImages).toHaveLength(1);
    expect(email.inlineImages[0]!.base64 === shot).toBe(true);

    const contentId: string = email.inlineImages[0]!.contentId;

    expect(email.html).toBe(
      `${STARTS}<img src="cid:${contentId}" alt="Home" style="max-width:100%;height:auto;">\n<img src="cid:${contentId}" alt="Home, again" style="max-width:100%;height:auto;"></p>\n`,
    );
  });

  /*
   * The issue's table: each screenshot shown as often as the budget holds
   * copies of it - every one from one attachment - then the note. One of
   * 2.25 MB is more than an email attaches, so every reference is the note,
   * as one reference to it always was.
   */
  const ROWS: Array<[string, number, number, number]> = [
    // The screenshot, its bytes, its references, the images the email shows.
    ["100 KB", 100 * KB, 200, 62],
    ["1 MB", MB, 20, 6],
    ["1 MB", MB, 40, 6],
    ["1 MB", MB, 200, 6],
    ["2.25 MB", 2.25 * MB, 20, 0],
    ["2.25 MB", 2.25 * MB, 200, 0],
  ];

  for (const [label, byteCount, count, shown] of ROWS) {
    test(`a JPEG of ${label} referenced ${count} times: HTML in good time, ${shown > 0 ? `the first ${shown} shown from one attachment, then the note` : "the note at every one"}`, async () => {
      const shot: string = jpegOfSize(byteCount);
      const description: string = describeIncident(templateReferencing(count), [
        run({ screenshots: { home: shot } }),
      ]);

      // The row stands on the budget, and on what an email attaches.
      expect(shown).toBe(
        byteCount <= MaxEmailInlineImageBytes
          ? Math.min(
              count,
              1 + Math.floor(MOST / (JPEG_PREFIX.length + shot.length)),
            )
          : 0,
      );

      const rendered: FastestRun<RenderedEmail> = await timedEmailFor(
        description,
        2000,
      );
      const { html, email } = rendered.result;

      expect(rendered.inMs).toBeLessThan(2000);
      // The text's own copy, the copies within the budget, and markup.
      expect(html.length).toBeLessThanOrEqual(
        description.length + MOST + count * 256,
      );

      // HTML, never the Markdown as text, nor cut.
      expect(email.html.startsWith(STARTS)).toBe(true);
      expect(email.html).not.toContain("![Home");
      expect(email.html).not.toContain("truncated");

      expect(email.inlineImages).toHaveLength(shown > 0 ? 1 : 0);
      expect(countOf(email.html, '<img src="cid:')).toBe(shown);
      expect(countOf(email.html, TOO_LARGE)).toBe(count - shown);

      // In the order of the text: the first references shown, then notes.
      for (let index: number = 1; index <= count; index++) {
        expect(
          email.html.includes(
            index <= shown
              ? `alt="Home ${index}"`
              : EmailInlineImages.getTooLargeImageNotice(`Home ${index}`),
          ),
        ).toBe(true);
      }
    });
  }

  /*
   * Two screenshots, each referenced twice: the second reference to each is
   * a copy, and the two copies' addresses come to the budget exactly. Each
   * is more than an email attaches, so the HTML before attach() shows what
   * the renderer put back; attached with room for both, each shows twice.
   */
  describe("the budget's boundary", () => {
    const HOME: string = pngOfBase64Length(MOST / 2 - 24, 0x41);
    const LOGIN: string = pngOfBase64Length(MOST / 2 - 20, 0x42);

    // The login screenshot's definition says `loginType`: its bytes decide.
    const describeBoth: (loginType: string) => string = (
      loginType: string,
    ): string => {
      return describeIncident(
        [
          "Monitor is down - {{syntheticResponses.0.scriptError}}",
          "![Home][home]",
          "![Login][login]",
          "![Home, again][home]",
          "![Login, again][login]",
          "",
          "[home]: data:image/png;base64,{{syntheticResponses.0.screenshots.home}}",
          `[login]: data:image/${loginType};base64,{{syntheticResponses.0.screenshots.login}}`,
        ].join("\n"),
        [run({ screenshots: { home: HOME, login: LOGIN } })],
      );
    };

    test("the two copies' addresses come to it exactly", () => {
      expect((PNG_PREFIX + HOME).length + (PNG_PREFIX + LOGIN).length).toBe(
        MOST,
      );
      expect(HOME.length + LOGIN.length + 2 * PNG_PREFIX.length).toBe(MOST);
    });

    test("exactly at it, both copies are shown", async () => {
      const html: string = await Markdown.convertToHTML(
        describeBoth("png"),
        MarkdownContentType.Email,
      );

      expect(countOf(html, `<img src="${PNG_PREFIX}`)).toBe(4);
      expect(html).not.toContain(TOO_LARGE);

      const email: EmailHtmlWithInlineImages = EmailInlineImages.attach(html, {
        maxTotalBytes: 8 * MB,
      });

      expect(email.inlineImages).toHaveLength(2);
      expect(countOf(email.html, '<img src="cid:')).toBe(4);
      expect(email.html).toContain('alt="Login, again"');
    });

    test("one character more - the login screenshot's address says image/jpeg - and its copy is the note", async () => {
      const html: string = await Markdown.convertToHTML(
        describeBoth("jpeg"),
        MarkdownContentType.Email,
      );

      expect(countOf(html, `<img src="${PNG_PREFIX}`)).toBe(3);
      expect(html).toContain('alt="Home, again"');
      expect(
        html.endsWith(
          `\n${EmailInlineImages.getTooLargeImageNotice("Login, again")}</p>\n`,
        ),
      ).toBe(true);

      const email: EmailHtmlWithInlineImages = EmailInlineImages.attach(html, {
        maxTotalBytes: 8 * MB,
      });

      expect(email.inlineImages).toHaveLength(2);
      expect(countOf(email.html, '<img src="cid:')).toBe(3);
    });
  });

  test("links to the screenshot are their text: its data is never put back into them", async () => {
    const shot: string = jpegOfSize(MB);
    const description: string = describeIncident(
      [
        "Monitor is down - {{syntheticResponses.0.scriptError}}",
        "![Home][home]",
        "",
        // A paragraph each: two hundred links in one are text to marked.
        referencesTo(200, (index: number): string => {
          return `[Open the screenshot ${index}][home]\n`;
        }),
        "",
        "[home]: data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}}",
      ].join("\n"),
      [run({ screenshots: { home: shot } })],
    );
    const judged: SpyInstance<typeof Markdown.getEmailUrl> = jest.spyOn(
      Markdown,
      "getEmailUrl",
    );

    const rendered: FastestRun<RenderedEmail> = await timedEmailFor(
      description,
      1000,
    );
    const { email } = rendered.result;

    expect(rendered.inMs).toBeLessThan(1000);
    // No address the renderer judged held the screenshot.
    expect(
      judged.mock.calls.every(
        (call: Parameters<typeof Markdown.getEmailUrl>): boolean => {
          return String(call[0] ?? "").length < KB;
        },
      ),
    ).toBe(true);

    expect(email.inlineImages).toHaveLength(1);
    expect(countOf(email.html, '<img src="cid:')).toBe(1);
    expect(email.html).not.toContain("<a ");
    expect(email.html).not.toContain("[Open the screenshot");
    expect(email.html).toContain("</p>\n<p>Open the screenshot 1</p>\n");
    expect(email.html.endsWith("<p>Open the screenshot 200</p>\n")).toBe(true);
  });

  /*
   * A description longer than an email field keeps is cut to fit, and marked
   * reads a definition wherever it is: the cut kept "![Home][home]" and
   * dropped the screenshot's definition at the end, so the email showed the
   * reference as text and attached nothing. The definition comes along now.
   */
  test("a description cut to fit: the screenshot defined at its end is attached and shown, and the error is cut with the note (#6963)", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const shot: string = jpegOfSize(30 * KB);
    const error: string =
      "Timeout 30000ms exceeded waiting for the login form ".repeat(6000);
    const description: string = describeIncident(
      [
        "Monitor is down",
        "![Home][home]",
        "",
        "{{syntheticResponses.0.scriptError}}",
        "",
        "[home]: data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}}",
      ].join("\n"),
      [run({ scriptError: error, screenshots: { home: shot } })],
    );

    // The error is more than an email field keeps.
    expect(description.length).toBeGreaterThan(MAX_EMAIL_FIELD_HTML_BYTES);

    const email: EmailHtmlWithInlineImages = await emailFor(description);

    expect(email.inlineImages).toHaveLength(1);
    expect(email.inlineImages[0]!.base64 === shot).toBe(true);
    expect(
      email.html.startsWith(
        `<p>Monitor is down\n<img src="cid:${email.inlineImages[0]!.contentId}" alt="Home" style="max-width:100%;height:auto;"></p>\n<p>Timeout 30000ms exceeded waiting for the login form `,
      ),
    ).toBe(true);
    expect(email.html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
    expect(EmailSize.getHtmlSizeInBytes(email.html)).toBeLessThanOrEqual(
      MAX_EMAIL_FIELD_HTML_BYTES,
    );
    expect(email.html).not.toContain("![Home");
    expect(email.html).not.toContain("[home]");
  });

  /*
   * The same, with the screenshot defined where marked reads it and the cut
   * did not look (#7230): in a block quote, in a list item indented four
   * spaces, right after a setext heading. The cut brings it on a line of its
   * own, without the quote's marker or the item's indentation.
   */
  test.each([
    ["in a block quote", "> "],
    ["in a list item, indented four spaces", "- Screenshot\n\n    "],
    ["right after a setext heading", "Screenshots\n===\n"],
  ])(
    "a description cut to fit, its screenshot defined %s: attached and shown, and the error cut with the note (#7230)",
    async (_name: string, before: string) => {
      jest.spyOn(logger, "warn").mockImplementation((): void => {});
      const shot: string = jpegOfSize(30 * KB);
      const error: string =
        "Timeout 30000ms exceeded waiting for the login form ".repeat(6000);
      const description: string = describeIncident(
        [
          "Monitor is down",
          "![Home][home]",
          "",
          "{{syntheticResponses.0.scriptError}}",
          "",
          `${before}[home]: data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}}`,
        ].join("\n"),
        [run({ scriptError: error, screenshots: { home: shot } })],
      );

      expect(description.length).toBeGreaterThan(MAX_EMAIL_FIELD_HTML_BYTES);

      const email: EmailHtmlWithInlineImages = await emailFor(description);

      expect(email.inlineImages).toHaveLength(1);
      expect(email.inlineImages[0]!.base64 === shot).toBe(true);
      expect(
        email.html.startsWith(
          `<p>Monitor is down\n<img src="cid:${email.inlineImages[0]!.contentId}" alt="Home" style="max-width:100%;height:auto;"></p>\n<p>Timeout 30000ms exceeded waiting for the login form `,
        ),
      ).toBe(true);
      expect(email.html.endsWith(EMAIL_TRUNCATED_TEXT_NOTE_HTML)).toBe(true);
      expect(EmailSize.getHtmlSizeInBytes(email.html)).toBeLessThanOrEqual(
        MAX_EMAIL_FIELD_HTML_BYTES,
      );
      expect(countOf(email.html, '<img src="cid:')).toBe(1);
      expect(email.html).not.toContain("![Home");
      expect(email.html).not.toContain("[home]");
      expect(email.html).not.toContain("base64");
    },
  );

  /*
   * A screenshot value whose bytes are no image: one image of it was always
   * its alt text, and so is every reference to it - none says it was too
   * large. Its data is put back for the text's own reference and the first
   * copy alone, so two hundred references take no longer than two.
   */
  test("a screenshot value that is no image, referenced 200 times: every reference is its alt text, in good time", async () => {
    // A megabyte that starts like no image file, as base64.
    const notAnImage: string = Buffer.alloc(MB, 0x5a).toString("base64");
    const description: string = describeIncident(templateReferencing(200), [
      run({ screenshots: { home: notAnImage } }),
    ]);

    const rendered: FastestRun<RenderedEmail> = await timedEmailFor(
      description,
      2000,
    );
    const { email } = rendered.result;

    expect(rendered.inMs).toBeLessThan(2000);
    expect(email.inlineImages).toEqual([]);
    expect(email.html).toBe(
      `${STARTS}${referencesTo(200, (index: number): string => {
        return `Home ${index}`;
      })}</p>\n`,
    );
  });

  test("a definition with a long title: the references within the budget are images, the title on the first alone - never the Markdown as text", async () => {
    const shot: string = jpegOfSize(100 * KB);
    const error: string =
      "Timeout 30000ms exceeded waiting for the login form ".repeat(2500);
    const description: string = describeIncident(
      [
        "Monitor is down",
        referencesTo(200, (index: number): string => {
          return `![Home ${index}][home]`;
        }),
        "",
        '[home]: data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}} "{{syntheticResponses.0.scriptError}}"',
      ].join("\n"),
      [run({ scriptError: error, screenshots: { home: shot } })],
    );

    // The title is the error, whole: over 64 KB of the definition's line.
    expect(description.includes(` "${error}"`)).toBe(true);
    expect(error.length).toBeGreaterThan(64 * KB);

    const rendered: FastestRun<RenderedEmail> = await timedEmailFor(
      description,
      2000,
    );
    const { html, email } = rendered.result;

    expect(rendered.inMs).toBeLessThan(2000);
    expect(html.length).toBeLessThanOrEqual(
      description.length + MOST + 200 * 256,
    );
    expect(email.html.startsWith("<p>Monitor is down\n")).toBe(true);
    expect(email.html).not.toContain("![Home");
    expect(email.html).not.toContain("truncated");
    expect(email.inlineImages).toHaveLength(1);
    expect(countOf(email.html, '<img src="cid:')).toBe(62);
    expect(countOf(email.html, TOO_LARGE)).toBe(138);
    expect(countOf(email.html, " title=")).toBe(1);
    expect(email.html).toContain(`alt="Home 1" title="${error}" style=`);
  });
});
