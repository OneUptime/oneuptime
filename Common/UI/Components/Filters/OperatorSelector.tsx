import IconProp from "../../../Types/Icon/IconProp";
import Icon, { SizeProp } from "../Icon/Icon";
import FilterOperator, { FilterOperatorLabel } from "./Types/FilterOperator";
import React, { ReactElement, useEffect, useRef, useState } from "react";

export interface ComponentProps {
  value: FilterOperator;
  options: Array<FilterOperator>;
  onChange: (value: FilterOperator) => void;
}

const OperatorSelector: React.FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    type HandleClickOutsideFunction = (event: MouseEvent) => void;
    const handleClickOutside: HandleClickOutsideFunction = (
      event: MouseEvent,
    ): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev: boolean) => {
            return !prev;
          });
        }}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <span>{FilterOperatorLabel[props.value]}</span>
        <Icon
          icon={IconProp.ChevronDown}
          size={SizeProp.Smaller}
          className="text-gray-500"
        />
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 w-56 bg-white rounded-md shadow-lg border border-gray-200 py-1 max-h-60 overflow-auto">
          {props.options.map((option: FilterOperator) => {
            const isSelected: boolean = option === props.value;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  props.onChange(option);
                  setIsOpen(false);
                }}
                className={
                  isSelected
                    ? "w-full text-left px-3 py-1.5 text-xs text-indigo-700 bg-indigo-50 hover:bg-indigo-100 flex items-center justify-between"
                    : "w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center justify-between"
                }
              >
                <span>{FilterOperatorLabel[option]}</span>
                {isSelected && (
                  <Icon
                    icon={IconProp.Check}
                    size={SizeProp.Smaller}
                    className="text-indigo-600"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OperatorSelector;
