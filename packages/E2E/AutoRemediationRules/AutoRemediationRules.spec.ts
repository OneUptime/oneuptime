import { ElementHandle, expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * AI rules - which new incidents (or alerts) OneUptime AI investigates, and
 * whether and how it fixes them - on Incidents -> AI -> Settings and Alerts
 * -> AI -> Settings, in a browser, against the offline fixture
 * (AutoRemediationRules/Fixture).
 *
 * The maintainer: "Should incident investigation rule and remediation rule
 * be the same entity - we can call it Incident AI rules ... Since its not
 * possible to remediate without investigation." So the investigation rules
 * and the auto remediation rules are one table, AI rules, whose rule asks a
 * step each: Match, Investigate (right away, or only if still open after a
 * wait - InvestigationRules.spec.ts) and Fix: don't fix, ask before fixing
 * or fix without asking. What most rules never change is folded under the
 * Fix step's More fields, for both: the code repositories, MCP servers and
 * LLM provider OneUptime AI investigates and fixes with, and - for a rule
 * that fixes - the runbooks, the Runner and the two pull requests. A rule
 * that was an auto remediation rule may only fix: its Investigate step says
 * so, with "Investigate too".
 *
 * The maintainer's ask, on the rule's Fix step: "Why should I pick between
 * oneuptime AI and Runbook? Can oneuptime AI do things by default, and I can
 * whitelist some Runbook for AI to pick and run? If I do not whitelist any
 * Runbook, it can basically run any Runbook by default. ... In fact, in the
 * auto remediation rule, you could ask which runner we should use to run
 * the remediation. If no runner is selected, run on the global runner, but
 * all of these should be in a more option. They should not be visible by
 * default." And: "Please do this for alerts as well."
 *
 * So the Fix step asks one question, Approval, and More fields - folded -
 * holds the runbooks OneUptime AI may run (none: any), "Run them every
 * time" (what a rule saved with Fix With set to Runbooks keeps doing), the
 * Runner OneUptime AI runs the rule's Bash commands on, the code
 * repositories it may use and the two pull requests it opens. The fixture
 * records every create and update the page sends, so the tests check what
 * was sent as well as what was drawn.
 *
 * Later, the maintainer again: "why does it see an AI agent on the cluster
 * or host? That doesn't make any sense because it's an AI agent that runs
 * the commands ... Here, we could pick which runner the remediation would
 * actually run on." So the Runner picker lists the project's own Runners -
 * its default first, and picked for a new rule. And: "If there are no
 * runners, it should use the global runner by default." So a rule that
 * picks none shows the Global Runner wherever the project uses global
 * Runners and the server has one, with a line that says OneUptime AI runs
 * no Bash commands there - a shell never runs on a Runner every project
 * shares - and how to have them run: pick one of your Runners, or add one.
 * Where there is no Global Runner to show, it reads "No Runner". "Both of
 * these toggles should be inside of
 * Remediation Rule, inside of More, and they should be checked by default":
 * the fix and telemetry pull requests. And "there should be a dropdown here
 * to select the code repo for remediation and also investigation rules, if
 * no code repo is selected - it should be able to read and investigate all
 * the repos that are connected".
 *
 * The table names each rule's fix in one Fix column - whether it asks
 * first, and how it fixes only for a rule that does not fix the way every
 * new rule does - so it fits its card beside the row actions. A rule saved
 * before rules were simplified says what it still does at the top of its
 * Fix step and offers "Fix like a new rule".
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";

const RUNBOOK_IDS: Record<string, string> = {
  restartCheckout: "a0000000-0000-4000-8000-000000000b01",
  failoverDatabase: "a0000000-0000-4000-8000-000000000b02",
  clearCache: "a0000000-0000-4000-8000-000000000b03",
};

const RUNNER_IDS: Record<string, string> = {
  prodEu: "b0000000-0000-4000-8000-000000000c01",
  office: "b0000000-0000-4000-8000-000000000c02",
};

const SAVED_RULE_IDS: Record<string, string> = {
  everyTime: "90000000-0000-4000-8000-000000000d01",
  aiWithRunner: "90000000-0000-4000-8000-000000000d02",
  commands: "90000000-0000-4000-8000-000000000d03",
  picks: "90000000-0000-4000-8000-000000000d04",
};

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/auto-remediation-rules-ui",
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

const CARD_TITLE: string = "AI rules";
const CREATE: string = "Create AI Rule";
// The Fix step's one question, and its first answer: investigate, change nothing.
const FIX_DESCRIPTION: string =
  "After it investigates, OneUptime AI can fix what it found. Choose whether it does, and whether a fix waits for approval.";
const DONT_FIX_DESCRIPTION: string =
  "OneUptime AI investigates and posts what it finds. It changes nothing.";
const FIX_WITHOUT_ASKING_DESCRIPTION: string =
  "OneUptime AI fixes on its own where the AI agent's settings allow it, and with the runbooks and MCP servers you pick under More fields.";
/*
 * What More fields says, folded, while a new rule holds every default: one
 * sentence, not one for each field. Once some are set, one sentence for
 * each default left (ANY_RUNBOOK_SUMMARY, REPOSITORIES_SUMMARY).
 */
const DEFAULTS_SUMMARY: string =
  "OneUptime AI may use any of your runbooks, MCP servers and connected repositories, and open pull requests in them.";
const ANY_RUNBOOK_SUMMARY: string =
  "OneUptime AI may run any of your runbooks.";
const REPOSITORIES_SUMMARY: string =
  "OneUptime AI may read all connected repositories, and open pull requests in them.";
// A rule that doesn't fix, while it holds both of its defaults.
const NOT_FIXING_DEFAULTS_SUMMARY: string =
  "OneUptime AI may use any of your MCP servers and connected repositories.";
// A rule that was an auto remediation rule, on its Investigate step.
const ONLY_FIXES_NOTE: string =
  "This rule only fixes: it was an auto remediation rule, and does not decide which incidents are investigated.";
const INVESTIGATE_TOO: string = "Investigate too";
/*
 * The fixture's project has the global LLM provider alone unless
 * ?providers= says otherwise: nothing to pick between, so the folded line
 * says nothing of providers (the open box names it). With more than one,
 * the line names the default first (PROJECT_DEFAULT_SUMMARY).
 */
const RUNBOOKS_DESCRIPTION: string =
  "OneUptime AI may run any of your runbooks. Pick some to let it run only those.";
const RUNNER_DESCRIPTION: string =
  "Where OneUptime AI runs Bash commands for this rule. Commands on the affected cluster or host go through its AI agent.";
/*
 * What the Runner picker shows while a rule picks none, where the project
 * uses global Runners and the server has one (?globalRunners=, and
 * ?useGlobalRunners=0 for a project that turned them off).
 */
const GLOBAL_RUNNER: string = "Global Runner · Connected";
// Under it in the menu: what it is, and what OneUptime AI does not do there.
const GLOBAL_RUNNER_DESCRIPTION: string =
  "Run by OneUptime for every project. OneUptime AI runs no Bash commands on it.";
// Under the picker on it, in a project with Runners of its own.
const GLOBAL_RUNNER_PICK_HELP: string =
  "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Pick one of your Runners to run them.";
// The same, in a project with none of its own.
const GLOBAL_RUNNER_ADD_HELP: string =
  "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Add a Runner under Runbooks › Runners to run them.";
// What the Runner picker reads while a rule picks none, with no Global Runner.
const NO_RUNNER: string = "No Runner";
// The choice the picker no longer offers: that agent is not a Runner.
const RETIRED_RUNNER_CHOICE: string = "AI agent on the cluster or host";
// Under it only in a project with no Runner of its own, and no Global Runner.
const ADD_RUNNER_HELP: string =
  "Add a Runner under Runbooks › Runners for OneUptime AI to run commands on, then pick it here.";
const RUNNER_HELP_TEST_ID: string = "auto-remediation-runner-picker-help";
const EVERY_TIME: string = "Run them every time";
const OLDER_COMMANDS_NOTE: string =
  "This older rule only has OneUptime AI run commands on its Runners.";
const OLDER_PICKS_NOTE: string =
  "This older rule only has OneUptime AI pick one of its runbooks, and always asks first.";
const FIX_LIKE_A_NEW_RULE: string = "Fix like a new rule";
const OLDER_RULE_TEST_ID: string = "auto-remediation-older-rule";

// The code repositories a rule may use, and the two pull requests it opens.
const CODE_REPOSITORY_IDS: Record<string, string> = {
  checkout: "d0000000-0000-4000-8000-000000000f01",
  billing: "d0000000-0000-4000-8000-000000000f02",
};
const ALL_REPOSITORIES: string = "All connected repositories";
// One line for every rule: a rule that doesn't fix reads them, and opens none.
const REPOSITORIES_DESCRIPTION: string =
  "OneUptime AI may use all of your connected repositories. Pick some to let it use only those.";
const REPOSITORIES_HINT: string =
  "Connect and manage repositories on the Code › Repositories page.";
const FIX_PULL_REQUESTS: string = "Fix pull requests";
const TELEMETRY_PULL_REQUESTS: string = "Telemetry pull requests";
// A repository a saved rule names that the reader may not read (?hiddenRepository=1).
const HIDDEN_REPOSITORY_ID: string = "d0000000-0000-4000-8000-000000000fff";
const HIDDEN_REPOSITORY: string = "A repository you cannot access";

interface Recorded {
  creates: Array<{ model: string; data: Record<string, unknown> }>;
  updates: Array<{ model: string; id: string; data: Record<string, unknown> }>;
  deletes: Array<{ model: string; id: string }>;
}

type Lane = "incident" | "alert";

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // Nothing on the page may throw, whatever the test did.
  expect(pageErrors.get(page) || []).toEqual([]);
});

const advancedSection: (page: Page, lane: Lane) => Locator = (
  page: Page,
  lane: Lane,
): Locator => {
  return page.getByTestId(`${lane}-ai-advanced-section`);
};

// The page, its More settings unfolded, and the rules card.
const openRulesCard: (
  page: Page,
  options?: { lane?: Lane; query?: string; isGerman?: boolean },
) => Promise<Locator> = async (
  page: Page,
  options: { lane?: Lane; query?: string; isGerman?: boolean } = {},
): Promise<Locator> => {
  const lane: Lane = options.lane || "incident";
  const query: string = [lane === "alert" ? "lane=alert" : "", options.query]
    .filter(Boolean)
    .join("&");
  // The page's own words: German with ?lang=de.
  const words: (english: string) => string = (english: string): string => {
    return (options.isGerman && GERMAN[english]) || english;
  };

  await page.goto(
    `/dashboard/${PROJECT_ID}/${lane === "alert" ? "alerts" : "incidents"}/ai/settings${query ? `?${query}` : ""}`,
  );
  await expect(advancedSection(page, lane)).toBeVisible();

  const fold: Locator = advancedSection(page, lane).getByRole("button", {
    name: new RegExp(`^${words("More settings")}`),
  });
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");

  const card: Locator = page.locator("[data-card-surface='section']").filter({
    has: page.getByRole("heading", { name: words(CARD_TITLE), exact: true }),
  });
  await expect(card).toBeVisible();

  return card;
};

const recorded: (page: Page) => Promise<Recorded> = async (
  page: Page,
): Promise<Recorded> => {
  return (await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify((window as unknown as { __fixture: unknown }).__fixture),
    );
  })) as Recorded;
};

// The ids a relation list was sent with, however it was written.
const idsOf: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  return ((value || []) as Array<unknown>)
    .map((entry: unknown): string => {
      if (typeof entry === "string") {
        return entry;
      }

      const row: Record<string, unknown> = (entry || {}) as Record<
        string,
        unknown
      >;
      return String(row["_id"] || row["id"] || "");
    })
    .sort();
};

/*
 * The dialog a button opens. A click that lands while the card draws its
 * rules again - their rows arriving after the card shows, on a busy runner -
 * opens nothing, so the button is pressed again until the dialog opens; never
 * once a dialog is open (a late one would get a second press).
 */
const openDialogWith: (
  page: Page,
  button: Locator,
) => Promise<Locator> = async (
  page: Page,
  button: Locator,
): Promise<Locator> => {
  const dialog: Locator = page.getByRole("dialog");

  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await button.click({ timeout: 5000 });
    }

    await expect(dialog).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });

  return dialog;
};

/*
 * The create dialog, walked to its Fix step: all incidents, investigated
 * right away, then a name on the step that creates the rule.
 */
const openFixStep: (page: Page, card: Locator) => Promise<Locator> = async (
  page: Page,
  card: Locator,
): Promise<Locator> => {
  const dialog: Locator = await openDialogWith(
    page,
    card.getByRole("button", { name: CREATE }).first(),
  );

  await expect(
    dialog.getByRole("radio", { name: /^All incidents|^All alerts/ }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: /^Right away/ }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog).toContainText(FIX_DESCRIPTION);
  await dialog.getByRole("textbox", { name: /^Name/ }).fill("Fix checkout");

  return dialog;
};

// One of the Fix step's three answers, by its title.
const fixChoice: (dialog: Locator, title: string) => Locator = (
  dialog: Locator,
  title: string,
): Locator => {
  return dialog.getByRole("radio", { name: new RegExp(`^${title}`) });
};

// An edit dialog's step, from its list of steps.
const openStep: (dialog: Locator, title: string) => Promise<void> = async (
  dialog: Locator,
  title: string,
): Promise<void> => {
  await dialog.getByText(title, { exact: true }).first().click();
};

const moreFieldsButton: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByRole("button", { name: /More fields/ });
};

const openMoreFields: (dialog: Locator) => Promise<void> = async (
  dialog: Locator,
): Promise<void> => {
  await moreFieldsButton(dialog).click();
  await expect(moreFieldsButton(dialog)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
};

/*
 * The sentences under More fields while it is folded. Read there, not in the
 * whole dialog: the folded fields stay on the page, and the Runbooks field's
 * own line starts with the same words as the runbooks sentence.
 */
const foldedSummary: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByTestId("collapsible-section-summary");
};

