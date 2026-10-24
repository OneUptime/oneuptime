import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Postmortem rules - which resolved incidents OneUptime AI drafts a
 * postmortem for, and the postmortem templates each draft follows - on
 * Incidents -> AI -> Settings, in a browser, against the offline fixture
 * (PostmortemRules/Fixture): the switch that stays the one way to turn
 * drafting off, the More settings fold that holds the rules, the table in
 * the order rules are tried, a rule created from the Match and Draft steps
 * (its name following the templates picked), a rule dragged into another
 * place, a viewer, a project below the plan templates need, a phone, dark
 * mode and German.
 *
 * The maintainer's ask: "Can you please create rules for these just like we
 * have investigation rules in more options? The rules can contain which
 * incidents can we draft a postmortem report for, and what templates can be
 * used?" The fixture records every create, update and delete the page
 * sends, so the tests check what was sent as well as what was drawn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/incidents/ai/settings`;

const DATABASE_OUTAGE_ID: string = "80000000-0000-4000-8000-000000000b02";
const SECURITY_INCIDENT_ID: string = "80000000-0000-4000-8000-000000000b03";
const CRITICAL_ID: string = "50000000-0000-4000-8000-0000000000e1";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/postmortem-rules-ui",
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

const CARD_TITLE: string = "Postmortem rules";
const SWITCH_TITLE: string = "Draft a postmortem when an incident resolves";
const STANDARD_OUTLINE: string = "Standard outline";
const STANDARD_OUTLINE_NAME: string = "Draft with the standard outline";
const DEFAULTS_SUMMARY: string =
  "Every incident is investigated, whatever its severity, fixed while fixing is on, and given a postmortem draft when it resolves. Nothing limits how much OneUptime AI does.";
const CARD_DESCRIPTION: string =
  "With no rule, OneUptime AI drafts a postmortem for every resolved incident. Add rules to draft only for matching incidents, in the templates you choose. The first rule that matches decides - drag to reorder.";
const CARD_DESCRIPTION_WITHOUT_TEMPLATES: string =
  "With no rule, OneUptime AI drafts a postmortem for every resolved incident. Add rules to draft only for the incidents that match one of them.";
// The empty table: its message, drawn as a title and a line under it.
const NO_RULES: string =
  "No rules. Every resolved incident gets a postmortem draft.";
const NO_RULES_TITLE: string = "No rules";
const NO_RULES_DESCRIPTION: string =
  "Every resolved incident gets a postmortem draft.";
const TEMPLATES_DESCRIPTION: string =
  "Leave empty for OneUptime AI's standard outline. With more than one, OneUptime AI picks the one that fits the incident best.";

interface Recorded {
  creates: Array<{ model: string; data: Record<string, unknown> }>;
  updates: Array<{ model: string; id: string; data: Record<string, unknown> }>;
  deletes: Array<{ model: string; id: string }>;
}

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

const openPage: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await page.goto(`${PAGE_PATH}${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("incident-ai-advanced-section")).toBeVisible();
};

const moreSettings: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("incident-ai-advanced-section");
};

const foldHeader: (page: Page) => Locator = (page: Page): Locator => {
  return moreSettings(page).getByRole("button", { name: "More settings" });
};

const unfold: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await foldHeader(page).click();
  await expect(foldHeader(page)).toHaveAttribute("aria-expanded", "true");
};

// The Postmortem rules card, by its title.
const rulesCard: (page: Page, title?: string) => Locator = (
  page: Page,
  title: string = CARD_TITLE,
): Locator => {
  return page.locator("[data-card-surface='section']").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
};

/*
 * The rule names in the table, top first: the cells under the Name header,
 * wherever it is - a viewer's table has no select-all column.
 */
const ruleNames: (card: Locator) => Promise<Array<string>> = async (
  card: Locator,
): Promise<Array<string>> => {
  const headers: Array<string> = (
    await card.locator("thead th").allInnerTexts()
  ).map((text: string): string => {
    return text.trim();
  });
  const nameColumn: number = headers.indexOf("Name");
  const rows: Locator = card.locator("tbody tr");
  const count: number = await rows.count();
  const names: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    names.push(
      (
        (await rows.nth(index).locator("td").nth(nameColumn).innerText()) || ""
      ).trim(),
    );
  }

  return names;
};

