import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import AutoRemediationSuggestionStatus from "../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import { DEFAULT_VERIFICATION_WINDOW_MINUTES } from "../Services/AutoRemediationRuleEngineService";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import {
  KubernetesAiAccessGap,
  KubernetesClusterAiAccessStatus,
  getKubernetesAiAccessTargetKind,
  isKubernetesAgentRunnerName,
  isKubernetesAgentRunnerPosture,
  parseKubernetesRunnerPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
/*
 * Approving starts a runbook execution, so reading the suggestion is not
 * authority enough — the caller must hold a permission from
 * RunbookExecution's own create ACL. Without this, the read-check-as-gate
 * idiom would let anyone who can see the suggestion run infrastructure
 * scripts. Shared with the runbook routes so the two surfaces can never
 * disagree about who may start an execution.
 */
import { assertCanExecuteRunbooks } from "../Utils/Runbook/RunbookExecutePermission";
import AiRemediationCredentialUse from "../Utils/AutoRemediation/AiRemediationCredentialUse";
import RunbookRunAccess from "../Utils/Runbook/RunbookRunAccess";
import { Indigo500 } from "../../Types/BrandColors";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import AutoRemediationSuggestion from "../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunbookExecution from "../../Models/DatabaseModels/RunbookExecution";
import Project from "../../Models/DatabaseModels/Project";
import Runner from "../../Models/DatabaseModels/Runner";
import ProjectService from "../Services/ProjectService";
import AlertFeedService from "../Services/AlertFeedService";
import AutoRemediationSuggestionService from "../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../Services/IncidentFeedService";
import RunbookRuleEngineService from "../Services/RunbookRuleEngineService";
import RunnerService from "../Services/RunnerService";
import KubernetesClusterAiAccessService from "../Services/KubernetesClusterAiAccessService";
import CommandPlanExecutor from "../Utils/AutoRemediation/CommandPlanExecutor";
import RemediationCommandToolkit from "../Utils/AI/Remediation/RemediationCommandTools";
import ResourceAiAccessService, {
  describeResourceNoun,
  getResourceAiAgentPage,
} from "../Services/ResourceAiAccessService";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  isAiResourceType,
} from "../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceCommandTier,
} from "../../Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import logger from "../Utils/Logger";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";

const router: ExpressRouter = Express.getRouter();

/*
 * Human-action endpoints for auto-remediation suggestions. Suggestion rows
 * are server-authored (empty create/update table permissions) — humans act
 * on them only through these routes: one-click Approve (starts the proposed
 * runbook under the approver's identity) and Dismiss. Each route
 * access-checks the suggestion under the USER's permissions first (project
 * membership + the read ACL), then the service performs the root write —
 * the AIInsightAPI idiom. State transitions are CAS-guarded so two
 * concurrent approvals can never double-start a runbook.
 *
 * Approving an AI command plan is held to the approver: what it lets run
 * must be what they may do - start runbooks, change the resources the plan
 * changes and, for a command that runs with a credential OneUptime AI
 * picked, read runbook credentials (AiRemediationCredentialUse).
 */

async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  CommonAPI.assertAuthenticatedUser(props);

  return props;
}

/*
 * Access check under the USER's permissions: a null result means "does not
 * exist OR not yours", reported identically so the route never leaks
 * whether an id exists in another project.
 */
async function findAccessibleSuggestion(
  req: ExpressRequest,
  props: DatabaseCommonInteractionProps,
): Promise<ObjectID> {
  const suggestionIdString: string | undefined = req.body["suggestionId"] as
    | string
    | undefined;

  if (!suggestionIdString) {
    throw new BadDataException("suggestionId is required.");
  }

  const suggestion: AutoRemediationSuggestion | null =
    await AutoRemediationSuggestionService.findOneById({
      id: new ObjectID(suggestionIdString),
      select: { _id: true },
      props,
    });

  if (!suggestion || !suggestion.id) {
    throw new BadDataException(
      "Auto-remediation suggestion not found (or you do not have access to it).",
    );
  }

  return suggestion.id;
}

/*
 * One approval reads each cluster's AI access status at most once: the
 * Runner loop reads it to recognise the Kubernetes AI agent, and the kubectl
 * re-check reuses the same answer.
 */
type ClusterStatusCache = Map<string, KubernetesClusterAiAccessStatus | null>;

async function getClusterStatusOnce(data: {
  clusterId: string;
  projectId: ObjectID;
  statusByClusterId: ClusterStatusCache;
}): Promise<KubernetesClusterAiAccessStatus | null> {
  if (data.statusByClusterId.has(data.clusterId)) {
    return data.statusByClusterId.get(data.clusterId) || null;
  }

  const status: KubernetesClusterAiAccessStatus | null =
    await KubernetesClusterAiAccessService.getStatusForCluster({
      clusterId: new ObjectID(data.clusterId),
      projectId: data.projectId,
    });

  data.statusByClusterId.set(data.clusterId, status);

  return status;
}

/*
 * The cluster status whose access target is the Kubernetes AI agent this
 * plan names as `runnerId`, or null when `runnerId` is not the resolved AI
 * agent of any cluster its kubectl commands target. Only a Kubectl command
 * can reach the agent, and only the cluster's current status (not the plan)
 * says what the target is — so a Runner id never passes for the agent, and
 * an agent that is no longer the cluster's target falls back to the Runner
 * re-read, which refuses it.
 */
