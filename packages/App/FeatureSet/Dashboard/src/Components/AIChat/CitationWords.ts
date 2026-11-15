import {
  describeAIActionSentence,
  isKnownAIActionSentence,
} from "Common/Types/AI/AIActionWords";
import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
import { Translator } from "Common/Types/Translator";
import { drawReadSentence } from "./TableWords";
import { DrawnActionSentence } from "./ToolActionWords";

/*
 * A SOURCE CHIP UNDER AN ANSWER, IN THE READER'S LANGUAGE (issue #7980).
 *
 * Every Ask AI answer that read something lists its sources as chips: a
 * number, an icon, a label and how many rows it found. The label was the
 * English the server wrote - "Monitors (4 found)", "Logs 2026-09-14T17:49
 * ... (25 shown)" - under a table that, since #7394, said "Monitore (4)" on
 * a German page. A citation carries its label as a sentence of
 * Common/Types/AI/AIActionWords now (citation.words), beside the English it
 * stores, which the model reads in a turn's history and the exports print.
 *
 * The chip says the words in the reader's language - a count written the
 * reader's way, a window in the reader's time - only when they say in
 * English what the label stores: a citation saved before it had words, and
 * words that are not the module's, read as the stored label. React-free,
 * so the chip and its tests read the same rules.
 */

// The label as the chip draws it: worded, or null for the stored label.
export function getDrawnCitationLabel(
  citation: AIChatCitation,
  translator: Translator,
): DrawnActionSentence | null {
  const words: unknown = citation.words;

  if (
    !isKnownAIActionSentence(words) ||
    describeAIActionSentence(words) !== citation.label
  ) {
    return null;
  }

  return drawReadSentence(words, translator);
}

// The label's text in the reader's language, or as stored.
export function getCitationLabelText(
  citation: AIChatCitation,
  translator: Translator,
): string {
  return getDrawnCitationLabel(citation, translator)?.text ?? citation.label;
}

// How many rows the read found, in the reader's digits ("۴" in Persian).
export function getCitationRowCountText(
  citation: AIChatCitation,
  translator: Translator,
): string {
  return translator.formatNumber(citation.rowCount);
}
