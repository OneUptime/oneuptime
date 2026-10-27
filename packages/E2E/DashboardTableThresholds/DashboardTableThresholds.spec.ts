import { expect, Locator, Page, Route, test, TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  TableColumnThresholds,
  TableThresholdDirection,
  TableThresholdLevel,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import {
  getTableThresholdLevel,
  roundTableValue,
} from "Common/Utils/Dashboard/TableThresholds";

/*
 * A dashboard's metric tables colored by thresholds (issue #5231), in a real
 * browser, on both of a dashboard's surfaces: the dashboard inside OneUptime
 * (its real view layout and Dashboard page) and the public dashboard (its
 * own index.ejs and app), with only the data boundary answered from fixture
 * data (DashboardTableThresholds/Fixture). See README.md.
 *
 * The customer's ask: CPU, memory and disk per host, normal below 80,
 * warning from 80, critical from 90, on the value or the cell. So:
 *
 *   - each cell is colored by its column's thresholds, as the shared rules
 *     (Common/Utils/Dashboard/TableThresholds) read the number on screen: a
 *     fraction of 1 shows and compares as a percent, rounded as shown;
 *   - a warning is amber with a triangle, a critical value red and bold
 *     with a circle, each saying what it reached; Colored background fills
 *     the cell; nothing is told by color alone;
 *   - every value is legible, 4.5:1, in the light and the dark theme, and on
 *     the public dashboard's Light and Dark;
 *   - German, and Persian (right to left: the shape at each value's start);
 *   - the settings: a column's thresholds and the table's Threshold colors,
 *     drawn in the Live Preview as they are typed, kept by Save Changes;
 *   - at a phone's width on the board, and in a narrow window in the
 *     settings.
 *
 * Screenshots are saved for review under
 * output/playwright/dashboard-table-thresholds-ui.
 */

interface HostReading {
  host: string;
  cpu: number;
  memory: number;
  freeDisk: number | null;
  load: number;
}

interface FixtureRecord {
  aggregates?: Array<{ metricName: string }> | undefined;
  saves?: Array<{ dashboardViewConfig: Record<string, unknown> }> | undefined;
  unexpected: Array<string>;
  readings?: { hosts: Array<HostReading>; cpuOverTime: Array<number> };
}

declare global {
  interface Window {
    __dashboardTableThresholdsFixture?: FixtureRecord | undefined;
  }
}

const PORT: string = "4452";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000005231";
const DASHBOARD_ID: string = "db000000-0000-4000-8000-000000005231";

const APP_PATH: string = `/dashboard/${PROJECT_ID}/dashboards/${DASHBOARD_ID}`;
const PUBLIC_PATH: string = `/public-dashboard/${DASHBOARD_ID}`;

const SCREENSHOTS: string =
  "../../output/playwright/dashboard-table-thresholds-ui";

// The tables of Fixture/Boards.js, by their widget ids.
const SATURATION: string = "c0000000-0000-4000-8000-0000000052a1";
const FILLED: string = "c0000000-0000-4000-8000-0000000052a2";
const OVER_TIME: string = "c0000000-0000-4000-8000-0000000052a3";

const TITLES: Record<string, string> = {
  [SATURATION]: "Host saturation",
  [FILLED]: "Fleet at a glance",
  [OVER_TIME]: "CPU over time",
};

const USAGE: TableColumnThresholds = {
  warning: 80,
  critical: 90,
  direction: TableThresholdDirection.HigherIsWorse,
};

const FREE_DISK: TableColumnThresholds = {
  warning: 20,
  critical: 10,
  direction: TableThresholdDirection.LowerIsWorse,
};

// A host table's columns, as Fixture/Boards.js configures them.
interface ColumnUnderTest {
  header: string;
  read: (host: HostReading) => number | null;
  // What the stored value is multiplied by: a fraction shows as a percent.
  factor: number;
  unit: string;
  thresholds: TableColumnThresholds | null;
}

const HOST_COLUMNS: Array<ColumnUnderTest> = [
  {
    header: "CPU",
    read: (host: HostReading): number => {
      return host.cpu;
    },
    factor: 100,
    unit: "%",
    thresholds: USAGE,
  },
  {
    header: "Memory",
    read: (host: HostReading): number => {
      return host.memory;
    },
    factor: 100,
    unit: "%",
    thresholds: USAGE,
  },
  {
    header: "Free disk",
    read: (host: HostReading): number | null => {
      return host.freeDisk;
    },
    factor: 1,
    unit: "%",
    thresholds: FREE_DISK,
  },
  {
    header: "Load",
    read: (host: HostReading): number => {
      return host.load;
    },
    factor: 1,
    unit: "",
    thresholds: null,
  },
];

// The numbers in a computed colour.
const COLOUR_CHANNELS: RegExp = /[\d.]+/g;

// The German Dashboard's words, as its locale file has them.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
);