async function findAiAgentTargetStatus(data: {
  plan: AiRemediationCommandPlan;
  runnerId: string;
  projectId: ObjectID;
  statusByClusterId: ClusterStatusCache;
}): Promise<KubernetesClusterAiAccessStatus | null> {
  for (const command of data.plan.commands) {
    if (
      command.stepType !== RunbookStepType.Kubectl ||
      command.runnerId !== data.runnerId ||
      !command.kubernetesClusterId
    ) {
      continue;
    }

    const status: KubernetesClusterAiAccessStatus | null =
      await getClusterStatusOnce({
        clusterId: command.kubernetesClusterId,
        projectId: data.projectId,
        statusByClusterId: data.statusByClusterId,
      });

    if (
      status?.runner &&
      getKubernetesAiAccessTargetKind(status.runner) === "ai_agent" &&
      status.runner.id === data.runnerId
    ) {
      return status;
    }
  }

  return null;
}

/*
 * The AI agent's side of the Runner consent re-check. The agent is not a
 * Runner row, so there is no canRunAiCommands flag to re-read — the chart
 * that installed it is its consent. What can still have changed is whether
 * it is connected, and it only ever runs Kubectl steps, so a Bash or SSH
 * step aimed at it fails the click for the same reason as on the legacy
 * in-cluster Runner.
 */
function assertAiAgentCanRunPlan(data: {
  plan: AiRemediationCommandPlan;
  runnerId: string;
  status: KubernetesClusterAiAccessStatus;
}): void {
  const hostStep: AiRemediationCommand | undefined = data.plan.commands.find(
    (command: AiRemediationCommand) => {
      return (
        command.runnerId === data.runnerId &&
        command.stepType !== RunbookStepType.Kubectl
      );
    },
  );

  if (hostStep) {
    throw new BadDataException(
      `Command ${hostStep.sequence} is a ${hostStep.stepType} step on the Kubernetes AI agent of cluster "${data.status.clusterName}", which runs only Kubectl steps. The plan cannot be run — dismiss it and let a new suggestion be composed.`,
    );
  }

  if (!data.status.runner?.isOnline) {
    throw new BadDataException(
      `The Kubernetes AI agent of cluster "${data.status.clusterName}" is offline, so this plan cannot be run. Check the agent on the cluster's AI agent page (AI → Agent) and approve again, or dismiss the suggestion.`,
    );
  }
}

/*
 * What to do about a write-scope refusal, three ways by who runs kubectl for
 * the cluster — the same split as RemediationCommandToolkit
 * .getRunnerScopeSettings, which words the refusal itself:
 *
 * - the Kubernetes AI agent: its chart values; after a helm upgrade the
 *   same agent serves the cluster, so the plan can be approved again;
 * - the chart's previous in-cluster Runner: the chart no longer ships it,
 *   so the way to widen its scope is to upgrade to the AI agent — which
 *   replaces the Runner, so this plan (composed for the Runner) cannot be
 *   approved again and a new one is needed;
 * - any other Runner (a credential Runner): no chart configures it, its
 *   scope is set where it runs.
 */
export function getScopeRefusalNextStep(
  runner: KubernetesClusterAiAccessStatus["runner"],
): string {
  if (getKubernetesAiAccessTargetKind(runner) === "ai_agent") {
    return "Dismiss the suggestion and let a new plan be composed, or change the AI agent's write access (aiAgent.remediation.*) on the Kubernetes agent chart and approve again.";
  }

  if (
    isKubernetesAgentRunnerName(runner?.name) ||
    isKubernetesAgentRunnerPosture(runner?.posture)
  ) {
    return "Dismiss the suggestion and let a new plan be composed. To allow changes like this, upgrade the Kubernetes agent chart to the AI agent and set aiAgent.remediation.*.";
  }

  return "Dismiss the suggestion and let a new plan be composed, or change the Runner's write scope on the Runner's host and approve again.";
}

/*
 * Approval-time re-check of a Kubectl command's cluster. The plan named the
 * cluster, the Runner and the credential it was composed for; any of them
 * can have changed since (the operator turned remediation off on the
 * cluster's AI agent page, re-pointed it at another Runner, swapped or
 * removed the credential, the agent went offline). CommandPlanExecutor
 * hard-stops on the same conditions right before each command runs — this
 * makes the Approve click fail up front, with the first blocking gap named,
 * instead of claiming the plan and having it stop one command in. Each
 * cluster is checked once however many commands target it.
 */
