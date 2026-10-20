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
 * time" (what a rule saved with Fix With set to Runbooks keeps doing), and
 * the Runner OneUptime AI runs the rule's commands on (none: the AI agent
 * on the affected cluster or host - a global Runner never runs them). The
 * fixture records every create and update the page sends, so the tests
 * check what was sent as well as what was drawn.
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
const DEFAULTS_SUMMARY: string =
  "OneUptime AI may run any of your runbooks, and fixes through the AI agent on the affected cluster or host.";
const RUNBOOKS_DESCRIPTION: string =
  "OneUptime AI may run any of your runbooks. Pick some to let it run only those.";
const RUNNER_DESCRIPTION: string =
  "Where OneUptime AI runs commands of its own for this rule, inside your network.";
const NO_RUNNER: string = "AI agent on the cluster or host";
// Under the picker only in a project with no Runner of its own.
const ADD_RUNNER_HELP: string =
  "Add a Runner under Runbooks › Runners for OneUptime AI to run commands on, then pick it here.";
const RUNNER_HELP_TEST_ID: string = "auto-remediation-runner-picker-help";
const OWN_RUNNER_HELP: string =
  "OneUptime AI may also run Bash and SSH commands on this Runner, inside your network.";
const EVERY_TIME: string = "Run them every time";
const OLDER_COMMANDS_NOTE: string =
  "This older rule only has OneUptime AI run commands on its Runners.";
const OLDER_PICKS_NOTE: string =
  "This older rule only has OneUptime AI pick one of its runbooks, and always asks first.";
const FIX_LIKE_A_NEW_RULE: string = "Fix like a new rule";
const OLDER_RULE_TEST_ID: string = "auto-remediation-older-rule";

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

// The create dialog, walked to its Fix step: a name, then all incidents.
const openFixStep: (page: Page, card: Locator) => Promise<Locator> = async (
  page: Page,
  card: Locator,
): Promise<Locator> => {
  await card.getByRole("button", { name: CREATE }).first().click();
  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

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
  await card
    .locator("tbody tr")
    .filter({ hasText: name })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
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
    await expect(dialog).toContainText(DEFAULTS_SUMMARY);
    await expect(runbooksPicker(dialog)).toBeHidden();
    await expect(runnerPicker(dialog)).toBeHidden();

    await screenshot(page, "fix-step-folded");
  });

  test("More fields holds the runbooks OneUptime AI may run - none is any - and the Runner - none is the AI agent", async ({
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
     * Runner: the AI agent, said in plain words. With Runners to pick from,
     * no line under it repeats what the choice and the field's line say.
     */
    await expect(dialog).toContainText(RUNNER_DESCRIPTION);
    await expect(runnerPicker(dialog)).toBeVisible();
    await expect(dialog).toContainText(NO_RUNNER);
    await expect(dialog.getByTestId(RUNNER_HELP_TEST_ID)).toHaveCount(0);
    await expect(dialog).not.toContainText(ADD_RUNNER_HELP);
    await expect(dialog).not.toContainText("Global Runner");

    await screenshot(page, "fix-step-more-fields");
  });

  test("the Runner's choices: the AI agent first, then the project's own Runners with how each is doing - never the Kubernetes agent's in-cluster Runner", async ({
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
      `${NO_RUNNER} No Runner of yours: OneUptime AI fixes through the AI agent on the affected Kubernetes cluster or host.`,
      "office-runner · Never connected",
      "prod-eu-runner · Connected",
    ]);
    expect(options.join(" ")).not.toContain("kubernetes-agent/prod-us");

    await screenshot(page, "runner-choices");
  });

  test("a rule made without opening More fields is OneUptime AI's, with any runbook and no Runner", async ({
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
    await expect(dialog).toContainText(OWN_RUNNER_HELP);

    // With runbooks named, the rule can run them every time - off unless said.
    await expect(everyTimeSwitch(dialog)).toBeVisible();
    await expect(everyTimeSwitch(dialog)).not.toBeChecked();
    await screenshot(page, "fix-step-picked");

    // Folded again, its line says what is set.
    await moreFieldsButton(dialog).click();
    await expect(dialog).toContainText("Runbooks: 2");
    await expect(dialog).not.toContainText(DEFAULTS_SUMMARY);
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

  test("with no Runner of its own, the project's rules can still pick none", async ({
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
    await screenshot(page, "no-runners");

    await runnerPicker(dialog).click();

    const options: Array<string> = await page
      .getByRole("option")
      .allInnerTexts();

    expect(options).toHaveLength(1);
    expect(options[0]).toContain(NO_RUNNER);
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
    await expect(dialog).toContainText(ALL_MCP_SERVERS_SUMMARY);

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

  test("an investigation rule asks the same on its Rule step: folded, none picked is all of them", async ({
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

    await investigationCard
      .getByRole("button", { name: "Create Investigation Rule" })
      .first()
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog
      .getByRole("textbox", { name: /^Name/ })
      .fill("Investigate with AWS");

    // On the Rule step, folded, with what the default does.
    await expect(mcpServersPicker(dialog)).toBeHidden();
    await expect(dialog).toContainText(ALL_MCP_SERVERS_SUMMARY);

    await openMoreFields(dialog);
    await expect(dialog).toContainText(INVESTIGATION_MCP_DESCRIPTION);
    await expect(mcpServersPicker(dialog)).toHaveAttribute(
      "placeholder",
      "All MCP servers",
    );
    await pickOption(page, mcpServersPicker(dialog), "GitHub");
    await page.keyboard.press("Escape");
    await screenshot(page, "investigation-rule-mcp-servers");

    await dialog.getByRole("button", { name: "Next", exact: true }).click();
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

  test("a OneUptime AI rule opens with its runbooks and its Runner, and can go back to the AI agent", async ({
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

    await pickOption(page, runnerPicker(dialog), new RegExp(`^${NO_RUNNER}`));
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
    await expect(dialog).toContainText(DEFAULTS_SUMMARY);
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
    await expect(dialog).toContainText(DEFAULTS_SUMMARY);

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
    await card
      .getByRole("button", { name: createInGerman, exact: true })
      .first()
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

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

    for (const english of [RUNBOOKS_DESCRIPTION, RUNNER_DESCRIPTION]) {
      expect(GERMAN[english]).toBeDefined();
      expect(GERMAN[english]).not.toBe(english);
      await expect(dialog).toContainText(GERMAN[english]!);
    }

    await expect(dialog).toContainText(GERMAN[NO_RUNNER]!);
    await screenshot(page, "german");
  });
});
