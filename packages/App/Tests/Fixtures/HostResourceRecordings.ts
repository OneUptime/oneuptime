import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";

/*
 * REAL RECORDINGS OF WHAT NAMES A HOST WITHOUT BEING ONE (issues #11257,
 * #11258), cut down by Telemetry/Fixtures/HostResourceRecordings:
 *
 *   - docker-agent.json: agents/DockerAgent/otel-collector-config.yaml as
 *     shipped - docker_stats, filelog, every processor in its order,
 *     resourcedetection and the resource processor that stamps
 *     container.runtime and host.name - in otel/opentelemetry-collector-
 *     contrib:0.165.0 (the image the agent is built FROM) against a Docker
 *     29.9.3 daemon, with DOCKER_HOST_NAME=web-shop-01 and the otlphttp
 *     exporter swapped for the file exporter. A busybox container
 *     (Compose project "shop", service "web") wrote the log lines. Every
 *     resource carries container.runtime=docker, host.name=web-shop-01 and
 *     the os.type=linux resourcedetection adds: what made a Host of a
 *     Docker host whenever its Docker host did not resolve in the batch.
 *   - kubernetes-agent.json: HelmChart/Public/kubernetes-agent (chart
 *     0.7.3) installed with --set clusterName=shop-cluster in a kind
 *     v0.27.0 cluster (Kubernetes 1.32.2), oneuptime.url pointed at an OTLP
 *     sink collector writing the same file format: the DaemonSet's
 *     hostmetrics block (system.* metrics with k8s.node.name, no
 *     host.name) whose CPU and memory the Hosts tiles averaged in,
 *     kubeletstats node and pod blocks, the k8s_cluster receiver's
 *     deployment block, the cost engine's node prices (what the
 *     Kubernetes Cost dashboard reads), a pod's logs, and an eBPF span
 *     whose host.name is the pod's name.
 *   - direct-otlp-pods.json: two apps in pods of that cluster exporting
 *     OTLP straight to the sink, not through the agent, under
 *     @opentelemetry/auto-instrumentations-node 0.56.1 on Node.js 26:
 *     "shop-api" with the SDK's default resource detectors, whose Azure
 *     detector named the node's VM in host.name, and "shop-worker" with
 *     env, host, os and process only, whose host.name is its pod's name -
 *     before and after a rollout (shop-worker-6b6c997fd5-sb5l2, then
 *     shop-worker-6748887dc-2wr95). Neither carries a k8s.* attribute, nor
 *     a container.id (the SDK's container detector finds none under cgroup
 *     v2), and both set os.type=linux and telemetry.sdk.*.
 *
 *   - host-collector.json: what a host's own collector sends, the case that
 *     must stay a Host: OneUptime's default Linux host config
 *     (getHostCollectorDefaultConfig - hostmetrics, resourcedetection with
 *     the system, env and cloud detectors) in the same collector image, in
 *     a container named db-01, with the file exporter in place of
 *     otlp_http: the system.* block and one per-process process.* block,
 *     host.name, host.id and os.type set by resourcedetection, and no
 *     container, Kubernetes or SDK attribute.
 *
 * Every resource attribute is as recorded except the VM's Azure identity
 * (its subscription, resource group, VM name and VM id), replaced with
 * values of the same shape. Records are cut to the first few of each
 * block; nothing kept is changed. A metric a resource sent only in a later
 * batch (a utilization needs two scrapes) comes from the first later batch
 * of that very resource, into its block.
 */

export type RecordingName =
  | "docker-agent"
  | "kubernetes-agent"
  | "direct-otlp-pods"
  | "host-collector";

export type RecordedSignal =
  | "resourceMetrics"
  | "resourceLogs"
  | "resourceSpans";

export interface RecordedBlock {
  signal: RecordedSignal;
  // One OTLP ResourceMetrics / ResourceLogs / ResourceSpans, as sent.
  block: JSONObject;
}

const FIXTURE_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "Telemetry",
  "Fixtures",
  "HostResourceRecordings",
);

export function loadHostResourceRecording(
  name: RecordingName,
): Record<string, RecordedBlock> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIRECTORY, `${name}.json`), "utf8"),
  ) as Record<string, RecordedBlock>;
}

// A fresh copy of one recorded block, so a test may change what it is given.
export function getRecordedBlock(
  name: RecordingName,
  key: string,
): RecordedBlock {
  const recorded: RecordedBlock | undefined =
    loadHostResourceRecording(name)[key];

  if (!recorded) {
    throw new Error(`No block "${key}" in the ${name} recording.`);
  }

  return JSON.parse(JSON.stringify(recorded)) as RecordedBlock;
}

// A recorded block's resource attributes, flattened to a key-value map.
export function getRecordedResourceAttributes(
  recorded: RecordedBlock,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const attributes: Array<JSONObject> = ((
    recorded.block["resource"] as JSONObject
  )["attributes"] || []) as Array<JSONObject>;

  for (const attribute of attributes) {
    const value: JSONObject = (attribute["value"] || {}) as JSONObject;
    const first: unknown = Object.values(value)[0];
    out[attribute["key"] as string] = first;
  }

  return out;
}

/*
 * Moves every datapoint's, log record's and span's time to `at`, keeping
 * its value: ingest reads a batch's time, and a recording made once must
 * land inside the window a test reads.
 */
export function retimeRecordedBlock(
  recorded: RecordedBlock,
  at: Date,
): RecordedBlock {
  const nanos: string = `${at.getTime()}000000`;
  const copy: RecordedBlock = JSON.parse(JSON.stringify(recorded));

  const retime: (value: unknown) => void = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(retime);
      return;
    }

    if (value && typeof value === "object") {
      const object: Record<string, unknown> = value as Record<string, unknown>;

      for (const key of Object.keys(object)) {
        if (
          key === "timeUnixNano" ||
          key === "observedTimeUnixNano" ||
          key === "startTimeUnixNano" ||
          key === "endTimeUnixNano"
        ) {
          object[key] = nanos;
          continue;
        }

        retime(object[key]);
      }
    }
  };

  retime(copy.block);
  return copy;
}
