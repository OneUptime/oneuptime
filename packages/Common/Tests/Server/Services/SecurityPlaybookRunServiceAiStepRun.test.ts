import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  AI_STEP_RUN_ACTIONS,
  isAiStepRunAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookOneStepRun";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger, {
  SECURITY_PLAYBOOK_TRIGGERS,
  isOneUptimeAiRun,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ONE STEP OF ONEUPTIME AI'S, THROUGH THE ENGINE (#10352): what OneUptime
 * AI does to a case is a run of the playbook engine like anyone's - one
 * step, no playbook, no person behind it - whose trigger says it is
 * OneUptime AI's. The engine then holds it to the same approvals,
 * protected checks, timeline, audit log and undo as every run.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function blockStep(requiresApproval: boolean): SecurityPlaybookStep {
  return {
    id: "step-1",
    action: SecurityPlaybookActionType.BlockAddress,
    config: {
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneDay,
    },
    requiresApproval,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    ...(requiresApproval
      ? {}
      : {
          approvalTurnedOff: {
            byUserId: "44444444-4444-4444-8444-444444444444",
            at: "2026-11-20T10:00:00.000Z",
          },
        }),
  } as SecurityPlaybookStep;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a step of OneUptime AI's", () => {
  test("is a run of the engine's: one step, on the case, as OneUptime AI's, with what it acts on", async () => {
    let created: SecurityPlaybookRun | undefined;

    jest
      .spyOn(SecurityPlaybookRunService, "create")
      .mockImplementation((async (args: { data: SecurityPlaybookRun }) => {
        created = args.data;
        return args.data;
      }) as never);

    await SecurityPlaybookRunService.startAiStepRun({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      step: blockStep(false),
      targets: [
        {
          type: SecurityEntityType.IpAddress,
          value: "35.196.249.14",
          reason: SecurityPlaybookTargetReason.OnTheCase,
          state: SecurityPlaybookTargetState.Proposed,
        },
      ],
    });

    expect(created).toBeDefined();
    expect(created!.trigger).toBe(SecurityPlaybookTrigger.OneUptimeAi);
    expect(isOneUptimeAiRun(created!)).toBe(true);
    expect(created!.projectId).toEqual(PROJECT_ID);
    expect(created!.securityCaseId).toEqual(CASE_ID);
    // No playbook and no person: OneUptime AI's own.
    expect(created!.securityPlaybookId).toBeUndefined();
    expect(created!.triggeredByUserId).toBeUndefined();
    expect(created!.playbookName).toBe("Block the address");

    const steps: Array<Record<string, unknown>> = created!
      .steps as unknown as Array<Record<string, unknown>>;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual(
      expect.objectContaining({
        action: SecurityPlaybookActionType.BlockAddress,
        requiresApproval: false,
      }),
    );
    expect(
      (created!.stepResults as unknown as Array<Record<string, unknown>>)[0]![
        "targets"
      ],
    ).toEqual([expect.objectContaining({ value: "35.196.249.14" })]);
  });

  test("asked first, the step keeps waiting for a person", async () => {
    let created: SecurityPlaybookRun | undefined;

    jest
      .spyOn(SecurityPlaybookRunService, "create")
      .mockImplementation((async (args: { data: SecurityPlaybookRun }) => {
        created = args.data;
        return args.data;
      }) as never);

    await SecurityPlaybookRunService.startAiStepRun({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      step: blockStep(true),
    });

    expect(
      (created!.steps as unknown as Array<Record<string, unknown>>)[0]![
        "requiresApproval"
      ],
    ).toBe(true);
  });

  test("only the actions OneUptime AI takes on a case: never one it does not", async () => {
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityPlaybookRunService, "create")
      .mockImplementation((async () => {
        return new SecurityPlaybookRun();
      }) as never);

    await expect(
      SecurityPlaybookRunService.startAiStepRun({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        step: {
          ...blockStep(false),
          action: SecurityPlaybookActionType.RunWorkflow,
          config: {},
        } as SecurityPlaybookStep,
      }),
    ).rejects.toThrow(BadDataException);
    expect(create).not.toHaveBeenCalled();

    expect(isAiStepRunAction(SecurityPlaybookActionType.BlockAddress)).toBe(
      true,
    );
    expect(isAiStepRunAction(SecurityPlaybookActionType.RunWorkflow)).toBe(
      false,
    );
    expect(AI_STEP_RUN_ACTIONS).not.toContain(
      SecurityPlaybookActionType.RunWorkflow,
    );
  });

  test("OneUptime AI is no playbook's trigger: a playbook can never be set to run as it", () => {
    expect(SECURITY_PLAYBOOK_TRIGGERS).not.toContain(
      SecurityPlaybookTrigger.OneUptimeAi,
    );
    expect(isOneUptimeAiRun({ trigger: SecurityPlaybookTrigger.Manual })).toBe(
      false,
    );
  });
});
