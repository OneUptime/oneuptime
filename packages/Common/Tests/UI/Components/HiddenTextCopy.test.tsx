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
import HiddenText from "../../../UI/Components/HiddenText/HiddenText";

/*
 * A secret behind "Click to reveal" (an API key, an ingestion key, a SCIM
 * client secret), with a copy button once it is shown. The button used to
 * await navigator.clipboard?.writeText and then turn green - over an empty
 * clipboard on a page served over plain http, where the browser has no
 * clipboard API (issue #5132). It turns green only once the secret is on
 * the clipboard now; otherwise it says Copy failed and selects the secret,
 * to copy by hand.
 */

const SECRET: string = "sk_live_7f3e9c2a1b";

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

function reveal(): void {
  render(<HiddenText text={SECRET} isCopyable={true} />);
  fireEvent.click(screen.getByRole("hidden-text"));
}

function copyButton(): HTMLElement {
  return screen.getByTestId("copy-to-clipboard-icon");
}

async function pressCopy(): Promise<void> {
  await act(async () => {
    fireEvent.click(copyButton());
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  installExecCommand(undefined);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.getSelection()?.removeAllRanges();
  installClipboard(undefined);

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("HiddenText's copy button", () => {
  test("is a real button, reachable from the keyboard, named Copy", () => {
    reveal();

    expect(copyButton().tagName).toBe("BUTTON");
    expect(copyButton()).toHaveAttribute("type", "button");
    expect(copyButton()).toHaveAttribute("aria-label", "Copy");
  });

  test("copies the secret and only then turns green, saying Copied!", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    reveal();

    await pressCopy();

    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(copyButton()).toHaveAttribute("aria-label", "Copied!");
    expect(copyButton()).toHaveAttribute("data-copy-state", "copied");
    expect(screen.getByRole("revealed-text")).toHaveClass("text-green-700");
    expect(screen.getByTestId("hidden-text-copy-status")).toHaveTextContent(
      "Copied!",
    );

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(copyButton()).toHaveAttribute("aria-label", "Copy");
    expect(screen.getByRole("revealed-text")).not.toHaveClass("text-green-700");
  });

  test("the bug: with no clipboard API and no copy command it never turns green", async () => {
    installClipboard(undefined);
    reveal();

    await pressCopy();

    expect(screen.getByRole("revealed-text")).not.toHaveClass("text-green-700");
    expect(copyButton()).not.toHaveAttribute("aria-label", "Copied!");
  });

  test("a refused copy says Copy failed and selects the secret, to copy by hand", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    installExecCommand((): boolean => {
      return false;
    });
    reveal();

    await pressCopy();

    expect(copyButton()).toHaveAttribute("aria-label", "Copy failed");
    expect(copyButton()).toHaveAttribute("data-copy-state", "failed");
    expect(copyButton()).toHaveClass("text-red-600");
    expect(screen.getByTestId("hidden-text-copy-status")).toHaveTextContent(
      "Copy failed",
    );
    expect(window.getSelection()?.toString()).toBe(SECRET);
  });

  test("on a plain-http page it copies through the browser's copy command", async () => {
    installClipboard(undefined);
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
      return true;
    });
    installExecCommand(execCommand);
    reveal();

    await pressCopy();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copyButton()).toHaveAttribute("aria-label", "Copied!");
  });

  test("the status region is there before anything is said in it", () => {
    reveal();

    const status: HTMLElement = screen.getByTestId("hidden-text-copy-status");

    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveClass("sr-only");
    expect(status).toBeEmptyDOMElement();
  });
});
