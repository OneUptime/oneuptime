import {
  CATEGORY_FILTER_LABEL,
  DATA_FILTER_LABEL,
  DATA_FILTER_OPTIONS,
  DATA_STATUS_UNKNOWN,
  FILTERS_LABEL,
  GO_TO_CONNECTIONS,
  NOTHING_SENT,
  RECOMMENDED,
  RULE_COUNT,
  RULE_LIBRARY_CATEGORY_TITLES,
  STATUS_FILTER_LABEL,
  STATUS_FILTER_OPTIONS,
} from "./RuleLibraryCopy";
import {
  LibraryDataFilter,
  LibraryRuleFilter,
  LibraryStatusFilter,
  RECOMMENDED_FILTER,
  RuleLibraryFilters,
  countRuleLibraryChipFilters,
} from "./RuleLibraryUtil";
import FacetFilterBar from "../ResourceOwners/FacetFilterBar";
import FilterChipDropdown from "../ResourceOwners/FilterChipDropdown";
import { FilterChipDropdownOption } from "../ResourceOwners/FilterChipDropdownTypes";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What to narrow the library to, in the row every list's filters sit in
 * (FacetFilterBar: "Filter", the chips, "Clear all" once one is set) and
 * with the chips every list uses (FilterChipDropdown), so the library's
 * filters look and work as a host list's or Session Replay's do: Rule
 * category (or the recommended rules), Data - whether the project sends
 * what the rules read - and Status - whether it has added them. How many
 * rules are in sight follows the chips.
 *
 * The Data chip is offered only while it can narrow the list: not when the
 * project's events could not be read, nor when none arrived this week -
 * each said once under the chips, with what to do about it, rather than a
 * chip that does nothing.
 */

export const RULE_LIBRARY_FILTERS_TEST_ID: string = "rule-library-filters";
export const RULE_LIBRARY_CATEGORY_FILTER_TEST_ID: string =
  "rule-library-category";
export const RULE_LIBRARY_DATA_FILTER_TEST_ID: string = "rule-library-data";
export const RULE_LIBRARY_STATUS_FILTER_TEST_ID: string = "rule-library-status";

// The categories as the old cards drew them, now beside each in the chip's list.
const CATEGORY_ICONS: Record<DetectionRuleLibraryCategory, IconProp> = {
  [DetectionRuleLibraryCategory.Identity]: IconProp.User,
  [DetectionRuleLibraryCategory.Endpoint]: IconProp.ServerStack,
  [DetectionRuleLibraryCategory.Cloud]: IconProp.Cloud,
  [DetectionRuleLibraryCategory.Network]: IconProp.Globe,
  [DetectionRuleLibraryCategory.Web]: IconProp.GlobeAlt,
  [DetectionRuleLibraryCategory.Kubernetes]: IconProp.Cube,
  [DetectionRuleLibraryCategory.DataSecurity]: IconProp.Database,
};

/*
 * The dots the Data column draws beside Receiving and Not receiving
 * (RuleLibraryDataStatus): Tailwind's emerald-500 and gray-400.
 */
const RECEIVING_DOT_COLOR: string = "#10b981";
const NOT_RECEIVING_DOT_COLOR: string = "#9ca3af";

export interface ComponentProps {
  filters: RuleLibraryFilters;
  onChange: (filters: RuleLibraryFilters) => void;
  // How many rules the filters leave in sight; null while there is no list to count.
  shownCount: number | null;
  /*
   * The Data chip, while it can narrow the list: the project's events were
   * read (or are being read) and some arrived.
   */
  isDataFilterOffered: boolean;
  // The events could not be read: said once, with a way to try again.
  isDataFailed: boolean;
  onRetryData: () => void;
  /*
   * The project sent no security event this week: said once, with the way
   * to Connections, rather than "Not receiving" on every rule.
   */
  isNothingSent: boolean;
}

const NOTICE_CLASS_NAME: string =
  "-mt-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500";

