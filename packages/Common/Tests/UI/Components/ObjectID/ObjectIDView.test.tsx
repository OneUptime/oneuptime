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
  createEvent,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React from "react";
import ObjectIDView from "../../../../UI/Components/ObjectID/ObjectIDView";

/*
 * The ID pill: an ID drawn as a field, copied on a click. Details cards put a
 * record's own ID on their ID line now; the pill is for the IDs that stay
 * fields (the project ID on Project Settings, a probe's and a runner's ID
 * beside their key, an API key's project ID).
 */

const PROJECT_ID: string = "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

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

function pill(): HTMLElement {
  return screen.getByRole("button", { name: PROJECT_ID });
}

// The bordered box inside the button, which turns green on a copy.
function box(): HTMLElement {
  return screen.getByText(PROJECT_ID).parentElement as HTMLElement;
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(document, "execCommand", {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  }
});

describe("ObjectIDView", () => {
  test("shows the whole ID and copies it on a click", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    render(<ObjectIDView objectId={PROJECT_ID} />);

    expect(screen.getByText(PROJECT_ID).tagName).toBe("CODE");

    await act(async () => {
      fireEvent.click(pill());
    });

    expect(writeText).toHaveBeenCalledWith(PROJECT_ID);
    expect(box()).toHaveClass("bg-green-50");

    await act(async () => {
      jest.advanceTimersByTime(2010);
    });

    expect(box()).not.toHaveClass("bg-green-50");
    expect(box()).toHaveClass("bg-gray-50");
  });

  test("does not turn green when the browser refuses the copy", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    render(<ObjectIDView objectId={PROJECT_ID} />);

    await act(async () => {
      fireEvent.click(pill());
    });

    expect(box()).not.toHaveClass("bg-green-50");
  });

  test("does not turn green when there is no clipboard at all", async () => {
    installClipboard(undefined);
    render(<ObjectIDView objectId={PROJECT_ID} />);

    await act(async () => {
      fireEvent.click(pill());
    });

    expect(box()).not.toHaveClass("bg-green-50");
  });

  test.each([["Enter"], [" "]])(
    "copies from the keyboard with %p, without scrolling the page",
    async (key: string) => {
      const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
        async (): Promise<void> => {},
      );
      installClipboard(writeText);
      render(<ObjectIDView objectId={PROJECT_ID} />);

      const event: Event = createEvent.keyDown(pill(), { key });

      await act(async () => {
        fireEvent(pill(), event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(writeText).toHaveBeenCalledWith(PROJECT_ID);
    },
  );

  test("other keys do nothing", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    render(<ObjectIDView objectId={PROJECT_ID} />);

    await act(async () => {
      fireEvent.keyDown(pill(), { key: "a" });
    });

    expect(writeText).not.toHaveBeenCalled();
  });

  test("leaving the page before the clipboard answers starts no timer", async () => {
    let finishCopy: () => void = (): void => {};
    installClipboard(
      jest.fn<(text: string) => Promise<void>>((): Promise<void> => {
        return new Promise<void>((resolve: () => void) => {
          finishCopy = resolve;
        });
      }),
    );
    const view: RenderResult = render(<ObjectIDView objectId={PROJECT_ID} />);

    fireEvent.click(pill());
    view.unmount();

    await act(async () => {
      finishCopy();
    });

    expect(jest.getTimerCount()).toBe(0);
  });

  test("leaving the page while it is green leaves no timer behind", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {}),
    );
    const view: RenderResult = render(<ObjectIDView objectId={PROJECT_ID} />);

    await act(async () => {
      fireEvent.click(pill());
    });

    view.unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
});
