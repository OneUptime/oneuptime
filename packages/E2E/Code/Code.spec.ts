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
 * Code in a browser, against the offline fixture (Code/Fixture): its first
 * page - the question, one request box with the repository and the branch
 * picked in it, every task under it - Repositories, a repository's page
 * where AI is asked with context, a task's conversation filling in as the
 * AI works, replying in it, stopping it and trying again, whatever stops AI
 * working said once at the top of the box with what fixes it, a
 * repository's settings - the GitHub Commands switch, the Runner AI works
 * on, More settings and commands an operator set - read-only members, the
 * old Tasks and Code Repositories addresses, a phone, dark mode and German.
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

// The project's own Runners a repository may pick (Code/Fixture).
const RUNNER: Record<"prod" | "office" | "agent", string> = {
  prod: "60000000-0000-4000-8000-0000000000f1",
  office: "60000000-0000-4000-8000-0000000000f2",
  agent: "60000000-0000-4000-8000-0000000000f3",
};

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
    branch?: string;
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
  branchReads: Array<{ repositoryId: string; search: string }>;
  lists: Array<string>;
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

/*
 * A full-page screenshot. A task's reply box is held at the bottom of the
 * window (sticky), which a full-page capture would draw over the middle of
 * the conversation: for the capture alone it sits where it would without
 * that, at the end.
 */
