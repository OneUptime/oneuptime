import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../Markdown/FeedMarkdown";
import {
  WordEvaluationSentenceOptions,
  wordStoredEvaluationText,
} from "../../Types/Monitor/EvaluationSentence";
import { translationKey, Translator } from "../../Types/Translator";
import {
  getRequestFailedPhaseText,
  PROBE_TIMEOUT_FAILURE_CAUSE,
  readProbeTimeoutFailureCause,
  writeProbeTimeoutFailureCause,
} from "./ProbeFailureReading";

/*
 * THE ROOT CAUSE A MONITOR WROTE, IN THE READER'S LANGUAGE (issue #6542).
 *
 * When a monitor's criteria opens an incident or an alert, the engine
 * writes its root cause once, in English Markdown, for everyone who reads
 * it - on the Dashboard, in email, in Slack and Teams:
 *
 *   **Created because the following criteria was met**:
 *
 *   **Criteria Name**: Website is down
 *
 *   **Filter Conditions Met**: Response Status Code was 503, at or above
 *   the 500 threshold.
 *
 *   **Request Details**
 *   - Request Method: GET
 *
 * The Dashboard shows it in the reader's language as far as it can: the
 * labels OneUptime writes - its own words, each a key the locale files word
 * - and each finding the incident's evaluation details hold as a sentence
 * (EvaluationSentence), worded as the evaluation log words it. The rest is
 * what the check found - a URL, a probe's error, a name - and reads as
 * written. A root cause somebody edited reads as they wrote it, but for a
 * line that is still OneUptime's own.
 *
 * Two of the check's values are OneUptime's own words too, and read in the
 * reader's language when the whole value is exactly them: the probe's
 * timeout sentence after **Cause** ("Request was tried 3 times and it
 * timed out.", ProbeFailureReading), and the phase after "- Failed Phase:"
 * (DNS Resolution, TLS Handshake).
 *
 * Line by line, and only a whole line, or a label at a line's start, is
 * ever replaced: nothing else in the text is read as one of OneUptime's.
 * A line that is replaced is written with mdText, as the engine wrote it:
 * OneUptime's words placed as text, the rest of the line as it was stored
 * (FeedAndChatPlainTextEscapedGuard holds the file to it).
 */

// A section heading or a label OneUptime writes in bold, at a line's start.
const BOLD_LABELS: ReadonlyArray<string> = [
  translationKey("Created because the following criteria was met"),
  translationKey("Criteria Name"),
  translationKey("Filter Conditions Met"),
  translationKey("Series"),
  translationKey("Cause"),
  translationKey("Request Details"),
  translationKey("Response Snapshot"),
  translationKey("Request Failed Details"),
  translationKey("Metric Details"),
  translationKey("Metric Summary"),
  translationKey("Breaching Samples"),
  translationKey("Forecast"),
  translationKey("Root Cause Analysis"),
  translationKey("Kubernetes Cluster Details"),
  translationKey("Docker Swarm Cluster Details"),
  translationKey("Proxmox Cluster Details"),
  translationKey("Ceph Cluster Details"),
  translationKey("OpenStack Cloud Details"),
  translationKey("Storage Array Details"),
];

// A fact OneUptime lists under a section: "- Request Method: GET".
const FACT_LABELS: ReadonlyArray<string> = [
  translationKey("Destination"),
  translationKey("Destination Port"),
  translationKey("Request Method"),
  translationKey("Response Status Code"),
  translationKey("Response Time"),
  translationKey("Timed Out"),
  translationKey("Attempts"),
  translationKey("Failed Phase"),
  translationKey("Error Code"),
  translationKey("Error Description"),
  translationKey("Raw Error Message"),
  translationKey("Synchronized"),
  translationKey("Stratum"),
  translationKey("Clock Offset"),
  translationKey("Leap Indicator"),
  translationKey("Reference"),
  translationKey("Root Dispersion"),
  translationKey("Server Address"),
  translationKey("Metric"),
  translationKey("Unit"),
  translationKey("Aggregation"),
  translationKey("Time Window"),
  translationKey("Filters"),
  translationKey("Grouped By"),
  translationKey("Formula"),
  translationKey("Alias"),
  translationKey("Trend"),
];

