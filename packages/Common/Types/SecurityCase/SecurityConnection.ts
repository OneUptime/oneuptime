import { SecurityEntity } from "./SecurityEntity";

/*
 * SECURITY CONNECTIONS: where the users, hosts and addresses Security Events
 * names are in the rest of OneUptime, and the way back.
 *
 * A security event names its entities by value - "web-1", "10.0.3.17",
 * "k.morgan@acme.example" - and the rest of OneUptime knows the same things
 * by its own keys: a host by the host.name its collector reports, a
 * Kubernetes cluster by k8s.cluster.name, a project member by their email,
 * the service whose logs a line came from by its id. A connection is one of
 * those meeting the other, and how sure OneUptime is of it:
 *
 *   Exact     the same thing: a host reporting this very name, the cluster
 *             of this name, the member with this email, the only resource
 *             holding this public address, the resource whose logs the
 *             event was read from.
 *   Possible  probably the same thing, for a reason a person should weigh:
 *             one name is the other's short form (web-1 and
 *             web-1.acme.internal), the event does not say the value is a
 *             host at all, the address is a private one (another network
 *             can use 10.0.3.17 too), or several resources hold it.
 *
 * Exact connections count everywhere: on a resource's page, in the incident
 * a case declares, for OneUptime AI. Possible ones are shown, said to be
 * possible and why, and counted nowhere - a guess must never put a case on
 * the wrong host's page.
 *
 * Values are compared the one way Security Events compares them - trimmed
 * and case folded, as an entity's risk key and a case's grouping key are
 * (getEntityRiskKey) - which is also how OneUptime keys its own resources
 * (canonicalizeEntityValue).
 *
 * Free of anything server-only and of React: the server that reads the
 * connections and the pages that draw them agree on every word of this.
 */

// The kinds of OneUptime record a security entity can be.
export enum SecurityConnectionKind {
  Host = "Host",
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  KubernetesCluster = "KubernetesCluster",
  NetworkDevice = "NetworkDevice",
  Service = "Service",
  User = "User",
  /*
   * An inventory item: only ever looked up the way back, for its page's
   * Security card - a machine's item is what its host, device or cluster
   * is, and a connection names that record instead.
   */
  InventoryItem = "InventoryItem",
}

// The order connections are listed in: machines, then clusters, services, people.
export const SECURITY_CONNECTION_KINDS: ReadonlyArray<SecurityConnectionKind> =
  [
    SecurityConnectionKind.Host,
    SecurityConnectionKind.DockerHost,
    SecurityConnectionKind.PodmanHost,
    SecurityConnectionKind.KubernetesCluster,
    SecurityConnectionKind.NetworkDevice,
    SecurityConnectionKind.Service,
    SecurityConnectionKind.User,
    SecurityConnectionKind.InventoryItem,
  ];

export enum SecurityConnectionCertainty {
  Exact = "Exact",
  Possible = "Possible",
}

// Why a security entity is (or may be) a OneUptime record.
export enum SecurityConnectionReason {
  // The event was read from this resource's own logs ("Your logs").
  LogSource = "LogSource",
  // The resource reports exactly this name.
  HostName = "HostName",
  // One name is the other's short form: web-1 and web-1.acme.internal.
  ShortHostName = "ShortHostName",
  /*
   * The event names the record's name without saying what it is - an
   * untyped value, from an attribute a rule grouped by, say - so it may be
   * something else of the same name.
   */
  UntypedValue = "UntypedValue",
  // The Kubernetes cluster of this k8s.cluster.name.
  ClusterName = "ClusterName",
  // The network device of this name, hostname or DNS name.
  DeviceName = "DeviceName",
  // The only resource holding this public address.
  Address = "Address",
  // A private address: another network can use it for another machine.
  PrivateAddress = "PrivateAddress",
  // More than one resource holds this address.
  SharedAddress = "SharedAddress",
  // The project member with this email.
  Email = "Email",
}

// Exact reasons, and the reasons that only ever make a possible connection.
export const EXACT_SECURITY_CONNECTION_REASONS: ReadonlyArray<SecurityConnectionReason> =
  [
    SecurityConnectionReason.LogSource,
    SecurityConnectionReason.HostName,
    SecurityConnectionReason.ClusterName,
    SecurityConnectionReason.DeviceName,
    SecurityConnectionReason.Address,
    SecurityConnectionReason.Email,
  ];

export const POSSIBLE_SECURITY_CONNECTION_REASONS: ReadonlyArray<SecurityConnectionReason> =
  [
    SecurityConnectionReason.ShortHostName,
    SecurityConnectionReason.UntypedValue,
    SecurityConnectionReason.PrivateAddress,
    SecurityConnectionReason.SharedAddress,
  ];

/*
 * The time around an event its connected signals are read for: half an hour
 * either side, enough for what led up to it and what followed, short enough
 * that a chart still shows minutes.
 */
export const SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES: number = 30;

/*
 * A case's window runs from half an hour before its first detection to half
 * an hour after its last, and is never longer than a day: the last day of a
 * case that has run for weeks, which is when it is being worked.
 */
export const SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS: number = 24;

// The most entities one lookup reads, as a case keeps at the most.
export const SECURITY_CONNECTION_MAX_ENTITIES: number = 50;

// The most addresses one lookup looks for among the project's resources.
export const SECURITY_CONNECTION_MAX_ADDRESSES: number = 10;

