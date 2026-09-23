import Alert from "../../Models/DatabaseModels/Alert";
import Incident from "../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
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
import { PermissionHelper } from "../../Types/Permission";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import {
  RUNNER_ALIVE_WINDOW_IN_MINUTES,
  RunnerLiveStatus,
  getRunnerLiveStatus,
} from "../../Types/Runner/RunnerLiveStatus";
import {
  KUBERNETES_AGENT_RUNNER_NAME_PREFIX,
  KubernetesAgentRegistrationRefusalReason,
  KubernetesAgentRunnerBindingState,
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
  isInClusterPostureForCluster,
  isSameKubernetesClusterIdentifier,
  normalizeKubernetesClusterIdentifier,
  parseKubernetesRunnerPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import { KubernetesClusterFeedEventType } from "../../Models/DatabaseModels/KubernetesClusterFeed";
import { Blue500, Green500, Yellow500 } from "../../Types/BrandColors";
import QueryHelper from "../Types/Database/QueryHelper";
import AlertService from "./AlertService";
import IncidentService from "./IncidentService";
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
 * AI page, the investigation panel ("we could not access the cluster, here
 * is why") and the AI runs themselves (which only ever act on a cluster this
 * module calls ready).
 *
 * It also binds the in-cluster Runner the kubernetes-agent chart installs:
 * that Runner registers with the project's telemetry ingestion key and the
 * cluster's name, and this module upserts its Runner row and points the
 * cluster at it. One helm flag, no dashboard steps.
 */

export interface KubernetesClusterAiAccessProjectGates {
  isAiEnabled: boolean;
  isAutoRemediationEnabled: boolean;
  isAiCommandExecutionEnabled: boolean;
  hasLlmProvider: boolean;
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
 * What to do about an in-cluster Runner that reports read-only RBAC while
 * remediation is on. It points at the AI page's write-access section, which
 * carries the complete helm commands (a bare --set line would miss the
 * chart index refresh and --reuse-values), and names the two values that
 * bound what the write role reaches: the namespaces it is bound in and the
 * node switch. Shown verbatim on incident pages too, so it names the page
 * rather than saying "this page".
 */
export const REMEDIATION_WRITE_ACCESS_NEXT_STEP: string =
  'Grant the in-cluster Runner write access with a helm upgrade that adds --set aiAccess.remediation.enabled=true; the complete commands are under "Let AI apply fixes (write access)" on the cluster\'s AI page. List the namespaces AI may fix in aiAccess.remediation.namespaces (without it the write role is bound cluster-wide), and add aiAccess.remediation.nodeOperations=false to keep fixes off nodes.';

/*
 * Why deleting an in-cluster Runner is a two-step remedy. The binding's
 * foreign key is ON DELETE SET NULL, so a deleted Runner's clusters are
 * left with no Runner bound, and registration never binds a cluster that
 * had one (left_unbound_by_operator): the fresh Runner the agent registers
 * is used only once someone selects it on the cluster's AI page. Selecting
 * a Runner loosens AI access, so it needs one of these permissions — which
 * whoever deleted the Runner may not hold.
 */
export function getDeletedAgentRunnerRebindNote(): string {
  return `Deleting a Runner leaves the clusters it was bound to with no Runner bound, and a registering Runner never binds a cluster that had one. Selecting a Runner needs one of these permissions: ${PermissionHelper.getPermissionTitles(
    KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  ).join(", ")}.`;
}

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
 * what an operator does under Project Settings → Runners to remove it.
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
        enableAutoRemediation: true,
        enableAiCommandExecution: true,
      },
      props: { isRoot: true },
    });

    let hasLlmProvider: boolean = false;

    try {
      hasLlmProvider =
        (await LlmProviderService.getLLMProviderForProject(projectId)) !== null;
    } catch (error) {
      logger.error(
        `KubernetesClusterAiAccess: could not resolve the LLM provider for project ${projectId.toString()}: ${error}`,
      );
    }

    return {
      // Kill switches: a missing column counts as enabled (=== false idiom).
      isAiEnabled: project?.enableAi !== false,
      isAutoRemediationEnabled: project?.enableAutoRemediation !== false,
      // Explicit opt-in (=== true idiom), same as the Bash/SSH lane.
      isAiCommandExecutionEnabled: project?.enableAiCommandExecution === true,
      hasLlmProvider,
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
   * The readiness computation proper. Reads the bound Runner and credential
   * as root (the cluster row is already tenant-scoped by the caller) and
   * folds project gates in. Never throws: a lookup failure becomes a gap,
   * because "we could not check" must not read as "ready".
   */
  @CaptureSpan()
  public async getStatusForClusterModel(data: {
    cluster: KubernetesCluster;
    gates: KubernetesClusterAiAccessProjectGates;
  }): Promise<KubernetesClusterAiAccessStatus> {
    const { cluster, gates } = data;
    const gaps: Array<KubernetesAiAccessGap> = [];

    const remediationMode: KubernetesAiRemediationMode =
      this.normalizeRemediationMode(cluster.aiRemediationMode);
    const isInvestigationEnabled: boolean =
      cluster.isAiInvestigationEnabled === true;

    let runnerSummary: KubernetesClusterAiAccessStatus["runner"] = null;
    let accessMethod: KubernetesClusterAiAccessStatus["accessMethod"] = "none";
    let credentialId: string | undefined = undefined;
    let credentialName: string | undefined = undefined;

    if (!cluster.aiAccessRunnerId) {
      gaps.push(await this.getNoRunnerBoundGap(cluster));
    } else {
      const runner: Runner | null = await RunnerService.findOneBy({
        query: {
          _id: cluster.aiAccessRunnerId.toString(),
          projectId: cluster.projectId!,
        },
        select: {
          _id: true,
          name: true,
          lastAlive: true,
          connectionStatus: true,
          canRunAiCommands: true,
          // What would stop an offline agent row from re-registering.
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          hostInfo: true,
        },
        props: { isRoot: true },
      });

      if (!runner) {
        /*
         * Only a race reaches this: the binding's foreign key is ON DELETE
         * SET NULL, so deleting the bound Runner clears aiAccessRunnerId in
         * the same statement, and the next read takes the no_runner_bound
         * branch above. This is the window between reading the cluster row
         * and reading its Runner while a delete lands.
         */
        gaps.push({
          code: "runner_missing",
          title: "The bound Runner was just deleted",
          description:
            "The Runner this cluster was bound to was deleted while its status was being read.",
          nextStep:
            "Reload the cluster's AI page, then bind another Runner there, or reinstall the in-cluster Runner with --set aiAccess.enabled=true.",
          blocks: "both",
        });
      } else {
        const posture: KubernetesRunnerPosture | undefined =
          parseKubernetesRunnerPosture(runner.hostInfo);
        const presence: RunnerPresence = this.getRunnerPresence(runner);
        const isOnline: boolean = presence.isOnline;
        // The one "is an agent row" rule: the name marker or an agent posture.
        const isAgentRunnerRow: boolean =
          RunnerServiceClass.isKubernetesAgentRunnerRow(runner);
        const isAgentRunner: boolean =
          isAgentRunnerRow || posture?.inCluster === true;

        runnerSummary = {
          id: runner.id!.toString(),
          name: runner.name || "Runner",
          isOnline,
          lastAliveAt: runner.lastAlive
            ? OneUptimeDate.toString(runner.lastAlive)
            : undefined,
          canRunAiCommands: runner.canRunAiCommands === true,
          posture,
        };

        if (!isOnline) {
          /*
           * An offline agent Runner of THIS cluster that holds more than the
           * agent defaults will be refused on every re-registration its
           * restarted pod attempts (it cannot present the key it held), so
           * "it reconnects within a minute" would be false: say what blocks
           * it instead.
           */
          const holdingsGap: KubernetesAiAccessGap | null =
            RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
              runner,
              cluster.clusterIdentifier,
            )
              ? await this.getAgentRunnerHoldingsGap({ runner, cluster })
              : null;

          gaps.push(
            holdingsGap ||
              this.getRunnerOfflineGap({ runner, presence, isAgentRunner }),
          );
        }

        if (runner.canRunAiCommands !== true) {
          gaps.push({
            code: "runner_ai_commands_disabled",
            title: "The Runner does not accept AI commands",
            description: `"Runs AI Remediation Commands" is turned off on Runner "${runner.name}", so it will not be served kubectl work.`,
            nextStep:
              'Turn on "Runs AI Remediation Commands" on the Runner (Project Settings → Runners).',
            blocks: "both",
          });
        }

        /*
         * In-cluster access means "kubectl with the pod's own
         * ServiceAccount", which reaches whatever cluster the pod lives
         * in. So it is usable only when the Runner's posture names THIS
         * cluster — a Runner that is in-cluster somewhere else (the
         * dashboard lets an operator pick any Runner) would run every
         * command for this cluster against the wrong one.
         */
        const isInClusterForThisCluster: boolean = isInClusterPostureForCluster(
          posture,
          cluster.clusterIdentifier,
        );

        if (isInClusterForThisCluster) {
          accessMethod = "in_cluster";
        } else if (cluster.aiAccessCredentialId && isAgentRunnerRow) {
          /*
           * A kubernetes-agent Runner is never handed credential material:
           * its row is minted and re-keyed with the project's telemetry
           * ingestion key, so a credential it carried would be one leaked
           * ingestion key away from anyone. The claim path refuses to
           * resolve one for it (by the same name-or-posture rule);
           * readiness says so instead of promising access that would fail
           * on every command.
           */
          gaps.push({
            code: "credential_on_agent_runner",
            title: "An in-cluster Runner cannot carry a credential",
            description: `Runner "${runner.name}" is ${
              posture?.clusterIdentifier?.trim()
                ? `the in-cluster Runner of cluster "${posture.clusterIdentifier.trim()}"`
                : "a Kubernetes agent's in-cluster Runner"
            }. It runs kubectl with its own ServiceAccount only and is never given a credential, so the Kubernetes credential selected for this cluster cannot be used through it.`,
            nextStep:
              "Create a Runner under Project Settings → Runners, assign the Kubernetes credential to it and select both on the cluster's AI page — or install the in-cluster Runner on THIS cluster with --set aiAccess.enabled=true, which needs no credential.",
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
              nextStep:
                "Create a Kubernetes credential (API server URL + ServiceAccount token) under Project Settings → Runner Credentials, assign it to the Runner, and select it on the cluster's AI page.",
              blocks: "both",
            });
          } else {
            accessMethod = "credential";
            credentialId = credential.id!.toString();
            credentialName = credential.name;
          }
        } else if (posture?.inCluster) {
          /*
           * In-cluster, but for another cluster (or for no named cluster
           * at all). Say so explicitly: the operator picked this Runner
           * believing "in-cluster" meant "in this cluster".
           */
          const reportedCluster: string | undefined =
            posture.clusterIdentifier?.trim() || undefined;

          gaps.push({
            code: "runner_cluster_mismatch",
            title: reportedCluster
              ? "The bound Runner is the in-cluster Runner of a different cluster"
              : "The bound Runner did not report which cluster it runs in",
            description: reportedCluster
              ? `Runner "${runner.name}" runs inside cluster "${reportedCluster}", not "${
                  cluster.clusterIdentifier || cluster.name || "this cluster"
                }". Its ServiceAccount would run every kubectl command against "${reportedCluster}", so OneUptime AI will not use it for this cluster.`
              : `Runner "${runner.name}" reports that it runs inside a Kubernetes cluster but not which one, so OneUptime AI cannot tell whether that is this cluster.`,
            nextStep:
              "Install the in-cluster Runner on THIS cluster with --set aiAccess.enabled=true and select it on the cluster's AI page as its Runner (a registering Runner never replaces the Runner a cluster is bound to), or bind a Runner that holds a Kubernetes credential for this cluster and select that credential on the cluster's AI page.",
            blocks: "both",
          });
        } else {
          gaps.push({
            code: "credential_missing",
            title: "The Runner has no credential for this cluster",
            description: `Runner "${runner.name}" runs outside the cluster, so it needs a Kubernetes credential to reach the API server.`,
            nextStep:
              "Select a Kubernetes credential assigned to this Runner on the cluster's AI page — or install the in-cluster Runner with --set aiAccess.enabled=true, which needs no credential.",
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
            title: "The in-cluster Runner is read-only",
            description:
              "The Kubernetes agent was installed without write access, so kubectl changes would be refused by the cluster.",
            nextStep: REMEDIATION_WRITE_ACCESS_NEXT_STEP,
            blocks: "remediation",
          });
        }
      }
    }

    if (!isInvestigationEnabled) {
      gaps.push({
        code: "investigation_disabled",
        title: "AI investigation is turned off for this cluster",
        description:
          "OneUptime AI will investigate incidents and alerts on this cluster with OneUptime data only — it will not run kubectl.",
        nextStep:
          'Turn on "Let AI investigate with kubectl" on the cluster\'s AI page.',
        blocks: "investigation",
      });
    }

    if (remediationMode === KubernetesAiRemediationMode.Disabled) {
      gaps.push({
        code: "remediation_disabled",
        title: "AI remediation is turned off for this cluster",
        description:
          "OneUptime AI will diagnose but never propose or apply a fix on this cluster.",
        nextStep:
          'Set "AI remediation" to "Ask for approval", "Automatic" or "Bypass approval" on the cluster\'s AI page.',
        blocks: "remediation",
      });
    }

    if (!gates.isAiEnabled) {
      gaps.push({
        code: "project_ai_disabled",
        title: "AI is disabled for this project",
        description: "OneUptime AI is switched off at the project level.",
        nextStep: "Enable AI under Project Settings → AI.",
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

    if (!gates.isAutoRemediationEnabled) {
      gaps.push({
        code: "project_auto_remediation_disabled",
        title: "Auto-remediation is disabled for this project",
        description:
          "The project-level auto-remediation kill switch is off, so no AI fix can be proposed or run.",
        nextStep: "Enable auto-remediation under Project Settings → AI.",
        blocks: "remediation",
      });
    }

    if (!gates.isAiCommandExecutionEnabled) {
      gaps.push({
        code: "project_ai_command_execution_disabled",
        title: "AI command execution is not enabled for this project",
        description:
          "AI-composed commands (including kubectl fixes) never run in a project that has not opted in.",
        nextStep:
          'Turn on "Enable AI Command Execution" under Project Settings → AI.',
        blocks: "remediation",
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
      runner: runnerSummary,
      accessMethod,
      credentialId,
      credentialName,
      kubectlAllowlist: this.normalizeAllowlist(
        cluster.aiKubectlCommandAllowlist,
      ),
      isInvestigationEnabled,
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
   * Is this Runner online right now? One rule for readiness and for
   * registration: it heartbeated within the alive window (RunnerLiveStatus)
   * AND it has not signed off since. A Runner signs off on a clean shutdown
   * (/runner-ingest/disconnect), which is what a helm uninstall or turning
   * aiAccess off does to the agent's Runner pod — it must read offline at
   * once, not stay "Connected" until its last heartbeat ages out while
   * investigations queue kubectl it will never claim. A freshly created
   * row is Disconnected with no heartbeat yet: that is "never connected",
   * not a sign-off.
   */
  private getRunnerPresence(runner: Runner): RunnerPresence {
    const liveStatus: RunnerLiveStatus = getRunnerLiveStatus(runner.lastAlive);

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
    // The Runner is a Kubernetes agent's in-cluster Runner.
    isAgentRunner: boolean;
  }): KubernetesAiAccessGap {
    const { runner, presence, isAgentRunner } = data;
    const lastAliveText: string = runner.lastAlive
      ? OneUptimeDate.getDateAsFormattedString(runner.lastAlive)
      : "an unknown time";

    if (presence.isSignedOff) {
      return {
        code: "runner_offline",
        title: isAgentRunner
          ? "The in-cluster Runner signed off"
          : "The Runner signed off",
        description: isAgentRunner
          ? `Runner "${runner.name}" shut down cleanly after its last heartbeat at ${lastAliveText}: the Kubernetes agent was uninstalled or upgraded with aiAccess turned off, or its Runner pod is being replaced.`
          : `Runner "${runner.name}" shut down cleanly after its last heartbeat at ${lastAliveText}: its container was stopped.`,
        nextStep: isAgentRunner
          ? "If the agent was uninstalled or aiAccess was turned off on purpose, clear the Runner on the cluster's AI page. Otherwise upgrade the agent with --set aiAccess.enabled=true and the Runner reconnects within a minute."
          : "Start the Runner container again, or bind another Runner on the cluster's AI page.",
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
      nextStep: isAgentRunner
        ? "Check the in-cluster Runner pod: kubectl get pods -n <agent-namespace> -l component=ai-runner, then its logs. It must be able to reach your OneUptime URL."
        : "Start the Runner container and make sure it can reach your OneUptime URL.",
      blocks: "both",
    };
  }

  /*
   * The gap for an offline agent Runner of this cluster that holds more than
   * the agent defaults, or null when it holds nothing extra. Such a row is
   * refused on every registration that cannot present its current key — and
   * a restarted pod never can, it keeps the key in memory only — so the
   * Runner will not come back until an operator removes what it holds.
   * Never throws: a failed lookup falls back to the ordinary offline gap.
   */
  private async getAgentRunnerHoldingsGap(data: {
    runner: Runner;
    cluster: KubernetesCluster;
  }): Promise<KubernetesAiAccessGap | null> {
    let holdings: Array<AgentRunnerHolding> = [];

    try {
      holdings = await this.getRunnerHoldingsBeyondDefaults({
        runner: data.runner,
        clusterId: data.cluster.id!,
        projectId: data.cluster.projectId!,
      });
    } catch (error) {
      logger.error(
        `KubernetesClusterAiAccess: could not read what the agent Runner of cluster ${data.cluster.id?.toString()} holds: ${error}`,
      );
      return null;
    }

    if (holdings.length === 0) {
      return null;
    }

    return {
      code: "runner_offline",
      title: "The in-cluster Runner cannot re-register until it holds less",
      description: `Runner "${data.runner.name}" is offline, and it holds more than an in-cluster Runner's defaults (${this.describeHoldings(
        holdings,
      )}). A restarted in-cluster Runner cannot prove it is the same Runner, so every registration it attempts is refused and it will not reconnect on its own.`,
      /*
       * Removing what it holds comes first: the Runner row survives, so the
       * cluster stays bound to it and it reconnects on its next retry.
       * Deleting it works too, but only with the second step — the fresh
       * Runner is not bound to this cluster until someone selects it.
       */
      nextStep: `Under Project Settings → Runners, on Runner "${data.runner.name}": ${this.describeHoldingRemedies(
        holdings,
      )}. The in-cluster Runner then reconnects on its next retry, still bound to this cluster. Or delete the Runner and, once the in-cluster Runner registers a fresh one (within a minute), select it on the cluster's AI page as its Runner. ${getDeletedAgentRunnerRebindNote()}`,
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

  /*
   * The gap for a cluster with no Runner bound. What to do depends on
   * whether this cluster's in-cluster Runner is already registered: a
   * registering Runner never binds a cluster whose AI access was configured
   * before (an operator cleared the binding, or the Runner it was bound to
   * was deleted), so re-running the helm upgrade would change nothing —
   * selecting the Runner on the AI page is the step that works. Never
   * throws: a failed lookup falls back to the install instruction.
   */
  private async getNoRunnerBoundGap(
    cluster: KubernetesCluster,
  ): Promise<KubernetesAiAccessGap> {
    const agentRunner: Runner | null =
      await this.findAgentRunnerForCluster(cluster);

    if (agentRunner) {
      const isOnline: boolean = this.getRunnerPresence(agentRunner).isOnline;

      return {
        code: "no_runner_bound",
        title: "The in-cluster Runner is installed but not selected",
        description: `Runner "${agentRunner.name}", this cluster's in-cluster Runner, is registered${
          isOnline ? " and online" : " but not online right now"
        }, but no Runner is bound to this cluster, so OneUptime AI does not use it. A registering Runner never re-binds a cluster that had a Runner bound before (or already ran kubectl) — its binding was cleared by an operator, or the Runner it was bound to was deleted.`,
        nextStep: `Select the kubernetes-agent Runner "${agentRunner.name}" on the cluster's AI page as its Runner (leave the credential empty). No helm change is needed.`,
        blocks: "both",
      };
    }

    return {
      code: "no_runner_bound",
      title: "No Runner can reach this cluster",
      description:
        "OneUptime AI runs kubectl through a Runner. None is bound to this cluster yet.",
      nextStep:
        "Upgrade the Kubernetes agent with --set aiAccess.enabled=true to install an in-cluster Runner (one command), or bind an existing Runner and a Kubernetes credential on the cluster's AI page.",
      blocks: "both",
    };
  }

  /*
   * This cluster's agent Runner row, by its (bounded) name, matched
   * case-insensitively like registration matches it. A row whose posture
   * names a DIFFERENT cluster is not this cluster's agent (a shortened
   * name's hash collision, or a posture rewritten on heartbeat).
   */
  private async findAgentRunnerForCluster(
    cluster: KubernetesCluster,
  ): Promise<Runner | null> {
    const clusterIdentifier: string = (cluster.clusterIdentifier || "").trim();

    if (!clusterIdentifier || !cluster.projectId) {
      return null;
    }

    try {
      const runner: Runner | null = await RunnerService.findOneBy({
        query: {
          projectId: cluster.projectId,
          name: QueryHelper.findWithSameText(
            getKubernetesAgentRunnerNameForCluster(clusterIdentifier),
          ),
        },
        select: {
          _id: true,
          name: true,
          lastAlive: true,
          connectionStatus: true,
          hostInfo: true,
        },
        props: { isRoot: true },
      });

      if (
        !runner ||
        this.postureNamesAnotherCluster({ runner, clusterIdentifier })
      ) {
        return null;
      }

      return runner;
    } catch (error) {
      logger.error(
        `KubernetesClusterAiAccess: could not look up the agent Runner of cluster ${cluster.id?.toString()}: ${error}`,
      );
      return null;
    }
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

    const statuses: Array<KubernetesClusterAiAccessStatus> = [];

    for (const cluster of clusters) {
      statuses.push(await this.getStatusForClusterModel({ cluster, gates }));
    }

    return statuses;
  }

  /*
   * ------------------------------------------------------------------
   * In-cluster Runner registration
   * ------------------------------------------------------------------
   */

  /*
   * Called by the Runner the kubernetes-agent chart deploys. Authenticated
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
   *   (the Runner then comes back still bound), or deletes the Runner, lets
   *   the agent register a fresh one and selects it on the cluster's AI
   *   page — a deleted Runner's cluster is left unbound, see below.
   * - It finds the row it may re-key by this cluster's agent Runner NAME
   *   only — never by the posture a Runner reports about itself — and only
   *   binds a cluster that never had a Runner bound: a cluster whose
   *   binding was cleared (or whose Runner was deleted) stays unbound, and
   *   an operator's AI settings are never overwritten, only the chart's
   *   defaults fill in a cluster nobody configured.
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

    const posture: KubernetesRunnerPosture = {
      ...data.posture,
      clusterIdentifier,
      inCluster: true,
    };

    const hostInfo: JSONObject = {
      kubernetes: posture as unknown as JSONObject,
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
        message: `Delete Runner "${runner.name}" under Project Settings → Runners (an in-cluster Runner cannot be renamed) and, once the agent registers a fresh one on its next retry, select it on the AI page of cluster "${clusterIdentifier}" as its Runner. That Runner already exists in this project but reports that it is the in-cluster Runner of a different cluster, so it was not reused for cluster "${clusterIdentifier}". ${getDeletedAgentRunnerRebindNote()}`,
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

      await RunnerService.updateOneById({
        id: runner.id!,
        data: {
          key: runnerKey,
          hostInfo,
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
      newRunner.hostInfo = hostInfo;
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
     *       bound a few heartbeats later. The AI page tells the operator to
     *       select the Runner if they want it back.
     *     - that never had a Runner bound but was configured on the AI page
     *       (aiAccessConfiguredAt: an operator chose a mode, the switches
     *       or an allowlist BEFORE installing the chart) is bound to this
     *       agent Runner with every setting left exactly as the operator
     *       chose it — the one-flag install still just works.
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
    } else if (cluster.aiAccessConfiguredAt) {
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
        `KubernetesClusterAiAccess: cluster "${clusterIdentifier}" in project ${data.projectId.toString()} had a Runner bound before (or has run kubectl) but has none bound now — the binding was cleared, or its Runner was deleted; the in-cluster Runner registered without re-binding it.`,
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
        message: `Under Project Settings → Runners, on Runner "${data.runner.name}": ${this.describeHoldingRemedies(
          holdings,
        )} — or delete the Runner and, once the agent registers a fresh one on its next retry, select it on the cluster's AI page as its Runner. It is offline, but it holds more than an in-cluster Runner's defaults (${this.describeHoldings(
          holdings,
        )}), so a registration for cluster "${data.clusterIdentifier}" that does not present its current key may not take it over, and its key was not changed. ${getDeletedAgentRunnerRebindNote()}`,
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
   * unless explicitly false.
   */
  private async getRunnerHoldingsBeyondDefaults(data: {
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
        remedy: `select another Runner on the AI page of the ${otherBoundClusters} other cluster(s) bound to it`,
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
        `This project already has ${totalAgentRunners} in-cluster Runners, which is its limit (${MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT}). Delete the Runners of clusters that no longer exist under Project Settings → Runners, then retry.`,
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
      } else if (data.bindingState === "bound_keeping_operator_settings") {
        displayColor = Green500;
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${registered} from the Kubernetes agent chart (${writes}) and was bound as this cluster's AI access Runner. AI access had already been configured on the cluster's AI page, so no AI setting was changed: AI investigation with kubectl is ${
          data.cluster.isAiInvestigationEnabled === true ? "on" : "off"
        } and AI remediation is ${this.describeRemediationMode(
          data.cluster.aiRemediationMode,
        )}, as an operator chose.`;
      } else if (data.bindingState === "left_unbound_by_operator") {
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${registered} (${writes}), but no Runner is bound to this cluster although one was before (or AI already ran kubectl here) — the binding was cleared by an operator, or the Runner it was bound to was deleted — so it was left unbound and no AI switch was changed. Select **${runnerName}** on the cluster's AI page to use it.`;
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
