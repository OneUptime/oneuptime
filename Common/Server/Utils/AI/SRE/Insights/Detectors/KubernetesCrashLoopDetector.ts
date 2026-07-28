import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import { KubernetesCrashLoopEvidence } from "../../../../../../Types/AI/AIInsightEvidence";
import { JSONObject } from "../../../../../../Types/JSON";
import KubernetesContainer from "../../../../../../Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "../../../../../../Models/DatabaseModels/KubernetesResource";
import KubernetesContainerService from "../../../../../Services/KubernetesContainerService";
import KubernetesResourceService from "../../../../../Services/KubernetesResourceService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import logger from "../../../../Logger";
import KubernetesEvidenceReader, {
  KubernetesEventRow,
  KubernetesLogLine,
} from "../../../../Kubernetes/KubernetesEvidenceReader";
import classifyCrashLoop, {
  CrashLoopClassification,
  CrashLoopConfidence,
  CrashLoopEventInput,
  CrashLoopProbeInput,
} from "../../../Kubernetes/CrashLoopClassifier";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * ContainerCrashLoop — a Kubernetes container is stuck restarting.
 *
 * The odd one out in this registry, deliberately: its four siblings are
 * statistical sensors over TELEMETRY, and every one of them needs the failing
 * workload to have emitted something. A container that crash-loops on boot
 * emits no spans, often no exceptions, and its logs may never reach an
 * Error/Fatal severity — so the entire insight lane was blind to the single
 * most common Kubernetes failure. This one reads INFRASTRUCTURE state that
 * the customer's agent already writes to Postgres.
 *
 * Deterministic like the rest: the cause is named by the same pure
 * CrashLoopClassifier the kubernetes_diagnose_pod tool uses, and it runs
 * BEFORE any LLM sees the finding. One classifier, two callers.
 */

/*
 * Container states that mean "stuck", as the kubelet reports them in
 * status.containerStatuses[].state.waiting.reason. CrashLoopBackOff is the
 * headline case; the other three are containers that never started at all,
 * which present identically to a user and have the same urgency.
 */
const CRASH_LOOP_REASONS: Array<string> = [
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
];

/*
 * Restarts before a container counts as looping rather than merely having
 * had a bad moment. A single restart is normal operation (a node drain, a
 * rollout, an OOM the app recovered from); the kubelet only applies its
 * backoff after repeated failures.
 */
const MIN_RESTART_COUNT: number = 3;

// Containers examined per project per scan.
const SCAN_LIMIT: number = 30;

/*
 * Candidates emitted per scan. The scanner's own per-project cap is 10
 * across ALL detectors, so a cluster-wide outage here must not starve the
 * exception and latency detectors of their slots.
 */
const MAX_CANDIDATES: number = 5;

// Log lines from the previous generation stored on the insight.
const LOG_TAIL_LINES: number = 40;

const MAX_EVENTS_IN_EVIDENCE: number = 15;

interface CrashLoopGroup {
  fingerprint: string;
  representative: KubernetesContainer;
  affectedPodCount: number;
}

export default class KubernetesCrashLoopDetector implements InsightDetector {
  public insightType: AIInsightType = AIInsightType.ContainerCrashLoop;

  /**
   * Group containers by the thing an operator would actually fix.
   *
   * Fingerprinting on the CONTROLLER rather than the pod is what makes this
   * detector usable: crash-looping pods are replaced with a new random name
   * on every restart, so a pod-keyed fingerprint would mint a brand-new
   * insight — and, with escalation on, a brand-new page — every few minutes
   * for one broken Deployment. Keyed on the controller, a rollout refreshes
   * one insight instead.
   *
   * Exported for tests.
   */
  public static buildFingerprint(data: {
    clusterId: string;
    namespace: string;
    controllerOrPodName: string;
    containerName: string;
  }): string {
    return `k8s-crashloop:${data.clusterId}:${data.namespace}:${data.controllerOrPodName}:${data.containerName}`;
  }

