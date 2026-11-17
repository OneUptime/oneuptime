import Alert from "../../../Models/DatabaseModels/Alert";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertOwnerRuleService from "../../../Server/Services/AlertOwnerRuleService";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import AlertService from "../../../Server/Services/AlertService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertOnCallRulesOnOwnerChange, {
  OWNERS_CHANGED_REASON,
} from "../../../Server/Utils/Alert/AlertOnCallRulesOnOwnerChange";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import CreatedNotificationHold, {
  OwnersAddedBy,
} from "../../../Server/Utils/Notification/CreatedNotificationHold";
import OnCallObserverPaging from "../../../Server/Utils/OnCall/OnCallObserverPaging";
import { OnCallRulesPaging } from "../../../Server/Utils/OnCall/OnCallRulePageAs";
import RuleCriteriaOwnerIds from "../../../Server/Utils/Rules/RuleCriteriaOwnerIds";
import WorkspaceRecordOwners from "../../../Server/Utils/Workspace/WorkspaceRecordOwners";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import {
  getRuleCriteriaFieldsForModel,
  getRuleCriteriaOwnerFieldsForModel,
  isRuleCriteriaOwnerField,
} from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import {
  getOwnersMeetingRuleCriteriaOwnerFilter,
  matchesRuleCriteriaOwnerFilter,
} from "../../../Utils/Rules/RuleCriteriaOwnerMatch";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * AN ALERT ON-CALL RULE MATCHES WHO OWNS THE ALERT (#9353).
 *
 * "Alert Owner is any of Platform, Jane" holds when one of the people and
 * teams picked is among the alert's owners - its owner users and owner
 * teams, as recorded - and "is none of" when none is: the matching of a
 * workspace rule's owner condition (#7583). A member of an owning team is
 * not an owner. The owners are read only for a rule that asks, once per
 * alert. An owner added after the alert is created runs the rules with an
 * Alert Owner condition again (AlertOnCallRulesOnOwnerChange).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "93530000-0000-4000-8000-000000000001",
);
const POLICY_PLATFORM: string = "93530000-0000-4000-8000-00000000000a";
const POLICY_DATABASE: string = "93530000-0000-4000-8000-00000000000b";
const JANE: string = "93530000-0000-4000-8000-0000000000a1";
const OMAR: string = "93530000-0000-4000-8000-0000000000a2";
const PLATFORM_TEAM: string = "93530000-0000-4000-8000-0000000000b1";
const DATABASE_TEAM: string = "93530000-0000-4000-8000-0000000000b2";
const HIGH_SEVERITY: string = "93530000-0000-4000-8000-0000000000c1";
const LOW_SEVERITY: string = "93530000-0000-4000-8000-0000000000c2";

function ownerFilter(
  ids: Array<string>,
  operator: RuleCriteriaOperator = RuleCriteriaOperator.HasAnyOf,
): RuleCriteriaFilter {
  return { field: "alertOwners", operator: operator, value: ids };
}

function severityFilter(ids: Array<string>): RuleCriteriaFilter {
  return {
    field: "alertSeverities",
    operator: RuleCriteriaOperator.HasAnyOf,
    value: ids,
  };
}

function criteria(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

function policy(id: string, name: string): OnCallDutyPolicy {
  const item: OnCallDutyPolicy = new OnCallDutyPolicy();
  item._id = id;
  item.name = name;
  return item;
}

function rule(data: {
  name: string;
  policyId: string;
  criteria: RuleCriteria;
}): AlertOnCallRule {
  const item: AlertOnCallRule = new AlertOnCallRule();
  item.id = ObjectID.generate();
  item.name = data.name;
  item.criteria = data.criteria;
  item.onCallDutyPolicies = [policy(data.policyId, data.name)];
  return item;
}

function alert(data?: { severityId?: string | undefined }): Alert {
  const item: Alert = new Alert();
  item.id = ObjectID.generate();
  item.projectId = PROJECT_ID;
  item.onCallDutyPolicies = [];

  if (data?.severityId) {
    item.alertSeverityId = new ObjectID(data.severityId);
  }

  return item;
}

function namesOf(rules: Array<AlertOnCallRule>): Array<string> {
  return rules.map((item: AlertOnCallRule): string => {
    return item.name || "";
  });
}

describe("matchesRuleCriteriaOwnerFilter", () => {
  test("is any of: one of the picks is an owner", () => {
    expect(
      matchesRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE, PLATFORM_TEAM]),
        ownerIds: [PLATFORM_TEAM],
      }),
    ).toBe(true);
    expect(
      matchesRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE]),
        ownerIds: [OMAR, PLATFORM_TEAM],
      }),
    ).toBe(false);
  });

  test("is none of: no pick is an owner, and a record with no owners has none", () => {
    expect(
      matchesRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE], RuleCriteriaOperator.HasNoneOf),
        ownerIds: [OMAR],
      }),
    ).toBe(true);
    expect(
      matchesRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE], RuleCriteriaOperator.HasNoneOf),
        ownerIds: [],
      }),
    ).toBe(true);
    expect(
      matchesRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE, OMAR], RuleCriteriaOperator.HasNoneOf),
        ownerIds: [OMAR],
      }),
    ).toBe(false);
  });

  test("compares ids whatever their case", () => {
    expect(
      matchesRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE.toUpperCase()]),
        ownerIds: [JANE],
      }),
    ).toBe(true);
  });

  test("a condition with nothing picked, or another operator, never holds", () => {
    expect(
      matchesRuleCriteriaOwnerFilter({
        filter: ownerFilter([]),
        ownerIds: [JANE],
      }),
    ).toBe(false);
    expect(
      matchesRuleCriteriaOwnerFilter({
        filter: {
          field: "alertOwners",
          operator: RuleCriteriaOperator.Contains,
          value: JANE,
        },
        ownerIds: [JANE],
      }),
    ).toBe(false);
  });
});

