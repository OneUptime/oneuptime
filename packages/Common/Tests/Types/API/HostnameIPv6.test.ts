import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import { describe, expect, test } from "@jest/globals";
import net from "net";

/*
 * Hostname's handling of IPv6 literals.
 *
 * fromString used to split on the FIRST colon, which is meaningless for an
 * address made of colons. The damage was silent rather than loud: for the
 * customer address reported below it
 * returned host "2001" with port 518 — both legal — so nothing threw and the
 * value the operator typed was simply gone.
 */

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";

describe("Hostname.fromString with an IPv6 literal", () => {
  test("keeps the whole address instead of its first two groups", () => {
    const hostname: Hostname = Hostname.fromString(CUSTOMER_ADDRESS);

    expect(hostname.hostname).toBe(CUSTOMER_ADDRESS);
    expect(hostname.port).toBeUndefined();
    expect(hostname.toString()).toBe(CUSTOMER_ADDRESS);
  });

  test("specifically, it is not 2001 port 518", () => {
    const hostname: Hostname = Hostname.fromString(CUSTOMER_ADDRESS);

    expect(hostname.hostname).not.toBe("2001");
    expect(hostname.port?.toNumber()).not.toBe(518);
  });

  test("trims, so a pasted address keeps working", () => {
    expect(Hostname.fromString(`  ${CUSTOMER_ADDRESS}\n`).hostname).toBe(
      CUSTOMER_ADDRESS,
    );
  });

  test.each([
    "::1",
    "::",
    "2001:db8::",
    "::ffff:192.0.2.1",
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
  ])("survives the compressed form %s", (address: string) => {
    expect(Hostname.fromString(address).hostname).toBe(address);
  });

  test("a bracketed literal keeps its brackets and gives up its port", () => {
    const hostname: Hostname = Hostname.fromString(`[${CUSTOMER_ADDRESS}]:179`);

    expect(hostname.hostname).toBe(`[${CUSTOMER_ADDRESS}]`);
    expect(hostname.port?.toNumber()).toBe(179);
  });

  test("a value with two colons that is NOT an address is rejected rather than silently split", () => {
    expect(() => {
      return Hostname.fromString("example.com:80:90");
    }).toThrow();
  });
});

describe("Hostname.fromString — IPv4 and DNS are unchanged", () => {
  test.each([
    ["example.com", "example.com", undefined],
    ["example.com:8443", "example.com", 8443],
    ["192.0.2.1", "192.0.2.1", undefined],
    ["192.0.2.1:179", "192.0.2.1", 179],
    ["localhost:3000", "localhost", 3000],
  ])(
    "%s parses to host %s",
    (value: string, expectedHost: string, expectedPort?: number) => {
      const hostname: Hostname = Hostname.fromString(value);

      expect(hostname.hostname).toBe(expectedHost);
      expect(hostname.port?.toNumber()).toBe(expectedPort);
    },
  );
});

describe("Hostname.toString with a port", () => {
  test("brackets an IPv6 host, because the unbracketed form is a different address", () => {
    const hostname: Hostname = new Hostname(CUSTOMER_ADDRESS, 179);

    expect(hostname.toString()).toBe(`[${CUSTOMER_ADDRESS}]:179`);

    // What it used to produce, and why that was not merely ugly:
    expect(net.isIP(`${CUSTOMER_ADDRESS}:179`)).toBe(6);
    expect(hostname.toString()).not.toBe(`${CUSTOMER_ADDRESS}:179`);
  });

  test("the bracketed form re-parses to the same host and port", () => {
    const roundTripped: Hostname = Hostname.fromString(
      new Hostname(CUSTOMER_ADDRESS, 179).toString(),
    );

    expect(roundTripped.hostname).toBe(`[${CUSTOMER_ADDRESS}]`);
    expect(roundTripped.port?.toNumber()).toBe(179);
  });

  test("an IPv4 or DNS host keeps the conventional spelling", () => {
    expect(new Hostname("192.0.2.1", 179).toString()).toBe("192.0.2.1:179");
    expect(new Hostname("example.com", 8443).toString()).toBe(
      "example.com:8443",
    );
  });

  test("without a port the host is returned exactly as held", () => {
    expect(new Hostname(CUSTOMER_ADDRESS).toString()).toBe(CUSTOMER_ADDRESS);
    expect(Hostname.fromAuthority("[::1]").toString()).toBe("[::1]");
  });
});

describe("Hostname.isValid validates the address, not just its characters", () => {
  test.each([CUSTOMER_ADDRESS, "::1", "[::1]", "[::1]:8080", "2001:db8::"])(
    "accepts %s",
    (value: string) => {
      expect(Hostname.isValid(value)).toBe(true);
    },
  );

  test.each([
    "::::",
    "2001:db8:::1",
    "[not-an-address]",
    "gggg::1",
    "2001:db8::1::2",
  ])(
    "rejects %s, which the old character allowlist let through",
    (value: string) => {
      expect(Hostname.isValid(value)).toBe(false);
    },
  );
});

describe("URL.toString still emits a valid authority for an IPv6 host", () => {
  test("brackets survive a round trip", () => {
    expect(
      URL.fromString(`https://[${CUSTOMER_ADDRESS}]/health`).toString(),
    ).toBe(`https://[${CUSTOMER_ADDRESS}]/health`);
  });

  test("a bracketed host with a port survives a round trip", () => {
    expect(
      URL.fromString(`https://[${CUSTOMER_ADDRESS}]:8443/x`).toString(),
    ).toBe(`https://[${CUSTOMER_ADDRESS}]:8443/x`);
  });
});
