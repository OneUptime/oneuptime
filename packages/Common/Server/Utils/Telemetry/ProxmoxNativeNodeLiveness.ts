import GlobalCache from "../../Infrastructure/GlobalCache";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * ------------------------------------------------------------------
 * Proxmox VE native push — which nodes have stopped reporting
 * ------------------------------------------------------------------
 *
 * With Proxmox VE's built-in OpenTelemetry push every node reports only
 * itself, so a node that dies simply goes quiet: nothing ever says
 * pve_up = 0 for it, and the Node Offline / Cluster Quorum at Risk
 * templates could not fire. (The Proxmox Agent does not have this gap —
 * pve-exporter asks the cluster about every node.)
 *
 * The nodes that are still alive know better, so they speak for the
 * silent ones: when a live node's own status push is ingested, it also
 * carries a "not reporting" report for every sibling that has gone
 * quiet (ProxmoxNativePush.appendProxmoxSiblingReportsInPlace). This
 * module decides WHICH siblings are silent, and whether this push may
 * report at all.
 *
 * Liveness lives in Redis, one key per (project, cluster, node), written
 * on every node-status push and expiring SILENCE_MS after the last one:
 * "streakStartMs,lastPushMs" on OneUptime's own receive clock — never the
 * node's clock, which can be skewed.
 *
 * A sibling Y is silent, from reporter P's point of view, only when BOTH
 *   - Y's key is gone: OneUptime has processed no status push from Y for
 *     SILENCE_MS, and
 *   - Y's last inventory sighting is older than P's own push time minus
 *     SILENCE_MS (both on the PVE clocks, which corosync keeps close).
 *     This keeps a node that something else still reports — the agent,
 *     in a cluster someone runs both ways — from being called silent,
 *     and turns clock skew into a later report rather than a false one.
 *
 * False alarms this is built to avoid:
 *   - A OneUptime ingest outage or backlog: every key expires, and the
 *     first node processed afterwards would see all its siblings as
 *     silent. A reporter must therefore have pushed CONTINUOUSLY (no gap
 *     over STREAK_GAP_MS) for at least SILENCE_MS, by which time every
 *     sibling that is alive has a key again.
 *   - A whole cluster going dark (power, network, the metric server
 *     removed): nobody is left to report, so nobody is paged per node —
 *     the cluster turns Disconnected instead, exactly as when the agent
 *     dies. A standalone host is the same case.
 *   - Redis trouble: any error means no report (fail closed).
 * ------------------------------------------------------------------
 */

// A node is silent after this long without a processed status push.
export const PROXMOX_NODE_SILENCE_MS: number = 120_000;

/*
 * A reporter's push streak restarts when two of its pushes are further
 * apart than this. pvestatd pushes every ~10 s; a gap of a minute means
 * the pushes (or OneUptime's processing of them) were interrupted.
 */
export const PROXMOX_NODE_STREAK_GAP_MS: number = 60_000;

const LIVENESS_NAMESPACE: string = "proxmox-native-node-live";

// How long an ingest worker reuses a cluster's node roster.
const ROSTER_CACHE_TTL_MS: number = 30_000;

export interface ProxmoxNodeLiveness {
  streakStartMs: number;
  lastPushMs: number;
}

// One Node row of the cluster inventory.
export interface ProxmoxRosterNode {
  nodeName: string; // `node/<name>` without the prefix
  lastSeenAt: Date; // the node's own last push, on its clock
}

export interface ProxmoxSilentNodeDecision {
  silentNodes: Array<string>; // node names, sorted
  // Nodes (including the reporter) currently eligible to report.
  reporterCount: number;
}

/*
 * What one ingest batch reported for a cluster, for the inventory flush:
 * the silent nodes, and the report's own time minus the silence window
 * (a node row refreshed after that is never marked down).
 */
export interface ProxmoxSilentNodeReport {
  nodeNames: Set<string>;
  silentBefore: Date;
}

