import { SecurityCaseMatchesJson } from "../../Types/SecurityCase/SecurityCaseMatches";
import {
  ClaimedClientAddress,
  TrustedProxies,
  UnvouchedForwarding,
  readClaimedClientAddress,
  readUnvouchedForwarding,
} from "../SecurityEvent/ClientAddressTrust";
import { canonicalAddress } from "./SecurityConnectionMatch";

/*
 * AN ADDRESS A CASE'S REQUESTS ONLY CLAIMED (#10416). Security Events never
 * blames an address the sender could have written, so such an address is
 * never an entity of the case and never a step to block. Read here, in
 * Common, so a case's Response Plan - built in Common for the server and
 * the browser (#10340) - holds to it wherever it is built; the Dashboard's
 * ClaimedClientAddressModel re-exports it.
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

/*
 * Every address a case's events name as a client that came through a proxy
 * the project does not vouch for (#11389) - one trusted only because it is
 * private, which may be a TCP proxy that passed on the X-Forwarded-For the
 * client wrote - canonical, each with the first such proxy: a block of one
 * is never made with nobody's approval. Read with the project's trusted
 * proxies as they are now (ClientAddressTrust.readUnvouchedForwarding).
 */
export function getCaseUnvouchedAddresses(data: {
  matches: SecurityCaseMatchesJson | null;
  proxies: TrustedProxies | undefined;
}): Map<string, UnvouchedForwarding> {
  const unvouched: Map<string, UnvouchedForwarding> = new Map();

  for (const detection of data.matches?.detections || []) {
    for (const event of detection.events) {
      const principal: string | null = canonicalAddress(event.principalIp);

      if (!principal || unvouched.has(principal)) {
        continue;
      }

      const forwarding: UnvouchedForwarding | null = readUnvouchedForwarding(
        event,
        data.proxies,
      );

      if (forwarding) {
        unvouched.set(principal, forwarding);
      }
    }
  }

  return unvouched;
}
