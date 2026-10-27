import React, { FunctionComponent, ReactElement } from "react";
import {
  TableThresholdLevel,
  TableThresholdStyle,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { formatTableValue } from "Common/Utils/Dashboard/TableThresholds";
import ChoiceRows, {
  ChoiceRowOption,
} from "Common/UI/Components/ChoiceRows/ChoiceRows";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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

// What each choice does, in a line under its title (English; looked up when drawn).
const DESCRIPTIONS: Readonly<Record<TableThresholdStyle, string>> = {
  [TableThresholdStyle.Text]: translationKey("The number turns amber or red."),
  [TableThresholdStyle.Background]: translationKey(
    "The whole cell turns amber or red.",
  ),
};

/*
 * The values each choice's picture shows, one a level: a warning and a
 * critical one, as a column of the table holds them.
 */
const SAMPLE_VALUES: ReadonlyArray<{
  level: TableThresholdLevel;
  text: string;
}> = [
  {
    level: TableThresholdLevel.Warning,
    text: formatTableValue({ value: 84, decimals: 0, unit: "%" }),
  },
  {
    level: TableThresholdLevel.Critical,
    text: formatTableValue({ value: 93, decimals: 0, unit: "%" }),
  },
];

/*
 * A choice's picture: two cells of a column, a warning above a critical,
 * drawn with the very classes the table draws them with - so Colored text
 * shows two colored numbers on a plain column, and Colored background two
 * filled cells. It fills ChoiceRows' picture slot (54x36, 72x48 from sm).
 */
export const TableThresholdStyleVisual: FunctionComponent<{
  thresholdStyle: TableThresholdStyle;
}> = (props: { thresholdStyle: TableThresholdStyle }): ReactElement => {
  return (
    <div
      className="grid h-9 grid-rows-2 divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white text-[10px] leading-none tabular-nums sm:h-12 sm:text-xs"
      data-threshold-style={props.thresholdStyle}
    >
      {SAMPLE_VALUES.map(
        (sample: { level: TableThresholdLevel; text: string }) => {
          return (
            <div
              key={sample.level}
              className={`flex min-w-0 items-center justify-end gap-0.5 px-1.5 sm:gap-1 ${TABLE_THRESHOLD_CELL_CLASS_NAMES[props.thresholdStyle][sample.level]}`}
              data-threshold-level={sample.level}
            >
              <Icon
                icon={TABLE_THRESHOLD_ICONS[sample.level]}
                className="h-2.5 w-2.5 flex-none sm:h-3 sm:w-3"
                thick={ThickProp.Thick}
              />
              <span>{sample.text}</span>
            </div>
          );
        },
      )}
    </div>
  );
};

/*
 * How the whole table colors a value past a column's threshold (issue
 * #5231): its number, or its whole cell. Shown under the columns once one
 * of them is colored by thresholds - before that it changes nothing - as
 * the product's choice rows (ChoiceRows), each with a picture of a column
 * drawn that way, so the words need no explaining.
 */
const TableThresholdStylePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const options: Array<ChoiceRowOption<TableThresholdStyle>> = OPTIONS.map(
    (option: StyleOption): ChoiceRowOption<TableThresholdStyle> => {
      return {
        value: option.value,
        title: option.title,
        description: DESCRIPTIONS[option.value],
        visual: <TableThresholdStyleVisual thresholdStyle={option.value} />,
        dataTestId: `table-threshold-style-${option.value}`,
      };
    },
  );

  return (
    <div className="mt-4" data-testid="table-threshold-style">
      <p className="block text-sm font-medium text-gray-700">
        {translator.translateText("Threshold colors")}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {translator.translateText(
          "How every column colors a value that reaches its warning or critical threshold.",
        )}
      </p>
      <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ChoiceRows<TableThresholdStyle>
          ariaLabel="Threshold colors"
          value={props.value}
          options={options}
          onPick={(value: TableThresholdStyle): void => {
            props.onChange(value);
          }}
        />
      </div>
    </div>
  );
};

export default TableThresholdStylePicker;
