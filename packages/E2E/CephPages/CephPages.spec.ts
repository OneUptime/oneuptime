import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A Ceph cluster's pages, in a browser, against the offline fixture
 * (CephPages/Fixture): what the cluster's rules say (CephHealth) about a
 * cluster in trouble - Ceph's own HEALTH_ERR with its checks, an OSD down
 * but still in, one past the full ratio, one past nearfull, one writing
 * slowly, one drained out, a monitor out of quorum, a pool nearly full,
 * one with degraded placement groups, a metadata server Ceph stopped
 * listing - read the way an administrator reads it: the Overview's health
 * and Needs attention, the OSDs, Pools and Daemons lists, an OSD's and a
 * pool's own page; at a phone's width and a laptop's, beside the side menu,
 * dark, German and Persian; with a calm cluster, a disconnected agent and a
 * read that fails. The fixture records every read, so each test also checks
 * that nothing it does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "38000000-0000-4000-8000-000000000001";
const CLUSTER_PATH: string = `/dashboard/${PROJECT_ID}/ceph/${CLUSTER_ID}`;

const PHONE: { width: number; height: number } = { width: 390, height: 844 };
const TABLET: { width: number; height: number } = { width: 768, height: 1024 };
const SMALL_LAPTOP: { width: number; height: number } = {
  width: 1024,
  height: 900,
};
const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/ceph-pages-ui",
);

