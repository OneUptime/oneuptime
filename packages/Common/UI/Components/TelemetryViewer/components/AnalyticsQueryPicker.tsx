import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../Dropdown/Dropdown";
import {
  findDropdownOption,
  getNamedDropdownOption,
  getTranslatedDropdownOption,
  readPickedDropdownValue,
} from "../../Dropdown/DropdownChoices";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One picker of an analytics query builder - the logs' and the traces'
 * Chart, Measure, Group by, then by, Limit / Top. It was a raw <select>
 * with a size and focus ring of its own (#9310); it is the shared Dropdown,
 * compact as the bar's other controls are.
 *
 * A choice whose value is "" ("None", "Select field...") is the placeholder,
 * not an option: clearing the picker picks it. A picker without one always
 * holds a value, so it has no clear control.
 */

export interface AnalyticsQueryChoice {
  value: string | number;
  label: string;
}

export interface ComponentProps {
  // What names the picker for a screen reader, as its caption reads.
  ariaLabel: string;
  /*
   * The name is in the reader's words already (the caption beside it):
   * said as given. Left out, it is English, looked up by the picker.
   */
  isAriaLabelTranslated?: boolean | undefined;
  value: string | number;
  onChange: (value: string) => void;
  options: Array<AnalyticsQueryChoice>;
  /*
   * "translated": the labels are in the reader's language already, drawn
   * the page's way. "named": the labels are drawn as written, and read the
   * way their letters do - an attribute's name.
   */
  labels: "translated" | "named";
  dataTestId?: string | undefined;
}

export const EMPTY_ANALYTICS_QUERY_CHOICE: string = "";

// The picker's width: a number ("25") needs little room, a field's name more.
export function getAnalyticsQueryPickerClassName(
  options: Array<AnalyticsQueryChoice>,
): string {
  const isNumbers: boolean =
    options.length > 0 &&
    options.every((option: AnalyticsQueryChoice): boolean => {
      return typeof option.value === "number";
    });

  return `relative ${isNumbers ? "w-20" : "w-44"} max-w-full overflow-visible`;
}

const AnalyticsQueryPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const emptyChoice: AnalyticsQueryChoice | undefined = props.options.find(
    (option: AnalyticsQueryChoice): boolean => {
      return option.value === EMPTY_ANALYTICS_QUERY_CHOICE;
    },
  );

  const options: Array<DropdownOption> = props.options
    .filter((option: AnalyticsQueryChoice): boolean => {
      return option.value !== EMPTY_ANALYTICS_QUERY_CHOICE;
    })
    .map((option: AnalyticsQueryChoice): DropdownOption => {
      return props.labels === "translated"
        ? getTranslatedDropdownOption(option.value, option.label)
        : getNamedDropdownOption(option.value, option.label);
    });

  return (
    <div data-testid={props.dataTestId}>
      <Dropdown
        className={getAnalyticsQueryPickerClassName(props.options)}
        isCompact={true}
        ariaLabel={props.ariaLabel}
        isAriaLabelTranslated={props.isAriaLabelTranslated}
        options={options}
        value={findDropdownOption(options, props.value)}
        placeholder={emptyChoice?.label}
        isPlaceholderTranslated={true}
        isClearable={Boolean(emptyChoice)}
        onChange={(next: DropdownValue | Array<DropdownValue> | null): void => {
          const picked: string | null = readPickedDropdownValue(next);

          if (picked === null) {
            // Cleared: back to the empty choice, when the picker has one.
            if (emptyChoice) {
              props.onChange(EMPTY_ANALYTICS_QUERY_CHOICE);
            }
            return;
          }

          if (picked !== String(props.value)) {
            props.onChange(picked);
          }
        }}
      />
    </div>
  );
};

export default AnalyticsQueryPicker;
