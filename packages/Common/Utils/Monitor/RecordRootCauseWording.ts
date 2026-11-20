import { WordEvaluationSentenceOptions } from "../../Types/Monitor/EvaluationSentence";
import { Translator } from "../../Types/Translator";
import MonitorRootCauseWording, {
  RootCauseFinding,
} from "./MonitorRootCauseWording";
import { wordStatusChangeNote } from "./StatusChangeNotes";

/*
 * AN INCIDENT'S OR AN ALERT'S OWN ROOT CAUSE, IN THE READER'S LANGUAGE
 * (#10125).
 *
 * A record's root cause is what a person wrote, the Markdown a monitor's
 * criteria wrote, or one sentence OneUptime wrote when it opened the record
 * itself: a Sigma rule or a threat intel feed matched security events, a
 * Data Security check failed, an incoming request matched a grouping key,
 * an SLO's burn rate or error budget crossed its line, a network site
 * rolled up, what cost the most of a cloud budget's month, a workflow or a
 * chat paged people - and, on records from before e1318450be7, who opened
 * it. Those sentences are notes of the registry View Cause reads its state
 * changes by (StatusChangeNotes), defined once with how older rows wrote
 * them: read back by their English, said in the reader's language, each
 * value kept as written. So a record of last year reads worded too, with
 * nothing stored apart.
 *
 * The rest - a criteria's Markdown - is worded as before
 * (MonitorRootCauseWording): OneUptime's labels, its yes or no, the
 * findings the record's evaluation details hold as sentences. A root cause
 * a person wrote reads as they wrote it.
 *
 * The record's Root Cause page (MonitorRootCauseValue) and its What
 * happened card (EventWhatHappenedCard) word it here; View Cause words the
 * copy its first state holds the same way (StatusChangeCauseWording).
 */
export default class RecordRootCauseWording {
  public static wordRootCause(data: {
    rootCause: string;
    translator: Translator;
    // The record's evaluation details' findings, for a criteria's Markdown.
    findings?: ReadonlyArray<RootCauseFinding> | undefined;
    options?: WordEvaluationSentenceOptions | undefined;
    /*
     * Each value kept as stored set apart from the words OneUptime words
     * round it: for a root cause drawn on the page, and nothing else.
     */
    setsValuesApart?: boolean | undefined;
  }): string {
    const rootCause: string = data.rootCause || "";

    if (!rootCause.trim()) {
      return rootCause;
    }

    const note: string | null = wordStatusChangeNote(
      rootCause,
      data.translator,
    );

    if (note !== null) {
      return note;
    }

    return MonitorRootCauseWording.wordRootCause({
      rootCause: rootCause,
      translator: data.translator,
      findings: data.findings,
      options: data.options,
      setsValuesApart: data.setsValuesApart,
    });
  }
}
