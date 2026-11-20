import { SecurityCaseMatchesJson } from "Common/Types/SecurityCase/SecurityCaseMatches";
import {
  ClaimedClientAddress,
  readClaimedClientAddress,
} from "Common/Utils/SecurityEvent/ClientAddressTrust";
import { canonicalAddress } from "Common/Utils/SecurityCase/SecurityConnectionMatch";

/*
 * AN ADDRESS A CASE'S REQUESTS ONLY CLAIMED, AS THE DASHBOARD READS IT
 * (#10416). Security Events never blames an address the sender could have
 * written, so such an address is never an entity of the case and never a
 * step to block. React-free, so a plain test reads it as the Response
 * Plan does.
 */

export interface CaseClaimedClientAddress {
  // The address the requests claimed; '' when a scrub rule hid it too.
  address: string;
}

/*
 * What a case's requests claimed, when none of its events names a verified
 * address to block: the first claimed address an event names, else a claim
 * a scrub rule hid. Null when there is no event, an event names its
 * address (the plan blocks that), or none claimed one.
 */
export function getCaseClaimedClientAddress(
  matches: SecurityCaseMatchesJson | null,
): CaseClaimedClientAddress | null {
  if (!matches) {
    return null;
  }

  let found: CaseClaimedClientAddress | null = null;

  for (const detection of matches.detections) {
    for (const event of detection.events) {
      if ((event.principalIp || "").trim()) {
        return null;
      }

      const claimed: ClaimedClientAddress | null =
        readClaimedClientAddress(event);

      if (claimed && (!found || (!found.address && claimed.address))) {
        found = { address: claimed.address };
      }
    }
  }

  return found;
}

/*
 * Every address a case's events only claimed - claimed by an event, and
 * named as its address by none - canonical, so a list of entities can be
 * held to it: whatever else names one, the plan never offers to block it.
 */
export function getCaseClaimedOnlyAddresses(
  matches: SecurityCaseMatchesJson | null,
): Set<string> {
  const claimed: Set<string> = new Set<string>();
  const named: Set<string> = new Set<string>();

  for (const detection of matches?.detections || []) {
    for (const event of detection.events) {
      const principal: string | null = canonicalAddress(event.principalIp);

      if (principal) {
        named.add(principal);
      }

      const claim: ClaimedClientAddress | null =
        readClaimedClientAddress(event);
      const address: string | null = claim
        ? canonicalAddress(claim.address)
        : null;

      if (address) {
        claimed.add(address);
      }
    }
  }

  for (const address of named) {
    claimed.delete(address);
  }

  return claimed;
}
