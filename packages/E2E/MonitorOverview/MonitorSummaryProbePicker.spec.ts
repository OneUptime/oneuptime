import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * THE MONITOR SUMMARY CARD'S PROBE PICKER AND SHOW MORE DETAILS, IN A REAL
 * BROWSER (#5281).
 *
 * "Showing results from:" sat beside its list at every width: on a phone the
 * list was left about 90px, beside a × that cleared nothing, and every probe
 * read "Frankfu…". The label now goes over the list - the list the card's
 * whole width - wherever the two do not fit side by side (a phone, the card
 * beside the side menu at 768px), and the list never clears. Show More
 * Details was text-gray-400, 2.5:1 on its card: it reads as a link that
 * works now, in both themes.
 *
 * What only a browser can tell is measured here: where the label and the
 * list sit, that the picked probe shows whole and inside the card, and the
 * drawn colours' contrast. The production overview against the offline
 * fixture, with its network fence and its record of requests it does not
 * model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const API_MONITOR_PATH: string = `/dashboard/${PROJECT_ID}/monitors/70000000-0000-4000-8000-000000000001`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PickerLayout {
  // The card's content: the width its summary below the header takes.
  content: Box;
  label: Box;
  list: Box;
  valueClipped: boolean;
  valueText: string;
  clearButtons: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// The overview at a width, once the Monitor Summary card has its facts.
async function openOverview(
  page: Page,
  data: { width: number; query?: string },
): Promise<Locator> {
  await page.setViewportSize({ width: data.width, height: 1000 });
  await page.clock.setFixedTime(NOW);
  await page.goto(
    `${API_MONITOR_PATH}?type=api${data.query ? `&${data.query}` : ""}`,
  );
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const body: Locator = page.getByTestId("monitor-summary-body");
  await expect(body).toBeVisible({ timeout: 60000 });
  await expect(body.getByTestId("monitor-summary-fact").first()).toBeVisible({
    timeout: 60000,
  });

  const picker: Locator = page.getByTestId("probe-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId("dropdown-value-label")).toHaveText(
    "Frankfurt (eu-central-1)",
  );

  // The page's fonts in, and the card laid out, before anything is measured.
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });

  return page
    .getByTestId("card")
    .filter({
      has: page.getByRole("heading", {
        level: 2,
        name: "Monitor Summary",
        exact: true,
      }),
    })
    .first();
}

