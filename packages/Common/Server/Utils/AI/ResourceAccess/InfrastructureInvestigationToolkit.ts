import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
  isAiResourceType,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS,
  MAX_RESOURCE_COMMANDS_PER_INVESTIGATION,
  MAX_RESOURCE_COMMAND_TIMEOUT_MS,
  ResourceAiAccessStatus,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { redactResourceCommandOutput } from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import KubectlWaitBudget, {
  KubectlWaitBudgetResult,
  MIN_KUBECTL_TIMEOUT_MS,
} from "../../../../Utils/AiRemediation/KubectlWaitBudget";
import { describeResourceNoun } from "../../../Services/ResourceAiAccessService";
import { ToolCallOutcome } from "../Toolbox/Index";
import { ToolArgs } from "../Toolbox/ToolTypes";
import { ObservabilityAssistantExtraTool } from "../Chat/ObservabilityAssistant";
import ResourceCommandJobRunner, {
  RESOURCE_COMMAND_CLAIM_TIMEOUT_MS,
  RESOURCE_COMMAND_OUTPUT_TRUNCATED_SUFFIX,
  ResourceCommandJobOutcome,
  ResourceCommandRunState,
} from "./ResourceCommandJobRunner";
import {
  INFRASTRUCTURE_RESULT_UNKNOWN_EVENT_PREFIX,
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "./ResourceAccessToolNames";
import ResourceAccessContext, {
  describeResource,
} from "./ResourceAccessContext";

/*
 * The run-scoped, READ-ONLY infrastructure command toolkit for an
 * investigation — the sibling of KubectlInvestigationToolkit for every
 * resource with a resource AI agent (Docker and Podman hosts, Docker Swarm,
 * Proxmox, VMware and Ceph clusters, database servers, hosts).
 *
 * One instance backs one AIRun. It is handed to the agent loop as
 * extraTools and only ever offers resources the access service called
 * investigation-ready. Three independent guards keep it read-only: the
 * resource command policy here refuses anything but the Read tier, the
 * enqueue chokepoint (RunnerJobService.enqueueAiResourceCommand) refuses a
 * non-Read investigation-origin job, and the agent refuses the same before
 * it runs anything. "Read-only — nothing in your systems was changed" stays
 * literally true.
 *
 * What else the toolkit owns, exactly as the kubectl one does:
 *  - the run's wall clock: every command's claim window and timeout are
 *    planned against the run's deadline (KubectlWaitBudget, which is
 *    generic in all but name) and a command the budget can no longer hold
 *    is refused before anything is enqueued;
 *  - what the model sees: output reaches it only through the shared
 *    ResourceCommandJobRunner redaction;
 *  - what counts as evidence: a command that never ran is a failed call
 *    that mints no citation, one whose result never came back is "result
 *    unknown" (never "did not run"), and one that ran and exited non-zero
 *    is still evidence, cited with rowCount 0;
 *  - a per-agent breaker: once one command goes unclaimed, that resource's
 *    agent is unreachable for the rest of the run.
 */

export interface InfrastructureInvestigationToolkitOptions {
  projectId: ObjectID;
  aiRunId: ObjectID;
  resources: Array<ResourceAiAccessStatus>;
  maxCommands?: number | undefined;
  /*
   * Which readiness admits a resource. Investigations require the
   * investigation switch; a remediation run may read a resource it is
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

// The agent an unclaimed command tripped the breaker for.
interface UnreachableAgent {
  // The claim window the unclaimed command was given.
  claimWindowMs: number;
}

export default class InfrastructureInvestigationToolkit {
  private options: InfrastructureInvestigationToolkitOptions;
  private commandsRun: number = 0;
  // Agents (by id) that left a command unclaimed in this run.
  private unreachableAgents: Map<string, UnreachableAgent> = new Map<
    string,
    UnreachableAgent
  >();

  public constructor(options: InfrastructureInvestigationToolkitOptions) {
    this.options = options;
  }

  public getReadyResources(): Array<ResourceAiAccessStatus> {
    return this.options.resources.filter(
      (resource: ResourceAiAccessStatus): boolean => {
        const isReady: boolean =
          this.options.readinessCheck === "remediation"
            ? resource.isRemediationReady
            : resource.isInvestigationReady;

        return (
          isReady &&
          isAiResourceType(resource.resourceType) &&
          resource.agent !== null &&
          Boolean(resource.agent.agentId)
        );
      },
    );
  }

  public getCommandsRun(): number {
    return this.commandsRun;
  }

  // Whether this resource's agent tripped the breaker.
  public isResourceUnreachable(resourceId: string): boolean {
    const resource: ResourceAiAccessStatus | undefined =
      this.options.resources.find(
        (candidate: ResourceAiAccessStatus): boolean => {
          return candidate.resourceId === resourceId;
        },
      );

    return Boolean(
      resource?.agent && this.unreachableAgents.has(resource.agent.agentId),
    );
  }

  /*
   * No ready resource, no tools: the model is told in its context why each
   * resource is unreachable, and a tool that always fails would only burn
   * its budget.
   */
  public buildTools(): Array<ObservabilityAssistantExtraTool> {
    if (this.getReadyResources().length === 0) {
      return [];
    }

    return [this.buildListAccessTool(), this.buildRunCommandTool()];
  }

  // One line per ready resource: what it is, its id, and its programs.
  private describeReadyResources(): string {
    return this.getReadyResources()
      .map((resource: ResourceAiAccessStatus): string => {
        const info: AiResourceTypeInfo =
          AI_RESOURCE_TYPE_INFO[resource.resourceType];

        return `- ${describeResource(resource)} — resourceId: ${resource.resourceId} — programs: ${info.programs.join(
          ", ",
        )}`;
      })
      .join("\n");
  }

  /*
   * The read-command cheat-sheet of every tool policy the ready resources
   * use, once per policy (a Docker host and a Podman host share one).
   */
  private describeReadCommandGuides(): string {
    const presentTypes: Array<AiResourceType> = ALL_AI_RESOURCE_TYPES.filter(
      (type: AiResourceType): boolean => {
        return this.getReadyResources().some(
          (resource: ResourceAiAccessStatus): boolean => {
            return resource.resourceType === type;
          },
        );
      },
    );

    const byPolicy: Map<string, Array<AiResourceType>> = new Map<
      string,
      Array<AiResourceType>
    >();

    for (const type of presentTypes) {
      const policyName: string = ResourceCommandPolicy.getToolPolicy(type).name;
      byPolicy.set(policyName, [...(byPolicy.get(policyName) || []), type]);
    }

    const sections: Array<string> = [];

    for (const types of byPolicy.values()) {
      const heading: string = types
        .map((type: AiResourceType): string => {
          return AI_RESOURCE_TYPE_INFO[type].displayName;
        })
        .join(" / ");

      sections.push(
        `${heading} — read-only commands:\n${ResourceCommandPolicy.getReadCommandGuide(
          types[0]!,
        )}`,
      );
    }

    return sections.join("\n\n");
  }

  private buildListAccessTool(): ObservabilityAssistantExtraTool {
    return {
      definition: {
        name: LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        description: `List the infrastructure resources (Docker and Podman hosts, Docker Swarm, Proxmox, VMware and Ceph clusters, database servers, hosts) linked to this signal that OneUptime AI may inspect with read-only commands through their AI agents, with their resourceId and the programs each one runs. Call this once before ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} if you are unsure which resource to target.`,
        inputSchema: { type: "object", properties: {} },
      },
      execute: async (): Promise<ToolCallOutcome> => {
        const ready: Array<ResourceAiAccessStatus> = this.getReadyResources();

        const text: string = ready
          .map((resource: ResourceAiAccessStatus): string => {
            const info: AiResourceTypeInfo =
              AI_RESOURCE_TYPE_INFO[resource.resourceType];

            return `- resourceId: ${resource.resourceId} — ${describeResource(
              resource,
            )} — ${
              this.isResourceUnreachable(resource.resourceId)
                ? `UNREACHABLE for the rest of this investigation: its ${info.agentDisplayName} did not pick up an earlier command. Do not call ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} on it again.`
                : `read-only commands via its ${info.agentDisplayName} (programs: ${info.programs.join(
                    ", ",
                  )})`
            }`;
          })
          .join("\n");

        return {
          success: true,
          textForLlm: text,
          result: {
            dataForLlm: text,
            rowCount: ready.length,
            citationLabel: "Infrastructure OneUptime AI can inspect",
            redactionCount: 0,
            isTruncated: false,
          },
        };
      },
    };
  }

  private buildRunCommandTool(): ObservabilityAssistantExtraTool {
    const maxCommands: number =
      this.options.maxCommands ?? MAX_RESOURCE_COMMANDS_PER_INVESTIGATION;

    return {
      definition: {
        name: RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
        description: `Run ONE read-only command on a linked infrastructure resource through its AI agent and get its output. The resources you may inspect:\n${this.describeReadyResources()}\n\nWhat each kind of resource accepts:\n\n${this.describeReadCommandGuides()}\n\nOne command per call, written as the program followed by its arguments — never a shell line: pipes, redirects, ;, &&, $( ) and sudo are refused. Anything that changes a resource is refused here — this is an investigation — and so is anything that would read credentials; credential-looking values (passwords, tokens, keys, connection strings) are redacted from every output before you see it, so do not spend commands on them. Keep output small (limit lines and tails). At most ${maxCommands} commands per investigation.`,
        inputSchema: {
          type: "object",
          properties: {
            resourceId: {
              type: "string",
              description: `The resourceId of the linked resource to inspect (from the context or ${LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME}).`,
            },
            command: {
              type: "string",
              description:
                'The command, starting with one of the resource\'s programs, e.g. "docker ps -a", "docker logs --tail 100 web", "systemctl status nginx --no-pager", "pvesh get /cluster/resources", "ceph health detail" or "db sessions --limit 20". One line, no shell operators.',
            },
            rationale: {
              type: "string",
              description:
                "One sentence on what you expect this command to tell you — shown to humans on the timeline.",
            },
            timeoutInMs: {
              type: "number",
              description: `Timeout in milliseconds (default ${DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS}, max ${MAX_RESOURCE_COMMAND_TIMEOUT_MS}). Shortened automatically when the investigation's time budget is nearly spent.`,
            },
          },
          required: ["resourceId", "command", "rationale"],
        },
      },
      execute: async (args: JSONObject): Promise<ToolCallOutcome> => {
        return this.runCommand(args, maxCommands);
      },
    };
  }

  private async runCommand(
    args: JSONObject,
    maxCommands: number,
  ): Promise<ToolCallOutcome> {
    if (this.commandsRun >= maxCommands) {
      return this.failure(
        `The per-investigation infrastructure command budget (${maxCommands} commands) is spent. Finish your analysis with what you have.`,
      );
    }

    const resourceIdRaw: string | undefined = ToolArgs.getString(
      args,
      "resourceId",
    );
    const resource: ResourceAiAccessStatus | undefined =
      this.getReadyResources().find(
        (candidate: ResourceAiAccessStatus): boolean => {
          return (
            Boolean(resourceIdRaw) &&
            candidate.resourceId.toLowerCase() === resourceIdRaw!.toLowerCase()
          );
        },
      );

    if (!resource || !resource.agent) {
      return this.failure(
        `resourceId is not one of the resources OneUptime AI may inspect for this signal. Use ${LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME}.`,
      );
    }

    const info: AiResourceTypeInfo =
      AI_RESOURCE_TYPE_INFO[resource.resourceType];
    const label: string = describeResource(resource);

    const command: string = ToolArgs.getString(args, "command") || "";

    if (!command) {
      return this.failure("command is required.");
    }

    const policy: ResourceCommandPolicyResult =
      ResourceCommandPolicy.evaluateCommand({
        resourceType: resource.resourceType,
        command,
      });

    if (policy.tier === ResourceCommandTier.Denied) {
      return this.failure(
        `Refused by the ${info.displayName} command policy: ${policy.reason}. Nothing was run. What ${label} accepts:\n${ResourceCommandPolicy.getReadCommandGuide(
          resource.resourceType,
        )}`,
        `Refused by the ${info.displayName} command policy on ${label}. Nothing was run.`,
      );
    }

    if (policy.tier !== ResourceCommandTier.Read) {
      return this.failure(
        `"${policy.displayCommand}" would change ${label} (${policy.tier}) and this is a read-only investigation, so it was NOT run. If a change is the fix, put it in your Suggested next steps for a human. Read-only commands for it:\n${ResourceCommandPolicy.getReadCommandGuide(
          resource.resourceType,
        )}`,
        `"${policy.displayCommand}" would change ${label} and this is a read-only investigation, so it was not run.`,
      );
    }

    /*
     * The breaker: checked before the budget is planned, a command is spent
     * or anything is enqueued, so a dead agent costs one claim window per
     * run rather than one per command.
     */
    const tripped: UnreachableAgent | undefined = this.unreachableAgents.get(
      resource.agent.agentId,
    );

    if (tripped !== undefined) {
      return this.failure(
        `The ${info.agentDisplayName} of ${label} did not pick up an earlier command within ${InfrastructureInvestigationToolkit.describeSeconds(
          tripped.claimWindowMs,
        )}, so the ${describeResourceNoun(resource.resourceType)} is treated as unreachable for the rest of this investigation. Nothing was run. Do not call ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} on it again: continue with OneUptime telemetry and say in **${ResourceAccessContext.REPORT_SECTION_HEADING}** that its ${info.agentDisplayName} did not respond.`,
        `No command was run on ${label}: its ${info.agentDisplayName} did not pick up an earlier command, so it was unreachable for the rest of this investigation.`,
      );
    }

    const requestedTimeoutInMs: number = ToolArgs.getNumber(
      args,
      "timeoutInMs",
      {
        defaultValue: DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS,
        min: MIN_KUBECTL_TIMEOUT_MS,
        max: MAX_RESOURCE_COMMAND_TIMEOUT_MS,
      },
    );

    /*
     * Planned before the command counts against the budget or anything is
     * enqueued: a command the run's wall clock can no longer hold is
     * refused outright rather than started and abandoned.
     */
    const budget: KubectlWaitBudgetResult = KubectlWaitBudget.plan({
      requestedTimeoutInMs,
      maxClaimTimeoutInMs: RESOURCE_COMMAND_CLAIM_TIMEOUT_MS,
      deadlineAtMs: this.options.runDeadlineAtMs,
    });

    if (!budget.ok) {
      return this.failure(
        `Not enough time is left in this investigation's budget to run another infrastructure command (about ${InfrastructureInvestigationToolkit.describeSeconds(
          budget.refusal.remainingBudgetMs,
        )} remain; a command needs at least ${InfrastructureInvestigationToolkit.describeSeconds(
          budget.refusal.minimumBudgetMs,
        )} including the wait for the agent). Nothing was run. Finish your analysis with what you have.`,
      );
    }

    /*
     * Counted once a job is enqueued, whether or not the agent then runs
     * it: the per-investigation cap bounds the agent work this run can ask
     * for, not the commands that happened to succeed.
     */
    this.commandsRun++;

    let outcome: ResourceCommandJobOutcome;

    try {
      outcome = await ResourceCommandJobRunner.run({
        projectId: this.options.projectId,
        aiRunId: this.options.aiRunId,
        origin: RunnerJobOrigin.AiInvestigation,
        resourceType: resource.resourceType,
        resourceId: new ObjectID(resource.resourceId),
        targetResourceAiAgentId: new ObjectID(resource.agent.agentId),
        /*
         * The command exactly as evaluated above: the chokepoint and the
         * agent evaluate the same text, so all three verdicts agree.
         */
        command,
        stepId: `ai-investigation-resource-${this.commandsRun}`,
        timeoutInMs: budget.plan.timeoutInMs,
        claimTimeoutInMs: budget.plan.claimTimeoutInMs,
      });
    } catch (error) {
      const message: string = redactResourceCommandOutput({
        resourceType: resource.resourceType,
        program: policy.program,
        text: error instanceof Error ? error.message : String(error),
      }).trim();

      return this.failure(
        `The command could not be run on ${label}: ${message} Continue with OneUptime telemetry and mention this in your report.`,
        `No command was run on ${label}: it was refused before it reached the ${info.agentDisplayName}.`,
      );
    }

    if (outcome.claimTimedOut === true) {
      this.unreachableAgents.set(resource.agent.agentId, {
        claimWindowMs: budget.plan.claimTimeoutInMs,
      });

      return this.failure(
        `The command was NOT run on ${label}: its ${info.agentDisplayName} did not pick up "${outcome.displayCommand}" within ${InfrastructureInvestigationToolkit.describeSeconds(
          budget.plan.claimTimeoutInMs,
        )} (it may be offline, restarting or busy). The ${describeResourceNoun(
          resource.resourceType,
        )} is treated as unreachable for the rest of this investigation — do not call ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} on it again. Continue with OneUptime telemetry and say in **${ResourceAccessContext.REPORT_SECTION_HEADING}** that its ${info.agentDisplayName} did not respond.`,
        `No command was run on ${label}: the ${info.agentDisplayName} did not pick up the command in time.`,
      );
    }

    /*
     * The agent took the command and no result came back: it may have run
     * or not. There is no output to cite, so it is a failed call — but it
     * is never recorded as "did not run", and the panel counts it apart.
     */
    if (outcome.runState === ResourceCommandRunState.Unknown) {
      const reason: string = InfrastructureInvestigationToolkit.toSentence(
        redactResourceCommandOutput({
          resourceType: resource.resourceType,
          program: policy.program,
          text: outcome.errorMessage || "No result came back for this command.",
        }),
      );

      return this.failure(
        `No result came back from ${label} for "${outcome.displayCommand}": ${reason} Nothing from this command is evidence. Continue with OneUptime telemetry and mention in **${ResourceAccessContext.REPORT_SECTION_HEADING}** that its ${info.agentDisplayName} stopped responding.`,
        `${INFRASTRUCTURE_RESULT_UNKNOWN_EVENT_PREFIX} the ${info.agentDisplayName} of ${label} took the command, but no result came back, so whether it ran is unknown.`,
      );
    }

    /*
     * Nothing reached the program, so there is nothing to cite: a refusal
     * by the server or the agent, or a program that could not start. The
     * model reads why; the persisted event carries only the category,
     * because the agent's reason can name its configuration and every
     * reader of the incident sees the event.
     */
    if (outcome.executed === false) {
      const reason: string = InfrastructureInvestigationToolkit.toSentence(
        redactResourceCommandOutput({
          resourceType: resource.resourceType,
          program: policy.program,
          text:
            outcome.errorMessage ||
            "The job ended without running the command.",
        }),
      );

      return this.failure(
        `No result came back from ${label} for "${outcome.displayCommand}": ${reason} Nothing from this command is evidence. Continue with OneUptime telemetry and mention in **${ResourceAccessContext.REPORT_SECTION_HEADING}** that the command could not run.`,
        `No result came back from ${label}: the command was refused, or the ${info.agentDisplayName} did not run it.`,
      );
    }

    const text: string = ResourceCommandJobRunner.describeForLlm({
      outcome,
      resourceType: resource.resourceType,
    });

    return {
      success: true,
      textForLlm: text,
      result: {
        dataForLlm: text,
        rowCount: outcome.succeeded ? 1 : 0,
        citationLabel: InfrastructureInvestigationToolkit.getCitationLabel({
          displayCommand: outcome.displayCommand,
          resource,
        }),
        redactionCount: outcome.redactionCount ?? 0,
        isTruncated:
          outcome.isTruncated ??
          outcome.output.endsWith(
            RESOURCE_COMMAND_OUTPUT_TRUNCATED_SUFFIX.trim(),
          ),
      },
    };
  }

  /*
   * How a command that ran is cited: `docker ps -a` on Docker host "web-1".
   * The report's evidence list and the panel show it as is.
   */
  public static getCitationLabel(data: {
    displayCommand: string;
    resource: ResourceAiAccessStatus;
  }): string {
    const displayName: string = isAiResourceType(data.resource.resourceType)
      ? AI_RESOURCE_TYPE_INFO[data.resource.resourceType].displayName
      : "resource";

    return `\`${data.displayCommand}\` on ${displayName} "${data.resource.resourceName}"`;
  }

  // A redacted reason that ends a sentence.
  private static toSentence(text: string): string {
    const trimmed: string = text.trim();

    return SENTENCE_END_PATTERN.test(trimmed) ? trimmed : `${trimmed}.`;
  }

  private static describeSeconds(milliseconds: number): string {
    return `${Math.max(0, Math.round(milliseconds / 1000))}s`;
  }

  /*
   * `errorMessage` is what the run's persisted event (and so every reader
   * of the incident's investigation panel) carries; it defaults to the
   * model's text, which is right for failures that name nothing beyond the
   * command and the resource.
   */
  private failure(text: string, errorMessage?: string): ToolCallOutcome {
    return {
      success: false,
      textForLlm: text,
      errorMessage: errorMessage ?? text,
    };
  }
}
