/*
 * The notice above the Builder's canvas while the workflow is turned off.
 *
 * It says what off means - the trigger is paused - and, since "Why do I have
 * to enable a workflow in order to test run it?", what it does not: the
 * workflow can still be tested with Run Workflow. It used to say the
 * workflow "can't be run or tested until you turn it on". Then the one thing
 * to do about it, for whoever may; anyone else is told who can.
 *
 * What it says depends on who reads it: whether they may turn the workflow
 * on (the Turn on workflow button) and whether they may run it (Run
 * Workflow). Each case is one whole sentence, looked up as one key - never
 * two sentences joined with a space, which Japanese and Chinese do not put
 * after a full stop.
 */

import WorkflowTurnedOffNotice, {
  getNoticeBody,
} from "../../../../UI/Components/Workflow/WorkflowTurnedOffNotice";
import { WorkflowEnabledCopy } from "../../../../UI/Components/Workflow/WorkflowEnabledCopy";
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

afterEach(() => {
  cleanup();
});

const noticeBody: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("workflow-turned-off-notice-body");
};

describe("the notice for a workflow that is off", () => {
  test("says the workflow is off and what that means, as a status, not an alarm", () => {
    render(<WorkflowTurnedOffNotice onTurnOn={getJestMockFunction()} />);

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).toHaveAttribute("role", "status");
    expect(
      screen.getByTestId("workflow-turned-off-notice-title"),
    ).toHaveTextContent("This workflow is off");
    expect(noticeBody()).toHaveTextContent(
      "Its trigger is paused until you turn it on. You can still test it with Run Workflow.",
    );
  });

  test("no longer says the workflow can't be run or tested", () => {
    render(<WorkflowTurnedOffNotice onTurnOn={getJestMockFunction()} />);

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).not.toHaveTextContent("can't be run or tested");
    expect(notice).not.toHaveTextContent("ignored");
  });

  test("names the Run Workflow button in bold, as the toolbar draws it", () => {
    render(<WorkflowTurnedOffNotice onTurnOn={getJestMockFunction()} />);

    const button: HTMLElement = within(noticeBody()).getByText("Run Workflow");

    expect(button.tagName).toBe("STRONG");
    // The rest of the sentence is around it, not inside it.
    expect(button).toHaveTextContent(/^Run Workflow$/);
  });

  test.each([
    {
      reader: "may turn it on and run it",
      canTurnOn: true,
      canTest: true,
      body: "Its trigger is paused until you turn it on. You can still test it with Run Workflow.",
    },
    {
      reader: "may turn it on but not run it",
      canTurnOn: true,
      canTest: false,
      body: "Its trigger is paused until you turn it on.",
    },
    {
      reader: "may run it but not turn it on (a Workflow Member)",
      canTurnOn: false,
      canTest: true,
      body: "Its trigger is paused until someone who can edit this workflow turns it on. You can still test it with Run Workflow.",
    },
    {
      reader: "may neither run it nor turn it on",
      canTurnOn: false,
      canTest: false,
      body: "Its trigger is paused until someone who can edit this workflow turns it on.",
    },
  ])(
    "someone who $reader reads one whole sentence for it",
    (data: {
      reader: string;
      canTurnOn: boolean;
      canTest: boolean;
      body: string;
    }) => {
      render(
        <WorkflowTurnedOffNotice
          onTurnOn={data.canTurnOn ? getJestMockFunction() : undefined}
          canTest={data.canTest}
        />,
      );

      expect(noticeBody().textContent).toBe(data.body);
      expect(screen.queryAllByTestId("workflow-turn-on-button")).toHaveLength(
        data.canTurnOn ? 1 : 0,
      );
      // One paragraph says it all: no second line about who can.
      expect(
        screen.getByTestId("workflow-turned-off-notice").querySelectorAll("p"),
      ).toHaveLength(2);
    },
  );

  test("each case is one key of the copy, not two sentences joined", () => {
    expect(getNoticeBody({ canTurnOn: true, canTest: true })).toBe(
      WorkflowEnabledCopy.noticeBodyCanTest,
    );
    expect(getNoticeBody({ canTurnOn: true, canTest: false })).toBe(
      WorkflowEnabledCopy.noticeBody,
    );
    expect(getNoticeBody({ canTurnOn: false, canTest: true })).toBe(
      WorkflowEnabledCopy.noticeBodyForOthersCanTest,
    );
    expect(getNoticeBody({ canTurnOn: false, canTest: false })).toBe(
      WorkflowEnabledCopy.noticeBodyForOthers,
    );

    // The button is a slot of the sentence, so a language can move it.
    expect(WorkflowEnabledCopy.noticeBodyCanTest).toContain("{{button}}");
    expect(WorkflowEnabledCopy.noticeBodyForOthersCanTest).toContain(
      "{{button}}",
    );
    expect(WorkflowEnabledCopy.noticeBody).not.toContain("{{");
    expect(WorkflowEnabledCopy.noticeBodyForOthers).not.toContain("{{");
  });

  test("someone who may not turn it on is never told 'until you turn it on'", () => {
    render(<WorkflowTurnedOffNotice />);

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).not.toHaveTextContent("until you turn it on");
    expect(notice).toHaveTextContent(
      "until someone who can edit this workflow turns it on",
    );
    expect(screen.queryByTestId("workflow-turn-on-button")).toBeNull();
  });

  test("offers Run Workflow to someone who may run it, even when they may not turn it on", () => {
    render(<WorkflowTurnedOffNotice canTest={true} />);

    expect(noticeBody()).toHaveTextContent(
      "You can still test it with Run Workflow.",
    );
  });

  test("does not offer Run Workflow to someone who may not run the workflow", () => {
    render(
      <WorkflowTurnedOffNotice
        canTest={false}
        onTurnOn={getJestMockFunction()}
      />,
    );

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).not.toHaveTextContent("You can still test it");
    expect(notice).not.toHaveTextContent("Run Workflow");
    expect(notice.querySelector("strong")).toBeNull();
  });

  test("leaving canTest out offers Run Workflow, as the server decides then", () => {
    render(<WorkflowTurnedOffNotice onTurnOn={getJestMockFunction()} />);

    expect(noticeBody()).toHaveTextContent(
      "You can still test it with Run Workflow.",
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
