import {
  ClientIpRequestLike,
  getRateLimitClient,
  RateLimitClient,
  resolveClientIp,
} from "../../../Server/Utils/ClientIp";
import { describe, expect, test } from "@jest/globals";

/*
 * Who a rate limit counts a request as (getRateLimitClient): its address,
 * written one way however it was spelled, and for an IPv6 address the /64
 * it is in - one host can send from any address of its /64, and some
 * hosting providers put many customers' servers in one /64, so a limit
 * counts both. Anything that is not an address is its own address, with
 * no /64.
 */

function requestFrom(forwardedFor: string): ClientIpRequestLike {
  return {
    headers: { "x-forwarded-for": forwardedFor },
    socket: { remoteAddress: "10.0.0.2" },
  };
}

describe("getRateLimitClient", () => {
  test("an IPv4 address is its own address, with no /64", () => {
    expect(getRateLimitClient("203.0.113.7")).toEqual({
      address: "203.0.113.7",
      ipv6Network64: null,
    });
    expect(getRateLimitClient("203.0.113.8")).toEqual({
      address: "203.0.113.8",
      ipv6Network64: null,
    });
  });

  test("the addresses of one IPv6 /64 are each their own address, in the same /64", () => {
    const addresses: Set<string> = new Set<string>();
    const networks: Set<string | null> = new Set<string | null>();

    for (let host: number = 1; host <= 250; host++) {
      for (const address of [
        `2001:db8:5:6::${host.toString(16)}`,
        `2001:db8:5:6:${host.toString(16)}:${(host * 7).toString(16)}:1:2`,
      ]) {
        const client: RateLimitClient = getRateLimitClient(address);

        addresses.add(client.address);
        networks.add(client.ipv6Network64);
      }
    }

    expect(addresses.size).toBe(500);
    expect([...networks]).toEqual(["2001:db8:5:6::/64"]);
  });

  test("two IPv6 /64s are two networks", () => {
    expect(getRateLimitClient("2001:db8:5:6::1").ipv6Network64).not.toBe(
      getRateLimitClient("2001:db8:5:7::1").ipv6Network64,
    );
  });

  test("every spelling of one IPv6 address is one address", () => {
    const spellings: Array<string> = [
      "2001:db8:5:6::1",
      "2001:DB8:5:6::1",
      "2001:0db8:0005:0006:0000:0000:0000:0001",
      "2001:db8:5:6:0:0:0:1",
    ];

    for (const spelling of spellings) {
      expect(getRateLimitClient(spelling)).toEqual({
        address: "2001:db8:5:6::1",
        ipv6Network64: "2001:db8:5:6::/64",
      });
    }
  });

  test("callers that cannot be placed share one address, with no /64", () => {
    expect(getRateLimitClient("unknown")).toEqual({
      address: "unknown",
      ipv6Network64: null,
    });
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

    expect(getRateLimitClient(first!)).toEqual({
      address: "2001:db8:5:6::1",
      ipv6Network64: "2001:db8:5:6::/64",
    });
    expect(getRateLimitClient(second!)).toEqual({
      address: "2001:db8:5:6::abcd",
      ipv6Network64: "2001:db8:5:6::/64",
    });
  });

  test("an IPv4 address that reached the server IPv4-mapped is that IPv4 address", () => {
    const resolved: string | undefined = resolveClientIp(
      { headers: {}, socket: { remoteAddress: "::ffff:203.0.113.9" } },
      { trustedProxyHops: 0 },
    );

    expect(resolved).toBe("203.0.113.9");
    expect(getRateLimitClient(resolved!)).toEqual({
      address: "203.0.113.9",
      ipv6Network64: null,
    });
    // Handed over as it is, it is still not counted under a shared /64.
    expect(getRateLimitClient("::ffff:203.0.113.9").ipv6Network64).toBeNull();
  });

  test("the caller's own X-Forwarded-For entries name no client", () => {
    // Only the entry our proxy appended is read; the /64 is that entry's.
    const resolved: string | undefined = resolveClientIp(
      requestFrom("2001:db8:aaaa:1::1, 2001:db8:5:6::99"),
      { trustedProxyHops: 1 },
    );

    expect(getRateLimitClient(resolved!)).toEqual({
      address: "2001:db8:5:6::99",
      ipv6Network64: "2001:db8:5:6::/64",
    });
  });
});
