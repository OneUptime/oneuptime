import {
  BrowserContext,
  FrameLocator,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";

const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/session-replay-ui",
);
const applicationRoute: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/rum/20000000-0000-4000-8000-000000000001";
const listRoute: string = `${applicationRoute}/session-replay`;
const usersRoute: string = `${applicationRoute}/session-replay-users`;
const healthRoute: string = `${applicationRoute}/session-replay-health`;
const policyRoute: string = `${applicationRoute}/session-replay-settings`;
const documentationRoute: string = `${applicationRoute}/session-replay-documentation`;
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
): Promise<FixtureState> => {
  return page.evaluate((): FixtureState => {
    return (window as unknown as { __sessionReplayFixture: FixtureState })
      .__sessionReplayFixture;
  });
};
const lastListRequest: (
  page: Page,
) => Promise<Record<string, unknown>> = async (
  page: Page,
): Promise<Record<string, unknown>> => {
  const requests: Array<FixtureRequest> = (await state(page)).requests.filter(
    (request: FixtureRequest): boolean => {
      return request.route === "list";
    },
  );
  return requests[requests.length - 1]!.data;
};
const rows: (page: Page) => Locator = (page: Page): Locator => {
  return page.locator('[data-testid="session-row"]:visible');
};
const openList: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await page.goto(`${listRoute}${query}`);
  await expect(page.getByTestId("session-search-input")).toBeVisible();
};
const openHealth: (page: Page, scenario?: string) => Promise<void> = async (
  page: Page,
  scenario: string = "",
): Promise<void> => {
  await page.goto(`${healthRoute}${scenario ? `?health=${scenario}` : ""}`);
  await expect(page.getByTestId("health-hero")).toBeVisible();
  await expect(page.getByTestId("health-level")).not.toHaveText("loading");
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
const openMobilePlayer: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.goto(`${playerRoute}?recorder=mobile`);
  await expect(page.getByTestId("replay-phase")).toHaveText("playing", {
    timeout: 30000,
  });
  await expect(
    page
      .frameLocator('[data-testid="replay-stage"] iframe')
      .locator('[data-oneuptime-mobile-view="view"]')
      .first(),
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
  if (!match) {
    throw new Error(`Unreadable replay clock: ${text}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
};
const noHorizontalOverflow: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  expect(
    await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    }),
  ).toBeLessThanOrEqual(1);
};
/*
 * The recording every desktop fixture plays, from the manifest header in
 * Fixture.js. The redesign is measured against it: the stage draws it at
 * a scale the viewport chip reports, and the point of the new layout is
 * that the scale is now large (34% before, >= 55% at 1440x900).
 */
const recordedWidth: number = 1200;
const recordedHeight: number = 760;
interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
const boxOf: (locator: Locator) => Promise<ElementBox> = async (
  locator: Locator,
): Promise<ElementBox> => {
  const box: Awaited<ReturnType<Locator["boundingBox"]>> =
    await locator.boundingBox();

  expect(box).not.toBeNull();

  return box!;
};
/* "1200x760 -> 62%" -> 62. Throws when the chip reports no scale (1:1). */
const stageScalePercent: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  const text: string = await page
    .getByTestId("replay-viewport-chip")
    .innerText();
  const match: RegExpMatchArray | null = text.match(/(\d+)\s*%/);

  if (!match) {
    throw new Error(`The viewport chip reports no scale: ${text}`);
  }

  return Number(match[1]);
};
/*
 * The tab ids ?tabs=many mints, in opened order: tab N is the digit N
 * repeated (see manyTabId in Fixture/Fixture.js).
 */
const manyTabId: (position: number) => string = (position: number): string => {
  return String(position).repeat(32);
};
const tabPill: (page: Page, position: number) => Locator = (
  page: Page,
  position: number,
): Locator => {
  return page.locator(
    `[data-testid="replay-tab-pill"][data-tab-id="${manyTabId(position)}"]`,
  );
};
const tabOption: (page: Page, position: number) => Locator = (
  page: Page,
  position: number,
): Locator => {
  return page.locator(
    `[data-testid="replay-tab-option"][data-tab-id="${manyTabId(position)}"]`,
  );
};
const openTabPicker: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.getByTestId("replay-tab-picker-button").click();
  await expect(page.getByTestId("replay-tab-picker")).toBeVisible();
  await expect(page.getByTestId("replay-tab-picker-search")).toBeFocused();
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
  await expect(page.getByTestId("session-pagination")).toBeVisible();
  await expect(
    page.getByTestId("session-pagination").locator(".."),
  ).toHaveClass(/bg-gray-50/);
  await expect(
    page.getByTestId("pagination-items-on-page-select").locator("option"),
  ).toHaveText(["20", "50", "100"]);
  await expect(
    page.getByRole("button", { name: "Users", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Set up recording", exact: true }),
  ).toHaveCount(0);
  const section: Locator = page
    .locator("h6")
    .filter({ hasText: /^Session Replay$/ })
    .locator("../..")
    .locator("..");
  await expect(section.getByRole("link")).toHaveText([
    "Session Replay",
    "Replay Users",
    "Health",
    "Replay Policy",
    "Replay Access Log",
    "Documentation",
  ]);
  await expect(
    section.getByRole("link", { name: "Replay Users" }),
  ).toHaveAttribute("href", usersRoute);
  await expect(
    section.getByRole("link", { name: "Documentation" }),
  ).toHaveAttribute("href", documentationRoute);
  await expect(
    section.getByRole("link", { name: "Health", exact: true }),
  ).toHaveAttribute("href", healthRoute);
  /* Recording health lives on its own page now, not above the list. */
  await expect(page.getByTestId("health-strip")).toHaveCount(0);
  await expect(page.getByTestId("health-hero")).toHaveCount(0);
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

test("the health page reads a healthy application stage by stage", async ({
  page,
}: {
  page: Page;
}) => {
  await openHealth(page);
  await expect(page.getByTestId("health-level")).toHaveText("healthy");
  await expect(page.getByTestId("health-title")).toHaveText(
    "Recording healthy",
  );
  await expect(page.getByTestId("health-action")).toHaveCount(0);
  const stages: Locator = page
    .getByTestId("health-pipeline")
    .getByRole("listitem");
  await expect(stages).toHaveCount(4);
  for (const key of ["recorder", "policy", "uploads", "sessions"]) {
    await expect(page.getByTestId(`health-stage-${key}`)).toHaveAttribute(
      "data-tone",
      "ok",
    );
  }
  await expect(page.getByTestId("health-stage-sessions-value")).toHaveText("8");
  await expect(page.getByTestId("health-refusals")).toHaveAttribute(
    "data-kind",
    "none",
  );
  await expect(page.getByTestId("health-meter-project-day")).toContainText(
    "of 1 GB",
  );
  await expect(page.getByTestId("health-policy-consent")).toContainText(
    "Not required",
  );
  await expect(page.getByTestId("health-capabilities")).toContainText(
    "frustration",
  );
  await expect(page.getByTestId("diagnostics-paste-box")).toBeVisible();
  /* Every stage sits side by side on a laptop-wide viewport. */
  const tops: Array<number> = await stages.evaluateAll(
    (items: Array<Element>): Array<number> => {
      return items.map((item: Element): number => {
        return Math.round(item.getBoundingClientRect().top);
      });
    },
  );
  expect(new Set(tops).size).toBe(1);
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-health");
  /* Refresh reads the status again. */
  const before: number = (await state(page)).requests.filter(
    (request: FixtureRequest): boolean => {
      return request.route === "ingest-status";
    },
  ).length;
  await page.getByTestId("health-refresh").click();
  await expect
    .poll(async (): Promise<number> => {
      return (await state(page)).requests.filter(
        (request: FixtureRequest): boolean => {
          return request.route === "ingest-status";
        },
      ).length;
    })
    .toBeGreaterThan(before);
  await expect(page.getByTestId("health-level")).toHaveText("healthy");
});

test("the health page names refusals, the stage they stop and the fix", async ({
  page,
}: {
  page: Page;
}) => {
  await openHealth(page, "refusing");
  await expect(page.getByTestId("health-level")).toHaveText("refusing");
  await expect(page.getByTestId("health-title")).toHaveText(
    "212 uploads refused in 24h: origin not allowed",
  );
  await expect(page.getByTestId("health-stage-uploads")).toHaveAttribute(
    "data-tone",
    "warning",
  );
  await expect(page.getByTestId("health-stage-uploads-value")).toHaveText(
    "221 refused",
  );
  const refusalRows: Locator = page.getByTestId("health-refusals-row");
  await expect(refusalRows).toHaveCount(2);
  await expect(refusalRows.first()).toHaveAttribute(
    "data-reason",
    "origin-not-allowed",
  );
  await expect(refusalRows.first()).toContainText("Origin not allowed");
  await expect(page.getByTestId("health-drops-row")).toContainText(
    "scrub-incomplete",
  );
  await expect(page.getByTestId("health-meter-project-day")).toHaveAttribute(
    "data-tone",
    "warning",
  );
  await expect(page.getByTestId("health-policy-origins")).toContainText(
    "Any origin the ingestion key allows",
  );
  await screenshot(page, "session-replay-health-refusing");
  /* The one action goes to the page that owns allowed origins. */
  await expect(
    page.getByTestId("health-action").locator("xpath=ancestor::a"),
  ).toHaveAttribute("href", policyRoute);
  await page.getByTestId("health-action").click();
  await expect(page).toHaveURL(new RegExp(`${policyRoute}$`));
  /* The policy page keeps only the summary, and links back. */
  await expect(page.getByTestId("health-card")).toHaveAttribute(
    "data-state",
    "refusing",
  );
  await expect(page.getByTestId("health-pipeline")).toHaveCount(0);
  await page.getByRole("button", { name: "View health details" }).click();
  await expect(page).toHaveURL(new RegExp(`${healthRoute}`));
  await expect(page.getByTestId("health-hero")).toBeVisible();
});

test("the health page separates a switched-off project from a recorder that never loaded", async ({
  page,
}: {
  page: Page;
}) => {
  await openHealth(page, "disabled");
  await expect(page.getByTestId("health-level")).toHaveText("disabled-project");
  await expect(page.getByTestId("health-stage-policy")).toHaveAttribute(
    "data-tone",
    "error",
  );
  await expect(page.getByTestId("health-action")).toHaveText("Turn it on");
  await openHealth(page, "never");
  await expect(page.getByTestId("health-level")).toHaveText("never-loaded");
  await expect(page.getByTestId("health-stage-recorder-value")).toHaveText(
    "Never",
  );
  await expect(page.getByTestId("health-stage-uploads")).toHaveAttribute(
    "data-tone",
    "neutral",
  );
  await expect(page.getByTestId("health-refusals")).toHaveAttribute(
    "data-kind",
    "unknown",
  );
  await expect(page.getByTestId("health-meter-project-day")).toContainText(
    "Unknown",
  );
  await expect(page.getByTestId("health-capabilities")).toContainText(
    "not reported yet",
  );
  await expect(page.getByTestId("health-action")).toHaveText(
    "Open the setup guide",
  );
  await screenshot(page, "session-replay-health-never-loaded");
});

test("the health page fits a narrow viewport", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHealth(page, "refusing");
  await expect(page.getByTestId("health-pipeline")).toBeVisible();
  await expect(page.getByTestId("health-refresh")).toBeVisible();
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-health-mobile");
});

test("the users page rolls the window up by person and hands one person to the list", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(usersRoute);
  await expect(
    page.locator('[data-testid="session-user-row"]:visible').first(),
  ).toBeVisible();
  await expect(page.getByTestId("session-search-input")).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Last seen", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("session-users-pagination")).toBeVisible();
  await expect(
    page.getByTestId("session-users-pagination").locator(".."),
  ).toHaveClass(/bg-gray-50/);
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-users");
  /*
   * A visitor row: its id crosses as visitor= and the request sends it
   * back as visitorId, the one hand-off with nothing to look up on the
   * way (an identified row's parked label is swapped in as the list
   * mounts; its userKey= stays in the URL, see the list's unit tests).
   */
  await page
    .locator('[data-testid="session-user-row"][data-group-key^="v:"]')
    .first()
    .getByTestId("session-user-view-sessions")
    .click();
  await expect(page).toHaveURL(/session-replay\?(.*&)?visitor=[0-9a-f]{32}/);
  await expect(rows(page).first()).toBeVisible();
  const request: Record<string, unknown> = await lastListRequest(page);
  const filters: Record<string, unknown> = request["filters"] as Record<
    string,
    unknown
  >;
  expect(typeof filters["visitorId"]).toBe("string");
  expect(filters["identifiedUserRef"]).toBeUndefined();
  await page.getByRole("link", { name: "Replay Users", exact: true }).click();
  /* The default window crosses as absence: the bare route, no query. */
  await expect(page).toHaveURL(new RegExp(`${usersRoute}$`));
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
    .poll(async (): Promise<unknown> => {
      return (await lastListRequest(page))["filters"];
    })
    .toMatchObject({ browserNames: ["Chrome"] });
  await facet(page, "signal", "Errors");
  await expect
    .poll(async (): Promise<unknown> => {
      return (await lastListRequest(page))["filters"];
    })
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
    .poll(async (): Promise<unknown> => {
      return (await lastListRequest(page))["filters"];
    })
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
    .poll(async (): Promise<unknown> => {
      return (await lastListRequest(page))["filters"];
    })
    .toMatchObject({ countryCodes: ["GB"] });
  await facet(page, "minDurationSeconds", "At least 2 minutes");
  await expect(rows(page)).toHaveCount(1);
  await expect
    .poll(async (): Promise<unknown> => {
      return (await lastListRequest(page))["filters"];
    })
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

test("the first recording empty state keeps setup documentation on the session replay documentation page", async ({
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
  await expect(page.getByTestId("list-empty-action")).toHaveText(
    "Open the setup guide",
  );
  await page.getByTestId("list-empty-action").click();
  await expect(page).toHaveURL(documentationRoute);
  await expect(
    page.getByText("Create a telemetry ingestion key", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("session-replay-docs-reference")).toBeVisible();
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
    .poll(async (): Promise<unknown> => {
      return (await lastListRequest(page))["cursor"];
    })
    .toMatchObject({ sessionId: "00000000000000000000000000000014" });
  await page.getByRole("combobox", { name: "Sort sessions" }).click();
  await page.getByRole("option", { name: "Longest", exact: true }).click();
  await expect(rows(page)).toHaveCount(20);
  await expect
    .poll(async (): Promise<unknown> => {
      return (await lastListRequest(page))["sortBy"];
    })
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
  /*
   * The recording is introduced by a compact bar, not by the shared
   * detail Card it used to sit in: the "Session recording" title and the
   * definition list the card drew cost ~240px of the viewport that the
   * picture now has. The heading stays for screen readers and for this
   * landmark's name, and every fact it listed stays on one text-xs row.
   */
  const header: Locator = page.getByTestId("replay-header");
  await expect(header).toBeVisible();
  await expect(
    page.getByTestId("replay-player").getByTestId("card"),
  ).toHaveCount(0);
  await expect(
    header.getByRole("heading", { name: "Session recording", exact: true }),
  ).toHaveClass(/sr-only/);
  expect((await boxOf(header)).height).toBeLessThanOrEqual(120);
  await expect(page.getByTestId("replay-header-fact").first()).toBeVisible();
  await expect(page.getByTestId("replay-header-started-at")).toBeVisible();
  await expect(page.getByTestId("replay-header-clock")).toBeVisible();
  await expect(page.getByTestId("replay-header-user")).toHaveText(
    "alex@example.com",
  );
  const toolbar: Locator = page.getByRole("group", {
    name: "Session recording controls",
  });
  const recordingActions: Locator = toolbar.getByRole("group", {
    name: "Recording actions",
  });
  const playerLayout: Locator = toolbar.getByRole("group", {
    name: "Player layout",
  });

  await expect(toolbar).toBeVisible();
  await expect(recordingActions.getByRole("button")).toHaveText([
    "Pin recording",
    "Copy link",
    "Session details",
  ]);
  await expect(playerLayout.getByRole("button")).toHaveText([
    "Wide",
    "Theater",
  ]);

  const controlHeights: Array<number> = await toolbar
    .getByRole("button")
    .evaluateAll((buttons: Array<HTMLElement>): Array<number> => {
      return buttons.map((button: HTMLElement): number => {
        return button.getBoundingClientRect().height;
      });
    });

  expect(
    Math.max(...controlHeights) - Math.min(...controlHeights),
  ).toBeLessThanOrEqual(1);
  await page.getByTestId("replay-back-link").click();
  await expect(page).toHaveURL(/browser=Chrome/);
  await expect(rows(page)).toHaveCount(3);
});

test("select text mode copies recorded DOM text while keeping the replay read-only", async ({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) => {
  test.setTimeout(120000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4212",
  });
  await openPlayer(page);

  const toggle: Locator = page.getByTestId("replay-select-text");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("replay-phase")).toHaveText("paused");
  await expect(page.getByTestId("replay-overlay-paused")).toHaveCount(0);

  const frame: FrameLocator = page.frameLocator(
    '[data-testid="replay-stage"] iframe',
  );
  const body: Locator = frame.locator("body");
  await body.evaluate((element: HTMLElement): void => {
    const textarea: HTMLTextAreaElement = document.createElement("textarea");
    textarea.id = "fixture-readonly-textarea";
    textarea.style.setProperty("resize", "both", "important");
    textarea.style.setProperty("user-select", "none", "important");
    textarea.value = "Recorded note";
    element.appendChild(textarea);

    const audio: HTMLAudioElement = document.createElement("audio");
    audio.id = "fixture-readonly-audio";
    audio.controls = true;
    audio.style.setProperty("pointer-events", "auto", "important");
    element.appendChild(audio);

    const host: HTMLElement = document.createElement("div");
    host.id = "fixture-shadow-host";
    const shadowRoot: ShadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>span { user-select: none !important; }</style>
      <span id="fixture-shadow-text" style="user-select: none !important">Recorded shadow text</span>
      <input id="fixture-shadow-range" type="range" min="0" max="100" value="10" />
    `;
    element.appendChild(host);

    const scrollBox: HTMLDivElement = document.createElement("div");
    scrollBox.id = "fixture-readonly-scroll";
    scrollBox.style.cssText =
      "height:40px;overflow:auto;scroll-behavior:smooth";
    scrollBox.innerHTML = `
      <button id="fixture-scroll-start">Start</button>
      <div style="height:180px"></div>
      <button id="fixture-scroll-end">End</button>
    `;
    element.appendChild(scrollBox);
    scrollBox.scrollTop = 0;
  });

  await expect
    .poll(async (): Promise<string> => {
      return await frame
        .locator("#fixture-readonly-textarea")
        .evaluate((element: HTMLTextAreaElement): string => {
          return getComputedStyle(element).resize;
        });
    })
    .toBe("none");
  expect(
    await frame
      .locator("#fixture-readonly-audio")
      .evaluate((element: HTMLAudioElement): string => {
        return getComputedStyle(element).pointerEvents;
      }),
  ).toBe("none");

  const shadowText: Locator = frame.locator("#fixture-shadow-text");
  await expect
    .poll(async (): Promise<string> => {
      return await shadowText.evaluate((element: HTMLElement): string => {
        return getComputedStyle(element).userSelect;
      });
    })
    .toBe("text");
  const shadowRange: Locator = frame.locator("#fixture-shadow-range");
  await shadowRange.scrollIntoViewIfNeeded();
  const shadowRangeBox: Awaited<ReturnType<Locator["boundingBox"]>> =
    await shadowRange.boundingBox();
  expect(shadowRangeBox).not.toBeNull();
  await page.mouse.click(
    shadowRangeBox!.x + shadowRangeBox!.width - 2,
    shadowRangeBox!.y + shadowRangeBox!.height / 2,
  );
  await expect(shadowRange).toHaveValue("10");

  const scrollBox: Locator = frame.locator("#fixture-readonly-scroll");
  await frame.locator("#fixture-scroll-start").focus();
  await page.keyboard.press("Tab");
  await expect
    .poll(async (): Promise<number> => {
      return await scrollBox.evaluate((element: HTMLElement): number => {
        return element.scrollTop;
      });
    })
    .toBeGreaterThan(0);

  const heading: Locator = frame.getByRole("heading", {
    name: "Complete your order",
  });

  /* The fixture itself says user-select:none; the viewer must override it. */
  expect(
    await heading.evaluate((element: HTMLElement): string => {
      return getComputedStyle(element).userSelect;
    }),
  ).toBe("text");
  expect(
    await heading.evaluate((element: HTMLElement): boolean => {
      return element.hasAttribute("style");
    }),
  ).toBe(false);

  const recordedSearch: Locator = frame.locator("#fixture-recorded-search");
  await recordedSearch.focus();
  await page.keyboard.press("Escape");
  await expect(recordedSearch).toHaveValue("recorded search");

  /* Stateful controls remain inert during pointer and keyboard inspection. */
  const range: Locator = frame.locator("#fixture-readonly-range");
  await range.scrollIntoViewIfNeeded();
  const rangeBox: Awaited<ReturnType<Locator["boundingBox"]>> =
    await range.boundingBox();
  expect(rangeBox).not.toBeNull();
  await page.mouse.click(
    rangeBox!.x + rangeBox!.width - 2,
    rangeBox!.y + rangeBox!.height / 2,
  );
  await expect(range).toHaveValue("25");
  await range.focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(range).toHaveValue("25");

  /* Tab must escape the inspected control instead of being trapped. */
  await page.keyboard.press("Tab");
  await expect
    .poll(async (): Promise<string> => {
      return await range.evaluate((): string => {
        return (document.activeElement as HTMLElement | null)?.id ?? "";
      });
    })
    .toBe("place-order");

  await heading.scrollIntoViewIfNeeded();
  const box: Awaited<ReturnType<Locator["boundingBox"]>> =
    await heading.boundingBox();
  expect(box).not.toBeNull();

  await heading.click({
    clickCount: 3,
    position: { x: 10, y: box!.height / 2 },
  });

  await expect
    .poll(async (): Promise<string> => {
      return await heading.evaluate((): string => {
        return window.getSelection()?.toString() ?? "";
      });
    })
    .toContain("Complete your order");

  await page.evaluate(async (): Promise<void> => {
    await navigator.clipboard.writeText("oneuptime-copy-sentinel");
  });
  expect(
    await page.evaluate(async (): Promise<string> => {
      return await navigator.clipboard.readText();
    }),
  ).toBe("oneuptime-copy-sentinel");
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(async (): Promise<string> => {
      return await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      });
    })
    .toContain("Complete your order");

  /* Pointer access is for inspection only: recorded links cannot navigate. */
  const accountLink: Locator = frame.getByRole("link", {
    name: "View account details",
  });
  const frameUrlBeforeClick: string = await accountLink.evaluate((): string => {
    return window.location.href;
  });
  await accountLink.click();
  expect(
    await accountLink.evaluate((): string => {
      return window.location.href;
    }),
  ).toBe(frameUrlBeforeClick);

  /* Prove the copied text can leave the iframe and be pasted for debugging. */
  const railSearch: Locator = page.getByTestId("rail-search-input");
  await railSearch.focus();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(railSearch).toHaveValue(/Complete your order/);

  /* Starting playback itself exits inspection mode. */
  await page.getByTestId("replay-play-pause").click();
  await expect(page.getByTestId("replay-phase")).toHaveText("playing");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async (): Promise<string> => {
      return await page
        .locator('[data-testid="replay-stage"] iframe')
        .evaluate((iframe: HTMLIFrameElement): string => {
          return iframe.style.pointerEvents;
        });
    })
    .toBe("none");
  expect(
    await scrollBox.evaluate((element: HTMLElement): number => {
      return element.scrollTop;
    }),
  ).toBe(0);
  expect(
    await frame
      .locator("#fixture-readonly-textarea")
      .evaluate((element: HTMLTextAreaElement): Array<string> => {
        return [
          element.style.getPropertyValue("resize"),
          element.style.getPropertyPriority("resize"),
          element.style.getPropertyValue("user-select"),
          element.style.getPropertyPriority("user-select"),
        ];
      }),
  ).toEqual(["both", "important", "none", "important"]);
  expect(
    await frame
      .locator("#fixture-readonly-audio")
      .evaluate((element: HTMLAudioElement): Array<string> => {
        return [
          element.style.getPropertyValue("pointer-events"),
          element.style.getPropertyPriority("pointer-events"),
        ];
      }),
  ).toEqual(["auto", "important"]);
  expect(
    await shadowText.evaluate((element: HTMLElement): Array<string> => {
      return [
        element.style.getPropertyValue("user-select"),
        element.style.getPropertyPriority("user-select"),
      ];
    }),
  ).toEqual(["none", "important"]);
  expect(
    await heading.evaluate((element: HTMLElement): boolean => {
      return element.hasAttribute("style");
    }),
  ).toBe(false);
});

