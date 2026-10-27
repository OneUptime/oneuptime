import { expect, Locator, Page, Route, test, TestInfo } from "@playwright/test";

/*
 * Dashboard playlists (issue #5235) in a real browser: Dashboards ->
 * Playlists, a playlist's page and the player, through the real Dashboards
 * routes with only the data boundary answered from fixture data
 * (DashboardPlaylists/Fixture). See README.md.
 *
 * The customer's ask: a NOC screen that shows several dashboards one after
 * another, each for a set time, with play, pause, next and previous, full
 * screen. So:
 *
 *   - the player shows the playlist's dashboards in order, each for its
 *     time, round and round, the next one drawn out of sight ahead of its
 *     turn and kept - not drawn again - when the turn comes;
 *   - Pause stops the turn where it is, and Play goes on from there; Next
 *     and Previous, by button and by arrow key (swapped right to left);
 *   - each dashboard opens on its own saved time range, whatever the
 *     address or the viewer's own picks say;
 *   - a dashboard the viewer cannot see, or one that is archived, is
 *     skipped; a change to the playlist is picked up at the end of a round;
 *     a playlist with nothing to show, or gone, says so;
 *   - a playlist is created, changed and deleted from its pages, and a
 *     Viewer plays playlists but changes none;
 *   - German, Japanese, Persian (right to left), the dark theme, and a
 *     phone's width.
 *
 * Screenshots are saved for review under
 * output/playwright/dashboard-playlists-ui.
 */

interface FixtureRecord {
  dashboardReads: Array<{ id: string; at: number }>;
  playlistReads: Array<{ id: string; at: number }>;
  dashboardLists: Array<{ ids: Array<string> | null; at: number }>;
  aggregates: Array<{
    metricName: string;
    start: number | null;
    end: number | null;
    at: number;
  }>;
  creates: Array<Record<string, unknown>>;
  edits: Array<{ id: string; data: Record<string, unknown> }>;
  deletes: Array<string>;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __dashboardPlaylistsFixture?:
      | {
          record: FixtureRecord;
          setPlaylist: (
            key: string,
            dashboardKeys: Array<string>,
            intervalInSeconds?: number,
          ) => void;
          deletePlaylist: (key: string) => void;
        }
      | undefined;
  }
}

const PORT: string = process.env["DASHBOARD_PLAYLISTS_FIXTURE_PORT"] || "4535";

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000e1";
const DASHBOARDS_PATH: string = `/dashboard/${PROJECT_ID}/dashboards`;
const LIST_PATH: string = `${DASHBOARDS_PATH}/playlists`;

const SCREENSHOTS: string = "../../output/playwright/dashboard-playlists-ui";

const dashboardId: (value: number) => string = (value: number): string => {
  return `db000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

const playlistId: (value: number) => string = (value: number): string => {
  return `91000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

// Fixture/Boards.js.
const OVERVIEW: { id: string; name: string } = {
  id: dashboardId(1),
  name: "Production overview",
};
const CLUSTERS: { id: string; name: string } = {
  id: dashboardId(2),
  name: "Kubernetes clusters",
};
const DATABASES: { id: string; name: string } = {
  id: dashboardId(3),
  name: "Databases",
};
const ARCHIVED_ID: string = dashboardId(4);
const PRIVATE_ID: string = dashboardId(5);
const DELETED_ID: string = dashboardId(6);

const WALL: string = playlistId(1);
const NIGHT_SHIFT: string = playlistId(2);
const LOBBY: string = playlistId(3);
const DRAFT: string = playlistId(4);
const RETIRED: string = playlistId(5);
const REPEAT: string = playlistId(6);
const MISSING: string = playlistId(99);

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const T0: Date = new Date("2026-10-27T10:00:00Z");

const playlistPath: (id: string) => string = (id: string): string => {
  return `${LIST_PATH}/${id}`;
};

const playPath: (id: string) => string = (id: string): string => {
  return `${LIST_PATH}/${id}/play`;
};

// ---- reading the page --------------------------------------------------------

const record: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    return JSON.parse(
      JSON.stringify(window.__dashboardPlaylistsFixture!.record),
    ) as FixtureRecord;
  });
};

const player: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("playlist-player");
};

const onScreen: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("playlist-player-on-screen");
};

const upNextBoard: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("playlist-player-up-next-board");
};

const barTitle: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("playlist-player-dashboard-name");
};

const position: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("playlist-player-position");
};

const dialog: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("modal");
};

// Dashboards' side menu's Playlists - not the breadcrumbs' link of that name.
const sideMenuPlaylists: (page: Page) => Locator = (page: Page): Locator => {
  return page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Playlists", exact: true });
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

  await page.screenshot({ path: file });
};

// How many times the dashboard was read, for the board drawn ahead.
const readsOf: (page: Page, id: string) => Promise<number> = async (
  page: Page,
  id: string,
): Promise<number> => {
  return (await record(page)).dashboardReads.filter(
    (read: { id: string }): boolean => {
      return read.id === id;
    },
  ).length;
};

/*
 * The player at a playlist's address, with the page's clock in the test's
 * hands: time runs on by itself, and a turn's end is reached by jumping
 * ahead (page.clock.fastForward) rather than by waiting a minute.
 */
