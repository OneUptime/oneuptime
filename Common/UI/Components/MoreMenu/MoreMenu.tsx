import React, {
  forwardRef,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useState,
} from "react";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";
import Button, { ButtonStyleType } from "../Button/Button";

export interface ComponentProps {
  children: Array<ReactElement>;
  elementToBeShownInsteadOfButton?: ReactElement | undefined;
  /*
   * Classes applied to the custom-trigger wrapper (the focusable element that
   * opens the menu). Lets callers style a custom trigger — e.g. to match a
   * button group — while keeping the menu's keyboard/ARIA behavior.
   */
  triggerClassName?: string | undefined;
  menuIcon?: IconProp | undefined;
  text?: string | undefined;
  /*
   * The trigger's accessible name, separately from `text`. The default trigger
   * renders `text` as a visible label beside the icon, so an icon-only overflow
   * menu has to pass `text=""` — which would otherwise leave every one of them
   * called "More options" and tell a screen reader user nothing about which
   * thing the menu belongs to.
   */
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
  isDisabled?: boolean | undefined;
}

const isMenuItemDisabled: (item: HTMLElement) => boolean = (
  item: HTMLElement,
): boolean => {
  return (
    item.getAttribute("aria-disabled") === "true" ||
    (item instanceof HTMLButtonElement && item.disabled)
  );
};

const MoreMenu: React.ForwardRefExoticComponent<
  ComponentProps & React.RefAttributes<unknown>
