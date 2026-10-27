import {
  MAX_IP_ADDRESS_LENGTH,
  isIpAddress,
} from "../../../../Utils/SecurityEvent/Connectors/SplunkNormalizer";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A SPLUNK FIELD IS TOLD APART AS AN ADDRESS IN TIME TIED TO HOW LONG AN
 * ADDRESS CAN BE.
 *
 * isIpAddress decides whether an event's source or destination field is an
 * IP address or a host name, over whatever text the event carried. Nothing
 * longer than the longest written address (45 characters: an IPv6 address
 * ending in an IPv4 one) is an address, and nothing longer reaches the
 * patterns - so a field of any length is decided at once, and every real
 * address is still recognized.
 * ---------------------------------------------------------------------------
 */

// Long enough that only the bound keeps the answer quick.
const LENGTH: number = 3000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("isIpAddress decides a long field at once", () => {
  test.each([
    ["colons then a stray character", repeat(":", LENGTH) + "\u0000"],
    ["hex groups and colons, no end", repeat("ab:", LENGTH) + "z"],
    ["dotted digits", repeat("1.", LENGTH)],
    [
      "colons and hex digits, then a stray character",
      repeat(":a", LENGTH) + "-",
    ],
  ])("%s", (_label: string, value: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(isIpAddress(value)).toBe(false);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("isIpAddress still recognizes every address", () => {
  test("the bound is the longest written address", () => {
    const longest: string = "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255";

    expect(MAX_IP_ADDRESS_LENGTH).toBe(45);
    expect(longest).toHaveLength(MAX_IP_ADDRESS_LENGTH);
    expect(isIpAddress(longest)).toBe(true);
  });

  test.each([
    "10.0.0.1",
    "255.255.255.255",
    "::1",
    "2001:db8::7",
    "fe80::1ff:fe23:4567:890a",
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    "::ffff:192.168.0.1",
    "  10.0.0.1  ",
  ])("%j", (value: string) => {
    expect(isIpAddress(value)).toBe(true);
  });

  test.each(["wkstn-042", "host.example.com", "256.1.1.1", ""])(
    "%j is no address",
    (value: string) => {
      expect(isIpAddress(value)).toBe(false);
    },
  );

  test("a longer value is no address, however address-like", () => {
    expect(isIpAddress("1:2:3:4:5:6:7:8:9:10:11:12:13:14:15:16:17:18:19")).toBe(
      false,
    );
  });
});