const openPlayer: (
  page: Page,
  id: string,
  query?: string,
) => Promise<void> = async (
  page: Page,
  id: string,
  query: string = "",
): Promise<void> => {
  await page.clock.install({ time: T0 });
  await page.goto(`${playPath(id)}${query}`);
  await expect(player(page)).toBeVisible();
};

// The dashboard on screen, named in the bar and drawn on the stage.
const expectOnScreen: (
  page: Page,
  dashboard: { id: string; name: string },
) => Promise<void> = async (
  page: Page,
  dashboard: { id: string; name: string },
): Promise<void> => {
  await expect(barTitle(page)).toHaveText(dashboard.name);
  await expect(onScreen(page)).toHaveAttribute(
    "data-dashboard-id",
    dashboard.id,
  );
  // The board itself, its title widget saying the dashboard's name.
  await expect(
    onScreen(page).getByText(dashboard.name, { exact: true }).first(),
  ).toBeVisible();
};

// The page's address is `path`, with no query or fragment left over.
const expectPath: (page: Page, path: string) => Promise<void> = async (
  page: Page,
  path: string,
): Promise<void> => {
  await expect
    .poll((): string => {
      const url: URL = new URL(page.url());
      return `${url.pathname}${url.search}${url.hash}`;
    })
    .toBe(path);
};

const turnOver: (page: Page, ms: number) => Promise<void> = async (
  page: Page,
  ms: number,
): Promise<void> => {
  await page.clock.fastForward(ms);
};

// ---- every test ----------------------------------------------------------------

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();

// Nothing the pages ask for leaves the fixture, and no script error is thrown.
test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

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

  // Every read the pages made is one the fixture models.
  expect(unexpected).toEqual([]);
  expect(pageErrors.get(page) || []).toEqual([]);
});

// ---- the player ------------------------------------------------------------------

