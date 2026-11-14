import FilterCondition from "../../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  getCheckOnLabel,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
  NotificationRuleConditionValues,
  OWNER_CHECK_ON_BY_EVENT_TYPE,
  OWNER_CHECK_ONS,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { WorkspaceNotificationRuleUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, it } from "@jest/globals";

/*
 * WHO OWNS A RECORD, AND WHICH ON-CALL POLICY IT IS (#7554, #7582, #7583).
 *
 * A rule's conditions gained:
 *
 * - an owners condition for every kind of record with owners - "Incident
 *   Owner is any of Platform team, Jane" - whose value is people's and
 *   teams' ids in one list, matched against the owners as recorded;
 * - an on-call rule's On-Call Policy condition, the policies picked from
 *   the project's and stored by id, so a renamed policy is still the one
 *   it names - a name typed with a typo matched nothing, silently;
 * - archived values left out of every value list for a new pick, and kept,
 *   marked, where a condition holds one already.
 *
 * What the rule stores is pinned here as well as what it does: a stored
 * field name that changed would leave every saved rule matching nothing.
 */

const JANE: string = "0b6d1d5e-1a7c-4f4e-9a52-1f1b7d4d6c01";
const SAM: string = "0b6d1d5e-1a7c-4f4e-9a52-1f1b7d4d6c02";
const PLATFORM_TEAM: string = "5f0c6a1e-2b8d-4c3a-8e71-7a2b9c0d1e01";
const PAYMENTS_TEAM: string = "5f0c6a1e-2b8d-4c3a-8e71-7a2b9c0d1e02";

const PAYMENTS_POLICY: string = "7a1e0c5f-3d2b-4a9c-b8e7-6f5d4c3b2a01";
const SEARCH_POLICY: string = "7a1e0c5f-3d2b-4a9c-b8e7-6f5d4c3b2a02";
const OLD_POLICY: string = "7a1e0c5f-3d2b-4a9c-b8e7-6f5d4c3b2a03";

// Every kind of record with owners, and its owners field.
const OWNER_FIELDS: Array<
  [NotificationRuleEventType, NotificationRuleConditionCheckOn, string]
> = [
  [
    NotificationRuleEventType.Incident,
    NotificationRuleConditionCheckOn.IncidentOwners,
    "Incident Owner",
  ],
  [
    NotificationRuleEventType.Alert,
    NotificationRuleConditionCheckOn.AlertOwners,
    "Alert Owner",
  ],
  [
    NotificationRuleEventType.IncidentEpisode,
    NotificationRuleConditionCheckOn.IncidentEpisodeOwners,
    "Incident Episode Owner",
  ],
  [
    NotificationRuleEventType.AlertEpisode,
    NotificationRuleConditionCheckOn.AlertEpisodeOwners,
    "Alert Episode Owner",
  ],
  [
    NotificationRuleEventType.ScheduledMaintenance,
    NotificationRuleConditionCheckOn.ScheduledMaintenanceOwners,
    "Scheduled Maintenance Owner",
  ],
  [
    NotificationRuleEventType.Monitor,
    NotificationRuleConditionCheckOn.MonitorOwners,
    "Monitor Owner",
  ],
  [
    NotificationRuleEventType.OnCallDutyPolicy,
    NotificationRuleConditionCheckOn.OnCallDutyPolicyOwners,
    "On-Call Policy Owner",
  ],
  [
    NotificationRuleEventType.ServiceLevelObjective,
    NotificationRuleConditionCheckOn.SloOwners,
    "SLO Owner",
  ],
];

function rule(
  filters: Array<NotificationRuleCondition>,
  filterCondition: FilterCondition = FilterCondition.All,
): IncidentNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    filterCondition: filterCondition,
    filters: filters,
    shouldCreateNewChannel: true,
    newChannelTemplateName: "incident-",
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    inviteTeamsToNewChannel: [],
    inviteUsersToNewChannel: [],
    shouldInviteOwnersToNewChannel: false,
    archiveChannelAutomatically: false,
    shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
  } as unknown as IncidentNotificationRule;
}

