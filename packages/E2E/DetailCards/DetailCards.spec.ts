import { BrowserContext, expect, Locator, Page, test } from "@playwright/test";
import {
  CARD_GRID_GAP_IN_PX,
  CARD_GRID_MIN_CARD_WIDTH_IN_REM,
  CardGridLayout,
  getCardGridColumnsAt,
} from "Common/UI/Components/Card/CardGridLayout";
import fs from "fs/promises";
import path from "path";

/*
 * Detail cards (CardModelDetail -> ModelDetail -> Detail) in real Chromium,
 * against the offline fixture (DetailCards/Fixture): real Dashboard pages -
 * the "Basic Info" card of User Settings > Profile from the maintainer's
 * screenshot, Project Settings, a status page's Overview and a team's page -
 * and a gallery of every kind of field.
 *
 * The maintainer's ask: "How can we make this card model detail UI a lot
 * better, more modern, cleaner, and simpler for people to use and
 * understand? ... This should apply to all card model ui". The screenshot:
 * NAME and EMAIL side by side, EMAIL 20px lower; rules under each that
 * stopped at different widths; tracked capitals with a dot after each name.
 *
 * jsdom draws nothing, so what only a browser can show is measured here:
 * the fields of one row share their top in every column count and at every
 * width; the rule between two rows runs the whole width; the fields start
 * where the card's title does; long values wrap inside the card on a phone;
 * the names are muted and not upper-cased, the values dark - in both
 * themes, at WCAG AA; an empty value shows a dash or its own words; a copy
 * button is in view and copies; the documentation and the demo are in the
 * card's ⋯; a card loading keeps the shape it will have.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const PROFILE: string = `/dashboard/${PROJECT}/user-settings/profile`;
const PROJECT_SETTINGS: string = `/dashboard/${PROJECT}/settings/project`;
const STATUS_PAGE: string = `/dashboard/${PROJECT}/status-pages/30000000-0000-4000-8000-000000000001`;
const TEAM: string = `/dashboard/${PROJECT}/teams/50000000-0000-4000-8000-000000000001`;
const GALLERY: string = `/dashboard/${PROJECT}/detail-cards`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/detail-cards-ui",
);

// The widths a detail card is read at: phones, sm, md, lg and wide.
const WIDTHS: ReadonlyArray<number> = [390, 640, 768, 1024, 1280, 1440];

// The gallery's cards whose fields are laid out in the default grid.
const GRID_CARDS: ReadonlyArray<string> = [
  "one",
  "two",
  "three",
  "four",
  "code",
  "keys",
  "notes",
  "mixed",
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FieldMeasure {
  cell: Box;
  label: Box | null;
  value: Box;
  // A line under the name pushes the value down by as many lines as it has.
  hasDescription: boolean;
  borderTop: number;
  overflows: boolean;
}

interface FixtureRecord {
  itemRequests: Array<{ tableName: string; id: string }>;
  unmodelled: Array<string>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    // React's own warnings (invalid nesting, keys, refs) are errors here.
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the cards made is one the fixture answers as the API does.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
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
  address: string,
  width: number = 1280,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 900 });
  await page.goto(address);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("detail-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("detail-field").first()).toBeVisible();
}

function galleryCard(page: Page, name: string): Locator {
  return page.getByTestId(`gallery-${name}`);
}

function cardTitled(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function box(locator: Locator): Promise<Box> {
  const found: Box | null = await locator.boundingBox();
  if (!found) {
    throw new Error("No box: the element is not drawn");
  }
  return found;
}

// Every field of a card, measured as drawn.
async function measureFields(card: Locator): Promise<Array<FieldMeasure>> {
  return await card
    .getByTestId("detail-field")
    .evaluateAll((cells: Array<Element>): Array<FieldMeasure> => {
      const boxOf: (element: Element) => {
        x: number;
        y: number;
        width: number;
        height: number;
      } = (
        element: Element,
      ): { x: number; y: number; width: number; height: number } => {
        const rect: DOMRect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      };

      return cells.map((cell: Element) => {
        const label: Element | null = cell.querySelector(
          "[data-testid='detail-label']",
        );
        const value: Element = cell.querySelector(
          "[data-testid='detail-value']",
        ) as Element;
        return {
          cell: boxOf(cell),
          label: label ? boxOf(label) : null,
          value: boxOf(value),
          hasDescription:
            cell.querySelector("[data-testid='detail-description']") !== null,
          borderTop: parseFloat(getComputedStyle(cell).borderTopWidth),
          overflows: (cell as HTMLElement).scrollWidth > cell.clientWidth + 1,
        };
      });
    });
}

// The fields grouped into the rows the grid drew them in.
function rowsOf(fields: Array<FieldMeasure>): Array<Array<FieldMeasure>> {
  const rows: Map<number, Array<FieldMeasure>> = new Map();
  for (const field of fields) {
    const top: number = Math.round(field.cell.y);
    rows.set(top, [...(rows.get(top) || []), field]);
  }
  return Array.from(rows.keys())
    .sort((a: number, b: number): number => {
      return a - b;
    })
    .map((top: number): Array<FieldMeasure> => {
      return (rows.get(top) || []).sort(
        (a: FieldMeasure, b: FieldMeasure): number => {
          return a.cell.x - b.cell.x;
        },
      );
    });
}

/*
 * What every detail grid must be: each row's fields share their name's top,
 * and - where no line under a name pushes it down - their value's; no rule
 * above the first row and one above every other, running the grid's whole
 * width without a gap; nothing running out of its cell.
 */
