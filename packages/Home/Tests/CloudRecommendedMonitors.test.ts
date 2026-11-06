import PageSEOConfig, { PageSEOData, getPageSEO } from "../Utils/PageSEO";
import {
  CloudRecommendedMonitorRow,
  CloudRecommendedMonitorsByCloud,
  CloudRecommendedMonitorsContent,
  getCloudRecommendedMonitorsContent,
  joinWithAnd,
} from "../Utils/CloudRecommendedMonitors";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { getCloudResourceTypeDisplayName } from "Common/Types/Cloud/CloudResourceCatalog";
import {
  CloudAlertTemplate,
  getAllCloudAlertTemplates,
  getCloudAlertTemplate,
  getCloudResourceTypesWithAlertTemplates,
} from "Common/Types/Monitor/CloudAlertTemplates";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * The Cloud product page says what Cloud's recommended monitors are and
 * what they cover: a feature of its own, in the page's own style, with a
 * picture of an account's Recommendations. Every number and every name it
 * shows is the product's catalog (Common/Types/Monitor/CloudAlertTemplates),
 * read by Utils/CloudRecommendedMonitors, and every claim it makes is in the
 * docs page that explains them - so the page cannot promise a monitor Cloud
 * does not offer, or miss one it does.
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

describe("the Cloud page's recommended monitors, from the catalog", () => {
  const content: CloudRecommendedMonitorsContent =
    getCloudRecommendedMonitorsContent();
  const templates: Array<CloudAlertTemplate> = getAllCloudAlertTemplates();

  test("counts every monitor the catalog has, and every kind of resource they are for", () => {
    expect(content.monitorCount).toBe(templates.length);
    expect(content.monitorCount).toBeGreaterThan(80);
    expect(content.resourceTypeCount).toBe(
      getCloudResourceTypesWithAlertTemplates().length,
    );
  });

  test("counts each cloud's, which add up to them all", () => {
    expect(
      content.byCloud.map((cloud: CloudRecommendedMonitorsByCloud) => {
        return cloud.name;
      }),
    ).toEqual(["AWS", "Azure", "Google Cloud"]);

    for (const cloud of content.byCloud) {
      expect(cloud.monitorCount).toBe(
        templates.filter((template: CloudAlertTemplate): boolean => {
          return template.provider === cloud.provider;
        }).length,
      );
      expect(cloud.resourceTypeCount).toBe(
        getCloudResourceTypesWithAlertTemplates(cloud.provider).length,
      );
      expect(cloud.monitorCount).toBeGreaterThan(0);
    }

    expect(
      content.byCloud.reduce(
        (sum: number, cloud: CloudRecommendedMonitorsByCloud): number => {
          return sum + cloud.monitorCount;
        },
        0,
      ),
    ).toBe(content.monitorCount);
    expect(
      content.byCloud.map((cloud: CloudRecommendedMonitorsByCloud) => {
        return cloud.provider;
      }),
    ).toEqual([CloudProvider.AWS, CloudProvider.Azure, CloudProvider.GCP]);
  });

  test("the summary line says each cloud's count, the way the page writes a list", () => {
    const [aws, azure, gcp] = content.byCloud;

    expect(content.byCloudSummary).toBe(
      `${aws!.monitorCount} for AWS, ${azure!.monitorCount} for Azure and ${gcp!.monitorCount} for Google Cloud`,
    );
    expect(joinWithAnd([])).toBe("");
    expect(joinWithAnd(["a"])).toBe("a");
    expect(joinWithAnd(["a", "b"])).toBe("a and b");
    expect(joinWithAnd(["a", "b", "c"])).toBe("a, b and c");
  });

  test("pictures real monitors, each by its catalog name and severity, on its resource type", () => {
    expect(content.rows.length).toBe(4);

    for (const row of content.rows) {
      const template: CloudAlertTemplate | undefined = getCloudAlertTemplate(
        row.templateId,
      );

      expect(template).toBeDefined();
      expect(row.name).toBe(template!.name);
      expect(row.severity).toBe(template!.severity);
      expect(row.resourceTypeLabel).toBe(
        getCloudResourceTypeDisplayName(
          template!.provider,
          template!.resourceTypes[0],
        ),
      );
      expect(row.createdCount).toBeGreaterThanOrEqual(0);
      expect(row.createdCount).toBeLessThanOrEqual(row.resourceCount);
    }
  });

  test("among them the newest: a database near its connection limit, a certificate about to expire", () => {
    const pictured: Array<string> = content.rows.map(
      (row: CloudRecommendedMonitorRow): string => {
        return `${row.resourceTypeLabel}: ${row.name}`;
      },
    );

    expect(pictured).toEqual([
      "EC2 Instance: Status Checks Failing",
      "RDS DB Instance: Connections Near the Limit",
      "Lambda Function: Function Errors",
      "ACM Certificate: Certificate Expiring",
    ]);
  });
});

