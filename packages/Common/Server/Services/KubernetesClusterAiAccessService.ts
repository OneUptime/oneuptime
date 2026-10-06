import Alert from "../../Models/DatabaseModels/Alert";
import Incident from "../../Models/DatabaseModels/Incident";
import KubernetesAiAgent from "../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Project from "../../Models/DatabaseModels/Project";
import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";
import Runner, {
  RunnerConnectionStatus,
} from "../../Models/DatabaseModels/Runner";
import BadDataException from "../../Types/Exception/BadDataException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ColumnLength from "../../Types/Database/ColumnLength";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import { getDeletedAgentRunnerRebindNote } from "../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import {
  AgentAiSettingsSource,
  isAgentAiSettingsSourceAgent,
} from "../../Types/AI/AgentAiSettings";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import {
  RUNNER_ALIVE_WINDOW_IN_MINUTES,
  RunnerLiveStatus,
  getRunnerLiveStatus,
} from "../../Types/Runner/RunnerLiveStatus";
import {
  KUBECTL_ALLOW_WRITES_ENV,
  KUBECTL_WRITE_NAMESPACES_ENV,
  KUBERNETES_AGENT_RUNNER_NAME_PREFIX,
  KUBERNETES_AI_AGENT_COMPONENT,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  KubernetesAgentPosture,
  KubernetesAgentRegistrationRefusalReason,
  KubernetesAgentRunnerBindingState,
  KubernetesAiAccessGap,
  KubernetesAiAccessRunnerSummary,
  KubernetesAiAutomaticInvestigationSettings,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
  isInClusterPostureForCluster,
  isSameKubernetesClusterIdentifier,
  normalizeKubernetesClusterIdentifier,
  parseKubernetesAgentPosture,
  parseKubernetesRunnerPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import { KubernetesClusterFeedEventType } from "../../Models/DatabaseModels/KubernetesClusterFeed";
import { Blue500, Green500, Yellow500 } from "../../Types/BrandColors";
import QueryHelper from "../Types/Database/QueryHelper";
import AIService from "./AIService";
import AlertService from "./AlertService";
import IncidentService from "./IncidentService";
import KubernetesAiAgentService from "./KubernetesAiAgentService";
import KubernetesClusterFeedService from "./KubernetesClusterFeedService";
import KubernetesClusterService from "./KubernetesClusterService";
import LlmProviderService from "./LlmProviderService";
import MonitorService from "./MonitorService";
import ProjectService from "./ProjectService";
import RunbookCredentialService from "./RunbookCredentialService";
import RunbookSecretService from "./RunbookSecretService";
import RunnerService, {
  Service as RunnerServiceClass,
  getKubernetesAgentRunnerNameForCluster,
} from "./RunnerService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import crypto from "crypto";

/*
 * The agent Runner's name for a cluster, and the Runner name column bound.
 * Defined next to the Runner guards that key on it (RunnerService) and
 * re-exported here, where registration and its callers have always found
 * them.
 */
export {
  MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH,
  getKubernetesAgentRunnerNameForCluster,
} from "./RunnerService";

/*
 * OneUptime AI access to Kubernetes clusters.
 *
 * Answers, from CURRENT configuration, whether AI can reach a cluster with
 * kubectl and what it may do there — and turns every reason it cannot into a
 * row of a checklist with a next step. The same status feeds the cluster's
 * AI agent page, the investigation panel ("we could not access the cluster,
 * here is why") and the AI runs themselves (which only ever act on a cluster
 * this module calls ready).
 *
 * AI reaches a cluster through ONE access target, resolved from liveness by
 * resolveKubernetesAiAccessTarget: the cluster's Kubernetes AI agent (its
 * own identity, a KubernetesAiAgent row), the chart's previous in-cluster
 * Runner, or a Runner an operator bound together with a Kubernetes
 * credential. The status, the enqueue chokepoint and the access test all
 * ask the same function, so they never disagree about which one it is.
 *
 * It also still registers the previous in-cluster Runner older charts
 * install: that Runner registers with the project's telemetry ingestion key
 * and the cluster's name, and this module upserts its Runner row and points
 * the cluster at it — unless the cluster's Kubernetes AI agent is online,
 * which replaces it.
 */

export interface KubernetesClusterAiAccessProjectGates {
  /*
   * Project.enableAi, the project's only AI switch: it covers
   * investigation, fixes and AI commands on Runners alike.
   */
  isAiEnabled: boolean;
  hasLlmProvider: boolean;
  /*
   * Why no AI run can start for lack of AI credits (AIService.
   * getAiBalanceBlocker), or null/absent when nothing blocks. getProjectGates
   * always sets it; callers that build gates by hand may leave it out.
   */
  aiBalanceBlocker?: string | null | undefined;
  /*
   * The project's automatic-investigation opt-ins, shown on the AI agent
   * page as a line of their own (never a gap). getProjectGates always sets
   * them; absent reads as both off.
   */
  automaticInvestigation?:
    | KubernetesAiAutomaticInvestigationSettings
    | undefined;
}

export interface RegisterKubernetesAgentRunnerResult {
  runnerId: ObjectID;
  runnerKey: string;
  clusterId: ObjectID;
  /*
   * False when the cluster is bound to a DIFFERENT Runner that an operator
   * chose in the dashboard, or when a cluster that had a Runner bound before
   * has none now (an operator cleared it, or its Runner was deleted). The
   * agent Runner row still exists and heartbeats, but the dashboard is the
   * control plane: it never silently rebinds.
   */
  isBoundToCluster: boolean;
  isFirstBind: boolean;
  bindingState: KubernetesAgentRunnerBindingState;
}

/*
 * Ceiling on agent Runner rows one project may hold, and on how many new
 * ones may be minted per hour. Registration is authenticated by the
 * project's telemetry ingestion key — a credential every collector and CI
 * job holds — and every distinct clusterName creates a Runner row with the
 * AI-commands capability on, so the rows must be bounded like any other
 * thing an ingestion key can create. A legitimate fleet-wide install that
 * trips the hourly brake is only delayed: the pod retries registration
 * with backoff until it is admitted.
 */
export const MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT: number = 250;
export const MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR: number = 30;

// What the status computation reads off a cluster row.
export const CLUSTER_AI_ACCESS_SELECT: Record<string, boolean> = {
  _id: true,
  projectId: true,
  name: true,
  clusterIdentifier: true,
  aiAccessRunnerId: true,
  aiAccessCredentialId: true,
  isAiInvestigationEnabled: true,
  aiRemediationMode: true,
  aiKubectlCommandAllowlist: true,
  aiAccessLastVerifiedAt: true,
  aiAccessLastError: true,
  aiAccessConfiguredAt: true,
  aiAccessRunnerBoundAt: true,
  isArchived: true,
};

const MAX_CLUSTERS_PER_SUBJECT: number = 10;

/*
 * Where every next step sends an operator: the cluster's AI agent page
 * (AI → Agent in the cluster's side menu). Shown verbatim on incident pages
 * and in the investigation panel too, so it always names the page rather
 * than saying "this page".
 */
export const CLUSTER_AI_AGENT_PAGE: string =
  "the cluster's AI agent page (AI → Agent)";

/*
 * The one command that installs the Kubernetes AI agent (or turns it back
 * on), exactly as the dashboard, the docs and the chart's notes print it.
 * --reset-then-reuse-values keeps every other value the release was given
 * and takes the rest from the chart (--reuse-values would keep the old
 * chart's defaults too).
 */
export const AI_AGENT_INSTALL_COMMAND: string = [
  "helm repo update",
  "helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\",
  "  --namespace oneuptime-agent --reset-then-reuse-values \\",
  "  --set aiAgent.enabled=true",
].join("\n");

/*
 * How to read the agent pod's logs. The namespace is the one the agent
 * reported (posture.podNamespace) when it is known, a placeholder otherwise.
 */
export function getAiAgentLogsCommand(namespace?: string | undefined): string {
  return `kubectl logs -n ${
    namespace?.trim() || "<namespace>"
  } -l component=${KUBERNETES_AI_AGENT_COMPONENT} --tail=100`;
}

/*
 * The next step for a cluster no access target can reach: install the
 * agent, with the command verbatim, or check its pod if that was done.
 */
export const AI_AGENT_NOT_CONNECTED_NEXT_STEP: string = `Install the Kubernetes AI agent (use your own release name and namespace if they differ):\n\n${AI_AGENT_INSTALL_COMMAND}\n\nAlready installed? Check its logs: ${getAiAgentLogsCommand()}`;

/*
 * Who runs kubectl for a cluster, as the chart-value wording tells them
 * apart: the Kubernetes AI agent (aiAgent.* values), the previous in-cluster
 * Runner an older chart installed (its values are aiAccess.*, and the fix is
 * upgrading the chart to the AI agent), or a Runner an operator runs with a
 * Kubernetes credential (its own ONEUPTIME_KUBECTL_* environment).
 */
export type KubernetesAiAccessExecutorKind =
  | "ai_agent"
  | "legacy_runner"
  | "credential_runner";

/*
 * What to do about a read-only executor while remediation is on. For the
 * agent it names the value that grants writes and the two that bound them
 * (the namespaces the write role is bound in and the node switch); the
 * complete command is on the AI agent page (a bare --set line would miss
 * the chart index refresh and --reset-then-reuse-values).
 */
export const REMEDIATION_WRITE_ACCESS_NEXT_STEP: string = `Upgrade the Kubernetes agent chart with --set aiAgent.fixes=ask-for-approval (or automatic, or bypass-approval), which grants the write access fixes need; the complete command is on ${CLUSTER_AI_AGENT_PAGE}. List the namespaces AI may fix in aiAgent.remediation.namespaces (without it the write role is cluster-wide), and add aiAgent.remediation.nodeOperations=false to keep fixes off nodes.`;

// The same for the previous in-cluster Runner: the AI agent replaces it.
export const LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP: string = `Upgrade the Kubernetes agent chart: the Kubernetes AI agent replaces this Runner and your settings carry over. Add --set aiAgent.fixes=ask-for-approval to the upgrade to let it apply fixes; the complete command is on ${CLUSTER_AI_AGENT_PAGE}.`;

/*
 * The next steps for investigation or fixes that are off on a cluster whose
 * Kubernetes AI agent sets them: they change in the chart, not on the page.
 */
export const AGENT_SET_INVESTIGATION_NEXT_STEP: string = `Set aiAgent.investigation=true on the Kubernetes agent chart; ${CLUSTER_AI_AGENT_PAGE} shows the command.`;

export const AGENT_SET_FIXES_NEXT_STEP: string = `Set aiAgent.fixes to ask-for-approval, automatic or bypass-approval on the Kubernetes agent chart; ${CLUSTER_AI_AGENT_PAGE} shows the command.`;

// The same for a Runner no chart configures: its own environment.
export const CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP: string = `Set ${KUBECTL_ALLOW_WRITES_ENV}=true on the Runner's host and restart it (${KUBECTL_WRITE_NAMESPACES_ENV} limits the namespaces it may change).`;

export function getRemediationWriteAccessNextStep(
  kind: KubernetesAiAccessExecutorKind,
): string {
  switch (kind) {
    case "ai_agent":
      return REMEDIATION_WRITE_ACCESS_NEXT_STEP;
    case "legacy_runner":
      return LEGACY_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP;
    default:
      return CREDENTIAL_RUNNER_REMEDIATION_WRITE_ACCESS_NEXT_STEP;
  }
}

/*
 * The one access target AI reaches a cluster through right now (see
 * resolveKubernetesAiAccessTarget), with the row it was resolved from.
 *
 * advanced_runner: a Runner an operator bound that is not a kubernetes-agent
 *                  row — reached with the cluster's Kubernetes credential.
 * ai_agent:        the cluster's Kubernetes AI agent (online or not).
 * legacy_runner:   the cluster's previous in-cluster Runner, bound to it.
 * none:            nothing can reach the cluster.
 */
export type KubernetesAiAccessTarget =
  | { type: "advanced_runner"; runner: Runner; isOnline: boolean }
  | { type: "ai_agent"; agent: KubernetesAiAgent; isOnline: boolean }
  | { type: "legacy_runner"; runner: Runner; isOnline: boolean }
  | { type: "none" };

// The id jobs and plans name the target by (runnerId), or null for none.
export function getKubernetesAiAccessTargetId(
  target: KubernetesAiAccessTarget,
): string | null {
  switch (target.type) {
    case "ai_agent":
      return target.agent.id?.toString() || null;
    case "advanced_runner":
    case "legacy_runner":
      return target.runner.id?.toString() || null;
    default:
      return null;
  }
}

/*
 * THE rule for which access target AI uses for a cluster. Liveness based,
 * so a helm upgrade to the AI agent switches over the moment the agent is
 * online, and a rollback that stops the agent falls back on its own to the
 * previous in-cluster Runner the cluster is still bound to — no dashboard
 * step either way:
 *
 * 1. a bound Runner that is not a kubernetes-agent row: the advanced Runner
 *    an operator chose (with its Kubernetes credential). An explicit
 *    operator choice wins over everything the chart installs.
 * 2. the cluster's AI agent, when online.
 * 3. the bound Runner, when it is THIS cluster's previous in-cluster Runner
 *    and online (the agent is not, or was never installed).
 * 4. the cluster's AI agent, offline (its offline gap says what to check).
 * 5. the bound previous in-cluster Runner, offline.
 * 6. nothing.
 *
 * A bound Runner that is another cluster's kubernetes-agent row is none of
 * these: its ServiceAccount can never reach this cluster. Pure: liveness is
 * decided by the caller (isRunnerOnline, KubernetesAiAgentService.isOnline).
 */
export function resolveKubernetesAiAccessTarget(data: {
  clusterIdentifier: string | undefined;
  aiAccessRunnerId: ObjectID | string | null | undefined;
  // The Runner row aiAccessRunnerId names, when it still exists.
  boundRunner: Runner | null | undefined;
  isBoundRunnerOnline: boolean;
  // The cluster's KubernetesAiAgent row, if one ever registered.
  agent: KubernetesAiAgent | null | undefined;
  isAgentOnline: boolean;
}): KubernetesAiAccessTarget {
  /*
   * Only the row the binding names: a row with another id (a stale read)
   * is not the bound Runner.
   */
  const boundRunner: Runner | null =
    data.aiAccessRunnerId &&
    data.boundRunner &&
    (!data.boundRunner.id ||
      data.boundRunner.id.toString() === data.aiAccessRunnerId.toString())
      ? data.boundRunner
      : null;

  if (
    boundRunner &&
    !RunnerServiceClass.isKubernetesAgentRunnerRow(boundRunner)
  ) {
    return {
      type: "advanced_runner",
      runner: boundRunner,
      isOnline: data.isBoundRunnerOnline,
    };
  }

  const legacyRunner: Runner | null =
    boundRunner &&
    RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
      boundRunner,
      data.clusterIdentifier,
    )
      ? boundRunner
      : null;

  if (data.agent && data.isAgentOnline) {
    return { type: "ai_agent", agent: data.agent, isOnline: true };
  }

  if (legacyRunner && data.isBoundRunnerOnline) {
    return { type: "legacy_runner", runner: legacyRunner, isOnline: true };
  }

  if (data.agent) {
    return { type: "ai_agent", agent: data.agent, isOnline: false };
  }

  if (legacyRunner) {
    return { type: "legacy_runner", runner: legacyRunner, isOnline: false };
  }

  return { type: "none" };
}

