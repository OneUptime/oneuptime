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
 * (0.161.3) and no version at all, the sign's dialog with both ways to
 * upgrade; the Overview's own name on a phone; dark and German. The fixture
 * records every read, so the tests check that nothing it does not model was
 * asked for.
 *
 * And what the swarm's rules say (DockerSwarmHealth), on a swarm in trouble
 * (?swarm=trouble): the Overview's health and Needs attention, the Nodes,
 * Services and Tasks lists, and a node's, a service's and a task's own page
 * - at a phone's width and a laptop's, dark, German and Persian.
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
const AGENT_FILES_VERSION: string = "0.161.3";
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

// And the Persian ones, as the fixture draws them with ?lang=fa.
const PERSIAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/fa.json",
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
// A row of the task's Details card, and the value under its name.
function taskDetail(page: Page, key: string): Locator {
  return page.getByTestId(`docker-swarm-task-details-${key}`);
}

function taskDetailValue(page: Page, key: string): Locator {
  return taskDetail(page, key).locator("dd > div").first();
}

async function openTaskPage(page: Page, query: string = ""): Promise<void> {
  await page.goto(withQuery(TASK_PAGE, query));
  await expect(taskDetailValue(page, "container-id")).toHaveText(CONTAINER_ID);
}

// Every Details row, and its value, inside the window and the card.
async function expectCardsInside(page: Page, width: number): Promise<void> {
  const card: Locator = page.getByTestId("docker-swarm-task-details");
  const cardBox: Box = await boxOf(card);
  expect(cardBox.x).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width + 0.5);

  const values: Locator = card.locator("dd > div");
  const count: number = await values.count();
  expect(count).toBeGreaterThan(6);

  for (let index: number = 0; index < count; index++) {
    const value: Locator = values.nth(index);
    const valueBox: Box = await boxOf(value);

    expect(valueBox.x).toBeGreaterThanOrEqual(cardBox.x - 0.5);
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

    const value: Locator = taskDetailValue(page, "container-id");
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

    const service: Locator = taskDetailValue(page, "service");
    await expect(service).toHaveText("shop_checkout");
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

    await expect(taskDetail(page, "container-id").locator("dt")).toContainText(
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
/*
 * The hero's chips: the agent's version is there, and again in the Cluster
 * Details card under Agent Version, as on every resource's Overview.
 */
function heroChips(page: Page): Locator {
  return page.getByTestId("docker-swarm-hero-chips");
}

async function openOverview(page: Page, query: string = ""): Promise<void> {
  await page.goto(withQuery(CLUSTER_PATH, query));
  await expect(page.getByTestId("resource-hero-top-row")).toBeVisible();

  // The Overview has drawn its counts and its nodes from the inventory.
  await expect(page.getByTestId("docker-swarm-hero-nodes")).toBeVisible();
  await expect(page.getByTestId("docker-swarm-nodes-card")).toBeVisible();
}

test.describe("the Swarm agent's version on the Overview", () => {
  test("files before the CPU fix (0.161.0): the chip carries the sign, which explains itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const sign: Locator = heroChips(page).getByRole("button", {
      name: OUTDATED_NAME,
    });
    await expect(sign).toBeVisible();
    await expect(sign).toHaveText(`Agent ${OLD_AGENT_VERSION}`);
    await expect(sign).toHaveAttribute("data-agent-kind", "docker-swarm-agent");
    await expect(sign).toHaveAttribute("aria-haspopup", "dialog");
    await expect(heroChips(page).getByTestId("agent-version-chip")).toHaveCount(
      0,
    );

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

    const sign: Locator = heroChips(page).getByRole("button", {
      name: OUTDATED_NAME,
    });
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

  test("the files this release ships (0.161.3): the plain chip, no sign", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "agent=current");

    await expect(heroChips(page).getByTestId("agent-version-chip")).toHaveText(
      `Agent ${AGENT_FILES_VERSION}`,
    );
    await expect(
      heroChips(page).getByTestId("agent-version-outdated"),
    ).toHaveCount(0);
  });

  test("an agent that reports no version: no chip and no sign", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "agent=none");

    await expect(page.getByText("Docker 28.5.1")).toBeVisible();
    await expect(heroChips(page).getByTestId("agent-version-chip")).toHaveCount(
      0,
    );
    await expect(
      heroChips(page).getByTestId("agent-version-outdated"),
    ).toHaveCount(0);
  });

  test("on a phone: the dialog fits the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page);

    await heroChips(page).getByRole("button", { name: OUTDATED_NAME }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const box: Box = await boxOf(dialog);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 0.5);
    await expectNoSidewaysScroll(page);
  });

  /*
   * On a phone the command wraps, a line at a time: the rest of a line that
   * wraps starts past the line's own start (a hanging indent), never at the
   * left edge where it read as a command of its own ("install.sh" alone on
   * a line). And what a reader selects to copy by hand is the command as
   * written: one line break between its lines, none where a line wrapped.
   */
  test("on a phone: a wrapped line goes on under its own start, and copies by hand as written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page);

    await heroChips(page).getByRole("button", { name: OUTDATED_NAME }).click();
    const dialog: Locator = page.getByRole("dialog");
    const code: Locator = dialog.locator("pre code");
    await expect(code).toHaveCount(1);

    const lines: Locator = code.locator(":scope > span");
    await expect(lines).toHaveCount(2);

    // Where each row of the download's line starts, top to bottom.
    const rowStarts: Array<number> = await lines
      .first()
      .evaluate((element: Element): Array<number> => {
        const range: Range = document.createRange();
        range.selectNodeContents(element);
        const starts: Map<number, number> = new Map();

        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width === 0) {
            continue;
          }
          const top: number = Math.round(rect.top);
          starts.set(top, Math.min(starts.get(top) ?? Infinity, rect.left));
        }

        return Array.from(starts.entries())
          .sort((a: [number, number], b: [number, number]): number => {
            return a[0] - b[0];
          })
          .map((entry: [number, number]): number => {
            return entry[1];
          });
      });

    expect(rowStarts.length).toBeGreaterThan(1);
    for (const start of rowStarts.slice(1)) {
      expect(start).toBeGreaterThan(rowStarts[0]! + 8);
    }

    // The next line, the one that runs the script, starts where the first did.
    const runStart: number = (await boxOf(lines.nth(1))).x;
    expect(Math.abs(runStart - rowStarts[0]!)).toBeLessThan(1);

    const copied: { selected: string; written: string } = await code.evaluate(
      (element: Element): { selected: string; written: string } => {
        const range: Range = document.createRange();
        range.selectNodeContents(element);
        const selection: Selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        return {
          selected: selection.toString(),
          written: element.textContent || "",
        };
      },
    );

    expect(copied.selected).toBe(copied.written);
    expect(copied.written.split("\n")).toHaveLength(2);
    expect(copied.written).toContain(
      "/install/docker-swarm-agent -o install.sh\n",
    );
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
    const sign: Locator = heroChips(page).getByRole("button", {
      name: germanName,
    });
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
 * The Overview's pills, in the page's language (#5298's UI review: nine
 * heroes wrote them in English on every page)
 * ---------------------------------------------------------------------------
 */
