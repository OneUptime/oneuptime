import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * "How OneUptime works", always one click away, and a word's definition
 * where it is used (#6819), in a real browser with production's CSS: Help
 * starts with the ways to learn; Help and Home's Explore OneUptime open How
 * OneUptime works in a dialog; its words "Telemetry" and "Infrastructure"
 * show their Glossary definitions on hover, focus and tap.
 *
 * The definitions are the docs' own: the glossary route's answer is built
 * here from the real Glossary pages (Docs/Content/<lang>/introduction/
 * glossary.md), each term's first paragraph under its heading, by the
 * English term in its place - what /docs/glossary/<lang>.json serves.
 * Nothing else may leave the fixture server.
 */

const PORT: string = process.env["HOME_OVERVIEW_FIXTURE_PORT"] || "4224";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const HOME: string = `/dashboard/${PROJECT_ID}/home/`;
const DOCS_HOST: string = "oneuptime.acme-commerce.example";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/home-overview-ui",
);

const CONTENT: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Docs/Content",
);

interface GlossaryEntry {
  id: string;
  term: string;
  definition: string;
}

// A heading's anchor, as the docs make it from an English heading.
const anchorOf: (heading: string) => string = (heading: string): string => {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
};

// The terms of a Glossary page, each with its first paragraph.
const termsOf: (markdown: string) => Array<{ term: string; text: string }> = (
  markdown: string,
): Array<{ term: string; text: string }> => {
  return markdown
    .split("\n### ")
    .slice(1)
    .map((block: string): { term: string; text: string } => {
      const lines: Array<string> = block.split("\n");
      const paragraph: string =
        block.split("\n\n")[1]?.replace(/\*\*/g, "").trim() || "";

      return { term: lines[0]!.trim(), text: paragraph };
    });
};

const glossaryFor: (lang: string) => Array<GlossaryEntry> = (
  lang: string,
): Array<GlossaryEntry> => {
  const english: Array<{ term: string; text: string }> = termsOf(
    readFileSync(path.join(CONTENT, "en/introduction/glossary.md"), "utf8"),
  );
  const translated: Array<{ term: string; text: string }> = termsOf(
    readFileSync(
      path.join(CONTENT, `${lang}/introduction/glossary.md`),
      "utf8",
    ),
  );

  return translated.map(
    (entry: { term: string; text: string }, index: number): GlossaryEntry => {
      return {
        id: anchorOf(english[index]!.term),
        term: entry.term,
        definition: entry.text,
      };
    },
  );
};

/*
 * The product reads the glossary from its own origin (DOCS_URL is the
 * Dashboard's host). The fixture is served from 127.0.0.1 while its HOST is
 * a made-up domain, and its page allows reads from itself alone
 * (connect-src 'self'): the browser is told to set that aside here, and
 * the route above answers the read.
 */
test.use({ bypassCSP: true });

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();
const glossaryReads: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  const reads: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  glossaryReads.set(page, reads);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    // The docs' glossary route, on this instance's own host.
    const glossary: RegExpMatchArray | null = target.pathname.match(
      /^\/docs\/glossary\/([\w-]+)\.json$/,
    );

    if (target.hostname === DOCS_HOST && glossary) {
      reads.push(glossary[1]!);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        /*
         * The product reads it on its own origin; the fixture is served
         * from another, so the answer allows that one.
         */
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          lang: glossary[1],
          entries: glossaryFor(glossary[1]!),
        }),
      });
      return;
    }

    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);
});

async function open(page: Page, query: string = ""): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${HOME}${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByTestId("home-explore-products")).toBeVisible({
    timeout: 30000,
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: false,
    animations: "disabled",
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("how-oneuptime-works-dialog");
}

async function openFromHelp(page: Page, helpName: string): Promise<void> {
  await page.getByRole("button", { name: helpName }).click();
  await page.getByTestId("help-learn").locator("a").nth(1).click();
  await expect(dialog(page)).toBeVisible();
}

function word(page: Page, term: string): Locator {
  return dialog(page).locator(`[data-glossary-term="${term}"]`);
}

function popover(page: Page): Locator {
  return page.getByTestId("defined-term-popover");
}

test.describe("Help starts with learning", () => {
  test("the Quickstart, How OneUptime works, the Glossary, the docs, then the ways to ask", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);

    await page.getByRole("button", { name: "Help" }).click();

    const learn: Locator = page.getByTestId("help-learn");

    await expect(learn.locator("a")).toHaveText([
      "Quickstart",
      "How OneUptime works",
      "Glossary",
      "Documentation",
    ]);
    await expect(learn.locator("a").nth(0)).toHaveAttribute(
      "href",
      `https://${DOCS_HOST}/docs/en/introduction/quickstart`,
    );
    await expect(learn.locator("a").nth(2)).toHaveAttribute(
      "href",
      `https://${DOCS_HOST}/docs/en/introduction/glossary`,
    );
    await expect(page.getByTestId("help-ask")).toContainText(
      "Keyboard shortcuts",
    );

    await screenshot(page, "help-menu");
  });
});