function localeOf(language: string): Record<string, string> {
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

// The Dashboard's German and Persian words, as the fixture draws them.
const GERMAN: Record<string, string> = localeOf("de");
const PERSIAN: Record<string, string> = localeOf("fa");

// Unicode's isolate marks, which set a sentence's values apart.
const ISOLATE_MARKS: RegExp = /[⁦-⁩]/g;

interface Recorded {
  listRequests: Array<{ modelName: string; query: Record<string, unknown> }>;
  aggregateRequests: Array<{ modelName: string; name: string | null }>;
  apiRequests: Array<{ method: string; url: string }>;
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
          window as unknown as { __cephPagesFixture?: Recorded }
        ).__cephPagesFixture;
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

function withQuery(pagePath: string, query: string): string {
  return query ? `${pagePath}?${query}` : pagePath;
}

// Whether an element's text is cut: wider than the box it is drawn in.
async function isCut(locator: Locator): Promise<boolean> {
  return await locator.evaluate((element: Element): boolean => {
    return element.scrollWidth > element.clientWidth + 0.5;
  });
}

/*
 * How far the page's table runs past the box it scrolls in, in pixels: 0
 * when every column fits its card. The table's own box, not the page's.
 */
async function tableOverflowOf(page: Page): Promise<number> {
  return await page
    .locator("table")
    .first()
    .evaluate((table: Element): number => {
      let box: HTMLElement | null = table.parentElement;
      while (box && box !== document.body) {
        const overflow: string = getComputedStyle(box).overflowX;
        if (overflow === "auto" || overflow === "scroll") {
          return box.scrollWidth - box.clientWidth;
        }
        box = box.parentElement;
      }
      return 0;
    });
}

// A list row's name, in the box the table cuts it in (a link is inline).
function nameBoxOf(page: Page, name: string): Locator {
  return page
    .locator("tr")
    .filter({ hasText: name })
    .first()
    .locator("[data-table-name]");
}

function plainText(text: string | null): string {
  return (text || "").replace(ISOLATE_MARKS, "");
}

async function attentionKeys(
  page: Page,
  testId: string,
): Promise<Array<string>> {
  return await page
    .getByTestId(testId)
    .getByTestId(`${testId}-item`)
    .evaluateAll((items: Array<Element>): Array<string> => {
      return items.map((item: Element): string => {
        return item.getAttribute("data-key") || "";
      });
    });
}

function attentionRow(page: Page, testId: string, key: string): Locator {
  return page.locator(`[data-testid="${testId}-item"][data-key="${key}"]`);
}

async function openOverview(page: Page, query: string = ""): Promise<void> {
  await page.goto(withQuery(CLUSTER_PATH, query));
  await expect(page.getByTestId("resource-hero-identity")).toBeVisible();
}

async function waitForHealth(page: Page, health: string): Promise<void> {
  await expect(page.getByTestId("ceph-hero-health")).toHaveAttribute(
    "data-health",
    health,
  );
}

// The rows Needs attention shows at first, then the rest it folds.
async function expandAttention(page: Page, testId: string): Promise<void> {
  const toggle: Locator = page.getByTestId(`${testId}-toggle`);
  if ((await toggle.count()) > 0) {
    await toggle.click();
  }
}

/*
 * ---------------------------------------------------------------------------
 * The Overview
 * ---------------------------------------------------------------------------
 */
test.describe("a cluster in trouble: the Overview says what needs attention", () => {
  test("Unhealthy beside Connected; the most urgent first, Ceph's own checks on the cluster's row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page);
    await waitForHealth(page, "Unhealthy");
    await expect(page.getByTestId("ceph-hero-health")).toHaveText("Unhealthy");

    await expandAttention(page, "ceph-needs-attention");
    expect(await attentionKeys(page, "ceph-needs-attention")).toEqual([
      "Cluster",
      "Osd:osd.3",
      "Osd:osd.5",
      "Mon:mon.ceph-c",
      "Pool:3",
      "Osd:osd.7",
      "Osd:osd.9",
      "Osd:osd.10",
      "Pool:2",
    ]);

    const clusterRow: Locator = attentionRow(
      page,
      "ceph-needs-attention",
      "Cluster",
    );
    await expect(clusterRow).toHaveAttribute("data-severity", "critical");
    for (const check of [
      "OSD_FULL",
      "MON_DOWN",
      "OSD_DOWN",
      "OSD_NEARFULL",
      "PG_DEGRADED",
    ]) {
      await expect(clusterRow).toContainText(check);
    }
    // Cleared since: its newest reading is 0.
    await expect(clusterRow).not.toContainText("RECENT_CRASH");

    await expect(
      attentionRow(page, "ceph-needs-attention", "Osd:osd.3"),
    ).toContainText("Down, still in the cluster");
    await expect(
      attentionRow(page, "ceph-needs-attention", "Osd:osd.5"),
    ).toContainText("past the full ratio");
    await expect(
      attentionRow(page, "ceph-needs-attention", "Osd:osd.10"),
    ).toContainText("Apply latency 182 ms");
    await expect(
      attentionRow(page, "ceph-needs-attention", "Pool:3"),
    ).toContainText("of its writable space used");
    await expect(
      attentionRow(page, "ceph-needs-attention", "Pool:2"),
    ).toContainText("12 placement groups degraded");

    // The counts open their lists.
    await expect(page.getByTestId("ceph-hero-osds")).toHaveAttribute(
      "href",
      `${CLUSTER_PATH}/osds`,
    );
    await expect(page.getByTestId("ceph-hero-mons")).toHaveAttribute(
      "href",
      `${CLUSTER_PATH}/daemons`,
    );
    await expect(page.getByTestId("ceph-hero-pools")).toHaveAttribute(
      "href",
      `${CLUSTER_PATH}/pools`,
    );

    await screenshot(page, "ceph-overview-trouble-1280");
  });

  test("a row opens its part's page", async ({ page }: { page: Page }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page);
    await waitForHealth(page, "Unhealthy");

    await attentionRow(page, "ceph-needs-attention", "Osd:osd.3")
      .getByRole("link")
      .click();

    await expect(page).toHaveURL(new RegExp(`${CLUSTER_ID}/osds/osd\\.3$`));
    await expect(page.getByTestId("ceph-osd-hero-status")).toContainText(
      "Down",
    );
  });

  test("on a phone: the card fits, names whole, no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page);
    await waitForHealth(page, "Unhealthy");
    await expandAttention(page, "ceph-needs-attention");

    const names: Locator = page
      .getByTestId("ceph-needs-attention")
      .getByTestId("ceph-needs-attention-name");
    const count: number = await names.count();
    expect(count).toBe(9);
    for (let index: number = 0; index < count; index++) {
      expect(await isCut(names.nth(index))).toBe(false);
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-overview-trouble-390");
  });

  test("dark: the health pill and the card in the dark palette", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "theme=dark");
    await waitForHealth(page, "Unhealthy");

    expect(
      await page.evaluate((): boolean => {
        return document.documentElement.classList.contains("dark");
      }),
    ).toBe(true);
    await expect(page.getByTestId("ceph-needs-attention")).toBeVisible();
    await screenshot(page, "ceph-overview-trouble-dark-1280");
  });

  test("German at 1024: the pill, the card and the reasons in German, nothing sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(SMALL_LAPTOP);
    await openOverview(page, "lang=de");
    await waitForHealth(page, "Unhealthy");

    await expect(page.getByTestId("ceph-hero-health")).toHaveText(
      GERMAN["Unhealthy"]!,
    );
    const card: Locator = page.getByTestId("ceph-needs-attention");
    await expect(card).toContainText(GERMAN["Needs attention"]!);
    await expect(
      attentionRow(page, "ceph-needs-attention", "Osd:osd.3"),
    ).toContainText(GERMAN["Down, still in the cluster"]!);
    await expect(
      attentionRow(page, "ceph-needs-attention", "Mon:mon.ceph-c"),
    ).toContainText(GERMAN["Ceph Monitor"]!);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-overview-trouble-de-1024");
  });

  test("Persian: right to left, the reasons in Persian with Persian digits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, "lang=fa");
    await waitForHealth(page, "Unhealthy");

    expect(
      await page.evaluate((): string => {
        return document.documentElement.dir;
      }),
    ).toBe("rtl");
    await expect(page.getByTestId("ceph-hero-health")).toHaveText(
      PERSIAN["Unhealthy"]!,
    );
    await expandAttention(page, "ceph-needs-attention");
    const rbd: string = plainText(
      await attentionRow(page, "ceph-needs-attention", "Pool:2").textContent(),
    );
    expect(rbd).toContain(
      PERSIAN["{{count}} placement groups degraded"]!.replace(
        "{{count}}",
        "۱۲",
      ),
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-overview-trouble-fa-390");
  });
});

