import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import {
  PROXMOX_MONITOR_WINDOW_MS,
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
  PROXMOX_ROSTER_CACHE_TTL_MS,
  ProxmoxNodeLiveness,
  ProxmoxRosterNode,
  ProxmoxSilentNodeDecision,
  clearProxmoxNodeRosterCache,
  decideProxmoxSilentNodes,
  isAliveProxmoxNode,
  isEligibleProxmoxReporter,
  isProxmoxSilentNodeDetectionEnabled,
  nextProxmoxNodeLiveness,
  parseProxmoxNodeLiveness,
  recordProxmoxNodePushAndFindSilentNodes,
  serializeProxmoxNodeLiveness,
} from "../../../../Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Proxmox VE native push — which nodes have stopped reporting.
 *
 * With the built-in OpenTelemetry push every node reports only itself, so
 * a node that dies just goes quiet. The live nodes speak for it: a sibling
 * is reported as not reporting only when BOTH its liveness key is gone
 * (OneUptime processed no status push from it for 2 minutes) AND its last
 * inventory sighting is older than the reporter's own push minus 2
 * minutes. Every live node reports, each report carrying D ÷ L of the silent
 * nodes' weight, where L (reporterCount) counts every node of the roster
 * (plus the reporter) that is NOT reported: a node is presumed live until
 * it is reported, so a live sibling whose first push after a gap is not
 * processed yet still counts, and Quorum at Risk reads L ÷ (L + D) from the
 * very first push. Reports are made only while the cluster has an
 * ESTABLISHED node — one that has pushed
 * continuously for 2 minutes and whose streak is still unbroken now (its
 * last push at most 1 minute old). That is the post-outage guard: after an
 * ingest outage every streak restarts, and by the time any node is
 * established again every live sibling has a key. A key written before an
 * outage a little shorter than 2 minutes is still alive, but its streak is
 * already broken, so it no longer vouches for the cluster.
 *
 * The established gate guards a node's FIRST report only. A silent node
 * already Offline in the inventory (roster isUp === false: reported before,
 * marked by markNodesNotReporting, silent since) AND marked within the
 * monitors' window (roster notReportingMarkedAt at most
 * PROXMOX_MONITOR_WINDOW_MS = 300 s old, R: taken at the moment the roster
 * was read — rosterReadAtMs, on the ingest worker's clock) keeps being
 * reported by every live node while none is established — after a
 * OneUptime restart, a queue stall, a Redis failover, or a lone survivor's
 * own gap over 60 s — so those pushes never read the node as up, and Node
 * Offline / Quorum at Risk do not resolve only to page again. A newly
 * silent node (Online, or its state unknown) still waits for an
 * established node. Continuation cannot report a live node: a live node's
 * row is never Offline, and a node that was Offline and is back sets its
 * own key with its first processed push, which makes it not silent.
 *
 * The mark is durable, per node, and its own column (Q):
 * notReportingMarkedAt lives in Postgres, is written ONLY by
 * markNodesNotReporting — on the worker's own clock (markedAt, never the
 * database's now()), and rewritten at most once a minute while the live
 * nodes keep reporting the node, continuation reports included — and is
 * cleared by the node's own next sighting (bulkUpsert). Nothing else
 * writes it: not an adoption into the native-push keep, and not the
 * database's own writes, which stamp updatedAt with its now() (a database
 * clock running ahead made an agent-era Offline row's updatedAt look
 * "recent" — updatedAt is no longer read at all). So the reports keep
 * their own mark fresh through bursts, a lone survivor's gaps, or a Redis
 * flush. No Redis key is involved: a push reads its own liveness key,
 * writes it, and reads its siblings', and nothing else.
 *
 * R: a worker caches a cluster's roster for 30 s together with the time it
 * read it, and judges every mark's age at that read — so every push served
 * one cached roster decides alike, and a roster read with a mark inside
 * the window continues it for the cache's whole life: no push near the
 * window's edge drops the report between two that carry it. Only once the
 * whole cluster has been silent to OneUptime for longer than the window (a
 * long outage) do the marks age out: nothing is continued then — a node
 * that came back during the outage is not reported before its own first
 * push is processed — and every report waits for an established node
 * again.
 *
 * Every false alarm this can raise pages someone per node, so most of the
 * tests below are about when it must stay QUIET: the first push, an
 * ingest outage or a Redis flush (every key vanishes at once), clock skew,
 * a node the Proxmox Agent still reports, a whole cluster or a standalone
 * host going dark, and Redis or the database failing. The timeline tests
 * at the end drive the real module through a simulated cluster on a
 * simulated clock, with an in-memory Redis that honours the key TTL.
 *
 * Everything external is faked — no Redis, no Postgres.
 */

const NOW_MS: number = 1_700_000_000_000;
const PUSH_INTERVAL_MS: number = 10_000;
const LIVENESS_NAMESPACE: string = "proxmox-native-node-live";

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();

type RosterLoaderFn = (data: {
  projectId: ObjectID;
  proxmoxClusterId: ObjectID;
}) => Promise<Array<ProxmoxRosterNode>>;

type RosterLoaderMock = ReturnType<typeof jest.fn<RosterLoaderFn>>;

function liveness(
  streakStartMs: number,
  lastPushMs: number,
): ProxmoxNodeLiveness {
  return { streakStartMs, lastPushMs };
}

// Has pushed continuously for 10 minutes, the last push just now.
function eligibleAt(nowMs: number): ProxmoxNodeLiveness {
  return liveness(nowMs - 600_000, nowMs);
}

/*
 * One inventory Node row. isUp is the row's Online/Offline state and
 * markedAtMs its notReportingMarkedAt (Q): when markNodesNotReporting last
 * marked it, on the ingest worker's clock. Left out, the row carries
 * neither (a caller that does not track them); a null markedAtMs is a row
 * never marked, or whose mark its own sighting cleared.
 */
function rosterNode(
  nodeName: string,
  lastSeenMs: number,
  isUp?: boolean | null | undefined,
  markedAtMs?: number | null | undefined,
): ProxmoxRosterNode {
  const node: ProxmoxRosterNode = {
    nodeName,
    lastSeenAt: new Date(lastSeenMs),
  };
  if (isUp !== undefined) {
    node.isUp = isUp;
  }
  if (markedAtMs !== undefined) {
    node.notReportingMarkedAt =
      markedAtMs === null ? null : new Date(markedAtMs);
  }
  return node;
}

/*
 * When most rows below were last marked: 30 s before NOW, well inside the
 * monitors' 300 s window — the live nodes keep reporting them, and
 * markNodesNotReporting rewrites the mark at most once a minute.
 */
const RECENT_MARK_MS: number = NOW_MS - 30_000;

/*
 * A row already reported and marked Offline (markNodesNotReporting), last
 * marked at markedAtMs.
 */
function offlineNode(
  nodeName: string,
  lastSeenMs: number,
  markedAtMs: number = RECENT_MARK_MS,
): ProxmoxRosterNode {
  return rosterNode(nodeName, lastSeenMs, false, markedAtMs);
}

interface RowState {
  title: string;
  isUp: boolean | null | undefined;
}

// Every roster state that is NOT Offline: a newly silent node.
const NOT_OFFLINE_STATES: Array<RowState> = [
  { title: "Online", isUp: true },
  { title: "state unknown (null)", isUp: null },
  { title: "state not tracked (left out)", isUp: undefined },
];

function livenessMap(
  entries: Record<string, ProxmoxNodeLiveness | null>,
): Map<string, ProxmoxNodeLiveness | null> {
  return new Map<string, ProxmoxNodeLiveness | null>(Object.entries(entries));
}

/*
 * rosterReadAtMs is passed through only when given, so a decision without
 * it is made exactly as a caller that leaves it out (R: nowMs then).
 */
function decide(data: {
  roster: Array<ProxmoxRosterNode>;
  liveness: Map<string, ProxmoxNodeLiveness | null>;
  selfNode?: string | undefined;
  reporterTimeMs?: number | undefined;
  nowMs?: number | undefined;
  rosterReadAtMs?: number | undefined;
}): ProxmoxSilentNodeDecision | null {
  const input: Parameters<typeof decideProxmoxSilentNodes>[0] = {
    selfNode: data.selfNode ?? "pve1",
    reporterTimeMs: data.reporterTimeMs ?? NOW_MS,
    nowMs: data.nowMs ?? NOW_MS,
    roster: data.roster,
    liveness: data.liveness,
  };
  if (data.rosterReadAtMs !== undefined) {
    input.rosterReadAtMs = data.rosterReadAtMs;
  }
  return decideProxmoxSilentNodes(input);
}

// The nodes of a decision's cluster: the roster's distinct names plus the reporter.
function clusterSize(
  roster: Array<ProxmoxRosterNode>,
  selfNode: string,
): number {
  return new Set<string>([
    ...roster.map((node: ProxmoxRosterNode) => {
      return node.nodeName;
    }),
    selfNode,
  ]).size;
}

describe("ProxmoxNativeNodeLiveness constants", () => {
  /*
   * The detection latency, the Redis key TTL and the reporter warm-up all
   * derive from these. Node Offline fires on "pve_up < 1 on every minute
   * bucket of the last 5 minutes" — widening the silence window pushes the
   * page later, narrowing it below a few push intervals pages on a single
   * delayed push.
   */
  test("a node is silent after 2 minutes; a gap over 1 minute restarts a streak", () => {
    expect(PROXMOX_NODE_SILENCE_MS).toBe(120_000);
    expect(PROXMOX_NODE_STREAK_GAP_MS).toBe(60_000);
    expect(PROXMOX_NODE_STREAK_GAP_MS).toBeLessThan(PROXMOX_NODE_SILENCE_MS);
  });

  /*
   * The continuation window is the Node Offline / Quorum at Risk
   * templates' rolling window — 5 minutes — measured from an Offline row's
   * last mark (notReportingMarkedAt, Q) to the moment the roster holding
   * it was read (R). While the node is reported that mark is rewritten at
   * most once a minute, so steady reports read it at most ~70 s old; the
   * window must leave room past that (and past a roster cache's life) for
   * a gap in the reports as long as a liveness key's TTL, or continuation
   * could not bridge a lone survivor going quiet for up to 2 minutes.
   */
  test("the monitors' window is 5 minutes", () => {
    expect(PROXMOX_MONITOR_WINDOW_MS).toBe(300_000);
    expect(PROXMOX_MONITOR_WINDOW_MS).toBeGreaterThanOrEqual(
      2 * PROXMOX_NODE_SILENCE_MS,
    );
    expect(PROXMOX_MONITOR_WINDOW_MS).toBeGreaterThan(
      60_000 + PROXMOX_ROSTER_CACHE_TTL_MS + PROXMOX_NODE_SILENCE_MS,
    );
  });

  /*
   * R: a worker decides on a roster it cached up to 30 s earlier, and
   * judges the marks in it at the moment it read them — so the cache adds
   * no slack to the window (O's 330 s continuation window is gone): a
   * roster read with a mark at most 300 s old continues it for all of its
   * 30 s, and one read later continues nothing.
   */
  test("the roster cache lives 30 s, and adds nothing to the window: there is no separate continuation window", () => {
    expect(PROXMOX_ROSTER_CACHE_TTL_MS).toBe(30_000);
    const exported: Record<string, unknown> = jest.requireActual(
      "../../../../Server/Utils/Telemetry/ProxmoxNativeNodeLiveness",
    ) as Record<string, unknown>;
    expect(exported["PROXMOX_MONITOR_WINDOW_MS"]).toBe(300_000);
    expect(exported["PROXMOX_ROSTER_CACHE_TTL_MS"]).toBe(30_000);
    expect(Object.keys(exported)).not.toContain(
      "PROXMOX_CONTINUATION_WINDOW_MS",
    );
    // The cache is short against a liveness key's TTL and the refresh.
    expect(PROXMOX_ROSTER_CACHE_TTL_MS).toBeLessThan(PROXMOX_NODE_SILENCE_MS);
    expect(PROXMOX_ROSTER_CACHE_TTL_MS).toBeLessThan(60_000);
  });
});

describe("parseProxmoxNodeLiveness / serializeProxmoxNodeLiveness", () => {
  test("serializes as 'streakStartMs,lastPushMs'", () => {
    expect(
      serializeProxmoxNodeLiveness(liveness(NOW_MS - 30_000, NOW_MS)),
    ).toBe(`${NOW_MS - 30_000},${NOW_MS}`);
  });

  test("round-trips through serialize and parse", () => {
    const values: Array<ProxmoxNodeLiveness> = [
      liveness(NOW_MS, NOW_MS),
      liveness(NOW_MS - 600_000, NOW_MS),
      liveness(0, 0),
      liveness(1, 2),
      liveness(NOW_MS - 1, NOW_MS + 1),
    ];
    for (const value of values) {
      expect(
        parseProxmoxNodeLiveness(serializeProxmoxNodeLiveness(value)),
      ).toEqual(value);
    }
  });

  test("a missing key reads as no liveness", () => {
    expect(parseProxmoxNodeLiveness(null)).toBeNull();
    expect(parseProxmoxNodeLiveness(undefined)).toBeNull();
    expect(parseProxmoxNodeLiveness("")).toBeNull();
  });

  test("garbage reads as no liveness, never as a live node", () => {
    const garbage: Array<string> = [
      "garbage",
      " ",
      "abc,def",
      "1",
      `${NOW_MS}`,
      `${NOW_MS},`,
      `${NOW_MS},abc`,
      `abc,${NOW_MS}`,
      "{}",
      '{"streakStartMs":1,"lastPushMs":2}',
      `${NOW_MS};${NOW_MS}`,
    ];
    for (const value of garbage) {
      expect(parseProxmoxNodeLiveness(value)).toBeNull();
    }
  });

  test("NaN and infinite values read as no liveness", () => {
    const nonFinite: Array<string> = [
      `NaN,${NOW_MS}`,
      `${NOW_MS},NaN`,
      "NaN,NaN",
      `Infinity,${NOW_MS}`,
      `${NOW_MS},Infinity`,
      `-Infinity,${NOW_MS}`,
      `${NOW_MS},-Infinity`,
    ];
    for (const value of nonFinite) {
      expect(parseProxmoxNodeLiveness(value)).toBeNull();
    }
  });

  test("an inverted pair (streak starting after the last push) reads as no liveness", () => {
    expect(parseProxmoxNodeLiveness(`${NOW_MS},${NOW_MS - 1}`)).toBeNull();
    expect(parseProxmoxNodeLiveness("200,100")).toBeNull();
  });

  test("a streak that started with the last push is valid", () => {
    expect(parseProxmoxNodeLiveness(`${NOW_MS},${NOW_MS}`)).toEqual(
      liveness(NOW_MS, NOW_MS),
    );
  });

  /*
   * An empty field is not a timestamp. Number("") is 0, so without an
   * explicit check ",<now>" parses as a streak that started at the epoch —
   * an immediately ESTABLISHED node, which lets every live node of the
   * cluster report without the 2-minute warm-up that keeps an ingest
   * outage from paging every node; nextProxmoxNodeLiveness then carries
   * that epoch streak forward on every push.
   */
  test("an empty field reads as no liveness, never as the epoch", () => {
    const emptyFields: Array<string> = [
      ",",
      " , ",
      `,${NOW_MS}`,
      ` ,${NOW_MS}`,
      `${NOW_MS},`,
      `${NOW_MS}, `,
    ];
    for (const value of emptyFields) {
      expect(parseProxmoxNodeLiveness(value)).toBeNull();
    }
  });
});

describe("nextProxmoxNodeLiveness", () => {
  test("the first push starts a streak", () => {
    expect(nextProxmoxNodeLiveness(null, NOW_MS)).toEqual(
      liveness(NOW_MS, NOW_MS),
    );
  });

  test("a push inside the gap continues the streak", () => {
    const previous: ProxmoxNodeLiveness = liveness(
      NOW_MS - 50_000,
      NOW_MS - PUSH_INTERVAL_MS,
    );
    expect(nextProxmoxNodeLiveness(previous, NOW_MS)).toEqual(
      liveness(NOW_MS - 50_000, NOW_MS),
    );
  });

  test("a gap of exactly 60 s still continues the streak", () => {
    const previous: ProxmoxNodeLiveness = liveness(
      NOW_MS - 300_000,
      NOW_MS - PROXMOX_NODE_STREAK_GAP_MS,
    );
    expect(nextProxmoxNodeLiveness(previous, NOW_MS)).toEqual(
      liveness(NOW_MS - 300_000, NOW_MS),
    );
  });

  test("a gap of 60 s + 1 ms restarts the streak", () => {
    const previous: ProxmoxNodeLiveness = liveness(
      NOW_MS - 300_000,
      NOW_MS - PROXMOX_NODE_STREAK_GAP_MS - 1,
    );
    expect(nextProxmoxNodeLiveness(previous, NOW_MS)).toEqual(
      liveness(NOW_MS, NOW_MS),
    );
  });

  test("a push after the key's own silence window restarts the streak", () => {
    const previous: ProxmoxNodeLiveness = liveness(
      NOW_MS - 3_600_000,
      NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
    );
    expect(nextProxmoxNodeLiveness(previous, NOW_MS)).toEqual(
      liveness(NOW_MS, NOW_MS),
    );
  });

  test("an out-of-order older push never moves lastPushMs back", () => {
    const previous: ProxmoxNodeLiveness = liveness(NOW_MS - 300_000, NOW_MS);
    expect(nextProxmoxNodeLiveness(previous, NOW_MS - 5_000)).toEqual(previous);
    // Even one far older than the gap: it neither rewinds nor restarts.
    expect(nextProxmoxNodeLiveness(previous, NOW_MS - 600_000)).toEqual(
      previous,
    );
  });

  test("the same push processed twice is idempotent", () => {
    const previous: ProxmoxNodeLiveness = liveness(NOW_MS - 300_000, NOW_MS);
    expect(nextProxmoxNodeLiveness(previous, NOW_MS)).toEqual(previous);
  });

  test("never mutates the previous liveness", () => {
    const previous: ProxmoxNodeLiveness = liveness(
      NOW_MS - 300_000,
      NOW_MS - PUSH_INTERVAL_MS,
    );
    nextProxmoxNodeLiveness(previous, NOW_MS);
    nextProxmoxNodeLiveness(previous, NOW_MS + 3_600_000);
    expect(previous).toEqual(
      liveness(NOW_MS - 300_000, NOW_MS - PUSH_INTERVAL_MS),
    );
  });

  test("a steady 10 s push keeps the streak's start through many pushes", () => {
    let current: ProxmoxNodeLiveness | null = null;
    for (let push: number = 0; push <= 60; push++) {
      current = nextProxmoxNodeLiveness(
        current,
        NOW_MS + push * PUSH_INTERVAL_MS,
      );
    }
    expect(current).toEqual(liveness(NOW_MS, NOW_MS + 600_000));
  });
});

/*
 * Alive: a status push from the node was processed within the silence
 * window. Every alive node reports (once the cluster has an established
 * node) and counts in reporterCount; a node that is not alive is the only
 * kind that can be called silent.
 */
describe("isAliveProxmoxNode", () => {
  test("no liveness is never alive", () => {
    expect(isAliveProxmoxNode(null, NOW_MS)).toBe(false);
  });

  test("the first push is alive, though not established", () => {
    const firstPush: ProxmoxNodeLiveness = liveness(NOW_MS, NOW_MS);
    expect(isAliveProxmoxNode(firstPush, NOW_MS)).toBe(true);
    expect(isEligibleProxmoxReporter(firstPush, NOW_MS)).toBe(false);
  });

  test("still alive exactly 120 s after the last push", () => {
    expect(
      isAliveProxmoxNode(
        liveness(
          NOW_MS - PROXMOX_NODE_SILENCE_MS,
          NOW_MS - PROXMOX_NODE_SILENCE_MS,
        ),
        NOW_MS,
      ),
    ).toBe(true);
  });

  test("no longer alive 120 s + 1 ms after the last push", () => {
    expect(
      isAliveProxmoxNode(
        liveness(
          NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
          NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
        ),
        NOW_MS,
      ),
    ).toBe(false);
  });

  test("depends only on the last push, never on the streak's length", () => {
    // A long streak does not keep a quiet node alive…
    expect(
      isAliveProxmoxNode(
        liveness(NOW_MS - 3_600_000, NOW_MS - PROXMOX_NODE_SILENCE_MS - 1),
        NOW_MS,
      ),
    ).toBe(false);
    // …and a streak restarted after a gap does not make a pushing node dead.
    expect(
      isAliveProxmoxNode(
        liveness(NOW_MS - PUSH_INTERVAL_MS, NOW_MS - PUSH_INTERVAL_MS),
        NOW_MS,
      ),
    ).toBe(true);
  });

  // Another worker's clock ahead of this one: never read as silent.
  test("a last push dated ahead of this worker's clock is alive", () => {
    expect(
      isAliveProxmoxNode(liveness(NOW_MS + 5_000, NOW_MS + 5_000), NOW_MS),
    ).toBe(true);
  });

  test("every established node is alive", () => {
    const samples: Array<ProxmoxNodeLiveness> = [
      liveness(NOW_MS - PROXMOX_NODE_SILENCE_MS, NOW_MS),
      liveness(NOW_MS - 600_000, NOW_MS - PROXMOX_NODE_STREAK_GAP_MS),
      liveness(NOW_MS - 600_000, NOW_MS - PROXMOX_NODE_STREAK_GAP_MS - 1),
      liveness(NOW_MS - 600_000, NOW_MS - PROXMOX_NODE_SILENCE_MS),
      liveness(NOW_MS - 600_000, NOW_MS - PROXMOX_NODE_SILENCE_MS - 1),
      liveness(NOW_MS - 30_000, NOW_MS),
      liveness(NOW_MS, NOW_MS),
    ];
    for (const sample of samples) {
      if (isEligibleProxmoxReporter(sample, NOW_MS)) {
        expect(isAliveProxmoxNode(sample, NOW_MS)).toBe(true);
      }
    }
    // Not vacuous: some samples are established, some alive but not.
    expect(
      samples.filter((sample: ProxmoxNodeLiveness) => {
        return isEligibleProxmoxReporter(sample, NOW_MS);
      }).length,
    ).toBeGreaterThan(0);
    expect(
      samples.filter((sample: ProxmoxNodeLiveness) => {
        return (
          isAliveProxmoxNode(sample, NOW_MS) &&
          !isEligibleProxmoxReporter(sample, NOW_MS)
        );
      }).length,
    ).toBeGreaterThan(0);
  });
});

/*
 * Established: has pushed continuously for the silence window (2 minutes,
 * measured to now) AND the streak is still unbroken now — the last push is
 * at most STREAK_GAP_MS (1 minute) old. A key 1–2 minutes old is still
 * alive (counted as live, never silent), but that node's streak is already
 * broken — its next push will restart it — so it no longer establishes the
 * cluster. Without that, a key written just before a OneUptime outage a
 * little shorter than 2 minutes vouched for the cluster right after it, and
 * the first node back reported the live siblings whose keys had just
 * expired.
 */
describe("isEligibleProxmoxReporter", () => {
  test("no liveness is never eligible", () => {
    expect(isEligibleProxmoxReporter(null, NOW_MS)).toBe(false);
  });

  test("the first push is not eligible", () => {
    expect(isEligibleProxmoxReporter(liveness(NOW_MS, NOW_MS), NOW_MS)).toBe(
      false,
    );
  });

  test("a streak of exactly 120 s is eligible", () => {
    expect(
      isEligibleProxmoxReporter(
        liveness(NOW_MS - PROXMOX_NODE_SILENCE_MS, NOW_MS),
        NOW_MS,
      ),
    ).toBe(true);
  });

  test("a streak of 119.999 s is not eligible", () => {
    expect(
      isEligibleProxmoxReporter(
        liveness(NOW_MS - PROXMOX_NODE_SILENCE_MS + 1, NOW_MS),
        NOW_MS,
      ),
    ).toBe(false);
  });

  test("still established exactly 60 s after the last push", () => {
    expect(
      isEligibleProxmoxReporter(
        liveness(NOW_MS - 600_000, NOW_MS - PROXMOX_NODE_STREAK_GAP_MS),
        NOW_MS,
      ),
    ).toBe(true);
  });

  test("no longer established 60 s + 1 ms after the last push, however long the streak", () => {
    expect(
      isEligibleProxmoxReporter(
        liveness(NOW_MS - 3_600_000, NOW_MS - PROXMOX_NODE_STREAK_GAP_MS - 1),
        NOW_MS,
      ),
    ).toBe(false);
  });

  /*
   * Was "still alive exactly 120 s after the last push" → eligible. The
   * node is still alive then, but its streak broke a minute ago.
   */
  test("not established exactly 120 s after the last push, though still alive", () => {
    const twoMinutesQuiet: ProxmoxNodeLiveness = liveness(
      NOW_MS - 600_000,
      NOW_MS - PROXMOX_NODE_SILENCE_MS,
    );
    expect(isEligibleProxmoxReporter(twoMinutesQuiet, NOW_MS)).toBe(false);
    expect(isAliveProxmoxNode(twoMinutesQuiet, NOW_MS)).toBe(true);
  });

  test("not established 120 s + 1 ms after the last push, however long the streak", () => {
    expect(
      isEligibleProxmoxReporter(
        liveness(NOW_MS - 3_600_000, NOW_MS - PROXMOX_NODE_SILENCE_MS - 1),
        NOW_MS,
      ),
    ).toBe(false);
  });

  /*
   * Between the two windows: alive (so never silent, and counted among
   * the live nodes) but not established, whatever the streak's length.
   */
  test("a last push 60–120 s old is alive but never established, however long the streak", () => {
    const agesMs: Array<number> = [
      PROXMOX_NODE_STREAK_GAP_MS + 1,
      61_000,
      90_000,
      115_000,
      119_999,
      PROXMOX_NODE_SILENCE_MS,
    ];
    const streaksMs: Array<number> = [
      PROXMOX_NODE_SILENCE_MS,
      600_000,
      86_400_000,
    ];
    for (const ageMs of agesMs) {
      for (const streakMs of streaksMs) {
        const sample: ProxmoxNodeLiveness = liveness(
          NOW_MS - ageMs - streakMs,
          NOW_MS - ageMs,
        );
        expect(isAliveProxmoxNode(sample, NOW_MS)).toBe(true);
        expect(isEligibleProxmoxReporter(sample, NOW_MS)).toBe(false);
      }
    }
    // The same streaks, pushed 60 s ago, are established: only the age differs.
    for (const streakMs of streaksMs) {
      expect(
        isEligibleProxmoxReporter(
          liveness(
            NOW_MS - PROXMOX_NODE_STREAK_GAP_MS - streakMs,
            NOW_MS - PROXMOX_NODE_STREAK_GAP_MS,
          ),
          NOW_MS,
        ),
      ).toBe(true);
    }
  });

  test("a streak dated in the future (a worker clock ahead) is not eligible yet", () => {
    expect(
      isEligibleProxmoxReporter(
        liveness(NOW_MS + 60_000, NOW_MS + 60_000),
        NOW_MS,
      ),
    ).toBe(false);
  });
});

