import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * A playbook run's card, drawn for real, on a containment step: the users
 * and hosts it picked with what became of each, the undo button on the ones
 * it contained, the approval that asks about its targets, and the Approve
 * button the person who started the run cannot press.
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
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";

const RUN_ID: string = "25000000-0000-4000-8000-000000000009";
const STARTER_ID: string = "26000000-0000-4000-8000-000000000001";
const OTHER_ID: string = "26000000-0000-4000-8000-000000000002";
const CONNECTION_ID: string = "27000000-0000-4000-8000-000000000003";

function target(
  value: string,
  state: SecurityPlaybookTargetState,
  extra: Partial<SecurityPlaybookTarget> = {},
): SecurityPlaybookTarget {
  return {
    type: SecurityEntityType.User,
    value,
    reason: SecurityPlaybookTargetReason.GroupedOn,
    state,
    ...extra,
  };
}

function containmentRun(data: {
  status: SecurityPlaybookRunStatus;
  stepStatus: SecurityPlaybookStepStatus;
  targets: Array<SecurityPlaybookTarget>;
}): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = RUN_ID;
  run.playbookName = "Contain compromised accounts";
  run.status = data.status;
  run.triggeredByUserId = new ObjectID(STARTER_ID);
  run.currentStepIndex = 0;
  run.steps = [
    {
      id: "s1",
      action: SecurityPlaybookActionType.SuspendOktaUser,
      config: { connectionId: CONNECTION_ID },
      requiresApproval: true,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  ] as unknown as JSONArray;
  run.stepResults = [
    {
      stepId: "s1",
      action: SecurityPlaybookActionType.SuspendOktaUser,
      status: data.stepStatus,
      targets: data.targets,
    },
  ] as unknown as JSONArray;
  run.createdAt = new Date(Date.now() - 60 * 1000);
  return run;
}

let onChanged: jest.Mock<() => void>;

async function renderCard(run: SecurityPlaybookRun): Promise<void> {
  await act(async () => {
    render(<SecurityPlaybookRunCard run={run} onChanged={onChanged} />);
  });
}

beforeEach(() => {
  onChanged = jest.fn<() => void>();
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(OTHER_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a finished containment step on the run card", () => {
  test("lists each target with what became of it, and offers the undo only on the ones the step contained", async () => {
    await renderCard(
      containmentRun({
        status: SecurityPlaybookRunStatus.Succeeded,
        stepStatus: SecurityPlaybookStepStatus.Succeeded,
        targets: [
          target("mallory@acme.com", SecurityPlaybookTargetState.Done, {
            detail: "suspended",
          }),
          target("bob@acme.com", SecurityPlaybookTargetState.AlreadyDone, {
            detail: "already suspended",
          }),
          target("breakglass@acme.com", SecurityPlaybookTargetState.Protected, {
            protectedBy: "breakglass@*",
          }),
        ],
      }),
    );

    const list: HTMLElement = screen.getByTestId(
      "security-playbook-run-step-0-targets",
    );

    expect(within(list).getByText("suspended")).toBeInTheDocument();
    expect(
      within(list).getByText(
        "Protected (matches breakglass@*): never acted on",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("security-playbook-undo-mallory@acme.com"),
    ).toBeInTheDocument();
    // Suspended before the step ran, or never touched: not the step's to give back.
    expect(
      screen.queryByTestId("security-playbook-undo-bob@acme.com"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("security-playbook-undo-breakglass@acme.com"),
    ).not.toBeInTheDocument();
  });

  test("undoes a contained target after a confirmation, then reloads the run", async () => {
    const undo: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseApi, "undoTarget")
      .mockResolvedValue(undefined as never);

    await renderCard(
      containmentRun({
        status: SecurityPlaybookRunStatus.Succeeded,
        stepStatus: SecurityPlaybookStepStatus.Succeeded,
        targets: [
          target("mallory@acme.com", SecurityPlaybookTargetState.Done, {
            detail: "suspended",
          }),
        ],
      }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("security-playbook-undo-mallory@acme.com"),
      );
    });

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "mallory@acme.com gets its access back, undoing step 1.",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(undo).toHaveBeenCalledWith({
      runId: new ObjectID(RUN_ID),
      stepId: "s1",
      value: "mallory@acme.com",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  test("does not offer the undo while the run is still running", async () => {
    await renderCard(
      containmentRun({
        status: SecurityPlaybookRunStatus.Running,
        stepStatus: SecurityPlaybookStepStatus.Succeeded,
        targets: [
          target("mallory@acme.com", SecurityPlaybookTargetState.Done, {
            detail: "suspended",
          }),
        ],
      }),
    );

    expect(
      screen.getByTestId("security-playbook-undo-mallory@acme.com"),
    ).toBeDisabled();
  });
});

describe("a containment step waiting for approval on the run card", () => {
  function waitingRun(): SecurityPlaybookRun {
    return containmentRun({
      status: SecurityPlaybookRunStatus.WaitingForApproval,
      stepStatus: SecurityPlaybookStepStatus.WaitingForApproval,
      targets: [
        target("mallory@acme.com", SecurityPlaybookTargetState.Proposed),
        target("trent@acme.com", SecurityPlaybookTargetState.Proposed, {
          reason: SecurityPlaybookTargetReason.ThreatIntel,
        }),
        target("breakglass@acme.com", SecurityPlaybookTargetState.Protected),
      ],
    });
  }

  test("the person who started the run cannot approve it, and can still reject it", async () => {
    jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(STARTER_ID));

    await renderCard(waitingRun());

    expect(screen.getByRole("button", { name: /Approve/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeEnabled();
  });

  test("asks about every target, all ticked, names the protected ones, and sends the ones kept", async () => {
    const decide: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseApi, "decideApproval")
      .mockResolvedValue(undefined as never);

    await renderCard(waitingRun());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    });

    const modal: HTMLElement = screen.getByTestId("modal");
    const boxes: Array<HTMLElement> = within(modal).getAllByRole("checkbox");

    expect(within(modal).getByText("Act On")).toBeInTheDocument();
    expect(boxes).toHaveLength(2);
    expect(
      boxes.every((box: HTMLElement): boolean => {
        return (box as HTMLInputElement).checked;
      }),
    ).toBe(true);
    expect(
      within(modal).getByText("Known to threat intel"),
    ).toBeInTheDocument();
    expect(within(modal).getByTestId("modal-description")).toHaveTextContent(
      "It never acts on protected entities: breakglass@acme.com.",
    );

    // Leave trent out.
    await act(async () => {
      fireEvent.click(boxes[1]!);
    });

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
    });

    expect(decide).toHaveBeenCalledTimes(1);
    expect(
      (decide.mock.calls[0]![0] as { targets: Array<string> }).targets,
    ).toEqual(["mallory@acme.com"]);
    expect(
      (decide.mock.calls[0]![0] as { isApproved: boolean }).isApproved,
    ).toBe(true);
  });
});