// The template names a row lists, top first (PostmortemRuleTemplates).
const templatesIn: (row: Locator) => Promise<Array<string>> = async (
  row: Locator,
): Promise<Array<string>> => {
  return (
    await row.getByTestId("postmortem-rule-template").allInnerTexts()
  ).map((text: string): string => {
    return text.trim();
  });
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

      const record: Record<string, unknown> = (entry || {}) as Record<
        string,
        unknown
      >;
      return String(record["_id"] || record["id"] || "");
    })
    .sort();
};

// Picks an option of a react-select picker in the open dialog.
const pickOption: (
  page: Page,
  picker: Locator,
  option: string,
) => Promise<void> = async (
  page: Page,
  picker: Locator,
  option: string,
): Promise<void> => {
  const choice: Locator = page.getByRole("option", {
    name: option,
    exact: true,
  });

  const isListed: boolean = await choice.isVisible().catch((): boolean => {
    return false;
  });

  if (!isListed) {
    await picker.focus();
    await page.keyboard.press("ArrowDown");
  }

  await choice.click();
};

const openCreateDialog: (page: Page) => Promise<Locator> = async (
  page: Page,
): Promise<Locator> => {
  await rulesCard(page)
    .getByRole("button", { name: "Create Postmortem Rule" })
    .first()
    .click();
  const dialog: Locator = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("radio", { name: "All incidents" }),
  ).toBeVisible();
  return dialog;
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

test.describe("the page", () => {
  test("the switch stays the one way to turn drafting off, and the rules are folded under More settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);

    await expect(
      page.getByRole("switch", { name: SWITCH_TITLE, exact: true }),
    ).toBeChecked();
    // Folded until opened: no rules card on the page yet.
    await expect(foldHeader(page)).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("heading", { name: CARD_TITLE, exact: true }),
    ).toBeHidden();
    // What having no rule means, said on the folded header.
    await expect(moreSettings(page)).toContainText(DEFAULTS_SUMMARY);

    await screenshot(page, "folded-no-rules");
  });

  test("a project with rules sees them counted on the folded header", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=2");

    await expect(moreSettings(page)).toContainText(`${CARD_TITLE}: 2`);
    // A rule narrows what happens, so the defaults are no longer claimed.
    await expect(moreSettings(page)).not.toContainText(DEFAULTS_SUMMARY);
  });

  test("the rules sit after the AI rules and the investigation settings, and before the daily limits, like the switches above them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await unfold(page);

    // The cards' titles, not the "No rules" of an empty table.
    const headings: Array<string> = (
      await moreSettings(page).getByRole("heading").allInnerTexts()
    )
      .map((text: string): string => {
        return text.trim();
      })
      .filter((text: string): boolean => {
        return text !== "No rules";
      });

    expect(headings).toEqual([
      "AI rules",
      "Which incidents are investigated",
      "Investigation limits",
      CARD_TITLE,
      "Daily limits",
    ]);
    await expect(rulesCard(page)).toContainText(CARD_DESCRIPTION);
    await expect(rulesCard(page)).toContainText(NO_RULES_TITLE);
    await expect(rulesCard(page)).toContainText(NO_RULES_DESCRIPTION);
  });
});

