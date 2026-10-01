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
 * Who reports: every live node, but only once the cluster has an
 * ESTABLISHED node — one that has pushed CONTINUOUSLY (no gap over
 * STREAK_GAP_MS) for at least SILENCE_MS. After a OneUptime ingest outage
 * or backlog every key has expired, and the first node processed
 * afterwards would see all its siblings as silent; by the time any node
 * is established, every sibling that is alive has a key again. Having
 * every live node report (not just the established ones) keeps Quorum at
 * Risk at L ÷ (L + D): each report carries D ÷ L of weight, where L counts
 * every node not being reported (a node is presumed live until it is
 * reported), so however many pushes each live node lands in a minute the
 * silent nodes weigh as much as live ones. A push that carries no report
 * — a Redis error fails closed — lifts its minute above that.
 *
 * The established gate guards a node's FIRST report only. A node already
 * reported down — Offline in the inventory, and marked within the
 * monitors' window (MONITOR_WINDOW_MS) — keeps being reported by every
 * live node even while none is established: after a OneUptime restart or
 * a Redis failover that lost the keys, or a lone survivor's own gap or
 * bursty processing. Otherwise the pushes in those two minutes would be
 * stored with no report, their minutes would read 100 % up, and Node
 * Offline and Quorum at Risk would resolve only to page again minutes
 * later. The mark is its own column, notReportingMarkedAt, written only
 * by ProxmoxResourceService.markNodesNotReporting on the ingest worker's
 * clock (refreshed at most once a minute while the node stays reported)
 * and cleared by the node's own next push — so it survives the loss of
 * Redis, the continuing reports keep it fresh, and nothing else (an agent
 * scrape, an adoption, a database clock) can pass for it. Its age is
 * taken at the moment the roster was read, so every push served one
 * cached roster decides alike. After a longer silence of the whole
 * cluster — an outage beyond the monitors' window — the window holds
 * nothing from before and the incidents have already resolved, so there
 * is no continuity to keep, and a node that came back during the outage
 * must not be reported until its own first push is processed: its first
 * report waits for an established node again.
 *
 * False alarms this is built to avoid:
 *   - A OneUptime ingest outage or backlog — see "Who reports" above.
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
 * The rolling window of the Node Offline and Cluster Quorum at Risk
 * templates. Reports of nodes already Offline continue through a gap only
 * while they were marked within it (see the header).
 */
export const PROXMOX_MONITOR_WINDOW_MS: number = 5 * 60_000;

/*
 * A reporter's push streak restarts when two of its pushes are further
 * apart than this. pvestatd pushes every ~10 s; a gap of a minute means
 * the pushes (or OneUptime's processing of them) were interrupted.
 */
export const PROXMOX_NODE_STREAK_GAP_MS: number = 60_000;

const LIVENESS_NAMESPACE: string = "proxmox-native-node-live";

// How long an ingest worker reuses a cluster's node roster.
export const PROXMOX_ROSTER_CACHE_TTL_MS: number = 30_000;

export interface ProxmoxNodeLiveness {
  streakStartMs: number;
  lastPushMs: number;
}

// One Node row of the cluster inventory.
export interface ProxmoxRosterNode {
  nodeName: string; // `node/<name>` without the prefix
  lastSeenAt: Date; // the node's own last push, on its clock
  /*
   * The row's Online/Offline state: false once the node has been reported
   * as not reporting (ProxmoxResourceService.markNodesNotReporting), until
   * its own next push. Optional for callers that do not track it.
   */
  isUp?: boolean | null | undefined;
  /*
   * When the live nodes last reported this node as not reporting — written
   * on the ingest worker's clock by markNodesNotReporting (refreshed at most
   * once a minute while they keep reporting it), cleared by its own next
   * push. Null for a node never reported down.
   */
  notReportingMarkedAt?: Date | null | undefined;
}

