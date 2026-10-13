import { expect, Locator, Page, test } from "@playwright/test";

/*
 * A record trigger's two field lists in the real workflow builder.
 *
 * The maintainer's ask: "Triggers: Listen on and Select fields - Please make
 * them a lot better. They are very confusing now." They were two identical
 * lists of 70-odd checkboxes stacked in one dialog, under names nobody uses.
 * They are Fields to watch and Fields to pass on now: each shows only what
 * it holds, as chips, says in a line what empty means, and adds fields from
 * one searchable list grouped the way people think of a record.
 *
 * The rules are unit tested in packages/Common. What only a browser shows is
 * checked here, against the real Incident schema: a press being a mousedown,
 * a change of focus and a click (a second press on Add field has to close
 * the list, not reopen it); Escape closing the list and never the dialog
 * around it; the list landing in view when it opens - on a phone the
 * dialog's buttons take a third of the screen - and opening there without
 * the keyboard over it; targets big enough for a finger; and the dark theme.
 */

type Box = { x: number; y: number; width: number; height: number };

const SETTINGS_DIALOG: string = '[role="dialog"][aria-modal="true"]';

const WATCH: string = "fields-to-watch";
const PASS_ON: string = "fields-to-pass-on";

const TRIGGER_ID: string = "incident-on-update-1";

// The parts of a row in the list: what the field is called, and its kind.
const NAME: string = '[data-part="name"]';
const KIND: string = '[data-part="kind"]';

function stored(name: string, value: unknown): string {
  return `&${name}=${encodeURIComponent(JSON.stringify(value))}`;
}

async function openBuilder(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/?scenario=record${query}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

// The trigger's settings, once its fields are in (or have failed to load).
async function openTrigger(page: Page, query: string = ""): Promise<Locator> {
  await openBuilder(page, query);
  await stepCard(page, TRIGGER_ID).click();

  const dialog: Locator = page.locator(SETTINGS_DIALOG);

  await expect(dialog.getByTestId(PASS_ON)).toBeVisible();
  await expect(dialog.getByTestId(WATCH)).toBeVisible();

  return dialog;
}

async function chips(dialog: Locator, list: string): Promise<Array<string>> {
  return dialog.getByTestId(`${list}-chip`).allInnerTexts();
}

function option(dialog: Locator, list: string, path: string): Locator {
  return dialog.getByTestId(`${list}-option-${path}`);
}

async function openList(dialog: Locator, list: string): Promise<Locator> {
  await dialog.getByTestId(`${list}-add`).click();

  const panel: Locator = dialog.getByTestId(`${list}-panel`);

  await expect(panel).toBeVisible();

  return panel;
}

async function save(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);
}

/*
 * What the builder would save for one of the trigger's settings: the same
 * JSON the lists always stored, as an object whether it was kept as text or
 * not.
 */
async function savedSetting(page: Page, argumentId: string): Promise<unknown> {
  return page.evaluate(
    (data: { stepId: string; argumentId: string }): unknown => {
      const graph: {
        nodes: Array<{
          data: { id: string; arguments?: Record<string, unknown> };
        }>;
      } = (
        window as unknown as {
          __savedGraph: {
            nodes: Array<{
              data: { id: string; arguments?: Record<string, unknown> };
            }>;
          };
        }
      ).__savedGraph;

      const value: unknown = graph.nodes.find(
        (node: { data: { id: string } }): boolean => {
          return node.data.id === data.stepId;
        },
      )?.data.arguments?.[data.argumentId];

      if (typeof value !== "string") {
        return value;
      }

      return value === "" ? "" : JSON.parse(value);
    },
    { stepId: TRIGGER_ID, argumentId: argumentId },
  );
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

async function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate((): string | null => {
    return document.activeElement?.getAttribute("data-testid") || null;
  });
}

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

/*
 * How a colour reads on what is behind it, as WCAG counts it, from the
 * luminance of each: 1 to 21, and 4.5 is what AA asks of small text.
 */
function contrast(colour: number, behind: number): number {
  return (Math.max(colour, behind) + 0.05) / (Math.min(colour, behind) + 0.05);
}

async function styleOf(
  locator: Locator,
  property: "backgroundColor" | "color" | "borderTopColor",
): Promise<string> {
  return locator.evaluate(
    (
      element: Element,
      name: "backgroundColor" | "color" | "borderTopColor",
    ) => {
      return getComputedStyle(element)[name];
    },
    property,
  );
}

