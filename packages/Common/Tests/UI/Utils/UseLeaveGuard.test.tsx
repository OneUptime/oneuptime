// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import useLeaveGuard, { LeavePrompt } from "../../../UI/Utils/UseLeaveGuard";

/*
 * useLeaveGuard holds the leave guard while the page has unsaved work, and
 * hands the page what it needs to ask in its own words: whether someone is
 * leaving, Keep Editing (stay) and Discard Changes (leave).
 */

const Page: FunctionComponent<{ hasUnsavedChanges: boolean }> = (props: {
  hasUnsavedChanges: boolean;
}): ReactElement => {
  const prompt: LeavePrompt = useLeaveGuard(props.hasUnsavedChanges);

  return prompt.isAsking ? (
    <div role="dialog" aria-label="Leave without saving?">
      <button type="button" onClick={prompt.stay}>
        Keep Editing
      </button>
      <button type="button" onClick={prompt.leave}>
        Discard Changes
      </button>
    </div>
  ) : (
    <p>Editing</p>
  );
};

const dispatchBeforeUnload: () => Event = (): Event => {
  const event: Event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

const leaveTo: (address: string, step: () => void) => void = (
  address: string,
  step: () => void,
): void => {
  act(() => {
    LeaveGuard.whenLeaving(address, step);
  });
};

beforeEach(() => {
  LeaveGuard.reset();
  window.history.replaceState(
    { usr: null, key: "d1", idx: 0 },
    "",
    "/dashboard/p1/dashboards/d1",
  );
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
});

describe("useLeaveGuard", () => {
  test("a page with nothing unsaved holds nothing, and nothing asks", () => {
    const step: Mock<() => void> = jest.fn<() => void>();

    render(<Page hasUnsavedChanges={false} />);

    expect(LeaveGuard.isHeld()).toBe(false);
    leaveTo("/dashboard/p1/monitors", step);

    expect(step).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  test("with unsaved work, leaving asks, and the step waits", () => {
    const step: Mock<() => void> = jest.fn<() => void>();

    render(<Page hasUnsavedChanges={true} />);

    expect(LeaveGuard.isHeld()).toBe(true);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    leaveTo("/dashboard/p1/monitors", step);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(step).not.toHaveBeenCalled();
  });

  test("Keep Editing closes the question, drops the step and keeps holding", () => {
    const step: Mock<() => void> = jest.fn<() => void>();

    render(<Page hasUnsavedChanges={true} />);
    leaveTo("/dashboard/p1/monitors", step);

    fireEvent.click(screen.getByText("Keep Editing"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(step).not.toHaveBeenCalled();
    expect(LeaveGuard.isHeld()).toBe(true);

    // The next try asks again.
    leaveTo("/dashboard/p1/monitors", step);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("Discard Changes takes the step once, with the guard let go", () => {
    const heldWhenTaken: Array<boolean> = [];

    render(<Page hasUnsavedChanges={true} />);
    leaveTo("/dashboard/p1/monitors", () => {
      heldWhenTaken.push(LeaveGuard.isHeld());
    });

    fireEvent.click(screen.getByText("Discard Changes"));

    expect(heldWhenTaken).toEqual([false]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  test("asked twice before answering, Discard Changes takes the latest step", () => {
    const first: Mock<() => void> = jest.fn<() => void>();
    const second: Mock<() => void> = jest.fn<() => void>();

    render(<Page hasUnsavedChanges={true} />);
    leaveTo("/dashboard/p1/monitors", first);
    leaveTo("/dashboard/p1/incidents", second);

    fireEvent.click(screen.getByText("Discard Changes"));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("once nothing is unsaved (saved or discarded), it lets go and stops asking", () => {
    const step: Mock<() => void> = jest.fn<() => void>();
    const { rerender } = render(<Page hasUnsavedChanges={true} />);

    leaveTo("/dashboard/p1/monitors", step);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(<Page hasUnsavedChanges={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(LeaveGuard.isHeld()).toBe(false);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    leaveTo("/dashboard/p1/monitors", step);
    expect(step).toHaveBeenCalledTimes(1);
  });

  test("a page that leaves the screen lets go", () => {
    const { unmount } = render(<Page hasUnsavedChanges={true} />);

    expect(LeaveGuard.isHeld()).toBe(true);

    unmount();

    expect(LeaveGuard.isHeld()).toBe(false);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});
