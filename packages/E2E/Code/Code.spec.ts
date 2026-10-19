import {
  ConsoleMessage,
  expect,
  Locator,
  Page,
  test,
  TestInfo,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Code in a browser, against the offline fixture (Code/Fixture): the
 * repositories first, a repository's page where AI is asked with context,
 * a task's conversation filling in as the AI works, replying in it,
 * stopping it and trying again, whatever stops AI working said with the
 * link that fixes it, read-only members, the old Tasks and Code
 * Repositories addresses, a phone, dark mode and German.
 *
 * The maintainer's ask: "overhaul the entire 'Tasks' product and call it
 * 'Code' ... it should show Code repos first and tasks in them ... it should
 * basically function like claude code / codex so people can ask AI to do
 * things for them here. People should be able to add more context, chat
 * with tasks". The fixture records every request, reply, retry and stop the
 * pages send, so the tests check what was sent as well as what was drawn.
 *
 * Every test runs in both projects: "desktop" (1280 px) and "phone"
 * (390 px).
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000c1";
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const CODE: string = `${DASHBOARD}/code`;

const REPOSITORY: Record<"checkout" | "web" | "payments", string> = {
  checkout: "20000000-0000-4000-8000-0000000000b1",
  web: "20000000-0000-4000-8000-0000000000b2",
  payments: "20000000-0000-4000-8000-0000000000b3",
};

const TASK: Record<
  "retries" | "question" | "exception" | "failed" | "stopped" | "working",
  string
> = {
  retries: "40000000-0000-4000-8000-0000000000d1",
  question: "40000000-0000-4000-8000-0000000000d2",
  exception: "40000000-0000-4000-8000-0000000000d3",
  failed: "40000000-0000-4000-8000-0000000000d4",
  stopped: "40000000-0000-4000-8000-0000000000d5",
  working: "40000000-0000-4000-8000-0000000000d6",
};

const INCIDENT_ID: string = "50000000-0000-4000-8000-0000000000e1";

// The numbers in a computed colour, "rgb(17, 24, 39)".
const COLOUR_CHANNELS: RegExp = /\d+/g;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/code-ui",
);

interface Recorded {
  creates: Array<{
    repositoryId: string;
    message: string;
    context: Array<Record<string, unknown>>;
  }>;
  replies: Array<{
    taskId: string;
    message: string;
    context: Array<Record<string, unknown>>;
  }>;
  retries: Array<string>;
  stops: Array<string>;
  settings: Array<Record<string, unknown>>;
  deletes: Array<string>;
  navigations: Array<string>;
  reads: { task: number; list: number; repositories: number };
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: ConsoleMessage) => {
    // The fixture says a mistake of its own loudly; so does React.
    if (
      message.type() === "error" &&
      (message.text().includes("Code fixture failed") ||
        message.text().includes("validateDOMNesting") ||
        message.text().includes('unique "key"'))
    ) {
      errors.push(message.text());
    }
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

function isPhone(testInfo: TestInfo): boolean {
  return testInfo.project.name === "phone";
}

async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-${testInfo.project.name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __fixture: Recorded }).__fixture;
  });
}

function repositoryPath(id: string): string {
  return `${CODE}/repositories/${id}`;
}

function taskPath(id: string): string {
  return `${CODE}/tasks/${id}`;
}

