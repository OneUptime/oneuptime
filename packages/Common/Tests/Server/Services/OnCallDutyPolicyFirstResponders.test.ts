import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import EscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import EscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import EscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * A NEW ON-CALL POLICY PAGES SOMEONE FROM THE START.
 *
 * Create On-Call Policy asks "Who gets paged first?" and sends the picks as
 * misc data (onCallSchedules, teams, users). OnCallDutyPolicyService.create
 * then adds the policy's first escalation rule - Level 1, waiting 30 minutes
 * - paging them. These tests drive the real create override and the real
 * escalation-rule create checks (OnCallDutyPolicyChildService), with only the
 * database stubbed:
 *
 *   - nobody to page: no rule, nothing extra read - as before;
 *   - somebody to page: one rule, created after the policy (and its creator's
 *     owner row) exist, as the caller, carrying the picks to its join rows;
 *   - what can be refused is refused before anything is saved: bad lists,
 *     a caller who may not add escalation rules or those responders, and
 *     responders from outside the project;
 *   - a rule that fails once the policy is saved is logged, and the policy
 *     is kept.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0f000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "0f000000-0000-4000-8000-000000000002",
);
const RULE_ID: ObjectID = new ObjectID("0f000000-0000-4000-8000-000000000003");
const CALLER_ID: ObjectID = new ObjectID(
  "0f000000-0000-4000-8000-000000000004",
);

const SCHEDULE_ID: string = "0f000000-0000-4000-8000-0000000000a1";
const TEAM_ID: string = "0f000000-0000-4000-8000-0000000000b1";
const USER_ID: string = "0f000000-0000-4000-8000-0000000000c1";

// Records of another project, or of nobody's.
const FOREIGN_SCHEDULE_ID: string = "0f000000-0000-4000-8000-0000000000a9";
const FOREIGN_TEAM_ID: string = "0f000000-0000-4000-8000-0000000000b9";
const STRANGER_ID: string = "0f000000-0000-4000-8000-0000000000c9";

// The base create as it is, taken before any test stubs it.
const REAL_BASE_CREATE: (
  this: DatabaseService<BaseModel>,
  createBy: CreateBy<BaseModel>,
) => Promise<BaseModel> = DatabaseService.prototype.create;

const OWN_SCHEDULES: Array<string> = [SCHEDULE_ID];
const OWN_TEAMS: Array<string> = [TEAM_ID];
const MEMBERS: Array<string> = [USER_ID, CALLER_ID.toString()];

function grant(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    scope: PermissionScope.All,
    isBlockPermission: false,
  };
}

function callerProps(
  permissions: Array<Permission> = [Permission.OnCallMember],
): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(grant),
      },
    },
  };
}

function newPolicy(): OnCallDutyPolicy {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = "Payments";
  return policy;
}

function createPolicy(
  miscDataProps: JSONObject | undefined,
  props: DatabaseCommonInteractionProps = callerProps(),
  data: OnCallDutyPolicy = newPolicy(),
): Promise<OnCallDutyPolicy> {
  const createBy: CreateBy<OnCallDutyPolicy> = { data, props };

  if (miscDataProps !== undefined) {
    createBy.miscDataProps = miscDataProps;
  }

  return OnCallDutyPolicyService.create(createBy);
}

const ALL_KINDS: JSONObject = {
  onCallSchedules: [SCHEDULE_ID],
  teams: [TEAM_ID],
  users: [USER_ID],
};

// The ids an `_id IN (...)` / `userId IN (...)` query asks for.
function idsIn(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters || {};

  const values: unknown = Object.values(parameters)[0];

  return Array.isArray(values)
    ? values.map((value: unknown): string => {
        return String(value).toLowerCase();
      })
    : [];
}

