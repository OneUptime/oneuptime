import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Where a card's description sits under its title, measured in Chromium
 * against the offline fixture (ModelTables/Fixture).
 *
 * The maintainer, with a screenshot of the Runbooks list - its title, a
 * button row's height of nothing, then "Reusable response procedures:
 * ordered checklists of manual or automated steps.": "There's a lot of gap
 * between the title of the card and the description of the card. Can you
 * please fix it? Please do it in other places as well (if we have the same
 * case everywhere)".
 *
 * Every table's card (and a card in an overview's one-third column) draws
 * Card's stacked header: the title shares its first line with the controls,
 * the description follows that line. The line was as tall as the controls
 * (38px from md up), the title at its top, and the description came 20px
 * under the title - where a card with no controls puts it 6px under. Now
 * the controls are centred on the title's line and reach 7px past it on
 * both sides, the title stays at the card's padding - where every card's
 * title is, so cards side by side line up - and the description follows
 * the title by 9px, 2px clear of the controls' foot.
 * Where the controls do not fit beside the title (the Runbooks list beside
 * its side menu below about 1100px, two buttons in a one-third column) they
 * go to a line of their own, and the description followed them - 48px under
 * "Runbooks" at 1024px, 98px at 768px. Now it stays 6px under the title and
 * the controls follow it.
 *
 * Measured here:
 *
 *   - the Runbooks list of the screenshot, in its real layout (side menu,
 *     breadcrumbs, the card as wide as it is in the product), at 1280px in
 *     both themes, at a tablet's and a small laptop's width, resized across
 *     the width where its controls stop fitting beside its title, on a
 *     phone, empty, and with its search opened;
 *   - the Incidents and Teams lists, whose controls differ;
 *   - a gallery (Fixture/CardHeaders.js) of every header shape: a table's
 *     toolbar header with a one-line, a wrapped or no description, with no
 *     controls or only a status pill; the default header; and the stacked
 *     header of an overview's side column with Edit, a wrapped description,
 *     a title over two lines, a pill, controls that go under the title, no
 *     description and no actions - at 1440, 1280, 1024, 768 and 390px.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const RUNBOOKS: string = `/dashboard/${PROJECT}/runbooks`;
const INCIDENTS: string = `/dashboard/${PROJECT}/incidents`;
const TEAMS: string = `/dashboard/${PROJECT}/settings/teams`;
const GALLERY: string = `/dashboard/${PROJECT}/card-headers`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/model-tables-ui",
);

// A header control from md up (Button's normal size, a table's search, the ⋯).
const CONTROL_HEIGHT: number = 38;

// The card's frame (1px) and its padding above the header (24px).
const HEADER_INSET: number = 25;

// Sub-pixel rounding of the description's 22.75px line.
const TOLERANCE: number = 0.6;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FixtureRecord {
  unmodelled: Array<string>;
}

interface HeaderBoxes {
  frame: Box;
  header: Box;
  title: Box;
  // Null when the card has none, or the width hides it (a phone).
  description: Box | null;
  actions: Box | null;
  // Each control in the actions: a button, the search, a pill.
  controls: Array<Box>;
  // The card's body: a gallery card's, or a table's first row of chips.
  body: Box | null;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the pages made is one the fixture answers as the API does.
  expect(
    (
      await page.evaluate((): FixtureRecord => {
        return (window as unknown as { __fixture: FixtureRecord }).__fixture;
      })
    ).unmodelled,
  ).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function open(
  page: Page,
  address: string,
  width: number,
  options?: { theme?: "dark" | undefined } | undefined,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 1000 });
  await page.goto(
    options?.theme === "dark" ? `${address}?theme=dark` : address,
  );
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("card-header").first()).toBeVisible();
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
  await finishFirstPaintTransitions(page);
}

/*
 * The fixture's Tailwind is written in the page as elements appear
 * (tailwind.js), so an element whose classes carry a transition animates
 * into its styles on first paint: the table's search box (transition-all)
 * grows its padding in over 200 ms, and a box read meanwhile is short - the
 * phone's 42px search slot once read 41. Boxes are read once every finite
 * animation has run its course. The product's stylesheet is built ahead of
 * time, so nothing animates there on first paint.
 */
async function finishFirstPaintTransitions(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation): boolean => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation): Promise<unknown> => {
          return animation.finished.catch(() => {
            return undefined;
          });
        }),
    );
  });
}