async function expectAlignedRows(card: Locator, where: string): Promise<void> {
  /*
   * A card can draw its fields after the page's first card does: a status
   * page's Custom Fields shows a spinner, not a skeleton, until its read
   * returns. Measure once this card's own fields are in.
   */
  await expect(
    card.getByTestId("detail-field").first(),
    `${where}: fields`,
  ).toBeVisible();
  const fields: Array<FieldMeasure> = await measureFields(card);
  const grid: Box = await box(
    card.getByTestId("detail-field").first().locator("xpath=.."),
  );
  const rows: Array<Array<FieldMeasure>> = rowsOf(fields);

  expect(fields.length, `${where}: fields`).toBeGreaterThan(0);

  rows.forEach((row: Array<FieldMeasure>, rowIndex: number): void => {
    const first: FieldMeasure = row[0] as FieldMeasure;
    const plain: Array<FieldMeasure> = row.filter(
      (field: FieldMeasure): boolean => {
        return !field.hasDescription;
      },
    );

    for (const field of plain) {
      expect(
        Math.abs(field.value.y - (plain[0] as FieldMeasure).value.y),
        `${where}: row ${rowIndex} values share a top`,
      ).toBeLessThanOrEqual(0.5);
    }

    for (const field of row) {
      if (field.label && first.label) {
        expect(
          Math.abs(field.label.y - first.label.y),
          `${where}: row ${rowIndex} names share a top`,
        ).toBeLessThanOrEqual(0.5);
      }
      expect(field.borderTop, `${where}: row ${rowIndex} rule`).toBe(
        rowIndex === 0 ? 0 : 1,
      );
      expect(field.overflows, `${where}: row ${rowIndex} overflow`).toBe(false);
    }

    // The row's cells meet edge to edge across the grid: one rule, full width.
    expect(
      Math.abs(first.cell.x - grid.x),
      `${where}: row ${rowIndex} starts at the grid's edge`,
    ).toBeLessThanOrEqual(1);
    for (let index: number = 1; index < row.length; index++) {
      const previous: FieldMeasure = row[index - 1] as FieldMeasure;
      expect(
        Math.abs(
          (row[index] as FieldMeasure).cell.x -
            (previous.cell.x + previous.cell.width),
        ),
        `${where}: row ${rowIndex} has no gap between cells`,
      ).toBeLessThanOrEqual(1);
    }
    const last: FieldMeasure = row[row.length - 1] as FieldMeasure;
    expect(
      Math.abs(last.cell.x + last.cell.width - (grid.x + grid.width)),
      `${where}: row ${rowIndex} ends at the grid's edge`,
    ).toBeLessThanOrEqual(1);
  });
}

interface ValueLine {
  title: string;
  cellTop: number;
  valueHeight: number;
  // The middle of the value's first line of words, as drawn.
  wordsMiddle: number;
}

/*
 * Where each value's words sit: the middle of the first run of text a
 * reader sees in it (not the words only a screen reader hears), and the
 * height of the value's box.
 */
async function measureValueLines(card: Locator): Promise<Array<ValueLine>> {
  return await card
    .getByTestId("detail-field")
    .evaluateAll((cells: Array<Element>): Array<ValueLine> => {
      return cells.map((cell: Element): ValueLine => {
        const value: Element = cell.querySelector(
          "[data-testid='detail-value']",
        ) as Element;
        const walker: TreeWalker = document.createTreeWalker(
          value,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node: Node): number => {
              const parent: Element | null = node.parentElement;
              if (
                !node.textContent ||
                !node.textContent.trim() ||
                (parent && parent.closest(".sr-only"))
              ) {
                return NodeFilter.FILTER_SKIP;
              }
              return NodeFilter.FILTER_ACCEPT;
            },
          },
        );
        const words: Node | null = walker.nextNode();
        let wordsMiddle: number = Number.NaN;
        if (words) {
          const range: Range = document.createRange();
          range.selectNodeContents(words);
          const first: DOMRect | undefined = range.getClientRects()[0];
          if (first) {
            wordsMiddle = first.top + first.height / 2;
          }
        }
        const label: Element | null = cell.querySelector(
          "[data-testid='detail-label']",
        );
        return {
          title: label ? (label.textContent || "").trim() : "",
          cellTop: cell.getBoundingClientRect().top,
          valueHeight: value.getBoundingClientRect().height,
          wordsMiddle: wordsMiddle,
        };
      });
    });
}

