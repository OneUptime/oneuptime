import {
  DATA_ALERT_CAUSE_TITLES,
  DataAlertCauseTitleWords,
  isDataAlertCauseTitleCode,
} from "Common/Types/DataObservability/DataAlertCauseTitles";
import {
  DataAlertCauseKind,
  DataAlertLikelyCause,
} from "Common/Types/DataObservability/DataAlertFeedback";
import {
  composedValue,
  TemplateValues,
  translationKey,
  Translator,
} from "Common/Types/Translator";

/*
 * WHY A DATA ALERT MOST LIKELY HAPPENED, IN THE READER'S WORDS (#8343).
 *
 * A data alert's Why This Happened card headed each likely cause with its
 * kind, looked up by its stored value: "Upstream Alert", "Failed Run",
 * "Failing Writes" and "Schema Change" were no keys, so a German card read
 * "Failed Run · ..." under "Warum das passiert ist". Each kind has its name
 * here, a key every language words. "Deploy" and "Database" are nouns
 * wherever the Dashboard looks them up (a chart's deploy marker, a store's
 * family), so a cause shares them.
 *
 * A cause's title is the server's English sentence; where the server words
 * it from one of its sentences (DataAlertCauseTitles), the card says that
 * sentence in the reader's language with the names put in as they are,
 * and the counts in the sentence's digits.
 *
 * React-free, beside DataCheckTypeWords: App's tests read it without React.
 */
export const DATA_ALERT_CAUSE_KIND_LABELS: Readonly<
  Record<DataAlertCauseKind, string>
> = {
  [DataAlertCauseKind.UpstreamAlert]: translationKey("Upstream Alert"),
  [DataAlertCauseKind.FailedRun]: translationKey("Failed Run"),
  [DataAlertCauseKind.Deploy]: translationKey("Deploy"),
  [DataAlertCauseKind.FailingWrites]: translationKey("Failing Writes"),
  [DataAlertCauseKind.SchemaChange]: translationKey("Schema Change"),
  [DataAlertCauseKind.Database]: translationKey("Database"),
};

/*
 * A cause's kind as the reader reads it: "Fehlgeschlagener Lauf" for a
 * failed run on a German page. A kind this Dashboard does not know - a
 * newer server's - is drawn as it is, rather than as nothing.
 */
export function getDataAlertCauseKindLabel(
  translator: Translator,
  kind: DataAlertCauseKind | string | null | undefined,
): string {
  const value: string = kind || "";
  const label: string | undefined = Object.prototype.hasOwnProperty.call(
    DATA_ALERT_CAUSE_KIND_LABELS,
    value,
  )
    ? DATA_ALERT_CAUSE_KIND_LABELS[value as DataAlertCauseKind]
    : undefined;

  return label ? translator.translateText(label) || label : value;
}

/*
 * A title's values as its sentence holds them: a name as it is, a count in
 * the digits of the language the sentence is said in - the reader's, or
 * English's where their language has not worded it yet.
 */
const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

function getSentenceValues(
  sent: Record<string, string | number>,
): TemplateValues {
  const values: TemplateValues = {};

  for (const [name, value] of Object.entries(sent)) {
    values[name] =
      typeof value === "number"
        ? composedValue((sentence: Translator): string => {
            return sentence.formatNumber(value);
          })
        : String(value);
  }

  return values;
}

/*
 * A cause's title in the reader's language, and whether it is the server's
 * English as written: a record's own words (an alert's title, a deploy's
 * change), or a sentence this Dashboard has no words for.
 */
export function getDataAlertCauseTitle(
  translator: Translator,
  cause: Pick<DataAlertLikelyCause, "title" | "titleWords">,
): { text: string; isAsWritten: boolean } {
  const words: DataAlertCauseTitleWords | undefined = cause.titleWords;
  const asWritten: { text: string; isAsWritten: boolean } = {
    text: cause.title || "",
    isAsWritten: true,
  };

  if (!words || !isDataAlertCauseTitleCode(words.code)) {
    return asWritten;
  }

  const sentence: string = DATA_ALERT_CAUSE_TITLES[words.code];
  const values: Record<string, string | number> = words.values || {};

  // A sentence missing one of its names would show its placeholder: the English, then.
  for (const match of sentence.matchAll(PLACEHOLDER)) {
    if (!Object.prototype.hasOwnProperty.call(values, match[1] as string)) {
      return asWritten;
    }
  }

  return {
    text: translator.translateTemplate(sentence, getSentenceValues(values), {
      setsValuesApart: true,
    }),
    isAsWritten: false,
  };
}
