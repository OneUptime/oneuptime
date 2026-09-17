import React, { forwardRef, ReactElement, ReactNode } from "react";
import LogSearchBar, { LogSearchBarRef } from "./LogSearchBar";

export interface LogsFilterCardProps {
  logAttributes: Array<string>;
  toolbar: ReactNode;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearchSubmit: () => void;
  valueSuggestions?: Record<string, Array<string>> | undefined;
  onFieldValueSelect?: ((fieldKey: string, value: string) => void) | undefined;
  isAttributesLoading?: boolean | undefined;
  isValuesLoading?: boolean | undefined;
}

const LogsFilterCard: React.ForwardRefExoticComponent<
  LogsFilterCardProps & React.RefAttributes<LogSearchBarRef>
> = forwardRef<LogSearchBarRef, LogsFilterCardProps>(
  (
    props: LogsFilterCardProps,
    ref: React.Ref<LogSearchBarRef>,
  ): ReactElement => {
    const fieldSuggestions: Array<string> = [
      "severity",
      "service",
      "trace",
      "span",
    ];

    return (
      <div className="flex flex-col gap-3">
        <div>
          <LogSearchBar
            ref={ref}
            value={props.searchQuery}
            onChange={props.onSearchQueryChange}
            onSubmit={props.onSearchSubmit}
            suggestions={fieldSuggestions}
            attributeSuggestions={props.logAttributes}
            valueSuggestions={props.valueSuggestions}
            onFieldValueSelect={props.onFieldValueSelect}
            isAttributesLoading={props.isAttributesLoading}
            isValuesLoading={props.isValuesLoading}
          />
        </div>
        <div>{props.toolbar}</div>
      </div>
    );
  },
);

LogsFilterCard.displayName = "LogsFilterCard";

export default LogsFilterCard;
