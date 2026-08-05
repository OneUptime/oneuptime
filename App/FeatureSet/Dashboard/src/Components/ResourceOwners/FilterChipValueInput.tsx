import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import {
  FILTER_OPERATOR_LABELS,
  FilterOperator,
  NUMBER_FACET_OPERATORS,
  TEXT_FACET_OPERATORS,
  isValuelessOperator,
} from "./FilterChipDropdownTypes";
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
 * The facet bar's chip for a value the user types.
 *
 * Same shell as FilterChipDropdown and FilterChipDateRange — same pill, same
 * operator row, same clear affordance — with a single input where the option
 * list would be. A free-text custom field has no option list to offer: its
 * values are whatever anyone has ever typed into it, and the questions people
 * have of one ("Ticket contains JIRA-", "Impacted Users is over 500") can only
 * be asked by typing.
 *
 * Unlike the other two chips this one keeps a *draft*. Every change to a facet
 * selection re-runs the table's query, and a controlled input would do that per
 * keystroke — eight requests to type "payments", each one superseded. So the
 * input is local until the user commits with Enter, with the Apply button, or
 * by dismissing the popover; the committed value is the prop, and it is the
 * only thing the bar, the URL and the query ever see.
 */

export interface ComponentProps {
  label: string;
  /**
   * The committed value, as the bar stores it: a single-element array, or
   * empty when nothing is set. The array shape is the bar's universal
   * selection encoding, shared with the option and date chips.
   */
  values: Array<string>;
  operator: FilterOperator;
  /** "text" renders a text input, "number" a numeric one. */
  valueType: "text" | "number";
  /**
   * Values and operator always travel together, so a render can never show one
   * operator while the query carries another.
   */
  onChange: (values: Array<string>, operator: FilterOperator) => void;
  /** Defaults to TEXT_FACET_OPERATORS / NUMBER_FACET_OPERATORS. */
  supportedOperators?: Array<FilterOperator> | undefined;
  /** Icon shown on the chip while it has no value. */
  emptyIcon?: IconProp | undefined;
  placeholder?: string | undefined;
}

type ReadCommittedValueFunction = (values: Array<string>) => string;

const readCommittedValue: ReadCommittedValueFunction = (
  values: Array<string>,
): string => {
  return (values || [])[0] || "";
};

const FilterChipValueInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const committedValue: string = readCommittedValue(props.values);
  const operator: FilterOperator = props.operator || "is";
  const valueless: boolean = isValuelessOperator(operator);

  const [draft, setDraft] = React.useState<string>(committedValue);

  /*
   * The committed value can change without this chip doing anything — a saved
   * view loading, a "clear all", a deep link. Re-seed the draft from it so the
   * popover never opens showing a value the list is not filtered by.
   */
  React.useEffect(() => {
    setDraft(committedValue);
  }, [committedValue]);

  const supportedOperators: Array<FilterOperator> =
    props.supportedOperators && props.supportedOperators.length > 0
      ? props.supportedOperators
      : props.valueType === "number"
        ? NUMBER_FACET_OPERATORS
        : TEXT_FACET_OPERATORS;

  const isChipActive: boolean = valueless || committedValue.length > 0;

  type CommitFunction = (nextOperator?: FilterOperator | undefined) => void;

  const commit: CommitFunction = (
    nextOperator?: FilterOperator | undefined,
  ): void => {
    const effectiveOperator: FilterOperator = nextOperator || operator;
    const trimmed: string = draft.trim();

    if (isValuelessOperator(effectiveOperator)) {
      /*
       * "is empty" needs no value, but the draft is kept in local state so it
       * is still there if the user switches back to a value operator.
       */
      props.onChange([], effectiveOperator);
      return;
    }

    props.onChange(trimmed ? [trimmed] : [], effectiveOperator);
  };

  type ChangeOperatorFunction = (next: FilterOperator) => void;

  const changeOperator: ChangeOperatorFunction = (
    next: FilterOperator,
  ): void => {
    /*
     * Commit in the same gesture as the switch. Reporting the operator alone
     * would leave a render where the chip reads "contains" over a list still
     * filtered by "is".
     */
    commit(next);
  };

  const clearChipFully: () => void = (): void => {
    setDraft("");
    // Back to the default operator too, so a cleared chip is fully cleared.
    props.onChange([], "is");
  };

  /*
   * Dismissing the popover commits, and it has to be done here rather than in
   * the handlers: a click anywhere else on the page closes it through
   * useComponentOutsideClick, which sets the flag directly. Committing only in
   * the Apply / Enter paths would silently discard a value the user can still
   * see in the box they typed it into.
   */
  const wasPopoverVisible: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);

  React.useEffect(() => {
    const isClosing: boolean = wasPopoverVisible.current && !isComponentVisible;
    wasPopoverVisible.current = isComponentVisible;

    if (!isClosing || isValuelessOperator(operator)) {
      return;
    }

    /*
     * Only when it actually changed. An unchanged commit would re-run the
     * table's query comparison on every open-and-close of the popover.
     */
    if (draft.trim() !== committedValue) {
      commit();
    }
  }, [isComponentVisible]);

  const closePopover: () => void = (): void => {
    setIsComponentVisible(false);
  };

  const togglePopover: () => void = (): void => {
    setIsComponentVisible(!isComponentVisible);
  };

  const summary: string = valueless
    ? FILTER_OPERATOR_LABELS[operator]
    : `${FILTER_OPERATOR_LABELS[operator]} ${committedValue}`;

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
        {isChipActive ? (
          <>
            {props.emptyIcon && (
              <Icon
                icon={props.emptyIcon}
                className="h-3.5 w-3.5 text-indigo-500"
              />
            )}
            <span className="whitespace-nowrap">
              <span className="text-indigo-500/80">{props.label}</span>
              <span className="mx-1 text-indigo-300">·</span>
              <span className="font-semibold">{summary}</span>
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
          className={`${FILTER_CHIP_POPOVER_CLASSES} w-72`}
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
              No value needed.
            </div>
          ) : (
            <div className="p-2">
              <div
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    closePopover();
                  }
                }}
              >
                <Input
                  /*
                   * Re-keyed on the operator for the same reason the date chip
                   * is: the shared Input keeps its display string in state, so
                   * a switch has to remount rather than leave the previous
                   * operator's value rendered.
                   */
                  key={`value-${operator}`}
                  type={
                    props.valueType === "number"
                      ? InputType.NUMBER
                      : InputType.TEXT
                  }
                  value={draft}
                  placeholder={props.placeholder || `Enter ${props.label}`}
                  outerDivClassName="relative rounded-md w-full"
                  onChange={(changed: string) => {
                    setDraft(changed);
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="px-0.5 text-xs text-gray-400">
                  Press Enter to apply.
                </p>
                <button
                  type="button"
                  onClick={closePopover}
                  className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FilterChipValueInput;
