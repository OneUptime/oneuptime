import { JSONObject } from "../JSON";
import {
  OPENSTACK_SERVICE_STATUS_DOWN,
  OpenStackResourceKind,
} from "./OpenStackResourceKind";

/*
 * WHAT A CLOUD STANDS ON, AND WHAT GOES WHEN IT GOES.
 *
 * Most OpenStack outages begin underneath it: a RabbitMQ partition, Galera losing quorum, an
 * OVN database with no leader. They then show up as twenty things at once, because every
 * worker reads as down. So this says, once, what each of those is and what it takes with it.
 * The card and pages (OpenStackControlPlaneHealth), the alert templates
 * (OpenStackControlPlaneAlertTemplates), an alert's description (OpenStackAlertContext) and
 * the scan (OpenStackControlPlaneScan) all read it, so none can disagree.
 *
 * Pure, with no React and no database, so all of those can.
 */

// The agent's jobs stamp these words on every series: agents/OpenStackAgent/otel-collector-config.yaml.
export enum OpenStackDependency {
  RabbitMq = "rabbitmq",
  MariaDb = "mariadb",
  Memcached = "memcached",
  HaProxy = "haproxy",
  Network = "network",
  Libvirt = "libvirt",
}

export const OPENSTACK_DEPENDENCIES: ReadonlyArray<OpenStackDependency> = [
  OpenStackDependency.RabbitMq,
  OpenStackDependency.MariaDb,
  OpenStackDependency.Memcached,
  OpenStackDependency.HaProxy,
  OpenStackDependency.Network,
  OpenStackDependency.Libvirt,
];

export const OPENSTACK_DEPENDENCY_LABEL: string = "openstack_dependency";
export const OPENSTACK_EXPORTER_HOST_LABEL: string = "openstack_exporter_host";

/*
 * Where a cluster's failure is the whole dependency failing, and where it is one machine's.
 * RabbitMQ with one node of three gone carries on. libvirt or Open vSwitch gone takes only
 * what is on that host, however many other hosts are fine.
 */
export type OpenStackDependencyShape = "cluster" | "per-host";

export interface OpenStackDependencyDefinition {
  dependency: OpenStackDependency;
  title: string;
  // One line, on the card.
  description: string;
  shape: OpenStackDependencyShape;
  // The agent's setting that names its targets.
  targetsVariable: string;
  // What its failure takes down, as read in an incident and on its page.
  takesDown: string;
  // A page of OneUptime's that goes deeper, where the product has one.
  deeperProduct?: "queues" | "databases" | undefined;
}

export const OPENSTACK_DEPENDENCY_DEFINITIONS: Readonly<
  Record<OpenStackDependency, OpenStackDependencyDefinition>
> = {
  [OpenStackDependency.RabbitMq]: {
    dependency: OpenStackDependency.RabbitMq,
    title: "RabbitMQ",
    description: "How OpenStack's services talk to each other.",
    shape: "cluster",
    targetsVariable: "OPENSTACK_RABBITMQ_TARGETS",
    takesDown:
      "Every OpenStack service talks through RabbitMQ. With it gone nova-compute, the schedulers and conductors, Neutron's agents and cinder-volume stop reporting and read as down, and nothing can be created, changed or deleted. Instances that are already running carry on.",
    deeperProduct: "queues",
  },
  [OpenStackDependency.MariaDb]: {
    dependency: OpenStackDependency.MariaDb,
    title: "MariaDB and Galera",
    description: "Where every service keeps its state.",
    shape: "cluster",
    targetsVariable: "OPENSTACK_MARIADB_TARGETS",
    takesDown:
      "Every API keeps its state in MariaDB. With the cluster gone Keystone cannot issue a token, every API starts failing and the conductors stop, so nothing can be read or changed. Instances that are already running carry on.",
    deeperProduct: "databases",
  },
  [OpenStackDependency.Memcached]: {
    dependency: OpenStackDependency.Memcached,
    title: "Memcached",
    description: "Where the APIs cache Keystone's tokens.",
    shape: "cluster",
    targetsVariable: "OPENSTACK_MEMCACHED_TARGETS",
    takesDown:
      "The APIs cache Keystone's tokens in Memcached. With it gone every request validates its token the long way, so the APIs slow down and Keystone takes the load. Nothing stops.",
  },
  [OpenStackDependency.HaProxy]: {
    dependency: OpenStackDependency.HaProxy,
    title: "HAProxy",
    description: "The way in to every API.",
    shape: "cluster",
    targetsVariable: "OPENSTACK_HAPROXY_TARGETS",
    takesDown:
      "HAProxy is the way in to every API. A backend with no server left is an API nobody can reach, however healthy its service is, and everything that calls it fails too.",
  },
  [OpenStackDependency.Network]: {
    dependency: OpenStackDependency.Network,
    title: "OVN and Open vSwitch",
    description: "The network instances are on.",
    shape: "per-host",
    targetsVariable: "OPENSTACK_NETWORK_EXPORTER_TARGETS",
    takesDown:
      "OVN and Open vSwitch carry the instances' traffic. ovn-controller gone from a host leaves what it programmed in place, but new ports and changes on that host do not arrive. Open vSwitch gone takes that host's instances off the network. A database with no leader stops every change to the network, on every host.",
  },
  [OpenStackDependency.Libvirt]: {
    dependency: OpenStackDependency.Libvirt,
    title: "libvirt",
    description: "How nova-compute runs instances.",
    shape: "per-host",
    targetsVariable: "OPENSTACK_LIBVIRT_HEALTH_TARGETS",
    takesDown:
      "nova-compute runs instances through libvirt. With it gone from a host its instances carry on, but none can be started, stopped or moved, and that host's nova-compute goes down.",
  },
};

