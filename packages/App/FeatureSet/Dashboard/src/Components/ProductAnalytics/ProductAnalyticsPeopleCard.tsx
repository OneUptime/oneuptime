import React, {
  FunctionComponent,
  ReactElement,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Card from "Common/UI/Components/Card/Card";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Table from "Common/UI/Components/Table/Table";
import Columns from "Common/UI/Components/Table/Types/Columns";
import {
  TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
  TableHeaderSearchSlot,
  TableHeaderToolbar,
  useTableHeaderSearchShortcut,
} from "Common/UI/Components/Table/TableHeaderControls";
import { CLEAR_SEARCH } from "Common/UI/Components/Table/TableEmptyStateBuilders";
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
import {
  ProductAnalyticsPersonAvatar,
  ProductAnalyticsPersonSecondary,
} from "./ProductAnalyticsPersonCard";

/*
 * The people behind the numbers above (issue #6444): who was active, new,
 * returning, signed in or anonymous in the range, who has gone quiet, or
 * everyone - one row per person, most recently seen first, each a link to
 * the person's own page.
 *
 * Names: a signed-in user is named by the reference the application gave
 * identify(), read from their newest recording still kept, and only for a
 * role allowed to see who end users are. The search, in the card's header
 * as every list's is, is there only for such a role, since nobody else can
 * search by a name they cannot see.
 */

export const PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE: number =
  DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT;

/* How long a pause in typing starts a search. */
export const PRODUCT_ANALYTICS_SEARCH_DELAY_MS: number = 350;

export const PRODUCT_ANALYTICS_SEARCH_PLACEHOLDER: string = translationKey(
  "Search signed-in users by name",
);

/* The card's words, the same with its search in the header and without. */
const PEOPLE_CARD_TITLE: string = translationKey("People");
const PEOPLE_CARD_DESCRIPTION: string = translationKey(
  "Everyone the numbers above count, one row per person, most recently seen first. Open a person for their sessions.",
);

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

/*
 * When a person was seen, as one short line: how long ago for the last
 * visit, the day for the first. The exact time is on its title, and every
 * session's on the person's page.
 */
function SeenAt(props: { at: number; isRelative: boolean }): ReactElement {
  if (!(props.at > 0)) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const date: Date = new Date(props.at);

  return (
    <time
      className="text-sm text-gray-900"
      dateTime={date.toISOString()}
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)}
    >
      {props.isRelative
        ? OneUptimeDate.fromNow(date)
        : OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, true)}
    </time>
  );
}

