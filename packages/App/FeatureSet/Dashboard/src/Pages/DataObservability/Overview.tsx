import { DataObservabilityQuality } from "Common/Types/DataObservability/DataAlertFeedback";
import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import ConnectDatabaseModal from "../../Components/DataObservability/ConnectDatabaseModal";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import {
  formatOverdue,
  formatSize,
} from "../../Components/DataObservability/DataObservabilityFormat";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  DataObservabilityOverview,
  DataObservabilityOverviewAsset,
  DataObservabilityOverviewChange,
  DataObservabilityStoreSummary,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * What a person opening Data Observability needs first: how many tables are
 * watched, which are late and by how much, what changed in the schemas
 * lately, and whether every database is being collected. A project with no
 * database yet sees how to connect one, in one click.
 */
// A share, or a dash until there is anything to measure.
function formatPercent(value: number | null): string {
  return value === null ? "-" : `${value}%`;
}

const DataObservabilityOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [quality, setQuality] = useState<DataObservabilityQuality | null>(null);
  const [overview, setOverview] = useState<DataObservabilityOverview | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [readCount, setReadCount] = useState<number>(0);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const hasLoaded: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(!hasLoaded.current);

      try {
        const result: DataObservabilityOverview =
          await DataObservabilityApi.getOverview();
        // Extra to the Overview: without it, the rest still shows.
        const measures: DataObservabilityQuality | null =
          await DataObservabilityApi.getQuality().catch(() => {
            return null;
          });

        if (!isCurrent) {
          return;
        }

        hasLoaded.current = true;
        setError("");
        setOverview(result);
        setQuality(measures);
      } catch (err) {
        if (isCurrent && !hasLoaded.current) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  const readAgain: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  const route: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route);
  };

  const tableRoute: (id: string) => Route = (id: string): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
      { modelId: new ObjectID(id) },
    );
  };

  const connectModal: ReactElement = isConnecting ? (
    <ConnectDatabaseModal
      onClose={() => {
        setIsConnecting(false);
      }}
      onConnected={() => {
        setIsConnecting(false);
        Navigation.navigate(route(PageMap.DATA_OBSERVABILITY_STORES));
      }}
    />
  ) : (
    <></>
  );

  if (error) {
    return <ErrorMessage message={error} onRefreshClick={readAgain} />;
  }

  if (isLoading || !overview) {
    return <PageLoader isVisible={true} />;
  }

  if (overview.storeCount === 0) {
    return (
      <>
        <Card
          title="Watch your data, not just your services"
          description="Connect a database and every table in it is watched from the first minute: its rows, size, last change and columns. Only the catalog is read, never a row, and no threshold has to be set."
          buttons={[
            {
              title: "Connect a Database",
              buttonStyle: ButtonStyleType.PRIMARY,
              icon: IconProp.Add,
              onClick: () => {
                setIsConnecting(true);
              },
            },
            {
              title: "Read the Docs",
              buttonStyle: ButtonStyleType.OUTLINE,
              icon: IconProp.Book,
              onClick: () => {
                Navigation.navigate(
                  route(PageMap.DATA_OBSERVABILITY_DOCUMENTATION),
                );
              },
            },
          ]}
        >
          <ul className="list-disc space-y-1 px-6 pb-6 text-sm text-gray-600">
            <li>
              {translator.translateText(
                "PostgreSQL, MySQL, MariaDB and SQL Server, connected by OneUptime or by a probe inside your network.",
              )}
            </li>
            <li>
              {translator.translateText(
                "Databases already connected for Data Security are watched too.",
              )}
            </li>
            <li>
              {translator.translateText(
                "Every number is a metric: chart it, put it on a dashboard, or alert on it with a learned baseline.",
              )}
            </li>
          </ul>
        </Card>
        {connectModal}
      </>
    );
  }

  return (
    <div className="space-y-5">
      {quality && quality.issueCount > 0 ? (
        <EventStatBar columns={4} ariaLabel="How well it is working">
          <EventStatTile
            label="Useful Issues a Week"
            value={translator.formatNumber(quality.usefulIssuesPerWeek)}
            icon={IconProp.CheckCircle}
            description={`Issues someone acted on or called useful, less those called noise, over the last ${quality.windowInDays} days.`}
          />
          <EventStatTile
            label="Precision"
            value={formatPercent(quality.precisionPercent)}
            icon={IconProp.Filter}
            description="The share of issues not marked expected or not an issue."
          />
          <EventStatTile
            label="Caught First"
            value={formatPercent(quality.caughtFirstPercent)}
            icon={IconProp.Bolt}
            description="The share of problems people reported that OneUptime had already raised."
          />
          <EventStatTile
            label="Cause Found"
            value={formatPercent(quality.causeFoundPercent)}
            icon={IconProp.Search}
            description="The share of answered issues whose likely cause was the real one."
          />
        </EventStatBar>
      ) : (
        <></>
      )}
      <EventStatBar columns={4} ariaLabel="Data health">
        <EventStatTile
          label="Tables Watched"
          value={translator.formatNumber(overview.assetCount)}
          icon={IconProp.TableCells}
          description="Tables and views in your connected databases."
        />
        <EventStatTile
          label="Late Tables"
          value={translator.formatNumber(overview.lateAssetCount)}
          icon={IconProp.Clock}
          description="Tables that have gone well past their usual interval without a change."
        />
        <EventStatTile
          label="Schema Changes"
          value={translator.formatNumber(overview.schemaChangeCount)}
          icon={IconProp.List}
          description="Columns added, removed, renamed or retyped in the last 7 days."
        />
        <EventStatTile
          label="Databases"
          value={translator.formatNumber(overview.storeCount)}
          icon={IconProp.Database}
          description={
            overview.failingStoreCount > 0
              ? translator.translatePlural(
                  {
                    one: "{{count}} could not be collected.",
                    other: "{{count}} could not be collected.",
                  },
                  overview.failingStoreCount,
                )
              : translator.translateText("All collected.")
          }
        />
      </EventStatBar>

      {overview.unusedAssetCount > 0 ? (
        <Card
          title="Unused Tables"
          description="Tables nobody has read for 90 days: candidates to archive or drop."
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-6">
            <p className="text-sm text-gray-700">
              {translator.translatePlural(
                {
                  one: "{{count}} table nobody has read for 90 days holds {{size}}.",
                  other:
                    "{{count}} tables nobody has read for 90 days hold {{size}}.",
                },
                overview.unusedAssetCount,
                { size: formatSize(overview.unusedSizeInBytes) },
              )}
            </p>
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.DATA_OBSERVABILITY_TABLES_UNUSED] as Route,
              )}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              <span>{translator.translateText("See them")}</span>
            </AppLink>
          </div>
        </Card>
      ) : (
        <></>
      )}

      <CardGrid columns={2}>
        <Card
          title="Late Tables"
          description="The tables most overdue for a change, worst first."
        >
          {overview.lateAssets.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-gray-500">
              {translator.translateText(
                "Every table is as fresh as it usually is.",
              )}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 px-6 pb-4">
              {overview.lateAssets.map(
                (asset: DataObservabilityOverviewAsset): ReactElement => {
                  return (
                    <li
                      key={asset.dataAssetId}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <AppLink
                          to={tableRoute(asset.dataAssetId)}
                          className="block truncate font-medium text-gray-900 hover:underline"
                        >
                          <span>{asset.assetKey}</span>
                        </AppLink>
                        <span className="block truncate text-xs text-gray-500">
                          {asset.dataStoreName}
                        </span>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-red-600">
                        {formatOverdue(translator, asset.overdueBySeconds)}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </Card>

        <Card
          title="Recent Schema Changes"
          description="The latest columns added, removed, renamed or retyped."
          buttons={[
            {
              title: "All Changes",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: () => {
                Navigation.navigate(
                  route(PageMap.DATA_OBSERVABILITY_SCHEMA_CHANGES),
                );
              },
            },
          ]}
        >
          {overview.recentChanges.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-gray-500">
              {translator.translateText("No schema changes yet.")}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 px-6 pb-4">
              {overview.recentChanges.map(
                (change: DataObservabilityOverviewChange): ReactElement => {
                  return (
                    <li
                      key={`${change.dataAssetId}-${change.postedAt}-${change.feedInfoInMarkdown}`}
                      className="py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <AppLink
                          to={tableRoute(change.dataAssetId)}
                          className="truncate text-sm font-medium text-gray-900 hover:underline"
                        >
                          <span>{change.assetKey}</span>
                        </AppLink>
                        <span className="shrink-0 text-xs text-gray-500">
                          {change.postedAt
                            ? OneUptimeDate.fromNow(
                                OneUptimeDate.fromString(change.postedAt),
                              )
                            : ""}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        <MarkdownViewer text={change.feedInfoInMarkdown} />
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </Card>
      </CardGrid>

      <Card
        title="Databases"
        description="Each connected database and how its last collection went."
        buttons={[
          {
            title: "Connect a Database",
            phoneTitle: "Connect",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Add,
            onClick: () => {
              setIsConnecting(true);
            },
          },
        ]}
      >
        <ul className="divide-y divide-gray-100 px-6 pb-4">
          {overview.stores.map(
            (store: DataObservabilityStoreSummary): ReactElement => {
              return (
                <li
                  key={store.dataStoreId}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[
                          PageMap.DATA_OBSERVABILITY_STORE_VIEW
                        ] as Route,
                        { modelId: new ObjectID(store.dataStoreId) },
                      )}
                      className="block truncate font-medium text-gray-900 hover:underline"
                    >
                      <span>{store.name}</span>
                    </AppLink>
                    <span className="block truncate text-xs text-gray-500">
                      {store.kind}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 text-sm ${
                      store.status === "Failed"
                        ? "font-medium text-red-600"
                        : "text-gray-600"
                    }`}
                  >
                    {!store.isTableHealthEnabled
                      ? translator.translateText("Not watched")
                      : store.status === "Failed"
                        ? translator.translateText("Collection failed")
                        : translator.translatePlural(
                            {
                              one: "{{count}} table",
                              other: "{{count}} tables",
                            },
                            store.assetCount,
                          )}
                  </span>
                </li>
              );
            },
          )}
        </ul>
      </Card>

      {connectModal}
    </div>
  );
};

export default DataObservabilityOverviewPage;
