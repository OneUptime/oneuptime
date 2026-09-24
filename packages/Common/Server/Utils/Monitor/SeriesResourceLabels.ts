import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DatabaseEndpoint,
  canonicalizeDatabaseEndpoint,
  formatDatabaseEndpoint,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_SYSTEMS,
  normalizeDatabaseSystem,
} from "../../../Types/DatabaseServer/DatabaseSystem";

/*
 * A grouped metric monitor (e.g. group-by `resource.host.name`) emits
 * one series per group, and each series carries the group's identity in
 * its labels. Resource identity shows up under several key spellings:
 *
 *   - the raw OTel resource attribute            (`host.name`)
 *   - the ClickHouse `resource.`-prefixed form   (`resource.host.name`)
 *   - the OneUptime stamps added at ingest        (`oneuptime.host.id`
 *     / `oneuptime.host.name` and their `resource.`-prefixed twins)
 *
 * This module is the single source of truth for "which label keys
 * identify which resource type", so that everything keying off series
 * identity — incident/alert resource linking AND scheduled-maintenance
 * suppression — stays in agreement. If the two ever diverged, a series
 * could be linked to a host it is not suppressed for (or vice versa).
 *
 * Multi-value labels are flattened, so a series that groups by a
 * multi-valued attribute references every value it carries.
 */

export const HostIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.host.id",
  "oneuptime.host.id",
];

export const HostNameLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.host.name",
  "oneuptime.host.name",
  "resource.host.name",
  "host.name",
];

/*
 * For Docker hosts we deliberately ignore raw `host.name` /
 * `oneuptime.host.name`: those are the Host's territory. The ingest
 * pipeline stamps `oneuptime.docker.host.*` independently when the
 * source is a docker host, so only those keys identify a DockerHost.
 */
export const DockerHostIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.docker.host.id",
  "oneuptime.docker.host.id",
];

export const DockerHostNameLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.docker.host.name",
  "oneuptime.docker.host.name",
];

/*
 * For Podman hosts we deliberately ignore raw `host.name` /
 * `oneuptime.host.name`: those are the Host's territory. The ingest
 * pipeline stamps `oneuptime.podman.host.*` independently when the
 * source is a podman host, so only those keys identify a PodmanHost.
 */
export const PodmanHostIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.podman.host.id",
  "oneuptime.podman.host.id",
];

export const PodmanHostNameLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.podman.host.name",
  "oneuptime.podman.host.name",
];

/*
 * Docker Swarm cluster identity rides the agent-stamped resource
 * attribute (`docker.swarm.cluster.name`) and its ClickHouse
 * `resource.`-prefixed twin. The Swarm agent's collector config stamps
 * it on every signal as the documented join key, and ingest keys cluster
 * rows by that name only — there is no `oneuptime.*.id` stamp — so only
 * name keys exist. The name maps to the cluster model's `name` column.
 * Like Proxmox/Ceph, the shipped Swarm alert templates group by
 * datapoint labels (`container.name`), so their series labels do NOT
 * carry this key; the deterministic cluster link for those monitors
 * comes from the monitor step config instead (see MonitorResourceContext).
 * These keys cover user-built monitors that group by the cluster
 * attribute.
 */
export const DockerSwarmClusterNameLabelKeys: ReadonlyArray<string> = [
  "resource.docker.swarm.cluster.name",
  "docker.swarm.cluster.name",
];

export const KubernetesClusterIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.kubernetes.cluster.id",
  "oneuptime.kubernetes.cluster.id",
];

export const KubernetesClusterNameLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.kubernetes.cluster.name",
  "oneuptime.kubernetes.cluster.name",
  "resource.k8s.cluster.name",
  "k8s.cluster.name",
];

/*
 * Proxmox/Ceph cluster identity rides the agent-stamped resource
 * attribute (`proxmox.cluster.name` / `ceph.cluster.name`) and its
 * ClickHouse `resource.`-prefixed twin. Ingest keys cluster rows by
 * name only — there is no `oneuptime.*.id` stamp for these clusters —
 * so only name keys exist. The name maps to the cluster model's `name`
 * column. Note the shipped Proxmox/Ceph alert templates group by
 * datapoint labels (`id`, `ceph_daemon`, `pool_id`), so their series
 * labels do NOT carry these keys; the deterministic cluster link for
 * those monitors comes from the monitor step config instead (see
 * MonitorResourceContext). These keys cover user-built monitors that
 * group by the cluster attribute, exactly like the K8s keys above.
 */