test.describe("the Overview's pills", () => {
  function identityOf(page: Page): Locator {
    return page.getByTestId("resource-hero-identity");
  }

  async function openSwarm(page: Page, query: string): Promise<void> {
    await page.goto(withQuery(CLUSTER_PATH, query));
    await expect(page.getByTestId("resource-hero-top-row")).toBeVisible();
  }

  test("in German: Verbunden and Fehlerfrei, never the English words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=de");
    const identity: Locator = identityOf(page);

    await expect(
      identity.getByText(GERMAN["Connected"]!, { exact: true }),
    ).toBeVisible();
    await expect(
      identity.getByText(GERMAN["Healthy"]!, { exact: true }),
    ).toBeVisible();
    expect(GERMAN["Connected"]).toBe("Verbunden");
    expect(GERMAN["Healthy"]).toBe("Fehlerfrei");

    for (const english of ["Connected", "Healthy"]) {
      await expect(identity.getByText(english, { exact: true })).toHaveCount(0);
    }
  });

  test("an agent that stopped reporting: Disconnected and Health Unknown - never the stale health, never a bare Unknown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSwarm(page, "collector=disconnected");
    const identity: Locator = identityOf(page);

    await expect(
      identity.getByText("Disconnected", { exact: true }),
    ).toBeVisible();
    await expect(
      identity.getByText("Health Unknown", { exact: true }),
    ).toBeVisible();
    for (const word of ["Connected", "Healthy", "Unknown"]) {
      await expect(identity.getByText(word, { exact: true })).toHaveCount(0);
    }

    // The connection pill first, then what it says about the health.
    const connection: Box = await boxOf(
      identity.getByText("Disconnected", { exact: true }),
    );
    const health: Box = await boxOf(
      identity.getByText("Health Unknown", { exact: true }),
    );
    expect(connection.x).toBeLessThan(health.x);
  });

  test("the same, in German and dark, on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openSwarm(page, "collector=disconnected&lang=de&theme=dark");
    const identity: Locator = identityOf(page);

    await expect(
      identity.getByText(GERMAN["Disconnected"]!, { exact: true }),
    ).toBeVisible();
    await expect(
      identity.getByText(GERMAN["Health Unknown"]!, { exact: true }),
    ).toBeVisible();
    expect(GERMAN["Disconnected"]).toBe("Getrennt");
    expect(GERMAN["Health Unknown"]).toBe("Integrität unbekannt");

    for (const english of ["Disconnected", "Health Unknown", "Unknown"]) {
      await expect(identity.getByText(english, { exact: true })).toHaveCount(0);
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, "overview-pills-disconnected-de-dark-phone");
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

    const sign: Locator = heroChips(page).getByRole("button", {
      name: OUTDATED_NAME,
    });
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

// The long description's last word, which Show more brings into view.
const LONG_DESCRIPTION_END: RegExp = /jobs\.$/;

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

/*
 * A description longer than its two lines ends in "Show more", under its
 * words and starting where they do; it opens all of it, the last words in
 * view, and "Show less" closes it again (#5298's UI review: the rest was in a
 * hover title, which a phone, a tablet and a keyboard never show).
 */
async function expectShowMoreOpensAll(
  page: Page,
  description: Locator,
): Promise<void> {
  const toggle: Locator = page.getByTestId("resource-hero-description-toggle");
  const lineHeight: number = await lineHeightOf(description);

  await expect(toggle).toHaveText("Show more");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const closed: Box = await boxOf(description);
  expect(closed.height).toBeLessThanOrEqual(2 * lineHeight + 1);
  const toggleBox: Box = await boxOf(toggle);
  expect(toggleBox.y).toBeGreaterThanOrEqual(closed.y + closed.height - 0.5);
  // Its padding pulled back by as much: its words start where the text does.
  expect(Math.abs(toggleBox.x + 6 - closed.x)).toBeLessThanOrEqual(1);

  // The keyboard opens it as a click does.
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveText("Show less");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const opened: Box = await boxOf(description);
  expect(opened.height).toBeGreaterThan(2 * lineHeight + 1);
  const lines: Array<string> = await linesOf(description);
  expect(lines[lines.length - 1]).toMatch(LONG_DESCRIPTION_END);
  expect(
    await description.evaluate((element: Element): boolean => {
      return element.scrollHeight <= element.clientHeight + 1;
    }),
  ).toBe(true);

  await toggle.click();
  await expect(toggle).toHaveText("Show more");
  expect((await boxOf(description)).height).toBeLessThanOrEqual(
    2 * lineHeight + 1,
  );
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

    const image: Locator = taskDetailValue(page, "image");
    await expect(image).toContainText(TASK_IMAGE);
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

    // The task's id, whole: Docker's 25 letters fit a phone's line.
    await expect(taskDetailValue(page, "id")).toHaveText(
      "x7k2m9p4q1r8s5t3v6w0y2z4a",
    );
    expect(await linesOf(taskDetailValue(page, "id"))).toHaveLength(1);

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
    // Two lines, and Show more for the rest.
    expect(descriptionBox.height).toBeLessThanOrEqual(
      2 * (await lineHeightOf(description)) + 1,
    );
    expect(descriptionBox.x + descriptionBox.width).toBeLessThanOrEqual(
      controlsBox.x,
    );
    // Never in a hover title only, which a tablet or a keyboard never shows.
    await expect(description).not.toHaveAttribute("title");
    await screenshot(page, "docker-swarm-overview-long-description-laptop");

    // Show more opens all of it, where the refresh control stays put.
    await expectShowMoreOpensAll(page, description);
    const openedControls: Box = await boxOf(controls);
    expect(openedControls.x).toBe(controlsBox.x);
    expect(openedControls.y).toBe(controlsBox.y);
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

    // A phone has no hover: Show more is how the rest is read.
    await expectShowMoreOpensAll(page, description);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-overview-long-description-phone-open");
  });

  test("a short one has no Show more, at a phone's width or a laptop's", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [PHONE, LAPTOP]) {
      await page.setViewportSize(size);
      await openOverview(page);

      const { topRow, description } = await heroParts(page);
      await expect(description).toHaveText(
        "The production swarm in Frankfurt.",
      );
      await expect(
        topRow.getByTestId("resource-hero-description-toggle"),
      ).toHaveCount(0);
    }
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