/*
 * The header's parts, read in one go in the page: a part the width hides
 * (display: none) has no box.
 */
async function headerBoxesOf(card: Locator): Promise<HeaderBoxes> {
  return await card.evaluate((element: Element): HeaderBoxes => {
    const boxOf: (part: Element | null) => Box | null = (
      part: Element | null,
    ): Box | null => {
      if (!part || getComputedStyle(part).display === "none") {
        return null;
      }
      const rect: DOMRect = part.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    };
    const find: (testId: string) => Element | null = (
      testId: string,
    ): Element | null => {
      return element.querySelector(`[data-testid='${testId}']`);
    };
    const header: Element = find("card-header")!;
    const actions: Element | null = find("card-header-actions");
    const controls: Array<Box> = actions
      ? Array.from(actions.children)
          .map((child: Element): Box | null => {
            // A box of no width is a folded part (the buttons beside an opened search).
            const found: Box | null = boxOf(child);
            return found && found.width > 0 ? found : null;
          })
          .filter((found: Box | null): found is Box => {
            return found !== null;
          })
      : [];
    const body: Element | null =
      find("shape-body") ||
      find("facet-filter-bar") ||
      header.nextElementSibling;

    return {
      frame: boxOf(element.firstElementChild)!,
      header: boxOf(header)!,
      title: boxOf(find("card-details-heading"))!,
      description: boxOf(find("card-description")),
      actions: boxOf(actions),
      controls: controls,
      body: boxOf(body),
    };
  });
}

function bottomOf(found: Box): number {
  return found.y + found.height;
}

function centreOf(found: Box): number {
  return found.y + found.height / 2;
}

// The actions share the title's line (rather than a line of their own under it).
function onTitleLine(boxes: HeaderBoxes): boolean {
  return Boolean(boxes.actions && boxes.actions.y < bottomOf(boxes.title) - 1);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    }),
  ).toBe(0);
}

/*
 * The rule for a stacked or toolbar header with controls beside its title
 * and a description under it, at md and up.
 */
function expectDescriptionUnderTitle(label: string, boxes: HeaderBoxes): void {
  const description: Box = boxes.description!;
  const actions: Box = boxes.actions!;

  // 9px under the title: not a button row (it was 20px).
  expect(
    Math.abs(description.y - bottomOf(boxes.title) - 9),
    `${label}: the description 9px under the title`,
  ).toBeLessThanOrEqual(TOLERANCE);
  // Clear of the controls' foot wherever it runs under them.
  expect(
    description.y - bottomOf(actions),
    `${label}: the description clear of the controls`,
  ).toBeGreaterThanOrEqual(2 - TOLERANCE);
  // Across the card, not squeezed into a column beside the controls.
  expect(
    description.width,
    `${label}: the description runs across the header`,
  ).toBeGreaterThan(boxes.header.width - 2);
}

/*
 * The rule for a stacked or toolbar header whose controls went to a line of
 * their own under the title (they do not fit beside it), at md and up: the
 * description stays in the title's block, 6px under the title as in a card
 * with no controls - not a button row or two down - and the controls follow
 * it, 8px under it, at the right edge.
 */
function expectControlsUnderDescription(
  label: string,
  boxes: HeaderBoxes,
): void {
  const description: Box = boxes.description!;
  const actions: Box = boxes.actions!;

  expect(
    Math.abs(description.y - bottomOf(boxes.title) - 6),
    `${label}: the description 6px under the title`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(actions.y - bottomOf(description) - 8),
    `${label}: the controls 8px under the description`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(actions.x + actions.width - (boxes.header.x + boxes.header.width)),
    `${label}: the controls at the right edge`,
  ).toBeLessThanOrEqual(1);
  // Across the card, as wide as the title's line.
  expect(
    description.width,
    `${label}: the description runs across the header`,
  ).toBeGreaterThan(boxes.header.width - 2);
}

// Each control's middle is the title's: the controls are centred on the title.
function expectTitleCentredOnControls(label: string, boxes: HeaderBoxes): void {
  expect(boxes.controls.length, `${label}: controls`).toBeGreaterThan(0);

  for (const control of boxes.controls) {
    expect(
      Math.abs(centreOf(control) - centreOf(boxes.title)),
      `${label}: the title centred on a control`,
    ).toBeLessThanOrEqual(1);
  }
}

