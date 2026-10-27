import React, { FunctionComponent, ReactElement } from "react";
import {
  TableColumnThresholds,
  TableThresholdLevel,
  TableThresholdStyle,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import {
  formatTableValue,
  getTableThresholdLevel,
  roundTableValue,
} from "Common/Utils/Dashboard/TableThresholds";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  TABLE_THRESHOLD_CELL_CLASS_NAMES,
  TABLE_THRESHOLD_ICONS,
  TABLE_VALUE_CELL_CLASS_NAME,
  getTableThresholdOfLevel,
  getTableThresholdRule,
} from "./DashboardTableThresholdCopy";

// What a metric table knows about a value column, to draw one of its cells.
export interface DashboardTableValueCellColumn {
  decimals: number | undefined;
  // The unit after each value; undefined for none.
  unit: string | undefined;
  // What a stored value is multiplied by first: 100 for a fraction shown as a percent.
  factor: number;
  // Read with readTableColumnThresholds; null when the column has none.
  thresholds: TableColumnThresholds | null;
}

export interface ComponentProps {
  // The stored value, before the column's factor; undefined or NaN for none.
  value: number | undefined;
  column: DashboardTableValueCellColumn;
  // The table's decimals, for a column that sets none.
  defaultDecimals: number;
  thresholdStyle: TableThresholdStyle;
}

const CELL_CLASS_NAME: string = "px-3 py-2 text-right tabular-nums text-xs";

/*
 * One value of a metric table (issue #5231): the number in the column's
 * unit, and - when it has reached one of the column's thresholds - colored
 * amber or red, with the level's shape before it and the threshold it
 * reached said to the pointer and to a screen reader. The shape goes BEFORE
 * the number, so the numbers of a column still line up at their end.
 */
const DashboardTableValueCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.value === undefined || !Number.isFinite(props.value)) {
    return (
      <td className={`${CELL_CLASS_NAME} ${TABLE_VALUE_CELL_CLASS_NAME}`}>
        <span className="text-gray-300">—</span>
      </td>
    );
  }

  /*
   * The number on screen, rounded to the column's decimals, is what the
   * thresholds read: a cell that says 80% is at a warning of 80.
   */
  const decimals: number = props.column.decimals ?? props.defaultDecimals;
  const shown: number = roundTableValue(
    props.value * props.column.factor,
    decimals,
  );
  const text: string = formatTableValue({
    value: shown,
    decimals,
    unit: props.column.unit,
  });

  const level: TableThresholdLevel | null = getTableThresholdLevel({
    value: shown,
    thresholds: props.column.thresholds,
  });
  const threshold: number | undefined =
    level && props.column.thresholds
      ? getTableThresholdOfLevel(props.column.thresholds, level)
      : undefined;

  if (!level || threshold === undefined || !props.column.thresholds) {
    return (
      <td className={`${CELL_CLASS_NAME} ${TABLE_VALUE_CELL_CLASS_NAME}`}>
        {text}
      </td>
    );
  }

  const rule: string = getTableThresholdRule({
    translator,
    level,
    threshold,
    direction: props.column.thresholds.direction,
    unit: props.column.unit,
  });

  return (
    <td
      className={`${CELL_CLASS_NAME} ${TABLE_THRESHOLD_CELL_CLASS_NAMES[props.thresholdStyle][level]}`}
      title={rule}
      data-threshold-level={level}
    >
      <div className="inline-flex items-center gap-1 align-middle">
        <Icon
          icon={TABLE_THRESHOLD_ICONS[level]}
          className="h-3.5 w-3.5 flex-none"
          thick={ThickProp.Thick}
          ariaLabel={rule}
        />
        <span>{text}</span>
      </div>
    </td>
  );
};

export default DashboardTableValueCell;
