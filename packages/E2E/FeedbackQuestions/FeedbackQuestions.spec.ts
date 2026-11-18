import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { dashboardWord } from "../SuiteHelpers/LocaleChunks";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * ASKING PEOPLE, IN A REAL BROWSER (#6832, #7362), with production's CSS:
 *
 *   - "How easy was that?" under a finished guided setup, and "Stuck?"
 *     under its steps (GuidedSetupFrame, through SetupFeedback): where the
 *     answer goes is said before it is given; once words are sent, the card
 *     says where they went, then offers the public GitHub issue - never
 *     "nothing leaves this server" under it (#7462);
 *   - the first-week check-in on Home, which says who its one click tells;
 *   - "Was this clear?" under How OneUptime works;
 *   - Give feedback from the phone's menu;
 *   - Admin Dashboard > Feedback: how long answers are kept and a row's
 *     Delete (#7366), whose question stays open as the window turns from
 *     rows to cards and back (#9513), Ask AI's answers rated down by what
 *     they read (#7365) and, on a self-hosted server, the docs pages (#7209).
 *
 * Each at 1280 pixels and on a phone (390), light and dark, German and
 * Persian, and nothing may scroll sideways or leave the fixture server. The
 * screenshots are written to output/playwright/feedback-questions-ui.
 */

const PORT: string = process.env["FEEDBACK_QUESTIONS_FIXTURE_PORT"] || "4799";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000007362";
const SETUP: string = `/dashboard/${PROJECT_ID}/setup`;
const ADMIN: string = "/admin/feedback";
const PHONE: { width: number; height: number } = { width: 390, height: 844 };
const GITHUB_NEW_ISSUE: string =
  "https://github.com/OneUptime/oneuptime/issues/new";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/feedback-questions-ui",
);

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/AdminDashboard/src/Locales",
);

// A word as the Admin Dashboard's locale words it.
function adminWord(language: string, english: string): string {
  if (language === "en") {
    return english;
  }

  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(ADMIN_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
  const word: unknown = locale[english];

  return typeof word === "string" ? word : english;
}

interface QuestionsFixture {
  asks: Array<string>;
  posts: Array<{ path: string; data: Record<string, unknown> }>;
  unhandled: Array<string>;
}

interface AdminFixture {
  reads: Array<string>;
  deletes: Array<string>;
  unmodeled: Array<unknown>;
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

  const isAdmin: boolean = new URL(page.url()).pathname.startsWith("/admin");

  if (isAdmin) {
    expect((await adminState(page)).unmodeled, "reads not modelled").toEqual(
      [],
    );
  } else {
    expect(
      (await questionsState(page)).unhandled,
      "reads not modelled",
    ).toEqual([]);
  }
});

async function questionsState(page: Page): Promise<QuestionsFixture> {
  return await page.evaluate((): QuestionsFixture => {
    return (
      window as unknown as { __feedbackQuestionsFixture: QuestionsFixture }
    ).__feedbackQuestionsFixture;
  });
}

async function adminState(page: Page): Promise<AdminFixture> {
  return await page.evaluate((): AdminFixture => {
    return (window as unknown as { __adminFeedbackFixture: AdminFixture })
      .__adminFeedbackFixture;
  });
}

/*
 * The whole page, or only the window: a dialog is drawn over the window. A
 * whole page's screenshot lays the table out again, which closed a row's
 * question until the table kept it (#9513).
 */
async function screenshot(
  page: Page,
  name: string,
  isWholePage: boolean = true,
): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: isWholePage,
    animations: "disabled",
  });
}

