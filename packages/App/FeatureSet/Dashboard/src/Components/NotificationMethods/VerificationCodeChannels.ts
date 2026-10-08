import { PluralTemplate, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the verify dialog (VerificationCodeModal) says, channel by channel:
 * the people's own SMS numbers, call numbers, WhatsApp numbers and numbers
 * for incoming calls (User Settings > Notification Methods, and Incoming
 * Call Phone Numbers).
 *
 * The dialog used to be four copies of a form whose description was fixed
 * text - "We have sent a SMS with your verification code" - shown whatever
 * had happened, including when nothing could be sent because the project had
 * no Twilio account. Sending another code was a separate row action behind
 * the ⋯ menu, with a confirmation of its own and a "Code sent successfully"
 * dialog after it, so people could not tell whether Verify sent a code or
 * whether they had to press Resend first. Now one dialog asks the server
 * where the code stands (the channel's verification-status route) and says
 * that: when the code went out and until when it works, or that it expired,
 * or why no code can be sent - with the way to send another one right there,
 * counting down the cooldown.
 *
 * Kept free of React, so the tests read these exact strings. Every sentence
 * is wrapped in translationKey() so npm run i18n:extract finds it; the dialog
 * translates them where it draws them.
 */

export enum VerificationCodeChannel {
  SMS = "SMS",
  Call = "Call",
  WhatsApp = "WhatsApp",
  IncomingCallNumber = "IncomingCallNumber",
}

export interface VerificationCodeChannelDefinition {
  channel: VerificationCodeChannel;
  // The channel's API route, under which verify, resend and status live.
  apiRoute: string;
  // The dialog's title.
  title: string;
  // A code is waiting: when it went out, and to where.
  codeSentSentence: string;
  // The code that went out has run out of time.
  codeExpiredSentence: string;
  // There is no code to enter.
  noCodeSentence: string;
  // What to do about an expired or missing code.
  sendCodeNextStep: string;
  // The control that sends another code.
  sendCodeButtonText: string;
  // That control while the code is on its way.
  sendingCodeButtonText: string;
  // Said once another code went out.
  codeResentSentence: string;
  // Small print under the field: what to do if the code does not come.
  notArrivedHint: string;
}

const SMS_COPY: Omit<VerificationCodeChannelDefinition, "channel" | "apiRoute"> =
  {
    title: translationKey("Verify Phone Number"),
    codeSentSentence: translationKey(
      "We sent a 6-digit code by SMS to {{destination}} at {{sentAt}}.",
    ),
    codeExpiredSentence: translationKey(
      "The code we sent to {{destination}} has expired.",
    ),
    noCodeSentence: translationKey(
      "There is no code waiting for {{destination}}.",
    ),
    sendCodeNextStep: translationKey(
      "Send a new code to verify this number.",
    ),
    sendCodeButtonText: translationKey("Send a new code"),
    sendingCodeButtonText: translationKey("Sending…"),
    codeResentSentence: translationKey(
      "A new code is on its way to {{destination}}.",
    ),
    notArrivedHint: translationKey(
      "Texts can take a minute to arrive. If it does not come, Project Settings > Notification Logs shows what happened to it.",
    ),
  };

const VERIFICATION_CODE_CHANNELS: Readonly<
  Record<VerificationCodeChannel, VerificationCodeChannelDefinition>
> = {
  [VerificationCodeChannel.SMS]: {
    channel: VerificationCodeChannel.SMS,
    apiRoute: "/user-sms",
    ...SMS_COPY,
  },
  [VerificationCodeChannel.Call]: {
    channel: VerificationCodeChannel.Call,
    apiRoute: "/user-call",
    title: translationKey("Verify Phone Number"),
    codeSentSentence: translationKey(
      "We called {{destination}} at {{sentAt}} and read out a 6-digit code.",
    ),
    codeExpiredSentence: translationKey(
      "The code we read out to {{destination}} has expired.",
    ),
    noCodeSentence: translationKey(
      "There is no code waiting for {{destination}}.",
    ),
    sendCodeNextStep: translationKey(
      "Have us call with a new code to verify this number.",
    ),
    sendCodeButtonText: translationKey("Call me with a new code"),
    sendingCodeButtonText: translationKey("Calling…"),
    codeResentSentence: translationKey(
      "We are calling {{destination}} with a new code.",
    ),
    notArrivedHint: translationKey(
      "A number you have verified for SMS is verified for calls without a code, so you can verify it there instead.",
    ),
  },
  [VerificationCodeChannel.WhatsApp]: {
    channel: VerificationCodeChannel.WhatsApp,
    apiRoute: "/user-whatsapp",
    title: translationKey("Verify WhatsApp Number"),
    codeSentSentence: translationKey(
      "We sent a 6-digit code on WhatsApp to {{destination}} at {{sentAt}}.",
    ),
    codeExpiredSentence: translationKey(
      "The code we sent to {{destination}} has expired.",
    ),
    noCodeSentence: translationKey(
      "There is no code waiting for {{destination}}.",
    ),
    sendCodeNextStep: translationKey(
      "Send a new code to verify this number.",
    ),
    sendCodeButtonText: translationKey("Send a new code"),
    sendingCodeButtonText: translationKey("Sending…"),
    codeResentSentence: translationKey(
      "A new code is on its way to {{destination}}.",
    ),
    notArrivedHint: translationKey(
      "If it does not come, Project Settings > Notification Logs shows what happened to it.",
    ),
  },
  [VerificationCodeChannel.IncomingCallNumber]: {
    channel: VerificationCodeChannel.IncomingCallNumber,
    apiRoute: "/user-incoming-call-number",
    ...SMS_COPY,
  },
};

export const getVerificationCodeChannel: (
  channel: VerificationCodeChannel,
) => VerificationCodeChannelDefinition = (
  channel: VerificationCodeChannel,
): VerificationCodeChannelDefinition => {
  return VERIFICATION_CODE_CHANNELS[channel];
};

// What every channel's dialog says alike.
export const VerificationCodeCopy: {
  // The field.
  codeFieldTitle: string;
  // How long the waiting code works.
  codeExpirySentence: string;
  // The dialog's action.
  verifyButtonText: string;
  // Before the control that sends another code.
  didNotGetIt: string;
  // How long until another code may be sent.
  cooldown: PluralTemplate;
  // Above the reason no code can be sent.
  cannotSendTitle: string;
  // The field is not filled in yet.
  enterTheCode: string;
  // After a code is accepted, when there is more to say than that.
  verifiedTitle: string;
  // The number was verified for calls too.
  alsoVerifiedForCalls: string;
  // The number turned out to be verified already (by SMS, for a call number).
  alreadyVerified: string;
  // The status could not be read.
  statusUnavailable: string;
  // Closes the dialog once it is done.
  doneButtonText: string;
} = {
  codeFieldTitle: translationKey("Verification Code"),
  codeExpirySentence: translationKey("It works until {{expiresAt}}."),
  verifyButtonText: translationKey("Verify"),
  didNotGetIt: translationKey("Didn't get it?"),
  cooldown: {
    one: "You can ask for a new code in {{count}} second.",
    other: "You can ask for a new code in {{count}} seconds.",
  },
  cannotSendTitle: translationKey("A code can't be sent right now"),
  enterTheCode: translationKey("Enter the 6-digit code."),
  verifiedTitle: translationKey("Phone Number Verified"),
  alsoVerifiedForCalls: translationKey(
    "{{destination}} is verified. It is verified for calls too, so you will not need another code there.",
  ),
  alreadyVerified: translationKey("{{destination}} is verified."),
  statusUnavailable: translationKey(
    "We could not check whether a code is waiting for this number. If you have one, you can still enter it.",
  ),
  doneButtonText: translationKey("Done"),
};

/*
 * A number added for calls that was already verified for SMS needs no code:
 * the server verifies it on the spot (UserCallService.isNumberVerifiedForSms).
 * The Call list says so, instead of opening a dialog asking for a code that
 * was never sent.
 */
export const CallNumberVerifiedBySmsCopy: {
  title: string;
  description: string;
} = {
  title: translationKey("Phone Number Verified"),
  description: translationKey(
    "{{destination}} is already verified for SMS, so it is verified for calls too. No code needed.",
  ),
};

/*
 * Heard by the Call list when a number verified for SMS verified call
 * numbers with it, so they show as verified without a reload.
 */
export const CALL_NUMBERS_VERIFIED_BY_SMS_EVENT: string =
  "oneuptime:call-numbers-verified-by-sms";
