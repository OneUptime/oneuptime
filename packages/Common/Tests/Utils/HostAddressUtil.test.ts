import HostAddressUtil from "../../Utils/HostAddressUtil";
import { describe, expect, test } from "@jest/globals";
import net from "net";

/*
 * The two IPv6 text problems that kept being got wrong one call site at a
 * time: brackets are URL syntax rather than part of the address, and
 * "host:port" is ambiguous for IPv6 in a way that does not look wrong.
 */

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";

describe("HostAddressUtil.isIPv6", () => {
  test.each([
    CUSTOMER_ADDRESS,
    `[${CUSTOMER_ADDRESS}]`,
    "::1",
    "[::1]",
    "::",
    "2001:db8::",
    "::ffff:192.0.2.1",
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
  ])("%s is IPv6", (value: string) => {
    expect(HostAddressUtil.isIPv6(value)).toBe(true);
  });

  test.each([
    "192.0.2.1",
    "example.com",
    "localhost",
    "",
    "   ",
    "[not-an-address]",
    "2001:db8::1:8443:extra",
    "example.com:8443",
  ])("%s is not IPv6", (value: string) => {
    expect(HostAddressUtil.isIPv6(value)).toBe(false);
  });
});

describe("HostAddressUtil.stripBrackets", () => {
  test("removes the URL brackets from an IPv6 literal", () => {
    expect(HostAddressUtil.stripBrackets(`[${CUSTOMER_ADDRESS}]`)).toBe(
      CUSTOMER_ADDRESS,
    );
  });

  test("the result is something a socket will accept, which the bracketed form is not", () => {
    /*
     * The point of the whole helper. Node does not strip these itself:
     * net.connect({host: "[::1]"}) goes to the resolver and fails ENOTFOUND.
     */
    expect(net.isIP(`[${CUSTOMER_ADDRESS}]`)).toBe(0);
    expect(
      net.isIP(HostAddressUtil.stripBrackets(`[${CUSTOMER_ADDRESS}]`)),
    ).toBe(6);
  });

  test("leaves a bare address, an IPv4 address and a DNS name alone", () => {
    expect(HostAddressUtil.stripBrackets(CUSTOMER_ADDRESS)).toBe(
      CUSTOMER_ADDRESS,
    );
    expect(HostAddressUtil.stripBrackets("192.0.2.1")).toBe("192.0.2.1");
    expect(HostAddressUtil.stripBrackets("example.com")).toBe("example.com");
  });

  test("trims, because a pasted address usually arrives with whitespace", () => {
    expect(HostAddressUtil.stripBrackets(`  ${CUSTOMER_ADDRESS}\n`)).toBe(
      CUSTOMER_ADDRESS,
    );
  });

  test("does NOT launder a bracketed non-address into a bare hostname", () => {
    expect(HostAddressUtil.stripBrackets("[not-an-address]")).toBe(
      "[not-an-address]",
    );
    expect(HostAddressUtil.stripBrackets("[192.0.2.1]")).toBe("[192.0.2.1]");
  });

  test("handles empty input", () => {
    expect(HostAddressUtil.stripBrackets("")).toBe("");
  });
});

describe("HostAddressUtil.formatHostAndPort", () => {
  test("brackets an IPv6 host so the port separator cannot be read as the address", () => {
    expect(
      HostAddressUtil.formatHostAndPort({ host: CUSTOMER_ADDRESS, port: 179 }),
    ).toBe(`[${CUSTOMER_ADDRESS}]:179`);
  });

  test("the unbracketed form really is a DIFFERENT valid address, which is why this matters", () => {
    /*
     * Not a cosmetic issue: "2001:518:2800:9::2" + ":179" parses as a real
     * IPv6 address, so an alert naming it sends somebody to the wrong host
     * rather than to something obviously malformed.
     */
    expect(net.isIP(`${CUSTOMER_ADDRESS}:179`)).toBe(6);
    expect(`${CUSTOMER_ADDRESS}:179`).not.toBe(CUSTOMER_ADDRESS);

    expect(
      HostAddressUtil.formatHostAndPort({ host: CUSTOMER_ADDRESS, port: 179 }),
    ).not.toBe(`${CUSTOMER_ADDRESS}:179`);
  });

  test("IPv4 and DNS hosts keep the conventional spelling", () => {
    expect(
      HostAddressUtil.formatHostAndPort({ host: "192.0.2.1", port: 179 }),
    ).toBe("192.0.2.1:179");
    expect(
      HostAddressUtil.formatHostAndPort({ host: "example.com", port: "8443" }),
    ).toBe("example.com:8443");
  });

  test("does not bracket twice", () => {
    expect(
      HostAddressUtil.formatHostAndPort({
        host: `[${CUSTOMER_ADDRESS}]`,
        port: 179,
      }),
    ).toBe(`[${CUSTOMER_ADDRESS}]:179`);
  });

  test("no port means the bare host, so a stored destination is not rewritten", () => {
    expect(HostAddressUtil.formatHostAndPort({ host: CUSTOMER_ADDRESS })).toBe(
      CUSTOMER_ADDRESS,
    );
    expect(
      HostAddressUtil.formatHostAndPort({ host: CUSTOMER_ADDRESS, port: "" }),
    ).toBe(CUSTOMER_ADDRESS);
    expect(
      HostAddressUtil.formatHostAndPort({
        host: `[${CUSTOMER_ADDRESS}]`,
        port: undefined,
      }),
    ).toBe(CUSTOMER_ADDRESS);
  });
});