function matches(data: {
  filters: Array<NotificationRuleCondition>;
  values: Partial<NotificationRuleConditionValues>;
  filterCondition?: FilterCondition;
}): boolean {
  return WorkspaceNotificationRuleUtil.isRuleMatching({
    notificationRule: rule(data.filters, data.filterCondition),
    values: NotificationRuleConditionUtil.getValues(data.values),
  });
}

function ownersAre(
  conditionType: ConditionType,
  picked: Array<string>,
): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.IncidentOwners,
    conditionType: conditionType,
    value: picked,
  };
}

function policy(data: {
  id: string;
  name: string;
  isArchived?: boolean | undefined;
}): OnCallDutyPolicy {
  const model: OnCallDutyPolicy = new OnCallDutyPolicy();
  model._id = data.id;
  model.name = data.name;

  if (data.isArchived !== undefined) {
    model.isArchived = data.isArchived;
  }

  return model;
}

function severity(data: {
  id: string;
  name: string;
  isArchived?: boolean | undefined;
}): IncidentSeverity {
  const model: IncidentSeverity = new IncidentSeverity();
  model._id = data.id;
  model.name = data.name;

  if (data.isArchived !== undefined) {
    model.isArchived = data.isArchived;
  }

  return model;
}

function optionsFor(data: {
  checkOn: NotificationRuleConditionCheckOn;
  onCallDutyPolicies?: Array<OnCallDutyPolicy>;
  incidentSeverities?: Array<IncidentSeverity>;
  monitors?: Array<Monitor>;
  labels?: Array<Label>;
  serviceLevelObjectives?: Array<ServiceLevelObjective>;
  keptIds?: Array<string>;
}): Array<DropdownOption> {
  return NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
    alertSeverities: [],
    alertStates: [],
    incidentSeverities: data.incidentSeverities || [],
    monitorStatus: [],
    incidentStates: [],
    scheduledMaintenanceStates: [],
    labels: data.labels || [],
    monitors: data.monitors || [],
    serviceLevelObjectives: data.serviceLevelObjectives,
    onCallDutyPolicies: data.onCallDutyPolicies,
    keptIds: data.keptIds,
    checkOn: data.checkOn,
  });
}

describe("What a rule stores for the new conditions", () => {
  it("names each field as it is stored, so a saved rule keeps matching", () => {
    expect(NotificationRuleConditionCheckOn.OnCallDutyPolicies).toBe(
      "On-Call Policy",
    );

    for (const [, checkOn, stored] of OWNER_FIELDS) {
      expect(checkOn).toBe(stored);
    }
  });

  it("shows each field by the words it is stored with", () => {
    expect(
      getCheckOnLabel(NotificationRuleConditionCheckOn.OnCallDutyPolicies),
    ).toBe("On-Call Policy");

    for (const [, checkOn, stored] of OWNER_FIELDS) {
      expect(getCheckOnLabel(checkOn)).toBe(stored);
    }
  });

  it("gives every kind of record with owners its owners field, and no other kind one", () => {
    for (const [eventType, checkOn] of OWNER_FIELDS) {
      expect(OWNER_CHECK_ON_BY_EVENT_TYPE[eventType]).toBe(checkOn);
    }

    // A security case and a hunt have no owners.
    expect(
      OWNER_CHECK_ON_BY_EVENT_TYPE[NotificationRuleEventType.SecurityCase],
    ).toBeUndefined();
    expect(
      OWNER_CHECK_ON_BY_EVENT_TYPE[NotificationRuleEventType.SecurityHunt],
    ).toBeUndefined();

    expect([...OWNER_CHECK_ONS].sort()).toEqual(
      OWNER_FIELDS.map(
        (
          entry: [
            NotificationRuleEventType,
            NotificationRuleConditionCheckOn,
            string,
          ],
        ): string => {
          return entry[1];
        },
      ).sort(),
    );
  });
});

