import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface ComponentProps {
  value?: string;
  onChange?: ((value: string) => void) | undefined;
  suggestions?: Array<string> | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
  menuClassName?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  dataTestId?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  outerDivClassName?: string | undefined;
  disableSpellCheck?: boolean | undefined;
  isLoadingSuggestions?: boolean | undefined;
  loadingMessage?: string | undefined;
  noSuggestionsMessage?: string | undefined;
}

const BASE_INPUT_CLASS: string =
  "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";

/*
 * Aligned with the server-side attribute-value limit (ATTRIBUTE_VALUES_LIMIT)
 * so that when suggestions are fetched server-side (and already narrowed by
 * search text), the dropdown can show the full returned set rather than
 * truncating it further on the client.
 */
const MAX_SUGGESTIONS: number = 100;

/*
 * Modal surfaces sit at z-50 (see Modal.tsx), and react-select portals its menu
 * at DROPDOWN_MENU_Z_INDEX (60). The suggestion list matches the latter so it
 * draws above a modal without fighting other portalled menus.
 */
export const SUGGESTIONS_MENU_Z_INDEX: number = 60;

// Tailwind's max-h-56 — the tallest the menu is allowed to grow.
export const SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX: number = 224;

// Gap between the input and the menu, matching the old `mt-1`.
const MENU_OFFSET_IN_PX: number = 4;

// Smallest gap the menu keeps from the viewport edges.
const VIEWPORT_PADDING_IN_PX: number = 8;

export interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "below" | "above";
}

/*
 * The menu used to be `absolute` inside the input's `relative` wrapper, which
 * meant any ancestor with `overflow: auto` clipped it. The "Filter <Resource>"
 * modal body is exactly that (`overflow-y-auto` in Modal.tsx), so opening the
 * JSON/attributes key input near the bottom of a scrolled modal showed only a
 * sliver of the list and made suggestions unpickable. The menu is now portalled
 * to document.body and positioned `fixed` from the trigger's viewport rect.
 */
export function getMenuPosition(
  triggerRect: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
): MenuPosition {
  const spaceBelow: number =
    viewportHeight - triggerRect.bottom - MENU_OFFSET_IN_PX;
  const spaceAbove: number = triggerRect.top - MENU_OFFSET_IN_PX;

  /*
   * Prefer opening downwards. Flip up only when below is too cramped to be
   * usable *and* above genuinely has more room, so the menu does not jump
   * around for a few pixels of difference.
   */
  const shouldFlipUp: boolean =
    spaceBelow < SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX && spaceAbove > spaceBelow;

  const availableHeight: number = shouldFlipUp ? spaceAbove : spaceBelow;
  const maxHeight: number = Math.max(
    0,
    Math.min(
      SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX,
      availableHeight - VIEWPORT_PADDING_IN_PX,
    ),
  );

  // Never wider than the viewport allows, even when the input itself is.
  const width: number = Math.min(
    triggerRect.width,
    Math.max(0, viewportWidth - VIEWPORT_PADDING_IN_PX * 2),
  );

  const maximumLeft: number = viewportWidth - width - VIEWPORT_PADDING_IN_PX;
  const left: number = Math.max(
    VIEWPORT_PADDING_IN_PX,
    Math.min(triggerRect.left, Math.max(VIEWPORT_PADDING_IN_PX, maximumLeft)),
  );

  const top: number = shouldFlipUp
    ? Math.max(
        VIEWPORT_PADDING_IN_PX,
        triggerRect.top - MENU_OFFSET_IN_PX - maxHeight,
      )
    : triggerRect.bottom + MENU_OFFSET_IN_PX;

  return {
    top: top,
    left: left,
    width: width,
    maxHeight: maxHeight,
    placement: shouldFlipUp ? "above" : "below",
  };
}

