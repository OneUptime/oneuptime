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
    <div className="relative inline-block shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev: boolean) => {
            return !prev;
          });
        }}
        className="inline-flex items-center justify-between gap-1.5 h-9 px-3 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-w-[130px]"
      >
        <span className="truncate">{FilterOperatorLabel[props.value]}</span>
        <Icon
          icon={IconProp.ChevronDown}
          size={SizeProp.Smaller}
          className="text-gray-400 shrink-0"
        />
      </button>
      {isOpen && (
        <div className="absolute z-20 mt-1 w-56 bg-white rounded-md shadow-lg border border-gray-200 py-1 max-h-60 overflow-auto">
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
                    ? "w-full text-left px-3 py-2 text-sm text-indigo-700 bg-indigo-50 hover:bg-indigo-100 flex items-center justify-between"
                    : "w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between"
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
