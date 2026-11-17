import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  findDropdownOption,
  getTranslatedDropdownOption,
  readPickedDropdownValue,
} from "Common/UI/Components/Dropdown/DropdownChoices";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  FILTER_OPERATOR_LABELS,
  FilterOperator,
} from "./FilterChipDropdownTypes";

/*
 * The row at the top of a filter chip's popover that says how its values
 * are compared: "Status [is not]". The option, value and date chips share
 * it. The operator is the shared Dropdown, so its size, border, focus ring,
 * menu and dark look are every other picker's (#9294); it was a raw select
 * with classes of its own in each chip. An operator is always set, so it
 * has no clear control. Its menu is drawn over the page, and a pick there
 * leaves the popover open (UseComponentOutsideClick).
 */

export const FILTER_CHIP_OPERATOR_ROW_CLASSES: string =
  "flex items-center gap-1.5 border-b border-gray-100 px-2 py-1.5 text-xs text-gray-500";

export const FILTER_CHIP_OPERATOR_DROPDOWN_CLASSES: string =
  "relative min-w-0 flex-1 overflow-visible";

export interface ComponentProps {
  // The facet's name, in English: "Status".
  label: string;
  operator: FilterOperator;
  operators: Array<FilterOperator>;
  onChange: (operator: FilterOperator) => void;
}

// Each operator, in the reader's words already ("ist nicht").
export function getFilterChipOperatorOptions(
  operators: Array<FilterOperator>,
  translator: Translator,
): Array<DropdownOption> {
  return operators.map((operator: FilterOperator): DropdownOption => {
    return getTranslatedDropdownOption(
      operator,
      translator.translateText(FILTER_OPERATOR_LABELS[operator]) ||
        FILTER_OPERATOR_LABELS[operator],
    );
  });
}

const FilterChipOperatorPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const options: Array<DropdownOption> = getFilterChipOperatorOptions(
    props.operators,
    translator,
  );

  return (
    <div className={FILTER_CHIP_OPERATOR_ROW_CLASSES}>
      <span className="shrink-0">
        {translator.translateTerm(props.label, { inSentence: true })}
      </span>
      <Dropdown
        className={FILTER_CHIP_OPERATOR_DROPDOWN_CLASSES}
        options={options}
        value={findDropdownOption(options, props.operator)}
        isClearable={false}
        ariaLabel={translator.translateTemplate("{{label}} operator", {
          label: translatableTerm(props.label),
        })}
        isAriaLabelTranslated={true}
        onChange={(next: DropdownValue | Array<DropdownValue> | null): void => {
          const picked: string | null = readPickedDropdownValue(next);

          if (picked === null || picked === props.operator) {
            return;
          }

          props.onChange(picked as FilterOperator);
        }}
      />
    </div>
  );
};

export default FilterChipOperatorPicker;
