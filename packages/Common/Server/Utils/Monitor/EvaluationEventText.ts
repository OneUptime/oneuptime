import {
  EvaluationSentence,
  EvaluationSentenceValue,
  englishOfEvaluationSentence,
  evaluationTerm,
} from "../../../Types/Monitor/EvaluationSentence";
import { MonitorEvaluationEvent } from "../../../Types/Monitor/MonitorEvaluationSummary";
import { translationKey } from "../../../Types/Translator";
import EvaluationSentenceMemo from "./EvaluationSentenceMemo";

export type EvaluationEventTextFields = Pick<
  MonitorEvaluationEvent,
  "title" | "titleSentence" | "message" | "messageSentence"
>;

/*
 * An evaluation event's title and message, from the sentences they are
 * filled from (EvaluationSentence): the English of each as `title` and
 * `message`, as every event always stored them, and the sentences beside
 * them for the Dashboard to word in each reader's language.
 *
 * A message given as text is one the engine has no sentence for - a
 * suppression reason written in English, an error from elsewhere - and is
 * stored as it is, with the sentence it was written from when a checker
 * wrote it from one (EvaluationSentenceMemo).
 */
export default class EvaluationEventText {
  /*
   * A criteria as an event names it: its name, as the project wrote it, or
   * "Unnamed criteria" in the reader's words.
   */
  public static criteriaName(
    name: string | undefined | null,
  ): EvaluationSentenceValue {
    return name || evaluationTerm(translationKey("Unnamed criteria"));
  }

  public static from(data: {
    title: EvaluationSentence;
    message?: EvaluationSentence | string | undefined;
  }): EvaluationEventTextFields {
    const fields: EvaluationEventTextFields = {
      title: englishOfEvaluationSentence(data.title),
      titleSentence: data.title,
    };

    if (data.message === undefined) {
      return fields;
    }

    if (typeof data.message === "string") {
      fields.message = data.message;

      const sentence: EvaluationSentence | undefined =
        EvaluationSentenceMemo.find(data.message);

      if (sentence) {
        fields.messageSentence = sentence;
      }

      return fields;
    }

    fields.message = englishOfEvaluationSentence(data.message);
    fields.messageSentence = data.message;

    return fields;
  }
}
