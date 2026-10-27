import axios, { AxiosResponse } from "axios";
import logger from "Common/Server/Utils/Logger";
import {
  BashStepConfig,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  KubernetesStepConfig,
  RunbookStep,
  SSHStepConfig,
  isLegacyKubernetesStepConfig,
  isLegacySSHStepConfig,
} from "Common/Types/Runbook/RunbookStep";
import {
  RunbookVariableReference,
  findRunbookVariableReferencesIn,
  getRunbookVariableReferenceKey,
  parseSingleRunbookVariableReference,
} from "Common/Types/Runbook/RunbookVariableReference";
import {
  RunbookVariableProblem,
  RunbookVariableProblemReason,
  describeRunbookVariableProblems,
} from "Common/Types/Runbook/RunbookVariableProblems";
import RunbookVariableResolver, {
  ResolvedRunbookVariable,
  RunbookVariableResolution,
} from "Common/Server/Utils/Runbook/RunbookVariableResolver";
import { REMOVED_RUNBOOK_CREDENTIAL_STEP_MESSAGE } from "Common/Types/Runbook/RunbookLegacySteps";
import {
  fillHttpStepConfig,
  getHttpStepVariableTexts,
  redactHttpStepSecrets,
} from "Common/Types/Runbook/HttpStepVariables";
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
   * The runbook the run is of: where a step's own variables
   * ({{local.variables.NAME}}) are read from.
   */
  runbookId?: ObjectID | undefined;
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
 * Where it runs is the one rule, in its default order (GlobalRunnerChoice):
 * the Runner the step picked, always, when it picked one of its project's
 * own; its project's default Runner when it picked none and the project has
 * one; the global Runners - the ones OneUptime runs for every project - when
 * it picked none (or picked the Global Runner) and they may run it;
 * otherwise nowhere, and the step fails saying why and what to do.
 *
 * What the step says alone is checked first, before anything is read: a
 * step that names its Runner by something that is not an ID, or a Bash, SSH
 * or Kubernetes step that picked the Global Runner, can never run, and never
 * could have been sent. After that the rule's server facts decide a NEW
 * dispatch only. A
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
   * secret material — the variables a step names are filled in when a
   * Runner takes it.
   */
  payload?: JSONObject | undefined;
  /*
   * The fields of the step that name runbook variables, and of those the
   * ones that take a secret (one reference each). Checked before a new job
   * is sent (getVariableRefusal); the values are read only when a Runner
   * takes it.
   */
  variableTexts?: Array<string> | undefined;
  secretFields?: Array<string> | undefined;
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

  try {
    const variableRefusal: string | null = await getVariableRefusal({
      ctx: args.ctx,
      texts: args.variableTexts || [],
      secretFields: args.secretFields || [],
    });

    if (variableRefusal) {
      return { success: false, output: "", errorMessage: variableRefusal };
    }
  } catch (err) {
    logger.error(`${args.stepType} step: could not read its variables`);
    logger.error(err);
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
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

/*
 * Why a step cannot have the variables it names, checked before a new job
 * is sent rather than after a Runner takes it: a variable no longer there
 * (or a runbook's own one outside a runbook run), and a field that takes a
 * secret naming one that is not. Whether its Runner may have a secret is
 * the claim's to say: the Runner is known only then. Null when it can.
 */
export async function getVariableRefusal(data: {
  ctx: StepExecutionContext;
  texts: Array<string>;
  secretFields: Array<string>;
}): Promise<string | null> {
  const references: Array<RunbookVariableReference> =
    findRunbookVariableReferencesIn(data.texts);

  if (references.length === 0) {
    return null;
  }

  const resolution: RunbookVariableResolution =
    await RunbookVariableResolver.resolve({
      projectId: data.ctx.projectId,
      runbookId: data.ctx.runbookId || null,
      references,
      access: { kind: "server" },
      includeValues: false,
    });

  const problems: Array<RunbookVariableProblem> = [...resolution.problems];

  for (const field of data.secretFields) {
    const reference: RunbookVariableReference | null =
      parseSingleRunbookVariableReference(field);

    const resolved: ResolvedRunbookVariable | undefined = reference
      ? resolution.variables.get(getRunbookVariableReferenceKey(reference))
      : undefined;

    if (reference && resolved && !resolved.isSecret) {
      problems.push({
        reference,
        reason: RunbookVariableProblemReason.NotSecret,
      });
    }
  }

  return problems.length > 0 ? describeRunbookVariableProblems(problems) : null;
}

// Why a field that takes a secret holds something else, or null.
function getSecretFieldRefusal(data: {
  field: string | undefined;
  what: string;
  isRequired: boolean;
}): string | null {
  const field: string = (data.field || "").trim();

  if (!field) {
    return data.isRequired
      ? `This step has no ${data.what}. Open the step and pick the secret variable that holds it.`
      : null;
  }

  return parseSingleRunbookVariableReference(field)
    ? null
    : `This step's ${data.what} is not one secret variable. Open the step and pick a secret variable.`;
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
    variableTexts: [config.script || ""],
  });
}

