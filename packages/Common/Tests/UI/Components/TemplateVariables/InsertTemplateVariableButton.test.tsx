import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import InsertTemplateVariableButton from "../../../../UI/Components/TemplateVariables/InsertTemplateVariableButton";
import TemplateVariablePopup, {
  TemplateVariablePopupCloseReason,
  TemplateVariablePopupMode,
} from "../../../../UI/Components/TemplateVariables/TemplateVariablePopup";
import {
  TemplateVariable,
  TemplateVariableGroups,
} from "../../../../Types/Template/TemplateVariable";
import { wasPressConsumedByAnAnchoredPopup } from "../../../../UI/Types/LayeredDismissal";

/*
 * "{ } Insert variable" in an editor's toolbar, and the popup its list opens
 * in. The popup is portalled out of the dialog the editor sits in, so it must
 * close itself - on Escape, Tab and a press elsewhere - without the dialog
 * closing too.
 */

const GROUPS: TemplateVariableGroups = [
  {
    title: "Incident",
    variables: [
      { name: "incident.title", description: "Title" },
      { name: "incident.startedAt", description: "Declared At" },
    ],
  },
];

afterEach(() => {
  cleanup();
});

function buttonOf(): HTMLElement {
  return screen.getByTestId("insert-template-variable-button");
}

function open(): void {
  fireEvent.mouseDown(buttonOf());
  fireEvent.click(buttonOf());
}

describe("the Insert variable button", () => {
  test("says what it does, and that it opens a list", () => {
    render(<InsertTemplateVariableButton groups={GROUPS} onPick={() => {}} />);

    const button: HTMLElement = buttonOf();

    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveTextContent("Insert variable");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("insert-template-variable-popup")).toBeNull();
  });

  test("opens the variables with a search box, outside the page's flow", () => {
    const { container } = render(
      <InsertTemplateVariableButton groups={GROUPS} onPick={() => {}} />,
    );

    open();

    const popup: HTMLElement = screen.getByTestId(
      "insert-template-variable-popup",
    );

    expect(buttonOf()).toHaveAttribute("aria-expanded", "true");
    expect(buttonOf()).toHaveAttribute("aria-controls", popup.id);
    expect(popup).toHaveAttribute("role", "dialog");
    expect(popup).toHaveAccessibleName("Insert variable");
    // Portalled to the body, so a scrolling dialog body cannot clip it.
    expect(container.contains(popup)).toBe(false);
    expect(within(popup).getByTestId("template-variable-search")).toHaveFocus();
    expect(within(popup).getAllByRole("option")).toHaveLength(2);
  });

  test("keeps the editor's focus while pressed, and remembers its cursor first", () => {
    const onPressStart: jest.Mock<() => void> = jest.fn<() => void>();

    render(
      <InsertTemplateVariableButton
        groups={GROUPS}
        onPick={() => {}}
        onPressStart={onPressStart}
      />,
    );

    const press: Event = createEvent.mouseDown(buttonOf());
    fireEvent(buttonOf(), press);

    expect(press.defaultPrevented).toBe(true);
    expect(onPressStart).toHaveBeenCalledTimes(1);
  });

  test("a keyboard press, which has no mousedown, remembers the cursor too", () => {
    const onPressStart: jest.Mock<() => void> = jest.fn<() => void>();

    render(
      <InsertTemplateVariableButton
        groups={GROUPS}
        onPick={() => {}}
        onPressStart={onPressStart}
      />,
    );

    fireEvent.click(buttonOf());

    expect(onPressStart).toHaveBeenCalledTimes(1);
  });

  test("picking puts the variable in and closes the list", () => {
    const onPick: jest.Mock<(variable: TemplateVariable) => void> =
      jest.fn<(variable: TemplateVariable) => void>();

    render(<InsertTemplateVariableButton groups={GROUPS} onPick={onPick} />);

    open();

    fireEvent.click(screen.getAllByRole("option")[1]!);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0].name).toBe("incident.startedAt");
    expect(screen.queryByTestId("insert-template-variable-popup")).toBeNull();
    expect(buttonOf()).toHaveAttribute("aria-expanded", "false");
  });

  test("Enter in the search box picks the first match", () => {
    const onPick: jest.Mock<(variable: TemplateVariable) => void> =
      jest.fn<(variable: TemplateVariable) => void>();

    render(<InsertTemplateVariableButton groups={GROUPS} onPick={onPick} />);

    open();

    const search: HTMLElement = screen.getByTestId("template-variable-search");

    fireEvent.change(search, { target: { value: "declared" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onPick.mock.calls[0]![0].name).toBe("incident.startedAt");
  });

  test("Escape closes the list - only the list - and goes back to the editor", () => {
    const onCloseFocus: jest.Mock<() => void> = jest.fn<() => void>();
    const dialogKeys: Array<string> = [];
    const dialogListener: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      // A dialog ignores a key someone already claimed, as Modal does.
      if (!event.defaultPrevented) {
        dialogKeys.push(event.key);
      }
    };

    document.addEventListener("keydown", dialogListener);

    try {
      render(
        <InsertTemplateVariableButton
          groups={GROUPS}
          onPick={() => {}}
          onCloseFocus={onCloseFocus}
        />,
      );

      open();

      fireEvent.keyDown(screen.getByTestId("template-variable-search"), {
        key: "Escape",
      });

      expect(screen.queryByTestId("insert-template-variable-popup")).toBeNull();
      expect(onCloseFocus).toHaveBeenCalledTimes(1);
      expect(dialogKeys).toEqual([]);
    } finally {
      document.removeEventListener("keydown", dialogListener);
    }
  });

  test("without an editor to go back to, Escape puts the focus on the button", () => {
    render(<InsertTemplateVariableButton groups={GROUPS} onPick={() => {}} />);

    open();

    fireEvent.keyDown(screen.getByTestId("template-variable-search"), {
      key: "Escape",
    });

    expect(buttonOf()).toHaveFocus();
  });

  test("Tab leaves the list for the editor, instead of the dialog's first field", () => {
    const onCloseFocus: jest.Mock<() => void> = jest.fn<() => void>();

    render(
      <InsertTemplateVariableButton
        groups={GROUPS}
        onPick={() => {}}
        onCloseFocus={onCloseFocus}
      />,
    );

    open();

    const tab: Event = createEvent.keyDown(
      screen.getByTestId("template-variable-search"),
      { key: "Tab" },
    );
    fireEvent(screen.getByTestId("template-variable-search"), tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(screen.queryByTestId("insert-template-variable-popup")).toBeNull();
    expect(onCloseFocus).toHaveBeenCalledTimes(1);
  });

  test("a press anywhere else closes the list, and the dialog underneath does not count it", () => {
    render(
      <div>
        <InsertTemplateVariableButton groups={GROUPS} onPick={() => {}} />
        <p data-testid="elsewhere">Elsewhere</p>
      </div>,
    );

    open();

    const press: Event = createEvent.mouseDown(screen.getByTestId("elsewhere"));
    fireEvent(screen.getByTestId("elsewhere"), press);

    expect(screen.queryByTestId("insert-template-variable-popup")).toBeNull();
    expect(wasPressConsumedByAnAnchoredPopup(press)).toBe(true);
  });

  test("a press on the list itself keeps it open", () => {
    render(<InsertTemplateVariableButton groups={GROUPS} onPick={() => {}} />);

    open();

    fireEvent.mouseDown(screen.getByRole("listbox"));

    expect(
      screen.getByTestId("insert-template-variable-popup"),
    ).toBeInTheDocument();
  });

  test("pressing the button again closes the list", () => {
    render(<InsertTemplateVariableButton groups={GROUPS} onPick={() => {}} />);

    open();
    open();

    expect(screen.queryByTestId("insert-template-variable-popup")).toBeNull();
  });
});

