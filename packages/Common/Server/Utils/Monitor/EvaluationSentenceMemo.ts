import {
  EvaluationSentence,
  englishOfEvaluationSentence,
} from "../../../Types/Monitor/EvaluationSentence";

/*
 * WHICH SENTENCE A FILTER'S FINDING WAS FILLED FROM (issue #6542).
 *
 * A criteria type answers whether its filter matched with the finding, as
 * text - "Response Status Code was 200, at or above the 200 threshold." -
 * which becomes a root cause line and the filter's message in the
 * evaluation summary. Some thirty checkers return that text, through
 * shared helpers (CompareCriteria) and a chain of calls that passes strings.
 * The helpers that fill a finding from a sentence (EvaluationSentence)
 * write it here: they return its English, as before, and remember the
 * sentence under that English. When the evaluator records the filter, it
 * looks the message up (find) and stores the sentence beside it, for the
 * Dashboard to word in each reader's language.
 *
 * The English is a function of the sentence, so whichever check wrote it,
 * the sentence found under it fills it the same way: a finding that is
 * found reads as stored, word for word, in English. A finding no helper
 * wrote as a sentence is not found, and is shown as stored.
 *
 * Bounded: the newest MAX_REMEMBERED findings, enough for every check one
 * process evaluates at a time many times over.
 */

const MAX_REMEMBERED: number = 2000;

// Map keeps insertion order: the first key is the oldest.
const remembered: Map<string, EvaluationSentence> = new Map<
  string,
  EvaluationSentence
>();

export default class EvaluationSentenceMemo {
  public static readonly MAX_REMEMBERED: number = MAX_REMEMBERED;

  // The sentence's English, remembered with the sentence it was filled from.
  public static write(sentence: EvaluationSentence): string {
    const english: string = englishOfEvaluationSentence(sentence);

    EvaluationSentenceMemo.remember(english, sentence);

    return english;
  }

  public static remember(english: string, sentence: EvaluationSentence): void {
    if (!english) {
      return;
    }

    // Moved to the newest end, so a finding seen on every check stays.
    remembered.delete(english);
    remembered.set(english, sentence);

    while (remembered.size > MAX_REMEMBERED) {
      const oldest: string | undefined = remembered.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      remembered.delete(oldest);
    }
  }

  // The sentence `english` was filled from, if a helper wrote it as one.
  public static find(
    english: string | null | undefined,
  ): EvaluationSentence | undefined {
    if (!english) {
      return undefined;
    }

    return remembered.get(english);
  }

  // For tests: forget every finding.
  public static clear(): void {
    remembered.clear();
  }

  public static size(): number {
    return remembered.size;
  }
}