test.describe("the player", () => {
  test("covers the whole window and plays the playlist's dashboards in order, each for its time, round and round", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPlayer(page, WALL);

    await expectOnScreen(page, OVERVIEW);
    await expect(position(page)).toContainText("NOC wall");
    await expect(position(page)).toContainText("1 of 3");

    // Over the app: its header is under the player, out of reach.
    const header: Locator = page.getByTestId("fixture-app-header");
    const box: { x: number; y: number } | null = await header.boundingBox();
    expect(box).not.toBeNull();
    const isCovered: boolean = await page.evaluate(
      (point: { x: number; y: number }): boolean => {
        const element: Element | null = document.elementFromPoint(
          point.x + 20,
          point.y + 20,
        );
        return Boolean(element?.closest('[data-testid="playlist-player"]'));
      },
      box!,
    );
    expect(isCovered).toBe(true);
    // And the page under it does not scroll.
    expect(
      await page.evaluate((): string => {
        return document.body.style.overflow;
      }),
    ).toBe("hidden");

    await shoot(page, testInfo, "player");

    await turnOver(page, MINUTE);
    await expectOnScreen(page, CLUSTERS);
    await expect(position(page)).toContainText("2 of 3");

    await turnOver(page, MINUTE);
    await expectOnScreen(page, DATABASES);
    await expect(position(page)).toContainText("3 of 3");

    // Round and round.
    await turnOver(page, MINUTE);
    await expectOnScreen(page, OVERVIEW);
    await expect(position(page)).toContainText("1 of 3");
  });

  test("a dashboard on the wall is a display: its charts offer no zoom and nothing to open under the player", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    const board: Locator = onScreen(page);

    // The charts are drawn, with their titles...
    await expect(board.getByText("Request Rate Over Time")).toBeVisible();
    // ...and none of the dashboard page's handles on them.
    await expect(board.getByText("Drag to zoom")).toHaveCount(0);
    await expect(
      board.getByRole("button", {
        name: "Investigate this time window in a side panel",
      }),
    ).toHaveCount(0);
    await expect(
      board.getByRole("button", { name: "Open in Metric Explorer" }),
    ).toHaveCount(0);
  });

  test("draws the next dashboard out of sight ahead of its turn, and keeps it - never drawn again - when the turn comes", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    // The next one is on the page already, read and drawn, but not seen.
    await expect(upNextBoard(page)).toHaveAttribute(
      "data-dashboard-id",
      CLUSTERS.id,
    );
    await expect(upNextBoard(page)).toHaveAttribute("aria-hidden", "true");
    await expect(
      upNextBoard(page).getByText(CLUSTERS.name, { exact: true }).first(),
    ).toBeAttached();
    await expect(upNextBoard(page)).toBeHidden();
    await expect(page.getByTestId("playlist-player-up-next")).toHaveText(
      `Next: ${CLUSTERS.name}`,
    );

    await expect
      .poll(() => {
        return readsOf(page, CLUSTERS.id);
      })
      .toBe(1);

    // Marked, to tell whether its turn draws it again.
    await upNextBoard(page).evaluate((element: HTMLElement): void => {
      (element.firstElementChild as HTMLElement).dataset["e2eKept"] = "yes";
    });

    await turnOver(page, MINUTE);
    await expectOnScreen(page, CLUSTERS);

    expect(
      await onScreen(page).evaluate((element: HTMLElement): string => {
        return (
          (element.firstElementChild as HTMLElement | null)?.dataset[
            "e2eKept"
          ] || ""
        );
      }),
    ).toBe("yes");
    expect(await readsOf(page, CLUSTERS.id)).toBe(1);

    // And the one after it is drawn ahead in turn.
    await expect(upNextBoard(page)).toHaveAttribute(
      "data-dashboard-id",
      DATABASES.id,
    );
  });

  test("opens each dashboard on its own saved time range, whatever the address or the viewer's own picks say", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    // The viewer's remembered pick for the overview: a week.
    await page.addInitScript((id: string): void => {
      window.localStorage.setItem(
        `oneuptime-dashboard-time-range:${id}`,
        "Past 1 Week",
      );
    }, OVERVIEW.id);

    // And a link that asks for two days, refreshing every 30 seconds.
    await openPlayer(page, WALL, "?range=2d&refresh=30s");
    await expectOnScreen(page, OVERVIEW);

    // The overview (Past 1 Day) and the clusters drawn ahead (Past 1 Hour).
    const spans: () => Promise<Array<number>> = async (): Promise<
      Array<number>
    > => {
      return (await record(page)).aggregates
        .filter((read: { start: number | null; end: number | null }) => {
          return read.start !== null && read.end !== null;
        })
        .map((read: { start: number | null; end: number | null }) => {
          return read.end! - read.start!;
        });
    };
    const isAbout: (span: number, wanted: number) => boolean = (
      span: number,
      wanted: number,
    ): boolean => {
      return Math.abs(span - wanted) <= 5 * MINUTE;
    };

    await expect
      .poll(async () => {
        return (await spans()).some((span: number) => {
          return isAbout(span, DAY);
        });
      })
      .toBe(true);
    await expect
      .poll(async () => {
        return (await spans()).some((span: number) => {
          return isAbout(span, HOUR);
        });
      })
      .toBe(true);

    expect(
      (await spans()).filter((span: number) => {
        return !isAbout(span, DAY) && !isAbout(span, HOUR);
      }),
    ).toEqual([]);

    // Neither the address nor the remembered pick were written over.
    expect(new URL(page.url()).search).toBe("?range=2d&refresh=30s");
    expect(
      await page.evaluate((id: string): string | null => {
        return window.localStorage.getItem(
          `oneuptime-dashboard-time-range:${id}`,
        );
      }, OVERVIEW.id),
    ).toBe("Past 1 Week");

    // A board on its own toolbar-free page: no time range picker to change.
    await expect(onScreen(page).getByText("Past 1 Day")).toHaveCount(0);
  });

  test("Pause stops the turn where it is, and Play goes on from there", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    await page.getByRole("button", { name: "Pause", exact: true }).click();

    await expect(page.getByTestId("playlist-player-paused")).toHaveText(
      "Paused",
    );
    await expect(page.getByTestId("playlist-player-turn-line")).toHaveAttribute(
      "data-paused",
      "true",
    );
    await shoot(page, testInfo, "player-paused");

    // Paused, the turn does not end.
    await turnOver(page, 10 * MINUTE);
    await expectOnScreen(page, OVERVIEW);

    // Space plays it again.
    await page.keyboard.press("Space");
    await expect(page.getByTestId("playlist-player-paused")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();

    await turnOver(page, MINUTE);
    await expectOnScreen(page, CLUSTERS);

    // Space again pauses it.
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
  });

  test("Next and Previous, by button and by arrow key, the round wrapping both ways", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    await page.getByRole("button", { name: "Next dashboard" }).click();
    await expectOnScreen(page, CLUSTERS);
    // Said to a screen reader: where a press went.
    await expect(page.getByRole("status")).toHaveText(CLUSTERS.name);

    await page.keyboard.press("ArrowRight");
    await expectOnScreen(page, DATABASES);

    await page.keyboard.press("ArrowRight");
    await expectOnScreen(page, OVERVIEW);

    await page.keyboard.press("ArrowLeft");
    await expectOnScreen(page, DATABASES);

    await page.getByRole("button", { name: "Previous dashboard" }).click();
    await expectOnScreen(page, CLUSTERS);

    // A press starts the turn afresh: a whole minute from it.
    await turnOver(page, 50 * SECOND);
    await expectOnScreen(page, CLUSTERS);
    await turnOver(page, 15 * SECOND);
    await expectOnScreen(page, DATABASES);
  });

  test("skips a dashboard that is archived, deleted or not the viewer's to see", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    // Old checkout (archived), Finance (not readable), overview, a deleted one, clusters.
    await openPlayer(page, NIGHT_SHIFT);

    await expectOnScreen(page, OVERVIEW);
    await expect(position(page)).toContainText("1 of 2");

    await turnOver(page, 30 * SECOND);
    await expectOnScreen(page, CLUSTERS);
    await expect(position(page)).toContainText("2 of 2");

    const shown: Array<string> = (await record(page)).dashboardReads.map(
      (read: { id: string }): string => {
        return read.id;
      },
    );

    for (const skipped of [ARCHIVED_ID, PRIVATE_ID, DELETED_ID]) {
      expect(shown).not.toContain(skipped);
    }
  });

  test("a dashboard twice in the playlist is shown twice, each turn its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    // overview, clusters, overview, databases; 45 seconds.
    await openPlayer(page, REPEAT);

    await expectOnScreen(page, OVERVIEW);
    await expect(position(page)).toContainText("1 of 4");

    await turnOver(page, 45 * SECOND);
    await expectOnScreen(page, CLUSTERS);
    await expect(page.getByTestId("playlist-player-up-next")).toHaveText(
      `Next: ${OVERVIEW.name}`,
    );

    await turnOver(page, 45 * SECOND);
    await expectOnScreen(page, OVERVIEW);
    await expect(position(page)).toContainText("3 of 4");
  });

  test("a playlist of one dashboard shows it with nothing to step through", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, LOBBY);
    await expectOnScreen(page, OVERVIEW);

    await expect(position(page)).toContainText("1 of 1");
    await expect(page.getByTestId("playlist-player-up-next")).toHaveCount(0);
    await expect(upNextBoard(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Next dashboard" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Previous dashboard" }),
    ).toBeDisabled();

    // Its turns go by without drawing it again.
    await turnOver(page, 15 * SECOND);
    await expectOnScreen(page, OVERVIEW);
    await turnOver(page, 15 * SECOND);
    await expectOnScreen(page, OVERVIEW);
    expect(await readsOf(page, OVERVIEW.id)).toBe(1);
  });

  test("picks up a change to the playlist at the end of the round, not in the middle of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    // Someone edits the playlist: databases, then overview.
    await page.evaluate((): void => {
      window.__dashboardPlaylistsFixture!.setPlaylist("wall", [
        "databases",
        "overview",
      ]);
    });

    // This round plays on as it was.
    await turnOver(page, MINUTE);
    await expectOnScreen(page, CLUSTERS);
    await expect(position(page)).toContainText("2 of 3");

    // Its last turn reads the playlist again, and shows what comes next.
    await turnOver(page, MINUTE);
    await expectOnScreen(page, DATABASES);
    await expect(position(page)).toContainText("3 of 3");
    await expect(page.getByTestId("playlist-player-up-next")).toHaveText(
      `Next: ${DATABASES.name}`,
    );

    // The next round is the playlist as it is now.
    await turnOver(page, MINUTE);
    await expectOnScreen(page, DATABASES);
    await expect(position(page)).toContainText("1 of 2");
    await turnOver(page, MINUTE);
    await expectOnScreen(page, OVERVIEW);
    await expect(position(page)).toContainText("2 of 2");
  });

  test("a playlist deleted while it plays says so at the end of the round", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    await page.evaluate((): void => {
      window.__dashboardPlaylistsFixture!.deletePlaylist("wall");
    });

    await page.getByRole("button", { name: "Next dashboard" }).click();
    await page.getByRole("button", { name: "Next dashboard" }).click();
    await expectOnScreen(page, DATABASES);

    await turnOver(page, MINUTE);
    await expect(player(page)).toHaveAttribute("data-status", "NotFound");
    await expect(page.getByText("Playlist not found")).toBeVisible();
  });

  test("Exit, and Escape, go back to the playlist's page", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    await page.getByRole("button", { name: "Exit the player" }).click();
    await expectPath(page, playlistPath(WALL));
    await expect(player(page)).toHaveCount(0);
    // The page scrolls again.
    expect(
      await page.evaluate((): string => {
        return document.body.style.overflow;
      }),
    ).toBe("");

    await page.goto(playPath(WALL));
    await expectOnScreen(page, OVERVIEW);
    await page.keyboard.press("Escape");
    await expectPath(page, playlistPath(WALL));
  });

  test("the keyboard sheet lists the player's keys, and Escape closes it without leaving the player", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    await page.keyboard.press("Shift+?");

    const sheet: Locator = page.getByTestId("keyboard-shortcuts-modal");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("shortcut-group-playback")).toContainText(
      "Pause or play",
    );
    await expect(sheet.getByTestId("shortcut-group-playback")).toContainText(
      "Next dashboard",
    );
    await expect(sheet.getByTestId("shortcut-group-screen")).toContainText(
      "Full screen",
    );
    await expect(sheet.getByTestId("shortcut-group-screen")).toContainText(
      "Exit the player",
    );
    await shoot(page, testInfo, "player-shortcuts");

    // Six keys in a medium dialog, not two columns across the whole window.
    const dialogBox: { width: number } | null = await page
      .getByRole("dialog")
      .boundingBox();
    expect(dialogBox!.width).toBeLessThanOrEqual(768);

    // While the sheet is open, the arrows and Space are not the player's.
    await page.keyboard.press("ArrowRight");
    await expectOnScreen(page, OVERVIEW);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expectPath(page, playPath(WALL));

    // The player hears its keys again.
    await page.keyboard.press("ArrowRight");
    await expectOnScreen(page, CLUSTERS);
  });

  test("F and the Full screen button put the whole page in full screen, and take it out", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    const isFullScreen: () => Promise<boolean> = (): Promise<boolean> => {
      return page.evaluate((): boolean => {
        return document.fullscreenElement === document.documentElement;
      });
    };

    await page
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    await expect.poll(isFullScreen).toBe(true);
    await expect(
      page.getByRole("button", { name: "Exit full screen" }),
    ).toBeVisible();

    await page.keyboard.press("f");
    await expect.poll(isFullScreen).toBe(false);
    await expect(
      page.getByRole("button", { name: "Full screen", exact: true }),
    ).toBeVisible();

    // Still playing, and the bar still there.
    await expectOnScreen(page, OVERVIEW);
  });

  test("keeps the screen awake while it plays, where the browser allows", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await page.addInitScript((): void => {
      const requests: Array<string> = [];
      (window as unknown as { __wakeLockRequests: Array<string> })[
        "__wakeLockRequests"
      ] = requests;
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: (
            type: string,
          ): Promise<{ release: () => Promise<void> }> => {
            requests.push(type);
            return Promise.resolve({
              release: (): Promise<void> => {
                requests.push("released");
                return Promise.resolve();
              },
            });
          },
        },
      });
    });

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    const requests: () => Promise<Array<string>> = (): Promise<
      Array<string>
    > => {
      return page.evaluate((): Array<string> => {
        return (window as unknown as { __wakeLockRequests: Array<string> })[
          "__wakeLockRequests"
        ];
      });
    };

    await expect.poll(requests).toEqual(["screen"]);

    await page.getByRole("button", { name: "Exit the player" }).click();
    await expect.poll(requests).toEqual(["screen", "released"]);
  });
});

