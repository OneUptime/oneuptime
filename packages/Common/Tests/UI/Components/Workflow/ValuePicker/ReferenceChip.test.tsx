/*
 * The chip a setting shows in place of a {{...}} reference.
 *
 * "Pls make the available and non-available variables a little more visually
 * distinct": a value that is there is an indigo chip, one that is not - a
 * step that is gone, a field its step does not pass on - an amber one whose
 * tooltip says what is wrong. Both are 12px words on a tinted ground, so
 * both of a chip's parts have to be a shade that can be read there: the step
 * it comes from was indigo-500 on indigo-50 (4.0:1) and amber-600 on
 * amber-50 (3.1:1), fainter than the words they sat beside.
 *
 * The chip has two forms that must not drift apart: the React one, and the
 * element the editor builds by hand inside its contenteditable.
 */

import ReferenceChip, {
  CHIP_REFERENCE_ATTRIBUTE,
  chipClassName,
  chipTitle,
  createReferenceChipElement,
} from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceChip";
import {
  ReferenceDescription,
  ReferenceKind,
  ReferenceTone,
} from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import {
  AA_TEXT_CONTRAST,
  contrastOf,
  groundClassOf,
  textClassOf,
} from "../../../../Helpers/TailwindContrast";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

const TITLE: string =
  "{{local.components.incident-on-update-1.returnValues.model.title}}";

const NOT_PASSED_ON: string =
  '"On Update Incident" doesn\'t pass this field on, so it is empty here. Add it to its Fields to pass on.';

type DescriptionFunction = (tone: ReferenceTone) => ReferenceDescription;

const description: DescriptionFunction = (
  tone: ReferenceTone,
): ReferenceDescription => {
  return {
    reference: TITLE,
    kind: ReferenceKind.StepValue,
    source: "On Update Incident",
    parts: ["Incident", "title"],
    label: "On Update Incident › Incident › title",
    tone: tone,
    problem: tone === ReferenceTone.Warning ? NOT_PASSED_ON : undefined,
  };
};

type ChipFunction = (tone: ReferenceTone) => HTMLElement;

// The chip as React draws it.
const reactChip: ChipFunction = (tone: ReferenceTone): HTMLElement => {
  cleanup();
  render(<ReferenceChip reference={TITLE} description={description(tone)} />);

  return screen.getByTestId("template-reference-chip");
};

// The chip as the editor builds it.
const editorChip: ChipFunction = (tone: ReferenceTone): HTMLElement => {
  return createReferenceChipElement(document, TITLE, description(tone));
};

type PartsFunction = (chip: HTMLElement) => Array<HTMLElement>;

// The words of a chip: where it comes from, then each thing it reads.
const words: PartsFunction = (chip: HTMLElement): Array<HTMLElement> => {
  return Array.from(chip.querySelectorAll("span")).filter(
    (part: HTMLElement): boolean => {
      return part.getAttribute("aria-hidden") !== "true";
    },
  );
};

const separators: PartsFunction = (chip: HTMLElement): Array<HTMLElement> => {
  return Array.from(chip.querySelectorAll('span[aria-hidden="true"]'));
};

const TONES: Array<ReferenceTone> = [
  ReferenceTone.Normal,
  ReferenceTone.Warning,
];

const FORMS: Array<[string, ChipFunction]> = [
  ["in a setting that is not edited", reactChip],
  ["in the editor", editorChip],
];

afterEach(() => {
  cleanup();
});

