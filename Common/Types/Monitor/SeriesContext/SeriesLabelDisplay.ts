import { JSONObject, JSONValue } from "../../JSON";

/*
 * Turning a metric series' raw label map into something an on-call
 * engineer can read at 3am.
 *
 * A grouped metric monitor stores the breaching series' identity on the
 * alert/incident as `seriesLabels` - a map of ClickHouse attribute key
 * to value, e.g.
 *
 *   { "resource.k8s.namespace.name": "prod",
 *     "resource.k8s.pod.name": "checkout-7d9f-2xk",
 *     "resource.k8s.container.name": "app",
 *     "resource.k8s.node.name": "ip-10-0-3-14" }
 *
 * Those keys are correct but unreadable, and - more importantly - they
 * used to live ONLY in a table on the alert detail page. The alert
 * title, which is what shows up in the alert list, in Slack, in email
 * and on a phone at 3am, carried none of it, so fifty alerts from one
 * monitor rendered as fifty identical lines of text.
 *
 * This module is the shared, presentation-layer answer to that: given a
 * label map it produces a stable, deduplicated, human-ordered rendering
 * of the resource identity, in three shapes (inline summary, title
 * suffix, markdown block). It lives in Types (not Server) because the
 * dashboard renders the same identity next to alerts and must not
 * reimplement the naming.
 */

/*
 * Friendly names for the label keys OneUptime's own agents and the
 * shipped recommendation templates actually group by.
 *
 * Keys are matched twice: once verbatim, and once with the ClickHouse
 * `resource.` prefix stripped - OtelMetricsIngestService stamps that
 * prefix onto OTel *resource* attributes, so the very same concept
 * arrives as `resource.k8s.pod.name` from a resource attribute and as
 * `k8s.pod.name` from a datapoint label. Registering the unprefixed
 * spelling once covers both.
 */
const FriendlyLabelNames: Record<string, string> = {
  // --- Kubernetes ---
  "k8s.cluster.name": "Cluster",
  "k8s.namespace.name": "Namespace",
  "k8s.pod.name": "Pod",
  "k8s.pod.uid": "Pod UID",
  "k8s.container.name": "Container",
  "k8s.node.name": "Node",
  "k8s.deployment.name": "Deployment",
  "k8s.replicaset.name": "ReplicaSet",
  "k8s.statefulset.name": "StatefulSet",
  "k8s.daemonset.name": "DaemonSet",
  "k8s.job.name": "Job",
  "k8s.cronjob.name": "CronJob",
  "k8s.hpa.name": "HPA",
  "k8s.persistentvolumeclaim.name": "PVC",
  "k8s.volume.name": "Volume",

  // --- Containers (Docker / Podman / Swarm) ---
  "container.name": "Container",
  "container.id": "Container ID",
  "container.image.name": "Image",
  "container.runtime": "Runtime",
  "docker.swarm.service.name": "Swarm Service",
  "docker.swarm.node.name": "Swarm Node",
  "docker.swarm.cluster.name": "Swarm Cluster",
  "oneuptime.docker.host.name": "Docker Host",
  "oneuptime.podman.host.name": "Podman Host",

  // --- Hosts / OS ---
  "host.name": "Host",
  "oneuptime.host.name": "Host",
  "host.id": "Host ID",
  mountpoint: "Mount",
  device: "Device",
  "system.device": "Device",
  "disk.path": "Disk",
  "network.interface": "Interface",
  interfaceName: "Interface",
  interfaceAlias: "Interface Alias",
  diskPath: "Disk",
  cpu: "CPU",
  direction: "Direction",
  state: "State",
  process: "Process",

  /*
   * --- Proxmox ---
   *
   * pve-exporter encodes identity in a single `id` datapoint label
   * ("qemu/100", "node/pve1", "storage/local"), and the agent's transform
   * splits it into `pve.scope` / `pve.type` / `pve.id` (see
   * ProxmoxAgent/otel-collector-config.yaml). Both spellings are named
   * here because templates group by the raw `id` while a user's own
   * monitor may group by the derived parts.
   */
  "proxmox.cluster.name": "Proxmox Cluster",
  "proxmox.node.name": "Proxmox Node",
  "proxmox.vm.name": "VM",
  id: "Object",
  "pve.id": "Object ID",
  "pve.type": "Object Type",
  "pve.scope": "Scope",
  vmid: "VM ID",
  node: "Node",
  storage: "Storage",

  // --- Ceph ---
  "ceph.cluster.name": "Ceph Cluster",
  ceph_daemon: "Ceph Daemon",
  pool_id: "Pool",
  pool: "Pool",
  osd: "OSD",

  // --- IoT ---
  "iot.fleet.name": "Fleet",
  "device.id": "Device",
  "device.name": "Device",

  // --- Services / RUM / telemetry ---
  "service.name": "Service",
  "oneuptime.service.name": "Service",
  "service.namespace": "Service Namespace",
  "service.version": "Version",
  "deployment.environment": "Environment",
  "telemetry.sdk.language": "Language",
  "url.path": "Path",
  "http.route": "Route",
  "browser.name": "Browser",
  "os.name": "OS",
  region: "Region",
  "cloud.region": "Region",
  "cloud.availability_zone": "Zone",
};

