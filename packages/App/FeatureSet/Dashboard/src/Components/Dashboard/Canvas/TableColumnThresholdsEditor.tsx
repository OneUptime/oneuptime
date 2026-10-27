import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import {
  TableColumnThresholds,
  TableThresholdDirection,
  TableThresholdLevel,
  TableThresholdStyle,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import {
  TableColumnDisplay,
  getTableThresholdPreset,
  isTableThresholdOrderReversed,
  readTableColumnThresholds,
  readTableThresholdDirection,
  readTableThresholdNumber,
} from "Common/Utils/Dashboard/TableThresholds";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  TABLE_THRESHOLD_CELL_CLASS_NAMES,
  TABLE_THRESHOLD_ICONS,
  getTableThresholdRules,
} from "../Components/DashboardTableThresholdCopy";

export interface ComponentProps {
  // An id of the column, for the test ids of its fields.
  columnId: string;
  // The column's stored thresholds: present (even with no numbers yet) while they are on.
  thresholds: TableColumnThresholds | undefined;
  // How the column shows its values: the unit after the thresholds, and the preset.
  display: TableColumnDisplay;
  // How the table colors a value past a threshold, for the legend's look.
  thresholdStyle: TableThresholdStyle;
  // Undefined turns the thresholds off.
  onChange: (thresholds: TableColumnThresholds | undefined) => void;
}

const DIRECTION_OPTIONS: Array<DropdownOption> = [
  { value: TableThresholdDirection.HigherIsWorse, label: "Higher is worse" },
  { value: TableThresholdDirection.LowerIsWorse, label: "Lower is worse" },
];

/*
 * A threshold's field. What is typed is kept as typed while it is not yet a
 * number - "99." on the way to "99.9" - and only a number is stored: the
 * stored value read back would otherwise drop the point under the caret.
 * A change made elsewhere (the preset when the thresholds are turned on)
 * is shown as soon as it differs from what is typed.
 */
