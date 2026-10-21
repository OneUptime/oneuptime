import { Locator, Page, Route, expect, test } from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";

/*
 * The session list's header, measured in Chromium.
 *
 * The maintainer's report: "There are buttons which do not match the
 * sizes ... buttons flying everywhere. Please make it look like any other
 * table in OneUptime." The list's toolbar had a tall sort select with a
 * clear x, a small time chip, a text "Advanced filters" button, a lone
 * refresh icon and a "Search help" link. It is now the header every table
 * has - the "Search…  /" pill, the time range and the ⋯ (the sort order,
 * Filter, Refresh) beside the title, one height - with the chips in the
 * shared Filter row under it; and the list and Replay Users fit a laptop's
 * card, where a column used to go under the sticky Actions column.
 *
 * Measured in Inter, as the Dashboard draws it: the fixture's fallback face
 * is wider, and a header that fits in Inter wrapped in it.
 */

const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/session-replay-ui",
);
const applicationRoute: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/rum/20000000-0000-4000-8000-000000000001";
const listRoute: string = `${applicationRoute}/session-replay`;
const usersRoute: string = `${applicationRoute}/session-replay-users`;
const interFont: string = path.resolve(
  __dirname,
  "../../Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);
const INTER_FONT_PATH: string = "/__list-header-font/InterVariable.woff2";
const INTER_FONT_FACE: string = `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('${INTER_FONT_PATH}') format('woff2');}*{font-family:Inter,ui-sans-serif,system-ui,sans-serif}`;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FixtureRequest {
  route: string;
  data: Record<string, unknown>;
}

const box: (locator: Locator) => Promise<Box> = async (
  locator: Locator,
): Promise<Box> => {
  const found: Box | null = await locator.boundingBox();

  if (!found) {
    throw new Error("The element has no box");
  }

  return found;
};

const listRequests: (page: Page) => Promise<Array<FixtureRequest>> = async (
  page: Page,
): Promise<Array<FixtureRequest>> => {
  return page.evaluate((): Array<FixtureRequest> => {
    return (
      window as unknown as {
        __sessionReplayFixture: { requests: Array<FixtureRequest> };
      }
    ).__sessionReplayFixture.requests.filter(
      (request: FixtureRequest): boolean => {
        return request.route === "list";
      },
    );
  });
};

const lastListRequest: (
  page: Page,
) => Promise<Record<string, unknown>> = async (
  page: Page,
): Promise<Record<string, unknown>> => {
  const requests: Array<FixtureRequest> = await listRequests(page);

  return requests[requests.length - 1]!.data;
};

// Opens a page of the fixture in Inter, the Dashboard's face.
const open: (page: Page, route: string) => Promise<void> = async (
  page: Page,
  route: string,
): Promise<void> => {
  await page.route(`**${INTER_FONT_PATH}`, (route: Route): Promise<void> => {
    return route.fulfill({ path: interFont, contentType: "font/woff2" });
  });
  await page.goto(route);
  await page.addStyleTag({ content: INTER_FONT_FACE });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.load("400 14px Inter");
    await document.fonts.load("600 14px Inter");
  });
};

const openList: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await open(page, `${listRoute}${query}`);
  await expect(
    page.locator('[data-testid="session-row"]:visible').first(),
  ).toBeVisible();
};

const screenshot: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: false,
  });
};

// The list's own card, and its header.
const listCard: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("card").filter({
    has: page.getByTestId("card-header-actions"),
  });
};

const header: (page: Page) => Locator = (page: Page): Locator => {
  return listCard(page).getByTestId("card-header").first();
};

// The header's three controls: the search, the window, the ⋯.
const controls: (page: Page) => Array<Locator> = (
  page: Page,
): Array<Locator> => {
  return [
    page.getByTestId("session-search-slot"),
    page.getByTestId("telemetry-time-range-picker-button"),
    page.getByTestId("session-replay-more"),
  ];
};

// Waits out the search slot's width transition (300ms) before measuring.
const settleHeader: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  let previous: number = -1;

  for (let attempt: number = 0; attempt < 30; attempt++) {
    const width: number = (await box(page.getByTestId("session-search-slot")))
      .width;

    if (Math.abs(width - previous) < 0.5) {
      return;
    }

    previous = width;
    await page.waitForTimeout(60);
  }
};

const expectOneHeight: (
  locators: Array<Locator>,
  height: number,
) => Promise<void> = async (
  locators: Array<Locator>,
  height: number,
): Promise<void> => {
  for (const locator of locators) {
    expect(Math.round((await box(locator)).height)).toBe(height);
  }
};

const expectNoHorizontalOverflow: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  expect(
    await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    }),
  ).toBeLessThanOrEqual(1);
};

