import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { formatMilliseconds } from "Common/Utils/Milliseconds";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewFact,
  MonitorOverviewPresentation,
  MonitorOverviewRunState,
  MonitorOverviewStatusRef,
} from "Common/Utils/Monitor/MonitorOverviewPresentationUtil";
import {
  MonitorEvaluationByProbe,
  MonitorOverviewProbeResult,
  MonitorOverviewProbeSummary,
} from "Common/Utils/Monitor/MonitorOverviewProbeUtil";
import {
  MonitorStatusProbe,
  MonitorStatusReason,
  MonitorStatusReasonFact,
  getEvaluationFindings,
  getProbesBehindStatus,
  readMonitorStatusReason,
} from "Common/Utils/Monitor/MonitorStatusReason";
import { getProbeFailureCauseText } from "Common/Utils/Monitor/ProbeFailureReading";
import { EVALUATION_TEXT_OPTIONS } from "../../../Utils/EvaluationText";
import {
  ResourceAttentionFact,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../ResourcePart/ResourceAttention";
import { ResourcePartTone } from "../../ResourcePart/ResourcePartTypes";
import { MonitorStatusCause } from "./useMonitorStatusCause";

/*
 * WHY THIS MONITOR IS OFFLINE OR DEGRADED, FOR ITS HERO (#9592).
 *
 * The hero said "Offline for 3h" in a badge and nothing about why: the
 * reason was on the Status Timeline, behind View Cause. Now the badge is
 * the status that opens why (ResourceAttentionPill), and a line under the
 * headline says the gist:
 *
 *   Offline for 3 hours
 *   Website is down: Response Status Code was 503, at or above the 500
 *   threshold.
 *
 * Its dialog lists, the reason first:
 *   - what set the status - the criteria that matched, what its filters
 *     found, what the check saw (its status code, response time, attempts,
 *     error) and the probe's cause, since when, and View: the Status
 *     Timeline, where the whole cause and the check behind it are. Read
 *     from the current status event's root cause (MonitorStatusReason), or
 *     its note when no criteria wrote it (a person, an incident);
 *   - each probe that sees it so now: its newest check matched a criteria
 *     that sets this status (or it is Down, while this is an offline
 *     status), with what it found, its status code, response time and
 *     certificate, its own error, when it checked, and View: the monitor's
 *     Logs, where each check's details are.
 *
 * Only a status the badge names, and only one that is not operational: a
 * monitor that is fine, paused or still waiting for its first check has
 * nothing to explain here. React-free and route-free (the page hands the
 * routes in), so App tests read it as it is.
 */

export const MONITOR_STATUS_REASON_TITLE: string = translationKey(
  "Why is this monitor {{status}}?",
);

export const MONITOR_STATUS_REASON_DESCRIPTION: string = translationKey(
  "What set this status and what the check found, then each probe that sees it so now.",
);

export const MONITOR_STATUS_REASON_DESCRIPTION_NO_PROBES: string =
  translationKey("What set this status and what the check found.");

export const MONITOR_STATUS_REASON_EMPTY: string = translationKey(
  "Nothing explains this status now. It may have changed since the page loaded.",
);

// The status event's start, and a probe's newest check, in a row.
const STARTED_TEMPLATE: string = translationKey("Started {{time}}");
const CHECKED_TEMPLATE: string = translationKey("Checked {{time}}");

// The kinds of row, as their chips name them.
const CRITERIA_KIND: string = translationKey("Criteria");
const STATUS_KIND: string = translationKey("Monitor Status");
const PROBE_KIND: string = translationKey("Probe");

export const MONITOR_STATUS_REASON_ITEM_KEY: string = "status-reason";

export interface MonitorStatusReasonLine {
  // The criteria that matched, as the project named it: bold, before the text.
  criteriaName?: string | undefined;
  // What it found, or the note, already in the reader's words.
  text: string;
}

export interface MonitorOverviewStatusReason {
  // The status's name as stored: the badge words it as its badge does.
  statusName: string;
  tone: ResourcePartTone;
  // The hero's line under the headline; none while it is unknown.
  line?: MonitorStatusReasonLine | undefined;
  // The dialog's rows: what set the status, then the probes behind it.
  items: Array<ResourceAttentionItem>;
  // Whether any row is a probe's: the dialog's description says so.
  hasProbes: boolean;
  // The cause is being read: the hero keeps the line's room meanwhile.
  isLoading: boolean;
}

export interface MonitorStatusReasonInput {
  translator: Translator;
  presentation: MonitorOverviewPresentation;
  currentStatus: MonitorOverviewStatusRef | undefined;
  // When the status began (the current status event's start).
  statusSince: Date | undefined;
  cause: MonitorStatusCause;
  probes: MonitorOverviewProbeSummary | null | undefined;
  evaluation: MonitorEvaluationByProbe | null | undefined;
  monitorSteps: MonitorSteps | undefined;
  monitorType: MonitorType;
  now: Date;
  statusTimelineRoute: Route;
  // The monitor's Logs: every check, newest first, each with its details.
  checksRoute: Route;
}

/*
 * The run states whose badge is the monitor's status: it is checked (or set
 * by hand), on time or late. A paused monitor, one nobody checks, one with
 * no criteria and one still waiting for its first result lead with that
 * instead, and their status only describes the last thing recorded.
 */
const STATUS_RUN_STATES: ReadonlySet<MonitorOverviewRunState> =
  new Set<MonitorOverviewRunState>([
    MonitorOverviewRunState.Running,
    MonitorOverviewRunState.Overdue,
    MonitorOverviewRunState.Manual,
  ]);

// Whether the hero explains this status: one it names and is not operational.
export function isStatusExplained(data: {
  presentation: MonitorOverviewPresentation;
  currentStatus: MonitorOverviewStatusRef | undefined;
}): boolean {
  return Boolean(
    data.currentStatus &&
      !data.currentStatus.isOperationalState &&
      STATUS_RUN_STATES.has(data.presentation.runState) &&
      data.presentation.badge.text === data.currentStatus.name,
  );
}

const isScriptedMonitor: (monitorType: MonitorType) => boolean = (
  monitorType: MonitorType,
): boolean => {
  return (
    monitorType === MonitorType.SyntheticMonitor ||
    monitorType === MonitorType.CustomJavaScriptCode
  );
};

const toFacts: (
  facts: Array<MonitorStatusReasonFact>,
) => Array<ResourceAttentionFact> = (
  facts: Array<MonitorStatusReasonFact>,
): Array<ResourceAttentionFact> => {
  return facts.map(
    (fact: MonitorStatusReasonFact, index: number): ResourceAttentionFact => {
      return {
        key: `${fact.label}-${index}`,
        label: fact.label,
        value: fact.value,
      };
    },
  );
};

// What set the status, as the dialog's first row.
const getReasonItem: (data: {
  reason: MonitorStatusReason;
  input: MonitorStatusReasonInput;
  severity: ResourceAttentionSeverity;
}) => ResourceAttentionItem = (data: {
  reason: MonitorStatusReason;
  input: MonitorStatusReasonInput;
  severity: ResourceAttentionSeverity;
}): ResourceAttentionItem => {
  const reason: MonitorStatusReason = data.reason;
  const status: MonitorOverviewStatusRef = data.input
    .currentStatus as MonitorOverviewStatusRef;
  const isNote: boolean = Boolean(reason.note);

  return {
    key: MONITOR_STATUS_REASON_ITEM_KEY,
    kind: isNote ? STATUS_KIND : CRITERIA_KIND,
    icon: isNote ? IconProp.Edit : IconProp.Criteria,
    // The criteria's name, or the note itself; the status's when neither.
    name: reason.criteriaName || reason.note || status.name,
    severity: data.severity,
    reasons: [],
    explanation:
      reason.findings.length > 0 ? reason.findings.join(" ") : undefined,
    facts: toFacts(reason.facts),
    message: reason.cause,
    since: data.input.statusSince
      ? { at: data.input.statusSince, template: STARTED_TEMPLATE }
      : undefined,
    route: data.input.statusTimelineRoute,
  };
};

// What a probe's newest check saw: its code, its time, its certificate.
const getProbeFacts: (data: {
  result: MonitorOverviewProbeResult;
  input: MonitorStatusReasonInput;
}) => Array<ResourceAttentionFact> = (data: {
  result: MonitorOverviewProbeResult;
  input: MonitorStatusReasonInput;
}): Array<ResourceAttentionFact> => {
  const result: MonitorOverviewProbeResult = data.result;
  const translator: Translator = data.input.translator;
  const facts: Array<ResourceAttentionFact> = [];

  if (
    result.responseCode !== undefined &&
    (data.input.monitorType === MonitorType.API ||
      data.input.monitorType === MonitorType.Website)
  ) {
    // A protocol's status code, as the server answered it.
    facts.push({
      key: "status-code",
      label: "Status code",
      value: String(result.responseCode),
    });
  }

  if (result.responseTimeInMs !== undefined) {
    facts.push({
      key: "response-time",
      label: "Response time",
      value: formatMilliseconds(translator, result.responseTimeInMs, {
        maximumFractionDigits: 0,
      }),
    });
  }

  if (data.input.monitorType === MonitorType.SSLCertificate) {
    const expiry: MonitorOverviewFact =
      MonitorOverviewPresentationUtil.getExpiryFact({
        key: "certificate-expiry",
        expiresAt: result.sslExpiresAt,
        isValidCertificate: result.isValidCertificate,
        now: data.input.now,
        translator: translator,
      });

    if (expiry.value !== "—") {
      facts.push({
        key: "certificate",
        label: "Certificate",
        value: expiry.value,
      });
    }
  }

  if (data.input.monitorType === MonitorType.Domain) {
    const expiry: MonitorOverviewFact =
      MonitorOverviewPresentationUtil.getExpiryFact({
        key: "domain-expiry",
        expiresAt: result.domainExpiresAt,
        now: data.input.now,
        translator: translator,
      });

    if (expiry.value !== "—") {
      facts.push({
        key: "domain",
        label: "Domain expires",
        value: expiry.value,
      });
    }
  }

  return facts;
};

// A probe behind the status, as a row of the dialog.
const getProbeItem: (data: {
  probe: MonitorStatusProbe;
  input: MonitorStatusReasonInput;
  severity: ResourceAttentionSeverity;
}) => ResourceAttentionItem | null = (data: {
  probe: MonitorStatusProbe;
  input: MonitorStatusReasonInput;
  severity: ResourceAttentionSeverity;
}): ResourceAttentionItem | null => {
  const row: MonitorStatusProbe["row"] = data.probe.row;
  const result: MonitorOverviewProbeResult | undefined = row.latestResult;

  if (!result) {
    return null;
  }

  const isDown: boolean = result.isOnline === false;
  const reasons: Array<ResourceAttentionText> = [];

  if (isDown) {
    reasons.push({
      text: isScriptedMonitor(data.input.monitorType) ? "Failed" : "Down",
    });
  }

  const cause: string = isDown
    ? getProbeFailureCauseText({
        translator: data.input.translator,
        failureCause: result.failureCause,
      })
    : "";

  return {
    key: `probe-${row.probeId}`,
    kind: PROBE_KIND,
    icon: IconProp.Signal,
    name: row.name,
    severity: data.severity,
    reasons: reasons,
    explanation:
      data.probe.findings.length > 0
        ? data.probe.findings.join(" ")
        : undefined,
    facts: getProbeFacts({ result: result, input: data.input }),
    message: cause || undefined,
    since: result.monitoredAt
      ? { at: result.monitoredAt, template: CHECKED_TEMPLATE }
      : undefined,
    route: data.input.checksRoute,
  };
};

export function getMonitorStatusReason(
  input: MonitorStatusReasonInput,
): MonitorOverviewStatusReason | null {
  const status: MonitorOverviewStatusRef | undefined = input.currentStatus;

  if (
    !status ||
    !isStatusExplained({
      presentation: input.presentation,
      currentStatus: status,
    })
  ) {
    return null;
  }

  const translator: Translator = input.translator;
  const severity: ResourceAttentionSeverity = status.isOfflineState
    ? ResourceAttentionSeverity.Critical
    : ResourceAttentionSeverity.Warning;
  const tone: ResourcePartTone =
    input.presentation.badge.tone === "danger" ? "danger" : "warning";

  const reason: MonitorStatusReason | null =
    input.cause.state === "loaded"
      ? readMonitorStatusReason({
          rootCause: input.cause.rootCause,
          translator: translator,
          findings: getEvaluationFindings(input.evaluation),
          options: EVALUATION_TEXT_OPTIONS,
        })
      : null;

  const probes: Array<MonitorStatusProbe> = getProbesBehindStatus({
    probes: input.probes,
    evaluation: input.evaluation,
    monitorSteps: input.monitorSteps,
    statusId: status.id,
    isOfflineState: status.isOfflineState,
    translator: translator,
    options: EVALUATION_TEXT_OPTIONS,
  });

  const items: Array<ResourceAttentionItem> = [];

  if (reason) {
    items.push(
      getReasonItem({ reason: reason, input: input, severity: severity }),
    );
  }

  for (const probe of probes) {
    const item: ResourceAttentionItem | null = getProbeItem({
      probe: probe,
      input: input,
      severity: severity,
    });

    if (item) {
      items.push(item);
    }
  }

  return {
    statusName: status.name,
    tone: tone,
    line: getReasonLine({ reason: reason, probes: probes, input: input }),
    items: items,
    hasProbes: items.some((item: ResourceAttentionItem): boolean => {
      return item.key !== MONITOR_STATUS_REASON_ITEM_KEY;
    }),
    isLoading: input.cause.state === "loading" && !reason,
  };
}

/*
 * The hero's line: what the criteria found (or its cause), after the
 * criteria's name; the note, when no criteria wrote the cause. While the
 * cause is unknown (still read, or unreadable), a probe behind the status
 * says what its own check matched.
 */
function getReasonLine(data: {
  reason: MonitorStatusReason | null;
  probes: Array<MonitorStatusProbe>;
  input: MonitorStatusReasonInput;
}): MonitorStatusReasonLine | undefined {
  const reason: MonitorStatusReason | null = data.reason;

  if (reason?.note) {
    return { text: reason.note };
  }

  if (reason) {
    const text: string = reason.findings[0] || reason.cause || "";

    if (text || reason.criteriaName) {
      return { criteriaName: reason.criteriaName, text: text };
    }
  }

  if (data.input.cause.state === "loading") {
    return undefined;
  }

  const probe: MonitorStatusProbe | undefined = data.probes[0];

  if (!probe) {
    return undefined;
  }

  const result: MonitorOverviewProbeResult | undefined = probe.row.latestResult;
  const text: string =
    probe.findings[0] ||
    (result?.isOnline === false
      ? getProbeFailureCauseText({
          translator: data.input.translator,
          failureCause: result.failureCause,
        })
      : "");

  if (!text && !probe.criteriaName) {
    return undefined;
  }

  return { criteriaName: probe.criteriaName, text: text };
}
