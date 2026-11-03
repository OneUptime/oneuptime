import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A storage array's pages, in a browser, against the offline fixture
 * (StorageArrayPages/Fixture): what the array's rules say
 * (StorageArrayHealth) about a FlashArray in trouble - a critical and a
 * warning alert open, 92% full, reads at 6.1 ms, a failed drive, a degraded
 * fan, a host that reaches it through one controller, a pod a minute and a
 * half behind - and about a FlashBlade whose scratch file system has 5%
 * left, read the way a storage administrator reads it: the Overview's
 * health and Needs attention, the Hosts, Replication, Hardware and File
 * Systems lists, a host's, a file system's and a volume's own page; at a
 * phone's width and a laptop's, beside the side menu, dark, German and
 * Persian; with calm arrays, a disconnected agent and a read that fails.
 * The fixture records every read, so each test also checks that nothing it
 * does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const FLASHARRAY_ID: string = "58000000-0000-4000-8000-000000000001";
const FLASHBLADE_ID: string = "58000000-0000-4000-8000-000000000002";
const FLASHARRAY_PATH: string = `/dashboard/${PROJECT_ID}/storage-arrays/${FLASHARRAY_ID}`;
const FLASHBLADE_PATH: string = `/dashboard/${PROJECT_ID}/storage-arrays/${FLASHBLADE_ID}`;

const PHONE: { width: number; height: number } = { width: 390, height: 844 };
const TABLET: { width: number; height: number } = { width: 768, height: 1024 };
const SMALL_LAPTOP: { width: number; height: number } = {
  width: 1024,
  height: 900,
};
const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/storage-array-pages-ui",
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
          window as unknown as { __storageArrayPagesFixture?: Recorded }
        ).__storageArrayPagesFixture;
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

async function openOverview(
  page: Page,
  query: string = "",
  arrayPath: string = FLASHARRAY_PATH,
): Promise<void> {
  await page.goto(withQuery(arrayPath, query));
  await expect(page.getByTestId("resource-hero-identity")).toBeVisible();
}

async function waitForHealth(page: Page, health: string): Promise<void> {
  await expect(page.getByTestId("storage-array-hero-health")).toHaveAttribute(
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

// A list's row, by the name it shows.
function listRow(page: Page, name: string): Locator {
  return page.locator("tr", { hasText: name }).first();
}

async function openPart(page: Page, partPath: string): Promise<void> {
  await page.goto(partPath);
  await expect(page.getByTestId("storage-array-part-page")).toBeVisible();
  await expect(
    page
      .getByTestId("storage-array-part-overview")
      .or(page.getByTestId("storage-array-part-read-error"))
      .or(page.getByTestId("storage-array-part-not-reported")),
  ).toBeVisible();
}

/*
 * ---------------------------------------------------------------------------
 * The Overview
 * ---------------------------------------------------------------------------
 */
test.describe("an array in trouble: the Overview says what needs attention", () => {
  test("Unhealthy beside Connected; the array's own row first, then each part with why, the most urgent first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page);
    await waitForHealth(page, "Unhealthy");
    await expect(page.getByTestId("storage-array-hero-health")).toHaveText(
      "Unhealthy",
    );

    const card: Locator = page.getByTestId("storage-array-needs-attention");
    await expect(card).toBeVisible();
    await expandAttention(page, "storage-array-needs-attention");
    expect(await attentionKeys(page, "storage-array-needs-attention")).toEqual(
      // The failed drive and its bay are one part, one row.
      [
        "Array",
        "Drive:CH0.BAY3",
        "Hardware:CT0.FAN1",
        "Host:esx-04",
        "Pod:dr-pod",
      ],
    );

    // The array's own row: its alerts, how full and how slow it is.
    const own: Locator = attentionRow(
      page,
      "storage-array-needs-attention",
      "Array",
    );
    await expect(own).toHaveAttribute("data-severity", "critical");
    const ownText: string = plainText(await own.textContent());
    expect(ownText).toContain("1 critical alert open");
    expect(ownText).toContain("92% of usable capacity used");
    expect(ownText).toContain("Read latency 6.1 ms");

    // Each part with why, in the array's own words where they are its.
    const drive: string = plainText(
      await attentionRow(
        page,
        "storage-array-needs-attention",
        "Drive:CH0.BAY3",
      ).textContent(),
    );
    expect(drive).toContain("Reports failed");
    // One row for the drive and its bay, whose "Reports critical" adds nothing.
    expect(drive).not.toContain("Reports critical");
    expect(
      plainText(
        await attentionRow(
          page,
          "storage-array-needs-attention",
          "Host:esx-04",
        ).textContent(),
      ),
    ).toContain("Reaches the array through one controller only");
    expect(
      plainText(
        await attentionRow(
          page,
          "storage-array-needs-attention",
          "Pod:dr-pod",
        ).textContent(),
      ),
    ).toContain("Replication 1 min 35 s behind");

    // The healthy parts are never listed.
    await expect(card).not.toContainText("esx-01");
    await expect(card).not.toContainText("CT1");
    await screenshot(page, "overview-trouble-1280");
  });

  test("each row is one step from where to look: a host's page, the hardware, the replication list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page);
    await waitForHealth(page, "Unhealthy");
    await expandAttention(page, "storage-array-needs-attention");

    await attentionRow(page, "storage-array-needs-attention", "Host:esx-04")
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${FLASHARRAY_ID}/hosts/esx-04$`));
    await expect(page.getByTestId("storage-array-part-page")).toBeVisible();

    await page.goBack();
    await waitForHealth(page, "Unhealthy");
    await expandAttention(page, "storage-array-needs-attention");
    await attentionRow(page, "storage-array-needs-attention", "Pod:dr-pod")
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${FLASHARRAY_ID}/replication$`));
  });

  test("the alerts the array raised itself, critical first, beside the tiles at the alerts' lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page);
    await waitForHealth(page, "Unhealthy");

    await expect(page.getByText("Drive failed")).toBeVisible();
    await expect(page.getByText("Fan running degraded")).toBeVisible();
    await expect(page.getByText("1 critical, 1 warning")).toBeVisible();
  });
});

