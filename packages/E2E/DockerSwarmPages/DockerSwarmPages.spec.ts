import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * A Docker Swarm cluster's pages on a phone, in a browser, against the
 * offline fixture (DockerSwarmPages/Fixture).
 *
 * Follow-up of #5076: on a phone the Swarm's Metrics tab cut each metric's
 * name to a few letters, beside its value and sparkline, and a task's
 * 64-character Container ID ran out of its card; and an agent that only
 * took new files - the same collector release - showed no sign that it was
 * behind. So, read the way a person reads them: the Metrics tab's rows at a
 * phone's width, beside the side menu at a 768px window and at a laptop's;
 * a task's page with its long Container ID; the Overview's agent chip with
 * the files before the fix (0.161.0), the files this release ships
 * (0.161.1) and no version at all, the sign's dialog with both ways to
 * upgrade; the Overview's own name on a phone; dark and German. The fixture
 * records every read, so the tests check that nothing it does not model was
 * asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "62000000-0000-4000-8000-000000000001";
const CLUSTER_NAME: string = "swarm-prod";

const CLUSTER_PATH: string = `/dashboard/${PROJECT_ID}/docker-swarm/${CLUSTER_ID}`;
const METRICS_PAGE: string = `${CLUSTER_PATH}/metrics`;
const TASK_PAGE: string = `${CLUSTER_PATH}/tasks/${encodeURIComponent(
  "task/x7k2m9p4q1r8s5t3v6w0y2z4a",
)}`;

const CONTAINER_ID: string =
  "6f3c2a91d8b74e05a1c9f0e7b2d4a6c8e1f3b5d7a9c0e2f4b6d8a0c2e4f6a8b0";

// What the swarm's agent sends, as the metric catalog names them.
const METRIC_NAMES: Array<string> = [
  "container.blockio.io_service_bytes_recursive",
  "container.cpu.utilization",
  "container.memory.percent",
  "container.memory.usage.total",
  "container.network.io.usage.rx_bytes",
];

// The agent files this release ships, and the ones before the CPU fix.
const AGENT_FILES_VERSION: string = "0.161.1";
const OLD_AGENT_VERSION: string = "0.161.0";
const OUTDATED_NAME: string = `Agent ${OLD_AGENT_VERSION} is outdated. A newer agent is available: ${AGENT_FILES_VERSION}. Show how to upgrade.`;

const PHONE: { width: number; height: number } = { width: 390, height: 844 };
const TABLET: { width: number; height: number } = { width: 768, height: 1024 };
const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/docker-swarm-pages-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

interface ListRequest {
  modelName: string;
  query: Record<string, unknown>;
}

interface Recorded {
  listRequests: Array<ListRequest>;
  aggregateRequests: Array<{ modelName: string; name: string | null }>;
  apiRequests: Array<{ method: string; url: string }>;
  unhandled: Array<Record<string, unknown>>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
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
          window as unknown as { __dockerSwarmPagesFixture?: Recorded }
        ).__dockerSwarmPagesFixture;
        return fixture ? fixture.unhandled : [];
      },
    );

    // Every read the page made is one the fixture answers as the server does.
    expect(unhandled).toEqual([]);
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
    return (window as unknown as { __dockerSwarmPagesFixture: Recorded })
      .__dockerSwarmPagesFixture;
  });
}

function withQuery(pagePath: string, query: string): string {
  return query ? `${pagePath}?${query}` : pagePath;
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const widths: { page: number; window: number } = await page.evaluate(
    (): { page: number; window: number } => {
      return {
        page: document.documentElement.scrollWidth,
        window: window.innerWidth,
      };
    },
  );

  expect(widths.page).toBeLessThanOrEqual(widths.window);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

// Whether an element's text is cut: wider than the box it is drawn in.
async function isCut(locator: Locator): Promise<boolean> {
  return await locator.evaluate((element: Element): boolean => {
    return element.scrollWidth > element.clientWidth + 0.5;
  });
}

/*
 * ---------------------------------------------------------------------------
 * The Metrics tab
 * ---------------------------------------------------------------------------
 */
async function openMetricsPage(page: Page, query: string = ""): Promise<void> {
  await page.goto(withQuery(METRICS_PAGE, query));
  await expect(page.getByTestId("metric-row")).toHaveCount(METRIC_NAMES.length);
}

async function expectRowsStacked(page: Page): Promise<void> {
  const rows: Locator = page.getByTestId("metric-row");

  for (let index: number = 0; index < METRIC_NAMES.length; index++) {
    const row: Locator = rows.nth(index);
    const name: Locator = row.getByTestId("metric-row-name");
    const value: Locator = row.getByTestId("metric-row-value");

    // The whole name, never cut to "conta…".
    await expect(name).toHaveText(METRIC_NAMES[index]!);
    expect(await isCut(name)).toBe(false);

    // The value and its sparkline on a line of their own, under the name.
    const nameBox: Box = await boxOf(name);
    const valueBox: Box = await boxOf(value);
    expect(valueBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);

    // Inside the row.
    const rowBox: Box = await boxOf(row);
    expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 0.5,
    );
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 0.5,
    );
  }
}

