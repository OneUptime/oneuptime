import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * BULK RUNS THROUGH THE SHARED RUNNER AND ITS PROGRESS DIALOG, IN A BROWSER
 * (fu-bulk-actions).
 *
 * The Admin Dashboard's Users list ran Require Two Factor Auth and Add to
 * Project in loops of their own, one user at a time and with no Stop, and a
 * status page's Add in Bulk added its pasted addresses one at a time behind
 * a dialog of its own. They now run through runBulkAction and the dialog
 * every bulk action shows: two-factor several users at once, Add to
 * Project one at a time (each membership counts the project's seats), Add
 * in Bulk several addresses at once - each with the count going down, Stop,
 * and a result that names every user or address the server refused, in its
 * words, and every line that was skipped, with why.
 *
 * Against the offline fixture (BulkActions/Fixture): ?hold=1 keeps every
 * request waiting until the test lets it through, so a run is seen while it
 * goes on, and the fixture records each request and the most in flight at
 * once. Laptop (1280) and phone (390) widths, light and dark, German, and
 * Persian read right to left.
 */

const PROJECT: string = "/dashboard/10000000-0000-4000-8000-000000000001";
const USERS: string = "/admin/users?page=users";
const SUBSCRIBERS: string = `${PROJECT}/status-pages/30000000-0000-4000-8000-000000000001/email-subscribers?page=subscribers`;

const PAYMENTS: string = "90000000-0000-4000-8000-000000000001";
const PAYMENTS_MEMBERS: string = "91000000-0000-4000-8000-000000000001";
const STATUS_PAGE: string = "30000000-0000-4000-8000-000000000001";
const DASHBOARD_PROJECT: string = "10000000-0000-4000-8000-000000000001";

const USER_IDS: Record<string, string> = {
  "Ada Lovelace": "81000000-0000-4000-8000-000000000001",
  "Grace Hopper": "81000000-0000-4000-8000-000000000002",
  "Alan Turing": "81000000-0000-4000-8000-000000000003",
  "Katherine Johnson": "81000000-0000-4000-8000-000000000004",
  "Edsger Dijkstra": "81000000-0000-4000-8000-000000000005",
  "Barbara Liskov": "81000000-0000-4000-8000-000000000006",
  "Donald Knuth": "81000000-0000-4000-8000-000000000007",
  "Margaret Hamilton": "81000000-0000-4000-8000-000000000008",
};

const EVERYONE: Array<string> = Object.keys(USER_IDS);

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/bulk-actions-ui",
);

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/AdminDashboard/src/Locales",
);

const PHONE: { width: number; height: number } = { width: 390, height: 844 };

interface Post {
  userId: string;
  data: { isRequired?: boolean };
}

interface Create {
  tableName: string;
  data: Record<string, unknown>;
}

interface FixtureState {
  posts: Array<Post>;
  creates: Array<Create>;
  highWater: { creates: number; posts: number };
  held: number;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // A run that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
}

// A Dashboard sentence in the reader's language, as the page draws it.
function dashboardWords(language: string, english: string): string {
  if (language === "en") {
    return english;
  }

  const words: unknown = readJson(
    path.join(DASHBOARD_LOCALES, `${language}.json`),
  )[english];

  return typeof words === "string" ? words : english;
}

// The Admin Dashboard's words: its own nested keys, or a shared sentence.
function adminWords(language: string, key: string): string {
  const locale: Record<string, unknown> = readJson(
    path.join(ADMIN_LOCALES, `${language}.json`),
  );

  let value: unknown = locale;

  for (const part of key.split(".")) {
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[part]
        : undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  const flat: unknown = locale[key];
  return typeof flat === "string" ? flat : key;
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: false,
    animations: "disabled",
  });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

function footerButton(page: Page): Locator {
  return dialog(page).getByTestId("modal-footer-submit-button");
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return await page.evaluate((): FixtureState => {
    const fixture: {
      posts: Array<Post>;
      creates: Array<Create>;
      highWater: { creates: number; posts: number };
      held: () => number;
    } = (
      window as unknown as {
        __fixture: {
          posts: Array<Post>;
          creates: Array<Create>;
          highWater: { creates: number; posts: number };
          held: () => number;
        };
      }
    ).__fixture;

    return {
      posts: fixture.posts,
      creates: fixture.creates,
      highWater: fixture.highWater,
      held: fixture.held(),
    };
  });
}

// How many requests wait for the test to let them through.
async function heldCount(page: Page): Promise<number> {
  return (await fixtureState(page)).held;
}

async function releaseAll(page: Page): Promise<void> {
  await page.evaluate((): void => {
    (
      window as unknown as { __fixture: { releaseAll: () => void } }
    ).__fixture.releaseAll();
  });
}

