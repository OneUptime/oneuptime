import AuditLogService from "../../../../Server/Services/AuditLogService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import MonitorFeedService from "../../../../Server/Services/MonitorFeedService";
import MonitorOwnerRuleEngineService from "../../../../Server/Services/MonitorOwnerRuleEngineService";
import MonitorOwnerRuleService from "../../../../Server/Services/MonitorOwnerRuleService";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import OnBehalfOfProps from "../../../../Server/Utils/AuditLog/OnBehalfOfProps";
import logger from "../../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import RuleRunRegistry, {
  RuleRunDefinition,
} from "../../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { MonitorFeedEventType } from "../../../../Models/DatabaseModels/MonitorFeed";
import MonitorOwnerRule from "../../../../Models/DatabaseModels/MonitorOwnerRule";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WriteSource from "../../../../Types/BaseDatabase/WriteSource";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  RuleRunAction,
  RuleRunType,
  RuleRunTypeUtil,
} from "../../../../Types/Rules/RuleRun";
import UserType from "../../../../Types/UserType";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE OWNERS AN OWNER RULE ADDS, AND THE RECORDS A PRIVACY RULE MAKES
 * PRIVATE, IN THE AUDIT LOG (issue #6300).
 *
 * Run now wrote both as plain root, so the audit log credited them to
 * System: kept only when the project stores system events, and saying
 * nobody ran the rule. They are now written on the behalf of whoever ran
 * it (RuleRunWriteProps: root, as before - who may run a rule is asked at
 * the route - with their identity and none of their permissions), and a
 * rule applied as a record is created stays OneUptime's own.
 *
 *   - Every owner and privacy rule the registry runs, driven through its
 *     engine: each row it writes carries who ran the rule, and nobody when
 *     nobody did. A rule type added to the registry is swept the day it is.
 *   - The monitor engine end to end, through DatabaseService's own create:
 *     what reaches the audit log, the creator the owner row is stamped
 *     with, and who the "added as owner" feed item is by.
 *
 * HookFreeWritesAreRecorded.test.ts holds the engines' code to the same.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OWNER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OWNER_TEAM_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const RULE_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const KEY_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const GRANT_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");

// A person who ran the rule, with everything a dashboard request carries.
const RUNNER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: RUNNER_ID,
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [{ permission: Permission.ProjectOwner } as never],
    } as never,
  },
  userTeamIds: [OWNER_TEAM_ID],
  currentPlan: PlanType.Enterprise,
  isMultiTenantRequest: false,
};

// What their run's writes carry: who they are, as root, and nothing more.
const ON_THEIR_BEHALF: DatabaseCommonInteractionProps = {
  isRoot: true,
  userId: RUNNER_ID,
  userType: UserType.User,
};

const OWN: DatabaseCommonInteractionProps = { isRoot: true };

