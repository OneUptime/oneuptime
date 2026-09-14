import { describe, expect, test } from "@jest/globals";
import {
  StyleRule,
  declaredValue,
  rulesFor,
  selectorsDeclaring,
} from "./ThemeStylesheet";

/*
 * https://github.com/OneUptime/oneuptime/issues/3528: a black box around the
 * graphs.
 *
 * recharts leaves its accessibility layer on, so the root <svg> of every
 * chart carries tabindex="0", and the annotation layer gives the same to the
 * <g> elements it draws for event chips and highlighted windows. Chrome's SVG
 * user-agent stylesheet rings a focused <svg> on plain :focus rather than on
 * :focus-visible the way it treats focusable HTML, so a mouse press inside a
 * chart -- dragging out a zoom range on the Logs and Traces volume charts,
 * clicking an event marker -- paints a hard black rectangle over the data.
 *
 * The fix is four lines of CSS, which is exactly why it needs cover: nothing
 * else in the build would notice a reformat that dropped the descendant
 * selector, or a reorder that let the user-agent ring back in. The rules
 * carry no !important and no extra specificity, so their contract is a
 * cascade contract, and that is what is asserted here rather than the literal
 * text of the file.
 *
 * ChartFocusRingCoverage.test.tsx holds the other half: that the selectors
 * written here still reach the elements recharts actually renders.
 */

// The chart surface and the focusable shapes drawn inside it.
const POINTER_FOCUS_SELECTORS: Array<string> = [
  ".recharts-surface:focus",
  ".recharts-surface [tabindex]:focus",
];

const KEYBOARD_FOCUS_SELECTORS: Array<string> = [
  ".recharts-surface:focus-visible",
  ".recharts-surface [tabindex]:focus-visible",
];

describe("Chart focus rings", () => {
  test.each(POINTER_FOCUS_SELECTORS)(
    "%s drops the user-agent focus ring",
    (selector: string) => {
      expect(declaredValue(selector, "outline")).toBe("none");
    },
  );

  test.each(KEYBOARD_FOCUS_SELECTORS)(
    "%s draws a ring a keyboard reader can see",
    (selector: string) => {
      const outline: string | undefined = declaredValue(selector, "outline");

      expect(outline).toBeDefined();
      expect(outline).not.toBe("none");
      // Themed, so the ring is legible on the dark canvas as well as the light one.
      expect(outline).toContain("var(--ou-chart-focus-ring)");
    },
  );

  /*
   * A ring flush against the plot edge reads as a border on the chart itself.
   * The offset is what makes it read as focus.
   */
  test.each(KEYBOARD_FOCUS_SELECTORS)(
    "%s holds the ring off the plot",
    (selector: string) => {
      expect(declaredValue(selector, "outline-offset")).toBe("2px");
    },
  );

  /*
   * :focus and :focus-visible weigh the same, so the keyboard ring only
   * survives while it is declared later in the file. Reordering the two blocks
   * would leave keyboard users with no focus indicator at all, and no other
   * assertion here would fail.
   */
  test("the keyboard ring is declared after the ring it restores", () => {
    const sourceOrder: (selectors: Array<string>) => Array<number> = (
      selectors: Array<string>,
    ): Array<number> => {
      return selectors.flatMap((selector: string): Array<number> => {
        return rulesFor(selector).map((rule: StyleRule): number => {
          return rule.index;
        });
      });
    };

    const pointerRuleIndexes: Array<number> = sourceOrder(
      POINTER_FOCUS_SELECTORS,
    );
    const keyboardRuleIndexes: Array<number> = sourceOrder(
      KEYBOARD_FOCUS_SELECTORS,
    );

    // Ordering says nothing if one side of it went missing.
    expect(pointerRuleIndexes.length).toBe(POINTER_FOCUS_SELECTORS.length);
    expect(keyboardRuleIndexes.length).toBe(KEYBOARD_FOCUS_SELECTORS.length);

    expect(Math.min(...keyboardRuleIndexes)).toBeGreaterThan(
      Math.max(...pointerRuleIndexes),
    );
  });

  /*
   * Neither rule is fought over by anything else in the sheet, so neither
   * needs !important to win. If one ever appears here it means something else
   * started competing for the same property, and the pair above stopped being
   * the whole story.
   */
  test.each([...POINTER_FOCUS_SELECTORS, ...KEYBOARD_FOCUS_SELECTORS])(
    "%s wins on the cascade alone",
    (selector: string) => {
      expect(declaredValue(selector, "outline")).not.toContain("!important");
    },
  );

  describe("the accent the ring is drawn in", () => {
    test.each([":root", "html.dark"])("%s defines it", (selector: string) => {
      expect(declaredValue(selector, "--ou-chart-focus-ring")).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
    });

    /*
     * A single value cannot clear both canvases. Light and dark carry their
     * own, the way every other --ou-chart-* token in the sheet does.
     */
    test("light and dark do not share one value", () => {
      expect(declaredValue(":root", "--ou-chart-focus-ring")).not.toBe(
        declaredValue("html.dark", "--ou-chart-focus-ring"),
      );
    });
  });

  /*
   * The fix is deliberately narrow: it silences the ring on charts, and
   * nothing else. A blanket `:focus { outline: none }` would take the focus
   * indicator off the whole dashboard, which is the usual way this class of
   * bug gets "fixed" and is far worse than the black box.
   */
  test("nothing outside the charts had its focus ring silenced", () => {
    const silenced: Array<string> = selectorsDeclaring("outline", "none");

    expect(silenced.length).toBeGreaterThan(0);

    for (const selector of silenced) {
      expect(selector.startsWith(".recharts-surface")).toBe(true);
    }
  });
});
