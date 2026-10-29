import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useIsBelowWidth, {
  PHONE_BELOW_WIDTH_IN_PX,
} from "Common/UI/Utils/UseIsBelowWidth";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useState,
} from "react";
import {
  FACET_FILTER_BAR_CLASS_NAME,
  FACET_FILTER_BAR_FOLDED_CLASS_NAME,
} from "./FilterChipStyles";

// "Filter" and how many chips are set, at the start of the row.
const LABEL_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 pr-1 text-xs font-medium text-gray-500";

/*
 * On a phone "Filter" is a button that opens the chips and folds them away
 * again, drawn as an empty chip is: a pill with its border, so it reads as
 * something to press.
 */
const TOGGLE_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1";

export interface ComponentProps {
  // How many of the chips hold a value: the count beside "Filter".
  activeCount: number;
  // Empties every chip. Offered as "Clear all" while any chip holds a value.
  onClearAll?: (() => void) | undefined;
  // The chips (FilterChipDropdown and its kin).
  children: ReactNode;
  dataTestId?: string | undefined;
  // What a screen reader calls the row; the chips are a group under it.
  ariaLabel?: string | undefined;
}

/*
 * The row of filter chips between a table's header and its rows: a "Filter"
 * label with how many chips are set, the chips, and "Clear all" at the end
 * once one is. Every list with chips draws them in this row - the model
 * tables' facets (useResourceOwners) and the lists a page builds itself
 * (Session Replay) - so a list's filters look the same wherever they are.
 *
 * The chips sit on the card itself, in a row between the card's header and
 * the table, as a list's filters do in GitHub and Linear. They used to sit
 * in a bordered, shadowed box of their own inside the card - a box in a
 * box, with a divider inside it - which drew more than the table's own
 * header did.
 *
 * On a phone (below md, where the table lays its rows out as cards) the
 * chips fold away behind "Filter", a button. An alerts list with two custom
 * fields draws eight chips, and on a 390px screen they took five lines under
 * the search, Saved Views and Create: the first alert started at the foot
 * of the screen someone paged at night opens first. Folded, the row is
 * "Filter" and the chips that hold a filter, so what the list is filtered
 * by is still in sight, with "Clear all" on Filter's line; pressing
 * "Filter" draws every chip, and pressing it again folds them. Wider
 * screens draw every chip, as before.
 */
const FacetFilterBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isPhone: boolean = useIsBelowWidth(PHONE_BELOW_WIDTH_IN_PX);
  const [isOpenOnPhone, setIsOpenOnPhone] = useState<boolean>(false);
  const barId: string = `${useId()}-filter-bar`;
  const isFolded: boolean = isPhone && !isOpenOnPhone;
  const filterText: string = translator.translateText("Filter") || "Filter";

  const label: ReactElement = (
    <>
      <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
      {filterText}
      {props.activeCount > 0 && (
        <span
          className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700"
          data-testid="facet-filter-bar-count"
        >
          {props.activeCount}
        </span>
      )}
    </>
  );

  // On a phone, "Filter" opens the chips and folds them again.
  const toggle: ReactElement = (
    <button
      type="button"
      className={TOGGLE_CLASS_NAME}
      aria-expanded={isOpenOnPhone}
      aria-controls={barId}
      // "Filter 2": its words and its count, not run together.
      aria-label={
        props.activeCount > 0
          ? `${filterText} ${props.activeCount}`
          : filterText
      }
      onClick={() => {
        setIsOpenOnPhone(!isOpenOnPhone);
      }}
      data-testid="facet-filter-bar-toggle"
    >
      {label}
      <Icon
        icon={isOpenOnPhone ? IconProp.ChevronUp : IconProp.ChevronDown}
        className="h-3 w-3"
      />
    </button>
  );

  // Empties every chip, once one holds a value.
  const clearAll: ReactElement | null = props.onClearAll ? (
    <button
      type="button"
      onClick={props.onClearAll}
      data-testid="facet-filter-bar-clear-all"
      className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200/60 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <Icon icon={IconProp.Close} className="h-3 w-3" />
      {translator.translateText("Clear all")}
    </button>
  ) : null;

  return (
    <div
      id={barId}
      className={
        isFolded
          ? `${FACET_FILTER_BAR_CLASS_NAME} ${FACET_FILTER_BAR_FOLDED_CLASS_NAME}`
          : FACET_FILTER_BAR_CLASS_NAME
      }
      data-testid={props.dataTestId || "facet-filter-bar"}
      data-folded={isFolded ? "true" : "false"}
      role={props.ariaLabel ? "group" : undefined}
      aria-label={
        props.ariaLabel ? translator.translateText(props.ariaLabel) : undefined
      }
    >
      {isPhone ? (
        props.onClearAll ? (
          /*
           * "Clear all" beside "Filter" on a phone, on a line of their own:
           * at the end of the row it wrapped onto a line by itself under a
           * chip a filter had made wide, a third line for one filter.
           */
          <div
            className="flex w-full items-center gap-2"
            data-testid="facet-filter-bar-phone-line"
          >
            {toggle}
            {clearAll}
          </div>
        ) : (
          toggle
        )
      ) : (
        <span className={LABEL_CLASS_NAME} data-testid="facet-filter-bar-label">
          {label}
        </span>
      )}

      {props.children}

      {!isPhone && clearAll}
    </div>
  );
};

export default FacetFilterBar;
