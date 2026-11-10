import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Table from "Common/UI/Components/Table/Table";
import { useAreTableColumnsFolded } from "Common/UI/Components/Table/TableCellContext";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  getInlineSeparator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  DEFAULT_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT,
  ProductAnalyticsPersonDetailDto,
  ProductAnalyticsPersonDto,
  ProductAnalyticsPersonSessionDto,
  fromProductAnalyticsPersonSegment,
} from "Common/Types/Rum/ProductAnalytics";
import ProductAnalyticsPersonCard from "../../../Components/ProductAnalytics/ProductAnalyticsPersonCard";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../../Components/AppLink/AppLink";
import { fetchProductAnalyticsPerson } from "../../../Components/ProductAnalytics/ProductAnalyticsApi";
import {
  NOT_REPORTED,
  describeProductAnalyticsCountry,
  describeProductAnalyticsDevice,
  formatProductAnalyticsDuration,
} from "../../../Components/ProductAnalytics/ProductAnalyticsFormat";
import {
  ProductAnalyticsUrlState,
  buildProductAnalyticsSearch,
  readProductAnalyticsUrlState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsUrlState";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "../../../Components/ProductAnalytics/useProductAnalyticsRead";

/*
 * One person of Product Analytics > Users (issue #6444): when they first
 * and last came, how many sessions the last 13 months hold, and each of
 * those sessions, newest first, with a link to watch the ones whose
 * recording is still kept.
 *
 * The route is ":id/product-analytics-users/:subModelId", the person's key
 * with its colon as a dash ("u-…" or "v-…"). Read from the router's
 * location, so a move from one person to another re-reads.
 */

export const PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE: number =
  DEFAULT_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT;

export interface ProductAnalyticsPersonPath {
  rumApplicationId: string;
  personKey: string | null;
}

/* The application and the person a person page's path names. */
export function parseProductAnalyticsPersonPath(
  pathname: string,
): ProductAnalyticsPersonPath | null {
  const segments: Array<string> = pathname
    .split("?")[0]!
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });
  const index: number = segments.lastIndexOf("product-analytics-users");

  if (index < 1 || index !== segments.length - 2) {
    return null;
  }

  let segment: string;

  try {
    segment = decodeURIComponent(segments[index + 1] as string);
  } catch {
    /* A malformed escape ("%E0%A4") names nobody; it must not break the page. */
    return { rumApplicationId: segments[index - 1] as string, personKey: null };
  }

  return {
    rumApplicationId: segments[index - 1] as string,
    personKey: fromProductAnalyticsPersonSegment(segment),
  };
}

/*
 * The Users page a person page goes back to: the one the person was opened
 * from, with its range and filter, which the person's link carries in its
 * query. Only the keys the Users page reads are kept.
 */
export function buildProductAnalyticsBackRoute(data: {
  rumApplicationId: string;
  search: string;
}): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_USERS] as Route,
    { modelId: data.rumApplicationId },
  );
  const state: ProductAnalyticsUrlState = readProductAnalyticsUrlState(
    data.search,
  );
  const search: string = buildProductAnalyticsSearch({
    timeRange: state.timeRange,
    filter: state.filter,
    dormantAfterDays: state.dormantAfterDays,
  });

  return search ? new Route(`${route.toString()}${search}`) : route;
}

interface SessionRow extends ProductAnalyticsPersonSessionDto {
  watchRoute: Route | null;
}

/*
 * A session's errors and frustration signals as badges, or "None": the
 * two things that say a session went wrong, side by side.
 */
function SessionSignals(props: {
  row: SessionRow;
  translator: Translator;
}): ReactElement {
  const isFolded: boolean = useAreTableColumnsFolded();
  const badges: Array<ReactElement> = [];

  if (props.row.errorCount > 0) {
    badges.push(
      <StatusBadge
        key="errors"
        type={StatusBadgeType.Danger}
        text={props.translator.translatePlural(
          { one: "{{count}} error", other: "{{count}} errors" },
          props.row.errorCount,
        )}
      />,
    );
  }

  if (props.row.frustrationCount > 0) {
    badges.push(
      <StatusBadge
        key="frustration"
        type={StatusBadgeType.Warning}
        text={props.translator.translatePlural(
          {
            one: "{{count}} frustration signal",
            other: "{{count}} frustration signals",
          },
          props.row.frustrationCount,
        )}
      />,
    );
  }

  if (badges.length === 0) {
    /*
     * In a column of its own, a clean session says so; folded under its
     * length, it says nothing rather than "None" under every clean row.
     */
    return isFolded ? (
      <></>
    ) : (
      <span className="text-sm text-gray-500">
        {props.translator.translateText("None")}
      </span>
    );
  }

  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="product-analytics-person-signals"
    >
      {badges}
    </div>
  );
}

