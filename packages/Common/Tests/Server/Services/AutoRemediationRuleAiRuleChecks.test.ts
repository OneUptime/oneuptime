import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import { AI_RULE_DOES_NOTHING_MESSAGE } from "../../../Types/AI/AiRule";
import {
  AI_RULE_CRITERIA_FIELDS,
  AI_RULE_CRITERIA_FIELDS_BY_TRIGGER,
} from "../../../Types/AI/AiRuleCriteria";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayWriteLikeFindBy,
} from "../TestingUtils/RowsCallerMayWrite";

/*
 * WHAT THE AI RULE SERVICE HOLDS EVERY WRITER TO - the dashboard, the API,
 * Terraform and a workflow alike. Investigation rules and auto remediation
 * rules are one AI rule now (Types/AI/AiRule), kept by
 * AutoRemediationRuleService, so what the investigation rule service held
 * its rules to, the AI rule service holds every rule to:
 *
 *   - a rule investigates, fixes, or both: one that does neither does
 *     nothing, and would still narrow what is fixed - refused, judged on an
 *     edit with the rule's other column as stored;
 *   - one table holds incident and alert rules, and each can only match on
 *     its own kind of signal's criteria: a condition on alert severities can
 *     never be true for an incident, and is refused - as a condition, or in
 *     the severity column itself - rather than saved as a rule that silently
 *     never matches, which, since rules narrow what is investigated and
 *     fixed, would quietly stop both;
 *   - a rule's wait is a whole number of minutes, at most a day, or nothing.
 */

/*
 * The read of the rows a caller's update may write, which the update path
 * makes before the hooks: what the suite's read of them answers
 * (stubRowsCallerMayWriteLikeFindBy).
 */
beforeEach(() => {
  stubRowsCallerMayWriteLikeFindBy(
    AutoRemediationRuleService,
    jest.spyOn(AutoRemediationRuleService, "findBy"),
  );
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface RuleHookAccess {
  onBeforeCreate(
    createBy: CreateBy<AutoRemediationRule>,
  ): Promise<OnCreate<AutoRemediationRule>>;
  onBeforeUpdate(
    updateBy: UpdateBy<AutoRemediationRule>,
  ): Promise<OnUpdate<AutoRemediationRule>>;
}

const hooks: RuleHookAccess =
  AutoRemediationRuleService as unknown as RuleHookAccess;

const Incident: AutoRemediationTriggerEntity =
  AutoRemediationTriggerEntity.Incident;
const Alert: AutoRemediationTriggerEntity = AutoRemediationTriggerEntity.Alert;

function criteriaOn(field: string): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [
      {
        field,
        operator: RuleCriteriaOperator.HasAnyOf,
        value: [SEVERITY_ID.toString()],
      },
    ],
  };
}

function ref<T extends { _id?: string | undefined }>(type: { new (): T }): T {
  const model: T = new type();
  model._id = SEVERITY_ID.toString();
  return model;
}

async function createError(
  values: Partial<AutoRemediationRule>,
): Promise<unknown> {
  try {
    await hooks.onBeforeCreate({
      data: Object.assign(new AutoRemediationRule(), {
        name: "Production",
        projectId: PROJECT_ID,
        ...values,
      }),
      props: { tenantId: PROJECT_ID },
    } as unknown as CreateBy<AutoRemediationRule>);
    return null;
  } catch (error) {
    return error;
  }
}

interface StoredRule {
  triggerEntityType: AutoRemediationTriggerEntity;
  investigates?: boolean;
  fixes?: boolean;
}