beforeEach(() => {
  for (const silenced of ["error", "warn", "debug", "info"] as const) {
    jest.spyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The rules whose Run now adds owners or makes records private.
const RUN_TYPES: Array<RuleRunType> = Object.values(RuleRunType).filter(
  (ruleType: RuleRunType): boolean => {
    const action: RuleRunAction = RuleRunTypeUtil.getAction(ruleType);

    return (
      action === RuleRunAction.AddOwners || action === RuleRunAction.MarkPrivate
    );
  },
);

function definitionOf(ruleType: RuleRunType): RuleRunDefinition {
  const definition: RuleRunDefinition | null =
    RuleRunRegistry.getDefinition(ruleType);

  if (!definition) {
    throw new Error(`${ruleType} has no rule run definition`);
  }

  return definition;
}

/*
 * What a rule writes: its owner rows for an owner rule, and the record
 * itself, made private, for a privacy rule.
 */
function targetTablesOf(ruleType: RuleRunType): Array<string> {
  const definition: RuleRunDefinition = definitionOf(ruleType);

  if (RuleRunTypeUtil.getAction(ruleType) === RuleRunAction.MarkPrivate) {
    return [new definition.resourceModelType().tableName!];
  }

  return (definition.ownerModelTypes || []).map(
    (modelType: { new (): BaseModel }): string => {
      return new modelType().tableName!;
    },
  );
}

describe("every owner and privacy rule's Run now", () => {
  interface Write {
    table: string;
    method: string;
    props: DatabaseCommonInteractionProps;
  }

  let writes: Array<Write>;

  /*
   * Every service is a DatabaseService: its reads answer with one record
   * (the resource, which a rule with no conditions matches) or nothing (no
   * owner yet), and its writes are captured with the props they are made
   * with, the feed's among them.
   */
  beforeEach(() => {
    writes = [];

    jest
      .spyOn(DatabaseService.prototype, "findOneById")
      .mockImplementation(async function (
        this: DatabaseService<BaseModel>,
      ): Promise<BaseModel> {
        const row: BaseModel = new this.modelType();
        row.id = RESOURCE_ID;
        const record: Record<string, unknown> = row as unknown as Record<
          string,
          unknown
        >;
        record["projectId"] = PROJECT_ID;
        record["name"] = "prod-core-01";
        record["title"] = "prod-core-01";
        record["description"] = "The core cluster";
        record["labels"] = [];
        return row;
      } as never);
    jest
      .spyOn(DatabaseService.prototype, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(DatabaseService.prototype, "findOneBy")
      .mockResolvedValue(null as never);

    // A write, captured with the props it is made with.
    const capture: (method: string) => unknown = (method: string): unknown => {
      return async function (
        this: DatabaseService<BaseModel>,
        data: { data: BaseModel; props: DatabaseCommonInteractionProps },
      ): Promise<BaseModel> {
        writes.push({
          table: this.getModel().tableName || "",
          method: method,
          props: data.props,
        });
        return data.data;
      };
    };

    jest
      .spyOn(DatabaseService.prototype, "create")
      .mockImplementation(capture("create") as never);
    jest
      .spyOn(DatabaseService.prototype, "updateOneById")
      .mockImplementation(capture("updateOneById") as never);

    jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockResolvedValue(true);
    stubProjectDirectory({});
  });

  // A rule with no conditions, naming one user and one team, telling nobody.
  function ruleOf(definition: RuleRunDefinition): BaseModel {
    const rule: BaseModel = new definition.ruleModelType();
    rule.id = RULE_ID;
    const record: Record<string, unknown> = rule as unknown as Record<
      string,
      unknown
    >;
    record["name"] = "Platform on call";
    record["isEnabled"] = true;
    record["notifyOwners"] = false;
    record["ownerUsers"] = [new User(OWNER_USER_ID)];
    record["ownerTeams"] = [new Team(OWNER_TEAM_ID)];
    return rule;
  }

  // The record as a pass hands it over: its id and its project.
  function resourceOf(definition: RuleRunDefinition): BaseModel {
    const resource: BaseModel = new definition.resourceModelType();
    resource.id = RESOURCE_ID;
    const record: Record<string, unknown> = resource as unknown as Record<
      string,
      unknown
    >;
    record["projectId"] = PROJECT_ID;
    record["name"] = "prod-core-01";
    record["title"] = "prod-core-01";
    return resource;
  }

  async function run(
    ruleType: RuleRunType,
    props: DatabaseCommonInteractionProps | undefined,
  ): Promise<RuleApplicationResult> {
    const definition: RuleRunDefinition = definitionOf(ruleType);

    return await definition.engine.applyRulesToExistingResource({
      resource: resourceOf(definition),
      rules: [ruleOf(definition)],
      allowOwnerNotification: false,
      props: props,
    });
  }

  function targetWrites(ruleType: RuleRunType): Array<Write> {
    const tables: Array<string> = targetTablesOf(ruleType);

    return writes.filter((write: Write): boolean => {
      return tables.includes(write.table);
    });
  }

  test("covers every owner and privacy rule there is", () => {
    expect(
      RUN_TYPES.filter((ruleType: RuleRunType): boolean => {
        return RuleRunTypeUtil.getAction(ruleType) === RuleRunAction.AddOwners;
      }).length,
    ).toBeGreaterThanOrEqual(34);
    expect(
      RUN_TYPES.filter((ruleType: RuleRunType): boolean => {
        return (
          RuleRunTypeUtil.getAction(ruleType) === RuleRunAction.MarkPrivate
        );
      }).length,
    ).toBeGreaterThanOrEqual(4);

    for (const ruleType of RUN_TYPES) {
      expect([ruleType, targetTablesOf(ruleType).length > 0]).toEqual([
        ruleType,
        true,
      ]);
    }
  });

  test.each(RUN_TYPES)(
    "%s writes on the behalf of whoever ran it",
    async (ruleType: RuleRunType) => {
      const result: RuleApplicationResult = await run(ruleType, RUNNER);

      expect(result.updated).toBe(true);
      expect(targetWrites(ruleType).length).toBeGreaterThan(0);

      for (const write of targetWrites(ruleType)) {
        expect([write.table, write.props]).toEqual([
          write.table,
          ON_THEIR_BEHALF,
        ]);
      }
    },
  );

  test.each(RUN_TYPES)(
    "%s writes as OneUptime's own when nobody is named",
    async (ruleType: RuleRunType) => {
      await run(ruleType, undefined);

      expect(targetWrites(ruleType).length).toBeGreaterThan(0);

      for (const write of targetWrites(ruleType)) {
        expect([write.table, write.props]).toEqual([write.table, OWN]);
      }
    },
  );

  /*
   * Whoever runs a rule - a person in the dashboard, an API key, a member
   * through an MCP client, a request from any project with any permission
   * - its writes carry exactly who that is, as root, and never what they
   * may do: no project, no permission, no plan, no team.
   */
  test("whatever a run's props hold, its writes carry who ran it and nothing they may do", async () => {
    const random: SeededRandom = seededRandom(6300);

    const identities: Array<DatabaseCommonInteractionProps> = [
      { userId: RUNNER_ID, userType: UserType.User },
      { userType: UserType.API, apiKeyId: KEY_ID, apiKeyName: "Deploy bot" },
      {
        userId: RUNNER_ID,
        userType: UserType.User,
        mcpOAuthGrantId: GRANT_ID,
        mcpClientName: "Claude",
      },
      {
        userId: RUNNER_ID,
        userType: UserType.User,
        writeSource: WriteSource.AskAi,
      },
      { userId: RUNNER_ID, userType: UserType.MasterAdmin },
    ];

    // What a request carries besides who made it, any of it, in any mix.
    const extras: Array<DatabaseCommonInteractionProps> = [
      { tenantId: PROJECT_ID },
      { tenantId: new ObjectID("99999999-9999-4999-8999-999999999999") },
      { isRoot: false },
      { isMasterAdmin: true },
      { userTeamIds: [OWNER_TEAM_ID] },
      { currentPlan: PlanType.Free },
      { isSubscriptionUnpaid: true },
      { isMultiTenantRequest: false },
      { isReadOnlyCredential: true },
      { userGlobalAccessPermission: { globalPermissions: [] } as never },
      { userTenantAccessPermission: RUNNER.userTenantAccessPermission },
    ];

    for (let draw: number = 0; draw < 120; draw++) {
      const ruleType: RuleRunType = RUN_TYPES[random(RUN_TYPES.length)]!;
      const identity: DatabaseCommonInteractionProps =
        identities[random(identities.length)]!;
      let props: DatabaseCommonInteractionProps = { ...identity };

      for (const extra of extras) {
        if (random(2) === 1) {
          props = { ...props, ...extra };
        }
      }

      writes = [];
      await run(ruleType, props);

      const expected: DatabaseCommonInteractionProps = {
        isRoot: true,
        ...identity,
      };

      expect(targetWrites(ruleType).length).toBeGreaterThan(0);

      for (const write of targetWrites(ruleType)) {
        expect([draw, ruleType, write.props]).toEqual([
          draw,
          ruleType,
          expected,
        ]);
        expect(OnBehalfOfProps.get(props)).toEqual(expected);
      }
    }
  });
});

/*
 * The monitor engine end to end: through DatabaseService's own create, the
 * hooks of the owner rows included, against tables in memory.
 */
describe("a monitor owner rule, end to end", () => {
  let ownerUsers: InMemoryTable;
  let ownerTeams: InMemoryTable;
  let recordedCreates: Array<{
    table: string;
    props: DatabaseCommonInteractionProps;
  }>;
  let feedItems: Array<Record<string, unknown>>;

  beforeEach(() => {
    ownerUsers = useInMemoryTable(MonitorOwnerUserService, []);
    ownerTeams = useInMemoryTable(MonitorOwnerTeamService, []);
    recordedCreates = [];
    feedItems = [];

    jest
      .spyOn(AuditLogService, "recordCreate")
      .mockImplementation((async (data: {
        model: BaseModel;
        props: DatabaseCommonInteractionProps;
      }): Promise<void> => {
        recordedCreates.push({
          table: data.model.tableName || "",
          props: data.props,
        });
      }) as never);

    const monitor: Monitor = new Monitor(RESOURCE_ID);
    monitor.projectId = PROJECT_ID;
    monitor.name = "API";
    monitor.description = "The public API";
    monitor.labels = [];

    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    jest.spyOn(MonitorService, "getMonitorName").mockResolvedValue("API");
    jest
      .spyOn(MonitorService, "getMonitorLinkInDashboard")
      .mockResolvedValue("https://oneuptime.example/monitor" as never);
    jest
      .spyOn(MonitorService, "getWorkspaceChannelForMonitor")
      .mockResolvedValue([]);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(FeedMarkdown.asMarkdown("Grace Hopper"));
    jest.spyOn(UserService, "findBy").mockResolvedValue([]);
    jest.spyOn(TeamService, "findBy").mockResolvedValue([]);

    const team: Team = new Team(OWNER_TEAM_ID);
    team.name = "Platform";
    jest.spyOn(TeamService, "findOneById").mockResolvedValue(team);

    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getNotificationRulesWhereInviteOwnersIsTrue",
      )
      .mockResolvedValue([]);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "inviteUsersBasedOnRulesAndWorkspaceChannels",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "inviteTeamsBasedOnRulesAndWorkspaceChannels",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorFeedService, "createMonitorFeedItem")
      .mockImplementation((async (
        item: Record<string, unknown>,
      ): Promise<void> => {
        feedItems.push(item);
      }) as never);
    jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockResolvedValue(true);
    stubProjectDirectory({});
  });

  function rule(notifyOwners: boolean): MonitorOwnerRule {
    const item: MonitorOwnerRule = new MonitorOwnerRule(RULE_ID);
    item.name = "Platform on call";
    item.notifyOwners = notifyOwners;
    item.ownerUsers = [new User(OWNER_USER_ID)];
    item.ownerTeams = [new Team(OWNER_TEAM_ID)];
    return item;
  }

  function target(): Monitor {
    const monitor: Monitor = new Monitor(RESOURCE_ID);
    monitor.projectId = PROJECT_ID;
    return monitor;
  }

  function ownerAddedItems(): Array<Record<string, unknown>> {
    return feedItems.filter((item: Record<string, unknown>): boolean => {
      return (
        item["monitorFeedEventType"] === MonitorFeedEventType.OwnerUserAdded ||
        item["monitorFeedEventType"] === MonitorFeedEventType.OwnerTeamAdded
      );
    });
  }

  test("Run now adds Create entries for the owners it adds, by the person who ran it", async () => {
    const result: RuleApplicationResult =
      await MonitorOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [rule(false)],
        allowOwnerNotification: false,
        props: RUNNER,
      });

    expect(result).toEqual(RuleApplicationResultUtil.updated(2));
    expect(ownerUsers.inserts).toHaveLength(1);
    expect(ownerTeams.inserts).toHaveLength(1);

    expect(
      recordedCreates
        .map((created: { table: string }): string => {
          return created.table;
        })
        .sort(),
    ).toEqual(["MonitorOwnerTeam", "MonitorOwnerUser"]);

    for (const created of recordedCreates) {
      // Theirs: a person, so kept whether or not the project stores system events.
      expect(created.props).toEqual(ON_THEIR_BEHALF);
      expect(created.props.tenantId).toBeUndefined();
      expect(created.props.userTenantAccessPermission).toBeUndefined();
    }
  });

  test("the owner rows say who added them, and so do their feed items", async () => {
    await MonitorOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: [rule(false)],
      allowOwnerNotification: false,
      props: RUNNER,
    });

    const userRow: StoredRow = ownerUsers.rows[0]!;
    expect(String(userRow["createdByUserId"])).toBe(RUNNER_ID.toString());
    expect(String(userRow["userId"])).toBe(OWNER_USER_ID.toString());
    expect(String(ownerTeams.rows[0]!["createdByUserId"])).toBe(
      RUNNER_ID.toString(),
    );

    expect(ownerAddedItems()).toHaveLength(2);

    for (const item of ownerAddedItems()) {
      expect(String(item["userId"])).toBe(RUNNER_ID.toString());
    }
  });

  test("who ran it changes nothing about who is told: owners are notified only when the run asks", async () => {
    await MonitorOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: [rule(true)],
      allowOwnerNotification: true,
      props: RUNNER,
    });

    // Not notified yet: the owner-added job tells them.
    expect(ownerUsers.rows[0]!["isOwnerNotified"]).toBe(false);

    ownerUsers.rows.length = 0;
    ownerTeams.rows.length = 0;

    await MonitorOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: [rule(true)],
      allowOwnerNotification: false,
      props: RUNNER,
    });

    expect(ownerUsers.rows[0]!["isOwnerNotified"]).toBe(true);
  });

  test("a rule applied as a monitor is created is OneUptime's own: a system event, by nobody", async () => {
    jest
      .spyOn(MonitorOwnerRuleService, "findBy")
      .mockResolvedValue([rule(true)]);

    await MonitorOwnerRuleEngineService.applyRulesToMonitor(target());

    expect(recordedCreates).toHaveLength(2);

    for (const created of recordedCreates) {
      expect(created.props).toEqual(OWN);
    }

    expect(ownerUsers.rows[0]!["createdByUserId"]).toBeUndefined();

    for (const item of ownerAddedItems()) {
      expect(item["userId"]).toBeUndefined();
    }
  });

  test("an owner already on the monitor is not added again, and adds no entry", async () => {
    ownerUsers.rows.push({
      _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId: PROJECT_ID.toString(),
      monitorId: RESOURCE_ID.toString(),
      userId: OWNER_USER_ID.toString(),
    });

    await MonitorOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: [rule(false)],
      allowOwnerNotification: false,
      props: RUNNER,
    });

    expect(ownerUsers.inserts).toHaveLength(0);
    expect(
      recordedCreates.map((created: { table: string }): string => {
        return created.table;
      }),
    ).toEqual(["MonitorOwnerTeam"]);
  });
});
