import { describe, expect, test } from "@jest/globals";
import {
  getApiTokenExpiryFeedLine,
  getDaysUntil,
} from "../../../../Server/Utils/XcpNg/XcpNgApiTokenExpiry";
import {
  XcpNgPoolAssignmentDecision,
  decideXcpNgPoolAssignment,
  isXcpNgPoolKept,
} from "../../../../Server/Utils/XcpNg/XcpNgPoolAssignment";
import {
  getXcpNgMessageColor,
  getXcpNgMessageFeedLine,
} from "../../../../Server/Utils/XcpNg/XcpNgPoolMessages";
import XcpNgProbeMetrics, {
  XcpNgProbeMetricsPayload,
  readReportedPools,
  readResourcePoolId,
} from "../../../../Server/Utils/XcpNg/XcpNgProbeMetrics";
import {
  Blue500,
  Gray500,
  Red500,
  Yellow500,
} from "../../../../Types/BrandColors";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import XcpNgCollectionMethod from "../../../../Types/XcpNg/XcpNgCollectionMethod";
import { XcpNgPoolMessage } from "../../../../Types/XcpNg/XcpNgProbeCollection";

/*
 * What a probe connection's read may write (#10996, #10999): which pools it
 * may write at all - one source per pool, so a pool's history stays one
 * line - the metrics it hands the agent's ingest, and the lines it puts on
 * a pool's feed.
 */

const THIS_CONNECTION: string = "aaaaaaaa-1111-4111-8111-000000000001";
const OTHER_CONNECTION: string = "aaaaaaaa-1111-4111-8111-000000000002";
const POOL_A: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const POOL_B: string = "3c1e4f70-1b7e-4a31-8c55-7f2d9e4a0001";

describe("decideXcpNgPoolAssignment", () => {
  test.each([
    ["a pool not registered yet", null, XcpNgPoolAssignmentDecision.Create],
    [
      "a pool this connection reads",
      {
        collectionMethod: XcpNgCollectionMethod.Probe,
        xcpNgConnectionId: THIS_CONNECTION,
      },
      XcpNgPoolAssignmentDecision.Keep,
    ],
    [
      "a pool a removed connection read",
      {
        collectionMethod: XcpNgCollectionMethod.Probe,
        xcpNgConnectionId: null,
      },
      XcpNgPoolAssignmentDecision.TakeOver,
    ],
    [
      "a pool the agent registered",
      {
        collectionMethod: XcpNgCollectionMethod.Agent,
        xcpNgConnectionId: null,
      },
      XcpNgPoolAssignmentDecision.TakeOver,
    ],
    [
      "a pool registered before probes could read one",
      { collectionMethod: undefined, xcpNgConnectionId: undefined },
      XcpNgPoolAssignmentDecision.TakeOver,
    ],
    [
      "a pool switched back to the agent from this connection",
      {
        collectionMethod: XcpNgCollectionMethod.Agent,
        xcpNgConnectionId: THIS_CONNECTION,
      },
      XcpNgPoolAssignmentDecision.LeaveToAgent,
    ],
    [
      "a pool switched back to the agent from another connection",
      {
        collectionMethod: XcpNgCollectionMethod.Agent,
        xcpNgConnectionId: OTHER_CONNECTION,
      },
      XcpNgPoolAssignmentDecision.LeaveToAgent,
    ],
    [
      "a pool another connection reads",
      {
        collectionMethod: XcpNgCollectionMethod.Probe,
        xcpNgConnectionId: OTHER_CONNECTION,
      },
      XcpNgPoolAssignmentDecision.LeaveToOtherConnection,
    ],
  ])(
    "%s",
    (
      _name: string,
      pool: Parameters<typeof decideXcpNgPoolAssignment>[0]["pool"],
      decision: XcpNgPoolAssignmentDecision,
    ) => {
      expect(
        decideXcpNgPoolAssignment({
          pool: pool,
          connectionId: THIS_CONNECTION,
        }),
      ).toBe(decision);
    },
  );

  test("reads ids in any case", () => {
    expect(
      decideXcpNgPoolAssignment({
        pool: {
          collectionMethod: XcpNgCollectionMethod.Probe,
          xcpNgConnectionId: THIS_CONNECTION.toUpperCase(),
        },
        connectionId: THIS_CONNECTION,
      }),
    ).toBe(XcpNgPoolAssignmentDecision.Keep);
  });

  test("keeps a read's data only where the connection reads the pool", () => {
    expect(isXcpNgPoolKept(XcpNgPoolAssignmentDecision.Create)).toBe(true);
    expect(isXcpNgPoolKept(XcpNgPoolAssignmentDecision.Keep)).toBe(true);
    expect(isXcpNgPoolKept(XcpNgPoolAssignmentDecision.TakeOver)).toBe(true);
    expect(isXcpNgPoolKept(XcpNgPoolAssignmentDecision.LeaveToAgent)).toBe(
      false,
    );
    expect(
      isXcpNgPoolKept(XcpNgPoolAssignmentDecision.LeaveToOtherConnection),
    ).toBe(false);
  });
});