describe("decideProxmoxSilentNodes", () => {
  const STALE_MS: number = NOW_MS - 180_000;

  test("a 3-node cluster with one dead node: the dead node is reported", () => {
    expect(
      decide({
        roster: [
          rosterNode("pve1", NOW_MS),
          rosterNode("pve2", NOW_MS - PUSH_INTERVAL_MS),
          rosterNode("pve3", STALE_MS),
        ],
        liveness: livenessMap({
          pve1: eligibleAt(NOW_MS),
          pve2: eligibleAt(NOW_MS - 3_000),
          pve3: null,
        }),
      }),
    ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
  });

  test("a sibling missing from the liveness map is treated as having no key", () => {
    expect(
      decide({
        roster: [rosterNode("pve1", NOW_MS), rosterNode("pve2", STALE_MS)],
        liveness: livenessMap({ pve1: eligibleAt(NOW_MS) }),
      }),
    ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
  });

  test("everyone alive: nothing to report", () => {
    expect(
      decide({
        roster: [
          rosterNode("pve1", NOW_MS),
          rosterNode("pve2", NOW_MS),
          rosterNode("pve3", NOW_MS),
        ],
        liveness: livenessMap({
          pve1: eligibleAt(NOW_MS),
          pve2: eligibleAt(NOW_MS),
          pve3: eligibleAt(NOW_MS),
        }),
      }),
    ).toBeNull();
  });

  /*
   * pve1 is the only node that can be established here (pve2 is dead), so
   * its own streak alone decides whether the cluster reports.
   */
  describe("a lone survivor reports only once it is established itself", () => {
    const roster: Array<ProxmoxRosterNode> = [
      rosterNode("pve1", NOW_MS),
      rosterNode("pve2", STALE_MS),
    ];

    test("no own liveness → null", () => {
      expect(
        decide({ roster, liveness: livenessMap({ pve2: null }) }),
      ).toBeNull();
      expect(
        decide({ roster, liveness: livenessMap({ pve1: null, pve2: null }) }),
      ).toBeNull();
    });

    test("own streak shorter than 2 minutes, nobody else established → null", () => {
      expect(
        decide({
          roster,
          liveness: livenessMap({
            pve1: liveness(NOW_MS - PROXMOX_NODE_SILENCE_MS + 1, NOW_MS),
            pve2: null,
          }),
        }),
      ).toBeNull();
    });

    test("own streak of exactly 2 minutes → reports", () => {
      expect(
        decide({
          roster,
          liveness: livenessMap({
            pve1: liveness(NOW_MS - PROXMOX_NODE_SILENCE_MS, NOW_MS),
            pve2: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    test("own liveness itself gone stale → null", () => {
      expect(
        decide({
          roster,
          liveness: livenessMap({
            pve1: liveness(
              NOW_MS - 600_000,
              NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
            ),
            pve2: null,
          }),
        }),
      ).toBeNull();
    });
  });

  /*
   * Who reports: every ALIVE node, as long as at least one node of the
   * cluster (itself or any sibling) is ESTABLISHED. reporterCount (L) is
   * the number of nodes of the cluster that are NOT reported — each is
   * presumed live and pushes the same report — so each report carries
   * D / L of the silent nodes' pve_node_info and Quorum at Risk reads
   * L / (L + D) however unevenly their pushes fall into minutes. With every
   * silent node reported (an established node), the nodes not reported
   * are exactly the ones that are alive or still sighted.
   */
  describe("every live node reports once the cluster has an established node", () => {
    test("a reporter still warming up reports when a sibling is established", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS),
            rosterNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: liveness(NOW_MS - PROXMOX_NODE_SILENCE_MS + 1, NOW_MS),
            pve2: eligibleAt(NOW_MS - 3_000),
            pve3: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    test("a reporter on its very first push reports when a sibling is established", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", STALE_MS), // back after a reboot
            rosterNode("pve2", NOW_MS),
            rosterNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: liveness(NOW_MS, NOW_MS),
            pve2: eligibleAt(NOW_MS),
            pve3: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    /*
     * The dead node's row is not Offline here (no isUp), so this would be
     * its FIRST report — see the continuation block below for a node
     * already Offline.
     */
    test("no node established → null, even with a silent sibling", () => {
      // Two live nodes still warming up, one dead.
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS),
            rosterNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: liveness(NOW_MS - PROXMOX_NODE_SILENCE_MS + 1, NOW_MS),
            pve2: liveness(NOW_MS - 30_000, NOW_MS - 5_000),
            pve3: null,
          }),
        }),
      ).toBeNull();
      // Every sibling silent, the reporter on its first push.
      expect(
        decide({
          roster: [
            rosterNode("pve1", STALE_MS),
            rosterNode("pve2", STALE_MS),
            rosterNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: liveness(NOW_MS, NOW_MS),
            pve2: null,
            pve3: null,
          }),
        }),
      ).toBeNull();
    });

    test("a sibling whose long streak has gone stale does not establish the cluster", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", STALE_MS),
            rosterNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: liveness(NOW_MS - 30_000, NOW_MS),
            pve2: liveness(
              NOW_MS - 3_600_000,
              NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
            ),
            pve3: null,
          }),
        }),
      ).toBeNull();
    });

    /*
     * pve1 is warming up, so pve2 — alive, with a fresh enough sighting to
     * never be silent itself — is the only node that could establish the
     * cluster. Its streak must be unbroken now: a last push exactly 60 s
     * old still establishes, 60 s + 1 ms no longer does, however long the
     * streak before it.
     */
    test("a sibling establishes the cluster only while its last push is at most 60 s old", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS),
        rosterNode("pve2", NOW_MS - PROXMOX_NODE_STREAK_GAP_MS - 1),
        rosterNode("pve3", STALE_MS),
      ];
      const warmingUp: ProxmoxNodeLiveness = liveness(NOW_MS - 30_000, NOW_MS);

      expect(
        decide({
          roster,
          liveness: livenessMap({
            pve1: warmingUp,
            pve2: liveness(
              NOW_MS - 3_600_000,
              NOW_MS - PROXMOX_NODE_STREAK_GAP_MS,
            ),
            pve3: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      expect(
        decide({
          roster,
          liveness: livenessMap({
            pve1: warmingUp,
            pve2: liveness(
              NOW_MS - 3_600_000,
              NOW_MS - PROXMOX_NODE_STREAK_GAP_MS - 1,
            ),
            pve3: null,
          }),
        }),
      ).toBeNull();
    });

    /*
     * A sibling whose last push is 60–120 s old (a long streak before it,
     * and a stale sighting): alive, so it is never silent and it counts
     * among the live nodes — but it does not establish the cluster.
     */
    test("a sibling quiet for 60–120 s counts as live and is never silent, but does not establish the cluster", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS),
        rosterNode("pve2", STALE_MS),
        rosterNode("pve3", STALE_MS),
      ];
      for (const quietMs of [
        PROXMOX_NODE_STREAK_GAP_MS + 1,
        90_000,
        PROXMOX_NODE_SILENCE_MS,
      ]) {
        const quietSibling: ProxmoxNodeLiveness = liveness(
          NOW_MS - 3_600_000,
          NOW_MS - quietMs,
        );
        // The reporter warming up: nobody is established.
        expect(
          decide({
            roster,
            liveness: livenessMap({
              pve1: liveness(NOW_MS - 30_000, NOW_MS),
              pve2: quietSibling,
              pve3: null,
            }),
          }),
        ).toBeNull();
        // The reporter established: pve2 counted, pve3 alone reported.
        expect(
          decide({
            roster,
            liveness: livenessMap({
              pve1: eligibleAt(NOW_MS),
              pve2: quietSibling,
              pve3: null,
            }),
          }),
        ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      }
    });

    test("the reporter itself not alive → null, even with an established sibling", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS),
            rosterNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: liveness(
              NOW_MS - 600_000,
              NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
            ),
            pve2: eligibleAt(NOW_MS),
            pve3: null,
          }),
        }),
      ).toBeNull();
    });

    test("an established reporter counts its siblings that are still warming up", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS),
            rosterNode("pve3", NOW_MS),
            rosterNode("pve4", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: liveness(NOW_MS - 30_000, NOW_MS - 2_000),
            pve3: liveness(NOW_MS - 5_000, NOW_MS - 5_000),
            pve4: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve4"], reporterCount: 3 });
    });

    /*
     * The same decision from every live node, established or not: each
     * report carries the same D / L, which is what keeps the minute's
     * Σ pve_up ÷ Σ pve_node_info at exactly L / (L + D).
     */
    test("every live node gets the same decision, established or not", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS),
        rosterNode("pve2", NOW_MS),
        rosterNode("pve3", NOW_MS),
        rosterNode("pve4", STALE_MS),
        rosterNode("pve5", STALE_MS),
      ];
      const map: Map<string, ProxmoxNodeLiveness | null> = livenessMap({
        pve1: eligibleAt(NOW_MS),
        pve2: liveness(NOW_MS - 60_000, NOW_MS),
        pve3: liveness(NOW_MS, NOW_MS),
        pve4: null,
        pve5: null,
      });
      for (const selfNode of ["pve1", "pve2", "pve3"]) {
        expect(decide({ roster, liveness: map, selfNode })).toEqual({
          silentNodes: ["pve4", "pve5"],
          reporterCount: 3,
        });
      }
    });

    test("a reporter missing from the roster counts as live, even while warming up", () => {
      expect(
        decide({
          roster: [rosterNode("pve2", NOW_MS), rosterNode("pve3", STALE_MS)],
          liveness: livenessMap({
            pve1: liveness(NOW_MS, NOW_MS),
            pve2: eligibleAt(NOW_MS),
            pve3: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    /*
     * Only the roster (plus the reporter) makes the cluster. A key for a
     * node the inventory does not list is neither counted nor able to
     * establish the cluster.
     */
    test("a node known only to the liveness map is neither counted nor establishing", () => {
      expect(
        decide({
          roster: [rosterNode("pve1", NOW_MS), rosterNode("pve2", STALE_MS)],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: null,
            pve9: eligibleAt(NOW_MS),
          }),
        }),
      ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      expect(
        decide({
          roster: [rosterNode("pve1", NOW_MS), rosterNode("pve2", STALE_MS)],
          liveness: livenessMap({
            pve1: liveness(NOW_MS - 30_000, NOW_MS),
            pve2: null,
            pve9: eligibleAt(NOW_MS),
          }),
        }),
      ).toBeNull();
    });
  });

  describe("a standalone host has nobody to speak for it", () => {
    test("a roster of only the reporter → null", () => {
      expect(
        decide({
          roster: [rosterNode("pve1", NOW_MS)],
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS) }),
        }),
      ).toBeNull();
    });

    test("an empty roster (the reporter's own row not written yet) → null", () => {
      expect(
        decide({
          roster: [],
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS) }),
        }),
      ).toBeNull();
    });

    test("siblings known only to the liveness map, not the roster, are never reported", () => {
      expect(
        decide({
          roster: [rosterNode("pve1", NOW_MS)],
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve9: null }),
        }),
      ).toBeNull();
    });
  });

  /*
   * Continuation. The established gate guards a node's FIRST report only:
   * a silent node already Offline in the inventory (roster isUp === false)
   * and marked within the monitor window is reported by every live node
   * while none is established — after a OneUptime restart or queue stall,
   * a Redis failover, or a lone survivor's own gap over 60 s. A newly
   * silent node — Online, or its state unknown — still waits for an
   * established node. Silent is unchanged: not the reporter, not alive,
   * and last seen more than 2 minutes before the reporter's own push.
   * reporterCount counts every node not reported (I) — the newly silent
   * nodes withheld here included: while nobody is established they may
   * just not have been processed yet, so they are presumed live. The
   * Offline rows here were marked 30 s ago (RECENT_MARK_MS, their
   * notReportingMarkedAt — Q); the window gate on the mark (R) has its own
   * block below.
   */
  describe("continuation: without an established node, only nodes already Offline are reported", () => {
    // pve1 reporting, warming up; pve2 alive, warming up — nobody established.
    const reporterWarmingUp: ProxmoxNodeLiveness = liveness(
      NOW_MS - 30_000,
      NOW_MS,
    );
    const siblingWarmingUp: ProxmoxNodeLiveness = liveness(
      NOW_MS - 60_000,
      NOW_MS - 4_000,
    );

    test("the fixtures establish nobody", () => {
      expect(isEligibleProxmoxReporter(reporterWarmingUp, NOW_MS)).toBe(false);
      expect(isEligibleProxmoxReporter(siblingWarmingUp, NOW_MS)).toBe(false);
      expect(isAliveProxmoxNode(reporterWarmingUp, NOW_MS)).toBe(true);
      expect(isAliveProxmoxNode(siblingWarmingUp, NOW_MS)).toBe(true);
    });

    test("a silent sibling already Offline is reported, by a reporter still warming up", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS, true),
            rosterNode("pve2", NOW_MS - 4_000, true),
            offlineNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: reporterWarmingUp,
            pve2: siblingWarmingUp,
            pve3: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    test.each(NOT_OFFLINE_STATES)(
      "a newly silent sibling ($title) waits for an established node",
      (state: RowState) => {
        const roster: Array<ProxmoxRosterNode> = [
          rosterNode("pve1", NOW_MS, true),
          rosterNode("pve2", NOW_MS - 4_000, true),
          rosterNode("pve3", STALE_MS, state.isUp),
        ];
        // Nobody established: not reported.
        expect(
          decide({
            roster,
            liveness: livenessMap({
              pve1: reporterWarmingUp,
              pve2: siblingWarmingUp,
              pve3: null,
            }),
          }),
        ).toBeNull();
        // The same row once a sibling is established: reported.
        expect(
          decide({
            roster,
            liveness: livenessMap({
              pve1: reporterWarmingUp,
              pve2: eligibleAt(NOW_MS - 4_000),
              pve3: null,
            }),
          }),
        ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      },
    );

    /*
     * Every sibling silent, the reporter on its very first push (e.g. the
     * first push processed after an ingest outage): only the Offline rows
     * are reported. The others are silent by the rule, but their report
     * would be a first report — they may just not have been processed yet.
     * So they are presumed live (I): L = 6 nodes − 2 reported = 4, not the
     * 1 node with a key — which would hand this first push back all of the
     * Offline nodes' weight (D ÷ 1) and read Quorum at Risk at 1 ÷ 3.
     */
    test("among several silent siblings, only the Offline ones are reported — every one once a node is established", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS, true),
        rosterNode("pve2", STALE_MS, true),
        offlineNode("pve3", STALE_MS),
        rosterNode("pve4", STALE_MS, null),
        rosterNode("pve5", STALE_MS),
        offlineNode("pve6", STALE_MS - 3_600_000),
      ];
      expect(
        decide({
          roster,
          liveness: livenessMap({ pve1: liveness(NOW_MS, NOW_MS) }),
        }),
      ).toEqual({ silentNodes: ["pve3", "pve6"], reporterCount: 4 });
      expect(
        decide({
          roster,
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS) }),
        }),
      ).toEqual({
        silentNodes: ["pve2", "pve3", "pve4", "pve5", "pve6"],
        reporterCount: 1,
      });
    });

    test("with an established node an Offline row is reported like any silent one", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS, true),
            rosterNode("pve2", NOW_MS, true),
            offlineNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: siblingWarmingUp,
            pve3: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    /*
     * Continuation never invents a failure: an Offline row is reported only
     * while its node is still silent. A node that is back sets its key with
     * its first processed push — alive, so not silent, whatever the
     * inventory (or a cached roster) still says.
     */
    describe("an Offline row is reported only while its node is still silent", () => {
      function decideOffline(data: {
        lastSeenMs: number;
        pve3: ProxmoxNodeLiveness | null;
        pve1?: ProxmoxNodeLiveness | undefined;
      }): ProxmoxSilentNodeDecision | null {
        return decide({
          roster: [
            rosterNode("pve1", NOW_MS, true),
            offlineNode("pve3", data.lastSeenMs),
          ],
          liveness: livenessMap({
            pve1: data.pve1 ?? reporterWarmingUp,
            pve3: data.pve3,
          }),
        });
      }

      test("back: its first push set its key → never reported, established or not", () => {
        const firstPushBack: ProxmoxNodeLiveness = liveness(
          NOW_MS - 3_000,
          NOW_MS - 3_000,
        );
        expect(
          decideOffline({ lastSeenMs: STALE_MS, pve3: firstPushBack }),
        ).toBeNull();
        expect(
          decideOffline({
            lastSeenMs: STALE_MS,
            pve3: firstPushBack,
            pve1: eligibleAt(NOW_MS),
          }),
        ).toBeNull();
      });

      test("a key 60–120 s old is still alive → not reported", () => {
        for (const quietMs of [
          PROXMOX_NODE_STREAK_GAP_MS + 1,
          90_000,
          PROXMOX_NODE_SILENCE_MS,
        ]) {
          expect(
            decideOffline({
              lastSeenMs: STALE_MS,
              pve3: liveness(NOW_MS - 600_000, NOW_MS - quietMs),
            }),
          ).toBeNull();
        }
      });

      test("a key still present but over 2 minutes old counts as gone → reported", () => {
        expect(
          decideOffline({
            lastSeenMs: STALE_MS,
            pve3: liveness(
              NOW_MS - 600_000,
              NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
            ),
          }),
        ).toEqual({ silentNodes: ["pve3"], reporterCount: 1 });
      });

      test("a sighting at the reporter's push minus 2 minutes → not yet; 1 ms older → reported", () => {
        expect(
          decideOffline({
            lastSeenMs: NOW_MS - PROXMOX_NODE_SILENCE_MS,
            pve3: null,
          }),
        ).toBeNull();
        expect(
          decideOffline({
            lastSeenMs: NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
            pve3: null,
          }),
        ).toEqual({ silentNodes: ["pve3"], reporterCount: 1 });
      });

      // Something else (the agent, in a cluster run both ways) still sights it.
      test("a fresh sighting → never reported, though Offline and without a key", () => {
        expect(
          decideOffline({ lastSeenMs: NOW_MS - 5_000, pve3: null }),
        ).toBeNull();
      });
    });

    test("the reporter must be alive itself", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS, true),
        rosterNode("pve2", NOW_MS - 4_000, true),
        offlineNode("pve3", STALE_MS),
      ];
      for (const own of [
        null,
        liveness(NOW_MS - 600_000, NOW_MS - PROXMOX_NODE_SILENCE_MS - 1),
      ]) {
        expect(
          decide({
            roster,
            liveness: livenessMap({
              pve1: own,
              pve2: siblingWarmingUp,
              pve3: null,
            }),
          }),
        ).toBeNull();
      }
    });

    // Just back after a reboot: its own row is still Offline and stale.
    test("never reports itself, though its own row is still Offline", () => {
      const roster: Array<ProxmoxRosterNode> = [
        offlineNode("pve1", STALE_MS),
        rosterNode("pve2", NOW_MS - 4_000, true),
      ];
      const map: Map<string, ProxmoxNodeLiveness | null> = livenessMap({
        pve1: liveness(NOW_MS, NOW_MS),
        pve2: siblingWarmingUp,
      });
      expect(decide({ roster, liveness: map })).toBeNull();
      expect(
        decide({
          roster: [...roster, offlineNode("pve3", STALE_MS)],
          liveness: map,
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    test("a standalone host has nobody to speak for it, Offline or not", () => {
      expect(
        decide({
          roster: [offlineNode("pve1", STALE_MS)],
          liveness: livenessMap({ pve1: liveness(NOW_MS, NOW_MS) }),
        }),
      ).toBeNull();
    });

    test("a reporter missing from the roster makes a two-node cluster with an Offline sibling", () => {
      expect(
        decide({
          roster: [offlineNode("pve2", STALE_MS)],
          liveness: livenessMap({ pve1: liveness(NOW_MS, NOW_MS), pve2: null }),
        }),
      ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    /*
     * L counts every node not reported (I): the reporter (even missing
     * from the roster), a node back from a reboot on its first push, a
     * node quiet for 60–120 s, AND pve6 — silent, but withheld because it
     * is not Offline, so presumed live (it may just not have been
     * processed yet). Not the reported pve4 / pve5, and not a key for a
     * node the roster does not list (which does not establish the cluster
     * either): 6 nodes − 2 reported = 4 (it was 3, the nodes with a key).
     */
    test("reporterCount counts every node not reported, the withheld newly silent one included, and nothing outside the roster", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve2", STALE_MS, true),
            rosterNode("pve3", STALE_MS, true),
            offlineNode("pve4", STALE_MS),
            offlineNode("pve5", STALE_MS),
            rosterNode("pve6", STALE_MS, true),
          ],
          liveness: livenessMap({
            pve1: reporterWarmingUp,
            pve2: liveness(NOW_MS - 3_600_000, NOW_MS - 90_000),
            pve3: liveness(NOW_MS - 2_000, NOW_MS - 2_000),
            pve4: null,
            pve5: liveness(
              NOW_MS - 900_000,
              NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
            ),
            pve6: null,
            pve9: eligibleAt(NOW_MS),
          }),
        }),
      ).toEqual({ silentNodes: ["pve4", "pve5"], reporterCount: 4 });
    });

    /*
     * The same decision from every live node: each report carries the same
     * D / L, so Quorum at Risk stays exact while nobody is established. L
     * is 6 − 2 = 4: pve6 (silent, Online, withheld) is presumed live (I).
     */
    test("every live node gets the same decision", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS, true),
        rosterNode("pve2", NOW_MS, true),
        rosterNode("pve3", NOW_MS - 90_000, true),
        offlineNode("pve4", STALE_MS),
        offlineNode("pve5", STALE_MS),
        rosterNode("pve6", STALE_MS, true),
      ];
      const map: Map<string, ProxmoxNodeLiveness | null> = livenessMap({
        pve1: reporterWarmingUp,
        pve2: liveness(NOW_MS, NOW_MS),
        pve3: liveness(NOW_MS - 3_600_000, NOW_MS - 90_000),
        pve4: null,
        pve5: null,
        pve6: null,
      });
      for (const selfNode of ["pve1", "pve2", "pve3"]) {
        expect(decide({ roster, liveness: map, selfNode })).toEqual({
          silentNodes: ["pve4", "pve5"],
          reporterCount: 4,
        });
      }
    });

    describe("clock skew still turns into a later report, never a false one", () => {
      // pve2 died 200 s ago and is Offline; nobody is established.
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS, true),
        offlineNode("pve2", NOW_MS - 200_000),
      ];

      test("reporter's clock 5 minutes behind → no report until its clock passes the sighting + 2 minutes", () => {
        const behindMs: number = 300_000;
        const catchUpNowMs: number =
          NOW_MS - 200_000 + PROXMOX_NODE_SILENCE_MS + behindMs + 1;
        expect(
          decide({
            roster,
            liveness: livenessMap({ pve1: reporterWarmingUp, pve2: null }),
            reporterTimeMs: NOW_MS - behindMs,
          }),
        ).toBeNull();
        expect(
          decide({
            roster,
            liveness: livenessMap({
              pve1: liveness(catchUpNowMs - 30_000, catchUpNowMs),
              pve2: null,
            }),
            nowMs: catchUpNowMs,
            reporterTimeMs: catchUpNowMs - behindMs,
          }),
        ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      });

      test("the Offline sibling's clock ahead → its report waits for the reporter's clock to pass it", () => {
        expect(
          decide({
            roster: [
              rosterNode("pve1", NOW_MS, true),
              offlineNode("pve2", NOW_MS - 200_000 + 300_000),
            ],
            liveness: livenessMap({ pve1: reporterWarmingUp, pve2: null }),
          }),
        ).toBeNull();
      });
    });

    test("reads isUp, never writes it: the roster is left as it was", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS, true),
        offlineNode("pve2", STALE_MS),
        rosterNode("pve3", STALE_MS, true),
        rosterNode("pve4", STALE_MS, null),
      ];
      const map: Map<string, ProxmoxNodeLiveness | null> = livenessMap({
        pve1: reporterWarmingUp,
      });
      const first: ProxmoxSilentNodeDecision | null = decide({
        roster,
        liveness: map,
      });
      // pve3 and pve4 are withheld (not Offline), so presumed live (I).
      expect(first).toEqual({ silentNodes: ["pve2"], reporterCount: 3 });
      expect(decide({ roster, liveness: map })).toEqual(first);
      expect(
        roster.map((node: ProxmoxRosterNode) => {
          return node.isUp;
        }),
      ).toEqual([true, false, true, null]);
    });
  });

  /*
   * I: reporterCount (L) is every node of the roster ∪ the reporter that
   * is NOT reported — nodes − D. A node is presumed live until it is
   * reported. Counting only the nodes with a live key undercounts L
   * whenever a live node's first push after a gap is not processed yet:
   * it has no key, but it is not reported either, and once processed it
   * pushes the very same report.
   */
  describe("reporterCount (L): every node not reported, presumed live until it is", () => {
    /*
     * The undercount a previous run measured. After a 3-minute OneUptime
     * outage (inside the monitor window: pve4's last mark, 200 s ago, was
     * written just before it) the first node back finds the
     * already-Offline pve4 silent, and its live siblings pve2 / pve3 not
     * processed yet (no key, sightings from before the outage — but
     * Online, so withheld). Counting the nodes with a key it reported pve4
     * with L = 1: each of its pushes carried D ÷ 1 of pve_node_info, the
     * minute read 1 ÷ 2 and Quorum at Risk (≤ 50 %) fired falsely. L is 3:
     * each push carries 1 ÷ 3 and the minute reads 3 ÷ 4 — however many of
     * the three are back yet.
     */
    test("the first node back after an outage counts the siblings not processed yet", () => {
      const lastMarkMs: number = NOW_MS - 200_000;
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS - 180_000, true),
        rosterNode("pve2", NOW_MS - 177_000, true),
        rosterNode("pve3", NOW_MS - 183_000, true),
        offlineNode("pve4", NOW_MS - 900_000, lastMarkMs),
      ];
      expect(
        decide({
          roster,
          liveness: livenessMap({
            pve1: liveness(NOW_MS, NOW_MS),
            pve2: null,
            pve3: null,
            pve4: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve4"], reporterCount: 3 });
      // pve2 back 3 s later: the same L, now with two keys.
      expect(
        decide({
          roster,
          selfNode: "pve2",
          nowMs: NOW_MS + 3_000,
          reporterTimeMs: NOW_MS + 3_000,
          liveness: livenessMap({
            pve1: liveness(NOW_MS, NOW_MS),
            pve2: liveness(NOW_MS + 3_000, NOW_MS + 3_000),
            pve3: null,
            pve4: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve4"], reporterCount: 3 });
      // Two Offline nodes: L = 5 − 2, D ÷ L = 2 ÷ 3 per push, 3 ÷ 5 a minute.
      expect(
        decide({
          roster: [
            ...roster,
            offlineNode("pve5", NOW_MS - 900_000, lastMarkMs),
          ],
          liveness: livenessMap({ pve1: liveness(NOW_MS, NOW_MS) }),
        }),
      ).toEqual({ silentNodes: ["pve4", "pve5"], reporterCount: 3 });
    });

    // Established: a sibling with no key but a fresh sighting is not silent.
    test("a sibling with no key but a fresh sighting is not reported, and counts", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS - 5_000),
            rosterNode("pve3", STALE_MS),
          ],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: null,
            pve3: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    test("a silent node withheld while nobody is established counts; once reported it does not", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS, true),
        rosterNode("pve2", STALE_MS, true),
        offlineNode("pve3", STALE_MS),
      ];
      expect(
        decide({
          roster,
          liveness: livenessMap({ pve1: liveness(NOW_MS - 30_000, NOW_MS) }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      expect(
        decide({
          roster,
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS) }),
        }),
      ).toEqual({ silentNodes: ["pve2", "pve3"], reporterCount: 1 });
    });

    /*
     * L + D is always the cluster's node count (the roster's distinct
     * names plus the reporter), whoever reports, whatever the keys,
     * sightings, row states, marks and roster read times — so every report
     * of one push round carries the same D ÷ L. And which nodes are
     * reported is exactly the rule: every silent node while a node is
     * established; otherwise only the silent ones Offline and marked
     * (notReportingMarkedAt, Q) at most 300 s before the roster was read
     * (R: rosterReadAtMs, nowMs when left out). Swept over pseudo-random
     * clusters (a fixed seed).
     */
    test("L + D is always the number of nodes, over a sweep of clusters", () => {
      let seed: number = 20_260_928;
      const next: (modulo: number) => number = (modulo: number): number => {
        seed = (seed * 16_807) % 2_147_483_647;
        return seed % modulo;
      };
      const livenessChoices: Array<ProxmoxNodeLiveness | null> = [
        null,
        liveness(NOW_MS - 30_000, NOW_MS - 2_000), // warming up
        eligibleAt(NOW_MS - 1_000), // established
        liveness(NOW_MS - 3_600_000, NOW_MS - 90_000), // alive, streak broken
        liveness(NOW_MS - 3_600_000, NOW_MS - PROXMOX_NODE_SILENCE_MS - 1), // gone
      ];
      const sightingChoices: Array<number> = [NOW_MS - 5_000, STALE_MS];
      const isUpChoices: Array<boolean | null | undefined> = [
        true,
        false,
        null,
        undefined,
      ];
      /*
       * The row's mark: none, recent, at the window's edge at nowMs, just
       * past it, O's old slack (past the window at nowMs, inside it only
       * for a roster read up to 30 s earlier), too old.
       */
      const markChoices: Array<number | null | undefined> = [
        undefined,
        null,
        RECENT_MARK_MS,
        NOW_MS - 120_000,
        NOW_MS - PROXMOX_MONITOR_WINDOW_MS,
        NOW_MS - PROXMOX_MONITOR_WINDOW_MS - 1,
        NOW_MS - PROXMOX_MONITOR_WINDOW_MS - 20_000,
        NOW_MS - 900_000,
      ];
      // When the roster was read: left out (nowMs), now, or up to 30 s before.
      const readAtChoices: Array<number | undefined> = [
        undefined,
        NOW_MS,
        NOW_MS - 10_000,
        NOW_MS - PROXMOX_ROSTER_CACHE_TTL_MS,
      ];

      let decisions: number = 0;
      let continuations: number = 0;
      let withheldForTheirMark: number = 0;
      // R: continued on a mark past the window at nowMs, within it at the read.
      let continuedOnTheRead: number = 0;
      let moreThanKeyed: number = 0;
      for (let run: number = 0; run < 1_200; run++) {
        const siblingCount: number = 1 + next(6);
        const roster: Array<ProxmoxRosterNode> = [];
        const map: Map<string, ProxmoxNodeLiveness | null> = new Map<
          string,
          ProxmoxNodeLiveness | null
        >();
        for (let index: number = 2; index <= siblingCount + 1; index++) {
          const nodeName: string = `pve${index}`;
          roster.push(
            rosterNode(
              nodeName,
              sightingChoices[next(sightingChoices.length)] as number,
              isUpChoices[next(isUpChoices.length)],
              markChoices[next(markChoices.length)],
            ),
          );
          map.set(
            nodeName,
            livenessChoices[next(livenessChoices.length)] ?? null,
          );
        }
        // The reporter: in the roster or not, warming up or established.
        if (next(4) !== 0) {
          roster.push(rosterNode("pve1", NOW_MS, true, null));
        }
        map.set(
          "pve1",
          next(3) !== 0
            ? liveness(NOW_MS - 20_000, NOW_MS)
            : eligibleAt(NOW_MS),
        );
        // Now and then a duplicated row.
        if (next(5) === 0 && roster.length > 0) {
          roster.push({ ...(roster[0] as ProxmoxRosterNode) });
        }
        const rosterReadAtMs: number | undefined =
          readAtChoices[next(readAtChoices.length)];
        const readAtMs: number = rosterReadAtMs ?? NOW_MS;

        // The map holds exactly the roster's nodes and the reporter.
        const established: boolean = Array.from(map.values()).some(
          (nodeLiveness: ProxmoxNodeLiveness | null) => {
            return isEligibleProxmoxReporter(nodeLiveness, NOW_MS);
          },
        );
        // The rule, spelled out: silent, then (Q, R) the mark gate.
        const silent: Array<ProxmoxRosterNode> = roster.filter(
          (node: ProxmoxRosterNode) => {
            return (
              node.nodeName !== "pve1" &&
              !isAliveProxmoxNode(map.get(node.nodeName) ?? null, NOW_MS) &&
              node.lastSeenAt.getTime() < NOW_MS - PROXMOX_NODE_SILENCE_MS
            );
          },
        );
        const markedWithin: (
          node: ProxmoxRosterNode,
          atMs: number,
        ) => boolean = (node: ProxmoxRosterNode, atMs: number): boolean => {
          return Boolean(
            node.isUp === false &&
              node.notReportingMarkedAt &&
              atMs - node.notReportingMarkedAt.getTime() <=
                PROXMOX_MONITOR_WINDOW_MS,
          );
        };
        const expected: Array<string> = Array.from(
          new Set<string>(
            silent
              .filter((node: ProxmoxRosterNode) => {
                return established || markedWithin(node, readAtMs);
              })
              .map((node: ProxmoxRosterNode) => {
                return node.nodeName;
              }),
          ),
        ).sort();

        const decision: ProxmoxSilentNodeDecision | null = decide({
          roster,
          liveness: map,
          rosterReadAtMs,
        });
        const offlineButAged: boolean = silent.some(
          (node: ProxmoxRosterNode) => {
            return node.isUp === false && !markedWithin(node, readAtMs);
          },
        );
        if (!established && offlineButAged) {
          withheldForTheirMark++;
        }
        if (!decision) {
          expect(expected).toEqual([]);
          continue;
        }
        decisions++;
        expect(decision.silentNodes).toEqual(expected);
        const nodeCount: number = clusterSize(roster, "pve1");
        expect(decision.reporterCount + decision.silentNodes.length).toBe(
          nodeCount,
        );
        expect(decision.reporterCount).toBeGreaterThanOrEqual(1);
        expect(decision.silentNodes).not.toContain("pve1");
        const keyed: number = Array.from(
          new Set<string>([
            ...roster.map((node: ProxmoxRosterNode) => {
              return node.nodeName;
            }),
            "pve1",
          ]),
        ).filter((nodeName: string) => {
          return isAliveProxmoxNode(map.get(nodeName) ?? null, NOW_MS);
        }).length;
        expect(decision.reporterCount).toBeGreaterThanOrEqual(keyed);
        if (decision.reporterCount > keyed) {
          moreThanKeyed++;
        }
        if (!established) {
          continuations++;
          if (
            silent.some((node: ProxmoxRosterNode) => {
              return (
                markedWithin(node, readAtMs) && !markedWithin(node, NOW_MS)
              );
            })
          ) {
            continuedOnTheRead++;
          }
        }
      }
      /*
       * Not vacuous: many reports, continuation among them, Offline rows
       * withheld for a missing or aged mark, reports that only the
       * roster's read time kept inside the window, and many reports where
       * the nodes with a key alone would have undercounted L.
       */
      expect(decisions).toBeGreaterThan(200);
      expect(continuations).toBeGreaterThan(15);
      expect(continuedOnTheRead).toBeGreaterThan(3);
      expect(withheldForTheirMark).toBeGreaterThan(15);
      expect(moreThanKeyed).toBeGreaterThan(70);
    });
  });

  /*
   * Q, R: the Offline row's mark — notReportingMarkedAt, written only by
   * markNodesNotReporting, on the ingest worker's clock (rewritten at most
   * once a minute while the node is reported), and cleared by the node's
   * own next sighting. It gates the continuation only: with no node
   * established now, a silent Offline row is reported only while its mark
   * is at most PROXMOX_MONITOR_WINDOW_MS (300 s) old at the moment the
   * roster holding it was read — rosterReadAtMs, nowMs when left out (O's
   * 330 s continuation window on nowMs is gone). Past that the whole
   * cluster has been silent to OneUptime for longer than the monitors'
   * window (a long outage): the incidents have resolved, and an Offline row
   * without a key may be a node that came back during the outage and is
   * not processed yet. A row with no mark never continues, whatever else
   * the row says — an agent-era Offline row whose updatedAt a database
   * clock running ahead dated in the future included; with a node
   * established now the mark is ignored.
   */
  describe("the continuation window: the Offline row's own mark, aged at the roster's read", () => {
    const reporterWarmingUp: ProxmoxNodeLiveness = liveness(
      NOW_MS - 30_000,
      NOW_MS,
    );
    const siblingWarmingUp: ProxmoxNodeLiveness = liveness(
      NOW_MS - 60_000,
      NOW_MS - 4_000,
    );
    /*
     * pve3 already Offline, marked at markedAtMs; pve4 newly silent — Online,
     * with a mark it could never carry in Postgres (the mark sets isUp to
     * false), to show that a mark alone continues nothing.
     */
    function rosterMarkedAt(
      markedAtMs: number | null | undefined,
    ): Array<ProxmoxRosterNode> {
      return [
        rosterNode("pve1", NOW_MS, true, null),
        rosterNode("pve2", NOW_MS - 4_000, true, null),
        rosterNode("pve3", STALE_MS, false, markedAtMs),
        rosterNode("pve4", STALE_MS, true, RECENT_MARK_MS),
      ];
    }
    const nobodyEstablished: Map<string, ProxmoxNodeLiveness | null> =
      livenessMap({
        pve1: reporterWarmingUp,
        pve2: siblingWarmingUp,
        pve3: null,
        pve4: null,
      });
    const continued: ProxmoxSilentNodeDecision = {
      silentNodes: ["pve3"],
      reporterCount: 3,
    };

    test("the fixtures establish nobody", () => {
      for (const nodeLiveness of nobodyEstablished.values()) {
        expect(isEligibleProxmoxReporter(nodeLiveness, NOW_MS)).toBe(false);
      }
    });

    test("marked within 300 s: continued — the Offline node only, L = 4 − 1, from every live node", () => {
      for (const markAgeMs of [
        0,
        1,
        30_000,
        60_000,
        PROXMOX_NODE_SILENCE_MS,
        240_000,
        PROXMOX_MONITOR_WINDOW_MS - 1,
        PROXMOX_MONITOR_WINDOW_MS,
      ]) {
        for (const selfNode of ["pve1", "pve2"]) {
          expect(
            decide({
              roster: rosterMarkedAt(NOW_MS - markAgeMs),
              liveness: nobodyEstablished,
              selfNode,
            }),
          ).toEqual(continued);
        }
      }
    });

    test("marked exactly 300 s ago: still continued; 1 ms more: nothing", () => {
      for (const selfNode of ["pve1", "pve2"]) {
        expect(
          decide({
            roster: rosterMarkedAt(NOW_MS - PROXMOX_MONITOR_WINDOW_MS),
            liveness: nobodyEstablished,
            selfNode,
          }),
        ).toEqual(continued);
        expect(
          decide({
            roster: rosterMarkedAt(NOW_MS - PROXMOX_MONITOR_WINDOW_MS - 1),
            liveness: nobodyEstablished,
            selfNode,
          }),
        ).toBeNull();
      }
      // The same edge, literally: 300 000 ms continues, 300 001 ms does not.
      expect(
        decide({
          roster: rosterMarkedAt(NOW_MS - 300_000),
          liveness: nobodyEstablished,
        }),
      ).toEqual(continued);
      expect(
        decide({
          roster: rosterMarkedAt(NOW_MS - 300_001),
          liveness: nobodyEstablished,
        }),
      ).toBeNull();
    });

    /*
     * R reverts O: a mark 300–330 s old at the roster's read — continued
     * under O's 330 s window — is past the window now.
     */
    test("marked more than 300 s ago: nothing is reported, not even a node already Offline — O's old 330 s included", () => {
      for (const markAgeMs of [
        PROXMOX_MONITOR_WINDOW_MS + 1,
        315_000,
        330_000,
        330_001,
        360_000,
        600_000,
        86_400_000,
      ]) {
        for (const selfNode of ["pve1", "pve2"]) {
          expect(
            decide({
              roster: rosterMarkedAt(NOW_MS - markAgeMs),
              liveness: nobodyEstablished,
              selfNode,
            }),
          ).toBeNull();
        }
      }
      // The first node back after a 10-minute outage, every sibling Offline.
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS - 600_000, true, null),
            offlineNode("pve2", NOW_MS - 900_000, NOW_MS - 630_000),
            offlineNode("pve3", NOW_MS - 900_000, NOW_MS - 610_000),
          ],
          liveness: livenessMap({ pve1: liveness(NOW_MS, NOW_MS) }),
        }),
      ).toBeNull();
    });

    // The mark is what continues a report: a row that carries none never does.
    test.each([
      { title: "no notReportingMarkedAt (left out)", markedAtMs: undefined },
      { title: "notReportingMarkedAt null", markedAtMs: null },
    ] as Array<{ title: string; markedAtMs: number | null | undefined }>)(
      "an Offline row with $title is never continued",
      ({
        markedAtMs,
      }: {
        title: string;
        markedAtMs: number | null | undefined;
      }) => {
        const roster: Array<ProxmoxRosterNode> = rosterMarkedAt(markedAtMs);
        expect(roster[2]?.isUp).toBe(false);
        for (const selfNode of ["pve1", "pve2"]) {
          for (const rosterReadAtMs of [
            undefined,
            NOW_MS,
            NOW_MS - PROXMOX_ROSTER_CACHE_TTL_MS,
          ]) {
            expect(
              decide({
                roster,
                liveness: nobodyEstablished,
                selfNode,
                rosterReadAtMs,
              }),
            ).toBeNull();
          }
        }
      },
    );

    /*
     * Q, the database clock: an Offline row the Proxmox Agent wrote (its
     * bulkUpsert set isUp false and cleared the mark) carries no mark, and
     * its updatedAt is the database's now() of that write — dated up to 10
     * minutes in the future by a database clock running ahead. Read as a
     * mark, that updatedAt continued the row after a switch to the native
     * push: a node back during the switch, but not processed yet, reported
     * as down. The roster carries no updatedAt, and a row object that
     * happens to hold one is judged by its notReportingMarkedAt alone.
     */
    test("an agent-era Offline row — no mark, an updatedAt the database's clock dated ahead — is never continued", () => {
      for (const updatedAtMs of [
        NOW_MS + 600_000,
        NOW_MS + 1,
        NOW_MS,
        RECENT_MARK_MS,
      ]) {
        const agentEraRow: ProxmoxRosterNode & { updatedAt: Date } = {
          ...rosterNode("pve3", STALE_MS, false, null),
          updatedAt: new Date(updatedAtMs),
        };
        const roster: Array<ProxmoxRosterNode> = [
          rosterNode("pve1", NOW_MS, true, null),
          rosterNode("pve2", NOW_MS - 4_000, true, null),
          agentEraRow,
        ];
        for (const rosterReadAtMs of [
          undefined,
          NOW_MS,
          NOW_MS - PROXMOX_ROSTER_CACHE_TTL_MS,
        ]) {
          for (const selfNode of ["pve1", "pve2"]) {
            expect(
              decide({
                roster,
                liveness: nobodyEstablished,
                selfNode,
                rosterReadAtMs,
              }),
            ).toBeNull();
          }
        }
        // Not vacuous: it is silent — reported once a node is established.
        expect(
          decide({
            roster,
            liveness: livenessMap({
              pve1: eligibleAt(NOW_MS),
              pve2: siblingWarmingUp,
              pve3: null,
            }),
          }),
        ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
        // And the same row marked by the live nodes' report is continued.
        expect(
          decide({
            roster: [
              ...roster.slice(0, 2),
              { ...agentEraRow, notReportingMarkedAt: new Date(NOW_MS) },
            ],
            liveness: nobodyEstablished,
          }),
        ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      }
    });

    /*
     * A row not Offline — an Online row, or one whose state is unknown — is
     * a newly silent node: its report waits for an established node,
     * however recent a mark it carries.
     */
    test.each(NOT_OFFLINE_STATES)(
      "a row not Offline ($title) never continues, however recently marked",
      (state: RowState) => {
        for (const markedAtMs of [NOW_MS, NOW_MS - 1_000, RECENT_MARK_MS]) {
          expect(
            decide({
              roster: [
                rosterNode("pve1", NOW_MS, true, null),
                rosterNode("pve2", NOW_MS - 4_000, true, null),
                rosterNode("pve3", STALE_MS, state.isUp, markedAtMs),
              ],
              liveness: nobodyEstablished,
            }),
          ).toBeNull();
        }
      },
    );

    // Each Offline row is judged by its own mark, not by its siblings'.
    test("each Offline row by its own mark: only the recently marked ones are continued", () => {
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS, true, null),
        offlineNode("pve2", STALE_MS, RECENT_MARK_MS),
        offlineNode("pve3", STALE_MS, NOW_MS - PROXMOX_MONITOR_WINDOW_MS - 1),
        rosterNode("pve4", STALE_MS, false),
        offlineNode("pve5", STALE_MS, NOW_MS - PROXMOX_MONITOR_WINDOW_MS),
        // O's old slack: past the window at nowMs.
        offlineNode("pve6", STALE_MS, NOW_MS - 330_000),
      ];
      expect(
        decide({
          roster,
          liveness: livenessMap({ pve1: reporterWarmingUp }),
        }),
      ).toEqual({ silentNodes: ["pve2", "pve5"], reporterCount: 4 });
      // R: the same roster read 30 s earlier — pve3 and pve6 were inside then.
      expect(
        decide({
          roster,
          liveness: livenessMap({ pve1: reporterWarmingUp }),
          rosterReadAtMs: NOW_MS - PROXMOX_ROSTER_CACHE_TTL_MS,
        }),
      ).toEqual({
        silentNodes: ["pve2", "pve3", "pve5", "pve6"],
        reporterCount: 2,
      });
      // Established: every one of them, whatever its mark.
      expect(
        decide({
          roster,
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS) }),
        }),
      ).toEqual({
        silentNodes: ["pve2", "pve3", "pve4", "pve5", "pve6"],
        reporterCount: 1,
      });
    });

    test("a node established now overrides it: every silent node is reported, whatever the mark or the read", () => {
      const pve2Established: Map<string, ProxmoxNodeLiveness | null> =
        livenessMap({
          pve1: reporterWarmingUp,
          pve2: eligibleAt(NOW_MS - 4_000),
          pve3: null,
          pve4: null,
        });
      const selfEstablished: Map<string, ProxmoxNodeLiveness | null> =
        livenessMap({
          pve1: eligibleAt(NOW_MS),
          pve2: siblingWarmingUp,
          pve3: null,
          pve4: null,
        });
      for (const map of [pve2Established, selfEstablished]) {
        for (const markedAtMs of [
          RECENT_MARK_MS,
          NOW_MS - PROXMOX_MONITOR_WINDOW_MS - 1,
          NOW_MS - 86_400_000,
          null,
          undefined,
        ]) {
          for (const rosterReadAtMs of [undefined, NOW_MS + 86_400_000]) {
            expect(
              decide({
                roster: rosterMarkedAt(markedAtMs),
                liveness: map,
                rosterReadAtMs,
              }),
            ).toEqual({ silentNodes: ["pve3", "pve4"], reporterCount: 2 });
          }
        }
      }
    });

    /*
     * The mark is judged on the ingest worker's clock — the clock
     * markNodesNotReporting writes it on (markedAt) and reads the roster on
     * — never on the reporter's own (skewed) clock. pve3's sighting is an
     * hour old, so it is silent whatever the reporter's clock says.
     */
    test("judged on the worker's clock, never against the reporter's", () => {
      const roster: (markedAtMs: number) => Array<ProxmoxRosterNode> = (
        markedAtMs: number,
      ): Array<ProxmoxRosterNode> => {
        return [
          rosterNode("pve1", NOW_MS, true, null),
          offlineNode("pve3", NOW_MS - 3_600_000, markedAtMs),
        ];
      };
      // Marked 400 s ago: aged out, though only 200 s before the reporter's clock.
      expect(
        decide({
          roster: roster(NOW_MS - 400_000),
          liveness: livenessMap({ pve1: reporterWarmingUp }),
          reporterTimeMs: NOW_MS - 200_000,
        }),
      ).toBeNull();
      // Marked 200 s ago: continued, though 400 s before the reporter's clock.
      expect(
        decide({
          roster: roster(NOW_MS - 200_000),
          liveness: livenessMap({ pve1: reporterWarmingUp }),
          reporterTimeMs: NOW_MS + 200_000,
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 1 });
      // The edge, the same way: 300 s + 1 ms at the read, 0 s on the reporter's clock.
      expect(
        decide({
          roster: roster(NOW_MS - PROXMOX_MONITOR_WINDOW_MS - 1),
          liveness: livenessMap({ pve1: reporterWarmingUp }),
          reporterTimeMs: NOW_MS - PROXMOX_MONITOR_WINDOW_MS,
        }),
      ).toBeNull();
      expect(
        decide({
          roster: roster(NOW_MS - PROXMOX_MONITOR_WINDOW_MS),
          liveness: livenessMap({ pve1: reporterWarmingUp }),
          reporterTimeMs: NOW_MS + 100_000,
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 1 });
    });

    /*
     * R: a worker judges a mark at the moment it read the roster, and keeps
     * that judgement for as long as it serves the roster — so rosterReadAtMs,
     * not nowMs, decides. Here nowMs stays at NOW and only the read moves.
     */
    test("R: the mark's age is taken at rosterReadAtMs, not at nowMs", () => {
      // Marked 320 s before nowMs: past the window at nowMs…
      expect(
        decide({
          roster: rosterMarkedAt(NOW_MS - 320_000),
          liveness: nobodyEstablished,
        }),
      ).toBeNull();
      // …but the roster was read 30 s before: the mark was 290 s old then.
      expect(
        decide({
          roster: rosterMarkedAt(NOW_MS - 320_000),
          liveness: nobodyEstablished,
          rosterReadAtMs: NOW_MS - PROXMOX_ROSTER_CACHE_TTL_MS,
        }),
      ).toEqual(continued);

      /*
       * The edge sits at the read: a mark exactly 300 s old then continues
       * and 1 ms older does not, however long ago (within a cache's life)
       * the roster was read.
       */
      for (const sinceReadMs of [
        0,
        1,
        10_000,
        PROXMOX_ROSTER_CACHE_TTL_MS - 1,
        PROXMOX_ROSTER_CACHE_TTL_MS,
      ]) {
        const readAtMs: number = NOW_MS - sinceReadMs;
        expect(
          decide({
            roster: rosterMarkedAt(readAtMs - PROXMOX_MONITOR_WINDOW_MS),
            liveness: nobodyEstablished,
            rosterReadAtMs: readAtMs,
          }),
        ).toEqual(continued);
        expect(
          decide({
            roster: rosterMarkedAt(readAtMs - PROXMOX_MONITOR_WINDOW_MS - 1),
            liveness: nobodyEstablished,
            rosterReadAtMs: readAtMs,
          }),
        ).toBeNull();
      }

      // Whichever way they differ: a read after nowMs takes the age then.
      expect(
        decide({
          roster: rosterMarkedAt(NOW_MS - 200_000),
          liveness: nobodyEstablished,
          rosterReadAtMs: NOW_MS + 100_000,
        }),
      ).toEqual(continued);
      expect(
        decide({
          roster: rosterMarkedAt(NOW_MS - 200_000),
          liveness: nobodyEstablished,
          rosterReadAtMs: NOW_MS + 100_001,
        }),
      ).toBeNull();
    });

    /*
     * R: without rosterReadAtMs — left out, or undefined — the marks are
     * aged at nowMs, the pure function's own "now". Checked at two nowMs,
     * with the edge falling between the marks swept.
     */
    test("R: rosterReadAtMs left out, or undefined, is nowMs", () => {
      for (const nowMs of [NOW_MS, NOW_MS + 40_000]) {
        let continuedCount: number = 0;
        for (const markedAtMs of [
          RECENT_MARK_MS,
          nowMs - PROXMOX_MONITOR_WINDOW_MS,
          nowMs - PROXMOX_MONITOR_WINDOW_MS - 1,
          nowMs - 600_000,
        ]) {
          const input: Parameters<typeof decideProxmoxSilentNodes>[0] = {
            selfNode: "pve1",
            reporterTimeMs: nowMs,
            nowMs,
            roster: rosterMarkedAt(markedAtMs),
            liveness: nobodyEstablished,
          };
          const atNow: ProxmoxSilentNodeDecision | null =
            decideProxmoxSilentNodes({ ...input, rosterReadAtMs: nowMs });
          expect(decideProxmoxSilentNodes(input)).toEqual(atNow);
          expect(
            decideProxmoxSilentNodes({ ...input, rosterReadAtMs: undefined }),
          ).toEqual(atNow);
          expect(
            decide({
              roster: input.roster,
              liveness: nobodyEstablished,
              nowMs,
              reporterTimeMs: nowMs,
            }),
          ).toEqual(atNow);
          if (atNow) {
            expect(atNow).toEqual(continued);
            continuedCount++;
          }
        }
        // The recent mark and the one exactly 300 s old at nowMs.
        expect(continuedCount).toBe(2);
      }
      // Not vacuous: nobody is established at either nowMs.
      for (const nodeLiveness of nobodyEstablished.values()) {
        expect(isEligibleProxmoxReporter(nodeLiveness, NOW_MS + 40_000)).toBe(
          false,
        );
      }
    });

    /*
     * R moves only the marks' age: whether a node is alive or established
     * is still judged at nowMs, and whether it is silent on the reporter's
     * clock — so when no Offline mark is in play, the read time changes
     * nothing.
     */
    test("R: the roster's read time moves only the marks' age — never liveness, establishment or sightings", () => {
      const cases: Array<{
        roster: Array<ProxmoxRosterNode>;
        liveness: Map<string, ProxmoxNodeLiveness | null>;
        expected: ProxmoxSilentNodeDecision | null;
      }> = [
        // A node established: every silent node, whatever the marks.
        {
          roster: rosterMarkedAt(NOW_MS - 86_400_000),
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: siblingWarmingUp,
          }),
          expected: { silentNodes: ["pve3", "pve4"], reporterCount: 2 },
        },
        // Nobody established, nothing Offline: nothing.
        {
          roster: rosterMarkedAt(RECENT_MARK_MS).filter(
            (node: ProxmoxRosterNode) => {
              return node.nodeName !== "pve3";
            },
          ),
          liveness: nobodyEstablished,
          expected: null,
        },
        // pve3 back — a live key at nowMs: not silent.
        {
          roster: rosterMarkedAt(RECENT_MARK_MS),
          liveness: livenessMap({
            pve1: reporterWarmingUp,
            pve2: siblingWarmingUp,
            pve3: liveness(NOW_MS - 2_000, NOW_MS - 2_000),
            pve4: null,
          }),
          expected: null,
        },
        // pve3 sighted by something else a moment ago: not silent.
        {
          roster: [
            rosterNode("pve1", NOW_MS, true, null),
            offlineNode("pve3", NOW_MS - 5_000, RECENT_MARK_MS),
          ],
          liveness: livenessMap({ pve1: reporterWarmingUp, pve3: null }),
          expected: null,
        },
      ];
      for (const testCase of cases) {
        for (const rosterReadAtMs of [
          undefined,
          NOW_MS,
          NOW_MS - PROXMOX_ROSTER_CACHE_TTL_MS,
          NOW_MS - 600_000,
          NOW_MS + 600_000,
        ]) {
          expect(
            decide({
              roster: testCase.roster,
              liveness: testCase.liveness,
              rosterReadAtMs,
            }),
          ).toEqual(testCase.expected);
        }
      }
    });

    /*
     * Another ingest worker's clock a little ahead of this one's (each mark
     * is written on the clock of the worker that made the report): a mark
     * "from the future" is recent.
     */
    test("a mark dated ahead of this worker's clock counts as recent", () => {
      expect(
        decide({
          roster: rosterMarkedAt(NOW_MS + 5_000),
          liveness: nobodyEstablished,
        }),
      ).toEqual(continued);
      expect(
        decide({
          roster: rosterMarkedAt(NOW_MS + 5_000),
          liveness: nobodyEstablished,
          rosterReadAtMs: NOW_MS - PROXMOX_ROSTER_CACHE_TTL_MS,
        }),
      ).toEqual(continued);
    });

    test("a recent mark never makes a report on its own", () => {
      // No Offline silent node: the newly silent one still waits.
      expect(
        decide({
          roster: rosterMarkedAt(RECENT_MARK_MS).filter(
            (node: ProxmoxRosterNode) => {
              return node.nodeName !== "pve3";
            },
          ),
          liveness: nobodyEstablished,
        }),
      ).toBeNull();
      // The Offline node is back: its first push set its key.
      expect(
        decide({
          roster: rosterMarkedAt(RECENT_MARK_MS),
          liveness: livenessMap({
            pve1: reporterWarmingUp,
            pve2: siblingWarmingUp,
            pve3: liveness(NOW_MS - 2_000, NOW_MS - 2_000),
            pve4: null,
          }),
        }),
      ).toBeNull();
      // Something else (the agent) still sights it.
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS, true, null),
            offlineNode("pve3", NOW_MS - 5_000, RECENT_MARK_MS),
          ],
          liveness: livenessMap({ pve1: reporterWarmingUp, pve3: null }),
        }),
      ).toBeNull();
      // The reporter itself not alive.
      expect(
        decide({
          roster: rosterMarkedAt(RECENT_MARK_MS),
          liveness: livenessMap({
            pve1: liveness(
              NOW_MS - 600_000,
              NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
            ),
            pve2: siblingWarmingUp,
          }),
        }),
      ).toBeNull();
      // A standalone host.
      expect(
        decide({
          roster: [offlineNode("pve1", STALE_MS, RECENT_MARK_MS)],
          liveness: livenessMap({ pve1: liveness(NOW_MS, NOW_MS) }),
        }),
      ).toBeNull();
    });

    test("reads the mark, never writes it: the roster is left as it was", () => {
      const roster: Array<ProxmoxRosterNode> = rosterMarkedAt(RECENT_MARK_MS);
      expect(
        decide({
          roster,
          liveness: nobodyEstablished,
          rosterReadAtMs: NOW_MS - 10_000,
        }),
      ).toEqual(continued);
      expect(
        roster.map((node: ProxmoxRosterNode) => {
          return node.notReportingMarkedAt?.getTime() ?? null;
        }),
      ).toEqual([null, null, RECENT_MARK_MS, RECENT_MARK_MS]);
      expect(
        roster.map((node: ProxmoxRosterNode) => {
          return node.isUp;
        }),
      ).toEqual([true, true, false, true]);
    });
  });

  describe("a reporter missing from the roster still counts", () => {
    test("counted as a node: one stale sibling makes a two-node cluster", () => {
      expect(
        decide({
          roster: [rosterNode("pve2", STALE_MS)],
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve2: null }),
        }),
      ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    test("counted as a live reporter alongside its siblings", () => {
      expect(
        decide({
          roster: [rosterNode("pve2", NOW_MS), rosterNode("pve3", STALE_MS)],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: eligibleAt(NOW_MS),
            pve3: null,
          }),
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    test("never reports itself", () => {
      expect(
        decide({
          roster: [rosterNode("pve1", STALE_MS), rosterNode("pve2", NOW_MS)],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: eligibleAt(NOW_MS),
          }),
        }),
      ).toBeNull();
    });
  });

  describe("silent requires BOTH no live key AND a stale inventory sighting", () => {
    /*
     * A node the Proxmox Agent (or anything else) still reports has a
     * fresh lastSeenAt but no native-push key. It is not silent.
     */
    test("no key, fresh sighting (refreshed by the agent) → never silent", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS - 5_000),
          ],
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve2: null }),
        }),
      ).toBeNull();
    });

    // The inventory flush lags behind, but the node's pushes are processed.
    test("a live key, stale sighting → never silent", () => {
      expect(
        decide({
          roster: [rosterNode("pve1", NOW_MS), rosterNode("pve2", STALE_MS)],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: liveness(NOW_MS - 30_000, NOW_MS - 20_000),
          }),
        }),
      ).toBeNull();
    });

    test("a live key of a node still warming up, stale sighting → never silent", () => {
      expect(
        decide({
          roster: [rosterNode("pve1", NOW_MS), rosterNode("pve2", STALE_MS)],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: liveness(NOW_MS, NOW_MS),
          }),
        }),
      ).toBeNull();
    });

    test("sighting exactly at the reporter's push minus 2 minutes → not silent yet", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS - PROXMOX_NODE_SILENCE_MS),
          ],
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve2: null }),
        }),
      ).toBeNull();
    });

    test("sighting 1 ms before the reporter's push minus 2 minutes → silent", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS - PROXMOX_NODE_SILENCE_MS - 1),
          ],
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve2: null }),
        }),
      ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    test("a key whose last push is exactly 2 minutes old is still alive", () => {
      expect(
        decide({
          roster: [rosterNode("pve1", NOW_MS), rosterNode("pve2", STALE_MS)],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: liveness(NOW_MS - 600_000, NOW_MS - PROXMOX_NODE_SILENCE_MS),
          }),
        }),
      ).toBeNull();
    });

    /*
     * The key's TTL is enforced by Redis on its own clock; a value read
     * just before it expires is judged by its lastPushMs, not by the fact
     * that it was still there.
     */
    test("a key still present but older than 2 minutes counts as gone", () => {
      expect(
        decide({
          roster: [rosterNode("pve1", NOW_MS), rosterNode("pve2", STALE_MS)],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: liveness(
              NOW_MS - 600_000,
              NOW_MS - PROXMOX_NODE_SILENCE_MS - 1,
            ),
          }),
        }),
      ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });
  });

  describe("clock skew turns into a later report, never a false one", () => {
    // pve2 died 200 s ago; its last sighting is on its own (correct) clock.
    const roster: Array<ProxmoxRosterNode> = [
      rosterNode("pve1", NOW_MS),
      rosterNode("pve2", NOW_MS - 200_000),
    ];

    test("reporter's clock 5 minutes behind → no report yet", () => {
      expect(
        decide({
          roster,
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve2: null }),
          reporterTimeMs: NOW_MS - 300_000,
        }),
      ).toBeNull();
    });

    test("reporter's clock behind → reports once its own clock passes the sighting + 2 minutes", () => {
      const behindMs: number = 300_000;
      const lastSeenMs: number = NOW_MS - 200_000;
      const catchUpNowMs: number =
        lastSeenMs + PROXMOX_NODE_SILENCE_MS + behindMs + 1;
      expect(
        decide({
          roster,
          liveness: livenessMap({
            pve1: eligibleAt(catchUpNowMs),
            pve2: null,
          }),
          nowMs: catchUpNowMs,
          reporterTimeMs: catchUpNowMs - behindMs,
        }),
      ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      expect(
        decide({
          roster,
          liveness: livenessMap({
            pve1: eligibleAt(catchUpNowMs - 1),
            pve2: null,
          }),
          nowMs: catchUpNowMs - 1,
          reporterTimeMs: catchUpNowMs - 1 - behindMs,
        }),
      ).toBeNull();
    });

    test("reporter's clock ahead → still no report while the sibling's key is alive", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS - 30_000),
          ],
          liveness: livenessMap({
            pve1: eligibleAt(NOW_MS),
            pve2: liveness(NOW_MS - 600_000, NOW_MS - 30_000),
          }),
          reporterTimeMs: NOW_MS + 300_000,
        }),
      ).toBeNull();
    });

    test("reporter's clock ahead → reports once the sibling's key is also gone", () => {
      expect(
        decide({
          roster: [
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS - 30_000),
          ],
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve2: null }),
          reporterTimeMs: NOW_MS + 300_000,
        }),
      ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    test("the dead sibling's clock ahead → its report waits for the reporter's clock to pass it", () => {
      // pve2 died 200 s ago, but its clock ran 5 minutes fast.
      const aheadRoster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS),
        rosterNode("pve2", NOW_MS - 200_000 + 300_000),
      ];
      expect(
        decide({
          roster: aheadRoster,
          liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve2: null }),
        }),
      ).toBeNull();
    });
  });

  // L = 5 nodes − 2 reported: the reporter and a node still warming up count.
  test("reporterCount counts every node not reported, the reporter and nodes still warming up included", () => {
    const decision: ProxmoxSilentNodeDecision | null = decide({
      roster: [
        rosterNode("pve1", NOW_MS),
        rosterNode("pve2", NOW_MS),
        rosterNode("pve3", NOW_MS), // alive, still warming up
        rosterNode("pve4", STALE_MS), // dead
        rosterNode("pve5", STALE_MS), // dead, its key not yet evicted
      ],
      liveness: livenessMap({
        pve1: eligibleAt(NOW_MS),
        pve2: eligibleAt(NOW_MS),
        pve3: liveness(NOW_MS - 60_000, NOW_MS),
        pve4: null,
        pve5: liveness(NOW_MS - 900_000, NOW_MS - PROXMOX_NODE_SILENCE_MS - 1),
      }),
    });
    expect(decision).toEqual({
      silentNodes: ["pve4", "pve5"],
      reporterCount: 3,
    });
  });

  test("an alive node still warming up is never silent, and counts as live", () => {
    expect(
      decide({
        roster: [
          rosterNode("pve1", NOW_MS),
          rosterNode("pve2", STALE_MS),
          rosterNode("pve3", STALE_MS),
        ],
        liveness: livenessMap({
          pve1: eligibleAt(NOW_MS),
          // Just back after a reboot: alive, streak of 30 s, stale sighting.
          pve2: liveness(NOW_MS - 30_000, NOW_MS),
          pve3: null,
        }),
      }),
    ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
  });

  test("silent nodes come back sorted", () => {
    const decision: ProxmoxSilentNodeDecision | null = decide({
      roster: [
        rosterNode("pve9", STALE_MS),
        rosterNode("pve1", NOW_MS),
        rosterNode("pve10", STALE_MS),
        rosterNode("pve2", STALE_MS),
        rosterNode("alpha", STALE_MS),
      ],
      liveness: livenessMap({ pve1: eligibleAt(NOW_MS) }),
    });
    expect(decision).toEqual({
      silentNodes: ["alpha", "pve10", "pve2", "pve9"],
      reporterCount: 1,
    });
  });

  test("several dead nodes are all reported, by every live reporter", () => {
    const roster: Array<ProxmoxRosterNode> = [
      rosterNode("pve1", NOW_MS),
      rosterNode("pve2", NOW_MS),
      rosterNode("pve3", STALE_MS),
      rosterNode("pve4", NOW_MS - 3_600_000),
      rosterNode("pve5", NOW_MS),
    ];
    const map: Map<string, ProxmoxNodeLiveness | null> = livenessMap({
      pve1: eligibleAt(NOW_MS),
      pve2: eligibleAt(NOW_MS),
      pve3: null,
      pve4: null,
      pve5: eligibleAt(NOW_MS),
    });
    for (const selfNode of ["pve1", "pve2", "pve5"]) {
      expect(decide({ roster, liveness: map, selfNode })).toEqual({
        silentNodes: ["pve3", "pve4"],
        reporterCount: 3,
      });
    }
  });

  test("the only survivor of a cluster reports every sibling", () => {
    expect(
      decide({
        roster: [
          rosterNode("pve1", NOW_MS),
          rosterNode("pve2", STALE_MS),
          rosterNode("pve3", STALE_MS),
        ],
        liveness: livenessMap({
          pve1: eligibleAt(NOW_MS),
          pve2: null,
          pve3: null,
        }),
      }),
    ).toEqual({ silentNodes: ["pve2", "pve3"], reporterCount: 1 });
  });

  test("a node listed twice in the roster is reported once", () => {
    expect(
      decide({
        roster: [
          rosterNode("pve1", NOW_MS),
          rosterNode("pve2", STALE_MS),
          rosterNode("pve2", STALE_MS - 1_000),
        ],
        liveness: livenessMap({ pve1: eligibleAt(NOW_MS), pve2: null }),
      }),
    ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
  });

  test("is pure: the inputs are not mutated and a repeat gives the same answer", () => {
    const roster: Array<ProxmoxRosterNode> = [
      rosterNode("pve3", STALE_MS),
      rosterNode("pve1", NOW_MS),
      rosterNode("pve2", STALE_MS),
    ];
    const map: Map<string, ProxmoxNodeLiveness | null> = livenessMap({
      pve1: eligibleAt(NOW_MS),
    });
    const first: ProxmoxSilentNodeDecision | null = decide({
      roster,
      liveness: map,
    });
    const second: ProxmoxSilentNodeDecision | null = decide({
      roster,
      liveness: map,
    });
    expect(first).toEqual(second);
    expect(
      roster.map((node: ProxmoxRosterNode) => {
        return node.nodeName;
      }),
    ).toEqual(["pve3", "pve1", "pve2"]);
    expect(Array.from(map.keys())).toEqual(["pve1"]);
  });
});