async function expectNothingRunsOff(page: Page, where: string): Promise<void> {
  expect(
    await page.evaluate((): boolean => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
    `${where}: the page does not scroll sideways`,
  ).toBe(true);
}

// The fields' left edge is the card title's.
async function expectFieldsUnderTitle(
  card: Locator,
  where: string,
): Promise<void> {
  const title: Box = await box(card.getByTestId("card-details-heading"));
  const firstField: Box = await box(card.getByTestId("detail-field").first());

  expect(Math.abs(firstField.x - title.x), where).toBeLessThanOrEqual(1);
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseRgb(color: string): Rgb {
  const parts: Array<number> = (color.match(/[\d.]+/g) || []).map(Number);
  return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0 };
}

function luminance(color: Rgb): number {
  const channel: (value: number) => number = (value: number): number => {
    const scaled: number = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

function contrast(first: string, second: string): number {
  const a: number = luminance(parseRgb(first));
  const b: number = luminance(parseRgb(second));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// The colour a card is painted in: the first non-transparent background up.
async function cardBackground(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    let current: Element | null = element;
    while (current) {
      const background: string = getComputedStyle(current).backgroundColor;
      if (background && background !== "rgba(0, 0, 0, 0)") {
        return background;
      }
      current = current.parentElement;
    }
    return "rgb(255, 255, 255)";
  });
}

test.describe("the maintainer's screenshot: User Settings > Profile", () => {
  test("Name and Email share one top, and the rule above Timezone runs the whole card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PROFILE, 1280);
    const card: Locator = cardTitled(page, "Basic Info");

    const [name, email, timezone] = (await measureFields(card)) as [
      FieldMeasure,
      FieldMeasure,
      FieldMeasure,
    ];

    // It was 20px lower: one row, one top.
    expect(Math.abs(name.label!.y - email.label!.y)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(name.value.y - email.value.y)).toBeLessThanOrEqual(0.5);
    expect(name.borderTop).toBe(0);
    expect(email.borderTop).toBe(0);

    // Timezone is the second row, under a rule across the grid's whole width.
    const grid: Box = await box(card.locator("#user-profile"));
    expect(timezone.cell.y).toBeGreaterThan(name.cell.y + name.cell.height - 1);
    expect(timezone.borderTop).toBe(1);
    expect(Math.abs(timezone.cell.x - grid.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(timezone.cell.width - grid.width)).toBeLessThanOrEqual(1);

    // Two equal columns, the second starting halfway.
    expect(Math.abs(email.cell.x - (grid.x + grid.width / 2))).toBeLessThan(2);

    await expectAlignedRows(card, "profile at 1280");
    await expectFieldsUnderTitle(card, "profile at 1280");
    await screenshot(page, "profile-1280");
  });

  test("no field is sized by an inline width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PROFILE, 1280);

    const styled: Array<string> = await page
      .getByTestId("detail-field")
      .evaluateAll((cells: Array<Element>): Array<string> => {
        return cells
          .map((cell: Element): string => {
            return cell.getAttribute("style") || "";
          })
          .filter((style: string): boolean => {
            return style.length > 0;
          });
      });

    expect(styled).toEqual([]);
  });

  test("the names read as the card writes them, muted; the values in the reading colour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PROFILE, 1280);
    const card: Locator = cardTitled(page, "Basic Info");
    const label: Locator = card.getByTestId("detail-label").first();
    const value: Locator = card.getByTestId("detail-value").first();

    // As written: not upper-cased, not tracked, no dot after it.
    await expect(label).toHaveText("Name", { useInnerText: true });
    await expect(label).toHaveCSS("text-transform", "none");
    await expect(label).toHaveCSS("letter-spacing", "normal");
    await expect(label).toHaveCSS("font-size", "14px");
    await expect(label).toHaveCSS("font-weight", "500");
    await expect(label).toHaveCSS("color", "rgb(107, 114, 128)");

    await expect(value).toHaveText("Test User");
    await expect(value).toHaveCSS("font-size", "14px");
    await expect(value).toHaveCSS("color", "rgb(17, 24, 39)");
    await expect(value.locator("div").first()).toHaveCSS("font-weight", "400");

    const background: string = await cardBackground(label);
    expect(
      contrast(
        await label.evaluate((element: Element): string => {
          return getComputedStyle(element).color;
        }),
        background,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("on a phone: one column, each field under a rule, under the title, nothing off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PROFILE, 390);
    const card: Locator = cardTitled(page, "Basic Info");
    const fields: Array<FieldMeasure> = await measureFields(card);

    expect(rowsOf(fields)).toHaveLength(3);
    expect(
      fields.map((field: FieldMeasure): number => {
        return field.borderTop;
      }),
    ).toEqual([0, 1, 1]);

    await expectAlignedRows(card, "profile at 390");
    await expectFieldsUnderTitle(card, "profile at 390");
    await expectNothingRunsOff(page, "profile at 390");

    // The rule under the header meets the card's edges, no further.
    const cardBox: Box = await box(card);
    const body: Box = await box(card.getByTestId("card-model-detail-body"));
    expect(Math.abs(body.x - (cardBox.x + 1))).toBeLessThanOrEqual(1);
    expect(
      Math.abs(body.x + body.width - (cardBox.x + cardBox.width - 1)),
    ).toBeLessThanOrEqual(1);

    await screenshot(page, "profile-390");
  });

  test("long names and emails wrap inside the card on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PROFILE}?data=long`, 390);
    const card: Locator = cardTitled(page, "Basic Info");

    await expectAlignedRows(card, "long profile at 390");
    await expectNothingRunsOff(page, "long profile at 390");

    const cardBox: Box = await box(card);
    for (const field of await measureFields(card)) {
      expect(field.value.x + field.value.width).toBeLessThanOrEqual(
        cardBox.x + cardBox.width,
      );
    }
    await screenshot(page, "profile-long-390");
  });

  test("an unset time zone shows the page's own words, as quiet text", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PROFILE}?data=empty`, 1280);
    const card: Locator = cardTitled(page, "Basic Info");
    const timezone: Locator = card
      .getByTestId("detail-field")
      .filter({ hasText: "Timezone" });

    await expect(timezone.getByTestId("detail-value")).toHaveText(
      "No timezone selected",
    );
  });

  test("Edit User opens the edit dialog", async ({ page }: { page: Page }) => {
    await open(page, PROFILE, 1280);
    const card: Locator = cardTitled(page, "Basic Info");

    await card.getByRole("button", { name: "Edit User", exact: true }).click();

    const dialog: Locator = page.getByTestId("modal");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Edit User").first()).toBeVisible();
  });
});

test.describe("every gallery card, at every width", () => {
  for (const width of WIDTHS) {
    test(`rows line up and rules run the full width at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, GALLERY, width);

      for (const name of GRID_CARDS) {
        const card: Locator = galleryCard(page, name);
        await expectAlignedRows(card, `${name} at ${width}`);
        await expectFieldsUnderTitle(card, `${name} at ${width}`);
      }

      await expectNothingRunsOff(page, `gallery at ${width}`);

      if (width === 390 || width === 1280) {
        await screenshot(page, `gallery-${width}`);
      }
    });
  }

  test("long values wrap in their column at every width", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [390, 768, 1280]) {
      await open(page, `${GALLERY}?data=long`, width);
      for (const name of GRID_CARDS) {
        await expectAlignedRows(
          galleryCard(page, name),
          `long ${name} at ${width}`,
        );
      }
      await expectNothingRunsOff(page, `long gallery at ${width}`);
    }
  });
});