// What the access-target resolution read, for callers that need the rows.
export interface LoadedKubernetesAiAccessTarget {
  target: KubernetesAiAccessTarget;
  // The Runner row aiAccessRunnerId names; null when unset or deleted.
  boundRunner: Runner | null;
  agent: KubernetesAiAgent | null;
}

// What target resolution and the status read off a bound Runner row.
const BOUND_RUNNER_SELECT: Record<string, boolean> = {
  _id: true,
  name: true,
  lastAlive: true,
  connectionStatus: true,
  canRunAiCommands: true,
  canRunRunbooks: true,
  canRunCodeFixTasks: true,
  hostInfo: true,
};

/*
 * Why deleting an in-cluster Runner is a two-step remedy (the helper lives
 * with the permissions it names, so RunnerService can use it too).
 */
export { getDeletedAgentRunnerRebindNote };

/*
 * Runner.name and KubernetesCluster.clusterIdentifier are both ShortText
 * columns. A cluster name longer than the column can never become a cluster
 * row, so registration refuses it up front with a message that says so.
 */
export const MAX_KUBERNETES_CLUSTER_IDENTIFIER_LENGTH: number =
  ColumnLength.ShortText;

/*
 * A 403 from POST /runner-ingest/register-kubernetes-agent that says WHICH
 * refusal it is (KubernetesAgentRegistrationRefusalReason), so the Runner can
 * tell a wait that clears on its own from one that needs an operator instead
 * of reading every 403 as "the previous instance is still online". The
 * ingress sends `reason` (and, for previous_instance_online,
 * `retryAfterSeconds` plus a Retry-After header) in the JSON error body.
 */
export class KubernetesAgentRegistrationRefusedException extends ForbiddenException {
  public readonly reason: KubernetesAgentRegistrationRefusalReason;
  // Set only for a refusal that clears on its own: when to try again.
  public readonly retryAfterSeconds: number | undefined;

  public constructor(data: {
    message: string;
    reason: KubernetesAgentRegistrationRefusalReason;
    retryAfterSeconds?: number | undefined;
  }) {
    super(data.message);
    this.reason = data.reason;
    this.retryAfterSeconds = data.retryAfterSeconds;
  }
}

/*
 * How long a previous in-cluster Runner refused because the cluster's
 * Kubernetes AI agent is online waits before it asks again. The refusal
 * lasts only while the agent is online, so the Runner keeps asking — slowly
 * — and is admitted within a minute of the agent stopping (a helm rollback).
 */
export const SUPERSEDED_BY_AI_AGENT_RETRY_AFTER_SECONDS: number = 60;

// Why the previous in-cluster Runner was refused: the AI agent replaces it.
export function getSupersededByAiAgentMessage(
  clusterIdentifier: string,
): string {
  return `The Kubernetes AI agent of cluster "${clusterIdentifier}" is online and replaces this in-cluster Runner, so the Runner was not registered. Nothing needs to be done: upgrading the Kubernetes agent chart removes the Runner, and it is admitted again only if the AI agent stops (for example after a helm rollback).`;
}

/*
 * When a registration refused because the previous instance is online may
 * try again: once that instance's last heartbeat is older than the alive
 * window. Never less than a second, so a Runner never retries in a loop.
 */
export function getPreviousInstanceRetryAfterSeconds(data: {
  lastAlive: Date | undefined;
  now?: Date | undefined;
}): number {
  if (!data.lastAlive) {
    return 1;
  }

  const admittedAt: number =
    data.lastAlive.getTime() + RUNNER_ALIVE_WINDOW_IN_MINUTES * 60 * 1000;
  const now: number = (data.now || OneUptimeDate.getCurrentDate()).getTime();

  return Math.max(1, Math.ceil((admittedAt - now) / 1000));
}

/*
 * One thing an agent Runner row holds beyond what registration gave it, and
 * what an operator does under Runbooks → Runners to remove it.
 */
export interface AgentRunnerHolding {
  description: string;
  remedy: string;
}

/*
 * How a registration that re-keys an existing agent Runner row was admitted.
 *
 * continuity:      it presented the row's current key — the same Runner.
 * signed_off:      no proof; the previous instance had signed off
 *                  (/runner-ingest/disconnect), as on a pod restart.
 * offline:         no proof; the previous instance had stopped heartbeating.
 * never_connected: no proof; the row had never heartbeated.
 *
 * Only "continuity" is proof. The other three are what a restarted pod
 * looks like — and also what anyone holding the ingestion key looks like —
 * so they are admitted only for a row that holds nothing but the agent
 * defaults, and the feed says which one it was.
 */
type AgentRunnerReKeyAdmission =
  | "continuity"
  | "signed_off"
  | "offline"
  | "never_connected";

interface RunnerPresence {
  liveStatus: RunnerLiveStatus;
  // The Runner shut down cleanly after its last heartbeat.
  isSignedOff: boolean;
  isOnline: boolean;
}

/*
 * How the resolved access target reaches the cluster, for the status: the
 * target's summary (runner), how kubectl authenticates, the credential when
 * it is one, and every gap that stops the target itself.
 */
interface ResolvedTargetAccess {
  runner: KubernetesAiAccessRunnerSummary | null;
  accessMethod: KubernetesClusterAiAccessStatus["accessMethod"];
  credentialId?: string | undefined;
  credentialName?: string | undefined;
  gaps: Array<KubernetesAiAccessGap>;
}

// What to do about an empty AI balance (ai_balance_insufficient).
export const AI_BALANCE_INSUFFICIENT_NEXT_STEP: string =
  "Add AI credits under Project Settings → AI Credits (or enable auto-recharge).";

class KubernetesClusterAiAccessServiceClass {
  /*
   * ------------------------------------------------------------------
   * Readiness
   * ------------------------------------------------------------------
   */