describe("The Conditions step's field list", () => {
  it.each(OWNER_FIELDS)(
    "a %s rule offers its owners field once, and no other kind's",
    (
      eventType: NotificationRuleEventType,
      checkOn: NotificationRuleConditionCheckOn,
    ) => {
      const fields: Array<NotificationRuleConditionCheckOn> =
        NotificationRuleConditionUtil.getCheckOnByEventType(eventType);

      expect(
        fields.filter((field: NotificationRuleConditionCheckOn): boolean => {
          return field === checkOn;
        }),
      ).toHaveLength(1);

      for (const other of OWNER_CHECK_ONS) {
        if (other !== checkOn) {
          expect(fields).not.toContain(other);
        }
      }
    },
  );

  it("offers no owners field to a security case or a hunt", () => {
    for (const eventType of [
      NotificationRuleEventType.SecurityCase,
      NotificationRuleEventType.SecurityHunt,
    ]) {
      const fields: Array<NotificationRuleConditionCheckOn> =
        NotificationRuleConditionUtil.getCheckOnByEventType(eventType);

      for (const checkOn of OWNER_CHECK_ONS) {
        expect(fields).not.toContain(checkOn);
      }
    }
  });

  it("an on-call rule starts on picking its policies, and keeps the name and description conditions", () => {
    const fields: Array<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.OnCallDutyPolicy,
      );

    expect(fields[0]).toBe(NotificationRuleConditionCheckOn.OnCallDutyPolicies);
    expect(fields).toContain(
      NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
    );
    expect(fields).toContain(
      NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
    );
  });

  it("offers the On-Call Policy condition to no other kind of rule", () => {
    for (const eventType of Object.values(NotificationRuleEventType)) {
      if (eventType === NotificationRuleEventType.OnCallDutyPolicy) {
        continue;
      }

      expect(
        NotificationRuleConditionUtil.getCheckOnByEventType(eventType),
      ).not.toContain(NotificationRuleConditionCheckOn.OnCallDutyPolicies);
    }
  });
});

describe("How the new conditions compare", () => {
  it.each(OWNER_FIELDS)(
    "a %s rule's owners are any of, or none of, the people and teams picked",
    (
      _eventType: NotificationRuleEventType,
      checkOn: NotificationRuleConditionCheckOn,
    ) => {
      expect(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(checkOn),
      ).toEqual([ConditionType.ContainsAny, ConditionType.NotContains]);
    },
  );

  it("an on-call rule's policies are any of, or none of, the ones picked", () => {
    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      ),
    ).toEqual([ConditionType.ContainsAny, ConditionType.NotContains]);
  });

  it("picks owners with the people picker and policies from a list", () => {
    for (const checkOn of OWNER_CHECK_ONS) {
      expect(NotificationRuleConditionUtil.isOwnerCheckOn(checkOn)).toBe(true);
      expect(
        NotificationRuleConditionUtil.isPeopleValueField({
          checkOn: checkOn,
          conditionType: ConditionType.ContainsAny,
        }),
      ).toBe(true);
      expect(
        NotificationRuleConditionUtil.isDropdownValueField({
          checkOn: checkOn,
          conditionType: ConditionType.ContainsAny,
        }),
      ).toBe(false);
    }

    expect(
      NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        conditionType: ConditionType.ContainsAny,
      }),
    ).toBe(true);
    expect(
      NotificationRuleConditionUtil.isOwnerCheckOn(
        NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      ),
    ).toBe(false);
  });

  it("a field with no way to compare yet has no people to pick", () => {
    expect(
      NotificationRuleConditionUtil.isPeopleValueField({
        checkOn: NotificationRuleConditionCheckOn.IncidentOwners,
        conditionType: undefined,
      }),
    ).toBe(false);
    expect(
      NotificationRuleConditionUtil.isPeopleValueField({
        checkOn: undefined,
        conditionType: ConditionType.ContainsAny,
      }),
    ).toBe(false);
    expect(NotificationRuleConditionUtil.isOwnerCheckOn(undefined)).toBe(false);
    expect(
      NotificationRuleConditionUtil.isOwnerCheckOn(
        NotificationRuleConditionCheckOn.IncidentLabels,
      ),
    ).toBe(false);
  });

  it("refuses to save an owners condition with nobody picked", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: rule([ownersAre(ConditionType.ContainsAny, [])]),
      }),
    ).toBe("Value is required for Incident Owner");

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule([
          ownersAre(ConditionType.ContainsAny, [PLATFORM_TEAM]),
        ]),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBeNull();
  });
});

