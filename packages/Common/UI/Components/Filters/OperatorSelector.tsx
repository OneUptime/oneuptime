import IconProp from "../../../Types/Icon/IconProp";
import Icon, { SizeProp } from "../Icon/Icon";
import FilterOperator, { FilterOperatorLabel } from "./Types/FilterOperator";
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface ComponentProps {
  value: FilterOperator;
  options: Array<FilterOperator>;
  onChange: (value: FilterOperator) => void;
}

/*
 * The menu is portalled to document.body so it is not clipped by the
 * scrollable modal body (`overflow-y-auto`) the filter form lives in. Modal
 * surfaces use z-50, so the menu has to sit above that stacking context —
 * same reasoning as DROPDOWN_MENU_Z_INDEX in Dropdown.tsx.
 *
 * Portalling moves the options out of the modal's focus trap (Modal.tsx only
 * collects focusable elements inside its own dialog element), so this
 * component owns the keyboard contract itself: focus moves into the menu on
 * open, arrows/Home/End walk the options, Enter/Space picks one, and Escape or
 * Tab closes and hands focus back to the trigger.
 */
const MENU_Z_INDEX: number = 60;
const MENU_MAX_HEIGHT: number = 240;
const MENU_MIN_HEIGHT: number = 120;
const MENU_WIDTH: number = 224;
const MENU_GAP: number = 4;
const VIEWPORT_MARGIN: number = 8;

interface MenuPosition {
  top?: number | undefined;
  bottom?: number | undefined;
  left: number;
  width: number;
  maxHeight: number;
}