test.describe("the Swarm's Metrics tab, every metric's name in full", () => {
  test("on a phone: each row shows its metric's whole name, its value on a line under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openMetricsPage(page);

    await expectRowsStacked(page);
    await expectNoSidewaysScroll(page);

    // A long name wraps onto a second line rather than running out.
    const longest: Locator = page
      .getByTestId("metric-row-name")
      .filter({ hasText: "container.blockio.io_service_bytes_recursive" });
    const lineHeight: number = await longest.evaluate(
      (element: Element): number => {
        return parseFloat(getComputedStyle(element).lineHeight);
      },
    );
    expect((await boxOf(longest)).height).toBeGreaterThan(lineHeight * 1.5);

    await screenshot(page, "docker-swarm-metrics-phone");
  });

  test("beside the side menu at a 768px window, the rows are stacked as on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(TABLET);
    await openMetricsPage(page);

    // The side menu takes the left of the window, so the list is narrow.
    const rowBox: Box = await boxOf(page.getByTestId("metric-row").first());
    expect(rowBox.width).toBeLessThan(36 * 16);

    await expectRowsStacked(page);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-metrics-768");
  });

  test("at a laptop's width: each name on one line, its value and sparkline beside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openMetricsPage(page);

    const rows: Locator = page.getByTestId("metric-row");
    for (let index: number = 0; index < METRIC_NAMES.length; index++) {
      const row: Locator = rows.nth(index);
      const name: Locator = row.getByTestId("metric-row-name");
      const value: Locator = row.getByTestId("metric-row-value");

      await expect(name).toHaveText(METRIC_NAMES[index]!);
      expect(await isCut(name)).toBe(false);

      const nameBox: Box = await boxOf(name);
      const valueBox: Box = await boxOf(value);

      // Side by side: the value starts right of the name, on its line.
      expect(valueBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
      expect(valueBox.y).toBeLessThan(nameBox.y + nameBox.height);

      // One line.
      const lineHeight: number = await name.evaluate(
        (element: Element): number => {
          return parseFloat(getComputedStyle(element).lineHeight);
        },
      );
      expect(nameBox.height).toBeLessThan(lineHeight * 1.5);
    }

    await screenshot(page, "docker-swarm-metrics-laptop");
  });

  test("each row's newest value is its metric's, in its unit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openMetricsPage(page);

    const row: (name: string) => Locator = (name: string): Locator => {
      return page.getByTestId("metric-row").filter({
        has: page.getByTestId("metric-row-name").getByText(name, {
          exact: true,
        }),
      });
    };

    await expect(
      row("container.cpu.utilization").getByTestId("metric-row-value"),
    ).toContainText("3.40%");
    await expect(
      row("container.memory.usage.total").getByTestId("metric-row-value"),
    ).toContainText("MB");
  });

  test("the list reads the swarm's metric names, then those names' catalog rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openMetricsPage(page);

    const reads: Recorded = await recorded(page);
    const metricNameReads: Array<ListRequest> = reads.listRequests.filter(
      (request: ListRequest): boolean => {
        return request.modelName === "MetricItemV3";
      },
    );
    expect(metricNameReads.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(metricNameReads[0]!.query)).toContain(CLUSTER_NAME);

    const catalogReads: Array<ListRequest> = reads.listRequests.filter(
      (request: ListRequest): boolean => {
        return request.modelName === "MetricType";
      },
    );
    expect(catalogReads.length).toBeGreaterThanOrEqual(1);

    // A sparkline per metric, and nothing else aggregated.
    expect(
      reads.aggregateRequests
        .map((request: { name: string | null }) => {
          return request.name;
        })
        .sort(),
    ).toEqual(expect.arrayContaining(METRIC_NAMES));
  });

  test("dark, on a phone: the stacked rows keep their names and stay inside the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openMetricsPage(page, "theme=dark");

    await expectRowsStacked(page);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-metrics-phone-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A task's page
 * ---------------------------------------------------------------------------
 */
async function openTaskPage(page: Page, query: string = ""): Promise<void> {
  await page.goto(withQuery(TASK_PAGE, query));
  await expect(
    page.getByTestId("info-card-value").filter({ hasText: CONTAINER_ID }),
  ).toBeVisible();
}

// Every summary card, and its value, inside the window and its card.
async function expectCardsInside(page: Page, width: number): Promise<void> {
  const values: Locator = page.getByTestId("info-card-value");
  const count: number = await values.count();
  expect(count).toBeGreaterThan(10);

  for (let index: number = 0; index < count; index++) {
    const value: Locator = values.nth(index);
    const card: Locator = value.locator("xpath=..");
    const valueBox: Box = await boxOf(value);
    const cardBox: Box = await boxOf(card);

    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width + 0.5);
    expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width + 0.5,
    );
    expect(await isCut(value)).toBe(false);
  }
}

