import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Ask AI beside the page, in real Chromium, against the offline fixture
 * (Fixture/Fixture.js): the production panel (AskAiPanel) and everything in it,
 * docked beside a Dashboard page, with only the data boundary replaced.
 *
 * The maintainer, of Ask AI (issue #5597): "It should basically be on the
 * side, so I can still do like everything on the left side in oneuptime (go
 * to different pages) investigate stuff and ask AI again."
 *
 * Every test pins the browser clock, fences the network to the fixture
 * server, and fails on an uncaught page error or on a request the fixture
 * does not model. Screenshots land in output/playwright/ask-ai-ui.
 */

const PORT: string = process.env["ASK_AI_FIXTURE_PORT"] || "4557";
const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const INCIDENT_ID: string = "20000000-0000-4000-8000-000000000042";
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const INCIDENT_PATH: string = `${DASHBOARD}/incidents/${INCIDENT_ID}`;
const HOME_PATH: string = `${DASHBOARD}/home/`;
const NOW: Date = new Date("2026-10-27T15:00:00.000Z");

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/ask-ai-ui",
);

const LATENCY_QUESTION: string =
  "Why did checkout latency spike this afternoon?";
const EXPLAIN_PROMPT: string =
  "Explain this error pattern: 'connection pool exhausted' in checkout-api, 4,812 times since 14:00.";
const HOME_SENTENCE: string =
  "It answers from your project's live data, and can create incidents and alerts with your approval.";
const INCIDENT_CHIP: string = "This incident · #42 Checkout latency above 2s";
const INCIDENT_SUGGESTIONS: Array<string> = [
  "Summarize",
  "Find root cause",
  "What changed?",
  "Draft status update",
];
const GENERIC_SUGGESTIONS: Array<string> = [
  "Latency chart",
  "Error volume",
  "Top exceptions",
  "Investigate & act",
];

interface SentQuestion {
  content: string;
  conversationId?: string;
  llmProviderId?: string;
  permissionMode?: string;
  pageContext?: {
    type: string;
    entityId?: string;
    entityTitle?: string;
  } | null;
}

interface FixtureState {
  sent: Array<SentQuestion>;
  approvals: Array<{
    conversationId: string;
    assistantMessageId: string;
    decisions: Array<{ toolCallId: string; approved: boolean }>;
  }>;
  feedback: Array<{ messageId: string; feedback: string | null }>;
  cancelled: number;
  deleted: Array<string>;
  unhandled: Array<string>;
}

interface ConversationIds {
  answered: string;
  approval: string;
  error: string;
}

interface AskAiFixture {
  ready?: boolean;
  state: FixtureState;
  conversationIds: ConversationIds;
  addSteps: (count: number) => void;
  finish: () => void;
  navigate: (path: string) => void;
}

interface Quiet {
  words: number;
  lines: number;
  elements: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A monospace family, as the Dashboard writes code.
const MONOSPACE: RegExp = /mono|Menlo|Consolas|Courier/i;

// A table's date under the pointer: the whole of it, and how long ago it was.
const WHOLE_DATE_UNDER_THE_POINTER: RegExp =
  /^Oct 27 2026, 02:57 PM \S+ · 3 minutes ago$/;

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
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
    await route.abort();
  });

  // Every fixture date is relative to NOW; timers keep running.
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

  const unhandled: Array<string> | null = await page
    .evaluate((): Array<string> | null => {
      const fixture: AskAiFixture | undefined = (
        window as unknown as { __askAiFixture?: AskAiFixture }
      ).__askAiFixture;
      return fixture ? fixture.state.unhandled : null;
    })
    .catch((): null => {
      return null;
    });

  if (unhandled) {
    expect(unhandled, "requests the fixture does not model").toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function load(
  page: Page,
  query: string = "",
  pathname: string = "/",
): Promise<void> {
  await page.goto(`${pathname}?${query}`);
  await page.waitForFunction((): boolean => {
    return Boolean(
      (window as unknown as { __askAiFixture?: AskAiFixture }).__askAiFixture
        ?.ready,
    );
  });
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("fixture-page")).toBeVisible();
}

function askAi(page: Page): Locator {
  return page.getByTestId("ask-ai-panel");
}

function composer(page: Page): Locator {
  return page.getByTestId("ai-chat-composer").locator("textarea");
}

function headerAskAi(page: Page): Locator {
  return page.getByTestId("fixture-page").getByRole("button", {
    name: /Ask AI|KI fragen|پرسش از هوش مصنوعی/,
  });
}

async function state(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return (window as unknown as { __askAiFixture: AskAiFixture })
      .__askAiFixture.state;
  });
}

async function conversationIds(page: Page): Promise<ConversationIds> {
  return page.evaluate((): ConversationIds => {
    return (window as unknown as { __askAiFixture: AskAiFixture })
      .__askAiFixture.conversationIds;
  });
}

async function addSteps(page: Page, count: number): Promise<void> {
  await page.evaluate((stepCount: number): void => {
    (
      window as unknown as { __askAiFixture: AskAiFixture }
    ).__askAiFixture.addSteps(stepCount);
  }, count);
}

async function finishAnswer(page: Page): Promise<void> {
  await page.evaluate((): void => {
    (
      window as unknown as { __askAiFixture: AskAiFixture }
    ).__askAiFixture.finish();
  });
}

async function navigateInApp(page: Page, to: string): Promise<void> {
  await page.evaluate((target: string): void => {
    (
      window as unknown as { __askAiFixture: AskAiFixture }
    ).__askAiFixture.navigate(target);
  }, to);
}

// Opens Ask AI as a person does: the header's button.
async function openAskAi(page: Page): Promise<void> {
  await headerAskAi(page).click();
  await expect(askAi(page)).toBeVisible();
  await settle(page);
}

async function ask(page: Page, question: string): Promise<void> {
  await composer(page).fill(question);
  await composer(page).press("Enter");
  await expect(
    page.getByTestId("ai-chat-question").filter({ hasText: question }),
  ).toBeVisible();
}

// Every finite animation finished: the panel's entrance, an answer's rise.
async function settle(page: Page): Promise<void> {
  await page.waitForFunction((): boolean => {
    return document.getAnimations().every((animation: Animation): boolean => {
      const timing: ComputedEffectTiming | undefined =
        animation.effect?.getComputedTiming();
      return (
        !timing ||
        timing.iterations === Infinity ||
        animation.playState !== "running"
      );
    });
  });
  await page.waitForTimeout(100);
}

/*
 * The width this browser kept for the panel, as if the person had dragged it
 * there before the page loaded.
 */
async function keepPanelWidth(page: Page, width: number): Promise<void> {
  await page.addInitScript((kept: number): void => {
    window.localStorage.setItem("ask-ai-panel-width", String(kept));
  }, width);
}

// Drags the panel's edge by a distance: negative is towards the window's left.
async function dragEdge(page: Page, distance: number): Promise<void> {
  const edge: Box = await boxOf(page.getByTestId("ask-ai-resize"));
  const x: number = edge.x + edge.width / 2;

  await page.mouse.move(x, 400);
  await page.mouse.down();
  await page.mouse.move(x + distance, 400, { steps: 5 });
  await page.mouse.up();
}

async function widthOf(locator: Locator): Promise<number> {
  return Math.round((await boxOf(locator)).width);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box, "a box on screen").not.toBeNull();
  return box as Box;
}

// What the panel says: its words, lines of text and elements.
async function quietness(page: Page): Promise<Quiet> {
  return page.evaluate((): Quiet => {
    const root: HTMLElement | null = document.querySelector(
      '[data-testid="ask-ai-panel"]',
    );
    const text: string = root?.innerText || "";
    return {
      words: text.split(/\s+/).filter(Boolean).length,
      lines: text.split("\n").filter((line: string): boolean => {
        return line.trim().length > 0;
      }).length,
      elements: root ? root.querySelectorAll("*").length : 0,
    };
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) });
}

/*
 * The Dashboard's words in a language, from the locale file the fixture
 * draws them from: a test about what a card says reads its words there, so
 * a translator rewording one breaks nothing - a word the card never looks
 * up does.
 */
