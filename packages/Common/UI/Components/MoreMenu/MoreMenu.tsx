import React, {
  forwardRef,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";
import { consumePressForAnchoredPopup } from "../../Types/LayeredDismissal";
import Button, { ButtonStyleType } from "../Button/Button";
import DROPDOWN_MENU_Z_INDEX from "../Dropdown/DropdownMenuZIndex";

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
  /*
   * Open the menu upwards, for a trigger that sits at the bottom of its
   * surface. The menu is absolutely positioned and has no flipping logic,
   * so a downward menu under a trigger a dozen pixels from the bottom of a
   * clipped container (the session replay transport inside a fullscreen
   * player) is drawn outside it and cannot be reached at all. Callers that
   * know they are at the bottom say so; everything else keeps opening down.
   */
  isOpeningUpwards?: boolean | undefined;
  /*
   * Render the open menu into document.body, `fixed` against its trigger,
   * instead of absolutely inside the trigger's wrapper. For triggers that live
   * inside a clipping container - a table row sits in an `overflow-x-auto`
   * scroller, so an absolute menu under its last row is cut off or scrolls the
   * table instead of showing. Placement follows the other portalled popups:
   * below the trigger and right-aligned to it, flipped above when there is not
   * room below, clamped to the viewport.
   */
  isMenuPortaled?: boolean | undefined;
}

// Matches the mt-2 / mb-2 gap the in-place menu keeps from its trigger.
const PORTALED_MENU_GAP_PX: number = 8;
const PORTALED_MENU_VIEWPORT_PADDING_PX: number = 8;
// w-56, for the first measurement before the menu has a width of its own.
const PORTALED_MENU_FALLBACK_WIDTH_PX: number = 224;

/*
 * Exactly one of left / right is set, and exactly one of top / bottom. Right
 * is the usual anchor: it lines the menu's right edge up with the trigger's
 * whatever width the menu turns out to have.
 */
interface PortaledMenuPosition {
  top: number | undefined;
  bottom: number | undefined;
  left: number | undefined;
  right: number | undefined;
  isAbove: boolean;
}

/*
 * A fullscreen element hides everything outside it, so a menu opened from
 * inside one has to be portalled into it rather than into the body.
 */
