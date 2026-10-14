import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookStepResult,
  readStepResults,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStepResult";

export interface RunStepRow {
  index: number;
  title: string;
  icon: IconProp;
  result: SecurityPlaybookStepResult | undefined;
  requiresApproval: boolean;
}

const STEP_STATUSES: Array<string> = Object.values(SecurityPlaybookStepStatus);

function readText(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// The results as stored, for a run whose step snapshot no longer reads.
function readStoredResults(
  value: JSONArray | undefined,
): Array<SecurityPlaybookStepResult> {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: Array<SecurityPlaybookStepResult> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: JSONObject = item as JSONObject;
    const status: string = String(record["status"] || "");

    results.push({
      stepId: String(record["stepId"] || ""),
      action: String(record["action"] || "") as SecurityPlaybookActionType,
      status: STEP_STATUSES.includes(status)
        ? (status as SecurityPlaybookStepStatus)
        : SecurityPlaybookStepStatus.Pending,
      message: readText(record["message"]),
      error: readText(record["error"]),
    });
  }

  return results;
}

/*
 * A run's steps beside what became of each. The steps are the run's own
 * snapshot, so a playbook edited after the run started still shows what
 * this run did. A snapshot that no longer reads (written by an older
 * version) falls back to the results alone.
 */
export function getRunStepRows(data: {
  steps: JSONArray | undefined;
  stepResults: JSONArray | undefined;
}): Array<RunStepRow> {
  let steps: Array<SecurityPlaybookStep> = [];

  try {
    steps = parseSecurityPlaybookSteps(data.steps || []);
  } catch {
    steps = [];
  }

  const results: Array<SecurityPlaybookStepResult> =
    steps.length > 0
      ? readStepResults(data.stepResults || [], steps)
      : readStoredResults(data.stepResults);

  const count: number = Math.max(steps.length, results.length);
  const rows: Array<RunStepRow> = [];

  for (let index: number = 0; index < count; index++) {
    const step: SecurityPlaybookStep | undefined = steps[index];
    const result: SecurityPlaybookStepResult | undefined = results[index];
    const action: string = step?.action || result?.action || "";
    const definition: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookAction(action);

    rows.push({
      index,
      title: definition?.title || action,
      icon: definition?.icon || IconProp.Circle,
      result,
      requiresApproval: Boolean(step?.requiresApproval),
    });
  }

  return rows;
}