test("seeking exits selection before applying the target's recorded scroll", async ({
  page,
}: {
  page: Page;
}) => {
  test.setTimeout(120000);
  await openPlayer(page, "?t=0");

  const toggle: Locator = page.getByTestId("replay-select-text");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("replay-phase")).toHaveText("paused");

  const frame: FrameLocator = page.frameLocator(
    '[data-testid="replay-stage"] iframe',
  );
  const recordedScroll: Locator = frame.locator("#fixture-recorded-scroll");
  await expect
    .poll(async (): Promise<number> => {
      return await recordedScroll.evaluate((element: HTMLElement): number => {
        return element.scrollTop;
      });
    })
    .toBe(0);
  await recordedScroll.evaluate((element: HTMLElement): void => {
    element.scrollTop = 35;
  });
  await expect
    .poll(async (): Promise<number> => {
      return await recordedScroll.evaluate((element: HTMLElement): number => {
        return element.scrollTop;
      });
    })
    .toBe(35);

  await page.getByTestId("replay-seek-forward").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("replay-phase")).toHaveText("paused");
  await expect
    .poll(async (): Promise<number> => {
      return await recordedScroll.evaluate((element: HTMLElement): number => {
        return element.scrollTop;
      });
    })
    .toBe(120);
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
    .poll(async (): Promise<number> => {
      return clockSeconds(await page.getByTestId("replay-time").innerText());
    })
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

