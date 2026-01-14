import IconProp from "../../../Types/Icon/IconProp";
import Icon, { SizeProp } from "../Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface CardSelectOption {
  value: string;
  title: string;
  description: string;
  icon: IconProp;
}

export interface ComponentProps {
  options: Array<CardSelectOption>;
  value?: string | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
  tabIndex?: number | undefined;
  dataTestId?: string | undefined;
}

const CardSelect: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div data-testid={props.dataTestId}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {props.options.map((option: CardSelectOption, index: number) => {
          const isSelected: boolean = props.value === option.value;

          return (
            <div
              key={index}
              tabIndex={props.tabIndex ? props.tabIndex + index : index}
              onClick={() => {
                props.onChange(option.value);
              }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onChange(option.value);
                }
              }}
              className={`relative flex cursor-pointer rounded-lg border p-4 shadow-sm focus:outline-none transition-all duration-200 hover:border-indigo-500 hover:shadow-md ${
                isSelected
                  ? "border-indigo-600 ring-2 ring-indigo-600 bg-indigo-50"
                  : "border-gray-300 bg-white"
              }`}
              role="radio"
              aria-checked={isSelected}
              data-testid={`card-select-option-${option.value}`}
            >
              <div className="flex w-full items-start">
                <div
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                    isSelected ? "bg-indigo-600" : "bg-gray-100"
                  }`}
                >
                  <Icon
                    icon={option.icon}
                    size={SizeProp.Large}
                    className={`h-5 w-5 ${
                      isSelected ? "text-white" : "text-gray-600"
                    }`}
                  />
                </div>
                <div className="ml-4 flex-1">
                  <span
                    className={`block text-sm font-semibold ${
                      isSelected ? "text-indigo-900" : "text-gray-900"
                    }`}
                  >
                    {option.title}
                  </span>
                  <span
                    className={`mt-1 block text-sm ${
                      isSelected ? "text-indigo-700" : "text-gray-500"
                    }`}
                  >
                    {option.description}
                  </span>
                </div>
                {isSelected && (
                  <div className="flex-shrink-0 ml-2">
                    <Icon
                      icon={IconProp.CheckCircle}
                      size={SizeProp.Large}
                      className="h-5 w-5 text-indigo-600"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {props.error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default CardSelect;
