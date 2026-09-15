import { expect, Page, Route as PlaywrightRoute, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

const pageErrors: Map<Page, Array<string>> = new Map();

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/topology/overview";
const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../output/playwright/topology",
);

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function openView(
  page: Page,
  tab: string,
  extraQuery: string = "",
): Promise<void> {
  await page.goto(
    `${ROUTE}?tab=${encodeURIComponent(tab)}${extraQuery ? `&${extraQuery}` : ""}`,
  );
  await expect(
    page.getByRole("heading", { name: "Topology", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: tab, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

function infrastructureRows(page: Page): ReturnType<Page["getByTestId"]> {
  return page.getByTestId("infrastructure-row");
}

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error: Error): void => {
    pageErrors.get(page)!.push(error.message);
  });
  await page.clock.setFixedTime(new Date("2026-09-07T10:00:00Z"));
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (
      target.protocol === "http:" &&
      target.hostname === "127.0.0.1" &&
      target.port === "4199"
    ) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "No uncaught browser errors").toEqual([]);
  pageErrors.delete(page);
});

test("infrastructure is a tree of containers with a table per scope, search and a one-level map", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Infrastructure");
  await expect(page.getByTestId("infrastructure-explorer")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Kubernetes" })
      .getByTestId("infrastructure-row"),
  ).toHaveCount(2);
  await screenshot(page, "infrastructure-overview-synthetic");

  await page
    .getByRole("button", { name: "Open Production Europe", exact: true })
    .click();
  await expect(page.getByTestId("infrastructure-scope-title")).toHaveText(
    "Production Europe",
  );
  await expect(infrastructureRows(page)).toHaveCount(3);
  await page
    .getByRole("button", { name: "Open eu-worker-01", exact: true })
    .click();
  await expect(infrastructureRows(page)).toHaveCount(20);
  await expect(
    page.getByRole("navigation", { name: "Infrastructure location" }),
  ).toContainText("Production Europe");

  await page
    .getByRole("searchbox", { name: "Search infrastructure" })
    .fill("checkout-1-02");
  await expect(infrastructureRows(page)).toHaveCount(1);
  await expect(infrastructureRows(page).first()).toContainText(
    "in eu-worker-01",
  );
  await page.getByRole("searchbox", { name: "Search infrastructure" }).fill("");
  await expect(infrastructureRows(page)).toHaveCount(20);
  await screenshot(page, "infrastructure-resources-synthetic");

  await page.getByTestId("infrastructure-view-map").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(20);
  await screenshot(page, "infrastructure-map-synthetic");
});

test("infrastructure details open from a row and lead back to the resource's place", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Infrastructure");
  await page
    .getByRole("searchbox", { name: "Search infrastructure" })
    .fill("checkout-1-02");
  await page
    .getByRole("button", {
      name: "View details for checkout-1-02",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "checkout-1-02", exact: true }),
  ).toBeVisible();
  await screenshot(page, "infrastructure-resource-details-synthetic");
  await page
    .getByRole("button", { name: "Show where it is", exact: true })
    .click();
  await expect(page.getByTestId("infrastructure-scope-title")).toHaveText(
    "eu-worker-01",
  );
});

test("the service map draws calls left to right and lists unconnected services beside it", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Service Map");
  await expect(page.getByTestId("service-map-canvas")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await expect(page.getByTestId("service-map-unconnected-item")).toHaveCount(2);
  await screenshot(page, "service-map-synthetic");

  await page.getByTestId("service-map-node-service-payments").click();
  await expect(
    page.getByRole("heading", { name: "payments", exact: true }),
  ).toBeVisible();
  await screenshot(page, "service-details-synthetic");
  await page
    .getByRole("button", { name: "Show its connections", exact: true })
    .click();
  await expect(page.getByTestId("service-map-clear-focus")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.getByTestId("service-map-reset-filters").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(6);

  await page.getByTestId("service-map-view-list").click();
  await expect(page.getByTestId("service-map-list-row")).toHaveCount(8);
  await page.getByRole("textbox", { name: "Search services" }).fill("payments");
  await expect(page.getByTestId("service-map-list-row")).toHaveCount(1);
  await screenshot(page, "service-table-synthetic");
});

test("a self-hosted estate before the fix: no calls explained, pods grouped, old pods hidden", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Service Map", "dataset=selfHostedLegacy");
  await expect(page.getByTestId("service-map-no-connections")).toBeVisible();
  await expect(page.getByTestId("service-map-unconnected-item")).toHaveCount(8);
  await screenshot(page, "legacy-service-map-synthetic");

  await page.getByRole("tab", { name: "Infrastructure", exact: true }).click();
  await expect(infrastructureRows(page)).toHaveCount(7);
  await expect(page.getByTestId("infrastructure-explorer")).toContainText(
    "Inactive not shown448",
  );
  await screenshot(page, "legacy-infrastructure-synthetic");

  await page
    .getByRole("button", { name: "Open oneuptime-app", exact: true })
    .click();
  await expect(infrastructureRows(page)).toHaveCount(12);
  await page.getByTestId("topology-show-inactive").check();
  await expect(infrastructureRows(page)).toHaveCount(50);
  await expect(page.getByText("Page 1 / 3")).toBeVisible();
  await screenshot(page, "legacy-infrastructure-inactive-synthetic");
});

