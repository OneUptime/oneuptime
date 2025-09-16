import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface FilterChip {
  label: string;
  onRemove: () => void;
}
export interface FilterChipsProps {
  chips: Array<FilterChip>;
}

const FilterChips: FunctionComponent<FilterChipsProps> = ({
  chips,
}: FilterChipsProps): ReactElement | null => {
  if (!chips.length) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip, i) => {
        return (
          <button
            key={i}
            className="flex items-center space-x-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-3 py-0.5 text-xs hover:bg-indigo-100"
            onClick={chip.onRemove}
          >
            <span>{chip.label}</span>
            <Icon icon={IconProp.Close} className="h-3 w-3" />
          </button>
        );
      })}
    </div>
  );
};

export default FilterChips;
