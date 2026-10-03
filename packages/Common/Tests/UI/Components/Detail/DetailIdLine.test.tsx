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
  RenderResult,
  screen,
} from "@testing-library/react";
import React from "react";
import DetailIdLine from "../../../../UI/Components/Detail/DetailIdLine";
import {
  RECORD_ID_COPIED_FEEDBACK_MS,
  SHORT_RECORD_ID_LENGTH,
  SHORT_RECORD_ID_WIDTH,
} from "../../../../UI/Components/Detail/DetailRecordId";

/*
 * The small line a details card ends with, in place of the full-width ID
 * field it used to lead with: "ID", the start of the ID, a copy button.
 * What a person sees and can do with it, against a fake clipboard.
 */

const RECORD_ID: string = "3f2a8b1c-9d4e-4b7a-a1c2-7e5f6d8c9b0a";
const OTHER_RECORD_ID: string = "9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

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

function workingClipboard(): WriteTextMock {
  const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
    async (): Promise<void> => {},
  );
  installClipboard(writeText);
  return writeText;
}

function refusingClipboard(): WriteTextMock {
  const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
    async (): Promise<void> => {
      throw new DOMException("Clipboard denied", "NotAllowedError");
    },
  );
  installClipboard(writeText);
  return writeText;
}

function line(): HTMLElement {
  return screen.getByTestId("detail-id-line");
}

function value(): HTMLElement {
  return screen.getByTestId("detail-id-value");
}

// The ID and its ellipsis: what is hovered and clicked.
function valueWrapper(): HTMLElement {
  return screen.getByTestId("detail-id-value-wrapper");
}

function ellipsis(): HTMLElement | null {
  return screen.queryByTestId("detail-id-ellipsis");
}

function copyButton(): HTMLElement {
  return screen.getByRole("button", { name: "Copy ID to clipboard" });
}

function status(): HTMLElement {
  return screen.getByRole("status");
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function hover(element: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(element);
  await act(async () => {
    jest.advanceTimersByTime(250);
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

describe("DetailIdLine at rest", () => {
  test("reads ID, the record's ID and a copy button, on one small line", () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    expect(line()).toHaveClass("flex", "items-center", "text-xs");
    expect(screen.getByTestId("detail-id-label")).toHaveTextContent(/^ID$/);
    expect(value().tagName).toBe("CODE");
    expect(copyButton()).toHaveAttribute("type", "button");
    // No form label: the line is not a field of the card.
    expect(line().querySelector("label")).toBeNull();
  });

  test("wears the ID card icon that Show ID wears in every menu", () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    const label: HTMLElement = screen.getByTestId("detail-id-label")
      .parentElement as HTMLElement;

    expect(label.querySelector("svg")).not.toBeNull();
    expect(label.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("holds the whole ID as text, clipped to its first group", () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    // All of it is there for a copy, a select-all, find-in-page and a screen reader.
    expect(value()).toHaveTextContent(RECORD_ID, {
      normalizeWhitespace: false,
    });
    expect(value().textContent).toBe(RECORD_ID);
    expect(value()).toHaveClass(
      "overflow-hidden",
      "whitespace-nowrap",
      "font-mono",
      "select-all",
    );
    expect(value().style.maxWidth).toBe(SHORT_RECORD_ID_WIDTH);
  });

  test("ends the clipped ID with an ellipsis a screen reader skips", () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    expect(ellipsis()).toHaveTextContent("…");
    expect(ellipsis()).toHaveAttribute("aria-hidden", "true");
    // Its own font: the Dashboard sets Inter on every element.
    expect(ellipsis()).toHaveClass("font-mono");
    expect(valueWrapper().lastElementChild).toBe(ellipsis());
    expect(value().textContent).not.toContain("…");
  });

  test("an ID no longer than the clip is shown whole, with no ellipsis", () => {
    workingClipboard();
    const shortId: string = "a1b2c3d4".slice(0, SHORT_RECORD_ID_LENGTH);
    render(<DetailIdLine recordId={shortId} />);

    expect(value().textContent).toBe(shortId);
    expect(ellipsis()).toBeNull();
  });

  test("shows the whole ID when the ID is hovered", async () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    await hover(valueWrapper());

    expect(await screen.findByRole("tooltip")).toHaveTextContent(RECORD_ID);
  });

  test("names the copy button for what it does, and describes it once", async () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    await hover(copyButton());

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Copy ID to clipboard",
    );
    // The name already says it: no describedby reading it a second time.
    expect(copyButton()).not.toHaveAttribute("aria-describedby");
  });

  test("says nothing until something happens", () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    expect(status()).toHaveTextContent("");
    expect(status()).toHaveClass("sr-only");
  });

  test("adds the spacing its card asks for", () => {
    workingClipboard();
    render(
      <DetailIdLine
        recordId={RECORD_ID}
        className="mt-3 border-t border-gray-100 pt-3"
      />,
    );

    expect(line()).toHaveClass("mt-3", "border-t", "border-gray-100", "pt-3");
  });
});

