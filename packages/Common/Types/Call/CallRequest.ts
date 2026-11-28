import URL from "../API/URL";
import Phone from "../Phone";

/*
 * A sentence a call says. Its words are text people read too - the call's
 * log, a gateway, a Notification service of the release before, which
 * speaks them as they are - and the fields after sayMessage say how a voice
 * says them, and where a call that asks for a key says them (CallService).
 * A Notification service of the release before leaves them out.
 */
export interface Say {
  sayMessage: string;
  /*
   * A record's number the sentence names - "INC-42" - whose prefix the voice
   * says letter by letter: read as written, "INC" is "Incorporated"
   * (Utils/Call/CallSpeech).
   */
  recordNumber?: string | undefined;
  /*
   * A code the sentence says, as the sentence writes it - a verification
   * code, "4  8  2  9  1  3" - whose characters a voice says one at a time,
   * with a pause between each, so that no voice, in any language, reads it
   * as one number (#11461, Utils/Call/CallSpeech): each its own <say-as
   * interpret-as="characters">, a <break> between them, for a voice that
   * reads SSML; as written for any other. A call in English says its code
   * as it always did, with no such field.
   */
  code?: string | undefined;
  /*
   * In a call that asks for a key (GatherInput), said after the prompt the
   * first time: the details, after "Press 1 to acknowledge ...". Said before
   * it without this.
   */
  afterPrompt?: boolean | undefined;
  // In a call that asks for a key, said again each time the prompt repeats.
  repeated?: boolean | undefined;
}

export interface OnCallInputRequest {
  [x: string]: Say; // input.
  default: Say; // what if there is no input or invalid input.
}

/*
 * A call's prompt for a key, and what it does with the key pressed. The call
 * says its sentences before it, with the prompt - and a key pressed while it
 * speaks stops it - says them again while no key is pressed, then waits
 * `timeoutInSeconds` and says `noInputMessage` (CallService).
 */
export interface GatherInput {
  // The prompt: "Press 1 to acknowledge, or 2 to escalate."
  introMessage: string;
  numDigits: number;
  // How long the call waits for a key once it has said everything.
  timeoutInSeconds: number;
  // What the call says when no key was pressed, before it ends.
  noInputMessage: string;
  onInputCallRequest: OnCallInputRequest;
  responseUrl: URL;
}

export enum CallAction {}

/*
 * THE SAME CALL IN THE LANGUAGE OF THE PERSON IT CALLS (#11066).
 *
 * A call's words are written in its person's language, as their texts and
 * emails are, but which voice speaks them is decided where the call is
 * placed: by the Twilio account that places it, which may have chosen a
 * voice or speak with its default one (Types/Call/CallVoice). So a call to
 * a person who reads another language carries its words twice: in English,
 * in `data`, as every call has - and in their language here. The
 * Notification service speaks these with a voice of that language when the
 * account has one, and `data` otherwise: one language's words are never
 * read by another language's voice. A Notification service of the release
 * before reads `data` only, and speaks English as it always has.
 */
export interface CallInLanguage {
  // The language the words are written in, as OneUptime names it: "de", "zh-CN".
  language: string;
  data: Array<Say | CallAction | GatherInput>;
}

export interface CallRequestMessage {
  data: Array<Say | CallAction | GatherInput>;
  // The same call in its person's language, when that is not English.
  inLanguage?: CallInLanguage | undefined;
}

export default interface CallRequest extends CallRequestMessage {
  to: Phone;
}

type IsHighRiskPhoneNumberFunction = (phoneNumber: Phone) => boolean;

/*
 * Country dialing codes flagged as high-risk for IRSF / SMS pumping fraud.
 * Twilio surfaces its current list dynamically in the Console; this set is
 * drawn from publicly reported fraud patterns and should be reviewed
 * periodically against Twilio Geo Permissions and Fraud Guard.
 */
const HIGH_RISK_COUNTRY_DIALING_CODES: Array<string> = [
  "+92", // Pakistan
  "+27", // South Africa
  "+213", // Algeria
  "+371", // Latvia
  "+370", // Lithuania
  "+372", // Estonia
  "+252", // Somalia
  "+232", // Sierra Leone
  "+231", // Liberia
  "+53", // Cuba
  "+960", // Maldives
  "+992", // Tajikistan
  "+880", // Bangladesh
  "+62", // Indonesia
  "+84", // Vietnam
  "+95", // Myanmar
];

export const isHighRiskPhoneNumber: IsHighRiskPhoneNumberFunction = (
  phoneNumber: Phone,
): boolean => {
  const phoneNumberString: string = phoneNumber.toString();

  return HIGH_RISK_COUNTRY_DIALING_CODES.some((code: string) => {
    return phoneNumberString.startsWith(code);
  });
};
