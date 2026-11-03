import { readBaseline } from "./BaselineFile";
import LighthousePages, {
  FormFactor,
  FormFactors,
  LighthousePage,
} from "./Pages";
import {
  Baseline,
  Report,
  ReportAudit,
  describeItem,
  differencesFromBaseline,
  failingAudits,
  scanErrors,
  scoreOf,
} from "./Results";
import { expect, test } from "@playwright/test";

/*
 * Results.ts on reports written here: which audits count as failing, what
 * keeps a page from being judged, and how a report differs from what
 * Baseline.json recorded. Then Baseline.json itself against Pages.ts.
 */

function audit(
  score: number | null,
  scoreDisplayMode: string = "binary",
  more: Partial<ReportAudit> = {},
): ReportAudit {
  return { title: "An audit", score, scoreDisplayMode, ...more };
}

// Three categories as Lighthouse lays them out, with weights as it gives them.
function reportOf(
  audits: Record<string, ReportAudit>,
  more: Partial<Report> = {},
): Report {
  return {
    lighthouseVersion: "13.5.0",
    categories: {
      accessibility: {
        title: "Accessibility",
        score: 0.9,
        auditRefs: [
          { id: "color-contrast", weight: 7 },
          { id: "image-alt", weight: 10 },
          { id: "heading-order", weight: 3 },
          { id: "skip-link", weight: 3 },
          // A manual check: no weight, no score.
          { id: "logical-tab-order", weight: 0 },
        ],
      },
      "best-practices": {
        title: "Best practices",
        score: 1,
        auditRefs: [
          { id: "errors-in-console", weight: 1 },
          // Informative: never counts toward the score.
          { id: "js-libraries", weight: 0 },
        ],
      },
      seo: {
        title: "SEO",
        score: 1,
        auditRefs: [
          { id: "meta-description", weight: 1 },
          { id: "font-size", weight: 1 },
        ],
      },
      // Not scanned: its audits never count, whatever they score.
      performance: {
        title: "Performance",
        score: 0.2,
        auditRefs: [{ id: "largest-contentful-paint", weight: 25 }],
      },
    },
    audits: audits,
    ...more,
  };
}

function baselineOf(
  failing: Array<string>,
  lighthouse: string = "13.5.0",
): Baseline {
  return {
    lighthouse,
    pages: { "/pricing": { mobile: failing, desktop: [] } },
  };
}

function differences(
  report: Report,
  baseline: Baseline,
  formFactor: FormFactor = "mobile",
): Array<string> {
  return differencesFromBaseline({
    report,
    baseline,
    path: "/pricing",
    formFactor,
  });
}

test.describe("which audits fail", () => {
  test("a scored audit fails below the report's 0.9, and passes from it", () => {
    const report: Report = reportOf({
      "color-contrast": audit(0),
      "image-alt": audit(1),
      "heading-order": audit(0.89, "numeric"),
      "skip-link": audit(0.9, "numeric"),
      "errors-in-console": audit(0),
      "meta-description": audit(1),
      "font-size": audit(0),
    });

    expect(failingAudits(report)).toEqual([
      "color-contrast",
      "errors-in-console",
      "font-size",
      "heading-order",
    ]);
  });

  test("audits that score nothing, weigh nothing or are not scanned never fail", () => {
    const report: Report = reportOf({
      "color-contrast": audit(null, "notApplicable"),
      "image-alt": audit(null, "manual"),
      "logical-tab-order": audit(0),
      "js-libraries": audit(0, "informative"),
      "largest-contentful-paint": audit(0, "numeric"),
    });

    expect(failingAudits(report)).toEqual([]);
  });

  test("an audit two categories score is named once", () => {
    const report: Report = reportOf({ "color-contrast": audit(0) });

    report.categories["seo"]!.auditRefs.push({
      id: "color-contrast",
      weight: 1,
    });

    expect(failingAudits(report)).toEqual(["color-contrast"]);
  });

  test("a category's score reads out of 100, and a missing one as a dash", () => {
    const report: Report = reportOf({});

    report.categories["seo"]!.score = 0.916;
    report.categories["best-practices"]!.score = null;

    expect(scoreOf(report, "accessibility")).toBe("90");
    expect(scoreOf(report, "seo")).toBe("92");
    expect(scoreOf(report, "best-practices")).toBe("-");
    expect(scoreOf(report, "pwa")).toBe("-");
  });
});