describe("DetailIdLine copying", () => {
  test("the copy button puts the whole ID on the clipboard", async () => {
    const writeText: WriteTextMock = workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    await click(copyButton());

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
  });

  test("clicking the ID copies it too, as clicking the old ID pill did", async () => {
    const writeText: WriteTextMock = workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    await click(value());

    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
    expect(status()).toHaveTextContent("Copied to clipboard");
  });

  test("ticks the button and tells a screen reader, then goes back", async () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    await click(copyButton());

    expect(copyButton().querySelector(".text-emerald-600")).not.toBeNull();
    expect(status()).toHaveTextContent("Copied to clipboard");
    expect(status()).toHaveClass("sr-only");

    // Hovering takes 250ms of the two seconds.
    await hover(copyButton());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(RECORD_ID_COPIED_FEEDBACK_MS - 300);
    });
    expect(status()).toHaveTextContent("Copied to clipboard");

    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(status()).toHaveTextContent("");
    expect(copyButton().querySelector(".text-emerald-600")).toBeNull();
  });

  test("a second copy starts the two seconds again", async () => {
    workingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    await click(copyButton());
    await act(async () => {
      jest.advanceTimersByTime(RECORD_ID_COPIED_FEEDBACK_MS - 500);
    });
    await click(copyButton());
    await act(async () => {
      jest.advanceTimersByTime(RECORD_ID_COPIED_FEEDBACK_MS - 500);
    });

    expect(status()).toHaveTextContent("Copied to clipboard");

    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(status()).toHaveTextContent("");
  });

  test("falls back to the legacy copy where the clipboard API is missing", async () => {
    installClipboard(undefined);
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
      return true;
    });
    installExecCommand(execCommand);
    render(<DetailIdLine recordId={RECORD_ID} />);

    await click(copyButton());

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(status()).toHaveTextContent("Copied to clipboard");
  });
});

describe("DetailIdLine when the browser refuses the copy", () => {
  test("says so instead of ticking, and shows the whole ID to copy by hand", async () => {
    refusingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    await click(copyButton());

    expect(status()).toHaveTextContent("Copy failed");
    // Shown, not only announced: the tick it replaces was the only signal.
    expect(status()).not.toHaveClass("sr-only");
    expect(status()).toHaveClass("text-red-600");
    expect(copyButton().querySelector(".text-emerald-600")).toBeNull();

    // Unclipped, wrapping, and still one click from selected.
    expect(value().style.maxWidth).toBe("");
    expect(value()).not.toHaveClass("overflow-hidden");
    expect(value()).toHaveClass("break-all", "select-all");
    expect(value().textContent).toBe(RECORD_ID);
    expect(ellipsis()).toBeNull();
  });

  test("stays readable until the next try, which can succeed", async () => {
    const writeText: WriteTextMock = refusingClipboard();
    render(<DetailIdLine recordId={RECORD_ID} />);

    await click(copyButton());
    await act(async () => {
      jest.advanceTimersByTime(RECORD_ID_COPIED_FEEDBACK_MS * 3);
    });
    expect(status()).toHaveTextContent("Copy failed");

    writeText.mockImplementation(async (): Promise<void> => {});
    await click(copyButton());

    expect(status()).toHaveTextContent("Copied to clipboard");
    expect(value().style.maxWidth).toBe(SHORT_RECORD_ID_WIDTH);
  });

  test("with no clipboard at all, says the copy failed", async () => {
    installClipboard(undefined);
    render(<DetailIdLine recordId={RECORD_ID} />);

    await click(value());

    expect(status()).toHaveTextContent("Copy failed");
  });
});

describe("DetailIdLine over time", () => {
  test("a different record in the same place starts afresh", async () => {
    refusingClipboard();
    const view: RenderResult = render(<DetailIdLine recordId={RECORD_ID} />);

    await click(copyButton());
    expect(status()).toHaveTextContent("Copy failed");

    view.rerender(<DetailIdLine recordId={OTHER_RECORD_ID} />);

    expect(status()).toHaveTextContent("");
    expect(value().textContent).toBe(OTHER_RECORD_ID);
    expect(value().style.maxWidth).toBe(SHORT_RECORD_ID_WIDTH);
  });

  test("a copy of the last record that lands after the switch says nothing about the new one", async () => {
    let finishCopy: () => void = (): void => {};
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      (): Promise<void> => {
        return new Promise<void>((resolve: () => void) => {
          finishCopy = resolve;
        });
      },
    );
    installClipboard(writeText);
    const view: RenderResult = render(<DetailIdLine recordId={RECORD_ID} />);

    fireEvent.click(copyButton());
    view.rerender(<DetailIdLine recordId={OTHER_RECORD_ID} />);

    await act(async () => {
      finishCopy();
    });

    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
    expect(status()).toHaveTextContent("");
  });

  test("leaving the page mid-copy or mid-tick is quiet", async () => {
    const errors: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});

    try {
      workingClipboard();
      const view: RenderResult = render(<DetailIdLine recordId={RECORD_ID} />);

      await click(copyButton());
      view.unmount();

      await act(async () => {
        jest.advanceTimersByTime(RECORD_ID_COPIED_FEEDBACK_MS * 2);
      });

      let finishCopy: () => void = (): void => {};
      installClipboard(
        jest.fn<(text: string) => Promise<void>>((): Promise<void> => {
          return new Promise<void>((resolve: () => void) => {
            finishCopy = resolve;
          });
        }),
      );
      const second: RenderResult = render(
        <DetailIdLine recordId={RECORD_ID} />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Copy ID to clipboard" }),
      );
      second.unmount();

      await act(async () => {
        finishCopy();
      });

      expect(errors).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      errors.mockRestore();
    }
  });
});
