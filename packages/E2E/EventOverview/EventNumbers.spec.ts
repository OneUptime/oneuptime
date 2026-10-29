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
 * The number before the title on every page of an incident, an alert, a
 * scheduled maintenance event and both kinds of episode: "INC-1042 Checkout
 * API p95 latency above 2s". Two of them can share a title - the fixture's
 * incidents #1042 and #1017 do, as a monitor's incidents do each time it
 * fails - and the page said "Incident - Checkout API p95 latency above 2s"
 * for both, in its heading, its trail and the browser tab.
 *
 * On the Event Overview fixture's real layouts (ModelPage, Page,
 * Breadcrumbs), with each project numbering of ?numbers=: as a project
 * without prefixes (#1042), as a new project (INC-1042), with long prefixes
 * of the project's own (CHECKOUT-INC-1042), a record numbered before numbers
 * carried their prefix (bare: #1042) and one with no number at all (none).
 * The number is never cut or wrapped away from the title; a long title
 * (?title=sentence) gives way instead - one line from 640px, two on a
 * phone - at 1280, 1024, 768 and 390 pixels, in the dark theme, in German
 * and in Persian read right to left (?dir=auto).
 *
 * The clock is pinned and the network fenced; afterEach fails a test on an
 * uncaught page error or on anything the fixture does not model.
 */

const PORT: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/event-overview-ui",
);

// The font the dashboard ships (views/index.ejs); the fixture does not load it.
const INTER_FONT_FILE: string = path.resolve(
  __dirname,
  "../../Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

const PRODUCTION_FONT_CSS: string =
  '@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(/dashboard/assets/fonts/InterVariable.woff2) format("woff2")} *{font-family:Inter,ui-sans-serif,system-ui,sans-serif}';

// The heading's line: text-xl leading-7.
const HEADING_LINE_HEIGHT: number = 28;

// A run of white space, the no-break space between number and title among it.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

// The numbers of an rgb()/rgba() colour.
const COLOUR_CHANNELS: RegExp = /[\d.]+/g;

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

interface EventKind {
  name: string;
  path: string;
  // The trail before the crumb that stands for the record.
  trail: Array<string>;
  // What the heading said before the record had a number: "Incident".
  kindTitle: string;
  title: string;
  // ?title=sentence.
  sentenceTitle: string;
  // The record's number in each of the fixture's numberings.
  numbers: { default: string; prefixed: string; custom: string };
}

const INCIDENT: EventKind = {
  name: "incident",
  path: `${DASHBOARD}/incidents/${uuid("20000000", 1042)}`,
  trail: ["Project", "Incidents"],
  kindTitle: "Incident",
  title: "Checkout API p95 latency above 2s",
  sentenceTitle:
    "Checkout API p95 latency above 2s for EU customers after release 2026.09.14-2 started with a smaller database connection pool",
  numbers: {
    default: "#1042",
    prefixed: "INC-1042",
    custom: "CHECKOUT-INC-1042",
  },
};

const ALERT: EventKind = {
  name: "alert",
  path: `${DASHBOARD}/alerts/${uuid("30000000", 311)}`,
  trail: ["Project", "Alerts"],
  kindTitle: "Alert",
  title: "Payment webhook 5xx rate above 5%",
  sentenceTitle:
    "Payment webhook 5xx rate above 5% for card payments from the EU storefront while the payment provider retried its callbacks",
  numbers: {
    default: "#311",
    prefixed: "ALT-311",
    custom: "PAYMENTS-ALT-311",
  },
};

const SCHEDULED_MAINTENANCE: EventKind = {
  name: "scheduled-maintenance",
  path: `${DASHBOARD}/scheduled-maintenance-events/${uuid("40000000", 58)}`,
  trail: ["Project", "Scheduled Maintenance Events"],
  kindTitle: "Scheduled Event",
  title: "Primary database failover drill",
  sentenceTitle:
    "Primary database failover drill for the orders database in eu-west-1, moving every checkout connection to its standby and back",
  numbers: {
    default: "#58",
    prefixed: "SM-58",
    custom: "DB-MAINTENANCE-58",
  },
};

const INCIDENT_EPISODE: EventKind = {
  name: "incident-episode",
  path: `${DASHBOARD}/incidents/episodes/${uuid("50000000", 12)}`,
  trail: ["Project", "Incidents", "Episodes"],
  kindTitle: "Episode",
  title: "Checkout degradation — Sep 14",
  sentenceTitle:
    "Checkout degradation — Sep 14: four checkout incidents opened within 30 minutes of each other across the EU and US storefronts",
  numbers: {
    default: "#12",
    prefixed: "IE-12",
    custom: "CHECKOUT-EP-12",
  },
};

const ALERT_EPISODE: EventKind = {
  name: "alert-episode",
  path: `${DASHBOARD}/alerts/episodes/${uuid("60000000", 7)}`,
  trail: ["Project", "Alerts", "Episodes"],
  kindTitle: "Episode",
  title: "Payment webhook failures — Sep 14",
  sentenceTitle:
    "Payment webhook failures — Sep 14: five payment webhook alerts from the same monitor group while the provider retried its callbacks",
  numbers: {
    default: "#7",
    prefixed: "AE-7",
    custom: "PAYMENTS-EP-7",
  },
};

const EVENT_KINDS: ReadonlyArray<EventKind> = [
  INCIDENT,
  ALERT,
  SCHEDULED_MAINTENANCE,
  INCIDENT_EPISODE,
  ALERT_EPISODE,
];

// Incident #1017: resolved before #1042, with the very same title.
const EARLIER_INCIDENT_PATH: string = `${DASHBOARD}/incidents/${uuid("20000000", 1017)}`;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing the page asks for may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    await route.abort();
  });

  // The dashboard's own font, so the heading is measured as it is drawn.
  await page.route(
    "**/dashboard/assets/fonts/InterVariable.woff2",
    async (route: PlaywrightRoute) => {
      await route.fulfill({ path: INTER_FONT_FILE });
    },
  );

  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __eventOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__eventOverviewFixture;
      return JSON.parse(JSON.stringify(state?.unhandled || []));
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

