import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE MONITOR CRITERIA EDITOR ON A PHONE, IN A REAL BROWSER.
 *
 * "The criteria editor on phones is still nested several boxes deep: a
 * redesign." (the maintainer's follow-up to #5292). At 390px an alert's
 * fields sat in the page's card, the step's Monitor Criteria card, the
 * criteria's box, the Actions section and the action's own box - each a
 * frame with its padding - and the alert's description editor was 166px
 * wide inside its fold.
 *
 * The step's cards (Monitor Target, Test Monitor, Criteria) are
 * sections of the page's card - a rule above each, no frame - at every
 * width: below sm since #5482, and from sm up too, where they were cards
 * inside the page's card. Below sm the criteria's box is the one frame
 * round its fields: Filters, Actions and Settings, each filter's box and
 * each action's box reach out to its sides as bands. From sm up the
 * criteria editor inside the section is the one it always was.
 *
 * The production Create page, the production Tailwind build and Theme.css,
 * against the offline fixture (Fixture/Fixture.js), with the same guards as
 * CreateMonitor.spec.ts: a network fence, no uncaught page errors, and no
 * request the fixture does not model. What jsdom cannot show is measured
 * here: the boxes as drawn, their widths, the dark theme, Persian.
 */

// The fixture server's port: MONITOR_OVERVIEW_FIXTURE_PORT, as the config and server.js read it.
const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;
const TEMPLATES_PATH: string = `/dashboard/${PROJECT_ID}/monitors/settings/templates`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const STEP_CARDS: Array<string> = [
  "Monitor Target",
  "Test Monitor",
  "Criteria",
];

const WHITE_RGB: string = "rgb(255, 255, 255)";
// Tailwind's default border colour, gray-200: light on a dark page.
const LIGHT_BORDER_RGB: string = "rgb(229, 231, 235)";
const BLUE_500_RGB: string = "rgb(59, 130, 246)";

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
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

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// Waits until no finite animation or transition is running.
async function atRest(page: Page): Promise<void> {
  await page.waitForFunction((): boolean => {
    return document.getAnimations().every((animation: Animation): boolean => {
      return (
        animation.playState !== "running" ||
        animation.effect?.getTiming().iterations === Infinity
      );
    });
  });
}

/*
 * Create Monitor's criteria step for a Website monitor, its first criteria
 * open with every action switched on: the status, the alert, the incident.
 * The query picks the theme or the language (?theme=dark, ?lang=fa).
 */
async function openCriteria(page: Page, query: string = ""): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${CREATE_PATH}${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const form: Locator = page.locator("#create-monitor-form");
  await expect(form).toBeVisible({ timeout: 60000 });

  await page.getByTestId("card-select-option-Website").click();
  await form.locator("input").first().fill("Storefront");
  await form.getByTestId("form-next-button").click();

  const box: Locator = page.getByTestId("monitor-criteria-box").first();
  await expect(box).toBeVisible({ timeout: 60000 });

  const toggle: Locator = box
    .getByTestId("monitor-criteria-header")
    .locator("button[aria-expanded]")
    .first();

  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }

  const body: Locator = box.getByTestId("monitor-criteria-body");
  await expect(body).toBeVisible();

  // The Actions section (the second) open, and its three switches on.
  const actions: Locator = body
    .locator("[role='button'][aria-controls^='collapsible-body-']")
    .nth(1);

  if ((await actions.getAttribute("aria-expanded")) === "false") {
    await actions.click();
  }

  for (const index of [0, 1, 2]) {
    const actionSwitch: Locator = body.getByRole("switch").nth(index);

    if ((await actionSwitch.getAttribute("aria-checked")) !== "true") {
      await actionSwitch.click();
    }

    await expect(actionSwitch).toHaveAttribute("aria-checked", "true");
  }

  await expect(box.getByTestId("monitor-criteria-alert-form")).toBeVisible();
  await expect(box.getByTestId("monitor-criteria-incident-form")).toBeVisible();
  await atRest(page);

  return box;
}

