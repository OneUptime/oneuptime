import { Locator, Page, expect, test } from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";

const artifacts: string = path.resolve(
  __dirname,
  "../../output/playwright/session-replay-ui",
);
const applicationRoute: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/rum/20000000-0000-4000-8000-000000000001";
const listRoute: string = `${applicationRoute}/session-replay`;
const playerRoute: string = `${listRoute}/${"a".repeat(32)}`;
interface FixtureRequest {
  route: string;
  data: Record<string, unknown>;
}
interface FixtureState {
  requests: Array<FixtureRequest>;
  failList: boolean;
}
const state: (page: Page) => Promise<FixtureState> = async (
  page: Page,
): Promise<FixtureState> =>
  page.evaluate(
    (): FixtureState =>
      (window as unknown as { __sessionReplayFixture: FixtureState })
        .__sessionReplayFixture,
  );
const lastListRequest: (
  page: Page,
) => Promise<Record<string, unknown>> = async (
  page: Page,
): Promise<Record<string, unknown>> => {
  const requests: Array<FixtureRequest> = (await state(page)).requests.filter(
    (request: FixtureRequest): boolean => request.route === "list",
  );
  return requests[requests.length - 1]!.data;
};
const rows: (page: Page) => Locator = (page: Page): Locator =>
  page.locator('[data-testid="session-row"]:visible');
const openList: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await page.goto(`${listRoute}${query}`);
  await expect(page.getByTestId("session-search-input")).toBeVisible();
  await expect(page.getByTestId("health-strip-level")).toBeAttached();
};
const openPlayer: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await page.goto(`${playerRoute}${query}`);
  await expect(page.getByTestId("replay-phase")).toHaveText("playing", {
    timeout: 30000,
  });
  await expect(
    page
      .frameLocator('[data-testid="replay-stage"] iframe')
      .getByText("Complete your order"),
  ).toBeVisible();
};
const facet: (
  page: Page,
  field: string,
  option: string,
) => Promise<void> = async (
  page: Page,
  field: string,
  option: string,
): Promise<void> => {
  await page
    .getByTestId(`session-facet-${field}`)
    .getByRole("button")
    .first()
    .click();
  await page
    .getByRole("option")
    .filter({ has: page.getByText(option, { exact: true }) })
    .click();
};
const screenshot: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: true,
  });
};
const clockSeconds: (text: string) => number = (text: string): number => {
  const match: RegExpMatchArray | null = text.match(
    /(\d+):(\d+(?:\.\d+)?)\s*\//,
  );
  if (!match) throw new Error(`Unreadable replay clock: ${text}`);
  return Number(match[1]) * 60 + Number(match[2]);
};
const noHorizontalOverflow: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  expect(
    await page.evaluate(
      (): number => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
};

test("uses the shared table and groups replay navigation in its own category", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);
  await expect(rows(page)).toHaveCount(8);
  await expect(
    page.getByTestId("session-table").getByRole("table"),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "User & device", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("session-replay-facets")).toBeVisible();
  const section: Locator = page
    .locator("h6")
    .filter({ hasText: /^Session Replay$/ })
    .locator("../..")
    .locator("..");
  await expect(section.getByRole("link")).toHaveText([
    "Session Replay",
    "Replay Policy",
    "Replay Access Log",
  ]);
  await expect(
    section.getByRole("link", { name: "Replay Policy" }),
  ).toHaveAttribute("href", `${applicationRoute}/session-replay-settings`);
  await expect(
    section.getByRole("link", { name: "Replay Access Log" }),
  ).toHaveAttribute("href", `${applicationRoute}/session-replay-audit`);
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-list");
  await page
    .getByRole("button", { name: "Session Replay", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Session Replay", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page
    .getByRole("button", { name: "Session Replay", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Session Replay", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("combines facets, synchronizes URL and clears filters across the entire result", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);
  await facet(page, "browserName", "Chrome");
  await expect(rows(page)).toHaveCount(3);
  await expect
    .poll(
      async (): Promise<unknown> => (await lastListRequest(page))["filters"],
    )
    .toMatchObject({ browserNames: ["Chrome"] });
  await facet(page, "signal", "Errors");
  await expect
    .poll(
      async (): Promise<unknown> => (await lastListRequest(page))["filters"],
    )
    .toMatchObject({ browserNames: ["Chrome"], hasError: true });
  await expect(page).toHaveURL(/browser=Chrome/);
  await expect(page).toHaveURL(/signal=errors/);
  await screenshot(page, "session-replay-filtered");
  await page.reload();
  await expect(page.getByTestId("session-facet-browserName")).toContainText(
    "Chrome",
  );
  await expect(page.getByTestId("session-facet-signal")).toContainText(
    "Errors",
  );
  await page.getByTestId("session-clear-filters").click();
  await expect(rows(page)).toHaveCount(8);
  await expect
    .poll(
      async (): Promise<unknown> => (await lastListRequest(page))["filters"],
    )
    .toEqual({});
});

test("country search and duration facets issue the expected endpoint values", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);
  await page
    .getByTestId("session-facet-countryCode")
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("dialog").getByRole("textbox").fill("United Kingdom");
  await screenshot(page, "session-replay-facet");
  await page
    .getByRole("option", { name: "United Kingdom (GB)", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(3);
  await expect
    .poll(
      async (): Promise<unknown> => (await lastListRequest(page))["filters"],
    )
    .toMatchObject({ countryCodes: ["GB"] });
  await facet(page, "minDurationSeconds", "At least 2 minutes");
  await expect(rows(page)).toHaveCount(1);
  await expect
    .poll(
      async (): Promise<unknown> => (await lastListRequest(page))["filters"],
    )
    .toMatchObject({ countryCodes: ["GB"], minDurationMs: 120000 });
  await page
    .getByRole("button", { name: "Clear Country filter", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(3);
});

test("search guidance is optional and an empty result offers a direct reset", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);
  await expect(page.getByTestId("session-search-hint")).toHaveCount(0);
  await page.getByRole("button", { name: "Search help", exact: true }).click();
  await expect(page.getByTestId("session-search-hint")).toBeVisible();
  await page.getByTestId("session-search-input").fill("absent-customer");
  await page.getByTestId("session-search-input").press("Enter");
  await expect(page.getByTestId("list-empty")).toBeVisible();
  await expect(page.getByTestId("list-empty-title")).toContainText(
    /No sessions match/i,
  );
  await expect(page.getByTestId("list-empty")).not.toContainText(
    "Create a telemetry ingestion key",
  );
  await page
    .getByTestId("list-empty")
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(8);
});

test("the first recording empty state keeps setup documentation on the documentation page", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page, "?fixture=empty");
  await expect(page.getByTestId("list-empty-title")).toHaveText(
    "No recordings yet",
  );
  await expect(page.getByTestId("list-empty")).not.toContainText(
    "Create a telemetry ingestion key",
  );
  await expect(page.locator("pre")).toHaveCount(0);
  await expect(page.getByTestId("session-replay-facets")).toBeVisible();
  await screenshot(page, "session-replay-empty");
  await page
    .getByRole("button", { name: "Set up recording", exact: true })
    .click();
  await expect(page).toHaveURL(`${applicationRoute}/documentation`);
  await expect(
    page.getByText("Create a telemetry ingestion key", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("list-empty")).toHaveCount(0);
});

test("a failed list request has a working retry without discarding the filters", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page, "?fixture=error&browser=Chrome");
  await expect(page.getByTestId("list-error")).toBeVisible();
  await page.evaluate((): void => {
    (
      window as unknown as { __sessionReplayFixture: FixtureState }
    ).__sessionReplayFixture.failList = false;
  });
  await page.getByTestId("list-error-retry").click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId("list-error")).toHaveCount(0);
  await expect(page.getByTestId("session-facet-browserName")).toContainText(
    "Chrome",
  );
});

