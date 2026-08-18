import Hostname from "../../../Types/API/Hostname";
import { describe, expect, test } from "@jest/globals";

/*
 * Hostname.fromAuthority splits a URL authority into a bare host and a real
 * Port. It exists because URL.fromString hands the WHOLE authority to the
 * Hostname constructor, so `URL.fromString("https://example.com:8443/")`
 * yields a hostname of "example.com:8443" and no port at all.
 *
 * Anything that reads the structured accessors rather than toString() then
 * dials a host that does not exist. The SSL Certificate Monitor is one such
 * consumer, which is why a monitor on a non-443 port could never connect —
 * see https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * fromString() is NOT a substitute: it splits on the FIRST colon, which
 * mangles every IPv6 literal.
 */
describe("Hostname.fromAuthority", () => {
  describe("host and port", () => {
    test("splits a trailing port off the host", () => {
      const hostname: Hostname = Hostname.fromAuthority("example.com:8443");

      expect(hostname.hostname).toBe("example.com");
      expect(hostname.port?.toNumber()).toBe(8443);
    });

    test("leaves a bare host without a port", () => {
      const hostname: Hostname = Hostname.fromAuthority("example.com");

      expect(hostname.hostname).toBe("example.com");
      expect(hostname.port).toBeUndefined();
    });

    test("handles localhost with a port", () => {
      const hostname: Hostname = Hostname.fromAuthority("localhost:5000");

      expect(hostname.hostname).toBe("localhost");
      expect(hostname.port?.toNumber()).toBe(5000);
    });

    test("handles an IPv4 literal with a port", () => {
      const hostname: Hostname = Hostname.fromAuthority("127.0.0.1:8443");

      expect(hostname.hostname).toBe("127.0.0.1");
      expect(hostname.port?.toNumber()).toBe(8443);
    });

    test("round-trips back to the original authority", () => {
      expect(Hostname.fromAuthority("example.com:8443").toString()).toBe(
        "example.com:8443",
      );
      expect(Hostname.fromAuthority("example.com").toString()).toBe(
        "example.com",
      );
    });
  });

  describe("IPv6 literals", () => {
    test("keeps a bracketed IPv6 address intact and takes its port", () => {
      const hostname: Hostname = Hostname.fromAuthority("[::1]:8443");

      expect(hostname.hostname).toBe("[::1]");
      expect(hostname.port?.toNumber()).toBe(8443);
    });

    test("keeps a bracketed IPv6 address with no port intact", () => {
      const hostname: Hostname = Hostname.fromAuthority("[::1]");

      expect(hostname.hostname).toBe("[::1]");
      expect(hostname.port).toBeUndefined();
    });

    test("does not split an unbracketed IPv6 literal", () => {
      /*
       * Two or more colons cannot be a host:port, so every colon belongs to
       * the address. fromString would have returned a host of "2001".
       */
      const hostname: Hostname = Hostname.fromAuthority("2001:db8::1");

      expect(hostname.hostname).toBe("2001:db8::1");
      expect(hostname.port).toBeUndefined();
    });

    test("a full bracketed IPv6 address survives with its port", () => {
      const hostname: Hostname = Hostname.fromAuthority(
        "[2001:db8::8a2e:370:7334]:9000",
      );

      expect(hostname.hostname).toBe("[2001:db8::8a2e:370:7334]");
      expect(hostname.port?.toNumber()).toBe(9000);
    });
  });

  describe("userinfo", () => {
    test("drops userinfo and keeps the host", () => {
      const hostname: Hostname = Hostname.fromAuthority(
        "user:token@hooks.example.com",
      );

      expect(hostname.hostname).toBe("hooks.example.com");
      expect(hostname.port).toBeUndefined();
    });

    test("drops userinfo and keeps host and port", () => {
      const hostname: Hostname = Hostname.fromAuthority(
        "user:token@example.com:8443",
      );

      expect(hostname.hostname).toBe("example.com");
      expect(hostname.port?.toNumber()).toBe(8443);
    });

    test("splits on the LAST @, since userinfo may contain one", () => {
      const hostname: Hostname = Hostname.fromAuthority(
        "user@name:token@example.com:8443",
      );

      expect(hostname.hostname).toBe("example.com");
      expect(hostname.port?.toNumber()).toBe(8443);
    });
  });

  describe("malformed input", () => {
    test("an empty authority yields an empty hostname rather than throwing", () => {
      expect(Hostname.fromAuthority("").hostname).toBe("");
    });

    test("a trailing colon with no digits is not treated as a port", () => {
      const hostname: Hostname = Hostname.fromAuthority("example.com:");

      expect(hostname.hostname).toBe("example.com");
      expect(hostname.port).toBeUndefined();
    });

    test("surrounding whitespace is trimmed", () => {
      const hostname: Hostname = Hostname.fromAuthority("  example.com:443  ");

      expect(hostname.hostname).toBe("example.com");
      expect(hostname.port?.toNumber()).toBe(443);
    });
  });

  describe("contrast with fromString", () => {
    test("fromString rejects an IPv6 literal that fromAuthority handles", () => {
      /*
       * Pinned deliberately: it documents WHY fromAuthority exists, and
       * guards against someone 'simplifying' one into the other.
       *
       * fromString splits on the FIRST colon, so "[::1]:8443" becomes a
       * host of "[" - which the Hostname setter rejects outright.
       */
      expect(Hostname.fromAuthority("[::1]:8443").hostname).toBe("[::1]");
      expect(() => {
        return Hostname.fromString("[::1]:8443");
      }).toThrow();
    });

    test("both agree on the simple host:port case", () => {
      expect(Hostname.fromAuthority("example.com:8443").hostname).toBe(
        Hostname.fromString("example.com:8443").hostname,
      );
    });
  });
});