/*
 * Where each of these stops being fine: one set of lines for the pages and the alert
 * templates, for the reason OpenStackHealthRules gives.
 */
export const OPENSTACK_RABBITMQ_FILE_DESCRIPTORS_WARNING_PERCENT: number = 90;
export const OPENSTACK_RABBITMQ_UNACKNOWLEDGED_MESSAGES_WARNING: number = 1000;
export const OPENSTACK_MARIADB_CONNECTIONS_WARNING_PERCENT: number = 80;
export const OPENSTACK_HAPROXY_ERROR_RESPONSES_WARNING_PERCENT: number = 5;

/*
 * wsrep_local_state: 4 is Synced, and 2 is a node a person took out with wsrep_desync to
 * back it up, which is planned work (https://galeracluster.com/library/documentation/node-states.html).
 */
export const OPENSTACK_GALERA_STATE_SYNCED: number = 4;
export const OPENSTACK_GALERA_STATE_DONOR_DESYNCED: number = 2;

// A target that has said nothing for this long is not being read, and says nothing current.
export const OPENSTACK_CONTROL_PLANE_NO_READING_MINUTES: number = 10;

/*
 * What a row of one holds, read from what the exporter behind it says. Each is left out when
 * that exporter does not say it, which is not the same as it being fine.
 */
export const OPENSTACK_CONTROL_PLANE_FACTS: {
  Dependency: string;
  Node: string;
  Cluster: string;
  ScrapeFailed: string;
  MemoryAlarm: string;
  DiskAlarm: string;
  FileDescriptorAlarm: string;
  OpenFileDescriptors: string;
  MaxFileDescriptors: string;
  Connections: string;
  Queues: string;
  Consumers: string;
  MessagesReady: string;
  MessagesUnacknowledged: string;
  ClusterSize: string;
  ClusterPrimary: string;
  Ready: string;
  Connected: string;
  LocalState: string;
  Desynced: string;
  ThreadsConnected: string;
  MaxConnections: string;
  CurrentConnections: string;
  BridgePorts: string;
} = {
  Dependency: "dependency",
  Node: "node",
  Cluster: "cluster",
  ScrapeFailed: "scrapeFailed",
  MemoryAlarm: "memoryAlarm",
  DiskAlarm: "diskAlarm",
  FileDescriptorAlarm: "fileDescriptorAlarm",
  OpenFileDescriptors: "openFileDescriptors",
  MaxFileDescriptors: "maxFileDescriptors",
  Connections: "connections",
  Queues: "queues",
  Consumers: "consumers",
  MessagesReady: "messagesReady",
  MessagesUnacknowledged: "messagesUnacknowledged",
  ClusterSize: "clusterSize",
  ClusterPrimary: "clusterPrimary",
  Ready: "ready",
  Connected: "connected",
  LocalState: "localState",
  Desynced: "desynced",
  ThreadsConnected: "threadsConnected",
  MaxConnections: "maxConnections",
  CurrentConnections: "currentConnections",
  BridgePorts: "bridgePorts",
};

/*
 * When a series that goes away with what it reports was last there: see SEEN_FACTS in
 * OpenStackControlPlaneScan. A machine that never had one has no such fact, and is not
 * said to have lost it: a host of only OVN's databases runs no ovn-controller.
 */
export const OPENSTACK_NETWORK_FACTS: {
  OvsSeenAt: string;
  OvnChassisSeenAt: string;
  OvnControllerSeenAt: string;
} = {
  OvsSeenAt: "ovsSeenAt",
  OvnChassisSeenAt: "ovnChassisSeenAt",
  OvnControllerSeenAt: "ovnControllerSeenAt",
};

