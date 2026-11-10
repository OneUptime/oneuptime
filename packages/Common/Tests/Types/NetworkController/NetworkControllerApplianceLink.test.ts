import BadDataException from "../../../Types/Exception/BadDataException";
import { MAX_NETWORK_TRAFFIC_USAGE_SEARCH_LENGTH } from "../../../Types/NetFlow/NetworkTrafficUsage";
import {
  LINKABLE_APPLIANCE_DAYS,
  MAX_APPLIANCE_SEARCH_LENGTH,
  MAX_LIKELY_APPLIANCES,
  MAX_LISTED_APPLIANCES,
  NetworkControllerApplianceLinkRequest,
  NetworkControllerApplianceLinkRequestUtil,
  NetworkControllerApplianceListRequest,
  readApplianceSerial,
} from "../../../Types/NetworkController/NetworkControllerApplianceLink";
import { describe, expect, test } from "@jest/globals";

/*
 * What "Link to a Meraki appliance" asks the server (OneUptime issue
 * #5762): which device, which appliance by its serial number, and a search
 * - each read without trusting its shape, and anything that is not one
 * refused before any database is asked.
 */

const DEVICE: string = "40000000-0000-4000-8000-000000000002";

describe("an appliance's serial number", () => {
  test("as Meraki prints it, in upper case, its padding trimmed", () => {
    expect(readApplianceSerial("Q2PN-LDS0-0012")).toBe("Q2PN-LDS0-0012");
    expect(readApplianceSerial("  q2pn-lds0-0012 ")).toBe("Q2PN-LDS0-0012");
  });

  test.each([
    [undefined],
    [null],
    [42],
    [""],
    ["   "],
    ["Q2PN LDS0 0012"],
    ["Q2PN_LDS0_0012"],
    ["Q2PN-LDS0-0012'; DROP TABLE x"],
    ["Q2PN-\u0000-0012"],
    ["Q".repeat(65)],
  ])("%p is not one: refused", (value: unknown) => {
    expect(() => {
      return readApplianceSerial(value);
    }).toThrow(BadDataException);
  });
});

describe("a list request", () => {
  test("the device and the search, trimmed", () => {
    const parsed: NetworkControllerApplianceListRequest =
      NetworkControllerApplianceLinkRequestUtil.parseList({
        networkDeviceId: DEVICE,
        search: "  leeds ",
      });

    expect(parsed.networkDeviceId.toString()).toBe(DEVICE);
    expect(parsed.search).toBe("leeds");
  });

  test("no search is every appliance; a long one is cut", () => {
    expect(
      NetworkControllerApplianceLinkRequestUtil.parseList({
        networkDeviceId: DEVICE,
      }).search,
    ).toBe("");
    expect(
      NetworkControllerApplianceLinkRequestUtil.parseList({
        networkDeviceId: DEVICE,
        search: "y".repeat(1000),
      }).search,
    ).toHaveLength(MAX_APPLIANCE_SEARCH_LENGTH);
  });

  test.each([[{}], [{ networkDeviceId: "device-1" }], [null], [[DEVICE]]])(
    "%p names no device: refused",
    (body: unknown) => {
      expect(() => {
        return NetworkControllerApplianceLinkRequestUtil.parseList(body);
      }).toThrow(BadDataException);
    },
  );
});

describe("a link and an unlink", () => {
  test("a link names the device and the appliance", () => {
    const parsed: NetworkControllerApplianceLinkRequest =
      NetworkControllerApplianceLinkRequestUtil.parseLink({
        networkDeviceId: DEVICE,
        deviceSerial: "q2pn-lds0-0012",
      });

    expect(parsed.networkDeviceId.toString()).toBe(DEVICE);
    expect(parsed.deviceSerial).toBe("Q2PN-LDS0-0012");
  });

  test("a link without a serial number, or of no device, is refused", () => {
    expect(() => {
      return NetworkControllerApplianceLinkRequestUtil.parseLink({
        networkDeviceId: DEVICE,
      });
    }).toThrow(BadDataException);
    expect(() => {
      return NetworkControllerApplianceLinkRequestUtil.parseLink({
        deviceSerial: "Q2PN-LDS0-0012",
      });
    }).toThrow(BadDataException);
  });

  test("an unlink names the device alone", () => {
    expect(
      NetworkControllerApplianceLinkRequestUtil.parseUnlink({
        networkDeviceId: DEVICE,
      }).networkDeviceId.toString(),
    ).toBe(DEVICE);
    expect(() => {
      return NetworkControllerApplianceLinkRequestUtil.parseUnlink({});
    }).toThrow(BadDataException);
  });
});

describe("the bounds", () => {
  test("a week of appliances, at most 50 listed, at most 3 offered first", () => {
    expect(LINKABLE_APPLIANCE_DAYS).toBe(7);
    expect(MAX_LISTED_APPLIANCES).toBe(50);
    expect(MAX_LIKELY_APPLIANCES).toBe(3);
    expect(MAX_APPLIANCE_SEARCH_LENGTH).toBe(
      MAX_NETWORK_TRAFFIC_USAGE_SEARCH_LENGTH,
    );
  });
});