/*
 * ---------------------------------------------------------------------------
 * The Swarm's side menu on a task's page
 * ---------------------------------------------------------------------------
 *
 * A task's page is one of the rows Tasks lists, and the menu has an entry
 * for the list only: nothing in it was lit there, and a phone's menu button
 * read the trail's last crumb, "Task Detail". The shared side menu now
 * lights the list a page is one row of (Common's SideMenuRowPage), as a
 * Kubernetes cluster's menu did by hand.
 */
test.describe("the Swarm's side menu on a task's page", () => {
  test("Tasks is lit: the one current entry, holding the page and leading to the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTaskPage(page);

    const current: Locator = page.locator(
      "aside[role='navigation'] a[aria-current]",
    );
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("aria-current", "true");
    await expect(current.getByTestId("side-menu-item-title")).toHaveText(
      "Tasks",
    );
    await expect(current).toHaveAttribute("href", `${CLUSTER_PATH}/tasks`);
  });

  test("on a phone, the menu's button names Workloads / Tasks, in German too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openTaskPage(page);

    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await expect(toggle).toContainText("Workloads / Tasks");
    await expect(toggle).not.toContainText("Task Detail");

    await openTaskPage(page, "lang=de");
    await expect(toggle).toContainText(
      `${GERMAN["Workloads"]!} / ${GERMAN["Tasks"]!}`,
    );
    await screenshot(page, "docker-swarm-task-phone-menu-button-de");
  });
});

