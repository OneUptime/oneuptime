import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * The on-call calendar feed cards, end to end in a browser, against the
 * fixture's in-page API (CalendarFeed/Fixture.js), on the real pages.
 *
 * The maintainer's ask was "Please improve the UI of this card" with a
 * screenshot of 'Subscribe to your on-call shifts': three header buttons -
 * one a loud red Delete - above a narrow left-hand column of buttons, a
 * locked "Click to reveal" chip, a permanent paragraph about Google
 * Calendar, a grey bookkeeping line and a footnote, all in the same small
 * grey type, with the right two-thirds of the card empty.
 *
 * What is pinned here is what only a browser can show: the subscribe options
 * and the status sharing the card's width on a laptop and stacking on a
 * phone with nothing scrolling sideways; the footer on the card's edges; the
 * ⋯ menu, its confirmations and what each action does to the card; the link
 * field with a real clipboard, never showing the token until asked; the dark
 * theme's colours; German; the shared cards on the schedule and project
 * pages; and a viewer's locked menu.
 *
 * The screenshots under output/playwright/calendar-feed-ui are for the
 * people who review the cards.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/calendar-feed-ui",
);

interface FixtureRequest {
  method: string;
  path?: string;
  model?: string;
  id?: string;
  data?: Record<string, unknown>;
  body?: unknown;
}

interface FixtureState {
  requests: Array<FixtureRequest>;
  copied: Array<string>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function open(
  page: Page,
  query: string,
  width: number = 1280,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 900 });
  await page.goto(`/?${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __calendarFeedFixture: { state: unknown };
          }
        ).__calendarFeedFixture.state,
      ),
    );
  });
}

// The token the fixture's store holds for a link right now.
async function tokenOf(
  page: Page,
  key: "personal" | "schedule" | "project",
): Promise<string> {
  return await page.evaluate((storeKey: string) => {
    const store: Record<string, { token: string | null }> = (
      window as unknown as {
        __calendarFeedFixture: {
          store: Record<string, { token: string | null }>;
        };
      }
    ).__calendarFeedFixture.store;

    return store[storeKey]?.token || "";
  }, key);
}

function personalUrl(token: string): string {
  return `https://oneuptime.example.com/api/on-call-calendar/user/${token}/shifts.ics`;
}

async function box(locator: Locator): Promise<Box> {
  const found: Box | null = await locator.boundingBox();

  expect(found).not.toBeNull();

  return found as Box;
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

/*
 * The card that holds the personal link, found by what it holds rather than
 * by its title, so it is found in every language.
 */
function linkCard(page: Page): Locator {
  return page.getByTestId("card").filter({
    has: page.locator(
      "[data-testid='personal-calendar-feed-active'], [data-testid='personal-calendar-feed-empty'], [data-testid='personal-calendar-feed-load-error']",
    ),
  });
}

async function openManageMenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Manage link" }).first().click();

  const menu: Locator = page.getByRole("menu");

  await expect(menu).toBeVisible();

  return menu;
}

// The colour a computed style resolves to, as [r, g, b].
function channels(color: string): Array<number> {
  return (color.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
}

// Relative luminance, 0 (black) to 1 (white).
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((value: number): number => {
    const unit: number = value / 255;

    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * (r || 0) + 0.7152 * (g || 0) + 0.0722 * (b || 0);
}

async function backgroundOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element) => {
    return getComputedStyle(element).backgroundColor;
  });
}

async function colorOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element) => {
    return getComputedStyle(element).color;
  });
}