test.describe("the session list's header", () => {
  test("at 1280: the title, then the search, the window and the ⋯ on its line, one height, centred on one another", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openList(page);
    await settleHeader(page);

    await expectOneHeight(controls(page), 38);

    const title: Box = await box(
      header(page).getByTestId("card-details-heading"),
    );
    const centres: Array<number> = [];

    for (const control of controls(page)) {
      const found: Box = await box(control);

      centres.push(found.y + found.height / 2);
      /* On the title's line, not under it. */
      expect(found.y).toBeLessThan(title.y + title.height);
      expect(found.x).toBeGreaterThan(title.x + title.width);
    }

    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);

    /* Left to right, 12px apart. */
    const [search, time, more] = await Promise.all(
      controls(page).map((control: Locator): Promise<Box> => {
        return box(control);
      }),
    );

    expect(Math.round(time!.x - (search!.x + search!.width))).toBe(12);
    expect(Math.round(more!.x - (time!.x + time!.width))).toBe(12);

    /* Nothing else in the header: no loose icon, no text button, no link. */
    const actions: Locator = header(page).getByTestId("card-header-actions");

    await expect(actions.getByRole("button")).toHaveCount(3);
    await expect(actions.getByRole("link")).toHaveCount(0);
    await expect(actions.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByText("Search help", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Advanced filters", { exact: true }),
    ).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
    await screenshot(page, "session-replay-list-header-1280");
  });

  test("on a phone: the search fills its line and the window and the ⋯ follow it, one height, no overflow", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openList(page);
    await settleHeader(page);

    await expectOneHeight(controls(page), 42);

    const card: Box = await box(listCard(page).first());
    const search: Box = await box(page.getByTestId("session-search-slot"));

    /* The card's width less its 20px padding and its border either side. */
    expect(Math.abs(search.width - (card.width - 42))).toBeLessThanOrEqual(1);

    const more: Box = await box(page.getByTestId("session-replay-more"));

    expect(more.x + more.width).toBeLessThanOrEqual(card.x + card.width - 19);

    await expectNoHorizontalOverflow(page);
    await screenshot(page, "session-replay-list-header-390");
  });

  test("the chips sit in the shared Filter row, every chip one height", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openList(page);

    const row: Locator = page.getByTestId("session-replay-facets");

    await expect(row).toHaveAttribute("role", "group");
    await expect(row.locator("span").first()).toHaveText("Filter");

    const chips: Array<Locator> = await row.getByTestId("filter-chip").all();

    expect(chips).toHaveLength(7);

    const heights: Array<number> = [];

    for (const chip of chips) {
      heights.push(Math.round((await box(chip)).height));
    }

    expect(new Set(heights).size).toBe(1);
  });

  test("the ⋯ holds the sort order, Filter and Refresh; a sort is sent once and ticked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openList(page);

    await page.getByTestId("session-replay-more").click();

    const menu: Locator = page.getByRole("menu");

    await expect(menu.getByRole("menuitemradio")).toHaveText([
      "Newest",
      "Longest",
      "Most errors",
      "Most frustration",
    ]);
    await expect(
      menu.getByRole("menuitemradio", { name: "Newest", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitem")).toHaveText(["Filter", "Refresh"]);
    await screenshot(page, "session-replay-list-more-menu");

    const before: number = (await listRequests(page)).length;

    await menu
      .getByRole("menuitemradio", { name: "Most errors", exact: true })
      .click();

    await expect
      .poll(async (): Promise<number> => {
        return (await listRequests(page)).length;
      })
      .toBe(before + 1);
    expect((await lastListRequest(page))["sortBy"]).toBe("errorCount");
    await expect(page).toHaveURL(/sort=errorCount/);

    await page.getByTestId("session-replay-more").click();
    await expect(
      page
        .getByRole("menu")
        .getByRole("menuitemradio", { name: "Most errors", exact: true }),
    ).toHaveAttribute("aria-checked", "true");

    /* Refresh reads the same page again, in the same order. */
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Refresh", exact: true })
      .click();

    await expect
      .poll(async (): Promise<number> => {
        return (await listRequests(page)).length;
      })
      .toBe(before + 2);
    expect((await lastListRequest(page))["sortBy"]).toBe("errorCount");
  });

  test("the search opens in place: the window and the ⋯ stay beside it, one height", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openList(page);
    await settleHeader(page);

    const folded: number = (await box(page.getByTestId("session-search-slot")))
      .width;

    expect(Math.round(folded)).toBe(224);

    await page
      .getByRole("button", { name: "Open search", exact: true })
      .click();
    await expect(page.getByTestId("session-search-input")).toBeFocused();
    await settleHeader(page);

    const opened: Box = await box(page.getByTestId("session-search-slot"));

    expect(Math.round(opened.width)).toBe(384);
    await expectOneHeight(controls(page), 38);
    await expect(
      page.getByTestId("telemetry-time-range-picker-button"),
    ).toBeVisible();
    await expect(page.getByTestId("session-replay-more")).toBeVisible();

    /* Still on the title's line. */
    const title: Box = await box(
      header(page).getByTestId("card-details-heading"),
    );

    expect(opened.y).toBeLessThan(title.y + title.height);
    await expect(page.getByTestId("session-search-help")).toBeVisible();
    await screenshot(page, "session-replay-list-search-open");

    /* A person typed into the box goes to the server; the box stays open. */
    await page
      .getByTestId("session-search-input")
      .fill("user:jane@example.com");
    await expect
      .poll(async (): Promise<unknown> => {
        return (
          (await lastListRequest(page))["filters"] as Record<string, unknown>
        )["identifiedUserRef"];
      })
      .toBe("jane@example.com");

    await header(page).getByTestId("card-details-heading").click();
    await settleHeader(page);
    expect(
      Math.round((await box(page.getByTestId("session-search-slot"))).width),
    ).toBe(384);

    /* Escape empties it; Escape again folds it. */
    await page.getByTestId("session-search-input").focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("session-search-input")).toHaveValue("");
    await page.keyboard.press("Escape");
    await settleHeader(page);
    expect(
      Math.round((await box(page.getByTestId("session-search-slot"))).width),
    ).toBe(224);
  });

  test("a chip token typed into the box moves into its chip on Enter", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openList(page);

    await page.keyboard.press("/");
    await expect(page.getByTestId("session-search-input")).toBeFocused();
    await page.keyboard.type("browser:Chrome checkout");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("session-search-input")).toHaveValue(
      "checkout",
    );
    await expect(page.getByTestId("session-facet-browserName")).toContainText(
      "Chrome",
    );
    await expect
      .poll(async (): Promise<unknown> => {
        return (await lastListRequest(page))["filters"];
      })
      .toMatchObject({ browserNames: ["Chrome"], search: "checkout" });
  });

  test("in the dark theme the header's controls are drawn on the dark card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openList(page, "?theme=dark");
    await settleHeader(page);

    const backgrounds: Array<string> = [];

    for (const selector of [
      '[data-testid="session-search-slot"] button',
      '[data-testid="telemetry-time-range-picker-button"]',
      '[data-testid="session-replay-more"]',
    ]) {
      backgrounds.push(
        await page
          .locator(selector)
          .first()
          .evaluate((element: Element) => {
            return getComputedStyle(element).backgroundColor;
          }),
      );
    }

    for (const background of backgrounds) {
      expect(background).not.toBe("rgb(255, 255, 255)");
    }

    await expectOneHeight(controls(page), 38);
    await screenshot(page, "session-replay-list-header-1280-dark");
  });
});

