import axios, { AxiosResponse } from "axios";
import logger from "Common/Server/Utils/Logger";
import {
  BashStepConfig,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  KubernetesAction,
  KubernetesStepConfig,
  RunbookStep,
  SSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
import { JSONObject } from "Common/Types/JSON";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  resolveAgentClaimTimeoutInMs,
  resolveStepExecutionTimeoutInMs,
} from "Common/Types/Runbook/RunbookStepTimeout";
import ObjectID from "Common/Types/ObjectID";
import RunnerJobService, {
  isTerminalAgentJobStatus,
} from "Common/Server/Services/RunnerJobService";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";

export interface StepRunResult {
  success: boolean;
  output: string;
  errorMessage?: string;
}

export interface StepExecutionContext {
  projectId: ObjectID;
  runbookExecutionId: ObjectID;
  /*
   * Extra execution context consumed by AI steps: what triggered the run,
   * and the state of every step that ran before the current one. Optional
   * so agent/HTTP steps can keep ignoring it.
   */
  runbookName?: string | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  triggeredByUserId?: ObjectID | undefined;
  previousStepExecutions?: Array<RunbookStepExecutionState> | undefined;
}

const MAX_OUTPUT_BYTES: number = 50_000;

export function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }
  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

// Translate a finished agent job row into the step result the runner records.
function toStepResult(job: RunnerJob): StepRunResult {
  const output: string = truncate(job.output || "");

  if (job.status === RunnerJobStatus.Succeeded) {
    return { success: true, output };
  }

  return {
    success: false,
    output,
    errorMessage:
      job.errorMessage ||
      (typeof job.exitCode === "number"
        ? `Exit code ${job.exitCode}`
        : `Step ended with status ${job.status ?? "unknown"}`),
  };
}

/*
 * Bash and JavaScript steps share an identical dispatch path: enqueue a job
 * targeted at a specific agent, poll until the agent reports back. Only the
 * stepType differs — the agent uses it to pick the right local executor.
 */