/*
 * WHICH OWNERS MAKE AN OWNER CONDITION HOLD (#9407): what "When this goes
 * down" names under a rule its owners make match.
 */
describe("getOwnersMeetingRuleCriteriaOwnerFilter", () => {
  test("is any of: the picks that are owners, in the order picked, each once", () => {
    expect(
      getOwnersMeetingRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE, PLATFORM_TEAM, OMAR, JANE]),
        ownerIds: [OMAR, JANE.toUpperCase(), DATABASE_TEAM],
      }),
    ).toEqual([JANE, OMAR]);
  });

  test("is all of, when every pick is an owner: every pick", () => {
    expect(
      getOwnersMeetingRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE, OMAR], RuleCriteriaOperator.HasAllOf),
        ownerIds: [OMAR, JANE],
      }),
    ).toEqual([JANE, OMAR]);
    expect(
      getOwnersMeetingRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE, OMAR], RuleCriteriaOperator.HasAllOf),
        ownerIds: [OMAR],
      }),
    ).toEqual([]);
  });

  test("is none of names nobody: no owner makes it hold", () => {
    expect(
      getOwnersMeetingRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE], RuleCriteriaOperator.HasNoneOf),
        ownerIds: [OMAR],
      }),
    ).toEqual([]);
  });

  test("a condition the owners do not meet, or another operator, names nobody", () => {
    expect(
      getOwnersMeetingRuleCriteriaOwnerFilter({
        filter: ownerFilter([JANE]),
        ownerIds: [OMAR],
      }),
    ).toEqual([]);
    expect(
      getOwnersMeetingRuleCriteriaOwnerFilter({
        filter: {
          field: "alertOwners",
          operator: RuleCriteriaOperator.Contains,
          value: JANE,
        },
        ownerIds: [JANE],
      }),
    ).toEqual([]);
  });
});

describe("the owners that make an alert on-call rule match (getOwnersMakingRuleMatch, #9407)", () => {
  test("each owner a rule's Alert Owner conditions pick, each once; other conditions name nobody", () => {
    expect(
      AlertOnCallRuleEngineService.getOwnersMakingRuleMatch({
        rule: rule({
          name: "Platform and Jane",
          policyId: POLICY_PLATFORM,
          criteria: criteria([
            severityFilter([HIGH_SEVERITY]),
            ownerFilter([PLATFORM_TEAM, JANE]),
            ownerFilter([JANE, OMAR]),
          ]),
        }),
        ownerIds: [JANE, PLATFORM_TEAM, DATABASE_TEAM],
      }),
    ).toEqual([PLATFORM_TEAM, JANE]);
  });

  test("a rule whose owner condition is is none of, or that has none, names nobody", () => {
    expect(
      AlertOnCallRuleEngineService.getOwnersMakingRuleMatch({
        rule: rule({
          name: "Not Platform's",
          policyId: POLICY_PLATFORM,
          criteria: criteria([
            ownerFilter([PLATFORM_TEAM], RuleCriteriaOperator.HasNoneOf),
          ]),
        }),
        ownerIds: [JANE],
      }),
    ).toEqual([]);

    const withoutCriteria: AlertOnCallRule = new AlertOnCallRule();

    expect(
      AlertOnCallRuleEngineService.getOwnersMakingRuleMatch({
        rule: withoutCriteria,
        ownerIds: [JANE],
      }),
    ).toEqual([]);
  });
});

describe("the Alert Owner condition is registered for alert on-call rules only", () => {
  test("alertOwners is an owner field of AlertOnCallRule, and no column", () => {
    expect(getRuleCriteriaOwnerFieldsForModel("AlertOnCallRule")).toEqual([
      "alertOwners",
    ]);
    expect(isRuleCriteriaOwnerField("AlertOnCallRule", "alertOwners")).toBe(
      true,
    );
    expect(getRuleCriteriaFieldsForModel("AlertOnCallRule")).not.toContain(
      "alertOwners",
    );
    expect(new AlertOnCallRule().hasColumn("alertOwners")).toBe(false);
  });

  test("no other rule kind has it", () => {
    expect(getRuleCriteriaOwnerFieldsForModel("IncidentOnCallRule")).toEqual(
      [],
    );
    expect(getRuleCriteriaOwnerFieldsForModel("AlertOwnerRule")).toEqual([]);
    expect(getRuleCriteriaOwnerFieldsForModel("constructor")).toEqual([]);
  });
});