// What the German Dashboard draws for an English label.
const german: (english: string) => string = (english: string): string => {
  const drawn: string | undefined = GERMAN[english];

  expect(drawn, `a German word for "${english}"`).toBeTruthy();

  return drawn!;
};

const english: (text: string) => string = (text: string): string => {
  return text;
};

const record: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    return window.__dashboardTableThresholdsFixture || { unexpected: [] };
  });
};

const readingsOf: (page: Page) => Promise<{
  hosts: Array<HostReading>;
  cpuOverTime: Array<number>;
}> = async (
  page: Page,
): Promise<{ hosts: Array<HostReading>; cpuOverTime: Array<number> }> => {
  const readings:
    | { hosts: Array<HostReading>; cpuOverTime: Array<number> }
    | undefined = (await record(page)).readings;

  expect(readings, "the fixture's readings").toBeTruthy();

  return readings!;
};

const atDesktopOnly: () => void = (): void => {
  test.skip(
    test.info().project.name !== "chromium",
    "a desktop flow; the phone runs its own",
  );
};

const shoot: (
  page: Page,
  testInfo: TestInfo,
  name: string,
  target?: Locator,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
  target?: Locator,
): Promise<void> => {
  const file: string = `${SCREENSHOTS}/${testInfo.project.name}-${name}.png`;

  if (target) {
    await target.screenshot({ path: file });
    return;
  }

  await page.screenshot({ path: file, fullPage: true });
};

const press: (target: Locator) => Promise<void> = async (
  target: Locator,
): Promise<void> => {
  await target.scrollIntoViewIfNeeded();
  await target.click();
};

// A table widget on the board, by the id the canvas gives its box.
const widgetTitled: (scope: Page | Locator, widgetId: string) => Locator = (
  scope: Page | Locator,
  widgetId: string,
): Locator => {
  return scope.locator(`[id="dashboard-component-${widgetId}"]`);
};

const tableTitled: (scope: Page | Locator, widgetId: string) => Locator = (
  scope: Page | Locator,
  widgetId: string,
): Locator => {
  return widgetTitled(scope, widgetId).locator("table");
};

/*
 * A table's values and row names: every body cell but a missing value's
 * dash. The table's header, caption and row count are its own grey, as
 * every list widget's are, and were before thresholds.
 */
const valueCellsOf: (scope: Page | Locator, widgetId: string) => Locator = (
  scope: Page | Locator,
  widgetId: string,
): Locator => {
  return tableTitled(scope, widgetId)
    .locator("tbody td")
    .filter({ hasNotText: "—" });
};

// The widget the settings dialog's Live Preview draws: its only table.
const previewTable: (modal: Locator) => Locator = (modal: Locator): Locator => {
  return modal.locator("table");
};

// A row's cell under a header, by the row's first cell.
const cellOf: (
  table: Locator,
  rowName: string,
  header: string,
) => Promise<Locator> = async (
  table: Locator,
  rowName: string,
  header: string,
): Promise<Locator> => {
  const headers: Array<string> = (
    await table.locator("thead th").allInnerTexts()
  ).map((text: string): string => {
    return text.trim().toLowerCase();
  });
  const column: number = headers.indexOf(header.toLowerCase());

  expect(column, `the ${header} column`).toBeGreaterThanOrEqual(0);

  const row: Locator = table.locator("tbody tr").filter({
    has: table.page().locator("td:first-child", { hasText: rowName }),
  });

  await expect(row, `the ${rowName} row`).toHaveCount(1);

  return row.locator("td").nth(column);
};

// What a value reads as, and the level it has reached, by the shared rules.
const expectedCell: (
  stored: number | null,
  column: ColumnUnderTest,
) => { text: string; level: TableThresholdLevel | null } = (
  stored: number | null,
  column: ColumnUnderTest,
): { text: string; level: TableThresholdLevel | null } => {
  if (stored === null) {
    return { text: "—", level: null };
  }

  const shown: number = roundTableValue(stored * column.factor, 1);

  return {
    text: `${shown.toFixed(1)}${column.unit}`,
    level: column.thresholds
      ? getTableThresholdLevel({ value: shown, thresholds: column.thresholds })
      : null,
  };
};

const RULE_WORDS: Record<TableThresholdLevel, string> = {
  [TableThresholdLevel.Warning]: "Warning",
  [TableThresholdLevel.Critical]: "Critical",
};

// The sentence a colored cell says, in English.
const ruleOf: (
  level: TableThresholdLevel,
  thresholds: TableColumnThresholds,
  unit: string,
) => string = (
  level: TableThresholdLevel,
  thresholds: TableColumnThresholds,
  unit: string,
): string => {
  const threshold: number | undefined =
    level === TableThresholdLevel.Critical
      ? thresholds.critical
      : thresholds.warning;
  const way: string =
    thresholds.direction === TableThresholdDirection.LowerIsWorse
      ? "below"
      : "above";

  return `${RULE_WORDS[level]}: ${threshold}${unit} and ${way}`;
};