test.describe("an Overview with nothing to say, an agent gone and a read that fails", () => {
  test("calm arrays: Healthy, and no Needs attention card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "array=calm");
    await waitForHealth(page, "Healthy");
    await expect(page.getByTestId("storage-array-needs-attention")).toHaveCount(
      0,
    );
    await screenshot(page, "overview-calm-1280");
  });

  test("a disconnected agent: Health Unknown in grey, no Needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "collector=disconnected");
    await waitForHealth(page, "Unknown");
    await expect(page.getByTestId("storage-array-hero-health")).toHaveText(
      "Health Unknown",
    );
    await expect(page.getByTestId("storage-array-needs-attention")).toHaveCount(
      0,
    );
    await screenshot(page, "overview-disconnected-1280");
  });

  test("an inventory read that fails says so in the card's frame, with no health beside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "fail=inventory");
    const error: Locator = page.getByTestId(
      "storage-array-needs-attention-error",
    );
    await expect(error).toBeVisible();
    await expect(error).toContainText("The inventory could not be read.");
    await expect(error.getByRole("button", { name: /Refresh/ })).toBeVisible();
    await expect(page.getByTestId("storage-array-hero-health")).toHaveCount(0);
    await screenshot(page, "overview-read-fails-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The lists
 * ---------------------------------------------------------------------------
 */
test.describe("the lists say each part's state with why, coloured at the alerts' lines", () => {
  test("Hosts: the host short of a path in amber with why, the healthy green, the unused grey", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(`${FLASHARRAY_PATH}/hosts`);

    const lost: Locator = listRow(page, "esx-04");
    await expect(lost).toContainText("Lost redundant paths");
    await expect(lost.locator('[data-tone="warning"]')).toBeVisible();
    await expect(lost.getByTestId("resource-status-reason")).toHaveText(
      "Reaches the array through one controller only",
    );

    const healthy: Locator = listRow(page, "esx-01");
    await expect(healthy).toContainText("Redundant paths");
    await expect(healthy.locator('[data-tone="positive"]')).toBeVisible();

    await expect(listRow(page, "esx-06")).toContainText("Unused");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "hosts-1280");
  });

  test("Replication: the pod a minute and a half behind in amber", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(`${FLASHARRAY_PATH}/replication`);

    const behind: Locator = listRow(page, "dr-pod");
    await expect(behind.locator('[data-tone="warning"]').first()).toBeVisible();
    await expect(behind).toContainText("Replication 1 min 35 s behind");
    const inStep: Locator = listRow(page, "sync-pod");
    await expect(
      inStep.locator('[data-tone="positive"]').first(),
    ).toBeVisible();
    await screenshot(page, "replication-1280");
  });

  test("Hardware: the failed drive and the critical bay red, the degraded fan amber", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(`${FLASHARRAY_PATH}/hardware`);

    await expect(page.getByText("CT0.FAN1").first()).toBeVisible();
    await expect(page.getByText("Failed").first()).toBeVisible();
    await expect(page.getByText("Degraded").first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "hardware-1280");
  });

  test("File Systems: the scratch file system nearly full, with how much is used", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(`${FLASHBLADE_PATH}/file-systems`);

    const full: Locator = listRow(page, "scratch");
    await expect(full).toContainText("Near full");
    await expect(full.locator('[data-tone="warning"]')).toBeVisible();
    await expect(full.getByTestId("resource-status-reason")).toHaveText(
      "95% of its provisioned size used",
    );
    await expect(listRow(page, "home")).toContainText("Available");
    await screenshot(page, "file-systems-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A part's own page
 * ---------------------------------------------------------------------------
 */
test.describe("a part's own page answers the same questions in the same places", () => {
  test("a host short of a path: its state, where it sits, why, what is open on it and the alerts that watch it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openPart(page, `${FLASHARRAY_PATH}/hosts/esx-04`);

    const status: Locator = page.getByTestId("storage-array-part-hero-status");
    await expect(status).toContainText("Lost redundant paths");
    await expect(status).toHaveAttribute("data-tone", "warning");
    const hero: Locator = page.getByTestId("storage-array-part-hero");
    await expect(hero).toContainText("Host of array fa-prod-01");
    await expect(
      hero.getByRole("link", { name: "fa-prod-01" }),
    ).toHaveAttribute("href", FLASHARRAY_PATH);

    await expect(
      page.getByTestId("storage-array-part-attention"),
    ).toContainText("Reaches the array through one controller only");
    await expect(page.getByTestId("storage-array-part-open")).toContainText(
      "Host Lost Redundant Paths (esx-04)",
    );
    const alerts: Locator = page.getByTestId("storage-array-part-alerts");
    await expect(alerts).toContainText("Host Lost Redundant Paths");
    await expect(
      alerts.getByTestId("storage-array-part-alerts-turn-on"),
    ).toBeVisible();
    await screenshot(page, "host-page-1280");
  });

  test("a nearly full file system: Near full, how much is used and the file system alerts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openPart(page, `${FLASHBLADE_PATH}/file-systems/scratch`);

    await expect(
      page.getByTestId("storage-array-part-hero-status"),
    ).toContainText("Near full");
    await expect(page.getByTestId("storage-array-part-hero")).toContainText(
      "File system of array fb-prod-01",
    );
    await expect(
      page.getByTestId("storage-array-part-attention"),
    ).toContainText("95% of its provisioned size used");
    await expect(page.getByTestId("storage-array-part-alerts")).toContainText(
      "File System Near Full",
    );
    /*
     * Its Details say what the FlashBlade sent, and nothing else: no rows of
     * dashes for the latency, IOPS and data reduction it did not send.
     */
    const details: Locator = page.getByTestId("storage-array-part-details");
    await expect(details).toContainText("NFS, SMB");
    await expect(details).not.toContainText("—");
    await expect(details).not.toContainText("Read Latency");
    await screenshot(page, "file-system-page-1280");
  });

  test("a volume: Available, its size and hosts, and no alerts card - no alert watches one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openPart(
      page,
      `${FLASHARRAY_PATH}/volumes/${encodeURIComponent("vg1/vol-db")}`,
    );

    await expect(
      page.getByTestId("storage-array-part-hero-status"),
    ).toContainText("Available");
    const hero: Locator = page.getByTestId("storage-array-part-hero");
    await expect(hero).toContainText("Volume of array fa-prod-01");
    await expect(hero).toContainText("2 hosts");
    await expect(page.getByTestId("storage-array-part-alerts")).toHaveCount(0);
    await screenshot(page, "volume-page-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Widths, dark, German and Persian
 * ---------------------------------------------------------------------------
 */
test.describe("on a phone, a tablet and beside the side menu, nothing is cut and nothing scrolls sideways", () => {
  test("the Overview and the Hosts list at 390", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page);
    await waitForHealth(page, "Unhealthy");
    await expandAttention(page, "storage-array-needs-attention");
    await expectNoSidewaysScroll(page);
    const names: Locator = page
      .getByTestId("storage-array-needs-attention")
      .getByTestId("storage-array-needs-attention-name");
    for (let index: number = 0; index < (await names.count()); index++) {
      expect(await isCut(names.nth(index))).toBe(false);
    }
    await screenshot(page, "overview-trouble-390");

    await page.goto(`${FLASHARRAY_PATH}/hosts`);
    await expect(page.getByText("esx-04").first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "hosts-390");
  });

  test("the Overview, a host's page and the volumes at 1024 and 768", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [SMALL_LAPTOP, TABLET]) {
      await page.setViewportSize(size);
      await openOverview(page);
      await waitForHealth(page, "Unhealthy");
      await expectNoSidewaysScroll(page);
      await screenshot(page, `overview-trouble-${size.width}`);

      await openPart(page, `${FLASHARRAY_PATH}/hosts/esx-04`);
      await expectNoSidewaysScroll(page);
      await screenshot(page, `host-page-${size.width}`);

      await page.goto(`${FLASHARRAY_PATH}/volumes`);
      await expect(
        page
          .getByText(
            "vsphere-prod-datastore-archive-2024-eu-central-replicated",
          )
          .first(),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
      await screenshot(page, `volumes-${size.width}`);
    }
  });
});