test.describe("the Overview's other clusters", () => {
  test("a calm cluster: Healthy, and no Needs attention card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "cluster=calm");
    await waitForHealth(page, "Healthy");

    await expect(page.getByTestId("ceph-needs-attention")).toHaveCount(0);
    await screenshot(page, "ceph-overview-calm-1280");
  });

  test("a disconnected agent: Health Unknown in grey, no card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "collector=disconnected");
    await waitForHealth(page, "Unknown");

    await expect(page.getByTestId("ceph-hero-health")).toHaveText(
      "Health Unknown",
    );
    await expect(page.getByTestId("ceph-needs-attention")).toHaveCount(0);
    await screenshot(page, "ceph-overview-disconnected-1280");
  });

  test("an inventory that cannot be read: says so in the card's frame, with Refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "fail=inventory");

    const frame: Locator = page.getByTestId("ceph-needs-attention-error");
    await expect(frame).toContainText("The inventory could not be read.");
    await expect(frame.getByRole("button")).toBeVisible();
    await expect(page.getByTestId("ceph-hero-health")).toHaveCount(0);
    await screenshot(page, "ceph-overview-read-error-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The lists
 * ---------------------------------------------------------------------------
 */
function rowNamed(page: Page, name: string): Locator {
  return page.locator("tr").filter({
    has: page.getByRole("link", { name: name, exact: true }),
  });
}

async function openList(
  page: Page,
  list: string,
  firstRow: string,
  query: string = "",
): Promise<void> {
  await page.goto(withQuery(`${CLUSTER_PATH}/${list}`, query));
  await expect(page.getByText(firstRow, { exact: true }).first()).toBeVisible();
}

test.describe("the OSDs list", () => {
  test("at a laptop's width: each OSD's state with why, Used and latency coloured at their alerts' lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openList(page, "osds", "osd.0");

    await expect(rowNamed(page, "osd.3")).toContainText("Down");
    await expect(
      rowNamed(page, "osd.3").locator('[data-tone="danger"]').first(),
    ).toBeVisible();
    await expect(rowNamed(page, "osd.7")).toContainText("Out of cluster");
    await expect(rowNamed(page, "osd.5")).toContainText("past the full ratio");
    await expect(rowNamed(page, "osd.9")).toContainText(
      "past the nearfull ratio",
    );
    await expect(rowNamed(page, "osd.10")).toContainText(
      "Apply latency 182 ms",
    );
    await expect(
      rowNamed(page, "osd.10").locator('[data-tone="warning"]').first(),
    ).toBeVisible();
    await expect(rowNamed(page, "osd.0")).toContainText("Up");

    /*
     * The list fits its card beside the side menu: no Age column (Ceph
     * sends no OSD's age), so the latency is no longer cut under the View
     * column.
     */
    await expect(page.getByRole("columnheader", { name: /^Age/ })).toHaveCount(
      0,
    );
    await expect
      .poll(async (): Promise<number> => {
        return await tableOverflowOf(page);
      })
      .toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("columnheader", { name: /^Apply \/ Commit Latency/ }),
    ).toBeInViewport();

    await screenshot(page, "ceph-osds-1280");
  });

  test("beside the side menu at 768: the list fits its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(TABLET);
    await openList(page, "osds", "osd.0");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-osds-768");
  });

  test("on a phone: a card an OSD, no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openList(page, "osds", "osd.0");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-osds-390");
  });

  test("in Persian: a figure reads as written, never back to front", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openList(page, "osds", "osd.0", "lang=fa");
    /*
     * "3 / 4 ms" read "ms 4 / 3" on a right-to-left page, and "1.5 TiB /
     * 3.8 TiB (38.0%)" lost its first number to the line's other end.
     */
    for (const figure of ["3 / 4 ms", "1.5 TiB / 3.8 TiB (38.0%)"]) {
      const cell: Locator = rowNamed(page, "osd.0")
        .locator('span[dir="auto"]')
        .filter({ hasText: figure })
        .first();
      await expect(cell).toBeVisible();
      expect(
        await cell.evaluate((element: Element): string => {
          return getComputedStyle(element).direction;
        }),
      ).toBe("ltr");
    }
    await expect
      .poll(async (): Promise<number> => {
        return await tableOverflowOf(page);
      })
      .toBeLessThanOrEqual(1);
    await screenshot(page, "ceph-osds-fa-1280");
  });
});

