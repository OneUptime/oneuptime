import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { sideMenuAtRest } from "../SuiteHelpers/SideMenuAtRest";

/*
 * A cloud account's and a cloud resource's recommended monitors, and the
 * scheduled maintenance that holds a cloud resource, in a browser, against
 * the offline fixture (CloudRecommendations/Fixture): one AWS account a
 * connection reads, with the resources a team typically runs.
 *
 * Read the way a person reads them: the account's Recommendations, grouped
 * by type of resource, each recommended monitor with the resources it is for
 * and how many already have it, an Add for one resource or every one of its
 * type, and the resources left out named at the end, by why; the side menu's
 * count of what is left; what a viewer is told; a resource's own
 * Recommendations tab; and the Scheduled Maintenance tab of a resource an
 * event holds. At a laptop's width and a phone's, light and dark, in German
 * and in Persian (right to left). The fixture records every read and every
 * monitor made, so each test also checks nothing it does not model was asked
 * for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const ACCOUNT_ID: string = "30000000-0000-4000-8000-000000000001";
const ACCOUNT: string = `${DASHBOARD}/cloud/accounts/${ACCOUNT_ID}/recommendations`;

function resourceId(number: number): string {
  return `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const WEB_1: string = resourceId(7);
const WEB_2: string = resourceId(8);
const WEB_3: string = resourceId(9);
const ORDERS_DB: string = resourceId(3);
const REPORTS_DB: string = resourceId(4);
const PROD_VPC: string = resourceId(11);
const WWW_CERTIFICATE: string = resourceId(15);

function resourcePage(id: string, tab: string): string {
  return `${DASHBOARD}/cloud/${id}/${tab}`;
}

const STATUS_CHECKS: string = "CloudResource:cloud-aws-ec2-status-check-failed";
const EC2_HIGH_CPU: string = "CloudResource:cloud-aws-ec2-high-cpu";
const RDS_LOW_STORAGE: string = "CloudResource:cloud-aws-rds-low-storage";
const RDS_CONNECTIONS: string =
  "CloudResource:cloud-aws-rds-connections-near-limit";
const CERTIFICATE_EXPIRING: string =
  "CloudResource:cloud-aws-acm-certificate-expiring";
const EC2_GROUP: string = "aws|aws::ec2::instance";
const ACM_GROUP: string = "aws|aws::certificatemanager::certificate";

// Every five minutes: a cloud's metrics arrive a period at a time.
const EVERY_FIVE_MINUTES: string = "*/5 * * * *";
// Once an hour: a certificate's days come twice a day.
const EVERY_HOUR: string = "0 * * * *";

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };
const TABLET: { width: number; height: number } = { width: 768, height: 900 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/cloud-recommendations-ui",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's own words, as the fixture draws them with ?lang=de|fa.
const GERMAN: Record<string, string> = readLocale("de");
const PERSIAN: Record<string, string> = readLocale("fa");

interface CreatedModel {
  modelName: string;
  name: string;
  monitorType: string;
  monitoringInterval: string;
  cloudResourceIds: Array<string>;
}

interface Recorded {
  listRequests: Array<{ modelName: string }>;
  creates: Array<CreatedModel>;
  unhandled: Array<Record<string, unknown>>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const outsideRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const outside: Array<string> = [];
  pageErrors.set(page, errors);
  outsideRequests.set(page, outside);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  // Nothing may leave the fixture: no CDN, no telemetry, no real API.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }

    outside.push(url.toString());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(outsideRequests.get(page) || []).toEqual([]);

  if (!page.isClosed()) {
    const unhandled: Array<Record<string, unknown>> = await page.evaluate(
      (): Array<Record<string, unknown>> => {
        const fixture: Recorded | undefined = (
          window as unknown as { __cloudRecommendationsFixture?: Recorded }
        ).__cloudRecommendationsFixture;
        return fixture ? fixture.unhandled : [];
      },
    );

    // Every read the page made is one the fixture answers as the server does.
    expect(unhandled, "reads the fixture does not model").toEqual([]);
  }
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __cloudRecommendationsFixture: Recorded })
      .__cloudRecommendationsFixture;
  });
}