test.describe("a task's 64-character Container ID", () => {
  test("on a phone: inside its card, whole, on as many lines as it takes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openTaskPage(page);

    const value: Locator = page
      .getByTestId("info-card-value")
      .filter({ hasText: CONTAINER_ID });
    await expect(value).toHaveText(CONTAINER_ID);

    // Two lines at least: it breaks inside the card rather than running out.
    const lineHeight: number = await value.evaluate(
      (element: Element): number => {
        return parseFloat(getComputedStyle(element).lineHeight);
      },
    );
    expect((await boxOf(value)).height).toBeGreaterThan(lineHeight * 1.5);

    await expectCardsInside(page, PHONE.width);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-task-container-id-phone");
  });

  test("beside the side menu at 768 pixels and at a laptop's width: inside its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [TABLET, LAPTOP]) {
      await page.setViewportSize(size);
      await openTaskPage(page);

      await expectCardsInside(page, size.width);
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, "docker-swarm-task-container-id-laptop");
  });

  test("short values are drawn on one line, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openTaskPage(page);

    const service: Locator = page
      .getByTestId("info-card-value")
      .filter({ hasText: /^shop_checkout$/ });
    const lineHeight: number = await service.evaluate(
      (element: Element): number => {
        return parseFloat(getComputedStyle(element).lineHeight);
      },
    );
    expect((await boxOf(service)).height).toBeLessThan(lineHeight * 1.5);
  });

  test("dark and German, on a phone: the Container ID card reads Container-ID, inside the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openTaskPage(page, "theme=dark&lang=de");

    const value: Locator = page
      .getByTestId("info-card-value")
      .filter({ hasText: CONTAINER_ID });
    await expect(value.locator("xpath=..")).toContainText(
      GERMAN["Container ID"]!,
    );

    await expectCardsInside(page, PHONE.width);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-task-container-id-phone-dark-de");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The Overview's agent version
 * ---------------------------------------------------------------------------
 */
async function openOverview(page: Page, query: string = ""): Promise<void> {
  await page.goto(withQuery(CLUSTER_PATH, query));
  await expect(page.getByTestId("resource-hero-top-row")).toBeVisible();

  // The Overview has drawn its counts from the inventory.
  const healthy: string =
    "Everything looks healthy — all reported nodes, services and tasks are in a steady state.";
  await expect(
    page.getByText(query.includes("lang=de") ? GERMAN[healthy]! : healthy),
  ).toBeVisible();
}

test.describe("the Swarm agent's version on the Overview", () => {
  test("files before the CPU fix (0.161.0): the chip carries the sign, which explains itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const sign: Locator = page.getByRole("button", { name: OUTDATED_NAME });
    await expect(sign).toBeVisible();
    await expect(sign).toHaveText(`Agent ${OLD_AGENT_VERSION}`);
    await expect(sign).toHaveAttribute("data-agent-kind", "docker-swarm-agent");
    await expect(sign).toHaveAttribute("aria-haspopup", "dialog");
    await expect(page.getByTestId("agent-version-chip")).toHaveCount(0);

    await sign.hover();
    await expect(
      page.getByText(`A newer agent is available: ${AGENT_FILES_VERSION}`),
    ).toBeVisible();

    await screenshot(page, "docker-swarm-overview-agent-sign");
  });

  test("pressing the sign opens how to upgrade: the install script again, or the files again with Docker Compose", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const sign: Locator = page.getByRole("button", { name: OUTDATED_NAME });
    await sign.click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", {
        name: "Upgrade the OneUptime Docker Swarm Agent",
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        `This agent runs version ${OLD_AGENT_VERSION}. Version ${AGENT_FILES_VERSION} is available.`,
      ),
    ).toBeVisible();

    // The install script, run again on the manager node.
    await expect(
      dialog.getByText("Run the install script again"),
    ).toBeVisible();
    const command: Locator = dialog.locator("pre code");
    await expect(command).toHaveCount(1);
    await expect(command).toContainText("install.sh");

    // Or the agent's files again, then the containers recreated.
    await dialog.getByRole("tab", { name: "Docker Compose" }).click();
    await expect(command).toHaveCount(2);
    await expect(command.first()).toContainText("docker-compose.yml");
    await expect(command.nth(1)).toContainText("docker compose pull");
    await expect(command.nth(1)).toContainText(
      "docker compose up -d --force-recreate",
    );

    // Escape closes it, and the focus is back on the sign.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(sign).toBeFocused();
  });

  test("the files this release ships (0.161.1): the plain chip, no sign", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "agent=current");

    await expect(page.getByTestId("agent-version-chip")).toHaveText(
      `Agent ${AGENT_FILES_VERSION}`,
    );
    await expect(page.getByTestId("agent-version-outdated")).toHaveCount(0);
  });

  test("an agent that reports no version: no chip and no sign", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "agent=none");

    await expect(page.getByText("Docker 28.5.1")).toBeVisible();
    await expect(page.getByTestId("agent-version-chip")).toHaveCount(0);
    await expect(page.getByTestId("agent-version-outdated")).toHaveCount(0);
  });

  test("on a phone: the dialog fits the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page);

    await page.getByRole("button", { name: OUTDATED_NAME }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const box: Box = await boxOf(dialog);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 0.5);
    await expectNoSidewaysScroll(page);
  });

  test("in German: the sign and its dialog read in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=de");

    const germanName: string = GERMAN[
      "Agent {{version}} is outdated. A newer agent is available: {{latest}}. Show how to upgrade."
    ]!.replace("{{version}}", OLD_AGENT_VERSION).replace(
      "{{latest}}",
      AGENT_FILES_VERSION,
    );
    const sign: Locator = page.getByRole("button", { name: germanName });
    await expect(sign).toBeVisible();
    await sign.click();

    const dialog: Locator = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", {
        name: GERMAN["Upgrade the {{agentName}}"]!.replace(
          "{{agentName}}",
          "OneUptime Docker Swarm Agent",
        ),
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("tab", { name: GERMAN["Install script"]! }),
    ).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The Overview's hero on a phone
 * ---------------------------------------------------------------------------
 */