const getMenuPortalTarget: () => HTMLElement | null =
  (): HTMLElement | null => {
    if (typeof document === "undefined") {
      return null;
    }

    const fullscreenElement: Element | null = document.fullscreenElement;

    return fullscreenElement instanceof HTMLElement
      ? fullscreenElement
      : document.body;
  };

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
    const isMenuPortaled: boolean = Boolean(props.isMenuPortaled);
    const [portaledMenuPosition, setPortaledMenuPosition] =
      useState<PortaledMenuPosition | null>(null);

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

    /*
     * The menu is mounted in its closed state (faded, slightly shrunk towards
     * origin-top-right) and flipped open one frame later so the browser has
     * something to transition from — the same pattern Modal uses.
     */
    const [hasMenuEntered, setHasMenuEntered] = useState<boolean>(false);

    useEffect(() => {
      setDropdownVisible(isComponentVisible);
      if (isComponentVisible) {
        setFocusedIndex(0);
      } else {
        setFocusedIndex(-1);
      }
    }, [isComponentVisible]);

    useEffect(() => {
      if (!isComponentVisible) {
        setHasMenuEntered(false);
        return undefined;
      }

      const open: () => void = (): void => {
        setHasMenuEntered(true);
      };

      const frame: number = requestAnimationFrame(open);

      /*
       * A hidden or throttled tab never runs an animation frame; the timer
       * skips the transition rather than leaving the menu at zero opacity.
       */
      const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(open, 80);

      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(fallbackTimer);
      };
    }, [isComponentVisible]);

    useEffect(() => {
      if (props.isDisabled && isComponentVisible) {
        setIsComponentVisible(false);
      }
    }, [props.isDisabled, isComponentVisible, setIsComponentVisible]);

    const updatePortaledMenuPosition: () => void = useCallback((): void => {
      if (typeof window === "undefined") {
        return;
      }

      const trigger: HTMLElement | null = document.getElementById(buttonId);

      if (!trigger) {
        return;
      }

      const menuElement: HTMLElement | null = ref.current as HTMLElement | null;
      const triggerRect: DOMRect = trigger.getBoundingClientRect();
      const menuWidth: number =
        menuElement?.offsetWidth || PORTALED_MENU_FALLBACK_WIDTH_PX;
      const menuHeight: number = menuElement?.offsetHeight || 0;

      /*
       * `right` on a fixed element is measured from the edge of the layout
       * viewport, which stops short of a classic vertical scrollbar - so the
       * width that matters is clientWidth, not innerWidth.
       */
      const viewportWidth: number =
        document.documentElement.clientWidth || window.innerWidth;

      /*
       * Right edge to right edge, like the in-place menu's `right-0`, and
       * anchored by that right edge rather than by a left computed from the
       * menu's width. The width is not settled at first measurement: the
       * Tailwind runtime the dashboards load generates the rule for a class
       * the page has not used yet a moment AFTER the element carrying it
       * mounts, so the first width read is the unstyled one. A left-anchored
       * menu then grew rightwards off the screen; a right-anchored one just
       * grows leftwards into place.
       */
      const isOverflowingLeft: boolean =
        triggerRect.right - menuWidth < PORTALED_MENU_VIEWPORT_PADDING_PX;

      const right: number | undefined = isOverflowingLeft
        ? undefined
        : Math.max(
            viewportWidth - triggerRect.right,
            PORTALED_MENU_VIEWPORT_PADDING_PX,
          );
      /*
       * Without room to hang leftwards - a trigger near the left edge, as on
       * the mobile cards - the menu hangs rightwards from the trigger's own
       * left edge instead, still kept inside the viewport.
       */
      const left: number | undefined = isOverflowingLeft
        ? Math.max(
            Math.min(
              triggerRect.left,
              viewportWidth - PORTALED_MENU_VIEWPORT_PADDING_PX - menuWidth,
            ),
            PORTALED_MENU_VIEWPORT_PADDING_PX,
          )
        : undefined;

      const spaceBelow: number =
        window.innerHeight -
        triggerRect.bottom -
        PORTALED_MENU_GAP_PX -
        PORTALED_MENU_VIEWPORT_PADDING_PX;
      const spaceAbove: number =
        triggerRect.top -
        PORTALED_MENU_GAP_PX -
        PORTALED_MENU_VIEWPORT_PADDING_PX;
      const isAbove: boolean = props.isOpeningUpwards
        ? spaceAbove >= menuHeight || spaceAbove > spaceBelow
        : menuHeight > spaceBelow && spaceAbove > spaceBelow;

      setPortaledMenuPosition({
        top: isAbove ? undefined : triggerRect.bottom + PORTALED_MENU_GAP_PX,
        bottom: isAbove
          ? window.innerHeight - triggerRect.top + PORTALED_MENU_GAP_PX
          : undefined,
        left,
        right,
        isAbove,
      });
    }, [buttonId, props.isOpeningUpwards, ref]);

    /*
     * Measured before paint, so the menu never flashes at the corner of the
     * viewport; until then it is mounted `visibility: hidden`. Repositioned on
     * every scroll (captured, because the table's own scroller does not bubble
     * one to window) so it stays attached to its trigger.
     */
    useLayoutEffect(() => {
      if (!isMenuPortaled || !isComponentVisible) {
        setPortaledMenuPosition(null);
        return undefined;
      }

      let animationFrame: number | null = null;

      const schedulePositionUpdate: () => void = (): void => {
        if (animationFrame !== null) {
          return;
        }

        animationFrame = window.requestAnimationFrame((): void => {
          animationFrame = null;
          updatePortaledMenuPosition();
        });
      };

      updatePortaledMenuPosition();

      window.addEventListener("resize", schedulePositionUpdate);
      document.addEventListener("scroll", schedulePositionUpdate, true);

      /*
       * The menu's own size decides whether it fits below its trigger, and
       * that size can change after it opens - its styles arriving late (see
       * updatePortaledMenuPosition), or its items changing. Place it again
       * whenever it does.
       */
      const menuElement: HTMLElement | null = ref.current as HTMLElement | null;
      const resizeObserver: ResizeObserver | null =
        menuElement && typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(schedulePositionUpdate)
          : null;

      if (menuElement && resizeObserver) {
        resizeObserver.observe(menuElement);
      }

      return () => {
        window.removeEventListener("resize", schedulePositionUpdate);
        document.removeEventListener("scroll", schedulePositionUpdate, true);
        resizeObserver?.disconnect();
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }
      };
    }, [isMenuPortaled, isComponentVisible, ref, updatePortaledMenuPosition]);

    /*
     * A portalled menu is not inside the Modal it was opened from, so a press
     * outside it could also read as a press on that Modal's backdrop. The press
     * is spent on closing the menu; claim it so the dialog behind survives.
     */
    useEffect(() => {
      if (!isMenuPortaled || !isComponentVisible) {
        return undefined;
      }

      const handlePointerDown: (event: MouseEvent) => void = (
        event: MouseEvent,
      ): void => {
        const target: EventTarget | null = event.target;

        if (!(target instanceof Node)) {
          return;
        }

        const menuElement: HTMLElement | null =
          ref.current as HTMLElement | null;

        if (
          menuElement?.contains(target) ||
          document.getElementById(buttonId)?.contains(target)
        ) {
          return;
        }

        consumePressForAnchoredPopup(event);
      };

      document.addEventListener("mousedown", handlePointerDown, true);

      return () => {
        document.removeEventListener("mousedown", handlePointerDown, true);
      };
    }, [buttonId, isMenuPortaled, isComponentVisible, ref]);

    /*
     * A portalled menu is `visibility: hidden` until it has been measured, and
     * a hidden element refuses focus - so the first item is focused once the
     * menu has a position, not merely once it is open.
     */
    const isMenuPlaced: boolean =
      !isMenuPortaled || portaledMenuPosition !== null;

    useEffect(() => {
      const menuItems: Array<HTMLElement> = getMenuItems();

      menuItems.forEach((item: HTMLElement, index: number) => {
        item.tabIndex = index === focusedIndex ? 0 : -1;
      });

      if (!isMenuPlaced) {
        return;
      }

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
    }, [
      focusedIndex,
      getMenuItems,
      isComponentVisible,
      isMenuPlaced,
      props.children,
    ]);

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

          /*
           * A portalled menu sits at the end of the body, so the browser's own
           * Tab would carry focus from it to whatever follows the body - out
           * of the table, and out of any dialog it is in. Hand focus back to
           * the trigger first and let the same Tab move on from there.
           */
          if (isMenuPortaled) {
            focusTrigger();
          }
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
        isMenuPortaled,
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

    const isMenuAbove: boolean = isMenuPortaled
      ? Boolean(portaledMenuPosition?.isAbove)
      : Boolean(props.isOpeningUpwards);

    const menuPortalTarget: HTMLElement | null = isMenuPortaled
      ? getMenuPortalTarget()
      : null;

    const menu: ReactElement = (
      <div
        ref={ref}
        id={menuId}
        /*
         * Once settled the menu carries no transform class at all: a
         * lingering scale would make it the containing block for any
         * position:fixed descendant (the Modal invariant).
         */
        className={`${
          /*
           * The portalled menu takes its place and layer from the inline
           * style below instead.
           */
          isMenuPortaled
            ? "w-56 rounded-lg"
            : "absolute right-0 z-50 w-56 rounded-lg"
        } bg-white text-left shadow-xl ring-1 ring-gray-200 focus:outline-none py-1 transition duration-150 ease-out motion-reduce:transition-none ${
          isMenuAbove
            ? `${isMenuPortaled ? "" : "bottom-full mb-2 "}origin-bottom-right`
            : `${isMenuPortaled ? "" : "mt-2 "}origin-top-right`
        } ${hasMenuEntered ? "opacity-100" : "opacity-0 scale-95"}`}
        style={
          isMenuPortaled
            ? {
                position: "fixed",
                top: portaledMenuPosition?.top,
                bottom: portaledMenuPosition?.bottom,
                left: portaledMenuPosition
                  ? portaledMenuPosition.left
                  : 0,
                right: portaledMenuPosition?.right,
                zIndex: DROPDOWN_MENU_Z_INDEX,
                visibility: portaledMenuPosition ? "visible" : "hidden",
              }
            : undefined
        }
        role="menu"
        aria-orientation="vertical"
        aria-labelledby={buttonId}
        onClick={handleMenuClick}
      >
        {props.children.map((child: ReactElement, index: number) => {
          return (
            <React.Fragment key={child.key || index}>{child}</React.Fragment>
          );
        })}
      </div>
    );

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

        {isComponentVisible && !isMenuPortaled && menu}
        {isComponentVisible &&
          isMenuPortaled &&
          menuPortalTarget &&
          createPortal(menu, menuPortalTarget)}
      </div>
    );
  },
);

MoreMenu.displayName = "MoreMenu";

export default MoreMenu;
