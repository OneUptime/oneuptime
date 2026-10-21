import RunbookRule from "../../../Models/DatabaseModels/RunbookRule";
import RunbookRuleService from "../../../Server/Services/RunbookRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import RunbookRuleTriggerEntity from "../../../Types/Runbook/RunbookRuleTriggerEntity";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayWriteLikeFindBy,
} from "../TestingUtils/RowsCallerMayWrite";

/*
 * The read of the rows a caller's update may write, which the update path
 * makes before the hooks: what the suite's read of them answers
 * (stubRowsCallerMayWriteLikeFindBy).
 */
beforeEach(() => {
  stubRowsCallerMayWriteLikeFindBy(
    RunbookRuleService,
    jest.spyOn(RunbookRuleService, "findBy"),
  );
});

/*
 * One table holds incident, alert and scheduled maintenance runbook rules.
 * A rule can only be true for its own kind of record, so the service refuses
 * a condition on another kind's severity - an incident rule asking for alert
 * severities - instead of saving a rule that silently never runs. And the
 * shared criteria validation accepts the new criteria with the operators
 * that fit them.
 *
 * No database: the hooks are protected prototype methods, reached through a
 * structural cast, and the one read the update hook makes is a spy.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("70000000-0000-4000-8000-000000000002");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000000003",
);
const SEVERITY_ID: string = "70000000-0000-4000-8000-000000000004";
const LABEL_ID: string = "70000000-0000-4000-8000-000000000005";
const MONITOR_ID: string = "70000000-0000-4000-8000-000000000006";

interface Hooks {
  onBeforeCreate: (
    createBy: CreateBy<RunbookRule>,
  ) => Promise<OnCreate<RunbookRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<RunbookRule>,
  ) => Promise<OnUpdate<RunbookRule>>;
  sanitizeCreateOrUpdate: (
    data: unknown,
    props: DatabaseCommonInteractionProps,
    isUpdate?: boolean,
  ) => Promise<JSONObject>;
}

const hooks: Hooks = RunbookRuleService as unknown as Hooks;

const USER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
};

function criteria(...filters: Array<RuleCriteriaFilter>): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: filters,
  };
}

const ON_INCIDENT_SEVERITY: RuleCriteriaFilter = {
  field: "incidentSeverities",
  operator: RuleCriteriaOperator.HasAnyOf,
  value: [SEVERITY_ID],
};

const ON_ALERT_SEVERITY: RuleCriteriaFilter = {
  field: "alertSeverities",
  operator: RuleCriteriaOperator.HasAnyOf,
  value: [SEVERITY_ID],
};

const ON_LABELS: RuleCriteriaFilter = {
  field: "labels",
  operator: RuleCriteriaOperator.HasAnyOf,
  value: [LABEL_ID],
};

const ON_MONITOR_LABELS: RuleCriteriaFilter = {
  field: "monitorLabels",
  operator: RuleCriteriaOperator.HasAllOf,
  value: [LABEL_ID],
};

const ON_MONITORS: RuleCriteriaFilter = {
  field: "monitors",
  operator: RuleCriteriaOperator.HasNoneOf,
  value: [MONITOR_ID],
};

const ON_MONITOR_NAME: RuleCriteriaFilter = {
  field: "monitorNamePattern",
  operator: RuleCriteriaOperator.StartsWith,
  value: "prod-",
};

const ON_TITLE: RuleCriteriaFilter = {
  field: "titlePattern",
  operator: RuleCriteriaOperator.Contains,
  value: "database",
};

function newRule(data: {
  triggerEntityType?: string | undefined;
  criteria?: RuleCriteria | undefined;
  values?: Record<string, unknown> | undefined;
}): RunbookRule {
  const rule: RunbookRule = new RunbookRule();
  rule.name = "Start the database runbook";
  rule.projectId = PROJECT_ID;

  if (data.triggerEntityType !== undefined) {
    rule.triggerEntityType = data.triggerEntityType as RunbookRuleTriggerEntity;
  }

  if (data.criteria) {
    rule.criteria = data.criteria;
  }

  Object.assign(rule, data.values || {});

  return rule;
}

async function create(data: {
  triggerEntityType?: string | undefined;
  criteria?: RuleCriteria | undefined;
  values?: Record<string, unknown> | undefined;
}): Promise<OnCreate<RunbookRule>> {
  return await hooks.onBeforeCreate({
    data: newRule(data),
    props: USER_PROPS,
  });
}

function update(data: Record<string, unknown>): UpdateBy<RunbookRule> {
  return {
    query: { _id: RULE_ID.toString() },
    data: data as UpdateBy<RunbookRule>["data"],
    limit: 1,
    skip: 0,
    props: USER_PROPS,
  };
}

function storedRules(
  ...triggerEntityTypes: Array<RunbookRuleTriggerEntity>
): SpyInstance<typeof RunbookRuleService.findBy> {
  return jest.spyOn(RunbookRuleService, "findBy").mockResolvedValue(
    triggerEntityTypes.map(
      (triggerEntityType: RunbookRuleTriggerEntity, index: number) => {
        const rule: RunbookRule = new RunbookRule();
        rule._id = (index === 0 ? RULE_ID : OTHER_RULE_ID).toString();
        rule.triggerEntityType = triggerEntityType;
        return rule;
      },
    ),
  );
}

beforeEach(() => {
  // The severities and runbooks these rules name are the project's (see ProjectReferenceCheck).
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a runbook rule", () => {
  it.each([
    [
      RunbookRuleTriggerEntity.Incident,
      criteria(
        ON_MONITORS,
        ON_INCIDENT_SEVERITY,
        ON_LABELS,
        ON_MONITOR_LABELS,
        ON_TITLE,
        ON_MONITOR_NAME,
      ),
    ],
    [
      RunbookRuleTriggerEntity.Alert,
      criteria(
        ON_MONITORS,
        ON_ALERT_SEVERITY,
        ON_LABELS,
        ON_MONITOR_LABELS,
        ON_TITLE,
        ON_MONITOR_NAME,
      ),
    ],
    [
      RunbookRuleTriggerEntity.ScheduledMaintenance,
      criteria(
        ON_MONITORS,
        ON_LABELS,
        ON_MONITOR_LABELS,
        ON_TITLE,
        ON_MONITOR_NAME,
      ),
    ],
  ])(
    "accepts %s rules on every criterion of their own",
    async (trigger: RunbookRuleTriggerEntity, ruleCriteria: RuleCriteria) => {
      const result: OnCreate<RunbookRule> = await create({
        triggerEntityType: trigger,
        criteria: ruleCriteria,
      });

      expect(result.createBy.data.criteria).toEqual(ruleCriteria);
    },
  );

  it("accepts a rule without conditions, which runs for every record", async () => {
    await expect(
      create({ triggerEntityType: RunbookRuleTriggerEntity.Incident }),
    ).resolves.toBeDefined();
  });

  it("refuses an incident rule on alert severities", async () => {
    await expect(
      create({
        triggerEntityType: RunbookRuleTriggerEntity.Incident,
        criteria: criteria(ON_LABELS, ON_ALERT_SEVERITY),
      }),
    ).rejects.toThrow(
      new BadDataException(
        "Alert Severities can only be used by alert runbook rules.",
      ),
    );
  });

  it("refuses an alert rule on incident severities", async () => {
    await expect(
      create({
        triggerEntityType: RunbookRuleTriggerEntity.Alert,
        criteria: criteria(ON_INCIDENT_SEVERITY),
      }),
    ).rejects.toThrow(
      "Incident Severities can only be used by incident runbook rules.",
    );
  });

  it.each([ON_INCIDENT_SEVERITY, ON_ALERT_SEVERITY])(
    "refuses a scheduled maintenance rule on $field",
    async (filter: RuleCriteriaFilter) => {
      await expect(
        create({
          triggerEntityType: RunbookRuleTriggerEntity.ScheduledMaintenance,
          criteria: criteria(filter),
        }),
      ).rejects.toThrow(BadDataException);
    },
  );

  it("refuses another trigger's severity written straight into its column", async () => {
    await expect(
      create({
        triggerEntityType: RunbookRuleTriggerEntity.Incident,
        values: { alertSeverities: [SEVERITY_ID] },
      }),
    ).rejects.toThrow(
      "Alert Severities can only be used by alert runbook rules.",
    );
  });

  it("accepts the empty severity column the dashboard sends beside conditions", async () => {
    await expect(
      create({
        triggerEntityType: RunbookRuleTriggerEntity.Incident,
        criteria: criteria(ON_LABELS),
        values: { incidentSeverities: [], monitors: [], labels: [] },
      }),
    ).resolves.toBeDefined();
  });

  it("refuses a trigger that is not incident, alert or scheduled maintenance", async () => {
    await expect(create({ triggerEntityType: "Monitor" })).rejects.toThrow(
      "Trigger Entity Type must be one of Incident, Alert, ScheduledMaintenance.",
    );
    await expect(create({})).rejects.toThrow(BadDataException);
  });
});

describe("editing a runbook rule", () => {
  it("does not read anything back for an edit that changes no criteria", async () => {
    const findBy: SpyInstance<typeof RunbookRuleService.findBy> = storedRules(
      RunbookRuleTriggerEntity.Incident,
    );

    await hooks.onBeforeUpdate(
      update({ name: "Renamed", isEnabled: false, incidentSeverities: [] }),
    );

    expect(findBy).not.toHaveBeenCalled();
  });

  it("judges new conditions against the stored trigger of the rules the caller may write, in their project", async () => {
    const findBy: SpyInstance<typeof RunbookRuleService.findBy> = storedRules(
      RunbookRuleTriggerEntity.Incident,
    );

    await expect(
      hooks.onBeforeUpdate(update({ criteria: criteria(ON_ALERT_SEVERITY) })),
    ).rejects.toThrow(
      "Alert Severities can only be used by alert runbook rules.",
    );

    // The rules the caller may write, found in their project.
    expect(readsOfRowsCallerMayWrite(RunbookRuleService)[0]!.query).toEqual({
      _id: RULE_ID.toString(),
      projectId: PROJECT_ID,
    });

    // Then those, by id.
    expect(findBy).toHaveBeenCalledTimes(1);
    const read: Parameters<typeof RunbookRuleService.findBy>[0] =
      findBy.mock.calls[0]![0];
    expect(read.query).toEqual({ _id: RULE_ID.toString() });
    expect(read.select).toEqual({ _id: true, triggerEntityType: true });
    expect(read.props).toEqual({ isRoot: true, ignoreHooks: true });
  });

  it("accepts new conditions of the rule's own trigger", async () => {
    storedRules(RunbookRuleTriggerEntity.Alert);

    await expect(
      hooks.onBeforeUpdate(
        update({
          criteria: criteria(ON_ALERT_SEVERITY, ON_MONITOR_LABELS),
          alertSeverities: [],
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("refuses a severity column of another trigger", async () => {
    storedRules(RunbookRuleTriggerEntity.ScheduledMaintenance);

    await expect(
      hooks.onBeforeUpdate(update({ incidentSeverities: [SEVERITY_ID] })),
    ).rejects.toThrow(
      "Incident Severities can only be used by incident runbook rules.",
    );
  });

  it("refuses an edit of several rules when it does not fit one of them", async () => {
    storedRules(
      RunbookRuleTriggerEntity.Incident,
      RunbookRuleTriggerEntity.Alert,
    );

    await expect(
      hooks.onBeforeUpdate(
        update({ criteria: criteria(ON_INCIDENT_SEVERITY) }),
      ),
    ).rejects.toThrow(
      "Incident Severities can only be used by incident runbook rules.",
    );
  });
});

/*
 * The shared write path every rule goes through: the criteria field
 * allowlist, the operator each kind of column takes, and the legacy shadow
 * that keeps older API pods from acting on a rule saved with conditions.
 */
