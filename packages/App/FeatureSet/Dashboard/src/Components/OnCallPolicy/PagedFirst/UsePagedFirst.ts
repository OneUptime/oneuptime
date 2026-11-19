import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "Common/Models/DatabaseModels/User";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  PagedFirst,
  PagedFirstOnCallNow,
  PagedFirstResponderRow,
  PagedFirstRuleRow,
  PagedFirstScheduleRow,
  getFirstRuleOfEachPolicy,
  getPagedFirstOfPolicies,
  getPagedFirstOfPolicy,
} from "Common/Types/OnCallDutyPolicy/PagedFirst";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { MutableRefObject, useCallback, useRef, useState } from "react";

/*
 * WHO EACH POLICY ON A PAGE OF THE LIST PAGES FIRST (#9701), for the On-Call
 * Policies list's Paged First column (Common/Types/OnCallDutyPolicy/
 * PagedFirst decides what each cell holds).
 *
 * Read once per page the list shows, with the reader's own permissions, as
 * the policy's Escalation Rules page reads them: the escalation rules of
 * the page's policies (their ids, places and names); then the people, teams
 * and schedules of each policy's first rule; then who is on call now in
 * those schedules, as the schedules keep it. Three rounds at most, however
 * many policies the page shows, each bounded by the page.
 *
 * A read the reader may not make - escalation rules kept from them - or one
 * that fails leaves the column's cells empty (the quiet dash), never an
 * error over the list: the list is the policies, and each one's page says
 * who it pages in full. A page read again, or another page, starts over;
 * an answer that arrives after a newer request is dropped.
 */

export interface PagedFirstOfPolicies {
  // Hand it every page of policies the list fetches.
  onPoliciesFetched: (policies: Array<OnCallDutyPolicy>) => void;
  // What a policy's cell holds: undefined while it is read, or if it failed.
  getPagedFirst: (policy: OnCallDutyPolicy) => PagedFirst | undefined;
  isLoading: boolean;
  // The last read failed, or was refused.
  hasFailed: boolean;
}

