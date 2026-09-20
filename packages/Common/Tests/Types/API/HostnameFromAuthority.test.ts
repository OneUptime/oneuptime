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
 * fromString() used not to be a substitute: it split on the FIRST colon,
 * which mangled every IPv6 literal. It now delegates IPv6 authorities here
 * instead, so the two agree on addresses; they still differ on a DNS host,
 * where fromString keeps its own splitting and its own userinfo handling.
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
    test("fromString now agrees with fromAuthority on an IPv6 literal", () => {
      /*
       * This case used to be pinned the other way round: fromString split on
       * the FIRST colon, so "[::1]:8443" became a host of "[" and the setter
       * threw. Worse, the unbracketed spelling did NOT throw -- it returned
       * host "2001" / port 518 for "2001:518:2800:9::2" and a monitor was
       * saved pointing at a host nobody typed.
       *
       * fromString delegates IPv6 authorities to fromAuthority now, so the
       * two agree. Kept as a contrast test so a future 'simplification' that
       * reintroduces the split fails here.
       */
      expect(Hostname.fromAuthority("[::1]:8443").hostname).toBe("[::1]");
      expect(Hostname.fromString("[::1]:8443").hostname).toBe("[::1]");
      expect(Hostname.fromString("[::1]:8443").port?.toNumber()).toBe(8443);

      expect(Hostname.fromString("2001:518:2800:9::2").hostname).toBe(
        "2001:518:2800:9::2",
      );
      expect(Hostname.fromString("2001:518:2800:9::2").port).toBeUndefined();
    });

    test("both agree on the simple host:port case", () => {
      expect(Hostname.fromAuthority("example.com:8443").hostname).toBe(
        Hostname.fromString("example.com:8443").hostname,
      );
    });
  });
});
