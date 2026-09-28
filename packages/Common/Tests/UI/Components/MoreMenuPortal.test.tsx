import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import Modal from "../../../UI/Components/Modal/Modal";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import DROPDOWN_MENU_Z_INDEX from "../../../UI/Components/Dropdown/DropdownMenuZIndex";
import { wasPressConsumedByAnAnchoredPopup } from "../../../UI/Types/LayeredDismissal";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { ReactElement } from "react";

/*
 * MoreMenu's portalled mode, which every table row's ⋯ menu uses.
 *
 * A table sits in an `overflow-x-auto` scroller, so an absolutely positioned
 * menu under one of its last rows is clipped, or scrolls the table instead of
 * appearing. The portalled menu is drawn at the end of the body and placed
 * `fixed` against its trigger. These tests pin down that placement - below and
 * right-aligned, flipped above near the bottom of the screen, never off either
 * edge - and that leaving the row's DOM subtree does not cost the menu its
 * behaviour inside a Modal.
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

const VIEWPORT_WIDTH: number = 1280;
const VIEWPORT_HEIGHT: number = 800;
const MENU_WIDTH: number = 224;
const MENU_HEIGHT: number = 120;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

let triggerRect: Rect = { top: 100, left: 1100, width: 34, height: 30 };

const originalGetBoundingClientRect: () => DOMRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalOffsetWidth: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const originalOffsetHeight: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalInnerWidth: number = window.innerWidth;
const originalInnerHeight: number = window.innerHeight;

type ToDomRectFunction = (rect: Rect) => DOMRect;

const toDomRect: ToDomRectFunction = (rect: Rect): DOMRect => {
  return {
    x: rect.left,
    y: rect.top,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => {
      return rect;
    },
  } as DOMRect;
};

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: VIEWPORT_WIDTH,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  });

  /*
   * jsdom does no layout: every element measures 0x0 at the origin. Give the
   * trigger the rect the test says it has, and the menu the size a w-56 menu
   * of a few items would have.
   */
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("aria-haspopup") === "menu") {
      return toDomRect(triggerRect);
    }

    return originalGetBoundingClientRect.call(this);
  };

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("role") === "menu" ? MENU_WIDTH : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("role") === "menu" ? MENU_HEIGHT : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth,
    );
  }
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      originalOffsetHeight,
    );
  }
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalInnerHeight,
  });
  triggerRect = { top: 100, left: 1100, width: 34, height: 30 };
  jest.useRealTimers();
});

type RenderMenuFunction = (options?: {
  isMenuPortaled?: boolean;
  isOpeningUpwards?: boolean;
  onSelect?: () => void;
}) => void;

const renderMenu: RenderMenuFunction = (options?: {
  isMenuPortaled?: boolean;
  isOpeningUpwards?: boolean;
  onSelect?: () => void;
}): void => {
  render(
    <div data-testid="scroller" style={{ overflowX: "auto" }}>
      <MoreMenu
        isMenuPortaled={options?.isMenuPortaled ?? true}
        isOpeningUpwards={options?.isOpeningUpwards}
        ariaLabel="Row actions"
        elementToBeShownInsteadOfButton={
          <button type="button" data-testid="trigger">
            ⋯
          </button>
        }
      >
        <MoreMenuItem
          text="Edit"
          onClick={
            options?.onSelect ||
            (() => {
              return undefined;
            })
          }
        />
        <MoreMenuItem
          text="Delete"
          isDestructive={true}
          onClick={() => {
            return undefined;
          }}
        />
      </MoreMenu>
    </div>,
  );
};

const openMenu: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(screen.getByTestId("trigger"));
  return screen.getByRole("menu");
};

