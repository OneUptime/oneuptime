import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import FilterOperator from "./Types/FilterOperator";
import OperatorSelector from "./OperatorSelector";
import GenericObject from "../../../Types/GenericObject";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type EntityFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const ENTITY_ARRAY_OPERATORS: Array<FilterOperator> = [
  FilterOperator.HasAnyOf,
  FilterOperator.HasAllOf,
  FilterOperator.HasNoneOf,
  FilterOperator.IsEmpty,
  FilterOperator.IsNotEmpty,
];

const ENTITY_OPERATORS: Array<FilterOperator> = [
  FilterOperator.Is,
  FilterOperator.IsNot,
  FilterOperator.IsEmpty,
  FilterOperator.IsNotEmpty,
];

type EntityState = {
  operator: FilterOperator;
  values: Array<string>;
};

const detectArrayState = (rawValue: unknown): EntityState => {
  if (rawValue instanceof IncludesAll) {
    return {
      operator: FilterOperator.HasAllOf,
      values: (rawValue.values as Array<string>).map((v: string) => {
        return v.toString();
      }),
    };
  }
  if (rawValue instanceof IncludesNone) {
    return {
      operator: FilterOperator.HasNoneOf,
      values: (rawValue.values as Array<string>).map((v: string) => {
        return v.toString();
      }),
    };
  }
  if (rawValue instanceof Includes) {
    return {
      operator: FilterOperator.HasAnyOf,
      values: (rawValue.values as Array<string>).map((v: string) => {
        return v.toString();
      }),
    };
  }
  if (Array.isArray(rawValue)) {
    return {
      operator: FilterOperator.HasAnyOf,
      values: (rawValue as Array<string>).map((v: string) => {
        return v.toString();
      }),
    };
  }
  if (rawValue instanceof IsNull) {
    return { operator: FilterOperator.IsEmpty, values: [] };
  }
  if (rawValue instanceof NotNull) {
    return { operator: FilterOperator.IsNotEmpty, values: [] };
  }
  return { operator: FilterOperator.HasAnyOf, values: [] };
};

const detectSingleState = (rawValue: unknown): EntityState => {
  if (rawValue instanceof IsNull) {
    return { operator: FilterOperator.IsEmpty, values: [] };
  }
  if (rawValue instanceof NotNull) {
    return { operator: FilterOperator.IsNotEmpty, values: [] };
  }
  if (typeof rawValue === "string" && rawValue) {
    return { operator: FilterOperator.Is, values: [rawValue] };
  }
  return { operator: FilterOperator.Is, values: [] };
};

const buildArrayValue = (state: EntityState): unknown => {
  switch (state.operator) {
    case FilterOperator.HasAllOf:
      return state.values.length > 0 ? new IncludesAll(state.values) : undefined;
    case FilterOperator.HasNoneOf:
      return state.values.length > 0 ? new IncludesNone(state.values) : undefined;
    case FilterOperator.HasAnyOf:
      return state.values.length > 0 ? state.values : undefined;
    case FilterOperator.IsEmpty:
      return new IsNull();
    case FilterOperator.IsNotEmpty:
      return new NotNull();
    default:
      return undefined;
  }
};

const buildSingleValue = (state: EntityState): unknown => {
  switch (state.operator) {
    case FilterOperator.Is:
      return state.values[0] || undefined;
    case FilterOperator.IsNot:
      // Use IncludesNone with single-item array to represent "is not".
      return state.values[0]
        ? new IncludesNone([state.values[0]])
        : undefined;
    case FilterOperator.IsEmpty:
      return new IsNull();
    case FilterOperator.IsNotEmpty:
      return new NotNull();
    default:
      return undefined;
  }
};

const EntityFilter: EntityFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;

  if (
    filter.type !== FieldType.Entity &&
    filter.type !== FieldType.EntityArray
  ) {
    return <></>;
  }

  if (!filter.filterDropdownOptions) {
    return <></>;
  }

  const isArray: boolean = filter.type === FieldType.EntityArray;
  const state: EntityState = isArray
    ? detectArrayState(props.filterData[filter.key])
    : detectSingleState(props.filterData[filter.key]);

  const valuelessOperator: boolean =
    state.operator === FilterOperator.IsEmpty ||
    state.operator === FilterOperator.IsNotEmpty;

  const dropdownValues: Array<DropdownOption> =
    filter.filterDropdownOptions?.filter((option: DropdownOption) => {
      return state.values.includes(option.value.toString());
    }) || [];

  type ApplyFunction = (nextState: EntityState) => void;

  const apply: ApplyFunction = (nextState: EntityState): void => {
    if (!filter.key) {
      return;
    }
    const next: FilterData<T> = { ...props.filterData };
    const built: unknown = isArray
      ? buildArrayValue(nextState)
      : buildSingleValue(nextState);
    if (built === undefined) {
      delete next[filter.key];
    } else {
      next[filter.key] = built as any;
    }
    props.onFilterChanged?.(next);
  };

  return (
    <div className="flex gap-2 items-start">
      <OperatorSelector
        value={state.operator}
        options={isArray ? ENTITY_ARRAY_OPERATORS : ENTITY_OPERATORS}
        onChange={(nextOperator: FilterOperator) => {
          apply({ ...state, operator: nextOperator });
        }}
      />
      {!valuelessOperator && (
        <div className="flex-1 min-w-0">
          <Dropdown
            options={filter.filterDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (!value || (Array.isArray(value) && value.length === 0)) {
                apply({ ...state, values: [] });
                return;
              }
              const nextValues: Array<string> = Array.isArray(value)
                ? (value as Array<DropdownValue>).map((v: DropdownValue) => {
                    return v.toString();
                  })
                : [value.toString()];
              apply({ ...state, values: nextValues });
            }}
            value={dropdownValues}
            isMultiSelect={isArray}
            placeholder={`Filter by ${filter.title}`}
            className="relative rounded-md w-full overflow-visible"
          />
        </div>
      )}
    </div>
  );
};

export default EntityFilter;
