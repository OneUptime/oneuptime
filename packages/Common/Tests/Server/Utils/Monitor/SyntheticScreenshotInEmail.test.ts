import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import Markdown, {
  MarkdownContentType,
} from "../../../../Server/Types/Markdown";
import EmailInlineImages, {
  EmailHtmlWithInlineImages,
  EmailInlineImage,
} from "../../../../Server/Utils/Mail/EmailInlineImages";
import { JSONObject } from "../../../../Types/JSON";
import BrowserType from "../../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import Screenshots from "../../../../Types/Monitor/SyntheticMonitors/Screenshot";
import SyntheticMonitorResponse from "../../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

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
