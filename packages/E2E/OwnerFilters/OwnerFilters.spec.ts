import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";

/*
 * "I can't filter by Owner/team on /on-call-duty/schedules." - the
 * maintainer.
 *
 * On-Call > Schedules in a browser, against the offline fixture
 * (OwnerFilters/Fixture), in the On-Call side menu as the Dashboard frames
 * it. The fixture's project has six schedules: the Payments team owns
 * Payments Primary; the SRE team SRE Weekdays and SRE Weekends; Ada Lovelace
 * SRE Weekends and Database On-Call; Bo Chen, a member of the SRE team, Bo's
 * Escalation; nobody owns Nights. Its list reads answer the Owner chip as
 * the server does.
 *
 *   - The Owner and Labels chips sit over the list, and an Owners column
 *     shows who owns each schedule.
 *   - A team lists the schedules the team owns - never the ones a member of
 *     the team owns - a person the ones they own, both the ones either owns.
 *   - "is not", "is empty" and "is not empty" list the rest, the unowned and
 *     the owned.
 *   - Every read sends the one filter, under "owners", for the server to
 *     answer - never ids the page worked out.
 *   - The chips survive a reload, and clearing them lists every schedule.
 *   - At a 390px phone's width, the chips and their list fit the screen and
 *     still filter; in German and in dark mode they read. The header's
 *     buttons keep their words on one line once a chip brings Saved Views.
 *   - A project with no schedule shows its empty state alone, without
 *     chips to filter nothing.
 *   - "Owner is empty" can be saved as a view.
 *   - A member who may not read the schedules' owners gets no Owner chip.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/on-call-duty/schedules`;
const PORT: string = process.env["OWNER_FILTERS_FIXTURE_PORT"] || "4481";
const TABLE_ID: string = "on-call-schedules-table";

const SRE_TEAM_ID: string = "40000000-0000-4000-8000-000000000001";
const ADA_ID: string = "30000000-0000-4000-8000-000000000001";

const SCHEDULES: Array<string> = [
  "Payments Primary",
  "SRE Weekdays",
  "SRE Weekends",
  "Database On-Call",
  "Bo's Escalation",
  "Nights",
];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/owner-filters-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

interface ListRequest {
  model: string;
  query: Record<string, unknown>;
}

interface FixtureRecord {
  listRequests: Array<ListRequest>;
  unhandled: Array<Record<string, unknown>>;
  // The reads ?fail= failed on purpose.
  failedReads: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every read the page made is one the fixture answers as the API does.
  expect((await fixture(page)).unhandled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __fixture: FixtureRecord }).__fixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

/*
 * The fixture's Tailwind is written in the page as elements appear, so an
 * element whose classes carry a transition animates into its styles on
 * first paint. Boxes are read once every finite animation has run its
 * course (as the ModelTables specs do).
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

async function openPage(
  page: Page,
  options: { width?: number; query?: string } = {},
): Promise<void> {
  await page.setViewportSize({ width: options.width || 1280, height: 900 });
  await page.goto(`${PAGE_PATH}${options.query || ""}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();
  await finishFirstPaintTransitions(page);

  /*
   * Below md the chips are folded behind Filter (FacetFilterBar). These
   * tests are about the chips themselves, so on a phone they open them
   * first; ModelTables.spec.ts holds the fold.
   */
  if ((options.width || 1280) < 768) {
    const filter: Locator = page.getByTestId("facet-filter-bar-toggle");

    await filter.click();
    await expect(filter).toHaveAttribute("aria-expanded", "true");
    await finishFirstPaintTransitions(page);
  }
}

// The list's rows: table rows on a laptop, cards on a phone.
function rows(page: Page): Locator {
  return page.locator(`#${TABLE_ID}-body > tr, #${TABLE_ID}-body > div`);
}

// The schedules the list shows, by name, in its order.
async function listedSchedules(page: Page): Promise<Array<string>> {
  const texts: Array<string> = await rows(page).allInnerTexts();

  return texts.map((text: string): string => {
    return (
      SCHEDULES.find((name: string): boolean => {
        return text.includes(name);
      }) || `?${text}`
    );
  });
}

async function expectListed(
  page: Page,
  expected: Array<string>,
): Promise<void> {
  await expect
    .poll(async (): Promise<Array<string>> => {
      return [...(await listedSchedules(page))].sort();
    })
    .toEqual([...expected].sort());
}

function bar(page: Page): Locator {
  return page.getByTestId("facet-filter-bar");
}