/*
 * Ordering. An alert title has room for a couple of identifiers, and
 * which couple it gets decides whether the title is useful: "Pod:
 * checkout-7d9f-2xk" answers "what broke", "Namespace: prod" on its own
 * does not. Lower number = more identifying = shown first and kept when
 * the title is truncated.
 *
 * Container beats Pod deliberately for container-scoped metrics: a CPU
 * *limit* is a property of one container, so when both labels are
 * present the container is the thing that breached. Scope-setting
 * labels (namespace, cluster, node) rank after the object itself - they
 * qualify the answer rather than being it.
 */
const LabelPriority: Record<string, number> = {
  "k8s.container.name": 10,
  "container.name": 10,
  "k8s.pod.name": 20,
  "k8s.deployment.name": 25,
  "k8s.statefulset.name": 25,
  "k8s.daemonset.name": 25,
  "k8s.job.name": 25,
  "k8s.cronjob.name": 25,
  "k8s.hpa.name": 25,
  "k8s.persistentvolumeclaim.name": 25,
  "k8s.volume.name": 25,
  "docker.swarm.service.name": 25,
  ceph_daemon: 25,
  pool_id: 25,
  "device.id": 25,
  "device.name": 25,
  "proxmox.vm.name": 25,
  vmid: 25,
  id: 30,
  "pve.id": 32,
  "pve.type": 55,
  "pve.scope": 90,
  mountpoint: 30,
  diskPath: 30,
  "disk.path": 30,
  interfaceName: 30,
  device: 35,
  "system.device": 35,
  storage: 35,
  "service.name": 40,
  "oneuptime.service.name": 40,
  "k8s.namespace.name": 50,
  "service.namespace": 50,
  "k8s.node.name": 60,
  "proxmox.node.name": 60,
  "docker.swarm.node.name": 60,
  node: 60,
  "host.name": 65,
  "oneuptime.host.name": 65,
  "oneuptime.docker.host.name": 65,
  "oneuptime.podman.host.name": 65,
  "k8s.cluster.name": 80,
  "docker.swarm.cluster.name": 80,
  "proxmox.cluster.name": 80,
  "ceph.cluster.name": 80,
  "iot.fleet.name": 80,
  "k8s.pod.uid": 95,
  "container.id": 95,
};

const DefaultLabelPriority: number = 70;

/*
 * How many identifiers a title carries before it stops being scannable.
 * Three is enough for the two shapes that matter in practice -
 * container/pod/namespace and pod/namespace/node - and the full set is
 * always one click away in the description block and the alert's
 * Affected Resource table.
 */
export const MaxLabelsInTitle: number = 3;

/*
 * Longest label value the inline (title) rendering will print in full.
 *
 * Kubernetes object names go up to 253 characters, and a generated pod
 * name in a deeply-nested naming scheme really can get long. Three of
 * those would overflow the 500-character `title` column and fail the
 * alert INSERT outright - the alert would not exist at all, which is a
 * far worse outcome than a shortened name. The full value is always
 * present untruncated in the markdown block and in the alert's
 * seriesLabels.
 */
export const MaxLabelValueLengthInTitle: number = 64;

const Ellipsis: string = "...";

export interface DisplaySeriesLabel {
  // The raw ClickHouse attribute key, e.g. "resource.k8s.pod.name".
  key: string;
  // Human name, e.g. "Pod".
  name: string;
  // The label's value, already coerced to a display string.
  value: string;
}

