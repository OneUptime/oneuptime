import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * CLOUD RESOURCES A MONITOR SEEMS TO CHECK, ON ITS LINKED RESOURCES CARD.
 *
 * A website monitor whose host answers on a cloud resource a cloud
 * connection listed - a CDN on the host itself, a load balancer its CNAME
 * points to - is offered them at the foot of its Linked Resources card
 * (MonitorCloudLinkSuggestions, GET /monitor/cloud-resource-suggestions/:id).
 * What only a browser shows is checked here: the offers sit inside the
 * card, under what it is linked to, in dashed boxes; Link resource links
 * one, and the card then lists it and stops offering it; a refused link
 * says why; and a read that fails, or a monitor with nothing to offer,
 * leaves the card as it always was.
 *
 * The same guards as the other specs here: a network fence, no uncaught
 * page errors, and no request the fixture does not model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
// The fixture's website monitor, "Storefront".
const WEBSITE_MONITOR_ID: string = "70000000-0000-4000-8000-000000000002";
const WEBSITE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/${WEBSITE_MONITOR_ID}`;
// The fixture's cloud resources (Fixture.js CLOUD_RESOURCES).
const CDN_ID: string = "88000000-0000-4000-8000-000000000001";
const LOAD_BALANCER_ID: string = "88000000-0000-4000-8000-000000000002";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

interface RecordedUpdate {
  modelName: string;
  id: string;
  data: Record<string, unknown>;
}

interface RecordedApiRequest {
  method: string;
  url: string;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function openWebsite(page: Page, query: string = ""): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${WEBSITE_PATH}?type=website${query ? `&${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const card: Locator = linkedResourcesCard(page);
  await expect(card).toBeVisible({ timeout: 30000 });
  return card;
}

function linkedResourcesCard(page: Page): Locator {
  return page
    .getByTestId("card")
    .filter({ hasText: "What this monitor watches." });
}

async function fixtureState<T>(page: Page, key: string): Promise<T> {
  return page.evaluate((name: string): T => {
    const state: Record<string, unknown> = (
      window as unknown as {
        __monitorOverviewFixture: Record<string, unknown>;
      }
    ).__monitorOverviewFixture;
    return JSON.parse(JSON.stringify(state[name])) as T;
  }, key);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  expect(box, "the element is laid out").not.toBeNull();

  return box!;
}