// Picks an option of a react-select picker in the open dialog.
const pickOption: (
  page: Page,
  picker: Locator,
  option: string | RegExp,
) => Promise<void> = async (
  page: Page,
  picker: Locator,
  option: string | RegExp,
): Promise<void> => {
  await picker.click();
  await page
    .getByRole("option", {
      name: option,
      ...(typeof option === "string" ? { exact: true } : {}),
    })
    .click();
};

const runbooksPicker: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByRole("combobox", { name: "Runbooks" });
};

const runnerPicker: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByRole("combobox", { name: "Runner" });
};

const repositoriesPicker: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByRole("combobox", { name: "Code Repositories" });
};

// The repositories picked, as the picker's chips name them (EntityDropdown).
const repositoryChips: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog
    .getByTestId("rule-code-repositories-picker")
    .getByTestId("entity-dropdown-chip-label");
};

const pullRequestSwitch: (dialog: Locator, title: string) => Locator = (
  dialog: Locator,
  title: string,
): Locator => {
  return dialog.getByRole("switch", { name: title, exact: true });
};

const everyTimeSwitch: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByRole("switch", { name: EVERY_TIME, exact: true });
};

const create: (page: Page, dialog: Locator) => Promise<void> = async (
  page: Page,
  dialog: Locator,
): Promise<void> => {
  await dialog.getByRole("button", { name: CREATE }).click();
  await expect(dialog).toBeHidden();
  // The table reads the rules again after the save.
  await page.waitForTimeout(200);
};

const screenshot: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
};

/*
 * The dialog alone, scrolled to a field: its body scrolls, so a page
 * screenshot shows only what sits above the fold.
 */
const dialogScreenshot: (
  dialog: Locator,
  field: Locator,
  name: string,
) => Promise<void> = async (
  dialog: Locator,
  field: Locator,
  name: string,
): Promise<void> => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await field.scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) });
};

// An id as a save sends it: a string, or an ObjectID left as the form read it.
const idOfValue: (value: unknown) => string = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  const row: Record<string, unknown> = (value || {}) as Record<string, unknown>;
  return String(row["value"] || row["_id"] || "");
};

/*
 * What a row's rule does, as the table's one column says it ("Investigates
 * and fixes"): when it investigates, and under it how it fixes.
 */
const COLUMN: string = "Investigates and fixes";

const rowOf: (card: Locator, rowName: string) => Locator = (
  card: Locator,
  rowName: string,
): Locator => {
  return card.locator("tbody tr").filter({ hasText: rowName }).first();
};

// The fix under it, its pill and its line read as one sentence.
const fixOf: (card: Locator, rowName: string) => Promise<string> = async (
  card: Locator,
  rowName: string,
): Promise<string> => {
  return (await rowOf(card, rowName).getByTestId("ai-rule-fix").innerText())
    .replace(/\s+/g, " ")
    .trim();
};

// When it investigates - or that it does not - above the fix.
const timingOf: (card: Locator, rowName: string) => Promise<string> = async (
  card: Locator,
  rowName: string,
): Promise<string> => {
  return (
    await rowOf(card, rowName).getByTestId("ai-rule-timing").innerText()
  ).trim();
};

const editRule: (
  page: Page,
  card: Locator,
  name: string,
) => Promise<Locator> = async (
  page: Page,
  card: Locator,
  name: string,
): Promise<Locator> => {
  const dialog: Locator = await openDialogWith(
    page,
    card
      .locator("tbody tr")
      .filter({ hasText: name })
      .getByRole("button", { name: "Edit", exact: true }),
  );
  // An edit dialog opens any step from its list.
  await openStep(dialog, "Fix");
  // Every rule's Fix step ends with More fields (an older one may ask nothing).
  await expect(moreFieldsButton(dialog)).toBeVisible();
  return dialog;
};

test.describe("the Fix step", () => {
  test("asks one question - whether OneUptime AI fixes, and whether it asks first - with no OneUptime AI or Runbooks choice, and More fields folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    // The choice the maintainer could not make sense of is gone.
    await expect(dialog).not.toContainText("Fix With");
    await expect(dialog).not.toContainText("Who fixes what this rule matches");
    await expect(
      dialog.getByRole("radio", { name: /^OneUptime AI/ }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: /^Runbooks/ })).toHaveCount(
      0,
    );

    // The one question, with its three answers, asking first by default.
    await expect(fixChoice(dialog, "Don't fix")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(fixChoice(dialog, "Ask before fixing")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(fixChoice(dialog, "Fix without asking")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(dialog).toContainText(DONT_FIX_DESCRIPTION);
    await expect(dialog).toContainText(FIX_WITHOUT_ASKING_DESCRIPTION);

    // The rest is folded, and its line says what the defaults do.
    await expect(moreFieldsButton(dialog)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(foldedSummary(dialog)).toHaveText(DEFAULTS_SUMMARY);
    // One sentence for them all, not one per field, each "OneUptime AI may".
    await expect(foldedSummary(dialog)).not.toContainText(ANY_RUNBOOK_SUMMARY);
    await expect(foldedSummary(dialog)).not.toContainText(REPOSITORIES_SUMMARY);
    // The agent on a cluster or host is no default of the rule's to name.
    await expect(foldedSummary(dialog)).not.toContainText(
      "fixes through the AI agent",
    );
    await expect(runbooksPicker(dialog)).toBeHidden();
    await expect(runnerPicker(dialog)).toBeHidden();
    await expect(repositoriesPicker(dialog)).toBeHidden();

    await screenshot(page, "fix-step-folded");
  });

  test("More fields holds the runbooks OneUptime AI may run - none is any - and the Runner - none is the Global Runner, where no Bash command runs", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    // Runbooks: empty is an answer of its own, so it is not "(Optional)".
    await expect(runbooksPicker(dialog)).toBeVisible();
    await expect(dialog).toContainText(RUNBOOKS_DESCRIPTION);
    await expect(runbooksPicker(dialog)).toHaveAttribute(
      "placeholder",
      "Any runbook",
    );
    await expect(dialog).not.toContainText("Runbooks (Optional)");

    // Run them every time waits for a runbook to run.
    await expect(everyTimeSwitch(dialog)).toHaveCount(0);

    /*
     * Runner: none picked shows the Global Runner - "If there are no
     * runners, it should use the global runner by default" - and the line
     * under it says OneUptime AI runs no Bash commands there, and how to
     * have them run. The field's own line says that commands on the
     * affected cluster or host go through its AI agent.
     */
    await expect(dialog).toContainText(RUNNER_DESCRIPTION);
    await expect(runnerPicker(dialog)).toBeVisible();
    await expect(
      dialog
        .getByTestId("auto-remediation-runner-picker")
        .locator(".ou-select__single-value"),
    ).toHaveText(GLOBAL_RUNNER);
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveText(
      GLOBAL_RUNNER_PICK_HELP,
    );
    await expect(
      dialog.getByTestId("auto-remediation-runner-picker"),
    ).not.toContainText(NO_RUNNER);
    await expect(dialog).not.toContainText(RETIRED_RUNNER_CHOICE);
    await expect(dialog).not.toContainText(ADD_RUNNER_HELP);
    // Nothing of a step's: nothing of the rule's waits on the Global Runner.
    await expect(
      dialog.getByTestId("auto-remediation-runner-picker-global-waiting"),
    ).toHaveCount(0);
    // Picking the Global Runner is how none is picked: nothing to clear.
    await expect(
      dialog
        .getByTestId("auto-remediation-runner-picker")
        .locator(".ou-select__clear-indicator"),
    ).toHaveCount(0);

    await screenshot(page, "fix-step-more-fields");
  });

  test("the Runner's choices: the Global Runner, then the project's own Runners with how each is doing - no AI agent, and never the Kubernetes agent's in-cluster Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await runnerPicker(dialog).click();

    const options: Array<string> = (
      await page.getByRole("option").allInnerTexts()
    ).map((text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    });

    expect(options).toEqual([
      `${GLOBAL_RUNNER} ${GLOBAL_RUNNER_DESCRIPTION}`,
      "office-runner · Never connected",
      "prod-eu-runner · Connected",
    ]);
    expect(options.join(" ")).not.toContain("kubernetes-agent/prod-us");
    expect(options.join(" ")).not.toContain(RETIRED_RUNNER_CHOICE);
    // The global Runners are read from their own route, as a step's are.
    expect(
      (await page.evaluate(() => {
        return (
          window as unknown as { __fixture: { globalRunnerReads: number } }
        ).__fixture.globalRunnerReads;
      })) > 0,
    ).toBe(true);

    await screenshot(page, "runner-choices");
  });

  test("the project's default Runner comes first, tagged, and a new rule starts on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "defaultRunner=prod",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    // Picked already: a new rule starts on the project's default.
    await expect(dialog).toContainText(
      "prod-eu-runner · Project default · Connected",
    );

    await runnerPicker(dialog).click();
    const options: Array<string> = (
      await page.getByRole("option").allInnerTexts()
    ).map((text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    });
    expect(options).toEqual([
      "prod-eu-runner · Project default · Connected",
      `${GLOBAL_RUNNER} ${GLOBAL_RUNNER_DESCRIPTION}`,
      "office-runner · Never connected",
    ]);
    await page.keyboard.press("Escape");
    // An own Runner picked: the field's line says it all, nothing under it.
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveCount(0);
    await screenshot(page, "runner-project-default");

    /*
     * Folded, the line names it - as a runbook step's names its Runner - so
     * where the rule's commands run is read without opening the fold.
     */
    await moreFieldsButton(dialog).click();
    const folded: Array<string> = await dialog
      .getByTestId("folded-section-item")
      .allInnerTexts();
    expect(folded.join(" ")).toContain("Runner: prod-eu-runner");

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["runnerId"]).toBe(RUNNER_IDS["prodEu"]);
  });

  test("folded, a rule on the Global Runner names no Runner, and one picked is named - one not connected says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    const foldedItems: () => Promise<Array<string>> = async (): Promise<
      Array<string>
    > => {
      return (
        await dialog.getByTestId("folded-section-item").allInnerTexts()
      ).map((text: string): string => {
        return text.replace(/\s+/g, " ").trim();
      });
    };

    /*
     * The Global Runner is the field's default, on which no command runs:
     * never named; the line lists the fields in their order, so it may
     * leave the field to its "more".
     */
    expect((await foldedItems()).join(" ")).not.toContain("Runner:");

    await openMoreFields(dialog);
    await pickOption(page, runnerPicker(dialog), /^office-runner/);
    await moreFieldsButton(dialog).click();

    // A Runner picked is always named, however many fields come before it.
    expect(await foldedItems()).toContain(
      "Runner: office-runner · Never connected",
    );
  });

  test("a rule's pick goes back to none by picking the Global Runner, which saves no Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "defaultRunner=prod",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    // A new rule starts on the project's default; no clear control beside it.
    await expect(dialog).toContainText(
      "prod-eu-runner · Project default · Connected",
    );
    await expect(
      dialog
        .getByTestId("auto-remediation-runner-picker")
        .locator(".ou-select__clear-indicator"),
    ).toHaveCount(0);

    await pickOption(page, runnerPicker(dialog), /^Global Runner/);
    await expect(
      dialog
        .getByTestId("auto-remediation-runner-picker")
        .locator(".ou-select__single-value"),
    ).toHaveText(GLOBAL_RUNNER);
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveText(
      GLOBAL_RUNNER_PICK_HELP,
    );

    await create(page, dialog);

    // None, as a rule that picked none always saved: never "global", never an id.
    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["runnerId"] || null).toBeNull();
  });

  test("a project that turned global Runners off reads No Runner, and a pick clears back to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "defaultRunner=prod&useGlobalRunners=0",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await runnerPicker(dialog).click();
    const options: Array<string> = (
      await page.getByRole("option").allInnerTexts()
    ).map((text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    });
    expect(options).toEqual([
      "prod-eu-runner · Project default · Connected",
      "office-runner · Never connected",
    ]);
    await page.keyboard.press("Escape");

    await dialog
      .getByTestId("auto-remediation-runner-picker")
      .locator(".ou-select__clear-indicator")
      .click();
    await expect(dialog).toContainText(NO_RUNNER);
    // The project said no to global Runners: nothing names one here.
    await expect(
      dialog.getByTestId("auto-remediation-runner-picker"),
    ).not.toContainText("Global Runner");
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveCount(0);
    await screenshot(page, "runner-global-runners-off");

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["runnerId"] || null).toBeNull();
  });

  test("a Global Runner not heard from lately is shown so, and nothing of the rule's waits on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "globalRunners=disconnected",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(
      dialog
        .getByTestId("auto-remediation-runner-picker")
        .locator(".ou-select__single-value"),
    ).toHaveText("Global Runner · Disconnected");
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveText(
      GLOBAL_RUNNER_PICK_HELP,
    );
    // A step on it would wait in the queue; a rule runs nothing there.
    await expect(
      dialog.getByTestId("auto-remediation-runner-picker-global-waiting"),
    ).toHaveCount(0);
  });

  test("a rule made without opening More fields investigates right away and asks before fixing, with any runbook, no Runner, every repository and both pull requests", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates).toHaveLength(1);
    expect(sent.creates[0]!.model).toBe("AutoRemediationRule");
    expect(sent.creates[0]!.data["triggerEntityType"]).toBe("Incident");
    // There is no fixing without investigating: a rule made here does both.
    expect(sent.creates[0]!.data["investigates"]).toBe(true);
    expect(sent.creates[0]!.data["fixes"]).toBe(true);
    expect(sent.creates[0]!.data["onlyIfOpenAfterMinutes"] ?? null).toBeNull();
    // Always said, so a rule with runbooks is never read as "every time".
    expect(sent.creates[0]!.data["remediationAction"]).toBe("OneUptimeAI");
    expect(sent.creates[0]!.data["executionMode"]).toBe("Suggest");
    expect(idsOf(sent.creates[0]!.data["runbooks"])).toEqual([]);
    expect(sent.creates[0]!.data["runnerId"] || null).toBeNull();
    // Every connected repository, and both pull requests on.
    expect(idsOf(sent.creates[0]!.data["codeRepositories"])).toEqual([]);
    expect(sent.creates[0]!.data["openCodeFixPullRequests"]).toBe(true);
    expect(sent.creates[0]!.data["openTelemetryPullRequests"]).toBe(true);

    // Listed as asking first - and nothing more: OneUptime AI fixes every rule.
    expect(await fixOf(card, "Fix checkout")).toBe("Asks before fixing");
    expect(await timingOf(card, "Fix checkout")).toBe("Right away");
  });

  test("the runbooks and the Runner picked are sent, and the folded line names them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await pickOption(page, runbooksPicker(dialog), "Clear the CDN cache");
    await page.keyboard.press("Escape");

    await pickOption(page, runnerPicker(dialog), /^prod-eu-runner/);
    // The field's own line says what the Runner is for: nothing under it.
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveCount(0);

    // With runbooks named, the rule can run them every time - off unless said.
    await expect(everyTimeSwitch(dialog)).toBeVisible();
    await expect(everyTimeSwitch(dialog)).not.toBeChecked();
    await screenshot(page, "fix-step-picked");

    // Folded again, its line says what is set.
    await moreFieldsButton(dialog).click();
    await expect(dialog).toContainText("Runbooks: 2");
    await expect(dialog).toContainText("Runner: prod-eu-runner");
    await expect(foldedSummary(dialog)).not.toContainText(DEFAULTS_SUMMARY);
    await expect(foldedSummary(dialog)).not.toContainText(ANY_RUNBOOK_SUMMARY);
    // The defaults still left are each said: every MCP server and repository.
    await expect(foldedSummary(dialog)).toContainText(ALL_MCP_SERVERS_SUMMARY);
    await expect(foldedSummary(dialog)).toContainText(REPOSITORIES_SUMMARY);
    // "Run them every time" is off, so the line does not name it: named, it read as on.
    const folded: Array<string> = await dialog
      .getByTestId("folded-section-item")
      .allInnerTexts();
    expect(folded.join(" ")).toContain("Runbooks: 2");
    expect(folded.join(" ")).not.toContain(EVERY_TIME);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["remediationAction"]).toBe("OneUptimeAI");
    expect(idsOf(sent.creates[0]!.data["runbooks"])).toEqual(
      [RUNBOOK_IDS["restartCheckout"]!, RUNBOOK_IDS["clearCache"]!].sort(),
    );
    expect(sent.creates[0]!.data["runnerId"]).toBe(RUNNER_IDS["prodEu"]);
  });

  test("Run them every time: the rule starts its runbooks for every match, and picks no Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await page.keyboard.press("Escape");
    await pickOption(page, runnerPicker(dialog), /^office-runner/);

    await everyTimeSwitch(dialog).click();
    await expect(everyTimeSwitch(dialog)).toBeChecked();
    // OneUptime AI composes no commands for it, so there is no Runner to pick.
    await expect(runnerPicker(dialog)).toBeHidden();

    await dialog.getByRole("radio", { name: /^Fix without asking/ }).click();
    await screenshot(page, "fix-step-every-time");

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["remediationAction"]).toBe("Runbooks");
    expect(sent.creates[0]!.data["executionMode"]).toBe("FullAuto");
    expect(idsOf(sent.creates[0]!.data["runbooks"])).toEqual([
      RUNBOOK_IDS["restartCheckout"]!,
    ]);
    // The Runner picked before the switch went on is not kept.
    expect(sent.creates[0]!.data["runnerId"] || null).toBeNull();

    expect(await fixOf(card, "Fix checkout")).toBe(
      "Fixes without asking Its runbooks, every time",
    );
  });

  test("Run them every time needs a runbook to run", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await page.keyboard.press("Escape");
    await everyTimeSwitch(dialog).click();

    // Every runbook taken away again: the switch stays to be turned off.
    await dialog
      .getByRole("button", { name: /Remove Restart checkout/ })
      .click();
    await expect(everyTimeSwitch(dialog)).toBeChecked();

    await dialog.getByRole("button", { name: CREATE }).click();
    await expect(dialog).toContainText("Runbooks is required");
    expect((await recorded(page)).creates).toEqual([]);
  });

  /*
   * The screenshot the maintainer attached: a project with no Runner of its
   * own read "No Runner" and "Add a Runner ... for OneUptime AI to run
   * commands on". Now it reads the Global Runner, and says no Bash command
   * runs there, and where to add a Runner that will.
   */
  test("with no Runner of its own, a rule shows the Global Runner - its one choice - and is told where to add a Runner for Bash commands", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "runners=0" });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(
      dialog
        .getByTestId("auto-remediation-runner-picker")
        .locator(".ou-select__single-value"),
    ).toHaveText(GLOBAL_RUNNER);
    const help: Locator = dialog.getByTestId(RUNNER_HELP_TEST_ID);
    await expect(help).toHaveText(GLOBAL_RUNNER_ADD_HELP);
    // Where a Runner is added, in a new tab, so the rule being made stays.
    await expect(
      help.getByRole("link", { name: "Runbooks › Runners" }),
    ).toHaveAttribute("target", "_blank");
    await expect(dialog).not.toContainText(ADD_RUNNER_HELP);
    // A menu with one choice to read, not a box that cannot open.
    await runnerPicker(dialog).click();
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await screenshot(page, "no-runners-global-runner");

    // The rule still saves: it runs no command of its own.
    await create(page, dialog);
    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["runnerId"] || null).toBeNull();
  });

  test("with no Runner of its own and no global Runner, a rule reads No Runner, has nothing to pick, and is told where to add one", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "runners=0&globalRunners=0",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    // Where a Runner is added, in a new tab, so the rule being made stays.
    const help: Locator = dialog.getByTestId(RUNNER_HELP_TEST_ID);
    await expect(help).toHaveText(ADD_RUNNER_HELP);
    await expect(
      help.getByRole("link", { name: "Runbooks › Runners" }),
    ).toHaveAttribute("target", "_blank");
    await expect(dialog).toContainText(NO_RUNNER);
    // Drawn, with nothing to open: no menu to tab to.
    await expect(
      dialog
        .getByTestId("auto-remediation-runner-picker")
        .locator(".ou-select__control--is-disabled"),
    ).toHaveCount(1);
    await expect(runnerPicker(dialog)).toHaveCount(0);
    await screenshot(page, "no-runners");

    // The rule still saves: it runs no command of its own.
    await create(page, dialog);
    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["runnerId"] || null).toBeNull();
  });

  /*
   * A rule that only investigates - what an investigation rule was - is a
   * rule whose Fix answer is Don't fix: More fields keeps what OneUptime AI
   * reads and thinks with, and drops what only a fix uses.
   */
  test("Don't fix: the rule only investigates - no runbooks, Runner or pull requests to set - and is sent as fixing nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    await fixChoice(dialog, "Don't fix").click();
    await expect(fixChoice(dialog, "Don't fix")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Folded, the line says what such a rule may read.
    await expect(foldedSummary(dialog)).toHaveText(NOT_FIXING_DEFAULTS_SUMMARY);

    await openMoreFields(dialog);
    await expect(repositoriesPicker(dialog)).toBeVisible();
    await expect(mcpServersPicker(dialog)).toBeVisible();
    await expect(runbooksPicker(dialog)).toHaveCount(0);
    await expect(runnerPicker(dialog)).toHaveCount(0);
    await expect(pullRequestSwitch(dialog, FIX_PULL_REQUESTS)).toHaveCount(0);
    await expect(
      pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS),
    ).toHaveCount(0);
    await dialogScreenshot(
      dialog,
      dialog.getByTestId("rule-code-repositories-hint"),
      "dont-fix-more-fields",
    );

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["investigates"]).toBe(true);
    expect(sent.creates[0]!.data["fixes"]).toBe(false);
    expect(sent.creates[0]!.data["runnerId"] || null).toBeNull();
    expect(idsOf(sent.creates[0]!.data["runbooks"])).toEqual([]);

    expect(await fixOf(card, "Fix checkout")).toBe("Doesn't fix");
    expect(await timingOf(card, "Fix checkout")).toBe("Right away");
  });

  test("an answer taken back keeps what was picked: Don't fix, then Fix without asking, sends the runbooks", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await page.keyboard.press("Escape");

    await fixChoice(dialog, "Don't fix").click();
    await expect(runbooksPicker(dialog)).toHaveCount(0);
    await fixChoice(dialog, "Fix without asking").click();
    await expect(runbooksPicker(dialog)).toBeVisible();

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["fixes"]).toBe(true);
    expect(sent.creates[0]!.data["executionMode"]).toBe("FullAuto");
    expect(idsOf(sent.creates[0]!.data["runbooks"])).toEqual([
      RUNBOOK_IDS["restartCheckout"]!,
    ]);
    expect(await fixOf(card, "Fix checkout")).toBe("Fixes without asking");
  });
});

