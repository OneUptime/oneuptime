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
} from "@testing-library/react";
import React from "react";
import CopyableButton from "../../../UI/Components/CopyableButton/CopyableButton";

/*
 * The copy icon beside a details card's copyable value (and a JSON table's
 * cell, a workflow variable). It used to say "Copied to Clipboard" before
 * it even tried, then await navigator.clipboard?.writeText - which, on a
 * page served over plain http where the browser has no clipboard API,
 * copies nothing and says nothing (issue #5132). It says Copied only once
 * the text is on the clipboard now, and Copy failed when it is not.
 */

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

const originalExecCommand: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(document, "execCommand");

function installClipboard(writeText: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function installExecCommand(
  execCommand: ((command: string) => boolean) | undefined,
): void {
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
}

function copyButton(): HTMLElement {
  return screen.getByRole("button");
}

async function press(): Promise<void> {
  await act(async () => {
    fireEvent.click(copyButton());
  });
}

const VALUE: string = "https://api.example.com/hooks/42";

beforeEach(() => {
  jest.useFakeTimers();
  installExecCommand(undefined);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  installClipboard(undefined);

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("CopyableButton", () => {
  test("idle: a copy icon, named for what it does", () => {
    render(<CopyableButton textToBeCopied={VALUE} />);

    expect(copyButton()).toHaveAttribute("aria-label", "Copy to clipboard");
    expect(screen.getByTestId("copy-to-clipboard-icon")).toBeInTheDocument();
    expect(copyButton()).toHaveAttribute("data-copy-state", "idle");
  });

  test("copies the text and only then says Copied to Clipboard, for two seconds", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);

    render(<CopyableButton textToBeCopied={VALUE} />);
    await press();

    expect(writeText).toHaveBeenCalledWith(VALUE);
    expect(copyButton()).toHaveTextContent("Copied to Clipboard");
    expect(copyButton()).toHaveAttribute("aria-label", "Copied to clipboard");

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(copyButton()).not.toHaveTextContent("Copied to Clipboard");
    expect(screen.getByTestId("copy-to-clipboard-icon")).toBeInTheDocument();
  });

  test("the bug: never says Copied before the clipboard has taken the text", async () => {
    let finishWrite: () => void = (): void => {};
    installClipboard(
      jest.fn<(text: string) => Promise<void>>((): Promise<void> => {
        return new Promise<void>((resolve: () => void) => {
          finishWrite = resolve;
        });
      }),
    );

    render(<CopyableButton textToBeCopied={VALUE} />);
    await press();

    expect(copyButton()).not.toHaveTextContent("Copied");

    await act(async () => {
      finishWrite();
    });

    expect(copyButton()).toHaveTextContent("Copied to Clipboard");
  });

  test("on a plain-http page (no clipboard API) it copies through the browser's copy command", async () => {
    installClipboard(undefined);
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
      return true;
    });
    installExecCommand(execCommand);

    render(<CopyableButton textToBeCopied={VALUE} />);
    await press();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copyButton()).toHaveTextContent("Copied to Clipboard");
  });

  test("says Copy failed, in red, when the browser refuses both ways - never Copied", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    installExecCommand((): boolean => {
      return false;
    });

    render(<CopyableButton textToBeCopied={VALUE} />);
    await press();

    expect(copyButton()).not.toHaveTextContent("Copied");
    expect(screen.getByTestId("copy-to-clipboard-failed")).toHaveTextContent(
      "Copy failed",
    );
    expect(screen.getByTestId("copy-to-clipboard-failed")).toHaveClass(
      "text-red-600",
    );
    expect(copyButton()).toHaveAttribute("aria-label", "Copy failed");
    expect(copyButton()).toHaveAttribute("data-copy-state", "failed");
  });

  test("a failure can be tried again, and says Copied when that works", async () => {
    installClipboard(undefined);

    render(<CopyableButton textToBeCopied={VALUE} />);
    await press();

    expect(copyButton()).toHaveClass("cursor-pointer");

    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {}),
    );
    await press();

    expect(copyButton()).toHaveTextContent("Copied to Clipboard");
  });

  test.each([["Enter"], [" "]])(
    "copies from the keyboard with %p",
    async (key: string) => {
      const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
        async (): Promise<void> => {},
      );
      installClipboard(writeText);

      render(<CopyableButton textToBeCopied={VALUE} />);

      await act(async () => {
        fireEvent.keyDown(copyButton(), { key });
      });

      expect(writeText).toHaveBeenCalledWith(VALUE);
      expect(copyButton()).toHaveTextContent("Copied to Clipboard");
    },
  );

  test("what it says is announced: the button is a polite live region", () => {
    render(<CopyableButton textToBeCopied={VALUE} />);

    expect(copyButton()).toHaveAttribute("aria-live", "polite");
  });
});
