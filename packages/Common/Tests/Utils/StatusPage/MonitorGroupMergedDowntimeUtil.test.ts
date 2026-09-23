import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import MonitorGroupMergedDowntimeUtil from "../../../Utils/StatusPage/MonitorGroupMergedDowntimeUtil";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The wire format for the merged downtime of a status page's monitor groups:
 * the overview payload's `monitorGroupMergedDowntime`, which a monitor group's
 * uptime percentage is read from in the browser instead of from the capped
 * timeline rows.
 *
 * As with the uptime aggregate, two properties matter more than the round
 * trip itself:
 *
 * 1. It must be SMALL and PLAIN. It rides in the overview payload, which is
 *    held in a 500-entry in-memory cache on the hottest public endpoint.
 *
 * 2. Parsing must be TOTAL. A payload from a server that predates the field
 *    has none, and the page must then measure monitor groups from their rows
 *    exactly as it used to - not fail to render.
 */

const EDGE_GROUP: string = "11111111-1111-4111-8111-111111111111";
const PAYMENTS_GROUP: string = "22222222-2222-4222-8222-222222222222";
const QUIET_GROUP: string = "33333333-3333-4333-8333-333333333333";

const DAY_SECONDS: number = 86400;

// sixty covered days with 17,270 s down: 99.666 at three decimals.
const EDGE: MergedDowntimeTotals = {
  coveredSeconds: 60 * DAY_SECONDS,
  downtimeSeconds: 17270,
};

// double precision straight from the SQL, never rounded.
const PAYMENTS: MergedDowntimeTotals = {
  coveredSeconds: 2591999.873512,
  downtimeSeconds: 3600.25,
};

// asked about, but nothing was recorded for its monitors.
const QUIET: MergedDowntimeTotals = {
  coveredSeconds: 0,
  downtimeSeconds: 0,
};

function sample(): Dictionary<MergedDowntimeTotals> {
  return {
    [EDGE_GROUP]: EDGE,
    [PAYMENTS_GROUP]: PAYMENTS,
    [QUIET_GROUP]: QUIET,
  };
}

// what the browser receives: the JSON, serialized and parsed again.
function overTheWire(json: JSONObject): JSONObject {
  return JSON.parse(JSON.stringify(json)) as JSONObject;
}

