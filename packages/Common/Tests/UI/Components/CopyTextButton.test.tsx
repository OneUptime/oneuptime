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
import CopyTextButton from "../../../UI/Components/CopyTextButton/CopyTextButton";

/*
 * Clipboard.copyToClipboard used to reject when the browser refused the write,
 * which is what kept this button from saying "Copied!" after a failed copy. It
 * now resolves `false` instead, so the button has to read the result: a green
 * tick over text that never reached the clipboard is worse than no feedback,
 * because the user pastes nothing and does not know why.
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

async function clickCopy(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  installExecCommand(undefined);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("CopyTextButton", () => {
  test("says Copied! for a moment once the text is on the clipboard", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    expect(writeText).toHaveBeenCalledWith("trace-4bf92f35");
    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent(
      "Copied!",
    );

    await act(async () => {
      jest.advanceTimersByTime(1010);
    });

    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent(
      "Copy",
    );
  });

  test("does not say Copied! when the browser refuses the write", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      },
    );
    installClipboard(writeText);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    expect(writeText).toHaveBeenCalledWith("trace-4bf92f35");
    expect(screen.getByRole("button", { name: "Copy" })).not.toHaveTextContent(
      "Copied!",
    );
  });

  test("does not say Copied! when there is no clipboard at all", async () => {
    installClipboard(undefined);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    expect(screen.getByRole("button", { name: "Copy" })).not.toHaveTextContent(
      "Copied!",
    );
  });

  test("still says Copied! when the legacy copy command succeeds", async () => {
    installClipboard(undefined);
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
      return true;
    });
    installExecCommand(execCommand);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent(
      "Copied!",
    );
  });

  /*
   * Issue #5132: a button that cannot copy says so. It used to say nothing,
   * which reads as a button that does nothing - or, worse, as a copy that
   * worked.
   */
  test("says Copy failed, in red, when the browser refuses both ways", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    installExecCommand((): boolean => {
      return false;
    });

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    const button: HTMLElement = screen.getByRole("button", { name: "Copy" });

    expect(button).toHaveTextContent("Copy failed");
    expect(button).toHaveAttribute("data-copy-state", "failed");
    expect(button).toHaveClass("text-red-600");
    expect(button).toHaveAttribute("title", "Copy failed");
  });

  test("says Copy failed when there is no clipboard API and no copy command", async () => {
    installClipboard(undefined);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent(
      "Copy failed",
    );
  });

  test("Copy failed stays long enough to read, then the button reads Copy again", async () => {
    installClipboard(undefined);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    await act(async () => {
      jest.advanceTimersByTime(3990);
    });

    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent(
      "Copy failed",
    );

    await act(async () => {
      jest.advanceTimersByTime(20);
    });

    const button: HTMLElement = screen.getByRole("button", { name: "Copy" });

    expect(button).not.toHaveTextContent("Copy failed");
    expect(button).toHaveTextContent("Copy");
    expect(button).toHaveAttribute("data-copy-state", "idle");
  });

  test("pressing it again after a failure tries again, and says Copied! when that works", async () => {
    installClipboard(undefined);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    await clickCopy();

    expect(writeText).toHaveBeenCalledWith("trace-4bf92f35");
    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent(
      "Copied!",
    );
  });

  test("never says Copied! before the clipboard has taken the text", async () => {
    let finishWrite: () => void = (): void => {};
    installClipboard(
      jest.fn<(text: string) => Promise<void>>((): Promise<void> => {
        return new Promise<void>((resolve: () => void) => {
          finishWrite = resolve;
        });
      }),
    );

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);
    await clickCopy();

    expect(screen.getByRole("button", { name: "Copy" })).not.toHaveTextContent(
      "Copied!",
    );

    await act(async () => {
      finishWrite();
    });

    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent(
      "Copied!",
    );
  });

  test("an icon-only button says what happened to a screen reader, without words on screen", async () => {
    installClipboard(undefined);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" iconOnly={true} />);

    const button: HTMLElement = screen.getByRole("button", { name: "Copy" });
    const said: HTMLElement = button.querySelector(
      "[aria-live='polite']",
    ) as HTMLElement;

    expect(said).toHaveClass("sr-only");
    expect(said).toBeEmptyDOMElement();

    await clickCopy();

    expect(said).toHaveTextContent("Copy failed");
    expect(button).toHaveAttribute("data-copy-state", "failed");
  });

  test("an icon-only button announces a copy that worked too", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {}),
    );

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" iconOnly={true} />);
    await clickCopy();

    expect(
      screen
        .getByRole("button", { name: "Copy" })
        .querySelector("[aria-live='polite']"),
    ).toHaveTextContent("Copied!");
  });

  test("the label is announced as it changes", async () => {
    installClipboard(undefined);

    render(<CopyTextButton textToBeCopied="trace-4bf92f35" />);

    const label: HTMLElement = screen.getByText("Copy");

    expect(label).toHaveAttribute("aria-live", "polite");

    await clickCopy();

    expect(label).toHaveTextContent("Copy failed");
  });
});

/*
 * The dashboard loads Tailwind's browser runtime, which styles only the
 * classes it knows. A width that is not on its spacing scale matches no rule,
 * and the icon is simply not drawn - which is what the md size did with
 * "w-4.5 h-4.5" (the scale has 3.5 and 4, then 5).
 */
const TAILWIND_SPACING_SCALE: Array<string> = [
  "0",
  "px",
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
];

type ButtonSize = "xs" | "sm" | "md";

const SIZE_CLASS: RegExp = /^[wh]-/;
const ARBITRARY_LENGTH: RegExp = /^\[[0-9.]+(rem|px)\]$/;

function iconSizeClasses(size: ButtonSize): Array<string> {
  render(<CopyTextButton textToBeCopied="trace-4bf92f35" size={size} />);

  const icon: SVGElement | null = screen
    .getByRole("button", { name: "Copy" })
    .querySelector("svg");

  expect(icon).not.toBeNull();

  return (icon!.getAttribute("class") || "")
    .split(/\s+/)
    .filter((className: string): boolean => {
      return SIZE_CLASS.test(className);
    });
}

describe("CopyTextButton icon sizes", () => {
  test.each(["xs", "sm", "md"] as Array<ButtonSize>)(
    "the %s icon has a width and a height Tailwind draws",
    (size: ButtonSize) => {
      const classes: Array<string> = iconSizeClasses(size);

      expect(
        classes.map((className: string): string => {
          return className.slice(0, 2);
        }),
      ).toEqual(["w-", "h-"]);

      for (const className of classes) {
        const value: string = className.slice(2);

        expect(
          ARBITRARY_LENGTH.test(value) ||
            TAILWIND_SPACING_SCALE.includes(value),
        ).toBe(true);
      }
    },
  );

  test("the md icon is 18px, between sm's 16px and the md text", () => {
    expect(iconSizeClasses("md")).toEqual(["w-[1.125rem]", "h-[1.125rem]"]);
  });
});
