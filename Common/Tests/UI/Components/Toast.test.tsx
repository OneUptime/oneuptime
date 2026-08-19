import Toast, { ToastType } from "../../../UI/Components/Toast/Toast";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The toast mounts closed (faded, nudged down) and opens on the next
 * animation frame, so anything asserting the settled look has to let that
 * frame run first — the same choreography Modal.test.tsx flushes.
 */
type FlushEntranceFrameFunction = () => Promise<void>;

const flushEntranceFrame: FlushEntranceFrameFunction =
  async (): Promise<void> => {
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  };

describe("Test for Toast.tsx", () => {
  test("should render the toast card", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );

    /*
     * The card itself, not a fixed strip: positioning now belongs to the ONE
     * region container ToastInit renders (see ToastStacking.test.tsx), so
     * stacked toasts no longer paint on top of each other at top-0.
     */
    const toast: HTMLElement = screen.getByTestId("toast");

    expect(toast).toHaveClass(
      "pointer-events-auto",
      "w-full",
      "max-w-sm",
      "rounded-lg",
      "bg-white",
      "shadow-lg",
    );
    expect(toast).not.toHaveClass("fixed");
  });

  test("enters by fading and lifting in from a closed state", async () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );

    const toast: HTMLElement = screen.getByTestId("toast");

    expect(toast).toHaveClass("opacity-0", "translate-y-2");

    await flushEntranceFrame();

    expect(toast).toHaveClass("opacity-100");
    /*
     * A settled toast carries no transform class — a lingering translate
     * would make the card the containing block for position:fixed
     * descendants.
     */
    expect(toast.className).not.toMatch(/(^|\s)(scale|translate)-/);
  });

  test("should have close button", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("close-button")).toBeInTheDocument();
  });

  test("Checking Title", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("Spread");
  });

  test("Checking Description", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("description")).toHaveTextContent("Love");
  });

  test("Checking if Toast is for SUCCESS", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("toast-icon")).toHaveClass("text-green-400");
  });
  test("Checking if Toast is for INFO", () => {
    render(<Toast type={ToastType.INFO} title="Spread" description="Love" />);
    expect(screen.getByTestId("toast-icon")).toHaveClass("text-blue-400");
  });

  test("Checking if Toast is for Warning", () => {
    render(
      <Toast type={ToastType.WARNING} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("toast-icon")).toHaveClass("text-yellow-400");
  });

  test("Checking if Toast is for Normal", () => {
    render(<Toast type={ToastType.NORMAL} title="Spread" description="Love" />);
    expect(screen.getByTestId("toast-icon")).toHaveClass("text-gray-400");
  });

  test("clicking close fades the toast out and only then unmounts it", async () => {
    const user: UserEvent = userEvent.setup();

    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );

    await flushEntranceFrame();

    const closeButton: HTMLButtonElement = screen.getByTestId("close-button");
    await user.click(closeButton);

    /*
     * The exit runs as a fade with a delayed unmount, so immediately after
     * the click the card is still mounted, at zero opacity.
     */
    expect(screen.getByTestId("toast")).toHaveClass("opacity-0");

    await waitFor(() => {
      expect(screen.queryByTestId("toast")).toBeFalsy();
    });
  });

  /*
   * Owners (ToastInit) may hand the toast a NEW onClose identity on any
   * re-render. The exit timer must not restart because of that — it keys off
   * isLeaving alone and reads the latest onClose through a ref — otherwise a
   * re-render mid-fade would leave an invisible pointer-events-auto card
   * intercepting clicks past the original deadline.
   */
  test("a re-render with a new onClose mid-exit neither restarts the timer nor calls a stale handler", () => {
    jest.useFakeTimers();

    try {
      const staleOnClose: () => void = jest.fn();
      const latestOnClose: () => void = jest.fn();

      const { rerender } = render(
        <Toast
          type={ToastType.SUCCESS}
          title="Spread"
          description="Love"
          onClose={staleOnClose}
        />,
      );

      fireEvent.click(screen.getByTestId("close-button"));

      // 100ms into the 150ms exit fade the owner re-renders the toast…
      act(() => {
        jest.advanceTimersByTime(100);
      });
      rerender(
        <Toast
          type={ToastType.SUCCESS}
          title="Spread"
          description="Love"
          onClose={latestOnClose}
        />,
      );

      // …the card is still mid-fade…
      expect(screen.getByTestId("toast")).toHaveClass("opacity-0");

      // …and the ORIGINAL 150ms deadline still unmounts it 50ms later.
      act(() => {
        jest.advanceTimersByTime(50);
      });

      expect(screen.queryByTestId("toast")).toBeFalsy();
      expect(latestOnClose).toHaveBeenCalledTimes(1);
      expect(staleOnClose).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
