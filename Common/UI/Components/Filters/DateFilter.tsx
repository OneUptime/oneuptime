import Input, { InputType } from "../Input/Input";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import FilterOperator from "./Types/FilterOperator";
import OperatorSelector from "./OperatorSelector";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import OneUptimeDate from "../../../Types/Date";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<T extends GenericObject> {
  filter: Filter<T>;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  filterData: FilterData<T>;
}

type DateFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const DATE_OPERATORS: Array<FilterOperator> = [
  FilterOperator.Is,
  FilterOperator.Before,
  FilterOperator.After,
  FilterOperator.Between,
  FilterOperator.IsEmpty,
  FilterOperator.IsNotEmpty,
];

type DateState = {
  operator: FilterOperator;
  start: Date | null;
  end: Date | null;
};

const toDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  try {
    return OneUptimeDate.fromString(value as string);
  } catch {
    return null;
  }
};

const detectState = (rawValue: unknown): DateState => {
  if (rawValue instanceof InBetween) {
    const start: Date | null = toDate(rawValue.startValue as unknown);
    const end: Date | null = toDate(rawValue.endValue as unknown);

    // If start/end match the bounds of a single day, treat as "Is".
    if (start && end) {
      const startOfDay: Date = OneUptimeDate.getStartOfDay(start);
      const endOfDay: Date = OneUptimeDate.getEndOfDay(start);
      if (
        start.getTime() === startOfDay.getTime() &&
        end.getTime() === endOfDay.getTime()
      ) {
        return { operator: FilterOperator.Is, start, end: null };
      }
    }

    return { operator: FilterOperator.Between, start, end };
  }
  if (rawValue instanceof GreaterThan) {
    return {
      operator: FilterOperator.After,
      start: toDate(rawValue.value as unknown),
      end: null,
    };
  }
  if (rawValue instanceof LessThan) {
    return {
      operator: FilterOperator.Before,
      start: toDate(rawValue.value as unknown),
      end: null,
    };
  }
  if (rawValue instanceof EqualTo) {
    return {
      operator: FilterOperator.Is,
      start: toDate(rawValue.value as unknown),
      end: null,
    };
  }
  if (rawValue instanceof IsNull) {
    return { operator: FilterOperator.IsEmpty, start: null, end: null };
  }
  if (rawValue instanceof NotNull) {
    return { operator: FilterOperator.IsNotEmpty, start: null, end: null };
  }
  return { operator: FilterOperator.Is, start: null, end: null };
};

const buildValue = (state: DateState, isDateTime: boolean): unknown => {
  switch (state.operator) {
    case FilterOperator.Is: {
      if (!state.start) {
        return undefined;
      }
      if (isDateTime) {
        return new EqualTo(state.start as any);
      }
      return new InBetween(
        OneUptimeDate.getStartOfDay(state.start) as any,
        OneUptimeDate.getEndOfDay(state.start) as any,
      );
    }
    case FilterOperator.Before:
      return state.start ? new LessThan(state.start) : undefined;
    case FilterOperator.After:
      return state.start ? new GreaterThan(state.start) : undefined;
    case FilterOperator.Between: {
      if (!state.start || !state.end) {
        return undefined;
      }
      return new InBetween(
        (isDateTime
          ? state.start
          : OneUptimeDate.getStartOfDay(state.start)) as any,
        (isDateTime
          ? state.end
          : OneUptimeDate.getEndOfDay(state.end)) as any,
      );
    }
    case FilterOperator.IsEmpty:
      return new IsNull();
    case FilterOperator.IsNotEmpty:
      return new NotNull();
    default:
      return undefined;
  }
};

const DateFilter: DateFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const filter: Filter<T> = props.filter;

  if (filter.type !== FieldType.Date && filter.type !== FieldType.DateTime) {
    return <></>;
  }

  const isDateTime: boolean = filter.type === FieldType.DateTime;
  const detected: DateState = detectState(props.filterData[filter.key]);

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

  const state: DateState = { ...detected, operator: localOperator };

  const valuelessOperator: boolean =
    state.operator === FilterOperator.IsEmpty ||
    state.operator === FilterOperator.IsNotEmpty;
  const isBetween: boolean = state.operator === FilterOperator.Between;

  type ApplyFunction = (nextState: DateState) => void;

  const apply: ApplyFunction = (nextState: DateState): void => {
    if (!filter.key) {
      return;
    }
    setLocalOperator(nextState.operator);
    const next: FilterData<T> = { ...props.filterData };
    const built: unknown = buildValue(nextState, isDateTime);
    if (built === undefined) {
      delete next[filter.key];
    } else {
      next[filter.key] = built as any;
    }
    props.onFilterChanged?.(next);
  };

  const inputType: InputType = isDateTime
    ? InputType.DATETIME_LOCAL
    : InputType.DATE;

  return (
    <div className="flex gap-2 items-start">
      <OperatorSelector
        value={state.operator}
        options={DATE_OPERATORS}
        onChange={(nextOperator: FilterOperator) => {
          apply({ ...state, operator: nextOperator });
        }}
      />
      {!valuelessOperator && (
        <div className={isBetween ? "flex-1 flex gap-2 min-w-0" : "flex-1 min-w-0"}>
          <div className="flex-1 min-w-0">
            <Input
              key={`${filter.key as string}-start-${state.operator}`}
              onChange={(changed: string | Date) => {
                const parsed: Date | null = toDate(changed);
                apply({ ...state, start: parsed });
              }}
              value={state.start || ""}
              placeholder={isBetween ? "From" : `Filter by ${filter.title}`}
              type={inputType}
              outerDivClassName="relative rounded-md w-full"
            />
          </div>
          {isBetween && (
            <div className="flex-1 min-w-0">
              <Input
                key={`${filter.key as string}-end-${state.operator}`}
                onChange={(changed: string | Date) => {
                  const parsed: Date | null = toDate(changed);
                  apply({ ...state, end: parsed });
                }}
                value={state.end || ""}
                placeholder="To"
                type={inputType}
                outerDivClassName="relative rounded-md w-full"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DateFilter;
