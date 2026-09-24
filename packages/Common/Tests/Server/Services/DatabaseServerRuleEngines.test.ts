/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerLabelRuleEngineService from "../../../Server/Services/DatabaseServerLabelRuleEngineService";
import DatabaseServerLabelRuleService from "../../../Server/Services/DatabaseServerLabelRuleService";
import DatabaseServerOwnerRuleEngineService from "../../../Server/Services/DatabaseServerOwnerRuleEngineService";
import DatabaseServerOwnerRuleService from "../../../Server/Services/DatabaseServerOwnerRuleService";
import DatabaseServerOwnerTeamService from "../../../Server/Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "../../../Server/Services/DatabaseServerOwnerUserService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import logger from "../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../Server/Utils/Rules/RuleRun/RuleApplication";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import { DatabaseServerFeedEventType } from "../../../Models/DatabaseModels/DatabaseServerFeed";
import DatabaseServerLabelRule from "../../../Models/DatabaseModels/DatabaseServerLabelRule";
import DatabaseServerOwnerRule from "../../../Models/DatabaseModels/DatabaseServerOwnerRule";
import Label from "../../../Models/DatabaseModels/Label";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { getJestSpyOn } from "../../Spy";

/*
 * The database label and owner rule engines.
 *
 * Mechanical copies of the other resource types' engines, pinned on their
 * own so the Databases-specific parts cannot drift:
 *   - the criteria fields are databaseServerLabels / databaseServerNamePattern /
 *     databaseServerDescriptionPattern, both as legacy columns and as
 *     configurable criteria;
 *   - discovered names embed the engine ("PostgreSQL orders-db:5432"), so a
 *     `^PostgreSQL` name pattern is how a person says "every PostgreSQL";
 *   - "Run now" (applyRulesToExistingResource) reports what it did and never
 *     throws; the create hook never throws either;
 *   - rule-made changes are explained on the database's feed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const DATABASE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const LABEL_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LABEL_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function ref<T>(id: ObjectID): T {
  return { id: id, _id: id.toString() } as unknown as T;
}

// The database as a run (or onCreateSuccess) hands it over: ids only.
function target(): DatabaseServer {
  return {
    id: DATABASE_ID,
    _id: DATABASE_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as DatabaseServer;
}

// The row the engines re-read to match on.
function details(
  overrides: { name?: string; labels?: Array<ObjectID> } = {},
): DatabaseServer {
  return {
    id: DATABASE_ID,
    _id: DATABASE_ID.toString(),
    projectId: PROJECT_ID,
    name: overrides.name ?? "PostgreSQL orders-db.internal:5432",
    description: "Primary orders database",
    labels: (overrides.labels || []).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
  } as unknown as DatabaseServer;
}

function criteria(
  field: string,
  operator: RuleCriteriaOperator,
  value: any,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [{ field: field, operator: operator, value: value }],
  };
}

function labelRule(
  data: {
    namePattern?: string;
    descriptionPattern?: string;
    matchLabels?: Array<ObjectID>;
    labelsToAdd?: Array<ObjectID>;
    criteria?: RuleCriteria;
  } = {},
): DatabaseServerLabelRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: "Tag every PostgreSQL",
    criteria: data.criteria,
    databaseServerNamePattern: data.namePattern,
    databaseServerDescriptionPattern: data.descriptionPattern,
    databaseServerLabels: (data.matchLabels || []).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
    labelsToAdd: (data.labelsToAdd || [LABEL_A]).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
  } as unknown as DatabaseServerLabelRule;
}

function ownerRule(
  data: {
    namePattern?: string;
    notifyOwners?: boolean;
    criteria?: RuleCriteria;
  } = {},
): DatabaseServerOwnerRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: "Postgres owners",
    criteria: data.criteria,
    notifyOwners: data.notifyOwners,
    databaseServerNamePattern: data.namePattern ?? "^PostgreSQL",
    ownerUsers: [ref(USER_ID)],
    ownerTeams: [ref(TEAM_ID)],
  } as unknown as DatabaseServerOwnerRule;
}

let errorSpy: jest.SpyInstance;
let feed: jest.SpyInstance;

beforeEach(() => {
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  getJestSpyOn(
    DatabaseServerService,
    "getDatabaseServerMarkdownLink",
  ).mockResolvedValue("[Database PostgreSQL orders-db.internal:5432](/db)");
  feed = getJestSpyOn(
    DatabaseServerFeedService,
    "createDatabaseServerFeedItem",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DatabaseServerLabelRuleEngineService", () => {
  let findDetails: jest.SpyInstance;
  let findRules: jest.SpyInstance;
  let writes: Array<{ relation: string; of: string; ids: Array<string> }>;

  function arrange(
    data: {
      details?: DatabaseServer | null;
      rules?: Array<DatabaseServerLabelRule>;
      failWrite?: boolean;
    } = {},
  ): void {
    writes = [];
    let relation: string = "";
    let of: string = "";
    const builder: any = {
      createQueryBuilder: () => {
        return builder;
      },
      relation: (_target: unknown, name: string) => {
        relation = name;
        return builder;
      },
      of: (id: string) => {
        of = id;
        return builder;
      },
      add: async (ids: Array<string>) => {
        if (data.failWrite) {
          throw new Error("duplicate key value violates unique constraint");
        }
        writes.push({ relation: relation, of: of, ids: [...ids] });
      },
    };
    getJestSpyOn(DatabaseServerService, "getRepository").mockReturnValue(
      builder,
    );
    findDetails = getJestSpyOn(
      DatabaseServerService,
      "findOneById",
    ).mockResolvedValue(data.details === undefined ? details() : data.details);
    findRules = getJestSpyOn(
      DatabaseServerLabelRuleService,
      "findBy",
    ).mockResolvedValue(data.rules || []);
  }

  test("reads the database criteria fields - criteria included", () => {
    expect(DatabaseServerLabelRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      databaseServerLabels: { _id: true },
      databaseServerNamePattern: true,
      databaseServerDescriptionPattern: true,
      labelsToAdd: { _id: true },
    });
    expect(
      DatabaseServerLabelRuleEngineService.resourceSelectForRuleRun,
    ).toEqual({ _id: true, projectId: true });
  });

  test("on create: reads the project's enabled rules, capped, and applies them", async () => {
    arrange({ rules: [labelRule({ namePattern: "^PostgreSQL" })] });
    const resource: DatabaseServer = target();

    await DatabaseServerLabelRuleEngineService.applyRulesToDatabaseServer(
      resource,
    );

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.projectId).toBe(PROJECT_ID);
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.select).toBe(DatabaseServerLabelRuleEngineService.ruleSelect);
    expect(findBy.props.isRoot).toBe(true);

    expect(writes).toEqual([
      {
        relation: "labels",
        of: DATABASE_ID.toString(),
        ids: [LABEL_A.toString()],
      },
    ]);
    // Synced in memory, so the owner engine that runs next can match on it.
    expect(
      (resource.labels || []).map((label: Label) => {
        return label.id!.toString();
      }),
    ).toEqual([LABEL_A.toString()]);
  });

  test("on create with no rules: no re-read, no write", async () => {
    arrange({ rules: [] });

    await DatabaseServerLabelRuleEngineService.applyRulesToDatabaseServer(
      target(),
    );

    expect(findDetails).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("^PostgreSQL matches every discovered PostgreSQL, whatever the endpoint", async () => {
    arrange();

    const matched: RuleApplicationResult =
      await DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [labelRule({ namePattern: "^PostgreSQL" })],
        allowOwnerNotification: false,
      });

    expect(matched).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("an engine pattern does not match another engine", async () => {
    arrange({ details: details({ name: "Redis cache.internal:6379" }) });

    const result: RuleApplicationResult =
      await DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [labelRule({ namePattern: "^PostgreSQL" })],
        allowOwnerNotification: false,
      });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(writes).toHaveLength(0);
    expect(feed).not.toHaveBeenCalled();
  });

  test("matches on labels and description too", async () => {
    arrange({ details: details({ labels: [LABEL_B] }) });

    const result: RuleApplicationResult =
      await DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [
          labelRule({
            matchLabels: [LABEL_B],
            descriptionPattern: "orders",
            labelsToAdd: [LABEL_A],
          }),
        ],
        allowOwnerNotification: false,
      });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("configurable criteria on databaseServerNamePattern take over from stale legacy columns", async () => {
    arrange();

    const result: RuleApplicationResult =
      await DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [
          labelRule({
            namePattern: "^Redis",
            criteria: criteria(
              "databaseServerNamePattern",
              RuleCriteriaOperator.Contains,
              "orders-db",
            ),
          }),
        ],
        allowOwnerNotification: false,
      });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("only missing labels are added, and the feed says which rule did it", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    const result: RuleApplicationResult =
      await DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [
          labelRule({
            namePattern: "^PostgreSQL",
            labelsToAdd: [LABEL_A, LABEL_B],
          }),
        ],
        allowOwnerNotification: false,
      });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(writes[0]!.ids).toEqual([LABEL_B.toString()]);
    const item: any = feed.mock.calls[0]![0];
    expect(item.databaseServerId).toBe(DATABASE_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.LabelRuleExecuted,
    );
    expect(item.feedInfoInMarkdown).toContain("1 label(s)");
    expect(item.moreInformationInMarkdown).toContain("Tag every PostgreSQL");
  });

  test("every label already present: matched, nothing written", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(
      DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [labelRule({ namePattern: "^PostgreSQL" })],
        allowOwnerNotification: false,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(writes).toHaveLength(0);
  });

  test("an invalid regex never matches and never throws", async () => {
    arrange();

    await expect(
      DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [labelRule({ namePattern: "([" })],
        allowOwnerNotification: false,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("a database deleted before its turn is no match", async () => {
    arrange({ details: null });

    await expect(
      DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [labelRule({ namePattern: "^PostgreSQL" })],
        allowOwnerNotification: false,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("a failed write is reported as failed, not thrown", async () => {
    arrange({ failWrite: true });

    await expect(
      DatabaseServerLabelRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [labelRule({ namePattern: "^PostgreSQL" })],
        allowOwnerNotification: false,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.failed());
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("the create hook swallows failures - a label never breaks a create", async () => {
    arrange({
      rules: [labelRule({ namePattern: "^PostgreSQL" })],
      failWrite: true,
    });

    await expect(
      DatabaseServerLabelRuleEngineService.applyRulesToDatabaseServer(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("DatabaseServerOwnerRuleEngineService", () => {
  let findRules: jest.SpyInstance;
  let createOwnerUser: jest.SpyInstance;
  let createOwnerTeam: jest.SpyInstance;
  let ownerUserRead: jest.SpyInstance;

  function arrange(
    data: {
      rules?: Array<DatabaseServerOwnerRule>;
      details?: DatabaseServer | null;
      assignedUserIds?: Array<ObjectID>;
    } = {},
  ): void {
    findRules = getJestSpyOn(
      DatabaseServerOwnerRuleService,
      "findBy",
    ).mockResolvedValue(data.rules || []);
    getJestSpyOn(DatabaseServerService, "findOneById").mockResolvedValue(
      data.details === undefined ? details() : data.details,
    );
    ownerUserRead = getJestSpyOn(
      DatabaseServerOwnerUserService,
      "findBy",
    ).mockResolvedValue(
      (data.assignedUserIds || []).map((id: ObjectID) => {
        return {
          getColumnValue: (key: string) => {
            return key === "userId" ? id : undefined;
          },
        };
      }),
    );
    getJestSpyOn(DatabaseServerOwnerTeamService, "findBy").mockResolvedValue(
      [],
    );
    createOwnerUser = getJestSpyOn(
      DatabaseServerOwnerUserService,
      "create",
    ).mockResolvedValue({});
    createOwnerTeam = getJestSpyOn(
      DatabaseServerOwnerTeamService,
      "create",
    ).mockResolvedValue({});
    getJestSpyOn(TeamMemberService, "isUserMemberOfProject").mockResolvedValue(
      true,
    );
  }

  test("reads the database criteria fields and the owners to add", () => {
    expect(DatabaseServerOwnerRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      notifyOwners: true,
      databaseServerLabels: { _id: true },
      databaseServerNamePattern: true,
      databaseServerDescriptionPattern: true,
      ownerUsers: { _id: true },
      ownerTeams: { _id: true },
    });
    expect(
      DatabaseServerOwnerRuleEngineService.resourceSelectForRuleRun,
    ).toEqual({ _id: true, projectId: true });
  });

  test("on create: adds the matching rule's owners to this database, notified", async () => {
    arrange({ rules: [ownerRule()] });

    await DatabaseServerOwnerRuleEngineService.applyRulesToDatabaseServer(
      target(),
    );

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);

    const user: any = createOwnerUser.mock.calls[0]![0];
    expect(user.data.databaseServerId).toBe(DATABASE_ID);
    expect(user.data.projectId).toBe(PROJECT_ID);
    expect(user.data.userId.toString()).toBe(USER_ID.toString());
    // Not yet notified - the notifier picks it up.
    expect(user.data.isOwnerNotified).toBe(false);
    expect(user.props).toEqual({ isRoot: true });

    const team: any = createOwnerTeam.mock.calls[0]![0];
    expect(team.data.databaseServerId).toBe(DATABASE_ID);
    expect(team.data.teamId.toString()).toBe(TEAM_ID.toString());

    const item: any = feed.mock.calls[0]![0];
    expect(item.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.OwnerRuleExecuted,
    );
    expect(item.moreInformationInMarkdown).toContain("Postgres owners");
  });

  test("looks up existing owners by databaseServerId and never duplicates one", async () => {
    arrange({ assignedUserIds: [USER_ID] });

    const result: RuleApplicationResult =
      await DatabaseServerOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [ownerRule()],
        allowOwnerNotification: true,
      });

    expect(ownerUserRead.mock.calls[0]![0].query.databaseServerId).toBe(
      DATABASE_ID,
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).toHaveBeenCalledTimes(1);
    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("a run that does not allow notifications adds owners silently", async () => {
    arrange();

    await DatabaseServerOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: [ownerRule({ notifyOwners: true })],
      allowOwnerNotification: false,
    });

    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
    expect(createOwnerTeam.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
  });

  test("a non-matching engine pattern adds nobody", async () => {
    arrange({ details: details({ name: "MySQL orders-db.internal:3306" }) });

    await expect(
      DatabaseServerOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [ownerRule()],
        allowOwnerNotification: true,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("label criteria see rule-added labels", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(
      DatabaseServerOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [
          ownerRule({
            namePattern: "",
            criteria: criteria(
              "databaseServerLabels",
              RuleCriteriaOperator.HasAllOf,
              [LABEL_A.toString()],
            ),
          }),
        ],
        allowOwnerNotification: true,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(2));
  });

  test("a failing re-read is reported as failed, never thrown", async () => {
    arrange();
    getJestSpyOn(DatabaseServerService, "findOneById").mockRejectedValue(
      new Error("database is down"),
    );

    await expect(
      DatabaseServerOwnerRuleEngineService.applyRulesToExistingResource({
        resource: target(),
        rules: [ownerRule()],
        allowOwnerNotification: true,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.failed());
  });

  test("the create hook never throws", async () => {
    arrange({ rules: [ownerRule()] });
    createOwnerTeam.mockRejectedValue(new Error("connection terminated"));

    await expect(
      DatabaseServerOwnerRuleEngineService.applyRulesToDatabaseServer(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
