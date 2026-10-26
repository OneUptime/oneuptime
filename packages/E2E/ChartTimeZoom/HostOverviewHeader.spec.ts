import { expect, Page, Route as PlaywrightRoute, test } from "@playwright/test";
import path from "path";

/*
 * A host Overview's header in a real browser (the follow-up #5268 left).
 *
 * The host's name shares the hero's top row with the page's controls: the
 * time picker, Refresh and Auto-refresh. The hero put the controls beside
 * the name from the md breakpoint and kept their whole width, and the hero
 * sits beside the host's side menu: at a 768px window the name vanished
 * under the time picker and the Auto-refresh select ran 35px past the
 * window, and at 1024 the name read "a.." with "Last seen" one word a
 * line. Every resource hero now lays its top row out the way the
 * Kubernetes cluster's does (ResourceHeroLayout): the name keeps its room
 * and the controls give way, under it when the row is too narrow for both,
 * kept on the right. KubernetesOverviewHeader.spec.ts measures the cluster;
 * this measures the host, on the same offline fixture
 * (Fixture/Fixture.js), with the browser clock pinned, a network fence up,
 * and a real drag across the CPU chart for the zoom that widens the
 * controls.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HOST_ID: string = "62000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const HOST_NAME: string = "api-gateway-01";
const OVERVIEW_PATH: string = `/dashboard/${PROJECT_ID}/host/${HOST_ID}`;

const RESET_ZOOM_TEST_ID: string = "reset-time-range-zoom";
const PAGE_PICKER_TEST_ID: string = "telemetry-time-range-picker-button";

// Wide desktop down to the md breakpoint, where the side menu appears.
const WIDTHS: Array<number> = [1440, 1280, 1024, 900, 768];
const PHONE_WIDTH: number = 390;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/chart-time-zoom-ui",
);

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface HeaderLayout {
  // The name's rendered width against the width its text needs.
  titleClientWidth: number;
  titleScrollWidth: number;
  title: Box;
  hero: Box;
  // The hero's content box: inside its padding.
  heroContent: Box;
  // The picker, Reset zoom (when shown), Refresh and Auto-refresh.
  controls: Array<Box>;
  pageScrollWidth: number;
  viewportWidth: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(
  async ({ page, baseURL }: { page: Page; baseURL: string | undefined }) => {
    const errors: Array<string> = [];
    const aborted: Array<string> = [];
    pageErrors.set(page, errors);
    abortedRequests.set(page, aborted);
    page.on("pageerror", (error: Error) => {
      errors.push(error.message);
    });

    // Nothing may leave the fixture server.
    const fixtureOrigin: string = new URL(baseURL || "http://127.0.0.1:4233")
      .origin;
    await page.route("**/*", async (route: PlaywrightRoute) => {
      if (new URL(route.request().url()).origin === fixtureOrigin) {
        await route.continue();
        return;
      }
      aborted.push(route.request().url());
      await route.abort();
    });
  },
);

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  // Everything the page asked the fixture for, the fixture models.
  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const fixture: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __chartTimeZoomFixture?: { unhandled?: Array<unknown> };
        }
      ).__chartTimeZoomFixture;
      return JSON.parse(JSON.stringify(fixture?.unhandled || []));
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function openOverview(
  page: Page,
  width: number,
  theme?: "dark",
): Promise<void> {
  await page.setViewportSize({
    width: width,
    height: width === PHONE_WIDTH ? 844 : 1000,
  });
  await page.clock.setFixedTime(NOW);
  await page.goto(theme ? `${OVERVIEW_PATH}?theme=${theme}` : OVERVIEW_PATH);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  /*
   * Exactly the hero's name: the page header's own title also carries it
   * ("Host - api-gateway-01").
   */
  await expect(
    page.getByRole("heading", { name: HOST_NAME, exact: true }),
  ).toBeVisible({
    timeout: 30000,
  });
  // Availability, CPU, Memory, Disk space and Network.
  await expect(page.locator(".recharts-wrapper")).toHaveCount(5, {
    timeout: 30000,
  });
}

