import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * A resource's Overview drawn with ResourceOverview - a service's, a
 * database's and a queue's - in a browser, against the offline fixture
 * (ResourceOverviews/Fixture).
 *
 * #5298 merged with its UI review unfinished; the review finished here:
 *
 *   - the Details card ends with the record's ID line, as every details
 *     card does, where a service's, a database's and a queue's card led
 *     with a 36-character "Service ID" row; a database's and a queue's link
 *     to their Settings page, as the others' do;
 *   - the labels are a phone's card only: from 640px the page's header
 *     lists them, and the card under Details said them a second time;
 *   - a long value wraps inside its row, a name after its own dots and
 *     slashes, and words are set in words, not in monospace;
 *   - the description is the hero's line, under the name, two lines at
 *     most, at every width - it was the Details card's line, which a card
 *     hides on a phone;
 *   - the hero's controls keep to the row's end when they wrap from 768px,
 *     as every other resource hero's do - they wrapped to the left - and
 *     to its other end on a right-to-left page.
 *
 * Read the way a person reads them: at a phone's, a tablet's (beside the
 * side menu) and a laptop's width, light and dark, in German and right to
 * left. The fixture records every read; nothing it does not model may be
 * asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const SERVICE_ID: string = "71000000-0000-4000-8000-000000000001";
const DATABASE_ID: string = "73000000-0000-4000-8000-000000000001";
const QUEUE_ID: string = "74000000-0000-4000-8000-000000000001";

const SERVICE_PAGE: string = `/dashboard/${PROJECT_ID}/service/${SERVICE_ID}`;
const DATABASE_PAGE: string = `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}`;
const QUEUE_PAGE: string = `/dashboard/${PROJECT_ID}/queues/${QUEUE_ID}`;

const DESCRIPTION: string =
  "Takes the basket to an order: prices it, reserves stock and charges the card.";
const LONG_DESCRIPTION: string =
  "Reserves stock for every basket across the three EU warehouses, releases it when an order is cancelled, and reconciles the counts each night against the warehouse management system's own export.";
// Its last word, which Show more brings into view.
const LONG_DESCRIPTION_END: RegExp = /export\.$/;
// A service named as a Kubernetes rollout names it (?resource=long).
const LONG_SERVICE_NAME: string =
  "inventory-reservation-service-eu-west-2-canary-blue";
const DESCRIPTION_TOGGLE: string = "resource-hero-description-toggle";

const LABELS: Array<string> = ["payments", "production", "team-checkout"];

const PHONE: { width: number; height: number } = { width: 390, height: 844 };
const TABLET: { width: number; height: number } = { width: 768, height: 1024 };
const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/resource-overviews-ui",
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

interface Recorded {
  unhandled: Array<Record<string, unknown>>;
  apiRequests: Array<{ method: string; url: string }>;
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
          window as unknown as { __resourceOverviewsFixture?: Recorded }
        ).__resourceOverviewsFixture;
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

async function openOverview(
  page: Page,
  pagePath: string,
  query: string = "",
): Promise<void> {
  await page.goto(withQuery(pagePath, query));
  await expect(page.getByTestId("resource-overview-header-row")).toBeVisible();
  await expect(
    page.getByTestId("resource-overview-details-body"),
  ).toBeVisible();
}

// The Details card's rows, as label: value.
async function detailRows(page: Page): Promise<Array<string>> {
  return await page
    .getByTestId("resource-overview-detail-row")
    .evaluateAll((rows: Array<Element>): Array<string> => {
      return rows.map((row: Element): string => {
        const term: string = row.querySelector("dt")?.textContent || "";
        const value: string = row.querySelector("dd")?.textContent || "";
        return `${term}: ${value}`;
      });
    });
}

function valueOfRow(page: Page, label: string): Locator {
  return page
    .getByTestId("resource-overview-detail-row")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .getByTestId("resource-overview-detail-value");
}

// The labels the page's header lists beside its title, from 640px.
function headerLabels(page: Page): Locator {
  return page
    .locator("span.uppercase", { hasText: /^Labels$/ })
    .locator("xpath=..");
}

