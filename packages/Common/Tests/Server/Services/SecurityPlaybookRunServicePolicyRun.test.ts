import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import { buildAutomaticResponseStep } from "../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponse";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger, {
  SECURITY_PLAYBOOK_TRIGGERS,
  isSecurityPlaybookTrigger,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { readOneStepRun } from "../../../Types/SecurityPlaybook/SecurityPlaybookOneStepRun";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An automatic response policy's block is a one-step run of the playbook
 * engine (#10350), as a person's block from a case is (#10342): the same
 * run, approval, timeline, audit and undo, started by the policy - its id
 * on the run, its name the run's, Automatic Response its trigger - and no
 * person's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const POLICY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PERSON_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const TARGET: SecurityPlaybookTarget = {
  type: SecurityEntityType.IpAddress,
  value: "35.205.11.131",
  reason: SecurityPlaybookTargetReason.GroupedOn,
  state: SecurityPlaybookTargetState.Proposed,
};

function policyStep(): SecurityPlaybookStep {
  return buildAutomaticResponseStep({
    blockAction: SecurityBlockAction.Challenge,
    duration: SecurityBlockDuration.OneHour,
    turnedOnByUserId: PERSON_ID,
    turnedOnAt: new Date("2026-11-15T09:00:00.000Z"),
    now: new Date("2026-11-22T10:00:00.000Z"),
  });
}

let createdRuns: Array<SecurityPlaybookRun>;

beforeEach(() => {
  createdRuns = [];
  jest
    .spyOn(SecurityPlaybookRunService, "create")
    .mockImplementation(async (data: { data: SecurityPlaybookRun }) => {
      createdRuns.push(data.data);
      return data.data;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a policy's one-step run", () => {
  test("is the policy's: its id, its name, Automatic Response, and no person", async () => {
    await SecurityPlaybookRunService.startOneStepRun({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      automaticResponsePolicyId: POLICY_ID,
      policyName: "Scanners",
      step: policyStep(),
      targets: [TARGET],
    });

    expect(createdRuns).toHaveLength(1);
    const run: SecurityPlaybookRun = createdRuns[0]!;

    expect(run.trigger).toBe(SecurityPlaybookTrigger.AutomaticResponse);
    expect(run.securityAutomaticResponsePolicyId).toEqual(POLICY_ID);
    expect(run.playbookName).toBe("Scanners");
    expect(run.triggeredByUserId).toBeUndefined();
    expect(run.securityPlaybookId).toBeUndefined();

    // Read back as any one-step run is: one step, on the address, needing no approval.
    const read: ReturnType<typeof readOneStepRun> = readOneStepRun(run);
    expect(read?.values).toEqual(["35.205.11.131"]);
    expect(read?.step.requiresApproval).toBe(false);
    expect(read?.step.approvalTurnedOff?.byUserId).toBe(PERSON_ID.toString());
  });

  test("keeps the step's approval stamp through the run's own reading of it", () => {
    const [parsed] = parseSecurityPlaybookSteps([policyStep()]);

    expect(parsed?.approvalTurnedOff).toEqual({
      byUserId: PERSON_ID.toString(),
      at: "2026-11-15T09:00:00.000Z",
    });
  });

  test("a person's run stays theirs, Manual", async () => {
    await SecurityPlaybookRunService.startOneStepRun({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      userId: PERSON_ID,
      step: policyStep(),
      targets: [TARGET],
    });

    expect(createdRuns[0]!.trigger).toBe(SecurityPlaybookTrigger.Manual);
    expect(createdRuns[0]!.triggeredByUserId).toEqual(PERSON_ID);
    expect(createdRuns[0]!.securityAutomaticResponsePolicyId).toBeUndefined();
  });

  test("is a person's or a policy's, never both or neither", async () => {
    await expect(
      SecurityPlaybookRunService.startOneStepRun({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        step: policyStep(),
        targets: [TARGET],
      }),
    ).rejects.toThrow(
      "A one-step run is asked for by a person or by an automatic response policy.",
    );
    await expect(
      SecurityPlaybookRunService.startOneStepRun({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        userId: PERSON_ID,
        automaticResponsePolicyId: POLICY_ID,
        step: policyStep(),
        targets: [TARGET],
      }),
    ).rejects.toThrow(
      "A one-step run is asked for by a person or by an automatic response policy.",
    );
    expect(createdRuns).toHaveLength(0);
  });
});

describe("Automatic Response, as a trigger", () => {
  test("is a run's, never a playbook's to choose", () => {
    expect(SECURITY_PLAYBOOK_TRIGGERS).not.toContain(
      SecurityPlaybookTrigger.AutomaticResponse,
    );
    expect(
      isSecurityPlaybookTrigger(SecurityPlaybookTrigger.AutomaticResponse),
    ).toBe(false);
  });
});