const OperatorSelector: React.FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const triggerRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const menuRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const optionRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);

  const uniqueId: string = useId();
  const triggerId: string = `operator-selector-trigger-${uniqueId}`;
  const menuId: string = `operator-selector-menu-${uniqueId}`;

  const optionCount: number = props.options.length;

  type UpdateMenuPositionFunction = () => void;

  const updateMenuPosition: UpdateMenuPositionFunction =
    useCallback((): void => {
      const container: HTMLDivElement | null = containerRef.current;

      if (!container) {
        return;
      }

      const rect: DOMRect = container.getBoundingClientRect();
      const spaceBelow: number = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove: number = rect.top - MENU_GAP;

      const openUpwards: boolean =
        spaceBelow < Math.min(MENU_MAX_HEIGHT, MENU_MIN_HEIGHT) &&
        spaceAbove > spaceBelow;

      const availableSpace: number = openUpwards ? spaceAbove : spaceBelow;

      const maxHeight: number = Math.max(
        MENU_MIN_HEIGHT,
        Math.min(MENU_MAX_HEIGHT, availableSpace - VIEWPORT_MARGIN),
      );

      const width: number = Math.max(
        rect.width,
        Math.min(MENU_WIDTH, window.innerWidth - 2 * VIEWPORT_MARGIN),
      );

      let left: number = rect.left;

      if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
        left = window.innerWidth - VIEWPORT_MARGIN - width;
      }

      if (left < VIEWPORT_MARGIN) {
        left = VIEWPORT_MARGIN;
      }

      setMenuPosition({
        left: left,
        width: width,
        maxHeight: maxHeight,
        top: openUpwards ? undefined : rect.bottom + MENU_GAP,
        bottom: openUpwards
          ? window.innerHeight - rect.top + MENU_GAP
          : undefined,
      });
    }, []);

  type OpenMenuFunction = (indexToFocus?: number | undefined) => void;

  const openMenu: OpenMenuFunction = (
    indexToFocus?: number | undefined,
  ): void => {
    if (optionCount === 0) {
      return;
    }

    const selectedIndex: number = props.options.indexOf(props.value);

    setActiveIndex(
      indexToFocus !== undefined
        ? indexToFocus
        : selectedIndex >= 0
          ? selectedIndex
          : 0,
    );
    setIsOpen(true);
  };

  type CloseMenuFunction = (shouldRestoreFocus: boolean) => void;

  const closeMenu: CloseMenuFunction = (shouldRestoreFocus: boolean): void => {
    setIsOpen(false);
    setActiveIndex(-1);

    if (shouldRestoreFocus) {
      triggerRef.current?.focus();
    }
  };

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();

    /*
     * Any ancestor scroll (the modal body, the page) moves the trigger, so the
     * fixed-position menu has to follow it — hence the capture-phase listener.
     */
    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);

    return () => {
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [isOpen, updateMenuPosition]);

  /*
   * The menu only mounts once `menuPosition` has been measured, which is a
   * commit later than `isOpen` flipping — so the focus effect has to key off
   * "the options are on screen", not off `isOpen`, or it runs against an empty
   * optionRefs and never moves focus at all. Deliberately NOT keyed on
   * menuPosition itself: that object is replaced on every scroll and resize,
   * which would drag focus back into the menu while the user is elsewhere.
   */
  const isMenuMounted: boolean = isOpen && menuPosition !== null;

  // Roving focus: the active option is the one that actually holds DOM focus.
  useEffect(() => {
    if (!isMenuMounted || activeIndex < 0) {
      return;
    }

    optionRefs.current[activeIndex]?.focus();
  }, [isMenuMounted, activeIndex]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    type HandleClickOutsideFunction = (event: MouseEvent) => void;
    const handleClickOutside: HandleClickOutsideFunction = (
      event: MouseEvent,
    ): void => {
      const target: Node = event.target as Node;

      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        // The click itself decides where focus goes, so do not steal it back.
        closeMenu(false);
      }
    };

    /*
     * Safety net for Escape when focus has drifted out of the menu (clicking
     * the menu's padding, say). The menu handles its own keys while focused;
     * this keeps the surrounding modal from closing instead of the menu.
     */
    type HandleKeyDownFunction = (event: KeyboardEvent) => void;
    const handleKeyDown: HandleKeyDownFunction = (
      event: KeyboardEvent,
    ): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.stopPropagation();
      closeMenu(true);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  type HandleTriggerKeyDownFunction = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => void;

  const handleTriggerKeyDown: HandleTriggerKeyDownFunction = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (isOpen) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(0);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(optionCount - 1);
    }
  };

  type HandleMenuKeyDownFunction = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void;

  const handleMenuKeyDown: HandleMenuKeyDownFunction = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (optionCount === 0) {
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current: number) => {
          return (current + 1) % optionCount;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current: number) => {
          return (current - 1 + optionCount) % optionCount;
        });
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(optionCount - 1);
        break;
      case "Tab":
      case "Escape":
        /*
         * Both close the menu and hand focus back to the trigger. Stopping
         * propagation keeps the surrounding modal from also reacting — its
         * document listener closes the modal on Escape and re-traps Tab.
         */
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        break;
      default:
        break;
    }
  };

  const menu: ReactElement | null =
    isOpen && menuPosition ? (
      <div
        ref={menuRef}
        id={menuId}
        role="listbox"
        aria-labelledby={triggerId}
        data-testid="operator-selector-menu"
        tabIndex={-1}
        onKeyDown={handleMenuKeyDown}
        className="fixed bg-white rounded-md shadow-lg border border-gray-200 py-1 overflow-auto"
        style={{
          zIndex: MENU_Z_INDEX,
          left: menuPosition.left,
          width: menuPosition.width,
          maxHeight: menuPosition.maxHeight,
          ...(menuPosition.top !== undefined ? { top: menuPosition.top } : {}),
          ...(menuPosition.bottom !== undefined
            ? { bottom: menuPosition.bottom }
            : {}),
        }}
      >
        {props.options.map((option: FilterOperator, index: number) => {
          const isSelected: boolean = option === props.value;
          return (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={-1}
              ref={(element: HTMLButtonElement | null) => {
                optionRefs.current[index] = element;
              }}
              onClick={() => {
                props.onChange(option);
                closeMenu(true);
              }}
              className={
                isSelected
                  ? "w-full text-left px-3 py-2 text-sm text-indigo-700 bg-indigo-50 hover:bg-indigo-100 flex items-center justify-between focus:outline-none focus:bg-indigo-100"
                  : "w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between focus:outline-none focus:bg-gray-100"
              }
            >
              <span>{FilterOperatorLabel[option]}</span>
              {isSelected && (
                <Icon
                  icon={IconProp.Check}
                  size={SizeProp.Smaller}
                  className="text-indigo-600"
                />
              )}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="relative inline-block shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => {
          if (isOpen) {
            closeMenu(false);
            return;
          }

          openMenu();
        }}
        className="inline-flex items-center justify-between gap-1.5 h-9 px-3 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-w-[130px]"
      >
        <span className="truncate">{FilterOperatorLabel[props.value]}</span>
        <Icon
          icon={IconProp.ChevronDown}
          size={SizeProp.Smaller}
          className="text-gray-400 shrink-0"
        />
      </button>
      {menu && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : null}
    </div>
  );
};

export default OperatorSelector;
