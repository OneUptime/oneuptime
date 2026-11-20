import { WordEvaluationSentenceOptions } from "../../Types/Monitor/EvaluationSentence";
import { translationKey, Translator } from "../../Types/Translator";
import MonitorRootCauseWording, {
  RootCauseFinding,
} from "./MonitorRootCauseWording";
import { wordStatusChangeNote } from "./StatusChangeNotes";

/*
 * A STATUS OR STATE CHANGE'S ROOT CAUSE, AS VIEW CAUSE SHOWS IT, IN THE
 * READER'S LANGUAGE (#9752).
 *
 * A monitor's Status Timeline, and an incident's or an alert's State
 * Timeline, keep why each change happened: the root cause OneUptime wrote
 * once, in English Markdown. View Cause drew it as stored, so a German or a
 * Persian page read "Criteria Name", "Filter Conditions Met", "Response
 * Snapshot", a request's failed phase, the probe's timeout sentence and the
 * engine's figures in English, laid out from the left on a page read from
 * the right - while an incident's Root Cause page words the same Markdown
 * (MonitorRootCauseValue).
 *
 * This words it the same way, for every View Cause:
 *
 *   - one of OneUptime's own status- or state-change notes
 *     (StatusChangeNotes): a person, an incident or a maintenance event
 *     changed it, no criteria matched, monitoring went off or on - and, on
 *     an incident's, an alert's or an episode's State Timeline, its episode
 *     or a linked incident moved it, an SLO or a budget no longer holds it
 *     open, a fix closed it (#9959) - in the reader's words;
 *   - an incident's or an alert's auto-resolve, as the engine writes it
 *     before the criteria that resolved it: its sentence in the reader's
 *     words, then the criteria's Markdown, or OneUptime's own note on the
 *     same line (a series that recovered, a key reported resolved);
 *   - a criteria's Markdown, by MonitorRootCauseWording: OneUptime's labels,
 *     its yes or no, a failed phase, the timeout sentence and its figures.
 *     Each finding ("Response Status Code was 503, at or above the 500
 *     threshold.") is worded from the sentence the evaluation filled it
 *     from, which the change kept with its check (its statusChangeLog or
 *     stateChangeLog holds the check and its evaluation summary): so a
 *     change of last month reads in the reader's language too, never only
 *     the newest one.
 *
 * Anything else - a cause a person typed, a value the check found - reads
 * as written, set apart from the words round it (setsValuesApart) so a line
 * OneUptime words reads the way the reader's language does.
 */

/*
 * The sentence the engine puts before the criteria that resolved an
 * incident or an alert (MonitorIncident, MonitorAlert), by its English.
 */
export const INCIDENT_AUTO_RESOLVED: string = translationKey(
  "Incident autoresolved because autoresolve is set to true in monitor criteria.",
);
export const ALERT_AUTO_RESOLVED: string = translationKey(
  "Alert autoresolved because autoresolve is set to true in monitor criteria.",
);

const AUTO_RESOLVED_LINES: ReadonlyArray<string> = [
  INCIDENT_AUTO_RESOLVED,
  ALERT_AUTO_RESOLVED,
];

// A record's JSON as stored: only objects are walked.
type StoredJson = Record<string, unknown>;

function asObject(value: unknown): StoredJson | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StoredJson)
    : null;
}

function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

/*
 * The findings a change kept with its check - its evaluation summary's
 * filters, each message with the sentence it was filled from - for wording
 * its root cause. The check is user-shaped JSON through several versions,
 * so every level is read as possibly missing; nothing is found in a check
 * that has none (a person's change, an older record).
 */
export function getChangeLogFindings(
  changeLog: unknown,
): Array<RootCauseFinding> {
  const summary: StoredJson | null = asObject(
    asObject(changeLog)?.["evaluationSummary"],
  );

  if (!summary) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const findings: Array<RootCauseFinding> = [];

  for (const criteria of asArray(summary["criteriaResults"])) {
    for (const filter of asArray(asObject(criteria)?.["filters"])) {
      const result: StoredJson | null = asObject(filter);
      const message: unknown = result?.["message"];

      if (typeof message !== "string" || !message || seen.has(message)) {
        continue;
      }

      seen.add(message);
      findings.push({
        message: message,
        messageSentence: result?.["messageSentence"],
      });
    }
  }

  return findings;
}

export default class StatusChangeCauseWording {
  public static wordCause(data: {
    rootCause: string;
    translator: Translator;
    // The change's stored check (statusChangeLog, stateChangeLog), as read.
    changeLog?: unknown;
    options?: WordEvaluationSentenceOptions | undefined;
    /*
     * Each value kept as stored set apart from the label OneUptime words
     * before it: for a cause drawn on the page, and nothing else.
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

    const findings: Array<RootCauseFinding> = getChangeLogFindings(
      data.changeLog,
    );

    const wordCriteria: (text: string) => string = (text: string): string => {
      return MonitorRootCauseWording.wordRootCause({
        rootCause: text,
        translator: data.translator,
        findings: findings,
        options: data.options,
        setsValuesApart: data.setsValuesApart,
      });
    };

    /*
     * "Incident autoresolved because ... in monitor criteria. " on a line
     * of its own, the resolving criteria's Markdown under it.
     */
    const lineEnd: number = rootCause.indexOf("\n");
    const firstLine: string = (
      lineEnd === -1 ? rootCause : rootCause.slice(0, lineEnd)
    ).trim();

    if (AUTO_RESOLVED_LINES.includes(firstLine)) {
      const sentence: string =
        data.translator.translateText(firstLine) || firstLine;

      return lineEnd === -1
        ? sentence
        : `${sentence}\n${wordCriteria(rootCause.slice(lineEnd + 1))}`;
    }

    /*
     * ...or on the same line as why the record resolved, when OneUptime
     * said why itself: a series that no longer satisfies its criteria, a
     * key an incoming request reported resolved (#9959).
     */
    for (const autoResolved of AUTO_RESOLVED_LINES) {
      if (!firstLine.startsWith(`${autoResolved} `)) {
        continue;
      }

      const sentence: string =
        data.translator.translateText(autoResolved) || autoResolved;
      const why: string = rootCause
        .slice(rootCause.indexOf(autoResolved) + autoResolved.length)
        .trim();

      return `${sentence} ${
        wordStatusChangeNote(why, data.translator) ?? wordCriteria(why)
      }`;
    }

    return wordCriteria(rootCause);
  }
}