test("plays a React Native view tree while keeping text, images and webviews private", async ({
  page,
}: {
  page: Page;
}) => {
  await openMobilePlayer(page);
  const replayFrame: FrameLocator = page.frameLocator(
    '[data-testid="replay-stage"] iframe',
  );
  await expect(
    replayFrame.locator('[data-oneuptime-mobile-view="image"]'),
  ).toBeVisible();
  await expect(
    replayFrame.locator('[data-oneuptime-mobile-view="webview"]'),
  ).toBeVisible();
  await expect(
    replayFrame.locator('[data-oneuptime-mobile-view="masked"]'),
  ).toBeVisible();
  const replayedText: string = await replayFrame.locator("body").innerText();
  expect(replayedText).toContain("•••");
  expect(replayedText).not.toContain("Place order");
  expect(replayedText).not.toContain("alex@example.com");
  await expect(page.getByTestId("replay-time")).toBeVisible();
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-react-native-player");
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
  const detailsDialog: Locator = page.getByRole("dialog", {
    name: "Session details",
  });
  await expect(detailsDialog).toBeVisible();
  await expect(
    detailsDialog.getByRole("tab", { name: "Session" }),
  ).toBeFocused();
  await expect(
    detailsDialog.getByRole("heading", { name: "Journey", exact: true }),
  ).toBeVisible();
  await expect(
    detailsDialog.getByRole("heading", {
      name: "Related telemetry",
      exact: true,
    }),
  ).toBeVisible();

  const dialogBounds: Awaited<ReturnType<Locator["boundingBox"]>> =
    await detailsDialog.boundingBox();
  const sectionBounds: Array<Awaited<ReturnType<Locator["boundingBox"]>>> =
    await Promise.all(
      [
        "details-section-session",
        "details-section-journey",
        "details-section-environment",
        "details-section-telemetry",
      ].map((testId: string) => {
        return page.getByTestId(testId).boundingBox();
      }),
    );

  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds!.width).toBeGreaterThanOrEqual(600);
  expect(dialogBounds!.width).toBeLessThanOrEqual(610);
  expect(sectionBounds.every(Boolean)).toBe(true);

  for (let index: number = 0; index < sectionBounds.length; index++) {
    expect(sectionBounds[index]!.x).toBeCloseTo(sectionBounds[0]!.x, 0);
    expect(sectionBounds[index]!.width).toBeCloseTo(sectionBounds[0]!.width, 0);

    if (index > 0) {
      expect(sectionBounds[index]!.y).toBeGreaterThan(
        sectionBounds[index - 1]!.y + sectionBounds[index - 1]!.height,
      );
    }
  }

  const railCardBounds: Array<Awaited<ReturnType<Locator["boundingBox"]>>> =
    await Promise.all(
      ["traces", "errors", "logs"].map((railTab: string) => {
        return page.getByTestId(`details-rail-${railTab}`).boundingBox();
      }),
    );

  expect(railCardBounds.every(Boolean)).toBe(true);
  expect(railCardBounds[1]!.y).toBeCloseTo(railCardBounds[0]!.y, 0);
  expect(railCardBounds[2]!.y).toBeCloseTo(railCardBounds[0]!.y, 0);
  await detailsDialog.getByRole("tab", { name: "Privacy" }).click();
  await expect(
    page.getByTestId("details-section-capture-policy"),
  ).toBeVisible();
  await detailsDialog.getByRole("tab", { name: /Fidelity/ }).click();
  await expect(
    page.getByTestId("details-section-recording-status"),
  ).toBeVisible();
  await detailsDialog.getByRole("tab", { name: "Session" }).click();
  await screenshot(page, "session-replay-details");
  await page.getByTestId("details-open-rail-logs").click();
  await expect(detailsDialog).toHaveCount(0);
  await expect(page.getByTestId("rail-tab-logs")).toHaveAttribute(
    "aria-selected",
    "true",
  );
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
  /*
   * Three tabs of a finished recording: every tab is closed, so the strip
   * keeps the opened order and shows them all - the picker only appears
   * past six (see the ?tabs=many tests).
   */
  await expect(page.getByTestId("replay-tab-summary")).toHaveText("3 tabs");
  await expect(page.getByTestId("replay-tab-picker-button")).toHaveCount(0);
  expect(
    await tabs.evaluateAll((pills: Array<HTMLElement>): Array<string> => {
      return pills.map((pill: HTMLElement): string => {
        return pill.dataset["tabStatus"] ?? "";
      });
    }),
  ).toEqual(["closed", "closed", "empty"]);
  /* A pill names its page now, not just its number and length. */
  await expect(tabs.first()).toContainText("Tab 1");
  await expect(tabs.first()).toContainText("/checkout");
  await expect(tabs.nth(2)).toContainText("no footage");
  await expect(tabs.first()).toHaveAttribute(
    "title",
    /switch to this tab; the playhead stays where it is/,
  );
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
  /* Arrowing the strip switches tab; the pills say which one is watched. */
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "false");
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
  const headerToolbar: Locator = page.getByTestId("replay-header-toolbar");

  await expect(headerToolbar).toBeVisible();
  await expect(page.getByTestId("replay-pin-button")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });

  const headerGeometry: {
    viewportWidth: number;
    scrollWidth: number;
    clientWidth: number;
    childBounds: Array<{ left: number; right: number }>;
  } = await headerToolbar.evaluate(
    (
      toolbar: HTMLElement,
    ): {
      viewportWidth: number;
      scrollWidth: number;
      clientWidth: number;
      childBounds: Array<{ left: number; right: number }>;
    } => {
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: toolbar.scrollWidth,
        clientWidth: toolbar.clientWidth,
        childBounds: Array.from(
          toolbar.querySelectorAll("button, [role='group']"),
        ).map((element: Element): { left: number; right: number } => {
          const bounds: DOMRect = element.getBoundingClientRect();

          return { left: bounds.left, right: bounds.right };
        }),
      };
    },
  );

  expect(headerGeometry.scrollWidth).toBeLessThanOrEqual(
    headerGeometry.clientWidth + 1,
  );
  headerGeometry.childBounds.forEach(
    (bounds: { left: number; right: number }): void => {
      expect(bounds.left).toBeGreaterThanOrEqual(-1);
      expect(bounds.right).toBeLessThanOrEqual(
        headerGeometry.viewportWidth + 1,
      );
    },
  );
  await noHorizontalOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page
    .getByRole("button", { name: "Session details", exact: true })
    .click();
  const detailsDialog: Locator = page.getByRole("dialog", {
    name: "Session details",
  });
  await expect(detailsDialog).toBeVisible();
  const dialogBounds: Awaited<ReturnType<Locator["boundingBox"]>> =
    await detailsDialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(390);
  expect(dialogBounds!.width).toBeGreaterThanOrEqual(360);
  expect(dialogBounds!.width).toBeLessThanOrEqual(372);
  await expect(page.getByTestId("details-section-session")).toBeVisible();

  const browserTileBounds: Awaited<ReturnType<Locator["boundingBox"]>> =
    await page.getByTestId("replay-details-browser").boundingBox();
  const osTileBounds: Awaited<ReturnType<Locator["boundingBox"]>> = await page
    .getByTestId("replay-details-os")
    .boundingBox();

  expect(browserTileBounds).not.toBeNull();
  expect(osTileBounds).not.toBeNull();
  expect(osTileBounds!.y).toBeGreaterThan(
    browserTileBounds!.y + browserTileBounds!.height,
  );
  expect(osTileBounds!.width).toBeCloseTo(browserTileBounds!.width, 0);
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-details-mobile");

  await page.evaluate((): void => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  const exitUrl: Locator = page.getByTestId("replay-details-exit-url");
  await exitUrl
    .getByRole("button", { name: "Copy Exit URL", exact: true })
    .click();
  const manualCopyInput: Locator = exitUrl.getByRole("textbox", {
    name: "Manual copy Exit URL",
    exact: true,
  });
  await expect(manualCopyInput).toBeVisible();
  await expect(manualCopyInput).toBeFocused();
  expect(
    await manualCopyInput.evaluate((input: HTMLInputElement): boolean => {
      const rect: DOMRect = input.getBoundingClientRect();
      const hit: Element | null = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );

      return hit === input || input.contains(hit);
    }),
  ).toBe(true);
  await exitUrl.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(
    exitUrl.getByRole("button", { name: "Copy Exit URL", exact: true }),
  ).toBeFocused();
});

