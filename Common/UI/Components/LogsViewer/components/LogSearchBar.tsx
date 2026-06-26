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
  // Top-level field names (e.g. "severity", "service") — used as `field:value`.
  suggestions?: Array<string> | undefined;
  // Telemetry attribute keys (no leading `@`) — used as `@attr:value`.
  attributeSuggestions?: Array<string> | undefined;
  valueSuggestions?: Record<string, Array<string>> | undefined;
  onFieldValueSelect?: ((fieldKey: string, value: string) => void) | undefined;
  placeholder?: string | undefined;
  // Loading state for `@attribute` autocomplete (initial fetch of keys).
  isAttributesLoading?: boolean | undefined;
  // Loading state for `@attribute:value` autocomplete (per-key value fetch).
  isValuesLoading?: boolean | undefined;
}

export interface LogSearchBarRef {
  focus: () => void;
}

const LogSearchBar: React.ForwardRefExoticComponent<
  LogSearchBarProps & React.RefAttributes<LogSearchBarRef>
> = forwardRef<LogSearchBarRef, LogSearchBarProps>(
  (props: LogSearchBarProps, ref: React.Ref<LogSearchBarRef>): ReactElement => {
    const [isFocused, setIsFocused] = useState<boolean>(false);
    const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
    const [showHelp, setShowHelp] = useState<boolean>(false);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] =
      useState<number>(-1);
    const inputRef: React.RefObject<HTMLInputElement> =
      useRef<HTMLInputElement>(null!);
    const containerRef: React.RefObject<HTMLDivElement> =
      useRef<HTMLDivElement>(null!);

    useImperativeHandle(ref, () => {
      return {
        focus: (): void => {
          inputRef.current?.focus();
        },
      };
    }, []);

    const currentWord: string = extractCurrentWord(props.value);

    // Strip leading "@" — treat it as a trigger character for suggestions
    const hasAtPrefix: boolean = currentWord.startsWith("@");
    const normalizedWord: string = hasAtPrefix
      ? currentWord.substring(1)
      : currentWord;

    // Determine if we're in "field:value" mode or "field name" mode
    const colonIndex: number = normalizedWord.indexOf(":");
    const isValueMode: boolean = colonIndex > 0;
    /*
     * Preserve the user's casing — telemetry attribute keys like `requestId`
     * are case-sensitive in the data, so lowercasing here would silently
     * break searches against camelCase keys. Alias lookups (severity →
     * severityText) handle their own case normalisation.
     */
    const fieldPrefix: string = isValueMode
      ? normalizedWord.substring(0, colonIndex)
      : "";
    const partialValue: string = isValueMode
      ? normalizedWord.substring(colonIndex + 1)
      : "";

    /*
     * `@` is the explicit trigger for attribute mode — only show attribute
     * keys there. Without `@`, only show top-level field names. Mixing
     * the two led to confusing dropdowns that rendered field names like
     * "severity" as if they were attributes.
     */
    const activeSuggestions: Array<string> = hasAtPrefix
      ? props.attributeSuggestions || []
      : props.suggestions || [];

    const filteredSuggestions: Array<string> = isValueMode
      ? getValueSuggestions(
          fieldPrefix,
          partialValue,
          props.valueSuggestions || {},
        )
      : activeSuggestions.filter((s: string): boolean => {
          if (!normalizedWord && !hasAtPrefix) {
            return false;
          }
          if (hasAtPrefix && normalizedWord.length === 0) {
            return true;
          }
          return s.toLowerCase().startsWith(normalizedWord.toLowerCase());
        });

    /*
     * Show a loader inside the dropdown while the parent is fetching:
     *   - attribute keys: `@` was just typed but the keys haven't arrived
     *   - attribute values: `@key:` was typed but values for that key
     *     haven't arrived yet
     */
    const isLoadingForCurrentMode: boolean = isValueMode
      ? Boolean(props.isValuesLoading)
      : hasAtPrefix
        ? Boolean(props.isAttributesLoading)
        : false;

    const shouldShowSuggestions: boolean =
      showSuggestions &&
      isFocused &&
      (filteredSuggestions.length > 0 || isLoadingForCurrentMode) &&
      (isValueMode ? true : currentWord.length > 0);

    // Show help when focused, input is empty, and no suggestions visible
    const shouldShowHelp: boolean =
      showHelp &&
      isFocused &&
      props.value.length === 0 &&
      !shouldShowSuggestions;

    useEffect(() => {
      setSelectedSuggestionIndex(-1);
    }, [currentWord]);

    const handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void =
      useCallback(
        (e: KeyboardEvent<HTMLInputElement>): void => {
          if (e.key === "Enter") {
            if (
              shouldShowSuggestions &&
              !isLoadingForCurrentMode &&
              selectedSuggestionIndex >= 0 &&
              selectedSuggestionIndex < filteredSuggestions.length
            ) {
              applySuggestion(filteredSuggestions[selectedSuggestionIndex]!);
              e.preventDefault();
              return;
            }

            // If in value mode with a typed value, apply as a chip
            if (
              isValueMode &&
              partialValue.length > 0 &&
              props.onFieldValueSelect
            ) {
              /*
               * Prefer a match from the suggestion list (so casing matches
               * what's actually in the data); otherwise accept the typed
               * value as-is so users aren't blocked when no suggestion exists.
               */
              const resolvedField: string =
                FIELD_ALIAS_MAP[fieldPrefix.toLowerCase()] || fieldPrefix;
              const availableValues: Array<string> =
                (props.valueSuggestions || {})[resolvedField] || [];
              const lowerPartial: string = partialValue.toLowerCase();
              const exactMatch: string | undefined = availableValues.find(
                (v: string): boolean => {
                  return v.toLowerCase() === lowerPartial;
                },
              );

              const resolvedMatch: string =
                exactMatch ||
                (filteredSuggestions.length === 1
                  ? filteredSuggestions[0]!
                  : partialValue);

              props.onFieldValueSelect(fieldPrefix, resolvedMatch);
              const parts: Array<string> = props.value.split(/\s+/);
              parts.pop();
              const remaining: string = parts.join(" ");
              props.onChange(remaining ? remaining + " " : "");
              setShowSuggestions(false);
              setShowHelp(false);
              e.preventDefault();
              return;
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

          if (!shouldShowSuggestions || isLoadingForCurrentMode) {
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
          isLoadingForCurrentMode,
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

        /*
         * Field name mode: append colon (re-prefix `@` for attribute keys
         * since they're stored without it)
         */
        const parts: Array<string> = props.value.split(/\s+/);

        if (parts.length > 0) {
          parts[parts.length - 1] = hasAtPrefix
            ? "@" + suggestion + ":"
            : suggestion + ":";
        }

        props.onChange(parts.join(" "));
        setShowSuggestions(false);
        setShowHelp(false);
        inputRef.current?.focus();
      },
      [props, isValueMode, fieldPrefix, hasAtPrefix],
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

    const loadingMessage: string = isValueMode
      ? `Loading values for ${fieldPrefix}...`
      : "Loading attributes...";

    const emptyMessage: string | undefined =
      isValueMode &&
      !isLoadingForCurrentMode &&
      filteredSuggestions.length === 0
        ? `No matching values — press Enter to filter by "${partialValue}"`
        : undefined;

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
            isAttributeMode={hasAtPrefix}
            isLoading={isLoadingForCurrentMode}
            loadingMessage={loadingMessage}
            emptyMessage={emptyMessage}
          />
        )}

        {shouldShowHelp && (
          <LogSearchHelp onExampleClick={handleExampleClick} />
        )}
      </div>
    );
  },
);

function extractCurrentWord(value: string): string {
  const parts: Array<string> = value.split(/\s+/);
  return parts[parts.length - 1] || "";
}

// Field alias mapping (user-facing name → internal key used in valueSuggestions)
const FIELD_ALIAS_MAP: Record<string, string> = {
  severity: "severityText",
  level: "severityText",
  service: "primaryEntityId",
  trace: "traceId",
  span: "spanId",
};

function getValueSuggestions(
  fieldName: string,
  partialValue: string,
  valueSuggestions: Record<string, Array<string>>,
): Array<string> {
  // Resolve field name alias (case-insensitive lookup, preserve original key as fallback)
  const resolvedField: string =
    FIELD_ALIAS_MAP[fieldName.toLowerCase()] || fieldName;

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

LogSearchBar.displayName = "LogSearchBar";

export default LogSearchBar;