/*
 * ---------------------------------------------------------------------------
 * What a swarm in trouble needs, by the swarm's rules (?swarm=trouble)
 * ---------------------------------------------------------------------------
 *
 * A worker the managers lost (swarm-worker-02, Down, with Swarm's message),
 * shop_web short of the replica that ran there (1 of 2), shop_search
 * crash-looping while it reads full (four failed tasks in the hour), and
 * shop_checkout.2 at 92% of its memory limit. The Overview, the lists and
 * each part's page say the same, in Docker's words.
 */
const TROUBLE: string = "swarm=trouble";

const NODE_PAGE: string = `${CLUSTER_PATH}/nodes/${encodeURIComponent("node/n3")}`;
const SERVICE_PAGE: string = `${CLUSTER_PATH}/services/${encodeURIComponent(
  "service/s2",
)}`;
const HOT_TASK_PAGE: string = `${CLUSTER_PATH}/tasks/${encodeURIComponent(
  "task/b3c4d5e6f7a8b9c0d1e2f3a4b",
)}`;

async function attentionKeys(
  page: Page,
  testId: string,
): Promise<Array<string | null>> {
  return await page
    .getByTestId(`${testId}-item`)
    .evaluateAll((items: Array<Element>): Array<string | null> => {
      return items.map((item: Element): string | null => {
        return item.getAttribute("data-key");
      });
    });
}

// The row of a list whose name is `name`.
function listRow(page: Page, name: string): Locator {
  return page.locator("tr").filter({ hasText: name }).first();
}