describe("cloud.ejs: Recommended Monitors", () => {
  const content: CloudRecommendedMonitorsContent =
    getCloudRecommendedMonitorsContent();
  let html: string = "";
  let section: string = "";
  let spend: string = "";

  beforeAll(async () => {
    html = words(
      await render("cloud.ejs", {
        enableGoogleTagManager: false,
        seo: seoFor("/product/cloud"),
        homeUrl: HOME_URL,
        cloudRecommendedMonitors: content,
      }),
    );
    section = html.slice(
      html.indexOf('id="cloud-recommended-monitors"'),
      html.indexOf("<!-- Feature 6: Spend -->"),
    );
    spend = html.slice(
      html.indexOf('id="cloud-spend"'),
      html.indexOf("<!-- More Features Section -->"),
    );
  });

  test("is a feature of its own, after Resource Pages and before Spend", () => {
    const resourcePages: number = html.indexOf(
      "Everything about a resource, in one place",
    );
    const monitors: number = html.indexOf('id="cloud-recommended-monitors"');
    const costs: number = html.indexOf('id="cloud-spend"');

    expect(resourcePages).toBeGreaterThan(-1);
    expect(monitors).toBeGreaterThan(resourcePages);
    expect(costs).toBeGreaterThan(monitors);
    expect(section).toContain("Recommended Monitors");
    expect(section).toContain(
      "The alerts each resource needs, ready to turn on",
    );
    expect(section).toContain('href="/accounts/register"');
  });

  test("says how many there are, for how many kinds of resource, and each cloud's count", () => {
    expect(section).toContain(
      `OneUptime recommends ${content.monitorCount} monitors for ${content.resourceTypeCount} kinds of cloud resource`,
    );
    expect(section).toContain(content.byCloudSummary);
  });

  test("says what they watch, on a line made for each resource", () => {
    for (const claim of [
      "an instance failing its status checks",
      "a database running out of storage or near its connection limit",
      "a function's errors",
      "a queue backing up",
      "a certificate about to expire",
      "Add one to a resource, or to every resource of its type in an account at once.",
      "Thresholds set from each resource's own limits",
      "Incidents and alerts on the resource's page",
      "Quiet during the resource's scheduled maintenance",
      "Read from the metrics the connection already collects",
    ]) {
      expect(section).toContain(claim);
    }
  });

  /*
   * A short paragraph and four points, none saying another's words again:
   * the paragraph said "one resource or every resource of a type" and "a
   * line made for that resource", and two points said both once more.
   */
  test("says each thing once: a short paragraph, and four points that add to it", () => {
    const paragraph: string = section.slice(
      section.indexOf('<p class="mt-4 text-lg text-gray-600">'),
      section.indexOf("</p>"),
    );
    const points: Array<string> = section
      .slice(section.indexOf("<ul"), section.indexOf("</ul>"))
      .split("<li")
      .slice(1);

    expect(points).toHaveLength(4);
    // As long as the page's other features' paragraphs, not twice as long.
    expect(paragraph.length).toBeLessThan(420);
    expect(paragraph).not.toContain("on a line made for");
    for (const point of points) {
      // The point's own words: what follows its check mark.
      const text: string = point
        .slice(
          point.indexOf("</svg>") + "</svg>".length,
          point.indexOf("</li>"),
        )
        .trim();

      expect(text).not.toContain("every resource of a type");
      // One line beside its check mark on a laptop, as the other features' points.
      expect(`${text}: ${text.length <= 55}`).toBe(`${text}: true`);
    }
  });

  test("pictures an account's Recommendations, each row named and labeled as the catalog has it", () => {
    expect(section).toContain("aws-production · Recommendations");

    for (const row of content.rows) {
      const start: number = section.indexOf(
        `data-recommended-monitor="${row.templateId}"`,
      );

      expect(start).toBeGreaterThan(-1);

      const rowHtml: string = section.slice(
        start,
        section.indexOf("data-recommended-monitor=", start + 1) > -1
          ? section.indexOf("data-recommended-monitor=", start + 1)
          : undefined,
      );

      expect(rowHtml).toContain(`>${row.resourceTypeLabel}</div>`);
      expect(rowHtml).toContain(`<span>${row.name}</span>`);
      expect(rowHtml).toContain(`>${row.severity}</span>`);
      expect(rowHtml).toContain(
        `Set up on ${row.createdCount} of ${row.resourceCount} resources`,
      );

      if (row.createdCount >= row.resourceCount) {
        expect(rowHtml).toContain("All set up");
        expect(rowHtml).not.toContain("Add to ");
      } else {
        expect(rowHtml).toContain(
          `Add to ${row.resourceCount - row.createdCount}</span>`,
        );
        expect(rowHtml).not.toContain("All set up");
      }

      /*
       * Its severity as a pill, as the product's badge draws it: a
       * Critical one red, a Warning amber - in the product's own case.
       */
      expect(rowHtml).toContain(
        row.severity === "Critical"
          ? "bg-red-50 text-red-700 ring-red-200"
          : "bg-amber-50 text-amber-800 ring-amber-200",
      );
      expect(rowHtml).not.toContain("uppercase text-");
    }
  });

  test("the features still alternate: Spend now draws its picture first, as Resource Pages does", () => {
    const picture: number = spend.indexOf(
      'class="order-2 lg:order-1 mt-12 lg:mt-0"',
    );
    const text: number = spend.indexOf('class="order-1 lg:order-2"');

    expect(picture).toBeGreaterThan(-1);
    expect(text).toBeGreaterThan(picture);
    // The words are still the Spend feature's.
    expect(spend.slice(text)).toContain("What it costs, and how to spend less");
    expect(spend.slice(picture, text)).toContain("Cloud · Costs");
    // And the new feature draws its words first, its picture second.
    expect(section.indexOf('<div class="relative">')).toBeLessThan(
      section.indexOf('<div class="mt-12 lg:mt-0">'),
    );
  });

  test("How It Works says the recommended monitors are the first way to alert", () => {
    expect(html).toContain(
      "Turn on the monitors OneUptime recommends for each resource, or alert on any metric, and see each change on the charts of the resource it touched.",
    );
  });

  test("everything it claims is in the docs pages that explain them", () => {
    const accounts: string = words(
      fs.readFileSync(
        path.join(DOCS_CONTENT, "telemetry", "cloud-accounts.md"),
        "utf8",
      ),
    );
    const resources: string = words(
      fs.readFileSync(
        path.join(DOCS_CONTENT, "telemetry", "cloud-resources.md"),
        "utf8",
      ),
    );

    for (const claim of [
      "An account's **Recommendations** lists the monitors OneUptime recommends for its resources",
      "add one to a resource, or to every resource of its type at once",
      "Each monitor reads the key metrics the connection reads",
      "is linked to its resource",
      "its incidents and alerts are listed on the resource's page",
      "fires once the certificate has 30 days or fewer left",
      "judged against 90% of the connection limit of its class and engine",
      "its monitors open no incident or alert",
    ]) {
      expect(accounts).toContain(claim);
    }

    expect(resources).toContain(
      "is offered the monitors OneUptime recommends for its type on its **Recommendations** tab",
    );
  });

  test("its search entry names them, and stays short", () => {
    const seo: PageSEOData = PageSEOConfig["/product/cloud"]!;

    expect(seo.softwareApplication?.features).toEqual(
      expect.arrayContaining([
        "Recommended monitors for every kind of cloud resource",
      ]),
    );
    expect(seo.description.length).toBeLessThanOrEqual(230);
  });
});
