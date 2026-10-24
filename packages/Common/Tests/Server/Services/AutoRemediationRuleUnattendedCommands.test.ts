import AutoRemediationRuleService, {
  Service as AutoRemediationRuleServiceClass,
} from "../../../Server/Services/AutoRemediationRuleService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";

/*
 * ANYONE WHO MAY WRITE A RULE MAY LET ONEUPTIME AI RUN ITS COMMANDS WITHOUT
 * ASKING.
 *
 * While runbook credentials existed, an SSH command a rule's run composed
 * ran with whichever credential assigned to the rule's Runners OneUptime AI
 * picked. So a rule set to fix without asking (Full Auto, with a command
 * allowlist) was saved - turned on, or widened with a pattern or a Runner -
 * only by someone who could read runbook credentials
 * (AiRemediationCredentialUse), and never by a workflow's step.
 *
 * Runbook credentials were removed, and OneUptime AI composes no SSH: its
 * commands run as Bash on the rule's own Runner, or through the AI agent on
 * the affected cluster or host, with no credential. The rule's own
 * permissions decide who saves it, and nothing more is asked or read. What
 * an update still reads is the agent Runner check's: a kubernetes-agent
 * Runner a rule already holds may be re-posted, never added.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "ca000000-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("ca000000-0000-4000-8000-000000000002");
const RUNNER_A: string = "cb000000-0000-4000-8000-000000000001";
const RUNNER_B: string = "cb000000-0000-4000-8000-000000000002";

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

// Someone in the project with `permissions`.
function editor(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
            };
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

// May write rules, and nothing else.
const RULE_EDITOR: Array<Permission> = [
  Permission.CreateAutoRemediationRule,
  Permission.EditAutoRemediationRule,
];

function runners(ids: Array<string>): Array<Runner> {
  return ids.map((id: string): Runner => {
    return { _id: id, id: new ObjectID(id) } as unknown as Runner;
  });
}

// What a rule fixes with and how: the settings that decide it runs unasked.
type CommandSettings = Pick<
  AutoRemediationRule,
  | "isEnabled"
  | "remediationAction"
  | "aiComposesCommands"
  | "executionMode"
  | "commandRunners"
> & { commandAllowlist?: unknown };

// A rule that runs OneUptime AI's commands without asking.
function unattended(overrides: Partial<CommandSettings> = {}): CommandSettings {
  return {
    remediationAction: AutoRemediationAction.OneUptimeAI,
    aiComposesCommands: true,
    executionMode: AutoRemediationExecutionMode.FullAuto,
    commandAllowlist: ["systemctl restart nginx"],
    commandRunners: runners([RUNNER_A]),
    ...overrides,
  };
}

async function create(
  settings: CommandSettings,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  const rule: AutoRemediationRule = new AutoRemediationRule();
  rule.name = "Restart web on high latency";
  rule.projectId = PROJECT_ID;
  rule.triggerEntityType = AutoRemediationTriggerEntity.Incident;
  Object.assign(rule, settings);

  try {
    await hooks.onBeforeCreate({ data: rule, props: props });
    return null;
  } catch (error) {
    return error;
  }
}

describe("AutoRemediationRuleService - fixing without asking is the rule's own setting", () => {
  let ruleFind: jest.SpyInstance;
  let runnerFind: jest.SpyInstance;

  beforeEach(() => {
    stubProjectDirectory({});

    const storedRule: JSONObject = {
      _id: RULE_ID.toString(),
      id: RULE_ID,
      ...unattended({ executionMode: AutoRemediationExecutionMode.Suggest }),
    } as unknown as JSONObject;

    ruleFind = jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockImplementation(async (): Promise<Array<AutoRemediationRule>> => {
        return [storedRule as unknown as AutoRemediationRule];
      });

    // The editor may write the rule stored.
    stubRowsCallerMayWrite(AutoRemediationRuleService, () => {
      return [storedRule];
    });

    /*
     * No Runner these rules name is a cluster's in-cluster agent, and each
     * one runs OneUptime AI's commands already, so a pick writes nothing.
     */
    runnerFind = jest.spyOn(RunnerService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function update(
    data: JSONObject,
    props: DatabaseCommonInteractionProps,
  ): Promise<unknown> {
    try {
      await hooks.onBeforeUpdate({
        query: { _id: RULE_ID.toString() },
        data: data,
        props: props,
        skip: 0,
        limit: 1,
      } as unknown as UpdateBy<AutoRemediationRule>);
      return null;
    } catch (error) {
      return error;
    }
  }

  it("a rule editor creates a rule that fixes without asking, whatever shape its allowlist is saved in", async () => {
    for (const commandAllowlist of [
      ["systemctl restart nginx"],
      "systemctl restart *",
      '["systemctl restart *"]',
    ]) {
      expect(
        await create(unattended({ commandAllowlist }), editor(RULE_EDITOR)),
      ).toBeNull();
    }
  });

  it("a switched-off rule, and turning it on, ask nothing more either", async () => {
    expect(
      await create(unattended({ isEnabled: false }), editor(RULE_EDITOR)),
    ).toBeNull();
    expect(await update({ isEnabled: true }, editor(RULE_EDITOR))).toBeNull();
  });

  it("a rule editor turns fixing without asking on, or widens it, and the change reads no rule", async () => {
    for (const data of [
      { executionMode: AutoRemediationExecutionMode.FullAuto },
      { remediationAction: AutoRemediationAction.OneUptimeAI },
      { aiComposesCommands: true },
      { commandAllowlist: ["systemctl restart nginx", "reboot"] },
      { commandAllowlist: "systemctl restart *" },
      { commandRunners: [{ _id: RUNNER_A }, { _id: RUNNER_B }] },
      { runnerId: RUNNER_B },
      { runner: { _id: RUNNER_B } },
    ] as Array<JSONObject>) {
      expect({ data, thrown: await update(data, editor(RULE_EDITOR)) }).toEqual(
        { data, thrown: null },
      );
    }

    // The agent Runner check reads the rules only for an agent Runner named.
    expect(ruleFind).not.toHaveBeenCalled();
  });

  it("the Runner a rule editor picks is offered OneUptime AI's commands, in the rule's project", async () => {
    expect(
      await update({ runnerId: RUNNER_B }, editor(RULE_EDITOR)),
    ).toBeNull();

    // One read for the agent Runner check, one for the pick, both as OneUptime.
    const reads: Array<JSONObject> = runnerFind.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    );
    const pick: JSONObject | undefined = reads.find((read: JSONObject) => {
      return (read["query"] as JSONObject)["canRunAiCommands"] === false;
    });
    expect(pick).toBeDefined();
    expect((pick!["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
  });

  it("the module that asked, and the rule's command settings change it read, are gone", () => {
    expect(
      fs.existsSync(
        path.join(
          __dirname,
          "../../../Server/Utils/AutoRemediation/AiRemediationCredentialUse.ts",
        ),
      ),
    ).toBe(false);
    expect(AutoRemediationRuleServiceClass).not.toHaveProperty(
      "getCommandSettingsChange",
    );
  });
});

/*
 * A workflow's step acts as a Project Admin of its project
 * (WorkflowPrincipal). It was refused a rule that runs OneUptime AI's
 * commands without asking, because the read of runbook credentials that
 * needed was never lent to a step. Nothing needs that read now: a step
 * saves such a rule as any rule editor does, and nobody is looked up.
 */
describe("AutoRemediationRuleService - a workflow's step saving a rule that runs AI commands without asking", () => {
  const WORKFLOW_ID: ObjectID = new ObjectID(
    "ca000000-0000-4000-8000-000000000031",
  );

  beforeEach(() => {
    stubProjectDirectory({});

    // No Runner these rules name is a cluster's in-cluster agent.
    jest.spyOn(RunnerService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function step(): DatabaseCommonInteractionProps {
    return WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: WORKFLOW_ID,
      workflowName: "Restart web when it is slow",
    });
  }

  it("saves it, looking nobody up", async () => {
    const lookUp: jest.SpyInstance = jest.spyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    );

    expect(await create(unattended(), step())).toBeNull();
    expect(
      await create(
        unattended({ executionMode: AutoRemediationExecutionMode.Suggest }),
        step(),
      ),
    ).toBeNull();
    expect(lookUp).not.toHaveBeenCalled();
  });
});

describe("AutoRemediationRuleService - a change reads its rules once, and writes only those", () => {
  const AGENT_RUNNER: string = "cb000000-0000-4000-8000-000000000009";
  const SECOND_RULE: string = "ca000000-0000-4000-8000-000000000009";

  let ruleFind: jest.SpyInstance;
  let rulesRead: Array<JSONObject>;

  function rule(id: string, runnerIds: Array<string>): JSONObject {
    return {
      _id: id,
      id: new ObjectID(id),
      ...unattended({
        executionMode: AutoRemediationExecutionMode.Suggest,
        commandRunners: runners(runnerIds),
      }),
    } as unknown as JSONObject;
  }

  beforeEach(() => {
    stubProjectDirectory({});

    rulesRead = [rule(RULE_ID.toString(), [RUNNER_A, AGENT_RUNNER])];

    ruleFind = jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockImplementation(async (): Promise<Array<AutoRemediationRule>> => {
        return rulesRead as unknown as Array<AutoRemediationRule>;
      });

    // The editor may write the rules read.
    stubRowsCallerMayWrite(AutoRemediationRuleService, () => {
      return rulesRead;
    });

    // The Runner the change names is a cluster's in-cluster agent.
    jest
      .spyOn(RunnerService, "findKubernetesAgentRunners")
      .mockImplementation(async (value: unknown): Promise<Array<Runner>> => {
        const named: Array<string> = (
          (value as Array<{ _id: string }> | undefined) || []
        ).map((runner: { _id: string }): string => {
          return runner._id;
        });

        return named.includes(AGENT_RUNNER)
          ? ([
              {
                _id: AGENT_RUNNER,
                id: new ObjectID(AGENT_RUNNER),
                name: "agent",
              },
            ] as unknown as Array<Runner>)
          : [];
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function change(
    data: JSONObject,
    props: DatabaseCommonInteractionProps,
    query: JSONObject = { _id: RULE_ID.toString() },
    window: { skip: number; limit: number } = { skip: 0, limit: 1 },
  ): UpdateBy<AutoRemediationRule> {
    return {
      query: query,
      data: data,
      props: props,
      skip: window.skip,
      limit: window.limit,
    } as unknown as UpdateBy<AutoRemediationRule>;
  }

  it("re-posting the agent Runner a rule holds reads the rule once, and passes for any rule editor", async () => {
    // Fix without asking, re-posting the agent Runner the rule holds.
    await expect(
      hooks.onBeforeUpdate(
        change(
          {
            executionMode: AutoRemediationExecutionMode.FullAuto,
            commandRunners: runners([RUNNER_A, AGENT_RUNNER]),
          },
          editor(RULE_EDITOR),
        ),
      ),
    ).resolves.toBeDefined();

    expect(ruleFind).toHaveBeenCalledTimes(1);
  });

  it("still refuses to add an agent Runner a rule does not hold", async () => {
    rulesRead = [rule(RULE_ID.toString(), [RUNNER_A])];

    await expect(
      hooks.onBeforeUpdate(
        change(
          { commandRunners: runners([RUNNER_A, AGENT_RUNNER]) },
          editor(RULE_EDITOR),
        ),
      ),
    ).rejects.toThrow('Runner "agent" is the in-cluster Runner');
  });

  it("reads nothing when the change names no agent Runner, even one that turns fixing without asking on", async () => {
    await hooks.onBeforeUpdate(
      change(
        { executionMode: AutoRemediationExecutionMode.FullAuto },
        editor(RULE_EDITOR),
      ),
    );

    expect(ruleFind).not.toHaveBeenCalled();
  });

  it("holds the change to the one rule it read", async () => {
    const updateBy: UpdateBy<AutoRemediationRule> = change(
      { commandRunners: runners([RUNNER_A, AGENT_RUNNER]) },
      editor(RULE_EDITOR),
    );

    await hooks.onBeforeUpdate(updateBy);

    expect(ruleFind).toHaveBeenCalledTimes(1);
    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(
      RULE_ID.toString(),
    );
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(1);
  });

  it("holds a bulk change to the rules read in its window, so none it did not check is written", async () => {
    rulesRead = [
      rule(RULE_ID.toString(), [RUNNER_A, AGENT_RUNNER]),
      rule(SECOND_RULE, [RUNNER_A, AGENT_RUNNER]),
    ];

    const updateBy: UpdateBy<AutoRemediationRule> = change(
      { commandRunners: runners([RUNNER_A, AGENT_RUNNER]) },
      editor(RULE_EDITOR),
      { projectId: PROJECT_ID },
      { skip: 0, limit: 15000 },
    );

    await hooks.onBeforeUpdate(updateBy);

    const query: JSONObject = updateBy.query as unknown as JSONObject;
    const held: Array<string> = Object.values(
      (query["_id"] as unknown as { objectLiteralParameters: JSONObject })
        .objectLiteralParameters,
    ).flat() as Array<string>;

    expect(held.sort()).toEqual([RULE_ID.toString(), SECOND_RULE].sort());
    expect(updateBy.limit).toBe(2);
  });

  it("refuses a bulk change when any rule it reads does not hold the agent Runner", async () => {
    rulesRead = [
      rule(RULE_ID.toString(), [RUNNER_A, AGENT_RUNNER]),
      rule(SECOND_RULE, [RUNNER_A]),
    ];

    await expect(
      hooks.onBeforeUpdate(
        change(
          { commandRunners: runners([RUNNER_A, AGENT_RUNNER]) },
          editor(RULE_EDITOR),
          { projectId: PROJECT_ID },
          { skip: 0, limit: 15000 },
        ),
      ),
    ).rejects.toThrow('Runner "agent" is the in-cluster Runner');
  });
});
