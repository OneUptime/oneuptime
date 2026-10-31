import RowActions from "../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Modal from "../../../UI/Components/Modal/Modal";
import ExplainedPill from "../../../UI/Components/Pill/ExplainedPill";
import InfoTooltip from "../../../UI/Components/Tooltip/InfoTooltip";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import {
  ESCAPE_LAYER_SELECTOR,
  getFrontmostEscapeLayer,
  isInFrontmostEscapeLayer,
} from "../../../UI/Components/Tooltip/TooltipEscape";
import { Yellow } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React, { ReactElement } from "react";

/*
 * ESCAPE PUTS A TOOLTIP AWAY (WCAG 1.4.13).
 *
 * Every tooltip of the shared Tooltip closes on Escape however it was
 * opened - hover, the keyboard's focus, a tap - without the pointer or the
 * focus moving. The Escape that closed one is spent: a dialog or a menu
 * around the tooltip's trigger stays open, and a second Escape closes it. A
 * tooltip left behind a dialog closes too, and lets the Escape through to
 * the dialog. With no tooltip open, Escape does what it always did.
 *
 * Tippy under jsdom: the box is portalled to the body and found by its
 * role; its deferred work runs after a short real wait.
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

jest.setTimeout(30000);

// Lets Tippy's deferred work run (a rich tooltip waits 120ms), then lists the boxes.
async function tooltipsShown(): Promise<Array<string>> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 250);
    });
  });

  return screen.queryAllByRole("tooltip").map((tooltip: HTMLElement) => {
    return tooltip.textContent || "";
  });
}

async function noTooltips(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
  });
}

/*
 * Escape as the keyboard sends it, to what has the focus. Says whether
 * anything was left to hear it: false when the key was spent.
 */
function pressEscape(options?: { isComposing?: boolean }): boolean {
  const target: Element = document.activeElement || document.body;
  return fireEvent.keyDown(target, {
    key: "Escape",
    code: "Escape",
    isComposing: Boolean(options?.isComposing),
  });
}

// Moves the focus as Tab does: a key goes down, then the focus moves.
function tabTo(element: HTMLElement): void {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => {
    element.focus();
  });
}

// What a finger's tap sends a button, in the order the browser sends it.
function tap(element: HTMLElement): void {
  fireEvent.pointerDown(element);
  fireEvent.mouseOver(element);
  fireEvent.mouseEnter(element);
  fireEvent.mouseDown(element);
  act(() => {
    element.focus();
  });
  fireEvent.mouseUp(element);
  fireEvent.click(element);
  // The finger lifts: the pointer leaves at once.
  fireEvent.mouseLeave(element);
  fireEvent.mouseOut(element);
}

// A card that hears Escape itself, with a field and a button with a tooltip.
function Copy(props: { onKeyDown?: () => void }): ReactElement {
  return (
    <div
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
          props.onKeyDown?.();
        }
      }}
    >
      <input data-testid="field" aria-label="Field" />
      <Tooltip text="Copies the link">
        <button type="button" data-testid="copy">
          Copy
        </button>
      </Tooltip>
    </div>
  );
}

// The last press was the pointer's, as after a click.
function pointerWasLast(): void {
  fireEvent.pointerDown(document.body);
  fireEvent.mouseDown(document.body);
}

// The last press was a key's.
function keyboardWasLast(): void {
  fireEvent.keyDown(document.body, { key: "Shift" });
}

afterEach(() => {
  cleanup();
});

