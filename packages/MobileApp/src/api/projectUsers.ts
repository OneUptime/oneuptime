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

/*
 * THE PEOPLE OF SOME TEAMS: for someone who manages the user overrides of
 * their own teams' people only (oncall/overrideTeamAccess, issue #9883),
 * whose pickers offer only those teams' accepted members and whose lists
 * lock the overrides that name anybody else.
 *
 * Read through TeamMember, as fetchProjectUsers reads the project's people,
 * and as the Dashboard reads a team's: accepted members only, since an
 * invitation not yet accepted puts nobody in a team's reach.
 */
export interface TeamPeople {
  // The teams' members, each once, by name.
  users: ProjectUserItem[];
  /*
   * Who is in which team: lower-cased team id to lower-cased user ids. Null
   * when the read was cut short - a team bigger than one read - so nobody
   * is locked for want of a row.
   */
  membersByTeam: Map<string, Set<string>> | null;
}

// How many memberships one read brings back.
export const TEAM_PEOPLE_READ_LIMIT: number = 1000;

// A query's match on ids: one of these (the server's Includes).
function includes(ids: ReadonlyArray<string>): Record<string, unknown> {
  return { _type: "Includes", value: [...ids] };
}

export async function fetchTeamPeople(
  projectId: string,
  teamIds: ReadonlyArray<string>,
  options: { limit?: number } = {},
): Promise<TeamPeople> {
  const { limit = TEAM_PEOPLE_READ_LIMIT } = options;

  if (teamIds.length === 0) {
    return { users: [], membersByTeam: new Map<string, Set<string>>() };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/team-member/get-list?skip=0&limit=${limit}`,
    {
      query: { teamId: includes(teamIds), hasAcceptedInvitation: true },
      select: {
        _id: true,
        teamId: true,
        userId: true,
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
  const count: unknown = response.data?.count;

  const membersByTeam: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();
  const seenUserIds: Set<string> = new Set<string>();
  const users: ProjectUserItem[] = [];

  rows.forEach((row: unknown) => {
    if (!row || typeof row !== "object") {
      return;
    }

    const member: Record<string, unknown> = row as Record<string, unknown>;
    const user: Record<string, unknown> =
      member["user"] && typeof member["user"] === "object"
        ? (member["user"] as Record<string, unknown>)
        : {};
    const userId: string = toPlainText(member["userId"] || user["_id"]).trim();
    const teamId: string = toPlainText(member["teamId"]).trim().toLowerCase();
    // Ids are compared without case, as the server compares them.
    const userKey: string = userId.toLowerCase();

    if (!userId) {
      return;
    }

    if (teamId) {
      const teamMembers: Set<string> =
        membersByTeam.get(teamId) || new Set<string>();
      teamMembers.add(userKey);
      membersByTeam.set(teamId, teamMembers);
    }

    if (seenUserIds.has(userKey)) {
      return;
    }

    seenUserIds.add(userKey);

    users.push({
      userId,
      name: toPlainText(user["name"]),
      email: toPlainText(user["email"]),
    });
  });

  users.sort((a: ProjectUserItem, b: ProjectUserItem) => {
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  // Every membership read, or who is in which team is not known.
  const isComplete: boolean = typeof count !== "number" || count <= rows.length;

  return { users, membersByTeam: isComplete ? membersByTeam : null };
}

// The teams' names, by name, as the project calls them.
export async function fetchTeamNames(
  projectId: string,
  teamIds: ReadonlyArray<string>,
): Promise<string[]> {
  if (teamIds.length === 0) {
    return [];
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/team/get-list?skip=0&limit=${teamIds.length}`,
    {
      query: { _id: includes(teamIds) },
      select: { _id: true, name: true },
      sort: { name: "ASC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );

  const rows: Array<unknown> = Array.isArray(response.data?.data)
    ? response.data.data
    : [];

  return rows
    .map((row: unknown): string => {
      return row && typeof row === "object"
        ? toPlainText((row as Record<string, unknown>)["name"]).trim()
        : "";
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    });
}
