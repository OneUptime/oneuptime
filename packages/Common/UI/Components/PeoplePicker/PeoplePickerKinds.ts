import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import {
  PeoplePickerKind,
  PeoplePickerOption,
  toPeoplePickerIds,
} from "./PeoplePickerTypes";

/*
 * What the people picker knows about each kind of record it can offer: how
 * to search it, how to look picks up by id, how to draw it, and what to call
 * it. Adding a kind (on-call schedules, say) is a member of PeoplePickerKind
 * and an entry here; the picker, its search list, the form field and the
 * read-only lists all take it from there.
 */

// How a pick of the kind is drawn.
export type PeoplePickerAvatarStyle =
  // A profile picture, or the person's initials on a colour of their own.
  | { type: "person" }
  // The group's initials on a dark tile, with a small people badge.
  | { type: "group" }
  // Something that is not a person or a group of people.
  | { type: "icon"; icon: IconProp };

export interface PeoplePickerSearchData {
  projectId: ObjectID;
  searchText: string;
  limit: number;
}

export interface PeoplePickerLookupData {
  projectId: ObjectID;
  ids: Array<string>;
}

export interface PeoplePickerKindDefinition {
  kind: PeoplePickerKind;
  // The heading of the kind's section in the search list.
  groupTitle: string;
  /*
   * A word beside a pick's name when the name alone does not say what it is
   * ("Platform" is a team). None for people.
   */
  tag?: string | undefined;
  // The name shown for a pick that can no longer be found.
  unknownName: string;
  avatar: PeoplePickerAvatarStyle;
  /*
   * What to select of a related row to show it - a rule's ownerTeams, say -
   * without asking the server again.
   */
  relationSelect: Record<string, true>;
  // A related row, read with relationSelect, as an option.
  fromModel: (model: BaseModel) => PeoplePickerOption | null;
  search: (data: PeoplePickerSearchData) => Promise<Array<PeoplePickerOption>>;
  getByIds: (
    data: PeoplePickerLookupData,
  ) => Promise<Array<PeoplePickerOption>>;
}

export const PEOPLE_PICKER_SEARCH_LIMIT: number = 25;

const readString: (value: unknown) => string = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return value.toString().trim();
};

const userToOption: (
  user: BaseModel | undefined,
) => PeoplePickerOption | null = (
  user: BaseModel | undefined,
): PeoplePickerOption | null => {
  if (!user) {
    return null;
  }

  const record: Record<string, unknown> = user as unknown as Record<
    string,
    unknown
  >;
  const id: string = readString(record["_id"]);

  if (!id) {
    return null;
  }

  const email: string = readString(record["email"]);

  return {
    kind: PeoplePickerKind.User,
    id: id,
    name: readString(record["name"]) || email || "Unknown user",
    description: email || undefined,
    userId: id,
    hasProfilePicture: Boolean(record["profilePictureId"]),
  };
};

const teamToOption: (
  team: BaseModel | undefined,
) => PeoplePickerOption | null = (
  team: BaseModel | undefined,
): PeoplePickerOption | null => {
  if (!team) {
    return null;
  }

  const record: Record<string, unknown> = team as unknown as Record<
    string,
    unknown
  >;
  const id: string = readString(record["_id"]);

  if (!id) {
    return null;
  }

  return {
    kind: PeoplePickerKind.Team,
    id: id,
    name: readString(record["name"]) || "Deleted team",
  };
};

const byName: (a: PeoplePickerOption, b: PeoplePickerOption) => number = (
  a: PeoplePickerOption,
  b: PeoplePickerOption,
): number => {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};

/*
 * A person is listed once however many of the project's teams they are in:
 * TeamMember is the project-scoped link to User the dashboard can list (the
 * User model is readable only by that user), so every lookup goes through it.
 */
const membersToUserOptions: (
  results: Array<ListResult<TeamMember>>,
) => Array<PeoplePickerOption> = (
  results: Array<ListResult<TeamMember>>,
): Array<PeoplePickerOption> => {
  const seen: Set<string> = new Set<string>();
  const options: Array<PeoplePickerOption> = [];

  for (const result of results) {
    for (const member of result.data) {
      const option: PeoplePickerOption | null = userToOption(
        member.user as BaseModel | undefined,
      );

      if (!option || seen.has(option.id)) {
        continue;
      }

      seen.add(option.id);
      options.push(option);
    }
  }

  return options.sort(byName);
};

const MEMBER_USER_SELECT: Record<string, unknown> = {
  _id: true,
  user: {
    _id: true,
    name: true,
    email: true,
    profilePictureId: true,
  },
};

const searchUsers: (
  data: PeoplePickerSearchData,
) => Promise<Array<PeoplePickerOption>> = async (
  data: PeoplePickerSearchData,
): Promise<Array<PeoplePickerOption>> => {
  const searchText: string = data.searchText.trim();

  /*
   * The term is matched against the name AND the email. A query has no OR
   * across two relation fields, so it is one query for each, joined below.
   */
  const queries: Array<Query<TeamMember>> = searchText
    ? [
        {
          projectId: data.projectId,
          user: { name: new Search(searchText) },
        } as unknown as Query<TeamMember>,
        {
          projectId: data.projectId,
          user: { email: new Search(searchText) },
        } as unknown as Query<TeamMember>,
      ]
    : [{ projectId: data.projectId } as Query<TeamMember>];

  const results: Array<ListResult<TeamMember>> = await Promise.all(
    queries.map((query: Query<TeamMember>) => {
      return ModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: query,
        limit: data.limit,
        skip: 0,
        select: MEMBER_USER_SELECT as never,
        sort: {},
      });
    }),
  );

  return membersToUserOptions(results);
};

