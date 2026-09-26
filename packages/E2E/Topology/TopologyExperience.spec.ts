import { expect, Page, Route as PlaywrightRoute, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

const pageErrors: Map<Page, Array<string>> = new Map();

const ROUTE: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/topology/overview";
const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/topology",
);

/* Topology API routes, as the page posts them (see TopologyApiFixture.js). */
const SERVICE_MAP_API: string = "/telemetry/topology/service-map";
const INFRASTRUCTURE_API: string = "/telemetry/topology/infrastructure";
const COLLECTION_API: string = "/telemetry/topology/infrastructure/collection";
const COLLECTION_SEARCH_API: string =
  "/telemetry/topology/infrastructure/collection-search";
const ENTITY_API: string = "/telemetry/topology/entity";
const ENTITY_CONNECTIONS_API: string = "/telemetry/topology/entity/connections";

interface FixtureRequest {
  operation: "list" | "post";
  model?: string;
  route?: string;
  data?: Record<string, unknown>;
}

interface FixtureRejection {
  path: string;
  status: number;
  message: string;
}

interface FixtureLog {
  requests: Array<FixtureRequest>;
  rejected: Array<FixtureRejection>;
  unhandled: Array<{ route: string }>;
}

interface FixtureFailure {
  path: string;
  status: number;
  times?: number;
}

interface FixtureWindow {
  __topologyFixtureRequests: Array<FixtureRequest>;
  __topologyFixtureRejected: Array<FixtureRejection>;
  __topologyFixtureUnhandled: Array<{ route: string }>;
  __topologyFixtureFailures: Array<FixtureFailure>;
}

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

async function fixtureLog(page: Page): Promise<FixtureLog> {
  return page.evaluate((): FixtureLog => {
    const fixture: FixtureWindow = window as unknown as FixtureWindow;
    return {
      requests: fixture.__topologyFixtureRequests || [],
      rejected: fixture.__topologyFixtureRejected || [],
      unhandled: fixture.__topologyFixtureUnhandled || [],
    };
  });
}

/* The bodies the page posted to one Topology API route, oldest first. */
async function topologyPosts(
  page: Page,
  apiPath: string,
): Promise<Array<Record<string, unknown>>> {
  const log: FixtureLog = await fixtureLog(page);
  return log.requests
    .filter((request: FixtureRequest): boolean => {
      return (
        request.operation === "post" &&
        new URL(request.route || "", "http://localhost").pathname.endsWith(
          apiPath,
        )
      );
    })
    .map((request: FixtureRequest): Record<string, unknown> => {
      return request.data || {};
    });
}

/* Makes the fixture's Topology API fail a route before the page loads. */
async function failTopologyRoute(
  page: Page,
  failure: FixtureFailure,
): Promise<void> {
  await page.addInitScript((planned: FixtureFailure): void => {
    const fixture: FixtureWindow = window as unknown as FixtureWindow;
    fixture.__topologyFixtureFailures = [planned];
  }, failure);
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

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "No uncaught browser errors").toEqual([]);
  pageErrors.delete(page);
  /*
   * The page speaks the fixture's Topology API: nothing it asked for was
   * refused by the server's request parser or fell through to an unknown
   * route, the payloads decoded (no "Topology was updated" dead end), and
   * the maps never listed inventory rows the old way.
   */
  await expect(page.getByText(/Topology was updated/)).toHaveCount(0);
  const log: FixtureLog = await fixtureLog(page);
  expect(
    log.rejected,
    "Topology requests refused by the server's parser or failed in the fixture",
  ).toEqual([]);
  expect(log.unhandled, "Topology routes the fixture does not know").toEqual(
    [],
  );
  expect(
    log.requests.filter((request: FixtureRequest): boolean => {
      return (
        request.operation === "list" &&
        (request.model === "InventoryItem" ||
          request.model === "InventoryItemRelationship")
      );
    }),
    "Inventory rows listed by the browser",
  ).toEqual([]);
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
  // One view-shaped request for the open tab; the Service Map is not loaded.
  expect(await topologyPosts(page, INFRASTRUCTURE_API)).toHaveLength(1);
  expect(await topologyPosts(page, SERVICE_MAP_API)).toHaveLength(0);
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