async function assertKubectlCommandsStillRunnable(data: {
  plan: AiRemediationCommandPlan;
  projectId: ObjectID;
  statusByClusterId: ClusterStatusCache;
}): Promise<void> {
  for (const command of data.plan.commands) {
    if (command.stepType !== RunbookStepType.Kubectl) {
      continue;
    }

    const clusterLabel: string =
      command.kubernetesClusterNameSnapshot ||
      command.kubernetesClusterId ||
      "cluster";

    if (!command.kubernetesClusterId) {
      throw new BadDataException(
        `Command ${command.sequence} is a kubectl command with no cluster, so this plan cannot be run. Dismiss it and let a new suggestion be composed.`,
      );
    }

    const status: KubernetesClusterAiAccessStatus | null =
      await getClusterStatusOnce({
        clusterId: command.kubernetesClusterId,
        projectId: data.projectId,
        statusByClusterId: data.statusByClusterId,
      });

    if (!status) {
      throw new BadDataException(
        `Cluster "${clusterLabel}" (command ${command.sequence}) no longer exists in this project, so this plan cannot be run. Dismiss it and let a new suggestion be composed.`,
      );
    }

    if (!status.isRemediationReady) {
      const gap: KubernetesAiAccessGap | undefined = status.gaps.find(
        (candidate: KubernetesAiAccessGap) => {
          return candidate.blocks !== "investigation";
        },
      );

      throw new BadDataException(
        `Cluster "${status.clusterName}" (command ${command.sequence}) no longer allows AI remediation${
          gap ? `: ${gap.title} — ${gap.nextStep}` : ""
        }. Fix that on the cluster's AI agent page (AI → Agent) and approve again, or dismiss the suggestion.`,
      );
    }

    if (!status.runner || status.runner.id !== command.runnerId) {
      throw new BadDataException(
        `Cluster "${status.clusterName}" (command ${command.sequence}) is no longer reached through Runner "${command.runnerNameSnapshot}", which this plan was composed for${
          status.runner ? ` — it now uses "${status.runner.name}"` : ""
        }. Dismiss the suggestion and let a new plan be composed for the current Runner.`,
      );
    }

    if (
      (status.credentialId || undefined) !== (command.credentialId || undefined)
    ) {
      throw new BadDataException(
        `Cluster "${status.clusterName}" (command ${command.sequence}) is no longer reached with the credential this plan was composed for. Dismiss the suggestion and let a new plan be composed with the current credential.`,
      );
    }

    /*
     * The Runner's write scope as it reports it now (its chart's write
     * namespaces, its own namespace, node operations): a command or rollback
     * it would refuse fails the click with the reason, instead of claiming
     * the plan and being refused one command in — or, for a rollback, only
     * when verification fails and the change has to be undone.
     */
    const parts: Array<{ label: string; text: string | undefined }> = [
      { label: "", text: command.command },
      { label: "'s rollback", text: command.rollbackCommand },
    ];

    for (const part of parts) {
      if (!part.text) {
        continue;
      }

      const scopeRefusal: string | null =
        RemediationCommandToolkit.getRunnerScopeRefusal({
          cluster: status,
          command: part.text,
        });

      if (scopeRefusal) {
        throw new BadDataException(
          `Command ${command.sequence}${part.label} cannot run on cluster "${status.clusterName}": ${scopeRefusal} Nothing ran. ${getScopeRefusalNextStep(status.runner)}`,
        );
      }
    }
  }
}

/*
 * A cluster's in-cluster kubectl agent (the Runner a kubernetes-agent chart
 * registers) claims Kubectl jobs only. A Bash or SSH step aimed at it would
 * sit unclaimed until its claim timeout, fail, and skip the rest of the
 * plan AFTER the approver clicked — so it fails the click instead. A
 * Kubectl step legitimately names that same Runner (it is how the cluster
 * is reached), so the check is per step type, not per Runner.
 */
function assertNotHostStepOnKubernetesAgent(data: {
  plan: AiRemediationCommandPlan;
  runnerId: string;
  runner: Runner;
}): void {
  const isAgent: boolean =
    isKubernetesAgentRunnerName(data.runner.name) ||
    isKubernetesAgentRunnerPosture(
      parseKubernetesRunnerPosture(data.runner.hostInfo),
    );

  if (!isAgent) {
    return;
  }

  const hostStep: AiRemediationCommand | undefined = data.plan.commands.find(
    (command: AiRemediationCommand) => {
      return (
        command.runnerId === data.runnerId &&
        command.stepType !== RunbookStepType.Kubectl
      );
    },
  );

  if (hostStep) {
    throw new BadDataException(
      `Command ${hostStep.sequence} is a ${hostStep.stepType} step on Runner "${
        data.runner.name || hostStep.runnerNameSnapshot
      }", a Kubernetes cluster's in-cluster kubectl agent, which runs only Kubectl steps. The plan cannot be run — dismiss it and let a new suggestion be composed.`,
    );
  }
}

/*
 * ------------------------------------------------------------------
 * Resource commands (a Docker or Podman host, a Docker Swarm, Proxmox,
 * VMware or Ceph cluster, a database server or a host, reached through its
 * resource AI agent)
 * ------------------------------------------------------------------
 */

// One approval reads each resource's AI access status at most once.
type ResourceStatusCache = Map<string, ResourceAiAccessStatus | null>;

function getResourceStatusKey(
  resourceType: AiResourceType,
  resourceId: string,
): string {
  return `${resourceType}:${resourceId.toLowerCase()}`;
}

async function getResourceStatusOnce(data: {
  resourceType: AiResourceType;
  resourceId: string;
  projectId: ObjectID;
  statusByResourceKey: ResourceStatusCache;
}): Promise<ResourceAiAccessStatus | null> {
  const key: string = getResourceStatusKey(data.resourceType, data.resourceId);

  if (data.statusByResourceKey.has(key)) {
    return data.statusByResourceKey.get(key) || null;
  }

  const status: ResourceAiAccessStatus | null =
    await ResourceAiAccessService.getStatusForResource({
      projectId: data.projectId,
      resourceType: data.resourceType,
      resourceId: new ObjectID(data.resourceId),
    });

  data.statusByResourceKey.set(key, status);

  return status;
}

