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
import Table from "Common/UI/Components/Table/Table";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  getInlineSeparator,
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
  describeProductAnalyticsCountry,
  describeProductAnalyticsDevice,
  formatProductAnalyticsCount,
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

function getSessionColumns(translator: Translator): Columns<SessionRow> {
  return [
    {
      title: "Started",
      key: "startedAt",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        return (
          <span>
            {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              new Date(row.startedAt),
            )}
          </span>
        );
      },
    },
    {
      title: "Length",
      key: "durationMs",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        return (
          <span className="tabular-nums">
            {row.isFinished
              ? formatProductAnalyticsDuration(
                  row.durationMs,
                  translator.language,
                )
              : translator.translateText("Still recording")}
          </span>
        );
      },
    },
    {
      title: "Pages",
      key: "pageCount",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        return (
          <span className="tabular-nums">
            {formatProductAnalyticsCount(row.pageCount, translator)}
          </span>
        );
      },
    },
    {
      title: "Entry page",
      key: "entryPage",
      type: FieldType.Element,
      disableSort: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-xs",
      getElement: (row: SessionRow): ReactElement => {
        return (
          <span className="break-all font-mono text-xs" dir="ltr">
            {row.entryPage || "-"}
          </span>
        );
      },
    },
    {
      title: "Device",
      key: "deviceType",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        const parts: Array<string> = [
          describeProductAnalyticsDevice(row.deviceType, translator),
          row.browserName,
          row.osName,
        ].filter((part: string): boolean => {
          return part.trim().length > 0;
        });

        return (
          <span>{parts.join(getInlineSeparator(translator.language))}</span>
        );
      },
    },
    {
      title: "Country",
      key: "countryCode",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
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
    {
      title: "Errors",
      key: "errorCount",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        return (
          <span
            className={`tabular-nums ${
              row.errorCount > 0 ? "text-red-700" : "text-gray-500"
            }`}
          >
            {formatProductAnalyticsCount(row.errorCount, translator)}
          </span>
        );
      },
    },
    {
      title: "Recording",
      key: "sessionId",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: SessionRow): ReactElement => {
        return row.watchRoute ? (
          <AppLink
            to={row.watchRoute}
            className="text-sm font-medium text-indigo-700 hover:underline"
            dataTestId="product-analytics-person-watch"
          >
            <span>{translator.translateText("Watch")}</span>
          </AppLink>
        ) : (
          <span className="text-xs text-gray-500">
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
  const [page, setPage] = useState<{ number: number; key: string }>({
    number: 1,
    key: location.pathname,
  });
  const pageNumber: number = page.key === location.pathname ? page.number : 1;
  const rumApplicationId: string = path?.rumApplicationId || "";
  const personKey: string = path?.personKey || "";

  const detail: ProductAnalyticsRead<ProductAnalyticsPersonDetailDto | null> =
    useProductAnalyticsRead<ProductAnalyticsPersonDetailDto | null>(
      `${rumApplicationId}|${personKey}|${pageNumber}`,
      async (): Promise<ProductAnalyticsPersonDetailDto | null> => {
        if (!rumApplicationId || !personKey) {
          return null;
        }

        return await fetchProductAnalyticsPerson({
          rumApplicationId: new ObjectID(rumApplicationId),
          personKey: personKey,
          limit: PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE,
          offset:
            (pageNumber - 1) * PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE,
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
            totalItemsCount={
              PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE * (pageNumber - 1) +
              rows.length
            }
            itemsOnPage={PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE}
            itemsOnPageOptions={[PRODUCT_ANALYTICS_PERSON_SESSIONS_PAGE_SIZE]}
            hasMore={detail.data.hasMore}
            paginationDataTestId="product-analytics-person-pagination"
            onNavigateToPage={(next: number): void => {
              setPage({ number: next, key: location.pathname });
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
