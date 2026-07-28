import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import {
  extractObjectFromLogBody,
  getKvStringValue,
  getKvValue,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import LogAggregationService from "../../Services/LogAggregationService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Server-side readers for the two Kubernetes evidence sources OneUptime
 * already ingests but has never read outside the dashboard.
 *
 * Both answer questions a crash loop makes urgent and telemetry alone cannot:
 * the Kubernetes Events stream carries the kubelet's own explanation
 * ("Failed to pull image", "couldn't find key DATABASE_URL in ConfigMap
 * app-config", "Liveness probe failed"), and the previous restart
 * generation's log tail carries whatever the container printed on its way
 * down. The second is `kubectl logs --previous` served from stored data,
 * which is why the diagnosis path needs no cluster credentials.
 *
 * WIRE-FORMAT NOTE, load-bearing: the agent configures the k8sobjects events
 * receiver with `group: events.k8s.io` (HelmChart/Public/kubernetes-agent/
 * templates/configmap-deployment.yaml), so the objects are events.k8s.io/v1
 * and the fields are `regarding` and `note`. Code written against core/v1's
 * `involvedObject` and `message` matches nothing, silently, forever.
 *
 * PERFORMANCE NOTE: getExportLogs' attribute filter compiles to a bare
 * arrayExists over mapKeys/mapValues (LogAggregationService.appendCommonFilters)
 * with no hasAny prefilter, so every window here is deliberately short and
 * every call passes bodySearchText when a discriminating token exists.
 */

/*
 * Kubernetes drops Events from the apiserver after roughly an hour, so a
 * longer window buys retention that is not there and costs a wider scan.
 */
const DEFAULT_EVENT_LOOKBACK_MINUTES: number = 60;

const DEFAULT_EVENT_LIMIT: number = 200;

/*
 * Log lines returned per request. A crash loop's fatal error is usually the
 * last handful of lines; this leaves room for a stack trace without flooding
 * the model's context.
 */
const DEFAULT_LOG_TAIL_LINES: number = 200;

const DEFAULT_LOG_LOOKBACK_MINUTES: number = 60;

export interface KubernetesEventRow {
  time: Date | null;
  // Normal | Warning
  type: string;
  // e.g. BackOff, Failed, Unhealthy, Killing
  reason: string;
  // The human-readable text; events.k8s.io calls this `note`.
  note: string;
  regardingKind: string;
  regardingName: string;
  regardingNamespace: string;
}

export interface KubernetesLogLine {
  time: Date | null;
  severityText: string;
  body: string;
}

export default class KubernetesEvidenceReader {
  /**
   * Kubernetes Events concerning one pod, newest first.
   *
   * The pod name is pushed into ClickHouse as a body substring match so the
   * scan is narrowed server-side, then every row is re-checked against the
   * parsed `regarding` object — the substring match alone would also catch an
   * event that merely mentions the pod in its note.
   */
  @CaptureSpan()
  public static async getEventsForPod(data: {
    projectId: ObjectID;
    clusterName?: string | undefined;
    namespace: string;
    podName: string;
    lookbackMinutes?: number | undefined;
    limit?: number | undefined;
  }): Promise<Array<KubernetesEventRow>> {
    if (!data.podName) {
      return [];
    }

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveMinutes(
      endTime,
      -1 * (data.lookbackMinutes || DEFAULT_EVENT_LOOKBACK_MINUTES),
    );

    const attributes: Record<string, string> = {
      "event.domain": "k8s",
      "k8s.resource.name": "events",
    };

    if (data.clusterName) {
      attributes["resource.k8s.cluster.name"] = data.clusterName;
    }

    const rows: Array<JSONObject> = await LogAggregationService.getExportLogs({
      projectId: data.projectId,
      startTime: startTime,
      endTime: endTime,
      limit: data.limit || DEFAULT_EVENT_LIMIT,
      attributes: attributes,
      bodySearchText: data.podName,
    });

    const events: Array<KubernetesEventRow> = [];

    for (const row of rows) {
      const body: unknown = row["body"];

      if (typeof body !== "string") {
        continue;
      }

      const eventObject: JSONObject | null = extractObjectFromLogBody(body);

      if (!eventObject) {
        continue;
      }

      const regarding: JSONObject | undefined = getKvValue(
        eventObject,
        "regarding",
      ) as JSONObject | undefined;

      const regardingName: string = getKvStringValue(regarding, "name");

      /*
       * The pod a crashlooping container belongs to is replaced on every
       * restart, so match on the exact name the caller asked about rather
       * than a prefix — a stale name should return nothing, not another
       * pod's events.
       */
      if (regardingName !== data.podName) {
        continue;
      }

      const regardingNamespace: string = getKvStringValue(
        regarding,
        "namespace",
      );

      if (
        data.namespace &&
        regardingNamespace &&
        regardingNamespace !== data.namespace
      ) {
        continue;
      }

      events.push({
        time: KubernetesEvidenceReader.parseRowTime(row["time"]),
        type: getKvStringValue(eventObject, "type"),
        reason: getKvStringValue(eventObject, "reason"),
        note: getKvStringValue(eventObject, "note"),
        regardingKind: getKvStringValue(regarding, "kind"),
        regardingName: regardingName,
        regardingNamespace: regardingNamespace,
      });
    }

    return events;
  }

  /**
   * The tail of one container's stdout/stderr, oldest line first.
   *
   * Pass `restartGeneration` to read a PREVIOUS incarnation: the agent's
   * filelog receiver parses the generation out of the log file path into a
   * `restart_count` record attribute, so asking for restartCount - 1 is the
   * stored-data equivalent of `kubectl logs --previous`.
   *
   * Returns oldest-first because the fatal line is the last thing a crashing
   * container prints, and a reader (human or model) should arrive at it last.
   */
  @CaptureSpan()
  public static async getContainerLogTail(data: {
    projectId: ObjectID;
    clusterName?: string | undefined;
    namespace: string;
    podName: string;
    containerName?: string | undefined;
    restartGeneration?: number | undefined;
    lookbackMinutes?: number | undefined;
    limit?: number | undefined;
  }): Promise<Array<KubernetesLogLine>> {
    if (!data.podName) {
      return [];
    }

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveMinutes(
      endTime,
      -1 * (data.lookbackMinutes || DEFAULT_LOG_LOOKBACK_MINUTES),
    );

    const attributes: Record<string, string> = {
      "resource.k8s.pod.name": data.podName,
      "resource.k8s.namespace.name": data.namespace,
    };

    if (data.containerName) {
      attributes["resource.k8s.container.name"] = data.containerName;
    }

    if (data.clusterName) {
      attributes["resource.k8s.cluster.name"] = data.clusterName;
    }

    /*
     * Only pin the generation when the caller asked for a specific one.
     * Generation 0 is legitimate (the first incarnation), so the check is
     * against undefined rather than falsiness.
     */
    if (data.restartGeneration !== undefined && data.restartGeneration >= 0) {
      attributes["restart_count"] = String(data.restartGeneration);
    }

    const rows: Array<JSONObject> = await LogAggregationService.getExportLogs({
      projectId: data.projectId,
      startTime: startTime,
      endTime: endTime,
      limit: data.limit || DEFAULT_LOG_TAIL_LINES,
      attributes: attributes,
    });

    const lines: Array<KubernetesLogLine> = [];

    for (const row of rows) {
      const body: unknown = row["body"];

      if (typeof body !== "string" || !body) {
        continue;
      }

      lines.push({
        time: KubernetesEvidenceReader.parseRowTime(row["time"]),
        severityText: (row["severityText"] as string) || "",
        body: body,
      });
    }

    // getExportLogs orders time DESC; the caller wants to read downwards.
    return lines.reverse();
  }

  private static parseRowTime(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === "string" || typeof value === "number") {
      const parsed: Date = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  }
}
