/*
 * WHAT A WORKFLOW STEP SAYS WHEN ANOTHER SYSTEM REFUSED IT AND SAID NOTHING
 * (#7268).
 *
 * A step that sends to another system - Slack, Microsoft Teams, Discord,
 * Telegram, any API - hands that system's own words on through its error
 * port when the system gives some. When it gives none, each step said
 * "Server Error.", one of the empty phrases (EMPTY_ERROR_PHRASES): the run
 * log read as if OneUptime had failed, and said nothing to check. The step
 * says now, in OneUptime's words, what did not happen, that the other
 * system did not say why, and what to check.
 */
export const getOtherSystemSaidNothing: (data: {
  // What did not happen: "The message was not sent to Slack."
  whatFailed: string;
  // The other system, by its name: "Slack".
  system: string;
  // What to check: "Check the step's webhook URL, then run the workflow again."
  whatToCheck: string;
}) => string = (data: {
  whatFailed: string;
  system: string;
  whatToCheck: string;
}): string => {
  return `${data.whatFailed} ${data.system} did not say why. ${data.whatToCheck}`;
};

// A chat tool that refused the message and said nothing.
export const getChatMessageNotSent: (
  system: string,
  whatToCheck?: string,
) => string = (
  system: string,
  whatToCheck: string = "Check the step's webhook URL and the message, then run the workflow again.",
): string => {
  return getOtherSystemSaidNothing({
    whatFailed: `The message was not sent to ${system}.`,
    system: system,
    whatToCheck: whatToCheck,
  });
};

// What a Telegram step checks: its bot and the chat it posts to.
export const TELEGRAM_WHAT_TO_CHECK: string =
  "Check the step's bot token and chat ID, then run the workflow again.";
