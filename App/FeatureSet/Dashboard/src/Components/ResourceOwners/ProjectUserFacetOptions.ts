import { FilterChipDropdownOption } from "./FilterChipDropdown";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Helpers for filter-bar facets that pick a project member (e.g. the Users
 * table "User" facet, the Teams table "Member" / "Created By" facets).
 *
 * TeamMember is the only project-scoped link to User the dashboard can list,
 * so all three facets search through it and dedup users — a person on several
 * teams shows up once. Options are keyed by the raw userId, which is what the
 * userId-style columns they filter (TeamMember.userId, Team.createdByUserId)
 * compare against.
 */

const PROJECT_USER_PICKER_LIMIT: number = 50;

const getInitials: (name: string) => string = (name: string): string => {
  const parts: Array<string> = name
    .trim()
    .split(/\s+/)
    .filter((part: string) => {
      return part.length > 0;
    });
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.charAt(0).toUpperCase();
  }
  return (
    parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)
  ).toUpperCase();
};

const toUserOptions: (
  result: ListResult<TeamMember>,
) => Array<FilterChipDropdownOption> = (
  result: ListResult<TeamMember>,
): Array<FilterChipDropdownOption> => {
  const seenUserIds: Set<string> = new Set<string>();
  const options: Array<FilterChipDropdownOption> = [];

  for (const teamMember of result.data) {
    const userId: string | undefined = teamMember.user?._id?.toString();
    if (!userId || seenUserIds.has(userId)) {
      continue;
    }
    seenUserIds.add(userId);
    const label: string =
      teamMember.user?.name?.toString() ||
      teamMember.user?.email?.toString() ||
      "";
    options.push({
      value: userId,
      label: label,
      initials: getInitials(label),
      icon: IconProp.User,
      group: "People",
    });
  }

  return options;
};

/**
 * Search project members by name for a facet picker. Called by the chip on
 * open and on each (debounced) keystroke, so the server does the filtering.
 */
export const loadProjectUserOptions: (
  projectId: ObjectID,
  searchTerm: string,
) => Promise<Array<FilterChipDropdownOption>> = async (
  projectId: ObjectID,
  searchTerm: string,
): Promise<Array<FilterChipDropdownOption>> => {
  const query: Query<TeamMember> = {
    projectId: projectId,
  } as Query<TeamMember>;

  const trimmed: string = searchTerm.trim();
  if (trimmed) {
    (query as unknown as Record<string, unknown>)["user"] = {
      name: new Search(trimmed),
    };
  }

  const result: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
    modelType: TeamMember,
    query: query,
    limit: PROJECT_USER_PICKER_LIMIT,
    skip: 0,
    select: {
      _id: true,
      user: {
        _id: true,
        name: true,
        email: true,
      },
    },
    sort: {},
  });

  return toUserOptions(result);
};

/**
 * Resolve previously-selected userIds (e.g. from a saved view or the URL)
 * back into labeled options so the chip shows proper names rather than ids.
 */
export const resolveProjectUserOptions: (
  projectId: ObjectID,
  values: Array<string>,
) => Promise<Array<FilterChipDropdownOption>> = async (
  projectId: ObjectID,
  values: Array<string>,
): Promise<Array<FilterChipDropdownOption>> => {
  if (values.length === 0) {
    return [];
  }

  const result: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
    modelType: TeamMember,
    query: {
      projectId: projectId,
      userId: new Includes(values),
    } as Query<TeamMember>,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: {
      _id: true,
      user: {
        _id: true,
        name: true,
        email: true,
      },
    },
    sort: {},
  });

  return toUserOptions(result);
};

/**
 * Resolve the set of team ids the selected user(s) belong to. Wired into a
 * Teams "Member" facet via `computeMatchingResourceIds`; the hook intersects
 * the returned ids into the table's `_id` filter. Multiple selected users
 * union (teams containing any of them).
 */
export const computeTeamIdsForMembers: (
  projectId: ObjectID,
  userIds: Array<string>,
) => Promise<Array<string>> = async (
  projectId: ObjectID,
  userIds: Array<string>,
): Promise<Array<string>> => {
  if (userIds.length === 0) {
    return [];
  }

  const result: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
    modelType: TeamMember,
    query: {
      projectId: projectId,
      userId: new Includes(userIds),
    } as Query<TeamMember>,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: {
      _id: true,
      teamId: true,
    },
    sort: {},
  });

  const teamIds: Set<string> = new Set<string>();
  for (const teamMember of result.data) {
    const teamId: string | undefined = teamMember.teamId?.toString();
    if (teamId) {
      teamIds.add(teamId);
    }
  }

  return Array.from(teamIds);
};