/*
 * Both lists fit a laptop's card: every column in view, none under the
 * sticky Actions column. At 1280 the session list was 1144px in a 938px
 * card, and still wider than its card at 1600.
 */
test.describe("the Session Replay tables fit their cards", () => {
  for (const width of [1280, 1440, 1600]) {
    test(`the session list and Replay Users at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 900 });

      for (const route of [listRoute, usersRoute]) {
        await open(page, route);
        await expect(
          page
            .locator(
              '[data-testid="session-row"]:visible, [data-testid="session-user-row"]:visible',
            )
            .first(),
        ).toBeVisible();

        const scroll: Locator = page.getByTestId("table-scroll");

        await expect(scroll).toHaveAttribute("data-overflowing", "false");

        const table: Box = await box(scroll.locator("table"));
        const frame: Box = await box(scroll);

        expect(table.width).toBeLessThanOrEqual(frame.width + 0.5);

        /* The last data column ends before the Actions column begins. */
        const headers: Array<Locator> = await scroll.locator("thead th").all();
        const lastData: Box = await box(headers[headers.length - 2]!);
        const actions: Box = await box(headers[headers.length - 1]!);

        expect(lastData.x + lastData.width).toBeLessThanOrEqual(
          actions.x + 0.5,
        );

        await expectNoHorizontalOverflow(page);
      }
    });
  }

  test("Replay Users: the window and the ⋯ in the header, one height", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, usersRoute);
    await expect(
      page.locator('[data-testid="session-user-row"]:visible').first(),
    ).toBeVisible();

    const toolbar: Locator = header(page).getByTestId("session-users-toolbar");

    await expectOneHeight(
      [
        toolbar.getByTestId("telemetry-time-range-picker-button"),
        toolbar.getByTestId("session-users-more"),
      ],
      38,
    );
    await expect(
      header(page).getByTestId("card-header-actions").getByRole("button"),
    ).toHaveCount(2);

    await toolbar.getByTestId("session-users-more").click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([
      "All sessions",
      "Refresh",
    ]);
    await screenshot(page, "session-replay-users-header-1280");

    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await expectOneHeight(
      [
        toolbar.getByTestId("telemetry-time-range-picker-button"),
        toolbar.getByTestId("session-users-more"),
      ],
      42,
    );
    await expectNoHorizontalOverflow(page);
    await screenshot(page, "session-replay-users-header-390");
  });
});