async function screenshot(locator: Locator, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await locator.page().mouse.move(0, 0);
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

test.describe("cloud resources the monitor seems to check", () => {
  test("offered at the foot of the Linked Resources card, each saying why, inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openWebsite(page, "cloud=suggest");

    const section: Locator = card.getByTestId("monitor-cloud-link-suggestions");
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("heading", { name: "Suggested Cloud Resources" }),
    ).toBeVisible();

    // Under what it is linked to - here, nothing yet - in the same card.
    await expect(card).toContainText("Not linked to anything yet.");
    const empty: Box = await boxOf(
      card.getByText("Not linked to anything yet."),
    );
    const sectionBox: Box = await boxOf(section);
    const cardBox: Box = await boxOf(card);
    expect(sectionBox.y).toBeGreaterThan(empty.y);
    expect(sectionBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(sectionBox.x + sectionBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width + 0.5,
    );
    expect(sectionBox.y + sectionBox.height).toBeLessThanOrEqual(
      cardBox.y + cardBox.height + 0.5,
    );
    // No second card under the Linked Resources card.
    await expect(
      page.getByTestId("card").filter({ hasText: "Suggested Cloud Resources" }),
    ).toHaveCount(1);

    const offers: Locator = section.getByTestId(
      "monitor-cloud-link-suggestion",
    );
    await expect(offers).toHaveCount(2);

    // The CDN answers on the monitor's host itself.
    const cdn: Locator = offers.nth(0);
    await expect(
      cdn.getByRole("link", { name: "storefront-cdn" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/cloud/${CDN_ID}`);
    await expect(
      cdn.getByTestId("monitor-cloud-link-suggestion-reason"),
    ).toHaveText("Answers on shop.acme-commerce.example");

    // The load balancer is where the host's CNAME points.
    const loadBalancer: Locator = offers.nth(1);
    await expect(loadBalancer).toContainText(
      "Elastic Load Balancer (ALB, NLB, GWLB)",
    );
    await expect(
      loadBalancer.getByTestId("monitor-cloud-link-suggestion-reason"),
    ).toHaveText(
      "shop.acme-commerce.example points to storefront-alb-1234567890.us-east-1.elb.amazonaws.com",
    );

    // Offered, not linked: a dashed box each, inside the section.
    for (const offer of [cdn, loadBalancer]) {
      const style: string = await offer.evaluate((element: Element): string => {
        return getComputedStyle(element).borderTopStyle;
      });
      expect(style).toBe("dashed");
      const box: Box = await boxOf(offer);
      expect(box.x + box.width).toBeLessThanOrEqual(
        sectionBox.x + sectionBox.width + 0.5,
      );
      // Its button starts where its words do: no dialog footer's margin.
      const button: Box = await boxOf(offer.getByRole("button"));
      const words: Box = await boxOf(
        offer.getByTestId("monitor-cloud-link-suggestion-reason"),
      );
      expect(Math.abs(button.x - words.x)).toBeLessThanOrEqual(1);
    }

    // The reason gets up to two lines, then ends in "...".
    const reason: Locator = loadBalancer.getByTestId(
      "monitor-cloud-link-suggestion-reason",
    );
    const lineCount: number = await reason.evaluate(
      (element: Element): number => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return Math.round(
          element.getBoundingClientRect().height / parseFloat(style.lineHeight),
        );
      },
    );
    expect(lineCount).toBeLessThanOrEqual(2);

    // The suggestions read asked for this monitor's, and was answered.
    const requests: Array<RecordedApiRequest> = await fixtureState<
      Array<RecordedApiRequest>
    >(page, "apiRequests");
    expect(
      requests.filter((request: RecordedApiRequest): boolean => {
        return (
          request.method === "GET" &&
          new URL(request.url).pathname.endsWith(
            `/monitor/cloud-resource-suggestions/${WEBSITE_MONITOR_ID}`,
          )
        );
      }).length,
    ).toBeGreaterThan(0);

    await screenshot(card, "linked-resources-cloud-suggestions");
  });

  test("Link resource links it: the card lists it and offers it no more", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openWebsite(page, "cloud=suggest");
    const section: Locator = card.getByTestId("monitor-cloud-link-suggestions");

    await section.getByRole("button", { name: "Link storefront-alb" }).click();

    // Linked: the card offers only the one left...
    const offers: Locator = card.getByTestId("monitor-cloud-link-suggestion");
    await expect(offers).toHaveCount(1);
    await expect(offers.first()).toContainText("storefront-cdn");

    // ...and, read again, lists the linked one under its Cloud Resources.
    await expect(
      card.getByText("Cloud Resources", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("link", { name: "storefront-alb" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/cloud/${LOAD_BALANCER_ID}`,
    );
    await expect(card).not.toContainText("Not linked to anything yet.");

    // One write: the monitor's cloud resources, the new one with the others.
    const updates: Array<RecordedUpdate> = (
      await fixtureState<Array<RecordedUpdate>>(page, "updates")
    ).filter((update: RecordedUpdate): boolean => {
      return update.modelName === "Monitor";
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe(WEBSITE_MONITOR_ID);
    expect(updates[0]!.data).toEqual({ cloudResources: [LOAD_BALANCER_ID] });

    // The last one linked, nothing is offered: the section goes.
    await card
      .getByTestId("monitor-cloud-link-suggestions")
      .getByRole("button", { name: "Link storefront-cdn" })
      .click();
    await expect(
      card.getByRole("link", { name: "storefront-cdn" }),
    ).toBeVisible();
    await expect(
      card.getByTestId("monitor-cloud-link-suggestions"),
    ).toHaveCount(0);
  });

  test("a link that is refused says why in the card, and can be tried again", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openWebsite(
      page,
      "cloud=suggest&fail=cloud-link",
    );
    const section: Locator = card.getByTestId("monitor-cloud-link-suggestions");
    const link: Locator = section.getByRole("button", {
      name: "Link storefront-cdn",
    });

    await link.click();

    await expect(section.getByRole("alert")).toContainText(
      "You do not have permission to link cloud resources.",
    );
    await expect(link).toBeEnabled();
    await expect(
      section.getByTestId("monitor-cloud-link-suggestion"),
    ).toHaveCount(2);
  });

  test("nothing to offer, or a read that fails: the card is as it always was", async ({
    page,
  }: {
    page: Page;
  }) => {
    let card: Locator = await openWebsite(page);
    await expect(card).toContainText("Not linked to anything yet.");
    await expect(
      card.getByTestId("monitor-cloud-link-suggestions"),
    ).toHaveCount(0);

    card = await openWebsite(page, "cloud=suggest&fail=cloud-suggestions");
    await expect(card).toContainText("Not linked to anything yet.");
    // The read was made, and its failure shows nothing.
    await expect
      .poll(async (): Promise<number> => {
        const requests: Array<RecordedApiRequest> = await fixtureState<
          Array<RecordedApiRequest>
        >(page, "apiRequests");
        return requests.filter((request: RecordedApiRequest): boolean => {
          return new URL(request.url).pathname.includes(
            "/monitor/cloud-resource-suggestions/",
          );
        }).length;
      })
      .toBeGreaterThan(0);
    await expect(
      card.getByTestId("monitor-cloud-link-suggestions"),
    ).toHaveCount(0);
    await expect(card.getByRole("alert")).toHaveCount(0);
  });

  test("in the dark theme the offers are drawn dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openWebsite(page, "cloud=suggest&theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);

    const offer: Locator = card
      .getByTestId("monitor-cloud-link-suggestion")
      .first();
    await expect(offer).toBeVisible();

    // The words are light on the dark card, the box's dashes not white.
    const colors: { text: string; border: string } = await offer.evaluate(
      (element: Element): { text: string; border: string } => {
        const link: Element | null = element.querySelector("a");
        return {
          text: link ? getComputedStyle(link).color : "",
          border: getComputedStyle(element).borderTopColor,
        };
      },
    );
    expect(colors.text).not.toBe("rgb(17, 24, 39)");
    expect(colors.border).not.toBe("rgb(255, 255, 255)");

    await screenshot(card, "linked-resources-cloud-suggestions-dark");
  });
});
