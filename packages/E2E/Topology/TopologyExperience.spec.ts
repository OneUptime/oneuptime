import {
  expect,
  JSHandle,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
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

/*
 * Issue #4117: on a large project the Service Map disappeared at random and
 * only a page reload brought it back. The `largeServiceMap` dataset has the
 * reported shape: 171 services, 77 connections, 73 cards drawn in a column
 * far taller than it is wide, fitted into a wide canvas at a small zoom, so
 * almost everywhere a pointer rests is empty canvas.
 *
 * These tests use the map the way the reporter did (the wheel, lines under
 * the pointer, a card opened, labels changed, double-clicks, drags, Ctrl +
 * wheel, a narrower window, the fit buttons) and check what is on screen
 * afterwards: the cards React Flow draws (a card it has to measure again is
 * visibility: hidden and loses its lines) whose boxes lie on the canvas.
 */
const LARGE_SERVICE_MAP_QUERY: string =
  "dataset=largeServiceMap&serviceView=map";
const LARGE_SERVICE_MAP_CARDS: number = 73;
const LARGE_SERVICE_MAP_LINES: number = 77;

interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

/* What the Service Map canvas shows, in viewport pixels. */
interface ServiceMapCanvasState {
  /* Cards React Flow rendered, drawn or waiting to be measured. */
  cards: number;
  /* Drawn cards (not visibility: hidden) whose box overlaps the canvas. */
  cardsInView: number;
  /* Drawn cards whose whole box lies on the canvas. */
  cardsWithin: number;
  /* Lines drawn. React Flow draws none to a card it has not measured. */
  lines: number;
  /* The React Flow viewport's CSS transform. */
  transform: string;
  canvas: ScreenBox;
  /* The bounding box of the drawn cards; null when none is drawn. */
  drawing: ScreenBox | null;
}

interface FlowView {
  x: number;
  y: number;
  zoom: number;
}

interface HiddenCardProbe {
  hides: number;
}

async function serviceMapCanvas(page: Page): Promise<ServiceMapCanvasState> {
  return page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): ServiceMapCanvasState => {
      const bounds: DOMRect = canvas.getBoundingClientRect();
      const cards: Array<HTMLElement> = Array.from(
        canvas.querySelectorAll<HTMLElement>(".react-flow__node"),
      );
      let cardsInView: number = 0;
      let cardsWithin: number = 0;
      // A card fitted flush with an edge can land a fraction of a pixel past it.
      const slack: number = 0.5;
      let left: number = Number.POSITIVE_INFINITY;
      let top: number = Number.POSITIVE_INFINITY;
      let right: number = Number.NEGATIVE_INFINITY;
      let bottom: number = Number.NEGATIVE_INFINITY;
      for (const card of cards) {
        if (window.getComputedStyle(card).visibility === "hidden") {
          continue;
        }
        const box: DOMRect = card.getBoundingClientRect();
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
        right = Math.max(right, box.right);
        bottom = Math.max(bottom, box.bottom);
        if (
          box.right > bounds.left &&
          box.left < bounds.right &&
          box.bottom > bounds.top &&
          box.top < bounds.bottom
        ) {
          cardsInView++;
        }
        if (
          box.left >= bounds.left - slack &&
          box.right <= bounds.right + slack &&
          box.top >= bounds.top - slack &&
          box.bottom <= bounds.bottom + slack
        ) {
          cardsWithin++;
        }
      }
      const viewport: HTMLElement | null = canvas.querySelector<HTMLElement>(
        ".react-flow__viewport",
      );
      return {
        cards: cards.length,
        cardsInView,
        cardsWithin,
        lines: canvas.querySelectorAll(".react-flow__edge").length,
        transform: viewport ? viewport.style.transform : "",
        canvas: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
        drawing:
          right > left
            ? { x: left, y: top, width: right - left, height: bottom - top }
            : null,
      };
    });
}

/*
 * Waits until the view has stopped moving (the same transform on two reads
 * in a row) and returns what the canvas shows then.
 */
async function settledServiceMap(page: Page): Promise<ServiceMapCanvasState> {
  let previous: string | null = null;
  await expect
    .poll(
      async (): Promise<boolean> => {
        const transform: string = (await serviceMapCanvas(page)).transform;
        const settled: boolean = transform === previous;
        previous = transform;
        return settled;
      },
      { message: "the Service Map view settles", intervals: [200] },
    )
    .toBe(true);
  return serviceMapCanvas(page);
}

/* Opens the large map and waits until every card and line is on the canvas. */
async function openLargeServiceMap(page: Page): Promise<ServiceMapCanvasState> {
  await openView(page, "Service Map", LARGE_SERVICE_MAP_QUERY);
  await expect(page.getByTestId("service-map-canvas")).toBeVisible();
  await expect
    .poll(
      async (): Promise<Array<number>> => {
        const state: ServiceMapCanvasState = await serviceMapCanvas(page);
        return [state.cards, state.cardsInView, state.lines];
      },
      { message: "every card and line of the large map is on the canvas" },
    )
    .toEqual([
      LARGE_SERVICE_MAP_CARDS,
      LARGE_SERVICE_MAP_CARDS,
      LARGE_SERVICE_MAP_LINES,
    ]);
  return settledServiceMap(page);
}

/* Scrolls the page so the whole canvas is on screen. */
async function centreServiceMapCanvas(
  page: Page,
): Promise<ServiceMapCanvasState> {
  await page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): void => {
      canvas.scrollIntoView({ block: "center", behavior: "instant" });
    });
  return serviceMapCanvas(page);
}

/*
 * A point of empty canvas beside the drawing: halfway between the canvas's
 * left edge and the leftmost card, clear of the zoom controls.
 */
function emptyCanvasPoint(state: ServiceMapCanvasState): ScreenPoint {
  expect(state.drawing, "the drawing is on the canvas").not.toBeNull();
  const gap: number = state.drawing!.x - state.canvas.x;
  expect(gap, "empty canvas beside the drawing").toBeGreaterThan(200);
  return {
    x: state.canvas.x + gap / 2,
    y: state.canvas.y + state.canvas.height * 0.4,
  };
}

function flowView(transform: string): FlowView {
  const match: RegExpMatchArray | null = transform.match(
    /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/,
  );
  expect(match, `a React Flow viewport transform: "${transform}"`).not.toBe(
    null,
  );
  return {
    x: Number(match![1]),
    y: Number(match![2]),
    zoom: Number(match![3]),
  };
}

/* Two transforms show the same view, give or take rounding. */
function sameView(actual: string, expected: string): boolean {
  const a: FlowView = flowView(actual);
  const b: FlowView = flowView(expected);
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.zoom - b.zoom) < 0.0005
  );
}

/* How far the drawing's centre is from the canvas's, across. */
function drawingOffCentre(state: ServiceMapCanvasState): number {
  expect(state.drawing, "the drawing is on the canvas").not.toBeNull();
  return Math.abs(
    state.drawing!.x +
      state.drawing!.width / 2 -
      (state.canvas.x + state.canvas.width / 2),
  );
}

async function expectEveryCardInView(page: Page, when: string): Promise<void> {
  const state: ServiceMapCanvasState = await settledServiceMap(page);
  expect(state.cardsInView, `every card is on the canvas ${when}`).toBe(
    LARGE_SERVICE_MAP_CARDS,
  );
}

/*
 * From now on, counts every time a card of the map is hidden: its style
 * turns to visibility: hidden (React Flow hides a card it must measure
 * again, and drops its lines) or a card is mounted hidden (the whole map
 * drawn again from scratch).
 */