/*
 * Why an HTTP request step that names runbook variables is not sent when it
 * is run on its own, outside a runbook's run: there is no runbook to read
 * its own variables from, and nothing records what it was given.
 */
export const HTTP_STEP_VARIABLES_OUTSIDE_RUN_MESSAGE: string =
  "This step names runbook variables, which are read only when its runbook runs.";

export const HTTP_STEP_VARIABLES_UNREAD_MESSAGE: string =
  "This step's variables could not be read, so it was not sent. Try again in a moment.";

/*
 * An HTTP request step: OneUptime sends the request itself, from its own
 * servers, with the runbook variables its URL, headers and body name filled
 * in (Common/Types/Runbook/HttpStepVariables) - a secret too, since no
 * Runner is involved. What it records - the response's status, headers and
 * body, or the error - has every secret it was given hidden.
 */
export async function runHttpStep(
  step: RunbookStep,
  ctx?: StepExecutionContext | undefined,
): Promise<StepRunResult> {
  const storedConfig: HttpRequestStepConfig =
    step.config as HttpRequestStepConfig;
  const timeout: number = resolveStepExecutionTimeoutInMs(
    storedConfig.timeoutInMs,
  );

  const references: Array<RunbookVariableReference> =
    findRunbookVariableReferencesIn(getHttpStepVariableTexts(storedConfig));

  let config: HttpRequestStepConfig = storedConfig;
  let secretValues: Array<string> = [];

  if (references.length > 0) {
    if (!ctx) {
      return {
        success: false,
        output: "",
        errorMessage: HTTP_STEP_VARIABLES_OUTSIDE_RUN_MESSAGE,
      };
    }

    let resolution: RunbookVariableResolution;

    try {
      resolution = await RunbookVariableResolver.resolve({
        projectId: ctx.projectId,
        runbookId: ctx.runbookId || null,
        references,
        // OneUptime sends the request itself: no Runner's list applies.
        access: { kind: "server" },
        includeValues: true,
      });
    } catch (err) {
      logger.error("HttpRequest step: could not read its variables");
      logger.error(err);
      return {
        success: false,
        output: "",
        errorMessage: HTTP_STEP_VARIABLES_UNREAD_MESSAGE,
      };
    }

    // A variable it may not have: never sent with the placeholder in it.
    if (resolution.problems.length > 0) {
      return {
        success: false,
        output: "",
        errorMessage: describeRunbookVariableProblems(resolution.problems),
      };
    }

    config = fillHttpStepConfig(
      storedConfig,
      (reference: RunbookVariableReference): string | undefined => {
        return resolution.variables.get(
          getRunbookVariableReferenceKey(reference),
        )?.value;
      },
    );
    secretValues = resolution.secretValues;
  }

  /*
   * Hidden before anything is cut or kept: a secret cut in half by the
   * output's limit would show its first half.
   */
  const redact: (text: string) => string = (text: string): string => {
    return redactHttpStepSecrets(text, secretValues);
  };

  let headers: Record<string, string> = {};
  if (config.headersJson) {
    try {
      headers = JSON.parse(config.headersJson);
    } catch (err) {
      return {
        success: false,
        output: "",
        errorMessage: redact(
          `Invalid headers JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
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
     * because this is raw axios, not Common's API wrapper. The URL checked is
     * the one sent: its variables filled in.
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

    const output: string = redact(
      [
        `Status: ${response.status} ${response.statusText}`,
        `Headers: ${JSON.stringify(response.headers, null, 2)}`,
        `Body: ${body}`,
      ].join("\n"),
    );

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
      errorMessage: redact(err instanceof Error ? err.message : String(err)),
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
    variableTexts: [config.script || ""],
  });
}

/*
 * What an SSH or Kubernetes step written with a runbook credential (and
 * never moved to variables) ends with: runbook credentials were removed, so
 * it is not sent to a Runner. Its Steps page turns it into the script step
 * that does the same (isLegacyCredentialStep in the Dashboard).
 */
const REMOVED_CREDENTIAL_STEP_RESULT: StepRunResult = {
  success: false,
  output: "",
  errorMessage: REMOVED_RUNBOOK_CREDENTIAL_STEP_MESSAGE,
};

/*
 * An SSH step: sign in to a machine with a secret variable and run a bash
 * script there. Its job carries the references, never a value: the Runner
 * that takes it is handed the host, the user, the script and the key or
 * password, filled in for it (RunnerIngress, RunbookJobVariables).
 */
export async function runSshStep(
  step: RunbookStep,
  ctx: StepExecutionContext,
): Promise<StepRunResult> {
  const config: SSHStepConfig = step.config as SSHStepConfig;

  if (isLegacySSHStepConfig(config)) {
    return REMOVED_CREDENTIAL_STEP_RESULT;
  }

  const host: string = (config.host || "").trim();
  const username: string = (config.username || "").trim();
  const script: string = config.script || "";

  if (!host || !username) {
    return {
      success: false,
      output: "",
      errorMessage:
        "This SSH step has no machine to sign in to. Open the step and fill in SSH to, as user@host.",
    };
  }

  const secretRefusal: string | null =
    getSecretFieldRefusal({
      field: config.signIn,
      what: "key or password to sign in with",
      isRequired: true,
    }) ||
    getSecretFieldRefusal({
      field: config.passphrase,
      what: "key passphrase",
      isRequired: false,
    });

  if (secretRefusal) {
    return { success: false, output: "", errorMessage: secretRefusal };
  }

  if (!script.trim()) {
    return {
      success: false,
      output: "",
      errorMessage: "This SSH step has no script to run.",
    };
  }

  const port: number =
    typeof config.port === "number" &&
    Number.isInteger(config.port) &&
    config.port > 0 &&
    config.port <= 65535
      ? config.port
      : 22;

  return dispatchToAgent({
    stepType: RunbookStepType.SSH,
    step,
    ctx,
    script: "",
    payload: {
      host,
      username,
      port,
      signIn: (config.signIn || "").trim(),
      ...(config.passphrase && config.passphrase.trim()
        ? { passphrase: config.passphrase.trim() }
        : {}),
      script,
    },
    timeoutInMs: resolveStepExecutionTimeoutInMs(config.timeoutInMs),
    claimTimeoutInMs: resolveAgentClaimTimeoutInMs(config.claimTimeoutInMs),
    agentId: config.agentId || "",
    variableTexts: [
      host,
      username,
      config.signIn || "",
      config.passphrase || "",
      script,
    ],
    secretFields: [config.signIn || "", config.passphrase || ""],
  });
}

/*
 * A kubectl step: a bash script of kubectl commands, run on the step's
 * Runner with KUBECONFIG pointing at the kubeconfig it names - or at the
 * Runner's own access when it names none. Its job carries the references;
 * the Runner that takes it is handed the script and the kubeconfig, filled
 * in for it. A Runner older than kubectl scripts fails it, saying to update
 * the Runner (RunnerIngress).
 */
export async function runKubernetesStep(
  step: RunbookStep,
  ctx: StepExecutionContext,
): Promise<StepRunResult> {
  const config: KubernetesStepConfig = step.config as KubernetesStepConfig;

  if (isLegacyKubernetesStepConfig(config)) {
    return REMOVED_CREDENTIAL_STEP_RESULT;
  }

  const script: string = config.script || "";

  const kubeconfigRefusal: string | null = getSecretFieldRefusal({
    field: config.kubeconfig,
    what: "kubeconfig",
    isRequired: false,
  });

  if (kubeconfigRefusal) {
    return { success: false, output: "", errorMessage: kubeconfigRefusal };
  }

  if (!script.trim()) {
    return {
      success: false,
      output: "",
      errorMessage: "This kubectl step has no script to run.",
    };
  }

  return dispatchToAgent({
    stepType: RunbookStepType.Kubernetes,
    step,
    ctx,
    script: "",
    payload: {
      ...(config.kubeconfig && config.kubeconfig.trim()
        ? { kubeconfig: config.kubeconfig.trim() }
        : {}),
      script,
    },
    timeoutInMs: resolveStepExecutionTimeoutInMs(config.timeoutInMs),
    claimTimeoutInMs: resolveAgentClaimTimeoutInMs(config.claimTimeoutInMs),
    agentId: config.agentId || "",
    variableTexts: [config.kubeconfig || "", script],
    secretFields: [config.kubeconfig || ""],
  });
}
