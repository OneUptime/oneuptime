import React, { FunctionComponent, ReactElement, useId } from "react";
import {
  TableThresholdLevel,
  TableThresholdStyle,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { formatTableValue } from "Common/Utils/Dashboard/TableThresholds";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  TABLE_THRESHOLD_CELL_CLASS_NAMES,
  TABLE_THRESHOLD_ICONS,
} from "../Components/DashboardTableThresholdCopy";

export interface ComponentProps {
  value: TableThresholdStyle;
  onChange: (value: TableThresholdStyle) => void;
}

interface StyleOption {
  value: TableThresholdStyle;
  // English; looked up when drawn.
  title: string;
}

const OPTIONS: Array<StyleOption> = [
  { value: TableThresholdStyle.Text, title: "Colored text" },
  { value: TableThresholdStyle.Background, title: "Colored background" },
];

// The value each choice's picture shows: a critical one, in both looks.
const SAMPLE_VALUE: string = formatTableValue({
  value: 94.2,
  decimals: 2,
  unit: "%",
});

/*
 * How the whole table colors a value past a column's threshold (issue
 * #5231): its number, or its whole cell. Shown under the columns once one
 * of them is colored by thresholds - before that it changes nothing - as
 * two choices, each with a small picture of a critical value drawn that
 * way, so the words need no explaining.
 */
const TableThresholdStylePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = useId();
  const name: string = useId();

  return (
    <div className="mt-4" data-testid="table-threshold-style">
      <p id={labelId} className="block text-sm font-medium text-gray-700">
        {translator.translateText("Threshold colors")}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {translator.translateText(
          "How every column colors a value that reaches its warning or critical threshold.",
        )}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {OPTIONS.map((option: StyleOption): ReactElement => {
          const isChecked: boolean = props.value === option.value;

          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                isChecked
                  ? "border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
              data-testid={`table-threshold-style-${option.value}`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={isChecked}
                onChange={(): void => {
                  props.onChange(option.value);
                }}
                className="h-3.5 w-3.5 flex-none border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <div
                aria-hidden="true"
                className={`inline-flex flex-none items-center gap-1 rounded px-1.5 py-0.5 text-xs tabular-nums ${TABLE_THRESHOLD_CELL_CLASS_NAMES[option.value][TableThresholdLevel.Critical]}`}
                data-testid={`table-threshold-style-${option.value}-visual`}
              >
                <Icon
                  icon={TABLE_THRESHOLD_ICONS[TableThresholdLevel.Critical]}
                  className="h-3.5 w-3.5 flex-none"
                  thick={ThickProp.Thick}
                />
                <span>{SAMPLE_VALUE}</span>
              </div>
              <span className="min-w-0 text-sm text-gray-900">
                {translator.translateText(option.title)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default TableThresholdStylePicker;
