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
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookConditionMatch,
  SecurityPlaybookStepOutcome,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "../../Helpers/SecurityCaseValues";

/*
 * A playbook's steps, drawn for real, with a step that waits on several
 * earlier results and a Stop step. Run This Step takes several results;
 * once two are picked, Run When asks whether all of them must have
 * happened or any one, and the step saves as it says. A Stop step's dialog
 * asks why it stops and nothing it cannot use - no approval, no carrying
 * on - and its card says why. A Stop step that always runs, with steps
 * after it, is refused, saying why. The step picker lists it last, under
 * Flow control.
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

const REASON: string = "Nothing known-bad: nothing to contain";

const CHECK: SecurityPlaybookStep = {
  id: "check",
  action: SecurityPlaybookActionType.CheckThreatIntel,
  config: {},
  requiresApproval: false,
  continueOnFailure: false,
  onlyIfThreatIntelMatched: false,
};

const LOOKUP: SecurityPlaybookStep = {
  id: "lookup",
  action: SecurityPlaybookActionType.LookUpEntityActivity,
  config: { lookbackInHours: 24 },
  requiresApproval: false,
  continueOnFailure: false,
  onlyIfThreatIntelMatched: false,
};

const SLACK: SecurityPlaybookStep = {
  id: "slack",
  action: SecurityPlaybookActionType.PostToSlack,
  config: { channelName: "soc" },
  requiresApproval: false,
  continueOnFailure: false,
  onlyIfThreatIntelMatched: false,
};

const STOP: SecurityPlaybookStep = {
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
};

const CONNECTIONS: Array<PlaybookConnectionOption> = [];

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

async function editStep(stepNumber: number): Promise<HTMLElement> {
  const menu: HTMLElement = await openMenu(stepNumber);

  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Edit Step/ }));
  });

  return await screen.findByTestId("modal");
}

async function openMoreFields(dialog: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: /More fields/ }),
    );
  });
}

// Picks one more result in Run This Step: the menu closes after each pick.
async function pickResult(dialog: HTMLElement, label: string): Promise<void> {
  const picker: HTMLElement = await within(dialog).findByRole("combobox", {
    name: /^Run This Step/,
  });

  fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });

  const option: HTMLElement = await screen.findByText(label);

  await act(async () => {
    fireEvent.click(option);
  });
}

async function submit(dialog: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
  });
}

beforeEach(() => {
  saved = [];
  jest.spyOn(PermissionGate, "holdsAnyOf").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a step that waits on several earlier results", () => {
  test("one result picked asks nothing more; a second asks Run When, all of them first, and any one saves as any", async () => {
    renderEditor([CHECK, LOOKUP, SLACK]);

    const dialog: HTMLElement = await editStep(3);

    await openMoreFields(dialog);
    await pickResult(
      dialog,
      "Only if step 1 (Check entities against threat intel) found a known-bad entity",
    );

    expect(within(dialog).queryByText("Run When")).toBeNull();

    await pickResult(
      dialog,
      "Only if step 2 (Look up entity activity) found activity",
    );

    const all: HTMLElement = await within(dialog).findByRole("radio", {
      name: "When all of them happened",
    });
    const any: HTMLElement = within(dialog).getByRole("radio", {
      name: "When any one of them happened",
    });

    expect(all).toBeChecked();
    expect(any).not.toBeChecked();

    await act(async () => {
      fireEvent.click(any);
    });

    await submit(dialog);

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]![2]!.runIf).toEqual({
      match: SecurityPlaybookConditionMatch.Any,
      conditions: [
        { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
        { stepId: "lookup", outcome: SecurityPlaybookStepOutcome.Found },
      ],
    });
  });

  test("two results left as they are save as all of them", async () => {
    renderEditor([CHECK, LOOKUP, SLACK]);

    const dialog: HTMLElement = await editStep(3);

    await openMoreFields(dialog);
    await pickResult(
      dialog,
      "Only if step 1 (Check entities against threat intel) found nothing known-bad",
    );
    await pickResult(
      dialog,
      "Only if step 2 (Look up entity activity) found no activity",
    );
    await submit(dialog);

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]![2]!.runIf).toEqual({
      match: SecurityPlaybookConditionMatch.All,
      conditions: [
        { stepId: "check", outcome: SecurityPlaybookStepOutcome.FoundNothing },
        { stepId: "lookup", outcome: SecurityPlaybookStepOutcome.FoundNothing },
      ],
    });
  });

  test("its card names each result, and its dialog opens with each picked and Run When as saved", async () => {
    renderEditor([
      CHECK,
      LOOKUP,
      {
        ...SLACK,
        runIf: {
          match: SecurityPlaybookConditionMatch.Any,
          conditions: [
            { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
            { stepId: "lookup", outcome: SecurityPlaybookStepOutcome.Found },
          ],
        },
      },
    ]);

    expect(
      screen.getByTestId("security-playbook-step-2-run-if"),
    ).toHaveTextContent(
      "Only if step 1 found a known-bad entity or step 2 found activity",
    );

    const dialog: HTMLElement = await editStep(3);
    const folded: HTMLElement | undefined = within(dialog)
      .getAllByTestId("folded-section-item")
      .find((item: HTMLElement): boolean => {
        return (item.textContent || "").startsWith("Run This Step");
      });

    expect(folded).toHaveAttribute("data-item-set", "true");
    expect(folded).toHaveTextContent(/^Run This Step: Only if step 1 found/);

    await openMoreFields(dialog);

    expect(
      within(dialog).getByText(
        "Only if step 1 (Check entities against threat intel) found a known-bad entity",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Only if step 2 (Look up entity activity) found activity",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", {
        name: "When any one of them happened",
      }),
    ).toBeChecked();

    // Saved again untouched, it is what it was.
    await submit(dialog);

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]![2]!.runIf).toEqual({
      match: SecurityPlaybookConditionMatch.Any,
      conditions: [
        { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
        { stepId: "lookup", outcome: SecurityPlaybookStepOutcome.Found },
      ],
    });
  });
});

describe("a Stop step", () => {
  test("its card says why it stops, and when", () => {
    renderEditor([CHECK, STOP, SLACK]);

    const card: HTMLElement = screen.getByTestId("security-playbook-step-1");

    expect(card).toHaveTextContent("Stop the run");
    expect(card).toHaveTextContent(REASON);
    expect(
      screen.getByTestId("security-playbook-step-1-run-if"),
    ).toHaveTextContent("Only if step 1 found nothing known-bad");
    expect(within(card).queryByText("Needs approval")).toBeNull();
  });

  test("its dialog asks why it stops, and neither Needs Approval nor Carry On If It Fails", async () => {
    renderEditor([CHECK, STOP, SLACK]);

    const dialog: HTMLElement = await editStep(2);
    const why: HTMLElement = within(dialog).getByRole("textbox", {
      name: /Why It Stops/,
    });

    expect(why).toHaveValue(REASON);
    expect(within(dialog).queryByText("Needs Approval")).toBeNull();

    const moreFields: HTMLElement = within(dialog).getByRole("button", {
      name: /More fields/,
    });

    expect(moreFields).toHaveTextContent("Run This Step");
    expect(moreFields).not.toHaveTextContent("Carry On If It Fails");

    await act(async () => {
      fireEvent.change(why, {
        target: { value: "Threat intel knows nothing of the user" },
      });
    });

    await submit(dialog);

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]![1]!.config).toEqual({
      reason: "Threat intel knows nothing of the user",
    });
    expect(saved[0]![1]!.requiresApproval).toBe(false);
    expect(saved[0]![1]!.continueOnFailure).toBe(false);
    expect(saved[0]![1]!.runIf).toEqual(STOP.runIf);
  });

  test("no step after it can wait on it: Run This Step does not offer it", async () => {
    renderEditor([CHECK, STOP, SLACK]);

    const dialog: HTMLElement = await editStep(3);

    await openMoreFields(dialog);

    const picker: HTMLElement = await within(dialog).findByRole("combobox", {
      name: /^Run This Step/,
    });

    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });

    expect(
      await screen.findByText(
        "Only if step 1 (Check entities against threat intel) found a known-bad entity",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Only if step 2 \(Stop the run\)/)).toBeNull();
  });

  test("one that always runs, moved above another step, is refused, saying why", async () => {
    renderEditor([CHECK, SLACK, { ...STOP, runIf: undefined }]);

    const menu: HTMLElement = await openMenu(3);

    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: /Move Up/ }));
    });

    expect(
      await screen.findByText(
        "Step 2 (Stop the run): it always stops the run, so the steps after it would never run. Make it run only after an earlier step's result, or move it to the end.",
      ),
    ).toBeInTheDocument();
    expect(saved).toEqual([]);
  });

  test("the step picker lists it last, on its own, under Flow control", async () => {
    renderEditor([CHECK]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Step/ }));
    });

    const dialog: HTMLElement = await screen.findByTestId("modal");
    // In the order the dialog draws them: each must follow the one before.
    const inOrder: Array<HTMLElement> = [
      within(dialog).getByText("Automate"),
      within(dialog).getByText("Fix the code with AI"),
      within(dialog).getByText("Flow control"),
      within(dialog).getByText("Stop the run"),
    ];

    for (let index: number = 1; index < inOrder.length; index++) {
      expect(
        inOrder[index - 1]!.compareDocumentPosition(inOrder[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    expect(dialog).toHaveTextContent(
      "End the run here, as done: the steps after it do not run.",
    );
  });
});