const NOTICE_LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const RuleLibraryFilterBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const activeCount: number = countRuleLibraryChipFilters(
    props.filters,
    props.isDataFilterOffered,
  );

  // An option's name in the reader's language: the chip draws it as it is.
  const optionLabel: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const categoryOptions: Array<FilterChipDropdownOption> = [
    {
      value: RECOMMENDED_FILTER,
      label: optionLabel(RECOMMENDED),
      icon: IconProp.Star,
    },
    ...DETECTION_RULE_LIBRARY_CATEGORIES.map(
      (category: DetectionRuleLibraryCategory): FilterChipDropdownOption => {
        return {
          value: category,
          label: optionLabel(RULE_LIBRARY_CATEGORY_TITLES[category]),
          icon: CATEGORY_ICONS[category],
        };
      },
    ),
  ];

  const dataOptions: Array<FilterChipDropdownOption> = [
    {
      value: LibraryDataFilter.Received,
      label: optionLabel(DATA_FILTER_OPTIONS[LibraryDataFilter.Received]),
      color: RECEIVING_DOT_COLOR,
    },
    {
      value: LibraryDataFilter.NotReceived,
      label: optionLabel(DATA_FILTER_OPTIONS[LibraryDataFilter.NotReceived]),
      color: NOT_RECEIVING_DOT_COLOR,
    },
  ];

  // Words alone: a + beside Not added read as a button that adds.
  const statusOptions: Array<FilterChipDropdownOption> = [
    {
      value: LibraryStatusFilter.NotAdded,
      label: optionLabel(STATUS_FILTER_OPTIONS[LibraryStatusFilter.NotAdded]),
    },
    {
      value: LibraryStatusFilter.Added,
      label: optionLabel(STATUS_FILTER_OPTIONS[LibraryStatusFilter.Added]),
    },
  ];

  // A chip's single value, or none picked.
  const pickedValue: (value: string | Array<string> | null) => string = (
    value: string | Array<string> | null,
  ): string => {
    return typeof value === "string" ? value : "";
  };

  return (
    <div>
      <FacetFilterBar
        activeCount={activeCount}
        onClearAll={
          activeCount > 0
            ? () => {
                // The chips, not the search: it has its own x.
                props.onChange({
                  ...props.filters,
                  category: "",
                  data: LibraryDataFilter.Any,
                  status: LibraryStatusFilter.Any,
                });
              }
            : undefined
        }
        dataTestId={RULE_LIBRARY_FILTERS_TEST_ID}
        ariaLabel={FILTERS_LABEL}
      >
        <div data-testid={RULE_LIBRARY_CATEGORY_FILTER_TEST_ID}>
          <FilterChipDropdown
            label={CATEGORY_FILTER_LABEL}
            emptyIcon={IconProp.Squares}
            options={categoryOptions}
            value={props.filters.category || null}
            supportedOperators={["is"]}
            popoverWidthClassName="w-60"
            onChange={(value: string | Array<string> | null) => {
              props.onChange({
                ...props.filters,
                category: pickedValue(value) as LibraryRuleFilter,
              });
            }}
          />
        </div>
        {props.isDataFilterOffered ? (
          <div data-testid={RULE_LIBRARY_DATA_FILTER_TEST_ID}>
            <FilterChipDropdown
              label={DATA_FILTER_LABEL}
              emptyIcon={IconProp.Signal}
              options={dataOptions}
              value={props.filters.data || null}
              supportedOperators={["is"]}
              popoverWidthClassName="w-60"
              onChange={(value: string | Array<string> | null) => {
                props.onChange({
                  ...props.filters,
                  data: (pickedValue(value) ||
                    LibraryDataFilter.Any) as LibraryDataFilter,
                });
              }}
            />
          </div>
        ) : (
          <></>
        )}
        <div data-testid={RULE_LIBRARY_STATUS_FILTER_TEST_ID}>
          <FilterChipDropdown
            label={STATUS_FILTER_LABEL}
            emptyIcon={IconProp.CheckCircle}
            options={statusOptions}
            value={props.filters.status || null}
            supportedOperators={["is"]}
            popoverWidthClassName="w-60"
            onChange={(value: string | Array<string> | null) => {
              props.onChange({
                ...props.filters,
                status: (pickedValue(value) ||
                  LibraryStatusFilter.Any) as LibraryStatusFilter,
              });
            }}
          />
        </div>
        {props.shownCount !== null ? (
          <span
            data-testid="rule-library-count"
            role="status"
            className="whitespace-nowrap pl-1 text-xs text-gray-500"
          >
            {translator.translatePlural(RULE_COUNT, props.shownCount)}
          </span>
        ) : (
          <></>
        )}
      </FacetFilterBar>
      {props.isDataFailed ? (
        <div
          className={NOTICE_CLASS_NAME}
          data-testid="rule-library-data-unknown"
        >
          <div className="inline-flex items-center gap-1.5">
            <Icon
              icon={IconProp.Alert}
              className="h-3.5 w-3.5 flex-none text-gray-400"
            />
            {translator.translateText(DATA_STATUS_UNKNOWN)}
          </div>
          <button
            type="button"
            data-testid="rule-library-data-retry"
            className={NOTICE_LINK_CLASS_NAME}
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
          className={NOTICE_CLASS_NAME}
          data-testid="rule-library-nothing-sent"
        >
          <div className="inline-flex items-center gap-1.5">
            <Icon
              icon={IconProp.Info}
              className="h-3.5 w-3.5 flex-none text-gray-400"
            />
            {translator.translateText(NOTHING_SENT)}
          </div>
          <Link
            to={
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
              ) as Route
            }
            className={NOTICE_LINK_CLASS_NAME}
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