// A card's title, by its whole text.
function cardHeading(page: Page, title: string): Locator {
  return page
    .locator(
      `xpath=//*[@data-testid='card-details-heading' and normalize-space(.)='${title}']`,
    )
    .first();
}

// A step card by its title: the element that carries the frame.
function stepCardFrame(page: Page, title: string): Locator {
  return cardHeading(page, title).locator(
    "xpath=ancestor::div[@data-testid='card'][1]/div[1]",
  );
}

interface DrawnBox {
  left: number;
  right: number;
  width: number;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
  radius: number;
  shadow: string;
  background: string;
  borderLeftColor: string;
  borderRightColor: string;
  marginInlineStart: number;
}

async function drawn(locator: Locator): Promise<DrawnBox> {
  return locator.evaluate((element: Element): DrawnBox => {
    const style: CSSStyleDeclaration = getComputedStyle(element);
    const box: DOMRect = element.getBoundingClientRect();

    return {
      left: box.left,
      right: box.right,
      width: box.width,
      borderTop: parseFloat(style.borderTopWidth),
      borderRight: parseFloat(style.borderRightWidth),
      borderBottom: parseFloat(style.borderBottomWidth),
      borderLeft: parseFloat(style.borderLeftWidth),
      radius: parseFloat(style.borderTopLeftRadius),
      shadow: style.boxShadow,
      background: style.backgroundColor,
      borderLeftColor: style.borderLeftColor,
      borderRightColor: style.borderRightColor,
      marginInlineStart: parseFloat(style.marginInlineStart),
    };
  });
}

// The criteria box's inside: its sides less its borders.
async function insideOf(
  box: Locator,
): Promise<{ left: number; right: number }> {
  const frame: DrawnBox = await drawn(box);

  return {
    left: frame.left + frame.borderLeft,
    right: frame.right - frame.borderRight,
  };
}

// Each section's frame: what holds the header of Filters, Actions, Settings.
function sectionFrames(box: Locator): Locator {
  return box.locator(
    "xpath=.//*[@role='button' and starts-with(@aria-controls, 'collapsible-body-')]/..",
  );
}

// Where each of Filters, Actions and Settings starts and ends, as drawn.
async function sectionEdges(
  box: Locator,
): Promise<Array<{ top: number; bottom: number }>> {
  const sections: Array<Locator> = await sectionFrames(box).all();

  return Promise.all(
    sections.map(
      (section: Locator): Promise<{ top: number; bottom: number }> => {
        return section.evaluate(
          (element: Element): { top: number; bottom: number } => {
            const rect: DOMRect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
          },
        );
      },
    ),
  );
}

// The first criteria's bands: its actions' boxes and its first filter's.
function bands(box: Locator): Array<Locator> {
  return [
    box.getByTestId("monitor-criteria-status-form"),
    box.getByTestId("monitor-criteria-alert-form"),
    box.getByTestId("monitor-criteria-incident-form"),
    box.getByTestId("criteria-filter-box").first(),
  ];
}