/*
 * The title stands where every card's title stands, at the card's padding,
 * whatever its header holds - so the titles of cards side by side line up.
 */
function expectTitleAtThePadding(label: string, boxes: HeaderBoxes): void {
  expect(
    Math.abs(boxes.title.y - boxes.frame.y - HEADER_INSET),
    `${label}: the title at the card's padding`,
  ).toBeLessThanOrEqual(TOLERANCE);
}

test.describe("the Runbooks list of the maintainer's screenshot", () => {
  for (const theme of ["light", "dark"] as Array<"light" | "dark">) {
    test(`at 1280px (${theme}) its description sits 9px under "Runbooks", not a button row down, and the search, Create Runbook and the ⋯ are centred on it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, RUNBOOKS, 1280, {
        theme: theme === "dark" ? "dark" : undefined,
      });

      const card: Locator = page.getByTestId("card").first();
      await expect(card.getByTestId("card-details-heading")).toHaveText(
        "Runbooks",
      );
      await expect(card.getByTestId("card-description")).toHaveText(
        "Reusable response procedures: ordered checklists of manual or automated steps.",
      );

      const boxes: HeaderBoxes = await headerBoxesOf(card);

      // The search, Create Runbook and the ⋯, one height, on the title's line.
      const toolbar: Locator = card.getByTestId("model-table-header-toolbar");
      const controls: Array<Box> = [
        (await card.getByTestId("model-table-search-slot").boundingBox())!,
        (await toolbar
          .getByRole("button", { name: "Create Runbook" })
          .boundingBox())!,
        (await toolbar
          .getByRole("button", { name: "More options" })
          .boundingBox())!,
      ];
      for (const control of controls) {
        expect(Math.round(control.height)).toBe(CONTROL_HEIGHT);
        expect(
          Math.abs(centreOf(control) - centreOf(boxes.title)),
          "the title centred on each control",
        ).toBeLessThanOrEqual(1);
      }
      expect(onTitleLine(boxes)).toBe(true);

      expectDescriptionUnderTitle("Runbooks", boxes);
      expectTitleAtThePadding("Runbooks", boxes);
      // The 38px controls reach 7px above the title's line, and 7px below it.
      expect(
        Math.abs(boxes.title.y - boxes.actions!.y - 7),
      ).toBeLessThanOrEqual(TOLERANCE);

      // The description on one line, and the filter chips under it.
      expect(boxes.description!.height).toBeLessThan(24);
      expect(boxes.body).not.toBeNull();
      expect(boxes.body!.y).toBeGreaterThanOrEqual(
        bottomOf(boxes.description!) - TOLERANCE,
      );

      await expectNoSidewaysScroll(page);
      await screenshot(page, `card-headers-runbooks-1280-${theme}`);
    });
  }

  for (const [width, controlsFit] of [
    [768, false],
    [1024, false],
    [1440, true],
  ] as Array<[number, boolean]>) {
    test(`at ${width}px the description follows the title by 9px when the controls share its line, or by 6px with the controls under it when they do not fit beside the title`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, RUNBOOKS, width);

      const boxes: HeaderBoxes = await headerBoxesOf(
        page.getByTestId("card").first(),
      );

      expect(boxes.description).not.toBeNull();
      // Beside the side menu, the controls fit beside "Runbooks" from about 1100px.
      expect(onTitleLine(boxes)).toBe(controlsFit);

      if (controlsFit) {
        expectDescriptionUnderTitle(`Runbooks at ${width}px`, boxes);
        expect(
          Math.abs(centreOf(boxes.actions!) - centreOf(boxes.title)),
        ).toBeLessThanOrEqual(1);
      } else {
        /*
         * The controls on a line of their own: under the controls the
         * description sat 48px under "Runbooks" at 1024px and 98px at 768px.
         */
        expectControlsUnderDescription(`Runbooks at ${width}px`, boxes);
        // The filter chips follow the controls.
        expect(boxes.body!.y).toBeGreaterThanOrEqual(
          bottomOf(boxes.actions!) - TOLERANCE,
        );
      }

      await expectNoSidewaysScroll(page);
      await screenshot(page, `card-headers-runbooks-${width}`);
    });
  }

  test("a window resized across the point where the controls stop fitting beside the title moves the description with them, both ways, and back to exactly where it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS, 1280);
    const card: Locator = page.getByTestId("card").first();
    const wide: HeaderBoxes = await headerBoxesOf(card);

    expect(onTitleLine(wide)).toBe(true);
    expectDescriptionUnderTitle("Runbooks at 1280px", wide);

    await page.setViewportSize({ width: 1024, height: 1000 });
    /*
     * Once the controls go under the title the description moves into the
     * title's block (read in that order too) - a frame after the resize.
     */
    await expect(
      card
        .getByTestId("card-header-title-block")
        .getByTestId("card-description"),
    ).toBeVisible();
    const narrow: HeaderBoxes = await headerBoxesOf(card);
    expect(onTitleLine(narrow)).toBe(false);
    expectControlsUnderDescription("Runbooks resized to 1024px", narrow);

    // And back, to exactly where everything was.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await expect
      .poll(async (): Promise<HeaderBoxes> => {
        return await headerBoxesOf(card);
      })
      .toEqual(wide);
    // Alone on its line, the title is at the card's padding.
    expect(
      Math.abs(narrow.title.y - narrow.frame.y - HEADER_INSET),
    ).toBeLessThanOrEqual(TOLERANCE);
  });

  test("at 1024px, where the controls are under the description, opening the search moves nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS, 1024);
    const card: Locator = page.getByTestId("card").first();
    const before: HeaderBoxes = await headerBoxesOf(card);

    expect(onTitleLine(before)).toBe(false);

    await page.getByRole("button", { name: "Open search" }).click();
    await page.keyboard.type("failover");
    // The buttons beside the opened search fold away over 300ms.
    await page.waitForTimeout(450);

    const after: HeaderBoxes = await headerBoxesOf(card);

    expect(after.title).toEqual(before.title);
    expect(after.description).toEqual(before.description);
    expect(after.actions!.y).toBe(before.actions!.y);
    expectControlsUnderDescription("Runbooks at 1024px, searching", after);
  });

  /*
   * Between 768 and about 1100px beside a side menu the controls do not fit
   * beside "Runbooks" and go to a line of their own. The search on that
   * line was the 14rem pill hung at its right edge, the rest of the line
   * empty: it fills what the buttons leave of the line now, as a phone's
   * does, and is the pill again once the controls share the title's line.
   */
  for (const width of [768, 1024]) {
    test(`at ${width}px, where the controls are on a line of their own, the search fills what the buttons leave of it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, RUNBOOKS, width);

      const card: Locator = page.getByTestId("card").first();
      const boxes: HeaderBoxes = await headerBoxesOf(card);

      expect(onTitleLine(boxes)).toBe(false);
      await expect(card.getByTestId("card-header-title-row")).toHaveAttribute(
        "data-actions-under-title",
        "true",
      );

      const search: Box = (await card
        .getByTestId("model-table-search-slot")
        .boundingBox())!;
      const create: Box = (await card
        .getByRole("button", { name: "Create Runbook" })
        .boundingBox())!;

      // From the line's start - the title's - to 12px before Create Runbook.
      expect(Math.abs(search.x - boxes.title.x)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(create.x - (search.x + search.width) - 12),
      ).toBeLessThanOrEqual(1);
      /*
       * Never under its 11rem floor; at 1024px the line leaves it more than
       * the 14rem pill, at 768px (a 480px card) about 205px.
       */
      expect(search.width).toBeGreaterThanOrEqual(176);
      if (width >= 1024) {
        expect(search.width).toBeGreaterThan(224);
      }
      expect(Math.round(search.height)).toBe(CONTROL_HEIGHT);
      // Still level with the buttons beside it, at the header's right edge.
      expect(Math.abs(centreOf(search) - centreOf(create))).toBeLessThanOrEqual(
        1,
      );
      expectControlsUnderDescription(`Runbooks at ${width}px`, boxes);

      await expectNoSidewaysScroll(page);
      await screenshot(page, `card-headers-runbooks-search-${width}`);
    });
  }

  test("once the controls share the title's line again, the search is its 14rem pill: a window made wider and narrower again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS, 1024);

    const card: Locator = page.getByTestId("card").first();
    const row: Locator = card.getByTestId("card-header-title-row");
    const slot: Locator = card.getByTestId("model-table-search-slot");

    await expect(row).toHaveAttribute("data-actions-under-title", "true");

    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(row).not.toHaveAttribute("data-actions-under-title", /.+/);
    await expect
      .poll(async (): Promise<number> => {
        return Math.round((await slot.boundingBox())!.width);
      })
      .toBe(224);
    expect(onTitleLine(await headerBoxesOf(card))).toBe(true);

    await page.setViewportSize({ width: 1024, height: 1000 });
    await expect(row).toHaveAttribute("data-actions-under-title", "true");
    await expect
      .poll(async (): Promise<number> => {
        return Math.round((await slot.boundingBox())!.width);
      })
      .toBeGreaterThan(224);
  });

  test("on a phone the description is not shown; the title, then the search filling the card, nothing past the screen's edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS, 390);

    const card: Locator = page.getByTestId("card").first();
    const boxes: HeaderBoxes = await headerBoxesOf(card);

    expect(boxes.description).toBeNull();
    // The search fills its line under the title, as before.
    const search: Box = (await card
      .getByTestId("model-table-search-slot")
      .boundingBox())!;
    expect(search.y).toBeGreaterThanOrEqual(bottomOf(boxes.title) - 1);
    expect(Math.abs(search.x - boxes.title.x)).toBeLessThanOrEqual(1);
    expect(Math.round(search.height)).toBe(42);
    // Nothing hangs past the header into the chips.
    expect(boxes.body!.y).toBeGreaterThanOrEqual(
      bottomOf(boxes.actions!) - TOLERANCE,
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, "card-headers-runbooks-390");
  });

  test("an empty list drops its description while its empty state says it, and the title and the controls stay exactly where they were", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS, 1280);
    const withRows: HeaderBoxes = await headerBoxesOf(
      page.getByTestId("card").first(),
    );

    await open(page, `${RUNBOOKS}?data=empty`, 1280);
    await expect(page.getByTestId("table-empty-state")).toBeVisible();
    const empty: HeaderBoxes = await headerBoxesOf(
      page.getByTestId("card").first(),
    );

    expect(withRows.description).not.toBeNull();
    expect(empty.description).toBeNull();
    expect(empty.title.y).toBe(withRows.title.y);
    expect(empty.actions!.y).toBe(withRows.actions!.y);
    expectTitleCentredOnControls("the empty Runbooks list", empty);
    // The empty state starts under the controls.
    expect(empty.body!.y).toBeGreaterThanOrEqual(
      bottomOf(empty.actions!) - TOLERANCE,
    );

    await screenshot(page, "card-headers-runbooks-empty-1280");
  });

  test("opening the search moves nothing: the title, the description and the opened search stay on their lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, RUNBOOKS, 1280);
    const card: Locator = page.getByTestId("card").first();
    const before: HeaderBoxes = await headerBoxesOf(card);

    await page.getByRole("button", { name: "Open search" }).click();
    await page.keyboard.type("failover");
    // The buttons beside the opened search fold away over 300ms.
    await page.waitForTimeout(450);

    const after: HeaderBoxes = await headerBoxesOf(card);
    const search: Box = (await card
      .getByTestId("model-table-search-slot")
      .boundingBox())!;

    expect(after.title.y).toBe(before.title.y);
    expect(after.description!.y).toBe(before.description!.y);
    expect(Math.round(search.height)).toBe(CONTROL_HEIGHT);
    expect(
      Math.abs(centreOf(search) - centreOf(after.title)),
    ).toBeLessThanOrEqual(1);
    expect(after.description!.y - bottomOf(search)).toBeGreaterThanOrEqual(
      2 - TOLERANCE,
    );
  });
});

