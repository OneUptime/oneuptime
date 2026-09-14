import type { AxiosResponse } from "axios";
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
    triggeredByIncident: toResourceRef(item["triggeredByIncident"]),
    triggeredByAlert: toResourceRef(item["triggeredByAlert"]),
    triggeredByIncidentEpisode: toResourceRef(
      item["triggeredByIncidentEpisode"],
    ),
    triggeredByAlertEpisode: toResourceRef(item["triggeredByAlertEpisode"]),
  };
}

export async function fetchMyOnCallPages(
  project: { projectId: string; projectName: string },
  options: { limit?: number } = {},
): Promise<OnCallPageItem[]> {
  const { limit = 25 } = options;

  const response: AxiosResponse = await apiClient.post(
    `/api/user-notification-log/get-list?skip=0&limit=${limit}`,
    {
      query: {},
      select: {
        _id: true,
        createdAt: true,
        status: true,
        statusMessage: true,
        acknowledgedAt: true,
        onCallDutyPolicy: { _id: true, name: true },
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
