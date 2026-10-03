import Dropdown, { DropdownValue } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import GenericObject from "../../../Types/GenericObject";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { getFilterPlaceholder } from "./FilterPlaceholder";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type BooleanFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const BooleanFilter: BooleanFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const filter: Filter<T> = props.filter;
  const filterData: FilterData<T> = { ...props.filterData };

  if (filter.type === FieldType.Boolean) {
    return (
      <Dropdown
        options={[
          {
            value: true,
            label: "Yes",
          },
          {
            value: false,
            label: "No",
          },
        ]}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (!filter.key) {
            return;
          }

          if (value === null) {
            delete filterData[filter.key];
          } else {
            filterData[filter.key] = value;
          }

          if (props.onFilterChanged) {
            props.onFilterChanged(filterData);
          }
        }}
        placeholder={getFilterPlaceholder(translator, filter.title)}
        className="relative rounded-md w-full overflow-visible"
      />
    );
  }

  return <></>;
};

export default BooleanFilter;
