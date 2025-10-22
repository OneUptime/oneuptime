import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
}

const BASE_INPUT_CLASS: string =
  "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";

const MAX_SUGGESTIONS: number = 50;

// Provides a free-form text input with an optional suggestion dropdown.
const AutocompleteTextInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [inputValue, setInputValue] = useState<string>(props.value || "");
  const [isMenuVisible, setIsMenuVisible] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
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
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
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

  const showMenu: boolean = isMenuVisible && suggestions.length > 0;

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
    if (!showMenu) {
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

    if (event.key === "Escape") {
      setIsMenuVisible(false);
      setHighlightedIndex(-1);
    }
  };

  useEffect(() => {
    if (highlightedIndex >= suggestions.length) {
      setHighlightedIndex(suggestions.length - 1);
    }
  }, [suggestions, highlightedIndex]);

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
      {showMenu && (
        <div
          className={
            props.menuClassName ||
            "absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
          }
          id={listboxIdRef.current}
          role="listbox"
        >
          {suggestions.map((suggestion: string, index: number) => {
            const isActive: boolean = index === highlightedIndex;
            return (
              <button
                key={`${suggestion}-${index}`}
                type="button"
                role="option"
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
      )}
    </div>
  );
};

export default AutocompleteTextInput;
