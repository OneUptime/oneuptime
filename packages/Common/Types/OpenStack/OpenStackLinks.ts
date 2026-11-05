import { JSONObject, JSONValue } from "../JSON";

/*
 * WHAT IN THE REST OF ONEUPTIME IS WHICH PART OF A CLOUD.
 *
 * A pod is slow because its node's instance sits on a full hypervisor whose volumes sit on a
 * degraded Ceph pool. Each of those reports to OneUptime on its own, and these are the joins:
 * a host to the hypervisor or instance it is, a Kubernetes node to its instance, a service to
 * the host it runs on, and a Cinder pool to the Ceph cluster behind it.
 *
 * No link is made on a guess. A name that matches two parts links to neither, and each rule
 * here says what it takes for a match to be a fact. Pure, so ingest, the pages and an
 * investigation all draw the same line.
 */

export interface OpenStackPlacement {
  openStackCloudId: string;
  cloudName: string | null;
  // Which part of the cloud this is.
  kind: "instance" | "hypervisor";
  // The instance's UUID, or the hypervisor's own row's.
  externalId: string;
  name: string | null;
  regionName: string | null;
  availabilityZone: string | null;
  // The hypervisor it runs on, or this hypervisor. Null for an instance never placed.
  hypervisorName: string | null;
  hypervisorExternalId: string | null;
  // Whose it is, for an instance.
  openStackProjectId: string | null;
  openStackProjectName: string | null;
  status: string | null;
}

export interface OpenStackLinkedHost {
  id: string;
  name: string;
  // The hypervisor itself, as apart from a guest running on it.
  isHypervisor: boolean;
}

export interface OpenStackLinkedKubernetesNode {
  clusterId: string;
  clusterName: string;
  nodeName: string;
  instanceId: string;
}

export interface OpenStackLinkedService {
  id: string;
  name: string;
}

// An instance a hypervisor's failure takes with it, by the name people know it by.
export interface OpenStackLinkedInstance {
  id: string;
  name: string | null;
}

export interface OpenStackReachAcrossProducts {
  /*
   * The instances themselves: part of the cloud rather than beyond it, so they say nothing of
   * whether the reach is empty, but an alert has to be able to name them. Only a hypervisor
   * has a list of them, since an instance's reach is its own.
   */
  instanceCount?: number | undefined;
  instances?: Array<OpenStackLinkedInstance> | undefined;
  hostCount: number;
  // Each of these lists holds at most OPENSTACK_REACH_LIST_LIMIT of its kind.
  hosts: Array<OpenStackLinkedHost>;
  kubernetesNodeCount: number;
  kubernetesNodes: Array<OpenStackLinkedKubernetesNode>;
  // The clusters those nodes are in, which is who a failure names.
  kubernetesClusters: Array<{ id: string; name: string; nodeCount: number }>;
  serviceCount: number;
  services: Array<OpenStackLinkedService>;
}

export const OPENSTACK_REACH_LIST_LIMIT: number = 50;

// How many places a service's page names before it stops. Its Topology has the rest.
export const OPENSTACK_SERVICE_PLACEMENT_LIMIT: number = 10;

// Which machine a service's placement was reached through: a host, or a Kubernetes node.
export interface OpenStackServicePlacement {
  hostName: string;
  hostId: string | null;
  kubernetesClusterId: string | null;
  placement: OpenStackPlacement;
}

export function getEmptyOpenStackReachAcrossProducts(): OpenStackReachAcrossProducts {
  return {
    hostCount: 0,
    hosts: [],
    kubernetesNodeCount: 0,
    kubernetesNodes: [],
    kubernetesClusters: [],
    serviceCount: 0,
    services: [],
  };
}

export function isOpenStackReachEmpty(
  reach: OpenStackReachAcrossProducts | null | undefined,
): boolean {
  return (
    !reach ||
    (reach.hostCount === 0 &&
      reach.kubernetesNodeCount === 0 &&
      reach.serviceCount === 0)
  );
}