// The card, the label, the list and the picked probe, read in one frame.
async function pickerLayout(page: Page): Promise<PickerLayout> {
  return page.evaluate((): PickerLayout => {
    const box: (element: Element) => {
      x: number;
      y: number;
      width: number;
      height: number;
    } = (element: Element) => {
      const rect: DOMRect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    const picker: Element = document.querySelector(
      "[data-testid='probe-picker']",
    )!;
    const body: Element = document.querySelector(
      "[data-testid='monitor-summary-body']",
    )!;
    const label: Element = picker.querySelector("label")!;
    const list: Element = picker.querySelector(".ou-select__control")!;
    const value: HTMLElement = picker.querySelector(
      "[data-testid='dropdown-value-label']",
    ) as HTMLElement;

    return {
      content: box(body),
      label: box(label),
      list: box(list),
      valueClipped: value.scrollWidth > value.clientWidth + 1,
      valueText: value.textContent || "",
      clearButtons: picker.querySelectorAll(".ou-select__clear-indicator")
        .length,
    };
  });
}

function expectInsideCard(layout: PickerLayout): void {
  expect(layout.list.x).toBeGreaterThanOrEqual(layout.content.x - 1);
  expect(layout.list.x + layout.list.width).toBeLessThanOrEqual(
    layout.content.x + layout.content.width + 1,
  );
  expect(layout.label.x).toBeGreaterThanOrEqual(layout.content.x - 1);
  expect(layout.label.x + layout.label.width).toBeLessThanOrEqual(
    layout.content.x + layout.content.width + 1,
  );
}

test.describe("the Monitor Summary card's probe picker", () => {
  for (const width of [390, 768]) {
    test(`at ${width}px the label sits over the list, and the list shows the probe whole, as wide as the card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openOverview(page, { width: width });

      const layout: PickerLayout = await pickerLayout(page);

      expect(layout.valueText).toBe("Frankfurt (eu-central-1)");
      expect(layout.valueClipped, "the picked probe is cut").toBe(false);
      expect(layout.clearButtons).toBe(0);

      // Over the list, its start level with the list's.
      expect(layout.label.y + layout.label.height).toBeLessThanOrEqual(
        layout.list.y + 1,
      );
      expect(Math.abs(layout.label.x - layout.list.x)).toBeLessThan(2);
      // The card's whole content width.
      expect(Math.abs(layout.list.x - layout.content.x)).toBeLessThan(2);
      expect(layout.list.width).toBeGreaterThanOrEqual(
        layout.content.width - 2,
      );
      expectInsideCard(layout);

      await screenshot(page, `probe-picker-${width}`);
    });
  }

  for (const width of [1024, 1280]) {
    test(`at ${width}px the label and the list share a line, centred on each other`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openOverview(page, { width: width });

      const layout: PickerLayout = await pickerLayout(page);

      expect(layout.valueClipped, "the picked probe is cut").toBe(false);
      expect(layout.clearButtons).toBe(0);

      // Beside the list, before it.
      expect(layout.label.x + layout.label.width).toBeLessThanOrEqual(
        layout.list.x,
      );
      expect(
        Math.abs(
          layout.label.y +
            layout.label.height / 2 -
            (layout.list.y + layout.list.height / 2),
        ),
      ).toBeLessThan(3);
      // 15rem: a probe's name and region, not the card's whole width.
      expect(layout.list.width).toBeGreaterThanOrEqual(239);
      expect(layout.list.width).toBeLessThan(layout.content.width / 2);
      expectInsideCard(layout);

      await screenshot(page, `probe-picker-${width}`);
    });
  }

  test("a phone of 320px still keeps the list inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, { width: 320 });

    const layout: PickerLayout = await pickerLayout(page);

    expectInsideCard(layout);

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const lang of ["de", "fa"]) {
    test(`in ${lang === "de" ? "German" : "Persian"} on a phone the label goes over the list too`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openOverview(page, { width: 390, query: `lang=${lang}` });

      const layout: PickerLayout = await pickerLayout(page);

      expect(layout.valueClipped).toBe(false);
      expect(layout.label.y + layout.label.height).toBeLessThanOrEqual(
        layout.list.y + 1,
      );
      expectInsideCard(layout);

      await screenshot(page, `probe-picker-390-${lang}`);
    });
  }

  test("picking another probe still shows its results", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, { width: 390 });

    await page.getByRole("combobox", { name: "Showing results from:" }).click();
    await page
      .getByRole("option", { name: "Singapore (ap-southeast-1)", exact: true })
      .click();

    await expect(
      page.getByTestId("probe-picker").getByTestId("dropdown-value-label"),
    ).toHaveText("Singapore (ap-southeast-1)");
    await expect(page.getByTestId("monitor-summary-body")).toContainText(
      "Singapore (ap-southeast-1)",
    );
  });
});

/*
 * WCAG relative luminance of an "rgb(r, g, b)" colour, and the contrast of
 * two: what the browser drew, not the class names.
 */
function luminance(color: string): number {
  const channels: Array<number> = (color.match(/\d+(\.\d+)?/g) || [])
    .slice(0, 3)
    .map((part: string): number => {
      const value: number = Number(part) / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

function contrast(first: string, second: string): number {
  const a: number = luminance(first);
  const b: number = luminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test.describe("Show More Details reads as a link that works", () => {
  for (const theme of ["light", "dark"]) {
    test(`in the ${theme} theme its words are at least 4.5:1 on its card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openOverview(page, {
        width: 1280,
        query: theme === "dark" ? "theme=dark" : "",
      });

      const button: Locator = page.getByRole("button", {
        name: "Show More Details",
      });
      await expect(button).toBeVisible();

      const colors: { text: string; card: string } = await button.evaluate(
        (element: Element): { text: string; card: string } => {
          let surface: Element | null = element;
          let card: string = "rgba(0, 0, 0, 0)";

          while (surface) {
            const background: string =
              window.getComputedStyle(surface).backgroundColor;
            if (background && !background.startsWith("rgba(0, 0, 0, 0)")) {
              card = background;
              break;
            }
            surface = surface.parentElement;
          }

          return { text: window.getComputedStyle(element).color, card: card };
        },
      );

      expect(contrast(colors.text, colors.card)).toBeGreaterThanOrEqual(4.5);

      await button.scrollIntoViewIfNeeded();
      await screenshot(page, `show-more-details-${theme}`);
    });
  }
});