describe("criteria naming alert owners are checked as they are written", () => {
  const validate: (value: RuleCriteria) => void = (
    value: RuleCriteria,
  ): void => {
    (
      AlertOnCallRuleService as unknown as {
        validateRuleCriteriaForModel: (value: RuleCriteria) => void;
      }
    ).validateRuleCriteriaForModel(value);
  };

  test("people and teams, with is any of or is none of, are accepted", () => {
    expect(() => {
      validate(
        criteria([
          ownerFilter([JANE, PLATFORM_TEAM]),
          ownerFilter([OMAR], RuleCriteriaOperator.HasNoneOf),
          severityFilter([HIGH_SEVERITY]),
        ]),
      );
    }).not.toThrow();
  });

  test("another operator is refused", () => {
    expect(() => {
      validate(criteria([ownerFilter([JANE], RuleCriteriaOperator.HasAllOf)]));
    }).toThrow(BadDataException);
    expect(() => {
      validate(
        criteria([
          {
            field: "alertOwners",
            operator: RuleCriteriaOperator.Equals,
            value: JANE,
          },
        ]),
      );
    }).toThrow(BadDataException);
  });

  test("a value that is not an id is refused", () => {
    expect(() => {
      validate(criteria([ownerFilter(["jane@example.com"])]));
    }).toThrow("requires the IDs of people and teams");
  });

  test("another rule kind cannot name alert owners", () => {
    const validateFor: (service: unknown, value: RuleCriteria) => void = (
      service: unknown,
      value: RuleCriteria,
    ): void => {
      (
        service as {
          validateRuleCriteriaForModel: (value: RuleCriteria) => void;
        }
      ).validateRuleCriteriaForModel(value);
    };

    expect(() => {
      validateFor(AlertOwnerRuleService, criteria([ownerFilter([JANE])]));
    }).toThrow('Rule criteria field "alertOwners" is not supported');
  });
});