test.describe("the Pools list", () => {
  test("at a laptop's width: each pool's state with why, its placement groups, Used at the Pool Near Full alert's line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openList(page, "pools", "rbd");

    const full: Locator = rowNamed(page, "cephfs_data");
    await expect(full).toContainText("Available");
    await expect(full).toContainText("of its writable space used");
    await expect(full.locator('[data-tone="danger"]').first()).toBeVisible();

    const degraded: Locator = rowNamed(page, "rbd");
    await expect(degraded).toContainText("12 placement groups degraded");
    await expect(degraded).toContainText("244 of 256 clean");
    await expect(
      degraded.locator('[data-tone="warning"]').first(),
    ).toBeVisible();

    /*
     * The list fits its card, and its names read: Max Avail and Objects
     * fold under Stored, not under the name, so "cephfs_metadata" is whole
     * (never "cephfs_metad" / "ata"), and a 43-letter name keeps to one
     * line, cut at its end.
     */
    await expect
      .poll(async (): Promise<number> => {
        return await tableOverflowOf(page);
      })
      .toBeLessThanOrEqual(1);
    expect(await isCut(nameBoxOf(page, "cephfs_metadata"))).toBe(false);
    const longName: Locator = page.getByRole("link", {
      name: "default.rgw.buckets.data.archive-eu-central",
    });
    await expect(longName).toBeVisible();
    const longNameBox: Locator = nameBoxOf(
      page,
      "default.rgw.buckets.data.archive-eu-central",
    );
    const lines: number = await longNameBox.evaluate(
      (element: Element): number => {
        const lineHeight: number = parseFloat(
          getComputedStyle(element).lineHeight,
        );
        return Math.round(element.getBoundingClientRect().height / lineHeight);
      },
    );
    expect(lines).toBe(1);

    await screenshot(page, "ceph-pools-1280");
  });

  test("Persian on a phone: right to left, the states in Persian, no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openList(page, "pools", "rbd", "lang=fa");
    await expect(page.getByText(PERSIAN["Available"]!).first()).toBeVisible();
    // A name reads as written: ".mgr", never "mgr." at the line's other end.
    const manager: Locator = page.getByRole("link", { name: ".mgr" });
    await expect(manager).toBeVisible();
    expect(
      await manager.locator("bdi").evaluate((element: Element): string => {
        return getComputedStyle(element).direction;
      }),
    ).toBe("ltr");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-pools-fa-390");
  });
});