async function dispatchToAgent(args: {
  stepType: RunbookStepType;
  step: RunbookStep;
  ctx: StepExecutionContext;
  script: string;
  timeoutInMs: number;
  claimTimeoutInMs: number;
  agentId: string;
  missingAgentError: string;
  /*
   * Structured instructions for step types that are not a script. Never
   * secret material — the credential is resolved at claim time.
   */
  payload?: JSONObject | undefined;
}): Promise<StepRunResult> {
  const agentIdRaw: string = args.agentId.trim();

  if (!agentIdRaw) {
    return {
      success: false,
      output: "",
      errorMessage: args.missingAgentError,
    };
  }

  /*
   * A script step with nothing to run is a no-op, not a failure. Steps that
   * carry a payload instead of a script are exempt: an empty script is their
   * normal shape.
   */
  if (!args.script && !args.payload) {
    return { success: true, output: "" };
  }

  let targetAgentId: ObjectID;
  try {
    targetAgentId = new ObjectID(agentIdRaw);
  } catch {
    return {
      success: false,
      output: "",
      errorMessage: `Invalid agent ID configured on the step: ${agentIdRaw}`,
    };
  }

  try {
    /*
     * A runbook execution occupies one BullMQ job for its whole run, so a
     * Worker restart mid-step gets the execution redelivered and walks us back
     * to this same step. Enqueueing again would hand the agent a second copy
     * of the script — a database restore run twice. The row this step already
     * produced is the source of truth: adopt it if it finished, wait on it if
     * it did not.
     */
    const existingJob: RunnerJob | null =
      await RunnerJobService.findLatestJobForStep({
        runbookExecutionId: args.ctx.runbookExecutionId,
        stepId: args.step.id,
      });

    if (existingJob && isTerminalAgentJobStatus(existingJob.status)) {
      logger.info(
        `Runbook step ${args.step.id} already has a finished agent job (${existingJob.status}); adopting its result instead of re-running it.`,
      );
      return toStepResult(existingJob);
    }

    let jobId: ObjectID;
    /*
     * Anchors the claim + execution window. Re-attaching keeps the original
     * job's clock so a step cannot buy itself another full window on each
     * redelivery; a fresh dispatch starts its window now.
     */
    let waitStartedAt: Date | undefined = undefined;

    if (existingJob) {
      logger.info(
        `Runbook step ${args.step.id} already has an in-flight agent job (${existingJob.status}); re-attaching to it rather than dispatching a second one.`,
      );
      jobId = new ObjectID(existingJob._id!);
      waitStartedAt = existingJob.createdAt;
    } else {
      const job: RunnerJob = await RunnerJobService.enqueue({
        projectId: args.ctx.projectId,
        runbookExecutionId: args.ctx.runbookExecutionId,
        stepId: args.step.id,
        stepType: args.stepType,
        targetAgentId,
        script: args.script,
        timeoutInMs: args.timeoutInMs,
        claimTimeoutInMs: args.claimTimeoutInMs,
        ...(args.payload ? { payload: args.payload } : {}),
      });
      jobId = new ObjectID(job._id!);
    }

    const terminal: RunnerJob = await RunnerJobService.pollUntilTerminal({
      jobId,
      claimTimeoutInMs: args.claimTimeoutInMs,
      executionTimeoutInMs: args.timeoutInMs,
      waitStartedAt,
    });

    return toStepResult(terminal);
  } catch (err) {
    logger.error(`${args.stepType} step dispatch failed`);
    logger.error(err);
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runJavaScriptStep(
  step: RunbookStep,
  ctx: StepExecutionContext,
): Promise<StepRunResult> {
  const config: JavaScriptStepConfig = step.config as JavaScriptStepConfig;
  return dispatchToAgent({
    stepType: RunbookStepType.JavaScript,
    step,
    ctx,
    script: config.script || "",
    timeoutInMs: resolveStepExecutionTimeoutInMs(config.timeoutInMs),
    claimTimeoutInMs: resolveAgentClaimTimeoutInMs(config.claimTimeoutInMs),
    agentId: config.agentId || "",
    missingAgentError:
      "JavaScript step is missing a Runbook Agent. Pick an agent under Runbooks → Agents. JavaScript no longer runs on the OneUptime Worker.",
  });
}

export async function runHttpStep(step: RunbookStep): Promise<StepRunResult> {
  const config: HttpRequestStepConfig = step.config as HttpRequestStepConfig;
  const timeout: number = resolveStepExecutionTimeoutInMs(config.timeoutInMs);

  let headers: Record<string, string> = {};
  if (config.headersJson) {
    try {
      headers = JSON.parse(config.headersJson);
    } catch (err) {
      return {
        success: false,
        output: "",
        errorMessage: `Invalid headers JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  let parsedBody: unknown = config.body;
  if (config.body) {
    try {
      parsedBody = JSON.parse(config.body);
    } catch {
      parsedBody = config.body;
    }
  }

  try {
    const response: AxiosResponse = await axios.request({
      url: config.url,
      method: config.method,
      headers,
      data: parsedBody,
      timeout,
      validateStatus: () => {
        return true;
      },
    });

    const body: string =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data, null, 2);

    const output: string = [
      `Status: ${response.status} ${response.statusText}`,
      `Headers: ${JSON.stringify(response.headers, null, 2)}`,
      `Body: ${body}`,
    ].join("\n");

    if (response.status >= 200 && response.status < 400) {
      return { success: true, output: truncate(output) };
    }

    return {
      success: false,
      output: truncate(output),
      errorMessage: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runBashStep(
  step: RunbookStep,
  ctx: StepExecutionContext,
): Promise<StepRunResult> {
  const config: BashStepConfig = step.config as BashStepConfig;
  return dispatchToAgent({
    stepType: RunbookStepType.Bash,
    step,
    ctx,
    script: config.script || "",
    timeoutInMs: resolveStepExecutionTimeoutInMs(config.timeoutInMs),
    claimTimeoutInMs: resolveAgentClaimTimeoutInMs(config.claimTimeoutInMs),
    agentId: config.agentId || "",
    missingAgentError:
      "Bash step is missing a Runbook Agent. Pick an agent under Runbooks → Agents.",
  });
}

export async function runSshStep(
  step: RunbookStep,
  ctx: StepExecutionContext,
): Promise<StepRunResult> {
  const config: SSHStepConfig = step.config as SSHStepConfig;

  if (!config.credentialId) {
    return {
      success: false,
      output: "",
      errorMessage:
        "SSH step is missing a credential. Pick one under Runbooks → Credentials.",
    };
  }

  if (!config.command) {
    return {
      success: false,
      output: "",
      errorMessage: "SSH step has no command to run.",
    };
  }

  return dispatchToAgent({
    stepType: RunbookStepType.SSH,
    step,
    ctx,
    script: "",
    payload: {
      credentialId: config.credentialId,
      command: config.command,
    },
    timeoutInMs: resolveStepExecutionTimeoutInMs(config.timeoutInMs),
    claimTimeoutInMs: resolveAgentClaimTimeoutInMs(config.claimTimeoutInMs),
    agentId: config.agentId || "",
    missingAgentError:
      "SSH step is missing a Runner. Pick one under Runbooks → Runners.",
  });
}

export async function runKubernetesStep(
  step: RunbookStep,
  ctx: StepExecutionContext,
): Promise<StepRunResult> {
  const config: KubernetesStepConfig = step.config as KubernetesStepConfig;

  if (!config.credentialId) {
    return {
      success: false,
      output: "",
      errorMessage:
        "Kubernetes step is missing a credential. Pick one under Runbooks → Credentials.",
    };
  }

  if (!config.namespace || !config.workloadName) {
    return {
      success: false,
      output: "",
      errorMessage: "Kubernetes step needs a namespace and a workload name.",
    };
  }

  /*
   * Scaling to an unspecified replica count is not a safe default in either
   * direction, so it is an error rather than a guess. Zero is legitimate.
   */
  if (
    config.action === KubernetesAction.ScaleWorkload &&
    (config.replicas === undefined || config.replicas === null)
  ) {
    return {
      success: false,
      output: "",
      errorMessage: "Scale step needs a replica count.",
    };
  }

  return dispatchToAgent({
    stepType: RunbookStepType.Kubernetes,
    step,
    ctx,
    script: "",
    payload: {
      credentialId: config.credentialId,
      action: config.action,
      workloadKind: config.workloadKind,
      namespace: config.namespace,
      workloadName: config.workloadName,
      ...(config.replicas === undefined ? {} : { replicas: config.replicas }),
    },
    timeoutInMs: resolveStepExecutionTimeoutInMs(config.timeoutInMs),
    claimTimeoutInMs: resolveAgentClaimTimeoutInMs(config.claimTimeoutInMs),
    agentId: config.agentId || "",
    missingAgentError:
      "Kubernetes step is missing a Runner. Pick one under Runbooks → Runners.",
  });
}
