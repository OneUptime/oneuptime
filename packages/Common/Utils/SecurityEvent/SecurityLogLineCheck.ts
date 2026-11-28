import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  CheckedTrustedProxy,
  MAX_SHOWN_EVENTS,
  SecurityLogLineCheckResult,
  splitPastedLogLines,
} from "../../Types/SecurityEvent/SecurityLogLineCheck";
import { TrustedProxies, readForwardedBy } from "./ClientAddressTrust";
import SecurityLogParser from "./LogParsers/SecurityLogParser";
import {
  judgeSensitiveFileAnswers,
  keepSensitiveFileOutcomes,
} from "./SensitiveFileAnswers";
import {
  TrustedProxyReason,
  TrustedProxySources,
  findTrustedProxySource,
  trustedProxiesOf,
} from "./TrustedProxySources";

/*
 * WHAT A PASTED LINE BECOMES, AS THE SCAN WOULD STORE IT (#11046).
 *
 * The log scan reads each line with SecurityLogParser and the project's
 * trusted proxies (Server/Utils/SecurityEvent/LogScan/SecurityLogScanner),
 * then, before it stores a page of events, judges the sensitive files a
 * site answered against what the same site answered the page's other
 * requests. This reads a paste the same way, the paste being the page:
 * the same parser, the same trusted proxies made from the same sources
 * (trustedProxiesOf), the same judgement.
 *
 * What it leaves out is what a paste does not have, or must not reach: the
 * line's attributes and the trace it was written in (a pasted line has
 * neither), threat intel's matches (no field the check shows), and the
 * address and user vaults: the scan names the address or the user behind a
 * Hash rule's token from them, and a paste that did so would let anyone who
 * can read security events unmask every token in the project's logs by
 * pasting it. A hidden address stays hidden here.
 *
 * Beside the events, why each proxy they say they came through is trusted,
 * so the check can say why an event names the client a proxy forwarded and
 * not the line's first field. Pure.
 */

export function checkSecurityLogLines(data: {
  text: string;
  sources: TrustedProxySources;
  now: Date;
}): SecurityLogLineCheckResult {
  const trustedProxies: TrustedProxies = trustedProxiesOf(data.sources);
  const lines: Array<string> = splitPastedLogLines(data.text);
  const parsed: Array<NormalizedSecurityEvent> = [];

  for (const body of lines) {
    try {
      parsed.push(
        ...SecurityLogParser.parse({
          body,
          attributes: {},
          time: data.now,
          trustedProxies,
        }),
      );
    } catch {
      // A line no parser can read makes no event, as in the scan.
    }
  }

  // As the scan judges a page of events before it stores them.
  const events: Array<NormalizedSecurityEvent> =
    judgeSensitiveFileAnswers(parsed);

  keepSensitiveFileOutcomes(events);

  const shown: Array<NormalizedSecurityEvent> = events.slice(
    0,
    MAX_SHOWN_EVENTS,
  );
  const proxies: Array<CheckedTrustedProxy> = [];
  const seen: Set<string> = new Set<string>();

  for (const event of shown) {
    for (const address of readForwardedBy(event)) {
      if (seen.has(address)) {
        continue;
      }

      seen.add(address);

      const reason: TrustedProxyReason | null = findTrustedProxySource(
        address,
        data.sources,
      );

      if (reason) {
        proxies.push(reason);
      }
    }
  }

  return {
    linesRead: lines.length,
    eventCount: events.length,
    events: shown,
    trustedProxies: proxies,
  };
}
