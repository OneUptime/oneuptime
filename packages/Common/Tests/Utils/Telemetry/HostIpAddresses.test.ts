import {
  MAX_HOST_IP_ADDRESSES_LENGTH,
  MAX_HOST_IP_ADDRESS_COUNT,
  normalizeHostIpAddresses,
} from "../../../Utils/Telemetry/HostIpAddresses";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression suite for issue #3006. The OTel `host.ip` resource attribute
 * is an array of every address on every interface, and a Docker host with
 * IPv6 enabled reports one entry per bridge, per veth and per link-local.
 * The reporter's host produced 55 addresses / ~1454 characters, which
 * overflowed the then-varchar(500) Host.hostIpAddresses column and aborted
 * the whole Host metadata write.
 */

/** Rebuilds the exact shape reported in the issue: 55 addresses. */
function issueReporterAddresses(): Array<string> {
  const addresses: Array<string> = [];

  // 1 LAN IPv4.
  addresses.push("192.168.1.42");

  // 11 Docker bridge IPv4 addresses.
  for (let i: number = 0; i < 11; i++) {
    addresses.push(`172.${17 + i}.0.1`);
  }

  // 36 IPv6 link-local addresses.
  for (let i: number = 0; i < 36; i++) {
    addresses.push(`fe80::42:acff:fe11:${(0x1000 + i).toString(16)}`);
  }

  // 7 IPv6 ULA addresses.
  for (let i: number = 0; i < 7; i++) {
    addresses.push(`fd00:dead:beef:${i}::1`);
  }

  return addresses;
}

