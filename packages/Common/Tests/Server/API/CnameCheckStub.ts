import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "../../../Types/CustomDomain/DnsRecordCheck";

/*
 * What a custom domain service's checkCname answers, for route tests that
 * stub the CNAME check: found (pointing at the target), or nothing found.
 * The routes call checkCname, which says what was looked up; isCnameValid
 * is the sweeps' yes or no on top of it.
 */
export function stubbedCnameCheck(
  fullDomain: string,
  found: boolean,
  expectedTarget: string,
): DnsRecordCheck {
  return {
    type: DnsRecordType.CNAME,
    name: fullDomain,
    expectedValue: expectedTarget,
    foundValues: found ? [expectedTarget] : [],
    outcome: found
      ? DnsRecordCheckOutcome.Found
      : DnsRecordCheckOutcome.NotFound,
    checkedAt: new Date(),
  };
}