// An update of the rules `stored`, named by their ids.
async function updateError(
  data: Record<string, unknown>,
  stored: Array<StoredRule>,
): Promise<{ error: unknown; reads: number }> {
  const rules: Array<AutoRemediationRule> = stored.map((row: StoredRule) => {
    return Object.assign(new AutoRemediationRule(), {
      _id: ObjectID.generate().toString(),
      ...row,
    });
  });
  const ids: Array<string> = rules.map((rule: AutoRemediationRule) => {
    return rule._id!;
  });

  const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> = jest
    .spyOn(AutoRemediationRuleService, "findBy")
    .mockResolvedValue(rules);

  try {
    await hooks.onBeforeUpdate({
      query: { _id: ids.length === 1 ? ids[0] : QueryHelper.any(ids) },
      data,
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<AutoRemediationRule>);
    return { error: null, reads: findBy.mock.calls.length };
  } catch (error) {
    return { error, reads: findBy.mock.calls.length };
  }
}

describe("AutoRemediationRuleService - what an AI rule does", () => {
  it("checks every record it writes against the project", () => {
    expect(AutoRemediationRuleService).toBeInstanceOf(ProjectReferencesService);
  });

  describe("on create", () => {
    it.each([
      ["investigates and fixes", { investigates: true, fixes: true }],
      ["only investigates", { investigates: true, fixes: false }],
      ["only fixes", { investigates: false, fixes: true }],
      // An older API or Terraform client: the columns' defaults - it fixes.
      ["says nothing of either", {}],
      ["says only that it investigates", { investigates: true }],
      ["says only that it fixes", { fixes: true }],
    ])(
      "accepts a rule that %s",
      async (_title: string, shape: Partial<AutoRemediationRule>) => {
        expect(
          await createError({ triggerEntityType: Incident, ...shape }),
        ).toBeNull();
      },
    );

    it.each([
      ["does neither", { investigates: false, fixes: false }],
      // Not investigating is the column's default: this rule does nothing.
      ["only says it does not fix", { fixes: false }],
    ])(
      "refuses a rule that %s, saying what to do",
      async (_title: string, shape: Partial<AutoRemediationRule>) => {
        const error: unknown = await createError({
          triggerEntityType: Alert,
          ...shape,
        });

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as Error).message).toBe(AI_RULE_DOES_NOTHING_MESSAGE);
      },
    );

    it("refuses anything but true or false for what it does", async () => {
      expect(
        (
          (await createError({
            triggerEntityType: Incident,
            investigates: "yes" as unknown as boolean,
          })) as Error
        ).message,
      ).toBe("Investigates must be true or false.");
      expect(
        (
          (await createError({
            triggerEntityType: Incident,
            fixes: 0 as unknown as boolean,
          })) as Error
        ).message,
      ).toBe("Fixes must be true or false.");
    });
  });

  describe("on update", () => {
    it("does not read the rules back for an edit that changes neither what they do nor their conditions", async () => {
      const result: { error: unknown; reads: number } = await updateError(
        { name: "Renamed", isEnabled: false },
        [{ triggerEntityType: Incident, investigates: false, fixes: true }],
      );

      expect(result).toEqual({ error: null, reads: 0 });
    });

    it("turning fixing off is judged against whether each rule investigates, as stored", async () => {
      expect(
        await updateError({ fixes: false }, [
          { triggerEntityType: Incident, investigates: true, fixes: true },
        ]),
      ).toEqual({ error: null, reads: 1 });

      const refused: { error: unknown; reads: number } = await updateError(
        { fixes: false },
        [
          { triggerEntityType: Incident, investigates: true, fixes: true },
          { triggerEntityType: Incident, investigates: false, fixes: true },
        ],
      );

      expect(refused.error).toBeInstanceOf(BadDataException);
      expect((refused.error as Error).message).toBe(
        AI_RULE_DOES_NOTHING_MESSAGE,
      );
    });

    it("turning investigating off is judged against whether each rule fixes, as stored", async () => {
      expect(
        (
          await updateError({ investigates: false }, [
            { triggerEntityType: Alert, investigates: true, fixes: true },
          ])
        ).error,
      ).toBeNull();

      expect(
        (
          (
            await updateError({ investigates: false }, [
              { triggerEntityType: Alert, investigates: true, fixes: false },
            ])
          ).error as Error
        ).message,
      ).toBe(AI_RULE_DOES_NOTHING_MESSAGE);
    });

    it("an edit that says both is judged on what it says alone", async () => {
      for (const stored of [
        { triggerEntityType: Incident, investigates: false, fixes: false },
        { triggerEntityType: Incident, investigates: true, fixes: true },
      ]) {
        expect(
          (await updateError({ investigates: false, fixes: true }, [stored]))
            .error,
        ).toBeNull();
        expect(
          (
            (await updateError({ investigates: false, fixes: false }, [stored]))
              .error as Error
          ).message,
        ).toBe(AI_RULE_DOES_NOTHING_MESSAGE);
      }
    });

    it("Investigate too - a rule that only fixes, turned into one that investigates - is accepted", async () => {
      expect(
        await updateError({ investigates: true }, [
          { triggerEntityType: Incident, investigates: false, fixes: true },
        ]),
      ).toEqual({ error: null, reads: 1 });
    });

    it("refuses anything but true or false", async () => {
      expect(
        (
          (
            await updateError({ fixes: "no" }, [
              { triggerEntityType: Incident, investigates: true, fixes: true },
            ])
          ).error as Error
        ).message,
      ).toBe("Fixes must be true or false.");
    });
  });
});

