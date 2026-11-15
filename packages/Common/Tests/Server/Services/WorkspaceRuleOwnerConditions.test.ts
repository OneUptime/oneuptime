import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerTeam from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyOwnerTeamService from "../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceOwnerTeamService, {
  Service as ScheduledMaintenanceOwnerTeamServiceClass,
} from "../../../Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService, {
  Service as ScheduledMaintenanceOwnerUserServiceClass,
} from "../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import { Service as WorkspaceNotificationSummaryServiceClass } from "../../../Server/Services/WorkspaceNotificationSummaryService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionValues,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { OwnedRecordKey } from "../../../Server/Utils/Workspace/WorkspaceRecordOwners";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A RULE THAT ASKS WHO OWNS A RECORD, OR WHICH POLICY IT IS (#7554, #7583).
 *
 * getMatchingNotificationRules is the seam every workspace notification goes
 * through: it reads the record a notification is for, the fields its rules
 * check, and keeps the rules whose conditions match. These tests stub the
 * reads and walk the new conditions through it:
 *
 * - "Incident Owner is any of Platform team, Jane" matches what the team or
 *   Jane owns, as recorded - Jane is not an owner of what her team owns;
 * - owners are read when a rule asks, each time: an owner added later
 *   counts from the next post (and the post that says so opens the channel
 *   of a rule that now matches - for a maintenance event, whose owner
 *   changes are not posted, its owner services check the rules again);
 * - an on-call rule names its policies by id, so a renamed policy still
 *   matches where a name typed with a typo never did;
 * - a summary's owners and Monitor Labels conditions read what they check.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const MAINTENANCE_ID: ObjectID = ObjectID.generate();
const POLICY_ID: ObjectID = ObjectID.generate();
const OTHER_POLICY_ID: ObjectID = ObjectID.generate();

const JANE: ObjectID = ObjectID.generate();
const SAM: ObjectID = ObjectID.generate();
const PLATFORM_TEAM: ObjectID = ObjectID.generate();
const PAYMENTS_TEAM: ObjectID = ObjectID.generate();

type OwnerRows = Array<Record<string, unknown>>;

function ruleOf(data: {
  name: string;
  eventType: NotificationRuleEventType;
  filters: Array<NotificationRuleCondition>;
  filterCondition?: FilterCondition | undefined;
}): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = ObjectID.generate();
  rule.projectId = PROJECT_ID;
  rule.name = data.name;
  rule.workspaceType = WorkspaceType.Slack;
  rule.eventType = data.eventType;
  rule.notificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: data.filterCondition || FilterCondition.All,
    filters: data.filters,
    shouldCreateNewChannel: true,
    newChannelTemplateName: "oneuptime-",
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
  } as never;
  return rule;
}

