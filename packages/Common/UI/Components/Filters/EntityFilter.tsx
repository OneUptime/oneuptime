import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import Filter from "./Types/Filter";
import FilterData from "./Types/FilterData";
import FilterOperator from "./Types/FilterOperator";
import OperatorSelector from "./OperatorSelector";
import GenericObject from "../../../Types/GenericObject";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { getFilterPlaceholder } from "./FilterPlaceholder";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import React, { ReactElement, useEffect, useState } from "react";

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

type DetectStateFunction = (rawValue: unknown) => EntityState;

const detectArrayState: DetectStateFunction = (
  rawValue: unknown,
): EntityState => {
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

const detectSingleState: DetectStateFunction = (
  rawValue: unknown,
): EntityState => {
  if (rawValue instanceof IsNull) {
    return { operator: FilterOperator.IsEmpty, values: [] };
  }
  if (rawValue instanceof NotNull) {
    return { operator: FilterOperator.IsNotEmpty, values: [] };
  }
  /*
   * The mirror image of `buildSingleValue`'s "is not" case, which encodes the
   * operator as a single-item IncludesNone. Without this the dropdown lost the
   * operator (and its value) on every remount — which is every Back
   * navigation and every shared link.
   */
  if (rawValue instanceof IncludesNone) {
    const values: Array<string> = (rawValue.values || []).map((v: unknown) => {
      return v!.toString();
    });

    return {
      operator: FilterOperator.IsNot,
      values: values.length > 0 ? [values[0] as string] : [],
    };
  }
  if (typeof rawValue === "string" && rawValue) {
    return { operator: FilterOperator.Is, values: [rawValue] };
  }
  return { operator: FilterOperator.Is, values: [] };
};

type BuildValueFunction = (state: EntityState) => unknown;

const buildArrayValue: BuildValueFunction = (state: EntityState): unknown => {
  switch (state.operator) {
    case FilterOperator.HasAllOf:
      return state.values.length > 0
        ? new IncludesAll(state.values)
        : undefined;
    case FilterOperator.HasNoneOf:
      return state.values.length > 0
        ? new IncludesNone(state.values)
        : undefined;
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

const buildSingleValue: BuildValueFunction = (state: EntityState): unknown => {
  switch (state.operator) {
    case FilterOperator.Is:
      return state.values[0] || undefined;
    case FilterOperator.IsNot:
      // Use IncludesNone with single-item array to represent "is not".
      return state.values[0] ? new IncludesNone([state.values[0]]) : undefined;
    case FilterOperator.IsEmpty:
      return new IsNull();
    case FilterOperator.IsNotEmpty:
      return new NotNull();
    default:
      return undefined;
  }
};

interface ControlsProps<T extends GenericObject> extends ComponentProps<T> {
  // The filter's options: the controls are only drawn once it has them.
  options: Array<DropdownOption>;
}

type EntityFilterControlsFunction = <T extends GenericObject>(
  props: ControlsProps<T>,
) => ReactElement;

// An entity filter's controls. EntityFilter below decides whether to draw them.
const EntityFilterControls: EntityFilterControlsFunction = <
  T extends GenericObject,
>(
  props: ControlsProps<T>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const filter: Filter<T> = props.filter;

  const isArray: boolean = filter.type === FieldType.EntityArray;
  const detectedState: EntityState = isArray
    ? detectArrayState(props.filterData[filter.key])
    : detectSingleState(props.filterData[filter.key]);

  /*
   * Hold the operator locally so the user's choice persists even when no
   * values are selected yet (otherwise `buildArrayValue` would return
   * undefined, filterData wouldn't carry the operator, and the next render
   * would reset back to the default).
   */
  const [localOperator, setLocalOperator] = useState<FilterOperator>(
    detectedState.operator,
  );

  /*
   * When the external filter data changes and can unambiguously tell us
   * which operator it represents, sync local state.
   */
  useEffect(() => {
    const raw: unknown = props.filterData[filter.key];
    if (raw !== undefined && raw !== null) {
      setLocalOperator(detectedState.operator);
    }
    /*
     * Intentionally only re-run when the underlying filter data reference
     * changes — not on every detectedState re-computation.
     */
  }, [props.filterData[filter.key]]);

  const operator: FilterOperator = localOperator;
  const state: EntityState = { ...detectedState, operator };

  const valuelessOperator: boolean =
    operator === FilterOperator.IsEmpty ||
    operator === FilterOperator.IsNotEmpty;

  const dropdownValues: Array<DropdownOption> = props.options.filter(
    (option: DropdownOption) => {
      return state.values.includes(option.value.toString());
    },
  );

  type ApplyFunction = (nextState: EntityState) => void;

  const apply: ApplyFunction = (nextState: EntityState): void => {
    if (!filter.key) {
      return;
    }
    setLocalOperator(nextState.operator);
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
        value={operator}
        options={isArray ? ENTITY_ARRAY_OPERATORS : ENTITY_OPERATORS}
        onChange={(nextOperator: FilterOperator) => {
          apply({ ...state, operator: nextOperator });
        }}
      />
      {!valuelessOperator && (
        <div className="flex-1 min-w-0">
          <Dropdown
            options={props.options}
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
            placeholder={getFilterPlaceholder(translator, filter.title)}
            className="relative rounded-md w-full overflow-visible"
          />
        </div>
      )}
    </div>
  );
};

/*
 * FiltersForm draws every filter component in each of its rows, and each one
 * draws nothing for a filter it does not own. An entity filter also draws
 * nothing until its options are there. Those checks call no hook, so they
 * live in this wrapper and the hooks in EntityFilterControls: a row whose
 * filter changes type, or whose options arrive, mounts the controls instead
 * of changing how many hooks one component calls. See DateFilter for the
 * crash that a check below a hook caused.
 */
const EntityFilter: EntityFilterFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  if (
    props.filter.type !== FieldType.Entity &&
    props.filter.type !== FieldType.EntityArray
  ) {
    return <></>;
  }

  if (!props.filter.filterDropdownOptions) {
    return <></>;
  }

  return (
    <EntityFilterControls<T>
      {...props}
      options={props.filter.filterDropdownOptions}
    />
  );
};

export default EntityFilter;
