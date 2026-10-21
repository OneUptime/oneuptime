import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import Color from "Common/Types/Color";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import { ResourceAiAgentDescriptor } from "./ResourceAiAgentDescriptors";
import {
  translatableTerm,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure half of a resource's AI Logs page (ResourceAiLogsPage): how the
 * page reads the logs route's body (POST /resource-ai-access/logs — the
 * investigations of incidents and alerts on the resource, and the fixes AI
 * proposed or applied there), and the words for each row. The resource twin
 * of the helpers in Pages/Kubernetes/View/AI/Logs.tsx.
 *
 * Import-clean on purpose (Common types and the descriptors only), so the
 * suites read it without a browser.
 */

export const RESOURCE_AI_LOGS_PAGE_TITLE: string = translationKey("AI Logs");

export const RESOURCE_AI_LOGS_EMPTY_TITLE: string =
  translationKey("Nothing yet");

export function getResourceAiLogsPageSubtitle(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "Everything OneUptime AI did on this {{noun}}, newest first: every investigation, fix and command.",
    { noun: translatableTerm(descriptor.noun, { inSentence: true }) },
  );
}

export function getResourceAiLogsEmptyDescription(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "When an incident or alert on this {{noun}} is investigated, the findings, proposed fixes and every command AI ran appear here.",
    { noun: translatableTerm(descriptor.noun, { inSentence: true }) },
  );
}

export function getResourceCommandsCardDescription(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "Every command OneUptime AI ran on this {{noun}} through the {{agent}} — while investigating (read-only), for fixes, and for connection tests — with its result.",
    {
      noun: translatableTerm(descriptor.noun, { inSentence: true }),
      agent: translatableTerm(descriptor.agentName),
    },
  );
}

export function getResourceCommandsEmptyMessage(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "OneUptime AI has not run any commands on this {{noun}} yet.",
    { noun: translatableTerm(descriptor.noun, { inSentence: true }) },
  );
}

/*
 * The "Why" filter of the commands table, in the reader's words. Only the
 * two AI origins ever carry a ResourceCommand step.
 */
export const RESOURCE_COMMAND_JOB_ORIGIN_LABELS: Record<
  Extract<
    RunnerJobOrigin,
    RunnerJobOrigin.AiInvestigation | RunnerJobOrigin.AiRemediation
  >,
  string
> = {
  [RunnerJobOrigin.AiInvestigation]: translationKey(
    "Investigation or connection test",
  ),
  [RunnerJobOrigin.AiRemediation]: translationKey("Fix"),
};

/*
 * One row's "Why". An AiInvestigation job without an AI run is the AI agent
 * page's connection test, which spends the same read-only access.
 */
export function describeResourceCommandJobOrigin(job: {
  origin?: string | undefined;
  aiRunId?: unknown;
}): string {
  const origin: string = String(job.origin || "");

  if (origin === RunnerJobOrigin.AiInvestigation) {
    return job.aiRunId
      ? translateTemplate("Investigation (read-only)")
      : translateTemplate("Connection test (read-only)");
  }

  if (origin === RunnerJobOrigin.AiRemediation) {
    return translateTemplate("Fix");
  }

  return origin;
}

/*
 * The rows below are the page's normalised reading of the route's body:
 * every field the contract leaves optional is null here when it is missing
 * or unreadable.
 */

// What the logs route returns for one investigation (an AI run).
export interface ResourceAiLogsInvestigation {
  aiRunId: string;
  // AIRunStatus; null when the server did not say.
  status: string | null;
  analysisTldr: string | null;
  // No TL;DR: the Summary its posted report opens with; null without one.
  reportSummary: string | null;
  createdAt: string | null;
  completedAt: string | null;
  incident: { id: string; title: string; number: number | null } | null;
  alert: { id: string; title: string } | null;
}

// What the logs route returns for one fix (an auto-remediation suggestion).
export interface ResourceAiLogsFix {
  id: string;
  // AutoRemediationSuggestionStatus; null when the server did not say.
  status: string | null;
  executionMode: string | null;
  suggestionType: string | null;
  rationale: string | null;
  createdAt: string | null;
  incidentId: string | null;
  alertId: string | null;
  approvedAt: string | null;
}