describe("what a chip says", () => {
  test.each(FORMS)(
    "%s: where the value comes from, then what it reads, with the reference in its tooltip",
    (_form: string, chip: ChipFunction) => {
      const element: HTMLElement = chip(ReferenceTone.Normal);

      expect(
        words(element).map((part: HTMLElement): string | null => {
          return part.textContent;
        }),
      ).toEqual(["On Update Incident", "Incident", "title"]);
      // The arrows between them are for the eye only.
      expect(separators(element)).toHaveLength(2);
      expect(element).toHaveAttribute("data-tone", "Normal");
      expect(element).toHaveAttribute("title", TITLE);
    },
  );

  test.each(FORMS)(
    "%s: a value that is not there says what is wrong, under the reference",
    (_form: string, chip: ChipFunction) => {
      const element: HTMLElement = chip(ReferenceTone.Warning);

      expect(element).toHaveAttribute("data-tone", "Warning");
      expect(element).toHaveAttribute("title", `${TITLE}\n${NOT_PASSED_ON}`);
      // The same words as a chip that is fine: only its colour differs.
      expect(element.textContent).toBe(chip(ReferenceTone.Normal).textContent);
    },
  );

  test("a reference nothing can name is shown as it is written, in either form", () => {
    render(<ReferenceChip reference={TITLE} description={null} />);

    const drawn: HTMLElement = screen.getByTestId("template-reference-chip");
    const built: HTMLElement = createReferenceChipElement(
      document,
      TITLE,
      null,
    );

    for (const element of [drawn, built]) {
      expect(element.textContent).toBe(TITLE);
      expect(element).toHaveAttribute("data-tone", "Normal");
      expect(element).toHaveAttribute("title", TITLE);
      expect(separators(element)).toHaveLength(0);
    }
  });

  test("the tooltip is the reference, and the problem on a line of its own when there is one", () => {
    expect(chipTitle(description(ReferenceTone.Normal), TITLE)).toBe(TITLE);
    expect(chipTitle(description(ReferenceTone.Warning), TITLE)).toBe(
      `${TITLE}\n${NOT_PASSED_ON}`,
    );
    expect(chipTitle(null, TITLE)).toBe(TITLE);
  });
});

describe("the editor's chip", () => {
  test("is one thing to the caret: not editable, not draggable, and carrying its reference", () => {
    const element: HTMLElement = editorChip(ReferenceTone.Normal);

    expect(element).toHaveAttribute(CHIP_REFERENCE_ATTRIBUTE, TITLE);
    expect(element).toHaveAttribute("contenteditable", "false");
    expect(element).toHaveAttribute("draggable", "false");
    expect(element).toHaveAttribute("data-testid", "template-reference-chip");
  });

  test.each(TONES)(
    "is drawn with the classes the React chip has, part for part (%s)",
    (tone: ReferenceTone) => {
      const drawn: HTMLElement = reactChip(tone);
      const built: HTMLElement = editorChip(tone);

      expect(built.className).toBe(drawn.className);
      expect(built.className).toBe(chipClassName(tone));
      expect(
        Array.from(built.querySelectorAll("span")).map(
          (part: HTMLElement): string => {
            return part.className;
          },
        ),
      ).toEqual(
        Array.from(drawn.querySelectorAll("span")).map(
          (part: HTMLElement): string => {
            return part.className;
          },
        ),
      );
    },
  );
});

describe("a chip's colours", () => {
  test("a value that is there is indigo, one that is not is amber", () => {
    expect(groundClassOf(reactChip(ReferenceTone.Normal))).toBe("bg-indigo-50");
    expect(groundClassOf(reactChip(ReferenceTone.Warning))).toBe("bg-amber-50");
    expect(textClassOf(reactChip(ReferenceTone.Normal))).toMatch(
      /^text-indigo-/,
    );
    expect(textClassOf(reactChip(ReferenceTone.Warning))).toMatch(
      /^text-amber-/,
    );
  });

  describe.each(FORMS)("%s", (_form: string, chip: ChipFunction) => {
    test.each(TONES)(
      "every word of a %s chip can be read on the chip's own ground",
      (tone: ReferenceTone) => {
        const parts: Array<HTMLElement> = words(chip(tone));

        expect(parts).toHaveLength(3);

        for (const part of parts) {
          expect({
            words: part.textContent,
            isReadable: contrastOf(part) >= AA_TEXT_CONTRAST,
          }).toEqual({ words: part.textContent, isReadable: true });
        }
      },
    );

    test.each(TONES)(
      "the step a %s chip's value comes from is lighter and thinner than what it reads",
      (tone: ReferenceTone) => {
        const parts: Array<HTMLElement> = words(chip(tone));
        const source: HTMLElement = parts[0]!;
        const last: HTMLElement = parts[parts.length - 1]!;

        expect(contrastOf(source)).toBeLessThan(contrastOf(last));
        expect(source).toHaveClass("font-normal");
        expect(last).not.toHaveClass("font-normal");
        // One hue: the source is a shade of the chip's colour, not a grey.
        expect(textClassOf(source).split("-")[1]).toBe(
          textClassOf(last).split("-")[1],
        );
      },
    );
  });

  test("the arrows between a chip's words are dimmed, and the words are not", () => {
    const element: HTMLElement = reactChip(ReferenceTone.Warning);

    for (const separator of separators(element)) {
      expect(separator).toHaveClass("opacity-60");
    }

    for (const part of words(element)) {
      expect(part.className).not.toMatch(/opacity-/);
    }
  });
});