test.describe("User Settings > Calendar Feed on a laptop (1280px)", () => {
  test("subscribing and the status share the card's width; nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const links: Box = await box(
      page.getByTestId("personal-calendar-feed-links"),
    );
    const status: Box = await box(
      page.getByTestId("personal-calendar-feed-status"),
    );
    const card: Box = await box(linkCard(page));

    // Side by side: the options on the left, the status on the right.
    expect(status.x).toBeGreaterThan(links.x + links.width);
    expect(Math.abs(status.y - links.y)).toBeLessThan(40);
    // Between them they use the card's width, not its left third.
    expect(status.x + status.width).toBeGreaterThan(card.x + card.width - 60);
    expect(links.width).toBeGreaterThan(card.width * 0.45);

    // In that column the two options stack, each with room for its name.
    const google: Box = await box(
      page.getByTestId("personal-calendar-feed-google"),
    );
    const webcal: Box = await box(
      page.getByTestId("personal-calendar-feed-webcal"),
    );

    expect(Math.round(google.x)).toBe(Math.round(webcal.x));
    expect(webcal.y).toBeGreaterThanOrEqual(google.y + google.height);
    await expect(
      page
        .getByTestId("personal-calendar-feed-webcal")
        .getByText("Apple Calendar / Outlook"),
    ).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await linkCard(page).screenshot({
      path: path.join(SCREENSHOTS, "personal-google-1280.png"),
    });
  });

  test("the header holds only the ⋯, and the menu holds the three rare actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const actions: Locator = linkCard(page).getByTestId("card-header-actions");

    await expect(actions.getByRole("button")).toHaveCount(1);
    await expect(
      actions.getByRole("button", { name: "Manage link" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

    const menu: Locator = await openManageMenu(page);

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Regenerate link",
      "Disable link",
      "Delete link",
    ]);

    // Opened from the right edge, the menu stays on the screen.
    const menuBox: Box = await box(menu);

    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1280);

    await page.screenshot({
      path: path.join(SCREENSHOTS, "personal-menu-1280.png"),
    });
  });

  test("the footer runs along the card's bottom, edge to edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const frame: Locator = linkCard(page).locator(":scope > div").first();
    const frameBox: Box = await box(frame);
    const footer: Box = await box(
      page.getByTestId("personal-calendar-feed-time-log"),
    );

    // Inside the frame's 1px border on three sides.
    expect(Math.abs(footer.x - (frameBox.x + 1))).toBeLessThanOrEqual(1);
    expect(Math.abs(footer.width - (frameBox.width - 2))).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs(footer.y + footer.height - (frameBox.y + frameBox.height - 1)),
    ).toBeLessThanOrEqual(1);
  });

  test("the link stays hidden until Show, which reveals exactly the https link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const token: string = await tokenOf(page, "personal");

    expect(token).toHaveLength(43);

    // Nowhere on the page while hidden - only its last four characters.
    expect(await page.locator("body").innerText()).not.toContain(token);
    await expect(
      page.getByTestId("personal-calendar-feed-link-masked"),
    ).toContainText(token.slice(-4));

    await page.getByRole("button", { name: "Show link" }).click();

    const value: Locator = page.getByTestId(
      "personal-calendar-feed-link-value",
    );

    await expect(value).toHaveValue(personalUrl(token));

    /*
     * Its name says what it does next, so it is not also a pressed toggle:
     * a screen reader would read "Hide link, pressed".
     */
    const hide: Locator = page.getByRole("button", { name: "Hide link" });

    await expect(hide).toBeVisible();
    expect(await hide.getAttribute("aria-pressed")).toBeNull();

    await hide.click();

    await expect(value).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain(token);
  });

  test("Copy link copies the https link without showing it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const token: string = await tokenOf(page, "personal");
    const copy: Locator = page.getByTestId(
      "personal-calendar-feed-copy-button",
    );

    const masked: Locator = page.getByTestId(
      "personal-calendar-feed-link-masked",
    );
    const buttonBefore: Box = await box(copy);
    const maskedBefore: Box = await box(masked);

    await copy.click();

    await expect(copy).toHaveAccessibleName("Copied!");
    expect((await fixtureState(page)).copied).toEqual([personalUrl(token)]);
    await expect(
      page.getByTestId("personal-calendar-feed-link-value"),
    ).toHaveCount(0);

    /*
     * "Copied!" is shorter than "Copy link": the button keeps its width
     * for those two seconds, so the hidden link beside it does not jump.
     */
    const buttonCopied: Box = await box(copy);
    const maskedCopied: Box = await box(masked);

    expect(Math.abs(buttonCopied.width - buttonBefore.width)).toBeLessThan(0.5);
    expect(Math.abs(maskedCopied.width - maskedBefore.width)).toBeLessThan(0.5);

    await expect(copy).toHaveAccessibleName("Copy link", { timeout: 5000 });
  });

  test("Google Calendar opens Google's add page with the webcal link; Apple Calendar / Outlook is the webcal link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const token: string = await tokenOf(page, "personal");
    const webcal: string = personalUrl(token).replace("https:", "webcal:");

    await expect(
      page.getByTestId("personal-calendar-feed-webcal"),
    ).toHaveAttribute("href", webcal);

    const google: Locator = page.getByTestId("personal-calendar-feed-google");
    const href: URL = new URL((await google.getAttribute("href")) || "");

    expect(href.origin).toBe("https://calendar.google.com");
    expect(href.searchParams.get("cid")).toBe(webcal);
    await expect(google).toHaveAttribute("target", "_blank");
  });

  test("Regenerate link asks first, then the field ends in the new link's characters and the status waits for its first sync", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const before: string = await tokenOf(page, "personal");
    const menu: Locator = await openManageMenu(page);

    await menu.getByRole("menuitem", { name: "Regenerate link" }).click();

    const dialog: Locator = page.getByTestId("modal");

    await expect(dialog).toContainText("Regenerate calendar link?");
    expect(
      (await fixtureState(page)).requests.filter((request: FixtureRequest) => {
        return request.method === "POST";
      }),
    ).toHaveLength(0);

    await dialog.getByRole("button", { name: "Regenerate link" }).click();
    await expect(dialog).toHaveCount(0);

    const after: string = await tokenOf(page, "personal");

    expect(after).not.toBe(before);
    await expect(
      page.getByTestId("personal-calendar-feed-link-masked"),
    ).toContainText(after.slice(-4));
    await expect(
      page.getByTestId("personal-calendar-feed-status-pill"),
    ).toHaveText("Waiting for first sync");
    await expect(
      page.getByTestId("personal-calendar-feed-previous-link"),
    ).toContainText("Your previous link returns an empty calendar until");

    const posts: Array<FixtureRequest> = (
      await fixtureState(page)
    ).requests.filter((request: FixtureRequest) => {
      return request.method === "POST";
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/api/on-call-calendar/feed/rotate");
  });

  test("Disable link turns the link off at once; Enable link in the status turns it back on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const menu: Locator = await openManageMenu(page);

    await menu.getByRole("menuitem", { name: "Disable link" }).click();

    await expect(
      page.getByTestId("personal-calendar-feed-status-pill"),
    ).toHaveText("Disabled");
    await expect(
      page.getByTestId("personal-calendar-feed-disabled"),
    ).toBeVisible();

    await page.getByTestId("personal-calendar-feed-enable").click();

    await expect(
      page.getByTestId("personal-calendar-feed-status-pill"),
    ).toHaveText("Active");

    const writes: Array<FixtureRequest> = (
      await fixtureState(page)
    ).requests.filter((request: FixtureRequest) => {
      return request.method === "PUT";
    });

    expect(
      writes.map((request: FixtureRequest) => {
        return [request.model, request.data];
      }),
    ).toEqual([
      ["personal", { isEnabled: false }],
      ["personal", { isEnabled: true }],
    ]);
  });

  /*
   * After an action the card re-reads the link's status. On a real network
   * that takes a moment, and the card used to put its loader in place of
   * everything meanwhile - collapsing to a spinner and back under the
   * reader's pointer. It keeps what it shows until the answer arrives.
   */
  test("after Disable link the card stays in place while it re-reads, then says Disabled", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const card: Locator = linkCard(page);
    const heightBefore: number = (await box(card)).height;
    const readsBefore: number = (await fixtureState(page)).requests.filter(
      (request: FixtureRequest) => {
        return request.method === "GET";
      },
    ).length;

    await page.evaluate(() => {
      (
        window as unknown as {
          __calendarFeedFixture: { setReadDelay: (ms: number) => void };
        }
      ).__calendarFeedFixture.setReadDelay(2000);
    });

    const menu: Locator = await openManageMenu(page);

    await menu.getByRole("menuitem", { name: "Disable link" }).click();

    // The re-read has been asked for and has not answered yet.
    await expect
      .poll(async () => {
        return (await fixtureState(page)).requests.filter(
          (request: FixtureRequest) => {
            return request.method === "GET";
          },
        ).length;
      })
      .toBeGreaterThan(readsBefore);

    await expect(card.getByTestId("component-loader")).toHaveCount(0);
    await expect(
      page.getByTestId("personal-calendar-feed-links"),
    ).toBeVisible();
    await expect(
      page.getByTestId("personal-calendar-feed-status-pill"),
    ).toHaveText("Active");
    expect(Math.abs((await box(card)).height - heightBefore)).toBeLessThan(1);

    await expect(
      page.getByTestId("personal-calendar-feed-status-pill"),
    ).toHaveText("Disabled", { timeout: 10000 });
    await expect(card.getByTestId("component-loader")).toHaveCount(0);
  });

  test("Delete link asks first, then the card is back to Generate calendar link, which makes a new link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google");

    const menu: Locator = await openManageMenu(page);

    await menu.getByRole("menuitem", { name: "Delete link" }).click();

    const dialog: Locator = page.getByTestId("modal");

    await expect(dialog).toContainText("Delete calendar link?");
    // The button names what it does, as the menu item that opened it does.
    await dialog
      .getByRole("button", { name: "Delete link", exact: true })
      .click();

    await expect(
      page.getByTestId("personal-calendar-feed-empty-state"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage link" })).toHaveCount(
      0,
    );

    await page.getByTestId("personal-calendar-feed-generate").click();

    await expect(
      page.getByTestId("personal-calendar-feed-links"),
    ).toBeVisible();
    await expect(
      page.getByTestId("personal-calendar-feed-status-pill"),
    ).toHaveText("Waiting for first sync");
  });

  test("the menu works from the keyboard", async ({ page }: { page: Page }) => {
    await open(page, "state=google");

    await page.getByRole("button", { name: "Manage link" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("menu")).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(
      page.getByTestId("personal-calendar-feed-status-pill"),
    ).toHaveText("Disabled");
  });

  test("a failed read says what failed, and Try again recovers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=error");

    const error: Locator = page.getByTestId(
      "personal-calendar-feed-load-error",
    );

    await expect(error).toContainText("Could not load your calendar link.");
    await expect(error).toContainText(
      "The calendar feed service is not responding.",
    );

    await linkCard(page).screenshot({
      path: path.join(SCREENSHOTS, "personal-error-1280.png"),
    });

    await error.getByText("Try again").click();

    await expect(
      page.getByTestId("personal-calendar-feed-links"),
    ).toBeVisible();
  });

  test("the server's warnings run across the card above both columns", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=warnings");

    const notices: Box = await box(
      page.getByTestId("personal-calendar-feed-notices"),
    );
    const links: Box = await box(
      page.getByTestId("personal-calendar-feed-links"),
    );
    const status: Box = await box(
      page.getByTestId("personal-calendar-feed-status"),
    );

    expect(notices.y + notices.height).toBeLessThanOrEqual(links.y);
    // As wide as both columns together.
    expect(notices.width).toBeGreaterThanOrEqual(
      status.x + status.width - links.x - 2,
    );

    await linkCard(page).screenshot({
      path: path.join(SCREENSHOTS, "personal-warnings-1280.png"),
    });
  });

  test("an unreadable link gives the status the whole row, with Regenerate link in it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=regenerate");

    await expect(page.getByTestId("personal-calendar-feed-links")).toHaveCount(
      0,
    );

    const status: Box = await box(
      page.getByTestId("personal-calendar-feed-status"),
    );
    const card: Box = await box(linkCard(page));

    expect(status.width).toBeGreaterThan(card.width * 0.8);
    await expect(
      page.getByTestId("personal-calendar-feed-regenerate-now"),
    ).toBeVisible();
  });

  test("below the Growth plan the gate leads and there is no settings card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google&billing=on&plan=free");

    await expect(
      page.getByTestId("personal-calendar-feed-plan-gate"),
    ).toContainText("Calendar feeds require the Growth plan");
    await expect(page.getByText("Calendar feed settings")).toHaveCount(0);
  });
});

