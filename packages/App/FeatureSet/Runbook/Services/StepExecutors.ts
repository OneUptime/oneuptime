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
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import GlobalRunnerChoice from "Common/Server/Utils/Runner/GlobalRunnerChoice";
import {
  RunnerChoiceDecision,
  getRunnerChoiceRefusalFromStep,
} from "Common/Types/Runner/RunnerChoice";
import { clampGlobalRunnerExecutionTimeoutInMs } from "Common/Types/Runner/GlobalRunnerWork";

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
  /*
   * What started the run, more about it (a scheduled time), and the values
   * it was started with (a webhook call's body). The AI step's trigger
   * context names them; Bash and JavaScript steps get the inputs from the
   * Runner, as data (Types/Runbook/RunbookInputs).
   */
  trigger?: RunbookTriggerType | undefined;
  triggerDetails?: JSONObject | undefined;
  inputs?: JSONObject | undefined;
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
 * Bash, JavaScript, SSH and Kubernetes steps share one dispatch path: decide
 * where the step runs, enqueue a job for it, poll until it reports back.
 * Only the stepType differs — the Runner uses it to pick the right local
 * executor.
 *
 * Where it runs is the one "global by default" rule (GlobalRunnerChoice): the
 * Runner the step picked, always, when it picked one of its project's own;
 * the global Runners - the ones OneUptime runs for every project - when it
 * picked none and they may run it; otherwise nowhere, and the step fails
 * saying why and what to do.
 *
 * What the step says alone is checked first, before anything is read: a
 * step that names its Runner by something that is not an ID, or a Bash, SSH
 * or Kubernetes step with no Runner, can never run, and never could have
 * been sent. After that the rule's server facts decide a NEW dispatch only. A
 * step that already has a job - the Worker restarted mid-step and walked
 * back to it - adopts that job's result, or waits on it, whatever the facts
 * say now: the job was sent where the rule said when it was sent, and may be
 * running there.
 */