test("the recording fills a laptop viewport with the transport above the fold", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);

  const stage: ElementBox = await boxOf(page.getByTestId("replay-stage"));
  const frame: ElementBox = await boxOf(page.getByTestId("replay-stage-frame"));
  const controls: ElementBox = await boxOf(
    page.getByTestId("replay-play-pause"),
  );

  /*
   * The number this redesign exists for. A 1200x760 recording was drawn
   * at 34% on a 1440x900 laptop, because a summary card, a URL bar, five
   * marker lanes and two rows of transport took the height first. The
   * player is now sized to the viewport and the picture takes what is
   * left, which has to be at least 55%.
   */
  expect(await stageScalePercent(page)).toBeGreaterThanOrEqual(55);
  expect(frame.width / recordedWidth).toBeGreaterThanOrEqual(0.55);
  expect(frame.height / recordedHeight).toBeGreaterThanOrEqual(0.55);
  /* The drawn picture and the reported scale are the same measurement. */
  expect(frame.width / recordedWidth).toBeCloseTo(
    (await stageScalePercent(page)) / 100,
    1,
  );
  expect(stage.height).toBeGreaterThanOrEqual(380);
  /* Nothing of the picture hangs below the window, and it fits the box. */
  expect(stage.y + stage.height).toBeLessThanOrEqual(901);
  expect(frame.height).toBeLessThanOrEqual(stage.height + 1);

  expect(controls.y).toBeGreaterThan(0);
  expect(controls.y + controls.height).toBeLessThanOrEqual(900);
  expect(
    await page.evaluate((): number => {
      return window.scrollY;
    }),
  ).toBe(0);
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-player-laptop");
});