export function parseProxmoxNodeLiveness(
  value: string | null | undefined,
): ProxmoxNodeLiveness | null {
  if (!value) {
    return null;
  }
  const [startRaw, lastRaw] = value.split(",");
  const streakStartMs: number = Number(startRaw);
  const lastPushMs: number = Number(lastRaw);
  if (
    !Number.isFinite(streakStartMs) ||
    !Number.isFinite(lastPushMs) ||
    streakStartMs > lastPushMs
  ) {
    return null;
  }
  return { streakStartMs, lastPushMs };
}

export function serializeProxmoxNodeLiveness(
  liveness: ProxmoxNodeLiveness,
): string {
  return `${liveness.streakStartMs},${liveness.lastPushMs}`;
}

/*
 * The liveness after a push processed at nowMs. The streak survives
 * only if the previous push was recent enough; a push processed out of
 * order (older than the last one) never moves lastPushMs back.
 */
export function nextProxmoxNodeLiveness(
  previous: ProxmoxNodeLiveness | null,
  nowMs: number,
): ProxmoxNodeLiveness {
  if (!previous || nowMs - previous.lastPushMs > PROXMOX_NODE_STREAK_GAP_MS) {
    return { streakStartMs: nowMs, lastPushMs: nowMs };
  }
  return {
    streakStartMs: previous.streakStartMs,
    lastPushMs: Math.max(previous.lastPushMs, nowMs),
  };
}

function isAlive(liveness: ProxmoxNodeLiveness | null, nowMs: number): boolean {
  return Boolean(
    liveness && nowMs - liveness.lastPushMs <= PROXMOX_NODE_SILENCE_MS,
  );
}

// Alive AND has pushed continuously for at least the silence window.
export function isEligibleProxmoxReporter(
  liveness: ProxmoxNodeLiveness | null,
  nowMs: number,
): boolean {
  return Boolean(
    liveness &&
      isAlive(liveness, nowMs) &&
      nowMs - liveness.streakStartMs >= PROXMOX_NODE_SILENCE_MS,
  );
}

/*
 * Which siblings the reporter should report as not reporting, or null
 * when it should report nothing. Pure — every input is explicit.
 */
export function decideProxmoxSilentNodes(data: {
  selfNode: string;
  // The reporter's own push time, on its own clock.
  reporterTimeMs: number;
  // OneUptime's receive clock.
  nowMs: number;
  roster: Array<ProxmoxRosterNode>;
  liveness: Map<string, ProxmoxNodeLiveness | null>;
}): ProxmoxSilentNodeDecision | null {
  const selfLiveness: ProxmoxNodeLiveness | null =
    data.liveness.get(data.selfNode) || null;
  if (!isEligibleProxmoxReporter(selfLiveness, data.nowMs)) {
    return null;
  }

  const nodes: Map<string, ProxmoxRosterNode | null> = new Map();
  for (const node of data.roster) {
    nodes.set(node.nodeName, node);
  }
  if (!nodes.has(data.selfNode)) {
    // The reporter's own first row may not be in the inventory yet.
    nodes.set(data.selfNode, null);
  }
  // A standalone host has nobody to speak for it.
  if (nodes.size < 2) {
    return null;
  }

  const silentBeforeMs: number = data.reporterTimeMs - PROXMOX_NODE_SILENCE_MS;
  const silentNodes: Array<string> = [];
  let reporterCount: number = 0;

  for (const [nodeName, rosterNode] of nodes) {
    const liveness: ProxmoxNodeLiveness | null =
      data.liveness.get(nodeName) || null;
    if (isEligibleProxmoxReporter(liveness, data.nowMs)) {
      reporterCount++;
    }
    if (
      nodeName !== data.selfNode &&
      !isAlive(liveness, data.nowMs) &&
      rosterNode &&
      rosterNode.lastSeenAt.getTime() < silentBeforeMs
    ) {
      silentNodes.push(nodeName);
    }
  }

  if (silentNodes.length === 0 || reporterCount === 0) {
    return null;
  }

  silentNodes.sort();
  return { silentNodes, reporterCount };
}