> = forwardRef(
  (props: ComponentProps, componentRef: React.ForwardedRef<unknown>) => {
    const uniqueId: string = useId();
    const menuId: string = `menu-${uniqueId}`;
    const buttonId: string = `menu-button-${uniqueId}`;
    const customTrigger: ReactElement | undefined =
      props.elementToBeShownInsteadOfButton;
    const isNativeButtonTrigger: boolean = Boolean(
      customTrigger && customTrigger.type === "button",
    );
    const { ref, isComponentVisible, setIsComponentVisible } =
      useComponentOutsideClick(false);
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);

    /*
     * Menu sections and dividers are valid top-level children, so the list of
     * keyboard targets cannot be derived from props.children. Read the actual
     * rendered menuitem descendants instead; this also supports arbitrarily
     * nested sections while skipping non-action content.
     */
    const getMenuItems: () => Array<HTMLElement> =
      useCallback((): Array<HTMLElement> => {
        const menuElement: HTMLElement | null =
          ref.current as HTMLElement | null;

        if (!menuElement) {
          return [];
        }

        /*
         * Some established callers pass their own button as a menu child
         * (usually wrapped for spacing) instead of MoreMenuItem. Promote that
         * existing interactive element to a menuitem so it remains reachable
         * by roving focus and participates in delegated dismissal. Explicit
         * menuitems and anything nested inside one are left untouched.
         */
        Array.from(
          menuElement.querySelectorAll<HTMLElement>(
            'button, a[href], [role="button"]',
          ),
        ).forEach((item: HTMLElement) => {
          if (!item.closest('[role="menuitem"]')) {
            item.setAttribute("role", "menuitem");
          }
        });

        return Array.from(
          menuElement.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        ).filter((item: HTMLElement) => {
          return !isMenuItemDisabled(item);
        });
      }, [ref]);

    useImperativeHandle(componentRef, () => {
      return {
        closeDropdown() {
          setIsComponentVisible(false);
        },
        openDropdown() {
          setIsComponentVisible(true);
        },
        flipDropdown() {
          setIsComponentVisible(!isDropdownVisible);
        },
      };
    });

    const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

    useEffect(() => {
      setDropdownVisible(isComponentVisible);
      if (isComponentVisible) {
        setFocusedIndex(0);
      } else {
        setFocusedIndex(-1);
      }
    }, [isComponentVisible]);

    useEffect(() => {
      if (props.isDisabled && isComponentVisible) {
        setIsComponentVisible(false);
      }
    }, [props.isDisabled, isComponentVisible, setIsComponentVisible]);

    useEffect(() => {
      const menuItems: Array<HTMLElement> = getMenuItems();

      menuItems.forEach((item: HTMLElement, index: number) => {
        item.tabIndex = index === focusedIndex ? 0 : -1;
      });

      if (focusedIndex >= 0 && menuItems.length > 0) {
        const safeFocusedIndex: number = Math.min(
          focusedIndex,
          menuItems.length - 1,
        );

        if (safeFocusedIndex !== focusedIndex) {
          setFocusedIndex(safeFocusedIndex);
        } else {
          menuItems[safeFocusedIndex]?.focus();
        }
      }
    }, [focusedIndex, getMenuItems, isComponentVisible, props.children]);

    const restoreFocusToTrigger: () => void = useCallback((): void => {
      /*
       * Return focus after item selection (WAI-ARIA menu-button pattern).
       * Deferred to the next frame so the menu has unmounted, and only reclaimed
       * if focus fell back to <body> — so we never steal focus that the activated
       * item intentionally moved elsewhere (e.g. into a dialog it opened). Escape
       * has a separate unconditional path below; outside-click dismissal leaves
       * focus where the user clicked.
       */
      requestAnimationFrame(() => {
        const activeElement: Element | null = document.activeElement;
        if (!activeElement || activeElement === document.body) {
          document.getElementById(buttonId)?.focus();
        }
      });
    }, [buttonId]);

    const focusTrigger: () => void = useCallback((): void => {
      document.getElementById(buttonId)?.focus();
    }, [buttonId]);

    const handleKeyDown: (event: React.KeyboardEvent) => void = useCallback(
      (event: React.KeyboardEvent): void => {
        if (!isComponentVisible) {
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setIsComponentVisible(false);
          /*
           * Escape always returns focus to the menu button. Do this immediately:
           * a deferred callback can run before React unmounts the focused menu
           * item and incorrectly decide that focus should be left alone.
           */
          focusTrigger();
          return;
        }

        if (event.key === "Tab") {
          setIsComponentVisible(false);
          return;
        }

        const menuItems: Array<HTMLElement> = getMenuItems();
        const itemCount: number = menuItems.length;

        if (itemCount === 0) {
          return;
        }

        const activeElement: Element | null = document.activeElement;
        const activeIndex: number = menuItems.findIndex((item: HTMLElement) => {
          return item === activeElement || item.contains(activeElement);
        });
        const currentIndex: number =
          activeIndex >= 0
            ? activeIndex
            : focusedIndex >= 0 && focusedIndex < itemCount
              ? focusedIndex
              : 0;
        const moveFocusToItem: (index: number) => void = (
          index: number,
        ): void => {
          setFocusedIndex(index);
          /*
           * Move DOM focus in the same keyboard event as well as recording the
           * roving index. React may batch consecutive keyboard events, so the
           * next Enter/Space must target the newly selected item immediately.
           */
          menuItems[index]?.focus();
        };

        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            moveFocusToItem((currentIndex + 1) % itemCount);
            break;
          case "ArrowUp":
            event.preventDefault();
            moveFocusToItem((currentIndex - 1 + itemCount) % itemCount);
            break;
          case "Home":
            event.preventDefault();
            moveFocusToItem(0);
            break;
          case "End":
            event.preventDefault();
            moveFocusToItem(itemCount - 1);
            break;
          case "Enter":
          case " ": {
            const eventTarget: EventTarget = event.target;
            const menuItem: HTMLElement | undefined = menuItems.find(
              (item: HTMLElement) => {
                return (
                  eventTarget instanceof Node &&
                  (item === eventTarget || item.contains(eventTarget))
                );
              },
            );

            if (menuItem) {
              /*
               * Prevent the native button activation from adding a second
               * click, then use the exact focused item as the activation
               * target. Its own handler runs once and the delegated menu click
               * below closes the menu.
               */
              event.preventDefault();
              menuItem.click();
            }
            break;
          }
        }
      },
      [
        focusedIndex,
        focusTrigger,
        getMenuItems,
        isComponentVisible,
        setIsComponentVisible,
      ],
    );

    const handleMenuClick: (event: React.MouseEvent<HTMLDivElement>) => void = (
      event: React.MouseEvent<HTMLDivElement>,
    ): void => {
      const eventTarget: EventTarget = event.target;

      if (!(eventTarget instanceof Element)) {
        return;
      }

      const menuItem: Element | null = eventTarget.closest('[role="menuitem"]');

      if (
        menuItem instanceof HTMLElement &&
        event.currentTarget.contains(menuItem) &&
        !isMenuItemDisabled(menuItem) &&
        isComponentVisible
      ) {
        setIsComponentVisible(false);
        restoreFocusToTrigger();
      }
    };

    const getNativeButtonTrigger: () => ReactElement | null =
      (): ReactElement | null => {
        if (!customTrigger || !isNativeButtonTrigger) {
          return null;
        }

        const trigger: ReactElement<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        > = customTrigger as ReactElement<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        >;
        const isTriggerDisabled: boolean = Boolean(
          props.isDisabled || trigger.props.disabled,
        );

        return React.cloneElement(trigger, {
          id: buttonId,
          type: trigger.props.type || "button",
          className: [trigger.props.className, props.triggerClassName]
            .filter(Boolean)
            .join(" "),
          disabled: isTriggerDisabled,
          "aria-disabled": isTriggerDisabled,
          "aria-label":
            trigger.props["aria-label"] ||
            props.ariaLabel ||
            props.text ||
            "More options",
          "aria-haspopup": "menu",
          "aria-expanded": isComponentVisible,
          "aria-controls": isComponentVisible ? menuId : undefined,
          onClick: (event: React.MouseEvent<HTMLButtonElement>): void => {
            trigger.props.onClick?.(event);

            if (!event.defaultPrevented && !isTriggerDisabled) {
              setIsComponentVisible(!isDropdownVisible);
            }
          },
        });
      };

    return (
      <div
        className="relative inline-block text-left"
        onKeyDown={handleKeyDown}
      >
        {!props.elementToBeShownInsteadOfButton && (
          <Button
            id={buttonId}
            icon={props.menuIcon || IconProp.More}
            title={props.text || ""}
            buttonStyle={ButtonStyleType.OUTLINE}
            disabled={props.isDisabled}
            dataTestId={props.dataTestId}
            onClick={() => {
              setIsComponentVisible(!isDropdownVisible);
            }}
            ariaLabel={props.ariaLabel || props.text || "More options"}
            ariaExpanded={isComponentVisible}
            ariaHaspopup="menu"
            ariaControls={isComponentVisible ? menuId : undefined}
          />
        )}

        {getNativeButtonTrigger()}

        {props.elementToBeShownInsteadOfButton &&
          !isNativeButtonTrigger &&
          props.triggerClassName && (
            <button
              id={buttonId}
              type="button"
              className={props.triggerClassName}
              disabled={props.isDisabled}
              data-testid={props.dataTestId}
              onClick={() => {
                setIsComponentVisible(!isDropdownVisible);
              }}
              aria-label={props.ariaLabel || props.text || "More options"}
              aria-haspopup="menu"
              aria-expanded={isComponentVisible}
              aria-controls={isComponentVisible ? menuId : undefined}
            >
              {props.elementToBeShownInsteadOfButton}
            </button>
          )}

        {props.elementToBeShownInsteadOfButton &&
          !isNativeButtonTrigger &&
          !props.triggerClassName && (
            <div
              /*
               * Keep the legacy keyboard-operable wrapper for unstyled custom
               * triggers. Many callers provide a visual <div>, not an interactive
               * element, so dropping this role/tab stop would make their menu
               * mouse-only. Styled custom triggers use the native button above.
               */
              id={buttonId}
              role="button"
              tabIndex={props.isDisabled ? -1 : 0}
              data-testid={props.dataTestId}
              aria-label={props.ariaLabel || props.text || undefined}
              aria-haspopup="menu"
              aria-expanded={isComponentVisible}
              aria-controls={isComponentVisible ? menuId : undefined}
              aria-disabled={Boolean(props.isDisabled)}
              onClick={() => {
                if (!props.isDisabled) {
                  setIsComponentVisible(!isDropdownVisible);
                }
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                if (
                  !props.isDisabled &&
                  event.target === event.currentTarget &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  setIsComponentVisible(!isDropdownVisible);
                }
              }}
            >
              {props.elementToBeShownInsteadOfButton}
            </div>
          )}

        {isComponentVisible && (
          <div
            ref={ref}
            id={menuId}
            className="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-lg bg-white shadow-xl ring-1 ring-gray-200 focus:outline-none py-1"
            role="menu"
            aria-orientation="vertical"
            aria-labelledby={buttonId}
            onClick={handleMenuClick}
          >
            {props.children.map((child: ReactElement, index: number) => {
              return (
                <React.Fragment key={child.key || index}>
                  {child}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

MoreMenu.displayName = "MoreMenu";

export default MoreMenu;