/*
 * Lets every held request through, and the next ones as they come, until
 * the run has ended: the result's title is shown.
 */
async function finishRun(page: Page, title: string): Promise<void> {
  await expect(async () => {
    await releaseAll(page);
    await expect(dialog(page).getByText(title, { exact: true })).toBeVisible({
      timeout: 250,
    });
  }).toPass({ timeout: 30000 });
}

async function openUsers(
  page: Page,
  query: string = "",
  language: string = "en",
): Promise<void> {
  await page.goto(
    `${USERS}${query}${language === "en" ? "" : `&lang=${language}`}`,
  );
  await expect(
    page.getByRole("checkbox", { name: /Ada Lovelace$/ }).first(),
  ).toBeVisible();
}

async function selectUsers(page: Page, names: Array<string>): Promise<void> {
  for (const name of names) {
    await page
      .getByRole("checkbox", { name: new RegExp(`: ${name}$`) })
      .first()
      .check();
  }
}

async function chooseBulkAction(
  page: Page,
  action: string,
  language: string = "en",
): Promise<void> {
  await page
    .getByText(adminWords(language, "Bulk Actions"), { exact: true })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

test.describe("the Admin Dashboard's Users list", () => {
  test("Require Two Factor Auth asks first, then works on several users at once, counting down with Stop", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openUsers(page, "&hold=1");
    await selectUsers(page, EVERYONE.slice(0, 6));
    await chooseBulkAction(page, "Require Two Factor Auth");

    await expect(dialog(page)).toContainText(
      "Require Two Factor Auth for 6 User(s)",
    );
    await footerButton(page).click();

    await expect(
      dialog(page).getByText("In Progress", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("progress-bar-count")).toHaveText(
      "0 of 6 Users",
    );
    await expect(footerButton(page)).toHaveText("Stop");
    await expect(footerButton(page)).toBeEnabled();
    await expect(page.getByTestId("bulk-action-note")).toHaveText(
      "Keep this page open until this finishes. You can stop at any time: what is already done stays done.",
    );

    // Four users at once, as Block and Unblock: each request is its own user.
    await expect
      .poll(async () => {
        return await heldCount(page);
      })
      .toBe(4);
    await screenshot(page, "admin-users-two-factor-in-progress");

    await finishRun(page, "Completed");

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "6 Users succeeded",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveCount(0);
    await screenshot(page, "admin-users-two-factor-completed");

    const state: FixtureState = await fixtureState(page);
    expect(
      state.posts
        .map((post: Post): string => {
          return post.userId;
        })
        .sort(),
    ).toEqual(
      EVERYONE.slice(0, 6)
        .map((name: string): string => {
          return USER_IDS[name]!;
        })
        .sort(),
    );
    for (const post of state.posts) {
      expect(post.data).toEqual({ isRequired: true });
    }
    expect(state.highWater.posts).toBe(4);
  });

  test("Do Not Require Two Factor Auth names a user the server refuses, in its words, and does the others", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openUsers(page, `&refuse=${USER_IDS["Grace Hopper"]}`);
    await selectUsers(page, ["Ada Lovelace", "Grace Hopper", "Alan Turing"]);
    await chooseBulkAction(page, "Do Not Require Two Factor Auth");

    await expect(dialog(page)).toContainText(
      "Stop Requiring Two Factor Auth for 3 User(s)",
    );
    await footerButton(page).click();
    await expect(
      dialog(page).getByText("Completed", { exact: true }),
    ).toBeVisible();

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Users succeeded",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 User failed",
    );
    await expect(page.getByTestId("bulk-action-failed-items-group")).toHaveText(
      ["User: Grace HopperUser not found."],
    );

    const state: FixtureState = await fixtureState(page);
    expect(state.posts).toHaveLength(3);
    for (const post of state.posts) {
      expect(post.data).toEqual({ isRequired: false });
    }
  });

  test("Stop starts no more users: the ones started finish, and the rest are counted as never started", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openUsers(page, "&hold=1");
    await selectUsers(page, EVERYONE);
    await chooseBulkAction(page, "Require Two Factor Auth");
    await footerButton(page).click();

    await expect
      .poll(async () => {
        return await heldCount(page);
      })
      .toBe(4);

    await footerButton(page).click();
    await expect(footerButton(page)).toHaveText("Stopping…");
    await expect(footerButton(page)).toBeDisabled();
    await expect(page.getByTestId("bulk-action-note")).toHaveText(
      "Stopping. The ones already started are finishing.",
    );
    await screenshot(page, "admin-users-two-factor-stopping");

    await finishRun(page, "Stopped");

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "4 Users succeeded",
    );
    await expect(page.getByTestId("bulk-action-not-started-count")).toHaveText(
      "4 Users not started: you stopped the action",
    );
    await screenshot(page, "admin-users-two-factor-stopped");

    expect((await fixtureState(page)).posts).toHaveLength(4);
  });

  test("Add to Project adds the users one at a time, to the team picked, and names one already in it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openUsers(page, `&hold=1&refuse=${USER_IDS["Grace Hopper"]}`);
    await selectUsers(page, ["Ada Lovelace", "Grace Hopper", "Alan Turing"]);
    await chooseBulkAction(page, "Add to Project");

    await expect(dialog(page)).toContainText("Add Users to Project");
    await dialog(page).getByRole("combobox").first().click();
    await page.getByText("Payments", { exact: true }).last().click();
    // The team picker starts on the project's members team.
    await expect(dialog(page).getByText("Members").first()).toBeVisible();
    await footerButton(page).click();

    await expect(
      dialog(page).getByText("In Progress", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("progress-bar-count")).toHaveText(
      "0 of 3 Users",
    );
    await expect(footerButton(page)).toHaveText("Stop");

    // One at a time: each membership counts the project's seats.
    await expect
      .poll(async () => {
        return await heldCount(page);
      })
      .toBe(1);
    await screenshot(page, "admin-users-add-to-project-in-progress");

    await finishRun(page, "Completed");

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "2 Users succeeded",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 User failed",
    );
    await expect(page.getByTestId("bulk-action-failed-items-group")).toHaveText(
      ["User: Grace HopperThis user has already been invited to this team."],
    );
    await screenshot(page, "admin-users-add-to-project-completed");

    const state: FixtureState = await fixtureState(page);
    expect(state.highWater.creates).toBe(1);
    expect(state.creates).toEqual(
      ["Ada Lovelace", "Grace Hopper", "Alan Turing"].map(
        (name: string): Create => {
          return {
            tableName: "TeamMember",
            data: {
              teamId: PAYMENTS_MEMBERS,
              projectId: PAYMENTS,
              userId: USER_IDS[name]!,
              hasAcceptedInvitation: false,
            },
          };
        },
      ),
    );
  });

  for (const variant of [
    { name: "phone", theme: "", language: "en" },
    { name: "phone-dark-german", theme: "&theme=dark", language: "de" },
  ]) {
    test(`the progress dialog fits a phone and reads as it should (${variant.name})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(PHONE);
      await openUsers(page, `&hold=1${variant.theme}`, variant.language);
      await selectUsers(page, EVERYONE.slice(0, 5));
      await chooseBulkAction(
        page,
        adminWords(variant.language, "pages.users.bulkRequireTwoFactorAuth"),
        variant.language,
      );
      await footerButton(page).click();

      const inProgress: string = adminWords(variant.language, "In Progress");
      await expect(
        dialog(page).getByText(inProgress, { exact: true }),
      ).toBeVisible();
      await expect(footerButton(page)).toHaveText(
        adminWords(variant.language, "Stop"),
      );
      // The count in the reader's language too: "0 von 5 Benutzer".
      await expect(page.getByTestId("progress-bar-count")).toHaveText(
        adminWords(variant.language, "{{count}} of {{total}} {{suffix}}")
          .replace("{{count}}", "0")
          .replace("{{total}}", "5")
          .replace("{{suffix}}", adminWords(variant.language, "Users")),
      );
      await expect
        .poll(async () => {
          return await heldCount(page);
        })
        .toBe(4);

      await expectNoSidewaysScroll(page, {
        message: `the run in progress, ${variant.name}`,
      });
      await expect(footerButton(page)).toBeInViewport();
      await screenshot(
        page,
        `admin-users-two-factor-in-progress-${variant.name}`,
      );

      await finishRun(page, adminWords(variant.language, "Completed"));

      await expectNoSidewaysScroll(page, {
        message: `the result, ${variant.name}`,
      });
      await expect(footerButton(page)).toBeInViewport();
      await expect(footerButton(page)).toHaveText(
        adminWords(variant.language, "Close"),
      );
      await screenshot(
        page,
        `admin-users-two-factor-completed-${variant.name}`,
      );
    });
  }
});

async function openSubscribers(
  page: Page,
  query: string = "",
  language: string = "en",
): Promise<void> {
  await page.goto(
    `${SUBSCRIBERS}${query}${language === "en" ? "" : `&lang=${language}`}`,
  );
  await expect(page.getByText("ops@example.com").first()).toBeVisible();
}

async function addInBulk(
  page: Page,
  lines: Array<string>,
  language: string = "en",
): Promise<void> {
  await page
    .getByRole("button", { name: dashboardWords(language, "More options") })
    .first()
    .click();
  await page
    .getByRole("menuitem", { name: dashboardWords(language, "Add in Bulk") })
    .click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator("textarea").first().fill(lines.join("\n"));
  await footerButton(page).click();
}

const PASTED: Array<string> = [
  "ada@example.com",
  "Grace@Example.com",
  "not-an-address",
  "alan@example.com",
  "katherine@example.com",
  "edsger@example.com",
  "barbara@example.com",
];

test.describe("Add in Bulk on a status page's Email Subscribers", () => {
  test("adds the pasted addresses several at once in the progress dialog, and lists the line it skipped, with why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSubscribers(page, "&hold=1");
    await addInBulk(page, PASTED);

    await expect(
      dialog(page).getByText("In Progress", { exact: true }),
    ).toBeVisible();
    await expect(footerButton(page)).toHaveText("Stop");
    // Four addresses at once: each subscriber is a row of its own.
    await expect
      .poll(async () => {
        return await heldCount(page);
      })
      .toBe(4);
    // The line that is not an address was never sent: it is counted at once.
    await expect(page.getByTestId("bulk-action-live-unchanged")).toHaveText(
      "1 Subscriber skipped",
    );
    await screenshot(page, "subscribers-add-in-bulk-in-progress");

    await finishRun(page, "Completed");

    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "6 Subscribers added",
    );
    await expect(page.getByTestId("bulk-action-unchanged-count")).toHaveText(
      "1 Subscriber skipped",
    );
    await expect(
      page.getByTestId("bulk-action-unchanged-items-group"),
    ).toHaveText(["not-an-addressEmail is not valid."]);
    await screenshot(page, "subscribers-add-in-bulk-completed");

    const state: FixtureState = await fixtureState(page);
    expect(state.highWater.creates).toBe(4);
    expect(
      state.creates
        .map((create: Create): unknown => {
          return create.data["subscriberEmail"];
        })
        .sort(),
    ).toEqual(
      [
        "ada@example.com",
        // Kept in lower case, as the server keeps an address.
        "grace@example.com",
        "alan@example.com",
        "katherine@example.com",
        "edsger@example.com",
        "barbara@example.com",
      ].sort(),
    );
    for (const create of state.creates) {
      expect(create.tableName).toBe("StatusPageSubscriber");
      expect(create.data["statusPageId"]).toBe(STATUS_PAGE);
      expect(create.data["projectId"]).toBe(DASHBOARD_PROJECT);
      // Subscribe them now, the form's first answer: confirmed, sent nothing.
      expect(create.data["isSubscriptionConfirmed"]).toBe(true);
      expect(create.data["sendYouHaveSubscribedMessage"]).toBe(false);
    }

    // The list is read again: the six new addresses are in it.
    await footerButton(page).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByText("katherine@example.com").first()).toBeVisible();
  });

  test("an address the server refuses is named with its words, and the others are added", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSubscribers(page, "&refuse=grace@example.com");
    await addInBulk(page, ["ada@example.com", "grace@example.com"]);

    await expect(
      dialog(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("bulk-action-succeeded-count")).toHaveText(
      "1 Subscriber added",
    );
    await expect(page.getByTestId("bulk-action-failed-count")).toHaveText(
      "1 Subscriber not added",
    );
    await expect(page.getByTestId("bulk-action-failed-items-group")).toHaveText(
      ["grace@example.comYou are already subscribed to this status page."],
    );
  });

  test("at a phone's width, dark, in Persian read right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(PHONE);
    await openSubscribers(page, "&hold=1&theme=dark", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await addInBulk(page, PASTED, "fa");

    await expect(
      dialog(page).getByText(dashboardWords("fa", "In Progress"), {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        return await heldCount(page);
      })
      .toBe(4);
    await expectNoSidewaysScroll(page, {
      message: "Add in Bulk in progress, a phone, Persian",
    });
    await expect(footerButton(page)).toBeInViewport();
    await screenshot(
      page,
      "subscribers-add-in-bulk-in-progress-phone-dark-persian",
    );

    await finishRun(page, dashboardWords("fa", "Completed"));

    await expectNoSidewaysScroll(page, {
      message: "Add in Bulk's result, a phone, Persian",
    });
    await expect(footerButton(page)).toBeInViewport();
    // The reason a line was skipped, in Persian; the line as it was written.
    await expect(
      page.getByTestId("bulk-action-unchanged-items-group"),
    ).toContainText(dashboardWords("fa", "Email is not valid."));
    await expect(
      page.getByTestId("bulk-action-unchanged-items-group"),
    ).toContainText("not-an-address");
    await screenshot(
      page,
      "subscribers-add-in-bulk-completed-phone-dark-persian",
    );
  });
});