async function openCode(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${CODE}${search ? `?${search}` : ""}`);
}

async function openRepository(
  page: Page,
  id: string,
  search: string = "",
): Promise<void> {
  await page.goto(`${repositoryPath(id)}${search ? `?${search}` : ""}`);
  await expect(page.getByTestId("code-ask")).toBeVisible();
}

async function openTask(
  page: Page,
  id: string,
  search: string = "",
): Promise<void> {
  await page.goto(`${taskPath(id)}${search ? `?${search}` : ""}`);
  await expect(page.getByTestId("code-task-turns")).toBeVisible();
}

function composerInput(page: Page): Locator {
  return page.getByTestId("code-composer-input");
}

function sendButton(page: Page): Locator {
  return page.getByTestId("code-composer-send");
}

function turnReplies(page: Page): Locator {
  return page.getByTestId("code-turn-reply");
}

// The page is never wider than the screen: nothing scrolls sideways.
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

async function addContext(page: Page, kind: string): Promise<Locator> {
  await page.getByTestId("code-add-context").click();
  await page.getByTestId(`code-add-context-${kind}`).click();
  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Code opens on the repositories", () => {
  test("each repository says what matters at a glance, and opens its page", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Code");
    await expect(page.getByTestId("code-repository-card")).toHaveCount(3);

    // The most recently active repository first.
    const checkout: Locator = page.getByTestId("code-repository-card").first();
    await expect(checkout).toContainText("checkout-api");
    await expect(checkout).toContainText("acme/checkout-api");
    await expect(checkout.getByTestId("code-repository-working")).toHaveText(
      "1 working",
    );
    await expect(checkout.getByTestId("code-repository-waiting")).toHaveText(
      "1 waiting for you",
    );
    await expect(checkout.getByTestId("code-repository-stats")).toContainText(
      "6 tasks",
    );
    await expect(checkout.getByTestId("code-repository-stats")).toContainText(
      "1 open pull request",
    );

    // A repository AI cannot reach says so, and keeps its whole name.
    const payments: Locator = page
      .getByTestId("code-repository-card")
      .filter({ hasText: "payments-worker" });
    await expect(
      payments.getByTestId("code-repository-not-connected"),
    ).toHaveText("Not connected");
    await expect(payments.getByRole("heading", { level: 3 })).toHaveText(
      "payments-worker",
    );
    const nameIsWhole: boolean = await payments
      .getByRole("heading", { level: 3 })
      .evaluate((element: Element): boolean => {
        return element.scrollWidth <= element.clientWidth;
      });
    expect(nameIsWhole).toBe(true);

    const quiet: Locator = page
      .getByTestId("code-repository-card")
      .filter({ hasText: "storefront-web" });
    await expect(quiet.getByTestId("code-repository-stats")).toHaveText(
      "No tasks yet",
    );
    await expect(quiet.getByTestId("code-repository-attention")).toHaveCount(0);

    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repositories");

    await checkout.click();
    await expect(page).toHaveURL(repositoryPath(REPOSITORY.checkout));
    await expect(page.getByTestId("code-ask")).toBeVisible();
  });

  test("the breadcrumb and the side menu name Code, and Connect repositories starts GitHub's install", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page);

    await expect(
      page.getByText("Project", { exact: true }).first(),
    ).toBeVisible();
    if (!isPhone(testInfo)) {
      await expect(
        page.getByRole("link", { name: "Repositories" }).first(),
      ).toBeVisible();
    }

    await page.getByTestId("code-connect-more").click();
    await expect
      .poll(async () => {
        return (await recorded(page)).navigations;
      })
      .toEqual([
        "https://github.com/apps/oneuptime-app/installations/new?state=fixture",
      ]);
  });

  test("with many repositories, a search box finds one by name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCode(page, "repos=many");

    await expect(page.getByTestId("code-repository-card")).toHaveCount(8);
    const search: Locator = page.getByTestId("code-repository-search");
    await search.fill("index");
    await expect(page.getByTestId("code-repository-card")).toHaveCount(1);
    await expect(page.getByTestId("code-repository-card")).toContainText(
      "search-indexer",
    );

    await search.fill("nothing like it");
    await expect(page.getByTestId("code-repository-card")).toHaveCount(0);
    await expect(page.getByTestId("code-repository-search-empty")).toHaveText(
      "No repository matches your search.",
    );
  });

  test("no repository yet: what Code is for, and Connect GitHub", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page, "repos=none");

    const empty: Locator = page.getByTestId("code-connect-github");
    await expect(empty).toContainText("Connect your code");
    await expect(empty).toContainText(
      "ask OneUptime AI to work in your repositories",
    );
    await expect(page.getByTestId("code-repository-card")).toHaveCount(0);
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-connect-github");

    await empty.getByRole("button", { name: "Connect GitHub" }).click();
    await expect
      .poll(async () => {
        return (await recorded(page)).navigations;
      })
      .toEqual([
        "https://github.com/apps/oneuptime-app/installations/new?state=fixture",
      ]);

    await empty
      .getByRole("button", { name: "Connect an existing installation" })
      .click();
    await expect
      .poll(async () => {
        return (await recorded(page)).navigations.length;
      })
      .toBe(2);
    expect((await recorded(page)).navigations[1]).toBe(
      "https://github.com/login/oauth/authorize?client_id=fixture",
    );
  });

  test("a server with no GitHub App says what it needs, and links the setup guide", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCode(page, "repos=none&github=unconfigured");

    const notConfigured: Locator = page.getByTestId(
      "code-github-not-configured",
    );
    await expect(notConfigured).toContainText(
      "GitHub App is not configured on this server",
    );
    await expect(
      notConfigured.getByRole("link", {
        name: "GitHub Integration documentation",
      }),
    ).toHaveAttribute("href", "/docs/self-hosted/github-integration");
    await expect(
      page.getByRole("button", { name: "Connect GitHub" }),
    ).toHaveCount(0);
  });

  test("tasks with no repository are listed under them, and open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCode(page, "other=1");

    const other: Locator = page.getByTestId("code-tasks-without-repository");
    await expect(other).toContainText("Other tasks");
    await expect(other.getByTestId("code-task-row")).toHaveCount(1);
    await expect(other.getByTestId("code-task-row")).toContainText(
      "ECONNRESET: socket hang up",
    );

    await other.getByTestId("code-task-row").getByRole("link").click();
    await expect(page.getByTestId("code-task-title")).toHaveText(
      "ECONNRESET: socket hang up",
    );
    // No repository: nothing for AI to continue in.
    await expect(page.getByTestId("code-task-no-repository")).toBeVisible();
    await expect(composerInput(page)).toHaveCount(0);
  });

  test("on the Free plan, the plan gate says what AI needs and loads nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCode(page, "plan=free");

    await expect(
      page.getByText("AI requires the Growth plan").first(),
    ).toBeVisible();
    await expect(page.getByTestId("code-repository-card")).toHaveCount(0);
    expect((await recorded(page)).reads.repositories).toBe(0);
  });
});

test.describe("a repository's page: ask AI", () => {
  test("tasks newest first, each with its state, who asked and its pull request", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepository(page, REPOSITORY.checkout);

    const rows: Locator = page.getByTestId("code-task-row");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toContainText(
      "Write tests for the coupon validator",
    );
    await expect(rows.nth(0)).toHaveAttribute("data-task-state", "Working");
    await expect(rows.nth(1)).toHaveAttribute("data-task-state", "Done");
    await expect(rows.nth(1)).toContainText("Asked by Ada Lovelace");
    await expect(rows.nth(1)).toContainText("PR #418");
    await expect(rows.nth(2)).toHaveAttribute(
      "data-task-state",
      "WaitingForYou",
    );
    await expect(
      rows.nth(2).locator("[data-testid='code-task-state']:visible"),
    ).toHaveText("Waiting for you");

    // A task OneUptime started is named by its record and its kind, once.
    await expect(rows.nth(3)).toContainText(
      "TypeError: Cannot read properties of undefined (reading 'amount')",
    );
    await expect(rows.nth(3).getByTestId("code-task-row-meta")).toContainText(
      "Fix Exception",
    );
    await expect(rows.nth(3)).not.toContainText("From an exception");
    await expect(rows.nth(4)).toHaveAttribute("data-task-state", "Failed");
    await expect(rows.nth(5)).toHaveAttribute("data-task-state", "Stopped");

    // One state badge shows per row: beside the title on a laptop, leading the meta line on a phone.
    for (let index: number = 0; index < 6; index++) {
      await expect(
        rows.nth(index).locator("[data-testid='code-task-state']:visible"),
      ).toHaveCount(1);
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repository");

    await rows.nth(1).getByRole("link").click();
    await expect(page).toHaveURL(taskPath(TASK.retries));
  });

  test("a repository with no task yet offers examples, and one fills the request box", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepository(page, REPOSITORY.web);

    await expect(page.getByTestId("code-examples")).toBeVisible();
    // The request box and its examples are the one thing to do: no empty list beside them.
    await expect(page.getByTestId("code-tasks")).toHaveCount(0);
    await screenshot(page, testInfo, "code-repository-empty");

    await page
      .getByTestId("code-example")
      .filter({ hasText: "Add tests for the code that has none" })
      .click();
    await expect(composerInput(page)).toHaveValue(
      "Add tests for the code that has none",
    );
    await expect(composerInput(page)).toBeFocused();
    await expect(sendButton(page)).toBeEnabled();
  });

  test("asking with context starts a task whose conversation fills in as AI works, ending in a pull request", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepository(page, REPOSITORY.checkout);

    // Nothing to send yet.
    await expect(sendButton(page)).toBeDisabled();

    await composerInput(page).fill(
      "Time out the payment gateway after 5 seconds",
    );

    // A file: a path that leaves the repository is refused in the dialog.
    let dialog: Locator = await addContext(page, "File");
    await expect(dialog).toContainText("Add a file or folder");
    await page.getByTestId("code-context-path").fill("../secrets.env");
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toContainText(
      "A path must stay inside the repository",
    );
    await page.getByTestId("code-context-path").fill("./src/payments/");
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toHaveCount(0);

    // A note.
    dialog = await addContext(page, "Note");
    await page
      .getByTestId("code-context-note")
      .fill("The gateway's p95 is 1.2 s; 30 s timeouts hold workers.");
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toHaveCount(0);

    // An incident, picked from the project.
    dialog = await addContext(page, "Incident");
    const picker: Locator = page.getByTestId("code-context-record");
    // The picker opens as the dialog does on a narrow screen; open it otherwise.
    if ((await picker.getAttribute("aria-expanded")) !== "true") {
      await picker.click();
    }
    await page
      .getByRole("option", { name: "Checkout fails for some customers" })
      .click();
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toHaveCount(0);

    const chips: Locator = page.getByTestId("code-composer-context-chip");
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toContainText("src/payments");
    await expect(chips.nth(2)).toContainText(
      "Checkout fails for some customers",
    );

    // A chip can be taken out again.
    await chips
      .nth(1)
      .getByRole("button", { name: /^Remove / })
      .click();
    await expect(chips).toHaveCount(2);

    await screenshot(page, testInfo, "code-ask-with-context");
    await sendButton(page).click();

    // The new task's conversation: the request, its context, and AI's turn.
    await expect(page).toHaveURL(/\/code\/tasks\//);
    await expect(page.getByTestId("code-task-title")).toHaveText(
      "Time out the payment gateway after 5 seconds",
    );
    const request: Locator = page.getByTestId("code-turn-request").first();
    await expect(request).toContainText("Ada Lovelace");
    await expect(request.getByTestId("code-turn-context-chip")).toHaveCount(2);

    const sent: Recorded = await recorded(page);
    expect(sent.creates).toEqual([
      {
        repositoryId: REPOSITORY.checkout,
        message: "Time out the payment gateway after 5 seconds",
        context: [
          { type: "File", path: "src/payments" },
          { type: "Incident", id: INCIDENT_ID },
        ],
      },
    ]);

    // Queued, then working with its steps, then done.
    await expect(turnReplies(page).first()).toHaveAttribute(
      "data-turn-state",
      "Working",
    );
    await expect(page.getByTestId("code-turn-working")).toBeVisible();
    await expect(page.getByTestId("code-task-working-footer")).toBeVisible();
    await expect(page.getByTestId("code-task-step").first()).toBeVisible({
      timeout: 20000,
    });

    await expect(turnReplies(page).first()).toHaveAttribute(
      "data-turn-state",
      "Done",
      { timeout: 30000 },
    );
    await expect(page.getByTestId("code-turn-summary")).toContainText(
      "times out after 5 seconds",
    );
    await expect(page.getByTestId("code-task-changed-file")).toHaveCount(1);
    await expect(page.getByTestId("code-turn-pull-request")).toContainText(
      "Opened pull request #419",
    );
    await expect(page.getByTestId("code-task-pull-request")).toHaveAttribute(
      "href",
      "https://github.com/acme/checkout-api/pull/419",
    );

    // Done: the steps fold into one line, and the diff opens on demand.
    await expect(page.getByTestId("code-task-steps-toggle")).toContainText(
      "5 steps",
    );
    await page
      .getByTestId("code-task-changed-file")
      .getByRole("button")
      .click();
    await expect(page.getByTestId("code-task-diff")).toContainText(
      "timeoutInMs = 5000",
    );

    // The reply box is back, saying where changes go.
    await expect(composerInput(page)).toBeVisible();
    await expect(page.getByTestId("code-task-composer")).toContainText(
      "Changes you ask for are pushed to pull request #419.",
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-task-done");
  });

  test("Enter sends and Shift + Enter starts a new line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepository(page, REPOSITORY.checkout);

    await composerInput(page).click();
    await page.keyboard.type("First line");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Second line");
    await expect(composerInput(page)).toHaveValue("First line\nSecond line");
    expect((await recorded(page)).creates).toEqual([]);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/code\/tasks\//);
    expect((await recorded(page)).creates[0]?.message).toBe(
      "First line\nSecond line",
    );
  });

  test("a refused request keeps what was typed and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepository(page, REPOSITORY.checkout, "refuse=create");

    await composerInput(page).fill("Add an index on orders.customer_id");
    await sendButton(page).click();

    await expect(page.getByTestId("code-composer-error")).toContainText(
      "daily AI token limit",
    );
    await expect(composerInput(page)).toHaveValue(
      "Add an index on orders.customer_id",
    );
    await expect(page).toHaveURL(
      repositoryPath(REPOSITORY.checkout) + "?refuse=create",
    );
  });

  const BLOCKERS: Array<{ type: string; sentence: string; fix?: string }> = [
    {
      type: "AiDisabled",
      sentence: "AI is turned off for this project.",
      fix: "Turn AI on",
    },
    {
      type: "NoLlmProvider",
      sentence: "AI needs an LLM provider for this project.",
      fix: "Add an LLM provider",
    },
    {
      type: "NoAiCredits",
      sentence: "This project's AI credits are used up.",
      fix: "Add AI credits",
    },
    {
      type: "NoAgent",
      sentence: "No Runner is online to do the work.",
      fix: "Set up a Runner",
    },
    {
      type: "PlanRequired",
      sentence: "AI in Code needs the Growth plan or above.",
      fix: "Upgrade the plan",
    },
    {
      type: "SubscriptionUnpaid",
      sentence: "This project's subscription is unpaid, so AI cannot run.",
      fix: "Update billing",
    },
    {
      type: "DailyLimitReached",
      sentence: "daily AI token limit of 2,000,000 tokens",
    },
  ];

  for (const blocker of BLOCKERS) {
    test(`${blocker.type}: said above the request box with what fixes it, and nothing can be sent`, async ({
      page,
    }: {
      page: Page;
    }, testInfo: TestInfo) => {
      // What it checks does not depend on the screen's width.
      test.skip(isPhone(testInfo), "width-independent");
      await openRepository(
        page,
        REPOSITORY.checkout,
        `blocker=${blocker.type}`,
      );

      const notice: Locator = page.getByTestId("code-blocker");
      await expect(notice).toHaveAttribute("data-blocker", blocker.type);
      await expect(notice).toContainText(blocker.sentence);
      if (blocker.fix) {
        await expect(notice.getByTestId("code-blocker-fix")).toHaveText(
          blocker.fix,
        );
      } else {
        await expect(notice.getByTestId("code-blocker-fix")).toHaveCount(0);
      }

      await expect(composerInput(page)).toBeDisabled();
      await expect(sendButton(page)).toBeDisabled();
      await expect(page.getByTestId("code-add-context")).toBeDisabled();
      // No examples to fill a box that cannot send.
      await expect(page.getByTestId("code-examples")).toHaveCount(0);
    });
  }

  test("a repository the GitHub App cannot reach says so, and links Connect GitHub", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepository(page, REPOSITORY.payments);

    const notice: Locator = page.getByTestId("code-blocker");
    await expect(notice).toHaveAttribute(
      "data-blocker",
      "RepositoryNotConnected",
    );
    await expect(notice.getByTestId("code-blocker-fix")).toHaveText(
      "Connect GitHub",
    );
    await notice.getByTestId("code-blocker-fix").click();
    await expect(page).toHaveURL(CODE);
  });

  test("a member who may only read reads every task, and is told why they cannot ask", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepository(page, REPOSITORY.checkout, "role=viewer");

    await expect(page.getByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "NoPermission",
    );
    await expect(page.getByTestId("code-blocker")).toContainText(
      "ask a project admin for it",
    );
    await expect(composerInput(page)).toHaveCount(0);
    await expect(page.getByTestId("code-task-row")).toHaveCount(6);
    await screenshot(page, testInfo, "code-repository-read-only");

    // A task's page: the conversation, which files changed - not the diff.
    await page.goto(`${taskPath(TASK.retries)}?role=viewer`);
    await expect(page.getByTestId("code-task-turns")).toBeVisible();
    await expect(
      page.getByTestId("code-task-changed-file").first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("code-task-changed-file").first().getByRole("button"),
    ).toBeDisabled();
    await expect(composerInput(page)).toHaveCount(0);
    await expect(page.getByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "NoPermission",
    );
  });

  test("a read-only member on a repository with no task is told where tasks will show", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepository(page, REPOSITORY.web, "role=viewer");

    await expect(page.getByTestId("code-tasks-empty")).toContainText(
      "When someone asks AI to work in this repository, the task shows up here.",
    );
    await expect(page.getByTestId("code-examples")).toHaveCount(0);
  });
});

test.describe("a task's conversation", () => {
  test("the request and its context, AI's steps, its reply, the diff and the pull request", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openTask(page, TASK.retries);

    await expect(page.getByTestId("code-task-header")).toContainText("Done");
    await expect(page.getByTestId("code-task-header")).toContainText("#12");
    await expect(page.getByTestId("code-task-title")).toHaveText(
      "Retry charges when the payment gateway times out",
    );

    const requests: Locator = page.getByTestId("code-turn-request");
    await expect(requests).toHaveCount(2);
    const context: Locator = requests
      .first()
      .getByTestId("code-turn-context-chip");
    await expect(context).toHaveCount(2);
    // A record in the context opens its page.
    await expect(context.first().getByRole("link")).toHaveAttribute(
      "href",
      `${DASHBOARD}/incidents/${INCIDENT_ID}`,
    );

    // The steps fold into one line: what AI did, counted.
    const toggle: Locator = page.getByTestId("code-task-steps-toggle").first();
    await expect(toggle).toHaveText(
      "7 steps · read 2 files · edited 2 files · ran 1 command",
    );
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByTestId("code-task-steps").first().getByTestId("code-task-step"),
    ).toHaveCount(7);
    await expect(page.getByTestId("code-task-step").nth(3)).toContainText(
      "Edited src/payments/client.ts",
    );

    // The reply is markdown; the diff opens a file at a time.
    await expect(page.getByTestId("code-turn-summary").first()).toContainText(
      "Charges now retry up to 3 times",
    );
    const files: Locator = page
      .getByTestId("code-task-changes")
      .first()
      .getByTestId("code-task-changed-file");
    await expect(files).toHaveCount(2);
    await files.first().getByRole("button").click();
    await expect(page.getByTestId("code-task-diff").first()).toContainText(
      "withRetries(",
    );

    // The first turn opened the pull request; the follow-up pushed to it.
    const pullRequests: Locator = page.getByTestId("code-turn-pull-request");
    await expect(pullRequests.first()).toContainText(
      "Opened pull request #418",
    );
    await expect(pullRequests.last()).toContainText(
      "Pushed to pull request #418",
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-task-conversation");
  });

  test("a reply continues the same task, on the same pull request", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTask(page, TASK.retries);

    await composerInput(page).fill("Make the backoff 300 ms, please.");
    await sendButton(page).click();

    // The reply is its own turn; the box waits while AI works on it.
    await expect(page.getByTestId("code-turn-request")).toHaveCount(3);
    await expect(page.getByTestId("code-turn-request").last()).toContainText(
      "Make the backoff 300 ms, please.",
    );
    await expect(page.getByTestId("code-task-working-footer")).toBeVisible();
    await expect(composerInput(page)).toHaveCount(0);

    expect((await recorded(page)).replies).toEqual([
      {
        taskId: TASK.retries,
        message: "Make the backoff 300 ms, please.",
        context: [],
      },
    ]);

    await expect(turnReplies(page).last()).toHaveAttribute(
      "data-turn-state",
      "Done",
      { timeout: 30000 },
    );
    await expect(
      turnReplies(page).last().getByTestId("code-turn-pull-request"),
    ).toContainText("Pushed to pull request #418");
    await expect(composerInput(page)).toBeVisible();
  });

  test("waiting for you: AI's question stands out, and the answer box is ready", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openTask(page, TASK.question);

    await expect(page.getByTestId("code-task-header")).toContainText(
      "Waiting for you",
    );
    const summary: Locator = page.getByTestId("code-turn-summary");
    await expect(summary).toContainText("AI asks");
    await expect(summary).toContainText("Which do you prefer?");
    await expect(composerInput(page)).toHaveAttribute(
      "placeholder",
      "Answer the question, add context, or ask for changes…",
    );
    if (!isPhone(testInfo)) {
      await expect(composerInput(page)).toBeFocused();
    }
    await screenshot(page, testInfo, "code-task-waiting");

    await composerInput(page).fill("Send the email first, with a link.");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("code-turn-request")).toHaveCount(2);
    expect((await recorded(page)).replies[0]?.message).toBe(
      "Send the email first, with a link.",
    );
  });

  test("while AI works: its latest steps show live, and Stop stops it; Try again asks again", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepository(page, REPOSITORY.checkout, "ai=stall");
    await composerInput(page).fill("Rename PaymentClient to GatewayClient");
    await sendButton(page).click();

    await expect(page.getByTestId("code-task-step").first()).toBeVisible({
      timeout: 20000,
    });
    // Live steps are open, without a fold to click.
    await expect(page.getByTestId("code-task-steps-toggle")).toHaveCount(0);
    await screenshot(page, testInfo, "code-task-working");

    await page.getByTestId("code-task-stop").click();
    await expect(turnReplies(page).last()).toHaveAttribute(
      "data-turn-state",
      "Stopped",
    );
    await expect(page.getByTestId("code-turn-stopped")).toContainText(
      "Stopped by Ada Lovelace.",
    );
    expect((await recorded(page)).stops).toHaveLength(1);

    await page.getByTestId("code-turn-retry").click();
    await expect(turnReplies(page)).toHaveCount(2);
    await expect(turnReplies(page).last()).toHaveAttribute(
      "data-turn-state",
      "Working",
    );
    expect((await recorded(page)).retries).toHaveLength(1);
  });

  test("a failed turn says why, and Try again asks the same again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTask(page, TASK.failed);

    const failed: Locator = page.getByTestId("code-turn-failed");
    await expect(failed).toContainText("This turn failed.");
    await expect(failed).toContainText(
      "npm run build still failed after 2 repair attempts",
    );
    // The failing command is marked in the steps.
    await page.getByTestId("code-task-steps-toggle").click();
    await expect(page.getByTestId("code-task-step").last()).toContainText(
      "Ran npm run build",
    );

    await failed.getByTestId("code-turn-retry").click();
    await expect(page.getByTestId("code-turn-request")).toHaveCount(2);
    await expect(page.getByTestId("code-turn-request").last()).toContainText(
      "Upgrade express to version 5.",
    );
    expect((await recorded(page)).retries).toEqual([TASK.failed]);
  });

  test("a task OneUptime started says what started it, and links the record", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTask(page, TASK.exception);

    const origin: Locator = page.getByTestId("code-turn-origin");
    await expect(origin).toContainText(
      "OneUptime started this task from an exception",
    );
    await expect(origin).toContainText("Fix Exception");
    await expect(
      origin.getByRole("link", {
        name: "TypeError: Cannot read properties of undefined (reading 'amount')",
      }),
    ).toHaveAttribute(
      "href",
      `${DASHBOARD}/exceptions/50000000-0000-4000-8000-0000000000e3`,
    );
    await expect(page.getByTestId("code-turn-pull-request")).toContainText(
      "Merged",
    );
  });

  test("a turn's Log opens its verbatim record, and leads back to the conversation", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTask(page, TASK.retries);

    await turnReplies(page)
      .first()
      .getByRole("link", { name: "Log", exact: true })
      .click();
    await expect(page).toHaveURL(
      `${taskPath(TASK.retries)}/log?turn=${TASK.retries}`,
    );
    await expect(page.getByText("Session Log")).toBeVisible();

    await page.getByTestId("code-task-log-back").click();
    await expect(page).toHaveURL(taskPath(TASK.retries));
    await expect(page.getByTestId("code-task-turns")).toBeVisible();
  });

  test("a task's trail is Project, Code, its repository, the task", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTask(page, TASK.retries);

    const trail: Locator = page.locator("nav[aria-label='Breadcrumb']");
    await expect(trail).toContainText("Code");
    await expect(trail).toContainText("checkout-api");
    await expect(trail).toContainText("Task #12");
    await trail.getByRole("link", { name: "checkout-api" }).click();
    await expect(page).toHaveURL(repositoryPath(REPOSITORY.checkout));
  });
});

test.describe("the old addresses forward to Code", () => {
  const MOVES: Array<{ from: string; to: string }> = [
    { from: `${DASHBOARD}/ai/agents`, to: CODE },
    {
      from: `${DASHBOARD}/ai/agents/${TASK.retries}`,
      to: taskPath(TASK.retries),
    },
    {
      from: `${DASHBOARD}/ai/agents/${TASK.retries}/logs`,
      to: `${taskPath(TASK.retries)}/log`,
    },
    {
      from: `${DASHBOARD}/ai/agents/${TASK.retries}/pull-requests`,
      to: taskPath(TASK.retries),
    },
    { from: `${DASHBOARD}/code-repository`, to: CODE },
    {
      from: `${DASHBOARD}/code-repository/${REPOSITORY.checkout}`,
      to: repositoryPath(REPOSITORY.checkout),
    },
    {
      from: `${DASHBOARD}/code-repository/${REPOSITORY.checkout}/settings`,
      to: `${repositoryPath(REPOSITORY.checkout)}/settings`,
    },
  ];

  for (const move of MOVES) {
    test(`${move.from.replace(DASHBOARD, "")} lands on ${move.to.replace(DASHBOARD, "")}`, async ({
      page,
    }: {
      page: Page;
    }, testInfo: TestInfo) => {
      // What it checks does not depend on the screen's width.
      test.skip(isPhone(testInfo), "width-independent");
      await page.goto(move.from);
      await expect(page).toHaveURL(move.to);
    });
  }

  test("GitHub's way back to Code Repositories still says GitHub connected", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The query string GitHub sends back with is kept through the forward.
    await page.goto(`${DASHBOARD}/code-repository?installation_id=51234567`);
    await expect(page.getByTestId("github-connected-notice")).toBeVisible();
    await expect(page).toHaveURL(CODE);
    await expect(
      page.getByTestId("code-repository-card").first(),
    ).toBeVisible();
  });

  test("a forwarded task keeps the hash it was linked with", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // What it checks does not depend on the screen's width.
    test.skip(isPhone(testInfo), "width-independent");
    await page.goto(`${DASHBOARD}/ai/agents/${TASK.retries}?from=email#reply`);
    await expect(page).toHaveURL(`${taskPath(TASK.retries)}?from=email#reply`);
  });
});

