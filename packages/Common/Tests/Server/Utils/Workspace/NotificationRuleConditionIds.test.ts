import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "../../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceNotificationSummaryService from "../../../../Server/Services/WorkspaceNotificationSummaryService";
import WorkspaceNotificationSummaryItem from "../../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import { EXAMPLE_UUID } from "../../../../Server/Types/Database/UUIDColumnFilter";
import NotificationRuleConditionIds, {
  CHECKED_ID_CONDITIONS,
  toCanonicalId,
} from "../../../../Server/Utils/Workspace/NotificationRuleConditionIds";
import BadDataException from "../../../../Types/Exception/BadDataException";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  OWNER_CHECK_ONS,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE PEOPLE, TEAMS AND POLICIES A RULE NAMES ARE THE PROJECT'S OWN (#7554,
 * #7583).
 *
 * An owners condition names people and teams by id, an on-call rule's
 * On-Call Policy condition names policies by id - the API takes them as
 * text, so each is held, when a rule or summary is created or its
 * conditions written again, to: an id (a UUID, saved as the database writes
 * ids), and a record of the project - a team of it, a member of it, a
 * policy of it that is not archived. What a rule held before a write is
 * kept, found or not: a person who has left, a team since deleted.
 */

type Query = Record<string, unknown>;

const PROJECT_ID: ObjectID = ObjectID.generate();
const JANE: string = "0b6d1d5e-1a7c-4f4e-9a52-1f1b7d4d6c01";
const SAM: string = "0b6d1d5e-1a7c-4f4e-9a52-1f1b7d4d6c02";
const STRANGER: string = "0b6d1d5e-1a7c-4f4e-9a52-1f1b7d4d6c03";
const PLATFORM_TEAM: string = "5f0c6a1e-2b8d-4c3a-8e71-7a2b9c0d1e01";
const DELETED_TEAM: string = "5f0c6a1e-2b8d-4c3a-8e71-7a2b9c0d1e09";
const PAYMENTS_POLICY: string = "7a1e0c5f-3d2b-4a9c-b8e7-6f5d4c3b2a01";
const OTHER_PROJECT_POLICY: string = "7a1e0c5f-3d2b-4a9c-b8e7-6f5d4c3b2a09";

// The values bound into a QueryHelper.any(...) operator.
function anyValues(operator: unknown): Array<string> {
  return Object.values(
    (operator as { objectLiteralParameters: Record<string, Array<string>> })
      .objectLiteralParameters,
  )[0]!;
}

let teamQueries: Array<Query>;
let memberQueries: Array<Query>;
let policyQueries: Array<Query>;

/*
 * The project holds these teams, members and (not archived) policies: each
 * read answers with the ones its query asks for.
 */
function givenProject(data: {
  teams?: Array<string>;
  members?: Array<string>;
  policies?: Array<string>;
}): void {
  teamQueries = [];
  memberQueries = [];
  policyQueries = [];

  jest.spyOn(TeamService, "findBy").mockImplementation((async (args: {
    query: Query;
  }) => {
    teamQueries.push(args.query);
    const asked: Array<string> = anyValues(args.query["_id"]);

    return (data.teams || [])
      .filter((id: string): boolean => {
        return asked.includes(id);
      })
      .map((id: string) => {
        return { _id: id };
      });
  }) as never);

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    query: Query;
  }) => {
    memberQueries.push(args.query);
    const asked: Array<string> = anyValues(args.query["userId"]);

    return (data.members || [])
      .filter((id: string): boolean => {
        return asked.includes(id);
      })
      .map((id: string) => {
        return { userId: new ObjectID(id) };
      });
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockImplementation((async (args: { query: Query }) => {
      policyQueries.push(args.query);
      const asked: Array<string> = anyValues(args.query["_id"]);

      return (data.policies || [])
        .filter((id: string): boolean => {
          return asked.includes(id);
        })
        .map((id: string) => {
          return { _id: id };
        });
    }) as never);
}

function owners(
  value: unknown,
  checkOn: NotificationRuleConditionCheckOn = NotificationRuleConditionCheckOn.IncidentOwners,
): Record<string, unknown> {
  return {
    checkOn: checkOn,
    conditionType: ConditionType.ContainsAny,
    value: value,
  };
}

function policies(value: unknown): Record<string, unknown> {
  return {
    checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
    conditionType: ConditionType.ContainsAny,
    value: value,
  };
}

