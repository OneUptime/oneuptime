import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The step type choices on a runbook's Steps page (Runbooks > a runbook >
 * Steps): the grid a new runbook's first step is picked from, and the Add
 * Step dialog a runbook with steps adds one from.
 *
 * Seven step types sat five to a row - five, then an orphaned two - and a
 * card beside a taller one had its icon lower than its neighbours', because
 * a button centres what it holds. The first step's grid is four to a row
 * now (four, then three), and every choice is a column from the top.
 *
 * The seven cards also sat under every runbook that had steps, as "Add
 * another step", as tall as the runbook on a phone (#9138). That grid is a
 * dialog now, opened by one Add Step button at the end of the list.
 *
 * What a renderer in jsdom cannot see is the layout, so the classes are
 * read from the page's source.
 */

const STEPS_PAGE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "Runbook",
    "View",
    "Steps.tsx",
  ),
  "utf8",
);

// Each place the page draws a card per step type, from ALL_STEP_TYPES.map.
function stepTypeGrids(): Array<string> {
  const grids: Array<string> = [];
  let from: number = 0;

  for (;;) {
    const at: number = STEPS_PAGE.indexOf("{ALL_STEP_TYPES.map(", from);

    if (at === -1) {
      return grids;
    }

    // The grid that holds the cards: the last className before the map.
    const gridStart: number = STEPS_PAGE.lastIndexOf('className="grid', at);
    const cardEnd: number = STEPS_PAGE.indexOf("</button>", at);

    grids.push(STEPS_PAGE.slice(gridStart, cardEnd));
    from = at + 1;
  }
}

function stepTypeCount(): number {
  const start: number = STEPS_PAGE.indexOf(
    "const ALL_STEP_TYPES: RunbookStepType[] = [",
  );
  const end: number = STEPS_PAGE.indexOf("];", start);

  return STEPS_PAGE.slice(start, end).split("RunbookStepType.").length - 1;
}

// The one choice both places draw: renderStepTypeChoice's button.
function stepTypeChoice(): string {
  const start: number = STEPS_PAGE.indexOf("const renderStepTypeChoice");
  const end: number = STEPS_PAGE.indexOf("</button>", start);

  return STEPS_PAGE.slice(start, end);
}

describe("the step type choices", () => {
  test("are drawn in two places: the first step, and the Add Step dialog", () => {
    const grids: Array<string> = stepTypeGrids();

    expect(grids).toHaveLength(2);
    expect(grids[1]).toContain('data-testid="runbook-step-type-picker"');
    for (const grid of grids) {
      expect(grid).toContain("renderStepTypeChoice(t,");
    }
    expect(STEPS_PAGE).not.toContain("Add another step");
  });

  test("seven step types: two even rows at four to a row for the first step, two to a row in the dialog", () => {
    expect(stepTypeCount()).toBe(7);

    const [firstStep, dialog] = stepTypeGrids() as [string, string];

    expect(firstStep).toContain("lg:grid-cols-4");
    expect(firstStep).not.toContain("lg:grid-cols-5");
    // One to a row on a phone, two on a tablet, as before.
    for (const grid of [firstStep, dialog]) {
      expect(grid).toContain("grid-cols-1 sm:grid-cols-2");
    }
  });

  test("every choice is a column from the top, so the icons in a row line up", () => {
    const choice: string = stepTypeChoice();
    const button: string = choice.slice(choice.indexOf("<button"));

    expect(button).toContain('type="button"');
    expect(button).toContain("flex flex-col items-start justify-start");
  });

  test("a choice's line is in the reader's language", () => {
    expect(stepTypeChoice()).toContain(
      "translator.translateText(meta.description)",
    );
  });
});