test("the recording grows with the viewport and refits without a reload", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);

  const laptopPercent: number = await stageScalePercent(page);
  const laptopFrame: ElementBox = await boxOf(
    page.getByTestId("replay-stage-frame"),
  );
  const navigations: number = (await state(page)).requests.filter(
    (request: FixtureRequest): boolean => {
      return request.route === "manifest";
    },
  ).length;

  /* A bigger window is a bigger picture, measured live - no reload. */
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect
    .poll(async (): Promise<number> => {
      return (await boxOf(page.getByTestId("replay-stage-frame"))).width;
    })
    .toBeGreaterThan(laptopFrame.width + 20);
  expect(await stageScalePercent(page)).toBeGreaterThan(laptopPercent);
  expect(
    (await boxOf(page.getByTestId("replay-stage"))).height,
  ).toBeGreaterThan(380);

  /* And back down: the stage shrinks to the window instead of scrolling it. */
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(async (): Promise<number> => {
      return (await boxOf(page.getByTestId("replay-stage-frame"))).width;
    })
    .toBeLessThan(laptopFrame.width);
  const smallStage: ElementBox = await boxOf(page.getByTestId("replay-stage"));
  expect(smallStage.y + smallStage.height).toBeLessThanOrEqual(721);
  expect(
    await page.evaluate((): number => {
      return window.scrollY;
    }),
  ).toBe(0);
  await noHorizontalOverflow(page);

  /* The refit is layout, not a fresh manifest fetch. */
  expect(
    (await state(page)).requests.filter((request: FixtureRequest): boolean => {
      return request.route === "manifest";
    }).length,
  ).toBe(navigations);
});

