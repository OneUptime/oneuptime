import {
  ERROR_REFERENCE_LINE_TEST_ID,
  ERROR_REFERENCE_TEST_ID,
} from "../../UI/Components/ErrorMessage/ErrorReference";

/*
 * WHERE A FAILURE'S REFERENCE SITS ON ITS LINE, AS A BROWSER PLACES IT
 * (#7622).
 *
 * A reference drawn on a line of its own (ErrorReference) is one inline box
 * on a block line, so the line's text alignment - inherited from the lines
 * around it - places it: centred under centred lines, at their start where
 * they start. jsdom lays nothing out, so this reads what a browser would:
 * that the box is inline (inline-flex, which text-align places, never a
 * block flex row, which it does not reach), that its line is a plain block,
 * and the alignment the nearest element above it sets, by its classes or
 * its style. A suite that draws a layout asks where its reference sits.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export type ReferenceAlignment = "center" | "start" | "end" | "left" | "right";

// The classes that set a line's alignment, unprefixed (no sm:, no md:).
const ALIGNMENT_CLASSES: Record<string, ReferenceAlignment> = {
  "text-center": "center",
  "text-start": "start",
  "text-end": "end",
  "text-left": "left",
  "text-right": "right",
};

const STYLE_ALIGNMENTS: Record<string, ReferenceAlignment> = {
  center: "center",
  start: "start",
  end: "end",
  left: "left",
  right: "right",
};

// The alignment an element sets itself, or null when it inherits one.
const alignmentSetBy: (element: Element) => ReferenceAlignment | null = (
  element: Element,
): ReferenceAlignment | null => {
  const styled: string = (element as HTMLElement).style?.textAlign || "";

  if (STYLE_ALIGNMENTS[styled]) {
    return STYLE_ALIGNMENTS[styled]!;
  }

  for (const className of Array.from(element.classList)) {
    if (ALIGNMENT_CLASSES[className]) {
      return ALIGNMENT_CLASSES[className]!;
    }
  }

  return null;
};

/*
 * Where the reference sits on its line: the alignment the nearest element
 * above it sets, or "start", the alignment a line has when nothing sets
 * one. Throws when the reference is drawn so that no alignment would reach
 * it - a box that is not inline, or a line that lays it out itself - which
 * is what left a table's failed load with its reference at the start.
 */
export const getReferenceAlignment: (
  reference: HTMLElement,
) => ReferenceAlignment = (reference: HTMLElement): ReferenceAlignment => {
  if (reference.getAttribute("data-testid") !== ERROR_REFERENCE_TEST_ID) {
    throw new Error(
      `Expected the reference's own box (data-testid="${ERROR_REFERENCE_TEST_ID}").`,
    );
  }

  if (
    !reference.classList.contains("inline-flex") ||
    reference.classList.contains("flex")
  ) {
    throw new Error(
      `The reference's box is "${reference.className}": only an inline box is placed by its line's alignment.`,
    );
  }

  const line: HTMLElement | null = reference.parentElement;

  if (
    !line ||
    line.getAttribute("data-testid") !== ERROR_REFERENCE_LINE_TEST_ID ||
    !line.classList.contains("block") ||
    ["flex", "inline-flex", "grid", "inline-grid"].some(
      (layout: string): boolean => {
        return line.classList.contains(layout);
      },
    )
  ) {
    throw new Error(
      `The reference's line is "${line?.className || "missing"}": it must be a plain block line of its own.`,
    );
  }

  let element: Element | null = line;

  while (element) {
    const alignment: ReferenceAlignment | null = alignmentSetBy(element);

    if (alignment) {
      return alignment;
    }

    element = element.parentElement;
  }

  return "start";
};

/*
 * Where the words above the reference sit: the alignment the element that
 * holds the explanation's words inherits, read the same way, so a suite can
 * say the reference sits where they do.
 */
export const getWordsAlignment: (words: HTMLElement) => ReferenceAlignment = (
  words: HTMLElement,
): ReferenceAlignment => {
  let element: Element | null = words;

  while (element) {
    const alignment: ReferenceAlignment | null = alignmentSetBy(element);

    if (alignment) {
      return alignment;
    }

    element = element.parentElement;
  }

  return "start";
};
