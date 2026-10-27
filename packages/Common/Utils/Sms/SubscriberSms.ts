import { toGsm7Message } from "./Gsm7Text";

/*
 * THE TEXT MESSAGES A STATUS PAGE'S SUBSCRIBERS GET, AS ONEUPTIME WRITES THEM.
 *
 * A status page texts its SMS subscribers about incidents, their states and
 * notes, incident episodes, scheduled maintenance, announcements and
 * postmortems, and about their own subscription (the confirmation link, the
 * welcome, the manage link). A single character outside the GSM 7-bit
 * alphabet - a curly apostrophe in an incident's title or in the page's
 * name, an en dash, an emoji - made the whole text UCS-2, 70 characters a
 * part instead of 160, so each subscriber's text cost two or three times as
 * much (SmsSegments).
 *
 * OneUptime's own texts are written in GSM-7's characters wherever a
 * character has a plain look-alike (Gsm7Text: curly quotes as ' and ",
 * dashes as -, an emoji left out), as an on-call page's are. The links - the
 * details link, and the unsubscribe or confirmation link with its token -
 * go out exactly as written: a link is an address, and a look-alike would
 * lead somewhere else. Letters of other scripts are kept as written.
 *
 * A custom SMS template a team wrote for its page goes out as written, with
 * every value it places: the team chose its words and texts through its own
 * Twilio account (a custom SMS template is used only with one), where
 * Twilio's own Smart Encoding can do the same if they want it.
 *
 * Pure, with no Node or browser APIs. Linear in the text's length.
 */
export const writeDefaultSubscriberSms: (text: string) => string = (
  text: string,
): string => {
  return toGsm7Message(text).trim();
};

export default writeDefaultSubscriberSms;
