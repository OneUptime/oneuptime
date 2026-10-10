import {
  NetworkTrafficFilters,
  NetworkTrafficFiltersUtil,
  getNetworkTrafficBucketSeconds,
} from "../../../Types/NetFlow/NetworkTraffic";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * The Traffic pages' filters, as the server takes them: what is checked,
 * what is normalized, and that anything wrong is refused rather than
 * quietly dropped (a dropped filter widens what the page shows).
 */

describe("NetworkTrafficFiltersUtil.sanitize", () => {
  test("keeps every filter that is well formed, addresses canonical", () => {
    const filters: NetworkTrafficFilters = NetworkTrafficFiltersUtil.sanitize({
      sourceIp: " 10.0.0.5 ",
      destinationIp: "2001:DB8:0:0:0:0:0:1",
      hostIp: "192.168.1.20",
      exporterIp: "10.255.0.1",
      protocolNumber: 6,
      port: 443,
      interfaceIndex: 4294967295,
      networkDeviceId: "6F9619FF-8B86-D011-B42D-00C04FC964FF",
    });

    expect(filters).toEqual({
      sourceIp: "10.0.0.5",
      destinationIp: "2001:db8::1",
      hostIp: "192.168.1.20",
      exporterIp: "10.255.0.1",
      protocolNumber: 6,
      port: 443,
      interfaceIndex: 4294967295,
      networkDeviceId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
    });
    expect(NetworkTrafficFiltersUtil.isFiltered(filters)).toBe(true);
  });

  test("nothing, or empty values, is no filter at all", () => {
    expect(NetworkTrafficFiltersUtil.sanitize(undefined)).toEqual({});
    expect(NetworkTrafficFiltersUtil.sanitize(null)).toEqual({});
    expect(
      NetworkTrafficFiltersUtil.sanitize({ sourceIp: "", port: null }),
    ).toEqual({});
    expect(NetworkTrafficFiltersUtil.isFiltered({})).toBe(false);
  });

  test("port 0 and protocol 0 are values, not blanks", () => {
    expect(
      NetworkTrafficFiltersUtil.sanitize({ port: 0, protocolNumber: 0 }),
    ).toEqual({ port: 0, protocolNumber: 0 });
  });

  test.each([
    ["an address that is not one", { sourceIp: "router-1" }],
    ["an address in an array", { hostIp: ["10.0.0.1"] }],
    ["a port past 65535", { port: 65536 }],
    ["a negative port", { port: -1 }],
    ["a fractional port", { port: 44.3 }],
    ["a protocol past 255", { protocolNumber: 256 }],
    ["an interface past 32 bits", { interfaceIndex: 4294967296 }],
    ["a device ID that is not one", { networkDeviceId: "drop table" }],
    ["filters that are not an object", ["10.0.0.1"]],
    ["filters that are text", "sourceIp=10.0.0.1"],
  ])("refuses %s", (_name: string, value: unknown) => {
    expect(() => {
      return NetworkTrafficFiltersUtil.sanitize(value);
    }).toThrow(BadDataException);
  });
});

describe("getNetworkTrafficBucketSeconds", () => {
  test.each([
    [60, 60],
    [3600, 60],
    [6 * 3600, 180],
    [24 * 3600, 720],
    [7 * 24 * 3600, 5040],
    [31 * 24 * 3600, 22320],
  ])(
    "a %i-second window is cut into %i-second buckets",
    (windowSeconds: number, bucketSeconds: number) => {
      expect(getNetworkTrafficBucketSeconds(windowSeconds)).toBe(
        bucketSeconds,
      );
    },
  );

  test("buckets are whole minutes and about 120 a window, never more", () => {
    for (const windowSeconds of [61, 7200, 99999, 2678400]) {
      const bucket: number = getNetworkTrafficBucketSeconds(windowSeconds);

      expect(bucket % 60).toBe(0);
      expect(windowSeconds / bucket).toBeLessThanOrEqual(120);
    }
  });
});
