import isPrivateNetworkAddressDefault, {
  isPrivateNetworkAddress,
} from "../../../Server/Utils/PrivateNetworkAddress";
import WrongKeyLimit from "../../../Server/Utils/RateLimit/WrongKeyLimit";
import WrongComponentKeyLimit from "../../../Server/Utils/RateLimit/WrongComponentKeyLimit";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * PRIVATE NETWORK ADDRESSES: ONE LIST.
 *
 * Two rules read it, and must read it alike:
 *
 *   - the limits on wrong keys never count a key from a private network
 *     address (WrongKeyLimit, WrongComponentKeyLimit), so nothing sent beside
 *     OneUptime's own services can get them refused;
 *   - the Health page says so when several people sign in from one
 *     (InstanceHealth/SharedVisitorAddresses).
 *
 * So the ranges live in Utils/PrivateNetworkAddress, and the wrong-key limits
 * ask it. The ranges: RFC 1918, loopback, link-local, IPv6 loopback, unique
 * local and link-local. An IPv4 address written as IPv6 is the IPv4 address
 * it is; 6to4, NAT64 and Teredo are not unwrapped, so they are not private.
 * Anything that is not an address is not private.
 */

const PRIVATE: Array<string> = [
  // RFC 1918, each range's first, an inner and its last address.
  "10.0.0.0",
  "10.244.1.1",
  "10.255.255.255",
  "172.16.0.0",
  "172.18.0.1",
  "172.31.255.255",
  "192.168.0.0",
  "192.168.1.23",
  "192.168.255.255",
  // Loopback and link-local.
  "127.0.0.1",
  "127.255.255.254",
  "169.254.0.1",
  "169.254.169.254",
  // IPv6 loopback, unique local (fc00::/7) and link-local (fe80::/10).
  "::1",
  "fc00::1",
  "fd00::1",
  "fdf9:9ef6:88c2::1",
  "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  "fe80::1",
  "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  "fe80::1%eth0",
  // An IPv4 address written as IPv6.
  "::ffff:10.0.0.1",
  "::ffff:172.18.0.1",
  "::ffff:192.168.1.1",
  "::ffff:127.0.0.1",
];

const NOT_PRIVATE: Array<string> = [
  // Just outside each private range.
  "9.255.255.255",
  "11.0.0.0",
  "172.15.255.255",
  "172.32.0.0",
  "192.167.255.255",
  "192.169.0.0",
  "126.255.255.255",
  "128.0.0.0",
  "169.253.255.255",
  "169.255.0.0",
  "fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  "fec0::1",
  "::2",
  // Public addresses, the documentation ranges included.
  "203.0.113.7",
  "198.51.100.11",
  "8.8.8.8",
  "2001:db8::1",
  "2001:db8:99::11",
  "2606:4700::1111",
  "::ffff:203.0.113.7",
  // Carrier-grade NAT and the translators are not private here.
  "100.64.0.1",
  "64:ff9b::a00:1",
  "2002:a00:1::1",
  "2001:0:4136:e378:8000:63bf:f5ff:fffe",
  // Not an address at all.
  "unknown",
  "",
  "10.0.0",
  "10.0.0.1.example.com",
  "10.0.0.1%eth0",
  "localhost",
  "[::1]",
  "172.18.0.1:8080",
];

describe("isPrivateNetworkAddress", () => {
  test.each(PRIVATE)("%s is a private network address", (address: string) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  test.each(NOT_PRIVATE)(
    "%j is not a private network address",
    (address: string) => {
      expect(isPrivateNetworkAddress(address)).toBe(false);
    },
  );

  test("anything that is not a string is not private", () => {
    for (const value of [undefined, null, 10, {}, []]) {
      expect(isPrivateNetworkAddress(value as unknown as string)).toBe(false);
    }
  });

  test("the default export is the same rule", () => {
    expect(isPrivateNetworkAddressDefault).toBe(isPrivateNetworkAddress);
  });
});

describe("the wrong-key limits read the same list", () => {
  test.each([...PRIVATE, ...NOT_PRIVATE])(
    "WrongKeyLimit and WrongComponentKeyLimit agree on %j",
    (address: string) => {
      const expected: boolean = isPrivateNetworkAddress(address);

      expect(WrongKeyLimit.isPrivateNetworkAddress(address)).toBe(expected);
      expect(WrongComponentKeyLimit.isPrivateNetworkAddress(address)).toBe(
        expected,
      );
    },
  );

  test("WrongKeyLimit keeps no list of its own", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "Utils",
        "RateLimit",
        "WrongKeyLimit.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain("BlockList");
    expect(source).not.toContain("addSubnet");
    expect(source).toContain(
      'import { isPrivateNetworkAddress } from "../PrivateNetworkAddress";',
    );
  });
});