interface OpenOptions {
  width?: number;
  numbers?: "prefixed" | "custom" | "bare" | "none";
  title?: "sentence";
  lang?: "de" | "fa";
  theme?: "dark";
}

// Opens a record's page and waits for its heading to name the record.
async function open(
  page: Page,
  pagePath: string,
  options: OpenOptions = {},
): Promise<void> {
  const width: number = options.width || 1280;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const query: URLSearchParams = new URLSearchParams();
  if (options.numbers) {
    query.set("numbers", options.numbers);
  }
  if (options.title) {
    query.set("title", options.title);
  }
  if (options.lang) {
    query.set("lang", options.lang);
    // As the Dashboard does: Persian is read right to left.
    query.set("dir", "auto");
  }
  if (options.theme) {
    query.set("theme", options.theme);
  }
  await page.goto(
    `${pagePath}${query.toString() ? `?${query.toString()}` : ""}`,
  );
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  // The record is read: its crumb names it.
  await expect(page.getByTestId("breadcrumb-record-name")).toBeVisible({
    timeout: 30000,
  });
  await page.addStyleTag({ content: PRODUCTION_FONT_CSS });
  expect(
    await page.evaluate(async (): Promise<number> => {
      return (await document.fonts.load("600 20px Inter")).length;
    }),
    "Inter loaded",
  ).toBeGreaterThan(0);
}

function heading(page: Page): Locator {
  return page.getByRole("heading", { level: 1 });
}

function headingNumber(page: Page): Locator {
  return page.getByTestId("page-record-number");
}

function headingName(page: Page): Locator {
  return page.getByTestId("page-record-name");
}

function trail(page: Page): Locator {
  return page.getByRole("navigation", { name: "Breadcrumb" });
}

function crumbNumber(page: Page): Locator {
  return page.getByTestId("breadcrumb-record-number");
}

async function trailTexts(page: Page): Promise<Array<string>> {
  const texts: Array<string> = await trail(page)
    .getByRole("listitem")
    .evaluateAll((items: Array<Element>): Array<string> => {
      return items.map((item: Element): string => {
        return item.textContent || "";
      });
    });

  return texts.map((text: string): string => {
    return text.replace(WHITE_SPACE_RUN, " ").trim();
  });
}

