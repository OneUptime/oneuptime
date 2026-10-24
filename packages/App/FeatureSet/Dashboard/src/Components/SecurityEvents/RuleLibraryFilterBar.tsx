import {
  ALL_CATEGORIES,
  CATEGORY_FILTER_LABEL,
  DATA_FILTER_LABEL,
  DATA_FILTER_OPTIONS,
  DATA_STATUS_UNKNOWN,
  GO_TO_CONNECTIONS,
  NOTHING_SENT,
  RECOMMENDED,
  RULE_COUNT,
  RULE_LIBRARY_CATEGORY_TITLES,
  STATUS_FILTER_LABEL,
  STATUS_FILTER_OPTIONS,
} from "./RuleLibraryCopy";
import {
  LIBRARY_DATA_FILTERS,
  LIBRARY_RULE_FILTERS,
  LIBRARY_STATUS_FILTERS,
  LibraryDataFilter,
  LibraryRuleFilter,
  LibraryStatusFilter,
  RECOMMENDED_FILTER,
  RuleLibraryFilters,
  isRuleLibraryFiltered,
} from "./RuleLibraryUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { DetectionRuleLibraryCategory } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { CLEAR_FILTERS } from "Common/UI/Components/Table/TableEmptyStateBuilders";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What to narrow the library to, in three selects under the card's title -
 * Category (or the recommended rules), Data (the rules whose events the
 * project sends, or does not send yet) and Status (added or not) - with how
 * many rules are in sight and the way back to all of them at the row's
 * end. Selects rather than a row of buttons: a row of buttons across the
 * card read as tabs. A select that narrows the list is tinted, so a
 * filtered list says so at a glance; on a phone the selects stack.
 */

export const RULE_LIBRARY_CATEGORY_SELECT_TEST_ID: string =
  "rule-library-category";
export const RULE_LIBRARY_DATA_SELECT_TEST_ID: string = "rule-library-data";
export const RULE_LIBRARY_STATUS_SELECT_TEST_ID: string = "rule-library-status";

const SELECT_CLASS_NAME: string =
  "block w-full min-w-0 rounded-md border py-2 pl-3 pr-8 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";

// A select at its default, and one that narrows the list.
const SELECT_IDLE_CLASS_NAME: string = "border-gray-300 bg-white text-gray-700";
const SELECT_ACTIVE_CLASS_NAME: string =
  "border-indigo-300 bg-indigo-50 text-indigo-700";

export interface ComponentProps {
  filters: RuleLibraryFilters;
  onChange: (filters: RuleLibraryFilters) => void;
  // How many rules the filters leave in sight.
  shownCount: number;
  // Whether the project's events were read: the Data select needs them.
  isDataKnown: boolean;
  // The events could not be read: said once, with a way to try again.
  isDataFailed: boolean;
  onRetryData: () => void;
  /*
   * The project sent no security event this week: said once, with the way
   * to Connections, rather than "Not receiving" on every rule.
   */
  isNothingSent: boolean;
}

function getCategoryOptionText(
  item: LibraryRuleFilter,
  translator: Translator,
): string {
  const text: string = !item
    ? ALL_CATEGORIES
    : item === RECOMMENDED_FILTER
      ? RECOMMENDED
      : RULE_LIBRARY_CATEGORY_TITLES[item as DetectionRuleLibraryCategory];

  return translator.translateText(text) || text;
}

const RuleLibraryFilterBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isFiltered: boolean = isRuleLibraryFiltered(props.filters);

  const selectClassName: (isActive: boolean) => string = (
    isActive: boolean,
  ): string => {
    return `${SELECT_CLASS_NAME} ${
      isActive ? SELECT_ACTIVE_CLASS_NAME : SELECT_IDLE_CLASS_NAME
    }`;
  };

  return (
    <div className="space-y-2" data-testid="rule-library-filters">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select
            data-testid={RULE_LIBRARY_CATEGORY_SELECT_TEST_ID}
            aria-label={translator.translateText(CATEGORY_FILTER_LABEL)}
            value={props.filters.category}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              props.onChange({
                ...props.filters,
                category: event.target.value as LibraryRuleFilter,
              });
            }}
            className={`col-span-2 ${selectClassName(Boolean(props.filters.category))}`}
          >
            {LIBRARY_RULE_FILTERS.map(
              (item: LibraryRuleFilter): ReactElement => {
                return (
                  <option key={item || "all"} value={item}>
                    {getCategoryOptionText(item, translator)}
                  </option>
                );
              },
            )}
          </select>
          <select
            data-testid={RULE_LIBRARY_DATA_SELECT_TEST_ID}
            aria-label={translator.translateText(DATA_FILTER_LABEL)}
            value={props.filters.data}
            disabled={!props.isDataKnown || props.isNothingSent}
            title={
              props.isDataFailed
                ? translator.translateText(DATA_STATUS_UNKNOWN)
                : undefined
            }
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              props.onChange({
                ...props.filters,
                data: event.target.value as LibraryDataFilter,
              });
            }}
            className={selectClassName(
              Boolean(props.filters.data) &&
                props.isDataKnown &&
                !props.isNothingSent,
            )}
          >
            {LIBRARY_DATA_FILTERS.map(
              (item: LibraryDataFilter): ReactElement => {
                return (
                  <option key={item || "any"} value={item}>
                    {translator.translateText(DATA_FILTER_OPTIONS[item])}
                  </option>
                );
              },
            )}
          </select>
          <select
            data-testid={RULE_LIBRARY_STATUS_SELECT_TEST_ID}
            aria-label={translator.translateText(STATUS_FILTER_LABEL)}
            value={props.filters.status}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              props.onChange({
                ...props.filters,
                status: event.target.value as LibraryStatusFilter,
              });
            }}
            className={selectClassName(Boolean(props.filters.status))}
          >
            {LIBRARY_STATUS_FILTERS.map(
              (item: LibraryStatusFilter): ReactElement => {
                return (
                  <option key={item || "any"} value={item}>
                    {translator.translateText(STATUS_FILTER_OPTIONS[item])}
                  </option>
                );
              },
            )}
          </select>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500 md:justify-end">
          <span
            data-testid="rule-library-count"
            role="status"
            className="whitespace-nowrap"
          >
            {translator.translatePlural(RULE_COUNT, props.shownCount)}
          </span>
          {isFiltered ? (
            <button
              type="button"
              data-testid="rule-library-clear-filters"
              className="whitespace-nowrap rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              onClick={() => {
                props.onChange({
                  category: "",
                  data: LibraryDataFilter.Any,
                  status: LibraryStatusFilter.Any,
                  search: "",
                });
              }}
            >
              {translator.translateText(CLEAR_FILTERS)}
            </button>
          ) : (
            <></>
          )}
        </div>
      </div>
      {props.isDataFailed ? (
        <div
          className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500"
          data-testid="rule-library-data-unknown"
        >
          <span>{translator.translateText(DATA_STATUS_UNKNOWN)}</span>
          <button
            type="button"
            data-testid="rule-library-data-retry"
            className="rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={props.onRetryData}
          >
            {translator.translateText("Try again")}
          </button>
        </div>
      ) : (
        <></>
      )}
      {props.isNothingSent ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500"
          data-testid="rule-library-nothing-sent"
        >
          <span>{translator.translateText(NOTHING_SENT)}</span>
          <Link
            to={
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
              ) as Route
            }
            className="inline-flex items-center gap-1 rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            dataTestId="rule-library-nothing-sent-link"
          >
            <>
              {translator.translateText(GO_TO_CONNECTIONS)}
              <Icon icon={IconProp.ArrowRight} className="h-3 w-3" />
            </>
          </Link>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default RuleLibraryFilterBar;
