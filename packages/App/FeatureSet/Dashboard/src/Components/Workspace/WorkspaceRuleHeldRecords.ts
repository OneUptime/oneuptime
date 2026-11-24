import {
  RECORD_CONDITION_KINDS,
  RecordConditionKind,
} from "./NotificationRuleForm/RecordConditionPicker";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import NotificationRuleCondition, {
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import RecordsById from "Common/UI/Utils/RecordsById";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * THE RECORDS A PAGE'S WORKSPACE RULES HOLD, READ BY THEIR IDS (#10646,
 * #10689).
 *
 * The rules page read the project's first 10,000 labels, SLOs, on-call
 * policies, schedules, teams and team memberships whole - the memberships
 * unsorted - to name what each rule's card shows: a value past them read
 * "No longer in this project", a schedule past them was left out of its
 * rule's summary, and a person whose memberships were all past them was
 * named by nobody.
 *
 * What the shown rules hold is read instead, by those ids only: the
 * monitors, labels, SLOs and policies of their conditions, and the people
 * and teams of their owners conditions, and the people, teams and on-call
 * schedules who join their channels.
 * Each id is read once, and remembered found or not (HeldRuleRecordCache).
 * A kind of record is named on the cards once every id of it the shown
 * rules hold has been read: until then - or when it could not be read -
 * it is undefined, and nothing of it is said to be gone.
 */

// The kinds of record a rule names by id, each as the cards are handed it.
export interface HeldRuleRecords {
  monitors?: Array<Monitor> | undefined;
  labels?: Array<Label> | undefined;
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
  onCallDutyPolicies?: Array<OnCallDutyPolicy> | undefined;
  // An owners condition's teams and people, and who joins a channel.
  teams?: Array<Team> | undefined;
  users?: Array<User> | undefined;
  // The schedules whose on-call person joins a channel.
  onCallSchedules?: Array<OnCallDutyPolicySchedule> | undefined;
}

type RecordKey =
  | "monitors"
  | "labels"
  | "serviceLevelObjectives"
  | "onCallDutyPolicies"
  | "onCallSchedules";

type HeldRecordKey = RecordKey | "teams" | "users";

// A kind read by its ids alone, and what it is read with.
interface RecordKind {
  key: RecordKey;
  modelType: { new (): BaseModel };
  select: Select<BaseModel>;
}

// A condition's kind, read as the condition's picker reads it.
const conditionKind: (
  modelType: { new (): BaseModel },
  key: RecordKey,
) => RecordKind = (
  modelType: { new (): BaseModel },
  key: RecordKey,
): RecordKind => {
  return {
    key: key,
    modelType: modelType,
    select: Object.values(RECORD_CONDITION_KINDS).find(
      (kind: RecordConditionKind | undefined): boolean => {
        return kind?.modelType === modelType;
      },
    )!.select,
  };
};

const CONDITION_RECORD_KINDS: Array<RecordKind> = [
  conditionKind(Monitor, "monitors"),
  conditionKind(Label, "labels"),
  conditionKind(ServiceLevelObjective, "serviceLevelObjectives"),
  conditionKind(OnCallDutyPolicy, "onCallDutyPolicies"),
];

const RECORD_KINDS: Array<RecordKind> = [
  ...CONDITION_RECORD_KINDS,
  {
    key: "onCallSchedules",
    modelType: OnCallDutyPolicySchedule,
    select: { _id: true, name: true } as Select<BaseModel>,
  },
];

const HELD_RECORD_KEYS: Array<HeldRecordKey> = [
  "monitors",
  "labels",
  "serviceLevelObjectives",
  "onCallDutyPolicies",
  "onCallSchedules",
  "teams",
  "users",
];

// The ids the rules hold, lower-cased, by the kind of record they name.
export interface HeldRuleIds {
  records: Record<RecordKey, Set<string>>;
  // People and teams, in one list as owners conditions hold them.
  people: Set<string>;
}

// No ids at all, to add to.
export const createHeldRuleIds: () => HeldRuleIds = (): HeldRuleIds => {
  return {
    records: {
      monitors: new Set<string>(),
      labels: new Set<string>(),
      serviceLevelObjectives: new Set<string>(),
      onCallDutyPolicies: new Set<string>(),
      onCallSchedules: new Set<string>(),
    },
    people: new Set<string>(),
  };
};

/*
 * Every id read, by kind: the record, or null when none answers to it -
 * deleted since, or out of the reader's reach. A person's id is in both
 * `teams` and `users` once read: a team, or null, and a person, or null.
 */
export type HeldRuleRecordCache = Record<
  HeldRecordKey,
  Map<string, BaseModel | null>
>;

export const createHeldRuleRecordCache: () => HeldRuleRecordCache =
  (): HeldRuleRecordCache => {
    return {
      monitors: new Map<string, BaseModel | null>(),
      labels: new Map<string, BaseModel | null>(),
      serviceLevelObjectives: new Map<string, BaseModel | null>(),
      onCallDutyPolicies: new Map<string, BaseModel | null>(),
      onCallSchedules: new Map<string, BaseModel | null>(),
      teams: new Map<string, BaseModel | null>(),
      users: new Map<string, BaseModel | null>(),
    };
  };

// A rule as the table reads it: its JSON, whatever kind of rule it is.
export interface RuleLike {
  notificationRule?: unknown;
}

const toIds: (values: unknown) => Array<string> = (
  values: unknown,
): Array<string> => {
  return RecordsById.getValuesToRead({
    ids: (Array.isArray(values) ? values : [])
      .filter((value: unknown): boolean => {
        return value !== undefined && value !== null;
      })
      .map((value: unknown): string => {
        return String(value);
      }),
  });
};

export const getHeldRuleIds: (rules: Array<RuleLike>) => HeldRuleIds = (
  rules: Array<RuleLike>,
): HeldRuleIds => {
  const held: HeldRuleIds = createHeldRuleIds();

  for (const rule of rules) {
    const notificationRule: Record<string, unknown> =
      (rule.notificationRule as Record<string, unknown> | undefined) || {};
    const conditions: Array<NotificationRuleCondition> = Array.isArray(
      notificationRule["filters"],
    )
      ? (notificationRule["filters"] as Array<NotificationRuleCondition>)
      : [];

    for (const condition of conditions) {
      const checkOn: NotificationRuleConditionCheckOn | undefined =
        condition?.checkOn;
      const ids: Array<string> = toIds(
        NotificationRuleConditionUtil.getValueIds(condition),
      );

      if (NotificationRuleConditionUtil.isOwnerCheckOn(checkOn)) {
        for (const id of ids) {
          held.people.add(id);
        }

        continue;
      }

      const modelType: { new (): BaseModel } | undefined = checkOn
        ? RECORD_CONDITION_KINDS[checkOn]?.modelType
        : undefined;
      const kind: RecordKind | undefined = CONDITION_RECORD_KINDS.find(
        (candidate: RecordKind): boolean => {
          return candidate.modelType === modelType;
        },
      );

      if (!kind) {
        continue;
      }

      for (const id of ids) {
        held.records[kind.key].add(id);
      }
    }

    for (const id of toIds(
      notificationRule["inviteOnCallSchedulesToNewChannel"],
    )) {
      held.records.onCallSchedules.add(id);
    }

    for (const id of [
      ...toIds(notificationRule["inviteUsersToNewChannel"]),
      ...toIds(notificationRule["inviteTeamsToNewChannel"]),
    ]) {
      held.people.add(id);
    }
  }

  return held;
};

const idOf: (record: BaseModel) => string = (record: BaseModel): string => {
  return record._id?.toString().toLowerCase() || "";
};

/*
 * A user is a member of the project through its teams: read through them,
 * a page of users at a time, so the memberships of one page always fit in
 * a read however many teams each is in.
 */
const USERS_BY_ID_PAGE_SIZE: number = 100;

// The project's users of these ids, read through their team memberships.
export const readProjectUsersByIds: (data: {
  projectId: ObjectID;
  userIds: Array<string>;
}) => Promise<Array<User>> = async (data: {
  projectId: ObjectID;
  userIds: Array<string>;
}): Promise<Array<User>> => {
  const users: Map<string, User> = new Map<string, User>();
  const ids: Array<string> = RecordsById.getValuesToRead({ ids: data.userIds });

  for (
    let start: number = 0;
    start < ids.length;
    start += USERS_BY_ID_PAGE_SIZE
  ) {
    const page: Array<string> = ids.slice(start, start + USERS_BY_ID_PAGE_SIZE);

    const result: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
      modelType: TeamMember,
      query: {
        projectId: data.projectId,
        userId: new Includes(
          page.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      } as Query<TeamMember>,
      select: {
        _id: true,
        user: {
          _id: true,
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      sort: {},
    });

    for (const member of result.data) {
      const user: User | undefined = member.user;
      const id: string = user ? idOf(user) : "";

      if (user && id && !users.has(id)) {
        users.set(id, user);
      }
    }
  }

  return Array.from(users.values());
};

// Each one found under its id, and each one not found as null.
const remember: (data: {
  cache: Map<string, BaseModel | null>;
  ids: Array<string>;
  found: Array<BaseModel>;
}) => void = (data: {
  cache: Map<string, BaseModel | null>;
  ids: Array<string>;
  found: Array<BaseModel>;
}): void => {
  const byId: Map<string, BaseModel> = new Map<string, BaseModel>();

  for (const record of data.found) {
    const id: string = idOf(record);

    if (id) {
      byId.set(id, record);
    }
  }

  for (const id of data.ids) {
    data.cache.set(id, byId.get(id) || null);
  }
};

/*
 * Reads into the cache what the ids hold that it has not read. A kind that
 * cannot be read is left unread, and said nothing of.
 */
export const readHeldRuleRecords: (data: {
  projectId: ObjectID;
  ids: HeldRuleIds;
  cache: HeldRuleRecordCache;
}) => Promise<void> = async (data: {
  projectId: ObjectID;
  ids: HeldRuleIds;
  cache: HeldRuleRecordCache;
}): Promise<void> => {
  const reads: Array<Promise<void>> = [];

  for (const kind of RECORD_KINDS) {
    const toRead: Array<string> = Array.from(data.ids.records[kind.key]).filter(
      (id: string): boolean => {
        return !data.cache[kind.key].has(id);
      },
    );

    if (toRead.length === 0) {
      continue;
    }

    reads.push(
      RecordsById.read<BaseModel>({
        modelType: kind.modelType,
        ids: toRead,
        query: { projectId: data.projectId } as Query<BaseModel>,
        select: kind.select,
      })
        .then((found: Array<BaseModel>) => {
          remember({ cache: data.cache[kind.key], ids: toRead, found: found });
        })
        .catch(() => {
          // Unread: named by nothing, and nothing said to be gone.
        }),
    );
  }

  // People: the teams among the ids, and the users among the rest.
  const people: Array<string> = Array.from(data.ids.people).filter(
    (id: string): boolean => {
      return !data.cache.teams.has(id) || !data.cache.users.has(id);
    },
  );

  if (people.length > 0) {
    reads.push(
      (async (): Promise<void> => {
        const teams: Array<Team> = await RecordsById.read<Team>({
          modelType: Team,
          ids: people,
          query: { projectId: data.projectId },
          select: { _id: true, name: true },
        });
        const teamIds: Set<string> = new Set<string>(teams.map(idOf));
        const others: Array<string> = people.filter((id: string): boolean => {
          return !teamIds.has(id);
        });
        const users: Array<User> = await readProjectUsersByIds({
          projectId: data.projectId,
          userIds: others,
        });

        remember({ cache: data.cache.teams, ids: people, found: teams });
        remember({ cache: data.cache.users, ids: others, found: users });

        // A team is no person.
        for (const id of teamIds) {
          data.cache.users.set(id, null);
        }
      })().catch(() => {
        // Unread: named by nothing, and nothing said to be gone.
      }),
    );
  }

  await Promise.all(reads);
};

/*
 * What the cards are drawn with: each kind's records the ids hold, once
 * every one of them is read - undefined while one is not.
 */
export const getHeldRuleRecords: (data: {
  ids: HeldRuleIds;
  cache: HeldRuleRecordCache;
}) => HeldRuleRecords = (data: {
  ids: HeldRuleIds;
  cache: HeldRuleRecordCache;
}): HeldRuleRecords => {
  const records: Record<string, Array<BaseModel> | undefined> = {};

  for (const key of HELD_RECORD_KEYS) {
    const ids: Set<string> =
      key === "teams" || key === "users"
        ? data.ids.people
        : data.ids.records[key];
    const cache: Map<string, BaseModel | null> = data.cache[key];
    const found: Array<BaseModel> = [];
    let isRead: boolean = true;

    for (const id of ids) {
      if (!cache.has(id)) {
        isRead = false;
        break;
      }

      const record: BaseModel | null | undefined = cache.get(id);

      if (record) {
        found.push(record);
      }
    }

    records[key] = isRead ? found : undefined;
  }

  return records as HeldRuleRecords;
};

// Whether any id is still to be read.
export const hasUnreadHeldRuleIds: (data: {
  ids: HeldRuleIds;
  cache: HeldRuleRecordCache;
}) => boolean = (data: {
  ids: HeldRuleIds;
  cache: HeldRuleRecordCache;
}): boolean => {
  const records: HeldRuleRecords = getHeldRuleRecords(data);

  return HELD_RECORD_KEYS.some((key: HeldRecordKey): boolean => {
    return records[key] === undefined;
  });
};

// Each record once, by its id, the later copy kept.
export const mergeRecordsById: <T extends BaseModel>(
  ...lists: Array<Array<T> | undefined>
) => Array<T> = <T extends BaseModel>(
  ...lists: Array<Array<T> | undefined>
): Array<T> => {
  const byId: Map<string, T> = new Map<string, T>();

  for (const list of lists) {
    for (const record of list || []) {
      const id: string = idOf(record);

      if (id) {
        byId.set(id, record);
      }
    }
  }

  return Array.from(byId.values());
};

// Who a rule's channel invites, each named.
export interface RuleInvitees {
  users: Array<User>;
  teams: Array<Team>;
  onCallSchedules: Array<OnCallDutyPolicySchedule>;
}

/*
 * Who a rule being edited invites to its channel - people, teams and
 * on-call schedules - each named for its summary: those the page knows
 * already (what its shown rules hold), and any other read by its id, so
 * the summary names one just picked. Nothing is read while `rule` is
 * undefined.
 */
export interface RuleInviteesSource {
  rule: unknown;
  // Named already: what the page's shown rules hold.
  users?: Array<User> | undefined;
  teams?: Array<Team> | undefined;
  onCallSchedules?: Array<OnCallDutyPolicySchedule> | undefined;
}

export const useRuleInvitees: (data: RuleInviteesSource) => RuleInvitees = (
  data: RuleInviteesSource,
): RuleInvitees => {
  const cacheRef: MutableRefObject<HeldRuleRecordCache> =
    useRef<HeldRuleRecordCache>(createHeldRuleRecordCache());
  // Drawn again as each read lands: what was read is in the cache.
  const [, setReadCount] = useState<number>(0);

  const known: Set<string> = new Set<string>(
    [
      ...(data.users || []),
      ...(data.teams || []),
      ...(data.onCallSchedules || []),
    ].map(idOf),
  );
  const held: HeldRuleIds = data.rule
    ? getHeldRuleIds([{ notificationRule: data.rule }])
    : createHeldRuleIds();
  const toRead: HeldRuleIds = createHeldRuleIds();

  for (const id of held.people) {
    if (!known.has(id) && !cacheRef.current.teams.has(id)) {
      toRead.people.add(id);
    }
  }

  for (const id of held.records.onCallSchedules) {
    if (!known.has(id) && !cacheRef.current.onCallSchedules.has(id)) {
      toRead.records.onCallSchedules.add(id);
    }
  }

  const toReadKey: string = [
    ...toRead.people,
    ...toRead.records.onCallSchedules,
  ]
    .sort()
    .join("|");

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId || !toReadKey) {
      return;
    }

    let isCurrent: boolean = true;

    void readHeldRuleRecords({
      projectId: projectId,
      ids: toRead,
      cache: cacheRef.current,
    }).then(() => {
      if (isCurrent) {
        setReadCount((count: number): number => {
          return count + 1;
        });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [toReadKey]);

  const foundIn: <T extends BaseModel>(
    cache: Map<string, BaseModel | null>,
  ) => Array<T> = <T extends BaseModel>(
    cache: Map<string, BaseModel | null>,
  ): Array<T> => {
    return Array.from(cache.values()).filter(
      (record: BaseModel | null): boolean => {
        return Boolean(record);
      },
    ) as Array<T>;
  };

  return {
    users: mergeRecordsById<User>(
      data.users,
      foundIn<User>(cacheRef.current.users),
    ),
    teams: mergeRecordsById<Team>(
      data.teams,
      foundIn<Team>(cacheRef.current.teams),
    ),
    onCallSchedules: mergeRecordsById<OnCallDutyPolicySchedule>(
      data.onCallSchedules,
      foundIn<OnCallDutyPolicySchedule>(cacheRef.current.onCallSchedules),
    ),
  };
};
