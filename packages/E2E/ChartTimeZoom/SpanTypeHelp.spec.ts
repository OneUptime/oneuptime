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
 * "Too long description, have this in a tooltip or something."
 *
 * The Traces explorer's Span Type drew three sentences - "Entry spans: where
 * a request or message enters a service. Root spans: where a trace starts.
 * All spans: every operation, including database calls and internal
 * steps." - as a paragraph between its title and its three options, which
 * pushed them, and every facet below, down the sidebar.
 *
 * The production explorer runs on the offline fixture (Fixture/Fixture.js).
 * The title is followed by the options alone. An (i) right after the title
 * says what each option is - on hover, keyboard focus or a tap that keeps
 * it - in a box that opens to the right of the title, in both themes; each
 * option says its own on hover and keyboard focus; and a click anywhere on
 * the header's row but the (i) still folds the section, the chevron too.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const TRACES_PATH: string = `/dashboard/${PROJECT_ID}/traces`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/chart-time-zoom-ui",
);

// Each option's name, and what it is.
const CHOICES: Array<[string, string]> = [
  ["Entry spans", "Where a request or message enters a service."],
  ["Root spans", "Where a trace starts."],
  [
    "All spans",
    "Every operation, including database calls and internal steps.",
  ],
];

interface SpecWindow {
  __chartTimeZoomFixture: {
    unhandled: Array<Record<string, unknown>>;
  };
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
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
    await route.abort();
  });

  // The fixture's moment, and a clock that keeps ticking from it.
  await page.clock.install({ time: NOW });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    await page
      .evaluate((): Array<Record<string, unknown>> => {
        const state: SpecWindow["__chartTimeZoomFixture"] | undefined = (
          window as unknown as Partial<SpecWindow>
        ).__chartTimeZoomFixture;
        return state
          ? (JSON.parse(JSON.stringify(state.unhandled)) as Array<
              Record<string, unknown>
            >)
          : [];
      })
      .catch((): Array<Record<string, unknown>> => {
        return [];
      }),
    "requests the fixture does not model",
  ).toEqual([]);
});

async function open(
  page: Page,
  options: { width: number; theme?: "dark" },
): Promise<void> {
  await page.setViewportSize({ width: options.width, height: 1000 });
  await page.goto(
    `${TRACES_PATH}${options.theme === "dark" ? "?theme=dark" : ""}`,
  );
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  // Below md the sidebar is folded behind the Filters toggle.
  const toggle: Locator = page.getByTestId("telemetry-viewer-filters-toggle");
  if (await toggle.isVisible()) {
    await toggle.click();
  }

  await expect(
    page.getByRole("radio", { name: "Entry spans", exact: true }),
  ).toBeVisible({ timeout: 30000 });

  // The Span Type in the middle of the screen, with room on every side.
  await spanTypeSection(page).evaluate((element: Element): void => {
    element.scrollIntoView({ block: "center" });
  });
}

// The button that folds the Span Type section.
function spanTypeHeader(page: Page): Locator {
  return page
    .locator("button[aria-expanded]")
    .filter({ hasText: /^Span Type/ })
    .first();
}

// The Span Type section: the header's row's parent.
function spanTypeSection(page: Page): Locator {
  return spanTypeHeader(page).locator("xpath=../..");
}

function helpButton(page: Page): Locator {
  return page.getByRole("button", { name: "About Span Type", exact: true });
}

// A Tippy box on the page, by what it says.
function tooltipSaying(page: Page, text: string | RegExp): Locator {
  return page.getByRole("tooltip").filter({ hasText: text });
}

// An option's own tooltip: its sentence and nothing else.
function optionTooltip(page: Page, sentence: string): Locator {
  return page.getByRole("tooltip", { name: sentence, exact: true });
}

// The help's names and sentences, as its definition list draws them.
async function helpEntries(tooltip: Locator): Promise<Array<[string, string]>> {
  const names: Array<string> = await tooltip.locator("dt").allTextContents();
  const sentences: Array<string> = await tooltip
    .locator("dd")
    .allTextContents();

  return names.map((name: string, index: number): [string, string] => {
    return [name, sentences[index] || ""];
  });
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box as Box;
}

