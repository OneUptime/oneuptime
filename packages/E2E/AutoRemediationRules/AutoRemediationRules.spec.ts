import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Auto remediation rules - which new incidents (or alerts) OneUptime AI
 * fixes, and whether it asks first - on Incidents -> AI -> Settings and
 * Alerts -> AI -> Settings, in a browser, against the offline fixture
 * (AutoRemediationRules/Fixture).
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
 * actually run on." So the Runner picker lists the project's own Runners
 * only - its default first, and picked for a new rule - and a rule that
 * picks none reads "No Runner". "Both of these toggles should be inside of
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

const CARD_TITLE: string = "Auto remediation rules";
const CREATE: string = "Create Auto Remediation Rule";
const APPROVAL_DESCRIPTION: string =
  "OneUptime AI works out each fix. Choose whether it waits for someone to approve it.";
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
// An investigation rule's, while it holds both of its defaults.
const INVESTIGATION_DEFAULTS_SUMMARY: string =
  "OneUptime AI may use any of your MCP servers and connected repositories.";
/*
 * What the folded line says first while a rule picks no LLM provider: the
 * one it uses instead, by name. The fixture's project has the global
 * provider alone unless ?providers= says otherwise.
 */
const GLOBAL_PROVIDER_SUMMARY: string =
  "The rule uses the global LLM provider, OneUptime AI.";
const withProvider: (summary: string) => string = (summary: string): string => {
  return `${GLOBAL_PROVIDER_SUMMARY} ${summary}`;
};
const RUNBOOKS_DESCRIPTION: string =
  "OneUptime AI may run any of your runbooks. Pick some to let it run only those.";
const RUNNER_DESCRIPTION: string =
  "Where OneUptime AI runs Bash commands for this rule, inside your network. Commands on the affected cluster or host go through its AI agent.";
// What the Runner picker reads while a rule picks none.
const NO_RUNNER: string = "No Runner";
// The choice the picker no longer offers: that agent is not a Runner.
const RETIRED_RUNNER_CHOICE: string = "AI agent on the cluster or host";
// Under the picker only in a project with no Runner of its own.
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
const REMEDIATION_REPOSITORIES_DESCRIPTION: string =
  "OneUptime AI may read all of your connected repositories, and open pull requests in them. Pick some to let it use only those.";
const INVESTIGATION_REPOSITORIES_DESCRIPTION: string =
  "OneUptime AI may read all of your connected repositories while it investigates. Pick some to let it read only those.";
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

// The create dialog, walked to its Fix step: a name, then all incidents.
const openFixStep: (page: Page, card: Locator) => Promise<Locator> = async (
  page: Page,
  card: Locator,
): Promise<Locator> => {
  const dialog: Locator = await openDialogWith(
    page,
    card.getByRole("button", { name: CREATE }).first(),
  );

  await dialog.getByRole("textbox", { name: /^Name/ }).fill("Fix checkout");
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: /^All incidents|^All alerts/ }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog).toContainText(APPROVAL_DESCRIPTION);

  return dialog;
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

// The repositories picked, as the picker's chips draw them (EntityDropdown).
const repositoryChips: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog
    .getByTestId("rule-code-repositories-picker")
    .locator("div.flex-wrap > span span.truncate");
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

// The cell under a column of a row, by the column's header.
const cellOf: (
  card: Locator,
  rowName: string,
  column: string,
) => Promise<string> = async (
  card: Locator,
  rowName: string,
  column: string,
): Promise<string> => {
  const headers: Array<string> = (
    await card.locator("thead th").allInnerTexts()
  ).map((text: string): string => {
    return text.trim();
  });
  const index: number = headers.indexOf(column);
  expect(index).toBeGreaterThan(-1);

  const row: Locator = card
    .locator("tbody tr")
    .filter({ hasText: rowName })
    .first();

  return ((await row.locator("td").nth(index).innerText()) || "").trim();
};