test("the stage fit control switches between fit, width and actual size", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);

  const stage: Locator = page.getByTestId("replay-stage");
  const fit: Locator = page.getByTestId("replay-fit-toggle");
  const chip: Locator = page.getByTestId("replay-viewport-chip");

  await expect(fit.getByRole("button")).toHaveText(["Fit", "Width", "1:1"]);
  await expect(stage).toHaveAttribute("data-replay-fit", "contain");
  await expect(chip).toContainText(`${recordedWidth}x${recordedHeight}`);

  const containPercent: number = await stageScalePercent(page);

  /* Width fills the box across and scrolls the rest of the page. */
  await fit.getByRole("button", { name: "Width", exact: true }).click();
  await expect(stage).toHaveAttribute("data-replay-fit", "width");
  expect(await stageScalePercent(page)).toBeGreaterThanOrEqual(containPercent);

  const stageBox: ElementBox = await boxOf(stage);
  const widthFrame: ElementBox = await boxOf(
    page.getByTestId("replay-stage-frame"),
  );

  expect(widthFrame.width).toBeGreaterThan(stageBox.width - 20);
  expect(
    await stage.evaluate((element: HTMLElement): number => {
      return element.scrollHeight - element.clientHeight;
    }),
  ).toBeGreaterThan(0);

  /* 1:1 is 100% by definition, so the chip drops the percentage. */
  await fit.getByRole("button", { name: "1:1", exact: true }).click();
  await expect(stage).toHaveAttribute("data-replay-fit", "actual");
  await expect(chip).toContainText(`${recordedWidth}x${recordedHeight}`);
  await expect(chip).not.toContainText("%");

  const actualFrame: ElementBox = await boxOf(
    page.getByTestId("replay-stage-frame"),
  );

  expect(Math.round(actualFrame.width)).toBe(recordedWidth);
  expect(Math.round(actualFrame.height)).toBe(recordedHeight);

  await fit.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(stage).toHaveAttribute("data-replay-fit", "contain");
  expect(await stageScalePercent(page)).toBe(containPercent);
  await noHorizontalOverflow(page);
});

test("keyboard shortcuts hide the events rail and cycle the stage fit", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);

  const rail: Locator = page.getByTestId("replay-rail");
  const stage: Locator = page.getByTestId("replay-stage");

  await expect(rail).toBeVisible();

  const withRail: ElementBox = await boxOf(stage);

  /* r: the rail's width goes to the picture, and comes back. */
  await page.keyboard.press("r");
  await expect(rail).not.toBeVisible();
  await expect(page.getByTestId("replay-rail-expand")).toBeVisible();
  await expect
    .poll(async (): Promise<number> => {
      return (await boxOf(stage)).width;
    })
    .toBeGreaterThan(withRail.width);
  await page.keyboard.press("r");
  await expect(rail).toBeVisible();

  /* z: contain -> width -> actual -> contain. */
  await expect(stage).toHaveAttribute("data-replay-fit", "contain");
  await page.keyboard.press("z");
  await expect(stage).toHaveAttribute("data-replay-fit", "width");
  await page.keyboard.press("z");
  await expect(stage).toHaveAttribute("data-replay-fit", "actual");
  await page.keyboard.press("z");
  await expect(stage).toHaveAttribute("data-replay-fit", "contain");
});

test("hiding the signal lanes gives their height back to the recording", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);

  const lanes: Locator = page.locator('[data-testid^="timeline-lane-"]');
  const stage: Locator = page.getByTestId("replay-stage");

  expect(await lanes.count()).toBeGreaterThan(0);
  await expect(page.getByTestId("timeline-legend")).toBeVisible();

  const withLanes: ElementBox = await boxOf(stage);

  await page.getByTestId("replay-more-menu").click();
  await page.getByRole("menuitem", { name: "Hide signal lanes" }).click();
  await expect(lanes).toHaveCount(0);
  await expect(page.getByTestId("timeline-legend")).toHaveCount(0);
  /* The track itself stays, and so do the notices drawn on it. */
  await expect(page.getByTestId("timeline-track")).toBeVisible();
  await expect
    .poll(async (): Promise<number> => {
      return (await boxOf(stage)).height;
    })
    .toBeGreaterThan(withLanes.height);

  await page.getByTestId("replay-more-menu").click();
  await page.getByRole("menuitem", { name: "Show signal lanes" }).click();
  await expect(page.getByTestId("timeline-legend")).toBeVisible();
  expect(await lanes.count()).toBeGreaterThan(0);
});

