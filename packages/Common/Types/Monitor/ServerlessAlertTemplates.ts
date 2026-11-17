import { SpanStatus } from "../../Models/AnalyticsModels/Span";
import Dictionary from "../Dictionary";
import ObjectID from "../ObjectID";
import { FilterType } from "./CriteriaFilter";
import {
  RequestHealthAlertTemplate,
  RequestHealthAlertTemplateArgs,
  RequestHealthAlertTemplateSeverity,
  RequestHealthScope,
  SpanCountAlertTemplateDefinition,
  buildSpanCountAlertTemplate,
} from "./RequestHealthAlertTemplates";

/*
 * THE MONITORS ONEUPTIME RECOMMENDS FOR A SERVERLESS FUNCTION - a Lambda,
 * a Cloud Function, an Azure Function: one ServerlessFunction row (#9307).
 *
 * A function's telemetry is told apart by its faas.name resource attribute
 * (the row's functionIdentifier), the way its own Traces, Metrics and Logs
 * tabs filter it. What its team most needs to hear about is its
 * invocations failing - so both templates count the function's own
 * error-status spans, over the request-health builders every
 * attribute-scoped product shares (RequestHealthAlertTemplates).
 *
 * What is deliberately NOT offered:
 *
 *   - "Invocations stopped". An always-on app that stops sending spans is
 *     down; a function that is not invoked for fifteen minutes is usually
 *     just idle (a nightly job, a webhook nobody called), so the alert
 *     would fire for most functions most of the day.
 *   - Latency. The faas.invoke_duration histogram is not something the
 *     function's setup guide asks for, and nothing on its page reads it: a
 *     monitor over a metric the function may never send would never fire.
 *
 * A function with no faas.name yet is offered nothing: a monitor filtered
 * on nothing would read every function's spans.
 *
 * Pure and isomorphic: the catalog, the Dashboard and the tests read it.
 */

// The resource attribute a function's telemetry is named by.
export const SERVERLESS_FUNCTION_NAME_FILTER: string = "resource.faas.name";

export type ServerlessAlertTemplateCategory = "Errors";

export interface ServerlessAlertTemplateArgs
  extends RequestHealthAlertTemplateArgs {
  // The ServerlessFunction row's id.
  serverlessFunctionId: string;
  /*
   * The filter that selects the function's telemetry
   * (getServerlessFunctionTelemetryFilters): its faas.name.
   */
  telemetryFilters: Dictionary<string>;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export type ServerlessAlertTemplateSeverity =
  RequestHealthAlertTemplateSeverity;

// "serverless-<what>": stable, and unique in the catalog.
export type ServerlessAlertTemplate = RequestHealthAlertTemplate<
  ServerlessAlertTemplateCategory,
  ServerlessAlertTemplateArgs
>;

// How a function is named in the monitors made for it.
const SERVERLESS_SCOPE: RequestHealthScope = {
  titlePrefix: "[Function]",
  resourceNoun: "function",
};

/*
 * The filter of a function's telemetry: its faas.name, trimmed, or nothing
 * when it has none yet.
 */
export function getServerlessFunctionTelemetryFilters(
  functionIdentifier: unknown,
): Dictionary<string> {
  if (typeof functionIdentifier !== "string" || !functionIdentifier.trim()) {
    return {};
  }

  return { [SERVERLESS_FUNCTION_NAME_FILTER]: functionIdentifier.trim() };
}

// Whether a filter names one function: what every template needs.
export function isServerlessFunctionTelemetryScoped(
  filters: Dictionary<string> | null | undefined,
): boolean {
  const value: unknown = filters?.[SERVERLESS_FUNCTION_NAME_FILTER];

  return typeof value === "string" && value.trim().length > 0;
}

function spanCountTemplate(
  data: SpanCountAlertTemplateDefinition<ServerlessAlertTemplateCategory>,
): ServerlessAlertTemplate {
  return buildSpanCountAlertTemplate<
    ServerlessAlertTemplateCategory,
    ServerlessAlertTemplateArgs
  >({ ...data, scope: SERVERLESS_SCOPE });
}

const SERVERLESS_ALERT_TEMPLATES: ReadonlyArray<ServerlessAlertTemplate> = [
  spanCountTemplate({
    id: "serverless-failed-invocations",
    name: "Failed Invocations",
    summary: "The function reports a failed invocation in ten minutes.",
    description:
      "Fires when the function reports any error-status span in ten minutes: the earliest sign its invocations fail, whatever the cause. Reads the function's own spans, by its faas.name.",
    category: "Errors",
    severity: "Warning",
    spanStatuses: [SpanStatus.Error],
    lastXSecondsOfSpans: 600,
    unhealthyFilterType: FilterType.GreaterThan,
    threshold: 0,
    criteriaName: "Error spans detected",
    criteriaDescription:
      "Triggers when at least one error-status span is reported in ten minutes.",
    incidentDescription:
      "The function reported a failed invocation. Open its Traces tab to see which invocation failed and what it called, and its Logs tab for the error it logged.",
  }),
  spanCountTemplate({
    id: "serverless-error-burst",
    name: "Invocation Error Burst",
    summary: "More than 25 invocations fail in five minutes.",
    description:
      "Fires when the function reports more than 25 error-status spans in five minutes: a failure rate well past routine noise. Reads the function's own spans, by its faas.name.",
    category: "Errors",
    severity: "Critical",
    spanStatuses: [SpanStatus.Error],
    lastXSecondsOfSpans: 300,
    unhealthyFilterType: FilterType.GreaterThan,
    threshold: 25,
    criteriaName: "Error spans above 25 in five minutes",
    criteriaDescription:
      "Triggers when more than 25 error-status spans are reported in five minutes.",
    incidentDescription:
      "The function is failing well past routine noise. Group its failing spans by operation for the common factor, check whether a new version (faas.version) was just deployed, and look for a dependency, a timeout or a concurrency limit it hits.",
  }),
];

export function getAllServerlessAlertTemplates(): Array<ServerlessAlertTemplate> {
  return [...SERVERLESS_ALERT_TEMPLATES];
}

export function getServerlessAlertTemplate(
  id: string,
): ServerlessAlertTemplate | undefined {
  return SERVERLESS_ALERT_TEMPLATES.find(
    (template: ServerlessAlertTemplate): boolean => {
      return template.id === id;
    },
  );
}

/*
 * The templates a function is offered: every one once its telemetry has a
 * faas.name to filter by; none before.
 */
export function getServerlessAlertTemplatesFor(data: {
  telemetryFilters?: Dictionary<string> | null | undefined;
}): Array<ServerlessAlertTemplate> {
  return isServerlessFunctionTelemetryScoped(data.telemetryFilters)
    ? getAllServerlessAlertTemplates()
    : [];
}