describe("isProxmoxSilentNodeDetectionEnabled", () => {
  const ENV_KEY: string = "PVE_NATIVE_NODE_SILENCE_DETECTION";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  test("on by default", () => {
    delete process.env[ENV_KEY];
    expect(isProxmoxSilentNodeDetectionEnabled()).toBe(true);
  });

  test("only 'false' (any case, trimmed) turns it off", () => {
    for (const value of ["false", "FALSE", " False ", "false\n"]) {
      process.env[ENV_KEY] = value;
      expect(isProxmoxSilentNodeDetectionEnabled()).toBe(false);
    }
  });

  test("any other value leaves it on", () => {
    for (const value of ["", "true", "0", "no", "off", "disabled", "f"]) {
      process.env[ENV_KEY] = value;
      expect(isProxmoxSilentNodeDetectionEnabled()).toBe(true);
    }
  });
});

/*
 * ------------------------------------------------------------------
 * recordProxmoxNodePushAndFindSilentNodes, against an in-memory Redis
 * ------------------------------------------------------------------
 *
 * GlobalCache is faked with a Map that honours the TTL on a simulated
 * clock (a key is gone once the clock passes its expiry, as in Redis),
 * and Date.now() follows the same clock so the in-process roster cache
 * expires on it too. The per-node liveness keys are the only keys the
 * module may touch: the continuation gate (M) is read from the roster, so
 * a push makes no other GET or SET.
 */

interface FakeRedisEntry {
  value: string;
  expiresAtMs: number;
}

interface FakeGetCall {
  atMs: number;
  namespace: string;
  key: string;
  // What the read returned (null when missing, or when it threw).
  value: string | null;
}

interface FakeSetCall {
  namespace: string;
  key: string;
  value: string;
  expiresInSeconds: number | undefined;
}

interface FakeMgetCall {
  atMs: number;
  namespace: string;
  keys: Array<string>;
  // What the read returned (empty when it threw).
  values: Array<string | null>;
}

type FailingCall = "getString" | "setString" | "getStrings";

let clockMs: number;
let redis: Map<string, FakeRedisEntry>;
let getCalls: Array<FakeGetCall>;
let setCalls: Array<FakeSetCall>;
let mgetCalls: Array<FakeMgetCall>;
let failingCall: FailingCall | null;
let warnings: Array<string>;

function livenessKey(
  nodeName: string,
  proxmoxClusterId: ObjectID = CLUSTER_ID,
  projectId: ObjectID = PROJECT_ID,
): string {
  return `${projectId.toString()}:${proxmoxClusterId.toString()}:${nodeName}`;
}

function readRedis(fullKey: string): string | null {
  const entry: FakeRedisEntry | undefined = redis.get(fullKey);
  if (!entry) {
    return null;
  }
  if (clockMs > entry.expiresAtMs) {
    redis.delete(fullKey);
    return null;
  }
  return entry.value;
}

function seedLiveness(
  nodeName: string,
  value: ProxmoxNodeLiveness,
  proxmoxClusterId: ObjectID = CLUSTER_ID,
  projectId: ObjectID = PROJECT_ID,
): void {
  redis.set(
    `${LIVENESS_NAMESPACE}-${livenessKey(nodeName, proxmoxClusterId, projectId)}`,
    {
      value: serializeProxmoxNodeLiveness(value),
      expiresAtMs: value.lastPushMs + PROXMOX_NODE_SILENCE_MS,
    },
  );
}

function storedLiveness(
  nodeName: string,
  proxmoxClusterId: ObjectID = CLUSTER_ID,
): ProxmoxNodeLiveness | null {
  return parseProxmoxNodeLiveness(
    readRedis(
      `${LIVENESS_NAMESPACE}-${livenessKey(nodeName, proxmoxClusterId)}`,
    ),
  );
}

function evictLiveness(nodeName: string): void {
  redis.delete(`${LIVENESS_NAMESPACE}-${livenessKey(nodeName)}`);
}

/*
 * Every Redis call outside the liveness namespace. The continuation gate
 * (M) lives in the roster, so there must never be any: no window key, no
 * other GET or SET.
 */
function otherRedisCalls(): Array<string> {
  return [
    ...getCalls.map((call: FakeGetCall) => {
      return `GET ${call.namespace}`;
    }),
    ...setCalls.map((call: FakeSetCall) => {
      return `SET ${call.namespace}`;
    }),
    ...mgetCalls.map((call: FakeMgetCall) => {
      return `MGET ${call.namespace}`;
    }),
  ].filter((call: string) => {
    return !call.endsWith(` ${LIVENESS_NAMESPACE}`);
  });
}

function rosterLoader(roster: Array<ProxmoxRosterNode>): RosterLoaderMock {
  return jest.fn<RosterLoaderFn>(
    async (): Promise<Array<ProxmoxRosterNode>> => {
      return roster;
    },
  );
}

function push(data: {
  selfNode: string;
  nowMs: number;
  loadRoster: RosterLoaderFn;
  reporterTimeMs?: number | undefined;
  proxmoxClusterId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
}): Promise<ProxmoxSilentNodeDecision | null> {
  clockMs = data.nowMs;
  return recordProxmoxNodePushAndFindSilentNodes({
    projectId: data.projectId ?? PROJECT_ID,
    proxmoxClusterId: data.proxmoxClusterId ?? CLUSTER_ID,
    selfNode: data.selfNode,
    reporterTimeMs: data.reporterTimeMs ?? data.nowMs,
    loadRoster: data.loadRoster,
    nowMs: data.nowMs,
  });
}

/*
 * A fresh Redis, clock, call log and roster cache — the fakes installed
 * below read these on every call, so a sweep can start each run clean
 * without re-installing them.
 */
function resetFakeState(): void {
  clockMs = NOW_MS;
  redis = new Map<string, FakeRedisEntry>();
  getCalls = [];
  setCalls = [];
  mgetCalls = [];
  failingCall = null;
  warnings = [];
  clearProxmoxNodeRosterCache();
}

function installFakes(): void {
  resetFakeState();

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return clockMs;
  });

  jest.spyOn(logger, "warn").mockImplementation((message: unknown): void => {
    warnings.push(String(message));
  });

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        const call: FakeGetCall = {
          atMs: clockMs,
          namespace,
          key,
          value: null,
        };
        getCalls.push(call);
        if (failingCall === "getString") {
          throw new Error("Cache is not connected");
        }
        call.value = readRedis(`${namespace}-${key}`);
        return call.value;
      },
    );

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds: number },
      ): Promise<void> => {
        setCalls.push({
          namespace,
          key,
          value,
          expiresInSeconds: options?.expiresInSeconds,
        });
        if (failingCall === "setString") {
          throw new Error(
            "READONLY You can't write against a read only replica.",
          );
        }
        redis.set(`${namespace}-${key}`, {
          value,
          expiresAtMs:
            clockMs + (options?.expiresInSeconds ?? 30 * 86_400) * 1000,
        });
      },
    );

  jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(
      async (
        namespace: string,
        keys: Array<string>,
      ): Promise<Array<string | null>> => {
        const call: FakeMgetCall = {
          atMs: clockMs,
          namespace,
          keys: [...keys],
          values: [],
        };
        mgetCalls.push(call);
        if (failingCall === "getStrings") {
          throw new Error("ETIMEDOUT");
        }
        call.values = keys.map((key: string) => {
          return readRedis(`${namespace}-${key}`);
        });
        return [...call.values];
      },
    );
}

