/*
 * The dialog a run gets while its workflow is turned off.
 *
 * It replaced an Error dialog that said only "This workflow is not enabled"
 * and offered Close (the maintainer: "it doesnt tell me how to enable this
 * workflow"). It says why nothing ran, offers the one thing to do - turn the
 * workflow on and finish the run - and says what else that does and where the
 * switch is.
 */

import WorkflowTurnOnModal, {
  ComponentProps as ModalProps,
} from "../../../../UI/Components/Workflow/WorkflowTurnOnModal";
import {
  WorkflowRunAttempt,
  WorkflowRunKind,
} from "../../../../UI/Components/Workflow/UseWorkflowEnabled";
import { WorkflowEnabledCopy } from "../../../../UI/Components/Workflow/WorkflowEnabledCopy";
import { WORKFLOW_ENABLED_SWITCH_LABEL } from "../../../../Types/Workflow/WorkflowEnabled";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";

// A filled button: what a primary button looks like.
const FILLED_BUTTON_CLASS: RegExp = /\bbg-indigo-600\b/;

const STEP_RUN: WorkflowRunAttempt = {
  kind: WorkflowRunKind.Step,
  stepTitle: "If / Else",
  run: async (): Promise<void> => {
    // Not sent by the dialog itself.
  },
};

const WORKFLOW_RUN: WorkflowRunAttempt = {
  kind: WorkflowRunKind.Workflow,
  run: async (): Promise<void> => {
    // Not sent by the dialog itself.
  },
};

interface Harness {
  onTurnOn: MockFunction;
  onClose: MockFunction;
}

type RenderModalFunction = (overrides?: Partial<ModalProps>) => Harness;

const renderModal: RenderModalFunction = (
  overrides: Partial<ModalProps> = {},
): Harness => {
  const onTurnOn: MockFunction = getJestMockFunction();
  const onClose: MockFunction = getJestMockFunction();

  render(
    <WorkflowTurnOnModal
      attempt={STEP_RUN}
      triggerTitle="Webhook"
      canTurnOn={true}
      onTurnOn={onTurnOn}
      onClose={onClose}
      {...overrides}
    />,
  );

  return { onTurnOn, onClose };
};

type ElementFunction = () => HTMLElement;

const dialog: ElementFunction = (): HTMLElement => {
  return screen.getByRole("dialog");
};

const body: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("workflow-turn-on-prompt");
};

const submitButton: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("modal-footer-submit-button");
};

afterEach(() => {
  cleanup();
});