async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  const footer: Locator = page.getByTestId("code-task-footer");
  const hasFooter: boolean = (await footer.count()) > 0;
  if (hasFooter) {
    await footer.evaluate((element: HTMLElement): void => {
      element.style.position = "static";
    });
  }
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-${testInfo.project.name}.png`),
    fullPage: true,
    animations: "disabled",
  });
  if (hasFooter) {
    await footer.evaluate((element: HTMLElement): void => {
      element.style.position = "";
    });
  }
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

/*
 * The maintainer's ask (2026-10-20): "The code product doesnt looks great
 * at all. Can you please overhaul this? Make it look a lot nicer and
 * natural to use. We should make it look like claude code / codex / etc."
 * Code now opens the way those do: the question over one box, the
 * repository and the branch picked in the box, every task under it.
 */
test.describe("Code opens on the request box, like Claude Code and Codex", () => {
  test("the question over one box - the repository and its main branch picked in it - and every task under it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "What should AI do?",
    );
    const ask: Locator = page.getByTestId("code-ask");
    // The most recently active repository AI reaches, and its main branch.
    await expect(ask.getByTestId("code-repository-picker-button")).toHaveText(
      "checkout-api",
    );
    await expect(ask.getByTestId("code-branch-picker-button")).toHaveText(
      "main",
    );
    await expect(ask.getByTestId("code-branch-picker-button")).toBeEnabled();
    await expect(composerInput(page)).toBeEditable();
    // No repository cards to scroll past: the repositories are picked here.
    await expect(page.getByTestId("code-repository-row")).toHaveCount(0);

    // Every task, each named by its repository, how much it changed at its end.
    const rows: Locator = page.getByTestId("code-task-row");
    await expect(rows).toHaveCount(6);
    for (let index: number = 0; index < 6; index++) {
      await expect(
        rows.nth(index).getByTestId("code-task-row-repository"),
      ).toHaveText("checkout-api");
    }
    const retries: Locator = rows.filter({
      hasText: "Retry charges when the payment gateway times out",
    });
    await expect(retries.getByTestId("code-task-row-changes")).toHaveText(
      "+27−1",
    );
    // Its pull request beside the pull request mark - GitHub's is the repository's.
    await expect(
      retries
        .getByTestId("code-task-row-pull-request")
        .getByTestId("code-pull-request-mark"),
    ).toBeVisible();
    await expect(page.getByTestId("code-tasks-count")).toHaveText("6");

    // The box sits above the fold, the first thing on the page.
    const box: { y: number; height: number } | null = await page
      .getByTestId("code-composer-box")
      .boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThan(isPhone(testInfo) ? 844 : 900);

    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-home");

    await retries.getByRole("link").click();
    await expect(page).toHaveURL(taskPath(TASK.retries));
  });

  /*
   * The UI review: in German at 1280 the Enter hint took the room Start
   * task needed and pushed it onto a second line; on a phone, Start task
   * always sat on a line of its own under the pickers. The row is now one
   * line: the hint shows only where it fits, and beside the pickers a
   * phone's Send is its arrow.
   */
  test("the box's bottom row stays one line - in German too - and says how to send only where it fits", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // Add context, the pickers and Start task share one line.
    const expectOneLine: () => Promise<void> = async (): Promise<void> => {
      const addContext: { y: number; height: number } | null = await page
        .getByTestId("code-add-context")
        .boundingBox();
      const send: { y: number; height: number } | null =
        await sendButton(page).boundingBox();
      expect(
        Math.abs(
          addContext!.y + addContext!.height / 2 - (send!.y + send!.height / 2),
        ),
      ).toBeLessThan(4);
    };
    // The hint lies wholly in its room: shown, not wrapped out of sight.
    const isHintShown: () => Promise<boolean> = async (): Promise<boolean> => {
      return await page
        .getByTestId("code-composer-keys")
        .evaluate((element: Element): boolean => {
          const room: DOMRect =
            element.parentElement!.parentElement!.getBoundingClientRect();
          const hint: DOMRect = element.getBoundingClientRect();
          return (
            hint.width > 0 &&
            hint.top >= room.top - 1 &&
            hint.bottom <= room.bottom + 1
          );
        });
    };

    await openCode(page);
    await expect(page.getByTestId("code-task-row").first()).toBeVisible();
    await expectOneLine();
    if (isPhone(testInfo)) {
      // Beside the pickers, Send is its arrow - still named for a screen reader.
      await expect(sendButton(page)).toHaveAccessibleName("Start task");
      const send: { width: number } | null =
        await sendButton(page).boundingBox();
      expect(send!.width).toBeLessThanOrEqual(34);
      // A phone has no Enter to tell about.
      await expect(page.getByTestId("code-composer-keys")).toBeHidden();
    } else {
      expect(await isHintShown()).toBe(true);
    }

    await openCode(page, "lang=de");
    await expect(sendButton(page)).toHaveAccessibleName("Aufgabe starten");
    await expectOneLine();
    if (!isPhone(testInfo)) {
      // German's hint has no room beside Aufgabe starten: it hides, never wraps it.
      expect(await isHintShown()).toBe(false);
    }
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-home-german");
  });

  /*
   * The UI review: a long repository name (or branch) wrapped the box's
   * bottom row onto four lines on a phone, and when it shrank, "main" was
   * cut to "m" alongside it; in a task's row the name was clipped mid-word.
   * The row stays one line, the room is shared fairly (a short name stays
   * whole), and a long name ends in "…".
   */
  test("long names are cut short with … - a short branch stays whole - and the bottom row stays one line", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const isCutShort: (locator: Locator) => Promise<boolean> = async (
      locator: Locator,
    ): Promise<boolean> => {
      return await locator.evaluate((element: Element): boolean => {
        return (
          element.scrollWidth > element.clientWidth &&
          window.getComputedStyle(element).textOverflow === "ellipsis"
        );
      });
    };
    const isWhole: (locator: Locator) => Promise<boolean> = async (
      locator: Locator,
    ): Promise<boolean> => {
      return await locator.evaluate((element: Element): boolean => {
        return element.scrollWidth <= element.clientWidth;
      });
    };
    const expectOneLine: () => Promise<void> = async (): Promise<void> => {
      const centre: (testId: string) => Promise<number> = async (
        testId: string,
      ): Promise<number> => {
        const box: { y: number; height: number } | null = await page
          .getByTestId(testId)
          .boundingBox();
        return box!.y + box!.height / 2;
      };
      const addContext: number = await centre("code-add-context");
      for (const testId of [
        "code-repository-picker-button",
        "code-branch-picker-button",
        "code-composer-send",
      ]) {
        expect(Math.abs((await centre(testId)) - addContext)).toBeLessThan(4);
      }
    };

    await openCode(page, "names=long");
    const repository: Locator = page.getByTestId(
      "code-repository-picker-value",
    );
    await expect(repository).toHaveText(
      "checkout-and-payments-platform-api-service",
    );
    // The whole name on hover; the button holds it cut short.
    await expect(
      page.getByTestId("code-repository-picker-button"),
    ).toHaveAttribute("title", "checkout-and-payments-platform-api-service");
    expect(await isCutShort(repository)).toBe(true);
    await expect(page.getByTestId("code-branch-picker-value")).toHaveText(
      "main",
    );
    expect(await isWhole(page.getByTestId("code-branch-picker-value"))).toBe(
      true,
    );
    await expectOneLine();

    // A long branch too: both cut short, the row still one line.
    await page.getByTestId("code-branch-picker-button").click();
    await page
      .getByTestId("code-branch-picker-option")
      .filter({ hasText: "feature/very-long-branch-name" })
      .click();
    await expect(page.getByTestId("code-branch-picker-value")).toHaveText(
      "feature/very-long-branch-name-for-the-new-checkout-flow-with-apple-pay",
    );
    expect(await isCutShort(page.getByTestId("code-branch-picker-value"))).toBe(
      true,
    );
    await expectOneLine();

    // A task's row: its repository's name ends in … where the row is narrow.
    const name: Locator = page
      .getByTestId("code-task-row")
      .first()
      .getByTestId("code-task-row-repository")
      .locator("span.truncate");
    await expect(name).toHaveText("checkout-and-payments-platform-api-service");
    if (isPhone(testInfo)) {
      expect(await isCutShort(name)).toBe(true);
    }
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-home-long-names");
  });

  test("picking a repository and a branch, then asking, starts the task there - from that branch", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page);

    await page.getByTestId("code-repository-picker-button").click();
    const repositories: Locator = page.getByTestId(
      "code-repository-picker-option",
    );
    await expect(repositories).toHaveCount(3);
    // One AI cannot reach is offered, quieter, and says so.
    await expect(
      repositories.filter({ hasText: "payments-worker" }),
    ).toContainText("Not connected");
    await page.getByTestId("code-repository-picker-search").fill("store");
    await expect(repositories).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("code-repository-picker-button")).toHaveText(
      "storefront-web",
    );

    await page.getByTestId("code-branch-picker-button").click();
    const branches: Locator = page.getByTestId("code-branch-picker-option");
    await expect(branches).toHaveCount(2);
    await expect(branches.first()).toContainText("main");
    await expect(branches.first()).toContainText("Default");
    // The list stays on the screen, a phone's too.
    const menu: { x: number; width: number } | null = await page
      .getByTestId("code-branch-picker-menu")
      .boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(
      isPhone(testInfo) ? 390 : 1280,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-branch-picker");

    await branches.filter({ hasText: "redesign/checkout-page" }).click();
    await expect(page.getByTestId("code-branch-picker-button")).toHaveText(
      "redesign/checkout-page",
    );
    expect((await recorded(page)).branchReads).toEqual([
      { repositoryId: REPOSITORY.web, search: "" },
    ]);

    await composerInput(page).fill("Make the checkout page's buttons larger");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/code\/tasks\//);
    expect((await recorded(page)).creates).toEqual([
      {
        repositoryId: REPOSITORY.web,
        message: "Make the checkout page's buttons larger",
        context: [],
        branch: "redesign/checkout-page",
      },
    ]);
    // The task says where it works: that repository, from that branch.
    await expect(page.getByTestId("code-task-repository")).toContainText(
      "acme/storefront-web",
    );
    await expect(page.getByTestId("code-task-branch")).toHaveText(
      "redesign/checkout-page",
    );
  });

  test("the box starts on the repository picked last", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // What it checks does not depend on the screen's width.
    test.skip(isPhone(testInfo), "width-independent");
    await openCode(page);

    await page.getByTestId("code-repository-picker-button").click();
    await page
      .getByTestId("code-repository-picker-option")
      .filter({ hasText: "storefront-web" })
      .click();
    await expect(page.getByTestId("code-repository-picker-button")).toHaveText(
      "storefront-web",
    );

    await page.reload();
    await expect(page.getByTestId("code-repository-picker-button")).toHaveText(
      "storefront-web",
    );
  });

  test("a repository with more branches than one read holds is searched by what is typed", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // What it checks does not depend on the screen's width.
    test.skip(isPhone(testInfo), "width-independent");
    await openCode(page, "branches=many");

    await page.getByTestId("code-branch-picker-button").click();
    const branches: Locator = page.getByTestId("code-branch-picker-option");
    await expect(branches).toHaveCount(101);
    await expect(page.getByTestId("code-branch-picker-note")).toHaveText(
      "Type a branch's name to find one that is not listed.",
    );

    await page.getByTestId("code-branch-picker-search").fill("feature/task-13");
    await expect(branches).toHaveCount(10);
    await expect(branches.first()).toHaveText("feature/task-130");
    // One read for what was typed, once typing rested.
    expect((await recorded(page)).branchReads).toEqual([
      { repositoryId: REPOSITORY.checkout, search: "" },
      { repositoryId: REPOSITORY.checkout, search: "feature/task-13" },
    ]);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("code-branch-picker-button")).toHaveText(
      "feature/task-131",
    );
    await expect(page.getByTestId("code-branch-picker-button")).toBeFocused();
  });

  test("branches that cannot be read say so, with Try again", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // What it checks does not depend on the screen's width.
    test.skip(isPhone(testInfo), "width-independent");
    await openCode(page, "fail=branches");

    await page.getByTestId("code-branch-picker-button").click();
    await expect(page.getByTestId("code-branch-picker-error")).toContainText(
      "OneUptime could not read this repository's branches from GitHub.",
    );
    await page.getByTestId("code-branch-picker-retry").click();
    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).branchReads.length;
      })
      .toBe(2);
    // The box still sends, from the main branch.
    await expect(composerInput(page)).toBeEditable();
  });

  test("a repository GitHub does not reach: said at the top of the box, with Connect GitHub right there", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page, "connected=none");

    const notice: Locator = page.getByTestId("code-composer-notice");
    await expect(notice.getByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "RepositoryNotConnected",
    );
    await expect(composerInput(page)).toBeDisabled();
    await expect(page.getByTestId("code-branch-picker-button")).toBeDisabled();
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-home-not-connected");

    await notice.getByTestId("code-blocker-fix").click();
    await expect
      .poll(async () => {
        return (await recorded(page)).navigations;
      })
      .toEqual([
        "https://github.com/apps/oneuptime-app/installations/new?state=fixture",
      ]);
  });

  test("whatever stops AI is said once at the top of the box, which then sends nothing", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page, "blocker=NoLlmProvider");

    const notice: Locator = page.getByTestId("code-composer-notice");
    await expect(notice).toContainText(
      "AI needs an LLM provider for this project.",
    );
    await expect(notice.getByTestId("code-blocker-fix")).toHaveText(
      "Add an LLM provider",
    );
    await expect(page.getByTestId("code-blocker")).toHaveCount(1);
    await expect(composerInput(page)).toBeDisabled();
    await expect(sendButton(page)).toBeDisabled();
    // Another repository can still be picked.
    await expect(
      page.getByTestId("code-repository-picker-button"),
    ).toBeEnabled();
    await screenshot(page, testInfo, "code-home-blocked");
  });

  test("nothing asked yet: requests to try under the box, and one fills it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page, "tasks=none");

    const examples: Locator = page.getByTestId("code-examples");
    await expect(examples).toContainText("Try asking");
    await expect(page.getByTestId("code-example")).toHaveCount(4);
    // No empty list beside them.
    await expect(page.getByTestId("code-tasks")).toBeHidden();
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-home-first-time");

    await page
      .getByTestId("code-example")
      .filter({ hasText: "Explain how this repository is organized" })
      .click();
    await expect(composerInput(page)).toHaveValue(
      "Explain how this repository is organized",
    );
    await expect(composerInput(page)).toBeFocused();
  });

  test("a member who may only read is told why at the top of the box, and reads every task", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCode(page, "role=viewer");

    await expect(
      page.getByTestId("code-composer-notice").getByTestId("code-blocker"),
    ).toHaveAttribute("data-blocker", "NoPermission");
    await expect(composerInput(page)).toBeDisabled();
    await expect(page.getByTestId("code-task-row")).toHaveCount(6);
  });

  test("the breadcrumb and the side menu: Tasks, then Repositories", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page);

    await expect(
      page.getByText("Project", { exact: true }).first(),
    ).toBeVisible();
    if (!isPhone(testInfo)) {
      await expect(page.getByRole("link", { name: "Tasks" })).toBeVisible();
      await page.getByRole("link", { name: "Repositories" }).first().click();
      await expect(page).toHaveURL(`${CODE}/repositories`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Repositories",
      );
    }
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
    // No box to write in before there is anywhere for AI to work.
    await expect(page.getByTestId("code-ask")).toHaveCount(0);
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

  test("tasks with no repository are in the list too, and open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCode(page, "other=1");

    const orphan: Locator = page
      .getByTestId("code-task-row")
      .filter({ hasText: "ECONNRESET: socket hang up" });
    await expect(orphan).toHaveCount(1);
    // It names no repository: it has none.
    await expect(orphan.getByTestId("code-task-row-repository")).toHaveCount(0);

    await orphan.getByRole("link").click();
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
    await expect(page.getByTestId("code-ask")).toHaveCount(0);
    expect((await recorded(page)).reads.repositories).toBe(0);
  });
});

/*
 * The maintainer (2026-10-21): "why do I see 'not connected repos' and not
 * see the connected repo visible? The connected repo is towards the end of
 * the list, and 'not connected repos' is scattered everywhere ... Make it
 * look like it belongs to the existing UI of oneuptime." The repositories AI
 * can work in are now the list - the shared table every product draws -
 * and those GitHub no longer reaches are folded apart, below it.
 */
test.describe("Code's Repositories", () => {
  async function openRepositories(
    page: Page,
    search: string = "",
  ): Promise<void> {
    await page.goto(`${CODE}/repositories${search ? `?${search}` : ""}`);
  }

  function connectedCard(page: Page): Locator {
    return page.getByTestId("code-repositories-card");
  }

  function notConnected(page: Page): Locator {
    return page.getByTestId("code-repositories-not-connected");
  }

  async function openNotConnected(page: Page): Promise<void> {
    await notConnected(page)
      .getByRole("button", { name: "Not connected" })
      .click();
    await expect(
      notConnected(page).getByRole("button", { name: "Not connected" }),
    ).toHaveAttribute("aria-expanded", "true");
  }

  function names(list: Locator): Locator {
    return list
      .getByTestId("code-repository-row")
      .getByTestId("code-repository-name");
  }

  test("the repositories AI can work in are the list - a OneUptime table, most recently active first - and the one it cannot is folded apart", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepositories(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Repositories",
    );
    await expect(names(connectedCard(page))).toHaveText([
      "checkout-api",
      "storefront-web",
    ]);
    // No "Not connected" among them.
    await expect(connectedCard(page)).not.toContainText("Not connected");

    if (!isPhone(testInfo)) {
      // The table's own header row, as every list in OneUptime has.
      await expect(connectedCard(page).getByRole("columnheader")).toHaveText([
        "Repository",
        "Tasks",
        "Last Activity",
      ]);
      await expect(connectedCard(page)).toContainText(
        "Open a repository to ask AI to work in it, read its tasks or change its settings.",
      );
      await expect(connectedCard(page)).toContainText("acme/checkout-api");
    }

    const checkout: Locator = connectedCard(page)
      .getByTestId("code-repository-row")
      .first();
    await expect(checkout.getByTestId("code-repository-working")).toHaveText(
      "1 working",
    );
    await expect(checkout.getByTestId("code-repository-waiting")).toHaveText(
      "1 waiting for you",
    );
    await expect(checkout.getByTestId("code-repository-task-count")).toHaveText(
      "6 tasks",
    );
    await expect(
      checkout.getByTestId("code-repository-pull-requests"),
    ).toHaveText("1 open pull request");
    await expect(connectedCard(page)).toContainText(
      "Showing 1-2 of 2 repositories",
    );

    // The one GitHub does not reach: folded below, counted.
    const header: Locator = notConnected(page).getByRole("button", {
      name: "Not connected",
    });
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(notConnected(page)).toContainText("1 repository");
    await expect(notConnected(page)).toContainText(
      "GitHub does not give OneUptime access to these repositories any more, so AI cannot work in them.",
    );
    // It sits below the list, never among its rows.
    const cardBox: { y: number; height: number } | null =
      await connectedCard(page).boundingBox();
    const foldBox: { y: number } | null =
      await notConnected(page).boundingBox();
    expect(foldBox!.y).toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height);

    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repositories");

    await openNotConnected(page);
    await expect(names(notConnected(page))).toHaveText(["payments-worker"]);
    await expect(page.getByTestId("code-not-connected-explanation")).toHaveText(
      "Their tasks stay readable. Connect GitHub with access to them to use them again, or open one to delete it.",
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repositories-not-connected-open");

    // A click on the name opens the repository.
    await connectedCard(page)
      .getByTestId("code-repository-name")
      .first()
      .click();
    await expect(page).toHaveURL(repositoryPath(REPOSITORY.checkout));
    await expect(page.getByTestId("code-ask")).toBeVisible();
  });

  test("a click anywhere on a row opens its repository, as every table's rows do", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepositories(page);

    await connectedCard(page)
      .getByTestId("code-repository-row")
      .nth(1)
      .getByTestId("code-repository-task-count")
      .click();
    await expect(page).toHaveURL(repositoryPath(REPOSITORY.web));
  });

  test("the maintainer's project: the one connected repository is the list, the fourteen others folded and paged", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepositories(page, "repos=stale");

    await expect(names(connectedCard(page))).toHaveText(["oneuptime"]);
    await expect(notConnected(page)).toContainText("14 repositories");
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repositories-stale");

    await openNotConnected(page);
    await expect(names(notConnected(page))).toHaveCount(10);
    await expect(names(notConnected(page)).first()).toHaveText("ads");
    await expect(notConnected(page)).toContainText(
      "Showing 1-10 of 14 repositories",
    );
    await notConnected(page).getByTestId("pagination-next-button").click();
    await expect(names(notConnected(page))).toHaveText([
      "marketing-site",
      "mobile",
      "status-page-templates",
      "terraform-provider",
    ]);
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repositories-stale-open");
  });

  test("in German, a repository keeps its whole name and the list reads in German", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepositories(page, "lang=de");

    const name: Locator = names(connectedCard(page)).first();
    await expect(name).toHaveText("checkout-api");
    expect(
      await name.evaluate((element: Element): boolean => {
        return element.scrollWidth <= element.clientWidth;
      }),
    ).toBe(true);
    await expect(notConnected(page)).toContainText("Nicht verbunden");
    await expect(
      connectedCard(page).getByTestId("code-repository-task-count").first(),
    ).toHaveText("6 Aufgaben");
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repositories-german");
  });

  test("Connect repositories, the list's main button, starts GitHub's install", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepositories(page);

    await connectedCard(page)
      .getByRole("button", { name: "Connect repositories" })
      .click();
    await expect
      .poll(async () => {
        return (await recorded(page)).navigations;
      })
      .toEqual([
        "https://github.com/apps/oneuptime-app/installations/new?state=fixture",
      ]);
  });

  test("the folded list's Connect GitHub starts GitHub's install too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepositories(page);
    await openNotConnected(page);

    await page
      .getByTestId("code-not-connected-reconnect")
      .getByRole("button", { name: "Connect GitHub" })
      .click();
    await expect
      .poll(async () => {
        return (await recorded(page)).navigations;
      })
      .toEqual([
        "https://github.com/apps/oneuptime-app/installations/new?state=fixture",
      ]);
  });

  test("with many repositories, a search finds one by name - and says when only a folded one matches", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepositories(page, "repos=many");

    await expect(names(connectedCard(page))).toHaveCount(7);
    await page.getByTestId("code-repository-search-slot").click();
    const search: Locator = page.getByTestId("code-repository-search");
    await expect(search).toBeFocused();
    await search.fill("index");
    await expect(names(connectedCard(page))).toHaveText(["search-indexer"]);

    await search.fill("payments");
    await expect(names(connectedCard(page))).toHaveCount(0);
    const empty: Locator = page.getByTestId("code-repository-search-empty");
    await expect(empty).toContainText("No repository matches your search");
    await expect(empty).toContainText(
      "1 repository that is not connected matches it, below.",
    );
    await expect(notConnected(page)).toContainText("1 repository");

    await empty.getByRole("button", { name: "Clear Search" }).click();
    await expect(names(connectedCard(page))).toHaveCount(7);
  });

  test("GitHub reaches none of them: the list says so, with Connect GitHub - once", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openRepositories(page, "connected=none");

    const empty: Locator = page.getByTestId("code-github-disconnected");
    await expect(empty).toContainText("No connected repositories");
    await expect(empty).toContainText(
      "GitHub is not connected to this project, so AI cannot work in these repositories.",
    );
    await expect(names(connectedCard(page))).toHaveCount(0);
    // One way to connect: no second button in the list's header.
    await expect(
      connectedCard(page).getByRole("button", { name: "Connect repositories" }),
    ).toHaveCount(0);
    await expect(notConnected(page)).toContainText("3 repositories");
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repositories-disconnected");

    await empty.getByTestId("code-github-reconnect").click();
    await expect
      .poll(async () => {
        return (await recorded(page)).navigations;
      })
      .toEqual([
        "https://github.com/apps/oneuptime-app/installations/new?state=fixture",
      ]);
  });
});

/*
 * The maintainer (2026-10-21): "This toggle should be turned on by default"
 * - Respond to GitHub Commands - and of the dialog's Build & Test step: "We
 * don't need this step at all because repos have an agents.md file in
 * them". A repository's settings are cards now, its GitHub commands one
 * switch, and what most people never change folded under More settings.
 */
test.describe("a repository's settings", () => {
  const SETTINGS: string = `${repositoryPath(REPOSITORY.checkout)}/settings`;

  function commandsSwitch(page: Page): Locator {
    return page.getByRole("switch", { name: "Respond to GitHub Commands" });
  }

  function moreSettings(page: Page): Locator {
    return page.getByTestId("code-repository-more-settings");
  }

  async function openMoreSettings(page: Page): Promise<void> {
    await moreSettings(page)
      .getByRole("button", { name: "More settings" })
      .click();
    await expect(
      moreSettings(page).getByRole("button", { name: "More settings" }),
    ).toHaveAttribute("aria-expanded", "true");
  }

  test("cards, not a four-step dialog: GitHub Commands is on, and a flip saves at once", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(SETTINGS);

    await expect(commandsSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("button", { name: "Edit Settings" }),
    ).toHaveCount(0);
    await expect(page.getByText("Build & Test")).toHaveCount(0);
    await expect(
      moreSettings(page).getByRole("button", { name: "More settings" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repository-settings");

    await commandsSwitch(page).click();
    await expect
      .poll(async () => {
        return (await recorded(page)).settings;
      })
      .toEqual([{ isGitHubCommandsEnabled: false }]);
    await expect(commandsSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });

  test("a repository that never set it reads as on, and one turned off as off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${SETTINGS}?ghcommands=unset`);
    await expect(commandsSwitch(page)).toHaveAttribute("aria-checked", "true");

    await page.goto(`${SETTINGS}?ghcommands=off`);
    await expect(commandsSwitch(page)).toHaveAttribute("aria-checked", "false");
  });

  test("More settings: where pull requests open and how many, and the trigger label - each with its Edit, on one page", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(SETTINGS);
    await expect(moreSettings(page)).toContainText("Pull Requests");
    await expect(moreSettings(page)).toContainText("GitHub Trigger Label");

    await openMoreSettings(page);
    await screenshot(page, testInfo, "code-repository-more-settings");

    const pullRequests: Locator = page.getByTestId("card").filter({
      has: page
        .getByTestId("card-details-heading")
        .getByText("Pull Requests", { exact: true }),
    });
    await pullRequests.getByRole("button", { name: "Edit" }).click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible();
    // One page: no steps, the action right there.
    await expect(
      modal.getByRole("navigation", { name: "Progress" }),
    ).toHaveCount(0);
    await modal.getByText("A limit", { exact: true }).click();
    await modal.getByPlaceholder("3").fill("2");
    await modal.getByTestId("modal-footer-submit-button").click();
    await expect(modal).toBeHidden();
    await expect
      .poll(async () => {
        return (await recorded(page)).settings.at(-1);
      })
      .toMatchObject({ maxOpenFixPullRequests: 2 });
    await expect(pullRequests).toContainText("Up to 2 open at once");
  });

  test("build and test commands an operator set are shown read-only, and Remove Commands asks first, then clears all three", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${SETTINGS}?commands=1`);
    // Folded, More settings says they are there.
    await expect(moreSettings(page)).toContainText(
      "Build and Test Commands: Configured",
    );

    await openMoreSettings(page);
    const commands: Locator = page.getByTestId("code-repository-commands");
    await expect(commands).toContainText("npm ci");
    await expect(commands).toContainText("npm run build");
    await expect(commands).toContainText("npm test");
    await expect(commands.getByRole("textbox")).toHaveCount(0);
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repository-commands");

    await page.getByRole("button", { name: "Remove Commands" }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toContainText("Remove these commands?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await recorded(page)).settings).toEqual([]);

    await page.getByRole("button", { name: "Remove Commands" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove Commands" })
      .click();
    await expect
      .poll(async () => {
        return (await recorded(page)).settings;
      })
      .toEqual([{ setupCommand: null, buildCommand: null, testCommand: null }]);
    await expect(page.getByTestId("code-repository-commands")).toHaveCount(0);
  });

  test("a repository with no commands shows nothing of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(SETTINGS);
    await openMoreSettings(page);
    await expect(page.getByTestId("code-repository-commands")).toHaveCount(0);
    await expect(page.getByText("Build and Test Commands")).toHaveCount(0);
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
    // A task that asks something of someone says so in words, in its line.
    await expect(rows.nth(2).getByTestId("code-task-row-state")).toHaveText(
      "Waiting for you",
    );

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

    // One state mark per row, at its start, on a laptop and a phone alike.
    for (let index: number = 0; index < 6; index++) {
      await expect(
        rows.nth(index).locator("[data-testid='code-task-state']:visible"),
      ).toHaveCount(1);
    }
    // Done is said by its mark alone; how much it changed ends the row.
    await expect(rows.nth(1).getByTestId("code-task-row-state")).toHaveCount(0);
    await expect(rows.nth(1).getByTestId("code-task-row-changes")).toHaveText(
      "+27−1",
    );
    // A repository's own list names no repository: they are all its.
    await expect(
      rows.nth(1).getByTestId("code-task-row-repository"),
    ).toHaveCount(0);
    // The facts read apart, a dot between each.
    await expect(
      rows
        .nth(1)
        .getByTestId("code-task-row-meta")
        .getByTestId("code-meta-dot"),
    ).toHaveCount(2);

    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repository");

    await rows.nth(1).getByRole("link").click();
    await expect(page).toHaveURL(taskPath(TASK.retries));
  });

  /*
   * The UI review: Repositories became a page, and a repository's trail -
   * Project > Code > Repository > Settings - sent its "Repository" crumb to
   * that list, unnamed. The trail now runs through Repositories, each
   * crumb opening the page above.
   */
  test("a repository's trail runs through Repositories and names the repository", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${repositoryPath(REPOSITORY.checkout)}/settings`);

    const trail: Locator = page.locator("nav[aria-label='Breadcrumb']");
    const crumbs: Locator = trail.locator("li.breadcrumb-item");
    await expect(crumbs).toHaveText([
      "Project",
      "Code",
      "Repositories",
      "checkout-api",
      "Settings",
    ]);

    await trail.getByRole("link", { name: "checkout-api" }).click();
    await expect(page).toHaveURL(repositoryPath(REPOSITORY.checkout));
    await expect(crumbs).toHaveText([
      "Project",
      "Code",
      "Repositories",
      "checkout-api",
    ]);

    await trail.getByRole("link", { name: "Repositories" }).click();
    await expect(page).toHaveURL(`${CODE}/repositories`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Repositories",
    );
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
    /*
     * The UI review: the list was placed while the dialog scaled in (or
     * before its width was styled) and ran out past it. It lies under its
     * field, as wide as the field, once the dialog has opened.
     */
    await expect(page.getByTestId("entity-dropdown-menu")).toBeVisible();
    await expect
      .poll(async (): Promise<number> => {
        const field: { x: number; width: number } | null = await page
          .getByTestId("code-context-record")
          .evaluate((element: Element): { x: number; width: number } => {
            const box: DOMRect =
              element.parentElement!.parentElement!.getBoundingClientRect();
            return { x: box.x, width: box.width };
          });
        const list: { x: number; width: number } | null = await page
          .getByTestId("entity-dropdown-menu")
          .boundingBox();
        return Math.max(
          Math.abs(field!.x - list!.x),
          Math.abs(field!.width - list!.width),
        );
      })
      .toBeLessThan(3);
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

  const SETTINGS_OF_CHECKOUT: string = `${repositoryPath(REPOSITORY.checkout)}/settings`;

  const BLOCKERS: Array<{
    type: string;
    sentence: string;
    fix?: string;
    // Where the fix leads, when it is the repository's own settings.
    href?: string;
  }> = [
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
      sentence:
        "No global Runner is online to work in this repository. Pick one of your Runners for it, or try again once the global Runner is back.",
      fix: "Pick a Runner",
      href: SETTINGS_OF_CHECKOUT,
    },
    {
      type: "RunnerNotOnline",
      // The server names the Runner the repository picks.
      sentence:
        "The Runner this repository picks, prod-eu-west-1, is not online. Check that its container is running, or pick another Runner.",
      fix: "Pick a Runner",
      href: SETTINGS_OF_CHECKOUT,
    },
    {
      type: "GlobalRunnersOff",
      sentence:
        "This project does not use global Runners, so this repository needs one of your Runners.",
      fix: "Pick a Runner",
      href: SETTINGS_OF_CHECKOUT,
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
        if (blocker.href) {
          await expect(notice.getByTestId("code-blocker-fix")).toHaveAttribute(
            "href",
            blocker.href,
          );
        }
        // Never the switch Runners no longer have.
        await expect(notice).not.toContainText("Code Fixes");
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

  test("on the Free plan, the plan is said once - in the request box, with Upgrade the plan", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // What it checks does not depend on the screen's width.
    test.skip(isPhone(testInfo), "width-independent");
    await openRepository(page, REPOSITORY.checkout, "plan=free");

    const notice: Locator = page.getByTestId("code-blocker");
    await expect(notice).toHaveAttribute("data-blocker", "PlanRequired");
    await expect(notice.getByTestId("code-blocker-fix")).toHaveText(
      "Upgrade the plan",
    );
    // No plan banner above it saying the same again.
    await expect(page.getByText("AI requires the Growth plan")).toHaveCount(0);
    await expect(composerInput(page)).toBeDisabled();
  });

  test("a member who may ask AI but not turn it on is told who can, not sent to a switch they cannot flip", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // What it checks does not depend on the screen's width.
    test.skip(isPhone(testInfo), "width-independent");
    await openRepository(
      page,
      REPOSITORY.checkout,
      "blocker=AiDisabled&role=member",
    );

    const notice: Locator = page.getByTestId("code-blocker");
    await expect(notice).toContainText("AI is turned off for this project.");
    await expect(notice.getByTestId("code-blocker-fix")).toHaveCount(0);
    await expect(notice.getByTestId("code-blocker-who-can")).toHaveText(
      "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI → AI Features.",
    );
    // A box that cannot send says nothing about how to send.
    await expect(page.getByTestId("code-composer-keys")).toHaveCount(0);
  });

  test("a repository the GitHub App cannot reach says so, and links Connect GitHub on Repositories", async ({
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
    await expect(page).toHaveURL(`${CODE}/repositories`);
    // Connect repositories: the list header's main button.
    await expect(
      page
        .getByTestId("code-repositories-toolbar")
        .getByRole("button", { name: "Connect repositories" }),
    ).toBeVisible();
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

/*
 * The maintainer's ask: "in the Code Repo section, we should be able to
 * select a runner to run from (if not selected, it will run on global
 * runner)." A repository's settings pick the Runner AI works in it on: the
 * one Runner picker, Global Runner first - and what a repository that
 * picked none shows - then the project's own Runners, never the in-cluster
 * Runner the Kubernetes agent chart installed. The fixture records what
 * the settings save.
 */
test.describe("a repository's Runner", () => {
  const SETTINGS: string = `${repositoryPath(REPOSITORY.checkout)}/settings`;

  // The Runner card of the repository's settings.
  function settingsCard(page: Page): Locator {
    return page.getByTestId("card").filter({
      has: page
        .getByTestId("card-details-heading")
        .getByText("Runner", { exact: true }),
    });
  }

  function runnerPicker(page: Page): Locator {
    return page.getByTestId("code-repository-runner-picker");
  }

  /*
   * Opens the Runner card's Edit: one field on one page - the dialog's four
   * steps (Pull Requests, GitHub Commands, Runner, Build & Test) are gone.
   */
  async function openRunnerStep(page: Page): Promise<Locator> {
    await settingsCard(page).getByRole("button", { name: "Edit" }).click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible();
    await expect(runnerPicker(page)).toBeVisible();
    await expect(
      modal.getByRole("button", { name: "Next", exact: true }),
    ).toHaveCount(0);
    return modal;
  }

  /*
   * The card's Runner: its name, and how it is doing as the Runners page
   * draws it - a status dot read out as "Status: Connected".
   */
  async function expectRunnerValue(
    page: Page,
    name: string,
    status: string,
  ): Promise<Locator> {
    const value: Locator = page.getByTestId("code-repository-runner");
    await expect(value).toContainText(name);
    await expect(value.getByRole("status")).toHaveAttribute(
      "aria-label",
      `Status: ${status}`,
    );
    return value;
  }

  async function save(
    page: Page,
    modal: Locator,
  ): Promise<Record<string, unknown>> {
    const before: number = (await recorded(page)).settings.length;
    // One page: its Save Changes saves.
    await modal.getByTestId("modal-footer-submit-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).settings.length;
      })
      .toBe(before + 1);
    await expect(modal).toBeHidden();
    const settings: Array<Record<string, unknown>> = (await recorded(page))
      .settings;
    return settings[settings.length - 1]!;
  }

  test("the settings say where AI works: Global Runner, with how it is doing", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(SETTINGS);

    const value: Locator = await expectRunnerValue(
      page,
      "Global Runner",
      "Connected",
    );
    // Global Runner is no page of the project's to link to.
    await expect(value.getByRole("link")).toHaveCount(0);
    // It runs no command: AI's change is not built or tested before the PR.
    await expect(value.getByTestId("code-repository-runner-skips")).toHaveText(
      "Run by OneUptime for every project. It does not build or test AI's change before the pull request opens.",
    );
    await expect(settingsCard(page)).toContainText(
      "Where AI works in this repository.",
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-repository-runner-global");
  });

  test("the Runner card's Edit offers Global Runner first, then the project's own Runners - never the Kubernetes agent's - and saves the one picked", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(SETTINGS);
    const modal: Locator = await openRunnerStep(page);

    /*
     * A field like any other: the form's title and its description above
     * the menu, which the title names, and no "(Optional)" - empty is
     * Global Runner, an answer of its own.
     */
    await expect(modal).toContainText("Where AI works in this repository.");
    await expect(modal).not.toContainText("(Optional)");
    await expect(runnerPicker(page).locator("label")).toHaveCount(0);
    await expect(runnerPicker(page).getByRole("combobox")).toHaveAccessibleName(
      "Runner",
    );
    await expect(runnerPicker(page)).toContainText("Global Runner · Connected");
    await expect(
      page.getByTestId("code-repository-runner-picker-help"),
    ).toHaveText(
      "AI works on a Runner OneUptime runs for every project, which does not build or test its change: your repository's own CI does. Pick one of your Runners to have AI build and test it first.",
    );

    await runnerPicker(page).getByRole("combobox").click();
    const options: Locator = page.getByRole("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText("Global Runner · Connected");
    await expect(options.nth(0)).toContainText(
      "Run by OneUptime for every project. It does not build or test AI's change before the pull request opens.",
    );
    await expect(options.nth(1)).toHaveText("office-runner · Disconnected");
    await expect(options.nth(2)).toHaveText("prod-eu-west-1 · Connected");
    await expect(page.getByText("kubernetes-agent/prod-us")).toHaveCount(0);
    await screenshot(page, testInfo, "code-repository-runner-picker");

    await options.nth(2).click();
    await expect(runnerPicker(page)).toContainText(
      "prod-eu-west-1 · Connected",
    );
    await expect(
      page.getByTestId("code-repository-runner-picker-help"),
    ).toHaveText(
      "AI clones the repository on this Runner, builds and tests its change there the way the repository's AGENTS.md says, and opens the pull request.",
    );

    const saved: Record<string, unknown> = await save(page, modal);
    expect(saved["runnerId"]).toBe(RUNNER.prod);

    // The card names it, linked to its page, with how it is doing.
    const value: Locator = await expectRunnerValue(
      page,
      "prod-eu-west-1",
      "Connected",
    );
    await expect(value.getByRole("link")).toHaveText("prod-eu-west-1");
    // Its own Runner builds and tests: nothing is said about not doing so.
    await expect(value.getByTestId("code-repository-runner-skips")).toHaveCount(
      0,
    );
    await expect(value.getByRole("link")).toHaveAttribute(
      "href",
      `${DASHBOARD}/runbooks/runners/${RUNNER.prod}`,
    );
  });

  test("picking Global Runner again saves no Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${SETTINGS}?runner=prod`);
    await expectRunnerValue(page, "prod-eu-west-1", "Connected");

    const modal: Locator = await openRunnerStep(page);
    await expect(runnerPicker(page)).toContainText(
      "prod-eu-west-1 · Connected",
    );
    await runnerPicker(page).getByRole("combobox").click();
    await page.getByRole("option").filter({ hasText: "Global Runner" }).click();

    const saved: Record<string, unknown> = await save(page, modal);
    expect(saved["runnerId"]).toBeNull();
    await expectRunnerValue(page, "Global Runner", "Connected");
  });

  test("a project that turned global Runners off says so, and its picker asks for one of the project's own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${SETTINGS}?uses=0`);
    await expect(page.getByTestId("code-repository-runner")).toHaveText(
      "None: this project does not use global Runners",
    );

    await openRunnerStep(page);
    await expect(
      page.getByTestId("code-repository-runner-picker-help"),
    ).toHaveText(
      "This project does not use global Runners: pick one of your Runners for this repository.",
    );
    await runnerPicker(page).getByRole("combobox").click();
    await expect(page.getByRole("option")).toHaveText([
      "office-runner · Disconnected",
      "prod-eu-west-1 · Connected",
    ]);
  });

  test("a server with no global Runner, and a pick the reader is not shown, are said as they are", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${SETTINGS}?global=0`);
    await expect(page.getByTestId("code-repository-runner")).toHaveText(
      "None: this server runs no global Runner",
    );
    // Nothing is picked: the field says what to do, not what a pick does.
    await openRunnerStep(page);
    await expect(
      page.getByTestId("code-repository-runner-picker-help"),
    ).toHaveText(
      "This server runs no global Runner: pick one of your Runners for this repository.",
    );

    /*
     * A repository can only pick one of its project's Runners, and a
     * deleted one leaves it on Global Runner: one the page cannot name is
     * one the reader may not see - never an id, never a warning.
     */
    await page.goto(`${SETTINGS}?runner=gone`);
    await expect(page.getByTestId("code-repository-runner")).toHaveText(
      "A Runner you do not have access to",
    );
    await openRunnerStep(page);
    await expect(runnerPicker(page)).toContainText(
      "A Runner you do not have access to",
    );
    await expect(runnerPicker(page)).not.toContainText("60000000-");
    await expect(
      page.getByTestId("code-repository-runner-picker-help"),
    ).toHaveText(
      "This repository picks a Runner you do not have access to. Pick another Runner to change it.",
    );
  });

  test("a global Runner that is not heard from: the picker says AI waits for one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${SETTINGS}?gstatus=disconnected`);
    await expectRunnerValue(page, "Global Runner", "Disconnected");

    await openRunnerStep(page);
    await expect(
      page.getByTestId("code-repository-runner-picker-global-waiting"),
    ).toHaveText(
      "No global Runner is connected right now, so AI cannot work in this repository until one is.",
    );
  });

  test("a blocker's Pick a Runner opens the repository's settings, where its Runner is picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRepository(
      page,
      REPOSITORY.checkout,
      "blocker=RunnerNotOnline&runner=prod",
    );

    await page.getByTestId("code-blocker-fix").click();
    await expect(page).toHaveURL(SETTINGS);
    await expect(page.getByTestId("code-repository-runner")).toBeVisible();
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
    /*
     * Live steps are open, without a fold to click, and end where the next
     * one will appear; the page shows one spinner, there.
     */
    await expect(page.getByTestId("code-task-steps-toggle")).toHaveCount(0);
    await expect(page.getByTestId("code-task-steps-working")).toHaveText(
      "Working on it…",
    );
    await expect(page.getByTestId("code-turn-working")).toHaveCount(0);
    await expect(
      page
        .getByTestId("code-task-working-footer")
        .locator("[class*='animate-spin']"),
    ).toHaveCount(0);
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
    await expect(failed).toContainText("AI could not finish.");
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
    // Its kind is said once, at the top.
    await expect(page.getByTestId("code-task-header")).toContainText(
      "Fix Exception",
    );
    await expect(origin).not.toContainText("Fix Exception");
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
    // The top says it too, and a reply goes to a new pull request.
    await expect(page.getByTestId("code-task-pull-request-state")).toHaveText(
      "Merged",
    );
    await expect(page.getByTestId("code-task-composer-footer")).toHaveText(
      "AI works on a new branch and opens a pull request for you to review when it changes code. Nothing is merged on its own.",
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
    // The trail names the repository and the task, as the conversation's does.
    const trail: Locator = page.locator("nav[aria-label='Breadcrumb']");
    await expect(trail).toContainText("checkout-api");
    await expect(trail).toContainText("Task #12");
    await expect(trail).toContainText("Log");

    await page.getByTestId("code-task-log-back").click();
    await expect(page).toHaveURL(taskPath(TASK.retries));
    await expect(page.getByTestId("code-task-turns")).toBeVisible();
  });

  test("its header says where it works - its repository, the branch it works from - how much it changed, and opens its pull request", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openTask(page, TASK.retries);

    const facts: Locator = page.getByTestId("code-task-facts");
    await expect(facts.getByTestId("code-task-repository")).toHaveText(
      "acme/checkout-api",
    );
    await expect(facts.getByTestId("code-task-branch")).toHaveText("main");
    await expect(facts.getByTestId("code-task-changes-stat")).toHaveText(
      "+27−1",
    );
    const pullRequest: Locator = page.getByTestId("code-task-pull-request");
    await expect(pullRequest).toHaveText("Pull request #418");
    await expect(pullRequest).toHaveAttribute(
      "href",
      "https://github.com/acme/checkout-api/pull/418",
    );
    await expect(pullRequest).toHaveAttribute("target", "_blank");

    // The person's message on the right, as a chat draws what was sent.
    const message: { x: number; width: number } | null = await page
      .getByTestId("code-turn-request-message")
      .first()
      .boundingBox();
    const turns: { x: number; width: number } | null = await page
      .getByTestId("code-task-turns")
      .boundingBox();
    expect(
      Math.abs(message!.x + message!.width - (turns!.x + turns!.width)),
    ).toBeLessThanOrEqual(1);
    expect(message!.x).toBeGreaterThan(turns!.x);

    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, "code-task-header");
  });

  test("the reply box stays at the bottom of the window while the conversation scrolls", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openTask(page, TASK.retries);
    const height: number = isPhone(testInfo) ? 844 : 900;

    await page.evaluate((): void => {
      window.scrollTo(0, 0);
    });
    const footer: Locator = page.getByTestId("code-task-footer");
    const atTop: { y: number; height: number } | null =
      await footer.boundingBox();
    // Held at the window's bottom edge before the conversation has ended.
    expect(Math.round(atTop!.y + atTop!.height)).toBeLessThanOrEqual(height);
    expect(atTop!.y + atTop!.height).toBeGreaterThan(height - 2);
    await expect(composerInput(page)).toBeInViewport();

    // Its ground is the page's: nothing of the turns shows through it.
    const ground: string = await footer.evaluate((element: Element): string => {
      return window.getComputedStyle(element).backgroundColor;
    });
    expect(ground).not.toBe("rgba(0, 0, 0, 0)");

    await page.screenshot({
      path: path.join(
        SCREENSHOTS,
        `code-task-reply-held-${testInfo.project.name}.png`,
      ),
      animations: "disabled",
    });
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
    // The list of repositories it was: now Code's Repositories.
    { from: `${DASHBOARD}/code-repository`, to: `${CODE}/repositories` },
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
    await expect(page).toHaveURL(`${CODE}/repositories`);
    await expect(page.getByTestId("code-repository-row").first()).toBeVisible();
  });

  test("GitHub's way back to Code itself says GitHub connected, over the request box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CODE}?installation_id=51234567`);
    await expect(page.getByTestId("github-connected-notice")).toContainText(
      "Pick one to ask AI to work in it.",
    );
    // The address is cleaned: a refresh does not say it again.
    await expect(page).toHaveURL(CODE);
    await expect(page.getByTestId("code-ask")).toBeVisible();
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
  test("dark mode: the request box, the task list, the repositories and the conversation draw on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openCode(page, "theme=dark");
    await expect(page.getByTestId("code-task-row").first()).toBeVisible();
    await screenshot(page, testInfo, "code-home-dark");

    // Nothing of Code draws a light ground on the dark page.
    const lightSurfaces: () => Promise<Array<string>> = async (): Promise<
      Array<string>
    > => {
      return await page.evaluate((channelPattern: string): Array<string> => {
        const found: Array<string> = [];
        for (const element of Array.from(
          document.querySelectorAll(
            "[data-testid='code-composer-box'], [data-testid='code-composer-input'], [data-testid='code-task-row'], [data-testid='code-repository-row'], [data-testid='code-turn-request-message'], [data-testid='code-task-footer']",
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
      }, COLOUR_CHANNELS.source);
    };
    expect(await lightSurfaces()).toEqual([]);

    /*
     * The UI review: Theme.css re-coloured a spinner's track with
     * border-color, which painted its arc too - the Working mark was one
     * colour all round and did not look like it turned. Its arc now keeps a
     * colour of its own.
     */
    const ringColours: (spinner: Locator) => Promise<{
      top: string;
      left: string;
    }> = async (spinner: Locator): Promise<{ top: string; left: string }> => {
      return await spinner.evaluate(
        (element: Element): { top: string; left: string } => {
          const style: CSSStyleDeclaration = window.getComputedStyle(element);
          return { top: style.borderTopColor, left: style.borderLeftColor };
        },
      );
    };
    const workingMark: { top: string; left: string } = await ringColours(
      page
        .getByTestId("code-task-row")
        .first()
        .getByTestId("code-task-state")
        .locator("span")
        .first(),
    );
    expect(workingMark.top).not.toBe(workingMark.left);

    await openTask(page, TASK.working, "theme=dark");
    const liveStep: { top: string; left: string } = await ringColours(
      page.getByTestId("code-task-steps-working").locator("span").first(),
    );
    expect(liveStep.top).not.toBe(liveStep.left);

    await page.goto(`${CODE}/repositories?theme=dark`);
    await expect(page.getByTestId("code-repository-row").first()).toBeVisible();
    expect(await lightSurfaces()).toEqual([]);
    await screenshot(page, testInfo, "code-repositories-dark");

    await openTask(page, TASK.retries, "theme=dark");
    expect(await lightSurfaces()).toEqual([]);
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
    // Code's first page asks its question in German.
    await openCode(page, "lang=de");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Was soll die KI tun?",
    );
    await expect(page.getByTestId("code-branch-picker-button")).toHaveAttribute(
      "aria-label",
      "Branch: main",
    );

    await openRepository(page, REPOSITORY.checkout, "lang=de");
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
        .getByTestId("code-task-row-state"),
    ).toHaveText("Wird bearbeitet…");
    await expect(
      page.getByTestId("code-task-row").first().getByTestId("code-task-state"),
    ).toHaveAttribute("aria-label", "Wird bearbeitet…");
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
    // A summary that wraps on a phone reads on from the left, not centred.
    expect(
      await page
        .getByTestId("code-task-steps-toggle")
        .first()
        .evaluate((element: Element): string => {
          return window.getComputedStyle(element).textAlign;
        }),
    ).toBe("left");
    await expect(
      page.getByTestId("code-turn-pull-request").first(),
    ).toContainText("Pull Request #418 geöffnet");
    // How long AI worked, German unit and all.
    await expect(page.getByTestId("code-turn-duration").first()).toHaveText(
      "8 Minuten gearbeitet",
    );
  });
});