describe("recordProxmoxNodePushAndFindSilentNodes", () => {
  beforeEach(() => {
    installFakes();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearProxmoxNodeRosterCache();
  });

  // pve1 is the reporter; pve2 died 3 minutes ago.
  function deadSiblingRoster(nowMs: number): Array<ProxmoxRosterNode> {
    return [rosterNode("pve1", nowMs), rosterNode("pve2", nowMs - 180_000)];
  }

  describe("recording liveness", () => {
    test("the first push writes 'now,now' with a 120 s TTL", async () => {
      await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
      });

      // Its own key, and nothing else (M: no window key).
      expect(getCalls).toEqual([
        {
          atMs: NOW_MS,
          namespace: LIVENESS_NAMESPACE,
          key: livenessKey("pve1"),
          value: null,
        },
      ]);
      expect(setCalls).toEqual([
        {
          namespace: LIVENESS_NAMESPACE,
          key: livenessKey("pve1"),
          value: `${NOW_MS},${NOW_MS}`,
          expiresInSeconds: 120,
        },
      ]);
    });

    test("a continuing push keeps the streak's start and refreshes the TTL", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 50_000, NOW_MS - 10_000));

      await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
      });

      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]?.value).toBe(`${NOW_MS - 50_000},${NOW_MS}`);
      expect(setCalls[0]?.expiresInSeconds).toBe(120);
    });

    test("a push after a gap over 60 s restarts the streak", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS - 60_001));

      await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
      });

      expect(setCalls[0]?.value).toBe(`${NOW_MS},${NOW_MS}`);
    });

    test("an out-of-order older push never moves lastPushMs back", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS));

      await push({
        selfNode: "pve1",
        nowMs: NOW_MS - 5_000,
        loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
      });

      expect(setCalls[0]?.value).toBe(`${NOW_MS - 600_000},${NOW_MS}`);
    });

    test("a garbage own key is overwritten with a fresh streak", async () => {
      redis.set(`${LIVENESS_NAMESPACE}-${livenessKey("pve1")}`, {
        value: "garbage",
        expiresAtMs: NOW_MS + 60_000,
      });

      const decision: ProxmoxSilentNodeDecision | null = await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
      });

      expect(decision).toBeNull();
      expect(setCalls[0]?.value).toBe(`${NOW_MS},${NOW_MS}`);
    });

    /*
     * The impact of an empty streak start parsing as the epoch (see the
     * parse test above): a node whose key reads ",<recent>" would be
     * established on its very next push, with no 2-minute warm-up at all.
     * Here pve1 is the only node that could be established (pve2 is dead).
     */
    test("an own key with an empty streak start never skips the warm-up", async () => {
      redis.set(`${LIVENESS_NAMESPACE}-${livenessKey("pve1")}`, {
        value: `,${NOW_MS - 10_000}`,
        expiresAtMs: NOW_MS + 60_000,
      });

      const decision: ProxmoxSilentNodeDecision | null = await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
      });

      expect(decision).toBeNull();
      expect(setCalls[0]?.value).toBe(`${NOW_MS},${NOW_MS}`);
      // And the warm-up really is 2 minutes from here, not from the epoch.
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS + 10_000,
          loadRoster: rosterLoader(deadSiblingRoster(NOW_MS + 10_000)),
        }),
      ).resolves.toBeNull();
      expect(storedLiveness("pve1")).toEqual(liveness(NOW_MS, NOW_MS + 10_000));
    });

    /*
     * The same bug on a SIBLING's key matters as much now: one established
     * node lets every live node report. pve1 is warming up, pve2 (fresh
     * sighting, so never silent itself) holds a corrupt key, pve3 is dead.
     */
    test("a sibling key with an empty streak start never establishes the cluster", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 30_000, NOW_MS - 10_000));
      redis.set(`${LIVENESS_NAMESPACE}-${livenessKey("pve2")}`, {
        value: `,${NOW_MS - 5_000}`,
        expiresAtMs: NOW_MS + 60_000,
      });

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS - 5_000),
            rosterNode("pve3", NOW_MS - 180_000),
          ]),
        }),
      ).resolves.toBeNull();
      expect(mgetCalls).toHaveLength(1);
    });

    test("without nowMs it uses the current time", async () => {
      clockMs = NOW_MS + 12_345;

      await recordProxmoxNodePushAndFindSilentNodes({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        selfNode: "pve1",
        reporterTimeMs: NOW_MS,
        loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
      });

      expect(setCalls[0]?.value).toBe(`${NOW_MS + 12_345},${NOW_MS + 12_345}`);
    });

    test("keys are scoped per project and cluster", async () => {
      const otherCluster: ObjectID = ObjectID.generate();

      await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        loadRoster: rosterLoader([]),
      });
      await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        proxmoxClusterId: otherCluster,
        loadRoster: rosterLoader([]),
      });

      expect(
        setCalls.map((call: FakeSetCall) => {
          return call.key;
        }),
      ).toEqual([livenessKey("pve1"), livenessKey("pve1", otherCluster)]);
    });
  });

  /*
   * A node that is not established itself still reads the roster and its
   * siblings: it reports as soon as ANY node of the cluster is established.
   */
  describe("while the reporter is warming up", () => {
    // pve1 reporting, pve2 alive with a fresh sighting, pve3 dead.
    function liveAndDeadRoster(nowMs: number): Array<ProxmoxRosterNode> {
      return [
        rosterNode("pve1", nowMs),
        rosterNode("pve2", nowMs - 5_000),
        rosterNode("pve3", nowMs - 180_000),
      ];
    }

    test("the first push reads the roster and siblings, and reports nothing while no node is established", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader(
        deadSiblingRoster(NOW_MS),
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      expect(loadRoster).toHaveBeenCalledTimes(1);
      expect(mgetCalls).toHaveLength(1);
      expect(mgetCalls[0]?.keys).toEqual([livenessKey("pve2")]);
    });

    test("a node warming up (streak under 2 minutes) reads its siblings, and reports nothing while none is established", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 110_000, NOW_MS - 10_000));
      seedLiveness("pve2", liveness(NOW_MS - 60_000, NOW_MS - 5_000));
      const loadRoster: RosterLoaderMock = rosterLoader(
        liveAndDeadRoster(NOW_MS),
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      expect(loadRoster).toHaveBeenCalledTimes(1);
      expect(mgetCalls).toHaveLength(1);
      expect(mgetCalls[0]?.keys).toEqual([
        livenessKey("pve2"),
        livenessKey("pve3"),
      ]);
    });

    test("the first push reports a dead sibling when another sibling is established", async () => {
      seedLiveness("pve2", eligibleAt(NOW_MS - 5_000));

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(liveAndDeadRoster(NOW_MS)),
        }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

      // Its own streak has only just started.
      expect(storedLiveness("pve1")).toEqual(liveness(NOW_MS, NOW_MS));
    });

    test("a node warming up reports a dead sibling when another sibling is established", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 60_000, NOW_MS - 10_000));
      seedLiveness("pve2", eligibleAt(NOW_MS - 5_000));

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(liveAndDeadRoster(NOW_MS)),
        }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

      expect(storedLiveness("pve1")).toEqual(liveness(NOW_MS - 60_000, NOW_MS));
    });

    /*
     * The same through Redis: pve2's key is still there, with a 10-minute
     * streak, but its last push is over a minute old — its streak is
     * already broken, so it does not let the warming-up reporter report.
     * Its sighting is as old as its last push, so it is never silent.
     */
    test("a sibling key with a long streak but a last push 60 s + 1 ms old does not establish the cluster", async () => {
      const pve2LastPushMs: number = NOW_MS - PROXMOX_NODE_STREAK_GAP_MS - 1;
      seedLiveness("pve2", liveness(NOW_MS - 600_000, pve2LastPushMs));

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", pve2LastPushMs),
            rosterNode("pve3", NOW_MS - 180_000),
          ]),
        }),
      ).resolves.toBeNull();

      // Not vacuous: the key was read, and was still there.
      expect(mgetCalls).toHaveLength(1);
      expect(parseProxmoxNodeLiveness(mgetCalls[0]?.values[0])).toEqual(
        liveness(NOW_MS - 600_000, pve2LastPushMs),
      );
    });

    test("a sibling key with a long streak and a last push exactly 60 s old still establishes it", async () => {
      const pve2LastPushMs: number = NOW_MS - PROXMOX_NODE_STREAK_GAP_MS;
      seedLiveness("pve2", liveness(NOW_MS - 600_000, pve2LastPushMs));

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", pve2LastPushMs),
            rosterNode("pve3", NOW_MS - 180_000),
          ]),
        }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    test("records its own liveness before reading the roster", async () => {
      let ownAtRosterLoad: ProxmoxNodeLiveness | null = null;
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
        async (): Promise<Array<ProxmoxRosterNode>> => {
          ownAtRosterLoad = storedLiveness("pve1");
          return deadSiblingRoster(NOW_MS);
        },
      );

      await push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster });

      expect(ownAtRosterLoad).toEqual(liveness(NOW_MS, NOW_MS));
    });

    test("reuses the cached roster, but reads its siblings on every push", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader(
        deadSiblingRoster(NOW_MS),
      );

      for (let offsetMs: number = 0; offsetMs <= 20_000; offsetMs += 10_000) {
        await expect(
          push({ selfNode: "pve1", nowMs: NOW_MS + offsetMs, loadRoster }),
        ).resolves.toBeNull();
      }

      expect(loadRoster).toHaveBeenCalledTimes(1);
      expect(mgetCalls).toHaveLength(3);
    });

    test("fails closed: a failing sibling read reports nothing, and the liveness is still recorded", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 60_000, NOW_MS - 10_000));
      seedLiveness("pve2", eligibleAt(NOW_MS - 5_000));
      failingCall = "getStrings";

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(liveAndDeadRoster(NOW_MS)),
        }),
      ).resolves.toBeNull();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("ETIMEDOUT");
      expect(storedLiveness("pve1")).toEqual(liveness(NOW_MS - 60_000, NOW_MS));
    });

    test("fails closed: a failing roster load reports nothing, and the liveness is still recorded", async () => {
      seedLiveness("pve2", eligibleAt(NOW_MS - 5_000));
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>();
      loadRoster.mockRejectedValue(new Error("too many clients already"));

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      expect(mgetCalls).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(storedLiveness("pve1")).toEqual(liveness(NOW_MS, NOW_MS));
    });
  });

  describe("an established reporter", () => {
    beforeEach(() => {
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS - 10_000));
    });

    test("reports a dead sibling", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader([
        rosterNode("pve1", NOW_MS),
        rosterNode("pve2", NOW_MS - 5_000),
        rosterNode("pve3", NOW_MS - 180_000),
      ]);
      seedLiveness("pve2", eligibleAt(NOW_MS - 5_000));

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

      expect(loadRoster).toHaveBeenCalledTimes(1);
      expect(loadRoster).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
      });
    });

    test("reads every sibling in one MGET, never its own key", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader([
        rosterNode("pve3", NOW_MS - 180_000),
        rosterNode("pve1", NOW_MS),
        rosterNode("pve2", NOW_MS),
      ]);

      await push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster });

      expect(mgetCalls).toHaveLength(1);
      expect(mgetCalls[0]?.namespace).toBe(LIVENESS_NAMESPACE);
      expect(mgetCalls[0]?.keys).toEqual([
        livenessKey("pve3"),
        livenessKey("pve2"),
      ]);
    });

    test("a roster of only itself: no sibling read, no report", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader([
        rosterNode("pve1", NOW_MS),
      ]);

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      expect(loadRoster).toHaveBeenCalledTimes(1);
      expect(mgetCalls).toHaveLength(0);
    });

    test("an empty roster: no sibling read, no report", async () => {
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster: rosterLoader([]) }),
      ).resolves.toBeNull();
      expect(mgetCalls).toHaveLength(0);
    });

    test("a reporter missing from the roster still reports its stale sibling", async () => {
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([rosterNode("pve2", NOW_MS - 180_000)]),
        }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    test("a sibling the agent still sights (no key, fresh lastSeenAt) is not reported", async () => {
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS),
            rosterNode("pve2", NOW_MS - 20_000),
          ]),
        }),
      ).resolves.toBeNull();
      expect(mgetCalls).toHaveLength(1);
    });

    test("another cluster's live key for the same node name does not count", async () => {
      const otherCluster: ObjectID = ObjectID.generate();
      seedLiveness("pve2", eligibleAt(NOW_MS), otherCluster);

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
        }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    test("another project's live key for the same cluster and node does not count", async () => {
      seedLiveness("pve2", eligibleAt(NOW_MS), CLUSTER_ID, ObjectID.generate());

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
        }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    test("a live sibling key is honoured", async () => {
      seedLiveness("pve2", liveness(NOW_MS - 20_000, NOW_MS - 10_000));

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
        }),
      ).resolves.toBeNull();
    });
  });

  // pve1 is the only live node: nobody else can establish the cluster.
  test("first push never reports; a 2-minute continuous streak does", async () => {
    const loadRoster: RosterLoaderMock = rosterLoader([
      rosterNode("pve1", NOW_MS),
      rosterNode("pve2", NOW_MS - 600_000),
    ]);

    const results: Array<ProxmoxSilentNodeDecision | null> = [];
    for (let pushIndex: number = 0; pushIndex <= 14; pushIndex++) {
      results.push(
        await push({
          selfNode: "pve1",
          nowMs: NOW_MS + pushIndex * PUSH_INTERVAL_MS,
          loadRoster,
        }),
      );
    }

    // Pushes at 0 s … 110 s: warming up.
    for (let pushIndex: number = 0; pushIndex < 12; pushIndex++) {
      expect(results[pushIndex]).toBeNull();
    }
    // Push at 120 s: exactly 2 minutes of streak.
    for (let pushIndex: number = 12; pushIndex <= 14; pushIndex++) {
      expect(results[pushIndex]).toEqual({
        silentNodes: ["pve2"],
        reporterCount: 1,
      });
    }
    /*
     * The sibling was read on every push, warm-up included: the reads
     * alone never make a report, the established streak does.
     */
    expect(
      mgetCalls.map((call: FakeMgetCall) => {
        return call.atMs;
      }),
    ).toEqual(
      Array.from({ length: 15 }, (_value: unknown, pushIndex: number) => {
        return NOW_MS + pushIndex * PUSH_INTERVAL_MS;
      }),
    );
  });

  /*
   * Again the only live node, so its own warm-up gates the report — pve2's
   * row is not Offline (no isUp), so each report after the gap is a first
   * report. For a sibling already Offline see the continuation block below.
   */
  test("a gap over 60 s in the reporter's own pushes restarts its warm-up", async () => {
    const loadRoster: RosterLoaderMock = rosterLoader([
      rosterNode("pve1", NOW_MS),
      rosterNode("pve2", NOW_MS - 600_000),
    ]);
    const pushTimesMs: Array<number> = [];
    for (let offsetMs: number = 0; offsetMs <= 110_000; offsetMs += 10_000) {
      pushTimesMs.push(NOW_MS + offsetMs);
    }
    // 70 s without a processed push, then steady again.
    for (
      let offsetMs: number = 180_000;
      offsetMs <= 320_000;
      offsetMs += 10_000
    ) {
      pushTimesMs.push(NOW_MS + offsetMs);
    }

    const firstReports: Array<number> = [];
    for (const atMs of pushTimesMs) {
      const decision: ProxmoxSilentNodeDecision | null = await push({
        selfNode: "pve1",
        nowMs: atMs,
        loadRoster,
      });
      if (decision) {
        firstReports.push(atMs);
      }
    }

    expect(firstReports[0]).toBe(NOW_MS + 180_000 + 120_000);
  });

  /*
   * Continuation through Redis and the roster loader: the roster's isUp and
   * notReportingMarkedAt (getNodeRoster's "isUp" and "notReportingMarkedAt",
   * Q) decide whether a silent sibling is reported while no node of the
   * cluster is established — only a row already Offline AND marked at most
   * 300 s before the roster was loaded (R: the module caches the roster
   * together with the time it loaded it, on this worker's clock, and every
   * push it serves judges the marks then). The rosters here are served as
   * they are; the timeline simulation below also writes the mark the way
   * markNodesNotReporting does, and clears it the way bulkUpsert does.
   */
  describe("continuation: a sibling already Offline, with no node established", () => {
    /*
     * pve1 reporting; pve2 alive with a fresh sighting; pve3 died 3 minutes
     * ago. The live rows carry no mark: their own sightings cleared it (Q).
     */
    function rosterWithDeadPve3(
      nowMs: number,
      pve3IsUp: boolean | null | undefined,
      pve3MarkedAtMs?: number | null | undefined,
    ): Array<ProxmoxRosterNode> {
      return [
        rosterNode("pve1", nowMs, true, null),
        rosterNode("pve2", nowMs - 5_000, true, null),
        rosterNode("pve3", nowMs - 180_000, pve3IsUp, pve3MarkedAtMs),
      ];
    }

    // pve1's streak restarted after a gap, pve2's 35 s: nobody established.
    function seedNobodyEstablished(): void {
      seedLiveness("pve1", liveness(NOW_MS - 60_000, NOW_MS - 10_000));
      seedLiveness("pve2", liveness(NOW_MS - 30_000, NOW_MS - 5_000));
    }

    test("a reporter warming up reports it, counting every node not reported", async () => {
      // pve3 was last marked 40 s ago.
      seedNobodyEstablished();

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(
            rosterWithDeadPve3(NOW_MS, false, NOW_MS - 40_000),
          ),
        }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

      expect(mgetCalls).toHaveLength(1);
      expect(mgetCalls[0]?.keys).toEqual([
        livenessKey("pve2"),
        livenessKey("pve3"),
      ]);
      // Nobody established: the reporter's streak is 60 s, pve2's 35 s.
      expect(isEligibleProxmoxReporter(storedLiveness("pve1"), NOW_MS)).toBe(
        false,
      );
      expect(isEligibleProxmoxReporter(storedLiveness("pve2"), NOW_MS)).toBe(
        false,
      );
      // M: the gate came from the roster alone — its own GET and SET, one MGET.
      expect(getCalls).toHaveLength(1);
      expect(setCalls).toHaveLength(1);
      expect(otherRedisCalls()).toEqual([]);
    });

    /*
     * R: the window is the monitors' own 300 s, taken when the roster is
     * loaded — here by this very push. O's 330 s on the push's clock is
     * gone: a mark 300 s + 1 ms old, or 330 s, continues nothing.
     */
    test("a mark exactly 300 s old when the roster is loaded still continues it; 1 ms older does not — nor does O's old 330 s", async () => {
      for (const markAgeMs of [
        0,
        40_000,
        PROXMOX_MONITOR_WINDOW_MS - 1,
        PROXMOX_MONITOR_WINDOW_MS,
      ]) {
        resetFakeState();
        seedNobodyEstablished();
        await expect(
          push({
            selfNode: "pve1",
            nowMs: NOW_MS,
            loadRoster: rosterLoader(
              rosterWithDeadPve3(NOW_MS, false, NOW_MS - markAgeMs),
            ),
          }),
        ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      }

      for (const markAgeMs of [PROXMOX_MONITOR_WINDOW_MS + 1, 330_000]) {
        resetFakeState();
        seedNobodyEstablished();
        await expect(
          push({
            selfNode: "pve1",
            nowMs: NOW_MS,
            loadRoster: rosterLoader(
              rosterWithDeadPve3(NOW_MS, false, NOW_MS - markAgeMs),
            ),
          }),
        ).resolves.toBeNull();
      }
    });

    // M, Q, R: the very same push when pve3's row was not marked in the last 300 s.
    test.each([
      {
        title: "marked 300 s + 1 ms ago",
        markedAtMs: NOW_MS - PROXMOX_MONITOR_WINDOW_MS - 1,
      },
      {
        title: "marked 330 s ago (O's old edge)",
        markedAtMs: NOW_MS - 330_000,
      },
      { title: "marked 10 minutes ago", markedAtMs: NOW_MS - 600_000 },
      { title: "with no notReportingMarkedAt (null)", markedAtMs: null },
      {
        title: "with no notReportingMarkedAt (left out)",
        markedAtMs: undefined,
      },
    ] as Array<{ title: string; markedAtMs: number | null | undefined }>)(
      "an Offline sibling $title is not continued: the same push reports nothing",
      async ({
        markedAtMs,
      }: {
        title: string;
        markedAtMs: number | null | undefined;
      }) => {
        seedNobodyEstablished();

        await expect(
          push({
            selfNode: "pve1",
            nowMs: NOW_MS,
            loadRoster: rosterLoader(
              rosterWithDeadPve3(NOW_MS, false, markedAtMs),
            ),
          }),
        ).resolves.toBeNull();

        // Not vacuous: pve3 was read, keyless, and its row is Offline.
        expect(mgetCalls[0]?.values).toEqual([
          serializeProxmoxNodeLiveness(
            liveness(NOW_MS - 30_000, NOW_MS - 5_000),
          ),
          null,
        ]);
        expect(otherRedisCalls()).toEqual([]);
        expect(warnings).toEqual([]);
      },
    );

    /*
     * A row not Offline carries no mark in Postgres (its own sighting
     * cleared it); given one anyway, it still continues nothing.
     */
    test.each(NOT_OFFLINE_STATES)(
      "a newly silent sibling ($title) still waits for an established node, however recently marked",
      async (state: RowState) => {
        seedNobodyEstablished();

        await expect(
          push({
            selfNode: "pve1",
            nowMs: NOW_MS,
            loadRoster: rosterLoader(
              rosterWithDeadPve3(NOW_MS, state.isUp, NOW_MS - 1_000),
            ),
          }),
        ).resolves.toBeNull();
        expect(mgetCalls).toHaveLength(1);

        // pve2 established: the same row is reported.
        resetFakeState();
        seedLiveness("pve1", liveness(NOW_MS - 60_000, NOW_MS - 10_000));
        seedLiveness("pve2", eligibleAt(NOW_MS - 5_000));
        await expect(
          push({
            selfNode: "pve1",
            nowMs: NOW_MS,
            loadRoster: rosterLoader(
              rosterWithDeadPve3(NOW_MS, state.isUp, NOW_MS - 1_000),
            ),
          }),
        ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      },
    );

    /*
     * Q, the database's clock: an Offline row the Proxmox Agent wrote (its
     * bulkUpsert set isUp false and cleared the mark) carries no mark, while
     * its updatedAt — the database's now() of that write — sits 200 s in
     * the future on a database clock running 10 minutes ahead. Read as a
     * mark, that updatedAt continued the row after a switch to the native
     * push. getNodeRoster does not select updatedAt; a row object that
     * carries one anyway is judged by its notReportingMarkedAt alone, on
     * every push and every roster load.
     */
    test("an agent-era Offline row — no mark, an updatedAt the database's clock dated 10 minutes ahead — is never continued", async () => {
      const agentWriteMs: number = NOW_MS - 400_000;
      const agentEraPve3: ProxmoxRosterNode & { updatedAt: Date } = {
        ...rosterNode("pve3", agentWriteMs, false, null),
        updatedAt: new Date(agentWriteMs + 600_000),
      };
      const loadRoster: RosterLoaderMock = rosterLoader([
        rosterNode("pve1", NOW_MS, true, null),
        rosterNode("pve2", NOW_MS - 5_000, true, null),
        agentEraPve3,
      ]);
      seedNobodyEstablished();

      // pve1's streak stays under 2 minutes; the roster is loaded twice.
      for (let offsetMs: number = 0; offsetMs <= 50_000; offsetMs += 10_000) {
        await expect(
          push({ selfNode: "pve1", nowMs: NOW_MS + offsetMs, loadRoster }),
        ).resolves.toBeNull();
      }
      expect(loadRoster).toHaveBeenCalledTimes(2);
      expect(
        isEligibleProxmoxReporter(storedLiveness("pve1"), NOW_MS + 50_000),
      ).toBe(false);
      // Not vacuous: pve3 was read keyless on every push.
      expect(mgetCalls).toHaveLength(6);
      for (const call of mgetCalls) {
        expect(call.values[call.keys.indexOf(livenessKey("pve3"))]).toBeNull();
      }

      // The same row once a node is established: reported.
      resetFakeState();
      seedLiveness("pve1", liveness(NOW_MS - 60_000, NOW_MS - 10_000));
      seedLiveness("pve2", eligibleAt(NOW_MS - 5_000));
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS, true, null),
            rosterNode("pve2", NOW_MS - 5_000, true, null),
            agentEraPve3,
          ]),
        }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

      // And once the live nodes' report has marked it: continued.
      resetFakeState();
      seedNobodyEstablished();
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS, true, null),
            rosterNode("pve2", NOW_MS - 5_000, true, null),
            { ...agentEraPve3, notReportingMarkedAt: new Date(NOW_MS - 5_000) },
          ]),
        }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
    });

    /*
     * I, through Redis. A OneUptime ingest outage of 3 minutes: every
     * liveness key expired during it, but pve3's mark — written by the
     * last report before it, 185 s ago — is inside the window. The first
     * push back reports the Offline pve3 at once and counts pve2 too:
     * pve2's key is not back yet and its sighting is from before the
     * outage, but its row is not Offline, so it is withheld and presumed
     * live. Counting the nodes with a key, that first push reported with
     * L = 1, and pve3 weighed D ÷ 1.
     */
    test("after a 3-minute ingest outage, the first push back reports it at once, counting every node not reported", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader([
        rosterNode("pve1", NOW_MS - 180_000, true, null),
        rosterNode("pve2", NOW_MS - 183_000, true, null),
        offlineNode("pve3", NOW_MS - 600_000, NOW_MS - 185_000),
      ]);

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      // Not vacuous: neither sibling had a key — pve1 was the only one.
      expect(mgetCalls[0]?.values).toEqual([null, null]);

      await expect(
        push({ selfNode: "pve2", nowMs: NOW_MS + 3_000, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 10_000, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

      // Both streaks restarted with the outage: this was all continuation.
      expect(storedLiveness("pve1")).toEqual(liveness(NOW_MS, NOW_MS + 10_000));
      expect(storedLiveness("pve2")).toEqual(
        liveness(NOW_MS + 3_000, NOW_MS + 3_000),
      );
      expect(otherRedisCalls()).toEqual([]);
    });

    /*
     * The same after a 10-minute outage: pve3's last mark, written before
     * it, is 610 s old when the first push back loads the roster — past the
     * window, so nothing is continued. pve3 is not reported again until a
     * node is established, 2 minutes after the first push back; then both
     * live nodes report it with L = 2.
     */
    test("after a 10-minute ingest outage the mark has aged out: nothing until a node is established again", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader([
        rosterNode("pve1", NOW_MS - 600_000, true, null),
        rosterNode("pve2", NOW_MS - 597_000, true, null),
        offlineNode("pve3", NOW_MS - 900_000, NOW_MS - 610_000),
      ]);

      const reportedAtMs: Array<number> = [];
      for (let offsetMs: number = 0; offsetMs <= 130_000; offsetMs += 10_000) {
        for (const [selfNode, phaseMs] of [
          ["pve1", 0],
          ["pve2", 3_000],
        ] as Array<[string, number]>) {
          const decision: ProxmoxSilentNodeDecision | null = await push({
            selfNode,
            nowMs: NOW_MS + offsetMs + phaseMs,
            loadRoster,
          });
          if (decision) {
            expect(decision).toEqual({
              silentNodes: ["pve3"],
              reporterCount: 2,
            });
            reportedAtMs.push(offsetMs + phaseMs);
          }
        }
      }

      expect(reportedAtMs).toEqual([120_000, 123_000, 130_000, 133_000]);
      // Not vacuous: every earlier push found pve3 keyless.
      expect(
        mgetCalls.every((call: FakeMgetCall) => {
          return call.values[call.keys.indexOf(livenessKey("pve3"))] === null;
        }),
      ).toBe(true);
      expect(mgetCalls).toHaveLength(28);
    });

    /*
     * M: a Redis flush — or a failover that lost the data — takes every
     * liveness key, but pve3's mark is in Postgres (written 20 s ago), so
     * nothing pauses: every push after the flush goes on reporting it with
     * L = 2, through the 2 minutes before a node is established again.
     * (Under J the flush took the window key too, and these pushes
     * reported nothing.) The roster here is static — its mark never
     * rewritten — and its last load, at +103 s, still finds it 123 s old.
     */
    test("after a Redis flush the mark is still there: every push goes on reporting it", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader(
        rosterWithDeadPve3(NOW_MS, false, NOW_MS - 20_000),
      );

      const reportedAtMs: Array<number> = [];
      const continuedAtMs: Array<number> = [];
      for (let offsetMs: number = 0; offsetMs <= 130_000; offsetMs += 10_000) {
        for (const [selfNode, phaseMs] of [
          ["pve1", 0],
          ["pve2", 3_000],
        ] as Array<[string, number]>) {
          const atMs: number = NOW_MS + offsetMs + phaseMs;
          const decision: ProxmoxSilentNodeDecision | null = await push({
            selfNode,
            nowMs: atMs,
            loadRoster,
          });
          if (decision) {
            expect(decision).toEqual({
              silentNodes: ["pve3"],
              reporterCount: 2,
            });
            reportedAtMs.push(offsetMs + phaseMs);
          }
          if (
            !isEligibleProxmoxReporter(storedLiveness("pve1"), atMs) &&
            !isEligibleProxmoxReporter(storedLiveness("pve2"), atMs)
          ) {
            continuedAtMs.push(offsetMs + phaseMs);
          }
        }
      }

      expect(reportedAtMs).toHaveLength(28);
      // The first 24 pushes were continuation: pve1 is established at +120 s.
      expect(continuedAtMs).toHaveLength(24);
      expect(continuedAtMs[continuedAtMs.length - 1]).toBe(113_000);
      // Loaded at 0, +33, +70 and +103 s (the cache serves each for 30 s).
      expect(loadRoster).toHaveBeenCalledTimes(4);
      expect(otherRedisCalls()).toEqual([]);
    });

    test("a lone survivor back after its own 90 s gap reports it on its first push back", async () => {
      // Its last report before the gap marked pve2 130 s ago.
      const roster: Array<ProxmoxRosterNode> = [
        rosterNode("pve1", NOW_MS, true, null),
        offlineNode("pve2", NOW_MS - 600_000, NOW_MS - 130_000),
      ];
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS - 90_000));

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(roster),
        }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      // Its streak restarted: this was continuation, not an established report.
      expect(storedLiveness("pve1")).toEqual(liveness(NOW_MS, NOW_MS));

      /*
       * The same gap with pve2 not Offline: its report waits — even with a
       * mark as recent (one Postgres would have cleared with isUp).
       */
      resetFakeState();
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS - 90_000));
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS, true, null),
            rosterNode("pve2", NOW_MS - 600_000, true, NOW_MS - 130_000),
          ]),
        }),
      ).resolves.toBeNull();

      // M: back after a gap past the window — pve2 last marked 6 minutes ago.
      resetFakeState();
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS, true, null),
            offlineNode("pve2", NOW_MS - 900_000, NOW_MS - 360_000),
          ]),
        }),
      ).resolves.toBeNull();
    });

    interface NeverRewrittenCase {
      title: string;
      // How old pve2's mark is at NOW.
      markAgeMs: number;
      reportedMs: Array<number>;
    }

    /*
     * The record-level counterpart of "a gap over 60 s in the reporter's
     * own pushes restarts its warm-up" above, with pve2 already Offline and
     * its mark NEVER rewritten (a static roster — as if markNodesNotReporting
     * never landed again). pve1 pushes every 10 s up to +110 s, goes quiet
     * for 70 s (its streak restarts at +180 s), and pushes again to +320 s.
     * The cache serves each roster for 30 s, so the roster is loaded at 0,
     * +40, +80, +180, +220, +260 and +300 s, and R judges the mark at those
     * loads: every push a load finds the mark at most 300 s old reports
     * pve2 — the ones it serves after it included, though the mark is over
     * 300 s old by their own clock — and after the last such load nothing
     * is reported until pve1's own streak establishes it again at +300 s.
     * In the ingest the continuation reports keep rewriting the mark, and
     * every push reports (see "a lone survivor's own gap" in the timeline).
     */
    const neverRewrittenCases: Array<NeverRewrittenCase> = [
      {
        // Loads find it 130, 170, 210 s old, then 310 s at +180 s.
        title: "marked 130 s before: continued up to the gap, not after it",
        markAgeMs: 130_000,
        reportedMs: [
          0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000,
          90_000, 100_000, 110_000, 300_000, 310_000, 320_000,
        ],
      },
      {
        /*
         * Loads find it 260 s old, then exactly 300 s at +40 s — which
         * carries the pushes to +70 s, 330 s old by their clock — then
         * 340 s at +80 s.
         */
        title:
          "marked 260 s before: the load finding it exactly 300 s old carries its pushes",
        markAgeMs: 260_000,
        reportedMs: [
          0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 300_000,
          310_000, 320_000,
        ],
      },
    ];

    test.each(neverRewrittenCases)(
      "a lone survivor whose sibling's mark is never rewritten: continued while a roster load finds the mark within 300 s, then waits for its own streak ($title)",
      async (neverRewritten: NeverRewrittenCase) => {
        const loadedAtMs: Array<number> = [];
        const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
          async (): Promise<Array<ProxmoxRosterNode>> => {
            loadedAtMs.push(clockMs - NOW_MS);
            return [
              rosterNode("pve1", NOW_MS, true, null),
              offlineNode(
                "pve2",
                NOW_MS - 600_000,
                NOW_MS - neverRewritten.markAgeMs,
              ),
            ];
          },
        );
        const pushOffsetsMs: Array<number> = [];
        for (
          let offsetMs: number = 0;
          offsetMs <= 110_000;
          offsetMs += 10_000
        ) {
          pushOffsetsMs.push(offsetMs);
        }
        for (
          let offsetMs: number = 180_000;
          offsetMs <= 320_000;
          offsetMs += 10_000
        ) {
          pushOffsetsMs.push(offsetMs);
        }

        const reported: Array<number> = [];
        for (const offsetMs of pushOffsetsMs) {
          const decision: ProxmoxSilentNodeDecision | null = await push({
            selfNode: "pve1",
            nowMs: NOW_MS + offsetMs,
            loadRoster,
          });
          if (decision) {
            expect(decision).toEqual({
              silentNodes: ["pve2"],
              reporterCount: 1,
            });
            reported.push(offsetMs);
          }
        }

        expect(reported).toEqual(neverRewritten.reportedMs);
        expect(loadedAtMs).toEqual([
          0, 40_000, 80_000, 180_000, 220_000, 260_000, 300_000,
        ]);
        // Every continued push's roster was loaded with the mark ≤ 300 s old.
        for (const offsetMs of reported) {
          if (offsetMs >= 300_000) {
            continue;
          }
          const loadMs: number = loadedAtMs
            .filter((atMs: number) => {
              return atMs <= offsetMs;
            })
            .pop() as number;
          expect(loadMs + neverRewritten.markAgeMs).toBeLessThanOrEqual(
            PROXMOX_MONITOR_WINDOW_MS,
          );
        }
        // The streak did restart at the gap: +300 s is its own 2 minutes.
        expect(storedLiveness("pve1")?.streakStartMs).toBe(NOW_MS + 180_000);
        expect(otherRedisCalls()).toEqual([]);
      },
    );

    /*
     * A node back from the dead: its first push sets its key. The roster
     * cached for 30 s still shows its row Offline, stale and marked a
     * moment ago, and it is not reported again.
     */
    test("a node back is never reported again, though the cached roster still shows it Offline", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 30_000, NOW_MS - 10_000));
      const loadRoster: RosterLoaderMock = rosterLoader([
        rosterNode("pve1", NOW_MS, true, null),
        offlineNode("pve3", NOW_MS - 180_000, NOW_MS - 5_000),
      ]);

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 1 });
      // pve3's first push back: it never reports itself.
      await expect(
        push({ selfNode: "pve3", nowMs: NOW_MS + 2_000, loadRoster }),
      ).resolves.toBeNull();
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 10_000, loadRoster }),
      ).resolves.toBeNull();
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 20_000, loadRoster }),
      ).resolves.toBeNull();

      // Not vacuous: every push was served the roster with pve3 Offline.
      expect(loadRoster).toHaveBeenCalledTimes(1);
      expect(otherRedisCalls()).toEqual([]);
    });

    /*
     * The Offline mark reaches the decision through the 30 s roster cache:
     * pve3 turns Offline in the inventory (marked at NOW + 5 s, by another
     * worker's report) after the first push, and the reporter (warming up,
     * the only live node) reports it once its cached roster expires.
     */
    test("the Offline mark takes effect once the cached roster expires", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 30_000, NOW_MS - 10_000));
      let pve3IsUp: boolean = true;
      let pve3MarkedAtMs: number | null = null;
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
        async (): Promise<Array<ProxmoxRosterNode>> => {
          return [
            rosterNode("pve1", NOW_MS, true, null),
            rosterNode("pve3", NOW_MS - 180_000, pve3IsUp, pve3MarkedAtMs),
          ];
        },
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();
      pve3IsUp = false;
      pve3MarkedAtMs = NOW_MS + 5_000;
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 20_000, loadRoster }),
      ).resolves.toBeNull();
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 40_000, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 1 });

      expect(loadRoster).toHaveBeenCalledTimes(2);
      // Still warming up: this is continuation.
      expect(
        isEligibleProxmoxReporter(storedLiveness("pve1"), NOW_MS + 40_000),
      ).toBe(false);
    });

    /*
     * So does a rewritten mark: pve3 is Offline with a mark 400 s old, so
     * nothing is continued; another worker's established report re-marks
     * it at NOW + 5 s, and the reporter continues it once its cached
     * roster expires.
     */
    test("a rewritten mark takes effect once the cached roster expires", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 30_000, NOW_MS - 10_000));
      let pve3MarkedAtMs: number = NOW_MS - 400_000;
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
        async (): Promise<Array<ProxmoxRosterNode>> => {
          return [
            rosterNode("pve1", NOW_MS, true, null),
            offlineNode("pve3", NOW_MS - 900_000, pve3MarkedAtMs),
          ];
        },
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();
      pve3MarkedAtMs = NOW_MS + 5_000;
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 20_000, loadRoster }),
      ).resolves.toBeNull();
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 40_000, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve3"], reporterCount: 1 });

      expect(loadRoster).toHaveBeenCalledTimes(2);
      expect(
        isEligibleProxmoxReporter(storedLiveness("pve1"), NOW_MS + 40_000),
      ).toBe(false);
    });

    test("fails closed: a failing sibling read reports nothing", async () => {
      seedLiveness("pve1", liveness(NOW_MS - 60_000, NOW_MS - 10_000));
      failingCall = "getStrings";

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(
            rosterWithDeadPve3(NOW_MS, false, RECENT_MARK_MS),
          ),
        }),
      ).resolves.toBeNull();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("ETIMEDOUT");
    });
  });

  /*
   * M removed J's per-cluster window key: nothing in Redis says whether
   * the cluster was established lately. Every push — established,
   * continuation, or neither — GETs and SETs its own liveness key and
   * MGETs its siblings', and makes no other Redis call; the gate is the
   * roster's per-node mark (Q), read through the per-cluster roster cache
   * and judged at the cache's load (R).
   */
  describe("the continuation gate lives in the roster, not in Redis", () => {
    // pve1 reporting; pve2 dead 10 minutes and already Offline.
    function offlinePve2Roster(
      nowMs: number,
      markedAtMs: number,
    ): Array<ProxmoxRosterNode> {
      return [
        rosterNode("pve1", nowMs, true, null),
        offlineNode("pve2", nowMs - 600_000, markedAtMs),
      ];
    }

    test("no push reads or writes anything but liveness keys, whatever it decides", async () => {
      // Continuation: pve1 warming up, pve2 Offline and marked 30 s ago.
      seedLiveness("pve1", liveness(NOW_MS - 30_000, NOW_MS - 10_000));
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(offlinePve2Roster(NOW_MS, RECENT_MARK_MS)),
        }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      // One GET and one SET of its own key, one MGET of its sibling's.
      expect([getCalls.length, setCalls.length, mgetCalls.length]).toEqual([
        1, 1, 1,
      ]);

      // Nobody established, the mark aged (300 s + 1 ms at this push's load): nothing.
      clearProxmoxNodeRosterCache();
      const agedMarkMs: number =
        NOW_MS + 10_000 - PROXMOX_MONITOR_WINDOW_MS - 1;
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS + 10_000,
          loadRoster: rosterLoader(offlinePve2Roster(NOW_MS, agedMarkMs)),
        }),
      ).resolves.toBeNull();

      // Established, reporting whatever the mark.
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS + 15_000));
      clearProxmoxNodeRosterCache();
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS + 20_000,
          loadRoster: rosterLoader(offlinePve2Roster(NOW_MS, agedMarkMs)),
        }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });

      // Established, nothing to report.
      seedLiveness("pve2", eligibleAt(NOW_MS + 24_000));
      clearProxmoxNodeRosterCache();
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS + 25_000,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS + 20_000, true, null),
            rosterNode("pve2", NOW_MS + 24_000, true, null),
          ]),
        }),
      ).resolves.toBeNull();

      // A standalone host, and an empty roster.
      clearProxmoxNodeRosterCache();
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS + 30_000,
          loadRoster: rosterLoader([
            rosterNode("pve1", NOW_MS + 25_000, true, null),
          ]),
        }),
      ).resolves.toBeNull();
      clearProxmoxNodeRosterCache();
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS + 40_000,
          loadRoster: rosterLoader([]),
        }),
      ).resolves.toBeNull();

      // Six pushes: six GETs and SETs of its own key, four MGETs, nothing else.
      expect(otherRedisCalls()).toEqual([]);
      expect(getCalls).toHaveLength(6);
      expect(setCalls).toHaveLength(6);
      expect(mgetCalls).toHaveLength(4);
      expect(
        getCalls.every((call: FakeGetCall) => {
          return call.key === livenessKey("pve1");
        }),
      ).toBe(true);
      expect(
        setCalls.every((call: FakeSetCall) => {
          return (
            call.key === livenessKey("pve1") && call.expiresInSeconds === 120
          );
        }),
      ).toBe(true);
      expect(warnings).toEqual([]);
    });

    /*
     * R: the marks are judged when the roster is loaded, and every push the
     * cached roster serves keeps that judgement. A lone survivor back after
     * a gap loads the roster with pve2's mark exactly 300 s old: that push
     * and every push the cache serves — up to 30 s later, the mark 330 s
     * old by their own clock — continue it; the next load finds it older
     * than 300 s, and nothing more is continued. A roster loaded 1 ms later
     * than the first continues nothing for the whole of its life.
     */
    test("a roster loaded with the mark exactly 300 s old continues it for the cache's whole life; one loaded 1 ms later never does", async () => {
      const loadedAtMs: number = NOW_MS + PROXMOX_MONITOR_WINDOW_MS;
      const loadRoster: RosterLoaderMock = rosterLoader(
        offlinePve2Roster(NOW_MS, NOW_MS),
      );

      for (const sinceLoadMs of [
        0,
        1,
        10_000,
        20_000,
        PROXMOX_ROSTER_CACHE_TTL_MS,
      ]) {
        await expect(
          push({
            selfNode: "pve1",
            nowMs: loadedAtMs + sinceLoadMs,
            loadRoster,
          }),
        ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      }
      expect(loadRoster).toHaveBeenCalledTimes(1);
      // The next load: the mark 330 s + 1 ms old.
      await expect(
        push({
          selfNode: "pve1",
          nowMs: loadedAtMs + PROXMOX_ROSTER_CACHE_TTL_MS + 1,
          loadRoster,
        }),
      ).resolves.toBeNull();
      expect(loadRoster).toHaveBeenCalledTimes(2);
      // Not vacuous: nobody was established — all of it was continuation.
      expect(
        isEligibleProxmoxReporter(
          storedLiveness("pve1"),
          loadedAtMs + PROXMOX_ROSTER_CACHE_TTL_MS + 1,
        ),
      ).toBe(false);

      // Loaded 1 ms later: nothing, on every push that roster serves.
      resetFakeState();
      const lateLoader: RosterLoaderMock = rosterLoader(
        offlinePve2Roster(NOW_MS, NOW_MS),
      );
      for (const sinceLoadMs of [0, 10_000, PROXMOX_ROSTER_CACHE_TTL_MS]) {
        await expect(
          push({
            selfNode: "pve1",
            nowMs: loadedAtMs + 1 + sinceLoadMs,
            loadRoster: lateLoader,
          }),
        ).resolves.toBeNull();
      }
      expect(lateLoader).toHaveBeenCalledTimes(1);
      expect(mgetCalls).toHaveLength(3);
    });

    /*
     * R's reason, through the roster cache: this worker cached a roster
     * whose mark for pve2 was exactly 5 minutes old; a moment later (NOW +
     * 5 s) another worker's report rewrote it. The pushes served that
     * roster, up to +30 s, find the old mark over 300 s old by their own
     * clock — judged on it, they dropped the report until the reload read
     * the new mark: reported, unreported, reported. Judged at the load (R),
     * every one of them continues it, and the reload then reads the fresh
     * mark: no hole.
     */
    test("a roster cached just before the mark was rewritten still continues it for the cache's whole life", async () => {
      const oldMarkMs: number = NOW_MS - PROXMOX_MONITOR_WINDOW_MS;
      let pve2MarkMs: number = oldMarkMs;
      const loadedAtMs: Array<number> = [];
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
        async (): Promise<Array<ProxmoxRosterNode>> => {
          loadedAtMs.push(clockMs - NOW_MS);
          return offlinePve2Roster(NOW_MS, pve2MarkMs);
        },
      );

      const reported: Array<number> = [];
      for (
        let offsetMs: number = 0;
        offsetMs <= 2 * PROXMOX_ROSTER_CACHE_TTL_MS + 20_000;
        offsetMs += 5_000
      ) {
        const decision: ProxmoxSilentNodeDecision | null = await push({
          selfNode: "pve1",
          nowMs: NOW_MS + offsetMs,
          loadRoster,
        });
        if (offsetMs === 0) {
          // Rewritten in Postgres right after this worker cached the roster.
          pve2MarkMs = NOW_MS + 5_000;
        }
        if (decision) {
          expect(decision).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
          reported.push(offsetMs);
        }
      }

      // Every push reported: 0 … +30 s on the old mark, then the new one.
      expect(reported).toEqual([
        0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000,
        45_000, 50_000, 55_000, 60_000, 65_000, 70_000, 75_000, 80_000,
      ]);
      expect(loadedAtMs).toEqual([0, 35_000, 70_000]);
      // And no node was established: every one of them was continuation.
      expect(
        isEligibleProxmoxReporter(storedLiveness("pve1"), NOW_MS + 80_000),
      ).toBe(false);

      /*
       * Not vacuous: judged at their own time, the pushes at +5 … +30 s
       * would have dropped the report — the hole R closes.
       */
      for (
        let offsetMs: number = 5_000;
        offsetMs <= 30_000;
        offsetMs += 5_000
      ) {
        const input: Parameters<typeof decideProxmoxSilentNodes>[0] = {
          selfNode: "pve1",
          reporterTimeMs: NOW_MS + offsetMs,
          nowMs: NOW_MS + offsetMs,
          roster: offlinePve2Roster(NOW_MS, oldMarkMs),
          liveness: livenessMap({
            pve1: liveness(NOW_MS, NOW_MS + offsetMs),
            pve2: null,
          }),
        };
        expect(decideProxmoxSilentNodes(input)).toBeNull();
        expect(
          decideProxmoxSilentNodes({ ...input, rosterReadAtMs: NOW_MS }),
        ).toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      }
    });

    // Each cluster's roster, and so each cluster's marks, is its own.
    test("is kept per cluster: another cluster's recent mark continues nothing here", async () => {
      const otherCluster: ObjectID = ObjectID.generate();
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
        async (data: {
          projectId: ObjectID;
          proxmoxClusterId: ObjectID;
        }): Promise<Array<ProxmoxRosterNode>> => {
          return data.proxmoxClusterId.toString() === otherCluster.toString()
            ? offlinePve2Roster(NOW_MS, RECENT_MARK_MS)
            : offlinePve2Roster(NOW_MS, NOW_MS - 600_000);
        },
      );

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          proxmoxClusterId: otherCluster,
          loadRoster,
        }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 1_000, loadRoster }),
      ).resolves.toBeNull();
      expect(loadRoster).toHaveBeenCalledTimes(2);
    });

    /*
     * R, per cluster: each cluster's cached roster keeps its own load time.
     * Cluster A's roster is loaded at NOW, cluster B's at NOW + 20 s, both
     * with a mark at NOW − 290 s. At NOW + 25 s both are served from the
     * cache: A's was loaded with the mark 290 s old, B's with it 310 s old.
     */
    test("each cluster's roster keeps its own load time", async () => {
      const clusterB: ObjectID = ObjectID.generate();
      const loadRoster: RosterLoaderMock = rosterLoader(
        offlinePve2Roster(NOW_MS, NOW_MS - 290_000),
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS + 20_000,
          proxmoxClusterId: clusterB,
          loadRoster,
        }),
      ).resolves.toBeNull();

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 25_000, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS + 25_000,
          proxmoxClusterId: clusterB,
          loadRoster,
        }),
      ).resolves.toBeNull();
      expect(loadRoster).toHaveBeenCalledTimes(2);
    });
  });

  describe("the roster cache", () => {
    beforeEach(() => {
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS - 10_000));
    });

    /*
     * Served for up to PROXMOX_ROSTER_CACHE_TTL_MS (30 s) after the load,
     * that instant included — and every push it serves judges the marks at
     * the load (R; see the continuation gate above).
     */
    test("loads the roster once per 30 s per cluster", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader(
        deadSiblingRoster(NOW_MS),
      );

      await push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster });
      await push({ selfNode: "pve1", nowMs: NOW_MS + 10_000, loadRoster });
      await push({ selfNode: "pve1", nowMs: NOW_MS + 29_999, loadRoster });
      await push({
        selfNode: "pve1",
        nowMs: NOW_MS + PROXMOX_ROSTER_CACHE_TTL_MS,
        loadRoster,
      });
      expect(loadRoster).toHaveBeenCalledTimes(1);

      await push({
        selfNode: "pve1",
        nowMs: NOW_MS + PROXMOX_ROSTER_CACHE_TTL_MS + 1,
        loadRoster,
      });
      expect(loadRoster).toHaveBeenCalledTimes(2);
    });

    test("serves the cached roster to every node of the cluster", async () => {
      seedLiveness("pve3", liveness(NOW_MS - 600_000, NOW_MS - 10_000));
      const loadRoster: RosterLoaderMock = rosterLoader([
        rosterNode("pve1", NOW_MS),
        rosterNode("pve2", NOW_MS - 180_000),
        rosterNode("pve3", NOW_MS),
      ]);

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 2 });
      await expect(
        push({ selfNode: "pve3", nowMs: NOW_MS + 3_000, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 2 });

      expect(loadRoster).toHaveBeenCalledTimes(1);
    });

    test("a roster change is seen only once the cache expires", async () => {
      let roster: Array<ProxmoxRosterNode> = [rosterNode("pve1", NOW_MS)];
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
        async (): Promise<Array<ProxmoxRosterNode>> => {
          return roster;
        },
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      roster = deadSiblingRoster(NOW_MS);
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 20_000, loadRoster }),
      ).resolves.toBeNull();
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 40_000, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });
    });

    test("is kept per cluster", async () => {
      const otherCluster: ObjectID = ObjectID.generate();
      seedLiveness(
        "pve1",
        liveness(NOW_MS - 600_000, NOW_MS - 10_000),
        otherCluster,
      );
      const loadRoster: RosterLoaderMock = rosterLoader(
        deadSiblingRoster(NOW_MS),
      );

      await push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster });
      await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        proxmoxClusterId: otherCluster,
        loadRoster,
      });

      expect(loadRoster).toHaveBeenCalledTimes(2);
      expect(loadRoster.mock.calls[1]?.[0]).toEqual({
        projectId: PROJECT_ID,
        proxmoxClusterId: otherCluster,
      });
    });

    test("clearProxmoxNodeRosterCache drops it", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader(
        deadSiblingRoster(NOW_MS),
      );

      await push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster });
      clearProxmoxNodeRosterCache();
      await push({ selfNode: "pve1", nowMs: NOW_MS + 1_000, loadRoster });

      expect(loadRoster).toHaveBeenCalledTimes(2);
    });

    test("a failed load is not cached: the next push retries", async () => {
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>();
      loadRoster.mockRejectedValueOnce(new Error("connection terminated"));
      loadRoster.mockResolvedValue(deadSiblingRoster(NOW_MS));

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();
      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS + 1_000, loadRoster }),
      ).resolves.toEqual({ silentNodes: ["pve2"], reporterCount: 1 });

      expect(loadRoster).toHaveBeenCalledTimes(2);
    });
  });

  describe("fails closed: any error reports nothing and never throws", () => {
    beforeEach(() => {
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS - 10_000));
    });

    test("GET of its own key throws", async () => {
      failingCall = "getString";
      const loadRoster: RosterLoaderMock = rosterLoader(
        deadSiblingRoster(NOW_MS),
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      expect(setCalls).toHaveLength(0);
      expect(loadRoster).not.toHaveBeenCalled();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(CLUSTER_ID.toString());
      expect(warnings[0]).toContain("Cache is not connected");
    });

    test("SET of its own key throws", async () => {
      failingCall = "setString";
      const loadRoster: RosterLoaderMock = rosterLoader(
        deadSiblingRoster(NOW_MS),
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      expect(loadRoster).not.toHaveBeenCalled();
      expect(mgetCalls).toHaveLength(0);
      expect(warnings).toHaveLength(1);
    });

    test("MGET of the siblings throws", async () => {
      failingCall = "getStrings";

      await expect(
        push({
          selfNode: "pve1",
          nowMs: NOW_MS,
          loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
        }),
      ).resolves.toBeNull();

      expect(mgetCalls).toHaveLength(1);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("ETIMEDOUT");
    });

    test("the roster load throws", async () => {
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>();
      loadRoster.mockRejectedValue(new Error("too many clients already"));

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      expect(mgetCalls).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("too many clients already");
    });

    test("a non-Error rejection is handled the same way", async () => {
      const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
        (): Promise<Array<ProxmoxRosterNode>> => {
          return Promise.reject("socket hang up");
        },
      );

      await expect(
        push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster }),
      ).resolves.toBeNull();

      expect(warnings[0]).toContain("socket hang up");
    });

    test("the liveness is still recorded when only the sibling check fails", async () => {
      failingCall = "getStrings";

      await push({
        selfNode: "pve1",
        nowMs: NOW_MS,
        loadRoster: rosterLoader(deadSiblingRoster(NOW_MS)),
      });

      expect(storedLiveness("pve1")).toEqual(
        liveness(NOW_MS - 600_000, NOW_MS),
      );
    });
  });
});