test.describe("other lists draw the same header", () => {
  for (const [address, title] of [
    [INCIDENTS, "Incidents"],
    [TEAMS, "Teams"],
  ] as Array<[string, string]>) {
    test(`${title} at 1280px: the description 9px under the title, centred on its controls`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, address, 1280);

      const card: Locator = page
        .getByTestId("card")
        .filter({
          has: page.getByTestId("card-details-heading").getByText(title, {
            exact: true,
          }),
        })
        .first();
      const boxes: HeaderBoxes = await headerBoxesOf(card);

      expect(onTitleLine(boxes)).toBe(true);
      expectDescriptionUnderTitle(title, boxes);
      expectTitleCentredOnControls(title, boxes);
      expectTitleAtThePadding(title, boxes);
      await expectNoSidewaysScroll(page);
    });
  }
});

/*
 * The gallery's shapes, by what each one is held to at md and up. The phone
 * test below holds every one of them on a phone.
 */
interface ShapeRule {
  name: string;
  // The description's distance under the title (null: none, or not under it).
  gap: number | null;
  /*
   * Actions beside the title, centred on it: 38px controls, a status pill,
   * and a title that breaks over two lines where its column is narrow
   * (the controls centred on both lines).
   */
  centredOnControls: boolean;
  // The controls' top is the title's (the default header).
  topLevelWithTitle: boolean;
}

