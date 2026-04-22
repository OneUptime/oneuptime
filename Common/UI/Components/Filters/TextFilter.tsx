import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import FilterOperator from "./Types/FilterOperator";
import OperatorSelector from "./OperatorSelector";
import Search from "../../../Types/BaseDatabase/Search";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type TextFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TEXT_FIELD_TYPES: Array<FieldType> = [
  FieldType.Text,
  FieldType.LongText,
  FieldType.Email,
  FieldType.Phone,
  FieldType.Name,
  FieldType.Port,
  FieldType.URL,
  FieldType.Hostname,
  FieldType.ObjectID,
];

const TEXT_OPERATORS: Array<FilterOperator> = [
  FilterOperator.Contains,
  FilterOperator.DoesNotContain,
  FilterOperator.EqualTo,
  FilterOperator.NotEqualTo,
  FilterOperator.StartsWith,
  FilterOperator.EndsWith,
  FilterOperator.IsEmpty,
  FilterOperator.IsNotEmpty,
];

type DetectCurrentStateFunction = (rawValue: unknown) => {
  operator: FilterOperator;
  value: string;
};

const detectCurrentState: DetectCurrentStateFunction = (
  rawValue: unknown,
): { operator: FilterOperator; value: string } => {
  if (rawValue instanceof Search) {
    return { operator: FilterOperator.Contains, value: rawValue.value };
  }
  if (rawValue instanceof NotContains) {
    return { operator: FilterOperator.DoesNotContain, value: rawValue.value };
  }
  if (rawValue instanceof StartsWith) {
    return { operator: FilterOperator.StartsWith, value: rawValue.value };
  }
  if (rawValue instanceof EndsWith) {
    return { operator: FilterOperator.EndsWith, value: rawValue.value };
  }
  if (rawValue instanceof EqualTo) {
    return { operator: FilterOperator.EqualTo, value: rawValue.toString() };
  }
  if (rawValue instanceof NotEqual) {
    return { operator: FilterOperator.NotEqualTo, value: rawValue.toString() };
  }
  if (rawValue instanceof IsNull) {
    return { operator: FilterOperator.IsEmpty, value: "" };
  }
  if (rawValue instanceof NotNull) {
    return { operator: FilterOperator.IsNotEmpty, value: "" };
  }
  if (typeof rawValue === "string" && rawValue.length > 0) {
    // Backward compatibility for plain string values.
    return { operator: FilterOperator.Contains, value: rawValue };
  }
  return { operator: FilterOperator.Contains, value: "" };
};

type BuildQueryValueFunction = (
  operator: FilterOperator,
  value: string,
) => unknown;

const buildQueryValue: BuildQueryValueFunction = (
  operator: FilterOperator,
  value: string,
): unknown => {
  switch (operator) {
    case FilterOperator.Contains:
      return value ? new Search(value) : undefined;
    case FilterOperator.DoesNotContain:
      return value ? new NotContains(value) : undefined;
    case FilterOperator.StartsWith:
      return value ? new StartsWith(value) : undefined;
    case FilterOperator.EndsWith:
      return value ? new EndsWith(value) : undefined;
    case FilterOperator.EqualTo:
      return value ? new EqualTo(value) : undefined;
    case FilterOperator.NotEqualTo:
      return value ? new NotEqual(value) : undefined;
    case FilterOperator.IsEmpty:
      return new IsNull();
    case FilterOperator.IsNotEmpty:
      return new NotNull();
    default:
      return undefined;
  }
};

const TextFilter: TextFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;

  if (filter.filterDropdownOptions) {
    return <></>;
  }

  if (!TEXT_FIELD_TYPES.includes(filter.type)) {
    return <></>;
  }

  const detected: { operator: FilterOperator; value: string } =
    detectCurrentState(props.filterData[filter.key]);

  // Keep the operator locally so the user's choice persists even when no
  // value has been typed yet (otherwise buildQueryValue returns undefined,
  // the filter is deleted, and the operator resets on re-render).
  const [localOperator, setLocalOperator] = useState<FilterOperator>(
    detected.operator,
  );

  useEffect(() => {
    const raw: unknown = props.filterData[filter.key];
    if (raw !== undefined && raw !== null) {
      setLocalOperator(detected.operator);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.filterData[filter.key]]);

  const operator: FilterOperator = localOperator;
  const value: string = detected.value;

  const valuelessOperator: boolean =
    operator === FilterOperator.IsEmpty ||
    operator === FilterOperator.IsNotEmpty;

  type ApplyFunction = (data: {
    operator: FilterOperator;
    value: string;
  }) => void;

  const apply: ApplyFunction = (data: {
    operator: FilterOperator;
    value: string;
  }): void => {
    if (!filter.key) {
      return;
    }

    setLocalOperator(data.operator);

    const next: FilterData<T> = { ...props.filterData };
    const built: unknown = buildQueryValue(data.operator, data.value);

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
        value={operator}
        options={TEXT_OPERATORS}
        onChange={(nextOperator: FilterOperator) => {
          apply({ operator: nextOperator, value });
        }}
      />
      {!valuelessOperator && (
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              apply({ operator, value: e.target.value });
            }}
            placeholder={`Filter by ${filter.title}`}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
          />
        </div>
      )}
    </div>
  );
};

export default TextFilter;