  /**
   * Collapse containers that share a fingerprint into one candidate.
   *
   * Five crashlooping replicas of one Deployment produce five rows with an
   * identical fingerprint. Left ungrouped, the scanner would treat them as
   * one create plus four refreshes and bump occurrenceCount five times per
   * tick. Keeps the highest-restartCount row as the representative — the
   * most-broken pod is the most informative one to show.
   *
   * Exported for tests.
   */
  public static groupByFingerprint(
    containers: Array<KubernetesContainer>,
    fingerprintOf: (container: KubernetesContainer) => string,
  ): Array<CrashLoopGroup> {
    const groups: Map<string, CrashLoopGroup> = new Map();

    for (const container of containers) {
      const fingerprint: string = fingerprintOf(container);
      const existing: CrashLoopGroup | undefined = groups.get(fingerprint);

      if (!existing) {
        groups.set(fingerprint, {
          fingerprint: fingerprint,
          representative: container,
          affectedPodCount: 1,
        });
        continue;
      }

      existing.affectedPodCount++;

      if (
        (container.restartCount || 0) >
        (existing.representative.restartCount || 0)
      ) {
        existing.representative = container;
      }
    }

    return Array.from(groups.values());
  }

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const containers: Array<KubernetesContainer> =
      await KubernetesContainerService.findBy({
        query: {
          projectId: context.projectId,
          reason: QueryHelper.any(CRASH_LOOP_REASONS),
        } as never,
        select: {
          _id: true,
          podNamespaceKey: true,
          podName: true,
          name: true,
          image: true,
          state: true,
          reason: true,
          isReady: true,
          restartCount: true,
          memoryLimitBytes: true,
          latestMemoryBytes: true,
          lastTerminatedReason: true,
          lastTerminatedExitCode: true,
          lastTerminatedFinishedAt: true,
          waitingMessage: true,
          isInitContainer: true,
          lastSeenAt: true,
          kubernetesClusterId: true,
          kubernetesCluster: {
            name: true,
          },
        },
        sort: { restartCount: SortOrder.Descending },
        limit: SCAN_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    /*
     * A container that has not started at all reports no restarts, so the
     * restart floor applies only where the kubelet is actually looping.
     */
    const looping: Array<KubernetesContainer> = containers.filter(
      (container: KubernetesContainer) => {
        if (container.reason === "CrashLoopBackOff") {
          return (container.restartCount || 0) >= MIN_RESTART_COUNT;
        }
        return true;
      },
    );

    if (looping.length === 0) {
      return [];
    }

    /*
     * Resolve the parent pod for each candidate BEFORE grouping — the
     * controller name is what the fingerprint keys on, and it only exists on
     * the pod row.
     */
    const podByPodName: Map<string, KubernetesResource> = new Map();

    await Promise.all(
      Array.from(
        new Set(
          looping.map((container: KubernetesContainer) => {
            return `${container.podNamespaceKey || ""}/${container.podName || ""}`;
          }),
        ),
      ).map(async (key: string) => {
        const [namespace, podName] = key.split("/");

        if (!podName) {
          return;
        }

        try {
          const pod: KubernetesResource | null =
            await KubernetesResourceService.findOneBy({
              query: {
                projectId: context.projectId,
                kind: "Pod",
                namespaceKey: namespace || "",
                name: podName,
              } as never,
              select: {
                _id: true,
                name: true,
                namespaceKey: true,
                spec: true,
                controllerDeploymentName: true,
                controllerCronJobName: true,
              },
              props: { isRoot: true },
            });

          if (pod) {
            podByPodName.set(key, pod);
          }
        } catch (error) {
          logger.debug(
            `KubernetesCrashLoopDetector: pod lookup skipped for ${key}: ${error}`,
          );
        }
      }),
    );

    const podKeyOf: (container: KubernetesContainer) => string = (
      container: KubernetesContainer,
    ): string => {
      return `${container.podNamespaceKey || ""}/${container.podName || ""}`;
    };

    const groups: Array<CrashLoopGroup> =
      KubernetesCrashLoopDetector.groupByFingerprint(
        looping,
        (container: KubernetesContainer): string => {
          const pod: KubernetesResource | undefined = podByPodName.get(
            podKeyOf(container),
          );

          return KubernetesCrashLoopDetector.buildFingerprint({
            clusterId: container.kubernetesClusterId?.toString() || "-",
            namespace: container.podNamespaceKey || "-",
            /*
             * Fall back to the pod name only when no controller is known —
             * a bare pod really is its own unit of repair.
             */
            controllerOrPodName:
              pod?.controllerDeploymentName ||
              pod?.controllerCronJobName ||
              container.podName ||
              "-",
            containerName: container.name || "-",
          });
        },
      );

    const candidates: Array<InsightCandidate> = [];

    for (const group of groups.slice(0, MAX_CANDIDATES)) {
      try {
        const candidate: InsightCandidate | null = await this.buildCandidate({
          context: context,
          group: group,
          pod: podByPodName.get(podKeyOf(group.representative)),
        });

        if (candidate) {
          candidates.push(candidate);
        }
      } catch (error) {
        // One bad pod must not silence the rest of this detector's findings.
        logger.debug(
          `KubernetesCrashLoopDetector: candidate skipped for ${group.fingerprint}: ${error}`,
        );
      }
    }

    return candidates;
  }

  private async buildCandidate(data: {
    context: InsightScanContext;
    group: CrashLoopGroup;
    pod: KubernetesResource | undefined;
  }): Promise<InsightCandidate | null> {
    const container: KubernetesContainer = data.group.representative;
    const namespace: string = container.podNamespaceKey || "";
    const podName: string = container.podName || "";
    const containerName: string = container.name || "";
    const clusterName: string | undefined = container.kubernetesCluster?.name;

    if (!podName || !containerName) {
      return null;
    }

    const events: Array<KubernetesEventRow> =
      await KubernetesEvidenceReader.getEventsForPod({
        projectId: data.context.projectId,
        clusterName: clusterName,
        namespace: namespace,
        podName: podName,
      }).catch(() => {
        return [] as Array<KubernetesEventRow>;
      });

    const restartCount: number = container.restartCount || 0;

    const logTail: Array<KubernetesLogLine> =
      restartCount > 0
        ? await KubernetesEvidenceReader.getContainerLogTail({
            projectId: data.context.projectId,
            clusterName: clusterName,
            namespace: namespace,
            podName: podName,
            containerName: containerName,
            restartGeneration: restartCount - 1,
            limit: LOG_TAIL_LINES,
          }).catch(() => {
            return [] as Array<KubernetesLogLine>;
          })
        : [];

    const eventInputs: Array<CrashLoopEventInput> = events.map(
      (event: KubernetesEventRow) => {
        return { type: event.type, reason: event.reason, note: event.note };
      },
    );

    const classification: CrashLoopClassification = classifyCrashLoop({
      waitingReason: container.reason,
      waitingMessage: container.waitingMessage,
      lastTerminatedReason: container.lastTerminatedReason,
      lastTerminatedExitCode: container.lastTerminatedExitCode,
      restartCount: restartCount,
      memoryLimitBytes: container.memoryLimitBytes,
      memoryUsageBytes: container.latestMemoryBytes,
      livenessProbe: this.readLivenessProbe(data.pod, containerName),
      recentEvents: eventInputs,
    });

    const controllerName: string | undefined =
      data.pod?.controllerDeploymentName ||
      data.pod?.controllerCronJobName ||
      undefined;

    const evidence: KubernetesCrashLoopEvidence = {
      clusterName: clusterName,
      namespace: namespace,
      podName: podName,
      containerName: containerName,
      isInitContainer: Boolean(container.isInitContainer),
      controllerKind: data.pod?.controllerDeploymentName
        ? "Deployment"
        : data.pod?.controllerCronJobName
          ? "CronJob"
          : undefined,
      controllerName: controllerName,
      image: container.image,
      restartCount: restartCount,
      waitingReason: container.reason,
      waitingMessage: container.waitingMessage,
      lastTerminatedReason: container.lastTerminatedReason,
      lastTerminatedExitCode: container.lastTerminatedExitCode,
      lastTerminatedFinishedAt: container.lastTerminatedFinishedAt
        ? container.lastTerminatedFinishedAt.toISOString()
        : undefined,
      memoryLimitBytes: container.memoryLimitBytes,
      latestMemoryBytes: container.latestMemoryBytes,
      recentEvents: events
        .slice(0, MAX_EVENTS_IN_EVIDENCE)
        .map((event: KubernetesEventRow) => {
          return {
            time: event.time ? event.time.toISOString() : undefined,
            type: event.type,
            reason: event.reason,
            note: event.note,
          };
        }),
      previousLogTail: logTail.map((line: KubernetesLogLine) => {
        return line.body;
      }),
      affectedPodCount: data.group.affectedPodCount,
      classifiedCause: classification.cause,
      classifierConfidence: classification.confidence,
    };

    const subject: string = controllerName
      ? `${namespace}/${controllerName}`
      : `${namespace}/${podName}`;

    return {
      insightType: AIInsightType.ContainerCrashLoop,
      fingerprint: data.group.fingerprint,
      title: `${classification.cause}: container ${containerName} in ${subject} is restarting`,
      detailMarkdown: this.buildDetailMarkdown({
        classification: classification,
        evidence: evidence,
        logTail: logTail,
      }),
      /*
       * Severity gates paging: the escalation floor defaults to High, so only
       * a confidently-classified crash loop can ever open an alert. An
       * Unknown or low-confidence finding still files an insight for a human
       * to read, but never wakes anyone.
       */
      severity:
        classification.confidence === CrashLoopConfidence.High
          ? AIInsightSeverity.High
          : AIInsightSeverity.Medium,
      evidence: {
        kubernetes: evidence,
      },
    };
  }

  private readLivenessProbe(
    pod: KubernetesResource | undefined,
    containerName: string,
  ): CrashLoopProbeInput | null {
    const spec: JSONObject | undefined = pod?.spec || undefined;

    for (const key of ["initContainers", "containers"]) {
      const list: unknown = spec?.[key];

      if (!Array.isArray(list)) {
        continue;
      }

      for (const entry of list) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const containerSpec: JSONObject = entry as JSONObject;

        if (containerSpec["name"] !== containerName) {
          continue;
        }

        const probe: unknown = containerSpec["livenessProbe"];

        if (!probe || typeof probe !== "object") {
          return null;
        }

        const probeObject: JSONObject = probe as JSONObject;

        return {
          type: (probeObject["type"] as string) || "unknown",
          initialDelaySeconds:
            (probeObject["initialDelaySeconds"] as number) ?? null,
          periodSeconds: (probeObject["periodSeconds"] as number) ?? null,
          failureThreshold: (probeObject["failureThreshold"] as number) ?? null,
          httpPath: (probeObject["httpPath"] as string) || "",
          httpPort: (probeObject["httpPort"] as string) || "",
        };
      }
    }

    return null;
  }