test.describe("what keeps a page from being judged", () => {
  test("a page Lighthouse could not load", () => {
    const report: Report = reportOf(
      {},
      {
        runtimeError: {
          code: "ERRORED_DOCUMENT_REQUEST",
          message: "Lighthouse was unable to reliably load the page.",
        },
      },
    );

    expect(scanErrors(report)).toEqual([
      "Lighthouse could not scan the page: ERRORED_DOCUMENT_REQUEST: Lighthouse was unable to reliably load the page.",
    ]);
  });

  test("a scored audit that threw, and not one that weighs nothing", () => {
    const report: Report = reportOf({
      "image-alt": audit(null, "error", {
        title: "Image elements have `[alt]` attributes",
        errorMessage: "axe-core timed out",
      }),
      "js-libraries": audit(null, "error", { errorMessage: "no libraries" }),
    });

    expect(scanErrors(report)).toEqual([
      'Lighthouse could not run image-alt ("Image elements have `[alt]` attributes"): axe-core timed out',
    ]);
  });

  test("an errored audit is a difference even when the baseline has it", () => {
    const report: Report = reportOf({
      "color-contrast": audit(null, "error", { errorMessage: "it threw" }),
    });

    expect(differences(report, baselineOf(["color-contrast"]))).toEqual([
      'Lighthouse could not run color-contrast ("An audit"): it threw',
      "color-contrast passes now: take it out of /pricing's mobile list in Baseline.json, or record it again (Lighthouse/README.md).",
    ]);
  });
});

test.describe("differences from Baseline.json", () => {
  test("the audits it recorded failing still fail: no differences", () => {
    const report: Report = reportOf({
      "color-contrast": audit(0),
      "image-alt": audit(1),
    });

    expect(differences(report, baselineOf(["color-contrast"]))).toEqual([]);
  });

  test("an audit that fails now and did not then names the elements it fails on", () => {
    const report: Report = reportOf({
      "image-alt": audit(0, "binary", {
        title: "Image elements do not have `[alt]` attributes",
        details: {
          type: "table",
          items: [
            {
              node: {
                type: "node",
                selector: "main > img.hero",
                snippet: '<img class="hero" src="/img/hero.png">',
                explanation:
                  "Fix any of the following: Element has no alt attribute",
              },
            },
          ],
        },
      }),
    });

    expect(differences(report, baselineOf([]))).toEqual([
      'image-alt fails: Image elements do not have `[alt]` attributes\n    - main > img.hero <img class="hero" src="/img/hero.png"> Fix any of the following: Element has no alt attribute',
    ]);
  });

  test("at most five of a failure's elements are named", () => {
    const items: Array<unknown> = [];

    for (let index: number = 0; index < 8; index++) {
      items.push({ node: { selector: `li:nth-child(${index + 1}) > a` } });
    }

    const report: Report = reportOf({
      "color-contrast": audit(0, "binary", {
        title: "Contrast",
        details: { type: "table", items },
      }),
    });

    expect(differences(report, baselineOf([]))).toEqual([
      [
        "color-contrast fails: Contrast",
        "    - li:nth-child(1) > a",
        "    - li:nth-child(2) > a",
        "    - li:nth-child(3) > a",
        "    - li:nth-child(4) > a",
        "    - li:nth-child(5) > a",
        "    - and 3 more",
      ].join("\n"),
    ]);
  });

  test("an audit it recorded failing that passes now is a difference, so the baseline only tightens", () => {
    const report: Report = reportOf({
      "color-contrast": audit(1),
      "heading-order": audit(null, "notApplicable"),
    });

    expect(
      differences(report, baselineOf(["color-contrast", "heading-order"])),
    ).toEqual([
      "color-contrast passes now: take it out of /pricing's mobile list in Baseline.json, or record it again (Lighthouse/README.md).",
      "heading-order passes now: take it out of /pricing's mobile list in Baseline.json, or record it again (Lighthouse/README.md).",
    ]);
  });

  test("each form factor is held to its own list", () => {
    const report: Report = reportOf({ "color-contrast": audit(0) });

    expect(
      differences(report, baselineOf(["color-contrast"]), "mobile"),
    ).toEqual([]);
    expect(
      differences(report, baselineOf(["color-contrast"]), "desktop"),
    ).toEqual(["color-contrast fails: An audit"]);
  });

  test("a page it has nothing for", () => {
    const report: Report = reportOf({});
    const baseline: Baseline = { lighthouse: "13.5.0", pages: {} };

    expect(differences(report, baseline)).toEqual([
      "Baseline.json has nothing for /pricing on mobile: record it (Lighthouse/README.md).",
    ]);
  });

  test("another Lighthouse recorded it", () => {
    const report: Report = reportOf({});

    expect(differences(report, baselineOf([], "13.4.1"))).toEqual([
      "Baseline.json was recorded with Lighthouse 13.4.1, and this is 13.5.0, which can judge differently: record it again (Lighthouse/README.md).",
    ]);
  });
});

