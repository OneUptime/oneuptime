import ActionButtonSchema from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "../../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import Modal from "../../../../UI/Components/Modal/Modal";
import MoreMenu from "../../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../../UI/Components/MoreMenu/MoreMenuItem";
import IconProp from "../../../../Types/Icon/IconProp";
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
import { Mock } from "jest-mock";
import React, { ReactElement, useState } from "react";

/*
 * What a keyboard or screen-reader user gets from a row's ⋯ menu.
 *
 * Moving row actions into a menu must not cost anyone the things the old
 * strip of buttons gave them: a locked action that says why it is locked,
 * focus that comes back where it was after a dialog, and a trigger that says
 * which row it belongs to.
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

interface Member {
  id: string;
  name: string;
}

const ADA: Member = { id: "ada", name: "Ada Lovelace" };

const DELETE_DENIED: string =
  "You do not have permission to delete this Member.";

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {
  return undefined;
};

const openMenu: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

/*
 * Runs any requestAnimationFrame work MoreMenu queued (its deferred focus
 * restore) so assertions see the settled state.
 */
const flushFrames: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });
};

afterEach(() => {
  cleanup();
});

describe("a locked action in the ⋯ menu", () => {
  // View is the row's button, so the menu holds Edit and the locked Delete.
  const lockedRow: () => void = (): void => {
    render(
      <RowActions<Member>
        item={ADA}
        actionButtons={[
          {
            title: "View",
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: noop,
          },
          {
            title: "Edit",
            buttonStyleType: ButtonStyleType.OUTLINE,
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

  test("is announced as disabled, and describes why", () => {
    lockedRow();

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(deleteItem).toHaveAccessibleDescription(DELETE_DENIED);
  });

  test("keeps its plain name - the reason is a description, not part of the name", () => {
    lockedRow();

    expect(
      within(openMenu()).getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  test("can be reached with the arrow keys", () => {
    lockedRow();

    const menu: HTMLElement = openMenu();
    const [editItem, deleteItem] = within(menu).getAllByRole("menuitem");

    expect(editItem).toHaveFocus();

    fireEvent.keyDown(editItem!, { key: "ArrowDown" });

    expect(deleteItem).toHaveFocus();
  });

  test("shows its reason when it takes focus", async () => {
    lockedRow();

    const deleteItem: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Delete",
    });

    act(() => {
      deleteItem.focus();
    });
    fireEvent.focus(deleteItem);

    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(DELETE_DENIED);
    });
  });

  test("cannot be activated by click or Enter, and leaves the menu open", () => {
    const onDelete: Mock<() => void> = jest.fn<() => void>();

    render(
      <RowActions<Member>
        item={ADA}
        actionButtons={[
          {
            title: "Edit",
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: noop,
          },
          {
            title: "Delete",
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            disabled: true,
            tooltip: DELETE_DENIED,
            onClick: () => {
              onDelete();
            },
          },
        ]}
      />,
    );

    const menu: HTMLElement = openMenu();
    const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    fireEvent.click(deleteItem);
    fireEvent.keyDown(deleteItem, { key: "Enter" });
    fireEvent.keyDown(deleteItem, { key: " " });

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  test("a locked item with nothing to say is still skipped, as before", () => {
    render(
      <MoreMenu text="Actions">
        {[
          <MoreMenuItem
            key="locked"
            text="Locked"
            isDisabled={true}
            onClick={noop}
          />,
          <MoreMenuItem key="open" text="Open" onClick={noop} />,
        ]}
      </MoreMenu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));

    const locked: HTMLElement = screen.getByRole("menuitem", {
      name: "Locked",
    });

    expect(locked).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });
});

describe("a dialog opened from the ⋯ menu", () => {
  /*
   * The pattern every ModelTable row uses for Edit, Delete and Show ID: the
   * action sets state that mounts a Modal in the same update that closes the
   * menu.
   */
  const RowWithDialog: () => ReactElement = (): ReactElement => {
    const [isOpen, setIsOpen] = useState<boolean>(false);

    const actions: Array<ActionButtonSchema<Member>> = [
      {
        title: "View",
        buttonStyleType: ButtonStyleType.NORMAL,
        onClick: noop,
      },
      {
        title: "Show ID",
        buttonStyleType: ButtonStyleType.OUTLINE,
        onClick: (_item: Member, onComplete: () => void) => {
          setIsOpen(true);
          onComplete();
        },
      },
    ];

    return (
      <div>
        <RowActions<Member> item={ADA} actionButtons={actions} />
        {isOpen && (
          <Modal
            title="Member ID"
            onClose={() => {
              setIsOpen(false);
            }}
          >
            <div>ada</div>
          </Modal>
        )}
      </div>
    );
  };

  /*
   * A browser moves focus into the dialog as it opens; jsdom does not, which
   * would leave focus sitting on the trigger and hide the bug entirely. Put it
   * where a real dialog would have it.
   */
  const focusInsideDialog: () => void = (): void => {
    const closeButton: HTMLElement = within(
      screen.getByTestId("modal"),
    ).getByRole("button", { name: "Close" });

    act(() => {
      closeButton.focus();
    });

    expect(closeButton).toHaveFocus();
  };

  test("hands focus back to the row's ⋯ when it closes", async () => {
    render(<RowWithDialog />);

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Show ID" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Member ID")).toBeInTheDocument();
    });

    /*
     * Let the menu's deferred clean-up run while the dialog is open, as it
     * does in a browser long before anyone closes the dialog. Flushed only
     * after closing, it would refocus the trigger itself and hide the bug.
     */
    await flushFrames();
    focusInsideDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Member ID")).toBeNull();
    });
    await flushFrames();

    expect(screen.getByTestId("row-actions-more-button")).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  test("the same holds when the item is chosen from the keyboard", async () => {
    render(<RowWithDialog />);

    const menu: HTMLElement = openMenu();
    const showId: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Show ID",
    });

    fireEvent.keyDown(showId, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Member ID")).toBeInTheDocument();
    });

    /*
     * Let the menu's deferred clean-up run while the dialog is open, as it
     * does in a browser long before anyone closes the dialog. Flushed only
     * after closing, it would refocus the trigger itself and hide the bug.
     */
    await flushFrames();
    focusInsideDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Member ID")).toBeNull();
    });
    await flushFrames();

    expect(screen.getByTestId("row-actions-more-button")).toHaveFocus();
  });
});