function ownersAre(
  checkOn: NotificationRuleConditionCheckOn,
  conditionType: ConditionType,
  picked: Array<ObjectID>,
): NotificationRuleCondition {
  return {
    checkOn: checkOn,
    conditionType: conditionType,
    value: picked.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

let rules: Array<WorkspaceNotificationRule>;

function givenRules(...given: Array<WorkspaceNotificationRule>): void {
  rules = given;
}

async function matchingRuleNames(data: {
  eventType: NotificationRuleEventType;
  notificationFor: NotificationFor;
}): Promise<Array<string>> {
  return (
    await WorkspaceNotificationRuleService.getMatchingNotificationRules({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      notificationRuleEventType: data.eventType,
      notificationFor: data.notificationFor,
    })
  ).map((rule: WorkspaceNotificationRule): string => {
    return rule.name || "";
  });
}

beforeEach(() => {
  rules = [];

  jest
    .spyOn(WorkspaceNotificationRuleService, "findBy")
    .mockImplementation((async (args: {
      query: { eventType: NotificationRuleEventType };
    }) => {
      return rules.filter((rule: WorkspaceNotificationRule): boolean => {
        return rule.eventType === args.query.eventType;
      });
    }) as never);

  jest.spyOn(MonitorService, "getLabelsForMonitors").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Incident Owner (#7583)", () => {
  let ownerUsers: OwnerRows;
  let ownerTeams: OwnerRows;
  let ownerReads: number;

  function incidentOwnedBy(data: {
    users?: Array<ObjectID>;
    teams?: Array<ObjectID>;
  }): void {
    ownerUsers = (data.users || []).map((userId: ObjectID) => {
      return { incidentId: INCIDENT_ID, userId: userId };
    });
    ownerTeams = (data.teams || []).map((teamId: ObjectID) => {
      return { incidentId: INCIDENT_ID, teamId: teamId };
    });
  }

  function incidentOwners(
    conditionType: ConditionType,
    picked: Array<ObjectID>,
  ): NotificationRuleCondition {
    return ownersAre(
      NotificationRuleConditionCheckOn.IncidentOwners,
      conditionType,
      picked,
    );
  }

  async function incidentRulesMatching(): Promise<Array<string>> {
    return matchingRuleNames({
      eventType: NotificationRuleEventType.Incident,
      notificationFor: { incidentId: INCIDENT_ID },
    });
  }

  beforeEach(() => {
    ownerReads = 0;
    incidentOwnedBy({});

    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident.title = "Database down";
    incident.description = "Writes fail.";
    incident.labels = [];
    incident.monitors = [];

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);

    jest
      .spyOn(IncidentOwnerUserService, "findAllBy")
      .mockImplementation((async () => {
        ownerReads++;
        return ownerUsers;
      }) as never);
    jest
      .spyOn(IncidentOwnerTeamService, "findAllBy")
      .mockImplementation((async () => {
        ownerReads++;
        return ownerTeams;
      }) as never);
  });

  test("matches an incident a person picked owns", async () => {
    incidentOwnedBy({ users: [JANE, SAM] });
    givenRules(
      ruleOf({
        name: "Jane's incidents",
        eventType: NotificationRuleEventType.Incident,
        filters: [incidentOwners(ConditionType.ContainsAny, [JANE])],
      }),
      ruleOf({
        name: "Payments incidents",
        eventType: NotificationRuleEventType.Incident,
        filters: [incidentOwners(ConditionType.ContainsAny, [PAYMENTS_TEAM])],
      }),
    );

    expect(await incidentRulesMatching()).toEqual(["Jane's incidents"]);
  });

  test("matches an incident a team picked owns", async () => {
    incidentOwnedBy({ teams: [PLATFORM_TEAM] });
    givenRules(
      ruleOf({
        name: "Platform or Jane",
        eventType: NotificationRuleEventType.Incident,
        filters: [
          incidentOwners(ConditionType.ContainsAny, [PLATFORM_TEAM, JANE]),
        ],
      }),
    );

    expect(await incidentRulesMatching()).toEqual(["Platform or Jane"]);
  });

  test("does not count a member of the owning team as an owner", async () => {
    // The Platform team owns the incident; Jane is in the team.
    incidentOwnedBy({ teams: [PLATFORM_TEAM] });
    givenRules(
      ruleOf({
        name: "Jane's incidents",
        eventType: NotificationRuleEventType.Incident,
        filters: [incidentOwners(ConditionType.ContainsAny, [JANE])],
      }),
    );

    expect(await incidentRulesMatching()).toEqual([]);
  });

  test("'is none of' keeps an incident none of the picks owns", async () => {
    incidentOwnedBy({ users: [SAM] });
    givenRules(
      ruleOf({
        name: "Not Platform's",
        eventType: NotificationRuleEventType.Incident,
        filters: [
          incidentOwners(ConditionType.NotContains, [PLATFORM_TEAM, JANE]),
        ],
      }),
    );

    expect(await incidentRulesMatching()).toEqual(["Not Platform's"]);

    incidentOwnedBy({ users: [SAM], teams: [PLATFORM_TEAM] });

    expect(await incidentRulesMatching()).toEqual([]);
  });

  test("an incident with no owners matches 'is none of' and never 'is any of'", async () => {
    givenRules(
      ruleOf({
        name: "Any of",
        eventType: NotificationRuleEventType.Incident,
        filters: [incidentOwners(ConditionType.ContainsAny, [JANE])],
      }),
      ruleOf({
        name: "None of",
        eventType: NotificationRuleEventType.Incident,
        filters: [incidentOwners(ConditionType.NotContains, [JANE])],
      }),
    );

    expect(await incidentRulesMatching()).toEqual(["None of"]);
  });

  test("an owner added later counts from the next post", async () => {
    givenRules(
      ruleOf({
        name: "Platform incidents",
        eventType: NotificationRuleEventType.Incident,
        filters: [incidentOwners(ConditionType.ContainsAny, [PLATFORM_TEAM])],
      }),
    );

    expect(await incidentRulesMatching()).toEqual([]);

    incidentOwnedBy({ teams: [PLATFORM_TEAM] });

    expect(await incidentRulesMatching()).toEqual(["Platform incidents"]);
  });

  test("combines with the incident's own fields", async () => {
    incidentOwnedBy({ teams: [PLATFORM_TEAM] });
    givenRules(
      ruleOf({
        name: "Platform database incidents",
        eventType: NotificationRuleEventType.Incident,
        filters: [
          incidentOwners(ConditionType.ContainsAny, [PLATFORM_TEAM]),
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
            conditionType: ConditionType.Contains,
            value: "Database",
          },
        ],
      }),
      ruleOf({
        name: "Platform checkout incidents",
        eventType: NotificationRuleEventType.Incident,
        filters: [
          incidentOwners(ConditionType.ContainsAny, [PLATFORM_TEAM]),
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
            conditionType: ConditionType.Contains,
            value: "Checkout",
          },
        ],
      }),
    );

    expect(await incidentRulesMatching()).toEqual([
      "Platform database incidents",
    ]);
  });

  test("reads no owners when no rule asks who owns the incident", async () => {
    incidentOwnedBy({ users: [JANE] });
    givenRules(
      ruleOf({
        name: "Database incidents",
        eventType: NotificationRuleEventType.Incident,
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
            conditionType: ConditionType.Contains,
            value: "Database",
          },
        ],
      }),
    );

    expect(await incidentRulesMatching()).toEqual(["Database incidents"]);
    expect(ownerReads).toBe(0);
  });

  test("reads the owners once for all the rules that ask", async () => {
    incidentOwnedBy({ users: [JANE] });
    givenRules(
      ruleOf({
        name: "Jane's",
        eventType: NotificationRuleEventType.Incident,
        filters: [incidentOwners(ConditionType.ContainsAny, [JANE])],
      }),
      ruleOf({
        name: "Not Sam's",
        eventType: NotificationRuleEventType.Incident,
        filters: [incidentOwners(ConditionType.NotContains, [SAM])],
      }),
    );

    expect(await incidentRulesMatching()).toEqual(["Jane's", "Not Sam's"]);
    // One read of the people, one of the teams.
    expect(ownerReads).toBe(2);
  });

  test("an owners condition of another kind of record never matches an incident", async () => {
    incidentOwnedBy({ users: [JANE] });
    givenRules(
      ruleOf({
        name: "Alert owners, on an incident rule",
        eventType: NotificationRuleEventType.Incident,
        filters: [
          ownersAre(
            NotificationRuleConditionCheckOn.AlertOwners,
            ConditionType.ContainsAny,
            [JANE],
          ),
        ],
      }),
    );

    expect(await incidentRulesMatching()).toEqual([]);
  });
});