describe("AutoRemediationRuleService - what an AI rule matches", () => {
  describe("on create", () => {
    it.each([
      [Incident, "incidentSeverities"],
      [Alert, "alertSeverities"],
    ])(
      "accepts a %s rule on its own severities",
      async (trigger: AutoRemediationTriggerEntity, field: string) => {
        expect(
          await createError({
            triggerEntityType: trigger,
            criteria: criteriaOn(field),
          }),
        ).toBeNull();
      },
    );

    it("accepts a rule with no condition: it matches everything", async () => {
      expect(await createError({ triggerEntityType: Incident })).toBeNull();
    });

    it.each([
      [
        Incident,
        "alertSeverities",
        "Alert Severities can only be used by alert AI rules.",
      ],
      [
        Alert,
        "incidentSeverities",
        "Incident Severities can only be used by incident AI rules.",
      ],
    ])(
      "refuses a %s rule conditioned on %s",
      async (
        trigger: AutoRemediationTriggerEntity,
        field: string,
        message: string,
      ) => {
        const error: unknown = await createError({
          triggerEntityType: trigger,
          criteria: criteriaOn(field),
        });

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as Error).message).toBe(message);
      },
    );

    it("refuses the other kind's severity in the column itself", async () => {
      const error: unknown = await createError({
        triggerEntityType: Incident,
        alertSeverities: [ref(AlertSeverity)],
      });

      expect((error as Error).message).toBe(
        "Alert Severities can only be used by alert AI rules.",
      );
    });

    it("refuses a rule for no kind of signal, or none at all", async () => {
      for (const triggerEntityType of [
        "Episode",
        "incident",
        undefined,
      ] as Array<AutoRemediationTriggerEntity | undefined>) {
        const error: unknown = await createError(
          triggerEntityType === undefined ? {} : { triggerEntityType },
        );

        expect((error as Error).message).toBe(
          "Trigger Entity Type must be one of Incident, Alert, Profile, Trace, Exception, Metric.",
        );
      }
    });
  });

  describe("on update", () => {
    it("judges a new condition against the trigger of each rule it touches", async () => {
      const ok: { error: unknown; reads: number } = await updateError(
        { criteria: criteriaOn("incidentSeverities") },
        [{ triggerEntityType: Incident }],
      );

      expect(ok).toEqual({ error: null, reads: 1 });

      const refused: { error: unknown; reads: number } = await updateError(
        { criteria: criteriaOn("incidentSeverities") },
        [{ triggerEntityType: Incident }, { triggerEntityType: Alert }],
      );

      expect((refused.error as Error).message).toBe(
        "Incident Severities can only be used by incident AI rules.",
      );
    });

    it("judges a severity column written on its own", async () => {
      const refused: { error: unknown; reads: number } = await updateError(
        { incidentSeverities: [ref(IncidentSeverity)] },
        [{ triggerEntityType: Alert }],
      );

      expect(refused.error).toBeInstanceOf(BadDataException);
    });

    it("reads only the caller's project's rules", async () => {
      const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> = jest
        .spyOn(AutoRemediationRuleService, "findBy")
        .mockResolvedValue([]);

      await hooks.onBeforeUpdate({
        query: { _id: "x" },
        data: { criteria: criteriaOn("monitors") },
        props: { tenantId: PROJECT_ID },
      } as unknown as UpdateBy<AutoRemediationRule>);

      // The rules the caller may write, found in their project.
      expect(
        readsOfRowsCallerMayWrite(AutoRemediationRuleService)[0]!.query,
      ).toEqual({ _id: "x", projectId: PROJECT_ID });
      // None of them here: nothing more is read.
      expect(findBy).not.toHaveBeenCalled();
    });
  });

  /*
   * A profile AI rule (the slow code a service's profiles show,
   * Types/AI/TelemetryAi) matches on the service alone, and nothing else may.
   */
  describe("a profile AI rule", () => {
    const Profile: AutoRemediationTriggerEntity =
      AutoRemediationTriggerEntity.Profile;

    it("is accepted on its own conditions and columns", async () => {
      expect(
        await createError({
          triggerEntityType: Profile,
          investigates: true,
          fixes: true,
          criteria: criteriaOn("services"),
        }),
      ).toBeNull();
      expect(
        await createError({
          triggerEntityType: Profile,
          investigates: true,
          serviceNamePattern: "^checkout",
          serviceLabels: [ref(Label)],
        }),
      ).toBeNull();
    });

    it("is refused an incident's criteria, as a condition or a column", async () => {
      expect(
        (
          (await createError({
            triggerEntityType: Profile,
            investigates: true,
            criteria: criteriaOn("monitors"),
          })) as Error
        ).message,
      ).toBe(
        "Monitors can only be used by incident AI rules or alert AI rules.",
      );
      expect(
        (
          (await createError({
            triggerEntityType: Profile,
            investigates: true,
            titlePattern: "database",
          })) as Error
        ).message,
      ).toBe(
        "Title Pattern can only be used by incident AI rules or alert AI rules.",
      );
    });

    it("its service criteria are refused to an incident or alert rule", async () => {
      expect(
        (
          (await createError({
            triggerEntityType: Incident,
            criteria: criteriaOn("services"),
          })) as Error
        ).message,
      ).toBe(
        "Services can only be used by profile AI rules, trace AI rules, exception AI rules or metric AI rules.",
      );
      expect(
        (
          (await createError({
            triggerEntityType: Alert,
            serviceNamePattern: "checkout",
          })) as Error
        ).message,
      ).toBe(
        "Service Name Pattern can only be used by profile AI rules, trace AI rules, exception AI rules or metric AI rules.",
      );
    });

    it("an edit that writes a service pattern is judged against each rule's kind", async () => {
      expect(
        (
          await updateError({ serviceNamePattern: "^api" }, [
            { triggerEntityType: Profile, investigates: true, fixes: true },
          ])
        ).error,
      ).toBeNull();

      const refused: { error: unknown; reads: number } = await updateError(
        { serviceNamePattern: "^api" },
        [{ triggerEntityType: Incident, investigates: true, fixes: true }],
      );

      expect((refused.error as Error).message).toBe(
        "Service Name Pattern can only be used by profile AI rules, trace AI rules, exception AI rules or metric AI rules.",
      );
    });

    it("the never-match pattern the dashboard writes beside conditions reads nothing back", async () => {
      expect(
        await updateError(
          { serviceNamePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN },
          [{ triggerEntityType: Incident, investigates: true, fixes: true }],
        ),
      ).toEqual({ error: null, reads: 0 });
    });
  });

  /*
   * Traces' AI rules match on the service too: the same columns and
   * conditions a profile rule uses, refused to incident and alert rules.
   */
  describe("a trace AI rule", () => {
    const Trace: AutoRemediationTriggerEntity =
      AutoRemediationTriggerEntity.Trace;

    it("is accepted on the service's conditions and columns", async () => {
      expect(
        await createError({
          triggerEntityType: Trace,
          investigates: true,
          fixes: true,
          criteria: criteriaOn("services"),
        }),
      ).toBeNull();
      expect(
        await createError({
          triggerEntityType: Trace,
          investigates: true,
          serviceNamePattern: "^checkout",
          serviceLabels: [ref(Label)],
        }),
      ).toBeNull();
    });

    it("is refused an alert's criteria", async () => {
      expect(
        (
          (await createError({
            triggerEntityType: Trace,
            investigates: true,
            criteria: criteriaOn("alertSeverities"),
          })) as Error
        ).message,
      ).toBe("Alert Severities can only be used by alert AI rules.");
    });

    it("an edit that writes a service pattern on a trace rule is accepted", async () => {
      expect(
        (
          await updateError({ serviceNamePattern: "^api" }, [
            { triggerEntityType: Trace, investigates: true, fixes: true },
          ])
        ).error,
      ).toBeNull();
    });
  });

  /*
   * Metrics' AI rules match on the service as well: the same columns and
   * conditions a profile or trace rule uses, refused to incident and alert
   * rules, and refused an incident's or an alert's criteria in turn.
   */
  describe("a metric AI rule", () => {
    const Metric: AutoRemediationTriggerEntity =
      AutoRemediationTriggerEntity.Metric;

    it("is accepted on the service's conditions and columns", async () => {
      expect(
        await createError({
          triggerEntityType: Metric,
          investigates: true,
          fixes: true,
          criteria: criteriaOn("services"),
        }),
      ).toBeNull();
      expect(
        await createError({
          triggerEntityType: Metric,
          investigates: true,
          serviceNamePattern: "^checkout",
          serviceLabels: [ref(Label)],
        }),
      ).toBeNull();
    });

    it("is refused an incident's or an alert's criteria", async () => {
      expect(
        (
          (await createError({
            triggerEntityType: Metric,
            investigates: true,
            criteria: criteriaOn("incidentSeverities"),
          })) as Error
        ).message,
      ).toBe("Incident Severities can only be used by incident AI rules.");
      expect(
        (
          (await createError({
            triggerEntityType: Metric,
            investigates: true,
            titlePattern: "database",
          })) as Error
        ).message,
      ).toBe(
        "Title Pattern can only be used by incident AI rules or alert AI rules.",
      );
    });

    it("an edit that writes a service pattern is accepted on a metric rule, and refused on an incident rule beside it", async () => {
      expect(
        (
          await updateError({ serviceNamePattern: "^api" }, [
            { triggerEntityType: Metric, investigates: true, fixes: true },
          ])
        ).error,
      ).toBeNull();

      const refused: { error: unknown; reads: number } = await updateError(
        { serviceNamePattern: "^api" },
        [
          { triggerEntityType: Metric, investigates: true, fixes: true },
          { triggerEntityType: Incident, investigates: true, fixes: true },
        ],
      );

      expect((refused.error as Error).message).toBe(
        "Service Name Pattern can only be used by profile AI rules, trace AI rules, exception AI rules or metric AI rules.",
      );
    });
  });

  it("matches on what the rule criteria registry says, split by the kind of signal", () => {
    expect([...AI_RULE_CRITERIA_FIELDS].sort()).toEqual(
      [...RULE_CRITERIA_FIELDS_BY_MODEL["AutoRemediationRule"]!].sort(),
    );
    expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Incident]).not.toContain(
      "alertSeverities",
    );
    expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Alert]).not.toContain(
      "incidentSeverities",
    );
  });
});