async function measureHeader(page: Page): Promise<HeaderLayout> {
  return page.evaluate(
    ({
      name,
      pickerTestId,
      resetTestId,
    }: {
      name: string;
      pickerTestId: string;
      resetTestId: string;
    }): HeaderLayout => {
      const toBox: (element: Element) => Box = (element: Element): Box => {
        const rect: DOMRect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      };

      const title: HTMLElement | undefined = Array.from(
        document.querySelectorAll("h1"),
      ).find((heading: HTMLElement): boolean => {
        return (heading.textContent || "").trim() === name;
      });
      if (!title) {
        throw new Error(`No "${name}" heading`);
      }

      // The hero card: the header's rounded, bordered box.
      const hero: Element | null = title.closest(".rounded-xl.border");
      if (!hero) {
        throw new Error("No hero card around the name");
      }
      const row: Element | null = hero.querySelector(
        "[data-testid='resource-hero-top-row']",
      );
      if (!row) {
        throw new Error("No top row in the hero");
      }

      const controls: Array<Element> = [
        hero.querySelector(`[data-testid='${pickerTestId}']`),
        hero.querySelector(`[data-testid='${resetTestId}']`),
        hero.querySelector("button[title='Refresh now']"),
        hero.querySelector("select"),
      ].filter((element: Element | null): element is Element => {
        return element !== null;
      });

      return {
        titleClientWidth: title.clientWidth,
        titleScrollWidth: title.scrollWidth,
        title: toBox(title),
        hero: toBox(hero),
        heroContent: toBox(row),
        controls: controls.map(toBox),
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    },
    {
      name: HOST_NAME,
      pickerTestId: PAGE_PICKER_TEST_ID,
      resetTestId: RESET_ZOOM_TEST_ID,
    },
  );
}

function expectHeaderFits(layout: HeaderLayout, label: string): void {
  // The whole name shows: its text needs no more room than it has.
  expect(
    layout.titleScrollWidth,
    `${label}: the name is cut (${layout.titleClientWidth}px of ${layout.titleScrollWidth}px)`,
  ).toBeLessThanOrEqual(layout.titleClientWidth);
  expect(
    layout.titleClientWidth,
    `${label}: the name has room`,
  ).toBeGreaterThan(100);

  // Every control stays inside the hero card, clear of the name.
  expect(layout.controls.length, `${label}: the controls`).toBeGreaterThan(2);
  for (const control of layout.controls) {
    expect(
      control.left,
      `${label}: a control spills left`,
    ).toBeGreaterThanOrEqual(layout.hero.left);
    expect(
      control.right,
      `${label}: a control spills right`,
    ).toBeLessThanOrEqual(layout.hero.right);
    const overlapsTitle: boolean =
      control.left < layout.title.right &&
      control.right > layout.title.left &&
      control.top < layout.title.bottom &&
      control.bottom > layout.title.top;
    expect(overlapsTitle, `${label}: a control covers the name`).toBe(false);
  }

  // And the page never scrolls sideways.
  expect(
    layout.pageScrollWidth,
    `${label}: the page scrolls sideways`,
  ).toBeLessThanOrEqual(layout.viewportWidth);
}

// Whether every control sits below the name, on lines of their own.
function controlsUnderTheName(layout: HeaderLayout): boolean {
  return layout.controls.every((control: Box): boolean => {
    return control.top >= layout.title.bottom;
  });
}

// A real drag across the middle of the CPU chart's plot.
async function zoomOnTheCpuChart(page: Page): Promise<void> {
  const plot: Box | null = await page.evaluate((): Box | null => {
    for (const wrapper of Array.from(
      document.querySelectorAll(".recharts-wrapper"),
    )) {
      // The caption of the card that holds this chart and no other.
      let node: Element | null = wrapper.parentElement;
      let caption: string = "";
      while (node && node.querySelectorAll(".recharts-wrapper").length === 1) {
        const span: Element | null = node.querySelector("span.uppercase");
        if (span) {
          caption = (span.textContent || "").trim();
          break;
        }
        node = node.parentElement;
      }
      if (caption !== "CPU") {
        continue;
      }
      const grid: Element | null = wrapper.querySelector(
        ".recharts-cartesian-grid",
      );
      if (grid) {
        grid.scrollIntoView({ block: "center" });
        const rect: DOMRect = grid.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      }
    }
    return null;
  });

  if (!plot) {
    throw new Error("No CPU chart plot");
  }

  const y: number = (plot.top + plot.bottom) / 2;
  const width: number = plot.right - plot.left;

  await page.mouse.move(plot.left + width * 0.3, y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(plot.left + width * 0.6, y, { steps: 12 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  // Off the chart, so no tooltip covers anything.
  await page.mouse.move(2, 2);

  await expect(page.getByTestId(RESET_ZOOM_TEST_ID)).toBeVisible({
    timeout: 15000,
  });
  await page.evaluate((): void => {
    window.scrollTo(0, 0);
  });
  await expect(page.getByTestId(PAGE_PICKER_TEST_ID)).not.toHaveText(
    "Past 30 Minutes",
  );
}

for (const width of WIDTHS) {
  test(`at ${width}px the host's name shows in full, before a zoom and after one`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, width);
    expectHeaderFits(await measureHeader(page), `${width}px, not zoomed`);

    await zoomOnTheCpuChart(page);

    const zoomed: HeaderLayout = await measureHeader(page);
    // Reset zoom is one of the controls now, and it fits too.
    expect(zoomed.controls).toHaveLength(4);
    expectHeaderFits(zoomed, `${width}px, zoomed`);
  });
}

test("beside the side menu the controls move under the name, kept on the right; at a laptop's width they sit beside it", async ({
  page,
}: {
  page: Page;
}) => {
  for (const width of [768, 1024]) {
    await openOverview(page, width);
    const layout: HeaderLayout = await measureHeader(page);

    expect(controlsUnderTheName(layout), `${width}px: under the name`).toBe(
      true,
    );
    // Kept on the right: the last control ends where the row ends.
    const rightmost: number = Math.max(
      ...layout.controls.map((control: Box): number => {
        return control.right;
      }),
    );
    expect(
      Math.abs(rightmost - layout.heroContent.right),
      `${width}px: the controls end at the row's right edge`,
    ).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: path.join(SCREENSHOTS, `host-overview-header-${width}.png`),
      clip: { x: 0, y: 0, width: width, height: 460 },
    });
  }

  await openOverview(page, 1280);
  const wide: HeaderLayout = await measureHeader(page);
  expect(controlsUnderTheName(wide), "1280px: beside the name").toBe(false);
  for (const control of wide.controls) {
    expect(control.left, "1280px: right of the name").toBeGreaterThan(
      wide.title.right,
    );
  }
  await page.screenshot({
    path: path.join(SCREENSHOTS, "host-overview-header-1280.png"),
    clip: { x: 0, y: 0, width: 1280, height: 400 },
  });
});

