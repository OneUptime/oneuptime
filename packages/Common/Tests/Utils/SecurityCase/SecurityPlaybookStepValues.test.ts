import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { validateSecurityPlaybookStepValues } from "../../../Utils/SecurityCase/SecurityPlaybookStepValues";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestStatus,
} from "../../Helpers/SecurityCaseValues";
import { describe, expect, test } from "@jest/globals";

/*
 * A playbook's Set priority, Set status and Check threat intel steps name
 * the project's own priorities and statuses by id: checked against the
 * project's lists when the playbook is saved.
 */

const OTHER_PROJECTS_ID: string = "c9000000-0000-4000-8000-000000000001";
const DUPLICATE_ID: string = "c2000000-0000-4000-8000-0000000000a3";
const ERADICATING_ID: string = "c2000000-0000-4000-8000-0000000000a2";

function step(
  action: SecurityPlaybookActionType,
  config: JSONObject,
): SecurityPlaybookStep {
  return {
    id: "step-1",
    action,
    config,
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  };
}

function validate(
  steps: Array<SecurityPlaybookStep>,
  statuses?: Array<SecurityCaseStatus>,
): Array<SecurityPlaybookStep> {
  const priorities: Array<SecurityCasePriority> = buildDefaultTestPriorities();

  return validateSecurityPlaybookStepValues({
    steps,
    priorities,
    statuses: statuses || buildDefaultTestStatuses(),
  });
}

// A team's own: Eradicating before Closed, Closed - Duplicate after it.
function buildTeamStatuses(): Array<SecurityCaseStatus> {
  const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
  statuses[3]!.order = 5; // Closed

  return [
    ...statuses,
    buildTestStatus({ id: ERADICATING_ID, name: "Eradicating", order: 4 }),
    buildTestStatus({ id: DUPLICATE_ID, name: "Closed - Duplicate", order: 6 }),
  ];
}

describe("Set the priority", () => {
  test("keeps a priority of the project's", () => {
    const steps: Array<SecurityPlaybookStep> = [
      step(SecurityPlaybookActionType.SetCasePriority, {
        priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
      }),
    ];

    expect(validate(steps)).toEqual(steps);
  });

  test("refuses another project's priority, naming the step", () => {
    expect(() => {
      return validate([
        step(SecurityPlaybookActionType.SetCasePriority, {
          priorityId: OTHER_PROJECTS_ID,
        }),
      ]);
    }).toThrow(
      new BadDataException(
        "Step 1 (Set the priority): choose one of this project's case priorities.",
      ),
    );
  });

  test("allows an archived priority: the playbook keeps running as built", () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    priorities[4]!.isArchived = true;

    expect(
      validateSecurityPlaybookStepValues({
        steps: [
          step(SecurityPlaybookActionType.SetCasePriority, {
            priorityId:
              TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Informational],
          }),
        ],
        priorities,
        statuses: buildDefaultTestStatuses(),
      }),
    ).toHaveLength(1);
  });
});

describe("Set the status", () => {
  test("moves a case on to a status that does not close it, dropping any verdict", () => {
    expect(
      validate([
        step(SecurityPlaybookActionType.SetCaseStatus, {
          statusId: TEST_STATUS_IDS[SecurityCaseStage.Contained],
          verdict: SecurityCaseVerdict.TruePositive,
        }),
      ])[0]!.config,
    ).toEqual({ statusId: TEST_STATUS_IDS[SecurityCaseStage.Contained] });
  });

  test("never to the status every case starts in", () => {
    expect(() => {
      return validate([
        step(SecurityPlaybookActionType.SetCaseStatus, {
          statusId: TEST_STATUS_IDS[SecurityCaseStage.New],
        }),
      ]);
    }).toThrow(
      "Step 1 (Set the status): every case starts in this status - choose one a case moves on to.",
    );
  });

  test("closes with a verdict, and refuses closing without one", () => {
    const closing: SecurityPlaybookStep = step(
      SecurityPlaybookActionType.SetCaseStatus,
      {
        statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
        verdict: SecurityCaseVerdict.FalsePositive,
      },
    );

    expect(validate([closing])).toEqual([closing]);

    expect(() => {
      return validate([
        step(SecurityPlaybookActionType.SetCaseStatus, {
          statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
        }),
      ]);
    }).toThrow(
      "Step 1 (Set the status): a case is closed with a verdict - choose one.",
    );
  });

  test("reads the project's own statuses by where they sit", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();

    // After Closed: it closes, so it asks for a verdict.
    expect(() => {
      return validate(
        [
          step(SecurityPlaybookActionType.SetCaseStatus, {
            statusId: DUPLICATE_ID,
          }),
        ],
        statuses,
      );
    }).toThrow("a case is closed with a verdict - choose one.");

    // Before Closed: open, so a verdict is dropped.
    expect(
      validate(
        [
          step(SecurityPlaybookActionType.SetCaseStatus, {
            statusId: ERADICATING_ID,
            verdict: SecurityCaseVerdict.Undetermined,
          }),
        ],
        statuses,
      )[0]!.config,
    ).toEqual({ statusId: ERADICATING_ID });
  });

  test("refuses a status that is none of the project's", () => {
    expect(() => {
      return validate([
        step(SecurityPlaybookActionType.SetCaseStatus, {
          statusId: OTHER_PROJECTS_ID,
        }),
      ]);
    }).toThrow(
      "Step 1 (Set the status): choose one of this project's case statuses.",
    );
  });
});

describe("Check entities against threat intel", () => {
  test("raises to a priority of the project's, or to none", () => {
    const raising: SecurityPlaybookStep = step(
      SecurityPlaybookActionType.CheckThreatIntel,
      {
        raisePriorityToId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
      },
    );
    const notRaising: SecurityPlaybookStep = step(
      SecurityPlaybookActionType.CheckThreatIntel,
      {},
    );

    expect(validate([raising, notRaising])).toEqual([raising, notRaising]);
  });

  test("refuses raising to another project's priority, naming the step", () => {
    expect(() => {
      return validate([
        step(SecurityPlaybookActionType.AddCaseNote, { note: "Look first" }),
        step(SecurityPlaybookActionType.CheckThreatIntel, {
          raisePriorityToId: OTHER_PROJECTS_ID,
        }),
      ]);
    }).toThrow(
      "Step 2 (Check entities against threat intel): choose one of this project's case priorities to raise the case to, or none.",
    );
  });
});

test("leaves every other step as it is", () => {
  const steps: Array<SecurityPlaybookStep> = [
    step(SecurityPlaybookActionType.AddCaseNote, { note: "Look first" }),
    step(SecurityPlaybookActionType.AddCaseLabels, { labelIds: [] }),
  ];

  expect(validate(steps)).toEqual(steps);
});
