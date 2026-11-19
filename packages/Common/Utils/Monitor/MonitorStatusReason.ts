import {
  WordEvaluationSentenceOptions,
  wordStoredEvaluationText,
} from "../../Types/Monitor/EvaluationSentence";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationFilterResult,
} from "../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import { translationKey, Translator } from "../../Types/Translator";
import FeedMarkdown, { mdText } from "../Markdown/FeedMarkdown";
import { RootCauseFinding } from "./MonitorRootCauseWording";
import {
  MonitorEvaluationByProbe,
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "./MonitorOverviewProbeUtil";
import {
  getProbeFailureCauseText,
  getRequestFailedPhaseText,
} from "./ProbeFailureReading";
import { getRequestFailureDescriptionText } from "./RequestFailureDescriptions";
import { wordRootCauseFact } from "./RootCauseFacts";

/*
 * WHY A MONITOR IS IN ITS STATUS, IN A FEW LINES (#9592).
 *
 * A monitor's hero said "Offline for 3h" and nothing about why. The reason
 * was written down when the status changed - the status event's root cause,
 * the Markdown the engine writes once for the Status Timeline's View Cause,
 * an incident and its emails:
 *
 *   **Created because the following criteria was met**:
 *
 *   **Criteria Name**: Website is down
 *
 *   **Filter Conditions Met**: Response Status Code was 503, at or above the
 *   500 threshold.
 *
 *   **Response Snapshot**
 *   - Response Status Code: 503
 *   - Response Time: 411.0 ms
 *
 *   **Cause**: Server returned 503
 *
 * This reads it back into what the hero and the dialog behind its status
 * show: the criteria that matched, as the project named it; what its
 * filters found, each a sentence in the reader's language where the
 * evaluation stored the sentence it was filled from (the findings handed
 * in, as an incident's root cause words them: MonitorRootCauseWording);
 * the probe's cause, in the reader's words where OneUptime wrote it
 * (ProbeFailureReading); and what the check saw - its status code, response
 * time, attempts, error - each value in the reader's digits and words where
 * the engine wrote it from a number (RootCauseFacts). Only lines OneUptime
 * writes, by their English labels, are read; anything else is left out,
 * and a root cause that names no criteria - a person changed the status,
 * an incident or a maintenance event did - is its note, read as plain
 * words, OneUptime's own sentences among them in the reader's language.
 *
 * Which probes see the monitor so is a second question, answered from each
 * probe's newest evaluation (getProbesBehindStatus).
 *
 * React-free, so the Dashboard's tests and Common's read it the same way.
 */

export interface MonitorStatusReasonFact {
  // The engine's English label ("Response Status Code"), looked up where drawn.
  label: string;
  // Its value as plain words: the reader's digits and words where OneUptime's.
  value: string;
}

export interface MonitorStatusReason {
  // The criteria whose match set the status, as the project named it.
  criteriaName?: string | undefined;
  /*
   * What its filters found, in order, each one sentence: one for an Any
   * criteria, each filter's for an All one.
   */
  findings: Array<string>;
  // Why the probe's check failed, in the probe's words (OneUptime's worded).
  cause?: string | undefined;
  // What the check saw, most telling first, at most REASON_FACTS_SHOWN.
  facts: Array<MonitorStatusReasonFact>;
  /*
   * A root cause no criteria wrote - a person set the status, an incident
   * or a maintenance event changed it: its words, its Markdown read as
   * plain text, OneUptime's own sentence in the reader's language.
   */
  note?: string | undefined;
}

// The labels the engine writes, by their English (MonitorCriteriaEvaluator).
const CREATED_BECAUSE: string =
  "Created because the following criteria was met";
const CRITERIA_NAME: string = "Criteria Name";
const FILTER_CONDITIONS_MET: string = "Filter Conditions Met";
const CAUSE: string = "Cause";
const ALL_FILTERS_MET: string = "All filters met.";

/*
 * What the check saw, in the order the engine lists it. The facts that only
 * name what was checked - the destination, its port, the method, a server's
 * address - are left out: the hero names the monitor's target already.
 */
const SHOWN_FACT_LABELS: ReadonlySet<string> = new Set<string>([
  "Response Status Code",
  "Response Time",
  "Timed Out",
  "Attempts",
  "Failed Phase",
  "Error Code",
  "Error Description",
  "Raw Error Message",
  "Synchronized",
  "Stratum",
  "Clock Offset",
  "Root Dispersion",
  "Leap Indicator",
  "Metric",
  "Aggregation",
  "Time Window",
  "Data Arrives",
  "Grouped By",
]);

// A fact whose value is OneUptime's own yes or no.
const YES_NO_FACTS: ReadonlySet<string> = new Set<string>([
  "Timed Out",
  "Synchronized",
]);

// How many facts a reason lists: the dialog's row keeps to a few lines.
export const REASON_FACTS_SHOWN: number = 6;

/*
 * The sentences OneUptime itself writes as a status event's root cause when
 * no criteria changed the status, by their English as stored, and in the
 * reader's words (each a key).
 */
export const STATUS_CHANGED_BY_USER: string = translationKey(
  "Changed by {{user}}",
);
export const STATUS_CHANGED_BY_NEW_INCIDENT: string = translationKey(
  "Changed because incident {{incident}} was created.",
);
export const STATUS_CHANGED_BY_UPDATED_INCIDENT: string = translationKey(
  "Changed because incident {{incident}} was updated.",
);
export const STATUS_CHANGED_BY_MAINTENANCE: string = translationKey(
  "Changed by a maintenance event.",
);

// "**Label**" or "**Label**: rest" (MonitorRootCauseWording's own reading).
const BOLD_LABEL_LINE: RegExp = /^\*\*([^*\n]{1,80})\*\*(:?)(.*)$/;

// "- Label: value", with a label of letters and spaces.
const FACT_LINE: RegExp = /^- ([A-Z][A-Za-z ]{0,40}): (.*)$/;

// A backslash before ASCII punctuation: how mdText escapes a value.
const MARKDOWN_ESCAPE: RegExp = /\\([!-/:-@[-`{-~])/g;

// "[words](address)": a link, read as its words. Bounded, so linear.
const MARKDOWN_LINK: RegExp = /\[([^\]\n]{0,500})\]\([^()\s]{0,2000}\)/g;

// "**words**" and "`code`": emphasis, read as its words.
const MARKDOWN_BOLD: RegExp = /\*\*([^*\n]{1,500})\*\*/g;
const MARKDOWN_CODE: RegExp = /`([^`\n]{1,500})`/g;

const MANUAL_CHANGE: RegExp = /^Monitor status created by (.{1,500})$/;
const NEW_INCIDENT: RegExp =
  /^Status was changed because Incident (.{1,200}) was created\.$/;
const UPDATED_INCIDENT: RegExp =
  /^Status was changed because Incident (.{1,200}) was updated\.$/;
const MAINTENANCE_CHANGE: RegExp =
  /^Changed because of maintenance event: (.{1,200})$/;

/*
 * Markdown as the words it shows: a link as its words, emphasis and code
 * marks dropped, escapes undone, space runs and line breaks one space.
 */
export const readMarkdownAsPlainText: (markdown: string) => string = (
  markdown: string,
): string => {
  return FeedMarkdown.withoutInvisibleBreaks(
    markdown
      .replace(MARKDOWN_LINK, "$1")
      .replace(MARKDOWN_BOLD, "$1")
      .replace(MARKDOWN_CODE, "$1")
      .replace(MARKDOWN_ESCAPE, "$1"),
  )
    .replace(/\s+/g, " ")
    .trim();
};

/*
 * A stored value as its text: escapes undone, and the invisible joiner
 * mdText may leave between a backslash and a value dropped.
 */
const readValue: (stored: string) => string = (stored: string): string => {
  return FeedMarkdown.withoutInvisibleBreaks(
    stored.replace(MARKDOWN_ESCAPE, "$1"),
  );
};

/*
 * A finding in the reader's language: the evaluation's own sentence for it
 * when one of the findings handed in is it - written as the engine placed
 * it (`write`: after the label, or as an item of All's list), which is how
 * MonitorRootCauseWording tells a finding - else as stored, as its text.
 */
const wordFinding: (data: {
  stored: string;
  write: (text: string) => string;
  findings: ReadonlyArray<RootCauseFinding>;
  translator: Translator;
  options?: WordEvaluationSentenceOptions | undefined;
}) => string = (data: {
  stored: string;
  write: (text: string) => string;
  findings: ReadonlyArray<RootCauseFinding>;
  translator: Translator;
  options?: WordEvaluationSentenceOptions | undefined;
}): string => {
  for (const finding of data.findings) {
    if (!finding.message) {
      continue;
    }

    if (data.write(finding.message) === data.stored) {
      return wordStoredEvaluationText({
        english: finding.message,
        sentence: finding.messageSentence,
        translator: data.translator,
        options: data.options,
      });
    }
  }

  // As stored: a listed finding's own words, without its list's mark.
  const stored: string = data.stored.startsWith("- ")
    ? data.stored.slice(2)
    : data.stored;

  return readValue(stored).trim();
};

// A finding as an Any criteria's root cause writes it after its label.
const writeFinding: (text: string) => string = (text: string): string => {
  return mdText`${text}`.toString();
};

// A finding's whole line in an All criteria's list: "- finding".
const writeListedFinding: (text: string) => string = (text: string): string => {
  return mdText`- ${text}`.toString();
};

// A fact's value in the reader's words where OneUptime wrote it.
const wordFactValue: (data: {
  label: string;
  value: string;
  translator: Translator;
}) => string = (data: {
  label: string;
  value: string;
  translator: Translator;
}): string => {
  const translator: Translator = data.translator;

  if (
    YES_NO_FACTS.has(data.label) &&
    (data.value === "Yes" || data.value === "No")
  ) {
    return translator.translateText(data.value) || data.value;
  }

  if (data.label === "Failed Phase") {
    return getRequestFailedPhaseText({
      translator: translator,
      failedPhase: data.value,
    });
  }

  if (data.label === "Error Description") {
    return getRequestFailureDescriptionText({
      translator: translator,
      description: data.value,
    });
  }

  return (
    wordRootCauseFact({
      label: data.label,
      value: data.value,
      translator: translator,
    }) ?? data.value
  );
};

// One of OneUptime's own notes, in the reader's words; null for any other.
const wordNote: (text: string, translator: Translator) => string | null = (
  text: string,
  translator: Translator,
): string | null => {
  const manual: RegExpExecArray | null = MANUAL_CHANGE.exec(text);

  if (manual) {
    return translator.translateTemplate(
      STATUS_CHANGED_BY_USER,
      { user: manual[1] as string },
      { setsValuesApart: true },
    );
  }

  const created: RegExpExecArray | null = NEW_INCIDENT.exec(text);

  if (created) {
    return translator.translateTemplate(
      STATUS_CHANGED_BY_NEW_INCIDENT,
      { incident: created[1] as string },
      { setsValuesApart: true },
    );
  }

  const updated: RegExpExecArray | null = UPDATED_INCIDENT.exec(text);

  if (updated) {
    return translator.translateTemplate(
      STATUS_CHANGED_BY_UPDATED_INCIDENT,
      { incident: updated[1] as string },
      { setsValuesApart: true },
    );
  }

  if (MAINTENANCE_CHANGE.test(text)) {
    return (
      translator.translateText(STATUS_CHANGED_BY_MAINTENANCE) ||
      STATUS_CHANGED_BY_MAINTENANCE
    );
  }

  return null;
};

export const readMonitorStatusReason: (data: {
  rootCause: string | null | undefined;
  translator: Translator;
  /*
   * The findings of the monitor's newest evaluations, with the sentences
   * they were filled from: a stored finding that is one of them is worded.
   */
  findings?: ReadonlyArray<RootCauseFinding> | undefined;
  options?: WordEvaluationSentenceOptions | undefined;
}) => MonitorStatusReason | null = (data: {
  rootCause: string | null | undefined;
  translator: Translator;
  findings?: ReadonlyArray<RootCauseFinding> | undefined;
  options?: WordEvaluationSentenceOptions | undefined;
}): MonitorStatusReason | null => {
  const rootCause: string =
    typeof data.rootCause === "string" ? data.rootCause.trim() : "";

  if (!rootCause) {
    return null;
  }

  const translator: Translator = data.translator;
  const findings: ReadonlyArray<RootCauseFinding> = data.findings || [];
  const reason: MonitorStatusReason = { findings: [], facts: [] };

  let isCriteria: boolean = false;
  // Under "All filters met.", until the list ends.
  let isInFindingList: boolean = false;

  for (const rawLine of rootCause.split("\n")) {
    const line: string = rawLine.trimEnd();

    if (!line.trim()) {
      isInFindingList = false;
      continue;
    }

    const bold: RegExpExecArray | null = BOLD_LABEL_LINE.exec(line);

    if (bold) {
      isInFindingList = false;

      const label: string = bold[1] as string;
      const rest: string = (bold[3] || "").trim();

      if (label === CREATED_BECAUSE) {
        isCriteria = true;
      } else if (label === CRITERIA_NAME && rest) {
        isCriteria = true;
        reason.criteriaName = readValue(rest).trim();
      } else if (label === FILTER_CONDITIONS_MET && rest) {
        isCriteria = true;

        if (readValue(rest) === ALL_FILTERS_MET) {
          isInFindingList = true;
        } else {
          reason.findings.push(
            wordFinding({
              stored: rest,
              write: writeFinding,
              findings: findings,
              translator: translator,
              options: data.options,
            }),
          );
        }
      } else if (label === CAUSE && rest) {
        reason.cause =
          getProbeFailureCauseText({
            translator: translator,
            failureCause: readValue(rest),
          }) || undefined;
      }

      continue;
    }

    if (isInFindingList && line.startsWith("- ")) {
      reason.findings.push(
        wordFinding({
          stored: line,
          write: writeListedFinding,
          findings: findings,
          translator: translator,
          options: data.options,
        }),
      );
      continue;
    }

    isInFindingList = false;

    const fact: RegExpExecArray | null = FACT_LINE.exec(line);

    if (
      fact &&
      SHOWN_FACT_LABELS.has(fact[1] as string) &&
      reason.facts.length < REASON_FACTS_SHOWN
    ) {
      const label: string = fact[1] as string;
      const value: string = readValue(fact[2] || "").trim();

      // "Timed Out: No" says nothing about why the status changed.
      if (!value || (label === "Timed Out" && value === "No")) {
        continue;
      }

      reason.facts.push({
        label: label,
        value: wordFactValue({
          label: label,
          value: value,
          translator: translator,
        }),
      });
    }
  }

  reason.findings = reason.findings.filter((finding: string): boolean => {
    return finding.length > 0;
  });

  if (isCriteria) {
    return reason;
  }

  /*
   * No criteria wrote it: the note's first paragraph, as its words, with
   * OneUptime's own sentences in the reader's language.
   */
  const firstParagraph: string = rootCause.split(/\n\s*\n/)[0] || rootCause;
  const text: string = readMarkdownAsPlainText(firstParagraph);

  if (!text) {
    return null;
  }

  return {
    findings: [],
    facts: [],
    note: wordNote(text, translator) ?? text,
  };
};

// The findings of a monitor's newest evaluations, for wording a root cause.
export const getEvaluationFindings: (
  evaluation: MonitorEvaluationByProbe | null | undefined,
) => Array<RootCauseFinding> = (
  evaluation: MonitorEvaluationByProbe | null | undefined,
): Array<RootCauseFinding> => {
  if (!evaluation) {
    return [];
  }

  const summaries: Array<MonitorEvaluationSummary> = [];

  if (evaluation.latest?.summary) {
    summaries.push(evaluation.latest.summary);
  }

  for (const probeId of Object.keys(evaluation.byProbeId || {})) {
    const summary: MonitorEvaluationSummary | undefined =
      evaluation.byProbeId[probeId];

    if (summary) {
      summaries.push(summary);
    }
  }

  const seen: Set<string> = new Set<string>();
  const findings: Array<RootCauseFinding> = [];

  for (const summary of summaries) {
    for (const criteria of summary.criteriaResults || []) {
      for (const filter of criteria.filters || []) {
        if (!filter || !filter.message || seen.has(filter.message)) {
          continue;
        }

        seen.add(filter.message);
        findings.push({
          message: filter.message,
          messageSentence: filter.messageSentence,
        });
      }
    }
  }

  return findings;
};

// An id as stored: an ObjectID, its JSON ({ _type, value }), or a string.
const idToString: (value: unknown) => string = (value: unknown): string => {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const json: { value?: unknown; _type?: unknown } = value as {
      value?: unknown;
      _type?: unknown;
    };

    if (typeof json.value === "string") {
      return json.value;
    }

    const text: string = String(value);

    return text === "[object Object]" ? "" : text;
  }

  return "";
};

/*
 * The status each of a monitor's criteria sets, by the criteria's id: only
 * a criteria that changes the status (changeMonitorStatus). Steps are
 * user-authored JSON through several schema versions, so every level is
 * read as possibly missing.
 */
export const getCriteriaStatusIds: (
  monitorSteps: MonitorSteps | null | undefined,
) => Map<string, string> = (
  monitorSteps: MonitorSteps | null | undefined,
): Map<string, string> => {
  const statusIds: Map<string, string> = new Map<string, string>();
  const steps: unknown = monitorSteps?.data?.monitorStepsInstanceArray;

  if (!Array.isArray(steps)) {
    return statusIds;
  }

  for (const step of steps) {
    const instances: unknown = (
      step as {
        data?: {
          monitorCriteria?: {
            data?: { monitorCriteriaInstanceArray?: unknown };
          };
        };
      }
    )?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray;

    if (!Array.isArray(instances)) {
      continue;
    }

    for (const instance of instances) {
      const criteria:
        | {
            id?: unknown;
            monitorStatusId?: unknown;
            changeMonitorStatus?: unknown;
          }
        | undefined = (
        instance as {
          data?: {
            id?: unknown;
            monitorStatusId?: unknown;
            changeMonitorStatus?: unknown;
          };
        }
      )?.data;

      const criteriaId: string = idToString(criteria?.id);
      const statusId: string = idToString(criteria?.monitorStatusId);

      if (criteriaId && statusId && criteria?.changeMonitorStatus === true) {
        statusIds.set(criteriaId, statusId);
      }
    }
  }

  return statusIds;
};

// The criteria whose match owns the status: the first met and not skipped.
export const getMatchedCriteria: (
  summary: MonitorEvaluationSummary | null | undefined,
) => MonitorEvaluationCriteriaResult | null = (
  summary: MonitorEvaluationSummary | null | undefined,
): MonitorEvaluationCriteriaResult | null => {
  for (const criteria of summary?.criteriaResults || []) {
    if (criteria && criteria.met && !criteria.skipped) {
      return criteria;
    }
  }

  return null;
};

// A probe whose newest check holds the monitor in its status.
export interface MonitorStatusProbe {
  row: MonitorOverviewProbeRow;
  // The criteria its newest check matched, as the project named it.
  criteriaName?: string | undefined;
  // What that criteria's filters found, in the reader's language.
  findings: Array<string>;
}

/*
 * The probes that see the monitor in its status now: each enabled probe
 * whose newest result is current and whose newest evaluation matched a
 * criteria that sets this status - or, for a probe whose evaluation the log
 * no longer holds, whose newest result is Down while the status is an
 * offline one. Most urgent first, as the Probes card lists them: a probe
 * that sees it Down before one that only matched (a slow response).
 */
export const getProbesBehindStatus: (data: {
  probes: MonitorOverviewProbeSummary | null | undefined;
  evaluation: MonitorEvaluationByProbe | null | undefined;
  monitorSteps: MonitorSteps | null | undefined;
  statusId: string;
  isOfflineState: boolean;
  translator: Translator;
  options?: WordEvaluationSentenceOptions | undefined;
}) => Array<MonitorStatusProbe> = (data: {
  probes: MonitorOverviewProbeSummary | null | undefined;
  evaluation: MonitorEvaluationByProbe | null | undefined;
  monitorSteps: MonitorSteps | null | undefined;
  statusId: string;
  isOfflineState: boolean;
  translator: Translator;
  options?: WordEvaluationSentenceOptions | undefined;
}): Array<MonitorStatusProbe> => {
  if (!data.probes || !data.statusId) {
    return [];
  }

  const statusIds: Map<string, string> = getCriteriaStatusIds(
    data.monitorSteps,
  );
  const behind: Array<MonitorStatusProbe> = [];

  for (const row of data.probes.rows || []) {
    const isCurrent: boolean =
      row.health === MonitorOverviewProbeHealth.Down ||
      row.health === MonitorOverviewProbeHealth.Up ||
      row.health === MonitorOverviewProbeHealth.Reported;

    if (!row.isEnabled || !row.latestResult || !isCurrent) {
      continue;
    }

    const summary: MonitorEvaluationSummary | undefined =
      data.evaluation?.byProbeId?.[row.probeId];
    const matched: MonitorEvaluationCriteriaResult | null =
      getMatchedCriteria(summary);

    let isBehind: boolean;

    if (summary) {
      isBehind = Boolean(
        matched &&
          matched.criteriaId &&
          statusIds.get(matched.criteriaId) === data.statusId,
      );
    } else {
      isBehind = data.isOfflineState && row.latestResult.isOnline === false;
    }

    if (!isBehind) {
      continue;
    }

    const findings: Array<string> = [];

    for (const filter of (matched?.filters ||
      []) as Array<MonitorEvaluationFilterResult>) {
      if (!filter || !filter.met || !filter.message) {
        continue;
      }

      findings.push(
        wordStoredEvaluationText({
          english: filter.message,
          sentence: filter.messageSentence,
          translator: data.translator,
          options: data.options,
        }),
      );
    }

    behind.push({
      row: row,
      criteriaName: matched?.criteriaName || undefined,
      findings: findings,
    });
  }

  return behind.sort((a: MonitorStatusProbe, b: MonitorStatusProbe): number => {
    const aDown: number = a.row.latestResult?.isOnline === false ? 0 : 1;
    const bDown: number = b.row.latestResult?.isOnline === false ? 0 : 1;

    if (aDown !== bDown) {
      return aDown - bDown;
    }

    return a.row.name.localeCompare(b.row.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
};
