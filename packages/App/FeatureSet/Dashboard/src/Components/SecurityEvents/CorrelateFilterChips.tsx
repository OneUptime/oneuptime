import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  CorrelationCondition,
  CorrelationConnectorWords,
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
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  if (props.filter.conditions.length === 0) {
    return <Fragment />;
  }

  const connectorLabel: string =
    CorrelationConnectorWords[props.filter.connector];

  /*
   * A value picked from a field's own list (a severity) reads as the
   * builder's dropdown shows it ("Hoch"); a typed value is shown as typed.
   */
  const chipValue: (condition: CorrelationCondition) => string = (
    condition: CorrelationCondition,
  ): string => {
    const options: Array<string> | undefined = getCorrelationFieldDefinition(
      condition.field,
    ).valueOptions;

    return options && options.includes(condition.value)
      ? t(condition.value)
      : condition.value;
  };

  return (
    <div
      data-testid="correlate-filter-chips"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {props.filter.conditions.map(
        (condition: CorrelationCondition, index: number): ReactElement => {
          const value: string = chipValue(condition);

          return (
            <Fragment key={index}>
              {index > 0 && (
                <span
                  className={`text-xs font-semibold ${
                    props.filter.connector === "or"
                      ? "text-amber-700"
                      : "text-indigo-600"
                  }`}
                >
                  {connectorLabel}
                </span>
              )}
              <span
                data-testid={`correlate-filter-chip-${index}`}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pe-0.5 ps-2 text-xs text-indigo-700"
              >
                {/*
                 * The spaces between parts are not drawn inside a flex row
                 * (gap does the spacing) but keep the chip's text readable
                 * as words for screen readers.
                 */}
                <span className="shrink-0 font-medium text-indigo-500">
                  {t(getCorrelationFieldDefinition(condition.field).label)}
                </span>{" "}
                <span className="shrink-0 italic">
                  {t(CorrelationOperatorLabels[condition.operator])}
                </span>{" "}
                {/*
                 * Hashes and command lines can run to hundreds of characters;
                 * cap the chip and keep the full value on hover.
                 */}
                <span
                  className="min-w-0 max-w-[16rem] truncate font-mono"
                  title={value}
                >
                  {value}
                </span>
                <button
                  type="button"
                  data-testid={`correlate-filter-chip-remove-${index}`}
                  aria-label={`${t("Remove condition")} ${index + 1}`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={() => {
                    props.onRemoveCondition(index);
                  }}
                >
                  <Icon icon={IconProp.Close} className="h-3 w-3" />
                </button>
              </span>
            </Fragment>
          );
        },
      )}
      <button
        type="button"
        data-testid="correlate-filter-clear-all"
        className="ms-1 text-xs text-gray-500 underline hover:text-gray-700"
        onClick={() => {
          props.onClearAll();
        }}
      >
        {t("Clear all")}
      </button>
    </div>
  );
};

export default CorrelateFilterChips;