test.describe("dark mode and other languages", () => {
  test("dark mode: the cards, the request box and the conversation draw on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page, "theme=dark");
    await expect(
      page.getByTestId("code-repository-card").first(),
    ).toBeVisible();
    await screenshot(page, testInfo, "code-repositories-dark");

    const lightSurfaces: Array<string> = await page.evaluate(
      (channelPattern: string): Array<string> => {
        const found: Array<string> = [];
        for (const element of Array.from(
          document.querySelectorAll(
            "[data-testid='code-repository-card'], [data-testid='code-composer-input']",
          ),
        )) {
          const background: string =
            window.getComputedStyle(element).backgroundColor;
          const channels: Array<number> = (
            background.match(new RegExp(channelPattern, "g")) || []
          )
            .slice(0, 3)
            .map(Number);
          if (
            channels.length === 3 &&
            channels.every((value: number) => {
              return value > 200;
            })
          ) {
            found.push(element.getAttribute("data-testid") || "");
          }
        }
        return found;
      },
      COLOUR_CHANNELS.source,
    );
    expect(lightSurfaces).toEqual([]);

    await openTask(page, TASK.retries, "theme=dark");
    await screenshot(page, testInfo, "code-task-conversation-dark");
    const replyBackground: string = await page
      .getByTestId("code-task-composer")
      .locator("div")
      .first()
      .evaluate((element: Element): string => {
        return window.getComputedStyle(element).backgroundColor;
      });
    expect(replyBackground).not.toBe("rgb(255, 255, 255)");
  });

  test("German: Code's pages speak the reader's language", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // What it checks does not depend on the screen's width.
    test.skip(isPhone(testInfo), "width-independent");
    await openRepository(page, REPOSITORY.checkout, "lang=de");

    await expect(page.getByTestId("code-ask").getByRole("heading")).toHaveText(
      "KI um etwas bitten",
    );
    await expect(sendButton(page)).toHaveText("Aufgabe starten");
    await expect(composerInput(page)).toHaveAttribute(
      "aria-label",
      "Was soll die KI tun?",
    );
    // The AI at work is "being worked on", not the monitor sense of "Working".
    await expect(
      page
        .getByTestId("code-task-row")
        .first()
        .locator("[data-testid='code-task-state']:visible"),
    ).toHaveText("Wird bearbeitet…");
    await expect(
      page
        .getByTestId("code-task-row")
        .nth(1)
        .getByTestId("code-task-row-meta"),
    ).toContainText("Gefragt von Ada Lovelace");

    // A task's conversation, in German too.
    await openTask(page, TASK.retries, "lang=de");
    await expect(page.getByTestId("code-task-steps-toggle").first()).toHaveText(
      "7 Schritte · 2 Dateien gelesen · 2 Dateien bearbeitet · 1 Befehl ausgeführt",
    );
    await expect(
      page.getByTestId("code-turn-pull-request").first(),
    ).toContainText("Pull Request #418 geöffnet");
  });
});
