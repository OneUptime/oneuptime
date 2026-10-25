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
  doesStepNeedApproval,
  parseSecurityPlaybookSteps,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetState,
  readStepResults,
  readStepTargets,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStepResult";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

// The one-click undo's button on a contained target, by the action it runs.
export const UNDO_BUTTON_TITLES: Partial<
  Record<SecurityPlaybookActionType, string>
> = {
  [SecurityPlaybookActionType.UnsuspendOktaUser]: translationKey("Unsuspend"),
  [SecurityPlaybookActionType.LiftCrowdStrikeContainment]:
    translationKey("Lift Containment"),
  [SecurityPlaybookActionType.ReleaseDefenderDevice]: translationKey("Release"),
};

export interface RunStepRow {
  index: number;
  // The step's id in the run, which its undo names.
  stepId: string;
  action: string;
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
      targets: readStepTargets(record["targets"]),
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
      stepId: step?.id || result?.stepId || "",
      action,
      title: definition?.title || action,
      icon: definition?.icon || IconProp.Circle,
      result,
      requiresApproval: step ? doesStepNeedApproval(step) : false,
    });
  }

  return rows;
}

/*
 * The targets the step a run waits on asks the approver about, the way the
 * approval shows them: the ones to tick or untick, and the protected ones
 * it never acts on.
 */
export function getApprovalTargets(run: {
  steps?: JSONArray | undefined;
  stepResults?: JSONArray | undefined;
  currentStepIndex?: number | undefined;
}): {
  proposed: Array<SecurityPlaybookTarget>;
  protectedTargets: Array<SecurityPlaybookTarget>;
} {
  const row: RunStepRow | undefined = getRunStepRows({
    steps: run.steps,
    stepResults: run.stepResults,
  })[run.currentStepIndex || 0];
  const targets: Array<SecurityPlaybookTarget> = row?.result?.targets || [];

  return {
    proposed: targets.filter((target: SecurityPlaybookTarget): boolean => {
      return target.state === SecurityPlaybookTargetState.Proposed;
    }),
    protectedTargets: targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.Protected;
      },
    ),
  };
}

/*
 * A run in one line, for a list of runs that shows each run's steps only on
 * request: how far it got, and the step it stopped at when one failed or was
 * turned down.
 */
export interface RunStepsSummary {
  total: number;
  // Steps that are done: succeeded, or skipped because their condition did not hold.
  done: number;
  // The first step that failed or was rejected, which ended the run.
  stoppedAt: RunStepRow | undefined;
}

const DONE_STEP_STATUSES: ReadonlyArray<string> = [
  SecurityPlaybookStepStatus.Succeeded,
  SecurityPlaybookStepStatus.Skipped,
];

const STOPPING_STEP_STATUSES: ReadonlyArray<string> = [
  SecurityPlaybookStepStatus.Failed,
  SecurityPlaybookStepStatus.Rejected,
];

export function summarizeRunSteps(
  rows: ReadonlyArray<RunStepRow>,
): RunStepsSummary {
  return {
    total: rows.length,
    done: rows.filter((row: RunStepRow): boolean => {
      return DONE_STEP_STATUSES.includes(row.result?.status || "");
    }).length,
    stoppedAt: rows.find((row: RunStepRow): boolean => {
      return STOPPING_STEP_STATUSES.includes(row.result?.status || "");
    }),
  };
}

// Whether this person started the run: they cannot approve its steps.
export function didStartRun(
  triggeredByUserId: ObjectID | undefined | null,
  userId: ObjectID | undefined | null,
): boolean {
  return Boolean(
    triggeredByUserId &&
      userId &&
      triggeredByUserId.toString() === userId.toString(),
  );
}