test.describe("the cards on a phone (390px)", () => {
  test("everything stacks: the options, then the status; nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google", 390);

    const links: Box = await box(
      page.getByTestId("personal-calendar-feed-links"),
    );
    const status: Box = await box(
      page.getByTestId("personal-calendar-feed-status"),
    );
    const google: Box = await box(
      page.getByTestId("personal-calendar-feed-google"),
    );
    const webcal: Box = await box(
      page.getByTestId("personal-calendar-feed-webcal"),
    );

    expect(status.y).toBeGreaterThan(links.y + links.height);
    expect(Math.round(google.width)).toBe(Math.round(webcal.width));
    expect(webcal.y).toBeGreaterThanOrEqual(google.y + google.height);
    // The field's three parts fit on the line.
    await expect(
      page.getByTestId("personal-calendar-feed-copy-button"),
    ).toBeInViewport();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.screenshot({
      path: path.join(SCREENSHOTS, "personal-google-390.png"),
      fullPage: true,
    });
  });

  test("a link that needs attention puts its status first", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const state of ["disabled", "stale"]) {
      await open(page, `state=${state}`, 390);

      const links: Box = await box(
        page.getByTestId("personal-calendar-feed-links"),
      );
      const status: Box = await box(
        page.getByTestId("personal-calendar-feed-status"),
      );

      expect(status.y + status.height).toBeLessThanOrEqual(links.y);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    }
  });

  test("the schedule and project pages do not scroll sideways either", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const query of ["page=schedule", "page=project", "state=empty"]) {
      await open(page, query, 390);

      expect({ query, overflow: await horizontalOverflow(page) }).toEqual({
        query,
        overflow: 0,
      });
    }
  });
});