test("on a phone, light and dark: the name in full and the controls under it, nothing sideways", async ({
  page,
}: {
  page: Page;
}) => {
  for (const theme of [undefined, "dark" as const]) {
    await openOverview(page, PHONE_WIDTH, theme);
    const layout: HeaderLayout = await measureHeader(page);

    expectHeaderFits(layout, `${PHONE_WIDTH}px${theme ? `, ${theme}` : ""}`);
    expect(controlsUnderTheName(layout)).toBe(true);

    await page.screenshot({
      path: path.join(
        SCREENSHOTS,
        `host-overview-header-phone${theme ? `-${theme}` : ""}.png`,
      ),
      clip: { x: 0, y: 0, width: PHONE_WIDTH, height: 520 },
    });
  }
});

test("a name longer than the whole row still truncates inside the hero, zoomed or not", async ({
  page,
}: {
  page: Page;
}) => {
  await openOverview(page, 1024);
  await zoomOnTheCpuChart(page);

  const longName: string =
    "ip-10-20-4-21.eu-west-1.compute.internal-with-a-very-long-name-indeed-for-a-host";
  await page.evaluate(
    ({ from, to }: { from: string; to: string }): void => {
      const title: HTMLElement | undefined = Array.from(
        document.querySelectorAll("h1"),
      ).find((heading: HTMLElement): boolean => {
        return (heading.textContent || "").trim() === from;
      });
      if (!title) {
        throw new Error(`No "${from}" heading`);
      }
      title.textContent = to;
    },
    { from: HOST_NAME, to: longName },
  );

  const layout: {
    truncated: boolean;
    titleRight: number;
    heroRight: number;
    pageScrollWidth: number;
    viewportWidth: number;
  } = await page.evaluate(
    (
      name: string,
    ): {
      truncated: boolean;
      titleRight: number;
      heroRight: number;
      pageScrollWidth: number;
      viewportWidth: number;
    } => {
      const title: HTMLElement | undefined = Array.from(
        document.querySelectorAll("h1"),
      ).find((heading: HTMLElement): boolean => {
        return (heading.textContent || "").trim() === name;
      });
      const hero: Element | null | undefined =
        title?.closest(".rounded-xl.border");
      if (!title || !hero) {
        throw new Error("No long heading in a hero card");
      }
      return {
        truncated: title.scrollWidth > title.clientWidth,
        titleRight: title.getBoundingClientRect().right,
        heroRight: hero.getBoundingClientRect().right,
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    },
    longName,
  );

  expect(layout.truncated, "the long name is truncated").toBe(true);
  expect(layout.titleRight).toBeLessThanOrEqual(layout.heroRight);
  expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
