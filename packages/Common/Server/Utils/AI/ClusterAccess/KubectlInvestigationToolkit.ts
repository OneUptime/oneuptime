import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import {
  DEFAULT_KUBECTL_TIMEOUT_MS,
  KubectlCommandTier,
  KubernetesClusterAiAccessStatus,
  MAX_KUBECTL_COMMANDS_PER_INVESTIGATION,
  MAX_KUBECTL_TIMEOUT_MS,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "../../../../Utils/AiRemediation/KubectlPolicy";
import KubectlWaitBudget, {
  KubectlWaitBudgetResult,
  MIN_KUBECTL_TIMEOUT_MS,
} from "../../../../Utils/AiRemediation/KubectlWaitBudget";
import { ToolCallOutcome } from "../Toolbox/Index";
import { ToolArgs } from "../Toolbox/ToolTypes";
import { ObservabilityAssistantExtraTool } from "../Chat/ObservabilityAssistant";
import KubectlJobRunner, {
  KUBECTL_CLAIM_TIMEOUT_MS,
  KUBECTL_OUTPUT_TRUNCATED_SUFFIX,
  KubectlJobOutcome,
} from "./KubectlJobRunner";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";

/*
 * The run-scoped, READ-ONLY kubectl toolkit for an investigation.
 *
 * One instance backs one AIRun. It is handed to the agent loop as
 * extraTools and only ever offers clusters the access service called
 * investigation-ready. Three independent guards keep it read-only: the
 * policy here refuses anything but the Read tier, the enqueue chokepoint
 * refuses a non-Read investigation-origin job, and the Runner refuses the
 * same before spawning kubectl. "Read-only — nothing in your systems was
 * changed" stays literally true.
 *
 * Two more things the toolkit owns:
 *  - the run's wall clock. The agent loop checks its budget only between
 *    tool calls and cannot interrupt one, so the toolkit plans every
 *    command's claim window and execution timeout against the run's
 *    deadline (KubectlWaitBudget) and refuses a command the budget can no
 *    longer hold, before anything is enqueued;
 *  - what the model sees. Output reaches it only through the shared
 *    KubectlJobRunner redaction, and Secret reads are refused by the
 *    policy outright, so the tool says both up front instead of letting
 *    the model burn calls finding out.
 */

export {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";

/*
 * The wall clock an investigation run gets, for the runners to hand to
 * BOTH the engine (its maxWallClockMs) and this toolkit (as an absolute
 * deadline), so the loop's budget and the kubectl budget can never
 * disagree. It IS the engine's default, re-exported under the name the
 * runners use rather than restated. A re-export (a live binding) rather
 * than a copied const: the engine's module graph reaches this file
 * through the services and the investigation runners, so a value copied
 * at load time could read an engine module that has not finished
 * evaluating.
 */
export { MAX_WALL_CLOCK_MS as INVESTIGATION_MAX_WALL_CLOCK_MS } from "../SRE/AIInvestigationEngine";

export interface KubectlInvestigationToolkitOptions {
  projectId: ObjectID;
  aiRunId: ObjectID;
  clusters: Array<KubernetesClusterAiAccessStatus>;
  maxCommands?: number | undefined;
  /*
   * Which readiness admits a cluster. Investigations require the
   * investigation switch; a remediation run may read a cluster it is
   * allowed to fix even when its operator left investigation off.
   */
  readinessCheck?: "investigation" | "remediation" | undefined;
  /*
   * When the run's wall-clock budget ends (epoch milliseconds). Every
   * command's wait is planned to end before it; absent, commands are only
   * bounded by their own timeouts.
   */
  runDeadlineAtMs?: number | undefined;
}

export default class KubectlInvestigationToolkit {
  private options: KubectlInvestigationToolkitOptions;
  private commandsRun: number = 0;

  public constructor(options: KubectlInvestigationToolkitOptions) {
    this.options = options;
  }

  public getReadyClusters(): Array<KubernetesClusterAiAccessStatus> {
    return this.options.clusters.filter(
      (cluster: KubernetesClusterAiAccessStatus) => {
        const isReady: boolean =
          this.options.readinessCheck === "remediation"
            ? cluster.isRemediationReady
            : cluster.isInvestigationReady;
        return isReady && cluster.runner !== null;
      },
    );
  }

  public getCommandsRun(): number {
    return this.commandsRun;
  }

  /*
   * No ready cluster, no tools: the model is told in its context why the
   * cluster is unreachable, and a tool that always fails would only burn
   * its budget.
   */
  public buildTools(): Array<ObservabilityAssistantExtraTool> {
    if (this.getReadyClusters().length === 0) {
      return [];
    }

    return [this.buildListAccessTool(), this.buildRunKubectlTool()];
  }

  private buildListAccessTool(): ObservabilityAssistantExtraTool {
    return {
      definition: {
        name: LIST_CLUSTER_ACCESS_TOOL_NAME,
        description:
          "List the Kubernetes clusters linked to this signal that OneUptime AI may inspect with read-only kubectl, with their clusterId. Call this once before run_kubectl if you are unsure which cluster to target.",
        inputSchema: { type: "object", properties: {} },
      },
      execute: async (): Promise<ToolCallOutcome> => {
        const ready: Array<KubernetesClusterAiAccessStatus> =
          this.getReadyClusters();

        const text: string = ready
          .map((cluster: KubernetesClusterAiAccessStatus) => {
            return `- clusterId: ${cluster.clusterId} — "${cluster.clusterName}"${
              cluster.clusterIdentifier &&
              cluster.clusterIdentifier !== cluster.clusterName
                ? ` (k8s.cluster.name: ${cluster.clusterIdentifier})`
                : ""
            } — read-only kubectl via Runner "${cluster.runner?.name}"`;
          })
          .join("\n");

        return {
          success: true,
          textForLlm: text,
          result: {
            dataForLlm: text,
            rowCount: ready.length,
            citationLabel: "Clusters OneUptime AI can inspect",
            redactionCount: 0,
            isTruncated: false,
          },
        };
      },
    };
  }

  private buildRunKubectlTool(): ObservabilityAssistantExtraTool {
    const maxCommands: number =
      this.options.maxCommands ?? MAX_KUBECTL_COMMANDS_PER_INVESTIGATION;

    return {
      definition: {
        name: RUN_KUBECTL_TOOL_NAME,
        description: `Run ONE read-only kubectl command on a linked cluster and get its output. Allowed: get, describe, logs, events, top, rollout status/history, api-resources, explain, auth can-i, cluster-info. Anything that changes the cluster (delete, scale, patch, apply, exec, ...) is refused here — this is an investigation. Reading Secrets is refused too, and credential-looking values (Secret data, passwords, tokens, keys) are redacted from every output before you see it, so do not spend commands on them. Always pass -n <namespace> for namespaced objects and keep output small (use --tail, -o wide, field selectors). At most ${maxCommands} commands per investigation.`,
        inputSchema: {
          type: "object",
          properties: {
            clusterId: {
              type: "string",
              description:
                "The clusterId of the linked cluster to inspect (from the context or list_cluster_access).",
            },
            command: {
              type: "string",
              description:
                'The kubectl command, e.g. "kubectl describe pod web-7d9f-abc -n web" or "kubectl get events -n web --sort-by=.lastTimestamp". One line, no shell operators.',
            },
            rationale: {
              type: "string",
              description:
                "One sentence on what you expect this command to tell you — shown to humans on the timeline.",
            },
            timeoutInMs: {
              type: "number",
              description: `Timeout in milliseconds (default ${DEFAULT_KUBECTL_TIMEOUT_MS}, max ${MAX_KUBECTL_TIMEOUT_MS}). Shortened automatically when the investigation's time budget is nearly spent.`,
            },
          },
          required: ["clusterId", "command", "rationale"],
        },
      },
      execute: async (args: JSONObject): Promise<ToolCallOutcome> => {
        return this.runKubectl(args, maxCommands);
      },
    };
  }

  private async runKubectl(
    args: JSONObject,
    maxCommands: number,
  ): Promise<ToolCallOutcome> {
    if (this.commandsRun >= maxCommands) {
      return this.failure(
        `The per-investigation kubectl budget (${maxCommands} commands) is spent. Finish your analysis with what you have.`,
      );
    }

    const clusterIdRaw: string | undefined = ToolArgs.getString(
      args,
      "clusterId",
    );
    const cluster: KubernetesClusterAiAccessStatus | undefined =
      this.getReadyClusters().find(
        (candidate: KubernetesClusterAiAccessStatus) => {
          return candidate.clusterId === clusterIdRaw;
        },
      );

    if (!cluster || !cluster.runner) {
      return this.failure(
        "clusterId is not one of the clusters OneUptime AI may inspect for this signal. Use list_cluster_access.",
      );
    }

    const command: string = ToolArgs.getString(args, "command") || "";
    if (!command) {
      return this.failure("command is required.");
    }

    const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);

    if (policy.tier === KubectlCommandTier.Denied) {
      return this.failure(
        `Refused by the kubectl policy: ${policy.reason}. Nothing was run.`,
      );
    }

    if (policy.tier !== KubectlCommandTier.Read) {
      return this.failure(
        `"${policy.displayCommand}" would change the cluster (${policy.tier}) and this is a read-only investigation, so it was NOT run. If a change is the fix, put it in your Suggested next steps for a human.`,
      );
    }

    const requestedTimeoutInMs: number = ToolArgs.getNumber(
      args,
      "timeoutInMs",
      {
        defaultValue: DEFAULT_KUBECTL_TIMEOUT_MS,
        min: MIN_KUBECTL_TIMEOUT_MS,
        max: MAX_KUBECTL_TIMEOUT_MS,
      },
    );

    /*
     * Planned before the command counts against the budget or anything is
     * enqueued: a command the run's wall clock can no longer hold is
     * refused outright rather than started and abandoned.
     */
    const budget: KubectlWaitBudgetResult = KubectlWaitBudget.plan({
      requestedTimeoutInMs,
      maxClaimTimeoutInMs: KUBECTL_CLAIM_TIMEOUT_MS,
      deadlineAtMs: this.options.runDeadlineAtMs,
    });

    if (!budget.ok) {
      return this.failure(
        `Not enough time is left in this investigation's budget to run another kubectl command (about ${KubectlInvestigationToolkit.describeSeconds(
          budget.refusal.remainingBudgetMs,
        )} remain; a command needs at least ${KubectlInvestigationToolkit.describeSeconds(
          budget.refusal.minimumBudgetMs,
        )} including the wait for the Runner). Nothing was run. Finish your analysis with what you have.`,
      );
    }

    this.commandsRun++;

    let outcome: KubectlJobOutcome;

    try {
      outcome = await KubectlJobRunner.run({
        projectId: this.options.projectId,
        aiRunId: this.options.aiRunId,
        origin: RunnerJobOrigin.AiInvestigation,
        kubernetesClusterId: new ObjectID(cluster.clusterId),
        targetRunnerId: new ObjectID(cluster.runner.id),
        credentialId: cluster.credentialId,
        command: policy.displayCommand,
        stepId: `ai-investigation-kubectl-${this.commandsRun}`,
        timeoutInMs: budget.plan.timeoutInMs,
        claimTimeoutInMs: budget.plan.claimTimeoutInMs,
      });
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      return this.failure(
        `kubectl could not be run on cluster "${cluster.clusterName}": ${message}. Continue with OneUptime telemetry and mention this in your report.`,
      );
    }

    const text: string = KubectlJobRunner.describeForLlm(outcome);

    return {
      success: true,
      textForLlm: text,
      result: {
        dataForLlm: text,
        rowCount: outcome.succeeded ? 1 : 0,
        citationLabel: `${outcome.displayCommand} on cluster "${cluster.clusterName}"`,
        redactionCount: outcome.redactionCount ?? 0,
        isTruncated:
          outcome.isTruncated ??
          outcome.output.endsWith(KUBECTL_OUTPUT_TRUNCATED_SUFFIX.trim()),
      },
    };
  }

  private static describeSeconds(milliseconds: number): string {
    return `${Math.max(0, Math.round(milliseconds / 1000))}s`;
  }

  private failure(text: string): ToolCallOutcome {
    return { success: false, textForLlm: text, errorMessage: text };
  }
}
