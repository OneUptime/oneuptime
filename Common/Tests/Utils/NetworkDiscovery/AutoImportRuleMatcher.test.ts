import AutoImportRuleMatcher, {
  AutoImportHostEvaluation,
  AutoImportRuleCandidate,
} from "../../../Utils/NetworkDiscovery/AutoImportRuleMatcher";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — which discovered hosts an auto-import rule claims,
 * and what the rule set as a whole says about one host (issue #3378).
 *
 * The semantics worth pinning are the ones an operator relies on without
 * reading the code: populated conditions AND within a rule, an empty rule
 * matches NOTHING (not everything), OR is expressed as multiple rules, an
 * exclusion rule vetoes unconditionally, and a ping-only host needs an
 * explicit opt-in before any import rule may claim it.
 */

function host(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: "10.0.0.5",
    sysName: "switch-WB1678-01",
    sysDescr: "Cisco IOS Software, C2960X",
    ...overrides,
  };
}

describe("AutoImportRuleMatcher.ruleMatchesHost", () => {
  /*
   * The site-rule precedent: an all-wildcard rule is a typo, not a
   * match-everything. A rule that claimed every host on an empty form would
   * import whole subnets the moment it was saved half-finished.
   */
  it("matches nothing when the rule has no conditions", () => {
    expect(AutoImportRuleMatcher.ruleMatchesHost({}, host())).toBe(false);
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { ipMatchTarget: "", sysNamePattern: "", sysDescrPattern: "" },
        host(),
      ),
    ).toBe(false);
    // Whitespace-only conditions are "not configured", not conditions.
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { ipMatchTarget: "   ", sysNamePattern: "  " },
        host(),
      ),
    ).toBe(false);
    // Nor does the ping-only opt-in count as a condition by itself.
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { includePingOnlyHosts: true },
        host(),
      ),
    ).toBe(false);
  });

  it("matches on a single populated condition", () => {
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { ipMatchTarget: "10.0.0.0/24" },
        host(),
      ),
    ).toBe(true);
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { ipMatchTarget: "10.0.1.0/24" },
        host(),
      ),
    ).toBe(false);
  });

  it("ANDs populated conditions: ip and sysName must both hold", () => {
    const rule: AutoImportRuleCandidate = {
      ipMatchTarget: "10.0.0.0/24",
      sysNamePattern: "WB1678",
    };

    expect(AutoImportRuleMatcher.ruleMatchesHost(rule, host())).toBe(true);

    // Right subnet, wrong name.
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        rule,
        host({ sysName: "switch-XX9999-01" }),
      ),
    ).toBe(false);

    // Right name, wrong subnet.
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        rule,
        host({ ipAddress: "192.168.1.5" }),
      ),
    ).toBe(false);
  });

  /*
   * Pattern semantics are RulePatternMatchUtil's, shared with the label and
   * owner rules: a plain string is an unanchored case-insensitive regex
   * ("contains"), and a '*' glob works too — the syntax the neighbouring
   * site rules taught operators (OneUptime/oneuptime#2940).
   */
  it("matches sysName as an unanchored substring regex", () => {
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysNamePattern: "WB1678" },
        host({ sysName: "switch-WB1678-01" }),
      ),
    ).toBe(true);
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysNamePattern: "WB1678" },
        host({ sysName: "switch-XX9999-01" }),
      ),
    ).toBe(false);
  });

  it("matches sysName as a '*' glob as well", () => {
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysNamePattern: "*WB1678*" },
        host({ sysName: "switch-WB1678-01" }),
      ),
    ).toBe(true);
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysNamePattern: "*WB1678*" },
        host({ sysName: "switch-XX9999-01" }),
      ),
    ).toBe(false);
  });

  it("matches sysDescr with the same regex-first-glob-fallback semantics", () => {
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysDescrPattern: "C2960X" },
        host(),
      ),
    ).toBe(true);
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysDescrPattern: "*IOS*" },
        host(),
      ),
    ).toBe(true);
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysDescrPattern: "JunOS" },
        host(),
      ),
    ).toBe(false);
  });

  /*
   * A ping-only host has no SNMP identity, so a host with no sysName at all
   * is routine — and a configured name pattern must read it as "does not
   * match", never as "nothing to check".
   */
  it("never matches a configured sysNamePattern against a host with no sysName", () => {
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysNamePattern: "WB1678" },
        host({ sysName: undefined }),
      ),
    ).toBe(false);
    expect(
      AutoImportRuleMatcher.ruleMatchesHost(
        { sysNamePattern: "*WB1678*" },
        host({ sysName: undefined }),
      ),
    ).toBe(false);
  });

  describe("the ping-only gate", () => {
    /*
     * An SNMP credential typo makes a whole subnet report as ping-only; a
     * rule silently importing hundreds of half-identified hosts on that typo
     * is the failure mode the default-closed gate exists to prevent.
     */
    it("does not let an import rule claim a ping-only host by default", () => {
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { ipMatchTarget: "10.0.0.0/24" },
          host({ snmpReachable: false }),
        ),
      ).toBe(false);
    });

    it("lets an import rule claim a ping-only host after the explicit opt-in", () => {
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { ipMatchTarget: "10.0.0.0/24", includePingOnlyHosts: true },
          host({ snmpReachable: false }),
        ),
      ).toBe(true);
    });

    /*
     * Scans stored before snmpReachable existed carry undefined, and every
     * host on them answered SNMP by construction — so legacy rows must keep
     * importing without the opt-in.
     */
    it("reads an undefined snmpReachable (legacy scan) as SNMP-reachable", () => {
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { ipMatchTarget: "10.0.0.0/24" },
          host({ snmpReachable: undefined }),
        ),
      ).toBe(true);
    });

    // A veto is a veto whatever the host answered with.
    it("lets an exclusion rule match a ping-only host regardless of the opt-in", () => {
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { ipMatchTarget: "10.0.0.0/24", isExclusion: true },
          host({ snmpReachable: false }),
        ),
      ).toBe(true);
    });
  });
});