export interface ProxmoxSilentNodeDecision {
  silentNodes: Array<string>; // node names, sorted
  /*
   * L: the nodes not being reported (the reporter included) — each is
   * presumed live and pushes this same report.
   */
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
  // Number("") is 0 — an empty field must not read as the epoch.
  if (!startRaw || !lastRaw || !startRaw.trim() || !lastRaw.trim()) {
    return null;
  }
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

// A status push from this node was processed within the silence window.
export function isAliveProxmoxNode(
  liveness: ProxmoxNodeLiveness | null,
  nowMs: number,
): boolean {
  return Boolean(
    liveness && nowMs - liveness.lastPushMs <= PROXMOX_NODE_SILENCE_MS,
  );
}

/*
 * Established: has pushed continuously for at least the silence window,
 * and the streak is still unbroken now — its last push is at most
 * STREAK_GAP_MS old. The cluster reports silent nodes only while at least
 * one node is established. The second condition matters right after a
 * OneUptime outage a little shorter than the silence window: a key
 * written before the outage is still alive, but that node's streak is
 * already broken (its next push will restart it), so it must not vouch
 * for the siblings whose keys expired a moment earlier.
 */
export function isEligibleProxmoxReporter(
  liveness: ProxmoxNodeLiveness | null,
  nowMs: number,
): boolean {
  return Boolean(
    liveness &&
      nowMs - liveness.lastPushMs <= PROXMOX_NODE_STREAK_GAP_MS &&
      nowMs - liveness.streakStartMs >= PROXMOX_NODE_SILENCE_MS,
  );
}

/*
 * Which siblings the reporter should report as not reporting, or null
 * when it should report nothing. Pure — every input is explicit.
 *
 * Silent: not the reporter, not alive, and last seen more than the
 * silence window before the reporter's own push. With an established
 * node in the cluster every silent node is reported; without one, only
 * those already Offline in the inventory and marked within the monitors'
 * window of the time the roster was read (see the header).
 */
export function decideProxmoxSilentNodes(data: {
  selfNode: string;
  // The reporter's own push time, on its own clock.
  reporterTimeMs: number;
  // OneUptime's receive clock.
  nowMs: number;
  roster: Array<ProxmoxRosterNode>;
  liveness: Map<string, ProxmoxNodeLiveness | null>;
  /*
   * When the roster was read (OneUptime's clock); the marks' age is taken
   * then. nowMs when omitted.
   */
  rosterReadAtMs?: number | undefined;
}): ProxmoxSilentNodeDecision | null {
  const selfLiveness: ProxmoxNodeLiveness | null =
    data.liveness.get(data.selfNode) || null;
  if (!isAliveProxmoxNode(selfLiveness, data.nowMs)) {
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
  let established: boolean = false;

  for (const [nodeName, rosterNode] of nodes) {
    const liveness: ProxmoxNodeLiveness | null =
      data.liveness.get(nodeName) || null;
    if (isEligibleProxmoxReporter(liveness, data.nowMs)) {
      established = true;
    }
    if (
      nodeName !== data.selfNode &&
      !isAliveProxmoxNode(liveness, data.nowMs) &&
      rosterNode &&
      rosterNode.lastSeenAt.getTime() < silentBeforeMs
    ) {
      silentNodes.push(nodeName);
    }
  }

  let reported: Array<string> = silentNodes;
  if (!established) {
    const rosterReadAtMs: number = data.rosterReadAtMs ?? data.nowMs;
    reported = silentNodes.filter((nodeName: string) => {
      const rosterNode: ProxmoxRosterNode | null | undefined =
        nodes.get(nodeName);
      return Boolean(
        rosterNode &&
          rosterNode.isUp === false &&
          rosterNode.notReportingMarkedAt &&
          rosterReadAtMs - rosterNode.notReportingMarkedAt.getTime() <=
            PROXMOX_MONITOR_WINDOW_MS,
      );
    });
  }

  if (reported.length === 0) {
    return null;
  }

  reported.sort();
  /*
   * Every node not reported is presumed live and reports too — including
   * a live sibling whose first push after a gap is not processed yet (it
   * has no key, but is not reported either). Counting only the nodes with
   * a key would hand the first node back all of the silent nodes' weight.
   */
  return {
    silentNodes: reported,
    reporterCount: nodes.size - reported.length,
  };
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

const rosterCache: InMemoryTTLCache<{
  roster: Array<ProxmoxRosterNode>;
  readAtMs: number;
}> = new InMemoryTTLCache<{
  roster: Array<ProxmoxRosterNode>;
  readAtMs: number;
}>(5_000);

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

    const rosterKey: string = `${data.projectId.toString()}:${data.proxmoxClusterId.toString()}`;
    let cached:
      | { roster: Array<ProxmoxRosterNode>; readAtMs: number }
      | undefined = rosterCache.get(rosterKey);
    if (!cached) {
      cached = {
        roster: await data.loadRoster({
          projectId: data.projectId,
          proxmoxClusterId: data.proxmoxClusterId,
        }),
        readAtMs: nowMs,
      };
      rosterCache.set(rosterKey, cached, PROXMOX_ROSTER_CACHE_TTL_MS);
    }
    const roster: Array<ProxmoxRosterNode> = cached.roster;

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
      rosterReadAtMs: cached.readAtMs,
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
