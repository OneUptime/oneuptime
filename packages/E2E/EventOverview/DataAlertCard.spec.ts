import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * An alert's Data card (Components/DataObservability/DataAlertLineage):
 * what a data monitor's alert is about, the alert upstream it is a
 * consequence of, the services that write its table and their changes
 * around it - and, on a cause's page, the alerts downstream it caused. Drawn
 * only for an alert a data monitor raised. Each of its reads stands alone:
 * one that fails or is refused leaves out only what it would have shown,
 * never the rest of the card, and never the page. Under it, the alert's
 * Lineage card (AlertLineageDiagram): its table drawn with the one it is
 * built from, the way to its cause, or to the alert it caused, picked out -
 * and for an alert from a check on one column, that column followed; for a
 * cause on the pipeline on its arrow, the arrow's label saying Cause, just
 * over the arrow, in words that read on a light page and a dark one, and in
 * view when the drawing opens on a phone.
 *
 * On the Event Overview fixture's alerts #311 and #310 (Fixture/Fixture.js,
 * ?data= and ?fail=data-alert / data-writers / data-changes), with the clock
 * pinned and the network fenced; afterEach fails a test on an uncaught page
 * error, or on anything the fixture does not model.
 */

const PORT: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

const ALERT_ID: string = uuid("30000000", 311);
const ALERT_PATH: string = `${DASHBOARD}/alerts/${ALERT_ID}`;
const CAUSE_PATH: string = `${DASHBOARD}/alerts/${uuid("30000000", 310)}`;
const CAUSE_TABLE_PATH: string = `${DASHBOARD}/data-observability/tables/${uuid("8b000000", 1)}`;
const TABLE_PATH: string = `${DASHBOARD}/data-observability/tables/${uuid("8b000000", 2)}`;

const TABLE_NAME: string = "payments.ledger_entries · Payments warehouse";
const CAUSE_TABLE_NAME: string =
  "payments.provider_callbacks · Payments warehouse";
const CAUSE_NAME: string =
  "#310 Payment provider callback retries above 50/min";
const ALERT_NAME: string = "#311 Payment webhook 5xx rate above 5%";
const STARTED_ACKNOWLEDGED: string =
  "That alert was open first, on what this one's table or pipeline is built from, so this alert started acknowledged: nobody was paged twice.";
const NO_CHANGES: string =
  "No deploy or other change of these services in the day before the alert.";

const CAUSE_TABLE_CARD: string = `table:${uuid("8b000000", 1)}`;
const TABLE_CARD: string = `table:${uuid("8b000000", 2)}`;
const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/event-overview-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();

const COLOUR_CHANNELS: RegExp = /[\d.]+/g;

// WCAG's relative luminance of an rgb()/rgba() colour, its alpha left out.
function relativeLuminance(color: string): number {
  const channels: Array<number> = (color.match(COLOUR_CHANNELS) || [])
    .slice(0, 3)
    .map((value: string): number => {
      const channel: number = Number(value) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const first: number = relativeLuminance(foreground);
  const second: number = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

// What WCAG AA asks of words smaller than 18px: an arrow's label is 10px.
const AA_TEXT_CONTRAST: number = 4.5;

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing the page asks for may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    await route.abort();
  });

  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __eventOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__eventOverviewFixture;
      return JSON.parse(JSON.stringify(state?.unhandled || []));
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function open(
  page: Page,
  pagePath: string,
  query: string = "",
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${pagePath}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 30000,
  });
}

function cardTitled(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { level: 2, name: title, exact: true }),
  });
}

function dataCard(page: Page): Locator {
  return cardTitled(page, "Data");
}

function impactCard(page: Page): Locator {
  return cardTitled(page, "Downstream Impact");
}

function lineageCard(page: Page): Locator {
  return cardTitled(page, "Lineage");
}

// A card of the lineage drawing, by the id the drawing gives it.
function lineageNode(card: Locator, nodeId: string): Locator {
  return card.locator(`[data-node-id="${nodeId}"]`);
}

// How many times the page asked for an alert's lineage.
async function lineageReads(page: Page, alertId: string): Promise<number> {
  return page.evaluate((id: string): number => {
    const state: { apiRequests?: Array<{ url: string }> } =
      (
        window as unknown as {
          __eventOverviewFixture?: { apiRequests?: Array<{ url: string }> };
        }
      ).__eventOverviewFixture || {};
    return (state.apiRequests || []).filter((request: { url: string }) => {
      return request.url.endsWith(`/data-observability/alerts/${id}/lineage`);
    }).length;
  }, alertId);
}

