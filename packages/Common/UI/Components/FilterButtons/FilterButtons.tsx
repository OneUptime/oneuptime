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
}

const FilterButtons: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className={`inline-flex gap-1 ${props.className || ""}`}
      role="radiogroup"
      aria-label="Filter options"
    >
      {props.options.map((option: FilterButtonOption) => {
        const isActive: boolean = props.selectedValue === option.value;
        return (
          <button
            key={option.value}
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
            {option.label}
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