describe("Matching who owns a record (#7583)", () => {
  it("matches when a person picked owns the record", () => {
    expect(
      matches({
        filters: [ownersAre(ConditionType.ContainsAny, [JANE])],
        values: {
          [NotificationRuleConditionCheckOn.IncidentOwners]: [JANE, SAM],
        },
      }),
    ).toBe(true);
  });

  it("matches when a team picked owns the record", () => {
    expect(
      matches({
        filters: [ownersAre(ConditionType.ContainsAny, [PLATFORM_TEAM])],
        values: {
          [NotificationRuleConditionCheckOn.IncidentOwners]: [
            SAM,
            PLATFORM_TEAM,
          ],
        },
      }),
    ).toBe(true);
  });

  it("matches people and teams picked together when either owns it", () => {
    const picked: NotificationRuleCondition = ownersAre(
      ConditionType.ContainsAny,
      [PLATFORM_TEAM, JANE],
    );

    expect(
      matches({
        filters: [picked],
        values: { [NotificationRuleConditionCheckOn.IncidentOwners]: [JANE] },
      }),
    ).toBe(true);
    expect(
      matches({
        filters: [picked],
        values: {
          [NotificationRuleConditionCheckOn.IncidentOwners]: [PLATFORM_TEAM],
        },
      }),
    ).toBe(true);
    expect(
      matches({
        filters: [picked],
        values: {
          [NotificationRuleConditionCheckOn.IncidentOwners]: [
            SAM,
            PAYMENTS_TEAM,
          ],
        },
      }),
    ).toBe(false);
  });

  it("does not match a person who is only in the owning team", () => {
    // The team owns it; Jane is a member of the team, not an owner.
    expect(
      matches({
        filters: [ownersAre(ConditionType.ContainsAny, [JANE])],
        values: {
          [NotificationRuleConditionCheckOn.IncidentOwners]: [PLATFORM_TEAM],
        },
      }),
    ).toBe(false);
  });

  it("'is none of' matches a record none of the picks owns, and one with no owners", () => {
    const noneOf: NotificationRuleCondition = ownersAre(
      ConditionType.NotContains,
      [PLATFORM_TEAM, JANE],
    );

    expect(
      matches({
        filters: [noneOf],
        values: { [NotificationRuleConditionCheckOn.IncidentOwners]: [SAM] },
      }),
    ).toBe(true);
    expect(
      matches({
        filters: [noneOf],
        values: { [NotificationRuleConditionCheckOn.IncidentOwners]: [] },
      }),
    ).toBe(true);
    expect(
      matches({
        filters: [noneOf],
        values: {
          [NotificationRuleConditionCheckOn.IncidentOwners]: [
            SAM,
            PLATFORM_TEAM,
          ],
        },
      }),
    ).toBe(false);
  });

  it("'is any of' never matches a record with no owners", () => {
    expect(
      matches({
        filters: [ownersAre(ConditionType.ContainsAny, [JANE, PLATFORM_TEAM])],
        values: { [NotificationRuleConditionCheckOn.IncidentOwners]: [] },
      }),
    ).toBe(false);
  });

  it("combines with the record's other conditions by All and Any", () => {
    const filters: Array<NotificationRuleCondition> = [
      ownersAre(ConditionType.ContainsAny, [PLATFORM_TEAM]),
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.Contains,
        value: "database",
      },
    ];
    const values: Partial<NotificationRuleConditionValues> = {
      [NotificationRuleConditionCheckOn.IncidentOwners]: [PLATFORM_TEAM],
      [NotificationRuleConditionCheckOn.IncidentTitle]: "Checkout is slow",
    };

    expect(
      matches({ filters, values, filterCondition: FilterCondition.All }),
    ).toBe(false);
    expect(
      matches({ filters, values, filterCondition: FilterCondition.Any }),
    ).toBe(true);
  });
});