interface MembershipQuery {
  service: string;
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

let events: Array<string>;
let ruleCreates: Array<CreateBy<OnCallDutyPolicyEscalationRule>>;
let policyReads: Array<FindOneBy<BaseModel>>;
let membershipQueries: Array<MembershipQuery>;
let ruleCreateError: Error | null;
let policyCreateSpy: jest.SpyInstance;
let loggerErrorSpy: jest.SpyInstance;

beforeEach(() => {
  events = [];
  ruleCreates = [];
  policyReads = [];
  membershipQueries = [];
  ruleCreateError = null;

  /*
   * The policy's own create is stubbed at the base: it "saves" the policy and
   * stands for its hooks and the creator's owner row (the tick in between).
   * An escalation rule reaches the base only after the real
   * OnCallDutyPolicyChildService checks have passed.
   */
  policyCreateSpy = jest
    .spyOn(DatabaseService.prototype, "create")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      createBy: CreateBy<BaseModel>,
    ): Promise<BaseModel> {
      if (this.modelType === OnCallDutyPolicy) {
        events.push("policy create started");
        await Promise.resolve();
        const policy: OnCallDutyPolicy = createBy.data as OnCallDutyPolicy;
        policy.id = POLICY_ID;
        policy.projectId = createBy.props.tenantId || policy.projectId!;
        events.push("policy created, creator owns it");
        return policy;
      }

      if (this.modelType === OnCallDutyPolicyEscalationRule) {
        events.push("rule created");
        ruleCreates.push(createBy as CreateBy<OnCallDutyPolicyEscalationRule>);

        if (ruleCreateError) {
          throw ruleCreateError;
        }

        createBy.data.id = RULE_ID;
        return createBy.data;
      }

      throw new Error(`Unexpected create of ${this.modelType.name}`);
    });

  // The rule's create checks the caller can see, and create in, the policy.
  jest
    .spyOn(DatabaseService.prototype, "findOneBy")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      request: FindOneBy<BaseModel>,
    ): Promise<BaseModel | null> {
      if (this.modelType !== OnCallDutyPolicy) {
        return null;
      }

      policyReads.push(request);

      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = POLICY_ID;
      policy.projectId = PROJECT_ID;
      return policy;
    });

  jest
    .spyOn(TeamService, "countBy")
    .mockImplementation(async (request: any): Promise<PositiveNumber> => {
      membershipQueries.push({
        service: "Team",
        query: request.query,
        props: request.props,
      });

      return new PositiveNumber(
        idsIn(request.query._id).filter((id: string): boolean => {
          return OWN_TEAMS.includes(id);
        }).length,
      );
    });

  jest
    .spyOn(OnCallDutyPolicyScheduleService, "countBy")
    .mockImplementation(async (request: any): Promise<PositiveNumber> => {
      membershipQueries.push({
        service: "OnCallDutyPolicySchedule",
        query: request.query,
        props: request.props,
      });

      return new PositiveNumber(
        idsIn(request.query._id).filter((id: string): boolean => {
          return OWN_SCHEDULES.includes(id);
        }).length,
      );
    });

  jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation(async (request: any): Promise<Array<TeamMember>> => {
      membershipQueries.push({
        service: "TeamMember",
        query: request.query,
        props: request.props,
      });

      // One row per team the person is in: two teams for each member.
      return idsIn(request.query.userId)
        .filter((id: string): boolean => {
          return MEMBERS.includes(id);
        })
        .flatMap((id: string): Array<TeamMember> => {
          return [0, 1].map((): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.userId = new ObjectID(id.toUpperCase());
            return member;
          });
        });
    });

  loggerErrorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function policyWasSaved(): boolean {
  return events.includes("policy create started");
}

describe("a policy with nobody to page first", () => {
  test.each([
    ["no misc data", undefined],
    ["empty misc data", {}],
    ["only empty lists", { onCallSchedules: [], teams: [], users: [] }],
    ["other misc data only", { ownerUsers: [USER_ID] }],
  ] as Array<[string, JSONObject | undefined]>)(
    "%s: is created without a rule, as before",
    async (_label: string, miscDataProps: JSONObject | undefined) => {
      const policy: OnCallDutyPolicy = await createPolicy(miscDataProps);

      expect(policy.id?.toString()).toBe(POLICY_ID.toString());
      expect(events).toEqual([
        "policy create started",
        "policy created, creator owns it",
      ]);
      expect(ruleCreates).toHaveLength(0);
      // Nothing extra is looked up either.
      expect(membershipQueries).toHaveLength(0);
      expect(policyReads).toHaveLength(0);
    },
  );
});

