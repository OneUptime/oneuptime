import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * A step asks for approval before it runs, and every step's options are
 * simpler - in a browser, against the offline fixture (RunbookSteps/Fixture).
 *
 * The maintainer: "Instead of saying 'require approval before running next
 * step,' you can actually say this in the next step, which would say
 * 'require approval before running this step.' Can we please make all the
 * runbook step options simpler, and use the 'More' thing we have on other
 * forms to hide advanced options."
 *
 * So, driven the way a person does: one step of every type on a runbook's
 * Steps page - what each card shows, what its More fields fold (the approval
 * switch first), the header of a step that needs approval, the HTTP method
 * that shows the body, a runbook a client still saves the old way; then a
 * run that waits for approval before a step, approved and skipped, a Manual
 * step, a run started before the change; at a laptop's and a phone's width,
 * in dark mode and in German. The fixture records every save and every step
 * route, so the tests check what was sent as well as what was drawn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const RUNBOOK_ID: string = "20000000-0000-4000-8000-0000000000b1";

const STEPS_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`;
const RUN_PAGE: string = "/?page=execution";

const SWITCH_TITLE: string = "Require approval before running this step";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/runbook-steps-ui",
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

interface SavedStep {
  id: string;
  type: string;
  title: string;
  order: number;
  requireApproval?: boolean;
  requireApprovalBeforeRunning?: boolean;
  config: Record<string, unknown>;
}

interface Recorded {
  updates: Array<{ model: string; id: string; data: Record<string, unknown> }>;
  posts: Array<{ route: string; stepId: string }>;
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
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __fixture: Recorded }).__fixture;
  });
}

async function openSteps(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/?page=steps${query ? `&${query}` : ""}`);
  await expect(page).toHaveURL(new RegExp(STEPS_PAGE));
  await expect(page.getByTestId("runbook-step-header").first()).toBeVisible();
}

