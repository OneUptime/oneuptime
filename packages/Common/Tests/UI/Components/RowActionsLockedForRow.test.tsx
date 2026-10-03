import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import splitActionButtons, {
  getActionButtonLock,
} from "../../../UI/Components/ActionButton/SplitActionButtons";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A row action locked for some rows only (ActionButtonSchema.
 * getDisabledReason) - Delete on a project's built-in states, which can be
 * renamed but never deleted. The row keeps the action where it always is,
 * locked, and says why; every other row's is untouched. A lock for the viewer
 * (`disabled`, their permissions) still comes first.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  _id: string;
  name: string;
  isBuiltIn: boolean;
}

const BUILT_IN: Row = { _id: "1", name: "Resolved", isBuiltIn: true };
const ADDED: Row = { _id: "2", name: "Investigating", isBuiltIn: false };

const LOCKED_REASON: string =
  "Built-in states can be renamed, but not deleted.";

type OnClick = ActionButtonSchema<Row>["onClick"];

const actionsFor: (data: {
  onEdit: Mock<OnClick>;
  onDelete: Mock<OnClick>;
  deleteDisabled?: boolean;
  deleteTooltip?: string;
}) => Array<ActionButtonSchema<Row>> = (data: {
  onEdit: Mock<OnClick>;
  onDelete: Mock<OnClick>;
  deleteDisabled?: boolean;
  deleteTooltip?: string;
}): Array<ActionButtonSchema<Row>> => {
  return [
    {
      title: "Edit",
      icon: IconProp.Edit,
      buttonStyleType: ButtonStyleType.OUTLINE,
      onClick: data.onEdit,
    },
    {
      title: "Delete",
      icon: IconProp.Trash,
      buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
      disabled: data.deleteDisabled,
      tooltip: data.deleteTooltip,
      getDisabledReason: (row: Row): string | undefined => {
        return row.isBuiltIn ? LOCKED_REASON : undefined;
      },
      onClick: data.onDelete,
    },
  ];
};

const openMenu: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

afterEach(() => {
  cleanup();
});

describe("getActionButtonLock", () => {
  const button: ActionButtonSchema<Row> = {
    title: "Delete",
    icon: IconProp.Trash,
    buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
    tooltip: "Delete this state",
    getDisabledReason: (row: Row): string | undefined => {
      return row.isBuiltIn ? LOCKED_REASON : undefined;
    },
    onClick: (): void => {},
  };

  test("a row the reason names is locked, and the reason is the tooltip", () => {
    expect(getActionButtonLock(button, BUILT_IN)).toEqual({
      isDisabled: true,
      tooltip: LOCKED_REASON,
    });
  });

  test("any other row is usable, with the action's own tooltip", () => {
    expect(getActionButtonLock(button, ADDED)).toEqual({
      isDisabled: false,
      tooltip: "Delete this state",
    });
  });

  test("a lock for the viewer comes first, with its own tooltip", () => {
    expect(
      getActionButtonLock(
        {
          ...button,
          disabled: true,
          tooltip: "You do not have permission to delete Incident State.",
        },
        BUILT_IN,
      ),
    ).toEqual({
      isDisabled: true,
      tooltip: "You do not have permission to delete Incident State.",
    });
  });

  test("an action with no row lock is as it always was", () => {
    const plain: ActionButtonSchema<Row> = {
      title: "Edit",
      icon: IconProp.Edit,
      buttonStyleType: ButtonStyleType.OUTLINE,
      onClick: (): void => {},
    };

    expect(getActionButtonLock(plain, BUILT_IN)).toEqual({
      isDisabled: false,
      tooltip: undefined,
    });
  });
});

describe("splitActionButtons with a row lock", () => {
  test("an action locked on this row is not the row's button while another is usable", () => {
    const actions: Array<ActionButtonSchema<Row>> = [
      {
        title: "Rename",
        icon: IconProp.Edit,
        buttonStyleType: ButtonStyleType.OUTLINE,
        getDisabledReason: (row: Row): string | undefined => {
          return row.isBuiltIn ? "Locked" : undefined;
        },
        onClick: (): void => {},
      },
      {
        title: "Edit",
        icon: IconProp.Edit,
        buttonStyleType: ButtonStyleType.OUTLINE,
        onClick: (): void => {},
      },
    ];

    expect(
      splitActionButtons<Row>({ actionButtons: actions, item: BUILT_IN })
        .primary?.button.title,
    ).toBe("Edit");
    expect(
      splitActionButtons<Row>({ actionButtons: actions, item: ADDED }).primary
        ?.button.title,
    ).toBe("Rename");
  });
});

describe("RowActions with a row lock", () => {
  test("a built-in row keeps Delete in its menu, locked, and says why", () => {
    const onEdit: Mock<OnClick> = jest.fn<OnClick>();
    const onDelete: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row>
        item={BUILT_IN}
        actionButtons={actionsFor({ onEdit, onDelete })}
      />,
    );

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    // The reason describes the item, for a screen reader as for the eye.
    const describedBy: string | null =
      deleteItem.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      LOCKED_REASON,
    );

    fireEvent.click(deleteItem);

    expect(onDelete).not.toHaveBeenCalled();
  });

  test("a row the project added deletes as before", () => {
    const onEdit: Mock<OnClick> = jest.fn<OnClick>();
    const onDelete: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row>
        item={ADDED}
        actionButtons={actionsFor({ onEdit, onDelete })}
      />,
    );

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(deleteItem);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[0]).toBe(ADDED);
  });

  test("Edit stays the row's button on a built-in row", () => {
    const onEdit: Mock<OnClick> = jest.fn<OnClick>();
    const onDelete: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row>
        item={BUILT_IN}
        actionButtons={actionsFor({ onEdit, onDelete })}
      />,
    );

    const edit: HTMLElement = within(
      screen.getByTestId("row-actions"),
    ).getByRole("button", { name: "Edit" });

    expect(edit).not.toBeDisabled();

    fireEvent.click(edit);

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test("a viewer who cannot delete is told that, not the row's reason", () => {
    const onEdit: Mock<OnClick> = jest.fn<OnClick>();
    const onDelete: Mock<OnClick> = jest.fn<OnClick>();
    const permissionReason: string =
      "You do not have permission to delete Incident State.";

    render(
      <RowActions<Row>
        item={BUILT_IN}
        actionButtons={actionsFor({
          onEdit,
          onDelete,
          deleteDisabled: true,
          deleteTooltip: permissionReason,
        })}
      />,
    );

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    expect(
      document.getElementById(deleteItem.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe(permissionReason);
  });

  test("a lone action locked on this row is the row's button, disabled", () => {
    const onDelete: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row>
        item={BUILT_IN}
        actionButtons={[
          {
            title: "Remove",
            icon: IconProp.Close,
            buttonStyleType: ButtonStyleType.NORMAL,
            getDisabledReason: (): string => {
              return LOCKED_REASON;
            },
            onClick: onDelete,
          },
        ]}
      />,
    );

    const remove: HTMLElement = within(
      screen.getByTestId("row-actions"),
    ).getByRole("button", { name: "Remove" });

    expect(remove).toBeDisabled();

    fireEvent.click(remove);

    expect(onDelete).not.toHaveBeenCalled();
  });
});
