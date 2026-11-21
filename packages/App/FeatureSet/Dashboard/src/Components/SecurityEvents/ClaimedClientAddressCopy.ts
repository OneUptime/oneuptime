import { translationKey } from "Common/UI/Utils/TranslateTemplate";

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
 * What is said of it wherever it is shown, and the same naming the address:
 * What happened next, the Response Plan. The plan is built in Common for
 * the server and the browser (#10340), so these live with its words.
 */
export {
  CLAIMED_ADDRESS_NOT_VERIFIED,
  CLAIMED_NOT_VERIFIED,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanWords";
