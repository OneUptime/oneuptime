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
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import {
  RunnerLiveStatus,
  getRunnerLiveStatus,
} from "../../Types/Runner/RunnerLiveStatus";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KubernetesRunnerPosture,
  getKubernetesAgentRunnerName,
  parseKubernetesRunnerPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import QueryHelper from "../Types/Database/QueryHelper";
import AlertService from "./AlertService";
import IncidentService from "./IncidentService";
import KubernetesClusterService from "./KubernetesClusterService";
import LlmProviderService from "./LlmProviderService";
import MonitorService from "./MonitorService";
import ProjectService from "./ProjectService";
import RunbookCredentialService from "./RunbookCredentialService";
import RunnerService from "./RunnerService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

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
   * chose in the dashboard. The agent Runner row still exists and heartbeats,
   * but the dashboard is the control plane: it never silently rebinds.
   */
  isBoundToCluster: boolean;
  isFirstBind: boolean;
}

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

        if (posture?.inCluster) {
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
   */
  @CaptureSpan()
  public async registerKubernetesAgentRunner(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
    agentVersion?: string | undefined;
    posture: KubernetesRunnerPosture;
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

    // The Runner row currently bound, if it is one of ours.
    let boundRunner: Runner | null = null;

    if (cluster.aiAccessRunnerId) {
      boundRunner = await RunnerService.findOneBy({
        query: {
          _id: cluster.aiAccessRunnerId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true, name: true, hostInfo: true },
        props: { isRoot: true },
      });
    }

    const boundIsAgentRunner: boolean = Boolean(
      boundRunner &&
        parseKubernetesRunnerPosture(boundRunner.hostInfo)?.inCluster,
    );

    let runner: Runner | null = boundIsAgentRunner ? boundRunner : null;

    if (!runner) {
      // The agent Runner row for this cluster, bound or not.
      runner = await RunnerService.findOneBy({
        query: {
          projectId: data.projectId,
          name: getKubernetesAgentRunnerName(clusterIdentifier),
        },
        select: { _id: true, name: true, hostInfo: true },
        props: { isRoot: true },
      });
    }

    const runnerKey: string = ObjectID.generate().toString();

    if (runner) {
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
     * Binding. A cluster nobody has configured takes the chart's intent:
     * investigation on, remediation "ask for approval" when the chart also
     * granted write RBAC. A cluster an operator already bound to a different
     * Runner is left alone — the dashboard is the control plane.
     */
    const isFirstBind: boolean = !cluster.aiAccessRunnerId;
    let isBoundToCluster: boolean = boundIsAgentRunner;

    if (isFirstBind) {
      await KubernetesClusterService.updateOneById({
        id: cluster.id!,
        data: {
          aiAccessRunnerId: runner.id!,
          aiAccessCredentialId: null,
          isAiInvestigationEnabled: true,
          aiRemediationMode:
            posture.allowWrites === true
              ? KubernetesAiRemediationMode.RequireApproval
              : KubernetesAiRemediationMode.Disabled,
        } as never,
        props: { isRoot: true },
      });
      isBoundToCluster = true;
    } else if (!boundIsAgentRunner && !boundRunner) {
      // Bound to a Runner that no longer exists: the agent Runner takes over.
      await KubernetesClusterService.updateOneById({
        id: cluster.id!,
        data: {
          aiAccessRunnerId: runner.id!,
          aiAccessCredentialId: null,
        } as never,
        props: { isRoot: true },
      });
      isBoundToCluster = true;
    }

    return {
      runnerId: runner.id!,
      runnerKey,
      clusterId: cluster.id!,
      isBoundToCluster,
      isFirstBind,
    };
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
