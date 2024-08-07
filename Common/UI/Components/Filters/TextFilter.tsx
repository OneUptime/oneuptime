import Input, { InputType } from "../Input/Input";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import Search from "Common/Types/BaseDatabase/Search";
import DatabaseDate from "Common/Types/Database/Date";
import OneUptimeDate from "Common/Types/Date";
import GenericObject from "Common/Types/GenericObject";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type TextFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TextFilter: TextFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;
  const filterData: FilterData<T> = { ...props.filterData };

  let inputType: InputType = InputType.TEXT;

  if (filter.type === FieldType.Date) {
    inputType = InputType.DATE;
  } else if (filter.type === FieldType.DateTime) {
    inputType = InputType.DATETIME_LOCAL;
  }

  if (
    !filter.filterDropdownOptions &&
    (filter.type === FieldType.Email ||
      filter.type === FieldType.Phone ||
      filter.type === FieldType.Name ||
      filter.type === FieldType.Port ||
      filter.type === FieldType.URL ||
      filter.type === FieldType.ObjectID ||
      filter.type === FieldType.Text)
  ) {
    return (
      <Input
        onChange={(changedValue: string | Date) => {
          if (filter.key) {
            if (!changedValue) {
              delete filterData[filter.key];
            }

            if (
              changedValue &&
              (filter.type === FieldType.Date ||
                filter.type === FieldType.DateTime)
            ) {
              filterData[filter.key] =
                OneUptimeDate.asFilterDateForDatabaseQuery(
                  changedValue as string,
                );
            }

            if (changedValue && filter.type === FieldType.DateTime) {
              filterData[filter.key] =
                DatabaseDate.asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
                  changedValue,
                );
            }

            if (
              changedValue &&
              (filter.type === FieldType.Text ||
                filter.type === FieldType.Email ||
                filter.type === FieldType.Phone ||
                filter.type === FieldType.Name ||
                filter.type === FieldType.Port ||
                filter.type === FieldType.URL ||
                filter.type === FieldType.ObjectID)
            ) {
              filterData[filter.key] = new Search(changedValue.toString());
            }

            if (props.onFilterChanged) {
              props.onFilterChanged(filterData);
            }
          }
        }}
        initialValue={(filterData[filter.key] || "").toString()}
        placeholder={`Filter by ${filter.title}`}
        type={inputType}
      />
    );
  }

  return <></>;
};

export default TextFilter;