async function boxOf(locator: Locator): Promise<Box> {
  return locator.evaluate((element: Element): Box => {
    const rect: DOMRect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    };
  });
}

// Whether an element cuts its own content off (a clamp or a truncation).
async function cutsItself(locator: Locator): Promise<boolean> {
  return locator.evaluate((element: Element): boolean => {
    return (
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1
    );
  });
}

/*
 * Every piece of the number drawn whole: the boxes of its letters, as the
 * browser lays them out, all inside the heading's (or the crumb's) box.
 */
async function isDrawnWhole(number: Locator, within: Locator): Promise<boolean> {
  const outer: Box = await boxOf(within);
  const rects: Array<{ left: number; right: number }> = await number.evaluate(
    (element: Element): Array<{ left: number; right: number }> => {
      const range: Range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects()).map((rect: DOMRect) => {
        return { left: rect.left, right: rect.right };
      });
    },
  );

  return (
    rects.length === 1 &&
    rects.every((rect: { left: number; right: number }): boolean => {
      return rect.left >= outer.x - 0.5 && rect.right <= outer.right + 0.5;
    })
  );
}

// The lines the heading's text is drawn on.
async function headingLines(page: Page): Promise<number> {
  const box: Box = await boxOf(heading(page));
  return Math.round(box.height / HEADING_LINE_HEIGHT);
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

async function screenshotHeader(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  const top: Box = await boxOf(trail(page));
  const bottom: Box = await boxOf(heading(page));
  const width: number = page.viewportSize()!.width;
  await page.screenshot({
    path: path.join(SCREENSHOTS, `event-number-${name}-synthetic.png`),
    animations: "disabled",
    clip: {
      x: 0,
      y: Math.max(0, top.y - 16),
      width,
      height: bottom.bottom - top.y + 32,
    },
  });
}

// WCAG's relative luminance of an rgb()/rgba() colour, its alpha left out.
function relativeLuminance(color: string): number {
  const channels: Array<number> = (color.match(COLOUR_CHANNELS) || [])
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
}

function contrastRatio(foreground: string, background: string): number {
  const first: number = relativeLuminance(foreground);
  const second: number = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

// The colour a piece of text is drawn in, and the colour it is drawn on.
async function colours(
  locator: Locator,
): Promise<{ text: string; background: string }> {
  return locator.evaluate(
    (element: Element): { text: string; background: string } => {
      let surface: Element | null = element;
      let background: string = "rgba(0, 0, 0, 0)";

      while (surface) {
        const fill: string = window.getComputedStyle(surface).backgroundColor;
        if (fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") {
          background = fill;
          break;
        }
        surface = surface.parentElement;
      }

      return { text: window.getComputedStyle(element).color, background };
    },
  );
}

test.describe("each kind of event is headed by its number, then its title", () => {
  for (const kind of EVENT_KINDS) {
    test(`${kind.name}: the heading, the trail and the tab lead with ${kind.numbers.prefixed}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, kind.path, { numbers: "prefixed" });
      const named: string = `${kind.numbers.prefixed} ${kind.title}`;

      await expect(heading(page)).toHaveText(named);
      await expect(headingNumber(page)).toHaveText(kind.numbers.prefixed);
      await expect(headingName(page)).toHaveText(kind.title);
      // The kind is said once, by the trail: "Incident -" is gone.
      await expect(heading(page)).not.toContainText(`${kind.kindTitle} -`);
      // The whole of it under the pointer.
      await expect(heading(page)).toHaveAttribute("title", named);

      // The number is read first, and drawn first.
      const number: Box = await boxOf(headingNumber(page));
      const name: Box = await boxOf(headingName(page));
      expect(number.right, "number before the title").toBeLessThanOrEqual(
        name.x,
      );

      // The crumb that stands for the record names it the same way.
      expect(await trailTexts(page)).toEqual([...kind.trail, named]);
      await expect(crumbNumber(page)).toHaveText(kind.numbers.prefixed);

      // And so does the browser tab.
      await expect(page).toHaveTitle(
        `OneUptime | ${kind.trail.join(" - ")} - ${named}`,
      );

      // The header card under it says the same number.
      await expect(page.getByTestId("event-header-number")).toHaveText(
        kind.numbers.prefixed,
      );

      await screenshotHeader(page, `${kind.name}-prefixed-1280`);
    });
  }

  test("a project without prefixes: #1042 before the title, in the heading, the trail and the tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const kind of EVENT_KINDS) {
      await open(page, kind.path);
      const named: string = `${kind.numbers.default} ${kind.title}`;

      await expect(heading(page), kind.name).toHaveText(named);
      await expect(headingNumber(page), kind.name).toHaveText(
        kind.numbers.default,
      );
      expect(await trailTexts(page), kind.name).toEqual([...kind.trail, named]);
      await expect(page, kind.name).toHaveTitle(
        `OneUptime | ${kind.trail.join(" - ")} - ${named}`,
      );
    }
  });

  test("prefixes of the project's own, however long, are drawn whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const kind of EVENT_KINDS) {
      await open(page, kind.path, { numbers: "custom", title: "sentence" });

      await expect(headingNumber(page), kind.name).toHaveText(
        kind.numbers.custom,
      );
      await expect(heading(page), kind.name).toHaveText(
        `${kind.numbers.custom} ${kind.sentenceTitle}`,
      );
      expect(
        await isDrawnWhole(headingNumber(page), heading(page)),
        `${kind.name}: the number whole`,
      ).toBe(true);
      expect(
        await isDrawnWhole(crumbNumber(page), page.getByTestId("breadcrumb-record-name")),
        `${kind.name}: the crumb's number whole`,
      ).toBe(true);
    }

    await screenshotHeader(page, "custom-prefix-1280");
  });

  test("a record numbered before numbers kept their prefix reads #1042", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const kind of [INCIDENT, SCHEDULED_MAINTENANCE, ALERT_EPISODE]) {
      await open(page, kind.path, { numbers: "bare" });

      await expect(headingNumber(page), kind.name).toHaveText(
        kind.numbers.default,
      );
      await expect(heading(page), kind.name).toHaveText(
        `${kind.numbers.default} ${kind.title}`,
      );
      await expect(crumbNumber(page), kind.name).toHaveText(
        kind.numbers.default,
      );
    }
  });

  test("a record with no number reads as it always did", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const kind of EVENT_KINDS) {
      await open(page, kind.path, { numbers: "none" });

      await expect(heading(page), kind.name).toHaveText(
        `${kind.kindTitle} - ${kind.title}`,
      );
      await expect(headingNumber(page), kind.name).toHaveCount(0);
      await expect(crumbNumber(page), kind.name).toHaveCount(0);
      expect(await trailTexts(page), kind.name).toEqual([
        ...kind.trail,
        kind.title,
      ]);
      await expect(page, kind.name).toHaveTitle(
        `OneUptime | ${kind.trail.join(" - ")} - ${kind.title}`,
      );
    }
  });
});