// A fact whose value is OneUptime's own yes or no.
const YES_NO_FACTS: ReadonlySet<string> = new Set<string>([
  "Timed Out",
  "Synchronized",
]);

const BOLD_LABEL_SET: ReadonlySet<string> = new Set<string>(BOLD_LABELS);
const FACT_LABEL_SET: ReadonlySet<string> = new Set<string>(FACT_LABELS);

// What an All criteria's root cause says before its findings.
const ALL_FILTERS_MET: string = translationKey("All filters met.");

const FILTER_CONDITIONS_MET: string = "Filter Conditions Met";

// "**Cause**: <why the check failed>" - the probe's failure cause.
const CAUSE: string = "Cause";

// "- Failed Phase: <the phase a request broke in>".
const FAILED_PHASE: string = "Failed Phase";

/*
 * "**Label**" or "**Label**: rest" - a label of at most 80 characters with
 * no asterisk or line break in it, so the match is linear in the line.
 */
const BOLD_LABEL_LINE: RegExp = /^\*\*([^*\n]{1,80})\*\*(:?)(.*)$/;

// "- Label: value", with a label of letters and spaces.
const FACT_LINE: RegExp = /^- ([A-Z][A-Za-z ]{0,40}): (.*)$/;

// One finding the root cause may quote: a filter's message and its sentence.
export interface RootCauseFinding {
  message: string;
  messageSentence?: unknown;
}

interface WordedFinding {
  // The finding as the evaluation stored it, and in the reader's language.
  english: string;
  worded: string;
}

// A finding as an Any criteria's root cause writes it after its label.
const asMarkdownText: (text: string) => MarkdownText = (
  text: string,
): MarkdownText => {
  return mdText`${text}`;
};

// A finding's whole line in an All criteria's list: "- finding".
const asListItem: (text: string) => MarkdownText = (
  text: string,
): MarkdownText => {
  return mdText`- ${text}`;
};

export default class MonitorRootCauseWording {
  public static wordRootCause(data: {
    rootCause: string;
    translator: Translator;
    findings?: ReadonlyArray<RootCauseFinding> | undefined;
    options?: WordEvaluationSentenceOptions | undefined;
  }): string {
    const translator: Translator = data.translator;

    if (!data.rootCause || translator.language === "en") {
      return data.rootCause;
    }

    const findings: Array<WordedFinding> =
      MonitorRootCauseWording.getWordedFindings({
        findings: data.findings || [],
        translator: translator,
        options: data.options,
      });

    /*
     * The worded finding the text is, written as `write` writes it: the
     * text is a finding when the English finding, written the same way, is
     * the text.
     */
    const findingAt: (
      text: string,
      write: (text: string) => MarkdownText,
    ) => MarkdownText | null = (
      text: string,
      write: (text: string) => MarkdownText,
    ): MarkdownText | null => {
      for (const finding of findings) {
        if (write(finding.english).toString() === text) {
          return write(finding.worded);
        }
      }

      return null;
    };

    return data.rootCause
      .split("\n")
      .map((line: string): string => {
        const boldLabel: RegExpExecArray | null = BOLD_LABEL_LINE.exec(line);

        if (boldLabel && BOLD_LABEL_SET.has(boldLabel[1]!)) {
          const label: string = boldLabel[1]!;
          const stored: string = boldLabel[3] || "";
          // What follows the label: as stored, unless this language words it.
          let rest: MarkdownText = FeedMarkdown.asMarkdown(stored);

          // "**Cause**: <the probe's timeout sentence>", worded with its count.
          if (label === CAUSE && stored.startsWith(" ")) {
            const worded: string | null =
              MonitorRootCauseWording.wordProbeTimeout(
                stored.slice(1),
                translator,
              );

            if (worded !== null) {
              rest = mdText` ${worded}`;
            }
          }

          // "**Filter Conditions Met**: <the finding, or All filters met.>"
          if (label === FILTER_CONDITIONS_MET && stored.startsWith(" ")) {
            const said: string = stored.slice(1);

            if (said === ALL_FILTERS_MET) {
              rest = mdText` ${MonitorRootCauseWording.word(ALL_FILTERS_MET, translator)}`;
            } else {
              const worded: MarkdownText | null = findingAt(
                said,
                asMarkdownText,
              );

              if (worded !== null) {
                rest = mdText` ${worded}`;
              }
            }
          }

          const wordedLabel: MarkdownText = MonitorRootCauseWording.boldLabel(
            label,
            translator,
          );

          return (
            boldLabel[2]
              ? mdText`${wordedLabel}:${rest}`
              : mdText`${wordedLabel}${rest}`
          ).toString();
        }

        const fact: RegExpExecArray | null = FACT_LINE.exec(line);

        if (fact && FACT_LABEL_SET.has(fact[1]!)) {
          const label: string = fact[1]!;
          const stored: string = fact[2] || "";
          /*
           * OneUptime's own yes or no, and the phase a request broke in, are
           * worded; any other value is as stored.
           */
          let value: MarkdownValue = FeedMarkdown.asMarkdown(stored);

          if (
            YES_NO_FACTS.has(label) &&
            (stored === "Yes" || stored === "No")
          ) {
            value = MonitorRootCauseWording.word(stored, translator);
          } else if (label === FAILED_PHASE) {
            value = MonitorRootCauseWording.wordFailedPhase(stored, translator);
          }

          return mdText`- ${MonitorRootCauseWording.word(label, translator)}: ${value}`.toString();
        }

        // "- <a finding>", under All filters met.
        if (line.startsWith("- ")) {
          const worded: MarkdownText | null = findingAt(line, asListItem);

          if (worded !== null) {
            return worded.toString();
          }
        }

        return line;
      })
      .join("\n");
  }

