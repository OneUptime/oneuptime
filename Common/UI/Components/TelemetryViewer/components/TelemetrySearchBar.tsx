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
import TelemetrySearchSuggestions from "./TelemetrySearchSuggestions";
import TelemetrySearchHelp from "./TelemetrySearchHelp";
import { SearchHelpRow } from "../types";

export interface TelemetrySearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  // Field-name suggestions shown when user types "@".
  suggestions?: Array<string> | undefined;
  // field → allowed value completions (resolved field keys).
  valueSuggestions?: Record<string, Array<string>> | undefined;
  // Called when the user picks a concrete field:value chip from the dropdown.
  onFieldValueSelect?: ((fieldKey: string, value: string) => void) | undefined;
  // User-facing alias → backing field key (e.g. "service" -> "serviceId").
  fieldAliasMap?: Record<string, string> | undefined;
  placeholder?: string | undefined;
  // Rows rendered in the help popover when the bar is empty + focused.
  helpRows?: Array<SearchHelpRow> | undefined;
  helpCombinedExample?: string | undefined;
}

export interface TelemetrySearchBarRef {
  focus: () => void;
}

const TelemetrySearchBar: React.ForwardRefExoticComponent<
  TelemetrySearchBarProps & React.RefAttributes<TelemetrySearchBarRef>
> = forwardRef<TelemetrySearchBarRef, TelemetrySearchBarProps>(
  (
    props: TelemetrySearchBarProps,
    ref: React.Ref<TelemetrySearchBarRef>,
  ): ReactElement => {
    const [isFocused, setIsFocused] = useState<boolean>(false);
    const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
    const [showHelp, setShowHelp] = useState<boolean>(false);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] =
      useState<number>(-1);
    const inputRef: React.RefObject<HTMLInputElement> =
      useRef<HTMLInputElement>(null!);
    const containerRef: React.RefObject<HTMLDivElement> =
      useRef<HTMLDivElement>(null!);

    const fieldAliasMap: Record<string, string> = props.fieldAliasMap || {};

    useImperativeHandle(ref, () => {
      return {
        focus: (): void => {
          inputRef.current?.focus();
        },
      };
    }, []);

    const currentWord: string = extractCurrentWord(props.value);

    const hasAtPrefix: boolean = currentWord.startsWith("@");
    const normalizedWord: string = hasAtPrefix
      ? currentWord.substring(1)
      : currentWord;

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
          fieldAliasMap,
        )
      : (props.suggestions || []).filter((s: string): boolean => {
          if (!normalizedWord && !hasAtPrefix) {
            return false;
          }
          if (hasAtPrefix && normalizedWord.length === 0) {
            return true;
          }
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

    const shouldShowHelp: boolean =
      showHelp &&
      isFocused &&
      props.value.length === 0 &&
      !shouldShowSuggestions &&
      Boolean(props.helpRows) &&
      props.helpRows.length > 0;

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

            if (
              isValueMode &&
              partialValue.length > 0 &&
              props.onFieldValueSelect
            ) {
              const resolvedField: string =
                fieldAliasMap[fieldPrefix] || fieldPrefix;
              const availableValues: Array<string> =
                (props.valueSuggestions || {})[resolvedField] || [];
              const lowerPartial: string = partialValue.toLowerCase();
              const exactMatch: string | undefined = availableValues.find(
                (v: string): boolean => {
                  return v.toLowerCase() === lowerPartial;
                },
              );

              const resolvedMatch: string | undefined =
                exactMatch ||
                (filteredSuggestions.length === 1
                  ? filteredSuggestions[0]
                  : undefined);

              if (resolvedMatch) {
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
          fieldAliasMap,
        ],
      );

    const applySuggestion: (suggestion: string) => void = useCallback(
      (suggestion: string): void => {
        if (isValueMode) {
          if (props.onFieldValueSelect) {
            props.onFieldValueSelect(fieldPrefix, suggestion);
          }

          const parts: Array<string> = props.value.split(/\s+/);
          parts.pop();
          const remaining: string = parts.join(" ");
          props.onChange(remaining ? remaining + " " : "");
          setShowSuggestions(false);
          setShowHelp(false);
          inputRef.current?.focus();
          return;
        }

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
            placeholder={props.placeholder || "Search..."}
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
          <TelemetrySearchSuggestions
            suggestions={filteredSuggestions}
            selectedIndex={selectedSuggestionIndex}
            onSelect={applySuggestion}
            fieldContext={isValueMode ? fieldPrefix : undefined}
          />
        )}

        {shouldShowHelp && props.helpRows && (
          <TelemetrySearchHelp
            rows={props.helpRows}
            combinedExample={props.helpCombinedExample}
            onExampleClick={handleExampleClick}
          />
        )}
      </div>
    );
  },
);

function extractCurrentWord(value: string): string {
  const parts: Array<string> = value.split(/\s+/);
  return parts[parts.length - 1] || "";
}

function getValueSuggestions(
  fieldName: string,
  partialValue: string,
  valueSuggestions: Record<string, Array<string>>,
  aliasMap: Record<string, string>,
): Array<string> {
  const resolvedField: string = aliasMap[fieldName] || fieldName;

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

TelemetrySearchBar.displayName = "TelemetrySearchBar";

export default TelemetrySearchBar;
