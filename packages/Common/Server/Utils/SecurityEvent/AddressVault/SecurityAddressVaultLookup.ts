import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  TrustedProxies,
  canNameResolvedClientAddress,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import {
  HiddenClientAddress,
  clearClientAddressScrubbed,
  isAddressVaultToken,
  readHiddenClientAddress,
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
 * A token the vault does not hold - older than its 30 days, hashed before
 * #10394, never written because the write failed or Security Events was
 * not reading then - leaves the event as the scan marked it: no address,
 * and the words that a scrub rule hid it. So does a lookup that fails: it
 * is logged, and the events are stored as marked.
 *
 * Only Security Events' scans call this (SecurityAddressVaultGuard.test.ts).
 */

/*
 * The token a Hash rule left where an event's client address was, when the
 * vault could hold it: a Hash rule's token of today's form ("[HASHED:" and
 * 16 hex characters). An older 8-hex token, what Redact or Mask left, or an
 * event that names its address: none.
 */
export function readVaultToken(event: {
  principalIp?: string | undefined;
  attributes?: unknown;
}): string | null {
  const hidden: HiddenClientAddress | null = readHiddenClientAddress(event);

  return hidden && isAddressVaultToken(hidden) ? hidden.value : null;
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

  clearClientAddressScrubbed(event.attributes);
}

export default class SecurityAddressVaultLookup {
  /*
   * Each event of a page whose client address a Hash rule hid, named by the
   * address the vault holds for its token (nameVaultAddress), in place. One
   * query a page; never throws. Returns how many events it named.
   */
  @CaptureSpan()
  public static async nameHashedAddresses(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<number> {
    const pending: Array<{ event: NormalizedSecurityEvent; token: string }> =
      [];

    for (const event of data.events) {
      const token: string | null = readVaultToken(event);

      if (token) {
        pending.push({ event, token });
      }
    }

    if (pending.length === 0) {
      return 0;
    }

    let addresses: Map<string, string>;

    try {
      addresses = await SecurityAddressVaultService.findAddressesOfTokens({
        projectId: data.projectId,
        tokens: pending.map(
          (item: { event: NormalizedSecurityEvent; token: string }): string => {
            return item.token;
          },
        ),
      });
    } catch (error) {
      logger.warn(
        `SecurityAddressVaultLookup: could not look up the hashed client addresses of project ${data.projectId.toString()}'s events; they are stored saying a scrub rule hid the address.`,
      );
      logger.warn(error);
      return 0;
    }

    /*
     * Only an address its sender could not have written is named (#10416):
     * a token is only ever the verified address's (readHiddenClientAddress
     * reads no claim), and one that turns out to be a proxy the project
     * trusts - a Hash rule hid a CDN's edge the request came through - is no
     * client. Such an event stays as marked: a scrub rule hid its address.
     */
    const proxies: TrustedProxies = await SecurityTrustedProxies.getForProject(
      data.projectId,
    );

    let named: number = 0;

    for (const item of pending) {
      const address: string | undefined = addresses.get(item.token);

      if (
        address &&
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