/*
 * The one thing that matched, or nothing. Two matches are two guesses, and an operator who
 * walked a wrong link at night would have been better off with none.
 */
export function getOnlyOpenStackMatch<T>(matches: ReadonlyArray<T>): T | null {
  return matches.length === 1 ? (matches[0] as T) : null;
}

// With a loop rather than a pattern: a name comes from whatever an agent chose to report.
function isOpenStackAddress(name: string): boolean {
  if (name.includes(":")) {
    return true;
  }
  for (let index: number = 0; index < name.length; index++) {
    const character: string = name.charAt(index);
    if (character !== "." && (character < "0" || character > "9")) {
      return false;
    }
  }
  return true;
}

// What DNS allows, so that anything longer is not the name of a machine at all.
const OPENSTACK_HOST_NAME_MAX_LENGTH: number = 255;

/*
 * Names every machine can answer to, whatever it is. An agent that reports one of these has
 * not said which machine it is on, and neither has a hypervisor.
 */
const NAMES_OF_NO_MACHINE_IN_PARTICULAR: ReadonlySet<string> = new Set<string>([
  "localhost",
  "localhost.localdomain",
  "localhost6",
  "localhost6.localdomain6",
  "ip6-localhost",
  "ip6-loopback",
]);

function toOpenStackHostName(name: string | null | undefined): string {
  const lower: string = (name || "").trim().toLowerCase();
  return lower.length > OPENSTACK_HOST_NAME_MAX_LENGTH ||
    NAMES_OF_NO_MACHINE_IN_PARTICULAR.has(lower)
    ? ""
    : lower;
}

/*
 * Whether a host's name and a hypervisor's name are one machine. Nova keeps a host's full
 * name or its short one, and so does a machine's agent, so a short name matches a long one
 * whose first part it is. Two full names in different domains are two machines, however
 * alike they start, and an address is only ever itself. Whether that one machine is the only
 * thing either name could be is a separate question: see getOnlyOpenStackMatch.
 */
export function isOpenStackHostNameMatch(
  hostName: string | null | undefined,
  hypervisorName: string | null | undefined,
): boolean {
  const first: string = toOpenStackHostName(hostName);
  const second: string = toOpenStackHostName(hypervisorName);
  if (!first || !second) {
    return false;
  }
  if (first === second) {
    return true;
  }
  if (isOpenStackAddress(first) || isOpenStackAddress(second)) {
    return false;
  }
  if (first.includes(".") === second.includes(".")) {
    return false;
  }
  return first.includes(".")
    ? first.startsWith(`${second}.`)
    : second.startsWith(`${first}.`);
}

/*
 * What isOpenStackHostNameMatch accepts for a name, as something a database can be asked: the
 * names it can equal, and the short name any of whose domains it can have. A read has to ask
 * exactly this. Asking for more and filtering after a LIMIT could cut one of two real
 * matches, and what is left would look like the only one.
 */
export interface OpenStackHostNameForms {
  // Lowercase, and each one a name in its own right.
  names: Array<string>;
  // Lowercase, when any `<this>.<domain>` matches too.
  anyDomainOf: string | null;
}

export function getOpenStackHostNameForms(
  name: string | null | undefined,
): OpenStackHostNameForms {
  const lower: string = toOpenStackHostName(name);
  if (!lower) {
    return { names: [], anyDomainOf: null };
  }
  if (isOpenStackAddress(lower)) {
    return { names: [lower], anyDomainOf: null };
  }
  const dot: number = lower.indexOf(".");
  if (dot < 0) {
    return { names: [lower], anyDomainOf: lower };
  }
  const short: string = lower.substring(0, dot);
  return { names: short ? [lower, short] : [lower], anyDomainOf: null };
}