test.describe("the list", () => {
  test("rules are listed in the order they are tried, each with its conditions and templates", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=3");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(card.locator("tbody tr")).toHaveCount(3);

    expect(await ruleNames(card)).toEqual([
      "Draft with Database outage",
      "Draft with Customer-facing outage, Security incident",
      STANDARD_OUTLINE_NAME,
    ]);

    const headers: Array<string> = (
      await card.locator("thead th").allInnerTexts()
    )
      .map((text: string): string => {
        return text.trim();
      })
      .filter(Boolean);
    // With the screen-reader names of the grip, select-all and actions columns.
    expect(headers).toEqual([
      "Drag to reorder",
      "Select all items",
      "Name",
      "Match Criteria",
      "Templates",
      "Status",
      "Actions",
    ]);

    const rows: Locator = card.locator("tbody tr");
    // Each template on a line of its own, by name.
    expect(await templatesIn(rows.nth(0))).toEqual(["Database outage"]);
    expect(await templatesIn(rows.nth(1))).toEqual([
      "Customer-facing outage",
      "Security incident",
    ]);
    // A rule that names no template drafts in the standard outline, and says so.
    expect(await templatesIn(rows.nth(2))).toEqual([]);
    await expect(rows.nth(2)).toContainText(STANDARD_OUTLINE);
    await expect(rows.nth(2)).toContainText("All incidents");

    // Every rule can be dragged into another place.
    await expect(card.getByTestId("drag-handle")).toHaveCount(3);

    await screenshot(page, "rules-listed");
  });

  test("a viewer reads the rules but cannot add, edit or drag one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=2&role=viewer");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(card.locator("tbody tr")).toHaveCount(2);

    // Every way to change the rules is there, greyed out, saying why.
    for (const create of await card
      .getByRole("button", { name: "Create Postmortem Rule" })
      .all()) {
      await expect(create).toBeDisabled();
    }

    for (const edit of await card
      .getByRole("button", { name: "Edit", exact: true })
      .all()) {
      await expect(edit).toBeDisabled();
    }

    const grips: Locator = card.getByTestId("drag-handle");
    await expect(grips).toHaveCount(2);

    for (const grip of await grips.all()) {
      await expect(grip).toHaveAttribute("aria-disabled", "true");
    }

    // A drag from the keyboard moves nothing and sends nothing.
    await grips.nth(1).focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);

    expect(await ruleNames(card)).toEqual([
      "Draft with Database outage",
      "Draft with Customer-facing outage, Security incident",
    ]);
    expect((await recorded(page)).updates).toEqual([]);
  });
});

test.describe("adding a rule", () => {
  test("Match starts on All incidents; Draft names the rule after the standard outline; Create sends no place and no template", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await unfold(page);

    const dialog: Locator = await openCreateDialog(page);

    // First what the rule matches: every incident until conditions are asked for.
    await expect(
      dialog.getByRole("radio", { name: "All incidents" }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Create Postmortem Rule" }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();

    // Then how the draft is written.
    await expect(dialog).toContainText(TEMPLATES_DESCRIPTION);
    await expect(dialog.getByRole("textbox", { name: /^Name/ })).toHaveValue(
      STANDARD_OUTLINE_NAME,
    );
    await screenshot(page, "create-draft-step");

    await dialog
      .getByRole("button", { name: "Create Postmortem Rule" })
      .click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    expect(sent.creates).toHaveLength(1);
    expect(sent.creates[0]!.model).toBe("AIPostmortemRule");
    expect(sent.creates[0]!.data["name"]).toBe(STANDARD_OUTLINE_NAME);
    // The server puts a new rule at the end of the list.
    expect(sent.creates[0]!.data["order"]).toBeUndefined();
    expect(idsOf(sent.creates[0]!.data["postmortemTemplates"])).toEqual([]);

    // The new rule is listed, and the card no longer says there is none.
    await expect(rulesCard(page).locator("tbody tr")).toHaveCount(1);
    await expect(rulesCard(page)).not.toContainText(NO_RULES_DESCRIPTION);
  });

  test("picking templates names the rule after them, and the templates are sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await unfold(page);

    const dialog: Locator = await openCreateDialog(page);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();

    const picker: Locator = dialog.getByRole("combobox").first();
    const name: Locator = dialog.getByRole("textbox", { name: /^Name/ });

    await pickOption(page, picker, "Database outage");
    await expect(name).toHaveValue("Draft with Database outage");

    await pickOption(page, picker, "Security incident");
    await expect(name).toHaveValue(
      "Draft with Database outage, Security incident",
    );
    await page.keyboard.press("Escape");
    await screenshot(page, "create-two-templates");

    await dialog
      .getByRole("button", { name: "Create Postmortem Rule" })
      .click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    expect(sent.creates[0]!.data["name"]).toBe(
      "Draft with Database outage, Security incident",
    );
    expect(idsOf(sent.creates[0]!.data["postmortemTemplates"])).toEqual(
      [DATABASE_OUTAGE_ID, SECURITY_INCIDENT_ID].sort(),
    );

    expect(
      await templatesIn(rulesCard(page).locator("tbody tr").first()),
    ).toEqual(["Database outage", "Security incident"]);
  });

  test("a name typed over is kept when the templates change", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await unfold(page);

    const dialog: Locator = await openCreateDialog(page);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();

    const name: Locator = dialog.getByRole("textbox", { name: /^Name/ });
    await name.fill("SEV1 database incidents");
    await pickOption(
      page,
      dialog.getByRole("combobox").first(),
      "Database outage",
    );
    await page.keyboard.press("Escape");

    await expect(name).toHaveValue("SEV1 database incidents");
  });

  test("a rule for only some incidents is saved with its conditions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await unfold(page);

    const dialog: Locator = await openCreateDialog(page);
    await dialog
      .getByRole("radio", { name: "Only incidents that match conditions" })
      .check();

    await pickOption(
      page,
      dialog.getByRole("combobox", { name: "Criteria for condition 1" }),
      "Incident Severities",
    );
    await pickOption(
      page,
      dialog.getByRole("combobox", { name: "Value for condition 1" }),
      "Critical",
    );
    await page.keyboard.press("Escape");
    await screenshot(page, "create-match-conditions");

    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Create Postmortem Rule" })
      .click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    const criteria: {
      filters?: Array<{ field: string; operator: string; value: unknown }>;
    } = (sent.creates[0]!.data["criteria"] || {}) as {
      filters?: Array<{ field: string; operator: string; value: unknown }>;
    };

    expect(criteria.filters).toEqual([
      {
        field: "incidentSeverities",
        operator: "HasAnyOf",
        value: [CRITICAL_ID],
      },
    ]);
  });
});