test.describe("the Overview of a swarm in trouble", () => {
  test("at a laptop's width: Unhealthy, and Needs attention says what and why, critical first, each one step from its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, TROUBLE);

    const health: Locator = page.getByTestId("docker-swarm-hero-health");
    await expect(health).toHaveAttribute("data-health", "Unhealthy");
    await expect(health).toHaveText("Unhealthy");

    const card: Locator = page.getByTestId("docker-swarm-needs-attention");
    await expect(card).toBeVisible();
    expect(await attentionKeys(page, "docker-swarm-needs-attention")).toEqual([
      "Node:node/n3",
      "Service:service/s3",
      "Service:service/s2",
    ]);
    await expect(
      page.getByTestId("docker-swarm-needs-attention-summary"),
    ).toHaveText(/1 critical\s*2 to look at/);

    const items: Locator = page.getByTestId(
      "docker-swarm-needs-attention-item",
    );
    await expect(items.nth(0)).toHaveAttribute("data-severity", "critical");
    await expect(items.nth(0)).toContainText("swarm-worker-02");
    await expect(items.nth(0)).toContainText("Down");
    await expect(items.nth(0)).toContainText(
      'heartbeat failure for node in "unknown" state',
    );
    await expect(items.nth(1)).toContainText("shop_search");
    await expect(items.nth(1)).toContainText("4 failed tasks in the last hour");
    await expect(items.nth(1)).toContainText("task: non-zero exit (137)");
    await expect(items.nth(2)).toContainText("shop_web");
    await expect(items.nth(2)).toContainText("1 of 2 replicas run");

    // Each row opens its part's page.
    await expect(items.nth(0).locator("a").first()).toHaveAttribute(
      "href",
      NODE_PAGE,
    );
    await expect(items.nth(2).locator("a").first()).toHaveAttribute(
      "href",
      SERVICE_PAGE,
    );

    // Each node at a glance: the one in trouble first, in red.
    const nodes: Locator = page.getByTestId("docker-swarm-nodes-card-name");
    await expect(nodes.first()).toHaveText("swarm-worker-02");
    await expect(
      page.getByTestId("docker-swarm-nodes-card-status").first(),
    ).toHaveText("Down");

    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-overview-trouble-laptop");
  });

  test("on a phone: every reason inside the page, the card under the hero", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, TROUBLE);

    const card: Locator = page.getByTestId("docker-swarm-needs-attention");
    const cardBox: Box = await boxOf(card);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(PHONE.width + 0.5);
    for (const reason of await page
      .getByTestId("docker-swarm-needs-attention-reason")
      .all()) {
      const box: Box = await boxOf(reason);
      expect(box.x + box.width).toBeLessThanOrEqual(
        cardBox.x + cardBox.width + 0.5,
      );
    }
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-overview-trouble-phone");
  });

  test("dark and German, on a phone: the card and its reasons read in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, `${TROUBLE}&theme=dark&lang=de`);

    const card: Locator = page.getByTestId("docker-swarm-needs-attention");
    await expect(card).toContainText(GERMAN["Needs attention"]!);
    await expect(card).toContainText(GERMAN["Down"]!);
    await expect(card).toContainText(
      GERMAN["{{running}} of {{desired}} replicas run"]!.replace(
        "{{running}}",
        "1",
      ).replace("{{desired}}", "2"),
    );
    await expect(card).not.toContainText("replicas run");
    await expect(page.getByTestId("docker-swarm-hero-health")).toHaveText(
      GERMAN["Unhealthy"]!,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-overview-trouble-phone-dark-de");
  });

  test("in Persian, right to left: the card reads in Persian and stays inside the page, at a phone's width and a laptop's", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [PHONE, LAPTOP]) {
      await page.setViewportSize(size);
      await openOverview(page, `${TROUBLE}&lang=fa`);

      expect(
        await page.evaluate((): string => {
          return document.documentElement.dir;
        }),
      ).toBe("rtl");
      const card: Locator = page.getByTestId("docker-swarm-needs-attention");
      await expect(card).toContainText(PERSIAN["Needs attention"]!);
      await expect(card).toContainText(PERSIAN["Down"]!);
      // Docker's own words stay as Docker wrote them.
      await expect(card).toContainText("task: non-zero exit (137)");
      await expectNoSidewaysScroll(page);
    }
    await screenshot(page, "docker-swarm-overview-trouble-laptop-fa");
  });
});

