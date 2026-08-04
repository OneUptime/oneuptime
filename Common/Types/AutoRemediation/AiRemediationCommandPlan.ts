import RunbookStepType from "../Runbook/RunbookStepType";
import { JSONObject } from "../JSON";

/*
 * The AI-composed command plan stored on
 * AutoRemediationSuggestion.commandPlan (jsonb). Everything in here is
 * DATA authored by an AI run and frozen at settle time — approval executes
 * exactly what was recorded, never a re-derived command. Secret material
 * never appears here: commands reference credentials by id and the Runner
 * resolves them at claim time.
 */

/*
 * The only step types an AI remediation run may compose. Kubernetes stays
 * runbook-only: its structured restart/scale actions cannot express an
 * arbitrary command, which is the whole point of this lane, and operators
 * who want kubectl can expose it to a Bash command instead.
 */
export const AI_COMMAND_STEP_TYPES: Array<RunbookStepType> = [
  RunbookStepType.Bash,
  RunbookStepType.SSH,
];

export enum AiRemediationCommandPolicyVerdict {
  /*
   * Matched the rule's operator-authored allowlist and passed the
   * structural chain guard — eligible for FullAuto inline execution.
   */
  AutoApproved = "AutoApproved",
  // Not denylisted, but a human must approve before it runs.
  RequiresApproval = "RequiresApproval",
  /*
   * Matched the hard denylist. Denied commands are never stored in a plan —
   * the verdict exists so policy evaluation has a complete result type.
   */
  Denied = "Denied",
}

export enum AiRemediationCommandExecutionStatus {
  Pending = "Pending",
  Running = "Running",
  Succeeded = "Succeeded",
  Failed = "Failed",
  // An earlier command in the plan failed, so this one never ran.
  Skipped = "Skipped",
}

export enum AiRemediationPlanExecutionStatus {
  NotStarted = "NotStarted",
  Running = "Running",
  Completed = "Completed",
  Failed = "Failed",
}

export enum AiRemediationRollbackStatus {
  NotAttempted = "NotAttempted",
  Completed = "Completed",
  Failed = "Failed",
  // No executed command carried a rollback command.
  NotApplicable = "NotApplicable",
}

export interface AiRemediationCommandExecutionState {
  status: AiRemediationCommandExecutionStatus;
  runnerJobId?: string | undefined;
  output?: string | undefined;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
  startedAt?: string | undefined; // ISO 8601
  completedAt?: string | undefined; // ISO 8601
}

export interface AiRemediationCommand {
  // 1-based position; plans execute strictly in sequence order.
  sequence: number;
  // One of AI_COMMAND_STEP_TYPES. SSH requires credentialId.
  stepType: RunbookStepType;
  runnerId: string;
  runnerNameSnapshot: string;
  credentialId?: string | undefined;
  credentialNameSnapshot?: string | undefined;
  command: string;
  timeoutInMs: number;
  // Why the AI wants to run this — shown verbatim on the approval card.
  rationale: string;
  expectedEffect: string;
  /*
   * Optional undo command, validated by the same policy as the forward
   * command. Executed on verification failure only when it, too, passed
   * policy (approval of the plan covers the rollback commands shown on it).
   */
  rollbackCommand?: string | undefined;
  policyVerdict: AiRemediationCommandPolicyVerdict;
  // True when a FullAuto run already executed this inline during planning.
  wasAutoExecuted?: boolean | undefined;
  execution?: AiRemediationCommandExecutionState | undefined;
  rollbackExecution?: AiRemediationCommandExecutionState | undefined;
}

export interface AiRemediationCommandPlan {
  commands: Array<AiRemediationCommand>;
  /*
   * Lifecycle of the approved-plan execution sweep. FullAuto inline
   * commands are executed during the AI run itself and settle with
   * Completed here.
   */
  executionStatus?: AiRemediationPlanExecutionStatus | undefined;
  executionStartedAt?: string | undefined;
  executionCompletedAt?: string | undefined;
  rollbackStatus?: AiRemediationRollbackStatus | undefined;
}

// Hard caps — enforced at plan acceptance, not just in the prompt.
export const MAX_PLAN_COMMANDS: number = 5;
export const MAX_COMMAND_LENGTH_CHARS: number = 2000;
export const MIN_COMMAND_TIMEOUT_MS: number = 1000;
export const MAX_COMMAND_TIMEOUT_MS: number = 5 * 60 * 1000;
export const DEFAULT_COMMAND_TIMEOUT_MS: number = 60 * 1000;

