import Input, { InputType } from "../Input/Input";
import FieldType from "../Types/FieldType";
import {
  buildDateFilterValue,
  DateFilterState,
  readDateFilterValue,
  toFilterDate,
} from "./DateFilterValue";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import FilterOperator from "./Types/FilterOperator";
import OperatorSelector from "./OperatorSelector";
import GenericObject from "../../../Types/GenericObject";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { getFilterPlaceholder } from "./FilterPlaceholder";
import React, { ReactElement, useEffect, useRef, useState } from "react";

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

/*
 * What each operator asks for - the whole minute, or the whole day for a
 * date filter - is decided in DateFilterValue, which the list's query reads
 * too (FilterDataToQuery), so the controls, the chip and the rows agree.
 */

// A date filter's controls. DateFilter below decides whether to draw them.
const DateFilterControls: DateFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const filter: Filter<T> = props.filter;

  const isDateTime: boolean = filter.type === FieldType.DateTime;
  const value: unknown = props.filterData[filter.key];

  /*
   * The operator and the moments as picked, whether or not they make a
   * value yet. A Between with only one end picked asks the list for
   * nothing, so the list's filter data holds nothing for it; read back from
   * that, its first end was lost, and the second end could never complete
   * it - Between never filtered anything.
   */
  const [draft, setDraft] = useState<DateFilterState>((): DateFilterState => {
    return readDateFilterValue(value, isDateTime);
  });

  // The value these controls last handed the list.
  const lastBuiltValue: React.MutableRefObject<unknown> =
    useRef<unknown>(value);

  /*
   * A value the list was given from elsewhere - a saved view, a link, the
   * chip's remove button - is shown as it reads: its operator and moments,
   * or, once it is taken away, the operator with no moments.
   */
  useEffect(() => {
    if (value === lastBuiltValue.current) {
      return;
    }

    lastBuiltValue.current = value;

    if (value !== undefined && value !== null) {
      setDraft(readDateFilterValue(value, isDateTime));
    } else {
      setDraft((current: DateFilterState): DateFilterState => {
        return { operator: current.operator, start: null, end: null };
      });
    }
  }, [value]);

  const state: DateFilterState = draft;

  const valuelessOperator: boolean =
    state.operator === FilterOperator.IsEmpty ||
    state.operator === FilterOperator.IsNotEmpty;
  const isBetween: boolean = state.operator === FilterOperator.Between;

  type ApplyFunction = (nextState: DateFilterState) => void;

  const apply: ApplyFunction = (nextState: DateFilterState): void => {
    if (!filter.key) {
      return;
    }
    setDraft(nextState);
    const next: FilterData<T> = { ...props.filterData };
    const built: unknown = buildDateFilterValue(nextState, isDateTime);
    lastBuiltValue.current = built;
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
        <div
          className={isBetween ? "flex-1 flex gap-2 min-w-0" : "flex-1 min-w-0"}
        >
          <div className="flex-1 min-w-0">
            <Input
              isSearchOrFilter={true}
              key={`${filter.key as string}-start-${state.operator}`}
              onChange={(changed: string | Date) => {
                const parsed: Date | null = toFilterDate(changed);
                apply({ ...state, start: parsed });
              }}
              value={state.start || ""}
              placeholder={
                isBetween
                  ? translator.translateText("From")
                  : getFilterPlaceholder(translator, filter.title)
              }
              // "From" or "Filter by {{field}}", in the reader's words here.
              isPlaceholderTranslated={true}
              type={inputType}
              outerDivClassName="relative rounded-md w-full"
            />
          </div>
          {isBetween && (
            <div className="flex-1 min-w-0">
              <Input
                isSearchOrFilter={true}
                key={`${filter.key as string}-end-${state.operator}`}
                onChange={(changed: string | Date) => {
                  const parsed: Date | null = toFilterDate(changed);
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

/*
 * FiltersForm draws every filter component in each of its rows, and each one
 * draws nothing for a filter it does not own. That check calls no hook, so it
 * lives in this wrapper and the hooks in DateFilterControls: a row whose filter
 * changes type mounts or unmounts the controls. While the check sat below the
 * translation hook, such a change altered how many hooks one component called,
 * and React threw "Rendered more hooks than during the previous render" and
 * unmounted the whole filter form.
 */
const DateFilter: DateFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  if (
    props.filter.type !== FieldType.Date &&
    props.filter.type !== FieldType.DateTime
  ) {
    return <></>;
  }

  return <DateFilterControls<T> {...props} />;
};

export default DateFilter;
