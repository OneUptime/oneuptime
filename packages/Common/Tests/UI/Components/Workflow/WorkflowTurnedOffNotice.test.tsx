/*
 * The notice above the Builder's canvas while the workflow is turned off.
 *
 * People used to find out that a workflow was off from an Error dialog after
 * trying to run it, and that dialog did not say how to turn it on. The notice
 * says so up front, with the one thing to do about it.
 */

import WorkflowTurnedOffNotice from "../../../../UI/Components/Workflow/WorkflowTurnedOffNotice";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

describe("the notice for a workflow that is off", () => {
  test("says the workflow is off and what that means, as a status, not an alarm", () => {
    render(<WorkflowTurnedOffNotice onTurnOn={getJestMockFunction()} />);

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("This workflow is off");
    expect(notice).toHaveTextContent(
      "Its trigger is ignored and it can't be run or tested until you turn it on.",
    );
  });

  test("offers to turn it on, as its one primary button", () => {
    const onTurnOn: MockFunction = getJestMockFunction();

    render(<WorkflowTurnedOffNotice onTurnOn={onTurnOn} />);

    const button: HTMLElement = screen.getByTestId("workflow-turn-on-button");

    expect(button).toHaveTextContent("Turn on workflow");
    expect(button.className).toMatch(/\bbg-indigo-600\b/);

    fireEvent.click(button);

    expect(onTurnOn).toHaveBeenCalledTimes(1);
  });

  test("while it is being turned on, the button cannot be pressed again", () => {
    const onTurnOn: MockFunction = getJestMockFunction();

    render(<WorkflowTurnedOffNotice onTurnOn={onTurnOn} isTurningOn={true} />);

    const button: HTMLButtonElement = screen.getByTestId(
      "workflow-turn-on-button",
    ) as HTMLButtonElement;

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onTurnOn).not.toHaveBeenCalled();
  });

  test("someone who may not turn it on is told who can, with no button", () => {
    render(<WorkflowTurnedOffNotice />);

    expect(screen.queryByTestId("workflow-turn-on-button")).toBeNull();
    expect(
      screen.getByTestId("workflow-turned-off-notice-who-can"),
    ).toHaveTextContent(
      "Only people who can edit this workflow can turn it on.",
    );
  });

  test("someone who may turn it on is not told who can", () => {
    render(<WorkflowTurnedOffNotice onTurnOn={getJestMockFunction()} />);

    expect(
      screen.queryByTestId("workflow-turned-off-notice-who-can"),
    ).toBeNull();
  });

  test("its icon is decoration, and its text is not inside a paragraph with a div in it", () => {
    render(<WorkflowTurnedOffNotice onTurnOn={getJestMockFunction()} />);

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    // Icon draws a div; a div inside a <p> is invalid markup.
    for (const paragraph of Array.from(notice.querySelectorAll("p"))) {
      expect(paragraph.querySelector("div")).toBeNull();
    }

    expect(notice.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });
});