test("pagination forwards the opaque cursor and changing the sort resets it", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page, "?count=25");
  await expect(rows(page)).toHaveCount(20);
  await page
    .getByTestId("session-pagination")
    .getByTestId("pagination-next-button")
    .click();
  await expect(rows(page)).toHaveCount(5);
  await expect
    .poll(async (): Promise<unknown> => (await lastListRequest(page))["cursor"])
    .toMatchObject({ sessionId: "00000000000000000000000000000014" });
  await page.getByRole("combobox", { name: "Sort sessions" }).click();
  await page.getByRole("option", { name: "Longest", exact: true }).click();
  await expect(rows(page)).toHaveCount(20);
  await expect
    .poll(async (): Promise<unknown> => (await lastListRequest(page))["sortBy"])
    .toBe("durationMs");
  expect(await lastListRequest(page)).not.toHaveProperty("cursor");
});

test("watch opens real footage and the return link restores list filters", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);
  await facet(page, "browserName", "Chrome");
  await rows(page).first().getByTestId("session-row-watch").click();
  await expect(page.getByTestId("replay-phase")).toHaveText("playing", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("heading", { name: "Session recording", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("replay-header-user")).toHaveText(
    "alex@example.com",
  );
  await page.getByTestId("replay-back-link").click();
  await expect(page).toHaveURL(/browser=Chrome/);
  await expect(rows(page)).toHaveCount(3);
});

