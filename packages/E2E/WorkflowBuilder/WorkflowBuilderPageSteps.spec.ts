import { expect, Locator, Page, test } from "@playwright/test";

/*
 * The Page steps in the real workflow builder.
 *
 * The maintainer's ask: "I want to conditionally page someone / a group of
 * people / an on-call person. Can I do this in workflow? ... Can you please
 * implement it and make it easier."
 *
 * So there are four steps - Page Users, Page a Team, Page Whoever Is On
 * Call, Page an On-Call Policy - and behind an If / Else or a Switch / Case
 * that is "page somebody when...". Each asks who to page (picked by name
 * from the project, or a value from an earlier step) and what the page is
 * about (a new alert, or an incident or alert that is already there).
 *
 * What only a browser shows is checked here: the card that says who is
 * paged, in the one colour that means a phone rings; the search list that
 * opens over the settings and stays on the screen; the value picker opening
 * from { } at the end of the row; a pick surviving Save into the graph the
 * builder would store; the settings under Page About swapping in place; a
 * step added to a workflow that starts on an incident arriving already
 * about that incident; and the settings on a phone and in the dark theme.
 * The rules themselves are unit tested in packages/Common.
 *
 * The fixture stands in for the API with a small project (PageScenarios.js).
 */

type Box = { x: number; y: number; width: number; height: number };

type SavedArguments = Record<string, unknown>;

const SETTINGS_DIALOG: string = '[role="dialog"][aria-modal="true"]';

// The fixture's project.
const JANE: string = "10000000-0000-4000-8000-000000000001";
const JOHN: string = "10000000-0000-4000-8000-000000000002";
const PLATFORM: string = "7eae0000-0000-4000-8000-000000000001";

const MANUAL_VALUE: string = "{{local.components.manual-1.returnValues.value}}";
const MANUAL_OWNERS: string =
  "{{local.components.manual-1.returnValues.value.owners}}";
const INCIDENT_ID: string =
  "{{local.components.incident-on-create-1.returnValues.model._id}}";
const ALERT_ID: string =
  "{{local.components.alert-on-create-1.returnValues.model._id}}";

// The page colour, as a browser reports it.
const PINK: string = "rgb(236, 72, 153)";

async function openBuilder(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

// A Page step's settings, once its form is drawn.
async function openSettings(page: Page, componentId: string): Promise<Locator> {
  await stepCard(page, componentId).click();
  const dialog: Locator = page.locator(SETTINGS_DIALOG);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("radiogroup", { name: "Page About" }),
  ).toBeVisible();
  return dialog;
}

async function save(page: Page, dialog: Locator): Promise<void> {
  const button: Locator = dialog.getByRole("button", { name: "Save" });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);
}

// What the builder would save for a step's settings.
async function savedArguments(
  page: Page,
  componentId: string,
): Promise<SavedArguments> {
  return page.evaluate((id: string): SavedArguments => {
    const graph: {
      nodes: Array<{ data: { id: string; arguments?: SavedArguments } }>;
    } = (
      window as unknown as {
        __savedGraph: {
          nodes: Array<{ data: { id: string; arguments?: SavedArguments } }>;
        };
      }
    ).__savedGraph;

    const node: { data: { arguments?: SavedArguments } } | undefined =
      graph.nodes.find((candidate: { data: { id: string } }): boolean => {
        return candidate.data.id === id;
      });

    return JSON.parse(JSON.stringify(node?.data.arguments || {}));
  }, componentId);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

// Whether a box is wholly on the screen, side to side.
async function isWithinViewport(
  page: Page,
  locator: Locator,
): Promise<boolean> {
  const box: Box = await boxOf(locator);
  const width: number = page.viewportSize()?.width || 0;

  return box.x >= -0.5 && box.x + box.width <= width + 0.5;
}

async function hasNoSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return (
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth
    );
  });
}

// The setting's row: its picks, its value chips, its button.
function who(dialog: Locator, argumentId: string): Locator {
  return dialog.getByTestId(`workflow-argument-${argumentId}`);
}

function picks(row: Locator): Locator {
  return row.getByTestId("people-chip");
}

// The search list that opens from the row's Add button.
async function openSearch(page: Page, row: Locator): Promise<Locator> {
  await row.getByTestId("people-picker-add-button").click();
  const popup: Locator = page.getByTestId("people-search-popup");
  await expect(popup).toBeVisible();
  return popup;
}

