import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { dashboardWord } from "../SuiteHelpers/LocaleChunks";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Give Feedback (#6832, #8893), in a real browser with production's CSS:
 * opened from Help over a Dashboard page, it asks what the message is
 * about (four kinds, one already picked) and what happened, says in one line
 * exactly what is sent and to whom, and once sent, what happens next.
 *
 * Where it goes is the server's to say (ProductFeedbackSettings'
 * giveFeedbackGoesTo): on OneUptime Cloud, to the OneUptime team, with a
 * copy to the person; on a self-hosted server, to its admins by email when
 * one is set, else kept for them in the Admin Dashboard, without a name.
 * The dialog's words follow it, and say the version the server runs, never
 * the "1.0.0" every page said before #8893.
 *
 * Seen at 1280 pixels and on a phone (390), light and dark, German and
 * Persian. Nothing may leave the fixture server.
 */

const PORT: string = process.env["GIVE_FEEDBACK_FIXTURE_PORT"] || "4797";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const SLOS: string = `/dashboard/${PROJECT_ID}/slos`;
// The route the page is sent as: the pattern it matched, with no id.
const SLOS_ROUTE: string = "/dashboard/:projectId/slos";
const PERSON_EMAIL: string = "maya@acme-commerce.example";
const LONG_EMAIL: string =
  "maya.chen.platform.reliability@observability-team.acme-commerce-international.example";
const GITHUB_NEW_ISSUE: string =
  "https://github.com/OneUptime/oneuptime/issues/new";
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/give-feedback-ui",
);

// The kinds, in the order they are drawn.
const KINDS: Array<string> = ["broken", "confusing", "idea", "other"];

const KIND_NAMES: Array<string> = [
  "Something's broken",
  "Confusing",
  "Idea",
  "Other",
];

interface FixtureState {
  settingsReads: number;
  posts: Array<{ path: string; data: Record<string, unknown> }>;
  unhandled: Array<string>;
}

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
  expect(
    (await fixtureState(page)).unhandled,
    "reads the fixture does not model",
  ).toEqual([]);
});

async function fixtureState(page: Page): Promise<FixtureState> {
  return await page.evaluate((): FixtureState => {
    return (window as unknown as { __giveFeedbackFixture: FixtureState })
      .__giveFeedbackFixture;
  });
}

// The SLOs page, once the server's feedback settings have arrived.
async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${SLOS}${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect
    .poll(async (): Promise<number> => {
      return (await fixtureState(page)).settingsReads;
    })
    .toBe(1);
}

function dialog(page: Page): Locator {
  return page.getByTestId("give-feedback-dialog");
}

async function openFromHelp(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Help" }).click();
  await page
    .getByTestId("help-ask")
    .getByText("Give feedback", { exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
}

// A kind's radio: drawn as its tile, and hidden itself (sr-only).
function kind(page: Page, name: string): Locator {
  return page.getByTestId(`give-feedback-category-${name}`);
}

// What is drawn for each kind: its tile, and the name in it.
function tiles(page: Page): Locator {
  return page.getByTestId("give-feedback-category").locator("label > span");
}

// Picks a kind as a person does: by its tile.
async function pick(page: Page, name: string): Promise<void> {
  await tiles(page).nth(KINDS.indexOf(name)).click();
  await expect(kind(page, name)).toBeChecked();
}

function names(page: Page): Locator {
  return tiles(page).locator(":scope > span");
}

function box(page: Page): Locator {
  return page.getByTestId("give-feedback-details");
}

function attached(page: Page): Locator {
  return page.getByTestId("give-feedback-attached");
}

function sent(page: Page): Locator {
  return page.getByTestId("give-feedback-sent");
}

async function send(page: Page): Promise<void> {
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(sent(page)).toBeVisible();
}

// How many lines each kind's name takes (its line height is 20 pixels).
async function nameLines(page: Page): Promise<Array<number>> {
  const drawn: Array<FrameBox> = await boxesInOneFrame(
    KINDS.map((_: string, index: number): Locator => {
      return names(page).nth(index);
    }),
  );

  return drawn.map((name: FrameBox): number => {
    return Math.round(name.height / 20);
  });
}

async function tileBoxes(page: Page): Promise<Array<FrameBox>> {
  return await boxesInOneFrame(
    KINDS.map((_: string, index: number): Locator => {
      return tiles(page).nth(index);
    }),
  );
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: false,
    animations: "disabled",
  });
}