/*
 * The maintainer, on external MCP servers: "In the auto remediation rule
 * ... you can allow certain MCP servers to be picked, or in the
 * investigation rule ... If there are no MCP servers selected, by default,
 * you can say, 'Allow all MCP servers to be used.' They should be in more
 * options and not directly visible by default." One AI rule names them
 * once, for the investigation and the fix.
 */
const MCP_SERVER_IDS: Record<string, string> = {
  aws: "c0000000-0000-4000-8000-000000000e01",
  github: "c0000000-0000-4000-8000-000000000e02",
};
const ALL_MCP_SERVERS_SUMMARY: string =
  "OneUptime AI may use all of your MCP servers.";
const MCP_DESCRIPTION: string =
  "OneUptime AI may use all of your MCP servers. Pick some to let it use only those.";

const mcpServersPicker: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByRole("combobox", { name: "MCP Servers" });
};

test.describe("MCP servers", () => {
  test("folded under More fields: none picked is all of them, said in its line, with where to add them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    // Not on the step itself: folded, its line says what the default does.
    await expect(mcpServersPicker(dialog)).toBeHidden();
    await expect(foldedSummary(dialog)).toHaveText(DEFAULTS_SUMMARY);

    await openMoreFields(dialog);
    await expect(mcpServersPicker(dialog)).toBeVisible();
    await expect(mcpServersPicker(dialog)).toHaveAttribute(
      "placeholder",
      "All MCP servers",
    );
    await expect(dialog).toContainText(MCP_DESCRIPTION);
    await expect(dialog).not.toContainText("MCP Servers (Optional)");

    // Where the servers are added, as a link to that page.
    const link: Locator = dialog.getByTestId("rule-mcp-servers-link");
    await expect(link).toHaveText("External MCP Servers");
    const href: string = (await link.getAttribute("href")) || "";
    expect(new URL(href, "http://127.0.0.1").pathname).toBe(
      `/dashboard/${PROJECT_ID}/settings/external-mcp-servers`,
    );

    await screenshot(page, "mcp-servers-more-fields");
  });

  test("the MCP servers picked are sent, and the folded line names them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, mcpServersPicker(dialog), "AWS");
    await page.keyboard.press("Escape");

    await moreFieldsButton(dialog).click();
    const folded: Array<string> = await dialog
      .getByTestId("folded-section-item")
      .allInnerTexts();
    expect(folded.join(" ")).toContain("MCP Servers: 1");
    /*
     * The folded line, not the dialog: the field's own line, kept in the
     * folded section, starts with the same words.
     */
    await expect(foldedSummary(dialog)).not.toContainText(
      ALL_MCP_SERVERS_SUMMARY,
    );
    // The defaults left, each said: any runbook, every repository.
    await expect(foldedSummary(dialog)).toContainText(ANY_RUNBOOK_SUMMARY);
    await expect(foldedSummary(dialog)).toContainText(REPOSITORIES_SUMMARY);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.model).toBe("AutoRemediationRule");
    expect(idsOf(sent.creates[0]!.data["externalMcpServers"])).toEqual([
      MCP_SERVER_IDS["aws"]!,
    ]);
  });

  test("a rule made without opening More fields names none: all of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(idsOf(sent.creates[0]!.data["externalMcpServers"])).toEqual([]);
  });

  /*
   * A new rule investigates, with the MCP servers' tools that read, so it
   * keeps the field even when it runs its runbooks every time. A rule that
   * was an auto remediation rule and only fixes - its runbooks, every time -
   * uses no MCP server, so it is not asked, until it investigates too.
   */
  test("a rule that runs its runbooks every time and does not investigate uses no MCP server, so it is not asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Restart checkout every time",
    );
    await openMoreFields(dialog);
    await expect(everyTimeSwitch(dialog)).toBeChecked();
    await expect(mcpServersPicker(dialog)).toHaveCount(0);

    await openStep(dialog, "Investigate");
    await dialog.getByRole("button", { name: INVESTIGATE_TOO }).click();
    await openStep(dialog, "Fix");
    await openMoreFields(dialog);
    await expect(mcpServersPicker(dialog)).toBeVisible();
  });

  test("a new rule that runs its runbooks every time still investigates with the MCP servers", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await page.keyboard.press("Escape");
    await everyTimeSwitch(dialog).click();
    await expect(everyTimeSwitch(dialog)).toBeChecked();
    await expect(mcpServersPicker(dialog)).toBeVisible();
  });

  test("a rule that doesn't fix still names the MCP servers it investigates with, and they are sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await fixChoice(dialog, "Don't fix").click();

    // Folded, with what the defaults do.
    await expect(mcpServersPicker(dialog)).toBeHidden();
    await expect(foldedSummary(dialog)).toHaveText(NOT_FIXING_DEFAULTS_SUMMARY);

    await openMoreFields(dialog);
    await expect(dialog).toContainText(MCP_DESCRIPTION);
    await expect(mcpServersPicker(dialog)).toHaveAttribute(
      "placeholder",
      "All MCP servers",
    );
    await pickOption(page, mcpServersPicker(dialog), "GitHub");
    await page.keyboard.press("Escape");
    await screenshot(page, "dont-fix-mcp-servers");

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["fixes"]).toBe(false);
    expect(idsOf(sent.creates[0]!.data["externalMcpServers"])).toEqual([
      MCP_SERVER_IDS["github"]!,
    ]);
  });
});