test.describe("columns", () => {
  async function columnsInFirstRow(page: Page, name: string): Promise<number> {
    const rows: Array<Array<FieldMeasure>> = rowsOf(
      await measureFields(galleryCard(page, name)),
    );
    return (rows[0] || []).length;
  }

  test("one column on a phone, two from 640px, three and four only from 1024px", async ({
    page,
  }: {
    page: Page;
  }) => {
    const expected: Array<{
      width: number;
      two: number;
      three: number;
      four: number;
    }> = [
      { width: 390, two: 1, three: 1, four: 1 },
      { width: 640, two: 2, three: 2, four: 2 },
      { width: 768, two: 2, three: 2, four: 2 },
      { width: 1024, two: 2, three: 3, four: 4 },
      { width: 1440, two: 2, three: 3, four: 4 },
    ];

    for (const row of expected) {
      await open(page, GALLERY, row.width);
      expect({
        width: row.width,
        two: await columnsInFirstRow(page, "two"),
        three: await columnsInFirstRow(page, "three"),
        four: await columnsInFirstRow(page, "four"),
      }).toEqual(row);
    }
  });

  test("a short last row's field takes the rest of the row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1440);

    // Seven fields in three columns: the seventh fills the third row.
    const rows: Array<Array<FieldMeasure>> = rowsOf(
      await measureFields(galleryCard(page, "three")),
    );
    const grid: Box = await box(
      galleryCard(page, "three").locator("#detail-three"),
    );

    expect(
      rows.map((row: Array<FieldMeasure>): number => {
        return row.length;
      }),
    ).toEqual([3, 3, 1]);
    expect(
      Math.abs((rows[2]![0] as FieldMeasure).cell.width - grid.width),
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("values", () => {
  test("an empty value is a quiet dash a screen reader reads as 'Not set', or the field's own words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);
    const card: Locator = galleryCard(page, "one");

    const pageTitle: Locator = card
      .getByTestId("detail-field")
      .filter({ hasText: "Page title" });
    const dash: Locator = pageTitle.getByTestId("detail-empty-value");

    await expect(dash).toBeVisible();
    // The dash is drawn and kept from a screen reader, which hears "Not set".
    await expect(dash.locator("[aria-hidden='true']")).toHaveText("\u2014");
    await expect(dash.getByText("Not set")).toHaveClass(/(^|\s)sr-only(\s|$)/);
    await expect(dash).toHaveCSS("color", "rgb(156, 163, 175)");

    const copyright: Locator = card
      .getByTestId("detail-field")
      .filter({ hasText: "Copyright text" });
    const words: Locator = copyright.getByTestId("placeholder-text");

    await expect(words).toHaveText("No copyright text yet.");
    await expect(words).toHaveCSS("color", "rgb(107, 114, 128)");
    // Not a chip: no border, no fill.
    await expect(words).toHaveCSS("border-top-width", "0px");
    await expect(words).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("every one-line value in a row sits on one line: text, a yes/no, a choice, a colour, labels, related records, a dash and the field's own words", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 768, 390]) {
      await open(page, GALLERY, width);
      const lines: Array<ValueLine> = await measureValueLines(
        galleryCard(page, "mixed"),
      );

      expect(
        lines.map((line: ValueLine): string => {
          return line.title;
        }),
      ).toEqual([
        "Name",
        "Public",
        "Theme",
        "Bar color",
        "Labels",
        "Downtime statuses",
        "Page title",
        "Copyright text",
      ]);

      const rows: Map<number, Array<ValueLine>> = new Map();
      for (const line of lines) {
        const top: number = Math.round(line.cellTop);
        rows.set(top, [...(rows.get(top) || []), line]);
      }

      for (const row of rows.values()) {
        const first: ValueLine = row[0] as ValueLine;
        for (const line of row) {
          // Level to the pixel: a pill sat 2px low on the line's baseline.
          expect(
            Math.abs(line.wordsMiddle - first.wordsMiddle),
            `${line.title} level with ${first.title} at ${width}`,
          ).toBeLessThanOrEqual(1);
        }
      }

      // One line of any kind is the value's 24px line: no row stands taller.
      for (const line of lines) {
        if (line.title === "Labels" && width === 1280) {
          // Four columns of a 1024px page: the labels wrap, as they should.
          continue;
        }
        expect(
          Math.abs(line.valueHeight - 24),
          `${line.title} is one 24px line at ${width}`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
    await screenshot(page, "mixed-values-390");
  });

  test("a record's labels sit side by side, all of them, wrapping in their column", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await open(page, GALLERY, width);
      const labels: Locator = galleryCard(page, "one")
        .getByTestId("detail-field")
        .filter({ hasText: "Labels" });
      const row: Locator = labels.getByTestId("detail-labels");
      const pills: Locator = row.getByTestId("pill");

      // In natural order, as labels are listed everywhere (#5183).
      await expect(pills).toHaveText(["Customer facing", "EU", "Production"]);
      // Every label shown: nothing folded behind "N more".
      await expect(labels.getByRole("button")).toHaveCount(0);

      // One line: every pill shares the first one's top.
      const tops: Array<number> = await pills.evaluateAll(
        (elements: Array<Element>): Array<number> => {
          return elements.map((element: Element): number => {
            return element.getBoundingClientRect().top;
          });
        },
      );
      for (const top of tops) {
        expect(
          Math.abs(top - (tops[0] as number)),
          `labels on one line at ${width}`,
        ).toBeLessThanOrEqual(0.5);
      }

      // Inside their column.
      const cell: Box = await box(labels);
      const rowBox: Box = await box(row);
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(
        cell.x + cell.width + 0.5,
      );
    }
  });

  test("a record with no labels says so as quiet text, like every empty field", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${GALLERY}?data=empty`, 1280);
    const labels: Locator = galleryCard(page, "one")
      .getByTestId("detail-field")
      .filter({ hasText: "Labels" });
    const words: Locator = labels.getByTestId("placeholder-text");

    await expect(words).toHaveText("No labels attached.");
    // The grey of the field's own words, not a value's near-black.
    await expect(words).toHaveCSS("color", "rgb(107, 114, 128)");
    await expect(labels.locator("p")).toHaveCount(0);
  });

  test("a date reads as plain text, in the value's weight, with no icon", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);
    const reports: Locator = galleryCard(page, "one")
      .getByTestId("detail-field")
      .filter({ hasText: "Reports start" });
    const time: Locator = reports.locator("time");

    await expect(time).toHaveAttribute("datetime", "2026-10-01T08:00:00.000Z");
    await expect(time).toContainText("Oct 01 2026");
    await expect(time).toHaveCSS("font-weight", "400");
    await expect(reports.locator("svg")).toHaveCount(0);
  });

  test("a copyable value's copy button is in view without a hover, and copies the value", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, GALLERY, 1280);

    const slug: Locator = galleryCard(page, "keys")
      .getByTestId("detail-field")
      .filter({ hasText: "Slug" });
    const copy: Locator = slug.getByRole("button", {
      name: "Copy to clipboard",
    });

    await expect(copy).toBeVisible();
    await expect(copy).toHaveCSS("opacity", "1");

    await copy.click();
    expect(
      await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      }),
    ).toBe("acme-status");
  });

  test("markdown and code keep their own look, under their names", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);
    const card: Locator = galleryCard(page, "code");

    await expect(card.getByText("checkout", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "runbook" })).toBeVisible();
    await expect(card.getByText("font-weight").first()).toBeVisible();
    await expectAlignedRows(card, "code at 1280");

    // The first paragraph sits as close to its name as any value does.
    const description: Locator = card
      .getByTestId("detail-field")
      .filter({ hasText: "Description" });
    const valueBox: Box = await box(description.getByTestId("detail-value"));
    const firstParagraph: Box = await box(description.locator("p").first());
    expect(Math.abs(firstParagraph.y - valueBox.y)).toBeLessThanOrEqual(1);
  });
});

test.describe("the card's header", () => {
  test("the documentation and the demo are in a bordered ⋯ beside Edit, and open in a new tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);
    const card: Locator = galleryCard(page, "keys");
    const actions: Locator = card.getByTestId("card-header-actions");

    await expect(
      actions.getByRole("button", { name: "View Documentation" }),
    ).toHaveCount(0);
    await expect(
      actions.getByRole("button", { name: "Watch Demo" }),
    ).toHaveCount(0);

    const edit: Locator = actions.getByRole("button", {
      name: "Edit Status Page",
    });
    const more: Locator = actions.getByRole("button", { name: "More options" });

    // A real button: a border, and the height of Edit beside it.
    await expect(more).toHaveCSS("border-top-width", "1px");
    await expect(more).toHaveCSS("border-top-style", "solid");
    const editBox: Box = await box(edit);
    const moreBox: Box = await box(more);
    expect(Math.abs(editBox.height - moreBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(editBox.y - moreBox.y)).toBeLessThanOrEqual(1);
    expect(moreBox.x).toBeGreaterThan(editBox.x + editBox.width);

    // A hover the reader can see.
    const restingBackground: string = await more.evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    await more.hover();
    await expect
      .poll(async (): Promise<string> => {
        return await more.evaluate((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        });
      })
      .not.toBe(restingBackground);

    await more.click();
    const popupPromise: Promise<Page> = page.waitForEvent("popup");
    await page.getByRole("menuitem", { name: "View Documentation" }).click();
    const popup: Page = await popupPromise;
    await expect(popup).toHaveURL(/\/docs\/status-pages\/index$/);
    await popup.close();

    await more.click();
    await expect(
      page.getByRole("menuitem", { name: "Watch Demo" }),
    ).toBeVisible();
    await screenshot(page, "keys-more-menu-open");
  });

  test("on a phone the ⋯ is there too, beside Edit, at the card's right edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 390);
    const card: Locator = galleryCard(page, "keys");
    const more: Locator = card
      .getByTestId("card-header-actions")
      .getByRole("button", { name: "More options" });
    const edit: Locator = card
      .getByTestId("card-header-actions")
      .getByRole("button", { name: "Edit Status Page" });

    await expect(more).toBeVisible();
    const editBox: Box = await box(edit);
    const moreBox: Box = await box(more);
    expect(Math.abs(editBox.height - moreBox.height)).toBeLessThanOrEqual(1);

    const cardBox: Box = await box(card);
    expect(
      cardBox.x + cardBox.width - (moreBox.x + moreBox.width),
    ).toBeLessThan(30);
  });

  test("the team page's Watch Demo is in its ⋯", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TEAM, 1280);
    const card: Locator = cardTitled(page, "Team Details");

    await card.getByRole("button", { name: "More options" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Watch Demo" }),
    ).toBeVisible();
    await expectAlignedRows(card, "team at 1280");
    await screenshot(page, "team-1280");
  });

  test("a reader who may not edit sees Edit locked, and can still read every field", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${GALLERY}?role=viewer`, 1280);
    const card: Locator = galleryCard(page, "two");

    await expect(
      card.getByRole("button", { name: "Edit User", exact: true }),
    ).toBeDisabled();
    await expectAlignedRows(card, "viewer two at 1280");
  });
});

test.describe("loading and failing", () => {
  test("while the record loads, the card shows its rows - and keeps its height when they land", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${PROFILE}?delay=1500`);

    const card: Locator = cardTitled(page, "Basic Info");
    const skeleton: Locator = card.getByTestId("detail-skeleton");

    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("role", "status");
    await expect(skeleton).toHaveAttribute("aria-label", "Loading");
    await expect(skeleton.getByTestId("detail-skeleton-cell")).toHaveCount(3);
    await expect(card.getByTestId("bar-loader")).toHaveCount(0);

    const loadingHeight: number = (await box(card)).height;
    await screenshot(page, "profile-loading");

    await expect(skeleton).toHaveCount(0, { timeout: 10000 });
    await expect(card.getByText("Test User")).toBeVisible();

    const loadedHeight: number = (await box(card)).height;
    // It used to open about 100px tall and jump to the fields' height.
    expect(Math.abs(loadedHeight - loadingHeight)).toBeLessThanOrEqual(8);
  });

  test("a read that fails says why, and Refresh? reads the record again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${PROFILE}?fail=User`);

    const card: Locator = cardTitled(page, "Basic Info");
    const error: Locator = card.getByTestId("model-detail-error");

    await expect(error).toContainText(
      "We could not reach OneUptime. Check your connection and try again.",
    );
    const reads: number = (await fixture(page)).itemRequests.length;

    const retry: Locator = error.getByRole("button", { name: "Refresh?" });
    await retry.focus();
    await page.keyboard.press("Enter");

    await expect
      .poll(async (): Promise<number> => {
        return (await fixture(page)).itemRequests.length;
      })
      .toBe(reads + 1);
  });
});

