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
 * Ask AI on the main stage, in real Chromium, against the offline fixture
 * (Fixture/Fixture.js): the production dialog (AskAiDialog) and everything
 * in it, over a Dashboard page, with only the data boundary replaced.
 *
 * The maintainer, of Ask AI: "It is very clunky to use currently, and it
 * shows up on the side. Please let it take the main stage: open a modal
 * with a blurred background [...] The ask AI is very noisy as well."
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

function dialog(page: Page): Locator {
  return page.getByTestId("ask-ai-dialog");
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
  await expect(dialog(page)).toBeVisible();
  await settle(page);
}

async function ask(page: Page, question: string): Promise<void> {
  await composer(page).fill(question);
  await composer(page).press("Enter");
  await expect(
    page.getByTestId("ai-chat-question").filter({ hasText: question }),
  ).toBeVisible();
}

// Every finite animation finished: the dialog's entrance, an answer's rise.
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

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();
  expect(box, "a box on screen").not.toBeNull();
  return box as Box;
}

// What the dialog says: its words, lines of text and elements.
async function quietness(page: Page): Promise<Quiet> {
  return page.evaluate((): Quiet => {
    const root: HTMLElement | null = document.querySelector(
      '[data-testid="ask-ai-dialog"]',
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

// Nothing is wider than the screen: no sideways scroll, in the dialog or the page.
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const widths: { page: number; dialog: number; viewport: number } =
    await page.evaluate(
      (): { page: number; dialog: number; viewport: number } => {
        const root: HTMLElement | null = document.querySelector(
          '[data-testid="ask-ai-dialog"]',
        );
        return {
          page: document.documentElement.scrollWidth,
          dialog: root ? root.scrollWidth - root.clientWidth : 0,
          viewport: window.innerWidth,
        };
      },
    );

  expect(widths.page).toBeLessThanOrEqual(widths.viewport);
  expect(widths.dialog).toBeLessThanOrEqual(0);
}

/*
 * ---------------------------------------------------------------------------
 * Every way in
 * ---------------------------------------------------------------------------
 */

test.describe("Ask AI takes the main stage", () => {
  test("the header's Ask AI opens a dialog in the middle of the screen, over the dimmed, blurred page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    const panel: Locator = page.getByRole("dialog", { name: "Ask AI" });
    await expect(panel).toHaveAttribute("aria-modal", "true");

    // In the middle: as wide as the old full page's text, a margin all round.
    const box: Box = await boxOf(panel);
    expect(Math.round(box.width)).toBe(896);
    expect(Math.abs(box.x - (1280 - box.x - box.width))).toBeLessThanOrEqual(1);
    expect(Math.round(box.y)).toBe(24);
    expect(Math.round(box.height)).toBe(800 - 48);

    // Over the page, dimmed and blurred.
    const backdrop: { filter: string; color: string } = await page
      .getByTestId("ask-ai-backdrop")
      .evaluate((element: Element): { filter: string; color: string } => {
        const style: CSSStyleDeclaration = window.getComputedStyle(element);
        return {
          filter: style.backdropFilter,
          color: style.backgroundColor,
        };
      });
    expect(backdrop.filter).toBe("blur(12px)");
    expect(backdrop.color).toBe("rgba(3, 7, 18, 0.4)");

    // The question is the first thing it asks for.
    await expect(composer(page)).toBeFocused();

    await screenshot(page, "start-incident-1280");
  });

  test("the page behind is inert and still while it is open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    const behind: { inert: boolean; overflow: string } = await page.evaluate(
      (): { inert: boolean; overflow: string } => {
        return {
          inert: document.getElementById("root")!.hasAttribute("inert"),
          overflow: document.body.style.overflow,
        };
      },
    );
    expect(behind).toEqual({ inert: true, overflow: "hidden" });

    // Nothing behind it takes the focus.
    for (let index: number = 0; index < 12; index++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate((): boolean => {
          return Boolean(
            document.activeElement?.closest('[data-testid="ask-ai-dialog"]'),
          );
        }),
      ).toBe(true);
    }

    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();

    expect(
      await page.evaluate((): { inert: boolean; overflow: string } => {
        return {
          inert: document.getElementById("root")!.hasAttribute("inert"),
          overflow: document.body.style.overflow,
        };
      }),
    ).toEqual({ inert: false, overflow: "" });
  });

  test("Ctrl + I and Cmd + I open it, Esc closes it, and the focus goes back to what had it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    const search: Locator = page.getByTestId("fixture-page-button");
    await search.focus();

    await page.keyboard.press("Control+i");
    await expect(dialog(page)).toBeVisible();
    await expect(composer(page)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(search).toBeFocused();

    await page.keyboard.press("Meta+i");
    await expect(dialog(page)).toBeVisible();
    // In its own composer, which has no italics, the keys close it again.
    await page.keyboard.press("Control+i");
    await expect(dialog(page)).toBeHidden();
  });

  test("a click beside it closes it; a drag that ends beside it does not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    // Selecting what was typed, and letting go beside the dialog.
    await composer(page).fill("Why is checkout slow?");
    const box: Box = await boxOf(composer(page));
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(8, 400, { steps: 4 });
    await page.mouse.up();
    await expect(dialog(page)).toBeVisible();

    await page.mouse.click(8, 400);
    await expect(dialog(page)).toBeHidden();
  });

  test("Explain with AI opens a new conversation with its question in the composer, unsent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "page=logs");

    await page.getByTestId("fixture-explain-with-ai").click();

    await expect(dialog(page)).toBeVisible();
    await expect(composer(page)).toHaveValue(EXPLAIN_PROMPT);
    await expect(page.getByTestId("ai-chat-context")).toHaveText("Logs");
    expect((await state(page)).sent).toEqual([]);
  });

  test("the chat's own address opens the dialog over the page the person came from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "history=some");
    const ids: ConversationIds = await conversationIds(page);

    // A link to one conversation, followed inside the app.
    await navigateInApp(page, `${DASHBOARD}/ai/chat/${ids.answered}`);

    await expect(dialog(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${INCIDENT_PATH}\\?`));
    await expect(
      page
        .getByTestId("ai-chat-question")
        .filter({ hasText: LATENCY_QUESTION }),
    ).toBeVisible();
    // The page under it is the incident, and the next question is about it.
    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
  });

  test("opened at its own address, the dialog opens over Home", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "history=some");
    const ids: ConversationIds = await conversationIds(page);

    await load(page, "history=some", `${DASHBOARD}/ai/chat/${ids.answered}`);

    await expect(dialog(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${HOME_PATH}`));
    await expect(
      page
        .getByTestId("ai-chat-question")
        .filter({ hasText: LATENCY_QUESTION }),
    ).toBeVisible();

    // Closing it leaves the person on a page, never on an empty one.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
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

    await expect(dialog(page).getByRole("heading", { level: 3 })).toHaveText(
      "What would you like to know?",
    );
    await expect(page.getByTestId("ai-chat-context")).toHaveText(INCIDENT_CHIP);
    // What the pill says is not said again under the question.
    await expect(dialog(page).getByText(HOME_SENTENCE)).toHaveCount(0);

    const chips: Locator = page.getByTestId("ai-chat-suggestion");
    await expect(chips).toHaveText(INCIDENT_SUGGESTIONS);
    await expect(chips.first()).toHaveAttribute(
      "title",
      "Summarize this incident: what happened, its current state, and the impact.",
    );

    // The question, then the box under it, then the suggestions.
    const heading: Box = await boxOf(
      dialog(page).getByRole("heading", { level: 3 }),
    );
    const box: Box = await boxOf(page.getByTestId("ai-chat-composer"));
    const suggestions: Box = await boxOf(
      page.getByTestId("ai-chat-suggestions"),
    );
    expect(heading.y).toBeLessThan(box.y);
    expect(box.y + box.height).toBeLessThanOrEqual(suggestions.y);

    // Quiet: the start is a handful of words, not eight cards and two paragraphs.
    const quiet: Quiet = await quietness(page);
    expect(quiet.words).toBeLessThanOrEqual(30);
    expect(quiet.elements).toBeLessThanOrEqual(110);
  });

  test("the start sits in the middle of the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page);
    await openAskAi(page);

    const panel: Box = await boxOf(dialog(page));
    const start: Box = await boxOf(page.getByTestId("ai-chat-home"));
    // Under the 56px header, the start's middle is the space's middle.
    const spaceMiddle: number = panel.y + 56 + (panel.height - 56) / 2;
    expect(
      Math.abs(start.y + start.height / 2 - spaceMiddle),
    ).toBeLessThanOrEqual(2);
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
    await expect(dialog(page).getByText(HOME_SENTENCE)).toBeVisible();
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
    await expect(dialog(page).getByText(HOME_SENTENCE)).toBeVisible();
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
    await expect(dialog(page)).toBeVisible();
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

  test("a citation opens what it cites: the dialog steps aside, and the conversation waits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(dialog(page)).toBeVisible();

    await page
      .getByTestId("ai-chat-answer-text")
      .locator('[data-citation-id="C3"]')
      .first()
      .click();

    await expect(dialog(page)).toBeHidden();
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

  test("Stop stops an answer being written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);
    await ask(page, LATENCY_QUESTION);

    await page.getByRole("button", { name: "Stop generating" }).click();

    await expect(dialog(page).getByText("Stopped by user.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send (Enter)" }),
    ).toBeVisible();
    expect((await state(page)).cancelled).toBe(1);
  });

  test("an approval is decided inside the dialog, and leaves a card that says each fact once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=approval");
    await expect(dialog(page)).toBeVisible();

    await expect(
      dialog(page).getByText("The AI wants to perform 1 action"),
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
    await expect(dialog(page)).toBeVisible();

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
    await expect(dialog(page)).toBeVisible();
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
      await expect(dialog(page)).toBeVisible();
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
    await expect(dialog(page)).toBeVisible();
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

  for (const viewport of [
    { width: 1280, rows: 1 },
    { width: 390, rows: 2 },
  ]) {
    test(`four figures fill their rows: ${viewport.rows === 1 ? "one row on a laptop" : "two by two on a phone"} (${viewport.width})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: viewport.width, height: 844 });
      await load(page, "thread=rich");
      await expect(dialog(page)).toBeVisible();
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
    await expect(dialog(page)).toBeVisible();
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
  test("the start shows the last three; All conversations lists them all, inside the dialog", async ({
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
      page.getByRole("dialog", { name: "All conversations" }),
    ).toBeVisible();
    const rows: Locator = page
      .getByTestId("ai-chat-history")
      .getByRole("listitem");
    await expect(rows).toHaveCount(25);
    // The list scrolls inside the dialog; the page under it does not.
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

    // Esc keeps it, and leaves the dialog open.
    await page.keyboard.press("Escape");
    await expect(asking).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
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
      page.getByRole("dialog", { name: "Why did checkout latency spike?" }),
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
      page.getByRole("dialog", { name: "All conversations" }),
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
    await expect(dialog(page)).toBeHidden();

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
    await expect(dialog(page)).toBeVisible();
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
  test("Tab and Shift + Tab go round inside the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(dialog(page)).toBeVisible();
    await settle(page);

    for (const key of ["Tab", "Shift+Tab"]) {
      for (let index: number = 0; index < 40; index++) {
        await page.keyboard.press(key);
        expect({
          key,
          index,
          inside: await page.evaluate((): boolean => {
            return Boolean(
              document.activeElement?.closest('[data-testid="ask-ai-dialog"]'),
            );
          }),
        }).toEqual({ key, index, inside: true });
      }
    }
  });

  test("Esc in a menu closes the menu only", async ({
    page,
  }: {
    page: Page;
  }) => {
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
    /*
     * On a laptop window 800 px tall the start's composer sits in the
     * middle of the dialog, too low for the menu to open down without the
     * dialog's foot cutting its last choice in half: it opens up, whole.
     */
    const menu: Box = await boxOf(
      page.getByRole("menu", { name: "AI permissions" }),
    );
    const button: Box = await boxOf(mode);
    const panel: Box = await boxOf(dialog(page));
    expect(menu.y + menu.height).toBeLessThanOrEqual(button.y);
    expect(menu.y).toBeGreaterThanOrEqual(panel.y);
    await screenshot(page, "start-menu-up-1280");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
    await expect(mode).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });

  test("with room under the start's composer, its menu opens down, as asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The recent conversations under it lift the start's composer.
    await load(page, "history=some");
    await openAskAi(page);
    const mode: Locator = page.getByTitle(
      "Choose what the AI is allowed to do",
    );

    await mode.click();
    const opened: Locator = page.getByRole("menu", { name: "AI permissions" });
    await expect(opened).toBeVisible();
    await settle(page);

    const menu: Box = await boxOf(opened);
    const button: Box = await boxOf(mode);
    const panel: Box = await boxOf(dialog(page));
    expect(menu.y).toBeGreaterThanOrEqual(button.y + button.height);
    expect(menu.y + menu.height).toBeLessThanOrEqual(panel.y + panel.height);
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
    await expect(dialog(page)).toBeVisible();
  });

  test("with AI switched off it says so, and offers nothing to type into", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "ai=off");
    await openAskAi(page);

    await expect(page.getByTestId("ask-ai-dialog")).toHaveAttribute(
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

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("the dialog keeps a margin of the page round it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(dialog(page)).toBeVisible();
    await settle(page);

    const box: Box = await boxOf(dialog(page));
    expect(Math.round(box.x)).toBe(24);
    expect(Math.round(box.width)).toBe(768 - 48);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "answer-768");
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

    const box: Box = await boxOf(dialog(page));
    expect(box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(
      await dialog(page).evaluate((element: Element): string => {
        return window.getComputedStyle(element).borderTopLeftRadius;
      }),
    ).toBe("0px");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "start-incident-390");
  });

  test("in a conversation the composer stays at the foot, and the answer's actions are always shown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "thread=answered");
    await expect(dialog(page)).toBeVisible();
    await settle(page);

    const box: Box = await boxOf(page.getByTestId("ai-chat-composer"));
    expect(844 - (box.y + box.height)).toBeLessThanOrEqual(16);
    // A phone has no pointer to point with: the newest answer's actions show.
    await expect(page.getByTestId("ai-chat-copy-answer")).toBeVisible();
    await expectNoSidewaysScroll(page);
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
  test("the dialog, its start, its answer and its card are drawn dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "theme=dark");
    await openAskAi(page);

    expect(await luminanceOf(dialog(page), "background-color")).toBeLessThan(
      0.05,
    );
    expect(
      await luminanceOf(
        dialog(page).getByRole("heading", { level: 3 }),
        "color",
      ),
    ).toBeGreaterThan(0.6);
    expect(
      await luminanceOf(
        page.getByTestId("ai-chat-context"),
        "background-color",
      ),
    ).toBeLessThan(0.1);
    // A deeper veil: a dark one over a dark page still sets the dialog apart.
    expect(
      await page
        .getByTestId("ask-ai-backdrop")
        .evaluate((element: Element): string => {
          return window.getComputedStyle(element).backgroundColor;
        }),
    ).toBe("rgba(2, 6, 23, 0.62)");
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
    await expect(dialog(page)).toBeVisible();
    expect(
      await luminanceOf(page.getByTestId("ai-chat-answer-text"), "color"),
    ).toBeGreaterThan(0.5);
    await screenshot(page, "answer-1280-dark");

    await load(page, "theme=dark&thread=approval");
    await expect(dialog(page)).toBeVisible();
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

test.describe("in German", () => {
  test("the start, the live line and the answer's row speak German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=de&run=hold");
    await openAskAi(page);

    await expect(page.getByRole("dialog", { name: "KI fragen" })).toBeVisible();
    await expect(dialog(page).getByRole("heading", { level: 3 })).toHaveText(
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

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("its longer words still fit", async ({ page }: { page: Page }) => {
      await load(page, "lang=de&thread=answered");
      await expect(dialog(page)).toBeVisible();
      await settle(page);

      await expectNoSidewaysScroll(page);
      await screenshot(page, "answer-390-de");

      await load(page, "lang=de");
      await openAskAi(page);
      await expectNoSidewaysScroll(page);
      await screenshot(page, "start-incident-390-de");
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
    await expect(dialog(page)).toBeVisible();
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

  test("an approval's English lines keep their punctuation at their end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "lang=fa&thread=approval");
    await expect(dialog(page)).toBeVisible();
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
      await expect(dialog(page)).toBeVisible();
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
      await expect(dialog(page)).toBeVisible();
      await settle(page);

      await expectNoSidewaysScroll(page);
      await screenshot(page, "answer-390-fa");
    });
  });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the dialog appears without moving, and nothing pulses", async ({
    page,
  }: {
    page: Page;
  }) => {
    await load(page, "run=hold");
    await openAskAi(page);

    const motion: { dialog: string; backdrop: string } = await page.evaluate(
      (): { dialog: string; backdrop: string } => {
        return {
          dialog: window.getComputedStyle(
            document.querySelector('[data-testid="ask-ai-dialog"]')!,
          ).transitionProperty,
          backdrop: window.getComputedStyle(
            document.querySelector('[data-testid="ask-ai-backdrop"]')!,
          ).transitionProperty,
        };
      },
    );
    expect(motion).toEqual({ dialog: "none", backdrop: "none" });

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
