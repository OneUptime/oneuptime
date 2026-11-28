/*
 * The sentences a form's follow-up routes can refuse with
 * (Common/Types/Form/FormFollowUp, Common/Server/Utils/Form/FormFollowUp,
 * PublicMessageRateLimit's FormFollowUpInvite), in English, byte for byte:
 * when the server says one of these, the form's page shows it in the
 * reader's language - each is also a flat key in the Accounts locale files.
 * Any other sentence the server says is shown as it came.
 *
 * Kept on its own, with no imports, as FormMessage is, so the locale tests
 * in the App suite can read it without loading the browser client.
 */
enum FormFollowUpMessage {
  // 404: a link that opens nothing, a person no longer following, follow-ups off.
  NotAvailable = "This request is not available. The link may be out of date, or you may no longer be following it.",
  // 400: the address of somebody added.
  Email = "Enter one email address, such as jane@example.com.",
  NameTooLong = "A name cannot be more than 100 characters.",
  // 400: a request can have so many people following it.
  TooManyPeople = "A request can have at most 20 people following it.",
  AlreadyFollowing = "That person is already following this request.",
  // 400: a message with neither text nor files.
  MessageRequired = "Write a message, or attach a file.",
  // 400: a message to a request whose record was deleted.
  RecordGone = "This request was closed, so it cannot take new messages.",
  // 429: the public message limiter, for people added.
  TooManyPeopleAdded = "Too many people added from your network. Please wait a few minutes and try again.",
  TooManyRequestsAddedThem = "Too many requests added this email address in the last hour. Please try again later.",
}

export default FormFollowUpMessage;

const KNOWN_MESSAGES: ReadonlyArray<string> = Object.values(
  FormFollowUpMessage,
) as Array<string>;

export type IsKnownFormFollowUpMessageFunction = (message: string) => boolean;

// Whether a sentence is one of FormFollowUpMessage, so a locale file has it.
export const isKnownFormFollowUpMessage: IsKnownFormFollowUpMessageFunction = (
  message: string,
): boolean => {
  return KNOWN_MESSAGES.includes(message);
};