test.describe("when there is nothing to play", () => {
  test("a playlist with no dashboards says so, and opens the playlist to add some", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPlayer(page, DRAFT);

    await expect(player(page)).toHaveAttribute("data-status", "Empty");
    await expect(page.getByText("Nothing to show yet")).toBeVisible();
    // The bar names the playlist, with nothing to step through.
    await expect(barTitle(page)).toHaveText("Draft");
    await expect(position(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Next dashboard" }),
    ).toHaveCount(0);
    await shoot(page, testInfo, "player-empty");

    await page.getByTestId("playlist-player-open-playlist").click();
    await expectPath(page, playlistPath(DRAFT));
  });

  test("so does one whose dashboards are all gone, and it starts once one is added", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await openPlayer(page, RETIRED);
    await expect(player(page)).toHaveAttribute("data-status", "Empty");

    await page.evaluate((): void => {
      window.__dashboardPlaylistsFixture!.setPlaylist("gone", ["clusters"]);
    });

    // It looks again after a minute.
    await turnOver(page, MINUTE);
    await expectOnScreen(page, CLUSTERS);
  });

  test("a playlist that is not there says so, and leads to all playlists", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openPlayer(page, MISSING);

    await expect(player(page)).toHaveAttribute("data-status", "NotFound");
    await expect(page.getByText("Playlist not found")).toBeVisible();
    await expect(
      page.getByText(
        "This playlist was deleted, or you do not have access to it.",
      ),
    ).toBeVisible();
    await shoot(page, testInfo, "player-not-found");

    await page.getByTestId("playlist-player-open-playlists").click();
    await expectPath(page, LIST_PATH);
  });

  test("a failed read says so, tries again by itself, and on Try again", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openPlayer(page, WALL, "?reads=fail");

    await expect(player(page)).toHaveAttribute("data-status", "Error");
    await expect(page.getByText("Could not load this playlist")).toBeVisible();
    await expect(
      page.getByTestId("playlist-player-error-description"),
    ).toHaveText(
      "The playlist could not be read. Try again in a moment. The player tries again in a minute.",
    );

    // In the middle of the stage, where a wall is looked at.
    const stage: { y: number; height: number } | null = await page
      .getByTestId("playlist-player-stage")
      .boundingBox();
    const message: { y: number; height: number } | null = await page
      .locator("#playlist-player-error")
      .boundingBox();
    expect(
      Math.abs(
        message!.y + message!.height / 2 - (stage!.y + stage!.height / 2),
      ),
    ).toBeLessThan(40);
    await shoot(page, testInfo, "player-error");

    const reads: () => Promise<number> = async (): Promise<number> => {
      return (await record(page)).playlistReads.length;
    };
    const before: number = await reads();

    await turnOver(page, MINUTE);
    await expect.poll(reads).toBe(before + 1);

    await page.getByTestId("playlist-player-try-again").click();
    await expect.poll(reads).toBe(before + 2);
  });
});

