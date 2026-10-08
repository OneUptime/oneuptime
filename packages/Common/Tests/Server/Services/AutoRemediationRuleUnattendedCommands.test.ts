import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import AiRemediationCredentialUse, {
  RuleCommandSettings,
} from "../../../Server/Utils/AutoRemediation/AiRemediationCredentialUse";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A RULE LETS ONEUPTIME AI RUN ITS COMMANDS WITHOUT ASKING ONLY WHEN WHOEVER
 * SAVES IT MAY READ RUNBOOK CREDENTIALS.
 *
 * A rule that has OneUptime AI compose commands, set to fix without asking
 * (Full Auto) with a command allowlist, runs the commands its runs compose
 * with nobody approving them - and an SSH command runs with whichever
 * credential assigned to the rule's Runners OneUptime AI picks. Approving
 * one such plan needs the approver's read of runbook credentials; letting
 * every one run unattended needs the same of whoever turns that on, or
 * widens it (more allowlist patterns, more Runners). An edit that keeps
 * what a rule already runs - the dashboard posts every field back - asks
 * nothing.
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

// A rule editor: may write rules, and - with ReadRunbookCredential - read credentials.
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

const RULE_EDITOR: Array<Permission> = [
  Permission.CreateAutoRemediationRule,
  Permission.EditAutoRemediationRule,
];

const RULE_EDITOR_WHO_READS_CREDENTIALS: Array<Permission> = [
  ...RULE_EDITOR,
  Permission.ReadRunbookCredential,
];

function runners(ids: Array<string>): Array<Runner> {
  return ids.map((id: string): Runner => {
    return { _id: id, id: new ObjectID(id) } as unknown as Runner;
  });
}

// A rule that runs OneUptime AI's commands without asking.
function unattended(
  overrides: Partial<RuleCommandSettings> = {},
): RuleCommandSettings {
  return {
    remediationAction: AutoRemediationAction.OneUptimeAI,
    aiComposesCommands: true,
    executionMode: AutoRemediationExecutionMode.FullAuto,
    commandAllowlist: ["systemctl restart nginx"],
    commandRunners: runners([RUNNER_A]),
    ...overrides,
  };
}

describe("AiRemediationCredentialUse.runsCommandsWithoutAsking", () => {
  it("is a rule of OneUptime AI's commands, Full Auto, with an allowlist", () => {
    expect(
      AiRemediationCredentialUse.runsCommandsWithoutAsking(unattended()),
    ).toBe(true);
    // A rule saved before Fix With existed reads as OneUptime AI.
    expect(
      AiRemediationCredentialUse.runsCommandsWithoutAsking(
        unattended({ remediationAction: undefined }),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "asks before fixing",
      { executionMode: AutoRemediationExecutionMode.Suggest },
    ],
    ["has no allowlist", { commandAllowlist: [] }],
    ["has only blank allowlist patterns", { commandAllowlist: ["  "] }],
    ["has a null allowlist", { commandAllowlist: undefined }],
    ["does not compose commands", { aiComposesCommands: false }],
    [
      "fixes with runbooks",
      { remediationAction: AutoRemediationAction.Runbooks },
    ],
  ])(
    "is not a rule that %s",
    (_label: string, overrides: Partial<RuleCommandSettings>) => {
      expect(
        AiRemediationCredentialUse.runsCommandsWithoutAsking(
          unattended(overrides),
        ),
      ).toBe(false);
    },
  );
});

describe("AiRemediationCredentialUse.widensCommandsWithoutAsking", () => {
  it("a new rule that runs commands without asking widens it", () => {
    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: null,
        after: unattended(),
      }),
    ).toBe(true);
  });

  it("turning it on widens it, whichever setting turns it on", () => {
    for (const before of [
      unattended({ executionMode: AutoRemediationExecutionMode.Suggest }),
      unattended({ commandAllowlist: [] }),
      unattended({ aiComposesCommands: false }),
      unattended({ remediationAction: AutoRemediationAction.Runbooks }),
    ]) {
      expect(
        AiRemediationCredentialUse.widensCommandsWithoutAsking({
          before: before,
          after: unattended(),
        }),
      ).toBe(true);
    }
  });

  it("keeping it as it is does not, Runners in any shape", () => {
    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: unattended(),
        after: unattended({
          commandRunners: [{ _id: RUNNER_A.toUpperCase() }],
        }),
      }),
    ).toBe(false);
  });

  it("adding an allowlist pattern widens it; removing one does not", () => {
    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: unattended(),
        after: unattended({
          commandAllowlist: ["systemctl restart nginx", "reboot"],
        }),
      }),
    ).toBe(true);

    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: unattended({
          commandAllowlist: ["systemctl restart nginx", "reboot"],
        }),
        after: unattended(),
      }),
    ).toBe(false);
  });

  it("reaching another Runner widens it; dropping one does not", () => {
    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: unattended(),
        after: unattended({ commandRunners: runners([RUNNER_A, RUNNER_B]) }),
      }),
    ).toBe(true);

    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: unattended({ commandRunners: runners([RUNNER_A, RUNNER_B]) }),
        after: unattended(),
      }),
    ).toBe(false);
  });

  it("clearing the Runners - every Runner then - widens it; naming some where any was allowed does not", () => {
    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: unattended(),
        after: unattended({ commandRunners: [] }),
      }),
    ).toBe(true);

    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: unattended({ commandRunners: [] }),
        after: unattended(),
      }),
    ).toBe(false);
  });

  it("turning it off never widens it", () => {
    expect(
      AiRemediationCredentialUse.widensCommandsWithoutAsking({
        before: unattended(),
        after: unattended({
          executionMode: AutoRemediationExecutionMode.Suggest,
          commandAllowlist: ["anything", "at all"],
          commandRunners: [],
        }),
      }),
    ).toBe(false);
  });
});

