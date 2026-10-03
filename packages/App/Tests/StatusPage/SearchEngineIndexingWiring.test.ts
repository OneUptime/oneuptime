/**
 * The wiring between the resolved flag and the page.
 *
 * Everything either side of this is unit tested: getStatusPageData turns the
 * /seo response into a boolean, the template turns a boolean into a meta tag,
 * applyStatusPageRobotsHeader turns it into a header. What is left is the two
 * renderers that have to hand the boolean from one to the other - and neither
 * is reachable from a test. App/FeatureSet/StatusPage/Serve.ts passes its
 * config straight into App.init (importing it starts a server), and
 * Frontend/Index.ts keeps StatusPageFrontendConfig module-private.
 *
 * So they are read, the way StatusPageResourcesPageInvariants.test.ts reads
 * the pages it pins. The failure this catches is the one that leaves no trace:
 * a renderer that stops passing the variable renders a page with no meta tag,
 * HTTP 200, nothing in the logs - the toggle just quietly does nothing.
 *
 * Sources are stripped of comments and whitespace-squashed first, so a comment
 * mentioning the thing being asserted cannot pass a test on its own, and
 * prettier re-wrapping a line cannot fail one.
 */

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const FEATURE_SET: string = path.join(__dirname, "..", "..", "FeatureSet");

function readCode(...relativeParts: Array<string>): string {
  const raw: string = fs.readFileSync(
    path.join(FEATURE_SET, ...relativeParts),
    "utf8",
  );

  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const INDEX_RENDERERS: Array<[string, string]> = [
  ["standalone status-page container", readCode("StatusPage", "Serve.ts")],
  ["combined App container", readCode("Frontend", "Index.ts")],
];

describe.each(INDEX_RENDERERS)(
  "the index page renderer in the %s",
  (_name: string, code: string) => {
    test("hands the flag to the template", () => {
      /*
       * index.ejs reads a variable of exactly this name and emits nothing when
       * it is absent. A renderer that drops it produces an indexable page for
       * an owner who asked for the opposite.
       */
      expect(code).toContain("isSearchEngineIndexingEnabled:");
      expect(code).toContain("statusPageData.isSearchEngineIndexingEnabled");
    });

    test("also sets the response header", () => {
      expect(code).toContain(
        'import applyStatusPageRobotsHeader from "Common/Server/Utils/StatusPageSearchEngineIndexing"',
      );
      expect(code).toContain("applyStatusPageRobotsHeader(");
    });

    test("keeps the response object it needs to set that header", () => {
      /*
       * Both renderers used to name the response parameter _res, unused. A
       * refactor that puts the underscore back would leave
       * applyStatusPageRobotsHeader with nothing to write to - and TypeScript
       * would catch that, but only if the call is still there, which is what
       * the test above is for. This pins the other half.
       */
      expect(code).not.toContain("_res: ExpressResponse");
    });
  },
);

describe("the dashboard", () => {
  const brandingPage: string = readCode(
    "Dashboard",
    "src",
    "Pages",
    "StatusPages",
    "View",
    "Branding.tsx",
  );

  const indexingCard: string = readCode(
    "Dashboard",
    "src",
    "Components",
    "StatusPage",
    "SearchEngineIndexingCard.tsx",
  );

  test("offers the switch on the Branding page, where the other SEO settings live", () => {
    /*
     * "index by default, but users can turn that off" needs somewhere to turn
     * it off. It is on the Branding page with the page title and description
     * because that is where someone looking for their status page's SEO
     * settings goes - folded under Advanced there, since few people change it.
     */
    expect(brandingPage).toContain("<SearchEngineIndexingCard");
    expect(brandingPage).toContain("pageTitle: true");
    expect(brandingPage.indexOf("<AdvancedPageSection")).toBeLessThan(
      brandingPage.indexOf("<SearchEngineIndexingCard"),
    );
  });

  test("is a switch that saves this column the moment it is flipped, not an Edit dialog", () => {
    expect(indexingCard).toContain("<StatusPageSwitchRow");
    expect(indexingCard).toContain('column="enableSearchEngineIndexing"');
    expect(indexingCard).not.toContain("CardModelDetail");
    expect(indexingCard).not.toContain("FormFieldSchemaType.Toggle");
    // The page itself no longer edits it with a toggle in a form.
    expect(brandingPage).not.toContain("enableSearchEngineIndexing: true");
    expect(brandingPage).not.toContain("FormFieldSchemaType.Toggle");
  });

  test("shows the current setting: it reads the column, and on unless it is false", () => {
    expect(indexingCard).toContain("enableSearchEngineIndexing: true,");
    expect(indexingCard).toContain("item.enableSearchEngineIndexing !== false");
    expect(indexingCard).toContain("initialValue={isOn}");
  });
});