const idOf: (value: unknown) => string = (value: unknown): string => {
  if (!value) {
    return "";
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  if (typeof value === "string") {
    return value;
  }

  // A relation read back as a model or as JSON: its own id.
  const record: { _id?: unknown; id?: unknown } = value as {
    _id?: unknown;
    id?: unknown;
  };

  return idOf(record._id || record.id);
};

// A person as a chip says them: by name, or by email while they have none.
const nameOfUser: (user: User | undefined) => string = (
  user: User | undefined,
): string => {
  return user?.name?.toString() || user?.email?.toString() || "";
};

// Reads who each of these policies pages first. Exported for its tests.
export const readPagedFirstOfPolicies: (
  policyIds: Array<string>,
) => Promise<Map<string, PagedFirst>> = async (
  policyIds: Array<string>,
): Promise<Map<string, PagedFirst>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (policyIds.length === 0 || !projectId) {
    return new Map();
  }

  const rulesResult: ListResult<OnCallDutyPolicyEscalationRule> =
    await ModelAPI.getList<OnCallDutyPolicyEscalationRule>({
      modelType: OnCallDutyPolicyEscalationRule,
      query: {
        projectId: projectId,
        onCallDutyPolicyId: new Includes(policyIds),
      },
      select: {
        _id: true,
        name: true,
        order: true,
        onCallDutyPolicyId: true,
      },
      // As the Escalation Rules page reads them: by place, then by id.
      sort: {
        order: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  const rules: Array<PagedFirstRuleRow> = rulesResult.data.map(
    (rule: OnCallDutyPolicyEscalationRule): PagedFirstRuleRow => {
      return {
        id: idOf(rule._id),
        policyId: idOf(rule.onCallDutyPolicyId),
        order: typeof rule.order === "number" ? rule.order : Number(rule.order),
        name: rule.name?.toString() || "",
      };
    },
  );

  const firstRuleIds: Array<string> = Array.from(
    getFirstRuleOfEachPolicy(rules).values(),
  ).map((rule: PagedFirstRuleRow): string => {
    return rule.id;
  });

  let users: Array<PagedFirstResponderRow> = [];
  let teams: Array<PagedFirstResponderRow> = [];
  let schedules: Array<PagedFirstScheduleRow> = [];
  const onCallNow: PagedFirstOnCallNow = {};

  if (firstRuleIds.length > 0) {
    const [userJoins, teamJoins, scheduleJoins]: [
      ListResult<OnCallDutyPolicyEscalationRuleUser>,
      ListResult<OnCallDutyPolicyEscalationRuleTeam>,
      ListResult<OnCallDutyPolicyEscalationRuleSchedule>,
    ] = await Promise.all([
      ModelAPI.getList<OnCallDutyPolicyEscalationRuleUser>({
        modelType: OnCallDutyPolicyEscalationRuleUser,
        query: {
          projectId: projectId,
          onCallDutyPolicyEscalationRuleId: new Includes(firstRuleIds),
        },
        select: {
          _id: true,
          onCallDutyPolicyEscalationRuleId: true,
          user: {
            _id: true,
            name: true,
            email: true,
          },
        },
        sort: {},
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      }),
      ModelAPI.getList<OnCallDutyPolicyEscalationRuleTeam>({
        modelType: OnCallDutyPolicyEscalationRuleTeam,
        query: {
          projectId: projectId,
          onCallDutyPolicyEscalationRuleId: new Includes(firstRuleIds),
        },
        select: {
          _id: true,
          onCallDutyPolicyEscalationRuleId: true,
          team: {
            _id: true,
            name: true,
          },
        },
        sort: {},
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      }),
      ModelAPI.getList<OnCallDutyPolicyEscalationRuleSchedule>({
        modelType: OnCallDutyPolicyEscalationRuleSchedule,
        query: {
          projectId: projectId,
          onCallDutyPolicyEscalationRuleId: new Includes(firstRuleIds),
        },
        select: {
          _id: true,
          onCallDutyPolicyEscalationRuleId: true,
          pageNextInRotation: true,
          onCallDutyPolicySchedule: {
            _id: true,
            name: true,
          },
        },
        sort: {},
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      }),
    ]);

    users = userJoins.data
      .filter((join: OnCallDutyPolicyEscalationRuleUser): boolean => {
        return Boolean(join.user);
      })
      .map(
        (join: OnCallDutyPolicyEscalationRuleUser): PagedFirstResponderRow => {
          return {
            ruleId: idOf(join.onCallDutyPolicyEscalationRuleId),
            id: idOf(join.user),
            name: nameOfUser(join.user),
          };
        },
      );

    teams = teamJoins.data
      .filter((join: OnCallDutyPolicyEscalationRuleTeam): boolean => {
        return Boolean(join.team);
      })
      .map(
        (join: OnCallDutyPolicyEscalationRuleTeam): PagedFirstResponderRow => {
          return {
            ruleId: idOf(join.onCallDutyPolicyEscalationRuleId),
            id: idOf(join.team),
            name: join.team?.name?.toString() || "",
          };
        },
      );

    schedules = scheduleJoins.data
      .filter((join: OnCallDutyPolicyEscalationRuleSchedule): boolean => {
        return Boolean(join.onCallDutyPolicySchedule);
      })
      .map(
        (
          join: OnCallDutyPolicyEscalationRuleSchedule,
        ): PagedFirstScheduleRow => {
          return {
            ruleId: idOf(join.onCallDutyPolicyEscalationRuleId),
            id: idOf(join.onCallDutyPolicySchedule),
            name: join.onCallDutyPolicySchedule?.name?.toString() || "",
            isNextInRotation: Boolean(join.pageNextInRotation),
          };
        },
      );

    // Who is on call now, in the schedules paged for whoever is on call.
    const onCallScheduleIds: Array<string> = Array.from(
      new Set(
        schedules
          .filter((schedule: PagedFirstScheduleRow): boolean => {
            return !schedule.isNextInRotation && Boolean(schedule.id);
          })
          .map((schedule: PagedFirstScheduleRow): string => {
            return schedule.id;
          }),
      ),
    );

    if (onCallScheduleIds.length > 0) {
      const rosters: ListResult<OnCallDutyPolicySchedule> =
        await ModelAPI.getList<OnCallDutyPolicySchedule>({
          modelType: OnCallDutyPolicySchedule,
          query: {
            projectId: projectId,
            _id: new Includes(onCallScheduleIds),
          },
          select: {
            _id: true,
            currentUserOnRoster: {
              _id: true,
              name: true,
              email: true,
            },
          },
          sort: {},
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

      for (const schedule of rosters.data) {
        const onCall: string = nameOfUser(schedule.currentUserOnRoster);

        onCallNow[idOf(schedule._id).toLowerCase()] = onCall || null;
      }
    }
  }

  return getPagedFirstOfPolicies({
    policyIds: policyIds,
    rules: rules,
    users: users,
    teams: teams,
    schedules: schedules,
    onCallNow: onCallNow,
  });
};

const usePagedFirst: () => PagedFirstOfPolicies = (): PagedFirstOfPolicies => {
  const [pagedFirst, setPagedFirst] = useState<Map<string, PagedFirst>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasFailed, setHasFailed] = useState<boolean>(false);

  // The newest request: an answer to an older one is dropped.
  const requestRef: MutableRefObject<number> = useRef<number>(0);

  const onPoliciesFetched: (policies: Array<OnCallDutyPolicy>) => void =
    useCallback((policies: Array<OnCallDutyPolicy>): void => {
      const request: number = requestRef.current + 1;
      requestRef.current = request;

      const policyIds: Array<string> = policies
        .map((policy: OnCallDutyPolicy): string => {
          return idOf(policy.id || policy._id);
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        });

      setHasFailed(false);

      if (policyIds.length === 0) {
        setPagedFirst(new Map());
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      readPagedFirstOfPolicies(policyIds)
        .then((read: Map<string, PagedFirst>): void => {
          if (requestRef.current !== request) {
            return;
          }

          setPagedFirst(read);
          setIsLoading(false);
        })
        .catch((): void => {
          if (requestRef.current !== request) {
            return;
          }

          setPagedFirst(new Map());
          setHasFailed(true);
          setIsLoading(false);
        });
    }, []);

  const getPagedFirst: (policy: OnCallDutyPolicy) => PagedFirst | undefined = (
    policy: OnCallDutyPolicy,
  ): PagedFirst | undefined => {
    return getPagedFirstOfPolicy(pagedFirst, idOf(policy.id || policy._id));
  };

  return {
    onPoliciesFetched: onPoliciesFetched,
    getPagedFirst: getPagedFirst,
    isLoading: isLoading,
    hasFailed: hasFailed,
  };
};

export default usePagedFirst;