  private static boldLabel(
    label: string,
    translator: Translator,
  ): MarkdownText {
    return mdText`**${MonitorRootCauseWording.word(label, translator)}**`;
  }

  // One of OneUptime's words, in the reader's language when it words it.
  private static word(text: string, translator: Translator): string {
    return translator.translateText(text) || text;
  }

  /*
   * The probe's timeout sentence, as the engine placed it after **Cause**
   * (written with mdText, so compared written the same way), in the
   * reader's language with its count in the reader's digits. Null for any
   * other cause, and when the reader's language does not word it.
   */
  private static wordProbeTimeout(
    stored: string,
    translator: Translator,
  ): string | null {
    const triedCount: number | null = readProbeTimeoutFailureCause(stored);

    if (
      triedCount === null ||
      asMarkdownText(writeProbeTimeoutFailureCause(triedCount)).toString() !==
        stored ||
      !translator.hasTranslation(PROBE_TIMEOUT_FAILURE_CAUSE.other)
    ) {
      return null;
    }

    return translator.translatePlural(PROBE_TIMEOUT_FAILURE_CAUSE, triedCount);
  }

  /*
   * The phase a request broke in: a phase the probe names, in the reader's
   * word; any other value as stored.
   */
  private static wordFailedPhase(
    stored: string,
    translator: Translator,
  ): MarkdownValue {
    const phase: string = stored.trim();
    const worded: string = getRequestFailedPhaseText({
      translator: translator,
      failedPhase: phase,
    });

    return phase && worded !== phase ? worded : FeedMarkdown.asMarkdown(stored);
  }

  // Each finding with a sentence its reader's language words.
  private static getWordedFindings(data: {
    findings: ReadonlyArray<RootCauseFinding>;
    translator: Translator;
    options?: WordEvaluationSentenceOptions | undefined;
  }): Array<WordedFinding> {
    const worded: Array<WordedFinding> = [];

    for (const finding of data.findings) {
      if (!finding.message || finding.messageSentence === undefined) {
        continue;
      }

      const text: string = wordStoredEvaluationText({
        english: finding.message,
        sentence: finding.messageSentence,
        translator: data.translator,
        options: data.options,
      });

      if (text !== finding.message) {
        worded.push({ english: finding.message, worded: text });
      }
    }

    return worded;
  }
}