function getPeopleColumns(translator: Translator): Columns<PersonRow> {
  return [
    {
      title: "Person",
      key: "personKey",
      type: FieldType.Element,
      disableSort: true,
      hideTitleOnMobile: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-xs",
      getElement: (row: PersonRow): ReactElement => {
        /*
         * A one-column grid: a long name ends in "..." where the column
         * does, rather than widening the table past its card. The name's
         * own direction sets the cell's, so an address in a right-to-left
         * page keeps its start and ends in "..." on its right.
         */
        return (
          <div className="grid grid-cols-1">
            <div className="flex min-w-0 items-center gap-3">
              <ProductAnalyticsPersonAvatar
                person={row}
                words={row.words}
                size="md"
              />
              <div
                className="min-w-0 text-left rtl:text-right"
                dir={row.words.isLabel ? "auto" : undefined}
              >
                <div className="truncate">
                  <AppLink
                    to={row.route}
                    title={row.words.isLabel ? row.words.primary : undefined}
                    className="text-sm font-medium text-indigo-700 hover:underline"
                    dataTestId="product-analytics-person-link"
                  >
                    <span>{row.words.primary}</span>
                  </AppLink>
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-500">
                  <ProductAnalyticsPersonSecondary words={row.words} />
                </div>
              </div>
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
        return <SeenAt at={row.lastSeenAt} isRelative={true} />;
      },
    },
    {
      title: "First seen",
      key: "firstSeenAt",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      getElement: (row: PersonRow): ReactElement => {
        return <SeenAt at={row.firstSeenAt} isRelative={false} />;
      },
    },
    {
      title: "Sessions",
      key: "sessionsInRange",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: translationKey(
        "Their sessions in this range, and under it how many the last 13 months hold in all.",
      ),
      getElement: (row: PersonRow): ReactElement => {
        return (
          <div>
            <div className="text-sm font-medium tabular-nums text-gray-900">
              {formatProductAnalyticsCount(row.sessionsInRange, translator)}
            </div>
            <div className="mt-0.5 text-xs tabular-nums text-gray-500">
              {translator.translateTemplate("{{count}} in all", {
                count: formatProductAnalyticsCount(
                  row.totalSessions,
                  translator,
                ),
              })}
            </div>
          </div>
        );
      },
    },
    {
      title: "Device and country",
      key: "deviceType",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: PersonRow): ReactElement => {
        return (
          <div>
            <div className="text-sm text-gray-900">
              {describeProductAnalyticsDevice(row.deviceType, translator)}
            </div>
            {row.countryCode ? (
              <div className="mt-0.5 text-xs text-gray-500">
                {describeProductAnalyticsCountry(
                  row.countryCode,
                  translator.language,
                )}
              </div>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
  ];
}

/*
 * The search in the card's header: the "Search... /" pill every list has,
 * grown into the box when it is used. Escape clears and folds it.
 */
function PeopleSearch(props: {
  value: string;
  onChange: (value: string) => void;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement>;
}): ReactElement {
  const translator: Translator = useTranslator();
  const placeholder: string =
    translator.translateText(PRODUCT_ANALYTICS_SEARCH_PLACEHOLDER) ||
    PRODUCT_ANALYTICS_SEARCH_PLACEHOLDER;

  return (
    <TableHeaderSearchSlot
      isOpen={props.isOpen}
      onOpen={props.onOpen}
      dataTestId="product-analytics-people-search-slot"
    >
      <div
        className={`flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 shadow-sm ${TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME}`}
        onClick={(): void => {
          props.inputRef.current?.focus();
        }}
        role="presentation"
      >
        <Icon
          icon={IconProp.Search}
          className="h-4 w-4 flex-none text-gray-500"
        />
        <input
          ref={props.inputRef}
          type="search"
          data-testid="product-analytics-people-search"
          data-unsaved-changes-ignore="true"
          aria-label={placeholder}
          placeholder={placeholder}
          maxLength={PRODUCT_ANALYTICS_SEARCH_MAX_LENGTH}
          value={props.value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
            props.onChange(event.target.value);
          }}
          onBlur={(): void => {
            if (!props.value.trim()) {
              props.onClose();
            }
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>): void => {
            if (event.key === "Escape") {
              props.onChange("");
              props.onClose();
              event.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
        />
        {props.value ? (
          <button
            type="button"
            data-testid="product-analytics-people-search-clear"
            aria-label={translator.translateText(CLEAR_SEARCH)}
            title={translator.translateText(CLEAR_SEARCH)}
            onMouseDown={(event: React.MouseEvent): void => {
              event.preventDefault();
            }}
            onClick={(): void => {
              props.onChange("");
              props.inputRef.current?.focus();
            }}
            className={TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME}
          >
            <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
          </button>
        ) : (
          <></>
        )}
      </div>
    </TableHeaderSearchSlot>
  );
}

const ProductAnalyticsPeopleCard: FunctionComponent<
  ProductAnalyticsPeopleCardProps
> = (props: ProductAnalyticsPeopleCardProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [searchText, setSearchText] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const searchInputRef: RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  /* Rows a page: the list's own size until the reader picks another. */
  const [pageSize, setPageSize] = useState<number>(
    PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE,
  );
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
    size: pageSize,
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
          limit: pageSize,
          offset: (pageNumber - 1) * pageSize,
        });
      },
    );
  const people: ProductAnalyticsPeopleDto | null = read.data;
  const isSearching: boolean = search.length > 0;
  /*
   * Whether names were in the last answer: the search needs them. Kept
   * while a search is typed or standing, so it can be cleared.
   */
  const hasSearch: boolean =
    Boolean(people?.includesLabels) || isSearching || searchText.length > 0;

  const openSearch: () => void = (): void => {
    setIsSearchOpen(true);
    requestAnimationFrame((): void => {
      searchInputRef.current?.focus();
    });
  };

  useTableHeaderSearchShortcut(hasSearch, openSearch);

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

  const isSearchExpanded: boolean =
    isSearchOpen || searchText.trim().length > 0;

  const body: ReactElement = (
    <div className="space-y-4" data-testid="product-analytics-people">
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
          totalItemsCount={pageSize * (pageNumber - 1) + rows.length}
          itemsOnPage={pageSize}
          hasMore={Boolean(people?.hasMore)}
          paginationDataTestId="product-analytics-people-pagination"
          onNavigateToPage={(next: number, itemsOnPage: number): void => {
            if (itemsOnPage !== pageSize) {
              /* A new size is a new query: it starts on its first page. */
              setPageSize(itemsOnPage);

              return;
            }

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
  );

  /*
   * No search, no header controls: an empty toolbar would still take a line
   * of the header on a phone.
   */
  if (!hasSearch) {
    return (
      <Card title={PEOPLE_CARD_TITLE} description={PEOPLE_CARD_DESCRIPTION}>
        {body}
      </Card>
    );
  }

  const peopleToolbar: ReactElement = (
    <TableHeaderToolbar
      key="product-analytics-people-toolbar"
      dataTestId="product-analytics-people-toolbar"
      isSearchOpen={isSearchExpanded}
      search={
        <PeopleSearch
          value={searchText}
          onChange={setSearchText}
          isOpen={isSearchExpanded}
          onOpen={openSearch}
          onClose={(): void => {
            setIsSearchOpen(false);
          }}
          inputRef={searchInputRef}
        />
      }
    />
  );

  return (
    <Card
      title={PEOPLE_CARD_TITLE}
      description={PEOPLE_CARD_DESCRIPTION}
      headerLayout="toolbar"
      buttons={[peopleToolbar]}
    >
      {body}
    </Card>
  );
};

export default ProductAnalyticsPeopleCard;
