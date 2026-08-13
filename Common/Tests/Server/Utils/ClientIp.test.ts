import { TrustedProxyHops } from "../../../Server/EnvironmentConfig";
import {
  ClientIpRequestLike,
  normalizeIpCandidate,
  resolveClientIp,
} from "../../../Server/Utils/ClientIp";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * The header these tests keep building is the one our Nginx produces:
 * `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` KEEPS whatever
 * the caller sent and appends the address it saw. So for a caller who sends
 * nothing, the app sees ["<caller>"]; for a caller who sends "9.9.9.9", the app
 * sees ["9.9.9.9", "<caller>"]. Everything left of the last entry is the
 * caller's own writing.
 */

const ALLOWLISTED: string = "203.0.113.7";
const ATTACKER: string = "198.51.100.5";

type BuildRequestFunction = (options?: {
  forwardedFor?: string | Array<string> | undefined;
  remoteAddress?: string | undefined;
  ip?: string | undefined;
}) => ClientIpRequestLike;

const buildRequest: BuildRequestFunction = (options?: {
  forwardedFor?: string | Array<string> | undefined;
  remoteAddress?: string | undefined;
  ip?: string | undefined;
}): ClientIpRequestLike => {
  const headers: Record<string, string | Array<string>> = {};

  if (options?.forwardedFor !== undefined) {
    headers["x-forwarded-for"] = options.forwardedFor;
  }

  return {
    headers,
    socket: { remoteAddress: options?.remoteAddress },
    ip: options?.ip,
  } as unknown as ClientIpRequestLike;
};

/*
 * What Nginx hands the app for a caller at `peer` who sent `spoofed` in their
 * own X-Forwarded-For.
 */
type ForwardedByNginxFunction = (
  peer: string,
  spoofed?: string | undefined,
) => string;

const forwardedByNginx: ForwardedByNginxFunction = (
  peer: string,
  spoofed?: string | undefined,
): string => {
  return spoofed === undefined ? peer : `${spoofed}, ${peer}`;
};

