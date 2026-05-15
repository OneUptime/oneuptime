import axios, { AxiosResponse } from "axios";
import logger from "Common/Server/Utils/Logger";
import {
  BashStepConfig,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import ObjectID from "Common/Types/ObjectID";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import RunbookAgentJobStatus from "Common/Types/Runbook/RunbookAgentJobStatus";
import RunbookAgentJob from "Common/Models/DatabaseModels/RunbookAgentJob";

export interface StepRunResult {
  success: boolean;
  output: string;
  errorMessage?: string;
}

export interface StepExecutionContext {
  projectId: ObjectID;
  runbookExecutionId: ObjectID;
}

const MAX_OUTPUT_BYTES: number = 50_000;
const DEFAULT_SCRIPT_TIMEOUT_MS: number = 30_000;
const DEFAULT_HTTP_TIMEOUT_MS: number = 30_000;
const DEFAULT_AGENT_CLAIM_TIMEOUT_MS: number = 2 * 60_000;

function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }
  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

/*
 * Bash and JavaScript steps share an identical dispatch path: enqueue a job
 * targeted at a specific agent, poll until the agent reports back. Only the
 * stepType differs — the agent uses it to pick the right local executor.
 */
async function dispatchToAgent(args: {
  stepType: RunbookStepType.Bash | RunbookStepType.JavaScript;
  step: RunbookStep;
  ctx: StepExecutionContext;
  script: string;
  timeoutInMs: number;
  claimTimeoutInMs: number;
  agentId: string;
  missingAgentError: string;
}): Promise<StepRunResult> {
  const agentIdRaw: string = args.agentId.trim();

  if (!agentIdRaw) {
    return {
      success: false,
      output: "",
      errorMessage: args.missingAgentError,
    };
  }

  if (!args.script) {
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
    const job: RunbookAgentJob = await RunbookAgentJobService.enqueue({
      projectId: args.ctx.projectId,
      runbookExecutionId: args.ctx.runbookExecutionId,
      stepId: args.step.id,
      stepType: args.stepType,
      targetAgentId,
      script: args.script,
      timeoutInMs: args.timeoutInMs,
      claimTimeoutInMs: args.claimTimeoutInMs,
    });

    const terminal: RunbookAgentJob =
      await RunbookAgentJobService.pollUntilTerminal({
        jobId: new ObjectID(job._id!),
        claimTimeoutInMs: args.claimTimeoutInMs,
        executionTimeoutInMs: args.timeoutInMs,
      });

    const output: string = truncate(terminal.output || "");

    if (terminal.status === RunbookAgentJobStatus.Succeeded) {
      return { success: true, output };
    }

    return {
      success: false,
      output,
      errorMessage:
        terminal.errorMessage ||
        (typeof terminal.exitCode === "number"
          ? `Exit code ${terminal.exitCode}`
          : `Step ended with status ${terminal.status ?? "unknown"}`),
    };
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
    timeoutInMs: config.timeoutInMs || DEFAULT_SCRIPT_TIMEOUT_MS,
    claimTimeoutInMs: config.claimTimeoutInMs || DEFAULT_AGENT_CLAIM_TIMEOUT_MS,
    agentId: config.agentId || "",
    missingAgentError:
      "JavaScript step is missing a Runbook Agent. Pick an agent under Runbooks → Agents. JavaScript no longer runs on the OneUptime Worker.",
  });
}

export async function runHttpStep(step: RunbookStep): Promise<StepRunResult> {
  const config: HttpRequestStepConfig = step.config as HttpRequestStepConfig;
  const timeout: number = config.timeoutInMs || DEFAULT_HTTP_TIMEOUT_MS;

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
    timeoutInMs: config.timeoutInMs || DEFAULT_SCRIPT_TIMEOUT_MS,
    claimTimeoutInMs: config.claimTimeoutInMs || DEFAULT_AGENT_CLAIM_TIMEOUT_MS,
    agentId: config.agentId || "",
    missingAgentError:
      "Bash step is missing a Runbook Agent. Pick an agent under Runbooks → Agents.",
  });
}
