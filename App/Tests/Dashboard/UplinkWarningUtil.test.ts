import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  TopologyUplinkWarning,
  parseUplinkWarnings,
} from "../../FeatureSet/Dashboard/src/Components/Topology/UplinkWarningUtil";

/*
 * Issue #3489 — the uplink-inference banner, one row at a time.
 *
 * Endpoint uplink inference refuses far more often than it draws a cable,
 * and every refusal has a cause an operator can go and fix. This parser is
 * the only thing between those causes and the screen, and the payload it
 * reads is untrusted JSON: a row with no message must disappear rather than
 * render as an empty bullet on an amber panel, because the panel's whole
 * job is to be believed.
 *
 * Same shape and same reasoning as LinkRuleWarningUtil.test.ts beside it.
 */

function warningRow(overrides?: JSONObject): JSONObject {
  return {
    reason: "noEndpointMatch",
    message:
      "3 devices were not found in any MAC address table: till-01, till-02 and till-03.",
    deviceIds: ["device-1"],
    deviceCount: 1,
    ...(overrides || {}),
  };
}

describe("parseUplinkWarnings", () => {
  test("keeps a well-formed warning intact", () => {
    const warnings: Array<TopologyUplinkWarning> = parseUplinkWarnings([
      warningRow({
        deviceIds: ["device-1", "device-2"],
        deviceCount: 2,
      }),
    ]);

    expect(warnings).toEqual([
      {
        reason: "noEndpointMatch",
        message:
          "3 devices were not found in any MAC address table: till-01, till-02 and till-03.",
        deviceIds: ["device-1", "device-2"],
        deviceCount: 2,
      },
    ]);
  });

  test("returns nothing at all for a payload that is not a list", () => {
    expect(parseUplinkWarnings(undefined)).toEqual([]);
    expect(parseUplinkWarnings(null)).toEqual([]);
    expect(parseUplinkWarnings("uplinkInferenceWarnings")).toEqual([]);
    expect(parseUplinkWarnings(42)).toEqual([]);
    /*
     * A single object rather than the array of them — an endpoint that
     * changed shape must produce no banner, never one bullet of garbage.
     */
    expect(parseUplinkWarnings(warningRow())).toEqual([]);
  });

  test("drops a row with no cause and a row with nothing to say", () => {
    /*
     * The reason keys the bullet and the message IS the bullet. A row
     * missing either is silence dressed up as a warning.
     */
    expect(
      parseUplinkWarnings([
        warningRow({ reason: undefined }),
        warningRow({ reason: "" }),
        warningRow({ reason: 7 }),
        warningRow({ reason: ["noEndpointMatch"] }),
        warningRow({ message: undefined }),
        warningRow({ message: "" }),
        warningRow({ message: { text: "nested" } }),
        null,
        undefined,
        "a string",
      ]),
    ).toEqual([]);
  });

  test("keeps every well-formed row and drops only the broken ones", () => {
    const warnings: Array<TopologyUplinkWarning> = parseUplinkWarnings([
      warningRow({ reason: "endpointCollectionOff" }),
      warningRow({ reason: "" }),
      warningRow({ message: "" }),
      warningRow({ reason: "ambiguous" }),
    ]);

    expect(
      warnings.map((warning: TopologyUplinkWarning) => {
        return warning.reason;
      }),
    ).toEqual(["endpointCollectionOff", "ambiguous"]);
  });

  test("device ids that are not strings are dropped rather than rendered", () => {
    /*
     * Each id becomes a link to a device page, so a `null` in the list is a
     * link to nowhere sitting next to real ones.
     */
    const warning: TopologyUplinkWarning = parseUplinkWarnings([
      warningRow({
        deviceIds: ["device-1", 7, null, "", { id: "device-2" }, "device-3"],
        deviceCount: 6,
      }),
    ])[0]!;

    expect(warning.deviceIds).toEqual(["device-1", "device-3"]);
  });

  test("a deviceIds field that is not a list at all reads as no names", () => {
    const warning: TopologyUplinkWarning = parseUplinkWarnings([
      warningRow({ deviceIds: "device-1", deviceCount: 4 }),
    ])[0]!;

    expect(warning.deviceIds).toEqual([]);
    // Still a bullet worth drawing — four devices were affected.
    expect(warning.deviceCount).toBe(4);
  });

  test("believes the endpoint's total over the names it actually sent", () => {
    /*
     * The names are capped at three by the endpoint and the count is not —
     * that is the whole reason both are sent. Reading the total off the
     * names would tell an operator with forty unplaced tills that they
     * have three.
     */
    const warning: TopologyUplinkWarning = parseUplinkWarnings([
      warningRow({
        deviceIds: ["device-1", "device-2", "device-3"],
        deviceCount: 41,
      }),
    ])[0]!;

    expect(warning.deviceIds).toHaveLength(3);
    expect(warning.deviceCount).toBe(41);
  });

  test("believes the names when the total contradicts them by being smaller", () => {
    // A payload disagreeing with itself must not hide rows it did send.
    const warning: TopologyUplinkWarning = parseUplinkWarnings([
      warningRow({
        deviceIds: ["device-1", "device-2", "device-3"],
        deviceCount: 1,
      }),
    ])[0]!;

    expect(warning.deviceCount).toBe(3);
  });

  test("falls back to the names when the total is missing or unusable", () => {
    for (const bogus of [
      undefined,
      "many",
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const warning: TopologyUplinkWarning = parseUplinkWarnings([
        warningRow({
          deviceIds: ["device-1", "device-2"],
          deviceCount: bogus as never,
        }),
      ])[0]!;
      expect(warning.deviceCount).toBe(2);
    }
  });

  test("drops a row that affected nobody", () => {
    /*
     * "0 devices could not be placed" is a banner about nothing, drawn in
     * the same amber as one about forty tills.
     */
    expect(
      parseUplinkWarnings([
        warningRow({ deviceIds: [], deviceCount: 0 }),
        warningRow({ deviceIds: [], deviceCount: undefined }),
        warningRow({ deviceIds: [], deviceCount: -3 }),
        // Every name was junk, and the count agrees there was nobody.
        warningRow({ deviceIds: [7, null], deviceCount: 0 }),
      ]),
    ).toEqual([]);
  });

  test("a row with a count but no names is still a bullet", () => {
    /*
     * The endpoint is allowed to send a cause and a blast radius without
     * naming anybody; dropping that would silently lose the warning.
     */
    const warnings: Array<TopologyUplinkWarning> = parseUplinkWarnings([
      warningRow({ deviceIds: [], deviceCount: 12 }),
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.deviceIds).toEqual([]);
    expect(warnings[0]!.deviceCount).toBe(12);
  });

  test("the row is rebuilt, not passed through", () => {
    /*
     * Whatever else the endpoint sent stops here: the banner is handed a
     * narrowed row of exactly four fields, so a payload that grows a key
     * cannot reach the screen without somebody deciding it should.
     */
    const warning: TopologyUplinkWarning = parseUplinkWarnings([
      warningRow({
        deviceIds: ["device-1"],
        deviceCount: 1,
        html: "<script>alert(1)</script>",
        severity: "critical",
      }),
    ])[0]!;

    expect(Object.keys(warning).sort()).toEqual([
      "deviceCount",
      "deviceIds",
      "message",
      "reason",
    ]);
  });

  test("a row keeps its names when the count is absent but the names are not", () => {
    const warning: TopologyUplinkWarning = parseUplinkWarnings([
      warningRow({ deviceIds: ["device-1"], deviceCount: undefined }),
    ])[0]!;

    expect(warning.deviceCount).toBe(1);
  });
});
