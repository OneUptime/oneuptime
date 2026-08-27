import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../Types/ObjectID";
import CidrMatchUtil from "../NetworkSite/CidrMatchUtil";
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
  monitorTemplateId?: ObjectID | string | null | undefined;
  ipMatchTarget?: string | null | undefined;
  sysNamePattern?: string | null | undefined;
  sysDescrPattern?: string | null | undefined;
  /*
   * Matched against the host's SNMP sysObjectID — the vendor's registered
   * enterprise OID (1.3.6.1.4.1.<enterprise>...), the canonical vendor
   * fingerprint. NOT the free-text pattern syntax of the two fields above:
   * an OID is a dotted numeric arc, so this is a whole-string '*' glob
   * (dots literal) or, with no '*', an arc-prefix test — see
   * matchesOidPattern. Only hosts whose scan carried the field can match: a
   * ping-only host, or one reported by a probe from before the field
   * existed, never satisfies a configured sysObjectIdPattern.
   */
  sysObjectIdPattern?: string | null | undefined;
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

/*
 * Strips the leading dot some agents prefix OIDs with (".1.3.6.1.4.1.9...")
 * so a pattern and a value in the two spellings still line up.
 */
function normalizeOid(value: string): string {
  return value.startsWith(".") ? value.substring(1) : value;
}

/*
 * OID-aware matching for the sysObjectID condition — deliberately NOT
 * RulePatternMatchUtil, whose regex-FIRST semantics are systematically wrong
 * for a dotted numeric arc: as a regex, "1.3.6.1.4.1.9.*" has every '.'
 * matching any character and is unanchored, so it also matches enterprise
 * 94, 990, 9148... — the exact vendors a "Cisco only" rule exists to keep
 * out, in a pipeline that creates devices unattended. Here:
 *
 *   - A pattern containing '*' is a whole-string glob with LITERAL dots
 *     (CidrMatchUtil's ReDoS-safe matcher): "1.3.6.1.4.1.9.*" matches the
 *     Cisco subtree and nothing else.
 *   - A pattern with no '*' is an arc-prefix test on sub-identifier
 *     boundaries: "1.3.6.1.4.1.9" matches itself and everything under it,
 *     and can never match "1.3.6.1.4.1.94" — the same comparison
 *     SnmpVendorTemplateUtil.getEnterpriseNumber makes.
 */
export function matchesOidPattern(
  value: string | undefined,
  pattern: string,
): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  const oid: string = normalizeOid(value.trim());
  const oidPattern: string = normalizeOid(pattern);

  if (oidPattern.includes("*")) {
    return CidrMatchUtil.hostnameMatchesWildcard(oid, oidPattern);
  }

  return oid === oidPattern || oid.startsWith(oidPattern + ".");
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
    const sysObjectIdPattern: string = (rule.sysObjectIdPattern || "").trim();

    // A rule with no conditions matches nothing — the site-rule precedent.
    if (
      !ipMatchTarget &&
      !sysNamePattern &&
      !sysDescrPattern &&
      !sysObjectIdPattern
    ) {
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

    if (
      sysObjectIdPattern &&
      !matchesOidPattern(clampSubject(host.sysObjectId), sysObjectIdPattern)
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