/*
 * A page of the fixture, once its heading is drawn in the Dashboard's font
 * and its side menu is at rest.
 */
async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.getByRole("heading", { level: 1 }).first()).not.toBeEmpty({
    timeout: 60000,
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await sideMenuAtRest(page);
}

// The account's list, once it has read what covers each recommendation.
async function openAccount(page: Page, query: string = ""): Promise<Locator> {
  await open(page, `${ACCOUNT}${query}`);
  const list: Locator = page.getByTestId("cloud-account-recommendations");
  await expect(list).toBeVisible({ timeout: 60000 });
  return list;
}

function desktopMenu(page: Page): Locator {
  return page.locator("aside[role='navigation']");
}

// The side menu's Recommendations entry, with the count it shows.
function recommendationsEntry(page: Page): Locator {
  return desktopMenu(page).getByRole("link", { name: /^Recommendations/ });
}

function row(page: Page, recommendationId: string): Locator {
  return page.getByTestId(
    `cloud-account-recommendation-row-${recommendationId}`,
  );
}

function coverage(page: Page, recommendationId: string): Locator {
  return page.getByTestId(
    `cloud-account-recommendation-coverage-${recommendationId}`,
  );
}

function notListed(page: Page, reason: string): Locator {
  return page.getByTestId(`cloud-account-recommendations-not-listed-${reason}`);
}

// A row's Show resources, beside how many have it.
function toggle(page: Page, recommendationId: string): Locator {
  return page.getByTestId(
    `cloud-account-recommendation-toggle-${recommendationId}`,
  );
}

/*
 * The list opens on what is not set up yet; the Recommended tile shows
 * every one, the ones set up and dismissed too.
 */
async function showEveryRecommendation(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^Show all \d+ recommendations$/ })
    .click();
}

