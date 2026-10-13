import RowActions from "../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { PORTALED_MENU_WIDTH } from "../../../UI/Components/MoreMenu/MoreMenu";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
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
import React from "react";

/*
 * A row's ⋯ menu and the tooltips of its items, as the LLM providers list
 * draws them for a Viewer: Test is locked, and says why.
 *
 * A menu focuses its first item when it opens, whichever way it was opened -
 * the menu-button pattern. That focus is the script's, though, when the
 * menu was opened with the mouse, and a tooltip that answered it popped the
 * first item's reason up at once, over the page, before anyone pointed at
 * anything - and, drawn before the menu had settled, at the place the menu
 * opened from: the left edge of the screen. Now the reason waits for the
 * pointer, and shows at once for the keyboard, whose focus it is.
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

interface Provider {
  id: string;
  name: string;
}

const CHATGPT: Provider = { id: "chatgpt", name: "Chatgpt" };

const TEST_DENIED: string =
  "You do not have permission to test this LLM provider. You need one of these permissions: Project Owner, Project Admin, Project Member, Settings Admin, Settings Member, Edit LLM.";

const DELETE_DENIED: string =
  "You do not have permission to delete this LLM Provider.";

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {
  return undefined;
};

// The row as a Viewer finds it: View, then Test and Delete locked in the ⋯.
const viewerRow: () => void = (): void => {
  render(
    <RowActions<Provider>
      item={CHATGPT}
      actionButtons={[
        {
          title: "View LLM Provider",
          icon: IconProp.Eye,
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: noop,
        },
        {
          title: "Test",
          icon: IconProp.Play,
          buttonStyleType: ButtonStyleType.NORMAL,
          disabled: true,
          tooltip: TEST_DENIED,
          onClick: noop,
        },
        {
          title: "Delete",
          icon: IconProp.Trash,
          buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
          disabled: true,
          tooltip: DELETE_DENIED,
          onClick: noop,
        },
      ]}
    />,
  );
};

function trigger(): HTMLElement {
  return screen.getByTestId("row-actions-more-button");
}

function openWithTheMouse(): HTMLElement {
  fireEvent.pointerDown(trigger());
  fireEvent.mouseDown(trigger());
  fireEvent.mouseUp(trigger());
  fireEvent.click(trigger());
  return screen.getByRole("menu");
}

function openWithTheKeyboard(): HTMLElement {
  /*
   * Enter on a focused button: the key goes down, and the browser turns it
   * into the button's click (jsdom does not, so the click is sent too).
   */
  act(() => {
    trigger().focus();
  });
  fireEvent.keyDown(trigger(), { key: "Enter" });
  fireEvent.click(trigger());
  return screen.getByRole("menu");
}

// Lets Tippy and the menu's deferred work run, then says what is shown.
async function tooltipsShown(): Promise<Array<string>> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });

  return screen.queryAllByRole("tooltip").map((tooltip: HTMLElement) => {
    return tooltip.textContent || "";
  });
}

afterEach(() => {
  cleanup();
});

describe("a locked first item of a menu opened with the mouse", () => {
  test("takes the focus, as the menu pattern asks, but keeps its reason to itself", async () => {
    viewerRow();

    const menu: HTMLElement = openWithTheMouse();
    const testItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Test",
    });

    expect(testItem).toHaveFocus();
    expect(await tooltipsShown()).toEqual([]);

    // Still announced as locked, and why, to a screen reader.
    expect(testItem).toHaveAttribute("aria-disabled", "true");
    expect(testItem).toHaveAccessibleDescription(TEST_DENIED);
  });

  test("says why it is locked once the pointer reaches it", async () => {
    viewerRow();

    const menu: HTMLElement = openWithTheMouse();
    fireEvent.mouseEnter(within(menu).getByRole("menuitem", { name: "Test" }));

    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(TEST_DENIED);
    });
  });

  test("the arrow keys bring each item's reason with them", async () => {
    viewerRow();

    const menu: HTMLElement = openWithTheMouse();
    const [testItem, deleteItem] = within(menu).getAllByRole("menuitem");

    fireEvent.keyDown(testItem!, { key: "ArrowDown" });

    expect(deleteItem).toHaveFocus();
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(DELETE_DENIED);
    });
  });
});

describe("a locked first item of a menu opened from the keyboard", () => {
  test("says why it is locked the moment it takes the focus", async () => {
    viewerRow();

    const menu: HTMLElement = openWithTheKeyboard();

    expect(within(menu).getByRole("menuitem", { name: "Test" })).toHaveFocus();
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(TEST_DENIED);
    });
  });
});

describe("tooltips elsewhere", () => {
  test("an ordinary tooltip still shows on any focus, after a click as before", async () => {
    render(
      <Tooltip text="What this does">
        <button type="button" data-testid="plain">
          Plain
        </button>
      </Tooltip>,
    );

    fireEvent.pointerDown(document.body);
    act(() => {
      screen.getByTestId("plain").focus();
    });

    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("What this does");
    });
  });

  test("one that waits for the keyboard still shows on hover, whatever was pressed last", async () => {
    render(
      <Tooltip text="Why it is locked" isShownOnKeyboardFocusOnly={true}>
        <button type="button" data-testid="waits">
          Waits
        </button>
      </Tooltip>,
    );

    fireEvent.pointerDown(document.body);
    fireEvent.mouseEnter(screen.getByTestId("waits"));

    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("Why it is locked");
    });
  });
});

describe("where the menu opens", () => {
  test("its width is on the element itself, so its first placement is its last", () => {
    viewerRow();

    const menu: HTMLElement = openWithTheMouse();

    /*
     * Placed by its first measurement: a width that waits for a stylesheet
     * rule measured as the widest of its contents - the locked item's whole
     * sentence of a reason - and opened the menu at the left of the screen.
     */
    expect(PORTALED_MENU_WIDTH).toBe("14rem");
    expect(menu.style.width).toBe(PORTALED_MENU_WIDTH);
  });
});
