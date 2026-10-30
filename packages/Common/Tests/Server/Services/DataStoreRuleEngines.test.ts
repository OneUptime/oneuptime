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

import DataStoreFeedService from "../../../Server/Services/DataStoreFeedService";
import DataStoreLabelRuleEngineService from "../../../Server/Services/DataStoreLabelRuleEngineService";
import DataStoreLabelRuleService from "../../../Server/Services/DataStoreLabelRuleService";
import DataStoreOwnerRuleEngineService from "../../../Server/Services/DataStoreOwnerRuleEngineService";
import DataStoreOwnerRuleService from "../../../Server/Services/DataStoreOwnerRuleService";
import DataStoreOwnerTeamService from "../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import logger from "../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../Server/Utils/Rules/RuleRun/RuleApplication";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../Models/DatabaseModels/DataStoreFeed";
import DataStoreLabelRule from "../../../Models/DatabaseModels/DataStoreLabelRule";
import DataStoreOwnerRule from "../../../Models/DatabaseModels/DataStoreOwnerRule";
import Label from "../../../Models/DatabaseModels/Label";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { getJestSpyOn } from "../../Spy";

import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";

/*
 * The data store label and owner rule engines (Data Security → Rules).
 *
 * Copies of the other resource types' engines, pinned on their own so the
 * parts that are Data Security's cannot drift:
 *   - a rule matches a store by its labels, a pattern of its name or its
 *     description, or Cloud Tag Pattern: a pattern matched against each of
 *     the store's cloud tags written key=value - "^team=payments$" is how a
 *     person says "every store the payments team tagged";
 *   - the same fields as configurable criteria (All data stores, or Only
 *     data stores that match conditions) take over from the legacy columns;
 *   - a new store gets the project's enabled rules the moment it is found
 *     (onCreateSuccess), and that hook never throws: discovery must not stop
 *     at a rule;
 *   - "Run now" (applyRulesToExistingResource) reports what it did and never
 *     throws;
 *   - owners already on a store are never added twice, and an owner rule's
 *     Notify Owners decides whether the owners it adds are told;
 *   - what a rule did is explained on the store's Timeline.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const STORE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const LABEL_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LABEL_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function ref<T>(id: ObjectID): T {
  return { id: id, _id: id.toString() } as unknown as T;
}

// The store as a run (or onCreateSuccess) hands it over: ids only.
function target(): DataStore {
  return {
    id: STORE_ID,
    _id: STORE_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as DataStore;
}

// The row the engines re-read to match on: a payments team's export bucket.
function details(
  overrides: {
    name?: string;
    description?: string;
    labels?: Array<ObjectID>;
    cloudTags?: JSONObject;
  } = {},
): DataStore {
  return {
    id: STORE_ID,
    _id: STORE_ID.toString(),
    projectId: PROJECT_ID,
    name: overrides.name ?? "acme-customer-exports",
    description:
      overrides.description ?? "Nightly exports of customer orders for BI",
    labels: (overrides.labels || []).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
    cloudTags: overrides.cloudTags ?? { team: "payments", env: "prod" },
  } as unknown as DataStore;
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
    cloudTagPattern?: string;
    matchLabels?: Array<ObjectID>;
    labelsToAdd?: Array<ObjectID>;
    criteria?: RuleCriteria;
  } = {},
): DataStoreLabelRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: "Tag the payments team's stores",
    criteria: data.criteria,
    nameRegexPattern: data.namePattern,
    descriptionRegexPattern: data.descriptionPattern,
    cloudTagPattern: data.cloudTagPattern,
    matchLabels: (data.matchLabels || []).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
    labelsToAdd: (data.labelsToAdd || [LABEL_A]).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
  } as unknown as DataStoreLabelRule;
}

function ownerRule(
  data: {
    cloudTagPattern?: string;
    namePattern?: string;
    notifyOwners?: boolean;
    criteria?: RuleCriteria;
  } = {},
): DataStoreOwnerRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: "Payments owns its stores",
    criteria: data.criteria,
    notifyOwners: data.notifyOwners,
    cloudTagPattern: data.cloudTagPattern ?? "^team=payments$",
    nameRegexPattern: data.namePattern,
    ownerUsers: [ref(USER_ID)],
    ownerTeams: [ref(TEAM_ID)],
  } as unknown as DataStoreOwnerRule;
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
  getJestSpyOn(DataStoreService, "getDataStoreMarkdownLink").mockResolvedValue(
    FeedMarkdown.asMarkdown("[Data store acme-customer-exports](/store)"),
  );
  feed = getJestSpyOn(
    DataStoreFeedService,
    "createDataStoreFeedItem",
  ).mockResolvedValue(undefined as never);
  // The labels and teams the rules name are the project's.
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DataStoreLabelRuleEngineService", () => {
  let findDetails: jest.SpyInstance;
  let findRules: jest.SpyInstance;
  let writes: Array<{ relation: string; of: string; ids: Array<string> }>;

  function arrange(
    data: {
      details?: DataStore | null;
      rules?: Array<DataStoreLabelRule>;
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
    getJestSpyOn(DataStoreService, "getRepository").mockReturnValue(builder);
    findDetails = getJestSpyOn(
      DataStoreService,
      "findOneById",
    ).mockResolvedValue(data.details === undefined ? details() : data.details);
    findRules = getJestSpyOn(
      DataStoreLabelRuleService,
      "findBy",
    ).mockResolvedValue(data.rules || []);
  }

  async function run(
    rules: Array<DataStoreLabelRule>,
  ): Promise<RuleApplicationResult> {
    return await DataStoreLabelRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: rules,
      allowOwnerNotification: false,
    });
  }

  test("reads a data store's criteria fields - its labels, name, description and cloud tags - and the labels to add", () => {
    expect(DataStoreLabelRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      matchLabels: { _id: true },
      nameRegexPattern: true,
      descriptionRegexPattern: true,
      cloudTagPattern: true,
      labelsToAdd: { _id: true },
    });
    expect(DataStoreLabelRuleEngineService.resourceSelectForRuleRun).toEqual({
      _id: true,
      projectId: true,
    });
  });

  test("a store found by discovery gets the project's enabled rules, capped, and the labels they add", async () => {
    arrange({ rules: [labelRule({ cloudTagPattern: "^team=payments$" })] });
    const store: DataStore = target();

    await DataStoreLabelRuleEngineService.applyRulesToDataStore(store);

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.projectId).toBe(PROJECT_ID);
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.select).toBe(DataStoreLabelRuleEngineService.ruleSelect);
    expect(findBy.props.isRoot).toBe(true);

    expect(writes).toEqual([
      {
        relation: "labels",
        of: STORE_ID.toString(),
        ids: [LABEL_A.toString()],
      },
    ]);
    // Synced in memory, so the owner engine that runs next can match on it.
    expect(
      (store.labels || []).map((label: Label) => {
        return label.id!.toString();
      }),
    ).toEqual([LABEL_A.toString()]);
  });

  test("a project without rules reads no store and writes nothing", async () => {
    arrange({ rules: [] });

    await DataStoreLabelRuleEngineService.applyRulesToDataStore(target());

    expect(findDetails).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(feed).not.toHaveBeenCalled();
  });

  test("Cloud Tag Pattern matches any one of the store's tags, written key=value", async () => {
    arrange();
    await expect(
      run([labelRule({ cloudTagPattern: "^team=payments$" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

    arrange();
    await expect(
      run([labelRule({ cloudTagPattern: "^env=" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("Cloud Tag Pattern never matches a store whose tags say otherwise, or that has none", async () => {
    arrange({ details: details({ cloudTags: { team: "growth" } }) });
    await expect(
      run([labelRule({ cloudTagPattern: "^team=payments$" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());

    arrange({ details: details({ cloudTags: {} }) });
    await expect(
      run([labelRule({ cloudTagPattern: "^team=payments$" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());

    expect(writes).toHaveLength(0);
    expect(feed).not.toHaveBeenCalled();
  });

  test("a value is matched whole, not by its prefix: team=payments-eu is not team=payments", async () => {
    arrange({ details: details({ cloudTags: { team: "payments-eu" } }) });

    await expect(
      run([labelRule({ cloudTagPattern: "^team=payments$" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("matches on its name, its description and its labels, all of what a rule names", async () => {
    arrange({ details: details({ labels: [LABEL_B] }) });

    await expect(
      run([
        labelRule({
          namePattern: "exports$",
          descriptionPattern: "customer orders",
          matchLabels: [LABEL_B],
          labelsToAdd: [LABEL_A],
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

    // One part that does not match is no match.
    arrange({ details: details({ labels: [LABEL_B] }) });
    await expect(
      run([
        labelRule({
          namePattern: "exports$",
          descriptionPattern: "invoices",
          matchLabels: [LABEL_B],
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("a rule that names labels to match never matches a store without them", async () => {
    arrange({ details: details({ labels: [] }) });

    await expect(
      run([labelRule({ matchLabels: [LABEL_B], labelsToAdd: [LABEL_A] })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("conditions on Cloud Tag Pattern take over from the rule's older columns", async () => {
    arrange();

    await expect(
      run([
        labelRule({
          // A stale column that would not match on its own.
          cloudTagPattern: "^team=growth$",
          criteria: criteria(
            "cloudTagPattern",
            RuleCriteriaOperator.MatchesPattern,
            "^team=payments$",
          ),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("only the labels the store lacks are added, and its Timeline says which rule did it", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(
      run([
        labelRule({
          cloudTagPattern: "^team=payments$",
          labelsToAdd: [LABEL_A, LABEL_B],
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

    expect(writes[0]!.ids).toEqual([LABEL_B.toString()]);
    const item: any = feed.mock.calls[0]![0];
    expect(item.dataStoreId).toBe(STORE_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.dataStoreFeedEventType).toBe(
      DataStoreFeedEventType.LabelRuleExecuted,
    );
    expect(item.feedInfoInMarkdown).toContain("1 label(s)");
    expect(item.feedInfoInMarkdown).toContain("label rule.");
    expect(item.moreInformationInMarkdown).toContain(
      "Tag the payments team's stores",
    );
  });

  test("every label already there: matched, nothing written, nothing on the Timeline", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(
      run([labelRule({ cloudTagPattern: "^team=payments$" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(writes).toHaveLength(0);
    expect(feed).not.toHaveBeenCalled();
  });

  test("an invalid pattern never matches and never throws", async () => {
    arrange();

    await expect(run([labelRule({ namePattern: "([" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
    await expect(run([labelRule({ cloudTagPattern: "([" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
  });

  test("a store deleted before its turn is no match", async () => {
    arrange({ details: null });

    await expect(
      run([labelRule({ cloudTagPattern: "^team=payments$" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("a failed write is reported as failed, not thrown", async () => {
    arrange({ failWrite: true });

    await expect(
      run([labelRule({ cloudTagPattern: "^team=payments$" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.failed());
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("the hook a new store runs never throws: a label never stops discovery", async () => {
    arrange({
      rules: [labelRule({ cloudTagPattern: "^team=payments$" })],
      failWrite: true,
    });

    await expect(
      DataStoreLabelRuleEngineService.applyRulesToDataStore(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("a store with no id or project is left alone", async () => {
    arrange({ rules: [labelRule({ cloudTagPattern: "^team=payments$" })] });

    await DataStoreLabelRuleEngineService.applyRulesToDataStore({
      projectId: PROJECT_ID,
    } as unknown as DataStore);

    expect(findRules).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe("DataStoreOwnerRuleEngineService", () => {
  let findRules: jest.SpyInstance;
  let createOwnerUser: jest.SpyInstance;
  let createOwnerTeam: jest.SpyInstance;
  let ownerUserRead: jest.SpyInstance;

  function arrange(
    data: {
      rules?: Array<DataStoreOwnerRule>;
      details?: DataStore | null;
      assignedUserIds?: Array<ObjectID>;
      assignedTeamIds?: Array<ObjectID>;
    } = {},
  ): void {
    findRules = getJestSpyOn(
      DataStoreOwnerRuleService,
      "findBy",
    ).mockResolvedValue(data.rules || []);
    getJestSpyOn(DataStoreService, "findOneById").mockResolvedValue(
      data.details === undefined ? details() : data.details,
    );
    ownerUserRead = getJestSpyOn(
      DataStoreOwnerUserService,
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
    getJestSpyOn(DataStoreOwnerTeamService, "findBy").mockResolvedValue(
      (data.assignedTeamIds || []).map((id: ObjectID) => {
        return {
          getColumnValue: (key: string) => {
            return key === "teamId" ? id : undefined;
          },
        };
      }),
    );
    createOwnerUser = getJestSpyOn(
      DataStoreOwnerUserService,
      "create",
    ).mockResolvedValue({});
    createOwnerTeam = getJestSpyOn(
      DataStoreOwnerTeamService,
      "create",
    ).mockResolvedValue({});
    getJestSpyOn(TeamMemberService, "isUserMemberOfProject").mockResolvedValue(
      true,
    );
    // The teams the rules name are the project's.
    stubProjectDirectory({});
  }

  async function run(
    rules: Array<DataStoreOwnerRule>,
    allowOwnerNotification: boolean = true,
  ): Promise<RuleApplicationResult> {
    return await DataStoreOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: rules,
      allowOwnerNotification: allowOwnerNotification,
    });
  }

  test("reads a data store's criteria fields, Notify Owners and the owners to add", () => {
    expect(DataStoreOwnerRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      notifyOwners: true,
      matchLabels: { _id: true },
      nameRegexPattern: true,
      descriptionRegexPattern: true,
      cloudTagPattern: true,
      ownerUsers: { _id: true },
      ownerTeams: { _id: true },
    });
    expect(DataStoreOwnerRuleEngineService.resourceSelectForRuleRun).toEqual({
      _id: true,
      projectId: true,
    });
  });

  test("a store found by discovery gets the matching rule's people and teams as owners, to be told", async () => {
    arrange({ rules: [ownerRule()] });

    await DataStoreOwnerRuleEngineService.applyRulesToDataStore(target());

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.projectId).toBe(PROJECT_ID);
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);

    const user: any = createOwnerUser.mock.calls[0]![0];
    expect(user.data.dataStoreId).toBe(STORE_ID);
    expect(user.data.projectId).toBe(PROJECT_ID);
    expect(user.data.userId.toString()).toBe(USER_ID.toString());
    // Not yet told - the owner notification picks it up.
    expect(user.data.isOwnerNotified).toBe(false);
    expect(user.props).toEqual({ isRoot: true });

    const team: any = createOwnerTeam.mock.calls[0]![0];
    expect(team.data.dataStoreId).toBe(STORE_ID);
    expect(team.data.teamId.toString()).toBe(TEAM_ID.toString());
    expect(team.data.isOwnerNotified).toBe(false);

    const item: any = feed.mock.calls[0]![0];
    expect(item.dataStoreId).toBe(STORE_ID);
    expect(item.dataStoreFeedEventType).toBe(
      DataStoreFeedEventType.OwnerRuleExecuted,
    );
    expect(item.feedInfoInMarkdown).toContain("by 1 owner rule.");
    expect(item.moreInformationInMarkdown).toContain(
      "Payments owns its stores",
    );
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

    await run([ownerRule({ notifyOwners: true })], false);

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

  test("owners already on the store are looked up by dataStoreId and never added twice", async () => {
    arrange({ assignedUserIds: [USER_ID] });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.updated(1),
    );

    expect(ownerUserRead.mock.calls[0]![0].query.dataStoreId).toBe(STORE_ID);
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).toHaveBeenCalledTimes(1);
  });

  test("every owner already there: matched, nothing added, nothing on the Timeline", async () => {
    arrange({ assignedUserIds: [USER_ID], assignedTeamIds: [TEAM_ID] });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.alreadyApplied(),
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("a store another team tagged gets nobody", async () => {
    arrange({ details: details({ cloudTags: { team: "growth" } }) });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("conditions see the labels a label rule added a moment before", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(
      run([
        ownerRule({
          cloudTagPattern: "",
          criteria: criteria("matchLabels", RuleCriteriaOperator.HasAllOf, [
            LABEL_A.toString(),
          ]),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(2));
  });

  test("a failing read of the store is reported as failed, never thrown", async () => {
    arrange();
    getJestSpyOn(DataStoreService, "findOneById").mockRejectedValue(
      new Error("database is down"),
    );

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.failed(),
    );
  });

  test("the hook a new store runs never throws", async () => {
    arrange({ rules: [ownerRule()] });
    createOwnerTeam.mockRejectedValue(new Error("connection terminated"));

    await expect(
      DataStoreOwnerRuleEngineService.applyRulesToDataStore(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