test.describe("the order rules are tried in", () => {
  test("a rule dragged up by keyboard takes the place of the row it lands on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=3");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(card.locator("tbody tr")).toHaveCount(3);

    const grip: Locator = card.getByTestId("drag-handle").nth(2);
    await grip.focus();
    await page.keyboard.press("Space");
    // react-beautiful-dnd lifts the row before it takes a move.
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    await page.keyboard.press("Space");

    await expect
      .poll(async () => {
        return await ruleNames(card);
      })
      .toEqual([
        STANDARD_OUTLINE_NAME,
        "Draft with Database outage",
        "Draft with Customer-facing outage, Security incident",
      ]);

    const sent: Recorded = await recorded(page);
    expect(
      sent.updates.filter((update: Recorded["updates"][number]): boolean => {
        return update.model === "AIPostmortemRule";
      }),
    ).toEqual([
      {
        model: "AIPostmortemRule",
        id: "90000000-0000-4000-8000-000000000c03",
        // The number of the rule it took the place of: the top one's.
        data: { order: 1 },
      },
    ]);
  });

  test("a refused drop puts the rules back and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=3&fail=reorder");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(card.locator("tbody tr")).toHaveCount(3);

    const grip: Locator = card.getByTestId("drag-handle").nth(0);
    await grip.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    await page.keyboard.press("Space");

    await expect(card).toContainText(
      "The rules could not be reordered. Please try again.",
    );
    expect(await ruleNames(card)).toEqual([
      "Draft with Database outage",
      "Draft with Customer-facing outage, Security incident",
      STANDARD_OUTLINE_NAME,
    ]);
  });
});

test.describe("plans", () => {
  test("on OneUptime Cloud below the Growth plan, templates are neither offered nor listed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=2&billing=on&plan=free");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(card.locator("tbody tr")).toHaveCount(2);
    await expect(card).toContainText(CARD_DESCRIPTION_WITHOUT_TEMPLATES);
    await expect(card.locator("thead")).not.toContainText("Templates");

    const dialog: Locator = await openCreateDialog(page);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: /^Name/ })).toHaveValue(
      STANDARD_OUTLINE_NAME,
    );
    await expect(dialog).not.toContainText(TEMPLATES_DESCRIPTION);
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
  });

  test("on the Growth plan they are", async ({ page }: { page: Page }) => {
    await openPage(page, "rules=2&billing=on&plan=growth");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(card).toContainText(CARD_DESCRIPTION);
    await expect(card.locator("thead")).toContainText("Templates");
  });
});