async function openQuestions(page: Page, query: string): Promise<void> {
  await page.goto(`${SETUP}?${query}`);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

function easeQuestion(page: Page): Locator {
  return page.getByTestId("ease-question");
}

// Answers "How easy was that?" with a score, then writes and sends words.
async function answerWithWords(
  page: Page,
  score: number,
  words: string,
): Promise<void> {
  await page.getByTestId(`ease-question-score-${score}`).click();
  await page.getByTestId("ease-question-details").fill(words);
  await page.getByTestId("ease-question-send").click();
  await expect(page.getByTestId("ease-question-thanks")).toBeVisible();
}

test.describe("How easy was that?, under a finished guided setup", () => {
  test("self-hosted: asked once, says where it goes before it is given, and the scores run 1 to 5", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openQuestions(page, "view=setup");

    await expect(easeQuestion(page)).toContainText("How easy was that?");
    await expect(page.getByTestId("feedback-where-it-goes")).toHaveText(
      "Goes to this server's admins, with the page you are on and the OneUptime version. Nothing else is sent, and nothing leaves this server.",
    );
    expect((await questionsState(page)).asks).toEqual([
      "setup_flow:website_down",
    ]);

    const scores: Array<FrameBox> = await boxesInOneFrame(
      [1, 2, 3, 4, 5].map((score: number): Locator => {
        return page.getByTestId(`ease-question-score-${score}`);
      }),
    );

    for (let index: number = 1; index < scores.length; index++) {
      expect(scores[index]!.x).toBeGreaterThan(scores[index - 1]!.x);
    }
    await screenshot(page, "ease-question");
  });

  test("self-hosted: once words are sent, says where they went, then the public GitHub issue - never that nothing leaves the server under it (#7462)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openQuestions(page, "view=setup");
    await answerWithWords(page, 2, "The test email landed in spam.");

    await expect(easeQuestion(page)).toContainText("Thanks for your answer.");
    await expect(page.getByTestId("feedback-sent-line")).toHaveText(
      "This server's admins can read it in the Admin Dashboard, under Feedback.",
    );

    const github: Locator = page.getByTestId("ease-question-github");

    await expect(github).toHaveText(
      "Also tell OneUptime in a public GitHub issue",
    );
    await expect(page.getByTestId("feedback-github-hint")).toHaveText(
      "It opens with your words filled in, and nothing is posted until you post it.",
    );
    expect(
      (await github.getAttribute("href"))?.startsWith(`${GITHUB_NEW_ISSUE}?`),
    ).toBe(true);
    await expect(page.getByTestId("feedback-where-it-goes")).toHaveCount(0);
    await expect(easeQuestion(page)).not.toContainText(
      "nothing leaves this server",
    );

    // Where it went, above the link to a public issue.
    const [sentLine, link]: Array<FrameBox> = await boxesInOneFrame([
      page.getByTestId("feedback-sent-line"),
      github,
    ]);

    expect(link!.y).toBeGreaterThan(sentLine!.y + sentLine!.height - 1);

    // What went: the score, then the words, with the route and the version.
    const posts: QuestionsFixture["posts"] = (await questionsState(page)).posts;

    expect(
      posts.map((post: { path: string }) => {
        return post.path;
      }),
    ).toEqual(["/api/product-feedback", "/api/product-feedback/details"]);
    expect(posts[0]!.data).toMatchObject({
      kind: "setup_flow",
      topic: "website_down",
      score: 2,
      version: "16.0.0",
    });
    await screenshot(page, "ease-question-sent");
  });

  test("on OneUptime Cloud: thanked as the OneUptime team, sent to them, and no GitHub link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openQuestions(page, "view=setup&cloud=1");

    await expect(page.getByTestId("feedback-where-it-goes")).toHaveText(
      "Goes to the OneUptime team, with the page you are on and the OneUptime version. Nothing else is sent.",
    );
    await answerWithWords(page, 4, "Smooth, but I wanted SMS too.");

    await expect(easeQuestion(page)).toContainText("Thanks for telling us.");
    await expect(page.getByTestId("feedback-sent-line")).toHaveText(
      "Sent to the OneUptime team.",
    );
    await expect(page.getByTestId("ease-question-github")).toHaveCount(0);
    await screenshot(page, "ease-question-sent-cloud");
  });

  test("on a phone in the dark, the question, its scores and the thanks fit, with nothing scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openQuestions(page, "view=setup&theme=dark");

    await expect(easeQuestion(page)).toBeVisible();
    await expectNoSidewaysScroll(page);

    const card: string = await easeQuestion(page).evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );

    // Not the light theme's white.
    expect(card).not.toBe("rgb(255, 255, 255)");
    await screenshot(page, "ease-question-phone-dark");

    await answerWithWords(page, 1, "I could not find where to add a phone.");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ease-question-sent-phone-dark");
  });

  test("in German, it reads German, and on a phone nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openQuestions(page, "view=setup&lang=de");

    await expect(easeQuestion(page)).toContainText(
      dashboardWord("de", "How easy was that?"),
    );
    await expect(page.getByTestId("feedback-where-it-goes")).toHaveText(
      dashboardWord(
        "de",
        "Goes to this server's admins, with the page you are on and the OneUptime version. Nothing else is sent, and nothing leaves this server.",
      ),
    );
    await expectNoSidewaysScroll(page);
    await answerWithWords(page, 3, "Die Testmail kam nicht an.");
    await expect(page.getByTestId("ease-question-github")).toHaveText(
      dashboardWord("de", "Also tell OneUptime in a public GitHub issue"),
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "ease-question-sent-de");
  });

  test("in Persian, it reads right to left: 1 on the right, 5 on the left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openQuestions(page, "view=setup&lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(easeQuestion(page)).toContainText(
      dashboardWord("fa", "How easy was that?"),
    );

    const [one, five]: Array<FrameBox> = await boxesInOneFrame([
      page.getByTestId("ease-question-score-1"),
      page.getByTestId("ease-question-score-5"),
    ]);

    expect(one!.x).toBeGreaterThan(five!.x);
    await expect(page.getByTestId("ease-question-score-1")).toHaveText("۱");
    await screenshot(page, "ease-question-fa");
  });
});