describe("normalizeHostIpAddresses", () => {
  describe("empty and absent input", () => {
    test("returns null for undefined", () => {
      expect(normalizeHostIpAddresses(undefined)).toBeNull();
    });

    test("returns null for null", () => {
      expect(normalizeHostIpAddresses(null)).toBeNull();
    });

    test("returns null for an empty array", () => {
      expect(normalizeHostIpAddresses([])).toBeNull();
    });

    test("returns null when every entry is blank", () => {
      expect(normalizeHostIpAddresses(["", "   ", "\t", "\n"])).toBeNull();
    });

    test("returns null rather than an empty string, so callers leave the column untouched", () => {
      // An empty string would overwrite a previously discovered list with "".
      expect(normalizeHostIpAddresses(["  "])).not.toBe("");
    });
  });

  describe("basic joining", () => {
    test("joins with ', ' to match the stored format", () => {
      expect(normalizeHostIpAddresses(["192.168.1.42", "10.0.0.5"])).toBe(
        "192.168.1.42, 10.0.0.5",
      );
    });

    test("returns a single address unchanged", () => {
      expect(normalizeHostIpAddresses(["10.0.0.5"])).toBe("10.0.0.5");
    });

    test("trims surrounding whitespace on each entry", () => {
      expect(normalizeHostIpAddresses(["  10.0.0.5 ", "\t::1\n"])).toBe(
        "10.0.0.5, ::1",
      );
    });

    test("drops blank entries but keeps the rest", () => {
      expect(normalizeHostIpAddresses(["10.0.0.5", "", "  ", "::1"])).toBe(
        "10.0.0.5, ::1",
      );
    });

    test("preserves source order", () => {
      const ips: Array<string> = ["203.0.113.9", "10.0.0.5", "192.168.1.42"];
      expect(normalizeHostIpAddresses(ips)).toBe(
        "203.0.113.9, 10.0.0.5, 192.168.1.42",
      );
    });
  });

  describe("deduplication", () => {
    test("removes exact duplicates", () => {
      expect(
        normalizeHostIpAddresses(["10.0.0.5", "10.0.0.5", "10.0.0.5"]),
      ).toBe("10.0.0.5");
    });

    test("removes duplicates that differ only in IPv6 hex casing", () => {
      /*
       * Resource detectors disagree on IPv6 casing, so the same address can
       * arrive twice in one batch in two different cases.
       */
      expect(normalizeHostIpAddresses(["FE80::1", "fe80::1"])).toBe("FE80::1");
    });

    test("removes duplicates that differ only in surrounding whitespace", () => {
      expect(normalizeHostIpAddresses(["10.0.0.5", " 10.0.0.5  "])).toBe(
        "10.0.0.5",
      );
    });

    test("keeps the first-seen spelling of a duplicate", () => {
      expect(normalizeHostIpAddresses(["fe80::AB", "FE80::ab"])).toBe(
        "fe80::AB",
      );
    });

    test("dedupes without disturbing the order of the survivors", () => {
      expect(
        normalizeHostIpAddresses(["a::1", "b::1", "A::1", "c::1", "B::1"]),
      ).toBe("a::1, b::1, c::1");
    });
  });

  describe("non-string entries", () => {
    test("skips values that are not strings", () => {
      const ips: Array<string> = [
        "10.0.0.5",
        // Defensive: the OTLP payload is untrusted JSON.
        null as unknown as string,
        undefined as unknown as string,
        42 as unknown as string,
        {} as unknown as string,
        "::1",
      ];
      expect(normalizeHostIpAddresses(ips)).toBe("10.0.0.5, ::1");
    });

    test("returns null when every entry is a non-string", () => {
      const ips: Array<string> = [
        null as unknown as string,
        7 as unknown as string,
      ];
      expect(normalizeHostIpAddresses(ips)).toBeNull();
    });
  });

  describe("the issue #3006 payload", () => {
    const addresses: Array<string> = issueReporterAddresses();

    test("the fixture reproduces the reported shape", () => {
      expect(addresses).toHaveLength(55);
      expect(addresses.join(", ").length).toBeGreaterThan(1000);
    });

    test("is stored in full — every address survives", () => {
      const result: string = normalizeHostIpAddresses(addresses) as string;
      expect(result.split(", ")).toHaveLength(55);
      for (const address of addresses) {
        expect(result).toContain(address);
      }
    });

    test("exceeds the old varchar(500) bound, which is why the column is now text", () => {
      const result: string = normalizeHostIpAddresses(addresses) as string;
      expect(result.length).toBeGreaterThan(500);
    });
  });

  describe("count cap", () => {
    function manyAddresses(count: number): Array<string> {
      return Array.from({ length: count }, (_unused: unknown, i: number) => {
        return `10.${Math.floor(i / 256)}.${i % 256}.1`;
      });
    }

    test("keeps everything below the cap", () => {
      const ips: Array<string> = manyAddresses(MAX_HOST_IP_ADDRESS_COUNT - 1);
      const result: string = normalizeHostIpAddresses(ips) as string;
      expect(result.split(", ")).toHaveLength(MAX_HOST_IP_ADDRESS_COUNT - 1);
    });

    test("keeps exactly the cap when handed exactly the cap", () => {
      const ips: Array<string> = manyAddresses(MAX_HOST_IP_ADDRESS_COUNT);
      const result: string = normalizeHostIpAddresses(ips) as string;
      expect(result.split(", ")).toHaveLength(MAX_HOST_IP_ADDRESS_COUNT);
    });

    test("caps a pathological collector at the maximum count", () => {
      const ips: Array<string> = manyAddresses(MAX_HOST_IP_ADDRESS_COUNT * 4);
      const result: string = normalizeHostIpAddresses(ips) as string;
      expect(result.split(", ")).toHaveLength(MAX_HOST_IP_ADDRESS_COUNT);
    });

    test("the addresses kept when capping are the first ones reported", () => {
      const ips: Array<string> = manyAddresses(MAX_HOST_IP_ADDRESS_COUNT + 10);
      const result: string = normalizeHostIpAddresses(ips) as string;
      expect(result.startsWith(ips[0] as string)).toBe(true);
      expect(result).not.toContain(ips[MAX_HOST_IP_ADDRESS_COUNT] as string);
    });

    test("duplicates do not consume cap slots", () => {
      const ips: Array<string> = [
        ...manyAddresses(10),
        ...manyAddresses(10),
        ...manyAddresses(10),
      ];
      const result: string = normalizeHostIpAddresses(ips) as string;
      expect(result.split(", ")).toHaveLength(10);
    });
  });

  describe("length cap", () => {
    function longAddresses(count: number): Array<string> {
      // 39 characters each — a fully expanded IPv6 address.
      return Array.from({ length: count }, (_unused: unknown, i: number) => {
        return `2001:0db8:0000:0000:0000:ff00:0042:${(0x1000 + i).toString(16)}`;
      });
    }

    test("never exceeds the serialized length cap", () => {
      const ips: Array<string> = longAddresses(MAX_HOST_IP_ADDRESS_COUNT);
      const result: string = normalizeHostIpAddresses(ips) as string;
      expect(result.length).toBeLessThanOrEqual(MAX_HOST_IP_ADDRESSES_LENGTH);
    });

    test("truncates whole addresses only — never a partial one", () => {
      const ips: Array<string> = longAddresses(MAX_HOST_IP_ADDRESS_COUNT);
      const result: string = normalizeHostIpAddresses(ips) as string;
      for (const part of result.split(", ")) {
        expect(ips).toContain(part);
      }
    });

    test("a single address longer than the whole cap is dropped, not clipped", () => {
      const huge: string = "a".repeat(MAX_HOST_IP_ADDRESSES_LENGTH + 1);
      expect(normalizeHostIpAddresses([huge])).toBeNull();
    });

    test("a huge first entry does not suppress the entries after it being considered", () => {
      /*
       * The scan stops at the first entry that would overflow, so a huge
       * leading entry costs the rest of the list. That is deliberate — but
       * pin it so the behavior is a decision, not an accident.
       */
      const huge: string = "a".repeat(MAX_HOST_IP_ADDRESSES_LENGTH + 1);
      expect(normalizeHostIpAddresses([huge, "10.0.0.5"])).toBeNull();
      expect(normalizeHostIpAddresses(["10.0.0.5", huge])).toBe("10.0.0.5");
    });

    test("the separator counts toward the cap", () => {
      // Two entries that only fit if the ", " between them is ignored.
      const half: number = Math.floor(MAX_HOST_IP_ADDRESSES_LENGTH / 2);
      const a: string = "a".repeat(half);
      const b: string = "b".repeat(MAX_HOST_IP_ADDRESSES_LENGTH - half);
      const result: string = normalizeHostIpAddresses([a, b]) as string;
      expect(result).toBe(a);
      expect(result.length).toBeLessThanOrEqual(MAX_HOST_IP_ADDRESSES_LENGTH);
    });
  });

  describe("caps are sane", () => {
    test("the length cap comfortably clears the reported 55-address payload", () => {
      expect(MAX_HOST_IP_ADDRESSES_LENGTH).toBeGreaterThan(
        issueReporterAddresses().join(", ").length * 2,
      );
    });

    test("the count cap comfortably clears the reported 55-address payload", () => {
      expect(MAX_HOST_IP_ADDRESS_COUNT).toBeGreaterThan(55 * 2);
    });
  });

  describe("idempotence", () => {
    test("re-normalizing an already-normalized list is a no-op", () => {
      const once: string = normalizeHostIpAddresses(
        issueReporterAddresses(),
      ) as string;
      const twice: string = normalizeHostIpAddresses(
        once.split(", "),
      ) as string;
      expect(twice).toBe(once);
    });
  });
});