function dashboardWords(language: string): Record<string, string> {
  return JSON.parse(
    readFileSync(
      path.resolve(
        __dirname,
        "../../App/FeatureSet/Dashboard/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// A sentence of the language with its values in, as the card fills it.
function filled(
  words: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  let text: string | undefined = words[key];
  expect(text, `the locale words "${key}"`).toBeTruthy();

  for (const name of Object.keys(values)) {
    text = text!.split(`{{${name}}}`).join(values[name]!);
  }

  return text!;
}

// LRI, RLI, FSI and PDI: the marks a sentence sets its values apart with.
const ISOLATE_MARKS: RegExp = /[\u2066-\u2069]/g;

// What an element says, without the marks that set its values apart.
async function wordsOf(locator: Locator): Promise<string> {
  const text: string = await locator.evaluate((element: Element): string => {
    return element.textContent || "";
  });
  return text.replace(ISOLATE_MARKS, "");
}

// The approval card's one action: its title, its line and its Allow / Skip.
interface ApprovalAction {
  box: Box;
  title: Box;
  choice: Box;
}

async function approvalActionBoxes(page: Page): Promise<ApprovalAction> {
  const action: Locator = page.getByTestId("tool-approval-action");
  const [box, title, choice] = await boxesInOneFrame([
    action,
    action.getByTestId("tool-approval-title"),
    action.getByTestId("tool-approval-choice"),
  ]);
  return { box: box!, title: title!, choice: choice! };
}

/*
 * Nothing is wider than the screen: no sideways scroll, in the page or the
 * panel - each read until it has settled.
 */
async function expectNothingScrollsSideways(page: Page): Promise<void> {
  await expectNoSidewaysScroll(page);
  await expect
    .poll(
      (): Promise<number> => {
        return page.evaluate((): number => {
          const root: HTMLElement | null = document.querySelector(
            '[data-testid="ask-ai-panel"]',
          );
          return root ? root.scrollWidth - root.clientWidth : 0;
        });
      },
      { message: "how many pixels the Ask AI panel scrolls sideways" },
    )
    .toBeLessThanOrEqual(0);
}

/*
 * ---------------------------------------------------------------------------
 * Every way in
 * ---------------------------------------------------------------------------
 */

test.describe("Ask AI beside the page", () => {
  test("the header's Ask AI opens it at the side of the window, and the page makes room", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    const panel: Locator = page.getByRole("complementary", { name: "Ask AI" });
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveAttribute("aria-modal", "true");

    // The whole height of the window, at its end.
    expect(await boxOf(panel)).toEqual({
      x: 840,
      y: 0,
      width: 440,
      height: 800,
    });

    // The page ends where it starts: nothing dims it, nothing is behind it.
    const beside: Box = await boxOf(page.getByTestId("fixture-page"));
    expect(beside.x).toBe(0);
    expect(beside.width).toBe(840);
    await expect(page.getByTestId("ask-ai-backdrop")).toHaveCount(0);

    // The question is the first thing it asks for.
    await expect(composer(page)).toBeFocused();
    // And the way in, still in sight, says it is open.
    await expect(headerAskAi(page)).toHaveAttribute("aria-pressed", "true");

    await screenshot(page, "start-incident-1280");
  });

  for (const width of [1024, 1280, 1920]) {
    test(`nothing on the page is behind it (${width})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 800 });
      await load(page);
      await openAskAi(page);

      const panel: Box = await boxOf(askAi(page));
      const furthest: number = await page
        .getByTestId("fixture-page")
        .evaluate((root: Element): number => {
          let end: number = 0;

          for (const element of Array.from(root.querySelectorAll("*"))) {
            const rect: DOMRect = element.getBoundingClientRect();

            if (rect.width > 0) {
              end = Math.max(end, rect.right);
            }
          }

          return end;
        });

      expect(furthest).toBeGreaterThan(0);
      expect(furthest).toBeLessThanOrEqual(panel.x);
      await expectNothingScrollsSideways(page);
      await screenshot(page, `beside-the-page-${width}`);
    });
  }

  test("the page stays all there: not inert, and what is on it scrolls and answers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await load(page);
    await openAskAi(page);

    expect(
      await page.evaluate((): { inert: boolean; overflow: string } => {
        return {
          inert: document.getElementById("root")!.hasAttribute("inert"),
          overflow: document.body.style.overflow,
        };
      }),
    ).toEqual({ inert: false, overflow: "" });

    // It scrolls under the wheel, with the panel where it was.
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 200);
    await expect
      .poll((): Promise<number> => {
        return page.evaluate((): number => {
          return window.scrollY;
        });
      })
      .toBeGreaterThan(0);
    expect((await boxOf(askAi(page))).y).toBe(0);

    // Its buttons take a click and the focus, and the panel stays.
    const search: Locator = page.getByTestId("fixture-page-button");
    await search.click();
    await expect(search).toBeFocused();
    await expect(askAi(page)).toBeVisible();

    // The keyboard leaves it too: nothing keeps the focus inside.
    await composer(page).focus();
    let isOutside: boolean = false;

    for (let index: number = 0; index < 12 && !isOutside; index++) {
      await page.keyboard.press("Tab");
      isOutside = await page.evaluate((): boolean => {
        return !document.activeElement?.closest('[data-testid="ask-ai-panel"]');
      });
    }

    expect(isOutside).toBe(true);
  });

  test("it stays while the person goes to other pages, and what it asks about follows them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toBeVisible();
    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
    const asked: Locator = page
      .getByTestId("ai-chat-question")
      .filter({ hasText: LATENCY_QUESTION });

    await page.getByTestId("fixture-link-logs").click();

    await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
    await expect(askAi(page)).toBeVisible();
    await expect(asked).toBeVisible();
    await expect(page.getByTestId("ai-chat-context")).toHaveText("Logs");

    await page.getByTestId("fixture-link-home").click();

    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(asked).toBeVisible();
    await expect(page.getByTestId("ai-chat-context")).toHaveCount(0);

    await page.getByTestId("fixture-link-incident").click();

    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
    await expect(asked).toBeVisible();
  });

  test("the start's suggestions, and the next question, are the page's on screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText(
      INCIDENT_SUGGESTIONS,
    );

    await page.getByTestId("fixture-link-home").click();

    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText(
      GENERIC_SUGGESTIONS,
    );

    await page.getByTestId("fixture-link-incident").click();
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText(
      INCIDENT_SUGGESTIONS,
    );
    // Its title read, as the pill says: the question goes out with it.
    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
    await ask(page, LATENCY_QUESTION);

    expect((await state(page)).sent).toEqual([
      expect.objectContaining({
        content: LATENCY_QUESTION,
        pageContext: {
          type: "Incident",
          entityId: INCIDENT_ID,
          entityTitle: "#42 Checkout latency above 2s",
        },
      }),
    ]);
  });

  test("the keys: Ctrl + I opens it, goes back to it from the page, and closes it from inside; Esc is the page's on the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    const search: Locator = page.getByTestId("fixture-page-button");
    await search.focus();

    await page.keyboard.press("Control+i");
    await expect(askAi(page)).toBeVisible();
    await expect(composer(page)).toBeFocused();

    // Working on the page beside it, Esc is the page's.
    await search.focus();
    await page.keyboard.press("Escape");
    await expect(askAi(page)).toBeVisible();

    // The same keys go back to the box, to ask the next question.
    await page.keyboard.press("Control+i");
    await expect(askAi(page)).toBeVisible();
    await expect(composer(page)).toBeFocused();

    // From inside it, Esc closes it, and the focus goes back.
    await page.keyboard.press("Escape");
    await expect(askAi(page)).toBeHidden();
    await expect(search).toBeFocused();

    await page.keyboard.press("Meta+i");
    await expect(askAi(page)).toBeVisible();
    // In its own composer, which has no italics, the keys close it again.
    await page.keyboard.press("Control+i");
    await expect(askAi(page)).toBeHidden();
  });

  test("pressed again, the header's Ask AI gives the page its whole width back, and leaves the focus alone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);
    await expect(headerAskAi(page)).toHaveAttribute("aria-pressed", "true");

    await headerAskAi(page).click();

    await expect(askAi(page)).toBeHidden();
    await expect(headerAskAi(page)).toHaveAttribute("aria-pressed", "false");
    await expect(headerAskAi(page)).toBeFocused();
    expect((await boxOf(page.getByTestId("fixture-page"))).width).toBe(1280);
    expect(
      await page.evaluate((): string => {
        return document.documentElement.getAttribute("style") || "";
      }),
    ).not.toContain("--page-dock-width");
  });

  test("one of the app's own side panels opens beside it, not behind it, and it still answers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    await page.getByTestId("fixture-open-side-over").click();
    await expect(page.getByTestId("side-over-title")).toBeVisible();
    await settle(page);

    const panel: Box = await boxOf(askAi(page));
    const layer: Box = await boxOf(page.getByTestId("side-over-layer"));
    expect(layer.x + layer.width).toBe(panel.x);
    await screenshot(page, "side-over-beside-1280");

    await composer(page).click();
    await composer(page).fill(LATENCY_QUESTION);
    await expect(composer(page)).toHaveValue(LATENCY_QUESTION);
    await expect(page.getByTestId("side-over-title")).toBeVisible();
  });

  test("Explain with AI opens a new conversation with its question in the composer, unsent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "page=logs");

    await page.getByTestId("fixture-explain-with-ai").click();

    await expect(askAi(page)).toBeVisible();
    await expect(composer(page)).toHaveValue(EXPLAIN_PROMPT);
    await expect(page.getByTestId("ai-chat-context")).toHaveText("Logs");
    expect((await state(page)).sent).toEqual([]);

    // With the panel already open, it still goes to the box the question is in.
    await page.getByTestId("fixture-page-button").focus();
    await page.getByTestId("fixture-explain-with-ai").click();

    await expect(askAi(page)).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveValue(EXPLAIN_PROMPT);
  });

  test("the chat's own address opens the panel beside the page the person came from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "history=some");
    const ids: ConversationIds = await conversationIds(page);

    // A link to one conversation, followed inside the app.
    await navigateInApp(page, `${DASHBOARD}/ai/chat/${ids.answered}`);

    await expect(askAi(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${INCIDENT_PATH}\\?`));
    await expect(
      page
        .getByTestId("ai-chat-question")
        .filter({ hasText: LATENCY_QUESTION }),
    ).toBeVisible();
    // The page beside it is the incident, and the next question is about it.
    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
  });

  test("opened at its own address, the panel opens beside Home", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "history=some");
    const ids: ConversationIds = await conversationIds(page);

    await load(page, "history=some", `${DASHBOARD}/ai/chat/${ids.answered}`);

    await expect(askAi(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${HOME_PATH}`));
    await expect(
      page
        .getByTestId("ai-chat-question")
        .filter({ hasText: LATENCY_QUESTION }),
    ).toBeVisible();

    // Closing it leaves the person on a page, never on an empty one.
    await page.keyboard.press("Escape");
    await expect(askAi(page)).toBeHidden();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Its edge
 * ---------------------------------------------------------------------------
 */

test.describe("its edge", () => {
  test("drags to the width the work needs, the page following, and is kept for the next time", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);
    const edge: Locator = page.getByTestId("ask-ai-resize");
    await expect(edge).toHaveAttribute("role", "separator");
    await expect(edge).toHaveAttribute("aria-valuenow", "440");

    await dragEdge(page, -160);

    expect(await widthOf(askAi(page))).toBe(600);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(680);
    await expect(edge).toHaveAttribute("aria-valuenow", "600");
    await screenshot(page, "dragged-wider-1280");

    await load(page);
    await openAskAi(page);

    expect(await widthOf(askAi(page))).toBe(600);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(680);
  });

  test("never narrower than it can be used, and never so wide the page has no room", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    await dragEdge(page, -1000);
    expect(await widthOf(askAi(page))).toBe(640);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(640);

    await dragEdge(page, 1000);
    expect(await widthOf(askAi(page))).toBe(340);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(940);
    await expectNothingScrollsSideways(page);
    await screenshot(page, "narrowest-1280");
  });

  test("a press that moves nothing keeps nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    await dragEdge(page, 0);

    expect(
      await page.evaluate((): string | null => {
        return window.localStorage.getItem("ask-ai-panel-width");
      }),
    ).toBeNull();
  });

  test("a double click puts it back at the width it opens at", async ({
    page,
  }: {
    page: Page;
  }) => {
    await keepPanelWidth(page, 600);
    await load(page);
    await openAskAi(page);
    expect(await widthOf(askAi(page))).toBe(600);

    await page.getByTestId("ask-ai-resize").dblclick();

    expect(await widthOf(askAi(page))).toBe(440);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(840);
  });

  test("by keyboard: the arrows move it the way they point, Home and End to its ends", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);
    const edge: Locator = page.getByTestId("ask-ai-resize");
    await edge.focus();

    await page.keyboard.press("ArrowLeft");
    await expect(edge).toHaveAttribute("aria-valuenow", "464");
    expect(await widthOf(askAi(page))).toBe(464);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(816);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(edge).toHaveAttribute("aria-valuenow", "416");

    await page.keyboard.press("Home");
    await expect(edge).toHaveAttribute("aria-valuenow", "340");

    await page.keyboard.press("End");
    await expect(edge).toHaveAttribute("aria-valuenow", "640");
    await expect(edge).toHaveAttribute("aria-valuemin", "340");
    await expect(edge).toHaveAttribute("aria-valuemax", "640");
    expect(await widthOf(askAi(page))).toBe(640);
  });

  test("a window made narrower narrows it for the page's sake, and made wide again puts it back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    await page.setViewportSize({ width: 1024, height: 800 });
    await expect
      .poll((): Promise<number> => {
        return widthOf(askAi(page));
      })
      .toBe(384);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(640);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect
      .poll((): Promise<number> => {
        return widthOf(askAi(page));
      })
      .toBe(440);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(840);
  });

  test("a window with no room for both makes it a sheet, and everything in it stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toHaveAttribute("data-docked", "true");
    const asked: Locator = page
      .getByTestId("ai-chat-question")
      .filter({ hasText: LATENCY_QUESTION });
    await composer(page).fill("And what about payments?");

    await page.setViewportSize({ width: 800, height: 800 });

    await expect(askAi(page)).toHaveAttribute("data-docked", "false");
    await expect(askAi(page)).toHaveAttribute("role", "dialog");
    await expect(page.getByTestId("ask-ai-resize")).toHaveCount(0);
    await expect(asked).toBeVisible();
    await expect(composer(page)).toHaveValue("And what about payments?");
    expect(
      await page.evaluate((): boolean => {
        return document.getElementById("root")!.hasAttribute("inert");
      }),
    ).toBe(true);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(800);

    await page.setViewportSize({ width: 1280, height: 800 });

    await expect(askAi(page)).toHaveAttribute("data-docked", "true");
    await expect(asked).toBeVisible();
    await expect(composer(page)).toHaveValue("And what about payments?");
    expect(
      await page.evaluate((): boolean => {
        return document.getElementById("root")!.hasAttribute("inert");
      }),
    ).toBe(false);
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(840);
  });

  test("right to left it docks at the left, the page beside it, and its edge drags the way it is pulled", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=fa");
    await openAskAi(page);

    expect(await boxOf(askAi(page))).toEqual({
      x: 0,
      y: 0,
      width: 440,
      height: 800,
    });
    const beside: Box = await boxOf(page.getByTestId("fixture-page"));
    expect(beside.x).toBe(440);
    expect(beside.width).toBe(840);
    await screenshot(page, "beside-the-page-1280-fa");

    await dragEdge(page, 100);

    expect(await widthOf(askAi(page))).toBe(540);
    expect((await boxOf(page.getByTestId("fixture-page"))).x).toBe(540);

    const edge: Locator = page.getByTestId("ask-ai-resize");
    await edge.focus();
    await page.keyboard.press("ArrowRight");
    await expect(edge).toHaveAttribute("aria-valuenow", "564");
    await page.keyboard.press("ArrowLeft");
    await expect(edge).toHaveAttribute("aria-valuenow", "540");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The start
 * ---------------------------------------------------------------------------
 */

test.describe("the start", () => {
  test("on an incident: one question, the incident in the composer's pill, and the incident's own suggestions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    await expect(askAi(page).getByRole("heading", { level: 3 })).toHaveText(
      "What would you like to know?",
    );
    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
    // What the pill says is not said again under the question.
    await expect(askAi(page).getByText(HOME_SENTENCE)).toHaveCount(0);

    const chips: Locator = page.getByTestId("ai-chat-suggestion");
    await expect(chips).toHaveText(INCIDENT_SUGGESTIONS);
    await expect(chips.first()).toHaveAttribute(
      "title",
      "Summarize this incident: what happened, its current state, and the impact.",
    );

    // The question, then the suggestions, then the box at the panel's foot.
    const heading: Box = await boxOf(
      askAi(page).getByRole("heading", { level: 3 }),
    );
    const suggestions: Box = await boxOf(
      page.getByTestId("ai-chat-suggestions"),
    );
    const box: Box = await boxOf(page.getByTestId("ai-chat-composer"));
    expect(heading.y).toBeLessThan(suggestions.y);
    expect(suggestions.y + suggestions.height).toBeLessThanOrEqual(box.y);
    expect(800 - (box.y + box.height)).toBeLessThanOrEqual(16);

    // Quiet: the start is a handful of words, not eight cards and two paragraphs.
    const quiet: Quiet = await quietness(page);
    expect(quiet.words).toBeLessThanOrEqual(30);
    expect(quiet.elements).toBeLessThanOrEqual(110);
  });

  test("the start sits in the middle of the room over the composer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    const panel: Box = await boxOf(askAi(page));
    const start: Box = await boxOf(page.getByTestId("ai-chat-home"));
    const box: Box = await boxOf(page.getByTestId("ai-chat-composer"));
    // Under the 64px header, its middle is the middle of what is left.
    const roomTop: number = panel.y + 64;
    const roomMiddle: number = roomTop + (box.y - 4 - roomTop) / 2;
    expect(
      Math.abs(start.y + start.height / 2 - roomMiddle),
    ).toBeLessThanOrEqual(2);
  });

  test("the box stays where it is as the first question is sent: the next goes where this one went", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);
    const before: Box = await boxOf(page.getByTestId("ai-chat-composer"));

    await composer(page).fill(LATENCY_QUESTION);
    await composer(page).press("Enter");
    await expect(page.getByTestId("ai-chat-live")).toBeVisible();
    await settle(page);

    const after: Box = await boxOf(page.getByTestId("ai-chat-composer"));
    expect(after.x).toBe(before.x);
    expect(after.width).toBe(before.width);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    // The focus stayed in it, as the composer itself stayed.
    await expect(composer(page)).toBeFocused();
  });

  test("a suggestion picked keeps the focus in the panel, on the box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);

    await page
      .getByTestId("ai-chat-suggestion")
      .filter({ hasText: "Summarize" })
      .click();

    await expect(page.getByTestId("ai-chat-live")).toBeVisible();
    await expect(composer(page)).toBeFocused();
  });

  test("a suggestion asks its question about the incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);

    await page
      .getByTestId("ai-chat-suggestion")
      .filter({ hasText: "Summarize" })
      .click();

    await expect(page.getByTestId("ai-chat-live")).toBeVisible();
    expect((await state(page)).sent).toEqual([
      expect.objectContaining({
        content:
          "Summarize this incident: what happened, its current state, and the impact.",
        permissionMode: "AskForApproval",
        pageContext: {
          type: "Incident",
          entityId: INCIDENT_ID,
          entityTitle: "#42 Checkout latency above 2s",
        },
      }),
    ]);
  });

  test("the pill can be cleared, which asks about the whole project, and brought back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    await page.getByRole("button", { name: "Remove page context" }).click();

    await expect(page.getByTestId("ai-chat-context")).toHaveCount(0);
    await expect(askAi(page).getByText(HOME_SENTENCE)).toBeVisible();
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText(
      GENERIC_SUGGESTIONS,
    );

    const attach: Locator = page.getByTestId("ai-chat-context-attach");
    await expect(attach).toHaveText("This incident");
    await attach.click();

    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText(
      INCIDENT_SUGGESTIONS,
    );
  });

  test("with no page behind it, one sentence says where answers come from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "page=home");
    await openAskAi(page);

    await expect(page.getByTestId("ai-chat-context")).toHaveCount(0);
    await expect(askAi(page).getByText(HOME_SENTENCE)).toBeVisible();
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText(
      GENERIC_SUGGESTIONS,
    );
    await expect(composer(page)).toHaveAttribute(
      "placeholder",
      "Ask anything…",
    );

    await screenshot(page, "start-home-1280");
  });
});

/*
 * ---------------------------------------------------------------------------
 * An answer, quietly
 * ---------------------------------------------------------------------------
 */

test.describe("an answer, written quietly", () => {
  test("one live line says what it does now and opens into its steps; the answer is written below the question without moving it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);
    await ask(page, LATENCY_QUESTION);

    const question: Locator = page.getByTestId("ai-chat-question");
    const live: Locator = page.getByTestId("ai-chat-live");
    await expect(live).toBeVisible();
    await expect(page.getByTestId("ai-chat-live-step")).toHaveText("Thinking…");
    // A screen reader hears once that it is working, not every step.
    await expect(live.locator(".sr-only")).toHaveText(
      "Ask AI is working on an answer.",
    );
    await expect(page.getByTestId("ai-chat-live-step")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(
      page.getByRole("button", { name: "Stop generating" }),
    ).toBeVisible();

    // The question is at the top of the conversation, the room below it.
    const thread: Box = await boxOf(page.getByTestId("ai-chat-thread"));
    const asked: Box = await boxOf(question);
    expect(asked.y - thread.y).toBeLessThanOrEqual(48);

    await addSteps(page, 4);
    await expect(page.getByTestId("ai-chat-live-step")).toHaveText(
      "Aggregating metrics…",
    );
    const toggle: Locator = page.getByTestId("ai-chat-live-steps-toggle");
    await expect(toggle).toHaveText("3 steps");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("ai-chat-live-steps")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("ai-chat-live-steps")).toContainText(
      "Starting investigation",
    );
    await screenshot(page, "working-1280");

    await finishAnswer(page);
    await expect(page.getByTestId("ai-chat-answer-text")).toBeVisible();
    await expect(live).toHaveCount(0);

    // Nothing moved while it came in.
    const after: Box = await boxOf(question);
    expect(Math.abs(after.y - asked.y)).toBeLessThanOrEqual(1);
  });

  test("the answer leads; its sources, its time and its actions sit on one quiet row under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const answer: Locator = page.getByTestId("ai-chat-answer");
    // No avatar beside every message, no label over the answer.
    await expect(answer.getByTestId("ask-ai-mark")).toHaveCount(0);
    await expect(page.getByTestId("ai-chat-answer-text")).toContainText(
      "Checkout slowed down because payments-db ran out of connections",
    );
    // The chart the answer made, under its words.
    await expect(answer.locator("svg.recharts-surface")).toHaveCount(1);
    // Its [C1] marks are chips that name what they cite.
    await expect(
      page.getByTestId("ai-chat-answer-text").locator("[data-citation-id]"),
    ).toHaveCount(6);
    await expect(
      page
        .getByTestId("ai-chat-answer-text")
        .locator('[data-citation-id="C1"]')
        .first(),
    ).toHaveAttribute(
      "aria-label",
      "Citation C1: Metrics: payments-db connections, last 2 hours",
    );

    const footer: Locator = page.getByTestId("ai-chat-answer-footer");
    const sources: Locator = footer.getByTestId("ai-chat-sources-toggle");
    await expect(sources).toHaveText("4 sources");
    const row: Array<Box> = [
      await boxOf(sources),
      await boxOf(footer.getByTestId("ai-chat-answer-time")),
      await boxOf(footer.getByTestId("ai-chat-copy-answer")),
      await boxOf(footer.getByRole("button", { name: "Good answer" })),
      await boxOf(footer.getByRole("button", { name: "Poor answer" })),
    ];
    const middles: Array<number> = row.map((box: Box): number => {
      return box.y + box.height / 2;
    });
    expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(2);
    // Folded under that one line.
    await expect(page.getByTestId("ai-chat-sources")).toHaveCount(0);

    await screenshot(page, "answer-1280");

    await sources.click();
    await expect(sources).toHaveAttribute("aria-expanded", "true");
    const list: Locator = page.getByTestId("ai-chat-sources");
    await expect(list).toContainText(
      "Metrics: payments-db connections, last 2 hours",
    );
    await expect(list).toContainText("Recent changes, last 3 hours");
    await expect(page.getByTestId("ai-chat-run-stats")).toHaveText(
      "4 queries · 18,432 tokens · $0.0184 · claude-sonnet-5-5",
    );

    await screenshot(page, "answer-sources-1280");

    // A thumb says what it is, and records the rating.
    await footer.getByRole("button", { name: "Good answer" }).click();
    await expect(
      footer.getByRole("button", { name: "Good answer" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect((await state(page)).feedback).toEqual([
      expect.objectContaining({ feedback: "Up" }),
    ]);
  });

  test("a citation opens what it cites in the page beside it, and the conversation stays on screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toBeVisible();

    await page
      .getByTestId("ai-chat-answer-text")
      .locator('[data-citation-id="C3"]')
      .first()
      .click();

    await expect(page).toHaveURL(new RegExp(`${DASHBOARD}/logs`));
    await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
    await expect(askAi(page)).toBeVisible();
    await expect(
      page
        .getByTestId("ai-chat-question")
        .filter({ hasText: LATENCY_QUESTION }),
    ).toBeVisible();
    await expect(page.getByTestId("ask-ai-resume")).toHaveCount(0);
  });

  test("Stop stops an answer being written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);
    await ask(page, LATENCY_QUESTION);

    await page.getByRole("button", { name: "Stop generating" }).click();

    await expect(askAi(page).getByText("Stopped by user.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send (Enter)" }),
    ).toBeVisible();
    expect((await state(page)).cancelled).toBe(1);
  });

  test("an approval is decided inside the panel, and leaves a card that says each fact once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=approval");
    await expect(askAi(page)).toBeVisible();

    await expect(
      askAi(page).getByText("The AI wants to perform 1 action"),
    ).toBeVisible();
    // Nothing else is sent until it is decided.
    await expect(
      page.getByRole("button", { name: "Send (Enter)" }),
    ).toBeDisabled();
    await screenshot(page, "approval-1280");

    await page.getByRole("button", { name: "Run 1 action" }).click();

    const card: Locator = page.getByTestId("ai-chat-resource-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("ALT-12 · High memory usage on test01");
    await expect(card).toContainText("Severity: High");
    await expect(card).toContainText("Affected resources");
    // Said by the heading and the line under it, not again under them.
    await expect(card.getByText("Number", { exact: true })).toHaveCount(0);
    await expect(card.getByText("Severity", { exact: true })).toHaveCount(0);
    /*
     * The card says what the action made: the action's own "Executed" row
     * is not drawn again under it (#5349's reviewer).
     */
    await expect(page.getByTestId("tool-approval-history")).toHaveCount(0);
    await expect(askAi(page).getByText("Executed")).toHaveCount(0);
    await expect(
      card.getByRole("button", {
        name: "Open ALT-12 · High memory usage on test01",
      }),
    ).toBeVisible();

    const ids: ConversationIds = await conversationIds(page);
    expect((await state(page)).approvals).toEqual([
      expect.objectContaining({
        conversationId: ids.approval,
        decisions: [{ toolCallId: "call_alert_1", approved: true }],
      }),
    ]);

    await screenshot(page, "card-1280");
  });

  test("a failed answer says so, and Try again asks the same question again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=error&run=hold");
    await expect(askAi(page)).toBeVisible();

    await expect(page.getByTestId("ai-chat-answer-error")).toContainText(
      "The LLM provider did not answer in time.",
    );

    await page.getByTestId("ai-chat-retry").click();

    await expect(page.getByTestId("ai-chat-live")).toBeVisible();
    const ids: ConversationIds = await conversationIds(page);
    expect((await state(page)).sent).toEqual([
      expect.objectContaining({
        content: "Show error log volume by service for today.",
        conversationId: ids.error,
      }),
    ]);
  });

  test("a question that cannot be sent says why, and stays in the composer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "fail=send");
    await openAskAi(page);

    await composer(page).fill(LATENCY_QUESTION);
    await composer(page).press("Enter");

    await expect(page.getByTestId("ask-ai-error")).toBeVisible();
    await expect(page.getByTestId("ask-ai-error")).toHaveAttribute(
      "role",
      "alert",
    );
    await expect(composer(page)).toHaveValue(LATENCY_QUESTION);
    await expect(page.getByTestId("ai-chat-question")).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * What an answer carries fits where it is drawn
 * ---------------------------------------------------------------------------
 */

interface MarkStyle {
  radius: number;
  height: number;
  border: number;
  shadow: string;
  font: string;
  numeric: string;
  size: number;
}

async function markStyleOf(locator: Locator): Promise<MarkStyle> {
  return locator.evaluate((element: Element): MarkStyle => {
    const style: CSSStyleDeclaration = window.getComputedStyle(element);
    return {
      radius: parseFloat(style.borderTopLeftRadius),
      height: element.getBoundingClientRect().height,
      border: parseFloat(style.borderTopWidth),
      shadow: style.boxShadow,
      font: style.fontFamily,
      numeric: style.fontVariantNumeric,
      size: parseFloat(style.fontSize),
    };
  });
}

// The y-axis' tick labels (a layer of their own), and the lines each was drawn on.
const Y_AXIS_LABEL: string =
  ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value";

async function yAxisLabels(
  page: Page,
): Promise<Array<{ text: string; lines: number }>> {
  return page
    .locator(Y_AXIS_LABEL)
    .evaluateAll(
      (ticks: Array<Element>): Array<{ text: string; lines: number }> => {
        return ticks.map((tick: Element): { text: string; lines: number } => {
          return {
            text: tick.textContent || "",
            lines: Math.max(tick.querySelectorAll("tspan").length, 1),
          };
        });
      },
    );
}

test.describe("what an answer carries fits where it is drawn", () => {
  test("a citation reads as a footnote, never as inline code", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const text: Locator = page.getByTestId("ai-chat-answer-text");
    const mark: MarkStyle = await markStyleOf(
      text.locator('[data-citation-id="C1"]').first(),
    );
    const code: MarkStyle = await markStyleOf(
      text.locator("code").filter({ hasText: "checkout-api" }).first(),
    );

    // A small round mark in the text's own font, with no frame...
    expect(mark.radius).toBeGreaterThanOrEqual(mark.height / 2 - 0.5);
    expect(mark.border).toBe(0);
    expect(mark.shadow).toBe("none");
    expect(mark.font).not.toMatch(MONOSPACE);
    // ...and Inter's proportional figures: its tabular 1 has a foot.
    expect(mark.numeric).not.toContain("tabular-nums");
    expect(mark.size).toBeLessThan(code.size);
    // Where the code beside it is a framed monospace box.
    expect(code.border).toBeGreaterThanOrEqual(1);
    expect(code.font).toMatch(MONOSPACE);
  });

  for (const width of [1280, 390]) {
    test(`a chart's axis writes each value on one line, scaled as the dashboards write it (${width})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 844 });
      await load(page, "thread=answered");
      await expect(askAi(page)).toBeVisible();
      // The chart draws its axes once it has measured its box.
      await expect(page.locator(Y_AXIS_LABEL).first()).toBeAttached();
      await settle(page);

      const labels: Array<{ text: string; lines: number }> =
        await yAxisLabels(page);

      expect(labels.length).toBeGreaterThanOrEqual(3);
      // "2,600 ms" broke into "2,600" over "ms" on its 64 px.
      for (const label of labels) {
        expect(label, label.text).toEqual({ text: label.text, lines: 1 });
      }
      expect(
        labels.map((label: { text: string; lines: number }): string => {
          return label.text;
        }),
      ).toEqual(expect.arrayContaining(["650 ms", "1.3 s", "2.6 s"]));
    });
  }

  test("on a phone a table keeps every column on screen, its text wrapped and its numbers whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, "thread=rich");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const table: Locator = page.locator("table").filter({
      hasText: "Endpoint",
    });
    await table.scrollIntoViewIfNeeded();
    await settle(page);

    // Nothing hidden past the card's edge, waiting to be scrolled to.
    const fit: { table: number; room: number } = await table.evaluate(
      (element: Element): { table: number; room: number } => {
        return {
          table: element.scrollWidth,
          room: (element.parentElement as HTMLElement).clientWidth,
        };
      },
    );
    expect(fit.table).toBeLessThanOrEqual(fit.room);

    const card: Box = await boxOf(table);
    for (const heading of await table.locator("th").all()) {
      const box: Box = await boxOf(heading);
      expect(box.x).toBeGreaterThanOrEqual(card.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }

    const cells: Locator = table.getByTestId("ai-chat-table-cell");
    // The lines a cell's text was laid out on (a cell is as tall as its row).
    const linesOf: (cell: Locator) => Promise<number> = async (
      cell: Locator,
    ): Promise<number> => {
      return cell.evaluate((element: Element): number => {
        const range: Range = document.createRange();
        range.selectNodeContents(element);
        return new Set(
          Array.from(range.getClientRects()).map((rect: DOMRect): number => {
            return Math.round(rect.top);
          }),
        ).size;
      });
    };

    // The endpoint wraps over lines; its number stays on one.
    await expect(cells.nth(1)).toHaveText("2,412");
    expect(await linesOf(cells.nth(0))).toBeGreaterThanOrEqual(2);
    expect(await linesOf(cells.nth(1))).toBe(1);
    expect(await linesOf(cells.nth(2))).toBe(1);
    await expect(cells.nth(0)).toHaveAttribute(
      "title",
      "POST /api/v2/checkout/sessions/{sessionId}/confirm",
    );

    await screenshot(page, "rich-table-390");
  });

  /*
   * A tool's table wrote each date whole - "Oct 27 2026, 02:57 PM UTC · 3
   * minutes ago" - which took a third of the chat's column, its year and
   * zone the same on every row, and named its columns in English in every
   * language. A date is short now, as every table writes one, and whole
   * under the pointer with how long ago it was; a column's name reads in
   * the reader's language.
   */
  for (const view of [
    { width: 1280, lang: "" },
    { width: 768, lang: "" },
    { width: 768, lang: "de" },
  ]) {
    test(`a table's dates are short in their cells and whole under the pointer, its column names in the reader's language (${view.width}${view.lang ? `, ${view.lang}` : ""})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: view.width, height: 900 });
      await load(page, `thread=rich${view.lang ? `&lang=${view.lang}` : ""}`);
      await expect(askAi(page)).toBeVisible();

      const table: Locator = page
        .locator("table")
        .filter({ has: page.locator("time") });
      await table.scrollIntoViewIfNeeded();
      await settle(page);

      const headers: Array<string> = (
        await table.locator("th").allTextContents()
      ).map((text: string): string => {
        return text.trim();
      });
      expect(headers).toEqual(
        view.lang === "de"
          ? ["Zeit", "Schweregrad", "Ereignis", "Host"]
          : ["Time", "Severity", "Event", "Host"],
      );

      // The first row's date, read in one go once the table has settled.
      const date: {
        text: string;
        title: string;
        lines: number;
        cellWidth: number;
        tableWidth: number;
      } = await table.evaluate(
        (
          element: Element,
        ): {
          text: string;
          title: string;
          lines: number;
          cellWidth: number;
          tableWidth: number;
        } => {
          const time: Element = element.querySelector("time")!;
          const cell: Element = time.closest("td")!;
          const range: Range = document.createRange();
          range.selectNodeContents(cell);

          return {
            text: time.textContent || "",
            title: cell.getAttribute("title") || "",
            lines: new Set(
              Array.from(range.getClientRects()).map(
                (rect: DOMRect): number => {
                  return Math.round(rect.top);
                },
              ),
            ).size,
            cellWidth: cell.getBoundingClientRect().width,
            tableWidth: element.getBoundingClientRect().width,
          };
        },
      );

      expect(date.lines).toBe(1);
      // Beside three other columns in the panel's width: it leaves them the most.
      expect(date.cellWidth).toBeLessThan(date.tableWidth / 3);
      expect(date.text).not.toContain("2026");
      expect(date.title).toContain("2026");

      if (view.lang === "de") {
        expect(date.text).toContain("Okt.");
        expect(date.title).toContain("vor 3 Minuten");
      } else {
        expect(date.text).toBe("Oct 27, 2:57 PM");
        expect(date.title).toMatch(WHOLE_DATE_UNDER_THE_POINTER);
      }

      await screenshot(
        page,
        `rich-table-dates-${view.width}${view.lang ? `-${view.lang}` : ""}`,
      );
    });
  }

  for (const viewport of [
    { name: "two by two in the panel", width: 1280, kept: 0, rows: 2 },
    {
      name: "one row in a panel dragged wide",
      width: 1280,
      kept: 640,
      rows: 1,
    },
    { name: "two by two on a phone", width: 390, kept: 0, rows: 2 },
  ]) {
    test(`four figures fill their rows: ${viewport.name} (${viewport.width})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      if (viewport.kept) {
        await keepPanelWidth(page, viewport.kept);
      }

      await page.setViewportSize({ width: viewport.width, height: 844 });
      await load(page, "thread=rich");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const tiles: Array<Box> = [];
      for (const tile of await page
        .getByTestId("ai-chat-stat-cards")
        .locator(":scope > div")
        .all()) {
        tiles.push(await boxOf(tile));
      }

      expect(tiles).toHaveLength(4);
      const rows: Set<number> = new Set(
        tiles.map((tile: Box): number => {
          return Math.round(tile.y);
        }),
      );
      expect(rows.size).toBe(viewport.rows);
      // All the same width: no tile alone on a row of its own.
      const widths: Array<number> = tiles.map((tile: Box): number => {
        return tile.width;
      });
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    });
  }

  test("a trace's bars read in the dark: its spans in the charts' indigo, its error in rose", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=rich&theme=dark");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const bars: Array<string> = await page
      .getByText("Slowest checkout trace")
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
      .locator("div.absolute.rounded")
      .evaluateAll((elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return window.getComputedStyle(element).backgroundColor;
        });
      });

    expect(bars).toEqual([
      "rgb(99, 102, 241)",
      "rgb(244, 63, 94)",
      "rgb(99, 102, 241)",
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Conversations within reach
 * ---------------------------------------------------------------------------
 */

test.describe("conversations within reach", () => {
  test("the start shows the last three; All conversations lists them all, inside the panel", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "history=many");
    await openAskAi(page);

    const recent: Locator = page.getByTestId("ai-chat-recent");
    await expect(recent.getByRole("listitem")).toHaveCount(3);
    await screenshot(page, "start-history-1280");

    await recent.getByRole("button", { name: "All conversations" }).click();

    await expect(
      page.getByRole("complementary", { name: "All conversations" }),
    ).toBeVisible();
    const rows: Locator = page
      .getByTestId("ai-chat-history")
      .getByRole("listitem");
    await expect(rows).toHaveCount(25);
    // The list scrolls inside the panel; the page beside it does not.
    const scroll: { inner: boolean; page: number } = await page
      .getByTestId("ai-chat-history")
      .evaluate((list: Element): { inner: boolean; page: number } => {
        const scroller: HTMLElement = list.closest(
          ".overflow-y-auto",
        ) as HTMLElement;
        return {
          inner: scroller.scrollHeight > scroller.clientHeight,
          page: window.scrollY,
        };
      });
    expect(scroll).toEqual({ inner: true, page: 0 });
    // Nothing to type into: the history is a list to pick from.
    await expect(composer(page)).toHaveCount(0);

    await screenshot(page, "history-1280");

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByTestId("ai-chat-home")).toBeVisible();
  });

  test("a conversation opens from the history, and one is deleted by its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "history=some");
    await openAskAi(page);
    const ids: ConversationIds = await conversationIds(page);

    await page.getByTestId("ask-ai-history").click();
    const bin: Locator = page.getByRole("button", {
      name: "Delete conversation: Error log volume by service",
    });
    await bin.click();

    // The bin deletes nothing: the row asks, named after the conversation.
    const asking: Locator = page.getByRole("group", {
      name: "Delete conversation: Error log volume by service",
    });
    await expect(asking).toBeVisible();
    await expect(asking.getByRole("button")).toHaveText(["Delete", "Cancel"]);
    // Cancel has the focus, and stands where the bin was: a double click keeps it.
    await expect(asking.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect((await state(page)).deleted).toEqual([]);
    await screenshot(page, "history-delete-asks-1280");

    // Esc keeps it, and leaves the panel open.
    await page.keyboard.press("Escape");
    await expect(asking).toHaveCount(0);
    await expect(askAi(page)).toBeVisible();
    await expect(bin).toBeFocused();

    await bin.click();
    await asking.getByRole("button", { name: "Delete" }).click();

    await expect(
      page
        .getByTestId("ai-chat-history")
        .getByText("Error log volume by service"),
    ).toHaveCount(0);
    expect((await state(page)).deleted).toEqual([ids.error]);
    // The row that took its place has the focus.
    await expect(
      page
        .getByTestId("ai-chat-history")
        .getByRole("button", { name: /^Top exceptions this week/ }),
    ).toBeFocused();

    await page
      .getByTestId("ai-chat-history")
      .getByRole("button", { name: /^Why did checkout latency spike\?/ })
      .click();

    await expect(
      page.getByRole("complementary", {
        name: "Why did checkout latency spike?",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("ai-chat-answer-text")).toBeVisible();
    await expect(composer(page)).toHaveAttribute(
      "placeholder",
      "Ask a follow-up…",
    );

    // New chat starts over.
    await page.getByTestId("ask-ai-new-chat").click();
    await expect(page.getByTestId("ai-chat-home")).toBeVisible();
  });

  test("by keyboard, the history takes the focus as it opens: the first conversation", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "history=some");
    await openAskAi(page);
    await expect(composer(page)).toBeFocused();

    // The button that opens it leaves the header with the start.
    await page.getByTestId("ask-ai-history").focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("complementary", { name: "All conversations" }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("ai-chat-history")
        .getByRole("button", { name: /^Why did checkout latency spike\?/ }),
    ).toBeFocused();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Closing loses nothing
 * ---------------------------------------------------------------------------
 */

test.describe("closing Ask AI loses nothing", () => {
  test("closed while it answers, a way back says when the answer is ready, and opens it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);
    await ask(page, LATENCY_QUESTION);

    await page.keyboard.press("Escape");
    await expect(askAi(page)).toBeHidden();

    const resume: Locator = page.getByTestId("ask-ai-resume");
    await expect(resume).toHaveText("Ask AI is answering…");
    await settle(page);
    // In the corner the new version notice leaves free.
    const box: Box = await boxOf(resume);
    expect(Math.round(1280 - box.x - box.width)).toBe(24);
    expect(Math.round(800 - box.y - box.height)).toBe(24);
    await screenshot(page, "resume-working-1280");

    await finishAnswer(page);
    await expect(resume).toHaveText("Ask AI has answered");
    await expect(resume.getByRole("status")).toHaveText("Ask AI has answered");

    await page.getByTestId("ask-ai-resume-open").click();
    await expect(askAi(page)).toBeVisible();
    await expect(page.getByTestId("ai-chat-answer-text")).toBeVisible();
    await expect(resume).toHaveCount(0);
  });

  test("the way back can be dismissed", async ({ page }: { page: Page }) => {
    await load(page, "run=hold");
    await openAskAi(page);
    await ask(page, LATENCY_QUESTION);
    await page.keyboard.press("Escape");

    await page.getByTestId("ask-ai-resume-dismiss").click();

    await expect(page.getByTestId("ask-ai-resume")).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * By keyboard, and what there is to choose
 * ---------------------------------------------------------------------------
 */

test.describe("by keyboard", () => {
  test("Esc in a menu closes the menu only", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await load(page);
    await openAskAi(page);
    const mode: Locator = page.getByTitle(
      "Choose what the AI is allowed to do",
    );

    await mode.click();
    await expect(
      page.getByRole("menu", { name: "AI permissions" }),
    ).toBeVisible();
    await settle(page);
    // From the composer at the panel's foot it opens up, whole, inside the panel.
    const menu: Box = await boxOf(
      page.getByRole("menu", { name: "AI permissions" }),
    );
    const button: Box = await boxOf(mode);
    const panel: Box = await boxOf(askAi(page));
    expect(menu.y + menu.height).toBeLessThanOrEqual(button.y);
    expect(menu.y).toBeGreaterThanOrEqual(panel.y);
    await screenshot(page, "start-menu-up-1280");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(askAi(page)).toBeVisible();
    await expect(mode).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(askAi(page)).toBeHidden();
  });

  test("in a panel at its narrowest, either menu of the composer stays inside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await keepPanelWidth(page, 340);
    await load(page, "providers=two");
    await openAskAi(page);
    const panel: Box = await boxOf(askAi(page));

    for (const control of [
      { title: "Choose AI provider", menu: "AI provider" },
      {
        title: "Choose what the AI is allowed to do",
        menu: "AI permissions",
      },
    ]) {
      await page.getByTitle(control.title).click();
      const opened: Locator = page.getByRole("menu", { name: control.menu });
      await expect(opened).toBeVisible();
      await settle(page);

      const menu: Box = await boxOf(opened);
      expect({ menu: control.menu, x: menu.x >= panel.x }).toEqual({
        menu: control.menu,
        x: true,
      });
      expect({
        menu: control.menu,
        end: menu.x + menu.width <= panel.x + panel.width,
      }).toEqual({ menu: control.menu, end: true });

      await page.keyboard.press("Escape");
      await expect(opened).toHaveCount(0);
    }
  });

  test("one LLM provider: nothing to choose; two: the picker lists them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);
    await expect(page.getByTitle("Choose AI provider")).toHaveCount(0);

    await load(page, "providers=two");
    await openAskAi(page);
    await page.getByTitle("Choose AI provider").click();
    const menu: Locator = page.getByRole("menu", { name: "AI provider" });
    await expect(menu.getByRole("menuitemradio")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(askAi(page)).toBeVisible();
  });

  test("with AI switched off it says so, and offers nothing to type into", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "ai=off");
    await openAskAi(page);

    await expect(page.getByTestId("ask-ai-panel")).toHaveAttribute(
      "data-view",
      "unavailable",
    );
    await expect(composer(page)).toHaveCount(0);
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * On a tablet and a phone
 * ---------------------------------------------------------------------------
 */

test.describe("on a tablet, where there is no room for both", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("a sheet at the side, over the dimmed page, which is inert and still", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await expect(askAi(page)).toHaveAttribute("role", "dialog");
    await expect(askAi(page)).toHaveAttribute("aria-modal", "true");
    expect(await boxOf(askAi(page))).toEqual({
      x: 320,
      y: 0,
      width: 448,
      height: 1024,
    });
    await expect(page.getByTestId("ask-ai-resize")).toHaveCount(0);

    expect(
      await page.evaluate((): { inert: boolean; overflow: string } => {
        return {
          inert: document.getElementById("root")!.hasAttribute("inert"),
          overflow: document.body.style.overflow,
        };
      }),
    ).toEqual({ inert: true, overflow: "hidden" });
    expect(await widthOf(page.getByTestId("fixture-page"))).toBe(768);

    await expectNothingScrollsSideways(page);
    await screenshot(page, "answer-768");
  });

  test("Tab and Shift + Tab go round inside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    for (const key of ["Tab", "Shift+Tab"]) {
      for (let index: number = 0; index < 40; index++) {
        await page.keyboard.press(key);
        expect({
          key,
          index,
          inside: await page.evaluate((): boolean => {
            return Boolean(
              document.activeElement?.closest('[data-testid="ask-ai-panel"]'),
            );
          }),
        }).toEqual({ key, index, inside: true });
      }
    }
  });

  test("a click beside it closes it, and the page wakes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await page.getByTestId("fixture-open-side-over").focus();
    await page.keyboard.press("Control+i");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await page.mouse.click(40, 400);

    await expect(askAi(page)).toBeHidden();
    expect(
      await page.evaluate((): { inert: boolean; overflow: string } => {
        return {
          inert: document.getElementById("root")!.hasAttribute("inert"),
          overflow: document.body.style.overflow,
        };
      }),
    ).toEqual({ inert: false, overflow: "" });
    await expect(page.getByTestId("fixture-open-side-over")).toBeFocused();
  });

  test("Esc closes it, and the focus goes back to what had it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    const button: Locator = page.getByTestId("fixture-open-side-over");
    await button.focus();

    await page.keyboard.press("Control+i");
    await expect(askAi(page)).toBeVisible();
    await expect(composer(page)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(askAi(page)).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("a citation opens what it cites: the sheet steps aside for the page to be seen, and the conversation waits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toBeVisible();

    await page
      .getByTestId("ai-chat-answer-text")
      .locator('[data-citation-id="C3"]')
      .first()
      .click();

    await expect(askAi(page)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD}/logs`));
    await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
    // Read already: nothing floats over the page that was opened.
    await expect(page.getByTestId("ask-ai-resume")).toHaveCount(0);

    await page.keyboard.press("Control+i");
    await expect(
      page
        .getByTestId("ai-chat-question")
        .filter({ hasText: LATENCY_QUESTION }),
    ).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a full-screen sheet: the whole screen, no corners, nothing wider than it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    const box: Box = await boxOf(askAi(page));
    expect(box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(
      await askAi(page).evaluate((element: Element): string => {
        return window.getComputedStyle(element).borderTopLeftRadius;
      }),
    ).toBe("0px");
    await expectNothingScrollsSideways(page);
    await screenshot(page, "start-incident-390");
  });

  test("in a conversation the composer stays at the foot, and the answer's actions are always shown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const box: Box = await boxOf(page.getByTestId("ai-chat-composer"));
    expect(844 - (box.y + box.height)).toBeLessThanOrEqual(16);
    // A phone has no pointer to point with: the newest answer's actions show.
    await expect(page.getByTestId("ai-chat-copy-answer")).toBeVisible();
    await expectNothingScrollsSideways(page);
    await screenshot(page, "answer-390");
  });

  test("the way back sits under the header, clear of the new version notice", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);
    await ask(page, LATENCY_QUESTION);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("ask-ai-resume")).toBeVisible();
    await settle(page);

    const box: Box = await boxOf(page.getByTestId("ask-ai-resume"));
    expect(Math.round(box.y)).toBe(80);
    expect(Math.round(390 - box.x - box.width)).toBe(16);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Dark, German, Persian and reduced motion
 * ---------------------------------------------------------------------------
 */

// The relative luminance of a computed rgb() colour, 0 (black) to 1 (white).
async function luminanceOf(
  locator: Locator,
  property: string,
): Promise<number> {
  return locator.evaluate((element: Element, name: string): number => {
    const value: string = window
      .getComputedStyle(element)
      .getPropertyValue(name);
    const channels: Array<number> = (value.match(/[\d.]+/g) || [])
      .slice(0, 3)
      .map(Number);
    const [red, green, blue] = channels.map((channel: number): number => {
      const linear: number = channel / 255;
      return linear <= 0.03928
        ? linear / 12.92
        : Math.pow((linear + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }, property);
}

test.describe("in the dark", () => {
  test("the panel, its start, its answer and its card are drawn dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "theme=dark");
    await openAskAi(page);

    expect(await luminanceOf(askAi(page), "background-color")).toBeLessThan(
      0.05,
    );
    expect(
      await luminanceOf(
        askAi(page).getByRole("heading", { level: 3 }),
        "color",
      ),
    ).toBeGreaterThan(0.6);
    expect(
      await luminanceOf(
        page.getByTestId("ai-chat-context"),
        "background-color",
      ),
    ).toBeLessThan(0.1);
    // The box says it has the focus in the dark too: its indigo edge and glow.
    await expect(composer(page)).toBeFocused();
    await expect
      .poll((): Promise<{ border: string; shadow: string }> => {
        return page
          .getByTestId("ai-chat-composer")
          .evaluate((element: Element): { border: string; shadow: string } => {
            const style: CSSStyleDeclaration = window.getComputedStyle(element);
            return {
              border: style.borderTopColor,
              shadow: style.boxShadow,
            };
          });
      })
      .toEqual({
        border: "rgb(99, 102, 241)",
        shadow: expect.stringContaining("rgba(99, 102, 241, 0.25)"),
      });
    /*
     * The start's mark glows in its own indigo, not in the deep black
     * shadow the dark theme gives every shadow-lg (a dark smudge).
     */
    expect(
      await page
        .getByTestId("ai-chat-home")
        .getByTestId("ask-ai-mark")
        .evaluate((element: Element): string => {
          return window.getComputedStyle(element).boxShadow;
        }),
    ).toContain("rgba(99, 102, 241, 0.55)");
    await screenshot(page, "start-incident-1280-dark");

    await load(page, "theme=dark&thread=answered");
    await expect(askAi(page)).toBeVisible();
    expect(
      await luminanceOf(page.getByTestId("ai-chat-answer-text"), "color"),
    ).toBeGreaterThan(0.5);
    await screenshot(page, "answer-1280-dark");

    await load(page, "theme=dark&thread=approval");
    await expect(askAi(page)).toBeVisible();
    await screenshot(page, "approval-1280-dark");
    await page.getByRole("button", { name: "Run 1 action" }).click();
    await expect(page.getByTestId("ai-chat-resource-card")).toBeVisible();
    expect(
      await luminanceOf(
        page.getByTestId("ai-chat-resource-card"),
        "background-color",
      ),
    ).toBeLessThan(0.1);
    await screenshot(page, "card-1280-dark");
  });
});

test.describe("in the dark, on a tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("a deeper veil over the page: a dark one over a dark page still sets the sheet apart", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "theme=dark&thread=answered");
    await expect(askAi(page)).toBeVisible();

    await expect
      .poll((): Promise<string> => {
        return page
          .getByTestId("ask-ai-backdrop")
          .evaluate((element: Element): string => {
            return window.getComputedStyle(element).backgroundColor;
          });
      })
      .toBe("rgba(2, 6, 23, 0.62)");
  });
});

test.describe("in German", () => {
  test("the start, the live line and the answer's row speak German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=de&run=hold");
    await openAskAi(page);

    await expect(
      page.getByRole("complementary", { name: "KI fragen" }),
    ).toBeVisible();
    await expect(askAi(page).getByRole("heading", { level: 3 })).toHaveText(
      "Was möchten Sie wissen?",
    );
    await expect(page.getByTestId("ai-chat-context")).toHaveText(
      "Dieser Vorfall · #42 Checkout latency above 2s",
    );
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText([
      "Zusammenfassen",
      "Grundursache finden",
      "Was hat sich geändert?",
      "Status-Update entwerfen",
    ]);
    await expect(composer(page)).toHaveAttribute(
      "placeholder",
      "Fragen Sie etwas…",
    );
    await screenshot(page, "start-incident-1280-de");

    await ask(page, "Warum ist der Checkout langsam?");
    await addSteps(page, 4);
    await expect(page.getByTestId("ai-chat-live-step")).toHaveText(
      "Metriken werden aggregiert…",
    );
    await expect(page.getByTestId("ai-chat-live-steps-toggle")).toHaveText(
      "3 Schritte",
    );
    await finishAnswer(page);
    await expect(page.getByTestId("ai-chat-sources-toggle")).toHaveText(
      "4 Quellen",
    );
  });

  /*
   * The menu offered "Genehmigung anfordern" under a button that said "Vor
   * Aktionen fragen", "Auto-run (bypass approvals)" in English, and said
   * what each mode means in English ("The copilot pauses and asks...").
   */
  test("the permission menu names each mode as its button does, and says what it means in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=de");
    await openAskAi(page);
    const mode: Locator = page.getByTitle("Wählen Sie, was die KI tun darf");

    await expect(mode).toHaveText("Vor Aktionen fragen");
    await mode.click();
    const menu: Locator = page.getByRole("menu", { name: "KI-Berechtigungen" });
    await expect(menu).toBeVisible();

    await expect(menu.getByRole("menuitemradio")).toHaveText([
      "Vor Aktionen fragenFragt vor jeder Änderung nach Genehmigung.",
      "Automatisch ausführenFührt eindeutige Anfragen sofort aus, im Rahmen Ihrer Berechtigungen.",
      "Nur LesezugriffLiest und antwortet nur. Ändert nie etwas.",
    ]);
    await expect(
      menu.getByRole("menuitemradio", { checked: true }),
    ).toContainText("Vor Aktionen fragen");
    await screenshot(page, "start-menu-1280-de");

    await menu.getByRole("menuitemradio", { name: /^Nur Lesezugriff/ }).click();
    await expect(mode).toHaveText("Nur Lesezugriff");
  });

  /*
   * The approval card said what the AI would do in the server's English -
   * "Create alert: High memory usage on test01", 'Severity: High. Linked
   * to host "test01".' - in the middle of a German page. The server now
   * stores it as sentences, and the card says them in German, the alert's
   * title, its severity and the host's name as written.
   */
  test("an approval card says what the AI will do in German, and the card it leaves too", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: Record<string, string> = dashboardWords("de");
    const title: string = filled(words, "Create alert: {{title}}", {
      title: "High memory usage on test01",
    });

    await keepPanelWidth(page, 640);
    await load(page, "lang=de&thread=approval");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const action: Locator = page.getByTestId("tool-approval-action");
    await expect(action.getByTestId("tool-approval-title")).toHaveText(title);
    await expect(action.getByTestId("tool-approval-description")).toHaveText(
      `${filled(words, "Severity: {{severity}}.", { severity: "High" })} ${filled(
        words,
        "Linked to {{resources}}.",
        { resources: `${words["host"]} "test01"` },
      )}`,
    );
    await expect(
      askAi(page).getByText(
        filled(words, "The AI wants to perform {{count}} actions_one", {
          count: "1",
        }),
      ),
    ).toBeVisible();

    const choice: Locator = page.getByRole("group", { name: title });
    await expect(
      choice.getByRole("button", { name: words["Allow"]! }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      choice.getByRole("button", { name: words["Skip"]! }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: words["Deny all"]! }),
    ).toBeVisible();

    // Beside the title in a panel wide enough: on the title's row, at its end.
    const boxes: ApprovalAction = await approvalActionBoxes(page);
    expect(boxes.choice.x).toBeGreaterThan(boxes.title.x + boxes.title.width);
    expect(Math.abs(boxes.choice.y - boxes.title.y)).toBeLessThanOrEqual(4);
    await screenshot(page, "approval-1280-de");

    await page
      .getByRole("button", {
        name: filled(words, "Run {{count}} actions_one", { count: "1" }),
      })
      .click();

    /*
     * What it made is the card under the answer, in German: its kind, its
     * severity and the host it is linked to in German words, the alert's
     * number, title and the host's name as written (#5623's follow-up) -
     * and no row of the action under it, which only said it again.
     */
    const card: Locator = page.getByTestId("ai-chat-resource-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("ai-chat-resource-card-kind")).toHaveText(
      words["Alert"]!,
    );
    await expect(card.getByTestId("ai-chat-resource-card-heading")).toHaveText(
      "ALT-12 · High memory usage on test01",
    );
    await expect(card.getByTestId("ai-chat-resource-card-line")).toHaveText(
      filled(words, "Severity: {{severity}}", { severity: "High" }),
    );
    await expect(
      card.getByTestId("ai-chat-resource-card-fact-label"),
    ).toHaveText([words["Affected resources"]!]);
    await expect(
      card.getByTestId("ai-chat-resource-card-fact-value"),
    ).toHaveText(`${words["host"]} "test01"`);
    for (const english of ["Severity:", "Affected resources", "ALERT"]) {
      await expect(card).not.toContainText(english);
    }
    await expect(page.getByTestId("tool-approval-history")).toHaveCount(0);
    await screenshot(page, "approval-done-1280-de");
  });

  test("an action saved before cards had words still leaves its row, and its card reads its English", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: Record<string, string> = dashboardWords("de");

    await load(page, "lang=de&thread=approval&words=none");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await page
      .getByRole("button", {
        name: filled(words, "Run {{count}} actions_one", { count: "1" }),
      })
      .click();

    // Saved before actions named their cards: what ran is still a row.
    await expect(page.getByTestId("tool-approval-history-title")).toHaveText(
      "Create alert: High memory usage on test01",
    );
    await expect(askAi(page).getByText(words["Executed"]!)).toBeVisible();
    // Its card is the English it stores, each fact once.
    const card: Locator = page.getByTestId("ai-chat-resource-card");
    await expect(card.getByTestId("ai-chat-resource-card-line")).toHaveText(
      "Severity: High",
    );
    await expect(card.getByText("Number", { exact: true })).toHaveCount(0);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("its longer words still fit", async ({ page }: { page: Page }) => {
      await load(page, "lang=de&thread=answered");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      await expectNothingScrollsSideways(page);
      await screenshot(page, "answer-390-de");

      await load(page, "lang=de");
      await openAskAi(page);
      await expectNothingScrollsSideways(page);
      await screenshot(page, "start-incident-390-de");
    });

    test("an approval card in German fits: Allow and Skip under its whole title", async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: Record<string, string> = dashboardWords("de");

      await load(page, "lang=de&thread=approval");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      await expect(page.getByTestId("tool-approval-title")).toHaveText(
        filled(words, "Create alert: {{title}}", {
          title: "High memory usage on test01",
        }),
      );

      // Under the title, never squeezing it: the box is under 28rem wide.
      const boxes: ApprovalAction = await approvalActionBoxes(page);
      expect(boxes.choice.y).toBeGreaterThanOrEqual(
        boxes.title.y + boxes.title.height - 1,
      );
      // The title is whole, not cut at its three lines.
      expect(
        await page
          .getByTestId("tool-approval-title")
          .evaluate((element: Element): boolean => {
            return element.scrollHeight <= element.clientHeight + 1;
          }),
      ).toBe(true);

      await expectNothingScrollsSideways(page);
      await screenshot(page, "approval-390-de");

      /*
       * What did not run stays as a row, whole: cut at one line, a phone
       * lost what it was ("Warnung erstellen: High memory usage on te...").
       * Skipped, it leaves no card to say it instead.
       */
      await page
        .getByRole("group", {
          name: filled(words, "Create alert: {{title}}", {
            title: "High memory usage on test01",
          }),
        })
        .getByRole("button", { name: words["Skip"]! })
        .click();
      await page.getByRole("button", { name: words["Skip all"]! }).click();
      const row: Locator = page.getByTestId("tool-approval-history-title");
      await expect(row).toHaveText(
        filled(words, "Create alert: {{title}}", {
          title: "High memory usage on test01",
        }),
      );
      await settle(page);
      const drawn: { isCut: boolean; lines: number } = await row.evaluate(
        (element: Element): { isCut: boolean; lines: number } => {
          const lineHeight: number = parseFloat(
            window.getComputedStyle(element).lineHeight,
          );
          return {
            isCut:
              element.scrollWidth > element.clientWidth + 1 ||
              element.scrollHeight > element.clientHeight + 1,
            lines: Math.round(
              element.getBoundingClientRect().height / lineHeight,
            ),
          };
        },
      );
      expect(drawn.isCut).toBe(false);
      expect(drawn.lines).toBeGreaterThanOrEqual(2);
      await expectNothingScrollsSideways(page);
      await screenshot(page, "approval-done-390-de");
    });
  });
});

test.describe("in Persian", () => {
  test("right to left: the header, the pill and the conversation read from the right", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=fa");
    await openAskAi(page);

    expect(
      await page.evaluate((): { dir: string; lang: string } => {
        return {
          dir: document.documentElement.dir,
          lang: document.documentElement.lang,
        };
      }),
    ).toEqual({ dir: "rtl", lang: "fa" });

    // The mark and the title on the right, Close on the left.
    const title: Box = await boxOf(page.getByTestId("ask-ai-title"));
    const close: Box = await boxOf(page.getByTestId("ask-ai-close"));
    expect(close.x).toBeLessThan(title.x);
    await expect(page.getByTestId("ai-chat-context")).toHaveText(
      "این حادثه · #42 Checkout latency above 2s",
    );
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText([
      "خلاصه‌سازی",
      "یافتن علت ریشه‌ای",
      "چه چیزی تغییر کرد؟",
      "پیش‌نویس به‌روزرسانی وضعیت",
    ]);
    await expect(composer(page)).toHaveAttribute(
      "placeholder",
      "هر چیزی بپرسید…",
    );
    await screenshot(page, "start-incident-1280-fa");

    await load(page, "lang=fa&thread=answered");
    await expect(askAi(page)).toBeVisible();
    await settle(page);
    // The question sits on the left; asked in English, it reads left to right.
    const question: Locator = page
      .getByTestId("ai-chat-question")
      .locator("[dir=auto]");
    const asked: Box = await boxOf(question);
    const thread: Box = await boxOf(page.getByTestId("ai-chat-thread"));
    expect(asked.x - thread.x).toBeLessThan(
      thread.x + thread.width - (asked.x + asked.width),
    );
    expect(
      await question.evaluate((element: Element): string => {
        return window.getComputedStyle(element).direction;
      }),
    ).toBe("ltr");
    await screenshot(page, "answer-1280-fa");
  });

  test("an English title stands beside its icon, where the page reads from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=fa&history=some");
    await openAskAi(page);

    for (const row of await page
      .getByTestId("ai-chat-recent")
      .getByRole("listitem")
      .all()) {
      const gap: { title: number; icon: number; direction: string } =
        await row.evaluate(
          (
            item: Element,
          ): { title: number; icon: number; direction: string } => {
            const title: HTMLElement = item.querySelector(
              "span[dir]",
            ) as HTMLElement;
            const range: Range = document.createRange();
            range.selectNodeContents(title);
            const icon: Element = item.querySelector("svg") as Element;
            return {
              title: range.getBoundingClientRect().right,
              icon: icon.getBoundingClientRect().left,
              direction: window.getComputedStyle(title).direction,
            };
          },
        );

      // Read left to right, its "?" at its end...
      expect(gap.direction).toBe("ltr");
      // ...beside its icon on the right, not across the row from it.
      expect(gap.icon - gap.title).toBeGreaterThanOrEqual(0);
      expect(gap.icon - gap.title).toBeLessThanOrEqual(16);
    }
  });

  /*
   * The card says what the AI will do in Persian, read right to left: the
   * alert's English title and the host's English name set apart inside
   * the Persian sentences, so each keeps its place and its punctuation.
   */
  test("an approval card says what the AI will do in Persian, right to left, its English names set apart", async ({
    page,
  }: {
    page: Page;
  }) => {
    const words: Record<string, string> = dashboardWords("fa");
    const title: string = filled(words, "Create alert: {{title}}", {
      title: "High memory usage on test01",
    });

    await keepPanelWidth(page, 640);
    await load(page, "lang=fa&thread=approval");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const action: Locator = page.getByTestId("tool-approval-action");
    const titleLine: Locator = action.getByTestId("tool-approval-title");
    const line: Locator = action.getByTestId("tool-approval-description");

    expect(await wordsOf(titleLine)).toBe(title);
    expect(await wordsOf(line)).toBe(
      `${filled(words, "Severity: {{severity}}.", { severity: "High" })} ${filled(
        words,
        "Linked to {{resources}}.",
        { resources: `${words["host"]} "test01"` },
      )}`,
    );

    // Each sentence reads right to left, and starts where the card does.
    const read: {
      directions: Array<string>;
      titleRight: number;
      lineRight: number;
    } = await action.evaluate(
      (
        element: Element,
      ): {
        directions: Array<string>;
        titleRight: number;
        lineRight: number;
      } => {
        const title: HTMLElement = element.querySelector(
          '[data-testid="tool-approval-title"] bdi',
        ) as HTMLElement;
        const sentences: Array<HTMLElement> = Array.from(
          element.querySelectorAll(
            '[data-testid="tool-approval-description"] bdi',
          ),
        );
        const titleRange: Range = document.createRange();
        titleRange.selectNodeContents(title);
        const lineRange: Range = document.createRange();
        lineRange.selectNodeContents(sentences[0]!);
        return {
          directions: [title, ...sentences].map(
            (sentence: HTMLElement): string => {
              return window.getComputedStyle(sentence).direction;
            },
          ),
          titleRight: titleRange.getBoundingClientRect().right,
          lineRight: lineRange.getBoundingClientRect().right,
        };
      },
    );
    expect(read.directions).toEqual(["rtl", "rtl", "rtl"]);
    expect(Math.abs(read.titleRight - read.lineRight)).toBeLessThanOrEqual(2);

    await expect(
      askAi(page).getByText(
        filled(words, "The AI wants to perform {{count}} actions_one", {
          count: "۱",
        }),
      ),
    ).toBeVisible();
    // The pair is named by the title's words, with no marks in its name.
    await expect(page.getByRole("group", { name: title })).toBeVisible();
    await expect(
      page.getByRole("button", { name: words["Deny all"]! }),
    ).toBeVisible();

    // In a panel wide enough the pair sits beside the title, on the side it ends on.
    const boxes: ApprovalAction = await approvalActionBoxes(page);
    expect(boxes.choice.x + boxes.choice.width).toBeLessThan(boxes.title.x);
    await screenshot(page, "approval-1280-fa");
  });

  test("an approval saved before actions stored their words keeps its English lines' punctuation at their end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=fa&thread=approval&words=none");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const line: { direction: string; stop: number; end: number } = await page
      .getByTestId("tool-approval-description")
      .evaluate(
        (
          element: Element,
        ): { direction: string; stop: number; end: number } => {
          const isolate: HTMLElement = element.querySelector(
            "bdi",
          ) as HTMLElement;
          const text: Text = isolate.firstChild as Text;
          const range: Range = document.createRange();
          range.setStart(text, text.length - 1);
          range.setEnd(text, text.length);
          return {
            direction: window.getComputedStyle(isolate).direction,
            stop: range.getBoundingClientRect().right,
            end: isolate.getBoundingClientRect().right,
          };
        },
      );

    // 'Linked to host "test01".' - its full stop at its right, not its left.
    await expect(page.getByTestId("tool-approval-description")).toHaveText(
      'Severity: High. Linked to host "test01".',
    );
    expect(line.direction).toBe("ltr");
    expect(Math.abs(line.end - line.stop)).toBeLessThanOrEqual(1);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("an English title too long for the header is cut at its own end", async ({
      page,
    }: {
      page: Page;
    }) => {
      await load(page, "lang=fa&thread=answered");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const heading: {
        direction: string;
        cut: boolean;
        first: number;
        left: number;
      } = await page.getByTestId("ask-ai-title").evaluate(
        (
          element: Element,
        ): {
          direction: string;
          cut: boolean;
          first: number;
          left: number;
        } => {
          const text: Text = element.firstChild as Text;
          const range: Range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 3);
          return {
            direction: window.getComputedStyle(element).direction,
            cut: element.scrollWidth > element.clientWidth,
            first: range.getBoundingClientRect().left,
            left: element.getBoundingClientRect().left,
          };
        },
      );

      expect(heading.cut).toBe(true);
      expect(heading.direction).toBe("ltr");
      // "Why" is on screen at the title's start; its end is what is cut.
      expect(Math.abs(heading.first - heading.left)).toBeLessThanOrEqual(1);
    });

    test("nothing is wider than the screen", async ({
      page,
    }: {
      page: Page;
    }) => {
      await load(page, "lang=fa&thread=answered");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      await expectNothingScrollsSideways(page);
      await screenshot(page, "answer-390-fa");
    });

    test("an approval card in Persian fits, its pair under the title", async ({
      page,
    }: {
      page: Page;
    }) => {
      await load(page, "lang=fa&thread=approval");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const boxes: ApprovalAction = await approvalActionBoxes(page);
      expect(boxes.choice.y).toBeGreaterThanOrEqual(
        boxes.title.y + boxes.title.height - 1,
      );
      // Under the title, at the side the page reads from: the right.
      expect(
        Math.abs(
          boxes.choice.x +
            boxes.choice.width -
            (boxes.title.x + boxes.title.width),
        ),
      ).toBeLessThanOrEqual(2);

      await expectNothingScrollsSideways(page);
      await screenshot(page, "approval-390-fa");
    });
  });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the panel appears without moving, and nothing pulses", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);

    expect(
      await askAi(page).evaluate((element: Element): string => {
        return window.getComputedStyle(element).transitionProperty;
      }),
    ).toBe("none");

    await ask(page, LATENCY_QUESTION);
    const animations: Array<string> = await page
      .getByTestId("ai-chat-live")
      .evaluate((live: Element): Array<string> => {
        return Array.from(live.querySelectorAll("*")).map(
          (element: Element): string => {
            return window.getComputedStyle(element).animationName;
          },
        );
      });
    expect(
      animations.filter((name: string): boolean => {
        return name !== "none";
      }),
    ).toEqual([]);
    // The step still reads, without its shimmer.
    expect(
      await luminanceOf(page.getByTestId("ai-chat-live-step"), "color"),
    ).toBeLessThan(0.4);
  });
});

/*
 * Ask AI's questions follow the record on screen (the follow-up #5273
 * listed): read with the incident's title each time Ask AI opens, a
 * resolved incident's questions ask how the response went and what would
 * stop it coming back, not for a status update on what is known so far.
 */
test.describe("on a resolved incident", () => {
  const RESOLVED_SUGGESTIONS: Array<string> = [
    "Summarize",
    "Find root cause",
    "Response timeline",
    "Prevent a repeat",
  ];

  test("its questions are a resolved incident's, and one asks it about the incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "incident=resolved&run=hold");
    await openAskAi(page);

    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
    const chips: Locator = page.getByTestId("ai-chat-suggestion");
    await expect(chips).toHaveText(RESOLVED_SUGGESTIONS);
    await expect(chips.first()).toHaveAttribute(
      "title",
      "Summarize this incident: what happened, how long it lasted, and how it was resolved.",
    );
    await expect(
      chips.filter({ hasText: "Response timeline" }),
    ).toHaveAttribute(
      "title",
      "How long did this incident take to acknowledge and to resolve, and where did the response slow down?",
    );
    await screenshot(page, "start-resolved-incident-1280");

    await chips.filter({ hasText: "Prevent a repeat" }).click();

    await expect(page.getByTestId("ai-chat-live")).toBeVisible();
    expect((await state(page)).sent).toEqual([
      expect.objectContaining({
        content:
          "What would stop this incident from happening again? Base it on its root cause and on similar past incidents.",
        // Where it stands stays in the browser: the server reads the incident.
        pageContext: {
          type: "Incident",
          entityId: INCIDENT_ID,
          entityTitle: "#42 Checkout latency above 2s",
        },
      }),
    ]);
  });

  test("an open incident keeps the incident's own questions, its state read all the same", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "incident=open");
    await openAskAi(page);

    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText(
      INCIDENT_SUGGESTIONS,
    );
  });

  test("in German, the resolved incident's questions are German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "incident=resolved&lang=de");
    await openAskAi(page);

    await expect(page.getByTestId("ai-chat-suggestion")).toHaveText([
      "Zusammenfassen",
      "Grundursache finden",
      "Ablauf der Reaktion",
      "Wiederholung verhindern",
    ]);
    await expect(
      page
        .getByTestId("ai-chat-suggestion")
        .filter({ hasText: "Wiederholung verhindern" }),
    ).toHaveAttribute(
      "title",
      "Was würde verhindern, dass dieser Vorfall erneut auftritt? Stütze dich auf seine Grundursache und auf ähnliche frühere Vorfälle.",
    );
    await screenshot(page, "start-resolved-incident-1280-de");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("its questions fit, in German and in Persian", async ({
      page,
    }: {
      page: Page;
    }) => {
      for (const lang of ["de", "fa"]) {
        await load(page, `incident=resolved&lang=${lang}`);
        await openAskAi(page);

        await expect(page.getByTestId("ai-chat-suggestion")).toHaveCount(4);
        await expectNothingScrollsSideways(page);
        await screenshot(page, `start-resolved-incident-390-${lang}`);
      }
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * An action's arguments and the cards it leaves, read at a glance
 * (fu-ask-ai-polish's UI review)
 *
 * The approval card ran an action's arguments together on one line cut at
 * two, each value cut at 80 characters and set in monospace: a public
 * status update's note was cut mid-sentence, and its "Notify subscribers:
 * Yes" fell off the end on a phone, never seen before the update was
 * approved. Each argument is a line of its own now, read whole, in the
 * card's own face. The cards an action leaves set each fact beside its
 * name at every width, which on a phone left a German fact's value a
 * third of the card: below 22rem of card the facts sit under their names.
 * ---------------------------------------------------------------------------
 */

const STATUS_UPDATE_NOTE: string =
  "We have found the cause of the slow checkouts and are rolling out a fix. Payments are not affected, and orders placed during the slowdown will go through.";
const INTERNAL_NOTE: string =
  "pgbouncer on test01 held 400 connections to the old primary after the failover. Restarted it at 14:25.";

// The text of each argument row of an action on the approval card.
async function argumentRows(action: Locator): Promise<Array<string>> {
  return action
    .getByTestId("tool-approval-argument")
    .evaluateAll((rows: Array<Element>): Array<string> => {
      return rows.map((row: Element): string => {
        return (row.textContent || "").replace(/\s+/g, " ").trim();
      });
    });
}

// Whether any of the elements is cut short: clamped or overflowing.
async function anyCut(locator: Locator): Promise<boolean> {
  return locator.evaluateAll((elements: Array<Element>): boolean => {
    return elements.some((element: Element): boolean => {
      return (
        element.scrollHeight > element.clientHeight + 1 ||
        element.scrollWidth > element.clientWidth + 1
      );
    });
  });
}

test.describe("an action's arguments and the cards it leaves", () => {
  test("each argument is a line of its own, read whole, in the card's own face", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=actions");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await expect(
      askAi(page).getByText("The AI wants to perform 2 actions"),
    ).toBeVisible();

    const [statusUpdate, note] = [
      page.getByTestId("tool-approval-action").nth(0),
      page.getByTestId("tool-approval-action").nth(1),
    ];
    await expect(statusUpdate.getByTestId("tool-approval-title")).toHaveText(
      "Post public status update on incident #42",
    );
    // The update's text is named as the card it leaves names it.
    expect(await argumentRows(statusUpdate)).toEqual([
      `Status update: ${STATUS_UPDATE_NOTE}`,
      "Notify subscribers: Yes",
    ]);
    expect(await argumentRows(note)).toEqual([`Note: ${INTERNAL_NOTE}`]);

    // Nothing cut short, and never the incident's ID the title names.
    expect(await anyCut(page.getByTestId("tool-approval-argument"))).toBe(
      false,
    );
    await expect(
      page.getByTestId("tool-approval-arguments").first(),
    ).not.toContainText(INCIDENT_ID);

    // A note is prose: in the card's face, not in monospace.
    const fonts: Array<string> = await page
      .getByTestId("tool-approval-argument-value")
      .evaluateAll((values: Array<Element>): Array<string> => {
        return values.map((value: Element): string => {
          return window.getComputedStyle(value.querySelector("bdi") || value)
            .fontFamily;
        });
      });
    expect(fonts).toHaveLength(3);
    for (const font of fonts) {
      expect(font).not.toMatch(MONOSPACE);
    }

    await screenshot(page, "approval-arguments-1280");
  });

  test("the cards they leave set each fact beside its name in a panel with room for it, and no row repeats them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await keepPanelWidth(page, 640);
    await load(page, "thread=actions");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await page.getByRole("button", { name: "Run 2 actions" }).click();

    const cards: Locator = page.getByTestId("ai-chat-resource-card");
    await expect(cards).toHaveCount(2);
    await expect(
      cards.nth(0).getByTestId("ai-chat-resource-card-line"),
    ).toHaveText("Status update posted, subscribers notified");
    await expect(
      cards.nth(1).getByTestId("ai-chat-resource-card-line"),
    ).toHaveText("Private note added, for your team only");
    // Each action is its card: no Executed row under them.
    await expect(page.getByTestId("tool-approval-history")).toHaveCount(0);
    await settle(page);

    const fact: Locator = cards
      .nth(0)
      .getByTestId("ai-chat-resource-card-fact");
    await expect(
      fact.getByTestId("ai-chat-resource-card-fact-label"),
    ).toHaveText("Status update");
    const [label, value] = await boxesInOneFrame([
      fact.getByTestId("ai-chat-resource-card-fact-label"),
      fact.getByTestId("ai-chat-resource-card-fact-value"),
    ]);
    // Beside its name, on its line.
    expect(Math.abs(label!.y - value!.y)).toBeLessThanOrEqual(2);
    expect(label!.x + label!.width).toBeLessThanOrEqual(value!.x);

    await screenshot(page, "cards-wide-1280");
  });

  test("in the panel at the width it opens at, a card's facts sit under their names, the card's whole width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=actions");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await page.getByRole("button", { name: "Run 2 actions" }).click();

    const card: Locator = page.getByTestId("ai-chat-resource-card").first();
    await expect(card).toBeVisible();
    await settle(page);

    const fact: Locator = card.getByTestId("ai-chat-resource-card-fact");
    const [text, label, value] = await boxesInOneFrame([
      card.getByTestId("ai-chat-resource-card-heading"),
      fact.getByTestId("ai-chat-resource-card-fact-label"),
      fact.getByTestId("ai-chat-resource-card-fact-value"),
    ]);
    expect(value!.y).toBeGreaterThanOrEqual(label!.y + label!.height - 1);
    expect(Math.abs(value!.x - label!.x)).toBeLessThanOrEqual(1);
    expect(value!.width).toBeGreaterThanOrEqual(text!.width - 1);

    await expectNothingScrollsSideways(page);
    await screenshot(page, "cards-1280");
  });

  test.describe("on a phone, in German", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("whether subscribers hear of an update is in sight, under its whole note", async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: Record<string, string> = dashboardWords("de");

      await load(page, "lang=de&thread=actions");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const statusUpdate: Locator = page
        .getByTestId("tool-approval-action")
        .nth(0);
      expect(await argumentRows(statusUpdate)).toEqual([
        `${words["Status update"]}: ${STATUS_UPDATE_NOTE}`,
        `${words["Notify subscribers"]}: ${words["Yes"]}`,
      ]);
      expect(await anyCut(page.getByTestId("tool-approval-argument"))).toBe(
        false,
      );

      // Inside its action's box, above Allow and Skip.
      const [box, notify, choice] = await boxesInOneFrame([
        statusUpdate,
        statusUpdate.getByTestId("tool-approval-argument").nth(1),
        statusUpdate.getByTestId("tool-approval-choice"),
      ]);
      expect(notify!.height).toBeGreaterThan(0);
      expect(notify!.y).toBeGreaterThanOrEqual(box!.y);
      expect(notify!.y + notify!.height).toBeLessThanOrEqual(choice!.y);

      await expectNothingScrollsSideways(page);
      await screenshot(page, "approval-arguments-390-de");
    });

    test("a card's facts sit under their names, the card's whole width", async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: Record<string, string> = dashboardWords("de");

      await load(page, "lang=de&thread=actions");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      await page
        .getByRole("button", {
          name: filled(words, "Run {{count}} actions", { count: "2" }),
        })
        .click();

      const cards: Locator = page.getByTestId("ai-chat-resource-card");
      await expect(cards).toHaveCount(2);
      await settle(page);

      for (const index of [0, 1]) {
        const card: Locator = cards.nth(index);
        const fact: Locator = card.getByTestId("ai-chat-resource-card-fact");
        const [text, label, value] = await boxesInOneFrame([
          card.getByTestId("ai-chat-resource-card-heading"),
          fact.getByTestId("ai-chat-resource-card-fact-label"),
          fact.getByTestId("ai-chat-resource-card-fact-value"),
        ]);
        // Under its name, from the same edge, as wide as the card's text.
        expect(value!.y).toBeGreaterThanOrEqual(label!.y + label!.height - 1);
        expect(Math.abs(value!.x - label!.x)).toBeLessThanOrEqual(1);
        expect(value!.width).toBeGreaterThanOrEqual(text!.width - 1);
      }

      await expect(
        cards.nth(0).getByTestId("ai-chat-resource-card-fact-label"),
      ).toHaveText(words["Status update"]!);
      await expectNothingScrollsSideways(page);
      await screenshot(page, "cards-390-de");
    });
  });
});