async function dispatchToAgent(args: {
  stepType: RunbookStepType;
  step: RunbookStep;
  ctx: StepExecutionContext;
  script: string;
  timeoutInMs: number;
  claimTimeoutInMs: number;
  agentId: string;
  /*
   * Structured instructions for step types that are not a script. Never
   * secret material — the credential is resolved at claim time.
   */
  payload?: JSONObject | undefined;
}): Promise<StepRunResult> {
  const refusalFromStep: RunnerChoiceDecision | null =
    getRunnerChoiceRefusalFromStep({
      stepType: args.stepType,
      chosenRunnerId: args.agentId,
    });

  if (refusalFromStep?.kind === "refused") {
    return {
      success: false,
      output: "",
      errorMessage: refusalFromStep.message,
    };
  }

  /*
   * A script step with nothing to run is a no-op, not a failure. Steps that
   * carry a payload instead of a script are exempt: an empty script is their
   * normal shape. Asked after the Runner is decided, as it always was: a
   * step that cannot run anywhere says so even when its script is empty.
   */
  const isNoOp: boolean = !args.script && !args.payload;

  try {
    /*
     * A runbook execution occupies one BullMQ job for its whole run, so a
     * Worker restart mid-step gets the execution redelivered and walks us back
     * to this same step. Enqueueing again would hand the agent a second copy
     * of the script — a database restore run twice. The row this step already
     * produced is the source of truth: adopt it if it finished, wait on it if
     * it did not - before the rule below is asked anything, since what it
     * would say now (the project turned global Runners off since, say) is not
     * where the job went.
     */
    const existingJob: RunnerJob | null = isNoOp
      ? null
      : await RunnerJobService.findLatestJobForStep({
          runbookExecutionId: args.ctx.runbookExecutionId,
          stepId: args.step.id,
        });

    if (existingJob && isTerminalAgentJobStatus(existingJob.status)) {
      logger.info(
        `Runbook step ${args.step.id} already has a finished agent job (${existingJob.status}); adopting its result instead of re-running it.`,
      );
      return toStepResult(existingJob);
    }

    if (existingJob) {
      logger.info(
        `Runbook step ${args.step.id} already has an in-flight agent job (${existingJob.status}); re-attaching to it rather than dispatching a second one.`,
      );

      /*
       * Re-attaching keeps the original job's clock, so a step cannot buy
       * itself another full window on each redelivery - and the window the
       * job was sent with: a global Runner's is held to its most.
       */
      const terminal: RunnerJob = await RunnerJobService.pollUntilTerminal({
        jobId: new ObjectID(existingJob._id!),
        claimTimeoutInMs: args.claimTimeoutInMs,
        executionTimeoutInMs: existingJob.runsOnGlobalRunner
          ? clampGlobalRunnerExecutionTimeoutInMs(args.timeoutInMs)
          : args.timeoutInMs,
        waitStartedAt: existingJob.createdAt,
      });

      return toStepResult(terminal);
    }
  } catch (err) {
    logger.error(`${args.stepType} step dispatch failed`);
    logger.error(err);
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  let decision: RunnerChoiceDecision;

  try {
    decision = await GlobalRunnerChoice.decideForStep({
      projectId: args.ctx.projectId,
      stepType: args.stepType,
      chosenRunnerId: args.agentId,
    });
  } catch (err) {
    logger.error(`${args.stepType} step: could not decide its Runner`);
    logger.error(err);
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (decision.kind === "refused") {
    return {
      success: false,
      output: "",
      errorMessage: decision.message,
    };
  }

  if (isNoOp) {
    return { success: true, output: "" };
  }

  const runsOnGlobalRunner: boolean = decision.kind === "global";

  /*
   * A global Runner runs a step for a few minutes at most, whatever the
   * step asked for; the wait below is held to the same window.
   */
  const executionTimeoutInMs: number = runsOnGlobalRunner
    ? clampGlobalRunnerExecutionTimeoutInMs(args.timeoutInMs)
    : args.timeoutInMs;

  try {
    const job: RunnerJob = await RunnerJobService.enqueue({
      projectId: args.ctx.projectId,
      runbookExecutionId: args.ctx.runbookExecutionId,
      stepId: args.step.id,
      stepType: args.stepType,
      ...(decision.kind === "custom"
        ? { targetAgentId: new ObjectID(decision.runnerId) }
        : { runsOnGlobalRunner: true }),
      script: args.script,
      timeoutInMs: executionTimeoutInMs,
      claimTimeoutInMs: args.claimTimeoutInMs,
      ...(args.payload ? { payload: args.payload } : {}),
    });

    // A fresh dispatch starts its window now.
    const terminal: RunnerJob = await RunnerJobService.pollUntilTerminal({
      jobId: new ObjectID(job._id!),
      claimTimeoutInMs: args.claimTimeoutInMs,
      executionTimeoutInMs,
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
    /*
     * url/method/headers/body come verbatim out of the Runbook's steps JSON,
     * and the output builder below copies the full status, headers and body
     * into RunbookExecution.stepExecutions — readable by any project member.
     * Unguarded, that is a fully attacker-shaped request into whatever network
     * the Worker runs in, with the response handed straight back (an
     * attacker-chosen method plus headers is all IMDSv2 asks for).
     *
     * So: validate the target and pin the addresses it resolved to, and refuse
     * redirects — pinning covers only the host that was validated, so a 3xx
     * would walk around it. maxRedirects rather than doNotFollowRedirects
     * because this is raw axios, not Common's API wrapper.
     */
    const { httpAgent, httpsAgent } =
      await DataSourceEgressGuard.assertUrlAllowedAndPin(config.url || "", {
        targetLabel: "Runbook HTTP step",
      });

    const response: AxiosResponse = await axios.request({
      url: config.url,
      method: config.method,
      headers,
      data: parsedBody,
      timeout,
      maxRedirects: 0,
      httpAgent,
      httpsAgent,
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
        "SSH step is missing a credential. Pick one under Runbooks → Runner Credentials.",
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
        "Kubernetes step is missing a credential. Pick one under Runbooks → Runner Credentials.",
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
  });
}
