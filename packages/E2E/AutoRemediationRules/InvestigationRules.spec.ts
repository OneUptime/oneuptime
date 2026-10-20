import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Investigation rules can wait (issue #5074): "only if the incident is still
 * open after N minutes", on Incidents -> AI -> Settings and Alerts -> AI ->
 * Settings, in a browser, against the offline fixture of the AI settings
 * page (AutoRemediationRules/Fixture, ?investigationRules=saved).
 *
 * A rule asks Match, then Investigate: when to investigate - Right away, the
 * default and what every rule saved before rules could wait does, or Only if
 * still open after a wait, which asks the minutes (10 to start with, 1 to
 * 1440). The table says when each rule investigates. The fixture records
 * every create and update the page sends, so the tests check what was sent
 * as well as what was drawn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const WAITING_RULE_ID: string = "91000000-0000-4000-8000-000000000e02";

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

const CARD_TITLE: string = "Investigation rules";
const CREATE: string = "Create Investigation Rule";
const SAVE: string = "Save Changes";
const WHEN: string = "When to investigate";
const RIGHT_AWAY: string = "Right away";
const AFTER_WAIT: string = "Only if still open after a wait";
const WAIT_FIELD: string = "Wait (Minutes)";
const WAIT_REFUSED: string = "Enter a whole number of minutes, from 1 to 1440.";
const INCIDENT_WAIT_HELP: string =
  "Counted from when the incident is declared. When several rules match, the shortest wait decides. At most 1440 (a day).";
const ALERT_RIGHT_AWAY_HELP: string =
  "OneUptime AI starts as soon as the alert is created.";

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

// The page, its More settings unfolded, and the investigation rules card.
const openRulesCard: (
  page: Page,
  options?: { lane?: Lane; query?: string; isGerman?: boolean },
) => Promise<Locator> = async (
  page: Page,
  options: { lane?: Lane; query?: string; isGerman?: boolean } = {},
): Promise<Locator> => {
  const lane: Lane = options.lane || "incident";
  const query: string = [
    lane === "alert" ? "lane=alert" : "",
    "investigationRules=saved",
    options.query,
  ]
    .filter(Boolean)
    .join("&");
  const words: (english: string) => string = (english: string): string => {
    return (options.isGerman && GERMAN[english]) || english;
  };

  await page.goto(
    `/dashboard/${PROJECT_ID}/${lane === "alert" ? "alerts" : "incidents"}/ai/settings?${query}`,
  );

  const advanced: Locator = page.getByTestId(`${lane}-ai-advanced-section`);
  await expect(advanced).toBeVisible();

  const fold: Locator = advanced.getByRole("button", {
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

// The create dialog, walked past Match (all incidents) to Investigate.
const openInvestigateStep: (
  page: Page,
  card: Locator,
) => Promise<Locator> = async (page: Page, card: Locator): Promise<Locator> => {
  await card.getByRole("button", { name: CREATE }).first().click();
  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await expect(
    dialog.getByRole("radio", { name: /^All incidents|^All alerts/ }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: RIGHT_AWAY })).toBeVisible();

  return dialog;
};

const waitField: (dialog: Locator) => Locator = (dialog: Locator): Locator => {
  return dialog.getByTestId("investigation-rule-wait-minutes");
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

// The open dialog alone: a full page would draw its overlay over one screen.
const screenshotDialog: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.getByRole("dialog").screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
  });
};

const createdRule: (page: Page) => Promise<Record<string, unknown>> = async (
  page: Page,
): Promise<Record<string, unknown>> => {
  const creates: Recorded["creates"] = (await recorded(page)).creates.filter(
    (create: Recorded["creates"][number]): boolean => {
      return create.model === "AIInvestigationRule";
    },
  );
  expect(creates).toHaveLength(1);
  return creates[0]!.data;
};

test.describe("investigation rules: when to investigate (issue #5074)", () => {
  test("the table says when each rule investigates", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);

    expect(await cellOf(card, "Production incidents", "Investigates")).toBe(
      RIGHT_AWAY,
    );
    expect(await cellOf(card, "Flapping checks", "Investigates")).toBe(
      "If still open after 10 minutes",
    );
    await expect(card).toContainText(
      "With no rule, OneUptime AI investigates every new incident right away. Add rules to investigate only the incidents that match one of them, or only those still open after a wait.",
    );
    await screenshot(page, "investigation-rules-table");
  });

  test("a new rule asks Match, then Investigate, and starts on Right away, with no minutes asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openInvestigateStep(page, card);

    await expect(dialog.getByText(WHEN, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: RIGHT_AWAY })).toBeChecked();
    await expect(
      dialog.getByRole("radio", { name: AFTER_WAIT }),
    ).not.toBeChecked();
    await expect(waitField(dialog)).toHaveCount(0);
    await expect(dialog.getByText(WAIT_FIELD, { exact: true })).toHaveCount(0);
    await screenshotDialog(page, "investigation-rule-investigate-step");

    await dialog.getByRole("textbox", { name: /^Name/ }).fill("Every page");
    await dialog.getByRole("button", { name: CREATE }).click();
    await expect(dialog).toBeHidden();

    const sent: Record<string, unknown> = await createdRule(page);
    expect(sent["name"]).toBe("Every page");
    // No wait: the column is left empty, as before rules could wait.
    expect(sent["onlyIfOpenAfterMinutes"] ?? null).toBeNull();
    // The form's own choice is never sent as a column.
    expect(sent["investigationTiming"]).toBeUndefined();
  });

  test("Only if still open after a wait asks the minutes, from 10, and sends the ones chosen", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openInvestigateStep(page, card);

    await dialog.getByRole("radio", { name: AFTER_WAIT }).check();
    const minutes: Locator = waitField(dialog);
    await expect(minutes).toBeVisible();
    await expect(minutes).toHaveValue("10");
    await expect(dialog).toContainText(INCIDENT_WAIT_HELP);
    await screenshotDialog(page, "investigation-rule-investigate-step-wait");

    await minutes.fill("30");
    await dialog.getByRole("textbox", { name: /^Name/ }).fill("Flaky checks");
    await dialog.getByRole("button", { name: CREATE }).click();
    await expect(dialog).toBeHidden();

    const sent: Record<string, unknown> = await createdRule(page);
    expect(Number(sent["onlyIfOpenAfterMinutes"])).toBe(30);
    expect(sent["investigationTiming"]).toBeUndefined();

    // The new rule reads as it waits in the table.
    await expect(
      card.locator("tbody tr").filter({ hasText: "Flaky checks" }),
    ).toContainText("If still open after 30 minutes");
  });

  test("a wait the server would refuse is stopped in the form, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openInvestigateStep(page, card);

    await dialog.getByRole("radio", { name: AFTER_WAIT }).check();
    await dialog.getByRole("textbox", { name: /^Name/ }).fill("Too long");

    for (const value of ["0", "1441", "2.5"]) {
      await waitField(dialog).fill(value);
      await dialog.getByRole("button", { name: CREATE }).click();
      await expect(dialog.getByText(WAIT_REFUSED)).toBeVisible();
      await expect(dialog).toBeVisible();
    }

    expect(
      (await recorded(page)).creates.filter(
        (create: Recorded["creates"][number]): boolean => {
          return create.model === "AIInvestigationRule";
        },
      ),
    ).toEqual([]);
  });

  test("a rule that waits opens on its minutes, and Right away clears them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page);
    const row: Locator = card
      .locator("tbody tr")
      .filter({ hasText: "Flapping checks" })
      .first();

    await row.getByRole("button", { name: "Edit" }).click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Next", exact: true }).click();

    await expect(dialog.getByRole("radio", { name: AFTER_WAIT })).toBeChecked();
    await expect(waitField(dialog)).toHaveValue("10");

    await dialog.getByRole("radio", { name: RIGHT_AWAY }).check();
    await expect(waitField(dialog)).toHaveCount(0);
    await dialog.getByRole("button", { name: SAVE }).click();
    await expect(dialog).toBeHidden();

    const updates: Recorded["updates"] = (await recorded(page)).updates.filter(
      (update: Recorded["updates"][number]): boolean => {
        return (
          update.model === "AIInvestigationRule" &&
          update.id === WAITING_RULE_ID
        );
      },
    );
    expect(updates).toHaveLength(1);
    // Cleared, not left as it was: the rule investigates right away again.
    expect(updates[0]!.data["onlyIfOpenAfterMinutes"]).toBeNull();
    await expect(row).toContainText(RIGHT_AWAY);
  });

  test("an alert rule asks the same, about alerts", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, { lane: "alert" });

    expect(await cellOf(card, "Flapping checks", "Investigates")).toBe(
      "If still open after 10 minutes",
    );

    const dialog: Locator = await openInvestigateStep(page, card);
    await expect(dialog).toContainText(ALERT_RIGHT_AWAY_HELP);
    await dialog.getByRole("radio", { name: AFTER_WAIT }).check();
    await expect(dialog).toContainText(
      "Counted from when the alert is created.",
    );
  });

  test("on a phone the Investigate step fits the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const card: Locator = await openRulesCard(page);
    const dialog: Locator = await openInvestigateStep(page, card);
    await dialog.getByRole("radio", { name: AFTER_WAIT }).check();
    await expect(waitField(dialog)).toBeVisible();

    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);
    await screenshotDialog(page, "investigation-rule-investigate-step-phone");
  });

  test("dark mode and German draw the step in their own colours and words", async ({
    page,
  }: {
    page: Page;
  }) => {
    const card: Locator = await openRulesCard(page, {
      query: "theme=dark&lang=de",
      isGerman: true,
    });

    // "{{itemName}} erstellen", the rule's German name in it.
    const createInGerman: string = GERMAN["Create {{itemName}}"]!.replace(
      "{{itemName}}",
      GERMAN["Investigation Rule"]!,
    );
    expect(createInGerman).toBe("Untersuchungsregel erstellen");

    await card
      .getByRole("button", { name: createInGerman, exact: true })
      .first()
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: GERMAN["Next"]!, exact: true })
      .click();

    await expect(
      dialog.getByRole("radio", { name: GERMAN[RIGHT_AWAY]! }),
    ).toBeChecked();
    await dialog.getByRole("radio", { name: GERMAN[AFTER_WAIT]! }).check();
    await expect(dialog.getByText(GERMAN[WAIT_FIELD]!)).toBeVisible();
    await screenshotDialog(page, "investigation-rule-investigate-step-dark-de");
  });
});
