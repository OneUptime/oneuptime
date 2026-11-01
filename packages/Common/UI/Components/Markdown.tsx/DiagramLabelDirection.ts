import {
  getTextReadingDirectionByMostLetters,
  ReadingDirection,
} from "../../../Types/ReadingDirection";

/*
 * A DIAGRAM'S LABELS READ THE WAY THEY ARE WRITTEN.
 *
 * mermaid lays a diagram out left to right, and draws its labels in the
 * direction of the box around it: a note's, which reads the way most of the
 * note does. So a Persian label in a note that starts in English - "پرداخت
 * انجام شد." on a sequence diagram's arrow - drew its full stop at its right,
 * where a Persian sentence starts, and an English label in a Persian note
 * put its full stop first. Each label now reads the way most of its letters
 * do (getTextReadingDirectionByMostLetters), as a value in a table's cell
 * does; the diagram's own layout is untouched.
 *
 * Two kinds of label are turned:
 *   - a flowchart's, a state's or a class's box: a foreignObject holding the
 *     label's text (DiagramSanitizer keeps the text, not its HTML wrappers);
 *   - a sequence diagram's names, messages and notes: SVG text centred on
 *     its anchor (text-anchor: middle). A text anchored at its start or its
 *     end is left as it is: turning it would move it to the other side of
 *     its anchor.
 */

export const DIAGRAM_HTML_LABEL_SELECTOR: string = "foreignObject";

export const DIAGRAM_TEXT_LABEL_SELECTOR: string = "text";

// The way a text is anchored: its attribute, else what its stylesheet says.
const getTextAnchor: (text: Element) => string = (text: Element): string => {
  const attribute: string | null = text.getAttribute("text-anchor");

  if (attribute) {
    return attribute;
  }

  if (typeof window === "undefined" || !window.getComputedStyle) {
    return "";
  }

  return window.getComputedStyle(text).getPropertyValue("text-anchor");
};

export type SetDiagramLabelDirectionsFunction = (diagram: Element) => number;

/*
 * Sets each label's direction in a drawn diagram; answers how many it set.
 * A label with no letters (a number, an arrow) follows the diagram.
 */
export const setDiagramLabelDirections: SetDiagramLabelDirectionsFunction = (
  diagram: Element,
): number => {
  let set: number = 0;

  for (const label of Array.from(
    diagram.querySelectorAll(DIAGRAM_HTML_LABEL_SELECTOR),
  )) {
    const direction: ReadingDirection | null =
      getTextReadingDirectionByMostLetters(label.textContent);

    if (direction) {
      (label as SVGElement).style.setProperty("direction", direction);
      set++;
    }
  }

  for (const text of Array.from(
    diagram.querySelectorAll(DIAGRAM_TEXT_LABEL_SELECTOR),
  )) {
    if (getTextAnchor(text) !== "middle") {
      continue;
    }

    const direction: ReadingDirection | null =
      getTextReadingDirectionByMostLetters(text.textContent);

    if (direction) {
      text.setAttribute("direction", direction);
      set++;
    }
  }

  return set;
};