function resource(
  poolId: string,
  extra: Array<JSONObject> = [],
  poolName?: string,
): JSONObject {
  return {
    resource: {
      attributes: [
        { key: "server.address", value: { stringValue: "xo.example.test" } },
        { key: "xcp_ng.pool.id", value: { stringValue: poolId } },
        ...(poolName
          ? [{ key: "xcp_ng.pool.name", value: { stringValue: poolName } }]
          : []),
        ...extra,
      ],
    },
    scopeMetrics: [
      {
        scope: { name: "oneuptime-probe-xcp-ng", version: "test" },
        metrics: [
          {
            name: "xcp_host_cpu_average",
            gauge: {
              dataPoints: [
                { timeUnixNano: "1", asDouble: 0.5 },
                { timeUnixNano: "1", asDouble: 0.25 },
              ],
            },
          },
          {
            name: "xcp_host_network_receive_bytes_total",
            sum: { dataPoints: [{ timeUnixNano: "1", asDouble: 3 }] },
          },
        ],
      },
    ],
  };
}

function keysOf(entry: unknown): Array<string> {
  return (
    ((entry as JSONObject)["resource"] as JSONObject)[
      "attributes"
    ] as Array<JSONObject>
  ).map((attribute: JSONObject): string => {
    return String(attribute["key"]);
  });
}

describe("XcpNgProbeMetrics.prepare", () => {
  test("keeps the pools the connection reads, and says which it dropped", () => {
    const prepared: XcpNgProbeMetricsPayload = XcpNgProbeMetrics.prepare({
      resourceMetrics: [resource(POOL_A), resource(POOL_B)],
      xenOrchestraName: "Paris Xen Orchestra",
      poolIdsToKeep: new Set([POOL_A]),
    });

    expect(prepared.resourceCount).toBe(1);
    expect(prepared.datapointCount).toBe(3);
    expect(prepared.droppedPoolIds).toEqual([POOL_B]);
    expect(readResourcePoolId(prepared.resourceMetrics[0]!)).toBe(POOL_A);
  });

  test("names the Xen Orchestra itself, and drops what a probe may not say", () => {
    const prepared: XcpNgProbeMetricsPayload = XcpNgProbeMetrics.prepare({
      resourceMetrics: [
        resource(POOL_A, [
          { key: "xen_orchestra.name", value: { stringValue: "Someone else" } },
          { key: "service.name", value: { stringValue: "phantom" } },
          { key: "oneuptime.agent.version", value: { stringValue: "9.9.9" } },
          { key: "oneuptime.label.team", value: { stringValue: "x" } },
        ]),
      ],
      xenOrchestraName: "Paris Xen Orchestra",
      poolIdsToKeep: new Set([POOL_A]),
    });

    const attributes: Array<JSONObject> = (
      (prepared.resourceMetrics[0] as JSONObject)["resource"] as JSONObject
    )["attributes"] as Array<JSONObject>;

    expect(keysOf(prepared.resourceMetrics[0])).toEqual([
      "server.address",
      "xcp_ng.pool.id",
      "xen_orchestra.name",
    ]);
    expect(
      attributes.find((attribute: JSONObject) => {
        return attribute["key"] === "xen_orchestra.name";
      })?.["value"],
    ).toEqual({ stringValue: "Paris Xen Orchestra" });
  });

  test("names no Xen Orchestra for a pool read through XAPI", () => {
    const prepared: XcpNgProbeMetricsPayload = XcpNgProbeMetrics.prepare({
      resourceMetrics: [resource(POOL_A)],
      xenOrchestraName: null,
      poolIdsToKeep: new Set([POOL_A]),
    });

    expect(keysOf(prepared.resourceMetrics[0])).not.toContain(
      "xen_orchestra.name",
    );
  });

  test("hands the ingest the shape it expects, or nothing", () => {
    const prepared: XcpNgProbeMetricsPayload = XcpNgProbeMetrics.prepare({
      resourceMetrics: [
        null,
        "text",
        { resource: { attributes: [] }, scopeMetrics: [] },
        { resource: {} },
        resource(POOL_A),
      ] as unknown as JSONArray,
      poolIdsToKeep: new Set([POOL_A]),
    });

    expect(prepared.resourceCount).toBe(1);
    expect(
      XcpNgProbeMetrics.prepare({
        resourceMetrics: "not an array",
        poolIdsToKeep: new Set([POOL_A]),
      }).resourceCount,
    ).toBe(0);
  });

  test("reads a pool's UUID in any case, as the agent's ingest does", () => {
    expect(readResourcePoolId(resource(POOL_A.toUpperCase()))).toBe(POOL_A);
    expect(readResourcePoolId({ resource: { attributes: [] } })).toBeNull();
  });
});