test.describe("an account's Recommendations", () => {
  test("groups its resources' monitors by type, counts what is left in the menu, and names the ones left out at the end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    const list: Locator = await openAccount(page);

    await expect(
      list.locator("[data-testid^='cloud-account-recommendation-group-']"),
    ).toHaveCount(6);
    await expect(list.getByRole("heading", { level: 3 })).toHaveText([
      "ACM Certificate",
      "EC2 Instance",
      "Elastic Load Balancer (ALB, NLB, GWLB)",
      "Lambda Function",
      "RDS DB Instance",
      "SQS Queue",
      "Not in this list",
    ]);

    /*
     * Each type says how many resources it recommends monitors for: two of
     * the account's three instances, as web-3's metrics have not arrived.
     */
    await expect(
      page.getByTestId(`cloud-account-recommendation-group-${EC2_GROUP}`),
    ).toContainText("Recommended for 2 resources");

    // Each one says how many of the resources it is for already have it.
    await expect(coverage(page, STATUS_CHECKS)).toHaveText(
      "Set up on 0 of 2 resources",
    );
    // Which ones, a click away on the same line.
    await expect(toggle(page, STATUS_CHECKS)).toHaveText("Show resources");
    await expect(toggle(page, STATUS_CHECKS)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(coverage(page, RDS_LOW_STORAGE)).toHaveText(
      "Set up on 0 of 1 resource",
    );
    await expect(
      row(page, STATUS_CHECKS).getByRole("button", {
        name: "Add Status Checks Failing to the 2 resources still without it",
      }),
    ).toBeEnabled();
    await expect(
      page.getByTestId(`cloud-account-recommendation-add-all-${EC2_GROUP}`),
    ).toHaveText("Add All 4 Monitors");

    // The menu counts every one still to set up: the page's own number.
    await expect(recommendationsEntry(page)).toHaveText("Recommendations18");

    /*
     * The ones left out, by why, at the end: web-3, whose metrics have not
     * arrived, and the ones no recommended monitor is for yet. One waiting
     * opens the resource's own Recommendations tab, which says the rest.
     */
    await expect(notListed(page, "NoMetrics")).toContainText(
      "Waiting for their first metrics",
    );
    await expect(notListed(page, "NoMetrics").getByRole("link")).toHaveText([
      "web-3EC2 Instance",
    ]);
    await expect(
      notListed(page, "NoMetrics").getByRole("link", { name: /web-3/ }),
    ).toHaveAttribute("href", resourcePage(WEB_3, "recommendations"));
    await expect(notListed(page, "Unsupported").getByRole("link")).toHaveText([
      "edge-nlbElastic Load Balancer (ALB, NLB, GWLB)",
      "prod-vpcVPC",
      "storefront-assetsS3 Bucket",
    ]);
    /*
     * No recommended monitor is for them: each opens its Metrics tab, where
     * the reason's sentence says to make one.
     */
    await expect(
      notListed(page, "Unsupported").getByRole("link", { name: /prod-vpc/ }),
    ).toHaveAttribute("href", resourcePage(PROD_VPC, "metrics"));
    await expect(notListed(page, "NextRead")).toHaveCount(0);
    await screenshot(page, "cloud-account-recommendations-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-account-recommendations-390");
  });

  test("adds one to every resource of its type in one step: each monitor is made on its resource, linked to it, and read every five minutes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openAccount(page);

    await page
      .getByTestId(`cloud-account-recommendation-add-${STATUS_CHECKS}`)
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "These monitors will be created on 2 resources of this account. Everything below applies to all of them.",
    );
    await screenshot(page, "cloud-account-recommendations-panel-1280");
    await page.getByRole("button", { name: "Create Monitors" }).last().click();

    // The run reports each monitor, then closes on Close.
    const done: Locator = page.getByRole("button", { name: "Close" }).last();
    await expect(done).toBeEnabled({ timeout: 30000 });
    await done.click();

    const creates: Array<CreatedModel> = (await recorded(page)).creates;
    expect(
      creates.map((created: CreatedModel): Array<unknown> => {
        return [
          created.name,
          created.monitorType,
          created.monitoringInterval,
          created.cloudResourceIds,
        ];
      }),
    ).toEqual([
      ["web-1 - Status Checks Failing", "Metrics", EVERY_FIVE_MINUTES, [WEB_1]],
      ["web-2 - Status Checks Failing", "Metrics", EVERY_FIVE_MINUTES, [WEB_2]],
    ]);

    /*
     * Read again: both have it, so it leaves what is not set up yet, and the
     * menu counts two fewer.
     */
    await expect(row(page, STATUS_CHECKS)).toHaveCount(0);
    await expect(recommendationsEntry(page)).toHaveText("Recommendations16");
    await showEveryRecommendation(page);
    await expect(coverage(page, STATUS_CHECKS)).toHaveText(
      "Set up on 2 of 2 resources",
    );
    await expect(row(page, STATUS_CHECKS)).toContainText("All set up");

    // Add all adds the type's one left: as its row's Add, there is no Add all.
    await expect(
      page.getByTestId(`cloud-account-recommendation-add-all-${EC2_GROUP}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`cloud-account-recommendation-add-${EC2_HIGH_CPU}`),
    ).toHaveText("Add to 2 Resources");
  });

  /*
   * The newer monitors: a certificate's, read once an hour over 2 days (ACM
   * publishes its days twice a day), and a database's connections, offered
   * to the instance whose class and engine its inventory lists - orders-db,
   * not reports-db, which waits for its inventory.
   */
  test("a certificate's Certificate Expiring, made to run once an hour, and Connections Near the Limit on the database whose class is known", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openAccount(page);

    const certificates: Locator = page.getByTestId(
      `cloud-account-recommendation-group-${ACM_GROUP}`,
    );
    await expect(certificates).toContainText("Recommended for 1 resource");
    await expect(row(page, CERTIFICATE_EXPIRING)).toContainText(
      "Certificate Expiring",
    );
    await expect(row(page, CERTIFICATE_EXPIRING)).toContainText(
      "The certificate expires in 30 days or fewer.",
    );
    await expect(coverage(page, CERTIFICATE_EXPIRING)).toHaveText(
      "Set up on 0 of 1 resource",
    );
    await expect(row(page, RDS_CONNECTIONS)).toContainText(
      "Connections stay at 90% or more of the instance's limit for 30 minutes.",
    );
    await expect(coverage(page, RDS_CONNECTIONS)).toHaveText(
      "Set up on 0 of 1 resource",
    );
    await screenshot(page, "cloud-account-recommendations-newer-1280");

    await page
      .getByTestId(`cloud-account-recommendation-add-${CERTIFICATE_EXPIRING}`)
      .click();
    await page.getByRole("button", { name: "Create Monitors" }).last().click();

    const done: Locator = page.getByRole("button", { name: "Close" }).last();
    await expect(done).toBeEnabled({ timeout: 30000 });
    await done.click();

    expect(
      (await recorded(page)).creates.map(
        (created: CreatedModel): Array<unknown> => {
          return [
            created.name,
            created.monitorType,
            created.monitoringInterval,
            created.cloudResourceIds,
          ];
        },
      ),
    ).toEqual([
      [
        "www.acme-commerce.example - Certificate Expiring",
        "Metrics",
        EVERY_HOUR,
        [WWW_CERTIFICATE],
      ],
    ]);
    await expect(recommendationsEntry(page)).toHaveText("Recommendations17");
  });

  test("what was made and what was dismissed is counted, row by row and resource by resource", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openAccount(page, "?coverage=some");

    await expect(coverage(page, STATUS_CHECKS)).toHaveText(
      "Set up on 1 of 2 resources",
    );
    // Dismissed on its one resource: nothing left to set up, so not listed.
    await expect(row(page, RDS_LOW_STORAGE)).toHaveCount(0);
    // Eighteen, less three made and one dismissed.
    await expect(recommendationsEntry(page)).toHaveText("Recommendations14");

    await showEveryRecommendation(page);
    await expect(coverage(page, RDS_LOW_STORAGE)).toHaveText(
      "Set up on 0 of 1 resource · 1 dismissed",
    );
    await expect(row(page, RDS_LOW_STORAGE)).toContainText("Nothing to add");

    await toggle(page, STATUS_CHECKS).click();
    await expect(toggle(page, STATUS_CHECKS)).toHaveText("Hide resources");
    await expect(toggle(page, STATUS_CHECKS)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const web1: Locator = page.getByTestId(
      `cloud-account-recommendation-target-${STATUS_CHECKS}-${WEB_1}`,
    );
    const web2: Locator = page.getByTestId(
      `cloud-account-recommendation-target-${STATUS_CHECKS}-${WEB_2}`,
    );
    await expect(web1).toContainText("Created");
    await expect(
      web1.getByRole("link", { name: "View monitor" }),
    ).toBeVisible();
    await expect(
      web2.getByRole("button", { name: "Add Status Checks Failing to web-2" }),
    ).toBeEnabled();

    // A made one and an unmade one keep one row height.
    const [made, unmade]: Array<FrameBox> = await boxesInOneFrame([web1, web2]);
    expect(Math.abs(made!.height - unmade!.height)).toBeLessThanOrEqual(1);
    await screenshot(page, "cloud-account-recommendations-some-1280");
  });

  test("with every one made or dismissed, says there is nothing left, and the menu counts none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openAccount(page, "?coverage=all");

    await expect(
      page.getByText("Nothing left to set up here", { exact: true }),
    ).toBeVisible();
    await expect(recommendationsEntry(page)).toHaveText("Recommendations");
    // What is left out is still said.
    await expect(
      page.getByTestId("cloud-account-recommendations-not-listed"),
    ).toBeVisible();
  });

  test("a member who may not create monitors is told once, and every Add waits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openAccount(page, "?role=viewer");

    // Of monitors, as the page makes them by the dozen: never "this Monitor".
    await expect(
      page.getByTestId("cloud-account-recommendations-locked"),
    ).toContainText("You do not have permission to create monitors.");
    await expect(
      page.getByTestId(`cloud-account-recommendation-add-${STATUS_CHECKS}`),
    ).toBeDisabled();
    await expect(
      page.getByTestId(`cloud-account-recommendation-add-all-${EC2_GROUP}`),
    ).toBeDisabled();

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-account-recommendations-viewer-390");
  });

  /*
   * A read that fails keeps the page's frame - its title and what it is for
   * - and says why inside it, with Refresh to read it again.
   */
  test("a read that fails is said inside the page's card, with Refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, `${ACCOUNT}?fail=monitors`);

    const failed: Locator = page.getByTestId(
      "cloud-account-recommendations-error",
    );
    await expect(failed).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText("Recommended Monitors", { exact: true }),
    ).toBeVisible();
    await expect(failed.getByTestId("refresh-button")).toBeVisible();
    await screenshot(page, "cloud-account-recommendations-failed-1280");

    // Refresh reads again, and is told again: the fixture fails every time.
    const readsBefore: number = (await recorded(page)).listRequests.length;
    await failed.getByTestId("refresh-button").click();
    await expect(failed.getByTestId("refresh-button")).toBeVisible();
    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).listRequests.length;
      })
      .toBeGreaterThan(readsBefore);
  });

  test("a create the server refuses is reported monitor by monitor, in its words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openAccount(page, "?fail=create");

    await page
      .getByTestId(`cloud-account-recommendation-add-${STATUS_CHECKS}`)
      .click();
    await page.getByRole("button", { name: "Create Monitors" }).last().click();

    const progress: Locator = page.getByRole("dialog").last();
    await expect(progress).toContainText(
      "You do not have permission to create this monitor. Ask a project admin.",
      { timeout: 30000 },
    );
    await screenshot(page, "cloud-account-recommendations-create-failed-1280");
    await page.getByRole("button", { name: "Close" }).last().click();

    // Nothing was made, so nothing is counted as made.
    await expect(coverage(page, STATUS_CHECKS)).toHaveText(
      "Set up on 0 of 2 resources",
    );
  });

  test("German, and Persian laid out right to left, at a phone's width; dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openAccount(page, "?lang=de");
    await expect(
      page.getByText(GERMAN["Not in this list"]!, { exact: true }),
    ).toBeVisible();
    await screenshot(page, "cloud-account-recommendations-1280-de");

    await page.setViewportSize(PHONE);
    await openAccount(page, "?lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByText(PERSIAN["Not in this list"]!, { exact: true }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-account-recommendations-390-fa");

    await page.setViewportSize(LAPTOP);
    await openAccount(page, "?theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await screenshot(page, "cloud-account-recommendations-1280-dark");
  });
});

test.describe("a cloud resource's Recommendations", () => {
  test("an EC2 instance's two monitors, each made on it, linked to it and read every five minutes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, resourcePage(WEB_1, "recommendations"));

    await expect(
      page.getByText(
        "Monitors OneUptime recommends for this resource, from the metrics Amazon CloudWatch reports about it.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("0 of 2 recommended monitors created"),
    ).toBeVisible();
    // An instance has recommended monitors: its menu counts the two.
    await expect(recommendationsEntry(page)).toHaveText("Recommendations2");

    await page
      .getByRole("button", { name: "Select Status Checks Failing" })
      .click();
    await page
      .getByRole("button", { name: "Create 1 Selected Monitor" })
      .first()
      .click();
    await page.getByRole("button", { name: "Create Monitors" }).last().click();

    await expect(
      page.getByText("1 of 2 recommended monitors created"),
    ).toBeVisible({ timeout: 30000 });
    expect(
      (await recorded(page)).creates.map(
        (created: CreatedModel): Array<unknown> => {
          return [
            created.name,
            created.monitoringInterval,
            created.cloudResourceIds,
          ];
        },
      ),
    ).toEqual([["web-1 - Status Checks Failing", EVERY_FIVE_MINUTES, [WEB_1]]]);
    await screenshot(page, "cloud-resource-recommendations-1280");

    /*
     * Beside the side menu at a tablet's width the card is some 430px wide:
     * the search box takes the row and the severity filter goes under it,
     * rather than the two squeezing the box to a few letters.
     */
    await page.setViewportSize(TABLET);
    const search: Locator = page.getByTestId("recommendation-search");
    // The severity filter is a radio group: its first choice.
    const allSeverities: Locator = page.getByRole("radio", {
      name: "All severities",
      exact: true,
    });
    await expect(search).toBeVisible();
    await expect
      .poll(async (): Promise<boolean> => {
        const [box, filter]: Array<FrameBox> = await boxesInOneFrame([
          search,
          allSeverities,
        ]);
        return box!.width >= 300 && filter!.y >= box!.y + box!.height;
      })
      .toBe(true);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-resource-recommendations-768");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-resource-recommendations-390");
  });

  test("an RDS instance on a parameter group of its own is offered Connections Near the Limit, and told what its line assumes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, resourcePage(ORDERS_DB, "recommendations"));

    await expect(
      page.getByText(
        "Connections Near the Limit alerts at 1,521 connections: 90% of 1,691, the default limit of a db.r6g.large instance running PostgreSQL. If its parameter group, orders-postgres16, sets max_connections, change the monitor's threshold to 90% of that.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Connections Near the Limit", { exact: true }),
    ).toBeVisible();
    // High CPU, Low Free Storage and Connections Near the Limit.
    await expect(recommendationsEntry(page)).toHaveText("Recommendations3");
    await screenshot(page, "cloud-resource-recommendations-rds-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-resource-recommendations-rds-390");

    /*
     * In German and in Persian the note says the same two numbers, written
     * the reader's way, and names the group as AWS writes it.
     */
    await open(page, `${resourcePage(ORDERS_DB, "recommendations")}?lang=de`);
    const germanNote: Locator = page.getByText("„Connections Near the Limit“", {
      exact: false,
    });
    await expect(germanNote).toContainText("1.521 Verbindungen");
    await expect(germanNote).toContainText("90 % von 1.691");
    await expect(germanNote).toContainText("orders-postgres16");
    await expectNoSidewaysScroll(page);

    await open(page, `${resourcePage(ORDERS_DB, "recommendations")}?lang=fa`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const persianNote: Locator = page.getByText(
      "«Connections Near the Limit»",
      {
        exact: false,
      },
    );
    await expect(persianNote).toContainText(
      new Intl.NumberFormat("fa").format(1521),
    );
    await expect(persianNote).toContainText(
      new Intl.NumberFormat("fa").format(1691),
    );
    await expect(persianNote).toContainText("orders-postgres16");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-resource-recommendations-rds-390-fa");

    // One its inventory has not listed yet: both of its own wait for it, said once.
    await page.setViewportSize(LAPTOP);
    await open(page, resourcePage(REPORTS_DB, "recommendations"));
    await expect(
      page.getByText(
        "Low Free Storage and Connections Near the Limit are offered once the account's inventory lists the instance.",
      ),
    ).toBeVisible();
  });

  test("a type with none says so, and points at its Metrics tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, resourcePage(PROD_VPC, "recommendations"));

    await expect(
      page.getByText(
        "OneUptime has no recommended monitors for VPC yet. You can still alert on it: open a metric on its Metrics tab and create a monitor from the view.",
      ),
    ).toBeVisible();
    await expect(
      desktopMenu(page).getByRole("link", { name: "Metrics", exact: true }),
    ).toHaveAttribute("href", resourcePage(PROD_VPC, "metrics"));
    /*
     * Nothing to count and nothing to filter: no tiles, no search, no
     * Create - the note and the empty list say it.
     */
    await expect(page.getByTestId("recommendation-stat-All")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create Monitors" }),
    ).toHaveCount(0);
    // And its menu has no Recommendations: there will never be any.
    await expect(recommendationsEntry(page)).toHaveCount(0);
  });
});

test.describe("a cloud resource's Scheduled Maintenance", () => {
  test("lists the events that hold it: the one in progress and the one to come", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(
      page,
      `${resourcePage(ORDERS_DB, "scheduled-maintenance")}?maintenance=held`,
    );

    const rows: Locator = page.locator("table tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(
      "orders-db engine upgrade to PostgreSQL 16",
    );
    await expect(rows.nth(0)).toContainText("Ongoing");
    await expect(rows.nth(1)).toContainText("orders-db storage resize");
    await expect(rows.nth(1)).toContainText("Scheduled");
    await expect(
      page.getByRole("button", { name: "Create Maintenance Event" }),
    ).toBeVisible();
    await screenshot(page, "cloud-resource-scheduled-maintenance-1280");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cloud-resource-scheduled-maintenance-390");
  });

  test("a resource no event holds has none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await open(page, resourcePage(ORDERS_DB, "scheduled-maintenance"));

    await expect(page.locator("table tbody tr")).toHaveCount(0);
  });
});
