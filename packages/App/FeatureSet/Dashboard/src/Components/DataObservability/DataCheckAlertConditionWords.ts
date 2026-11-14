import { DataCheckAlertCondition } from "Common/Types/DataObservability/DataCheckType";
import { translationKey, Translator } from "Common/Types/Translator";

/*
 * WHEN A CHECK ALERTS, IN THE READER'S WORDS.
 *
 * A check alerts when its value is above or below a number, or unusually
 * high or low for its hour of the week. Each is said as a whole, in the
 * reader's language, with the number where that language puts it: German
 * says "über 0", Japanese "0 を上回る", Korean "0 초과", Hindi "0 से ऊपर".
 * Joining the condition's word to the number ("{{condition}} {{threshold}}")
 * put the number after the word in every language, and Write a Check from
 * a Sentence filled it with the condition's English value, lowercased:
 * "Alarmiert, wenn ihr Wert above 0 ist." (#6976).
 *
 * The words are the Checks tab's: Write a Check from a Sentence ends with
 * the sentence, the checks' Alert column and each suggested check name the
 * condition on its own, and the form's Alert When dropdown offers the
 * labels. Every condition has its own words, so none falls back to the
 * English value - Unusually High and Unusually Low too, which a check from
 * a sentence never answers with (the server answers Above or Below).
 *
 * React-free: App's tests read it without React.
 */

// The sentence Write a Check from a Sentence ends with, for each condition.
export const DATA_CHECK_ALERT_CONDITION_SENTENCES: Readonly<
  Record<DataCheckAlertCondition, string>
> = {
  [DataCheckAlertCondition.UnusuallyHigh]: translationKey(
    "Alerts when its value is unusually high.",
  ),
  [DataCheckAlertCondition.UnusuallyLow]: translationKey(
    "Alerts when its value is unusually low.",
  ),
  [DataCheckAlertCondition.Above]: translationKey(
    "Alerts when its value is above {{threshold}}.",
  ),
  [DataCheckAlertCondition.Below]: translationKey(
    "Alerts when its value is below {{threshold}}.",
  ),
};

// A condition's name: the Alert When dropdown's labels.
export const DATA_CHECK_ALERT_CONDITION_LABELS: Readonly<
  Record<DataCheckAlertCondition, string>
> = {
  [DataCheckAlertCondition.UnusuallyHigh]: translationKey("Unusually High"),
  [DataCheckAlertCondition.UnusuallyLow]: translationKey("Unusually Low"),
  [DataCheckAlertCondition.Above]: translationKey("Above"),
  [DataCheckAlertCondition.Below]: translationKey("Below"),
};

/*
 * A condition with its number, on its own: the checks' Alert column and a
 * suggested check. Only the two that compare with a number have one.
 */
export const DATA_CHECK_ALERT_THRESHOLD_PHRASES: Readonly<
  Partial<Record<DataCheckAlertCondition, string>>
> = {
  [DataCheckAlertCondition.Above]: translationKey("Above {{threshold}}"),
  [DataCheckAlertCondition.Below]: translationKey("Below {{threshold}}"),
};

// Whether a value is one of the conditions a check can alert on.
const isAlertCondition: (
  value: string | null | undefined,
) => value is DataCheckAlertCondition = (
  value: string | null | undefined,
): value is DataCheckAlertCondition => {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(
      DATA_CHECK_ALERT_CONDITION_LABELS,
      value,
    )
  );
};

/*
 * A threshold as a number, or null when there is none: a check saved
 * without one, or a value that is not a number.
 */
const readThreshold: (
  threshold: number | string | null | undefined,
) => number | null = (
  threshold: number | string | null | undefined,
): number | null => {
  if (threshold === null || threshold === undefined || threshold === "") {
    return null;
  }

  const value: number = Number(threshold);

  return Number.isFinite(value) ? value : null;
};

/*
 * When a check alerts, on its own: "Above 0" ("Über 0", "0 を上回る"),
 * "Unusually High". Above or Below with no number says the condition's
 * name alone. A value that is no condition (none a check is saved with)
 * is drawn as it is.
 */
export const getDataCheckAlertConditionWords: (data: {
  translator: Translator;
  condition: string;
  threshold?: number | string | null | undefined;
}) => string = (data: {
  translator: Translator;
  condition: string;
  threshold?: number | string | null | undefined;
}): string => {
  if (!isAlertCondition(data.condition)) {
    return data.condition;
  }

  const phrase: string | undefined =
    DATA_CHECK_ALERT_THRESHOLD_PHRASES[data.condition];
  const threshold: number | null = readThreshold(data.threshold);

  if (phrase && threshold !== null) {
    return data.translator.translateTemplate(
      phrase,
      { threshold: data.translator.formatNumber(threshold) },
      { setsValuesApart: true },
    );
  }

  const label: string = DATA_CHECK_ALERT_CONDITION_LABELS[data.condition];

  return data.translator.translateText(label) || label;
};

/*
 * The sentence that says when a check alerts: "Alerts when its value is
 * above 0." ("Alarmiert, wenn ihr Wert über 0 liegt.", "値が 0 を上回るとき
 * にアラートします。"). Null for a value that is no condition: no sentence
 * rather than an English one.
 */
export const getDataCheckAlertConditionSentence: (data: {
  translator: Translator;
  condition: string;
  threshold: number;
}) => string | null = (data: {
  translator: Translator;
  condition: string;
  threshold: number;
}): string | null => {
  if (!isAlertCondition(data.condition)) {
    return null;
  }

  return data.translator.translateTemplate(
    DATA_CHECK_ALERT_CONDITION_SENTENCES[data.condition],
    { threshold: data.translator.formatNumber(data.threshold) },
    { setsValuesApart: true },
  );
};