// 'Docker host "web-1"' — a resource command's resource, from its snapshot.
function describeCommandResource(command: AiRemediationCommand): string {
  return `${
    isAiResourceType(command.resourceType)
      ? describeResourceNoun(command.resourceType)
      : "resource"
  } "${command.resourceNameSnapshot || command.resourceId || "(unknown)"}"`;
}

/*
 * The resource AI agent's side of the Runner consent re-check — the
 * resource sibling of assertAiAgentCanRunPlan. A ResourceCommand step names
 * its resource's AI agent (a ResourceAiAgent row id) where a Runner id
 * would be. The agent is not a Runner row, so there is no canRunAiCommands
 * flag to re-read: its consent is ONEUPTIME_AI_ALLOW_WRITES on the agent
 * and the resource's own Fixes mode. What can have changed is whether it is
 * still the resource's agent and connected, and it only ever runs
 * ResourceCommand steps for its one resource — so any other step aimed at
 * it, or a step for another resource, fails the click.
 */
async function assertResourceAgentCanRunPlan(data: {
  plan: AiRemediationCommandPlan;
  runnerId: string;
  projectId: ObjectID;
  statusByResourceKey: ResourceStatusCache;
}): Promise<void> {
  const commands: Array<AiRemediationCommand> = data.plan.commands.filter(
    (command: AiRemediationCommand): boolean => {
      return command.runnerId === data.runnerId;
    },
  );

  const first: AiRemediationCommand | undefined = commands.find(
    (command: AiRemediationCommand): boolean => {
      return command.stepType === RunbookStepType.ResourceCommand;
    },
  );

  if (!first) {
    return;
  }

  const agentName: string = isAiResourceType(first.resourceType)
    ? AI_RESOURCE_TYPE_INFO[first.resourceType].agentDisplayName
    : "resource's AI agent";

  const otherStep: AiRemediationCommand | undefined = commands.find(
    (command: AiRemediationCommand): boolean => {
      return command.stepType !== RunbookStepType.ResourceCommand;
    },
  );

  if (otherStep) {
    throw new BadDataException(
      `Command ${otherStep.sequence} is a ${otherStep.stepType} step on the ${agentName} of ${describeCommandResource(
        first,
      )}, which runs only ResourceCommand steps. The plan cannot be run — dismiss it and let a new suggestion be composed.`,
    );
  }

  const otherResource: AiRemediationCommand | undefined = commands.find(
    (command: AiRemediationCommand): boolean => {
      return (
        command.resourceType !== first.resourceType ||
        (command.resourceId || "").toLowerCase() !==
          (first.resourceId || "").toLowerCase()
      );
    },
  );

  if (otherResource) {
    throw new BadDataException(
      `Command ${otherResource.sequence} names a different resource than the ${agentName} it is sent to serves. The plan cannot be run — dismiss it and let a new suggestion be composed.`,
    );
  }

  if (
    !isAiResourceType(first.resourceType) ||
    !first.resourceId ||
    !ObjectID.isValidUUID(first.resourceId)
  ) {
    throw new BadDataException(
      `Command ${first.sequence} is a resource command with no valid resource, so this plan cannot be run. Dismiss it and let a new suggestion be composed.`,
    );
  }

  const status: ResourceAiAccessStatus | null = await getResourceStatusOnce({
    resourceType: first.resourceType,
    resourceId: first.resourceId,
    projectId: data.projectId,
    statusByResourceKey: data.statusByResourceKey,
  });

  if (!status) {
    throw new BadDataException(
      `${describeCommandResource(first)} (command ${first.sequence}) no longer exists in this project, so this plan cannot be run. Dismiss it and let a new suggestion be composed.`,
    );
  }

  const label: string = `${describeResourceNoun(status.resourceType)} "${status.resourceName}"`;

  if (!status.agent || status.agent.agentId !== data.runnerId) {
    throw new BadDataException(
      `${label.charAt(0).toUpperCase()}${label.slice(1)} (command ${first.sequence}) is no longer reached through the ${agentName} this plan was composed for (the agent was reset or replaced). Dismiss the suggestion and let a new plan be composed for the current agent.`,
    );
  }

  if (!status.agent.isOnline) {
    throw new BadDataException(
      `The ${agentName} of ${label} is offline, so this plan cannot be run. Check the agent on ${getResourceAiAgentPage(
        status.resourceType,
      )} and approve again, or dismiss the suggestion.`,
    );
  }
}

/*
 * Approval-time re-check of every ResourceCommand step — the resource
 * sibling of assertKubectlCommandsStillRunnable. The resource must still
 * exist and be remediation-ready (fixes on, agent online and allowed to
 * write, the project switches), be reached through the agent the plan was
 * composed for, and every command and its rollback must still pass the
 * resource command policy and the agent's reported write scope. The
 * executor hard-stops on the same conditions right before each command
 * runs — this makes the click fail up front, with the reason and the next
 * step, instead of claiming the plan and stopping one command in.
 */