test.describe("The criteria editor on a phone", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.setViewportSize(PHONE);
  });

  test("the step's cards are sections of the page's card: a rule above each, no sides, no corners, no shadow", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    const box: Locator = await openCriteria(page);
    const criteria: DrawnBox = await drawn(box);

    for (const title of STEP_CARDS) {
      const frame: DrawnBox = await drawn(stepCardFrame(page, title));

      expect([
        title,
        frame.borderTop,
        frame.borderRight,
        frame.borderLeft,
      ]).toEqual([title, 1, 0, 0]);
      expect([title, frame.radius, frame.shadow]).toEqual([title, 0, "none"]);
      // As wide as the criteria's box: the page card's content, edge to edge.
      expect([title, Math.round(frame.left), Math.round(frame.right)]).toEqual([
        title,
        Math.round(criteria.left),
        Math.round(criteria.right),
      ]);
    }

    // A section's title, a step below the page's: 16px, on a 24px line.
    const titleFont: { size: string; line: string } = await cardHeading(
      page,
      "Criteria",
    ).evaluate((element: Element): { size: string; line: string } => {
      const style: CSSStyleDeclaration = getComputedStyle(element);
      return { size: style.fontSize, line: style.lineHeight };
    });
    expect(titleFont).toEqual({ size: "16px", line: "24px" });

    await screenshot(page, "criteria-editor-phone");
  });

  test("the criteria's box is the one frame round an action's fields", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    const box: Locator = await openCriteria(page);

    // Nothing between the box and the alert's title field draws a side.
    const framesBetween: Array<string> = await box
      .getByTestId("monitor-criteria-alert-form")
      .getByRole("textbox")
      .first()
      .evaluate((field: Element): Array<string> => {
        const framed: Array<string> = [];
        const criteriaBox: Element | null = field.closest(
          "[data-testid='monitor-criteria-box']",
        );
        let element: Element | null = field.parentElement;

        while (element && element !== criteriaBox) {
          const style: CSSStyleDeclaration = getComputedStyle(element);

          if (
            parseFloat(style.borderLeftWidth) > 0 ||
            parseFloat(style.borderRightWidth) > 0
          ) {
            framed.push(element.className);
          }

          element = element.parentElement;
        }

        return framed;
      });
    expect(framesBetween).toEqual([]);

    const inside: { left: number; right: number } = await insideOf(box);

    // Every band reaches the box's sides.
    for (const band of bands(box)) {
      const drawnBand: DrawnBox = await drawn(band);

      expect(Math.abs(drawnBand.left - inside.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(drawnBand.right - inside.right)).toBeLessThanOrEqual(1);
      expect([
        drawnBand.borderLeft,
        drawnBand.borderRight,
        drawnBand.radius,
      ]).toEqual([0, 0, 0]);
      expect(drawnBand.borderTop).toBeGreaterThan(0);
      expect(drawnBand.borderBottom).toBeGreaterThan(0);
    }

    // So do Filters, Actions and Settings.
    const sections: Array<Locator> = await sectionFrames(box).all();
    expect(sections).toHaveLength(3);

    for (const section of sections) {
      const drawnSection: DrawnBox = await drawn(section);

      expect(Math.abs(drawnSection.left - inside.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(drawnSection.right - inside.right)).toBeLessThanOrEqual(
        1,
      );
      expect([drawnSection.borderLeft, drawnSection.borderRight]).toEqual([
        0, 0,
      ]);
    }
  });

  /*
   * UI review: 16px apart, each ruled above and below, two rules and a
   * strip of white came between every two sections. On a phone they are one
   * list: each takes its rule over the one before's, so one rule parts them.
   */
  test("Filters, Actions and Settings are one list: one rule between two sections", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    const box: Locator = await openCriteria(page);
    const edges: Array<{ top: number; bottom: number }> =
      await sectionEdges(box);

    expect(edges).toHaveLength(3);

    for (let index: number = 1; index < edges.length; index++) {
      // Its 1px top rule lies on the one before's bottom rule.
      expect(
        Math.abs(edges[index]!.top - (edges[index - 1]!.bottom - 1)),
      ).toBeLessThanOrEqual(0.5);
    }
  });

  test("the fields get the room: the alert's title and its description editor", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    const box: Locator = await openCriteria(page);
    const inside: { left: number; right: number } = await insideOf(box);
    const alertForm: Locator = box.getByTestId("monitor-criteria-alert-form");

    // The title field: the criteria's width less its 12px sides.
    const title: DrawnBox = await drawn(alertForm.getByRole("textbox").first());
    expect(title.width).toBeGreaterThanOrEqual(inside.right - inside.left - 26);
    expect(title.width).toBeGreaterThanOrEqual(280);

    /*
     * The description editor's writing area, inside its fold - a multi-line
     * textbox (MarkdownEditor): it was 166px wide.
     */
    const editor: Locator = alertForm
      .locator("[role='textbox'][aria-multiline='true']")
      .first();
    await expect(editor).toBeVisible();
    expect((await drawn(editor)).width).toBeGreaterThanOrEqual(240);
  });

  test("nothing is wider than the screen, and the Test Monitor button sits on the page's gutter", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await openCriteria(page);

    await expectNoSidewaysScroll(page);

    const testButton: DrawnBox = await drawn(
      page.getByTestId("test-monitor-button"),
    );
    const target: DrawnBox = await drawn(stepCardFrame(page, "Monitor Target"));

    /*
     * Its box took back a margin the button has only from md up: on a phone
     * it pulled the button 12px past the left edge of everything else.
     */
    expect(Math.abs(testButton.left - target.left)).toBeLessThanOrEqual(1);
    expect(testButton.right).toBeLessThanOrEqual(target.right + 1);
  });

  test("dark mode: the criteria's box is framed in the dark grey, its bar blue, its bands on dark ground", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    const box: Locator = await openCriteria(page, "?theme=dark");
    const frame: DrawnBox = await drawn(box);

    // Its three plain sides kept Tailwind's light default before: a white frame.
    expect(frame.borderRightColor).not.toBe(LIGHT_BORDER_RGB);
    expect(frame.borderRightColor).not.toBe(WHITE_RGB);
    expect(frame.borderLeftColor).toBe(BLUE_500_RGB);

    for (const band of bands(box)) {
      expect((await drawn(band)).background).not.toBe(WHITE_RGB);
    }

    for (const title of STEP_CARDS) {
      expect((await drawn(stepCardFrame(page, title))).background).not.toBe(
        WHITE_RGB,
      );
    }

    await screenshot(page, "criteria-editor-phone-dark");
  });

  test("in Persian, the bands still reach the box's sides and nothing is wider than the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    const box: Locator = await openCriteria(page, "?lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const inside: { left: number; right: number } = await insideOf(box);

    for (const band of bands(box)) {
      const drawnBand: DrawnBox = await drawn(band);

      expect(Math.abs(drawnBand.left - inside.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(drawnBand.right - inside.right)).toBeLessThanOrEqual(1);
    }

    await expectNoSidewaysScroll(page);

    await screenshot(page, "criteria-editor-phone-fa");
  });

  test("in the monitor template dialog, too, the step's cards are sections of the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.clock.setFixedTime(NOW);
    await page.goto(TEMPLATES_PATH);
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });

    await page
      .getByRole("button", { name: "Create Monitor Template" })
      .first()
      .click();

    const dialog: Locator = page.getByTestId("modal");
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog
      .getByPlaceholder("Production API Health")
      .fill("Checkout API health");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByTestId("card-select-option-Website").click();

    // On to the step that holds the criteria.
    const headers: Locator = dialog.getByTestId("monitor-criteria-header");

    for (let step: number = 0; step < 4; step++) {
      if ((await headers.count()) > 0) {
        break;
      }

      await dialog.getByRole("button", { name: "Next", exact: true }).click();
      await page.waitForTimeout(500);
    }

    await expect(headers.first()).toBeVisible({ timeout: 30000 });

    const content: DrawnBox = await drawn(dialog.getByTestId("modal-content"));

    for (const title of STEP_CARDS) {
      const frame: DrawnBox = await drawn(stepCardFrame(page, title));

      expect([title, frame.borderLeft, frame.borderTop, frame.radius]).toEqual([
        title,
        0,
        1,
        0,
      ]);
      // Inside the dialog's padding, not past it.
      expect(frame.left).toBeGreaterThan(content.left);
      expect(frame.right).toBeLessThan(content.right);
    }

    await expectNoSidewaysScroll(page);
  });
});