function getSessionColumns(translator: Translator): Columns<SessionRow> {
  return [
    {
      title: "Started",
      key: "startedAt",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        const started: Date = new Date(row.startedAt);

        /* How long ago, as Session Replay's list says it, and the exact time under it. */
        return (
          <div>
            <time
              className="text-sm font-medium text-gray-900"
              dateTime={started.toISOString()}
            >
              {OneUptimeDate.fromNow(started)}
            </time>
            <div className="mt-0.5 text-xs text-gray-500">
              {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(started)}
            </div>
          </div>
        );
      },
    },
    {
      title: "Entry page",
      key: "entryPage",
      type: FieldType.Element,
      disableSort: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-56",
      getElement: (row: SessionRow): ReactElement => {
        /*
         * One line, ending in "..." where the column does: a page is
         * written left to right in any page, so its start stays in view.
         */
        return (
          <div className="grid grid-cols-1">
            <div
              className="truncate text-sm text-gray-900"
              dir="ltr"
              title={row.entryPage || undefined}
            >
              {row.entryPage ||
                translator.translateText(NOT_REPORTED) ||
                NOT_REPORTED}
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              {translator.translatePlural(
                { one: "{{count}} page", other: "{{count}} pages" },
                row.pageCount,
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: "Length",
      key: "durationMs",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        return row.isFinished ? (
          <span className="text-sm tabular-nums text-gray-900">
            {formatProductAnalyticsDuration(
              row.durationMs,
              translator.language,
            )}
          </span>
        ) : (
          <span className="text-sm text-gray-500">
            {translator.translateText("Still recording")}
          </span>
        );
      },
    },
    {
      title: "Device and country",
      key: "deviceType",
      type: FieldType.Element,
      disableSort: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-56",
      getElement: (row: SessionRow): ReactElement => {
        const separator: string = getInlineSeparator(translator.language);
        const place: string = [
          describeProductAnalyticsDevice(row.deviceType, translator),
          row.countryCode
            ? describeProductAnalyticsCountry(
                row.countryCode,
                translator.language,
              )
            : "",
        ]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(separator);
        const software: string = [row.browserName, row.osName]
          .filter((part: string): boolean => {
            return part.trim().length > 0;
          })
          .join(separator);

        /* What it came from and where, then the browser and system under it. */
        return (
          <div className="grid grid-cols-1">
            <div className="truncate text-sm text-gray-900" title={place}>
              {place}
            </div>
            {software ? (
              <div
                className="mt-0.5 truncate text-xs text-gray-500"
                title={software}
              >
                {software}
              </div>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      title: "Signals",
      key: "errorCount",
      type: FieldType.Element,
      disableSort: true,
      /* Under the length where the card has no room for a column of its own. */
      hideBelowLargeScreen: true,
      foldInto: "durationMs",
      headerTooltip: translationKey(
        "The errors the page reported in the session, and its frustration signals, such as rage clicks or dead clicks.",
      ),
      getElement: (row: SessionRow): ReactElement => {
        return <SessionSignals row={row} translator={translator} />;
      },
    },
    {
      title: "Recording",
      key: "sessionId",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        /*
         * A link, as Session Replay's own Watch is, so Cmd-click and
         * middle-click still open the player in a new tab.
         */
        return row.watchRoute ? (
          <AppLink
            to={row.watchRoute}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-indigo-600 hover:text-white hover:ring-indigo-600"
            dataTestId="product-analytics-person-watch"
          >
            <Icon icon={IconProp.Play} className="h-3.5 w-3.5" />
            <span>{translator.translateText("Watch")}</span>
          </AppLink>
        ) : (
          <span className="whitespace-normal text-xs text-gray-500">
            {translator.translateText("Recording no longer kept")}
          </span>
        );
      },
    },
  ];
}

const RumApplicationProductAnalyticsPerson: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const location: ReturnType<typeof useLocation> = useLocation();
  const path: ProductAnalyticsPersonPath | null =
    parseProductAnalyticsPersonPath(location.pathname);
  /* Rows a page: the list's own size until the reader picks another. */
  const [pageSize, setPageSize] = useState<number>(
    PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE,
  );
  const pageKey: string = `${location.pathname}|${pageSize}`;
  const [page, setPage] = useState<{ number: number; key: string }>({
    number: 1,
    key: pageKey,
  });
  const pageNumber: number = page.key === pageKey ? page.number : 1;
  const rumApplicationId: string = path?.rumApplicationId || "";
  const personKey: string = path?.personKey || "";

  const detail: ProductAnalyticsRead<ProductAnalyticsPersonDetailDto | null> =
    useProductAnalyticsRead<ProductAnalyticsPersonDetailDto | null>(
      `${rumApplicationId}|${personKey}|${pageSize}|${pageNumber}`,
      async (): Promise<ProductAnalyticsPersonDetailDto | null> => {
        if (!rumApplicationId || !personKey) {
          return null;
        }

        return await fetchProductAnalyticsPerson({
          rumApplicationId: new ObjectID(rumApplicationId),
          personKey: personKey,
          limit: pageSize,
          offset: (pageNumber - 1) * pageSize,
        });
      },
    );

  const usersRoute: Route = buildProductAnalyticsBackRoute({
    rumApplicationId: rumApplicationId,
    search: location.search,
  });

  const rows: Array<SessionRow> = useMemo((): Array<SessionRow> => {
    return (detail.data?.sessions || []).map(
      (session: ProductAnalyticsPersonSessionDto): SessionRow => {
        return {
          ...session,
          watchRoute: session.isReplayKept
            ? RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW
                ] as Route,
                { modelId: rumApplicationId, subModelId: session.sessionId },
              )
            : null,
        };
      },
    );
  }, [detail.data, rumApplicationId]);

  const columns: Columns<SessionRow> = useMemo((): Columns<SessionRow> => {
    return getSessionColumns(translator);
  }, [translator]);

  const backLink: ReactElement = (
    <AppLink
      to={usersRoute}
      className="text-sm font-medium text-indigo-700 hover:underline"
      dataTestId="product-analytics-person-back"
    >
      <span>{translator.translateText("Back to users")}</span>
    </AppLink>
  );

  if (!path || !path.personKey) {
    return (
      <EmptyState
        id="product-analytics-person-unknown"
        icon={IconProp.User}
        title="This link names nobody"
        paddingClassName="py-16"
        description={
          <span>
            {translator.translateText(
              "The address is not a person's. Open a person from the Users page.",
            )}
          </span>
        }
        footer={backLink}
      />
    );
  }

  if (detail.error) {
    return (
      <ErrorMessage message={detail.error} onRefreshClick={detail.reload} />
    );
  }

  if (!detail.data) {
    return <ComponentLoader />;
  }

  const person: ProductAnalyticsPersonDto | null = detail.data.person;

  if (!person) {
    return (
      <EmptyState
        id="product-analytics-person-not-found"
        icon={IconProp.User}
        title="Nobody by this ID in the last 13 months"
        paddingClassName="py-16"
        description={
          <span>
            {translator.translateText(
              "Their sessions may be older than the 13 months these numbers are kept, or may have been erased.",
            )}
          </span>
        }
        footer={backLink}
      />
    );
  }

  return (
    <Fragment>
      <ProductAnalyticsPersonCard
        person={person}
        includesLabels={detail.data.includesLabels}
        backLink={backLink}
      />
      <div className="mt-5">
        <Card
          title="Sessions"
          description="Every session of theirs the last 13 months hold, newest first."
        >
          <Table<SessionRow>
            id="product-analytics-person-sessions"
            data={rows}
            columns={columns}
            isLoading={detail.isLoading}
            error=""
            singularLabel="Session"
            pluralLabel="Sessions"
            currentPageNumber={pageNumber}
            totalItemsCount={pageSize * (pageNumber - 1) + rows.length}
            itemsOnPage={pageSize}
            hasMore={detail.data.hasMore}
            paginationDataTestId="product-analytics-person-pagination"
            onNavigateToPage={(next: number, itemsOnPage: number): void => {
              if (itemsOnPage !== pageSize) {
                /* A new size starts again on its first page. */
                setPageSize(itemsOnPage);

                return;
              }

              setPage({ number: next, key: pageKey });
            }}
            sortBy={null}
            sortOrder={SortOrder.Descending}
            onSortChanged={(): void => {
              /* Newest first: the route's only order. */
            }}
            noItemsMessage="No sessions on this page."
          />
        </Card>
      </div>
    </Fragment>
  );
};

export default RumApplicationProductAnalyticsPerson;