test.describe("rules saved before", () => {
  test("the table names each rule for what it does, and asks of none of them which fixes it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    await expect(card.locator("tbody tr")).toHaveCount(4);

    // One Fix column: no "Fixed by" saying OneUptime AI on every row.
    const headers: Array<string> = (
      await card.locator("thead th").allInnerTexts()
    ).map((text: string): string => {
      return text.trim();
    });
    // One column says what each rule does, its fix under its timing.
    expect(headers).toContain(COLUMN);
    expect(headers).not.toContain("Investigates");
    expect(headers).not.toContain("Fix");
    expect(headers).not.toContain("Fixed by");
    expect(headers).not.toContain("Approval");

    /*
     * The one merged with an investigation rule of the same conditions
     * investigates right away; the others were auto remediation rules in a
     * lane whose investigation rules decided what is investigated: they only
     * fix, and say so.
     */
    expect(await timingOf(card, "Fix database incidents")).toBe("Right away");
    for (const name of [
      "Restart checkout every time",
      "Commands on the bastion",
      "AI picks a runbook",
    ]) {
      expect(await timingOf(card, name)).toBe("Doesn't investigate");
    }

    expect(await fixOf(card, "Fix database incidents")).toBe(
      "Asks before fixing",
    );
    expect(await fixOf(card, "Restart checkout every time")).toBe(
      "Fixes without asking Its runbooks, every time",
    );
    expect(await fixOf(card, "Commands on the bastion")).toBe(
      "Asks before fixing OneUptime AI: commands on Runners",
    );
    // A runbook AI picks for such a rule is always proposed.
    expect(await fixOf(card, "AI picks a runbook")).toBe(
      "Asks before fixing OneUptime AI: picks a runbook",
    );

    await screenshot(page, "rules-saved");
  });

  test("the table fits its card beside the side menu at 1280px: Status never sits under the row actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * The Dashboard's side menu and gaps leave the page about 940px at a
     * 1280px window; this fixture has no side menu, so a 1000px window
     * gives its card the same width.
     */
    await page.setViewportSize({ width: 1000, height: 900 });
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    await expect(card.locator("tbody tr")).toHaveCount(4);

    const layout: {
      scroll: number;
      client: number;
      statusRight: number;
      actionsLeft: number;
    } = await card.evaluate((element: Element) => {
      const table: HTMLTableElement = element.querySelector("table")!;
      const scroller: HTMLElement = table.parentElement!;
      const headers: Array<HTMLElement> = Array.from(
        element.querySelectorAll("thead th"),
      ) as Array<HTMLElement>;
      const status: HTMLElement = headers.find((th: HTMLElement) => {
        return (th.innerText || "").trim() === "Status";
      })!;
      const actions: HTMLElement = headers[headers.length - 1]!;

      return {
        scroll: scroller.scrollWidth,
        client: scroller.clientWidth,
        statusRight: status.getBoundingClientRect().right,
        actionsLeft: actions.getBoundingClientRect().left,
      };
    });

    expect(layout.scroll).toBeLessThanOrEqual(layout.client + 1);
    expect(layout.statusRight).toBeLessThanOrEqual(layout.actionsLeft + 1);
    await screenshot(page, "rules-saved-1280");
  });

  test("a rule that runs its runbooks every time opens with them, the switch on and no Runner, and keeps doing so", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Restart checkout every time",
    );

    // Folded, its line says what is set.
    await expect(dialog).toContainText("Runbooks: 1");
    await expect(dialog).toContainText(`${EVERY_TIME}: On`);

    await openMoreFields(dialog);
    await expect(everyTimeSwitch(dialog)).toBeChecked();
    await expect(runnerPicker(dialog)).toBeHidden();
    await screenshot(page, "edit-every-time");

    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["everyTime"];
      },
    );
    expect(update).toBeDefined();
    expect(update!.data["remediationAction"]).toBe("Runbooks");
    expect(idsOf(update!.data["runbooks"])).toEqual([
      RUNBOOK_IDS["restartCheckout"]!,
    ]);
  });

  test("a OneUptime AI rule opens with its runbooks and its Runner, and goes back to none by picking the Global Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Fix database incidents",
    );

    await expect(dialog).toContainText("Runbooks: 2");
    await openMoreFields(dialog);

    await expect(everyTimeSwitch(dialog)).not.toBeChecked();
    await expect(dialog).toContainText("prod-eu-runner · Connected");
    await screenshot(page, "edit-ai-with-runner");

    // The Global Runner stands for none: picked, it says no Bash command runs there.
    await pickOption(page, runnerPicker(dialog), /^Global Runner/);
    await expect(
      dialog
        .getByTestId("auto-remediation-runner-picker")
        .locator(".ou-select__single-value"),
    ).toHaveText(GLOBAL_RUNNER);
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveText(
      GLOBAL_RUNNER_PICK_HELP,
    );

    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["aiWithRunner"];
      },
    );
    expect(update).toBeDefined();
    expect(update!.data["remediationAction"]).toBe("OneUptimeAI");
    expect(update!.data["runnerId"] || null).toBeNull();
    expect(idsOf(update!.data["runbooks"])).toEqual(
      [RUNBOOK_IDS["failoverDatabase"]!, RUNBOOK_IDS["clearCache"]!].sort(),
    );
  });

  test("an older rule that composes commands says so first, keeps its Runner, and saves as it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Commands on the bastion",
    );

    // What it still does, first on the step.
    const note: Locator = dialog.getByTestId(OLDER_RULE_TEST_ID);
    await expect(note).toContainText(OLDER_COMMANDS_NOTE);
    await expect(
      note.getByRole("button", { name: FIX_LIKE_A_NEW_RULE }),
    ).toBeVisible();
    // Asking first still applies to its commands; its runbooks never do.
    await expect(
      dialog.getByRole("radio", { name: /^Ask before fixing/ }),
    ).toHaveAttribute("aria-checked", "true");
    await openMoreFields(dialog);
    await expect(runbooksPicker(dialog)).toHaveCount(0);
    await expect(everyTimeSwitch(dialog)).toHaveCount(0);
    await expect(dialog).toContainText("office-runner · Never connected");
    await screenshot(page, "edit-older-commands");

    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["commands"];
      },
    );
    expect(update).toBeDefined();
    // Saved as it was: still an older rule that composes commands.
    expect(update!.data["aiComposesCommands"]).toBe(true);
    expect(update!.data["aiSelectsRunbook"]).toBe(false);
    expect(idOfValue(update!.data["runnerId"])).toBe(RUNNER_IDS["office"]);
    expect(await fixOf(card, "Commands on the bastion")).toBe(
      "Asks before fixing OneUptime AI: commands on Runners",
    );
  });

  test("an older rule that picks a runbook: no Approval or Runner that would do nothing, and Fix like a new rule makes it a new rule that asks first", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(page, card, "AI picks a runbook");

    const note: Locator = dialog.getByTestId(OLDER_RULE_TEST_ID);
    await expect(note).toContainText(OLDER_PICKS_NOTE);
    // It always asks: the question would only contradict the table.
    await expect(
      dialog.getByRole("radio", { name: /^Fix without asking/ }),
    ).toHaveCount(0);
    await expect(moreFieldsButton(dialog)).toContainText("Runbooks");
    await expect(moreFieldsButton(dialog)).not.toContainText("Runner");
    await screenshot(page, "edit-older-picks");

    await note.getByRole("button", { name: FIX_LIKE_A_NEW_RULE }).click();

    // Now a rule like any new one: the note gone, every field back, asking first.
    await expect(note).toHaveCount(0);
    await expect(
      dialog.getByRole("radio", { name: /^Ask before fixing/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(foldedSummary(dialog)).toContainText(DEFAULTS_SUMMARY);
    await openMoreFields(dialog);
    await expect(runnerPicker(dialog)).toBeVisible();
    await screenshot(page, "edit-older-picks-fixed");

    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["picks"];
      },
    );
    expect(update).toBeDefined();
    expect(update!.data["aiSelectsRunbook"]).toBe(false);
    expect(update!.data["aiComposesCommands"]).toBe(false);
    expect(update!.data["remediationAction"]).toBe("OneUptimeAI");
    // It fixed without asking on paper; made new, it asks until told not to.
    expect(update!.data["executionMode"]).toBe("Suggest");
    expect(await fixOf(card, "AI picks a runbook")).toBe("Asks before fixing");
  });

  test("a rule that only fixes says so on its Investigate step, and Investigate too makes it investigate right away", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Restart checkout every time",
    );

    await openStep(dialog, "Investigate");
    const note: Locator = dialog.getByTestId("ai-rule-only-fixes-note");
    await expect(note).toContainText(ONLY_FIXES_NOTE);
    // The question it does not answer is not asked.
    await expect(
      dialog.getByRole("radio", { name: /^Right away/ }),
    ).toHaveCount(0);
    await dialogScreenshot(dialog, note, "edit-only-fixes");

    await note.getByRole("button", { name: INVESTIGATE_TOO }).click();
    await expect(note).toHaveCount(0);
    await expect(
      dialog.getByRole("radio", { name: /^Right away/ }),
    ).toBeChecked();

    // Saved from the last step, Fix.
    await openStep(dialog, "Fix");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["everyTime"];
      },
    );
    expect(update).toBeDefined();
    expect(update!.data["investigates"]).toBe(true);
    expect(update!.data["fixes"]).toBe(true);
    // Still what it was: its runbooks, every time.
    expect(update!.data["remediationAction"]).toBe("Runbooks");
    expect(await timingOf(card, "Restart checkout every time")).toBe(
      "Right away",
    );
  });

  test("a rule that only fixes cannot be made to do nothing: Don't fix says to investigate first", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Restart checkout every time",
    );

    await fixChoice(dialog, "Don't fix").click();
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toContainText(
      "A rule that doesn't investigate must fix. Turn investigating on in the Investigate step first.",
    );
    await expect(dialog).toBeVisible();
    expect((await recorded(page)).updates).toEqual([]);
  });

  test("Cancel leaves an older rule as it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(page, card, "AI picks a runbook");

    await dialog
      .getByTestId(OLDER_RULE_TEST_ID)
      .getByRole("button", { name: FIX_LIKE_A_NEW_RULE })
      .click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    expect((await recorded(page)).updates).toEqual([]);
    expect(await fixOf(card, "AI picks a runbook")).toBe(
      "Asks before fixing OneUptime AI: picks a runbook",
    );
  });

  /*
   * Each note's button takes the note away. Pressed from the keyboard,
   * focus would fall back to the page with the button gone, and the next
   * Tab would start again from the dialog's top: it goes to the question
   * that takes the note's place instead (FocusWhenDrawn).
   */
  test("keyboard: Investigate too leaves focus on the answer of When to investigate", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Restart checkout every time",
    );

    await openStep(dialog, "Investigate");
    const investigateToo: Locator = dialog.getByRole("button", {
      name: INVESTIGATE_TOO,
    });
    await investigateToo.focus();
    await page.keyboard.press("Enter");

    const rightAway: Locator = dialog.getByRole("radio", {
      name: /^Right away/,
    });
    await expect(rightAway).toBeChecked();
    await expect(rightAway).toBeFocused();

    // The keyboard carries on from there: the other answer is one key away.
    await page.keyboard.press("ArrowDown");
    await expect(
      dialog.getByRole("radio", { name: /^Only if still open after a wait/ }),
    ).toBeChecked();
    await expect(
      dialog.getByTestId("investigation-rule-wait-minutes"),
    ).toBeVisible();
  });

  test("keyboard: Fix like a new rule leaves focus on the Fix answer it now asks", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(page, card, "AI picks a runbook");

    const fixLikeANewRule: Locator = dialog
      .getByTestId(OLDER_RULE_TEST_ID)
      .getByRole("button", { name: FIX_LIKE_A_NEW_RULE });
    await fixLikeANewRule.focus();
    await page.keyboard.press("Enter");

    const askFirst: Locator = dialog.getByRole("radio", {
      name: /^Ask before fixing/,
    });
    await expect(askFirst).toHaveAttribute("aria-checked", "true");
    await expect(askFirst).toBeFocused();
  });
});

test.describe("alerts", () => {
  test("an alert rule asks the same: Fix up front, the runbooks and the Runner folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { lane: "alert" });
    const dialog: Locator = await openFixStep(page, card);

    await expect(dialog).not.toContainText("Fix With");
    await expect(foldedSummary(dialog)).toContainText(DEFAULTS_SUMMARY);

    await openMoreFields(dialog);
    await pickOption(page, runbooksPicker(dialog), "Fail over the database");
    await page.keyboard.press("Escape");
    await pickOption(page, runnerPicker(dialog), /^prod-eu-runner/);
    await screenshot(page, "alert-fix-step");

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["triggerEntityType"]).toBe("Alert");
    expect(sent.creates[0]!.data["remediationAction"]).toBe("OneUptimeAI");
    expect(idsOf(sent.creates[0]!.data["runbooks"])).toEqual([
      RUNBOOK_IDS["failoverDatabase"]!,
    ]);
    expect(sent.creates[0]!.data["runnerId"]).toBe(RUNNER_IDS["prodEu"]);
  });
});

