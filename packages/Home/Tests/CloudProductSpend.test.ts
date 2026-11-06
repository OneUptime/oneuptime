import PageSEOConfig, { PageSEOData, getPageSEO } from "../Utils/PageSEO";
import { CLOUD_BUDGET_DEFAULT_THRESHOLDS } from "Common/Types/Cloud/CloudCost";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * The Cloud product page says what Cloud does now: each resource's health
 * from its key metrics, with what needs attention first, and what the
 * connected accounts cost, the ways to spend less and budgets that alert.
 * Each claim is held here to the product and its docs, so the page cannot
 * promise what Cloud does not do.
 */

const HOME: string = path.join(__dirname, "..");
const VIEWS_ROOT: string = path.join(HOME, "Views");
const HOME_URL: string = "https://oneuptime.com";
const DOCS_CONTENT: string = path.join(
  HOME,
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

// A run of spaces, line breaks and indentation in the page's markup.
const WHITESPACE: RegExp = /\s+/g;

async function render(
  templateFileName: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, templateFileName),
    locals,
    { views: [VIEWS_ROOT] },
  )) as string;
}

function seoFor(pagePath: string): PageSEOData & { fullCanonicalUrl: string } {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

// The page's own words, without its markup's line breaks and indentation.
function words(html: string): string {
  return html.replace(WHITESPACE, " ");
}

describe("the Cloud product page: what it costs, and how to spend less", () => {
  let html: string = "";
  let spend: string = "";

  beforeAll(async () => {
    html = words(
      await render("cloud.ejs", {
        enableGoogleTagManager: false,
        seo: seoFor("/product/cloud"),
        homeUrl: HOME_URL,
      }),
    );
    spend = html.slice(
      html.indexOf('id="cloud-spend"'),
      html.indexOf("<!-- More Features Section -->"),
    );
  });

  test("has a Spend section among the features", () => {
    expect(html).toContain('id="cloud-spend"');
    expect(spend).toContain("What it costs, and how to spend less");
    expect(spend).toContain("Get started");
  });

  test("names where the costs come from: each cloud's own billing", () => {
    for (const source of [
      "AWS Cost Explorer",
      "Azure Cost Management",
      "Google Cloud's billing export",
    ]) {
      expect(spend).toContain(source);
    }
  });

  test("says budgets alert at the product's own default thresholds", () => {
    expect(CLOUD_BUDGET_DEFAULT_THRESHOLDS).toEqual([80, 100]);
    expect(spend).toContain(
      `passes ${CLOUD_BUDGET_DEFAULT_THRESHOLDS[0]}% and ${CLOUD_BUDGET_DEFAULT_THRESHOLDS[1]}%`,
    );
    expect(spend).toContain("Budgets that alert before the money is spent");
  });

  test("says the ways to spend less come from each cloud's recommender, the largest first", () => {
    expect(spend).toContain("its own recommender");
    expect(spend).toContain(
      "Rightsizing and idle resources, the largest saving first",
    );
  });

  test("says each resource's health is read from its metrics, and what needs attention comes first", () => {
    expect(html).toContain("Each resource's health, and what needs attention");
    expect(html).toContain(
      "put it under Needs attention, the most urgent first",
    );
  });

  test("everything it promises is in the docs page that explains it", () => {
    const docs: string = fs.readFileSync(
      path.join(DOCS_CONTENT, "telemetry", "cloud-costs.md"),
      "utf8",
    );

    for (const claim of [
      "Cost Explorer",
      "Cost Management",
      "BigQuery",
      "Cost Optimization Hub",
      "Azure Advisor",
      "Recommender",
      // The budget form's Alert At, as the docs say it starts.
      `${CLOUD_BUDGET_DEFAULT_THRESHOLDS[0]} and ${CLOUD_BUDGET_DEFAULT_THRESHOLDS[1]} to start with`,
    ]) {
      expect(docs).toContain(claim);
    }
  });

  test("its search entry and schema say it too, still read-only", () => {
    const seo: PageSEOData = PageSEOConfig["/product/cloud"]!;

    expect(seo.description).toContain("read-only");
    expect(seo.description).toContain("what it costs and how to spend less");
    expect(seo.description).toContain("budgets that alert");
    // A search result's description stays under what engines show.
    expect(seo.description.length).toBeLessThanOrEqual(230);
    expect(seo.softwareApplication?.features).toEqual(
      expect.arrayContaining([
        "Each resource's health from its key metrics",
        "Rightsizing and savings from each cloud's own recommender",
        "Monthly budgets that alert before the money is spent",
      ]),
    );
  });
});