test.describe("The criteria editor from sm up", () => {
  for (const width of [640, 1024, 1280]) {
    test(`at ${width}px: the step's cards are sections, as on a phone; the criteria's own sections framed, the boxes set in under their switches`, async ({
      page,
    }: {
      page: Page;
    }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: width, height: 1000 });
      const box: Locator = await openCriteria(page);
      const criteria: DrawnBox = await drawn(box);

      /*
       * Cards inside the page's card, from sm up, before: a border all
       * round, 12px corners and a shadow. Now a rule above each, and the
       * section as wide as the criteria's box - the page card's content.
       */
      for (const title of STEP_CARDS) {
        const frame: DrawnBox = await drawn(stepCardFrame(page, title));

        expect([
          title,
          frame.borderTop,
          frame.borderRight,
          frame.borderBottom,
          frame.borderLeft,
          frame.radius,
          frame.shadow,
        ]).toEqual([title, 1, 0, 0, 0, 0, "none"]);
        expect([
          title,
          Math.round(frame.left),
          Math.round(frame.right),
        ]).toEqual([
          title,
          Math.round(criteria.left),
          Math.round(criteria.right),
        ]);
      }

      // A section's title, a step below the page card's: 16px, on a 24px line.
      const titleFont: { size: string; line: string } = await cardHeading(
        page,
        "Criteria",
      ).evaluate((element: Element): { size: string; line: string } => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return { size: style.fontSize, line: style.lineHeight };
      });
      expect(titleFont).toEqual({ size: "16px", line: "24px" });

      for (const section of await sectionFrames(box).all()) {
        const drawnSection: DrawnBox = await drawn(section);

        expect([
          drawnSection.borderTop,
          drawnSection.borderRight,
          drawnSection.borderBottom,
          drawnSection.borderLeft,
          drawnSection.radius,
        ]).toEqual([1, 1, 1, 1, 8]);
      }

      // Framed sections 16px apart, as they always were.
      const edges: Array<{ top: number; bottom: number }> =
        await sectionEdges(box);

      for (let index: number = 1; index < edges.length; index++) {
        expect(Math.round(edges[index]!.top - edges[index - 1]!.bottom)).toBe(
          16,
        );
      }

      for (const testId of [
        "monitor-criteria-status-form",
        "monitor-criteria-alert-form",
        "monitor-criteria-incident-form",
      ]) {
        const form: DrawnBox = await drawn(box.getByTestId(testId));

        expect([
          testId,
          form.marginInlineStart,
          form.borderLeft,
          form.borderRight,
          form.radius,
        ]).toEqual([testId, 24, 1, 1, 6]);
      }

      const filterBox: DrawnBox = await drawn(
        box.getByTestId("criteria-filter-box").first(),
      );
      expect([
        filterBox.borderTop,
        filterBox.borderRight,
        filterBox.borderBottom,
        filterBox.borderLeft,
        filterBox.radius,
      ]).toEqual([2, 2, 2, 2, 6]);

      await screenshot(page, `criteria-editor-${width}`);
    });
  }

  test("dark mode at 1280px: the step's sections are ruled in the dark theme's grey, on the page card's ground", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openCriteria(page, "?theme=dark");

    for (const title of STEP_CARDS) {
      const rule: { color: string; shadow: string; background: string } =
        await stepCardFrame(page, title).evaluate(
          (
            element: Element,
          ): { color: string; shadow: string; background: string } => {
            const style: CSSStyleDeclaration = getComputedStyle(element);
            return {
              color: style.borderTopColor,
              shadow: style.boxShadow,
              background: style.backgroundColor,
            };
          },
        );

      // Tailwind's light gray-200 would be a bright line on the dark card.
      expect([title, rule.color]).not.toEqual([title, LIGHT_BORDER_RGB]);
      expect([title, rule.shadow]).toEqual([title, "none"]);
      // No ground of its own: the page card's shows through.
      expect([title, rule.background]).toEqual([title, "rgba(0, 0, 0, 0)"]);
    }

    await screenshot(page, "criteria-editor-1280-dark");
  });
});