test.describe("people and screens", () => {
  test("a viewer reads the rules but cannot add or edit one", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "rules=saved&role=viewer",
    });
    await expect(card.locator("tbody tr")).toHaveCount(4);

    for (const button of await card
      .getByRole("button", { name: CREATE })
      .all()) {
      await expect(button).toBeDisabled();
    }

    for (const edit of await card
      .getByRole("button", { name: "Edit", exact: true })
      .all()) {
      await expect(edit).toBeDisabled();
    }
  });

  test("on a phone the Fix step reads top to bottom, and nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    const width: number = await page.evaluate(() => {
      return document.documentElement.scrollWidth;
    });
    expect(width).toBeLessThanOrEqual(390);

    await expect(runnerPicker(dialog)).toBeVisible();
    await screenshot(page, "phone");
  });

  test("dark mode", async ({ page }: { page: Page }) => {
    const card: Locator = await openRulesCard(page, { query: "theme=dark" });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);
    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await page.keyboard.press("Escape");

    await expect(page.locator("html")).toHaveClass(/dark/);
    await screenshot(page, "dark");
  });

  test("German: the Fix step and More fields in the Dashboard's German words", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "lang=de",
      isGerman: true,
    });
    // "{{itemName}} erstellen", the rule's German name in it.
    const createInGerman: string = GERMAN["Create {{itemName}}"]!.replace(
      "{{itemName}}",
      GERMAN["AI Rule"]!,
    );
    expect(createInGerman).toBe("KI-Regel erstellen");
    const dialog: Locator = await openDialogWith(
      page,
      card.getByRole("button", { name: createInGerman, exact: true }).first(),
    );

    // Match, Investigate, then the Fix step, which names the rule.
    await dialog.getByRole("button", { name: GERMAN["Next"]! }).click();
    await dialog.getByRole("button", { name: GERMAN["Next"]! }).click();
    await dialog.getByRole("textbox").first().fill("Checkout reparieren");

    for (const english of [
      FIX_DESCRIPTION,
      DONT_FIX_DESCRIPTION,
      FIX_WITHOUT_ASKING_DESCRIPTION,
      DEFAULTS_SUMMARY,
    ]) {
      expect(GERMAN[english]).toBeDefined();
      expect(GERMAN[english]).not.toBe(english);
      await expect(dialog).toContainText(GERMAN[english]!);
    }

    await dialog
      .getByRole("button", { name: new RegExp(GERMAN["More fields"]!) })
      .click();

    for (const english of [
      RUNBOOKS_DESCRIPTION,
      RUNNER_DESCRIPTION,
      REPOSITORIES_DESCRIPTION,
      MCP_DESCRIPTION,
      FIX_PULL_REQUESTS,
      TELEMETRY_PULL_REQUESTS,
    ]) {
      expect(GERMAN[english]).toBeDefined();
      expect(GERMAN[english]).not.toBe(english);
      await expect(dialog).toContainText(GERMAN[english]!);
    }

    // A rule that picks none shows the Global Runner, in German.
    await expect(dialog).toContainText(GERMAN["Global Runner"]!);
    await expect(dialog).toContainText(GERMAN[GLOBAL_RUNNER_PICK_HELP]!);
    // The repositories box's placeholder, as the MCP servers box draws its own.
    await expect(
      dialog.getByRole("combobox", { name: GERMAN["Code Repositories"]! }),
    ).toHaveAttribute("placeholder", GERMAN[ALL_REPOSITORIES]!);
    await screenshot(page, "german");
  });
});

/*
 * The code repositories OneUptime AI may use, and the two pull requests a
 * rule opens - "Both of these toggles should be inside of Remediation Rule,
 * inside of More, and they should be checked by default" - the maintainer.
 */
test.describe("code repositories and pull requests", () => {
  test("folded under More fields: none picked is all connected repositories, with where to connect them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    await expect(repositoriesPicker(dialog)).toBeHidden();
    await expect(foldedSummary(dialog)).toHaveText(DEFAULTS_SUMMARY);

    await openMoreFields(dialog);
    await expect(repositoriesPicker(dialog)).toBeVisible();
    await expect(repositoriesPicker(dialog)).toHaveAttribute(
      "placeholder",
      ALL_REPOSITORIES,
    );
    await expect(dialog).toContainText(REPOSITORIES_DESCRIPTION);
    await expect(dialog).not.toContainText("Code Repositories (Optional)");

    const hint: Locator = dialog.getByTestId("rule-code-repositories-hint");
    await expect(hint).toHaveText(REPOSITORIES_HINT);
    const href: string =
      (await hint
        .getByTestId("rule-code-repositories-link")
        .getAttribute("href")) || "";
    expect(new URL(href, "http://127.0.0.1").pathname).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories`,
    );

    await repositoriesPicker(dialog).click();
    await expect(page.getByRole("option")).toHaveCount(2);
    // By name, each with its GitHub organization/name under it.
    const options: Array<string> = (
      await page.getByRole("option").allInnerTexts()
    ).map((text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    });
    expect(options).toEqual([
      "billing acme/billing",
      "checkout acme/checkout-service",
    ]);
    await page.keyboard.press("Escape");

    await dialogScreenshot(
      dialog,
      dialog.getByTestId("rule-code-repositories-hint"),
      "code-repositories-more-fields",
    );
  });

  test("the repositories picked are sent, and the folded line counts them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, repositoriesPicker(dialog), /^checkout/);
    await page.keyboard.press("Escape");

    await moreFieldsButton(dialog).click();
    const folded: Array<string> = await dialog
      .getByTestId("folded-section-item")
      .allInnerTexts();
    expect(folded.join(" ")).toContain("Code Repositories: 1");
    await expect(foldedSummary(dialog)).not.toContainText(REPOSITORIES_SUMMARY);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(idsOf(sent.creates[0]!.data["codeRepositories"])).toEqual([
      CODE_REPOSITORY_IDS["checkout"]!,
    ]);
  });

  test("both pull requests are on for a new rule; one turned off is sent off", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(pullRequestSwitch(dialog, FIX_PULL_REQUESTS)).toBeChecked();
    await expect(
      pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS),
    ).toBeChecked();

    await pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS).click();
    await expect(
      pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS),
    ).not.toBeChecked();
    await dialogScreenshot(
      dialog,
      pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS),
      "pull-requests-more-fields",
    );

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["openCodeFixPullRequests"]).toBe(true);
    expect(sent.creates[0]!.data["openTelemetryPullRequests"]).toBe(false);
  });

  test("with both pull requests off, the folded line says only that it reads every repository", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pullRequestSwitch(dialog, FIX_PULL_REQUESTS).click();
    await pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS).click();
    await moreFieldsButton(dialog).click();

    // Every other default kept: one sentence, with no pull request in it.
    await expect(foldedSummary(dialog)).toHaveText(
      "OneUptime AI may use any of your runbooks, MCP servers and connected repositories.",
    );
    await expect(foldedSummary(dialog)).not.toContainText("pull request");

    // With a runbook picked, the repositories' own sentence says it.
    await openMoreFields(dialog);
    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await page.keyboard.press("Escape");
    await moreFieldsButton(dialog).click();
    await expect(foldedSummary(dialog)).toContainText(
      "OneUptime AI may read all connected repositories.",
    );
    await expect(foldedSummary(dialog)).not.toContainText(REPOSITORIES_SUMMARY);
  });

  test("a saved rule opens with its repository and its pull requests as it saved them, and keeps them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Fix database incidents",
    );

    await expect(dialog).toContainText("Code Repositories: 1");
    await openMoreFields(dialog);
    await expect(repositoryChips(dialog)).toHaveText(["checkout"]);
    await expect(pullRequestSwitch(dialog, FIX_PULL_REQUESTS)).toBeChecked();
    await expect(
      pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS),
    ).not.toBeChecked();
    await dialogScreenshot(
      dialog,
      pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS),
      "edit-repositories-and-pull-requests",
    );

    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["aiWithRunner"];
      },
    );
    expect(update).toBeDefined();
    expect(idsOf(update!.data["codeRepositories"])).toEqual([
      CODE_REPOSITORY_IDS["checkout"]!,
    ]);
    expect(update!.data["openCodeFixPullRequests"]).toBe(true);
    expect(update!.data["openTelemetryPullRequests"]).toBe(false);
  });

  /*
   * The three lists of what OneUptime AI may use - runbooks, MCP servers and
   * code repositories - are one kind of field, so they look alike: a search
   * box of one height with the picks as chips over it, and no chevron (that
   * is the single-pick Runner's). And a line under a box belongs to it: it
   * sits close under its own box, a field's gap above the next field - the
   * Runner's line too, drawn like the hints under the other pickers.
   */
  test("the repositories picker looks like the Runbooks and MCP Servers pickers, and each hint sits under its own field", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    const heights: Array<number> = [];

    for (const picker of [
      runbooksPicker(dialog),
      mcpServersPicker(dialog),
      repositoriesPicker(dialog),
    ]) {
      const box: { height: number } | null = await picker.boundingBox();
      expect(box).not.toBeNull();
      heights.push(Math.round(box!.height));
    }

    expect(new Set(heights).size).toBe(1);
    await expect(
      dialog
        .getByTestId("rule-code-repositories-picker")
        .locator(".ou-select__control"),
    ).toHaveCount(0);

    // In More fields' order: the repositories, the MCP servers, the provider.
    const nextFields: Array<[string, Locator, Locator]> = [
      [
        "rule-code-repositories-hint",
        repositoriesPicker(dialog),
        // The label holds the title and a space before its "(Optional)" slot.
        dialog.locator("label").filter({ hasText: /^MCP Servers\s*$/ }),
      ],
      [
        "rule-mcp-servers-hint",
        mcpServersPicker(dialog),
        dialog.locator("label").filter({ hasText: /^LLM Provider\s*$/ }),
      ],
      [
        RUNNER_HELP_TEST_ID,
        runnerPicker(dialog),
        pullRequestSwitch(dialog, FIX_PULL_REQUESTS),
      ],
    ];

    /*
     * Each gap is read in one frame. Opening More fields brings its fields
     * into view with a smooth scroll (FoldedSection, since #5292), and each
     * boundingBox() is a frame of its own: read one by one, a gap was taken
     * from two moments of the scroll (96 for a gap of a few pixels).
     */
    const gapsInOneFrame: (
      box: Locator,
      hint: Locator,
      next: Locator,
    ) => Promise<{ underItsBox: number; aboveTheNext: number }> = async (
      box: Locator,
      hint: Locator,
      next: Locator,
    ): Promise<{ underItsBox: number; aboveTheNext: number }> => {
      return page.evaluate(
        (elements: Array<SVGElement | HTMLElement>) => {
          const [boxRect, hintRect, nextRect] = elements.map(
            (element: SVGElement | HTMLElement): DOMRect => {
              return element.getBoundingClientRect();
            },
          ) as [DOMRect, DOMRect, DOMRect];

          return {
            underItsBox: hintRect.top - boxRect.bottom,
            aboveTheNext: nextRect.top - hintRect.bottom,
          };
        },
        [
          await box.elementHandle(),
          await hint.elementHandle(),
          await next.elementHandle(),
        ] as Array<ElementHandle<SVGElement | HTMLElement>>,
      );
    };

    for (const [hintTestId, box, next] of nextFields) {
      const hint: Locator = dialog.getByTestId(hintTestId);
      const { underItsBox, aboveTheNext } = await gapsInOneFrame(
        box,
        hint,
        next,
      );

      expect(underItsBox).toBeLessThan(aboveTheNext);
      // A field's gap: as wide as the one between two fields with no hint.
      expect(aboveTheNext).toBeGreaterThanOrEqual(16);
    }

    // The Runner's line is drawn as the hints are: their size and colour.
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveText(
      GLOBAL_RUNNER_PICK_HELP,
    );
    expect(await textStyleOf(dialog.getByTestId(RUNNER_HELP_TEST_ID))).toEqual(
      await textStyleOf(dialog.getByTestId("rule-code-repositories-hint")),
    );

    await dialogScreenshot(
      dialog,
      dialog.getByTestId("rule-code-repositories-hint"),
      "more-fields-one-look",
    );
  });

  test("a project with no repository has nothing to pick, and is told where to connect one", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "repositories=0",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(repositoriesPicker(dialog)).toHaveAttribute(
      "placeholder",
      ALL_REPOSITORIES,
    );
    await expect(dialog.getByTestId("rule-code-repositories-hint")).toHaveText(
      REPOSITORIES_HINT,
    );
    await repositoriesPicker(dialog).click();
    await expect(page.getByRole("option")).toHaveCount(0);
  });

  test("a plan without Code still saves a rule: the field reads all connected repositories, with nothing to pick", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "repositories=denied",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(repositoriesPicker(dialog)).toHaveAttribute(
      "placeholder",
      ALL_REPOSITORIES,
    );
    // Nothing on the form says it failed: the rule uses every repository.
    await expect(dialog.getByRole("alert")).toHaveCount(0);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates).toHaveLength(1);
    expect(idsOf(sent.creates[0]!.data["codeRepositories"])).toEqual([]);
  });

  /*
   * Picking repositories one at a time: Escape closes the list and leaves
   * the focus in the box, and a click on the box used to open nothing until
   * the box had lost the focus. It opens the list now.
   */
  test("after Escape, a click on the box opens the list again to pick another", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, repositoriesPicker(dialog), /^checkout/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(repositoriesPicker(dialog)).toBeFocused();
    await expect(dialog).toBeVisible();

    await repositoriesPicker(dialog).click();
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByRole("option", { name: /^billing/ }).click();
    await page.keyboard.press("Escape");
    await expect(repositoryChips(dialog)).toHaveText(["billing", "checkout"]);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(idsOf(sent.creates[0]!.data["codeRepositories"])).toEqual(
      [
        CODE_REPOSITORY_IDS["billing"]!,
        CODE_REPOSITORY_IDS["checkout"]!,
      ].sort(),
    );
  });

  /*
   * A repository is listed by the name it is called, with its GitHub
   * organization/name beside it. On a phone the two shrank alike, so a
   * short name beside a long GitHub name was cut first: "infra" read
   * "in...". The name takes the row now, and the GitHub name at most half.
   */
  test("on a phone, a short repository name is never cut short for its GitHub name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const card: Locator = await openRulesCard(page, {
      query: "repositories=many",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);
    await repositoriesPicker(dialog).click();

    const option: Locator = page.getByRole("option", { name: /^infra/ });
    await expect(option).toBeVisible();

    const measured: {
      name: string;
      isNameCut: boolean;
      isLineCut: boolean;
      lineWidth: number;
      rowWidth: number;
    } = await option.evaluate((element: Element) => {
      const spans: Array<HTMLElement> = Array.from(
        element.querySelectorAll(":scope > span"),
      ) as Array<HTMLElement>;
      const name: HTMLElement = spans[0]!;
      const line: HTMLElement = spans[1]!;

      return {
        name: name.textContent || "",
        isNameCut: name.scrollWidth > name.clientWidth,
        isLineCut: line.scrollWidth > line.clientWidth,
        lineWidth: line.getBoundingClientRect().width,
        rowWidth: element.getBoundingClientRect().width,
      };
    });

    expect(measured.name).toBe("infra");
    expect(measured.isNameCut).toBe(false);
    // The GitHub name gives way, and keeps at most half of the row.
    expect(measured.isLineCut).toBe(true);
    expect(measured.lineWidth).toBeLessThanOrEqual(measured.rowWidth / 2 + 1);

    // A long name gives way only after the GitHub name has.
    const longName: Locator = page.getByRole("option", {
      name: /^payments-gateway/,
    });
    await longName.scrollIntoViewIfNeeded();
    const longRow: { nameWidth: number; rowWidth: number } =
      await longName.evaluate((element: Element) => {
        const name: HTMLElement = element.querySelector(
          ":scope > span",
        ) as HTMLElement;

        return {
          nameWidth: name.getBoundingClientRect().width,
          rowWidth: element.getBoundingClientRect().width,
        };
      });
    expect(longRow.nameWidth).toBeGreaterThanOrEqual(longRow.rowWidth / 3);

    expect(
      await page.evaluate(() => {
        return document.documentElement.scrollWidth;
      }),
    ).toBeLessThanOrEqual(390);
    await screenshot(page, "code-repositories-menu-phone");
  });

  /*
   * The lines under the MCP Servers and Code Repositories fields link to
   * where those are added - in a new tab, as the Runner field's link to
   * Runbooks › Runners: the rule being edited stays. Coming back, the
   * repositories are read again, so one just connected can be picked.
   */
  test("the hints open their pages in a new tab, and a repository connected there can be picked on coming back", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(dialog.getByTestId("rule-mcp-servers-link")).toHaveAttribute(
      "target",
      "_blank",
    );
    const repositoriesLink: Locator = dialog.getByTestId(
      "rule-code-repositories-link",
    );
    await expect(repositoriesLink).toHaveAttribute("target", "_blank");

    const opened: Promise<Page> = page.context().waitForEvent("page");
    await repositoriesLink.click();
    const tab: Page = await opened;
    expect(new URL(tab.url()).pathname).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories`,
    );
    await tab.close();

    // The rule being edited is still here, as it was.
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(FIX_DESCRIPTION);

    // Connected in the other tab; this tab takes the focus back.
    await page.evaluate(() => {
      (
        window as unknown as {
          __fixture: { connectRepository: (name: string) => void };
        }
      ).__fixture.connectRepository("search");
      window.dispatchEvent(new Event("focus"));
    });

    await repositoriesPicker(dialog).click();
    await expect(page.getByRole("option")).toHaveCount(3);
    await page.getByRole("option", { name: /^search/ }).click();
    await page.keyboard.press("Escape");
    await expect(repositoryChips(dialog)).toHaveText(["search"]);
  });

  /*
   * The server keeps both switches on every rule, on unless turned off: a
   * rule saved before they moved here opens with both on, and keeps them.
   */
  test("a rule saved before the switches moved here opens with both pull requests on, and keeps them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Restart checkout every time",
    );

    // Folded, its line names neither as off: both are as a new rule has them.
    await expect(moreFieldsButton(dialog)).not.toContainText(
      `${FIX_PULL_REQUESTS}: Off`,
    );
    await expect(moreFieldsButton(dialog)).not.toContainText(
      `${TELEMETRY_PULL_REQUESTS}: Off`,
    );
    await openMoreFields(dialog);
    await expect(pullRequestSwitch(dialog, FIX_PULL_REQUESTS)).toBeChecked();
    await expect(
      pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS),
    ).toBeChecked();

    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["everyTime"];
      },
    );
    expect(update).toBeDefined();
    expect(update!.data["openCodeFixPullRequests"]).toBe(true);
    expect(update!.data["openTelemetryPullRequests"]).toBe(true);
  });

  /*
   * A repository a rule names that the reader may not read stays on the
   * rule, named as one they cannot access - in full: a chip cut at 14rem
   * ("A repository you do not have acces..." lost its last word there), and
   * a chip now shows the whole name, wrapping if it must.
   */
  test("a repository the reader cannot access stays on the rule, its chip named in full", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "rules=saved&hiddenRepository=1",
    });
    const dialog: Locator = await editRule(
      page,
      card,
      "Fix database incidents",
    );

    await expect(dialog).toContainText("Code Repositories: 2");
    await openMoreFields(dialog);
    await expect(repositoryChips(dialog)).toHaveText([
      "checkout",
      HIDDEN_REPOSITORY,
    ]);
    await expect(dialog).not.toContainText(HIDDEN_REPOSITORY_ID);

    const isCut: boolean = await repositoryChips(dialog)
      .nth(1)
      .evaluate((element: Element) => {
        return element.scrollWidth > element.clientWidth;
      });
    expect(isCut).toBe(false);
    await dialogScreenshot(
      dialog,
      repositoriesPicker(dialog),
      "code-repositories-hidden",
    );

    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["aiWithRunner"];
      },
    );
    expect(update).toBeDefined();
    expect(idsOf(update!.data["codeRepositories"])).toEqual(
      [CODE_REPOSITORY_IDS["checkout"]!, HIDDEN_REPOSITORY_ID].sort(),
    );
  });

  test("an alert rule asks the same", async ({ page }: { page: Page }) => {
    const card: Locator = await openRulesCard(page, { lane: "alert" });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, repositoriesPicker(dialog), /^billing/);
    await page.keyboard.press("Escape");
    await pullRequestSwitch(dialog, FIX_PULL_REQUESTS).click();

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["triggerEntityType"]).toBe("Alert");
    expect(idsOf(sent.creates[0]!.data["codeRepositories"])).toEqual([
      CODE_REPOSITORY_IDS["billing"]!,
    ]);
    expect(sent.creates[0]!.data["openCodeFixPullRequests"]).toBe(false);
    expect(sent.creates[0]!.data["openTelemetryPullRequests"]).toBe(true);
  });

  test("a rule that doesn't fix names the repositories it reads, opens no pull request, and picks no Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await fixChoice(dialog, "Don't fix").click();

    await expect(foldedSummary(dialog)).toHaveText(NOT_FIXING_DEFAULTS_SUMMARY);
    await openMoreFields(dialog);
    await expect(dialog).toContainText(REPOSITORIES_DESCRIPTION);
    await expect(runnerPicker(dialog)).toHaveCount(0);
    await expect(pullRequestSwitch(dialog, FIX_PULL_REQUESTS)).toHaveCount(0);

    await pickOption(page, repositoriesPicker(dialog), /^billing/);
    await page.keyboard.press("Escape");
    await dialogScreenshot(
      dialog,
      repositoriesPicker(dialog),
      "dont-fix-code-repositories",
    );

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["fixes"]).toBe(false);
    expect(idsOf(sent.creates[0]!.data["codeRepositories"])).toEqual([
      CODE_REPOSITORY_IDS["billing"]!,
    ]);
  });
});