test.describe("two events with one title", () => {
  test("incidents #1042 and #1017 share a title, and their pages no longer read the same", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT.path, { numbers: "prefixed" });
    await expect(heading(page)).toHaveText(
      "INC-1042 Checkout API p95 latency above 2s",
    );
    const first: string = await page.title();

    // The earlier one is numbered #1017: it was numbered before the prefix.
    await open(page, EARLIER_INCIDENT_PATH, { numbers: "prefixed" });
    await expect(heading(page)).toHaveText(
      "#1017 Checkout API p95 latency above 2s",
    );
    await expect(headingName(page)).toHaveText(INCIDENT.title);

    expect(first).toBe(
      "OneUptime | Project - Incidents - INC-1042 Checkout API p95 latency above 2s",
    );
    expect(await page.title()).toBe(
      "OneUptime | Project - Incidents - #1017 Checkout API p95 latency above 2s",
    );
    expect(await trailTexts(page)).toEqual([
      "Project",
      "Incidents",
      "#1017 Checkout API p95 latency above 2s",
    ]);
  });
});

test.describe("a long title gives way; the number never does", () => {
  test("at 1280px the heading is one line: the number whole, the title cut short at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const kind of EVENT_KINDS) {
      await open(page, kind.path, { numbers: "prefixed", title: "sentence" });
      const at: string = `${kind.name} 1280px`;

      expect(await headingLines(page), `${at}: one line`).toBe(1);
      expect(
        await isDrawnWhole(headingNumber(page), heading(page)),
        `${at}: the number whole`,
      ).toBe(true);
      expect(await cutsItself(headingNumber(page)), `${at}: number`).toBe(
        false,
      );
      expect(await cutsItself(headingName(page)), `${at}: title cut`).toBe(
        true,
      );
      // Cut at its end: it still starts right after the number.
      const number: Box = await boxOf(headingNumber(page));
      const name: Box = await boxOf(headingName(page));
      expect(name.x - number.right, `${at}: one space between`).toBeLessThan(
        10,
      );
      // The title reaches the heading's end, and no further.
      expect(
        Math.abs(name.right - (await boxOf(heading(page))).right),
        `${at}: title to the end of the line`,
      ).toBeLessThanOrEqual(1);
      await expect(heading(page), at).toHaveAttribute(
        "title",
        `${kind.numbers.prefixed} ${kind.sentenceTitle}`,
      );

      // The crumb: its number whole, its name cut short.
      expect(
        await isDrawnWhole(
          crumbNumber(page),
          page.getByTestId("breadcrumb-record-name"),
        ),
        `${at}: the crumb's number whole`,
      ).toBe(true);
      expect(await pageOverflow(page), `${at}: no sideways scroll`).toBe(0);
    }

    await screenshotHeader(page, "sentence-title-1280");
  });

  for (const width of [1024, 768]) {
    test(`beside the side menu at ${width}px: one line, the number whole`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, INCIDENT.path, {
        width,
        numbers: "custom",
        title: "sentence",
      });

      expect(await headingLines(page)).toBe(1);
      expect(await isDrawnWhole(headingNumber(page), heading(page))).toBe(
        true,
      );
      expect(await cutsItself(headingName(page))).toBe(true);
      expect(await pageOverflow(page)).toBe(0);

      await screenshotHeader(page, `sentence-title-${width}`);
    });
  }

  test("on a 390px phone the number starts the heading and the title runs on after it, two lines at most", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const kind of EVENT_KINDS) {
      await open(page, kind.path, {
        width: 390,
        numbers: "custom",
        title: "sentence",
      });
      const at: string = `${kind.name} 390px`;

      expect(await headingLines(page), `${at}: two lines`).toBe(2);
      // The title is longer than two lines: it is clamped.
      expect(await cutsItself(heading(page)), `${at}: clamped`).toBe(true);

      const box: Box = await boxOf(heading(page));
      const number: Box = await boxOf(headingNumber(page));
      // The number on the first line, at its start, whole.
      expect(
        Math.abs(number.x - box.x),
        `${at}: at the start`,
      ).toBeLessThanOrEqual(1);
      expect(
        number.y - box.y,
        `${at}: on the first line`,
      ).toBeLessThan(HEADING_LINE_HEIGHT / 2);
      expect(
        await isDrawnWhole(headingNumber(page), heading(page)),
        `${at}: the number whole`,
      ).toBe(true);

      // The title's first word shares the number's line.
      const firstLineTop: number = await headingName(page).evaluate(
        (element: Element): number => {
          const range: Range = document.createRange();
          range.selectNodeContents(element);
          return range.getClientRects()[0]!.top;
        },
      );
      expect(
        Math.abs(firstLineTop - number.y),
        `${at}: the title starts beside the number`,
      ).toBeLessThan(HEADING_LINE_HEIGHT / 2);

      expect(await pageOverflow(page), `${at}: no sideways scroll`).toBe(0);
    }

    await screenshotHeader(page, "sentence-title-390");
  });
});