// Every host's cell of every column, against what the rules read.
const expectHostTable: (
  page: Page,
  table: Locator,
  hosts: Array<HostReading>,
) => Promise<number> = async (
  page: Page,
  table: Locator,
  hosts: Array<HostReading>,
): Promise<number> => {
  let colored: number = 0;

  for (const host of hosts) {
    for (const column of HOST_COLUMNS) {
      const cell: Locator = await cellOf(table, host.host, column.header);
      const expected: { text: string; level: TableThresholdLevel | null } =
        expectedCell(column.read(host), column);
      const label: string = `${host.host} ${column.header}`;

      await expect(cell, label).toHaveText(expected.text);

      if (expected.level === null) {
        await expect(cell, label).not.toHaveAttribute("data-threshold-level");
        await expect(cell.locator('[role="img"]'), label).toHaveCount(0);
        continue;
      }

      colored++;

      const rule: string = ruleOf(
        expected.level,
        column.thresholds!,
        column.unit,
      );

      await expect(cell, label).toHaveAttribute(
        "data-threshold-level",
        expected.level,
      );
      await expect(cell, label).toHaveAttribute("title", rule);
      await expect(cell.getByRole("img", { name: rule }), label).toHaveCount(1);
    }
  }

  // The fixture's readings reach both levels in every colored column.
  expect(colored).toBeGreaterThanOrEqual(8);
  expect(page).toBeTruthy();

  return colored;
};

const boardDrawn: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  for (const widgetId of [SATURATION, FILLED, OVER_TIME]) {
    await expect(
      widgetTitled(page, widgetId).getByRole("heading", {
        name: TITLES[widgetId]!,
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      tableTitled(page, widgetId).locator("tbody tr").first(),
      TITLES[widgetId],
    ).toBeVisible({ timeout: 60000 });
  }
  await expect(
    tableTitled(page, SATURATION).getByRole("cell", {
      name: "web-3",
      exact: true,
    }),
  ).toBeVisible();
};

const openApp: (page: Page, search?: string) => Promise<void> = async (
  page: Page,
  search?: string,
): Promise<void> => {
  await page.goto(`${APP_PATH}${search || ""}`);
  await boardDrawn(page);
};

const openPublic: (page: Page, search?: string) => Promise<void> = async (
  page: Page,
  search?: string,
): Promise<void> => {
  await page.goto(`${PUBLIC_PATH}${search || ""}`);
  await boardDrawn(page);
};

// The toolbar's "More dashboard options" menu, then its "Edit Dashboard".
const enterEditMode: (
  page: Page,
  words?: (english: string) => string,
) => Promise<void> = async (
  page: Page,
  words?: (english: string) => string,
): Promise<void> => {
  const word: (text: string) => string = words || english;

  await press(
    page.getByRole("button", { name: word("More dashboard options") }),
  );
  await press(page.getByRole("menuitem", { name: word("Edit Dashboard") }));
  await expect(page.getByTitle(word("Save Changes"))).toBeVisible();
};

// A click on a widget's title while editing opens its settings.
const openSettings: (page: Page, widgetId: string) => Promise<Locator> = async (
  page: Page,
  widgetId: string,
): Promise<Locator> => {
  await widgetTitled(page, widgetId)
    .getByText(TITLES[widgetId]!, { exact: true })
    .click({ force: true });

  const modal: Locator = page.getByTestId("modal");

  await expect(modal).toBeVisible();

  return modal;
};

/*
 * Contrast of every visible text inside `scope` against what is behind it:
 * at least 4.5:1 (3:1 for large text), as WCAG asks of text.
 */
const lowContrastTextsIn: (scope: Locator) => Promise<Array<string>> = async (
  scope: Locator,
): Promise<Array<string>> => {
  return scope.evaluateAll((roots: Array<Element>): Array<string> => {
    const RGB: RegExp =
      /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/;
    const parse: (value: string) => Array<number> | null = (
      value: string,
    ): Array<number> | null => {
      const match: RegExpExecArray | null = RGB.exec(value);

      if (!match) {
        return null;
      }

      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] === undefined ? 1 : Number(match[4]),
      ];
    };
    const luminance: (rgb: Array<number>) => number = (
      rgb: Array<number>,
    ): number => {
      const linear: (channel: number) => number = (channel: number): number => {
        const value: number = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4);
      };

      return (
        0.2126 * linear(rgb[0]!) +
        0.7152 * linear(rgb[1]!) +
        0.0722 * linear(rgb[2]!)
      );
    };
    // What is behind an element: every see-through background down to a solid one.
    const groundOf: (element: Element) => Array<number> | null = (
      element: Element,
    ): Array<number> | null => {
      const washes: Array<Array<number>> = [];
      let solid: Array<number> | null = null;
      let ancestor: Element | null = element;

      while (ancestor && !solid) {
        const ground: Array<number> | null = parse(
          getComputedStyle(ancestor).backgroundColor,
        );

        if (ground && ground[3]! >= 0.999) {
          solid = ground;
        } else if (ground && ground[3]! > 0) {
          washes.push(ground);
        }

        ancestor = ancestor.parentElement;
      }

      let seen: Array<number> | null =
        solid ||
        parse(getComputedStyle(document.body).backgroundColor) ||
        parse(getComputedStyle(document.documentElement).backgroundColor);

      if (!seen || seen[3]! < 0.999) {
        seen = [255, 255, 255, 1];
      }

      for (let index: number = washes.length - 1; index >= 0; index--) {
        const wash: Array<number> = washes[index]!;
        const alpha: number = wash[3]!;

        seen = [
          wash[0]! * alpha + seen[0]! * (1 - alpha),
          wash[1]! * alpha + seen[1]! * (1 - alpha),
          wash[2]! * alpha + seen[2]! * (1 - alpha),
          1,
        ];
      }

      return seen;
    };

    const found: Array<string> = [];

    for (const root of roots) {
      for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (element.closest("svg")) {
          continue;
        }

        const hasText: boolean = Array.from(element.childNodes).some(
          (node: ChildNode): boolean => {
            return (
              node.nodeType === Node.TEXT_NODE &&
              (node.textContent || "").trim().length > 0
            );
          },
        );

        if (!hasText) {
          continue;
        }

        const style: CSSStyleDeclaration = getComputedStyle(element);
        const box: DOMRect = element.getBoundingClientRect();

        if (
          style.visibility === "hidden" ||
          style.display === "none" ||
          box.width < 1 ||
          box.height < 1
        ) {
          continue;
        }

        const text: Array<number> | null = parse(style.color);
        const ground: Array<number> | null = groundOf(element);

        if (!text || !ground) {
          continue;
        }

        const lighter: number = Math.max(luminance(text), luminance(ground));
        const darker: number = Math.min(luminance(text), luminance(ground));
        const ratio: number = (lighter + 0.05) / (darker + 0.05);
        const size: number = parseFloat(style.fontSize);
        const isLarge: boolean =
          size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);

        if (ratio < (isLarge ? 3 : 4.5)) {
          found.push(
            `${ratio.toFixed(2)} "${(element.textContent || "").trim().slice(0, 40)}" ${style.color} on rgb(${ground.slice(0, 3).join(", ")})`,
          );
        }
      }
    }

    return found;
  });
};

