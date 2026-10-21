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
import CodeBlock from "../../../UI/Components/CodeBlock/CodeBlock";

/*
 * A CodeBlock's copy button - the install commands, the setup snippets, the
 * embed codes. It called navigator.clipboard.writeText directly: on a page
 * served over plain http, where the browser has no clipboard API, the click
 * threw ("Cannot read properties of undefined"), and a refused write said
 * "Copied!" all the same (issue #5132). It copies through the shared helper
 * now, says Copied! only once the code is on the clipboard, and otherwise
 * says Copy failed and selects the code, to copy by hand.
 */

const COMMAND: string =
  "curl -sSL https://oneuptime.example.com/install.sh | sh";

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
  return screen.getByTestId("code-block-copy-button");
}

async function pressCopy(): Promise<void> {
  await act(async () => {
    fireEvent.click(copyButton());
  });
}

function statusRegion(): HTMLElement {
  return screen.getByRole("status");
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

describe("CodeBlock's copy button", () => {
  test("idle: named Copy to clipboard, nothing said yet", () => {
    render(<CodeBlock code={COMMAND} language="bash" />);

    expect(copyButton()).toHaveAttribute("aria-label", "Copy to clipboard");
    expect(copyButton()).toHaveAttribute("data-copy-state", "idle");
    expect(statusRegion()).toBeEmptyDOMElement();
  });

  test("copies the code, and only then says Copied!", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);

    render(<CodeBlock code={COMMAND} language="bash" />);
    await pressCopy();

    expect(writeText).toHaveBeenCalledWith(COMMAND);
    expect(copyButton()).toHaveAttribute("aria-label", "Copied!");
    expect(statusRegion()).toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(copyButton()).toHaveAttribute("aria-label", "Copy to clipboard");
  });

  test("the bug: on a page with no clipboard API the click no longer throws", async () => {
    installClipboard(undefined);

    const errors: Array<unknown> = [];
    const onError: (event: ErrorEvent) => void = (event: ErrorEvent): void => {
      errors.push(event.error);
    };
    window.addEventListener("error", onError);

    render(<CodeBlock code={COMMAND} language="bash" />);
    await pressCopy();

    window.removeEventListener("error", onError);

    expect(errors).toEqual([]);
    expect(copyButton()).not.toHaveAttribute("aria-label", "Copied!");
  });

  test("on a plain-http page it copies through the browser's copy command", async () => {
    installClipboard(undefined);
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
      return true;
    });
    installExecCommand(execCommand);

    render(<CodeBlock code={COMMAND} language="bash" />);
    await pressCopy();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copyButton()).toHaveAttribute("aria-label", "Copied!");
  });

  test("a refused write never says Copied!: Copy failed, and the code is selected to copy by hand", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    installExecCommand((): boolean => {
      return false;
    });

    render(<CodeBlock code={COMMAND} language="bash" />);
    await pressCopy();

    expect(copyButton()).toHaveAttribute("aria-label", "Copy failed");
    expect(copyButton()).toHaveAttribute("title", "Copy failed");
    expect(copyButton()).toHaveAttribute("data-copy-state", "failed");
    expect(statusRegion()).toHaveTextContent("Copy failed");
    expect(window.getSelection()?.toString()).toBe(COMMAND);
  });

  test("a failure in a language it does not highlight selects the code too", async () => {
    installClipboard(undefined);

    render(<CodeBlock code="3a000000-0000-4000-8000-0000000000a1" language="not-a-language" />);
    await pressCopy();

    expect(window.getSelection()?.toString()).toBe(
      "3a000000-0000-4000-8000-0000000000a1",
    );
  });

  test("Copy failed goes back to Copy to clipboard after four seconds", async () => {
    installClipboard(undefined);

    render(<CodeBlock code={COMMAND} language="bash" />);
    await pressCopy();

    await act(async () => {
      jest.advanceTimersByTime(3999);
    });
    expect(copyButton()).toHaveAttribute("aria-label", "Copy failed");

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(copyButton()).toHaveAttribute("aria-label", "Copy to clipboard");
  });

  test("a block without a copy button has no status region either", () => {
    render(
      <CodeBlock code={COMMAND} language="bash" showCopyButton={false} />,
    );

    expect(screen.queryByTestId("code-block-copy-button")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
