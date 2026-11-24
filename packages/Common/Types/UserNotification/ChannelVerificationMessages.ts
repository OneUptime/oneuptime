import { translationKey } from "../Translator";

/*
 * WHAT A NOTIFICATION METHOD'S ROUTES ANSWER WHEN THEY CANNOT VERIFY IT OR
 * SEND IT A TEST (#6836, #7272).
 *
 * What happened and what to do next, never "Item not found", "Invalid item
 * ID", "Invalid user ID" or "Invalid code". A method that is not the
 * caller's is answered exactly like one that does not exist (notFound), so
 * the answer never says whether somebody else has the address, the number
 * or the account: the e-mail, SMS, call, WhatsApp and incoming-call routes
 * (ChannelVerification), and Slack's, Microsoft Teams', Mattermost's,
 * Telegram's and a webhook's.
 *
 * Each sentence is a key of the Dashboard's locales (this file is a "keys"
 * root of its string extractor): the verify dialog and a Send Test's dialog
 * say them in the reader's language. React-free and server-safe: the server
 * throws these, the Dashboard reads them.
 */
export const ChannelVerificationMessages: {
  noItem: string;
  noItemToTest: string;
  noCode: string;
  notSignedIn: string;
  notFound: string;
  alreadyVerified: string;
  incorrectCode: string;
  expired: string;
  tooManyAttempts: string;
} = {
  noItem: translationKey(
    "The request did not say which notification method to verify. Reload the page and try again.",
  ),
  // A Send Test that did not say which method to send it to.
  noItemToTest: translationKey(
    "The request did not say which notification method to test. Reload the page and try again.",
  ),
  noCode: translationKey("Enter the code from the message we sent."),
  notSignedIn: translationKey(
    "Sign in again, then verify this notification method.",
  ),
  notFound: translationKey(
    "This notification method is not in your list any more. Add it again, then verify it.",
  ),
  alreadyVerified: translationKey(
    "This notification method is already verified. You can close this dialog.",
  ),
  incorrectCode: translationKey(
    "That code is not right. Enter the code from the latest message we sent, or send a new code.",
  ),
  expired: translationKey(
    "This verification code has expired. Please request a new code.",
  ),
  tooManyAttempts: translationKey(
    "Too many incorrect attempts. This verification code is no longer valid. Please request a new code.",
  ),
};

export default ChannelVerificationMessages;