/*
 * ---------------------------------------------------------------------------
 * A Cinder pool, and the Ceph cluster behind it
 * ---------------------------------------------------------------------------
 *
 * What each source really says about a pool:
 *
 *   The agent's exporter: its name (`host@backend#backend`), its backend's name and its
 *   vendor, which reads "Open Source" for LVM and for RBD alike. Nothing says it is on Ceph.
 *
 *   A probe at the Full view level, the only level Cinder shows pools to: all that, and the
 *   driver's own capabilities. RBD reports `storage_protocol` as ceph, and `location_info` as
 *   `<cluster>:<conf>:<fsid>:<user>:<pool>`, which names the Ceph cluster by its fsid and the
 *   Ceph pool by its name. That is a fact, when a Ceph cluster here says the same fsid.
 *
 * So a fsid links on its own. Anything less is a suggestion an operator confirms once, and
 * what they answered is kept on the pool's row: a pool's name matching a Ceph pool in one
 * cluster, or nothing at all, in which case they can still choose.
 */

export const OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT: string = "cephLink";

export interface OpenStackRbdLocation {
  clusterName: string | null;
  fsid: string | null;
  poolName: string | null;
}

export function isOpenStackRbdProtocol(
  protocol: string | null | undefined,
): boolean {
  const value: string = (protocol || "").trim().toLowerCase();
  return value === "ceph" || value === "rbd";
}

// What Cinder's RBD driver writes, or nothing for what any other driver does.
export function parseOpenStackRbdLocation(
  locationInfo: string | null | undefined,
): OpenStackRbdLocation | null {
  const parts: Array<string> = (locationInfo || "").split(":");
  if (parts.length !== 5) {
    return null;
  }
  const clusterName: string = (parts[0] || "").trim();
  const fsid: string = (parts[2] || "").trim().toLowerCase();
  const poolName: string = (parts[4] || "").trim();
  const fsidFormat: RegExp =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!fsidFormat.test(fsid)) {
    return null;
  }
  return {
    clusterName: clusterName || null,
    fsid,
    poolName: poolName || null,
  };
}

export interface OpenStackCephClusterCandidate {
  id: string;
  name: string;
  fsid: string | null;
  // Its Ceph pools' names, from the Ceph product's inventory.
  poolNames: ReadonlyArray<string>;
}

export interface OpenStackStoragePoolCephChoice {
  /*
   * What an operator answered, or null when nobody has. A cluster's ID, or "none" for
   * "this pool isn't on Ceph", so it stops asking.
   */
  cephClusterId: string | null;
  isNotCeph: boolean;
  confirmedAt: string | null;
}

export function getOpenStackStoragePoolCephChoice(
  facts: JSONObject | null | undefined,
): OpenStackStoragePoolCephChoice | null {
  const link: JSONValue | undefined =
    facts?.[OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT];
  if (!link || typeof link !== "object" || Array.isArray(link)) {
    return null;
  }
  const value: JSONObject = link as JSONObject;
  const cephClusterId: JSONValue | undefined = value["cephClusterId"];
  const confirmedAt: JSONValue | undefined = value["confirmedAt"];
  return {
    cephClusterId: typeof cephClusterId === "string" ? cephClusterId : null,
    isNotCeph: value["isNotCeph"] === true,
    confirmedAt: typeof confirmedAt === "string" ? confirmedAt : null,
  };
}

export type OpenStackStoragePoolCephLinkState =
  // Someone chose it, or Cinder named the cluster's fsid and that cluster is here.
  | "confirmed"
  | "from-fsid"
  // A name points at one cluster, and someone has to say so before it counts.
  | "suggested"
  // Someone said this pool isn't on Ceph.
  | "not-ceph"
  // Nothing says, and there are clusters to choose from.
  | "unknown"
  // Nothing to link it to: this project has no Ceph clusters.
  | "no-clusters";

export interface OpenStackStoragePoolCephLink {
  state: OpenStackStoragePoolCephLinkState;
  clusterId: string | null;
  clusterName: string | null;
  // The Ceph pool, when something says which one it is.
  cephPoolName: string | null;
}

