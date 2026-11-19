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

import DataPipelineOwnerRuleEngineService from "../../../Server/Services/DataPipelineOwnerRuleEngineService";
import DataPipelineOwnerRuleService from "../../../Server/Services/DataPipelineOwnerRuleService";
import DataPipelineOwnerTeamService from "../../../Server/Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "../../../Server/Services/DataPipelineOwnerUserService";
import DataPipelineService from "../../../Server/Services/DataPipelineService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import logger from "../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../Server/Utils/Rules/RuleRun/RuleApplication";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataPipelineOwnerRule from "../../../Models/DatabaseModels/DataPipelineOwnerRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { getJestSpyOn } from "../../Spy";

/*
 * PIPELINE OWNER RULES (#9527): Data Observability > Owner Rules >
 * Pipeline Rules.
 *
 *   - a rule matches a pipeline by a pattern of its name and of its
 *     namespace (case-insensitive regular expressions), and conditions on
 *     the same two fields take over from them;
 *   - a pipeline gets the project's enabled rules the moment OneUptime
 *     first sees it (applyRulesToDataPipeline, from DataPipelineService's
 *     onCreateSuccess), and that never throws: ingestion never stops at a
 *     rule;
 *   - Run Now (applyRulesToExistingResource) reports what it did, writes
 *     as whoever ran it, and never throws;
 *   - an owner already on the pipeline is never added twice, and Notify
 *     Owners decides whether the owners a rule adds are told.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const PIPELINE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const RAN_BY: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

function ref<T>(id: ObjectID): T {
  return { id: id, _id: id.toString() } as unknown as T;
}

// The pipeline as a run (or onCreateSuccess) hands it over: ids only.
function target(): DataPipeline {
  return {
    id: PIPELINE_ID,
    _id: PIPELINE_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as DataPipeline;
}

// The row the engine re-reads to match on: the payments team's nightly load.
function details(
  overrides: { jobName?: string | null; jobNamespace?: string | null } = {},
): DataPipeline {
  return {
    id: PIPELINE_ID,
    _id: PIPELINE_ID.toString(),
    projectId: PROJECT_ID,
    jobName:
      overrides.jobName === undefined
        ? "payments_daily.load_payments"
        : overrides.jobName,
    jobNamespace:
      overrides.jobNamespace === undefined
        ? "airflow://prod"
        : overrides.jobNamespace,
  } as unknown as DataPipeline;
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

function ownerRule(
  data: {
    namePattern?: string;
    namespacePattern?: string;
    notifyOwners?: boolean;
    criteria?: RuleCriteria;
    users?: Array<ObjectID>;
    teams?: Array<ObjectID>;
    name?: string;
  } = {},
): DataPipelineOwnerRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: data.name ?? "Payments owns its pipelines",
    criteria: data.criteria,
    notifyOwners: data.notifyOwners,
    nameRegexPattern: data.namePattern,
    namespaceRegexPattern: data.namespacePattern,
    ownerUsers: (data.users ?? [USER_ID]).map((id: ObjectID) => {
      return ref(id);
    }),
    ownerTeams: (data.teams ?? [TEAM_ID]).map((id: ObjectID) => {
      return ref(id);
    }),
  } as unknown as DataPipelineOwnerRule;
}

let errorSpy: jest.SpyInstance;
let findRules: jest.SpyInstance;
let findPipeline: jest.SpyInstance;
let createOwnerUser: jest.SpyInstance;
let createOwnerTeam: jest.SpyInstance;
let ownerUserRead: jest.SpyInstance;
let ownerTeamRead: jest.SpyInstance;

function arrange(
  data: {
    rules?: Array<DataPipelineOwnerRule>;
    details?: DataPipeline | null;
    assignedUserIds?: Array<ObjectID>;
    assignedTeamIds?: Array<ObjectID>;
  } = {},
): void {
  findRules = getJestSpyOn(
    DataPipelineOwnerRuleService,
    "findBy",
  ).mockResolvedValue(data.rules || []);
  findPipeline = getJestSpyOn(
    DataPipelineService,
    "findOneById",
  ).mockResolvedValue(data.details === undefined ? details() : data.details);
  ownerUserRead = getJestSpyOn(
    DataPipelineOwnerUserService,
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
  ownerTeamRead = getJestSpyOn(
    DataPipelineOwnerTeamService,
    "findBy",
  ).mockResolvedValue(
    (data.assignedTeamIds || []).map((id: ObjectID) => {
      return {
        getColumnValue: (key: string) => {
          return key === "teamId" ? id : undefined;
        },
      };
    }),
  );
  createOwnerUser = getJestSpyOn(
    DataPipelineOwnerUserService,
    "create",
  ).mockResolvedValue({});
  createOwnerTeam = getJestSpyOn(
    DataPipelineOwnerTeamService,
    "create",
  ).mockResolvedValue({});
  getJestSpyOn(TeamMemberService, "isUserMemberOfProject").mockResolvedValue(
    true,
  );
  // The teams the rules name are the project's.
  stubProjectDirectory({});
}

async function run(
  rules: Array<DataPipelineOwnerRule>,
  options: {
    allowOwnerNotification?: boolean;
    props?: DatabaseCommonInteractionProps;
  } = {},
): Promise<RuleApplicationResult> {
  return await DataPipelineOwnerRuleEngineService.applyRulesToExistingResource({
    resource: target(),
    rules: rules,
    allowOwnerNotification: options.allowOwnerNotification ?? true,
    props: options.props,
  });
}

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a pipeline owner rule reads", () => {
  test("its criteria fields - the pipeline's name and namespace - Notify Owners and the owners to add", () => {
    expect(DataPipelineOwnerRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      notifyOwners: true,
      nameRegexPattern: true,
      namespaceRegexPattern: true,
      ownerUsers: { _id: true },
      ownerTeams: { _id: true },
    });
  });

  test("a run hands over the pipeline by its id and project; the engine reads its name and namespace itself", async () => {
    expect(DataPipelineOwnerRuleEngineService.resourceSelectForRuleRun).toEqual(
      {
        _id: true,
        projectId: true,
      },
    );

    arrange();
    await run([ownerRule({ namePattern: "^payments_" })]);

    const read: any = findPipeline.mock.calls[0]![0];
    expect(read.id).toBe(PIPELINE_ID);
    expect(read.select).toEqual({ jobName: true, jobNamespace: true });
    expect(read.props).toEqual({ isRoot: true });
  });
});

describe("a pipeline OneUptime has just seen", () => {
  test("gets the project's enabled rules, capped, and the matching rule's people and teams as owners, to be told", async () => {
    arrange({ rules: [ownerRule({ namespacePattern: "^airflow://prod$" })] });

    await DataPipelineOwnerRuleEngineService.applyRulesToDataPipeline(target());

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.projectId).toBe(PROJECT_ID);
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.select).toBe(DataPipelineOwnerRuleEngineService.ruleSelect);
    expect(findBy.props.isRoot).toBe(true);

    const user: any = createOwnerUser.mock.calls[0]![0];
    expect(user.data.dataPipelineId).toBe(PIPELINE_ID);
    expect(user.data.projectId).toBe(PROJECT_ID);
    expect(user.data.userId.toString()).toBe(USER_ID.toString());
    // Not yet told - the owner notification picks it up.
    expect(user.data.isOwnerNotified).toBe(false);
    // Written as OneUptime: nobody ran the rule.
    expect(user.props).toEqual({ isRoot: true });

    const team: any = createOwnerTeam.mock.calls[0]![0];
    expect(team.data.dataPipelineId).toBe(PIPELINE_ID);
    expect(team.data.teamId.toString()).toBe(TEAM_ID.toString());
    expect(team.data.isOwnerNotified).toBe(false);
  });

  test("a project with no rule reads no pipeline and adds nobody", async () => {
    arrange({ rules: [] });

    await DataPipelineOwnerRuleEngineService.applyRulesToDataPipeline(target());

    expect(findPipeline).not.toHaveBeenCalled();
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).not.toHaveBeenCalled();
  });

  test("a pipeline with no id or project is left alone", async () => {
    arrange({ rules: [ownerRule()] });

    await DataPipelineOwnerRuleEngineService.applyRulesToDataPipeline({
      projectId: PROJECT_ID,
    } as unknown as DataPipeline);
    await DataPipelineOwnerRuleEngineService.applyRulesToDataPipeline({
      id: PIPELINE_ID,
    } as unknown as DataPipeline);

    expect(findRules).not.toHaveBeenCalled();
    expect(createOwnerUser).not.toHaveBeenCalled();
  });

  test("the hook never throws: a rule that fails to apply never stops the event that named the pipeline", async () => {
    arrange({ rules: [ownerRule()] });
    createOwnerTeam.mockRejectedValue(new Error("connection terminated"));

    await expect(
      DataPipelineOwnerRuleEngineService.applyRulesToDataPipeline(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("rules that cannot be read are logged, never thrown", async () => {
    arrange();
    findRules.mockRejectedValue(new Error("database is down"));

    await expect(
      DataPipelineOwnerRuleEngineService.applyRulesToDataPipeline(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("which pipelines a rule matches", () => {
  test.each([
    ["the whole name", { namePattern: "^payments_daily\\.load_payments$" }],
    ["part of the name, in any case", { namePattern: "PAYMENTS" }],
    ["the namespace", { namespacePattern: "^airflow://prod$" }],
    [
      "the name and the namespace together",
      { namePattern: "^payments_", namespacePattern: "airflow" },
    ],
    ["no pattern at all: every pipeline", {}],
  ])("matches by %s", async (_what: string, rule: Record<string, string>) => {
    arrange();

    await expect(run([ownerRule(rule)])).resolves.toEqual(
      RuleApplicationResultUtil.updated(2),
    );
  });

  test.each([
    ["another team's pipeline", { namePattern: "^growth_" }],
    ["another namespace", { namespacePattern: "^dbt://" }],
    [
      "a name that matches in a namespace that does not",
      { namePattern: "^payments_", namespacePattern: "^dagster://" },
    ],
  ])(
    "does not match %s",
    async (_what: string, rule: Record<string, string>) => {
      arrange();

      await expect(run([ownerRule(rule)])).resolves.toEqual(
        RuleApplicationResultUtil.noMatch(),
      );
      expect(createOwnerUser).not.toHaveBeenCalled();
      expect(createOwnerTeam).not.toHaveBeenCalled();
    },
  );

  test("a pipeline with no namespace never matches a namespace pattern", async () => {
    arrange({ details: details({ jobNamespace: null }) });

    await expect(run([ownerRule({ namespacePattern: ".*" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
  });

  test("an invalid pattern never matches and never throws", async () => {
    arrange();

    await expect(run([ownerRule({ namePattern: "([" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
    await expect(run([ownerRule({ namespacePattern: "([" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
  });

  test("conditions take over from the patterns: a condition on the namespace matches", async () => {
    arrange();

    await expect(
      run([
        ownerRule({
          namePattern: "^growth_",
          criteria: criteria(
            "namespaceRegexPattern",
            RuleCriteriaOperator.MatchesPattern,
            "^airflow://",
          ),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(2));
  });

  test("a condition on the name that does not match adds nobody", async () => {
    arrange();

    await expect(
      run([
        ownerRule({
          criteria: criteria(
            "nameRegexPattern",
            RuleCriteriaOperator.MatchesPattern,
            "^growth_",
          ),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("a pipeline deleted before its turn is no match", async () => {
    arrange({ details: null });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
  });
});

describe("the owners a rule adds", () => {
  test("Run Now writes as whoever ran it", async () => {
    arrange();
    const props: DatabaseCommonInteractionProps = {
      userId: RAN_BY,
      tenantId: PROJECT_ID,
    } as DatabaseCommonInteractionProps;

    await run([ownerRule()], { props });

    expect(createOwnerUser.mock.calls[0]![0].props).toMatchObject({
      userId: RAN_BY,
    });
    expect(createOwnerTeam.mock.calls[0]![0].props).toMatchObject({
      userId: RAN_BY,
    });
  });

  test("an owner rule with Notify Owners off adds its owners silently", async () => {
    arrange();

    await expect(run([ownerRule({ notifyOwners: false })])).resolves.toEqual(
      RuleApplicationResultUtil.updated(2),
    );

    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
    expect(createOwnerTeam.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
  });

  test("a run that does not allow notifications adds owners silently, whatever the rule says", async () => {
    arrange();

    await run([ownerRule({ notifyOwners: true })], {
      allowOwnerNotification: false,
    });

    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
    expect(createOwnerTeam.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
  });

  test("two matching rules that disagree about telling an owner add them once, and tell them", async () => {
    arrange();

    await expect(
      run([
        ownerRule({ notifyOwners: false }),
        ownerRule({ notifyOwners: true }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(2));

    expect(createOwnerUser).toHaveBeenCalledTimes(1);
    expect(createOwnerTeam).toHaveBeenCalledTimes(1);
    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(false);
  });

  test("every matching rule adds its owners: two rules, two people", async () => {
    arrange();

    await expect(
      run([
        ownerRule({ users: [USER_ID], teams: [] }),
        ownerRule({ users: [OTHER_USER_ID], teams: [] }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(2));

    expect(
      createOwnerUser.mock.calls
        .map((call: Array<any>): string => {
          return call[0].data.userId.toString();
        })
        .sort(),
    ).toEqual([USER_ID.toString(), OTHER_USER_ID.toString()].sort());
  });

  test("owners already on the pipeline are looked up by dataPipelineId and never added twice", async () => {
    arrange({ assignedUserIds: [USER_ID] });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.updated(1),
    );

    expect(ownerUserRead.mock.calls[0]![0].query.dataPipelineId).toBe(
      PIPELINE_ID,
    );
    expect(ownerTeamRead.mock.calls[0]![0].query.dataPipelineId).toBe(
      PIPELINE_ID,
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).toHaveBeenCalledTimes(1);
  });

  test("every owner already there: matched, nothing added", async () => {
    arrange({ assignedUserIds: [USER_ID], assignedTeamIds: [TEAM_ID] });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.alreadyApplied(),
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).not.toHaveBeenCalled();
  });

  test("a matching rule that names nobody has nothing to add", async () => {
    arrange();

    await expect(run([ownerRule({ users: [], teams: [] })])).resolves.toEqual(
      RuleApplicationResultUtil.alreadyApplied(),
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
  });

  test("a failing read of the pipeline is reported as failed, never thrown", async () => {
    arrange();
    findPipeline.mockRejectedValue(new Error("database is down"));

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.failed(),
    );
  });

  test("no rules: nothing is read and nothing matched", async () => {
    arrange();

    await expect(run([])).resolves.toEqual(RuleApplicationResultUtil.noMatch());
    expect(findPipeline).not.toHaveBeenCalled();
  });
});

describe("DataPipelineService: a pipeline seen for the first time", () => {
  async function created(pipeline: DataPipeline): Promise<DataPipeline> {
    const returned: DataPipeline = await (
      DataPipelineService as any
    ).onCreateSuccess({ createBy: {}, carryForward: undefined }, pipeline);

    // The rules run after the pipeline is saved: let them.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    return returned;
  }

  test("gets its project's owner rules, whichever ingest saw it first", async () => {
    const apply: jest.SpyInstance = getJestSpyOn(
      DataPipelineOwnerRuleEngineService,
      "applyRulesToDataPipeline",
    ).mockResolvedValue(undefined);
    const pipeline: DataPipeline = target();

    await expect(created(pipeline)).resolves.toBe(pipeline);
    expect(apply).toHaveBeenCalledWith(pipeline);
  });

  test("a rule that throws never fails the event that named the pipeline", async () => {
    getJestSpyOn(
      DataPipelineOwnerRuleEngineService,
      "applyRulesToDataPipeline",
    ).mockRejectedValue(new Error("rules are unreadable"));
    const pipeline: DataPipeline = target();

    await expect(created(pipeline)).resolves.toBe(pipeline);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("a pipeline the database did not hand back an id for is left alone", async () => {
    const apply: jest.SpyInstance = getJestSpyOn(
      DataPipelineOwnerRuleEngineService,
      "applyRulesToDataPipeline",
    ).mockResolvedValue(undefined);

    await created({ projectId: PROJECT_ID } as unknown as DataPipeline);

    expect(apply).not.toHaveBeenCalled();
  });
});