// ---- the pages -----------------------------------------------------------------

test.describe("Dashboards -> Playlists", () => {
  test("lists the project's playlists, each with its dashboards and time, and Play on every row", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await page.goto(LIST_PATH);

    // What each plays, in one phrase: how many dashboards, how long each.
    const wall: Locator = page.locator("tr").filter({ hasText: "NOC wall" });
    await expect(wall.getByTestId("playlist-summary")).toHaveText(
      "3 dashboards, 1 minute each",
    );

    const lobby: Locator = page
      .locator("tr")
      .filter({ hasText: "Lobby screen" });
    await expect(lobby.getByTestId("playlist-summary")).toHaveText(
      "1 dashboard, 15 seconds each",
    );

    await expect(
      page
        .locator("tr")
        .filter({ hasText: "Draft" })
        .getByTestId("playlist-summary"),
    ).toHaveText("No dashboards");

    // The side menu's Playlists is the page's own.
    await expect(sideMenuPlaylists(page)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await shoot(page, testInfo, "playlists");

    await wall.getByRole("button", { name: "Play", exact: true }).click();
    await expectPath(page, playPath(WALL));
    await expectOnScreen(page, OVERVIEW);
  });

  test("fits beside the side menu at a tablet's width, in German too, without scrolling sideways under its Play buttons", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    for (const view of [
      { width: 768, query: "" },
      { width: 768, query: "?lang=de" },
      { width: 1024, query: "?lang=de" },
    ]) {
      await page.setViewportSize({ width: view.width, height: 900 });
      await page.goto(`${LIST_PATH}${view.query}`);

      const wall: Locator = page.locator("tr").filter({ hasText: "NOC wall" });
      await expect(wall.getByTestId("playlist-summary")).toBeVisible();

      // The table fits its card: no sideways scroll box at all.
      await expect(page.getByTestId("table-scroll")).toHaveAttribute(
        "data-overflowing",
        "false",
      );

      // Every row's phrase ends before its Play button starts.
      const rows: Locator = page.locator("tbody tr");
      const count: number = await rows.count();
      expect(count).toBeGreaterThan(0);

      for (let index: number = 0; index < count; index++) {
        const row: Locator = rows.nth(index);
        const phrase: { x: number; width: number } | null = await row
          .getByTestId("playlist-summary")
          .boundingBox();
        const play: { x: number } | null = await row
          .getByRole("button")
          .filter({ hasText: view.query ? "Abspielen" : "Play" })
          .boundingBox();

        expect({
          width: view.width,
          query: view.query,
          index,
          ends: phrase!.x + phrase!.width <= play!.x,
        }).toEqual({
          width: view.width,
          query: view.query,
          index,
          ends: true,
        });
      }
    }
  });

  test("a playlist's page lists its dashboards in order, says which the player skips, and gives the player's link", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await page.goto(playlistPath(NIGHT_SHIFT));

    const items: Locator = page.getByTestId("playlist-dashboard-list-item");
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toContainText("Old checkout");
    await expect(items.nth(0)).toContainText(
      "Archived. The player skips it until it is unarchived.",
    );
    await expect(items.nth(1)).toContainText("Dashboard not available");
    await expect(items.nth(2)).toContainText(OVERVIEW.name);
    await expect(items.nth(3)).toContainText("Dashboard not available");
    await expect(items.nth(4)).toContainText(CLUSTERS.name);
    await expect(
      items.nth(2).getByRole("link", { name: OVERVIEW.name }),
    ).toHaveAttribute("href", `${DASHBOARDS_PATH}/${OVERVIEW.id}`);

    await expect(page.getByTestId("playlist-interval")).toHaveText(
      "30 seconds",
    );
    await expect(page.getByTestId("playlist-player-link")).toHaveText(
      `http://127.0.0.1:${PORT}${playPath(NIGHT_SHIFT)}`,
    );
    await expect(
      page.getByRole("button", { name: "Copy link", exact: true }),
    ).toBeVisible();

    // The order and the link each have a row of the card to themselves.
    const card: { width: number } | null = await page
      .locator("#model-detail-dashboard-playlist")
      .boundingBox();
    const order: { width: number } | null = await page
      .getByTestId("playlist-dashboard-list")
      .boundingBox();
    const linkRow: { width: number } | null = await page
      .getByTestId("playlist-player-link")
      .locator("..")
      .boundingBox();
    expect(order!.width).toBeGreaterThan(card!.width * 0.9);
    expect(linkRow!.width).toBeGreaterThan(card!.width * 0.9);

    // A playlist's page keeps the side menu's Playlists lit.
    await expect(sideMenuPlaylists(page)).toHaveAttribute(
      "aria-current",
      /page|true/,
    );
    await shoot(page, testInfo, "playlist");

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expectPath(page, playPath(NIGHT_SHIFT));
  });

  test("Create Playlist: a name, dashboards picked in order, and how long each is shown", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await page.goto(LIST_PATH);
    await page.getByRole("button", { name: "Create Playlist" }).click();
    await expect(dialog(page)).toBeVisible();

    // Left empty, the form asks for a dashboard.
    await dialog(page).getByPlaceholder("NOC wall").fill("Support TV");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(
      dialog(page).getByText("Add at least one dashboard to the playlist."),
    ).toBeVisible();
    expect((await record(page)).creates).toEqual([]);

    const picker: Locator = dialog(page).getByRole("combobox", {
      name: "Add a dashboard",
    });

    // Archived dashboards are not offered.
    await picker.click();
    await expect(
      page.getByRole("option", { name: "Old checkout" }),
    ).toHaveCount(0);
    await page.getByRole("option", { name: DATABASES.name }).click();

    await picker.click();
    await page.getByRole("option", { name: OVERVIEW.name }).click();

    const rows: Locator = dialog(page).getByTestId(/^playlist-dashboard-\d+$/);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(DATABASES.name);
    await expect(rows.nth(1)).toContainText(OVERVIEW.name);

    // The overview first.
    await dialog(page)
      .getByRole("button", { name: `Move ${OVERVIEW.name} up` })
      .click();
    await expect(rows.nth(0)).toContainText(OVERVIEW.name);

    await dialog(page)
      .getByRole("combobox", { name: "Show each dashboard for" })
      .click();
    await page.getByRole("option", { name: "30 seconds" }).click();

    await shoot(page, testInfo, "create-playlist", dialog(page));

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const created: Record<string, unknown> = (await record(page)).creates[0]!;
    expect(created["name"]).toBe("Support TV");
    expect(created["dashboards"]).toEqual([
      { dashboardId: OVERVIEW.id },
      { dashboardId: DATABASES.id },
    ]);
    expect(created["intervalInSeconds"]).toBe(30);

    const row: Locator = page.locator("tr").filter({ hasText: "Support TV" });
    await expect(row).toContainText("2 dashboards");
    await expect(row).toContainText("30 seconds");
  });

  test("Edit Playlist reorders, removes and adds, and the page shows the new order", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await page.goto(playlistPath(WALL));
    await expect(page.getByTestId("playlist-dashboard-list-item")).toHaveCount(
      3,
    );

    await page.getByRole("button", { name: "Edit Playlist" }).click();
    await expect(dialog(page)).toBeVisible();

    const rows: Locator = dialog(page).getByTestId(/^playlist-dashboard-\d+$/);
    await expect(rows).toHaveCount(3);

    await dialog(page)
      .getByRole("button", { name: `Move ${DATABASES.name} up` })
      .click();
    await dialog(page)
      .getByRole("button", { name: `Remove ${OVERVIEW.name}` })
      .click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(DATABASES.name);
    await expect(rows.nth(1)).toContainText(CLUSTERS.name);

    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const edit: { id: string; data: Record<string, unknown> } = (
      await record(page)
    ).edits[0]!;
    expect(edit.id).toBe(WALL);
    expect(edit.data["dashboards"]).toEqual([
      { dashboardId: DATABASES.id },
      { dashboardId: CLUSTERS.id },
    ]);

    const items: Locator = page.getByTestId("playlist-dashboard-list-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(DATABASES.name);
    await expect(items.nth(1)).toContainText(CLUSTERS.name);

    // And the player plays the new order.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expectOnScreen(page, DATABASES);
  });

  test("an edit keeps a dashboard the editor cannot see, so nothing someone else put there is lost", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await page.goto(playlistPath(NIGHT_SHIFT));
    await page.getByRole("button", { name: "Edit Playlist" }).click();

    const rows: Locator = dialog(page).getByTestId(/^playlist-dashboard-\d+$/);
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(1)).toContainText("Dashboard not available");

    await dialog(page).getByPlaceholder("NOC wall").fill("Night shift TV");
    await dialog(page).getByTestId("modal-footer-submit-button").click();
    await expect(dialog(page)).toHaveCount(0);

    expect((await record(page)).edits[0]!.data["dashboards"]).toEqual([
      { dashboardId: ARCHIVED_ID },
      { dashboardId: PRIVATE_ID },
      { dashboardId: OVERVIEW.id },
      { dashboardId: DELETED_ID },
      { dashboardId: CLUSTERS.id },
    ]);
  });

  test("Delete takes the playlist away and goes back to the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    atDesktopOnly();

    await page.goto(playlistPath(LOBBY));
    await page
      .getByRole("button", { name: "Delete Dashboard Playlist" })
      .click();
    await page
      .getByTestId("modal")
      .getByRole("button", { name: "Delete Dashboard Playlist" })
      .click();

    await expectPath(page, LIST_PATH);
    expect((await record(page)).deletes).toEqual([LOBBY]);
    await expect(
      page.locator("tr").filter({ hasText: "Lobby screen" }),
    ).toHaveCount(0);
  });

  test("a Viewer plays playlists, and creates, edits and deletes none", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await page.goto(`${LIST_PATH}?role=viewer`);

    await expect(
      page.locator("tr").filter({ hasText: "NOC wall" }),
    ).toBeVisible();
    // Shown, as the product shows a button its reader may not use: disabled.
    await expect(
      page.getByRole("button", { name: "Create Playlist" }),
    ).toBeDisabled();

    await page.goto(`${playlistPath(WALL)}?role=viewer`);
    await expect(page.getByTestId("playlist-dashboard-list-item")).toHaveCount(
      3,
    );
    await expect(
      page.getByRole("button", { name: "Edit Playlist" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Delete Dashboard Playlist" }),
    ).toBeDisabled();
    await shoot(page, testInfo, "playlist-viewer");

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expectOnScreen(page, OVERVIEW);
  });
});