describe("the ⋯ trigger's name", () => {
  const actions: Array<ActionButtonSchema<Member>> = [
    {
      title: "View",
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: noop,
    },
    {
      title: "Delete",
      buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
      onClick: noop,
    },
  ];

  test("names the row when the caller says what the row is", () => {
    render(
      <RowActions<Member>
        item={ADA}
        actionButtons={actions}
        itemLabel="Member: Ada Lovelace"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "More actions for Member: Ada Lovelace",
      }),
    ).toHaveAttribute("data-testid", "row-actions-more-button");
  });

  test("falls back to More actions without a label", () => {
    render(<RowActions<Member> item={ADA} actionButtons={actions} />);

    expect(
      screen.getByRole("button", { name: "More actions" }),
    ).toBeInTheDocument();
  });
});

describe("the row's one button", () => {
  /*
   * Button is w-full below md. Sitting straight in a block-level card, it
   * stretched across the whole card; in its own content-sized box it stays
   * the size of its label everywhere.
   */
  test("sits in its own content-sized box", () => {
    render(
      <RowActions<Member>
        item={ADA}
        actionButtons={[
          {
            title: "View",
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: noop,
          },
        ]}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", { name: "View" });

    expect(button.parentElement).toHaveClass("shrink-0");
    expect(button.parentElement?.parentElement).toHaveAttribute(
      "data-testid",
      "row-actions",
    );
  });
});