// Provides a free-form text input with an optional suggestion dropdown.
const AutocompleteTextInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [inputValue, setInputValue] = useState<string>(props.value || "");
  const [isMenuVisible, setIsMenuVisible] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const menuRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const blurTimeoutRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  const listboxIdRef: React.MutableRefObject<string> = useRef<string>(
    `autocomplete-suggestions-${Math.random().toString(36).slice(2, 10)}`,
  );

  useEffect(() => {
    setInputValue(props.value || "");
  }, [props.value]);

  useEffect(() => {
    const handleClickOutside: (event: MouseEvent) => void = (
      event: MouseEvent,
    ) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      /*
       * The menu is portalled out of `containerRef`, so a click on a suggestion
       * is "outside" the container as far as the DOM is concerned. Check the
       * menu too, otherwise the list closes before the click lands on it.
       */
      const isInsideContainer: boolean = Boolean(
        containerRef.current?.contains(event.target),
      );
      const isInsideMenu: boolean = Boolean(
        menuRef.current?.contains(event.target),
      );

      if (!isInsideContainer && !isInsideMenu) {
        setIsMenuVisible(false);
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const suggestions: Array<string> = useMemo(() => {
    const uniqueSuggestions: Array<string> = props.suggestions
      ? Array.from(new Set(props.suggestions))
      : [];

    if (uniqueSuggestions.length === 0) {
      return [];
    }

    const normalizedInput: string = inputValue.trim().toLowerCase();

    if (normalizedInput === "") {
      return uniqueSuggestions.slice(0, MAX_SUGGESTIONS);
    }

    return uniqueSuggestions
      .filter((suggestion: string) => {
        return suggestion.toLowerCase().includes(normalizedInput);
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [inputValue, props.suggestions]);

  const isLoadingSuggestions: boolean = Boolean(props.isLoadingSuggestions);
  const showMenu: boolean =
    isMenuVisible && (suggestions.length > 0 || isLoadingSuggestions);

  const updateMenuPosition: () => void = useCallback((): void => {
    const container: HTMLDivElement | null = containerRef.current;

    if (!container) {
      return;
    }

    setMenuPosition(
      getMenuPosition(
        container.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, []);

  /*
   * Measure before paint so the menu never renders at a stale position, then
   * keep it glued to the input: capture-phase scroll catches scrolling in the
   * modal body (and any other ancestor), which does not bubble to window.
   */
  useLayoutEffect(() => {
    if (!showMenu) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();

    const handleLayoutChange: () => void = (): void => {
      updateMenuPosition();
    };

    window.addEventListener("scroll", handleLayoutChange, true);
    window.addEventListener("resize", handleLayoutChange);

    return () => {
      window.removeEventListener("scroll", handleLayoutChange, true);
      window.removeEventListener("resize", handleLayoutChange);
    };
  }, [showMenu, updateMenuPosition]);

  const getInputClassName: () => string = (): string => {
    let className: string = props.className || BASE_INPUT_CLASS;

    if (props.disabled) {
      className += " bg-gray-100 text-gray-500 cursor-not-allowed";
    }

    return className;
  };

  const clearBlurTimeout: () => void = (): void => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const handleSuggestionSelect: (value: string) => void = (value: string) => {
    clearBlurTimeout();
    setInputValue(value);
    props.onChange?.(value);
    setIsMenuVisible(false);
    setHighlightedIndex(-1);
  };

  const handleInputChange: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value: string = event.target.value;
    setInputValue(value);
    props.onChange?.(value);
    setIsMenuVisible(true);
    setHighlightedIndex(-1);
  };

  const handleInputFocus: () => void = () => {
    clearBlurTimeout();
    setIsMenuVisible(true);
    props.onFocus?.();
  };

  const handleInputBlur: () => void = () => {
    clearBlurTimeout();
    blurTimeoutRef.current = window.setTimeout(() => {
      setIsMenuVisible(false);
      setHighlightedIndex(-1);
      props.onBlur?.();
    }, 150);
  };

  const handleKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void = (event: React.KeyboardEvent<HTMLInputElement>) => {
    /*
     * Escape closes the list even when there is nothing to pick (the loading
     * row counts as an open menu). Marking the event handled stops Modal's
     * document-level listener from closing the whole dialog behind the menu.
     */
    if (event.key === "Escape" && showMenu) {
      event.preventDefault();
      setIsMenuVisible(false);
      setHighlightedIndex(-1);
      return;
    }

    if (!showMenu || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((previousIndex: number) => {
        const nextIndex: number = previousIndex + 1;
        if (nextIndex >= suggestions.length) {
          return 0;
        }
        return nextIndex;
      });
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((previousIndex: number) => {
        if (previousIndex <= 0) {
          return suggestions.length - 1;
        }
        return previousIndex - 1;
      });
    }

    if (event.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        event.preventDefault();
        handleSuggestionSelect(suggestions[highlightedIndex]!);
      }
    }
  };

  useEffect(() => {
    if (highlightedIndex >= suggestions.length) {
      setHighlightedIndex(suggestions.length - 1);
    }
  }, [suggestions, highlightedIndex]);

  const activeOptionId: string | undefined =
    highlightedIndex >= 0 && highlightedIndex < suggestions.length
      ? `${listboxIdRef.current}-option-${highlightedIndex}`
      : undefined;

  const menu: ReactElement | null = showMenu ? (
    <div
      ref={menuRef}
      className={
        props.menuClassName ||
        "overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
      }
      style={{
        position: "fixed",
        top: menuPosition?.top ?? 0,
        left: menuPosition?.left ?? 0,
        width: menuPosition?.width ?? 0,
        maxHeight: menuPosition?.maxHeight ?? SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX,
        zIndex: SUGGESTIONS_MENU_Z_INDEX,
        // Avoid a flash at (0, 0) on the first frame before the rect is read.
        visibility: menuPosition ? "visible" : "hidden",
      }}
      data-testid={
        props.dataTestId ? `${props.dataTestId}-suggestions` : undefined
      }
      data-placement={menuPosition?.placement}
      id={listboxIdRef.current}
      role="listbox"
    >
      {isLoadingSuggestions && (
        <div className="flex w-full items-center px-3 py-2 text-left text-gray-500">
          <svg
            className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-indigo-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            ></path>
          </svg>
          <span>{props.loadingMessage || "Loading..."}</span>
        </div>
      )}
      {!isLoadingSuggestions &&
        suggestions.length === 0 &&
        props.noSuggestionsMessage && (
          <div className="flex w-full items-center px-3 py-2 text-left text-gray-500">
            {props.noSuggestionsMessage}
          </div>
        )}
      {!isLoadingSuggestions &&
        suggestions.map((suggestion: string, index: number) => {
          const isActive: boolean = index === highlightedIndex;
          return (
            <button
              key={`${suggestion}-${index}`}
              id={`${listboxIdRef.current}-option-${index}`}
              type="button"
              role="option"
              /*
               * Portalling puts these buttons outside Modal's focus trap, which
               * is built from `modalRef.current.querySelectorAll(...)`. Keeping
               * them out of the tab order means Tab still cycles the modal's own
               * controls instead of dead-ending here; the list stays reachable
               * through the arrow keys and Enter on the input.
               */
              tabIndex={-1}
              aria-selected={isActive}
              className={`flex w-full items-center px-3 py-2 text-left hover:bg-indigo-50 ${isActive ? "bg-indigo-600 text-white hover:bg-indigo-500" : "text-gray-700"}`}
              onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
              }}
              onClick={() => {
                handleSuggestionSelect(suggestion);
              }}
            >
              {suggestion}
            </button>
          );
        })}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={props.outerDivClassName || "relative mt-2 mb-1 w-full"}
    >
      <input
        autoFocus={props.autoFocus}
        className={getInputClassName()}
        data-testid={props.dataTestId}
        disabled={props.disabled}
        aria-autocomplete="list"
        aria-controls={listboxIdRef.current}
        aria-expanded={showMenu}
        aria-activedescendant={activeOptionId}
        role="combobox"
        onBlur={handleInputBlur}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder}
        spellCheck={!props.disableSpellCheck}
        type="text"
        value={inputValue}
      />
      {menu && createPortal(menu, document.body)}
    </div>
  );
};

export default AutocompleteTextInput;