async function watchForHiddenCards(page: Page): Promise<void> {
  await page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): void => {
      const probe: HiddenCardProbe = { hides: 0 };
      (
        window as unknown as { __serviceMapHiddenCards: HiddenCardProbe }
      ).__serviceMapHiddenCards = probe;
      const hiddenCards: (node: Node) => number = (node: Node): number => {
        if (!(node instanceof HTMLElement)) {
          return 0;
        }
        const cards: Array<HTMLElement> = node.classList.contains(
          "react-flow__node",
        )
          ? [node]
          : Array.from(node.querySelectorAll<HTMLElement>(".react-flow__node"));
        return cards.filter((card: HTMLElement): boolean => {
          return card.style.visibility === "hidden";
        }).length;
      };
      new MutationObserver((records: Array<MutationRecord>): void => {
        for (const record of records) {
          if (
            record.type === "attributes" &&
            record.target instanceof HTMLElement &&
            record.target.classList.contains("react-flow__node")
          ) {
            probe.hides += hiddenCards(record.target);
          }
          record.addedNodes.forEach((added: Node): void => {
            probe.hides += hiddenCards(added);
          });
        }
      }).observe(canvas, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["style"],
      });
    });
}

async function hiddenCardCount(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (window as unknown as { __serviceMapHiddenCards: HiddenCardProbe })
      .__serviceMapHiddenCards.hides;
  });
}

/* The middle of every line on the map, in viewport pixels. */
async function lineMidpoints(page: Page): Promise<Array<ScreenPoint>> {
  return page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): Array<ScreenPoint> => {
      return Array.from(
        canvas.querySelectorAll<SVGPathElement>(
          ".react-flow__edge path.react-flow__edge-path",
        ),
      ).map((path: SVGPathElement): ScreenPoint => {
        const middle: DOMPoint = path.getPointAtLength(
          path.getTotalLength() / 2,
        );
        const toScreen: DOMMatrix | null = path.getScreenCTM();
        const point: DOMPoint = toScreen
          ? middle.matrixTransform(toScreen)
          : middle;
        return { x: point.x, y: point.y };
      });
    });
}

test("the wheel over a large service map scrolls the page and leaves the map where it is", async ({
  page,
}: {
  page: Page;
}) => {
  const fitted: ServiceMapCanvasState = await openLargeServiceMap(page);
  const summary: ReturnType<Page["getByTestId"]> = page.getByTestId(
    "service-map-summary",
  );
  await expect(summary).toContainText("Services171");
  await expect(summary).toContainText("102 inactive not shown");
  await expect(summary).toContainText("Dependencies19");
  await expect(summary).toContainText("Connections77");
  await expect(page.getByTestId("service-map-unconnected-item")).toHaveCount(
    117,
  );
  // A column of cards in a wide canvas: most of the canvas is empty.
  expect(fitted.drawing!.width).toBeLessThan(fitted.canvas.width / 4);
  await screenshot(page, "service-map-large-synthetic");

  const before: ServiceMapCanvasState = await centreServiceMapCanvas(page);
  const scrollY: number = await page.evaluate((): number => {
    return window.scrollY;
  });
  const empty: ScreenPoint = emptyCanvasPoint(before);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(
      async (): Promise<number> => {
        return page.evaluate((): number => {
          return window.scrollY;
        });
      },
      { message: "the wheel over the map scrolls the page" },
    )
    .toBeGreaterThan(scrollY);
  const after: ServiceMapCanvasState = await settledServiceMap(page);
  expect(after.transform, "the wheel neither zooms nor pans the map").toBe(
    fitted.transform,
  );
  expect(after.cardsInView).toBe(LARGE_SERVICE_MAP_CARDS);
  // Zooming is still there, and the map says how.
  await expect(page.getByTestId("service-map-zoom-hint")).toHaveText(
    "Ctrl + scroll or pinch to zoom",
  );
});

test("hovering lines, opening a card and changing line labels never hide a drawn card", async ({
  page,
}: {
  page: Page;
}) => {
  await openLargeServiceMap(page);
  const state: ServiceMapCanvasState = await centreServiceMapCanvas(page);
  const canvas: ReturnType<Page["getByTestId"]> =
    page.getByTestId("service-map-canvas");
  const labels: ReturnType<Page["locator"]> = canvas.locator(
    ".react-flow__edge-text",
  );
  await watchForHiddenCards(page);

  // The pointer crosses every line; each shows its request rate on hover.
  const lines: Array<ScreenPoint> = await lineMidpoints(page);
  expect(lines).toHaveLength(LARGE_SERVICE_MAP_LINES);
  await page.mouse.move(lines[0]!.x, lines[0]!.y, { steps: 4 });
  await expect(labels).toHaveCount(1);
  for (const line of lines) {
    await page.mouse.move(line.x, line.y, { steps: 3 });
  }
  const empty: ScreenPoint = emptyCanvasPoint(state);
  await page.mouse.move(empty.x, empty.y, { steps: 3 });
  await expect(labels).toHaveCount(0);
  /*
   * Checked before the card is opened: the unfixed map hid every card each
   * time the pointer entered or left a line, and a sweep like this one could
   * leave them all hidden for good, with no card left to click.
   */
  const crossed: ServiceMapCanvasState = await settledServiceMap(page);
  expect(
    [await hiddenCardCount(page), crossed.cardsInView, crossed.lines],
    "cards hidden, cards on the canvas and lines drawn after the pointer crossed every line",
  ).toEqual([0, LARGE_SERVICE_MAP_CARDS, LARGE_SERVICE_MAP_LINES]);

  await page.getByTestId("service-map-node-service-platform-core").click();
  await expect(
    page.getByRole("heading", { name: "platform-core", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "platform-core", exact: true }),
  ).toHaveCount(0);
  await page.mouse.move(empty.x, empty.y);

  const connectionLabels: ReturnType<Page["getByRole"]> = page.getByRole(
    "combobox",
    { name: "Connection labels" },
  );
  await connectionLabels.selectOption("calls");
  await expect(labels).toHaveCount(LARGE_SERVICE_MAP_LINES);
  await connectionLabels.selectOption("errors");
  await expect(labels.first()).toContainText("errors");
  await connectionLabels.selectOption("latency");
  await expect(labels.first()).toContainText("ms");
  await connectionLabels.selectOption("none");
  await expect(labels).toHaveCount(0);

  const after: ServiceMapCanvasState = await settledServiceMap(page);
  expect(
    await hiddenCardCount(page),
    "cards hidden again after the map was drawn",
  ).toBe(0);
  expect(after.cardsInView).toBe(LARGE_SERVICE_MAP_CARDS);
  expect(after.lines).toBe(LARGE_SERVICE_MAP_LINES);
});