/*
 * A rule's wait (issue #5074, onlyIfOpenAfterMinutes): a whole number of
 * minutes, at most a day, or nothing. Every caller is held to it - the form,
 * the API, Terraform, a workflow - with a refusal that says so, rather than
 * a wait OneUptime AI would read differently from what was written.
 */
describe("AutoRemediationRuleService - an AI rule's wait", () => {
  describe("on create", () => {
    it.each([[undefined], [null], [0], [1], [10], [1440], ["30"]])(
      "accepts %p",
      async (wait: unknown) => {
        expect(
          await createError({
            triggerEntityType: Incident,
            investigates: true,
            onlyIfOpenAfterMinutes: wait as number,
          }),
        ).toBeNull();
      },
    );

    it.each([
      [
        10.5,
        "Only If Open After (Minutes) must be a whole number of minutes. Leave it empty to investigate right away.",
      ],
      [
        "ten",
        "Only If Open After (Minutes) must be a whole number of minutes. Leave it empty to investigate right away.",
      ],
      [
        -5,
        "Only If Open After (Minutes) cannot be negative. Leave it empty to investigate right away.",
      ],
      [
        1441,
        "Only If Open After (Minutes) can be at most 1440 minutes (a day).",
      ],
    ])("refuses %p, saying why", async (wait: unknown, message: string) => {
      const error: unknown = await createError({
        triggerEntityType: Alert,
        investigates: true,
        onlyIfOpenAfterMinutes: wait as number,
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(message);
    });
  });

  describe("on update", () => {
    it("an edit that sets a wait is judged on it, and a good one passes", async () => {
      const good: { error: unknown } = await updateError(
        { onlyIfOpenAfterMinutes: 30 },
        [{ triggerEntityType: Incident, investigates: true }],
      );
      expect(good.error).toBeNull();

      const bad: { error: unknown } = await updateError(
        { onlyIfOpenAfterMinutes: 2000 },
        [{ triggerEntityType: Incident, investigates: true }],
      );
      expect(bad.error).toBeInstanceOf(BadDataException);
      expect((bad.error as Error).message).toContain("at most 1440");
    });

    it("clearing the wait (back to right away) is accepted, and reads no rule", async () => {
      expect(
        await updateError({ onlyIfOpenAfterMinutes: null }, [
          { triggerEntityType: Incident, investigates: true },
        ]),
      ).toEqual({ error: null, reads: 0 });
    });

    it("an edit that leaves the wait alone is not judged on it", async () => {
      expect(
        (
          await updateError({ name: "Renamed" }, [
            { triggerEntityType: Incident, investigates: true },
          ])
        ).error,
      ).toBeNull();
    });
  });

  it("the column is the rule's own, written by who may change the rule, read by every member", () => {
    const rule: AutoRemediationRule = new AutoRemediationRule();
    const access: {
      create?: Array<unknown>;
      read?: Array<unknown>;
      update?: Array<unknown>;
    } = rule.getColumnAccessControlFor("onlyIfOpenAfterMinutes") || {};

    expect(rule.getTableColumnMetadata("onlyIfOpenAfterMinutes")?.title).toBe(
      "Only If Open After (Minutes)",
    );
    expect(access.create).toEqual(
      rule.getColumnAccessControlFor("titlePattern")?.create,
    );
    expect(access.update).toEqual(
      rule.getColumnAccessControlFor("titlePattern")?.update,
    );
    expect(access.read).toEqual(
      rule.getColumnAccessControlFor("titlePattern")?.read,
    );
  });
});
