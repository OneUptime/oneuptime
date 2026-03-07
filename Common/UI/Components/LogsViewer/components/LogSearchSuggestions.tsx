import React, { FunctionComponent, ReactElement } from "react";

export interface LogSearchSuggestionsProps {
  suggestions: Array<string>;
  selectedIndex: number;
  onSelect: (suggestion: string) => void;
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
            <span className="font-mono text-xs text-indigo-400">@</span>
            <span className="font-mono">{suggestion}</span>
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