test.describe("Stuck?, under a guided setup's steps", () => {
  test("offered under the steps; it opens the same question, about how it is going so far", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openQuestions(page, "view=stuck");

    const stuck: Locator = page.getByTestId("guided-setup-stuck");

    await expect(stuck).toHaveText("Stuck? Tell us what got in the way");
    // The person opens it: OneUptime asked nothing.
    expect((await questionsState(page)).asks).toEqual([]);
    await screenshot(page, "stuck");

    await stuck.click();
    await expect(easeQuestion(page)).toContainText("How easy is this so far?");
    // The person opened it: no "Don't ask me again".
    await expect(page.getByTestId("ease-question-stop-asking")).toHaveCount(0);
    await screenshot(page, "stuck-opened");
  });
});

test.describe("the first-week check-in on Home", () => {
  test("self-hosted: says, before the one click, that it tells this server's admins; Not yet offers the guided setups and a box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openQuestions(page, "view=checkin");

    const card: Locator = page.getByTestId("setup-check-in");

    await expect(card).toContainText("Is OneUptime set up the way you wanted?");
    await expect(card).toContainText(
      "Your project is a week old. One click tells this server's admins how it went.",
    );
    expect((await questionsState(page)).asks).toEqual([
      `check_in:${PROJECT_ID}`,
    ]);
    await screenshot(page, "check-in");

    await page.getByTestId("setup-check-in-not-yet").click();
    await expect(page.getByTestId("setup-check-in-setups")).toBeVisible();
    await expect(page.getByTestId("feedback-where-it-goes")).toBeVisible();
    await screenshot(page, "check-in-not-yet");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "check-in-not-yet-phone");
  });

  test('Yes is thanked without "us" on a self-hosted server', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openQuestions(page, "view=checkin");
    await page.getByTestId("setup-check-in-yes").click();

    await expect(page.getByTestId("setup-check-in")).toContainText(
      "Thanks for your answer.",
    );
    expect((await questionsState(page)).posts[0]!.data).toMatchObject({
      kind: "check_in",
      isPositive: true,
    });
  });

  test("in Persian, the card reads right to left and nothing scrolls sideways on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openQuestions(page, "view=checkin&lang=fa&theme=dark");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("setup-check-in")).toContainText(
      dashboardWord(
        "fa",
        "Your project is a week old. One click tells this server's admins how it went.",
      ),
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "check-in-fa-phone-dark");
  });
});