describe("readReportedPools", () => {
  test("lists each pool once with the name the read gives it - never its own UUID as a name", () => {
    expect(
      readReportedPools([
        resource(POOL_B, [], POOL_B),
        resource(POOL_A, [], "Production"),
        resource(POOL_A),
      ]),
    ).toEqual(
      [
        { poolIdentifier: POOL_B },
        { poolIdentifier: POOL_A, reportedName: "Production" },
      ].sort(
        (
          left: { poolIdentifier: string },
          right: { poolIdentifier: string },
        ) => {
          return left.poolIdentifier < right.poolIdentifier ? -1 : 1;
        },
      ),
    );
    expect(readReportedPools(undefined)).toEqual([]);
  });
});

function message(overrides: Partial<XcpNgPoolMessage> = {}): XcpNgPoolMessage {
  return {
    uuid: "a0000000-0000-4000-8000-000000000002",
    poolId: POOL_A,
    name: "VM_CRASHED",
    priority: 2,
    objectClass: "VM",
    objectUuid: "b0000000-0000-4000-8000-000000000001",
    timestamp: "2026-11-18T07:07:10.000Z",
    body: "",
    ...overrides,
  };
}

describe("an XAPI message on a pool's feed", () => {
  test("is red for XAPI's two most severe priorities, amber, blue, then grey", () => {
    expect(getXcpNgMessageColor(1)).toEqual(Red500);
    expect(getXcpNgMessageColor(2)).toEqual(Red500);
    expect(getXcpNgMessageColor(3)).toEqual(Yellow500);
    expect(getXcpNgMessageColor(4)).toEqual(Blue500);
    expect(getXcpNgMessageColor(5)).toEqual(Gray500);
  });

  test("names the message, its priority and what it is about", () => {
    const line: ReturnType<typeof getXcpNgMessageFeedLine> =
      getXcpNgMessageFeedLine({ message: message(), objectName: "web01" });

    expect(line.feedInfo.toString()).toContain("`VM_CRASHED`");
    expect(line.feedInfo.toString()).toContain("priority 2");
    expect(line.feedInfo.toString()).toContain("web01");
    expect(line.moreInformation).toBeNull();
  });

  test("writes what XAPI wrote as text, so nothing in it acts", () => {
    const line: ReturnType<typeof getXcpNgMessageFeedLine> =
      getXcpNgMessageFeedLine({
        message: message({
          name: "ALARM",
          body: "value: 0.95\n[click](https://evil.example.com) **bold**",
        }),
        objectName: "<b>web01</b> [x](https://evil.example.com)",
      });

    // Escaped: drawn as the characters, never as a link or a tag.
    expect(line.feedInfo.toString()).not.toContain("[x](https://evil");
    expect(line.feedInfo.toString()).not.toContain(" <b>");
    expect(line.moreInformation?.toString()).not.toContain(
      "[click](https://evil.example.com)",
    );
    expect(line.moreInformation?.toString()).toContain("value: 0.95");
  });

  test("falls back to the object's UUID, then to nothing", () => {
    expect(
      getXcpNgMessageFeedLine({ message: message() }).feedInfo.toString(),
    ).toContain("b0000000-0000-4000-8000-000000000001");
    expect(
      getXcpNgMessageFeedLine({
        message: message({ objectUuid: "" }),
      }).feedInfo.toString(),
    ).not.toContain("about");
  });
});

describe("an API token about to expire, on a pool's feed", () => {
  const NOW: Date = new Date("2026-11-18T07:00:00.000Z");

  test("counts whole days left, never below none", () => {
    expect(getDaysUntil(new Date("2026-11-19T07:00:00.000Z"), NOW)).toBe(1);
    expect(getDaysUntil(new Date("2026-11-19T08:00:00.000Z"), NOW)).toBe(2);
    expect(getDaysUntil(new Date("2026-11-17T07:00:00.000Z"), NOW)).toBe(0);
  });

  test("says when, and how to replace it", () => {
    const line: ReturnType<typeof getApiTokenExpiryFeedLine> =
      getApiTokenExpiryFeedLine({
        connectionName: "Paris Xen Orchestra",
        expiresAt: new Date("2026-11-25T07:00:00.000Z"),
        now: NOW,
      });

    expect(line.feedInfo.toString()).toContain("2026-11-25");
    expect(line.feedInfo.toString()).toContain("in 7 days");
    expect(line.feedInfo.toString()).toContain("`Paris Xen Orchestra`");
    expect(line.moreInformation.toString()).toContain("xo-cli create-token");
  });

  test("says one day, not one days", () => {
    expect(
      getApiTokenExpiryFeedLine({
        connectionName: "XO",
        expiresAt: new Date("2026-11-19T07:00:00.000Z"),
        now: NOW,
      }).feedInfo.toString(),
    ).toContain("in 1 day.");
  });
});