describe("Escape closes a tooltip, however it was opened", () => {
  test("opened by hover: it closes, the key is spent, and the focus has not moved", async () => {
    const parentHeard: MockFunction = getJestMockFunction();
    render(<Copy onKeyDown={parentHeard as () => void} />);
    act(() => {
      screen.getByTestId("field").focus();
    });

    fireEvent.mouseEnter(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);

    expect(pressEscape()).toBe(false);

    await noTooltips();
    expect(screen.getByTestId("field")).toHaveFocus();
    expect(parentHeard).not.toHaveBeenCalled();
  });

  test("opened by the keyboard's focus: it closes and the focus stays on its trigger", async () => {
    render(<Copy />);

    tabTo(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);

    expect(pressEscape()).toBe(false);

    await noTooltips();
    expect(screen.getByTestId("copy")).toHaveFocus();
  });

  test("opened by a tap on a phone: it closes, and the next tap opens it again", async () => {
    render(
      <Tooltip text="Why this is locked" isShownOnPress={true}>
        <button type="button" data-testid="locked">
          Locked
        </button>
      </Tooltip>,
    );

    tap(screen.getByTestId("locked"));
    expect(await tooltipsShown()).toEqual(["Why this is locked"]);

    expect(pressEscape()).toBe(false);
    await noTooltips();

    // Not left half-pinned: one tap is enough to open it again.
    tap(screen.getByTestId("locked"));
    expect(await tooltipsShown()).toEqual(["Why this is locked"]);
  });

  test("a rich tooltip holding the focus closes, and gives the focus back to its trigger", async () => {
    render(
      <Tooltip
        richContent={
          <div>
            <button type="button" data-testid="inside">
              Copy search syntax
            </button>
          </div>
        }
      >
        <button type="button" data-testid="chip">
          Service: checkout
        </button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByTestId("chip"));
    expect(await tooltipsShown()).toEqual(["Copy search syntax"]);

    act(() => {
      screen.getByTestId("inside").focus();
    });
    expect(screen.getByTestId("inside")).toHaveFocus();

    expect(pressEscape()).toBe(false);

    await noTooltips();
    expect(screen.getByTestId("chip")).toHaveFocus();
  });

  test("two tooltips open at once - one hovered, one focused - both close on one Escape", async () => {
    render(
      <>
        <Tooltip text="First">
          <button type="button" data-testid="first">
            One
          </button>
        </Tooltip>
        <Tooltip text="Second">
          <button type="button" data-testid="second">
            Two
          </button>
        </Tooltip>
      </>,
    );

    tabTo(screen.getByTestId("first"));
    fireEvent.mouseEnter(screen.getByTestId("second"));
    expect((await tooltipsShown()).sort()).toEqual(["First", "Second"]);

    pressEscape();

    await noTooltips();
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  test("after Escape, pointing at the trigger again opens it again", async () => {
    render(<Copy />);
    const copy: HTMLElement = screen.getByTestId("copy");

    fireEvent.mouseEnter(copy);
    expect(await tooltipsShown()).toEqual(["Copies the link"]);
    pressEscape();
    await noTooltips();

    fireEvent.mouseLeave(copy);
    fireEvent.mouseEnter(copy);
    expect(await tooltipsShown()).toEqual(["Copies the link"]);
  });

  test("other keys leave it open, and so does Escape while text is being composed", async () => {
    render(<Copy />);

    tabTo(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);

    fireEvent.keyDown(screen.getByTestId("copy"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("copy"), { key: "Esc" });
    expect(pressEscape({ isComposing: true })).toBe(true);

    expect(await tooltipsShown()).toEqual(["Copies the link"]);
  });

  test("with no tooltip open, Escape is left alone - and a closed tooltip leaves no listener behind", async () => {
    const parentHeard: MockFunction = getJestMockFunction();
    render(<Copy onKeyDown={parentHeard as () => void} />);

    act(() => {
      screen.getByTestId("field").focus();
    });
    expect(pressEscape()).toBe(true);
    expect(parentHeard).toHaveBeenCalledTimes(1);

    fireEvent.mouseEnter(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);
    fireEvent.mouseLeave(screen.getByTestId("copy"));
    await noTooltips();

    expect(pressEscape()).toBe(true);
    expect(parentHeard).toHaveBeenCalledTimes(2);
  });

  test("the card around a hovered tooltip does not hear the Escape that closed it", async () => {
    const parentHeard: MockFunction = getJestMockFunction();
    render(<Copy onKeyDown={parentHeard as () => void} />);
    act(() => {
      screen.getByTestId("field").focus();
    });

    fireEvent.mouseEnter(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);

    pressEscape();
    await noTooltips();
    expect(parentHeard).not.toHaveBeenCalled();

    // The next one is the card's again.
    pressEscape();
    expect(parentHeard).toHaveBeenCalledTimes(1);
  });

  test("a tooltip that unmounts while open takes its listener with it", async () => {
    const parentHeard: MockFunction = getJestMockFunction();
    const { rerender } = render(<Copy onKeyDown={parentHeard as () => void} />);

    fireEvent.mouseEnter(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);

    rerender(
      <div
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Escape") {
            parentHeard();
          }
        }}
      >
        <button type="button">Gone</button>
      </div>,
    );

    act(() => {
      screen.getByRole("button", { name: "Gone" }).focus();
    });
    expect(pressEscape()).toBe(true);
    expect(parentHeard).toHaveBeenCalledTimes(1);
  });
});

