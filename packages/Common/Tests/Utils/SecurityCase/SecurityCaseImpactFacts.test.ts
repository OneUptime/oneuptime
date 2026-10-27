import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_CASE_IMPACT_MAX_EVIDENCE,
  SECURITY_CASE_IMPACT_MAX_PEERS,
  SecurityCaseExposureEvidenceKind,
  SecurityCaseImpactJson,
  SecurityCaseImpactRecordJson,
  SecurityCaseInternetExposure,
} from "../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
} from "../../../Types/SecurityCase/SecurityConnection";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { TopologyConnectionRowJSON } from "../../../Types/Topology/TopologyApi";
import {
  buildInternetExposure,
  getImpactRecordsInOrder,
  pickLastChange,
  summarizeImpact,
  toImpactPeers,
} from "../../../Utils/SecurityCase/SecurityCaseImpactFacts";

/*
 * What a case puts at risk, from facts already read - kept honest: a record
 * is reachable from the internet only on evidence OneUptime holds, and
 * "unknown" otherwise.
 */

const FIRST_DETECTION: Date = new Date("2026-10-27T06:00:00.000Z");

function hoursFrom(hours: number): string {
  return new Date(FIRST_DETECTION.getTime() + hours * 3600 * 1000).toISOString();
}

function change(
  id: string,
  time: string,
): { id: string; time: string; title: string; eventType: string } {
  return { id, time, title: `deploy ${id}`, eventType: "deployment" };
}

function row(
  overrides: Partial<TopologyConnectionRowJSON>,
): TopologyConnectionRowJSON {
  return {
    relationshipType: "depends-on",
    direction: "out",
    otherKey: "service:other",
    otherKnown: true,
    otherName: "other",
    otherType: "Service",
    callCount: 1,
    errorCount: 0,
    avgDurationMs: 10,
    lastSeenAt: null,
    ...overrides,
  };
}

function record(
  overrides: Partial<SecurityCaseImpactRecordJson> = {},
): SecurityCaseImpactRecordJson {
  return {
    kind: SecurityConnectionKind.Service,
    id: "s-1",
    name: "checkout",
    certainty: SecurityConnectionCertainty.Exact,
    calls: null,
    calledBy: null,
    runsOn: null,
    monitors: null,
    owners: null,
    lastChange: null,
    ...overrides,
  };
}

function impact(
  overrides: Partial<SecurityCaseImpactJson> = {},
): SecurityCaseImpactJson {
  return {
    windowStart: hoursFrom(-0.5),
    windowEnd: hoursFrom(1),
    firstDetectedAt: FIRST_DETECTION.toISOString(),
    records: [],
    hasMoreRecords: false,
    statusPages: null,
    flowPeers: null,
    internet: { exposure: SecurityCaseInternetExposure.Unknown, evidence: [] },
    unreadableSources: [],
    failedSources: [],
    ...overrides,
  };
}

describe("the change that tells most about the attack", () => {
  test("is the latest at or before the first detection: the release the attack found", () => {
    expect(
      pickLastChange(
        [
          change("a", hoursFrom(-30)),
          change("b", hoursFrom(-2)),
          change("c", hoursFrom(0)),
          change("d", hoursFrom(1)),
        ],
        FIRST_DETECTION,
      ),
    ).toEqual({ ...change("c", hoursFrom(0)), isBeforeFirstDetection: true });
  });

  test("is the first after it, said to be after, when nothing changed before", () => {
    expect(
      pickLastChange(
        [change("late", hoursFrom(5)), change("soon", hoursFrom(1))],
        FIRST_DETECTION,
      ),
    ).toEqual({
      ...change("soon", hoursFrom(1)),
      isBeforeFirstDetection: false,
    });
  });

  test("is the latest of all for a case with no detection yet", () => {
    expect(
      pickLastChange(
        [change("a", hoursFrom(1)), change("b", hoursFrom(3))],
        null,
      )?.id,
    ).toBe("b");
  });

  test("is nothing when nothing changed, or no change has a time", () => {
    expect(pickLastChange([], FIRST_DETECTION)).toBeNull();
    expect(
      pickLastChange([change("x", "not a time")], FIRST_DETECTION),
    ).toBeNull();
  });

  test("keeps the version a change names", () => {
    expect(
      pickLastChange(
        [{ ...change("a", hoursFrom(-1)), version: "v1.4.2" }],
        FIRST_DETECTION,
      )?.version,
    ).toBe("v1.4.2");
  });
});