test("a large service map cannot be pushed off its canvas", async ({
  page,
}: {
  page: Page;
}) => {
  const fitted: ServiceMapCanvasState = await openLargeServiceMap(page);
  const state: ServiceMapCanvasState = await centreServiceMapCanvas(page);
  const empty: ScreenPoint = emptyCanvasPoint(state);

  for (let click: number = 1; click <= 4; click++) {
    await page.mouse.dblclick(empty.x, empty.y);
    expect(
      (await settledServiceMap(page)).transform,
      `double-click ${click} on the empty canvas leaves the view as it was`,
    ).toBe(fitted.transform);
  }

  const drags: Array<[number, number]> = [
    [-1200, 0],
    [1200, 0],
    [0, -1200],
    [0, 1200],
  ];
  for (const [dx, dy] of drags) {
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + dx, empty.y + dy, { steps: 12 });
    await page.mouse.up();
    await expectEveryCardInView(
      page,
      `after dragging the empty canvas by (${dx}, ${dy})`,
    );
  }

  // A card held 400 px past the canvas's top edge for a second and a half.
  const card: { x: number; y: number; width: number; height: number } | null =
    await page
      .getByTestId("service-map-node-service-platform-core")
      .boundingBox();
  expect(card).not.toBeNull();
  const cardCentre: ScreenPoint = {
    x: card!.x + card!.width / 2,
    y: card!.y + card!.height / 2,
  };
  await page.mouse.move(cardCentre.x, cardCentre.y);
  await page.mouse.down();
  await page.mouse.move(cardCentre.x, state.canvas.y - 400, { steps: 12 });
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await expectEveryCardInView(page, "after holding a card past its edge");

  // Ctrl + wheel zooms about the pointer, here at the far edge of the canvas.
  await page.mouse.move(
    state.canvas.x + state.canvas.width - 8,
    state.canvas.y + state.canvas.height / 2,
  );
  await page.keyboard.down("Control");
  for (let notch: number = 1; notch <= 25; notch++) {
    await page.mouse.wheel(0, -100);
    expect(
      (await serviceMapCanvas(page)).cardsInView,
      `cards on the canvas after ${notch} Ctrl + wheel notches`,
    ).toBeGreaterThan(0);
  }
  await page.keyboard.up("Control");
  const zoomed: ServiceMapCanvasState = await settledServiceMap(page);
  expect(flowView(zoomed.transform).zoom).toBeGreaterThan(
    flowView(fitted.transform).zoom,
  );
  expect(zoomed.cardsInView).toBeGreaterThan(0);
  await expect(page.getByTestId("service-map-out-of-view")).toHaveCount(0);
});

test("a narrower window keeps the large service map framed", async ({
  page,
}: {
  page: Page;
}) => {
  const wide: ServiceMapCanvasState = await openLargeServiceMap(page);
  expect(drawingOffCentre(wide)).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 700, height: 1050 });
  await expect
    .poll(
      async (): Promise<number> => {
        return (await serviceMapCanvas(page)).canvas.width;
      },
      { message: "the canvas follows the window" },
    )
    .toBeLessThan(wide.canvas.width - 200);
  await expect
    .poll(
      async (): Promise<{ cardsInView: number; centred: boolean }> => {
        const state: ServiceMapCanvasState = await serviceMapCanvas(page);
        return {
          cardsInView: state.cardsInView,
          centred: drawingOffCentre(state) <= 2,
        };
      },
      { message: "the map is framed again in the narrower canvas" },
    )
    .toEqual({ cardsInView: LARGE_SERVICE_MAP_CARDS, centred: true });
});

test("Fit to screen after zooming in with the map's controls returns to the fitted view", async ({
  page,
}: {
  page: Page;
}) => {
  const fitted: ServiceMapCanvasState = await openLargeServiceMap(page);
  await centreServiceMapCanvas(page);
  const canvas: ReturnType<Page["getByTestId"]> =
    page.getByTestId("service-map-canvas");
  const zoomIn: ReturnType<Page["getByRole"]> = canvas.getByRole("button", {
    name: "zoom in",
    exact: true,
  });
  const fittedZoom: number = flowView(fitted.transform).zoom;
  const zoomInThrice: () => Promise<void> = async (): Promise<void> => {
    for (let click: number = 0; click < 3; click++) {
      await zoomIn.click();
    }
    await expect
      .poll(
        async (): Promise<number> => {
          return flowView((await serviceMapCanvas(page)).transform).zoom;
        },
        { message: "the zoom-in control zooms in" },
      )
      .toBeGreaterThan(fittedZoom * 1.5);
  };
  const expectFittedView: (which: string) => Promise<void> = async (
    which: string,
  ): Promise<void> => {
    await expect
      .poll(
        async (): Promise<boolean> => {
          return sameView(
            (await serviceMapCanvas(page)).transform,
            fitted.transform,
          );
        },
        { message: `${which} frames the map as it was first fitted` },
      )
      .toBe(true);
  };

  await zoomInThrice();
  await canvas.getByRole("button", { name: "fit view", exact: true }).click();
  await expectFittedView("the controls' fit view");

  await zoomInThrice();
  await page.getByTestId("service-map-fit").click();
  await expectFittedView("Fit to screen");
  expect((await settledServiceMap(page)).cardsInView).toBe(
    LARGE_SERVICE_MAP_CARDS,
  );
});

/*
 * More ways the map lost its drawing: a press that moved nothing, or the
 * pixel a click slips, ended the automatic framing (the next narrower window
 * left the drawing off-centre or clipped); keyboard focus scrolled React
 * Flow's box off the canvas, or could not bring a card above or left of the
 * view onto it at all; and Ctrl + scroll into a corner of the drawing's box
 * that holds no card left the canvas empty, with the notice that says so
 * off screen when the page showed only part of the canvas. The layout
 * centres each column on the first (38 cards tall), so that box is empty
 * above and below the shorter columns on its right, and the pan extent keeps
 * the view inside the box, not on a card.
 */
const NARROW_WINDOW: WindowSize = { width: 700, height: 1050 };
const CTRL_WHEEL_NOTCHES: number = 25;
const TAB_PRESSES: number = 60;
/*
 * A drag small enough to stay clear of the edge of the pan extent from a
 * view inside it, and far larger than rounding: a view left outside the
 * extent jumps back inside it on the first drag instead.
 */
const SMALL_DRAG: ScreenPoint = { x: 3, y: 2 };
/* The focused element lies on the canvas, or has left the map. */
const FOCUS_IN_VIEW: RegExp = /^(on the canvas|not a card or connection)$/;
/* How far inside the canvas edge a click on a cut-off card lands. */
const EDGE_CLICK_INSET_PX: number = 5;
/* How much of a card has to lie past the canvas edge to count as cut off. */
const MIN_CUT_OFF_PX: number = 10;

interface WindowSize {
  width: number;
  height: number;
}

/* What decides whether the map is framed in its canvas. */
interface FramedMap {
  /* The canvas has followed the window. */
  resized: boolean;
  cardsInView: number;
  /* The drawing's centre is within 2 px of the canvas's, across and down. */
  centred: boolean;
}

/* A press on the map, and where it lands on the canvas as it is now. */
interface MapPress {
  name: string;
  at: (state: ServiceMapCanvasState) => Promise<ScreenPoint>;
}

/* Where Ctrl + scroll zooms the map in, on the canvas as it is now. */
interface ZoomPoint {
  where: string;
  at: (state: ServiceMapCanvasState) => ScreenPoint;
}

/* How far React Flow's own box (overflow: hidden) is scrolled. */
interface FlowScroll {
  scrollLeft: number;
  scrollTop: number;
}

/* The map after a Tab or Shift + Tab press. */
interface FocusedMap {
  scroll: FlowScroll;
  /* See focusPlace. */
  focus: string;
  someCardInView: boolean;
}

/* Where keyboard focus is, as the map's canvas sees it. */
interface FocusOnMap {
  /* A card or connection of the map has focus, not a control or the page. */
  inMap: boolean;
  /* What has focus: its aria-label, React Flow's id for it, or its tag. */
  name: string;
  /* React Flow's id for a focused card (its data-id); "" for anything else. */
  cardId: string;
  /*
   * On each axis the focused element lies on the canvas, or overlaps it on
   * an axis where it is longer than the canvas (a connection can span the
   * whole drawing).
   */
  onCanvas: boolean;
  box: ScreenBox;
  canvas: ScreenBox;
}

