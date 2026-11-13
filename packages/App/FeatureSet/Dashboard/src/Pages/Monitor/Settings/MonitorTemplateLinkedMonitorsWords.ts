import { readUnexplainedError } from "Common/Types/Exception/UnexplainedError";
import { getSentenceSeparator } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import { getErrorInSentenceText } from "Common/UI/Utils/ErrorInSentence";
import { getClauseSeparator } from "Common/UI/Utils/ListSeparator";
import {
  composedValue,
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A TEMPLATE'S PAGE SAYS ABOUT ITS LINKED MONITORS (#7678).
 *
 * The sync buttons say how many monitors they reach ("Sync Criteria to 3
 * Linked Monitors"), the Linked Monitors card carries the count in its
 * title, and Link Existing Monitors, Unlink from Template and Sync from
 * Template say what they did. Those were built in English with template
 * literals, so every language read them in English, with Latin digits.
 * Each is a sentence of the Dashboard's locales now, its count written the
 * way the reader's language writes numbers, and a monitor's name kept as
 * written inside it.
 *
 * Kept React-free, so App tests can read the words without a renderer: the
 * docs name a sync button with its count as each language's Dashboard
 * draws it.
 */

// The sync buttons once the count is read: each says how many monitors it reaches.
export const SYNC_TO_LINKED_MONITORS_TITLES: {
  criteria: PluralTemplate;
  interval: PluralTemplate;
  labels: PluralTemplate;
  customFields: PluralTemplate;
} = {
  criteria: {
    one: "Sync Criteria to {{count}} Linked Monitor",
    other: "Sync Criteria to {{count}} Linked Monitors",
  },
  interval: {
    one: "Sync Interval to {{count}} Linked Monitor",
    other: "Sync Interval to {{count}} Linked Monitors",
  },
  labels: {
    one: "Sync Labels to {{count}} Linked Monitor",
    other: "Sync Labels to {{count}} Linked Monitors",
  },
  customFields: {
    one: "Sync Custom Fields to {{count}} Linked Monitor",
    other: "Sync Custom Fields to {{count}} Linked Monitors",
  },
};

// The Linked Monitors card once the count is read.
export const LINKED_MONITORS_TITLE: string = translationKey(
  "Linked Monitors ({{count}})",
);

// What Link Existing Monitors says when every monitor picked was linked.
export const LINKED_MONITORS_RESULT: PluralTemplate = {
  one: "Linked {{count}} monitor to this template.",
  other: "Linked {{count}} monitors to this template.",
};

// What Unlink from Template and Sync from Template say, the monitor's name in it.
export const UNLINKED_MONITOR_RESULT: string = translationKey(
  'Unlinked "{{monitorName}}" from this template.',
);

export const SYNCED_MONITOR_RESULT: string = translationKey(
  'Synced "{{monitorName}}" from this template.',
);

/*
 * Link Existing Monitors, when some of the monitors picked could not be
 * linked: how many of how many, then why - each reason the server gave,
 * said once.
 */
export const LINK_FAILURES_TEMPLATE: PluralTemplate = {
  one: "{{count}} of {{total}} monitors could not be linked: {{errors}}",
  other: "{{count}} of {{total}} monitors could not be linked: {{errors}}",
};

// The marks a whole sentence ends with, in the languages OneUptime speaks.
const SENTENCE_ENDS: ReadonlyArray<string> = [
  ".",
  "!",
  "?",
  "。",
  "！",
  "？",
  "।",
  "؟",
];

const endsAsSentence: (text: string) => boolean = (text: string): boolean => {
  const trimmed: string = text.trim();

  return SENTENCE_ENDS.some((end: string): boolean => {
    return trimmed.endsWith(end);
  });
};

/*
 * The reasons on one line, in `language`. A reason that is a phrase is set
 * off from the next with the semicolon of the reasons' script
 * (getClauseSeparator): "; ", "؛ ", " ; ". A reason that is a whole
 * sentence - each of the server's refusals is, and so is why a server that
 * did not answer did not - is followed by the next as a sentence is: "...or
 * you do not have access to it. The OneUptime server did not answer.",
 * never "...access to it.; The OneUptime server...".
 */
const joinReasons: (
  reasons: ReadonlyArray<string>,
  language: string,
) => string = (reasons: ReadonlyArray<string>, language: string): string => {
  const clauseSeparator: string = getClauseSeparator(reasons, language);

  return reasons.reduce(
    (line: string, reason: string, index: number): string => {
      if (index === 0) {
        return reason;
      }

      const separator: string = endsAsSentence(line)
        ? getSentenceSeparator(line)
        : clauseSeparator;

      return `${line}${separator}${reason}`;
    },
    "",
  );
};

/*
 * The sentence for `failed` of `total` monitors that could not be linked,
 * with the reasons (API.getFriendlyMessage's answers) said in the language
 * the sentence comes out in - the reader's, or English while their language
 * has no wording of it - as ErrorMessageText says an error: an error nobody
 * explained says why and what to do next, and the server's refusal is said
 * in that language, a type mismatch with its two types (ErrorInSentence).
 * The reasons follow one another as joinReasons sets them.
 */
export const getLinkFailuresText: (data: {
  errors: ReadonlyArray<string>;
  total: number;
  translator: Translator;
}) => string = (data: {
  errors: ReadonlyArray<string>;
  total: number;
  translator: Translator;
}): string => {
  const reasons: Array<string> = Array.from(new Set(data.errors));

  return data.translator.translatePlural(
    LINK_FAILURES_TEMPLATE,
    data.errors.length,
    {
      total: data.translator.formatNumber(data.total),
      errors: composedValue((sentence: Translator): string => {
        return joinReasons(
          reasons.map((message: string): string => {
            return getErrorInSentenceText({
              message: message,
              translator: sentence,
            });
          }),
          sentence.language,
        );
      }),
    },
  );
};

/*
 * Why the one monitor asked for could not be linked. A failure nobody
 * explained is kept as it came, for the dialog to say why and what to do
 * next with its reference (ErrorExplanation). The server's refusal is said
 * in the reader's language, a type mismatch with the reader's words for
 * its two types, which the dialog's own lookup of a fixed sentence cannot
 * do.
 */
export const getLinkFailureText: (data: {
  error: string;
  translator: Translator;
}) => string = (data: { error: string; translator: Translator }): string => {
  if (readUnexplainedError(data.error)) {
    return data.error;
  }

  return getErrorInSentenceText({
    message: data.error,
    translator: data.translator,
  });
};
