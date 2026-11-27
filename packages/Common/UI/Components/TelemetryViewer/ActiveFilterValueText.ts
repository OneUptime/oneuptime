import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "../EntityDropdown/EntityDropdownNotFound";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";

/*
 * WHAT A CHIP'S VALUE READS AS, BESIDE ITS NAME (#11213).
 *
 * The explorers' chips (logs, traces, exceptions, metrics) name what they
 * filter by: a chip a link or a saved view brought holds an id, and the
 * explorer names it from a read by that id. Once the record is deleted -
 * or out of the reader's reach - every read answers nothing, and the chip
 * read as the raw id. Marked by the explorer once every read it made has
 * answered (getTelemetryEntityChipMarks), such a chip reads "No longer
 * available", the words every picker of the dashboard says it in; a chip
 * naming an archived record reads its name marked archived. Display only:
 * the chip keeps its id, still filters by it as saved, and is taken out
 * like any other.
 */

export const ACTIVE_FILTER_NOT_FOUND_LABEL: string =
  ENTITY_DROPDOWN_NOT_FOUND_LABEL;

export const ACTIVE_FILTER_ARCHIVED_LABEL: string = translationKey(
  "{{name}} (archived)",
);

// What a chip's value is read from.
export interface ActiveFilterValueFacts {
  displayValue: string;
  isNotFound?: boolean | undefined;
  isArchived?: boolean | undefined;
}

export const getActiveFilterValueText: (
  filter: ActiveFilterValueFacts,
  translator: Pick<Translator, "translateText" | "translateTemplate">,
  // The chip's own text for its value, when it is not plain text.
  toText?: ((value: string) => string) | undefined,
) => string = (
  filter: ActiveFilterValueFacts,
  translator: Pick<Translator, "translateText" | "translateTemplate">,
  toText?: ((value: string) => string) | undefined,
): string => {
  if (filter.isNotFound) {
    return (
      translator.translateText(ACTIVE_FILTER_NOT_FOUND_LABEL) ||
      ACTIVE_FILTER_NOT_FOUND_LABEL
    );
  }

  const text: string = toText
    ? toText(filter.displayValue)
    : filter.displayValue;

  if (filter.isArchived) {
    return translator.translateTemplate(ACTIVE_FILTER_ARCHIVED_LABEL, {
      name: text,
    });
  }

  return text;
};
