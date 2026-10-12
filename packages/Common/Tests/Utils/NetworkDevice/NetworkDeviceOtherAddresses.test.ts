import NetworkDeviceOtherAddressesUtil, {
  MAX_OTHER_ADDRESSES,
  MAX_OTHER_ADDRESSES_LENGTH,
} from "../../../Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import { describe, expect, test } from "@jest/globals";

/*
 * A device's Other Addresses - the addresses it sends traps, syslog and
 * flows from besides its hostname - typed generously, stored strictly,
 * matched in any spelling.
 */

describe("NetworkDeviceOtherAddressesUtil.parse", () => {
  test("reads commas, spaces, semicolons and new lines alike, each address once, in order", () => {
    expect(
      NetworkDeviceOtherAddressesUtil.parse(
        " 10.255.0.1, 192.168.1.1;10.255.0.1\n2001:DB8::1  ",
      ),
    ).toEqual({
      addresses: ["10.255.0.1", "192.168.1.1", "2001:db8::1"],
      invalid: [],
    });
  });

  test("names what is not an IP address", () => {
    expect(
      NetworkDeviceOtherAddressesUtil.parse("10.0.0.1, core-sw-01, 10.0.0.300"),
    ).toEqual({
      addresses: ["10.0.0.1"],
      invalid: ["core-sw-01", "10.0.0.300"],
    });
  });

  test("nothing typed is no addresses", () => {
    for (const value of [null, undefined, "", " , ;\n"]) {
      expect(NetworkDeviceOtherAddressesUtil.parse(value)).toEqual({
        addresses: [],
        invalid: [],
      });
    }
  });
});

describe("NetworkDeviceOtherAddressesUtil.normalize", () => {
  test("stores canonical addresses joined by a comma and a space", () => {
    expect(
      NetworkDeviceOtherAddressesUtil.normalize(
        "2001:0DB8:0:0:0:0:0:0001;10.0.0.1",
      ),
    ).toBe("2001:db8::1, 10.0.0.1");
  });

  test("blank clears the column", () => {
    expect(NetworkDeviceOtherAddressesUtil.normalize("  ")).toBeNull();
    expect(NetworkDeviceOtherAddressesUtil.normalize(null)).toBeNull();
  });

  test("refuses anything that is not an IP address, saying which", () => {
    expect(() => {
      return NetworkDeviceOtherAddressesUtil.normalize(
        "10.0.0.1, router.example.com",
      );
    }).toThrow("Not an IP address: router.example.com.");
  });

  test(`refuses more than ${MAX_OTHER_ADDRESSES} addresses`, () => {
    const many: string = Array.from(
      { length: MAX_OTHER_ADDRESSES + 1 },
      (_unused: unknown, index: number): string => {
        return `10.0.${Math.floor(index / 250)}.${index % 250}`;
      },
    ).join(", ");

    expect(() => {
      return NetworkDeviceOtherAddressesUtil.normalize(many);
    }).toThrow(`up to ${MAX_OTHER_ADDRESSES} addresses`);
  });

  test("the most addresses allowed, even the longest IPv6 ones, fit the column", () => {
    const longest: string = Array.from(
      { length: MAX_OTHER_ADDRESSES },
      (_unused: unknown, index: number): string => {
        return `2001:db8:1111:2222:3333:4444:5555:${(index + 0x1000).toString(16)}`;
      },
    ).join(", ");

    const normalized: string | null =
      NetworkDeviceOtherAddressesUtil.normalize(longest);

    expect(normalized).not.toBeNull();
    expect(normalized!.length).toBeLessThanOrEqual(MAX_OTHER_ADDRESSES_LENGTH);
  });
});

describe("NetworkDeviceOtherAddressesUtil.includes and add", () => {
  test("matches an address in any spelling, and nothing that is not one", () => {
    const stored: string = "10.255.0.1, 2001:db8::1";

    expect(
      NetworkDeviceOtherAddressesUtil.includes(stored, "2001:DB8:0::1"),
    ).toBe(true);
    expect(NetworkDeviceOtherAddressesUtil.includes(stored, "10.255.0.1")).toBe(
      true,
    );
    expect(NetworkDeviceOtherAddressesUtil.includes(stored, "10.255.0.2")).toBe(
      false,
    );
    expect(NetworkDeviceOtherAddressesUtil.includes(stored, "")).toBe(false);
    expect(NetworkDeviceOtherAddressesUtil.includes(null, "10.255.0.1")).toBe(
      false,
    );
  });

  test("adds an address once, keeping what is there", () => {
    expect(NetworkDeviceOtherAddressesUtil.add(null, "10.255.0.1")).toBe(
      "10.255.0.1",
    );
    expect(
      NetworkDeviceOtherAddressesUtil.add("10.255.0.1", "192.168.1.1"),
    ).toBe("10.255.0.1, 192.168.1.1");
    expect(
      NetworkDeviceOtherAddressesUtil.add(
        "10.255.0.1, 192.168.1.1",
        "10.255.0.1",
      ),
    ).toBe("10.255.0.1, 192.168.1.1");
  });
});
