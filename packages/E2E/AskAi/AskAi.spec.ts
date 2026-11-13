import {
  Download,
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { inflateSync } from "zlib";
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
    /*
     * Starting and the metrics it aggregates: the model call that chose
     * them answered, and is no step of its own (issue #6437).
     */
    await expect(toggle).toHaveText("2 steps");
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

/*
 * A table cell's text as it was laid out: the text of each line, how wide
 * its text may be, and each break that fell inside a part of a word - not
 * at a space, a hyphen or a slash - with how wide that part is. A part is
 * a text of its own: the words between a long word's or a path's places
 * to wrap (DataTableWidget draws a <wbr> between them), or a run of words.
 * A part broken inside is wider than the room, give or take the half
 * pixel its letters' boxes are rounded by (PART_ROUNDING).
 */
const PART_ROUNDING: number = 0.5;

interface CellLayout {
  lines: Array<string>;
  room: number;
  brokenParts: Array<{ part: string; width: number }>;
}

async function cellLayoutOf(cell: Locator): Promise<CellLayout> {
  return cell.evaluate((element: Element): CellLayout => {
    const style: CSSStyleDeclaration = window.getComputedStyle(element);
    // To the fraction of a pixel: clientWidth is rounded to a whole one.
    const room: number =
      element.getBoundingClientRect().width -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      parseFloat(style.borderLeftWidth) -
      parseFloat(style.borderRightWidth);
    // Where a line may end without breaking a part: a space, a hyphen, a slash.
    const wrapsAfter: RegExp = /[\s/\\-]/;
    const lines: Array<string> = [];
    const brokenParts: Array<{ part: string; width: number }> = [];
    let line: string = "";
    let top: number | null = null;
    const walker: TreeWalker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
    );

    for (
      let node: Node | null = walker.nextNode();
      node;
      node = walker.nextNode()
    ) {
      const text: string = node.textContent || "";
      for (let index: number = 0; index < text.length; index++) {
        const letter: Range = document.createRange();
        letter.setStart(node, index);
        letter.setEnd(node, index + 1);
        const box: DOMRect | undefined = Array.from(
          letter.getClientRects(),
        ).find((rect: DOMRect): boolean => {
          return rect.width > 0;
        });

        if (box) {
          const boxTop: number = Math.round(box.top);
          if (top !== null && boxTop > top + 2) {
            lines.push(line);
            line = "";
            if (index > 0 && !wrapsAfter.test(text[index - 1]!)) {
              const part: Range = document.createRange();
              part.selectNodeContents(node);
              brokenParts.push({
                part: text,
                width: Array.from(part.getClientRects()).reduce(
                  (sum: number, rect: DOMRect): number => {
                    return sum + rect.width;
                  },
                  0,
                ),
              });
            }
          }
          top = boxTop;
        }
        line += text[index];
      }
    }
    lines.push(line);

    return { lines, room, brokenParts };
  });
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
   * A path - an endpoint, a URL - has no spaces to wrap at. Kept whole when
   * its parts were short, "POST /ledger/entries" was as wide as a long word,
   * and the table above no longer fit a 390 pixel phone (issue #6969). It
   * may break anywhere now, after its slashes first: never "/ledger/en"
   * over "tries", and a part of it is broken only when it is wider than
   * its column.
   */
  test("on a phone a path wraps after its slashes, and a part of it breaks only when it is wider than its column", async ({
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

    // Four columns a row: the endpoints are the first.
    const cells: Locator = table.getByTestId("ai-chat-table-cell");
    const ledger: Locator = cells.nth(8);
    await expect(ledger).toHaveAttribute("title", "POST /ledger/entries");

    const ledgerLayout: CellLayout = await cellLayoutOf(ledger);
    expect(ledgerLayout.lines.join("")).toBe("POST /ledger/entries");
    expect(ledgerLayout.lines.length).toBeGreaterThanOrEqual(2);
    for (const line of ledgerLayout.lines.slice(0, -1)) {
      expect(line, JSON.stringify(ledgerLayout.lines)).toMatch(/[\s/]$/);
    }

    for (const row of [0, 1, 2]) {
      const layout: CellLayout = await cellLayoutOf(cells.nth(row * 4));
      for (const broken of layout.brokenParts) {
        expect(broken.width, broken.part).toBeGreaterThan(
          layout.room - PART_ROUNDING,
        );
      }
    }
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
      { title: "Choose LLM provider", menu: "LLM provider" },
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
    await expect(page.getByTitle("Choose LLM provider")).toHaveCount(0);

    await load(page, "providers=two");
    await openAskAi(page);
    await page.getByTitle("Choose LLM provider").click();
    const menu: Locator = page.getByRole("menu", { name: "LLM provider" });
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
      "2 Schritte",
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
      "این حادثه \u{2022} #42 Checkout latency above 2s",
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
    ).toHaveText(
      "Private note added, only for people who can see the incident",
    );
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

/*
 * ---------------------------------------------------------------------------
 * A code change's cautions (issue #6570's UI review)
 * ---------------------------------------------------------------------------
 *
 * Ask AI writes each file of a commit whole, so its card names the files it
 * would write over unseen before anyone approves it. A long answer leaves out
 * its oldest results, so a file read early in it can be one Ask AI no longer
 * has - "read earlier in this answer", beside "read in an earlier answer"
 * (#6365) and "changed since Ask AI read it". Run together as one paragraph
 * the two that begin alike read as one sentence, and the files at their ends
 * were lost in the middle; each is a caution of its own now: a line each,
 * marked at its start, in the order the card weighs them.
 */

/*
 * The thread's four cautions, in the order the card weighs them
 * (?thread=code). The last is of a file Ask AI read all of, in two parts,
 * the first of them left out since: read, so never "read only part of"
 * (issue #6984).
 */
const CODE_CAUTION_KEYS: Array<[string, Record<string, string>]> = [
  [
    "These {{count}} files changed on {{branch}} after Ask AI read them, and Ask AI's versions undo those changes: {{files}}._one",
    { branch: "fix/login", files: "src/billing/refund.ts" },
  ],
  [
    "Ask AI read these {{count}} files in an earlier answer and no longer has their text, and its versions replace all of them: {{files}}._one",
    { files: "README.md" },
  ],
  [
    "Ask AI read these {{count}} files earlier in this answer and no longer has their text, and its versions replace all of them: {{files}}._one",
    { files: "src/billing/charge.ts" },
  ],
  [
    "Ask AI read these {{count}} files and no longer has part of their text, and its versions replace all of them: {{files}}._one",
    { files: "src/billing/ledger.ts" },
  ],
];

const CODE_CAUTIONS: Array<string> = [
  "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/billing/refund.ts.",
  "Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: README.md.",
  "Ask AI read this file earlier in this answer and no longer has its text, and its version replaces all of it: src/billing/charge.ts.",
  "Ask AI read this file and no longer has part of its text, and its version replaces all of it: src/billing/ledger.ts.",
];

// The card's amber, one mark a caution: in the light theme, and in the dark.
const CAUTION_AMBER: string = "rgb(217, 119, 6)";
const CAUTION_AMBER_DARK: string = "rgb(252, 211, 77)";

// Each caution of the card: its line, its mark and its sentence.
interface CautionBoxes {
  line: Box;
  mark: Box;
  sentence: Box;
}

// The action's box and each of its cautions, read in one frame.
interface CautionsRead {
  action: Box;
  cautions: Array<CautionBoxes>;
}

async function cautionBoxes(page: Page): Promise<CautionsRead> {
  const action: Locator = page.getByTestId("tool-approval-action");
  const cautions: Locator = action.getByTestId("tool-approval-caution");
  const count: number = await cautions.count();
  const locators: Array<Locator> = [action];

  for (let index: number = 0; index < count; index++) {
    const caution: Locator = cautions.nth(index);
    locators.push(caution, caution.locator("svg"), caution.locator("> span"));
  }

  const boxes: Array<Box> = await boxesInOneFrame(locators);
  const read: Array<CautionBoxes> = [];

  for (let index: number = 0; index < count; index++) {
    read.push({
      line: boxes[1 + index * 3]!,
      mark: boxes[1 + index * 3 + 1]!,
      sentence: boxes[1 + index * 3 + 2]!,
    });
  }

  return { action: boxes[0]!, cautions: read };
}

// How tall a line of a caution's sentence is, as the card sets it.
async function cautionLineHeight(page: Page): Promise<number> {
  return page
    .getByTestId("tool-approval-caution")
    .first()
    .locator("> span")
    .evaluate((element: Element): number => {
      return parseFloat(window.getComputedStyle(element).lineHeight);
    });
}

// The colour each caution's mark is drawn in.
async function markColours(page: Page): Promise<Array<string>> {
  return page
    .getByTestId("tool-approval-caution")
    .locator("svg")
    .evaluateAll((marks: Array<Element>): Array<string> => {
      return marks.map((mark: Element): string => {
        return window.getComputedStyle(mark).color;
      });
    });
}

/*
 * Each caution its own line, stacked in order and inside the action's box -
 * a long one wraps there, never running past the card; each mark beside its
 * sentence, at the start the page reads from, level with the sentence's
 * first line; and the marks in one column, the sentences in another. Gives
 * back the cautions read, for a test to hold more of them.
 */
async function expectCautionsALineEach(
  page: Page,
  direction: "ltr" | "rtl",
): Promise<Array<CautionBoxes>> {
  const { action, cautions } = await cautionBoxes(page);
  const lineHeight: number = await cautionLineHeight(page);

  expect(cautions).toHaveLength(CODE_CAUTIONS.length);

  for (const caution of cautions) {
    for (const box of [caution.line, caution.mark, caution.sentence]) {
      expect(box.x).toBeGreaterThanOrEqual(action.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(
        action.x + action.width + 0.5,
      );
    }
  }

  for (let index: number = 1; index < cautions.length; index++) {
    // Under the one before it, never beside it on its last line.
    expect(cautions[index]!.line.y).toBeGreaterThanOrEqual(
      cautions[index - 1]!.line.y + cautions[index - 1]!.line.height - 0.5,
    );
  }

  for (const caution of cautions) {
    if (direction === "ltr") {
      expect(caution.mark.x + caution.mark.width).toBeLessThanOrEqual(
        caution.sentence.x + 0.5,
      );
    } else {
      expect(caution.mark.x).toBeGreaterThanOrEqual(
        caution.sentence.x + caution.sentence.width - 0.5,
      );
    }

    // Level with the sentence's first line, however many lines it wraps to.
    expect(
      Math.abs(
        caution.mark.y +
          caution.mark.height / 2 -
          (caution.sentence.y + lineHeight / 2),
      ),
    ).toBeLessThanOrEqual(1.5);
  }

  // One column of marks, one of sentences.
  const startOf: (box: Box) => number = (box: Box): number => {
    return direction === "ltr" ? box.x : box.x + box.width;
  };

  for (const caution of cautions) {
    expect(
      Math.abs(startOf(caution.mark) - startOf(cautions[0]!.mark)),
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(startOf(caution.sentence) - startOf(cautions[0]!.sentence)),
    ).toBeLessThanOrEqual(0.5);
  }

  return cautions;
}

test.describe("a code change's cautions", () => {
  test("each caution is a line of its own, marked at its start, in the order the card weighs them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=code");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const action: Locator = page.getByTestId("tool-approval-action");
    await expect(action.getByTestId("tool-approval-title")).toHaveText(
      "Commit 4 files to fix/login",
    );

    const cautions: Locator = action.getByTestId("tool-approval-caution");
    await expect(cautions).toHaveCount(CODE_CAUTIONS.length);
    for (let index: number = 0; index < CODE_CAUTIONS.length; index++) {
      // Each keeps the space that went before it in the card's text.
      expect((await wordsOf(cautions.nth(index))).trim()).toBe(
        CODE_CAUTIONS[index],
      );
    }
    await expect(action.getByTestId("tool-approval-cautions")).toHaveAttribute(
      "role",
      "list",
    );

    await expectCautionsALineEach(page, "ltr");

    // Marked in the card's amber, the colour of its own heading.
    expect(await markColours(page)).toEqual(
      CODE_CAUTIONS.map((): string => {
        return CAUTION_AMBER;
      }),
    );

    /*
     * A file read whole and partly lost since is said to be read, and no
     * longer all in hand: never "read only part of" (issue #6984).
     */
    const partLost: string = (
      await wordsOf(cautions.nth(CODE_CAUTIONS.length - 1))
    ).trim();
    expect(partLost).toContain("no longer has part of its text");
    expect(partLost).not.toContain("only part");

    // The commit's message and its files still read under its cautions.
    expect(await argumentRows(action)).toEqual([
      "Commit message: fix: round charges and refunds to the cent",
      "Files: 4",
    ]);

    await screenshot(page, "code-cautions-1280");
  });

  test("in the dark, each mark takes the dark theme's amber", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "theme=dark&thread=code");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await expect(page.getByTestId("tool-approval-caution")).toHaveCount(
      CODE_CAUTIONS.length,
    );
    expect(await markColours(page)).toEqual(
      CODE_CAUTIONS.map((): string => {
        return CAUTION_AMBER_DARK;
      }),
    );

    await screenshot(page, "code-cautions-1280-dark");
  });

  test.describe("on a phone, in Persian", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("each caution reads right to left, its mark at its start on the right, and nothing is wider than the screen", async ({
      page,
    }: {
      page: Page;
    }) => {
      await load(page, "lang=fa&thread=code");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const words: Record<string, string> = dashboardWords("fa");
      const cautions: Locator = page.getByTestId("tool-approval-caution");
      await expect(cautions).toHaveCount(CODE_CAUTION_KEYS.length);

      for (let index: number = 0; index < CODE_CAUTION_KEYS.length; index++) {
        const [key, values] = CODE_CAUTION_KEYS[index]!;
        expect((await wordsOf(cautions.nth(index))).trim()).toBe(
          filled(words, key, values),
        );
        await expect(cautions.nth(index).locator("bdi")).toHaveAttribute(
          "dir",
          "rtl",
        );
      }

      const drawn: Array<CautionBoxes> = await expectCautionsALineEach(
        page,
        "rtl",
      );
      // Each is longer than a phone's line, so each wraps inside the card.
      const lineHeight: number = await cautionLineHeight(page);
      for (const caution of drawn) {
        expect(caution.sentence.height).toBeGreaterThanOrEqual(
          lineHeight * 2 - 1,
        );
      }

      await expectNothingScrollsSideways(page);
      await screenshot(page, "code-cautions-390-fa");
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Monitors looked up, and the monitors table (issues #6968, #6969 and #7175)
 * ---------------------------------------------------------------------------
 *
 * "Which monitors are down right now?", answered with two monitors read by
 * id and the table query_monitors lists them in (?thread=monitors).
 *
 *   - Every card a tool left was drawn as a write's - green, with a check -
 *     so a monitor that was Offline, or whose monitoring was off, had a
 *     green check beside it. A read's card is plain now, as the other
 *     widgets are, its status's own colour a dot before the line that
 *     names it: the Offline red, and gray for monitoring off.
 *   - The table let every word break anywhere, and on a 360 pixel phone
 *     its Status column drew "Operational" as "Operationa" over "l". A
 *     word is whole now; only a long one, or a path - a URL, an endpoint -
 *     may break anywhere, after its slashes first.
 */

interface StatusDot {
  color: string;
  dot: { left: number; right: number; top: number; bottom: number };
  words: { left: number; right: number; top: number; bottom: number };
}

// A card's status dot, and the words of the line it stands before, in one read.
async function statusDotOf(card: Locator): Promise<StatusDot> {
  return card.evaluate((element: Element): StatusDot => {
    const line: Element = element.querySelector(
      '[data-testid="ai-chat-resource-card-line"]',
    )!;
    const dot: Element = line.querySelector(
      '[data-testid="ai-chat-resource-card-status-dot"]',
    )!;
    const range: Range = document.createRange();
    range.setStartAfter(dot);
    range.setEnd(line, line.childNodes.length);
    const words: DOMRect = range.getBoundingClientRect();
    const box: DOMRect = dot.getBoundingClientRect();

    return {
      color: window.getComputedStyle(dot).backgroundColor,
      dot: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      },
      words: {
        left: words.left,
        right: words.right,
        top: words.top,
        bottom: words.bottom,
      },
    };
  });
}

interface CardLook {
  origin: string | null;
  background: string;
  border: string;
  kind: string;
  checks: number;
  greens: number;
}

// How a card is drawn: its surface, its edge, its kind's colour, any check or green.
async function cardLookOf(card: Locator): Promise<CardLook> {
  return card.evaluate((element: Element): CardLook => {
    const style: CSSStyleDeclaration = window.getComputedStyle(element);
    const kind: Element = element.querySelector(
      '[data-testid="ai-chat-resource-card-kind"]',
    )!;

    return {
      origin: element.getAttribute("data-card-origin"),
      background: style.backgroundColor,
      border: style.borderTopColor,
      kind: window.getComputedStyle(kind).color,
      checks: element.querySelectorAll(
        '[data-testid="ai-chat-resource-card-done"]',
      ).length,
      greens: element.querySelectorAll('[class*="emerald"]').length,
    };
  });
}

// The lines a cell's text was laid out on.
async function linesOfCell(cell: Locator): Promise<number> {
  return cell.evaluate((element: Element): number => {
    const range: Range = document.createRange();
    range.selectNodeContents(element);
    return new Set(
      Array.from(range.getClientRects()).map((rect: DOMRect): number => {
        return Math.round(rect.top);
      }),
    ).size;
  });
}

test.describe("monitors looked up, and the monitors table", () => {
  test("a monitor looked up is drawn plain - no green, no check - its status a dot in its own colour, light and dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await load(
        page,
        theme === "dark" ? "theme=dark&thread=monitors" : "thread=monitors",
      );
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const cards: Locator = page.getByTestId("ai-chat-resource-card");
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0)).toContainText("Checkout API");
      await expect(cards.nth(1)).toContainText("Backup Job");
      await cards.nth(1).scrollIntoViewIfNeeded();
      await settle(page);

      for (const card of await cards.all()) {
        expect(await cardLookOf(card)).toEqual(
          theme === "dark"
            ? {
                origin: "read",
                // The dark theme's surface and edge, as the other widgets have.
                background: "rgb(23, 32, 51)",
                border: "rgb(71, 85, 105)",
                kind: expect.any(String),
                checks: 0,
                greens: 0,
              }
            : {
                origin: "read",
                background: "rgb(255, 255, 255)",
                border: "rgb(229, 231, 235)",
                kind: "rgb(107, 114, 128)",
                checks: 0,
                greens: 0,
              },
        );
      }

      if (theme === "dark") {
        // Its kind is read on the dark surface.
        expect(
          await luminanceOf(
            cards.nth(0).getByTestId("ai-chat-resource-card-kind"),
            "color",
          ),
        ).toBeGreaterThan(0.25);
      }

      // Offline in its own red; monitoring off in gray: in either theme.
      const offline: StatusDot = await statusDotOf(cards.nth(0));
      const disabled: StatusDot = await statusDotOf(cards.nth(1));
      expect(offline.color).toBe("rgb(253, 98, 94)");
      expect(disabled.color).toBe("rgb(107, 114, 128)");

      for (const drawn of [offline, disabled]) {
        // A dot, 8 pixels round, before the words, on their line.
        expect(drawn.dot.right - drawn.dot.left).toBeCloseTo(8, 0);
        expect(drawn.dot.bottom - drawn.dot.top).toBeCloseTo(8, 0);
        expect(drawn.dot.right).toBeLessThanOrEqual(drawn.words.left);
        expect(drawn.words.left - drawn.dot.right).toBeLessThanOrEqual(8);
        const middle: number = (drawn.dot.top + drawn.dot.bottom) / 2;
        expect(middle).toBeGreaterThan(drawn.words.top);
        expect(middle).toBeLessThan(drawn.words.bottom);
      }

      await expect(
        cards.nth(0).getByTestId("ai-chat-resource-card-line"),
      ).toHaveText("Offline");
      await expect(
        cards.nth(1).getByTestId("ai-chat-resource-card-line"),
      ).toHaveText("Disabled");

      await screenshot(
        page,
        theme === "dark" ? "monitor-cards-1280-dark" : "monitor-cards-1280",
      );
    }
  });

  test.describe("on a phone, in Persian", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("right to left, the dot stands where the line starts: at its right", async ({
      page,
    }: {
      page: Page;
    }) => {
      await load(page, "lang=fa&thread=monitors");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const cards: Locator = page.getByTestId("ai-chat-resource-card");
      await expect(cards).toHaveCount(2);
      await cards.nth(0).scrollIntoViewIfNeeded();
      await settle(page);

      for (const card of await cards.all()) {
        const drawn: StatusDot = await statusDotOf(card);
        expect(drawn.dot.left).toBeGreaterThanOrEqual(drawn.words.right);
        expect(drawn.dot.left - drawn.words.right).toBeLessThanOrEqual(8);

        const look: CardLook = await cardLookOf(card);
        expect(look.checks).toBe(0);
        expect(look.greens).toBe(0);
      }

      await expectNothingScrollsSideways(page);
      await screenshot(page, "monitor-cards-390-fa");
    });
  });

  test.describe("on a 360 pixel phone", () => {
    test.use({ viewport: { width: 360, height: 780 } });

    test("the monitors table keeps Operational whole on its line, and wraps a monitor's long URL inside the table", async ({
      page,
    }: {
      page: Page;
    }) => {
      await load(page, "thread=monitors");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const table: Locator = page.locator("table").filter({
        hasText: "legacy-payments-api",
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

      const rows: Locator = table.locator("tbody tr");
      await expect(rows).toHaveCount(4);

      const statuses: Array<string> = [];
      for (const row of await rows.all()) {
        const status: Locator = row.getByTestId("ai-chat-table-cell").nth(2);
        statuses.push((await status.textContent()) || "");
        // One line each: "Operational" is never "Operationa" over "l".
        expect(await linesOfCell(status)).toBe(1);
      }
      expect(statuses).toEqual([
        "Offline",
        "Operational",
        "Operational",
        "Disabled",
      ]);

      /*
       * The URL has no spaces to wrap at: it wraps inside the table, after
       * its slashes first, and anywhere in a part wider than its column.
       * Its scheme stays with its host: "https://" alone took a line of
       * the three a cell shows, and said nothing.
       */
      const url: Locator = rows.nth(1).getByTestId("ai-chat-table-cell").nth(0);
      await expect(url).toHaveAttribute(
        "title",
        "https://payments.example.com/api/v2/health/checkout",
      );
      expect(await linesOfCell(url)).toBeGreaterThanOrEqual(2);
      const urlLayout: CellLayout = await cellLayoutOf(url);
      expect(urlLayout.lines.join("")).toBe(
        "https://payments.example.com/api/v2/health/checkout",
      );
      expect(urlLayout.lines[0]!.length).toBeGreaterThan("https://".length);
      for (const broken of urlLayout.brokenParts) {
        expect(broken.width, broken.part).toBeGreaterThan(
          urlLayout.room - PART_ROUNDING,
        );
      }
      const tableBox: Box = await boxOf(table);
      const urlBox: Box = await boxOf(url);
      expect(urlBox.x + urlBox.width).toBeLessThanOrEqual(
        tableBox.x + tableBox.width + 0.5,
      );
      // ...and still leaves the other two columns most of their room.
      expect(urlBox.width).toBeLessThan(tableBox.width * 0.6);

      await expectNothingScrollsSideways(page);
      await screenshot(page, "monitors-table-360");
    });
  });

  /*
   * Broken anywhere, the URL's host was cut mid-name wherever the column
   * ended: "https://payments.ex" over "ample.com/api/v2/" in the panel at
   * 1024 pixels, "https://payments.example.c" over "om/..." at 1280. It
   * wraps before its host's dots now, as a style guide breaks a URL, and
   * after its slashes: each name whole on its line.
   */
  test("a monitor's URL wraps after its slashes and before its host's dots, each name whole: in the panel at 1280 and 1024, and on a 390 pixel phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    const URL_NAME: string =
      "https://payments.example.com/api/v2/health/checkout";

    for (const width of [1280, 1024, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await load(page, "thread=monitors");
      await expect(askAi(page)).toBeVisible();
      await settle(page);

      const table: Locator = page.locator("table").filter({
        hasText: "legacy-payments-api",
      });
      await table.scrollIntoViewIfNeeded();
      await settle(page);

      const url: Locator = table
        .locator("tbody tr")
        .nth(1)
        .getByTestId("ai-chat-table-cell")
        .nth(0);
      await expect(url).toHaveAttribute("title", URL_NAME);

      const layout: CellLayout = await cellLayoutOf(url);
      const lines: string = JSON.stringify(layout.lines);
      expect(layout.lines.join(""), lines).toBe(URL_NAME);
      // Too long for one line, at every width...
      expect(layout.lines.length, lines).toBeGreaterThanOrEqual(2);
      // ...and never broken inside a name: no part is wider than the column.
      expect(layout.brokenParts, `${width}: ${lines}`).toEqual([]);
      for (let index: number = 0; index < layout.lines.length - 1; index++) {
        // Each line ends after a slash, or the next starts with the host's dot.
        expect(
          layout.lines[index]!.endsWith("/") ||
            layout.lines[index + 1]!.startsWith("."),
          `${width}: ${lines}`,
        ).toBe(true);
      }
      // The scheme stays with the host's first name.
      expect(layout.lines[0]!.startsWith("https://payments"), lines).toBe(true);
    }

    await screenshot(page, "monitors-table-url-390");
  });

  /*
   * Issue #7175: the cards said "MONITOR", "Type", "Website", "Disabled",
   * "Last status" and "Off - not checked" in English on a German or
   * Persian page. They say OneUptime's words in the reader's language now
   * - the status the project named as named - and the dot stays before the
   * line, on the side it reads from, on a phone and beside the page.
   */
  for (const language of ["de", "fa"]) {
    test(`a monitor looked up, in ${language === "de" ? "German" : "Persian"} at 1280 and 390 pixels: every word of ours in the reader's language, the status as named, the dot before the line`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: Record<string, string> = dashboardWords(language);
      const isRightToLeft: boolean = language === "fa";

      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await load(page, `lang=${language}&thread=monitors`);
        await expect(askAi(page)).toBeVisible();
        await settle(page);

        const cards: Locator = page.getByTestId("ai-chat-resource-card");
        await expect(cards).toHaveCount(2);
        const offline: Locator = cards.nth(0);
        const disabled: Locator = cards.nth(1);
        await offline.scrollIntoViewIfNeeded();
        await settle(page);

        const factsOf: (
          card: Locator,
          part: "label" | "value",
        ) => Promise<Array<string>> = async (
          card: Locator,
          part: "label" | "value",
        ): Promise<Array<string>> => {
          const texts: Array<string> = [];
          for (const fact of await card
            .getByTestId(`ai-chat-resource-card-fact-${part}`)
            .all()) {
            texts.push(await wordsOf(fact));
          }
          return texts;
        };

        for (const card of [offline, disabled]) {
          expect(
            await wordsOf(card.getByTestId("ai-chat-resource-card-kind")),
          ).toBe(filled(words, "Monitor"));
        }

        // The status the project named, as named; monitoring off in the reader's words.
        expect(
          await wordsOf(offline.getByTestId("ai-chat-resource-card-line")),
        ).toBe("Offline");
        expect(
          await wordsOf(disabled.getByTestId("ai-chat-resource-card-line")),
        ).toBe(filled(words, "Disabled"));

        expect(await factsOf(offline, "label")).toEqual([
          filled(words, "Type"),
        ]);
        expect(await factsOf(offline, "value")).toEqual([
          filled(words, "Website"),
        ]);
        expect(await factsOf(disabled, "label")).toEqual([
          filled(words, "Type"),
          filled(words, "Last status"),
          filled(words, "Monitoring"),
        ]);
        expect(await factsOf(disabled, "value")).toEqual([
          filled(words, "Incoming Request"),
          "Operational",
          filled(words, "Off - not checked"),
        ]);

        // None of OneUptime's words left in English.
        for (const card of [offline, disabled]) {
          const text: string = await wordsOf(card);
          for (const english of [
            "Monitor",
            "Disabled",
            "Last status",
            "Off - not checked",
            "Incoming Request",
            "Type",
          ]) {
            expect(text, `${language} ${width}: ${text}`).not.toContain(
              english,
            );
          }
        }

        // The dot before the line's words, on the side they read from.
        for (const card of [offline, disabled]) {
          const drawn: StatusDot = await statusDotOf(card);
          if (isRightToLeft) {
            expect(drawn.dot.left).toBeGreaterThanOrEqual(drawn.words.right);
            expect(drawn.dot.left - drawn.words.right).toBeLessThanOrEqual(8);
          } else {
            expect(drawn.dot.right).toBeLessThanOrEqual(drawn.words.left);
            expect(drawn.words.left - drawn.dot.right).toBeLessThanOrEqual(8);
          }
          const middle: number = (drawn.dot.top + drawn.dot.bottom) / 2;
          expect(middle).toBeGreaterThan(drawn.words.top);
          expect(middle).toBeLessThan(drawn.words.bottom);

          const look: CardLook = await cardLookOf(card);
          expect(look.origin).toBe("read");
          expect(look.checks).toBe(0);
          expect(look.greens).toBe(0);
        }

        await expectNothingScrollsSideways(page);
        await screenshot(page, `monitor-cards-${width}-${language}-words`);
      }
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * Every card a read leaves, in the reader's language and in the PDF (issues
 * #7175 and #7202)
 * ---------------------------------------------------------------------------
 *
 * "What do we have set up for payments?", answered with one card of each
 * kind a read leaves (?thread=readcards): a monitor, an SLO, a team, an
 * on-call policy and schedule, a status page, a runbook, a workflow and a
 * security case, each built by its tool's own builder. OneUptime's words
 * on them are the reader's; the names, statuses and descriptions the
 * project wrote are data, as written.
 */

// The kind each card says, in order: the Dashboard's word for it.
const READ_CARD_KINDS: Array<string> = [
  "Monitor",
  "SLO",
  "Team",
  "On-call policy",
  "On-call schedule",
  "Status page",
  "Runbook",
  "Workflow",
  "Security case",
];

/*
 * What the project wrote on the cards (Fixture.js readCards), longest
 * first: names, statuses, descriptions, a URL and an entity's value.
 * Never translated.
 */
const READ_CARD_DATA: Array<string> = [
  "Checkout requests that succeed, over 30 days.",
  "Owns the payments databases and their backups.",
  "Checkout, payments and backups, for our customers.",
  "Drains the queue, then restarts the worker.",
  "Runs on every failed deploy of payments-api.",
  "Pages for every payments incident.",
  "SC-17 Sign-ins from a new country",
  "Page on-call when a deploy fails",
  "Restart the payments worker",
  "https://status.acme.example.com",
  "Payments weekly rotation",
  "Checkout availability",
  "Freeze risky deploys",
  "ana@acme.example.com",
  "Database reliability",
  "Payments primary",
  "Payments stack",
  "Database team",
  "Investigating",
  "Checkout API",
  "Jonas Müller",
  "payments-api",
  "203.0.113.7",
  "Acme Status",
  "Ana Souza",
  "Degraded",
  "Checkout",
  "Payments",
  "Backups",
  "High",
  "SRE",
];

/*
 * The words in Latin letters an Arabic page keeps: names the Arabic
 * Dashboard writes in them (SLO, SLI, API, URL, IP, the time zone), and
 * Deployments, which its locale keeps in English (i18n/Progress/ar.json).
 */
const ARABIC_LATIN_WORDS: Array<string> = [
  "SLO",
  "SLI",
  "API",
  "URL",
  "IP",
  "GMT",
  "Deployments",
];

// OneUptime's own English on the cards, which a German page never shows.
const READ_CARD_ENGLISH: Array<string> = [
  "Owner teams",
  "Owner users",
  "Target",
  "Window",
  "Rolling",
  "Monitor uptime",
  "At Risk",
  "Current SLI",
  "Error budget left",
  "Burn rate",
  "Monitor rules",
  "enabled",
  "Error budget policy tier",
  "Frozen by",
  "No members",
  "Description",
  "Rule ",
  "Pages ",
  "escalates",
  "On call",
  "Hands off",
  "Next up",
  "Next shift",
  "Visibility",
  "Public",
  "Resources shown",
  "monitor group",
  "not monitored",
  "Active subscribers",
  "Disabled",
  "Steps",
  "Enabled",
  "Recent runs",
  "Detections",
  "Entities",
  "IP Address",
];

// A text with the project's own words taken out.
function withoutReadCardData(text: string): string {
  let left: string = text;
  for (const data of READ_CARD_DATA) {
    left = left.split(data).join(" ");
  }
  return left;
}

const LATIN_WORD: RegExp = /[A-Za-z]+/g;

// The width of a card's facts list and of each of its names, in one frame.
interface FactColumns {
  list: number;
  labels: Array<number>;
}

async function factColumnsOf(card: Locator): Promise<FactColumns> {
  return card
    .getByTestId("ai-chat-resource-card-facts")
    .evaluate((list: Element): FactColumns => {
      return {
        list: list.getBoundingClientRect().width,
        labels: Array.from(
          list.querySelectorAll(
            '[data-testid="ai-chat-resource-card-fact-label"]',
          ),
        ).map((label: Element): number => {
          return label.getBoundingClientRect().width;
        }),
      };
    });
}

test.describe("every card a read leaves", () => {
  for (const language of ["ar", "de"]) {
    test(`in ${language === "ar" ? "Arabic" : "German"} at 1280 and 390 pixels: each in the reader's words, every value whole, the names within 40% of the card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const words: Record<string, string> = dashboardWords(language);

      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await load(page, `lang=${language}&thread=readcards`);
        await expect(askAi(page)).toBeVisible();
        await settle(page);

        const cards: Locator = page.getByTestId("ai-chat-resource-card");
        await expect(cards).toHaveCount(READ_CARD_KINDS.length);

        for (const [index, kind] of READ_CARD_KINDS.entries()) {
          const card: Locator = cards.nth(index);
          expect(
            await wordsOf(card.getByTestId("ai-chat-resource-card-kind")),
          ).toBe(filled(words, kind));

          /*
           * Every value whole: an escalation rule's "then escalates after
           * 30 minutes" was cut to "nach 3..." in German.
           */
          expect(
            await anyCut(card.getByTestId("ai-chat-resource-card-fact-value")),
            `${language} ${width}: card ${index + 1}`,
          ).toBe(false);

          const text: string = withoutReadCardData(await wordsOf(card));

          if (language === "ar") {
            // Every word left in Latin letters is one the Arabic page keeps.
            for (const word of text.match(LATIN_WORD) || []) {
              expect(
                ARABIC_LATIN_WORDS,
                `${width}: card ${index + 1} says "${word}" in ${text}`,
              ).toContain(word);
            }
          } else {
            for (const english of READ_CARD_ENGLISH) {
              expect(
                text,
                `${width}: card ${index + 1} says "${english}"`,
              ).not.toContain(english);
            }
          }
        }

        /*
         * Beside their values, the names take at most 40% of the card: a
         * long one wraps there rather than leaving every value a narrow
         * column. On a phone each name is over its value.
         */
        if (width === 1280) {
          for (let index: number = 0; index < READ_CARD_KINDS.length; index++) {
            const columns: FactColumns = await factColumnsOf(cards.nth(index));
            for (const label of columns.labels) {
              expect(label).toBeLessThanOrEqual(columns.list * 0.4 + 1);
            }
          }
        }

        await expectNothingScrollsSideways(page);
        await screenshot(page, `read-cards-${width}-${language}`);
      }
    });
  }

  /*
   * Issue #7202: the PDF drew the first line of a card's long name, line
   * and facts. Each is whole now; a read's card has no title over it that
   * says its kind and name again, as the chat has none; and an on-call
   * shift's moments read as the export writes dates, not as ISO text.
   */
  test("the conversation's PDF: every card's words, no title repeating a card's name, and moments as the export writes dates", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=readcards");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await askAi(page)
      .getByRole("button", { name: "Download conversation" })
      .click();
    const downloading: Promise<Download> = page.waitForEvent("download");
    await page.getByText("Download as PDF", { exact: true }).click();
    const download: Download = await downloading;
    const lines: Array<string> = pdfTextLines(
      readFileSync(await download.path()),
    );
    const text: string = lines.join(" ");

    // The cards' own lines, each drawn whole on a line of its own.
    for (const line of [
      "MONITOR",
      "payments-api",
      "Owner teams",
      "Payments, SRE",
      "Frozen by the error budget policy",
      "Owns the payments databases and their backups.",
      "Rule 2 - Database team",
      'Pages on-call schedule "Payments weekly rotation", then escalates after 30 minutes',
      "Pages no one",
      "On call now: Ana Souza",
      "Oct 26 2026, 13:00 GMT",
      "Nov 02 2026, 13:00 GMT",
      "Jonas Müller",
      "3: Checkout (monitor: Checkout API), Payments (monitor group: Payments stack), Backups - not monitored",
      "IP Address: 203.0.113.7, User: ana@acme.example.com",
    ]) {
      expect(lines, `the PDF draws "${line}"`).toContain(line);
    }

    // The ISO text a card stores for a moment is never printed.
    expect(text).not.toContain("2026-10-26T13:00:00.000Z");
    expect(text).not.toContain("T13:00:00");

    // No title over a read's card says its kind and name again.
    for (const title of [
      "Monitor payments-api",
      "SLO Checkout availability",
      "On-call policy: Payments primary",
      "Status page: Acme Status",
    ]) {
      expect(lines).not.toContain(title);
    }

    // The team's line says it has no members: no "Members 0" under it.
    expect(lines).toContain("No members");
    expect(lines).not.toContain("Members");

    // Nothing cut short: every part fits in the lines it takes.
    for (const line of lines) {
      expect(line.endsWith("..."), line).toBe(false);
    }
  });
});

/*
 * The text a PDF draws, line by line: every string its content streams
 * show (Tj), in order. jsPDF compresses its streams (Flate) and writes each
 * line the export draws as one string.
 */
function pdfTextLines(pdf: Buffer): Array<string> {
  const raw: string = pdf.toString("latin1");
  const lines: Array<string> = [];
  const STREAM: string = "stream\n";
  const END: string = "\nendstream";
  let from: number = 0;

  for (;;) {
    const start: number = raw.indexOf(STREAM, from);
    if (start === -1) {
      break;
    }
    const end: number = raw.indexOf(END, start);
    if (end === -1) {
      break;
    }
    from = end + END.length;

    let content: string;
    try {
      content = inflateSync(
        Buffer.from(raw.slice(start + STREAM.length, end), "latin1"),
      ).toString("latin1");
    } catch {
      // Not a compressed content stream.
      continue;
    }

    lines.push(...shownStrings(content));
  }

  return lines;
}

// Whether a character is an octal digit, as a PDF string's escapes write them.
function isOctalDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "7";
}

// The strings a content stream shows with Tj, their escapes read.
function shownStrings(content: string): Array<string> {
  const shown: Array<string> = [];
  let at: number = content.indexOf("(");

  while (at !== -1) {
    let text: string = "";
    let index: number = at + 1;
    let depth: number = 1;

    while (index < content.length) {
      const char: string = content[index]!;

      if (char === "\\") {
        let octal: string = "";
        while (
          octal.length < 3 &&
          isOctalDigit(content[index + 1 + octal.length])
        ) {
          octal += content[index + 1 + octal.length]!;
        }
        if (octal) {
          text += String.fromCharCode(parseInt(octal, 8));
          index += 1 + octal.length;
          continue;
        }
        const next: string = content[index + 1] || "";
        text += next === "n" ? "\n" : next === "r" ? "\r" : next;
        index += 2;
        continue;
      }

      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
        if (depth === 0) {
          break;
        }
      }

      text += char;
      index++;
    }

    let after: number = index + 1;
    while (content[after] === " " || content[after] === "\n") {
      after++;
    }
    if (content.startsWith("Tj", after)) {
      shown.push(text);
    }

    at = content.indexOf("(", index + 1);
  }

  return shown;
}

/*
 * "MONITOR EXAMPLE.COM EVERY MINUTE AND TEXT ME IF IT IS DOWN" (issue
 * #6829): one plan on one card, each part a line in plain words with its
 * own Allow and Skip, ending "Nothing else changes."; approved, each part
 * leaves the card of what it made, and the answer offers the test page of
 * the policy it made - or one to yourself, for a monitor alone.
 */

// The decisions of the last approval card the fixture was sent.
function lastDecisions(
  fixtureState: FixtureState,
): Array<{ toolCallId: string; approved: boolean }> | undefined {
  return fixtureState.approvals[fixtureState.approvals.length - 1]?.decisions;
}

test.describe("a setup plan", () => {
  test("waits on one card, each part in plain words - the missing number said - and ends: nothing else changes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=setup");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await expect(
      askAi(page).getByText("The AI wants to perform 2 actions"),
    ).toBeVisible();
    const [monitor, paging] = [
      page.getByTestId("tool-approval-action").nth(0),
      page.getByTestId("tool-approval-action").nth(1),
    ];
    await expect(monitor.getByTestId("tool-approval-title")).toHaveText(
      "Set up monitoring for example.com",
    );
    await expect(monitor.getByTestId("tool-approval-description")).toHaveText(
      "A website monitor checks https://example.com every minute. It is checked from 2 locations. If it does not answer, or answers with an error, OneUptime opens an incident (Critical Incident). You own this monitor, so you are emailed when its status changes.",
    );
    await expect(paging.getByTestId("tool-approval-title")).toHaveText(
      'Create on-call policy "Default on-call policy"',
    );
    await expect(paging.getByTestId("tool-approval-description")).toHaveText(
      "Pages you for every new incident and alert. You have no verified phone number for texts yet. Add one in Notification Methods, and pages reach you by SMS too.",
    );
    // What the card says in words is not said again as arguments.
    await expect(page.getByTestId("tool-approval-arguments")).toHaveCount(0);
    await expect(page.getByTestId("tool-approval-setup-plan-end")).toHaveText(
      "Nothing else changes.",
    );

    await screenshot(page, "setup-plan-1280");
  });

  test("approved, each part leaves its card, and the answer offers the policy's test page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=setup");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await page.getByRole("button", { name: "Run 2 actions" }).click();

    const cards: Locator = page.getByTestId("ai-chat-resource-card");
    await expect(cards).toHaveCount(2);
    await expect(
      cards.nth(0).getByTestId("ai-chat-resource-card-line"),
    ).toHaveText("Checked every minute");
    await expect(
      cards.nth(1).getByTestId("ai-chat-resource-card-line"),
    ).toHaveText("Pages you for every new incident and alert");
    await expect(page.getByTestId("ask-ai-send-test-page")).toHaveText(
      "Test this policy",
    );
    await expect(page.getByTestId("tool-approval-setup-plan-end")).toHaveCount(
      0,
    );

    const fixtureState: FixtureState = await state(page);
    expect(lastDecisions(fixtureState)).toEqual([
      { toolCallId: "call_setup_monitor", approved: true },
      { toolCallId: "call_setup_paging", approved: true },
    ]);
    expect(fixtureState.unhandled).toEqual([]);

    await screenshot(page, "setup-done-1280");
  });

  test("in a busy project: no policy beside its own, the monitor put on its status page, and a test page to yourself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=setup-busy");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const [monitor, statusPage] = [
      page.getByTestId("tool-approval-action").nth(0),
      page.getByTestId("tool-approval-action").nth(1),
    ];
    await expect(monitor.getByTestId("tool-approval-title")).toHaveText(
      "Set up monitoring for example.com",
    );
    await expect(monitor.getByTestId("tool-approval-description")).toHaveText(
      "A website monitor checks https://example.com every 5 minutes. It is checked from 2 locations. If it does not answer, or answers with an error, OneUptime opens an incident (Critical Incident). You own this monitor, so you are emailed when its status changes.",
    );
    await expect(statusPage.getByTestId("tool-approval-title")).toHaveText(
      'Add monitors to status page "Acme status"',
    );
    await expect(
      statusPage.getByTestId("tool-approval-description"),
    ).toHaveText('Adds "example.com" (new).');
    // The project pages people already: its own policies decide, none is proposed.
    await expect(page.getByTestId("tool-approval-action")).toHaveCount(2);
    await expect(askAi(page).getByText("Create on-call policy")).toHaveCount(0);
    // The page and the monitor are named in words, not as arguments.
    await expect(page.getByTestId("tool-approval-arguments")).toHaveCount(0);
    await expect(page.getByTestId("tool-approval-setup-plan-end")).toHaveText(
      "Nothing else changes.",
    );
    await screenshot(page, "setup-busy-plan-1280");

    await page.getByRole("button", { name: "Run 2 actions" }).click();

    const cards: Locator = page.getByTestId("ai-chat-resource-card");
    await expect(cards).toHaveCount(2);
    await expect(
      cards.nth(0).getByTestId("ai-chat-resource-card-line"),
    ).toHaveText("Checked every 5 minutes");
    await expect(
      cards.nth(1).getByTestId("ai-chat-resource-card-line"),
    ).toHaveText('Added "example.com"');
    // No policy was made: the test page goes to the person who set it up.
    await expect(page.getByTestId("ask-ai-send-test-page")).toHaveText(
      "Send me a test page",
    );

    const fixtureState: FixtureState = await state(page);
    expect(lastDecisions(fixtureState)).toEqual([
      { toolCallId: "call_setup_monitor", approved: true },
      { toolCallId: "call_setup_status_page", approved: true },
    ]);
    expect(fixtureState.unhandled).toEqual([]);
    await expectNothingScrollsSideways(page);

    await screenshot(page, "setup-busy-done-1280");
  });

  test("a part skipped is not made, and a monitor alone offers a test page to yourself", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=setup");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    await page
      .getByTestId("tool-approval-action")
      .nth(1)
      .getByRole("button", { name: "Skip" })
      .click();
    await page.getByRole("button", { name: "Run 1 action" }).click();

    await expect(page.getByTestId("ai-chat-resource-card")).toHaveCount(1);
    await expect(page.getByTestId("ask-ai-send-test-page")).toHaveText(
      "Send me a test page",
    );
    expect(lastDecisions(await state(page))).toEqual([
      { toolCallId: "call_setup_monitor", approved: true },
      { toolCallId: "call_setup_paging", approved: false },
    ]);
  });

  test("in German, in the dark, and right to left on a phone in Persian, nothing wider than the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=de&thread=setup");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const german: Record<string, string> = dashboardWords("de");
    await expect(page.getByTestId("tool-approval-setup-plan-end")).toHaveText(
      german["Nothing else changes."]!,
    );
    await screenshot(page, "setup-plan-1280-de");

    await load(page, "theme=dark&thread=setup");
    await expect(askAi(page)).toBeVisible();
    await settle(page);
    await screenshot(page, "setup-plan-1280-dark");

    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, "lang=fa&thread=setup");
    await expect(askAi(page)).toBeVisible();
    await settle(page);

    const persian: Record<string, string> = dashboardWords("fa");
    await expect(page.getByTestId("tool-approval-setup-plan-end")).toHaveText(
      persian["Nothing else changes."]!,
    );
    await expectNothingScrollsSideways(page);
    await screenshot(page, "setup-plan-390-fa");

    await page
      .getByTestId("tool-approval-action")
      .first()
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", {
        name: persian["Run {{count}} actions"]!.replace("{{count}}", "۲"),
      })
      .click();
    await expect(page.getByTestId("ai-chat-resource-card")).toHaveCount(2);
    await expectNothingScrollsSideways(page);
    await screenshot(page, "setup-done-390-fa");
  });
});