export default class SeriesLabelDisplay {
  /*
   * Strip the ClickHouse `resource.` prefix so a resource attribute and
   * the same attribute arriving as a datapoint label resolve to one
   * entry in the tables above.
   */
  public static normalizeKey(key: string): string {
    if (key.startsWith("resource.")) {
      return key.slice("resource.".length);
    }

    return key;
  }

  /*
   * "Pod", "Container", "Node" - or, for a key nobody registered, a
   * best-effort prettified form of the key itself. An unknown key is
   * still far more useful spelled out than dropped: a user who groups
   * by `tenant_id` should see "Tenant Id: acme", not silence.
   */
  public static getFriendlyLabelName(key: string): string {
    const normalized: string = SeriesLabelDisplay.normalizeKey(key);

    const known: string | undefined =
      FriendlyLabelNames[normalized] || FriendlyLabelNames[key];

    if (known) {
      return known;
    }

    return SeriesLabelDisplay.prettifyKey(normalized);
  }

  private static prettifyKey(key: string): string {
    const words: Array<string> = key
      .split(/[._\-/]+/)
      .filter((part: string) => {
        return part.length > 0;
      })
      .map((part: string) => {
        return part.charAt(0).toUpperCase() + part.slice(1);
      });

    if (words.length === 0) {
      return key;
    }

    return words.join(" ");
  }

  /*
   * Whether this key has a deliberately-registered name, as opposed to
   * falling through to the prettified-key fallback.
   *
   * The fallback is right for a user's own attribute - nobody can
   * enumerate what `oneuptime.captureMetric()` might emit - but a key a
   * SHIPPED template groups by should always be registered, and there
   * is no way to tell the two apart from the returned string alone
   * (`device` prettifies to "Device", which is also its registered
   * name). The recommendation-catalog tests use this to hold that line.
   */
  public static isKnownLabelKey(key: string): boolean {
    const normalized: string = SeriesLabelDisplay.normalizeKey(key);

    return (
      FriendlyLabelNames[normalized] !== undefined ||
      FriendlyLabelNames[key] !== undefined
    );
  }

  public static getLabelPriority(key: string): number {
    const normalized: string = SeriesLabelDisplay.normalizeKey(key);

    const priority: number | undefined =
      LabelPriority[normalized] ?? LabelPriority[key];

    return priority === undefined ? DefaultLabelPriority : priority;
  }

  /*
   * Coerce one label value to the string a human should read.
   *
   * Multi-valued labels (a series grouped on an attribute that carries
   * an array) join with ", ". Objects are refused rather than
   * JSON-dumped into an alert title.
   */
  private static toDisplayValue(value: JSONValue | undefined): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (Array.isArray(value)) {
      return value
        .map((entry: JSONValue) => {
          return SeriesLabelDisplay.toDisplayValue(entry);
        })
        .filter((entry: string) => {
          return entry.length > 0;
        })
        .join(", ");
    }

    if (typeof value === "object") {
      return "";
    }