test.describe("the Overview's name on a phone", () => {
  async function heroParts(
    page: Page,
  ): Promise<{ name: Locator; refresh: Locator }> {
    const topRow: Locator = page.getByTestId("resource-hero-top-row");
    return {
      name: topRow.getByRole("heading", { name: CLUSTER_NAME }),
      refresh: topRow.getByRole("combobox", { name: "Auto-refresh" }),
    };
  }

  test("the cluster's whole name and description, the refresh control on a line under them", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [PHONE, TABLET]) {
      await page.setViewportSize(size);
      await openOverview(page);

      const { name, refresh } = await heroParts(page);
      await expect(name).toHaveText(CLUSTER_NAME);
      expect(await isCut(name)).toBe(false);

      const description: Locator = page
        .getByTestId("resource-hero-top-row")
        .getByText("The production swarm in Frankfurt.");
      expect(await isCut(description)).toBe(false);

      const nameBox: Box = await boxOf(name);
      const refreshBox: Box = await boxOf(refresh);
      expect(refreshBox.y).toBeGreaterThan(nameBox.y + nameBox.height);
      await expectNoSidewaysScroll(page);
    }

    await page.setViewportSize(PHONE);
    await screenshot(page, "docker-swarm-overview-phone");
  });

  test("at a laptop's width: the refresh control beside the name, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page);

    const { name, refresh } = await heroParts(page);
    const nameBox: Box = await boxOf(name);
    const refreshBox: Box = await boxOf(refresh);

    expect(refreshBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
    expect(refreshBox.y).toBeLessThan(nameBox.y + nameBox.height);
    await screenshot(page, "docker-swarm-overview-laptop");
  });

  test("dark, on a phone: the hero and its sign stay inside the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, "theme=dark");

    const sign: Locator = page.getByRole("button", { name: OUTDATED_NAME });
    const signBox: Box = await boxOf(sign);
    expect(signBox.x + signBox.width).toBeLessThanOrEqual(PHONE.width);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-overview-phone-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * #5298's UI review: where names break, where sparklines start, the hero's
 * description
 * ---------------------------------------------------------------------------
 */

// A hovered point's time, as the row writes it: "Oct 26 2026, 14:37 GMT".
const TIME_OF_DAY: RegExp = /\d{2}:\d{2}/;

// A task's image, exactly.
const TASK_IMAGE: RegExp =
  /^registry\.acme-swarm\.example\/shop\/checkout:2\.7\.0$/;

// A line that ends after one of a name's own separators.
const ENDS_AT_A_NAME_BREAK: RegExp = /[./]$/;

// The long description's last words, in the hover title.
const LONG_DESCRIPTION_END: RegExp = /nightly batch jobs\.$/;

// The text of each line an element's words are laid out on, in order.
async function linesOf(locator: Locator): Promise<Array<string>> {
  return await locator.evaluate((element: Element): Array<string> => {
    const lines: Array<{ top: number; text: string }> = [];
    const walker: TreeWalker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
    );
    let node: Node | null = walker.nextNode();

    while (node) {
      const text: string = node.textContent || "";

      for (let index: number = 0; index < text.length; index++) {
        const range: Range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect: DOMRect | undefined = range.getClientRects()[0];

        if (!rect || rect.width === 0) {
          continue;
        }

        const top: number = Math.round(rect.top);
        const last: { top: number; text: string } | undefined =
          lines[lines.length - 1];

        if (last && Math.abs(last.top - top) < 4) {
          last.text += text.charAt(index);
        } else {
          lines.push({ top, text: text.charAt(index) });
        }
      }

      node = walker.nextNode();
    }

    return lines.map((line: { top: number; text: string }): string => {
      return line.text.trim();
    });
  });
}

