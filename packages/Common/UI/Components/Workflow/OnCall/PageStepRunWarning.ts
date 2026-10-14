/*
 * What "Run just this step" says of a Page step before it runs one.
 *
 * Every step run that way runs for real, and the dialog says so. For most
 * steps that is a message in a channel or a record in the project; for a
 * Page step it is a phone ringing, at night if it is night where the person
 * is. So the dialog says that too, in so many words, before the button is
 * pressed.
 */

import { isPageStep } from "../../../../Types/Workflow/Components/OnCall";
import { translationKey } from "../../../Utils/TranslateTemplate";

export const PAGE_STEP_RUN_WARNING: string = translationKey(
  "This step pages people: everybody it names is called, texted or notified as their on-call rules say. Name yourself while you test.",
);

export type GetPageStepRunWarningFunction = (
  metadataId: string | undefined | null,
) => string | null;

// The sentence for a Page step, in English, or null for any other step.
export const getPageStepRunWarning: GetPageStepRunWarningFunction = (
  metadataId: string | undefined | null,
): string | null => {
  return isPageStep(metadataId) ? PAGE_STEP_RUN_WARNING : null;
};