test("a self-hosted estate after the fix: databases and APIs on the map, workloads by deployment", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Service Map", "dataset=selfHostedDiscovered");
  await expect(page.locator(".react-flow__node")).toHaveCount(13);
  await expect(page.getByTestId("service-map-summary")).toContainText(
    "Dependencies5",
  );
  await screenshot(page, "discovered-service-map-synthetic");

  await page.getByTestId("service-map-node-db-clickhouse").click();
  await expect(
    page.getByRole("heading", { name: "oneuptime-clickhouse", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("entity-detail-called-by")).toContainText(
    "api depends on oneuptime-clickhouse",
  );
  await screenshot(page, "discovered-database-details-synthetic");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();

  await page.getByTestId("service-map-node-service-api").click();
  await page
    .getByRole("button", {
      name: /View details for oneuptime-app-/,
    })
    .first()
    .click();
  await expect(
    page.getByRole("tab", { name: "Infrastructure", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("infrastructure-scope-title")).toHaveText(
    "oneuptime-app",
  );
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page
    .getByRole("button", { name: "All infrastructure" })
    .first()
    .click();
  await page.getByTestId("infrastructure-view-map").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(13);
  await screenshot(page, "discovered-infrastructure-map-synthetic");
});

test("network sites lead to a real device map with recoverable progressive controls", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Network");
  await expect(page.getByTestId("topology-hierarchy-grid")).toBeVisible();
  await expect(page.getByTestId("topology-hierarchy-guide")).toHaveCount(0);
  await expect(
    page.getByText(/^(Choose a site|Follow the network|Find the problem)$/),
  ).toHaveCount(0);
  await expect(page.getByTestId("topology-hierarchy-search")).toBeVisible();
  await screenshot(page, "network-sites-synthetic");
  await page.getByTestId("site-card-london").click();
  await expect(
    page.locator('[data-testid^="network-topology-node-"]'),
  ).toHaveCount(7);
  await expect(page.getByRole("button", { name: /Map options/ })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Topology layout" }),
  ).toHaveCount(0);
  await screenshot(page, "network-map-synthetic");
  await page.getByRole("button", { name: /Map options/ }).click();
  await expect(
    page.getByRole("group", { name: "Topology layout" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Discovered neighbors", exact: true })
    .click();
  await expect(
    page.locator('[data-testid^="network-topology-node-"]'),
  ).toHaveCount(6);
  await page.getByRole("button", { name: /Map options/ }).click();
  await expect(page.getByRole("button", { name: /Map options/ })).toContainText(
    "1",
  );
  await expect(
    page.getByRole("button", { name: "Clear filters", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear filters", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Map options/ }).click();
  await expect(
    page.getByRole("button", { name: "Discovered neighbors", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await screenshot(page, "network-map-options-synthetic");
  await expect(
    page.locator('[data-testid^="network-topology-node-"]'),
  ).toHaveCount(7);
  await page
    .getByTestId("network-topology-node-00000000-0000-4000-8000-000000000102")
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "London core switch", exact: true }),
  ).toBeVisible();
  await screenshot(page, "network-device-details-synthetic");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
});

test("all views fit a phone and topology tabs support keyboard navigation", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openView(page, "Infrastructure");
  await expect(page.getByTestId("infrastructure-explorer")).toBeVisible();
  for (const name of ["Infrastructure", "Service Map", "Network"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    if (name === "Service Map") {
      await page.getByTestId("service-map-view-list").click();
      await expect(page.getByTestId("service-map-list")).toBeVisible();
      await expect
        .poll(
          async (): Promise<number> => {
            return page
              .getByTestId("service-map-table-scroll")
              .evaluate((element: HTMLElement): number => {
                return (
                  element.getBoundingClientRect().right - window.innerWidth
                );
              });
          },
          { message: "The service table scroll region fits the phone" },
        )
        .toBeLessThanOrEqual(1);
      const scrolls: boolean = await page
        .getByTestId("service-map-table-scroll")
        .evaluate((element: HTMLElement): boolean => {
          return element.scrollWidth > element.clientWidth;
        });
      expect(scrolls, "Wide service columns scroll inside their region").toBe(
        true,
      );
    }
    await expect
      .poll(
        async (): Promise<number> => {
          return page.evaluate((): number => {
            return document.documentElement.scrollWidth - window.innerWidth;
          });
        },
        { message: `${name} must fit the viewport` },
      )
      .toBeLessThanOrEqual(1);
  }
  await page.getByRole("tab", { name: "Network", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "Service Map", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Infrastructure", exact: true }),
  ).toBeFocused();
  await screenshot(page, "infrastructure-mobile-synthetic");
});
