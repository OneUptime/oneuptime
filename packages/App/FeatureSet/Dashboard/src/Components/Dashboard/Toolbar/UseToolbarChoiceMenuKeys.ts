import { RefObject, useEffect } from "react";

/*
 * The keys of a dashboard toolbar's menu of choices - the auto-refresh menu
 * while viewing, and the editing row's Default time range and Default
 * auto-refresh (issue #5080) - as the product's other menus answer them
 * (Common/UI/Components/MoreMenu):
 *
 *   - opening moves the focus to the choice in use, else the first one;
 *   - Arrow Down / Arrow Up move between the choices, wrapping round, and
 *     Home / End go to the first and the last;
 *   - Escape closes the menu and hands the focus back to its button;
 *   - Tab closes it, from its button, so the next Tab stop is the one after
 *     the menu rather than the choice below.
 *
 * The choices are role="menuitemradio" buttons with tabIndex -1: the menu is
 * one Tab stop, its button. A mouse that opens the menu moves the focus too,
 * but the browser shows no ring for it (:focus-visible), so nothing changes
 * for the mouse.
 */

export const TOOLBAR_CHOICE_SELECTOR: string = '[role="menuitemradio"]';

const getChoices: (menu: HTMLElement | null) => Array<HTMLElement> = (
  menu: HTMLElement | null,
): Array<HTMLElement> => {
  if (!menu) {
    return [];
  }

  return Array.from(
    menu.querySelectorAll<HTMLElement>(TOOLBAR_CHOICE_SELECTOR),
  );
};

const useToolbarChoiceMenuKeys: (data: {
  isOpen: boolean;
  menuRef: RefObject<HTMLElement>;
  buttonRef: RefObject<HTMLElement>;
  close: () => void;
}) => void = (data: {
  isOpen: boolean;
  menuRef: RefObject<HTMLElement>;
  buttonRef: RefObject<HTMLElement>;
  close: () => void;
}): void => {
  const { isOpen, menuRef, buttonRef, close } = data;

  // The choice in use, else the first, once the menu is there.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const choices: Array<HTMLElement> = getChoices(menuRef.current);
    const inUse: HTMLElement | undefined = choices.find(
      (choice: HTMLElement): boolean => {
        return choice.getAttribute("aria-checked") === "true";
      },
    );

    (inUse || choices[0])?.focus();
  }, [isOpen, menuRef]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        buttonRef.current?.focus();
        return;
      }

      const menu: HTMLElement | null = menuRef.current;
      const active: Element | null = document.activeElement;

      // The rest are the menu's own: only while the focus is in it.
      if (!menu || !active || !menu.contains(active)) {
        return;
      }

      if (event.key === "Tab") {
        /*
         * From the button, so the browser's own Tab moves on from there -
         * past the choices, which are no Tab stops.
         */
        buttonRef.current?.focus();
        close();
        return;
      }

      const choices: Array<HTMLElement> = getChoices(menu);

      if (choices.length === 0) {
        return;
      }

      const index: number = choices.findIndex(
        (choice: HTMLElement): boolean => {
          return choice === active || choice.contains(active);
        },
      );

      let next: number | null = null;

      if (event.key === "ArrowDown") {
        next = index < 0 ? 0 : (index + 1) % choices.length;
      } else if (event.key === "ArrowUp") {
        next =
          index < 0
            ? choices.length - 1
            : (index - 1 + choices.length) % choices.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = choices.length - 1;
      }

      if (next !== null) {
        event.preventDefault();
        choices[next]?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, menuRef, buttonRef, close]);
};

export default useToolbarChoiceMenuKeys;