async function lineHeightOf(locator: Locator): Promise<number> {
  return await locator.evaluate((element: Element): number => {
    return parseFloat(getComputedStyle(element).lineHeight);
  });
}

test.describe("the Metrics tab: names break after their dots, sparklines line up", () => {
  test("on a phone, a long name breaks after its own dots, never inside a word", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openMetricsPage(page);

    const name: Locator = page
      .getByTestId("metric-row-name")
      .filter({ hasText: "container.blockio.io_service_bytes_recursive" });

    // Read and found as written: a <wbr> adds no character.
    await expect(name).toHaveText(
      "container.blockio.io_service_bytes_recursive",
    );
    expect(await linesOf(name)).toEqual([
      "container.blockio.",
      "io_service_bytes_recursive",
    ]);

    // Every name: a line that is not its last ends after a dot.
    const names: Locator = page.getByTestId("metric-row-name");
    for (let index: number = 0; index < METRIC_NAMES.length; index++) {
      const lines: Array<string> = await linesOf(names.nth(index));
      for (const line of lines.slice(0, -1)) {
        expect({ line, endsAfterADot: line.endsWith(".") }).toEqual({
          line,
          endsAfterADot: true,
        });
      }
    }
  });

  test("stacked, on a phone and beside the side menu: every sparkline starts at the row's start, every value at one place after it", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [PHONE, TABLET]) {
      await page.setViewportSize(size);
      await openMetricsPage(page);

      const rows: Locator = page.getByTestId("metric-row");
      const sparklineLefts: Array<number> = [];
      const valueLefts: Array<number> = [];

      for (let index: number = 0; index < METRIC_NAMES.length; index++) {
        const row: Locator = rows.nth(index);
        const name: Box = await boxOf(row.getByTestId("metric-row-name"));
        const sparkline: Box = await boxOf(
          row.getByTestId("metric-row-sparkline"),
        );
        const value: Box = await boxOf(
          row.getByTestId("metric-row-value-text"),
        );

        // The sparkline first, where the name starts; the value after it.
        expect(Math.abs(sparkline.x - name.x)).toBeLessThanOrEqual(1);
        expect(value.x).toBeGreaterThanOrEqual(sparkline.x + sparkline.width);
        // On the sparkline's line, under the name.
        expect(sparkline.y).toBeGreaterThanOrEqual(name.y + name.height);
        expect(value.y).toBeLessThan(sparkline.y + sparkline.height);

        sparklineLefts.push(Math.round(sparkline.x));
        valueLefts.push(Math.round(value.x));
      }

      // "3.40%" and "12.5 MB" move nothing: one place for all of them.
      expect(new Set(sparklineLefts).size).toBe(1);
      expect(new Set(valueLefts).size).toBe(1);
      await expectNoSidewaysScroll(page);
    }

    await page.setViewportSize(PHONE);
    await screenshot(page, "docker-swarm-metrics-sparklines-phone");
  });

  test("beside the side menu, hovering a point shows its value and time beside the sparkline, which stays under the pointer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(TABLET);
    await openMetricsPage(page);

    const row: Locator = page.getByTestId("metric-row").first();
    const sparkline: Locator = row.getByTestId("metric-row-sparkline");
    const valueText: Locator = row.getByTestId("metric-row-value-text");
    const before: Box = await boxOf(sparkline);
    const newestValue: string = (await valueText.innerText()).trim();

    /*
     * Near its start too, where the old row's widened number pushed the
     * sparkline out from under the pointer and it flickered.
     */
    for (const offset of [4, 40, before.width / 2, before.width - 4]) {
      await page.mouse.move(before.x + offset, before.y + before.height / 2);
      await expect(valueText).toContainText(TIME_OF_DAY);

      const during: Box = await boxOf(sparkline);
      expect(during.x).toBe(before.x);
      expect(during.y).toBe(before.y);
    }

    // Still the point's, a moment later: nothing moved, nothing left.
    await page.waitForTimeout(300);
    await expect(valueText).toContainText(TIME_OF_DAY);
    await screenshot(page, "docker-swarm-metrics-hover-768");

    // Leaving it, the row's newest value again.
    await page.mouse.move(0, 0);
    await expect(valueText).toHaveText(newestValue);
  });

  test("at a laptop's width, side by side: the value before its sparkline, every sparkline at the row's end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openMetricsPage(page);

    const rows: Locator = page.getByTestId("metric-row");
    const sparklineLefts: Array<number> = [];

    for (let index: number = 0; index < METRIC_NAMES.length; index++) {
      const row: Locator = rows.nth(index);
      const sparkline: Box = await boxOf(
        row.getByTestId("metric-row-sparkline"),
      );
      const value: Box = await boxOf(row.getByTestId("metric-row-value-text"));

      expect(value.x + value.width).toBeLessThanOrEqual(sparkline.x + 0.5);
      sparklineLefts.push(Math.round(sparkline.x));
    }

    expect(new Set(sparklineLefts).size).toBe(1);

    // Hovering here widens the value to the left, away from the sparkline.
    const first: Locator = rows.first().getByTestId("metric-row-sparkline");
    const before: Box = await boxOf(first);
    await page.mouse.move(before.x + 4, before.y + before.height / 2);
    await expect(
      rows.first().getByTestId("metric-row-value-text"),
    ).toContainText(TIME_OF_DAY);
    expect((await boxOf(first)).x).toBe(before.x);
  });
});