/* Where the out-of-view notice is, against the canvas and the window. */
interface NoticePlace {
  inCanvas: boolean;
  inWindow: boolean;
  /* Within 40 px of the canvas's left edge. */
  atCanvasLeft: boolean;
  /*
   * Its middle is within 30 px of the middle of the part of the canvas on
   * screen.
   */
  centredOnScreen: boolean;
  /* The numbers behind the verdicts, for messages. */
  where: string;
  box: ScreenBox;
}

/* The cards of the drawing's left-hand column, top to bottom. */
interface MapColumn {
  ids: Array<string>;
  boxes: Array<ScreenBox>;
}

/* A card the canvas edge cuts off, and where to click it near that edge. */
interface CutOffCard {
  /* React Flow's id for the card (its data-id). */
  id: string;
  /* The name on the card, which titles its drawer. */
  label: string;
  edge: "top" | "bottom" | "left" | "right";
  /* How much of the card lies past that edge, in pixels. */
  cutOff: number;
  /* EDGE_CLICK_INSET_PX inside that edge, on the card and on screen. */
  point: ScreenPoint;
}

/* How far the drawing's centre is from the canvas's, down. */
function drawingOffMiddle(state: ServiceMapCanvasState): number {
  expect(state.drawing, "the drawing is on the canvas").not.toBeNull();
  return Math.abs(
    state.drawing!.y +
      state.drawing!.height / 2 -
      (state.canvas.y + state.canvas.height / 2),
  );
}

/* The whole of one box lies within another. */
function boxWithin(inner: ScreenBox, outer: ScreenBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/*
 * Waits until the canvas has followed the window (`canvasFits` says whether
 * its width is the expected one) and the drawing is framed in it: centred
 * across and down, every card on the canvas.
 */
async function expectFramed(
  page: Page,
  canvasFits: (width: number) => boolean,
  when: string,
): Promise<void> {
  await expect
    .poll(
      async (): Promise<FramedMap> => {
        const state: ServiceMapCanvasState = await serviceMapCanvas(page);
        return {
          resized: canvasFits(state.canvas.width),
          cardsInView: state.cardsInView,
          centred:
            state.drawing !== null &&
            drawingOffCentre(state) <= 2 &&
            drawingOffMiddle(state) <= 2,
        };
      },
      { message: `the map is framed ${when}` },
    )
    .toEqual({
      resized: true,
      cardsInView: LARGE_SERVICE_MAP_CARDS,
      centred: true,
    });
}

/* Waits until the view is `fitted`'s again, give or take rounding. */
async function expectFittedAgain(
  page: Page,
  fitted: ServiceMapCanvasState,
  message: string,
): Promise<void> {
  await expect
    .poll(
      async (): Promise<boolean> => {
        return sameView(
          (await serviceMapCanvas(page)).transform,
          fitted.transform,
        );
      },
      { message },
    )
    .toBe(true);
}

/* Presses the mouse button at a point, moves one pixel across, lets go. */
async function pressWithOnePixelDrift(
  page: Page,
  at: ScreenPoint,
): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 1, at.y);
  await page.mouse.up();
}

/*
 * Ctrl + wheel about a point, one notch at a time: `notches` of them, or
 * fewer once `enough` says the canvas shows what was wanted.
 */
async function zoomInWithCtrlWheel(
  page: Page,
  at: ScreenPoint,
  notches: number,
  enough?: (state: ServiceMapCanvasState) => boolean,
): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  for (let notch: number = 1; notch <= notches; notch++) {
    await page.mouse.wheel(0, -100);
    if (enough && enough(await serviceMapCanvas(page))) {
      break;
    }
  }
  await page.keyboard.up("Control");
}

async function flowScroll(page: Page): Promise<FlowScroll> {
  return page
    .getByTestId("service-map-canvas")
    .locator(".react-flow")
    .evaluate((flow: HTMLElement): FlowScroll => {
      return { scrollLeft: flow.scrollLeft, scrollTop: flow.scrollTop };
    });
}

async function focusOnMap(page: Page): Promise<FocusOnMap> {
  return page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): FocusOnMap => {
      const focused: Element | null = document.activeElement;
      const renderer: Element | null = canvas.querySelector(
        ".react-flow__renderer",
      );
      const bounds: DOMRect = canvas.getBoundingClientRect();
      const box: DOMRect = focused
        ? focused.getBoundingClientRect()
        : new DOMRect();
      // A box brought to the edge can land a fraction of a pixel past it.
      const slack: number = 1;
      const onAxis: (
        start: number,
        end: number,
        viewStart: number,
        viewEnd: number,
      ) => boolean = (
        start: number,
        end: number,
        viewStart: number,
        viewEnd: number,
      ): boolean => {
        if (end - start <= viewEnd - viewStart) {
          return start >= viewStart - slack && end <= viewEnd + slack;
        }
        return end > viewStart && start < viewEnd;
      };
      return {
        inMap: Boolean(focused && renderer && renderer.contains(focused)),
        name: focused
          ? focused.getAttribute("aria-label") ||
            focused.getAttribute("data-id") ||
            focused.tagName
          : "nothing",
        cardId:
          focused && focused.classList.contains("react-flow__node")
            ? focused.getAttribute("data-id") || ""
            : "",
        onCanvas:
          onAxis(box.left, box.right, bounds.left, bounds.right) &&
          onAxis(box.top, box.bottom, bounds.top, bounds.bottom),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        canvas: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      };
    });
}

function describeBox(box: ScreenBox): string {
  return `(${Math.round(box.x)}, ${Math.round(box.y)}) ${Math.round(box.width)} x ${Math.round(box.height)}`;
}

/*
 * "on the canvas", "not a card or connection" (focus left the map), or
 * where the focused card or connection is instead, for the message.
 */
function focusPlace(focus: FocusOnMap): string {
  if (!focus.inMap) {
    return "not a card or connection";
  }
  if (focus.onCanvas) {
    return "on the canvas";
  }
  return `off the canvas: "${focus.name}" at ${describeBox(focus.box)}, the canvas at ${describeBox(focus.canvas)}`;
}

/*
 * A point of empty canvas on screen: the pane, not a card, a line, a
 * control or the notice, is under it and all around it.
 */
async function emptyPanePoint(page: Page): Promise<ScreenPoint | null> {
  return page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): ScreenPoint | null => {
      const bounds: DOMRect = canvas.getBoundingClientRect();
      const left: number = Math.max(bounds.left, 0);
      const right: number = Math.min(bounds.right, window.innerWidth);
      const top: number = Math.max(bounds.top, 0);
      const bottom: number = Math.min(bounds.bottom, window.innerHeight);
      const isPane: (x: number, y: number) => boolean = (
        x: number,
        y: number,
      ): boolean => {
        const element: Element | null = document.elementFromPoint(x, y);
        return Boolean(
          element &&
            element.classList.contains("react-flow__pane") &&
            canvas.contains(element),
        );
      };
      for (let row: number = 1; row < 10; row++) {
        for (let column: number = 1; column < 20; column++) {
          const x: number = left + ((right - left) * column) / 20;
          const y: number = top + ((bottom - top) * row) / 10;
          if (
            isPane(x, y) &&
            isPane(x - 8, y - 8) &&
            isPane(x + 8, y - 8) &&
            isPane(x - 8, y + 8) &&
            isPane(x + 8, y + 8)
          ) {
            return { x, y };
          }
        }
      }
      return null;
    });
}

/*
 * Drags empty canvas by SMALL_DRAG, each way the drawing has room to move
 * (it runs past the canvas on that side), and expects the view to move by
 * exactly that: a view left outside the pan extent jumps back inside it on
 * the first drag instead. The drag takes focus from the map.
 */
