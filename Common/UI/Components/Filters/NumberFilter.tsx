import Input, { InputType } from "../Input/Input";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type NumberFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const NumberFilter: NumberFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;
  const filterData: FilterData<T> = { ...props.filterData };

  const inputType: InputType = InputType.NUMBER;

  if (!filter.filterDropdownOptions && filter.type === FieldType.Number) {
    return (
      <Input
        onChange={(changedValue: string | number) => {
          if (filter.key) {
            if (!changedValue) {
              delete filterData[filter.key];
            }

            if (changedValue && filter.type === FieldType.Number) {
              if (typeof changedValue === "string") {
                changedValue = parseInt(changedValue);
              }

              filterData[filter.key] = changedValue;
            }

            if (props.onFilterChanged) {
              props.onFilterChanged(filterData);
            }
          }
        }}
        initialValue={filterData[filter.key]! as string}
        placeholder={`Filter by ${filter.title}`}
        type={inputType}
      />
    );
  }

  return <></>;
};

export default NumberFilter;
