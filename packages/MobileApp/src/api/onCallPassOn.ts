import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { toPlainText } from "../utils/text";

/*
 * "Can't take it? Escalate" - the person an on-call policy is paging about
 * an incident, an alert or an episode hands the page to the policy's next
 * level now, instead of the policy waiting the level out. The route keeps
 * the action's first name, pass-on.
 *
 * GET  /api/on-call-page/pass-on/<record type>/<record id>
 *   The signed-in person's own open pages about the record, each with what
 *   escalating it would do. Empty for everybody the policy is not paging.
 * POST the same route
 *   Escalates them, and answers what came of each - or why it could not.
 *
 * The server words both in English, with times in the person's own time
 * zone (`sentence`), as it does in the email, the text and the call that
 * paged them; the app shows them as they are. The session is who passes on:
 * nothing but the record is sent, so nobody can pass on somebody else's page.
 *
 * POST /api/on-call-page/acknowledge/<record type>/<record id>
 *   A page again (the policy's acknowledgement timeout ran out with the
 *   record still acknowledged and not resolved): the record was acknowledged
 *   all along, so its own Acknowledge is not offered, and the person paged
 *   again answers their page instead - as its link, a call's 1 or a text
 *   would. So does a person paged by a page somebody asked for, or by a
 *   policy somebody started by hand, about a record acknowledged already:
 *   those go on until one of the people they paged answers them.
 *   { acknowledged: N }, 0 when there was none to answer.
 */

export type OnCallPageRecordType =
  | "incident"
  | "alert"
  | "incident-episode"
  | "alert-episode";

// One page the person can escalate, and what escalating it would do.
export interface OnCallPassOnPage {
  executionLogId: string;
  // The policy paging them; empty for a direct page.
  policyName: string;
  sentence: string;
  /*
   * A page again about a record the person acknowledged earlier - or a page
   * somebody asked for, or a policy somebody started by hand, about a record
   * acknowledged already: it is answered with Acknowledge again, as the
   * record's own Acknowledge is gone. Absent, or false, for any other page.
   */
  isPageAgain?: boolean;
  /*
   * Beside isPageAgain: the page is not a page again, but one somebody asked
   * for by hand - a page sent from a chat, or a policy started by hand -
   * about a record somebody acknowledged already. The person is paged to
   * help with it, not paged again about one they took. Absent, or false,
   * for any other page - and on an older server, which does not say.
   */
  isAskedFor?: boolean;
  /*
   * An observer's page (oncall/observerPage.ts): answered with "I've seen
   * it", and never escalated from the app. Absent, or false, for a
   * responder's page - and on an older server, which does not say.
   */
  isObserverPage?: boolean;
}

// What escalating one page came to.
export interface OnCallPassOnAnswer {
  passedOn: boolean;
  policyName: string;
  sentence: string;
}

export function getOnCallPassOnPath(
  recordType: OnCallPageRecordType,
  recordId: string,
): string {
  return `/api/on-call-page/pass-on/${recordType}/${encodeURIComponent(
    recordId,
  )}`;
}

function toObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

// The open pages in a GET answer; anything malformed is left out.
export function toOnCallPassOnPages(body: unknown): OnCallPassOnPage[] {
  const pages: unknown = toObject(body)?.["pages"];

  if (!Array.isArray(pages)) {
    return [];
  }

  const result: OnCallPassOnPage[] = [];

  for (const raw of pages) {
    const page: Record<string, unknown> | null = toObject(raw);
    const executionLogId: string = toPlainText(page?.["executionLogId"]);

    if (!page || !executionLogId) {
      continue;
    }

    result.push({
      executionLogId,
      policyName: toPlainText(toObject(page["preview"])?.["policyName"]),
      sentence: toPlainText(page["sentence"]).trim(),
      // Only ever sent as true; an older server sends nothing.
      isPageAgain: page["isPageAgain"] === true,
      // Said only beside isPageAgain, and only as true.
      ...(page["isAskedFor"] === true ? { isAskedFor: true } : {}),
      // Said only of an observer's page, and only as true.
      ...(page["isObserverPage"] === true ? { isObserverPage: true } : {}),
    });
  }

  return result;
}

export function getOnCallPageAgainAcknowledgePath(
  recordType: OnCallPageRecordType,
  recordId: string,
): string {
  return `/api/on-call-page/acknowledge/${recordType}/${encodeURIComponent(
    recordId,
  )}`;
}

// How many pages again a POST answered; anything malformed is none.
export function toAcknowledgedCount(body: unknown): number {
  const acknowledged: unknown = toObject(body)?.["acknowledged"];

  return typeof acknowledged === "number" &&
    Number.isFinite(acknowledged) &&
    acknowledged > 0
    ? Math.floor(acknowledged)
    : 0;
}

// The answers in a POST answer, one per page; anything malformed is left out.
export function toOnCallPassOnAnswers(body: unknown): OnCallPassOnAnswer[] {
  const answers: unknown = toObject(body)?.["answers"];

  if (!Array.isArray(answers)) {
    return [];
  }

  const result: OnCallPassOnAnswer[] = [];

  for (const raw of answers) {
    const answer: Record<string, unknown> | null = toObject(raw);

    if (!answer) {
      continue;
    }

    result.push({
      passedOn: answer["passedOn"] === true,
      policyName: toPlainText(toObject(answer["result"])?.["policyName"]),
      sentence: toPlainText(answer["sentence"]).trim(),
    });
  }

  return result;
}

export async function fetchOnCallPassOnPages(
  projectId: string,
  recordType: OnCallPageRecordType,
  recordId: string,
): Promise<OnCallPassOnPage[]> {
  const response: AxiosResponse = await apiClient.get(
    getOnCallPassOnPath(recordType, recordId),
    {
      headers: { tenantid: projectId },
    },
  );

  return toOnCallPassOnPages(response.data);
}

/*
 * The body is an empty JSON object rather than nothing at all - the server
 * answers 415 to a POST that is not `application/json`.
 */
/*
 * Acknowledges the signed-in person's pages again about the record, and says
 * how many. The same empty JSON body as escalating, for the same reason.
 */
export async function acknowledgeOnCallPagesAgain(
  projectId: string,
  recordType: OnCallPageRecordType,
  recordId: string,
): Promise<number> {
  const response: AxiosResponse = await apiClient.post(
    getOnCallPageAgainAcknowledgePath(recordType, recordId),
    {},
    {
      headers: { tenantid: projectId },
    },
  );

  return toAcknowledgedCount(response.data);
}

export async function passOnOnCallPages(
  projectId: string,
  recordType: OnCallPageRecordType,
  recordId: string,
): Promise<OnCallPassOnAnswer[]> {
  const response: AxiosResponse = await apiClient.post(
    getOnCallPassOnPath(recordType, recordId),
    {},
    {
      headers: { tenantid: projectId },
    },
  );

  return toOnCallPassOnAnswers(response.data);
}