/*
 * The AI card and the rule dialog, as a person sees them: 1280px and a
 * phone's 390px, light and dark - a rule that fixes, and one that doesn't.
 * The card draws fixing alone - no pull request switch under it - and
 * nothing runs off a phone's screen.
 */
test.describe("the AI card and the rule dialog, at 1280px and 390px, light and dark", () => {
  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`${width}px, ${theme}`, async ({ page }: { page: Page }) => {
        await page.setViewportSize({ width, height: 900 });
        const card: Locator = await openRulesCard(page, {
          query: theme === "dark" ? "theme=dark" : "",
        });
        if (theme === "dark") {
          await expect(page.locator("html")).toHaveClass(/dark/);
        }

        // The AI card: investigate, fix, the postmortem - no pull request.
        const aiCard: Locator = page.getByTestId("incident-ai-switches");
        await expect(aiCard.getByRole("switch")).toHaveCount(3);
        await expect(aiCard).not.toContainText(
          "Open a fix pull request when an investigation finds a code change",
        );
        await expect(aiCard).not.toContainText(
          "Open a pull request that adds missing telemetry",
        );
        fs.mkdirSync(SCREENSHOTS, { recursive: true });
        await aiCard.screenshot({
          path: path.join(SCREENSHOTS, `ai-card-${width}-${theme}.png`),
        });

        const dialog: Locator = await openFixStep(page, card);
        await openMoreFields(dialog);
        await expect(repositoriesPicker(dialog)).toBeVisible();
        await expect(
          pullRequestSwitch(dialog, FIX_PULL_REQUESTS),
        ).toBeVisible();

        const overflow: number = await page.evaluate(() => {
          return document.documentElement.scrollWidth;
        });
        expect(overflow).toBeLessThanOrEqual(width);
        await dialogScreenshot(
          dialog,
          pullRequestSwitch(dialog, TELEMETRY_PULL_REQUESTS),
          `ai-rule-more-fields-${width}-${theme}`,
        );

        // A rule that doesn't fix: what OneUptime AI reads, and nothing more.
        await fixChoice(dialog, "Don't fix").click();
        await expect(repositoriesPicker(dialog)).toBeVisible();
        await expect(runbooksPicker(dialog)).toHaveCount(0);
        expect(
          await page.evaluate(() => {
            return document.documentElement.scrollWidth;
          }),
        ).toBeLessThanOrEqual(width);
        await dialogScreenshot(
          dialog,
          dialog.getByTestId("rule-code-repositories-hint"),
          `ai-rule-dont-fix-more-fields-${width}-${theme}`,
        );
      });
    }
  }
});

/*
 * The LLM provider OneUptime AI uses for what a rule starts
 * (Common/Types/AI/LlmProviderChoice). The maintainer: "If the provider is
 * not selected, select the project LLM provider by default if one is set to
 * default, or you can select the global LLM provider as well. If one is
 * selected, use that LLM provider to do everything." So the field sits under
 * More fields - after the code repositories and MCP servers OneUptime AI
 * reads with, before what only a fix uses - its empty box names the
 * provider a rule that picks none uses, and so does the folded line while
 * there is more than one to pick from; a pick is sent with the rule and
 * named on the folded line. Every rule's field has the same one line, and a
 * locked box looks locked.
 */
const PROVIDER_IDS: Record<string, string> = {
  oneUptimeAi: "9d9d9d9d-0000-4000-8000-000000000001",
  azure: "9d9d9d9d-0000-4000-8000-000000000002",
  opus: "9d9d9d9d-0000-4000-8000-000000000003",
};
const PROVIDER_TITLE: string = "LLM Provider";
// The field's one line, the same on every kind of rule.
const PROVIDER_DESCRIPTION: string =
  "OneUptime AI uses the default LLM provider for everything this rule starts, unless you pick another.";
const PROJECT_DEFAULT_PLACEHOLDER: string = "Project default (Azure GPT-4o)";
const PROJECT_DEFAULT_SUMMARY: string =
  "The rule uses the project's default LLM provider, Azure GPT-4o.";
const UNAVAILABLE_WARNING: string =
  "OneUptime AI can no longer use this provider, so it uses the default instead. Pick another one, or clear it.";

const providerPicker: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByTestId("rule-llm-provider-picker");
};

// The search box, while nothing is picked.
const providerBox: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return providerPicker(dialog).getByRole("combobox");
};

// What the closed box shows as picked.
const providerShown: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return providerPicker(dialog).getByTestId("entity-dropdown-value");
};

const foldedItemsOf: (dialog: Locator) => Promise<Array<string>> = async (
  dialog: Locator,
): Promise<Array<string>> => {
  return (await dialog.getByTestId("folded-section-item").allInnerTexts()).map(
    (text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    },
  );
};