test.describe("a task's image breaks after its own dots and slashes", () => {
  test("on a phone: never inside its version, and read as written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openTaskPage(page);

    const image: Locator = page.getByTestId("info-card-value").filter({
      hasText: TASK_IMAGE,
    });
    await expect(image).toHaveText(
      "registry.acme-swarm.example/shop/checkout:2.7.0",
    );

    const lines: Array<string> = await linesOf(image);
    expect(lines.length).toBeGreaterThan(1);
    // Every line but the last ends after one of the name's own dots or slashes.
    for (const line of lines.slice(0, -1)) {
      expect({ line, endsAtABreak: ENDS_AT_A_NAME_BREAK.test(line) }).toEqual({
        line,
        endsAtABreak: true,
      });
    }
    // The version whole, on the last line.
    expect(lines[lines.length - 1]).toContain("checkout:2.7.0");

    // The task's id after its kind.
    const externalId: Locator = page
      .getByTestId("info-card-value")
      .filter({ hasText: "task/x7k2m9p4q1r8s5t3v6w0y2z4a" });
    for (const line of (await linesOf(externalId)).slice(0, -1)) {
      expect(line.endsWith("/")).toBe(true);
    }

    await screenshot(page, "docker-swarm-task-image-phone");
  });
});

test.describe("the Overview hero's description", () => {
  async function heroParts(page: Page): Promise<{
    topRow: Locator;
    name: Locator;
    description: Locator;
    controls: Locator;
  }> {
    const topRow: Locator = page.getByTestId("resource-hero-top-row");
    return {
      topRow,
      name: topRow.getByRole("heading", { name: CLUSTER_NAME }),
      description: topRow.getByTestId("resource-hero-description"),
      controls: topRow.getByTestId("resource-hero-controls"),
    };
  }

  test("a long one, at a laptop's width: two lines beside the refresh control, which stays beside the name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "description=long");

    const { name, description, controls } = await heroParts(page);
    await expect(description).toContainText(
      "The production swarm in Frankfurt:",
    );

    const nameBox: Box = await boxOf(name);
    const controlsBox: Box = await boxOf(controls);
    const descriptionBox: Box = await boxOf(description);

    // Beside the name, on its line - not pushed under it by the description.
    expect(controlsBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
    expect(controlsBox.y).toBeLessThan(nameBox.y + nameBox.height);
    // Two lines at most, the rest on hover.
    expect(descriptionBox.height).toBeLessThanOrEqual(
      2 * (await lineHeightOf(description)) + 1,
    );
    expect(descriptionBox.x + descriptionBox.width).toBeLessThanOrEqual(
      controlsBox.x,
    );
    await expect(description).toHaveAttribute("title", LONG_DESCRIPTION_END);

    await screenshot(page, "docker-swarm-overview-long-description-laptop");
  });

  test("beside the side menu, the controls under it at the row's end; on a phone, two lines under the name", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1024, TABLET.width]) {
      await page.setViewportSize({ width, height: 900 });
      await openOverview(page, "description=long");

      const { topRow, name, description, controls } = await heroParts(page);
      const rowBox: Box = await boxOf(topRow);
      const controlsBox: Box = await boxOf(controls);
      const descriptionBox: Box = await boxOf(description);

      expect(controlsBox.y).toBeGreaterThanOrEqual(
        descriptionBox.y + descriptionBox.height,
      );
      // At the row's end, as a card's header keeps its buttons.
      const refresh: Box = await boxOf(
        controls.getByRole("combobox", { name: "Auto-refresh" }),
      );
      expect(
        rowBox.x + rowBox.width - (refresh.x + refresh.width),
      ).toBeLessThanOrEqual(1);
      expect(await isCut(name)).toBe(false);
      await expectNoSidewaysScroll(page);
    }

    await page.setViewportSize(PHONE);
    await openOverview(page, "description=long");
    const { description } = await heroParts(page);
    const box: Box = await boxOf(description);
    expect(box.height).toBeLessThanOrEqual(
      2 * (await lineHeightOf(description)) + 1,
    );
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-overview-long-description-phone");
  });

  test("right to left, beside the side menu: the controls at the row's other end, an English description in its own order, aligned as the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(TABLET);
    await openOverview(page, "dir=rtl");

    const { topRow, controls, description } = await heroParts(page);
    const rowBox: Box = await boxOf(topRow);
    const refresh: Box = await boxOf(
      controls.getByRole("button", { name: "Refresh" }),
    );
    const select: Box = await boxOf(
      controls.getByRole("combobox", { name: "Auto-refresh" }),
    );

    // The row's end is its left: the controls run to it, as they run right.
    expect(Math.min(refresh.x, select.x) - rowBox.x).toBeLessThanOrEqual(1);

    expect(
      await description.evaluate((element: Element): string => {
        return getComputedStyle(element).direction;
      }),
    ).toBe("ltr");
    expect(
      await description.evaluate((element: Element): string => {
        return getComputedStyle(element).textAlign;
      }),
    ).toBe("right");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-overview-rtl-768");
  });
});