describe("resolveClientIp", () => {
  describe("the spoofing bypass", () => {
    it("ignores a caller-supplied entry that names an allowlisted address", () => {
      /*
       * The advisory's exact request: attacker sends
       * `X-Forwarded-For: 203.0.113.7`, Nginx appends their real address.
       * Reading the left of that header returns the allowlisted value and the
       * IP control is gone.
       */
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: forwardedByNginx(ATTACKER, ALLOWLISTED),
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe(ATTACKER);
      expect(resolveClientIp(req, { trustedProxyHops: 1 })).not.toBe(
        ALLOWLISTED,
      );
    });

    it("ignores a whole forged chain, however long", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `${ALLOWLISTED}, 10.0.0.1, 192.168.1.1, 172.16.0.1, ${ATTACKER}`,
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe(ATTACKER);
    });

    it("cannot be moved by padding the chain with extra entries", () => {
      /*
       * Position is counted from the right, so no amount of caller-supplied
       * prefix shifts the entry we read.
       */
      for (let padding: number = 0; padding < 12; padding++) {
        const prefix: string = Array.from({ length: padding }, () => {
          return ALLOWLISTED;
        }).join(", ");

        const req: ClientIpRequestLike = buildRequest({
          forwardedFor: forwardedByNginx(
            ATTACKER,
            padding === 0 ? undefined : prefix,
          ),
        });

        expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe(ATTACKER);
      }
    });

    it("ignores a forged entry appended to the right of a repeated header", () => {
      /*
       * Node joins repeated headers in wire order, so a caller who sends the
       * header twice still lands entirely to the left of the Nginx entry.
       */
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: [ALLOWLISTED, `${ALLOWLISTED}, ${ATTACKER}`],
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe(ATTACKER);
    });

    it("does not let a trailing comma slide a forged entry into position", () => {
      /*
       * A caller sending "203.0.113.7," makes Nginx produce
       * "203.0.113.7,, 198.51.100.5" -- an empty entry in the middle. The
       * rightmost entry is still theirs.
       */
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `${ALLOWLISTED},, ${ATTACKER}`,
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe(ATTACKER);
    });

    it("fails closed rather than reading further left when the trusted entry is junk", () => {
      /*
       * If the entry at the trusted position does not parse we return nothing
       * -- walking left to find something parseable would walk straight into
       * caller-supplied data.
       */
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `${ALLOWLISTED}, unknown`,
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBeUndefined();
    });

    it("fails closed when the trusted position holds an empty entry", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `${ALLOWLISTED}, `,
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBeUndefined();
    });
  });

  describe("the ordinary case", () => {
    it("returns the address Nginx appended for an honest caller", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: forwardedByNginx(ALLOWLISTED),
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe(ALLOWLISTED);
    });

    it("tolerates whitespace around entries", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `  ${ATTACKER}  ,   ${ALLOWLISTED}   `,
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe(ALLOWLISTED);
    });

    it("uses the transport peer when there is no X-Forwarded-For", () => {
      const req: ClientIpRequestLike = buildRequest({
        remoteAddress: "10.1.2.3",
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe("10.1.2.3");
    });

    it("uses the transport peer when X-Forwarded-For is present but empty", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: "   ",
        remoteAddress: "10.1.2.3",
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe("10.1.2.3");
    });

    it("falls back to req.ip when there is no socket address", () => {
      const req: ClientIpRequestLike = buildRequest({ ip: "10.1.2.3" });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe("10.1.2.3");
    });

    it("returns undefined when nothing identifies the caller", () => {
      expect(
        resolveClientIp(buildRequest(), { trustedProxyHops: 1 }),
      ).toBeUndefined();
    });

    it("returns undefined for a request with no headers object at all", () => {
      expect(
        resolveClientIp({} as unknown as ClientIpRequestLike, {
          trustedProxyHops: 1,
        }),
      ).toBeUndefined();
    });
  });

  describe("hop counts", () => {
    it("reads one further left for each additional trusted proxy", () => {
      /*
       * Client -> CDN -> Nginx -> app. The CDN appends the client, Nginx
       * appends the CDN, so the client sits second from the right.
       */
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `${ATTACKER}, ${ALLOWLISTED}, 172.16.0.9`,
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe("172.16.0.9");
      expect(resolveClientIp(req, { trustedProxyHops: 2 })).toBe(ALLOWLISTED);
      expect(resolveClientIp(req, { trustedProxyHops: 3 })).toBe(ATTACKER);
    });

    it("ignores X-Forwarded-For entirely at zero hops", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `${ALLOWLISTED}, ${ATTACKER}`,
        remoteAddress: "10.1.2.3",
      });

      expect(resolveClientIp(req, { trustedProxyHops: 0 })).toBe("10.1.2.3");
    });

    it("uses the peer, not the header, when the chain is shorter than the hop count", () => {
      /*
       * The request did not traverse the proxies we expect -- a direct call to
       * the app port, or a misconfigured deployment. Nothing in the header is
       * corroborated by a proxy of ours, so none of it is used.
       */
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: ALLOWLISTED,
        remoteAddress: "10.1.2.3",
      });

      expect(resolveClientIp(req, { trustedProxyHops: 2 })).toBe("10.1.2.3");
      expect(resolveClientIp(req, { trustedProxyHops: 5 })).toBe("10.1.2.3");
    });

    it("treats a negative or fractional hop count as zero hops", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `${ALLOWLISTED}, ${ATTACKER}`,
        remoteAddress: "10.1.2.3",
      });

      expect(resolveClientIp(req, { trustedProxyHops: -1 })).toBe("10.1.2.3");
      expect(resolveClientIp(req, { trustedProxyHops: NaN })).toBe("10.1.2.3");
      expect(resolveClientIp(req, { trustedProxyHops: Infinity })).toBe(
        "10.1.2.3",
      );
    });

    it("uses the configured hop count when no option is given", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: forwardedByNginx(ATTACKER, ALLOWLISTED),
      });

      expect(resolveClientIp(req)).toBe(
        resolveClientIp(req, { trustedProxyHops: TrustedProxyHops }),
      );
    });
  });

  describe("TRUSTED_PROXY_HOPS", () => {
    /*
     * The config is read at module load, so each case re-imports the module
     * with a different environment.
     */
    type LoadHopsFunction = (rawValue: string | undefined) => Promise<number>;

    const loadHops: LoadHopsFunction = async (
      rawValue: string | undefined,
    ): Promise<number> => {
      const previous: string | undefined = process.env["TRUSTED_PROXY_HOPS"];

      if (rawValue === undefined) {
        delete process.env["TRUSTED_PROXY_HOPS"];
      } else {
        process.env["TRUSTED_PROXY_HOPS"] = rawValue;
      }

      jest.resetModules();

      const reloaded: { TrustedProxyHops: number } = (await import(
        "../../../Server/EnvironmentConfig"
      )) as unknown as { TrustedProxyHops: number };

      const loaded: number = reloaded.TrustedProxyHops;

      if (previous === undefined) {
        delete process.env["TRUSTED_PROXY_HOPS"];
      } else {
        process.env["TRUSTED_PROXY_HOPS"] = previous;
      }

      return loaded;
    };

    it("defaults to the one Nginx every shipped topology puts in front", async () => {
      expect(await loadHops(undefined)).toBe(1);
      expect(await loadHops("")).toBe(1);
      expect(await loadHops("   ")).toBe(1);
    });

    it("accepts a whole non-negative count", async () => {
      expect(await loadHops("0")).toBe(0);
      expect(await loadHops("1")).toBe(1);
      expect(await loadHops("2")).toBe(2);
      expect(await loadHops(" 3 ")).toBe(3);
    });

    it("falls back to the shipped topology on a nonsense value", async () => {
      /*
       * Deliberately NOT 0: falling back to 0 would attribute every request
       * to the gateway's own address, which does not deny access so much as
       * make every allowlist meaningless.
       */
      expect(await loadHops("banana")).toBe(1);
      expect(await loadHops("-1")).toBe(1);
      expect(await loadHops("1.5")).toBe(1);
      expect(await loadHops("Infinity")).toBe(1);
    });
  });

  describe("address shapes", () => {
    it("unwraps the IPv4-mapped IPv6 form Node reports on a dual-stack socket", () => {
      /*
       * Left as ::ffff:10.1.2.3 this would never match an IPv4 allowlist
       * entry or a CIDR rule.
       */
      const req: ClientIpRequestLike = buildRequest({
        remoteAddress: "::ffff:10.1.2.3",
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe("10.1.2.3");
    });

    it("strips a port from an IPv4 entry", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: `${ALLOWLISTED}:51234`,
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe(ALLOWLISTED);
    });

    it("strips brackets and port from an IPv6 entry", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: "[2001:db8::1]:443",
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe("2001:db8::1");
    });

    it("returns a bare IPv6 address unchanged", () => {
      const req: ClientIpRequestLike = buildRequest({
        forwardedFor: "2001:db8::1",
      });

      expect(resolveClientIp(req, { trustedProxyHops: 1 })).toBe("2001:db8::1");
    });
  });
});

