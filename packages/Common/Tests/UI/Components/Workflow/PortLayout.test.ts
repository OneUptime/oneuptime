/*
 * Where a step card draws its outputs (Workflow/PortLayout): the names in
 * equal columns along the bottom, each dot in the middle of its column, so a
 * name is always right above its dot. A card is 16rem wide, and wider only
 * when its outputs' names need it - a Switch / Case named after its cases.
 *
 * The card used to place its dots at hand-picked pixels for one, two or three
 * outputs, and its names at the card's two edges (space-between), so on a
 * card with Yes and No neither name sat over its dot, and a fourth output had
 * nowhere to go.
 */

import {
  MAX_OUTPUT_COLUMN_WIDTH,
  MIN_OUTPUT_COLUMN_WIDTH,
  OutputLayout,
  getOutputLayout,
} from "../../../../UI/Components/Workflow/PortLayout";
import { WORKFLOW_NODE_WIDTH } from "../../../../UI/Components/Workflow/NodePlacement";
import { describe, expect, test } from "@jest/globals";

describe("where a card's output dots go", () => {
  test("one output: in the middle", () => {
    expect(getOutputLayout(["Out"]).dotLeftPercents).toEqual([50]);
  });

  test("each in the middle of its own column, for any number of outputs", () => {
    for (let count: number = 1; count <= 26; count++) {
      const titles: Array<string> = Array.from(
        { length: count },
        (_value: unknown, index: number): string => {
          return `Case ${index + 1}`;
        },
      );

      const layout: OutputLayout = getOutputLayout(titles);

      expect(layout.dotLeftPercents).toHaveLength(count);

      layout.dotLeftPercents.forEach((left: number, index: number) => {
        expect(left).toBeCloseTo(((index + 0.5) / count) * 100, 10);
      });

      // Evenly spaced, inside the card.
      for (let index: number = 1; index < count; index++) {
        expect(
          (layout.dotLeftPercents[index] as number) -
            (layout.dotLeftPercents[index - 1] as number),
        ).toBeCloseTo(100 / count, 10);
      }

      expect(layout.dotLeftPercents[0]).toBeGreaterThan(0);
      expect(layout.dotLeftPercents[count - 1]).toBeLessThan(100);
    }
  });

  test("Yes and No, Success and Error: a quarter and three quarters across", () => {
    expect(getOutputLayout(["Yes", "No"]).dotLeftPercents).toEqual([25, 75]);
    expect(getOutputLayout(["Success", "Error"]).dotLeftPercents).toEqual([
      25, 75,
    ]);
  });

  test("no outputs: nothing to place", () => {
    expect(getOutputLayout([])).toEqual({
      widerCardWidth: null,
      dotLeftPercents: [],
    });
  });
});

describe("how wide a card is", () => {
  test("the usual 16rem for every step whose outputs fit, which is every step but a long Switch / Case", () => {
    for (const titles of [
      ["Out"],
      ["Yes", "No"],
      ["Success", "Error"],
      ["Execute"],
      ["Case 1", "Case 2", "Default"],
      ["production", "staging", "Default"],
    ]) {
      expect({ titles, width: getOutputLayout(titles).widerCardWidth }).toEqual(
        { titles, width: null },
      );
    }
  });

  test("wider when its names need it, so each stays readable", () => {
    const layout: OutputLayout = getOutputLayout([
      "Critical Incident",
      "Major Incident",
      "Default",
    ]);

    expect(layout.widerCardWidth).not.toBeNull();
    expect(layout.widerCardWidth as number).toBeGreaterThan(
      WORKFLOW_NODE_WIDTH,
    );
    // Room for the longest name in every column.
    expect((layout.widerCardWidth as number) / 3).toBeGreaterThanOrEqual(
      "Critical Incident".length * 6,
    );
  });

  test("wider with every output a Switch / Case gains", () => {
    const widthFor: (count: number) => number = (count: number): number => {
      return (
        getOutputLayout(
          Array.from({ length: count }, (): string => {
            return "Major Incident";
          }),
        ).widerCardWidth || WORKFLOW_NODE_WIDTH
      );
    };

    for (let count: number = 3; count < 12; count++) {
      expect(widthFor(count + 1)).toBeGreaterThan(widthFor(count));
    }
  });

  test("a column never narrower than a short name needs, nor wider than a long name gets", () => {
    const short: OutputLayout = getOutputLayout(
      Array.from({ length: 6 }, (): string => {
        return "a";
      }),
    );

    expect(short.widerCardWidth).toBe(6 * MIN_OUTPUT_COLUMN_WIDTH);

    const long: OutputLayout = getOutputLayout(["x".repeat(500), "Default"]);

    expect(long.widerCardWidth).toBe(2 * MAX_OUTPUT_COLUMN_WIDTH);
  });

  test("counts characters, not the code units an emoji takes", () => {
    expect(getOutputLayout(["🚨".repeat(10), "Default"])).toEqual(
      getOutputLayout(["x".repeat(10), "Default"]),
    );
  });
});
