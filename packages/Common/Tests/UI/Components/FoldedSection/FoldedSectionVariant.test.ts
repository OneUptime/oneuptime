import { describe, expect, test } from "@jest/globals";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SETTINGS_SECTION_TITLE,
} from "../../../../UI/Components/FoldedSection/FoldedSectionTitles";
import {
  FOLDED_SECTION_CARD,
  FOLDED_SECTION_LINE,
  FoldedSectionVariant,
  getFoldedSectionVariant,
} from "../../../../UI/Components/FoldedSection/FoldedSectionVariant";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * "Can we make this more subtle, this needs to be done across the project
 * for more fields. Takes up too much real estate right now." - the
 * maintainer, on the More fields card.
 *
 * Which look a fold is drawn with. More fields is one quiet line wherever
 * it is drawn - a form's (getAdvancedFormSection) and a hand-built
 * editor's, such as the monitor form's request settings - because the look
 * goes with the name: no editor has to remember to ask for it, and none can
 * draw a More fields card. Every other fold is a card unless it asks for
 * the line.
 */

describe("getFoldedSectionVariant", () => {
  test("the two looks are called card and line", () => {
    expect(FOLDED_SECTION_CARD).toBe("card");
    expect(FOLDED_SECTION_LINE).toBe("line");
  });

  test("More fields is the line, whatever it asks for", () => {
    const asked: Array<FoldedSectionVariant | undefined> = [
      undefined,
      FOLDED_SECTION_LINE,
      FOLDED_SECTION_CARD,
    ];

    for (const variant of asked) {
      expect(
        getFoldedSectionVariant({
          title: MORE_FIELDS_SECTION_TITLE,
          variant: variant,
        }),
      ).toBe(FOLDED_SECTION_LINE);
    }
  });

  test("every other fold is a card unless it asks for the line", () => {
    for (const title of [
      MORE_SETTINGS_SECTION_TITLE,
      "Subscriber Notifications",
      "Add a public note",
      "Layout",
      // Not the More fields name: a near miss is another fold.
      "More Fields",
      "More fields ",
    ]) {
      expect(getFoldedSectionVariant({ title })).toBe(FOLDED_SECTION_CARD);
      expect(
        getFoldedSectionVariant({ title, variant: FOLDED_SECTION_CARD }),
      ).toBe(FOLDED_SECTION_CARD);
      expect(
        getFoldedSectionVariant({ title, variant: FOLDED_SECTION_LINE }),
      ).toBe(FOLDED_SECTION_LINE);
    }
  });

  test("a form's More fields asks for the line itself too, and gets it", () => {
    const section: ReturnType<typeof getAdvancedFormSection> =
      getAdvancedFormSection();

    expect(section.variant).toBe(FOLDED_SECTION_LINE);
    expect(
      getFoldedSectionVariant({
        title: section.title,
        variant: section.variant,
      }),
    ).toBe(FOLDED_SECTION_LINE);
    // A line has no icon tile to draw.
    expect(section.icon).toBeUndefined();
  });
});