test.describe("beside the side menu", () => {
  /*
   * In the Dashboard the page sits beside its side menu: on a 1280px
   * screen the rules card is about 940px wide, for seven columns. The
   * templates, one line of names, pushed Status out of the card - the rows
   * scrolled sideways and a disabled rule looked like the rest - and every
   * name was cut to "Draft with Database...".
   */
  test("at 1280px every column is in sight, Status included, and every name reads in full", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=4&layout=page");
    await unfold(page);

    const card: Locator = rulesCard(page);
    const rows: Locator = card.locator("tbody tr");
    await expect(rows).toHaveCount(4);

    const fit: {
      cardWidth: number;
      boxWidth: number;
      tableWidth: number;
      statusRight: number;
      actionsLeft: number;
    } = await card.evaluate((element: Element) => {
      const table: HTMLElement = element.querySelector("table") as HTMLElement;
      const box: HTMLElement = table.parentElement as HTMLElement;
      const headers: Array<HTMLElement> = Array.from(
        table.querySelectorAll<HTMLElement>("thead th"),
      );
      const status: HTMLElement = headers.find((header: HTMLElement) => {
        return header.innerText.trim() === "Status";
      }) as HTMLElement;
      const actions: HTMLElement = headers[headers.length - 1] as HTMLElement;

      return {
        cardWidth: element.getBoundingClientRect().width,
        boxWidth: box.clientWidth,
        tableWidth: box.scrollWidth,
        statusRight: status.getBoundingClientRect().right,
        actionsLeft: actions.getBoundingClientRect().left,
      };
    });

    // The card is as wide as beside the real side menu.
    expect(fit.cardWidth).toBeGreaterThan(900);
    expect(fit.cardWidth).toBeLessThan(960);
    // Nothing scrolls sideways, and Status is not under the row's buttons.
    expect(fit.tableWidth).toBeLessThanOrEqual(fit.boxWidth);
    expect(fit.statusRight).toBeLessThanOrEqual(fit.actionsLeft + 1);

    // The turned-off rule says so.
    await expect(
      rows.nth(3).getByText("Disabled", { exact: true }),
    ).toBeVisible();

    // Every name in full, on as many lines as it takes.
    const cutNames: Array<string> = await card.evaluate((element: Element) => {
      return Array.from(element.querySelectorAll("tbody tr"))
        .map((row: Element): HTMLElement => {
          return row.querySelectorAll("td")[2]!
            .firstElementChild as HTMLElement;
        })
        .filter((name: HTMLElement): boolean => {
          return (
            name.scrollWidth > name.clientWidth + 1 ||
            name.scrollHeight > name.clientHeight + 1
          );
        })
        .map((name: HTMLElement): string => {
          return name.innerText;
        });
    });
    expect(cutNames).toEqual([]);
    await expect(rows.nth(3)).toContainText(
      "SEV1 and SEV2 incidents on the payments platform and the customer-facing API",
    );

    // Three templates, then how many more - which shows the rest.
    expect(await templatesIn(rows.nth(3))).toEqual([
      "Customer-facing outage",
      "Database outage",
      "Network partition between regions",
    ]);
    await rows
      .nth(3)
      .getByRole("button", { name: "2 more templates", exact: true })
      .click();
    expect(await templatesIn(rows.nth(3))).toEqual([
      "Customer-facing outage",
      "Database outage",
      "Network partition between regions",
      "Payments and checkout outage",
      "Security incident",
    ]);
    await expect(
      rows.nth(3).getByRole("button", { name: "Show less", exact: true }),
    ).toBeVisible();

    await screenshot(page, "rules-beside-menu");
  });
});

