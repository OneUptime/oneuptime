import { mdText } from "../Markdown/FeedMarkdown";
import {
  WordEvaluationSentenceOptions,
  wordStoredEvaluationText,
} from "../../Types/Monitor/EvaluationSentence";
import { translationKey, Translator } from "../../Types/Translator";

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
 * Line by line, and only a whole line, or a label at a line's start, is
 * ever replaced: nothing else in the text is read as one of OneUptime's.
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
  // The finding as the root cause has it: escaped as Markdown text.
  english: string;
  worded: string;
}

const asMarkdownText: (text: string) => string = (text: string): string => {
  return mdText`${text}`.toString();
};

// A finding as an All criteria's list has it ("\n- finding"), without the "- ".
const asListItemText: (text: string) => string = (text: string): string => {
  return mdText`\n- ${text}`.toString().replace(/^\n- /, "");
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

    const findingAt: (
      text: string,
      escape: (text: string) => string,
    ) => string | null = (
      text: string,
      escape: (text: string) => string,
    ): string | null => {
      for (const finding of findings) {
        if (escape(finding.english) === text) {
          return escape(finding.worded);
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
          let rest: string = boldLabel[3] || "";

          // "**Filter Conditions Met**: <the finding, or All filters met.>"
          if (label === FILTER_CONDITIONS_MET && rest.startsWith(" ")) {
            const said: string = rest.slice(1);

            if (said === ALL_FILTERS_MET) {
              rest = ` ${MonitorRootCauseWording.word(ALL_FILTERS_MET, translator)}`;
            } else {
              const worded: string | null = findingAt(said, asMarkdownText);

              if (worded !== null) {
                rest = ` ${worded}`;
              }
            }
          }

          return `${MonitorRootCauseWording.boldLabel(label, translator)}${boldLabel[2]}${rest}`;
        }

        const fact: RegExpExecArray | null = FACT_LINE.exec(line);

        if (fact && FACT_LABEL_SET.has(fact[1]!)) {
          const label: string = fact[1]!;
          let value: string = fact[2] || "";

          if (YES_NO_FACTS.has(label) && (value === "Yes" || value === "No")) {
            value = MonitorRootCauseWording.word(value, translator);
          }

          return `- ${asMarkdownText(MonitorRootCauseWording.word(label, translator))}: ${value}`;
        }

        // "- <a finding>", under All filters met.
        if (line.startsWith("- ")) {
          const worded: string | null = findingAt(
            line.slice(2),
            asListItemText,
          );

          if (worded !== null) {
            return `- ${worded}`;
          }
        }

        return line;
      })
      .join("\n");
  }

  private static boldLabel(label: string, translator: Translator): string {
    return `**${asMarkdownText(MonitorRootCauseWording.word(label, translator))}**`;
  }

  // One of OneUptime's words, in the reader's language when it words it.
  private static word(text: string, translator: Translator): string {
    return translator.translateText(text) || text;
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