test.describe("a wide screen (1536px)", () => {
  test("the two subscribe options sit side by side", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google", 1536);

    const google: Box = await box(
      page.getByTestId("personal-calendar-feed-google"),
    );
    const webcal: Box = await box(
      page.getByTestId("personal-calendar-feed-webcal"),
    );

    expect(Math.round(google.y)).toBe(Math.round(webcal.y));
    expect(webcal.x).toBeGreaterThan(google.x + google.width);
  });
});

test.describe("the dark theme", () => {
  test("the card, the options, the field and the status are dark; the pill keeps its colour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google&theme=dark");

    const frame: Locator = linkCard(page).locator(":scope > div").first();

    for (const surface of [
      frame,
      page.getByTestId("personal-calendar-feed-google"),
      page.getByTestId("personal-calendar-feed-status"),
      page.getByTestId("personal-calendar-feed-copy-button"),
      page.getByTestId("personal-calendar-feed-time-log"),
    ]) {
      expect(luminance(await backgroundOf(surface))).toBeLessThan(0.1);
    }

    // Light text on the dark surfaces.
    expect(
      luminance(
        await colorOf(
          page.getByTestId("personal-calendar-feed-status-headline"),
        ),
      ),
    ).toBeGreaterThan(0.6);

    // The Active pill is still green: its text is a green, not a grey.
    const [red, green, blue] = channels(
      await colorOf(page.getByTestId("personal-calendar-feed-status-pill")),
    );

    expect(green!).toBeGreaterThan(red!);
    expect(green!).toBeGreaterThan(blue!);

    await linkCard(page).screenshot({
      path: path.join(SCREENSHOTS, "personal-google-dark-1280.png"),
    });
  });
});

