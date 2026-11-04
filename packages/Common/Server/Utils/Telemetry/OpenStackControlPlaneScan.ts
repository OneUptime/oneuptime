import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import {
  OPENSTACK_BACKEND_DOWN_FACT_PREFIX,
  OPENSTACK_CONTROL_PLANE_FACTS,
  OPENSTACK_DEPENDENCY_LABEL,
  OPENSTACK_EXPORTER_HOST_LABEL,
  OPENSTACK_NETWORK_FACTS,
  OPENSTACK_RAFT_LEADER_FACT_PREFIX,
  OPENSTACK_RAFT_MEMBER_FACT_PREFIX,
  OPENSTACK_SERVER_DOWN_FACT_PREFIX,
  OpenStackDependency,
  getOpenStackControlPlaneRowId,
  isOpenStackDependency,
} from "../../../Types/OpenStack/OpenStackControlPlane";
import {
  OPENSTACK_SERVICE_STATUS_DOWN,
  OPENSTACK_SERVICE_STATUS_UP,
} from "../../../Types/OpenStack/OpenStackResourceKind";

/*
 * WHAT THE EXPORTERS UNDER A CLOUD SAY, FOLDED INTO ONE ROW PER MACHINE.
 *
 * The agent's control plane jobs stamp each series with the dependency it is about and the
 * machine it came from, so this needs nothing else to know which row a series belongs to.
 * It is the scan's own contract (OpenStackSnapshotScan): pure, skipped by name, status in
 * words, and never zeroing anything a scrape did not say.
 *
 * `up` says the exporter answered. Where the exporter is part of the thing it reports,
 * RabbitMQ's plugin and HAProxy's own, that is the thing being up. Where it sits beside it,
 * an answer says nothing, and the exporter's own series says: a stopped MariaDB leaves
 * mysqld_exporter answering with mysql_up 0. One failed scrape always says down.
 */

interface OwnUpSeries {
  dependency: OpenStackDependency;
}

// The exporter's own word on whether what it sits beside answers.
const OWN_UP_SERIES: ReadonlyMap<string, OwnUpSeries> = new Map<
  string,
  OwnUpSeries
>([
  ["mysql_up", { dependency: OpenStackDependency.MariaDb }],
  ["memcached_up", { dependency: OpenStackDependency.Memcached }],
  ["libvirt_up", { dependency: OpenStackDependency.Libvirt }],
]);

// `up` alone says these are up: the exporter is inside what it reports.
const UP_MEANS_UP: ReadonlySet<OpenStackDependency> = new Set([
  OpenStackDependency.RabbitMq,
  OpenStackDependency.HaProxy,
  OpenStackDependency.Network,
]);

// A number as it stands, by the fact that holds it.
const NUMBER_FACTS: ReadonlyMap<string, string> = new Map<string, string>([
  [
    "rabbitmq_process_open_fds",
    OPENSTACK_CONTROL_PLANE_FACTS.OpenFileDescriptors,
  ],
  [
    "rabbitmq_process_max_fds",
    OPENSTACK_CONTROL_PLANE_FACTS.MaxFileDescriptors,
  ],
  ["rabbitmq_connections", OPENSTACK_CONTROL_PLANE_FACTS.Connections],
  ["rabbitmq_queues", OPENSTACK_CONTROL_PLANE_FACTS.Queues],
  ["rabbitmq_consumers", OPENSTACK_CONTROL_PLANE_FACTS.Consumers],
  [
    "rabbitmq_queue_messages_ready",
    OPENSTACK_CONTROL_PLANE_FACTS.MessagesReady,
  ],
  [
    "rabbitmq_queue_messages_unacked",
    OPENSTACK_CONTROL_PLANE_FACTS.MessagesUnacknowledged,
  ],
  [
    "mysql_global_status_wsrep_cluster_size",
    OPENSTACK_CONTROL_PLANE_FACTS.ClusterSize,
  ],
  [
    "mysql_global_status_wsrep_local_state",
    OPENSTACK_CONTROL_PLANE_FACTS.LocalState,
  ],
  [
    "mysql_global_status_threads_connected",
    OPENSTACK_CONTROL_PLANE_FACTS.ThreadsConnected,
  ],
  [
    "mysql_global_variables_max_connections",
    OPENSTACK_CONTROL_PLANE_FACTS.MaxConnections,
  ],
  [
    "memcached_current_connections",
    OPENSTACK_CONTROL_PLANE_FACTS.CurrentConnections,
  ],
  ["ovs_bridge_port_count", OPENSTACK_CONTROL_PLANE_FACTS.BridgePorts],
]);