// ---- languages, the dark theme, a phone --------------------------------------------

test.describe("in the reader's language and theme", () => {
  test("German", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openPlayer(page, WALL, "?lang=de");
    await expectOnScreen(page, OVERVIEW);

    await expect(position(page)).toContainText("1 von 3");
    await expect(page.getByTestId("playlist-player-up-next")).toHaveText(
      `Als Nächstes: ${CLUSTERS.name}`,
    );
    await expect(
      page.getByRole("button", { name: "Nächstes Dashboard" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pausieren" }).click();
    await expect(page.getByTestId("playlist-player-paused")).toHaveText(
      "Pausiert",
    );
    await shoot(page, testInfo, "player-de");

    await page.goto(`${LIST_PATH}?lang=de`);
    await expect(
      page.locator("tr").filter({ hasText: "NOC wall" }),
    ).toContainText("3 Dashboards");
    await expect(
      page.locator("tr").filter({ hasText: "NOC wall" }),
    ).toContainText("1 Minute");
  });

  test("Japanese", async ({ page }: { page: Page }) => {
    atDesktopOnly();

    await openPlayer(page, WALL, "?lang=ja");
    await expectOnScreen(page, OVERVIEW);
    await expect(position(page)).toContainText("1 / 3");
    await expect(
      page.getByRole("button", { name: "次のダッシュボード" }),
    ).toBeVisible();
  });

  test("Persian, right to left: the arrow keys follow the reading direction", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    atDesktopOnly();

    await openPlayer(page, WALL, "?lang=fa");
    await expectOnScreen(page, OVERVIEW);
    await expect(
      page.getByRole("button", { name: "داشبورد بعدی" }),
    ).toBeVisible();

    // The bar starts at the right.
    const bar: Locator = page.getByTestId("playlist-player-bar");
    const title: { x: number; width: number } | null =
      await barTitle(page).boundingBox();
    const controls: { x: number; width: number } | null = await bar
      .getByRole("toolbar")
      .boundingBox();
    expect(title!.x).toBeGreaterThan(controls!.x);

    await shoot(page, testInfo, "player-fa");

    // Left is onward in a right-to-left page.
    await page.keyboard.press("ArrowLeft");
    await expectOnScreen(page, CLUSTERS);
    await page.keyboard.press("ArrowRight");
    await expectOnScreen(page, OVERVIEW);
  });

  test("the dark theme", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await openPlayer(page, WALL, "?theme=dark");
    await expectOnScreen(page, OVERVIEW);

    // The bar is drawn dark, its words light.
    const colours: { background: string; text: string } = await page.evaluate(
      (): { background: string; text: string } => {
        const bar: Element = document.querySelector(
          '[data-testid="playlist-player-bar"] > div',
        )!;
        const title: Element = document.querySelector(
          '[data-testid="playlist-player-dashboard-name"]',
        )!;
        return {
          background: getComputedStyle(bar).backgroundColor,
          text: getComputedStyle(title).color,
        };
      },
    );

    const brightness: (colour: string) => number = (colour: string): number => {
      const channels: Array<number> = (colour.match(/[\d.]+/g) || []).map(
        Number,
      );
      return (
        (channels[0] || 0) * 0.299 +
        (channels[1] || 0) * 0.587 +
        (channels[2] || 0) * 0.114
      );
    };

    expect(brightness(colours.background)).toBeLessThan(80);
    expect(brightness(colours.text)).toBeGreaterThan(170);

    await shoot(page, testInfo, "player-dark");
  });
});