test.describe("the Daemons list", () => {
  test("a monitor out of quorum in red, a metadata server Ceph stopped listing in grey, the kinds by Ceph's names", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(`${CLUSTER_PATH}/daemons`);
    await expect(page.getByText("mon.ceph-a").first()).toBeVisible();

    const row: (name: string) => Locator = (name: string): Locator => {
      return page.locator("tr").filter({ hasText: name });
    };
    await expect(row("mon.ceph-c")).toContainText("Out of quorum");
    await expect(
      row("mon.ceph-c").locator('[data-tone="danger"]'),
    ).toBeVisible();
    await expect(row("mds.cephfs.ceph-c.pmvkye")).toContainText(
      "Stopped reporting",
    );
    await expect(
      row("mds.cephfs.ceph-c.pmvkye").locator('[data-tone="neutral"]'),
    ).toBeVisible();
    await expect(row("mgr.ceph-a.wlkzpq")).toContainText("Ceph Manager");
    await expect(row("mon.ceph-a")).toContainText("Ceph Monitor");

    await screenshot(page, "ceph-daemons-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * An OSD's page and a pool's
 * ---------------------------------------------------------------------------
 */
async function openOsd(
  page: Page,
  name: string,
  query: string = "",
): Promise<void> {
  await page.goto(withQuery(`${CLUSTER_PATH}/osds/${name}`, query));
  await expect(page.getByTestId("ceph-osd-page")).toBeVisible();
  await expect(
    page
      .getByTestId("ceph-osd-overview")
      .or(page.getByTestId("ceph-osd-not-reported"))
      .or(page.getByTestId("ceph-osd-read-error")),
  ).toBeVisible();
}

async function openPool(
  page: Page,
  id: string,
  query: string = "",
): Promise<void> {
  await page.goto(withQuery(`${CLUSTER_PATH}/pools/${id}`, query));
  await expect(page.getByTestId("ceph-pool-page")).toBeVisible();
  await expect(
    page
      .getByTestId("ceph-pool-overview")
      .or(page.getByTestId("ceph-pool-not-reported"))
      .or(page.getByTestId("ceph-pool-read-error")),
  ).toBeVisible();
}

test.describe("an OSD's page", () => {
  test("one down but still in: Down in red, where it runs, This OSD, the alert open on it, the OSD alerts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOsd(page, "osd.3");

    const status: Locator = page.getByTestId("ceph-osd-hero-status");
    await expect(status).toContainText("Down");
    await expect(status).toHaveAttribute("data-tone", "danger");
    await expect(page.getByTestId("ceph-osd-hero-location")).toContainText(
      "OSD of cluster ceph-prod on host ceph-a",
    );
    // Still in is what makes a down OSD critical: a fact in grey, not green.
    const badge: Locator = page.getByTestId("ceph-osd-hero-badge");
    await expect(badge).toHaveText("In cluster");
    await expect(badge).toHaveAttribute("data-tone", "neutral");
    await expect(page.getByTestId("ceph-osd-attention")).toContainText(
      "This OSD",
    );
    await expect(page.getByTestId("ceph-osd-tiles")).toHaveCount(0);

    await expect(page.getByTestId("ceph-osd-open")).toContainText(
      "[Ceph] OSD Down (osd.3) - ceph-prod",
    );

    const alerts: Locator = page.getByTestId("ceph-osd-alerts");
    await expect(alerts).toContainText("OSD Down");
    const turnOn: Locator = alerts
      .getByRole("link")
      .filter({ hasText: "Turn on" });
    await expect(turnOn).toBeVisible();
    expect((await turnOn.getAttribute("href")) || "").toContain(
      `${CLUSTER_PATH}/recommendations`,
    );

    await screenshot(page, "ceph-osd-down-1280");
  });

  test("one up but out: Out of cluster in its pill, once - no badge says it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOsd(page, "osd.7");

    const status: Locator = page.getByTestId("ceph-osd-hero-status");
    await expect(status).toContainText("Out of cluster");
    await expect(status).toHaveAttribute("data-tone", "warning");
    await expect(page.getByTestId("ceph-osd-hero-badge")).toHaveCount(0);
  });

  test("one past the full ratio, on a phone: Up in red, its tiles and details fit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOsd(page, "osd.5");

    await expect(page.getByTestId("ceph-osd-hero-status")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    await expect(page.getByTestId("ceph-osd-tiles")).toContainText("96.2%");
    await expect(page.getByTestId("ceph-osd-attention")).toContainText(
      "past the full ratio",
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-osd-full-390");
  });

  test("German and Persian: the state and the cards in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOsd(page, "osd.3", "lang=de");
    await expect(page.getByTestId("ceph-osd-hero-status")).toContainText(
      GERMAN["Down"]!,
    );
    await expect(page.getByTestId("ceph-osd-attention")).toContainText(
      GERMAN["This OSD"]!,
    );
    await screenshot(page, "ceph-osd-down-de-1280");

    await openOsd(page, "osd.3", "lang=fa");
    await expect(page.getByTestId("ceph-osd-hero-status")).toContainText(
      PERSIAN["Down"]!,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-osd-down-fa-1280");
  });

  test("an inventory that cannot be read: in its own frame, with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOsd(page, "osd.3", "fail=inventory");
    const error: Locator = page.getByTestId("ceph-osd-read-error");
    await expect(error).toContainText("Couldn't load this OSD");
    await expect(
      error.getByRole("button", { name: /Try again/ }),
    ).toBeVisible();
    await screenshot(page, "ceph-osd-read-error-1280");
  });
});

test.describe("a pool's page", () => {
  test("one with degraded placement groups: Available in amber, why, the incident open on it, its tiles and alerts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openPool(page, "2");

    const status: Locator = page.getByTestId("ceph-pool-hero-status");
    await expect(status).toContainText("Available");
    await expect(status).toHaveAttribute("data-tone", "warning");
    await expect(page.getByTestId("ceph-pool-attention")).toContainText(
      "12 placement groups degraded",
    );
    await expect(page.getByTestId("ceph-pool-tiles")).toContainText(
      "12 not active + clean",
    );
    await expect(page.getByTestId("ceph-pool-open")).toContainText(
      "[Ceph] Degraded Placement Groups - ceph-prod",
    );
    await expect(page.getByTestId("ceph-pool-alerts")).toContainText(
      "Pool Near Full",
    );

    await screenshot(page, "ceph-pool-degraded-1280");
  });

  test("dark: one nearly full, in red", async ({ page }: { page: Page }) => {
    await page.setViewportSize(LAPTOP);
    await openPool(page, "3", "theme=dark");
    await expect(page.getByTestId("ceph-pool-hero-status")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    await screenshot(page, "ceph-pool-full-dark-1280");
  });

  test("on a phone: a long pool name whole, no sideways scroll", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openPool(page, "5");
    const name: Locator = page.getByTestId("ceph-pool-hero-name");
    await expect(name).toContainText(
      "default.rgw.buckets.data.archive-eu-central",
    );
    expect(await isCut(name)).toBe(false);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ceph-pool-long-name-390");
  });
});

test.describe("the fixture's reads", () => {
  test("the Overview reads its inventory, the checks Ceph raised and each pool's placement groups", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page);
    await waitForHealth(page, "Unhealthy");

    const fixture: Recorded = await page.evaluate((): Recorded => {
      return (window as unknown as { __cephPagesFixture: Recorded })
        .__cephPagesFixture;
    });
    const names: Array<string> = fixture.listRequests.map(
      (request: { query: Record<string, unknown> }): string => {
        return String(request.query?.["name"] || "");
      },
    );
    for (const metric of [
      "ceph_health_detail",
      "ceph_pg_total",
      "ceph_pg_active",
      "ceph_pg_clean",
      "ceph_pg_degraded",
      "ceph_pg_undersized",
    ]) {
      expect(names).toContain(metric);
    }
    const kinds: Array<string> = fixture.listRequests
      .filter((request: { modelName: string }): boolean => {
        return request.modelName === "CephResource";
      })
      .map((request: { query: Record<string, unknown> }): string => {
        return String(request.query?.["kind"] || "");
      });
    expect(kinds.sort()).toEqual(["Mon", "Osd", "Pool"]);
  });
});
