import { expect, Locator, Page, test } from "@playwright/test";

/*
 * Run Workflow for a record trigger, in the real workflow builder.
 *
 * The maintainer's ask: "Run - Instead of UUID can I enter the user-facing
 * incident ID, for convenience? Can you please make this generic". The panel
 * asked for the incident's ID, a UUID nobody knows by heart. It asks which
 * incident now: a search that lists the newest ones when it opens and finds
 * them by number - with its prefix or without - by title or by ID.
 *
 * The fixture answers the search with the rules the server uses (the same
 * pure functions, Types/Workflow/RunRecord) over a handful of incidents; the
 * server's own lookup is tested against Postgres in packages/Common. What
 * only a browser shows is checked here: a press on the panel's button taking
 * the focus out of the box first (INC-11 typed out has to become the
 * incident before the confirmation is drawn), where the focus is after a
 * pick, the list and the panel on a phone, and the dark theme.
 *
 * And what a look at the panel in a browser found: the box has the focus as
 * the panel opens, with the newest incidents listed (not on a phone, where
 * that would throw the keyboard over them); Run with nothing picked says so
 * at the field, where a dialog used to say "Please fix errors" over a form
 * that showed none; the numbers are a column, so the titles line up; and
 * the confirmation sets the incident apart from the sentence it is named in.
 */

type Box = { x: number; y: number; width: number; height: number };

interface StartedRun {
  metadataId: string;
  arguments: Record<string, unknown>;
}

const FIELD: string = "run-record-field";

const INC_8: string = "a0000000-0000-4000-8000-000000000008";
const INC_11: string = "a0000000-0000-4000-8000-000000000011";
const OPS_7: string = "a0000000-0000-4000-8000-000000000007";

const RUNS_FOR_REAL: string =
  "Every step runs for real: anything it sends, writes or deletes actually happens.";

