import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import FieldLabelElement from "../Forms/Fields/FieldLabel";
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

  return (
    <div id={props.id}>
      <div className="pt-2 pb-4">
        <div className="space-y-4">
          {props.showFilter &&
            props.filters &&
            props.filters
              .filter((filter: Filter<T>) => {
                if (filter.isAdvancedFilter) {
                  return (
                    showMoreFilters &&
                    !props.isFilterLoading &&
                    !props.filterError
                  );
                }
                return true;
              })
              .map((filter: Filter<T>, i: number) => {
                const hasValue: boolean =
                  filter.key !== undefined &&
                  props.filterData[filter.key] !== undefined &&
                  props.filterData[filter.key] !== null;

                return (
                  <div
                    key={i}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <FieldLabelElement
                        title={filter.title}
                        hideOptionalLabel={true}
                        className="block text-sm font-semibold text-gray-800"
                      />
                      {hasValue && filter.key && (
                        <button
                          type="button"
                          onClick={() => {
                            return clearFilter(filter.key as keyof T);
                          }}
                          className="text-xs text-gray-400 hover:text-gray-600 ml-2"
                          aria-label={`Clear ${filter.title} filter`}
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <DropdownFilter
                      filter={filter}
                      filterData={props.filterData}
                      onFilterChanged={changeFilterData}
                      isMultiSelect={
                        filter.type === FieldType.MultiSelectDropdown
                      }
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
          <ComponentLoader />
        )}

        {props.showFilter && props.filterError && (
          <ErrorMessage
            message={props.filterError}
            onRefreshClick={props.onFilterRefreshClick}
          />
        )}
        {showAdvancedFilterButton && (
          <Button
            className="-ml-3 mt-2"
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            icon={showMoreFilters ? IconProp.ChevronUp : IconProp.ChevronDown}
            title={
              showMoreFilters
                ? "Hide Advanced Filters"
                : "Show Advanced Filters"
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
    </div>
  );
};

export default FiltersForm;