test.describe("Was this clear?, under How OneUptime works", () => {
  test('a thumb answers it, with no words, and it thanks without "us" on a self-hosted server', async ({
    page,
  }: {
    page: Page;
  }) => {
    await openQuestions(page, "view=clear");

    await expect(page.getByTestId("was-this-clear")).toContainText(
      "Was this clear?",
    );
    await screenshot(page, "was-this-clear");

    await page.getByTestId("was-this-clear-no").click();
    await expect(page.getByTestId("was-this-clear-thanks")).toHaveText(
      "Thanks for your answer.",
    );
    expect((await questionsState(page)).posts[0]!.data).toMatchObject({
      kind: "explanation",
      topic: "how_oneuptime_works",
      isPositive: false,
      details: null,
    });
    await screenshot(page, "was-this-clear-answered");
  });
});

test.describe("Give feedback, from the phone's menu", () => {
  test("Help folds open, Give feedback opens the dialog over the closed menu, and it fits a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openQuestions(page, "view=phone");

    const help: Locator = page.getByTestId("navbar-mobile-help");

    await help.getByRole("button").first().click();
    await help.getByText("Give feedback", { exact: true }).click();

    await expect(page.getByTestId("give-feedback-dialog")).toBeVisible();
    await expect(page.getByTestId("fixture-phone-menu")).toHaveCount(0);
    await expect(page.getByTestId("modal-description")).toHaveText(
      "Tell this server's admins what's broken, confusing or missing.",
    );
    // The page by its name, as its breadcrumbs name it, never its route (#7462).
    await expect(page.getByTestId("give-feedback-attached")).toHaveText(
      "Kept for this server's admins with this page (Home) and the version (16.0.0), without your name. Nothing leaves this server.",
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "give-feedback-phone-menu");
  });
});

