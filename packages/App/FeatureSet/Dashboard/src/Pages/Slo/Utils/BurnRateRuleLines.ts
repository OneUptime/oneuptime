import {
  SentenceOptions,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import {
  formatSloNumber,
  formatSloPercent,
} from "Common/Utils/Slo/SloWidgetFormat";

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

/*
 * A rule's windows and its re-fire suppression, as its row in the rules
 * table, the recommended rules dialog and the SLO list's bulk Add
 * recommended rules all write them: "60m / 5m" and "Suppress 60m after
 * resolve".
 *
 * Each figure is written the reader's way, as every other SLO figure is
 * (formatSloNumber): Persian digits on a Persian page, beside the rule's
 * Persian threshold, and "4.320 Min. / 360 Min." in German. An English
 * reader reads them exactly as before, "4320m / 360m", with no thousands
 * separator. Filled with the bare numbers, the sentences wrote them with
 * Latin digits in every language (#6924).
 */
export const BURN_RATE_RULE_WINDOWS_TEMPLATE: string = translationKey(
  "{{long}}m / {{short}}m",
);

export const BURN_RATE_RULE_SUPPRESSION_TEMPLATE: string = translationKey(
  "Suppress {{minutes}}m after resolve",
);

export interface BurnRateRuleWindowsData {
  longWindowInMinutes?: number | undefined | null;
  shortWindowInMinutes?: number | undefined | null;
  refireSuppressionMinutes?: number | undefined | null;
}

export interface BurnRateRuleWindowsText {
  // "60m / 5m": the long window, then the short one.
  windows: string;
  // "Suppress 60m after resolve".
  suppression: string;
}

type WriteMinutesFunction = (
  minutes: number | undefined | null,
  translator: Translator,
) => string;

// A count of minutes, the reader's way. A missing one reads 0, as it always did.
const writeMinutes: WriteMinutesFunction = (
  minutes: number | undefined | null,
  translator: Translator,
): string => {
  const value: number = Number(minutes ?? 0);
  const shown: number = isFinite(value) ? value : 0;

  return formatSloNumber(shown, 0, translator) ?? String(shown);
};

type FormatBurnRateRuleWindowsFunction = (
  rule: BurnRateRuleWindowsData,
  translator: Translator,
) => BurnRateRuleWindowsText;

export const formatBurnRateRuleWindows: FormatBurnRateRuleWindowsFunction = (
  rule: BurnRateRuleWindowsData,
  translator: Translator,
): BurnRateRuleWindowsText => {
  /*
   * The worker falls back to the long window when no suppression is set, so
   * the effective value is shown rather than a blank that reads as "no
   * suppression".
   */
  const suppressionMinutes: number | undefined | null =
    rule.refireSuppressionMinutes ?? rule.longWindowInMinutes;

  return {
    windows: translator.translateTemplate(BURN_RATE_RULE_WINDOWS_TEMPLATE, {
      long: writeMinutes(rule.longWindowInMinutes, translator),
      short: writeMinutes(rule.shortWindowInMinutes, translator),
    }),
    suppression: translator.translateTemplate(
      BURN_RATE_RULE_SUPPRESSION_TEMPLATE,
      { minutes: writeMinutes(suppressionMinutes, translator) },
    ),
  };
};

/*
 * What a recommended rule is for, under its name in the recommended rules
 * dialog and the SLO list's bulk Add recommended rules: "Fires when about 2%
 * of the error budget burns in 1h". The share and the window are written
 * the reader's way: "2 %" in German, "۲٪" and a Persian hour on a Persian
 * page.
 *
 * The share is one value with its sign (formatSloPercent), set apart from
 * the sentence, so an Arabic or Persian page draws it as every other share
 * on the SLO pages is drawn: its figure, then its sign on the right. With
 * the sign written into the sentence after a bare figure, the bidi
 * algorithm read the sign with the right-to-left words around it and drew
 * it on the figure's left ("%2" beside the Overview's "99.9%").
 */
export const BURN_RATE_RULE_FIRES_WHEN_TEMPLATE: string = translationKey(
  "Fires when about {{percent}} of the error budget burns in {{duration}}",
);

// The share and the window each set apart from the words around them.
const FIGURES_SET_APART: SentenceOptions = { setsValuesApart: true };

export interface BurnRateRuleFiresWhenData {
  budgetPercentage: number;
  longWindowInMinutes: number;
}

type FormatBurnRateRuleFiresWhenFunction = (
  rule: BurnRateRuleFiresWhenData,
  translator: Translator,
) => string;

export const formatBurnRateRuleFiresWhen: FormatBurnRateRuleFiresWhenFunction =
  (rule: BurnRateRuleFiresWhenData, translator: Translator): string => {
    return translator.translateTemplate(
      BURN_RATE_RULE_FIRES_WHEN_TEMPLATE,
      {
        percent:
          formatSloPercent(rule.budgetPercentage, 2, translator) ??
          `${rule.budgetPercentage}%`,
        duration: formatDurationCompactInLanguage(
          rule.longWindowInMinutes * 60,
          translator.language,
        ),
      },
      FIGURES_SET_APART,
    );
  };
