import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import Route from "Common/Types/API/Route";
import { DataSecurityScrubSignal } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  getScrubTarget,
  getScrubUnavailableReason,
  isMetricNameFinding,
  ScrubTarget,
  TelemetryScrubUnavailableReason,
} from "Common/Types/DataSecurity/TelemetryScrubTarget";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * SCRUB IT ON A TELEMETRY FINDING: WHICH RULE, WHO MAY, AND WHY NOT.
 *
 * Scrub It makes the rule of ingest that reaches the finding's place
 * (Common/Types/DataSecurity/TelemetryScrubTarget): a log scrub rule for
 * logs, a trace scrub rule for spans, exceptions and AI calls, a metric
 * pipeline rule that redacts a metric's attribute. Each is made under the
 * person's own permission to create that rule, so the button asks for that
 * one - a person who may make metric pipeline rules but not log scrub
 * rules scrubs a metric's attribute, and is told why not on a log line.
 * Where no rule reaches the place - a session's own details, a metric's
 * name - the page says why instead of offering a button the server would
 * refuse. Shared by an issue's Where It Was Found and In Your Telemetry.
 */

export const SCRUB_IT: string = translationKey("Scrub It");

const SCRUB_LOCKED: Readonly<Record<DataSecurityScrubSignal, string>> = {
  log: translationKey("You do not have permission to create scrub rules."),
  trace: translationKey("You do not have permission to create scrub rules."),
  metric: translationKey(
    "You do not have permission to create metric pipeline rules.",
  ),
};

// Why no rule of ingest reaches a finding's place, in a sentence.
export const SCRUB_UNAVAILABLE_SENTENCES: Readonly<
  Record<TelemetryScrubUnavailableReason, string>
> = {
  [TelemetryScrubUnavailableReason.SessionDetails]: translationKey(
    "Session details come from the RUM recorder, which no scrub rule reaches. Leave this out of identify() and the session's attributes instead.",
  ),
  [TelemetryScrubUnavailableReason.MetricName]: translationKey(
    "A metric's name is set by the code that creates the metric, so no rule can scrub it. Rename the metric, and send what varies in its name as an attribute instead.",
  ),
  [TelemetryScrubUnavailableReason.NoRule]: translationKey(
    "No scrub rule reaches this place.",
  ),
};

/*
 * What a page says once Scrub It made, or found, the rule: one sentence,
 * the rule's name ({{name}}) a link to the list it is in (TelemetryRuleNotice).
 * "Hides", whatever the rule's action: it said "masks" of a rule that
 * redacts (#10433). Its name says whose records it scrubs.
 */
export const SCRUB_NOTICES: Readonly<Record<DataSecurityScrubSignal, string>> =
  {
    log: translationKey(
      "The scrub rule {{name}} now hides this data in new logs.",
    ),
    trace: translationKey(
      "The scrub rule {{name}} now hides this data in new traces.",
    ),
    metric: translationKey(
      "The metric pipeline rule {{name}} now redacts this data in new metrics.",
    ),
  };

/*
 * Where the rules of each kind are listed: what the rule's name in a page's
 * notice opens (TelemetryRuleNotice), where it can be changed or removed.
 */
export const RULES_PAGE_OF_SIGNAL: Readonly<
  Record<DataSecurityScrubSignal, PageMap>
> = {
  log: PageMap.LOGS_SETTINGS_SCRUB_RULES,
  trace: PageMap.TRACES_SETTINGS_SCRUB_RULES,
  metric: PageMap.METRICS_SETTINGS_PIPELINE_RULES,
};

export function getRulesRoute(signal: DataSecurityScrubSignal): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[RULES_PAGE_OF_SIGNAL[signal] || RULES_PAGE_OF_SIGNAL.log] as Route,
  );
}

// Whether the reader may create each kind of rule, read once for a page.
export type ScrubItGates = Readonly<
  Record<DataSecurityScrubSignal, PermissionGateResult>