test.describe("Admin Dashboard > Feedback", () => {
  // The list's rows: a table's rows at 1280, cards on a phone.
  function listRows(page: Page): Locator {
    return page.locator("#admin-feedback-list-body > *");
  }

  async function openAdmin(page: Page, query: string = ""): Promise<void> {
    await page.goto(`${ADMIN}${query ? `?${query}` : ""}`);
    await expect(listRows(page).first()).toBeVisible({ timeout: 60000 });
    // Every card is drawn: the page has stopped moving.
    await expect(
      page.getByTestId("admin-feedback-ask-ai-source").first(),
    ).toBeVisible();
  }

  test("self-hosted: how long answers are kept, the docs pages that failed people first, and what Ask AI's answers rated down read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAdmin(page);

    await expect(
      page.getByText(
        "Every answer, newest first. Answers are kept 365 days, then deleted. Each carries the page, as a route with no ids, and the OneUptime version, and names no person or project.",
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId("admin-feedback-docs-switch-card"),
    ).toBeVisible();

    const pages: Locator = page.getByTestId("admin-feedback-docs-page");

    await expect(pages).toHaveText([
      "monitor/website-monitor",
      "on-call/escalation-rules",
      "status-pages/subscribers",
    ]);
    await expect(page.getByTestId("admin-feedback-ask-ai-source")).toHaveText([
      /^Logs\s*4$/,
      /^Incidents\s*3$/,
      /^OneUptime docs\s*2$/,
      /^No data read\s*1$/,
    ]);
    // A self-hosted server's admins already hold its questions.
    await expect(
      page.getByTestId("admin-feedback-ask-ai-rated-down"),
    ).toBeVisible();
    // A docs answer in the list says what went wrong.
    await expect(listRows(page).nth(2)).toContainText(
      "Not helpful: Hard to follow",
    );
    await screenshot(page, "admin-feedback");
  });

  test("a row's Delete asks first, naming the answer and quoting its words, then the answer is gone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAdmin(page);
    await expect(listRows(page)).toHaveCount(4);

    await listRows(page)
      .first()
      .getByTestId("row-actions")
      .getByRole("button", { name: "Delete" })
      .click();

    const dialog: Locator = page.getByTestId("row-actions-dialog");

    await expect(dialog.getByTestId("modal")).toBeVisible();
    await expect(dialog).toContainText("Delete Answer");
    await expect(dialog).toContainText(
      "Are you sure you want to delete Something's broken",
    );
    await expect(page.getByTestId("admin-feedback-delete-words")).toContainText(
      "Add SLO does nothing after I pick a monitor and press Save.",
    );
    await screenshot(page, "admin-feedback-delete", false);

    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(listRows(page)).toHaveCount(3);
    expect((await adminState(page)).deletes).toEqual([
      "73620000-0000-4000-8000-000000000001",
    ]);
  });

  /*
   * A table draws its rows again as it changes how it fits - rows on a
   * wide screen, cards on a phone - and a row's question went with them,
   * unanswered (#9513): turn a phone sideways, or resize a window across
   * 768 pixels, and it was gone. A whole page's screenshot did the same.
   */
  test("a row's question stays open as the window turns to a phone and back, and through a whole page's screenshot, then deletes the answer it named", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAdmin(page);
    await expect(listRows(page)).toHaveCount(4);

    await listRows(page)
      .nth(1)
      .getByTestId("row-actions")
      .getByRole("button", { name: "Delete" })
      .click();

    const dialog: Locator = page.getByTestId("row-actions-dialog");
    const listBody: Locator = page.locator("#admin-feedback-list-body");

    // Still the one question, quoting the second answer's words.
    async function expectTheQuestion(): Promise<void> {
      await expect(dialog.getByTestId("modal")).toHaveCount(1);
      await expect(dialog.getByTestId("modal")).toBeVisible();
      await expect(page.getByTestId("admin-feedback-delete-words")).toHaveText(
        "The test email went to spam.",
      );
    }

    await expectTheQuestion();
    await expect(listBody).toHaveJSProperty("tagName", "TBODY");

    // A phone: the rows are cards now.
    await page.setViewportSize(PHONE);
    await expect(listBody).toHaveJSProperty("tagName", "DIV");
    await expectTheQuestion();

    // And back to rows.
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(listBody).toHaveJSProperty("tagName", "TBODY");
    await expectTheQuestion();

    await screenshot(page, "admin-feedback-delete-turned");
    await expectTheQuestion();

    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(listRows(page)).toHaveCount(3);
    expect((await adminState(page)).deletes).toEqual([
      "73620000-0000-4000-8000-000000000002",
    ]);
  });

  test("on OneUptime Cloud: no docs switch or pages, and no Ask AI question - only what the answers read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAdmin(page, "cloud=1");

    await expect(
      page.getByTestId("admin-feedback-docs-switch-card"),
    ).toHaveCount(0);
    await expect(page.getByTestId("admin-feedback-docs-page")).toHaveCount(0);
    await expect(
      page.getByTestId("admin-feedback-ask-ai-rated-down"),
    ).toHaveCount(0);
    await expect(page.getByTestId("admin-feedback-ask-ai-source")).toHaveCount(
      4,
    );
    await screenshot(page, "admin-feedback-cloud");
  });

  test("on a phone in the dark, nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openAdmin(page, "theme=dark");

    await expectNoSidewaysScroll(page);
    await screenshot(page, "admin-feedback-phone-dark");
  });

  test("in German and in Persian, the new cards read in the language; Persian right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAdmin(page, "lang=de");

    await expect(
      page.getByText(adminWord("de", "Docs Pages"), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(adminWord("de", "What the answers rated down read")),
    ).toBeVisible();
    await screenshot(page, "admin-feedback-de");

    await page.setViewportSize(PHONE);
    await openAdmin(page, "lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByText(adminWord("fa", "Docs Pages"), { exact: true }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "admin-feedback-fa-phone");
  });
});