test("service map connection labels stay legible in the dark theme", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openView(page, "Service Map", "theme=dark");
  await page
    .getByRole("combobox", { name: "Connection labels" })
    .selectOption("latency");

  const labels: ReturnType<Page["locator"]> = page.locator(
    ".react-flow__edge-text",
  );
  await expect(labels).toHaveCount(5);
  await expect(labels.first()).toBeVisible();
  await expect(labels.first()).toHaveCSS("fill", "rgb(226, 232, 240)");

  const backgrounds: ReturnType<Page["locator"]> = page.locator(
    ".react-flow__edge-textbg",
  );
  await expect(backgrounds).toHaveCount(5);
  await expect(backgrounds.first()).toHaveCSS("fill", "rgb(23, 32, 51)");
  await expect(backgrounds.first()).toHaveCSS("fill-opacity", "1");
  await expect(backgrounds.first()).toHaveCSS("stroke", "rgb(71, 85, 105)");
  await expect(backgrounds.first()).toHaveCSS("stroke-width", "1px");
  await screenshot(page, "service-map-connection-labels-dark-synthetic");
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
  /*
   * Six deployments and three nodes. The probes, the runner and home call
   * the api on app and worker, so the map draws those calls between the
   * deployments rather than a column of services.
   */
  await expect(
    page.locator(".react-flow__node:not(.infrastructure-route-slot)"),
  ).toHaveCount(9);
  await expect(page.getByTestId("infrastructure-traffic-status")).toContainText(
    "8 connections",
  );
  await expect(
    page.locator('.react-flow__edge[aria-label*=" → "]'),
  ).toHaveCount(8);
  // Eight lines converge on two cards: labels wait for the pointer.
  await expect(page.getByLabel("Line labels")).toHaveValue("hover");
  await screenshot(page, "discovered-infrastructure-map-synthetic");
});

/*
 * Issue #3972: a node's pods were drawn as standalone cards with no lines
 * between them, though the services on them call each other.
 */
test("infrastructure draws the traffic between the pods on a node, with its metrics", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(
    page,
    "Infrastructure",
    "dataset=aksNodeTraffic&infraView=map",
  );
  // Across the cluster, the nodes are the cards and the calls cross them.
  const cards: ReturnType<Page["locator"]> = page.locator(
    ".react-flow__node:not(.infrastructure-route-slot)",
  );
  // With traffic drawn, each card names what it runs: no service column.
  await expect(cards).toHaveCount(3);
  await expect(page.getByTestId("infrastructure-traffic-status")).toContainText(
    "5 connections",
  );
  /*
   * The nodes call each other both ways. Every line is drawn, and no label
   * hides another: a call against the flow takes a lane above the cards.
   */
  const clusterLines: ReturnType<Page["locator"]> = page.locator(
    '.react-flow__edge[aria-label*=" → "]',
  );
  await expect(clusterLines).toHaveCount(5);
  const labels: Array<{ x: number; y: number; width: number; height: number }> =
    [];
  for (const label of await page
    .locator(".react-flow__edge .react-flow__edge-textwrapper")
    .all()) {
    const box: { x: number; y: number; width: number; height: number } | null =
      await label.boundingBox();
    expect(box).not.toBeNull();
    labels.push(box!);
  }
  expect(labels).toHaveLength(5);
  labels.forEach(
    (a: { x: number; y: number; width: number; height: number }, i: number) => {
      labels
        .slice(i + 1)
        .forEach(
          (b: { x: number; y: number; width: number; height: number }) => {
            const overlaps: boolean =
              a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height;
            expect(overlaps, "two traffic labels overlap").toBe(false);
          },
        );
    },
  );
  await screenshot(page, "aks-infrastructure-map-traffic-synthetic");

  // Drill into the node from the tree, as in the issue.
  await page
    .getByRole("button", {
      name: "aks-agentpool-14451756-vmss00001k 4",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("infrastructure-scope-title")).toHaveText(
    "aks-agentpool-14451756-vmss00001k",
  );
  // The node's four pods, as in the issue's screenshot.
  await expect(cards).toHaveCount(4);
  await expect(page.getByTestId("infrastructure-traffic-status")).toHaveText(
    "4 connections · Lines are calls between the services on these cards, measured per service.",
  );
  const lines: ReturnType<Page["locator"]> = page.locator(
    '.react-flow__edge[aria-label*=" → "]',
  );
  await expect(lines).toHaveCount(4);
  const backendToBlob: ReturnType<Page["locator"]> = page.locator(
    '.react-flow__edge[aria-label^="wb-ims-backend → wb-ims-blob:"]',
  );
  await expect(backendToBlob).toHaveCount(1);
  await expect(backendToBlob).toContainText("480/min");
  /*
   * The backend calls the blob store past the integration, a layer between
   * them: the line is routed around that card, not drawn behind it.
   */
  await expect(
    backendToBlob.locator("path.react-flow__edge-path"),
  ).toHaveAttribute("d", / C /);
  const integration: { y: number; height: number } | null = await page
    .locator(".react-flow__node", { hasText: "wb-ims-integration-edh-" })
    .boundingBox();
  const blobLabel: { y: number; height: number } | null = await backendToBlob
    .locator(".react-flow__edge-textwrapper")
    .boundingBox();
  expect(integration).not.toBeNull();
  expect(blobLabel).not.toBeNull();
  const overlaps: boolean =
    blobLabel!.y < integration!.y + integration!.height &&
    integration!.y < blobLabel!.y + blobLabel!.height;
  expect(overlaps, "the routed line's label sits clear of the card").toBe(
    false,
  );
  await screenshot(page, "aks-node-map-traffic-synthetic");

  await page.getByLabel("Line labels").selectOption("errors");
  await expect(
    page.locator(
      '.react-flow__edge[aria-label^="wb-ims-backend → wb-ims-integration-edh:"]',
    ),
  ).toContainText("10.0% errors");
  await screenshot(page, "aks-node-map-errors-synthetic");
});

