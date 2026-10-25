import type { AxiosResponse } from "axios";
import apiClient from "./client";
import type { CaseWrite } from "../security/caseChanges";
import type {
  ListResponse,
  NoteItem,
  SecurityCaseFeedItem,
  SecurityCaseItem,
  SecurityCasePriorityItem,
  SecurityCaseStatusItem,
  SecurityPlaybookRunItem,
} from "./types";

/*
 * SECURITY CASES, THROUGH THE SAME API THE DASHBOARD USES.
 *
 * Every read and write is the model's own CRUD route or the playbook run's
 * approval route, scoped to the selected project by its `tenantid` header,
 * so the server applies exactly the permissions it applies on the web: a
 * case is read by Project Owners, Project Admins and the Security roles
 * (labels and blocks included), worked by the Member tier and up, and a
 * playbook step is approved by somebody who may run playbooks and did not
 * start the run. The app holds no copy of those rules; it shows what the
 * server answers, refusals included.
 */

// The most cases one list asks for: the 100 latest open ones, as the other lists keep 100.
export const SECURITY_CASE_LIST_LIMIT: number = 100;

const VALUE_SELECT: Record<string, boolean> = {
  _id: true,
  name: true,
  color: true,
  order: true,
  createdAt: true,
  isArchived: true,
};

const STATUS_SELECT: Record<string, boolean> = {
  ...VALUE_SELECT,
  isNewStatus: true,
  isAcknowledgedStatus: true,
  isContainedStatus: true,
  isClosedStatus: true,
};

const PRIORITY_SELECT: Record<string, boolean> = {
  ...VALUE_SELECT,
  isCriticalPriority: true,
  isHighPriority: true,
  isMediumPriority: true,
  isLowPriority: true,
  isInformationalPriority: true,
};

// What a row of the case list draws.
const CASE_LIST_SELECT: Record<string, unknown> = {
  _id: true,
  title: true,
  caseNumber: true,
  caseNumberWithPrefix: true,
  securityCaseStatusId: true,
  securityCaseStatus: { _id: true, name: true, color: true },
  securityCasePriorityId: true,
  securityCasePriority: { _id: true, name: true, color: true },
  assignedToUserId: true,
  assignedToUser: { _id: true, name: true, email: true },
  assignedToTeamId: true,
  assignedToTeam: { _id: true, name: true },
  entities: true,
  detectionCount: true,
  lastDetectedAt: true,
  createdAt: true,
};

// What the case's own screen draws: the row, and the rest of the case.
const CASE_DETAIL_SELECT: Record<string, unknown> = {
  ...CASE_LIST_SELECT,
  description: true,
  source: true,
  firstDetectedAt: true,
  acknowledgedAt: true,
  containedAt: true,
  closedAt: true,
  verdict: true,
  closingNote: true,
  aiVerdict: true,
  aiSuggestedSecurityCasePriorityId: true,
  aiTriageReport: true,
  aiTriagedAt: true,
  aiTriagePromptInjectionSuspected: true,
  incidentId: true,
};

const RUN_SELECT: Record<string, unknown> = {
  _id: true,
  securityCaseId: true,
  playbookName: true,
  status: true,
  trigger: true,
  steps: true,
  stepResults: true,
  currentStepIndex: true,
  triggeredByUserId: true,
  triggeredByUser: { _id: true, name: true, email: true },
  startedAt: true,
  createdAt: true,
};

export interface IncludesQuery {
  _type: "Includes";
  value: Array<string>;
}

function headers(projectId: string): { headers: { tenantid: string } } {
  return { headers: { tenantid: projectId } };
}

function rowsOf<T>(response: AxiosResponse): Array<T> {
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

// The project's case statuses, as Security Events > Settings > Case Statuses lists them.
export async function fetchSecurityCaseStatuses(
  projectId: string,
): Promise<SecurityCaseStatusItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/security-case-status/get-list?skip=0&limit=100",
    {
      query: {},
      select: STATUS_SELECT,
      sort: { order: "ASC" },
    },
    headers(projectId),
  );

  return rowsOf<SecurityCaseStatusItem>(response);
}

// The project's case priorities, the most urgent first.
export async function fetchSecurityCasePriorities(
  projectId: string,
): Promise<SecurityCasePriorityItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/security-case-priority/get-list?skip=0&limit=100",
    {
      query: {},
      select: PRIORITY_SELECT,
      sort: { order: "ASC" },
    },
    headers(projectId),
  );

  return rowsOf<SecurityCasePriorityItem>(response);
}

/*
 * How many of the project's cases the person signed in can see, by the same
 * read permission every other read of a case goes through. A person who may
 * not read cases is refused here, before any case reaches the phone.
 */