async function openRun(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${RUN_PAGE}${query ? `&${query}` : ""}`);
  await expect(
    page.getByRole("heading", { name: "Capture the database's state" }),
  ).toBeVisible();
}

function header(page: Page, title: string): Locator {
  return page.getByTestId("runbook-step-header").filter({ hasText: title });
}

// Opens the step titled `title`; its index on the page is `index`.
async function openStep(page: Page, title: string): Promise<void> {
  const toggle: Locator = header(page, title).getByRole("button", {
    expanded: false,
  });

  if ((await toggle.count()) > 0) {
    await toggle.first().click();
  }
}

function moreFields(page: Page, index: number): Locator {
  return page.getByTestId(`runbook-step-${index}-more-fields`);
}

// The fold's own header: its first button, in any language.
function moreFieldsButton(page: Page, index: number): Locator {
  return moreFields(page, index).getByRole("button").first();
}

async function openMoreFields(page: Page, index: number): Promise<Locator> {
  const button: Locator = moreFieldsButton(page, index);

  if ((await button.getAttribute("aria-expanded")) === "false") {
    await button.click();
  }

  return moreFields(page, index);
}

// The names the folded line lists, in order.
async function foldedLine(fold: Locator): Promise<Array<string>> {
  return await fold
    .locator('[data-testid="folded-section-item"]')
    .allInnerTexts();
}

async function saveSteps(page: Page): Promise<Array<SavedStep>> {
  await page.getByRole("button", { name: "Save Steps" }).click();
  await expect(page.getByTestId("modal")).toBeVisible();
  await page.getByTestId("modal").getByRole("button", { name: "Got it" }).click();

  const updates: Recorded["updates"] = (await recorded(page)).updates;

  return updates[updates.length - 1]!.data["steps"] as Array<SavedStep>;
}

// How far the page runs past the screen's right edge, if it does.
async function overflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

test.describe("a runbook's steps, at a laptop's width", () => {
  test("every step type: what most people need on the card, the rest folded - the approval switch first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page);

    const automated: Array<[number, string, Array<string>]> = [
      [1, "Work out the new primary", ["Description", "Timeouts"]],
      [2, "Page the database team", ["Headers (JSON): 1", "Description"]],
      [3, "Capture the database's state", ["Description", "Timeouts"]],
      [4, "Stop writes on the old primary", ["Port", "Key passphrase"]],
      [5, "Promote the replica", ["Description", "Timeouts"]],
      [
        6,
        "Summarize the failover",
        ["LLM provider", "Include previous step context"],
      ],
    ];

    for (const [index, title, alsoFolded] of automated) {
      await openStep(page, title);

      const line: Array<string> = await foldedLine(moreFields(page, index));

      // The approval switch and Continue on failure come first in the line.
      expect({ title, first: line.slice(0, 2) }).toEqual({
        title,
        first: [
          index === 5 ? "Require approval: On" : "Require approval",
          index === 2 ? "Continue on failure: On" : "Continue on failure",
        ],
      });

      for (const folded of alsoFolded) {
        expect({ title, folded, listed: line.includes(folded) }).toEqual({
          title,
          folded,
          listed: true,
        });
      }

      const fold: Locator = await openMoreFields(page, index);
      const switches: Locator = fold.getByRole("switch");

      await expect(switches.first()).toHaveAccessibleName(SWITCH_TITLE);
      await expect(switches.nth(1)).toHaveAccessibleName(
        "Continue on failure",
      );
    }

    // The old switch is gone everywhere.
    await expect(
      page.getByText("Require approval before running the next step"),
    ).toHaveCount(0);

    await screenshot(page, "steps-every-type-open");
  });

  test("a Manual step: its instructions on the card, nothing folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page);
    await openStep(page, "Check the replication dashboard");

    await expect(page.getByLabel(/^Instructions/)).toHaveValue(
      "Confirm the replica's lag is under **5 seconds** before going on.",
    );
    await expect(moreFields(page, 0)).toHaveCount(0);
    await expect(page.getByTestId("runbook-step-0-require-approval")).toHaveCount(
      0,
    );
  });

  test("the step that needs approval says so on its header; turning the switch on another step says so there, and Save sends it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page);

    await expect(header(page, "Promote the replica")).toContainText(
      "Needs approval",
    );
    await expect(page.getByText("Needs approval")).toHaveCount(1);

    await openStep(page, "Capture the database's state");
    const fold: Locator = await openMoreFields(page, 3);
    await fold.getByRole("switch", { name: SWITCH_TITLE }).click();

    await expect(header(page, "Capture the database's state")).toContainText(
      "Needs approval",
    );
    await screenshot(page, "steps-approval-switched-on");

    // Folded again, its line says the switch is on.
    await moreFieldsButton(page, 3).click();
    await expect(foldedLine(fold)).resolves.toContain("Require approval: On");

    const steps: Array<SavedStep> = await saveSteps(page);
    const byId: Map<string, SavedStep> = new Map(
      steps.map((step: SavedStep): [string, SavedStep] => {
        return [step.title, step];
      }),
    );

    expect(
      byId.get("Capture the database's state")!.requireApprovalBeforeRunning,
    ).toBe(true);
    expect(byId.get("Promote the replica")!.requireApprovalBeforeRunning).toBe(
      true,
    );
    expect(byId.get("Work out the new primary")!.requireApprovalBeforeRunning)
      .toBe(false);
    expect(JSON.stringify(steps)).not.toContain('"requireApproval"');
  });

  test("an HTTP request shows its body only for a method that sends one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page);

    // A POST shows the body it sends, on the card.
    await openStep(page, "Page the database team");
    await expect(page.locator("#runbook-step-2-http-body")).toHaveCount(1);

    // A new request starts as a GET: no body to send, so no Body.
    await page
      .getByText("Add another step")
      .locator("xpath=..")
      .getByRole("button", { name: /^HTTP/ })
      .click();
    await expect(header(page, "HTTP request")).toBeVisible();
    await expect(page.locator("#runbook-step-7-http-body")).toHaveCount(0);
    await expect(page.locator("#runbook-step-7-http-headers")).toHaveCount(1);
    await expect(foldedLine(moreFields(page, 7))).resolves.toContain(
      "Headers (JSON)",
    );

    // Made a POST, it has a body to send: the Body is there.
    await header(page, "HTTP request")
      .locator("xpath=..")
      .getByRole("combobox")
      .first()
      .click();
    await page.getByRole("option", { name: "POST", exact: true }).click();
    await expect(page.locator("#runbook-step-7-http-body")).toHaveCount(1);
    await screenshot(page, "steps-http-post");
  });

  test("a runbook a client still saves the old way reads as it runs, and Save writes it the new way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "legacy=1");

    // The approval after "Stop writes" is the one before "Promote the replica".
    await expect(header(page, "Promote the replica")).toContainText(
      "Needs approval",
    );
    await expect(header(page, "Stop writes on the old primary")).not.toContainText(
      "Needs approval",
    );
    // The one after the last step is a Manual step at the end.
    await expect(page.getByTestId("runbook-step-header")).toHaveCount(8);
    await expect(page.getByTestId("runbook-step-header").last()).toContainText(
      "Approve the result",
    );
    await screenshot(page, "steps-saved-the-old-way");

    // Reading it so is not a change.
    await expect(page.getByRole("button", { name: "Save Steps" })).toBeDisabled();

    await openStep(page, "Capture the database's state");
    await page.locator("#runbook-step-3-title").fill("Capture the state");

    const steps: Array<SavedStep> = await saveSteps(page);

    expect(JSON.stringify(steps)).not.toContain('"requireApproval"');
    expect(steps.map((step: SavedStep) => step.title)).toContain(
      "Approve the result",
    );
    expect(
      steps.find((step: SavedStep) => {
        return step.title === "Promote the replica";
      })!.requireApprovalBeforeRunning,
    ).toBe(true);
  });
});

test.describe("a run waits for approval before a step", () => {
  test("names the step, and Approve and run runs it - then the run goes on to its next stop", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRun(page, "wait=approval");

    await expect(
      page.getByText('Waiting for approval to run "Promote the replica".'),
    ).toBeVisible();

    const card: Locator = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Promote the replica" }) });

    await expect(card.getByText("Waiting for approval")).toBeVisible();
    await expect(
      card.getByText("This step runs once someone approves it."),
    ).toBeVisible();
    await screenshot(page, "run-waiting-for-approval");

    await card.getByRole("button", { name: "Approve and run" }).click();

    // It ran, and says who approved it; the run waits on the Manual step next.
    await expect(card.getByText("Done", { exact: true })).toBeVisible();
    await expect(
      page.getByTestId("runbook-execution-step-2-approved-by"),
    ).toContainText("Ada Lovelace");
    await expect(
      page.getByText(
        'Waiting on "Confirm writes reach the new primary". Tick it off below to continue.',
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark complete" })).toBeVisible();

    expect((await recorded(page)).posts).toEqual([
      {
        route: "complete",
        stepId: "71000000-0000-4000-8000-000000000a03",
      },
    ]);
    await screenshot(page, "run-approved-then-manual");

    // Ticking the Manual step off lets the run finish.
    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect(page.getByText("All steps completed successfully.")).toBeVisible();
  });

  test("Skip: the step never runs, and the run goes on without it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRun(page, "wait=approval");

    const card: Locator = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Promote the replica" }) });

    await card.getByRole("button", { name: "Skip" }).click();

    await expect(card.getByText("Skipped", { exact: true })).toBeVisible();
    await expect(card.getByText("Show output / logs")).toHaveCount(0);
    expect((await recorded(page)).posts[0]!.route).toBe("skip");
  });

  test("a run started before approvals moved waits after the step that ran, and Approve & continue goes on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRun(page, "wait=legacy");

    await expect(
      page.getByText('Waiting for approval to continue after "Page the database team".'),
    ).toBeVisible();

    const card: Locator = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Page the database team" }) });

    await expect(card.getByText("Show output / logs")).toBeVisible();
    await card.getByRole("button", { name: "Approve & continue" }).click();

    // The steps after it run without another stop, up to the Manual step.
    await expect(
      page.getByText(
        'Waiting on "Confirm writes reach the new primary". Tick it off below to continue.',
      ),
    ).toBeVisible();
    await screenshot(page, "run-started-before-approved");
  });

  test("a finished run says who approved the step that waited", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRun(page, "wait=approved");

    await expect(
      page.getByTestId("runbook-execution-step-2-approved-by"),
    ).toContainText("Approved by");
    await expect(
      page.getByTestId("runbook-execution-step-2-approved-by"),
    ).toContainText("Ada Lovelace");
    await expect(page.getByRole("button", { name: "Approve and run" })).toHaveCount(
      0,
    );
  });
});

test.describe("on every screen", () => {
  test("a phone: step titles keep their room, the lock shows where the run stops, nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSteps(page);

    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // The lock is drawn; its words are for a screen reader on a phone.
    const lock: Locator = page.getByTestId("runbook-step-5-needs-approval");
    await expect(lock).toBeVisible();
    await expect(lock).toHaveAttribute("title", "Needs approval");
    expect((await lock.boundingBox())!.width).toBeLessThan(40);

    // Every title has room for more than a few letters.
    for (const title of [
      "Check the replication dashboard",
      "Promote the replica",
    ]) {
      const titleBox: { width: number } | null = await header(page, title)
        .getByText(title, { exact: true })
        .boundingBox();
      expect({ title, roomy: (titleBox?.width || 0) > 75 }).toEqual({
        title,
        roomy: true,
      });
    }

    await openStep(page, "Promote the replica");
    await openMoreFields(page, 5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await screenshot(page, "steps-phone");
  });

  test("a phone: the waiting step's buttons sit under its words, inside its card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRun(page, "wait=approval");

    expect(await overflow(page)).toBeLessThanOrEqual(0);

    const card: Locator = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Promote the replica" }) });
    const approve: Locator = card.getByRole("button", { name: "Approve and run" });
    const heading: Locator = card.getByRole("heading", {
      name: "Promote the replica",
    });

    const cardBox: { x: number; width: number } = (await card.boundingBox())!;
    const approveBox: { x: number; y: number; width: number } =
      (await approve.boundingBox())!;
    const headingBox: { y: number; width: number } =
      (await heading.boundingBox())!;

    // Under the step's words, not squeezing them into a column.
    expect(approveBox.y).toBeGreaterThan(headingBox.y);
    expect(headingBox.width).toBeGreaterThan(150);
    // Inside the card.
    expect(approveBox.x + approveBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width + 1,
    );
    await screenshot(page, "run-phone");
  });

  test("dark mode", async ({ page }: { page: Page }) => {
    await openSteps(page, "theme=dark");
    await openStep(page, "Promote the replica");
    await openMoreFields(page, 5);

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(
      moreFields(page, 5).getByRole("switch", { name: SWITCH_TITLE }),
    ).toBeVisible();
    await screenshot(page, "steps-dark");

    await openRun(page, "wait=approval&theme=dark");
    await expect(page.getByRole("button", { name: "Approve and run" })).toBeVisible();
    await screenshot(page, "run-dark");
  });

  test("in German, the switch, the header and the waiting step are said in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "lang=de");
    await openStep(page, "Promote the replica");
    await openMoreFields(page, 5);

    await expect(
      page.getByRole("switch", { name: GERMAN[SWITCH_TITLE]! }).first(),
    ).toBeVisible();
    await expect(header(page, "Promote the replica")).toContainText(
      GERMAN["Needs approval"]!,
    );
    await screenshot(page, "steps-german");

    await openRun(page, "wait=approval&lang=de");
    await expect(
      page.getByRole("button", { name: GERMAN["Approve and run"]! }),
    ).toBeVisible();
    await expect(
      page.getByText(GERMAN["This step runs once someone approves it."]!),
    ).toBeVisible();
    await screenshot(page, "run-german");
  });
});
