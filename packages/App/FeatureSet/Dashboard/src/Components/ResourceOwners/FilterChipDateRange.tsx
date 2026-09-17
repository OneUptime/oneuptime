import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import {
  DATE_FACET_OPERATORS,
  FILTER_OPERATOR_LABELS,
  FilterOperator,
  isValuelessOperator,
} from "./FilterChipDropdownTypes";
import {
  FacetDateRange,
  formatFacetDateRange,
  isFacetDateRangeActive,
  parseFacetDateRange,
  serializeFacetDateRange,
  toFacetDate,
} from "./FacetDateRange";
import {
  FILTER_CHIP_ACTIVE_CLASSES,
  FILTER_CHIP_BASE_CLASSES,
  FILTER_CHIP_CLEAR_CLASSES,
  FILTER_CHIP_INACTIVE_CLASSES,
  FILTER_CHIP_OPERATOR_SELECT_CLASSES,
  FILTER_CHIP_POPOVER_CLASSES,
} from "./FilterChipStyles";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The facet bar's chip for a date column.
 *
 * Same shell as FilterChipDropdown — same pill, same operator row, same clear
 * affordance — with date inputs where the option list would be. A date column
 * has no option list to offer: every instant is its own value, so the questions
 * a user actually has of one ("not polled since last Tuesday", "polled between
 * the 1st and the 5th") can only be asked by typing a date.
 *
 * Fully controlled: the dates live in the facet selection the bar already
 * persists, so a half-entered range survives a re-render and a completed one
 * survives a shared link, with no second copy of the state to fall out of step.
 */

export interface ComponentProps {
  label: string;
  /**
   * The facet's stored selection, in FacetDateRange's encoding. Empty when no
   * date is picked.
   */
  values: Array<string>;
  operator: FilterOperator;
  /**
   * Values and operator always travel together — changing the operator
   * re-encodes the dates under it, so reporting them separately would leave a
   * render in which the two disagree and the query is built from the mismatch.
   */
  onChange: (values: Array<string>, operator: FilterOperator) => void;
  /** Defaults to DATE_FACET_OPERATORS. */
  supportedOperators?: Array<FilterOperator> | undefined;
  /** Icon shown on the chip while it has no selection. */
  emptyIcon?: IconProp | undefined;
  popoverWidthClassName?: string | undefined;
}

const FilterChipDateRange: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const supportedOperators: Array<FilterOperator> =
    props.supportedOperators && props.supportedOperators.length > 0
      ? props.supportedOperators
      : DATE_FACET_OPERATORS;

  const operator: FilterOperator = props.operator || "is";
  const valueless: boolean = isValuelessOperator(operator);
  const isBetween: boolean = operator === "between";
  const range: FacetDateRange = parseFacetDateRange(props.values);
  const isChipActive: boolean = isFacetDateRangeActive(props.values, operator);

  /*
   * The chip says something as soon as an operator that needs no date is
   * picked, and otherwise only once a date is in — so "is between" on its own
   * reads as the unfinished thing it is rather than as an applied filter.
   */
  const hasAnyDate: boolean = Boolean(range.start || range.end);

  type ApplyRangeFunction = (next: FacetDateRange) => void;

  const applyRange: ApplyRangeFunction = (next: FacetDateRange): void => {
    props.onChange(serializeFacetDateRange(next, operator), operator);
  };

  type ChangeOperatorFunction = (next: FilterOperator) => void;

  const changeOperator: ChangeOperatorFunction = (
    next: FilterOperator,
  ): void => {
    /*
     * Re-encode under the new operator in the same gesture. Leaving the old
     * encoding behind would keep an end date alive through a switch to
     * "before", where the popover stops showing it but the stored selection
     * still carries it into the next shared link.
     */
    props.onChange(serializeFacetDateRange(range, next), next);
  };

  const clearChipFully: () => void = (): void => {
    // Back to the default operator too, so a cleared chip is fully cleared.
    props.onChange([], "is");
  };

  const togglePopover: () => void = (): void => {
    setIsComponentVisible(!isComponentVisible);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={togglePopover}
        className={`${FILTER_CHIP_BASE_CLASSES} ${
          isChipActive
            ? FILTER_CHIP_ACTIVE_CLASSES
            : FILTER_CHIP_INACTIVE_CLASSES
        }`}
        aria-expanded={isComponentVisible}
        aria-haspopup="dialog"
      >
        {isChipActive || hasAnyDate ? (
          <>
            {props.emptyIcon && (
              <Icon
                icon={props.emptyIcon}
                className={`h-3.5 w-3.5 ${
                  isChipActive ? "text-indigo-500" : "text-gray-400"
                }`}
              />
            )}
            <span className="whitespace-nowrap">
              <span className={isChipActive ? "text-indigo-500/80" : ""}>
                {props.label}
              </span>
              <span
                className={`mx-1 ${
                  isChipActive ? "text-indigo-300" : "text-gray-300"
                }`}
              >
                ·
              </span>
              <span className="font-semibold">
                {valueless
                  ? FILTER_OPERATOR_LABELS[operator]
                  : `${FILTER_OPERATOR_LABELS[operator]} ${formatFacetDateRange(
                      props.values,
                      operator,
                    )}`}
              </span>
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                clearChipFully();
              }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  clearChipFully();
                }
              }}
              className={FILTER_CHIP_CLEAR_CLASSES}
              aria-label={`Clear ${props.label} filter`}
            >
              <Icon icon={IconProp.Close} className="h-3 w-3" />
            </span>
          </>
        ) : (
          <>
            {props.emptyIcon && (
              <Icon
                icon={props.emptyIcon}
                className="h-3.5 w-3.5 text-gray-400"
              />
            )}
            <span className="whitespace-nowrap">{props.label}</span>
            <Icon
              icon={IconProp.ChevronDown}
              className="h-3 w-3 text-gray-400 transition-transform group-aria-expanded:rotate-180"
            />
          </>
        )}
      </button>

      {isComponentVisible && (
        <div
          ref={ref}
          className={`${FILTER_CHIP_POPOVER_CLASSES} ${
            props.popoverWidthClassName || (isBetween ? "w-96" : "w-72")
          }`}
          role="dialog"
        >
          {supportedOperators.length > 1 && (
            <div className="flex items-center gap-1.5 border-b border-gray-100 px-2 py-1.5 text-xs text-gray-500">
              <span className="shrink-0">{props.label.toLowerCase()}</span>
              <select
                value={operator}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  changeOperator(e.target.value as FilterOperator);
                }}
                className={FILTER_CHIP_OPERATOR_SELECT_CLASSES}
                aria-label={`${props.label} operator`}
              >
                {supportedOperators.map((op: FilterOperator) => {
                  return (
                    <option key={op} value={op}>
                      {FILTER_OPERATOR_LABELS[op]}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {valueless ? (
            <div className="px-3 py-4 text-center text-xs text-gray-500">
              No date needed.
            </div>
          ) : (
            <div className="p-2">
              <div className={isBetween ? "flex gap-2" : ""}>
                <div className="min-w-0 flex-1">
                  {isBetween && (
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      From
                    </label>
                  )}
                  <Input
                    /*
                     * Re-keyed on the operator so switching between "between"
                     * and the single-date operators remounts the field rather
                     * than leaving the previous operator's value rendered in
                     * it — the shared Input keeps its display string in state.
                     */
                    key={`start-${operator}`}
                    type={InputType.DATE}
                    value={range.start || ""}
                    placeholder={isBetween ? "From" : "Pick a date"}
                    outerDivClassName="relative rounded-md w-full"
                    onChange={(changed: string) => {
                      applyRange({ ...range, start: toFacetDate(changed) });
                    }}
                  />
                </div>
                {isBetween && (
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      To
                    </label>
                    <Input
                      key={`end-${operator}`}
                      type={InputType.DATE}
                      value={range.end || ""}
                      placeholder="To"
                      outerDivClassName="relative rounded-md w-full"
                      onChange={(changed: string) => {
                        applyRange({ ...range, end: toFacetDate(changed) });
                      }}
                    />
                  </div>
                )}
              </div>
              {isBetween && !isChipActive && hasAnyDate && (
                <p className="mt-2 px-0.5 text-xs text-gray-400">
                  Pick both dates to apply this filter.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FilterChipDateRange;