// WCAG's contrast of two computed colours, "rgb(r, g, b)".
async function contrastOf(text: Locator, background: Locator): Promise<number> {
  const colours: [string, string] = [
    await text.evaluate((element: Element): string => {
      return getComputedStyle(element).color;
    }),
    await background.evaluate((element: Element): string => {
      return getComputedStyle(element).backgroundColor;
    }),
  ];

  const luminance: (colour: string) => number = (colour: string): number => {
    const channels: Array<number> = (colour.match(/[\d.]+/g) || [])
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
  };

  const [lighter, darker] = colours
    .map(luminance)
    .sort((a: number, b: number): number => {
      return b - a;
    }) as [number, number];

  return (lighter + 0.05) / (darker + 0.05);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  const section: Box = await boxOf(spanTypeSection(page));
  const tooltips: Array<Box> = [];
  for (const tooltip of await page.getByRole("tooltip").all()) {
    tooltips.push(await boxOf(tooltip));
  }
  const left: number = Math.max(0, section.x - 16);
  const top: number = Math.max(
    0,
    Math.min(
      section.y - 64,
      ...tooltips.map((box: Box): number => {
        return box.y - 16;
      }),
    ),
  );
  const right: number = Math.max(
    section.x + section.width + 16,
    ...tooltips.map((box: Box): number => {
      return box.x + box.width + 16;
    }),
  );
  const bottom: number = Math.max(
    section.y + section.height + 48,
    ...tooltips.map((box: Box): number => {
      return box.y + box.height + 16;
    }),
  );
  const viewport: { width: number; height: number } | null =
    page.viewportSize();

  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    clip: {
      x: left,
      y: top,
      width: Math.min(right, viewport?.width || right) - left,
      height: Math.min(bottom, viewport?.height || bottom) - top,
    },
    animations: "disabled",
  });
}

test.describe("Traces explorer: what each Span Type option is", () => {
  test("REGRESSION: the title is followed by the options alone, with no paragraph between them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1440 });

    const section: Locator = spanTypeSection(page);
    const header: Box = await boxOf(spanTypeHeader(page));
    const firstOption: Box = await boxOf(
      section.getByRole("radio", { name: "Entry spans", exact: true }),
    );

    // The first option starts right under the title, where the paragraph was.
    expect(firstOption.y - (header.y + header.height)).toBeLessThan(12);

    // None of the sentences is drawn in the sidebar until asked for.
    for (const [, sentence] of CHOICES) {
      await expect(
        section.getByText(sentence, { exact: true }).filter({ visible: true }),
      ).toHaveCount(0);
    }
    await expect(
      page.getByText(/where a request or message enters a service/i).filter({
        visible: true,
      }),
    ).toHaveCount(0);

    // Three options and the title: the section is that tall, and no more.
    expect((await boxOf(section)).height).toBeLessThan(150);

    await screenshot(page, "span-type-1440");
  });

  test("pointing at the (i) lists each option with what it is, to the right of the title", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1440 });

    const info: Locator = helpButton(page);
    await expect(info).toBeVisible();

    // Right after the title, on the header's row.
    const title: Box = await boxOf(
      spanTypeHeader(page).getByText("Span Type", { exact: true }),
    );
    const infoBox: Box = await boxOf(info);
    expect(infoBox.x).toBeGreaterThanOrEqual(title.x + title.width);
    expect(infoBox.x - (title.x + title.width)).toBeLessThan(16);
    expect(
      Math.abs(infoBox.y + infoBox.height / 2 - (title.y + title.height / 2)),
    ).toBeLessThan(4);

    await info.hover();

    const tooltip: Locator = tooltipSaying(page, "Where a trace starts.");
    await expect(tooltip).toBeVisible();
    expect(await helpEntries(tooltip)).toEqual(CHOICES);

    // Opened to the right of the (i): the title and the options' names stay in view.
    expect(await tooltip.getAttribute("data-placement")).toMatch(/^right/);
    const tooltipBox: Box = await boxOf(tooltip);
    expect(tooltipBox.x).toBeGreaterThanOrEqual(infoBox.x + infoBox.width);
    for (const [name] of CHOICES) {
      const label: Box = await boxOf(
        spanTypeSection(page)
          .getByRole("radio", { name: name, exact: true })
          .getByText(name, { exact: true }),
      );
      expect(label.x + label.width).toBeLessThanOrEqual(tooltipBox.x);
    }

    await screenshot(page, "span-type-help-1440");

    // Moving away puts it away.
    await page.mouse.move(1400, 960);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("each option says what it is when pointed at", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1440 });

    for (const [name, sentence] of CHOICES) {
      const option: Locator = spanTypeSection(page).getByRole("radio", {
        name: name,
        exact: true,
      });

      await option.hover();
      await expect(optionTooltip(page, sentence)).toBeVisible();
      await expect(page.getByRole("tooltip")).toHaveCount(1);
    }

    await screenshot(page, "span-type-option-1440");
  });

  test("the keyboard: Tab reaches the (i) after the title, and then each option, each saying what it is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1440 });

    await spanTypeHeader(page).focus();
    await page.keyboard.press("Tab");

    await expect(helpButton(page)).toBeFocused();
    const help: Locator = tooltipSaying(page, "Where a trace starts.");
    await expect(help).toBeVisible();
    expect(await helpEntries(help)).toEqual(CHOICES);

    await page.keyboard.press("Tab");

    await expect(
      spanTypeSection(page).getByRole("radio", {
        name: "Entry spans",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      optionTooltip(page, "Where a request or message enters a service."),
    ).toBeVisible();
    // The (i)'s help went with the focus.
    await expect(page.getByRole("tooltip")).toHaveCount(1);

    await page.keyboard.press("Tab");
    await expect(optionTooltip(page, "Where a trace starts.")).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(1);
  });

  test("a click anywhere on the header's row folds the section - the chevron too - and a click on the (i) does not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 1440 });

    const header: Locator = spanTypeHeader(page);
    const chevron: Box = await boxOf(
      spanTypeSection(page).getByTestId("facet-section-chevron"),
    );

    // Where a reader clicks: the chevron at the row's end.
    await page.mouse.click(
      chevron.x + chevron.width / 2,
      chevron.y + chevron.height / 2,
    );
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("radio", { name: "Entry spans", exact: true }),
    ).toHaveCount(0);

    // The (i) answers its own click, folded or not, and folds nothing.
    await helpButton(page).click();
    await expect(tooltipSaying(page, "Where a trace starts.")).toBeVisible();
    await expect(header).toHaveAttribute("aria-expanded", "false");

    // The empty stretch between the (i) and the chevron opens it again.
    const info: Box = await boxOf(helpButton(page));
    await page.mouse.click(
      (info.x + info.width + chevron.x) / 2,
      chevron.y + chevron.height / 2,
    );
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("radio", { name: "Root spans", exact: true }),
    ).toBeVisible();
  });

  test("dark theme: the help's box is dark and its words easy to read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, { width: 1440, theme: "dark" });

    await helpButton(page).hover();

    const tooltip: Locator = tooltipSaying(page, "Where a trace starts.");
    await expect(tooltip).toBeVisible();

    // A dark box, not a near-white one on a dark page.
    const background: string = await tooltip.evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    const channels: Array<number> = (background.match(/[\d.]+/g) || [])
      .slice(0, 3)
      .map(Number);
    expect(Math.max(...channels)).toBeLessThan(80);

    expect(
      await contrastOf(tooltip.locator("dt").first(), tooltip),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrastOf(tooltip.locator("dd").first(), tooltip),
    ).toBeGreaterThanOrEqual(4.5);

    await screenshot(page, "span-type-help-dark-1440");
  });
});