test.describe("the LLM provider a rule picks", () => {
  test("with a project default, the empty box and the folded line name it, and the providers are listed with what each is", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project",
    });
    const dialog: Locator = await openFixStep(page, card);

    // Folded: the provider first, then what the rest's defaults do.
    await expect(foldedSummary(dialog)).toHaveText(
      `${PROJECT_DEFAULT_SUMMARY} ${DEFAULTS_SUMMARY}`,
    );

    await openMoreFields(dialog);
    await expect(
      dialog.getByText(PROVIDER_TITLE, { exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText(PROVIDER_DESCRIPTION);
    // Empty is an answer of its own - the default - not "(Optional)".
    await expect(dialog).not.toContainText(`${PROVIDER_TITLE} (Optional)`);
    await expect(providerBox(dialog)).toHaveAttribute(
      "placeholder",
      PROJECT_DEFAULT_PLACEHOLDER,
    );
    await expect(dialog.getByTestId("rule-llm-provider-link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/llm-providers`,
    );
    await expect(dialog.getByTestId("rule-llm-provider-link")).toHaveAttribute(
      "target",
      "_blank",
    );

    /*
     * After what OneUptime AI reads with - the repositories and the MCP
     * servers - and before what only a fix uses: the runbooks and the Runner.
     */
    const order: Array<number> = [];
    for (const locator of [
      repositoriesPicker(dialog),
      mcpServersPicker(dialog),
      providerBox(dialog),
      runbooksPicker(dialog),
      runnerPicker(dialog),
    ]) {
      order.push((await locator.boundingBox())!.y);
    }
    expect(
      [...order].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(order);

    await providerBox(dialog).click();
    const options: Locator = page.getByRole("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText("Azure GPT-4o");
    await expect(options.nth(0)).toContainText("Project default · gpt-4o");
    await expect(options.nth(1)).toContainText("Claude Opus");
    await expect(options.nth(1)).toContainText("claude-opus-4-5");
    await expect(options.nth(2)).toContainText("OneUptime AI");
    await expect(options.nth(2)).toContainText("Global");
    await dialogScreenshot(dialog, providerPicker(dialog), "llm-provider-menu");
  });

  test("a pick is sent with the rule, and the folded line names it instead of the default", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await providerBox(dialog).click();
    await page.getByRole("option", { name: /^Claude Opus/ }).click();
    await expect(providerShown(dialog)).toContainText("Claude Opus");
    await dialogScreenshot(
      dialog,
      providerPicker(dialog),
      "llm-provider-picked",
    );

    await moreFieldsButton(dialog).click();
    expect(await foldedItemsOf(dialog)).toContain("LLM Provider: Claude Opus");
    await expect(foldedSummary(dialog)).toHaveText(DEFAULTS_SUMMARY);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(idOfValue(sent.creates[0]!.data["llmProviderId"])).toBe(
      PROVIDER_IDS["opus"],
    );
  });

  test("a rule made without picking one sends none: the default provider", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project",
    });
    const dialog: Locator = await openFixStep(page, card);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["llmProviderId"] || null).toBeNull();
  });

  test("a saved rule opens with its pick, folded and open, and clearing it saves none", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project&rules=saved&rulePick=opus",
    });
    const dialog: Locator = await editRule(
      page,
      card,
      "Fix database incidents",
    );

    expect(await foldedItemsOf(dialog)).toContain("LLM Provider: Claude Opus");
    await openMoreFields(dialog);
    await expect(providerShown(dialog)).toContainText("Claude Opus");

    await providerPicker(dialog).getByTestId("entity-dropdown-clear").click();
    await expect(providerBox(dialog)).toHaveAttribute(
      "placeholder",
      PROJECT_DEFAULT_PLACEHOLDER,
    );
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const update: Recorded["updates"][number] | undefined = sent.updates.find(
      (candidate: Recorded["updates"][number]): boolean => {
        return candidate.id === SAVED_RULE_IDS["aiWithRunner"];
      },
    );
    expect(update).toBeDefined();
    expect(update!.data["llmProviderId"] || null).toBeNull();
  });

  test("a pick the project can no longer use says so, and OneUptime AI uses the default instead", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project&rules=saved&rulePick=gone",
    });
    const dialog: Locator = await editRule(
      page,
      card,
      "Fix database incidents",
    );

    expect(await foldedItemsOf(dialog)).toContain(
      "LLM Provider: No longer available",
    );
    await openMoreFields(dialog);
    await expect(providerShown(dialog)).toContainText("No longer available");
    await expect(dialog.getByTestId("rule-llm-provider-warning")).toHaveText(
      UNAVAILABLE_WARNING,
    );
    await dialogScreenshot(
      dialog,
      dialog.getByTestId("rule-llm-provider-warning"),
      "llm-provider-unavailable",
    );
  });

  /*
   * A rule that only runs its runbooks every time, and does not investigate
   * - one that was an auto remediation rule - uses no AI: no provider to
   * pick, and its folded line names none. A new rule that runs them every
   * time still investigates, with its provider.
   */
  test("a rule that runs its runbooks every time and does not investigate uses no AI: no provider to pick", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project&rules=saved",
    });
    const dialog: Locator = await editRule(
      page,
      card,
      "Restart checkout every time",
    );

    await expect(foldedSummary(dialog)).not.toContainText("LLM provider");
    expect((await foldedItemsOf(dialog)).join(" ")).not.toContain(
      PROVIDER_TITLE,
    );
    await openMoreFields(dialog);
    await expect(everyTimeSwitch(dialog)).toBeChecked();
    await expect(providerPicker(dialog)).toHaveCount(0);
  });

  test("a new rule that runs its runbooks every time still investigates with its provider, and More fields stays open", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);
    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await page.keyboard.press("Escape");
    await expect(providerPicker(dialog)).toBeVisible();

    await everyTimeSwitch(dialog).click();
    await expect(everyTimeSwitch(dialog)).toBeChecked();
    await expect(providerPicker(dialog)).toBeVisible();
    await expect(moreFieldsButton(dialog)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("a reader who may not read the providers finds the box locked, naming the default", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=denied",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(providerBox(dialog)).toBeDisabled();
    await expect(providerBox(dialog)).toHaveAttribute(
      "placeholder",
      "Default LLM provider",
    );
  });

  test("a project with no provider at all says so in the box", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=none",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(providerBox(dialog)).toBeDisabled();
    await expect(providerBox(dialog)).toHaveAttribute(
      "placeholder",
      "No LLM provider yet",
    );

    /*
     * And looks locked: its box is grey where the Runbooks box beside it is
     * white. Both fills used to sit on a locked box, and white won in light
     * mode, so it looked like one to click.
     */
    const fillOf: (box: Locator) => Promise<string> = async (
      box: Locator,
    ): Promise<string> => {
      return box.evaluate((input: Element): string => {
        return getComputedStyle(input.parentElement!).backgroundColor;
      });
    };

    expect(await fillOf(runbooksPicker(dialog))).toBe("rgb(255, 255, 255)");
    expect(await fillOf(providerBox(dialog))).not.toBe(
      await fillOf(runbooksPicker(dialog)),
    );
  });

  /*
   * The fixture's project has the global provider alone: nothing to pick
   * between, so the folded line says nothing of it - the line every rule
   * shows stays as short as before rules could pick one. Open, the box
   * still names it, and it can be picked.
   */
  test("with the global provider alone, the folded line says nothing of providers; the box names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    await expect(foldedSummary(dialog)).toHaveText(DEFAULTS_SUMMARY);
    await expect(foldedSummary(dialog)).not.toContainText("LLM provider");

    await openMoreFields(dialog);
    await expect(providerBox(dialog)).toHaveAttribute(
      "placeholder",
      "Global provider (OneUptime AI)",
    );
    await expect(dialog).toContainText(PROVIDER_DESCRIPTION);
    await providerBox(dialog).click();
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option").first()).toContainText(
      "OneUptime AI",
    );
  });

  test("a provider added on LLM Providers, in another tab, can be picked on return", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await page.evaluate(() => {
      (
        window as unknown as {
          __fixture: { addProvider: (name: string) => void };
        }
      ).__fixture.addProvider("Gemini");
      window.dispatchEvent(new Event("focus"));
    });

    await providerBox(dialog).click();
    await expect(page.getByRole("option", { name: /^Gemini/ })).toBeVisible();
    await page.getByRole("option", { name: /^Gemini/ }).click();
    await expect(providerShown(dialog)).toContainText("Gemini");
  });

  test("a rule that doesn't fix picks one under its More fields, for its investigations, and it is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "providers=project",
    });
    const dialog: Locator = await openFixStep(page, card);
    await fixChoice(dialog, "Don't fix").click();

    await expect(foldedSummary(dialog)).toHaveText(
      `${PROJECT_DEFAULT_SUMMARY} ${NOT_FIXING_DEFAULTS_SUMMARY}`,
    );
    await openMoreFields(dialog);
    await expect(dialog).toContainText(PROVIDER_DESCRIPTION);
    // After the MCP servers, and nothing a fix uses after it.
    expect((await providerBox(dialog).boundingBox())!.y).toBeGreaterThan(
      (await mcpServersPicker(dialog).boundingBox())!.y,
    );
    await expect(runbooksPicker(dialog)).toHaveCount(0);

    await providerBox(dialog).click();
    await page.getByRole("option", { name: /^Claude Opus/ }).click();
    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["fixes"]).toBe(false);
    expect(idOfValue(sent.creates[0]!.data["llmProviderId"])).toBe(
      PROVIDER_IDS["opus"],
    );
  });
});

/*
 * The rule dialog's LLM Provider field, open, as a person sees it: 1280px
 * and a phone's 390px, light and dark - for a rule that fixes and one that
 * doesn't - the menu's choices with what each is, the line to LLM
 * Providers, and nothing running off the screen.
 */
test.describe("the LLM Provider field, at 1280px and 390px, light and dark", () => {
  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`${width}px, ${theme}`, async ({ page }: { page: Page }) => {
        await page.setViewportSize({ width, height: 900 });
        const card: Locator = await openRulesCard(page, {
          query: ["providers=project", theme === "dark" ? "theme=dark" : ""]
            .filter(Boolean)
            .join("&"),
        });
        if (theme === "dark") {
          await expect(page.locator("html")).toHaveClass(/dark/);
        }

        const dialog: Locator = await openFixStep(page, card);
        await openMoreFields(dialog);
        await expect(providerBox(dialog)).toBeVisible();
        await providerBox(dialog).click();
        await expect(page.getByRole("option")).toHaveCount(3);

        expect(
          await page.evaluate(() => {
            return document.documentElement.scrollWidth;
          }),
        ).toBeLessThanOrEqual(width);
        // The box fits its dialog.
        const dialogBox: { x: number; width: number } =
          (await dialog.boundingBox())!;
        const pickerBox: { x: number; width: number } =
          (await providerPicker(dialog).boundingBox())!;
        expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(
          dialogBox.x + dialogBox.width,
        );
        await dialogScreenshot(
          dialog,
          providerPicker(dialog),
          `ai-rule-llm-provider-${width}-${theme}`,
        );
        await page.keyboard.press("Escape");

        // A rule that doesn't fix keeps its provider, for its investigations.
        await fixChoice(dialog, "Don't fix").click();
        await expect(providerBox(dialog)).toBeVisible();
        expect(
          await page.evaluate(() => {
            return document.documentElement.scrollWidth;
          }),
        ).toBeLessThanOrEqual(width);
        await dialogScreenshot(
          dialog,
          dialog.getByTestId("rule-llm-provider-hint"),
          `ai-rule-dont-fix-llm-provider-${width}-${theme}`,
        );
      });
    }
  }
});

/*
 * A rule's AI context (issue #5198): notes for OneUptime AI about what the
 * rule matches - one product's architecture, its owners, where its logs
 * are - read after the project's AI context by the investigation and the
 * fix the rule starts. Under More fields, right after the LLM provider, as
 * a Markdown field counted against its 5,000 characters as it is typed;
 * named by its size on the folded line once written; not asked of a rule
 * that only runs its runbooks every time, which asks no AI anything.
 */
const AI_CONTEXT_FIELD_TEST_ID: string = "auto-remediation-ai-context-field";
const AI_CONTEXT_DESCRIPTION: string =
  "Notes OneUptime AI reads after the project's AI context when it investigates or fixes what this rule matches. Leave secrets out.";
const AI_CONTEXT_PLACEHOLDER: string =
  "For example: checkout's logs are in Loki under app=checkout, and payments-db is its database.";
// The count past its limit, in the field's red.
const TOO_LONG_CLASS: RegExp = /text-red-600/;
// The saved rule's notes, as the fixture holds them (?ruleContext=1).
const SAVED_RULE_NOTES: RegExp = /is a PostgreSQL primary on/;
// The page in dark mode.
const DARK_CLASS: RegExp = /dark/;

const aiContextEditor: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByTestId(AI_CONTEXT_FIELD_TEST_ID);
};

const aiContextLength: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByTestId("ai-context-length");
};

// The editor's Markdown source, where a test types.
const aiContextSource: (dialog: Locator) => Promise<Locator> = async (
  dialog: Locator,
): Promise<Locator> => {
  const editor: Locator = aiContextEditor(dialog);
  const toggle: Locator = editor.getByRole("button", {
    name: "Markdown",
    exact: true,
  });

  if (await toggle.isVisible()) {
    await toggle.click();
  }

  const textarea: Locator = editor.locator("textarea").first();
  await expect(textarea).toBeVisible();
  return textarea;
};

// About how many tokens a text of plain ASCII is read as.
const tokensOf: (text: string) => number = (text: string): number => {
  return Math.ceil(text.length / 4);
};

