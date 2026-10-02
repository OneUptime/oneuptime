/*
 * The sentences the public incident form page can show when something goes
 * wrong, in English. Each is also a flat key in the Accounts locale files,
 * so the page shows it in the reporter's language.
 *
 * All but the last are the server's own words, byte for byte (the routes
 * answer with them, and IncidentFormServerMessages.test.ts compares each
 * with the server's constant): when the server says one of these, the page
 * can translate what it said. Any other sentence - a list of the answers it
 * refused, say - is shown as it came. The last is the page's own, for a form
 * it could not load at all.
 *
 * Kept on its own, with no imports, so the locale tests in the App suite can
 * read it without loading the browser client.
 */
enum IncidentFormMessage {
  // 404: unknown or malformed link, form turned off, project off plan.
  NotAvailable = "This form is not available. It may have been turned off, or the link may be out of date.",
  // 403: the form's IP allowlist does not include the visitor's network.
  NetworkNotAllowed = "This form can only be opened from an allowed network.",
  // 429 on submit: this network sent too many reports to the form.
  TooManySubmissions = "Too many submissions from your network. Please wait a few minutes and try again.",
  // 429 on submit: the form as a whole is receiving too many reports.
  FormBusy = "This form is receiving too many reports right now. Please try again later.",
  // 429 on reading the form.
  TooManyRequests = "Too many requests. Please try again later.",
  // 400: the captcha was not answered, or its answer was refused.
  CaptchaMissing = "Captcha token is missing. Please complete the verification challenge.",
  CaptchaFailed = "Captcha verification failed. Please try again.",
  // 400: neither the reporter, the form nor its template names a severity.
  NoSeverity = "This form cannot declare an incident because it has no severity. Please let the team that shared it know.",
  // 503: the submit rate limiter's counter is down, so submits are refused.
  ReportsUnavailable = "Reports cannot be accepted right now. Please try again in a few minutes.",
  // 500 on submit, and every other failure this page cannot name.
  SubmitFailed = "Your report could not be submitted. Please try again in a few minutes.",
  // Any failure to read the form other than the refusals above.
  LoadFailed = "This form could not be loaded. Please try again in a few minutes.",
}

export default IncidentFormMessage;

const KNOWN_MESSAGES: ReadonlyArray<string> = Object.values(
  IncidentFormMessage,
) as Array<string>;

export type IsKnownIncidentFormMessageFunction = (message: string) => boolean;

/**
 * Whether a sentence is one of IncidentFormMessage, so a locale file has it:
 * only those are translated, and only those are looked up at all - anything
 * else the server says (it can quote a field name) is shown as it came.
 */
export const isKnownIncidentFormMessage: IsKnownIncidentFormMessageFunction = (
  message: string,
): boolean => {
  return KNOWN_MESSAGES.includes(message);
};