// The Ceph pool a Cinder pool may be, from what it is called: `host@backend#pool`.
export function getOpenStackPoolNameCandidates(data: {
  poolName: string | null | undefined;
  facts: JSONObject | null | undefined;
}): Array<string> {
  const names: Array<string> = [];
  const add: (name: unknown) => void = (name: unknown): void => {
    if (
      typeof name === "string" &&
      name.trim() &&
      !names.includes(name.trim())
    ) {
      names.push(name.trim());
    }
  };
  add(data.facts?.["cephPool"]);
  const poolName: string = data.poolName || "";
  add(
    poolName.includes("#") ? poolName.substring(poolName.indexOf("#") + 1) : "",
  );
  add(data.facts?.["backend"]);
  return names;
}

// Another Cinder pool in the project, which could answer to the same Ceph pool's name.
export interface OpenStackStoragePoolOfProject {
  poolName: string | null | undefined;
  facts: JSONObject | null | undefined;
}

/*
 * What can be said about a pool and Ceph. The operator's answer wins, then what the driver
 * says, and a name is only ever a suggestion, and only when it points one way from both ends:
 * most clusters have a pool called `volumes`, so a name two clusters hold is no answer, and
 * most clouds have a Cinder pool called `volumes`, so neither is a name two Cinder pools hold.
 */
export function getOpenStackStoragePoolCephLink(data: {
  poolName: string | null | undefined;
  facts: JSONObject | null | undefined;
  clusters: ReadonlyArray<OpenStackCephClusterCandidate>;
  otherPools?: ReadonlyArray<OpenStackStoragePoolOfProject> | undefined;
}): OpenStackStoragePoolCephLink {
  const clusterById: (
    id: string | null,
  ) => OpenStackCephClusterCandidate | null = (
    id: string | null,
  ): OpenStackCephClusterCandidate | null => {
    return (
      data.clusters.find((cluster: OpenStackCephClusterCandidate): boolean => {
        return cluster.id === id;
      }) || null
    );
  };
  const cephPoolFact: unknown = data.facts?.["cephPool"];
  const cephPool: string | null =
    typeof cephPoolFact === "string" && cephPoolFact ? cephPoolFact : null;

  const choice: OpenStackStoragePoolCephChoice | null =
    getOpenStackStoragePoolCephChoice(data.facts);
  if (choice?.isNotCeph) {
    return {
      state: "not-ceph",
      clusterId: null,
      clusterName: null,
      cephPoolName: null,
    };
  }
  // A cluster that has since been deleted is no answer: it asks again.
  const chosen: OpenStackCephClusterCandidate | null = clusterById(
    choice?.cephClusterId || null,
  );
  if (chosen) {
    return {
      state: "confirmed",
      clusterId: chosen.id,
      clusterName: chosen.name,
      cephPoolName:
        cephPool ||
        getOnlyOpenStackMatch(
          getOpenStackPoolNameCandidates(data).filter(
            (name: string): boolean => {
              return chosen.poolNames.includes(name);
            },
          ),
        ),
    };
  }

  const fsidFact: unknown = data.facts?.["cephFsid"];
  const fsid: string =
    typeof fsidFact === "string" ? fsidFact.trim().toLowerCase() : "";
  if (fsid) {
    const byFsid: OpenStackCephClusterCandidate | null = getOnlyOpenStackMatch(
      data.clusters.filter(
        (cluster: OpenStackCephClusterCandidate): boolean => {
          return (cluster.fsid || "").trim().toLowerCase() === fsid;
        },
      ),
    );
    if (byFsid) {
      return {
        state: "from-fsid",
        clusterId: byFsid.id,
        clusterName: byFsid.name,
        cephPoolName: cephPool,
      };
    }
  }

  if (data.clusters.length === 0) {
    return {
      state: "no-clusters",
      clusterId: null,
      clusterName: null,
      cephPoolName: null,
    };
  }

  const names: Array<string> = getOpenStackPoolNameCandidates(data);
  const byName: Array<{
    cluster: OpenStackCephClusterCandidate;
    pool: string;
  }> = [];
  for (const cluster of data.clusters) {
    const pool: string | undefined = names.find((name: string): boolean => {
      return cluster.poolNames.includes(name);
    });
    if (pool) {
      byName.push({ cluster, pool });
    }
  }
  const only: { cluster: OpenStackCephClusterCandidate; pool: string } | null =
    getOnlyOpenStackMatch(byName);
  const isClaimedByAnotherPool: boolean = Boolean(
    only &&
      (data.otherPools || []).some(
        (other: OpenStackStoragePoolOfProject): boolean => {
          return getOpenStackPoolNameCandidates(other).includes(only.pool);
        },
      ),
  );
  if (only && !isClaimedByAnotherPool) {
    return {
      state: "suggested",
      clusterId: only.cluster.id,
      clusterName: only.cluster.name,
      cephPoolName: only.pool,
    };
  }

  return {
    state: "unknown",
    clusterId: null,
    clusterName: null,
    cephPoolName: null,
  };
}

