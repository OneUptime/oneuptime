import BadDataException from "../../../Types/Exception/BadDataException";
import IP from "../../../Types/IP/IP";
import { describe, expect, it } from "@jest/globals";

describe("IP.isInWhitelist", () => {
  describe("single-address contract", () => {
    /*
     * This used to take an array and return true if ANY member matched.
     * Callers fed it a whole X-Forwarded-For chain, and because a caller
     * writes the left-hand end of that header themselves, "any member
     * matches" meant "the caller names the address". Taking one address is
     * what makes the check mean anything.
     */
    it("checks exactly the address it is given", () => {
      expect(
        IP.isInWhitelist({
          ip: "198.51.100.5",
          whitelist: ["203.0.113.7"],
        }),
      ).toBe(false);

      expect(
        IP.isInWhitelist({
          ip: "203.0.113.7",
          whitelist: ["203.0.113.7"],
        }),
      ).toBe(true);
    });

    it("cannot be handed a chain", () => {
      /*
       * A chain is not an address, so the old bypass input is now rejected
       * outright rather than quietly matching on its first entry.
       */
      expect(() => {
        return IP.isInWhitelist({
          ip: "203.0.113.7, 198.51.100.5",
          whitelist: ["203.0.113.7"],
        });
      }).toThrow(BadDataException);
    });
  });

  describe("exact matches", () => {
    it("matches an IPv4 entry", () => {
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["10.0.0.1"] }),
      ).toBe(true);
    });

    it("matches an IPv6 entry", () => {
      expect(
        IP.isInWhitelist({ ip: "2001:db8::1", whitelist: ["2001:db8::1"] }),
      ).toBe(true);
    });

    it("does not match a different address", () => {
      expect(
        IP.isInWhitelist({ ip: "10.0.0.2", whitelist: ["10.0.0.1"] }),
      ).toBe(false);
    });

    it("finds the entry wherever it sits in the list", () => {
      expect(
        IP.isInWhitelist({
          ip: "10.0.0.3",
          whitelist: ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"],
        }),
      ).toBe(true);
    });

    it("tolerates surrounding whitespace on an entry", () => {
      /*
       * Entries come from splitting a textarea on newlines, so a trailing
       * \r or a stray space is routine.
       */
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["  10.0.0.1  "] }),
      ).toBe(true);
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["10.0.0.1\r"] }),
      ).toBe(true);
    });
  });

  describe("CIDR ranges", () => {
    it("matches an address inside the range", () => {
      expect(
        IP.isInWhitelist({ ip: "10.4.5.6", whitelist: ["10.0.0.0/8"] }),
      ).toBe(true);
      expect(
        IP.isInWhitelist({ ip: "192.168.1.55", whitelist: ["192.168.1.0/24"] }),
      ).toBe(true);
    });

    it("does not match an address outside the range", () => {
      expect(
        IP.isInWhitelist({ ip: "11.4.5.6", whitelist: ["10.0.0.0/8"] }),
      ).toBe(false);
      expect(
        IP.isInWhitelist({ ip: "192.168.2.55", whitelist: ["192.168.1.0/24"] }),
      ).toBe(false);
    });

    it("handles the boundaries of a range", () => {
      expect(
        IP.isInWhitelist({ ip: "192.168.1.0", whitelist: ["192.168.1.0/24"] }),
      ).toBe(true);
      expect(
        IP.isInWhitelist({
          ip: "192.168.1.255",
          whitelist: ["192.168.1.0/24"],
        }),
      ).toBe(true);
      expect(
        IP.isInWhitelist({
          ip: "192.168.0.255",
          whitelist: ["192.168.1.0/24"],
        }),
      ).toBe(false);
      expect(
        IP.isInWhitelist({ ip: "192.168.2.0", whitelist: ["192.168.1.0/24"] }),
      ).toBe(false);
    });

    it("treats /32 as an exact match", () => {
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["10.0.0.1/32"] }),
      ).toBe(true);
      expect(
        IP.isInWhitelist({ ip: "10.0.0.2", whitelist: ["10.0.0.1/32"] }),
      ).toBe(false);
    });

    it("never matches an IPv6 address against an IPv4 CIDR", () => {
      expect(
        IP.isInWhitelist({ ip: "2001:db8::1", whitelist: ["0.0.0.0/1"] }),
      ).toBe(false);
    });

    it("skips malformed CIDR entries instead of matching on them", () => {
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["10.0.0.0/"] }),
      ).toBe(false);
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["10.0.0.0/33"] }),
      ).toBe(false);
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["10.0.0.0/abc"] }),
      ).toBe(false);
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["not-an-ip/8"] }),
      ).toBe(false);
    });

    it("keeps checking later entries after a malformed one", () => {
      expect(
        IP.isInWhitelist({
          ip: "10.0.0.1",
          whitelist: ["10.0.0.0/99", "", "10.0.0.1"],
        }),
      ).toBe(true);
    });
  });

  describe("empty and invalid input", () => {
    it("denies when the allowlist is empty", () => {
      expect(IP.isInWhitelist({ ip: "10.0.0.1", whitelist: [] })).toBe(false);
    });

    it("denies when the allowlist holds only blank entries", () => {
      expect(
        IP.isInWhitelist({ ip: "10.0.0.1", whitelist: ["", "   ", "\n"] }),
      ).toBe(false);
    });

    it("throws rather than guessing when the address is not an address", () => {
      /*
       * Callers making an access decision treat a throw as a denial; the
       * services wrap this in a fail-closed catch.
       */
      for (const notAnIp of ["unknown", "", "10.0.0", "10.0.0.256", "abc"]) {
        expect(() => {
          return IP.isInWhitelist({ ip: notAnIp, whitelist: ["10.0.0.1"] });
        }).toThrow(BadDataException);
      }
    });

    it("checks the empty allowlist before validating the address", () => {
      /*
       * No allowlist means no restriction to evaluate, so an unparseable
       * address is not an error worth raising.
       */
      expect(IP.isInWhitelist({ ip: "unknown", whitelist: [] })).toBe(false);
    });
  });
});