test.describe("Workflow builder: a record trigger's field lists", () => {
  let pageErrors: Array<string> = [];

  test.beforeEach(async ({ page }: { page: Page }) => {
    pageErrors = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("the two lists have plain names, say what empty means, and show what they hold as chips", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);

    // The names nobody used are gone, and so are the walls of checkboxes.
    await expect(dialog.getByText("Listen on", { exact: false })).toHaveCount(
      0,
    );
    await expect(dialog.getByText("Select Fields")).toHaveCount(0);
    await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0);

    await expect(
      dialog.getByText(
        "Run only when an update changes one of these fields. Leave it empty to run on every change to the Incident.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "The Incident fields the next steps can use. A field you leave out is empty in later steps.",
        { exact: false },
      ),
    ).toBeVisible();

    // Watching nothing in particular is every change, and the list says so.
    await expect(dialog.getByTestId(`${WATCH}-empty`)).toHaveText(
      "Every change to the incident runs this workflow.",
    );
    expect(await chips(dialog, WATCH)).toEqual([]);
    expect(await chips(dialog, PASS_ON)).toEqual(["Title"]);

    // Each list is named by its label, for a screen reader.
    await expect(
      dialog.getByRole("list", { name: /^Fields to pass on/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("list", { name: /^Fields to watch/ }),
    ).toBeVisible();
  });

  test("Add field opens one searchable list, grouped the way a record is thought of", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);
    const panel: Locator = await openList(dialog, PASS_ON);

    await expect(dialog.getByTestId(`${PASS_ON}-add`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      panel.getByRole("combobox", { name: "Search 16 fields" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("listbox", { name: "Fields to pass on" }),
    ).toHaveAttribute("aria-multiselectable", "true");

    // The groups, in the order the list draws them.
    expect(
      await panel
        .locator(`[data-testid^="${PASS_ON}-group-"]`)
        .evaluateAll((headings: Array<Element>): Array<string> => {
          return headings.map((heading: Element): string => {
            return (heading.firstElementChild?.textContent || "").trim();
          });
        }),
    ).toEqual([
      "Main fields",
      "Other fields",
      "Related records",
      "Filled in by OneUptime",
    ]);
    await expect(panel.getByTestId(`${PASS_ON}-group-related`)).toContainText(
      "Open one to pick its fields",
    );

    // What the record is named by leads, already chosen.
    const first: Locator = panel.getByRole("option").first();

    await expect(first).toHaveAttribute(
      "data-testid",
      `${PASS_ON}-option-title`,
    );
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(first).toContainText("Title of this incident");
    await expect(first).toContainText("Long text");

    // A related record says how many fields it has before it is opened.
    await expect(option(dialog, PASS_ON, "currentIncidentState")).toContainText(
      "5 fields",
    );
    await expect(option(dialog, PASS_ON, "labels")).toContainText("Records");
    await expect(dialog.getByTestId(`${PASS_ON}-chosen-count`)).toHaveText(
      "1 chosen",
    );
  });

  test("a pick adds a chip and keeps the list open; Done closes it; the step saves the same JSON as ever", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);
    const panel: Locator = await openList(dialog, PASS_ON);

    await option(dialog, PASS_ON, "declaredAt").click();

    expect(await chips(dialog, PASS_ON)).toEqual(["Title", "Declared At"]);
    await expect(panel).toBeVisible();
    await expect(option(dialog, PASS_ON, "declaredAt")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByTestId(`${PASS_ON}-chosen-count`)).toHaveText(
      "2 chosen",
    );

    // A second press takes it out again, and a third puts it back.
    await option(dialog, PASS_ON, "declaredAt").click();
    expect(await chips(dialog, PASS_ON)).toEqual(["Title"]);
    await option(dialog, PASS_ON, "declaredAt").click();

    await dialog.getByTestId(`${PASS_ON}-done`).click();
    await expect(panel).toHaveCount(0);
    await expect(dialog.getByTestId(`${PASS_ON}-add`)).toBeFocused();
    await expect(dialog.getByTestId(`${PASS_ON}-add`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await save(page, dialog);

    expect(await savedSetting(page, "select")).toEqual({
      title: true,
      declaredAt: true,
    });
    // The other list was not touched, and is saved as it was.
    expect(await savedSetting(page, "listen-on")).toEqual({});
  });

  test("a related record opens to its fields, under it, and one of them is passed on inside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);

    await openList(dialog, PASS_ON);

    const state: Locator = option(dialog, PASS_ON, "currentIncidentState");

    await expect(state).toHaveAttribute("aria-expanded", "false");
    await expect(
      option(dialog, PASS_ON, "currentIncidentState.name"),
    ).toHaveCount(0);

    await state.click();

    await expect(state).toHaveAttribute("aria-expanded", "true");

    const name: Locator = option(dialog, PASS_ON, "currentIncidentState.name");

    await expect(name).toBeVisible();
    // Under the record and set in from it: its own field, not the incident's.
    const stateBox: Box = await boxOf(state.locator(NAME));
    const nameBox: Box = await boxOf(name.locator(NAME));

    expect(nameBox.y).toBeGreaterThan(stateBox.y);
    expect(nameBox.x).toBeGreaterThan(stateBox.x + 16);
    // Listed by its own name there: the record is right above it.
    await expect(name.locator(NAME)).toHaveText("Name");

    await name.click();

    expect(await chips(dialog, PASS_ON)).toEqual([
      "Title",
      "Current Incident State › Name",
    ]);
    await expect(state).toContainText("1 chosen");
    // Opening a record picks nothing by itself.
    await expect(state).toHaveAttribute("aria-selected", "false");

    await dialog.getByTestId(`${PASS_ON}-done`).click();
    await save(page, dialog);

    expect(await savedSetting(page, "select")).toEqual({
      title: true,
      currentIncidentState: { name: true },
    });
  });

  test("a related record with a field chosen is open when the list is", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(
      page,
      stored("select", { title: true, incidentSeverity: { name: true } }),
    );

    expect(await chips(dialog, PASS_ON)).toEqual([
      "Title",
      "Incident Severity › Name",
    ]);

    await openList(dialog, PASS_ON);

    await expect(option(dialog, PASS_ON, "incidentSeverity")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      option(dialog, PASS_ON, "incidentSeverity.name"),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      option(dialog, PASS_ON, "currentIncidentState"),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("the search finds a field by name, a related record's field by both names, and says when nothing matches", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);
    const panel: Locator = await openList(dialog, PASS_ON);
    const search: Locator = dialog.getByTestId(`${PASS_ON}-search`);

    await search.fill("root");
    await expect(panel.getByRole("option")).toHaveCount(1);
    await expect(option(dialog, PASS_ON, "rootCause")).toBeVisible();
    // A search is one flat list: no headings between two results.
    await expect(
      panel.locator(`[data-testid^="${PASS_ON}-group-"]`),
    ).toHaveCount(0);

    // A related record's field, without opening the record first.
    await search.fill("name");
    expect(
      await panel.getByRole("option").locator(NAME).allInnerTexts(),
    ).toEqual([
      "Current Incident State › Name",
      "Incident Severity › Name",
      "Labels › Name",
      "Monitors › Name",
    ]);

    await option(dialog, PASS_ON, "labels.name").click();
    expect(await chips(dialog, PASS_ON)).toEqual(["Title", "Labels › Name"]);

    await search.fill("zzzz");
    await expect(dialog.getByTestId(`${PASS_ON}-no-match`)).toHaveText(
      "No fields match “zzzz”.",
    );
    await expect(panel.getByRole("option")).toHaveCount(0);

    // Emptied, the whole grouped list is back.
    await search.fill("");
    await expect(panel.getByTestId(`${PASS_ON}-group-main`)).toBeVisible();
  });

  test("by keyboard: arrows walk the list, Right opens a record, Enter picks, and Escape closes the list - not the dialog", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone has no arrow keys.");

    const dialog: Locator = await openTrigger(page);

    await dialog.getByTestId(`${PASS_ON}-add`).focus();
    await page.keyboard.press("Enter");

    const search: Locator = dialog.getByTestId(`${PASS_ON}-search`);

    await expect(search).toBeFocused();

    const activeId: () => Promise<string | null> = async (): Promise<
      string | null
    > => {
      const id: string | null = await search.getAttribute(
        "aria-activedescendant",
      );

      return page.evaluate((elementId: string | null): string | null => {
        return elementId
          ? document.getElementById(elementId)?.getAttribute("data-testid") ||
              null
          : null;
      }, id);
    };

    expect(await activeId()).toBe(`${PASS_ON}-option-title`);

    await page.keyboard.press("ArrowDown");
    expect(await activeId()).toBe(`${PASS_ON}-option-currentIncidentState`);

    await page.keyboard.press("ArrowRight");
    await expect(
      option(dialog, PASS_ON, "currentIncidentState"),
    ).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("ArrowDown");
    expect(await activeId()).toBe(
      `${PASS_ON}-option-currentIncidentState.name`,
    );

    // Enter picks, and is never the settings form's submit.
    await page.keyboard.press("Enter");
    expect(await chips(dialog, PASS_ON)).toEqual([
      "Title",
      "Current Incident State › Name",
    ]);
    await expect(page.locator(SETTINGS_DIALOG)).toBeVisible();

    // Left goes back up to the record, and Left again closes it.
    await page.keyboard.press("ArrowLeft");
    expect(await activeId()).toBe(`${PASS_ON}-option-currentIncidentState`);
    await page.keyboard.press("ArrowLeft");
    await expect(
      option(dialog, PASS_ON, "currentIncidentState"),
    ).toHaveAttribute("aria-expanded", "false");

    // Up from the first row wraps to the last.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await activeId()).toBe(`${PASS_ON}-option-incidentNumberWithPrefix`);
    // The row the keyboard is on is scrolled to, not left under the fold.
    await expect(
      option(dialog, PASS_ON, "incidentNumberWithPrefix"),
    ).toBeInViewport({ ratio: 1 });

    await page.keyboard.press("Escape");
    await expect(dialog.getByTestId(`${PASS_ON}-panel`)).toHaveCount(0);
    await expect(page.locator(SETTINGS_DIALOG)).toBeVisible();
    await expect(dialog.getByTestId(`${PASS_ON}-add`)).toBeFocused();
  });

  test("Escape closes the list from anywhere in it - Done, its close button - and never the dialog with its unsaved settings", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone has no Escape key.");

    const dialog: Locator = await openTrigger(page);

    for (const part of ["done", "close", "add"]) {
      await openList(dialog, PASS_ON);
      await option(dialog, PASS_ON, "rootCause").click();
      await dialog.getByTestId(`${PASS_ON}-${part}`).focus();
      await page.keyboard.press("Escape");

      await expect(dialog.getByTestId(`${PASS_ON}-panel`)).toHaveCount(0);
      // It used to close the dialog, and drop what had just been picked.
      await expect(page.locator(SETTINGS_DIALOG)).toBeVisible();
      await expect(dialog.getByTestId(`${PASS_ON}-add`)).toBeFocused();
    }

    // Picked, unpicked, picked: the field is still there to save.
    expect(await chips(dialog, PASS_ON)).toEqual(["Title", "Root Cause"]);
  });

  test("a second press on Add field closes the list, and a press elsewhere in the dialog does too", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);
    const add: Locator = dialog.getByTestId(`${PASS_ON}-add`);
    const panel: Locator = dialog.getByTestId(`${PASS_ON}-panel`);

    await add.click();
    await expect(panel).toBeVisible();

    // The press closed it and its click opened it again, so it never closed.
    await add.click();
    await expect(panel).toHaveCount(0);
    await expect(add).toHaveAttribute("aria-expanded", "false");

    await add.click();
    await expect(panel).toBeVisible();

    await dialog.getByText("How other steps refer to this trigger").click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(SETTINGS_DIALOG)).toBeVisible();

    // One list at a time: opening the other closes this one.
    await add.click();
    await expect(panel).toBeVisible();
    await dialog.getByTestId(`${WATCH}-add`).click();
    await expect(dialog.getByTestId(`${WATCH}-panel`)).toBeVisible();
    await expect(panel).toHaveCount(0);
  });

  test("the list opens in view, whole, with the chosen fields still above it", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    if (!isMobile) {
      // A laptop: the dialog is shorter than the settings it holds.
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    const dialog: Locator = await openTrigger(page);
    const scrollArea: Locator = dialog.getByTestId("modal-content");

    // Fields to pass on is the second list: its Add field is low in the dialog.
    await openList(dialog, PASS_ON);

    const area: Box = await boxOf(scrollArea);
    const panel: Box = await boxOf(dialog.getByTestId(`${PASS_ON}-panel`));
    const add: Box = await boxOf(dialog.getByTestId(`${PASS_ON}-add`));
    const done: Box = await boxOf(dialog.getByTestId(`${PASS_ON}-done`));

    /*
     * Down to Done - it opened with all but its first row under the dialog's
     * buttons - and not scrolled so far that the chips leave the screen.
     */
    expect(panel.y).toBeGreaterThanOrEqual(area.y - 1);
    expect(panel.y + panel.height).toBeLessThanOrEqual(
      area.y + area.height + 1,
    );
    expect(done.y + done.height).toBeLessThanOrEqual(area.y + area.height + 1);
    expect(add.y).toBeGreaterThanOrEqual(area.y - 1);
    expect(add.y + add.height).toBeLessThanOrEqual(panel.y);

    // It holds about five fields and scrolls for the rest.
    const list: Box = await boxOf(dialog.getByTestId(`${PASS_ON}-list`));

    expect(list.height).toBeGreaterThan(250);
    expect(list.height).toBeLessThanOrEqual(288);

    /*
     * Picks add chips above the list, and a new line of them pushes it
     * down: it is kept in view, so Done never slides under the buttons.
     */
    for (const path of [
      "declaredAt",
      "description",
      "rootCause",
      "isVisibleOnStatusPage",
      "createdAt",
      "incidentNumber",
    ]) {
      await option(dialog, PASS_ON, path).click();
    }

    await expect(dialog.getByTestId(`${PASS_ON}-chip`)).toHaveCount(7);

    const areaAfter: Box = await boxOf(scrollArea);
    const doneAfter: Box = await boxOf(dialog.getByTestId(`${PASS_ON}-done`));
    const panelAfter: Box = await boxOf(dialog.getByTestId(`${PASS_ON}-panel`));

    expect(doneAfter.y + doneAfter.height).toBeLessThanOrEqual(
      areaAfter.y + areaAfter.height + 1,
    );
    expect(panelAfter.y + panelAfter.height).toBeLessThanOrEqual(
      areaAfter.y + areaAfter.height + 1,
    );
  });

  test("with a mouse the search box is focused, ready to type; on a phone the list opens for browsing, without the keyboard over it", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    const dialog: Locator = await openTrigger(page);

    await openList(dialog, PASS_ON);

    expect(await focusedTestId(page)).toBe(
      isMobile ? `${PASS_ON}-add` : `${PASS_ON}-search`,
    );

    // Either way a tap on a field picks it, and the list stays.
    await option(dialog, PASS_ON, "declaredAt").click();
    expect(await chips(dialog, PASS_ON)).toEqual(["Title", "Declared At"]);
    await expect(dialog.getByTestId(`${PASS_ON}-panel`)).toBeVisible();

    // And the search still searches when it is tapped.
    await dialog.getByTestId(`${PASS_ON}-search`).click();
    await dialog.getByTestId(`${PASS_ON}-search`).fill("root");
    await expect(option(dialog, PASS_ON, "rootCause")).toBeVisible();
    await expect(
      dialog.getByTestId(`${PASS_ON}-panel`).getByRole("option"),
    ).toHaveCount(1);
  });

  test("a chip's remove button takes the field out and hands the focus on; each is a target a finger can hit", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(
      page,
      stored("select", { title: true, description: true, rootCause: true }),
    );
    const removes: Locator = dialog.getByTestId(`${PASS_ON}-remove`);

    await expect(removes).toHaveCount(3);
    await expect(removes.nth(1)).toHaveAccessibleName("Remove Description");

    // 24px square at the least, and the chip no taller for it.
    for (const index of [0, 1, 2]) {
      const target: Box = await boxOf(removes.nth(index));

      expect(target.width).toBeGreaterThanOrEqual(24);
      expect(target.height).toBeGreaterThanOrEqual(24);
    }

    const chip: Box = await boxOf(
      dialog.getByTestId(`${PASS_ON}-chip`).first(),
    );

    expect(chip.height).toBeLessThanOrEqual(28);

    await removes.nth(1).focus();
    await page.keyboard.press("Enter");

    expect(await chips(dialog, PASS_ON)).toEqual(["Title", "Root Cause"]);
    // To the chip that took its place...
    await expect(removes.nth(1)).toBeFocused();
    await expect(removes.nth(1)).toHaveAccessibleName("Remove Root Cause");

    await page.keyboard.press("Enter");
    // ...to the last one left...
    await expect(removes.nth(0)).toBeFocused();
    await expect(removes.nth(0)).toHaveAccessibleName("Remove Title");

    await page.keyboard.press("Enter");
    // ...and to Add field once there is none.
    await expect(dialog.getByTestId(`${PASS_ON}-add`)).toBeFocused();
    expect(await chips(dialog, PASS_ON)).toEqual([]);

    // The list's other small controls are no smaller: 24px to aim at.
    await openList(dialog, PASS_ON);

    for (const control of ["add", "edit-json", "close", "done"]) {
      const target: Box = await boxOf(
        dialog.getByTestId(`${PASS_ON}-${control}`),
      );

      expect({
        control,
        tallEnough: target.height >= 24,
        wideEnough: target.width >= 24,
      }).toEqual({ control, tallEnough: true, wideEnough: true });
    }
  });

  test("the list that must hold a field says so the moment it is emptied, and Save waits for one", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);
    const saveButton: Locator = dialog.getByRole("button", { name: "Save" });
    const required: Locator = dialog
      .getByTestId(PASS_ON)
      .getByText("Fields to pass on is required.");

    await expect(saveButton).toBeEnabled();
    await expect(required).toHaveCount(0);

    await dialog.getByTestId(`${PASS_ON}-remove`).click();

    await expect(dialog.getByTestId(`${PASS_ON}-empty`)).toHaveText(
      "Pick the fields the next steps need.",
    );
    /*
     * At once, with the focus still in the list: the dialog already says
     * something needs fixing, and this is what.
     */
    await expect(required).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await openList(dialog, PASS_ON);
    await option(dialog, PASS_ON, "title").click();

    await expect(required).toHaveCount(0);
    await expect(saveButton).toBeEnabled();

    // Fields to watch may be empty: emptied, it has nothing to complain of.
    await dialog.getByTestId(`${WATCH}-add`).click();
    await option(dialog, WATCH, "title").click();
    await dialog.getByTestId(`${WATCH}-done`).click();
    await dialog.getByTestId(`${WATCH}-remove`).click();

    await expect(dialog.getByText("Fields to watch is required.")).toHaveCount(
      0,
    );
    await expect(saveButton).toBeEnabled();
  });

  test("Fields to watch offers what an update can change: a related record under its own name, and nothing set when the record is made", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);
    const panel: Locator = await openList(dialog, WATCH);

    await expect(
      panel.getByRole("combobox", { name: "Search 9 fields" }),
    ).toBeVisible();

    // No related record to open: none of its own fields is this record's.
    await expect(panel.getByTestId(`${WATCH}-group-related`)).toHaveCount(0);
    await expect(panel.getByTestId(`${WATCH}-group-system`)).toHaveCount(0);

    for (const never of [
      "_id",
      "createdAt",
      "createdByUserId",
      "incidentNumber",
      "incidentNumberWithPrefix",
      "currentIncidentState",
      "currentIncidentState.name",
    ]) {
      await expect(option(dialog, WATCH, never)).toHaveCount(0);
    }

    // The state is watched as "Current Incident State", not as an ID column.
    const state: Locator = option(dialog, WATCH, "currentIncidentStateId");

    await expect(state.locator(NAME)).toHaveText("Current Incident State");
    await expect(state).toContainText("Record");
    await expect(state).not.toHaveAttribute("aria-expanded", /.*/);

    await state.click();
    await option(dialog, WATCH, "monitors").click();

    expect(await chips(dialog, WATCH)).toEqual([
      "Current Incident State",
      "Monitors",
    ]);
    await expect(dialog.getByTestId(`${WATCH}-empty`)).toHaveCount(0);

    await dialog.getByTestId(`${WATCH}-done`).click();
    await save(page, dialog);

    // Stored by the column an update changes, which the trigger hears.
    expect(await savedSetting(page, "listen-on")).toEqual({
      currentIncidentStateId: true,
      monitors: true,
    });
    expect(await savedSetting(page, "select")).toEqual({ title: true });
  });

  test("an older workflow's lists read as the fields they name, stored as text or not, and are saved untouched until changed", async ({
    page,
  }: {
    page: Page;
  }) => {
    const watch: Record<string, unknown> = {
      currentIncidentState: true,
      title: true,
    };
    const select: Record<string, unknown> = {
      title: true,
      currentIncidentState: { name: true },
    };

    const dialog: Locator = await openTrigger(
      page,
      `&stored=text${stored("watch", watch)}${stored("select", select)}`,
    );

    // The old list stored the watched state as the record: it reads the same.
    expect(await chips(dialog, WATCH)).toEqual([
      "Current Incident State",
      "Title",
    ]);
    expect(await chips(dialog, PASS_ON)).toEqual([
      "Title",
      "Current Incident State › Name",
    ]);

    await save(page, dialog);

    // Opening and saving a step rewrites nothing.
    expect(await savedSetting(page, "listen-on")).toEqual(watch);
    expect(await savedSetting(page, "select")).toEqual(select);

    // Changed, the watched state is stored by the column an update changes.
    await stepCard(page, TRIGGER_ID).click();

    const again: Locator = page.locator(SETTINGS_DIALOG);

    await expect(again.getByTestId(WATCH)).toBeVisible();
    await again
      .getByTestId(`${WATCH}-remove`)
      .and(again.getByRole("button", { name: "Remove Title" }))
      .click();
    await save(page, again);

    expect(await savedSetting(page, "listen-on")).toEqual({
      currentIncidentStateId: true,
    });
  });

  test("a field the record does not have is an amber chip that says so, and can be taken out", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(
      page,
      stored("select", { title: true, oldField: true }),
    );
    const unknown: Locator = dialog.locator(
      `[data-testid="${PASS_ON}-chip"][data-unknown="true"]`,
    );

    await expect(unknown).toHaveText("oldField");
    await expect(unknown).toHaveAttribute(
      "title",
      "There is no field called “oldField”, so the run leaves it out.",
    );
    await expect(unknown.locator("svg").first()).toBeVisible();

    // Told apart from a real field by more than its words.
    const known: Locator = dialog.locator(
      `[data-testid="${PASS_ON}-chip"][data-unknown="false"]`,
    );

    expect(await styleOf(unknown, "backgroundColor")).not.toBe(
      await styleOf(known, "backgroundColor"),
    );

    await unknown.getByRole("button", { name: "Remove oldField" }).click();

    expect(await chips(dialog, PASS_ON)).toEqual(["Title"]);
    await save(page, dialog);
    expect(await savedSetting(page, "select")).toEqual({ title: true });
  });

  test("a value the list cannot show is kept as JSON, with the reason, and saved as it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    const select: Record<string, unknown> = {
      title: true,
      currentIncidentState: true,
    };
    const dialog: Locator = await openTrigger(page, stored("select", select));
    const list: Locator = dialog.getByTestId(PASS_ON);

    await expect(list).toHaveAttribute("data-view", "json");

    const kept: Locator = dialog.getByTestId(`${PASS_ON}-kept-as-json`);

    await expect(kept).toContainText("Kept as JSON");
    await expect(kept).toContainText(
      "“currentIncidentState” passes on the whole related record. Pick the fields of it the next steps need.",
    );
    await expect(kept).toContainText(
      "Your workflow keeps running unchanged. Edit the JSON below, or click Start over to pick the fields from the list.",
    );
    await expect(list.locator("textarea")).toHaveValue(
      /"currentIncidentState": true/,
    );
    // No way back to a list that could not show it.
    await expect(dialog.getByTestId(`${PASS_ON}-back-to-list`)).toHaveCount(0);

    // The other list is a list as usual.
    await expect(dialog.getByTestId(WATCH)).toHaveAttribute(
      "data-view",
      "list",
    );

    await save(page, dialog);
    expect(await savedSetting(page, "select")).toEqual(select);

    await stepCard(page, TRIGGER_ID).click();

    const again: Locator = page.locator(SETTINGS_DIALOG);

    await again.getByTestId(`${PASS_ON}-start-over`).click();

    await expect(again.getByTestId(PASS_ON)).toHaveAttribute(
      "data-view",
      "list",
    );
    await expect(again.getByTestId(`${PASS_ON}-empty`)).toBeVisible();
  });

  test("Edit as JSON shows the value as it is stored, and Back to the list reads what was typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);
    const list: Locator = dialog.getByTestId(PASS_ON);

    await dialog.getByTestId(`${PASS_ON}-edit-json`).click();

    await expect(list).toHaveAttribute("data-view", "json");
    await expect(
      list.getByText(
        'Keys are the field names, such as "title". The ID is "_id".',
      ),
    ).toBeVisible();

    const editor: Locator = list.locator("textarea");

    await expect(editor).toHaveValue(/"title"/);
    await editor.fill(
      '{"title": true, "rootCause": true, "labels": {"name": true}}',
    );

    await dialog.getByTestId(`${PASS_ON}-back-to-list`).click();

    await expect(list).toHaveAttribute("data-view", "list");
    expect(await chips(dialog, PASS_ON)).toEqual([
      "Title",
      "Root Cause",
      "Labels › Name",
    ]);

    await save(page, dialog);
    expect(await savedSetting(page, "select")).toEqual({
      title: true,
      rootCause: true,
      labels: { name: true },
    });
  });

  test("while the fields load the lists say so, and then show what they hold", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBuilder(page, "&schema=slow");
    await stepCard(page, TRIGGER_ID).click();

    const dialog: Locator = page.locator(SETTINGS_DIALOG);

    for (const list of [WATCH, PASS_ON]) {
      await expect(dialog.getByTestId(`${list}-loading`)).toHaveText(
        "Loading the fields…",
      );
    }

    // Nothing to press that would do nothing yet.
    await expect(dialog.getByTestId(`${PASS_ON}-add`)).toHaveCount(0);

    await page.evaluate((): void => {
      (window as unknown as { releaseSchema: () => void }).releaseSchema();
    });

    await expect(dialog.getByTestId(`${PASS_ON}-loading`)).toHaveCount(0);
    expect(await chips(dialog, PASS_ON)).toEqual(["Title"]);
    await expect(dialog.getByTestId(`${WATCH}-empty`)).toBeVisible();
  });

  test("when the fields cannot be loaded, the JSON is still there to edit, and the list says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page, "&schema=fail");
    const list: Locator = dialog.getByTestId(PASS_ON);

    await expect(list).toHaveAttribute("data-view", "json");
    await expect(dialog.getByTestId(`${PASS_ON}-load-error`)).toHaveText(
      "Could not load the fields, so they are shown as JSON: The fields are not available right now.",
    );
    await expect(list.locator("textarea")).toHaveValue(/"title": true/);
    await expect(dialog.getByTestId(`${PASS_ON}-back-to-list`)).toHaveCount(0);

    // The step can still be changed and saved.
    await list.locator("textarea").fill('{"title": true, "description": true}');
    await save(page, dialog);

    expect(await savedSetting(page, "select")).toEqual({
      title: true,
      description: true,
    });
  });

  test("nothing runs off the side: long chips wrap, and the open list keeps to the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(
      page,
      stored("select", {
        title: true,
        description: true,
        rootCause: true,
        isVisibleOnStatusPage: true,
        currentIncidentState: { name: true, color: true },
        incidentSeverity: { name: true },
        labels: { name: true },
      }),
    );
    const area: Box = await boxOf(dialog.getByTestId("modal-content"));
    const chipList: Locator = dialog.getByTestId(`${PASS_ON}-chip`);

    await expect(chipList).toHaveCount(8);

    for (let index: number = 0; index < 8; index++) {
      const chip: Box = await boxOf(chipList.nth(index));

      expect(chip.x).toBeGreaterThanOrEqual(area.x);
      expect(chip.x + chip.width).toBeLessThanOrEqual(area.x + area.width);
    }

    await openList(dialog, PASS_ON);

    const panel: Box = await boxOf(dialog.getByTestId(`${PASS_ON}-panel`));

    expect(panel.x).toBeGreaterThanOrEqual(area.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(area.x + area.width);

    // A long description is cut short on its line, not wrapped under it.
    const row: Box = await boxOf(
      option(dialog, PASS_ON, "isVisibleOnStatusPage"),
    );
    const plain: Box = await boxOf(option(dialog, PASS_ON, "title"));

    expect(Math.abs(row.height - plain.height)).toBeLessThan(1.5);

    expect(
      await page.evaluate((): boolean => {
        return (
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
        );
      }),
    ).toBe(true);
    expect(
      await dialog
        .getByTestId("modal-content")
        .evaluate((element: Element): boolean => {
          return element.scrollWidth <= element.clientWidth;
        }),
    ).toBe(true);
  });

  test("the list's quieter words can still be read: a group's hint, and the line under a name on the row the pointer is on", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(page);
    const panel: Locator = await openList(dialog, PASS_ON);
    const ground: number = luminanceOf(await styleOf(panel, "backgroundColor"));

    // "Open one to pick its fields" says how the group works.
    const hint: Locator = panel
      .getByTestId(`${PASS_ON}-group-related`)
      .locator('[data-part="hint"]');

    await expect(hint).toHaveText("Open one to pick its fields");
    expect(
      contrast(luminanceOf(await styleOf(hint, "color")), ground),
    ).toBeGreaterThanOrEqual(4.5);

    // A row's line, with the pointer elsewhere: on the list's white.
    const declared: Locator = option(dialog, PASS_ON, "declaredAt");
    const detail: Locator = declared.locator('[data-part="detail"]');

    await option(dialog, PASS_ON, "title").hover();
    await expect(detail).toContainText("Date and time when this incident");

    const resting: string = await styleOf(detail, "color");

    expect(contrast(luminanceOf(resting), ground)).toBeGreaterThanOrEqual(4.5);

    // With the pointer on it the row is tinted, and the line a shade darker.
    await declared.hover();
    await expect
      .poll(async (): Promise<string> => {
        return styleOf(detail, "color");
      })
      .not.toBe(resting);

    const tint: number = luminanceOf(
      await styleOf(declared, "backgroundColor"),
    );

    expect(tint).toBeLessThan(ground);
    expect(
      contrast(luminanceOf(await styleOf(detail, "color")), tint),
    ).toBeGreaterThanOrEqual(4.5);
    // The colour it had would not have done there.
    expect(contrast(luminanceOf(resting), tint)).toBeLessThan(4.5);

    // A related record's line - how many fields it has - is the same.
    const state: Locator = option(dialog, PASS_ON, "currentIncidentState");

    await state.hover();
    await expect(state.locator('[data-part="detail"]')).toHaveText("5 fields");
    await expect
      .poll(async (): Promise<number> => {
        return contrast(
          luminanceOf(
            await styleOf(state.locator('[data-part="detail"]'), "color"),
          ),
          luminanceOf(await styleOf(state, "backgroundColor")),
        );
      })
      .toBeGreaterThanOrEqual(4.5);
  });

  test("in the dark theme the chips, the list, its rows and its notes are dark like the dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openTrigger(
      page,
      `&theme=dark${stored("select", { title: true, oldField: true })}`,
    );

    await openList(dialog, PASS_ON);
    await option(dialog, PASS_ON, "currentIncidentState").click();

    const surfaces: Array<Locator> = [
      dialog.locator(`[data-testid="${PASS_ON}-chip"][data-unknown="false"]`),
      dialog.locator(`[data-testid="${PASS_ON}-chip"][data-unknown="true"]`),
      dialog.getByTestId(`${PASS_ON}-chips`).locator(".."),
      dialog.getByTestId(`${PASS_ON}-panel`),
      // The row the pointer or the keyboard is on.
      option(dialog, PASS_ON, "currentIncidentState"),
      // A field's kind, in its pill.
      option(dialog, PASS_ON, "title").locator(KIND),
      // The foot of the list, with its count and Done.
      dialog.getByTestId(`${PASS_ON}-chosen-count`).locator(".."),
      dialog.getByTestId(`${PASS_ON}-done`),
    ];

    for (const surface of surfaces) {
      await expect(surface).toBeVisible();
      expect(
        luminanceOf(await styleOf(surface, "backgroundColor")),
      ).toBeLessThan(0.12);
    }

    // And what is written on them is light enough to read.
    for (const words of [
      dialog.locator(`[data-testid="${PASS_ON}-chip"][data-unknown="false"]`),
      option(dialog, PASS_ON, "title").locator(NAME),
      dialog.getByTestId(`${PASS_ON}-chosen-count`),
      dialog.getByTestId(`${WATCH}-empty`),
    ]) {
      expect(luminanceOf(await styleOf(words, "color"))).toBeGreaterThan(0.3);
    }

    // The note for a value kept as JSON, too.
    const kept: Locator = await openTrigger(
      page,
      `&theme=dark${stored("select", { currentIncidentState: true })}`,
    );
    const note: Locator = kept.getByTestId(`${PASS_ON}-kept-as-json`);

    await expect(note).toBeVisible();
    expect(luminanceOf(await styleOf(note, "backgroundColor"))).toBeLessThan(
      0.12,
    );
    expect(luminanceOf(await styleOf(note, "color"))).toBeGreaterThan(0.3);
  });
});

test.describe("Workflow builder: a record trigger added from the picker", () => {
  test("starts by passing on the field that names the record, and watching every change", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/?scenario=record-new");
    await page
      .locator(".react-flow__node", {
        hasText: "Choose what starts this workflow",
      })
      .click();

    // Through the Add Trigger panel, the way a person does it.
    const picker: Locator = page.getByTestId("side-over");
    const search: Locator = picker.locator("#workflow-component-search");

    await expect(search).toBeVisible();
    await search.fill("On Update Incident");
    await picker
      .getByRole("option", { name: "On Update Incident", exact: true })
      .click();
    await expect(picker).toHaveCount(0);

    const trigger: Locator = stepCard(page, TRIGGER_ID);

    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog: Locator = page.locator(SETTINGS_DIALOG);

    await expect(dialog.getByTestId(PASS_ON)).toBeVisible();

    // It works as it is added: nothing to fill in before it can be saved.
    expect(await chips(dialog, PASS_ON)).toEqual(["Title"]);
    await expect(dialog.getByTestId(`${WATCH}-empty`)).toHaveText(
      "Every change to the incident runs this workflow.",
    );
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();

    await save(page, dialog);

    expect(await savedSetting(page, "select")).toEqual({ title: true });
  });
});
