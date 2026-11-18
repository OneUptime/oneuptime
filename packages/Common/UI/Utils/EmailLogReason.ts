import ServerSendingWords, {
  SERVER_EMAIL_NOT_SET_UP_MESSAGE,
} from "../../Types/ServerSending/ServerSendingWords";
import { Translator } from "./TranslateTemplate";

/*
 * WHY AN EMAIL OF THE PROJECT WENT OR DID NOT, AS ITS EMAIL LOG WORDS IT.
 *
 * An Email Log row keeps the mail service's answer. A send the server had
 * no email set up for reads as that, in the reader's words - not the SMTP
 * phrase older rows hold (ServerSendingWords); anything else is the mail
 * service's own answer, as it said it, which keeps its own direction on a
 * page read from the right.
 *
 * The Email Logs table's View Status Message and Email Not Sent on a
 * pending person's row (#9511) word it alike, from here - in the Dashboard
 * and the Admin Dashboard (#9518).
 */

export interface EmailLogReason {
  text: string;
  // The mail service's words as it said them, not OneUptime's own sentence.
  isAsSaid: boolean;
}

export const getEmailLogReason: (
  statusMessage: string | null | undefined,
  translator: Translator,
) => EmailLogReason = (
  statusMessage: string | null | undefined,
  translator: Translator,
): EmailLogReason => {
  if (ServerSendingWords.isServerEmailNotSetUpMessage(statusMessage)) {
    return {
      text:
        translator.translateText(SERVER_EMAIL_NOT_SET_UP_MESSAGE) ||
        SERVER_EMAIL_NOT_SET_UP_MESSAGE,
      isAsSaid: false,
    };
  }

  return {
    text: statusMessage || "",
    isAsSaid: true,
  };
};