async function expectSmallDragToMoveViewExactly(
  page: Page,
  when: string,
): Promise<void> {
  const state: ServiceMapCanvasState = await settledServiceMap(page);
  expect(state.drawing, `the drawing is drawn ${when}`).not.toBeNull();
  const drawing: ScreenBox = state.drawing!;
  const canvas: ScreenBox = state.canvas;
  const room: (step: number, before: number, after: number) => number = (
    step: number,
    before: number,
    after: number,
  ): number => {
    if (before >= step) {
      return step;
    }
    return after >= step ? -step : 0;
  };
  const drag: ScreenPoint = {
    x: room(
      SMALL_DRAG.x,
      canvas.x - drawing.x,
      drawing.x + drawing.width - (canvas.x + canvas.width),
    ),
    y: room(
      SMALL_DRAG.y,
      canvas.y - drawing.y,
      drawing.y + drawing.height - (canvas.y + canvas.height),
    ),
  };
  expect(
    [drag.x, drag.y],
    `the drawing runs past the canvas, across and down, ${when}`,
  ).not.toContain(0);
  const at: ScreenPoint | null = await emptyPanePoint(page);
  expect(at, `a point of empty canvas on screen ${when}`).not.toBeNull();

  const before: FlowView = flowView(state.transform);
  await page.mouse.move(at!.x, at!.y);
  await page.mouse.down();
  await page.mouse.move(at!.x + drag.x, at!.y + drag.y);
  await page.mouse.up();
  const after: FlowView = flowView((await settledServiceMap(page)).transform);
  // The transform is read back to six significant digits.
  expect(
    {
      x: Math.round((after.x - before.x) * 10) / 10,
      y: Math.round((after.y - before.y) * 10) / 10,
      zoom: after.zoom,
    },
    `a ${SMALL_DRAG.x} x ${SMALL_DRAG.y} px drag of empty canvas moves the view by exactly that ${when}`,
  ).toEqual({ x: drag.x, y: drag.y, zoom: before.zoom });
}

/* The cards of the drawing's left-hand column, top to bottom. */
async function leftColumn(page: Page): Promise<MapColumn> {
  return page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): MapColumn => {
      const cards: Array<{ id: string; box: DOMRect }> = Array.from(
        canvas.querySelectorAll<HTMLElement>(".react-flow__node"),
      ).map((card: HTMLElement): { id: string; box: DOMRect } => {
        return {
          id: card.getAttribute("data-id") || "",
          box: card.getBoundingClientRect(),
        };
      });
      const left: number = Math.min(
        ...cards.map((card: { id: string; box: DOMRect }): number => {
          return card.box.left;
        }),
      );
      const column: Array<{ id: string; box: DOMRect }> = cards
        .filter((card: { id: string; box: DOMRect }): boolean => {
          return Math.abs(card.box.left - left) < 1;
        })
        .sort(
          (
            a: { id: string; box: DOMRect },
            b: { id: string; box: DOMRect },
          ): number => {
            return a.box.top - b.box.top;
          },
        );
      return {
        ids: column.map((card: { id: string; box: DOMRect }): string => {
          return card.id;
        }),
        boxes: column.map((card: { id: string; box: DOMRect }): ScreenBox => {
          return {
            x: card.box.x,
            y: card.box.y,
            width: card.box.width,
            height: card.box.height,
          };
        }),
      };
    });
}

/*
 * The drawn card the canvas edge cuts off the most (at least MIN_CUT_OFF_PX
 * of it past the edge), with a point EDGE_CLICK_INSET_PX inside that edge,
 * in the middle of the card's part on the canvas, where a click lands on the
 * card itself (not on a control, a line or the notice) and on screen. Null
 * when no card qualifies.
 */
async function cardCutOffByCanvasEdge(page: Page): Promise<CutOffCard | null> {
  return page.getByTestId("service-map-canvas").evaluate(
    (
      canvas: HTMLElement,
      limits: { inset: number; minCutOff: number },
    ): CutOffCard | null => {
      const bounds: DOMRect = canvas.getBoundingClientRect();
      let best: CutOffCard | null = null;
      for (const card of Array.from(
        canvas.querySelectorAll<HTMLElement>(".react-flow__node"),
      )) {
        if (window.getComputedStyle(card).visibility === "hidden") {
          continue;
        }
        const box: DOMRect = card.getBoundingClientRect();
        // The middle of the part of the card on the canvas, across and down.
        const middleX: number =
          (Math.max(box.left, bounds.left) +
            Math.min(box.right, bounds.right)) /
          2;
        const middleY: number =
          (Math.max(box.top, bounds.top) +
            Math.min(box.bottom, bounds.bottom)) /
          2;
        const sides: Array<Omit<CutOffCard, "id" | "label">> = [
          {
            edge: "top",
            cutOff: bounds.top - box.top,
            point: { x: middleX, y: bounds.top + limits.inset },
          },
          {
            edge: "bottom",
            cutOff: box.bottom - bounds.bottom,
            point: { x: middleX, y: bounds.bottom - limits.inset },
          },
          {
            edge: "left",
            cutOff: bounds.left - box.left,
            point: { x: bounds.left + limits.inset, y: middleY },
          },
          {
            edge: "right",
            cutOff: box.right - bounds.right,
            point: { x: bounds.right - limits.inset, y: middleY },
          },
        ];
        for (const side of sides) {
          const { x, y } = side.point;
          if (
            side.cutOff < limits.minCutOff ||
            (best && side.cutOff <= best.cutOff) ||
            x < 0 ||
            y < 0 ||
            x >= window.innerWidth ||
            y >= window.innerHeight
          ) {
            continue;
          }
          const hit: Element | null = document.elementFromPoint(x, y);
          if (!hit || !card.contains(hit)) {
            continue;
          }
          best = {
            id: card.getAttribute("data-id") || "",
            label:
              card
                .querySelector('[data-testid^="service-map-node-"]')
                ?.getAttribute("title") || "",
            ...side,
          };
        }
      }
      return best;
    },
    { inset: EDGE_CLICK_INSET_PX, minCutOff: MIN_CUT_OFF_PX },
  );
}

async function noticePlace(page: Page): Promise<NoticePlace> {
  return page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): NoticePlace => {
      const notice: HTMLElement | null = canvas.querySelector<HTMLElement>(
        '[data-testid="service-map-out-of-view"] [role="status"]',
      );
      const bounds: DOMRect = canvas.getBoundingClientRect();
      const box: DOMRect = notice
        ? notice.getBoundingClientRect()
        : new DOMRect();
      // The part of the canvas on screen, down the window.
      const shownTop: number = Math.max(bounds.top, 0);
      const shownBottom: number = Math.min(bounds.bottom, window.innerHeight);
      const offMiddle: number =
        (box.top + box.bottom) / 2 - (shownTop + shownBottom) / 2;
      const within: (
        inner: DOMRect,
        left: number,
        top: number,
        right: number,
        bottom: number,
      ) => boolean = (
        inner: DOMRect,
        left: number,
        top: number,
        right: number,
        bottom: number,
      ): boolean => {
        return (
          inner.left >= left &&
          inner.top >= top &&
          inner.right <= right &&
          inner.bottom <= bottom
        );
      };
      return {
        inCanvas:
          Boolean(notice) &&
          within(box, bounds.left, bounds.top, bounds.right, bounds.bottom),
        inWindow:
          Boolean(notice) &&
          within(box, 0, 0, window.innerWidth, window.innerHeight),
        atCanvasLeft:
          Boolean(notice) &&
          box.left - bounds.left >= 0 &&
          box.left - bounds.left <= 40,
        centredOnScreen:
          Boolean(notice) &&
          shownBottom > shownTop &&
          Math.abs(offMiddle) <= 30,
        where: notice
          ? `notice at (${Math.round(box.left)}, ${Math.round(box.top)}) ${Math.round(box.width)} x ${Math.round(box.height)}, ${Math.round(box.left - bounds.left)} px from the canvas's left edge and ${Math.round(offMiddle)} px from the middle of its part on screen (${Math.round(shownTop)} to ${Math.round(shownBottom)}); canvas ${Math.round(bounds.top)} to ${Math.round(bounds.bottom)} down a ${window.innerWidth} x ${window.innerHeight} window`
          : "no notice",
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    });
}