test.describe("at a phone's width", () => {
  test("the bar stacks over the board, and its buttons step through the playlist", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chromium",
      "the phone's own flow",
    );

    await openPlayer(page, WALL);
    await expectOnScreen(page, OVERVIEW);

    // Nothing wider than the screen.
    expect(
      await page.evaluate((): number => {
        return document.documentElement.scrollWidth;
      }),
    ).toBeLessThanOrEqual(390);

    await page.getByRole("button", { name: "Next dashboard" }).tap();
    await expectOnScreen(page, CLUSTERS);
    await page.getByRole("button", { name: "Pause", exact: true }).tap();
    await expect(page.getByTestId("playlist-player-paused")).toBeVisible();

    await shoot(page, testInfo, "player");

    // The list, its rows as cards: each with its dashboards and Play.
    await page.goto(LIST_PATH);
    await expect(page.getByText("NOC wall", { exact: true })).toBeVisible();
    await expect(
      page.getByText("3 dashboards, 1 minute each", { exact: true }),
    ).toBeVisible();
    await shoot(page, testInfo, "playlists");

    await page.getByRole("button", { name: "Play", exact: true }).first().tap();
    await expectPath(page, playPath(WALL));
    await expectOnScreen(page, OVERVIEW);
  });

  test("with nothing to play, the bar keeps Full screen and Exit on the playlist's line", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(
      test.info().project.name !== "mobile-chromium",
      "the phone's own flow",
    );

    await openPlayer(page, DRAFT);
    await expect(player(page)).toHaveAttribute("data-status", "Empty");

    const title: { y: number; height: number } | null =
      await barTitle(page).boundingBox();
    const exit: { y: number; height: number } | null = await page
      .getByRole("button", { name: "Exit the player" })
      .boundingBox();

    // One line: the button's middle is level with the name's.
    expect(
      Math.abs(exit!.y + exit!.height / 2 - (title!.y + title!.height / 2)),
    ).toBeLessThan(6);
  });
});
