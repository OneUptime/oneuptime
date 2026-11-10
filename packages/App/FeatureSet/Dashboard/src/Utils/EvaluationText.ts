import OneUptimeDate from "Common/Types/Date";
import {
  WordEvaluationSentenceOptions,
  wordStoredEvaluationText,
} from "Common/Types/Monitor/EvaluationSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * How the Dashboard words what a monitor's evaluation stored (issue #6542):
 * a sentence the engine wrote (EvaluationSentence) in the reader's
 * language, with its times in the reader's time zone; the English stored
 * beside it when there is no sentence, or the reader's language does not
 * word all of it yet.
 */
export const EVALUATION_TEXT_OPTIONS: WordEvaluationSentenceOptions = {
  writeTime: (date: Date): string => {
    return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
  },
};

export const wordEvaluationText: (
  translator: Translator,
  english: string,
  sentence: unknown,
) => string = (
  translator: Translator,
  english: string,
  sentence: unknown,
): string => {
  return wordStoredEvaluationText({
    english: english,
    sentence: sentence,
    translator: translator,
    options: EVALUATION_TEXT_OPTIONS,
  });
};
