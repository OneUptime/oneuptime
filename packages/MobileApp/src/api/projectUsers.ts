import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { toPlainText } from "../utils/text";
import type { ProjectUserItem } from "./types";

/*
 * The people you can hand a shift to.
 *
 * `TeamMember` is the only project-scoped link to `User` the API will list -
 * the `User` model itself is self-readable only - so the picker reads through
 * it, exactly as the dashboard does. One person can sit on several teams, so
 * the rows are deduplicated by user id here rather than in the UI.
 *
 * Members who have not accepted their invitation are excluded: routing your
 * pages to somebody who has never signed in is a silent drop, which is the one
 * outcome an override exists to prevent.
 */

export async function fetchProjectUsers(
  projectId: string,
  options: { limit?: number } = {},
): Promise<ProjectUserItem[]> {
  const { limit = 200 } = options;

  const response: AxiosResponse = await apiClient.post(
    `/api/team-member/get-list?skip=0&limit=${limit}`,
    {
      query: { hasAcceptedInvitation: true },
      select: {
        _id: true,
        user: { _id: true, name: true, email: true },
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );

  const rows: Array<unknown> = Array.isArray(response.data?.data)
    ? response.data.data
    : [];

  const seenUserIds: Set<string> = new Set<string>();
  const users: ProjectUserItem[] = [];

  rows.forEach((row: unknown) => {
    if (!row || typeof row !== "object") {
      return;
    }

    const member: Record<string, unknown> = row as Record<string, unknown>;
    const user: unknown = member["user"];

    if (!user || typeof user !== "object") {
      return;
    }

    const userId: string = toPlainText(
      (user as Record<string, unknown>)["_id"],
    );

    if (!userId || seenUserIds.has(userId)) {
      return;
    }

    seenUserIds.add(userId);

    users.push({
      userId,
      name: toPlainText((user as Record<string, unknown>)["name"]),
      email: toPlainText((user as Record<string, unknown>)["email"]),
    });
  });

  users.sort((a: ProjectUserItem, b: ProjectUserItem) => {
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  return users;
}