/*
 * Waits until the notice is on the canvas and on screen, at the canvas's
 * left edge and in the middle of the part of the canvas on screen.
 */
async function expectNoticeInSight(
  page: Page,
  when: string,
): Promise<NoticePlace> {
  await expect
    .poll(
      async (): Promise<Omit<NoticePlace, "box">> => {
        const place: NoticePlace = await noticePlace(page);
        const inSight: boolean =
          place.inCanvas &&
          place.inWindow &&
          place.atCanvasLeft &&
          place.centredOnScreen;
        return {
          inCanvas: place.inCanvas,
          inWindow: place.inWindow,
          atCanvasLeft: place.atCanvasLeft,
          centredOnScreen: place.centredOnScreen,
          // With a failure, where the notice, the canvas and the window are.
          where: inSight ? "in sight" : place.where,
        };
      },
      {
        message: `the notice is on the canvas and on screen, at the canvas's left edge and in the middle of its part on screen, ${when}`,
      },
    )
    .toEqual({
      inCanvas: true,
      inWindow: true,
      atCanvasLeft: true,
      centredOnScreen: true,
      where: "in sight",
    });
  return noticePlace(page);
}

test("a press that moves nothing keeps a large map framed when the window narrows", async ({
  page,
}: {
  page: Page;
}) => {
  const defaultWindow: WindowSize | null = page.viewportSize();
  expect(defaultWindow, "the window size the tests run at").not.toBeNull();
  const fitted: ServiceMapCanvasState = await openLargeServiceMap(page);
  const isWide: (width: number) => boolean = (width: number): boolean => {
    return Math.abs(width - fitted.canvas.width) < 1;
  };
  const isNarrow: (width: number) => boolean = (width: number): boolean => {
    return width < fitted.canvas.width - 200;
  };
  await expectFramed(page, isWide, "as it opens");

  /*
   * The fitted large map is pinned by its pan extent, so neither press
   * moves it. d3-zoom still takes each for a drag and pins the view again
   * on the move, and React Flow reports the re-pinned view, a float ulp
   * from the fitted one, as a move.
   */
  const presses: Array<MapPress> = [
    {
      name: "a press on the empty canvas that drifts one pixel",
      at: async (state: ServiceMapCanvasState): Promise<ScreenPoint> => {
        return emptyCanvasPoint(state);
      },
    },
    {
      name: "a press on a card that drifts one pixel",
      at: async (): Promise<ScreenPoint> => {
        const card: ScreenBox | null = await page
          .getByTestId("service-map-node-service-platform-core")
          .boundingBox();
        expect(card, "the platform-core card is drawn").not.toBeNull();
        return { x: card!.x + card!.width / 2, y: card!.y + card!.height / 2 };
      },
    },
  ];
  for (const press of presses) {
    if (!isWide((await serviceMapCanvas(page)).canvas.width)) {
      await page.setViewportSize(defaultWindow!);
      await expectFramed(
        page,
        isWide,
        `back at ${defaultWindow!.width} px wide, before ${press.name}`,
      );
    }
    const state: ServiceMapCanvasState = await centreServiceMapCanvas(page);
    await pressWithOnePixelDrift(page, await press.at(state));
    expect(
      sameView((await settledServiceMap(page)).transform, fitted.transform),
      `${press.name} leaves the fitted view where it was`,
    ).toBe(true);

    await page.setViewportSize(NARROW_WINDOW);
    await expectFramed(
      page,
      isNarrow,
      `in a ${NARROW_WINDOW.width} px window after ${press.name}`,
    );
  }
});

test("a click that slips a pixel on a small map keeps it framed when the window narrows", async ({
  page,
}: {
  page: Page;
}) => {
  /*
   * The default estate's whole map, five cards across, is pinned by its pan
   * extent in any window: the page caps the canvas's width, and the fitted
   * view is wider than the extent. Focused on payments it is three cards
   * across, fitted at nearly full size, and the extent is a little wider
   * than the view, so the slip of a click pans it a pixel. That is not the
   * user taking the view: the map still follows the window.
   */
  const smallMapCards: number = 3;
  await openView(page, "Service Map", "focus=service-payments");
  await expect(page.getByTestId("service-map-clear-focus")).toBeVisible();
  await expect
    .poll(
      async (): Promise<Array<number>> => {
        const state: ServiceMapCanvasState = await serviceMapCanvas(page);
        return [state.cards, state.cardsWithin];
      },
      {
        message: "the focused map's cards are drawn, each wholly on the canvas",
      },
    )
    .toEqual([smallMapCards, smallMapCards]);
  const fitted: ServiceMapCanvasState = await settledServiceMap(page);

  const at: ScreenPoint | null = await emptyPanePoint(page);
  expect(at, "a point of empty canvas").not.toBeNull();
  await pressWithOnePixelDrift(page, at!);
  const slipped: ServiceMapCanvasState = await settledServiceMap(page);
  expect(
    Math.round(
      (flowView(slipped.transform).x - flowView(fitted.transform).x) * 10,
    ) / 10,
    "the slip of the click pans the map a pixel across",
  ).toBe(1);

  await page.setViewportSize(NARROW_WINDOW);
  await expect
    .poll(
      async (): Promise<number> => {
        return (await serviceMapCanvas(page)).canvas.width;
      },
      {
        message:
          "the canvas follows the window, narrower than the drawing it framed: left as it was, the drawing would be cut off",
      },
    )
    .toBeLessThan(slipped.drawing!.width);
  await expect
    .poll(
      async (): Promise<Array<number>> => {
        const state: ServiceMapCanvasState = await serviceMapCanvas(page);
        return [state.cards, state.cardsWithin];
      },
      {
        message: `every card is wholly on the canvas in a ${NARROW_WINDOW.width} px window after the click`,
      },
    )
    .toEqual([smallMapCards, smallMapCards]);
});

