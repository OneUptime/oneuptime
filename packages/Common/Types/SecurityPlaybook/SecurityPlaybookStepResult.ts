import { JSONObject, JSONValue } from "../JSON";
import {
  SECURITY_ENTITY_LIMIT,
  SecurityEntityType,
} from "../SecurityCase/SecurityEntity";
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
  // For a step that acts on users or hosts: the ones the approver kept ticked.
  targets?: Array<string> | undefined;
}

/*
 * Why a step acts on an entity: what puts it on the attacker's side of the
 * case (SecurityPlaybookTargets).
 */
export enum SecurityPlaybookTargetReason {
  // A detection of the case is grouped on it: the case is about it.
  GroupedOn = "Grouped On",
  // It is a known indicator in the project's threat intel.
  ThreatIntel = "Threat Intel",
}

export enum SecurityPlaybookTargetState {
  // Chosen by the rule; waiting for the approver, or about to be acted on.
  Proposed = "Proposed",
  // The approver unticked it.
  LeftOut = "Left Out",
  // On the project's protected list, which containment never touches.
  Protected = "Protected",
  Done = "Done",
  AlreadyDone = "Already Done",
  NotFound = "Not Found",
  Failed = "Failed",
  // Contained by the step, then released with its undo.
  Undone = "Undone",
}

/*
 * One user or host a step that acts on entities picked, and what became of
 * it, from the approval to its undo.
 */
export interface SecurityPlaybookTarget {
  type: SecurityEntityType;
  value: string;
  reason: SecurityPlaybookTargetReason;
  state: SecurityPlaybookTargetState;
  // What happened to it, in a few words: "suspended", or the product's refusal.
  detail?: string | undefined;
  // For a protected one: the protected entry it matches.
  protectedBy?: string | undefined;
  // For an undone one: who released it, and when (ISO 8601).
  undoneByUserId?: string | undefined;
  undoneAt?: string | undefined;
}

/*
 * Contained by the step itself, so its undo can release it. One that was
 * already so before the step ran (an account suspended by hand) is not the
 * step's to give back.
 */
export function wasContainedByStep(target: SecurityPlaybookTarget): boolean {
  return target.state === SecurityPlaybookTargetState.Done;
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
  // For a step that acts on users or hosts: the ones it picked, and how each went.
  targets?: Array<SecurityPlaybookTarget> | undefined;
  /*
   * For a step that looks something up and succeeded: whether it found
   * something (a known-bad entity, activity), which a later step's
   * condition can wait on (SecurityPlaybookStepCondition).
   */
  found?: boolean | undefined;
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

function readTextList(value: JSONValue | undefined): Array<string> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const texts: Array<string> = [];

  for (const item of value as Array<unknown>) {
    if (typeof item === "string" && item.length > 0) {
      texts.push(item);
    }
  }

  return texts.slice(0, SECURITY_ENTITY_LIMIT);
}

function readEnumValue<T extends string>(
  value: JSONValue | undefined,
  values: Record<string, T>,
): T | undefined {
  return (Object.values(values) as Array<string>).includes(String(value))
    ? (value as T)
    : undefined;
}

// A step's stored targets, read defensively: a malformed entry is dropped.
export function readStepTargets(
  value: unknown,
): Array<SecurityPlaybookTarget> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const targets: Array<SecurityPlaybookTarget> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: JSONObject = item as JSONObject;
    const entityValue: string | undefined = readText(record["value"]);
    const type: SecurityEntityType | undefined = readEnumValue(
      record["type"],
      SecurityEntityType,
    );
    const reason: SecurityPlaybookTargetReason | undefined = readEnumValue(
      record["reason"],
      SecurityPlaybookTargetReason,
    );
    const state: SecurityPlaybookTargetState | undefined = readEnumValue(
      record["state"],
      SecurityPlaybookTargetState,
    );

    if (!entityValue || !type || !reason || !state) {
      continue;
    }

    targets.push({
      type,
      value: entityValue,
      reason,
      state,
      detail: readText(record["detail"]),
      protectedBy: readText(record["protectedBy"]),
      undoneByUserId: readText(record["undoneByUserId"]),
      undoneAt: readText(record["undoneAt"]),
    });

    if (targets.length >= SECURITY_ENTITY_LIMIT) {
      break;
    }
  }

  return targets;
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
    targets: readTextList(approval["targets"]),
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
      targets: readStepTargets(item?.["targets"]),
      found: typeof item?.["found"] === "boolean" ? item["found"] : undefined,
    };
  });
}