describe("Run just this step on a workflow that is off", () => {
  test("asks to turn the workflow on, and says which step could not run", () => {
    renderModal();

    expect(
      within(dialog()).getByText("Turn on this workflow?"),
    ).toBeInTheDocument();
    expect(body()).toHaveTextContent(
      'This workflow is off, so "If / Else" can\'t run. Turn the workflow on to run this step now.',
    );
  });

  test("the one primary button turns it on and runs the step", () => {
    const harness: Harness = renderModal();

    expect(submitButton()).toHaveTextContent("Turn on and run step");
    expect(submitButton().className).toMatch(FILLED_BUTTON_CLASS);

    fireEvent.click(submitButton());

    expect(harness.onTurnOn).toHaveBeenCalledTimes(1);
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  test("Cancel is the plain way out, and does not turn anything on", () => {
    const harness: Harness = renderModal();
    const cancel: HTMLElement = screen.getByTestId("modal-footer-close-button");

    expect(cancel).toHaveTextContent("Cancel");
    expect(cancel.className).not.toMatch(FILLED_BUTTON_CLASS);

    fireEvent.click(cancel);

    expect(harness.onClose).toHaveBeenCalledTimes(1);
    expect(harness.onTurnOn).not.toHaveBeenCalled();
  });

  test("says that the trigger starts the workflow from then on, naming it", () => {
    renderModal({ triggerTitle: "On Create Incident" });

    expect(body()).toHaveTextContent(
      "Once it's on, its On Create Incident trigger starts it too.",
    );
  });

  test("says where the switch is, by the name it is drawn with", () => {
    renderModal();

    expect(body()).toHaveTextContent(
      "You can turn it off again with the Enabled switch above the canvas.",
    );
    expect(WorkflowEnabledCopy.promptWhereTheSwitchIs).toContain(
      `${WORKFLOW_ENABLED_SWITCH_LABEL} switch`,
    );
  });

  test("names no trigger when there is none to name (no trigger, or a Manual one)", () => {
    renderModal({ triggerTitle: undefined });

    expect(body()).not.toHaveTextContent("trigger starts it too");
    expect(body()).toHaveTextContent(
      "You can turn it off again with the Enabled switch above the canvas.",
    );
  });

  test("a blank trigger name is no trigger", () => {
    renderModal({ triggerTitle: "   " });

    expect(body()).not.toHaveTextContent("trigger starts it too");
  });

  test("a step with no title falls back to the workflow sentence, still offering to run the step", () => {
    renderModal({ attempt: { ...STEP_RUN, stepTitle: " " } });

    expect(body()).toHaveTextContent(
      "This workflow is off, so it can't run. Turn it on to run it now.",
    );
    expect(submitButton()).toHaveTextContent("Turn on and run step");
  });

  test("a step's name is shown as it is, not read as markup or a template", () => {
    renderModal({
      attempt: { ...STEP_RUN, stepTitle: "<b>{{trigger}}</b>" },
    });

    expect(body()).toHaveTextContent(
      'This workflow is off, so "<b>{{trigger}}</b>" can\'t run.',
    );
    expect(body().querySelector("b")).toBeNull();
  });
});

describe("Run Workflow on a workflow that is off", () => {
  test("asks to turn it on and run it", () => {
    renderModal({ attempt: WORKFLOW_RUN });

    expect(body()).toHaveTextContent(
      "This workflow is off, so it can't run. Turn it on to run it now.",
    );
    expect(submitButton()).toHaveTextContent("Turn on and run");
    expect(submitButton()).not.toHaveTextContent("step");
  });
});

describe("while it is being turned on, and when that fails", () => {
  test("the button shows it is working and cannot be pressed twice", () => {
    renderModal({ isTurningOn: true });

    const button: HTMLButtonElement = submitButton() as HTMLButtonElement;

    expect(button.disabled || button.getAttribute("aria-busy") === "true").toBe(
      true,
    );
  });

  test("the reason it could not be turned on is shown in the dialog", () => {
    renderModal({
      error: "You do not have permission to update this Workflow.",
    });

    expect(
      within(dialog()).getByText(
        "You do not have permission to update this Workflow.",
      ),
    ).toBeInTheDocument();
    // Still offered: the reason may be gone on a second try.
    expect(submitButton()).toHaveTextContent("Turn on and run step");
  });

  test("an empty error shows no error", () => {
    renderModal({ error: "" });

    expect(within(dialog()).queryByRole("alert")).toBeNull();
  });
});

describe("someone who may not turn the workflow on", () => {
  test("is told who can, and the dialog only closes", () => {
    const harness: Harness = renderModal({ canTurnOn: false });

    expect(
      within(dialog()).getByText("This workflow is off"),
    ).toBeInTheDocument();
    expect(body()).toHaveTextContent(
      "This workflow is off, so it can't run. Only people who can edit this workflow can turn it on.",
    );
    expect(screen.queryByText("Turn on and run step")).toBeNull();
    expect(screen.queryByTestId("modal-footer-close-button")).toBeNull();

    // Plain: it acknowledges, it does not act.
    expect(submitButton()).toHaveTextContent("Close");
    expect(submitButton().className).not.toMatch(FILLED_BUTTON_CLASS);

    fireEvent.click(submitButton());

    expect(harness.onClose).toHaveBeenCalledTimes(1);
    expect(harness.onTurnOn).not.toHaveBeenCalled();
  });
});