describe("an alert on-call rule with an Alert Owner condition", () => {
  let owners: Array<string> = [];
  let ownerReads: SpyInstance<(...args: Array<unknown>) => unknown>;

  function stubRules(rules: Array<AlertOnCallRule>): void {
    jest
      .spyOn(AlertOnCallRuleService, "findBy")
      .mockResolvedValue(rules as never);
  }

  beforeEach(() => {
    owners = [];

    ownerReads = jest
      .spyOn(WorkspaceRecordOwners, "getOwnerIds")
      .mockImplementation((async (): Promise<Array<string>> => {
        return [...owners];
      }) as never) as unknown as SpyInstance<
      (...args: Array<unknown>) => unknown
    >;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("matches an alert one of whose owner users is picked", async () => {
    owners = [JANE];
    stubRules([
      rule({
        name: "Jane's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([JANE])]),
      }),
    ]);

    expect(
      namesOf(await AlertOnCallRuleEngineService.getMatchingRules(alert())),
    ).toEqual(["Jane's alerts"]);
  });

  test("matches an alert one of whose owner teams is picked", async () => {
    owners = [OMAR, PLATFORM_TEAM];
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
      rule({
        name: "Database's alerts",
        policyId: POLICY_DATABASE,
        criteria: criteria([ownerFilter([DATABASE_TEAM])]),
      }),
    ]);

    expect(
      namesOf(await AlertOnCallRuleEngineService.getMatchingRules(alert())),
    ).toEqual(["Platform's alerts"]);
  });

  test("reads the alert's own owner tables", async () => {
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
    ]);

    const item: Alert = alert();

    await AlertOnCallRuleEngineService.getMatchingRules(item);

    expect(ownerReads).toHaveBeenCalledWith({
      recordKey: "alertId",
      recordId: item.id,
    });
  });

  test("a person who is only a member of an owning team is not an owner", async () => {
    // The alert is owned by the Platform team, Jane is in it.
    owners = [PLATFORM_TEAM];
    stubRules([
      rule({
        name: "Jane's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([JANE])]),
      }),
    ]);

    expect(
      await AlertOnCallRuleEngineService.getMatchingRules(alert()),
    ).toEqual([]);
  });

  test("an alert with no owner matches is none of, never is any of", async () => {
    owners = [];
    stubRules([
      rule({
        name: "Owned by Platform",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
      rule({
        name: "Not owned by Platform",
        policyId: POLICY_DATABASE,
        criteria: criteria([
          ownerFilter([PLATFORM_TEAM], RuleCriteriaOperator.HasNoneOf),
        ]),
      }),
    ]);

    expect(
      namesOf(await AlertOnCallRuleEngineService.getMatchingRules(alert())),
    ).toEqual(["Not owned by Platform"]);
  });

  test("an alert not yet saved has no owners, and nothing is read for it", async () => {
    owners = [PLATFORM_TEAM];
    stubRules([
      rule({
        name: "Owned by Platform",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
    ]);

    const unsaved: Alert = new Alert();
    unsaved.projectId = PROJECT_ID;

    expect(
      await AlertOnCallRuleEngineService.getMatchingRules(unsaved),
    ).toEqual([]);
    expect(ownerReads).not.toHaveBeenCalled();
  });

  /*
   * When this goes down asks about an alert a monitor would open, held in
   * memory, with the owners its create will give it (#9407).
   */
  describe("the owners of an alert not saved yet, handed in", () => {
    beforeEach(() => {
      stubRules([
        rule({
          name: "Owned by Platform",
          policyId: POLICY_PLATFORM,
          criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
        }),
        rule({
          name: "Not owned by Platform",
          policyId: POLICY_DATABASE,
          criteria: criteria([
            ownerFilter([PLATFORM_TEAM], RuleCriteriaOperator.HasNoneOf),
          ]),
        }),
      ]);
    });

    function unsaved(): Alert {
      const item: Alert = new Alert();
      item.projectId = PROJECT_ID;
      return item;
    }

    test("is any of matches the owners handed in, and nothing is read", async () => {
      expect(
        namesOf(
          await AlertOnCallRuleEngineService.getMatchingRules(
            unsaved(),
            undefined,
            { ownerIds: [JANE, PLATFORM_TEAM] },
          ),
        ),
      ).toEqual(["Owned by Platform"]);
      expect(ownerReads).not.toHaveBeenCalled();
    });

    test("is none of does not match when an owner handed in is picked", async () => {
      expect(
        namesOf(
          await AlertOnCallRuleEngineService.getMatchingRules(
            unsaved(),
            undefined,
            { ownerIds: [PLATFORM_TEAM.toUpperCase()] },
          ),
        ),
      ).toEqual(["Owned by Platform"]);
    });

    test("no owners handed in: is none of holds, is any of does not", async () => {
      expect(
        namesOf(
          await AlertOnCallRuleEngineService.getMatchingRules(
            unsaved(),
            undefined,
            { ownerIds: [] },
          ),
        ),
      ).toEqual(["Not owned by Platform"]);
      expect(ownerReads).not.toHaveBeenCalled();
    });

    test("for a saved alert, the owners handed in are read instead of its rows", async () => {
      owners = [];

      expect(
        namesOf(
          await AlertOnCallRuleEngineService.getMatchingRules(
            alert(),
            undefined,
            { ownerIds: [PLATFORM_TEAM] },
          ),
        ),
      ).toEqual(["Owned by Platform"]);
      expect(ownerReads).not.toHaveBeenCalled();
    });
  });

  describe("combined with other conditions", () => {
    const severityAndOwner: (filterCondition: FilterCondition) => void = (
      filterCondition: FilterCondition,
    ): void => {
      stubRules([
        rule({
          name: "High alerts Platform owns",
          policyId: POLICY_PLATFORM,
          criteria: criteria(
            [severityFilter([HIGH_SEVERITY]), ownerFilter([PLATFORM_TEAM])],
            filterCondition,
          ),
        }),
      ]);
    };

    test("match all: the severity and the owner both hold", async () => {
      severityAndOwner(FilterCondition.All);
      owners = [PLATFORM_TEAM];

      expect(
        namesOf(
          await AlertOnCallRuleEngineService.getMatchingRules(
            alert({ severityId: HIGH_SEVERITY }),
          ),
        ),
      ).toEqual(["High alerts Platform owns"]);
    });

    test("match all: the right owner on the wrong severity does not match", async () => {
      severityAndOwner(FilterCondition.All);
      owners = [PLATFORM_TEAM];

      expect(
        await AlertOnCallRuleEngineService.getMatchingRules(
          alert({ severityId: LOW_SEVERITY }),
        ),
      ).toEqual([]);
    });

    test("match all: the right severity with another owner does not match", async () => {
      severityAndOwner(FilterCondition.All);
      owners = [DATABASE_TEAM];

      expect(
        await AlertOnCallRuleEngineService.getMatchingRules(
          alert({ severityId: HIGH_SEVERITY }),
        ),
      ).toEqual([]);
    });

    test("match any: the owner alone is enough", async () => {
      severityAndOwner(FilterCondition.Any);
      owners = [PLATFORM_TEAM];

      expect(
        namesOf(
          await AlertOnCallRuleEngineService.getMatchingRules(
            alert({ severityId: LOW_SEVERITY }),
          ),
        ),
      ).toEqual(["High alerts Platform owns"]);
    });

    test("match any: neither holds, no match", async () => {
      severityAndOwner(FilterCondition.Any);
      owners = [];

      expect(
        await AlertOnCallRuleEngineService.getMatchingRules(
          alert({ severityId: LOW_SEVERITY }),
        ),
      ).toEqual([]);
    });
  });

  test("owners are read once for every rule that asks, and not at all when none does", async () => {
    owners = [PLATFORM_TEAM];
    stubRules([
      rule({
        name: "High alerts",
        policyId: POLICY_DATABASE,
        criteria: criteria([severityFilter([HIGH_SEVERITY])]),
      }),
    ]);

    await AlertOnCallRuleEngineService.getMatchingRules(
      alert({ severityId: HIGH_SEVERITY }),
    );

    expect(ownerReads).not.toHaveBeenCalled();

    stubRules([
      rule({
        name: "Platform",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
      rule({
        name: "Not Database",
        policyId: POLICY_DATABASE,
        criteria: criteria([
          ownerFilter([DATABASE_TEAM], RuleCriteriaOperator.HasNoneOf),
        ]),
      }),
    ]);

    expect(
      namesOf(await AlertOnCallRuleEngineService.getMatchingRules(alert())),
    ).toEqual(["Platform", "Not Database"]);
    expect(ownerReads).toHaveBeenCalledTimes(1);
  });

  test("owners that cannot be read match no owner condition, is none of included", async () => {
    ownerReads.mockImplementation((async (): Promise<Array<string>> => {
      throw new Error("database is down");
    }) as never);
    stubRules([
      rule({
        name: "Not owned by Platform",
        policyId: POLICY_PLATFORM,
        criteria: criteria([
          ownerFilter([PLATFORM_TEAM], RuleCriteriaOperator.HasNoneOf),
        ]),
      }),
    ]);

    expect(
      await AlertOnCallRuleEngineService.getMatchingRules(alert()),
    ).toEqual([]);
  });

  test("a rule asks who owns the alert only with an Alert Owner condition", () => {
    expect(
      AlertOnCallRuleEngineService.hasOwnerCondition(
        rule({
          name: "Platform",
          policyId: POLICY_PLATFORM,
          criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
        }),
      ),
    ).toBe(true);
    expect(
      AlertOnCallRuleEngineService.hasOwnerCondition(
        rule({
          name: "High",
          policyId: POLICY_PLATFORM,
          criteria: criteria([severityFilter([HIGH_SEVERITY])]),
        }),
      ),
    ).toBe(false);

    const legacy: AlertOnCallRule = new AlertOnCallRule();
    expect(AlertOnCallRuleEngineService.hasOwnerCondition(legacy)).toBe(false);
  });
});

describe("an owner added after the alert is created (AlertOnCallRulesOnOwnerChange)", () => {
  let owners: Array<string> = [];
  let attached: Array<string> = [];
  let alertPolicies: Array<string> = [];
  let isResolved: boolean = false;
  let executed: SpyInstance<(...args: Array<unknown>) => unknown>;
  let feed: SpyInstance<(...args: Array<unknown>) => unknown>;
  let readAlert: SpyInstance<(...args: Array<unknown>) => unknown>;
  let lock: SpyInstance<(...args: Array<unknown>) => unknown>;
  const ALERT_ID: ObjectID = new ObjectID(
    "93530000-0000-4000-8000-0000000000d1",
  );

  function stubRules(rules: Array<AlertOnCallRule>): void {
    jest
      .spyOn(AlertOnCallRuleService, "findBy")
      .mockResolvedValue(rules as never);
  }

  function feedMarkdown(): string {
    const call: Array<unknown> | undefined = feed.mock.calls[0];

    return String(
      (call?.[0] as { feedInfoInMarkdown?: string } | undefined)
        ?.feedInfoInMarkdown || "",
    );
  }

  beforeEach(() => {
    owners = [];
    attached = [];
    alertPolicies = [];
    isResolved = false;

    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { OnCallDutyPolicy: [POLICY_PLATFORM, POLICY_DATABASE] },
    });

    jest
      .spyOn(WorkspaceRecordOwners, "getOwnerIds")
      .mockImplementation((async (): Promise<Array<string>> => {
        return [...owners];
      }) as never);

    lock = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as never) as unknown as SpyInstance<
      (...args: Array<unknown>) => unknown
    >;
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    jest
      .spyOn(AlertService, "isAlertResolved")
      .mockImplementation((async (): Promise<boolean> => {
        return isResolved;
      }) as never);

    readAlert = jest
      .spyOn(AlertService, "findOneById")
      .mockImplementation((async (): Promise<Alert> => {
        const item: Alert = new Alert();
        item.id = ALERT_ID;
        item.projectId = PROJECT_ID;
        item.onCallDutyPolicies = alertPolicies.map(
          (id: string): OnCallDutyPolicy => {
            return policy(id, id);
          },
        );
        return item;
      }) as never) as unknown as SpyInstance<
      (...args: Array<unknown>) => unknown
    >;

    jest.spyOn(AlertService, "getRepository").mockReturnValue({
      createQueryBuilder: () => {
        return {
          relation: () => {
            return {
              of: () => {
                return {
                  add: async (id: unknown): Promise<void> => {
                    attached.push(String(id));
                  },
                };
              },
            };
          },
        };
      },
    } as never);

    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([
        policy(POLICY_PLATFORM, "Platform on-call"),
        policy(POLICY_DATABASE, "Database on-call"),
      ] as never);

    executed = jest
      .spyOn(OnCallDutyPolicyService, "executePolicy")
      .mockResolvedValue(undefined as never) as unknown as SpyInstance<
      (...args: Array<unknown>) => unknown
    >;

    jest
      .spyOn(OnCallObserverPaging, "pagePolicies")
      .mockResolvedValue([] as never);

    feed = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never) as unknown as SpyInstance<
      (...args: Array<unknown>) => unknown
    >;
  });

  afterEach(() => {
    AlertOnCallRulesOnOwnerChange.finishCreating(ALERT_ID);
    jest.restoreAllMocks();
  });

  test("a rule the alert now matches pages its policy, and the feed says why", async () => {
    owners = [PLATFORM_TEAM];
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
    ]);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(attached).toEqual([POLICY_PLATFORM]);
    expect(executed).toHaveBeenCalledTimes(1);
    expect(String(executed.mock.calls[0]![0])).toBe(POLICY_PLATFORM);
    expect(executed.mock.calls[0]![1]).toMatchObject({
      triggeredByAlertId: ALERT_ID,
    });
    expect(feedMarkdown()).toContain(
      `The alert now matches it: ${OWNERS_CHANGED_REASON}.`,
    );
  });

  test("a rule whose owner condition still does not hold pages nobody", async () => {
    owners = [DATABASE_TEAM];
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
    ]);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(executed).not.toHaveBeenCalled();
    expect(attached).toEqual([]);
  });

  test("only rules with an Alert Owner condition run again", async () => {
    owners = [PLATFORM_TEAM];
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
      // Matches every alert, but paged when the alert was created, if ever.
      rule({
        name: "Every alert",
        policyId: POLICY_DATABASE,
        criteria: criteria([]),
      }),
    ]);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(attached).toEqual([POLICY_PLATFORM]);
    expect(executed).toHaveBeenCalledTimes(1);
  });

  test("a policy the alert has already is not paged again", async () => {
    owners = [PLATFORM_TEAM];
    alertPolicies = [POLICY_PLATFORM];
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
    ]);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(executed).not.toHaveBeenCalled();
  });

  test("a policy attached by a run at the same moment is that run's to page", async () => {
    owners = [PLATFORM_TEAM];
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
    ]);

    jest.spyOn(AlertService, "getRepository").mockReturnValue({
      createQueryBuilder: () => {
        return {
          relation: () => {
            return {
              of: () => {
                return {
                  add: async (): Promise<void> => {
                    throw { postgresErrorCode: "23505" };
                  },
                };
              },
            };
          },
        };
      },
    } as never);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(executed).not.toHaveBeenCalled();
  });

  test("a resolved alert runs nothing", async () => {
    owners = [PLATFORM_TEAM];
    isResolved = true;
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
    ]);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(readAlert).not.toHaveBeenCalled();
    expect(executed).not.toHaveBeenCalled();
  });

  test("a project with no rule that asks who owns an alert takes no lock and reads no alert", async () => {
    stubRules([
      rule({
        name: "High alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([severityFilter([HIGH_SEVERITY])]),
      }),
    ]);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(lock).not.toHaveBeenCalled();
    expect(readAlert).not.toHaveBeenCalled();
    expect(executed).not.toHaveBeenCalled();
  });

  test("while the alert is being created, its owners run nothing here: its on-call rules run after them", async () => {
    owners = [PLATFORM_TEAM];
    stubRules([
      rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      }),
    ]);

    AlertOnCallRulesOnOwnerChange.startCreating(ALERT_ID);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(executed).not.toHaveBeenCalled();

    AlertOnCallRulesOnOwnerChange.finishCreating(ALERT_ID);

    await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(executed).toHaveBeenCalledTimes(1);
  });

  test("a rule set to After OneUptime AI pages right away on a change", async () => {
    owners = [PLATFORM_TEAM];
    const aiRule: AlertOnCallRule = rule({
      name: "Platform's alerts",
      policyId: POLICY_PLATFORM,
      criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
    });
    aiRule.setColumnValue("whenToPage", OnCallRuleWhenToPage.AfterOneUptimeAI);
    stubRules([aiRule]);

    const paging: OnCallRulesPaging =
      await AlertOnCallRuleEngineService.applyRulesToAlert(
        (await AlertService.findOneById({
          id: ALERT_ID,
          props: { isRoot: true },
        })) as Alert,
        { reason: OWNERS_CHANGED_REASON, onlyOwnerRules: true },
      );

    expect(paging.addedPolicyIds).toEqual([POLICY_PLATFORM]);
    expect(paging.holds.get(POLICY_PLATFORM)?.isAiHold).toBeFalsy();
  });

  /*
   * THE OWNERS ADDED OUTSIDE ITS CREATE CHAIN ARE WAITED FOR (#9407): its
   * creator's, and those the code that made it adds once the create has
   * returned - a monitor's criteria's, the network device's. And an owner
   * that comes in once the rules have read the owners runs them again.
   */
  describe("as the alert is created", () => {
    let runs: SpyInstance<(...args: Array<unknown>) => unknown>;
    let warnings: SpyInstance<(...args: Array<unknown>) => unknown>;
    let errorsLogged: SpyInstance<(...args: Array<unknown>) => unknown>;
    let ruleReads: SpyInstance<(...args: Array<unknown>) => unknown>;

    const PLATFORMS_RULE: () => AlertOnCallRule = (): AlertOnCallRule => {
      return rule({
        name: "Platform's alerts",
        policyId: POLICY_PLATFORM,
        criteria: criteria([ownerFilter([PLATFORM_TEAM])]),
      });
    };

    // An alert's create, as a monitor makes it: its creator's word and its own.
    function monitorsCreate(): CreateBy<Alert> {
      const create: CreateBy<Alert> = {
        data: new Alert(),
        props: { isRoot: true },
      };

      CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Create);
      CreatedNotificationHold.willAddOwners(create, OwnersAddedBy.Caller);

      return create;
    }

    function waitFor(create: CreateBy<Alert>): Promise<void> {
      return AlertOnCallRulesOnOwnerChange.waitForOwnersOfCreate({
        createBy: create,
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      });
    }

    // Whether a promise has settled after a few turns.
    async function hasSettled(promise: Promise<void>): Promise<boolean> {
      let settled: boolean = false;

      promise.then(() => {
        settled = true;
      });

      for (let i: number = 0; i < 20; i++) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      }

      return settled;
    }

    // Every run of the rules after an owner change, the one finishCreating starts too.
    async function allRunsDone(): Promise<void> {
      await Promise.all(
        runs.mock.results.map((result: { value: unknown }) => {
          return result.value as Promise<void>;
        }),
      );
    }

    function withWaitOf(ms: number): () => void {
      const target: { OWNERS_WAITED_FOR_AT_MOST_MS: number } =
        AlertOnCallRulesOnOwnerChange as unknown as {
          OWNERS_WAITED_FOR_AT_MOST_MS: number;
        };
      const was: number = target.OWNERS_WAITED_FOR_AT_MOST_MS;

      target.OWNERS_WAITED_FOR_AT_MOST_MS = ms;

      return (): void => {
        target.OWNERS_WAITED_FOR_AT_MOST_MS = was;
      };
    }

    beforeEach(() => {
      runs = jest.spyOn(
        AlertOnCallRulesOnOwnerChange,
        "onOwnersChanged",
      ) as unknown as SpyInstance<(...args: Array<unknown>) => unknown>;
      warnings = jest.spyOn(logger, "warn").mockImplementation((() => {
        // read by the tests
      }) as never) as unknown as SpyInstance<
        (...args: Array<unknown>) => unknown
      >;
      errorsLogged = jest.spyOn(logger, "error").mockImplementation((() => {
        // read by the tests
      }) as never) as unknown as SpyInstance<
        (...args: Array<unknown>) => unknown
      >;
      stubRules([PLATFORMS_RULE()]);
      ruleReads = jest.spyOn(
        AlertOnCallRuleService,
        "findBy",
      ) as unknown as SpyInstance<(...args: Array<unknown>) => unknown>;
    });

    test("its on-call rules wait until its creator's and its caller's owners are in", async () => {
      const create: CreateBy<Alert> = monitorsCreate();
      AlertOnCallRulesOnOwnerChange.startCreating(ALERT_ID);

      const waiting: Promise<void> = waitFor(create);

      expect(await hasSettled(waiting)).toBe(false);

      // The create returned: its creator is in. The monitor is still adding the criteria's owners.
      await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Create);
      expect(await hasSettled(waiting)).toBe(false);

      // Its owners written: they ran nothing on their own, the alert being created.
      owners = [PLATFORM_TEAM];
      await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      });
      await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Caller);

      expect(await hasSettled(waiting)).toBe(true);
      expect(executed).not.toHaveBeenCalled();

      // The rules read the owners now, and see Platform; nothing runs again once the create is done.
      AlertOnCallRulesOnOwnerChange.finishCreating(ALERT_ID);
      await allRunsDone();

      expect(runs).toHaveBeenCalledTimes(1);
      expect(executed).not.toHaveBeenCalled();
      expect(warnings).not.toHaveBeenCalled();
    });

    test("a project with no rule that asks who owns an alert waits for nobody", async () => {
      stubRules([
        rule({
          name: "High alerts",
          policyId: POLICY_PLATFORM,
          criteria: criteria([severityFilter([HIGH_SEVERITY])]),
        }),
      ]);

      const waiting: Promise<void> = waitFor(monitorsCreate());

      expect(await hasSettled(waiting)).toBe(true);
    });

    test("nobody still adding owners waits for nothing, and reads no rule", async () => {
      const create: CreateBy<Alert> = monitorsCreate();

      await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Create);
      await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Caller);

      const waiting: Promise<void> = waitFor(create);

      expect(await hasSettled(waiting)).toBe(true);
      expect(ruleReads).not.toHaveBeenCalled();

      // A create with nobody adding owners - a form's, with no creator to add - neither.
      expect(
        await hasSettled(
          waitFor({ data: new Alert(), props: { isRoot: true } }),
        ),
      ).toBe(true);
      expect(ruleReads).not.toHaveBeenCalled();
    });

    test("it waits OWNERS_WAITED_FOR_AT_MOST_MS at most, and an owner that comes in later, as it is created, runs the rules again when it is", async () => {
      expect(AlertOnCallRulesOnOwnerChange.OWNERS_WAITED_FOR_AT_MOST_MS).toBe(
        10 * 1000,
      );

      const restore: () => void = withWaitOf(30);

      try {
        const create: CreateBy<Alert> = monitorsCreate();
        AlertOnCallRulesOnOwnerChange.startCreating(ALERT_ID);

        // Nobody says their owners are in: the wait runs out.
        await waitFor(create);

        expect(warnings).toHaveBeenCalledTimes(1);
        expect(String(warnings.mock.calls[0]![0])).toContain(
          "were not all in after 30 ms",
        );

        // The monitor's owners come in once the rules have read the owners, before the create is done.
        owners = [PLATFORM_TEAM];
        await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
          alertId: ALERT_ID,
          projectId: PROJECT_ID,
        });
        await CreatedNotificationHold.ownersAreIn(create, OwnersAddedBy.Caller);

        expect(executed).not.toHaveBeenCalled();

        AlertOnCallRulesOnOwnerChange.finishCreating(ALERT_ID);
        await allRunsDone();

        // Run again once it is done: Platform's rule matches now, and pages.
        expect(runs).toHaveBeenCalledTimes(2);
        expect(attached).toEqual([POLICY_PLATFORM]);
        expect(executed).toHaveBeenCalledTimes(1);
        expect(String(executed.mock.calls[0]![0])).toBe(POLICY_PLATFORM);
      } finally {
        restore();
      }
    });

    test("an owner its chain added before the rules read the owners runs nothing again", async () => {
      AlertOnCallRulesOnOwnerChange.startCreating(ALERT_ID);

      // Added by the owner rules, before the on-call rules.
      owners = [PLATFORM_TEAM];
      await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      });

      await waitFor({ data: new Alert(), props: { isRoot: true } });
      AlertOnCallRulesOnOwnerChange.finishCreating(ALERT_ID);
      await allRunsDone();

      expect(runs).toHaveBeenCalledTimes(1);
      expect(executed).not.toHaveBeenCalled();
    });

    test("an owner change once the create is done runs the rules as ever, once", async () => {
      AlertOnCallRulesOnOwnerChange.startCreating(ALERT_ID);
      await waitFor({ data: new Alert(), props: { isRoot: true } });
      AlertOnCallRulesOnOwnerChange.finishCreating(ALERT_ID);

      owners = [PLATFORM_TEAM];
      await AlertOnCallRulesOnOwnerChange.onOwnersChanged({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      });
      await allRunsDone();

      expect(runs).toHaveBeenCalledTimes(1);
      expect(executed).toHaveBeenCalledTimes(1);
    });

    test("rules that cannot be read wait for nobody, and never fail the create", async () => {
      jest
        .spyOn(AlertOnCallRuleEngineService, "hasRulesWithOwnerCondition")
        .mockRejectedValue(new Error("the database is away") as never);

      const waiting: Promise<void> = waitFor(monitorsCreate());

      expect(await hasSettled(waiting)).toBe(true);
      await expect(waiting).resolves.toBeUndefined();
      expect(String(errorsLogged.mock.calls[0]![0])).toContain(
        "Could not wait for alert",
      );
    });
  });
});

