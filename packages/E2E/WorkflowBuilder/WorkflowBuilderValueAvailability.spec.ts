import { expect, Locator, Page, test } from "@playwright/test";

/*
 * What a step can use, told from what it cannot, in the real workflow
 * builder.
 *
 * The maintainer's ask: "Inserting a variable - Pls make the available and
 * non-available variables a little more visually distinct." The list a
 * setting opens from { } tells four things apart now:
 *
 *  - what is there on every run: the list, as before;
 *  - a record's fields its step does not pass on: after the ones it does,
 *    greyed, under a line that says whose they are and what to do - and a
 *    chip that reads one is amber and says the same;
 *  - a step that ran on some runs only (it follows If / Else's Yes): an
 *    amber line under its name;
 *  - a step that runs later, on another branch or never: folded at the end,
 *    each with why, and never picked.
 *
 * The rules are unit tested in packages/Common (StepGraph, StepValueSource,
 * ReferenceDescription, the menu). What only a browser shows is checked
 * here, with the real Incident schema and the real step catalog: where each
 * line lands, that greyed and amber really look different from a value that
 * can be used and can still be read - in the dark theme too - that the
 * folded steps end in view when they are opened, and that nothing runs off
 * a phone's screen.
 */

type Box = { x: number; y: number; width: number; height: number };

const SETTINGS_DIALOG: string = '[role="dialog"][aria-modal="true"]';

const TRIGGER_ID: string = "incident-on-update-1";
const SLACK_ID: string = "slack-send-message-to-channel-1";

const MODEL: string = `local.components.${TRIGGER_ID}.returnValues.model`;
const WHOLE_INCIDENT: string = `{{${MODEL}}}`;
const INCIDENT_ID: string = `{{${MODEL}._id}}`;
const TITLE: string = `{{${MODEL}.title}}`;
const DESCRIPTION: string = `{{${MODEL}.description}}`;
const ROOT_CAUSE: string = `{{${MODEL}.rootCause}}`;
const STATE_NAME: string = `{{${MODEL}.currentIncidentState.name}}`;
const STATE_ID: string = `{{${MODEL}.currentIncidentStateId}}`;
const POST_STATUS: string =
  "{{local.components.api-post-1.returnValues.response-status}}";

const NOT_PASSED_ON_NOTE: string =
  "On Update Incident doesn't pass these on, so they are empty here. Add them to its Fields to pass on to use them.";
const NOT_PASSED_ON_CHIP: string =
  '"On Update Incident" doesn\'t pass this field on, so it is empty here. Add it to its Fields to pass on.';
const SOME_RUNS_ONLY: string =
  "Runs only when If / Else takes Yes, so its values can be empty here.";

// WCAG AA for text of this size.
const READABLE: number = 4.5;

function stored(name: string, value: unknown): string {
  return `&${name}=${encodeURIComponent(JSON.stringify(value))}`;
}

function stepCard(page: Page, componentId: string): Locator {
  return page.locator(".react-flow__node", { hasText: componentId });
}

