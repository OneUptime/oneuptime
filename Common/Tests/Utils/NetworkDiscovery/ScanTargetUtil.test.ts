import ScanTargetUtil, {
  ScanTargetNotation,
  ScanTarget,
} from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test: a discovery scan target parses, counts and expands
 * identically wherever it is read — the dashboard form, the server-side
 * create validator, and the probe that actually sweeps it. The two notations
 * have deliberately DIFFERENT address semantics (CIDR excludes network and
 * broadcast; an octet range is an explicit enumeration and excludes nothing),
 * so most of what follows is pinning that difference down.
 */

describe("ScanTargetUtil.getNotation", () => {
  it("reads a prefixed target as CIDR", () => {
    expect(ScanTargetUtil.getNotation("192.168.1.0/24")).toBe(
      ScanTargetNotation.Cidr,
    );
  });

  it("reads a ranged target as an octet range", () => {
    expect(ScanTargetUtil.getNotation("10.16-22.0-255.51-66")).toBe(
      ScanTargetNotation.OctetRange,
    );
  });

  it("reads a bare address as an octet range of one", () => {
    expect(ScanTargetUtil.getNotation("10.0.0.5")).toBe(
      ScanTargetNotation.OctetRange,
    );
  });

  it("returns null for a target in neither notation", () => {
    expect(ScanTargetUtil.getNotation("not-a-target")).toBeNull();
  });

  /*
   * A '/' means the author meant CIDR. Falling back to the octet-range parser
   * would turn a typo'd prefix into the far less useful "not a valid scan
   * target" instead of "that prefix is out of range".
   */
  it("does not retry a malformed CIDR as an octet range", () => {
    expect(ScanTargetUtil.getNotation("10.0.0.0/99")).toBeNull();
    expect(ScanTargetUtil.getValidationError("10.0.0.0/99")).toContain(
      "Prefix length",
    );
  });
});

describe("ScanTargetUtil.countHosts - CIDR", () => {
  it("counts a /24 as 254 usable hosts (excludes network + broadcast)", () => {
    expect(ScanTargetUtil.countHosts("192.168.1.0/24")).toBe(254);
  });

  it("counts a /30 as 2 usable hosts", () => {
    expect(ScanTargetUtil.countHosts("10.0.0.0/30")).toBe(2);
  });

  it("counts /31 and /32 as every address (no network/broadcast exclusion)", () => {
    expect(ScanTargetUtil.countHosts("10.0.0.0/31")).toBe(2);
    expect(ScanTargetUtil.countHosts("10.0.0.5/32")).toBe(1);
  });

  it("counts a /8 as ~16.7M without allocating them", () => {
    /*
     * The whole point of counting arithmetically: this must be derivable from
     * the prefix, not by building the address array.
     */
    expect(ScanTargetUtil.countHosts("10.0.0.0/8")).toBe(Math.pow(2, 24) - 2);
  });

  it("counts a /0 as the whole address space minus network + broadcast", () => {
    expect(ScanTargetUtil.countHosts("0.0.0.0/0")).toBe(Math.pow(2, 32) - 2);
  });

  it("tolerates surrounding whitespace", () => {
    expect(ScanTargetUtil.countHosts("  192.168.1.0/24  ")).toBe(254);
  });

  it("returns 0 for malformed or out-of-range CIDRs", () => {
    expect(ScanTargetUtil.countHosts("not-a-cidr")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.0.0.0/33")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.0.0.0/")).toBe(0);
    expect(ScanTargetUtil.countHosts("/24")).toBe(0);
    expect(ScanTargetUtil.countHosts("999.0.0.0/24")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.0.0/24")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.0.0.0.0/24")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.0.0.0/24/24")).toBe(0);
  });

  it("agrees with expand() for subnets small enough to expand", () => {
    for (const target of [
      "192.168.1.0/29",
      "172.16.5.0/28",
      "10.1.1.0/30",
      "10.1.1.4/31",
      "10.1.1.9/32",
      "10.2.0.0/24",
    ]) {
      expect(ScanTargetUtil.countHosts(target)).toBe(
        ScanTargetUtil.expand(target).length,
      );
    }
  });
});