describe("Matching an on-call rule's policies (#7554)", () => {
  function policiesAre(
    conditionType: ConditionType,
    picked: Array<string>,
  ): NotificationRuleCondition {
    return {
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      conditionType: conditionType,
      value: picked,
    };
  }

  it("matches the policy picked, whatever it is called now", () => {
    expect(
      matches({
        filters: [policiesAre(ConditionType.ContainsAny, [PAYMENTS_POLICY])],
        values: {
          [NotificationRuleConditionCheckOn.OnCallDutyPolicies]: [
            PAYMENTS_POLICY,
          ],
          [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]:
            "Payments (renamed)",
        },
      }),
    ).toBe(true);
  });

  it("does not match a policy that was not picked", () => {
    expect(
      matches({
        filters: [policiesAre(ConditionType.ContainsAny, [PAYMENTS_POLICY])],
        values: {
          [NotificationRuleConditionCheckOn.OnCallDutyPolicies]: [
            SEARCH_POLICY,
          ],
        },
      }),
    ).toBe(false);
  });

  it("'is none of' leaves out the policies picked", () => {
    const noneOf: NotificationRuleCondition = policiesAre(
      ConditionType.NotContains,
      [PAYMENTS_POLICY, SEARCH_POLICY],
    );

    expect(
      matches({
        filters: [noneOf],
        values: {
          [NotificationRuleConditionCheckOn.OnCallDutyPolicies]: [
            SEARCH_POLICY,
          ],
        },
      }),
    ).toBe(false);
    expect(
      matches({
        filters: [noneOf],
        values: {
          [NotificationRuleConditionCheckOn.OnCallDutyPolicies]: [OLD_POLICY],
        },
      }),
    ).toBe(true);
  });

  it("never matches a record that is not a policy", () => {
    // Every other record leaves the field out, so neither way matches.
    for (const conditionType of [
      ConditionType.ContainsAny,
      ConditionType.NotContains,
    ]) {
      expect(
        matches({
          filters: [policiesAre(conditionType, [PAYMENTS_POLICY])],
          values: {
            [NotificationRuleConditionCheckOn.IncidentTitle]: "Database down",
          },
        }),
      ).toBe(false);
    }
  });
});

describe("Reading a condition's values", () => {
  it("lists every field a record can hold, each undefined unless given", () => {
    const values: NotificationRuleConditionValues =
      NotificationRuleConditionUtil.getValues({
        [NotificationRuleConditionCheckOn.IncidentOwners]: [JANE],
      });

    expect(Object.keys(values).sort()).toEqual(
      Object.values(NotificationRuleConditionCheckOn).sort(),
    );
    expect(values[NotificationRuleConditionCheckOn.IncidentOwners]).toEqual([
      JANE,
    ]);
    expect(
      values[NotificationRuleConditionCheckOn.AlertOwners],
    ).toBeUndefined();
    expect(
      values[NotificationRuleConditionCheckOn.OnCallDutyPolicies],
    ).toBeUndefined();
  });

  it("names the fields a rule's conditions check, once each", () => {
    expect(
      NotificationRuleConditionUtil.getCheckOnsUsed([
        ownersAre(ConditionType.ContainsAny, [JANE]),
        ownersAre(ConditionType.NotContains, [SAM]),
        {
          checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
          conditionType: ConditionType.Contains,
          value: "db",
        },
        null as unknown as NotificationRuleCondition,
        {
          checkOn: undefined,
        } as unknown as NotificationRuleCondition,
      ]),
    ).toEqual(
      new Set([
        NotificationRuleConditionCheckOn.IncidentOwners,
        NotificationRuleConditionCheckOn.IncidentTitle,
      ]),
    );
    expect(NotificationRuleConditionUtil.getCheckOnsUsed(undefined).size).toBe(
      0,
    );
    expect(NotificationRuleConditionUtil.getCheckOnsUsed(null).size).toBe(0);
  });

  it("reads the ids a condition holds, from a list or from one id saved as text", () => {
    expect(
      NotificationRuleConditionUtil.getValueIds(
        ownersAre(ConditionType.ContainsAny, [` ${JANE} `, "", PLATFORM_TEAM]),
      ),
    ).toEqual([JANE, PLATFORM_TEAM]);
    expect(
      NotificationRuleConditionUtil.getValueIds({
        checkOn: NotificationRuleConditionCheckOn.IncidentOwners,
        conditionType: ConditionType.ContainsAny,
        value: JANE,
      }),
    ).toEqual([JANE]);
    expect(
      NotificationRuleConditionUtil.getValueIds({
        checkOn: NotificationRuleConditionCheckOn.IncidentOwners,
        conditionType: ConditionType.ContainsAny,
        value: undefined,
      }),
    ).toEqual([]);
    expect(NotificationRuleConditionUtil.getValueIds(undefined)).toEqual([]);
    expect(NotificationRuleConditionUtil.getValueIds(null)).toEqual([]);
  });
});