test.describe("a rule's AI context", () => {
  test("More fields holds it right after the LLM provider, with its line and its count", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await expect(aiContextEditor(dialog)).toBeVisible();
    await expect(dialog).toContainText(AI_CONTEXT_DESCRIPTION);
    await expect(aiContextLength(dialog)).toHaveText("0 of 5,000 characters");
    // Empty is an answer of its own - the project's notes alone.
    await expect(dialog).not.toContainText("AI context (Optional)");

    // After the LLM provider, before the runbooks.
    const order: Array<number> = await dialog.evaluate(
      (element: Element, testIds: Array<string>) => {
        return testIds.map((testId: string): number => {
          const field: Element | null = element.querySelector(
            `[data-testid='${testId}']`,
          );
          return field ? field.getBoundingClientRect().top : -1;
        });
      },
      [
        "rule-llm-provider-picker",
        AI_CONTEXT_FIELD_TEST_ID,
        "auto-remediation-runbooks-field",
      ],
    );

    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]!).toBeLessThan(order[1]!);
    expect(order[1]!).toBeLessThan(order[2]!);

    await dialogScreenshot(
      dialog,
      aiContextEditor(dialog),
      "ai-rule-ai-context-empty",
    );
  });

  test("notes typed are counted, named by their size on the folded line, and sent with the rule", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    const notes: string =
      "## Checkout\n\n- checkout-api runs on the payments cluster. Its logs are in Loki, app=checkout.";
    const source: Locator = await aiContextSource(dialog);
    await expect(source).toHaveAttribute("placeholder", AI_CONTEXT_PLACEHOLDER);
    await source.fill(notes);

    await expect(aiContextLength(dialog)).toHaveText(
      `${notes.length} of 5,000 characters · about ${tokensOf(notes)} tokens`,
    );

    await dialogScreenshot(
      dialog,
      aiContextEditor(dialog),
      "ai-rule-ai-context-written",
    );

    // Folded, the line names the notes by their size.
    await moreFieldsButton(dialog).click();
    expect((await foldedItemsOf(dialog)).join(" | ")).toContain(
      `AI context: about ${tokensOf(notes)} tokens`,
    );

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates).toHaveLength(1);
    expect(sent.creates[0]!.data["aiContext"]).toBe(notes);
  });

  test("a rule made without its notes sends none", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect([undefined, null, ""]).toContain(sent.creates[0]!.data["aiContext"]);
  });

  test("past 5,000 characters the count turns red and the rule is refused, saying what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    const source: Locator = await aiContextSource(dialog);
    await source.fill("a".repeat(5001));

    await expect(aiContextLength(dialog)).toContainText(
      "5,001 of 5,000 characters",
    );
    await expect(aiContextLength(dialog)).toHaveClass(TOO_LONG_CLASS);

    await dialog.getByRole("button", { name: CREATE }).click();

    await expect(dialog).toContainText("Use 5,000 characters or fewer.");
    await expect(dialog).toBeVisible();
    expect((await recorded(page)).creates).toEqual([]);
  });

  test("a rule that doesn't fix keeps it: its investigation reads the notes", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await fixChoice(dialog, "Don't fix").click();
    await openMoreFields(dialog);

    await expect(aiContextEditor(dialog)).toBeVisible();
  });

  test("a rule that only runs its runbooks every time asks no AI anything, so it is not asked for notes", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "rules=saved" });
    const dialog: Locator = await editRule(
      page,
      card,
      "Restart checkout every time",
    );
    await openMoreFields(dialog);

    await expect(everyTimeSwitch(dialog)).toBeChecked();
    await expect(aiContextEditor(dialog)).toHaveCount(0);

    // Investigating too, OneUptime AI works for it: its notes are asked.
    await openStep(dialog, "Investigate");
    await dialog.getByRole("button", { name: INVESTIGATE_TOO }).click();
    await openStep(dialog, "Fix");
    await openMoreFields(dialog);
    await expect(aiContextEditor(dialog)).toBeVisible();
  });

  test("a saved rule opens with its notes, and an edit sends the ones changed", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "rules=saved&ruleContext=1",
    });
    const dialog: Locator = await editRule(
      page,
      card,
      "Fix database incidents",
    );

    // Folded, its notes are named by their size.
    expect((await foldedItemsOf(dialog)).join(" | ")).toContain(
      "AI context: about",
    );

    await openMoreFields(dialog);

    const source: Locator = await aiContextSource(dialog);
    await expect(source).toHaveValue(SAVED_RULE_NOTES);

    await source.fill("Fail over payments-db only after checking lag.");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const update: { data: Record<string, unknown> } | undefined = (
      await recorded(page)
    ).updates.find((entry: { id: string }) => {
      return entry.id === SAVED_RULE_IDS["aiWithRunner"];
    });

    expect(update).toBeDefined();
    expect(update!.data["aiContext"]).toBe(
      "Fail over payments-db only after checking lag.",
    );
  });

  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`${width}px, ${theme}: the field fits its dialog, and the dialog the screen`, async ({
        page,
      }: {
        page: Page;
      }) => {
        const card: Locator = await openRulesCard(page, {
          query: [
            "rules=saved",
            "ruleContext=1",
            theme === "dark" ? "theme=dark" : "",
          ]
            .filter(Boolean)
            .join("&"),
        });
        if (theme === "dark") {
          await expect(page.locator("html")).toHaveClass(DARK_CLASS);
        }
        /*
         * The saved rule is opened from its table row, then the screen
         * narrowed: a phone draws the rules as cards, without the row.
         */
        const dialog: Locator = await editRule(
          page,
          card,
          "Fix database incidents",
        );
        await page.setViewportSize({ width, height: 900 });
        await openMoreFields(dialog);
        await expect(aiContextEditor(dialog)).toBeVisible();
        await aiContextEditor(dialog).scrollIntoViewIfNeeded();
        await expect(aiContextLength(dialog)).toContainText(
          "of 5,000 characters",
        );

        expect(
          await page.evaluate(() => {
            return document.documentElement.scrollWidth;
          }),
        ).toBeLessThanOrEqual(width);

        const dialogBox: { x: number; width: number } =
          (await dialog.boundingBox())!;
        const fieldBox: { x: number; width: number } =
          (await aiContextEditor(dialog).boundingBox())!;
        expect(fieldBox.x).toBeGreaterThanOrEqual(dialogBox.x);
        expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(
          dialogBox.x + dialogBox.width,
        );

        await dialogScreenshot(
          dialog,
          aiContextEditor(dialog),
          `ai-rule-ai-context-${width}-${theme}`,
        );
      });
    }
  }

  test("German: the field and its count in the Dashboard's German words", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "rules=saved&ruleContext=1&lang=de",
      isGerman: true,
    });
    const dialog: Locator = await openDialogWith(
      page,
      card
        .locator("tbody tr")
        .filter({ hasText: "Fix database incidents" })
        .getByRole("button", { name: GERMAN["Edit"] || "Edit", exact: true }),
    );
    await openStep(dialog, GERMAN["Fix"] || "Fix");
    // The fold's button starts with its title, then says what it holds.
    await dialog
      .getByRole("button", { name: GERMAN["More fields"] || "More fields" })
      .click();

    await expect(aiContextEditor(dialog)).toBeVisible();
    await expect(dialog).toContainText(GERMAN[AI_CONTEXT_DESCRIPTION]!);
    await expect(aiContextLength(dialog)).toContainText("von 5.000 Zeichen");
  });
});

/*
 * "If there are no runners, it should use the global runner by default" -
 * the maintainer, of a rule's Runner that read "No Runner". The field, open,
 * as a person sees it: 1280px and a phone's 390px, light and dark - in a
 * project with Runners of its own and in one with none - showing the Global
 * Runner, with the line that OneUptime AI runs no Bash commands there and
 * how to have them run, and nothing running off the screen; then in German
 * and in Persian, right to left, in the Dashboard's own words.
 */
const runnerField: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByTestId("auto-remediation-runner-picker");
};

const runnerShown: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return runnerField(dialog).locator(".ou-select__single-value");
};

// How a line of text is drawn: its size, its line height and its colour.
const textStyleOf: (locator: Locator) => Promise<{
  fontSize: string;
  lineHeight: string;
  color: string;
}> = async (
  locator: Locator,
): Promise<{ fontSize: string; lineHeight: string; color: string }> => {
  return locator.evaluate(
    (
      element: Element,
    ): { fontSize: string; lineHeight: string; color: string } => {
      const style: CSSStyleDeclaration = window.getComputedStyle(element);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        color: style.color,
      };
    },
  );
};

/*
 * Where each word of the picked value is drawn, from the left: a Persian
 * page reads the Global Runner's label right to left, its first word
 * rightmost.
 */
const wordLefts: (
  locator: Locator,
  words: Array<string>,
) => Promise<Array<number>> = async (
  locator: Locator,
  words: Array<string>,
): Promise<Array<number>> => {
  return locator.evaluate(
    (element: Element, wordList: Array<string>): Array<number> => {
      const text: string = element.textContent || "";
      const node: ChildNode | null = element.firstChild;

      return wordList.map((word: string): number => {
        const start: number = text.indexOf(word);
        if (!node || start < 0) {
          return Number.NaN;
        }
        const range: Range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + word.length);
        return range.getBoundingClientRect().left;
      });
    },
    words,
  );
};

// Whether a box ends inside another, on both sides.
const isInside: (
  inner: { x: number; width: number },
  outer: { x: number; width: number },
) => boolean = (
  inner: { x: number; width: number },
  outer: { x: number; width: number },
): boolean => {
  return (
    inner.x >= outer.x - 1 && inner.x + inner.width <= outer.x + outer.width + 1
  );
};

test.describe("the Runner field on the Global Runner, at 1280px and 390px, light and dark", () => {
  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`${width}px, ${theme}`, async ({ page }: { page: Page }) => {
        await page.setViewportSize({ width, height: 900 });

        for (const [state, query, help] of [
          ["runners", "", GLOBAL_RUNNER_PICK_HELP],
          ["no-runners", "runners=0", GLOBAL_RUNNER_ADD_HELP],
        ] as Array<[string, string, string]>) {
          const card: Locator = await openRulesCard(page, {
            query: [query, theme === "dark" ? "theme=dark" : ""]
              .filter(Boolean)
              .join("&"),
          });
          if (theme === "dark") {
            await expect(page.locator("html")).toHaveClass(/dark/);
          }

          const dialog: Locator = await openFixStep(page, card);
          await openMoreFields(dialog);

          await expect(runnerShown(dialog)).toHaveText(GLOBAL_RUNNER);
          const line: Locator = dialog.getByTestId(RUNNER_HELP_TEST_ID);
          await expect(line).toHaveText(help);
          await line.scrollIntoViewIfNeeded();
          // A quiet line, drawn as the hints under the rule's other pickers.
          expect(await textStyleOf(line)).toEqual(
            await textStyleOf(
              dialog.getByTestId("rule-code-repositories-hint"),
            ),
          );

          // Nothing runs off the screen, and the field and its line fit the dialog.
          expect(
            await page.evaluate(() => {
              return document.documentElement.scrollWidth;
            }),
          ).toBeLessThanOrEqual(width);
          const dialogBox: { x: number; width: number } =
            (await dialog.boundingBox())!;
          expect(
            isInside((await runnerPicker(dialog).boundingBox())!, dialogBox),
          ).toBe(true);
          expect(isInside((await line.boundingBox())!, dialogBox)).toBe(true);

          await dialogScreenshot(
            dialog,
            line,
            `runner-global-${state}-${width}-${theme}`,
          );

          // The menu, open: the Global Runner first, saying what it is.
          await runnerPicker(dialog).click();
          const options: Locator = page.getByRole("option");
          await expect(options).toHaveCount(state === "runners" ? 3 : 1);
          await expect(options.first()).toContainText(GLOBAL_RUNNER);
          await expect(options.first()).toContainText(
            GLOBAL_RUNNER_DESCRIPTION,
          );
          const firstOption: { x: number; width: number } = (await options
            .first()
            .boundingBox())!;
          expect(firstOption.x).toBeGreaterThanOrEqual(0);
          expect(firstOption.x + firstOption.width).toBeLessThanOrEqual(width);
          await dialogScreenshot(
            dialog,
            options.first(),
            `runner-global-${state}-menu-${width}-${theme}`,
          );
          await page.keyboard.press("Escape");
        }
      });
    }
  }
});

// The Dashboard's Persian words, as the fixture draws them with ?lang=fa.
const PERSIAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/fa.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

test.describe("the Runner field on the Global Runner, in German and Persian", () => {
  for (const [language, words, direction] of [
    ["de", GERMAN, "ltr"],
    ["fa", PERSIAN, "rtl"],
  ] as Array<[string, Record<string, string>, string]>) {
    test(`${language}: the Global Runner and its lines are the Dashboard's ${language} words, ${direction}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const word: (english: string) => string = (english: string): string => {
        expect({ english, translated: Boolean(words[english]) }).toEqual({
          english,
          translated: true,
        });
        return words[english]!;
      };

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(
        `/dashboard/${PROJECT_ID}/incidents/ai/settings?lang=${language}&runners=0`,
      );
      await expect(page.locator("html")).toHaveAttribute("dir", direction);
      await expect(advancedSection(page, "incident")).toBeVisible();

      const fold: Locator = advancedSection(page, "incident").getByRole(
        "button",
        { name: new RegExp(`^${escapeRegExp(word("More settings"))}`) },
      );
      await fold.click();
      await expect(fold).toHaveAttribute("aria-expanded", "true");

      const card: Locator = page
        .locator("[data-card-surface='section']")
        .filter({
          has: page.getByRole("heading", {
            name: word(CARD_TITLE),
            exact: true,
          }),
        });
      await expect(card).toBeVisible();

      const create: string = word("Create {{itemName}}").replace(
        "{{itemName}}",
        word("AI Rule"),
      );
      const dialog: Locator = await openDialogWith(
        page,
        card.getByRole("button", { name: create, exact: true }).first(),
      );

      // Match, Investigate, then the Fix step, which names the rule.
      await dialog.getByRole("button", { name: word("Next") }).click();
      await dialog.getByRole("button", { name: word("Next") }).click();
      await dialog.getByRole("textbox").first().fill("checkout");
      await dialog
        .getByRole("button", {
          name: new RegExp(escapeRegExp(word("More fields"))),
        })
        .click();

      await expect(dialog).toContainText(word(RUNNER_DESCRIPTION));
      await expect(runnerShown(dialog)).toHaveText(
        `${word("Global Runner")} · ${word("Connected")}`,
      );

      /*
       * The box lays the label out the page's way: in Persian, "Runner
       * سراسری · متصل" starts with a Latin word, and read by its own
       * direction it was drawn left to right, "Runner" stuck after
       * "Connected". Right to left, the words follow each other from the
       * right, as the menu draws them.
       */
      const valueLabel: Locator = runnerField(dialog).getByTestId(
        "dropdown-value-label",
      );
      expect(
        await valueLabel.evaluate((element: Element): string => {
          return window.getComputedStyle(element).direction;
        }),
      ).toBe(direction);
      const lefts: Array<number> = await wordLefts(
        valueLabel,
        `${word("Global Runner")} ${word("Connected")}`.split(" "),
      );
      for (const left of lefts) {
        expect(Number.isNaN(left)).toBe(false);
      }
      for (let index: number = 1; index < lefts.length; index++) {
        if (direction === "rtl") {
          expect(lefts[index]!).toBeLessThan(lefts[index - 1]!);
        } else {
          expect(lefts[index]!).toBeGreaterThan(lefts[index - 1]!);
        }
      }

      // The line, with Runbooks › Runners in the reader's words as its link.
      const line: Locator = dialog.getByTestId(RUNNER_HELP_TEST_ID);
      const addTemplate: string = word(
        "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Add a Runner under {{location}} to run them.",
      );
      await expect(line).toHaveText(
        addTemplate.replace("{{location}}", word("Runbooks › Runners")),
      );
      await expect(
        line.getByRole("link", { name: word("Runbooks › Runners") }),
      ).toHaveAttribute("target", "_blank");

      await runnerPicker(dialog).click();
      await expect(page.getByRole("option").first()).toContainText(
        word(GLOBAL_RUNNER_DESCRIPTION),
      );
      await dialogScreenshot(
        dialog,
        page.getByRole("option").first(),
        `runner-global-${language}`,
      );
      await page.keyboard.press("Escape");

      expect(
        await page.evaluate(() => {
          return document.documentElement.scrollWidth;
        }),
      ).toBeLessThanOrEqual(1280);
    });
  }
});
