import {
  getDiscoveredDeviceName,
  getDiscoveredDeviceSecondaryLine,
  getMacSearchHex,
  isIpAddressLiteral,
  macMatchesSearchHex,
} from "../../../Utils/NetworkDevice/DiscoveredDeviceIdentity";
import { describe, expect, test } from "@jest/globals";

/*
 * What a discovered device is called, and how a search finds it (issue
 * #5775): never by its maker, an address drawn whole and never under
 * itself, and a MAC found however a switch printed it.
 */
describe("DiscoveredDeviceIdentity", () => {
  describe("isIpAddressLiteral", () => {
    test.each([
      ["10.0.0.5", true],
      ["255.255.255.255", true],
      ["2001:db8::1", true],
      ["fe80::1", true],
      [" 10.0.0.5 ", true],
      ["10.0.0", false],
      ["999.0.0.1", false],
      ["core-1.example.com", false],
      ["aa:bb:cc:dd:ee:ff", false],
      ["", false],
      ["   ", false],
    ])("%s is an address: %s", (value: string, expected: boolean) => {
      expect(isIpAddressLiteral(value)).toBe(expected);
    });

    test("null, undefined and over-long text are not addresses", () => {
      expect(isIpAddressLiteral(null)).toBe(false);
      expect(isIpAddressLiteral(undefined)).toBe(false);
      expect(isIpAddressLiteral(`10.0.0.5${" ".repeat(10)}x`)).toBe(false);
      expect(isIpAddressLiteral("1".repeat(100))).toBe(false);
    });
  });

  describe("getDiscoveredDeviceName", () => {
    test("a person's classification first", () => {
      expect(
        getDiscoveredDeviceName({
          classification: "Front register",
          hostname: "reg-01",
          ipAddress: "10.0.0.5",
          macAddress: "aa:bb:cc:dd:ee:01",
        }),
      ).toBe("Front register");
    });

    test("then the name its controller gives it", () => {
      expect(
        getDiscoveredDeviceName({
          hostname: "reg-01",
          ipAddress: "10.0.0.5",
          macAddress: "aa:bb:cc:dd:ee:01",
        }),
      ).toBe("reg-01");
    });

    test("then its address, then its MAC", () => {
      expect(
        getDiscoveredDeviceName({
          ipAddress: "10.0.0.5",
          macAddress: "aa:bb:cc:dd:ee:01",
        }),
      ).toBe("10.0.0.5");
      expect(getDiscoveredDeviceName({ macAddress: "aa:bb:cc:dd:ee:01" })).toBe(
        "aa:bb:cc:dd:ee:01",
      );
    });

    test("never its maker, whatever else is missing", () => {
      const fields: Record<string, string> = {
        vendor: "Verifone",
        macAddress: "aa:bb:cc:dd:ee:01",
      };
      expect(getDiscoveredDeviceName(fields)).toBe("aa:bb:cc:dd:ee:01");
      expect(getDiscoveredDeviceName({ vendor: "Verifone" } as never)).toBe("");
    });

    test("blank and padded values are trimmed, and blank ones skipped", () => {
      expect(
        getDiscoveredDeviceName({
          classification: "   ",
          hostname: "\t",
          ipAddress: " 10.0.0.5 ",
        }),
      ).toBe("10.0.0.5");
      expect(getDiscoveredDeviceName({})).toBe("");
      expect(
        getDiscoveredDeviceName({
          classification: null,
          hostname: null,
          ipAddress: null,
          macAddress: null,
        }),
      ).toBe("");
    });
  });

  describe("getDiscoveredDeviceSecondaryLine", () => {
    test("a named device has its address under its name", () => {
      expect(
        getDiscoveredDeviceSecondaryLine({
          hostname: "reg-01",
          ipAddress: "10.0.0.5",
          vendor: "Verifone",
        }),
      ).toBe("10.0.0.5");
    });

    test("an unnamed device has its maker under its address", () => {
      expect(
        getDiscoveredDeviceSecondaryLine({
          ipAddress: "10.0.0.5",
          macAddress: "aa:bb:cc:dd:ee:01",
          vendor: "Verifone",
        }),
      ).toBe("Verifone");
    });

    test("a device known by its MAC alone has its maker under it", () => {
      expect(
        getDiscoveredDeviceSecondaryLine({
          macAddress: "aa:bb:cc:dd:ee:01",
          vendor: "Verifone",
        }),
      ).toBe("Verifone");
    });

    test("nothing to add is an empty line, and a value never repeats itself", () => {
      expect(getDiscoveredDeviceSecondaryLine({ ipAddress: "10.0.0.5" })).toBe(
        "",
      );
      expect(
        getDiscoveredDeviceSecondaryLine({
          classification: "Axis",
          vendor: "Axis",
        }),
      ).toBe("");
      expect(getDiscoveredDeviceSecondaryLine({})).toBe("");
    });
  });

  describe("getMacSearchHex", () => {
    test.each([
      ["aa:bb:cc:dd:ee:ff", "aabbccddeeff"],
      ["AA-BB-CC-DD-EE-FF", "aabbccddeeff"],
      ["aabb.ccdd.eeff", "aabbccddeeff"],
      ["AABBCCDDEEFF", "aabbccddeeff"],
      ["aa:bb", "aabb"],
      ["00:1a:2b", "001a2b"],
      ["00-11-22", "001122"],
      ["0011.22aa", "001122aa"],
      ["aa:bb:", "aabb"],
      [" ee:ff ", "eeff"],
      ["dead", "dead"],
    ])("%s reads as MAC hex %s", (search: string, expected: string) => {
      expect(getMacSearchHex(search)).toBe(expected);
    });

    test.each([
      ["10.0.0"],
      ["10.0.0.5"],
      ["1000"],
      ["001122"],
      ["reg-01"],
      ["front register"],
      ["ab"],
      ["a.b"],
      [""],
      ["   "],
      ["aa:bb:cc:dd:ee:ff:00:11"],
      ["zz:yy"],
    ])("%s does not read as a MAC", (search: string) => {
      expect(getMacSearchHex(search)).toBeNull();
    });

    test("null, undefined and very long searches do not read as a MAC", () => {
      expect(getMacSearchHex(null)).toBeNull();
      expect(getMacSearchHex(undefined)).toBeNull();
      expect(getMacSearchHex(`${"a:".repeat(40)}`)).toBeNull();
    });
  });

  describe("macMatchesSearchHex", () => {
    test("finds a stored MAC by any spelling of part of it", () => {
      const stored: string = "aa:bb:cc:dd:ee:ff";

      for (const search of [
        "AA-BB-CC",
        "bbcc.ddee",
        "ccddeeff",
        "dd:ee:ff",
        "aa:bb:cc:dd:ee:ff",
      ]) {
        expect(macMatchesSearchHex(stored, getMacSearchHex(search))).toBe(true);
      }
    });

    test("finds a MAC stored in another spelling", () => {
      expect(
        macMatchesSearchHex("AABB.CCDD.EEFF", getMacSearchHex("cc:dd")),
      ).toBe(true);
    });

    test("does not match another MAC, a missing MAC or no search", () => {
      expect(
        macMatchesSearchHex("aa:bb:cc:dd:ee:ff", getMacSearchHex("11:22")),
      ).toBe(false);
      expect(macMatchesSearchHex(undefined, getMacSearchHex("aa:bb"))).toBe(
        false,
      );
      expect(macMatchesSearchHex("aa:bb:cc:dd:ee:ff", null)).toBe(false);
    });
  });
});