describe("runbook rule conditions on the shared write path", () => {
  async function sanitize(data: JSONObject): Promise<JSONObject> {
    return await hooks.sanitizeCreateOrUpdate(data, { isRoot: true }, false);
  }

  it("accepts every new criterion with an operator that fits it", async () => {
    const ruleCriteria: RuleCriteria = criteria(
      ON_MONITORS,
      ON_INCIDENT_SEVERITY,
      ON_ALERT_SEVERITY,
      ON_LABELS,
      ON_MONITOR_LABELS,
      ON_TITLE,
      ON_MONITOR_NAME,
      {
        field: "descriptionPattern",
        operator: RuleCriteriaOperator.DoesNotContain,
        value: "test",
      },
      {
        field: "monitorDescriptionPattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "*production*",
      },
    );

    await expect(
      sanitize({ criteria: ruleCriteria as unknown as JSONObject }),
    ).resolves.toMatchObject({ criteria: ruleCriteria });
  });

  it("writes the never-matching title pattern beside conditions, and keeps the relations", async () => {
    const result: JSONObject = await sanitize({
      criteria: criteria(ON_LABELS) as unknown as JSONObject,
      titlePattern: "database",
      descriptionPattern: "timeout",
      monitorNamePattern: "prod-.*",
      monitorDescriptionPattern: "production",
      labels: [LABEL_ID],
      monitorLabels: [LABEL_ID],
    });

    expect(result).toMatchObject({
      titlePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
      descriptionPattern: null,
      monitorNamePattern: null,
      monitorDescriptionPattern: null,
    });
    expect(result["labels"]).toBeUndefined();
    expect(result["monitorLabels"]).toBeUndefined();
  });

  it.each([
    [
      "a relation criterion with a text operator",
      {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.Contains,
        value: "production",
      },
      'Rule criteria field "monitorLabels" requires a relation operator.',
    ],
    [
      "a pattern criterion with a list operator",
      {
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: [LABEL_ID],
      },
      'Rule criteria field "monitorNamePattern" does not support relation operators.',
    ],
    [
      "a relation criterion naming something that is not an id",
      {
        field: "labels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ["production"],
      },
      'Rule criteria field "labels" requires valid resource IDs.',
    ],
    [
      "a criterion other rules have but runbook rules do not",
      {
        field: "incidentLabels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: [LABEL_ID],
      },
      'Rule criteria field "incidentLabels" is not supported for RunbookRule.',
    ],
    [
      "the rule's own action as a criterion",
      {
        field: "runbooks",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: [LABEL_ID],
      },
      'Rule criteria field "runbooks" is not supported for RunbookRule.',
    ],
  ])(
    "refuses %s",
    async (_name: string, filter: RuleCriteriaFilter, refusal: string) => {
      await expect(
        sanitize({ criteria: criteria(filter) as unknown as JSONObject }),
      ).rejects.toThrow(refusal);
    },
  );
});