describe("normalizeIpCandidate", () => {
  it("accepts plain addresses", () => {
    expect(normalizeIpCandidate("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIpCandidate("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIpCandidate("::1")).toBe("::1");
  });

  it("trims whitespace and stray quotes", () => {
    expect(normalizeIpCandidate('  "203.0.113.7"  ')).toBe("203.0.113.7");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIpCandidate("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIpCandidate("::FFFF:203.0.113.7")).toBe("203.0.113.7");
  });

  it("keeps an IPv6 address that merely starts with ::ffff but is not IPv4-mapped", () => {
    expect(normalizeIpCandidate("::ffff:1:2:3")).toBe("::ffff:1:2:3");
  });

  it("strips ports", () => {
    expect(normalizeIpCandidate("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIpCandidate("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIpCandidate("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("rejects values that are not addresses", () => {
    /*
     * `unknown` is Nginx's placeholder; `_hidden` and `unknown` are RFC 7239
     * obfuscated identifiers. None of them is an address, and none of them
     * may be returned to a caller that is about to make an access decision.
     */
    expect(normalizeIpCandidate("unknown")).toBeNull();
    expect(normalizeIpCandidate("_hidden")).toBeNull();
    expect(normalizeIpCandidate("localhost")).toBeNull();
    expect(normalizeIpCandidate("203.0.113.999")).toBeNull();
    expect(normalizeIpCandidate("203.0.113")).toBeNull();
    expect(normalizeIpCandidate("not an ip")).toBeNull();
    expect(normalizeIpCandidate("")).toBeNull();
    expect(normalizeIpCandidate("   ")).toBeNull();
    expect(normalizeIpCandidate(undefined)).toBeNull();
    expect(normalizeIpCandidate(null)).toBeNull();
  });

  it("rejects an absurdly long value without trying to parse it", () => {
    expect(normalizeIpCandidate(":".repeat(5000))).toBeNull();
    expect(normalizeIpCandidate(`${"0".repeat(100)}203.0.113.7`)).toBeNull();
  });

  it("accepts the longest real address", () => {
    expect(normalizeIpCandidate("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    );
  });

  it("rejects a string that merely contains an address", () => {
    /*
     * IP.isIPv6's pattern is unanchored, so a substring would satisfy it on
     * its own. The character-class guard is what stops that.
     */
    expect(normalizeIpCandidate("evil 2001:db8::1 evil")).toBeNull();
    expect(normalizeIpCandidate("x2001:db8::1")).toBeNull();
    expect(normalizeIpCandidate("2001:db8::1/64")).toBeNull();
  });
});