export interface ResourceAiLogs {
  investigations: Array<ResourceAiLogsInvestigation>;
  fixes: Array<ResourceAiLogsFix>;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * A string the server may have sent bare or in its serialized
 * { _type, value } envelope (ObjectID, DateTime). Anything else — a number,
 * an empty string, an object without a string value — is no value.
 */
function readString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() ? value : null;
  }

  if (isObject(value) && typeof value["value"] === "string") {
    return value["value"].trim() ? value["value"] : null;
  }

  return null;
}

function parseInvestigation(
  value: unknown,
): ResourceAiLogsInvestigation | null {
  if (!isObject(value)) {
    return null;
  }

  const aiRunId: string | null = readString(value["aiRunId"]);
  if (!aiRunId) {
    return null;
  }

  const incidentValue: unknown = value["incident"];
  const alertValue: unknown = value["alert"];
  const incidentId: string | null = isObject(incidentValue)
    ? readString(incidentValue["id"])
    : null;
  const alertId: string | null = isObject(alertValue)
    ? readString(alertValue["id"])
    : null;

  return {
    aiRunId,
    status: readString(value["status"]),
    analysisTldr: readString(value["analysisTldr"]),
    reportSummary: readString(value["reportSummary"]),
    createdAt: readString(value["createdAt"]),
    completedAt: readString(value["completedAt"]),
    incident:
      incidentId && isObject(incidentValue)
        ? {
            id: incidentId,
            title: readString(incidentValue["title"]) || "",
            number:
              typeof incidentValue["number"] === "number" &&
              Number.isFinite(incidentValue["number"])
                ? (incidentValue["number"] as number)
                : null,
          }
        : null,
    alert:
      alertId && isObject(alertValue)
        ? { id: alertId, title: readString(alertValue["title"]) || "" }
        : null,
  };
}

function parseFix(value: unknown): ResourceAiLogsFix | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);
  if (!id) {
    return null;
  }

  return {
    id,
    status: readString(value["status"]),
    executionMode: readString(value["executionMode"]),
    suggestionType: readString(value["suggestionType"]),
    rationale: readString(value["rationale"]),
    createdAt: readString(value["createdAt"]),
    incidentId: readString(value["incidentId"]),
    alertId: readString(value["alertId"]),
    approvedAt: readString(value["approvedAt"]),
  };
}

function parseList<T>(
  value: unknown,
  parseRow: (row: unknown) => T | null,
): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: Array<T> = [];

  for (const row of value) {
    const parsed: T | null = parseRow(row);

    if (parsed) {
      rows.push(parsed);
    }
  }

  return rows;
}

/*
 * The logs as the route returns them, or null when the body is not
 * that shape at all (neither list is present). A row without an id is
 * dropped — there is nothing to key or link it by; everything else is
 * optional and read defensively where it is shown. Server text is only ever
 * rendered as plain text.
 */
export function parseResourceAiLogs(value: unknown): ResourceAiLogs | null {
  if (!isObject(value)) {
    return null;
  }

  if (
    !Array.isArray(value["investigations"]) &&
    !Array.isArray(value["fixes"])
  ) {
    return null;
  }

  return {
    investigations: parseList(value["investigations"], parseInvestigation),
    fixes: parseList(value["fixes"], parseFix),
  };
}

export interface ResourceAiStatusLook {
  label: string;
  color: Color;
}

const INVESTIGATION_STATUS_LOOKS: Record<AIRunStatus, ResourceAiStatusLook> = {
  [AIRunStatus.Queued]: { label: "Queued", color: Yellow500 },
  [AIRunStatus.Running]: { label: "Investigating", color: Yellow500 },
  [AIRunStatus.WaitingForApproval]: {
    label: "Waiting for approval",
    color: Yellow500,
  },
  [AIRunStatus.Completed]: { label: "Completed", color: Green500 },
  [AIRunStatus.NoFixFound]: { label: "No fix found", color: Gray500 },
  [AIRunStatus.Error]: { label: "Failed", color: Red500 },
  [AIRunStatus.Cancelled]: { label: "Cancelled", color: Gray500 },
  [AIRunStatus.Stale]: { label: "Timed out", color: Gray500 },
};