const channelsOf: (colour: string) => Array<number> = (
  colour: string,
): Array<number> => {
  return (colour.match(COLOUR_CHANNELS) || []).map(Number);
};

// Whether a computed background is see-through: no fill of its own.
const isClear: (colour: string) => boolean = (colour: string): boolean => {
  const channels: Array<number> = channelsOf(colour);
  return channels.length === 4 && channels[3] === 0;
};

// Nothing the pages ask for leaves the fixture.
test.beforeEach(async ({ page }: { page: Page }) => {
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1" && url.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  const unexpected: Array<string> = await record(page)
    .then((fixture: FixtureRecord): Array<string> => {
      return fixture.unexpected;
    })
    .catch((): Array<string> => {
      return [];
    });

  // Every request the pages made is one the fixture models.
  expect(unexpected).toEqual([]);
});

test.describe("metric tables on the dashboard inside OneUptime", () => {
  test("color each value by its column's thresholds, as the shared rules read the number on screen", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page);

    const { hosts } = await readingsOf(page);

    await expectHostTable(page, tableTitled(page, SATURATION), hosts);
    await expectHostTable(page, tableTitled(page, FILLED), hosts);

    await shoot(page, testInfo, "board");
  });

  test("show a fraction of 1 as a percent, and 79.96% at one decimal as 80.0%, a warning", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openApp(page);

    const table: Locator = tableTitled(page, SATURATION);
    const worker: Locator = await cellOf(table, "worker-1", "CPU");

    await expect(worker).toHaveText("80.0%");
    await expect(worker).toHaveAttribute(
      "data-threshold-level",
      TableThresholdLevel.Warning,
    );
    await expect(await cellOf(table, "web-3", "CPU")).toHaveText("93.0%");
    // A metric whose unit is 1 is a plain number: no "1" after it.
    await expect(await cellOf(table, "web-3", "Load")).toHaveText("7.9");
    // A host that sent no free disk reading shows a dash, uncolored.
    const missing: Locator = await cellOf(table, "cache-1", "Free disk");
    await expect(missing).toHaveText("—");
    await expect(missing).not.toHaveAttribute("data-threshold-level");
  });

  test("never tell a level by color alone: a triangle or a circle, critical in bold", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page);

    const table: Locator = tableTitled(page, SATURATION);
    const warning: Locator = await cellOf(table, "web-2", "CPU");
    const critical: Locator = await cellOf(table, "web-3", "CPU");
    const normal: Locator = await cellOf(table, "web-1", "CPU");

    const look: (cell: Locator) => Promise<{
      color: string;
      weight: string;
      shape: string;
    }> = async (
      cell: Locator,
    ): Promise<{ color: string; weight: string; shape: string }> => {
      return cell.evaluate(
        (
          element: Element,
        ): { color: string; weight: string; shape: string } => {
          const style: CSSStyleDeclaration = getComputedStyle(element);
          return {
            color: style.color,
            weight: style.fontWeight,
            shape:
              element.querySelector("svg path")?.getAttribute("d") || "none",
          };
        },
      );
    };

    const warningLook: { color: string; weight: string; shape: string } =
      await look(warning);
    const criticalLook: { color: string; weight: string; shape: string } =
      await look(critical);
    const normalLook: { color: string; weight: string; shape: string } =
      await look(normal);

    expect(warningLook.weight).toBe("600");
    expect(criticalLook.weight).toBe("700");
    expect(normalLook.weight).toBe("600");
    expect(
      new Set([warningLook.color, criticalLook.color, normalLook.color]).size,
    ).toBe(3);
    expect(warningLook.shape).not.toBe("none");
    expect(criticalLook.shape).not.toBe("none");
    expect(warningLook.shape).not.toBe(criticalLook.shape);
    expect(normalLook.shape).toBe("none");

    // The shape comes before the number, so numbers line up at their end.
    const iconBox: { x: number } | null = await critical
      .getByRole("img")
      .boundingBox();
    const numberBox: { x: number } | null = await critical
      .getByText("93.0%")
      .boundingBox();
    expect(iconBox!.x).toBeLessThan(numberBox!.x);

    await shoot(page, testInfo, "levels", widgetTitled(page, SATURATION));
  });

  test("Colored background fills the cell, and Colored text leaves it clear", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page);

    const backgroundOf: (cell: Locator) => Promise<string> = async (
      cell: Locator,
    ): Promise<string> => {
      return cell.evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    };

    const filledCritical: string = await backgroundOf(
      await cellOf(tableTitled(page, FILLED), "web-3", "CPU"),
    );
    const filledWarning: string = await backgroundOf(
      await cellOf(tableTitled(page, FILLED), "web-2", "CPU"),
    );
    const filledNormal: string = await backgroundOf(
      await cellOf(tableTitled(page, FILLED), "web-1", "CPU"),
    );
    const textCritical: string = await backgroundOf(
      await cellOf(tableTitled(page, SATURATION), "web-3", "CPU"),
    );

    expect(isClear(filledCritical)).toBe(false);
    expect(isClear(filledWarning)).toBe(false);
    expect(filledCritical).not.toBe(filledWarning);
    expect(isClear(filledNormal)).toBe(true);
    expect(isClear(textCritical)).toBe(true);

    await shoot(page, testInfo, "filled", widgetTitled(page, FILLED));
  });

  test("color each bucket of a table over time", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openApp(page);

    const { cpuOverTime } = await readingsOf(page);
    const rows: Locator = tableTitled(page, OVER_TIME).locator("tbody tr");

    await expect(rows).toHaveCount(cpuOverTime.length);

    for (let index: number = 0; index < cpuOverTime.length; index++) {
      const cell: Locator = rows.nth(index).locator("td").nth(1);
      const expected: { text: string; level: TableThresholdLevel | null } =
        expectedCell(cpuOverTime[index]!, HOST_COLUMNS[0]!);

      await expect(cell).toHaveText(expected.text);

      if (expected.level) {
        await expect(cell).toHaveAttribute(
          "data-threshold-level",
          expected.level,
        );
      } else {
        await expect(cell).not.toHaveAttribute("data-threshold-level");
      }
    }
  });

  test("in the light theme, every value is legible, warnings and criticals included", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openApp(page);

    for (const title of [SATURATION, FILLED, OVER_TIME]) {
      expect(
        await lowContrastTextsIn(valueCellsOf(page, title)),
        TITLES[title],
      ).toEqual([]);
    }
  });

  test("in the dark theme, the amber and red turn light and the fills dark, every value legible", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "?theme=dark");

    for (const title of [SATURATION, FILLED, OVER_TIME]) {
      expect(
        await lowContrastTextsIn(valueCellsOf(page, title)),
        TITLES[title],
      ).toEqual([]);
    }

    // A dark wash behind a filled critical cell, not a pale light-theme one.
    const fill: Array<number> = channelsOf(
      await (
        await cellOf(tableTitled(page, FILLED), "web-3", "CPU")
      ).evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      }),
    );
    expect(fill[3]).toBeLessThan(1);

    await shoot(page, testInfo, "board-dark");
  });

  test("say it in German", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await openApp(page, "?lang=de");

    const critical: Locator = await cellOf(
      tableTitled(page, SATURATION),
      "web-3",
      "CPU",
    );

    await expect(critical).toHaveAttribute(
      "title",
      "Kritisch: 90% und darüber",
    );
    await expect(
      (
        await cellOf(tableTitled(page, SATURATION), "db-1", "Free disk")
      ).getByRole("img", { name: "Warnung: 20% und darunter" }),
    ).toHaveCount(1);

    await shoot(page, testInfo, "board-de", widgetTitled(page, SATURATION));
  });

  test("lay a Persian table out right to left, the shape at each value's start", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openApp(page, "?lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const critical: Locator = await cellOf(
      tableTitled(page, SATURATION),
      "web-3",
      "CPU",
    );

    await expect(critical).toHaveAttribute("title", "بحرانی: 90% و بالاتر");

    // Right to left, the start of the line is its right.
    const iconBox: { x: number } | null = await critical
      .getByRole("img")
      .boundingBox();
    const numberBox: { x: number } | null = await critical
      .getByText("93.0%")
      .boundingBox();
    expect(iconBox!.x).toBeGreaterThan(numberBox!.x);

    for (const title of [SATURATION, FILLED]) {
      expect(
        await lowContrastTextsIn(valueCellsOf(page, title)),
        TITLES[title],
      ).toEqual([]);
    }

    await shoot(page, testInfo, "board-fa", widgetTitled(page, FILLED));
  });
});