describe("On-Call Policy (#7554)", () => {
  let policyName: string;

  function policyRule(
    name: string,
    filters: Array<NotificationRuleCondition>,
  ): WorkspaceNotificationRule {
    return ruleOf({
      name: name,
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      filters: filters,
    });
  }

  function policiesAre(
    conditionType: ConditionType,
    picked: Array<ObjectID>,
  ): NotificationRuleCondition {
    return {
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      conditionType: conditionType,
      value: picked.map((id: ObjectID): string => {
        return id.toString();
      }),
    };
  }

  async function policyRulesMatching(): Promise<Array<string>> {
    return matchingRuleNames({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationFor: { onCallDutyPolicyId: POLICY_ID },
    });
  }

  beforeEach(() => {
    policyName = "Payments Escalation";

    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockImplementation((async () => {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy.id = POLICY_ID;
        policy.name = policyName;
        policy.description = "Pages the payments team.";
        policy.labels = [] as Array<Label>;
        return policy;
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyOwnerUserService, "findAllBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(OnCallDutyPolicyOwnerTeamService, "findAllBy")
      .mockResolvedValue([
        { onCallDutyPolicyId: POLICY_ID, teamId: PAYMENTS_TEAM },
      ] as never);
  });

  test("matches the policy picked, and not another", async () => {
    givenRules(
      policyRule("Payments policy", [
        policiesAre(ConditionType.ContainsAny, [POLICY_ID]),
      ]),
      policyRule("Search policy", [
        policiesAre(ConditionType.ContainsAny, [OTHER_POLICY_ID]),
      ]),
    );

    expect(await policyRulesMatching()).toEqual(["Payments policy"]);
  });

  test("keeps matching the policy after it is renamed, where its old name does not", async () => {
    givenRules(
      policyRule("Picked", [
        policiesAre(ConditionType.ContainsAny, [POLICY_ID]),
      ]),
      policyRule("By its old name", [
        {
          checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
          conditionType: ConditionType.EqualTo,
          value: "Payments Escalation",
        },
      ]),
    );

    expect(await policyRulesMatching()).toEqual(["Picked", "By its old name"]);

    policyName = "Payments Escalation (EU)";

    expect(await policyRulesMatching()).toEqual(["Picked"]);
  });

  test("a name typed with a typo matches nothing; the policy picked does", async () => {
    givenRules(
      policyRule("Typed", [
        {
          checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
          conditionType: ConditionType.EqualTo,
          value: "Payment Escalation",
        },
      ]),
      policyRule("Picked", [
        policiesAre(ConditionType.ContainsAny, [POLICY_ID]),
      ]),
    );

    expect(await policyRulesMatching()).toEqual(["Picked"]);
  });

  test("'is none of' leaves the policies picked out", async () => {
    givenRules(
      policyRule("Every policy but Payments", [
        policiesAre(ConditionType.NotContains, [POLICY_ID]),
      ]),
      policyRule("Every policy but Search", [
        policiesAre(ConditionType.NotContains, [OTHER_POLICY_ID]),
      ]),
    );

    expect(await policyRulesMatching()).toEqual(["Every policy but Search"]);
  });

  test("matches a policy by who owns it", async () => {
    givenRules(
      policyRule("Owned by Payments", [
        ownersAre(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyOwners,
          ConditionType.ContainsAny,
          [PAYMENTS_TEAM],
        ),
      ]),
      policyRule("Owned by Platform", [
        ownersAre(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyOwners,
          ConditionType.ContainsAny,
          [PLATFORM_TEAM],
        ),
      ]),
    );

    expect(await policyRulesMatching()).toEqual(["Owned by Payments"]);
  });

  test("a notification about another record never carries a policy", async () => {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident.title = "Database down";
    incident.labels = [];
    incident.monitors = [];

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);

    givenRules(
      ruleOf({
        name: "Policy condition on an incident rule",
        eventType: NotificationRuleEventType.Incident,
        filters: [policiesAre(ConditionType.ContainsAny, [POLICY_ID])],
      }),
    );

    // An incident paged by the policy names it, but is not the policy.
    expect(
      await matchingRuleNames({
        eventType: NotificationRuleEventType.Incident,
        notificationFor: {
          incidentId: INCIDENT_ID,
          onCallDutyPolicyId: POLICY_ID,
        },
      }),
    ).toEqual([]);
  });
});

describe("Scheduled Maintenance Owner (#7583)", () => {
  let ownerTeams: OwnerRows;

  beforeEach(() => {
    ownerTeams = [];

    const maintenance: ScheduledMaintenance = new ScheduledMaintenance();
    maintenance.id = MAINTENANCE_ID;
    maintenance.title = "Database upgrade";
    maintenance.labels = [];
    maintenance.monitors = [];

    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(maintenance as never);
    jest
      .spyOn(ScheduledMaintenanceOwnerUserService, "findAllBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ScheduledMaintenanceOwnerTeamService, "findAllBy")
      .mockImplementation((async () => {
        return ownerTeams;
      }) as never);
  });

  test("matches the event once its owning team is added", async () => {
    givenRules(
      ruleOf({
        name: "Platform maintenance",
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        filters: [
          ownersAre(
            NotificationRuleConditionCheckOn.ScheduledMaintenanceOwners,
            ConditionType.ContainsAny,
            [PLATFORM_TEAM],
          ),
        ],
      }),
    );

    const forMaintenance: {
      eventType: NotificationRuleEventType;
      notificationFor: NotificationFor;
    } = {
      eventType: NotificationRuleEventType.ScheduledMaintenance,
      notificationFor: { scheduledMaintenanceId: MAINTENANCE_ID },
    };

    expect(await matchingRuleNames(forMaintenance)).toEqual([]);

    ownerTeams = [
      { scheduledMaintenanceId: MAINTENANCE_ID, teamId: PLATFORM_TEAM },
    ];

    expect(await matchingRuleNames(forMaintenance)).toEqual([
      "Platform maintenance",
    ]);
  });
});

describe("A change of owners checks the rules again", () => {
  let checked: Array<NotificationFor>;

  beforeEach(() => {
    checked = [];

    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "createChannelsForRulesThatNowMatch",
      )
      .mockImplementation((async (data: {
        notificationFor: NotificationFor;
      }) => {
        checked.push(data.notificationFor);
        return [];
      }) as never);
  });

  function ownerRow<
    T extends ScheduledMaintenanceOwnerUser | ScheduledMaintenanceOwnerTeam,
  >(row: T, maintenanceId: ObjectID | undefined): T {
    row.projectId = PROJECT_ID;

    if (maintenanceId) {
      row.scheduledMaintenanceId = maintenanceId;
    }

    return row;
  }

  test("a maintenance event's rules, once an event, whoever changed", async () => {
    const other: ObjectID = ObjectID.generate();

    await ScheduledMaintenanceOwnerUserServiceClass.checkRulesAgain([
      ownerRow(new ScheduledMaintenanceOwnerUser(), MAINTENANCE_ID),
      ownerRow(new ScheduledMaintenanceOwnerUser(), MAINTENANCE_ID),
      ownerRow(new ScheduledMaintenanceOwnerUser(), other),
      ownerRow(new ScheduledMaintenanceOwnerUser(), undefined),
    ]);

    expect(checked).toEqual([
      { scheduledMaintenanceId: MAINTENANCE_ID },
      { scheduledMaintenanceId: other },
    ]);

    checked = [];

    await ScheduledMaintenanceOwnerTeamServiceClass.checkRulesAgain([
      ownerRow(new ScheduledMaintenanceOwnerTeam(), MAINTENANCE_ID),
      ownerRow(new ScheduledMaintenanceOwnerTeam(), MAINTENANCE_ID),
    ]);

    expect(checked).toEqual([{ scheduledMaintenanceId: MAINTENANCE_ID }]);
  });

  describe("a maintenance event's owner added or removed", () => {
    beforeEach(() => {
      jest
        .spyOn(
          ScheduledMaintenanceFeedService,
          "createScheduledMaintenanceFeedItem",
        )
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockResolvedValue("Jane" as never);
      jest.spyOn(UserService, "findOneById").mockResolvedValue({
        name: "Jane",
        email: "jane@example.com",
      } as never);
      jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
        const team: Team = new Team();
        team.name = "Platform";
        return team;
      }) as never);
      jest
        .spyOn(
          WorkspaceNotificationRuleService,
          "getNotificationRulesWhereInviteOwnersIsTrue",
        )
        .mockResolvedValue([] as never);
      jest
        .spyOn(
          ScheduledMaintenanceService,
          "getWorkspaceChannelForScheduledMaintenance",
        )
        .mockResolvedValue([] as never);
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
    });

    test("a person added", async () => {
      const row: ScheduledMaintenanceOwnerUser = ownerRow(
        new ScheduledMaintenanceOwnerUser(),
        MAINTENANCE_ID,
      );
      row.userId = JANE;

      await ScheduledMaintenanceOwnerUserService.onCreateSuccess(
        { createBy: { data: row, props: {} } } as never,
        row,
      );

      expect(checked).toEqual([{ scheduledMaintenanceId: MAINTENANCE_ID }]);
    });

    test("a team added", async () => {
      const row: ScheduledMaintenanceOwnerTeam = ownerRow(
        new ScheduledMaintenanceOwnerTeam(),
        MAINTENANCE_ID,
      );
      row.teamId = PLATFORM_TEAM;

      await ScheduledMaintenanceOwnerTeamService.onCreateSuccess(
        { createBy: { data: row, props: {} } } as never,
        row,
      );

      expect(checked).toEqual([{ scheduledMaintenanceId: MAINTENANCE_ID }]);
    });

    test("a person and a team removed", async () => {
      type DeleteHook = (
        onDelete: unknown,
        ids: Array<ObjectID>,
      ) => Promise<unknown>;

      const user: ScheduledMaintenanceOwnerUser = ownerRow(
        new ScheduledMaintenanceOwnerUser(),
        MAINTENANCE_ID,
      );
      user.userId = JANE;

      await (
        ScheduledMaintenanceOwnerUserService as unknown as {
          onDeleteSuccess: DeleteHook;
        }
      ).onDeleteSuccess(
        {
          deleteBy: { query: {}, props: {} },
          carryForward: { itemsToDelete: [user] },
        },
        [],
      );

      const team: ScheduledMaintenanceOwnerTeam = ownerRow(
        new ScheduledMaintenanceOwnerTeam(),
        MAINTENANCE_ID,
      );
      team.teamId = PLATFORM_TEAM;

      await (
        ScheduledMaintenanceOwnerTeamService as unknown as {
          onDeleteSuccess: DeleteHook;
        }
      ).onDeleteSuccess(
        {
          deleteBy: { query: {}, props: {} },
          carryForward: { itemsToDelete: [team] },
        },
        [],
      );

      expect(checked).toEqual([
        { scheduledMaintenanceId: MAINTENANCE_ID },
        { scheduledMaintenanceId: MAINTENANCE_ID },
      ]);
    });
  });

  test("an incident's owner added is posted, which checks the rules on the way", async () => {
    const posts: Array<Record<string, unknown>> = [];

    jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
      const team: Team = new Team();
      team.name = "Platform";
      return team;
    }) as never);
    jest
      .spyOn(IncidentService, "getIncidentNumber")
      .mockResolvedValue({ number: 7, numberWithPrefix: "INC-7" } as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue("https://oneuptime.example/incident" as never);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: Record<string, unknown>) => {
        posts.push(data);
      }) as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getNotificationRulesWhereInviteOwnersIsTrue",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentService, "getWorkspaceChannelForIncident")
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "inviteTeamsBasedOnRulesAndWorkspaceChannels",
      )
      .mockResolvedValue(undefined as never);

    const row: Record<string, unknown> = {
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      teamId: PLATFORM_TEAM,
    };

    await IncidentOwnerTeamService.onCreateSuccess(
      { createBy: { data: row, props: {} } } as never,
      row as never,
    );

    expect(posts).toHaveLength(1);
    expect(posts[0]!["workspaceNotification"]).toMatchObject({
      sendWorkspaceNotification: true,
    });
  });
});

