import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface FilterButtonOption {
  label: string;
  value: string;
  badge?: number | undefined;
}

export interface ComponentProps {
  options: Array<FilterButtonOption>;
  selectedValue: string;
  onSelect: (value: string) => void;
  className?: string | undefined;
  /*
   * What the group filters by ("Status", "Name"), in English: looked up in
   * the reader's language here. Two groups on one screen that are both
   * "Filter options" to a screen reader cannot be told apart.
   */
  ariaLabel?: string | undefined;
  /*
   * Each option's test id: this, a dash and the option's value
   * ("retrohunt-period-168").
   */
  dataTestId?: string | undefined;
}

const FilterButtons: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className={`inline-flex gap-1 ${props.className || ""}`}
      role="radiogroup"
      aria-label={translator.translateText(props.ariaLabel || "Filter options")}
    >
      {props.options.map((option: FilterButtonOption) => {
        const isActive: boolean = props.selectedValue === option.value;
        return (
          <button
            key={option.value}
            /*
             * A choice, never a submit: inside a form (a rule's Run on Past
             * Events, say) a bare <button> would send the form.
             */
            type="button"
            data-testid={
              props.dataTestId
                ? `${props.dataTestId}-${option.value}`
                : undefined
            }
            onClick={() => {
              props.onSelect(option.value);
            }}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all duration-150 ${
              isActive
                ? "bg-indigo-100 text-indigo-800 ring-1 ring-inset ring-indigo-200"
                : "bg-white text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-50 hover:text-gray-800"
            }`}
            role="radio"
            aria-checked={isActive}
          >
            {translator.translateText(option.label)}
            {option.badge !== undefined && option.badge > 0 && (
              <span
                className={`ml-1.5 inline-flex min-w-[1.25rem] justify-center px-1 py-0 text-[10px] rounded-full ${
                  isActive
                    ? "bg-indigo-200 text-indigo-900"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default FilterButtons;