describe("the popup, while typing", () => {
  function InlinePopup(props: {
    onClose: (reason: TemplateVariablePopupCloseReason) => void;
  }): ReactElement {
    return (
      <div>
        <input data-testid="field" />
        <TemplateVariablePopup
          mode={TemplateVariablePopupMode.Inline}
          ariaLabel="Template variables"
          getAnchorRect={(): DOMRect => {
            // jsdom has no DOMRect; the popup only reads these.
            return {
              left: 10,
              top: 20,
              right: 11,
              bottom: 36,
              width: 1,
              height: 16,
              x: 10,
              y: 20,
            } as DOMRect;
          }}
          isInsideAnchor={(target: Node): boolean => {
            return target === screen.queryByTestId("field");
          }}
          onClose={props.onClose}
        >
          <p data-testid="inside">Inside</p>
        </TemplateVariablePopup>
      </div>
    );
  }

  test("sits under the cursor, above dialogs", () => {
    render(<InlinePopup onClose={() => {}} />);

    const popup: HTMLElement = screen.getByTestId("template-variable-popup");

    expect(popup).toHaveAttribute("data-mode", TemplateVariablePopupMode.Inline);
    expect(popup.className).toContain("fixed");
    expect(popup.style.top).toBe("40px");
    expect(popup.style.left).toBe("10px");
    expect(Number(popup.style.zIndex)).toBeGreaterThan(50);
  });

  test("a press on it does not take the focus from the field", () => {
    render(<InlinePopup onClose={() => {}} />);

    const press: Event = createEvent.mouseDown(screen.getByTestId("inside"));
    fireEvent(screen.getByTestId("inside"), press);

    expect(press.defaultPrevented).toBe(true);
  });

  test("a press in the field keeps it open; anywhere else closes it", () => {
    const onClose: jest.Mock<(reason: TemplateVariablePopupCloseReason) => void> =
      jest.fn<(reason: TemplateVariablePopupCloseReason) => void>();

    render(<InlinePopup onClose={onClose} />);

    fireEvent.mouseDown(screen.getByTestId("field"));
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onClose).toHaveBeenCalledWith(TemplateVariablePopupCloseReason.Outside);
  });

  test("leaves Escape to the field, which closes it itself", () => {
    const onClose: jest.Mock<(reason: TemplateVariablePopupCloseReason) => void> =
      jest.fn<(reason: TemplateVariablePopupCloseReason) => void>();

    render(<InlinePopup onClose={onClose} />);

    screen.getByTestId("field").focus();
    fireEvent.keyDown(screen.getByTestId("field"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});
