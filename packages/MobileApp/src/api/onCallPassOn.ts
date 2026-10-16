import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { toPlainText } from "../utils/text";

/*
 * "Can't take it? Pass it on" - the person an on-call policy is paging about
 * an incident, an alert or an episode hands the page to the policy's next
 * escalation rule now, instead of the policy waiting the rule out.
 *
 * GET  /api/on-call-page/pass-on/<record type>/<record id>
 *   The signed-in person's own open pages about the record, each with what
 *   passing it on would do. Empty for everybody the policy is not paging.
 * POST the same route
 *   Passes them on, and answers what came of each - or why it could not.
 *
 * The server words both in English, with times in the person's own time
 * zone (`sentence`), as it does in the email, the text and the call that
 * paged them; the app shows them as they are. The session is who passes on:
 * nothing but the record is sent, so nobody can pass on somebody else's page.
 */

export type OnCallPageRecordType =
  | "incident"
  | "alert"
  | "incident-episode"
  | "alert-episode";

// One page the person can pass on, and what passing it on would do.
export interface OnCallPassOnPage {
  executionLogId: string;
  // The policy paging them; empty for a direct page.
  policyName: string;
  sentence: string;
}

// What passing one page on came to.
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
    });
  }

  return result;
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