describe("A summary's conditions read what they check", () => {
  type FilterItems = (data: {
    items: Array<Incident>;
    filters: Array<NotificationRuleCondition> | undefined;
    filterCondition: FilterCondition | undefined;
    projectId: ObjectID;
    recordKey: OwnedRecordKey;
    ownerCheckOn: NotificationRuleConditionCheckOn;
    getMonitorIds?: ((item: Incident) => Array<string>) | undefined;
    buildValues: (
      item: Incident,
      read: Partial<NotificationRuleConditionValues>,
    ) => NotificationRuleConditionValues;
  }) => Promise<Array<Incident>>;

  const summary: {
    filterItems: FilterItems;
    buildIncidentValues: (
      incident: Incident,
      read?: Partial<NotificationRuleConditionValues>,
    ) => NotificationRuleConditionValues;
  } = WorkspaceNotificationSummaryServiceClass as unknown as {
    filterItems: FilterItems;
    buildIncidentValues: (
      incident: Incident,
      read?: Partial<NotificationRuleConditionValues>,
    ) => NotificationRuleConditionValues;
  };

  const API_MONITOR: ObjectID = ObjectID.generate();
  const WEB_MONITOR: ObjectID = ObjectID.generate();
  const PRODUCTION_LABEL: ObjectID = ObjectID.generate();

  let ownerReads: number;
  let monitorReads: number;

  function incident(title: string, monitorIds: Array<ObjectID>): Incident {
    const model: Incident = new Incident();
    model.id = ObjectID.generate();
    model.title = title;
    model.labels = [];
    model.monitors = monitorIds.map((monitorId: ObjectID): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor.id = monitorId;
      return monitor;
    });
    return model;
  }

  const ownedByPlatform: Incident = incident("Database down", [API_MONITOR]);
  const ownedByJane: Incident = incident("Checkout slow", [WEB_MONITOR]);
  const unowned: Incident = incident("Search errors", []);

  async function kept(
    filters: Array<NotificationRuleCondition>,
  ): Promise<Array<string>> {
    return (
      await summary.filterItems({
        items: [ownedByPlatform, ownedByJane, unowned],
        filters: filters,
        filterCondition: FilterCondition.All,
        projectId: PROJECT_ID,
        recordKey: "incidentId",
        ownerCheckOn: NotificationRuleConditionCheckOn.IncidentOwners,
        getMonitorIds: (item: Incident): Array<string> => {
          return (item.monitors || []).map((monitor: Monitor): string => {
            return monitor.id!.toString();
          });
        },
        buildValues: summary.buildIncidentValues,
      })
    ).map((item: Incident): string => {
      return item.title || "";
    });
  }

  beforeEach(() => {
    ownerReads = 0;
    monitorReads = 0;

    jest
      .spyOn(IncidentOwnerUserService, "findAllBy")
      .mockImplementation((async () => {
        ownerReads++;
        return [{ incidentId: ownedByJane.id, userId: JANE }];
      }) as never);
    jest
      .spyOn(IncidentOwnerTeamService, "findAllBy")
      .mockImplementation((async () => {
        ownerReads++;
        return [{ incidentId: ownedByPlatform.id, teamId: PLATFORM_TEAM }];
      }) as never);
    jest.spyOn(MonitorService, "findAllBy").mockImplementation((async () => {
      monitorReads++;
      const api: Monitor = new Monitor();
      api._id = API_MONITOR.toString();
      const production: Label = new Label();
      production._id = PRODUCTION_LABEL.toString();
      api.labels = [production];
      const web: Monitor = new Monitor();
      web._id = WEB_MONITOR.toString();
      web.labels = [];
      return [api, web];
    }) as never);
  });

  test("keeps the incidents the people and teams picked own", async () => {
    expect(
      await kept([
        ownersAre(
          NotificationRuleConditionCheckOn.IncidentOwners,
          ConditionType.ContainsAny,
          [PLATFORM_TEAM, JANE],
        ),
      ]),
    ).toEqual(["Database down", "Checkout slow"]);
    // Every incident's owners in one read of each table.
    expect(ownerReads).toBe(2);
  });

  test("'is none of' keeps the incidents none of them owns", async () => {
    expect(
      await kept([
        ownersAre(
          NotificationRuleConditionCheckOn.IncidentOwners,
          ConditionType.NotContains,
          [PLATFORM_TEAM],
        ),
      ]),
    ).toEqual(["Checkout slow", "Search errors"]);
  });

  test("keeps the incidents whose monitors have the label picked", async () => {
    expect(
      await kept([
        {
          checkOn: NotificationRuleConditionCheckOn.MonitorLabels,
          conditionType: ConditionType.ContainsAny,
          value: [PRODUCTION_LABEL.toString()],
        },
      ]),
    ).toEqual(["Database down"]);
    expect(monitorReads).toBe(1);
    expect(ownerReads).toBe(0);
  });

  test("reads neither owners nor monitors for a summary that asks neither", async () => {
    expect(
      await kept([
        {
          checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
          conditionType: ConditionType.Contains,
          value: "Database",
        },
      ]),
    ).toEqual(["Database down"]);
    expect(ownerReads).toBe(0);
    expect(monitorReads).toBe(0);
  });

  test("keeps every incident for a summary without conditions", async () => {
    expect(await kept([])).toEqual([
      "Database down",
      "Checkout slow",
      "Search errors",
    ]);
    expect(ownerReads).toBe(0);
  });
});