test.describe("in the dark theme and in other languages", () => {
  test("dark: the number quieter than the title, both readable", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT.path, {
      numbers: "prefixed",
      title: "sentence",
      theme: "dark",
    });

    const number: { text: string; background: string } = await colours(
      headingNumber(page),
    );
    const name: { text: string; background: string } = await colours(
      headingName(page),
    );

    // Large text (20px semibold): 3:1 at least; the title well past it.
    expect(
      contrastRatio(number.text, number.background),
    ).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(name.text, name.background)).toBeGreaterThanOrEqual(
      7,
    );
    // The number is the quieter of the two.
    expect(contrastRatio(number.text, number.background)).toBeLessThan(
      contrastRatio(name.text, name.background),
    );
    expect(relativeLuminance(number.background)).toBeLessThan(0.05);

    await screenshotHeader(page, "dark-1280");
  });

  test("light: the number quieter than the title, both readable", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT.path, { numbers: "prefixed" });

    const number: { text: string; background: string } = await colours(
      headingNumber(page),
    );
    const name: { text: string; background: string } = await colours(
      headingName(page),
    );

    expect(
      contrastRatio(number.text, number.background),
    ).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(name.text, name.background)).toBeGreaterThanOrEqual(
      7,
    );
    expect(contrastRatio(number.text, number.background)).toBeLessThan(
      contrastRatio(name.text, name.background),
    );
  });

  test("German: the trail and the tab in German, the number and the title as written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT.path, { numbers: "prefixed", lang: "de" });

    await expect(heading(page)).toHaveText(
      "INC-1042 Checkout API p95 latency above 2s",
    );
    expect(await trailTexts(page)).toEqual([
      "Projekt",
      "Vorfälle",
      "INC-1042 Checkout API p95 latency above 2s",
    ]);
    await expect(page).toHaveTitle(
      "OneUptime | Projekt - Vorfälle - INC-1042 Checkout API p95 latency above 2s",
    );

    await screenshotHeader(page, "de-1280");
  });

  test("German, without a number: the heading names its kind in German, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT.path, { numbers: "none", lang: "de" });

    await expect(heading(page)).toHaveText(
      "Vorfall - Checkout API p95 latency above 2s",
    );
  });

  for (const width of [1280, 390]) {
    test(`Persian at ${width}px, read right to left: the number starts the heading on the right, an English title reads from its start`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, INCIDENT.path, {
        width,
        numbers: "prefixed",
        title: "sentence",
        lang: "fa",
      });
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

      const box: Box = await boxOf(heading(page));
      const number: Box = await boxOf(headingNumber(page));

      // The start of the line is on the right.
      expect(Math.abs(number.right - box.right)).toBeLessThanOrEqual(1);
      expect(await isDrawnWhole(headingNumber(page), heading(page))).toBe(
        true,
      );
      // The title is an English one, kept the way it is written.
      await expect(headingName(page)).toHaveAttribute("dir", "ltr");
      await expect(headingNumber(page)).toHaveText("INC-1042");

      if (width === 1280) {
        // One line, the title on the number's left, cut at its own end.
        expect(await headingLines(page)).toBe(1);
        const name: Box = await boxOf(headingName(page));
        expect(name.right).toBeLessThanOrEqual(number.x + 0.5);
        expect(number.x - name.right).toBeLessThan(10);
        expect(await cutsItself(headingName(page))).toBe(true);
        // Its first words are on screen: the cut is at the far end.
        const firstWord: { left: number } = await headingName(page).evaluate(
          (element: Element): { left: number } => {
            const range: Range = document.createRange();
            const text: Node = element.firstChild!;
            range.setStart(text, 0);
            range.setEnd(text, "Checkout".length);
            return { left: range.getBoundingClientRect().left };
          },
        );
        expect(firstWord.left).toBeGreaterThanOrEqual(box.x - 0.5);
      } else {
        expect(await headingLines(page)).toBe(2);
        expect(number.y - box.y).toBeLessThan(HEADING_LINE_HEIGHT / 2);
      }

      // The crumb: the number on the right of the title, whole.
      const crumbNumberBox: Box = await boxOf(crumbNumber(page));
      const crumbName: Box = await boxOf(
        page
          .getByTestId("breadcrumb-record-name")
          .locator("bdi")
          .nth(1),
      );
      expect(crumbName.right).toBeLessThanOrEqual(crumbNumberBox.x + 0.5);
      expect(
        await isDrawnWhole(
          crumbNumber(page),
          page.getByTestId("breadcrumb-record-name"),
        ),
      ).toBe(true);

      await expect(page).toHaveTitle(
        `OneUptime | پروژه - حوادث - INC-1042 ${INCIDENT.sentenceTitle}`,
      );
      expect(await pageOverflow(page)).toBe(0);

      await screenshotHeader(page, `fa-rtl-${width}`);
    });
  }
});