test.describe("everywhere", () => {
  test("on a phone every rule reads in full, and the page never scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page, "rules=3");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(card).toContainText(
      "Draft with Customer-facing outage, Security incident",
    );

    const sideways: number = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(sideways).toBeLessThanOrEqual(0);

    await screenshot(page, "phone");
  });

  test("on a phone a turned-off rule says Disabled, as the others say Enabled", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page, "rules=4");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(
      card.getByText(
        "SEV1 and SEV2 incidents on the payments platform and the customer-facing API",
      ),
    ).toBeVisible();

    // Each rule is a card of its fields; the turned-off one keeps its Status.
    await expect(card.getByText("Enabled", { exact: true })).toHaveCount(3);
    await expect(card.getByText("Disabled", { exact: true })).toHaveCount(1);
    await expect(card.getByText("Disabled", { exact: true })).toBeVisible();

    // Its templates, the first three, then how many more.
    await expect(
      card.getByRole("button", { name: "2 more templates", exact: true }),
    ).toBeVisible();
  });

  test("in dark mode the card is drawn on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=2&theme=dark");
    await unfold(page);

    const card: Locator = rulesCard(page);
    await expect(card.locator("tbody tr")).toHaveCount(2);

    const background: string = await card.evaluate((element: Element) => {
      let node: Element | null = element;

      while (node) {
        const color: string = getComputedStyle(node).backgroundColor;

        if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
          return color;
        }

        node = node.parentElement;
      }

      return "";
    });

    // Not the light card's white.
    expect(background).not.toBe("rgb(255, 255, 255)");

    await screenshot(page, "dark");
  });

  test("in German the card, its empty state and the Draft step speak German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "lang=de");
    await page
      .getByTestId("incident-ai-advanced-section")
      .getByRole("button")
      .first()
      .click();

    const title: string = GERMAN[CARD_TITLE]!;
    expect(title).toBeTruthy();
    expect(title).not.toBe(CARD_TITLE);

    const card: Locator = rulesCard(page, title);
    await expect(card).toContainText(GERMAN[CARD_DESCRIPTION]!);
    // The empty table's message, split as the table draws it.
    const [germanTitle, ...germanRest] = GERMAN[NO_RULES]!.split(". ");
    await expect(card).toContainText(germanTitle!);
    await expect(card).toContainText(germanRest.join(". "));

    // "Postmortem-Regel erstellen": the button names the rule in German too.
    await card
      .getByRole("button", { name: new RegExp(GERMAN["Postmortem Rule"]!) })
      .first()
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: GERMAN["Next"]!, exact: true })
      .click();

    await expect(dialog).toContainText(GERMAN[TEMPLATES_DESCRIPTION]!);
    await expect(dialog.getByRole("textbox").first()).toHaveValue(
      GERMAN[STANDARD_OUTLINE_NAME]!,
    );

    await screenshot(page, "german");
  });
});

/*
 * The LLM provider OneUptime AI drafts with (Common/Types/AI/
 * LlmProviderChoice): first under the Draft step's More fields. Its empty
 * box names the provider a rule that picks none uses - the project's
 * default, else the global one - and so does the folded line while there
 * is more than one to pick from; a pick is sent with the rule.
 */
const OPUS_PROVIDER_ID: string = "9d9d9d9d-0000-4000-8000-000000000003";
// The field's one line, the same on every kind of rule.
const POSTMORTEM_PROVIDER_DESCRIPTION: string =
  "OneUptime AI uses the default LLM provider for everything this rule starts, unless you pick another.";
const PROJECT_DEFAULT_SUMMARY: string =
  "The rule uses the project's default LLM provider, Azure GPT-4o.";
const PROJECT_DEFAULT_PLACEHOLDER: string = "Project default (Azure GPT-4o)";

// An id as a save sends it: a string, or an ObjectID as the form serialised it.
const idOfValue: (value: unknown) => string = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  const row: Record<string, unknown> = (value || {}) as Record<string, unknown>;
  return String(row["value"] || row["_id"] || "");
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

const providerPicker: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return dialog.getByTestId("rule-llm-provider-picker");
};

const providerBox: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return providerPicker(dialog).getByRole("combobox");
};

const providerShown: (dialog: Locator) => Locator = (
  dialog: Locator,
): Locator => {
  return providerPicker(dialog).getByTestId("entity-dropdown-value");
};