/*
 * Facts a row holds one of per backend, server or database, one key each. A scrape can
 * reach OneUptime split across batches and `facts` merges key by key, so a list in one fact
 * would be overwritten by whichever part arrived last. A value is when it was last seen in
 * that state, so one someone removed from HAProxy stops counting.
 */
export const OPENSTACK_BACKEND_DOWN_FACT_PREFIX: string = "backendDown/";
export const OPENSTACK_SERVER_DOWN_FACT_PREFIX: string = "serverDown/";
export const OPENSTACK_RAFT_MEMBER_FACT_PREFIX: string = "raftMember/";
export const OPENSTACK_RAFT_LEADER_FACT_PREFIX: string = "raftLeader/";

// How far behind its row's last reading one of those can be, and still be current.
export const OPENSTACK_KEYED_FACT_CURRENT_MINUTES: number = 5;

/*
 * The fields of an inventory row these read. Both the model the pages hold and the JSON the
 * server's attention read answers satisfy it.
 */
export interface OpenStackControlPlaneRow {
  externalId?: string | null | undefined;
  name?: string | null | undefined;
  regionName?: string | null | undefined;
  status?: string | null | undefined;
  facts?: unknown;
  lastSeenAt?: Date | string | null | undefined;
}

export function getOpenStackControlPlaneRowId(data: {
  region: string | null;
  dependency: OpenStackDependency;
  host: string;
}): string {
  return `${data.region || "default"}/${data.dependency}/${data.host}`;
}

export function getOpenStackDependencyOfRow(
  row: OpenStackControlPlaneRow,
): OpenStackDependency | null {
  const value: unknown = factsOf(row)[OPENSTACK_CONTROL_PLANE_FACTS.Dependency];
  return OPENSTACK_DEPENDENCIES.includes(value as OpenStackDependency)
    ? (value as OpenStackDependency)
    : null;
}

export function isOpenStackDependency(
  value: string | null | undefined,
): value is OpenStackDependency {
  return OPENSTACK_DEPENDENCIES.includes(value as OpenStackDependency);
}

function factsOf(row: OpenStackControlPlaneRow): JSONObject {
  return (row.facts as JSONObject | undefined) || {};
}

export function isOpenStackControlPlaneRowCurrent(data: {
  row: OpenStackControlPlaneRow;
  now: Date;
}): boolean {
  if (!data.row.lastSeenAt) {
    return false;
  }
  const seenAt: number = new Date(data.row.lastSeenAt).getTime();
  return (
    !isNaN(seenAt) &&
    data.now.getTime() - seenAt <=
      OPENSTACK_CONTROL_PLANE_NO_READING_MINUTES * 60000
  );
}

function isDown(row: OpenStackControlPlaneRow): boolean {
  return row.status === OPENSTACK_SERVICE_STATUS_DOWN;
}

/*
 * The names under one of the keyed facts, current as of the row's last reading. A part of a
 * scrape that arrived a little earlier than the rest is still that scrape.
 */
export function getOpenStackKeyedFacts(
  row: OpenStackControlPlaneRow,
  prefix: string,
): Array<string> {
  const facts: JSONObject = factsOf(row);
  const seenAt: number = row.lastSeenAt
    ? new Date(row.lastSeenAt).getTime()
    : NaN;
  const names: Array<string> = [];

  for (const key of Object.keys(facts)) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const value: unknown = facts[key];
    if (typeof value !== "string") {
      continue;
    }
    const at: number = new Date(value).getTime();
    if (
      isNaN(seenAt) ||
      (!isNaN(at) && seenAt - at <= OPENSTACK_KEYED_FACT_CURRENT_MINUTES * 60000)
    ) {
      names.push(key.substring(prefix.length));
    }
  }

  return names.sort();
}

/*
 * What is wrong with a dependency as a whole, in one region. A cluster is down when no node
 * of it answers, or for Galera when no node is in the Primary component: every node
 * answering and none of them taking writes is the same outage to whatever needs them.
 */
export function isOpenStackDependencyDown(data: {
  dependency: OpenStackDependency;
  rows: ReadonlyArray<OpenStackControlPlaneRow>;
}): boolean {
  const { dependency, rows } = data;

  if (rows.length === 0) {
    return false;
  }

  if (rows.every(isDown)) {
    return true;
  }

  if (dependency === OpenStackDependency.MariaDb) {
    const answering: Array<OpenStackControlPlaneRow> = rows.filter(
      (row: OpenStackControlPlaneRow): boolean => {
        return !isDown(row);
      },
    );
    return answering.every((row: OpenStackControlPlaneRow): boolean => {
      return factsOf(row)[OPENSTACK_CONTROL_PLANE_FACTS.ClusterPrimary] === false;
    });
  }

  return false;
}

