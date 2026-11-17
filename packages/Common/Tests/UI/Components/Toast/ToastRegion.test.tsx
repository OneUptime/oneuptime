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
import React from "react";
import ToastRegion from "../../../../UI/Components/Toast/ToastRegion";
import Toast, { SUCCESS_DURATION_IN_MS } from "../../../../UI/Utils/Toast";

/*
 * The toasts on the page (#9120): read out by a screen reader as they come,
 * a success gone by itself unless the reader is on it, an error kept until
 * it is closed, closed with its button or Escape, and its action run once.
 */

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  act(() => {
    Toast.dismissAll();
  });
  cleanup();
  jest.useRealTimers();
});

describe("ToastRegion", () => {
  test("its live regions are on the page before anything is said", () => {
    render(<ToastRegion />);

    const status: HTMLElement = screen.getByTestId("toast-region-status");
    const errors: HTMLElement = screen.getByTestId("toast-region-errors");

    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(errors).toHaveAttribute("role", "alert");
    expect(errors).toHaveAttribute("aria-live", "assertive");
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
  });

  test("a success is said politely and goes by itself", () => {
    render(<ToastRegion />);

    act(() => {
      Toast.success("Changes saved");
    });

    expect(
      within(screen.getByTestId("toast-region-status")).getByText(
        "Changes saved",
      ),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(SUCCESS_DURATION_IN_MS - 1);
    });
    expect(screen.getByText("Changes saved")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Changes saved")).not.toBeInTheDocument();
  });

  test("an error is said at once and stays until it is closed", () => {
    render(<ToastRegion />);

    act(() => {
      Toast.error("Couldn't pin Logs.", {
        description: <span>You need the Edit Project permission.</span>,
      });
    });

    const errors: HTMLElement = screen.getByTestId("toast-region-errors");
    expect(within(errors).getByText("Couldn't pin Logs.")).toBeInTheDocument();
    expect(
      within(errors).getByText("You need the Edit Project permission."),
    ).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(screen.getByText("Couldn't pin Logs.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Couldn't pin Logs.")).not.toBeInTheDocument();
  });

  test("the pointer on a toast holds it, and its time goes on once it leaves", () => {
    render(<ToastRegion />);

    act(() => {
      Toast.success("Changes saved");
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    fireEvent.mouseEnter(screen.getByTestId("toast"));
    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });
    expect(screen.getByText("Changes saved")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId("toast"));
    act(() => {
      jest.advanceTimersByTime(SUCCESS_DURATION_IN_MS - 2000 - 1);
    });
    expect(screen.getByText("Changes saved")).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Changes saved")).not.toBeInTheDocument();
  });

  test("the focus on a toast holds it, from one of its buttons to the other", () => {
    render(<ToastRegion />);

    act(() => {
      Toast.success("Nightly Backup deleted", {
        action: { title: "Undo", onClick: () => {} },
      });
    });

    const action: HTMLElement = screen.getByTestId("toast-action");
    const dismiss: HTMLElement = screen.getByTestId("toast-dismiss");

    fireEvent.focus(action);
    fireEvent.blur(action, { relatedTarget: dismiss });
    fireEvent.focus(dismiss);

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });
    expect(screen.getByText("Nightly Backup deleted")).toBeInTheDocument();
  });

  test("Escape closes the toast the focus is in, and not the dialog under it", () => {
    const onDialogKeyDown: ReturnType<typeof jest.fn> = jest.fn();

    render(
      <div onKeyDown={onDialogKeyDown}>
        <ToastRegion />
      </div>,
    );

    act(() => {
      Toast.error("Couldn't pin Logs.");
    });

    fireEvent.keyDown(screen.getByTestId("toast-dismiss"), { key: "Escape" });

    expect(screen.queryByText("Couldn't pin Logs.")).not.toBeInTheDocument();
    expect(onDialogKeyDown).not.toHaveBeenCalled();
  });

  test("its action runs once and closes it", () => {
    const onUndo: ReturnType<typeof jest.fn> = jest.fn();
    render(<ToastRegion />);

    act(() => {
      Toast.success("Nightly Backup deleted", {
        action: { title: "Undo", onClick: onUndo },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("Nightly Backup deleted"),
    ).not.toBeInTheDocument();
  });

  test("the same words again start its time again", () => {
    render(<ToastRegion />);

    act(() => {
      Toast.success("Changes saved");
    });
    act(() => {
      jest.advanceTimersByTime(SUCCESS_DURATION_IN_MS - 1000);
    });
    act(() => {
      Toast.success("Changes saved");
    });
    act(() => {
      jest.advanceTimersByTime(SUCCESS_DURATION_IN_MS - 1);
    });

    expect(screen.getAllByText("Changes saved")).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Changes saved")).not.toBeInTheDocument();
  });

  test("a toast shown before the region was drawn is drawn with it", () => {
    Toast.success("Monitor created");
    render(<ToastRegion />);

    expect(screen.getByText("Monitor created")).toBeInTheDocument();
  });

  test("it is laid out by the reading direction and keeps to a phone's width", () => {
    render(<ToastRegion />);

    const region: HTMLElement = screen.getByTestId("toast-region");

    // The end of the line, not the right: the left in Arabic and Persian.
    expect(region.className).toContain("sm:end-6");
    expect(region.className).not.toMatch(/\b(right|left)-/);
    // A phone's width less its margins, above its home bar.
    expect(region.className).toContain("inset-x-4");
    expect(region.className).toContain("env(safe-area-inset-bottom)");
    // Over a dialog (z-50).
    expect(region.className).toContain("z-[60]");
  });

  test("it comes in only for a reader who has not asked for less motion", () => {
    render(<ToastRegion />);

    act(() => {
      Toast.success("Changes saved");
    });

    // Theme.css plays ou-animate-pop-in under prefers-reduced-motion: no-preference only.
    expect(screen.getByTestId("toast").className).toContain(
      "ou-animate-pop-in",
    );
    expect(screen.getByTestId("toast").className).not.toMatch(
      /(^|\s)(animate-|transition-all)/,
    );
  });
});
