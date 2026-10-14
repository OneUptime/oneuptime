import RowActions from "../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
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
 * A locked item of a ⋯ menu - Delete, for a member who may not delete -
 * stays in the menu and says why it is locked. With a mouse that is a hover;
 * on a phone nothing hovers, and the tap is the only way to ask. A tap ends
 * with the pointer leaving (Chrome sends mouseleave the moment the finger
 * lifts), so the reason the tap brought up was gone before it could be read,
 * and the locked Delete just looked broken. Now pressing a locked item shows
 * its reason and keeps it until the item is pressed again or the menu
 * closes. Hover and keyboard focus show it as before.
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

interface StatusPageRow {
  id: string;
  name: string;
}

const DEMO: StatusPageRow = { id: "demo", name: "Demo Status" };

const DELETE_DENIED: string =
  "You do not have permission to delete this Status Page. You need one of these permissions: Project Owner, Project Admin.";

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {
  return undefined;
};

const deleted: Array<string> = [];

// A Viewer's row: View on the row, Show ID and a locked Delete in the ⋯.
const viewerRow: () => void = (): void => {
  render(
    <RowActions<StatusPageRow>
      item={DEMO}
      actionButtons={[
        {
          title: "View Status Page",
          icon: IconProp.Eye,
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: noop,
        },
        {
          title: "Show ID",
          icon: IconProp.Info,
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: noop,
        },
        {
          title: "Delete",
          icon: IconProp.Trash,
          buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
          disabled: true,
          tooltip: DELETE_DENIED,
          onClick: (item: StatusPageRow) => {
            deleted.push(item.id);
          },
        },
      ]}
    />,
  );
};

function openMenu(): HTMLElement {
  const trigger: HTMLElement = screen.getByTestId("row-actions-more-button");
  fireEvent.pointerDown(trigger);
  fireEvent.mouseDown(trigger);
  fireEvent.mouseUp(trigger);
  fireEvent.click(trigger);
  return screen.getByRole("menu");
}

// What a finger's tap sends a button, in the order the browser sends it.
function tap(element: HTMLElement): void {
  fireEvent.mouseOver(element);
  fireEvent.mouseEnter(element);
  fireEvent.mouseDown(element);
  act(() => {
    element.focus();
  });
  fireEvent.mouseUp(element);
  fireEvent.click(element);
  // The finger lifts: the pointer leaves the button at once.
  fireEvent.mouseLeave(element);
  fireEvent.mouseOut(element);
}

// Lets Tippy's deferred work run, then says which tooltips are shown.
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
  deleted.length = 0;
});

describe("a locked Delete in a row's ⋯ menu, on a phone", () => {
  test("a tap says why it is locked, and the reason stays once the finger lifts", async () => {
    viewerRow();

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    tap(deleteItem);

    expect(await tooltipsShown()).toEqual([DELETE_DENIED]);

    // It is still locked: the tap deleted nothing.
    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(deleted).toEqual([]);
  });

  test("a second tap puts the reason away", async () => {
    viewerRow();

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    tap(deleteItem);
    expect(await tooltipsShown()).toEqual([DELETE_DENIED]);

    tap(deleteItem);
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
    });
  });
});

describe("a locked Delete with a mouse", () => {
  test("hovering still shows the reason and moving away still hides it", async () => {
    viewerRow();

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    fireEvent.mouseEnter(deleteItem);
    expect(await tooltipsShown()).toEqual([DELETE_DENIED]);

    fireEvent.mouseLeave(deleteItem);
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
    });
  });

  test("a click keeps the reason up while the pointer moves on to read it", async () => {
    viewerRow();

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    fireEvent.mouseEnter(deleteItem);
    fireEvent.click(deleteItem);
    fireEvent.mouseLeave(deleteItem);

    expect(await tooltipsShown()).toEqual([DELETE_DENIED]);
    expect(deleted).toEqual([]);
  });
});

describe("tooltips elsewhere", () => {
  test("an ordinary tooltip is not kept by a press: it goes when the pointer leaves", async () => {
    render(
      <Tooltip text="What this does">
        <button type="button" data-testid="plain">
          Help
        </button>
      </Tooltip>,
    );

    const button: HTMLElement = screen.getByTestId("plain");

    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    expect(await tooltipsShown()).toEqual(["What this does"]);

    fireEvent.mouseLeave(button);
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
    });
  });

  test("a tooltip shown on press is kept by a press and put away by the next", async () => {
    render(
      <Tooltip text="Why this is locked" isShownOnPress={true}>
        <button type="button" data-testid="pressable">
          Locked
        </button>
      </Tooltip>,
    );

    const button: HTMLElement = screen.getByTestId("pressable");

    tap(button);
    expect(await tooltipsShown()).toEqual(["Why this is locked"]);

    tap(button);
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
    });
  });
});
