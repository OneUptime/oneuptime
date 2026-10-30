import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";

/*
 * A run of a playbook that branches, drawn for real on its card. A step
 * the run skipped because of what an earlier step found says so in the
 * step card's own words, as a chip in the reader's language - not the
 * server's English sentence, which opened with the Skipped its pill
 * already says - and it does not claim to need an approval it never asked
 * for. A step skipped for a reason of its own keeps its message. The
 * Entra ID and Google Workspace steps offer their undo on a contained user.
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

import SecurityPlaybookRunCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunCard";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStepOutcome } from "../../../Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";

const RUN_ID: string = "25000000-0000-4000-8000-000000000041";
const STARTER_ID: string = "26000000-0000-4000-8000-000000000001";
const ME: string = "26000000-0000-4000-8000-000000000002";
const ENTRA_ID: string = "27000000-0000-4000-8000-000000000002";
const WORKSPACE_ID: string = "27000000-0000-4000-8000-000000000003";
const USER: string = "k.morgan@acme-commerce.example";

const ON_A_FIND: JSONObject = {
  stepId: "check",
  outcome: SecurityPlaybookStepOutcome.Found,
};

// Contain a user threat intel knows; otherwise leave the analyst tasks.
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
    id: "disable",
    action: SecurityPlaybookActionType.DisableEntraIdUser,
    config: { connectionId: ENTRA_ID },
    requiresApproval: true,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    runIf: ON_A_FIND,
  },
  {
    id: "suspend",
    action: SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
    config: { connectionId: WORKSPACE_ID },
    requiresApproval: true,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    runIf: ON_A_FIND,
  },
  {
    id: "tasks",
    action: SecurityPlaybookActionType.AddCaseTasks,
    config: { tasks: ["Confirm the sign-in with the user"] },
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    runIf: {
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.FoundNothing,
    },
  },
];

function contained(detail: string): JSONObject {
  return {
    type: SecurityEntityType.User,
    value: USER,
    reason: SecurityPlaybookTargetReason.GroupedOn,
    state: SecurityPlaybookTargetState.Done,
    detail,
  };
}

function branchRun(stepResults: Array<JSONObject>): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = RUN_ID;
  run.playbookName = "Contain Risky Sign-ins";
  run.status = SecurityPlaybookRunStatus.Succeeded;
  run.triggeredByUserId = new ObjectID(STARTER_ID);
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

// Threat intel knew nothing of the user: no containment, the tasks instead.
const FOUND_NOTHING: SecurityPlaybookRun = branchRun([
  {
    status: SecurityPlaybookStepStatus.Succeeded,
    found: false,
    message: "No entity matched an indicator.",
  },
  {
    status: SecurityPlaybookStepStatus.Skipped,
    message:
      "Skipped: it runs only if step 1 (Check entities against threat intel) found a known-bad entity.",
  },
  {
    status: SecurityPlaybookStepStatus.Skipped,
    message:
      "Skipped: it runs only if step 1 (Check entities against threat intel) found a known-bad entity.",
  },
  { status: SecurityPlaybookStepStatus.Succeeded, message: "Added 1 task." },
]);

async function renderCard(run: SecurityPlaybookRun): Promise<void> {
  await act(async () => {
    render(<SecurityPlaybookRunCard run={run} onChanged={onChanged} />);
  });
}

function stepRow(index: number): HTMLElement {
  return screen.getByTestId(`security-playbook-run-step-${index}`);
}

let onChanged: Mock<() => void>;

beforeEach(() => {
  onChanged = jest.fn<() => void>();
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(ME));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a step a run skipped on a branch", () => {
  test("says what it waits on in the step card's words, not the run's English sentence", async () => {
    await renderCard(FOUND_NOTHING);

    for (const index of [1, 2]) {
      expect(
        screen.getByTestId(`security-playbook-run-step-${index}-run-if`),
      ).toHaveTextContent("Only if step 1 found a known-bad entity");
      expect(within(stepRow(index)).getByText("Skipped")).toBeInTheDocument();
    }

    expect(
      screen.queryByText(/Skipped: it runs only if/),
    ).not.toBeInTheDocument();
  });

  test("does not say it needs an approval it never asked for", async () => {
    await renderCard(FOUND_NOTHING);

    for (const index of [1, 2]) {
      expect(
        within(stepRow(index)).queryByText("Needs approval"),
      ).not.toBeInTheDocument();
    }
  });

  test("the branch that ran says what it did, and no condition", async () => {
    await renderCard(FOUND_NOTHING);

    expect(within(stepRow(3)).getByText("Added 1 task.")).toBeInTheDocument();
    expect(
      screen.queryByTestId("security-playbook-run-step-3-run-if"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("security-playbook-run-step-0-run-if"),
    ).not.toBeInTheDocument();
  });

  test("a step skipped for a reason of its own keeps its message", async () => {
    /*
     * Threat intel knew the user, so the containment's condition held; it
     * was skipped because it had nobody to act on.
     */
    await renderCard(
      branchRun([
        { status: SecurityPlaybookStepStatus.Succeeded, found: true },
        {
          status: SecurityPlaybookStepStatus.Skipped,
          message:
            "No user to act on: no detection of the case is grouped on a user.",
        },
        {
          status: SecurityPlaybookStepStatus.Skipped,
          message:
            "No user to act on: no detection of the case is grouped on a user.",
        },
        {
          status: SecurityPlaybookStepStatus.Skipped,
          message:
            "Skipped: it runs only if step 1 (Check entities against threat intel) found nothing known-bad.",
        },
      ]),
    );

    expect(
      within(stepRow(1)).getByText(
        "No user to act on: no detection of the case is grouped on a user.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("security-playbook-run-step-1-run-if"),
    ).not.toBeInTheDocument();
    // The else did not run, and says why.
    expect(
      screen.getByTestId("security-playbook-run-step-3-run-if"),
    ).toHaveTextContent("Only if step 1 found nothing known-bad");
  });
});

describe("Microsoft Entra ID and Google Workspace on the run card", () => {
  test("a user disabled or suspended gets Enable or Unsuspend, and a step that ran still says it needed approval", async () => {
    await renderCard(
      branchRun([
        {
          status: SecurityPlaybookStepStatus.Succeeded,
          found: true,
          message: "192.0.2.180 matched 1 indicator.",
        },
        {
          status: SecurityPlaybookStepStatus.Succeeded,
          targets: [contained("disabled")],
        },
        {
          status: SecurityPlaybookStepStatus.Succeeded,
          targets: [contained("suspended")],
        },
        {
          status: SecurityPlaybookStepStatus.Skipped,
          message:
            "Skipped: it runs only if step 1 (Check entities against threat intel) found nothing known-bad.",
        },
      ]),
    );

    expect(
      within(stepRow(1)).getByRole("button", { name: /Enable/ }),
    ).toBeInTheDocument();
    expect(
      within(stepRow(2)).getByRole("button", { name: /Unsuspend/ }),
    ).toBeInTheDocument();
    expect(within(stepRow(1)).getByText("Needs approval")).toBeInTheDocument();
    expect(within(stepRow(1)).getByText("disabled")).toBeInTheDocument();
    expect(within(stepRow(2)).getByText("suspended")).toBeInTheDocument();
  });
});