test.describe("how a failing audit's items read", () => {
  test("an element: its selector, its markup and why it fails", () => {
    expect(
      describeItem({
        node: {
          selector: "nav > a",
          snippet: "<a href='/pricing'>Pricing</a>",
          explanation: "Element has insufficient color contrast of 3.1",
        },
      }),
    ).toBe(
      "nav > a <a href='/pricing'>Pricing</a> Element has insufficient color contrast of 3.1",
    );
  });

  test("an element an audit names as its source, such as a robots meta tag", () => {
    expect(
      describeItem({
        source: {
          type: "node",
          snippet: '<meta name="robots" content="noindex">',
        },
      }),
    ).toBe('<meta name="robots" content="noindex">');
  });

  test("a console message: what it says and where it comes from, not its kind", () => {
    // errors-in-console's row: `source` is the kind of message.
    expect(
      describeItem({
        source: "network",
        description:
          "Failed to load resource: the server responded with a status of 404 (Not Found)",
        sourceLocation: {
          type: "source-location",
          url: "http://127.0.0.1:4800/manifest.json",
        },
      }),
    ).toBe(
      "Failed to load resource: the server responded with a status of 404 (Not Found) at http://127.0.0.1:4800/manifest.json",
    );
    // deprecations' row: the message is its value, the script its source.
    expect(
      describeItem({
        value: "Unload event listeners are deprecated",
        source: {
          type: "source-location",
          url: "http://127.0.0.1:4800/js/app.js",
        },
      }),
    ).toBe(
      "Unload event listeners are deprecated at http://127.0.0.1:4800/js/app.js",
    );
  });

  test("a request: its URL, with what it is when the row says", () => {
    expect(describeItem({ url: "https://oneuptime.com/img/missing.png" })).toBe(
      "https://oneuptime.com/img/missing.png",
    );
    expect(
      describeItem({ name: "__cf_bm", url: "https://example.com/a.js" }),
    ).toBe("__cf_bm at https://example.com/a.js");
    expect(describeItem({ text: "click here", href: "/pricing" })).toBe(
      "click here at /pricing",
    );
  });

  test("anything else as JSON, on one line, cut at 300 characters", () => {
    expect(describeItem({ subItems: { items: [] } })).toBe(
      '{"subItems":{"items":[]}}',
    );
    expect(describeItem("plain")).toBe("plain");

    const long: string = describeItem({ description: "x ".repeat(400) });

    expect(long.length).toBe(300);
    expect(long.endsWith("…")).toBe(true);
    expect(describeItem({ description: "two\n  lines" })).toBe("two lines");
  });

  test("a message megabytes long reads as quickly as a short one", () => {
    const started: number = Date.now();
    const line: string = describeItem({
      description: `Uncaught Error: ${" \n".repeat(2 * 1024 * 1024)}at the end`,
    });

    expect(line).toBe("Uncaught Error:");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

test.describe("how a failing audit reads", () => {
  test("an audit that names no elements says why it fails", () => {
    const report: Report = reportOf({
      "meta-description": audit(0, "binary", {
        title: "Document does not have a meta description",
        explanation: "Description text is empty.",
      }),
    });

    expect(differences(report, baselineOf([]))).toEqual([
      "meta-description fails: Document does not have a meta description\n    Description text is empty.",
    ]);
  });
});

test.describe("Baseline.json", () => {
  const baseline: Baseline = readBaseline();

  test("has every page Pages.ts lists, on every form factor, and no other", () => {
    const expected: Array<string> = [];

    for (const page of LighthousePages) {
      for (const formFactor of FormFactors) {
        expected.push(`${page.path} ${formFactor}`);
      }
    }

    const recorded: Array<string> = [];

    for (const [path, results] of Object.entries(baseline.pages)) {
      for (const formFactor of Object.keys(results)) {
        recorded.push(`${path} ${formFactor}`);
      }
    }

    expect(recorded.sort()).toEqual(expected.sort());
  });

  test("lists each page's audits once, sorted, as the suite records them", () => {
    for (const page of LighthousePages) {
      for (const formFactor of FormFactors) {
        const failing: Array<string> =
          baseline.pages[page.path]?.[formFactor] || [];

        expect(failing, `${page.path} ${formFactor}`).toEqual(
          Array.from(new Set(failing)).sort(),
        );
      }
    }
  });

  test("names a page once, by a path the proxy can be asked for", () => {
    const paths: Array<string> = LighthousePages.map(
      (page: LighthousePage): string => {
        return page.path;
      },
    );

    expect(paths).toEqual(Array.from(new Set(paths)));

    for (const path of paths) {
      expect(path, path).toMatch(/^\/[^\s?#]*$/);
    }
  });
});