// An id as a save sends it: a string, or an ObjectID left as the form read it.
const idOfValue: (value: unknown) => string = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  const row: Record<string, unknown> = (value || {}) as Record<string, unknown>;
  return String(row["value"] || row["_id"] || "");
};

// The Fix cell of a row, its pill and its line read as one sentence.
const fixOf: (card: Locator, rowName: string) => Promise<string> = async (
  card: Locator,
  rowName: string,
): Promise<string> => {
  return (await cellOf(card, rowName, "Fix")).replace(/\s+/g, " ");
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
  await dialog.getByText("Fix", { exact: true }).click();
  // Every rule's Fix step ends with More fields (an older one may ask nothing).
  await expect(moreFieldsButton(dialog)).toBeVisible();
  return dialog;
};

test.describe("the Fix step", () => {
  test("asks only whether a fix waits for approval: no OneUptime AI or Runbooks choice, and More fields folded", async ({
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

    // The one question: Approval, with its two answers, asking by default.
    await expect(
      dialog.getByRole("radio", { name: /^Ask before fixing/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      dialog.getByRole("radio", { name: /^Fix without asking/ }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(dialog).toContainText(FIX_WITHOUT_ASKING_DESCRIPTION);

    // The rest is folded, and its line says what the defaults do.
    await expect(moreFieldsButton(dialog)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(foldedSummary(dialog)).toHaveText(
      withProvider(DEFAULTS_SUMMARY),
    );
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

  test("More fields holds the runbooks OneUptime AI may run - none is any - and the Runner - none is No Runner", async ({
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
     * Runner: none picked reads No Runner, and the field's line says that
     * commands on the affected cluster or host go through its AI agent.
     * With Runners to pick from, no line under it repeats what it says.
     */
    await expect(dialog).toContainText(RUNNER_DESCRIPTION);
    await expect(runnerPicker(dialog)).toBeVisible();
    await expect(dialog).toContainText(NO_RUNNER);
    await expect(dialog).not.toContainText(RETIRED_RUNNER_CHOICE);
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveCount(0);
    await expect(dialog).not.toContainText(ADD_RUNNER_HELP);
    await expect(dialog).not.toContainText("Global Runner");

    await screenshot(page, "fix-step-more-fields");
  });

  test("the Runner's choices: the project's own Runners with how each is doing - no AI agent, and never the Kubernetes agent's in-cluster Runner", async ({
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
      "office-runner · Never connected",
      "prod-eu-runner · Connected",
    ]);
    expect(options.join(" ")).not.toContain("kubernetes-agent/prod-us");
    expect(options.join(" ")).not.toContain(RETIRED_RUNNER_CHOICE);

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
      "office-runner · Never connected",
    ]);
    await page.keyboard.press("Escape");
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

  test("folded, a rule with No Runner names the field alone, and one not connected says so", async ({
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

    // No Runner is the field's empty answer: "Runner", with nothing after it.
    expect(await foldedItems()).toContain("Runner");

    await openMoreFields(dialog);
    await pickOption(page, runnerPicker(dialog), /^office-runner/);
    await moreFieldsButton(dialog).click();

    expect(await foldedItems()).toContain(
      "Runner: office-runner · Never connected",
    );
  });

  test("a rule's pick can be cleared back to No Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "defaultRunner=prod",
    });
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await dialog
      .getByTestId("auto-remediation-runner-picker")
      .locator(".ou-select__clear-indicator")
      .click();
    await expect(dialog).toContainText(NO_RUNNER);

    await create(page, dialog);

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["runnerId"] || null).toBeNull();
  });

  test("a rule made without opening More fields is OneUptime AI's, with any runbook, no Runner, every repository and both pull requests", async ({
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
    expect(await fixOf(card, "Fix checkout")).toBe("Asks first");
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
      "Without asking Its runbooks, every time",
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

  test("with no Runner of its own, a rule reads No Runner, has nothing to pick, and is told where to add one", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { query: "runners=0" });
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
});

/*
 * The maintainer, on external MCP servers: "In the auto remediation rule
 * ... you can allow certain MCP servers to be picked, or in the
 * investigation rule ... If there are no MCP servers selected, by default,
 * you can say, 'Allow all MCP servers to be used.' They should be in more
 * options and not directly visible by default."
 */
const MCP_SERVER_IDS: Record<string, string> = {
  aws: "c0000000-0000-4000-8000-000000000e01",
  github: "c0000000-0000-4000-8000-000000000e02",
};
const ALL_MCP_SERVERS_SUMMARY: string =
  "OneUptime AI may use all of your MCP servers.";
const REMEDIATION_MCP_DESCRIPTION: string =
  "OneUptime AI may use all of your MCP servers to fix. Pick some to let it use only those.";
const INVESTIGATION_MCP_DESCRIPTION: string =
  "OneUptime AI may use all of your MCP servers while it investigates. Pick some to let it use only those.";

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
    await expect(foldedSummary(dialog)).toHaveText(
      withProvider(DEFAULTS_SUMMARY),
    );

    await openMoreFields(dialog);
    await expect(mcpServersPicker(dialog)).toBeVisible();
    await expect(mcpServersPicker(dialog)).toHaveAttribute(
      "placeholder",
      "All MCP servers",
    );
    await expect(dialog).toContainText(REMEDIATION_MCP_DESCRIPTION);
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
    await expect(dialog).not.toContainText(ALL_MCP_SERVERS_SUMMARY);
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

  test("a rule that runs its runbooks every time fixes through no MCP server, so it is not asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openFixStep(page, card);
    await openMoreFields(dialog);

    await pickOption(page, runbooksPicker(dialog), "Restart checkout");
    await page.keyboard.press("Escape");
    await expect(mcpServersPicker(dialog)).toBeVisible();

    await everyTimeSwitch(dialog).click();
    await expect(everyTimeSwitch(dialog)).toBeChecked();
    await expect(mcpServersPicker(dialog)).toHaveCount(0);
  });

  test("an investigation rule asks the same on its Investigate step: folded, none picked is all of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesCard(page);

    const investigationCard: Locator = page
      .locator("[data-card-surface='section']")
      .filter({
        has: page.getByRole("heading", {
          name: "Investigation rules",
          exact: true,
        }),
      });
    await expect(investigationCard).toBeVisible();

    const dialog: Locator = await openDialogWith(
      page,
      investigationCard
        .getByRole("button", { name: "Create Investigation Rule" })
        .first(),
    );

    // Match first (all incidents), then what the rule does.
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: /^Name/ })
      .fill("Investigate with AWS");

    // On the Investigate step, folded, with what the defaults do.
    await expect(mcpServersPicker(dialog)).toBeHidden();
    await expect(foldedSummary(dialog)).toHaveText(
      withProvider(INVESTIGATION_DEFAULTS_SUMMARY),
    );

    await openMoreFields(dialog);
    await expect(dialog).toContainText(INVESTIGATION_MCP_DESCRIPTION);
    await expect(mcpServersPicker(dialog)).toHaveAttribute(
      "placeholder",
      "All MCP servers",
    );
    await pickOption(page, mcpServersPicker(dialog), "GitHub");
    await page.keyboard.press("Escape");
    await screenshot(page, "investigation-rule-mcp-servers");

    // The Investigate step is the last: it creates the rule.
    await dialog
      .getByRole("button", { name: "Create Investigation Rule" })
      .click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const investigationRule: { model: string; data: Record<string, unknown> } =
      sent.creates.find((created: { model: string }): boolean => {
        return created.model === "AIInvestigationRule";
      })!;
    expect(investigationRule).toBeTruthy();
    expect(idsOf(investigationRule.data["externalMcpServers"])).toEqual([
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
    expect(headers).toContain("Fix");
    expect(headers).not.toContain("Fixed by");
    expect(headers).not.toContain("Approval");

    expect(await fixOf(card, "Fix database incidents")).toBe("Asks first");
    expect(await fixOf(card, "Restart checkout every time")).toBe(
      "Without asking Its runbooks, every time",
    );
    expect(await fixOf(card, "Commands on the bastion")).toBe(
      "Asks first OneUptime AI: commands on Runners",
    );
    // A runbook AI picks for such a rule is always proposed.
    expect(await fixOf(card, "AI picks a runbook")).toBe(
      "Asks first OneUptime AI: picks a runbook",
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

  test("a OneUptime AI rule opens with its runbooks and its Runner, and can go back to no Runner", async ({
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

    await dialog
      .getByTestId("auto-remediation-runner-picker")
      .locator(".ou-select__clear-indicator")
      .click();
    await expect(dialog).toContainText(NO_RUNNER);
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveCount(0);

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
      "Asks first OneUptime AI: commands on Runners",
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
    expect(await fixOf(card, "AI picks a runbook")).toBe("Asks first");
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
      "Asks first OneUptime AI: picks a runbook",
    );
  });
});

test.describe("alerts", () => {
  test("an alert rule asks the same: Approval up front, the runbooks and the Runner folded", async ({
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
      GERMAN["Auto Remediation Rule"]!,
    );
    expect(createInGerman).toBe("Regel für automatische Behebung erstellen");
    const dialog: Locator = await openDialogWith(
      page,
      card.getByRole("button", { name: createInGerman, exact: true }).first(),
    );

    await dialog.getByRole("textbox").first().fill("Checkout reparieren");
    await dialog.getByRole("button", { name: GERMAN["Next"]! }).click();
    await dialog.getByRole("button", { name: GERMAN["Next"]! }).click();

    for (const english of [
      APPROVAL_DESCRIPTION,
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
      REMEDIATION_REPOSITORIES_DESCRIPTION,
      FIX_PULL_REQUESTS,
      TELEMETRY_PULL_REQUESTS,
    ]) {
      expect(GERMAN[english]).toBeDefined();
      expect(GERMAN[english]).not.toBe(english);
      await expect(dialog).toContainText(GERMAN[english]!);
    }

    await expect(dialog).toContainText(GERMAN[NO_RUNNER]!);
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
    await expect(foldedSummary(dialog)).toHaveText(
      withProvider(DEFAULTS_SUMMARY),
    );

    await openMoreFields(dialog);
    await expect(repositoriesPicker(dialog)).toBeVisible();
    await expect(repositoriesPicker(dialog)).toHaveAttribute(
      "placeholder",
      ALL_REPOSITORIES,
    );
    await expect(dialog).toContainText(REMEDIATION_REPOSITORIES_DESCRIPTION);
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
      withProvider(
        "OneUptime AI may use any of your runbooks, MCP servers and connected repositories.",
      ),
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
   * sits close under its own box, a field's gap above the next field.
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

    const top: (locator: Locator) => Promise<number> = async (
      locator: Locator,
    ): Promise<number> => {
      return (await locator.boundingBox())!.y;
    };

    const bottom: (locator: Locator) => Promise<number> = async (
      locator: Locator,
    ): Promise<number> => {
      const box: { y: number; height: number } | null =
        await locator.boundingBox();
      return box!.y + box!.height;
    };

    const nextFields: Array<[string, Locator, Locator]> = [
      [
        "rule-mcp-servers-hint",
        mcpServersPicker(dialog),
        // The label holds the title and a space before its "(Optional)" slot.
        dialog.locator("label").filter({ hasText: /^Code Repositories\s*$/ }),
      ],
      [
        "rule-code-repositories-hint",
        repositoriesPicker(dialog),
        pullRequestSwitch(dialog, FIX_PULL_REQUESTS),
      ],
    ];

    for (const [hintTestId, box, next] of nextFields) {
      const hint: Locator = dialog.getByTestId(hintTestId);
      const underItsBox: number = (await top(hint)) - (await bottom(box));
      const aboveTheNext: number = (await top(next)) - (await bottom(hint));

      expect(underItsBox).toBeLessThan(aboveTheNext);
      // A field's gap: as wide as the one between two fields with no hint.
      expect(aboveTheNext).toBeGreaterThanOrEqual(16);
    }

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
    await expect(dialog).toContainText(APPROVAL_DESCRIPTION);

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
   * rule, named as one they cannot access - in words short enough for its
   * chip, which cuts at 14rem ("A repository you do not have acces..." lost
   * its last word there).
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

  test("an investigation rule names its repositories under More fields too, and picks no Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesCard(page);

    const investigationCard: Locator = page
      .locator("[data-card-surface='section']")
      .filter({
        has: page.getByRole("heading", {
          name: "Investigation rules",
          exact: true,
        }),
      });
    const dialog: Locator = await openDialogWith(
      page,
      investigationCard
        .getByRole("button", { name: "Create Investigation Rule" })
        .first(),
    );

    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: /^Name/ })
      .fill("Investigate billing");

    await expect(foldedSummary(dialog)).toHaveText(
      withProvider(INVESTIGATION_DEFAULTS_SUMMARY),
    );
    await openMoreFields(dialog);
    await expect(dialog).toContainText(INVESTIGATION_REPOSITORIES_DESCRIPTION);
    await expect(runnerPicker(dialog)).toHaveCount(0);

    await pickOption(page, repositoriesPicker(dialog), /^billing/);
    await page.keyboard.press("Escape");
    await dialogScreenshot(
      dialog,
      repositoriesPicker(dialog),
      "investigation-rule-code-repositories",
    );

    await dialog
      .getByRole("button", { name: "Create Investigation Rule" })
      .click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const investigationRule: { model: string; data: Record<string, unknown> } =
      sent.creates.find((created: { model: string }): boolean => {
        return created.model === "AIInvestigationRule";
      })!;
    expect(idsOf(investigationRule.data["codeRepositories"])).toEqual([
      CODE_REPOSITORY_IDS["billing"]!,
    ]);
  });
});

/*
 * The AI card and both rule dialogs, as a person sees them: 1280px and a
 * phone's 390px, light and dark. The card draws fixing alone - no pull
 * request switch under it - and nothing runs off a phone's screen.
 */
test.describe("the AI card and the rule dialogs, at 1280px and 390px, light and dark", () => {
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
          `remediation-rule-more-fields-${width}-${theme}`,
        );

        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toBeHidden();

        const investigationCard: Locator = page
          .locator("[data-card-surface='section']")
          .filter({
            has: page.getByRole("heading", {
              name: "Investigation rules",
              exact: true,
            }),
          });
        const investigationDialog: Locator = await openDialogWith(
          page,
          investigationCard
            .getByRole("button", { name: "Create Investigation Rule" })
            .first(),
        );
        await investigationDialog
          .getByRole("button", { name: "Next", exact: true })
          .click();
        await openMoreFields(investigationDialog);
        await expect(repositoriesPicker(investigationDialog)).toBeVisible();
        expect(
          await page.evaluate(() => {
            return document.documentElement.scrollWidth;
          }),
        ).toBeLessThanOrEqual(width);
        await dialogScreenshot(
          investigationDialog,
          investigationDialog.getByTestId("rule-code-repositories-hint"),
          `investigation-rule-more-fields-${width}-${theme}`,
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
 * More fields - after "Run them every time", which turns AI off - its empty
 * box names the provider a rule that picks none uses, and so does the
 * folded line; a pick is sent with the rule and named on the folded line.
 */
const PROVIDER_IDS: Record<string, string> = {
  oneUptimeAi: "9d9d9d9d-0000-4000-8000-000000000001",
  azure: "9d9d9d9d-0000-4000-8000-000000000002",
  opus: "9d9d9d9d-0000-4000-8000-000000000003",
};
const PROVIDER_TITLE: string = "LLM Provider";
const REMEDIATION_PROVIDER_DESCRIPTION: string =
  "OneUptime AI fixes with the default LLM provider, pull requests included. Pick one to use another for this rule.";
const INVESTIGATION_PROVIDER_DESCRIPTION: string =
  "OneUptime AI investigates with the default LLM provider. Pick one to use another for this rule.";
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

// The investigation rules card beside the remediation one, and its create dialog's Investigate step.
const openInvestigateStep: (page: Page) => Promise<Locator> = async (
  page: Page,
): Promise<Locator> => {
  const investigationCard: Locator = page
    .locator("[data-card-surface='section']")
    .filter({
      has: page.getByRole("heading", {
        name: "Investigation rules",
        exact: true,
      }),
    });
  await expect(investigationCard).toBeVisible();

  const dialog: Locator = await openDialogWith(
    page,
    investigationCard
      .getByRole("button", { name: "Create Investigation Rule" })
      .first(),
  );
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: /^Name/ })
    .fill("Investigate checkout");
  return dialog;
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
    await expect(dialog).toContainText(REMEDIATION_PROVIDER_DESCRIPTION);
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

    // After the runbooks, before the Runner: what OneUptime AI thinks with.
    const order: Array<number> = [];
    for (const locator of [
      runbooksPicker(dialog),
      providerBox(dialog),
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

  test("a rule that runs its runbooks every time uses no AI: no provider to pick, and More fields stays open", async ({
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
    await expect(providerPicker(dialog)).toHaveCount(0);
    await expect(moreFieldsButton(dialog)).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Folded, the line names no provider for it.
    await moreFieldsButton(dialog).click();
    await expect(foldedSummary(dialog)).not.toContainText("LLM provider");
    expect((await foldedItemsOf(dialog)).join(" ")).not.toContain(
      PROVIDER_TITLE,
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

  test("an investigation rule picks one first under its More fields, and it is sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRulesCard(page, { query: "providers=project" });
    const dialog: Locator = await openInvestigateStep(page);

    await expect(foldedSummary(dialog)).toHaveText(
      `${PROJECT_DEFAULT_SUMMARY} ${INVESTIGATION_DEFAULTS_SUMMARY}`,
    );
    await openMoreFields(dialog);
    await expect(dialog).toContainText(INVESTIGATION_PROVIDER_DESCRIPTION);
    // First under More fields, above the MCP servers.
    expect((await providerBox(dialog).boundingBox())!.y).toBeLessThan(
      (await mcpServersPicker(dialog).boundingBox())!.y,
    );

    await providerBox(dialog).click();
    await page.getByRole("option", { name: /^Claude Opus/ }).click();
    await dialog
      .getByRole("button", { name: "Create Investigation Rule" })
      .click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const created: { model: string; data: Record<string, unknown> } =
      sent.creates.find((each: { model: string }): boolean => {
        return each.model === "AIInvestigationRule";
      })!;
    expect(idOfValue(created.data["llmProviderId"])).toBe(PROVIDER_IDS["opus"]);
  });
});

/*
 * Both rule dialogs' LLM Provider field, open, as a person sees it: 1280px
 * and a phone's 390px, light and dark - the menu's choices with what each
 * is, the line to LLM Providers, and nothing running off the screen.
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
          `remediation-rule-llm-provider-${width}-${theme}`,
        );
        await page.keyboard.press("Escape");

        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toBeHidden();

        const investigationDialog: Locator = await openInvestigateStep(page);
        await openMoreFields(investigationDialog);
        await expect(providerBox(investigationDialog)).toBeVisible();
        expect(
          await page.evaluate(() => {
            return document.documentElement.scrollWidth;
          }),
        ).toBeLessThanOrEqual(width);
        await dialogScreenshot(
          investigationDialog,
          investigationDialog.getByTestId("rule-llm-provider-hint"),
          `investigation-rule-llm-provider-${width}-${theme}`,
        );
      });
    }
  }
});
