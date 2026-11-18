import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import React, { ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A menu that opens again where it is drawn again (#9513).
 *
 * A table draws every row again when it changes how it fits - rows, folded,
 * cards - and a row's ⋯ menu that was open closed with it. The row's
 * actions keep whether it is open (RowActionsStore): the menu is told to
 * draw itself open (isInitiallyOpen) at its new trigger, and tells them
 * when it opens and closes (onOpenChange) - never as it is first drawn,
 * and never as it is taken away, which closes nothing for them.
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

const Menu: (props: {
  isInitiallyOpen?: boolean | undefined;
  onOpenChange?: ((isOpen: boolean) => void) | undefined;
  onArchive?: (() => void) | undefined;
}) => ReactElement = (props: {
  isInitiallyOpen?: boolean | undefined;
  onOpenChange?: ((isOpen: boolean) => void) | undefined;
  onArchive?: (() => void) | undefined;
}): ReactElement => {
  return (
    <div>
      <button type="button" data-testid="elsewhere">
        Elsewhere
      </button>
      <MoreMenu
        isMenuPortaled={true}
        isInitiallyOpen={props.isInitiallyOpen}
        onOpenChange={props.onOpenChange}
        ariaLabel="More actions for Checkout is slow"
        isAriaLabelTranslated={true}
        elementToBeShownInsteadOfButton={
          <button type="button" data-testid="menu-trigger">
            ⋯
          </button>
        }
      >
        <MoreMenuItem
          key="archive"
          text="Archive"
          icon={IconProp.Archive}
          onClick={() => {
            props.onArchive?.();
          }}
        />
        <MoreMenuItem
          key="delete"
          text="Delete"
          icon={IconProp.Trash}
          onClick={() => {}}
        />
      </MoreMenu>
    </div>
  );
};

// The menu's first item is focused once it is placed, an effect after it opens.
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

afterEach(() => {
  cleanup();
});

describe("a menu drawn open (isInitiallyOpen)", () => {
  test("is open as it is first drawn, at its trigger, which says so, with its first item focused", async () => {
    render(<Menu isInitiallyOpen={true} />);
    await settle();

    const menu: HTMLElement = screen.getByRole("menu");
    const trigger: HTMLElement = screen.getByTestId("menu-trigger");

    expect(menu).toHaveAttribute("aria-labelledby", trigger.id);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    // Placed against its trigger, and shown: never left hidden.
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.visibility).toBe("visible");
    // Where it was: no growing in from nothing.
    expect(menu.className).toContain("opacity-100");
    expect(document.activeElement).toBe(
      within(menu).getAllByRole("menuitem")[0],
    );
  });

  test("works as any open menu: an item runs and closes it, Escape closes it, its trigger closes it", async () => {
    const onArchive: Mock<() => void> = jest.fn<() => void>();
    const view: RenderResult = render(
      <Menu isInitiallyOpen={true} onArchive={onArchive} />,
    );

    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Archive",
      }),
    );

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    view.unmount();
    render(<Menu isInitiallyOpen={true} />);
    await settle();

    fireEvent.keyDown(
      within(screen.getByRole("menu")).getAllByRole("menuitem")[0]!,
      {
        key: "Escape",
      },
    );

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("menu-trigger"));

    cleanup();
    render(<Menu isInitiallyOpen={true} />);
    await settle();

    fireEvent.click(screen.getByTestId("menu-trigger"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("a press outside closes it, as it closes any open menu", async () => {
    render(<Menu isInitiallyOpen={true} />);
    await settle();

    const elsewhere: HTMLElement = screen.getByTestId("elsewhere");

    fireEvent.mouseDown(elsewhere);
    fireEvent.click(elsewhere);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("left out, a menu is drawn closed, as every menu always was", () => {
    render(<Menu />);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("menu-trigger")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("what a menu tells its holder (onOpenChange)", () => {
  test("that it opened and that it closed, once each", () => {
    const onOpenChange: Mock<(isOpen: boolean) => void> =
      jest.fn<(isOpen: boolean) => void>();

    render(<Menu onOpenChange={onOpenChange} />);

    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("menu-trigger"));

    expect(onOpenChange.mock.calls).toEqual([[true]]);

    fireEvent.keyDown(
      within(screen.getByRole("menu")).getAllByRole("menuitem")[0]!,
      {
        key: "Escape",
      },
    );

    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  test("nothing as it is first drawn open, and that it closed once it is closed", async () => {
    const onOpenChange: Mock<(isOpen: boolean) => void> =
      jest.fn<(isOpen: boolean) => void>();

    render(<Menu isInitiallyOpen={true} onOpenChange={onOpenChange} />);
    await settle();

    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Delete",
      }),
    );

    expect(onOpenChange.mock.calls).toEqual([[false]]);
  });

  test("nothing as it is taken away open: a row drawn again keeps its menu open", async () => {
    const onOpenChange: Mock<(isOpen: boolean) => void> =
      jest.fn<(isOpen: boolean) => void>();
    const view: RenderResult = render(<Menu onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByTestId("menu-trigger"));
    onOpenChange.mockClear();

    view.unmount();
    await settle();

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