test.describe("German", () => {
  test("the status is one German sentence, the distance in German words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=google&lang=de");

    await expect(
      page.getByTestId("personal-calendar-feed-status-headline"),
    ).toHaveText("Zuletzt abgerufen vor 7 Minuten von Google Calendar");
    await expect(
      page.getByRole("button", { name: "Link verwalten" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Link anzeigen" }),
    ).toBeVisible();

    await linkCard(page).screenshot({
      path: path.join(SCREENSHOTS, "personal-google-de-1280.png"),
    });

    // "Link kopieren" and "Kopiert!" share one width as well.
    const copy: Locator = page.getByTestId(
      "personal-calendar-feed-copy-button",
    );
    const before: Box = await box(copy);

    await copy.click();
    await expect(copy).toHaveAccessibleName("Kopiert!");

    expect(Math.abs((await box(copy)).width - before.width)).toBeLessThan(0.5);
  });

  /*
   * "Link kopieren" leaves the hidden link little room on a phone. The
   * host gives way, then the dots; the last four characters stay whole,
   * and nothing runs under the Show button - the dots used to keep their
   * width and did.
   */
  test("on a phone the hidden link gives way before the buttons: nothing runs under Show", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [390, 360]) {
      await open(page, "state=google&lang=de", width);

      const masked: Box = await box(
        page.getByTestId("personal-calendar-feed-link-masked"),
      );
      const hint: Box = await box(
        page.getByTestId("personal-calendar-feed-link-mask-hint"),
      );
      const reveal: Box = await box(
        page.getByTestId("personal-calendar-feed-reveal"),
      );

      expect({ width, hintEnd: hint.x + hint.width <= reveal.x }).toEqual({
        width,
        hintEnd: true,
      });
      expect({
        width,
        hintInside:
          hint.x >= masked.x &&
          hint.x + hint.width <= masked.x + masked.width + 0.5,
      }).toEqual({ width, hintInside: true });
      const token: string = await tokenOf(page, "personal");

      await expect(
        page.getByTestId("personal-calendar-feed-link-mask-hint"),
      ).toHaveText(token.slice(-4));
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("the shared links", () => {
  test("on a schedule's page the personal block keeps a reading width and the team link gets its status beside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=schedule", 1440);

    const personal: Box = await box(
      page.getByTestId("schedule-personal-calendar-feed-links"),
    );

    expect(personal.width).toBeLessThanOrEqual(769);

    const sharedLinks: Box = await box(
      page.getByTestId("schedule-shared-calendar-feed-links"),
    );
    const sharedStatus: Box = await box(
      page.getByTestId("schedule-shared-calendar-feed-status"),
    );

    expect(sharedStatus.x).toBeGreaterThan(sharedLinks.x + sharedLinks.width);
    await expect(
      page.getByTestId("schedule-shared-calendar-feed-status-line"),
    ).toContainText("Last rotated 12 days ago");

    const menu: Locator = await openManageMenu(page);

    await expect(menu.getByRole("menuitem")).toHaveText([
      "Regenerate link",
      "Disable link",
    ]);

    await page.keyboard.press("Escape");

    await page.screenshot({
      path: path.join(SCREENSHOTS, "schedule-1440.png"),
      fullPage: true,
    });
  });

  test("a viewer may copy the team link, and finds Regenerate and Disable locked, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=schedule&role=viewer", 1440);

    await expect(
      page.getByTestId("schedule-shared-calendar-feed-copy-button"),
    ).toBeVisible();

    const menu: Locator = await openManageMenu(page);
    const regenerate: Locator = menu.getByRole("menuitem", {
      name: "Regenerate link",
    });

    await expect(regenerate).toHaveAttribute("aria-disabled", "true");

    await regenerate.click({ force: true });
    await expect(page.getByTestId("modal")).toHaveCount(0);
  });

  test("the project page's shared link reads as the same family", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=project");

    await expect(
      page.getByTestId("project-shared-calendar-feed-status-pill"),
    ).toHaveText("Active");
    await expect(
      page.getByTestId("project-shared-calendar-feed-ownership"),
    ).toContainText("The shared link belongs to the project");

    await page.screenshot({
      path: path.join(SCREENSHOTS, "project-1280.png"),
      fullPage: true,
    });
  });
});

