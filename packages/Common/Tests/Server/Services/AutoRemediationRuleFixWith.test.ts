import AutoRemediationRuleService, {
  Service as AutoRemediationRuleServiceClass,
} from "../../../Server/Services/AutoRemediationRuleService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
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

/*
 * What an Auto Remediation Rule fixes with - its Fix With: OneUptime AI (the
 * column's default) or its runbooks.
 *
 * The dashboard always says. An API or Terraform client written before
 * rules had a Fix With does not, and a rule it creates with runbooks and no
 * AI flag meant "run these runbooks", as it did then - so that is what it
 * gets, not the column's default. A Fix With that is given must be one this
 * build knows, on create and on every edit.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
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

function runbook(): Runbook {
  const model: Runbook = new Runbook();
  model._id = RUNBOOK_ID.toString();
  return model;
}

function rule(values: Partial<AutoRemediationRule>): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), {
    name: "Restart checkout",
    projectId: PROJECT_ID,
    ...values,
  });
}

async function created(
  values: Partial<AutoRemediationRule>,
): Promise<AutoRemediationRule> {
  const result: OnCreate<AutoRemediationRule> = await hooks.onBeforeCreate({
    data: rule(values),
    props: { tenantId: PROJECT_ID },
  } as unknown as CreateBy<AutoRemediationRule>);

  return result.createBy.data as AutoRemediationRule;
}

/*
 * A project owner, who may read runbook credentials - so an edit that lets
 * OneUptime AI run a rule's commands without asking needs nothing more
 * (AutoRemediationRuleUnattendedCommands.test.ts has the editors who may not).
 */
const OWNER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
        },
      ],
    },
  },
} as unknown as DatabaseCommonInteractionProps;

async function updateError(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps,
): Promise<unknown> {
  try {
    await hooks.onBeforeUpdate({
      query: { _id: ObjectID.generate().toString() },
      data,
      props,
    } as unknown as UpdateBy<AutoRemediationRule>);
    return null;
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  stubProjectDirectory({});
  jest.spyOn(RunnerService, "findKubernetesAgentRunners").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new rule's Fix With", () => {
  it.each([
    [AutoRemediationAction.OneUptimeAI, { runbooks: [] }],
    [AutoRemediationAction.Runbooks, { runbooks: [] }],
    [AutoRemediationAction.OneUptimeAI, { runbooks: [] as Array<Runbook> }],
  ])(
    "is what the request says: %s",
    async (
      action: AutoRemediationAction,
      values: Partial<AutoRemediationRule>,
    ) => {
      expect(
        (await created({ ...values, remediationAction: action }))
          .remediationAction,
      ).toBe(action);
    },
  );

  it("keeps OneUptime AI that was asked for, even with runbooks attached", async () => {
    expect(
      (
        await created({
          remediationAction: AutoRemediationAction.OneUptimeAI,
          runbooks: [runbook()],
        })
      ).remediationAction,
    ).toBe(AutoRemediationAction.OneUptimeAI);
  });

  it("is Runbooks for an older client's rule with runbooks and no AI flag", async () => {
    expect((await created({ runbooks: [runbook()] })).remediationAction).toBe(
      AutoRemediationAction.Runbooks,
    );
  });

  it.each([
    ["AI composes commands", { aiComposesCommands: true }],
    ["AI picks the runbook", { aiSelectsRunbook: true }],
  ])(
    "is OneUptime AI for an older client's rule where %s, so it keeps doing that",
    async (_name: string, flags: Partial<AutoRemediationRule>) => {
      expect(
        (await created({ ...flags, runbooks: [runbook()] })).remediationAction,
      ).toBe(AutoRemediationAction.OneUptimeAI);
    },
  );

  it("is OneUptime AI for a rule that names nothing to run", async () => {
    expect((await created({})).remediationAction).toBe(
      AutoRemediationAction.OneUptimeAI,
    );
  });

  it("refuses one this build does not know", async () => {
    await expect(
      created({
        remediationAction: "Magic" as AutoRemediationAction,
      }),
    ).rejects.toThrow(BadDataException);
    await expect(
      created({ remediationAction: "Magic" as AutoRemediationAction }),
    ).rejects.toThrow("Fix With must be one of: OneUptimeAI, Runbooks.");
  });
});

describe("an edit's Fix With", () => {
  it("is accepted when it is one this build knows, and not read back", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      jest.spyOn(AutoRemediationRuleService, "findBy");

    for (const action of Object.values(AutoRemediationAction)) {
      expect(
        await updateError({ remediationAction: action }, OWNER),
      ).toBeNull();
    }

    expect(findBy).not.toHaveBeenCalled();
  });

  it("may be left out", async () => {
    expect(await updateError({ name: "Renamed" })).toBeNull();
  });

  it.each([["Magic"], [""], [null]])(
    "refuses %j",
    async (value: string | null) => {
      const error: unknown = await updateError({ remediationAction: value });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        "Fix With must be one of: OneUptimeAI, Runbooks.",
      );
    },
  );
});

describe("getRemediationActionOnCreate", () => {
  it("reads the request alone, without the database", () => {
    expect(
      AutoRemediationRuleServiceClass.getRemediationActionOnCreate({
        runbooks: [runbook()],
      } as AutoRemediationRule),
    ).toBe(AutoRemediationAction.Runbooks);
    expect(
      AutoRemediationRuleServiceClass.getRemediationActionOnCreate({
        runbooks: undefined,
      } as unknown as AutoRemediationRule),
    ).toBe(AutoRemediationAction.OneUptimeAI);
  });
});