test.describe("How OneUptime works, from Help", () => {
  test("opens on any page, with its four steps, what feeds them and the docs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    await openFromHelp(page, "Help");

    await expect(dialog(page).getByRole("listitem")).toHaveCount(4);
    await expect(
      dialog(page).getByTestId("how-oneuptime-works-feeds"),
    ).toContainText("feed the loop");
    await expect(
      dialog(page).getByTestId("how-oneuptime-works-docs-core-concepts"),
    ).toHaveAttribute(
      "href",
      `https://${DOCS_HOST}/docs/en/introduction/core-concepts`,
    );

    // The word is drawn with a dotted line under it.
    const telemetry: Locator = word(page, "telemetry");
    expect(
      await telemetry.evaluate((element: Element): string => {
        return getComputedStyle(element).textDecorationStyle;
      }),
    ).toBe("dotted");

    await screenshot(page, "how-oneuptime-works-dialog");
  });

  test("a word shows the Glossary page's definition on hover, and Read more opens the term", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    await openFromHelp(page, "Help");

    await word(page, "telemetry").hover();

    const expected: GlossaryEntry = glossaryFor("en").find(
      (entry: GlossaryEntry): boolean => {
        return entry.id === "telemetry";
      },
    )!;

    await expect(page.getByTestId("defined-term-definition")).toHaveText(
      expected.definition,
    );
    await expect(popover(page)).toContainText(expected.term);
    await expect(page.getByTestId("defined-term-read-more")).toHaveAttribute(
      "href",
      `https://${DOCS_HOST}/docs/en/introduction/glossary#telemetry`,
    );
    expect(glossaryReads.get(page)).toEqual(["en"]);

    // The popover is on screen, beside its word.
    const box: { x: number; y: number; width: number; height: number } | null =
      await popover(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);

    await screenshot(page, "definition-on-hover");
  });

  test("the keyboard reaches the word and its Read more, and Escape puts it away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    await openFromHelp(page, "Help");

    /*
     * From the keyboard: Help was opened with the mouse, so a key goes
     * down first, as when someone tabs through the dialog.
     */
    await page.keyboard.press("Shift");
    await word(page, "telemetry").focus();
    await expect(page.getByTestId("defined-term-definition")).toBeVisible();
    await page.keyboard.press("Escape");
    // Escape put the definition away, not the dialog.
    await expect(dialog(page)).toBeVisible();
    /*
     * Put away: hidden at once, and gone from the page once its fade has run
     * (DefinedTerm hides in 150 ms). Until then it is still there, and the
     * next word's definition, shown the moment that word has focus, would be
     * one of two.
     */
    await expect(popover(page)).toHaveCount(0);
    // Past Telemetry (its popover is put away), on to Infrastructure.
    await page.keyboard.press("Tab");
    await expect(word(page, "infrastructure")).toBeFocused();

    await expect(page.getByTestId("defined-term-definition")).toBeVisible();
    await expect(word(page, "infrastructure")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("defined-term-read-more")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(popover(page)).toBeHidden();
    // Escape put the definition away, not the dialog.
    await expect(dialog(page)).toBeVisible();
  });
});

test.describe("How OneUptime works, from Home", () => {
  test("on a phone, from Explore OneUptime, a tap shows a definition that fits the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);

    await page.getByTestId("home-how-oneuptime-works").click();
    await expect(dialog(page)).toBeVisible();

    await word(page, "infrastructure")
      .tap()
      .catch(async () => {
        await word(page, "infrastructure").click();
      });

    await expect(page.getByTestId("defined-term-definition")).toBeVisible();

    const box: { x: number; width: number } | null =
      await popover(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expectNoSidewaysScroll(page);

    await screenshot(page, "how-oneuptime-works-phone");
  });

  test("in the dark, it reads as the rest of the product does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "theme=dark");

    await page.getByTestId("home-how-oneuptime-works").click();
    await word(page, "telemetry").hover();
    await expect(page.getByTestId("defined-term-definition")).toBeVisible();

    await screenshot(page, "how-oneuptime-works-dark");
  });

  test("in German, every word and definition is German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "lang=de");

    await openFromHelp(page, "Hilfe");
    await expect(page.getByRole("dialog")).toContainText(
      "So funktioniert OneUptime",
    );

    await word(page, "telemetry").hover();

    const expected: GlossaryEntry = glossaryFor("de").find(
      (entry: GlossaryEntry): boolean => {
        return entry.id === "telemetry";
      },
    )!;

    await expect(page.getByTestId("defined-term-definition")).toHaveText(
      expected.definition,
    );
    await expect(page.getByTestId("defined-term-read-more")).toHaveText(
      /Mehr lesen/,
    );
    expect(glossaryReads.get(page)).toEqual(["de"]);

    await screenshot(page, "how-oneuptime-works-de");
  });

  test("in Persian, the page and the definition read right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.getByTestId("home-how-oneuptime-works").click();
    await word(page, "telemetry").hover();

    const definition: Locator = page.getByTestId("defined-term-definition");

    await expect(definition).toBeVisible();
    expect(
      await definition.evaluate((element: Element): string => {
        return getComputedStyle(element).direction;
      }),
    ).toBe("rtl");

    await screenshot(page, "how-oneuptime-works-fa");
  });
});