  /*
   * The markdown a human reads first, and the text the triage prompt
   * embeds. The classified cause is the FIRST line with real numbers behind
   * it, written with no LLM in the loop.
   */
  private buildDetailMarkdown(data: {
    classification: CrashLoopClassification;
    evidence: KubernetesCrashLoopEvidence;
    logTail: Array<KubernetesLogLine>;
  }): string {
    const { classification, evidence } = data;
    const lines: Array<string> = [];

    lines.push(`**${classification.headline}**`);
    lines.push("");
    lines.push(
      `Cause classified as **${classification.cause}** (${classification.confidence} confidence) from Kubernetes state — no language model was involved in this determination.`,
    );
    lines.push("");

    lines.push(
      `- **Container**: \`${evidence.containerName}\`${
        evidence.isInitContainer ? " (init container)" : ""
      }`,
    );
    lines.push(`- **Pod**: \`${evidence.namespace}/${evidence.podName}\``);

    if (evidence.controllerName) {
      lines.push(
        `- **Controller**: ${evidence.controllerKind || "Controller"} \`${evidence.controllerName}\``,
      );
    }

    if (evidence.clusterName) {
      lines.push(`- **Cluster**: ${evidence.clusterName}`);
    }

    lines.push(`- **Restarts**: ${evidence.restartCount}`);

    if (evidence.affectedPodCount > 1) {
      lines.push(
        `- **Affected pods**: ${evidence.affectedPodCount} pods share this failure`,
      );
    }

    if (evidence.image) {
      lines.push(`- **Image**: \`${evidence.image}\``);
    }

    lines.push("");
    lines.push("**Evidence**");

    for (const item of classification.evidence) {
      lines.push(`- ${item}`);
    }

    if (evidence.waitingMessage) {
      lines.push("");
      lines.push(`**Kubelet message**: ${evidence.waitingMessage}`);
    }

    if (evidence.recentEvents.length > 0) {
      lines.push("");
      lines.push("**Recent Kubernetes Events**");
      lines.push("");
      lines.push("```");
      for (const event of evidence.recentEvents.slice(0, 8)) {
        lines.push(`${event.type} | ${event.reason} | ${event.note}`);
      }
      lines.push("```");
    }

    if (evidence.previousLogTail.length > 0) {
      lines.push("");
      lines.push("**Log tail from the previous container generation**");
      lines.push("");
      lines.push("```");
      for (const line of evidence.previousLogTail.slice(-20)) {
        lines.push(line);
      }
      lines.push("```");
    }

    return lines.join("\n");
  }
}
