import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { BILLING_ENABLED, getAllEnvVars } from "../../Config";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../Utils/Project";
import {
  translateTemplate,
  translationKey,
} from "../../Utils/TranslateTemplate";
import {
  PeoplePickerKind,
  PeoplePickerOption,
  toPeoplePickerIds,
} from "./PeoplePickerTypes";

/*
 * What the people picker knows about each kind of record it can offer: how
 * to search it, how to look picks up by id, how to draw it, and what to call
 * it. Adding a kind is a member of PeoplePickerKind and an entry here; the
 * picker, its search list, the form field and the read-only lists all take
 * it from there.
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

/*
 * On-call schedules: a pick pages whoever is on call in the schedule when the
 * escalation rule runs, not a fixed person.
 */
export const ON_CALL_SCHEDULE_GROUP_TITLE: string =
  translationKey("On-call schedules");
export const ON_CALL_SCHEDULE_TAG: string = translationKey("Schedule");
export const UNKNOWN_ON_CALL_SCHEDULE_NAME: string =
  translationKey("Unknown schedule");

/*
 * The next person in an on-call schedule's rotation: a pick pages the person
 * after whoever is on call, from the same rotation - the backup. The same
 * schedules are listed again under a heading of their own, each named after
 * its schedule and tagged "Next in rotation".
 */
export const NEXT_IN_ROTATION_GROUP_TITLE: string =
  translationKey("Next in rotation");
export const NEXT_IN_ROTATION_TAG: string = translationKey("Next in rotation");

// The schedule kinds: the on-call person, or the next one in the rotation.
type ScheduleKind =
  | PeoplePickerKind.OnCallSchedule
  | PeoplePickerKind.OnCallScheduleNextInRotation;

const scheduleToOption: (
  schedule: BaseModel | undefined,
  kind?: ScheduleKind,
) => PeoplePickerOption | null = (
  schedule: BaseModel | undefined,
  kind: ScheduleKind = PeoplePickerKind.OnCallSchedule,
): PeoplePickerOption | null => {
  if (!schedule) {
    return null;
  }

  const record: Record<string, unknown> = schedule as unknown as Record<
    string,
    unknown
  >;
  const id: string = readString(record["_id"]);

  if (!id) {
    return null;
  }

  return {
    kind: kind,
    id: id,
    name: readString(record["name"]) || UNKNOWN_ON_CALL_SCHEDULE_NAME,
  };
};

/*
 * On-call schedules are a paid feature on OneUptime Cloud. A project whose
 * plan cannot read them gets none to pick - its people and teams are still
 * listed - rather than a search list that fails as a whole. The server's
 * refusal (402) is read the same way, for a plan the dashboard has not
 * caught up with.
 */
export const canReadOnCallSchedulesOnCurrentPlan: () => boolean =
  (): boolean => {
    if (!BILLING_ENABLED) {
      return true;
    }

    try {
      const plan: PlanType | null = ProjectUtil.getCurrentPlan();
      const readPlan: PlanType | null =
        new OnCallDutyPolicySchedule().getReadBillingPlan();

      if (!plan || !readPlan) {
        return true;
      }

      return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        readPlan,
        plan,
        getAllEnvVars(),
      );
    } catch {
      /*
       * Plans this dashboard cannot read are not a reason to hide anything:
       * the server decides, and its 402 is handled below.
       */
      return true;
    }
  };

export const isPaymentRequiredError: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record: Record<string, unknown> = error as Record<string, unknown>;

  return (
    record["statusCode"] === ExceptionCode.PaymentRequiredException ||
    record["code"] === ExceptionCode.PaymentRequiredException
  );
};

const listSchedules: (data: {
  query: Record<string, unknown>;
  limit: number;
  // Which kind the schedules are listed as. Default: their on-call person.
  kind?: ScheduleKind | undefined;
}) => Promise<Array<PeoplePickerOption>> = async (data: {
  query: Record<string, unknown>;
  limit: number;
  kind?: ScheduleKind | undefined;
}): Promise<Array<PeoplePickerOption>> => {
  if (!canReadOnCallSchedulesOnCurrentPlan()) {
    return [];
  }

  let result: ListResult<OnCallDutyPolicySchedule>;

  try {
    result = await ModelAPI.getList<OnCallDutyPolicySchedule>({
      modelType: OnCallDutyPolicySchedule,
      query: data.query as Query<OnCallDutyPolicySchedule>,
      limit: data.limit,
      skip: 0,
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
    });
  } catch (error) {
    if (isPaymentRequiredError(error)) {
      return [];
    }

    throw error;
  }

  return result.data
    .map((schedule: OnCallDutyPolicySchedule): PeoplePickerOption | null => {
      return scheduleToOption(schedule, data.kind);
    })
    .filter((option: PeoplePickerOption | null): boolean => {
      return Boolean(option);
    }) as Array<PeoplePickerOption>;
};