async function assertResourceCommandsStillRunnable(data: {
  plan: AiRemediationCommandPlan;
  projectId: ObjectID;
  statusByResourceKey: ResourceStatusCache;
}): Promise<void> {
  for (const command of data.plan.commands) {
    if (command.stepType !== RunbookStepType.ResourceCommand) {
      continue;
    }

    if (
      !isAiResourceType(command.resourceType) ||
      !command.resourceId ||
      !ObjectID.isValidUUID(command.resourceId)
    ) {
      throw new BadDataException(
        `Command ${command.sequence} is a resource command with no valid resource, so this plan cannot be run. Dismiss it and let a new suggestion be composed.`,
      );
    }

    const status: ResourceAiAccessStatus | null = await getResourceStatusOnce({
      resourceType: command.resourceType,
      resourceId: command.resourceId,
      projectId: data.projectId,
      statusByResourceKey: data.statusByResourceKey,
    });

    if (!status) {
      throw new BadDataException(
        `${describeCommandResource(command)} (command ${command.sequence}) no longer exists in this project, so this plan cannot be run. Dismiss it and let a new suggestion be composed.`,
      );
    }

    const noun: string = describeResourceNoun(status.resourceType);
    const label: string = `${noun} "${status.resourceName}"`;
    const capitalizedLabel: string = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
    const agentName: string =
      AI_RESOURCE_TYPE_INFO[status.resourceType].agentDisplayName;

    if (!status.isRemediationReady) {
      const gap: ResourceAiAccessGap | undefined = status.gaps.find(
        (candidate: ResourceAiAccessGap): boolean => {
          return candidate.blocksRemediation;
        },
      );

      throw new BadDataException(
        `${capitalizedLabel} (command ${command.sequence}) no longer allows AI remediation${
          gap ? `: ${gap.title} — ${gap.nextStep}` : ""
        }. Fix that on ${getResourceAiAgentPage(
          status.resourceType,
        )} and approve again, or dismiss the suggestion.`,
      );
    }

    if (!status.agent || status.agent.agentId !== command.runnerId) {
      throw new BadDataException(
        `${capitalizedLabel} (command ${command.sequence}) is no longer reached through the ${agentName} this plan was composed for (the agent was reset or replaced). Dismiss the suggestion and let a new plan be composed for the current agent.`,
      );
    }

    /*
     * The command and its rollback, re-checked live: the policy (a command
     * the policy denies now never runs, whoever approves it) and the
     * agent's write scope as it reports it now — a rollback it would refuse
     * would otherwise only surface when verification fails and the change
     * has to be undone.
     */
    const parts: Array<{ label: string; text: string | undefined }> = [
      { label: "", text: command.command },
      { label: "'s rollback", text: command.rollbackCommand },
    ];

    for (const part of parts) {
      if (!part.text) {
        continue;
      }

      const policy: ResourceCommandPolicyResult =
        ResourceCommandPolicy.evaluateCommand({
          resourceType: status.resourceType,
          command: part.text,
        });

      if (policy.tier === ResourceCommandTier.Denied) {
        throw new BadDataException(
          `Command ${command.sequence}${part.label} is denied by the ${
            AI_RESOURCE_TYPE_INFO[status.resourceType].displayName
          } command policy (${policy.reason}), so it can never run. Nothing ran. Dismiss the suggestion and let a new plan be composed.`,
        );
      }

      const scopeRefusal: string | null =
        RemediationCommandToolkit.getResourceWriteScopeRefusal({
          resource: status,
          command: part.text,
        });

      if (scopeRefusal) {
        throw new BadDataException(
          `Command ${command.sequence}${part.label} cannot run on ${label}: ${scopeRefusal} Nothing ran. ${RemediationCommandToolkit.getResourceScopeRefusalNextStep(
            status.resourceType,
          )}`,
        );
      }
    }
  }
}

/*
 * Approving a resource command runs it on the resource as root, so the
 * approver must be someone who may edit that resource — its update ACL,
 * label-scoped blocks included — not merely someone who may start runbooks
 * in the project. Each resource is checked once, however many commands
 * target it. Called after assertResourceCommandsStillRunnable, which has
 * already refused a command with no valid resource.
 */
async function assertApproverMayChangeResources(data: {
  plan: AiRemediationCommandPlan;
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
}): Promise<void> {
  const checked: Set<string> = new Set<string>();

  for (const command of data.plan.commands) {
    if (
      command.stepType !== RunbookStepType.ResourceCommand ||
      !isAiResourceType(command.resourceType) ||
      !command.resourceId ||
      !ObjectID.isValidUUID(command.resourceId)
    ) {
      continue;
    }

    const key: string = getResourceStatusKey(
      command.resourceType,
      command.resourceId,
    );

    if (checked.has(key)) {
      continue;
    }

    checked.add(key);

    await ResourceAiAccessService.assertCallerMayChangeResource({
      props: data.props,
      projectId: data.projectId,
      resourceType: command.resourceType,
      resourceId: new ObjectID(command.resourceId),
    });
  }
}

async function loadSuggestionAsRoot(
  suggestionId: ObjectID,
): Promise<AutoRemediationSuggestion> {
  const suggestion: AutoRemediationSuggestion | null =
    await AutoRemediationSuggestionService.findOneById({
      id: suggestionId,
      select: {
        _id: true,
        projectId: true,
        status: true,
        incidentId: true,
        alertId: true,
        runbookId: true,
        runbookNameSnapshot: true,
        ruleNameSnapshot: true,
        verificationWindowMinutes: true,
        suggestionType: true,
        commandPlan: true,
      },
      props: { isRoot: true },
    });

  if (!suggestion) {
    throw new BadDataException("Auto-remediation suggestion not found.");
  }

  return suggestion;
}

