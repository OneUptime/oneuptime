import ToastLayout, {
  ShowToastNotification,
} from "../../../UI/Components/Toast/ToastInit";
import { ToastType } from "../../../UI/Components/Toast/Toast";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ToastInit used to render every toast as its own fixed strip at top-0 (the
 * index prop that was supposed to offset them was never passed), so stacked
 * toasts painted on top of each other and only the last one was readable.
 * The contract pinned here: ONE fixed region, cards stacked in a flex column
 * in insertion order.
 */

type ShowToastFunction = (title: string, onClose?: () => void) => void;

const showToast: ShowToastFunction = (
  title: string,
  onClose?: () => void,
): void => {
  act(() => {
    ShowToastNotification({
      title,
      description: `${title} description`,
      type: ToastType.SUCCESS,
      onClose,
    });
  });
};

describe("Toast stacking", () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("renders one fixed region that keeps its slot in the z-index ladder", () => {
    render(<ToastLayout />);

    const region: HTMLElement = screen.getByTestId("toast-region");

    /*
     * z-40 is deliberate: above SideOver (z-30), below Modal (z-50). The
     * region itself takes no pointer events; only the cards inside do.
     */
    expect(region).toHaveClass(
      "pointer-events-none",
      "fixed",
      "z-40",
      "top-0",
      "left-0",
      "right-0",
    );
    expect(region).toHaveClass("sm:items-start", "sm:p-6");
    expect(region).toHaveAttribute("aria-live", "assertive");
  });

  test("stacks multiple toasts in one region, in insertion order", () => {
    render(<ToastLayout />);

    showToast("First");
    showToast("Second");
    showToast("Third");

    const toasts: Array<HTMLElement> = screen.getAllByTestId("toast");

    expect(toasts).toHaveLength(3);

    // All three cards live inside the ONE region, not three fixed strips.
    const region: HTMLElement = screen.getByTestId("toast-region");

    for (const toast of toasts) {
      expect(region).toContainElement(toast);
      expect(toast).not.toHaveClass("fixed");
    }

    // The stack is a flex column with a gap, so cards never overlap.
    const stack: HTMLElement = toasts[0]?.parentElement as HTMLElement;

    expect(stack).toHaveClass("flex", "flex-col", "gap-4");
    expect(toasts[1]?.parentElement).toBe(stack);
    expect(toasts[2]?.parentElement).toBe(stack);

    const titles: Array<string | null> = screen
      .getAllByTestId("title")
      .map((title: HTMLElement) => {
        return title.textContent;
      });

    expect(titles).toEqual(["First", "Second", "Third"]);
  });

  test("dismissing one toast removes only that toast and calls its onClose", async () => {
    const onCloseFirst: () => void = jest.fn();

    render(<ToastLayout />);

    showToast("First", onCloseFirst);
    showToast("Second");

    const closeButtons: Array<HTMLElement> =
      screen.getAllByTestId("close-button");

    expect(closeButtons).toHaveLength(2);

    fireEvent.click(closeButtons[0] as HTMLElement);

    /*
     * The exit fade delays the unmount, so removal is awaited rather than
     * asserted synchronously.
     */
    await waitFor(() => {
      expect(screen.getAllByTestId("toast")).toHaveLength(1);
    });

    expect(onCloseFirst).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("title")).toHaveTextContent("Second");
  });

  test("a toast dispatched after a dismissal still stacks below the survivors", async () => {
    render(<ToastLayout />);

    showToast("First");
    showToast("Second");

    fireEvent.click(screen.getAllByTestId("close-button")[0] as HTMLElement);

    await waitFor(() => {
      expect(screen.getAllByTestId("toast")).toHaveLength(1);
    });

    showToast("Third");

    const titles: Array<string | null> = screen
      .getAllByTestId("title")
      .map((title: HTMLElement) => {
        return title.textContent;
      });

    expect(titles).toEqual(["Second", "Third"]);
  });
});
