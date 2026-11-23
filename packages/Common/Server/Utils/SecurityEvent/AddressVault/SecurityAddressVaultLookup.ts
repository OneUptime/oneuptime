import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  TrustedProxies,
  canNameResolvedClientAddress,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import {
  HiddenAddress,
  SCRUBBED_ADDRESS_ROLES,
  ScrubbedAddressRole,
  clearAddressScrubbed,
  clearClientAddressScrubbed,
  isAddressVaultToken,
  readHiddenAddress,
} from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import SecurityAddressVaultService from "../../../Services/SecurityAddressVaultService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import SecurityTrustedProxies from "../SecurityTrustedProxies";

/*
 * SECURITY EVENTS' HALF OF THE ADDRESS VAULT (#10395): the scans name the
 * address behind a Hash rule's token.
 *
 * Both scans mark an event whose client address a scrub rule hid
 * (Utils/SecurityEvent/ScrubbedAddress.ts, #10397): a span's client
 * address attribute (TelemetryScan/TraceSecurityScan.ts), a web access
 * log's client field, a log record's client address attribute, or the
 * address of the trace a log line was followed into
 * (LogScan/SecurityLogScanner.ts). For a Hash rule the marker keeps the
 * token exactly as the rule left it - read from the client field the
 * parser takes the address from, never from anywhere else in the line, so
 * a sender cannot have the vault name an address of their choosing.
 *
 * Here, before a page of events is stored - after the request follow-up,
 * so a token its trace brought is looked up too, and before threat intel
 * and the naming of the rule that hid an address - the page's tokens are
 * looked up in the vault, in one query (SecurityAddressVaultService.
 * findAddressesOfTokens). A token the vault holds names the event's
 * address, as if the record had held it:
 *
 *   - principalIp, which threat intel, entity risk, campaigns, the
 *     Response Plan and the blocklist read as they always have;
 *   - the request's client address (SECURITY_REQUEST_ATTRIBUTES.clientAddress);
 *   - an observable, so threat intel matches it;
 *   - and the marker is cleared: nothing says the address was hidden.
 *
 * An event has a second address, where its activity went (#10419): a
 * firewall's destination, the far end of an outbound transfer. The log
 * scan marks a token there too (ScrubbedAddressRole.Target), from the
 * field the format reads the destination from, and the same one lookup a
 * page names it: targetIp and an observable, with its marker cleared. A
 * destination is the address a connection went to, whoever chose it, so
 * it is named as the record names it.
 *
 * A token the vault does not hold - older than its 30 days, hashed before
 * #10394, never written because the write failed or Security Events was
 * not reading then - leaves the event as the scan marked it: no address,
 * and the words that a scrub rule hid it. So does a lookup that fails: it
 * is logged, and the events are stored as marked.
 *
 * Only Security Events' scans call this (SecurityAddressVaultGuard.test.ts).
 */

/*
 * The token a Hash rule left where an event's address of a role was, when
 * the vault could hold it: a Hash rule's token of today's form ("[HASHED:"
 * and 16 hex characters). An older 8-hex token, what Redact or Mask left,
 * or an event that names that address: none.
 */
export function readVaultTokenOf(
  event: {
    principalIp?: string | undefined;
    targetIp?: string | undefined;
    attributes?: unknown;
  },
  role: ScrubbedAddressRole,
): string | null {
  const hidden: HiddenAddress | null = readHiddenAddress(event, role);

  return hidden && isAddressVaultToken(hidden) ? hidden.value : null;
}

// The token where an event's client address was: see readVaultTokenOf.
export function readVaultToken(event: {
  principalIp?: string | undefined;
  attributes?: unknown;
}): string | null {
  return readVaultTokenOf(event, ScrubbedAddressRole.Principal);
}

// The address among the event's observables, once, whatever its case.
function addObservable(event: NormalizedSecurityEvent, address: string): void {
  const observables: Array<string> = event.observables || [];
  const lower: string = address.toLowerCase();

  if (
    !observables.some((observable: string): boolean => {
      return observable.toLowerCase() === lower;
    })
  ) {
    observables.push(address);
  }

  event.observables = observables;
}

/*
 * The event names the address the vault holds for its token: in
 * principalIp, as the request's client address and among its observables,
 * with the marker that said it was hidden cleared.
 */
export function nameVaultAddress(
  event: NormalizedSecurityEvent,
  address: string,
): void {
  event.principalIp = address;
  event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress] = address;
  addObservable(event, address);
  clearClientAddressScrubbed(event.attributes);
}

/*
 * The event names the destination the vault holds for its token (#10419):
 * in targetIp and among its observables, so threat intel matches a
 * connection to a known-bad address, with the marker that said it was
 * hidden cleared.
 */
export function nameVaultTargetAddress(
  event: NormalizedSecurityEvent,
  address: string,
): void {
  event.targetIp = address;
  addObservable(event, address);
  clearAddressScrubbed(event.attributes, ScrubbedAddressRole.Target);
}

// A token to look up, and which event's address of which role it hid.
interface PendingToken {
  event: NormalizedSecurityEvent;
  role: ScrubbedAddressRole;
  token: string;
}

export default class SecurityAddressVaultLookup {
  /*
   * Each address of a page's events a Hash rule hid - the client's, and the
   * destination's (#10419) - named by the address the vault holds for its
   * token (nameVaultAddress, nameVaultTargetAddress), in place. One lookup
   * a page, whatever formats its events are of; never throws. Returns how
   * many addresses it named.
   */
  @CaptureSpan()
  public static async nameHashedAddresses(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<number> {
    const pending: Array<PendingToken> = [];

    for (const event of data.events) {
      for (const role of SCRUBBED_ADDRESS_ROLES) {
        const token: string | null = readVaultTokenOf(event, role);

        if (token) {
          pending.push({ event, role, token });
        }
      }
    }

    if (pending.length === 0) {
      return 0;
    }

    let addresses: Map<string, string>;

    try {
      addresses = await SecurityAddressVaultService.findAddressesOfTokens({
        projectId: data.projectId,
        tokens: pending.map((item: PendingToken): string => {
          return item.token;
        }),
      });
    } catch (error) {
      logger.warn(
        `SecurityAddressVaultLookup: could not look up the hashed addresses of project ${data.projectId.toString()}'s events; they are stored saying a scrub rule hid the address.`,
      );
      logger.warn(error);
      return 0;
    }

    /*
     * Only a client address its sender could not have written is named
     * (#10416): a token is only ever the verified address's
     * (readHiddenClientAddress reads no claim), and one that turns out to
     * be a proxy the project trusts - a Hash rule hid a CDN's edge the
     * request came through - is no client. Such an event stays as marked:
     * a scrub rule hid its address. The proxies are read once, for the
     * first client address the vault holds.
     */
    let proxies: TrustedProxies | null = null;
    let named: number = 0;

    for (const item of pending) {
      const address: string | undefined = addresses.get(item.token);

      if (!address) {
        continue;
      }

      if (item.role === ScrubbedAddressRole.Target) {
        nameVaultTargetAddress(item.event, address);
        named++;
        continue;
      }

      proxies =
        proxies || (await SecurityTrustedProxies.getForProject(data.projectId));

      if (
        canNameResolvedClientAddress({
          attributes: item.event.attributes,
          address,
          proxies,
        })
      ) {
        nameVaultAddress(item.event, address);
        named++;
      }
    }

    return named;
  }
}