describe("ScanTargetUtil.countHosts - octet ranges", () => {
  it("counts the product of the four octet widths", () => {
    // 1 x 7 x 256 x 16
    expect(ScanTargetUtil.countHosts("10.16-22.0-255.51-66")).toBe(28672);
    // 1 x 3 x 256 x 16
    expect(ScanTargetUtil.countHosts("10.48-50.0-255.51-66")).toBe(12288);
  });

  it("counts a bare address as one host", () => {
    expect(ScanTargetUtil.countHosts("10.0.0.5")).toBe(1);
  });

  it("counts a single-octet range", () => {
    expect(ScanTargetUtil.countHosts("192.168.1.10-40")).toBe(31);
  });

  it("counts a degenerate range (a-a) as one value for that octet", () => {
    expect(ScanTargetUtil.countHosts("10.5-5.5-5.1-4")).toBe(4);
  });

  /*
   * An octet range enumerates addresses; it has no prefix length, so there is
   * no network or broadcast address to exclude. Whoever wrote 0-255 asked for
   * .0 and .255 by name.
   */
  it("counts every address in the range, including .0 and .255", () => {
    expect(ScanTargetUtil.countHosts("10.0.0.0-255")).toBe(256);
  });

  it("counts a full-width range without allocating it", () => {
    expect(ScanTargetUtil.countHosts("0-255.0-255.0-255.0-255")).toBe(
      Math.pow(256, 4),
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(ScanTargetUtil.countHosts("  10.16-22.0-255.51-66  ")).toBe(28672);
  });

  it("returns 0 for out-of-range octets", () => {
    expect(ScanTargetUtil.countHosts("10.256.0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.0-256.0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("300-400.0.0.1")).toBe(0);
  });

  it("returns 0 for a reversed range", () => {
    expect(ScanTargetUtil.countHosts("10.22-16.0.1")).toBe(0);
  });

  it("returns 0 for the wrong number of octets", () => {
    expect(ScanTargetUtil.countHosts("10.0.0")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.0.0.0.0")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.16-22.0-255")).toBe(0);
    expect(ScanTargetUtil.countHosts("")).toBe(0);
    expect(ScanTargetUtil.countHosts("   ")).toBe(0);
  });

  it("returns 0 for malformed range syntax", () => {
    expect(ScanTargetUtil.countHosts("10.16-.0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.-22.0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.16-22-30.0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.16 - 22.0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.1a.0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("10..0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.0.0.1.")).toBe(0);
    expect(ScanTargetUtil.countHosts(".10.0.0.1")).toBe(0);
    // A negative bound reads as an empty first term, not as -22.
    expect(ScanTargetUtil.countHosts("10.-22--16.0.1")).toBe(0);
  });

  /*
   * Everything is parsed base 10, so a padded octet is the number it looks
   * like and not an octal one. Worth pinning: a target that silently meant
   * 10.8.0.1 instead of 10.10.0.1 would scan the wrong network.
   */
  it("reads zero-padded octets as base 10, never octal", () => {
    expect(ScanTargetUtil.expand("010.010.0.1")).toEqual(["10.10.0.1"]);
    expect(ScanTargetUtil.expand("10.0.0.08-09")).toEqual([
      "10.0.0.8",
      "10.0.0.9",
    ]);
    expect(ScanTargetUtil.countHosts("10.0.0.0/024")).toBe(254);
  });

  /*
   * \d without the u flag is ASCII-only, so digit-lookalikes from other
   * scripts are rejected rather than coerced into some other address.
   */
  it("rejects non-ASCII digit lookalikes", () => {
    expect(ScanTargetUtil.countHosts("１０.0.0.1")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.٠.0.1")).toBe(0);
  });

  it("rejects a very long target without pathological slowdown", () => {
    const started: number = Date.now();
    expect(ScanTargetUtil.countHosts("1".repeat(50000))).toBe(0);
    expect(ScanTargetUtil.countHosts(`10.${"1-".repeat(20000)}2.0.1`)).toBe(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("accepts a target at the length gate and rejects one past it", () => {
    // The widest well-formed target, comfortably inside the gate.
    const widest: string = "255-255.255-255.255-255.255-255";
    expect(widest.length).toBeLessThanOrEqual(ScanTargetUtil.MAX_TARGET_LENGTH);
    expect(ScanTargetUtil.getValidationError(widest)).toBeNull();

    expect(
      ScanTargetUtil.getValidationError(
        "1".repeat(ScanTargetUtil.MAX_TARGET_LENGTH + 1),
      ),
    ).toContain("cannot be longer than");
  });

  /*
   * The length gate exists to bound the ERROR, not just the parse. Every
   * other rejection quotes the target back — parseOctetRange quotes both the
   * bad term and the whole target — and the server-side create hook runs
   * ahead of the column's 100-character cap, so an unbounded echo would let a
   * large request body be amplified into the exception message, the logs and
   * the response body.
   */
  it("does not echo an over-long target back in the error message", () => {
    const huge: string = `1.2.3.${"9".repeat(200000)}`;
    const error: string | null = ScanTargetUtil.getValidationError(huge);

    expect(error).not.toBeNull();
    expect(error).not.toContain("999999");
    // Constant-size message, nowhere near the size of the input.
    expect(error!.length).toBeLessThan(400);
  });

  /*
   * Wildcards are nmap syntax, not ours. Rejecting them is better than
   * accepting a target that means something subtly different to the operator
   * than it does to the scanner.
   */
  it("returns 0 for wildcard and comma-list syntax that is not supported", () => {
    expect(ScanTargetUtil.countHosts("10.16-22.*.51-66")).toBe(0);
    expect(ScanTargetUtil.countHosts("10.1,3,5.0.1")).toBe(0);
  });

  it("agrees with expand() for ranges small enough to expand", () => {
    for (const target of [
      "10.0.0.1-10",
      "10.0.1-3.1-4",
      "192.168.1.1",
      "10.1-2.3-4.5-6",
      "10.0.0.0-255",
    ]) {
      expect(ScanTargetUtil.countHosts(target)).toBe(
        ScanTargetUtil.expand(target).length,
      );
    }
  });
});

describe("ScanTargetUtil.expand - CIDR", () => {
  it("expands a /29 to its 6 usable hosts, in order", () => {
    expect(ScanTargetUtil.expand("192.168.1.0/29")).toEqual([
      "192.168.1.1",
      "192.168.1.2",
      "192.168.1.3",
      "192.168.1.4",
      "192.168.1.5",
      "192.168.1.6",
    ]);
  });

  it("expands /31 and /32 without excluding anything", () => {
    expect(ScanTargetUtil.expand("10.0.0.0/31")).toEqual([
      "10.0.0.0",
      "10.0.0.1",
    ]);
    expect(ScanTargetUtil.expand("10.0.0.5/32")).toEqual(["10.0.0.5"]);
  });

  /*
   * The stored address need not be the network address. Masking it down is
   * what makes "10.0.0.37/24" mean the same subnet as "10.0.0.0/24".
   */
  it("masks a non-network address down to its subnet", () => {
    expect(ScanTargetUtil.expand("192.168.1.37/29")).toEqual(
      ScanTargetUtil.expand("192.168.1.32/29"),
    );
    expect(ScanTargetUtil.expand("192.168.1.37/29")[0]).toBe("192.168.1.33");
  });

  /*
   * A shift by 32 is a no-op in JS, so the /24 mask arithmetic has to be
   * special-cased at the high end. 10.20.30.40/1 must start from 0.0.0.1,
   * not from the address as typed.
   */
  it("masks correctly at wide prefixes where JS shift arithmetic wraps", () => {
    const parsed: ScanTarget | null = ScanTargetUtil.parse("10.20.30.40/1");
    expect(parsed).not.toBeNull();
    expect(parsed!.networkLong).toBe(0);

    const parsedZero: ScanTarget | null = ScanTargetUtil.parse("10.20.30.40/0");
    expect(parsedZero!.networkLong).toBe(0);
  });

  it("expands the last /24 in the space without sign-bit corruption", () => {
    const hosts: Array<string> = ScanTargetUtil.expand("255.255.255.0/24");
    expect(hosts.length).toBe(254);
    expect(hosts[0]).toBe("255.255.255.1");
    expect(hosts[253]).toBe("255.255.255.254");
  });

  /*
   * The largest block that can be expanded, sitting at the very top of the
   * address space: every address here has the sign bit set, so a signed >>
   * anywhere in the arithmetic would show up as a wrong octet.
   */
  it("expands the largest allowed block at the top of the address space", () => {
    const hosts: Array<string> = ScanTargetUtil.expand("255.255.128.0/17");
    expect(hosts.length).toBe(ScanTargetUtil.MAX_SCAN_HOSTS - 2);
    expect(hosts[0]).toBe("255.255.128.1");
    expect(hosts[hosts.length - 1]).toBe("255.255.255.254");
  });

  it("returns an empty array for a malformed CIDR", () => {
    expect(ScanTargetUtil.expand("10.0.0.0/33")).toEqual([]);
    expect(ScanTargetUtil.expand("nope/24")).toEqual([]);
  });
});

describe("ScanTargetUtil.expand - octet ranges", () => {
  it("expands a last-octet range", () => {
    expect(ScanTargetUtil.expand("192.168.1.10-13")).toEqual([
      "192.168.1.10",
      "192.168.1.11",
      "192.168.1.12",
      "192.168.1.13",
    ]);
  });

  it("expands a bare address to exactly that address", () => {
    expect(ScanTargetUtil.expand("10.0.0.5")).toEqual(["10.0.0.5"]);
  });

  it("expands a multi-octet range as a cross product, in ascending order", () => {
    expect(ScanTargetUtil.expand("10.1-2.3-4.5-6")).toEqual([
      "10.1.3.5",
      "10.1.3.6",
      "10.1.4.5",
      "10.1.4.6",
      "10.2.3.5",
      "10.2.3.6",
      "10.2.4.5",
      "10.2.4.6",
    ]);
  });

  it("includes .0 and .255 when the range names them", () => {
    const hosts: Array<string> = ScanTargetUtil.expand("10.0.0.0-255");
    expect(hosts.length).toBe(256);
    expect(hosts[0]).toBe("10.0.0.0");
    expect(hosts[255]).toBe("10.0.0.255");
  });

  it("expands ranges in every octet position", () => {
    expect(ScanTargetUtil.expand("1-2.3.4.5")).toEqual(["1.3.4.5", "2.3.4.5"]);
    expect(ScanTargetUtil.expand("1.2-3.4.5")).toEqual(["1.2.4.5", "1.3.4.5"]);
    expect(ScanTargetUtil.expand("1.2.3-4.5")).toEqual(["1.2.3.5", "1.2.4.5"]);
    expect(ScanTargetUtil.expand("1.2.3.4-5")).toEqual(["1.2.3.4", "1.2.3.5"]);
  });

  it("returns an empty array for a malformed octet range", () => {
    expect(ScanTargetUtil.expand("10.22-16.0.1")).toEqual([]);
    expect(ScanTargetUtil.expand("10.0.0")).toEqual([]);
    expect(ScanTargetUtil.expand("")).toEqual([]);
  });

  /*
   * The example from the feature request, spot-checked at its edges. This is
   * the shape octet ranges exist for: the same 16 management addresses in
   * every /24 of a /13, which CIDR cannot express in one scan.
   */
  it("expands the motivating example to the right corners", () => {
    const hosts: Array<string> = ScanTargetUtil.expand("10.16-22.0-255.51-66");

    expect(hosts.length).toBe(28672);
    expect(hosts[0]).toBe("10.16.0.51");
    expect(hosts[15]).toBe("10.16.0.66");
    expect(hosts[16]).toBe("10.16.1.51");
    expect(hosts[hosts.length - 1]).toBe("10.22.255.66");

    /*
     * Nothing outside the named ranges leaks in. Collected into one assertion
     * rather than 28,672 of them — a per-host expect() makes this test take
     * seconds for no extra coverage.
     */
    const outOfRange: Array<string> = hosts.filter((host: string) => {
      const octets: Array<number> = host.split(".").map((part: string) => {
        return parseInt(part, 10);
      });
      return (
        octets[0] !== 10 ||
        octets[1]! < 16 ||
        octets[1]! > 22 ||
        octets[3]! < 51 ||
        octets[3]! > 66
      );
    });
    expect(outOfRange).toEqual([]);
  });

  it("produces no duplicates", () => {
    const hosts: Array<string> = ScanTargetUtil.expand("10.1-4.1-4.1-4");
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(hosts.length).toBe(64);
  });
});

describe("ScanTargetUtil size ceiling", () => {
  it("accepts a target exactly at the limit", () => {
    // 128 x 256 = 32,768 = MAX_SCAN_HOSTS.
    const atLimit: string = "10.0.0-127.0-255";
    expect(ScanTargetUtil.countHosts(atLimit)).toBe(
      ScanTargetUtil.MAX_SCAN_HOSTS,
    );
    expect(ScanTargetUtil.getValidationError(atLimit)).toBeNull();
  });

  it("rejects a target one address over the limit", () => {
    // 129 x 256 = 33,024.
    const overLimit: string = "10.0.0-128.0-255";
    expect(ScanTargetUtil.countHosts(overLimit)).toBeGreaterThan(
      ScanTargetUtil.MAX_SCAN_HOSTS,
    );
    expect(ScanTargetUtil.getValidationError(overLimit)).toContain(
      "exceeding the",
    );
  });

  it("accepts the motivating example, which is what the limit had to allow", () => {
    expect(
      ScanTargetUtil.getValidationError("10.16-22.0-255.51-66"),
    ).toBeNull();
    expect(
      ScanTargetUtil.getValidationError("10.48-50.0-255.51-66"),
    ).toBeNull();
  });

  it("rejects an oversized CIDR", () => {
    expect(ScanTargetUtil.getValidationError("10.0.0.0/8")).toContain(
      "exceeding the",
    );
    expect(ScanTargetUtil.getValidationError("10.0.0.0/16")).toContain(
      "exceeding the",
    );
  });

  it("accepts the largest CIDR that fits", () => {
    // A /17 is 32,766 usable hosts.
    expect(ScanTargetUtil.getValidationError("10.0.0.0/17")).toBeNull();
  });

  /*
   * expand() throws rather than silently truncating or returning [] for an
   * oversized target: a caller that skipped its size check has a bug, and a
   * quietly short address list would turn it into a scan that reports success
   * having swept a fraction of what was asked for.
   */
  it("throws rather than allocating when expand() is called on an oversized target", () => {
    expect(() => {
      return ScanTargetUtil.expand("10.0.0.0/8");
    }).toThrow(/exceeding the/);

    expect(() => {
      return ScanTargetUtil.expand("0-255.0-255.0-255.0-255");
    }).toThrow(/exceeding the/);
  });

  it("still returns an empty array (not a throw) for a malformed target", () => {
    expect(ScanTargetUtil.expand("garbage")).toEqual([]);
  });
});

describe("ScanTargetUtil.getValidationError messages", () => {
  it("returns null for valid targets in both notations", () => {
    expect(ScanTargetUtil.getValidationError("192.168.1.0/24")).toBeNull();
    expect(
      ScanTargetUtil.getValidationError("10.16-22.0-255.51-66"),
    ).toBeNull();
    expect(ScanTargetUtil.getValidationError("10.0.0.5")).toBeNull();
    expect(ScanTargetUtil.getValidationError("  10.0.0.5  ")).toBeNull();
  });

  it("asks for a target when given nothing", () => {
    expect(ScanTargetUtil.getValidationError("")).toContain(
      "A scan target is required",
    );
    expect(ScanTargetUtil.getValidationError("   ")).toContain(
      "A scan target is required",
    );
  });

  it("names the reversed octet range and suggests the fix", () => {
    const error: string | null =
      ScanTargetUtil.getValidationError("10.22-16.0.1");
    expect(error).toContain("22-16");
    expect(error).toContain("reversed");
    // The suggestion is the same range written the right way round.
    expect(error).toContain("16-22");
  });

  it("names the out-of-range octet", () => {
    expect(ScanTargetUtil.getValidationError("10.0.0.256")).toContain(
      "between 0 and 255",
    );
    expect(ScanTargetUtil.getValidationError("10.0-300.0.1")).toContain(
      "between 0 and 255",
    );
    expect(ScanTargetUtil.getValidationError("300.0.0.0/24")).toContain(
      "between 0 and 255",
    );
  });

  it("names the out-of-range prefix", () => {
    expect(ScanTargetUtil.getValidationError("10.0.0.0/33")).toContain(
      "between /0 and /32",
    );
  });

  it("explains both notations when the target is neither", () => {
    const error: string | null =
      ScanTargetUtil.getValidationError("hello world");
    expect(error).toContain("not a valid scan target");
    expect(error).toContain("CIDR");
    expect(error).toContain("octet-range");
  });

  it("quotes the offending target back to the operator", () => {
    expect(ScanTargetUtil.getValidationError("10.22-16.0.1")).toContain(
      "10.22-16.0.1",
    );
  });

  it("reports the actual size when a target is too large", () => {
    const error: string | null =
      ScanTargetUtil.getValidationError("10.0.0-128.0-255");
    expect(error).toContain("33,024");
    expect(error).toContain("32,768");
  });

  it("rejects non-string input without throwing", () => {
    expect(
      ScanTargetUtil.getValidationError(null as unknown as string),
    ).toContain("A scan target is required");
    expect(
      ScanTargetUtil.getValidationError(undefined as unknown as string),
    ).toContain("A scan target is required");
    expect(ScanTargetUtil.isValid(42 as unknown as string)).toBe(false);
    expect(ScanTargetUtil.countHosts({} as unknown as string)).toBe(0);
    expect(ScanTargetUtil.expand([] as unknown as string)).toEqual([]);
  });
});

describe("ScanTargetUtil.isValid", () => {
  it("is true for well-formed targets regardless of size", () => {
    /*
     * isValid answers "is this syntax", NOT "will this scan" — the size
     * ceiling is a separate, policy-driven check. A /8 is a perfectly valid
     * CIDR that we refuse to sweep.
     */
    expect(ScanTargetUtil.isValid("10.0.0.0/8")).toBe(true);
    expect(ScanTargetUtil.getValidationError("10.0.0.0/8")).not.toBeNull();
  });

  it("is false for malformed targets", () => {
    expect(ScanTargetUtil.isValid("10.22-16.0.1")).toBe(false);
    expect(ScanTargetUtil.isValid("")).toBe(false);
  });
});