const getUsersByIds: (
  data: PeoplePickerLookupData,
) => Promise<Array<PeoplePickerOption>> = async (
  data: PeoplePickerLookupData,
): Promise<Array<PeoplePickerOption>> => {
  if (data.ids.length === 0) {
    return [];
  }

  const result: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
    modelType: TeamMember,
    query: {
      projectId: data.projectId,
      userId: new Includes(data.ids),
    } as unknown as Query<TeamMember>,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: MEMBER_USER_SELECT as never,
    sort: {},
  });

  return membersToUserOptions([result]);
};

const searchTeams: (
  data: PeoplePickerSearchData,
) => Promise<Array<PeoplePickerOption>> = async (
  data: PeoplePickerSearchData,
): Promise<Array<PeoplePickerOption>> => {
  const searchText: string = data.searchText.trim();
  const query: Record<string, unknown> = { projectId: data.projectId };

  if (searchText) {
    query["name"] = new Search(searchText);
  }

  const result: ListResult<Team> = await ModelAPI.getList<Team>({
    modelType: Team,
    query: query as Query<Team>,
    limit: data.limit,
    skip: 0,
    select: { _id: true, name: true },
    sort: { name: SortOrder.Ascending },
  });

  return result.data
    .map((team: Team): PeoplePickerOption | null => {
      return teamToOption(team);
    })
    .filter((option: PeoplePickerOption | null): boolean => {
      return Boolean(option);
    }) as Array<PeoplePickerOption>;
};

const getTeamsByIds: (
  data: PeoplePickerLookupData,
) => Promise<Array<PeoplePickerOption>> = async (
  data: PeoplePickerLookupData,
): Promise<Array<PeoplePickerOption>> => {
  if (data.ids.length === 0) {
    return [];
  }

  const result: ListResult<Team> = await ModelAPI.getList<Team>({
    modelType: Team,
    query: {
      projectId: data.projectId,
      _id: new Includes(data.ids),
    } as unknown as Query<Team>,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: { _id: true, name: true },
    sort: { name: SortOrder.Ascending },
  });

  return result.data
    .map((team: Team): PeoplePickerOption | null => {
      return teamToOption(team);
    })
    .filter((option: PeoplePickerOption | null): boolean => {
      return Boolean(option);
    }) as Array<PeoplePickerOption>;
};

export const PEOPLE_PICKER_KIND_DEFINITIONS: Record<
  PeoplePickerKind,
  PeoplePickerKindDefinition
> = {
  [PeoplePickerKind.User]: {
    kind: PeoplePickerKind.User,
    groupTitle: "People",
    unknownName: "Unknown user",
    avatar: { type: "person" },
    relationSelect: {
      _id: true,
      name: true,
      email: true,
      profilePictureId: true,
    },
    fromModel: (model: BaseModel): PeoplePickerOption | null => {
      return userToOption(model);
    },
    search: searchUsers,
    getByIds: getUsersByIds,
  },
  [PeoplePickerKind.Team]: {
    kind: PeoplePickerKind.Team,
    groupTitle: "Teams",
    tag: "Team",
    unknownName: "Deleted team",
    avatar: { type: "group" },
    relationSelect: {
      _id: true,
      name: true,
    },
    fromModel: (model: BaseModel): PeoplePickerOption | null => {
      return teamToOption(model);
    },
    search: searchTeams,
    getByIds: getTeamsByIds,
  },
};

export const getPeoplePickerKindDefinition: (
  kind: PeoplePickerKind,
) => PeoplePickerKindDefinition = (
  kind: PeoplePickerKind,
): PeoplePickerKindDefinition => {
  return PEOPLE_PICKER_KIND_DEFINITIONS[kind];
};

// The rows of a list that a set of picks names, in the list's order.
export const pickModelsByIds: <TModel extends BaseModel>(
  models: Array<TModel>,
  ids: unknown,
) => Array<TModel> = <TModel extends BaseModel>(
  models: Array<TModel>,
  ids: unknown,
): Array<TModel> => {
  const wanted: Set<string> = new Set<string>(
    toPeoplePickerIds(ids).map((id: string): string => {
      return id.toLowerCase();
    }),
  );

  return models.filter((model: TModel): boolean => {
    return wanted.has((model._id?.toString() || "").toLowerCase());
  });
};

/*
 * The options for the related rows a record holds for some kinds - a rule's
 * ownerUsers and ownerTeams - in the order of the kinds, each once.
 */
export const getPeoplePickerOptionsFromModels: (
  data: Array<{ kind: PeoplePickerKind; models: unknown }>,
) => Array<PeoplePickerOption> = (
  data: Array<{ kind: PeoplePickerKind; models: unknown }>,
): Array<PeoplePickerOption> => {
  const options: Array<PeoplePickerOption> = [];
  const seen: Set<string> = new Set<string>();

  for (const entry of data) {
    const models: Array<unknown> = Array.isArray(entry.models)
      ? entry.models
      : entry.models
        ? [entry.models]
        : [];

    for (const model of models) {
      const option: PeoplePickerOption | null = getPeoplePickerKindDefinition(
        entry.kind,
      ).fromModel(model as BaseModel);

      if (!option) {
        continue;
      }

      const key: string = `${option.kind}:${option.id}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      options.push(option);
    }
  }

  return options;
};
