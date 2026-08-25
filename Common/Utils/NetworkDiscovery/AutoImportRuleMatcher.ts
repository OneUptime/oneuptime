import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import RulePatternMatchUtil from "../Rules/RulePatternMatchUtil";
import { monitoringMethodForDiscoveredHost } from "./DiscoveryImportEligibility";
import ScanTargetUtil from "./ScanTargetUtil";

/*
 * Matching for network device auto-import rules: which discovered hosts a
 * rule claims, and whether the rule set as a whole imports a host.
 *
 * Pure and dependency-free (no models beyond the host interface, no logger,
 * no DB) so rule decisions are unit-testable — the same arrangement as
 * CidrMatchUtil for site assignment rules and RulePatternMatchUtil for
 * label/owner rules, both of which this reuses rather than re-implements.
 *
 * Semantics, mirroring the neighbouring rule engines:
 *
 *   - Populated conditions on one rule are ANDed; an empty condition is "not
 *     configured" and skipped. A rule with NO conditions matches NOTHING
 *     (the site-rule precedent: an all-wildcard rule is a typo, not a
 *     match-everything).
 *   - OR is expressed as multiple rules: a host imports when ANY import rule
 *     matches it and NO exclusion rule matches it.
 *   - Exclusion rules veto. "Never import X" needs to be writable without
 *     regex negative-lookahead gymnastics, and a veto is how an operator
 *     carves printers and phones out of a broad subnet rule.
 */

/*
 * The rule columns matching reads. NetworkDeviceAutoImportRule rows satisfy
 * this structurally, and tests can build literals.
 */
export interface AutoImportRuleCandidate {
  ipMatchTarget?: string | null | undefined;
  sysNamePattern?: string | null | undefined;
  sysDescrPattern?: string | null | undefined;
  includePingOnlyHosts?: boolean | null | undefined;
  isExclusion?: boolean | null | undefined;
}

/** How the rule set as a whole read one discovered host. */
export interface AutoImportHostEvaluation {
  // True when an import rule matched and no exclusion rule vetoed.
  shouldImport: boolean;
  // Import rules whose conditions (and ping-only gate) the host satisfied.
  matchedRules: Array<AutoImportRuleCandidate>;
  // The exclusion rule that vetoed, when one did.
  excludedByRule?: AutoImportRuleCandidate | undefined;
}

/*
 * Longest subject string a pattern is evaluated against. SNMP DisplayStrings
 * top out at 255 octets, so anything longer only appears in a hostile or
 * corrupt probe payload — and the jsonb these hosts come from is stored
 * verbatim, unbounded. Patterns run through JavaScript's backtracking regex
 * engine, whose worst case grows with subject length, so the subject is
 * clamped before matching: a rule author writing a pathological pattern can
 * only ever run it against a bounded string. (The same author already holds
 * Edit permission on rules — this bounds the blast radius, it does not make
 * hostile patterns free.)
 */
const MAX_PATTERN_SUBJECT_LENGTH: number = 500;

function clampSubject(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return value;
  }

  return value.length > MAX_PATTERN_SUBJECT_LENGTH
    ? value.substring(0, MAX_PATTERN_SUBJECT_LENGTH)
    : value;
}

export class AutoImportRuleMatcher {
  // True when the host answered ping but not SNMP.
  private static isPingOnlyHost(host: DiscoveredNetworkDevice): boolean {
    return (
      monitoringMethodForDiscoveredHost(host) ===
      NetworkDeviceMonitoringMethod.Monitor
    );
  }

  /*
   * True when this rule's populated conditions all match the host.
   *
   * The ping-only gate applies to IMPORT rules only: a host that never
   * answered SNMP imports only through a rule that explicitly opted into
   * ping-only hosts — an SNMP credential typo makes a whole subnet report as
   * ping-only, and a rule silently importing hundreds of half-identified
   * hosts on a typo is the failure mode this default exists to prevent. An
   * EXCLUSION rule has no such gate: a veto is a veto whatever the host
   * answered with.
   */
  public static ruleMatchesHost(
    rule: AutoImportRuleCandidate,
    host: DiscoveredNetworkDevice,
  ): boolean {
    const ipMatchTarget: string = (rule.ipMatchTarget || "").trim();
    const sysNamePattern: string = (rule.sysNamePattern || "").trim();
    const sysDescrPattern: string = (rule.sysDescrPattern || "").trim();

    // A rule with no conditions matches nothing — the site-rule precedent.
    if (!ipMatchTarget && !sysNamePattern && !sysDescrPattern) {
      return false;
    }

    if (
      !rule.isExclusion &&
      !rule.includePingOnlyHosts &&
      AutoImportRuleMatcher.isPingOnlyHost(host)
    ) {
      return false;
    }

    if (ipMatchTarget) {
      if (
        !host.ipAddress ||
        !ScanTargetUtil.contains(ipMatchTarget, host.ipAddress)
      ) {
        return false;
      }
    }

    /*
     * Pattern semantics are RulePatternMatchUtil's, identical to label/owner
     * rules: case-insensitive unanchored regex first, '*' glob fallback —
     * so "contains WB1678" is written the same way here as everywhere else.
     * A host missing the field never matches a configured pattern.
     */
    if (
      sysNamePattern &&
      !RulePatternMatchUtil.matches(clampSubject(host.sysName), sysNamePattern)
    ) {
      return false;
    }

    if (
      sysDescrPattern &&
      !RulePatternMatchUtil.matches(
        clampSubject(host.sysDescr),
        sysDescrPattern,
      )
    ) {
      return false;
    }

    return true;
  }

  /**
   * What the whole rule set says about one host: import, and through which
   * rules — or vetoed, and by which exclusion.
   *
   * Exclusions are evaluated first so the evaluation can short-circuit into
   * an explainable answer: "excluded by rule R" beats "matched rules A and B
   * and was then excluded" for the operator reading a dry run.
   */
  public static evaluateHost(
    rules: Array<AutoImportRuleCandidate>,
    host: DiscoveredNetworkDevice,
  ): AutoImportHostEvaluation {
    for (const rule of rules) {
      if (
        rule.isExclusion &&
        AutoImportRuleMatcher.ruleMatchesHost(rule, host)
      ) {
        return {
          shouldImport: false,
          matchedRules: [],
          excludedByRule: rule,
        };
      }
    }

    const matchedRules: Array<AutoImportRuleCandidate> = rules.filter(
      (rule: AutoImportRuleCandidate): boolean => {
        return (
          !rule.isExclusion && AutoImportRuleMatcher.ruleMatchesHost(rule, host)
        );
      },
    );

    return {
      shouldImport: matchedRules.length > 0,
      matchedRules: matchedRules,
    };
  }
}

export default AutoImportRuleMatcher;