export const ProxmoxClusterNameLabelKeys: ReadonlyArray<string> = [
  "resource.proxmox.cluster.name",
  "proxmox.cluster.name",
];

export const CephClusterNameLabelKeys: ReadonlyArray<string> = [
  "resource.ceph.cluster.name",
  "ceph.cluster.name",
];

/*
 * vCenter identity rides the agent-stamped resource attribute
 * (`vmware.vcenter.name` — one value per vCenter Server or standalone
 * ESXi host the VMware Agent connects to) and its ClickHouse
 * `resource.`-prefixed twin. Ingest keys vCenter rows by name only —
 * there is no `oneuptime.*.id` stamp for vCenters — so only name keys
 * exist. The name maps to the VMwareVCenter model's `name` column. The
 * shipped VMware alert templates group by the vSphere object's own
 * resource attribute (`resource.vcenter.host.name`,
 * `resource.vcenter.vm.name`, `resource.vcenter.datastore.name`, ...),
 * so their series labels do NOT carry these keys; the deterministic
 * vCenter link for those monitors comes from the monitor step config
 * instead (see MonitorResourceContext). These keys cover user-built
 * monitors that group by the vCenter attribute.
 */
export const VMwareVCenterNameLabelKeys: ReadonlyArray<string> = [
  "resource.vmware.vcenter.name",
  "vmware.vcenter.name",
];

/*
 * IoT fleet identity rides the agent-stamped resource attribute
 * (`iot.fleet.name`) and its ClickHouse `resource.`-prefixed twin.
 * Ingest keys fleet rows by name only — there is no `oneuptime.*.id`
 * stamp for fleets — so only name keys exist. The name maps to the
 * IoTFleet model's `name` column. Like Proxmox/Ceph, the shipped IoT
 * alert templates group by the datapoint label `device.id`, so their
 * series labels do NOT carry these keys; the deterministic fleet link
 * for those monitors comes from the monitor step config instead (see
 * MonitorResourceContext). These keys cover user-built monitors that
 * group by the fleet attribute.
 */
export const IoTFleetNameLabelKeys: ReadonlyArray<string> = [
  "resource.iot.fleet.name",
  "iot.fleet.name",
];

/*
 * Database identity rides the `oneuptime.database.server.id` stamp ingest
 * adds to a database's own telemetry (collector / Database Agent receiver
 * batches — see Telemetry.getAttributesForDatabaseServerIdAndName) and its
 * ClickHouse `resource.`-prefixed twin, which the Database Agent also sets
 * as an input resource attribute. Id keys only, on purpose: the
 * `oneuptime.database.server.name` stamp is a display name ("PostgreSQL
 * db.prod:5432"), which is neither unique per project (it drops the
 * endpoint's `@cluster` qualifier, and the same namespace/workload can run
 * in two clusters) nor stable (users rename databases). Resolving it would
 * link an incident to — and let maintenance on one database silence — every
 * same-named database. A monitor that should link its events to a database
 * groups (or filters) by `oneuptime.database.server.id`.
 *
 * Unlike the host id stamp, the `resource.`-prefixed value can be typed by a
 * user (the agent's DATABASE_SERVER_ID), so extractResourceRefs keeps only
 * UUID-shaped values: a malformed one would make the primary-key lookup
 * throw out of alert / incident creation.
 */
export const DatabaseServerIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.database.server.id",
  "oneuptime.database.server.id",
];

/*
 * The attributes that name a database by the ENDPOINT it listens on: the
 * semconv `server.address` / `server.port` a DB client span, a `db.client.*`
 * datapoint and a Database Agent batch all carry, plus the engine
 * (`db.system.name`, legacy `db.system`) that supplies the default port
 * semconv leaves out, and the Kubernetes namespace / cluster that
 * canonicalization needs for cluster-local names.
 *
 * Read ONLY from a monitor's own configuration — an attribute FILTER on a
 * metric or trace query (see MonitorStepResourceIdentity) — and resolved
 * through the project's DatabaseServerEndpoint rows. Never from series
 * labels, on purpose:
 *
 *   - `server.address` is the generic OTel peer attribute, set on every HTTP
 *     client span too. A filter the user wrote is a deliberate statement of
 *     which server a monitor watches; a group-by value is whatever peer a
 *     series happened to call.
 *   - Series identity also drives maintenance suppression
 *     (MonitorMaintenanceSuppression), which matches databases by id only.
 *     Linking a series by endpoint without suppressing it by endpoint is the
 *     linked-but-not-silenced divergence the header of this file exists to
 *     prevent.
 *
 * For the same first reason these keys are NOT resource-identity keys and are
 * absent from AllResourceIdentityLabelKeys: a monitor script may legitimately
 * record which server it measured.
 */