describe("a policy with first responders", () => {
  test("gets one escalation rule, created after the policy and its owner", async () => {
    const policy: OnCallDutyPolicy = await createPolicy(ALL_KINDS);

    expect(policy.id?.toString()).toBe(POLICY_ID.toString());
    expect(events).toEqual([
      "policy create started",
      "policy created, creator owns it",
      "rule created",
    ]);
    expect(ruleCreates).toHaveLength(1);
  });

  test("the rule is the first level: on the new policy, waiting 30 minutes, named by the server", async () => {
    await createPolicy(ALL_KINDS);

    const rule: OnCallDutyPolicyEscalationRule = ruleCreates[0]!.data;

    expect(rule).toBeInstanceOf(OnCallDutyPolicyEscalationRule);
    expect(rule.onCallDutyPolicyId?.toString()).toBe(POLICY_ID.toString());
    expect(rule.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(rule.escalateAfterInMinutes).toBe(DEFAULT_ESCALATE_AFTER_IN_MINUTES);
    expect(DEFAULT_ESCALATE_AFTER_IN_MINUTES).toBe(30);

    // Left to the rule service: it puts the rule first and calls it Level 1.
    expect(rule.name).toBeUndefined();
    expect(rule.order).toBeUndefined();
    expect(rule.description).toBeUndefined();
  });

  test("the rule carries the picks as ids, under the keys a rule's create takes", async () => {
    await createPolicy(ALL_KINDS);

    const miscDataProps: JSONObject = ruleCreates[0]!.miscDataProps!;

    expect(Object.keys(miscDataProps).sort()).toEqual([
      "onCallSchedules",
      "teams",
      "users",
    ]);

    for (const [key, id] of [
      ["onCallSchedules", SCHEDULE_ID],
      ["teams", TEAM_ID],
      ["users", USER_ID],
    ] as Array<[string, string]>) {
      const ids: Array<ObjectID> = miscDataProps[key] as Array<ObjectID>;

      expect(ids).toHaveLength(1);
      expect(ids[0]).toBeInstanceOf(ObjectID);
      expect(ids[0]!.toString()).toBe(id);
    }
  });

  test("a kind nobody picked is passed on empty", async () => {
    await createPolicy({ teams: [TEAM_ID] });

    expect(ruleCreates[0]!.miscDataProps).toEqual({
      onCallSchedules: [],
      teams: [new ObjectID(TEAM_ID)],
      users: [],
    });
  });

  test("each responder once, whatever the case it was sent in", async () => {
    await createPolicy({
      users: [USER_ID.toUpperCase(), USER_ID, new ObjectID(USER_ID)],
    } as unknown as JSONObject);

    expect(
      (ruleCreates[0]!.miscDataProps!["users"] as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([USER_ID]);
  });

  test("the rule is created as the caller, through the escalation rule's own checks", async () => {
    const props: DatabaseCommonInteractionProps = callerProps();

    await createPolicy(ALL_KINDS, props);

    // The very props of the policy create: same user, same plan, not root.
    expect(ruleCreates[0]!.props).toBe(props);
    expect(ruleCreates[0]!.props.isRoot).toBeUndefined();

    /*
     * OnCallDutyPolicyChildService looked the policy up as the caller (and
     * then under the caller's create scope) before letting the rule through.
     */
    expect(policyReads.length).toBeGreaterThanOrEqual(1);
    expect(policyReads[0]!.props.userId?.toString()).toBe(CALLER_ID.toString());
    expect(String(policyReads[0]!.query["_id"])).toBe(POLICY_ID.toString());
  });

  test("an API caller's ObjectIDs are read the same as the dashboard's strings", async () => {
    await createPolicy({
      teams: [new ObjectID(TEAM_ID)],
      onCallSchedules: [new ObjectID(SCHEDULE_ID).toJSON()],
    } as unknown as JSONObject);

    expect(ruleCreates).toHaveLength(1);
    expect(
      (
        ruleCreates[0]!.miscDataProps!["onCallSchedules"] as Array<ObjectID>
      )[0]!.toString(),
    ).toBe(SCHEDULE_ID);
  });

  test("a root caller's policy names its project in the data", async () => {
    const data: OnCallDutyPolicy = newPolicy();
    data.projectId = PROJECT_ID;

    await createPolicy({ teams: [TEAM_ID] }, { isRoot: true }, data);

    expect(ruleCreates).toHaveLength(1);
    expect(ruleCreates[0]!.props.isRoot).toBe(true);
    expect(String(membershipQueries[0]!.query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("past the hooks (ignoreHooks), nothing is read and no rule is made", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...callerProps(),
      ignoreHooks: true,
    };

    // Not even a bad list is looked at.
    await createPolicy({ teams: "everyone" } as unknown as JSONObject, props);

    expect(ruleCreates).toHaveLength(0);
    expect(membershipQueries).toHaveLength(0);
    expect(policyWasSaved()).toBe(true);
  });
});

describe("refused before anything is saved", () => {
  test("a list that is not a list of ids", async () => {
    await expect(createPolicy({ users: ["alex@example.com"] })).rejects.toThrow(
      BadDataException,
    );

    expect(policyWasSaved()).toBe(false);
    expect(ruleCreates).toHaveLength(0);
  });

  test("a caller who may create policies but not escalation rules", async () => {
    const attempt: Promise<OnCallDutyPolicy> = createPolicy(
      ALL_KINDS,
      callerProps([Permission.CreateProjectOnCallDutyPolicy]),
    );

    await expect(attempt).rejects.toThrow(NotAuthorizedException);
    await expect(attempt).rejects.toThrow("Escalation Rule");

    expect(policyWasSaved()).toBe(false);
    expect(membershipQueries).toHaveLength(0);
  });

  test("a caller who may add rules, but not people to them, picking people", async () => {
    const attempt: Promise<OnCallDutyPolicy> = createPolicy(
      { users: [USER_ID] },
      callerProps([
        Permission.CreateProjectOnCallDutyPolicy,
        Permission.CreateProjectOnCallDutyPolicyEscalationRule,
        Permission.CreateProjectOnCallDutyPolicyEscalationRuleTeam,
      ]),
    );

    await expect(attempt).rejects.toThrow(NotAuthorizedException);
    await expect(attempt).rejects.toThrow(
      new OnCallDutyPolicyEscalationRuleUser().singularName!,
    );

    expect(policyWasSaved()).toBe(false);
  });

  test("the same caller picking only teams is let through: only the kinds picked are checked", async () => {
    await createPolicy(
      { teams: [TEAM_ID] },
      callerProps([
        Permission.CreateProjectOnCallDutyPolicy,
        Permission.CreateProjectOnCallDutyPolicyEscalationRule,
        Permission.CreateProjectOnCallDutyPolicyEscalationRuleTeam,
        Permission.ReadProjectOnCallDutyPolicy,
      ]),
    );

    expect(ruleCreates).toHaveLength(1);
  });

  test("a caller who may add rules and people but read no on-call policy, which a rule is read through", async () => {
    const attempt: Promise<OnCallDutyPolicy> = createPolicy(
      { teams: [TEAM_ID] },
      callerProps([
        Permission.CreateProjectOnCallDutyPolicy,
        Permission.CreateProjectOnCallDutyPolicyEscalationRule,
        Permission.CreateProjectOnCallDutyPolicyEscalationRuleTeam,
      ]),
    );

    await expect(attempt).rejects.toThrow(NotAuthorizedException);
    await expect(attempt).rejects.toThrow(
      "It is read through its On-Call Policy, and you need one of these permissions to read On-Call Duty Policies:",
    );

    expect(policyWasSaved()).toBe(false);
    expect(ruleCreates).toHaveLength(0);
    // Refused before anything is looked up.
    expect(membershipQueries).toHaveLength(0);
  });

  test.each([
    [
      "a team of another project",
      { teams: [TEAM_ID, FOREIGN_TEAM_ID] },
      "Some of the teams picked to be paged first are not in this project.",
    ],
    [
      "an on-call schedule of another project",
      { onCallSchedules: [FOREIGN_SCHEDULE_ID] },
      "Some of the on-call schedules picked to be paged first are not in this project.",
    ],
    [
      "a person who is not a member of the project",
      { users: [USER_ID, STRANGER_ID] },
      "Some of the people picked to be paged first are not members of this project.",
    ],
  ] as Array<[string, JSONObject, string]>)(
    "%s",
    async (_label: string, miscDataProps: JSONObject, message: string) => {
      await expect(createPolicy(miscDataProps)).rejects.toThrow(message);

      expect(policyWasSaved()).toBe(false);
      expect(ruleCreates).toHaveLength(0);
    },
  );

  test("a policy with no project", async () => {
    await expect(
      createPolicy({ teams: [TEAM_ID] }, { isRoot: true }),
    ).rejects.toThrow(
      "A project is required to page someone from a new on-call policy.",
    );

    expect(policyWasSaved()).toBe(false);
  });
});

describe("the project check", () => {
  test("looks each kind up in this project only, as root", async () => {
    await createPolicy(ALL_KINDS);

    expect(
      membershipQueries.map((query: MembershipQuery): string => {
        return query.service;
      }),
    ).toEqual(["Team", "OnCallDutyPolicySchedule", "TeamMember"]);

    for (const query of membershipQueries) {
      expect(String(query.query["projectId"])).toBe(PROJECT_ID.toString());
      expect(query.props.isRoot).toBe(true);
    }

    expect(idsIn(membershipQueries[0]!.query["_id"])).toEqual([TEAM_ID]);
    expect(idsIn(membershipQueries[1]!.query["_id"])).toEqual([SCHEDULE_ID]);
    expect(idsIn(membershipQueries[2]!.query["userId"])).toEqual([USER_ID]);
  });

  test("is made against the caller's project, not a project named in the data", async () => {
    const data: OnCallDutyPolicy = newPolicy();
    data.projectId = new ObjectID("0f000000-0000-4000-8000-0000000000ff");

    await createPolicy({ teams: [TEAM_ID] }, callerProps(), data);

    expect(String(membershipQueries[0]!.query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("looks up only the kinds that were picked", async () => {
    await createPolicy({ users: [USER_ID] });

    expect(
      membershipQueries.map((query: MembershipQuery): string => {
        return query.service;
      }),
    ).toEqual(["TeamMember"]);
  });

  test("a person in several of the project's teams is one member", async () => {
    await createPolicy({ users: [USER_ID, CALLER_ID.toString()] });

    expect(ruleCreates).toHaveLength(1);
  });
});

describe("once the policy is saved", () => {
  test("a rule that cannot be added is logged, and the policy is kept", async () => {
    ruleCreateError = new Error("The database went away.");

    const policy: OnCallDutyPolicy = await createPolicy(ALL_KINDS);

    expect(policy.id?.toString()).toBe(POLICY_ID.toString());
    expect(ruleCreates).toHaveLength(1);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(loggerErrorSpy.mock.calls[0]![0])).toContain(
      "The database went away.",
    );
    expect(loggerErrorSpy.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyId: POLICY_ID.toString(),
    });
  });

  test("a policy create that fails makes no rule", async () => {
    policyCreateSpy.mockImplementationOnce(async (): Promise<never> => {
      throw new BadDataException("name is required");
    });

    await expect(createPolicy(ALL_KINDS)).rejects.toThrow("name is required");

    expect(ruleCreates).toHaveLength(0);
  });
});

/*
 * What the escalation rule service makes of the rule it is handed: the same
 * rule the Add Escalation Rule dialog would have created.
 */
describe("the rule service, given the first rule", () => {
  async function firstRuleCreate(): Promise<
    CreateBy<OnCallDutyPolicyEscalationRule>
  > {
    await createPolicy(ALL_KINDS);
    return ruleCreates[0]!;
  }

  test("puts it first and calls it Level 1", async () => {
    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> =
      await firstRuleCreate();

    // A new policy has no rules yet.
    jest
      .spyOn(EscalationRuleService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest.spyOn(EscalationRuleService, "findBy").mockResolvedValue([] as never);

    const result: OnCreate<OnCallDutyPolicyEscalationRule> = await (
      EscalationRuleService as unknown as {
        onBeforeCreate: (
          createBy: CreateBy<OnCallDutyPolicyEscalationRule>,
        ) => Promise<OnCreate<OnCallDutyPolicyEscalationRule>>;
      }
    ).onBeforeCreate(createBy);

    expect(result.createBy.data.order).toBe(1);
    expect(result.createBy.data.name).toBe("Level 1");
    expect(result.createBy.data.escalateAfterInMinutes).toBe(30);
  });

  test("turns the picks into one join row per responder, as the caller", async () => {
    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> =
      await firstRuleCreate();

    const joins: Array<{ kind: string; createBy: CreateBy<BaseModel> }> = [];

    for (const [kind, service] of [
      ["user", EscalationRuleUserService],
      ["team", EscalationRuleTeamService],
      ["schedule", EscalationRuleScheduleService],
    ] as Array<[string, DatabaseService<BaseModel>]>) {
      jest
        .spyOn(service, "create")
        .mockImplementation(
          async (joinCreateBy: CreateBy<BaseModel>): Promise<BaseModel> => {
            joins.push({ kind, createBy: joinCreateBy });
            return joinCreateBy.data;
          },
        );
    }

    const createdRule: OnCallDutyPolicyEscalationRule = createBy.data;
    createdRule.id = RULE_ID;

    await (
      EscalationRuleService as unknown as {
        onCreateSuccess: (
          onCreate: OnCreate<OnCallDutyPolicyEscalationRule>,
          item: OnCallDutyPolicyEscalationRule,
        ) => Promise<OnCallDutyPolicyEscalationRule>;
      }
    ).onCreateSuccess({ createBy, carryForward: null }, createdRule);

    expect(
      joins.map((join: { kind: string }): string => {
        return join.kind;
      }),
    ).toEqual(["user", "team", "schedule"]);

    const [userJoin, teamJoin, scheduleJoin] = joins.map(
      (join: { createBy: CreateBy<BaseModel> }): BaseModel => {
        return join.createBy.data;
      },
    ) as [
      OnCallDutyPolicyEscalationRuleUser,
      OnCallDutyPolicyEscalationRuleTeam,
      OnCallDutyPolicyEscalationRuleSchedule,
    ];

    expect(userJoin.userId?.toString()).toBe(USER_ID);
    expect(teamJoin.teamId?.toString()).toBe(TEAM_ID);
    expect(scheduleJoin.onCallDutyPolicyScheduleId?.toString()).toBe(
      SCHEDULE_ID,
    );

    for (const join of [userJoin, teamJoin, scheduleJoin]) {
      expect(join.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(join.onCallDutyPolicyId?.toString()).toBe(POLICY_ID.toString());
      expect(join.onCallDutyPolicyEscalationRuleId?.toString()).toBe(
        RULE_ID.toString(),
      );
      expect(join.createdByUserId?.toString()).toBe(CALLER_ID.toString());
    }

    for (const join of joins) {
      expect(join.createBy.props).toBe(createBy.props);
    }
  });
});

/*
 * The ordering above is what lets a teammate whose access is limited to the
 * policies they own add the rule: the creator becomes an owner inside the
 * base create, after its success hook. This runs the real base create of the
 * policy (with the database and its side effects stubbed) to pin that the
 * rule is made after both.
 */
describe("with the real base create of the policy", () => {
  test("the rule is made after the policy's success hook and after its creator is made an owner", async () => {
    policyCreateSpy.mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      createBy: CreateBy<BaseModel>,
    ): Promise<BaseModel> {
      if (this.modelType === OnCallDutyPolicyEscalationRule) {
        events.push("rule created");
        ruleCreates.push(createBy as CreateBy<OnCallDutyPolicyEscalationRule>);
        return createBy.data;
      }

      return await REAL_BASE_CREATE.call(this, createBy);
    });

    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    jest.spyOn(OnCallDutyPolicyService, "getRepository").mockReturnValue({
      save: async (data: OnCallDutyPolicy): Promise<OnCallDutyPolicy> => {
        events.push("policy saved");
        data.id = POLICY_ID;
        return data;
      },
    } as never);

    jest
      .spyOn(
        OnCallDutyPolicyService as unknown as {
          onCreateSuccess: (
            onCreate: unknown,
            item: OnCallDutyPolicy,
          ) => Promise<OnCallDutyPolicy>;
        },
        "onCreateSuccess",
      )
      .mockImplementation(
        async (
          _onCreate: unknown,
          item: OnCallDutyPolicy,
        ): Promise<OnCallDutyPolicy> => {
          events.push("policy success hook");
          return item;
        },
      );

    jest
      .spyOn(
        OnCallDutyPolicyService as unknown as {
          autoOwnerOnCreate: () => Promise<void>;
        },
        "autoOwnerOnCreate",
      )
      .mockImplementation(async (): Promise<void> => {
        events.push("creator made an owner");
      });

    jest
      .spyOn(OnCallDutyPolicyService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AuditLogService, "recordCreate")
      .mockResolvedValue(undefined as never);

    const policy: OnCallDutyPolicy = await createPolicy(ALL_KINDS);

    expect(policy.id?.toString()).toBe(POLICY_ID.toString());
    expect(events).toEqual([
      "policy saved",
      "policy success hook",
      "creator made an owner",
      "rule created",
    ]);
  });
});
