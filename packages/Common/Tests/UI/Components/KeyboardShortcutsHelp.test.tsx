import KeyboardShortcutsHelp, {
  KEYBOARD_SHORTCUTS_HELP_TEST_ID,
} from "../../../UI/Components/LogsViewer/components/KeyboardShortcutsHelp";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React, { ReactElement, RefObject, useRef } from "react";

/*
 * The logs toolbar's keyboard shortcuts (#9859): drawn over the page from
 * the toolbar's "?" (LayeredPopover), not inside the toolbar, where a list
 * with no filter bar puts it in the list's card, which cut off everything
 * past the card's foot. Its X says what it does, and Escape, the X and a
 * press outside each close it.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

function Toolbar(props: { onClose: () => void }): ReactElement {
  const buttonRef: RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  return (
    <div data-testid="list-card" style={{ overflow: "hidden", height: 80 }}>
      <button ref={buttonRef} type="button">
        ?
      </button>
      <KeyboardShortcutsHelp anchorRef={buttonRef} onClose={props.onClose} />
      <p>No logs yet.</p>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("the logs toolbar's keyboard shortcuts", () => {
  test("are drawn over the page, outside the list's card", () => {
    render(<Toolbar onClose={getJestMockFunction() as () => void} />);

    const help: HTMLElement = screen.getByTestId(
      KEYBOARD_SHORTCUTS_HELP_TEST_ID,
    );

    expect(screen.getByTestId("list-card")).not.toContainElement(help);
    expect(help.closest("[data-tippy-root]")?.parentElement).toBe(
      document.body,
    );
    // No wider than a phone's screen less its sides.
    expect(help).toHaveClass("w-72", "max-w-[calc(100vw-1rem)]");
  });

  test("its X is named, and closes them", () => {
    const onClose: MockFunction = getJestMockFunction();
    render(<Toolbar onClose={onClose as () => void} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape closes them, and hands the focus back to the ?", () => {
    const onClose: MockFunction = getJestMockFunction();
    render(<Toolbar onClose={onClose as () => void} />);

    act(() => {
      screen.getByRole("button", { name: "Close" }).focus();
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), {
      key: "Escape",
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "?" })).toHaveFocus();
  });

  test("a press outside closes them, once", () => {
    const onClose: MockFunction = getJestMockFunction();
    render(<Toolbar onClose={onClose as () => void} />);

    fireEvent.mouseDown(screen.getByText("No logs yet."));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
