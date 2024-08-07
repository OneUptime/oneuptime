import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import GenericObject from "Common/Types/GenericObject";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type EntityFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const EntityFilter: EntityFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;
  const filterData: FilterData<T> = { ...props.filterData };

  const dropdownValues: Array<DropdownOption> =
    props.filter.filterDropdownOptions?.filter((option: DropdownOption) => {
      if (filterData[filter.key] instanceof Array) {
        return (filterData[filter.key] as Array<string>)
          .map((value: string) => {
            return value.toString();
          })
          .includes(option.value.toString());
      }

      return option.value.toString() === filterData[filter.key]?.toString();
    }) || [];

  if (
    (filter.type === FieldType.Entity ||
      filter.type === FieldType.EntityArray) &&
    filter.filterDropdownOptions
  ) {
    return (
      <Dropdown
        options={filter.filterDropdownOptions}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (!filter.key) {
            return;
          }

          if (!value || (Array.isArray(value) && value.length === 0)) {
            delete filterData[filter.key];
          } else {
            filterData[filter.key] = value;
          }

          if (props.onFilterChanged) {
            props.onFilterChanged(filterData);
          }
        }}
        value={dropdownValues}
        isMultiSelect={filter.type === FieldType.EntityArray}
        placeholder={`Filter by ${filter.title}`}
      />
    );
  }

  return <></>;
};

export default EntityFilter;