const searchSchedulesAs: (
  kind: ScheduleKind,
) => (data: PeoplePickerSearchData) => Promise<Array<PeoplePickerOption>> = (
  kind: ScheduleKind,
): ((data: PeoplePickerSearchData) => Promise<Array<PeoplePickerOption>>) => {
  return async (
    data: PeoplePickerSearchData,
  ): Promise<Array<PeoplePickerOption>> => {
    const searchText: string = data.searchText.trim();
    const query: Record<string, unknown> = { projectId: data.projectId };

    if (searchText) {
      query["name"] = new Search(searchText);
    }

    return await listSchedules({ query: query, limit: data.limit, kind });
  };
};

const getSchedulesByIdsAs: (
  kind: ScheduleKind,
) => (data: PeoplePickerLookupData) => Promise<Array<PeoplePickerOption>> = (
  kind: ScheduleKind,
): ((data: PeoplePickerLookupData) => Promise<Array<PeoplePickerOption>>) => {
  return async (
    data: PeoplePickerLookupData,
  ): Promise<Array<PeoplePickerOption>> => {
    if (data.ids.length === 0) {
      return [];
    }

    return await listSchedules({
      query: {
        projectId: data.projectId,
        _id: new Includes(data.ids),
      },
      limit: LIMIT_PER_PROJECT,
      kind,
    });
  };
};

const searchSchedules: (
  data: PeoplePickerSearchData,
) => Promise<Array<PeoplePickerOption>> = searchSchedulesAs(
  PeoplePickerKind.OnCallSchedule,
);

const getSchedulesByIds: (
  data: PeoplePickerLookupData,
) => Promise<Array<PeoplePickerOption>> = getSchedulesByIdsAs(
  PeoplePickerKind.OnCallSchedule,
);

/*
 * On-call policies: a pick runs the policy's own escalation rules. An
 * archived policy pages no one, so it is not offered - but one picked before
 * it was archived is still shown, and says so, so it can be seen and taken
 * out.
 */
export const ON_CALL_POLICY_GROUP_TITLE: string =
  translationKey("On-call policies");
export const ON_CALL_POLICY_TAG: string = translationKey("Policy");
export const UNKNOWN_ON_CALL_POLICY_NAME: string =
  translationKey("Unknown policy");
export const ARCHIVED_ON_CALL_POLICY_NAME: string = translationKey(
  "{{policyName}} (archived)",
);

const policyToOption: (
  policy: BaseModel | undefined,
) => PeoplePickerOption | null = (
  policy: BaseModel | undefined,
): PeoplePickerOption | null => {
  if (!policy) {
    return null;
  }

  const record: Record<string, unknown> = policy as unknown as Record<
    string,
    unknown
  >;
  const id: string = readString(record["_id"]);

  if (!id) {
    return null;
  }

  const name: string = readString(record["name"]);

  if (!name) {
    return {
      kind: PeoplePickerKind.OnCallPolicy,
      id: id,
      name: UNKNOWN_ON_CALL_POLICY_NAME,
    };
  }

  return {
    kind: PeoplePickerKind.OnCallPolicy,
    id: id,
    name:
      record["isArchived"] === true
        ? translateTemplate(ARCHIVED_ON_CALL_POLICY_NAME, {
            policyName: name,
          })
        : name,
  };
};

/*
 * Every plan can read its on-call policies, so there is no plan to ask
 * about before listing them. Should the server refuse the list for the plan
 * all the same (402), that reads as none to pick, as it does for schedules,
 * rather than as a search list that fails.
 */
