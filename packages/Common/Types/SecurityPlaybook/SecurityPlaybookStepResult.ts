import { JSONObject, JSONValue } from "../JSON";
import { SecurityPlaybookActionType } from "./SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "./SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "./SecurityPlaybookStep";

export enum SecurityPlaybookApprovalDecision {
  Approved = "Approved",
  Rejected = "Rejected",
}

export interface SecurityPlaybookApproval {
  decision: SecurityPlaybookApprovalDecision;
  decidedByUserId: string;
  // ISO 8601.
  decidedAt: string;
  comment?: string | undefined;
}

/*
 * What one step of a run did, as stored in the run's stepResults: its status,
 * when it started and finished, a sentence or two of Markdown on what it did
 * ("Suspended alice@acme.com in Okta"), the error when it failed, and the
 * approval decision for a step that asked for one.
 */
export interface SecurityPlaybookStepResult {
  stepId: string;
  action: SecurityPlaybookActionType;
  status: SecurityPlaybookStepStatus;
  // ISO 8601.
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  message?: string | undefined;
  error?: string | undefined;
  approval?: SecurityPlaybookApproval | undefined;
}

// The longest message or error a step result keeps.
export const SECURITY_PLAYBOOK_STEP_RESULT_TEXT_LIMIT: number = 20000;

export function clampStepResultText(
  text: string | undefined,
): string | undefined {
  if (text === undefined) {
    return undefined;
  }

  return text.length > SECURITY_PLAYBOOK_STEP_RESULT_TEXT_LIMIT
    ? `${text.slice(0, SECURITY_PLAYBOOK_STEP_RESULT_TEXT_LIMIT)}…`
    : text;
}

export function buildPendingStepResults(
  steps: Array<SecurityPlaybookStep>,
): Array<SecurityPlaybookStepResult> {
  return steps.map((step: SecurityPlaybookStep): SecurityPlaybookStepResult => {
    return {
      stepId: step.id,
      action: step.action,
      status: SecurityPlaybookStepStatus.Pending,
    };
  });
}

function readText(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readApproval(
  value: JSONValue | undefined,
): SecurityPlaybookApproval | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const approval: JSONObject = value as JSONObject;
  const decision: JSONValue | undefined = approval["decision"];

  if (
    decision !== SecurityPlaybookApprovalDecision.Approved &&
    decision !== SecurityPlaybookApprovalDecision.Rejected
  ) {
    return undefined;
  }

  return {
    decision,
    decidedByUserId: readText(approval["decidedByUserId"]) || "",
    decidedAt: readText(approval["decidedAt"]) || "",
    comment: readText(approval["comment"]),
  };
}

/*
 * A run's stored results, one per step in step order: a result is matched to
 * its step by id, and a step with none (or an unreadable one) is Pending.
 */
export function readStepResults(
  value: unknown,
  steps: Array<SecurityPlaybookStep>,
): Array<SecurityPlaybookStepResult> {
  const stored: Map<string, JSONObject> = new Map();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const stepId: string | undefined = readText(
          (item as JSONObject)["stepId"],
        );

        if (stepId) {
          stored.set(stepId, item as JSONObject);
        }
      }
    }
  }

  return steps.map((step: SecurityPlaybookStep): SecurityPlaybookStepResult => {
    const item: JSONObject | undefined = stored.get(step.id);
    const status: JSONValue | undefined = item?.["status"];

    return {
      stepId: step.id,
      action: step.action,
      status: (
        Object.values(SecurityPlaybookStepStatus) as Array<string>
      ).includes(String(status))
        ? (status as SecurityPlaybookStepStatus)
        : SecurityPlaybookStepStatus.Pending,
      startedAt: readText(item?.["startedAt"]),
      completedAt: readText(item?.["completedAt"]),
      message: readText(item?.["message"]),
      error: readText(item?.["error"]),
      approval: readApproval(item?.["approval"]),
    };
  });
}
