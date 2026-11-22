import {
  SecurityCaseMatchesJson,
  SecurityCaseMatchedDetectionJson,
  getDetectionEntity,
  getOpeningMatchedDetection,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import { getCaseClaimedOnlyAddresses } from "../CaseClaimedClientAddress";
import {
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
} from "../SecurityConnectionMatch";

/*
 * THE ADDRESSES A CASE MAY BE BLOCKED FROM (#10342): its public addresses -
 * the one its opening detection is about first, then the case's own - and
 * never one its requests only claimed (#10416): whoever sent them wrote it,
 * and blocking it could block a customer, a payment provider or a crawler.
 * A private or local address is never reached from the internet, so an edge
 * has nothing to block: its step is to find the host.
 *
 * The Response Plan offers Block for these, an address's chip on the case
 * offers Block..., and the server's one-step block from a case refuses any
 * other (SecurityPlaybookOneStepRuns). Each written the one way an address
 * is (canonicalAddress), each once.
 */
export function getCaseBlockableAddresses(data: {
  entities: ReadonlyArray<SecurityEntity>;
  matches: SecurityCaseMatchesJson | null;
}): Array<string> {
  const claimedOnly: Set<string> = getCaseClaimedOnlyAddresses(data.matches);
  const opening: SecurityCaseMatchedDetectionJson | null = data.matches
    ? getOpeningMatchedDetection(data.matches)
    : null;
  const first: SecurityEntity | null = opening
    ? getDetectionEntity(opening)
    : null;
  const addresses: Array<string> = [];

  for (const entity of [...(first ? [first] : []), ...data.entities]) {
    if (entity.type !== SecurityEntityType.IpAddress) {
      continue;
    }

    const address: string | null = canonicalAddress(entity.value);

    if (
      !address ||
      addresses.includes(address) ||
      claimedOnly.has(address) ||
      getSecurityAddressScope(address) !== SecurityAddressScope.Public
    ) {
      continue;
    }

    addresses.push(address);
  }

  return addresses;
}

// Whether `value` is one of the addresses the case may be blocked from.
export function isCaseBlockableAddress(data: {
  value: string;
  entities: ReadonlyArray<SecurityEntity>;
  matches: SecurityCaseMatchesJson | null;
}): boolean {
  const address: string | null = canonicalAddress(data.value);

  return Boolean(
    address &&
      getCaseBlockableAddresses({
        entities: data.entities,
        matches: data.matches,
      }).includes(address),
  );
}
