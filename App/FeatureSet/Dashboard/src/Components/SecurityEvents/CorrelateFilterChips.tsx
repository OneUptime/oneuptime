import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CorrelationCondition,
  CorrelationFilter,
  CorrelationOperatorLabels,
  getCorrelationFieldDefinition,
} from "../../Utils/SecurityEventCorrelation";

/*
 * The applied filter, rendered as removable chips above the graph — the
 * always-visible answer to "what exactly is this graph showing?", with the
 * AND/OR connector spelled out between chips. Removing a chip re-runs the
 * correlation with the remaining conditions.
 */

export interface ComponentProps {
  filter: CorrelationFilter;
  onRemoveCondition: (index: number) => void;
  onClearAll: () => void;
}

const CorrelateFilterChips: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.filter.conditions.length === 0) {
    return <Fragment />;
  }

  const connectorLabel: string = props.filter.connector === "or" ? "OR" : "AND";

  return (
    <div
      data-testid="correlate-filter-chips"
      className="flex flex-wrap items-center gap-1.5"
    >
      {props.filter.conditions.map(
        (condition: CorrelationCondition, index: number): ReactElement => {
          return (
            <Fragment key={index}>
              {index > 0 && (
                <span
                  className={`text-[10px] font-bold ${
                    props.filter.connector === "or"
                      ? "text-amber-600"
                      : "text-indigo-600"
                  }`}
                >
                  {connectorLabel}
                </span>
              )}
              <span
                data-testid={`correlate-filter-chip-${index}`}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pl-2 pr-1 text-xs text-indigo-700"
              >
                <span className="font-medium text-indigo-500">
                  {getCorrelationFieldDefinition(condition.field).label}
                </span>
                <span className="italic">
                  {CorrelationOperatorLabels[condition.operator]}
                </span>
                <span className="font-mono">{condition.value}</span>
                <button
                  type="button"
                  data-testid={`correlate-filter-chip-remove-${index}`}
                  aria-label={`Remove condition ${index + 1}`}
                  className="flex h-4 w-4 items-center justify-center rounded text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
                  onClick={() => {
                    props.onRemoveCondition(index);
                  }}
                >
                  <Icon icon={IconProp.Close} className="h-2.5 w-2.5" />
                </button>
              </span>
            </Fragment>
          );
        },
      )}
      {props.filter.conditions.length > 1 && (
        <button
          type="button"
          data-testid="correlate-filter-clear-all"
          className="text-xs text-gray-500 hover:text-gray-700 underline ml-1"
          onClick={() => {
            props.onClearAll();
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
};

export default CorrelateFilterChips;
