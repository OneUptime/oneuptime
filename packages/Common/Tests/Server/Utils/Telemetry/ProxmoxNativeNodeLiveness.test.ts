import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import {
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
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
 * minutes. Every live node reports (so each report can carry 1 / (live
 * nodes) of the silent nodes' weight and Quorum at Risk stays exact), but
 * only while the cluster has an ESTABLISHED node — one that has pushed
 * continuously for 2 minutes and whose streak is still unbroken now (its
 * last push at most 1 minute old). That is the post-outage guard: after an
 * ingest outage every streak restarts, and by the time any node is
 * established again every live sibling has a key. A key written before an
 * outage a little shorter than 2 minutes is still alive, but its streak is
 * already broken, so it no longer vouches for the cluster.
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

function rosterNode(nodeName: string, lastSeenMs: number): ProxmoxRosterNode {
  return { nodeName, lastSeenAt: new Date(lastSeenMs) };
}

function livenessMap(
  entries: Record<string, ProxmoxNodeLiveness | null>,
): Map<string, ProxmoxNodeLiveness | null> {
  return new Map<string, ProxmoxNodeLiveness | null>(Object.entries(entries));
}

function decide(data: {
  roster: Array<ProxmoxRosterNode>;
  liveness: Map<string, ProxmoxNodeLiveness | null>;
  selfNode?: string | undefined;
  reporterTimeMs?: number | undefined;
  nowMs?: number | undefined;
}): ProxmoxSilentNodeDecision | null {
  return decideProxmoxSilentNodes({
    selfNode: data.selfNode ?? "pve1",
    reporterTimeMs: data.reporterTimeMs ?? NOW_MS,
    nowMs: data.nowMs ?? NOW_MS,
    roster: data.roster,
    liveness: data.liveness,
  });
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
   * cluster (itself or any sibling) is ESTABLISHED. reporterCount is the
   * number of alive nodes, so each of the L live nodes' reports carries
   * D / L of the silent nodes' pve_node_info and Quorum at Risk reads
   * L / (L + D) however unevenly their pushes fall into minutes.
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

  test("reporterCount counts every live node, including the reporter and nodes still warming up", () => {
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
 * expires on it too.
 */

interface FakeRedisEntry {
  value: string;
  expiresAtMs: number;
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
let getCalls: Array<string>;
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
        getCalls.push(key);
        if (failingCall === "getString") {
          throw new Error("Cache is not connected");
        }
        return readRedis(`${namespace}-${key}`);
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

      expect(getCalls).toEqual([livenessKey("pve1")]);
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

  // Again the only live node, so its own warm-up gates the report.
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

  describe("the roster cache", () => {
    beforeEach(() => {
      seedLiveness("pve1", liveness(NOW_MS - 600_000, NOW_MS - 10_000));
    });

    test("loads the roster once per 30 s per cluster", async () => {
      const loadRoster: RosterLoaderMock = rosterLoader(
        deadSiblingRoster(NOW_MS),
      );

      await push({ selfNode: "pve1", nowMs: NOW_MS, loadRoster });
      await push({ selfNode: "pve1", nowMs: NOW_MS + 10_000, loadRoster });
      await push({ selfNode: "pve1", nowMs: NOW_MS + 29_999, loadRoster });
      expect(loadRoster).toHaveBeenCalledTimes(1);

      await push({ selfNode: "pve1", nowMs: NOW_MS + 30_001, loadRoster });
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
 * push the node's inventory row is refreshed with the push's own time (on
 * the node's clock), and the roster loader serves that inventory.
 */

const T0: number = NOW_MS;

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
}

interface SimAction {
  atMs: number;
  run: () => void;
}

interface SimPush {
  atMs: number;
  node: string;
  decision: ProxmoxSilentNodeDecision | null;
}

interface SimEvent {
  atMs: number;
  node: SimNode;
}

async function simulate(data: {
  nodes: Array<SimNode>;
  untilMs: number;
  actions?: Array<SimAction> | undefined;
}): Promise<Array<SimPush>> {
  const events: Array<SimEvent> = [];
  for (const node of data.nodes) {
    const periodMs: number = node.periodMs ?? PUSH_INTERVAL_MS;
    for (
      let atMs: number = T0 + node.phaseMs;
      atMs <= data.untilMs;
      atMs += periodMs
    ) {
      const processed: boolean = node.windows.some(
        ([fromMs, toMs]: [number, number]) => {
          return atMs >= fromMs && atMs <= toMs;
        },
      );
      if (processed) {
        events.push({ atMs, node });
      }
    }
  }
  events.sort((a: SimEvent, b: SimEvent) => {
    return a.atMs - b.atMs || a.node.name.localeCompare(b.node.name);
  });

  const actions: Array<SimAction> = [...(data.actions || [])].sort(
    (a: SimAction, b: SimAction) => {
      return a.atMs - b.atMs;
    },
  );
  let nextAction: number = 0;

  // Each node's last inventory sighting, on the node's own clock.
  const inventory: Map<string, number> = new Map<string, number>();
  const loadRoster: RosterLoaderMock = jest.fn<RosterLoaderFn>(
    async (): Promise<Array<ProxmoxRosterNode>> => {
      return Array.from(inventory.entries()).map(
        ([nodeName, lastSeenMs]: [string, number]) => {
          return rosterNode(nodeName, lastSeenMs);
        },
      );
    },
  );

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

    const nodeTimeMs: number = event.atMs + (event.node.clockSkewMs ?? 0);
    if (!event.node.agentOnly) {
      const decision: ProxmoxSilentNodeDecision | null = await push({
        selfNode: event.node.name,
        nowMs: event.atMs,
        reporterTimeMs: nodeTimeMs,
        loadRoster,
      });
      pushes.push({ atMs: event.atMs, node: event.node.name, decision });
    }
    inventory.set(event.node.name, nodeTimeMs);
  }
  return pushes;
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

    /*
     * Every key has expired during the outage and every inventory sighting
     * is 10 minutes old, so the first node back sees both siblings as
     * silent. Only the established-node guard keeps it quiet: no node is
     * established until one has pushed for 2 minutes after the outage, and
     * by then every node that resumed less than 2 minutes after the first
     * has a key again.
     */
    test.each([
      { staggersMs: [0, 50_000, 100_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [100_000, 0, 50_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [100_000, 100_000, 0], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 100_000, 100_000], phasesMs: [9_000, 0, 5_000] },
      { staggersMs: [0, 0, 100_000], phasesMs: [0, 0, 9_999] },
      { staggersMs: [0, 0, 0], phasesMs: [0, 3_000, 7_000] },
      // The last node's first push lands 113 s / 119 s after the first's.
      { staggersMs: [0, 110_000, 55_000], phasesMs: [0, 3_000, 7_000] },
      { staggersMs: [0, 55_000, 110_000], phasesMs: [0, 3_000, 9_000] },
    ] as Array<{
      staggersMs: [number, number, number];
      phasesMs: [number, number, number];
    }>)(
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
      },
    );

    /*
     * pve1 is back first and is established 2 minutes later; pve2 is back
     * 50 s after pve1 and still warming up then — it reports too, from the
     * moment pve1 is established, carrying the same reporterCount.
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
   * A flush also wipes the established streaks, so a node that really is
   * dead goes unreported until a node is established again — 2 minutes
   * after its first push following the flush — and then every live node
   * reports it again.
   */
  test("a Redis flush pauses a dead node's reports until a node is established again", async () => {
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
  });

  /*
   * The price of "unbroken now": when the cluster's ONLY established node
   * goes quiet for 61–119 s, the cluster has no established node from 60 s
   * into the silence, so the dead node's reports pause — the quiet node is
   * still alive, so it is never reported itself. Its first push back comes
   * after a gap over 60 s and restarts its streak, so reports resume as
   * soon as ANY node is established again: the sibling that is warming
   * up, once its own streak reaches 2 minutes, or else the quiet node
   * itself, 2 minutes after its first push back.
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

    test.each(quietLayouts)(
      "pauses the dead node's reports, never reports a live one, and resumes once a node is established again ($title)",
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
          const pushes: Array<SimPush> = await simulate({ nodes, untilMs });

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
});