describe("what a record calls, and what calls it", () => {
  test("lists known records first, the busiest first, then by name", () => {
    expect(
      toImpactPeers([
        row({ otherKey: "k:quiet", otherName: "billing", callCount: 2 }),
        row({ otherKey: "k:busy", otherName: "payments", callCount: 90 }),
        row({ otherKey: "k:gone", otherName: null, otherKnown: false, callCount: 500 }),
        row({ otherKey: "k:also-quiet", otherName: "auth", callCount: 2 }),
      ]).map((peer: { key: string }): string => {
        return peer.key;
      }),
    ).toEqual(["k:busy", "k:also-quiet", "k:quiet", "k:gone"]);
  });

  test("names a peer by its key when it has no name, and keeps its call counts", () => {
    expect(
      toImpactPeers([
        row({ otherKey: "db:orders", otherName: null, otherType: null, callCount: null, errorCount: 3 }),
      ]),
    ).toEqual([
      {
        key: "db:orders",
        name: "db:orders",
        type: "",
        callCount: null,
        errorCount: 3,
      },
    ]);
  });

  test("lists at most the bound", () => {
    expect(
      toImpactPeers(
        Array.from(
          { length: SECURITY_CASE_IMPACT_MAX_PEERS + 5 },
          (_value: unknown, index: number): TopologyConnectionRowJSON => {
            return row({ otherKey: `k:${index}`, otherName: `n${index}` });
          },
        ),
      ),
    ).toHaveLength(SECURITY_CASE_IMPACT_MAX_PEERS);
    expect(toImpactPeers([row({})], 0)).toEqual([]);
  });
});

describe("whether the records are reachable from the internet", () => {
  test("yes, when a request from a public address reached the app - the furthest-reaching first", () => {
    const exposure: ReturnType<typeof buildInternetExposure> =
      buildInternetExposure({
        requests: [
          {
            address: "203.0.113.7",
            time: new Date(hoursFrom(0.5)),
            requestOutcome: SecurityEventRequestOutcome.ReachedApp,
          },
          {
            address: "198.51.100.9",
            time: new Date(hoursFrom(0.7)),
            requestOutcome: SecurityEventRequestOutcome.ReachedDatabase,
          },
        ],
        recordAddresses: [],
      });

    expect(exposure.exposure).toBe(SecurityCaseInternetExposure.Yes);
    expect(exposure.evidence).toEqual([
      {
        kind: SecurityCaseExposureEvidenceKind.PublicRequestReachedApp,
        address: "198.51.100.9",
        time: hoursFrom(0.7),
        requestOutcome: SecurityEventRequestOutcome.ReachedDatabase,
      },
      {
        kind: SecurityCaseExposureEvidenceKind.PublicRequestReachedApp,
        address: "203.0.113.7",
        time: hoursFrom(0.5),
        requestOutcome: SecurityEventRequestOutcome.ReachedApp,
      },
    ]);
  });

  test("a request turned away, or one from a private address, is no evidence", () => {
    expect(
      buildInternetExposure({
        requests: [
          {
            address: "203.0.113.7",
            time: new Date(hoursFrom(0)),
            requestOutcome: SecurityEventRequestOutcome.Rejected,
          },
          {
            address: "10.0.3.17",
            time: new Date(hoursFrom(0)),
            requestOutcome: SecurityEventRequestOutcome.ReachedApp,
          },
          {
            address: "not an address",
            time: new Date(hoursFrom(0)),
            requestOutcome: SecurityEventRequestOutcome.ReachedApp,
          },
        ],
        recordAddresses: [{ recordName: "web-1", address: "192.168.1.4" }],
      }),
    ).toEqual({ exposure: SecurityCaseInternetExposure.Unknown, evidence: [] });
  });

  test("yes, when a record reports a public address of its own", () => {
    expect(
      buildInternetExposure({
        requests: [],
        recordAddresses: [
          { recordName: "web-1", address: "10.0.0.5" },
          { recordName: "web-1", address: "198.51.100.20" },
        ],
      }),
    ).toEqual({
      exposure: SecurityCaseInternetExposure.Yes,
      evidence: [
        {
          kind: SecurityCaseExposureEvidenceKind.PublicAddress,
          address: "198.51.100.20",
          recordName: "web-1",
        },
      ],
    });
  });

  test("counts an address once, however it is spelled", () => {
    const exposure: ReturnType<typeof buildInternetExposure> =
      buildInternetExposure({
        requests: [
          {
            address: "2001:0DB8:0:0:0:0:0:7",
            time: new Date(hoursFrom(0)),
            requestOutcome: SecurityEventRequestOutcome.ReachedApp,
          },
          {
            address: "2001:db8::7",
            time: new Date(hoursFrom(1)),
            requestOutcome: SecurityEventRequestOutcome.Errored,
          },
        ],
        recordAddresses: [{ recordName: "api", address: "2001:db8::7" }],
      });

    // One address, its furthest-reaching request kept, in its one spelling.
    expect(exposure.evidence).toEqual([
      {
        kind: SecurityCaseExposureEvidenceKind.PublicRequestReachedApp,
        address: "2001:db8:0:0:0:0:0:7",
        time: hoursFrom(1),
        requestOutcome: SecurityEventRequestOutcome.Errored,
      },
    ]);

    const routed: ReturnType<typeof buildInternetExposure> =
      buildInternetExposure({
        requests: [
          {
            address: "::ffff:198.51.100.9",
            time: new Date(hoursFrom(0)),
            requestOutcome: SecurityEventRequestOutcome.ReachedApp,
          },
          {
            address: "198.51.100.9",
            time: new Date(hoursFrom(1)),
            requestOutcome: SecurityEventRequestOutcome.ReachedApp,
          },
        ],
        recordAddresses: [{ recordName: "api", address: "198.51.100.9" }],
      });

    expect(routed.evidence).toHaveLength(1);
    expect(routed.evidence[0]!.address).toBe("198.51.100.9");
  });

  test("lists at most the bound", () => {
    const exposure: ReturnType<typeof buildInternetExposure> =
      buildInternetExposure({
        requests: Array.from(
          { length: SECURITY_CASE_IMPACT_MAX_EVIDENCE + 3 },
          (_value: unknown, index: number) => {
            return {
              address: `198.51.100.${index + 1}`,
              time: new Date(hoursFrom(index)),
              requestOutcome: SecurityEventRequestOutcome.ReachedApp,
            };
          },
        ),
        recordAddresses: [{ recordName: "web-1", address: "203.0.113.200" }],
      });

    expect(exposure.evidence).toHaveLength(SECURITY_CASE_IMPACT_MAX_EVIDENCE);
    expect(
      buildInternetExposure({
        requests: [],
        recordAddresses: [{ recordName: "web-1", address: "203.0.113.200" }],
        max: 0,
      }).exposure,
    ).toBe(SecurityCaseInternetExposure.Unknown);
  });
});