export async function countSecurityCases(
  projectId: string,
  query: Record<string, unknown> = {},
): Promise<number> {
  const response: AxiosResponse = await apiClient.post(
    "/api/security-case/count",
    { query },
    headers(projectId),
  );
  const count: unknown = response.data?.count;

  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

/*
 * A list query's match on the status column: the case is in one of these
 * statuses. An empty list matches nothing, which is what a project with no
 * open status means.
 */
export function toStatusIdsQuery(statusIds: Array<string>): IncludesQuery {
  return { _type: "Includes", value: statusIds };
}

/*
 * The project's open cases - in a status that does not count as closed by
 * the project's own list (security/caseValues) - the latest detection first,
 * as the dashboard's Open Cases sorts them.
 */
export async function fetchOpenSecurityCases(
  projectId: string,
  openStatusIds: Array<string>,
): Promise<ListResponse<SecurityCaseItem>> {
  const response: AxiosResponse = await apiClient.post(
    `/api/security-case/get-list?skip=0&limit=${SECURITY_CASE_LIST_LIMIT}`,
    {
      query: { securityCaseStatusId: toStatusIdsQuery(openStatusIds) },
      select: CASE_LIST_SELECT,
      sort: { lastDetectedAt: "DESC" },
    },
    headers(projectId),
  );

  return {
    data: rowsOf<SecurityCaseItem>(response),
    count: typeof response.data?.count === "number" ? response.data.count : 0,
    skip: 0,
    limit: SECURITY_CASE_LIST_LIMIT,
  };
}

/*
 * One case, or null when there is no such case in the project - deleted,
 * moved, or never there. `null` and never `undefined`: React Query will not
 * cache `undefined`, and would report a case that is gone as a failed
 * request.
 */
export async function fetchSecurityCaseById(
  projectId: string,
  caseId: string,
): Promise<SecurityCaseItem | null> {
  const response: AxiosResponse = await apiClient.post(
    "/api/security-case/get-list?skip=0&limit=1",
    {
      query: { _id: caseId },
      select: CASE_DETAIL_SELECT,
      sort: {},
    },
    headers(projectId),
  );

  return rowsOf<SecurityCaseItem>(response)[0] ?? null;
}

/*
 * One change to a case, the PUT the dashboard sends: the server checks the
 * person may make it, stamps what it records, writes the timeline entry and
 * tells whoever the change reached.
 */
export async function updateSecurityCase(
  projectId: string,
  caseId: string,
  data: CaseWrite,
): Promise<void> {
  await apiClient.put(
    `/api/security-case/${encodeURIComponent(caseId)}`,
    { data },
    headers(projectId),
  );
}

// The case's timeline, newest first: everything that happened to it and on it.
export async function fetchSecurityCaseFeed(
  projectId: string,
  caseId: string,
): Promise<SecurityCaseFeedItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/security-case-feed/get-list?skip=0&limit=50",
    {
      query: { securityCaseId: caseId },
      select: {
        _id: true,
        feedInfoInMarkdown: true,
        moreInformationInMarkdown: true,
        securityCaseFeedEventType: true,
        displayColor: true,
        postedAt: true,
        createdAt: true,
      },
      sort: { postedAt: "DESC" },
    },
    headers(projectId),
  );

  return rowsOf<SecurityCaseFeedItem>(response);
}

export async function fetchSecurityCaseNotes(
  projectId: string,
  caseId: string,
): Promise<NoteItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/security-case-note/get-list?skip=0&limit=50",
    {
      query: { securityCaseId: caseId },
      select: {
        _id: true,
        note: true,
        createdAt: true,
        createdByUser: { _id: true, name: true },
      },
      sort: { createdAt: "DESC" },
    },
    headers(projectId),
  );

  return rowsOf<NoteItem>(response);
}

export async function createSecurityCaseNote(
  projectId: string,
  caseId: string,
  note: string,
): Promise<void> {
  await apiClient.post(
    "/api/security-case-note",
    {
      data: {
        securityCaseId: caseId,
        note,
        projectId,
      },
    },
    headers(projectId),
  );
}

/*
 * The playbook runs held for a decision: on one case, or across the project
 * (for the list's "Approval needed"). Oldest first, the order they asked in.
 */
export async function fetchWaitingPlaybookRuns(
  projectId: string,
  caseId?: string,
): Promise<SecurityPlaybookRunItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/security-playbook-run/get-list?skip=0&limit=100",
    {
      query: {
        status: "Waiting for Approval",
        ...(caseId ? { securityCaseId: caseId } : {}),
      },
      select: caseId ? RUN_SELECT : { _id: true, securityCaseId: true },
      sort: { createdAt: "ASC" },
    },
    headers(projectId),
  );

  return rowsOf<SecurityPlaybookRunItem>(response);
}

export type PlaybookDecision = "approve" | "reject";

/*
 * Approve or reject the step a run waits on. An approval may leave some of
 * the step's targets out (`targets`: the values kept); a rejection ends the
 * run. The decision is recorded on the step, the case's timeline and the
 * project's audit log by the server.
 */
export async function decidePlaybookStep(
  projectId: string,
  runId: string,
  decision: PlaybookDecision,
  options: { comment?: string; targets?: Array<string> | undefined } = {},
): Promise<void> {
  const comment: string = (options.comment || "").trim();

  await apiClient.post(
    `/api/security-playbook-run/${encodeURIComponent(runId)}/${decision}`,
    {
      ...(comment ? { comment } : {}),
      ...(decision === "approve" && options.targets
        ? { targets: options.targets }
        : {}),
    },
    headers(projectId),
  );
}
