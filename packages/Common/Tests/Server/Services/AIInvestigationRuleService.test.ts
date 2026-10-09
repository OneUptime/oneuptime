import AIInvestigationRuleService from "../../../Server/Services/AIInvestigationRuleService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import AIInvestigationRule from "../../../Models/DatabaseModels/AIInvestigationRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import AIInvestigationRuleTriggerEntity from "../../../Types/AI/AIInvestigationRuleTriggerEntity";
import {
  AI_INVESTIGATION_RULE_CRITERIA_FIELDS,
  AI_INVESTIGATION_RULE_CRITERIA_FIELDS_BY_TRIGGER,
  getAIInvestigationRuleCriteriaProblem,
  isAIInvestigationRuleTriggerEntity,
} from "../../../Types/AI/AIInvestigationRuleCriteria";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
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
 * The read of the rows a caller's update may write, which the update path
 * makes before the hooks: what the suite's read of them answers
 * (stubRowsCallerMayWriteLikeFindBy).
 */
beforeEach(() => {
  stubRowsCallerMayWriteLikeFindBy(
    AIInvestigationRuleService,
    jest.spyOn(AIInvestigationRuleService, "findBy"),
  );
});

/*
 * One table holds incident and alert investigation rules, and each can only
 * match on its own kind of signal's criteria: a condition on alert
 * severities can never be true for an incident. Such a rule is refused -
 * as a condition, or in the severity column itself - instead of being saved
 * as one that silently never matches, which, since rules narrow what is
 * investigated, would quietly stop investigations.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface RuleHookAccess {
  onBeforeCreate(
    createBy: CreateBy<AIInvestigationRule>,
  ): Promise<OnCreate<AIInvestigationRule>>;
  onBeforeUpdate(
    updateBy: UpdateBy<AIInvestigationRule>,
  ): Promise<OnUpdate<AIInvestigationRule>>;
}

const hooks: RuleHookAccess =
  AIInvestigationRuleService as unknown as RuleHookAccess;

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
  values: Partial<AIInvestigationRule>,
): Promise<unknown> {
  try {
    await hooks.onBeforeCreate({
      data: Object.assign(new AIInvestigationRule(), {
        name: "Production",
        projectId: PROJECT_ID,
        ...values,
      }),
      props: { tenantId: PROJECT_ID },
    } as unknown as CreateBy<AIInvestigationRule>);
    return null;
  } catch (error) {
    return error;
  }
}

async function updateError(
  data: Record<string, unknown>,
  stored: Array<{ triggerEntityType: AIInvestigationRuleTriggerEntity }>,
): Promise<{ error: unknown; reads: number }> {
  const findBy: SpyInstance<typeof AIInvestigationRuleService.findBy> = jest
    .spyOn(AIInvestigationRuleService, "findBy")
    .mockResolvedValue(
      stored.map(
        (row: { triggerEntityType: AIInvestigationRuleTriggerEntity }) => {
          return Object.assign(new AIInvestigationRule(), {
            _id: ObjectID.generate().toString(),
            ...row,
          });
        },
      ),
    );

  try {
    await hooks.onBeforeUpdate({
      query: { _id: ObjectID.generate().toString() },
      data,
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<AIInvestigationRule>);
    return { error: null, reads: findBy.mock.calls.length };
  } catch (error) {
    return { error, reads: findBy.mock.calls.length };
  }
}

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AIInvestigationRuleService", () => {
  it("checks every record it writes against the project", () => {
    expect(AIInvestigationRuleService).toBeInstanceOf(ProjectReferencesService);
  });

  describe("on create", () => {
    it.each([
      [AIInvestigationRuleTriggerEntity.Incident, "incidentSeverities"],
      [AIInvestigationRuleTriggerEntity.Alert, "alertSeverities"],
    ])(
      "accepts a %s rule on its own severities",
      async (trigger: AIInvestigationRuleTriggerEntity, field: string) => {
        expect(
          await createError({
            triggerEntityType: trigger,
            criteria: criteriaOn(field),
          }),
        ).toBeNull();
      },
    );

    it("accepts a rule with no condition: it investigates everything", async () => {
      expect(
        await createError({
          triggerEntityType: AIInvestigationRuleTriggerEntity.Incident,
        }),
      ).toBeNull();
    });

    it.each([
      [
        AIInvestigationRuleTriggerEntity.Incident,
        "alertSeverities",
        "Alert Severities can only be used by alert investigation rules.",
      ],
      [
        AIInvestigationRuleTriggerEntity.Alert,
        "incidentSeverities",
        "Incident Severities can only be used by incident investigation rules.",
      ],
    ])(
      "refuses a %s rule conditioned on %s",
      async (
        trigger: AIInvestigationRuleTriggerEntity,
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
        triggerEntityType: AIInvestigationRuleTriggerEntity.Incident,
        alertSeverities: [ref(AlertSeverity)],
      });

      expect((error as Error).message).toBe(
        "Alert Severities can only be used by alert investigation rules.",
      );
    });

    it("refuses a rule for no kind of signal", async () => {
      const error: unknown = await createError({
        triggerEntityType: "Episode" as AIInvestigationRuleTriggerEntity,
      });

      expect((error as Error).message).toBe(
        "Trigger Entity Type must be one of Incident, Alert.",
      );
    });
  });

  describe("on update", () => {
    it("does not read the rules back for an edit that changes no condition", async () => {
      const result: { error: unknown; reads: number } = await updateError(
        { name: "Renamed", isEnabled: false },
        [{ triggerEntityType: AIInvestigationRuleTriggerEntity.Incident }],
      );

      expect(result).toEqual({ error: null, reads: 0 });
    });

    it("judges a new condition against the trigger of each rule it touches", async () => {
      const ok: { error: unknown; reads: number } = await updateError(
        { criteria: criteriaOn("incidentSeverities") },
        [{ triggerEntityType: AIInvestigationRuleTriggerEntity.Incident }],
      );

      expect(ok).toEqual({ error: null, reads: 1 });

      const refused: { error: unknown; reads: number } = await updateError(
        { criteria: criteriaOn("incidentSeverities") },
        [
          { triggerEntityType: AIInvestigationRuleTriggerEntity.Incident },
          { triggerEntityType: AIInvestigationRuleTriggerEntity.Alert },
        ],
      );

      expect((refused.error as Error).message).toBe(
        "Incident Severities can only be used by incident investigation rules.",
      );
    });

    it("judges a severity column written on its own", async () => {
      const refused: { error: unknown; reads: number } = await updateError(
        { incidentSeverities: [ref(IncidentSeverity)] },
        [{ triggerEntityType: AIInvestigationRuleTriggerEntity.Alert }],
      );

      expect(refused.error).toBeInstanceOf(BadDataException);
    });

    it("reads only the caller's project's rules", async () => {
      const findBy: SpyInstance<typeof AIInvestigationRuleService.findBy> = jest
        .spyOn(AIInvestigationRuleService, "findBy")
        .mockResolvedValue([]);

      await hooks.onBeforeUpdate({
        query: { _id: "x" },
        data: { criteria: criteriaOn("monitors") },
        props: { tenantId: PROJECT_ID },
      } as unknown as UpdateBy<AIInvestigationRule>);

      // The rules the caller may write, found in their project.
      expect(
        readsOfRowsCallerMayWrite(AIInvestigationRuleService)[0]!.query,
      ).toEqual({ _id: "x", projectId: PROJECT_ID });
      // None of them here: nothing more is read.
      expect(findBy).not.toHaveBeenCalled();
    });
  });
});

describe("what an investigation rule can match on", () => {
  it("is what the auto remediation rules can, split by the kind of signal", () => {
    expect([...AI_INVESTIGATION_RULE_CRITERIA_FIELDS].sort()).toEqual(
      [...RULE_CRITERIA_FIELDS_BY_MODEL["AutoRemediationRule"]!].sort(),
    );
    expect(
      [...RULE_CRITERIA_FIELDS_BY_MODEL["AIInvestigationRule"]!].sort(),
    ).toEqual([...AI_INVESTIGATION_RULE_CRITERIA_FIELDS].sort());
    expect(
      AI_INVESTIGATION_RULE_CRITERIA_FIELDS_BY_TRIGGER[
        AIInvestigationRuleTriggerEntity.Incident
      ],
    ).not.toContain("alertSeverities");
    expect(
      AI_INVESTIGATION_RULE_CRITERIA_FIELDS_BY_TRIGGER[
        AIInvestigationRuleTriggerEntity.Alert
      ],
    ).not.toContain("incidentSeverities");
  });

  it("knows the two kinds of signal, and nothing else", () => {
    expect(isAIInvestigationRuleTriggerEntity("Incident")).toBe(true);
    expect(isAIInvestigationRuleTriggerEntity("Alert")).toBe(true);
    expect(isAIInvestigationRuleTriggerEntity("incident")).toBe(false);
    expect(isAIInvestigationRuleTriggerEntity(undefined)).toBe(false);
  });

  it("leaves malformed criteria to the shared validation", () => {
    expect(
      getAIInvestigationRuleCriteriaProblem({
        triggerEntityType: AIInvestigationRuleTriggerEntity.Incident,
        criteria: { filters: "not a list" },
      }),
    ).toBeNull();
    expect(
      getAIInvestigationRuleCriteriaProblem({
        triggerEntityType: AIInvestigationRuleTriggerEntity.Incident,
        criteria: { filters: [{ field: 42 }, null, { field: "unknown" }] },
      }),
    ).toBeNull();
  });
});