test("plays incremental frames, pauses, seeks and keeps speed options visible above controls", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page);
  const frame: Locator = page
    .frameLocator('[data-testid="replay-stage"] iframe')
    .locator("#fixture-stage-step");
  const firstFrame: string = await frame.innerText();
  await expect(frame).not.toHaveText(firstFrame, { timeout: 10000 });
  await page.getByTestId("replay-play-pause").click();
  await expect(page.getByTestId("replay-phase")).toHaveText("paused");
  const before: number = clockSeconds(
    await page.getByTestId("replay-time").innerText(),
  );
  await page.getByTestId("replay-seek-forward").click();
  await expect
    .poll(
      async (): Promise<number> =>
        clockSeconds(await page.getByTestId("replay-time").innerText()),
    )
    .toBeGreaterThanOrEqual(before + 10);
  await page.getByTestId("replay-speed").click();
  const option: Locator = page.getByTestId("replay-speed-option-2");
  await expect(option).toBeVisible();
  expect(
    await option.evaluate((element: HTMLElement): boolean => {
      const rect: DOMRect = element.getBoundingClientRect();
      const hit: Element | null = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return hit === element || element.contains(hit);
    }),
  ).toBe(true);
  await option.click();
  await expect(page.getByTestId("replay-speed")).toContainText("2x");
  await page.getByTestId("replay-speed").click();
  await screenshot(page, "session-replay-speed-menu");
  await page.keyboard.press("Escape");
  await page.getByTestId("replay-play-pause").click();
  await expect(page.getByTestId("replay-phase")).toHaveText("playing");
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-player");
});

test("event search, error selection, details and rail collapse keep their state", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page);
  await page.getByTestId("replay-play-pause").click();
  await page.getByTestId("rail-tab-errors").click();
  await expect(page.getByTestId("rail-row")).toHaveCount(1);
  await page.getByTestId("rail-search-input").fill("does-not-exist");
  await expect(page.getByTestId("rail-empty")).toBeVisible();
  await page
    .getByRole("button", { name: "Clear event search", exact: true })
    .click();
  await expect(page.getByTestId("rail-search-input")).toBeFocused();
  await expect(page.getByTestId("rail-row")).toHaveCount(1);
  await page
    .getByTestId("rail-row")
    .getByText("Payment request failed", { exact: true })
    .click();
  // Event selection includes one second of context before the error.
  await expect(page.getByTestId("replay-time")).toContainText("0:11");
  await page.getByTestId("replay-rail-collapse").click();
  await expect(page.getByTestId("replay-rail")).not.toBeVisible();
  await page.getByTestId("replay-rail-expand").click();
  await expect(page.getByTestId("rail-tab-errors")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page
    .getByRole("button", { name: "Session details", exact: true })
    .click();
  await expect(page.getByTestId("details-tab-session")).toBeVisible();
  await expect(page.getByTestId("details-tab-session")).toContainText(
    "alex@example.com",
  );
  await screenshot(page, "session-replay-details");
});

test("recording tabs support keyboard selection while skipping tabs without footage", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page, "?tabs=multiple");
  const tabs: Locator = page.getByTestId("replay-tab-pill");
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(2)).toBeDisabled();
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
});

test("the mobile list, filters, recording and event search fit a narrow viewport", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openList(page);
  await expect(rows(page)).toHaveCount(8);
  await noHorizontalOverflow(page);
  await facet(page, "deviceType", "Mobile");
  await expect(rows(page)).toHaveCount(3);
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-list-mobile");
  await openPlayer(page);
  await expect(page.getByTestId("replay-play-pause")).toBeVisible();
  await expect(page.getByTestId("replay-speed")).toBeVisible();
  await expect(page.getByTestId("rail-search-input")).toBeVisible();
  await noHorizontalOverflow(page);
  const legendBottom: number = await page
    .getByTestId("timeline-legend")
    .evaluate((legend: HTMLElement): number => {
      return Math.max(
        ...Array.from(legend.children).map((item: Element): number => {
          return item.getBoundingClientRect().bottom;
        }),
      );
    });
  const controlsTop: number = await page
    .getByTestId("replay-controls")
    .evaluate((controls: HTMLElement): number => {
      return controls.getBoundingClientRect().top;
    });
  expect(legendBottom).toBeLessThanOrEqual(controlsTop);
  await page.getByTestId("rail-search-input").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("rail-row").first()).toBeVisible();
  await screenshot(page, "session-replay-player-mobile");
});

test("playback controls fit the initial laptop viewport without scrolling", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);
  const stage = await page.getByTestId("replay-stage").boundingBox();
  const controls = await page.getByTestId("replay-play-pause").boundingBox();
  expect(stage).not.toBeNull();
  expect(stage!.height).toBeGreaterThanOrEqual(256);
  expect(controls).not.toBeNull();
  expect(controls!.y).toBeGreaterThan(0);
  expect(controls!.y + controls!.height).toBeLessThanOrEqual(900);
  expect(await page.evaluate((): number => window.scrollY)).toBe(0);
  await screenshot(page, "session-replay-player-laptop");
});