export class AiRemediationCommandPlanUtil {
  /*
   * Parse a jsonb column value back into a typed plan. Fail-closed: any
   * structural problem returns null rather than a partially-valid plan,
   * because the executor and verifier act on what this returns.
   */
  public static parse(
    json: JSONObject | undefined | null,
  ): AiRemediationCommandPlan | null {
    if (!json || typeof json !== "object") {
      return null;
    }

    const commandsRaw: unknown = json["commands"];
    if (!Array.isArray(commandsRaw) || commandsRaw.length === 0) {
      return null;
    }

    if (commandsRaw.length > MAX_PLAN_COMMANDS) {
      return null;
    }

    const commands: Array<AiRemediationCommand> = [];

    for (const item of commandsRaw) {
      if (!item || typeof item !== "object") {
        return null;
      }
      const obj: JSONObject = item as JSONObject;

      const stepType: string = String(obj["stepType"] || "");
      if (!AI_COMMAND_STEP_TYPES.includes(stepType as RunbookStepType)) {
        return null;
      }

      const command: string =
        typeof obj["command"] === "string" ? obj["command"] : "";
      const runnerId: string =
        typeof obj["runnerId"] === "string" ? obj["runnerId"] : "";
      if (!command.trim() || !runnerId.trim()) {
        return null;
      }

      if (command.length > MAX_COMMAND_LENGTH_CHARS) {
        return null;
      }

      if (
        stepType === RunbookStepType.SSH &&
        (typeof obj["credentialId"] !== "string" || !obj["credentialId"].trim())
      ) {
        return null;
      }

      const verdict: string = String(obj["policyVerdict"] || "");
      if (
        verdict !== AiRemediationCommandPolicyVerdict.AutoApproved &&
        verdict !== AiRemediationCommandPolicyVerdict.RequiresApproval
      ) {
        // Denied commands must never have been stored.
        return null;
      }

      const timeoutRaw: unknown = obj["timeoutInMs"];
      const timeoutInMs: number =
        typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw)
          ? Math.min(
              MAX_COMMAND_TIMEOUT_MS,
              Math.max(MIN_COMMAND_TIMEOUT_MS, Math.floor(timeoutRaw)),
            )
          : DEFAULT_COMMAND_TIMEOUT_MS;

      commands.push({
        sequence:
          typeof obj["sequence"] === "number"
            ? obj["sequence"]
            : commands.length + 1,
        stepType: stepType as RunbookStepType,
        runnerId: runnerId,
        runnerNameSnapshot:
          typeof obj["runnerNameSnapshot"] === "string"
            ? obj["runnerNameSnapshot"]
            : "Runner",
        credentialId:
          typeof obj["credentialId"] === "string"
            ? obj["credentialId"]
            : undefined,
        credentialNameSnapshot:
          typeof obj["credentialNameSnapshot"] === "string"
            ? obj["credentialNameSnapshot"]
            : undefined,
        command: command,
        timeoutInMs: timeoutInMs,
        rationale: typeof obj["rationale"] === "string" ? obj["rationale"] : "",
        expectedEffect:
          typeof obj["expectedEffect"] === "string"
            ? obj["expectedEffect"]
            : "",
        rollbackCommand:
          typeof obj["rollbackCommand"] === "string" &&
          obj["rollbackCommand"].trim()
            ? obj["rollbackCommand"]
            : undefined,
        policyVerdict: verdict as AiRemediationCommandPolicyVerdict,
        wasAutoExecuted: obj["wasAutoExecuted"] === true,
        execution: AiRemediationCommandPlanUtil.parseExecutionState(
          obj["execution"],
        ),
        rollbackExecution: AiRemediationCommandPlanUtil.parseExecutionState(
          obj["rollbackExecution"],
        ),
      });
    }

    // Execution order must be unambiguous.
    commands.sort((a: AiRemediationCommand, b: AiRemediationCommand) => {
      return a.sequence - b.sequence;
    });

    const plan: AiRemediationCommandPlan = { commands };

    const executionStatus: string = String(json["executionStatus"] || "");
    if (
      Object.values(AiRemediationPlanExecutionStatus).includes(
        executionStatus as AiRemediationPlanExecutionStatus,
      )
    ) {
      plan.executionStatus =
        executionStatus as AiRemediationPlanExecutionStatus;
    }
    if (typeof json["executionStartedAt"] === "string") {
      plan.executionStartedAt = json["executionStartedAt"];
    }
    if (typeof json["executionCompletedAt"] === "string") {
      plan.executionCompletedAt = json["executionCompletedAt"];
    }
    const rollbackStatus: string = String(json["rollbackStatus"] || "");
    if (
      Object.values(AiRemediationRollbackStatus).includes(
        rollbackStatus as AiRemediationRollbackStatus,
      )
    ) {
      plan.rollbackStatus = rollbackStatus as AiRemediationRollbackStatus;
    }

    return plan;
  }

  public static toJSON(plan: AiRemediationCommandPlan): JSONObject {
    return JSON.parse(JSON.stringify(plan)) as JSONObject;
  }

  private static parseExecutionState(
    value: unknown,
  ): AiRemediationCommandExecutionState | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const obj: JSONObject = value as JSONObject;
    const status: string = String(obj["status"] || "");
    if (
      !Object.values(AiRemediationCommandExecutionStatus).includes(
        status as AiRemediationCommandExecutionStatus,
      )
    ) {
      return undefined;
    }
    return {
      status: status as AiRemediationCommandExecutionStatus,
      runnerJobId:
        typeof obj["runnerJobId"] === "string" ? obj["runnerJobId"] : undefined,
      output: typeof obj["output"] === "string" ? obj["output"] : undefined,
      exitCode:
        typeof obj["exitCode"] === "number" ? obj["exitCode"] : undefined,
      errorMessage:
        typeof obj["errorMessage"] === "string"
          ? obj["errorMessage"]
          : undefined,
      startedAt:
        typeof obj["startedAt"] === "string" ? obj["startedAt"] : undefined,
      completedAt:
        typeof obj["completedAt"] === "string" ? obj["completedAt"] : undefined,
    };
  }
}
