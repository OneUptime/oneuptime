/*
 * WHETHER A LABEL THAT CUTS ITSELF SHORT CAN BE CUT SHORT WHERE IT SITS.
 *
 * A label drawn on one line and cut short when it does not fit (Tailwind's
 * `truncate`) is cut short only when every box between it and the row it
 * sits in may be narrower than that one line. One box that may not keeps
 * the whole line's width, and the label runs past the row's edge instead:
 * a time range button holding "Nov 12, 2025, 9:49 AM – Nov 12, 2026, 9:49
 * AM" ran past a phone's card in the Logs explorer and in a table's header.
 *
 * A box in a flex or grid row is never narrower than its content's one
 * line unless it says so (`min-w-0`); a box that sits in a line of text
 * (inline-flex, inline-block, a button or a span outside a flex row) is
 * never narrower than that line unless it is held to its container's width
 * (`max-w-full`, `w-full`). A block box fills its container by itself.
 *
 * jsdom lays nothing out, so this reads the classes, unprefixed ones only:
 * a box that may shrink from md up alone still runs off a phone.
 */

const FLEX_OR_GRID_ROW: RegExp = /^(inline-)?(flex|grid)$/;
const IN_A_LINE_OF_TEXT: RegExp = /^inline(-flex|-block|-grid)?$/;
const HELD_TO_ITS_CONTAINER: Array<string> = ["max-w-full", "w-full"];

function classTokensOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

function describeBox(element: Element): string {
  const testId: string | null = element.getAttribute("data-testid");
  const name: string = testId
    ? `${element.tagName.toLowerCase()}[data-testid="${testId}"]`
    : element.tagName.toLowerCase();

  return `${name} (class "${element.getAttribute("class") || ""}")`;
}

/*
 * Each box from `label` up to the row (`row` itself left out) that keeps
 * its content's width, and why; none when the label can be cut short.
 */
export function getBoxesThatCannotShrink(data: {
  label: Element;
  row: Element;
}): Array<string> {
  if (!data.row.contains(data.label) || data.row === data.label) {
    throw new Error("The label is not inside the row.");
  }

  const boxes: Array<string> = [];
  let box: Element = data.label;

  while (box !== data.row) {
    const container: Element = box.parentElement as Element;
    const tokens: Array<string> = classTokensOf(box);
    const isInARow: boolean = classTokensOf(container).some(
      (token: string): boolean => {
        return FLEX_OR_GRID_ROW.test(token);
      },
    );

    if (isInARow) {
      if (!tokens.includes("min-w-0")) {
        boxes.push(
          `${describeBox(box)} sits in a flex or grid row without min-w-0`,
        );
      }
    } else {
      const isInALineOfText: boolean =
        tokens.some((token: string): boolean => {
          return IN_A_LINE_OF_TEXT.test(token);
        }) ||
        (["SPAN", "BUTTON"].includes(box.tagName) &&
          !tokens.includes("block") &&
          !tokens.includes("flex"));

      if (
        isInALineOfText &&
        !tokens.some((token: string): boolean => {
          return HELD_TO_ITS_CONTAINER.includes(token);
        })
      ) {
        boxes.push(
          `${describeBox(box)} sits in a line of text without max-w-full`,
        );
      }
    }

    box = container;
  }

  return boxes;
}
