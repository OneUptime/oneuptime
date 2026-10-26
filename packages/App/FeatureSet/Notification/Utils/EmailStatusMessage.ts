import ColumnLength from "Common/Types/Database/ColumnLength";

/*
 * WHAT AN EMAIL'S LOG ROW SAYS OF IT.
 *
 * MailService writes a status message on an email's Email Log row and on
 * its on-call timeline entry. Both columns hold at most
 * MAX_EMAIL_STATUS_MESSAGE_LENGTH characters (ColumnLength.LongText), and
 * the database layer refuses a longer value instead of cutting it: the row
 * is not written, and an email that went is reported as failed.
 *
 * A mail service's answer is written outside OneUptime and can be any
 * length - SendGrid lists every error it finds, one for each image - so
 * every status message MailService writes is clipped to fit
 * (toEmailStatusMessage), and an email sent without its images keeps both
 * ends of its message: that it went, and that delivery is not tracked
 * (getSentWithoutImagesStatusMessage).
 */

export const MAX_EMAIL_STATUS_MESSAGE_LENGTH: number = ColumnLength.LongText;

const ELLIPSIS: string = "…";

/*
 * What every email that went says it was not: delivered. Its first two
 * sentences say it alone, where a mail service's answer needs the room
 * (getSentWithoutImagesStatusMessage).
 */
export const EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT: string =
  "This does not mean the email was delivered. We do not track email delivery.";

export const EMAIL_DELIVERY_NOT_TRACKED: string = `${EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT} If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.`;

export const EMAIL_SENT_STATUS_MESSAGE: string = `Email sent successfully. ${EMAIL_DELIVERY_NOT_TRACKED}`;

const SENT_WITHOUT_IMAGES_PREFIX: string =
  "Email sent successfully without its images, which the mail service refused: ";

const SENTENCE_END_PATTERN: RegExp = /[.!?…]$/;

const isHighSurrogate: (code: number) => boolean = (code: number): boolean => {
  return code >= 0xd800 && code <= 0xdbff;
};

/*
 * `text` as it is when it has at most `maxLength` characters; else cut to
 * end with an ellipsis, `maxLength` characters in all - never between the
 * two halves of a surrogate pair, which would leave half a character.
 */
export const clipText: (text: string, maxLength: number) => string = (
  text: string,
  maxLength: number,
): string => {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength < ELLIPSIS.length) {
    return "";
  }

  let cut: number = maxLength - ELLIPSIS.length;

  if (cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1))) {
    cut--;
  }

  return `${text.slice(0, cut).trimEnd()}${ELLIPSIS}`;
};

// A status message as its column holds it (see the top of this file).
export const toEmailStatusMessage: (message: string) => string = (
  message: string,
): string => {
  return clipText(message, MAX_EMAIL_STATUS_MESSAGE_LENGTH);
};

/*
 * What the Email Log says of an email that went without its images, the
 * mail service having refused it with them (MailService
 * sendEvenWithoutImages): `refusal` is the service's answer, as its provider
 * explains it, made one sentence. The message fits its column with both of
 * its ends - that the email went, and that its delivery is not tracked -
 * and the service's answer comes before the general advice on delivery: an
 * answer too long to sit beside all of it sits beside its first two
 * sentences, and one too long for that is cut.
 */
export const getSentWithoutImagesStatusMessage: (refusal: string) => string = (
  refusal: string,
): string => {
  const answer: string = refusal.trim() || "it gave no reason";
  const sentence: string = SENTENCE_END_PATTERN.test(answer)
    ? answer
    : `${answer}.`;

  const whole: string = `${SENT_WITHOUT_IMAGES_PREFIX}${sentence} ${EMAIL_DELIVERY_NOT_TRACKED}`;

  if (whole.length <= MAX_EMAIL_STATUS_MESSAGE_LENGTH) {
    return whole;
  }

  // Cut only when the answer does not fit beside the note in short either.
  const room: number =
    MAX_EMAIL_STATUS_MESSAGE_LENGTH -
    SENT_WITHOUT_IMAGES_PREFIX.length -
    " ".length -
    EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT.length;

  return `${SENT_WITHOUT_IMAGES_PREFIX}${clipText(sentence, room)} ${EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT}`;
};
