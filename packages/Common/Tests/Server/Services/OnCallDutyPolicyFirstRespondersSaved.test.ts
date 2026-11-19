import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import EscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import EscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import EscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyLabelRuleEngineService from "../../../Server/Services/OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyOwnerRuleEngineService from "../../../Server/Services/OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyOwnerTeamService from "../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import OnDutyPoliciesCache from "../../../Server/Utils/OnCall/OnDutyPoliciesCache";
import OnCallDutyPolicyWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  EVERY_NEW_EVENT_RULES_LANGUAGE_KEY,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
} from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import Permission from "../../../Types/Permission";
import {
  FirstOnCallPolicyCreate,
  buildFirstOnCallPolicy,
} from "../../../Utils/GuidedSetup/OnCallPolicyRecords";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A NEW ON-CALL POLICY IS SAVED WITH WHO GETS PAGED FIRST, WHOEVER MAY
 * CREATE ONE (#8952).
 *
 * Create On-Call Policy asks "Who gets paged first?", and the policy is
 * created with its first escalation rule paging them. Since #8908 a
 * create's column check refuses a value in a server-set column it is
 * handed without being told OneUptime wrote it, and two checks on the way
 * asked about who created a row - which OneUptime stamps after the checks,
 * and nobody may give a new record:
 *
 *   - the policy's own check of the rule's join rows, before anything is
 *     saved (OnCallDutyPolicyService.checkFirstRespondersCanBePaged), so the
 *     policy was refused;
 *   - every join row's early check (OnCallDutyPolicyChildService), handed the
 *     rows the rule service writes naming the person adding them, so a rule
 *     added with responders - from this form or the Escalation Rules page -
 *     lost them.
 *
 * These run the whole create through the real services - the policy's, the
 * escalation rule's and its three join tables', their permission checks and
 * their hooks - with the tables in memory, as each role that may create a
 * policy. Only what a create sets off elsewhere (feed entries, chat
 * channels, notifications, workflows, the audit log) is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "89520000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: string = "89520000-0000-4000-8000-0000000000a1";
const TEAM_ID: string = "89520000-0000-4000-8000-0000000000b1";
const PERSON_ID: string = "89520000-0000-4000-8000-0000000000c1";

// Each role that may create a policy, add its rules and page people, teams and schedules.
const ROLES: Array<Permission> = [
  Permission.OnCallMember,
  Permission.OnCallAdmin,
  Permission.ProjectMember,
  Permission.ProjectAdmin,
  Permission.ProjectOwner,
];

// What Create On-Call Policy sends for "Who gets paged first?": a schedule, a team and a person.
const FIRST_RESPONDERS: JSONObject = {
  onCallSchedules: [SCHEDULE_ID],
  teams: [TEAM_ID],
  users: [PERSON_ID],
};

let policies: InMemoryTable;
let rules: InMemoryTable;
let ruleUsers: InMemoryTable;
let ruleTeams: InMemoryTable;
let ruleSchedules: InMemoryTable;
let incidentOnCallRules: InMemoryTable;
let alertOnCallRules: InMemoryTable;
let errors: Array<string>;

// Every table in memory, by its model.
const tablesByModel: Map<unknown, InMemoryTable> = new Map<
  unknown,
  InMemoryTable
>();

function inMemory<TBaseModel extends BaseModel>(
  service: DatabaseService<TBaseModel>,
  rows: Array<StoredRow>,
): InMemoryTable {
  const table: InMemoryTable = useInMemoryTable(service, rows);
  tablesByModel.set(service.modelType, table);
  return table;
}

function caller(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: [permission],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

beforeEach(() => {
  errors = [];

  for (const silenced of ["debug", "info", "warn"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  // A rule that is not added is logged, and the policy kept: collect what was.
  getJestSpyOn(logger, "error").mockImplementation((error: unknown): void => {
    errors.push(String(error));
  });

  // The schedule, the team and the person are the project's own.
  stubProjectDirectory({});

  policies = inMemory(OnCallDutyPolicyService, []);
  rules = inMemory(EscalationRuleService, []);
  ruleUsers = inMemory(EscalationRuleUserService, []);
  ruleTeams = inMemory(EscalationRuleTeamService, []);
  ruleSchedules = inMemory(EscalationRuleScheduleService, []);
  incidentOnCallRules = inMemory(IncidentOnCallRuleService, []);
  alertOnCallRules = inMemory(AlertOnCallRuleService, []);
  inMemory(OnCallDutyPolicyOwnerUserService, []);
  inMemory(OnCallDutyPolicyOwnerTeamService, []);
  inMemory(TeamService, [
    { _id: TEAM_ID, projectId: PROJECT_ID.toString(), name: "Payments" },
  ]);
  inMemory(OnCallDutyPolicyScheduleService, [
    {
      _id: SCHEDULE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Primary",
    },
  ]);
  inMemory(TeamMemberService, [
    {
      _id: ObjectID.generate().toString(),
      projectId: PROJECT_ID.toString(),
      teamId: TEAM_ID,
      userId: PERSON_ID,
      hasAcceptedInvitation: true,
    },
  ]);
  inMemory(UserService, [
    { _id: PERSON_ID, name: "Ada Lovelace", email: "ada@acme.com" },
  ]);

  /*
   * A service made on the spot for a table (the on-call checks read the
   * policy and the rule through `new DatabaseService(...)`) reads the same
   * table in memory.
   */
  const getRepository: () => unknown = DatabaseService.prototype.getRepository;
  getJestSpyOn(DatabaseService.prototype, "getRepository").mockImplementation(
    function (this: DatabaseService<BaseModel>): unknown {
      const table: InMemoryTable | undefined = tablesByModel.get(
        this.modelType,
      );

      return table ? table.repository : getRepository.call(this);
    },
  );

  // What a create sets off elsewhere.
  getJestSpyOn(
    OnCallDutyPolicyFeedService,
    "createOnCallDutyPolicyFeedItem",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    OnCallDutyPolicyWorkspaceMessages,
    "createChannelsAndInviteUsersToChannels",
  ).mockResolvedValue(null);
  getJestSpyOn(
    OnCallDutyPolicyWorkspaceMessages,
    "getOnCallDutyPolicyCreateMessageBlocks",
  ).mockResolvedValue([]);
  getJestSpyOn(
    OnCallDutyPolicyLabelRuleEngineService,
    "applyRulesToOnCallDutyPolicy",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    OnCallDutyPolicyOwnerRuleEngineService,
    "applyRulesToOnCallDutyPolicy",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    UserNotificationSettingService,
    "sendUserNotification",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    OnCallDutyPolicyTimeLogService,
    "startTimeLogForUser",
  ).mockResolvedValue(undefined);
  getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
    FeedMarkdown.asMarkdown("Ada Lovelace"),
  );
  getJestSpyOn(
    OnCallDutyPolicyService,
    "getOnCallDutyPolicyLinkInDashboard",
  ).mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
  getJestSpyOn(
    DatabaseService.prototype,
    "onTriggerWorkflow",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    DatabaseService.prototype,
    "onTriggerRealtime",
  ).mockResolvedValue(undefined);
  getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);

  // A schedule a rule pages: its roster, its feeds and who is on call now.
  getJestSpyOn(
    OnCallDutyPolicyScheduleService,
    "refreshCurrentUserIdAndHandoffTimeInSchedule",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    OnCallDutyPolicyScheduleService,
    "propagateShiftConfigChange",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    OnCallDutyPolicyScheduleService,
    "getCurrentUserIdInSchedule",
  ).mockResolvedValue(null);
  getJestSpyOn(OnDutyPoliciesCache, "forgetProjects").mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

const POLICY_NAME: string = "Payments on-call";

/*
 * A case that creates more than one policy gives each its own name: two
 * policies of a project may not share one (#9834), so a second "Payments
 * on-call" is refused before the case reaches what it checks (#10002).
 */
async function createPolicy(
  props: DatabaseCommonInteractionProps,
  miscDataProps: JSONObject = FIRST_RESPONDERS,
  name: string = POLICY_NAME,
): Promise<OnCallDutyPolicy> {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = name;

  const createBy: CreateBy<OnCallDutyPolicy> = {
    data: policy,
    props: props,
    miscDataProps: miscDataProps,
  };

  return await OnCallDutyPolicyService.create(createBy);
}

function onlyRow(table: InMemoryTable): StoredRow {
  expect(table.inserts).toHaveLength(1);
  return table.inserts[0]!;
}

function id(value: unknown): string {
  return String(value).toLowerCase();
}

describe("a new policy with first responders", () => {
  test.each(ROLES)(
    "%s creates it with a schedule, a team and a person: it is saved with its first level paging them",
    async (permission: Permission) => {
      const props: DatabaseCommonInteractionProps = caller(permission);

      const created: OnCallDutyPolicy = await createPolicy(props);

      // Nothing was refused on the way, and nothing written around.
      expect(errors).toEqual([]);

      // The policy is saved, as the caller's.
      const policy: StoredRow = onlyRow(policies);
      expect(id(policy["_id"])).toBe(id(created.id));
      expect(id(policy["projectId"])).toBe(id(PROJECT_ID));
      expect(policy["name"]).toBe(POLICY_NAME);
      expect(id(policy["createdByUserId"])).toBe(id(props.userId));

      // With its first level: Level 1, waiting 30 minutes, on the new policy.
      const rule: StoredRow = onlyRow(rules);
      expect(id(rule["onCallDutyPolicyId"])).toBe(id(created.id));
      expect(id(rule["projectId"])).toBe(id(PROJECT_ID));
      expect(rule["order"]).toBe(1);
      expect(rule["name"]).toBe("Level 1");
      expect(rule["escalateAfterInMinutes"]).toBe(
        DEFAULT_ESCALATE_AFTER_IN_MINUTES,
      );
      expect(id(rule["createdByUserId"])).toBe(id(props.userId));

      // Paging the schedule, the team and the person, each added by the caller.
      const joins: Array<[InMemoryTable, string, string]> = [
        [ruleSchedules, "onCallDutyPolicyScheduleId", SCHEDULE_ID],
        [ruleTeams, "teamId", TEAM_ID],
        [ruleUsers, "userId", PERSON_ID],
      ];

      for (const [table, column, responderId] of joins) {
        const join: StoredRow = onlyRow(table);
        expect(id(join[column])).toBe(id(responderId));
        expect(id(join["onCallDutyPolicyEscalationRuleId"])).toBe(
          id(rule["_id"]),
        );
        expect(id(join["onCallDutyPolicyId"])).toBe(id(created.id));
        expect(id(join["projectId"])).toBe(id(PROJECT_ID));
        expect(id(join["createdByUserId"])).toBe(id(props.userId));
      }
    },
  );

  test("a schedule, a team or a person alone: the first level pages only them", async () => {
    /*
     * Three policies in one project, against the same tables: each has its
     * own name, and the tables are kept between them, so the counts below
     * add up across the three.
     */
    const kinds: Array<[string, JSONObject, () => InMemoryTable]> = [
      [
        "Payments on-call, paging a schedule",
        { onCallSchedules: [SCHEDULE_ID] },
        () => {
          return ruleSchedules;
        },
      ],
      [
        "Payments on-call, paging a team",
        { teams: [TEAM_ID] },
        () => {
          return ruleTeams;
        },
      ],
      [
        "Payments on-call, paging a person",
        { users: [PERSON_ID] },
        () => {
          return ruleUsers;
        },
      ],
    ];

    for (const [name, miscDataProps, table] of kinds) {
      const before: number = rules.inserts.length;

      const created: OnCallDutyPolicy = await createPolicy(
        caller(Permission.OnCallMember),
        miscDataProps,
        name,
      );

      expect(rules.inserts.length).toBe(before + 1);
      expect(table().inserts.length).toBe(1);

      // The new level pages only who was picked, on this policy.
      const rule: StoredRow = rules.inserts[rules.inserts.length - 1]!;
      expect(id(rule["onCallDutyPolicyId"])).toBe(id(created.id));
      expect(id(table().inserts[0]!["onCallDutyPolicyId"])).toBe(
        id(created.id),
      );
    }

    // All three are saved, under their own names.
    expect(
      policies.inserts.map((row: StoredRow): unknown => {
        return row["name"];
      }),
    ).toEqual(
      kinds.map(([name]: [string, JSONObject, () => InMemoryTable]) => {
        return name;
      }),
    );
    expect(rules.inserts).toHaveLength(3);
    expect(ruleUsers.inserts).toHaveLength(1);
    expect(ruleTeams.inserts).toHaveLength(1);
    expect(ruleSchedules.inserts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("a second policy of the project with the same name is still refused, and the first is kept", async () => {
    await createPolicy(caller(Permission.OnCallMember), {
      onCallSchedules: [SCHEDULE_ID],
    });

    await expect(
      createPolicy(caller(Permission.OnCallMember), { teams: [TEAM_ID] }),
    ).rejects.toThrow(
      `There is already an on-call policy called ${POLICY_NAME} in this project. Pick another name.`,
    );

    expect(policies.inserts).toHaveLength(1);
    expect(rules.inserts).toHaveLength(1);
    expect(ruleSchedules.inserts).toHaveLength(1);
    expect(ruleTeams.inserts).toHaveLength(0);
  });

  test("a person who is not a member of the project is still refused, before anything is saved", async () => {
    await expect(
      createPolicy(caller(Permission.OnCallMember), {
        users: [ObjectID.generate().toString()],
      }),
    ).rejects.toThrow(
      "Some of the people picked to be paged first are not members of this project.",
    );

    expect(policies.inserts).toHaveLength(0);
    expect(rules.inserts).toHaveLength(0);
    expect(ruleUsers.inserts).toHaveLength(0);
  });

  test("a caller who may create policies but not add people to a rule is still refused, before anything is saved", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...customDomainCaller({
        permissions: [
          Permission.CreateProjectOnCallDutyPolicy,
          Permission.ReadProjectOnCallDutyPolicy,
          Permission.CreateProjectOnCallDutyPolicyEscalationRule,
          Permission.ReadProjectOnCallDutyPolicyEscalationRule,
        ],
        projectId: PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
    };

    // Refused for the first join row it may not add, by its table: the schedule's.
    await expect(createPolicy(props)).rejects.toThrow(
      "You do not have permissions to create Escalation Rule Schedule.",
    );

    expect(policies.inserts).toHaveLength(0);
    expect(rules.inserts).toHaveLength(0);
  });
});

/*
 * A rule made with its responders as misc data: the Escalation Rules page's
 * Add Escalation Rule, a PagerDuty or Opsgenie import as the person running
 * it (ToolImportApplier), and the guided setup's first level all add one
 * this way, and the rule service writes a join row for each responder.
 */
describe("an escalation rule added by hand with people, teams and schedules", () => {
  test.each(ROLES)(
    "%s adds it from the Escalation Rules page: it is saved paging them",
    async (permission: Permission) => {
      const props: DatabaseCommonInteractionProps = caller(permission);

      // A policy with no rules yet.
      const created: OnCallDutyPolicy = await createPolicy(props, {});
      expect(rules.inserts).toHaveLength(0);

      // What Add Escalation Rule sends: the rule, and its responders as misc data.
      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.projectId = PROJECT_ID;
      rule.onCallDutyPolicyId = created.id!;
      rule.name = "Primary";
      rule.escalateAfterInMinutes = 15;

      await EscalationRuleService.create({
        data: rule,
        props: props,
        miscDataProps: {
          onCallSchedules: [new ObjectID(SCHEDULE_ID)],
          teams: [new ObjectID(TEAM_ID)],
          users: [new ObjectID(PERSON_ID)],
        },
      });

      const savedRule: StoredRow = onlyRow(rules);
      expect(savedRule["name"]).toBe("Primary");

      for (const table of [ruleSchedules, ruleTeams, ruleUsers]) {
        const join: StoredRow = onlyRow(table);
        expect(id(join["onCallDutyPolicyEscalationRuleId"])).toBe(
          id(savedRule["_id"]),
        );
        expect(id(join["createdByUserId"])).toBe(id(props.userId));
      }

      expect(errors).toEqual([]);
    },
  );
});

describe("a rule's responder added through the API", () => {
  test("a row read and sent back whole, naming someone else as its creator, is saved as the caller's", async () => {
    const props: DatabaseCommonInteractionProps = caller(
      Permission.OnCallMember,
    );
    const created: OnCallDutyPolicy = await createPolicy(props, {});

    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.projectId = PROJECT_ID;
    rule.onCallDutyPolicyId = created.id!;
    const savedRule: OnCallDutyPolicyEscalationRule =
      await EscalationRuleService.create({ data: rule, props: props });

    const someoneElse: ObjectID = ObjectID.generate();
    const join: BaseModel = new EscalationRuleUserService.modelType();
    Object.assign(join as unknown as Record<string, unknown>, {
      projectId: PROJECT_ID,
      onCallDutyPolicyId: created.id,
      onCallDutyPolicyEscalationRuleId: savedRule.id,
      userId: new ObjectID(PERSON_ID),
      createdByUserId: someoneElse,
    });

    await EscalationRuleUserService.create({
      data: join as never,
      props: props,
    });

    const saved: StoredRow = onlyRow(ruleUsers);
    expect(id(saved["userId"])).toBe(id(PERSON_ID));
    expect(id(saved["createdByUserId"])).toBe(id(props.userId));
    expect(errors).toEqual([]);
  });
});

/*
 * WHAT THE GUIDED ON-CALL SETUP SENDS (Dashboard
 * Components/GuidedSetup/OnCall/OnCallSetupApi), as each step builds it:
 * the first policy with the people and teams picked as its first level -
 * and, for someone who may add on-call rules, the two rules that run it for
 * every new incident and alert - then people and teams added to that level,
 * by a new rule when the policy has none and by join rows when it has one.
 * And the policy Ask AI's set_up_paging and the website-down setup create,
 * built by the same Common code they use (buildFirstOnCallPolicy).
 */
describe("the guided on-call setup", () => {
  // OnCallSetupApi.createPolicy: the people and teams picked, by id.
  function setupPolicy(addRules: boolean): JSONObject {
    const miscDataProps: JSONObject = {
      users: [PERSON_ID],
      teams: [TEAM_ID],
    };

    if (addRules) {
      miscDataProps[PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY] = true;
      miscDataProps[EVERY_NEW_EVENT_RULES_LANGUAGE_KEY] = "en";
    }

    return miscDataProps;
  }

  test.each([Permission.ProjectAdmin, Permission.ProjectOwner])(
    "%s sets up the first policy: saved with its first level and the two on-call rules that run it",
    async (permission: Permission) => {
      const created: OnCallDutyPolicy = await createPolicy(
        caller(permission),
        setupPolicy(true),
      );

      expect(errors).toEqual([]);
      expect(onlyRow(policies)["_id"]).toBeDefined();

      const rule: StoredRow = onlyRow(rules);
      expect(rule["name"]).toBe("Level 1");
      expect(id(onlyRow(ruleUsers)["userId"])).toBe(id(PERSON_ID));
      expect(id(onlyRow(ruleTeams)["teamId"])).toBe(id(TEAM_ID));
      expect(ruleSchedules.inserts).toHaveLength(0);

      // Every new incident and alert pages the new policy.
      for (const table of [incidentOnCallRules, alertOnCallRules]) {
        const onCallRule: StoredRow = onlyRow(table);
        expect(onCallRule["isEnabled"]).toBe(true);
        expect(id(onCallRule["projectId"])).toBe(id(PROJECT_ID));
      }

      expect(created.id).toBeDefined();
    },
  );

  test.each([Permission.ProjectAdmin, Permission.ProjectOwner])(
    "%s sets up paging from Ask AI or the website-down setup (buildFirstOnCallPolicy): saved with its first level and both on-call rules",
    async (permission: Permission) => {
      const create: FirstOnCallPolicyCreate = buildFirstOnCallPolicy({
        userIds: [PERSON_ID],
        teamIds: [TEAM_ID],
        language: "en",
      });
      create.policy.projectId = PROJECT_ID;

      await OnCallDutyPolicyService.create({
        data: create.policy,
        miscDataProps: create.miscDataProps,
        props: caller(permission),
      });

      expect(errors).toEqual([]);
      onlyRow(policies);
      expect(onlyRow(rules)["name"]).toBe("Level 1");
      expect(id(onlyRow(ruleUsers)["userId"])).toBe(id(PERSON_ID));
      expect(id(onlyRow(ruleTeams)["teamId"])).toBe(id(TEAM_ID));
      onlyRow(incidentOnCallRules);
      onlyRow(alertOnCallRules);
    },
  );

  test.each([
    Permission.OnCallMember,
    Permission.OnCallAdmin,
    Permission.ProjectMember,
  ])(
    "%s, who may not add on-call rules, sets up the first policy: saved with its first level",
    async (permission: Permission) => {
      await createPolicy(caller(permission), setupPolicy(false));

      expect(errors).toEqual([]);
      onlyRow(policies);
      expect(onlyRow(rules)["name"]).toBe("Level 1");
      expect(id(onlyRow(ruleUsers)["userId"])).toBe(id(PERSON_ID));
      expect(id(onlyRow(ruleTeams)["teamId"])).toBe(id(TEAM_ID));
    },
  );

  test.each(ROLES)(
    "%s adds people and teams to a policy with no level yet: a first level is made paging them",
    async (permission: Permission) => {
      const props: DatabaseCommonInteractionProps = caller(permission);
      const created: OnCallDutyPolicy = await createPolicy(props, {});

      // OnCallSetupApi.addToFirstLevel, with no first level.
      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.projectId = PROJECT_ID;
      rule.onCallDutyPolicyId = created.id!;
      rule.escalateAfterInMinutes = DEFAULT_ESCALATE_AFTER_IN_MINUTES;

      await EscalationRuleService.create({
        data: rule,
        props: props,
        miscDataProps: { users: [PERSON_ID], teams: [TEAM_ID] },
      });

      expect(errors).toEqual([]);
      expect(onlyRow(rules)["name"]).toBe("Level 1");
      expect(id(onlyRow(ruleUsers)["userId"])).toBe(id(PERSON_ID));
      expect(id(onlyRow(ruleTeams)["teamId"])).toBe(id(TEAM_ID));
    },
  );

  test.each(ROLES)(
    "%s adds people and teams to the first level a policy has: each is saved on it",
    async (permission: Permission) => {
      const props: DatabaseCommonInteractionProps = caller(permission);
      const created: OnCallDutyPolicy = await createPolicy(props, {
        onCallSchedules: [SCHEDULE_ID],
      });
      const firstLevel: StoredRow = onlyRow(rules);

      // OnCallSetupApi.addToFirstLevel, with a first level: a join row each.
      for (const [service, column, responderId] of [
        [EscalationRuleUserService, "userId", PERSON_ID],
        [EscalationRuleTeamService, "teamId", TEAM_ID],
      ] as Array<[DatabaseService<BaseModel>, string, string]>) {
        const row: BaseModel = new service.modelType();
        Object.assign(row as unknown as Record<string, unknown>, {
          projectId: PROJECT_ID,
          onCallDutyPolicyId: created.id,
          onCallDutyPolicyEscalationRuleId: new ObjectID(
            String(firstLevel["_id"]),
          ),
          [column]: new ObjectID(responderId),
        });

        await service.create({ data: row, props: props });
      }

      expect(errors).toEqual([]);
      expect(id(onlyRow(ruleUsers)["onCallDutyPolicyEscalationRuleId"])).toBe(
        id(firstLevel["_id"]),
      );
      expect(id(onlyRow(ruleTeams)["onCallDutyPolicyEscalationRuleId"])).toBe(
        id(firstLevel["_id"]),
      );
    },
  );
});