test.describe("the dark theme", () => {
  test("names, values and rules as the theme draws them, every word at AA", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${GALLERY}?theme=dark`, 1280);
    const card: Locator = galleryCard(page, "one");
    const background: string = await cardBackground(
      card.getByTestId("detail-field").first(),
    );

    // The card is a dark surface, not white.
    expect(luminance(parseRgb(background))).toBeLessThan(0.05);

    for (const testId of ["detail-label", "detail-value"]) {
      const colors: Array<string> = await card
        .getByTestId(testId)
        .evaluateAll((elements: Array<Element>): Array<string> => {
          return elements.map((element: Element): string => {
            return getComputedStyle(element).color;
          });
        });
      for (const color of colors) {
        expect(contrast(color, background), testId).toBeGreaterThanOrEqual(4.5);
      }
    }

    // The rule between rows: the theme's subtle border, not a light grey.
    const ruled: Locator = card
      .getByTestId("detail-field")
      .filter({ hasText: "Description" });
    await expect(ruled).toHaveCSS("border-top-color", "rgb(51, 65, 85)");

    const words: Locator = card.getByTestId("placeholder-text");
    expect(
      contrast(
        await words.evaluate((element: Element): string => {
          return getComputedStyle(element).color;
        }),
        background,
      ),
    ).toBeGreaterThanOrEqual(4.5);

    await screenshot(page, "gallery-dark");
  });
});

test.describe("a card's sections and the compact style", () => {
  test("detail cards drawn as sections follow their headers with no rule of their own, and line up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);
    const sections: Locator = page.getByTestId("gallery-sections");

    await sections.getByRole("button", { name: /More settings/ }).click();
    const bodies: Locator = sections.getByTestId("card-model-detail-body");
    await expect(bodies).toHaveCount(2);

    for (const index of [0, 1]) {
      await expect(bodies.nth(index)).toHaveCSS("border-top-width", "0px");
    }
    await expectAlignedRows(
      sections.getByTestId("card").first(),
      "visibility section",
    );
  });

  test("the overview pages' compact style keeps its own small names and hairlines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);
    const card: Locator = galleryCard(page, "compact");
    const label: Locator = card.locator("label").first();

    await expect(label).toHaveCSS("font-size", "12px");
    await expect(label).toHaveCSS("text-transform", "none");
  });
});

test.describe("other pages built on detail cards", () => {
  test("Project Settings: the project ID stays a field, with its copy control", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, PROJECT_SETTINGS, 1280);
    const card: Locator = cardTitled(page, "Project Details");

    await expect(
      card.getByText("10000000-0000-4000-8000-000000000001"),
    ).toBeVisible();
    await expectAlignedRows(card, "project settings at 1280");
    await expectFieldsUnderTitle(card, "project settings at 1280");
  });

  test("a status page's Overview: details, then custom fields, all lined up", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [390, 1280]) {
      await open(page, STATUS_PAGE, width);
      await expectAlignedRows(
        cardTitled(page, "Status Page Details"),
        `status page details at ${width}`,
      );
      await expectAlignedRows(
        cardTitled(page, "Custom Fields"),
        `status page custom fields at ${width}`,
      );
      await expectNothingRunsOff(page, `status page at ${width}`);
    }
    await screenshot(page, "status-page-1280");
  });

  test("in German, the names are the Dashboard's German words, still lined up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PROFILE}?lang=de`, 1280);
    const card: Locator = page.getByTestId("card").first();

    await expect(card.getByTestId("detail-label").nth(2)).toHaveText(
      "Zeitzone",
    );
    await expectAlignedRows(card, "German profile at 1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Rows of cards (CardGrid)
 * ---------------------------------------------------------------------------
 *
 * "Gap between cards dont look nice. Please fix it." - the maintainer, of a
 * row of cards of different heights with bare page under the shorter ones.
 * Cards side by side are drawn with CardGrid (Common/UI/Components/Card):
 * every card fills its cell, a last row the cards do not fill is shared by
 * the cards it has, and how many share a row follows the grid's own width.
 * The gallery (/card-rows) draws its rows in the production Page beside a
 * side menu, so each grid has the room a product page's has: these measure
 * the real boxes at every width people use, light and dark.
 */
test.describe("rows of cards", () => {
  const CARD_ROWS: string = `/dashboard/${PROJECT}/card-rows`;

  interface CardRowGrid {
    testId: string;
    layout: CardGridLayout;
    cards: number;
  }

  const GRIDS: ReadonlyArray<CardRowGrid> = [
    { testId: "rows-two-wide", layout: { columns: 2, cardWidth: "wide" }, cards: 2 },
    {
      testId: "rows-three-narrow",
      layout: { columns: 3, cardWidth: "narrow" },
      cards: 3,
    },
    {
      testId: "rows-five-narrow",
      layout: { columns: 3, cardWidth: "narrow" },
      cards: 5,
    },
    { testId: "rows-three-wide", layout: { columns: 2, cardWidth: "wide" }, cards: 3 },
    { testId: "rows-nothing", layout: { columns: 2, cardWidth: "wide" }, cards: 2 },
    { testId: "rows-detail", layout: { columns: 2, cardWidth: "wide" }, cards: 2 },
  ];

  // Cards across beside the side menu at each window width.
  const ACROSS: Record<number, Record<CardGridLayout["cardWidth"], number>> = {
    1440: { narrow: 3, wide: 2 },
    1280: { narrow: 3, wide: 2 },
    1024: { narrow: 2, wide: 1 },
    768: { narrow: 1, wide: 1 },
    390: { narrow: 1, wide: 1 },
  };

  interface CellBox {
    title: string;
    top: number;
    left: number;
    right: number;
    bottom: number;
    frameBottom: number;
  }

  interface GridBoxes {
    left: number;
    right: number;
    cells: Array<CellBox>;
  }

  async function gridBoxes(page: Page, testId: string): Promise<GridBoxes> {
    return page
      .getByTestId(testId)
      .evaluate((container: Element): GridBoxes => {
        const grid: Element = container.firstElementChild as Element;
        const box: DOMRect = grid.getBoundingClientRect();

        return {
          left: box.left,
          right: box.right,
          cells: Array.from(grid.children).map((cell: Element): CellBox => {
            const cellBox: DOMRect = cell.getBoundingClientRect();
            const frame: Element = cell.querySelector(
              '[data-testid="card"] > div',
            ) as Element;

            return {
              title: (
                cell.querySelector('[data-testid="card-details-heading"]')
                  ?.textContent || ""
              ).trim(),
              top: cellBox.top + window.scrollY,
              left: cellBox.left,
              right: cellBox.right,
              bottom: cellBox.bottom + window.scrollY,
              frameBottom: frame.getBoundingClientRect().bottom + window.scrollY,
            };
          }),
        };
      });
  }

  function linesOf(cells: Array<CellBox>): Array<Array<CellBox>> {
    const lines: Array<Array<CellBox>> = [];

    for (const cell of cells) {
      const line: Array<CellBox> | undefined = lines.find(
        (candidate: Array<CellBox>): boolean => {
          return Math.abs(candidate[0]!.top - cell.top) <= 1;
        },
      );

      if (line) {
        line.push(cell);
      } else {
        lines.push([cell]);
      }
    }

    return lines;
  }

  for (const width of [1440, 1280, 1024, 768, 390]) {
    test(`at ${width}px beside the side menu every row ends on one line and fills its grid, its cards the grid's gap apart, light and dark`, async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const theme of ["", "?theme=dark"]) {
        await open(page, `${CARD_ROWS}${theme}`, width);

        for (const grid of GRIDS) {
          const boxes: GridBoxes = await gridBoxes(page, grid.testId);
          const lines: Array<Array<CellBox>> = linesOf(boxes.cells);
          const label: string = `${grid.testId} at ${width}px${theme}`;
          const across: number = Math.min(
            ACROSS[width]![grid.layout.cardWidth],
            grid.layout.columns,
            grid.cards,
          );

          // The model the class names come from agrees with the page.
          expect([
            label,
            Math.min(
              getCardGridColumnsAt(grid.layout, boxes.right - boxes.left),
              grid.cards,
            ),
            lines[0]!.length,
          ]).toEqual([label, across, across]);
          expect(boxes.cells).toHaveLength(grid.cards);

          lines.forEach((line: Array<CellBox>, index: number) => {
            const bottom: number = Math.max(
              ...line.map((cell: CellBox): number => {
                return cell.bottom;
              }),
            );

            // Every card's frame runs to its row's bottom.
            for (const cell of line) {
              expect([label, cell.title, Math.round(bottom - cell.frameBottom)]).toEqual(
                [label, cell.title, 0],
              );
            }

            // The row runs from the grid's left edge to its right: no empty slot.
            expect([
              label,
              index,
              Math.round(line[0]!.left - boxes.left),
              Math.round(boxes.right - line[line.length - 1]!.right),
            ]).toEqual([label, index, 0, 0]);

            for (let next: number = 1; next < line.length; next++) {
              expect([
                label,
                Math.round(line[next]!.left - line[next - 1]!.right),
              ]).toEqual([label, CARD_GRID_GAP_IN_PX]);
            }

            // A card beside another has the room its kind needs.
            if (line.length > 1) {
              for (const cell of line) {
                expect([
                  label,
                  cell.title,
                  cell.right - cell.left >=
                    CARD_GRID_MIN_CARD_WIDTH_IN_REM[grid.layout.cardWidth] * 16 -
                      1,
                ]).toEqual([label, cell.title, true]);
              }
            }

            if (index > 0) {
              const above: number = Math.max(
                ...lines[index - 1]!.map((cell: CellBox): number => {
                  return cell.bottom;
                }),
              );
              expect([label, Math.round(line[0]!.top - above)]).toEqual([
                label,
                CARD_GRID_GAP_IN_PX,
              ]);
            }
          });
        }

        await expectNothingRunsOff(page, `card rows at ${width}px${theme}`);
      }

      await open(page, CARD_ROWS, width);
      await screenshot(page, `card-rows-${width}`);
    });
  }

  test("a detail card fills its cell like any card, its fields at the top, and a sentence for nothing to list sits in the middle of its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CARD_ROWS, 1280);

    // The detail card beside nine rows: one height, on one line.
    const detail: Box = await box(cardTitled(page, "A detail card"));
    const beside: Box = await box(cardTitled(page, "Beside it"));
    expect(Math.round(detail.height)).toBe(Math.round(beside.height));
    expect(Math.round(detail.y)).toBe(Math.round(beside.y));
    // Its fields start under its header, as the rows beside it do.
    const field: Box = await box(
      cardTitled(page, "A detail card").getByTestId("detail-field").first(),
    );
    const row: Box = await box(
      cardTitled(page, "Beside it").getByTestId("card-rows-list"),
    );
    expect(Math.abs(field.y - row.y)).toBeLessThanOrEqual(30);

    // Nothing to list: the sentence in the middle of the card's room, across and down.
    const empty: Locator = cardTitled(page, "Top detections");
    const card: Box = await box(empty);
    const header: Box = await box(empty.getByTestId("card-header"));
    const words: Box = await box(page.getByTestId("rows-nothing-sentence"));
    const room: number = (header.y + header.height + card.y + card.height) / 2;
    expect(Math.abs(words.y + words.height / 2 - room)).toBeLessThanOrEqual(24);
    expect(
      Math.abs(words.x + words.width / 2 - (card.x + card.width / 2)),
    ).toBeLessThanOrEqual(2);
    // And as tall as the six rows beside it.
    expect(Math.round(card.height)).toBe(
      Math.round((await box(cardTitled(page, "Riskiest entities"))).height),
    );
  });
});
