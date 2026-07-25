import CidrMatchUtil, {
  AssignmentRuleCandidate,
} from "../../../Utils/NetworkSite/CidrMatchUtil";

describe("CidrMatchUtil.ipInCidr", () => {
  it("matches inside a /24", () => {
    expect(CidrMatchUtil.ipInCidr("192.168.1.0", "192.168.1.0/24")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("192.168.1.1", "192.168.1.0/24")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("192.168.1.255", "192.168.1.0/24")).toBe(
      true,
    );
  });

  it("rejects the adjacent /24", () => {
    expect(CidrMatchUtil.ipInCidr("192.168.2.0", "192.168.1.0/24")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("192.168.0.255", "192.168.1.0/24")).toBe(
      false,
    );
  });

  it("/0 matches every valid address", () => {
    expect(CidrMatchUtil.ipInCidr("0.0.0.0", "0.0.0.0/0")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("255.255.255.255", "0.0.0.0/0")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("10.20.30.40", "192.168.0.0/0")).toBe(true);
  });

  it("/32 matches only the exact address", () => {
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.1/32")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("10.0.0.2", "10.0.0.1/32")).toBe(false);
  });

  it("/31 matches exactly the two-address pair", () => {
    expect(CidrMatchUtil.ipInCidr("10.0.0.0", "10.0.0.0/31")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.0/31")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("10.0.0.2", "10.0.0.0/31")).toBe(false);
  });

  it("handles the high bit correctly (unsigned math)", () => {
    expect(CidrMatchUtil.ipInCidr("200.1.2.3", "200.0.0.0/8")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("100.1.2.3", "200.0.0.0/8")).toBe(false);
    expect(
      CidrMatchUtil.ipInCidr("255.255.255.254", "255.255.255.254/32"),
    ).toBe(true);
  });

  it("treats a bare address as /32", () => {
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.1")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("10.0.0.2", "10.0.0.1")).toBe(false);
  });

  it("rejects octet overflow", () => {
    expect(CidrMatchUtil.ipInCidr("10.0.0.256", "10.0.0.0/8")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.256/8")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("999.0.0.1", "0.0.0.0/0")).toBe(false);
  });

  it("rejects prefixes outside 0-32", () => {
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.0/33")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.0/99")).toBe(false);
  });

  it("rejects malformed prefixes", () => {
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.0/a")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.0/-1")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.0/")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "10.0.0.0/8/8")).toBe(false);
  });

  it("rejects malformed addresses", () => {
    expect(CidrMatchUtil.ipInCidr("10.0.0", "10.0.0.0/8")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.x", "10.0.0.0/8")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("", "10.0.0.0/8")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("switch-01.example.com", "10.0.0.0/8")).toBe(
      false,
    );
    expect(CidrMatchUtil.ipInCidr("10.0.0.+1", "10.0.0.0/8")).toBe(false);
  });

  it("rejects garbage cidr inputs", () => {
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "garbage")).toBe(false);
    expect(CidrMatchUtil.ipInCidr("10.0.0.1", "/24")).toBe(false);
    expect(
      CidrMatchUtil.ipInCidr(
        undefined as unknown as string,
        null as unknown as string,
      ),
    ).toBe(false);
  });

  it("tolerates surrounding whitespace and leading zeros", () => {
    expect(CidrMatchUtil.ipInCidr(" 10.0.0.1 ", " 10.0.0.0/8 ")).toBe(true);
    expect(CidrMatchUtil.ipInCidr("010.0.0.1", "10.0.0.0/8")).toBe(true);
  });
});

