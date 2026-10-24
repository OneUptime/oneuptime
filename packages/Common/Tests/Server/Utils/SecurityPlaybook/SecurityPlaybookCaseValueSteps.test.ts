import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "../../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../../Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestPriority,
  buildTestStatus,
  testPriorityId,
  testStatusId,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";

/*
 * The playbook steps that set a case's priority or status - Set the
 * priority, Set the status, and Check threat intel's raise on a match -
 * name the project's own by id, and write them as the playbook, by name, on
 * the case (SECURITY_CASE_PLAYBOOK_NAME_KEY):
 *
 *   - one the project no longer has fails the step, saying what to do;
 *   - a case already there is skipped;
 *   - a status that closes a case closes it with the step's verdict, by
 *     where the status sits - a team's own "Closed - Duplicate" too;
 *   - a raise only ever raises, by the project's order.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "78787878-7878-4878-8878-787878787878",
);
const CASE_ID: ObjectID = new ObjectID("89898989-8989-4989-8989-898989898989");
const GONE_ID: string = "c9000000-0000-4000-8000-0000000000ff";
const DUPLICATE_ID: string = "c2000000-0000-4000-8000-0000000000a3";
const EMERGENCY_ID: string = "c1000000-0000-4000-8000-0000000000e1";

let updates: Array<{ data: JSONObject; miscDataProps: JSONObject }>;

function context(
  action: SecurityPlaybookActionType,
  config: JSONObject,
  caseOverrides: Partial<SecurityCase> = {},
): PlaybookStepContext {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Medium,
  );
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
  ] as unknown as JSONArray;
  Object.assign(securityCase, caseOverrides);

  return {
    projectId: PROJECT_ID,
    runId: ObjectID.generate(),
    playbookName: "Triage",
    stepNumber: 1,
    securityCase,
    step: {
      id: "s1",
      action,
      config,
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  };
}

beforeEach(() => {
  updates = [];

  const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
  statuses.push(
    buildTestStatus({ id: DUPLICATE_ID, name: "Closed - Duplicate", order: 5 }),
  );
  const priorities: Array<SecurityCasePriority> = buildDefaultTestPriorities();
  priorities.push(
    buildTestPriority({ id: EMERGENCY_ID, name: "Emergency", order: 0 }),
  );

  stubSecurityCaseValues({ priorities, statuses });

  jest
    .spyOn(SecurityCaseService, "updateOneById")
    .mockImplementation((async (args: {
      data: JSONObject;
      miscDataProps: JSONObject;
    }) => {
      updates.push({ data: args.data, miscDataProps: args.miscDataProps });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function runStep(
  step: PlaybookStepContext,
): Promise<PlaybookStepOutcome> {
  return await SecurityPlaybookActions.execute(step);
}

describe("Set the priority", () => {
  test("sets the project's priority, as the playbook", async () => {
    const outcome: PlaybookStepOutcome = await runStep(
      context(SecurityPlaybookActionType.SetCasePriority, {
        priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
      }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Set the priority to **Critical**.",
    );
    expect(String(updates[0]!.data["securityCasePriorityId"])).toBe(
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
    );
    expect(Object.values(updates[0]!.miscDataProps)).toContain("Triage");
  });

  test("is skipped for a case already at it", async () => {
    const outcome: PlaybookStepOutcome = await runStep(
      context(SecurityPlaybookActionType.SetCasePriority, {
        priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Medium],
      }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(updates).toEqual([]);
  });

  test("fails, saying what to do, for a priority the project no longer has", async () => {
    const outcome: PlaybookStepOutcome = await runStep(
      context(SecurityPlaybookActionType.SetCasePriority, {
        priorityId: GONE_ID,
      }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(
      "The priority this step sets is no longer one of the project's. Pick another on the playbook.",
    );
    expect(updates).toEqual([]);
  });
});

describe("Set the status", () => {
  test("moves the case on, with no verdict for a status that does not close it", async () => {
    const outcome: PlaybookStepOutcome = await runStep(
      context(SecurityPlaybookActionType.SetCaseStatus, {
        statusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      }),
    );

    expect(outcome.summary.toString()).toBe(
      "Set the status to **Investigating**.",
    );
    expect(Object.keys(updates[0]!.data)).toEqual(["securityCaseStatusId"]);
  });

  test("closes the case with the step's verdict, a team's own closed status too", async () => {
    await runStep(
      context(SecurityPlaybookActionType.SetCaseStatus, {
        statusId: DUPLICATE_ID,
        verdict: SecurityCaseVerdict.FalsePositive,
      }),
    );
    await runStep(
      context(SecurityPlaybookActionType.SetCaseStatus, {
        statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
      }),
    );

    expect(updates[0]!.data).toMatchObject({
      verdict: SecurityCaseVerdict.FalsePositive,
    });
    expect(String(updates[0]!.data["securityCaseStatusId"])).toBe(DUPLICATE_ID);
    // Without one, Undetermined: a closed case always has a verdict.
    expect(updates[1]!.data["verdict"]).toBe(SecurityCaseVerdict.Undetermined);
  });

  test("is skipped for a case already there, and fails for a status the project no longer has", async () => {
    expect(
      (
        await runStep(
          context(SecurityPlaybookActionType.SetCaseStatus, {
            statusId: TEST_STATUS_IDS[SecurityCaseStage.New],
          }),
        )
      ).status,
    ).toBe(SecurityPlaybookStepStatus.Skipped);

    const outcome: PlaybookStepOutcome = await runStep(
      context(SecurityPlaybookActionType.SetCaseStatus, { statusId: GONE_ID }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toContain("no longer one of the project's");
    expect(updates).toEqual([]);
  });
});

describe("Check threat intel's raise", () => {
  beforeEach(() => {
    jest
      .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
      .mockResolvedValue([
        {
          indicatorValue: "203.0.113.9",
          feedId: "f1",
          feedName: "Feodo Tracker",
          stixId: "i1",
          indicatorType: "ipv4-addr",
          indicatorName: "Emotet C2",
          confidence: 90,
        },
      ] as never);
  });

  test("raises a case below the priority to it, on a match", async () => {
    const outcome: PlaybookStepOutcome = await runStep(
      context(SecurityPlaybookActionType.CheckThreatIntel, {
        raisePriorityToId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
      }),
    );

    expect(outcome.threatIntelMatched).toBe(true);
    expect(outcome.summary.toString()).toContain(
      "Raised the priority to **High**.",
    );
    expect(String(updates[0]!.data["securityCasePriorityId"])).toBe(
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
    );
  });

  test("never lowers: a case at the project's own Emergency, above it, stays", async () => {
    const outcome: PlaybookStepOutcome = await runStep(
      context(
        SecurityPlaybookActionType.CheckThreatIntel,
        {
          raisePriorityToId:
            TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
        },
        { securityCasePriorityId: new ObjectID(EMERGENCY_ID) },
      ),
    );

    expect(outcome.summary.toString()).not.toContain("Raised");
    expect(updates).toEqual([]);
  });

  test("a priority the project no longer has raises nothing", async () => {
    await runStep(
      context(SecurityPlaybookActionType.CheckThreatIntel, {
        raisePriorityToId: GONE_ID,
      }),
    );

    expect(updates).toEqual([]);
  });
});
