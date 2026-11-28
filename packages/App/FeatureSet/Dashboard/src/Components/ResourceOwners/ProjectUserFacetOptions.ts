import {
  FilterChipDropdownOption,
  FilterOperator,
} from "./FilterChipDropdownTypes";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import LinkedTo, { LinkedToMatch } from "Common/Types/BaseDatabase/LinkedTo";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { getNameInitials } from "Common/Utils/NameInitials";

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

// How many picked people are named at once.
const USER_RESOLVE_CONCURRENCY: number = 10;

/*
 * What the server calls a team's members in a LinkedTo: its TeamMember
 * rows (Common/Server/Types/Database/LinkedToLinkTables).
 */
export const TEAM_MEMBERS_RELATION: string = "members";

const toUserOptions: (
  results: Array<ListResult<TeamMember>>,
) => Array<FilterChipDropdownOption> = (
  results: Array<ListResult<TeamMember>>,
): Array<FilterChipDropdownOption> => {
  const seenUserIds: Set<string> = new Set<string>();
  const options: Array<FilterChipDropdownOption> = [];

  /*
   * Dedup across every result set (a user can match on name AND email, or
   * belong to several teams) so each person appears once.
   */
  for (const result of results) {
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
        // As the person's avatar draws them everywhere else (PeopleAvatar).
        initials: getNameInitials(label),
        icon: IconProp.User,
        group: "People",
      });
    }
  }

  return options;
};

/**
 * Search project members by name or email for a facet picker. Called by the
 * chip on open and on each (debounced) keystroke, so the server does the
 * filtering.
 */
export const loadProjectUserOptions: (
  projectId: ObjectID,
  searchTerm: string,
) => Promise<Array<FilterChipDropdownOption>> = async (
  projectId: ObjectID,
  searchTerm: string,
): Promise<Array<FilterChipDropdownOption>> => {
  const trimmed: string = searchTerm.trim();

  /*
   * Match the term against the user's name AND email. There's no OR across
   * two relation fields in a single query, so run one query per field and let
   * toUserOptions union + dedup the results.
   */
  const queries: Array<Query<TeamMember>> = trimmed
    ? [
        {
          projectId: projectId,
          user: { name: new Search(trimmed) },
        } as unknown as Query<TeamMember>,
        {
          projectId: projectId,
          user: { email: new Search(trimmed) },
        } as unknown as Query<TeamMember>,
      ]
    : [{ projectId: projectId } as Query<TeamMember>];

  const results: Array<ListResult<TeamMember>> = await Promise.all(
    queries.map((query: Query<TeamMember>) => {
      return ModelAPI.getList<TeamMember>({
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
    }),
  );

  return toUserOptions(results);
};

/**
 * Resolve previously-selected userIds (e.g. from a saved view or the URL)
 * back into labeled options so the chip shows proper names rather than ids.
 *
 * One membership is read for each person, by their id: a read of every
 * membership of the people picked at once took the first 10,000, so beside
 * someone on that many teams the others read as ids (#11211).
 */
export const resolveProjectUserOptions: (
  projectId: ObjectID,
  values: Array<string>,
) => Promise<Array<FilterChipDropdownOption>> = async (
  projectId: ObjectID,
  values: Array<string>,
): Promise<Array<FilterChipDropdownOption>> => {
  const userIds: Array<string> = Array.from(
    new Set(
      values.filter((value: string): boolean => {
        return ObjectID.isValidUUID(value);
      }),
    ),
  );

  if (userIds.length === 0) {
    return [];
  }

  const results: Array<ListResult<TeamMember>> = [];

  for (
    let start: number = 0;
    start < userIds.length;
    start += USER_RESOLVE_CONCURRENCY
  ) {
    results.push(
      ...(await Promise.all(
        userIds
          .slice(start, start + USER_RESOLVE_CONCURRENCY)
          .map((userId: string): Promise<ListResult<TeamMember>> => {
            return ModelAPI.getList<TeamMember>({
              modelType: TeamMember,
              query: {
                projectId: projectId,
                userId: new ObjectID(userId),
              } as Query<TeamMember>,
              limit: 1,
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
          }),
      )),
    );
  }

  return toUserOptions(results);
};

/**
 * The Teams list's "Member" chip as one filter for the list's own query: the
 * teams one of the people picked is in ("is"), or none of them is
 * ("is not"), through their TeamMember rows - `members` of a LinkedTo,
 * which the server answers with a subquery on TeamMember and holds to its
 * read (LinkedToLinkTables, #11211). It read the teams of the people picked
 * first - the first 10,000 memberships - and filtered the list by those
 * ids. Null when nobody is picked, and the chip filters nothing.
 */
export const buildTeamMemberFilter: (
  userIds: Array<string>,
  operator: FilterOperator,
) => LinkedTo | null = (
  userIds: Array<string>,
  operator: FilterOperator,
): LinkedTo | null => {
  const ids: Array<string> = userIds.filter((userId: string): boolean => {
    return ObjectID.isValidUUID(userId);
  });

  if (ids.length === 0) {
    return null;
  }

  return new LinkedTo({
    match: operator === "is_not" ? LinkedToMatch.NoneOf : LinkedToMatch.AnyOf,
    relations: { [TEAM_MEMBERS_RELATION]: ids },
  });
};
