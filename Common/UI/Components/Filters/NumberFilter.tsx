import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import FilterOperator from "./Types/FilterOperator";
import OperatorSelector from "./OperatorSelector";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type NumberFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const NUMBER_OPERATORS: Array<FilterOperator> = [
  FilterOperator.EqualTo,
  FilterOperator.NotEqualTo,
  FilterOperator.GreaterThan,
  FilterOperator.LessThan,
  FilterOperator.GreaterThanOrEqualTo,
  FilterOperator.LessThanOrEqualTo,
  FilterOperator.Between,
  FilterOperator.IsEmpty,
  FilterOperator.IsNotEmpty,
];

type NumberState = {
  operator: FilterOperator;
  value: string;
  endValue: string;
};

type DetectStateFunction = (rawValue: unknown) => NumberState;

const detectState: DetectStateFunction = (rawValue: unknown): NumberState => {
  if (rawValue instanceof InBetween) {
    return {
      operator: FilterOperator.Between,
      value: (rawValue.startValue ?? "").toString(),
      endValue: (rawValue.endValue ?? "").toString(),
    };
  }
  if (rawValue instanceof EqualTo) {
    return {
      operator: FilterOperator.EqualTo,
      value: rawValue.toString(),
      endValue: "",
    };
  }
  if (rawValue instanceof NotEqual) {
    return {
      operator: FilterOperator.NotEqualTo,
      value: rawValue.toString(),
      endValue: "",
    };
  }
  if (rawValue instanceof GreaterThan) {
    return {
      operator: FilterOperator.GreaterThan,
      value: rawValue.toString(),
      endValue: "",
    };
  }
  if (rawValue instanceof LessThan) {
    return {
      operator: FilterOperator.LessThan,
      value: rawValue.toString(),
      endValue: "",
    };
  }
  if (rawValue instanceof GreaterThanOrEqual) {
    return {
      operator: FilterOperator.GreaterThanOrEqualTo,
      value: rawValue.toString(),
      endValue: "",
    };
  }
  if (rawValue instanceof LessThanOrEqual) {
    return {
      operator: FilterOperator.LessThanOrEqualTo,
      value: rawValue.toString(),
      endValue: "",
    };
  }
  if (rawValue instanceof IsNull) {
    return { operator: FilterOperator.IsEmpty, value: "", endValue: "" };
  }
  if (rawValue instanceof NotNull) {
    return { operator: FilterOperator.IsNotEmpty, value: "", endValue: "" };
  }
  if (typeof rawValue === "number") {
    return {
      operator: FilterOperator.EqualTo,
      value: rawValue.toString(),
      endValue: "",
    };
  }
  return { operator: FilterOperator.EqualTo, value: "", endValue: "" };
};

type BuildValueFunction = (state: NumberState) => unknown;

const buildValue: BuildValueFunction = (state: NumberState): unknown => {
  const startNum: number = parseFloat(state.value);
  const endNum: number = parseFloat(state.endValue);

  const hasStart: boolean = !Number.isNaN(startNum) && state.value !== "";
  const hasEnd: boolean = !Number.isNaN(endNum) && state.endValue !== "";

  switch (state.operator) {
    case FilterOperator.EqualTo:
      return hasStart ? new EqualTo(startNum as any) : undefined;
    case FilterOperator.NotEqualTo:
      return hasStart ? new NotEqual(startNum as any) : undefined;
    case FilterOperator.GreaterThan:
      return hasStart ? new GreaterThan(startNum) : undefined;
    case FilterOperator.LessThan:
      return hasStart ? new LessThan(startNum) : undefined;
    case FilterOperator.GreaterThanOrEqualTo:
      return hasStart ? new GreaterThanOrEqual(startNum) : undefined;
    case FilterOperator.LessThanOrEqualTo:
      return hasStart ? new LessThanOrEqual(startNum) : undefined;
    case FilterOperator.Between:
      return hasStart && hasEnd ? new InBetween(startNum, endNum) : undefined;
    case FilterOperator.IsEmpty:
      return new IsNull();
    case FilterOperator.IsNotEmpty:
      return new NotNull();
    default:
      return undefined;
  }
};

const NumberFilter: NumberFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;

  if (filter.filterDropdownOptions) {
    return <></>;
  }

  if (filter.type !== FieldType.Number) {
    return <></>;
  }

  const detected: NumberState = detectState(props.filterData[filter.key]);

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

  const state: NumberState = { ...detected, operator: localOperator };

  const valuelessOperator: boolean =
    state.operator === FilterOperator.IsEmpty ||
    state.operator === FilterOperator.IsNotEmpty;
  const isBetween: boolean = state.operator === FilterOperator.Between;

  type ApplyFunction = (nextState: NumberState) => void;

  const apply: ApplyFunction = (nextState: NumberState): void => {
    if (!filter.key) {
      return;
    }

    setLocalOperator(nextState.operator);

    const next: FilterData<T> = { ...props.filterData };
    const built: unknown = buildValue(nextState);

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
        options={NUMBER_OPERATORS}
        onChange={(nextOperator: FilterOperator) => {
          apply({ ...state, operator: nextOperator });
        }}
      />
      {!valuelessOperator && (
        <div
          className={isBetween ? "flex-1 flex gap-2 min-w-0" : "flex-1 min-w-0"}
        >
          <div className="flex-1 min-w-0">
            <input
              type="number"
              value={state.value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                apply({ ...state, value: e.target.value });
              }}
              placeholder={isBetween ? "From" : `Filter by ${filter.title}`}
              className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          {isBetween && (
            <div className="flex-1 min-w-0">
              <input
                type="number"
                value={state.endValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  apply({ ...state, endValue: e.target.value });
                }}
                placeholder="To"
                className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NumberFilter;
