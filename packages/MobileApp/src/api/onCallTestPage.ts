import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { isTestPageAnswer, type TestPageAnswer } from "../oncall/testPage";

/*
 * A TEST PAGE, ANSWERED FROM ITS PUSH (#7014, oncall/testPage.ts).
 *
 * GET  /api/on-call-test-page/acknowledge/<message id>
 *   Whether the signed-in person acknowledged the test page already - from
 *   this message or another of theirs: { isAcknowledged }.
 * POST the same route
 *   Acknowledges it: { answer }, Acknowledged now, AlreadyAcknowledged, or
 *   NotAcknowledged when the server could not write it.
 *
 * The message is the push's own row of the person's on-call timeline, and
 * the session is who answers: nothing else is sent, so nobody can answer
 * somebody else's test page. A message that is not the person's own, of a
 * test page, in the project named by the tenant header is not found (400).
 */

export function getTestPageAcknowledgePath(messageId: string): string {
  return `/api/on-call-test-page/acknowledge/${encodeURIComponent(messageId)}`;
}

function toObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

// Whether a GET answer says it is acknowledged; anything malformed is not.
export function toIsTestPageAcknowledged(body: unknown): boolean {
  return toObject(body)?.["isAcknowledged"] === true;
}

/*
 * What a POST answer says it did. Anything malformed is not acknowledged:
 * the screen never says a test works that the server did not confirm.
 */
export function toTestPageAnswer(body: unknown): TestPageAnswer {
  const answer: unknown = toObject(body)?.["answer"];

  return isTestPageAnswer(answer) ? answer : "NotAcknowledged";
}

export async function fetchIsTestPageAcknowledged(
  projectId: string,
  messageId: string,
): Promise<boolean> {
  const response: AxiosResponse = await apiClient.get(
    getTestPageAcknowledgePath(messageId),
    {
      headers: { tenantid: projectId },
    },
  );

  return toIsTestPageAcknowledged(response.data);
}

/*
 * Acknowledges the test page. The body is an empty JSON object rather than
 * nothing at all - the server answers 415 to a POST that is not
 * `application/json`.
 */
export async function acknowledgeTestPage(
  projectId: string,
  messageId: string,
): Promise<TestPageAnswer> {
  const response: AxiosResponse = await apiClient.post(
    getTestPageAcknowledgePath(messageId),
    {},
    {
      headers: { tenantid: projectId },
    },
  );

  return toTestPageAnswer(response.data);
}