test("tabbing through a zoomed-in map keeps it on the canvas", async ({
  page,
}: {
  page: Page;
}) => {
  const fitted: ServiceMapCanvasState = await openLargeServiceMap(page);
  const canvas: ReturnType<Page["getByTestId"]> =
    page.getByTestId("service-map-canvas");
  const fitToScreen: ReturnType<Page["getByTestId"]> =
    page.getByTestId("service-map-fit");
  const fittedZoom: number = flowView(fitted.transform).zoom;

  /*
   * Every card and connection takes keyboard focus, and the focused one has
   * to come onto the canvas whichever side of the view it is on. Left to
   * the browser, focusing one off the canvas scrolls React Flow's box
   * (sliding the whole map, controls included, off the canvas), and a box
   * only scrolls right and down: a card above or left of the view could not
   * be reached at all. Tab walks the connections one way, Shift + Tab walks
   * them back. Zoomed in at the right-hand edge, the view starts level with
   * the top of the last column, so cards are on the canvas; any higher is
   * the empty corner of a later test.
   */
  const passes: Array<{ key: string; name: string }> = [
    { key: "Tab", name: "Tab" },
    { key: "Shift+Tab", name: "Shift + Tab" },
  ];
  const zoomPoints: Array<ZoomPoint> = [
    {
      where: "near the top of the right-hand part of the canvas",
      at: (state: ServiceMapCanvasState): ScreenPoint => {
        return {
          x: state.canvas.x + state.canvas.width - 8,
          y: state.canvas.y + state.canvas.height * 0.3,
        };
      },
    },
    {
      where: "near the top of the left-hand part of the canvas",
      at: (state: ServiceMapCanvasState): ScreenPoint => {
        return {
          x: state.canvas.x + 8,
          y: state.canvas.y + state.canvas.height * 0.1,
        };
      },
    },
  ];
  for (const zoomPoint of zoomPoints) {
    const state: ServiceMapCanvasState = await centreServiceMapCanvas(page);
    await zoomInWithCtrlWheel(page, zoomPoint.at(state), CTRL_WHEEL_NOTCHES);
    const zoomed: ServiceMapCanvasState = await settledServiceMap(page);
    expect(
      flowView(zoomed.transform).zoom,
      `zoomed in ${zoomPoint.where}`,
    ).toBeGreaterThan(fittedZoom * 4);
    expect(
      zoomed.cardsInView,
      `cards on the canvas zoomed in ${zoomPoint.where}`,
    ).toBeGreaterThan(0);

    await fitToScreen.focus();
    await expect(fitToScreen).toBeFocused();
    for (const pass of passes) {
      let pressesInMap: number = 0;
      for (let press: number = 1; press <= TAB_PRESSES; press++) {
        await page.keyboard.press(pass.key);
        await expect
          .poll(
            async (): Promise<FocusedMap> => {
              return {
                scroll: await flowScroll(page),
                focus: focusPlace(await focusOnMap(page)),
                someCardInView: (await serviceMapCanvas(page)).cardsInView > 0,
              };
            },
            {
              message: `after ${pass.name} ${press}, zoomed in ${zoomPoint.where}, React Flow's box is not scrolled, the focused card or connection is on the canvas, and so is a card`,
              intervals: [50],
              timeout: 5000,
            },
          )
          .toEqual({
            scroll: { scrollLeft: 0, scrollTop: 0 },
            focus: expect.stringMatching(FOCUS_IN_VIEW),
            someCardInView: true,
          });
        if ((await focusOnMap(page)).inMap) {
          pressesInMap++;
        }
      }
      // Shift + Tab may end on the toolbar, past the first connection.
      expect(
        pressesInMap,
        `${pass.name} went through the map's connections and cards, zoomed in ${zoomPoint.where}`,
      ).toBeGreaterThanOrEqual(TAB_PRESSES - 1);
      // A scrolled box takes the map's controls with it; they are in place.
      const zoomIn: ScreenBox | null = await canvas
        .getByRole("button", { name: "zoom in", exact: true })
        .boundingBox();
      expect(zoomIn, "the zoom-in control is drawn").not.toBeNull();
      expect(
        boxWithin(zoomIn!, (await serviceMapCanvas(page)).canvas),
        `the map's controls are on the canvas after ${pass.name}, zoomed in ${zoomPoint.where}`,
      ).toBe(true);

      /*
       * Every pan that followed focus kept the view inside the pan extent,
       * so a drag now moves it by just what it is dragged. The drag takes
       * focus from the map; the next pass starts where this one ended.
       */
      const focused: JSHandle<Element | null> = await page.evaluateHandle(
        (): Element | null => {
          return document.activeElement;
        },
      );
      await expectSmallDragToMoveViewExactly(
        page,
        `after ${TAB_PRESSES} presses of ${pass.name}, zoomed in ${zoomPoint.where}`,
      );
      await focused.evaluate((element: Element | null): void => {
        (element as HTMLElement | SVGElement | null)?.focus();
      });
      await focused.dispose();
    }

    await fitToScreen.click();
    await expectFittedAgain(
      page,
      fitted,
      `Fit to screen after tabbing, zoomed in ${zoomPoint.where}`,
    );
  }
});

test("focus moving up and down a zoomed-in column brings each card onto the canvas", async ({
  page,
}: {
  page: Page;
}) => {
  const fitted: ServiceMapCanvasState = await openLargeServiceMap(page);
  await centreServiceMapCanvas(page);
  const column: MapColumn = await leftColumn(page);
  expect(
    column.ids,
    "the left-hand column holds the 38 client services",
  ).toHaveLength(38);
  const top: string = column.ids[0]!;
  const bottom: string = column.ids[column.ids.length - 1]!;
  const bottomBox: ScreenBox = column.boxes[column.boxes.length - 1]!;

  await zoomInWithCtrlWheel(
    page,
    {
      x: bottomBox.x + bottomBox.width / 2,
      y: bottomBox.y + bottomBox.height / 2,
    },
    CTRL_WHEEL_NOTCHES,
  );
  const zoomed: ServiceMapCanvasState = await settledServiceMap(page);
  expect(
    flowView(zoomed.transform).zoom,
    "zoomed in at the bottom of the left-hand column",
  ).toBeGreaterThan(flowView(fitted.transform).zoom * 4);
  const topCard: ScreenBox | null = await page
    .locator(`.react-flow__node[data-id="${top}"]`)
    .boundingBox();
  expect(topCard, "the column's top card is drawn").not.toBeNull();
  expect(
    topCard!.y + topCard!.height,
    "the column's top card is far above the canvas, zoomed in at its bottom",
  ).toBeLessThan(zoomed.canvas.y);

  // Up the column, down it and up again: above the view, below it, above.
  const steps: Array<{ which: string; id: string }> = [
    { which: "top", id: top },
    { which: "bottom", id: bottom },
    { which: "top", id: top },
  ];
  for (const step of steps) {
    await page.locator(`.react-flow__node[data-id="${step.id}"]`).focus();
    await expect
      .poll(
        async (): Promise<{
          focused: string;
          scroll: FlowScroll;
          focus: string;
        }> => {
          const focus: FocusOnMap = await focusOnMap(page);
          return {
            focused: focus.cardId,
            scroll: await flowScroll(page),
            focus: focusPlace(focus),
          };
        },
        {
          message: `focusing the column's ${step.which} card brings it onto the canvas, without scrolling React Flow's box`,
        },
      )
      .toEqual({
        focused: step.id,
        scroll: { scrollLeft: 0, scrollTop: 0 },
        focus: "on the canvas",
      });
  }
  await expectSmallDragToMoveViewExactly(
    page,
    "after focus went up and down the column",
  );
});

/*
 * A press focuses the card under it as well as clicking it. Followed like
 * keyboard focus, that focus panned a card the canvas edge cut off onto the
 * canvas between press and release: the card slid out from under the
 * pointer, the release landed on the empty canvas, no drawer opened, and the
 * map moved without being asked to.
 */