async function optionNames(popup: Locator): Promise<Array<string>> {
  return popup
    .getByTestId("people-search-option")
    .evaluateAll((options: Array<Element>): Array<string> => {
      return options.map((option: Element): string => {
        return option.getAttribute("aria-label") || option.textContent || "";
      });
    });
}

function textbox(dialog: Locator, name: string): Locator {
  return dialog.getByRole("textbox", { name: new RegExp(`^${name}`) });
}

async function typeInto(page: Page, box: Locator, text: string): Promise<void> {
  await box.click();
  await page.keyboard.type(text);
}

/*
 * A colour's relative luminance, 0 (black) to 1 (white), from the
 * rgb()/rgba() a computed style gives.
 */
function luminanceOf(color: string): number {
  const channels: Array<number> = (color.match(/[\d.]+/g) || [])
    .slice(0, 3)
    .map((part: string): number => {
      const value: number = Number(part) / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

async function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).backgroundColor;
  });
}

// What a card's header is painted with.
async function headerPaintOf(card: Locator, title: string): Promise<string> {
  return card
    .getByText(title, { exact: true })
    .evaluate((element: Element): string => {
      return getComputedStyle(element.parentElement as Element).backgroundImage;
    });
}

test.describe("Workflow builder: the Page steps", () => {
  let pageErrors: Array<string> = [];
  let reactFlowWarnings: Array<string> = [];

  test.beforeEach(async ({ page }: { page: Page }) => {
    pageErrors = [];
    reactFlowWarnings = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
    page.on("console", (message: { text: () => string }) => {
      if (message.text().includes("[React Flow]")) {
        reactFlowWarnings.push(message.text());
      }
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
    expect(reactFlowWarnings).toEqual([]);
  });

  test("a workflow that pages different people on different paths reads from its cards", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-conditional");

    const expected: Array<[string, string, string]> = [
      [
        "page-on-call-policy-1",
        "Page an On-Call Policy",
        "1 on-call policy · Incident",
      ],
      ["page-team-1", "Page a Team", "2 teams · Incident"],
      ["page-users-1", "Page Users", "1 user · Incident"],
    ];

    for (const [componentId, title, line] of expected) {
      const card: Locator = stepCard(page, componentId);

      await expect(card.getByTestId("workflow-node-summary")).toHaveText(line);
      await expect(card.getByTestId("workflow-node-output")).toHaveText([
        "Success",
        "Error",
      ]);
      // Set up: nothing to click to set up, and nothing wrong.
      await expect(card.getByTestId("workflow-node-setup-hint")).toHaveCount(0);
      await expect(card.getByTestId("workflow-node-issue-badge")).toHaveCount(
        0,
      );
      // The page colour, and no other step has it.
      expect(await headerPaintOf(card, title)).toContain(PINK);
    }

    expect(
      await headerPaintOf(stepCard(page, "switch-1"), "Switch / Case"),
    ).not.toContain(PINK);
  });

  test("a Page step nobody has set up says so, beside one that is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page");

    await expect(
      stepCard(page, "page-on-call-1").getByTestId("workflow-node-summary"),
    ).toHaveText("On call in 1 schedule · Incident");

    const unset: Locator = stepCard(page, "page-users-1");

    await expect(unset.getByTestId("workflow-node-setup-hint")).toHaveText(
      "Click to set up",
    );
    await expect(unset.getByTestId("workflow-node-description")).toHaveText(
      "Pages the people you name, by their own on-call rules.",
    );
  });

  test("a step that is set up opens with the schedule by name and the incident as a value", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page");
    const dialog: Locator = await openSettings(page, "page-on-call-1");
    const schedules: Locator = who(dialog, "on-call-schedules");

    // The id the step stores, shown as the schedule it is.
    await expect(picks(schedules)).toHaveCount(1);
    await expect(picks(schedules).first()).toContainText("Primary");

    await expect(
      dialog.getByRole("radio", { name: "An incident" }),
    ).toBeChecked();
    await expect(
      textbox(dialog, "Incident ID").getByTestId("template-reference-chip"),
    ).toHaveCount(1);
    // Nothing about a new alert: this page is about an incident.
    await expect(textbox(dialog, "Title")).toHaveCount(0);
    await expect(textbox(dialog, "Alert ID")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: /^More fields/ }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("who to page is searched by name, picked, and saved as the person's id", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page");
    const dialog: Locator = await openSettings(page, "page-users-1");
    const users: Locator = who(dialog, "users");

    // Nobody yet, and no title: nothing to save.
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();

    const popup: Locator = await openSearch(page, users);

    // Over the settings, and wholly on the screen.
    expect(await isWithinViewport(page, popup)).toBe(true);
    await expect(popup.getByTestId("people-search-option")).toHaveCount(4);
    await expect(popup).toContainText("jane@example.com");

    await popup.getByTestId("people-search-input").fill("jane");
    await expect(popup.getByTestId("people-search-option")).toHaveCount(1);
    await popup.getByTestId("people-search-option").first().click();

    await expect(picks(users)).toHaveCount(1);
    await expect(picks(users).first()).toContainText("Jane Doe");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("people-search-popup")).toHaveCount(0);
    // Escape closed the list, not the settings.
    await expect(dialog).toBeVisible();

    await typeInto(page, textbox(dialog, "Title"), "Payments are failing");
    await save(page, dialog);

    const saved: SavedArguments = await savedArguments(page, "page-users-1");

    expect(saved["users"]).toEqual([JANE]);
    expect(saved["title"]).toBe("Payments are failing");

    // And the card now says who it pages.
    await expect(
      stepCard(page, "page-users-1").getByTestId("workflow-node-summary"),
    ).toHaveText("1 user · New alert");
    await expect(
      stepCard(page, "page-users-1").getByTestId("workflow-node-setup-hint"),
    ).toHaveCount(0);
  });

  test("a pick is taken out with its own button, and the last one out leaves nothing to save", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-conditional");
    const dialog: Locator = await openSettings(page, "page-team-1");
    const teams: Locator = who(dialog, "teams");

    await expect(picks(teams)).toHaveCount(2);
    await teams.getByRole("button", { name: "Remove Database" }).click();
    await expect(picks(teams)).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();

    await teams.getByRole("button", { name: "Remove Platform" }).click();
    await expect(picks(teams)).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("a value from an earlier step sits in the row as a chip of its own, and comes out like a pick", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-new");

    await expect(
      stepCard(page, "page-users-1").getByTestId("workflow-node-summary"),
    ).toHaveText("Users from an earlier step · New alert");

    const dialog: Locator = await openSettings(page, "page-users-1");
    const users: Locator = who(dialog, "users");
    const valueChips: Locator = users.getByTestId(
      "workflow-argument-users-value-chip",
    );

    await expect(picks(users)).toHaveCount(2);
    await expect(valueChips).toHaveCount(1);
    // Named the way values are named in the Builder, not as its reference.
    await expect(valueChips.first()).toContainText("Manual");
    await expect(valueChips.first()).toContainText("owners");
    await expect(valueChips.first()).not.toContainText("{{");

    // After the picks, before { }: one row, in one order.
    const lastPick: Box = await boxOf(picks(users).last());
    const chip: Box = await boxOf(valueChips.first());
    const insert: Box = await boxOf(
      users.getByTestId("workflow-argument-users-insert-value"),
    );

    expect(
      chip.y > lastPick.y + 1 || chip.x >= lastPick.x + lastPick.width - 0.5,
    ).toBe(true);
    expect(insert.y > chip.y + 1 || insert.x >= chip.x + chip.width - 0.5).toBe(
      true,
    );

    await valueChips
      .first()
      .getByTestId("workflow-argument-users-value-chip-remove")
      .click();
    await expect(valueChips).toHaveCount(0);
    await expect(picks(users)).toHaveCount(2);

    await save(page, dialog);

    expect((await savedArguments(page, "page-users-1"))["users"]).toEqual([
      JANE,
      JOHN,
    ]);
    await expect(
      stepCard(page, "page-users-1").getByTestId("workflow-node-summary"),
    ).toHaveText("2 users · New alert");
  });

  test("{ } at the end of the row adds a value from the step before, saved as its reference", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-new");
    const dialog: Locator = await openSettings(page, "page-users-1");
    const users: Locator = who(dialog, "users");
    const insert: Locator = users.getByTestId(
      "workflow-argument-users-insert-value",
    );

    await expect(insert).toHaveAccessibleName(
      "Add a value from an earlier step or a variable",
    );
    await insert.click();

    const list: Locator = page.getByTestId("value-picker");
    await expect(list).toBeVisible();
    expect(await isWithinViewport(page, list)).toBe(true);

    await list
      .locator(
        `[data-testid="value-picker-option"][data-reference="${MANUAL_VALUE}"]`,
      )
      .click();
    await expect(page.getByTestId("value-picker")).toHaveCount(0);

    // Beside the one the step already had.
    await expect(
      users.getByTestId("workflow-argument-users-value-chip"),
    ).toHaveCount(2);

    await save(page, dialog);

    expect((await savedArguments(page, "page-users-1"))["users"]).toEqual([
      JANE,
      JOHN,
      MANUAL_OWNERS,
      MANUAL_VALUE,
    ]);
  });

  test("choosing what the page is about swaps the settings under it, and keeps what was typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-new");
    const dialog: Locator = await openSettings(page, "page-users-1");

    await expect(
      dialog.getByRole("radio", { name: "A new alert" }),
    ).toBeChecked();
    await expect(textbox(dialog, "Title")).toContainText(
      "Payments are failing",
    );
    await expect(
      dialog.getByRole("button", { name: /^More fields/ }),
    ).toContainText("Severity");

    await dialog.getByRole("radio", { name: "An incident" }).check();

    await expect(textbox(dialog, "Title")).toHaveCount(0);
    await expect(textbox(dialog, "Message")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: /^More fields/ }),
    ).toHaveCount(0);
    await expect(textbox(dialog, "Incident ID")).toBeVisible();
    // Required, and empty: nothing to save yet.
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();

    await dialog.getByRole("radio", { name: "An alert" }).check();
    await expect(textbox(dialog, "Incident ID")).toHaveCount(0);
    await expect(textbox(dialog, "Alert ID")).toBeVisible();

    await dialog.getByRole("radio", { name: "A new alert" }).check();
    await expect(textbox(dialog, "Title")).toContainText(
      "Payments are failing",
    );
    await expect(textbox(dialog, "Alert ID")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();

    // An alert's ID pasted in, and saved with the choice.
    await dialog.getByRole("radio", { name: "An alert" }).check();
    await typeInto(
      page,
      textbox(dialog, "Alert ID"),
      "a1e70000-0000-4000-8000-000000000001",
    );
    await save(page, dialog);

    const saved: SavedArguments = await savedArguments(page, "page-users-1");

    expect(saved["about"]).toBe("alert");
    expect(saved["alert-id"]).toBe("a1e70000-0000-4000-8000-000000000001");
    await expect(
      stepCard(page, "page-users-1").getByTestId("workflow-node-summary"),
    ).toHaveText("Users from an earlier step · Alert");
  });

  test("the severity of a new alert is one of the project's, most severe first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-new");
    const dialog: Locator = await openSettings(page, "page-users-1");

    await dialog.getByRole("button", { name: /^More fields/ }).click();

    const severity: Locator = dialog.getByRole("combobox", {
      name: /^Severity/,
    });

    await severity.click();
    await expect(page.getByRole("option")).toHaveText([
      "Critical",
      "High",
      "Low",
    ]);
    await page.getByRole("option", { name: "High" }).click();
    await save(page, dialog);

    expect((await savedArguments(page, "page-users-1"))["alert-severity"]).toBe(
      "5e5e0000-0000-4000-8000-000000000002",
    );
  });

  test("a Page step added to a workflow that starts on an incident is already about that incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-trigger");

    await page.getByTestId("add-component").click();
    const panel: Locator = page.getByTestId("side-over");
    await panel.locator("#workflow-component-search").fill("page team");
    await panel
      .getByRole("option", { name: "Page a Team", exact: true })
      .click();
    await expect(panel).toHaveCount(0);

    const card: Locator = stepCard(page, "page-team-1");

    await expect(card.getByTestId("workflow-node-setup-hint")).toHaveText(
      "Click to set up",
    );
    expect(await savedArguments(page, "page-team-1")).toEqual({
      about: "incident",
      "incident-id": INCIDENT_ID,
    });

    // All it still asks is who to page.
    const dialog: Locator = await openSettings(page, "page-team-1");

    await expect(
      dialog.getByRole("radio", { name: "An incident" }),
    ).toBeChecked();
    await expect(
      textbox(dialog, "Incident ID").getByTestId("template-reference-chip"),
    ).toHaveCount(1);
    await expect(textbox(dialog, "Title")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();

    const teams: Locator = who(dialog, "teams");
    const popup: Locator = await openSearch(page, teams);

    expect(await optionNames(popup)).toHaveLength(3);
    await popup.getByText("Platform", { exact: true }).click();
    await page.keyboard.press("Escape");
    await save(page, dialog);

    expect(await savedArguments(page, "page-team-1")).toEqual({
      teams: [PLATFORM],
      about: "incident",
      "incident-id": INCIDENT_ID,
    });
    await expect(card.getByTestId("workflow-node-summary")).toHaveText(
      "1 team · Incident",
    );
  });

  test("and one added to a workflow that starts on an alert is about that alert", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-alert");

    await page.getByTestId("add-component").click();
    const panel: Locator = page.getByTestId("side-over");
    await panel.locator("#workflow-component-search").fill("on call");
    await panel
      .getByRole("option", { name: "Page Whoever Is On Call", exact: true })
      .click();
    await expect(panel).toHaveCount(0);

    expect(await savedArguments(page, "page-on-call-1")).toEqual({
      about: "alert",
      "alert-id": ALERT_ID,
    });

    const dialog: Locator = await openSettings(page, "page-on-call-1");

    await expect(dialog.getByRole("radio", { name: "An alert" })).toBeChecked();
    await expect(
      textbox(dialog, "Alert ID").getByTestId("template-reference-chip"),
    ).toHaveCount(1);
  });

  test("the Add Component panel finds the Page steps by the word and by what people call it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-trigger");
    await page.getByTestId("add-component").click();
    const panel: Locator = page.getByTestId("side-over");
    const search: Locator = panel.locator("#workflow-component-search");

    for (const word of ["page", "pager", "someone"]) {
      await search.fill(word);

      await expect
        .poll(async () => {
          return (
            await panel
              .getByRole("option")
              .evaluateAll((options: Array<Element>): Array<string> => {
                return options.slice(0, 4).map((option: Element): string => {
                  return option.getAttribute("aria-label") || "";
                });
              })
          ).sort();
        })
        .toEqual([
          "Page Users",
          "Page Whoever Is On Call",
          "Page a Team",
          "Page an On-Call Policy",
        ]);
    }
  });

  test("an on-call policy that was archived is not offered, and one already picked still says what it is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-conditional");
    const dialog: Locator = await openSettings(page, "page-on-call-policy-1");
    const policies: Locator = who(dialog, "on-call-policies");

    await expect(picks(policies)).toHaveCount(1);
    await expect(picks(policies).first()).toContainText("Critical");

    const popup: Locator = await openSearch(page, policies);

    // "Old rota" is archived: it pages no one.
    await expect(popup.getByTestId("people-search-option")).toHaveCount(2);
    await expect(popup).not.toContainText("Old rota");
  });

  test("a project with nobody in it says so in the list, in words about paging", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page&project=empty");
    const dialog: Locator = await openSettings(page, "page-users-1");
    const popup: Locator = await openSearch(page, who(dialog, "users"));

    await expect(popup).toContainText(
      "This project has no people to page yet.",
    );
    await expect(popup.getByTestId("people-search-option")).toHaveCount(0);
  });

  test("the settings fit the screen: no sideways scroll, with the search list open or shut", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-new");
    const dialog: Locator = await openSettings(page, "page-users-1");
    const users: Locator = who(dialog, "users");

    expect(await hasNoSidewaysScroll(page)).toBe(true);

    for (const part of [
      users,
      dialog.getByTestId("workflow-argument-about"),
      textbox(dialog, "Title"),
      textbox(dialog, "Message"),
    ]) {
      expect(await isWithinViewport(page, part)).toBe(true);
    }

    // A long name and a long address do not push the row off the screen.
    const popup: Locator = await openSearch(page, users);

    await popup.getByTestId("people-search-input").fill("priya");
    await popup.getByTestId("people-search-option").first().click();
    await page.keyboard.press("Escape");

    await expect(picks(users)).toHaveCount(3);
    expect(await isWithinViewport(page, picks(users).last())).toBe(true);
    expect(await hasNoSidewaysScroll(page)).toBe(true);
  });

  test("in the dark theme the answers, the picks and the value chip are dark like the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "scenario=page-new&theme=dark");
    const dialog: Locator = await openSettings(page, "page-users-1");
    const users: Locator = who(dialog, "users");

    await expect(picks(users)).toHaveCount(2);

    for (const part of [
      dialog.getByTestId("workflow-argument-about").locator("> div").first(),
      picks(users).first(),
      users.getByTestId("workflow-argument-users-value-chip").first(),
    ]) {
      await expect(part).toBeVisible();
      expect(luminanceOf(await backgroundOf(part))).toBeLessThan(0.2);
    }

    // And the card on the canvas keeps the page colour.
    await page.keyboard.press("Escape");
  });
});