describe("AutoImportRuleMatcher.evaluateHost", () => {
  const matchingRuleA: AutoImportRuleCandidate = {
    ipMatchTarget: "10.0.0.0/24",
  };
  const matchingRuleB: AutoImportRuleCandidate = {
    sysNamePattern: "WB1678",
  };
  const nonMatchingRule: AutoImportRuleCandidate = {
    ipMatchTarget: "192.168.0.0/16",
  };

  // OR across rules: any import rule matching is enough.
  it("imports when any import rule matches, listing exactly the ones that did", () => {
    const evaluation: AutoImportHostEvaluation =
      AutoImportRuleMatcher.evaluateHost(
        [nonMatchingRule, matchingRuleA, matchingRuleB],
        host(),
      );

    expect(evaluation.shouldImport).toBe(true);
    expect(evaluation.matchedRules).toEqual([matchingRuleA, matchingRuleB]);
    expect(evaluation.excludedByRule).toBeUndefined();
  });

  /*
   * The veto, and its explainability contract: the answer is "excluded by
   * rule R" with NO matched rules listed, so a dry run reads as one decision
   * rather than "matched A and B and then didn't".
   */
  it("lets an exclusion rule veto even when import rules match", () => {
    const exclusionRule: AutoImportRuleCandidate = {
      ipMatchTarget: "10.0.0.5",
      isExclusion: true,
    };

    const evaluation: AutoImportHostEvaluation =
      AutoImportRuleMatcher.evaluateHost(
        [matchingRuleA, exclusionRule, matchingRuleB],
        host(),
      );

    expect(evaluation.shouldImport).toBe(false);
    expect(evaluation.matchedRules).toEqual([]);
    expect(evaluation.excludedByRule).toBe(exclusionRule);
  });

  it("does not veto through an exclusion rule the host does not match", () => {
    const irrelevantExclusion: AutoImportRuleCandidate = {
      ipMatchTarget: "172.16.0.0/12",
      isExclusion: true,
    };

    const evaluation: AutoImportHostEvaluation =
      AutoImportRuleMatcher.evaluateHost(
        [matchingRuleA, irrelevantExclusion],
        host(),
      );

    expect(evaluation.shouldImport).toBe(true);
    expect(evaluation.matchedRules).toEqual([matchingRuleA]);
    expect(evaluation.excludedByRule).toBeUndefined();
  });

  it("does not import when no rules exist", () => {
    const evaluation: AutoImportHostEvaluation =
      AutoImportRuleMatcher.evaluateHost([], host());

    expect(evaluation.shouldImport).toBe(false);
    expect(evaluation.matchedRules).toEqual([]);
    expect(evaluation.excludedByRule).toBeUndefined();
  });

  it("does not import when only exclusion rules exist", () => {
    const evaluation: AutoImportHostEvaluation =
      AutoImportRuleMatcher.evaluateHost(
        [{ ipMatchTarget: "10.0.0.0/24", isExclusion: true }],
        host(),
      );

    expect(evaluation.shouldImport).toBe(false);
    expect(evaluation.matchedRules).toEqual([]);
    expect(evaluation.excludedByRule).toBeDefined();
  });
});
