import type { AxiosError, AxiosResponse } from "axios";
import apiClient from "./client";
import { toPlainText } from "../utils/text";
import type { OnCallPageItem } from "./types";

/*
 * Every page the server has sent this responder.
 *
 * This answers the question that wakes people up at 3am - "did that page
 * actually reach me, and did anyone pick it up?" - and it answers it without
 * the app having to ask for anything it should not see: `UserOnCallLog` is
 * readable through the auto-granted CurrentUser permission, which the server
 * converts into a row filter on `userId`. There is no need (and no way) to
 * pass a user id from here; the session is the filter.
 */

function toResourceRef(raw: unknown): { _id?: string; title?: string } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item: Record<string, unknown> = raw as Record<string, unknown>;
  const id: string = toPlainText(item["_id"]);
  const title: string = toPlainText(item["title"]);

  if (!id && !title) {
    return null;
  }

  return {
    ...(id ? { _id: id } : {}),
    ...(title ? { title } : {}),
  };
}

function isObserverPageRun(raw: unknown): boolean {
  return Boolean(
    raw &&
      typeof raw === "object" &&
      (raw as Record<string, unknown>)["isObserverPage"] === true,
  );
}

export function toOnCallPageItem(
  raw: unknown,
  project: { projectId: string; projectName: string },
): OnCallPageItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item: Record<string, unknown> = raw as Record<string, unknown>;
  const id: string = toPlainText(item["_id"]);

  if (!id) {
    return null;
  }

  const policy: unknown = item["onCallDutyPolicy"];

  /*
   * A page that names no policy, by its id or by the policy read with it,
   * is a direct page. Only a row read WITH its policy id can say so: one
   * read without it would look direct whenever its policy cannot be read.
   */
  const isDirectPage: boolean =
    "onCallDutyPolicyId" in item &&
    !toPlainText(item["onCallDutyPolicyId"]) &&
    !(policy && typeof policy === "object");

  return {
    _id: id,
    projectId: project.projectId,
    projectName: project.projectName,
    createdAt: toPlainText(item["createdAt"]),
    status: toPlainText(item["status"]) || undefined,
    statusMessage: toPlainText(item["statusMessage"]) || undefined,
    acknowledgedAt: toPlainText(item["acknowledgedAt"]) || null,
    policyName:
      policy && typeof policy === "object"
        ? toPlainText((policy as Record<string, unknown>)["name"]) || undefined
        : undefined,
    ...(isDirectPage ? { isDirectPage: true } : {}),
    /*
     * An observer's page (oncall/observerPage.ts), as its run says: only
     * ever true, and never on a server too old to say.
     */
    ...(isObserverPageRun(item["onCallDutyPolicyExecutionLog"])
      ? { isObserverPage: true }
      : {}),
    triggeredByIncident: toResourceRef(item["triggeredByIncident"]),
    triggeredByAlert: toResourceRef(item["triggeredByAlert"]),
    triggeredByIncidentEpisode: toResourceRef(
      item["triggeredByIncidentEpisode"],
    ),
    triggeredByAlertEpisode: toResourceRef(item["triggeredByAlertEpisode"]),
  };
}

/*
 * Whether a page was an observer's is read from its run
 * (onCallDutyPolicyExecutionLog.isObserverPage). A server older than
 * observer pages - or than reading that through a page - refuses the whole
 * list for it, as a bad request: the list is then read as before, and every
 * page in it shows as a responder's, as it always did.
 */
const OBSERVER_PAGE_SELECT: Record<string, unknown> = {
  onCallDutyPolicyExecutionLog: { _id: true, isObserverPage: true },
};

function isRefusedSelect(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as AxiosError).isAxiosError === true &&
    (error as AxiosError).response?.status === 400
  );
}

async function postMyOnCallPages(
  project: { projectId: string; projectName: string },
  limit: number,
  withObserverPage: boolean,
): Promise<AxiosResponse> {
  return await apiClient.post(
    `/api/user-notification-log/get-list?skip=0&limit=${limit}`,
    {
      query: {},
      select: {
        _id: true,
        createdAt: true,
        status: true,
        statusMessage: true,
        acknowledgedAt: true,
        // Read with every row: a row with none is a direct page.
        onCallDutyPolicyId: true,
        onCallDutyPolicy: { _id: true, name: true },
        ...(withObserverPage ? OBSERVER_PAGE_SELECT : {}),
        triggeredByIncident: { _id: true, title: true },
        triggeredByAlert: { _id: true, title: true },
        triggeredByIncidentEpisode: { _id: true, title: true },
        triggeredByAlertEpisode: { _id: true, title: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: project.projectId },
    },
  );
}

export async function fetchMyOnCallPages(
  project: { projectId: string; projectName: string },
  options: { limit?: number } = {},
): Promise<OnCallPageItem[]> {
  const { limit = 25 } = options;

  let response: AxiosResponse;

  try {
    response = await postMyOnCallPages(project, limit, true);
  } catch (error: unknown) {
    if (!isRefusedSelect(error)) {
      throw error;
    }

    response = await postMyOnCallPages(project, limit, false);
  }

  const rows: Array<unknown> = Array.isArray(response.data?.data)
    ? response.data.data
    : [];

  const pages: OnCallPageItem[] = [];

  rows.forEach((row: unknown) => {
    const page: OnCallPageItem | null = toOnCallPageItem(row, project);

    if (page) {
      pages.push(page);
    }
  });

  return pages;
}
