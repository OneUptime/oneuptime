import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import DictionaryForm, { ValueType } from "../Dictionary/Dictionary";
import { DictionaryEntryValue } from "../Dictionary/DictionaryFilterOperator";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import Dictionary from "../../../Types/Dictionary";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
  jsonKeys?: Array<string> | undefined;
  jsonValueSuggestions?: Record<string, Array<string>> | undefined;
  onJsonKeySelected?: ((key: string) => void) | undefined;
  isLoadingJsonKeys?: boolean | undefined;
  loadingJsonValueKeys?: Array<string> | undefined;
  enableOperators?: boolean | undefined;
}

type JSONFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const JSONFilter: JSONFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;
  const filterData: FilterData<T> = { ...props.filterData };

  if (filter.type === FieldType.JSON) {
    return (
      <DictionaryForm
        keys={props.jsonKeys}
        valueSuggestions={props.jsonValueSuggestions}
        onKeySelected={props.onJsonKeySelected}
        isLoadingKeys={props.isLoadingJsonKeys}
        loadingValueKeys={props.loadingJsonValueKeys}
        enableOperators={props.enableOperators}
        addButtonSuffix={filter.title}
        keyPlaceholder={"Key"}
        valuePlaceholder={"Value"}
        valueTypes={[ValueType.Text]}
        initialValue={
          (filterData[filter.key] as Dictionary<DictionaryEntryValue>) || {}
        }
        onChange={(value: Dictionary<DictionaryEntryValue>) => {
          // if no keys in the dictionary, remove the filter

          if (Object.keys(value).length > 0) {
            filterData[filter.key] = value as FindWhereProperty<
              NonNullable<T[keyof T]>
            >;
          } else {
            delete filterData[filter.key];
          }

          if (props.onFilterChanged) {
            props.onFilterChanged(filterData);
          }
        }}
      />
    );
  }

  return <></>;
};

export default JSONFilter;
