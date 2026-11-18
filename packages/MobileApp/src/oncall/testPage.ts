/*
 * A TEST PAGE ON THE PHONE (#7014).
 *
 * A test page proves a page reaches somebody, with no incident or alert
 * behind it (the server's Common/Types/OnCallDutyPolicy/OnCallTestPage).
 * Every message says TEST first, and each can be answered: an email's, a
 * text's or a chat message's link, a call's 1 - and its push, here:
 *
 *   - under the push, on the lock screen and in the notification shade, one
 *     action of its own: "Acknowledge test page" (notifications/
 *     categories.ts). Never a real page's Acknowledge and Escalate - those
 *     act on a record, and a test has none;
 *   - tapped, or answered with that action, the push opens the test page's
 *     own screen (screens/TestPageScreen.tsx), after the phone is unlocked
 *     and after the app's own lock. It says it is a test and that nothing
 *     is wrong, and acknowledges it - once, signed in as the person - by the
 *     rule every message of a test answers by, so the Dashboard's result
 *     says they acknowledged it by push notification, and how fast.
 *
 * A real page's actions never reach that screen, and its action never
 * reaches a record's screen (notifications/handlers.ts).
 *
 * The words are the server's, as the page a test's link opens says them
 * (ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE and the rest). The app is built
 * without Common's code, so it keeps its own copy; Common's
 * PushNotificationCategoryMobileParity holds them to the server's.
 */

export const TEST_PAGE_TEXT: Readonly<{
  screenTitle: string;
  heading: string;
  acknowledgeButton: string;
  message: string;
  answeredTitle: string;
  answered: string;
  acknowledging: string;
  checking: string;
  notFoundTitle: string;
  notFound: string;
  failedTitle: string;
  failed: string;
  notAcknowledged: string;
}> = {
  // The stack's title for the screen, and its heading until it is answered.
  screenTitle: "Test Page",
  heading: "Test page",
  // The push's action and the screen's button (ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE).
  acknowledgeButton: "Acknowledge test page",
  // What the test is (ON_CALL_TEST_PAGE_ACKNOWLEDGE_MESSAGE).
  message:
    "This is a test page. Nothing is wrong: acknowledge it to show that on-call pages reach you.",
  // Once it is acknowledged (ON_CALL_TEST_PAGE_ANSWERED_TITLE, and the message's first two sentences).
  answeredTitle: "Test page acknowledged",
  answered:
    "You acknowledged this test page. It works: on-call pages reach you.",
  acknowledging: "Acknowledging the test page...",
  checking: "Checking the test page...",
  notFoundTitle: "Test page not found",
  notFound:
    "This test page was not found. It may have been sent to you in another project, or to somebody else.",
  failedTitle: "Could not acknowledge the test page",
  failed: "It is not acknowledged yet. Check your connection, then try again.",
  notAcknowledged:
    "OneUptime could not acknowledge this test page. Please try again.",
};

// What acknowledging the test page did, as the server says it.
export type TestPageAnswer =
  | "Acknowledged"
  | "AlreadyAcknowledged"
  | "NotAcknowledged";

export const TEST_PAGE_ANSWERS: ReadonlyArray<TestPageAnswer> = [
  "Acknowledged",
  "AlreadyAcknowledged",
  "NotAcknowledged",
];

export function isTestPageAnswer(value: unknown): value is TestPageAnswer {
  return TEST_PAGE_ANSWERS.includes(value as TestPageAnswer);
}

// Whether an answer means the test page is acknowledged now.
export function isTestPageAcknowledged(answer: TestPageAnswer): boolean {
  return answer === "Acknowledged" || answer === "AlreadyAcknowledged";
}

/*
 * The entity type a test page's push names (PushNotificationUtil
 * .createTestPageNotification): its id is the message's own row of the
 * person's on-call timeline.
 */
export const TEST_PAGE_ENTITY_TYPE: string = "test-page";
