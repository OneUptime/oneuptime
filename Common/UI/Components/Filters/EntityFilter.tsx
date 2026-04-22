import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import GenericObject from "../../../Types/GenericObject";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type EntityFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

type EntityArrayMatchMode = "any" | "all";

type ExtractEntityArrayValuesFunction = (
  rawValue: unknown,
) => { values: Array<string>; mode: EntityArrayMatchMode };

const extractEntityArrayValues: ExtractEntityArrayValuesFunction = (
  rawValue: unknown,
): { values: Array<string>; mode: EntityArrayMatchMode } => {
  if (rawValue instanceof IncludesAll) {
    return {
      values: (rawValue.values as Array<string>).map((v: string) => {
        return v.toString();
      }),
      mode: "all",
    };
  }

  if (Array.isArray(rawValue)) {
    return {
      values: (rawValue as Array<string>).map((v: string) => {
        return v.toString();
      }),
      mode: "any",
    };
  }

  return { values: [], mode: "any" };
};

const EntityFilter: EntityFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;
  const filterData: FilterData<T> = { ...props.filterData };

  const { values: selectedValues, mode: currentMode } = extractEntityArrayValues(
    filterData[filter.key],
  );

  const dropdownValues: Array<DropdownOption> =
    props.filter.filterDropdownOptions?.filter((option: DropdownOption) => {
      if (selectedValues.length > 0) {
        return selectedValues.includes(option.value.toString());
      }

      return option.value.toString() === filterData[filter.key]?.toString();
    }) || [];

  type ApplyValuesFunction = (data: {
    values: Array<string>;
    mode: EntityArrayMatchMode;
  }) => void;

  const applyValues: ApplyValuesFunction = (data: {
    values: Array<string>;
    mode: EntityArrayMatchMode;
  }): void => {
    if (!filter.key) {
      return;
    }

    if (data.values.length === 0) {
      delete filterData[filter.key];
    } else if (data.mode === "all") {
      filterData[filter.key] = new IncludesAll(data.values) as any;
    } else {
      filterData[filter.key] = data.values as any;
    }

    if (props.onFilterChanged) {
      props.onFilterChanged(filterData);
    }
  };

  if (
    (filter.type === FieldType.Entity ||
      filter.type === FieldType.EntityArray) &&
    filter.filterDropdownOptions
  ) {
    const showMatchToggle: boolean =
      filter.type === FieldType.EntityArray && selectedValues.length >= 2;

    return (
      <div>
        <Dropdown
          options={filter.filterDropdownOptions}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (!filter.key) {
              return;
            }

            if (!value || (Array.isArray(value) && value.length === 0)) {
              applyValues({ values: [], mode: currentMode });
              return;
            }

            if (filter.type === FieldType.EntityArray) {
              const nextValues: Array<string> = Array.isArray(value)
                ? (value as Array<DropdownValue>).map((v: DropdownValue) => {
                    return v.toString();
                  })
                : [value.toString()];

              applyValues({ values: nextValues, mode: currentMode });
              return;
            }

            // FieldType.Entity: single value, mirror legacy behavior.
            filterData[filter.key] = value as any;

            if (props.onFilterChanged) {
              props.onFilterChanged(filterData);
            }
          }}
          value={dropdownValues}
          isMultiSelect={filter.type === FieldType.EntityArray}
          placeholder={`Filter by ${filter.title}`}
        />
        {showMatchToggle && (
          <div className="mt-2 flex items-center text-xs text-gray-500">
            <span className="mr-2">Match</span>
            <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  applyValues({ values: selectedValues, mode: "any" });
                }}
                className={
                  currentMode === "any"
                    ? "px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white"
                    : "px-2.5 py-1 text-xs font-medium bg-white text-gray-600 hover:bg-gray-50"
                }
              >
                Any (OR)
              </button>
              <button
                type="button"
                onClick={() => {
                  applyValues({ values: selectedValues, mode: "all" });
                }}
                className={
                  currentMode === "all"
                    ? "px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white border-l border-indigo-600"
                    : "px-2.5 py-1 text-xs font-medium bg-white text-gray-600 hover:bg-gray-50 border-l border-gray-200"
                }
              >
                All (AND)
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return <></>;
};

export default EntityFilter;
