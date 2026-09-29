import React, { FunctionComponent, ReactElement } from "react";

export interface LogSearchSuggestionsProps {
  suggestions: Array<string>;
  selectedIndex: number;
  onSelect: (suggestion: string) => void;
  fieldContext?: string | undefined;
  /*
   * When true, items are attribute keys (rendered with `@`).
   * When false, items are top-level field names (no prefix).
   */
  isAttributeMode?: boolean | undefined;
  isLoading?: boolean | undefined;
  loadingMessage?: string | undefined;
  emptyMessage?: string | undefined;
}

const MAX_VISIBLE_SUGGESTIONS: number = 8;

const LogSearchSuggestions: FunctionComponent<LogSearchSuggestionsProps> = (
  props: LogSearchSuggestionsProps,
): ReactElement => {
  const visible: Array<string> = props.suggestions.slice(
    0,
    MAX_VISIBLE_SUGGESTIONS,
  );

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
      {props.isLoading && (
        <div className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-500">
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
      {!props.isLoading &&
        visible.length === 0 &&
        props.emptyMessage !== undefined && (
          <div className="px-3 py-2 text-sm text-gray-400">
            {props.emptyMessage}
          </div>
        )}
      {visible.map((suggestion: string, index: number) => {
        const isSelected: boolean = index === props.selectedIndex;

        return (
          <button
            key={suggestion}
            type="button"
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
              isSelected
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-700 hover:bg-gray-50"
            }`}
            onMouseDown={(e: React.MouseEvent) => {
              e.preventDefault();
              props.onSelect(suggestion);
            }}
          >
            {props.fieldContext ? (
              <>
                <span className="font-mono text-xs text-gray-400">
                  {props.fieldContext}:
                </span>
                <span className="font-mono">{suggestion}</span>
              </>
            ) : props.isAttributeMode ? (
              <>
                <span className="font-mono text-xs text-indigo-400">@</span>
                <span className="font-mono">{suggestion}</span>
              </>
            ) : (
              <span className="font-mono">{suggestion}</span>
            )}
          </button>
        );
      })}
      {props.suggestions.length > MAX_VISIBLE_SUGGESTIONS && (
        <div className="px-3 py-1 text-[11px] text-gray-400">
          +{props.suggestions.length - MAX_VISIBLE_SUGGESTIONS} more...
        </div>
      )}
    </div>
  );
};

export default LogSearchSuggestions;