test.describe("Traces explorer on a phone: what each Span Type option is", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("a tap on the (i) shows the help, which stays once the finger lifts, and a second tap puts it away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 390 });

    const info: Locator = helpButton(page);
    await info.scrollIntoViewIfNeeded();

    // Big enough for a finger.
    const infoBox: Box = await boxOf(info);
    expect(infoBox.width).toBeGreaterThanOrEqual(24);
    expect(infoBox.height).toBeGreaterThanOrEqual(24);

    await info.tap();

    const tooltip: Locator = tooltipSaying(page, "Where a trace starts.");
    await expect(tooltip).toBeVisible();
    expect(await helpEntries(tooltip)).toEqual(CHOICES);

    // Still there after the finger has lifted.
    await page.waitForTimeout(800);
    await expect(tooltip).toBeVisible();

    // On the screen, nothing cut off at its edges.
    const box: Box = await boxOf(tooltip);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    /*
     * No room to the right on a phone: it opens above the title, so the
     * options it explains stay in view under it.
     */
    expect(await tooltip.getAttribute("data-placement")).toMatch(/^top/);
    const firstOption: Box = await boxOf(
      spanTypeSection(page).getByRole("radio", {
        name: "Entry spans",
        exact: true,
      }),
    );
    expect(box.y + box.height).toBeLessThanOrEqual(firstOption.y);

    await screenshot(page, "span-type-help-390");

    await info.tap();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("a tap on an option still chooses it, and nothing it showed stays once the next tap lands elsewhere", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, { width: 390 });

    const rootSpans: Locator = spanTypeSection(page).getByRole("radio", {
      name: "Root spans",
      exact: true,
    });
    await rootSpans.scrollIntoViewIfNeeded();

    await rootSpans.tap();
    await expect(rootSpans).toHaveAttribute("aria-checked", "true");

    // The next tap, somewhere with nothing to do.
    await page.getByTestId("synthetic-banner").tap();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(rootSpans).toHaveAttribute("aria-checked", "true");
  });
});
