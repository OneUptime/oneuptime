import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../Markdown/FeedMarkdown";
import {
  WordEvaluationSentenceOptions,
  wordStoredEvaluationText,
} from "../../Types/Monitor/EvaluationSentence";
import {
  getReadingDirection,
  LEFT_TO_RIGHT,
  ReadingDirection,
  setApartInSentence,
} from "../../Types/ReadingDirection";
import { translationKey, Translator } from "../../Types/Translator";
import {
  getRequestFailedPhaseText,
  PROBE_TIMEOUT_FAILURE_CAUSE,
  readProbeTimeoutFailureCause,
  writeProbeTimeoutFailureCause,
} from "./ProbeFailureReading";
import {
  readProbeFailureCause,
  wordProbeFailureCause,
} from "./ProbeFailureCauses";
import {
  getRequestFailureDescriptionText,
  readRequestFailureDescription,
} from "./RequestFailureDescriptions";
import { wordForecastLine, wordRootCauseFact } from "./RootCauseFacts";

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
 * Three of the check's values are OneUptime's own words too, and read in
 * the reader's language when the whole value is exactly them: the probe's
 * timeout sentence after **Cause** ("Request was tried 3 times and it
 * timed out.", ProbeFailureReading), the phase after "- Failed Phase:"
 * (DNS Resolution, TLS Handshake), and what the failed request means after
 * "- Error Description:" ("DNS resolution failed. ...",
 * RequestFailureDescriptions). So do the probe's causes with values after
 * **Cause** ("No NTP reply from ... within 5 seconds. Tried 3 times.",
 * ProbeFailureCauses, #8267), their values as the probe found them; and
 * the figures the engine writes from a number - a response time, a count
 * of attempts, an NTP server's stratum, offset, dispersion and leap
 * indicator - read in the reader's digits and units (RootCauseFacts,
 * #8268). A status code is a code, and stays as written.
 *
 * On a page read from the right, a line OneUptime words is its words with
 * a stored value after them - "**نام معیار**: Website is down", "- کد
 * خطا: ETIMEDOUT" - and the value usually has more letters than the
 * label. The viewer lays each block out the way most of its letters read
 * (MarkdownReadingDirection), so the line was laid out from the left, its
 * label's colon and its bullet on the wrong side, and the card turned
 * from side to side line by line. Drawn on the page (setsValuesApart),
 * each value kept as stored is set apart from the label in an isolate
 * (FSI ... PDI) where it could move the words round it, as a sentence's
 * values are (SentenceOptions.setsValuesApart): the line reads the way its
 * label does, the value as written inside it, its full stop at its own
 * end. A root cause somebody typed has no line of OneUptime's, and reads
 * the way its own words do.
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
  translationKey("XCP-ng Pool Details"),
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
  translationKey("Data Arrives"),
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

// "- Error Description: <what the failed request means>".
const ERROR_DESCRIPTION: string = "Error Description";

/*
 * A backslash before ASCII punctuation: how mdText escapes a value's
 * Markdown (FeedMarkdown). Read back to the value's text, which is only
 * trusted when mdText writes it back to the very line.
 */
const MARKDOWN_ESCAPE: RegExp = /\\([!-/:-@[-`{-~])/g;

/*
 * "**Label**" or "**Label**: rest" - a label of at most 80 characters with
 * no asterisk or line break in it, so the match is linear in the line.
 */
const BOLD_LABEL_LINE: RegExp = /^\*\*([^*\n]{1,80})\*\*(:?)(.*)$/;

// "- Label: value", with a label of letters and spaces.
const FACT_LINE: RegExp = /^- ([A-Z][A-Za-z ]{0,40}): (.*)$/;

/*
 * A forecast's line whose label holds a number or a comma: its value in
 * bold ("- In 7 days: **91.5%**"), or what reaching the threshold takes
 * ("- Reaches 90%: in about 5 days"). Each part bounded, so the match is
 * linear in the line.
 */
const FORECAST_BOLD_LINE: RegExp =
  /^- (Now, on its trend|In [0-9]{1,9} (?:hours?|days?)): \*\*(.{1,80})\*\*$/;
const FORECAST_REACHES_LINE: RegExp =
  /^- (Reaches [^:\n]{1,80}): (in about [^:\n]{1,40}|already (?:above|below) it)$/;

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
    /*
     * Each value kept as stored set apart from the label OneUptime words
     * before it, where it could move the words round it. Only for a root
     * cause drawn on the page and nothing else: the isolate's marks are
     * characters.
     */
    setsValuesApart?: boolean | undefined;
  }): string {
    const translator: Translator = data.translator;

    if (!data.rootCause || translator.language === "en") {
      return data.rootCause;
    }

    const setsValuesApart: boolean = Boolean(data.setsValuesApart);
    const readerDirection: ReadingDirection = getReadingDirection(
      translator.language,
    );

    /*
     * A stored value after `label`, set apart (when asked) by the way the
     * line reads: the reader's, once their language words the label;
     * English's while it does not.
     */
    const storedValue: (label: string, stored: string) => MarkdownText = (
      label: string,
      stored: string,
    ): MarkdownText => {
      if (!setsValuesApart) {
        return FeedMarkdown.asMarkdown(stored);
      }

      return FeedMarkdown.asMarkdown(
        MonitorRootCauseWording.setApart(
          stored,
          translator.hasTranslation(label) ? readerDirection : LEFT_TO_RIGHT,
        ),
      );
    };

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
          let rest: MarkdownText = storedValue(label, stored);

          /*
           * "**Cause**: <the probe's timeout sentence>", worded with its
           * count, or one of its causes with values, its values as found.
           */
          if (label === CAUSE && stored.startsWith(" ")) {
            const worded: string | null =
              MonitorRootCauseWording.wordProbeTimeout(
                stored.slice(1),
                translator,
              ) ??
              MonitorRootCauseWording.wordFailureCause({
                line: line,
                stored: stored.slice(1),
                translator: translator,
                setsValuesApart: setsValuesApart,
              });

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

        // A forecast's line whose label holds a number: "- In 7 days: **93.2%**".
        const forecastLine: string | null =
          MonitorRootCauseWording.wordForecastLine({
            line: line,
            translator: translator,
            setsValuesApart: setsValuesApart,
          });

        if (forecastLine !== null) {
          return forecastLine;
        }

        const fact: RegExpExecArray | null = FACT_LINE.exec(line);

        if (fact && FACT_LABEL_SET.has(fact[1]!)) {
          const label: string = fact[1]!;
          const stored: string = fact[2] || "";
          /*
           * OneUptime's own yes or no, the phase a request broke in and what
           * the failed request means are worded; any other value is as
           * stored.
           */
          let value: MarkdownValue = storedValue(label, stored);

          if (
            YES_NO_FACTS.has(label) &&
            (stored === "Yes" || stored === "No")
          ) {
            value = MonitorRootCauseWording.word(stored, translator);
          } else if (label === FAILED_PHASE) {
            value =
              MonitorRootCauseWording.wordFailedPhase(stored, translator) ??
              value;
          } else if (label === ERROR_DESCRIPTION) {
            value =
              MonitorRootCauseWording.wordErrorDescription({
                line: line,
                stored: stored,
                translator: translator,
                setsValuesApart: setsValuesApart,
              }) || value;
          } else {
            // A figure the engine wrote from a number, in the reader's digits.
            value =
              MonitorRootCauseWording.wordFigure({
                line: line,
                label: label,
                stored: stored,
                translator: translator,
                setsValuesApart: setsValuesApart,
              }) ?? value;
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
   * One of the probe's causes with values (ProbeFailureCauses), as the
   * engine placed it after **Cause** (written with mdText): in the reader's
   * language, its values as the probe found them - set apart from the
   * reader's words when asked. Null for any other cause, and when the
   * reader's language does not word it.
   *
   * The stored cause is Markdown: it is read back to its text, which is
   * only taken for the cause when mdText writes it back to the very line
   * the engine stored.
   */
  private static wordFailureCause(data: {
    line: string;
    stored: string;
    translator: Translator;
    setsValuesApart: boolean;
  }): string | null {
    const text: string = data.stored.replace(MARKDOWN_ESCAPE, "$1");

    if (
      !readProbeFailureCause(text) ||
      mdText`**${CAUSE}**: ${text}`.toString() !== data.line
    ) {
      return null;
    }

    return wordProbeFailureCause({
      translator: data.translator,
      failureCause: text,
      options: { setsValuesApart: data.setsValuesApart },
    });
  }

  /*
   * A figure under a fact OneUptime lists - a response time, a count of
   * attempts, an NTP server's stratum, clock offset, root dispersion or
   * leap indicator - in the reader's digits and units, when the engine
   * wrote exactly that figure (RootCauseFacts). Null for any other value,
   * which stays as stored.
   *
   * Read back from the stored Markdown as the Error Description is: only
   * when mdText writes the text back to the very line the engine stored.
   */
  private static wordFigure(data: {
    line: string;
    label: string;
    stored: string;
    translator: Translator;
    setsValuesApart: boolean;
  }): string | null {
    const text: string = data.stored.replace(MARKDOWN_ESCAPE, "$1");

    if (mdText`- ${data.label}: ${text}`.toString() !== data.line) {
      return null;
    }

    return wordRootCauseFact({
      label: data.label,
      value: text,
      translator: data.translator,
      options: { setsValuesApart: data.setsValuesApart },
    });
  }

  /*
   * A forecast's line whose label holds a number or a comma, as the engine
   * writes it (MonitorCriteriaEvaluator.formatForecastSection):
   *
   *   - Now, on its trend: **84.5%**
   *   - In 7 days: **91.5%**
   *   - Reaches 90%: in about 5 days
   *   - Reaches 90%: already above it
   *
   * in the reader's words, the metric's values as written (RootCauseFacts).
   * Read back from the stored Markdown, and only taken for the engine's
   * when mdText writes it back to the very line. Null for any other line.
   */
  private static wordForecastLine(data: {
    line: string;
    translator: Translator;
    setsValuesApart: boolean;
  }): string | null {
    const line: string = data.line;
    const bold: RegExpExecArray | null = FORECAST_BOLD_LINE.exec(line);
    const reaches: RegExpExecArray | null = bold
      ? null
      : FORECAST_REACHES_LINE.exec(line);

    if (!bold && !reaches) {
      return null;
    }

    const label: string = (bold ? bold[1] : reaches![1]) as string;
    const value: string = ((bold ? bold[2] : reaches![2]) as string).replace(
      MARKDOWN_ESCAPE,
      "$1",
    );
    const labelText: string = label.replace(MARKDOWN_ESCAPE, "$1");
    const writtenBack: string = bold
      ? mdText`- ${labelText}: **${value}**`.toString()
      : mdText`- ${labelText}: ${value}`.toString();

    if (writtenBack !== line) {
      return null;
    }

    const worded: { label: string; value: string } | null = wordForecastLine({
      label: labelText,
      value: value,
      translator: data.translator,
      options: { setsValuesApart: data.setsValuesApart },
    });

    if (!worded) {
      return null;
    }

    return bold
      ? mdText`- ${worded.label}: **${worded.value}**`.toString()
      : mdText`- ${worded.label}: ${worded.value}`.toString();
  }

  /*
   * The phase a request broke in: a phase the probe names, in the reader's
   * word; null for any other value, which stays as stored.
   */
  private static wordFailedPhase(
    stored: string,
    translator: Translator,
  ): string | null {
    const phase: string = stored.trim();
    const worded: string = getRequestFailedPhaseText({
      translator: translator,
      failedPhase: phase,
    });

    return phase && worded !== phase ? worded : null;
  }

  /*
   * What the failed request means, as the engine placed it after "- Error
   * Description:" (written with mdText): one of OneUptime's explanations
   * (RequestFailureDescriptions) in the reader's language, the message
   * that came with it kept as written - set apart from the reader's words
   * when asked. Null for any other value, and when the reader's language
   * does not word the explanation.
   *
   * The stored value is Markdown: it is read back to its text, which is
   * only taken for the explanation when mdText writes it back to the very
   * line the engine stored.
   */
  private static wordErrorDescription(data: {
    line: string;
    stored: string;
    translator: Translator;
    setsValuesApart: boolean;
  }): string | null {
    const text: string = data.stored.replace(MARKDOWN_ESCAPE, "$1");

    if (
      !readRequestFailureDescription(text) ||
      mdText`- ${ERROR_DESCRIPTION}: ${text}`.toString() !== data.line
    ) {
      return null;
    }

    const worded: string = getRequestFailureDescriptionText({
      translator: data.translator,
      description: text,
      options: { setsValuesApart: data.setsValuesApart },
    });

    return worded === text.trim() ? null : worded;
  }

  /*
   * A stored value set apart from the line it is in (setApartInSentence),
   * the space round it left outside the isolate: a value of the line's own
   * script, or with no letter or digit, is left as it is.
   */
  private static setApart(
    stored: string,
    lineDirection: ReadingDirection,
  ): string {
    const value: string = stored.trim();

    if (!value) {
      return stored;
    }

    const start: number = stored.length - stored.trimStart().length;

    return `${stored.slice(0, start)}${setApartInSentence(value, lineDirection)}${stored.slice(start + value.length)}`;
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
