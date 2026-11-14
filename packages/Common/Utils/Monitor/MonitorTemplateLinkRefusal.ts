import {
  getRefusalText,
  RefusalWithValues,
} from "../../Types/Exception/RefusalWithValues";
import { translationKey } from "../../Types/Translator";

/*
 * WHY A MONITOR CANNOT BE LINKED TO A TEMPLATE, SYNCED FROM IT OR UNLINKED
 * (#7678).
 *
 * MonitorTemplateService refuses with these, and the template's page shows
 * them: Link Existing Monitors says why each monitor it could not link was
 * refused, and Sync from Template and Unlink from Template say why they did
 * not finish. They were fragments ("Monitor not found", "Monitor and
 * template belong to different projects") and a sentence with the two types
 * inside it ("Monitor type "Ping" does not match template type "API""), so
 * the page said them in English in every language. Each is a whole sentence
 * now, and a key of the Dashboard's locales (this directory is a source of
 * its string extractor). The type mismatch keeps its two types as
 * placeholders (RefusalWithValues): the Dashboard reads them back out of
 * the English and says the sentence with the reader's words for them.
 *
 * React-free and server-safe: the server throws these, the Dashboard reads
 * them.
 */

// The monitor is gone, or the caller may not see it.
export const MONITOR_NOT_FOUND_REFUSAL: string = translationKey(
  "This monitor does not exist in this project, or you do not have access to it.",
);

export const MONITOR_IN_ANOTHER_PROJECT_REFUSAL: string = translationKey(
  "This monitor and this template are in different projects.",
);

// Sync from Template and Unlink from Template reach only the template's own monitors.
export const MONITOR_NOT_LINKED_REFUSAL: string = translationKey(
  "This monitor is not linked to this template.",
);

/*
 * A template links only monitors of its own type: its criteria are written
 * for that type.
 */
export const MONITOR_TYPE_MISMATCH_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "This monitor's type is {{monitorType}}, and this template's type is {{templateType}}. Only monitors of the template's type can be linked to it.",
  ),
  terms: ["monitorType", "templateType"],
};

// The type mismatch as the server answers it: in English, with the two types.
export const getMonitorTypeMismatchRefusal: (data: {
  monitorType: string;
  templateType: string;
}) => string = (data: {
  monitorType: string;
  templateType: string;
}): string => {
  return getRefusalText(MONITOR_TYPE_MISMATCH_REFUSAL, {
    monitorType: data.monitorType,
    templateType: data.templateType,
  });
};
