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
 * step, a run started before the change; at a laptop's, a tablet's and a
 * phone's width (in German too, whose labels run longest), in dark mode.
 * The fixture records every save and every step route, so the tests check
 * what was sent as well as what was drawn.
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
  await page
    .getByTestId("modal")
    .getByRole("button", { name: "Got it" })
    .click();

  const updates: Recorded["updates"] = (await recorded(page)).updates;

  return updates[updates.length - 1]!.data["steps"] as Array<SavedStep>;
}

// How far the page runs past the screen's right edge, if it does.
async function overflow(page: Page): Promise<number> {
  return await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
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

// `inner` is drawn within `outer`'s box, on both sides.
async function expectInside(inner: Locator, outer: Locator): Promise<void> {
  const innerBox: Box = await boxOf(inner);
  const outerBox: Box = await boxOf(outer);

  expect(innerBox.x).toBeGreaterThanOrEqual(outerBox.x - 1);
  expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(
    outerBox.x + outerBox.width + 1,
  );
}

// The card of the run's step titled `title`.
function waitingCard(page: Page, title: string): Locator {
  return page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: title }),
  });
}

// The run's four tiles: Status, Progress, Started and Elapsed.
async function tileBoxes(page: Page): Promise<Array<Box>> {
  const tiles: Locator = page
    .getByTestId("runbook-execution-tiles")
    .locator(":scope > div");
  const boxes: Array<Box> = [];

  for (let index: number = 0; index < (await tiles.count()); index++) {
    boxes.push(await boxOf(tiles.nth(index)));
  }

  return boxes;
}