async function check(filters: unknown, keptIds?: Set<string>): Promise<void> {
  await NotificationRuleConditionIds.checkFilters({
    projectId: PROJECT_ID,
    filters: filters,
    keptIds: keptIds,
  });
}

beforeEach(() => {
  givenProject({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Which conditions are held to the project", () => {
  test("every owners condition and the On-Call Policy condition, and nothing else", () => {
    expect([...CHECKED_ID_CONDITIONS].sort()).toEqual(
      [
        ...OWNER_CHECK_ONS,
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      ].sort(),
    );
  });

  test("filters with no such condition read nothing", async () => {
    await check([
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.Contains,
        value: "not an id",
      },
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
        conditionType: ConditionType.ContainsAny,
        value: ["not-an-id-either"],
      },
    ]);
    await check(undefined);
    await check("filters");
    await check([null, 42, "x", [owners([JANE])]]);

    expect(teamQueries).toEqual([]);
    expect(memberQueries).toEqual([]);
    expect(policyQueries).toEqual([]);
  });

  test("tells whether written filters name such ids", () => {
    expect(NotificationRuleConditionIds.namesCheckedIds([owners([JANE])])).toBe(
      true,
    );
    expect(NotificationRuleConditionIds.namesCheckedIds([policies([])])).toBe(
      true,
    );
    expect(
      NotificationRuleConditionIds.namesCheckedIds([
        {
          checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
          value: "x",
        },
      ]),
    ).toBe(false);
    expect(NotificationRuleConditionIds.namesCheckedIds(undefined)).toBe(false);
  });

  test("reads the filters of a rule and of a summary as either was sent", () => {
    const filters: Array<unknown> = [owners([JANE])];

    expect(
      NotificationRuleConditionIds.getRuleFilters({ filters: filters }),
    ).toBe(filters);
    expect(NotificationRuleConditionIds.getRuleFilters(undefined)).toBe(
      undefined,
    );
    expect(NotificationRuleConditionIds.getRuleFilters([filters])).toBe(
      undefined,
    );
    expect(NotificationRuleConditionIds.getRuleFilters("rule")).toBe(undefined);
  });
});

describe("An id is an id", () => {
  test.each([
    ["a name", "jane"],
    ["a number", 42],
    ["an object", { _type: "ObjectID" }],
    ["blank text", " "],
    ["an id cut short", JANE.slice(0, 20)],
  ])(
    "refuses %s, naming the condition and the value",
    async (_what: string, value: unknown) => {
      const refusal: Promise<void> = check([owners([PLATFORM_TEAM, value])]);

      await expect(refusal).rejects.toThrow(BadDataException);
      await expect(check([owners([PLATFORM_TEAM, value])])).rejects.toThrow(
        `Invalid ID in the "Incident Owner" condition: ${JSON.stringify(
          value,
        )}. An ID is a UUID, such as "${EXAMPLE_UUID}".`,
      );
    },
  );

  test("names the condition the refused value is in", async () => {
    await expect(check([policies(["Payments Escalation"])])).rejects.toThrow(
      'Invalid ID in the "On-Call Policy" condition',
    );
    await expect(
      check([owners(["platform"], NotificationRuleConditionCheckOn.SloOwners)]),
    ).rejects.toThrow('Invalid ID in the "SLO Owner" condition');
  });

  test("writes each id as the database writes ids: lower case, hyphenated", async () => {
    givenProject({ teams: [PLATFORM_TEAM], members: [JANE] });

    const listed: Record<string, unknown> = owners([
      PLATFORM_TEAM.toUpperCase(),
      `{${JANE.replace(/-/g, "")}}`,
    ]);
    const single: Record<string, unknown> = owners(` ${JANE.toUpperCase()} `);

    await check([listed, single]);

    expect(listed["value"]).toEqual([PLATFORM_TEAM, JANE]);
    // One id saved as text stays one id, as text.
    expect(single["value"]).toBe(JANE);
  });

  test("reads an id in any case as the same id", () => {
    expect(toCanonicalId(JANE.toUpperCase())).toBe(JANE);
    expect(toCanonicalId(`{${JANE}}`)).toBe(JANE);
    expect(toCanonicalId(JANE.replace(/-/g, ""))).toBe(JANE);
    expect(toCanonicalId("  not an id ")).toBe("not an id");
  });

  test("an owners condition with nobody picked names no ids", async () => {
    await check([owners([]), owners(""), owners(null), owners(undefined)]);

    expect(teamQueries).toEqual([]);
    expect(memberQueries).toEqual([]);
  });
});

