/*
 * The workflow's Enabled switch at the top of the Builder.
 *
 * It used to live only behind Edit on the Overview page, two pages from
 * where a workflow is built and run. It is named the same as there, so the
 * messages that point at it ("the Enabled switch") point at something with
 * that name.
 */

import WorkflowEnabledSwitch from "../../../../UI/Components/Workflow/WorkflowEnabledSwitch";
import { WORKFLOW_ENABLED_SWITCH_LABEL } from "../../../../Types/Workflow/WorkflowEnabled";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";

const PERMISSION_REASON: string =
  "You do not have permission to edit this Workflow. You need one of these permissions: Edit Workflow.";

type SwitchFunction = () => HTMLElement;

const theSwitch: SwitchFunction = (): HTMLElement => {
  return screen.getByRole("switch", { name: WORKFLOW_ENABLED_SWITCH_LABEL });
};

afterEach(() => {
  cleanup();
});

describe("the Enabled switch", () => {
  test("is a switch named Enabled", () => {
    render(
      <WorkflowEnabledSwitch
        isEnabled={false}
        onChange={getJestMockFunction()}
      />,
    );

    expect(WORKFLOW_ENABLED_SWITCH_LABEL).toBe("Enabled");
    expect(theSwitch()).toHaveAttribute(
      "data-testid",
      "workflow-enabled-switch",
    );
  });

  test.each([
    [true, "true"],
    [false, "false"],
  ])(
    "shows the workflow's state: on is %s",
    (isEnabled: boolean, checked: string) => {
      render(
        <WorkflowEnabledSwitch
          isEnabled={isEnabled}
          onChange={getJestMockFunction()}
        />,
      );

      expect(theSwitch()).toHaveAttribute("aria-checked", checked);
    },
  );

  test("pressed while off, asks to turn the workflow on", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(<WorkflowEnabledSwitch isEnabled={false} onChange={onChange} />);

    fireEvent.click(theSwitch());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("pressed while on, asks to turn it off", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(<WorkflowEnabledSwitch isEnabled={true} onChange={onChange} />);

    fireEvent.click(theSwitch());

    expect(onChange).toHaveBeenCalledWith(false);
  });

  test("its name flips it too, as a label does", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(<WorkflowEnabledSwitch isEnabled={false} onChange={onChange} />);

    fireEvent.click(screen.getByText(WORKFLOW_ENABLED_SWITCH_LABEL));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("while it is saving, a second press is not sent", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <WorkflowEnabledSwitch
        isEnabled={true}
        isSaving={true}
        onChange={onChange}
      />,
    );

    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(theSwitch());

    expect(onChange).not.toHaveBeenCalled();
  });

  test("someone who may not change it still sees the state, with the permission they would need", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <WorkflowEnabledSwitch
        isEnabled={false}
        disabledReason={PERMISSION_REASON}
        onChange={onChange}
      />,
    );

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(theSwitch()).toHaveAccessibleDescription(PERMISSION_REASON);

    fireEvent.click(theSwitch());

    expect(onChange).not.toHaveBeenCalled();
  });

  test("someone who may change it gets no permission note", () => {
    render(
      <WorkflowEnabledSwitch
        isEnabled={false}
        onChange={getJestMockFunction()}
      />,
    );

    expect(theSwitch()).not.toHaveAttribute("aria-disabled");
    expect(theSwitch()).not.toHaveAttribute("aria-describedby");
  });
});