/*
 * ---------------------------------------------------------------------------
 * The Details card
 * ---------------------------------------------------------------------------
 */
test.describe("the Details card ends with the record's ID line", () => {
  test("a service: its reported facts, in order, no ID row, the ID line last and Edit in Settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, SERVICE_PAGE);

    expect(await detailRows(page)).toEqual([
      "Technology: NodeJS, TypeScript",
      "Runtime: nodejs 20.11.1",
      "Service Version: 2.7.0",
      "Deployment Environment: production",
      "Service Namespace: shop",
      "Cloud Provider: aws",
      "Cloud Platform: aws_ecs",
      "Cloud Region: eu-west-1",
      "Cloud Account ID: 123456789012",
    ]);
    await expect(page.getByText("Service ID", { exact: true })).toHaveCount(0);

    const body: Locator = page.getByTestId("resource-overview-details-body");
    const line: Locator = body.getByTestId("detail-id-line");
    await expect(line.getByTestId("detail-id-value")).toHaveText(SERVICE_ID);
    // Clipped to its first group, with the copy button beside it.
    const value: Box = await boxOf(line.getByTestId("detail-id-value"));
    expect(value.width).toBeLessThan(120);
    await expect(line.getByTestId("detail-id-copy")).toBeVisible();

    // Under every row.
    const lastRow: Box = await boxOf(
      page.getByTestId("resource-overview-detail-row").last(),
    );
    expect((await boxOf(line)).y).toBeGreaterThanOrEqual(
      lastRow.y + lastRow.height,
    );

    await expect(
      page.getByTestId("edit-in-settings").getByRole("link"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/${SERVICE_ID}/settings`,
    );
  });

  test("a new service: its one reported fact and its ID line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, SERVICE_PAGE, "resource=new");

    expect(await detailRows(page)).toEqual(["Technology: Node.js"]);
    await expect(
      page
        .getByTestId("resource-overview-details-body")
        .getByTestId("detail-id-value"),
    ).toHaveText(SERVICE_ID);
    // Nothing to say under the name, no labels to list.
    await expect(page.getByTestId("resource-hero-description")).toHaveCount(0);
    await expect(page.getByTestId("resource-overview-labels")).toHaveCount(0);
  });

  test("a database and a queue: their ID line, no ID row, and a link to their Settings page", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [pagePath, id, idRow, settings] of [
      [
        DATABASE_PAGE,
        DATABASE_ID,
        "Database ID",
        `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}/settings`,
      ],
      [
        QUEUE_PAGE,
        QUEUE_ID,
        "Queue ID",
        `/dashboard/${PROJECT_ID}/queues/${QUEUE_ID}/settings`,
      ],
    ] as Array<[string, string, string, string]>) {
      await openOverview(page, pagePath);

      await expect(
        page
          .getByTestId("resource-overview-details-body")
          .getByTestId("detail-id-value"),
      ).toHaveText(id);
      await expect(page.getByText(idRow, { exact: true })).toHaveCount(0);

      const link: Locator = page
        .getByTestId("edit-in-settings")
        .getByRole("link");
      await expect(link).toHaveAttribute("href", settings);
    }

    // The link goes where it says.
    await page.getByTestId("edit-in-settings").getByRole("link").click();
    await expect(page.getByTestId("stub-page")).toHaveText(
      `/dashboard/${PROJECT_ID}/queues/${QUEUE_ID}/settings`,
    );
  });

  test("a database's own words are set in words, its reported values in monospace", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, DATABASE_PAGE);

    const fontOf: (label: string) => Promise<string> = async (
      label: string,
    ): Promise<string> => {
      return await valueOfRow(page, label).evaluate(
        (element: Element): string => {
          return getComputedStyle(element).fontFamily;
        },
      );
    };

    await expect(valueOfRow(page, "Discovered from")).toHaveText(
      "Application traces",
    );
    expect(await fontOf("Discovered from")).not.toMatch(/mono/i);
    expect(await fontOf("Engine metrics")).not.toMatch(/mono/i);
    expect(await fontOf("Version")).toMatch(/mono/i);
    expect(await fontOf("Endpoints")).toMatch(/mono/i);
  });

  test("in German: the rows' labels read in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, SERVICE_PAGE, "lang=de");

    const labels: Array<string> = (await detailRows(page)).map(
      (row: string): string => {
        return row.split(": ")[0]!;
      },
    );
    expect(labels).toEqual(
      [
        "Technology",
        "Runtime",
        "Service Version",
        "Deployment Environment",
        "Service Namespace",
        "Cloud Provider",
        "Cloud Platform",
        "Cloud Region",
        "Cloud Account ID",
      ].map((english: string): string => {
        return GERMAN[english] || english;
      }),
    );
    expect(labels).toContain(GERMAN["Cloud Account ID"]);
    expect(GERMAN["Cloud Account ID"]).not.toBe("Cloud Account ID");
  });
});

test.describe("the labels: the header's from 640px, a card of their own on a phone", () => {
  test("on a phone, a card under Details lists them; the header does not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, SERVICE_PAGE);

    const card: Locator = page.getByTestId("resource-overview-labels");
    await expect(card).toBeVisible();
    for (const name of LABELS) {
      await expect(card).toContainText(name);
    }
    await expect(headerLabels(page)).toBeHidden();

    // Under the Details card, inside the page.
    const cardBox: Box = await boxOf(card);
    const details: Box = await boxOf(
      page.getByTestId("resource-overview-details-body"),
    );
    expect(cardBox.y).toBeGreaterThan(details.y + details.height);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(PHONE.width);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "resource-overview-service-phone");
  });

  test("beside the side menu and at a laptop's width, the header lists them and there is no card", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [TABLET, LAPTOP]) {
      await page.setViewportSize(size);
      await openOverview(page, SERVICE_PAGE);

      await expect(headerLabels(page)).toBeVisible();
      for (const name of LABELS) {
        await expect(headerLabels(page)).toContainText(name);
      }
      await expect(page.getByTestId("resource-overview-labels")).toBeHidden();
    }

    await screenshot(page, "resource-overview-service-laptop");
  });
});

test.describe("a long value wraps inside its row, where it reads", () => {
  test("on a phone and beside the side menu: a name after its own dots, never past the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [PHONE, TABLET]) {
      await page.setViewportSize(size);
      await openOverview(page, SERVICE_PAGE, "resource=long");

      const namespace: Locator = valueOfRow(page, "Service Namespace");
      await expect(namespace).toHaveText(
        "com.acme-commerce.inventory.reservations",
      );
      const lines: Array<string> = await linesOf(namespace);
      for (const line of lines.slice(0, -1)) {
        expect({ line, endsAfterADot: line.endsWith(".") }).toEqual({
          line,
          endsAfterADot: true,
        });
      }

      // Every value inside its card.
      const body: Box = await boxOf(
        page.getByTestId("resource-overview-details-body"),
      );
      const values: Locator = page.getByTestId(
        "resource-overview-detail-value",
      );
      for (let index: number = 0; index < (await values.count()); index++) {
        const value: Box = await boxOf(values.nth(index));
        expect(value.x + value.width).toBeLessThanOrEqual(
          body.x + body.width + 0.5,
        );
      }
      await expectNoSidewaysScroll(page);
    }

    await page.setViewportSize(PHONE);
    await screenshot(page, "resource-overview-service-long-phone");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The hero
 * ---------------------------------------------------------------------------
 */
test.describe("the hero: the description under the name, the controls at the row's end", () => {
  test("the description is the hero's line at every width: two lines, and Show more exactly when there is more", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [PHONE, TABLET, LAPTOP]) {
      await page.setViewportSize(size);
      await openOverview(page, SERVICE_PAGE, "resource=long");

      const description: Locator = page.getByTestId(
        "resource-hero-description",
      );
      await expect(description).toBeVisible();
      await expect(description).toHaveText(LONG_DESCRIPTION);
      // Never in a hover title only: a phone and a keyboard never show one.
      await expect(description).not.toHaveAttribute("title");
      await expect(
        page.getByTestId("resource-overview-title-block"),
      ).toContainText("Reserves stock for every basket");

      const box: Box = await boxOf(description);
      expect(box.height).toBeLessThanOrEqual(
        2 * (await lineHeightOf(description)) + 1,
      );
      // Show more under it when its words run past two lines, and only then.
      const hidesWords: boolean = await description.evaluate(
        (element: Element): boolean => {
          return element.scrollHeight > element.clientHeight + 1;
        },
      );
      await expect(page.getByTestId(DESCRIPTION_TOGGLE)).toHaveCount(
        hidesWords ? 1 : 0,
      );
      // Not the Details card's line any more.
      await expect(
        page.getByTestId("resource-overview-details-body"),
      ).not.toContainText("Reserves stock");
      await expectNoSidewaysScroll(page);
    }
  });

  test("on a phone, Show more opens the whole description and Show less closes it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, SERVICE_PAGE, "resource=long");

    const description: Locator = page.getByTestId("resource-hero-description");
    const toggle: Locator = page.getByTestId(DESCRIPTION_TOGGLE);
    const lineHeight: number = await lineHeightOf(description);

    await expect(toggle).toHaveText("Show more");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute(
      "aria-controls",
      (await description.getAttribute("id")) || "",
    );
    // Under the words, its own words starting where theirs do.
    const closed: Box = await boxOf(description);
    const toggleBox: Box = await boxOf(toggle);
    expect(toggleBox.y).toBeGreaterThanOrEqual(closed.y + closed.height - 0.5);
    expect(Math.abs(toggleBox.x + 6 - closed.x)).toBeLessThanOrEqual(1);
    await screenshot(page, "resource-overview-service-description-phone");

    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect((await boxOf(description)).height).toBeGreaterThan(
      2 * lineHeight + 1,
    );
    const lines: Array<string> = await linesOf(description);
    expect(lines[lines.length - 1]).toMatch(LONG_DESCRIPTION_END);
    expect(
      await description.evaluate((element: Element): boolean => {
        return element.scrollHeight <= element.clientHeight + 1;
      }),
    ).toBe(true);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "resource-overview-service-description-phone-open");

    // The keyboard closes it as a click does.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveText("Show more");
    expect((await boxOf(description)).height).toBeLessThanOrEqual(
      2 * lineHeight + 1,
    );
  });

  test("a short description has no Show more, at any width", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [TABLET, LAPTOP]) {
      await page.setViewportSize(size);
      await openOverview(page, SERVICE_PAGE);

      await expect(page.getByTestId("resource-hero-description")).toHaveText(
        DESCRIPTION,
      );
      await expect(page.getByTestId(DESCRIPTION_TOGGLE)).toHaveCount(0);
    }
  });

  test("a long name at a laptop's width keeps its room: whole, with the controls under it at the row's end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, SERVICE_PAGE, "resource=long");

    const name: Locator = page
      .getByTestId("resource-overview-title-block")
      .getByRole("heading", { level: 1 });
    await expect(name).toHaveText(LONG_SERVICE_NAME);
    // Not cut short beside the controls, as its own row did.
    expect(
      await name.evaluate((element: Element): boolean => {
        return element.scrollWidth > element.clientWidth + 0.5;
      }),
    ).toBe(false);

    const row: Box = await boxOf(
      page.getByTestId("resource-overview-header-row"),
    );
    const title: Box = await boxOf(
      page.getByTestId("resource-overview-title-block"),
    );
    const select: Box = await boxOf(
      page
        .getByTestId("resource-overview-controls")
        .getByRole("combobox", { name: "Auto-refresh" }),
    );
    expect(select.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(row.x + row.width - (select.x + select.width)).toBeLessThanOrEqual(
      1,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "resource-overview-service-long-name-laptop");
  });

  test("beside the side menu, the controls wrap under the title to the row's end; on a phone they start at its start", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [TABLET.width, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openOverview(page, SERVICE_PAGE);

      const row: Box = await boxOf(
        page.getByTestId("resource-overview-header-row"),
      );
      const title: Box = await boxOf(
        page.getByTestId("resource-overview-title-block"),
      );
      const select: Box = await boxOf(
        page
          .getByTestId("resource-overview-controls")
          .getByRole("combobox", { name: "Auto-refresh" }),
      );

      // Under the title, ending where the row ends.
      expect(select.y).toBeGreaterThanOrEqual(title.y + title.height);
      expect(row.x + row.width - (select.x + select.width)).toBeLessThanOrEqual(
        1,
      );
    }

    await page.setViewportSize(TABLET);
    await screenshot(page, "resource-overview-service-768");

    await page.setViewportSize(PHONE);
    await openOverview(page, SERVICE_PAGE);
    const row: Box = await boxOf(
      page.getByTestId("resource-overview-header-row"),
    );
    const picker: Box = await boxOf(
      page
        .getByTestId("resource-overview-controls")
        .getByRole("button")
        .first(),
    );
    expect(Math.abs(picker.x - row.x)).toBeLessThanOrEqual(1);
  });

  test("at a laptop's width the controls sit beside the title, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, SERVICE_PAGE);

    const title: Box = await boxOf(
      page.getByRole("heading", { level: 1 }).last(),
    );
    const controls: Box = await boxOf(
      page.getByTestId("resource-overview-controls"),
    );
    expect(controls.x).toBeGreaterThan(title.x + title.width);
    expect(controls.y).toBeLessThan(title.y + title.height);
    await expect(page.getByTestId("resource-hero-description")).toHaveText(
      DESCRIPTION,
    );
  });

  test("right to left, beside the side menu: the controls at the row's other end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(TABLET);
    await openOverview(page, DATABASE_PAGE, "dir=rtl");

    const row: Box = await boxOf(
      page.getByTestId("resource-overview-header-row"),
    );
    const select: Box = await boxOf(
      page
        .getByTestId("resource-overview-controls")
        .getByRole("combobox", { name: "Auto-refresh" }),
    );
    expect(Math.abs(select.x - row.x)).toBeLessThanOrEqual(1);

    const description: Locator = page.getByTestId("resource-hero-description");
    expect(
      await description.evaluate((element: Element): string => {
        return getComputedStyle(element).textAlign;
      }),
    ).toBe("right");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "resource-overview-database-rtl-768");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The services tables: a queue's Producers and Consumers, a database's
 * Calling services (?callers=)
 * ---------------------------------------------------------------------------
 */

/*
 * "A message queue's Consumers table header 'P95 PROCESSING' runs past its
 * card when the two cards share a row at 1280." Each table is measured in
 * the card that holds it: every column name and figure inside the card's
 * frame, no figure cut, no word broken inside itself - only a service's
 * name may be cut short, and then it says itself whole under the pointer.
 */
const QUEUE_TABLES: Array<string> = [
  "message-queue-producers",
  "message-queue-consumers",
];
const DATABASE_TABLE: string = "database-calling-services";

// A laptop's two widths, beside the side menu at 1024 and 768, and a phone.
const WIDTHS: Array<{ width: number; height: number }> = [
  LAPTOP,
  { width: 1440, height: 900 },
  { width: 1024, height: 900 },
  TABLET,
  PHONE,
];

interface TableFit {
  // Boxes past the card's frame, by what they say.
  outside: Array<string>;
  // Boxes whose words run past their own box (a name cut short is fine).
  overflowing: Array<string>;
  // Words a line ended inside of, with the line they ended.
  brokenWords: Array<string>;
  // Names cut short that do not say themselves whole under the pointer.
  cutWithoutTitle: Array<string>;
}

async function tableFit(page: Page, testId: string): Promise<TableFit> {
  return await page.getByTestId(testId).evaluate((table: Element): TableFit => {
    const card: Element | null = table.closest("[data-testid=card]");
    const frame: DOMRect = (
      card?.firstElementChild || table
    ).getBoundingClientRect();
    const fit: TableFit = {
      outside: [],
      overflowing: [],
      brokenWords: [],
      cutWithoutTitle: [],
    };
    const cells: Array<HTMLElement> = Array.from(
      table.querySelectorAll(
        "[role=columnheader], [role=rowheader], [role=cell]",
      ),
    ) as Array<HTMLElement>;

    for (const cell of cells) {
      const text: string = (cell.textContent || "").trim();
      const role: string = cell.getAttribute("role") || "";
      const box: DOMRect = cell.getBoundingClientRect();

      // A screen reader's column name on a phone has no box to place.
      if (box.width <= 1) {
        continue;
      }

      if (box.left < frame.left - 0.5 || box.right > frame.right + 0.5) {
        fit.outside.push(text);
      }

      const isCut: boolean = cell.scrollWidth > cell.clientWidth + 1;

      if (role === "rowheader") {
        if (isCut && cell.getAttribute("title") !== text) {
          fit.cutWithoutTitle.push(text);
        }
      } else if (isCut) {
        fit.overflowing.push(text);
      }

      // Each line but the last ends at a space or after a hyphen.
      const node: Node | null = cell.firstChild;
      if (role !== "columnheader" || !node) {
        continue;
      }
      const tops: Array<number> = [];
      const ends: Array<number> = [];
      for (let index: number = 0; index < text.length; index++) {
        const range: Range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect: DOMRect | undefined = range.getClientRects()[0];
        if (!rect || rect.width === 0) {
          continue;
        }
        const top: number = Math.round(rect.top);
        if (tops.length === 0 || Math.abs(tops[tops.length - 1]! - top) > 3) {
          if (tops.length > 0) {
            ends.push(index - 1);
          }
          tops.push(top);
        }
      }
      for (const end of ends) {
        const last: string = text.charAt(end);
        const next: string = text.charAt(end + 1);
        if (last !== "-" && last !== " " && next !== " ") {
          fit.brokenWords.push(text);
        }
      }
    }

    return fit;
  });
}

// Each column's left and right edge, in the header and in every row.
async function columnEdges(
  page: Page,
  testId: string,
): Promise<Array<Array<[number, number]>>> {
  return await page
    .getByTestId(testId)
    .evaluate((table: Element): Array<Array<[number, number]>> => {
      return Array.from(table.querySelectorAll("[role=row]")).map(
        (row: Element): Array<[number, number]> => {
          return Array.from(
            row.querySelectorAll("[role=columnheader], [role=cell]"),
          )
            .filter((cell: Element): boolean => {
              return cell.getBoundingClientRect().width > 1;
            })
            .slice(-3)
            .map((cell: Element): [number, number] => {
              const box: DOMRect = cell.getBoundingClientRect();
              return [Math.round(box.left), Math.round(box.right)];
            });
        },
      );
    });
}

test.describe("the services tables fit their cards", () => {
  test("a queue's two tables, at every width, in English and German: every column name and figure inside its card, no figure cut, no word broken inside itself", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Every width in English; German's longer words where they bite.
    for (const [query, widths] of [
      ["callers=busy", WIDTHS],
      ["callers=busy&lang=de", [LAPTOP, TABLET, PHONE]],
      ["callers=long", [LAPTOP]],
      ["callers=long&lang=de", [LAPTOP, PHONE]],
    ] as Array<[string, Array<{ width: number; height: number }>]>) {
      for (const size of widths) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await openOverview(page, QUEUE_PAGE, query);

        for (const testId of QUEUE_TABLES) {
          await expect(page.getByTestId(testId)).toBeVisible();
          expect({
            query,
            width: size.width,
            testId,
            ...(await tableFit(page, testId)),
          }).toEqual({
            query,
            width: size.width,
            testId,
            outside: [],
            overflowing: [],
            brokenWords: [],
            cutWithoutTitle: [],
          });
        }
        await expectNoSidewaysScroll(page);
      }
    }
  });

  test("two cards in a row at 1280: the column names fit beside the services' names, and every figure lines up under its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await openOverview(page, QUEUE_PAGE, "callers=busy");

    // The two cards share the row.
    const producers: Box = await boxOf(
      page.getByTestId("message-queue-producers"),
    );
    const consumers: Box = await boxOf(
      page.getByTestId("message-queue-consumers"),
    );
    expect(Math.abs(producers.y - consumers.y)).toBeLessThanOrEqual(1);
    expect(consumers.x).toBeGreaterThan(producers.x + producers.width);

    for (const testId of QUEUE_TABLES) {
      const edges: Array<Array<[number, number]>> = await columnEdges(
        page,
        testId,
      );
      const [header, ...rows] = edges;
      expect(header).toHaveLength(3);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toEqual(header);
      }
    }

    // The service names are whole: the column names give way instead.
    const consumersTable: Locator = page.getByTestId("message-queue-consumers");
    for (const name of [
      "analytics-ingest",
      "fulfillment-worker",
      "invoice-renderer",
    ]) {
      const cell: Locator = consumersTable
        .getByRole("rowheader")
        .filter({ hasText: name });
      expect(
        await cell.evaluate((element: Element): boolean => {
          return element.scrollWidth <= element.clientWidth + 1;
        }),
      ).toBe(true);
    }
    await expect(
      consumersTable.getByTestId("message-queue-consumers-footer"),
    ).toHaveText("Showing the 10 busiest of 12 consuming services.");
    await screenshot(page, "resource-overview-queue-services-1280");
  });

  test("on a phone each service is two lines: its name across the table, then its figures under the column names", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openOverview(page, QUEUE_PAGE, "callers=busy");

    const table: Locator = page.getByTestId("message-queue-consumers");
    const row: Locator = table
      .getByTestId("message-queue-consumers-row")
      .first();
    const name: Box = await boxOf(row.getByRole("rowheader"));
    const tableBox: Box = await boxOf(table);

    // Its name has the table's width, less its padding.
    expect(name.width).toBeGreaterThan(tableBox.width - 40);
    for (const cell of await row.getByRole("cell").all()) {
      const figure: Box = await boxOf(cell);
      expect(figure.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
    }

    // The figures under the column names; the names' column is a screen reader's.
    const [header, ...rows] = await columnEdges(
      page,
      "message-queue-consumers",
    );
    for (const edges of rows) {
      expect(edges).toEqual(header);
    }
    await expect(
      table.getByRole("columnheader", { name: "Service" }),
    ).toHaveClass(/sr-only/);
    await screenshot(page, "resource-overview-queue-services-phone");
  });

  test("a long service name is cut short to its column and says itself whole under the pointer", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [LAPTOP, PHONE]) {
      await page.setViewportSize(size);
      await openOverview(page, QUEUE_PAGE, "callers=long");

      const cell: Locator = page
        .getByTestId("message-queue-consumers")
        .getByRole("rowheader")
        .first();
      await expect(cell).toHaveAttribute(
        "title",
        "order-fulfillment-orchestrator-eu-west-2-canary-green",
      );
      expect(
        await cell.evaluate((element: Element): string => {
          return getComputedStyle(element).textOverflow;
        }),
      ).toBe("ellipsis");
    }
  });

  test("a database's calling services, a card of its own: one line per service at a laptop's width, two on a phone, inside the card in German too", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [query, widths] of [
      ["callers=busy", [LAPTOP, { width: 1024, height: 900 }, PHONE]],
      ["callers=long&lang=de", [LAPTOP, TABLET, PHONE]],
    ] as Array<[string, Array<{ width: number; height: number }>]>) {
      for (const size of widths) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await openOverview(page, DATABASE_PAGE, query);
        await expect(page.getByTestId(DATABASE_TABLE)).toBeVisible();

        expect({
          query,
          width: size.width,
          ...(await tableFit(page, DATABASE_TABLE)),
        }).toEqual({
          query,
          width: size.width,
          outside: [],
          overflowing: [],
          brokenWords: [],
          cutWithoutTitle: [],
        });
      }
    }

    await page.setViewportSize(LAPTOP);
    await openOverview(page, DATABASE_PAGE, "callers=busy");
    const row: Locator = page
      .getByTestId("database-calling-service-row")
      .first();
    const name: Box = await boxOf(row.getByRole("rowheader"));
    for (const cell of await row.getByRole("cell").all()) {
      const figure: Box = await boxOf(cell);
      // On the name's line.
      expect(Math.abs(figure.y - name.y)).toBeLessThanOrEqual(2);
    }
    // No figure's column narrower than 6rem, so the figures do not huddle.
    const tracks: Array<number> = await page
      .getByTestId(DATABASE_TABLE)
      .getByRole("table")
      .evaluate((grid: Element): Array<number> => {
        return getComputedStyle(grid)
          .gridTemplateColumns.split(" ")
          .map((track: string): number => {
            return parseFloat(track);
          });
      });
    expect(tracks).toHaveLength(4);
    for (const track of tracks.slice(1)) {
      expect(track).toBeGreaterThanOrEqual(96 - 0.5);
    }
    // The name takes the rest of a wide table.
    expect(tracks[0]!).toBeGreaterThan(tracks[1]! * 2);
    await screenshot(page, "resource-overview-database-callers-1280");
  });

  test("dark: the column names' band and the rows' lines read on a dark card", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [LAPTOP, PHONE]) {
      await page.setViewportSize(size);
      await openOverview(page, QUEUE_PAGE, "callers=busy&theme=dark");

      const header: Locator = page
        .getByTestId("message-queue-consumers")
        .getByRole("row")
        .first();
      const colors: { band: string; words: string } = await header.evaluate(
        (element: Element): { band: string; words: string } => {
          return {
            band: getComputedStyle(element).backgroundColor,
            words: getComputedStyle(element).color,
          };
        },
      );
      // Not the light theme's grey-50 band, and words that differ from it.
      expect(colors.band).not.toBe("rgb(249, 250, 251)");
      expect(colors.words).not.toBe(colors.band);
      expect({
        width: size.width,
        ...(await tableFit(page, "message-queue-consumers")),
      }).toEqual({
        width: size.width,
        outside: [],
        overflowing: [],
        brokenWords: [],
        cutWithoutTitle: [],
      });
    }
    await screenshot(page, "resource-overview-queue-services-phone-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Dark, and what the pages read
 * ---------------------------------------------------------------------------
 */
test.describe("dark, and what the pages read", () => {
  test("dark, on a phone and at a laptop's width: the Details card, its ID line and the labels card stay inside the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const size of [PHONE, LAPTOP]) {
      await page.setViewportSize(size);
      await openOverview(page, QUEUE_PAGE, "theme=dark");

      const line: Locator = page
        .getByTestId("resource-overview-details-body")
        .getByTestId("detail-id-line");
      await expect(line).toBeVisible();
      const colors: { text: string; card: string } = await line.evaluate(
        (element: Element): { text: string; card: string } => {
          let ancestor: Element | null = element.parentElement;
          let card: string = "";
          while (ancestor && !card) {
            const background: string =
              getComputedStyle(ancestor).backgroundColor;
            if (background && background !== "rgba(0, 0, 0, 0)") {
              card = background;
            }
            ancestor = ancestor.parentElement;
          }
          return { text: getComputedStyle(element).color, card };
        },
      );
      expect(colors.text).not.toBe(colors.card);
      await expectNoSidewaysScroll(page);
    }

    await page.setViewportSize(PHONE);
    await screenshot(page, "resource-overview-queue-phone-dark");
  });

  test("each Overview reads its record, and nothing the fixture does not model", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const pagePath of [SERVICE_PAGE, DATABASE_PAGE, QUEUE_PAGE]) {
      await openOverview(page, pagePath);
      const recorded: {
        itemRequests: Array<{ modelName: string }>;
      } = await page.evaluate(
        (): { itemRequests: Array<{ modelName: string }> } => {
          return (
            window as unknown as {
              __resourceOverviewsFixture: {
                itemRequests: Array<{ modelName: string }>;
              };
            }
          ).__resourceOverviewsFixture;
        },
      );
      expect(recorded.itemRequests.length).toBeGreaterThan(0);
    }
  });
});
