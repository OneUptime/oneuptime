import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY,
  DATA_SECURITY_AI_RULE_DOES_NOTHING_MESSAGE,
  DataSecurityAiAutonomy,
  DataSecurityAiWork,
} from "../../../Types/DataSecurity/DataSecurityAi";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * WHAT THE AI RULE SERVICE HOLDS A DATA SECURITY AI RULE TO (#10364) - the
 * dashboard, the API and Terraform alike: it says what it does in its four
 * Data Security columns, each an answer its work offers, at least one on,
 * the rule's defaults written for what a create leaves out; its condition
 * lists hold only values that exist; and only a Data Security AI rule holds
 * them - an incident's rule gets neither its columns nor its conditions.
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

const DATA_SECURITY: AutoRemediationTriggerEntity =
  AutoRemediationTriggerEntity.DataSecurityIssue;

async function create(
  values: Partial<AutoRemediationRule>,
): Promise<{ rule: AutoRemediationRule; error: unknown }> {
  const rule: AutoRemediationRule = Object.assign(new AutoRemediationRule(), {
    name: "Production stores",
    projectId: PROJECT_ID,
    ...values,
  });

  try {
    await hooks.onBeforeCreate({
      data: rule,
      props: { tenantId: PROJECT_ID },
    } as unknown as CreateBy<AutoRemediationRule>);
    return { rule, error: null };
  } catch (error) {
    return { rule, error };
  }
}

async function updateError(
  data: Record<string, unknown>,
  stored: Partial<AutoRemediationRule>,
): Promise<unknown> {
  const rule: AutoRemediationRule = Object.assign(new AutoRemediationRule(), {
    _id: ObjectID.generate().toString(),
    ...stored,
  });

  jest.spyOn(AutoRemediationRuleService, "findBy").mockResolvedValue([rule]);

  try {
    await hooks.onBeforeUpdate({
      query: { _id: rule._id },
      data,
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<AutoRemediationRule>);
    return null;
  } catch (error) {
    return error;
  }
}

describe("a new Data Security AI rule", () => {
  it("that says nothing of its work does what the project does by default for what it matches", async () => {
    const { rule, error } = await create({ triggerEntityType: DATA_SECURITY });

    expect(error).toBeNull();
    expect({
      analyze: rule.dataSecurityAnalyze,
      contain: rule.dataSecurityContain,
      fix: rule.dataSecurityFix,
      judge: rule.dataSecurityJudge,
    }).toEqual({
      analyze: DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY[DataSecurityAiWork.Analyze],
      contain: DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY[DataSecurityAiWork.Contain],
      fix: DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY[DataSecurityAiWork.Fix],
      judge: DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY[DataSecurityAiWork.Judge],
    });
  });

  it("keeps the answers it gives, and fills in only the rest", async () => {
    const { rule, error } = await create({
      triggerEntityType: DATA_SECURITY,
      dataSecurityAnalyze: DataSecurityAiAutonomy.Off,
      dataSecurityContain: DataSecurityAiAutonomy.WithoutAsking,
    });

    expect(error).toBeNull();
    expect(rule.dataSecurityAnalyze).toBe(DataSecurityAiAutonomy.Off);
    expect(rule.dataSecurityContain).toBe(DataSecurityAiAutonomy.WithoutAsking);
    expect(rule.dataSecurityFix).toBe(DataSecurityAiAutonomy.Suggest);
  });

  it("is not held to Investigates and Fixes, which it does not read", async () => {
    const { error } = await create({
      triggerEntityType: DATA_SECURITY,
      investigates: false,
      fixes: false,
    });

    expect(error).toBeNull();
  });

  it("that turns every kind of work off is refused: it would do nothing, and still narrow what AI works on", async () => {
    const { error } = await create({
      triggerEntityType: DATA_SECURITY,
      dataSecurityAnalyze: DataSecurityAiAutonomy.Off,
      dataSecurityContain: DataSecurityAiAutonomy.Off,
      dataSecurityFix: DataSecurityAiAutonomy.Off,
      dataSecurityJudge: DataSecurityAiAutonomy.Off,
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      DATA_SECURITY_AI_RULE_DOES_NOTHING_MESSAGE,
    );
  });

  it("that asks a person to approve an analysis is refused: there is nothing to approve", async () => {
    const { error } = await create({
      triggerEntityType: DATA_SECURITY,
      dataSecurityAnalyze: DataSecurityAiAutonomy.Suggest,
    });

    expect((error as Error).message).toBe(
      "Data Security: Analyze must be one of Off, WithoutAsking.",
    );
  });

  it("matches on the catalogs' own values, and is refused one that does not exist", async () => {
    expect(
      (
        await create({
          triggerEntityType: DATA_SECURITY,
          dataSecuritySeverities: ["Critical", "High"],
          dataStoreEnvironments: ["Production"],
          dataCategories: ["Secrets and credentials"],
        })
      ).error,
    ).toBeNull();

    const { error } = await create({
      triggerEntityType: DATA_SECURITY,
      dataSecuritySeverities: ["Severe"],
    });

    expect((error as Error).message).toContain(
      'Data Security Severities can only hold Critical, High, Medium or Low; "Severe" is not one of them.',
    );
  });

  it("may match a telemetry store's service, as the telemetry rules do", async () => {
    expect(
      (
        await create({
          triggerEntityType: DATA_SECURITY,
          serviceNamePattern: "^checkout",
        })
      ).error,
    ).toBeNull();
  });

  it("cannot match on an incident's criteria", async () => {
    const { error } = await create({
      triggerEntityType: DATA_SECURITY,
      criteria: {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: "incidentSeverities",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [ObjectID.generate().toString()],
          },
        ],
      },
    });

    expect((error as Error).message).toBe(
      "Incident Severities can only be used by incident AI rules.",
    );
  });
});

describe("another kind of AI rule", () => {
  it("cannot say what OneUptime AI does with Data Security issues", async () => {
    const { error } = await create({
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
      investigates: true,
      dataSecurityContain: DataSecurityAiAutonomy.WithoutAsking,
    });

    expect((error as Error).message).toBe(
      "Data Security: Contain can only be used by Data Security AI rules.",
    );
  });

  it("cannot match on a Data Security issue's conditions", async () => {
    const { error } = await create({
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
      investigates: true,
      dataSecurityChecks: ["public-read"],
    });

    expect((error as Error).message).toBe(
      "Data Security Checks can only be used by Data Security AI rules.",
    );
  });

  it("keeps its work's defaults out of the Data Security columns", async () => {
    const { rule, error } = await create({
      triggerEntityType: AutoRemediationTriggerEntity.Profile,
      investigates: true,
    });

    expect(error).toBeNull();
    expect(rule.dataSecurityAnalyze).toBeUndefined();
    expect(rule.dataSecurityContain).toBeUndefined();
  });
});

describe("an edit of a Data Security AI rule", () => {
  const STORED: Partial<AutoRemediationRule> = {
    triggerEntityType: DATA_SECURITY,
    dataSecurityAnalyze: DataSecurityAiAutonomy.Off,
    dataSecurityContain: DataSecurityAiAutonomy.Suggest,
    dataSecurityFix: DataSecurityAiAutonomy.Off,
    dataSecurityJudge: DataSecurityAiAutonomy.Off,
  };

  it("is judged with what the rule holds: turning its last work off is refused", async () => {
    expect(
      ((await updateError(
        { dataSecurityContain: DataSecurityAiAutonomy.Off },
        STORED,
      )) as Error).message,
    ).toBe(DATA_SECURITY_AI_RULE_DOES_NOTHING_MESSAGE);
  });

  it("that turns one kind of work on while turning another off saves", async () => {
    expect(
      await updateError(
        {
          dataSecurityContain: DataSecurityAiAutonomy.Off,
          dataSecurityFix: DataSecurityAiAutonomy.WithoutAsking,
        },
        STORED,
      ),
    ).toBeNull();
  });

  it("is refused an answer its work does not offer, or a value that does not exist", async () => {
    expect(
      ((await updateError(
        { dataSecurityJudge: "Sometimes" },
        STORED,
      )) as Error).message,
    ).toBe("Data Security: Judge must be one of Off, Suggest, WithoutAsking.");
    expect(
      ((await updateError(
        { dataStoreKinds: ["Floppy Disk"] },
        STORED,
      )) as Error).message,
    ).toContain("Data Store Kinds can only hold");
  });

  it("of an incident's rule cannot add Data Security work to it", async () => {
    expect(
      ((await updateError(
        { dataSecurityAnalyze: DataSecurityAiAutonomy.WithoutAsking },
        {
          triggerEntityType: AutoRemediationTriggerEntity.Incident,
          investigates: true,
          fixes: true,
        },
      )) as Error).message,
    ).toBe("Data Security: Analyze can only be used by Data Security AI rules.");
  });
});