describe("the people and teams a rule names are the project's (RuleCriteriaOwnerIds)", () => {
  beforeEach(() => {
    jest.spyOn(TeamService, "findBy").mockImplementation((async (): Promise<
      Array<Team>
    > => {
      const team: Team = new Team();
      team._id = PLATFORM_TEAM;
      return [team];
    }) as never);

    jest
      .spyOn(TeamMemberService, "findBy")
      .mockImplementation((async (): Promise<Array<TeamMember>> => {
        const member: TeamMember = new TeamMember();
        member.userId = new ObjectID(JANE);
        return [member];
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a team of the project and a member of it pass, written lower case", async () => {
    const value: RuleCriteria = criteria([
      ownerFilter([JANE.toUpperCase(), PLATFORM_TEAM]),
    ]);

    await RuleCriteriaOwnerIds.check({
      projectId: PROJECT_ID,
      modelName: "AlertOnCallRule",
      criteria: value,
    });

    expect(value.filters[0]!.value).toEqual([JANE, PLATFORM_TEAM]);
  });

  test("someone not in the project is refused, by id", async () => {
    await expect(
      RuleCriteriaOwnerIds.check({
        projectId: PROJECT_ID,
        modelName: "AlertOnCallRule",
        criteria: criteria([ownerFilter([JANE, OMAR])]),
      }),
    ).rejects.toThrow(`not in this project: ${OMAR}`);
  });

  test("an id the rule held already is kept, found or not", async () => {
    await expect(
      RuleCriteriaOwnerIds.check({
        projectId: PROJECT_ID,
        modelName: "AlertOnCallRule",
        criteria: criteria([ownerFilter([JANE, OMAR])]),
        keptIds: new Set([OMAR]),
      }),
    ).resolves.toBeUndefined();
  });

  test("criteria with no owner condition look nothing up", async () => {
    await RuleCriteriaOwnerIds.check({
      projectId: PROJECT_ID,
      modelName: "AlertOnCallRule",
      criteria: criteria([severityFilter([HIGH_SEVERITY])]),
    });

    expect(TeamService.findBy).not.toHaveBeenCalled();
    expect(
      RuleCriteriaOwnerIds.namesOwners({
        modelName: "AlertOnCallRule",
        criteria: criteria([severityFilter([HIGH_SEVERITY])]),
      }),
    ).toBe(false);
    expect(
      RuleCriteriaOwnerIds.getIdsNamed({
        modelName: "AlertOnCallRule",
        criteria: criteria([ownerFilter([JANE.toUpperCase()])]),
      }),
    ).toEqual(new Set([JANE]));
  });
});

describe("adding or removing an alert's owner runs its on-call rules again", () => {
  const ALERT_ID: ObjectID = new ObjectID(
    "93530000-0000-4000-8000-0000000000e1",
  );
  let ran: SpyInstance<(...args: Array<unknown>) => unknown>;

  beforeEach(() => {
    ran = jest
      .spyOn(AlertOnCallRulesOnOwnerChange, "onOwnersChanged")
      .mockResolvedValue(undefined as never) as unknown as SpyInstance<
      (...args: Array<unknown>) => unknown
    >;

    // Nobody to name in the feed, no channel to invite to.
    jest.spyOn(TeamService, "findOneById").mockResolvedValue(null as never);
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getNotificationRulesWhereInviteOwnersIsTrue",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "inviteTeamsBasedOnRulesAndWorkspaceChannels",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "inviteUsersBasedOnRulesAndWorkspaceChannels",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertService, "getWorkspaceChannelForAlert")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type OwnerHooks = {
    onCreateSuccess: (onCreate: unknown, item: unknown) => Promise<unknown>;
    onDeleteSuccess: (onDelete: unknown, ids: unknown) => Promise<unknown>;
  };

  type OwnerCase = {
    label: string;
    service: unknown;
    newRow: () => AlertOwnerTeam | AlertOwnerUser;
  };

  const cases: Array<OwnerCase> = [
    {
      label: "a team",
      service: AlertOwnerTeamService,
      newRow: (): AlertOwnerTeam => {
        const row: AlertOwnerTeam = new AlertOwnerTeam();
        row.teamId = new ObjectID(PLATFORM_TEAM);
        return row;
      },
    },
    {
      label: "a person",
      service: AlertOwnerUserService,
      newRow: (): AlertOwnerUser => {
        const row: AlertOwnerUser = new AlertOwnerUser();
        row.userId = new ObjectID(JANE);
        return row;
      },
    },
  ];

  test.each(cases)("$label added as an owner", async (ownerCase: OwnerCase) => {
    const { service, newRow } = ownerCase;
    const row: AlertOwnerTeam | AlertOwnerUser = newRow();
    row.alertId = ALERT_ID;
    row.projectId = PROJECT_ID;

    await (service as OwnerHooks).onCreateSuccess(
      { createBy: { props: { isRoot: true } } },
      row,
    );

    expect(ran).toHaveBeenCalledWith({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });
  });

  test.each(cases)(
    "$label taken off the owners, once per alert",
    async (ownerCase: OwnerCase) => {
      const { service, newRow } = ownerCase;
      const first: AlertOwnerTeam | AlertOwnerUser = newRow();
      first.alertId = ALERT_ID;
      first.projectId = PROJECT_ID;
      const second: AlertOwnerTeam | AlertOwnerUser = newRow();
      second.alertId = ALERT_ID;
      second.projectId = PROJECT_ID;

      await (service as OwnerHooks).onDeleteSuccess(
        {
          deleteBy: { props: { isRoot: true } },
          carryForward: { itemsToDelete: [first, second] },
        },
        [],
      );

      expect(ran).toHaveBeenCalledTimes(1);
      expect(ran).toHaveBeenCalledWith({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      });
    },
  );
});
