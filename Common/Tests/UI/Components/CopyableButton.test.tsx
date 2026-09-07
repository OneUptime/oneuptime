import CopyableButton from "../../../UI/Components/CopyableButton/CopyableButton";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../UI/Components/Tooltip/Tooltip", () => {
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactElement }) => {
      return children;
    },
  };
});

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

interface DeferredWrite {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

const deferredWrite: () => DeferredWrite = (): DeferredWrite => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise: Promise<void> = new Promise<void>(
    (onResolve: () => void, onReject: (error: Error) => void): void => {
      resolve = onResolve;
      reject = onReject;
    },
  );
  return { promise, resolve, reject };
};

describe("CopyableButton", () => {
  const writeText: ReturnType<typeof jest.fn<(text: string) => Promise<void>>> =
    jest.fn<(text: string) => Promise<void>>();
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  test("renders a named native button with an initially empty live region", () => {
    render(<CopyableButton textToBeCopied="monitor-id" />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Copy to clipboard",
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toBeDisabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  test("reports pending work and prevents overlapping writes", async () => {
    const write: DeferredWrite = deferredWrite();
    writeText.mockReturnValue(write.promise);
    render(<CopyableButton textToBeCopied={"exact\ntext"} />);

    const button: HTMLElement = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("exact\ntext");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Copying...");
    expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument();

    await act(async () => {
      write.resolve();
    });

    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
  });

  test("starts the success feedback timeout only after the clipboard write completes", async () => {
    const write: DeferredWrite = deferredWrite();
    writeText.mockReturnValue(write.promise);
    render(<CopyableButton textToBeCopied="monitor-id" />);
    fireEvent.click(screen.getByRole("button"));

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Copying...");

    await act(async () => {
      write.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(
      screen.getByRole("button", { name: "Copy to clipboard" }),
    ).toBeEnabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  test("announces rejection without exposing the error and allows a successful retry", async () => {
    writeText.mockRejectedValueOnce(new Error("Sensitive browser error"));
    render(<CopyableButton textToBeCopied="monitor-id" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Copy failed. Try again.",
    );
    expect(
      screen.queryByText("Sensitive browser error"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
  });

  test("handles a synchronous clipboard exception", async () => {
    writeText.mockImplementation(() => {
      throw new Error("Permission denied");
    });
    render(<CopyableButton textToBeCopied="monitor-id" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Copy failed. Try again.",
    );
    expect(screen.getByRole("button")).toBeEnabled();
  });

  test.each([undefined, {}])(
    "explains manual copying when the clipboard API is unavailable (%s)",
    async (clipboard: unknown) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: clipboard,
      });
      render(<CopyableButton textToBeCopied="monitor-id" />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button"));
      });

      expect(writeText).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Copy unavailable. Select and copy the text.",
      );
      expect(screen.getByRole("button")).toBeEnabled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  test.each(["{Enter}", " "])(
    "supports native %s activation without submitting a containing form",
    async (key: string) => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        advanceTimers: jest.advanceTimersByTime,
      });
      // user-event supplies its own clipboard; use the same controlled writer.
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      const onSubmit: ReturnType<typeof jest.fn<() => void>> =
        jest.fn<() => void>();
      render(
        <form onSubmit={onSubmit}>
          <CopyableButton textToBeCopied="monitor-id" />
        </form>,
      );

      await user.tab();
      expect(screen.getByRole("button")).toHaveFocus();
      await act(async () => {
        await user.keyboard(key);
      });

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Copied to clipboard",
      );
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  test("a new attempt cancels the previous success timer", async () => {
    const nextWrite: DeferredWrite = deferredWrite();
    writeText
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(nextWrite.promise);
    render(<CopyableButton textToBeCopied="monitor-id" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByRole("button"));
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Copying...");
    expect(screen.getByRole("button")).toBeDisabled();

    await act(async () => {
      nextWrite.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
  });

  test("changing the text clears feedback and its timer", async () => {
    const { rerender } = render(<CopyableButton textToBeCopied="old" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");

    rerender(<CopyableButton textToBeCopied="new" />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(jest.getTimerCount()).toBe(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(writeText).toHaveBeenLastCalledWith("new");
  });

  test.each(["resolve", "reject"])(
    "ignores a stale %s when the text changes during a write",
    async (outcome: string) => {
      const oldWrite: DeferredWrite = deferredWrite();
      const newWrite: DeferredWrite = deferredWrite();
      writeText
        .mockReturnValueOnce(oldWrite.promise)
        .mockReturnValueOnce(newWrite.promise);
      const { rerender } = render(<CopyableButton textToBeCopied="old" />);
      fireEvent.click(screen.getByRole("button"));

      rerender(<CopyableButton textToBeCopied="new" />);
      fireEvent.click(screen.getByRole("button"));

      await act(async () => {
        if (outcome === "resolve") {
          oldWrite.resolve();
        } else {
          oldWrite.reject(new Error("Old write failed"));
        }
      });

      expect(screen.getByRole("status")).toHaveTextContent("Copying...");
      expect(screen.getByRole("button")).toBeDisabled();
      expect(jest.getTimerCount()).toBe(0);

      await act(async () => {
        newWrite.resolve();
      });
      expect(screen.getByRole("status")).toHaveTextContent(
        "Copied to clipboard",
      );
    },
  );

  test("clears the feedback timer on unmount", async () => {
    const { unmount } = render(<CopyableButton textToBeCopied="monitor-id" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(jest.getTimerCount()).toBe(1);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });

  test.each(["resolve", "reject"])(
    "ignores a pending %s after unmount",
    async (outcome: string) => {
      const write: DeferredWrite = deferredWrite();
      writeText.mockReturnValue(write.promise);
      const { unmount } = render(
        <CopyableButton textToBeCopied="monitor-id" />,
      );
      fireEvent.click(screen.getByRole("button"));
      unmount();

      await act(async () => {
        if (outcome === "resolve") {
          write.resolve();
        } else {
          write.reject(new Error("Write failed"));
        }
      });

      expect(jest.getTimerCount()).toBe(0);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );
});
