import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useCallback,
  useRef,
  useEffect,
  KeyboardEvent,
} from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import LogSearchSuggestions from "./LogSearchSuggestions";

export interface LogSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  suggestions?: Array<string>;
  placeholder?: string;
}

const LogSearchBar: FunctionComponent<LogSearchBarProps> = (
  props: LogSearchBarProps,
): ReactElement => {
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] =
    useState<number>(-1);
  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null!);
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null!);

  const currentWord: string = extractCurrentWord(props.value);

  const filteredSuggestions: Array<string> = (props.suggestions || []).filter(
    (s: string): boolean => {
      if (!currentWord || currentWord.length < 1) {
        return false;
      }
      return s.toLowerCase().startsWith(currentWord.toLowerCase());
    },
  );

  const shouldShowSuggestions: boolean =
    showSuggestions &&
    isFocused &&
    filteredSuggestions.length > 0 &&
    currentWord.length > 0;

  useEffect(() => {
    setSelectedSuggestionIndex(-1);
  }, [currentWord]);

  const handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void =
    useCallback(
      (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === "Enter") {
          if (
            shouldShowSuggestions &&
            selectedSuggestionIndex >= 0 &&
            selectedSuggestionIndex < filteredSuggestions.length
          ) {
            applySuggestion(filteredSuggestions[selectedSuggestionIndex]!);
            e.preventDefault();
            return;
          }

          props.onSubmit();
          setShowSuggestions(false);
          return;
        }

        if (e.key === "Escape") {
          setShowSuggestions(false);
          return;
        }

        if (!shouldShowSuggestions) {
          return;
        }

        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSuggestionIndex(
            (prev: number): number =>
              Math.min(prev + 1, filteredSuggestions.length - 1),
          );
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSuggestionIndex(
            (prev: number): number => Math.max(prev - 1, 0),
          );
        }
      },
      [
        shouldShowSuggestions,
        selectedSuggestionIndex,
        filteredSuggestions,
        props,
      ],
    );

  const applySuggestion: (suggestion: string) => void = useCallback(
    (suggestion: string): void => {
      const parts: Array<string> = props.value.split(/\s+/);

      if (parts.length > 0) {
        parts[parts.length - 1] = suggestion + ":";
      }

      props.onChange(parts.join(" "));
      setShowSuggestions(false);
      inputRef.current?.focus();
    },
    [props],
  );

  useEffect(() => {
    const handleClickOutside: (e: MouseEvent) => void = (
      e: MouseEvent,
    ): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 transition-colors ${
          isFocused
            ? "border-indigo-400 ring-2 ring-indigo-100"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <Icon
          icon={IconProp.Search}
          className="h-4 w-4 flex-none text-gray-400"
        />
        <input
          ref={inputRef}
          type="text"
          value={props.value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            props.onChange(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => {
            setIsFocused(true);
            setShowSuggestions(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            props.placeholder ||
            'Search logs... (e.g. severity:error service:api "connection refused")'
          }
          className="flex-1 bg-transparent font-mono text-sm text-gray-900 placeholder-gray-400 outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        {props.value.length > 0 && (
          <button
            type="button"
            className="flex-none rounded-full p-1 text-gray-400 hover:bg-gray-100"
            onClick={() => {
              props.onChange("");
              inputRef.current?.focus();
            }}
            title="Clear search"
          >
            <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {shouldShowSuggestions && (
        <LogSearchSuggestions
          suggestions={filteredSuggestions}
          selectedIndex={selectedSuggestionIndex}
          onSelect={applySuggestion}
        />
      )}
    </div>
  );
};

function extractCurrentWord(value: string): string {
  const parts: Array<string> = value.split(/\s+/);
  return parts[parts.length - 1] || "";
}

export default LogSearchBar;
