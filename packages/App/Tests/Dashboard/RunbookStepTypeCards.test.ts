import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The step type cards on a runbook's Steps page (Runbooks > a runbook >
 * Steps): the grid a new runbook's first step is picked from, and the "Add
 * another step" grid under the steps it has.
 *
 * Seven step types sat five to a row - five, then an orphaned two - and a
 * card beside a taller one had its icon lower than its neighbours', because
 * a button centres what it holds. Both grids are four to a row now (four,
 * then three), and every card is a column from the top.
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

describe("the step type cards", () => {
  test("are drawn in two places: the first step, and Add another step", () => {
    expect(stepTypeGrids()).toHaveLength(2);
  });

  test("seven step types make two even rows at four to a row", () => {
    expect(stepTypeCount()).toBe(7);

    for (const grid of stepTypeGrids()) {
      expect(grid).toContain("lg:grid-cols-4");
      expect(grid).not.toContain("lg:grid-cols-5");
      // One to a row on a phone, two on a tablet, as before.
      expect(grid).toContain("grid-cols-1 sm:grid-cols-2");
    }
  });

  test("every card is a column from the top, so the icons in a row line up", () => {
    for (const grid of stepTypeGrids()) {
      const button: string = grid.slice(grid.indexOf("<button"));

      expect(button).toContain("flex flex-col items-start justify-start");
    }
  });

  test("a card's line is in the reader's language", () => {
    for (const grid of stepTypeGrids()) {
      expect(grid).toContain("translator.translateText(meta.description)");
    }
  });
});