test.describe("the lists say what the Overview says", () => {
  test("Nodes, Services and Tasks: each row's state by the swarm's rules, with why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(withQuery(`${CLUSTER_PATH}/nodes`, TROUBLE));
    const down: Locator = listRow(page, "swarm-worker-02");
    await expect(down.locator("[data-tone]").first()).toHaveAttribute(
      "data-tone",
      "danger",
    );
    await expect(down).toContainText("Down");
    await expect(listRow(page, "swarm-manager-01")).toContainText("Leader");

    await page.goto(withQuery(`${CLUSTER_PATH}/services`, TROUBLE));
    const web: Locator = listRow(page, "shop_web");
    await expect(web).toContainText("1 of 2 running");
    await expect(web.locator("[data-tone]").first()).toHaveAttribute(
      "data-tone",
      "warning",
    );
    const search: Locator = listRow(page, "shop_search");
    await expect(search).toContainText("1 of 1 running");
    await expect(search.getByTestId("resource-status-reason")).toHaveText(
      "4 failed tasks in the last hour",
    );

    await page.goto(withQuery(`${CLUSTER_PATH}/tasks`, TROUBLE));
    const hot: Locator = listRow(page, "shop_checkout.2");
    await expect(hot.getByTestId("resource-status-reason")).toHaveText(
      "Memory at 92% of its limit",
    );
    await expect(hot.getByTestId("resource-memory-bar")).toHaveClass(
      /bg-amber|bg-yellow|bg-orange/,
    );
    await expect(listRow(page, "shop_web.2")).toContainText("Failed");
    await screenshot(page, "docker-swarm-tasks-trouble-laptop");
  });

  test("on a phone, and in Persian: the lists stay inside the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    for (const [list, name] of [
      ["nodes", "swarm-worker-02"],
      ["services", "shop_search"],
      ["tasks", "shop_checkout.2"],
    ]) {
      await page.goto(withQuery(`${CLUSTER_PATH}/${list}`, TROUBLE));
      await expect(
        page.getByText(name!, { exact: true }).first(),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
    await page.goto(
      withQuery(`${CLUSTER_PATH}/services`, `${TROUBLE}&lang=fa`),
    );
    // On a phone each row is a card: shop_web's reads 1 of 2, in Persian digits.
    await expect(
      page
        .getByText(
          PERSIAN["{{running}} of {{desired}} running"]!.replace(
            "{{running}}",
            "۱",
          ).replace("{{desired}}", "۲"),
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-services-trouble-phone-fa");
  });
});