describe("People and teams are the project's", () => {
  test("accepts a team of the project and a member of it", async () => {
    givenProject({ teams: [PLATFORM_TEAM], members: [JANE] });

    await check([owners([PLATFORM_TEAM, JANE])]);

    // Asked of this project only: another project's teams are not found.
    expect(teamQueries).toHaveLength(1);
    expect(teamQueries[0]!["projectId"]).toEqual(PROJECT_ID);
    expect(anyValues(teamQueries[0]!["_id"]).sort()).toEqual(
      [PLATFORM_TEAM, JANE].sort(),
    );
    expect(memberQueries).toHaveLength(1);
    expect(memberQueries[0]!["projectId"]).toEqual(PROJECT_ID);
    // Only the ids that are not the project's teams are looked up as people.
    expect(anyValues(memberQueries[0]!["userId"])).toEqual([JANE]);
  });

  test("looks up no one as a person when every id is a team", async () => {
    givenProject({ teams: [PLATFORM_TEAM] });

    await check([owners([PLATFORM_TEAM])]);

    expect(memberQueries).toEqual([]);
  });

  test("refuses a person who is not in the project, naming the condition and the id", async () => {
    givenProject({ teams: [PLATFORM_TEAM], members: [JANE] });

    await expect(
      check([owners([PLATFORM_TEAM, JANE, STRANGER])]),
    ).rejects.toThrow(
      `The "Incident Owner" condition names a person or team that is not in this project: ${STRANGER}. Pick people and teams of the project.`,
    );
  });

  test("refuses a team since deleted when it is added now", async () => {
    givenProject({ teams: [PLATFORM_TEAM] });

    await expect(
      check([
        owners(
          [DELETED_TEAM],
          NotificationRuleConditionCheckOn.ScheduledMaintenanceOwners,
        ),
      ]),
    ).rejects.toThrow(
      `The "Scheduled Maintenance Owner" condition names a person or team that is not in this project: ${DELETED_TEAM}.`,
    );
  });

  test("checks each owners condition of the rule", async () => {
    givenProject({ teams: [PLATFORM_TEAM], members: [JANE] });

    await expect(
      check([
        owners([PLATFORM_TEAM]),
        owners([SAM], NotificationRuleConditionCheckOn.IncidentOwners),
      ]),
    ).rejects.toThrow(SAM);
  });
});

describe("Policies are the project's, and not archived", () => {
  test("accepts a policy of the project", async () => {
    givenProject({ policies: [PAYMENTS_POLICY] });

    await check([policies([PAYMENTS_POLICY])]);

    expect(policyQueries).toHaveLength(1);
    expect(policyQueries[0]!["projectId"]).toEqual(PROJECT_ID);
    // An archived policy pages no one, and no picker offers it for a new pick.
    expect(policyQueries[0]!["isArchived"]).toBe(false);
    // A policy is never looked up as a team or a person.
    expect(teamQueries).toEqual([]);
    expect(memberQueries).toEqual([]);
  });

  test("refuses a policy of another project, or an archived one", async () => {
    givenProject({ policies: [PAYMENTS_POLICY] });

    await expect(
      check([policies([PAYMENTS_POLICY, OTHER_PROJECT_POLICY])]),
    ).rejects.toThrow(
      `The "On-Call Policy" condition names an on-call policy that is not in this project, or is archived: ${OTHER_PROJECT_POLICY}. Pick one of the project's on-call policies.`,
    );
  });
});

describe("What a rule held before is kept", () => {
  test("a team since deleted, held before, is kept and not looked up", async () => {
    await check(
      [owners([DELETED_TEAM])],
      NotificationRuleConditionIds.getIdsNamed([owners([DELETED_TEAM])]),
    );

    expect(teamQueries).toEqual([]);
    expect(memberQueries).toEqual([]);
  });

  test("a policy archived since it was picked is kept", async () => {
    await check(
      [policies([OTHER_PROJECT_POLICY])],
      new Set([OTHER_PROJECT_POLICY]),
    );

    expect(policyQueries).toEqual([]);
  });

  test("an id held before is kept whatever case it is written in now", async () => {
    await check(
      [owners([DELETED_TEAM.toUpperCase()])],
      NotificationRuleConditionIds.getIdsNamed([owners([DELETED_TEAM])]),
    );

    expect(teamQueries).toEqual([]);
  });

  test("only the ids added now are looked up", async () => {
    givenProject({ members: [JANE] });

    await check([owners([DELETED_TEAM, JANE])], new Set([DELETED_TEAM]));

    expect(anyValues(teamQueries[0]!["_id"])).toEqual([JANE]);
  });

  test("names the ids the conditions held, as the database writes them", () => {
    expect(
      NotificationRuleConditionIds.getIdsNamed([
        owners([PLATFORM_TEAM.toUpperCase(), 42, ""]),
        policies(PAYMENTS_POLICY),
        {
          checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
          value: [JANE],
        },
      ]),
    ).toEqual(new Set([PLATFORM_TEAM, PAYMENTS_POLICY]));
    expect(NotificationRuleConditionIds.getIdsNamed(undefined).size).toBe(0);
  });
});