// The create dialog, on its Draft step.
const openDraftStep: (page: Page) => Promise<Locator> = async (
  page: Page,
): Promise<Locator> => {
  const dialog: Locator = await openCreateDialog(page);
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog).toContainText(TEMPLATES_DESCRIPTION);
  return dialog;
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

test.describe("the LLM provider a rule drafts with", () => {
  test("folded, the line names the provider a rule that picks none uses; open, the box names it, first under More fields", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "providers=project");
    await unfold(page);
    const dialog: Locator = await openDraftStep(page);

    await expect(dialog.getByTestId("collapsible-section-summary")).toHaveText(
      PROJECT_DEFAULT_SUMMARY,
    );

    await openMoreFields(dialog);
    await expect(
      dialog.getByText("LLM Provider", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText(POSTMORTEM_PROVIDER_DESCRIPTION);
    await expect(dialog).not.toContainText("LLM Provider (Optional)");
    await expect(providerBox(dialog)).toHaveAttribute(
      "placeholder",
      PROJECT_DEFAULT_PLACEHOLDER,
    );
    // First under More fields, above the description.
    expect((await providerBox(dialog).boundingBox())!.y).toBeLessThan(
      (await dialog
        .getByRole("textbox", { name: /^Description/ })
        .boundingBox())!.y,
    );
  });

  /*
   * The global provider alone: nothing to pick between, so the folded line
   * says nothing of it (none at all, the description being the only other
   * field); open, the box names it.
   */
  test("with the global provider alone, the folded line says nothing of it; the box names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await unfold(page);
    const dialog: Locator = await openDraftStep(page);

    await expect(moreFieldsButton(dialog)).toBeVisible();
    await expect(dialog.getByTestId("collapsible-section-summary")).toHaveCount(
      0,
    );

    await openMoreFields(dialog);
    await expect(providerBox(dialog)).toHaveAttribute(
      "placeholder",
      "Global provider (OneUptime AI)",
    );
  });

  test("a pick is sent with the rule", async ({ page }: { page: Page }) => {
    await openPage(page, "providers=project");
    await unfold(page);
    const dialog: Locator = await openDraftStep(page);
    await openMoreFields(dialog);

    await providerBox(dialog).click();
    await page.getByRole("option", { name: /^Claude Opus/ }).click();
    await expect(providerShown(dialog)).toContainText("Claude Opus");

    await dialog
      .getByRole("button", { name: "Create Postmortem Rule" })
      .click();
    await expect(dialog).toBeHidden();

    const sent: Recorded = await recorded(page);
    expect(idOfValue(sent.creates[0]!.data["llmProviderId"])).toBe(
      OPUS_PROVIDER_ID,
    );
  });

  test("a rule's pick is shown when it is edited, and clearing it saves none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "rules=1&providers=project&rulePick=opus");
    await unfold(page);

    await rulesCard(page)
      .locator("tbody tr")
      .first()
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByText("Draft", { exact: true }).click();

    const folded: Array<string> = (
      await dialog.getByTestId("folded-section-item").allInnerTexts()
    ).map((text: string): string => {
      return text.replace(/\s+/g, " ").trim();
    });
    expect(folded).toContain("LLM Provider: Claude Opus");

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
    expect(sent.updates.length).toBeGreaterThan(0);
    expect(
      sent.updates[sent.updates.length - 1]!.data["llmProviderId"] || null,
    ).toBeNull();
  });

  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`the field, open, at ${width}px, ${theme}`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openPage(
          page,
          ["providers=project", theme === "dark" ? "theme=dark" : ""]
            .filter(Boolean)
            .join("&"),
        );
        if (theme === "dark") {
          await expect(page.locator("html")).toHaveClass(/dark/);
        }
        await unfold(page);

        const dialog: Locator = await openDraftStep(page);
        await openMoreFields(dialog);
        await providerBox(dialog).click();
        await expect(page.getByRole("option")).toHaveCount(3);

        expect(
          await page.evaluate(() => {
            return document.documentElement.scrollWidth;
          }),
        ).toBeLessThanOrEqual(width);
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
          `postmortem-rule-llm-provider-${width}-${theme}`,
        );
      });
    }
  }
});
