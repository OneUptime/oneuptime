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
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import {
  RUNNER_ALIVE_WINDOW_IN_MINUTES,
  RunnerLiveStatus,
  getRunnerLiveStatus,
} from "../../Types/Runner/RunnerLiveStatus";
import {
  KUBERNETES_AGENT_RUNNER_NAME_PREFIX,
  KubernetesAgentRunnerBindingState,
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
  getKubernetesAgentRunnerName,
  isInClusterPostureForCluster,
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
import RunnerService from "./RunnerService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import crypto from "crypto";

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
   * chose in the dashboard, or when an operator cleared the binding. The
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
  isArchived: true,
};

const MAX_CLUSTERS_PER_SUBJECT: number = 10;

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
      gaps.push({
        code: "no_runner_bound",
        title: "No Runner can reach this cluster",
        description:
          "OneUptime AI runs kubectl through a Runner. None is bound to this cluster yet.",
        nextStep:
          "Upgrade the Kubernetes agent with --set aiAccess.enabled=true to install an in-cluster Runner (one command), or bind an existing Runner and a Kubernetes credential on this cluster's AI page.",
        blocks: "both",
      });
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
          canRunAiCommands: true,
          hostInfo: true,
        },
        props: { isRoot: true },
      });

      if (!runner) {
        gaps.push({
          code: "runner_missing",
          title: "The bound Runner no longer exists",
          description:
            "The Runner this cluster was bound to was deleted or moved to another project.",
          nextStep:
            "Bind another Runner on this cluster's AI page, or reinstall the in-cluster Runner with --set aiAccess.enabled=true.",
          blocks: "both",
        });
      } else {
        const posture: KubernetesRunnerPosture | undefined =
          parseKubernetesRunnerPosture(runner.hostInfo);
        const liveStatus: RunnerLiveStatus = getRunnerLiveStatus(
          runner.lastAlive,
        );
        const isOnline: boolean = liveStatus === RunnerLiveStatus.Connected;

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
          gaps.push({
            code: "runner_offline",
            title:
              liveStatus === RunnerLiveStatus.NeverConnected
                ? "The Runner has never connected"
                : "The Runner is offline",
            description:
              liveStatus === RunnerLiveStatus.NeverConnected
                ? `Runner "${runner.name}" exists but has not reported in yet.`
                : `Runner "${runner.name}" last reported in at ${
                    runner.lastAlive
                      ? OneUptimeDate.getDateAsFormattedString(runner.lastAlive)
                      : "an unknown time"
                  }.`,
            nextStep: posture?.inCluster
              ? "Check the in-cluster Runner pod: kubectl get pods -n <agent-namespace> -l component=ai-runner, then its logs. It must be able to reach your OneUptime URL."
              : "Start the Runner container and make sure it can reach your OneUptime URL.",
            blocks: "both",
          });
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
                "Create a Kubernetes credential (API server URL + ServiceAccount token) under Project Settings → Runner Credentials, assign it to the Runner, and select it on this cluster's AI page.",
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
              "Install the in-cluster Runner on THIS cluster with --set aiAccess.enabled=true (it binds itself), or bind a Runner that holds a Kubernetes credential for this cluster and select that credential on the cluster's AI page.",
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
            nextStep:
              "Upgrade the agent with --set aiAccess.remediation.enabled=true to grant the Runner's ServiceAccount the write verbs OneUptime AI may use.",
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
          'Turn on "Let AI investigate with kubectl" on this cluster\'s AI page.',
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
          'Set "AI remediation" to "Ask for approval", "Automatic" or "Bypass approval" on this cluster\'s AI page.',
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
   * ------------------------------------------------------------------
   * Subject → clusters
   * ------------------------------------------------------------------
   */

  /*
   * The clusters an incident or alert is about: the ones linked on the
   * subject (SeriesResourceLinker attaches them from the monitor's series
   * labels at creation), falling back to the cluster a Kubernetes monitor
   * step names when the linker had nothing to work with.
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
          const identifier: string | undefined =
            step.data?.kubernetesMonitor?.clusterIdentifier?.trim();
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
                clusterIdentifier: QueryHelper.any(
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
   *   for RUNNER_ALIVE_WINDOW_IN_MINUTES) or when the request presents the
   *   row's current key. A Runner the dashboard shows as connected can
   *   therefore not be taken over by anyone but itself: whoever holds a
   *   leaked ingestion key cannot lock the live pod out and be handed the
   *   identity every kubectl job for that cluster is targeted at.
   *
   *   The trade-off is availability after a pod restart: the new pod holds
   *   no key, so it is refused until the previous instance's last heartbeat
   *   ages out of the alive window (it retries with backoff and then
   *   succeeds). A pod that shuts down cleanly avoids the wait by calling
   *   /runner-ingest/disconnect on the way out, which marks the row offline
   *   at once.
   * - It never re-binds a cluster an operator configured: only a cluster
   *   that has NEVER been AI-configured takes the chart's defaults.
   *
   * Every bind, takeover and key rotation is written to the cluster's feed
   * so an operator can see when the identity behind AI access changed.
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

    // The Runner row currently bound, if any.
    let boundRunner: Runner | null = null;

    if (cluster.aiAccessRunnerId) {
      boundRunner = await RunnerService.findOneBy({
        query: {
          _id: cluster.aiAccessRunnerId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          hostInfo: true,
          lastAlive: true,
          connectionStatus: true,
          key: true,
        },
        props: { isRoot: true },
      });
    }

    /*
     * The bound Runner is reused ONLY when it is this cluster's own agent:
     * in-cluster AND registered under this cluster's name. A bound Runner
     * that is in-cluster somewhere else is another cluster's live pod (the
     * dashboard lets an operator pick any Runner); rotating its key here
     * would lock that pod out and start a re-register ping-pong between
     * the two clusters over one Runner row.
     */
    const boundIsThisClustersAgent: boolean = Boolean(
      boundRunner &&
        isInClusterPostureForCluster(
          parseKubernetesRunnerPosture(boundRunner.hostInfo),
          clusterIdentifier,
        ),
    );

    let runner: Runner | null = boundIsThisClustersAgent ? boundRunner : null;

    if (!runner) {
      /*
       * The agent Runner row for this cluster, bound or not. Matched
       * case-insensitively, like the cluster row itself, so a chart that
       * registers "Prod-US" finds the row a "prod-us" registration made.
       */
      runner = await RunnerService.findOneBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameText(
            getKubernetesAgentRunnerName(clusterIdentifier),
          ),
        },
        select: {
          _id: true,
          name: true,
          hostInfo: true,
          lastAlive: true,
          connectionStatus: true,
          key: true,
        },
        props: { isRoot: true },
      });
    }

    const agentRunnerExistedBefore: boolean = Boolean(runner);
    const runnerKey: string = ObjectID.generate().toString();

    if (runner) {
      this.assertRunnerMayBeReKeyed({
        runner,
        clusterIdentifier,
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
      newRunner.name = getKubernetesAgentRunnerName(clusterIdentifier);
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
     * - A cluster nobody has ever AI-configured takes the chart's intent:
     *   investigation on, remediation "ask for approval" when the chart
     *   also granted write RBAC — but only for switches still at their
     *   defaults. A remediation mode an operator already chose on the AI
     *   page (before any Runner was bound) is kept as chosen.
     * - A cluster whose binding an operator CLEARED stays cleared. An
     *   unbound cluster is telling us "operator turned this off" whenever
     *   it has any AI-access history — an agent Runner row that already
     *   existed for it, or a recorded command outcome — so the pod is
     *   re-keyed but nothing on the cluster changes.
     * - A cluster an operator bound to a different Runner is left alone.
     * - A cluster bound to a Runner that no longer exists is taken over,
     *   switches untouched.
     */
    const hasAiAccessHistory: boolean =
      agentRunnerExistedBefore ||
      Boolean(cluster.aiAccessLastVerifiedAt) ||
      Boolean(cluster.aiAccessLastError);

    let bindingState: KubernetesAgentRunnerBindingState;
    let appliedRemediationMode: KubernetesAiRemediationMode | undefined =
      undefined;

    if (!cluster.aiAccessRunnerId) {
      if (!hasAiAccessHistory) {
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
          } as never,
          props: { isRoot: true },
        });
      } else {
        bindingState = "left_unbound_by_operator";

        logger.info(
          `KubernetesClusterAiAccess: cluster "${clusterIdentifier}" in project ${data.projectId.toString()} has an AI-access history but no Runner bound; the in-cluster Runner re-registered without re-binding it.`,
        );
      }
    } else if (boundIsThisClustersAgent) {
      bindingState = "already_bound";
    } else if (!boundRunner) {
      bindingState = "rebound_after_runner_missing";

      await KubernetesClusterService.updateOneById({
        id: cluster.id!,
        data: {
          aiAccessRunnerId: runner.id!,
          aiAccessCredentialId: null,
        } as never,
        props: { isRoot: true },
      });
    } else {
      bindingState = "bound_to_other_runner";
    }

    const isBoundToCluster: boolean =
      bindingState === "first_bind" ||
      bindingState === "already_bound" ||
      bindingState === "rebound_after_runner_missing";

    await this.writeRegistrationFeedItem({
      cluster,
      runner,
      posture,
      bindingState,
      agentRunnerExistedBefore,
      appliedRemediationMode,
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
   * when it can be the same Runner coming back: the row is offline, or the
   * caller holds the row's current key. Refused otherwise — WITHOUT
   * rotating anything — so an ingestion key alone can never evict a live
   * Runner. Nothing about the current key is disclosed on refusal.
   */
  private assertRunnerMayBeReKeyed(data: {
    runner: Runner;
    clusterIdentifier: string;
    projectId: ObjectID;
    previousRunnerKey?: string | undefined;
  }): void {
    const liveStatus: RunnerLiveStatus = getRunnerLiveStatus(
      data.runner.lastAlive,
    );

    /*
     * connectionStatus is written by the Runner's own sign-off
     * (/runner-ingest/disconnect): a pod that shut down cleanly is offline
     * the moment it says so, whatever its last heartbeat's age.
     */
    const isOnline: boolean =
      liveStatus === RunnerLiveStatus.Connected &&
      data.runner.connectionStatus !== RunnerConnectionStatus.Disconnected;

    if (!isOnline) {
      return;
    }

    const provesContinuity: boolean = Boolean(
      data.previousRunnerKey &&
        data.runner.key &&
        this.isSameSecret(data.previousRunnerKey, data.runner.key),
    );

    if (provesContinuity) {
      return;
    }

    logger.warn(
      `KubernetesClusterAiAccess: refused to re-key Runner "${
        data.runner.name
      }" (${data.runner.id?.toString()}) for cluster "${
        data.clusterIdentifier
      }" in project ${data.projectId.toString()}: the Runner is online and the registration did not present its current key.`,
    );

    throw new ForbiddenException(
      `Runner "${data.runner.name}" for cluster "${data.clusterIdentifier}" is online, so this registration was refused and its key was not changed. A registration replaces a Runner only once it has been offline for ${RUNNER_ALIVE_WINDOW_IN_MINUTES} minutes, or when the request presents that Runner's current key as previousRunnerKey. If the Runner pod just restarted, keep retrying: it is admitted as soon as the previous instance's last heartbeat is older than ${RUNNER_ALIVE_WINDOW_IN_MINUTES} minutes (a pod that shuts down cleanly can call /runner-ingest/disconnect to skip the wait).`,
    );
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
  }): Promise<void> {
    try {
      const runnerName: string = data.runner.name || "kubernetes-agent";
      const writes: string = data.posture.allowWrites
        ? "writes allowed"
        : "read-only";

      let feedInfoInMarkdown: string;
      let displayColor: typeof Blue500 = Blue500;

      if (data.bindingState === "first_bind") {
        displayColor = Green500;
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** registered from the Kubernetes agent chart (${writes}) and was bound as this cluster's AI access Runner. AI investigation is on; AI remediation is ${this.describeRemediationMode(
          data.appliedRemediationMode,
        )}.`;
      } else if (data.bindingState === "rebound_after_runner_missing") {
        displayColor = Yellow500;
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** registered (${writes}) and took over this cluster's AI access binding because the previously bound Runner no longer exists. The AI switches were not changed.`;
      } else if (data.bindingState === "left_unbound_by_operator") {
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${
          data.agentRunnerExistedBefore
            ? "re-registered (its key was rotated)"
            : "registered"
        } (${writes}), but this cluster's AI access binding was cleared by an operator, so it was left unbound. Select the Runner on the cluster's AI page to use it.`;
      } else if (data.bindingState === "bound_to_other_runner") {
        feedInfoInMarkdown = `🤖 The in-cluster Runner **${runnerName}** ${
          data.agentRunnerExistedBefore
            ? "re-registered (its key was rotated)"
            : "registered"
        } (${writes}), but this cluster is bound to a different Runner in the dashboard, so it was not used.`;
      } else {
        feedInfoInMarkdown = `🔑 The in-cluster Runner **${runnerName}** re-registered and its key was rotated (${writes}). This happens when the Runner pod restarts.`;
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
