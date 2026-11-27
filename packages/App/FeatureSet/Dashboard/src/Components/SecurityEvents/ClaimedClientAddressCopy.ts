import { CheckedTrustedProxy } from "Common/Types/SecurityEvent/SecurityLogLineCheck";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { TrustedProxySource } from "Common/Utils/SecurityEvent/TrustedProxySources";

/*
 * THE WORDS FOR AN ADDRESS A REQUEST ONLY CLAIMED (#10416): one the sender
 * could have written - X-Forwarded-For's leftmost hop, client.address as
 * instrumentations fill it from that header, a Forwarded header - and
 * which Security Events never blames (Common/Utils/SecurityEvent/
 * ClientAddressTrust). Wherever an event or a case shows such an address,
 * it says it is claimed, not verified, and the Response Plan never offers
 * to block it. Each is an en.json key, looked up where it is drawn.
 *
 * React-free, so a plain test pins the words beside the rules that choose
 * them.
 */

// An event's field, beside Principal IP: the address the request claimed.
export const CLAIMED_IP: string = translationKey("Claimed IP");

/*
 * An event's field after it (#11046): the proxies the project trusts that
 * its verified address came through, so a person reads why the event names
 * the client a proxy forwarded and not the proxy.
 */
export const FORWARDED_BY: string = translationKey("Forwarded By");

/*
 * Why each proxy a checked event came through is trusted, after its
 * address under Forwarded By.
 */
export const FORWARDED_BY_REASONS: Readonly<
  Record<Exclude<TrustedProxySource, TrustedProxySource.Edge>, string>
> = {
  [TrustedProxySource.Private]: translationKey("Private address"),
  [TrustedProxySource.Listed]: translationKey("In your Trusted Proxies"),
  [TrustedProxySource.OwnLoadBalancer]: translationKey(
    "One of your load balancers",
  ),
  [TrustedProxySource.GoogleFrontEnd]: translationKey(
    "One of Google's front ends",
  ),
};

// An edge's range, by the edge's name: "In Cloudflare's published ranges".
export const FORWARDED_BY_EDGE_REASON: string = translationKey(
  "In {{edge}}'s published ranges",
);

// Why a proxy is trusted, in the reader's language.
export function getForwardedByReason(
  proxy: CheckedTrustedProxy,
  translator: Translator,
): string {
  if (proxy.source === TrustedProxySource.Edge) {
    return translator.translateTemplate(FORWARDED_BY_EDGE_REASON, {
      edge: proxy.edgeName,
    });
  }

  const reason: string = FORWARDED_BY_REASONS[proxy.source];

  return translator.translateText(reason) || reason;
}

/*
 * What is said of it wherever it is shown, and the same naming the address:
 * What happened next, the Response Plan. The plan is built in Common for
 * the server and the browser (#10340), so these live with its words.
 */
export {
  CLAIMED_ADDRESS_NOT_VERIFIED,
  CLAIMED_NOT_VERIFIED,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanWords";
