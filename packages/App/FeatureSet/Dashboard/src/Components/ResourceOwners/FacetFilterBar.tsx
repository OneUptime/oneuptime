import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import { FACET_FILTER_BAR_CLASS_NAME } from "./FilterChipStyles";

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
 */
const FacetFilterBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className={FACET_FILTER_BAR_CLASS_NAME}
      data-testid={props.dataTestId || "facet-filter-bar"}
      role={props.ariaLabel ? "group" : undefined}
      aria-label={
        props.ariaLabel ? translator.translateText(props.ariaLabel) : undefined
      }
    >
      <span className="inline-flex items-center gap-1.5 pr-1 text-xs font-medium text-gray-500">
        <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
        {translator.translateText("Filter")}
        {props.activeCount > 0 && (
          <span
            className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700"
            data-testid="facet-filter-bar-count"
          >
            {props.activeCount}
          </span>
        )}
      </span>

      {props.children}

      {props.onClearAll && (
        <button
          type="button"
          onClick={props.onClearAll}
          data-testid="facet-filter-bar-clear-all"
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200/60 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Icon icon={IconProp.Close} className="h-3 w-3" />
          {translator.translateText("Clear all")}
        </button>
      )}
    </div>
  );
};

export default FacetFilterBar;
