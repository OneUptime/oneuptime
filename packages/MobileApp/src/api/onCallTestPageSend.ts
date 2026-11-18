import type { AxiosResponse } from "axios";
import apiClient from "./client";

/*
 * SEND YOURSELF A TEST PAGE, FROM THE APP (#7041): the last of the app's
 * first steps (screens/GetReadyScreen.tsx), the same test page the
 * Dashboard's "Send me a test page" sends (#6946):
 *
 *   POST /api/on-call-test-page/page-person  { recordKind, severityId }
 *     sends it to the signed-in person - no user id is sent, so it is
 *     theirs - through their own How to Reach Me for that severity, as a
 *     real page would go: { executionLogId }.
 *   GET  /api/on-call-test-page/result/<executionLogId>
 *     what became of it, as it happens: still paging, acknowledged (by
 *     what, how fast), ended unanswered, or failed - in the server's words.
 *
 * Which severity it stands in for: the project's most severe incident
 * severity, the page that most needs to reach somebody - or, in a project
 * with no incident severities, its most severe alert severity - as the
 * Dashboard picks to start with.
 */

export type TestPageRecordKind = "Incident" | "Alert";

export interface TestPageSeverity {
  recordKind: TestPageRecordKind;
  severityId: string;
  severityName: string;
}

// Where a test stands, as the server says it (OnCallTestPageStatus).
export type TestPageStatus = "Paging" | "Acknowledged" | "Ended" | "Failed";

export const TEST_PAGE_STATUSES: ReadonlyArray<TestPageStatus> = [
  "Paging",
  "Acknowledged",
  "Ended",
  "Failed",
];

export interface TestPageResult {
  status: TestPageStatus;
  // The server's own sentence for it: "Test page acknowledged by ... after 9 seconds."
  statusMessage: string;
}

export const TEST_PAGE_SEND_PATH: string = "/api/on-call-test-page/page-person";

export function getTestPageResultPath(executionLogId: string): string {
  return `/api/on-call-test-page/result/${encodeURIComponent(executionLogId)}`;
}

function toObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function readId(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }

  // An ObjectID the server handed over as it serialises one.
  const value: unknown = toObject(raw)?.["value"];

  return typeof value === "string" ? value : "";
}

// The first severity of a list answer, or null when it has none.
export function toFirstSeverity(
  body: unknown,
  recordKind: TestPageRecordKind,
): TestPageSeverity | null {
  const rows: unknown = toObject(body)?.["data"];

  if (!Array.isArray(rows)) {
    return null;
  }

  for (const row of rows) {
    const severityId: string = readId(toObject(row)?.["_id"]);

    if (severityId) {
      const name: unknown = toObject(row)?.["name"];

      return {
        recordKind: recordKind,
        severityId: severityId,
        severityName: typeof name === "string" ? name : "",
      };
    }
  }

  return null;
}

/*
 * What a result answer says. An answer the app cannot read is still
 * paging, as far as it knows: it never says a test worked, or ended, that
 * the server did not say did.
 */
export function toTestPageResult(body: unknown): TestPageResult {
  const raw: Record<string, unknown> | null = toObject(body);
  const status: unknown = raw?.["status"];
  const statusMessage: unknown = raw?.["statusMessage"];

  return {
    status: TEST_PAGE_STATUSES.includes(status as TestPageStatus)
      ? (status as TestPageStatus)
      : "Paging",
    statusMessage: typeof statusMessage === "string" ? statusMessage : "",
  };
}

// Whether a result changes no more: acknowledged, ended or failed.
export function isTestPageResultFinal(result: TestPageResult): boolean {
  return result.status !== "Paging";
}

async function fetchFirstSeverity(
  projectId: string,
  recordKind: TestPageRecordKind,
): Promise<TestPageSeverity | null> {
  const model: string =
    recordKind === "Incident" ? "incident-severity" : "alert-severity";

  const response: AxiosResponse = await apiClient.post(
    `/api/${model}/get-list?skip=0&limit=1`,
    {
      query: { isArchived: false },
      select: { _id: true, name: true },
      sort: { order: "ASC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );

  return toFirstSeverity(response.data, recordKind);
}

/*
 * The severity a test from the app stands in for: the most severe incident
 * severity, else the most severe alert severity, else null - a project
 * with neither has nothing to test yet.
 */
export async function fetchTestPageSeverity(
  projectId: string,
): Promise<TestPageSeverity | null> {
  return (
    (await fetchFirstSeverity(projectId, "Incident")) ||
    (await fetchFirstSeverity(projectId, "Alert"))
  );
}

/*
 * Sends the signed-in person a test page in the project. Returns its run,
 * to read its result by. Throws what the server refused it with - a test
 * sent a moment ago, the project's hourly limit - for the screen to say.
 */
export async function sendTestPageToMyself(
  projectId: string,
  severity: TestPageSeverity,
): Promise<string> {
  const response: AxiosResponse = await apiClient.post(
    TEST_PAGE_SEND_PATH,
    {
      recordKind: severity.recordKind,
      severityId: severity.severityId,
    },
    {
      headers: { tenantid: projectId },
    },
  );

  const executionLogId: unknown = toObject(response.data)?.["executionLogId"];

  if (typeof executionLogId !== "string" || !executionLogId) {
    throw new Error(
      "The test page was sent, but its result could not be read. Look for it in your notifications.",
    );
  }

  return executionLogId;
}

export async function fetchTestPageResult(
  projectId: string,
  executionLogId: string,
): Promise<TestPageResult> {
  const response: AxiosResponse = await apiClient.get(
    getTestPageResultPath(executionLogId),
    {
      headers: { tenantid: projectId },
    },
  );

  return toTestPageResult(response.data);
}
