import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * A table's Bulk Actions on a phone: the band over its cards.
 *
 * "Tables keep their three-line bulk bar on phones; the exceptions list's
 * one-line Row layout could serve the other lists that have a header line
 * of their own" - the maintainer's follow-up to #5344. Ticking the first
 * card on a phone drew a grey bar of its own over the cards' band - "2
 * Monitors Selected", Select All Monitors and Clear Selection on lines of
 * their own, Bulk Actions on a fourth - that pushed every card down under
 * the finger that ticked one. The band is the line now: the count in a chip
 * whose × clears it, Bulk Actions at the band's end where the order sits,
 * and - once every card on the page is ticked and more monitors match -
 * "Select all 34 monitors" on a line of its own under the count. Rows keep
 * their bar.
 *
 * The Monitors list with 30 more rows (?rows=30): 34 monitors, ten a page.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const MONITORS: string = `/dashboard/${PROJECT}/monitors?rows=30`;
const MATCHING: number = 34;
const PAGE_SIZE: number = 10;

const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/model-tables-ui",
);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FixtureRecord {
  listRequests: Array<{
    tableName: string;
    limit: number;
    skip: number;
    query: Record<string, unknown>;
    sort: Record<string, unknown>;
  }>;
  unmodelled: Array<string>;
}

