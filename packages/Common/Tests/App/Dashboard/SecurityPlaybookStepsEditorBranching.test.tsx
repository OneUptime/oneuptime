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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityPlaybookStepsEditor from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepsEditor";
import { PlaybookConnectionOption } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepDialog";
import { emptyStepNameLookup } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepSummary";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { SecurityPlaybookStepOutcome } from "../../../Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "../../Helpers/SecurityCaseValues";

/*
 * A playbook's steps, drawn for real, with a branch in them: each step
 * that waits on another says so on its card; the step a branch reads can
 * be neither deleted nor moved below a step that waits on it, and its menu
 * says why; and a step's dialog folds Run This Step and Carry On If It
 * Fails under More fields, where picking an earlier step's result saves the
 * step's condition.
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

const CHECK: SecurityPlaybookStep = {
  id: "check",
  action: SecurityPlaybookActionType.CheckThreatIntel,
  config: {},
  requiresApproval: false,
  continueOnFailure: false,
  onlyIfThreatIntelMatched: false,
};

const SUSPEND: SecurityPlaybookStep = {
  id: "suspend",
  action: SecurityPlaybookActionType.SuspendOktaUser,
  config: { connectionId: "11111111-1111-4111-8111-111111111111" },
  requiresApproval: true,
  continueOnFailure: false,
  onlyIfThreatIntelMatched: false,
  runIf: { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
};

const SLACK: SecurityPlaybookStep = {
  id: "slack",
  action: SecurityPlaybookActionType.PostToSlack,
  config: { channelName: "soc" },
  requiresApproval: false,
  continueOnFailure: false,
  onlyIfThreatIntelMatched: false,
};

const CONNECTIONS: Array<PlaybookConnectionOption> = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Okta",
    provider: SecurityEventConnectorProvider.OktaSystemLog,
  },
];

let saved: Array<Array<SecurityPlaybookStep>>;

function renderEditor(steps: Array<SecurityPlaybookStep>): void {
  render(
    <MemoryRouter>
      <SecurityPlaybookStepsEditor
        steps={steps}
        lookup={emptyStepNameLookup()}
        connections={CONNECTIONS}
        caseValues={{
          priorities: buildDefaultTestPriorities(),
          statuses: buildDefaultTestStatuses(),
        }}
        canEdit={true}
        onSave={async (next: Array<SecurityPlaybookStep>): Promise<void> => {
          saved.push(next);
        }}
      />
    </MemoryRouter>,
  );
}

async function openMenu(stepNumber: number): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: `Step ${stepNumber} actions` }),
    );
  });

  return await screen.findByRole("menu");
}

beforeEach(() => {
  saved = [];
  jest.spyOn(PermissionGate, "holdsAnyOf").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a playbook's steps, with a branch", () => {
  test("each step that waits on another says which step and which result, on its card", () => {
    renderEditor([
      CHECK,
      SUSPEND,
      {
        ...SLACK,
        runIf: {
          stepId: "check",
          outcome: SecurityPlaybookStepOutcome.FoundNothing,
        },
      },
    ]);

    expect(
      screen.getByTestId("security-playbook-step-1-run-if"),
    ).toHaveTextContent("Only if step 1 found a known-bad entity");
    expect(
      screen.getByTestId("security-playbook-step-2-run-if"),
    ).toHaveTextContent("Only if step 1 found nothing known-bad");
    // The step it waits on runs always, and says nothing of it.
    expect(
      screen.queryByTestId("security-playbook-step-0-run-if"),
    ).not.toBeInTheDocument();
  });

  test("a step saved with the legacy threat intel switch still says so", () => {
    renderEditor([
      CHECK,
      { ...SLACK, onlyIfThreatIntelMatched: true },
    ]);

    expect(
      screen.getByTestId("security-playbook-step-1-run-if"),
    ).toHaveTextContent("Only if threat intel matched");
  });

  test("the step a branch reads cannot be deleted or moved below it, and its menu says why", async () => {
    renderEditor([CHECK, SUSPEND, SLACK]);

    const menu: HTMLElement = await openMenu(1);
    const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: /Delete Step/,
    });
    const down: HTMLElement = within(menu).getByRole("menuitem", {
      name: /Move Down/,
    });
    const reason: string =
      "Step 2 runs only after this step's result. Change when step 2 runs first.";

    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(deleteItem).toHaveAccessibleDescription(reason);
    expect(down).toHaveAttribute("aria-disabled", "true");
    expect(down).toHaveAccessibleDescription(reason);

    await act(async () => {
      fireEvent.click(deleteItem);
    });

    // Nothing was asked, nothing was saved.
    expect(screen.queryByText("Delete Step", { selector: "h3" })).toBeNull();
    expect(saved).toEqual([]);
  });

  test("the step that waits stays below the step it waits on", async () => {
    renderEditor([CHECK, SUSPEND, SLACK]);

    const menu: HTMLElement = await openMenu(2);
    const up: HTMLElement = within(menu).getByRole("menuitem", {
      name: /Move Up/,
    });

    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(up).toHaveAccessibleDescription(
      "This step runs only after step 1's result, so it stays below step 1.",
    );
    // Down is free: nothing waits on it.
    expect(
      within(menu).getByRole("menuitem", { name: /Move Down/ }),
    ).toHaveAttribute("aria-disabled", "false");
  });

  test("a step's dialog folds Run This Step under More fields, and a picked result becomes its condition", async () => {
    renderEditor([CHECK, SUSPEND, SLACK]);

    const menu: HTMLElement = await openMenu(3);

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: /Edit Step/ }),
      );
    });

    const dialog: HTMLElement = await screen.findByTestId("modal");

    // Folded: the line names what is in it, the picker is not drawn yet.
    const moreFields: HTMLElement = within(dialog).getByRole("button", {
      name: /More fields/,
    });

    expect(moreFields).toHaveTextContent("Run This Step");
    expect(moreFields).toHaveTextContent("Carry On If It Fails");
    expect(within(dialog).queryByRole("combobox")).toBeNull();

    await act(async () => {
      fireEvent.click(moreFields);
    });

    const picker: HTMLElement = await within(dialog).findByRole("combobox");

    expect(dialog).toHaveTextContent("Always");

    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });

    // Each result of each earlier step, in the order the steps run.
    expect(
      await screen.findByText(
        "Only if step 1 (Check entities against threat intel) found a known-bad entity",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Only if step 2 (Suspend the user in Okta) succeeded"),
    ).toBeInTheDocument();
    // Step 2 stops the run when it fails: its failure is no result to wait on.
    expect(
      screen.queryByText("Only if step 2 (Suspend the user in Okta) failed"),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByText(
          "Only if step 1 (Check entities against threat intel) found nothing known-bad",
        ),
      );
    });

    await act(async () => {
      fireEvent.click(
        within(dialog).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]![2]!.runIf).toEqual({
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.FoundNothing,
    });
    // The other steps are saved as they were.
    expect(saved[0]![1]!.runIf).toEqual(SUSPEND.runIf);
    expect(saved[0]![0]!.runIf).toBeUndefined();
  });

  test("the first step has nothing before it to wait on: no Run This Step", async () => {
    renderEditor([SLACK]);

    const menu: HTMLElement = await openMenu(1);

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: /Edit Step/ }),
      );
    });

    const dialog: HTMLElement = await screen.findByTestId("modal");
    const moreFields: HTMLElement = within(dialog).getByRole("button", {
      name: /More fields/,
    });

    expect(moreFields).not.toHaveTextContent("Run This Step");
    expect(moreFields).toHaveTextContent("Carry On If It Fails");
  });
});