describe("AiRemediationCredentialUse - a plan's commands", () => {
  function command(
    overrides: Partial<AiRemediationCommand>,
  ): AiRemediationCommand {
    return {
      sequence: 1,
      stepType: RunbookStepType.Bash,
      runnerId: RUNNER_A,
      runnerNameSnapshot: "web-runner",
      command: "uptime",
      timeoutInMs: 1000,
      rationale: "",
      expectedEffect: "",
      ...overrides,
    } as AiRemediationCommand;
  }

  function plan(
    commands: Array<AiRemediationCommand>,
  ): AiRemediationCommandPlan {
    return { commands: commands } as AiRemediationCommandPlan;
  }

  it("finds the first command that runs with a credential OneUptime AI picked", () => {
    const ssh: AiRemediationCommand = command({
      sequence: 2,
      stepType: RunbookStepType.SSH,
      credentialId: RUNNER_B,
    });

    expect(
      AiRemediationCredentialUse.getCommandWithPickedCredential(
        plan([command({}), ssh]),
      ),
    ).toBe(ssh);
  });

  it("does not count a kubectl command's credential, which its cluster binds", () => {
    expect(
      AiRemediationCredentialUse.getCommandWithPickedCredential(
        plan([
          command({
            stepType: RunbookStepType.Kubectl,
            credentialId: RUNNER_B,
          }),
          command({ stepType: RunbookStepType.ResourceCommand }),
          command({}),
        ]),
      ),
    ).toBeUndefined();
  });

  it("refuses an approver who may not read credentials, and nobody else", () => {
    const sshPlan: AiRemediationCommandPlan = plan([
      command({
        stepType: RunbookStepType.SSH,
        credentialId: RUNNER_B,
        credentialNameSnapshot: "web-hosts",
      }),
    ]);

    expect(() => {
      AiRemediationCredentialUse.assertApproverMayUseCredentials({
        plan: sshPlan,
        props: editor([Permission.ProjectMember]),
      });
    }).toThrow(NotAuthorizedException);

    for (const props of [
      editor([Permission.ReadRunbookCredential]),
      editor([Permission.ProjectOwner]),
      { isRoot: true } as DatabaseCommonInteractionProps,
      {
        isMasterAdmin: true,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps,
    ]) {
      expect(() => {
        AiRemediationCredentialUse.assertApproverMayUseCredentials({
          plan: sshPlan,
          props: props,
        });
      }).not.toThrow();
    }

    expect(() => {
      AiRemediationCredentialUse.assertApproverMayUseCredentials({
        plan: plan([command({})]),
        props: editor([Permission.ProjectMember]),
      });
    }).not.toThrow();
  });
});

describe("AutoRemediationRuleService - who may let a rule run AI commands without asking", () => {
  let ruleFind: jest.SpyInstance;
  let storedRule: JSONObject;

  beforeEach(() => {
    stubProjectDirectory({});

    storedRule = {
      _id: RULE_ID.toString(),
      id: RULE_ID,
      ...unattended({ executionMode: AutoRemediationExecutionMode.Suggest }),
    } as unknown as JSONObject;

    ruleFind = jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockImplementation(async (): Promise<Array<AutoRemediationRule>> => {
        return [storedRule as unknown as AutoRemediationRule];
      });

    // No Runner these rules name is a cluster's in-cluster agent.
    jest.spyOn(RunnerService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function create(
    settings: RuleCommandSettings,
    props: DatabaseCommonInteractionProps,
  ): Promise<unknown> {
    const rule: AutoRemediationRule = new AutoRemediationRule();
    rule.name = "Restart web on high latency";
    rule.projectId = PROJECT_ID;
    Object.assign(rule, settings);

    try {
      await hooks.onBeforeCreate({ data: rule, props: props });
      return null;
    } catch (error) {
      return error;
    }
  }

  async function update(
    data: JSONObject,
    props: DatabaseCommonInteractionProps,
  ): Promise<unknown> {
    try {
      await hooks.onBeforeUpdate({
        query: { _id: RULE_ID.toString() },
        data: data,
        props: props,
      } as unknown as UpdateBy<AutoRemediationRule>);
      return null;
    } catch (error) {
      return error;
    }
  }

  it("refuses to create one for an editor who may not read credentials, saying why and what to do", async () => {
    const thrown: unknown = await create(unattended(), editor(RULE_EDITOR));

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Error).message).toBe(
      "This rule would let OneUptime AI run its commands without asking, and those commands may run over SSH with any credential assigned to the rule's Runners. Turning that on, adding allowlist patterns or Runners to it needs permission to read runbook credentials: Project Owner, Project Admin, Read Runbook Credential. Set the rule to ask before fixing, or ask someone who has it to save the rule.",
    );
  });

  it("creates one for an editor who may read credentials, or for OneUptime itself", async () => {
    expect(
      await create(unattended(), editor(RULE_EDITOR_WHO_READS_CREDENTIALS)),
    ).toBeNull();
    expect(
      await create(unattended(), editor([Permission.ProjectAdmin])),
    ).toBeNull();
    expect(
      await create(unattended(), {
        isRoot: true,
      } as DatabaseCommonInteractionProps),
    ).toBeNull();
  });

  it("creates a rule that asks first for anyone who may write rules", async () => {
    expect(
      await create(
        unattended({ executionMode: AutoRemediationExecutionMode.Suggest }),
        editor(RULE_EDITOR),
      ),
    ).toBeNull();
    expect(
      await create(unattended({ commandAllowlist: [] }), editor(RULE_EDITOR)),
    ).toBeNull();
    expect(
      await create(
        unattended({ remediationAction: AutoRemediationAction.Runbooks }),
        editor(RULE_EDITOR),
      ),
    ).toBeNull();
  });

  it("refuses to switch a rule to fix without asking for an editor who may not read credentials", async () => {
    const thrown: unknown = await update(
      { executionMode: AutoRemediationExecutionMode.FullAuto },
      editor(RULE_EDITOR),
    );

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
  });

  it("switches it for an editor who may read credentials, without reading the rule", async () => {
    expect(
      await update(
        { executionMode: AutoRemediationExecutionMode.FullAuto },
        editor(RULE_EDITOR_WHO_READS_CREDENTIALS),
      ),
    ).toBeNull();
    expect(ruleFind).not.toHaveBeenCalled();
  });

  it("lets any editor save a rule that already runs commands without asking, as it is", async () => {
    storedRule = {
      _id: RULE_ID.toString(),
      id: RULE_ID,
      ...unattended(),
    } as unknown as JSONObject;

    // The dashboard posts every field back.
    expect(
      await update(
        {
          name: "Renamed",
          executionMode: AutoRemediationExecutionMode.FullAuto,
          commandAllowlist: ["systemctl restart nginx"],
          commandRunners: [{ _id: RUNNER_A }],
        },
        editor(RULE_EDITOR),
      ),
    ).toBeNull();
  });

  it("refuses to widen a rule that runs commands without asking: a pattern, a Runner, or every Runner", async () => {
    storedRule = {
      _id: RULE_ID.toString(),
      id: RULE_ID,
      ...unattended(),
    } as unknown as JSONObject;

    for (const data of [
      { commandAllowlist: ["systemctl restart nginx", "reboot"] },
      { commandRunners: [{ _id: RUNNER_A }, { _id: RUNNER_B }] },
      { commandRunners: [] },
    ]) {
      expect(await update(data, editor(RULE_EDITOR))).toBeInstanceOf(
        NotAuthorizedException,
      );
    }
  });

  it("lets any editor narrow it, or turn it off", async () => {
    storedRule = {
      _id: RULE_ID.toString(),
      id: RULE_ID,
      ...unattended({
        commandAllowlist: ["systemctl restart nginx", "reboot"],
        commandRunners: runners([RUNNER_A, RUNNER_B]),
      }),
    } as unknown as JSONObject;

    for (const data of [
      { commandAllowlist: ["systemctl restart nginx"] },
      { commandRunners: [{ _id: RUNNER_A }] },
      { executionMode: AutoRemediationExecutionMode.Suggest },
      { aiComposesCommands: false },
    ]) {
      expect(await update(data, editor(RULE_EDITOR))).toBeNull();
    }
  });

  it("reads nothing for a change that writes none of these settings", async () => {
    expect(await update({ name: "Renamed" }, editor(RULE_EDITOR))).toBeNull();
    expect(ruleFind).not.toHaveBeenCalled();
  });

  it("reads the rules the change writes, pinned to the caller's project", async () => {
    await update(
      { executionMode: AutoRemediationExecutionMode.FullAuto },
      editor(RULE_EDITOR),
    );

    const read: { query: JSONObject; props: JSONObject } = ruleFind.mock
      .calls[0]![0] as { query: JSONObject; props: JSONObject };

    expect(read.query["_id"]).toBe(RULE_ID.toString());
    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(read.props["isRoot"]).toBe(true);
  });
});
