import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Card from "Common/UI/Components/Card/Card";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Input from "Common/UI/Components/Input/Input";
import Table from "Common/UI/Components/Table/Table";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT,
  PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS,
  PRODUCT_ANALYTICS_PEOPLE_FILTERS,
  PRODUCT_ANALYTICS_SEARCH_MAX_LENGTH,
  ProductAnalyticsPeopleDto,
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsPersonDto,
  toProductAnalyticsPersonSegment,
} from "Common/Types/Rum/ProductAnalytics";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { fetchProductAnalyticsPeople } from "./ProductAnalyticsApi";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "./useProductAnalyticsRead";
import {
  PRODUCT_ANALYTICS_FILTER_LABELS,
  ProductAnalyticsPersonWords,
  describeProductAnalyticsCountry,
  describeProductAnalyticsDevice,
  describeProductAnalyticsPerson,
  formatProductAnalyticsCount,
} from "./ProductAnalyticsFormat";

/*
 * The people behind the numbers above (issue #6444): who was active, new,
 * returning, signed in or anonymous in the range, who has gone quiet, or
 * everyone - one row per person, most recently seen first, each a link to
 * the person's own page.
 *
 * Names: a signed-in user is named by the reference the application gave
 * identify(), read from their newest recording still kept, and only for a
 * role allowed to see who end users are. The search box is there only for
 * such a role, since nobody else can search by a name they cannot see.
 */

export const PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE: number =
  DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT;

/* How long a pause in typing starts a search. */
export const PRODUCT_ANALYTICS_SEARCH_DELAY_MS: number = 350;

export interface ProductAnalyticsPeopleCardProps {
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
  filter: ProductAnalyticsPeopleFilter;
  dormantAfterDays: number;
  onFilterChange: (filter: ProductAnalyticsPeopleFilter) => void;
  onDormantAfterDaysChange: (days: number) => void;
  reloadToken: number;
  /*
   * The Users page's state as a query string, carried by each person's link
   * so the person page's Back to users returns to the same range and filter.
   */
  linkSearch?: string | undefined;
}

interface PersonRow extends ProductAnalyticsPersonDto {
  words: ProductAnalyticsPersonWords;
  route: Route;
}

export function buildProductAnalyticsPersonRoute(data: {
  rumApplicationId: ObjectID;
  personKey: string;
  search?: string | undefined;
}): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_PERSON] as Route,
    {
      modelId: data.rumApplicationId,
      subModelId: toProductAnalyticsPersonSegment(data.personKey),
    },
  );
  const search: string = (data.search || "").replace(/^\?/, "");

  return search ? new Route(`${route.toString()}?${search}`) : route;
}

function getPeopleColumns(translator: Translator): Columns<PersonRow> {
  const date: (value: number) => string = (value: number): string => {
    return value > 0
      ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(new Date(value))
      : "-";
  };

  return [
    {
      title: "Person",
      key: "personKey",
      type: FieldType.Element,
      disableSort: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-xs",
      getElement: (row: PersonRow): ReactElement => {
        return (
          <div className="min-w-0">
            <AppLink
              to={row.route}
              className="block truncate text-sm font-medium text-indigo-700 hover:underline"
              dataTestId="product-analytics-person-link"
            >
              <span dir={row.words.isLabel ? "auto" : undefined}>
                {row.words.primary}
              </span>
            </AppLink>
            <div className="truncate font-mono text-xs text-gray-500">
              {row.words.secondary}
            </div>
          </div>
        );
      },
    },
    {
      title: "Last seen",
      key: "lastSeenAt",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: PersonRow): ReactElement => {
        return <span>{date(row.lastSeenAt)}</span>;
      },
    },
    {
      title: "First seen",
      key: "firstSeenAt",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: PersonRow): ReactElement => {
        return <span>{date(row.firstSeenAt)}</span>;
      },
    },
    {
      title: "Sessions in range",
      key: "sessionsInRange",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: PersonRow): ReactElement => {
        return (
          <span className="tabular-nums">
            {formatProductAnalyticsCount(row.sessionsInRange, translator)}
          </span>
        );
      },
    },
    {
      title: "All sessions",
      key: "totalSessions",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: translationKey(
        "Every session of theirs the last 13 months hold, in any range.",
      ),
      getElement: (row: PersonRow): ReactElement => {
        return (
          <span className="tabular-nums">
            {formatProductAnalyticsCount(row.totalSessions, translator)}
          </span>
        );
      },
    },
    {
      title: "Device",
      key: "deviceType",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: PersonRow): ReactElement => {
        return (
          <span>
            {describeProductAnalyticsDevice(row.deviceType, translator)}
          </span>
        );
      },
    },
    {
      title: "Country",
      key: "countryCode",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: PersonRow): ReactElement => {
        return (
          <span>
            {row.countryCode
              ? describeProductAnalyticsCountry(
                  row.countryCode,
                  translator.language,
                )
              : "-"}
          </span>
        );
      },
    },
  ];
}

const ProductAnalyticsPeopleCard: FunctionComponent<
  ProductAnalyticsPeopleCardProps
> = (props: ProductAnalyticsPeopleCardProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [searchText, setSearchText] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  /*
   * The question as a string: the page hands a new ObjectID on every
   * render, and a read keyed on that would run again each time.
   */
  const rumApplicationId: string = props.rumApplicationId.toString();

  const queryKey: string = JSON.stringify({
    app: rumApplicationId,
    start: props.startTime.getTime(),
    end: props.endTime.getTime(),
    filter: props.filter,
    dormant: props.dormantAfterDays,
    search: search,
  });
  /* A page number belongs to the query it was reached in; a new query is page 1. */
  const [page, setPage] = useState<{ number: number; queryKey: string }>({
    number: 1,
    queryKey: queryKey,
  });
  const pageNumber: number = page.queryKey === queryKey ? page.number : 1;

  useEffect((): (() => void) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setSearch(searchText.trim());
    }, PRODUCT_ANALYTICS_SEARCH_DELAY_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [searchText]);

  const read: ProductAnalyticsRead<ProductAnalyticsPeopleDto> =
    useProductAnalyticsRead<ProductAnalyticsPeopleDto>(
      `${queryKey}|${pageNumber}|${props.reloadToken}`,
      (): Promise<ProductAnalyticsPeopleDto> => {
        return fetchProductAnalyticsPeople({
          rumApplicationId: props.rumApplicationId,
          startTime: props.startTime,
          endTime: props.endTime,
          filter: props.filter,
          dormantAfterDays: props.dormantAfterDays,
          search: search,
          limit: PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE,
          offset: (pageNumber - 1) * PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE,
        });
      },
    );
  const people: ProductAnalyticsPeopleDto | null = read.data;
  /* Whether names were in the last answer: the search box needs them. */
  const canSearch: boolean = Boolean(people?.includesLabels);

  const rows: Array<PersonRow> = useMemo((): Array<PersonRow> => {
    return (people?.people || []).map(
      (person: ProductAnalyticsPersonDto): PersonRow => {
        return {
          ...person,
          words: describeProductAnalyticsPerson(person, translator),
          route: buildProductAnalyticsPersonRoute({
            rumApplicationId: new ObjectID(rumApplicationId),
            personKey: person.personKey,
            search: props.linkSearch,
          }),
        };
      },
    );
  }, [people, translator, rumApplicationId, props.linkSearch]);

  const columns: Columns<PersonRow> = useMemo((): Columns<PersonRow> => {
    return getPeopleColumns(translator);
  }, [translator]);

  const isSearching: boolean = search.length > 0;

  return (
    <Card
      title="People"
      description="Everyone the numbers above count, one row per person, most recently seen first. Open a person for their sessions."
    >
      <div className="space-y-4" data-testid="product-analytics-people">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterButtons
            className="flex-wrap"
            ariaLabel="People"
            dataTestId="product-analytics-people-filter"
            selectedValue={props.filter}
            onSelect={(value: string): void => {
              props.onFilterChange(value as ProductAnalyticsPeopleFilter);
            }}
            options={PRODUCT_ANALYTICS_PEOPLE_FILTERS.map(
              (
                filter: ProductAnalyticsPeopleFilter,
              ): { label: string; value: string } => {
                return {
                  label: PRODUCT_ANALYTICS_FILTER_LABELS[filter],
                  value: filter,
                };
              },
            )}
          />
          {canSearch || isSearching ? (
            <div className="w-full lg:w-72">
              <Input
                value={searchText}
                onChange={setSearchText}
                placeholder="Search signed-in users by name"
                ariaLabel="Search signed-in users by name"
                maxLength={PRODUCT_ANALYTICS_SEARCH_MAX_LENGTH}
                dataTestId="product-analytics-people-search"
                isSearchOrFilter={true}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
        {props.filter === ProductAnalyticsPeopleFilter.Dormant ? (
          <div
            className="flex flex-wrap items-center gap-2 text-sm text-gray-600"
            data-testid="product-analytics-dormant-window"
          >
            <span>{translator.translateText("Dormant after")}</span>
            <FilterButtons
              className="flex-wrap"
              ariaLabel="Dormant after"
              dataTestId="product-analytics-dormant"
              selectedValue={String(props.dormantAfterDays)}
              onSelect={(value: string): void => {
                props.onDormantAfterDaysChange(Number(value));
              }}
              options={PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS.map(
                (days: number): { label: string; value: string } => {
                  return {
                    label: translator.translatePlural(
                      { one: "{{count}} day", other: "{{count}} days" },
                      days,
                    ),
                    value: String(days),
                  };
                },
              )}
            />
          </div>
        ) : (
          <></>
        )}
        {read.error ? (
          <ErrorMessage message={read.error} onRefreshClick={read.reload} />
        ) : (
          <Table<PersonRow>
            id="product-analytics-people-table"
            data={rows}
            columns={columns}
            isLoading={read.isLoading}
            error=""
            singularLabel="Person"
            pluralLabel="People"
            currentPageNumber={pageNumber}
            totalItemsCount={
              PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE * (pageNumber - 1) +
              rows.length
            }
            itemsOnPage={PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE}
            itemsOnPageOptions={[PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE]}
            hasMore={Boolean(people?.hasMore)}
            paginationDataTestId="product-analytics-people-pagination"
            onNavigateToPage={(next: number): void => {
              setPage({ number: next, queryKey: queryKey });
            }}
            sortBy={null}
            sortOrder={SortOrder.Descending}
            onSortChanged={(): void => {
              /* Most recently seen first: the route's only order. */
            }}
            noItemsMessage={
              <div
                className="flex bg-white px-6 py-12"
                data-testid="product-analytics-people-empty"
              >
                <div className="m-auto max-w-md text-center">
                  <Icon
                    icon={IconProp.UserGroup}
                    className="mx-auto h-10 w-10 rounded-lg bg-indigo-50 p-2 text-indigo-500"
                  />
                  <p className="mt-3 text-sm font-semibold text-gray-900">
                    {isSearching
                      ? translator.translateText(
                          "Nobody whose name matches this search.",
                        )
                      : translator.translateText(
                          "Nobody to show for this filter and range.",
                        )}
                  </p>
                </div>
              </div>
            }
          />
        )}
      </div>
    </Card>
  );
};

export default ProductAnalyticsPeopleCard;
