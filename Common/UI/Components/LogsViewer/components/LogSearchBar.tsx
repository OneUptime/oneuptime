import React, {
  ReactElement,
  useState,
  useCallback,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  KeyboardEvent,
} from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import LogSearchSuggestions from "./LogSearchSuggestions";
import LogSearchHelp from "./LogSearchHelp";

export interface LogSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  suggestions?: Array<string> | undefined;
  valueSuggestions?: Record<string, Array<string>> | undefined;
  onFieldValueSelect?: ((fieldKey: string, value: string) => void) | undefined;
  placeholder?: string | undefined;
}

export interface LogSearchBarRef {
  focus: () => void;
}

const LogSearchBar: React.ForwardRefExoticComponent<
  LogSearchBarProps & React.RefAttributes<LogSearchBarRef>
> = forwardRef<LogSearchBarRef, LogSearchBarProps>(function LogSearchBar(
  props: LogSearchBarProps,
  ref: React.Ref<LogSearchBarRef>,
): ReactElement {
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] =
    useState<number>(-1);
  const inputRef: React.RefObject<HTMLInputElement> = useRef<HTMLInputElement>(
    null!,
  );
  const containerRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(
    null!,
  );

  useImperativeHandle(
    ref,
    () => {
      return {
        focus: (): void => {
          inputRef.current?.focus();
        },
      };
    },
    [],
  );

  const currentWord: string = extractCurrentWord(props.value);

  // Strip leading "@" — treat it as a trigger character for suggestions
  const hasAtPrefix: boolean = currentWord.startsWith("@");
  const normalizedWord: string = hasAtPrefix
    ? currentWord.substring(1)
    : currentWord;

  // Determine if we're in "field:value" mode or "field name" mode
  const colonIndex: number = normalizedWord.indexOf(":");
  const isValueMode: boolean = colonIndex > 0;
  const fieldPrefix: string = isValueMode
    ? normalizedWord.substring(0, colonIndex).toLowerCase()
    : "";
  const partialValue: string = isValueMode
    ? normalizedWord.substring(colonIndex + 1)
    : "";

  const filteredSuggestions: Array<string> = isValueMode
    ? getValueSuggestions(
        fieldPrefix,
        partialValue,
        props.valueSuggestions || {},
      )
    : (props.suggestions || []).filter((s: string): boolean => {
        if (!normalizedWord && !hasAtPrefix) {
          return false;
        }
        // When just "@" is typed, show all suggestions
        if (hasAtPrefix && normalizedWord.length === 0) {
          return true;
        }
        // Match against the suggestion name, stripping any leading "@" from the suggestion too
        const normalizedSuggestion: string = s.startsWith("@")
          ? s.substring(1).toLowerCase()
          : s.toLowerCase();
        return normalizedSuggestion.startsWith(normalizedWord.toLowerCase());
      });

  const shouldShowSuggestions: boolean =
    showSuggestions &&
    isFocused &&
    filteredSuggestions.length > 0 &&
    (isValueMode ? true : currentWord.length > 0);

  // Show help when focused, input is empty, and no suggestions visible
  const shouldShowHelp: boolean =
    showHelp && isFocused && props.value.length === 0 && !shouldShowSuggestions;

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

          // If in value mode with a typed value, try to match and apply as chip
          if (
            isValueMode &&
            partialValue.length > 0 &&
            props.onFieldValueSelect
          ) {
            // First try exact case-insensitive match from the available values
            const resolvedField: string =
              FIELD_ALIAS_MAP[fieldPrefix] || fieldPrefix;
            const availableValues: Array<string> =
              (props.valueSuggestions || {})[resolvedField] || [];
            const lowerPartial: string = partialValue.toLowerCase();
            const exactMatch: string | undefined = availableValues.find(
              (v: string): boolean => {
                return v.toLowerCase() === lowerPartial;
              },
            );

            // Use exact match, or if there's exactly one prefix match, use that
            const resolvedMatch: string | undefined =
              exactMatch ||
              (filteredSuggestions.length === 1
                ? filteredSuggestions[0]
                : undefined);

            if (resolvedMatch) {
              props.onFieldValueSelect(fieldPrefix, resolvedMatch);
              // Remove the field:value term from text
              const parts: Array<string> = props.value.split(/\s+/);
              parts.pop();
              const remaining: string = parts.join(" ");
              props.onChange(remaining ? remaining + " " : "");
              setShowSuggestions(false);
              setShowHelp(false);
              e.preventDefault();
              return;
            }
          }

          props.onSubmit();
          setShowSuggestions(false);
          setShowHelp(false);
          return;
        }

        if (e.key === "Escape") {
          setShowSuggestions(false);
          setShowHelp(false);
          return;
        }

        if (!shouldShowSuggestions) {
          return;
        }

        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSuggestionIndex((prev: number): number => {
            return Math.min(prev + 1, filteredSuggestions.length - 1);
          });
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSuggestionIndex((prev: number): number => {
            return Math.max(prev - 1, 0);
          });
        }
      },
      [
        shouldShowSuggestions,
        selectedSuggestionIndex,
        filteredSuggestions,
        isValueMode,
        fieldPrefix,
        partialValue,
        props,
      ],
    );

  const applySuggestion: (suggestion: string) => void = useCallback(
    (suggestion: string): void => {
      if (isValueMode) {
        // Value mode: apply as a chip via onFieldValueSelect
        if (props.onFieldValueSelect) {
          props.onFieldValueSelect(fieldPrefix, suggestion);
        }

        // Remove the current field:value term from the search text
        const parts: Array<string> = props.value.split(/\s+/);
        parts.pop(); // remove the field:partialValue
        const remaining: string = parts.join(" ");
        props.onChange(remaining ? remaining + " " : "");
        setShowSuggestions(false);
        setShowHelp(false);
        inputRef.current?.focus();
        return;
      }

      // Field name mode: append colon
      const parts: Array<string> = props.value.split(/\s+/);

      if (parts.length > 0) {
        parts[parts.length - 1] = suggestion + ":";
      }

      props.onChange(parts.join(" "));
      setShowSuggestions(false);
      setShowHelp(false);
      inputRef.current?.focus();
    },
    [props, isValueMode, fieldPrefix],
  );

  const handleExampleClick: (example: string) => void = useCallback(
    (example: string): void => {
      props.onChange(example);
      setShowHelp(false);
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
        setShowHelp(false);
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
            setShowHelp(false);
          }}
          onFocus={() => {
            setIsFocused(true);
            setShowSuggestions(true);
            if (props.value.length === 0) {
              setShowHelp(true);
            }
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
              setShowHelp(true);
              setShowSuggestions(false);
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
          fieldContext={isValueMode ? fieldPrefix : undefined}
        />
      )}

      {shouldShowHelp && <LogSearchHelp onExampleClick={handleExampleClick} />}
    </div>
  );
});

function extractCurrentWord(value: string): string {
  const parts: Array<string> = value.split(/\s+/);
  return parts[parts.length - 1] || "";
}

// Field alias mapping (user-facing name → internal key used in valueSuggestions)
const FIELD_ALIAS_MAP: Record<string, string> = {
  severity: "severityText",
  level: "severityText",
  service: "serviceId",
  trace: "traceId",
  span: "spanId",
};

function getValueSuggestions(
  fieldName: string,
  partialValue: string,
  valueSuggestions: Record<string, Array<string>>,
): Array<string> {
  // Resolve field name alias
  const resolvedField: string = FIELD_ALIAS_MAP[fieldName] || fieldName;

  const values: Array<string> | undefined = valueSuggestions[resolvedField];

  if (!values || values.length === 0) {
    return [];
  }

  if (!partialValue || partialValue.length === 0) {
    return values;
  }

  const lowerPartial: string = partialValue.toLowerCase();
  return values.filter((v: string): boolean => {
    return v.toLowerCase().startsWith(lowerPartial);
  });
}

export default LogSearchBar;