export function isOpenStackStoragePoolCephLinked(
  link: OpenStackStoragePoolCephLink,
): boolean {
  return link.state === "confirmed" || link.state === "from-fsid";
}

/*
 * The Ceph cluster's own trouble, as a Cinder pool's: what Needs attention reads. The read
 * puts this on the pool's row at read time, because it is the Ceph cluster's to know and
 * it changes without the pool being read again.
 */
export interface OpenStackCephStatusFact {
  clusterId: string;
  clusterName: string;
  // Ceph's own: 0 is HEALTH_OK, 1 is HEALTH_WARN and 2 is HEALTH_ERR.
  healthStatus: number | null;
}

export const OPENSTACK_CEPH_STATUS_FACT: string = "cephStatus";

/*
 * How long a Ceph cluster's own word counts for: the Ceph product's own line for a reading that
 * is no reading (CEPH_READINGS_STALE_MS). Its agent reports every 30 seconds, so a cluster whose
 * agent stopped says nothing about now, and its last HEALTH_ERR must not page anyone for good.
 */
export const OPENSTACK_CEPH_HEALTH_FRESH_MINUTES: number = 15;

export function getOpenStackCephHealthNow(data: {
  healthStatus: number | null | undefined;
  lastSeenAt: Date | string | null | undefined;
  now: Date;
}): number | null {
  if (
    data.healthStatus === null ||
    data.healthStatus === undefined ||
    !data.lastSeenAt
  ) {
    return null;
  }
  const seenAt: number = new Date(data.lastSeenAt).getTime();
  return !isNaN(seenAt) &&
    data.now.getTime() - seenAt <=
      OPENSTACK_CEPH_HEALTH_FRESH_MINUTES * 60 * 1000
    ? data.healthStatus
    : null;
}

export function getOpenStackCephStatusFact(
  facts: JSONObject | null | undefined,
): OpenStackCephStatusFact | null {
  const value: JSONValue | undefined = facts?.[OPENSTACK_CEPH_STATUS_FACT];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const status: JSONObject = value as JSONObject;
  if (
    typeof status["clusterId"] !== "string" ||
    typeof status["clusterName"] !== "string"
  ) {
    return null;
  }
  return {
    clusterId: status["clusterId"],
    clusterName: status["clusterName"],
    healthStatus:
      typeof status["healthStatus"] === "number"
        ? status["healthStatus"]
        : null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * In words, for what is read outside the Dashboard: an alert, and OneUptime AI
 * ---------------------------------------------------------------------------
 */

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function describeOpenStackReachAcrossProducts(
  reach: OpenStackReachAcrossProducts,
): string {
  const parts: Array<string> = [];
  if (reach.hostCount > 0) {
    parts.push(countOf(reach.hostCount, "host", "hosts"));
  }
  if (reach.kubernetesNodeCount > 0) {
    parts.push(
      `${countOf(reach.kubernetesNodeCount, "Kubernetes node", "Kubernetes nodes")} in ${countOf(reach.kubernetesClusters.length, "cluster", "clusters")}`,
    );
  }
  if (reach.serviceCount > 0) {
    parts.push(countOf(reach.serviceCount, "service", "services"));
  }
  return parts.join(", ");
}