test.describe("a table's thresholds in its settings", () => {
  test("a column's thresholds, then Colored background, drawn in the Live Preview as they change and kept by Save Changes", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await page.goto(APP_PATH);
    await boardDrawn(page);
    await page.evaluate((): void => {
      window.sessionStorage.clear();
      window.localStorage.clear();
    });
    await openApp(page);

    await enterEditMode(page);
    const modal: Locator = await openSettings(page, SATURATION);
    const card: Locator = modal.getByTestId("table-column-thresholds-cpu");
    const preview: Locator = previewTable(modal);

    // The column comes with its thresholds on, in the column's unit.
    await expect(
      card.getByRole("checkbox", { name: "Color by thresholds" }),
    ).toBeChecked();
    await expect(card.getByLabel("Warning at")).toHaveValue("80");
    await expect(card.getByLabel("Critical at")).toHaveValue("90");
    await expect(
      card.getByTestId("table-column-thresholds-warning-cpu-unit"),
    ).toHaveText("%");
    await expect(
      card.getByTestId("table-column-thresholds-legend-cpu"),
    ).toContainText("Critical: 90% and above");

    await expect(await cellOf(preview, "web-3", "CPU")).toHaveAttribute(
      "data-threshold-level",
      TableThresholdLevel.Critical,
    );

    // Critical moves to 95: web-3's 93% is a warning in the preview at once.
    await card.getByLabel("Critical at").fill("95");
    await expect(
      card.getByTestId("table-column-thresholds-legend-cpu"),
    ).toContainText("Critical: 95% and above");
    await expect(await cellOf(preview, "web-3", "CPU")).toHaveAttribute(
      "data-threshold-level",
      TableThresholdLevel.Warning,
    );

    // The whole table fills its cells.
    const choice: Locator = modal.getByTestId("table-threshold-style");
    await expect(
      choice.getByRole("radio", { name: "Colored text" }),
    ).toBeChecked();
    // Each choice is a picture of a column's warning and critical cells.
    for (const style of ["Text", "Background"]) {
      await expect(
        choice
          .getByTestId(`table-threshold-style-${style}-visual`)
          .locator("[data-threshold-level]"),
        style,
      ).toHaveText(["84%", "93%"]);
    }
    await expect(
      choice.getByRole("radio", { name: "Colored background" }),
    ).toHaveAccessibleDescription("The whole cell turns amber or red.");
    await press(choice.getByTestId("table-threshold-style-Background"));
    await expect(
      choice.getByRole("radio", { name: /Colored background/ }),
    ).toBeChecked();
    expect(
      isClear(
        await (
          await cellOf(preview, "web-3", "CPU")
        ).evaluate((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        }),
      ),
    ).toBe(false);

    await shoot(
      page,
      testInfo,
      "settings-thresholds",
      card.locator("xpath=.."),
    );
    await shoot(page, testInfo, "settings-threshold-colors", choice);

    await press(modal.getByRole("button", { name: "Done" }));
    await expect(modal).toHaveCount(0);
    await press(page.getByRole("button", { name: "Save Changes" }));

    await expect
      .poll(async (): Promise<number> => {
        return ((await record(page)).saves || []).length;
      })
      .toBe(1);

    const saved: Record<string, unknown> = ((await record(page)).saves ||
      [])[0]!.dashboardViewConfig;
    const savedTable: Record<string, unknown> | undefined = (
      saved["components"] as Array<Record<string, unknown>>
    ).find((component: Record<string, unknown>): boolean => {
      const widgetArguments: Record<string, unknown> = component[
        "arguments"
      ] as Record<string, unknown>;
      return widgetArguments["tableTitle"] === TITLES[SATURATION];
    });
    const savedArguments: Record<string, unknown> = savedTable![
      "arguments"
    ] as Record<string, unknown>;
    const savedCpu: Record<string, unknown> | undefined = (
      savedArguments["columns"] as Array<Record<string, unknown>>
    ).find((column: Record<string, unknown>): boolean => {
      return column["id"] === "cpu";
    });

    expect(savedCpu!["thresholds"]).toEqual({
      warning: 80,
      critical: 95,
      direction: TableThresholdDirection.HigherIsWorse,
    });
    expect(savedArguments["thresholdStyle"]).toBe("Background");

    // Everyone opens it so.
    await page.reload();
    await boardDrawn(page);
    const reopened: Locator = await cellOf(
      tableTitled(page, SATURATION),
      "web-3",
      "CPU",
    );
    await expect(reopened).toHaveAttribute(
      "data-threshold-level",
      TableThresholdLevel.Warning,
    );
    expect(
      isClear(
        await reopened.evaluate((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        }),
      ),
    ).toBe(false);
  });

  test("a column with no thresholds yet: ticked, it asks for a value, and colors as soon as one is typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openApp(page);

    await enterEditMode(page);
    const modal: Locator = await openSettings(page, SATURATION);
    const card: Locator = modal.getByTestId("table-column-thresholds-load");
    const preview: Locator = previewTable(modal);

    await expect(card.getByLabel("Warning at")).toHaveCount(0);
    await press(card.getByRole("checkbox", { name: "Color by thresholds" }));

    // No unit, no preset: Load's scale is the reader's to know.
    await expect(card.getByLabel("Warning at")).toHaveValue("");
    await expect(
      card.getByTestId("table-column-thresholds-empty-load"),
    ).toHaveText("Set a warning or a critical value to color this column.");
    await expect(
      card.getByTestId("table-column-thresholds-warning-load-unit"),
    ).toHaveCount(0);

    await card.getByLabel("Warning at").fill("4");

    await expect(await cellOf(preview, "web-3", "Load")).toHaveAttribute(
      "data-threshold-level",
      TableThresholdLevel.Warning,
    );
    await expect(await cellOf(preview, "worker-2", "Load")).toHaveAttribute(
      "data-threshold-level",
      TableThresholdLevel.Warning,
    );
    await expect(await cellOf(preview, "web-2", "Load")).not.toHaveAttribute(
      "data-threshold-level",
    );
  });

  test("in the dark theme and in German, the thresholds' card and choice are legible and worded", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page, "?theme=dark&lang=de");

    await enterEditMode(page, german);
    const modal: Locator = await openSettings(page, SATURATION);
    const card: Locator = modal.getByTestId("table-column-thresholds-cpu");
    const choice: Locator = modal.getByTestId("table-threshold-style");

    await expect(
      card.getByRole("checkbox", { name: german("Color by thresholds") }),
    ).toBeChecked();
    await expect(card.getByLabel(german("Warning at"))).toHaveValue("80");
    await expect(card.getByLabel(german("Critical at"))).toHaveValue("90");
    await expect(
      card.getByTestId("table-column-thresholds-legend-cpu"),
    ).toContainText(
      german("Critical: {{value}} and above").split("{{value}}").join("90%"),
    );
    await expect(choice).toContainText(german("Threshold colors"));
    await expect(choice).toContainText(german("Colored background"));

    expect(await lowContrastTextsIn(card)).toEqual([]);
    expect(await lowContrastTextsIn(choice)).toEqual([]);

    await shoot(page, testInfo, "settings-dark-de", card.locator("xpath=.."));
  });

  test("Lower is worse on a percent column still at 80 and 90 starts it at 20 and 10, drawn in the Live Preview", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page);

    await enterEditMode(page);
    const modal: Locator = await openSettings(page, SATURATION);
    const card: Locator = modal.getByTestId("table-column-thresholds-cpu");
    const preview: Locator = previewTable(modal);

    await press(card.getByRole("combobox"));
    await press(page.getByRole("option", { name: "Lower is worse" }));

    await expect(card.getByLabel("Warning at")).toHaveValue("20");
    await expect(card.getByLabel("Critical at")).toHaveValue("10");
    await expect(
      card
        .getByTestId("table-column-thresholds-legend-cpu")
        .locator("[data-threshold-level]"),
    ).toHaveText(["Warning: 20% and below", "Critical: 10% and below"]);
    // The pick never lands on critical the wrong side of warning.
    await expect(
      card.getByTestId("table-column-thresholds-reversed-cpu"),
    ).toHaveCount(0);

    // cache-1's 12% is now a warning; web-3's 93% is fine.
    await expect(await cellOf(preview, "cache-1", "CPU")).toHaveAttribute(
      "data-threshold-level",
      TableThresholdLevel.Warning,
    );
    await expect(await cellOf(preview, "web-3", "CPU")).not.toHaveAttribute(
      "data-threshold-level",
    );

    await shoot(
      page,
      testInfo,
      "settings-lower-is-worse",
      card.locator("xpath=.."),
    );
  });

  test("in Colored text, a column's levels line up with its fields above them", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();
    await openApp(page);

    await enterEditMode(page);
    const modal: Locator = await openSettings(page, SATURATION);
    const card: Locator = modal.getByTestId("table-column-thresholds-cpu");

    await card.scrollIntoViewIfNeeded();
    await expect(
      card.getByTestId("table-column-thresholds-legend-cpu"),
    ).toBeVisible();

    // Both edges in one frame: the dialog may still be settling.
    const edges: { field: number; level: number; levels: number } =
      await card.evaluate(
        (
          element: Element,
        ): { field: number; level: number; levels: number } => {
          const field: Element = element.querySelector(
            '[data-testid="table-column-thresholds-warning-cpu"]',
          )!;
          const levels: Array<Element> = Array.from(
            element.querySelector(
              '[data-testid="table-column-thresholds-legend-cpu"]',
            )!.children,
          );

          return {
            field: field.getBoundingClientRect().left,
            level: levels[0]!.getBoundingClientRect().left,
            levels: levels.length,
          };
        },
      );

    expect(edges.levels).toBe(2);
    expect(Math.abs(edges.field - edges.level)).toBeLessThanOrEqual(1);
  });

  /*
   * A dashboard is edited on a laptop - on a phone its board runs past the
   * screen - but the dialog's window can be narrow: there the column's three
   * fields stack, each the card's width.
   */
  test("in a narrow window, a column's thresholds stack one above another and still color the preview", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();
    await openApp(page);

    await enterEditMode(page);
    const modal: Locator = await openSettings(page, SATURATION);
    const card: Locator = modal.getByTestId("table-column-thresholds-cpu");

    await page.setViewportSize({ width: 390, height: 844 });
    await card.scrollIntoViewIfNeeded();

    const warningBox: { x: number; y: number; width: number } | null =
      await card.getByLabel("Warning at").boundingBox();
    const criticalBox: { x: number; y: number; width: number } | null =
      await card.getByLabel("Critical at").boundingBox();

    expect(criticalBox!.y).toBeGreaterThan(warningBox!.y + 20);
    // Each field takes the card's width, less its unit.
    expect(warningBox!.width).toBeGreaterThan(200);

    await card.getByLabel("Critical at").fill("95");
    await expect(
      await cellOf(previewTable(modal), "web-3", "CPU"),
    ).toHaveAttribute("data-threshold-level", TableThresholdLevel.Warning);

    /*
     * The card fits the dialog, and nothing in it runs past its edge. (The
     * board behind the dialog is wider than the window, as on a phone.)
     */
    const cardBox: { x: number; width: number } | null =
      await card.boundingBox();
    const windowWidth: number = page.viewportSize()!.width;

    expect(cardBox!.x).toBeGreaterThanOrEqual(0);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(windowWidth);
    expect(
      await card.evaluate((element: Element): boolean => {
        return element.scrollWidth <= element.clientWidth;
      }),
    ).toBe(true);

    // The column's Remove keeps its own width beside the column's name.
    const remove: { width: number } | null = await card
      .locator("xpath=..")
      .getByRole("button", { name: "Remove" })
      .boundingBox();
    expect(remove!.width).toBeLessThan(windowWidth / 2);

    await shoot(page, testInfo, "settings-narrow", card.locator("xpath=.."));
  });
});

test.describe("metric tables on a public dashboard", () => {
  test("color every value as the dashboard inside OneUptime does", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPublic(page);

    const { hosts } = await readingsOf(page);

    await expectHostTable(page, tableTitled(page, SATURATION), hosts);
    await expectHostTable(page, tableTitled(page, FILLED), hosts);

    for (const title of [SATURATION, FILLED, OVER_TIME]) {
      expect(
        await lowContrastTextsIn(valueCellsOf(page, title)),
        TITLES[title],
      ).toEqual([]);
    }

    await shoot(page, testInfo, "public");
  });

  test("a Dark dashboard keeps every value legible", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPublic(page, "?publicTheme=Dark");

    for (const title of [SATURATION, FILLED, OVER_TIME]) {
      expect(
        await lowContrastTextsIn(valueCellsOf(page, title)),
        TITLES[title],
      ).toEqual([]);
    }

    await shoot(page, testInfo, "public-dark");
  });
});