const SHAPES: Array<ShapeRule> = [
  {
    name: "toolbar-one-line",
    gap: 9,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "toolbar-wrapped",
    gap: 9,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "toolbar-no-description",
    gap: null,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "toolbar-no-actions",
    gap: 6,
    centredOnControls: false,
    topLevelWithTitle: false,
  },
  {
    name: "toolbar-pill",
    gap: 9,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "default-edit",
    gap: 6,
    centredOnControls: false,
    topLevelWithTitle: true,
  },
  {
    name: "default-no-actions",
    gap: 6,
    centredOnControls: false,
    topLevelWithTitle: false,
  },
  {
    name: "stacked-edit",
    gap: 9,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "stacked-wrapped",
    gap: 9,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "stacked-long-title",
    gap: 9,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "stacked-pill",
    gap: 9,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "stacked-no-description",
    gap: null,
    centredOnControls: true,
    topLevelWithTitle: false,
  },
  {
    name: "stacked-no-actions",
    gap: 6,
    centredOnControls: false,
    topLevelWithTitle: false,
  },
];

test.describe("every header shape", () => {
  for (const width of [1440, 1280, 1024, 768]) {
    test(`at ${width}px each description sits where its shape says, clear of the controls, and nothing in a header runs into the card's body`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, GALLERY, width);

      for (const shape of SHAPES) {
        const label: string = `${shape.name} at ${width}px`;
        const boxes: HeaderBoxes = await headerBoxesOf(
          page.getByTestId(`shape-${shape.name}`).getByTestId("card"),
        );
        const isDefault: boolean = shape.name.startsWith("default");

        // Whatever the shape: the body starts under the whole header.
        const headerFoot: number = Math.max(
          bottomOf(boxes.title),
          boxes.actions ? bottomOf(boxes.actions) : 0,
          boxes.description ? bottomOf(boxes.description) : 0,
        );
        expect(boxes.body!.y, `${label}: the body under the header`).toBe(
          Math.max(boxes.body!.y, headerFoot),
        );

        /*
         * Nothing runs into the controls: the description starts below
         * their foot, or ends above their top when they went under it.
         */
        if (boxes.actions && boxes.description && !isDefault) {
          if (onTitleLine(boxes)) {
            expect(
              boxes.description.y - bottomOf(boxes.actions),
              `${label}: the description below the controls`,
            ).toBeGreaterThanOrEqual(2 - TOLERANCE);
          } else {
            expect(
              boxes.actions.y - bottomOf(boxes.description),
              `${label}: the description above the controls`,
            ).toBeGreaterThanOrEqual(8 - TOLERANCE);
          }
        }

        // The actions at the header's right edge.
        if (boxes.actions) {
          expect(
            Math.abs(
              boxes.actions.x +
                boxes.actions.width -
                (boxes.header.x + boxes.header.width),
            ),
            `${label}: the actions at the right edge`,
          ).toBeLessThanOrEqual(1);
        }

        /*
         * A narrow column can send the controls under the title: the
         * description stays 6px under the title and the controls follow it
         * (or the title, 8px down, when there is no description).
         */
        if (boxes.actions && !onTitleLine(boxes)) {
          if (boxes.description) {
            expectControlsUnderDescription(label, boxes);
          } else {
            expect(
              Math.abs(boxes.actions.y - bottomOf(boxes.title) - 8),
              `${label}: the controls 8px under the title`,
            ).toBeLessThanOrEqual(TOLERANCE);
          }
          continue;
        }

        if (shape.gap !== null) {
          expect(boxes.description, `${label}: a description`).not.toBeNull();
          expect(
            Math.abs(boxes.description!.y - bottomOf(boxes.title) - shape.gap),
            `${label}: the description ${shape.gap}px under the title`,
          ).toBeLessThanOrEqual(TOLERANCE);
        } else {
          expect(boxes.description, `${label}: no description`).toBeNull();
        }

        // Every title at the card's padding, whatever the header holds.
        expectTitleAtThePadding(label, boxes);

        if (shape.centredOnControls) {
          expectTitleCentredOnControls(label, boxes);
        }

        if (shape.topLevelWithTitle) {
          expect(
            Math.abs(boxes.actions!.y - boxes.title.y),
            `${label}: the actions' top level with the title's`,
          ).toBeLessThanOrEqual(TOLERANCE);
        }
      }

      await expectNoSidewaysScroll(page);
      await screenshot(page, `card-headers-gallery-${width}`);
    });
  }

  test("at 1280px a stacked card in the narrow column whose two buttons do not fit beside its title keeps its description right under the title, and the buttons follow it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);

    const card: Locator = page
      .getByTestId("shape-stacked-actions-under")
      .getByTestId("card");
    const boxes: HeaderBoxes = await headerBoxesOf(card);

    expect(onTitleLine(boxes)).toBe(false);
    expectControlsUnderDescription("Incident Roles", boxes);
    // And the card's body under the buttons.
    expect(boxes.body!.y).toBeGreaterThanOrEqual(
      bottomOf(boxes.actions!) - TOLERANCE,
    );
    // A screen reader meets the title, what it is, then the buttons.
    await expect(card.getByTestId("card-header")).toHaveText(
      /^Incident Roles\s*Who does what on this incident\.\s*Assign Role\s*Refresh$/,
    );
  });

  test("at 1280px a title over two lines beside Edit stays at the card's padding, Edit centred on both lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);

    const boxes: HeaderBoxes = await headerBoxesOf(
      page.getByTestId("shape-stacked-long-title").getByTestId("card"),
    );

    expect(Math.round(boxes.title.height)).toBe(48);
    expect(onTitleLine(boxes)).toBe(true);
    expectTitleAtThePadding("Scheduled Maintenance Details", boxes);
    expectTitleCentredOnControls("Scheduled Maintenance Details", boxes);
  });

  test("at 1280px the titles of cards side by side line up, whatever their headers hold: Edit beside one, centred on the title, at the top of the other", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);

    const main: HeaderBoxes = await headerBoxesOf(
      page.getByTestId("shape-default-edit").getByTestId("card"),
    );
    const side: HeaderBoxes = await headerBoxesOf(
      page.getByTestId("shape-stacked-edit").getByTestId("card"),
    );

    // The two cards start the grid's row together...
    expect(Math.abs(main.frame.y - side.frame.y)).toBeLessThanOrEqual(
      TOLERANCE,
    );
    // ...and so do their titles.
    expect(Math.abs(main.title.y - side.title.y)).toBeLessThanOrEqual(
      TOLERANCE,
    );
    expect(
      Math.abs(main.description!.y - main.title.y - 30),
    ).toBeLessThanOrEqual(TOLERANCE);
  });

  test("on a phone no description is shown, the title and the controls share a line centred on each other or the controls go under it, and the body starts under them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 390);

    for (const shape of SHAPES) {
      const label: string = `${shape.name} at 390px`;
      const boxes: HeaderBoxes = await headerBoxesOf(
        page.getByTestId(`shape-${shape.name}`).getByTestId("card"),
      );

      expect(boxes.description, `${label}: no description`).toBeNull();

      if (boxes.actions) {
        if (onTitleLine(boxes)) {
          expect(
            Math.abs(centreOf(boxes.actions) - centreOf(boxes.title)),
            `${label}: centred on each other`,
          ).toBeLessThanOrEqual(1);
        } else {
          expect(
            boxes.actions.y,
            `${label}: under the title`,
          ).toBeGreaterThanOrEqual(bottomOf(boxes.title) - TOLERANCE);
        }
        expect(boxes.body!.y, `${label}: the body under the controls`).toBe(
          Math.max(boxes.body!.y, bottomOf(boxes.actions)),
        );
      }
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, "card-headers-gallery-390");
  });

  test("the dark theme draws the same header in the same places", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, GALLERY, 1280);
    const light: HeaderBoxes = await headerBoxesOf(
      page.getByTestId("shape-toolbar-one-line").getByTestId("card"),
    );

    await open(page, GALLERY, 1280, { theme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    const dark: HeaderBoxes = await headerBoxesOf(
      page.getByTestId("shape-toolbar-one-line").getByTestId("card"),
    );

    expect(dark).toEqual(light);
    await screenshot(page, "card-headers-gallery-1280-dark");
  });
});