describe("MonitorGroupMergedDowntimeUtil", () => {
  describe("round trip", () => {
    test("survives toJSON, the wire and fromJSON unchanged, to the fraction of a second", () => {
      expect(
        MonitorGroupMergedDowntimeUtil.fromJSON(
          overTheWire(MonitorGroupMergedDowntimeUtil.toJSON(sample())),
        ),
      ).toEqual(sample());
    });

    test("a group with nothing recorded survives as nothing recorded, which is no percentage rather than 100%", () => {
      const parsed: Dictionary<MergedDowntimeTotals> =
        MonitorGroupMergedDowntimeUtil.fromJSON(
          overTheWire(MonitorGroupMergedDowntimeUtil.toJSON(sample())),
        );

      expect(parsed[QUIET_GROUP]).toEqual({
        coveredSeconds: 0,
        downtimeSeconds: 0,
      });

      expect(
        UptimeUtil.calculateUptimePercentOfCoveredSeconds({
          coveredSeconds: parsed[QUIET_GROUP]!.coveredSeconds,
          downtimeSeconds: parsed[QUIET_GROUP]!.downtimeSeconds,
          precision: UptimePrecision.THREE_DECIMAL,
        }),
      ).toBeNull();
    });

    test("an empty dictionary is an empty object", () => {
      expect(MonitorGroupMergedDowntimeUtil.toJSON({})).toEqual({});
      expect(MonitorGroupMergedDowntimeUtil.fromJSON({})).toEqual({});
    });
  });

  describe("the wire format stays small and plain", () => {
    test("two numbers per monitor group, keyed by its id, with no typed-JSON envelopes", () => {
      const json: JSONObject = MonitorGroupMergedDowntimeUtil.toJSON(sample());

      expect(json).toEqual({
        [EDGE_GROUP]: { coveredSeconds: 5184000, downtimeSeconds: 17270 },
        [PAYMENTS_GROUP]: {
          coveredSeconds: 2591999.873512,
          downtimeSeconds: 3600.25,
        },
        [QUIET_GROUP]: { coveredSeconds: 0, downtimeSeconds: 0 },
      });

      expect(JSON.stringify(json)).not.toContain("_type");
    });

    test("only the two figures are written, each group in an object of its own", () => {
      /*
       * Groups over the same monitors share one totals object on the server.
       * The payload is cached and handed to every visitor, so it must not
       * hand that object out, nor anything else that rode along on it.
       */
      const shared: MergedDowntimeTotals & { monitorIds: Array<string> } = {
        coveredSeconds: 100,
        downtimeSeconds: 10,
        monitorIds: ["not", "for", "the", "wire"],
      };

      const json: JSONObject = MonitorGroupMergedDowntimeUtil.toJSON({
        [EDGE_GROUP]: shared,
        [PAYMENTS_GROUP]: shared,
      });

      expect(json[EDGE_GROUP]).toEqual({
        coveredSeconds: 100,
        downtimeSeconds: 10,
      });
      expect(json[EDGE_GROUP]).not.toBe(shared);
      expect(json[EDGE_GROUP]).not.toBe(json[PAYMENTS_GROUP]);
    });

    test("a page with a hundred monitor groups adds about ten kilobytes", () => {
      const byMonitorGroupId: Dictionary<MergedDowntimeTotals> = {};

      for (let index: number = 0; index < 100; index++) {
        const suffix: string = String(index).padStart(12, "0");

        byMonitorGroupId[`aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`] = {
          coveredSeconds: 7775999.123456789,
          downtimeSeconds: 123456.987654321,
        };
      }

      const bytes: number = JSON.stringify(
        MonitorGroupMergedDowntimeUtil.toJSON(byMonitorGroupId),
      ).length;

      expect(bytes).toBeLessThan(100 * 120);
    });
  });

  describe("parsing is total", () => {
    test.each([
      ["missing", undefined],
      ["null", null],
      ["a string", "monitorGroupMergedDowntime"],
      ["a number", 42],
      ["an array", [{ coveredSeconds: 1, downtimeSeconds: 1 }]],
    ])(
      "a field that is %s reads as no merged downtime at all",
      (_name: string, json: unknown) => {
        expect(
          MonitorGroupMergedDowntimeUtil.fromJSON(json as JSONObject),
        ).toEqual({});
      },
    );

    test("a malformed entry is skipped and the others are kept", () => {
      const parsed: Dictionary<MergedDowntimeTotals> =
        MonitorGroupMergedDowntimeUtil.fromJSON({
          [EDGE_GROUP]: { coveredSeconds: 5184000, downtimeSeconds: 17270 },
          [PAYMENTS_GROUP]: null,
          [QUIET_GROUP]: "5184000",
          "44444444-4444-4444-8444-444444444444": [5184000, 17270],
        } as unknown as JSONObject);

      expect(parsed).toEqual({
        [EDGE_GROUP]: { coveredSeconds: 5184000, downtimeSeconds: 17270 },
      });
    });

    test("a figure that is not a positive number reads as zero, as it does where the server reads it", () => {
      const parsed: Dictionary<MergedDowntimeTotals> =
        MonitorGroupMergedDowntimeUtil.fromJSON({
          [EDGE_GROUP]: { coveredSeconds: -86400, downtimeSeconds: "abc" },
          [PAYMENTS_GROUP]: { coveredSeconds: null },
          [QUIET_GROUP]: {},
        } as unknown as JSONObject);

      expect(parsed).toEqual({
        [EDGE_GROUP]: { coveredSeconds: 0, downtimeSeconds: 0 },
        [PAYMENTS_GROUP]: { coveredSeconds: 0, downtimeSeconds: 0 },
        [QUIET_GROUP]: { coveredSeconds: 0, downtimeSeconds: 0 },
      });
    });

    test("numbers sent as strings are read as numbers", () => {
      expect(
        MonitorGroupMergedDowntimeUtil.fromJSON({
          [EDGE_GROUP]: { coveredSeconds: "5184000", downtimeSeconds: "17270" },
        } as unknown as JSONObject),
      ).toEqual({
        [EDGE_GROUP]: { coveredSeconds: 5184000, downtimeSeconds: 17270 },
      });
    });
  });
});
