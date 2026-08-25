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

  describe("the sysObjectID condition", () => {
    /*
     * The vendor fingerprint: sysObjectID is the vendor's registered
     * enterprise OID, so "any Cisco device" is a glob over the 1.3.6.1.4.1.9
     * arc. Deliberately NOT the free-text semantics of the other two
     * pattern conditions — OID matching is a literal-dot whole-string glob,
     * or an arc-prefix test when the pattern has no '*'.
     */
    it("matches a vendor by enterprise-arc glob and counts as a condition on its own", () => {
      const ciscoRule: AutoImportRuleCandidate = {
        sysObjectIdPattern: "1.3.6.1.4.1.9.*",
      };

      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          ciscoRule,
          host({ sysObjectId: "1.3.6.1.4.1.9.1.1745" }),
        ),
      ).toBe(true);

      // A Juniper box sits under a different arc and stays out.
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          ciscoRule,
          host({ sysObjectId: "1.3.6.1.4.1.2636.1.1.1.2.137" }),
        ),
      ).toBe(false);
    });

    /*
     * The regression that forced OID-aware matching: under the free-text
     * matcher's regex-FIRST semantics, "1.3.6.1.4.1.9.*" compiled as an
     * unanchored regex where every '.' matches anything, so "any Cisco
     * device" also imported (or, as an exclusion, silently vetoed) every
     * enterprise whose number merely STARTS with 9 — Nokia (94), 990,
     * 9148... In an OID, dots are dots and 9 is not 94.
     */
    it("never bleeds into sibling enterprise arcs that share a digit prefix", () => {
      const ciscoGlob: AutoImportRuleCandidate = {
        sysObjectIdPattern: "1.3.6.1.4.1.9.*",
      };

      for (const foreignOid of [
        "1.3.6.1.4.1.94.1.21", // Nokia
        "1.3.6.1.4.1.990.2.1",
        "1.3.6.1.4.1.9999.1.2",
      ]) {
        expect(
          AutoImportRuleMatcher.ruleMatchesHost(
            ciscoGlob,
            host({ sysObjectId: foreignOid }),
          ),
        ).toBe(false);
      }

      // And the same holds when the rule is an exclusion veto.
      const excludeCisco: AutoImportRuleCandidate = {
        sysObjectIdPattern: "1.3.6.1.4.1.9.*",
        isExclusion: true,
      };
      const nokiaHost: DiscoveredNetworkDevice = host({
        sysObjectId: "1.3.6.1.4.1.94.1.21",
      });
      const importAll: AutoImportRuleCandidate = {
        ipMatchTarget: "10.0.0.0/8",
      };

      const evaluation: AutoImportHostEvaluation =
        AutoImportRuleMatcher.evaluateHost(
          [excludeCisco, importAll],
          nokiaHost,
        );

      expect(evaluation.excludedByRule).toBeUndefined();
      expect(evaluation.shouldImport).toBe(true);
    });

    it("treats a starless pattern as an arc prefix on sub-identifier boundaries", () => {
      const ciscoPrefix: AutoImportRuleCandidate = {
        sysObjectIdPattern: "1.3.6.1.4.1.9",
      };

      // The arc itself and everything under it.
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          ciscoPrefix,
          host({ sysObjectId: "1.3.6.1.4.1.9" }),
        ),
      ).toBe(true);
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          ciscoPrefix,
          host({ sysObjectId: "1.3.6.1.4.1.9.1.1745" }),
        ),
      ).toBe(true);

      // Never the sibling arc that shares the digit prefix.
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          ciscoPrefix,
          host({ sysObjectId: "1.3.6.1.4.1.94.1.21" }),
        ),
      ).toBe(false);
    });

    it("tolerates the leading dot some agents prefix OIDs with, on either side", () => {
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { sysObjectIdPattern: "1.3.6.1.4.1.9.*" },
          host({ sysObjectId: ".1.3.6.1.4.1.9.1.1745" }),
        ),
      ).toBe(true);

      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { sysObjectIdPattern: ".1.3.6.1.4.1.9" },
          host({ sysObjectId: "1.3.6.1.4.1.9.1.1745" }),
        ),
      ).toBe(true);
    });

    it("a glob cannot match mid-OID — the pattern must cover the whole arc", () => {
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { sysObjectIdPattern: "2.1.1.*" },
          host({ sysObjectId: "1.3.6.1.4.1.14988.2.1.1.5" }),
        ),
      ).toBe(false);
    });

    it("ANDs with the other conditions like any criterion", () => {
      const rule: AutoImportRuleCandidate = {
        ipMatchTarget: "10.0.0.0/24",
        sysObjectIdPattern: "1.3.6.1.4.1.9.*",
      };

      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          rule,
          host({ sysObjectId: "1.3.6.1.4.1.9.1.1745" }),
        ),
      ).toBe(true);

      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          rule,
          host({
            ipAddress: "192.168.7.1",
            sysObjectId: "1.3.6.1.4.1.9.1.1745",
          }),
        ),
      ).toBe(false);
    });

    /*
     * Ping-only hosts and rows stored by pre-sysObjectId probes carry no
     * sysObjectId at all. A configured vendor condition must not match a
     * host whose vendor is unknown — the same missing-value rule the
     * sysName/sysDescr patterns follow.
     */
    it("never matches a host whose scan did not carry sysObjectId", () => {
      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { sysObjectIdPattern: "1.3.6.1.4.1.9.*" },
          host({ sysObjectId: undefined }),
        ),
      ).toBe(false);
    });
  });

  describe("pattern subject clamping", () => {
    /*
     * The jsonb these hosts come from is the probe's payload stored
     * verbatim and unbounded, while patterns run through JavaScript's
     * backtracking regex engine — so subjects are clamped to 500 characters
     * before matching. Real SNMP DisplayStrings top out at 255 octets;
     * only hostile or corrupt payloads are longer, and the clamp bounds
     * what any pattern can be made to chew on.
     */
    it("does not see pattern evidence past the 500-character clamp", () => {
      const sysDescrWithLateEvidence: string =
        "x".repeat(520) + "NEEDLE" + "x".repeat(74);
      expect(sysDescrWithLateEvidence).toHaveLength(600);

      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { sysDescrPattern: "NEEDLE" },
          host({ sysDescr: sysDescrWithLateEvidence }),
        ),
      ).toBe(false);
    });

    it("still sees evidence that sits before the clamp", () => {
      const sysDescrWithEarlyEvidence: string =
        "x".repeat(100) + "NEEDLE" + "x".repeat(494);
      expect(sysDescrWithEarlyEvidence).toHaveLength(600);

      expect(
        AutoImportRuleMatcher.ruleMatchesHost(
          { sysDescrPattern: "NEEDLE" },
          host({ sysDescr: sysDescrWithEarlyEvidence }),
        ),
      ).toBe(true);
    });
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