  @CaptureSpan()
  public async getProjectGates(
    projectId: ObjectID,
  ): Promise<KubernetesClusterAiAccessProjectGates> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        enableAi: true,
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticAlertInvestigation: true,
      },
      props: { isRoot: true },
    });

    // undefined: the lookup failed, so neither it nor the balance is known.
    let llmProvider: LlmProvider | null | undefined = undefined;

    try {
      llmProvider =
        await LlmProviderService.getLLMProviderForProject(projectId);
    } catch (error) {
      logger.error(
        `KubernetesClusterAiAccess: could not resolve the LLM provider for project ${projectId.toString()}: ${error}`,
      );
    }

    /*
     * An empty balance is a precondition like the provider: when it cannot
     * be checked, the status says nothing about it rather than claiming a
     * blocker that may not exist (the AI call itself still refuses). The
     * provider resolved above is handed over, so it is looked up once.
     */
    let aiBalanceBlocker: string | null = null;

    if (llmProvider !== undefined) {
      try {
        aiBalanceBlocker = await AIService.getAiBalanceBlocker({
          projectId,
          llmProvider,
        });
      } catch (error) {
        logger.error(
          `KubernetesClusterAiAccess: could not check the AI balance of project ${projectId.toString()}: ${error}`,
        );
      }
    }

    return {
      // Kill switch: a missing column counts as enabled (=== false idiom).
      isAiEnabled: project?.enableAi !== false,
      // A failed lookup reads as none, like no provider at all.
      hasLlmProvider: Boolean(llmProvider),
      aiBalanceBlocker,
      automaticInvestigation: {
        incidents: project?.enableAutomaticIncidentInvestigation === true,
        alerts: project?.enableAutomaticAlertInvestigation === true,
      },
    };
  }

  @CaptureSpan()
  public async getStatusForCluster(data: {
    clusterId: ObjectID;
    projectId: ObjectID;
    gates?: KubernetesClusterAiAccessProjectGates | undefined;
  }): Promise<KubernetesClusterAiAccessStatus | null> {
    const cluster: KubernetesCluster | null =
      await KubernetesClusterService.findOneBy({
        query: {
          _id: data.clusterId.toString(),
          projectId: data.projectId,
        },
        select: CLUSTER_AI_ACCESS_SELECT,
        props: { isRoot: true },
      });

    if (!cluster) {
      return null;
    }

    return this.getStatusForClusterModel({
      cluster,
      gates: data.gates || (await this.getProjectGates(data.projectId)),
    });
  }

  /*
   * ------------------------------------------------------------------
   * The access target
   * ------------------------------------------------------------------
   */

  /*
   * Is this Runner online right now? One rule for readiness, target
   * resolution and registration: it heartbeated within the alive window
   * (RunnerLiveStatus) AND it has not signed off since. A Runner signs off
   * on a clean shutdown (/runner-ingest/disconnect), which is what a helm
   * upgrade or uninstall does to the chart's in-cluster Runner pod — it
   * must read offline at once, not stay "Connected" until its last
   * heartbeat ages out while investigations queue kubectl it will never
   * claim.
   */
  public isRunnerOnline(runner: Runner): boolean {
    return this.getRunnerPresence(runner).isOnline;
  }

  /*
   * resolveKubernetesAiAccessTarget with each row's liveness read the one
   * way this module reads it.
   */
  public resolveAccessTarget(
    cluster: Pick<KubernetesCluster, "aiAccessRunnerId" | "clusterIdentifier">,
    data: {
      boundRunner: Runner | null | undefined;
      agentRow: KubernetesAiAgent | null | undefined;
    },
  ): KubernetesAiAccessTarget {
    return resolveKubernetesAiAccessTarget({
      clusterIdentifier: cluster.clusterIdentifier,
      aiAccessRunnerId: cluster.aiAccessRunnerId,
      boundRunner: data.boundRunner,
      isBoundRunnerOnline: data.boundRunner
        ? this.isRunnerOnline(data.boundRunner)
        : false,
      agent: data.agentRow,
      isAgentOnline: data.agentRow
        ? KubernetesAiAgentService.isOnline(data.agentRow)
        : false,
    });
  }

  /*
   * Read what the resolution needs — the bound Runner row and the cluster's
   * agent row (unless the caller already has it) — and resolve. Lookup
   * failures propagate: the enqueue chokepoint must fail closed on a target
   * it could not check.
   */
  @CaptureSpan()
  public async loadAccessTarget(data: {
    cluster: KubernetesCluster;
    // The cluster's agent row when already read (a batch); undefined reads it.
    agentRow?: KubernetesAiAgent | null | undefined;
  }): Promise<LoadedKubernetesAiAccessTarget> {
    const { cluster } = data;

    if (!cluster.id || !cluster.projectId) {
      throw new BadDataException(
        "The cluster's id and project are needed to resolve its AI access target.",
      );
    }

    const agent: KubernetesAiAgent | null =
      data.agentRow !== undefined
        ? data.agentRow
        : await KubernetesAiAgentService.findForCluster({
            projectId: cluster.projectId,
            kubernetesClusterId: cluster.id,
          });

    const boundRunner: Runner | null = cluster.aiAccessRunnerId
      ? await RunnerService.findOneBy({
          query: {
            _id: cluster.aiAccessRunnerId.toString(),
            projectId: cluster.projectId,
          },
          select: BOUND_RUNNER_SELECT,
          props: { isRoot: true },
        })
      : null;

    return {
      target: this.resolveAccessTarget(cluster, {
        boundRunner,
        agentRow: agent,
      }),
      boundRunner,
      agent,
    };
  }

  /*
   * This cluster's previous in-cluster Runner — the kubernetes-agent Runner
   * row an older chart registered — or null. Found by its (bounded) name,
   * matched case-insensitively like registration matches it; a row whose
   * posture names a DIFFERENT cluster is not this cluster's (a shortened
   * name's hash collision). Failing that, the cluster's bound Runner when it
   * is this cluster's agent by posture.
   *
   * A failed lookup propagates rather than reading as none: the AI agent's
   * registration asks this to keep a live Runner's cluster, and "could not
   * tell" must refuse (the agent retries) — never admit an agent that then
   * outranks a Runner that is still working. A caller that may treat "could
   * not tell" as "nothing to do" catches it itself.
   */
  @CaptureSpan()
  public async getLegacyAgentRunnerForCluster(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    clusterIdentifier: string | undefined;
  }): Promise<Runner | null> {
    const clusterIdentifier: string = (data.clusterIdentifier || "").trim();

    if (!clusterIdentifier) {
      return null;
    }

    const byName: Runner | null = await RunnerService.findOneBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameText(
          getKubernetesAgentRunnerNameForCluster(clusterIdentifier),
        ),
      },
      select: BOUND_RUNNER_SELECT,
      props: { isRoot: true },
    });

    if (byName) {
      return this.postureNamesAnotherCluster({
        runner: byName,
        clusterIdentifier,
      })
        ? null
        : byName;
    }

    const cluster: KubernetesCluster | null =
      await KubernetesClusterService.findOneBy({
        query: {
          _id: data.kubernetesClusterId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true, aiAccessRunnerId: true },
        props: { isRoot: true },
      });

    if (!cluster?.aiAccessRunnerId) {
      return null;
    }

    const bound: Runner | null = await RunnerService.findOneBy({
      query: {
        _id: cluster.aiAccessRunnerId.toString(),
        projectId: data.projectId,
      },
      select: BOUND_RUNNER_SELECT,
      props: { isRoot: true },
    });

    return bound &&
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
        bound,
        clusterIdentifier,
      )
      ? bound
      : null;
  }

  /*
   * The readiness computation proper. Resolves the cluster's access target
   * (resolveKubernetesAiAccessTarget), reads the bound Runner, the agent row
   * and the credential as root (the cluster row is already tenant-scoped by
   * the caller) and folds project gates in. Always sets aiAgent (the
   * cluster's agent whether or not it is the target) and
   * automaticInvestigation.
   */
  @CaptureSpan()
  public async getStatusForClusterModel(data: {
    cluster: KubernetesCluster;
    gates: KubernetesClusterAiAccessProjectGates;
    /*
     * The cluster's KubernetesAiAgent row when the caller already read it
     * (getStatusesForSubject reads every cluster's in one query); null for
     * "none", undefined to read it here.
     */
    aiAgentRow?: KubernetesAiAgent | null | undefined;
  }): Promise<KubernetesClusterAiAccessStatus> {
    const { cluster, gates } = data;
    const gaps: Array<KubernetesAiAccessGap> = [];

    const remediationMode: KubernetesAiRemediationMode =
      this.normalizeRemediationMode(cluster.aiRemediationMode);
    const isInvestigationEnabled: boolean =
      cluster.isAiInvestigationEnabled === true;

    const agentRow: KubernetesAiAgent | null =
      data.aiAgentRow !== undefined
        ? data.aiAgentRow
        : await this.findAiAgentRowForStatus(cluster);

    const loaded: LoadedKubernetesAiAccessTarget = await this.loadAccessTarget({
      cluster,
      agentRow,
    });

    const access: ResolvedTargetAccess = await this.getTargetAccess({
      cluster,
      loaded,
      remediationMode,
    });

    /*
     * Where investigation and fixes are set: by the cluster's Kubernetes AI
     * agent (its configuration, or its defaults on a cluster nobody
     * configured) unless AI reaches the cluster through a Runner an
     * operator bound. The columns above already hold the agent's values —
     * it writes them on every report that changes them.
     */
    const aiSettingsSource: AgentAiSettingsSource =
      KubernetesAiAgentService.getAiSettingsSource({
        reported: loaded.agent
          ? parseKubernetesAgentPosture(loaded.agent.posture)?.aiSettings
          : undefined,
        cluster,
        isBoundToAdvancedRunner: loaded.target.type === "advanced_runner",
      });
    const isSetByAgent: boolean =
      isAgentAiSettingsSourceAgent(aiSettingsSource);

    gaps.push(...access.gaps);

    if (!isInvestigationEnabled) {
      gaps.push({
        code: "investigation_disabled",
        title: "AI investigation is turned off for this cluster",
        description:
          "OneUptime AI will investigate incidents and alerts on this cluster with OneUptime data only — it will not run kubectl.",
        nextStep: isSetByAgent
          ? AGENT_SET_INVESTIGATION_NEXT_STEP
          : `Turn on "Investigate with kubectl" on ${CLUSTER_AI_AGENT_PAGE}.`,
        blocks: "investigation",
      });
    }

    if (remediationMode === KubernetesAiRemediationMode.Disabled) {
      gaps.push({
        code: "remediation_disabled",
        title: "AI fixes are turned off for this cluster",
        description:
          "OneUptime AI will diagnose but never propose or apply a fix on this cluster.",
        nextStep: isSetByAgent
          ? AGENT_SET_FIXES_NEXT_STEP
          : `Set "Fixes" to "Ask for approval", "Automatic" or "Bypass approval" on ${CLUSTER_AI_AGENT_PAGE}.`,
        blocks: "remediation",
      });
    }

    if (!gates.isAiEnabled) {
      gaps.push({
        code: "project_ai_disabled",
        title: "AI is disabled for this project",
        description: "OneUptime AI is switched off at the project level.",
        nextStep: "Enable AI under Project Settings → AI Features.",
        blocks: "both",
      });
    }

    if (!gates.hasLlmProvider) {
      gaps.push({
        code: "llm_provider_missing",
        title: "No AI provider is configured",
        description:
          "OneUptime AI needs an LLM provider to investigate or remediate anything.",
        nextStep:
          "Add a provider under Project Settings → AI → LLM Providers (or use OneUptime AI credits).",
        blocks: "both",
      });
    }

    if (gates.aiBalanceBlocker) {
      gaps.push({
        code: "ai_balance_insufficient",
        title: "The project is out of AI credits",
        description: gates.aiBalanceBlocker,
        nextStep: AI_BALANCE_INSUFFICIENT_NEXT_STEP,
        blocks: "both",
      });
    }

    const blocksInvestigation: boolean = gaps.some(
      (gap: KubernetesAiAccessGap) => {
        return gap.blocks === "investigation" || gap.blocks === "both";
      },
    );
    const blocksRemediation: boolean = gaps.some(
      (gap: KubernetesAiAccessGap) => {
        return gap.blocks === "remediation" || gap.blocks === "both";
      },
    );

    return {
      clusterId: cluster.id!.toString(),
      clusterName: cluster.name || cluster.clusterIdentifier || "cluster",
      clusterIdentifier: cluster.clusterIdentifier,
      runner: access.runner,
      accessMethod: access.accessMethod,
      aiAgent: loaded.agent
        ? KubernetesAiAgentService.toSummary(loaded.agent)
        : null,
      automaticInvestigation: {
        incidents: gates.automaticInvestigation?.incidents === true,
        alerts: gates.automaticInvestigation?.alerts === true,
      },
      credentialId: access.credentialId,
      credentialName: access.credentialName,
      kubectlAllowlist: this.normalizeAllowlist(
        cluster.aiKubectlCommandAllowlist,
      ),
      isInvestigationEnabled,
      aiSettingsSource,
      isInvestigationReady: isInvestigationEnabled && !blocksInvestigation,
      remediationMode,
      isRemediationReady:
        remediationMode !== KubernetesAiRemediationMode.Disabled &&
        !blocksRemediation,
      gaps,
      lastVerifiedAt: cluster.aiAccessLastVerifiedAt
        ? OneUptimeDate.toString(cluster.aiAccessLastVerifiedAt)
        : undefined,
      lastError: cluster.aiAccessLastError || undefined,
      evaluatedAt: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
    };
  }

  /*
   * The cluster's agent row for a status. Never throws: a failed read is
   * logged and reads as "no agent", which can only make the status say
   * less is reachable (or fall back to a bound Runner), never more.
   */
  private async findAiAgentRowForStatus(
    cluster: KubernetesCluster,
  ): Promise<KubernetesAiAgent | null> {
    if (!cluster.id || !cluster.projectId) {
      return null;
    }

    try {
      return await KubernetesAiAgentService.findForCluster({
        projectId: cluster.projectId,
        kubernetesClusterId: cluster.id,
      });
    } catch (error) {
      logger.error(
        `KubernetesClusterAiAccess: could not read the Kubernetes AI agent of cluster ${cluster.id.toString()}: ${error}`,
      );
      return null;
    }
  }

  // How the resolved target reaches the cluster, and what stops it.
  private async getTargetAccess(data: {
    cluster: KubernetesCluster;
    loaded: LoadedKubernetesAiAccessTarget;
    remediationMode: KubernetesAiRemediationMode;
  }): Promise<ResolvedTargetAccess> {
    const { cluster, loaded, remediationMode } = data;
    const target: KubernetesAiAccessTarget = loaded.target;

    switch (target.type) {
      case "ai_agent":
        return this.getAgentAccess({
          cluster,
          agent: target.agent,
          isOnline: target.isOnline,
          remediationMode,
        });
      case "legacy_runner":
      case "advanced_runner":
        return this.getRunnerAccess({
          cluster,
          runner: target.runner,
          isLegacy: target.type === "legacy_runner",
          remediationMode,
        });
      default:
        return {
          runner: null,
          accessMethod: "none",
          gaps: [
            /*
             * A bound id with no Runner row is only the race with a Runner
             * delete: the binding's foreign key is ON DELETE SET NULL, so
             * the next read has no binding at all and reads as not
             * connected.
             */
            cluster.aiAccessRunnerId && !loaded.boundRunner
              ? {
                  code: "runner_missing",
                  title: "The bound Runner was just deleted",
                  description:
                    "The Runner this cluster was bound to was deleted while its status was being read.",
                  nextStep: `Reload ${CLUSTER_AI_AGENT_PAGE}.`,
                  blocks: "both",
                }
              : {
                  code: "ai_agent_not_connected",
                  title: "The Kubernetes AI agent is not connected",
                  description: `OneUptime AI runs kubectl on this cluster through the Kubernetes AI agent, and no agent has connected for this cluster yet.${this.getIgnoredBoundRunnerNote(
                    { cluster, boundRunner: loaded.boundRunner },
                  )}`,
                  nextStep: AI_AGENT_NOT_CONNECTED_NEXT_STEP,
                  blocks: "both",
                },
          ],
        };
    }
  }

  /*
   * A Runner still bound to a cluster that has no access target is another
   * cluster's in-cluster Runner (a kubernetes-agent row that is not this
   * cluster's): its ServiceAccount can never reach this cluster, so it is
   * ignored. Said, so the status does not read as if nothing were
   * selected; installing the agent (the gap's step) is still the fix.
   * Empty when nothing is bound.
   */
  private getIgnoredBoundRunnerNote(data: {
    cluster: KubernetesCluster;
    boundRunner: Runner | null;
  }): string {
    const { cluster, boundRunner } = data;

    if (!cluster.aiAccessRunnerId || !boundRunner) {
      return "";
    }

    const reportedCluster: string | undefined =
      parseKubernetesRunnerPosture(
        boundRunner.hostInfo,
      )?.clusterIdentifier?.trim() || undefined;

    return ` Runner "${boundRunner.name || "Runner"}" is still selected for this cluster, but it is not this cluster's in-cluster Runner${
      reportedCluster ? ` (it reports cluster "${reportedCluster}")` : ""
    }, so OneUptime AI does not use it.`;
  }

  /*
   * The cluster's Kubernetes AI agent as the target. It runs kubectl with
   * its own ServiceAccount (accessMethod "in_cluster"), always accepts AI
   * commands and never carries a credential.
   */
  private getAgentAccess(data: {
    cluster: KubernetesCluster;
    agent: KubernetesAiAgent;
    isOnline: boolean;
    remediationMode: KubernetesAiRemediationMode;
  }): ResolvedTargetAccess {
    const { cluster, agent, isOnline, remediationMode } = data;
    const gaps: Array<KubernetesAiAccessGap> = [];
    const posture: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture(agent.posture);

    const runner: KubernetesAiAccessRunnerSummary = {
      id: agent.id!.toString(),
      name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      kind: "ai_agent",
      isOnline,
      lastAliveAt: agent.lastAliveAt
        ? OneUptimeDate.toString(agent.lastAliveAt)
        : undefined,
      canRunAiCommands: true,
      posture,
    };

    if (!isOnline) {
      const lastAliveText: string = agent.lastAliveAt
        ? OneUptimeDate.getDateAsFormattedString(agent.lastAliveAt)
        : "an unknown time";

      gaps.push({
        code: "ai_agent_offline",
        title: "The Kubernetes AI agent is offline",
        description:
          agent.connectionStatus === "disconnected"
            ? `The Kubernetes AI agent signed off after its last report at ${lastAliveText}: it was stopped, uninstalled, turned off with aiAgent.enabled=false, or reset, or its pod is being replaced.`
            : `The Kubernetes AI agent last reported in at ${lastAliveText}.`,
        nextStep: `Check the agent's pod: ${getAiAgentLogsCommand(
          posture?.podNamespace,
        )}. It must be able to reach your OneUptime URL.`,
        blocks: "both",
      });
    }

    /*
     * The server stamps the cluster's identifier on the agent's posture
     * every time it reports, so this only fails for a cluster row without
     * an identifier. The enqueue chokepoint refuses the same case, so the
     * status must not call it ready.
     */
    const isInClusterForThisCluster: boolean = isInClusterPostureForCluster(
      posture,
      cluster.clusterIdentifier,
    );

    if (isOnline && !isInClusterForThisCluster) {
      gaps.push({
        code: "runner_cluster_mismatch",
        title: "The Kubernetes AI agent has not reported this cluster",
        description:
          "The agent's last report does not name this cluster, so OneUptime AI does not use it yet.",
        nextStep: `Reset the agent on ${CLUSTER_AI_AGENT_PAGE}; it reconnects on its own within a few minutes.`,
        blocks: "both",
      });
    }

    if (
      remediationMode !== KubernetesAiRemediationMode.Disabled &&
      posture?.allowWrites !== true
    ) {
      gaps.push({
        code: "remediation_write_access_missing",
        title: "The Kubernetes AI agent is read-only",
        description:
          "The Kubernetes AI agent was installed without write access, so it cannot apply fixes.",
        nextStep: getRemediationWriteAccessNextStep("ai_agent"),
        blocks: "remediation",
      });
    }

    return {
      runner,
      accessMethod: isInClusterForThisCluster ? "in_cluster" : "none",
      gaps,
    };
  }

  /*
   * A Runner as the target: the chart's previous in-cluster Runner of this
   * cluster (isLegacy), or a Runner an operator bound, which reaches the
   * cluster with the cluster's Kubernetes credential.
   */
  private async getRunnerAccess(data: {
    cluster: KubernetesCluster;
    runner: Runner;
    isLegacy: boolean;
    remediationMode: KubernetesAiRemediationMode;
  }): Promise<ResolvedTargetAccess> {
    const { cluster, runner, isLegacy, remediationMode } = data;
    const gaps: Array<KubernetesAiAccessGap> = [];
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(runner.hostInfo);
    const presence: RunnerPresence = this.getRunnerPresence(runner);

    let accessMethod: KubernetesClusterAiAccessStatus["accessMethod"] = "none";
    let credentialId: string | undefined = undefined;
    let credentialName: string | undefined = undefined;

    const summary: KubernetesAiAccessRunnerSummary = {
      id: runner.id!.toString(),
      name: runner.name || "Runner",
      kind: "runner",
      isOnline: presence.isOnline,
      lastAliveAt: runner.lastAlive
        ? OneUptimeDate.toString(runner.lastAlive)
        : undefined,
      canRunAiCommands: runner.canRunAiCommands === true,
      posture,
    };

    if (!presence.isOnline) {
      gaps.push(this.getRunnerOfflineGap({ runner, presence, isLegacy }));
    }

    if (runner.canRunAiCommands !== true) {
      gaps.push({
        code: "runner_ai_commands_disabled",
        title: "The Runner does not accept AI commands",
        description: `"Runs AI Remediation Commands" is turned off on Runner "${runner.name}", so it will not be served kubectl work.`,
        nextStep:
          'Turn on "Runs AI Remediation Commands" on the Runner (Runbooks → Runners).',
        blocks: "both",
      });
    }

    /*
     * In-cluster access means "kubectl with the pod's own ServiceAccount",
     * which reaches whatever cluster the pod lives in. So it is usable only
     * when the Runner's posture names THIS cluster — a Runner that is
     * in-cluster somewhere else would run every command for this cluster
     * against the wrong one. The previous in-cluster Runner of this cluster
     * ignores a credential still selected: in-cluster access wins.
     */
    const isInClusterForThisCluster: boolean = isInClusterPostureForCluster(
      posture,
      cluster.clusterIdentifier,
    );

    if (isInClusterForThisCluster) {
      accessMethod = "in_cluster";
    } else if (isLegacy) {
      /*
       * This cluster's previous in-cluster Runner by its name, but its last
       * report does not say it runs here (a heartbeat that dropped its
       * posture). It is never given a credential, so it cannot be used —
       * and the AI agent, which needs neither, is the way forward.
       */
      gaps.push({
        code: "runner_cluster_mismatch",
        title: "The previous in-cluster Runner has not reported this cluster",
        description: `Runner "${runner.name}" has not reported that it runs in this cluster, so OneUptime AI does not use it.`,
        nextStep: `Upgrade the Kubernetes agent chart: the Kubernetes AI agent replaces this Runner and your settings carry over.\n\n${AI_AGENT_INSTALL_COMMAND}`,
        blocks: "both",
      });
    } else if (cluster.aiAccessCredentialId) {
      const credential: RunbookCredential | null =
        await RunbookCredentialService.findOneBy({
          query: {
            _id: cluster.aiAccessCredentialId.toString(),
            projectId: cluster.projectId!,
          },
          select: {
            _id: true,
            name: true,
            credentialType: true,
            runners: { _id: true },
          },
          props: { isRoot: true },
        });

      const isAssignedToRunner: boolean = Boolean(
        credential?.runners?.some((assigned: Runner) => {
          return assigned.id?.toString() === runner.id?.toString();
        }),
      );

      if (
        !credential ||
        credential.credentialType !== RunbookCredentialType.Kubernetes ||
        !isAssignedToRunner
      ) {
        gaps.push({
          code: "credential_missing",
          title: "The Kubernetes credential is not usable by the Runner",
          description: !credential
            ? "The credential bound to this cluster no longer exists."
            : credential.credentialType !== RunbookCredentialType.Kubernetes
              ? `"${credential.name}" is not a Kubernetes credential.`
              : `"${credential.name}" is not assigned to Runner "${runner.name}".`,
          nextStep: `Create a Kubernetes credential (API server URL + ServiceAccount token) under Runbooks → Runner Credentials, assign it to the Runner, and select it on ${CLUSTER_AI_AGENT_PAGE}.`,
          blocks: "both",
        });
      } else {
        accessMethod = "credential";
        credentialId = credential.id!.toString();
        credentialName = credential.name;
      }
    } else if (posture?.inCluster) {
      /*
       * In-cluster, but for no named cluster. Say so explicitly: the
       * operator picked this Runner believing "in-cluster" meant "in this
       * cluster". (A Runner that names a cluster reports an agent posture,
       * so it is a kubernetes-agent row and never reaches this branch:
       * another cluster's is no target at all — see
       * getIgnoredBoundRunnerNote.)
       */
      gaps.push({
        code: "runner_cluster_mismatch",
        title: "The bound Runner did not report which cluster it runs in",
        description: `Runner "${runner.name}" reports that it runs inside a Kubernetes cluster but not which one, so OneUptime AI cannot tell whether that is this cluster.`,
        nextStep: `Clear the Runner on ${CLUSTER_AI_AGENT_PAGE} to use this cluster's Kubernetes AI agent, or select a Kubernetes credential for this cluster that is assigned to the Runner.`,
        blocks: "both",
      });
    } else {
      gaps.push({
        code: "credential_missing",
        title: "The Runner has no credential for this cluster",
        description: `Runner "${runner.name}" runs outside the cluster, so it needs a Kubernetes credential to reach the API server.`,
        nextStep: `Select a Kubernetes credential assigned to this Runner on ${CLUSTER_AI_AGENT_PAGE} — or clear the Runner there to use the Kubernetes AI agent, which needs no credential.`,
        blocks: "both",
      });
    }

    if (
      remediationMode !== KubernetesAiRemediationMode.Disabled &&
      posture?.inCluster &&
      posture.allowWrites !== true
    ) {
      gaps.push({
        code: "remediation_write_access_missing",
        title: isLegacy
          ? "The previous in-cluster Runner is read-only"
          : "The Runner is read-only",
        description: isLegacy
          ? "The Kubernetes agent was installed without write access, so kubectl changes would be refused by the cluster."
          : `Runner "${runner.name}" reports that it may not change the cluster, so kubectl changes would be refused.`,
        nextStep: getRemediationWriteAccessNextStep(
          isLegacy ? "legacy_runner" : "credential_runner",
        ),
        blocks: "remediation",
      });
    }

    return {
      runner: summary,
      accessMethod,
      credentialId,
      credentialName,
      gaps,
    };
  }

  private getRunnerPresence(runner: Runner): RunnerPresence {
    const liveStatus: RunnerLiveStatus = getRunnerLiveStatus(runner.lastAlive);

    /*
     * A freshly created row is Disconnected with no heartbeat yet: that is
     * "never connected", not a sign-off.
     */
    const isSignedOff: boolean =
      runner.connectionStatus === RunnerConnectionStatus.Disconnected &&
      liveStatus !== RunnerLiveStatus.NeverConnected;

    return {
      liveStatus,
      isSignedOff,
      isOnline: liveStatus === RunnerLiveStatus.Connected && !isSignedOff,
    };
  }

  private getRunnerOfflineGap(data: {
    runner: Runner;
    presence: RunnerPresence;
    // The Runner is this cluster's previous in-cluster Runner.
    isLegacy: boolean;
  }): KubernetesAiAccessGap {
    const { runner, presence, isLegacy } = data;
    const lastAliveText: string = runner.lastAlive
      ? OneUptimeDate.getDateAsFormattedString(runner.lastAlive)
      : "an unknown time";

    /*
     * The previous in-cluster Runner is not coming back by itself after a
     * chart upgrade (the new chart does not install it), and there is
     * nothing to fix in it: the step is the upgrade to the AI agent.
     */
    if (isLegacy) {
      return {
        code: "runner_offline",
        title: presence.isSignedOff
          ? "The previous in-cluster Runner signed off"
          : "The previous in-cluster Runner is offline",
        description: presence.isSignedOff
          ? `Runner "${runner.name}" shut down after its last report at ${lastAliveText}.`
          : `Runner "${runner.name}" last reported in at ${lastAliveText}.`,
        nextStep: `Upgrade the Kubernetes agent chart: the Kubernetes AI agent replaces this Runner and your settings carry over.\n\n${AI_AGENT_INSTALL_COMMAND}`,
        blocks: "both",
      };
    }

    if (presence.isSignedOff) {
      return {
        code: "runner_offline",
        title: "The Runner signed off",
        description: `Runner "${runner.name}" shut down cleanly after its last heartbeat at ${lastAliveText}: its container was stopped.`,
        nextStep: `Start the Runner container again, or clear the Runner on ${CLUSTER_AI_AGENT_PAGE} to use the Kubernetes AI agent.`,
        blocks: "both",
      };
    }

    const isNeverConnected: boolean =
      presence.liveStatus === RunnerLiveStatus.NeverConnected;

    return {
      code: "runner_offline",
      title: isNeverConnected
        ? "The Runner has never connected"
        : "The Runner is offline",
      description: isNeverConnected
        ? `Runner "${runner.name}" exists but has not reported in yet.`
        : `Runner "${runner.name}" last reported in at ${lastAliveText}.`,
      nextStep:
        "Start the Runner container and make sure it can reach your OneUptime URL.",
      blocks: "both",
    };
  }

  private describeHoldings(holdings: Array<AgentRunnerHolding>): string {
    return holdings
      .map((holding: AgentRunnerHolding) => {
        return holding.description;
      })
      .join("; ");
  }

  private describeHoldingRemedies(holdings: Array<AgentRunnerHolding>): string {
    return holdings
      .map((holding: AgentRunnerHolding) => {
        return holding.remedy;
      })
      .join("; ");
  }

  // The Runner's reported posture names a cluster, and it is not this one.
  private postureNamesAnotherCluster(data: {
    runner: Runner;
    clusterIdentifier: string;
  }): boolean {
    const reported: string =
      parseKubernetesRunnerPosture(
        data.runner.hostInfo,
      )?.clusterIdentifier?.trim() || "";

    return (
      reported.length > 0 &&
      !isSameKubernetesClusterIdentifier(reported, data.clusterIdentifier)
    );
  }

  /*
   * ------------------------------------------------------------------
   * Subject → clusters
   * ------------------------------------------------------------------
   */

  /*
   * The clusters an incident or alert is about: the ones linked on the
   * subject (SeriesResourceLinker attaches them from the monitor's series
   * labels at creation), falling back to the cluster a Kubernetes monitor
   * step names when the linker had nothing to work with (a manually
   * declared incident, or one whose linking found nothing).
   *
   * The fallback matches identifiers case-insensitively, like
   * MonitorResourceContext and SeriesResourceLinker do for the same input:
   * a step identifier is typed by a person (or Terraform) and may differ in
   * case from the ingest-stamped cluster row, which keeps the casing it was
   * first seen with. The (projectId, clusterIdentifier) uniqueness guard is
   * itself case-insensitive, so this can never match extra rows.
   */
  @CaptureSpan()
  public async getClustersForSubject(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<Array<KubernetesCluster>> {
    const clusterIds: Set<string> = new Set<string>();
    const monitorIds: Array<ObjectID> = [];

    if (data.alertId) {
      const alert: Alert | null = await AlertService.findOneBy({
        query: { _id: data.alertId.toString(), projectId: data.projectId },
        select: {
          _id: true,
          monitorId: true,
          kubernetesClusters: { _id: true },
        },
        props: { isRoot: true },
      });

      for (const cluster of alert?.kubernetesClusters || []) {
        if (cluster.id) {
          clusterIds.add(cluster.id.toString());
        }
      }

      if (alert?.monitorId) {
        monitorIds.push(alert.monitorId);
      }
    } else if (data.incidentId) {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: { _id: data.incidentId.toString(), projectId: data.projectId },
        select: {
          _id: true,
          monitors: { _id: true },
          kubernetesClusters: { _id: true },
        },
        props: { isRoot: true },
      });

      for (const cluster of incident?.kubernetesClusters || []) {
        if (cluster.id) {
          clusterIds.add(cluster.id.toString());
        }
      }

      for (const monitor of incident?.monitors || []) {
        if (monitor.id) {
          monitorIds.push(monitor.id);
        }
      }
    }

    const clusterIdentifiers: Set<string> = new Set<string>();

    if (clusterIds.size === 0 && monitorIds.length > 0) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          _id: QueryHelper.any(monitorIds.slice(0, MAX_CLUSTERS_PER_SUBJECT)),
          projectId: data.projectId,
        },
        select: { _id: true, monitorSteps: true },
        limit: MAX_CLUSTERS_PER_SUBJECT,
        skip: 0,
        props: { isRoot: true },
      });

      for (const monitor of monitors) {
        const steps: Array<MonitorStep> =
          monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];
        for (const step of steps) {
          const identifier: string = normalizeKubernetesClusterIdentifier(
            step.data?.kubernetesMonitor?.clusterIdentifier,
          );
          if (identifier) {
            clusterIdentifiers.add(identifier);
          }
        }
      }
    }

    if (clusterIds.size === 0 && clusterIdentifiers.size === 0) {
      return [];
    }

    const clusters: Array<KubernetesCluster> =
      await KubernetesClusterService.findBy({
        query: {
          projectId: data.projectId,
          isArchived: false,
          ...(clusterIds.size > 0
            ? {
                _id: QueryHelper.any(
                  Array.from(clusterIds)
                    .slice(0, MAX_CLUSTERS_PER_SUBJECT)
                    .map((id: string) => {
                      return new ObjectID(id);
                    }),
                ),
              }
            : {
                clusterIdentifier: QueryHelper.findWithSameTextAnyOf(
                  Array.from(clusterIdentifiers).slice(
                    0,
                    MAX_CLUSTERS_PER_SUBJECT,
                  ),
                ),
              }),
        },
        select: CLUSTER_AI_ACCESS_SELECT,
        limit: MAX_CLUSTERS_PER_SUBJECT,
        skip: 0,
        props: { isRoot: true },
      });

    return clusters;
  }

  @CaptureSpan()
  public async getStatusesForSubject(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<Array<KubernetesClusterAiAccessStatus>> {
    const clusters: Array<KubernetesCluster> =
      await this.getClustersForSubject(data);

    if (clusters.length === 0) {
      return [];
    }

    const gates: KubernetesClusterAiAccessProjectGates =
      await this.getProjectGates(data.projectId);

    return this.getStatusesForClusters({
      projectId: data.projectId,
      clusters,
      gates,
    });
  }

  /*
   * The status of several clusters of one project, with every cluster's
   * agent row read in ONE query instead of one per cluster. When that read
   * fails, each status reads its own row (and treats a failure there as no
   * agent), exactly as a single status would.
   */
  @CaptureSpan()
  public async getStatusesForClusters(data: {
    projectId: ObjectID;
    clusters: Array<KubernetesCluster>;
    gates: KubernetesClusterAiAccessProjectGates;
  }): Promise<Array<KubernetesClusterAiAccessStatus>> {
    let agentRows: Map<string, KubernetesAiAgent> | null = null;

    try {
      agentRows = await KubernetesAiAgentService.findForClusters({
        projectId: data.projectId,
        kubernetesClusterIds: data.clusters
          .map((cluster: KubernetesCluster): ObjectID | undefined => {
            return cluster.id || undefined;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          }),
      });
    } catch (error) {
      logger.error(
        `KubernetesClusterAiAccess: could not read the Kubernetes AI agents of project ${data.projectId.toString()}; reading them one cluster at a time: ${error}`,
      );
    }

    const statuses: Array<KubernetesClusterAiAccessStatus> = [];

    for (const cluster of data.clusters) {
      statuses.push(
        await this.getStatusForClusterModel({
          cluster,
          gates: data.gates,
          aiAgentRow: agentRows
            ? agentRows.get(cluster.id?.toString() || "") || null
            : undefined,
        }),
      );
    }

    return statuses;
  }

  /*
   * ------------------------------------------------------------------
   * Previous in-cluster Runner registration
   * ------------------------------------------------------------------
   */

  /*
   * Called by the in-cluster Runner older kubernetes-agent charts deploy
   * (the Kubernetes AI agent replaces it and registers through
   * KubernetesAiAgentService instead). Authenticated
   * by the project's telemetry ingestion key (the same key the agent ships
   * telemetry with), so installing the chart with one extra flag is the
   * whole setup. Idempotent per (project, cluster): a restarted pod gets a
   * fresh key for the same Runner row and the same cluster binding.
   *
   * The ingestion key is a credential every collector, CI job and sidecar
   * in the project holds, so what it can do here is deliberately narrow:
   *
   * - It can mint an agent Runner row for a cluster (bounded per project,
   *   see MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT).
   * - It can re-key that row only while the row is OFFLINE (no heartbeat
   *   for RUNNER_ALIVE_WINDOW_IN_MINUTES, or signed off) or when the
   *   request presents the row's current key. A Runner the dashboard shows
   *   as connected can therefore not be taken over by anyone but itself:
   *   whoever holds a leaked ingestion key cannot lock the live pod out and
   *   be handed the identity every kubectl job for that cluster is targeted
   *   at.
   *
   *   The trade-off is availability after a pod restart: the new pod holds
   *   no key, so it is refused until the previous instance's last heartbeat
   *   ages out of the alive window (it retries with backoff and then
   *   succeeds). A pod that shuts down cleanly avoids the wait by calling
   *   /runner-ingest/disconnect on the way out, which marks the row offline
   *   at once.
   * - Without that proof it can re-key only a row that holds NOTHING beyond
   *   the agent defaults. An offline window is predictable (every helm
   *   upgrade opens one), so a row an operator gave more — a credential or
   *   secret assigned to it, runbooks or code fixes turned on, or another
   *   cluster bound to it — is refused: re-keying it would hand all of that
   *   to whoever holds the ingestion key. The operator removes the extras
   *   (the Runner then comes back still bound), or upgrades the chart to
   *   the Kubernetes AI agent, which needs no Runner at all.
   * - It finds the row it may re-key by this cluster's agent Runner NAME
   *   only — never by the posture a Runner reports about itself — and only
   *   binds a cluster that never had a Runner bound: a cluster whose
   *   binding was cleared (or whose Runner was deleted) stays unbound, and
   *   an operator's AI settings are never overwritten, only the chart's
   *   defaults fill in a cluster nobody configured.
   * - While the cluster's Kubernetes AI agent is online the Runner is
   *   refused (superseded_by_ai_agent) before anything is written: the
   *   agent replaces it. The refusal clears on its own once the agent
   *   stops, so a helm rollback to a chart with the Runner works again for
   *   a cluster still bound to that Runner (already_bound — every cluster
   *   the Runner served before the upgrade).
   * - A cluster that has a Kubernetes AI agent row is never given the
   *   chart's defaults by a Runner's first bind (the agent's own first
   *   connection decides those). The binding rules below are unchanged by
   *   the agent row: a cluster that never had a Runner bound and never ran
   *   kubectl is bound with no switch moved, but one where AI already ran
   *   kubectl — through the agent too: its commands and "Test connection"
   *   record the same history — stays unbound (left_unbound_by_operator).
   *   That history cannot tell the agent's commands from a revoked
   *   Runner's, so it fails closed: nothing reaches the cluster until its
   *   agent is back online.
   * - Every refusal is a KubernetesAgentRegistrationRefusedException whose
   *   reason tells the Runner whether waiting helps.
   *
   * Every bind and key rotation is written to the cluster's feed — saying
   * whether the rotation was proven (the current key was presented) or not
   * — so an operator can see when the identity behind AI access changed.
   */
  @CaptureSpan()
  public async registerKubernetesAgentRunner(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
    agentVersion?: string | undefined;
    posture: KubernetesRunnerPosture;
    /*
     * The key the Runner currently holds, when it still has one. Proves
     * continuity, so a live Runner may rotate its own key without waiting
     * to be considered offline first.
     */
    previousRunnerKey?: string | undefined;
  }): Promise<RegisterKubernetesAgentRunnerResult> {
    const clusterIdentifier: string = (data.clusterIdentifier || "").trim();

    if (!clusterIdentifier) {
      throw new BadDataException("clusterName is required.");
    }

    /*
     * A name longer than the cluster identifier column can never become a
     * cluster row, so say so before anything is written. Every shorter
     * name works: the Runner row's name is bounded separately.
     */
    if (clusterIdentifier.length > MAX_KUBERNETES_CLUSTER_IDENTIFIER_LENGTH) {
      throw new BadDataException(
        `clusterName is ${clusterIdentifier.length} characters long; OneUptime accepts Kubernetes cluster names of up to ${MAX_KUBERNETES_CLUSTER_IDENTIFIER_LENGTH} characters. Set a shorter clusterName on the Kubernetes agent chart.`,
      );
    }

    const agentRunnerName: string =
      getKubernetesAgentRunnerNameForCluster(clusterIdentifier);

    const created: KubernetesCluster =
      await KubernetesClusterService.findOrCreateByClusterIdentifier({
        projectId: data.projectId,
        clusterIdentifier,
      });

    const cluster: KubernetesCluster | null =
      await KubernetesClusterService.findOneBy({
        query: { _id: created.id!.toString(), projectId: data.projectId },
        select: CLUSTER_AI_ACCESS_SELECT,
        props: { isRoot: true },
      });

    if (!cluster) {
      throw new BadDataException("Cluster could not be resolved.");
    }

    /*
     * The Kubernetes AI agent replaces this Runner: while the cluster's
     * agent is online nothing is created, re-keyed or bound. Checked
     * first, so a rolled-back pod that keeps retrying during an upgrade
     * never takes the cluster back from a working agent.
     */
    const aiAgent: KubernetesAiAgent | null =
      await KubernetesAiAgentService.findForCluster({
        projectId: data.projectId,
        kubernetesClusterId: cluster.id!,
      });

    if (aiAgent && KubernetesAiAgentService.isOnline(aiAgent)) {
      logger.warn(
        `KubernetesClusterAiAccess: refused to register the in-cluster Runner of cluster "${clusterIdentifier}" in project ${data.projectId.toString()}: the cluster's Kubernetes AI agent is online and replaces it.`,
      );

      throw new KubernetesAgentRegistrationRefusedException({
        reason: "superseded_by_ai_agent",
        retryAfterSeconds: SUPERSEDED_BY_AI_AGENT_RETRY_AFTER_SECONDS,
        message: getSupersededByAiAgentMessage(clusterIdentifier),
      });
    }

    /*
     * What the row stores: the body's posture, with the cluster and
     * in-cluster set by the service. A re-key may fill in the write scope
     * an older agent image left out of its body (keepStoredWriteScope).
     */
    let posture: KubernetesRunnerPosture = {
      ...data.posture,
      clusterIdentifier,
      inCluster: true,
    };

    // What a re-key decision reads off an existing agent Runner row.
    const runnerSelect: Record<string, boolean> = {
      _id: true,
      name: true,
      hostInfo: true,
      lastAlive: true,
      connectionStatus: true,
      key: true,
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
    };

    /*
     * The agent Runner row for this cluster, bound or not — found by its
     * NAME, never by the posture a Runner reports about itself. The name is
     * the server-owned marker: only registration writes it, and
     * RunnerService refuses to let anyone else rename a row into or out of
     * it, whereas a posture is whatever the Runner last heartbeated. So a
     * bound Runner that merely CLAIMS to be this cluster's in-cluster Runner
     * (a renamed agent row, another cluster's pod, anything) is never
     * re-keyed here. Matched case-insensitively, like the cluster row
     * itself, so a chart that registers "Prod-US" finds the row a "prod-us"
     * registration made.
     */
    let runner: Runner | null = await RunnerService.findOneBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameText(agentRunnerName),
      },
      select: runnerSelect,
      props: { isRoot: true },
    });

    /*
     * The name is this cluster's, but the row says it is another cluster's
     * agent (a shortened name whose hash collided, or a posture rewritten on
     * heartbeat). Re-keying it would move another cluster's identity here,
     * and creating a second row would trip the unique name — so refuse, and
     * say which row is in the way. The instruction comes first: the Runner
     * logs only the start of a long reason.
     */
    if (
      runner &&
      this.postureNamesAnotherCluster({ runner, clusterIdentifier })
    ) {
      logger.warn(
        `KubernetesClusterAiAccess: refused to register an agent Runner for cluster "${clusterIdentifier}" in project ${data.projectId.toString()}: Runner "${runner.name}" (${runner.id?.toString()}) reports that it belongs to a different cluster.`,
      );

      throw new KubernetesAgentRegistrationRefusedException({
        reason: "runner_belongs_to_another_cluster",
        message: `Upgrade the Kubernetes agent chart of cluster "${clusterIdentifier}": its Kubernetes AI agent replaces the in-cluster Runner and does not need Runner "${runner.name}". That Runner already exists in this project but reports that it is the in-cluster Runner of a different cluster, so it was not reused for cluster "${clusterIdentifier}".`,
      });
    }

    const agentRunnerExistedBefore: boolean = Boolean(runner);
    const runnerKey: string = ObjectID.generate().toString();
    let reKeyAdmission: AgentRunnerReKeyAdmission | undefined = undefined;

    if (runner) {
      reKeyAdmission = await this.assertRunnerMayBeReKeyed({
        runner,
        clusterIdentifier,
        clusterId: cluster.id!,
        projectId: data.projectId,
        previousRunnerKey: data.previousRunnerKey,
      });

      posture = this.keepStoredWriteScope({
        reported: posture,
        stored: parseKubernetesRunnerPosture(runner.hostInfo),
      });

      await RunnerService.updateOneById({
        id: runner.id!,
        data: {
          key: runnerKey,
          hostInfo: { kubernetes: posture as unknown as JSONObject },
          lastAlive: OneUptimeDate.getCurrentDate(),
          connectionStatus: RunnerConnectionStatus.Connected,
          ...(data.agentVersion
            ? { agentVersion: new Version(data.agentVersion) }
            : {}),
        } as never,
        props: { isRoot: true },
      });
    } else {
      await this.assertAgentRunnerMayBeCreated({
        projectId: data.projectId,
        clusterIdentifier,
      });

      const newRunner: Runner = new Runner();
      newRunner.projectId = data.projectId;
      newRunner.name = agentRunnerName;
      newRunner.description = `In-cluster Runner installed by the OneUptime Kubernetes agent chart (aiAccess.enabled=true). Gives OneUptime AI kubectl access to cluster "${clusterIdentifier}". It never runs runbooks or code fixes.`;
      newRunner.key = runnerKey;
      newRunner.canRunRunbooks = false;
      newRunner.canRunCodeFixTasks = false;
      newRunner.canRunAiCommands = true;
      newRunner.hostInfo = { kubernetes: posture as unknown as JSONObject };
      newRunner.lastAlive = OneUptimeDate.getCurrentDate();
      newRunner.connectionStatus = RunnerConnectionStatus.Connected;
      if (data.agentVersion) {
        newRunner.agentVersion = new Version(data.agentVersion);
      }

      runner = await RunnerService.create({
        data: newRunner,
        props: { isRoot: true },
      });
    }

    /*
     * Binding. The dashboard is the control plane:
     *
     * - A cluster already bound to this cluster's agent row stays so; only
     *   the key (and posture) rotated.
     * - A cluster bound to any other Runner is left alone. A bound id whose
     *   Runner row is gone is only the race with a Runner delete (the
     *   foreign key is about to clear it) and is treated like the unbound
     *   case below: never re-bound.
     * - A cluster with no Runner bound:
     *     - that had a Runner bound before (aiAccessRunnerBoundAt, stamped
     *       on every bind and never cleared) or has run kubectl (a recorded
     *       verification or error) stays unbound and keeps its switches.
     *       That covers both ways a binding goes away: an operator cleared
     *       it on the AI page, or the bound Runner was DELETED — the
     *       binding's foreign key is ON DELETE SET NULL, so Postgres clears
     *       aiAccessRunnerId in the same statement. Deleting the Runner is
     *       how an operator revokes or resets it, so it must not come back
     *       bound a few heartbeats later. Such a cluster uses its
     *       Kubernetes AI agent instead.
     *       History counts whoever made it: with a Kubernetes AI agent row
     *       it is usually the agent's (it records every command and "Test
     *       connection" on the cluster), but it cannot be told apart from a
     *       revoked Runner's, so such a cluster stays unbound too and is
     *       reached again once its agent is back online. A rollback keeps
     *       working through the Runner a cluster is still bound to
     *       (already_bound above), not through a new binding here.
     *     - that never had a Runner bound but was configured on the AI page
     *       (aiAccessConfiguredAt: an operator chose a mode, the switches
     *       or an allowlist BEFORE installing the chart), or that already
     *       has a Kubernetes AI agent row that never ran kubectl here, is
     *       bound to this agent Runner with every setting left exactly as
     *       it is — the one-flag install still just works.
     *     - that nobody ever configured takes the chart's intent:
     *       investigation on, remediation "ask for approval" when the chart
     *       also granted write RBAC (a mode already on the row is kept).
     */
    let bindingState: KubernetesAgentRunnerBindingState;
    let appliedRemediationMode: KubernetesAiRemediationMode | undefined =
      undefined;

    const hadRunnerBound: boolean = Boolean(cluster.aiAccessRunnerBoundAt);
    const hasCommandHistory: boolean =
      Boolean(cluster.aiAccessLastVerifiedAt) ||
      Boolean(cluster.aiAccessLastError);

    if (cluster.aiAccessRunnerId) {
      /*
       * A row this registration just created cannot already be bound, even
       * if the ids happened to compare equal.
       */
      const isBoundToThisRow: boolean =
        agentRunnerExistedBefore &&
        cluster.aiAccessRunnerId.toString() === runner.id!.toString();

      if (isBoundToThisRow) {
        bindingState = "already_bound";
      } else {
        const boundRunner: Runner | null = await RunnerService.findOneBy({
          query: {
            _id: cluster.aiAccessRunnerId.toString(),
            projectId: data.projectId,
          },
          select: { _id: true },
          props: { isRoot: true },
        });

        bindingState = boundRunner
          ? "bound_to_other_runner"
          : "left_unbound_by_operator";
      }
    } else if (hadRunnerBound || hasCommandHistory) {
      bindingState = "left_unbound_by_operator";
    } else if (cluster.aiAccessConfiguredAt || aiAgent) {
      /*
       * Configured by an operator before the chart was installed, or the
       * cluster already has a Kubernetes AI agent (offline, or this
       * registration would have been refused) that has not run kubectl
       * here: bind, so AI works through this Runner, but leave every
       * switch — and the configured marker — exactly as they are.
       */
      bindingState = "bound_keeping_operator_settings";

      // Only the binding: not one of the operator's switches moves.
      await KubernetesClusterService.updateOneById({
        id: cluster.id!,
        data: {
          aiAccessRunnerId: runner.id!,
          aiAccessRunnerBoundAt: OneUptimeDate.getCurrentDate(),
        } as never,
        props: { isRoot: true },
      });
    } else {
      bindingState = "first_bind";

      appliedRemediationMode = this.getFirstBindRemediationMode({
        currentMode: cluster.aiRemediationMode,
        allowWrites: posture.allowWrites === true,
      });

      await KubernetesClusterService.updateOneById({
        id: cluster.id!,
        data: {
          aiAccessRunnerId: runner.id!,
          aiAccessCredentialId: null,
          isAiInvestigationEnabled: true,
          aiRemediationMode: appliedRemediationMode,
          aiAccessConfiguredAt: OneUptimeDate.getCurrentDate(),
          aiAccessRunnerBoundAt: OneUptimeDate.getCurrentDate(),
        } as never,
        props: { isRoot: true },
      });
    }

    if (bindingState === "left_unbound_by_operator") {
      logger.info(
        `KubernetesClusterAiAccess: cluster "${clusterIdentifier}" in project ${data.projectId.toString()} had a Runner bound before (or has run kubectl${
          aiAgent ? ", possibly through its Kubernetes AI agent" : ""
        }) but has none bound now; the in-cluster Runner registered without binding it.`,
      );
    }

    const isBoundToCluster: boolean =
      bindingState === "first_bind" ||
      bindingState === "bound_keeping_operator_settings" ||
      bindingState === "already_bound";

    await this.writeRegistrationFeedItem({
      cluster,
      runner,
      posture,
      bindingState,
      agentRunnerExistedBefore,
      appliedRemediationMode,
      reKeyAdmission,
      hasAiAgent: Boolean(aiAgent),
      hadRunnerBound,
      aiAgentPodNamespace: aiAgent
        ? parseKubernetesAgentPosture(aiAgent.posture)?.podNamespace
        : undefined,
    });

    return {
      runnerId: runner.id!,
      runnerKey,
      clusterId: cluster.id!,
      isBoundToCluster,
      isFirstBind: bindingState === "first_bind",
      bindingState,
    };
  }

  /*
   * The posture a re-keyed agent Runner row stores. An agent image older
   * than the write scope's registration fields sends neither
   * writeNamespaces nor podNamespace when it registers (its heartbeat
   * does). Storing that body as it is would clear the scope the row
   * already holds, and every server-side check — the enqueue chokepoint,
   * the remediation toolkit, the cluster's AI page — would read the Runner
   * as cluster-wide with no namespace of its own until its first
   * heartbeat. So a field the body leaves out keeps the value the row last
   * reported; a field it sends wins, an explicit empty list (cluster-wide)
   * included. Keeping a stored value can only make the server refuse more
   * than the Runner would, never less, until the heartbeat corrects it.
   */
  public keepStoredWriteScope(data: {
    reported: KubernetesRunnerPosture;
    stored: KubernetesRunnerPosture | undefined;
  }): KubernetesRunnerPosture {
    const { reported, stored } = data;
    const posture: KubernetesRunnerPosture = { ...reported };

    if (
      reported.writeNamespaces === undefined &&
      stored?.writeNamespaces !== undefined
    ) {
      posture.writeNamespaces = [...stored.writeNamespaces];
    }

    if (reported.podNamespace === undefined && stored?.podNamespace) {
      posture.podNamespace = stored.podNamespace;
    }

    return posture;
  }

  /*
   * The remediation mode a first bind leaves on the cluster. The chart's
   * intent fills in only what the operator has not set: a mode still at
   * its default (Disabled) becomes "ask for approval" when the chart
   * granted write RBAC, and stays Disabled otherwise. A mode an operator
   * already chose on the AI page — even before any Runner was bound — is
   * kept exactly as chosen: a pod registering never downgrades or upgrades
   * a dashboard decision. (A write mode on a read-only Runner is not a
   * hazard; it reads as a remediation_write_access_missing gap and nothing
   * runs.)
   */
  public getFirstBindRemediationMode(data: {
    currentMode: unknown;
    allowWrites: boolean;
  }): KubernetesAiRemediationMode {
    const currentMode: KubernetesAiRemediationMode =
      this.normalizeRemediationMode(data.currentMode);

    if (currentMode !== KubernetesAiRemediationMode.Disabled) {
      return currentMode;
    }

    return data.allowWrites
      ? KubernetesAiRemediationMode.RequireApproval
      : KubernetesAiRemediationMode.Disabled;
  }

  /*
   * A registration may replace the key of an existing agent Runner row only
   * when it can be the same Runner coming back:
   *
   * - it presents the row's current key (proof of continuity) — always
   *   admitted; or
   * - the row is offline or signed off (what a restarted pod looks like)
   *   AND holds nothing beyond the agent defaults. Anyone holding the
   *   ingestion key looks exactly like a restarted pod, and the offline
   *   window is predictable (every helm upgrade opens one), so a row an
   *   operator gave more — credentials or secrets assigned to it, runbooks
   *   or code fixes turned on, another cluster bound to it — must not be
   *   handed to a registration that cannot prove it is the same Runner.
   *
   * Refused otherwise — WITHOUT rotating anything — so an ingestion key
   * alone can never evict a live Runner or inherit what an operator
   * entrusted to one. Nothing about the current key is disclosed on
   * refusal. Returns how the re-key was admitted, for the feed.
   */
  private async assertRunnerMayBeReKeyed(data: {
    runner: Runner;
    clusterIdentifier: string;
    clusterId: ObjectID;
    projectId: ObjectID;
    previousRunnerKey?: string | undefined;
  }): Promise<AgentRunnerReKeyAdmission> {
    const provesContinuity: boolean = Boolean(
      data.previousRunnerKey &&
        data.runner.key &&
        this.isSameSecret(data.previousRunnerKey, data.runner.key),
    );

    if (provesContinuity) {
      return "continuity";
    }

    /*
     * connectionStatus is written by the Runner's own sign-off
     * (/runner-ingest/disconnect): a pod that shut down cleanly is offline
     * the moment it says so, whatever its last heartbeat's age.
     */
    const presence: RunnerPresence = this.getRunnerPresence(data.runner);

    if (presence.isOnline) {
      logger.warn(
        `KubernetesClusterAiAccess: refused to re-key Runner "${
          data.runner.name
        }" (${data.runner.id?.toString()}) for cluster "${
          data.clusterIdentifier
        }" in project ${data.projectId.toString()}: the Runner is online and the registration did not present its current key.`,
      );

      /*
       * The one refusal that clears on its own: the previous instance's
       * last heartbeat ages out of the alive window. Say when, so the
       * Runner retries then instead of guessing.
       */
      throw new KubernetesAgentRegistrationRefusedException({
        reason: "previous_instance_online",
        retryAfterSeconds: getPreviousInstanceRetryAfterSeconds({
          lastAlive: data.runner.lastAlive,
        }),
        message: `Runner "${data.runner.name}" for cluster "${data.clusterIdentifier}" is online, so this registration was refused and its key was not changed. A registration replaces a Runner only once it has been offline for ${RUNNER_ALIVE_WINDOW_IN_MINUTES} minutes, or when the request presents that Runner's current key as previousRunnerKey. If the Runner pod just restarted, keep retrying: it is admitted as soon as the previous instance's last heartbeat is older than ${RUNNER_ALIVE_WINDOW_IN_MINUTES} minutes (a pod that shuts down cleanly can call /runner-ingest/disconnect to skip the wait).`,
      });
    }

    const holdings: Array<AgentRunnerHolding> =
      await this.getRunnerHoldingsBeyondDefaults({
        runner: data.runner,
        clusterId: data.clusterId,
        projectId: data.projectId,
      });

    if (holdings.length > 0) {
      logger.warn(
        `KubernetesClusterAiAccess: refused to re-key Runner "${
          data.runner.name
        }" (${data.runner.id?.toString()}) for cluster "${
          data.clusterIdentifier
        }" in project ${data.projectId.toString()} without proof of continuity: it holds more than an in-cluster Runner's defaults (${this.describeHoldings(
          holdings,
        )}).`,
      );

      /*
       * The instruction leads: the Runner logs only the start of a long
       * reason, and this refusal never clears until someone acts on it.
       */
      throw new KubernetesAgentRegistrationRefusedException({
        reason: "runner_holds_more_than_defaults",
        message: `Upgrade the Kubernetes agent chart: its Kubernetes AI agent replaces this in-cluster Runner. Or, under Runbooks → Runners, on Runner "${data.runner.name}": ${this.describeHoldingRemedies(
          holdings,
        )}. It is offline, but it holds more than an in-cluster Runner's defaults (${this.describeHoldings(
          holdings,
        )}), so a registration for cluster "${data.clusterIdentifier}" that does not present its current key may not take it over, and its key was not changed.`,
      });
    }

    if (presence.isSignedOff) {
      return "signed_off";
    }

    return presence.liveStatus === RunnerLiveStatus.NeverConnected
      ? "never_connected"
      : "offline";
  }

  /*
   * What an agent Runner row holds beyond what registration gave it, one
   * entry per kind with what removes it. Registration creates the row with
   * kubectl access only (no runbooks, no code fixes, nothing assigned) bound
   * to its own cluster; anything else was entrusted to the row by an
   * operator. "Runs Runbooks" is read the way the claim path reads it: on
   * unless explicitly false. Also what decides whether an unused previous
   * in-cluster Runner may be retired (KubernetesAiAgentService).
   */
  public async getRunnerHoldingsBeyondDefaults(data: {
    runner: Runner;
    clusterId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<AgentRunnerHolding>> {
    const holdings: Array<AgentRunnerHolding> = [];

    if (data.runner.canRunRunbooks !== false) {
      holdings.push({
        description: '"Runs Runbooks" is on',
        remedy: 'turn off "Runs Runbooks"',
      });
    }

    if (data.runner.canRunCodeFixTasks === true) {
      holdings.push({
        description: '"Runs AI Code Fixes" is on',
        remedy: 'turn off "Runs AI Code Fixes"',
      });
    }

    const assignedCredentials: number = (
      await RunbookCredentialService.countBy({
        query: {
          projectId: data.projectId,
          runners: QueryHelper.inRelationArray([data.runner.id!]),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (assignedCredentials > 0) {
      holdings.push({
        description: `${assignedCredentials} Runner credential(s) assigned`,
        remedy: `unassign its ${assignedCredentials} Runner credential(s)`,
      });
    }

    const assignedSecrets: number = (
      await RunbookSecretService.countBy({
        query: {
          projectId: data.projectId,
          runners: QueryHelper.inRelationArray([data.runner.id!]),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (assignedSecrets > 0) {
      holdings.push({
        description: `${assignedSecrets} runbook secret(s) assigned`,
        remedy: `unassign its ${assignedSecrets} runbook secret(s)`,
      });
    }

    const otherBoundClusters: number = (
      await KubernetesClusterService.countBy({
        query: {
          projectId: data.projectId,
          aiAccessRunnerId: data.runner.id!,
          _id: QueryHelper.notEquals(data.clusterId),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (otherBoundClusters > 0) {
      holdings.push({
        description: `the AI access Runner of ${otherBoundClusters} other cluster(s)`,
        remedy: `clear the Runner on the AI agent page of the ${otherBoundClusters} other cluster(s) bound to it`,
      });
    }

    return holdings;
  }

  /*
   * Bounds what an ingestion key can mint. Counted on the Runner rows
   * themselves (name prefix) so every registration path shares one brake.
   */
  private async assertAgentRunnerMayBeCreated(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
  }): Promise<void> {
    const agentRunnerNameFilter: unknown = QueryHelper.startsWith(
      `${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/`,
    );

    const totalAgentRunners: number = (
      await RunnerService.countBy({
        query: {
          projectId: data.projectId,
          name: agentRunnerNameFilter as never,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (totalAgentRunners >= MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT) {
      logger.warn(
        `KubernetesClusterAiAccess: refused to create an agent Runner for cluster "${data.clusterIdentifier}" in project ${data.projectId.toString()}: the project already has ${totalAgentRunners} agent Runners (limit ${MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT}).`,
      );

      throw new TooManyRequestsException(
        `This project already has ${totalAgentRunners} in-cluster Runners, which is its limit (${MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT}). Delete the Runners of clusters that no longer exist under Runbooks → Runners, then retry.`,
      );
    }

    const createdInLastHour: number = (
      await RunnerService.countBy({
        query: {
          projectId: data.projectId,
          name: agentRunnerNameFilter as never,
          createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeHoursAgo(1)),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (
      createdInLastHour >= MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR
    ) {
      logger.warn(
        `KubernetesClusterAiAccess: refused to create an agent Runner for cluster "${data.clusterIdentifier}" in project ${data.projectId.toString()}: ${createdInLastHour} agent Runners were created in the last hour (limit ${MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR}).`,
      );

      throw new TooManyRequestsException(
        `${createdInLastHour} in-cluster Runners were registered in this project in the last hour, which is its limit (${MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR}). The Runner will be admitted when it retries later.`,
      );
    }
  }

  // Best-effort: the feed must never fail the registration it describes.
  private async writeRegistrationFeedItem(data: {
    cluster: KubernetesCluster;
    runner: Runner;
    posture: KubernetesRunnerPosture;
    bindingState: KubernetesAgentRunnerBindingState;
    agentRunnerExistedBefore: boolean;
    // The mode a first bind left on the cluster; undefined otherwise.
    appliedRemediationMode?: KubernetesAiRemediationMode | undefined;
    // How an existing row's re-key was admitted; undefined for a new row.
    reKeyAdmission?: AgentRunnerReKeyAdmission | undefined;
    // The cluster has a Kubernetes AI agent row (offline: this one got in).
    hasAiAgent?: boolean | undefined;
    // A Runner was bound to the cluster before (aiAccessRunnerBoundAt).
    hadRunnerBound?: boolean | undefined;
    // The namespace the cluster's agent reported, when known.
    aiAgentPodNamespace?: string | undefined;
  }): Promise<void> {
    try {
      const runnerName: string = data.runner.name || "kubernetes-agent";
      const writes: string = data.posture.allowWrites
        ? "writes allowed"
        : "read-only";
      const registered: string = this.describeRegistration(
        data.agentRunnerExistedBefore ? data.reKeyAdmission : undefined,
      );

      let feedInfoInMarkdown: string;
      let displayColor: typeof Blue500 = Blue500;

      if (data.bindingState === "first_bind") {
        displayColor = Green500;
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** registered from the Kubernetes agent chart (${writes}) and was bound as this cluster's AI access Runner. AI investigation is on; AI remediation is ${this.describeRemediationMode(
          data.appliedRemediationMode,
        )}.`;
      } else if (
        data.bindingState === "bound_keeping_operator_settings" &&
        data.hasAiAgent &&
        !data.cluster.aiAccessConfiguredAt
      ) {
        displayColor = Green500;
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${registered} from the Kubernetes agent chart (${writes}) while this cluster's Kubernetes AI agent is offline, and was bound so AI works through it: no Runner was bound here before and AI had not run kubectl here yet. No AI setting was changed. The Kubernetes AI agent takes over again as soon as it is back online.`;
      } else if (data.bindingState === "bound_keeping_operator_settings") {
        displayColor = Green500;
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${registered} from the Kubernetes agent chart (${writes}) and was bound as this cluster's AI access Runner. AI access had already been configured on the cluster's AI agent page, so no AI setting was changed: AI investigation with kubectl is ${
          data.cluster.isAiInvestigationEnabled === true ? "on" : "off"
        } and AI remediation is ${this.describeRemediationMode(
          data.cluster.aiRemediationMode,
        )}, as an operator chose.`;
      } else if (
        data.bindingState === "left_unbound_by_operator" &&
        data.hasAiAgent &&
        !data.hadRunnerBound &&
        !data.cluster.aiAccessRunnerId
      ) {
        /*
         * No Runner was ever bound, so the history that kept this one
         * unbound is most likely the agent's own — not an operator's
         * doing. Say that, and where AI access comes back from.
         */
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${registered} (${writes}) while this cluster's Kubernetes AI agent is offline, and was left unbound: AI has already run kubectl on this cluster (through its Kubernetes AI agent, or a Runner that is no longer bound), and a registering Runner is never bound over that history. No AI setting was changed. AI reaches this cluster again when its Kubernetes AI agent is back online: check the agent's pod with \`${getAiAgentLogsCommand(
          data.aiAgentPodNamespace,
        )}\`, or upgrade the Kubernetes agent chart again.`;
      } else if (data.bindingState === "left_unbound_by_operator") {
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${registered} (${writes}), but no Runner is bound to this cluster although one was before (or AI already ran kubectl here) — the binding was cleared by an operator, or the Runner it was bound to was deleted — so it was left unbound and no AI switch was changed. Upgrade the Kubernetes agent chart to use the Kubernetes AI agent instead.`;
      } else if (data.bindingState === "bound_to_other_runner") {
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${registered} (${writes}), but this cluster is bound to a different Runner in the dashboard, so it was not used.`;
      } else if (data.reKeyAdmission === "continuity") {
        feedInfoInMarkdown = `🔑 The in-cluster Runner **${runnerName}** re-registered and its key was rotated (${writes}). It presented its current key, so this is the same Runner.`;
      } else {
        /*
         * A re-key without proof is what a restarted pod looks like — and
         * also what anyone holding the telemetry ingestion key looks like.
         * Said plainly, so an unexpected one stands out from a restart.
         */
        displayColor = Yellow500;
        feedInfoInMarkdown = `🔑 The in-cluster Runner **${runnerName}** ${registered} (${writes}). That is expected when the agent's Runner pod restarts or is upgraded. If it did not, someone holding this project's telemetry ingestion key registered in its place: disable that key and delete this Runner so the agent registers afresh.`;
      }

      await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
        kubernetesClusterId: data.cluster.id!,
        projectId: data.cluster.projectId!,
        kubernetesClusterFeedEventType:
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
        displayColor,
        feedInfoInMarkdown,
        moreInformationInMarkdown: [
          `**Runner**: ${runnerName} (${data.runner.id?.toString() || "?"})`,
          `**Cluster identifier**: \`${data.posture.clusterIdentifier || ""}\``,
          `**kubectl**: ${data.posture.kubectlVersion || "not detected"}`,
          `**Agent chart**: ${data.posture.agentChartVersion || "unknown"}`,
        ].join("\n\n"),
      });
    } catch (error) {
      logger.error(
        `KubernetesClusterAiAccess: could not write the registration feed item for cluster ${data.cluster.id?.toString()}: ${error}`,
      );
    }
  }

  /*
   * How the Runner came to hold its new key, in the feed's words: a new
   * row, a re-key the Runner proved (it presented its current key), or a
   * re-key without that proof — which names why it was admitted.
   */
  private describeRegistration(
    reKeyAdmission: AgentRunnerReKeyAdmission | undefined,
  ): string {
    switch (reKeyAdmission) {
      case undefined:
        return "registered";
      case "continuity":
        return "re-registered (its key was rotated; it presented its current key)";
      case "signed_off":
        return "re-registered and its key was rotated WITHOUT proof of continuity (it did not present its previous key; admitted because the previous instance had signed off)";
      case "never_connected":
        return "re-registered and its key was rotated WITHOUT proof of continuity (it did not present its previous key; admitted because the Runner had never connected)";
      default:
        return "re-registered and its key was rotated WITHOUT proof of continuity (it did not present its previous key; admitted because the previous instance had stopped heartbeating)";
    }
  }

  // The AI page's label for a mode, quoted the way the page shows it.
  private describeRemediationMode(mode: unknown): string {
    switch (this.normalizeRemediationMode(mode)) {
      case KubernetesAiRemediationMode.RequireApproval:
        return '"Ask for approval"';
      case KubernetesAiRemediationMode.Automatic:
        return '"Automatic"';
      case KubernetesAiRemediationMode.BypassApproval:
        return '"Bypass approval"';
      default:
        return "Disabled";
    }
  }

  // Constant-time comparison so a refusal cannot leak the key byte by byte.
  private isSameSecret(presented: string, current: string): boolean {
    const presentedBuffer: Buffer = Buffer.from(presented, "utf8");
    const currentBuffer: Buffer = Buffer.from(current, "utf8");

    if (presentedBuffer.length !== currentBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(presentedBuffer, currentBuffer);
  }

  /*
   * ------------------------------------------------------------------
   * Bookkeeping
   * ------------------------------------------------------------------
   */

  // Best-effort: the AI page shows "last verified" / "last error" from this.
  @CaptureSpan()
  public async recordCommandOutcome(data: {
    clusterId: ObjectID;
    succeeded: boolean;
    errorMessage?: string | undefined;
  }): Promise<void> {
    try {
      await KubernetesClusterService.updateOneById({
        id: data.clusterId,
        data: (data.succeeded
          ? {
              aiAccessLastVerifiedAt: OneUptimeDate.getCurrentDate(),
              aiAccessLastError: null,
            }
          : {
              aiAccessLastError: (data.errorMessage || "Command failed.").slice(
                0,
                2000,
              ),
            }) as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `KubernetesClusterAiAccess: could not record command outcome for cluster ${data.clusterId.toString()}: ${error}`,
      );
    }
  }

  public normalizeRemediationMode(value: unknown): KubernetesAiRemediationMode {
    if (
      value === KubernetesAiRemediationMode.RequireApproval ||
      value === KubernetesAiRemediationMode.Automatic ||
      value === KubernetesAiRemediationMode.BypassApproval
    ) {
      return value;
    }
    return KubernetesAiRemediationMode.Disabled;
  }

  /*
   * The allowlist column is jsonb; the dashboard may save it as an array or
   * as a JSON string. Anything unusable normalizes to empty — nothing
   * risky auto-executes.
   */
  public normalizeAllowlist(value: unknown): Array<string> {
    let raw: unknown = value;

    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = [value];
      }
    }

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .filter((pattern: unknown) => {
        return typeof pattern === "string" && pattern.trim().length > 0;
      })
      .map((pattern: string) => {
        return pattern.trim();
      });
  }
}

const KubernetesClusterAiAccessService: KubernetesClusterAiAccessServiceClass =
  new KubernetesClusterAiAccessServiceClass();

export default KubernetesClusterAiAccessService;