// A 0 or 1 as what it says: the exporters write these as numbers.
const BOOLEAN_FACTS: ReadonlyMap<string, string> = new Map<string, string>([
  [
    "rabbitmq_alarms_memory_used_watermark",
    OPENSTACK_CONTROL_PLANE_FACTS.MemoryAlarm,
  ],
  [
    "rabbitmq_alarms_free_disk_space_watermark",
    OPENSTACK_CONTROL_PLANE_FACTS.DiskAlarm,
  ],
  [
    "rabbitmq_alarms_file_descriptor_limit",
    OPENSTACK_CONTROL_PLANE_FACTS.FileDescriptorAlarm,
  ],
  [
    "mysql_global_status_wsrep_cluster_status",
    OPENSTACK_CONTROL_PLANE_FACTS.ClusterPrimary,
  ],
  ["mysql_global_status_wsrep_ready", OPENSTACK_CONTROL_PLANE_FACTS.Ready],
  [
    "mysql_global_status_wsrep_connected",
    OPENSTACK_CONTROL_PLANE_FACTS.Connected,
  ],
  [
    "mysql_global_variables_wsrep_desync",
    OPENSTACK_CONTROL_PLANE_FACTS.Desynced,
  ],
]);

/*
 * A series that is only there while something behind the exporter answers: openstack-network-
 * exporter reads each over that thing's own control socket, so it goes when that does. So
 * when each was last there is what says so, which is why it is a time and not a yes.
 */
const SEEN_FACTS: ReadonlyMap<string, string> = new Map<string, string>([
  ["ovs_build_info", OPENSTACK_NETWORK_FACTS.OvsSeenAt],
  ["ovnc_encap_ip", OPENSTACK_NETWORK_FACTS.OvnChassisSeenAt],
  ["ovnc_txn_error", OPENSTACK_NETWORK_FACTS.OvnControllerSeenAt],
  ["ovnc_txn_uncommitted", OPENSTACK_NETWORK_FACTS.OvnControllerSeenAt],
  ["ovnc_rconn_discarded", OPENSTACK_NETWORK_FACTS.OvnControllerSeenAt],
  ["ovnc_rconn_overflow", OPENSTACK_NETWORK_FACTS.OvnControllerSeenAt],
]);

const HAPROXY_BACKEND_STATUS: string = "haproxy_backend_status";
const HAPROXY_SERVER_STATUS: string = "haproxy_server_status";
const RABBITMQ_IDENTITY: string = "rabbitmq_identity_info";
const RAFT_LEADER: string = "ovn_raft_cluster_leader";

export const OPENSTACK_CONTROL_PLANE_METRIC_NAMES: ReadonlySet<string> =
  new Set<string>([
    "up",
    RABBITMQ_IDENTITY,
    HAPROXY_BACKEND_STATUS,
    HAPROXY_SERVER_STATUS,
    RAFT_LEADER,
    ...OWN_UP_SERIES.keys(),
    ...NUMBER_FACTS.keys(),
    ...BOOLEAN_FACTS.keys(),
    ...SEEN_FACTS.keys(),
  ]);