test.describe("the empty state", () => {
  test("before a link exists the panel says what the link will hold, and Generate lines up with its text", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=empty");

    const title: Box = await box(
      page.getByTestId("personal-calendar-feed-empty-title"),
    );
    const generate: Box = await box(
      page.getByTestId("personal-calendar-feed-generate"),
    );

    expect(Math.abs(generate.x - title.x)).toBeLessThanOrEqual(1);

    await linkCard(page).screenshot({
      path: path.join(SCREENSHOTS, "personal-empty-1280.png"),
    });
  });

  /*
   * On a phone the panel's badge sits above its text, so the text and the
   * button have the panel's whole width: "Generate calendar link" is one
   * line, not two, and starts where the text does.
   */
  test("on a phone the panel stacks: badge, text, then a one-line Generate calendar link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=empty", 390);

    const icon: Box = await box(
      page.getByTestId("personal-calendar-feed-empty-icon"),
    );
    const title: Box = await box(
      page.getByTestId("personal-calendar-feed-empty-title"),
    );
    const generate: Box = await box(
      page.getByTestId("personal-calendar-feed-generate"),
    );

    expect(title.y).toBeGreaterThan(icon.y + icon.height);
    expect(Math.abs(generate.x - title.x)).toBeLessThanOrEqual(1);
    // One line of 14px text in a 38px button, not two.
    expect(generate.height).toBeLessThan(48);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  /*
   * The shared link's empty panel has its button in the same place: Publish
   * shared link starts the panel's text column - for an editor, and locked,
   * saying why, for a reader - not a dialog footer's margin in from it.
   */
  test("Publish shared link lines up with its panel's text too, working or locked", async ({
    page,
  }: {
    page: Page;
  }) => {
    const cases: Array<[string, string]> = [
      ["page=project&shared=empty", "project-shared-calendar-feed"],
      [
        "page=schedule&shared=empty&role=viewer",
        "schedule-shared-calendar-feed",
      ],
    ];

    for (const [query, prefix] of cases) {
      await open(page, query);

      const title: Box = await box(page.getByTestId(prefix + "-empty-title"));
      const publish: Box = await box(page.getByTestId(prefix + "-publish"));

      expect({ query, offset: Math.round(publish.x - title.x) }).toEqual({
        query,
        offset: 0,
      });
    }
  });
});