async function openRunPanel(page: Page, query: string = ""): Promise<Locator> {
  await page.goto(`/?scenario=record${query}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByTestId("run-workflow").click();

  // The panel's own box is empty: what it draws is fixed to the window.
  const panel: Locator = page.getByTestId("side-over");

  await expect(panel.getByTestId(FIELD)).toBeVisible();

  return panel;
}

function searchBox(panel: Locator): Locator {
  return panel.getByTestId(`${FIELD}-search`);
}

function options(panel: Locator): Locator {
  return panel.getByTestId(`${FIELD}-option`);
}

// What each listed record was found by, in the order the list draws them.
async function listed(panel: Locator): Promise<Array<string>> {
  return options(panel).evaluateAll((rows: Array<Element>): Array<string> => {
    return rows.map((row: Element): string => {
      return `${row.getAttribute("data-record-id")?.slice(-2)} ${row.getAttribute("data-matched-by")}`;
    });
  });
}

// Types into the box and waits for the list to answer for exactly that.
async function search(page: Page, panel: Locator, text: string): Promise<void> {
  await searchBox(panel).fill(text);
  await expect
    .poll(async (): Promise<string | undefined> => {
      const searches: Array<string> = await page.evaluate((): Array<string> => {
        return (window as unknown as { __recordSearches: Array<string> })
          .__recordSearches;
      });

      return searches[searches.length - 1];
    })
    .toBe(text.trim());
  await expect(panel.getByTestId(`${FIELD}-searching`)).toHaveCount(0);
}

function runButton(panel: Locator): Locator {
  return panel.getByRole("button", { name: "Run Workflow Manually" });
}

// The panel is a dialog too, and holds these: only the modal ones are meant.
const MODAL: string = '[role="dialog"][aria-modal="true"]';

function confirmation(page: Page): Locator {
  return page.locator(MODAL).filter({ hasText: "Run this workflow now?" });
}

// Any modal dialog at all: the one that used to say "Please fix errors".
function anyDialog(page: Page): Locator {
  return page.locator(MODAL);
}

const PICK_ONE: string = "Pick one from the list, or type its number or ID.";

async function startedRuns(page: Page): Promise<Array<StartedRun>> {
  return page.evaluate((): Array<StartedRun> => {
    return (window as unknown as { __runs: Array<StartedRun> }).__runs;
  });
}

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  if (!box) {
    throw new Error("Expected the element to be drawn.");
  }

  return box;
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

async function styleOf(
  locator: Locator,
  property: "backgroundColor" | "color",
): Promise<string> {
  return locator.evaluate(
    (element: Element, name: "backgroundColor" | "color"): string => {
      return getComputedStyle(element)[name];
    },
    property,
  );
}

test.describe("Workflow builder: Run Workflow for a record trigger", () => {
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

  test("it asks which incident, not for an ID, and lists the newest ones as soon as the box is opened", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await expect(
      panel.getByText(
        "Start a run now, from the trigger, with the values you choose.",
      ),
    ).toBeVisible();
    await expect(
      panel.getByText(
        "The run starts as if this incident had just been updated.",
      ),
    ).toBeVisible();
    // The old box, its name and its wording are gone.
    await expect(panel.getByText("Incident ID")).toHaveCount(0);
    await expect(panel.getByPlaceholder("ID of the Incident")).toHaveCount(0);

    const box: Locator = panel.getByRole("combobox", { name: "Incident" });

    await expect(box).toHaveAttribute(
      "placeholder",
      "Search by number or name",
    );

    if (isMobile) {
      /*
       * A phone: the box is left alone until it is tapped, or its keyboard
       * would be over the list it opens. Nothing is asked for until then.
       */
      await expect(box).toHaveAttribute("aria-expanded", "false");
      await expect(box).not.toBeFocused();
      await expect(options(panel)).toHaveCount(0);

      await box.click();
    } else {
      /*
       * A laptop: the box has the focus as the panel opens, so the newest
       * incidents are listed at once and a number can be typed straight
       * away, without a click on the box first.
       */
      await expect(box).toBeFocused();
    }

    await expect(box).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByText("Most recent")).toBeVisible();
    await expect(
      panel.getByRole("listbox", { name: "Search results" }),
    ).toBeVisible();
    expect(await listed(panel)).toEqual([
      "12 Recent",
      "11 Recent",
      "10 Recent",
      "09 Recent",
      "08 Recent",
      "07 Recent",
    ]);

    // A row: the number as the product shows it, the title, and when.
    const first: Locator = options(panel).first();

    await expect(first).toContainText("INC-12");
    await expect(first).toContainText(
      "Checkout returns 502 for customers in the EU",
    );
    await expect(first).toHaveAttribute("aria-selected", "true");

    const created: Locator = options(panel)
      .nth(2)
      .getByText(/^Created /);

    if (isMobile) {
      // On a phone the date gives its room to the title.
      await expect(created).toBeHidden();
    } else {
      // In the reader's zone and hour cycle, with the year when it is past.
      await expect(created).toHaveText("Created Mar 9, 2024, 14:05");
      await expect(
        options(panel)
          .first()
          .getByText(/^Created /),
      ).toHaveText(/^Created Today, \d{2}:\d{2}$/);
    }
  });

  for (const typed of ["8", "#8", "INC-8", "inc-8", " INC - 8 "]) {
    test(`"${typed}" finds INC-8: a number with its prefix or without, in any case`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const panel: Locator = await openRunPanel(page);

      await search(page, panel, typed);

      expect(await listed(panel)).toEqual(["08 Number"]);
      await expect(options(panel).first()).toContainText(
        "Status page shows the wrong region",
      );
      // A search's results carry no "Most recent" over them.
      await expect(panel.getByText("Most recent")).toHaveCount(0);
    });
  }

  test("a number under another prefix is not this incident, and one numbered under an old prefix answers to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    // ALT-8 is an alert's number: it is not INC-8.
    await search(page, panel, "ALT-8");
    await expect(options(panel)).toHaveCount(0);
    await expect(panel.getByTestId(`${FIELD}-empty`)).toHaveText(
      "Nothing matches “ALT-8”.",
    );

    // Numbered before the project's prefix changed: OPS-7, as its page says.
    await search(page, panel, "ops-7");
    expect(await listed(panel)).toEqual(["07 Number"]);

    await search(page, panel, "INC-7");
    await expect(options(panel)).toHaveCount(0);

    // The bare number names it whatever its prefix.
    await search(page, panel, "7");
    expect(await listed(panel)).toEqual(["07 Number"]);
  });

  test("part of a title finds the incidents that have it, and an ID pasted in finds its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await search(page, panel, "database");
    expect(await listed(panel)).toEqual(["11 Name", "09 Name"]);

    // A title half remembered: its words, in whatever order they come back.
    await search(page, panel, "down database");
    expect(await listed(panel)).toEqual(["11 Name"]);
    await search(page, panel, "region status wrong");
    expect(await listed(panel)).toEqual(["08 Name"]);
    await search(page, panel, "database checkout");
    await expect(panel.getByTestId(`${FIELD}-empty`)).toHaveText(
      "Nothing matches “database checkout”.",
    );

    // Digits that are no incident's number, and are in one's title.
    await search(page, panel, "502");
    expect(await listed(panel)).toEqual(["12 Name"]);

    await search(page, panel, INC_8.toUpperCase());
    expect(await listed(panel)).toEqual(["08 Id"]);
  });

  test("the search waits for a pause in the typing: a word typed is one request, not one a letter", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await searchBox(panel).click();
    await expect(options(panel)).toHaveCount(6);

    await page.keyboard.type("status", { delay: 40 });

    await expect(options(panel)).toHaveCount(1);
    expect(await listed(panel)).toEqual(["08 Name"]);

    expect(
      await page.evaluate((): Array<string> => {
        return (window as unknown as { __recordSearches: Array<string> })
          .__recordSearches;
      }),
    ).toEqual(["", "status"]);
  });

  test("a pick shows the incident in place of the box; the confirmation names it; the run starts with its ID", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await search(page, panel, "8");
    await options(panel).first().click();

    const picked: Locator = panel.getByTestId(`${FIELD}-picked`);

    await expect(picked).toContainText("INC-8");
    await expect(picked).toContainText("Status page shows the wrong region");
    await expect(searchBox(panel)).toHaveCount(0);
    await expect(options(panel)).toHaveCount(0);
    // The box the focus was in is gone: it is on Change, not on nothing.
    await expect(picked.getByRole("button", { name: "Change" })).toBeFocused();

    await runButton(panel).click();

    const confirm: Locator = confirmation(page);

    await expect(confirm).toContainText(
      `It runs as if INC-8 · Status page shows the wrong region had just been updated. ${RUNS_FOR_REAL}`,
    );
    // Nothing has run yet.
    expect(await startedRuns(page)).toEqual([]);

    await confirm.getByRole("button", { name: "Run", exact: true }).click();

    // The trigger gets the incident's ID, as it always did.
    expect(await startedRuns(page)).toEqual([
      {
        metadataId: "incident-on-update",
        arguments: {
          "listen-on": {},
          select: { title: true },
          _id: INC_8,
        },
      },
    ]);
    await expect(page.getByTestId(FIELD)).toHaveCount(0);
  });

  test("Cancel on the confirmation runs nothing and leaves the pick where it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await searchBox(panel).click();
    await options(panel).nth(1).click();
    await runButton(panel).click();

    await confirmation(page).getByRole("button", { name: "Cancel" }).click();

    await expect(confirmation(page)).toHaveCount(0);
    expect(await startedRuns(page)).toEqual([]);
    await expect(panel.getByTestId(`${FIELD}-picked`)).toContainText(
      "Database is down",
    );
  });

  test("by keyboard alone: the arrows walk the list, Enter picks, and Change brings the search back", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone has no arrow keys.");

    const panel: Locator = await openRunPanel(page);
    const box: Locator = searchBox(panel);

    await box.focus();
    await expect(options(panel)).toHaveCount(6);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(options(panel).nth(2)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(box).toHaveAttribute(
      "aria-activedescendant",
      (await options(panel).nth(2).getAttribute("id")) as string,
    );

    // Up from the first row wraps to the last.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(options(panel).nth(5)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Enter picks, and is not the panel's own button.
    await page.keyboard.press("Enter");

    const picked: Locator = panel.getByTestId(`${FIELD}-picked`);

    await expect(picked).toContainText("OPS-7");
    await expect(confirmation(page)).toHaveCount(0);
    await expect(picked.getByRole("button", { name: "Change" })).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(searchBox(panel)).toBeFocused();
    await expect(searchBox(panel)).toHaveValue("");
    await expect(options(panel)).toHaveCount(6);

    // Enter with nothing listed to pick is no one's button: nothing runs.
    await search(page, panel, "zzzz");
    await expect(panel.getByTestId(`${FIELD}-empty`)).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(confirmation(page)).toHaveCount(0);
    await expect(anyDialog(page)).toHaveCount(0);
    await expect(searchBox(panel)).toHaveValue("zzzz");
    await expect(searchBox(panel)).toBeFocused();
    expect(await startedRuns(page)).toEqual([]);
  });

  test("Escape closes the list and leaves the panel open", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone has no Escape key.");

    const panel: Locator = await openRunPanel(page);

    await searchBox(panel).click();
    await expect(options(panel)).toHaveCount(6);

    await page.keyboard.press("Escape");

    await expect(panel.getByTestId(`${FIELD}-list`)).toHaveCount(0);
    await expect(panel.getByTestId(FIELD)).toBeVisible();
    await expect(searchBox(panel)).toBeFocused();

    // Down opens it again.
    await page.keyboard.press("ArrowDown");
    await expect(options(panel)).toHaveCount(6);
  });

  test("INC-11 typed out, then straight to the button: the field shows the incident and the confirmation names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await search(page, panel, "inc-11");
    expect(await listed(panel)).toEqual(["11 Number"]);

    // No pick: the press takes the focus out of the box, and that is enough.
    await runButton(panel).click();

    await expect(confirmation(page)).toContainText(
      `It runs as if INC-11 · Database is down had just been updated. ${RUNS_FOR_REAL}`,
    );
    await expect(panel.getByTestId(`${FIELD}-picked`)).toContainText(
      "Database is down",
    );

    await confirmation(page)
      .getByRole("button", { name: "Run", exact: true })
      .click();

    expect((await startedRuns(page))[0]?.arguments["_id"]).toBe(INC_11);
  });

  test("a bare number typed and the box left with Tab becomes the incident it names", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone has no Tab key.");

    const panel: Locator = await openRunPanel(page);

    await search(page, panel, "7");

    // Past the box's own clear button, and out of the field.
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Clear" })).toBeFocused();
    await expect(searchBox(panel)).toHaveValue("7");

    await page.keyboard.press("Tab");

    const picked: Locator = panel.getByTestId(`${FIELD}-picked`);

    await expect(picked).toContainText("OPS-7");
    await expect(picked).toContainText("Email worker has a backlog");
    // The focus went where Tab was taking it, not back to Change.
    await expect(
      picked.getByRole("button", { name: "Change" }),
    ).not.toBeFocused();

    await runButton(panel).click();
    await confirmation(page)
      .getByRole("button", { name: "Run", exact: true })
      .click();

    expect((await startedRuns(page))[0]?.arguments["_id"]).toBe(OPS_7);
  });

  test("typed and run before the list has answered: what was typed is sent, and the confirmation says as much", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page, "&records=slow");

    await searchBox(panel).fill(" INC-8 ");
    await expect(panel.getByTestId(`${FIELD}-searching`)).toHaveText(
      "Searching…",
    );

    await runButton(panel).click();

    // The server looks INC-8 up when the run starts, the same way.
    await expect(confirmation(page)).toContainText(
      `It runs as if INC-8 had just been updated. ${RUNS_FOR_REAL}`,
    );

    await confirmation(page)
      .getByRole("button", { name: "Run", exact: true })
      .click();

    expect((await startedRuns(page))[0]?.arguments["_id"]).toBe("INC-8");
  });

  test("part of a title alone is not enough to run with: the field says to pick one, and nothing runs", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    /*
     * One incident has it in its title, and that is still not a pick: a
     * word is not a number, and every step of the run is for real.
     */
    await search(page, panel, "replica");
    expect(await listed(panel)).toEqual(["09 Name"]);
    await runButton(panel).click();

    /*
     * Said at the field, in the field's words. No dialog: it used to say
     * "Please fix errors" and had to be closed before the field could be
     * read.
     */
    await expect(panel.getByTestId(`${FIELD}-error`)).toHaveText(PICK_ONE);
    await expect(anyDialog(page)).toHaveCount(0);
    await expect(panel.getByTestId(`${FIELD}-picked`)).toHaveCount(0);
    await expect(searchBox(panel)).toHaveValue("replica");
    await expect(searchBox(panel)).toHaveAttribute("aria-invalid", "true");
    expect(await startedRuns(page)).toEqual([]);

    // The typing is back in the box, and the incident it found is listed.
    await expect(searchBox(panel)).toBeFocused();
    await expect(options(panel)).toHaveCount(1);

    // Picking it is all it takes.
    await options(panel).first().click();
    await expect(panel.getByTestId(`${FIELD}-error`)).toHaveCount(0);

    await runButton(panel).click();
    await expect(confirmation(page)).toContainText("INC-9 · Database replica");
  });

  /*
   * A dialog used to say "Please fix errors - There are some validation
   * errors on the form", over a form that showed none: a field says what it
   * needs once it has been left, and nobody had been in it. Closing the
   * dialog left the panel exactly as it was.
   */
  test("nothing chosen at all: the field asks for the incident, where it is missing, and lists them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);
    const error: Locator = panel.getByTestId(`${FIELD}-error`);

    // Opening the panel says nothing is wrong with it.
    await expect(error).toHaveCount(0);

    await runButton(panel).click();

    await expect(error).toHaveText(PICK_ONE);
    await expect(error).toBeVisible();
    await expect(anyDialog(page)).toHaveCount(0);
    await expect(confirmation(page)).toHaveCount(0);
    expect(await startedRuns(page)).toEqual([]);

    // The box is where the typing goes, marked as what needs an answer...
    await expect(searchBox(panel)).toBeFocused();
    await expect(searchBox(panel)).toHaveAttribute("aria-invalid", "true");
    // ...and the incidents to pick from are listed, the message under them.
    await expect(options(panel)).toHaveCount(6);
    expect((await boxOf(error)).y).toBeGreaterThanOrEqual(
      (await boxOf(searchBox(panel))).y +
        (await boxOf(searchBox(panel))).height,
    );

    // One pick, and the panel goes on to ask whether to run.
    await options(panel).nth(1).click();
    await expect(error).toHaveCount(0);
    await runButton(panel).click();
    await expect(confirmation(page)).toContainText("INC-11 · Database is down");
  });

  test("the panel put the focus in the box: leaving it empty says nothing yet", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(
      isMobile,
      "On a phone the box is not focused until it is tapped.",
    );

    const panel: Locator = await openRunPanel(page);

    await expect(searchBox(panel)).toBeFocused();
    await expect(options(panel)).toHaveCount(6);

    // A click on the panel's own words, as after a look around.
    await panel.getByText("Run On Update Incident").click();

    await expect(searchBox(panel)).not.toBeFocused();
    await expect(panel.getByTestId(`${FIELD}-list`)).toHaveCount(0);
    // Nobody asked for the field: it has nothing to complain of yet.
    await expect(panel.getByTestId(`${FIELD}-error`)).toHaveCount(0);
    await expect(searchBox(panel)).toHaveAttribute("aria-invalid", "false");

    // Words typed and left are another matter: they name no incident.
    await searchBox(panel).fill("replica");
    await panel.getByText("Run On Update Incident").click();
    await expect(panel.getByTestId(`${FIELD}-error`)).toHaveText(PICK_ONE);
  });

  /*
   * The list waits for a pause in the typing before it asks. Run pressed
   * before the pause was over closed a list that had never asked - and it
   * went on saying "Searching…" when the box was opened on the same words.
   */
  test("typed and Run pressed before the pause is over: the list still comes when the box is back", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await searchBox(panel).click();
    await expect(options(panel)).toHaveCount(6);

    // No wait for the answer: the press comes while the typing has just stopped.
    await searchBox(panel).fill("replica");
    await runButton(panel).click();

    await expect(panel.getByTestId(`${FIELD}-error`)).toHaveText(PICK_ONE);
    await expect(searchBox(panel)).toBeFocused();

    // Asked for now, and answered: not "Searching…" for good.
    await expect(options(panel)).toHaveCount(1);
    expect(await listed(panel)).toEqual(["09 Name"]);
    await expect(panel.getByTestId(`${FIELD}-searching`)).toHaveCount(0);
  });

  /*
   * "INC-8" and "INC-12" are a character apart, and each sat in a chip as
   * wide as itself: the titles after them started at different places down
   * the list. The numbers are a column now, as wide as the longest listed.
   */
  test("the numbers are a column: every title starts on one line down the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await searchBox(panel).click();
    await expect(options(panel)).toHaveCount(6);

    const titleStarts: Array<number> = [];
    const chipStarts: Array<number> = [];
    const chipWidths: Array<number> = [];

    for (let index: number = 0; index < 6; index++) {
      const row: Locator = options(panel).nth(index);

      titleStarts.push((await boxOf(row.locator('[data-part="name"]'))).x);

      const chip: Box = await boxOf(row.locator('[data-part="number"] > span'));

      chipStarts.push(chip.x);
      chipWidths.push(chip.width);
    }

    // INC-12, INC-11, INC-10, INC-9, INC-8 and OPS-7: two lengths of number.
    expect(Math.max(...chipWidths) - Math.min(...chipWidths)).toBeGreaterThan(
      4,
    );
    // Each chip is as wide as its own number, and they all start together.
    expect(Math.max(...chipStarts) - Math.min(...chipStarts)).toBeLessThan(0.5);
    // And so do the titles, whatever the number before them.
    expect(Math.max(...titleStarts) - Math.min(...titleStarts)).toBeLessThan(
      0.5,
    );

    // The longest number still has the row's gap between it and its title.
    const longest: number = chipWidths.indexOf(Math.max(...chipWidths));

    expect(
      (titleStarts[longest] as number) -
        ((chipStarts[longest] as number) + (chipWidths[longest] as number)),
    ).toBeGreaterThanOrEqual(8);

    // A search that finds one shorter number has no wider a column than it needs.
    await search(page, panel, "8");

    const only: Locator = options(panel).first();
    const onlyChip: Box = await boxOf(
      only.locator('[data-part="number"] > span'),
    );
    const onlyTitle: Box = await boxOf(only.locator('[data-part="name"]'));

    expect(onlyTitle.x - (onlyChip.x + onlyChip.width)).toBeLessThan(16);
    expect(onlyTitle.x).toBeLessThan(titleStarts[0] as number);
  });

  /*
   * A record's name is a sentence of its own. In the weight of the words
   * around it, "It runs as if INC-11 · Database is down had just been
   * updated." read as though the database had been updated.
   */
  test("the confirmation sets the incident apart, in bold, from the sentence that names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await search(page, panel, "11");
    await options(panel).first().click();
    await runButton(panel).click();

    const confirm: Locator = confirmation(page);
    const record: Locator = confirm.getByTestId("run-confirm-record");
    const sentence: Locator = confirm.getByTestId("confirm-modal-description");

    await expect(record).toHaveText("INC-11 · Database is down");
    // The whole sentence still reads as one.
    await expect(sentence).toHaveText(
      `It runs as if INC-11 · Database is down had just been updated. ${RUNS_FOR_REAL}`,
    );

    type WeightFunction = (locator: Locator) => Promise<number>;

    const weightOf: WeightFunction = async (
      locator: Locator,
    ): Promise<number> => {
      return Number(
        await locator.evaluate((element: Element): string => {
          return getComputedStyle(element).fontWeight;
        }),
      );
    };

    expect(await weightOf(record)).toBeGreaterThanOrEqual(600);
    expect(await weightOf(sentence)).toBeLessThanOrEqual(400);
    // And darker than the words around it, in either theme's terms.
    expect(luminanceOf(await styleOf(record, "color"))).toBeLessThan(
      luminanceOf(await styleOf(sentence, "color")),
    );
  });

  test("in the dark theme the incident in the confirmation is the brighter of the two", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page, "&theme=dark");

    await search(page, panel, "11");
    await options(panel).first().click();
    await runButton(panel).click();

    const confirm: Locator = confirmation(page);
    const record: Locator = confirm.getByTestId("run-confirm-record");
    const sentence: Locator = confirm.getByTestId("confirm-modal-description");

    await expect(record).toBeVisible();
    // Light words on the dark dialog, the record lighter than the sentence.
    expect(luminanceOf(await styleOf(record, "color"))).toBeGreaterThan(0.5);
    expect(luminanceOf(await styleOf(record, "color"))).toBeGreaterThan(
      luminanceOf(await styleOf(sentence, "color")),
    );
  });

  test("Change goes back to the search, with the newest listed again; the clear button empties the box", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await search(page, panel, "login");
    await options(panel).first().click();

    const change: Locator = panel.getByRole("button", { name: "Change" });

    // 24px to aim at, like the clear button below.
    expect((await boxOf(change)).height).toBeGreaterThanOrEqual(24);
    await change.click();

    await expect(searchBox(panel)).toBeFocused();
    await expect(searchBox(panel)).toHaveValue("");
    await expect(panel.getByText("Most recent")).toBeVisible();
    await expect(options(panel)).toHaveCount(6);

    await search(page, panel, "replica");
    await expect(options(panel)).toHaveCount(1);

    const clear: Locator = panel.getByRole("button", { name: "Clear" });
    const clearBox: Box = await boxOf(clear);
    const searchBoxBox: Box = await boxOf(searchBox(panel));

    expect(clearBox.width).toBeGreaterThanOrEqual(24);
    expect(clearBox.height).toBeGreaterThanOrEqual(24);
    // Inside the box, at its right end.
    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(
      searchBoxBox.x + searchBoxBox.width,
    );
    expect(clearBox.y).toBeGreaterThanOrEqual(searchBoxBox.y);
    expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(
      searchBoxBox.y + searchBoxBox.height,
    );

    await clear.click();

    await expect(searchBox(panel)).toHaveValue("");
    await expect(searchBox(panel)).toBeFocused();
    await expect(options(panel)).toHaveCount(6);
  });

  test("a project with no incidents, and a search the server refuses, each say so in words", async ({
    page,
  }: {
    page: Page;
  }) => {
    const none: Locator = await openRunPanel(page, "&records=none");

    await searchBox(none).click();
    await expect(none.getByTestId(`${FIELD}-empty`)).toHaveText(
      "There are no incidents in this project yet.",
    );

    const failed: Locator = await openRunPanel(page, "&records=fail");

    await searchBox(failed).click();
    await expect(failed.getByRole("alert")).toHaveText(
      "The incidents could not be listed.",
    );
    await expect(options(failed)).toHaveCount(0);
  });

  test("a long title is cut short on its row, and nothing runs off the side of the panel", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page);

    await searchBox(panel).click();
    await expect(options(panel)).toHaveCount(6);

    const long: Locator = options(panel).nth(3);
    const plain: Locator = options(panel).nth(1);

    await expect(long).toContainText("Database replica is lagging");
    // One line, like every other row, with the whole title a hover away.
    expect(
      Math.abs((await boxOf(long)).height - (await boxOf(plain)).height),
    ).toBeLessThan(1.5);
    await expect(long.locator("[title]").first()).toHaveAttribute(
      "title",
      "Database replica is lagging behind the primary by several minutes and reports are stale",
    );

    const list: Box = await boxOf(panel.getByTestId(`${FIELD}-list`));
    const field: Box = await boxOf(panel.getByTestId(FIELD));

    for (let index: number = 0; index < 6; index++) {
      const row: Box = await boxOf(options(panel).nth(index));

      expect(row.x).toBeGreaterThanOrEqual(list.x);
      expect(row.x + row.width).toBeLessThanOrEqual(list.x + list.width + 0.5);
    }

    expect(list.x).toBeGreaterThanOrEqual(field.x - 0.5);
    expect(list.x + list.width).toBeLessThanOrEqual(
      field.x + field.width + 0.5,
    );
    expect(
      await page.evaluate((): boolean => {
        return (
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
        );
      }),
    ).toBe(true);

    // Picked, the long title is cut short beside Change, which stays whole.
    await long.click();

    const picked: Box = await boxOf(panel.getByTestId(`${FIELD}-picked`));
    const change: Box = await boxOf(
      panel.getByRole("button", { name: "Change" }),
    );

    expect(change.x + change.width).toBeLessThanOrEqual(
      picked.x + picked.width,
    );
    expect(picked.height).toBeLessThan(50);
  });

  test("on a phone a row is tall enough for a finger, and keeps its number and title", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(!isMobile, "The phone's own layout.");

    const panel: Locator = await openRunPanel(page);

    await searchBox(panel).click();
    await expect(options(panel)).toHaveCount(6);

    for (let index: number = 0; index < 6; index++) {
      const row: Box = await boxOf(options(panel).nth(index));

      expect(row.height).toBeGreaterThanOrEqual(36);
    }

    await expect(options(panel).nth(1)).toContainText("INC-11");
    await expect(
      options(panel).nth(1).getByText("Database is down"),
    ).toBeVisible();

    await options(panel).nth(1).click();
    await expect(panel.getByTestId(`${FIELD}-picked`)).toContainText("INC-11");

    // The panel's buttons are still on the screen, under the pick.
    await expect(runButton(panel)).toBeInViewport();
  });

  test("turned off, the panel says the run is a test run before it asks which incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page, "&off=1");
    const note: Locator = panel.getByText(
      `This workflow is off, so this is a test run. ${RUNS_FOR_REAL}`,
    );

    await expect(note).toBeVisible();
    expect((await boxOf(note)).y).toBeLessThan(
      (await boxOf(panel.getByTestId(FIELD))).y,
    );

    // On, there is no such note.
    const on: Locator = await openRunPanel(page);

    await expect(on.getByText("so this is a test run")).toHaveCount(0);
  });

  test("when a record was created can be read on every row: on the list's white, and a shade darker on the row the keys are on", async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    test.skip(isMobile, "A phone's rows keep to the number and the title.");

    const panel: Locator = await openRunPanel(page);

    await searchBox(panel).click();
    await expect(options(panel)).toHaveCount(6);

    // How a colour reads on a ground, as WCAG counts it; 4.5 is AA.
    type ReadsFunction = (row: Locator) => Promise<number>;

    const reads: ReadsFunction = async (row: Locator): Promise<number> => {
      const words: number = luminanceOf(
        await styleOf(row.locator('[data-part="created"]'), "color"),
      );
      let behind: string = await styleOf(row, "backgroundColor");

      // A row without a tint of its own shows the list's white.
      if (luminanceOf(behind) === 0) {
        behind = await styleOf(
          panel.getByTestId(`${FIELD}-list`),
          "backgroundColor",
        );
      }

      const ground: number = luminanceOf(behind);

      return (
        (Math.max(words, ground) + 0.05) / (Math.min(words, ground) + 0.05)
      );
    };

    // The keys start on the first row, which is tinted.
    await expect(options(panel).first()).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const active: string = await styleOf(
      options(panel).first().locator('[data-part="created"]'),
      "color",
    );
    const resting: string = await styleOf(
      options(panel).nth(1).locator('[data-part="created"]'),
      "color",
    );

    expect(active).not.toBe(resting);
    expect(luminanceOf(active)).toBeLessThan(luminanceOf(resting));

    for (let index: number = 0; index < 6; index++) {
      await expect(
        options(panel).nth(index).locator('[data-part="created"]'),
      ).toContainText("Created");
      expect(await reads(options(panel).nth(index))).toBeGreaterThanOrEqual(
        4.5,
      );
    }

    // The keys move down: the second row takes the darker shade, the first gives it up.
    await page.keyboard.press("ArrowDown");
    await expect(options(panel).nth(1)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect
      .poll(async (): Promise<string> => {
        return styleOf(
          options(panel).nth(1).locator('[data-part="created"]'),
          "color",
        );
      })
      .toBe(active);
    expect(
      await styleOf(
        options(panel).first().locator('[data-part="created"]'),
        "color",
      ),
    ).toBe(resting);

    for (let index: number = 0; index < 6; index++) {
      expect(await reads(options(panel).nth(index))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  test("in the dark theme the box, the list, its rows and the pick are dark like the panel", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openRunPanel(page, "&theme=dark");

    await searchBox(panel).click();
    await expect(options(panel)).toHaveCount(6);

    const number: Locator = options(panel)
      .nth(1)
      .locator('[data-part="number"] > span');

    for (const surface of [
      searchBox(panel),
      panel.getByTestId(`${FIELD}-list`),
      // The row the keyboard is on, and one it is not.
      options(panel).first(),
      number,
    ]) {
      await expect(surface).toBeVisible();
      expect(
        luminanceOf(await styleOf(surface, "backgroundColor")),
      ).toBeLessThan(0.12);
    }

    for (const words of [
      number,
      options(panel).nth(1).locator('[data-part="name"]'),
      panel.getByText("Most recent"),
    ]) {
      expect(luminanceOf(await styleOf(words, "color"))).toBeGreaterThan(0.25);
    }

    await options(panel).nth(1).click();

    const picked: Locator = panel.getByTestId(`${FIELD}-picked`);

    expect(luminanceOf(await styleOf(picked, "backgroundColor"))).toBeLessThan(
      0.12,
    );
    expect(
      luminanceOf(await styleOf(picked.getByText("Database is down"), "color")),
    ).toBeGreaterThan(0.5);
  });
});