// The most records one lookup returns, exact ones first.
export const SECURITY_CONNECTION_MAX_RESOURCES: number = 10;

// The most of each kind of fact listed for one record (incidents, alerts, monitors, changes).
export const SECURITY_CONNECTION_MAX_LISTED: number = 3;

/*
 * A resource's own page looks this far back for the security events that
 * name it: the week an entity's risk is counted over.
 */
export const RESOURCE_SECURITY_WINDOW_IN_DAYS: number = 7;

// The most open cases a resource's page lists.
export const RESOURCE_SECURITY_MAX_CASES: number = 3;

/*
 * The attributes every event read from a log line carries about the log's
 * own resource - the row the log was sent under (a Service, a Host, a
 * Kubernetes cluster...) - so the event is connected to it exactly, whatever
 * its names say.
 */
export const SECURITY_LOG_RESOURCE_ID_ATTRIBUTE: string =
  "oneuptime.log.resource.id";
export const SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE: string =
  "oneuptime.log.resource.type";

// One way a security entity meets a record.
export interface SecurityConnectionMatch {
  entity: SecurityEntity;
  certainty: SecurityConnectionCertainty;
  reason: SecurityConnectionReason;
  // What the record holds that matched: its name, an address, an email.
  matchedValue: string;
}

// One open incident, alert or monitor on a connected record.
export interface SecurityConnectionRecordJson {
  id: string;
  title: string;
  // "#42", "INC-42": how the product numbers it, when it does.
  number?: string | undefined;
  stateName?: string | undefined;
  stateColor?: string | undefined;
}

export interface SecurityConnectionRecordListJson {
  count: number;
  items: Array<SecurityConnectionRecordJson>;
}

// One change recorded on a connected record in the window: a deploy, a rollout, a config change.
export interface SecurityConnectionChangeJson {
  id: string;
  time: string;
  title: string;
  eventType: string;
}

// One OneUptime record a case, an event or an entity is connected to, with what is happening on it.
export interface SecurityConnectedResourceJson {
  kind: SecurityConnectionKind;
  id: string;
  name: string;
  // The best of its matches.
  certainty: SecurityConnectionCertainty;
  matches: Array<{
    entityType: string;
    entityValue: string;
    certainty: SecurityConnectionCertainty;
    reason: SecurityConnectionReason;
    matchedValue: string;
  }>;
  /*
   * Each null when it was not read: the reader's role cannot read that kind
   * of record, or the read failed. Never zero for "unknown".
   */
  activeIncidents: SecurityConnectionRecordListJson | null;
  activeAlerts: SecurityConnectionRecordListJson | null;
  monitors: SecurityConnectionRecordListJson | null;
  recentChanges: Array<SecurityConnectionChangeJson> | null;
  // Its inventory record, when Inventory has one.
  inventoryItemId?: string | undefined;
}

// What a case, an event or an entity is connected to.
export interface SecurityConnectionsJson {
  windowStart: string;
  windowEnd: string;
  resources: Array<SecurityConnectedResourceJson>;
  // More records matched than are returned.
  hasMoreResources: boolean;
  // The users, hosts and addresses looked up that OneUptime does not know.
  unmatched: Array<SecurityEntity>;
  // Kinds of record the reader's role cannot read, so none of them is shown.
  unreadableKinds: Array<SecurityConnectionKind>;
  // Kinds of record that could not be read this time.
  failedKinds: Array<SecurityConnectionKind>;
}

// One open case naming a resource, as the resource's page lists it.
export interface ResourceSecurityCaseJson {
  id: string;
  number: string;
  title: string;
  priorityName?: string | undefined;
  priorityColor?: string | undefined;
  statusName?: string | undefined;
  statusColor?: string | undefined;
  lastDetectedAt?: string | undefined;
}

/*
 * What Security Events says about an incident: the case that declared it,
 * and the open cases naming the hosts and clusters it affects.
 */
export interface IncidentSecurityJson {
  // The cases that declared the incident, whatever their status.
  declaredBy: Array<ResourceSecurityCaseJson>;
  /*
   * The open cases, other than those, whose entities name a host, a
   * container host or a cluster the incident affects - each with which.
   */
  namingItsResources: Array<
    ResourceSecurityCaseJson & {
      resources: Array<{ kind: SecurityConnectionKind; id: string; name: string }>;
    }
  >;
  // How many open cases name them in all.
  namingItsResourcesCount: number;
}

// What Security Events says about one OneUptime record: its page's Security card.
export interface ResourceSecurityJson {
  kind: SecurityConnectionKind;
  id: string;
  name: string;
  /*
   * Whether the project uses Security Events at all - any security event in
   * the window. A project that does not is shown nothing about it.
   */
  isInUse: boolean;
  windowDays: number;
  // What the security events were searched for: the record's exact identities.
  values: Array<string>;
  // The entity its Security Events page is opened on: its main name.
  entity: SecurityEntity | null;
  eventCount: number;
  findingCount: number;
  maxSeverityId: number;
  lastSeen: string | null;
  // Null when the reader's role cannot read cases, or the read failed.
  openCases: {
    count: number;
    items: Array<ResourceSecurityCaseJson>;
  } | null;
  // The highest risk among its identities, when any has some.
  risk: {
    score: number;
    entityValue: string;
    entityType: string;
  } | null;
}