export const DatabaseServerAddressLabelKeys: ReadonlyArray<string> = [
  "resource.server.address",
  "server.address",
];

export const DatabaseServerPortLabelKeys: ReadonlyArray<string> = [
  "resource.server.port",
  "server.port",
];

export const DatabaseSystemLabelKeys: ReadonlyArray<string> = [
  "resource.db.system.name",
  "db.system.name",
  "resource.db.system",
  "db.system",
];

export const DatabaseKubernetesNamespaceLabelKeys: ReadonlyArray<string> = [
  "resource.k8s.namespace.name",
  "k8s.namespace.name",
];

export const DatabaseKubernetesClusterLabelKeys: ReadonlyArray<string> = [
  "resource.k8s.cluster.name",
  "k8s.cluster.name",
];

/*
 * Services come from OTel-ingested telemetry. The ingest pipeline
 * auto-creates a Service row keyed by `service.name`, so any series
 * label carrying that attribute (raw or prefixed) tells us the emitting
 * service. The `oneuptime.service.id` stamp is also accepted for callers
 * that resolved the ID upstream.
 */
export const ServiceIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.service.id",
  "oneuptime.service.id",
];

export const ServiceNameLabelKeys: ReadonlyArray<string> = [
  /*
   * Ingest stamps `oneuptime.service.name` alongside `oneuptime.service.id`
   * on every row (Telemetry.getAttributesForServiceIdAndServiceName). It
   * carries the same Service row's name as the raw `service.name` resource
   * attribute, so the group-by dropdown can surface either spelling.
   */
  "resource.oneuptime.service.name",
  "oneuptime.service.name",
  "resource.service.name",
  "service.name",
];

/*
 * Every label key above, in one list: the complete set of attribute
 * names that make a series claim to belong to a specific Host / cluster
 * / Service.
 *
 * `extractResourceRefs` below is the READ side of these keys. Writers
 * that accept attribute names from a user — the custom code and
 * synthetic monitors, whose scripts choose their own
 * `oneuptime.captureMetric()` attribute keys — need the same list to
 * decide what a script must NOT be allowed to stamp, because a series
 * label saying `service.name = payments-api` is taken at face value
 * downstream: alerts and incidents get linked to that Service, its
 * owners are paged through owner inheritance, and a maintenance window
 * on it silences the series. Deriving the write-side guard from this
 * array is what stops the two sides from drifting apart the way the
 * alert and incident linkers once did.
 */
export const AllResourceIdentityLabelKeys: ReadonlyArray<string> = [
  ...HostIdLabelKeys,
  ...HostNameLabelKeys,
  ...DockerHostIdLabelKeys,
  ...DockerHostNameLabelKeys,
  ...PodmanHostIdLabelKeys,
  ...PodmanHostNameLabelKeys,
  ...DockerSwarmClusterNameLabelKeys,
  ...KubernetesClusterIdLabelKeys,
  ...KubernetesClusterNameLabelKeys,
  ...ProxmoxClusterNameLabelKeys,
  ...VMwareVCenterNameLabelKeys,
  ...CephClusterNameLabelKeys,
  ...IoTFleetNameLabelKeys,
  ...DatabaseServerIdLabelKeys,
  ...ServiceIdLabelKeys,
  ...ServiceNameLabelKeys,
];

/*
 * The identifiers carried by one series, split by resource type and by
 * id-vs-name. Ids are OneUptime database ids (the `oneuptime.*.id`
 * stamps); names are the human/telemetry identifiers (host.name,
 * k8s.cluster.name, service.name) that map to a resource's identifier
 * column (`hostIdentifier`, `clusterIdentifier`, `name`).
 */
export interface SeriesResourceRefs {
  hostIds: Array<string>;
  hostNames: Array<string>;
  dockerHostIds: Array<string>;
  dockerHostNames: Array<string>;
  podmanHostIds: Array<string>;
  podmanHostNames: Array<string>;
  kubernetesClusterIds: Array<string>;
  kubernetesClusterNames: Array<string>;
  dockerSwarmClusterNames: Array<string>;
  proxmoxClusterNames: Array<string>;
  vmwareVCenterNames: Array<string>;
  cephClusterNames: Array<string>;
  iotFleetNames: Array<string>;
  serviceIds: Array<string>;
  serviceNames: Array<string>;
  // Id-only: see DatabaseServerIdLabelKeys for why there is no name list.
  databaseServerIds: Array<string>;
  /*
   * Canonical endpoints ("db.prod:5432", formatDatabaseEndpoint) a monitor's
   * configuration names — a probe Database Health / SQL Query target, or a
   * `server.address` filter. Resolved to databaseServerIds through the
   * project's DatabaseServerEndpoint rows. Always empty from series labels:
   * see DatabaseServerAddressLabelKeys.
   */
  databaseServerEndpoints: Array<string>;
}