describe("the figures an impact is summed up by", () => {
  test("counts what the records call and are called by once each, and every monitor and owner", () => {
    expect(
      summarizeImpact(
        impact({
          records: [
            record({
              calls: [
                { key: "k:db", name: "db", type: "", callCount: 1, errorCount: 0 },
                { key: "k:auth", name: "auth", type: "", callCount: 1, errorCount: 0 },
              ],
              calledBy: [
                { key: "k:web", name: "web", type: "", callCount: 1, errorCount: 0 },
              ],
              monitors: { count: 3, items: [] },
              owners: {
                teams: [{ id: "t-1", name: "Payments" }],
                users: [{ id: "u-1", name: "Kim" }],
              },
            }),
            record({
              id: "s-2",
              calls: [
                { key: "k:db", name: "db", type: "", callCount: 1, errorCount: 0 },
              ],
              monitors: { count: 1, items: [] },
              owners: {
                teams: [{ id: "t-1", name: "Payments" }],
                users: [],
              },
            }),
          ],
          statusPages: [{ id: "p-1", name: "Status", monitorIds: ["m-1"] }],
          internet: {
            exposure: SecurityCaseInternetExposure.Yes,
            evidence: [],
          },
        }),
      ),
    ).toEqual({
      recordCount: 2,
      downstreamCount: 2,
      upstreamCount: 1,
      monitorCount: 4,
      statusPageCount: 1,
      ownerTeamCount: 1,
      ownerUserCount: 1,
      isInternetFacing: true,
      hasDependencies: true,
    });
  });

  test("says there is no map to read when no record's calls are known", () => {
    expect(summarizeImpact(impact({ records: [record()] }))).toMatchObject({
      recordCount: 1,
      downstreamCount: 0,
      hasDependencies: false,
      isInternetFacing: false,
      statusPageCount: 0,
    });
  });
});

describe("the order records are listed in", () => {
  test("exact connections first, then by name", () => {
    expect(
      getImpactRecordsInOrder([
        record({ id: "z", name: "zeta" }),
        record({
          id: "p",
          name: "alpha",
          certainty: SecurityConnectionCertainty.Possible,
        }),
        record({ id: "a", name: "beta" }),
      ]).map((entry: SecurityCaseImpactRecordJson): string => {
        return entry.id;
      }),
    ).toEqual(["a", "z", "p"]);
  });
});