test.describe("a service's page", () => {
  test("short of a replica: its state in amber, the task that failed with Docker's error, what is open on it and its alerts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(withQuery(SERVICE_PAGE, TROUBLE));
    await expect(
      page.getByTestId("docker-swarm-service-overview"),
    ).toBeVisible();

    const status: Locator = page.getByTestId(
      "docker-swarm-service-hero-status",
    );
    await expect(status).toHaveText(/^1 of 2 running/);
    await expect(status).toHaveAttribute("data-tone", "warning");
    await expect(
      page.getByTestId("docker-swarm-service-hero-location"),
    ).toHaveText(
      "Service of stack shop in swarm prod".replace("prod", CLUSTER_NAME),
    );

    expect(await attentionKeys(page, "docker-swarm-service-attention")).toEqual(
      ["Service:service/s2", "Task:task/e6f7a8b9c0d1e2f3a4b5c6d7e"],
    );
    await expect(
      page.getByTestId("docker-swarm-service-attention"),
    ).toContainText("This service");

    // Its tasks, each with the node it runs on.
    const overview: Locator = page.getByTestId("docker-swarm-service-overview");
    await expect(listRow(page, "shop_web.2")).toContainText("swarm-worker-02");
    await expect(listRow(page, "shop_web.1")).toContainText("swarm-worker-01");

    // The replicas alert that is open on it.
    await expect(page.getByTestId("docker-swarm-service-open")).toContainText(
      "[Docker Swarm] Service Replicas Mismatch - swarm-prod",
    );

    // Its alerts, none on yet: one step turns them on, all five ticked.
    const turnOn: Locator = page.getByTestId(
      "docker-swarm-service-alerts-turn-on",
    );
    await expect(turnOn).toHaveText(/Turn on 5 alerts/);
    const href: string = (await turnOn.getAttribute("href")) || "";
    const url: URL = new URL(href, "http://127.0.0.1");
    expect(url.pathname).toBe(`${CLUSTER_PATH}/recommendations`);
    expect((url.searchParams.get("select") || "").split(",")).toEqual([
      "DockerSwarm:docker-swarm-service-replicas-mismatch",
      "DockerSwarm:docker-swarm-task-down",
      "DockerSwarm:docker-swarm-high-memory",
      "DockerSwarm:docker-swarm-high-cpu",
      "DockerSwarm:docker-swarm-high-pids",
    ]);
    await expect(overview).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-service-trouble-laptop");
  });

  test("dark, on a phone, and in German: inside the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto(withQuery(SERVICE_PAGE, `${TROUBLE}&theme=dark&lang=de`));
    await expect(
      page.getByTestId("docker-swarm-service-overview"),
    ).toBeVisible();
    await expect(
      page.getByTestId("docker-swarm-service-attention"),
    ).toContainText(GERMAN["This service"]!);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-service-trouble-phone-dark-de");
  });
});

test.describe("a node's page", () => {
  test("a worker the managers lost: Down in red, Swarm's message, its tasks, and the node alert to turn on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(withQuery(NODE_PAGE, TROUBLE));
    await expect(page.getByTestId("docker-swarm-node-overview")).toBeVisible();

    const status: Locator = page.getByTestId("docker-swarm-node-hero-status");
    await expect(status).toHaveText(/^Down/);
    await expect(status).toHaveAttribute("data-tone", "danger");
    await expect(
      page.getByTestId("docker-swarm-node-hero-chips"),
    ).toContainText("4 CPUs");
    expect(await attentionKeys(page, "docker-swarm-node-attention")).toEqual([
      "Node:node/n3",
      "Task:task/e6f7a8b9c0d1e2f3a4b5c6d7e",
    ]);
    await expect(page.getByTestId("docker-swarm-node-attention")).toContainText(
      'heartbeat failure for node in "unknown" state',
    );
    await expect(listRow(page, "shop_web.2")).toContainText("Failed");
    await expect(
      page.getByTestId("docker-swarm-node-alerts-turn-on"),
    ).toHaveText(/Turn on 1 alert/);
    await expect(page.getByTestId("docker-swarm-node-alerts")).toContainText(
      "Node Not Ready",
    );
    await screenshot(page, "docker-swarm-node-trouble-laptop");
  });

  test("in Persian, on a phone: right to left and inside the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto(withQuery(NODE_PAGE, `${TROUBLE}&lang=fa`));
    await expect(page.getByTestId("docker-swarm-node-overview")).toBeVisible();
    await expect(page.getByTestId("docker-swarm-node-hero-status")).toHaveText(
      new RegExp(`^${PERSIAN["Down"]!}`),
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-node-trouble-phone-fa");
  });
});

test.describe("a task near its memory limit", () => {
  test("amber, with how close, on its page and its tile", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(withQuery(HOT_TASK_PAGE, TROUBLE));
    await expect(page.getByTestId("docker-swarm-task-overview")).toBeVisible();

    const status: Locator = page.getByTestId("docker-swarm-task-hero-status");
    await expect(status).toHaveText(/^Running/);
    await expect(status).toHaveAttribute("data-tone", "warning");
    await expect(page.getByTestId("docker-swarm-task-attention")).toContainText(
      "Memory at 92% of its limit",
    );
    await expect(page.getByTestId("docker-swarm-task-tiles")).toContainText(
      "92.0%",
    );
    await expect(
      page.getByTestId("docker-swarm-task-hero-location"),
    ).toHaveText("Task of service shop_checkout on node swarm-manager-01");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "docker-swarm-task-trouble-phone");
  });
});