test("a relationship to something no longer in inventory is listed in the drawer, never opened", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Infrastructure");
  await page
    .getByRole("searchbox", { name: "Search infrastructure" })
    .fill("cache-primary");
  // The IoT collection was searched too, on the server, and matched nothing.
  await expect
    .poll(async (): Promise<number> => {
      return (await topologyPosts(page, COLLECTION_SEARCH_API)).length;
    })
    .toBeGreaterThan(0);
  await expect(page.getByText("Searching large collections…")).toHaveCount(0);
  await expect(page.getByTestId("infrastructure-collection-match")).toHaveCount(
    0,
  );
  await page
    .getByRole("button", {
      name: "View details for cache-primary",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "cache-primary", exact: true }),
  ).toBeVisible();
  const related: ReturnType<Page["getByTestId"]> = page.getByTestId(
    "entity-detail-related",
  );
  await expect(related).toContainText("Related infrastructure (2)");
  await expect(related).toContainText("1 no longer in inventory");
  await expect(related).toContainText("Undiscovered resource");
  await expect(
    related.getByRole("button", { name: /Undiscovered resource/ }),
  ).toHaveCount(0);
  expect(await topologyPosts(page, ENTITY_API)).toEqual([
    expect.objectContaining({ entityKey: "host-2", entityType: "host" }),
  ]);
  await screenshot(page, "infrastructure-undiscovered-connection-synthetic");
});

test("a large IoT fleet is a collection: exact counts, server-paged items and search over every item", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Infrastructure");
  const fleet: ReturnType<Page["getByTestId"]> = page
    .getByRole("region", { name: "Network & devices" })
    .getByTestId("infrastructure-row");
  await expect(fleet).toHaveCount(1);
  await expect(fleet).toContainText("1,250 IoT devices");

  await page
    .getByRole("button", { name: "Open IoT Devices", exact: true })
    .click();
  await expect(page.getByTestId("infrastructure-scope-title")).toHaveText(
    "IoT Devices",
  );
  const items: ReturnType<Page["getByTestId"]> = page.getByTestId(
    "infrastructure-collection-row",
  );
  await expect(items).toHaveCount(50);
  await expect(items.first()).toContainText("warehouse-sensor-0001");
  await expect(
    page.getByText("Page 1 of 25 · 1,250 IoT devices", { exact: true }),
  ).toBeVisible();
  await screenshot(page, "infrastructure-collection-synthetic");

  // Keyset paging: page 2 starts after the last row of page 1.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByText("Page 2 of 25 · 1,250 IoT devices", { exact: true }),
  ).toBeVisible();
  await expect(items.first()).toContainText("warehouse-sensor-0051");
  const pages: Array<Record<string, unknown>> = await topologyPosts(
    page,
    COLLECTION_API,
  );
  expect(pages[pages.length - 1]).toMatchObject({
    entityType: "iot.device",
    includeInactive: false,
    limit: 50,
    cursor: { name: "warehouse-sensor-0050", key: "iot-device-50" },
  });
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(
    page.getByText("Page 1 of 25 · 1,250 IoT devices", { exact: true }),
  ).toBeVisible();
  await expect(items.first()).toContainText("warehouse-sensor-0001");

  // Search reaches items the browser never downloaded.
  await page
    .getByRole("searchbox", { name: "Search infrastructure" })
    .fill("sensor-1234");
  const match: ReturnType<Page["getByTestId"]> = page.getByTestId(
    "infrastructure-collection-match",
  );
  await expect(match).toHaveCount(1);
  await expect(match).toContainText("1 matching IoT device");
  expect(await topologyPosts(page, COLLECTION_SEARCH_API)).toContainEqual(
    expect.objectContaining({
      types: [{ entityType: "iot.device", nameTerms: ["sensor-1234"] }],
    }),
  );
  await match.click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("warehouse-sensor-1234");
  await page
    .getByRole("button", {
      name: "View details for warehouse-sensor-1234",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "warehouse-sensor-1234", exact: true }),
  ).toBeVisible();
  const details: Array<Record<string, unknown>> = await topologyPosts(
    page,
    ENTITY_API,
  );
  expect(details[details.length - 1]).toMatchObject({
    entityKey: "iot-device-1234",
  });
  await screenshot(page, "infrastructure-collection-item-details-synthetic");
});