describe("A rule is held to it when it is written", () => {
  type Hook = (data: unknown) => Promise<unknown>;

  function hookOf(name: string): Hook {
    return (
      WorkspaceNotificationRuleService as unknown as Record<string, Hook>
    )[name]!.bind(WorkspaceNotificationRuleService);
  }

  function ruleData(filters: Array<unknown>): WorkspaceNotificationRule {
    const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    rule.projectId = PROJECT_ID;
    rule.name = "Platform incidents";
    rule.workspaceType = WorkspaceType.Slack;
    rule.eventType = NotificationRuleEventType.Incident;
    rule.notificationRule = {
      _type: "IncidentNotificationRule",
      filterCondition: FilterCondition.All,
      filters: filters as Array<NotificationRuleCondition>,
      shouldCreateNewChannel: true,
      newChannelTemplateName: "incident-",
    } as never;
    return rule;
  }

  const MEMBER_PROPS: Record<string, unknown> = {
    tenantId: PROJECT_ID,
    userId: new ObjectID(JANE),
  };

  test("a rule created through the API cannot name a stranger", async () => {
    givenProject({ teams: [PLATFORM_TEAM] });

    await expect(
      hookOf("onBeforeCreate")({
        data: ruleData([owners([PLATFORM_TEAM, STRANGER])]),
        props: MEMBER_PROPS,
      }),
    ).rejects.toThrow(STRANGER);
  });

  test("a rule created with the project's people saves them as the database writes ids", async () => {
    givenProject({ teams: [PLATFORM_TEAM], members: [JANE] });

    const data: WorkspaceNotificationRule = ruleData([
      owners([PLATFORM_TEAM.toUpperCase(), JANE]),
    ]);

    await hookOf("onBeforeCreate")({ data: data, props: MEMBER_PROPS });

    expect(
      (data.notificationRule as { filters: Array<{ value: unknown }> })
        .filters[0]!.value,
    ).toEqual([PLATFORM_TEAM, JANE]);
  });

  test("OneUptime's own writes are not held to it", async () => {
    await hookOf("onBeforeCreate")({
      data: ruleData([owners([STRANGER])]),
      props: { isRoot: true },
    });

    expect(teamQueries).toEqual([]);
  });

  describe("conditions written again", () => {
    beforeEach(() => {
      // The rule as it is stored: it names a team since deleted.
      const stored: WorkspaceNotificationRule = ruleData([
        owners([DELETED_TEAM]),
      ]);
      stored.id = ObjectID.generate();

      jest
        .spyOn(
          WorkspaceNotificationRuleService as unknown as {
            findRowsAndHoldUpdateToThem: () => Promise<unknown>;
          },
          "findRowsAndHoldUpdateToThem",
        )
        .mockResolvedValue([stored] as never);
    });

    test("keep what the rule named, found or not", async () => {
      await hookOf("onBeforeUpdate")({
        query: { _id: ObjectID.generate() },
        data: {
          notificationRule: ruleData([owners([DELETED_TEAM])]).notificationRule,
        },
        props: MEMBER_PROPS,
      });

      expect(teamQueries).toEqual([]);
    });

    test("cannot add a stranger", async () => {
      givenProject({ teams: [PLATFORM_TEAM] });

      await expect(
        hookOf("onBeforeUpdate")({
          query: { _id: ObjectID.generate() },
          data: {
            notificationRule: ruleData([owners([DELETED_TEAM, STRANGER])])
              .notificationRule,
          },
          props: MEMBER_PROPS,
        }),
      ).rejects.toThrow(STRANGER);
    });

    test("an update that leaves the conditions alone reads nothing", async () => {
      await hookOf("onBeforeUpdate")({
        query: { _id: ObjectID.generate() },
        data: { name: "Renamed" },
        props: MEMBER_PROPS,
      });

      expect(teamQueries).toEqual([]);
      expect(memberQueries).toEqual([]);
    });
  });
});