>;

export function getScrubItGates(): ScrubItGates {
  return {
    log: PermissionGate.check(new LogScrubRule(), ModelAction.Create, {
      sentence: SCRUB_LOCKED.log,
    }),
    trace: PermissionGate.check(new TraceScrubRule(), ModelAction.Create, {
      sentence: SCRUB_LOCKED.trace,
    }),
    metric: PermissionGate.check(new MetricPipelineRule(), ModelAction.Create, {
      sentence: SCRUB_LOCKED.metric,
    }),
  };
}

/*
 * Scrub It on one finding:
 *  - unavailableReason: no rule reaches its place, which the page says;
 *  - else isShown, when the reader may create the rule it takes or is told
 *    why not (disabledReason, a sentence key), and isAllowed when they may.
 */
export interface ScrubItState {
  isShown: boolean;
  isAllowed: boolean;
  disabledReason?: string | undefined;
  unavailableReason?: TelemetryScrubUnavailableReason | undefined;
  signal?: DataSecurityScrubSignal | undefined;
}

export function getScrubItState(data: {
  kind: string | null | undefined;
  location: string | null | undefined;
  gates: ScrubItGates;
}): ScrubItState {
  const location: string = (data.location || "").trim();
  const target: ScrubTarget | null = getScrubTarget(data.kind, location);

  if (!target) {
    return {
      isShown: false,
      isAllowed: false,
      unavailableReason:
        getScrubUnavailableReason(data.kind, location) ||
        TelemetryScrubUnavailableReason.NoRule,
    };
  }

  const gate: PermissionGateResult = data.gates[target.signal];

  return {
    isShown: gate.isAllowed || Boolean(gate.disabledReason),
    isAllowed: gate.isAllowed,
    disabledReason: gate.isAllowed ? undefined : gate.disabledReason,
    signal: target.signal,
  };
}

// Whether the page offers Scrub It on any finding at all.
export function isScrubItOfferedAtAll(gates: ScrubItGates): boolean {
  return Object.values(gates).some((gate: PermissionGateResult): boolean => {
    return gate.isAllowed || Boolean(gate.disabledReason);
  });
}

/*
 * DROP THIS METRIC (#9757): no rule can take the data out of a metric's
 * name, but a metric pipeline Drop rule can keep the service's metrics named
 * so from being stored, until the code is fixed - losing their new data
 * points for good. So it is offered only on a finding in a metric's name,
 * to someone who may create metric pipeline rules (a person who may not
 * sees it locked, and why), and it opens a dialog that says what it drops
 * before it does (DropMetricModal).
 */
export const DROP_METRIC: string = translationKey("Drop This Metric");

// What a page says once the Drop rule is made: its name opens the pipeline rules.
export const DROP_NOTICE: string = translationKey(
  "The metric pipeline rule {{name}} now drops these metrics' new data points. Delete it to store them again.",
);

// A finding whose metrics a Drop rule keeps from being stored.
export const DROPPED: string = translationKey("Dropped");
export const DROPPED_TOOLTIP: string = translationKey(
  "A metric pipeline rule drops these metrics' new data points at ingest. What was stored before stays until its retention ends.",
);

export interface DropMetricState {
  isShown: boolean;
  isAllowed: boolean;
  disabledReason?: string | undefined;
}

export function getDropMetricState(data: {
  kind: string | null | undefined;
  location: string | null | undefined;
  gates: ScrubItGates;
}): DropMetricState {
  if (!isMetricNameFinding(data.kind, data.location)) {
    return { isShown: false, isAllowed: false };
  }

  const gate: PermissionGateResult = data.gates.metric;

  return {
    isShown: gate.isAllowed || Boolean(gate.disabledReason),
    isAllowed: gate.isAllowed,
    disabledReason: gate.isAllowed ? undefined : gate.disabledReason,
  };
}
