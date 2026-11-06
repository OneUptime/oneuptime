import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";

/*
 * A run a Stop step ended, drawn for real on its card. The Stop step is
 * done and says why, in the playbook's words; each step after it is
 * skipped and says where the run stopped, in the reader's language - not
 * the server's English sentence, nor the condition it never got to read.
 * Folded in a list, the run's line says it ended at the Stop step, as the
 * playbook says, never in the red a failed step is drawn in. A Stop step
 * whose condition did not hold is skipped like any other branch.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import SecurityPlaybookRunCard, {
  RUN_CARD_SUMMARY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunCard";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStepOutcome } from "../../../Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";

const RUN_ID: string = "25000000-0000-4000-8000-000000000051";
const ME: string = "26000000-0000-4000-8000-000000000002";
const OKTA_ID: string = "27000000-0000-4000-8000-000000000005";
const REASON: string = "Nothing known-bad: nothing to contain";

// Check threat intel; stop when it found nothing; else suspend and note.
const STEPS: JSONArray = [
  {
    id: "check",
    action: SecurityPlaybookActionType.CheckThreatIntel,
    config: {},
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  },
  {
    id: "stop",
    action: SecurityPlaybookActionType.StopRun,
    config: { reason: REASON },
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    runIf: {
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.FoundNothing,
    },
  },
  {
    id: "suspend",
    action: SecurityPlaybookActionType.SuspendOktaUser,
    config: { connectionId: OKTA_ID },
    requiresApproval: true,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  },
  {
    id: "note",
    action: SecurityPlaybookActionType.AddCaseNote,
    config: { note: "Contained." },
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    runIf: {
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.Found,
    },
  },
];

function stopRun(stepResults: Array<JSONObject>): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = RUN_ID;
  run.playbookName = "Contain Known-Bad Sign-ins";
  run.status = SecurityPlaybookRunStatus.Succeeded;
  run.triggeredByUserId = new ObjectID(ME);
  run.currentStepIndex = STEPS.length;
  run.steps = STEPS;
  run.stepResults = stepResults.map(
    (result: JSONObject, index: number): JSONObject => {
      const step: JSONObject = STEPS[index] as JSONObject;

      return { stepId: step["id"], action: step["action"], ...result };
    },
  ) as unknown as JSONArray;
  run.createdAt = new Date(Date.now() - 60 * 1000);
  return run;
}

// Threat intel knew nothing of the user: the run stopped at step 2.
const STOPPED: SecurityPlaybookRun = stopRun([
  {
    status: SecurityPlaybookStepStatus.Succeeded,
    found: false,
    message: "No entity matched an indicator.",
  },
  { status: SecurityPlaybookStepStatus.Succeeded, message: REASON },
  {
    status: SecurityPlaybookStepStatus.Skipped,
    message: "Skipped: the run stopped at step 2.",
  },
  {
    status: SecurityPlaybookStepStatus.Skipped,
    message: "Skipped: the run stopped at step 2.",
  },
]);

// Threat intel knew the user: the Stop step was skipped, and the run went on.
const WENT_ON: SecurityPlaybookRun = stopRun([
  {
    status: SecurityPlaybookStepStatus.Succeeded,
    found: true,
    message: "1 entity matched an indicator.",
  },
  {
    status: SecurityPlaybookStepStatus.Skipped,
    message:
      "Skipped: it runs only if step 1 (Check entities against threat intel) found nothing known-bad.",
  },
  { status: SecurityPlaybookStepStatus.Succeeded, message: "Suspended." },
  { status: SecurityPlaybookStepStatus.Succeeded, message: "Noted." },
]);

async function renderCard(
  run: SecurityPlaybookRun,
  isCollapsible?: boolean,
): Promise<void> {
  await act(async () => {
    render(
      <SecurityPlaybookRunCard
        run={run}
        onChanged={(): void => {
          // Nothing to read again here.
        }}
        {...(isCollapsible === undefined ? {} : { isCollapsible })}
      />,
    );
  });
}

function stepRow(index: number): HTMLElement {
  return screen.getByTestId(`security-playbook-run-step-${index}`);
}

beforeEach(() => {
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(ME));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a run a Stop step ended", () => {
  test("the Stop step is done and says why, in the playbook's words", async () => {
    await renderCard(STOPPED);

    expect(stepRow(1)).toHaveTextContent("Step 2: Stop the run");
    expect(within(stepRow(1)).getByText("Succeeded")).toBeInTheDocument();
    expect(stepRow(1)).toHaveTextContent(REASON);
    // It never asked anyone anything.
    expect(within(stepRow(1)).queryByText("Needs approval")).toBeNull();
  });

  test("each step after it says where the run stopped, not the server's sentence nor its own condition", async () => {
    await renderCard(STOPPED);

    for (const index of [2, 3]) {
      expect(
        screen.getByTestId(`security-playbook-run-step-${index}-stopped`),
      ).toHaveTextContent("The run stopped at step 2");
      expect(within(stepRow(index)).getByText("Skipped")).toBeInTheDocument();
      expect(
        screen.queryByTestId(`security-playbook-run-step-${index}-run-if`),
      ).toBeNull();
      // A step that never got its turn asked for no approval.
      expect(within(stepRow(index)).queryByText("Needs approval")).toBeNull();
    }

    expect(screen.queryByText(/Skipped: the run stopped/)).toBeNull();
  });

  test("folded in a list, its line says it ended at the Stop step, as the playbook says, never as a failure", async () => {
    await renderCard(STOPPED, true);

    const summary: HTMLElement = screen.getByTestId(RUN_CARD_SUMMARY_TEST_ID);

    expect(summary).toHaveTextContent(
      "Ended at step 2 of 4, as the playbook says",
    );
    expect(summary).not.toHaveClass("text-red-700");
    expect(summary).toHaveClass("text-gray-600");
  });
});

describe("a run whose Stop step was skipped", () => {
  test("the Stop step says what it waited on, and the steps after it ran", async () => {
    await renderCard(WENT_ON);

    expect(
      screen.getByTestId("security-playbook-run-step-1-run-if"),
    ).toHaveTextContent("Only if step 1 found nothing known-bad");
    expect(
      screen.queryByTestId("security-playbook-run-step-2-stopped"),
    ).toBeNull();
    expect(within(stepRow(2)).getByText("Succeeded")).toBeInTheDocument();
  });

  test("folded, its line counts the steps done, as any run's", async () => {
    await renderCard(WENT_ON, true);

    expect(screen.getByTestId(RUN_CARD_SUMMARY_TEST_ID)).toHaveTextContent(
      "4 of 4 steps done",
    );
  });
});