/*
 * A summary offers the conditions a rule does, so its owners condition is
 * held to the project the same way, when it is created or its conditions
 * are written again (WorkspaceNotificationSummaryService).
 */
describe("A summary is held to it too", () => {
  type Hook = (data: unknown) => Promise<unknown>;

  function hookOf(name: string): Hook {
    return (
      WorkspaceNotificationSummaryService as unknown as Record<string, Hook>
    )[name]!.bind(WorkspaceNotificationSummaryService);
  }

  function summaryData(filters: Array<unknown>): WorkspaceNotificationSummary {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary();
    summary.projectId = PROJECT_ID;
    summary.name = "Platform incidents this week";
    summary.channelNames = ["#ops"];
    summary.summaryItems = [WorkspaceNotificationSummaryItem.All];
    summary.filters = filters as Array<NotificationRuleCondition>;
    summary.filterCondition = FilterCondition.All;
    return summary;
  }

  const MEMBER_PROPS: Record<string, unknown> = {
    tenantId: PROJECT_ID,
    userId: new ObjectID(JANE),
  };

  test("a summary created through the API cannot name a stranger as an owner", async () => {
    givenProject({ teams: [PLATFORM_TEAM], members: [JANE] });

    await expect(
      hookOf("onBeforeCreate")({
        data: summaryData([owners([PLATFORM_TEAM, STRANGER])]),
        props: MEMBER_PROPS,
      }),
    ).rejects.toThrow(STRANGER);
    expect(memberQueries).toHaveLength(1);
  });

  test("an owner id that is not an id is refused, naming the condition", async () => {
    await expect(
      hookOf("onBeforeCreate")({
        data: summaryData([
          owners(["Platform"], NotificationRuleConditionCheckOn.AlertOwners),
        ]),
        props: MEMBER_PROPS,
      }),
    ).rejects.toThrow('Invalid ID in the "Alert Owner" condition');
  });

  test("OneUptime's own writes are not held to it", async () => {
    await hookOf("onBeforeCreate")({
      data: summaryData([owners([STRANGER])]),
      props: { isRoot: true },
    });

    expect(teamQueries).toEqual([]);
    expect(memberQueries).toEqual([]);
  });

  describe("conditions written again", () => {
    beforeEach(() => {
      // The summary as it is stored: it names a team since deleted.
      const stored: WorkspaceNotificationSummary = summaryData([
        owners([DELETED_TEAM]),
      ]);
      stored.id = ObjectID.generate();

      jest
        .spyOn(
          WorkspaceNotificationSummaryService as unknown as {
            findRowsAndHoldUpdateToThem: () => Promise<unknown>;
          },
          "findRowsAndHoldUpdateToThem",
        )
        .mockResolvedValue([stored] as never);
    });

    test("keep what the summary named, found or not", async () => {
      await hookOf("onBeforeUpdate")({
        query: { _id: ObjectID.generate() },
        data: { filters: [owners([DELETED_TEAM.toUpperCase()])] },
        props: MEMBER_PROPS,
      });

      expect(teamQueries).toEqual([]);
      expect(memberQueries).toEqual([]);
    });

    test("cannot add a stranger", async () => {
      givenProject({ teams: [PLATFORM_TEAM] });

      await expect(
        hookOf("onBeforeUpdate")({
          query: { _id: ObjectID.generate() },
          data: { filters: [owners([DELETED_TEAM, PLATFORM_TEAM, STRANGER])] },
          props: MEMBER_PROPS,
        }),
      ).rejects.toThrow(STRANGER);

      // Only the ids added now are looked up.
      expect(anyValues(teamQueries[0]!["_id"]).sort()).toEqual(
        [PLATFORM_TEAM, STRANGER].sort(),
      );
    });

    test("an update that leaves the conditions alone reads nothing", async () => {
      await hookOf("onBeforeUpdate")({
        query: { _id: ObjectID.generate() },
        data: { name: "Renamed" },
        props: MEMBER_PROPS,
      });

      expect(teamQueries).toEqual([]);
      expect(memberQueries).toEqual([]);
    });
  });
});