/*
 * What a failed part of a cloud probably failed because of. A worker that stopped reporting
 * says nothing about why, and the first question whoever it wakes asks is whether it is the
 * only thing that went. What stands behind each:
 *
 *  - Every worker talks through RabbitMQ, and keeps its state through MariaDB, directly or
 *    through a conductor. So whichever of those is down in its region.
 *  - An API reads MariaDB, and is reached through HAProxy, so one of its backends with no
 *    server left. Those are named by the API's own service, which HAProxy's name carries in
 *    all the deployments these were checked on, so the match is by that word.
 *  - nova-compute runs through libvirt on its own host, and a Neutron agent or ovn-controller
 *    through Open vSwitch and OVN on its own host.
 *
 * Only what is actually down: this is read beside a failure at the moment it fires, so one
 * node of three being away is not said to be the cause of anything.
 */
export interface OpenStackProbableCause {
  dependency: OpenStackDependency;
  regionName: string | null;
  // The machine it is on, when it is about one.
  host?: string | undefined;
}

const NETWORK_WORKER: RegExp = /neutron|ovn|openvswitch/i;

export function getOpenStackProbableCauses(data: {
  partKind: OpenStackResourceKind;
  // A worker's binary, or an API's service type.
  partName: string | null | undefined;
  // The machine a worker runs on.
  partHost?: string | null | undefined;
  regionName: string | null | undefined;
  rows: ReadonlyArray<OpenStackControlPlaneRow>;
  now: Date;
}): Array<OpenStackProbableCause> {
  const region: string | null = data.regionName || null;
  const current: Array<OpenStackControlPlaneRow> = data.rows.filter(
    (row: OpenStackControlPlaneRow): boolean => {
      return (
        (row.regionName || null) === region &&
        isOpenStackControlPlaneRowCurrent({ row, now: data.now })
      );
    },
  );
  const rowsOf: (
    dependency: OpenStackDependency,
  ) => Array<OpenStackControlPlaneRow> = (
    dependency: OpenStackDependency,
  ): Array<OpenStackControlPlaneRow> => {
    return current.filter((row: OpenStackControlPlaneRow): boolean => {
      return getOpenStackDependencyOfRow(row) === dependency;
    });
  };
  const causes: Array<OpenStackProbableCause> = [];
  const addWhole: (dependency: OpenStackDependency) => void = (
    dependency: OpenStackDependency,
  ): void => {
    if (isOpenStackDependencyDown({ dependency, rows: rowsOf(dependency) })) {
      causes.push({ dependency, regionName: region });
    }
  };
  const addOnHost: (dependency: OpenStackDependency) => void = (
    dependency: OpenStackDependency,
  ): void => {
    const host: string | null | undefined = data.partHost;
    if (
      host &&
      rowsOf(dependency).some((row: OpenStackControlPlaneRow): boolean => {
        return (
          isDown(row) && (row.name === host || isSameMachine(row.name, host))
        );
      })
    ) {
      causes.push({ dependency, regionName: region, host });
    }
  };

  if (data.partKind === OpenStackResourceKind.Api) {
    addWhole(OpenStackDependency.MariaDb);
    addWhole(OpenStackDependency.HaProxy);
    return causes;
  }

  if (data.partKind !== OpenStackResourceKind.Service) {
    return causes;
  }

  addWhole(OpenStackDependency.RabbitMq);
  addWhole(OpenStackDependency.MariaDb);

  const worker: string = data.partName || "";
  if (worker === "nova-compute") {
    addOnHost(OpenStackDependency.Libvirt);
  }
  if (NETWORK_WORKER.test(worker)) {
    addOnHost(OpenStackDependency.Network);
  }

  return causes;
}

// A target is often an address where a worker has a name: only the same word counts.
function isSameMachine(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  const short: (name: string | null | undefined) => string = (
    name: string | null | undefined,
  ): string => {
    return (name || "").split(".")[0] || "";
  };
  return short(first) !== "" && short(first) === short(second);
}

// The sentence an alert's description says, in English like the rest of it.
export function describeOpenStackProbableCause(
  cause: OpenStackProbableCause,
): string {
  const definition: OpenStackDependencyDefinition =
    OPENSTACK_DEPENDENCY_DEFINITIONS[cause.dependency];
  const where: string = cause.host
    ? `on ${cause.host}`
    : cause.regionName
      ? `in ${cause.regionName}`
      : "";
  return `${definition.title} is down${where ? ` ${where}` : ""}. ${definition.takesDown}`;
}