function chip(page: Page, label: string): Locator {
  return bar(page).getByRole("button", {
    name: new RegExp(`^${escapeRegExp(label)}(?:$| ·)`),
  });
}

// The Owner chip's popover, opened.
async function openChip(page: Page, label: string): Promise<Locator> {
  const button: Locator = chip(page, label);

  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
  }

  /*
   * The open chip's popover: the one dialog with an operator to pick ("is",
   * "is not", "is empty"...). One chip's popover is open at a time.
   */
  const popover: Locator = page.getByRole("dialog").filter({
    has: page.getByRole("combobox"),
  });

  await expect(popover).toBeVisible();
  return popover;
}

// The people and teams a chip's popover offers (not its operator's choices).
function offered(popover: Locator): Locator {
  return popover.getByRole("listbox").getByRole("option");
}

async function pick(page: Page, label: string, option: string): Promise<void> {
  const popover: Locator = await openChip(page, label);

  await offered(popover).filter({ hasText: option }).click();
}

async function setOperator(
  page: Page,
  label: string,
  operator: string,
): Promise<void> {
  const popover: Locator = await openChip(page, label);

  await popover.getByRole("combobox").selectOption(operator);
}

// Close a chip's popover by clicking away from it.
async function closePopover(page: Page): Promise<void> {
  await page.mouse.click(5, 5);
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

// The owners filter the schedules' latest list read sent.
async function latestOwnersFilter(
  page: Page,
): Promise<Record<string, unknown> | undefined> {
  const reads: Array<ListRequest> = (await fixture(page)).listRequests.filter(
    (request: ListRequest): boolean => {
      return request.model === "OnCallDutyPolicySchedule";
    },
  );

  return reads[reads.length - 1]?.query["owners"] as
    | Record<string, unknown>
    | undefined;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  expect(box).not.toBeNull();
  return box!;
}

/*
 * The list card's header buttons once a chip is set - Saved Views, the
 * main button and the ⋯ - and the card they sit in.
 */
async function headerButtons(
  page: Page,
  names: { savedViews: string; create: string },
): Promise<{ card: Box; savedViews: Box; create: Box; more: Box }> {
  const header: Locator = page
    .locator('[data-testid="card-header-actions"]')
    .filter({ has: page.getByRole("button", { name: names.create }) });

  await expect(header.getByText(names.savedViews)).toBeVisible();
  await finishFirstPaintTransitions(page);

  const createButton: Locator = header.getByRole("button", {
    name: names.create,
  });

  return {
    card: await boxOf(
      header.locator("xpath=ancestor::*[@data-testid='card'][1]"),
    ),
    savedViews: await boxOf(
      header.getByText(names.savedViews).locator("xpath=.."),
    ),
    create: await boxOf(createButton),
    more: await boxOf(
      header
        .locator('[data-testid="model-table-header-toolbar"] button')
        .last(),
    ),
  };
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

test.describe("On-Call Schedules, filtered by its owners", () => {
  test("the Owner and Labels chips sit over the list, and the Owners column shows who owns each schedule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);

    await expect(chip(page, "Owner")).toBeVisible();
    await expect(chip(page, "Labels")).toBeVisible();
    // The chips sit in the list's card, over its header.
    await expect(
      page.locator(`#${TABLE_ID}`).locator('[data-testid="facet-filter-bar"]'),
    ).toHaveCount(0);
    await expectListed(page, SCHEDULES);

    await expect(
      page.locator("thead th").filter({ hasText: "Owners" }),
    ).toHaveCount(1);

    // SRE Weekends: the SRE team and Ada Lovelace, as their initials.
    const sreWeekends: Locator = rows(page).filter({ hasText: "SRE Weekends" });

    await expect(sreWeekends.getByText("AL", { exact: true })).toBeVisible();
    await expect(sreWeekends.getByText("S", { exact: true })).toBeVisible();

    // Nights: owned by nobody, a quiet dash.
    await expect(
      rows(page).filter({ hasText: "Nights" }).getByText("No owners."),
    ).toHaveCount(1);

    // Unfiltered, the list reads with no owners filter.
    expect(await latestOwnersFilter(page)).toBeUndefined();

    await screenshot(page, "schedules-1280");
  });

  test("the chip offers the project's people and teams, apart", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);

    const popover: Locator = await openChip(page, "Owner");

    await expect(offered(popover)).toHaveCount(5);
    await expect(popover.getByTestId("filter-chip-group-heading")).toHaveText([
      "People",
      "Teams",
    ]);

    for (const name of [
      "Ada Lovelace",
      "Bo Chen",
      "Grace Hopper",
      "SRE",
      "Payments",
    ]) {
      await expect(offered(popover).filter({ hasText: name })).toHaveCount(1);
    }

    // Searching narrows both lists.
    await popover.getByPlaceholder("Search people and teams...").fill("pay");
    await expect(offered(popover)).toHaveCount(1);
    await expect(offered(popover)).toContainText("Payments");

    await screenshot(page, "owner-chip-open-1280");
  });

  test("while the people and teams are read, the chip says it is loading - never that there are none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, { query: "?delay=1500" });

    /*
     * The page from the click on: the chip reads its options a moment after
     * it opens (debounced), and that moment used to say "Nothing to show".
     * Then, for one frame or none, the popover's first render did: React
     * draws the click in a microtask, and a passive effect's "loading"
     * waited for a later task, after the browser could paint. So the page
     * is read once React has drawn the click - what the next frame shows -
     * and then on every frame for 600ms.
     */
    const seen: { onFirstFrame: boolean; framesSayingNothing: number } =
      await page.evaluate(
        async (): Promise<{
          onFirstFrame: boolean;
          framesSayingNothing: number;
        }> => {
          const button: HTMLElement | undefined = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="facet-filter-bar"] button',
            ),
          ).find((candidate: HTMLElement): boolean => {
            return (candidate.textContent || "").trim().startsWith("Owner");
          });

          button!.click();

          // React's render of the click is the microtask queued first.
          await Promise.resolve();
          await Promise.resolve();

          const onFirstFrame: boolean =
            document.body.innerText.includes("Nothing to show");

          let framesSayingNothing: number = 0;
          const start: number = performance.now();

          while (performance.now() - start < 600) {
            await new Promise((resolve: (value: unknown) => void) => {
              requestAnimationFrame(resolve);
            });

            if (document.body.innerText.includes("Nothing to show")) {
              framesSayingNothing++;
            }
          }

          return { onFirstFrame, framesSayingNothing };
        },
      );

    expect(seen).toEqual({ onFirstFrame: false, framesSayingNothing: 0 });

    const popover: Locator = await openChip(page, "Owner");

    await expect(popover.getByText("Loading...")).toBeVisible();
    await expect(popover.getByText("Nothing to show")).toHaveCount(0);
    await expect(popover.getByText("No options available")).toHaveCount(0);

    await expect(offered(popover)).toHaveCount(5);
    await expect(popover.getByText("Loading...")).toHaveCount(0);
  });

  test("a team lists the schedules the team owns - not the one a member of the team owns", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await pick(page, "Owner", "SRE");
    await closePopover(page);

    await expectListed(page, ["SRE Weekdays", "SRE Weekends"]);
    await expect(chip(page, "Owner")).toHaveAccessibleName(/^Owner · SRE/);

    // One filter for the server: the team, as picked - no ids worked out here.
    expect(await latestOwnersFilter(page)).toEqual({
      _type: "OwnedBy",
      match: "AnyOf",
      userIds: [],
      teamIds: [SRE_TEAM_ID],
    });

    const reads: Array<ListRequest> = (await fixture(page)).listRequests;
    const lastScheduleRead: ListRequest | undefined = reads
      .filter((request: ListRequest): boolean => {
        return request.model === "OnCallDutyPolicySchedule";
      })
      .pop();

    expect(lastScheduleRead?.query["_id"]).toBeUndefined();

    // The owner tables are read for the Owners column only, by schedule.
    for (const request of reads.filter((read: ListRequest): boolean => {
      return read.model.startsWith("OnCallDutyPolicyScheduleOwner");
    })) {
      expect(Object.keys(request.query)).not.toContain("teamId");
      expect(Object.keys(request.query)).not.toContain("userId");
    }

    await screenshot(page, "filtered-by-team-1280");
  });

  test("a person and a team list the schedules either owns, each once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await pick(page, "Owner", "SRE");
    await pick(page, "Owner", "Ada Lovelace");
    await closePopover(page);

    await expectListed(page, [
      "SRE Weekdays",
      "SRE Weekends",
      "Database On-Call",
    ]);

    expect(await latestOwnersFilter(page)).toEqual({
      _type: "OwnedBy",
      match: "AnyOf",
      userIds: [ADA_ID],
      teamIds: [SRE_TEAM_ID],
    });
  });

  test("is not, is empty and is not empty list the rest, the unowned and the owned", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await pick(page, "Owner", "SRE");
    await pick(page, "Owner", "Ada Lovelace");
    await setOperator(page, "Owner", "is_not");
    await closePopover(page);

    await expectListed(page, ["Payments Primary", "Bo's Escalation", "Nights"]);
    expect((await latestOwnersFilter(page))?.["match"]).toBe("NoneOf");

    await setOperator(page, "Owner", "is_empty");
    await closePopover(page);
    await expectListed(page, ["Nights"]);
    expect(await latestOwnersFilter(page)).toEqual({
      _type: "OwnedBy",
      match: "NoOwner",
      userIds: [],
      teamIds: [],
    });

    await setOperator(page, "Owner", "is_not_empty");
    await closePopover(page);
    await expectListed(page, [
      "Payments Primary",
      "SRE Weekdays",
      "SRE Weekends",
      "Database On-Call",
      "Bo's Escalation",
    ]);
    expect((await latestOwnersFilter(page))?.["match"]).toBe("AnyOwner");
  });

  test("the chips live in the address: a reload keeps the filter, and clearing it lists every schedule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await pick(page, "Owner", "Payments");
    await closePopover(page);
    await expectListed(page, ["Payments Primary"]);

    await expect
      .poll((): boolean => {
        return new URL(page.url()).searchParams.has(`${TABLE_ID}-facets`);
      })
      .toBe(true);

    await page.reload();
    await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
    await expectListed(page, ["Payments Primary"]);
    await expect(chip(page, "Owner")).toHaveAccessibleName(/^Owner · Payments/);

    // Every read since the reload carried the filter: no flash of the rest.
    const reads: Array<ListRequest> = (await fixture(page)).listRequests.filter(
      (request: ListRequest): boolean => {
        return request.model === "OnCallDutyPolicySchedule";
      },
    );

    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.query["owners"]).toBeDefined();
    }

    await bar(page).getByRole("button", { name: "Clear Owner filter" }).click();
    await expectListed(page, SCHEDULES);
    expect(await latestOwnersFilter(page)).toBeUndefined();
  });

  test("a filter that matches nothing says so, and offers to clear it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await pick(page, "Owner", "Grace Hopper");
    await closePopover(page);

    await expect(rows(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /clear/i }).first(),
    ).toBeVisible();

    await screenshot(page, "filtered-nothing-1280");
  });

  test("on a 390px phone the chips fit, filter, and leave the page without sideways scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, { width: 390 });

    await expect(chip(page, "Owner")).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    const popover: Locator = await openChip(page, "Owner");
    const popoverBox: { x: number; width: number } | null =
      await popover.boundingBox();

    expect(popoverBox).not.toBeNull();
    expect(popoverBox!.x).toBeGreaterThanOrEqual(0);
    expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(390);

    // The people and teams, once read: never "Nothing to show" first.
    await expect(offered(popover)).toHaveCount(5);

    await screenshot(page, "owner-chip-open-390");

    await offered(popover).filter({ hasText: "SRE" }).click();
    await closePopover(page);

    await expectListed(page, ["SRE Weekdays", "SRE Weekends"]);
    expect(await horizontalOverflow(page)).toBe(0);

    // The chip with its pick stays inside the bar (one frame: it just changed).
    const [chipBox, barBox] = (await boxesInOneFrame([
      bar(page).getByTestId("filter-chip").filter({ hasText: "SRE" }),
      bar(page),
    ])) as [FrameBox, FrameBox];

    expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(
      barBox.x + barBox.width + 1,
    );

    await screenshot(page, "filtered-by-team-390");
  });

  test("in dark mode the chips and the filtered list read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, { query: "?theme=dark" });
    await pick(page, "Owner", "SRE");
    await closePopover(page);
    await expectListed(page, ["SRE Weekdays", "SRE Weekends"]);

    // The chip's words on its fill: light text on a dark chip.
    const colours: { text: string } = await chip(page, "Owner").evaluate(
      (element: Element): { text: string } => {
        return { text: getComputedStyle(element).color };
      },
    );

    expect(colours.text).not.toBe("rgb(0, 0, 0)");

    await screenshot(page, "filtered-by-team-1280-dark");
  });

  test("in German, at a phone's width, the chips read in German and still filter", async ({
    page,
  }: {
    page: Page;
  }) => {
    const owner: string = GERMAN["Owner"]!;

    expect(owner).toBeTruthy();

    await openPage(page, { width: 390, query: "?lang=de" });

    await expect(chip(page, owner)).toBeVisible();
    await expect(chip(page, GERMAN["Labels"]!)).toBeVisible();

    const popover: Locator = await openChip(page, owner);

    await expect(
      popover.getByPlaceholder(GERMAN["Search people and teams..."]!),
    ).toBeVisible();

    await offered(popover).filter({ hasText: "SRE" }).click();
    await closePopover(page);

    await expectListed(page, ["SRE Weekdays", "SRE Weekends"]);
    expect(await horizontalOverflow(page)).toBe(0);

    await screenshot(page, "filtered-by-team-390-de");
  });

  /*
   * A chip set brings Saved Views into the list's header. On a phone the
   * three buttons did not fit one line and broke their words - "Create /
   * On-Call / Schedule" three lines tall - and in German "Gespeicherte
   * Ansichten" ran past the card's left edge. Now Saved Views takes a line
   * of its own over the main button and the ⋯, every word on one line.
   */
  for (const language of ["en", "de"]) {
    test(`on a phone, a chip set keeps the header's buttons whole and inside the card (${language})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: (english: string) => string = (english: string): string => {
        return language === "de" ? GERMAN[english]! : english;
      };

      await openPage(page, {
        width: 390,
        query: language === "de" ? "?lang=de" : "",
      });
      await pick(page, words("Owner"), "SRE");
      await closePopover(page);
      await expectListed(page, ["SRE Weekdays", "SRE Weekends"]);

      const boxes: { card: Box; savedViews: Box; create: Box; more: Box } =
        await headerButtons(page, {
          savedViews: words("Saved Views"),
          create: words("Create On-Call Schedule"),
        });

      // Each button's words on one line: no taller than the ⋯ beside it.
      expect(boxes.create.height).toBeLessThanOrEqual(boxes.more.height + 1);
      expect(boxes.savedViews.height).toBeLessThanOrEqual(
        boxes.more.height + 1,
      );

      // All inside the card.
      for (const box of [boxes.savedViews, boxes.create, boxes.more]) {
        expect(box.x).toBeGreaterThanOrEqual(boxes.card.x);
        expect(box.x + box.width).toBeLessThanOrEqual(
          boxes.card.x + boxes.card.width,
        );
      }

      // Saved Views on its own line, over the main button and the ⋯.
      expect(boxes.savedViews.y + boxes.savedViews.height).toBeLessThanOrEqual(
        boxes.create.y,
      );
      expect(Math.abs(boxes.create.y - boxes.more.y)).toBeLessThanOrEqual(2);
      expect(await horizontalOverflow(page)).toBe(0);

      await screenshot(page, `phone-header-with-chip-390-${language}`);
    });
  }

  test("a project with no schedule shows its empty state alone - no chips to filter nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${PAGE_PATH}?schedules=0`);
    await page.evaluate(async (): Promise<void> => {
      await document.fonts.ready;
    });

    await expect(page.getByText("No on-call schedules yet")).toBeVisible();
    await expect(bar(page)).toHaveCount(0);

    // The way forward is still there, in the header and in the empty state.
    await expect(
      page.getByRole("button", { name: "Create On-Call Schedule" }),
    ).toHaveCount(2);

    await finishFirstPaintTransitions(page);
    await screenshot(page, "schedules-empty-1280");
  });

  test("Owner is empty - the schedules nobody owns - can be saved as a view", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);

    // Nothing set, no view yet: nothing to save.
    await expect(page.getByText("Saved Views")).toHaveCount(0);

    await setOperator(page, "Owner", "is_empty");
    await closePopover(page);
    await expectListed(page, ["Nights"]);

    await expect(page.getByText("Saved Views")).toBeVisible();
  });

  test("a member who may not read the schedules' owners gets no Owner chip, and the list is never refused", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, { query: "?role=noowners" });

    await expect(chip(page, "Labels")).toBeVisible();
    await expect(chip(page, "Owner")).toHaveCount(0);
    await expectListed(page, SCHEDULES);
    expect(await latestOwnersFilter(page)).toBeUndefined();

    // Nor are the owner tables read for an Owners column they may not see.
    expect(
      (await fixture(page)).listRequests.filter(
        (request: ListRequest): boolean => {
          return request.model.startsWith("OnCallDutyPolicyScheduleOwner");
        },
      ),
    ).toEqual([]);
  });

  /*
   * The chip's people and teams look as the Owners column under it draws
   * them: Ada Lovelace was violet in the chip and red in the column, and
   * the SRE team a green circle - a person's look - where the column draws
   * a dark tile with a people badge.
   */
  test("the chip draws people and teams as the Owners column does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);

    // Ada owns Database On-Call alone; the SRE team owns SRE Weekdays alone.
    const adaInColumn: Locator = rows(page)
      .filter({ hasText: "Database On-Call" })
      .getByText("AL", { exact: true });
    const sreInColumn: Locator = rows(page)
      .filter({ hasText: "SRE Weekdays" })
      .getByText("S", { exact: true });

    const popover: Locator = await openChip(page, "Owner");

    await expect(offered(popover)).toHaveCount(5);

    const adaInChip: Locator = offered(popover)
      .filter({ hasText: "Ada Lovelace" })
      .getByText("AL", { exact: true });
    const sreOption: Locator = offered(popover).filter({ hasText: "SRE" });
    const sreInChip: Locator = sreOption.getByText("S", { exact: true });

    expect(await fillOf(adaInChip)).toBe(await fillOf(adaInColumn));
    expect(await fillOf(sreInChip)).toBe(await fillOf(sreInColumn));
    // A person and a team never look alike.
    expect(await fillOf(adaInChip)).not.toBe(await fillOf(sreInChip));

    // The team's people badge, as in the column.
    await expect(sreOption.locator("svg")).toHaveCount(1);
    await expect(
      offered(popover).filter({ hasText: "Ada Lovelace" }).locator("svg"),
    ).toHaveCount(0);

    // Picked, the chip shows the team's tile beside its name.
    await sreOption.click();
    await closePopover(page);

    const picked: Locator = chip(page, "Owner").getByText("S", {
      exact: true,
    });

    expect(await fillOf(picked)).toBe(await fillOf(sreInColumn));
    expect((await boxOf(picked)).width).toBeCloseTo(16, 0);

    await screenshot(page, "owner-chip-avatars-1280");
  });

  /*
   * A popover hangs from its chip's left edge. On a 390px phone Labels sits
   * right of Owner, and its popover ran past the screen's edge: the whole
   * page scrolled sideways, the search box half off the screen.
   */
  test("on a 390px phone every chip's popover stays on the screen, 16px from its edge", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, { width: 390 });

    for (const label of ["Labels", "Owner"]) {
      const popover: Locator = await openChip(page, label);

      await expect(offered(popover).first()).toBeVisible();
      await finishFirstPaintTransitions(page);

      const box: Box = await boxOf(popover);

      expect(box.x).toBeGreaterThanOrEqual(16 - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(390 - 16 + 1);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(
        await page.evaluate((): number => {
          return window.scrollX;
        }),
      ).toBe(0);

      // Its search box is where the reader can type into it.
      const search: Box = await boxOf(popover.getByRole("textbox"));

      expect(search.x + search.width).toBeLessThanOrEqual(390);

      if (label === "Labels") {
        await screenshot(page, "labels-chip-open-390");
      }

      await closePopover(page);
    }

    // Still filters from there.
    await pick(page, "Labels", "night-shift");
    await closePopover(page);
    await expectListed(page, ["SRE Weekends", "Nights"]);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("when the people and teams cannot be read, the chip says so, and Try again reads them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, { query: "?fail=people" });

    const popover: Locator = await openChip(page, "Owner");

    await expect(popover.getByText("Couldn't load this list.")).toBeVisible();
    await expect(popover.getByText("Nothing to show")).toHaveCount(0);
    await expect(popover.getByText("No options available")).toHaveCount(0);
    expect((await fixture(page)).failedReads).toBe(1);

    await screenshot(page, "owner-chip-could-not-load-1280");

    await popover.getByRole("button", { name: "Try again" }).click();

    await expect(offered(popover)).toHaveCount(5);
    await expect(popover.getByText("Couldn't load this list.")).toHaveCount(0);

    // And it filters as ever.
    await offered(popover).filter({ hasText: "SRE" }).click();
    await closePopover(page);
    await expectListed(page, ["SRE Weekdays", "SRE Weekends"]);
  });
});

// The fill an avatar is drawn with: its gradient, or its colour.
async function fillOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    const style: CSSStyleDeclaration = getComputedStyle(element);

    return `${style.backgroundImage} ${style.backgroundColor}`;
  });
}
