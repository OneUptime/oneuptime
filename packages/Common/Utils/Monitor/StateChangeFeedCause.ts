import { WordEvaluationSentenceOptions } from "../../Types/Monitor/EvaluationSentence";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "../../Types/Translator";
import StatusChangeCauseWording from "./StatusChangeCauseWording";

/*
 * A STATE CHANGE'S CAUSE IN A FEED, IN THE READER'S LANGUAGE (#10126).
 *
 * When an incident's, an alert's, an episode's or a monitor's state changes,
 * its timeline service posts the change to the record's feed, with why it
 * changed as the entry's details - "Show details" unfolds them - written
 * once, in English Markdown, for the feed, Slack and Microsoft Teams alike:
 *
 *   **Cause:**
 *   <the change's root cause, as stored>
 *
 * (an episode's with a space after its label, a monitor's with its cause
 * indented under it). So a German or a Persian feed read "Cause: State
 * changed by episode state cascade." in English, under a change whose View
 * Cause said it in the reader's words.
 *
 * The feed keeps the English it always had - Slack and the emails read the
 * same Markdown - and the page words it as it is drawn: the label in the
 * reader's words, with the colon their language writes, and the cause as
 * View Cause says it (StatusChangeCauseWording): OneUptime's own notes
 * (StatusChangeNotes), the auto-resolve sentence, a criteria's labels.
 * A feed entry holds no check of its own, so a criteria's findings read as
 * the engine wrote them. Details of any other shape read as stored, and so
 * does a cause a person typed.
 */

// The label the timeline services write, and what may follow it on its line.
const CAUSE_LABEL: RegExp = /^\*\*Cause:\*\*[ \t]*\n/;

// A label and its colon, as the reader's language writes them (LabelWithColon).
const LABEL_WITH_COLON: string = translationKey("{{label}}:");

const CAUSE: string = translationKey("Cause");

/*
 * The cause a state change's feed details hold, as stored; null for details
 * of any other shape, or for a label with no cause after it.
 */
export function readStateChangeFeedCause(
  details: string | undefined,
): string | null {
  const text: string = details || "";
  const label: RegExpExecArray | null = CAUSE_LABEL.exec(text);

  if (!label) {
    return null;
  }

  // A monitor's cause is indented under its label: the indent is the template's.
  const cause: string = text.slice(label[0].length).replace(/^[ \t]+/, "");

  return cause.trim() ? cause : null;
}

/*
 * A feed entry's details as the page draws them: a state change's cause in
 * the reader's words, any other details as stored.
 */
export function wordStateChangeFeedDetails(data: {
  details: string | undefined;
  translator: Translator;
  options?: WordEvaluationSentenceOptions | undefined;
}): string {
  const details: string = data.details || "";
  const cause: string | null = readStateChangeFeedCause(details);

  if (cause === null) {
    return details;
  }

  const label: string = data.translator.translateTemplate(LABEL_WITH_COLON, {
    label: translatableTerm(CAUSE),
  });

  const worded: string = StatusChangeCauseWording.wordCause({
    rootCause: cause,
    translator: data.translator,
    options: data.options,
    setsValuesApart: true,
  });

  return `**${label}**\n${worded}`;
}