test("the overflow menu stays reachable inside theater mode", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);

  /*
   * Theater is the case that made this a bug rather than a nicety: the
   * fullscreen root clips what is drawn past it, the transport is the last
   * row inside it, and a menu opening downwards from there landed outside
   * the player with no way to scroll to it - "Hide mouse trail", "Follow
   * the playhead" and "Hide signal lanes" were simply gone. Clicking the
   * real button is what makes requestFullscreen a trusted gesture.
   */
  await page.getByTestId("replay-toggle-theater").click();
  await expect
    .poll(async (): Promise<boolean> => {
      return page.evaluate((): boolean => {
        const root: Element | null = document.querySelector(
          '[data-testid="replay-player"]',
        );

        return Boolean(root) && document.fullscreenElement === root;
      });
    })
    .toBe(true);

  await page.getByTestId("replay-more-menu").click();

  const menu: Locator = page.getByRole("menu");

  await expect(menu).toBeVisible();

  const menuBox: ElementBox = await boxOf(menu);
  const rootBox: ElementBox = await boxOf(page.getByTestId("replay-player"));

  /* Drawn upwards, and wholly inside the surface that clips it. */
  expect(menuBox.y).toBeGreaterThanOrEqual(rootBox.y - 1);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(
    rootBox.y + rootBox.height + 1,
  );

  /* And every item is the topmost element at its own centre. */
  const items: Locator = page.getByRole("menuitem");
  const itemCount: number = await items.count();

  expect(itemCount).toBeGreaterThan(0);

  for (let index: number = 0; index < itemCount; index++) {
    const box: ElementBox = await boxOf(items.nth(index));
    const isHittable: boolean = await page.evaluate(
      (point: { x: number; y: number }): boolean => {
        const hit: Element | null = document.elementFromPoint(point.x, point.y);
        const menuElement: Element | null =
          document.querySelector('[role="menu"]');

        return Boolean(hit && menuElement && menuElement.contains(hit));
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );

    expect(isHittable).toBe(true);
  }

  /* It still works from in there: the lanes toggle is one of those items. */
  await page.getByRole("menuitem", { name: "Hide signal lanes" }).click();
  await expect(page.locator('[data-testid^="timeline-lane-"]')).toHaveCount(0);

  await page.keyboard.press("Escape");
  await page.getByTestId("replay-more-menu").click();
  await page.getByRole("menuitem", { name: "Show signal lanes" }).click();
  await expect(page.getByTestId("timeline-legend")).toBeVisible();
});

test("the ended recording offers the next session by the same user", async ({
  page,
}: {
  page: Page;
}) => {
  /* Two seconds before the end, so the ended card is reached by playing. */
  await page.goto(`${playerRoute}?neighbour=newer&t=88`);
  await expect(page.getByTestId("replay-phase")).toHaveText("ended", {
    timeout: 30000,
  });

  const nextSession: Locator = page.getByTestId("replay-ended-next-session");

  await expect(page.getByTestId("replay-watch-again")).toBeVisible();
  await expect(nextSession).toBeVisible();
  await expect(nextSession).toHaveText("Next session by this user");
  /* The button names the session it opens, the way the sessions menu does. */
  await expect(nextSession).toHaveAttribute("title", /·/);
  await screenshot(page, "session-replay-player-ended");
  await nextSession.click();
  await expect(page).toHaveURL(new RegExp(`session-replay/${"f".repeat(32)}`));

  /*
   * And the player actually follows, in the same page load. Every route
   * element under the application layout is created once, so React sees
   * the same element object when only the :subModelId segment changes and
   * bails out of the subtree: the view reads its ids from the router's
   * location precisely so this navigation re-renders it. Before that, the
   * address bar changed while the mounted player carried on polling the
   * session it was already playing - which is the one thing this button
   * must not do.
   */
  await expect(page.getByTestId("replay-phase")).toHaveText("playing", {
    timeout: 30000,
  });
  await expect(page.getByTestId("replay-header")).toContainText("ffffffff");
  await expect(page.getByTestId("replay-header")).not.toContainText("aaaaaaaa");

  /* No reload: proving it was the SPA that switched, not the browser. */
  const navigations: number = await page.evaluate((): number => {
    return performance.getEntriesByType("navigation").length;
  });

  expect(navigations).toBe(1);
});

test("the header's older and newer buttons switch the mounted player", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page, "?neighbour=newer");

  /*
   * The same re-render path as the ended card, from the control a viewer
   * reaches while a recording is still playing.
   */
  await page.getByTestId("replay-user-session-newer").click();
  await expect(page).toHaveURL(new RegExp(`session-replay/${"f".repeat(32)}`));
  await expect(page.getByTestId("replay-phase")).toHaveText("playing", {
    timeout: 30000,
  });
  await expect(page.getByTestId("replay-header")).toContainText("ffffffff");

  const navigations: number = await page.evaluate((): number => {
    return performance.getEntriesByType("navigation").length;
  });

  expect(navigations).toBe(1);
});

test("the tab strip leads with the tabs that are still open", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page, "?tabs=many");

  await expect(page.getByTestId("replay-tab-switcher")).toBeVisible();
  await expect(page.getByTestId("replay-tab-summary")).toHaveText(
    "8 tabs · 2 open · 5 closed · 1 without footage",
  );

  const pills: Locator = page.getByTestId("replay-tab-pill");
  const statuses: Array<string> = await pills.evaluateAll(
    (elements: Array<HTMLElement>): Array<string> => {
      return elements.map((element: HTMLElement): string => {
        return element.dataset["tabStatus"] ?? "";
      });
    },
  );

  /*
   * Eight tabs, at most six pills: the strip shows the tabs still
   * recording plus the one being watched, and the rest live in the
   * picker. Open comes before closed - a tab that is still going is the
   * one a viewer can still catch up with.
   */
  expect(statuses.length).toBeLessThanOrEqual(6);
  expect(statuses).toEqual(["open", "open", "closed"]);
  await expect(page.getByTestId("replay-tab-strip-divider")).toHaveText(
    "Closed",
  );

  /* Each pill says which page its tab was on. */
  await expect(tabPill(page, 3)).toContainText("/cart");
  await expect(tabPill(page, 6)).toContainText("/search");
  await expect(tabPill(page, 1)).toContainText("/collections");
  await expect(tabPill(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(tabPill(page, 3)).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("replay-tab-picker-button")).toContainText(
    "All 8 tabs",
  );
  await noHorizontalOverflow(page);
  await screenshot(page, "session-replay-player-tabs");
});

test("the tab picker groups every tab and searches them by page and number", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page, "?tabs=many");
  await openTabPicker(page);

  await expect(page.getByTestId("replay-tab-group")).toHaveText([
    "Open · 2",
    "Closed · 5",
    "No footage · 1",
  ]);
  await expect(page.getByTestId("replay-tab-option")).toHaveCount(8);
  /* A tab that stored nothing is listed, and cannot be opened. */
  await expect(tabOption(page, 8)).toBeDisabled();
  await expect(tabOption(page, 8)).toContainText("no footage");
  /* What happened in a tab is on its row, with where it sits in the session. */
  await expect(
    tabOption(page, 4).getByTestId("replay-tab-option-errors"),
  ).toHaveText("2");
  await expect(
    tabOption(page, 7).getByTestId("replay-tab-option-frustrations"),
  ).toHaveText("1");
  await expect(tabOption(page, 1)).toContainText("Watching");
  await expect(
    page.getByTestId("replay-tab-option-span").first(),
  ).toBeVisible();
  await screenshot(page, "session-replay-player-tab-picker");

  const search: Locator = page.getByTestId("replay-tab-picker-search");

  /* By page. */
  await search.fill("account");
  await expect(page.getByTestId("replay-tab-option")).toHaveCount(1);
  await expect(tabOption(page, 5)).toBeVisible();

  /* By tab number. */
  await search.fill("7");
  await expect(page.getByTestId("replay-tab-option")).toHaveCount(1);
  await expect(tabOption(page, 7)).toBeVisible();

  /* And a miss says so rather than showing an empty box. */
  await search.fill("nowhere");
  await expect(page.getByTestId("replay-tab-option")).toHaveCount(0);
  await expect(page.getByTestId("replay-tab-picker-empty")).toContainText(
    "No tab matches",
  );
  await expect(page.getByTestId("replay-tab-picker-empty")).toContainText(
    "nowhere",
  );
});