export function isProxmoxSilentNodeDetectionEnabled(): boolean {
  const raw: string | undefined =
    process.env["PVE_NATIVE_NODE_SILENCE_DETECTION"];
  return !raw || raw.trim().toLowerCase() !== "false";
}

type RosterLoader = (data: {
  projectId: ObjectID;
  proxmoxClusterId: ObjectID;
}) => Promise<Array<ProxmoxRosterNode>>;

const rosterCache: InMemoryTTLCache<Array<ProxmoxRosterNode>> =
  new InMemoryTTLCache<Array<ProxmoxRosterNode>>(5_000);

function livenessKey(
  projectId: ObjectID,
  proxmoxClusterId: ObjectID,
  nodeName: string,
): string {
  return `${projectId.toString()}:${proxmoxClusterId.toString()}:${nodeName}`;
}

/*
 * Record this node-status push and decide which siblings it reports.
 * Never throws: any failure reports nothing, and the push itself is
 * ingested as usual.
 */
export async function recordProxmoxNodePushAndFindSilentNodes(data: {
  projectId: ObjectID;
  proxmoxClusterId: ObjectID;
  selfNode: string;
  reporterTimeMs: number;
  loadRoster: RosterLoader;
  nowMs?: number | undefined;
}): Promise<ProxmoxSilentNodeDecision | null> {
  const nowMs: number = data.nowMs ?? Date.now();
  try {
    const selfKey: string = livenessKey(
      data.projectId,
      data.proxmoxClusterId,
      data.selfNode,
    );
    const previous: ProxmoxNodeLiveness | null = parseProxmoxNodeLiveness(
      await GlobalCache.getString(LIVENESS_NAMESPACE, selfKey),
    );
    /*
     * GET-then-SET: two workers processing this node's pushes at once can
     * both miss the key and both start a streak. That only ever moves the
     * streak start later — the conservative direction.
     */
    const current: ProxmoxNodeLiveness = nextProxmoxNodeLiveness(
      previous,
      nowMs,
    );
    await GlobalCache.setString(
      LIVENESS_NAMESPACE,
      selfKey,
      serializeProxmoxNodeLiveness(current),
      { expiresInSeconds: Math.ceil(PROXMOX_NODE_SILENCE_MS / 1000) },
    );

    // Not a reporter yet: skip the roster and sibling reads entirely.
    if (!isEligibleProxmoxReporter(current, nowMs)) {
      return null;
    }

    const rosterKey: string = `${data.projectId.toString()}:${data.proxmoxClusterId.toString()}`;
    let roster: Array<ProxmoxRosterNode> | undefined =
      rosterCache.get(rosterKey);
    if (!roster) {
      roster = await data.loadRoster({
        projectId: data.projectId,
        proxmoxClusterId: data.proxmoxClusterId,
      });
      rosterCache.set(rosterKey, roster, ROSTER_CACHE_TTL_MS);
    }

    const siblings: Array<string> = roster
      .map((node: ProxmoxRosterNode) => {
        return node.nodeName;
      })
      .filter((nodeName: string) => {
        return nodeName !== data.selfNode;
      });
    if (siblings.length === 0) {
      return null;
    }

    const values: Array<string | null> = await GlobalCache.getStrings(
      LIVENESS_NAMESPACE,
      siblings.map((nodeName: string) => {
        return livenessKey(data.projectId, data.proxmoxClusterId, nodeName);
      }),
    );

    const liveness: Map<string, ProxmoxNodeLiveness | null> = new Map();
    liveness.set(data.selfNode, current);
    siblings.forEach((nodeName: string, index: number) => {
      liveness.set(nodeName, parseProxmoxNodeLiveness(values[index]));
    });

    return decideProxmoxSilentNodes({
      selfNode: data.selfNode,
      reporterTimeMs: data.reporterTimeMs,
      nowMs,
      roster,
      liveness,
    });
  } catch (err) {
    logger.warn(
      `Proxmox node liveness check failed for cluster ${data.proxmoxClusterId.toString()} (no silent-node report this push): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// Test seam: drop cached rosters.
export function clearProxmoxNodeRosterCache(): void {
  rosterCache.clear();
}
