import {
  getSecurityAddressSpellings,
  readSecurityAddress,
} from "../../../Types/SecurityBlocklist/SecurityAddressSpellings";
import { readSecurityBlockValue } from "../../../Types/SecurityBlocklist/SecurityBlock";
import { canonicalAddress } from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE ADDRESS, HOWEVER A SOURCE WROTE WHAT IS AROUND IT (#10744).
 *
 * The address step checks look for every spelling of an address
 * (getSecurityAddressSpellings, #10678). What a record or a header holds
 * may also carry brackets, the client's port or a zone around the address,
 * which the blocklist's own reading of an address refuses: a host whose
 * agent wrote "[2001:db8::7]:22" protected nothing. readSecurityAddress
 * reads each of those as the address blocks write, and refuses what is no
 * single address.
 */

const IPV6: string = "2001:db8::7";
const IPV4: string = "203.0.113.7";

// 2001:db8::7, as sources write it.
const IPV6_FORMS: Record<string, string> = {
  compressed: "2001:db8::7",
  "written out": "2001:db8:0:0:0:0:0:7",
  "with leading zeros": "2001:0db8:0000:0000:0000:0000:0000:0007",
  "in capitals": "2001:DB8::7",
  "in brackets": "[2001:db8::7]",
  "in brackets with a port": "[2001:db8::7]:443",
  "written out in capitals, in brackets with a port":
    "[2001:0DB8:0:0:0:0:0:7]:51234",
  "with a zone": "2001:db8::7%eth0",
  "in brackets with a zone as a URL writes it, and a port":
    "[2001:db8::7%25eth0]:8443",
  "with white space around it": "  2001:db8::7 ",
};

// 203.0.113.7, as sources write it.
const IPV4_FORMS: Record<string, string> = {
  dotted: "203.0.113.7",
  "as a dual-stack server maps it": "::ffff:203.0.113.7",
  "mapped, in capitals": "::FFFF:203.0.113.7",
  "mapped, in hexadecimal": "::ffff:cb00:7107",
  "with a port": "203.0.113.7:51234",
  "mapped, with a port": "::ffff:203.0.113.7:51234",
  "mapped, in brackets with a port": "[::ffff:203.0.113.7]:51234",
};

describe("readSecurityAddress", () => {
  test.each(Object.entries(IPV6_FORMS))(
    "an IPv6 address %s (%s) is 2001:db8::7, as blocks write it",
    (_form: string, written: string) => {
      expect(readSecurityAddress(written)).toBe(IPV6);
    },
  );

  test.each(Object.entries(IPV4_FORMS))(
    "an IPv4 address %s (%s) is 203.0.113.7",
    (_form: string, written: string) => {
      expect(readSecurityAddress(written)).toBe(IPV4);
    },
  );

  test("is the address as the blocklist keeps it, and the address the step checks read", () => {
    for (const written of [
      ...Object.values(IPV6_FORMS),
      ...Object.values(IPV4_FORMS),
    ]) {
      const address: string | null = readSecurityAddress(written);

      expect({ written, kept: readSecurityBlockValue(address)?.value }).toEqual(
        { written, kept: address },
      );
      // The step checks' own spelling of it (IPv6 written out) is the same address.
      expect(readSecurityAddress(canonicalAddress(address))).toBe(address);
    }
  });

  test("hands the address step checks every spelling of it, whatever was around it", () => {
    const ipv6: Array<string> = getSecurityAddressSpellings(IPV6);

    expect(ipv6).toEqual([
      "2001:db8::7",
      "2001:db8:0:0:0:0:0:7",
      "2001:DB8::7",
      "2001:DB8:0:0:0:0:0:7",
    ]);

    for (const written of Object.values(IPV6_FORMS)) {
      expect(
        getSecurityAddressSpellings(readSecurityAddress(written) || ""),
      ).toEqual(ipv6);
    }

    for (const written of Object.values(IPV4_FORMS)) {
      expect(
        getSecurityAddressSpellings(readSecurityAddress(written) || ""),
      ).toEqual(["203.0.113.7", "::ffff:203.0.113.7"]);
    }
  });

  test("an IPv6 address written bare with what looks like a port is another address", () => {
    expect(readSecurityAddress("2001:db8::7:443")).toBe("2001:db8::7:443");
  });

  test.each([
    ["nothing", ""],
    ["white space", "   "],
    ["a range", "2001:db8::/32"],
    ["an IPv4 range", "203.0.113.0/24"],
    ["a name", "web-1.example.com"],
    ["a name and a port", "web-1.example.com:443"],
    ["a colon with no port", "203.0.113.7:"],
    ["a port too large", "203.0.113.7:65536"],
    ["a port with letters", "203.0.113.7:80a"],
    ["two ports", "203.0.113.7:80:81"],
    ["an open bracket", "[2001:db8::7"],
    ["text after the brackets", "[2001:db8::7]x"],
    ["empty brackets", "[]:443"],
    ["a group too long", "2001:db8::12345"],
    ["an octet too large", "203.0.113.256"],
  ])("%s (%s) is no address", (_what: string, written: string) => {
    expect(readSecurityAddress(written)).toBeNull();
  });

  test("anything but text is no address", () => {
    for (const value of [undefined, null, 7, {}, ["203.0.113.7"]]) {
      expect(readSecurityAddress(value)).toBeNull();
    }
  });
});
