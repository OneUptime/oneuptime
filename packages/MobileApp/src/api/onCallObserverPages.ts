import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { toPlainText } from "../utils/text";
import type { OnCallPageRecordType } from "./onCallPassOn";

/*
 * "I've seen it" - the person paged as an observer about an incident, an
 * alert or an episode (oncall/observerPage.ts) says they have seen their
 * page. The record is not acknowledged, and nobody else's page stops: the
 * server answers each page as its email's link, a call's 1 or a text does.
 *
 * GET  /api/on-call-page/seen/<record type>/<record id>
 *   The signed-in person's observer pages about the record that they can
 *   still say they have seen, one for each run. Empty for everybody else,
 *   and an older server has no such route: either way there is no button.
 * POST the same route
 *   Says they have seen them: { seen: N }, 0 when there was none to answer
 *   (seen already, or over, as the record is resolved).
 *
 * The session is who answers: nothing but the record is sent, so nobody can
 * answer somebody else's page.
 */

// One page the person can still say they have seen.
export interface OnCallObserverPage {
  executionLogId: string;
  // The policy paging them; empty for a direct page.
  policyName: string;
}

export function getOnCallObserverPageSeenPath(
  recordType: OnCallPageRecordType,
  recordId: string,
): string {
  return `/api/on-call-page/seen/${recordType}/${encodeURIComponent(recordId)}`;
}

function toObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

// The pages in a GET answer; anything malformed is left out.
export function toOnCallObserverPages(body: unknown): OnCallObserverPage[] {
  const pages: unknown = toObject(body)?.["pages"];

  if (!Array.isArray(pages)) {
    return [];
  }

  const result: OnCallObserverPage[] = [];

  for (const raw of pages) {
    const page: Record<string, unknown> | null = toObject(raw);
    const executionLogId: string = toPlainText(page?.["executionLogId"]);

    if (!page || !executionLogId) {
      continue;
    }

    result.push({
      executionLogId,
      policyName: toPlainText(page["policyName"]).trim(),
    });
  }

  return result;
}

// How many pages a POST marked seen; anything malformed is none.
export function toSeenCount(body: unknown): number {
  const seen: unknown = toObject(body)?.["seen"];

  return typeof seen === "number" && Number.isFinite(seen) && seen > 0
    ? Math.floor(seen)
    : 0;
}

export async function fetchOnCallObserverPages(
  projectId: string,
  recordType: OnCallPageRecordType,
  recordId: string,
): Promise<OnCallObserverPage[]> {
  const response: AxiosResponse = await apiClient.get(
    getOnCallObserverPageSeenPath(recordType, recordId),
    {
      headers: { tenantid: projectId },
    },
  );

  return toOnCallObserverPages(response.data);
}

/*
 * Says the signed-in person has seen their observer pages about the record,
 * and how many. The body is an empty JSON object rather than nothing at all
 * - the server answers 415 to a POST that is not `application/json`.
 */
export async function markOnCallObserverPagesSeen(
  projectId: string,
  recordType: OnCallPageRecordType,
  recordId: string,
): Promise<number> {
  const response: AxiosResponse = await apiClient.post(
    getOnCallObserverPageSeenPath(recordType, recordId),
    {},
    {
      headers: { tenantid: projectId },
    },
  );

  return toSeenCount(response.data);
}
