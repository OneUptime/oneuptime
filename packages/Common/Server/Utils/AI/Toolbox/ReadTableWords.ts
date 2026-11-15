import {
  AI_READ_CARD_VALUES,
  AIActionFigure,
  AIActionMoment,
  AIActionSentence,
  AIActionSentenceValue,
  AIActionTableCell,
  aiActionFigure,
  aiActionMoment,
  aiActionPluralSentence,
  aiActionSentence,
  aiActionTerm,
  describeAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import {
  AI_READ_CITATION_PLURALS,
  AI_READ_WINDOW,
} from "../../../../Types/AI/AIReadTableWords";
import { PluralTemplate } from "../../../../Types/Translator";

/*
 * THE WORDS A READ'S TABLE AND ITS SOURCE CHIP SAY, BUILT FROM WHAT THE
 * TOOL READ (issues #7977, #7979 and #7980).
 *
 * Every read tool's table and chip says its title, its line, its worded
 * cells and its label as sentences of Types/AI/AIReadTableWords, which the
 * Dashboard says in the reader's language; the English of each is what
 * the table and the chip store, for the exports and the model. These are
 * the small pieces every tool builds them from: a count as a figure, a
 * window as two moments, Yes and No, and the chip's label and words
 * together, so the two can never say different things.
 *
 * Plain data in, words out - no reads - so the tools and their tests
 * build them the same way.
 */

// A count, written the reader's way ("1.234" in German, "۱۲" in Persian).
export function countFigure(count: number): AIActionFigure {
  return aiActionFigure(count);
}

/*
 * A window's ends, as two moments: "{{start}} – {{end}}" says their ISO
 * text in English, as every tool wrote its window, and the Dashboard
 * writes them in the reader's time.
 */
export function windowValues(
  start: Date,
  end: Date,
): { start: AIActionMoment; end: AIActionMoment } {
  return { start: aiActionMoment(start), end: aiActionMoment(end) };
}

// A window alone, as a table's line: "{{start}} – {{end}}".
export function windowSentence(start: Date, end: Date): AIActionSentence {
  return aiActionSentence(AI_READ_WINDOW, windowValues(start, end));
}

// Yes or No, as a read's card says a flag: a table's "Enabled" column.
export function yesOrNo(value: boolean): AIActionTableCell {
  return aiActionTerm(value ? AI_READ_CARD_VALUES.yes : AI_READ_CARD_VALUES.no);
}

/*
 * A source chip's label and its words, from one sentence: the label is the
 * sentence in English - what the chip stores, what the model reads in a
 * turn's history and what the exports print - and the Dashboard says the
 * words in the reader's language (CitationChips).
 */
export function citationOf(sentence: AIActionSentence): {
  citationLabel: string;
  citationWords: AIActionSentence;
} {
  return {
    citationLabel: describeAIActionSentence(sentence),
    citationWords: sentence,
  };
}

// A chip's label of one sentence and its values.
export function citationSentence(
  template: string,
  values?: Record<string, AIActionSentenceValue> | undefined,
): { citationLabel: string; citationWords: AIActionSentence } {
  return citationOf(aiActionSentence(template, values));
}

/*
 * A count said in words of its own inside a chip's label - "2 responders",
 * "1 entry" - as a sentence the reader's language words with its own
 * plural, put into the label as a list of one.
 */
export function countedValue(
  plural: PluralTemplate,
  count: number,
): AIActionSentenceValue {
  return { list: [aiActionPluralSentence(plural, count)] };
}

// How many people a policy or the project's schedules page now.
export function respondersValue(count: number): AIActionSentenceValue {
  return countedValue(AI_READ_CITATION_PLURALS.responders, count);
}

// How many entries a timeline read.
export function timelineEntriesValue(count: number): AIActionSentenceValue {
  return countedValue(AI_READ_CITATION_PLURALS.timelineEntries, count);
}