test.describe("a runbook's steps, at a laptop's width", () => {
  test("every step type: what most people need on the card, the rest folded - the Runner named first, then the approval switch", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page);

    /*
     * A step that runs on a Runner names it first - which Runner, the
     * default included ("Runner: Global Runner" for the JavaScript step that
     * picked none) - so nobody opens the fold to learn where it runs.
     */
    const automated: Array<[number, string, string | null, Array<string>]> = [
      [
        1,
        "Work out the new primary",
        "Runner: Global Runner",
        ["Description", "Timeouts"],
      ],
      [2, "Page the database team", null, ["Headers (JSON): 1", "Description"]],
      [
        3,
        "Capture the database's state",
        "Runner: prod-bastion",
        ["Description", "Timeouts"],
      ],
      // Seven names: the Runner, the two switches and Port, then "3 more".
      [4, "Stop writes on the old primary", "Runner: prod-bastion", ["Port"]],
      [
        5,
        "Promote the replica",
        "Runner: prod-bastion",
        ["Description", "Timeouts"],
      ],
      [
        6,
        "Summarize the failover",
        null,
        ["LLM provider", "Include previous step context"],
      ],
    ];

    for (const [index, title, runner, alsoFolded] of automated) {
      await openStep(page, title);

      const line: Array<string> = await foldedLine(moreFields(page, index));
      const first: Array<string> = runner ? [runner] : [];

      // Then the approval switch and Continue on failure.
      first.push(
        index === 5 ? "Require approval: On" : "Require approval",
        index === 2 ? "Continue on failure: On" : "Continue on failure",
      );

      expect({ title, first: line.slice(0, first.length) }).toEqual({
        title,
        first,
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
      await expect(switches.nth(1)).toHaveAccessibleName("Continue on failure");
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
    await expect(
      page.getByTestId("runbook-step-0-require-approval"),
    ).toHaveCount(0);
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
    // One step's header says so (the card's description says it of any step).
    await expect(
      page.getByTestId("runbook-step-header").getByText("Needs approval", {
        exact: true,
      }),
    ).toHaveCount(1);

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
    expect(
      byId.get("Work out the new primary")!.requireApprovalBeforeRunning,
    ).toBe(false);
    expect(JSON.stringify(steps)).not.toContain('"requireApproval"');
  });

  test("an HTTP request's timeout takes half the width, as every step's timeouts do; an AI step's provider is always set, so it is neither optional nor cleared", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page);

    await openStep(page, "Page the database team");
    const httpFold: Locator = await openMoreFields(page, 2);
    const httpTimeout: Box = await boxOf(
      httpFold.getByLabel(/^Request timeout/),
    );
    const httpFoldBox: Box = await boxOf(httpFold);
    expect(httpTimeout.width).toBeLessThan(httpFoldBox.width * 0.6);

    // The same width as a script step's Execution timeout.
    await openStep(page, "Capture the database's state");
    const bashFold: Locator = await openMoreFields(page, 3);
    const bashTimeout: Box = await boxOf(
      bashFold.getByLabel(/^Execution timeout/),
    );
    expect(Math.abs(httpTimeout.width - bashTimeout.width)).toBeLessThan(2);

    await openStep(page, "Summarize the failover");
    const aiFold: Locator = await openMoreFields(page, 6);
    await expect(
      aiFold.getByText("LLM provider", { exact: true }),
    ).toBeVisible();
    await expect(aiFold.getByText("(optional)")).toHaveCount(0);
    await expect(aiFold.locator(".ou-select__clear-indicator")).toHaveCount(0);
    await expect(aiFold.getByText("Project default").first()).toBeVisible();
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
    await expect(
      header(page, "Stop writes on the old primary"),
    ).not.toContainText("Needs approval");
    // The one after the last step is a Manual step at the end.
    await expect(page.getByTestId("runbook-step-header")).toHaveCount(8);
    await expect(page.getByTestId("runbook-step-header").last()).toContainText(
      "Approve the result",
    );
    await screenshot(page, "steps-saved-the-old-way");

    // Reading it so is not a change.
    await expect(
      page.getByRole("button", { name: "Save Steps" }),
    ).toBeDisabled();

    await openStep(page, "Capture the database's state");
    await page.locator("#runbook-step-3-title").fill("Capture the state");

    const steps: Array<SavedStep> = await saveSteps(page);

    expect(JSON.stringify(steps)).not.toContain('"requireApproval"');
    expect(
      steps.map((step: SavedStep) => {
        return step.title;
      }),
    ).toContain("Approve the result");
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

    const card: Locator = page.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: "Promote the replica" }),
    });

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
    await expect(
      page.getByRole("button", { name: "Mark complete" }),
    ).toBeVisible();

    expect((await recorded(page)).posts).toEqual([
      {
        route: "complete",
        stepId: "71000000-0000-4000-8000-000000000a03",
      },
    ]);
    await screenshot(page, "run-approved-then-manual");

    // Ticking the Manual step off lets the run finish.
    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect(
      page.getByText("All steps completed successfully."),
    ).toBeVisible();
  });

  test("Skip: the step never runs, and the run goes on without it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRun(page, "wait=approval");

    const card: Locator = page.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: "Promote the replica" }),
    });

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
      page.getByText(
        'Waiting for approval to continue after "Page the database team".',
      ),
    ).toBeVisible();

    const card: Locator = page.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: "Page the database team" }),
    });

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
    await expect(
      page.getByRole("button", { name: "Approve and run" }),
    ).toHaveCount(0);
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

    /*
     * The step's type is read out but not drawn - the number's colour and
     * the line under the title say it - so the title has the room, and a
     * long one takes a second line rather than ending after a word or two.
     */
    const type: Locator = page.getByTestId("runbook-step-4-type");
    await expect(type).toHaveText("SSH");
    expect((await boxOf(type)).width).toBeLessThanOrEqual(1);

    const longTitle: Locator = page.getByTestId("runbook-step-4-title-text");
    await expect(longTitle).toHaveText("Stop writes on the old primary");
    expect((await boxOf(longTitle)).height).toBeGreaterThan(30);
    expect(
      await longTitle.evaluate((element: Element): boolean => {
        return element.scrollHeight <= element.clientHeight + 1;
      }),
    ).toBe(true);

    await openStep(page, "Promote the replica");
    await openMoreFields(page, 5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await screenshot(page, "steps-phone");

    // On a laptop the type is drawn beside the title, which keeps one line.
    await page.setViewportSize({ width: 1280, height: 900 });
    expect((await boxOf(type)).width).toBeGreaterThan(30);
    expect((await boxOf(longTitle)).height).toBeLessThan(24);
  });

  test("a phone: the waiting step's buttons fill the card under its words, Skip centred under the one that moves the run on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRun(page, "wait=approval");

    expect(await overflow(page)).toBeLessThanOrEqual(0);

    const card: Locator = waitingCard(page, "Promote the replica");
    const approve: Locator = card.getByRole("button", {
      name: "Approve and run",
    });
    const heading: Locator = card.getByRole("heading", {
      name: "Promote the replica",
    });
    const skip: Locator = card.getByRole("button", { name: "Skip" });

    const words: Box = await boxOf(
      page.getByTestId("runbook-execution-step-2-words"),
    );
    const approveBox: Box = await boxOf(approve);
    const skipBox: Box = await boxOf(skip);
    const headingBox: Box = await boxOf(heading);

    // Under the step's words, not squeezing them into a column.
    expect(approveBox.y).toBeGreaterThan(headingBox.y);
    expect(headingBox.width).toBeGreaterThan(150);

    // As wide as the words: the one thing to press, on a line of its own.
    expect(Math.abs(approveBox.x - words.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(approveBox.x + approveBox.width - (words.x + words.width)),
    ).toBeLessThanOrEqual(1);
    // Its label on one line.
    expect(approveBox.height).toBeLessThan(48);

    // Skip under it, centred on it.
    expect(skipBox.y).toBeGreaterThanOrEqual(
      approveBox.y + approveBox.height - 1,
    );
    expect(
      Math.abs(
        skipBox.x + skipBox.width / 2 - (approveBox.x + approveBox.width / 2),
      ),
    ).toBeLessThanOrEqual(2);
    await expectInside(skip, card);

    // A later step's lone Skip keeps to its card's right edge.
    const laterCard: Locator = page.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: "Post the all-clear" }),
    });
    const laterWords: Box = await boxOf(
      page.getByTestId("runbook-execution-step-4-words"),
    );
    const laterSkip: Box = await boxOf(
      laterCard.getByRole("button", { name: "Skip" }),
    );
    expect(laterSkip.width).toBeLessThan(laterWords.width / 2);
    expect(
      Math.abs(
        laterSkip.x + laterSkip.width - (laterWords.x + laterWords.width),
      ),
    ).toBeLessThanOrEqual(2);
    await screenshot(page, "run-phone");
  });

  for (const width of [390, 320]) {
    test(`a phone ${width}px wide, in German: the waiting step's long labels stay inside its card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await openRun(page, "wait=approval&lang=de");

      expect(await overflow(page)).toBeLessThanOrEqual(0);

      const card: Locator = waitingCard(page, "Promote the replica");

      for (const label of ["Approve and run", "Skip"]) {
        await expectInside(
          card.getByRole("button", { name: GERMAN[label]! }),
          card,
        );
      }

      // The words keep the card's width: no column a word or two wide.
      const words: Box = await boxOf(
        page.getByTestId("runbook-execution-step-2-words"),
      );
      expect(words.width).toBeGreaterThan(width - 180);
    });
  }

  /*
   * A phone 390px wide in German, whose waiting labels run longest
   * ("Genehmigen und ausführen", "Als erledigt markieren"): the card's
   * dots and padding sit closer to the edge below sm, and its buttons use
   * the card's text size, so each label stays on one line - as high as
   * Skip under it. ("Als abgeschlossen markieren" took two lines however
   * wide the card; German says "Als erledigt markieren" now.)
   */
  for (const wait of ["approval", "manual"]) {
    test(`a phone 390px wide, in German: the button that moves the run on (${wait}) keeps its label on one line`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openRun(page, `wait=${wait}&lang=de`);

      expect(await overflow(page)).toBeLessThanOrEqual(0);

      const label: string =
        wait === "approval"
          ? GERMAN["Approve and run"]!
          : GERMAN["Mark complete"]!;

      expect(label).toBe(
        wait === "approval"
          ? "Genehmigen und ausführen"
          : "Als erledigt markieren",
      );

      const moveOn: Locator = page.getByRole("button", { name: label });
      const skip: Locator = page
        .getByRole("listitem")
        .filter({ has: moveOn })
        .getByRole("button", { name: GERMAN["Skip"]! });

      const moveOnBox: Box = await boxOf(moveOn);
      const skipBox: Box = await boxOf(skip);

      // One line: as high as Skip, whose one word never wraps.
      expect(Math.abs(moveOnBox.height - skipBox.height)).toBeLessThanOrEqual(
        1,
      );
      await expectInside(
        moveOn,
        page.getByRole("listitem").filter({ has: moveOn }),
      );
    });
  }

  test("a phone: the timeline's line runs through the middle of its dots, and the cards sit close to them", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openRun(page, "wait=approval");

      const line: Box = await boxOf(
        page.getByTestId("runbook-execution-timeline-line"),
      );
      const dot: Box = await boxOf(
        page
          .getByTestId("runbook-execution-step-0-dot")
          .locator("span")
          .first(),
      );

      expect({
        width,
        offCentre:
          Math.abs(line.x + line.width / 2 - (dot.x + dot.width / 2)) <= 1,
      }).toEqual({ width, offCentre: true });

      // The card starts after the dot and its white ring, never under it.
      const card: Box = await boxOf(
        page.getByTestId("runbook-execution-step-0-words"),
      );
      expect(card.x).toBeGreaterThan(dot.x + dot.width);
    }
  });

  test("a run that waits says how long it has been going, counting up - never Running...", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRun(page, "wait=approval");

    const elapsed: Locator = page.getByTestId("runbook-execution-elapsed");

    // The fixture's run started ten minutes ago.
    await expect(elapsed).toHaveText(/^10 mins( \d+ secs?)?$/);
    await expect(elapsed).toHaveAttribute("role", "timer");

    const first: string = (await elapsed.textContent()) || "";

    await expect(elapsed).not.toHaveText(first, { timeout: 5000 });
    await expect(page.getByText("Running...")).toHaveCount(0);
  });

  test("a finished run says when it completed in that tile, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRun(page, "wait=approved");

    await expect(page.getByTestId("runbook-execution-elapsed")).toHaveCount(0);

    // The fourth tile: its label says Completed, over the time it did.
    const lastTile: Locator = page
      .getByTestId("runbook-execution-tiles")
      .locator(":scope > div")
      .nth(3);

    await expect(lastTile).toContainText("Completed");
    await expect(lastTile).not.toContainText("Elapsed");
  });

  test("dark mode: every step keeps its type's coloured edge, never the grey of its border", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["light", "dark"]) {
      await openSteps(page, theme === "dark" ? "theme=dark" : "");

      const edges: Array<{ left: string; top: string }> = await page
        .getByTestId("runbook-step-header")
        .evaluateAll(
          (headers: Array<Element>): Array<{ left: string; top: string }> => {
            return headers.map(
              (header: Element): { left: string; top: string } => {
                let card: Element | null = header;

                while (card && !card.classList.contains("border-l-4")) {
                  card = card.parentElement;
                }

                const style: CSSStyleDeclaration = getComputedStyle(
                  card as Element,
                );

                return {
                  left: style.borderLeftColor,
                  top: style.borderTopColor,
                };
              },
            );
          },
        );

      expect(edges.length).toBeGreaterThanOrEqual(7);

      for (const edge of edges) {
        expect({ theme, edge, isColoured: edge.left !== edge.top }).toEqual({
          theme,
          edge,
          isColoured: true,
        });
      }

      // The first step is a Manual one: Tailwind's indigo-500.
      expect({ theme, left: edges[0]!.left }).toEqual({
        theme,
        left: "rgb(99, 102, 241)",
      });
    }
  });

  test("a tablet, or a card the side menu narrows: the buttons wrap under the step's words, at the card's right edge, instead of squeezing them", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const language of ["en", "de"]) {
      await page.setViewportSize({ width: 700, height: 900 });
      await openRun(page, `wait=approval&lang=${language}`);

      const card: Locator = waitingCard(page, "Promote the replica");
      const approveLabel: string =
        language === "de" ? GERMAN["Approve and run"]! : "Approve and run";
      const words: Box = await boxOf(
        page.getByTestId("runbook-execution-step-2-words"),
      );
      const actions: Box = await boxOf(
        page.getByTestId("runbook-execution-step-2-actions"),
      );
      const approve: Box = await boxOf(
        card.getByRole("button", { name: approveLabel }),
      );

      // The words have the card's width, the buttons a line under them.
      expect({ language, wide: words.width > 400 }).toEqual({
        language,
        wide: true,
      });
      expect({ language, under: actions.y >= words.y + words.height }).toEqual({
        language,
        under: true,
      });
      // At the right edge, each button its own width, on one line.
      expect(
        Math.abs(actions.x + actions.width - (words.x + words.width)),
      ).toBeLessThanOrEqual(2);
      expect({ language, oneLine: approve.height < 48 }).toEqual({
        language,
        oneLine: true,
      });
      expect(approve.width).toBeLessThan(words.width / 2);
    }

    /*
     * A Manual step that has started: when it started is with its words, so
     * the buttons come last - read, then act.
     */
    await openRun(page, "wait=manual");

    const manualCard: Locator = waitingCard(
      page,
      "Confirm writes reach the new primary",
    );
    const started: Box = await boxOf(manualCard.getByText(/^Started /));
    const markComplete: Box = await boxOf(
      manualCard.getByRole("button", { name: "Mark complete" }),
    );

    expect(markComplete.y).toBeGreaterThanOrEqual(started.y + started.height);

    // Wide enough, they sit beside the words, level with their top.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openRun(page, "wait=approval");

    const wideWords: Box = await boxOf(
      page.getByTestId("runbook-execution-step-2-words"),
    );
    const wideActions: Box = await boxOf(
      page.getByTestId("runbook-execution-step-2-actions"),
    );

    expect(wideActions.x).toBeGreaterThan(wideWords.x + wideWords.width - 1);
    expect(Math.abs(wideActions.y - wideWords.y)).toBeLessThan(12);
  });

  test("the run's card: what it waits on runs under its name and buttons, across the card, and the four tiles go two by two where four would cut a date in pieces", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openRun(page, "wait=approval");

    const description: Locator = page.getByTestId("card-description").first();
    await expect(description).toHaveText(
      'Waiting for approval to run "Promote the replica".',
    );

    // Not squeezed beside the buttons: on one line, under them.
    const descriptionBox: Box = await boxOf(description);
    const cancelBox: Box = await boxOf(
      page.getByRole("button", { name: "Cancel Execution" }),
    );
    expect(descriptionBox.y).toBeGreaterThanOrEqual(
      cancelBox.y + cancelBox.height - 1,
    );
    expect(descriptionBox.height).toBeLessThan(30);

    const tiles: Array<Box> = await tileBoxes(page);
    expect(tiles).toHaveLength(4);
    // Two by two.
    expect(Math.abs(tiles[0]!.y - tiles[1]!.y)).toBeLessThan(2);
    expect(tiles[2]!.y).toBeGreaterThan(tiles[0]!.y + tiles[0]!.height - 1);

    // Four across on a laptop.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openRun(page, "wait=approval");

    const wideTiles: Array<Box> = await tileBoxes(page);
    for (const tile of wideTiles) {
      expect(Math.abs(tile.y - wideTiles[0]!.y)).toBeLessThan(2);
    }
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
    await expect(
      page.getByRole("button", { name: "Approve and run" }),
    ).toBeVisible();
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