const FIX_STATUS_LOOKS: Record<
  AutoRemediationSuggestionStatus,
  ResourceAiStatusLook
> = {
  [AutoRemediationSuggestionStatus.Planning]: {
    label: "Planning",
    color: Yellow500,
  },
  [AutoRemediationSuggestionStatus.Suggested]: {
    label: "Waiting for approval",
    color: Yellow500,
  },
  [AutoRemediationSuggestionStatus.Approved]: {
    label: "Applied after approval",
    color: Green500,
  },
  [AutoRemediationSuggestionStatus.AutoExecuted]: {
    label: "Applied automatically",
    color: Green500,
  },
  [AutoRemediationSuggestionStatus.Dismissed]: {
    label: "Dismissed",
    color: Gray500,
  },
  [AutoRemediationSuggestionStatus.NoneApplicable]: {
    label: "No fix found",
    color: Gray500,
  },
};

// A status a newer server added shows as it is, in a neutral pill.
export function getResourceInvestigationStatusLook(
  status: string,
): ResourceAiStatusLook {
  return (
    INVESTIGATION_STATUS_LOOKS[status as AIRunStatus] || {
      label: status,
      color: Gray500,
    }
  );
}

export function getResourceFixStatusLook(status: string): ResourceAiStatusLook {
  return (
    FIX_STATUS_LOOKS[status as AutoRemediationSuggestionStatus] || {
      label: status,
      color: Gray500,
    }
  );
}

export function describeResourceFixType(
  suggestionType: string | null,
): string | null {
  if (suggestionType === AutoRemediationSuggestionType.CommandPlan) {
    return translateTemplate("Command plan");
  }

  if (suggestionType === AutoRemediationSuggestionType.Runbook) {
    return translateTemplate("Runbook");
  }

  return null;
}

// The line an investigation row leads with, and where it links.
export function describeResourceInvestigationSubject(
  investigation: ResourceAiLogsInvestigation,
): { text: string; incidentId: string | null; alertId: string | null } {
  if (investigation.incident) {
    const number: number | null = investigation.incident.number;
    const title: string | null = investigation.incident.title || null;
    let text: string;

    if (number !== null && title) {
      text = translateTemplate("Incident #{{number}}: {{title}}", {
        number: number,
        title: title,
      });
    } else if (number !== null) {
      text = translateTemplate("Incident #{{number}}", { number: number });
    } else if (title) {
      text = translateTemplate("Incident: {{title}}", { title: title });
    } else {
      text = translateTemplate("Incident");
    }

    return {
      text: text,
      incidentId: investigation.incident.id,
      alertId: null,
    };
  }

  if (investigation.alert) {
    return {
      text: investigation.alert.title
        ? translateTemplate("Alert: {{title}}", {
            title: investigation.alert.title,
          })
        : translateTemplate("Alert"),
      incidentId: null,
      alertId: investigation.alert.id,
    };
  }

  return {
    text: translateTemplate("Investigation"),
    incidentId: null,
    alertId: null,
  };
}

/*
 * What an investigation found, or why there is nothing to show yet. The
 * incidents' and alerts' AI Logs say it the same way.
 */
export function getResourceInvestigationSummary(
  investigation: Pick<
    ResourceAiLogsInvestigation,
    "analysisTldr" | "reportSummary" | "status"
  >,
): string {
  if (investigation.analysisTldr) {
    return investigation.analysisTldr;
  }

  // A run whose TL;DR call failed still published a report that says.
  if (investigation.reportSummary) {
    return investigation.reportSummary;
  }

  if (
    investigation.status === AIRunStatus.Queued ||
    investigation.status === AIRunStatus.Running
  ) {
    return translateTemplate("Still investigating.");
  }

  return translateTemplate("No summary was recorded.");
}