describe("CidrMatchUtil.isValidCidr", () => {
  it("accepts well-formed CIDRs and bare addresses", () => {
    expect(CidrMatchUtil.isValidCidr("10.0.0.0/8")).toBe(true);
    expect(CidrMatchUtil.isValidCidr("0.0.0.0/0")).toBe(true);
    expect(CidrMatchUtil.isValidCidr("255.255.255.255/32")).toBe(true);
    expect(CidrMatchUtil.isValidCidr("10.0.0.1")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(CidrMatchUtil.isValidCidr("10.0.0.0/33")).toBe(false);
    expect(CidrMatchUtil.isValidCidr("10.0.0/8")).toBe(false);
    expect(CidrMatchUtil.isValidCidr("10.0.0.0/x")).toBe(false);
    expect(CidrMatchUtil.isValidCidr("")).toBe(false);
    expect(CidrMatchUtil.isValidCidr("hostname/24")).toBe(false);
  });
});

describe("CidrMatchUtil.hostnameMatchesWildcard", () => {
  it("matches exact names case-insensitively", () => {
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("Switch-01", "switch-01"),
    ).toBe(true);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("switch-01", "SWITCH-01"),
    ).toBe(true);
  });

  it("supports leading, trailing and inner wildcards", () => {
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("unit-1042-sw1", "unit-*"),
    ).toBe(true);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard(
        "core.example.com",
        "*.example.com",
      ),
    ).toBe(true);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("unit-1042-sw1", "unit-*-sw1"),
    ).toBe(true);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("unit-1042-sw2", "unit-*-sw1"),
    ).toBe(false);
  });

  it("supports multiple wildcards", () => {
    expect(CidrMatchUtil.hostnameMatchesWildcard("a-b-c-d", "*-b-*-d")).toBe(
      true,
    );
  });

  it("a lone * matches anything including the empty string", () => {
    expect(CidrMatchUtil.hostnameMatchesWildcard("anything", "*")).toBe(true);
    expect(CidrMatchUtil.hostnameMatchesWildcard("", "*")).toBe(true);
  });

  it("* matches zero characters", () => {
    expect(CidrMatchUtil.hostnameMatchesWildcard("unit-", "unit-*")).toBe(true);
  });

  it("requires a full match (no substring matching)", () => {
    expect(CidrMatchUtil.hostnameMatchesWildcard("myunit-1", "unit-*")).toBe(
      false,
    );
    expect(CidrMatchUtil.hostnameMatchesWildcard("unit-1x", "unit-1")).toBe(
      false,
    );
  });

  it("treats regex metacharacters as literals (dot is literal)", () => {
    expect(
      CidrMatchUtil.hostnameMatchesWildcard(
        "sw1.example.com",
        "sw1.example.com",
      ),
    ).toBe(true);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard(
        "sw1xexampleycom",
        "sw1.example.com",
      ),
    ).toBe(false);
    expect(CidrMatchUtil.hostnameMatchesWildcard("a+b", "a+b")).toBe(true);
    expect(CidrMatchUtil.hostnameMatchesWildcard("aab", "a+b")).toBe(false);
  });

  it("empty pattern matches only the empty hostname", () => {
    expect(CidrMatchUtil.hostnameMatchesWildcard("", "")).toBe(true);
    expect(CidrMatchUtil.hostnameMatchesWildcard("host", "")).toBe(false);
  });

  it("non-string inputs never match", () => {
    expect(
      CidrMatchUtil.hostnameMatchesWildcard(
        undefined as unknown as string,
        "*",
      ),
    ).toBe(false);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("host", null as unknown as string),
    ).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    expect(CidrMatchUtil.hostnameMatchesWildcard(" host ", "host")).toBe(true);
    expect(CidrMatchUtil.hostnameMatchesWildcard("host", " host ")).toBe(true);
  });

  it("consecutive wildcards collapse rather than multiplying the work", () => {
    expect(CidrMatchUtil.hostnameMatchesWildcard("unit-1042-sw1", "**")).toBe(
      true,
    );
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("unit-1042-sw1", "unit-***-sw1"),
    ).toBe(true);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("unit-1042-sw2", "unit-***-sw1"),
    ).toBe(false);
  });

  /*
   * Regression: this pattern/hostname pair compiled to
   * /^.*a.*a.*a.*a.*a.*a.*a.*a.*a.*a.*b$/i, which the backtracking regex
   * engine takes minutes to reject — a single assignment rule row could wedge
   * the API/worker event loop on every device create or update.
   */
  it("rejects a catastrophic-backtracking pattern immediately", () => {
    const pattern: string = `${"*a".repeat(12)}*b`;
    const hostname: string = "a".repeat(60);

    const startedAt: number = Date.now();
    expect(CidrMatchUtil.hostnameMatchesWildcard(hostname, pattern)).toBe(
      false,
    );
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("stays fast on the pathological pattern even when it does match", () => {
    const pattern: string = `${"*a".repeat(12)}*b`;
    const hostname: string = `${"a".repeat(60)}b`;

    const startedAt: number = Date.now();
    expect(CidrMatchUtil.hostnameMatchesWildcard(hostname, pattern)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("refuses patterns longer than the 253-character DNS maximum", () => {
    expect(CidrMatchUtil.MAX_HOSTNAME_PATTERN_LENGTH).toBe(253);

    const atLimit: string = `${"a".repeat(252)}*`;
    expect(atLimit.length).toBe(253);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("a".repeat(252), atLimit),
    ).toBe(true);

    const overLimit: string = `${"a".repeat(253)}*`;
    expect(overLimit.length).toBe(254);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("a".repeat(253), overLimit),
    ).toBe(false);
  });
});

describe("CidrMatchUtil.ruleMatches", () => {
  it("matches a cidr-only rule against the target ip", () => {
    expect(
      CidrMatchUtil.ruleMatches(
        { subnetCidr: "10.0.0.0/8" },
        { ip: "10.1.2.3" },
      ),
    ).toBe(true);
    expect(
      CidrMatchUtil.ruleMatches(
        { subnetCidr: "10.0.0.0/8" },
        { ip: "11.1.2.3" },
      ),
    ).toBe(false);
  });

  it("a cidr rule cannot match a target without an ip", () => {
    expect(
      CidrMatchUtil.ruleMatches(
        { subnetCidr: "10.0.0.0/8" },
        { hostname: "sw1" },
      ),
    ).toBe(false);
  });

  it("matches a hostname-pattern rule against hostname or sysName", () => {
    expect(
      CidrMatchUtil.ruleMatches(
        { hostnamePattern: "unit-*" },
        { hostname: "unit-1" },
      ),
    ).toBe(true);
    expect(
      CidrMatchUtil.ruleMatches(
        { hostnamePattern: "unit-*" },
        { hostname: "10.0.0.5", sysName: "unit-1-core" },
      ),
    ).toBe(true);
    expect(
      CidrMatchUtil.ruleMatches(
        { hostnamePattern: "unit-*" },
        { hostname: "other", sysName: "different" },
      ),
    ).toBe(false);
  });

  it("requires BOTH criteria to match when both are set", () => {
    const rule: AssignmentRuleCandidate = {
      subnetCidr: "10.0.0.0/8",
      hostnamePattern: "unit-*",
    };
    expect(
      CidrMatchUtil.ruleMatches(rule, {
        ip: "10.0.0.1",
        sysName: "unit-1",
      }),
    ).toBe(true);
    expect(
      CidrMatchUtil.ruleMatches(rule, {
        ip: "11.0.0.1",
        sysName: "unit-1",
      }),
    ).toBe(false);
    expect(
      CidrMatchUtil.ruleMatches(rule, {
        ip: "10.0.0.1",
        sysName: "core-1",
      }),
    ).toBe(false);
  });

  it("a rule with no criteria never matches", () => {
    expect(
      CidrMatchUtil.ruleMatches({}, { ip: "10.0.0.1", hostname: "any" }),
    ).toBe(false);
    expect(
      CidrMatchUtil.ruleMatches(
        { subnetCidr: "  ", hostnamePattern: "" },
        { ip: "10.0.0.1" },
      ),
    ).toBe(false);
  });
});

describe("CidrMatchUtil.pickRule", () => {
  interface TestRule extends AssignmentRuleCandidate {
    name: string;
  }

  const target: { ip: string; hostname: string } = {
    ip: "10.0.5.9",
    hostname: "unit-1042-sw1",
  };

  it("returns null when nothing matches", () => {
    expect(
      CidrMatchUtil.pickRule<TestRule>(
        [{ name: "r1", subnetCidr: "192.168.0.0/16", priority: 100 }],
        target,
      ),
    ).toBeNull();
    expect(CidrMatchUtil.pickRule<TestRule>([], target)).toBeNull();
  });

  it("the highest priority number wins", () => {
    const winner: TestRule | null = CidrMatchUtil.pickRule<TestRule>(
      [
        { name: "broad", subnetCidr: "10.0.0.0/8", priority: 1 },
        { name: "narrow", subnetCidr: "10.0.5.0/24", priority: 10 },
      ],
      target,
    );
    expect(winner?.name).toBe("narrow");
  });

  it("a non-matching high-priority rule is skipped", () => {
    const winner: TestRule | null = CidrMatchUtil.pickRule<TestRule>(
      [
        { name: "wrong-subnet", subnetCidr: "172.16.0.0/12", priority: 999 },
        { name: "matching", subnetCidr: "10.0.0.0/8", priority: 1 },
      ],
      target,
    );
    expect(winner?.name).toBe("matching");
  });

  it("priority ties go to the earlier createdAt", () => {
    const winner: TestRule | null = CidrMatchUtil.pickRule<TestRule>(
      [
        {
          name: "newer",
          subnetCidr: "10.0.0.0/8",
          priority: 5,
          createdAt: new Date("2026-02-01T00:00:00Z"),
        },
        {
          name: "older",
          subnetCidr: "10.0.0.0/8",
          priority: 5,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      target,
    );
    expect(winner?.name).toBe("older");
  });

  it("priority ties without createdAt keep the first rule (stable)", () => {
    const winner: TestRule | null = CidrMatchUtil.pickRule<TestRule>(
      [
        { name: "first", subnetCidr: "10.0.0.0/8", priority: 5 },
        { name: "second", subnetCidr: "10.0.0.0/8", priority: 5 },
      ],
      target,
    );
    expect(winner?.name).toBe("first");
  });

  it("missing priority is treated as 0", () => {
    const winner: TestRule | null = CidrMatchUtil.pickRule<TestRule>(
      [
        { name: "no-priority", subnetCidr: "10.0.0.0/8" },
        { name: "priority-1", subnetCidr: "10.0.0.0/8", priority: 1 },
      ],
      target,
    );
    expect(winner?.name).toBe("priority-1");
  });

  it("mixes cidr and hostname rules", () => {
    const winner: TestRule | null = CidrMatchUtil.pickRule<TestRule>(
      [
        { name: "by-subnet", subnetCidr: "10.0.0.0/8", priority: 1 },
        { name: "by-hostname", hostnamePattern: "unit-1042-*", priority: 2 },
      ],
      target,
    );
    expect(winner?.name).toBe("by-hostname");
  });
});