describe("MoreMenu, portalled", () => {
  describe("where the menu goes", () => {
    test("into the document body, not inside the trigger's scroller", () => {
      renderMenu();

      const menu: HTMLElement = openMenu();

      expect(menu.parentElement).toBe(document.body);
      expect(screen.getByTestId("scroller")).not.toContainElement(menu);
    });

    test("above modals, on the layer every portalled menu shares", () => {
      renderMenu();

      const menu: HTMLElement = openMenu();

      expect(menu.style.position).toBe("fixed");
      expect(menu.style.zIndex).toBe(String(DROPDOWN_MENU_Z_INDEX));
      expect(menu).not.toHaveClass("absolute");
    });

    test("into the fullscreen element when one is showing", () => {
      const fullscreenHost: HTMLDivElement = document.createElement("div");
      document.body.appendChild(fullscreenHost);
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        get: () => {
          return fullscreenHost;
        },
      });

      try {
        renderMenu();

        expect(openMenu().parentElement).toBe(fullscreenHost);
      } finally {
        delete (document as unknown as Record<string, unknown>)[
          "fullscreenElement"
        ];
        fullscreenHost.remove();
      }
    });

    test("the in-place menu is unchanged when not portalled", () => {
      renderMenu({ isMenuPortaled: false });

      const menu: HTMLElement = openMenu();

      expect(screen.getByTestId("scroller")).toContainElement(menu);
      expect(menu).toHaveClass("absolute", "right-0", "z-50", "mt-2");
      expect(menu.style.position).toBe("");
    });
  });

  describe("placement", () => {
    test("opens below the trigger, right edges aligned", () => {
      triggerRect = { top: 100, left: 1100, width: 34, height: 30 };

      renderMenu();

      const menu: HTMLElement = openMenu();

      // 8px under the trigger's bottom edge (100 + 30).
      expect(menu.style.top).toBe("138px");
      expect(menu.style.bottom).toBe("");
      // Right edge of the menu on the trigger's right edge (1280 - 1134).
      expect(menu.style.right).toBe("146px");
      expect(menu.style.left).toBe("");
      expect(menu.style.visibility).toBe("visible");
      expect(menu).toHaveClass("origin-top-right");
    });

    test("flips above the trigger when the last row is near the bottom of the screen", () => {
      triggerRect = { top: 740, left: 1100, width: 34, height: 30 };

      renderMenu();

      const menu: HTMLElement = openMenu();

      // Anchored by its bottom edge, 8px above the trigger's top (800 - 740).
      expect(menu.style.bottom).toBe("68px");
      expect(menu.style.top).toBe("");
      expect(menu).toHaveClass("origin-bottom-right");
    });

    test("stays below when there is no more room above than below", () => {
      triggerRect = { top: 40, left: 1100, width: 34, height: 30 };
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 150,
      });

      renderMenu();

      const menu: HTMLElement = openMenu();

      expect(menu.style.top).toBe("78px");
      expect(menu.style.bottom).toBe("");
    });

    test("hangs rightwards from the trigger when there is no room to its left", () => {
      triggerRect = { top: 100, left: 20, width: 34, height: 30 };

      renderMenu();

      const menu: HTMLElement = openMenu();

      expect(menu.style.left).toBe("20px");
      expect(menu.style.right).toBe("");
    });

    test("never starts closer than 8px to the left edge", () => {
      triggerRect = { top: 100, left: 2, width: 34, height: 30 };

      renderMenu();

      expect(openMenu().style.left).toBe("8px");
    });

    test("on a narrow screen, hangs rightwards but stops at the right edge", () => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 300,
      });
      triggerRect = { top: 100, left: 150, width: 34, height: 30 };

      renderMenu();

      // 184 - 224 overflows the left, and 150 + 224 the right: 300 - 8 - 224.
      expect(openMenu().style.left).toBe("68px");
    });

    test("is kept on screen when the trigger runs past the right edge", () => {
      triggerRect = { top: 100, left: 1270, width: 34, height: 30 };

      renderMenu();

      // Pulled back to the 8px padding rather than hanging off the edge.
      expect(openMenu().style.right).toBe("8px");
    });

    test("isOpeningUpwards opens above whenever there is room", () => {
      triggerRect = { top: 400, left: 1100, width: 34, height: 30 };

      renderMenu({ isOpeningUpwards: true });

      const menu: HTMLElement = openMenu();

      expect(menu.style.bottom).toBe("408px");
      expect(menu.style.top).toBe("");
    });

    test("follows its trigger when the table scrolls", () => {
      jest.useFakeTimers();

      triggerRect = { top: 100, left: 1100, width: 34, height: 30 };

      renderMenu();

      const menu: HTMLElement = openMenu();

      expect(menu.style.top).toBe("138px");

      triggerRect = { top: 60, left: 1000, width: 34, height: 30 };

      act(() => {
        fireEvent.scroll(screen.getByTestId("scroller"));
        jest.advanceTimersByTime(50);
      });

      expect(menu.style.top).toBe("98px");
      expect(menu.style.right).toBe("246px");
    });

    test("follows its trigger when the window is resized", () => {
      jest.useFakeTimers();

      renderMenu();

      const menu: HTMLElement = openMenu();

      triggerRect = { top: 200, left: 700, width: 34, height: 30 };

      act(() => {
        fireEvent(window, new Event("resize"));
        jest.advanceTimersByTime(50);
      });

      expect(menu.style.top).toBe("238px");
      expect(menu.style.right).toBe("546px");
    });
  });

  describe("dismissal", () => {
    test("a press outside closes the menu and is claimed so a dialog behind survives", () => {
      renderMenu();

      openMenu();

      const outside: HTMLElement = screen.getByTestId("scroller");
      const pressEvent: MouseEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });

      act(() => {
        outside.dispatchEvent(pressEvent);
      });

      expect(wasPressConsumedByAnAnchoredPopup(pressEvent)).toBe(true);

      fireEvent.click(outside);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    test("a press inside the menu is not claimed", () => {
      renderMenu();

      const menu: HTMLElement = openMenu();
      const pressEvent: MouseEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });

      act(() => {
        within(menu)
          .getByRole("menuitem", { name: "Edit" })
          .dispatchEvent(pressEvent);
      });

      expect(wasPressConsumedByAnAnchoredPopup(pressEvent)).toBe(false);
    });

    test("a press on the trigger is left to the trigger's own toggle", () => {
      renderMenu();

      openMenu();

      const pressEvent: MouseEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });

      act(() => {
        screen.getByTestId("trigger").dispatchEvent(pressEvent);
      });

      expect(wasPressConsumedByAnAnchoredPopup(pressEvent)).toBe(false);
    });

    test("nothing is claimed once the menu is closed", () => {
      renderMenu();

      openMenu();
      fireEvent.click(screen.getByTestId("trigger"));

      expect(screen.queryByRole("menu")).toBeNull();

      const pressEvent: MouseEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });

      act(() => {
        screen.getByTestId("scroller").dispatchEvent(pressEvent);
      });

      expect(wasPressConsumedByAnAnchoredPopup(pressEvent)).toBe(false);
    });

    test("selecting an item runs it and closes the menu", () => {
      const onSelect: jest.Mock<() => void> = jest.fn<() => void>();

      renderMenu({ onSelect });

      fireEvent.click(
        within(openMenu()).getByRole("menuitem", { name: "Edit" }),
      );

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  /*
   * Tables are rendered inside modals too (pickers, "add members" lists). A
   * portalled menu is outside the Modal's panel in the DOM, which is exactly
   * the situation Modal's dismissal rules have to get right.
   */
  describe("inside a Modal", () => {
    type RenderRowInModalFunction = () => {
      onClose: jest.Mock<() => void>;
      onRemove: jest.Mock<() => void>;
    };

    const renderRowInModal: RenderRowInModalFunction = (): {
      onClose: jest.Mock<() => void>;
      onRemove: jest.Mock<() => void>;
    } => {
      const onClose: jest.Mock<() => void> = jest.fn<() => void>();
      const onRemove: jest.Mock<() => void> = jest.fn<() => void>();

      const Harness: () => ReactElement = (): ReactElement => {
        return (
          <Modal title="Team members" onClose={onClose}>
            <RowActions<{ id: string }>
              item={{ id: "ada" }}
              actionButtons={[
                {
                  title: "View User",
                  buttonStyleType: ButtonStyleType.NORMAL,
                  onClick: () => {
                    return undefined;
                  },
                },
                {
                  title: "Remove from Team",
                  buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
                  onClick: () => {
                    onRemove();
                  },
                },
              ]}
            />
          </Modal>
        );
      };

      render(<Harness />);

      return { onClose, onRemove };
    };

    const press: (element: HTMLElement) => void = (
      element: HTMLElement,
    ): void => {
      fireEvent.mouseDown(element);
      fireEvent.mouseUp(element);
      fireEvent.click(element);
    };

    test("picking a menu item runs it and leaves the dialog open", () => {
      const { onClose, onRemove } = renderRowInModal();

      fireEvent.click(screen.getByTestId("row-actions-more-button"));
      press(
        within(screen.getByRole("menu")).getByRole("menuitem", {
          name: "Remove from Team",
        }),
      );

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    test("Escape closes the menu, not the dialog", () => {
      const { onClose } = renderRowInModal();

      fireEvent.click(screen.getByTestId("row-actions-more-button"));

      const item: HTMLElement = within(screen.getByRole("menu")).getByRole(
        "menuitem",
        { name: "Remove from Team" },
      );

      fireEvent.keyDown(item, { key: "Escape" });

      expect(screen.queryByRole("menu")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    test("pressing the backdrop with the menu open only closes the menu", () => {
      const { onClose } = renderRowInModal();

      fireEvent.click(screen.getByTestId("row-actions-more-button"));

      press(screen.getByTestId("modal").parentElement!);

      expect(screen.queryByRole("menu")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
