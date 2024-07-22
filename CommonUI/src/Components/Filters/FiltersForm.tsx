import Button, { ButtonStyleType } from "../Button/Button";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import FieldLabelElement from "../Forms/Fields/FieldLabel";
import BooleanFilter from "./BooleanFilter";
import DateFilter from "./DateFilter";
import DropdownFilter from "./DropdownFilter";
import EntityFilter from "./EntityFilter";
import JSONFilter from "./JSONFilter";
import TextFilter from "./TextFilter";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import GenericObject from "Common/Types/GenericObject";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  filters: Array<Filter<T>>;
  id: string;
  showFilter: boolean;
  filterData: FilterData<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  isFilterLoading?: undefined | boolean;
  filterError?: string | undefined;
  onFilterRefreshClick?: undefined | (() => void);
}

type FiltersFormFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const FiltersForm: FiltersFormFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  if (!props.showFilter) {
    return <></>;
  }

  type ChangeFilterDataFunction = (filterData: FilterData<T>) => void;

  const changeFilterData: ChangeFilterDataFunction = (
    filterData: FilterData<T>,
  ): void => {
    if (props.onFilterChanged) {
      props.onFilterChanged(filterData);
    }
  };

  const showAdvancedFilterButton: boolean = Boolean(
    props.filters.find((filter: Filter<T>) => {
      return filter.isAdvancedFilter;
    }),
  );

  const [showMoreFilters, setShowMoreFilters] = React.useState<boolean>(false);

  return (
    <div id={props.id}>
      <div className="pt-3 pb-5">
        <div className="space-y-5">
          {props.showFilter &&
            !props.isFilterLoading &&
            !props.filterError &&
            props.filters &&
            props.filters
              .filter((filter: Filter<T>) => {
                return !filter.isAdvancedFilter || showMoreFilters;
              })
              .map((filter: Filter<T>, i: number) => {
                return (
                  <div key={i} className="col-span-3 sm:col-span-3 ">
                    <FieldLabelElement required={true} title={filter.title} />

                    <DropdownFilter
                      filter={filter}
                      filterData={props.filterData}
                      onFilterChanged={changeFilterData}
                    />

                    <EntityFilter
                      filter={filter}
                      filterData={props.filterData}
                      onFilterChanged={changeFilterData}
                    />

                    <BooleanFilter
                      filter={filter}
                      filterData={props.filterData}
                      onFilterChanged={changeFilterData}
                    />

                    <DateFilter
                      filter={filter}
                      filterData={props.filterData}
                      onFilterChanged={changeFilterData}
                    />

                    <TextFilter
                      filter={filter}
                      filterData={props.filterData}
                      onFilterChanged={changeFilterData}
                    />

                    <JSONFilter
                      filter={filter}
                      filterData={props.filterData}
                      onFilterChanged={changeFilterData}
                      jsonKeys={filter.jsonKeys}
                    />
                  </div>
                );
              })}
        </div>
        {showAdvancedFilterButton && (
          <Button
            className="-ml-3 mt-1"
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            title={
              showMoreFilters
                ? "Hide Advanced Filters"
                : "Show Advanced Filters"
            }
            onClick={() => {
              setShowMoreFilters(!showMoreFilters);
            }}
          />
        )}
      </div>
      {props.showFilter && props.isFilterLoading && !props.filterError && (
        <ComponentLoader />
      )}

      {props.showFilter && props.filterError && (
        <ErrorMessage
          error={props.filterError}
          onRefreshClick={props.onFilterRefreshClick}
        />
      )}
    </div>
  );
};

export default FiltersForm;