/*
 * The picker's span bars are the only thing that answers "which tab was
 * open when the error happened" - with a dozen tabs the list is a timeline
 * read downwards, and a position is what the viewer is looking for.
 *
 * They only answer it if they are drawn against the SESSION. The player's
 * clock follows the engine, so its duration is the footage of the tab
 * being WATCHED; the header used to hand that down, and every tab was
 * scaled by one tab's length. In this eight-tab fixture the result was the
 * first three bars at left 0% / width 100% and every later tab pinned at
 * left 98% - eight rows that all said the same nothing.
 *
 * ?tabs=many is a 90s recording in three 30s windows: tab 1 covers the
 * first, tab 4 the second, tab 6 the third, and tabs 2, 3 and 5 span more
 * than one. So the bars have to walk left to right down the list.
 */
test("the tab picker draws each tab's span where it sits in the session", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page, "?tabs=many");
  await openTabPicker(page);

  const spanOf: (
    position: number,
  ) => Promise<{ left: number; width: number }> = async (
    position: number,
  ): Promise<{ left: number; width: number }> => {
    return await tabOption(page, position)
      .getByTestId("replay-tab-option-span")
      .evaluate((element: HTMLElement): { left: number; width: number } => {
        return {
          left: Number.parseFloat(element.style.left),
          width: Number.parseFloat(element.style.width),
        };
      });
  };

  const third: number = 100 / 3;
  const spans: Array<{ left: number; width: number }> = [];

  for (let position: number = 1; position <= 7; position++) {
    spans.push(await spanOf(position));
  }

  /* Thirds of the session, which is where these tabs actually are. */
  expect(spans[0]?.left).toBeCloseTo(0, 1);
  expect(spans[0]?.width).toBeCloseTo(third, 1);
  expect(spans[1]?.left).toBeCloseTo(0, 1);
  expect(spans[1]?.width).toBeCloseTo(third * 2, 1);
  expect(spans[2]?.left).toBeCloseTo(0, 1);
  expect(spans[2]?.width).toBeCloseTo(100, 1);
  expect(spans[3]?.left).toBeCloseTo(third, 1);
  expect(spans[3]?.width).toBeCloseTo(third, 1);
  expect(spans[4]?.left).toBeCloseTo(third, 1);
  expect(spans[4]?.width).toBeCloseTo(third * 2, 1);
  expect(spans[5]?.left).toBeCloseTo(third * 2, 1);
  expect(spans[6]?.left).toBeCloseTo(third * 2, 1);

  /* Ordered and distinct: a later tab sits further right than an earlier one. */
  expect(spans[0]!.left).toBeLessThan(spans[3]!.left);
  expect(spans[3]!.left).toBeLessThan(spans[5]!.left);
  expect(spans[0]!.width).toBeLessThan(spans[1]!.width);
  expect(spans[1]!.width).toBeLessThan(spans[2]!.width);

  /* The broken layout, named so a regression says which bug came back. */
  for (const span of spans) {
    expect(span.left).toBeLessThan(90);
    expect(span.left + span.width).toBeLessThanOrEqual(100.5);
  }
  expect(spans[0]!.width).toBeLessThan(90);

  /* The tab that stored nothing has no place on the clock, and no bar. */
  await expect(
    tabOption(page, 8).getByTestId("replay-tab-option-span"),
  ).toHaveCount(0);
});

test("the tab picker switches tab by keyboard without firing player shortcuts", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page, "?tabs=many");
  await page.getByTestId("replay-play-pause").click();
  await expect(page.getByTestId("replay-phase")).toHaveText("paused");

  const clockBefore: string = await page.getByTestId("replay-time").innerText();
  const skipIdleBefore: string | null = await page
    .getByTestId("replay-skip-idle")
    .getAttribute("aria-checked");

  await openTabPicker(page);

  /*
   * Typed, not filled: every letter of "search" is a player shortcut -
   * s jumps the idle band, e the next error, r hides the rail, c copies
   * the link - and none of them may fire while a filter box has focus.
   */
  await page
    .getByTestId("replay-tab-picker-search")
    .pressSequentially("search");
  await expect(page.getByTestId("replay-tab-option")).toHaveCount(1);
  await expect(tabOption(page, 6)).toBeVisible();
  await expect(page.getByTestId("replay-phase")).toHaveText("paused");
  await expect(page.getByTestId("replay-time")).toHaveText(clockBefore);
  await expect(page.getByTestId("replay-skip-idle")).toHaveAttribute(
    "aria-checked",
    skipIdleBefore ?? "false",
  );
  await expect(page.getByTestId("replay-rail")).toBeVisible();

  /* Arrow into the list, step to the second open tab, take it. */
  await page.getByTestId("replay-tab-picker-search").fill("");
  await page.keyboard.press("ArrowDown");
  await expect(tabOption(page, 3)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tabOption(page, 6)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("replay-tab-picker")).toHaveCount(0);
  await expect(page.getByTestId("replay-tab-picker-button")).toBeFocused();
  /* The player really switched: the pill and the URL both say so. */
  await expect(tabPill(page, 6)).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(new RegExp(`tab=${manyTabId(6)}`));

  /* Escape closes the picker and hands focus back to its button. */
  await openTabPicker(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("replay-tab-picker")).toHaveCount(0);
  await expect(page.getByTestId("replay-tab-picker-button")).toBeFocused();
  await expect(page.getByTestId("replay-phase")).toHaveText("paused");
});

test("the tab switcher fits a narrow viewport", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlayer(page, "?tabs=many");
  await expect(page.getByTestId("replay-tab-switcher")).toBeVisible();
  await noHorizontalOverflow(page);

  /* The strip wraps; it never scrolls sideways and never leaves the page. */
  const rights: Array<number> = await page
    .getByTestId("replay-tab-pill")
    .evaluateAll((pills: Array<HTMLElement>): Array<number> => {
      return pills.map((pill: HTMLElement): number => {
        return pill.getBoundingClientRect().right;
      });
    });

  expect(rights.length).toBeGreaterThan(0);
  rights.forEach((right: number): void => {
    expect(right).toBeLessThanOrEqual(391);
  });

  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByTestId("replay-tab-switcher")).toBeVisible();
  await noHorizontalOverflow(page);
  await openTabPicker(page);

  const picker: ElementBox = await boxOf(page.getByTestId("replay-tab-picker"));

  expect(picker.x).toBeGreaterThanOrEqual(-1);
  expect(picker.x + picker.width).toBeLessThanOrEqual(321);
  await expect(page.getByTestId("replay-tab-option")).toHaveCount(8);
  await screenshot(page, "session-replay-player-tabs-mobile");
});