/*
 * ------------------------------------------------------------------
 * Timeline simulation
 * ------------------------------------------------------------------
 *
 * Nodes push their status every 10 s (each at its own phase inside the
 * cycle) and the real recordProxmoxNodePushAndFindSilentNodes runs for
 * every push that OneUptime processes, on the simulated clock. After each
 * push the inventory is written the way the ingest flush writes it:
 *   - the node's own row (bulkUpsert, never moving lastSeenAt back): the
 *     push's own time (on the node's clock), Online, and — Q — its mark,
 *     notReportingMarkedAt, cleared;
 *   - then every node the push reported whose row is older than the
 *     report's time minus 2 minutes (markNodesNotReporting): a row still
 *     Online, or with no mark, flips to Offline and is marked; a row
 *     already Offline has its mark rewritten only when it is more than
 *     60 s old. The mark is written as markedAt — the ingest worker's own
 *     clock at the flush (here the push's processing time, atMs) — and the
 *     refresh guard compares it on that same clock (P). (The UPDATE's
 *     "isNativePush IS DISTINCT FROM true" arm is not modelled: only this
 *     UPDATE writes a mark, and it sets isNativePush with it, so a row not
 *     yet native carries no mark and is marked on its first report anyway.)
 * So while a node keeps being reported, by established pushes or by
 * continuation, its mark is refreshed at most once a minute, and nothing
 * else ever writes it. Each write also stamps updatedAt with the
 * database's now() — `databaseClockAheadMs` sets how far that clock runs
 * ahead of the worker's (0 by default) — but the roster does not carry
 * updatedAt (Q). Adopting the cluster's rows into the native-push keep
 * (adoptNodesAsNativePush) sets only isNativePush, which the roster does
 * not carry either: it changes nothing here.
 *
 * The roster loader serves that inventory — nodeName, lastSeenAt, isUp and
 * notReportingMarkedAt, as getNodeRoster selects them — through the
 * module's 30 s roster cache, which keeps the time it loaded it and judges
 * every mark then (R). `markOffline: false` models the Offline write never
 * landing (no flip, no mark). Redis holds only the liveness keys: a flush
 * or an outage loses those, never a mark. Two more options put back the
 * rules P and Q replaced, only to show what they got wrong.
 */

const T0: number = NOW_MS;

// Three nodes resuming after an outage: when each comes back, and its phase.
interface ResumeCase {
  staggersMs: [number, number, number];
  phasesMs: [number, number, number];
}

interface SimNode {
  name: string;
  // Offset of this node's pushes inside its cycle.
  phaseMs: number;
  // OneUptime-clock ranges (inclusive) in which its pushes are processed.
  windows: Array<[number, number]>;
  periodMs?: number | undefined;
  // The node's clock minus OneUptime's.
  clockSkewMs?: number | undefined;
  // Only sighted by the Proxmox Agent: refreshes the inventory, no push.
  agentOnly?: boolean | undefined;
  /*
   * OneUptime processes this node's pushes in bursts (a queue stall): a
   * push is processed at the first of these times at or after it, in
   * order. A push after the last burst is never processed.
   */
  burstsMs?: Array<number> | undefined;
}

interface SimAction {
  atMs: number;
  run: () => void;
}

interface SimPush {
  // When OneUptime processed the push.
  atMs: number;
  // When the node pushed (OneUptime's clock) — its points' own time.
  pushMs: number;
  node: string;
  decision: ProxmoxSilentNodeDecision | null;
  /*
   * Whether any node of the cluster was established right after this
   * push was recorded — the module's own gate, re-derived from Redis. A
   * report while it is false is continuation.
   */
  clusterEstablished: boolean;
  /*
   * The nodes (roster ∪ reporter, as this push read them) with a live key:
   * the reporterCount the rule before I used, which undercounted L while
   * live nodes were not processed yet. Null when no sibling was read.
   */
  keyedLiveCount: number | null;
  /*
   * R: when the roster this push's decision used was loaded — the cached
   * one, as served; this push's own time when it loaded it itself.
   */
  rosterReadAtMs: number;
  /*
   * Q, R: each Offline row of that roster, with its mark's age when the
   * roster was loaded (rosterReadAtMs − notReportingMarkedAt) — the age the
   * module judges — or null for an Offline row with no mark.
   */
  offlineMarkAgesMs: Map<string, number | null>;
}

interface SimEvent {
  atMs: number;
  pushMs: number;
  node: SimNode;
}

interface SimInventoryRow {
  // The node's own last push, on its clock.
  lastSeenMs: number;
  isUp: boolean;
  /*
   * Q: notReportingMarkedAt — when markNodesNotReporting last marked the
   * row, on the worker's clock; null for a row never marked, or whose mark
   * its own sighting cleared.
   */
  markedAtMs: number | null;
  // When the database last wrote the row, on its own clock (now()).
  updatedAtMs: number;
}

interface SimOfflineMark {
  atMs: number;
  node: string;
}

/*
 * markNodesNotReporting rewrites an Offline row's mark only when it is
 * older than markedAt minus this (P: both on the worker's clock).
 */
const MARK_REFRESH_MS: number = 60_000;

/*
 * The inventory of the last simulate() run, every Online → Offline flip,
 * and every mark written (flips and refreshes of a row already Offline).
 */
let simInventory: Map<string, SimInventoryRow> = new Map<
  string,
  SimInventoryRow
>();
let simOfflineMarks: Array<SimOfflineMark> = [];
let simMarkWrites: Array<SimOfflineMark> = [];

function clusterEstablishedAt(selfNode: string, atMs: number): boolean {
  const nodeNames: Set<string> = new Set<string>([
    ...simInventory.keys(),
    selfNode,
  ]);
  return Array.from(nodeNames).some((nodeName: string) => {
    return isEligibleProxmoxReporter(storedLiveness(nodeName), atMs);
  });
}

async function simulate(data: {
  nodes: Array<SimNode>;
  untilMs: number;
  actions?: Array<SimAction> | undefined;
  // Whether reported nodes turn Offline in the inventory (default true).
  markOffline?: boolean | undefined;
  // How far the database's clock (its now(), on every write) runs ahead of the worker's.
  databaseClockAheadMs?: number | undefined;
  /*
   * The rule before P: the mark written, and its refresh guard compared,
   * on the database's now() instead of the worker's markedAt.
   */
  marksOnDatabaseClock?: boolean | undefined;
  /*
   * The rule before Q: no mark column — the roster served updatedAt as the
   * mark, and markNodesNotReporting wrote and compared updatedAt. So every
   * other write of updatedAt (the agent's bulkUpsert on the database's
   * clock, an adoption that stamped it) passed for a mark.
   */
  rosterMarkFromUpdatedAt?: boolean | undefined;
}): Promise<Array<SimPush>> {
  const markOffline: boolean = data.markOffline ?? true;
  const databaseClockAheadMs: number = data.databaseClockAheadMs ?? 0;
  const marksOnDatabaseClock: boolean = data.marksOnDatabaseClock ?? false;
  const rosterMarkFromUpdatedAt: boolean =
    data.rosterMarkFromUpdatedAt ?? false;
  const events: Array<SimEvent> = [];
  for (const node of data.nodes) {
    const periodMs: number = node.periodMs ?? PUSH_INTERVAL_MS;
    for (
      let pushMs: number = T0 + node.phaseMs;
      pushMs <= data.untilMs;
      pushMs += periodMs
    ) {
      const processed: boolean = node.windows.some(
        ([fromMs, toMs]: [number, number]) => {
          return pushMs >= fromMs && pushMs <= toMs;
        },
      );
      if (!processed) {
        continue;
      }
      if (!node.burstsMs) {
        events.push({ atMs: pushMs, pushMs, node });
        continue;
      }
      const burstMs: number | undefined = node.burstsMs.find(
        (candidateMs: number) => {
          return candidateMs >= pushMs;
        },
      );
      if (burstMs !== undefined) {
        events.push({ atMs: burstMs, pushMs, node });
      }
    }
  }
  events.sort((a: SimEvent, b: SimEvent) => {
    return (
      a.atMs - b.atMs ||
      a.node.name.localeCompare(b.node.name) ||
      a.pushMs - b.pushMs
    );
  });

  const actions: Array<SimAction> = [...(data.actions || [])].sort(
    (a: SimAction, b: SimAction) => {
      return a.atMs - b.atMs;
    },
  );
  let nextAction: number = 0;

  simInventory = new Map<string, SimInventoryRow>();
  simOfflineMarks = [];
  simMarkWrites = [];
  const inventory: Map<string, SimInventoryRow> = simInventory;
  // A new cluster: no roster cached from an earlier run.
  clearProxmoxNodeRosterCache();

  // The mark as the roster serves it: Q's column, or (before Q) updatedAt.
  const markOf: (row: SimInventoryRow) => number | null = (
    row: SimInventoryRow,
  ): number | null => {
    return rosterMarkFromUpdatedAt ? row.updatedAtMs : row.markedAtMs;
  };

  // What the loader last served, and when — what the module's roster cache holds.
  const served: { roster: Array<ProxmoxRosterNode>; atMs: number | null } = {
    roster: [],
    atMs: null,
  };
  const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
    async (): Promise<Array<ProxmoxRosterNode>> => {
      served.atMs = clockMs;
      served.roster = Array.from(inventory.entries()).map(
        ([nodeName, row]: [string, SimInventoryRow]) => {
          return rosterNode(nodeName, row.lastSeenMs, row.isUp, markOf(row));
        },
      );
      return served.roster;
    },
  );

  /*
   * A node's own sighting (its push, or the agent's scrape) — bulkUpsert:
   * Online, the mark cleared (Q), updatedAt the database's now().
   */
  const sight: (nodeName: string, nodeTimeMs: number, atMs: number) => void = (
    nodeName: string,
    nodeTimeMs: number,
    atMs: number,
  ): void => {
    const row: SimInventoryRow | undefined = inventory.get(nodeName);
    if (!row || nodeTimeMs >= row.lastSeenMs) {
      inventory.set(nodeName, {
        lastSeenMs: nodeTimeMs,
        isUp: true,
        markedAtMs: null,
        updatedAtMs: atMs + databaseClockAheadMs,
      });
    }
  };

  const pushes: Array<SimPush> = [];
  for (const event of events) {
    for (;;) {
      const action: SimAction | undefined = actions[nextAction];
      if (!action || action.atMs > event.atMs) {
        break;
      }
      clockMs = action.atMs;
      action.run();
      nextAction++;
    }

    const nodeTimeMs: number = event.pushMs + (event.node.clockSkewMs ?? 0);
    if (event.node.agentOnly) {
      sight(event.node.name, nodeTimeMs, event.atMs);
      continue;
    }

    const mgetsBefore: number = mgetCalls.length;
    const decision: ProxmoxSilentNodeDecision | null = await push({
      selfNode: event.node.name,
      nowMs: event.atMs,
      reporterTimeMs: nodeTimeMs,
      loadRoster,
    });
    const siblingRead: FakeMgetCall | undefined =
      mgetCalls.length > mgetsBefore
        ? mgetCalls[mgetCalls.length - 1]
        : undefined;
    const rosterReadAtMs: number | null = served.atMs;
    if (rosterReadAtMs === null) {
      throw new Error(`no roster was loaded for the push at ${event.atMs}`);
    }
    pushes.push({
      atMs: event.atMs,
      pushMs: event.pushMs,
      node: event.node.name,
      decision,
      clusterEstablished: clusterEstablishedAt(event.node.name, event.atMs),
      keyedLiveCount: siblingRead
        ? 1 +
          siblingRead.values.filter((value: string | null) => {
            return isAliveProxmoxNode(
              parseProxmoxNodeLiveness(value),
              event.atMs,
            );
          }).length
        : null,
      rosterReadAtMs,
      offlineMarkAgesMs: new Map<string, number | null>(
        served.roster
          .filter((node: ProxmoxRosterNode) => {
            return node.isUp === false;
          })
          .map((node: ProxmoxRosterNode): [string, number | null] => {
            return [
              node.nodeName,
              node.notReportingMarkedAt
                ? rosterReadAtMs - node.notReportingMarkedAt.getTime()
                : null,
            ];
          }),
      ),
    });

    sight(event.node.name, nodeTimeMs, event.atMs);
    if (decision && markOffline) {
      const silentBeforeMs: number = nodeTimeMs - PROXMOX_NODE_SILENCE_MS;
      /*
       * P: markedAt is the worker's own clock at the flush; before P the
       * UPDATE wrote, and compared against, the database's now().
       */
      const markedAtMs: number = marksOnDatabaseClock
        ? event.atMs + databaseClockAheadMs
        : event.atMs;
      for (const nodeName of decision.silentNodes) {
        const row: SimInventoryRow | undefined = inventory.get(nodeName);
        const currentMarkMs: number | null = row ? markOf(row) : null;
        if (
          row &&
          row.lastSeenMs < silentBeforeMs &&
          (row.isUp ||
            currentMarkMs === null ||
            currentMarkMs < markedAtMs - MARK_REFRESH_MS)
        ) {
          if (row.isUp) {
            simOfflineMarks.push({ atMs: event.atMs, node: nodeName });
          }
          row.isUp = false;
          row.markedAtMs = markedAtMs;
          // The database's now() — before Q, the mark itself.
          row.updatedAtMs = rosterMarkFromUpdatedAt
            ? markedAtMs
            : event.atMs + databaseClockAheadMs;
          simMarkWrites.push({ atMs: event.atMs, node: nodeName });
        }
      }
    }
  }
  return pushes;
}

// When nodeName's mark was written, in order.
function markWritesOf(nodeName: string): Array<number> {
  return simMarkWrites
    .filter((mark: SimOfflineMark) => {
      return mark.node === nodeName;
    })
    .map((mark: SimOfflineMark) => {
      return mark.atMs;
    });
}

// The last mark of nodeName written before atMs, or null.
function lastMarkBefore(nodeName: string, atMs: number): number | null {
  const writes: Array<number> = markWritesOf(nodeName).filter(
    (writeMs: number) => {
      return writeMs < atMs;
    },
  );
  return writes.length > 0 ? (writes[writes.length - 1] as number) : null;
}

function reportsOf(pushes: Array<SimPush>): Array<SimPush> {
  return pushes.filter((simPush: SimPush) => {
    return simPush.decision !== null;
  });
}

function reportsNaming(
  pushes: Array<SimPush>,
  nodeName: string,
): Array<SimPush> {
  return pushes.filter((simPush: SimPush) => {
    return Boolean(simPush.decision?.silentNodes.includes(nodeName));
  });
}

function pushTimesOf(pushes: Array<SimPush>, nodeName: string): Array<number> {
  return pushes
    .filter((simPush: SimPush) => {
      return simPush.node === nodeName;
    })
    .map((simPush: SimPush) => {
      return simPush.atMs;
    });
}

function always(untilMs: number): Array<[number, number]> {
  return [[T0, untilMs]];
}

// The start of the (T0-aligned) minute holding atMs.
function minuteOf(atMs: number): number {
  return T0 + Math.floor((atMs - T0) / 60_000) * 60_000;
}

/*
 * The minutes (T0-aligned, by the points' own time) from fromMs's minute
 * up to toMs that hold processed pushes but no report of nodeName: in
 * them nothing says pve_up = 0 for it, so Node Offline reads it as up and
 * Quorum at Risk reads 100 % — what let both resolve, only to page again.
 */
function minutesLookingUp(
  pushes: Array<SimPush>,
  nodeName: string,
  fromMs: number,
  toMs: number,
): Array<number> {
  const withPushes: Set<number> = new Set<number>();
  const withReport: Set<number> = new Set<number>();
  for (const simPush of pushes) {
    if (simPush.pushMs < minuteOf(fromMs) || simPush.pushMs > toMs) {
      continue;
    }
    withPushes.add(minuteOf(simPush.pushMs));
    if (simPush.decision?.silentNodes.includes(nodeName)) {
      withReport.add(minuteOf(simPush.pushMs));
    }
  }
  return Array.from(withPushes)
    .filter((minuteMs: number) => {
      return !withReport.has(minuteMs);
    })
    .sort((a: number, b: number) => {
      return a - b;
    });
}

/*
 * The holes in nodeName's reports among the pushes processed at or after
 * fromMs: every push that did not report it though an earlier and a later
 * one of them did (reported → unreported → reported). Their processing
 * times, in order.
 */
function reportHoles(
  pushes: Array<SimPush>,
  nodeName: string,
  fromMs: number,
): Array<number> {
  const considered: Array<SimPush> = pushes.filter((simPush: SimPush) => {
    return simPush.atMs >= fromMs;
  });
  const reported: Array<boolean> = considered.map((simPush: SimPush) => {
    return Boolean(simPush.decision?.silentNodes.includes(nodeName));
  });
  const firstIndex: number = reported.indexOf(true);
  const lastIndex: number = reported.lastIndexOf(true);
  const holes: Array<number> = [];
  for (let index: number = firstIndex + 1; index < lastIndex; index++) {
    if (!reported[index]) {
      holes.push(considered[index]!.atMs);
    }
  }
  return holes;
}

/*
 * Q, R, checked push by push from fromMs on, among the pushes that saw no
 * node established (the ones continuation decides): each reports nodeName
 * exactly when the roster it decided on was loaded with nodeName Offline
 * and its mark at most 300 s old; and every push one cached roster served
 * decided alike. Each breach, described.
 */
function continuationBreaches(
  pushes: Array<SimPush>,
  nodeName: string,
  fromMs: number,
  label: string,
): Array<string> {
  const breaches: Array<string> = [];
  const decidedByLoad: Map<number, string> = new Map<number, string>();
  for (const simPush of pushes) {
    if (simPush.atMs < fromMs || simPush.clusterEstablished) {
      continue;
    }
    const at: string = `${label}: the push at +${simPush.atMs - T0}`;
    const markAgeMs: number | null | undefined =
      simPush.offlineMarkAgesMs.get(nodeName);
    const withinWindow: boolean =
      typeof markAgeMs === "number" && markAgeMs <= PROXMOX_MONITOR_WINDOW_MS;
    const reported: boolean = Boolean(
      simPush.decision?.silentNodes.includes(nodeName),
    );
    if (reported !== withinWindow) {
      breaches.push(
        `${at}, its roster loaded at +${simPush.rosterReadAtMs - T0} with the mark ${String(markAgeMs)} ms old, reported ${JSON.stringify(simPush.decision)}`,
      );
    }
    const decided: string = JSON.stringify(simPush.decision);
    const decidedBefore: string | undefined = decidedByLoad.get(
      simPush.rosterReadAtMs,
    );
    if (decidedBefore !== undefined && decidedBefore !== decided) {
      breaches.push(
        `${at} decided ${decided}, another push on the roster loaded at +${simPush.rosterReadAtMs - T0} ${decidedBefore}`,
      );
    }
    decidedByLoad.set(simPush.rosterReadAtMs, decided);
  }
  return breaches;
}

/*
 * R, not vacuous: whether some push from fromMs on, with no node
 * established, reported nodeName while its mark was over 300 s old by the
 * push's own clock — continued only because the roster it was served had
 * been loaded with the mark inside the window.
 */
function continuedOnTheLoadAlone(
  pushes: Array<SimPush>,
  nodeName: string,
  fromMs: number,
): boolean {
  return pushes.some((simPush: SimPush) => {
    const markAgeMs: number | null | undefined =
      simPush.offlineMarkAgesMs.get(nodeName);
    return (
      simPush.atMs >= fromMs &&
      !simPush.clusterEstablished &&
      Boolean(simPush.decision?.silentNodes.includes(nodeName)) &&
      typeof markAgeMs === "number" &&
      markAgeMs + (simPush.atMs - simPush.rosterReadAtMs) >
        PROXMOX_MONITOR_WINDOW_MS
    );
  });
}

/*
 * Σ pve_up ÷ Σ pve_node_info per full T0-aligned minute in [fromMs, toMs),
 * by the points' own time: 1 and 1 per push, plus D / L of pve_node_info
 * per report. L is the report's reporterCount unless countOf gives another
 * (e.g. the old rule's keyedLiveCount, to show what it read).
 */
function availabilityByMinute(
  pushes: Array<SimPush>,
  fromMs: number,
  toMs: number,
  countOf?: ((simPush: SimPush) => number) | undefined,
): Array<number> {
  const ratios: Array<number> = [];
  for (
    let minuteMs: number = T0 + Math.ceil((fromMs - T0) / 60_000) * 60_000;
    minuteMs + 60_000 <= toMs;
    minuteMs += 60_000
  ) {
    let up: number = 0;
    let info: number = 0;
    for (const simPush of pushes) {
      if (simPush.pushMs < minuteMs || simPush.pushMs >= minuteMs + 60_000) {
        continue;
      }
      up += 1;
      info += 1;
      if (simPush.decision) {
        info +=
          simPush.decision.silentNodes.length /
          (countOf ? countOf(simPush) : simPush.decision.reporterCount);
      }
    }
    if (up > 0) {
      ratios.push(up / info);
    }
  }
  return ratios;
}

