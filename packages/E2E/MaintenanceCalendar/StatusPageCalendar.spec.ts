import { BrowserContext, expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { STATUS_PAGE_PLAIN_HTTP_HOST } from "./StatusPageOrigins";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

/*
 * A status page's calendar buttons, end to end in a browser, on the real
 * Scheduled Events pages against the fixture's in-page API
 * (StatusPageFixture.js).
 *
 * Subscribe to calendar on the list puts the page's maintenance in a
 * calendar app for good: Google Calendar's add-by-URL page, the device's
 * calendar app by webcal://, or the link to copy - each to the page's own
 * maintenance.ics, on its own domain or at its address under OneUptime,
 * and never offered on a private page. Add to calendar on an event's page
 * puts that one event in a calendar app: Google's add-event page filled in,
 * or the event as a file - and is not offered for an event that is over.
 * Then the phone's width, the dark theme, German and Persian. Last, Copy
 * link on a page served over plain http, where the browser has no
 * clipboard API (issue #5132): the link really reaches the clipboard, and
 * when the browser refuses, the dialog says so and selects it.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/maintenance-calendar-ui",
);

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

const PAGE_ID: string = "00000000-0000-4000-8000-000000000001";
const UPCOMING_ID: string = "00000000-0000-4000-8000-000000000100";
const ONGOING_ID: string = "00000000-0000-4000-8000-000000000101";
const OVER_ID: string = "00000000-0000-4000-8000-000000000102";

const PREVIEW: string = `/status-page/${PAGE_ID}`;

interface FixtureState {
  requests: Array<string>;
  copied: Array<string>;
}

async function open(
  page: Page,
  pathAndQuery: string,
  width: number = 1280,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 900 });
  await page.clock.setFixedTime(NOW);
  await page.goto(pathAndQuery);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __statusPageCalendarFixture: unknown })
          .__statusPageCalendarFixture,
      ),
    );
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

async function shot(page: Page, name: string, target?: Locator): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  const file: string = path.join(SCREENSHOTS, `${name}.png`);

  if (target) {
    await target.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: true });
  }
}

async function href(locator: Locator): Promise<string> {
  return (await locator.getAttribute("href")) || "";
}

function origin(page: Page): string {
  return new URL(page.url()).origin;
}

test.describe("Subscribe to calendar, on the Scheduled Events page", () => {
  test("at the page's address under OneUptime: Google, the device's app and the link, all to the page's maintenance.ics", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events`);

    const subscribe: Locator = page.getByTestId(
      "maintenance-calendar-subscribe",
    );

    await expect(subscribe).toBeVisible();
    await shot(page, "status-page-list");

    await subscribe.click();

    const dialog: Locator = page.getByTestId(
      "maintenance-calendar-subscribe-dialog",
    );

    await expect(dialog).toBeVisible();

    const https: string = `${origin(page)}/status-page/${PAGE_ID}/maintenance.ics`;
    const webcal: string = https.replace("http://", "webcal://");

    await expect(page.getByTestId("maintenance-calendar-url")).toHaveValue(
      https,
    );
    expect(await href(page.getByTestId("maintenance-calendar-device"))).toBe(
      webcal,
    );

    const google: URL = new URL(
      await href(page.getByTestId("maintenance-calendar-google")),
    );

    expect(google.hostname).toBe("calendar.google.com");
    expect(google.searchParams.get("cid")).toBe(webcal);

    await page.getByTestId("maintenance-calendar-copy").click();

    await expect(page.getByTestId("maintenance-calendar-copy")).toHaveText(
      "Copied!",
    );
    expect((await fixtureState(page)).copied).toEqual([https]);

    await shot(page, "status-page-subscribe", page.getByTestId("modal"));
  });

  test("on the page's own domain: /maintenance.ics", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/scheduled-events");

    await page.getByTestId("maintenance-calendar-subscribe").click();

    await expect(page.getByTestId("maintenance-calendar-url")).toHaveValue(
      `${origin(page)}/maintenance.ics`,
    );
  });

  test("is not offered on a private page, whose calendar no app could read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events?private=1`);

    await expect(page.getByText("Database upgrade").first()).toBeVisible();
    await expect(
      page.getByTestId("maintenance-calendar-subscribe"),
    ).toHaveCount(0);
  });

  test("Done closes it", async ({ page }: { page: Page }) => {
    await open(page, `${PREVIEW}/scheduled-events`);

    await page.getByTestId("maintenance-calendar-subscribe").click();
    await page.getByRole("button", { name: "Done" }).click();

    await expect(
      page.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toHaveCount(0);
  });
});

test.describe("Add to calendar, on an event's page", () => {
  test("Google Calendar with the event filled in, or the event alone as a file", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events/${UPCOMING_ID}`);

    const add: Locator = page.getByTestId("maintenance-calendar-add-event");

    await expect(add).toBeVisible();
    await shot(page, "status-page-event");

    await add.click();

    await expect(
      page.getByTestId("maintenance-calendar-event-dialog"),
    ).toBeVisible();

    const google: URL = new URL(
      await href(page.getByTestId("maintenance-calendar-google")),
    );

    expect(google.searchParams.get("action")).toBe("TEMPLATE");
    expect(google.searchParams.get("text")).toBe("Database upgrade");
    expect(google.searchParams.get("dates")).toBe(
      "20261020T220000Z/20261021T010000Z",
    );

    const device: Locator = page.getByTestId("maintenance-calendar-device");

    expect(await href(device)).toBe(
      `${origin(page)}/status-page/${PAGE_ID}/maintenance.ics?event=${UPCOMING_ID}`,
    );
    await expect(device).toHaveAttribute("download", "maintenance.ics");

    // One event: nothing to copy, no subscription's refresh note.
    await expect(page.getByTestId("maintenance-calendar-url")).toHaveCount(0);

    await shot(page, "status-page-add-event", page.getByTestId("modal"));
  });

  test("an event under way can be added too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events/${ONGOING_ID}`);

    await expect(
      page.getByTestId("maintenance-calendar-add-event"),
    ).toBeVisible();
  });

  test("an event that is over is history: no Add to calendar", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events/${OVER_ID}`);

    await expect(
      page.getByText("Old cluster retirement").first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("maintenance-calendar-add-event"),
    ).toHaveCount(0);
  });

  test("on the page's own domain the file is /maintenance.ics?event=", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `/scheduled-events/${UPCOMING_ID}`);

    await page.getByTestId("maintenance-calendar-add-event").click();

    expect(await href(page.getByTestId("maintenance-calendar-device"))).toBe(
      `${origin(page)}/maintenance.ics?event=${UPCOMING_ID}`,
    );
  });
});

test.describe("the status page's calendar dialogs", () => {
  test("fit a phone, the two options stacked, with nothing scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events`, 390);

    await page.getByTestId("maintenance-calendar-subscribe").click();
    await expect(
      page.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // In one frame: the dialog grows in as it opens (Modal, from 95%).
    const [google, device] = (await boxesInOneFrame([
      page.getByTestId("maintenance-calendar-google"),
      page.getByTestId("maintenance-calendar-device"),
    ])) as [FrameBox, FrameBox];

    expect(device.y).toBeGreaterThan(google.y);
    expect(Math.abs(device.x - google.x)).toBeLessThan(2);

    await shot(page, "status-page-phone-subscribe", page.getByTestId("modal"));
  });

  test("read in German", async ({ page }: { page: Page }) => {
    await open(page, `${PREVIEW}/scheduled-events?lang=de`);

    await expect(page.getByTestId("maintenance-calendar-subscribe")).toHaveText(
      "Kalender abonnieren",
    );
  });

  test("read in Persian, right to left, without spilling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${PREVIEW}/scheduled-events/${UPCOMING_ID}?lang=fa`);

    await page.getByTestId("maintenance-calendar-add-event").click();
    await expect(
      page.getByTestId("maintenance-calendar-event-dialog"),
    ).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(
      page,
      "status-page-persian-add-event",
      page.getByTestId("modal"),
    );
  });

  test("in the dark theme", async ({ page }: { page: Page }) => {
    await open(page, `${PREVIEW}/scheduled-events?theme=dark`);

    await page.getByTestId("maintenance-calendar-subscribe").click();
    await expect(
      page.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toBeVisible();

    await shot(page, "status-page-dark-subscribe", page.getByTestId("modal"));
  });
});

/*
 * Issue #5132, in a real browser. On a status page served over plain http
 * from a name that is not localhost - a self-hosted install reached by a LAN
 * hostname - the browser has no navigator.clipboard, and Copy link used to
 * say "Copied!" with nothing copied. These read the page from such a name
 * (status.calendar-copy.test, mapped to the fixture server), with the
 * browser's own clipboard (?clipboard=browser), and read the system
 * clipboard back from a page on a secure origin of the same browser: the
 * link has to be really there.
 */
test.describe("Copy link copies, or says it could not (issue #5132)", () => {
  const SENTINEL: string = "nothing copied yet";
  const COLOR_CHANNELS: RegExp = /\d+/g;

  // The fixture server, read from another name: same port, other host.
  function originOn(baseURL: string | undefined, host: string): string {
    const url: URL = new URL(baseURL || "http://127.0.0.1:4341");

    return `http://${host}:${url.port}`;
  }

  // The system clipboard, read (or written) from a secure page of the same browser.
  async function onSecurePage<T>(
    context: BrowserContext,
    action: (reader: Page) => Promise<T>,
  ): Promise<T> {
    const reader: Page = await context.newPage();

    try {
      // A plain file the fixture serves, on 127.0.0.1: a secure context.
      await reader.goto("/tailwind.js");
      await reader.bringToFront();
      return await action(reader);
    } finally {
      await reader.close();
    }
  }

  async function systemClipboard(context: BrowserContext): Promise<string> {
    return await onSecurePage(context, async (reader: Page) => {
      return await reader.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      });
    });
  }

  async function seedClipboard(context: BrowserContext): Promise<void> {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await onSecurePage(context, async (reader: Page) => {
      await reader.evaluate(async (text: string): Promise<void> => {
        await navigator.clipboard.writeText(text);
      }, SENTINEL);
    });
  }

  async function openSubscribeAt(
    page: Page,
    url: string,
    width: number,
  ): Promise<void> {
    await open(page, url, width);
    await page.bringToFront();
    await page.getByTestId("maintenance-calendar-subscribe").click();
    await expect(
      page.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toBeVisible();
  }

  async function clipboardOfThePage(
    page: Page,
  ): Promise<{ isSecure: boolean; hasClipboardApi: boolean }> {
    return await page.evaluate(() => {
      return {
        isSecure: window.isSecureContext,
        hasClipboardApi: Boolean(
          (navigator as unknown as { clipboard?: unknown }).clipboard,
        ),
      };
    });
  }

  for (const width of [1280, 390]) {
    test(`on a plain-http page with no clipboard API, the link really reaches the clipboard (${width}px)`, async ({
      page,
      context,
      baseURL,
    }: {
      page: Page;
      context: BrowserContext;
      baseURL: string | undefined;
    }) => {
      await seedClipboard(context);

      const origin: string = originOn(baseURL, STATUS_PAGE_PLAIN_HTTP_HOST);

      await openSubscribeAt(
        page,
        `${origin}${PREVIEW}/scheduled-events?clipboard=browser`,
        width,
      );

      // The case the issue is about: not a secure context, no clipboard API.
      expect(await clipboardOfThePage(page)).toEqual({
        isSecure: false,
        hasClipboardApi: false,
      });

      const link: string = `${origin}${PREVIEW}/maintenance.ics`;

      await expect(page.getByTestId("maintenance-calendar-url")).toHaveValue(
        link,
      );

      const copy: Locator = page.getByTestId("maintenance-calendar-copy");

      await copy.click();

      await expect(copy).toHaveText("Copied!");
      await expect(
        page.getByTestId("maintenance-calendar-copy-failed"),
      ).toHaveCount(0);
      // The browser's copy command took the focus for a moment and gave it back.
      await expect(copy).toBeFocused();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await shot(
        page,
        `status-page-copy-plain-http-${width}`,
        page.getByTestId("modal"),
      );

      expect(await systemClipboard(context)).toBe(link);
    });
  }

  test("on localhost, a secure context, it copies through the browser's clipboard API", async ({
    page,
    context,
    baseURL,
  }: {
    page: Page;
    context: BrowserContext;
    baseURL: string | undefined;
  }) => {
    await seedClipboard(context);

    const origin: string = originOn(baseURL, "localhost");

    await openSubscribeAt(
      page,
      `${origin}${PREVIEW}/scheduled-events?clipboard=browser`,
      1280,
    );

    expect(await clipboardOfThePage(page)).toEqual({
      isSecure: true,
      hasClipboardApi: true,
    });

    await page.getByTestId("maintenance-calendar-copy").click();

    await expect(page.getByTestId("maintenance-calendar-copy")).toHaveText(
      "Copied!",
    );
    expect(await systemClipboard(context)).toBe(
      `${origin}${PREVIEW}/maintenance.ics`,
    );
  });

  for (const width of [1280, 390]) {
    test(`refused both ways: it says so, never Copied!, and the link is selected to copy by hand (${width}px)`, async ({
      page,
      context,
      baseURL,
    }: {
      page: Page;
      context: BrowserContext;
      baseURL: string | undefined;
    }) => {
      await seedClipboard(context);

      // What the page says in its console: React's markup warnings included.
      const consoleErrors: Array<string> = [];

      page.on(
        "console",
        (message: { type: () => string; text: () => string }) => {
          if (message.type() === "error") {
            consoleErrors.push(message.text());
          }
        },
      );

      const origin: string = originOn(baseURL, STATUS_PAGE_PLAIN_HTTP_HOST);
      const link: string = `${origin}${PREVIEW}/maintenance.ics`;

      await openSubscribeAt(
        page,
        `${origin}${PREVIEW}/scheduled-events?clipboard=refused`,
        width,
      );

      const copy: Locator = page.getByTestId("maintenance-calendar-copy");
      const field: Locator = page.getByTestId("maintenance-calendar-url");

      await copy.click();

      const failed: Locator = page.getByTestId(
        "maintenance-calendar-copy-failed",
      );

      await expect(failed).toBeVisible();
      await expect(failed).toHaveText(
        "Your browser didn't let this page copy the link. It's selected above, so you can copy it yourself.",
      );
      await expect(copy).toHaveText("Copy link");
      // The link, focused and selected whole, ready for the keyboard.
      await expect(field).toBeFocused();
      expect(
        await field.evaluate((input: HTMLInputElement) => {
          return [input.selectionStart, input.selectionEnd, input.value.length];
        }),
      ).toEqual([0, link.length, link.length]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      /*
       * The line is markup React accepts: drawn in a <p>, its icon's <div>
       * made React warn "validateDOMNesting" in the console of every page.
       */
      expect(
        await failed.evaluate((element: Element) => {
          return element.tagName;
        }),
      ).toBe("DIV");
      expect(consoleErrors).toEqual([]);
      // Nothing reached the clipboard.
      expect(await systemClipboard(context)).toBe(SENTINEL);

      await shot(
        page,
        `status-page-copy-failed-${width}`,
        page.getByTestId("modal"),
      );

      // Copied by hand, as the line says: the selection is the whole link.
      await page.bringToFront();
      await field.press("ControlOrMeta+C");

      expect(await systemClipboard(context)).toBe(link);
    });
  }

  test("the failure line reads in the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSubscribeAt(
      page,
      `${PREVIEW}/scheduled-events?clipboard=refused&theme=dark`,
      1280,
    );

    await page.getByTestId("maintenance-calendar-copy").click();

    const failed: Locator = page.getByTestId(
      "maintenance-calendar-copy-failed",
    );

    await expect(failed).toBeVisible();

    // Light text on the dark dialog, not the light theme's dark amber.
    const color: string = await failed.evaluate((element: Element) => {
      return getComputedStyle(element).color;
    });
    const channels: Array<number> = (color.match(COLOR_CHANNELS) || [])
      .slice(0, 3)
      .map(Number);
    const brightness: number = channels.reduce(
      (sum: number, value: number): number => {
        return sum + value;
      },
      0,
    );

    expect(brightness).toBeGreaterThan(450);

    await shot(page, "status-page-copy-failed-dark", page.getByTestId("modal"));
  });

  test("the failure line is in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSubscribeAt(
      page,
      `${PREVIEW}/scheduled-events?clipboard=refused&lang=de`,
      1280,
    );

    await page.getByTestId("maintenance-calendar-copy").click();

    await expect(
      page.getByTestId("maintenance-calendar-copy-failed"),
    ).toHaveText(
      "Ihr Browser hat das Kopieren des Links nicht zugelassen. Der Link ist oben markiert, sodass Sie ihn selbst kopieren können.",
    );
    await expect(page.getByTestId("maintenance-calendar-copy")).toHaveText(
      "Link kopieren",
    );
  });
});