const listPolicies: (data: {
  query: Record<string, unknown>;
  limit: number;
}) => Promise<Array<PeoplePickerOption>> = async (data: {
  query: Record<string, unknown>;
  limit: number;
}): Promise<Array<PeoplePickerOption>> => {
  let result: ListResult<OnCallDutyPolicy>;

  try {
    result = await ModelAPI.getList<OnCallDutyPolicy>({
      modelType: OnCallDutyPolicy,
      query: data.query as Query<OnCallDutyPolicy>,
      limit: data.limit,
      skip: 0,
      select: { _id: true, name: true, isArchived: true },
      sort: { name: SortOrder.Ascending },
    });
  } catch (error) {
    if (isPaymentRequiredError(error)) {
      return [];
    }

    throw error;
  }

  return result.data
    .map((policy: OnCallDutyPolicy): PeoplePickerOption | null => {
      return policyToOption(policy);
    })
    .filter((option: PeoplePickerOption | null): boolean => {
      return Boolean(option);
    }) as Array<PeoplePickerOption>;
};

const searchPolicies: (
  data: PeoplePickerSearchData,
) => Promise<Array<PeoplePickerOption>> = async (
  data: PeoplePickerSearchData,
): Promise<Array<PeoplePickerOption>> => {
  const searchText: string = data.searchText.trim();
  // The policies the On-Call Policies page lists: those not archived.
  const query: Record<string, unknown> = {
    projectId: data.projectId,
    isArchived: false,
  };

  if (searchText) {
    query["name"] = new Search(searchText);
  }

  return await listPolicies({ query: query, limit: data.limit });
};

const getPoliciesByIds: (
  data: PeoplePickerLookupData,
) => Promise<Array<PeoplePickerOption>> = async (
  data: PeoplePickerLookupData,
): Promise<Array<PeoplePickerOption>> => {
  if (data.ids.length === 0) {
    return [];
  }

  // Archived or not: a pick made before a policy was archived is still named.
  return await listPolicies({
    query: {
      projectId: data.projectId,
      _id: new Includes(data.ids),
    },
    limit: LIMIT_PER_PROJECT,
  });
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
  [PeoplePickerKind.OnCallSchedule]: {
    kind: PeoplePickerKind.OnCallSchedule,
    groupTitle: ON_CALL_SCHEDULE_GROUP_TITLE,
    tag: ON_CALL_SCHEDULE_TAG,
    unknownName: UNKNOWN_ON_CALL_SCHEDULE_NAME,
    avatar: { type: "icon", icon: IconProp.Calendar },
    relationSelect: {
      _id: true,
      name: true,
    },
    fromModel: (model: BaseModel): PeoplePickerOption | null => {
      return scheduleToOption(model);
    },
    search: searchSchedules,
    getByIds: getSchedulesByIds,
  },
  [PeoplePickerKind.OnCallScheduleNextInRotation]: {
    kind: PeoplePickerKind.OnCallScheduleNextInRotation,
    groupTitle: NEXT_IN_ROTATION_GROUP_TITLE,
    tag: NEXT_IN_ROTATION_TAG,
    unknownName: UNKNOWN_ON_CALL_SCHEDULE_NAME,
    // Fast-forward: the one after.
    avatar: { type: "icon", icon: IconProp.Forward },
    relationSelect: {
      _id: true,
      name: true,
    },
    fromModel: (model: BaseModel): PeoplePickerOption | null => {
      return scheduleToOption(
        model,
        PeoplePickerKind.OnCallScheduleNextInRotation,
      );
    },
    search: searchSchedulesAs(PeoplePickerKind.OnCallScheduleNextInRotation),
    getByIds: getSchedulesByIdsAs(
      PeoplePickerKind.OnCallScheduleNextInRotation,
    ),
  },
  [PeoplePickerKind.OnCallPolicy]: {
    kind: PeoplePickerKind.OnCallPolicy,
    groupTitle: ON_CALL_POLICY_GROUP_TITLE,
    tag: ON_CALL_POLICY_TAG,
    unknownName: UNKNOWN_ON_CALL_POLICY_NAME,
    avatar: { type: "icon", icon: IconProp.Call },
    relationSelect: {
      _id: true,
      name: true,
    },
    fromModel: (model: BaseModel): PeoplePickerOption | null => {
      return policyToOption(model);
    },
    search: searchPolicies,
    getByIds: getPoliciesByIds,
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
