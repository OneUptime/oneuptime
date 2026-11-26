import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceEnvironment } from "../../../Types/Cloud/CloudResourceEnvironment";
import { CloudSavingsActionGroup } from "../../../Types/Cloud/CloudSavingsAction";
import {
  CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT,
  CLOUD_SAVINGS_AI_RULE_DEFAULT_AUTONOMY,
  CLOUD_SAVINGS_AI_RULE_NEVER_ACTS_MESSAGE,
  CloudSavingsAiAutonomy,
} from "../../../Types/Cloud/CloudSavingsAi";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
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
 * WHAT THE AI RULE SERVICE HOLDS AN AI RULE FOR SAVINGS TO (#11010) - the
 * Dashboard, the API and Terraform alike: it says what OneUptime AI does
 * with a saving (Off, propose, or act without asking) and up to what a
 * month, with its default written for what a create leaves out; its
 * matching lists hold only values that exist; one that would act without
 * asking only on production is refused, since it would never act; and only
 * an AI rule for savings holds these columns.
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

const CLOUD_SAVING: AutoRemediationTriggerEntity =
  AutoRemediationTriggerEntity.CloudSaving;

async function create(
  values: Partial<AutoRemediationRule>,
): Promise<{ rule: AutoRemediationRule; error: unknown }> {
  const rule: AutoRemediationRule = Object.assign(new AutoRemediationRule(), {
    name: "Stop idle development resources",
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

describe("a new AI rule for savings", () => {
  it("that says nothing of what it does proposes, under the default limit", async () => {
    const { rule, error } = await create({ triggerEntityType: CLOUD_SAVING });

    expect(error).toBeNull();
    expect(rule.cloudSavingAutonomy).toBe(
      CLOUD_SAVINGS_AI_RULE_DEFAULT_AUTONOMY,
    );
    expect(CLOUD_SAVINGS_AI_RULE_DEFAULT_AUTONOMY).toBe(
      CloudSavingsAiAutonomy.Suggest,
    );
    expect(rule.cloudSavingMonthlyLimit).toBe(
      CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT,
    );
  });

  it("keeps what it says: act without asking on idle non-production, up to its own limit", async () => {
    const { rule, error } = await create({
      triggerEntityType: CLOUD_SAVING,
      cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
      cloudSavingMonthlyLimit: 120,
      cloudSavingActionGroups: [CloudSavingsActionGroup.Stop],
      cloudSavingEnvironments: [CloudResourceEnvironment.NonProduction],
      cloudSavingProviders: [CloudProvider.AWS, CloudProvider.GCP],
    });

    expect(error).toBeNull();
    expect(rule.cloudSavingAutonomy).toBe(CloudSavingsAiAutonomy.WithoutAsking);
    expect(rule.cloudSavingMonthlyLimit).toBe(120);
  });

  it("is not held to Investigates and Fixes, which it does not read", async () => {
    expect(
      (
        await create({
          triggerEntityType: CLOUD_SAVING,
          investigates: false,
          fixes: false,
        })
      ).error,
    ).toBeNull();
  });

  it("that would act without asking only on production is refused: it would never act", async () => {
    const { error } = await create({
      triggerEntityType: CLOUD_SAVING,
      cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
      cloudSavingEnvironments: [CloudResourceEnvironment.Production],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      CLOUD_SAVINGS_AI_RULE_NEVER_ACTS_MESSAGE,
    );
  });

  it("matches on values that exist, and is refused one that does not", async () => {
    for (const [values, words] of [
      [{ cloudSavingActionGroups: ["Teleport"] }, "Cloud Saving: Changes"],
      [{ cloudSavingEnvironments: ["Staging"] }, "Cloud Saving: Environments"],
      [{ cloudSavingProviders: ["oracle"] }, "Cloud Saving: Clouds"],
      [{ cloudSavingAutonomy: "Always" }, "Cloud Saving: Autonomy"],
      [{ cloudSavingMonthlyLimit: -1 }, "Cloud Saving: Monthly Limit"],
    ] as Array<[Partial<AutoRemediationRule>, string]>) {
      const { error } = await create({
        triggerEntityType: CLOUD_SAVING,
        ...values,
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(words);
    }
  });

  it("an incident's rule may not hold the savings columns", async () => {
    const { error } = await create({
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
      cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "The Cloud Saving settings can only be used by AI rules for savings.",
    );
  });
});

describe("changing an AI rule for savings", () => {
  const stored: Partial<AutoRemediationRule> = {
    triggerEntityType: CLOUD_SAVING,
    cloudSavingAutonomy: CloudSavingsAiAutonomy.Suggest,
    cloudSavingMonthlyLimit: 500,
    cloudSavingEnvironments: [CloudResourceEnvironment.Production],
  };

  it("is judged over what it holds: acting without asking on production alone is refused", async () => {
    const error: unknown = await updateError(
      { cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking },
      stored,
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      CLOUD_SAVINGS_AI_RULE_NEVER_ACTS_MESSAGE,
    );
  });

  it("may act without asking once it covers non-production", async () => {
    expect(
      await updateError(
        {
          cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
          cloudSavingEnvironments: [CloudResourceEnvironment.NonProduction],
        },
        stored,
      ),
    ).toBeNull();
  });

  it("a limit past the most is refused", async () => {
    expect(
      (
        (await updateError(
          { cloudSavingMonthlyLimit: 100000000 },
          stored,
        )) as Error
      ).message,
    ).toContain("Cloud Saving: Monthly Limit must be a number from 0 to");
  });

  it("an incident's rule may not be given the savings columns", async () => {
    const error: unknown = await updateError(
      { cloudSavingActionGroups: [CloudSavingsActionGroup.Stop] },
      { triggerEntityType: AutoRemediationTriggerEntity.Incident },
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "The Cloud Saving settings can only be used by AI rules for savings.",
    );
  });
});