test.describe("dark, German and Persian", () => {
  test("dark: the Overview and a host's page", async ({
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
    await screenshot(page, "overview-trouble-dark-1280");
    await openPart(page, `${FLASHARRAY_PATH}/hosts/esx-04?theme=dark`);
    await screenshot(page, "host-page-dark-1280");
  });

  test("German: the health, Needs attention's reasons and the Hosts list's states", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "lang=de");
    await waitForHealth(page, "Unhealthy");
    await expect(page.getByTestId("storage-array-hero-health")).toHaveText(
      GERMAN["Unhealthy"]!,
    );
    const card: Locator = page.getByTestId("storage-array-needs-attention");
    await expect(card).toContainText(GERMAN["Needs attention"]!);
    await expect(card).toContainText(GERMAN["Reports failed"]!);
    await expect(card).not.toContainText("Reports failed");
    await screenshot(page, "overview-trouble-german-1280");

    await page.goto(`${FLASHARRAY_PATH}/hosts?lang=de`);
    await expect(listRow(page, "esx-04")).toContainText(
      GERMAN["Lost redundant paths"]!,
    );
    await expect(listRow(page, "esx-04")).toContainText(
      GERMAN["Reaches the array through one controller only"]!,
    );
    await screenshot(page, "hosts-german-1280");
  });

  test("Persian: right to left, the health and the reasons in Persian, nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, "lang=fa");
    await waitForHealth(page, "Unhealthy");
    expect(
      await page.evaluate((): string => {
        return document.documentElement.dir;
      }),
    ).toBe("rtl");
    await expect(page.getByTestId("storage-array-hero-health")).toHaveText(
      PERSIAN["Unhealthy"]!,
    );
    await expect(
      page.getByTestId("storage-array-needs-attention"),
    ).toContainText(PERSIAN["Reports failed"]!);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "overview-trouble-persian-1280");

    await page.setViewportSize(PHONE);
    await openPart(page, `${FLASHARRAY_PATH}/hosts/esx-04?lang=fa`);
    await expect(
      page.getByTestId("storage-array-part-hero-status"),
    ).toContainText(PERSIAN["Lost redundant paths"]!);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "host-page-persian-390");
  });
});