describe("the shared tooltips built on it", () => {
  test("an (i) (InfoTooltip, made on first use) closes on Escape", async () => {
    render(<InfoTooltip label="p95 duration" text="The slowest 5%." />);
    const button: HTMLElement = screen.getByRole("button", {
      name: "About p95 duration",
    });

    tabTo(button);
    expect(await tooltipsShown()).toEqual(["The slowest 5%."]);

    expect(pressEscape()).toBe(false);
    await noTooltips();
    expect(button).toHaveFocus();
  });

  test("an explained pill's reason, tapped open, closes on Escape", async () => {
    render(
      <ExplainedPill
        text="Adds nothing"
        explanation="This rule adds nothing when it matches."
        color={Yellow}
        dataTestId="explained"
      />,
    );

    tap(screen.getByTestId("explained"));
    expect(await tooltipsShown()).toEqual([
      "This rule adds nothing when it matches.",
    ]);

    expect(pressEscape()).toBe(false);
    await noTooltips();
    // The reason is still the pill's description for a screen reader.
    expect(screen.getByTestId("explained")).toHaveAccessibleDescription(
      "This rule adds nothing when it matches.",
    );
  });
});

describe("inside a dialog", () => {
  function DialogWithTooltip(props: { onClose: () => void }): ReactElement {
    return (
      <Modal title="Edit Monitor" onClose={props.onClose}>
        <Tooltip text="Copies the monitor's ID">
          <button type="button" data-testid="copy-id">
            Copy ID
          </button>
        </Tooltip>
      </Modal>
    );
  }

  test("Escape closes the tooltip, not the dialog; the next Escape closes the dialog", async () => {
    const onClose: MockFunction = getJestMockFunction();
    render(<DialogWithTooltip onClose={onClose as () => void} />);

    fireEvent.mouseEnter(screen.getByTestId("copy-id"));
    expect(await tooltipsShown()).toEqual(["Copies the monitor's ID"]);

    expect(pressEscape()).toBe(false);
    await noTooltips();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("opened by the keyboard inside the dialog: the same, with the focus kept on the trigger", async () => {
    const onClose: MockFunction = getJestMockFunction();
    render(<DialogWithTooltip onClose={onClose as () => void} />);

    tabTo(screen.getByTestId("copy-id"));
    expect(await tooltipsShown()).toEqual(["Copies the monitor's ID"]);

    pressEscape();
    await noTooltips();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("copy-id")).toHaveFocus();
  });

  test("a tooltip left behind the dialog closes with it: one Escape closes both", async () => {
    const onClose: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <Tooltip text="Opens the editor">
        <button type="button" data-testid="edit">
          Edit
        </button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByTestId("edit"));
    expect(await tooltipsShown()).toEqual(["Opens the editor"]);

    // The dialog the button opened comes over it, the tooltip still up.
    rerender(
      <>
        <Tooltip text="Opens the editor">
          <button type="button" data-testid="edit">
            Edit
          </button>
        </Tooltip>
        <Modal title="Edit Monitor" onClose={onClose as () => void}>
          <p>Fields</p>
        </Modal>
      </>,
    );

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
    await noTooltips();
  });

  test("with no tooltip open, Escape closes the dialog at once, as before", () => {
    const onClose: MockFunction = getJestMockFunction();
    render(
      <Modal title="Edit Monitor" onClose={onClose as () => void}>
        <input aria-label="Name" />
      </Modal>,
    );

    expect(pressEscape()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("opened with the mouse, a dialog whose first focus brings a tooltip up still closes on one Escape", async () => {
    const onClose: MockFunction = getJestMockFunction();

    // The click that opened it.
    pointerWasLast();
    render(<DialogWithTooltip onClose={onClose as () => void} />);

    // Its first focus lands on the button, whose tooltip comes up with it.
    expect(screen.getByTestId("copy-id")).toHaveFocus();
    expect(await tooltipsShown()).toEqual(["Copies the monitor's ID"]);

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
    await noTooltips();
  });

  test("opened from the keyboard, the first focus's tooltip is the keyboard's: Escape closes it, then the dialog", async () => {
    const onClose: MockFunction = getJestMockFunction();

    keyboardWasLast();
    render(<DialogWithTooltip onClose={onClose as () => void} />);

    expect(screen.getByTestId("copy-id")).toHaveFocus();
    expect(await tooltipsShown()).toEqual(["Copies the monitor's ID"]);

    pressEscape();
    await noTooltips();
    expect(onClose).not.toHaveBeenCalled();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("inside a menu", () => {
  const DELETE_DENIED: string =
    "You do not have permission to delete this Status Page.";

  const lockedRow: () => void = (): void => {
    render(
      <RowActions<{ id: string; name: string }>
        item={{ id: "demo", name: "Demo" }}
        actionButtons={[
          {
            title: "View Status Page",
            icon: IconProp.Eye,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: () => {
              return undefined;
            },
          },
          {
            title: "Show ID",
            icon: IconProp.Info,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: () => {
              return undefined;
            },
          },
          {
            title: "Delete",
            icon: IconProp.Trash,
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            disabled: true,
            tooltip: DELETE_DENIED,
            onClick: () => {
              return undefined;
            },
          },
        ]}
      />,
    );
  };

  test("a locked item's reason closes first; the next Escape closes the menu and the focus goes back to its button", async () => {
    lockedRow();

    const trigger: HTMLElement = screen.getByTestId("row-actions-more-button");
    fireEvent.pointerDown(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);

    const menu: HTMLElement = screen.getByRole("menu");
    const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    // The arrow keys bring the locked item's reason with them.
    for (
      let step: number = 0;
      step < 5 && document.activeElement !== deleteItem;
      step++
    ) {
      fireEvent.keyDown(document.activeElement as Element, {
        key: "ArrowDown",
      });
    }
    expect(deleteItem).toHaveFocus();
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(DELETE_DENIED);
    });

    expect(pressEscape()).toBe(false);
    await noTooltips();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(deleteItem).toHaveFocus();

    pressEscape();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(trigger).toHaveFocus();
  });

  const RUN_NOW_EXPLAINED: string = "Import the next poll window now.";

  // A row whose menu opens on an item that explains itself.
  const explainedRow: () => HTMLElement = (): HTMLElement => {
    const noop: () => undefined = () => {
      return undefined;
    };
    render(
      <RowActions<{ id: string; name: string }>
        item={{ id: "okta", name: "Okta" }}
        actionButtons={[
          {
            title: "Test connection",
            icon: IconProp.Signal,
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: noop,
          },
          {
            title: "Run now",
            icon: IconProp.Play,
            buttonStyleType: ButtonStyleType.OUTLINE,
            tooltip: RUN_NOW_EXPLAINED,
            onClick: noop,
          },
          {
            title: "Edit",
            icon: IconProp.Edit,
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: noop,
          },
        ]}
      />,
    );

    return screen.getByTestId("row-actions-more-button");
  };

  test("opened with the mouse, the first item's tooltip waits, and one Escape closes the menu, as before", async () => {
    const trigger: HTMLElement = explainedRow();
    fireEvent.pointerDown(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);

    expect(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Run now",
      }),
    ).toHaveFocus();
    expect(await tooltipsShown()).toEqual([]);

    pressEscape();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(trigger).toHaveFocus();
  });

  test("opened from the keyboard, the first item's tooltip comes up with the focus: Escape puts it away, the next one closes the menu", async () => {
    const trigger: HTMLElement = explainedRow();
    act(() => {
      trigger.focus();
    });
    // Enter on a button: the key goes down, and the browser clicks it.
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(trigger);

    const runNow: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: "Run now" },
    );
    expect(runNow).toHaveFocus();
    expect(await tooltipsShown()).toEqual([RUN_NOW_EXPLAINED]);

    expect(pressEscape()).toBe(false);
    await noTooltips();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(runNow).toHaveFocus();

    pressEscape();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(trigger).toHaveFocus();
  });
});

/*
 * Some components hear keys on the window itself, as the key goes down,
 * before anything on the page: the playlist player (Escape leaves it) and a
 * dashboard widget being dragged (Escape drops the drag). A tooltip's
 * Escape listener is added when its module loads, before any of them, so
 * the Escape that closed a tooltip never reaches them: one Escape, one
 * thing done.
 */
describe("before the listeners that hear Escape on the window", () => {
  // A listener added the way those components add theirs.
  const listenOnWindow: () => {
    heard: MockFunction;
    stop: () => void;
  } = () => {
    const heard: MockFunction = getJestMockFunction();
    const listener: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        heard(event.defaultPrevented);
      }
    };
    window.addEventListener("keydown", listener, true);

    return {
      heard,
      stop: (): void => {
        window.removeEventListener("keydown", listener, true);
      },
    };
  };

  test("one added before the tooltip showed does not hear the Escape that closed it; the next Escape is its own", async () => {
    const player: ReturnType<typeof listenOnWindow> = listenOnWindow();
    render(<Copy />);

    fireEvent.mouseEnter(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);

    expect(pressEscape()).toBe(false);
    await noTooltips();
    expect(player.heard).not.toHaveBeenCalled();

    pressEscape();
    expect(player.heard.mock.calls).toEqual([[false]]);
    player.stop();
  });

  test("the same for a tooltip the keyboard's focus brought up, the focus kept on its trigger", async () => {
    const player: ReturnType<typeof listenOnWindow> = listenOnWindow();
    render(<Copy />);

    tabTo(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);

    pressEscape();
    await noTooltips();
    expect(player.heard).not.toHaveBeenCalled();
    expect(screen.getByTestId("copy")).toHaveFocus();
    player.stop();
  });

  test("one added while the tooltip shows - a drag begun under it - does not hear it either", async () => {
    render(<Copy />);
    fireEvent.mouseEnter(screen.getByTestId("copy"));
    expect(await tooltipsShown()).toEqual(["Copies the link"]);

    const drag: ReturnType<typeof listenOnWindow> = listenOnWindow();

    pressEscape();
    await noTooltips();
    expect(drag.heard).not.toHaveBeenCalled();
    drag.stop();
  });

  test("with no tooltip open, it hears Escape at once, as before", () => {
    const player: ReturnType<typeof listenOnWindow> = listenOnWindow();
    render(<Copy />);

    act(() => {
      screen.getByTestId("field").focus();
    });
    expect(pressEscape()).toBe(true);
    expect(player.heard.mock.calls).toEqual([[false]]);
    player.stop();
  });

  test("a tooltip left behind a dialog closes and lets the Escape through, so the listener hears it too", async () => {
    const player: ReturnType<typeof listenOnWindow> = listenOnWindow();
    const onClose: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <Tooltip text="Opens the editor">
        <button type="button" data-testid="edit">
          Edit
        </button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByTestId("edit"));
    expect(await tooltipsShown()).toEqual(["Opens the editor"]);

    rerender(
      <>
        <Tooltip text="Opens the editor">
          <button type="button" data-testid="edit">
            Edit
          </button>
        </Tooltip>
        <Modal title="Edit Monitor" onClose={onClose as () => void}>
          <p>Fields</p>
        </Modal>
      </>,
    );

    pressEscape();
    await noTooltips();
    expect(player.heard).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    player.stop();
  });
});