// What the band holds and where, read in one frame.
interface BandReading {
  band: Box;
  firstCardTop: number;
  box: Box | null;
  count: Box | null;
  actions: Box | null;
  offer: Box | null;
  // The words in the count's chip and in the offer, where they start.
  countWords: Box | null;
  offerWords: Box | null;
  greyBars: number;
  sideways: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the table made is one the fixture answers as the API does.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __fixture: FixtureRecord }).__fixture,
      ),
    ) as FixtureRecord;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function open(
  page: Page,
  query: string = "",
  width: number = 390,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 900 });
  await page.goto(`${MONITORS}${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
}

function band(page: Page): Locator {
  return page.getByTestId("table-cards-header");
}

function cards(page: Page): Locator {
  return page.locator("#Monitors-table-body > div");
}

async function readBand(page: Page): Promise<BandReading> {
  return await page.evaluate((): BandReading => {
    const boxOf: (element: Element | null) => Box | null = (
      element: Element | null,
    ): Box | null => {
      if (!element) {
        return null;
      }

      const rect: DOMRect = element.getBoundingClientRect();

      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    const bandElement: Element = document.querySelector(
      "[data-testid=table-cards-header]",
    ) as Element;
    const firstCard: Element = document.querySelector(
      "#Monitors-table-body > div",
    ) as Element;

    return {
      band: boxOf(bandElement) as Box,
      firstCardTop: firstCard.getBoundingClientRect().top,
      box: boxOf(bandElement.querySelector("input[type=checkbox]")),
      count: boxOf(
        bandElement.querySelector("[data-testid=bulk-update-selected-count]"),
      ),
      actions: boxOf(
        bandElement.querySelector("[data-testid=bulk-update-actions] button"),
      ),
      offer: boxOf(
        bandElement.querySelector(
          "[data-testid=bulk-update-select-all-matching]",
        ),
      ),
      countWords: boxOf(
        bandElement.querySelector(
          "[data-testid=bulk-update-selected-count] > span",
        ),
      ),
      offerWords: boxOf(
        bandElement.querySelector(
          "[data-testid=bulk-update-select-all-matching] > span",
        ),
      ),
      greyBars: document.querySelectorAll(
        ".rounded-xl.bg-gray-50.border-2.border-gray-100",
      ).length,
      sideways:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
}

function centerOf(box: Box): number {
  return box.y + box.height / 2;
}

test.describe("on a phone, a table's Bulk Actions are the band over its cards", () => {
  test("ticking a card moves nothing: the band says how many and offers Bulk Actions where the order was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const before: BandReading = await readBand(page);
    expect(before.count).toBeNull();
    await expect(band(page).getByText("Sort", { exact: false })).toBeVisible();

    await cards(page).first().locator("input[type=checkbox]").check();
    await expect(
      band(page).getByTestId("bulk-update-selected-count"),
    ).toHaveText("1 selected");

    const after: BandReading = await readBand(page);

    // The cards stay where they were, under the finger; the band its height.
    expect(Math.round(after.firstCardTop)).toBe(
      Math.round(before.firstCardTop),
    );
    expect(Math.round(after.band.height)).toBe(Math.round(before.band.height));
    expect(Math.round(after.band.height)).toBe(36);
    // No bar of its own over the band, and nothing scrolls sideways.
    expect(after.greyBars).toBe(0);
    expect(after.sideways).toBeLessThanOrEqual(0);
    // The order steps aside for Bulk Actions at the band's end.
    await expect(band(page).getByTestId("table-cards-sort")).toHaveCount(0);
    expect(
      Math.abs(
        after.actions!.x +
          after.actions!.width -
          (after.band.x + after.band.width - 20),
      ),
    ).toBeLessThanOrEqual(1);
    // The box, the count and Bulk Actions on one line.
    expect(
      Math.abs(centerOf(after.box!) - centerOf(after.count!)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(centerOf(after.actions!) - centerOf(after.count!)),
    ).toBeLessThanOrEqual(2);

    await screenshot(page, "monitors-band-one-ticked-390");

    // The × lets go of it, and the order comes back.
    await band(page).getByRole("button", { name: "Clear Selection" }).click();
    await expect(band(page).getByTestId("table-cards-sort")).toBeVisible();
    await expect(
      cards(page).first().locator("input[type=checkbox]"),
    ).not.toBeChecked();
  });

  test("with every card on the page ticked, the band offers every monitor that matches, and selects them all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    await band(page).locator("input[type=checkbox]").check();
    await expect(
      band(page).getByTestId("bulk-update-selected-count"),
    ).toHaveText(`${PAGE_SIZE} selected`);

    const offer: Locator = band(page).getByRole("button", {
      name: `Select all ${MATCHING} monitors`,
    });
    await expect(offer).toBeVisible();

    const ticked: BandReading = await readBand(page);

    // On a line of its own, under the count; the box beside the count.
    expect(ticked.offer!.y).toBeGreaterThanOrEqual(
      ticked.count!.y + ticked.count!.height - 1,
    );
    expect(
      Math.abs(centerOf(ticked.box!) - centerOf(ticked.count!)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(centerOf(ticked.actions!) - centerOf(ticked.count!)),
    ).toBeLessThanOrEqual(2);
    // Its words start where the count's do, a line under them.
    expect(
      Math.abs(ticked.offerWords!.x - ticked.countWords!.x),
    ).toBeLessThanOrEqual(1);
    expect(ticked.sideways).toBeLessThanOrEqual(0);

    await screenshot(page, "monitors-band-page-ticked-390");

    const readsBefore: number = (await fixture(page)).listRequests.length;
    await offer.click();

    await expect(
      band(page).getByTestId("bulk-update-selected-count"),
    ).toHaveText(`All ${MATCHING} selected`);
    await expect(offer).toHaveCount(0);

    // Every match, read with the list's own query, a thousand at a time.
    const reads: FixtureRecord["listRequests"] = (
      await fixture(page)
    ).listRequests.slice(readsBefore);
    const selectAll: FixtureRecord["listRequests"][number] | undefined =
      reads.find((read: FixtureRecord["listRequests"][number]): boolean => {
        return read.tableName === "Monitor" && read.limit === 1000;
      });
    expect(selectAll).toBeDefined();
    expect(selectAll!.skip).toBe(0);

    await screenshot(page, "monitors-band-all-selected-390");
  });

  for (const variant of [
    { name: "dark", query: "&theme=dark" },
    { name: "de", query: "&lang=de" },
    { name: "fa", query: "&lang=fa" },
  ]) {
    test(`${variant.name}: the band keeps one line with a card ticked, and the offer its own line, nothing scrolling sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, variant.query);

      const before: BandReading = await readBand(page);

      await cards(page).first().locator("input[type=checkbox]").check();
      await expect(
        band(page).getByTestId("bulk-update-selected-count"),
      ).toBeVisible();

      const one: BandReading = await readBand(page);
      expect(Math.round(one.band.height)).toBe(Math.round(before.band.height));
      expect(Math.round(one.firstCardTop)).toBe(
        Math.round(before.firstCardTop),
      );
      expect(one.sideways).toBeLessThanOrEqual(0);

      await band(page).locator("input[type=checkbox]").first().check();
      await expect(
        band(page).getByTestId("bulk-update-select-all-matching"),
      ).toBeVisible();

      const ticked: BandReading = await readBand(page);
      expect(ticked.sideways).toBeLessThanOrEqual(0);
      expect(
        Math.abs(centerOf(ticked.box!) - centerOf(ticked.count!)),
      ).toBeLessThanOrEqual(2);
      // Inside the band, whichever way the page reads.
      expect(ticked.offer!.x).toBeGreaterThanOrEqual(ticked.band.x);
      expect(ticked.offer!.x + ticked.offer!.width).toBeLessThanOrEqual(
        ticked.band.x + ticked.band.width + 0.5,
      );
      /*
       * Its words start where the count's do - at the right in Persian,
       * which reads from there.
       */
      const startOf: (words: Box) => number = (words: Box): number => {
        return variant.name === "fa" ? words.x + words.width : words.x;
      };
      expect(
        Math.abs(startOf(ticked.offerWords!) - startOf(ticked.countWords!)),
      ).toBeLessThanOrEqual(1);

      await screenshot(page, `monitors-band-page-ticked-390-${variant.name}`);
    });
  }
});

test("on a laptop a table's rows keep their bar over them", async ({
  page,
}: {
  page: Page;
}) => {
  await open(page, "", 1280);

  await page
    .locator("#Monitors-table-body > tr")
    .first()
    .locator("input[type=checkbox]")
    .check();

  await expect(page.getByText("1 Monitor Selected")).toBeVisible();
  await expect(page.getByText("Select All Monitors")).toBeVisible();
  await expect(page.getByTestId("table-cards-header")).toHaveCount(0);
  await expect(page.getByTestId("bulk-update-row")).toHaveCount(0);
});