test("clicking a card that the canvas edge cuts off opens its drawer and does not move the map", async ({
  page,
}: {
  page: Page;
}) => {
  const fitted: ServiceMapCanvasState = await openLargeServiceMap(page);
  await centreServiceMapCanvas(page);
  const column: MapColumn = await leftColumn(page);
  expect(
    column.ids,
    "the left-hand column holds the 38 client services",
  ).toHaveLength(38);
  /*
   * Zoomed in about the middle of the left-hand column, the column runs far
   * past the canvas's top and bottom, and the next column past its right-hand
   * edge.
   */
  const middle: ScreenBox = column.boxes[Math.floor(column.boxes.length / 2)]!;
  await zoomInWithCtrlWheel(
    page,
    { x: middle.x + middle.width / 2, y: middle.y + middle.height / 2 },
    CTRL_WHEEL_NOTCHES,
  );
  const zoomed: ServiceMapCanvasState = await settledServiceMap(page);
  expect(
    flowView(zoomed.transform).zoom,
    "zoomed in about the middle of the left-hand column",
  ).toBeGreaterThan(flowView(fitted.transform).zoom * 4);
  const cut: CutOffCard | null = await cardCutOffByCanvasEdge(page);
  expect(
    cut,
    `a card with at least ${MIN_CUT_OFF_PX} px of it past the canvas edge, and a point of it ${EDGE_CLICK_INSET_PX} px inside that edge`,
  ).not.toBeNull();
  expect(cut!.label, "the name on the cut-off card").not.toBe("");
  const clicked: string = `a click on ${cut!.label} ${EDGE_CLICK_INSET_PX} px inside the canvas's ${cut!.edge} edge, which cuts ${Math.round(cut!.cutOff)} px of it off`;

  // Which cards the press focuses, to show it did focus the one clicked.
  await page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): void => {
      const focused: Array<string> = [];
      (
        window as unknown as { __serviceMapFocusedCards: Array<string> }
      ).__serviceMapFocusedCards = focused;
      canvas.addEventListener("focusin", (event: FocusEvent): void => {
        if (
          event.target instanceof Element &&
          event.target.classList.contains("react-flow__node")
        ) {
          focused.push(event.target.getAttribute("data-id") || "");
        }
      });
    });
  await page.mouse.click(cut!.point.x, cut!.point.y);

  /*
   * The drawer's dialog element is an empty box (the panel inside it is
   * position: fixed), so what shows is the panel's heading.
   */
  const drawer: ReturnType<Page["getByRole"]> = page
    .getByRole("dialog", { name: cut!.label, exact: true })
    .getByRole("heading", { name: cut!.label, exact: true });
  await expect
    .poll(
      async (): Promise<{
        drawerOpen: boolean;
        transform: string;
        scroll: FlowScroll;
      }> => {
        return {
          drawerOpen: await drawer.isVisible(),
          transform: (await serviceMapCanvas(page)).transform,
          scroll: await flowScroll(page),
        };
      },
      {
        message: `${clicked} opens its drawer, and neither pans the map nor scrolls React Flow's box`,
        timeout: 10000,
      },
    )
    .toEqual({
      drawerOpen: true,
      transform: zoomed.transform,
      scroll: { scrollLeft: 0, scrollTop: 0 },
    });
  expect(
    await page.evaluate((): Array<string> => {
      return (window as unknown as { __serviceMapFocusedCards: Array<string> })
        .__serviceMapFocusedCards;
    }),
    `${clicked} focused that card: the focus the map leaves alone`,
  ).toEqual([cut!.id]);
  expect(
    (await settledServiceMap(page)).transform,
    `the view once ${clicked} has settled`,
  ).toBe(zoomed.transform);
});

test("a map zoomed into an empty corner says so, and Fit to screen brings it back", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize(NARROW_WINDOW);
  const fitted: ServiceMapCanvasState = await openLargeServiceMap(page);
  const state: ServiceMapCanvasState = await centreServiceMapCanvas(page);

  /*
   * Zoomed in about the canvas's top-right corner, the view runs into the
   * top-right corner of the pan extent whatever the exact pointer position:
   * above the shorter columns and right of the first, where the drawing's
   * box holds no card. A dozen notches in, the canvas shows none.
   */
  await zoomInWithCtrlWheel(
    page,
    { x: state.canvas.x + state.canvas.width - 8, y: state.canvas.y + 8 },
    CTRL_WHEEL_NOTCHES,
    (zoomed: ServiceMapCanvasState): boolean => {
      return zoomed.cardsInView === 0;
    },
  );
  expect(
    (await serviceMapCanvas(page)).cardsInView,
    "Ctrl + scroll zoomed into a corner with no card in it",
  ).toBe(0);

  const notice: ReturnType<Page["getByRole"]> = page
    .getByTestId("service-map-out-of-view")
    .getByRole("status");
  await expect(notice).toBeVisible({ timeout: 2000 });
  await expect(notice).toContainText("The map is out of view.");
  /*
   * On the canvas's left, clear of a drawer open on its right, and in the
   * middle of the part of the canvas on screen: here, the whole canvas.
   */
  await expectNoticeInSight(
    page,
    `zoomed into a corner, the whole canvas in a ${NARROW_WINDOW.width} x ${NARROW_WINDOW.height} window`,
  );

  await notice
    .getByRole("button", { name: "Fit to screen", exact: true })
    .click();
  await expectFittedAgain(
    page,
    fitted,
    "the notice's Fit to screen frames the map as it was fitted",
  );
  await expect(page.getByTestId("service-map-out-of-view")).toHaveCount(0);
  await expectEveryCardInView(page, "after the notice's Fit to screen");
});

test("the notice stays on screen when only the bottom of a tall map is showing", async ({
  page,
}: {
  page: Page;
}) => {
  const shortWindow: WindowSize = { width: 1280, height: 600 };
  await page.setViewportSize(shortWindow);
  await openLargeServiceMap(page);
  // The canvas's bottom edge at the window's: most of the canvas is above.
  await page
    .getByTestId("service-map-canvas")
    .evaluate((canvas: HTMLElement): void => {
      canvas.scrollIntoView({ block: "end", behavior: "instant" });
    });
  const state: ServiceMapCanvasState = await serviceMapCanvas(page);
  expect(
    Math.abs(state.canvas.y + state.canvas.height - shortWindow.height),
    "the canvas's bottom edge is at the window's",
  ).toBeLessThanOrEqual(1);
  expect(
    state.canvas.y,
    "the canvas's top is well above the window",
  ).toBeLessThan(-200);

  /*
   * Zoomed in about the canvas's bottom-right corner, the view runs into
   * the bottom-right corner of the pan extent: below the shorter columns and
   * right of the first, where the drawing's box holds no card.
   */
  await zoomInWithCtrlWheel(
    page,
    {
      x: state.canvas.x + state.canvas.width - 8,
      y: state.canvas.y + state.canvas.height - 8,
    },
    CTRL_WHEEL_NOTCHES,
    (zoomed: ServiceMapCanvasState): boolean => {
      return zoomed.cardsInView === 0;
    },
  );
  expect(
    (await serviceMapCanvas(page)).cardsInView,
    "Ctrl + scroll zoomed into a corner with no card in it",
  ).toBe(0);
  const notice: ReturnType<Page["getByRole"]> = page
    .getByTestId("service-map-out-of-view")
    .getByRole("status");
  await expect(notice).toBeVisible({ timeout: 2000 });
  const withBottomShowing: NoticePlace = await expectNoticeInSight(
    page,
    "with only the bottom of the canvas on screen",
  );

  // The page scrolled up until the canvas's top is 150 px down the window.
  const canvasTop: number = (await serviceMapCanvas(page)).canvas.y;
  await page.evaluate((by: number): void => {
    window.scrollBy({ top: by, behavior: "instant" });
  }, canvasTop - 150);
  expect(
    Math.round((await serviceMapCanvas(page)).canvas.y),
    "the canvas's top is on screen",
  ).toBe(150);
  const withTopShowing: NoticePlace = await expectNoticeInSight(
    page,
    "once the page is scrolled up to the canvas's top",
  );
  expect(
    Math.abs(withTopShowing.box.y - withBottomShowing.box.y),
    "the notice moved with the part of the canvas on screen",
  ).toBeGreaterThan(30);
});