test("the drawer counts every connection and pages the rest from the server", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Infrastructure", "dataset=selfHostedDiscovered");
  await page
    .getByRole("button", { name: "Open oneuptime-prod", exact: true })
    .click();
  await expect(page.getByTestId("infrastructure-scope-title")).toHaveText(
    "oneuptime-prod",
  );
  await page.getByRole("button", { name: "View details", exact: true }).click();
  await expect(page.getByTestId("side-over-title")).toHaveText(
    "oneuptime-prod",
  );

  // A namespace, 3 nodes, 6 deployments and 45 pods are members of it.
  const related: ReturnType<Page["getByTestId"]> = page.getByTestId(
    "entity-detail-related",
  );
  const rows: ReturnType<Page["locator"]> = related.getByRole("listitem");
  const showMore: ReturnType<Page["locator"]> = related.getByRole("button", {
    name: /^Show more/,
  });
  await expect(related).toContainText("Related infrastructure (55)");
  await expect(rows).toHaveCount(25);
  await screenshot(page, "infrastructure-cluster-details-synthetic");
  await showMore.click();
  await expect(rows).toHaveCount(50);
  await showMore.click();
  await expect(rows).toHaveCount(55);
  await expect(showMore).toHaveCount(0);
  expect(await topologyPosts(page, ENTITY_CONNECTIONS_API)).toEqual([
    expect.objectContaining({
      entityKey: "cluster-prod",
      section: "related",
      offset: 25,
      limit: 25,
    }),
    expect.objectContaining({
      entityKey: "cluster-prod",
      section: "related",
      offset: 50,
      limit: 25,
    }),
  ]);
});

test("refresh asks the server for current data, including a tab opened after it", async ({
  page,
}: {
  page: Page;
}) => {
  await openView(page, "Service Map");
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  expect(await topologyPosts(page, SERVICE_MAP_API)).toEqual([
    expect.not.objectContaining({ fresh: expect.anything() }),
  ]);

  await page.getByRole("button", { name: "Refresh topology" }).click();
  await expect
    .poll(async (): Promise<number> => {
      return (await topologyPosts(page, SERVICE_MAP_API)).length;
    })
    .toBe(2);
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  expect((await topologyPosts(page, SERVICE_MAP_API))[1]).toMatchObject({
    fresh: true,
  });

  await page.getByRole("tab", { name: "Infrastructure", exact: true }).click();
  await expect(page.getByTestId("infrastructure-explorer")).toBeVisible();
  expect(await topologyPosts(page, INFRASTRUCTURE_API)).toEqual([
    expect.objectContaining({ fresh: true }),
  ]);
});

test("a busy Topology API offers a retry that recovers, not a reload", async ({
  page,
}: {
  page: Page;
}) => {
  await failTopologyRoute(page, {
    path: SERVICE_MAP_API,
    status: 429,
    times: 1,
  });
  await openView(page, "Service Map");
  const alert: ReturnType<Page["getByRole"]> = page.getByRole("alert");
  await expect(alert).toContainText(
    "The topology service is busy. Try again in a moment.",
  );
  await expect(
    alert.getByRole("button", { name: "Reload page", exact: true }),
  ).toHaveCount(0);
  await screenshot(page, "service-map-busy-synthetic");

  await alert.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("service-map-canvas")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  expect(await topologyPosts(page, SERVICE_MAP_API)).toHaveLength(2);
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
