import BadDataException from "../../Types/Exception/BadDataException";
import {
  NETWORK_TRAFFIC_USAGE_KINDS,
  NETWORK_TRAFFIC_USAGE_UPLINK_WINDOW_SECONDS,
  NetworkTrafficUsageFiltersUtil,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageSummary,
  getNetworkTrafficUsageBucketSeconds,
  getUnavailableNetworkTrafficUsageSummary,
  getUsageOctets,
  isUplinkUsageKind,
  isUsageObjectId,
} from "../../Types/NetFlow/NetworkTrafficUsage";
import ObjectID from "../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The Meraki side of a Traffic page's request and answer: the filters it
 * may narrow to (checked, never ignored), the chart's buckets (never
 * narrower than one uplink window) and the answer of a page without the
 * source.
 */

describe("the filters a request narrows to", () => {
  test("none is no filter", () => {
    expect(NetworkTrafficUsageFiltersUtil.sanitize(undefined)).toEqual({});
    expect(NetworkTrafficUsageFiltersUtil.sanitize(null)).toEqual({});
    expect(
      NetworkTrafficUsageFiltersUtil.isFiltered(
        NetworkTrafficUsageFiltersUtil.sanitize({}),
      ),
    ).toBe(false);
  });

  test("a network ID and an appliance's serial are kept, the serial upper-cased", () => {
    const filters: ReturnType<typeof NetworkTrafficUsageFiltersUtil.sanitize> =
      NetworkTrafficUsageFiltersUtil.sanitize({
        controllerNetworkId: "L_646829496481105433",
        deviceSerial: "q2xx-abcd-1234",
      });

    expect(filters).toEqual({
      controllerNetworkId: "L_646829496481105433",
      deviceSerial: "Q2XX-ABCD-1234",
    });
    expect(NetworkTrafficUsageFiltersUtil.isFiltered(filters)).toBe(true);
  });

  test.each([
    [{ controllerNetworkId: "L_1' OR 1=1 --" }],
    [{ controllerNetworkId: 12 }],
    [{ deviceSerial: "Q2XX ABCD" }],
    [{ deviceSerial: "x".repeat(65) }],
    ["controllerNetworkId=L_1"],
    [["L_1"]],
  ])("%p is refused, never widened to everything", (value: unknown) => {
    expect(() => {
      return NetworkTrafficUsageFiltersUtil.sanitize(value);
    }).toThrow(BadDataException);
  });

  test("an empty value is no filter", () => {
    expect(
      NetworkTrafficUsageFiltersUtil.sanitize({
        controllerNetworkId: "",
        deviceSerial: null,
      }),
    ).toEqual({});
  });
});

describe("an uplink's filter", () => {
  test.each([["wan1"], ["wan2"], ["wan3"], ["cellular"], ["uplink"]])(
    "%s is kept as it is, and is a filter",
    (name: string) => {
      const filters: ReturnType<
        typeof NetworkTrafficUsageFiltersUtil.sanitize
      > = NetworkTrafficUsageFiltersUtil.sanitize({ interfaceName: name });

      expect(filters).toEqual({ interfaceName: name });
      expect(NetworkTrafficUsageFiltersUtil.isFiltered(filters)).toBe(true);
    },
  );

  test("any name a row can list can be narrowed to, its case kept and spaces too", () => {
    for (const name of ["WAN 1", "Port 3", "wan-1_b", "GigabitEthernet0/0/1"]) {
      expect(
        NetworkTrafficUsageFiltersUtil.sanitize({ interfaceName: name }),
      ).toEqual({ interfaceName: name });
    }
  });

  test.each([
    ["a number", 7],
    ["an object", {}],
    ["an array", ["wan1"]],
    ["control characters", "wan1\u0000"],
    ["a line break", "wan1\nwan2"],
    ["a C1 control character", "wan\u00851"],
    ["a name past the limit", "w".repeat(65)],
  ])("%s is refused, never ignored", (_name: string, value: unknown) => {
    expect(() => {
      return NetworkTrafficUsageFiltersUtil.sanitize({ interfaceName: value });
    }).toThrow(BadDataException);
  });

  test("an empty value is no filter", () => {
    for (const value of [undefined, null, ""]) {
      expect(
        NetworkTrafficUsageFiltersUtil.sanitize({ interfaceName: value }),
      ).toEqual({});
    }
  });

  test("it sits beside the other two", () => {
    expect(
      NetworkTrafficUsageFiltersUtil.sanitize({
        controllerNetworkId: "L_1",
        deviceSerial: "q2xx-aaaa-0001",
        interfaceName: "wan2",
      }),
    ).toEqual({
      controllerNetworkId: "L_1",
      deviceSerial: "Q2XX-AAAA-0001",
      interfaceName: "wan2",
    });
  });

  test("text that is SQL is only text here: the query binds it", () => {
    expect(
      NetworkTrafficUsageFiltersUtil.sanitize({
        interfaceName: "wan1' OR '1'='1",
      }),
    ).toEqual({ interfaceName: "wan1' OR '1'='1" });
  });
});