// One part of the Data card, by its label: About, Written By...
function part(card: Locator, label: string): Locator {
  return card.locator("dl > div").filter({
    has: card.page().getByText(label, { exact: true }),
  });
}

// The changes of the services that write a table: an analytics table.
const CHANGE_EVENTS: string = "ChangeEventV1";

type RecordedRead = {
  modelName: string;
  analytics?: boolean;
  query: unknown;
};

// The list reads the fixture answered, of one model.
async function reads(
  page: Page,
  modelName: string,
): Promise<Array<RecordedRead>> {
  return page.evaluate((name: string): Array<RecordedRead> => {
    const state: { listRequests?: Array<RecordedRead> } =
      (
        window as unknown as {
          __eventOverviewFixture?: { listRequests?: Array<RecordedRead> };
        }
      ).__eventOverviewFixture || {};
    return JSON.parse(
      JSON.stringify(
        (state.listRequests || []).filter((request: RecordedRead) => {
          return request.modelName === name;
        }),
      ),
    );
  }, modelName);
}

async function dataAlertQueries(page: Page): Promise<Array<unknown>> {
  return (await reads(page, "DataAlert")).map((request: RecordedRead) => {
    return request.query;
  });
}

/*
 * Lets the page draw what its reads answered: a frame, then a task, so a
 * card that was going to be drawn is there to be seen before a test says it
 * is not.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  });
}

const OWN_DATA_ALERT_QUERY: unknown = {
  alertId: { _type: "ObjectID", value: ALERT_ID },
};
const CAUSED_DATA_ALERTS_QUERY: unknown = {
  causeAlertId: { _type: "ObjectID", value: ALERT_ID },
};

test.describe("an alert's Data card", () => {
  test("an alert no data monitor raised asks for its data alert and what it caused, and draws neither card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH);

    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return dataAlertQueries(page);
      })
      .toEqual(
        expect.arrayContaining([
          OWN_DATA_ALERT_QUERY,
          CAUSED_DATA_ALERTS_QUERY,
        ]),
      );
    await settle(page);

    await expect(dataCard(page)).toHaveCount(0);
    await expect(impactCard(page)).toHaveCount(0);
    // Nothing more is read for an alert that is no data alert.
    expect(await reads(page, "DataAssetUsage")).toEqual([]);
    expect(await reads(page, CHANGE_EVENTS)).toEqual([]);
  });

  test("a refused data alert read draws nothing and leaves the rest of the page whole (?fail=data-alert)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "fail=data-alert");

    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return dataAlertQueries(page);
      })
      .toEqual(expect.arrayContaining([OWN_DATA_ALERT_QUERY]));
    await settle(page);

    await expect(dataCard(page)).toHaveCount(0);
    await expect(impactCard(page)).toHaveCount(0);
    // The cards after it are drawn as ever.
    await expect(cardTitled(page, "Alert Feed")).toBeVisible();
  });

  test("a data alert's card says what it is about, the alert upstream that caused it, who writes its table and what changed (?data=table)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table");

    const card: Locator = dataCard(page);
    await expect(card).toBeVisible();

    // About: the table, linked to its page.
    await expect(
      part(card, "About").getByRole("link", { name: TABLE_NAME }),
    ).toHaveAttribute("href", TABLE_PATH);

    // Caused Upstream: alert #310, linked, and why this one started acknowledged.
    const cause: Locator = part(card, "Caused Upstream");
    await expect(cause.getByRole("link", { name: CAUSE_NAME })).toHaveAttribute(
      "href",
      CAUSE_PATH,
    );
    await expect(cause).toContainText(STARTED_ACKNOWLEDGED);

    // Written By: both services that write the table, last seen first.
    await expect(part(card, "Written By").locator("dd > div")).toHaveText([
      /^payments-webhooks\s*4,120 writes, 37 failed, in the hour last seen 15 minutes ago$/,
      /^checkout-api\s*860 writes, 0 failed, in the hour last seen 30 minutes ago$/,
    ]);

    // Changes Around It: payments-webhooks' deploy, eight minutes before.
    const changes: Locator = part(card, "Changes Around It");
    await expect(changes.locator("dd > div")).toHaveText([
      /Deployed payments-webhooks v2\.14\.0\s*payments-webhooks$/,
    ]);
    await expect(changes).not.toContainText(NO_CHANGES);

    // This alert caused nothing downstream.
    await expect(impactCard(page)).toHaveCount(0);
  });

  test("with its writers' changes refused, the card still says what it is about, its cause and who writes the table, and nothing of changes (?data=table&fail=data-changes)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table&fail=data-changes");

    const card: Locator = dataCard(page);
    await expect(
      part(card, "About").getByRole("link", { name: TABLE_NAME }),
    ).toBeVisible();
    await expect(
      part(card, "Caused Upstream").getByRole("link", { name: CAUSE_NAME }),
    ).toBeVisible();
    await expect(part(card, "Written By").locator("dd > div")).toHaveText([
      /^payments-webhooks\s*4,120 writes, 37 failed, in the hour last seen 15 minutes ago$/,
      /^checkout-api\s*860 writes, 0 failed, in the hour last seen 30 minutes ago$/,
    ]);

    // The changes were asked for, and refused.
    expect(await reads(page, CHANGE_EVENTS)).toHaveLength(1);

    // So the card says nothing of them - not that there were none.
    await expect(part(card, "Changes Around It")).toHaveCount(0);
    await expect(card).not.toContainText(NO_CHANGES);
    await expect(card).not.toContainText("Deployed payments-webhooks v2.14.0");
  });

  test("when who writes its table cannot be read, the card still says what it is about and what caused it (?data=table&fail=data-writers)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table&fail=data-writers");

    const card: Locator = dataCard(page);
    await expect(
      part(card, "About").getByRole("link", { name: TABLE_NAME }),
    ).toHaveAttribute("href", TABLE_PATH);
    await expect(
      part(card, "Caused Upstream").getByRole("link", { name: CAUSE_NAME }),
    ).toHaveAttribute("href", CAUSE_PATH);

    // The writers were asked for, and the read failed.
    expect(await reads(page, "DataAssetUsage")).toHaveLength(1);

    // So neither they nor their changes are told, and no changes are read.
    await expect(part(card, "Written By")).toHaveCount(0);
    await expect(part(card, "Changes Around It")).toHaveCount(0);
    expect(await reads(page, CHANGE_EVENTS)).toEqual([]);
  });

  test("the cause's page lists the alert it caused downstream, on the table built from its own (?data=table)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CAUSE_PATH, "data=table");

    const impact: Locator = impactCard(page);
    await expect(impact).toBeVisible();
    await expect(
      impact.getByRole("link", { name: TABLE_NAME }),
    ).toHaveAttribute("href", TABLE_PATH);
    await expect(
      impact.getByRole("link", { name: ALERT_NAME }),
    ).toHaveAttribute("href", ALERT_PATH);

    // Its own card: about the table upstream, caused by nothing upstream of it.
    const card: Locator = dataCard(page);
    await expect(
      part(card, "About").getByRole("link", { name: CAUSE_TABLE_NAME }),
    ).toHaveAttribute("href", CAUSE_TABLE_PATH);
    await expect(part(card, "Caused Upstream")).toHaveCount(0);
  });
});

test.describe("an alert's Lineage card", () => {
  test("draws the alert's table and the table it is built from, the way up to its cause picked out (?data=table)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table");

    const card: Locator = lineageCard(page);
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toContainText(
      "The way up to the alert that caused this one is highlighted.",
    );

    // The alert's own table says whose page it is on; the table of its cause is marked Cause.
    await expect(lineageNode(card, TABLE_CARD)).toContainText(
      "payments.ledger_entries",
    );
    await expect(lineageNode(card, TABLE_CARD)).toContainText("This alert");
    await expect(lineageNode(card, CAUSE_TABLE_CARD)).toHaveAttribute(
      "data-role",
      "Cause",
    );
    await expect(lineageNode(card, CAUSE_TABLE_CARD)).toContainText(
      "payments.provider_callbacks",
    );
    await expect(card.getByTestId("lineage-edge-halo")).toHaveCount(1);
    // The sentence saying the way is highlighted starts with the way's own mark; the legend leaves the ways to it.
    await expect(
      card
        .getByTestId("lineage-highlight-notes")
        .getByTestId("lineage-highlight-mark"),
    ).toHaveCount(1);
    await expect(card.getByTestId("lineage-legend")).toContainText(
      "Pipeline run",
    );
    await expect(card.getByTestId("lineage-legend")).not.toContainText("cause");
    await expect(
      card.getByRole("button", { name: "Explore Lineage" }),
    ).toBeVisible();

    // The drawing opens with the cause's card in view, and the alert's own.
    const [canvas, ...nodeBoxes] = await boxesInOneFrame([
      card.getByTestId("lineage-graph"),
      lineageNode(card, CAUSE_TABLE_CARD),
      lineageNode(card, TABLE_CARD),
    ]);

    for (const box of nodeBoxes) {
      expect(box.x).toBeGreaterThanOrEqual(canvas!.x);
      expect(box.x + box.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
    }

    // Under the Data card, asked for once.
    const [dataBox, lineageBox] = await boxesInOneFrame([dataCard(page), card]);
    expect(lineageBox!.y).toBeGreaterThan(dataBox!.y);
    expect(await lineageReads(page, ALERT_ID)).toBe(1);

    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await card.screenshot({
      path: path.join(SCREENSHOTS, "data-alert-lineage-synthetic.png"),
      animations: "disabled",
    });
  });

  test("an alert from a check on one column opens with that column followed, beside the way to its cause (?data=table&check=column)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table&check=column");

    const card: Locator = lineageCard(page);
    await expect(card).toBeVisible({ timeout: 30000 });

    // The picker names the check's column, the sentence says it is followed, each card on its way names it there.
    await expect(card.getByTestId("lineage-column")).toContainText(
      "provider_reference",
    );
    await expect(card.getByTestId("lineage-column-notes")).toContainText(
      "provider_reference is highlighted where it comes from and where it goes.",
    );
    await expect(
      lineageNode(card, TABLE_CARD).getByTestId("lineage-card-columns"),
    ).toHaveText("provider_reference");
    await expect(
      lineageNode(card, CAUSE_TABLE_CARD).getByTestId("lineage-card-columns"),
    ).toHaveText("callback_reference");

    // The way to its cause stays picked out, its card still marked Cause.
    await expect(card).toContainText(
      "The way up to the alert that caused this one is highlighted.",
    );
    await expect(lineageNode(card, CAUSE_TABLE_CARD)).toHaveAttribute(
      "data-role",
      "Cause",
    );
    await expect(lineageNode(card, CAUSE_TABLE_CARD)).not.toHaveAttribute(
      "data-dimmed",
      "true",
    );
    expect(await lineageReads(page, ALERT_ID)).toBe(1);
    await expectNoSidewaysScroll(page, { tolerance: 1 });

    /*
     * One block of sentences right over the drawing, under what lies each
     * way and the picker: the alert's way, then the column's, their marks
     * one over the other.
     */
    const [summary, picker, ways, column, graph] = await boxesInOneFrame([
      card.getByTestId("lineage-summary"),
      card.getByTestId("lineage-column"),
      card.getByTestId("lineage-highlight-notes"),
      card.getByTestId("lineage-column-notes"),
      card.getByTestId("lineage-graph"),
    ]);
    expect(ways!.y).toBeGreaterThanOrEqual(summary!.y + summary!.height);
    expect(ways!.y).toBeGreaterThanOrEqual(picker!.y + picker!.height);
    expect(column!.y).toBeGreaterThanOrEqual(ways!.y + ways!.height);
    expect(graph!.y).toBeGreaterThanOrEqual(column!.y + column!.height);
    const marks: Array<{ x: number }> = await boxesInOneFrame([
      card
        .getByTestId("lineage-highlight-notes")
        .getByTestId("lineage-highlight-mark"),
      card
        .getByTestId("lineage-column-notes")
        .getByTestId("lineage-highlight-mark"),
    ]);
    expect(Math.abs(marks[0]!.x - marks[1]!.x)).toBeLessThan(1);

    // The picker has room for the check's column's whole name beside its controls.
    await expect
      .poll(async (): Promise<boolean> => {
        return card
          .getByTestId("lineage-column")
          .getByTestId("dropdown-value-label")
          .evaluate((element: HTMLElement): boolean => {
            return element.scrollWidth <= element.clientWidth;
          });
      })
      .toBe(true);
    // On a phone it takes the whole line, as wide as the drawing under it.
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect
      .poll(async (): Promise<number> => {
        const [picker, drawing] = await boxesInOneFrame([
          card.getByTestId("lineage-column"),
          card.getByTestId("lineage-graph"),
        ]);
        return Math.round(Math.abs(picker!.width - drawing!.width));
      })
      .toBe(0);
    await page.setViewportSize({ width: 1280, height: 1000 });

    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await card.screenshot({
      path: path.join(SCREENSHOTS, "data-alert-lineage-column-synthetic.png"),
      animations: "disabled",
    });

    // Cleared: the column is no longer named on the cards, and the cause still is.
    await card
      .getByTestId("lineage-column")
      .locator(".ou-select__clear-indicator")
      .dispatchEvent("mousedown", { button: 0 });
    await expect(card.getByTestId("lineage-column-notes")).toHaveCount(0);
    await expect(card.getByTestId("lineage-card-columns")).toHaveCount(0);
    await expect(card.getByTestId("lineage-column")).toContainText(
      "Follow a column",
    );
    await expect(lineageNode(card, CAUSE_TABLE_CARD)).toHaveAttribute(
      "data-role",
      "Cause",
    );
  });

  /*
   * A cause on the pipeline drawn on the arrow, its name longer than the
   * label's room (LINEAGE_EDGE_LABEL_MAX_WIDTH, 84px, in LineageGraphModel):
   * the name is cut at its end and the word the cause's card says sits
   * whole under it, inside that room, in the longest of the languages'
   * words (German) and right to left (Persian, Arabic), on a phone and dark
   * too. The arrow runs level - its two cards side by side - so the label
   * sits just over it, clear of it; its words read on the page's ground;
   * and on a phone the drawing opens with the whole label in view.
   */
  const CAUSE_LABEL_ROOM: number = 84;

  for (const look of [
    { language: "en", word: "Cause", width: 1280, theme: "light" },
    { language: "de", word: "Ursache", width: 1280, theme: "dark" },
    { language: "fa", word: "علت", width: 390, theme: "dark" },
    { language: "en", word: "Cause", width: 390, theme: "light" },
    { language: "ar", word: "السبب", width: 1024, theme: "light" },
  ] as Array<{
    language: string;
    word: string;
    width: number;
    theme: "light" | "dark";
  }>) {
    test(`a cause on the pipeline on its arrow: the arrow says ${look.word} under the pipeline's name, inside the label's room (?data=table&cause=pipeline, ${look.language}, ${look.width}px, ${look.theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(
        page,
        ALERT_PATH,
        `data=table&cause=pipeline${
          look.language === "en" ? "" : `&lang=${look.language}&dir=auto`
        }${look.theme === "dark" ? "&theme=dark" : ""}`,
      );
      await page.setViewportSize({ width: look.width, height: 1000 });

      const label: Locator = page.getByTestId("lineage-edge-label");
      await expect(label).toBeVisible({ timeout: 30000 });
      await expect(label).toHaveAttribute(
        "title",
        "payments_callbacks_hourly_sync",
      );
      await expect(label.getByTestId("lineage-edge-name")).toHaveText(
        "payments_callbacks_hourly_sync",
      );
      await expect(label.getByTestId("lineage-edge-cause")).toHaveText(
        look.word,
      );
      // The cause is the pipeline: no table's card is marked Cause.
      await expect(page.locator('[data-role="Cause"]')).toHaveCount(0);

      const fit: {
        labelWidth: number;
        nameCut: boolean;
        wordWhole: boolean;
        wordInside: boolean;
        wordUnderName: boolean;
      } = await label.evaluate((element: HTMLElement) => {
        const name: HTMLElement = element.querySelector(
          '[data-testid="lineage-edge-name"]',
        ) as HTMLElement;
        const word: HTMLElement = element.querySelector(
          '[data-testid="lineage-edge-cause"] [data-testid="pill-text"]',
        ) as HTMLElement;
        const box: DOMRect = element.getBoundingClientRect();
        const wordBox: DOMRect = word.getBoundingClientRect();
        const nameBox: DOMRect = name.getBoundingClientRect();

        return {
          // Layout width: the drawing's zoom does not change it.
          labelWidth: element.offsetWidth,
          nameCut: name.scrollWidth > name.clientWidth,
          wordWhole: word.scrollWidth <= word.clientWidth,
          wordInside:
            wordBox.left >= box.left - 0.5 && wordBox.right <= box.right + 0.5,
          wordUnderName: wordBox.top >= nameBox.bottom - 0.5,
        };
      });

      expect(fit).toEqual({
        labelWidth: fit.labelWidth,
        nameCut: true,
        wordWhole: true,
        wordInside: true,
        wordUnderName: true,
      });
      expect(fit.labelWidth).toBeLessThanOrEqual(CAUSE_LABEL_ROOM);
      await expectNoSidewaysScroll(page, { tolerance: 1 });

      // Just over the level arrow, clear of it and of its halo: the arrow and its head still show.
      await expect(label).toHaveAttribute("data-lineage-label-place", "over");
      const [labelBox, line] = await boxesInOneFrame([
        label,
        page.locator(".react-flow__edge-path"),
      ]);
      expect(line!.height).toBeLessThan(1);
      expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(line!.y - 1);
      expect(labelBox!.x).toBeGreaterThan(line!.x);
      expect(labelBox!.x + labelBox!.width).toBeLessThan(line!.x + line!.width);

      // Its words read on its ground, on a light page and a dark one.
      const drawn: { text: string; background: string } = await label.evaluate(
        (element: HTMLElement): { text: string; background: string } => {
          const style: CSSStyleDeclaration = getComputedStyle(element);
          return { text: style.color, background: style.backgroundColor };
        },
      );
      expect(
        contrastRatio(drawn.text, drawn.background),
      ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);

      // The drawing opens with the whole label in view, on a phone too.
      const [canvas, opened] = await boxesInOneFrame([
        page.getByTestId("lineage-graph"),
        label,
      ]);
      expect(opened!.x).toBeGreaterThanOrEqual(canvas!.x);
      expect(opened!.x + opened!.width).toBeLessThanOrEqual(
        canvas!.x + canvas!.width,
      );
      expect(opened!.y).toBeGreaterThanOrEqual(canvas!.y);
      expect(opened!.y + opened!.height).toBeLessThanOrEqual(
        canvas!.y + canvas!.height,
      );

      await fs.mkdir(SCREENSHOTS, { recursive: true });
      await label.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.getByTestId("lineage-graph").screenshot({
        path: path.join(
          SCREENSHOTS,
          `data-alert-lineage-cause-pipeline-${look.language}-${look.width}-${look.theme}.png`,
        ),
        animations: "disabled",
      });
    });
  }

  test("a cause on the pipeline on its arrow whose latest run failed: the arrow red, its name red and said failed under the pointer, Cause still under it (?data=table&cause=pipeline&run=failed)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table&cause=pipeline&run=failed");

    const label: Locator = page.getByTestId("lineage-edge-label");
    await expect(label).toBeVisible({ timeout: 30000 });
    await expect(label).toHaveAttribute(
      "title",
      "payments_callbacks_hourly_sync failed",
    );
    await expect(label.getByTestId("lineage-edge-cause")).toHaveText("Cause");
    await expect(label).toHaveClass(/\btext-red-600\b/);
    await expect(page.locator(".react-flow__edge-path")).toHaveCSS(
      "stroke",
      "rgb(239, 68, 68)",
    );

    const drawn: { text: string; background: string } = await label.evaluate(
      (element: HTMLElement): { text: string; background: string } => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return { text: style.color, background: style.backgroundColor };
      },
    );
    expect(drawn.text).toBe("rgb(220, 38, 38)");
    expect(contrastRatio(drawn.text, drawn.background)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    );

    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await label.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.getByTestId("lineage-graph").screenshot({
      path: path.join(
        SCREENSHOTS,
        "data-alert-lineage-cause-pipeline-failed-en-1280-light.png",
      ),
      animations: "disabled",
    });
  });

  test("the cause's page draws the way down to the alert it caused (?data=table)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CAUSE_PATH, "data=table");

    const card: Locator = lineageCard(page);
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toContainText(
      "The way down to the alert this one caused is highlighted.",
    );
    await expect(lineageNode(card, TABLE_CARD)).toHaveAttribute(
      "data-role",
      "Consequence",
    );
    await expect(lineageNode(card, CAUSE_TABLE_CARD)).toContainText(
      "This alert",
    );
  });

  test("an alert no data monitor raised has no Lineage card, and none is asked for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH);

    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return dataAlertQueries(page);
      })
      .toEqual(expect.arrayContaining([OWN_DATA_ALERT_QUERY]));
    await settle(page);

    await expect(lineageCard(page)).toHaveCount(0);
    expect(await lineageReads(page, ALERT_ID)).toBe(0);
  });

  test("with its data alert refused, no Lineage card is drawn and none is asked for (?data=table&fail=data-alert)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table&fail=data-alert");

    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return dataAlertQueries(page);
      })
      .toEqual(expect.arrayContaining([OWN_DATA_ALERT_QUERY]));
    await settle(page);

    await expect(lineageCard(page)).toHaveCount(0);
    expect(await lineageReads(page, ALERT_ID)).toBe(0);
    await expect(cardTitled(page, "Alert Feed")).toBeVisible();
  });
});