describe("which tooltip's Escape is spent", () => {
  test("no dialog or menu open: every trigger is in front", () => {
    render(<button type="button">Alone</button>);

    expect(getFrontmostEscapeLayer(document)).toBeNull();
    expect(
      isInFrontmostEscapeLayer(screen.getByRole("button", { name: "Alone" })),
    ).toBe(true);
  });

  test("the last open dialog or menu is in front; a trigger outside it is behind", () => {
    render(
      <>
        <button type="button">Page</button>
        <div role="dialog" aria-modal="true">
          <button type="button">In the dialog</button>
        </div>
        <div role="menu">
          <button type="button">In the menu</button>
        </div>
      </>,
    );

    expect(getFrontmostEscapeLayer(document)).toBe(screen.getByRole("menu"));
    expect(
      isInFrontmostEscapeLayer(
        screen.getByRole("button", { name: "In the menu" }),
      ),
    ).toBe(true);
    expect(
      isInFrontmostEscapeLayer(
        screen.getByRole("button", { name: "In the dialog" }),
      ),
    ).toBe(false);
    expect(
      isInFrontmostEscapeLayer(screen.getByRole("button", { name: "Page" })),
    ).toBe(false);
  });

  test("dialogs of every kind count, and a tooltip's own content never does", () => {
    for (const markup of [
      '<div role="dialog"></div>',
      '<div role="alertdialog"></div>',
      '<div aria-modal="true"></div>',
      "<dialog open></dialog>",
      '<div role="menu"></div>',
    ]) {
      document.body.innerHTML = markup;
      expect(getFrontmostEscapeLayer(document)).toBe(
        document.body.firstElementChild,
      );
      expect(
        document.body.firstElementChild!.matches(ESCAPE_LAYER_SELECTOR),
      ).toBe(true);
    }

    document.body.innerHTML =
      '<button>Page</button><div data-tippy-root><div role="dialog"></div></div>';
    expect(getFrontmostEscapeLayer(document)).toBeNull();

    // A closed <dialog> is no layer.
    document.body.innerHTML = "<dialog></dialog>";
    expect(getFrontmostEscapeLayer(document)).toBeNull();
    document.body.innerHTML = "";
  });
});
