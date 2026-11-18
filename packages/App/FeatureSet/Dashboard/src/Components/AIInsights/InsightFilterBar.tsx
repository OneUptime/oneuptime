import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  findDropdownOption,
  getTranslatedDropdownOption,
  readPickedDropdownValue,
} from "Common/UI/Components/Dropdown/DropdownChoices";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface InsightFilterOption {
  // English, translated when drawn.
  label: string;
  value: string;
}

export interface ComponentProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  typeOptions: Array<InsightFilterOption>;
  typeValue: string;
  onTypeChange: (value: string) => void;
  /*
   * Off where the list holds one kind of insight (a product's own AI
   * insights): a type filter would offer one choice.
   */
  isTypeFilterShown?: boolean | undefined;
  severityOptions: Array<InsightFilterOption>;
  severityValue: string;
  onSeverityChange: (value: string) => void;
  // When the insight was last detected; filters like type and severity.
  seenWithinOptions: Array<InsightFilterOption>;
  seenWithinValue: string;
  onSeenWithinChange: (value: string) => void;
  // The order of the list. Not a filter: it never tints and Clear keeps it.
  sortOptions: Array<InsightFilterOption>;
  sortValue: string;
  onSortChange: (value: string) => void;
  // The value a filter carries when it narrows nothing: its placeholder.
  unfilteredValue: string;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

interface FilterSelectProps {
  ariaLabel: string;
  options: Array<InsightFilterOption>;
  value: string;
  onChange: (value: string) => void;
  // The value that narrows nothing ("All types"), when the picker has one.
  unfilteredValue?: string | undefined;
}

/*
 * One picker of the bar, the shared Dropdown. A filter's "All types" /
 * "Any severity" is its placeholder, so a picker that narrows the list
 * shows its choice and a clear (x) control, and clearing it lists every
 * insight again. The order has no such choice and is never cleared.
 */
const FilterSelect: FunctionComponent<FilterSelectProps> = (
  props: FilterSelectProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const unfilteredChoice: InsightFilterOption | undefined =
    props.unfilteredValue === undefined
      ? undefined
      : props.options.find((option: InsightFilterOption): boolean => {
          return option.value === props.unfilteredValue;
        });
  const options: Array<DropdownOption> = props.options
    .filter((option: InsightFilterOption): boolean => {
      return option !== unfilteredChoice;
    })
    .map((option: InsightFilterOption): DropdownOption => {
      return getTranslatedDropdownOption(
        option.value,
        translator.translateText(option.label) || option.label,
      );
    });

  return (
    <div className="w-full sm:w-48">
      <Dropdown
        className="relative w-full overflow-visible"
        ariaLabel={translator.translateText(props.ariaLabel)}
        isAriaLabelTranslated={true}
        options={options}
        value={findDropdownOption(options, props.value)}
        placeholder={
          unfilteredChoice
            ? translator.translateText(unfilteredChoice.label) ||
              unfilteredChoice.label
            : undefined
        }
        isPlaceholderTranslated={true}
        isClearable={Boolean(unfilteredChoice)}
        onChange={(next: DropdownValue | Array<DropdownValue> | null): void => {
          const picked: string | null = readPickedDropdownValue(next);

          if (picked === null) {
            if (unfilteredChoice) {
              props.onChange(unfilteredChoice.value);
            }
            return;
          }

          if (picked !== props.value) {
            props.onChange(picked);
          }
        }}
      />
    </div>
  );
};

/*
 * Search, type, severity, time range and order in one bar. The status filter
 * is not here — it lives on the count tiles above, which is what let this
 * collapse from three wrapping rows of pills into a single row.
 *
 * One row where it fits. Where it does not - beside the side menu at a
 * small laptop's width, or with every kind's type filter - the selects
 * move under the search, which keeps room to type in: in one row the
 * search was squeezed to its icon and the last select ran past the bar.
 */
const InsightFilterBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
        <label htmlFor="ai-insight-search" className="sr-only">
          {translator.translateText("Search insights")}
        </label>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <Icon icon={IconProp.Search} className="h-4 w-4" />
        </span>
        <Input
          isSearchOrFilter={true}
          id="ai-insight-search"
          placeholder="Search insights by title..."
          value={props.searchText}
          onChange={props.onSearchTextChange}
          outerDivClassName="relative w-full"
          className="block w-full rounded-lg border border-transparent bg-transparent py-2 pl-9 pr-9 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {props.searchText ? (
          <button
            type="button"
            aria-label={translator.translateText("Clear search")}
            onClick={() => {
              props.onSearchTextChange("");
            }}
            className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        ) : (
          <></>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {props.isTypeFilterShown === false ? (
          <></>
        ) : (
          <FilterSelect
            ariaLabel={translationKey("Filter by insight type")}
            options={props.typeOptions}
            value={props.typeValue}
            onChange={props.onTypeChange}
            unfilteredValue={props.unfilteredValue}
          />
        )}

        <FilterSelect
          ariaLabel={translationKey("Filter by severity")}
          options={props.severityOptions}
          value={props.severityValue}
          onChange={props.onSeverityChange}
          unfilteredValue={props.unfilteredValue}
        />

        <FilterSelect
          ariaLabel={translationKey("Filter by when last seen")}
          options={props.seenWithinOptions}
          value={props.seenWithinValue}
          onChange={props.onSeenWithinChange}
          unfilteredValue={props.unfilteredValue}
        />

        <FilterSelect
          ariaLabel={translationKey("Sort insights")}
          options={props.sortOptions}
          value={props.sortValue}
          onChange={props.onSortChange}
        />

        {props.hasActiveFilters ? (
          <button
            type="button"
            onClick={props.onClearFilters}
            className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
            {translator.translateText("Clear")}
          </button>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default InsightFilterBar;
