import { expect, Page, Route as PlaywrightRoute, test } from "@playwright/test";

/*
 * The Kubernetes cluster Overview's header in a real browser (issue #4105).
 *
 * The cluster's name shares the hero's top row with the page's controls:
 * the time picker, Refresh and Auto-refresh. A zoom widens those controls -
 * the picker reads a custom range and Reset zoom joins them - and they used
 * to take the width out of the name: "Production (eu-west-1)" read
 * "Production (eu-..." once zoomed at 1440px, and at 1024px and below the
 * name was cut even before any zoom. The name now keeps its room and the
 * controls give way, wrapping under it when the row is too narrow for both.
 *
 * Layout only a browser can measure, so it is pinned here, on the offline
 * fixture (Fixture/Fixture.js) with the browser clock pinned, a network
 * fence up, and a real drag across the CPU chart for the zoom.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CLUSTER_NAME: string = "Production (eu-west-1)";
const OVERVIEW_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}`;

const RESET_ZOOM_TEST_ID: string = "reset-time-range-zoom";
const PAGE_PICKER_TEST_ID: string = "telemetry-time-range-picker-button";

// Wide desktop down to the md breakpoint, where the row first stacks.
const WIDTHS: Array<number> = [1440, 1280, 1024, 900, 768];

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
      return fixture?.unhandled || [];
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function openOverview(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width: width, height: 1000 });
  await page.clock.setFixedTime(NOW);
  await page.goto(OVERVIEW_PATH);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator("h1", { hasText: CLUSTER_NAME })).toBeVisible({
    timeout: 30000,
  });
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
        controls: controls.map(toBox),
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    },
    {
      name: CLUSTER_NAME,
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

// A real drag across the middle of the CPU chart's plot.
async function zoomOnTheCpuChart(page: Page): Promise<void> {
  const plot: Box | null = await page.evaluate((): Box | null => {
    const captions: Array<Element> = Array.from(
      document.querySelectorAll("span.uppercase"),
    ).filter((caption: Element): boolean => {
      return (caption.textContent || "").trim() === "CPU";
    });
    for (const caption of captions) {
      const grid: Element | null | undefined = caption
        .closest(".rounded-xl")
        ?.querySelector(".recharts-cartesian-grid");
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
  test(`at ${width}px the cluster's name shows in full, before a zoom and after one`, async ({
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

test("a name longer than the whole row still truncates inside the hero, zoomed or not", async ({
  page,
}: {
  page: Page;
}) => {
  await openOverview(page, 1280);
  await zoomOnTheCpuChart(page);

  const longName: string =
    "arn:aws:eks:us-east-1:123456789012:cluster/production-cluster-with-a-very-long-name-indeed";
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
    { from: CLUSTER_NAME, to: longName },
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