    return `${value}`.trim();
  }

  /*
   * The display-ready labels for one series, most identifying first.
   *
   * Empty values are dropped, not rendered blank. A grouped series
   * always carries every group-by key - `MetricSeriesFingerprint`
   * deliberately preserves a key whose attribute was missing as `""` so
   * the fingerprint stays stable across evaluations - so without this
   * filter a pod whose node attribute happened to be absent would title
   * itself "Pod: web-1 - Node: ".
   *
   * Values that are duplicates of an already-included value are dropped
   * too: several spellings of the same identity routinely ride along
   * (`k8s.pod.name` and `resource.k8s.pod.name`, `host.name` and
   * `oneuptime.host.name`), and repeating them buys nothing.
   */
  public static getDisplayLabels(
    seriesLabels: JSONObject | undefined,
  ): Array<DisplaySeriesLabel> {
    if (!seriesLabels) {
      return [];
    }

    const labels: Array<DisplaySeriesLabel> = [];
    const seenNameValuePairs: Set<string> = new Set<string>();

    const keys: Array<string> = Object.keys(seriesLabels);

    // Stable order: priority first, then key, so equal-priority keys never flip.
    keys.sort((a: string, b: string) => {
      const priorityDifference: number =
        SeriesLabelDisplay.getLabelPriority(a) -
        SeriesLabelDisplay.getLabelPriority(b);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return a.localeCompare(b);
    });

    for (const key of keys) {
      const value: string = SeriesLabelDisplay.toDisplayValue(
        seriesLabels[key],
      );

      if (!value) {
        continue;
      }

      const name: string = SeriesLabelDisplay.getFriendlyLabelName(key);

      const dedupeKey: string = `${name} ${value}`;

      if (seenNameValuePairs.has(dedupeKey)) {
        continue;
      }

      seenNameValuePairs.add(dedupeKey);

      labels.push({ key, name, value });
    }

    return labels;
  }

  /*
   * "Pod: checkout-7d9f-2xk / Namespace: prod / Node: ip-10-0-3-14".
   *
   * Returns "" when the series carries no usable identity, so callers
   * can concatenate unconditionally.
   */
  public static buildInlineSummary(
    seriesLabels: JSONObject | undefined,
    options?:
      | {
          maxLabels?: number | undefined;
          maxValueLength?: number | undefined;
        }
      | undefined,
  ): string {
    const maxLabels: number = options?.maxLabels ?? MaxLabelsInTitle;
    const maxValueLength: number =
      options?.maxValueLength ?? MaxLabelValueLengthInTitle;

    const labels: Array<DisplaySeriesLabel> =
      SeriesLabelDisplay.getDisplayLabels(seriesLabels);

    if (labels.length === 0) {
      return "";
    }

    return labels
      .slice(0, Math.max(maxLabels, 1))
      .map((label: DisplaySeriesLabel) => {
        return `${label.name}: ${SeriesLabelDisplay.truncateValue(
          label.value,
          maxValueLength,
        )}`;
      })
      .join(" | ");
  }

  private static truncateValue(value: string, maxLength: number): string {
    if (maxLength <= 0 || value.length <= maxLength) {
      return value;
    }

    /*
     * Keep the END of the value, not the start. Generated names put the
     * distinguishing part last (`checkout-7d9f-2xk`), so a head-truncated
     * `checkout-checkout-web-fro...` tells the reader nothing that the
     * rest of the alert did not already.
     */
    if (maxLength <= Ellipsis.length) {
      return value.slice(value.length - maxLength);
    }

    return `${Ellipsis}${value.slice(value.length - (maxLength - Ellipsis.length))}`;
  }

  /*
   * The same summary, prefixed with the separator used in titles, or ""
   * when there is nothing to say. Templates append this unconditionally:
   * `"[K8s] Pod CPU Saturating Container Limit{{seriesResourceSuffix}}"`.
   */
  public static buildTitleSuffix(
    seriesLabels: JSONObject | undefined,
    options?:
      | {
          maxLabels?: number | undefined;
          maxValueLength?: number | undefined;
        }
      | undefined,
  ): string {
    const summary: string = SeriesLabelDisplay.buildInlineSummary(
      seriesLabels,
      options,
    );

    if (!summary) {
      return "";
    }

    return ` - ${summary}`;
  }

  /*
   * A markdown block naming every identifier the series carries, for
   * alert/incident descriptions (which is what Slack, email and the
   * mobile push actually show).
   */
  public static buildMarkdownBlock(
    seriesLabels: JSONObject | undefined,
    options?: { heading?: string | undefined } | undefined,
  ): string {
    const labels: Array<DisplaySeriesLabel> =
      SeriesLabelDisplay.getDisplayLabels(seriesLabels);

    if (labels.length === 0) {
      return "";
    }

    const heading: string = options?.heading || "Affected resource";

    const lines: Array<string> = labels.map((label: DisplaySeriesLabel) => {
      return `- **${label.name}:** \`${label.value}\``;
    });

    return `**${heading}**\n${lines.join("\n")}`;
  }

  /*
   * Look up one logical identity across every spelling it can arrive
   * under. Callers pass unprefixed keys ("k8s.pod.name"); both the bare
   * and the `resource.`-prefixed spelling are checked.
   */
  public static findLabelValue(
    seriesLabels: JSONObject | undefined,
    keys: ReadonlyArray<string>,
  ): string {
    if (!seriesLabels) {
      return "";
    }

    for (const key of keys) {
      for (const candidate of [key, `resource.${key}`]) {
        const value: string = SeriesLabelDisplay.toDisplayValue(
          seriesLabels[candidate],
        );

        if (value) {
          return value;
        }
      }
    }

    return "";
  }
}