function labelOf(attributes: JSONArray, key: string): string | null {
  for (const attribute of attributes) {
    if ((attribute as JSONObject)["key"] !== key) {
      continue;
    }
    const value: JSONValue = (
      (attribute as JSONObject)["value"] as JSONObject | undefined
    )?.["stringValue"];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function isOpenStackControlPlaneDatapoint(data: {
  metricName: string;
  datapoint: JSONObject;
}): boolean {
  return (
    OPENSTACK_CONTROL_PLANE_METRIC_NAMES.has(data.metricName) &&
    isOpenStackDependency(
      labelOf(
        (data.datapoint["attributes"] as JSONArray) || [],
        OPENSTACK_DEPENDENCY_LABEL,
      ),
    )
  );
}

// The fields of a buffered row this writes. The scan keeps the rest of its shape.
export interface OpenStackControlPlaneEntry {
  name: string | null;
  regionName: string | null;
  status: string | null;
  statusObservedAt: Date | null;
  facts: JSONObject;
}

function setStatus(
  entry: OpenStackControlPlaneEntry,
  status: string,
  observedAt: Date,
): void {
  if (!entry.statusObservedAt || observedAt >= entry.statusObservedAt) {
    entry.status = status;
    entry.statusObservedAt = observedAt;
  }
}

/*
 * One datapoint into its row. Says whether it was one of these, so the scan can go on to
 * what it reads itself. `entryFor` is the scan's own, so a row here is buffered as any other.
 */
export function foldOpenStackControlPlaneDatapoint(data: {
  metricName: string;
  attributes: JSONArray;
  value: number;
  observedAt: Date;
  region: string | null;
  entryFor: (externalId: string) => OpenStackControlPlaneEntry;
}): boolean {
  const dependencyLabel: string | null = labelOf(
    data.attributes,
    OPENSTACK_DEPENDENCY_LABEL,
  );

  if (!isOpenStackDependency(dependencyLabel)) {
    return false;
  }

  const dependency: OpenStackDependency = dependencyLabel;
  const host: string | null = labelOf(
    data.attributes,
    OPENSTACK_EXPORTER_HOST_LABEL,
  );

  // A job names each machine, so a series without one came from something else.
  if (!host) {
    return true;
  }

  const entry: OpenStackControlPlaneEntry = data.entryFor(
    getOpenStackControlPlaneRowId({ region: data.region, dependency, host }),
  );

  if (entry.name === null) {
    entry.name = host;
  }
  if (entry.regionName === null && data.region) {
    entry.regionName = data.region;
  }
  entry.facts[OPENSTACK_CONTROL_PLANE_FACTS.Dependency] = dependency;

  const { metricName, value, observedAt } = data;
  const at: string = observedAt.toISOString();

  if (metricName === "up") {
    entry.facts[OPENSTACK_CONTROL_PLANE_FACTS.ScrapeFailed] = value <= 0;
    if (value <= 0) {
      setStatus(entry, OPENSTACK_SERVICE_STATUS_DOWN, observedAt);
    } else if (UP_MEANS_UP.has(dependency)) {
      setStatus(entry, OPENSTACK_SERVICE_STATUS_UP, observedAt);
    }
    return true;
  }

  if (OWN_UP_SERIES.has(metricName)) {
    setStatus(
      entry,
      value > 0 ? OPENSTACK_SERVICE_STATUS_UP : OPENSTACK_SERVICE_STATUS_DOWN,
      observedAt,
    );
    return true;
  }

  const numberFact: string | undefined = NUMBER_FACTS.get(metricName);
  if (numberFact) {
    entry.facts[numberFact] = value;
    return true;
  }

  const booleanFact: string | undefined = BOOLEAN_FACTS.get(metricName);
  if (booleanFact) {
    entry.facts[booleanFact] = value > 0;
    return true;
  }

  const seenFact: string | undefined = SEEN_FACTS.get(metricName);
  if (seenFact) {
    entry.facts[seenFact] = at;
    return true;
  }

  if (metricName === RABBITMQ_IDENTITY) {
    const node: string | null = labelOf(data.attributes, "rabbitmq_node");
    const cluster: string | null = labelOf(data.attributes, "rabbitmq_cluster");
    if (node) {
      entry.facts[OPENSTACK_CONTROL_PLANE_FACTS.Node] = node;
    }
    if (cluster) {
      entry.facts[OPENSTACK_CONTROL_PLANE_FACTS.Cluster] = cluster;
    }
    return true;
  }

  if (metricName === HAPROXY_BACKEND_STATUS) {
    /*
     * One series per state, with 1 on the state it is in. Each backend has its own key, for
     * the reason OPENSTACK_BACKEND_DOWN_FACT_PREFIX gives, and null is "not down as of then".
     */
    const proxy: string | null = labelOf(data.attributes, "proxy");
    if (proxy && labelOf(data.attributes, "state") === "DOWN") {
      entry.facts[`${OPENSTACK_BACKEND_DOWN_FACT_PREFIX}${proxy}`] =
        value > 0 ? at : null;
    }
    return true;
  }

  if (metricName === HAPROXY_SERVER_STATUS) {
    const proxy: string | null = labelOf(data.attributes, "proxy");
    const server: string | null = labelOf(data.attributes, "server");
    if (proxy && server && labelOf(data.attributes, "state") === "DOWN") {
      entry.facts[`${OPENSTACK_SERVER_DOWN_FACT_PREFIX}${proxy}/${server}`] =
        value > 0 ? at : null;
    }
    return true;
  }

  if (metricName === RAFT_LEADER) {
    const database: string | null = labelOf(data.attributes, "database");
    if (database) {
      entry.facts[`${OPENSTACK_RAFT_MEMBER_FACT_PREFIX}${database}`] = at;
      entry.facts[`${OPENSTACK_RAFT_LEADER_FACT_PREFIX}${database}`] =
        value > 0 ? at : null;
    }
    return true;
  }

  return true;
}
