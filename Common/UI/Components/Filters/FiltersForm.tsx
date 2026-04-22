import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import FieldType from "../Types/FieldType";
import IconProp from "../../../Types/Icon/IconProp";
import BooleanFilter from "./BooleanFilter";
import DateFilter from "./DateFilter";
import DropdownFilter from "./DropdownFilter";
import EntityFilter from "./EntityFilter";
import JSONFilter from "./JSONFilter";
import NumberFilter from "./NumberFilter";
import TextFilter from "./TextFilter";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import GenericObject from "../../../Types/GenericObject";
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
  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);
  showAdvancedFiltersByDefault?: boolean | undefined;
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

  const [showMoreFilters, setShowMoreFilters] = React.useState<boolean>(
    props.showAdvancedFiltersByDefault ?? false,
  );

  type ClearFilterFunction = (key: keyof T) => void;

  const clearFilter: ClearFilterFunction = (key: keyof T): void => {
    const next: FilterData<T> = { ...props.filterData };
    delete next[key];
    changeFilterData(next);
  };

  const visibleFilters: Array<Filter<T>> = props.filters.filter(
    (filter: Filter<T>) => {
      if (filter.isAdvancedFilter) {
        return (
          showMoreFilters && !props.isFilterLoading && !props.filterError
        );
      }
      return true;
    },
  );

  return (
    <div id={props.id}>
      <div className="divide-y divide-gray-100">
        {visibleFilters.map((filter: Filter<T>, i: number) => {
          const hasValue: boolean =
            filter.key !== undefined &&
            props.filterData[filter.key] !== undefined &&
            props.filterData[filter.key] !== null;

          return (
            <div key={i} className="py-3 first:pt-0">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700">
                  {filter.title}
                </label>
                {hasValue && filter.key && (
                  <button
                    type="button"
                    onClick={() => {
                      return clearFilter(filter.key as keyof T);
                    }}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    aria-label={`Clear ${filter.title} filter`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Clear
                  </button>
                )}
              </div>

              <DropdownFilter
                filter={filter}
                filterData={props.filterData}
                onFilterChanged={changeFilterData}
                isMultiSelect={filter.type === FieldType.MultiSelectDropdown}
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

              <NumberFilter
                filter={filter}
                filterData={props.filterData}
                onFilterChanged={changeFilterData}
              />

              <JSONFilter
                filter={filter}
                filterData={props.filterData}
                onFilterChanged={changeFilterData}
                jsonKeys={filter.jsonKeys}
                jsonValueSuggestions={filter.jsonValueSuggestions}
                onJsonKeySelected={filter.onJsonKeySelected}
              />
            </div>
          );
        })}
      </div>
      {props.showFilter && props.isFilterLoading && !props.filterError && (
        <div className="py-4">
          <ComponentLoader />
        </div>
      )}

      {props.showFilter && props.filterError && (
        <div className="py-4">
          <ErrorMessage
            message={props.filterError}
            onRefreshClick={props.onFilterRefreshClick}
          />
        </div>
      )}
      {showAdvancedFilterButton && (
        <Button
          className="-ml-3 mt-2"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          icon={showMoreFilters ? IconProp.ChevronUp : IconProp.ChevronDown}
          title={
            showMoreFilters ? "Hide Advanced Filters" : "Show Advanced Filters"
          }
          onClick={() => {
            setShowMoreFilters((currentValue: boolean) => {
              const newValue: boolean = !currentValue;
              props.onAdvancedFiltersToggle?.(newValue);
              return newValue;
            });
          }}
        />
      )}
    </div>
  );
};

export default FiltersForm;