// One step's settings, in the scenario's workflow.
async function openStep(
  page: Page,
  scenario: string,
  componentId: string,
  query: string = "",
): Promise<Locator> {
  await page.goto(`/?scenario=${scenario}${query}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await stepCard(page, componentId).click();

  const dialog: Locator = page.locator(SETTINGS_DIALOG);

  await expect(dialog).toBeVisible();

  return dialog;
}

// The list of values a setting's { } opens, once it has its values.
async function openValues(
  page: Page,
  dialog: Locator,
  argumentId: string,
): Promise<Locator> {
  await dialog
    .getByTestId(`workflow-argument-${argumentId}-insert-value`)
    .click();

  const menu: Locator = page.getByTestId("value-picker");

  await expect(menu).toBeVisible();
  await expect(menu.getByText("Loading variables…")).toHaveCount(0);

  return menu;
}

function value(menu: Locator, reference: string): Locator {
  return menu.locator(
    `[data-testid="value-picker-option"][data-reference="${reference}"]`,
  );
}

// The Incident the trigger passes on, opened to its fields.
async function openIncident(
  page: Page,
  query: string = "",
): Promise<{ dialog: Locator; menu: Locator }> {
  const dialog: Locator = await openStep(page, "record", "log-1", query);
  const menu: Locator = await openValues(page, dialog, "value");

  await value(menu, WHOLE_INCIDENT).click();
  await expect(menu.getByTestId("value-picker-back")).toBeVisible();
  await expect(value(menu, INCIDENT_ID)).toBeVisible();

  return { dialog: dialog, menu: menu };
}

type ListedValue = { reference: string; isEmptyHere: boolean };

async function listedValues(menu: Locator): Promise<Array<ListedValue>> {
  return menu
    .getByTestId("value-picker-option")
    .evaluateAll((options: Array<Element>): Array<ListedValue> => {
      return options.map((option: Element): ListedValue => {
        return {
          reference: option.getAttribute("data-reference") || "",
          isEmptyHere: option.getAttribute("data-empty-here") === "true",
        };
      });
    });
}

type ChipSeen = { reference: string; tone: string; title: string };

async function chipsIn(
  dialog: Locator,
  argumentId: string,
): Promise<Array<ChipSeen>> {
  return dialog
    .getByTestId(`workflow-argument-${argumentId}`)
    .locator("[data-template-reference]")
    .evaluateAll((chips: Array<Element>): Array<ChipSeen> => {
      return chips.map((chip: Element): ChipSeen => {
        return {
          reference: chip.getAttribute("data-template-reference") || "",
          tone: chip.getAttribute("data-tone") || "",
          title: chip.getAttribute("title") || "",
        };
      });
    });
}

function chip(dialog: Locator, argumentId: string, reference: string): Locator {
  return dialog
    .getByTestId(`workflow-argument-${argumentId}`)
    .locator(`[data-template-reference="${reference}"]`);
}

// What the builder would save for one of a step's settings.
async function savedArgument(
  page: Page,
  stepId: string,
  argumentId: string,
): Promise<unknown> {
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

      return graph.nodes.find((node: { data: { id: string } }): boolean => {
        return node.data.id === data.stepId;
      })?.data.arguments?.[data.argumentId];
    },
    { stepId: stepId, argumentId: argumentId },
  );
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
}

type Colour = { r: number; g: number; b: number; a: number };

function parseColour(text: string): Colour {
  const parts: Array<number> = (text.match(/[\d.]+/g) || []).map(Number);

  return {
    r: parts[0] || 0,
    g: parts[1] || 0,
    b: parts[2] || 0,
    a: parts.length > 3 ? (parts[3] as number) : 1,
  };
}

// A colour that lets what is behind it through, drawn over a solid one.
function over(top: Colour, bottom: Colour): Colour {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

function luminanceOf(colour: Colour): number {
  const channels: Array<number> = [colour.r, colour.g, colour.b].map(
    (part: number): number => {
      const channel: number = part / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    },
  );

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

// How well one colour reads on another, as WCAG counts it: 1 to 21.
function contrastOf(foreground: Colour, background: Colour): number {
  const lighter: number = Math.max(
    luminanceOf(foreground),
    luminanceOf(background),
  );
  const darker: number = Math.min(
    luminanceOf(foreground),
    luminanceOf(background),
  );

  return (lighter + 0.05) / (darker + 0.05);
}

async function colourOf(
  locator: Locator,
  property: "color" | "backgroundColor" = "color",
): Promise<Colour> {
  return parseColour(
    await locator.evaluate(
      (element: Element, name: "color" | "backgroundColor"): string => {
        return getComputedStyle(element)[name];
      },
      property,
    ),
  );
}

// Amber, in either theme: far more red than blue, and green in between.
function isAmber(colour: Colour): boolean {
  return colour.r > colour.b + 80 && colour.r > colour.g && colour.g > colour.b;
}

/*
 * The solid colour behind an element: its own ground and those of what it
 * sits in, each drawn over the next - a chip's tint lets the field through.
 */
async function groundOf(locator: Locator): Promise<Colour> {
  const layers: Array<string> = await locator.evaluate(
    (element: Element): Array<string> => {
      const found: Array<string> = [];
      let current: Element | null = element;

      while (current) {
        found.push(getComputedStyle(current).backgroundColor);
        current = current.parentElement;
      }

      return found;
    },
  );

  let ground: Colour = parseColour("rgb(255, 255, 255)");

  for (const layer of layers.reverse()) {
    ground = over(parseColour(layer), ground);
  }

  return ground;
}

// What a value is called, in its row of the list.
function nameOf(option: Locator): Locator {
  return option.locator('[data-part="name"]');
}

// The step a chip's value comes from, and the last thing it reads.
function chipParts(one: Locator): Array<Locator> {
  return [one.locator("span").first(), one.locator("span").last()];
}

/*
 * Whether an element is wholly inside the part of the list that shows: not
 * under its lower edge, where a line would be cut through.
 */
async function isWhollyInList(
  menu: Locator,
  element: Locator,
): Promise<boolean> {
  const list: Box = await boxOf(menu.getByRole("listbox"));
  const box: Box = await boxOf(element);

  return (
    box.y >= list.y - 0.5 && box.y + box.height <= list.y + list.height + 0.5
  );
}

async function expectNothingOffTheSide(
  page: Page,
  menu: Locator,
): Promise<void> {
  const viewport: { width: number; height: number } | null =
    page.viewportSize();
  const box: Box = await boxOf(menu);

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport!.height);

  // Nothing in the list is wider than the list.
  expect(
    await menu.getByRole("listbox").evaluate((element: Element): boolean => {
      return element.scrollWidth <= element.clientWidth;
    }),
  ).toBe(true);
  expect(
    await page.evaluate((): boolean => {
      return (
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
      );
    }),
  ).toBe(true);
}

test.describe("Workflow builder: a record's fields its step does not pass on", () => {
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

  test("the fields the trigger passes on come first; the rest follow, greyed, under a line that says what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The trigger passes on the incident's title, and nothing else.
    const { menu } = await openIncident(page);
    const listed: Array<ListedValue> = await listedValues(menu);

    // The record, its ID - always passed on - and the title.
    expect(
      listed
        .filter((entry: ListedValue): boolean => {
          return !entry.isEmptyHere;
        })
        .map((entry: ListedValue): string => {
          return entry.reference;
        }),
    ).toEqual([WHOLE_INCIDENT, INCIDENT_ID, TITLE]);

    const emptyHere: Array<string> = listed
      .filter((entry: ListedValue): boolean => {
        return entry.isEmptyHere;
      })
      .map((entry: ListedValue): string => {
        return entry.reference;
      });

    // Every other field of an incident is still offered: 11 of them.
    expect(emptyHere).toHaveLength(11);
    expect(emptyHere).toEqual(
      expect.arrayContaining([DESCRIPTION, ROOT_CAUSE, STATE_ID]),
    );
    // All of what is passed on, then all of what is not.
    expect(
      listed.map((entry: ListedValue): boolean => {
        return entry.isEmptyHere;
      }),
    ).toEqual([
      false,
      false,
      false,
      ...emptyHere.map((): boolean => {
        return true;
      }),
    ]);

    const note: Locator = menu.getByTestId("value-picker-empty-here-note");

    await expect(note).toHaveCount(1);
    await expect(note).toHaveText(NOT_PASSED_ON_NOTE);

    // The line is between the two, and is there to read without scrolling.
    const noteBox: Box = await boxOf(note);
    const titleBox: Box = await boxOf(value(menu, TITLE));
    const descriptionBox: Box = await boxOf(value(menu, DESCRIPTION));

    expect(noteBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    expect(descriptionBox.y).toBeGreaterThanOrEqual(
      noteBox.y + noteBox.height - 0.5,
    );
    expect(await isWhollyInList(menu, note)).toBe(true);

    // And a greyed field shows under it, so the list plainly goes on.
    const list: Box = await boxOf(menu.getByRole("listbox"));

    expect(descriptionBox.y + 12).toBeLessThanOrEqual(list.y + list.height);

    /*
     * A field that is passed on says what it is; one that is not says no
     * more than its name and kind - the line above them has said why.
     */
    await expect(value(menu, TITLE)).toContainText("Title of this incident");
    await expect(value(menu, DESCRIPTION)).toHaveText(
      /^\s*Description\s*Long text\s*$/i,
    );
    expect(descriptionBox.height).toBeLessThan(titleBox.height - 8);

    /*
     * Greyed says so to the eye. By ear, each greyed field is described by
     * the line over them, and a field that is passed on by nothing.
     */
    await expect(value(menu, DESCRIPTION)).toHaveAccessibleDescription(
      NOT_PASSED_ON_NOTE,
    );
    await expect(value(menu, ROOT_CAUSE)).toHaveAccessibleDescription(
      NOT_PASSED_ON_NOTE,
    );
    // A field that is passed on has only its tooltip: the reference it inserts.
    await expect(value(menu, TITLE)).toHaveAccessibleDescription(TITLE);
  });

  test("greyed is lighter than a field that can be used, and still readable; so is the line", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { menu } = await openIncident(page);
    const ground: Colour = await colourOf(menu, "backgroundColor");
    const usable: Colour = await colourOf(nameOf(value(menu, TITLE)));
    const greyed: Colour = await colourOf(nameOf(value(menu, DESCRIPTION)));
    const note: Colour = await colourOf(
      menu.getByTestId("value-picker-empty-here-note"),
    );

    // Told apart at a glance: a third of the contrast, at the most.
    expect(contrastOf(greyed, ground)).toBeLessThan(
      contrastOf(usable, ground) / 3,
    );
    // And not so faint that it cannot be read.
    expect(contrastOf(greyed, ground)).toBeGreaterThanOrEqual(READABLE);
    expect(contrastOf(note, ground)).toBeGreaterThanOrEqual(READABLE);
  });

  test("a field that is not passed on can still be picked: its chip is amber and says what is wrong and how to fix it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { dialog, menu } = await openIncident(page);

    await value(menu, DESCRIPTION).click();

    // Picked like any other value: the list closes and the chip is there.
    await expect(menu).toHaveCount(0);
    expect(await chipsIn(dialog, "value")).toEqual([
      { reference: TITLE, tone: "Normal", title: TITLE },
      {
        reference: DESCRIPTION,
        tone: "Warning",
        title: `${DESCRIPTION}\n${NOT_PASSED_ON_CHIP}`,
      },
    ]);

    const usable: Locator = chip(dialog, "value", TITLE);
    const warning: Locator = chip(dialog, "value", DESCRIPTION);

    await expect(warning).toHaveText("On Update Incident›Incident›description");
    expect(isAmber(await colourOf(warning))).toBe(true);
    expect(isAmber(await colourOf(usable))).toBe(false);

    // Each part of each chip reads on the chip's own ground.
    for (const one of [usable, warning]) {
      const ground: Colour = await groundOf(one);

      for (const part of chipParts(one)) {
        expect(contrastOf(await colourOf(part), ground)).toBeGreaterThanOrEqual(
          READABLE,
        );
      }
    }

    // It is saved as written: the warning is advice, not a refusal.
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);

    expect(await savedArgument(page, "log-1", "value")).toBe(
      `${TITLE}${DESCRIPTION}`,
    );
  });

  test("by keyboard: a search finds a field that is not passed on, under the line, and Enter picks it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openStep(page, "record", "log-1");
    const menu: Locator = await openValues(page, dialog, "value");

    // Right opens the record the arrow keys are on.
    await expect(value(menu, WHOLE_INCIDENT)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ArrowRight");
    await expect(menu.getByTestId("value-picker-back")).toBeVisible();
    await expect(value(menu, INCIDENT_ID)).toBeVisible();

    await page.keyboard.type("root");

    expect(await listedValues(menu)).toEqual([
      { reference: ROOT_CAUSE, isEmptyHere: true },
    ]);
    // Nothing that is passed on matches, and the line still says whose it is.
    await expect(menu.getByTestId("value-picker-empty-here-note")).toHaveText(
      NOT_PASSED_ON_NOTE,
    );
    await expect(value(menu, ROOT_CAUSE)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("Enter");

    await expect(menu).toHaveCount(0);
    expect(await chipsIn(dialog, "value")).toEqual([
      { reference: TITLE, tone: "Normal", title: TITLE },
      {
        reference: ROOT_CAUSE,
        tone: "Warning",
        title: `${ROOT_CAUSE}\n${NOT_PASSED_ON_CHIP}`,
      },
    ]);
  });

  test("Back, out of a record's fields, is a target a finger can hit, and takes the list back to the steps", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { menu } = await openIncident(page);
    const back: Locator = menu.getByTestId("value-picker-back");
    const target: Box = await boxOf(back);

    // It was 20px tall: under what a finger, or WCAG's 24px, asks.
    expect(target.height).toBeGreaterThanOrEqual(24);
    expect(target.width).toBeGreaterThanOrEqual(24);

    // And the row it is in is no taller for it: the fields start where they did.
    const search: Box = await boxOf(menu.getByTestId("value-picker-search"));

    expect(search.y - (target.y + target.height)).toBeLessThan(20);

    await back.click();

    await expect(back).toHaveCount(0);
    await expect(menu.getByTestId("value-picker-empty-here-note")).toHaveCount(
      0,
    );
    expect(await listedValues(menu)).toEqual([
      { reference: WHOLE_INCIDENT, isEmptyHere: false },
    ]);
    // The focus is still in the search box, for the keys.
    await expect(menu.getByTestId("value-picker-search")).toBeFocused();
  });

  test("a related record's field the trigger passes on is with the fields that can be used, and a search keeps the two apart", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { menu } = await openIncident(
      page,
      stored("select", { title: true, currentIncidentState: { name: true } }),
    );

    await expect(value(menu, STATE_NAME)).toContainText(
      "Current Incident State › Name",
    );
    await expect(value(menu, STATE_NAME)).not.toHaveAttribute(
      "data-empty-here",
      "true",
    );

    await menu.getByTestId("value-picker-search").fill("state");

    // The state's name is passed on; the column that holds its ID is not.
    expect(await listedValues(menu)).toEqual([
      { reference: STATE_NAME, isEmptyHere: false },
      { reference: STATE_ID, isEmptyHere: true },
    ]);

    const note: Box = await boxOf(
      menu.getByTestId("value-picker-empty-here-note"),
    );
    const passedOn: Box = await boxOf(value(menu, STATE_NAME));
    const notPassedOn: Box = await boxOf(value(menu, STATE_ID));

    expect(note.y).toBeGreaterThanOrEqual(passedOn.y + passedOn.height);
    expect(notPassedOn.y).toBeGreaterThanOrEqual(note.y + note.height - 0.5);
  });

  test("with Fields to pass on left empty nothing can be said about what arrives: no line, and nothing greyed", async ({
    page,
  }: {
    page: Page;
  }) => {
    // An older workflow's trigger, saved before the list had to hold a field.
    const { menu } = await openIncident(page, "&select=");

    await expect(value(menu, DESCRIPTION)).toBeVisible();

    await expect(menu.getByTestId("value-picker-empty-here-note")).toHaveCount(
      0,
    );
    expect(
      (await listedValues(menu)).filter((entry: ListedValue): boolean => {
        return entry.isEmptyHere;
      }),
    ).toEqual([]);
  });

  test("adding the field to Fields to pass on makes it a value like any other, and its chip is no longer a warning", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The Log reads the title; the trigger passes on only the description.
    const log: Locator = await openStep(
      page,
      "record",
      "log-1",
      stored("select", { description: true }),
    );

    expect(await chipsIn(log, "value")).toEqual([
      {
        reference: TITLE,
        tone: "Warning",
        title: `${TITLE}\n${NOT_PASSED_ON_CHIP}`,
      },
    ]);

    await log.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);

    // What the chip says to do: add it to the trigger's Fields to pass on.
    await stepCard(page, TRIGGER_ID).click();

    const trigger: Locator = page.locator(SETTINGS_DIALOG);

    await trigger.getByTestId("fields-to-pass-on-add").click();
    await trigger.getByTestId("fields-to-pass-on-option-title").click();
    await trigger.getByTestId("fields-to-pass-on-done").click();
    await expect(trigger.getByTestId("fields-to-pass-on-chip")).toHaveCount(2);
    await expect(
      trigger
        .getByTestId("fields-to-pass-on-chip")
        .filter({ hasText: "Title" }),
    ).toHaveCount(1);
    await trigger.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(SETTINGS_DIALOG)).toHaveCount(0);

    await stepCard(page, "log-1").click();

    const after: Locator = page.locator(SETTINGS_DIALOG);

    await expect(chip(after, "value", TITLE)).toBeVisible();
    expect(await chipsIn(after, "value")).toEqual([
      { reference: TITLE, tone: "Normal", title: TITLE },
    ]);

    // And in the list it is with the fields that can be used.
    const menu: Locator = await openValues(page, after, "value");

    await value(menu, WHOLE_INCIDENT).click();
    await expect(value(menu, TITLE)).toBeVisible();
    await expect(value(menu, TITLE)).not.toHaveAttribute(
      "data-empty-here",
      "true",
    );
    await expect(value(menu, DESCRIPTION)).not.toHaveAttribute(
      "data-empty-here",
      "true",
    );
    await expect(value(menu, ROOT_CAUSE)).toHaveAttribute(
      "data-empty-here",
      "true",
    );
  });

  test("nothing runs off the side: the line wraps inside the list, and the list keeps to the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { menu } = await openIncident(page);
    const note: Locator = menu.getByTestId("value-picker-empty-here-note");
    const list: Box = await boxOf(menu.getByRole("listbox"));
    const noteBox: Box = await boxOf(note);

    expect(noteBox.x).toBeGreaterThanOrEqual(list.x);
    expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(list.x + list.width);
    // Wrapped, not cut: all of its words are on show.
    expect(
      await note.evaluate((element: Element): boolean => {
        return element.scrollWidth <= element.clientWidth;
      }),
    ).toBe(true);

    await expectNothingOffTheSide(page, menu);
  });

  test("in the dark theme the line, the greyed fields and the amber chip are told apart as well, and can be read", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { dialog, menu } = await openIncident(page, "&theme=dark");
    const ground: Colour = await colourOf(menu, "backgroundColor");

    // The list is dark, like the dialog it opens over.
    expect(luminanceOf(ground)).toBeLessThan(0.12);

    const usable: Colour = await colourOf(nameOf(value(menu, TITLE)));
    const greyed: Colour = await colourOf(nameOf(value(menu, DESCRIPTION)));
    const note: Colour = await colourOf(
      menu.getByTestId("value-picker-empty-here-note"),
    );

    // Dimmer than a field that can be used, and still read.
    expect(contrastOf(greyed, ground)).toBeLessThan(
      contrastOf(usable, ground) / 2,
    );
    expect(contrastOf(greyed, ground)).toBeGreaterThanOrEqual(READABLE);
    expect(contrastOf(note, ground)).toBeGreaterThanOrEqual(READABLE);

    await value(menu, DESCRIPTION).click();

    const usableChip: Locator = chip(dialog, "value", TITLE);
    const warningChip: Locator = chip(dialog, "value", DESCRIPTION);

    await expect(warningChip).toHaveAttribute("data-tone", "Warning");
    expect(isAmber(await colourOf(warningChip))).toBe(true);
    expect(isAmber(await colourOf(usableChip))).toBe(false);

    // Neither chip is the light theme's: a pale ground with dark words.
    for (const one of [usableChip, warningChip]) {
      const chipGround: Colour = await groundOf(one);

      expect(luminanceOf(chipGround)).toBeLessThan(0.12);

      for (const part of chipParts(one)) {
        expect(
          contrastOf(await colourOf(part), chipGround),
        ).toBeGreaterThanOrEqual(READABLE);
      }
    }
  });
});

test.describe("Workflow builder: a step that runs on some runs only, on another branch, later or never", () => {
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

  /*
   * The workflow: On Update Incident, then If / Else. Yes runs an HTTP POST,
   * No a Log, and both lead to Slack. An HTTP GET follows Slack and another
   * is connected to nothing.
   */
  test("where both branches meet, the step on one of them says so in amber under its name - and its values can still be picked", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openStep(page, "record-branch", SLACK_ID);
    const menu: Locator = await openValues(page, dialog, "text");
    const line: Locator = menu.getByTestId("value-picker-sometimes");

    // Only the POST: the trigger ran on every run that got here.
    await expect(line).toHaveCount(1);
    await expect(line).toHaveText(SOME_RUNS_ONLY);

    // The step's own group: its name, the line and its values.
    const group: Locator = menu
      .getByRole("group")
      .filter({ has: page.getByTestId("value-picker-sometimes") });

    await expect(group).toHaveCount(1);
    await expect(group).toContainText("API Post (JSON)");
    await expect(group).toContainText("api-post-1");

    // Under the step's name and above its values.
    const heading: Box = await boxOf(group.getByText("API Post (JSON)"));
    const lineBox: Box = await boxOf(line);
    const first: Box = await boxOf(group.getByRole("option").first());

    expect(lineBox.y).toBeGreaterThanOrEqual(heading.y + heading.height - 0.5);
    expect(first.y).toBeGreaterThanOrEqual(lineBox.y + lineBox.height - 0.5);
    expect(await isWhollyInList(menu, line)).toBe(true);

    // Amber, which nothing else in the list is, and readable.
    const ground: Colour = await colourOf(menu, "backgroundColor");
    const amber: Colour = await colourOf(line);

    expect(isAmber(amber)).toBe(true);
    expect(contrastOf(amber, ground)).toBeGreaterThanOrEqual(READABLE);
    expect(isAmber(await colourOf(nameOf(value(menu, POST_STATUS))))).toBe(
      false,
    );

    // Its values are offered like any other, not greyed, and one is picked.
    await expect(group.getByRole("option")).toHaveCount(4);
    await expect(value(menu, POST_STATUS)).not.toHaveAttribute(
      "data-empty-here",
      "true",
    );

    /*
     * By ear, each of them is described by the line. The trigger's value,
     * there on every run, has only its tooltip: the reference it inserts.
     */
    await expect(value(menu, POST_STATUS)).toHaveAccessibleDescription(
      SOME_RUNS_ONLY,
    );
    await expect(value(menu, WHOLE_INCIDENT)).toHaveAccessibleDescription(
      WHOLE_INCIDENT,
    );

    // A search that finds one of them keeps the line over it.
    await menu.getByTestId("value-picker-search").fill("response status");
    expect(await listedValues(menu)).toEqual([
      { reference: POST_STATUS, isEmptyHere: false },
    ]);
    await expect(line).toHaveText(SOME_RUNS_ONLY);

    await value(menu, POST_STATUS).click();

    await expect(menu).toHaveCount(0);
    // It may be empty on a run; it is not a mistake, so the chip is no warning.
    expect(await chipsIn(dialog, "text")).toEqual([
      { reference: POST_STATUS, tone: "Normal", title: POST_STATUS },
    ]);
  });

  test("there, the steps after it and the one never connected are folded at the end, each with why", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openStep(page, "record-branch", SLACK_ID);
    const menu: Locator = await openValues(page, dialog, "text");
    const toggle: Locator = menu.getByTestId("value-picker-unavailable-toggle");

    await expect(toggle).toHaveText("2 steps aren't available here");
    await toggle.click();

    const steps: Locator = menu.getByTestId("value-picker-unavailable-step");

    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toHaveAttribute("data-step", "api-get-1");
    await expect(
      steps.nth(0).getByTestId("value-picker-unavailable-reason"),
    ).toHaveText("Runs after this step.");
    await expect(steps.nth(1)).toHaveAttribute("data-step", "api-get-2");
    await expect(
      steps.nth(1).getByTestId("value-picker-unavailable-reason"),
    ).toHaveText("Not connected to the trigger, so it never runs.");

    // They were under the fold of a long list: opened, they are in view.
    await expect(steps.nth(1)).toBeInViewport({ ratio: 1 });
    await expect
      .poll(async (): Promise<boolean> => {
        return isWhollyInList(menu, steps.nth(1));
      })
      .toBe(true);
  });

  test("on the other branch the step cannot be used at all: it is folded with why, and the last of them ends in view", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The Log on No: the POST on Yes never runs before it.
    const dialog: Locator = await openStep(page, "record-branch", "log-1");
    const menu: Locator = await openValues(page, dialog, "value");

    // Nothing here ran on some runs only.
    await expect(menu.getByTestId("value-picker-sometimes")).toHaveCount(0);

    const toggle: Locator = menu.getByTestId("value-picker-unavailable-toggle");

    await expect(toggle).toHaveText("4 steps aren't available here");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByTestId("value-picker-unavailable-hint")).toHaveText(
      "Their values aren't there when this step runs.",
    );

    const steps: Locator = menu.getByTestId("value-picker-unavailable-step");

    expect(
      await steps.evaluateAll((elements: Array<Element>): Array<string> => {
        return elements.map((element: Element): string => {
          return `${element.getAttribute("data-step")}: ${
            element.querySelector(
              '[data-testid="value-picker-unavailable-reason"]',
            )?.textContent || ""
          }`;
        });
      }),
    ).toEqual([
      "api-post-1: Not on the path to this step. Connect it before this step to use its values.",
      `${SLACK_ID}: Runs after this step.`,
      "api-get-1: Runs after this step.",
      "api-get-2: Not connected to the trigger, so it never runs.",
    ]);

    /*
     * The list was short and grew to its full height as they opened, and a
     * moment later their reasons got their indent and the longest wrapped
     * onto another line: the last step still ends in view, not cut through.
     */
    await expect(steps.last()).toBeInViewport({ ratio: 1 });
    await expect
      .poll(async (): Promise<boolean> => {
        return isWhollyInList(menu, steps.last());
      })
      .toBe(true);

    // Named and explained, and none of their values offered.
    expect(await listedValues(menu)).toEqual([
      { reference: WHOLE_INCIDENT, isEmptyHere: false },
    ]);
    await expect(
      menu.getByTestId("value-picker-unavailable-value"),
    ).toHaveCount(0);
  });

  test("a folded step's name, its ID and its reason can be read, and are greyer than a step that can be used", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openStep(page, "record-branch", "log-1");
    const menu: Locator = await openValues(page, dialog, "value");

    await menu.getByTestId("value-picker-unavailable-toggle").click();

    const ground: Colour = await colourOf(menu, "backgroundColor");
    const step: Locator = menu
      .getByTestId("value-picker-unavailable-step")
      .first();
    const usable: Locator = menu.getByRole("group").first();

    /*
     * Two HTTP GETs are folded here, and their IDs are all that tells them
     * apart: the words that explain are written to be read.
     */
    for (const words of [
      step.locator('[data-part="step-name"]'),
      step.locator('[data-part="step-id"]'),
      step.getByTestId("value-picker-unavailable-reason"),
      menu.getByTestId("value-picker-unavailable-hint"),
      usable.locator('[data-part="group-subtitle"]'),
    ]) {
      await expect(words).toBeVisible();
      expect(contrastOf(await colourOf(words), ground)).toBeGreaterThanOrEqual(
        READABLE,
      );
    }

    // And the step that can be used stands out from the ones that cannot.
    expect(
      contrastOf(
        await colourOf(usable.locator('[data-part="group-title"]')),
        ground,
      ),
    ).toBeGreaterThan(
      contrastOf(
        await colourOf(step.locator('[data-part="step-name"]')),
        ground,
      ) * 1.5,
    );
  });

  test("nothing runs off the side: the amber line and the reasons wrap inside the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    const slack: Locator = await openStep(page, "record-branch", SLACK_ID);
    let menu: Locator = await openValues(page, slack, "text");
    const line: Locator = menu.getByTestId("value-picker-sometimes");
    const list: Box = await boxOf(menu.getByRole("listbox"));
    const lineBox: Box = await boxOf(line);

    expect(lineBox.x).toBeGreaterThanOrEqual(list.x);
    expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(list.x + list.width);
    await expectNothingOffTheSide(page, menu);

    const log: Locator = await openStep(page, "record-branch", "log-1");

    menu = await openValues(page, log, "value");
    await menu.getByTestId("value-picker-unavailable-toggle").click();

    const reasons: Locator = menu.getByTestId(
      "value-picker-unavailable-reason",
    );

    await expect(reasons).toHaveCount(4);

    for (let index: number = 0; index < 4; index++) {
      expect(
        await reasons.nth(index).evaluate((element: Element): boolean => {
          return element.scrollWidth <= element.clientWidth;
        }),
      ).toBe(true);
    }

    await expectNothingOffTheSide(page, menu);
  });

  test("in the dark theme the amber line is amber on dark, and the folded steps' words can be read", async ({
    page,
  }: {
    page: Page;
  }) => {
    const dialog: Locator = await openStep(
      page,
      "record-branch",
      SLACK_ID,
      "&theme=dark",
    );
    const menu: Locator = await openValues(page, dialog, "text");
    const ground: Colour = await colourOf(menu, "backgroundColor");
    const line: Colour = await colourOf(
      menu.getByTestId("value-picker-sometimes"),
    );

    expect(luminanceOf(ground)).toBeLessThan(0.12);
    expect(isAmber(line)).toBe(true);
    // Not the light theme's amber, which is dark words for a white ground.
    expect(luminanceOf(line)).toBeGreaterThan(0.4);
    expect(contrastOf(line, ground)).toBeGreaterThanOrEqual(READABLE);

    await menu.getByTestId("value-picker-unavailable-toggle").click();

    const step: Locator = menu
      .getByTestId("value-picker-unavailable-step")
      .first();

    for (const words of [
      step.locator('[data-part="step-name"]'),
      step.locator('[data-part="step-id"]'),
      step.getByTestId("value-picker-unavailable-reason"),
      menu.getByTestId("value-picker-unavailable-hint"),
    ]) {
      expect(contrastOf(await colourOf(words), ground)).toBeGreaterThanOrEqual(
        READABLE,
      );
    }
  });
});