test.describe("Give Feedback", () => {
  test("self-hosted with no Admin Notification Email: kept for the admins without a name, and once sent, where to read it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openFromHelp(page);

    await expect(page.getByTestId("modal-description")).toHaveText(
      "Tell this server's admins what's broken, confusing or missing.",
    );
    // The version the server runs, never VERSION's "1.0.0" (#8893).
    await expect(attached(page)).toHaveText(
      "Kept for this server's admins with this page (SLOs) and the version (14.3.0), without your name. Nothing leaves this server.",
    );
    await expect(kind(page, "broken")).toBeChecked();
    await expect(page.getByText("What happened?")).toBeVisible();
    await screenshot(page, "give-feedback-kept");

    const words: string =
      "Add SLO does nothing after I pick a monitor and press Save.";

    await box(page).fill(words);
    await send(page);

    await expect(sent(page)).toContainText(
      "This server's admins can read it in the Admin Dashboard, under Feedback.",
    );
    // No copy is promised: nothing is emailed.
    await expect(sent(page)).not.toContainText("A copy is on its way");

    const github: Locator = page.getByTestId("give-feedback-github");

    // It says it is public, and that nothing is posted until the person posts it (#7462).
    await expect(github).toHaveText(
      "Also tell OneUptime in a public GitHub issue",
    );
    await expect(page.getByTestId("feedback-github-hint")).toHaveText(
      "It opens with your words filled in, and nothing is posted until you post it.",
    );
    // A new issue on OneUptime's GitHub, filled in for the person to read.
    expect(
      (await github.getAttribute("href"))?.startsWith(`${GITHUB_NEW_ISSUE}?`),
    ).toBe(true);

    // The link lines up with the words beside the tick, not with the tick.
    const [headline, link]: Array<FrameBox> = await boxesInOneFrame([
      sent(page).locator("p").first(),
      github,
    ]);

    expect(Math.abs(headline!.x - link!.x)).toBeLessThanOrEqual(1);

    // What went: the words and their kind, the page's route and the version.
    const posts: FixtureState["posts"] = (await fixtureState(page)).posts;

    expect(posts).toHaveLength(1);
    expect(posts[0]!.data).toMatchObject({
      kind: "general",
      topic: "broken",
      details: words,
      page: SLOS_ROUTE,
      version: "14.3.0",
    });
    await screenshot(page, "give-feedback-kept-sent");
  });

  test("self-hosted with an Admin Notification Email: to the admins with the person's name and email, and nothing to OneUptime", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "goes=server_admins_by_email");
    await openFromHelp(page);

    await expect(attached(page)).toHaveText(
      `Sent to this server's admins with your name and email (${PERSON_EMAIL}), your project, this page (SLOs) and the version (14.3.0). Nothing is sent to OneUptime.`,
    );

    await pick(page, "confusing");
    await expect(page.getByText("What was confusing?")).toBeVisible();
    await box(page).fill("I could not tell which SLO window the chart shows.");
    await send(page);

    await expect(sent(page)).toContainText("Sent to this server's admins.");
    await expect(sent(page)).toContainText(
      `A copy is on its way to ${PERSON_EMAIL}, and any reply will come there too.`,
    );
    await expect(page.getByTestId("give-feedback-github")).toBeVisible();
    expect((await fixtureState(page)).posts[0]!.data).toMatchObject({
      topic: "confusing",
    });
  });

  test("on OneUptime Cloud: to the OneUptime team, a copy to the person, and no GitHub link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "goes=oneuptime_team");
    await openFromHelp(page);

    await expect(page.getByTestId("modal-description")).toHaveText(
      "Tell the OneUptime team what's broken, confusing or missing. We read every message.",
    );
    await expect(attached(page)).toHaveText(
      `Sent to the OneUptime team with your name and email (${PERSON_EMAIL}), your project, this page (SLOs) and the version (14.3.0).`,
    );

    // Each kind asks its own question.
    await pick(page, "idea");
    await expect(page.getByText("What's your idea?")).toBeVisible();
    await expect(box(page)).toHaveAttribute(
      "placeholder",
      "What would you like to be able to do, and what would it help you with?",
    );
    await box(page).fill(
      "Let me copy an SLO with its alerting rules, so a second checkout service starts from the first one's.",
    );
    await screenshot(page, "give-feedback-cloud");
    await send(page);

    await expect(sent(page)).toContainText("Sent to the OneUptime team.");
    await expect(sent(page)).toContainText(
      `A copy is on its way to ${PERSON_EMAIL}, and any reply will come there too.`,
    );
    await expect(page.getByTestId("give-feedback-github")).toHaveCount(0);
    expect((await fixtureState(page)).posts[0]!.data).toMatchObject({
      kind: "general",
      topic: "idea",
      page: SLOS_ROUTE,
      version: "14.3.0",
    });
    await screenshot(page, "give-feedback-cloud-sent");
  });

  test("starts in the message box, from Help and from the check-in, with the kinds a Shift+Tab away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openFromHelp(page);

    await expect(box(page)).toBeFocused();

    // Back to the kinds, and along them with the arrow keys.
    await page.keyboard.press("Shift+Tab");
    await expect(kind(page, "broken")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(kind(page, "confusing")).toBeChecked();
    await expect(page.getByText("What was confusing?")).toBeVisible();

    // The kind the keyboard is on shows a ring round its tile.
    expect(
      await tiles(page)
        .nth(1)
        .evaluate((tile: Element): string => {
          return getComputedStyle(tile).boxShadow;
        }),
    ).not.toBe("none");

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    // The first-week check-in opens it on Idea, in the box too.
    await page.getByTestId("fixture-open-from-check-in").click();
    await expect(kind(page, "idea")).toBeChecked();
    await expect(box(page)).toBeFocused();
    await expect(box(page)).toHaveValue("");
  });

  test("each kind's name on one line: a row of four on a desktop, two by two on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "goes=oneuptime_team");
    await openFromHelp(page);

    await expect(names(page)).toHaveText(KIND_NAMES);
    expect(await nameLines(page)).toEqual([1, 1, 1, 1]);

    const row: Array<FrameBox> = await tileBoxes(page);

    for (const tile of row) {
      expect(Math.abs(tile.y - row[0]!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(tile.height - row[0]!.height)).toBeLessThanOrEqual(1);
    }

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    expect(await nameLines(page)).toEqual([1, 1, 1, 1]);

    const grid: Array<FrameBox> = await tileBoxes(page);

    expect(Math.abs(grid[0]!.y - grid[1]!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(grid[2]!.y - grid[3]!.y)).toBeLessThanOrEqual(1);
    expect(grid[2]!.y).toBeGreaterThan(grid[0]!.y + grid[0]!.height);
    await screenshot(page, "give-feedback-phone");
  });

  test("on a phone, an address longer than a line wraps inside the dialog, before and after sending", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await open(page, "goes=server_admins_by_email&email=long");
    await openFromHelp(page);

    await expect(attached(page)).toContainText(LONG_EMAIL);
    await expectNoSidewaysScroll(page);

    const [panel, line]: Array<FrameBox> = await boxesInOneFrame([
      page.getByTestId("modal"),
      attached(page),
    ]);

    expect(line!.x + line!.width).toBeLessThanOrEqual(panel!.x + panel!.width);

    await box(page).fill("The SLO list scrolls sideways on my phone.");
    await send(page);

    await expect(sent(page)).toContainText(LONG_EMAIL);
    await expectNoSidewaysScroll(page);

    const [sentPanel, words]: Array<FrameBox> = await boxesInOneFrame([
      page.getByTestId("modal"),
      sent(page),
    ]);

    expect(words!.x + words!.width).toBeLessThanOrEqual(
      sentPanel!.x + sentPanel!.width,
    );
    await screenshot(page, "give-feedback-phone-long-address-sent");
  });

  test("in the dark, the picked kind and the rest are drawn in the dark theme's colours", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "goes=oneuptime_team&theme=dark");
    await openFromHelp(page);

    const backgrounds: Array<string> = await tiles(page).evaluateAll(
      (elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return getComputedStyle(element).backgroundColor;
        });
      },
    );

    // Not the light theme's white, nor its pale indigo for the picked kind.
    for (const background of backgrounds) {
      expect(background).not.toBe("rgb(255, 255, 255)");
      expect(background).not.toBe("rgb(238, 242, 255)");
    }

    // The picked kind still stands out from the others.
    expect(backgrounds[0]).not.toBe(backgrounds[1]);
    await screenshot(page, "give-feedback-dark");
  });

  test("in German, every word is German, and a long kind's name wraps inside its tile with its row grown to match", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await open(page, "lang=de&open=help");
    await expect(dialog(page)).toBeVisible();

    await expect(page.getByTestId("modal-title")).toHaveText(
      dashboardWord("de", "Give Feedback"),
    );
    await expect(names(page)).toHaveText(
      KIND_NAMES.map((name: string): string => {
        return dashboardWord("de", name);
      }),
    );
    await expect(
      page.getByText(dashboardWord("de", "What happened?")),
    ).toBeVisible();
    await expect(attached(page)).toHaveText(
      dashboardWord(
        "de",
        "Kept for this server's admins with this page ({{page}}) and the version ({{version}}), without your name. Nothing leaves this server.",
      )
        .replace("{{page}}", dashboardWord("de", "SLOs"))
        .replace("{{version}}", "14.3.0"),
    );

    // "Etwas funktioniert nicht" takes two lines, and its row grows with it.
    expect((await nameLines(page))[0]).toBeGreaterThan(1);

    const grid: Array<FrameBox> = await tileBoxes(page);

    expect(Math.abs(grid[0]!.height - grid[1]!.height)).toBeLessThanOrEqual(1);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "give-feedback-de");
  });

  test("in Persian, it reads right to left: the first kind on the right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "lang=fa&open=help");
    await expect(dialog(page)).toBeVisible();

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("modal-title")).toHaveText(
      dashboardWord("fa", "Give Feedback"),
    );

    const row: Array<FrameBox> = await tileBoxes(page);

    expect(row[0]!.x).toBeGreaterThan(row[1]!.x);
    expect(row[1]!.x).toBeGreaterThan(row[2]!.x);
    await expect(box(page)).toBeFocused();
    await screenshot(page, "give-feedback-fa");
  });
});