// The first push at or after fromMs that saw an established node.
function firstEstablishedPush(
  pushes: Array<SimPush>,
  fromMs: number,
): SimPush | undefined {
  return pushes.find((simPush: SimPush) => {
    return simPush.atMs >= fromMs && simPush.clusterEstablished;
  });
}

describe("timeline simulation", () => {
  beforeEach(() => {
    installFakes();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearProxmoxNodeRosterCache();
  });

  interface DeathCase {
    title: string;
    // Phases of pve1, pve2 (the one that dies) and pve3.
    phases: [number, number, number];
  }

  const deathCases: Array<DeathCase> = [
    { title: "spread phases", phases: [0, 3_000, 7_000] },
    { title: "all in phase", phases: [0, 0, 0] },
    { title: "reporters just after the dead node", phases: [1, 0, 2] },
    { title: "reporters just before the dead node", phases: [0, 9_999, 5_000] },
    { title: "one reporter in phase", phases: [4_000, 4_000, 9_000] },
  ];

  test.each(deathCases)(
    "a node that dies is first reported 120–130 s after its last push ($title)",
    async (deathCase: DeathCase) => {
      const untilMs: number = T0 + 1_500_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          {
            name: "pve1",
            phaseMs: deathCase.phases[0],
            windows: always(untilMs),
          },
          {
            name: "pve2",
            phaseMs: deathCase.phases[1],
            windows: [[T0, T0 + 600_000]],
          },
          {
            name: "pve3",
            phaseMs: deathCase.phases[2],
            windows: always(untilMs),
          },
        ],
        untilMs,
      });

      const lastPushMs: number = Math.max(...pushTimesOf(pushes, "pve2"));
      const reports: Array<SimPush> = reportsOf(pushes);
      expect(reports.length).toBeGreaterThan(0);

      // Nothing but the dead node, and both survivors counted.
      for (const report of reports) {
        expect(report.decision).toEqual({
          silentNodes: ["pve2"],
          reporterCount: 2,
        });
        expect(report.node).not.toBe("pve2");
      }

      const firstReportMs: number = reports[0]!.atMs;
      expect(firstReportMs).toBeGreaterThanOrEqual(
        lastPushMs + PROXMOX_NODE_SILENCE_MS,
      );
      expect(firstReportMs).toBeLessThanOrEqual(
        lastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
      );

      /*
       * From then on every survivor push carries the report, so pve_up = 0
       * lands in every minute bucket and Node Offline keeps firing.
       */
      const survivorPushesAfter: Array<SimPush> = pushes.filter(
        (simPush: SimPush) => {
          return (
            simPush.node !== "pve2" &&
            simPush.atMs >
              lastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS
          );
        },
      );
      expect(survivorPushesAfter.length).toBeGreaterThan(0);
      for (const simPush of survivorPushesAfter) {
        expect(simPush.decision).not.toBeNull();
      }
      expect(
        new Set<string>(
          reports.map((report: SimPush) => {
            return report.node;
          }),
        ),
      ).toEqual(new Set<string>(["pve1", "pve3"]));
    },
  );

  test("before any node dies, a healthy cluster never reports anyone", async () => {
    const untilMs: number = T0 + 1_800_000;
    const pushes: Array<SimPush> = await simulate({
      nodes: [
        { name: "pve1", phaseMs: 0, windows: always(untilMs) },
        { name: "pve2", phaseMs: 3_000, windows: always(untilMs) },
        { name: "pve3", phaseMs: 7_000, windows: always(untilMs) },
      ],
      untilMs,
    });

    expect(reportsOf(pushes)).toEqual([]);
    // Not vacuous: the reporters did check their siblings.
    expect(mgetCalls.length).toBeGreaterThan(100);
  });

  test("a node that comes back stops being reported from its next push", async () => {
    const untilMs: number = T0 + 1_800_000;
    const pushes: Array<SimPush> = await simulate({
      nodes: [
        { name: "pve1", phaseMs: 0, windows: always(untilMs) },
        {
          name: "pve2",
          phaseMs: 3_000,
          windows: [
            [T0, T0 + 600_000],
            [T0 + 1_200_000, untilMs],
          ],
        },
        { name: "pve3", phaseMs: 7_000, windows: always(untilMs) },
      ],
      untilMs,
    });

    const backAtMs: number = pushTimesOf(pushes, "pve2").find(
      (atMs: number) => {
        return atMs >= T0 + 1_200_000;
      },
    ) as number;

    expect(
      reportsNaming(pushes, "pve2").filter((report: SimPush) => {
        return report.atMs < backAtMs;
      }).length,
    ).toBeGreaterThan(0);
    expect(
      reportsOf(pushes).filter((report: SimPush) => {
        return report.atMs > backAtMs;
      }),
    ).toEqual([]);
  });

  describe("clock skew", () => {
    test.each([
      { title: "5 minutes ahead of OneUptime's", skewMs: 300_000 },
      { title: "5 minutes behind OneUptime's", skewMs: -300_000 },
    ])(
      "every PVE clock $title: the report time is unchanged",
      async ({ skewMs }: { title: string; skewMs: number }) => {
        const untilMs: number = T0 + 1_200_000;
        const pushes: Array<SimPush> = await simulate({
          nodes: [
            {
              name: "pve1",
              phaseMs: 0,
              clockSkewMs: skewMs,
              windows: always(untilMs),
            },
            {
              name: "pve2",
              phaseMs: 3_000,
              clockSkewMs: skewMs,
              windows: [[T0, T0 + 600_000]],
            },
            {
              name: "pve3",
              phaseMs: 7_000,
              clockSkewMs: skewMs,
              windows: always(untilMs),
            },
          ],
          untilMs,
        });

        const lastPushMs: number = Math.max(...pushTimesOf(pushes, "pve2"));
        const firstReportMs: number = reportsNaming(pushes, "pve2")[0]!.atMs;
        expect(firstReportMs).toBeGreaterThan(
          lastPushMs + PROXMOX_NODE_SILENCE_MS,
        );
        expect(firstReportMs).toBeLessThanOrEqual(
          lastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
        );
      },
    );

    test("a reporter whose clock is 30 s behind reports 30 s later, never earlier", async () => {
      const untilMs: number = T0 + 1_200_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          {
            name: "pve1",
            phaseMs: 0,
            clockSkewMs: -30_000,
            windows: always(untilMs),
          },
          { name: "pve2", phaseMs: 3_000, windows: [[T0, T0 + 600_000]] },
          { name: "pve3", phaseMs: 7_000, windows: always(untilMs) },
        ],
        untilMs,
      });

      const lastPushMs: number = Math.max(...pushTimesOf(pushes, "pve2"));
      const firstByNode: (nodeName: string) => number = (
        nodeName: string,
      ): number => {
        return reportsNaming(pushes, "pve2").find((report: SimPush) => {
          return report.node === nodeName;
        })!.atMs;
      };

      expect(firstByNode("pve3")).toBeGreaterThan(
        lastPushMs + PROXMOX_NODE_SILENCE_MS,
      );
      expect(firstByNode("pve3")).toBeLessThanOrEqual(
        lastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
      );
      expect(firstByNode("pve1")).toBeGreaterThan(
        lastPushMs + PROXMOX_NODE_SILENCE_MS + 30_000,
      );
      expect(firstByNode("pve1")).toBeLessThanOrEqual(
        lastPushMs + PROXMOX_NODE_SILENCE_MS + 30_000 + PUSH_INTERVAL_MS,
      );
    });

    test("a reporter whose clock is 60 s ahead still waits for the dead node's key to go", async () => {
      const untilMs: number = T0 + 1_200_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          {
            name: "pve1",
            phaseMs: 0,
            clockSkewMs: 60_000,
            windows: always(untilMs),
          },
          { name: "pve2", phaseMs: 3_000, windows: [[T0, T0 + 600_000]] },
          { name: "pve3", phaseMs: 7_000, windows: always(untilMs) },
        ],
        untilMs,
      });

      const lastPushMs: number = Math.max(...pushTimesOf(pushes, "pve2"));
      const firstByPve1: number = reportsNaming(pushes, "pve2").find(
        (report: SimPush) => {
          return report.node === "pve1";
        },
      )!.atMs;

      expect(firstByPve1).toBeGreaterThan(lastPushMs + PROXMOX_NODE_SILENCE_MS);
      expect(firstByPve1).toBeLessThanOrEqual(
        lastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
      );
    });
  });

  describe("after a OneUptime ingest outage", () => {
    const outageFromMs: number = T0 + 600_000;
    const outageToMs: number = T0 + 1_200_000;
    const untilMs: number = T0 + 2_400_000;

    function nodesResuming(
      staggersMs: [number, number, number],
      phasesMs: [number, number, number],
    ): Array<SimNode> {
      return ["pve1", "pve2", "pve3"].map(
        (name: string, index: number): SimNode => {
          return {
            name,
            phaseMs: phasesMs[index] as number,
            windows: [
              [T0, outageFromMs],
              [outageToMs + (staggersMs[index] as number), untilMs],
            ],
          };
        },
      );
    }

    const resumeCases: Array<ResumeCase> = [
      { staggersMs: [0, 50_000, 100_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [100_000, 0, 50_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [100_000, 100_000, 0], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 100_000, 100_000], phasesMs: [9_000, 0, 5_000] },
      { staggersMs: [0, 0, 100_000], phasesMs: [0, 0, 9_999] },
      { staggersMs: [0, 0, 0], phasesMs: [0, 3_000, 7_000] },
      // The last node's first push lands 113 s / 119 s after the first's.
      { staggersMs: [0, 110_000, 55_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 55_000, 110_000], phasesMs: [0, 3_000, 9_000] },
    ];

    /*
     * Every key has expired during the outage and every inventory sighting
     * is 10 minutes old, so the first node back sees both siblings as
     * silent. Only the established-node guard keeps it quiet: no node is
     * established until one has pushed for 2 minutes after the outage, and
     * by then every node that resumed less than 2 minutes after the first
     * has a key again. Continuation cannot report them either: none of
     * them was ever reported, so none is Offline.
     */
    test.each(resumeCases)(
      "nodes resuming less than 2 minutes apart are never reported (staggers $staggersMs)",
      async ({
        staggersMs,
        phasesMs,
      }: {
        staggersMs: [number, number, number];
        phasesMs: [number, number, number];
      }) => {
        const pushes: Array<SimPush> = await simulate({
          nodes: nodesResuming(staggersMs, phasesMs),
          untilMs,
          actions: [
            {
              // Keys have expired by now anyway; make the vanishing explicit.
              atMs: outageFromMs + 300_000,
              run: (): void => {
                redis.clear();
              },
            },
          ],
        });

        expect(reportsOf(pushes)).toEqual([]);
        /*
         * Not vacuous: right after the outage the live nodes read their
         * siblings and found keys missing (with sightings 10 minutes old),
         * so only the guard kept them quiet.
         */
        expect(
          mgetCalls.some((call: FakeMgetCall) => {
            return (
              call.atMs >= outageToMs &&
              call.atMs < outageToMs + PROXMOX_NODE_SILENCE_MS &&
              call.values.includes(null)
            );
          }),
        ).toBe(true);
        // And the cluster was established again later: the check kept running.
        expect(
          mgetCalls.filter((call: FakeMgetCall) => {
            return call.atMs >= outageToMs + 2 * PROXMOX_NODE_SILENCE_MS;
          }).length,
        ).toBeGreaterThan(0);
        for (const nodeName of ["pve1", "pve2", "pve3"]) {
          expect(
            isEligibleProxmoxReporter(storedLiveness(nodeName), clockMs),
          ).toBe(true);
        }
        // No live node was ever turned Offline.
        expect(simOfflineMarks).toEqual([]);
      },
    );

    /*
     * The same 10-minute outage with pve4 dead since long before it and
     * already Offline — and Redis lost with it (flushed mid-outage), or
     * kept. M: the outage is longer than the monitors' 5-minute window, so
     * their incidents have resolved and pve4's mark — last written by a
     * report before the outage — has aged out, whatever Redis kept:
     * nothing is continued. No push reports pve4 until a node is
     * established again,
     * 2 minutes after the first node back — the live nodes not processed
     * yet are not reported either (not Offline). From that push on every
     * push reports pve4 with L = 4 − 1 = 3 (I), and each full minute reads
     * 3 ÷ 4.
     */
    test.each(
      resumeCases.flatMap((resumeCase: ResumeCase) => {
        return [
          { ...resumeCase, redisLost: true },
          { ...resumeCase, redisLost: false },
        ];
      }),
    )(
      "after a 10-minute outage (Redis lost: $redisLost), a node already Offline waits for an established node, then is reported with L = 3 (staggers $staggersMs)",
      async ({
        staggersMs,
        phasesMs,
        redisLost,
      }: ResumeCase & { redisLost: boolean }) => {
        const pushes: Array<SimPush> = await simulate({
          nodes: [
            ...nodesResuming(staggersMs, phasesMs),
            { name: "pve4", phaseMs: 5_000, windows: [[T0, T0 + 300_000]] },
          ],
          untilMs,
          actions: redisLost
            ? [
                {
                  atMs: outageFromMs + 300_000,
                  run: (): void => {
                    redis.clear();
                  },
                },
              ]
            : [],
        });

        // pve4, and only pve4, ever turned Offline — before the outage.
        expect(
          simOfflineMarks.map((mark: SimOfflineMark) => {
            return mark.node;
          }),
        ).toEqual(["pve4"]);
        expect(simOfflineMarks[0]!.atMs).toBeLessThan(outageFromMs);

        for (const nodeName of ["pve1", "pve2", "pve3"]) {
          expect(reportsNaming(pushes, nodeName)).toEqual([]);
        }

        const afterOutage: Array<SimPush> = pushes.filter(
          (simPush: SimPush) => {
            return simPush.atMs >= outageToMs;
          },
        );
        expect(afterOutage.length).toBeGreaterThan(300);
        const firstBackMs: number = afterOutage[0]!.atMs;
        const established: SimPush = firstEstablishedPush(pushes, outageToMs)!;
        expect(established.atMs).toBe(firstBackMs + PROXMOX_NODE_SILENCE_MS);

        const beforeEstablished: Array<SimPush> = afterOutage.filter(
          (simPush: SimPush) => {
            return simPush.atMs < established.atMs;
          },
        );
        // At least the first node's own 12 pushes of its warm-up.
        expect(beforeEstablished.length).toBeGreaterThanOrEqual(12);
        for (const simPush of beforeEstablished) {
          expect(simPush.clusterEstablished).toBe(false);
          expect(simPush.decision).toBeNull();
        }
        for (const simPush of afterOutage) {
          if (simPush.atMs >= established.atMs) {
            expect(simPush.decision).toEqual({
              silentNodes: ["pve4"],
              reporterCount: 3,
            });
          }
        }

        /*
         * Not vacuous: each of those pushes found pve4 Offline and keyless
         * (what continuation reports) — its mark, written before the
         * outage, more than the monitors' 300 s old when their roster was
         * loaded (R).
         */
        const lastMarkMs: number = lastMarkBefore("pve4", outageToMs)!;
        expect(lastMarkMs).toBeLessThanOrEqual(outageFromMs);
        expect(firstBackMs - lastMarkMs).toBeGreaterThan(
          PROXMOX_MONITOR_WINDOW_MS,
        );
        for (const simPush of beforeEstablished) {
          expect(simPush.rosterReadAtMs).toBeGreaterThanOrEqual(firstBackMs);
          expect(simPush.offlineMarkAgesMs.get("pve4")).toBe(
            simPush.rosterReadAtMs - lastMarkMs,
          );
          expect(simPush.offlineMarkAgesMs.get("pve4")).toBeGreaterThan(
            PROXMOX_MONITOR_WINDOW_MS,
          );
        }
        expect(beforeEstablished[0]!.keyedLiveCount).toBe(1);
        // No report, no mark: the first mark after the outage is the first report's.
        expect(
          markWritesOf("pve4").filter((writeMs: number) => {
            return writeMs >= outageToMs;
          })[0],
        ).toBe(established.atMs);
        expect(otherRedisCalls()).toEqual([]);

        /*
         * The price, by design: the minutes from the first push back until
         * a node is established read pve4 as up — its incident resolved
         * during the outage anyway. From the established push on, none.
         */
        const pausedMinutes: Array<number> = minutesLookingUp(
          pushes,
          "pve4",
          outageToMs,
          untilMs,
        );
        expect(pausedMinutes.length).toBeGreaterThan(0);
        for (const minuteMs of pausedMinutes) {
          expect(minuteMs).toBeLessThan(established.atMs);
        }
        const ratios: Array<number> = availabilityByMinute(
          pushes,
          established.atMs,
          untilMs,
        );
        expect(ratios.length).toBeGreaterThan(15);
        for (const ratio of ratios) {
          expect(ratio).toBeCloseTo(3 / 4, 12);
        }
      },
    );

    /*
     * pve3 is dead and Offline before the outage and comes back DURING it,
     * so OneUptime does not know until its first push after the outage is
     * processed. M: past the monitors' window its Node Offline incident
     * has resolved and its mark has aged out, so it is not reported at all
     * after the outage — not even by the nodes processed before it, which
     * find its row Offline, its key gone and its sighting stale (with a
     * mark that did not age out, continuation reported it there: a false
     * Node Offline). No node is established before it is back (every node
     * resumes within 2 minutes of the first), so no first report names it
     * either.
     */
    test.each([
      { staggersMs: [0, 0, 50_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 50_000, 100_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 0, 110_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 110_000, 55_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [50_000, 100_000, 0], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 0, 0], phasesMs: [0, 3_000, 7_000] },
    ] as Array<ResumeCase>)(
      "a node Offline before the outage and back during it is never reported after the outage (staggers $staggersMs)",
      async ({ staggersMs, phasesMs }: ResumeCase) => {
        const pushes: Array<SimPush> = await simulate({
          nodes: [
            {
              name: "pve1",
              phaseMs: phasesMs[0],
              windows: [
                [T0, outageFromMs],
                [outageToMs + staggersMs[0], untilMs],
              ],
            },
            {
              name: "pve2",
              phaseMs: phasesMs[1],
              windows: [
                [T0, outageFromMs],
                [outageToMs + staggersMs[1], untilMs],
              ],
            },
            {
              name: "pve3",
              phaseMs: phasesMs[2],
              windows: [
                [T0, T0 + 300_000],
                [outageToMs + staggersMs[2], untilMs],
              ],
            },
          ],
          untilMs,
        });

        expect(
          simOfflineMarks.map((mark: SimOfflineMark) => {
            return mark.node;
          }),
        ).toEqual(["pve3"]);
        expect(simOfflineMarks[0]!.atMs).toBeLessThan(outageFromMs);
        // Reported before the outage, as it should be.
        expect(
          reportsNaming(pushes, "pve3").filter((report: SimPush) => {
            return report.atMs <= outageFromMs;
          }).length,
        ).toBeGreaterThan(20);

        const pve3BackMs: number = pushTimesOf(pushes, "pve3").find(
          (atMs: number) => {
            return atMs >= outageToMs;
          },
        ) as number;
        const firstBackMs: number = pushes.find((simPush: SimPush) => {
          return simPush.atMs >= outageToMs;
        })!.atMs;

        // Nothing at all is reported after the outage.
        expect(
          reportsOf(pushes).filter((report: SimPush) => {
            return report.atMs >= outageToMs;
          }),
        ).toEqual([]);
        expect(reportsNaming(pushes, "pve1")).toEqual([]);
        expect(reportsNaming(pushes, "pve2")).toEqual([]);
        expect(simInventory.get("pve3")?.isUp).toBe(true);
        expect(firstEstablishedPush(pushes, outageToMs)!.atMs).toBeGreaterThan(
          pve3BackMs,
        );

        /*
         * Not vacuous: every push processed before pve3's first read its
         * key and found it gone (its row still Offline, its sighting from
         * before the outage), with nobody established — and its mark more
         * than the monitors' 300 s old when their roster was loaded (R).
         */
        const beforeBack: Array<SimPush> = pushes.filter((simPush: SimPush) => {
          return simPush.atMs >= outageToMs && simPush.atMs < pve3BackMs;
        });
        for (const simPush of beforeBack) {
          expect(simPush.clusterEstablished).toBe(false);
          expect(simPush.decision).toBeNull();
        }
        const pve3Reads: Array<string | null> = mgetCalls
          .filter((call: FakeMgetCall) => {
            return call.atMs >= outageToMs && call.atMs < pve3BackMs;
          })
          .map((call: FakeMgetCall) => {
            return call.values[call.keys.indexOf(livenessKey("pve3"))] ?? null;
          });
        expect(pve3Reads).toHaveLength(beforeBack.length);
        expect(
          pve3Reads.every((value: string | null) => {
            return value === null;
          }),
        ).toBe(true);
        for (const simPush of beforeBack) {
          expect(simPush.offlineMarkAgesMs.get("pve3")).toBeGreaterThan(
            PROXMOX_MONITOR_WINDOW_MS,
          );
        }
        // Its last mark was written by a report before the outage.
        expect(lastMarkBefore("pve3", outageToMs)).toBeLessThanOrEqual(
          outageFromMs,
        );
        if (pve3BackMs > firstBackMs) {
          expect(beforeBack.length).toBeGreaterThan(0);
        } else {
          expect(beforeBack).toEqual([]);
        }
      },
    );

    /*
     * P, Q: the same node back during a 10-minute outage, with the
     * database's clock 10 minutes ahead of the worker's. The marks
     * (notReportingMarkedAt) are written on the worker's clock (markedAt),
     * so they age out during the outage all the same and pve3 is never
     * reported after it — while every write stamps updatedAt 10 minutes
     * ahead, which the roster does not carry. Written on the database's
     * now(), as before P, the last mark before the outage is dated 10
     * minutes ahead — still "recent" when the nodes are back — and the
     * pushes before pve3's first reported it: a false Node Offline.
     */
    test("P: a database clock 10 minutes ahead leaves the marks on the worker's clock: they still age out", async () => {
      const databaseClockAheadMs: number = 600_000;
      const nodes: Array<SimNode> = [
        {
          name: "pve1",
          phaseMs: 0,
          windows: [
            [T0, outageFromMs],
            [outageToMs, untilMs],
          ],
        },
        {
          name: "pve2",
          phaseMs: 3_000,
          windows: [
            [T0, outageFromMs],
            [outageToMs, untilMs],
          ],
        },
        {
          name: "pve3",
          phaseMs: 7_000,
          windows: [
            [T0, T0 + 300_000],
            [outageToMs + 50_000, untilMs],
          ],
        },
      ];

      const pushes: Array<SimPush> = await simulate({
        nodes,
        untilMs,
        databaseClockAheadMs,
      });
      const pve3BackMs: number = pushTimesOf(pushes, "pve3").find(
        (atMs: number) => {
          return atMs >= outageToMs;
        },
      ) as number;
      expect(pve3BackMs).toBe(outageToMs + 57_000);

      // Reported and marked before the outage, at most once a minute…
      const marksBefore: Array<number> = markWritesOf("pve3");
      expect(marksBefore.length).toBeGreaterThanOrEqual(3);
      expect(marksBefore[marksBefore.length - 1]).toBeLessThanOrEqual(
        outageFromMs,
      );
      for (let index: number = 1; index < marksBefore.length; index++) {
        expect(
          (marksBefore[index] as number) - (marksBefore[index - 1] as number),
        ).toBeGreaterThan(MARK_REFRESH_MS);
      }
      // …never after it: the mark, on the worker's clock, had aged out.
      expect(
        reportsOf(pushes).filter((report: SimPush) => {
          return report.atMs >= outageToMs;
        }),
      ).toEqual([]);
      const beforeBack: Array<SimPush> = pushes.filter((simPush: SimPush) => {
        return simPush.atMs >= outageToMs && simPush.atMs < pve3BackMs;
      });
      expect(beforeBack.length).toBeGreaterThan(5);
      for (const simPush of beforeBack) {
        expect(simPush.offlineMarkAgesMs.get("pve3")).toBeGreaterThan(
          PROXMOX_MONITOR_WINDOW_MS,
        );
      }
      /*
       * Not vacuous: the database's own writes (the sightings) run 10
       * minutes ahead; they clear the mark (Q), and never write one.
       */
      const lastPve1Ms: number = pushTimesOf(pushes, "pve1").pop() as number;
      expect(simInventory.get("pve1")?.updatedAtMs).toBe(
        lastPve1Ms + databaseClockAheadMs,
      );
      expect(simInventory.get("pve1")?.markedAtMs).toBeNull();

      // Before P: the marks on the database's clock never aged out.
      resetFakeState();
      const beforeP: Array<SimPush> = await simulate({
        nodes,
        untilMs,
        databaseClockAheadMs,
        marksOnDatabaseClock: true,
      });
      const falseReports: Array<SimPush> = reportsNaming(
        beforeP,
        "pve3",
      ).filter((report: SimPush) => {
        return report.atMs >= outageToMs;
      });
      expect(falseReports.length).toBeGreaterThan(5);
      for (const report of falseReports) {
        expect(report.atMs).toBeLessThan(pve3BackMs);
        expect(report.clusterEstablished).toBe(false);
      }
    });

    /*
     * pve1 is back first and is established 2 minutes later; pve2 is back
     * 50 s after pve1 and still warming up then — it reports too, from the
     * moment pve1 is established, carrying the same reporterCount. pve3
     * goes quiet as the outage begins, so it was never reported and never
     * turned Offline: its report after the outage is a FIRST report and
     * waits for an established node — continuation does not apply.
     */
    test("a node that stays down through the outage is reported again once a node is established", async () => {
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          {
            name: "pve1",
            phaseMs: 0,
            windows: [
              [T0, outageFromMs],
              [outageToMs, untilMs],
            ],
          },
          {
            name: "pve2",
            phaseMs: 3_000,
            windows: [
              [T0, outageFromMs],
              [outageToMs + 50_000, untilMs],
            ],
          },
          { name: "pve3", phaseMs: 7_000, windows: [[T0, outageFromMs]] },
        ],
        untilMs,
      });

      const reports: Array<SimPush> = reportsOf(pushes);
      expect(reports.length).toBeGreaterThan(0);
      for (const report of reports) {
        expect(report.decision).toEqual({
          silentNodes: ["pve3"],
          reporterCount: 2,
        });
      }
      const firstReportMs: number = reports[0]!.atMs;
      expect(firstReportMs).toBeGreaterThanOrEqual(
        outageToMs + PROXMOX_NODE_SILENCE_MS,
      );
      expect(firstReportMs).toBeLessThanOrEqual(
        outageToMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
      );
      // It was not Offline before: it turns Offline with that first report.
      expect(simOfflineMarks).toEqual([{ atMs: firstReportMs, node: "pve3" }]);

      // pve2 reports before its own streak reaches 2 minutes…
      const pve2BackMs: number = pushTimesOf(pushes, "pve2").find(
        (atMs: number) => {
          return atMs >= outageToMs;
        },
      ) as number;
      const pve2Reports: Array<SimPush> = reports.filter((report: SimPush) => {
        return report.node === "pve2";
      });
      expect(pve2Reports.length).toBeGreaterThan(0);
      expect(pve2Reports[0]!.atMs).toBeLessThan(
        pve2BackMs + PROXMOX_NODE_SILENCE_MS,
      );
      expect(pve2Reports[0]!.atMs).toBeLessThanOrEqual(
        firstReportMs + PUSH_INTERVAL_MS,
      );
      // …and from then on every push of both survivors carries the report.
      for (const simPush of pushes) {
        if (simPush.atMs > firstReportMs + PUSH_INTERVAL_MS) {
          expect(simPush.decision).not.toBeNull();
        }
      }
    });

    /*
     * The inverse: until some node is established after the outage, a
     * node that really is dead is not reported either — however long the
     * live nodes have been back.
     */
    test("nothing is reported before any node is established after the outage", async () => {
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          {
            name: "pve1",
            phaseMs: 0,
            windows: [
              [T0, outageFromMs],
              [outageToMs, untilMs],
            ],
          },
          {
            name: "pve2",
            phaseMs: 3_000,
            windows: [
              [T0, outageFromMs],
              [outageToMs, untilMs],
            ],
          },
          { name: "pve3", phaseMs: 7_000, windows: [[T0, outageFromMs]] },
        ],
        untilMs,
      });

      expect(
        reportsOf(pushes).filter((report: SimPush) => {
          return (
            report.atMs > outageFromMs &&
            report.atMs < outageToMs + PROXMOX_NODE_SILENCE_MS
          );
        }),
      ).toEqual([]);
      expect(reportsNaming(pushes, "pve3").length).toBeGreaterThan(0);
    });
  });

  /*
   * An ingest outage of 3 minutes — inside the monitors' 5-minute window —
   * with pve4 dead since long before it and already Offline. Every
   * liveness key expires during it, but pve4's mark does not: rewritten at
   * most once a minute while it was reported (first at +417 s, then +480
   * and +543 s), it is 237 s old when pve1 is back first at +780 s and
   * loads the roster. So continuation runs from the very first push back
   * (M, Q, R) — and its reports rewrite the mark at once — and (I) every
   * report counts L = 4 nodes − 1
   * = 3, however many of the live nodes are back: each push carries 1 ÷ 3
   * of pve4's weight and every minute reads 3 ÷ 4.
   *
   * The undercount this replaces: counting the nodes with a live key, the
   * first node back reported pve4 with L = 1 until its siblings' first
   * pushes were processed, so a minute holding only its pushes read 1 ÷ 2
   * and Quorum at Risk (≤ 50 %) fired falsely.
   */
  describe("after a 3-minute ingest outage (inside the monitor window)", () => {
    const outageFromMs: number = T0 + 600_000;
    const outageToMs: number = T0 + 780_000;
    const untilMs: number = T0 + 1_500_000;

    function nodesAroundOutage(
      staggersMs: [number, number, number],
      phasesMs: [number, number, number],
      toMs: number = outageToMs,
    ): Array<SimNode> {
      return [
        ...["pve1", "pve2", "pve3"].map(
          (name: string, index: number): SimNode => {
            return {
              name,
              phaseMs: phasesMs[index] as number,
              windows: [
                [T0, outageFromMs],
                [toMs + (staggersMs[index] as number), untilMs],
              ],
            };
          },
        ),
        { name: "pve4", phaseMs: 5_000, windows: [[T0, T0 + 300_000]] },
      ];
    }

    const shortOutageCases: Array<ResumeCase> = [
      { staggersMs: [0, 0, 0], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 50_000, 100_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 100_000, 100_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [100_000, 0, 50_000], phasesMs: [0, 3_000, 7_000] },
    ];

    test.each(shortOutageCases)(
      "a node already Offline is reported from the first push back, with L = 3 on every push (staggers $staggersMs)",
      async ({ staggersMs, phasesMs }: ResumeCase) => {
        const pushes: Array<SimPush> = await simulate({
          nodes: nodesAroundOutage(staggersMs, phasesMs),
          untilMs,
        });

        expect(
          simOfflineMarks.map((mark: SimOfflineMark) => {
            return mark.node;
          }),
        ).toEqual(["pve4"]);
        expect(simOfflineMarks[0]!.atMs).toBeLessThan(outageFromMs);
        for (const nodeName of ["pve1", "pve2", "pve3"]) {
          expect(reportsNaming(pushes, nodeName)).toEqual([]);
        }

        const afterOutage: Array<SimPush> = pushes.filter(
          (simPush: SimPush) => {
            return simPush.atMs >= outageToMs;
          },
        );
        expect(afterOutage.length).toBeGreaterThan(150);
        for (const simPush of afterOutage) {
          expect(simPush.decision).toEqual({
            silentNodes: ["pve4"],
            reporterCount: 3,
          });
        }

        // Continuation until a node is established, 2 minutes after the first back…
        const firstBack: SimPush = afterOutage[0]!;
        expect(firstBack.clusterEstablished).toBe(false);
        const established: SimPush = firstEstablishedPush(pushes, outageToMs)!;
        expect(established.atMs).toBe(firstBack.atMs + PROXMOX_NODE_SILENCE_MS);
        const continued: Array<SimPush> = afterOutage.filter(
          (simPush: SimPush) => {
            return simPush.atMs < established.atMs;
          },
        );
        expect(continued.length).toBeGreaterThanOrEqual(12);
        for (const simPush of continued) {
          expect(simPush.clusterEstablished).toBe(false);
        }
        // …each of those pushes' roster loaded with pve4's mark inside the window…
        expect(markWritesOf("pve4").slice(0, 3)).toEqual([
          T0 + 417_000,
          T0 + 480_000,
          T0 + 543_000,
        ]);
        expect(lastMarkBefore("pve4", outageToMs)).toBe(T0 + 543_000);
        for (const simPush of continued) {
          expect(simPush.offlineMarkAgesMs.get("pve4")).toBeLessThanOrEqual(
            PROXMOX_MONITOR_WINDOW_MS,
          );
        }
        // (the first push back loaded it itself: the roster cached before the outage had expired)
        expect(firstBack.rosterReadAtMs).toBe(firstBack.atMs);
        expect(firstBack.offlineMarkAgesMs.get("pve4")).toBe(
          firstBack.atMs - (T0 + 543_000),
        );
        // …and the first push back rewrote it, then at most once a minute.
        const writesAfter: Array<number> = markWritesOf("pve4").filter(
          (writeMs: number) => {
            return writeMs >= outageToMs;
          },
        );
        expect(writesAfter[0]).toBe(firstBack.atMs);
        for (let index: number = 1; index < writesAfter.length; index++) {
          const sinceMs: number =
            (writesAfter[index] as number) - (writesAfter[index - 1] as number);
          expect(sinceMs).toBeGreaterThan(MARK_REFRESH_MS);
          expect(sinceMs).toBeLessThanOrEqual(
            MARK_REFRESH_MS + PUSH_INTERVAL_MS,
          );
        }
        expect(otherRedisCalls()).toEqual([]);

        // I: the first push back had one live key, its own — L is still 3.
        expect(firstBack.keyedLiveCount).toBe(1);

        expect(minutesLookingUp(pushes, "pve4", outageToMs, untilMs)).toEqual(
          [],
        );
        const ratios: Array<number> = availabilityByMinute(
          pushes,
          outageToMs,
          untilMs,
        );
        expect(ratios.length).toBeGreaterThan(10);
        for (const ratio of ratios) {
          expect(ratio).toBeCloseTo(3 / 4, 12);
        }
      },
    );

    /*
     * The undercount, measured on the same pushes. pve1 is alone for the
     * first 100 s after the outage: the first full minute holds its six
     * pushes only. With L = 3 they carry 6 × 1 ÷ 3 of pve4's weight and
     * the minute reads 6 ÷ 8 = 3 ÷ 4. With the old count (its one live
     * key) they carried 6 × 1 ÷ 1: 6 ÷ 12 = 1 ÷ 2 — Quorum at Risk's 50 %.
     */
    test("the first node back no longer reports with L = 1: its minute reads 3 ÷ 4, not 1 ÷ 2", async () => {
      const pushes: Array<SimPush> = await simulate({
        nodes: nodesAroundOutage([0, 100_000, 100_000], [0, 3_000, 7_000]),
        untilMs,
      });

      const firstMinute: Array<SimPush> = pushes.filter((simPush: SimPush) => {
        return simPush.atMs >= outageToMs && simPush.atMs < outageToMs + 60_000;
      });
      expect(
        firstMinute.map((simPush: SimPush) => {
          return simPush.node;
        }),
      ).toEqual(new Array<string>(6).fill("pve1"));
      for (const simPush of firstMinute) {
        expect(simPush.decision).toEqual({
          silentNodes: ["pve4"],
          reporterCount: 3,
        });
        expect(simPush.keyedLiveCount).toBe(1);
      }

      const nowRatios: Array<number> = availabilityByMinute(
        pushes,
        outageToMs,
        outageToMs + 60_000,
      );
      expect(nowRatios).toHaveLength(1);
      expect(nowRatios[0]).toBeCloseTo(3 / 4, 12);

      const oldRatios: Array<number> = availabilityByMinute(
        pushes,
        outageToMs,
        outageToMs + 60_000,
        (simPush: SimPush): number => {
          return simPush.keyedLiveCount ?? 0;
        },
      );
      expect(oldRatios).toHaveLength(1);
      expect(oldRatios[0]).toBeCloseTo(1 / 2, 12);

      // The old count trailed L until every live node was back; L never did.
      const pushesAfter: Array<SimPush> = pushes.filter((simPush: SimPush) => {
        return simPush.atMs >= outageToMs;
      });
      expect(
        pushesAfter.filter((simPush: SimPush) => {
          return (simPush.keyedLiveCount ?? 0) < 3;
        }).length,
      ).toBeGreaterThan(10);
      for (const simPush of pushesAfter) {
        expect(simPush.decision?.reporterCount).toBe(3);
      }
    });

    /*
     * Every outage length from 150 s to 420 s in 5 s steps, every node
     * back at once. Whatever the length: no live node is ever reported,
     * and every report counts L = 3. The rest turns on pve4's last mark
     * before the outage (+543 s) and on R: the first push back loads the
     * roster itself (the one cached before the outage expired long ago) and
     * the mark is judged at that load. At most 300 s old then — back by
     * +843 s — the push reports pve4 and rewrites the mark (continuation);
     * back later, nothing is reported until a node is established again,
     * 2 minutes after.
     *
     * Pinned for every outage, the first pushes back at the window's edge
     * included: with nobody established, a push reports pve4 exactly when
     * its roster was loaded with the mark at most 300 s old, and every push
     * one cached roster serves decides alike — so there is no hole (no push
     * without the report between two with it), and after a continued
     * outage every push from the first one back reports pve4. The pushes
     * the first push back's roster serves, up to 30 s after it, find the
     * old mark more than 300 s old by their own clock: judged on it — on a
     * 300 s window, or on O's 330 s — they dropped the report until the
     * next load read the rewritten mark (the hole a previous run measured).
     */
    test("for any outage from 150 s to 420 s, the first push back reports only inside the window, and then every push does — no hole", async () => {
      const lastMarkMs: number = T0 + 543_000;
      const windowEndMs: number = lastMarkMs + PROXMOX_MONITOR_WINDOW_MS;
      const continuedLengths: Array<number> = [];
      const continuedThroughout: Array<number> = [];
      const pausedLengths: Array<number> = [];
      // Outages after which a push was continued on the roster's load alone.
      const carriedByTheLoad: Array<number> = [];
      const wrong: Array<string> = [];

      for (
        let outageMs: number = 150_000;
        outageMs <= 420_000;
        outageMs += 5_000
      ) {
        resetFakeState();
        const toMs: number = outageFromMs + outageMs;
        const pushes: Array<SimPush> = await simulate({
          nodes: nodesAroundOutage([0, 0, 0], [0, 3_000, 7_000], toMs),
          untilMs: toMs + 3 * PROXMOX_NODE_SILENCE_MS,
        });

        for (const nodeName of ["pve1", "pve2", "pve3"]) {
          if (reportsNaming(pushes, nodeName).length > 0) {
            wrong.push(`${outageMs}: ${nodeName} reported`);
          }
        }
        for (const report of reportsOf(pushes)) {
          if (
            report.decision?.reporterCount !== 3 ||
            report.decision.silentNodes.join() !== "pve4"
          ) {
            wrong.push(`${outageMs}: ${JSON.stringify(report.decision)}`);
          }
        }

        const firstBack: SimPush = pushes.find((simPush: SimPush) => {
          return simPush.atMs >= toMs;
        })!;
        if (lastMarkBefore("pve4", toMs) !== lastMarkMs) {
          wrong.push(
            `${outageMs}: last mark at ${lastMarkBefore("pve4", toMs)! - T0}`,
          );
        }
        if (firstBack.rosterReadAtMs !== firstBack.atMs) {
          wrong.push(
            `${outageMs}: the first push back did not load the roster`,
          );
        }
        const established: SimPush = firstEstablishedPush(pushes, toMs)!;
        if (established.atMs !== firstBack.atMs + PROXMOX_NODE_SILENCE_MS) {
          wrong.push(`${outageMs}: established at ${established.atMs - T0}`);
        }
        // From the established push on, every push reports pve4.
        if (
          pushes.some((simPush: SimPush) => {
            return simPush.atMs >= established.atMs && !simPush.decision;
          })
        ) {
          wrong.push(
            `${outageMs}: a push after re-establishment reported nothing`,
          );
        }
        // Q, R: before it, reported exactly on a load within 300 s, alike per load.
        wrong.push(
          ...continuationBreaches(pushes, "pve4", toMs, `${outageMs}`),
        );
        if (continuedOnTheLoadAlone(pushes, "pve4", toMs)) {
          carriedByTheLoad.push(outageMs);
        }
        // No reported → unreported → reported, continued or not.
        const holes: Array<number> = reportHoles(pushes, "pve4", toMs);
        if (holes.length > 0) {
          wrong.push(
            `${outageMs}: back at +${firstBack.atMs - T0}, no report at ${holes
              .map((atMs: number) => {
                return `+${atMs - T0}`;
              })
              .join(", ")}`,
          );
        }

        if (firstBack.atMs <= windowEndMs) {
          continuedLengths.push(outageMs);
          if (!firstBack.decision) {
            wrong.push(
              `${outageMs}: the first push back, at +${firstBack.atMs - T0}, was not continued`,
            );
          }
          if (
            pushes.every((simPush: SimPush) => {
              return simPush.atMs < toMs || simPush.decision !== null;
            })
          ) {
            continuedThroughout.push(outageMs);
          }
        } else {
          pausedLengths.push(outageMs);
          if (
            pushes.some((simPush: SimPush) => {
              return (
                simPush.atMs >= toMs &&
                simPush.atMs < established.atMs &&
                simPush.decision !== null
              );
            })
          ) {
            wrong.push(`${outageMs}: continued past the window`);
          }
        }
      }

      expect(wrong).toEqual([]);
      /*
       * Both sides of the 300 s window are covered: back by +843 s (an
       * outage up to 240 s: pve1 at +840 s, the mark 297 s old), and later
       * (245 s: pve3 first, at +847 s, the mark 304 s old). O's 330 s
       * continued up to 270 s.
       */
      expect(continuedLengths[0]).toBe(150_000);
      expect(continuedLengths[continuedLengths.length - 1]).toBe(240_000);
      expect(continuedLengths).toHaveLength(19);
      expect(pausedLengths[0]).toBe(245_000);
      expect(pausedLengths[pausedLengths.length - 1]).toBe(420_000);
      expect(pausedLengths).toHaveLength(36);
      // No hole anywhere: every continued outage is continued on every push.
      expect(continuedThroughout).toEqual(continuedLengths);
      /*
       * Not vacuous: from a 215 s outage on (back at +817 s or later) the
       * roster the first push back loaded served pushes that found the old
       * mark over 300 s old by their own clock — R's load time alone
       * continued those.
       */
      expect(carriedByTheLoad).toEqual([
        215_000, 220_000, 225_000, 230_000, 235_000, 240_000,
      ]);
    });
  });

  test("a Redis flush while every node keeps pushing never reports anyone", async () => {
    const untilMs: number = T0 + 1_800_000;
    const flushAtMs: number = T0 + 605_000;
    const pushes: Array<SimPush> = await simulate({
      nodes: [
        { name: "pve1", phaseMs: 0, windows: always(untilMs) },
        { name: "pve2", phaseMs: 3_000, windows: always(untilMs) },
        { name: "pve3", phaseMs: 7_000, windows: always(untilMs) },
      ],
      untilMs,
      actions: [
        {
          atMs: flushAtMs,
          run: (): void => {
            redis.clear();
          },
        },
      ],
    });

    expect(reportsOf(pushes)).toEqual([]);
    // Not vacuous: right after the flush the siblings were read and gone.
    expect(
      mgetCalls.some((call: FakeMgetCall) => {
        return (
          call.atMs > flushAtMs &&
          call.atMs < flushAtMs + PUSH_INTERVAL_MS &&
          call.values.includes(null)
        );
      }),
    ).toBe(true);
    // Every streak restarted at the flush.
    for (const nodeName of ["pve1", "pve2", "pve3"]) {
      const stored: ProxmoxNodeLiveness | null = storedLiveness(nodeName);
      expect(stored?.streakStartMs).toBeGreaterThan(flushAtMs);
      expect(stored?.streakStartMs).toBeLessThanOrEqual(
        flushAtMs + PUSH_INTERVAL_MS,
      );
    }
  });

  /*
   * A flush wipes every liveness key, so nobody is established for the 2
   * minutes after it — but M: pve3's mark (dead, reported and Offline
   * long before) is in Postgres, 60 s old at the flush, and every
   * continuation report rewrites it once a minute. So nothing pauses:
   * every push after the flush — each of the 24 before pve1 is
   * established again among them — reports pve3 with L = 2, and no
   * minute reads it as up. The live nodes, whose keys the flush wiped
   * too, are never reported (not Offline, sightings fresh). (Under J the
   * flush took the window key too, those 24 pushes reported nothing, and
   * the minute at +960 s read pve3 as up.)
   */
  test("a Redis flush does not pause the reports of a node already Offline: its mark is in Postgres", async () => {
    const untilMs: number = T0 + 1_800_000;
    const flushAtMs: number = T0 + 905_000;
    const pushes: Array<SimPush> = await simulate({
      nodes: [
        { name: "pve1", phaseMs: 0, windows: always(untilMs) },
        { name: "pve2", phaseMs: 3_000, windows: always(untilMs) },
        { name: "pve3", phaseMs: 7_000, windows: [[T0, T0 + 600_000]] },
      ],
      untilMs,
      actions: [
        {
          atMs: flushAtMs,
          run: (): void => {
            redis.clear();
          },
        },
      ],
    });

    // pve3 was reported and turned Offline long before the flush.
    const firstReportMs: number = reportsNaming(pushes, "pve3")[0]!.atMs;
    expect(simOfflineMarks).toEqual([{ atMs: firstReportMs, node: "pve3" }]);
    expect(firstReportMs).toBeLessThan(flushAtMs - 60_000);

    // pve1's first push after the flush (+910 s) restarts its streak.
    const established: SimPush = firstEstablishedPush(pushes, flushAtMs)!;
    expect(established.node).toBe("pve1");
    expect(established.atMs).toBe(T0 + 910_000 + PROXMOX_NODE_SILENCE_MS);

    const continued: Array<SimPush> = [];
    for (const simPush of pushes) {
      if (simPush.atMs <= firstReportMs + PUSH_INTERVAL_MS) {
        continue;
      }
      expect(simPush.decision).toEqual({
        silentNodes: ["pve3"],
        reporterCount: 2,
      });
      if (simPush.atMs > flushAtMs && simPush.atMs < established.atMs) {
        expect(simPush.clusterEstablished).toBe(false);
        // R: at the roster's load, never older than a refresh plus a push.
        expect(simPush.offlineMarkAgesMs.get("pve3")).toBeLessThanOrEqual(
          MARK_REFRESH_MS + PUSH_INTERVAL_MS,
        );
        continued.push(simPush);
      }
    }

    // Not vacuous: 24 pushes with nobody established, every one reporting.
    expect(continued).toHaveLength(24);
    expect(continuationBreaches(pushes, "pve3", flushAtMs, "flush")).toEqual(
      [],
    );
    // The mark was rewritten before the flush, and through it.
    expect(lastMarkBefore("pve3", flushAtMs)).toBe(T0 + 850_000);
    expect(
      markWritesOf("pve3").filter((writeMs: number) => {
        return writeMs > flushAtMs && writeMs < established.atMs;
      }),
    ).toEqual([T0 + 913_000, T0 + 980_000]);
    expect(otherRedisCalls()).toEqual([]);

    expect(
      minutesLookingUp(pushes, "pve3", firstReportMs + 60_000, untilMs),
    ).toEqual([]);
    expect(reportsNaming(pushes, "pve1")).toEqual([]);
    expect(reportsNaming(pushes, "pve2")).toEqual([]);
  });

  /*
   * Was "a Redis flush pauses a dead node's reports until a node is
   * established again". Here the Offline write never lands (markOffline:
   * false), so every report after the flush is a first report again and
   * waits for an established node, 2 minutes after the first push
   * following the flush, and then every live node reports it again. A
   * node already Offline, marked recently, does not pause (above, M).
   */
  test("a Redis flush pauses the reports of a dead node whose Offline mark never landed, until a node is established again", async () => {
    const untilMs: number = T0 + 1_800_000;
    const flushAtMs: number = T0 + 905_000;
    const pushes: Array<SimPush> = await simulate({
      nodes: [
        { name: "pve1", phaseMs: 0, windows: always(untilMs) },
        { name: "pve2", phaseMs: 3_000, windows: always(untilMs) },
        { name: "pve3", phaseMs: 7_000, windows: [[T0, T0 + 600_000]] },
      ],
      untilMs,
      markOffline: false,
      actions: [
        {
          atMs: flushAtMs,
          run: (): void => {
            redis.clear();
          },
        },
      ],
    });

    expect(simOfflineMarks).toEqual([]);
    const reports: Array<SimPush> = reportsNaming(pushes, "pve3");
    // Reported before the flush…
    expect(
      reports.filter((report: SimPush) => {
        return report.atMs < flushAtMs;
      }).length,
    ).toBeGreaterThan(0);
    // …not for the 2 minutes after it…
    const firstAfterMs: number = reports.find((report: SimPush) => {
      return report.atMs > flushAtMs;
    })!.atMs;
    expect(firstAfterMs).toBeGreaterThanOrEqual(
      flushAtMs + PROXMOX_NODE_SILENCE_MS,
    );
    expect(firstAfterMs).toBeLessThanOrEqual(
      flushAtMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
    );
    // …then by both survivors again, on every push.
    for (const simPush of pushes) {
      if (simPush.atMs > firstAfterMs + PUSH_INTERVAL_MS) {
        expect(simPush.decision).toEqual({
          silentNodes: ["pve3"],
          reporterCount: 2,
        });
      }
    }
  });

  /*
   * A survivor whose pushes are not processed for 60–120 s: its streak
   * restarts, but its key never expires, so it is never silent — and with
   * the other survivors established it reports again from its very first
   * push back, and every report keeps counting it as live. With the old
   * "only established nodes report" rule it went quiet for 2 minutes and
   * reporterCount dropped, so Quorum at Risk flapped for ~5 minutes.
   */
  describe("a survivor that drops out for 60–120 s", () => {
    test.each([
      { title: "70 s", gapMs: 70_000 },
      { title: "90 s", gapMs: 90_000 },
      { title: "110 s", gapMs: 110_000 },
    ])(
      "reports again from its first push back ($title between pushes)",
      async ({ gapMs }: { title: string; gapMs: number }) => {
        const untilMs: number = T0 + 1_500_000;
        // pve2's last push before the drop-out is at T0 + 593 s.
        const pve2LastBeforeMs: number = T0 + 593_000;
        const pve2BackMs: number = pve2LastBeforeMs + gapMs;
        const pushes: Array<SimPush> = await simulate({
          nodes: [
            { name: "pve1", phaseMs: 0, windows: always(untilMs) },
            {
              name: "pve2",
              phaseMs: 3_000,
              windows: [
                [T0, pve2LastBeforeMs],
                [pve2BackMs, untilMs],
              ],
            },
            { name: "pve3", phaseMs: 7_000, windows: always(untilMs) },
            // pve4 dies long before and stays dead.
            { name: "pve4", phaseMs: 5_000, windows: [[T0, T0 + 300_000]] },
          ],
          untilMs,
        });

        expect(pushTimesOf(pushes, "pve2")).toContain(pve2BackMs);
        expect(pushTimesOf(pushes, "pve2")).not.toContain(
          pve2LastBeforeMs + PUSH_INTERVAL_MS,
        );

        // Its first push back already reports pve4, counting 3 live nodes…
        const backPush: SimPush = pushes.find((simPush: SimPush) => {
          return simPush.node === "pve2" && simPush.atMs === pve2BackMs;
        })!;
        expect(backPush.decision).toEqual({
          silentNodes: ["pve4"],
          reporterCount: 3,
        });

        // …while its own streak restarted at that push.
        expect(storedLiveness("pve2")?.streakStartMs).toBe(pve2BackMs);

        /*
         * From pve4's first report on, every push of every live node —
         * pve2's warm-up included — carries the same report, and pve2 is
         * never called silent.
         */
        const firstReportMs: number = reportsNaming(pushes, "pve4")[0]!.atMs;
        expect(firstReportMs).toBeLessThan(pve2LastBeforeMs);
        for (const simPush of pushes) {
          if (simPush.atMs >= firstReportMs + PUSH_INTERVAL_MS) {
            expect(simPush.decision).toEqual({
              silentNodes: ["pve4"],
              reporterCount: 3,
            });
          }
        }
        expect(reportsNaming(pushes, "pve2")).toEqual([]);
      },
    );

    /*
     * What that buys: in every full minute, Σ pve_up ÷ Σ pve_node_info —
     * one pve_up = 1 and pve_node_info = 1 per live push, plus D / L of
     * pve_node_info per report — is exactly L / (L + D) = 3 / 4, drop-out
     * minute included.
     */
    test("Quorum at Risk reads 3 / 4 in every minute, the drop-out included", async () => {
      const untilMs: number = T0 + 1_500_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          { name: "pve1", phaseMs: 0, windows: always(untilMs) },
          {
            name: "pve2",
            phaseMs: 3_000,
            windows: [
              [T0, T0 + 593_000],
              [T0 + 683_000, untilMs],
            ],
          },
          { name: "pve3", phaseMs: 7_000, windows: always(untilMs) },
          { name: "pve4", phaseMs: 5_000, windows: [[T0, T0 + 300_000]] },
        ],
        untilMs,
      });

      const firstReportMs: number = reportsNaming(pushes, "pve4")[0]!.atMs;
      const fromMinuteMs: number =
        T0 +
        Math.ceil((firstReportMs + PUSH_INTERVAL_MS - T0) / 60_000) * 60_000;
      let minutes: number = 0;
      for (
        let minuteMs: number = fromMinuteMs;
        minuteMs + 60_000 <= untilMs;
        minuteMs += 60_000
      ) {
        let up: number = 0;
        let info: number = 0;
        for (const simPush of pushes) {
          if (simPush.atMs < minuteMs || simPush.atMs >= minuteMs + 60_000) {
            continue;
          }
          up += 1;
          info += 1;
          if (simPush.decision) {
            info +=
              simPush.decision.silentNodes.length /
              simPush.decision.reporterCount;
          }
        }
        expect(up / info).toBeCloseTo(3 / 4, 12);
        minutes++;
      }
      expect(minutes).toBeGreaterThan(10);
    });
  });

  /*
   * An ingest outage just shorter than the key TTL: some keys written
   * before it have expired by the time the first push after it is
   * processed, others have not. A key that has not expired still carries
   * its pre-outage streak — the "no node is established until one has
   * pushed for 2 minutes after the outage" guard must not be satisfied by
   * such a key, or the first node back reports the siblings that simply
   * have not been processed yet.
   *
   * E.g. 115 s, phases 0 / 3 / 7 s: the last pushes before the outage are
   * pve2 at +593 s, pve3 at +597 s, pve1 at +600 s; pve3 is processed
   * first after it, at +717 s. pve2's key (124 s old) has expired and its
   * sighting is stale, while pve1's (117 s old, a 10-minute streak) has
   * not — so pve1 would read as established, though its next push will
   * restart its streak. Established therefore requires the streak to be
   * unbroken NOW (the last push at most 60 s old), not merely alive.
   */
  describe("after a OneUptime ingest outage shorter than the key TTL", () => {
    const outageFromMs: number = T0 + 600_000;

    test.each([
      { title: "65 s", outageMs: 65_000 },
      { title: "90 s", outageMs: 90_000 },
      { title: "105 s", outageMs: 105_000 },
      { title: "112 s", outageMs: 112_000 },
      { title: "115 s", outageMs: 115_000 },
      { title: "118 s", outageMs: 118_000 },
      { title: "125 s", outageMs: 125_000 },
      { title: "135 s", outageMs: 135_000 },
    ])(
      "no live node is reported ($title outage)",
      async ({ outageMs }: { title: string; outageMs: number }) => {
        const untilMs: number = T0 + 1_500_000;
        const outageToMs: number = outageFromMs + outageMs;
        const pushes: Array<SimPush> = await simulate({
          nodes: ["pve1", "pve2", "pve3"].map(
            (name: string, index: number): SimNode => {
              return {
                name,
                phaseMs: [0, 3_000, 7_000][index] as number,
                windows: [
                  [T0, outageFromMs],
                  [outageToMs, untilMs],
                ],
              };
            },
          ),
          untilMs,
        });

        expect(reportsOf(pushes)).toEqual([]);
      },
    );

    /*
     * Whether some sibling read at or after fromMs found one key expired
     * and, in the same read, another still alive with a streak of 2
     * minutes or more but a last push over 60 s old. Under the old "alive
     * and 2 minutes of streak" rule that key established the cluster and
     * the reporter reported the expired sibling (its sighting is as old as
     * its last push, so stale too) — a live node called silent.
     */
    function staleStreakReadBesideExpiredKey(fromMs: number): boolean {
      return mgetCalls.some((call: FakeMgetCall) => {
        if (call.atMs < fromMs || !call.values.includes(null)) {
          return false;
        }
        return call.values.some((value: string | null) => {
          const sibling: ProxmoxNodeLiveness | null =
            parseProxmoxNodeLiveness(value);
          return Boolean(
            sibling &&
              isAliveProxmoxNode(sibling, call.atMs) &&
              call.atMs - sibling.lastPushMs > PROXMOX_NODE_STREAK_GAP_MS &&
              call.atMs - sibling.streakStartMs >= PROXMOX_NODE_SILENCE_MS,
          );
        });
      });
    }

    interface OutageLayout {
      title: string;
      phasesMs: Array<number>;
      // Whether some outage length meets the old rule's false report.
      oldRuleHazard: boolean;
    }

    const outageLayouts: Array<OutageLayout> = [
      {
        title: "3 nodes, phases 0 / 3 / 7 s",
        phasesMs: [0, 3_000, 7_000],
        oldRuleHazard: true,
      },
      {
        title: "3 nodes, phases 0 / 9.999 / 5 s",
        phasesMs: [0, 9_999, 5_000],
        oldRuleHazard: true,
      },
      {
        title: "3 nodes, phases 9 / 0 / 5 s",
        phasesMs: [9_000, 0, 5_000],
        oldRuleHazard: true,
      },
      {
        title: "5 nodes, phases 0 / 1 / 4 / 6.5 / 9.5 s",
        phasesMs: [0, 1_000, 4_000, 6_500, 9_500],
        oldRuleHazard: true,
      },
      // Every key the same age: all expired or none, never a mix.
      {
        title: "3 nodes in phase",
        phasesMs: [0, 0, 0],
        oldRuleHazard: false,
      },
      // One sibling per reader: never an expired key beside a stale one.
      {
        title: "2 nodes, phases 0 / 5 s",
        phasesMs: [0, 5_000],
        oldRuleHazard: false,
      },
    ];

    /*
     * Every outage length from 55 s to 125 s, in 1 s steps: whichever
     * keys have or have not expired when the first pushes after it are
     * processed, no live node is ever reported — and the cluster is
     * established again afterwards (the check kept running).
     */
    test.each(outageLayouts)(
      "no live node is reported for any outage from 55 s to 125 s ($title)",
      async (layout: OutageLayout) => {
        const sweepOutageFromMs: number = T0 + 300_000;
        const nodeNames: Array<string> = layout.phasesMs.map(
          (_phaseMs: number, index: number) => {
            return `pve${index + 1}`;
          },
        );
        const lengthsWithReports: Array<number> = [];
        const lengthsWithOldRuleHazard: Array<number> = [];
        const lengthsNotReestablished: Array<number> = [];
        let runs: number = 0;

        for (
          let outageMs: number = 55_000;
          outageMs <= 125_000;
          outageMs += 1_000
        ) {
          resetFakeState();
          const outageToMs: number = sweepOutageFromMs + outageMs;
          const untilMs: number = outageToMs + 3 * PROXMOX_NODE_SILENCE_MS;
          const pushes: Array<SimPush> = await simulate({
            nodes: layout.phasesMs.map(
              (phaseMs: number, index: number): SimNode => {
                return {
                  name: nodeNames[index] as string,
                  phaseMs,
                  windows: [
                    [T0, sweepOutageFromMs],
                    [outageToMs, untilMs],
                  ],
                };
              },
            ),
            untilMs,
          });

          if (reportsOf(pushes).length > 0) {
            lengthsWithReports.push(outageMs);
          }
          if (staleStreakReadBesideExpiredKey(outageToMs)) {
            lengthsWithOldRuleHazard.push(outageMs);
          }
          const endMs: number = clockMs;
          const reestablished: boolean = nodeNames.every((nodeName: string) => {
            return isEligibleProxmoxReporter(storedLiveness(nodeName), endMs);
          });
          if (!reestablished) {
            lengthsNotReestablished.push(outageMs);
          }
          runs++;
        }

        expect(runs).toBe(71);
        expect(lengthsWithReports).toEqual([]);
        expect(lengthsNotReestablished).toEqual([]);
        if (layout.oldRuleHazard) {
          expect(lengthsWithOldRuleHazard.length).toBeGreaterThan(0);
        } else {
          expect(lengthsWithOldRuleHazard).toEqual([]);
        }
      },
    );

    /*
     * The same sweep with one more node, dead since T0 + 60 s and Offline
     * long before the outage. Whichever keys have or have not expired when
     * the first pushes after it are processed — some pushes established,
     * some continuation — every push after the Offline mark reports that
     * node and nothing else: a live node, whose key may have expired but
     * whose row is not Offline, is never reported. These outages are far
     * shorter than the 300 s window: the dead node's mark, rewritten at
     * most once a minute while it was reported, is at most ~3 minutes old
     * when the first push after them loads the roster, so it bridges them
     * (M, R). Every report
     * counts L = every live node (I) — from the first push after the
     * outage, while most keys are not back yet.
     */
    test.each([
      {
        title: "3 live nodes, phases 0 / 3 / 7 s",
        phasesMs: [0, 3_000, 7_000],
      },
      {
        title: "5 live nodes, phases 0 / 1 / 4 / 6.5 / 9.5 s",
        phasesMs: [0, 1_000, 4_000, 6_500, 9_500],
      },
    ] as Array<{ title: string; phasesMs: Array<number> }>)(
      "a node already Offline is reported on every push, and no live node ever, for any outage from 55 s to 125 s ($title)",
      async ({ phasesMs }: { title: string; phasesMs: Array<number> }) => {
        const sweepOutageFromMs: number = T0 + 300_000;
        const liveNames: Array<string> = phasesMs.map(
          (_phaseMs: number, index: number) => {
            return `pve${index + 1}`;
          },
        );
        const deadName: string = `pve${phasesMs.length + 1}`;
        const lengthsWithLiveReports: Array<number> = [];
        const lengthsWithGaps: Array<number> = [];
        const lengthsWithWrongCount: Array<number> = [];
        const lengthsWithContinuation: Array<number> = [];
        const lengthsWithKeysTrailing: Array<number> = [];
        let runs: number = 0;

        for (
          let outageMs: number = 55_000;
          outageMs <= 125_000;
          outageMs += 1_000
        ) {
          resetFakeState();
          const outageToMs: number = sweepOutageFromMs + outageMs;
          const untilMs: number = outageToMs + 3 * PROXMOX_NODE_SILENCE_MS;
          const pushes: Array<SimPush> = await simulate({
            nodes: [
              ...phasesMs.map((phaseMs: number, index: number): SimNode => {
                return {
                  name: liveNames[index] as string,
                  phaseMs,
                  windows: [
                    [T0, sweepOutageFromMs],
                    [outageToMs, untilMs],
                  ],
                };
              }),
              { name: deadName, phaseMs: 5_000, windows: [[T0, T0 + 60_000]] },
            ],
            untilMs,
          });

          const markMs: number | undefined = simOfflineMarks.find(
            (mark: SimOfflineMark) => {
              return mark.node === deadName;
            },
          )?.atMs;
          if (
            markMs === undefined ||
            markMs > sweepOutageFromMs - 60_000 ||
            simOfflineMarks.length !== 1
          ) {
            lengthsWithGaps.push(outageMs);
            runs++;
            continue;
          }

          if (
            liveNames.some((nodeName: string) => {
              return reportsNaming(pushes, nodeName).length > 0;
            })
          ) {
            lengthsWithLiveReports.push(outageMs);
          }

          const settled: Array<SimPush> = pushes.filter((simPush: SimPush) => {
            return simPush.atMs > markMs + PUSH_INTERVAL_MS;
          });
          if (
            settled.some((simPush: SimPush) => {
              return (
                simPush.decision?.silentNodes.length !== 1 ||
                simPush.decision.silentNodes[0] !== deadName
              );
            })
          ) {
            lengthsWithGaps.push(outageMs);
          }

          /*
           * I: every live node on every push — nodes − D — including the
           * pushes that found some live nodes' keys not back yet (the old
           * count, keyedLiveCount, trailed there).
           */
          if (
            settled.some((simPush: SimPush) => {
              return simPush.decision?.reporterCount !== liveNames.length;
            })
          ) {
            lengthsWithWrongCount.push(outageMs);
          }
          if (
            settled.some((simPush: SimPush) => {
              return (
                simPush.atMs >= outageToMs &&
                (simPush.keyedLiveCount ?? liveNames.length) < liveNames.length
              );
            })
          ) {
            lengthsWithKeysTrailing.push(outageMs);
          }

          if (
            settled.some((simPush: SimPush) => {
              return simPush.atMs >= outageToMs && !simPush.clusterEstablished;
            })
          ) {
            lengthsWithContinuation.push(outageMs);
          }
          runs++;
        }

        expect(runs).toBe(71);
        expect(lengthsWithLiveReports).toEqual([]);
        expect(lengthsWithGaps).toEqual([]);
        expect(lengthsWithWrongCount).toEqual([]);
        // Not vacuous: most outage lengths left nobody established after it…
        expect(lengthsWithContinuation.length).toBeGreaterThan(50);
        /*
         * …and the longest ones (from ~112 s, once keys written just before
         * the outage expire) had pushes that found live keys missing — where
         * the old count undercounted L.
         */
        expect(lengthsWithKeysTrailing.length).toBeGreaterThanOrEqual(10);
        expect(lengthsWithKeysTrailing).toContain(125_000);
        expect(lengthsWithKeysTrailing).not.toContain(100_000);
      },
    );
  });

  /*
   * When the cluster's ONLY established node goes quiet for 61–119 s, the
   * cluster has no established node from 60 s into the silence — the quiet
   * node is still alive, so it is never reported itself. Its first push
   * back comes after a gap over 60 s and restarts its streak, so the
   * cluster is established again only once ANY node is: the sibling that
   * is warming up, once its own streak reaches 2 minutes, or else the
   * quiet node itself, 2 minutes after its first push back.
   *
   * The dead node was reported and turned Offline long before, so its
   * reports never pause (continuation): every push in between still
   * reports it. Only if its Offline mark never landed do they pause — the
   * price of "unbroken now" that continuation removes. M: the dead node's
   * mark, rewritten at most once a minute while it is reported, is at
   * most ~70 s old when pve1 goes quiet and well under 300 s when it is
   * back after ≤ 119 s and loads the roster (R); from then on its
   * continuation reports rewrite it again, so it bridges the warm-up after
   * it too.
   *
   * pve1 is established from T0 and goes quiet after its push at
   * quietFromMs; its first push back lands exactly quietMs after it (a
   * second entry for pve1 on a new phase). pve3 died long before. pve2,
   * when present, died too and is back from a reboot shortly before or
   * during pve1's silence, so it is still warming up then.
   */
  describe("the only established node going quiet for 61–119 s", () => {
    interface QuietLayout {
      title: string;
      // pve2's return relative to pve1's last push; null: no pve2.
      siblingBackOffsetMs: number | null;
    }

    const quietLayouts: Array<QuietLayout> = [
      {
        title: "a sibling back from a reboot 30 s before",
        siblingBackOffsetMs: -30_000,
      },
      {
        title: "a sibling back from a reboot 10 s into the silence",
        siblingBackOffsetMs: 10_000,
      },
      { title: "no other live node", siblingBackOffsetMs: null },
    ];

    function quietNodes(
      layout: QuietLayout,
      quietFromMs: number,
      quietMs: number,
      untilMs: number,
    ): Array<SimNode> {
      const backMs: number = quietFromMs + quietMs;
      const nodes: Array<SimNode> = [
        { name: "pve1", phaseMs: 0, windows: [[T0, quietFromMs]] },
        {
          name: "pve1",
          phaseMs: quietMs % PUSH_INTERVAL_MS,
          windows: [[backMs, untilMs]],
        },
        { name: "pve3", phaseMs: 7_000, windows: [[T0, T0 + 200_000]] },
      ];
      if (layout.siblingBackOffsetMs !== null) {
        nodes.push({
          name: "pve2",
          phaseMs: 3_000,
          windows: [
            [T0, T0 + 200_000],
            [quietFromMs + layout.siblingBackOffsetMs, untilMs],
          ],
        });
      }
      return nodes;
    }

    /*
     * pve3 is Offline long before pve1 goes quiet, so every push after
     * that — pve2's while nobody is established, pve1's first pushes back
     * with its streak restarted — reports it, counting every node not
     * reported (I).
     * pve1 (alive throughout) and pve2 (once back) are never reported.
     */
    test.each(quietLayouts)(
      "keeps reporting a node already Offline on every push, never reports a live one ($title)",
      async (layout: QuietLayout) => {
        const quietFromMs: number = T0 + 600_000;
        const pauseFromMs: number = quietFromMs + PROXMOX_NODE_STREAK_GAP_MS;
        const liveCount: number = layout.siblingBackOffsetMs === null ? 1 : 2;
        const lengthsWithGaps: Array<number> = [];
        const lengthsWithFalseReports: Array<number> = [];
        const lengthsWithoutContinuation: Array<number> = [];
        let runs: number = 0;

        for (
          let quietMs: number = 61_000;
          quietMs <= 119_000;
          quietMs += 1_000
        ) {
          resetFakeState();
          const backMs: number = quietFromMs + quietMs;
          const untilMs: number = backMs + 180_000;
          const pushes: Array<SimPush> = await simulate({
            nodes: quietNodes(layout, quietFromMs, quietMs, untilMs),
            untilMs,
          });

          // pve3 turned Offline long before the silence.
          const pve3Marks: Array<SimOfflineMark> = simOfflineMarks.filter(
            (mark: SimOfflineMark) => {
              return mark.node === "pve3";
            },
          );
          expect(pve3Marks).toHaveLength(1);
          expect(pve3Marks[0]!.atMs).toBeLessThan(quietFromMs);

          const afterQuiet: Array<SimPush> = pushes.filter(
            (simPush: SimPush) => {
              return simPush.atMs > quietFromMs;
            },
          );
          const gaps: boolean = afterQuiet.some((simPush: SimPush) => {
            return (
              simPush.decision?.silentNodes.length !== 1 ||
              simPush.decision.silentNodes[0] !== "pve3" ||
              simPush.decision.reporterCount !== liveCount
            );
          });
          if (gaps || !pushTimesOf(pushes, "pve1").includes(backMs)) {
            lengthsWithGaps.push(quietMs);
          }

          const pve2BackMs: number | undefined =
            layout.siblingBackOffsetMs === null
              ? undefined
              : pushTimesOf(pushes, "pve2").find((atMs: number) => {
                  return atMs >= quietFromMs + layout.siblingBackOffsetMs!;
                });
          const falseReport: boolean =
            reportsNaming(pushes, "pve1").length > 0 ||
            reportsNaming(pushes, "pve2").some((report: SimPush) => {
              return pve2BackMs !== undefined && report.atMs >= pve2BackMs;
            });
          if (falseReport) {
            lengthsWithFalseReports.push(quietMs);
          }

          // Not vacuous: some of those reports came with nobody established.
          const continued: boolean = afterQuiet.some((simPush: SimPush) => {
            return simPush.atMs > pauseFromMs && !simPush.clusterEstablished;
          });
          if (!continued) {
            lengthsWithoutContinuation.push(quietMs);
          }
          runs++;
        }

        expect(runs).toBe(59);
        expect(lengthsWithGaps).toEqual([]);
        expect(lengthsWithFalseReports).toEqual([]);
        expect(lengthsWithoutContinuation).toEqual([]);
      },
    );

    /*
     * Was "pauses the dead node's reports, never reports a live one, and
     * resumes once a node is established again": that holds only while the
     * dead node's row is not Offline — here its Offline mark never lands
     * (markOffline: false), so each report after the pause starts is a
     * first report and waits for an established node.
     */
    test.each(quietLayouts)(
      "pauses the reports of a dead node whose Offline mark never landed, never reports a live one, and resumes once a node is established again ($title)",
      async (layout: QuietLayout) => {
        const quietFromMs: number = T0 + 600_000;
        const pauseFromMs: number = quietFromMs + PROXMOX_NODE_STREAK_GAP_MS;
        const liveCount: number = layout.siblingBackOffsetMs === null ? 1 : 2;
        let runs: number = 0;

        for (
          let quietMs: number = 61_000;
          quietMs <= 119_000;
          quietMs += 1_000
        ) {
          resetFakeState();
          const backMs: number = quietFromMs + quietMs;
          const untilMs: number = backMs + 180_000;
          const nodes: Array<SimNode> = [
            { name: "pve1", phaseMs: 0, windows: [[T0, quietFromMs]] },
            {
              name: "pve1",
              phaseMs: quietMs % PUSH_INTERVAL_MS,
              windows: [[backMs, untilMs]],
            },
            { name: "pve3", phaseMs: 7_000, windows: [[T0, T0 + 200_000]] },
          ];
          if (layout.siblingBackOffsetMs !== null) {
            nodes.push({
              name: "pve2",
              phaseMs: 3_000,
              windows: [
                [T0, T0 + 200_000],
                [quietFromMs + layout.siblingBackOffsetMs, untilMs],
              ],
            });
          }
          const pushes: Array<SimPush> = await simulate({
            nodes,
            untilMs,
            markOffline: false,
          });
          expect(simOfflineMarks).toEqual([]);

          const pve1Times: Array<number> = pushTimesOf(pushes, "pve1");
          expect(pve1Times).toContain(quietFromMs);
          expect(pve1Times).toContain(backMs);
          expect(
            pve1Times.filter((atMs: number) => {
              return atMs > quietFromMs && atMs < backMs;
            }),
          ).toEqual([]);

          /*
           * When the cluster is established again: 2 minutes into the
           * streak of pve1's first push back, or of pve2's first push
           * after its reboot, whichever comes first.
           */
          let establishedAgainMs: number = backMs + PROXMOX_NODE_SILENCE_MS;
          let pve2BackMs: number | null = null;
          if (layout.siblingBackOffsetMs !== null) {
            const pve2ReturnFromMs: number =
              quietFromMs + layout.siblingBackOffsetMs;
            const firstBackMs: number = pushTimesOf(pushes, "pve2").find(
              (atMs: number) => {
                return atMs >= pve2ReturnFromMs;
              },
            ) as number;
            pve2BackMs = firstBackMs;
            establishedAgainMs = Math.min(
              establishedAgainMs,
              firstBackMs + PROXMOX_NODE_SILENCE_MS,
            );

            // Never a false report: pve2 is not named once it is back.
            expect(
              reportsNaming(pushes, "pve2").filter((report: SimPush) => {
                return report.atMs >= firstBackMs;
              }),
            ).toEqual([]);
          }

          // Nor is pve1, alive throughout its silence.
          expect(reportsNaming(pushes, "pve1")).toEqual([]);

          // Still reporting pve3 for the first 60 s of pve1's silence…
          const beforePause: Array<SimPush> = pushes.filter(
            (simPush: SimPush) => {
              return simPush.atMs > quietFromMs && simPush.atMs <= pauseFromMs;
            },
          );
          for (const simPush of beforePause) {
            expect(simPush.decision).toEqual({
              silentNodes: ["pve3"],
              reporterCount: liveCount,
            });
          }
          if (pve2BackMs !== null) {
            expect(beforePause.length).toBeGreaterThan(0);
          }

          // …then nothing until a node is established again…
          const paused: Array<SimPush> = pushes.filter((simPush: SimPush) => {
            return (
              simPush.atMs > pauseFromMs && simPush.atMs < establishedAgainMs
            );
          });
          expect(paused.length).toBeGreaterThan(0);
          for (const simPush of paused) {
            expect(simPush.decision).toBeNull();
          }

          // …and from that very push on, every push reports pve3 again.
          const resumed: Array<SimPush> = pushes.filter((simPush: SimPush) => {
            return simPush.atMs >= establishedAgainMs;
          });
          expect(resumed[0]?.atMs).toBe(establishedAgainMs);
          for (const simPush of resumed) {
            expect(simPush.decision).toEqual({
              silentNodes: ["pve3"],
              reporterCount: liveCount,
            });
          }
          runs++;
        }

        expect(runs).toBe(59);
      },
    );
  });

  /*
   * A two-node cluster: pve2 died at T0 + 300 s and is reported, then
   * Offline; pve1 is the lone survivor and the only node that can be
   * established. OneUptime processes none of pve1's pushes for 90 s, so
   * its first push back restarts its streak and nobody is established for
   * the 2 minutes after it. Continuation keeps every one of those pushes
   * reporting pve2 — before, they reported nothing, and the minutes they
   * fell in read pve2 as up. M: pve2's mark, rewritten every 70 s while
   * pve1 reports it (+420, +490, +560 s), is 130 s old at pve1's first
   * push back, which rewrites it at once.
   */
  describe("a lone survivor's own 90 s gap", () => {
    const gapFromMs: number = T0 + 600_000;
    const backMs: number = gapFromMs + 90_000;
    const untilMs: number = T0 + 1_200_000;
    const nodes: Array<SimNode> = [
      {
        name: "pve1",
        phaseMs: 0,
        windows: [
          [T0, gapFromMs],
          [backMs, untilMs],
        ],
      },
      { name: "pve2", phaseMs: 5_000, windows: [[T0, T0 + 300_000]] },
    ];

    function warmUpAfterGap(pushes: Array<SimPush>): Array<SimPush> {
      return pushes.filter((simPush: SimPush) => {
        return (
          simPush.atMs >= backMs &&
          simPush.atMs < backMs + PROXMOX_NODE_SILENCE_MS
        );
      });
    }

    test("keeps reporting its Offline sibling on every push, the 2 minutes after the gap included", async () => {
      const pushes: Array<SimPush> = await simulate({ nodes, untilMs });

      const pve1Times: Array<number> = pushTimesOf(pushes, "pve1");
      expect(pve1Times).toContain(gapFromMs);
      expect(pve1Times).toContain(backMs);
      expect(
        pve1Times.filter((atMs: number) => {
          return atMs > gapFromMs && atMs < backMs;
        }),
      ).toEqual([]);

      // pve2's last push is at +295 s: first reported at +420 s, then Offline.
      const firstReportMs: number = reportsNaming(pushes, "pve2")[0]!.atMs;
      expect(firstReportMs).toBe(T0 + 420_000);
      expect(simOfflineMarks).toEqual([{ atMs: firstReportMs, node: "pve2" }]);

      for (const simPush of pushes) {
        if (simPush.atMs >= firstReportMs) {
          expect(simPush.decision).toEqual({
            silentNodes: ["pve2"],
            reporterCount: 1,
          });
        }
      }

      // Those 2 minutes were continuation: pve1's streak had restarted.
      const warmUp: Array<SimPush> = warmUpAfterGap(pushes);
      expect(warmUp).toHaveLength(12);
      for (const simPush of warmUp) {
        expect(simPush.clusterEstablished).toBe(false);
      }
      expect(
        pushes.find((simPush: SimPush) => {
          return simPush.atMs === backMs + PROXMOX_NODE_SILENCE_MS;
        })?.clusterEstablished,
      ).toBe(true);

      // M: the mark, 130 s old at the first push back, rewritten by it.
      expect(markWritesOf("pve2").slice(0, 5)).toEqual([
        T0 + 420_000,
        T0 + 490_000,
        T0 + 560_000,
        backMs,
        backMs + 70_000,
      ]);
      expect(warmUp[0]!.rosterReadAtMs).toBe(backMs);
      expect(warmUp[0]!.offlineMarkAgesMs.get("pve2")).toBe(130_000);
      expect(continuationBreaches(pushes, "pve2", backMs, "90 s gap")).toEqual(
        [],
      );

      expect(
        minutesLookingUp(pushes, "pve2", firstReportMs + 60_000, untilMs),
      ).toEqual([]);
    });

    /*
     * The behaviour continuation replaces, still what happens when pve2's
     * Offline mark never lands: its reports stop for the 2 minutes after
     * the gap, and two minutes read it as up.
     */
    test("without the Offline mark, the 2 minutes after the gap report nothing and read it as up", async () => {
      const pushes: Array<SimPush> = await simulate({
        nodes,
        untilMs,
        markOffline: false,
      });

      const firstReportMs: number = reportsNaming(pushes, "pve2")[0]!.atMs;
      expect(firstReportMs).toBe(T0 + 420_000);
      for (const simPush of warmUpAfterGap(pushes)) {
        expect(simPush.decision).toBeNull();
      }
      expect(
        minutesLookingUp(pushes, "pve2", firstReportMs + 60_000, untilMs),
      ).toEqual([T0 + 660_000, T0 + 720_000]);
      expect(simMarkWrites).toEqual([]);
    });
  });

  /*
   * The lone survivor's gap swept from 61 s to 400 s (3 s steps). A gap
   * over 60 s restarts its streak, so for the 2 minutes after it nobody is
   * established, and continuation alone can report pve2. M, Q, R: that
   * holds while pve2's mark — last rewritten at +560 s, before the gap from
   * +600 s — is at most 300 s old when the first push back loads the
   * roster, i.e. while pve1 is back by +860 s; that push rewrites the mark.
   * Back later, the whole cluster has been silent to OneUptime past the
   * monitors' window (a OneUptime outage looks the same): nothing is
   * reported until pve1 is established again, 2 minutes into its new
   * streak. The ~3-minute gaps that stopped the reports under J (the
   * window key was refreshed only by established pushes) are now continued
   * on every push.
   *
   * Pinned for every gap, the first pushes back at the window's edge
   * included: with nobody established, a push reports pve2 exactly when its
   * roster was loaded with the mark at most 300 s old, and every push one
   * cached roster serves decides alike — so there is no hole (no push
   * without the report between two with it), and after a continued gap
   * every push from the first one back reports pve2. The pushes the first
   * push back's roster serves, up to 30 s after it, find the old mark more
   * than 300 s old by their own clock: judged on it — on a 300 s window, or
   * on O's 330 s — they dropped the report until the next load read the
   * rewritten mark (the hole a previous run measured).
   */
  test("a lone survivor's own gap of 61 s to 400 s: continued on every push while its sibling's mark is within the window, else waits for its own streak — no hole", async () => {
    const gapFromMs: number = T0 + 600_000;
    const lastMarkMs: number = T0 + 560_000;
    const reportsPve2: (
      decision: ProxmoxSilentNodeDecision | null,
    ) => boolean = (decision: ProxmoxSilentNodeDecision | null): boolean => {
      return (
        JSON.stringify(decision) ===
        JSON.stringify({ silentNodes: ["pve2"], reporterCount: 1 })
      );
    };
    const continuedGaps: Array<number> = [];
    const continuedThroughout: Array<number> = [];
    const pausedGaps: Array<number> = [];
    // Gaps after which a push was continued on the roster's load alone.
    const carriedByTheLoad: Array<number> = [];
    const wrong: Array<string> = [];

    for (let gapMs: number = 61_000; gapMs <= 400_000; gapMs += 3_000) {
      resetFakeState();
      const backMs: number = gapFromMs + gapMs;
      const untilMs: number = backMs + 180_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          { name: "pve1", phaseMs: 0, windows: [[T0, gapFromMs]] },
          {
            name: "pve1",
            phaseMs: gapMs % PUSH_INTERVAL_MS,
            windows: [[backMs, untilMs]],
          },
          { name: "pve2", phaseMs: 5_000, windows: [[T0, T0 + 300_000]] },
        ],
        untilMs,
      });

      if (lastMarkBefore("pve2", gapFromMs + 1) !== lastMarkMs) {
        wrong.push(`${gapMs}: last mark before the gap moved`);
      }
      if (reportsNaming(pushes, "pve1").length > 0) {
        wrong.push(`${gapMs}: pve1 reported`);
      }
      const afterGap: Array<SimPush> = pushes.filter((simPush: SimPush) => {
        return simPush.atMs >= backMs;
      });
      if (afterGap[0]?.atMs !== backMs || afterGap.length !== 19) {
        wrong.push(`${gapMs}: pushes after the gap`);
      }
      if (afterGap[0]?.rosterReadAtMs !== backMs) {
        wrong.push(`${gapMs}: the first push back did not load the roster`);
      }

      const reestablishedMs: number = backMs + PROXMOX_NODE_SILENCE_MS;
      const insideWindow: boolean =
        backMs - lastMarkMs <= PROXMOX_MONITOR_WINDOW_MS;
      for (const simPush of afterGap) {
        const at: string = `${gapMs}: push at +${simPush.atMs - T0}`;
        const reported: boolean = reportsPve2(simPush.decision);
        if (simPush.decision && !reported) {
          wrong.push(`${at} reported ${JSON.stringify(simPush.decision)}`);
        }
        if (simPush.clusterEstablished !== simPush.atMs >= reestablishedMs) {
          wrong.push(`${at}: established ${simPush.clusterEstablished}`);
        }
        if (simPush.atMs >= reestablishedMs) {
          if (!reported) {
            wrong.push(`${at}: established, not reported`);
          }
        } else if (!insideWindow && reported) {
          wrong.push(`${at}: continued past the window`);
        }
      }
      // Q, R: before it, reported exactly on a load within 300 s, alike per load.
      wrong.push(...continuationBreaches(pushes, "pve2", backMs, `${gapMs}`));
      if (continuedOnTheLoadAlone(pushes, "pve2", backMs)) {
        carriedByTheLoad.push(gapMs);
      }
      // No reported → unreported → reported, continued or not.
      const holes: Array<number> = reportHoles(pushes, "pve2", backMs);
      if (holes.length > 0) {
        wrong.push(
          `${gapMs}: back at +${backMs - T0}, no report at ${holes
            .map((atMs: number) => {
              return `+${atMs - T0}`;
            })
            .join(", ")}`,
        );
      }

      if (!insideWindow) {
        pausedGaps.push(gapMs);
      } else {
        continuedGaps.push(gapMs);
        if (!reportsPve2(afterGap[0]?.decision ?? null)) {
          wrong.push(`${gapMs}: the first push back was not continued`);
        }
        if (
          afterGap.every((simPush: SimPush) => {
            return reportsPve2(simPush.decision);
          })
        ) {
          continuedThroughout.push(gapMs);
        }
      }
    }

    expect(wrong).toEqual([]);
    /*
     * Every gap up to 259 s (back by +860 s, the mark 300 s old at its
     * load) — the 90 s and ~3-minute gaps included — is continued on every
     * push, with no hole; from 262 s (back at +862 s) nothing is continued
     * before pve1 is established again. O's 330 s continued up to 289 s.
     */
    const expectedContinued: Array<number> = [];
    for (let gapMs: number = 61_000; gapMs <= 259_000; gapMs += 3_000) {
      expectedContinued.push(gapMs);
    }
    expect(continuedGaps).toEqual(expectedContinued);
    expect(continuedThroughout).toEqual(expectedContinued);
    expect(continuedThroughout).toContain(181_000);
    expect(pausedGaps[0]).toBe(262_000);
    expect(pausedGaps[pausedGaps.length - 1]).toBe(400_000);
    expect(pausedGaps).toHaveLength(47);
    /*
     * Not vacuous: from a 232 s gap on (back at +832 s or later) the
     * roster the first push back loaded served pushes that found the old
     * mark over 300 s old by their own clock — R's load time alone
     * continued those.
     */
    const expectedCarried: Array<number> = [];
    for (let gapMs: number = 232_000; gapMs <= 259_000; gapMs += 3_000) {
      expectedCarried.push(gapMs);
    }
    expect(carriedByTheLoad).toEqual(expectedCarried);
  });

  /*
   * OneUptime processing a lone survivor's pushes in bursts 50–70 s apart
   * (a queue stall): each burst processes, in order, the pushes queued
   * since the one before. A gap over 60 s between processed pushes
   * restarts the streak, so the survivor is established again only after
   * a run of bursts at most 60 s apart that spans 2 minutes — with steady
   * 70 s bursts, never. pve2 died long before and is already Offline.
   *
   * M: every burst's first push finds pve2's mark at most ~2 minutes old
   * (bursts ≤ 70 s apart, the mark rewritten whenever a report finds it
   * over 60 s old), so every push of every burst — established or not —
   * reports pve2, and no minute reads it as up. Under J the window key
   * was refreshed only by established pushes: the bursts after it expired
   * reported nothing (with steady 70 s bursts, from +300 s on, for good),
   * and those minutes read pve2 as up.
   */
  describe("a lone survivor processed in bursts 50–70 s apart", () => {
    const burstsFromMs: number = T0 + 600_000;

    function burstTimes(gapsMs: Array<number>): Array<number> {
      const times: Array<number> = [];
      let atMs: number = burstsFromMs;
      for (const gapMs of gapsMs) {
        atMs += gapMs;
        times.push(atMs);
      }
      return times;
    }

    function burstNodes(burstsMs: Array<number>): Array<SimNode> {
      return [
        { name: "pve1", phaseMs: 0, windows: [[T0, burstsFromMs]] },
        {
          name: "pve1",
          phaseMs: 0,
          windows: [
            [burstsFromMs + 1, burstsMs[burstsMs.length - 1] as number],
          ],
          burstsMs,
        },
        { name: "pve2", phaseMs: 5_000, windows: [[T0, T0 + 300_000]] },
      ];
    }

    function fromBursts(offsetsMs: Array<number>): Array<number> {
      return offsetsMs.map((offsetMs: number) => {
        return burstsFromMs + offsetMs;
      });
    }

    interface BurstCase {
      title: string;
      gapsMs: Array<number>;
      // The bursts (from burstsFromMs) in which pve1 is established.
      establishedAtMs: Array<number>;
    }

    const burstCases: Array<BurstCase> = [
      {
        /*
         * Streaks restart at +70, +185, +301, +430, +500, +720 and +901 s;
         * only the runs +500 → +650 (50 s gaps) and +720 → +840 (60 s
         * gaps) span 2 minutes, so pve1 is established in exactly the
         * bursts at +650 and +840 s.
         */
        title: "mixed 50–70 s",
        gapsMs: [
          70_000, 50_000, 65_000, 55_000, 61_000, 59_000, 70_000, 70_000,
          50_000, 50_000, 50_000, 70_000, 60_000, 60_000, 61_000,
        ],
        establishedAtMs: fromBursts([650_000, 840_000]),
      },
      {
        title: "steady 70 s",
        gapsMs: new Array<number>(12).fill(70_000),
        establishedAtMs: [],
      },
    ];

    test.each(burstCases)(
      "keeps reporting its Offline sibling on every push, established or not ($title bursts)",
      async (burstCase: BurstCase) => {
        const bursts: Array<number> = burstTimes(burstCase.gapsMs);
        const lastBurstMs: number = bursts[bursts.length - 1] as number;
        const pushes: Array<SimPush> = await simulate({
          nodes: burstNodes(bursts),
          untilMs: lastBurstMs,
        });

        const marks: Array<SimOfflineMark> = simOfflineMarks;
        expect(marks).toHaveLength(1);
        expect(marks[0]!.node).toBe("pve2");
        expect(marks[0]!.atMs).toBeLessThan(burstsFromMs);

        const burstPushes: Array<SimPush> = pushes.filter(
          (simPush: SimPush) => {
            return simPush.atMs > burstsFromMs;
          },
        );
        // Every push made after +600 s, processed only at the bursts.
        expect(burstPushes).toHaveLength(
          Math.floor((lastBurstMs - burstsFromMs) / PUSH_INTERVAL_MS),
        );
        expect(
          new Set<number>(
            burstPushes.map((simPush: SimPush) => {
              return simPush.atMs;
            }),
          ),
        ).toEqual(new Set<number>(bursts));

        for (const simPush of burstPushes) {
          expect(simPush.decision).toEqual({
            silentNodes: ["pve2"],
            reporterCount: 1,
          });
          // Every mark its roster was loaded with was well inside the window.
          expect(simPush.offlineMarkAgesMs.get("pve2")).toBeLessThanOrEqual(
            MARK_REFRESH_MS + 70_000,
          );
        }

        // Established only where the streak allows; continuation elsewhere.
        expect(
          Array.from(
            new Set<number>(
              burstPushes
                .filter((simPush: SimPush) => {
                  return simPush.clusterEstablished;
                })
                .map((simPush: SimPush) => {
                  return simPush.atMs;
                }),
            ),
          ),
        ).toEqual(burstCase.establishedAtMs);
        // Not vacuous: most bursts had nobody established.
        expect(
          bursts.length - burstCase.establishedAtMs.length,
        ).toBeGreaterThanOrEqual(12);

        /*
         * The reports kept the mark fresh: rewritten in every burst that
         * found it over a minute old, and never more than once a minute.
         */
        const writes: Array<number> = markWritesOf("pve2").filter(
          (writeMs: number) => {
            return writeMs > burstsFromMs;
          },
        );
        expect(writes.length).toBeGreaterThanOrEqual(
          Math.floor(bursts.length / 2),
        );
        let previousMs: number = lastMarkBefore("pve2", burstsFromMs + 1)!;
        for (const writeMs of writes) {
          expect(bursts).toContain(writeMs);
          expect(writeMs - previousMs).toBeGreaterThan(MARK_REFRESH_MS);
          previousMs = writeMs;
        }

        expect(
          minutesLookingUp(pushes, "pve2", burstsFromMs, lastBurstMs),
        ).toEqual([]);
      },
    );

    test("without the Offline mark, steady 70 s bursts never report it again", async () => {
      const bursts: Array<number> = burstTimes(
        new Array<number>(12).fill(70_000),
      );
      const lastBurstMs: number = bursts[bursts.length - 1] as number;
      const pushes: Array<SimPush> = await simulate({
        nodes: burstNodes(bursts),
        untilMs: lastBurstMs,
        markOffline: false,
      });

      expect(reportsNaming(pushes, "pve2").length).toBeGreaterThan(0);
      const burstPushes: Array<SimPush> = pushes.filter((simPush: SimPush) => {
        return simPush.atMs > burstsFromMs;
      });
      expect(burstPushes.length).toBeGreaterThan(80);
      for (const simPush of burstPushes) {
        expect(simPush.decision).toBeNull();
      }
    });
  });

  test("one live node's key evicted is never reported: its inventory sighting is fresh", async () => {
    const untilMs: number = T0 + 1_200_000;
    const pushes: Array<SimPush> = await simulate({
      nodes: [
        { name: "pve1", phaseMs: 0, windows: always(untilMs) },
        { name: "pve2", phaseMs: 5_000, windows: always(untilMs) },
        { name: "pve3", phaseMs: 7_000, windows: always(untilMs) },
      ],
      untilMs,
      actions: [
        {
          atMs: T0 + 606_000,
          run: (): void => {
            evictLiveness("pve2");
          },
        },
      ],
    });

    expect(reportsOf(pushes)).toEqual([]);
  });

  describe("a whole cluster going dark never pages per node", () => {
    test("every node stops within a few seconds: nobody is left to report", async () => {
      const untilMs: number = T0 + 3_600_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          { name: "pve1", phaseMs: 0, windows: [[T0, T0 + 600_000]] },
          { name: "pve2", phaseMs: 3_000, windows: [[T0, T0 + 600_000]] },
          { name: "pve3", phaseMs: 7_000, windows: [[T0, T0 + 600_000]] },
        ],
        untilMs,
      });

      expect(reportsOf(pushes)).toEqual([]);
    });

    test("and power restored with nodes booting up to 100 s apart still reports nobody", async () => {
      const darkUntilMs: number = T0 + 3_600_000;
      const untilMs: number = T0 + 5_400_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          {
            name: "pve1",
            phaseMs: 0,
            windows: [
              [T0, T0 + 600_000],
              [darkUntilMs + 100_000, untilMs],
            ],
          },
          {
            name: "pve2",
            phaseMs: 3_000,
            windows: [
              [T0, T0 + 600_000],
              [darkUntilMs, untilMs],
            ],
          },
          {
            name: "pve3",
            phaseMs: 7_000,
            windows: [
              [T0, T0 + 600_000],
              [darkUntilMs + 60_000, untilMs],
            ],
          },
        ],
        untilMs,
      });

      expect(reportsOf(pushes)).toEqual([]);
      expect(
        mgetCalls.filter((call: FakeMgetCall) => {
          return call.atMs >= darkUntilMs;
        }).length,
      ).toBeGreaterThan(0);
    });
  });

  test("a standalone host never reports and never reads a sibling key", async () => {
    const untilMs: number = T0 + 2_400_000;
    const pushes: Array<SimPush> = await simulate({
      nodes: [{ name: "pve1", phaseMs: 0, windows: [[T0, T0 + 1_200_000]] }],
      untilMs,
    });

    expect(pushes.length).toBeGreaterThan(100);
    expect(reportsOf(pushes)).toEqual([]);
    expect(mgetCalls).toEqual([]);
  });

  describe("a node the Proxmox Agent still sights", () => {
    test("is never reported while the agent keeps refreshing it", async () => {
      const untilMs: number = T0 + 1_800_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          { name: "pve1", phaseMs: 0, windows: always(untilMs) },
          { name: "pve2", phaseMs: 3_000, windows: always(untilMs) },
          {
            name: "pve3",
            phaseMs: 0,
            periodMs: 60_000,
            agentOnly: true,
            windows: always(untilMs),
          },
        ],
        untilMs,
      });

      expect(reportsOf(pushes)).toEqual([]);
      // Not vacuous: pve3 was checked, and has no key.
      expect(
        mgetCalls.some((call: FakeMgetCall) => {
          return call.keys.includes(livenessKey("pve3"));
        }),
      ).toBe(true);
    });

    test("is reported 2 minutes after the agent's last sighting", async () => {
      const untilMs: number = T0 + 1_800_000;
      const pushes: Array<SimPush> = await simulate({
        nodes: [
          { name: "pve1", phaseMs: 0, windows: always(untilMs) },
          { name: "pve2", phaseMs: 3_000, windows: always(untilMs) },
          {
            name: "pve3",
            phaseMs: 0,
            periodMs: 60_000,
            agentOnly: true,
            windows: [[T0, T0 + 600_000]],
          },
        ],
        untilMs,
      });

      const lastSightingMs: number = T0 + 600_000;
      const reports: Array<SimPush> = reportsNaming(pushes, "pve3");
      expect(reports.length).toBeGreaterThan(0);
      expect(reports[0]!.atMs).toBeGreaterThan(
        lastSightingMs + PROXMOX_NODE_SILENCE_MS,
      );
      expect(reports[0]!.atMs).toBeLessThanOrEqual(
        lastSightingMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
      );
    });
  });

  /*
   * N, Q: the cluster moves from the Proxmox Agent to the native push. The
   * agent's last scrape was 400 s before the first native push; it had
   * pve3 down, so pve3's row is Offline — written by the agent's
   * bulkUpsert, which leaves no mark (Q: it clears notReportingMarkedAt)
   * and stamps updatedAt with the database's now(). pve3 came back during
   * the switch, and its first native push is processed after its siblings'
   * (at +47 s). The first native flush adopts the agent's rows into the
   * native-push keep (adoptNodesAsNativePush), setting isNativePush only.
   * pve3's row carries no mark, so nothing continues it, nobody is
   * established before pve3 is back, and pve3 is never reported — whatever
   * its updatedAt says: a database clock 10 minutes ahead dates the agent's
   * write 200 s in the future, and an adoption that stamped updatedAt (as
   * before N) dates it at the switch.
   *
   * Before Q the roster read updatedAt as the mark: either stamp read as a
   * recent one, and the pushes reading it reported pve3 — back, but not
   * processed yet — as down: a false Node Offline. (N alone removed only
   * the adoption's stamp; the database clock's stayed.)
   */
  describe("moving from the agent to the native push (N, Q)", () => {
    const agentLastScrapeMs: number = T0 - 400_000;
    const untilMs: number = T0 + 600_000;
    const nodes: Array<SimNode> = [
      { name: "pve1", phaseMs: 0, windows: always(untilMs) },
      { name: "pve2", phaseMs: 3_000, windows: always(untilMs) },
      // Back during the switch; first processed at +47 s.
      { name: "pve3", phaseMs: 7_000, windows: [[T0 + 40_000, untilMs]] },
    ];

    interface SwitchCase {
      title: string;
      databaseClockAheadMs: number;
      adoptionStampsUpdatedAt: boolean;
      // pve3's updatedAt after the adoption, from T0.
      pve3UpdatedAtMs: number;
      // Before Q: the pushes that reported pve3, from T0.
      beforeQReportsMs: Array<number>;
    }

    const switchCases: Array<SwitchCase> = [
      {
        title: "the database's clock right",
        databaseClockAheadMs: 0,
        adoptionStampsUpdatedAt: false,
        pve3UpdatedAtMs: -400_000,
        beforeQReportsMs: [],
      },
      {
        // Read at T0 as a mark 200 s in the future: every push until pve3's first.
        title: "the database's clock 10 minutes ahead",
        databaseClockAheadMs: 600_000,
        adoptionStampsUpdatedAt: false,
        pve3UpdatedAtMs: 200_000,
        beforeQReportsMs: [
          0, 3_000, 10_000, 13_000, 20_000, 23_000, 30_000, 33_000, 40_000,
          43_000,
        ],
      },
      {
        // The roster loaded at T0 predates the stamp; the reload at +33 s reads it.
        title: "an adoption stamping updatedAt (before N)",
        databaseClockAheadMs: 0,
        adoptionStampsUpdatedAt: true,
        pve3UpdatedAtMs: 1,
        beforeQReportsMs: [33_000, 40_000, 43_000],
      },
      {
        title: "both",
        databaseClockAheadMs: 600_000,
        adoptionStampsUpdatedAt: true,
        pve3UpdatedAtMs: 600_001,
        beforeQReportsMs: [
          0, 3_000, 10_000, 13_000, 20_000, 23_000, 30_000, 33_000, 40_000,
          43_000,
        ],
      },
    ];

    function switchActions(
      switchCase: SwitchCase,
      seen: { pve3UpdatedAtMs: number | null },
    ): Array<SimAction> {
      return [
        {
          // The agent's rows, as its last bulkUpsert wrote them.
          atMs: T0,
          run: (): void => {
            for (const nodeName of ["pve1", "pve2", "pve3"]) {
              simInventory.set(nodeName, {
                lastSeenMs: agentLastScrapeMs,
                isUp: nodeName !== "pve3",
                markedAtMs: null,
                updatedAtMs:
                  agentLastScrapeMs + switchCase.databaseClockAheadMs,
              });
            }
          },
        },
        {
          /*
           * The first native flush adopts the rows not yet native — the
           * agent's (lastSeenAt up to the batch's newest point); pve1's
           * own row was just rewritten natively. It sets isNativePush
           * only; before N it also stamped updatedAt (the database's now()).
           */
          atMs: T0 + 1,
          run: (): void => {
            if (switchCase.adoptionStampsUpdatedAt) {
              for (const row of simInventory.values()) {
                if (row.lastSeenMs <= agentLastScrapeMs) {
                  row.updatedAtMs = T0 + 1 + switchCase.databaseClockAheadMs;
                }
              }
            }
            seen.pve3UpdatedAtMs =
              simInventory.get("pve3")?.updatedAtMs ?? null;
          },
        },
      ];
    }

    test.each(switchCases)(
      "an agent-era Offline row carries no mark: a node back during the switch is never reported ($title)",
      async (switchCase: SwitchCase) => {
        const seen: { pve3UpdatedAtMs: number | null } = {
          pve3UpdatedAtMs: null,
        };
        const pushes: Array<SimPush> = await simulate({
          nodes,
          untilMs,
          databaseClockAheadMs: switchCase.databaseClockAheadMs,
          actions: switchActions(switchCase, seen),
        });

        expect(reportsOf(pushes)).toEqual([]);
        expect(simMarkWrites).toEqual([]);
        expect(simInventory.get("pve3")?.isUp).toBe(true);
        expect(simInventory.get("pve3")?.markedAtMs).toBeNull();

        /*
         * Not vacuous: pve3's updatedAt was what the case says — 200 s in
         * the future, or the adoption's stamp — and every push before
         * pve3's first found it Offline with no mark, keyless and stale,
         * with nobody established.
         */
        expect(seen.pve3UpdatedAtMs).toBe(T0 + switchCase.pve3UpdatedAtMs);
        const pve3BackMs: number = pushTimesOf(pushes, "pve3")[0] as number;
        expect(pve3BackMs).toBe(T0 + 47_000);
        const beforeBack: Array<SimPush> = pushes.filter((simPush: SimPush) => {
          return simPush.atMs < pve3BackMs;
        });
        expect(beforeBack).toHaveLength(10);
        for (const simPush of beforeBack) {
          expect(simPush.clusterEstablished).toBe(false);
          expect(simPush.offlineMarkAgesMs.has("pve3")).toBe(true);
          expect(simPush.offlineMarkAgesMs.get("pve3")).toBeNull();
        }
        // The roster was loaded at T0 and again at +33 s, after the adoption.
        expect(
          Array.from(
            new Set<number>(
              beforeBack.map((simPush: SimPush) => {
                return simPush.rosterReadAtMs - T0;
              }),
            ),
          ),
        ).toEqual([0, 33_000]);
        expect(
          mgetCalls
            .filter((call: FakeMgetCall) => {
              return call.atMs < pve3BackMs;
            })
            .every((call: FakeMgetCall) => {
              return (
                call.values[call.keys.indexOf(livenessKey("pve3"))] === null
              );
            }),
        ).toBe(true);
      },
    );

    test.each(switchCases)(
      "before Q, the roster read updatedAt as the mark: pve3, though back, was reported wherever it looked recent ($title)",
      async (switchCase: SwitchCase) => {
        const pushes: Array<SimPush> = await simulate({
          nodes,
          untilMs,
          databaseClockAheadMs: switchCase.databaseClockAheadMs,
          actions: switchActions(switchCase, { pve3UpdatedAtMs: null }),
          rosterMarkFromUpdatedAt: true,
        });

        // pve3's first push at +47 s ended it.
        expect(
          reportsNaming(pushes, "pve3").map((report: SimPush) => {
            return report.atMs - T0;
          }),
        ).toEqual(switchCase.beforeQReportsMs);
        for (const report of reportsOf(pushes)) {
          expect(report.decision).toEqual({
            silentNodes: ["pve3"],
            reporterCount: 2,
          });
          expect(report.clusterEstablished).toBe(false);
          expect(report.atMs).toBeLessThan(pushTimesOf(pushes, "pve3")[0]!);
        }
      },
    );
  });
});
