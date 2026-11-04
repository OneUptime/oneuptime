import {
  HUNTS_TEST_IDS,
  HUNT_CATEGORY_FILTER_LABEL,
  HUNT_LIBRARY_COUNT,
  HUNT_LIBRARY_NOTHING_SENT,
} from "./HuntsCopy";
import {
  HuntLibraryFilters,
  countHuntLibraryChipFilters,
} from "./HuntLibraryModel";
import {
  DATA_FILTER_LABEL,
  DATA_FILTER_OPTIONS,
  DATA_STATUS_UNKNOWN,
  FILTERS_LABEL,
  GO_TO_CONNECTIONS,
  RULE_LIBRARY_CATEGORY_TITLES,
  STATUS_FILTER_LABEL,
  STATUS_FILTER_OPTIONS,
} from "../RuleLibraryCopy";
import {
  CATEGORY_ICONS,
  NOTICE_CLASS_NAME,
  NOTICE_LINK_CLASS_NAME,
  NOT_RECEIVING_DOT_COLOR,
  RECEIVING_DOT_COLOR,
} from "../RuleLibraryFilterBar";
import { LibraryDataFilter, LibraryStatusFilter } from "../RuleLibraryUtil";
import FacetFilterBar from "../../ResourceOwners/FacetFilterBar";
import FilterChipDropdown from "../../ResourceOwners/FilterChipDropdown";
import { FilterChipDropdownOption } from "../../ResourceOwners/FilterChipDropdownTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { DetectionRuleLibraryCategory } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { getSecurityHuntLibraryCategories } from "Common/Types/SecurityEvent/SecurityHuntLibrary";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  filters: HuntLibraryFilters;
  onChange: (filters: HuntLibraryFilters) => void;
  // How many starters the filters leave in sight; null while there is no list to count.
  shownCount: number | null;
  // The Data chip, while it can narrow the list: the events were read (or are being read) and some arrived.
  isDataFilterOffered: boolean;
  // The events could not be read: said once, with a way to try again.
  isDataFailed: boolean;
  onRetryData: () => void;
  // The project sent no security event this week: said once, with the way to Connections.
  isNothingSent: boolean;
}

/*
 * What to narrow the Hunt Library to, in the row every list's filters sit
 * in, with the Rule Library's own chips (FacetFilterBar, FilterChipDropdown)
 * so the two libraries read alike: Hunt category, Data - whether the
 * project sends what a starter reads - and Status - whether it has added
 * it. How many starters are in sight follows the chips.
 *
 * The Data chip is offered only while it can narrow the list, as the Rule
 * Library offers its own: not when the project's events could not be read,
 * nor when none arrived this week - each said once under the chips.
 */
const HuntLibraryFilterBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const activeCount: number = countHuntLibraryChipFilters(
    props.filters,
    props.isDataFilterOffered,
  );

  const optionLabel: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const categoryOptions: Array<FilterChipDropdownOption> =
    getSecurityHuntLibraryCategories().map(
      (category: DetectionRuleLibraryCategory): FilterChipDropdownOption => {
        return {
          value: category,
          label: optionLabel(RULE_LIBRARY_CATEGORY_TITLES[category]),
          icon: CATEGORY_ICONS[category],
        };
      },
    );

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
        dataTestId={HUNTS_TEST_IDS.libraryFilters}
        ariaLabel={FILTERS_LABEL}
      >
        <div data-testid={HUNTS_TEST_IDS.libraryCategoryFilter}>
          <FilterChipDropdown
            label={HUNT_CATEGORY_FILTER_LABEL}
            emptyIcon={IconProp.Squares}
            options={categoryOptions}
            value={props.filters.category || null}
            supportedOperators={["is"]}
            popoverWidthClassName="w-60"
            onChange={(value: string | Array<string> | null) => {
              props.onChange({
                ...props.filters,
                category: pickedValue(value) as
                  | DetectionRuleLibraryCategory
                  | "",
              });
            }}
          />
        </div>
        {props.isDataFilterOffered ? (
          <div data-testid={HUNTS_TEST_IDS.libraryDataFilter}>
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
        <div data-testid={HUNTS_TEST_IDS.libraryStatusFilter}>
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
            data-testid={HUNTS_TEST_IDS.libraryCount}
            role="status"
            className="whitespace-nowrap pl-1 text-xs text-gray-500"
          >
            {translator.translatePlural(HUNT_LIBRARY_COUNT, props.shownCount)}
          </span>
        ) : (
          <></>
        )}
      </FacetFilterBar>
      {props.isDataFailed ? (
        <div
          className={NOTICE_CLASS_NAME}
          data-testid={HUNTS_TEST_IDS.libraryDataUnknown}
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
            data-testid={`${HUNTS_TEST_IDS.libraryDataUnknown}-retry`}
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
          data-testid={HUNTS_TEST_IDS.libraryNothingSent}
        >
          <div className="inline-flex items-center gap-1.5">
            <Icon
              icon={IconProp.Info}
              className="h-3.5 w-3.5 flex-none text-gray-400"
            />
            {translator.translateText(HUNT_LIBRARY_NOTHING_SENT)}
          </div>
          <Link
            to={
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
              ) as Route
            }
            className={NOTICE_LINK_CLASS_NAME}
            dataTestId={`${HUNTS_TEST_IDS.libraryNothingSent}-link`}
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

export default HuntLibraryFilterBar;