export default class SeriesResourceLabels {
  /*
   * Collect every non-empty string value held at any of `keys` in the
   * series labels, flattening multi-valued (array) labels. Returns a
   * deduped list.
   */
  public static collectLabelValues(
    seriesLabels: JSONObject,
    keys: ReadonlyArray<string>,
  ): Array<string> {
    const found: Set<string> = new Set<string>();

    for (const key of keys) {
      const value: unknown = seriesLabels[key];

      if (typeof value === "string" && value.length > 0) {
        found.add(value);
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.length > 0) {
            found.add(item);
          }
        }
      }
    }

    return Array.from(found);
  }

  public static extractResourceRefs(
    seriesLabels: JSONObject,
  ): SeriesResourceRefs {
    return {
      hostIds: this.collectLabelValues(seriesLabels, HostIdLabelKeys),
      hostNames: this.collectLabelValues(seriesLabels, HostNameLabelKeys),
      dockerHostIds: this.collectLabelValues(
        seriesLabels,
        DockerHostIdLabelKeys,
      ),
      dockerHostNames: this.collectLabelValues(
        seriesLabels,
        DockerHostNameLabelKeys,
      ),
      podmanHostIds: this.collectLabelValues(
        seriesLabels,
        PodmanHostIdLabelKeys,
      ),
      podmanHostNames: this.collectLabelValues(
        seriesLabels,
        PodmanHostNameLabelKeys,
      ),
      kubernetesClusterIds: this.collectLabelValues(
        seriesLabels,
        KubernetesClusterIdLabelKeys,
      ),
      kubernetesClusterNames: this.collectLabelValues(
        seriesLabels,
        KubernetesClusterNameLabelKeys,
      ),
      dockerSwarmClusterNames: this.collectLabelValues(
        seriesLabels,
        DockerSwarmClusterNameLabelKeys,
      ),
      proxmoxClusterNames: this.collectLabelValues(
        seriesLabels,
        ProxmoxClusterNameLabelKeys,
      ),
      vmwareVCenterNames: this.collectLabelValues(
        seriesLabels,
        VMwareVCenterNameLabelKeys,
      ),
      cephClusterNames: this.collectLabelValues(
        seriesLabels,
        CephClusterNameLabelKeys,
      ),
      iotFleetNames: this.collectLabelValues(
        seriesLabels,
        IoTFleetNameLabelKeys,
      ),
      serviceIds: this.collectLabelValues(seriesLabels, ServiceIdLabelKeys),
      serviceNames: this.collectLabelValues(seriesLabels, ServiceNameLabelKeys),
      databaseServerIds: this.extractDatabaseServerIds(seriesLabels),
      // Never from series labels — see DatabaseServerAddressLabelKeys.
      databaseServerEndpoints: [],
    };
  }

  /*
   * The `oneuptime.database.server.id` values an attribute map carries, UUID
   * shaped only (see DatabaseServerIdLabelKeys for why).
   */
  public static extractDatabaseServerIds(
    attributes: JSONObject,
  ): Array<string> {
    return this.collectLabelValues(
      attributes,
      DatabaseServerIdLabelKeys,
    ).filter((value: string): boolean => {
      return ObjectID.isValidUUID(value);
    });
  }

  /*
   * The canonical database endpoint a (host, port, engine) triple names, as
   * it is stored on DatabaseServerEndpoint rows — or null when it names no
   * identifiable server.
   *
   * Canonicalized exactly as ingest canonicalizes what a client call saw
   * (`canonicalizeDatabaseEndpoint`, purpose "client-call"), so the lookup is
   * an exact string match: one host spelling, the engine's default port when
   * none is given, Kubernetes service names expanded with the namespace, and
   * cluster-local names qualified with the cluster when one is known.
   * Loopback and host-relative names are null — "localhost:5432" is a
   * different server for every caller, so it can never identify one row.
   */
  public static buildDatabaseEndpointRef(input: {
    address: unknown;
    port?: unknown;
    system?: string | null | undefined;
    kubernetesNamespace?: string | null | undefined;
    kubernetesClusterName?: string | null | undefined;
  }): string | null {
    if (typeof input.address !== "string" || !input.address.trim()) {
      return null;
    }

    const port: string | number | null =
      typeof input.port === "number" || typeof input.port === "string"
        ? input.port
        : null;

    const endpoint: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
      system: normalizeDatabaseSystem(input.system) || "",
      address: input.address,
      port: port,
      caller: {
        kubernetesNamespace: input.kubernetesNamespace || null,
        kubernetesClusterName: input.kubernetesClusterName || null,
        hostName: null,
        isEphemeral: true,
      },
      purpose: "client-call",
    });

    return endpoint ? formatDatabaseEndpoint(endpoint) : null;
  }

  /*
   * Every database endpoint ONE query's attribute filter names: each
   * `server.address` value, with the port the filter gives, else the default
   * port of the engine the filter (or, failing that, the metric's receiver
   * prefix — `postgresql.backends` is PostgreSQL's) names.
   *
   * Takes one query's raw filter, not a merged map, because the port and the
   * engine only mean something next to the address they were written with.
   * Values may be strings, numbers or arrays of either; anything else (a
   * Search or Includes matcher) names no single server and is skipped.
   */
  public static extractDatabaseEndpoints(input: {
    attributes: Record<string, unknown> | null | undefined;
    metricName?: string | null | undefined;
  }): Array<string> {
    const attributes: Record<string, unknown> =
      input.attributes && typeof input.attributes === "object"
        ? input.attributes
        : {};

    const addresses: Array<string> = this.collectScalarValues(
      attributes,
      DatabaseServerAddressLabelKeys,
    );

    if (addresses.length === 0) {
      return [];
    }

    const ports: Array<string> = this.collectScalarValues(
      attributes,
      DatabaseServerPortLabelKeys,
    );

    const system: string | null =
      this.collectScalarValues(attributes, DatabaseSystemLabelKeys)[0] ||
      this.getDatabaseSystemFromMetricName(input.metricName);

    const kubernetesNamespace: string | undefined = this.collectScalarValues(
      attributes,
      DatabaseKubernetesNamespaceLabelKeys,
    )[0];

    const kubernetesClusterName: string | undefined = this.collectScalarValues(
      attributes,
      DatabaseKubernetesClusterLabelKeys,
    )[0];

    const endpoints: Set<string> = new Set<string>();

    for (const address of addresses) {
      for (const port of ports.length > 0 ? ports : [null]) {
        const endpoint: string | null = this.buildDatabaseEndpointRef({
          address: address,
          port: port,
          system: system,
          kubernetesNamespace: kubernetesNamespace,
          kubernetesClusterName: kubernetesClusterName,
        });

        if (endpoint) {
          endpoints.add(endpoint);
        }
      }
    }

    return Array.from(endpoints);
  }

  /*
   * The engine whose collector receiver emits `metricName`, from the
   * receivers' metric prefixes (`postgresql.`, `redis.`, ...). Null for
   * anything else — `db.client.*` included, which every engine's clients
   * emit alike.
   */
  private static getDatabaseSystemFromMetricName(
    metricName: string | null | undefined,
  ): string | null {
    if (typeof metricName !== "string" || !metricName) {
      return null;
    }

    const name: string = metricName.trim().toLowerCase();

    for (const descriptor of DATABASE_SYSTEMS) {
      for (const prefix of descriptor.receiverMetricPrefixes) {
        if (name.startsWith(prefix)) {
          return descriptor.system;
        }
      }
    }

    return null;
  }

  /*
   * Like collectLabelValues, but a filter value may also be a number (a port
   * typed into the query form) — stringified — and anything that is not a
   * plain scalar is dropped rather than coerced into "[object Object]".
   */
  private static collectScalarValues(
    attributes: Record<string, unknown>,
    keys: ReadonlyArray<string>,
  ): Array<string> {
    const found: Set<string> = new Set<string>();

    const add: (value: unknown) => void = (value: unknown): void => {
      if (typeof value === "string" && value.trim().length > 0) {
        found.add(value.trim());
      } else if (typeof value === "number" && Number.isFinite(value)) {
        found.add(String(value));
      }
    };

    for (const key of keys) {
      const value: unknown = attributes[key];

      if (Array.isArray(value)) {
        for (const item of value) {
          add(item);
        }
      } else {
        add(value);
      }
    }

    return Array.from(found);
  }
}
