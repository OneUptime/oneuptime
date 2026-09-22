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
import KubectlOutputRedactor from "../../../../Utils/AiRemediation/KubectlOutputRedactor";
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
 *    the model burn calls finding out;
 *  - what counts as evidence. A command that never reached kubectl (no
 *    Runner claimed it, or the server or Runner refused it) is a failed
 *    tool call: it mints no citation and is not counted as run anywhere.
 *    A command that ran and exited non-zero is still evidence ("Forbidden",
 *    "NotFound" are findings), cited with rowCount 0;
 *  - a per-cluster breaker. The Runner lives in the cluster being
 *    investigated, so it is most likely to be evicted or crashlooping
 *    exactly when an investigation needs it, and still reads as online for
 *    a few minutes. Once one command goes unclaimed, the cluster is
 *    unreachable for the rest of the run: later commands for it fail at
 *    once instead of each waiting out another claim window.
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

// A reason that already ends a sentence.
const SENTENCE_END_PATTERN: RegExp = /[.!?]$/;

export default class KubectlInvestigationToolkit {
  private options: KubectlInvestigationToolkitOptions;
  private commandsRun: number = 0;
  /*
   * Clusters whose Runner left a command unclaimed in this run, with the
   * claim window it was given — the breaker described above.
   */
  private unreachableClusters: Map<string, number> = new Map<string, number>();

  public constructor(options: KubectlInvestigationToolkitOptions) {
    this.options = options;
  }

  public isClusterUnreachable(clusterId: string): boolean {
    return this.unreachableClusters.has(clusterId);
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
            } — ${
              this.isClusterUnreachable(cluster.clusterId)
                ? `UNREACHABLE for the rest of this investigation: its Runner "${cluster.runner?.name}" did not pick up an earlier command. Do not call run_kubectl on it again.`
                : `read-only kubectl via Runner "${cluster.runner?.name}"`
            }`;
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

    /*
     * The breaker: checked before the budget is planned, a command is
     * spent or anything is enqueued, so a dead Runner costs one claim
     * window per run rather than one per command.
     */
    const unreachableClaimWindowMs: number | undefined =
      this.unreachableClusters.get(cluster.clusterId);

    if (unreachableClaimWindowMs !== undefined) {
      return this.failure(
        `Cluster "${cluster.clusterName}"'s Runner did not pick up an earlier command within ${KubectlInvestigationToolkit.describeSeconds(
          unreachableClaimWindowMs,
        )}, so the cluster is treated as unreachable for the rest of this investigation. Nothing was run. Do not call run_kubectl on this cluster again: continue with OneUptime telemetry and say in **Cluster access** that the cluster's Runner did not respond.`,
        `kubectl was not run on cluster "${cluster.clusterName}": its Runner did not pick up an earlier command, so the cluster was unreachable for the rest of this investigation.`,
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

    /*
     * Counted once a job is enqueued, whether or not a Runner then runs
     * it: the per-investigation cap bounds the Runner work this run can
     * ask for, not the commands that happened to succeed.
     */
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

    if (outcome.claimTimedOut === true) {
      this.unreachableClusters.set(
        cluster.clusterId,
        budget.plan.claimTimeoutInMs,
      );

      return this.failure(
        `kubectl was NOT run on cluster "${cluster.clusterName}": its Runner did not pick up "${outcome.displayCommand}" within ${KubectlInvestigationToolkit.describeSeconds(
          budget.plan.claimTimeoutInMs,
        )} (it may be offline, restarting or busy). The cluster is treated as unreachable for the rest of this investigation — do not call run_kubectl on it again. Continue with OneUptime telemetry and say in **Cluster access** that the cluster's Runner did not respond.`,
        `kubectl was not run on cluster "${cluster.clusterName}": its Runner did not pick up the command in time.`,
      );
    }

    /*
     * Nothing reached kubectl, so there is nothing to cite: a refusal by
     * the server or the Runner, a kubectl that could not start, or a
     * Runner that went silent before running it. The model reads why; the
     * persisted event carries only the category, because the Runner's
     * reason can name its configuration and every reader of the incident
     * sees the event.
     */
    if (outcome.executed === false) {
      const redactedReason: string = KubectlOutputRedactor.redact(
        outcome.errorMessage || "The job ended without running kubectl.",
      ).text.trim();
      const reason: string = SENTENCE_END_PATTERN.test(redactedReason)
        ? redactedReason
        : `${redactedReason}.`;

      return this.failure(
        `No kubectl result came back from cluster "${cluster.clusterName}" for "${outcome.displayCommand}": ${reason} Nothing from this command is evidence. Continue with OneUptime telemetry and mention in **Cluster access** that kubectl could not run.`,
        `No kubectl result came back from cluster "${cluster.clusterName}": the command was refused, or the Runner did not run it.`,
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

  /*
   * `errorMessage` is what the run's persisted event (and so every reader
   * of the incident's investigation panel) carries; it defaults to the
   * model's text, which is right for failures that name nothing beyond the
   * command and the cluster.
   */
  private failure(text: string, errorMessage?: string): ToolCallOutcome {
    return {
      success: false,
      textForLlm: text,
      errorMessage: errorMessage ?? text,
    };
  }
}
