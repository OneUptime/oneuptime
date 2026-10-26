import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The Burn Rate Rules table's Severity, On-Call and Owners cells: a line per
 * output the rule declares, "Alert: SEV1" and "Incident: Checkout SRE".
 *
 * A line names what the rule picked, or says it picked nothing: no owners,
 * no escalation, the default severity. That word is looked up on its own, in
 * the reader's language, and put in the line as it reads. Handed to the line
 * as a term instead, it followed the line: "Incident: {{owners}}" reads the
 * same in Swedish and Dutch, and a sentence worded as the English is filled
 * with English terms (TranslateTemplate cannot tell it from one that is not
 * translated), so the table read "Incident: None" there.
 *
 * React-free, so App's tests can read it (FeatureSetImportsStayReactFree).
 */

export const BURN_RATE_RULE_NOTHING_PICKED: {
  owners: string;
  onCallPolicies: string;
  severity: string;
} = {
  owners: translationKey("None"),
  // A rule with no policy still declares, but nothing escalates it.
  onCallPolicies: translationKey("No escalation"),
  severity: translationKey("Default"),
};

type NamesOrWordFunction = (
  names: ReadonlyArray<string | undefined>,
  nothingPicked: string,
  translator: Translator,
) => string;

// The names, or the word for none of them, in the reader's language.
export const getNamesOrNothingPicked: NamesOrWordFunction = (
  names: ReadonlyArray<string | undefined>,
  nothingPicked: string,
  translator: Translator,
): string => {
  const shown: Array<string> = names.filter(
    (name: string | undefined): name is string => {
      return Boolean(name && name.trim());
    },
  );

  if (shown.length > 0) {
    return shown.join(", ");
  }

  return translator.translateText(nothingPicked) || nothingPicked;
};
