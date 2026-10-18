import {
  ClientIpRequestLike,
  getRateLimitClient,
  resolveClientIp,
} from "../../../Server/Utils/ClientIp";
import { describe, expect, test } from "@jest/globals";

/*
 * The client a rate limit counts a request as (getRateLimitClient): an IPv4
 * address on its own, an IPv6 address by its /64 - one host, whichever of
 * its addresses it sends from - and anything else as itself.
 */

function requestFrom(forwardedFor: string): ClientIpRequestLike {
  return {
    headers: { "x-forwarded-for": forwardedFor },
    socket: { remoteAddress: "10.0.0.2" },
  };
}

describe("getRateLimitClient", () => {
  test("an IPv4 address is a client of its own", () => {
    expect(getRateLimitClient("203.0.113.7")).toBe("203.0.113.7");
    expect(getRateLimitClient("203.0.113.8")).toBe("203.0.113.8");
  });

  test("the addresses of one IPv6 /64 are one client", () => {
    const clients: Set<string> = new Set<string>();

    for (let host: number = 1; host <= 500; host++) {
      clients.add(getRateLimitClient(`2001:db8:5:6::${host.toString(16)}`));
      clients.add(
        getRateLimitClient(
          `2001:db8:5:6:${host.toString(16)}:${(host * 7).toString(16)}:1:2`,
        ),
      );
    }

    expect([...clients]).toEqual(["2001:db8:5:6::/64"]);
  });

  test("two IPv6 /64s are two clients", () => {
    expect(getRateLimitClient("2001:db8:5:6::1")).not.toBe(
      getRateLimitClient("2001:db8:5:7::1"),
    );
  });

  test("callers that cannot be placed share one client", () => {
    expect(getRateLimitClient("unknown")).toBe("unknown");
  });

  test("an IPv6 address as resolveClientIp attributes a request to it", () => {
    const first: string | undefined = resolveClientIp(
      requestFrom("2001:DB8:5:6::1"),
      { trustedProxyHops: 1 },
    );
    const second: string | undefined = resolveClientIp(
      requestFrom("[2001:db8:5:6:0:0:0:abcd]:443"),
      { trustedProxyHops: 1 },
    );

    expect(getRateLimitClient(first!)).toBe("2001:db8:5:6::/64");
    expect(getRateLimitClient(second!)).toBe("2001:db8:5:6::/64");
  });

  test("an IPv4 address that reached the server IPv4-mapped is that IPv4 address", () => {
    const resolved: string | undefined = resolveClientIp(
      { headers: {}, socket: { remoteAddress: "::ffff:203.0.113.9" } },
      { trustedProxyHops: 0 },
    );

    expect(resolved).toBe("203.0.113.9");
    expect(getRateLimitClient(resolved!)).toBe("203.0.113.9");
    // Handed over as it is, it is still not counted under a shared /64.
    expect(getRateLimitClient("::ffff:203.0.113.9")).toBe("::ffff:203.0.113.9");
  });

  test("the caller's own X-Forwarded-For entries name no client", () => {
    // Only the entry our proxy appended is read; the /64 is that entry's.
    const resolved: string | undefined = resolveClientIp(
      requestFrom("2001:db8:aaaa:1::1, 2001:db8:5:6::99"),
      { trustedProxyHops: 1 },
    );

    expect(getRateLimitClient(resolved!)).toBe("2001:db8:5:6::/64");
  });
});