describe("The values offered for a pick (#7582)", () => {
  const payments: OnCallDutyPolicy = policy({
    id: PAYMENTS_POLICY,
    name: "Payments Escalation",
    isArchived: false,
  });
  const search: OnCallDutyPolicy = policy({
    id: SEARCH_POLICY,
    name: "Search Escalation",
    isArchived: false,
  });
  const old: OnCallDutyPolicy = policy({
    id: OLD_POLICY,
    name: "Old Escalation",
    isArchived: true,
  });

  it("offers the project's policies by name, as the team wrote them", () => {
    expect(
      optionsFor({
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        onCallDutyPolicies: [payments, search],
      }),
    ).toEqual([
      {
        value: PAYMENTS_POLICY,
        label: "Payments Escalation",
        isUserContent: true,
      },
      { value: SEARCH_POLICY, label: "Search Escalation", isUserContent: true },
    ]);
  });

  it("leaves an archived policy out of a new pick", () => {
    expect(
      optionsFor({
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        onCallDutyPolicies: [payments, old, search],
      }).map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual([PAYMENTS_POLICY, SEARCH_POLICY]);
  });

  it("keeps an archived policy the condition holds, marked and closed to a new pick", () => {
    const options: Array<DropdownOption> = optionsFor({
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      onCallDutyPolicies: [payments, old],
      // Held as it was typed by the API: matched whatever its case.
      keptIds: [OLD_POLICY.toUpperCase()],
    });

    expect(options).toEqual([
      {
        value: PAYMENTS_POLICY,
        label: "Payments Escalation",
        isUserContent: true,
      },
      {
        value: OLD_POLICY,
        label: "Old Escalation",
        isUserContent: true,
        isArchived: true,
        isDisabled: true,
      },
    ]);
  });

  it("offers a policy read without its archive switch as before", () => {
    expect(
      optionsFor({
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
        onCallDutyPolicies: [policy({ id: OLD_POLICY, name: "Old" })],
      }),
    ).toHaveLength(1);
  });

  it("has nothing to offer when the policies were not read", () => {
    expect(
      optionsFor({
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      }),
    ).toEqual([]);
  });

  it("leaves an archived incident severity out, and marks one the condition holds", () => {
    const severities: Array<IncidentSeverity> = [
      severity({ id: "c1", name: "Critical", isArchived: false }),
      severity({ id: "c2", name: "Legacy P5", isArchived: true }),
    ];

    expect(
      optionsFor({
        checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
        incidentSeverities: severities,
      }).map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual(["Critical"]);

    const kept: Array<DropdownOption> = optionsFor({
      checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
      incidentSeverities: severities,
      keptIds: ["c2"],
    });

    expect(
      kept.map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual(["Critical", "Legacy P5"]);
    expect(kept[1]).toMatchObject({ isArchived: true, isDisabled: true });
    expect(kept[0]!.isArchived).toBeUndefined();
  });
});