// Best-effort feed note on the suggestion's subject — never throws.
async function postFeedItem(data: {
  suggestion: AutoRemediationSuggestion;
  markdown: string;
  userId: ObjectID;
  pingWorkspace: boolean;
}): Promise<void> {
  try {
    if (data.suggestion.incidentId && data.suggestion.projectId) {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.suggestion.incidentId,
        projectId: data.suggestion.projectId,
        incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
        displayColor: Indigo500,
        feedInfoInMarkdown: data.markdown,
        userId: data.userId,
        workspaceNotification: {
          sendWorkspaceNotification: data.pingWorkspace,
        },
      });
    } else if (data.suggestion.alertId && data.suggestion.projectId) {
      await AlertFeedService.createAlertFeedItem({
        alertId: data.suggestion.alertId,
        projectId: data.suggestion.projectId,
        alertFeedEventType: AlertFeedEventType.AutoRemediation,
        displayColor: Indigo500,
        feedInfoInMarkdown: data.markdown,
        userId: data.userId,
        workspaceNotification: {
          sendWorkspaceNotification: data.pingWorkspace,
        },
      });
    }
  } catch (error) {
    logger.error(`AutoRemediationAPI: failed to create feed item: ${error}`);
  }
}

router.post(
  "/auto-remediation/approve",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const suggestionId: ObjectID = await findAccessibleSuggestion(req, props);

      const suggestion: AutoRemediationSuggestion =
        await loadSuggestionAsRoot(suggestionId);

      if (suggestion.status !== AutoRemediationSuggestionStatus.Suggested) {
        throw new BadDataException(
          `Only suggested remediations can be approved — this one is ${suggestion.status}.`,
        );
      }

      if (!suggestion.projectId) {
        throw new BadDataException("This suggestion has no project.");
      }

      /*
       * CommandPlan suggestions approve the AI-composed command plan
       * instead of starting a runbook. Same permission bar: executing
       * commands on a Runner is at least as sensitive as starting a
       * runbook on one.
       */
      if (
        suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
      ) {
        assertCanExecuteRunbooks(props, suggestion.projectId);

        const plan: AiRemediationCommandPlan | null =
          AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);

        /*
         * And an SSH command runs with the credential OneUptime AI picked
         * from its Runner's: approving confirms that pick, so it needs the
         * approver's read of runbook credentials - as naming one in a
         * runbook step does (AiRemediationCredentialUse). Asked before
         * anything else is read: it depends on the approver and the plan
         * alone.
         */
        if (plan) {
          await AiRemediationCredentialUse.assertApproverMayUseCredentials({
            plan: plan,
            props: props,
          });
        }

        /*
         * Re-check the project's AI switch at approval time. The plan may
         * have been composed hours ago; an operator who has since turned
         * Enable AI off expects it to stop pending plans too, not just new
         * ones — the same check RemediationExecutionRunner.checkProjectGates
         * makes before a round runs. Every round passes the same gate: a
         * rule's plan, and a cluster's or a resource's, whose own consent is
         * re-checked per command below.
         */
        const project: Project | null = await ProjectService.findOneById({
          id: suggestion.projectId,
          select: {
            _id: true,
            enableAi: true,
          },
          props: { isRoot: true },
        });

        if (!project || project.enableAi === false) {
          throw new BadDataException(
            "AI is disabled for this project, so this plan cannot be run. Re-enable it in Project Settings → AI Features, or dismiss the suggestion.",
          );
        }

        if (!plan || plan.commands.length === 0) {
          throw new BadDataException(
            "This suggestion has no valid command plan to run.",
          );
        }

        /*
         * Fail fast if a target Runner lost its AI-commands consent (or was
         * deleted) since the plan was composed — better a clear error now
         * than a plan that half-runs into claim timeouts. Each Runner is
         * read once, however many commands target it.
         */
        const runnerIds: Array<string> = Array.from(
          new Set(
            plan.commands.map((command: AiRemediationCommand) => {
              return command.runnerId;
            }),
          ),
        );

        const statusByClusterId: ClusterStatusCache = new Map<
          string,
          KubernetesClusterAiAccessStatus | null
        >();

        const statusByResourceKey: ResourceStatusCache = new Map<
          string,
          ResourceAiAccessStatus | null
        >();

        for (const runnerId of runnerIds) {
          /*
           * A kubectl command composed for a cluster's Kubernetes AI agent
           * names the agent's id where a Runner id would be. The agent is
           * not a Runner row — re-reading the Runner table would refuse
           * every agent plan — so it is recognised from the cluster's
           * status instead, and must be connected.
           */
          const aiAgentStatus: KubernetesClusterAiAccessStatus | null =
            await findAiAgentTargetStatus({
              plan,
              runnerId,
              projectId: suggestion.projectId,
              statusByClusterId,
            });

          if (aiAgentStatus) {
            assertAiAgentCanRunPlan({
              plan,
              runnerId,
              status: aiAgentStatus,
            });
            continue;
          }

          /*
           * A ResourceCommand step names its resource's AI agent the same
           * way; that agent is not a Runner row either, so it is recognised
           * from the resource's status and must be its current, connected
           * agent.
           */
          if (
            plan.commands.some((command: AiRemediationCommand): boolean => {
              return (
                command.stepType === RunbookStepType.ResourceCommand &&
                command.runnerId === runnerId
              );
            })
          ) {
            await assertResourceAgentCanRunPlan({
              plan,
              runnerId,
              projectId: suggestion.projectId,
              statusByResourceKey,
            });
            continue;
          }

          const runner: Runner | null = await RunnerService.findOneBy({
            query: {
              _id: runnerId,
              projectId: suggestion.projectId,
              canRunAiCommands: true,
            },
            select: { _id: true, name: true, hostInfo: true },
            props: { isRoot: true },
          });

          if (!runner) {
            throw new BadDataException(
              "A Runner this plan targets no longer accepts AI commands (or was deleted). The plan cannot be run — dismiss it and let a new suggestion be composed.",
            );
          }

          assertNotHostStepOnKubernetesAgent({
            plan,
            runnerId,
            runner,
          });
        }

        /*
         * Same idea for kubectl: the cluster's AI access is re-read at
         * approval time, so a cluster whose remediation was switched off,
         * re-bound to another Runner or re-credentialed since the plan was
         * composed fails the click rather than the first command.
         */
        await assertKubectlCommandsStillRunnable({
          plan,
          projectId: suggestion.projectId,
          statusByClusterId,
        });

        // And for every resource command: its resource, as it is now.
        await assertResourceCommandsStillRunnable({
          plan,
          projectId: suggestion.projectId,
          statusByResourceKey,
        });

        /*
         * And the approver may change every resource the plan changes: the
         * plan runs as root on the resource, so this is where the
         * resource's own edit ACL (with its label scope) applies.
         */
        await assertApproverMayChangeResources({
          plan,
          props,
          projectId: suggestion.projectId,
        });

        const claimedPlan: number =
          await AutoRemediationSuggestionService.attemptStatusTransition({
            suggestionId: suggestion.id!,
            fromStatus: AutoRemediationSuggestionStatus.Suggested,
            set: {
              status: AutoRemediationSuggestionStatus.Approved,
              approvedByUserId: props.userId!.toString(),
              approvedAt: OneUptimeDate.getCurrentDate(),
              verificationStatus: AutoRemediationVerificationStatus.Pending,
              verificationDeadlineAt: OneUptimeDate.addRemoveMinutes(
                OneUptimeDate.getCurrentDate(),
                suggestion.verificationWindowMinutes ||
                  DEFAULT_VERIFICATION_WINDOW_MINUTES,
              ),
            },
          });

        if (claimedPlan === 0) {
          throw new BadDataException(
            "This suggestion was just actioned by someone else. Refresh to see its current state.",
          );
        }

        /*
         * Detached on purpose: the plan can legitimately take minutes. The
         * executor persists per-command progress, and the verifier judges a
         * plan that never completes inside the window — so a pod death here
         * is recorded, not silent.
         */
        CommandPlanExecutor.executeApprovedPlan({
          suggestionId: suggestion.id!,
        }).catch((error: unknown) => {
          logger.error(
            `AutoRemediationAPI: detached command-plan execution failed: ${error}`,
          );
        });

        await postFeedItem({
          suggestion,
          markdown:
            mdText`⚡ **AI command plan approved** — ${plan.commands.length} command(s) are being executed. Verification will watch the monitors for recovery.`.toString(),
          userId: props.userId!,
          pingWorkspace: true,
        });

        Response.sendJsonObjectResponse(req, res, {
          suggestionId: suggestion.id!.toString(),
          status: AutoRemediationSuggestionStatus.Approved,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
        });
        return;
      }

      if (!suggestion.runbookId) {
        throw new BadDataException("This suggestion has no runbook to start.");
      }

      assertCanExecuteRunbooks(props, suggestion.projectId);

      // Only a runbook the approver's run grant reaches (labels, owned).
      await RunbookRunAccess.assertMayStart({
        databaseProps: props,
        projectId: suggestion.projectId,
        runbookId: suggestion.runbookId,
      });

      /*
       * Claim the approval FIRST (CAS Suggested -> Approved), then start
       * the runbook. Two concurrent approvals race on this transition and
       * exactly one wins — the loser gets a clean "already actioned" error
       * instead of a double-started runbook.
       */
      const claimed: number =
        await AutoRemediationSuggestionService.attemptStatusTransition({
          suggestionId: suggestion.id!,
          fromStatus: AutoRemediationSuggestionStatus.Suggested,
          set: {
            status: AutoRemediationSuggestionStatus.Approved,
            approvedByUserId: props.userId!.toString(),
            approvedAt: OneUptimeDate.getCurrentDate(),
            /*
             * The runbook starts next — the outcome verifier watches for
             * monitor recovery until this deadline.
             */
            verificationStatus: AutoRemediationVerificationStatus.Pending,
            verificationDeadlineAt: OneUptimeDate.addRemoveMinutes(
              OneUptimeDate.getCurrentDate(),
              suggestion.verificationWindowMinutes ||
                DEFAULT_VERIFICATION_WINDOW_MINUTES,
            ),
          },
        });

      if (claimed === 0) {
        throw new BadDataException(
          "This suggestion was just actioned by someone else. Refresh to see its current state.",
        );
      }

      /*
       * startRunbookFor re-validates everything (project ownership,
       * isEnabled, non-empty steps) and records the approver as the
       * triggering user.
       */
      const runbookLinkage: { incidentId?: ObjectID; alertId?: ObjectID } = {};
      if (suggestion.incidentId) {
        runbookLinkage.incidentId = suggestion.incidentId;
      }
      if (suggestion.alertId) {
        runbookLinkage.alertId = suggestion.alertId;
      }

      /*
       * A throw here (transient DB error inside startRunbookFor) must roll
       * the claim back exactly like the null return — otherwise the
       * suggestion is stranded in Approved, a terminal state, with no
       * execution and no way to retry.
       */
      let execution: RunbookExecution | null = null;
      try {
        execution = await RunbookRuleEngineService.startRunbookFor({
          projectId: suggestion.projectId,
          runbookId: suggestion.runbookId,
          linkage: runbookLinkage,
          triggeredByUserId: props.userId!,
        });
      } catch (error) {
        logger.error(
          `AutoRemediationAPI: startRunbookFor threw during approve: ${error}`,
        );
        execution = null;
      }

      if (!execution) {
        // Roll the claim back so the suggestion stays actionable.
        await AutoRemediationSuggestionService.attemptStatusTransition({
          suggestionId: suggestion.id!,
          fromStatus: AutoRemediationSuggestionStatus.Approved,
          set: {
            status: AutoRemediationSuggestionStatus.Suggested,
          },
        });
        throw new BadDataException(
          "The proposed runbook could not be started — it may have been disabled or deleted, or it has no steps. Please try again.",
        );
      }

      /*
       * The runbook IS running at this point — a failure to persist the
       * execution link must not 500 the request (best-effort, logged).
       */
      try {
        await AutoRemediationSuggestionService.updateOneById({
          id: suggestion.id!,
          data: {
            runbookExecutionId: execution.id!,
          },
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(
          `AutoRemediationAPI: failed to persist runbookExecutionId after approve: ${error}`,
        );
      }

      await postFeedItem({
        suggestion,
        markdown:
          mdText`⚡ **Auto-remediation suggestion approved** — runbook "${suggestion.runbookNameSnapshot || "Runbook"}" was started.`.toString(),
        userId: props.userId!,
        pingWorkspace: true,
      });

      Response.sendJsonObjectResponse(req, res, {
        suggestionId: suggestion.id!.toString(),
        status: AutoRemediationSuggestionStatus.Approved,
        runbookExecutionId: execution.id!.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  "/auto-remediation/dismiss",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const suggestionId: ObjectID = await findAccessibleSuggestion(req, props);

      const suggestion: AutoRemediationSuggestion =
        await loadSuggestionAsRoot(suggestionId);

      /*
       * Both Suggested and still-Planning suggestions can be dismissed —
       * dismissing a Planning one cancels the proposal before the AI
       * finishes (the planner's own CAS then loses and writes nothing).
       */
      let dismissed: number =
        await AutoRemediationSuggestionService.attemptStatusTransition({
          suggestionId: suggestion.id!,
          fromStatus: AutoRemediationSuggestionStatus.Suggested,
          set: {
            status: AutoRemediationSuggestionStatus.Dismissed,
            dismissedByUserId: props.userId!.toString(),
            dismissedAt: OneUptimeDate.getCurrentDate(),
          },
        });

      if (dismissed === 0) {
        dismissed =
          await AutoRemediationSuggestionService.attemptStatusTransition({
            suggestionId: suggestion.id!,
            fromStatus: AutoRemediationSuggestionStatus.Planning,
            set: {
              status: AutoRemediationSuggestionStatus.Dismissed,
              dismissedByUserId: props.userId!.toString(),
              dismissedAt: OneUptimeDate.getCurrentDate(),
            },
          });
      }

      if (dismissed === 0) {
        throw new BadDataException(
          `Only suggested or planning remediations can be dismissed — this one is ${suggestion.status}.`,
        );
      }

      /*
       * A FullAuto run may already have executed commands by the time a
       * human dismisses its still-Planning suggestion. Saying "will not be
       * run" would be a lie about the state of their infrastructure, so
       * count what the plan records and say so — and ping the workspace,
       * because those changes are now outside the verification/rollback
       * loop and only a human can decide what to do about them.
       */
      const dismissedPlan: AiRemediationCommandPlan | null =
        suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
          ? AiRemediationCommandPlanUtil.parse(suggestion.commandPlan)
          : null;

      const alreadyExecutedCount: number = (
        dismissedPlan?.commands || []
      ).filter((command: AiRemediationCommand) => {
        return command.execution !== undefined;
      }).length;

      let dismissMarkdown: string;
      if (alreadyExecutedCount > 0) {
        dismissMarkdown =
          mdText`⚠️ **Auto-remediation suggestion dismissed — but ${alreadyExecutedCount} command(s) had ALREADY run.** No further commands will run and nothing was rolled back automatically. Review the executed commands and their output on the suggestion.`.toString();
      } else if (
        suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
      ) {
        dismissMarkdown = `⚡ **Auto-remediation suggestion dismissed** — the AI-composed command plan will not be run.`;
      } else {
        dismissMarkdown =
          mdText`⚡ **Auto-remediation suggestion dismissed** — runbook "${suggestion.runbookNameSnapshot || "(not yet picked)"}" will not be run.`.toString();
      }

      await postFeedItem({
        suggestion,
        markdown: dismissMarkdown,
        userId: props.userId!,
        pingWorkspace: alreadyExecutedCount > 0,
      });

      Response.sendJsonObjectResponse(req, res, {
        suggestionId: suggestion.id!.toString(),
        status: AutoRemediationSuggestionStatus.Dismissed,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
