import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import LogSearchBar from "./LogSearchBar";

export interface LogsFilterCardProps {
  logAttributes: Array<string>;
  toolbar: ReactNode;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearchSubmit: () => void;
  valueSuggestions?: Record<string, Array<string>> | undefined;
  onFieldValueSelect?: ((fieldKey: string, value: string) => void) | undefined;
}

const LogsFilterCard: FunctionComponent<LogsFilterCardProps> = (
  props: LogsFilterCardProps,
): ReactElement => {
  const searchBarSuggestions: Array<string> = [
    "severity",
    "service",
    "trace",
    "span",
    ...props.logAttributes.map((attr: string) => `@${attr}`),
  ];

  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <LogSearchBar
          value={props.searchQuery}
          onChange={props.onSearchQueryChange}
          onSubmit={props.onSearchSubmit}
          suggestions={searchBarSuggestions}
          valueSuggestions={props.valueSuggestions}
          onFieldValueSelect={props.onFieldValueSelect}
        />
      </div>
      <div className="flex-none pt-0.5">
        {props.toolbar}
      </div>
    </div>
  );
};

export default LogsFilterCard;