describe("the chart's buckets", () => {
  test("never narrower than one uplink window", () => {
    expect(NETWORK_TRAFFIC_USAGE_UPLINK_WINDOW_SECONDS).toBe(300);
    expect(getNetworkTrafficUsageBucketSeconds(600)).toBe(300);
    expect(getNetworkTrafficUsageBucketSeconds(3600)).toBe(300);
  });

  test("as the flow pages' beyond: about 120 a window, in whole minutes", () => {
    expect(getNetworkTrafficUsageBucketSeconds(24 * 3600)).toBe(720);
    expect(getNetworkTrafficUsageBucketSeconds(31 * 24 * 3600) % 60).toBe(0);
  });
});

describe("a page without the source", () => {
  test("says so, with an empty answer over the range asked for", () => {
    const summary: NetworkTrafficUsageSummary =
      getUnavailableNetworkTrafficUsageSummary({
        startTime: new Date("2026-10-24T10:00:00.000Z"),
        endTime: new Date("2026-10-24T11:00:00.000Z"),
      });

    expect(summary.isAvailable).toBe(false);
    expect(summary.windowStartAt).toBe("2026-10-24T10:00:00.000Z");
    expect(summary.bucketSeconds).toBe(300);
    expect(getUsageOctets(summary.totals)).toBe(0);
    expect(summary.primaryKind).toBe(NetworkTrafficUsageKind.Uplink);
    expect(summary.connections).toEqual([]);
    expect(summary.uplinkInterfaces).toEqual([]);
    expect(summary.uplinkSeries).toEqual([]);
    expect(summary.topConversations).toEqual([]);
  });
});

describe("helpers", () => {
  test("a row's total is both directions", () => {
    expect(getUsageOctets({ sentOctets: 3, receivedOctets: 39 })).toBe(42);
  });

  test("the four kinds, in the order the page reads them", () => {
    expect(NETWORK_TRAFFIC_USAGE_KINDS).toEqual([
      "uplink",
      "application",
      "client",
      "uplinkHealth",
    ]);
  });

  test("an uplink and its health are read for the whole organization at once; the rest network by network", () => {
    expect(
      NETWORK_TRAFFIC_USAGE_KINDS.filter(
        (kind: NetworkTrafficUsageKind): boolean => {
          return isUplinkUsageKind(kind);
        },
      ),
    ).toEqual(["uplink", "uplinkHealth"]);
  });

  test("an ID OneUptime made is a UUID", () => {
    expect(isUsageObjectId(ObjectID.generate().toString())).toBe(true);
    expect(isUsageObjectId("L_123")).toBe(false);
    expect(isUsageObjectId(undefined)).toBe(false);
  });
});