const ThresholdNumberField: FunctionComponent<{
  label: string;
  unit: string | undefined;
  value: number | undefined;
  dataTestId: string;
  onChange: (value: number | undefined) => void;
}> = (props: {
  label: string;
  unit: string | undefined;
  value: number | undefined;
  dataTestId: string;
  onChange: (value: number | undefined) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = useId();
  // The unit after the field describes it: "Warning at, 80, %".
  const unitId: string = useId();
  const [text, setText] = useState<string>(
    props.value === undefined ? "" : String(props.value),
  );

  useEffect(() => {
    if (readTableThresholdNumber(text) !== props.value) {
      setText(props.value === undefined ? "" : String(props.value));
    }
  }, [props.value]);

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-gray-600 mb-1"
      >
        {translator.translateText(props.label)}
      </label>
      {/*
       * 8px under the label, as the card's other fields sit: there the
       * label's 4px and the Input's own 8px collapse into 8, but not inside
       * this row, so the Input takes 4 - and lines up with the Direction
       * list beside it. With 4px under it too, the unit is on its middle.
       */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            type={InputType.NUMBER}
            value={text}
            dataTestId={props.dataTestId}
            outerDivClassName="relative mt-1 mb-1 rounded-md shadow-sm w-full"
            ariaDescribedby={props.unit ? unitId : undefined}
            onChange={(value: string): void => {
              setText(value);
              props.onChange(readTableThresholdNumber(value));
            }}
          />
        </div>
        {props.unit ? (
          <span
            id={unitId}
            className="flex-none text-xs text-gray-500"
            data-testid={`${props.dataTestId}-unit`}
          >
            {props.unit}
          </span>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

/*
 * A value column's thresholds, in its card in the table's settings (issue
 * #5231): a checkbox turns them on, starting from 80 and 90 for a percent
 * column; then Warning at, Critical at and which way is worse. Under them,
 * each level the column will show, drawn as the table draws it - so what
 * the numbers do reads before the preview is looked at - or what to fill
 * in first, or what to put right.
 */
const TableColumnThresholdsEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const directionLabelId: string = useId();

  const isOn: boolean = Boolean(props.thresholds);
  const stored: TableColumnThresholds = props.thresholds || {};
  const direction: TableThresholdDirection = readTableThresholdDirection(
    stored.direction,
  );
  const inForce: TableColumnThresholds | null =
    readTableColumnThresholds(stored);

  const writeNumber: (
    key: "warning" | "critical",
    value: number | undefined,
  ) => void = (
    key: "warning" | "critical",
    value: number | undefined,
  ): void => {
    const next: TableColumnThresholds = { ...stored, direction };

    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }

    props.onChange(next);
  };

  const rules: Array<{ level: TableThresholdLevel; rule: string }> =
    getTableThresholdRules({
      translator,
      thresholds: inForce,
      unit: props.display.unit,
    });

  const renderStatus: () => ReactElement = (): ReactElement => {
    if (!inForce) {
      return (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid={`table-column-thresholds-empty-${props.columnId}`}
        >
          {translator.translateText(
            "Set a warning or a critical value to color this column.",
          )}
        </p>
      );
    }

    return (
      <>
        <div
          className="mt-3 flex flex-wrap items-center gap-2"
          data-testid={`table-column-thresholds-legend-${props.columnId}`}
        >
          {rules.map((entry: { level: TableThresholdLevel; rule: string }) => {
            return (
              <div
                key={entry.level}
                className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs ${TABLE_THRESHOLD_CELL_CLASS_NAMES[props.thresholdStyle][entry.level]}`}
                data-threshold-level={entry.level}
              >
                <Icon
                  icon={TABLE_THRESHOLD_ICONS[entry.level]}
                  className="h-3.5 w-3.5 flex-none"
                  thick={ThickProp.Thick}
                />
                <span className="min-w-0 break-words">{entry.rule}</span>
              </div>
            );
          })}
        </div>
        {isTableThresholdOrderReversed(inForce) ? (
          <p
            className="mt-2 text-xs text-amber-700"
            data-testid={`table-column-thresholds-reversed-${props.columnId}`}
          >
            {direction === TableThresholdDirection.LowerIsWorse
              ? translator.translateText(
                  "Critical should be at or below Warning.",
                )
              : translator.translateText(
                  "Critical should be at or above Warning.",
                )}
          </p>
        ) : (
          <></>
        )}
      </>
    );
  };

  return (
    <div
      className="mt-3 pt-3 border-t border-gray-200"
      data-testid={`table-column-thresholds-${props.columnId}`}
    >
      <label className="flex items-center gap-2 text-xs text-gray-700 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={isOn}
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
            props.onChange(
              e.target.checked
                ? getTableThresholdPreset(props.display)
                : undefined,
            );
          }}
          className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          data-testid={`table-column-thresholds-toggle-${props.columnId}`}
        />
        {translator.translateText("Color by thresholds")}
      </label>

      {isOn ? (
        <div className="mt-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ThresholdNumberField
              label="Warning at"
              unit={props.display.unit}
              value={stored.warning}
              dataTestId={`table-column-thresholds-warning-${props.columnId}`}
              onChange={(value: number | undefined): void => {
                writeNumber("warning", value);
              }}
            />
            <ThresholdNumberField
              label="Critical at"
              unit={props.display.unit}
              value={stored.critical}
              dataTestId={`table-column-thresholds-critical-${props.columnId}`}
              onChange={(value: number | undefined): void => {
                writeNumber("critical", value);
              }}
            />
            <div>
              <span
                id={directionLabelId}
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                {translator.translateText("Direction")}
              </span>
              <Dropdown
                options={DIRECTION_OPTIONS}
                value={DIRECTION_OPTIONS.find(
                  (option: DropdownOption): boolean => {
                    return option.value === direction;
                  },
                )}
                isClearable={false}
                ariaLabelledby={directionLabelId}
                dataTestId={`table-column-thresholds-direction-${props.columnId}`}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ): void => {
                  props.onChange({
                    ...stored,
                    direction: readTableThresholdDirection(value),
                  });
                }}
              />
            </div>
          </div>
          {renderStatus()}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TableColumnThresholdsEditor;
