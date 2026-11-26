import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  SecurityCaseEdgeActivityJson,
  SecurityCaseEdgeAddressJson,
  SecurityCaseEdgeJson,
} from "../../../Types/SecurityCase/SecurityCaseContext";
import {
  foldEdgeActivityRows,
  getAppReachedCount,
  getEdgeLetOnCount,
  getEdgeStoppedCount,
  hasAppRequests,
} from "../../../Utils/SecurityCase/SecurityCaseEdgeFacts";

/*
 * What the edge did with a case's addresses, beside what reached the app,
 * folded from the rows of one grouped read (buildEdgeActivityStatement): a
 * row per address, product, edge action and request outcome, whose
 * `requests` already sums each event's sample interval.
 */

const ATTACKER: string = "203.0.113.7";
const OTHER: string = "198.51.100.23";

function edgeRow(
  action: string,
  requests: number | string,
  extra: JSONObject = {},
): JSONObject {
  return {
    principalIp: ATTACKER,
    vendorName: "Cloudflare",
    edgeAction: action,
    requestOutcome: action === "blocked" ? "Rejected" : "",
    requests: String(requests),
    maxSampleInterval: "1",
    ...extra,
  };
}

// A request OneUptime saw in the app itself: no edge action.
function appRow(
  outcome: string,
  requests: number,
  extra: JSONObject = {},
): JSONObject {
  return {
    principalIp: ATTACKER,
    vendorName: "OneUptime",
    edgeAction: "",
    requestOutcome: outcome,
    requests: String(requests),
    maxSampleInterval: "0",
    ...extra,
  };
}

function only(edge: SecurityCaseEdgeJson): SecurityCaseEdgeAddressJson {
  expect(edge.addresses).toHaveLength(1);

  return edge.addresses[0]!;
}

function activity(
  overrides: Partial<SecurityCaseEdgeActivityJson> = {},
): SecurityCaseEdgeActivityJson {
  return {
    edge: "Cloudflare",
    blocked: 0,
    challenged: 0,
    passedChallenge: 0,
    logged: 0,
    letThrough: 0,
    other: 0,
    isEstimate: false,
    ...overrides,
  };
}

describe("foldEdgeActivityRows", () => {
  test("one entry per address: each edge action counted, beside how far the app's own requests got", () => {
    const entry: SecurityCaseEdgeAddressJson = only(
      foldEdgeActivityRows({
        rows: [
          edgeRow("blocked", 380),
          edgeRow("challenged", 20),
          edgeRow("passed-challenge", 4),
          edgeRow("logged", 3),
          edgeRow("let-through", 2),
          appRow("Reached App", 7),
          appRow("Errored", 1),
          appRow("Reached Database", 2),
          appRow("Rejected", 5),
        ],
        addresses: [ATTACKER],
      }),
    );

    expect(entry).toEqual({
      address: ATTACKER,
      edges: [
        activity({
          blocked: 380,
          challenged: 20,
          passedChallenge: 4,
          logged: 3,
          letThrough: 2,
        }),
      ],
      app: { rejected: 5, reachedApp: 7, errored: 1, reachedDatabase: 2 },
    });
    expect(getEdgeStoppedCount(entry.edges[0]!)).toBe(400);
    expect(getEdgeLetOnCount(entry.edges[0]!)).toBe(9);
    // Reaching the database, or failing there, is reaching the app.
    expect(getAppReachedCount(entry)).toBe(10);
    expect(hasAppRequests(entry)).toBe(true);
  });

  test("a count from sampled events is an estimate; one from unsampled events is exact", () => {
    const sampled: SecurityCaseEdgeAddressJson = only(
      foldEdgeActivityRows({
        rows: [
          edgeRow("blocked", 300, { maxSampleInterval: "100" }),
          edgeRow("challenged", 2),
        ],
        addresses: [ATTACKER],
      }),
    );

    expect(sampled.edges[0]!.isEstimate).toBe(true);
    expect(sampled.edges[0]!.blocked).toBe(300);

    const exact: SecurityCaseEdgeAddressJson = only(
      foldEdgeActivityRows({
        rows: [edgeRow("blocked", 3), edgeRow("challenged", 2)],
        addresses: [ATTACKER],
      }),
    );

    expect(exact.edges[0]!.isEstimate).toBe(false);
  });

  test("each edge product is its own activity, and an action no list names is counted as other", () => {
    const entry: SecurityCaseEdgeAddressJson = only(
      foldEdgeActivityRows({
        rows: [
          edgeRow("blocked", 5),
          edgeRow("blocked", 2, { vendorName: "Akamai" }),
          edgeRow("quarantined", 1),
          // No product named: still an edge's, under a generic name.
          edgeRow("blocked", 1, { vendorName: "" }),
        ],
        addresses: [ATTACKER],
      }),
    );

    expect(entry.edges).toEqual([
      activity({ blocked: 5, other: 1 }),
      activity({ edge: "Akamai", blocked: 2 }),
      activity({ edge: "Edge", blocked: 1 }),
    ]);
  });

  test("an address no edge acted on is left out: the section is about the edge", () => {
    const edge: SecurityCaseEdgeJson = foldEdgeActivityRows({
      rows: [
        appRow("Reached App", 12, { principalIp: OTHER }),
        edgeRow("blocked", 4),
      ],
      addresses: [OTHER, ATTACKER],
    });

    expect(
      edge.addresses.map((entry: SecurityCaseEdgeAddressJson): string => {
        return entry.address;
      }),
    ).toEqual([ATTACKER]);
    // Nothing of its own seen in the app: the reader is told, not shown a zero.
    expect(hasAppRequests(edge.addresses[0]!)).toBe(false);
  });

  test("the case's addresses lead, in the case's order, before any other the rows name", () => {
    const edge: SecurityCaseEdgeJson = foldEdgeActivityRows({
      rows: [
        edgeRow("blocked", 1, { principalIp: "192.0.2.50" }),
        edgeRow("blocked", 1),
        edgeRow("blocked", 1, { principalIp: OTHER }),
      ],
      addresses: [OTHER, ATTACKER],
    });

    expect(
      edge.addresses.map((entry: SecurityCaseEdgeAddressJson): string => {
        return entry.address;
      }),
    ).toEqual([OTHER, ATTACKER, "192.0.2.50"]);
  });

  test("a row with no address, or a count that is not one, adds nothing", () => {
    const edge: SecurityCaseEdgeJson = foldEdgeActivityRows({
      rows: [
        edgeRow("blocked", 9, { principalIp: "" }),
        edgeRow("blocked", 9, { principalIp: null }),
        edgeRow("blocked", "not a number"),
        edgeRow("challenged", -4),
        edgeRow("logged", 2.6),
      ],
      addresses: [ATTACKER],
    });

    expect(only(edge).edges).toEqual([activity({ logged: 3 })]);
  });

  test("an address lists five edges at most", () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 1; index <= 7; index++) {
      rows.push(edgeRow("blocked", index, { vendorName: `Edge ${index}` }));
    }

    const entry: SecurityCaseEdgeAddressJson = only(
      foldEdgeActivityRows({ rows, addresses: [ATTACKER] }),
    );

    expect(
      entry.edges.map((edge: SecurityCaseEdgeActivityJson): string => {
        return edge.edge;
      }),
    ).toEqual(["Edge 1", "Edge 2", "Edge 3", "Edge 4", "Edge 5"]);
  });

  test("no rows: no addresses", () => {
    expect(foldEdgeActivityRows({ rows: [], addresses: [ATTACKER] })).toEqual({
      addresses: [],
    });
  });
});
