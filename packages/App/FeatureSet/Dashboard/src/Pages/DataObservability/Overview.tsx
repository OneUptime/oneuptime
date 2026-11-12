import { DataObservabilityQuality } from "Common/Types/DataObservability/DataAlertFeedback";
import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import ConnectDatabaseModal from "../../Components/DataObservability/ConnectDatabaseModal";
import DataSourceSuggestionsCard from "../../Components/DataObservability/DataSourceSuggestionsCard";
import WatchedTablesCost from "../../Components/DataObservability/WatchedTablesCost";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import { formatSize } from "../../Components/DataObservability/DataObservabilityFormat";
import OverviewNeedsAttention from "../../Components/DataObservability/OverviewNeedsAttention";
import OverviewSetupSteps from "../../Components/DataObservability/OverviewSetupSteps";
import StoreAlertStatus from "../../Components/DataObservability/StoreAlertStatus";
import { isStoreWaitingForFirstRead } from "../../Components/DataObservability/StoreStatusPill";
import {
  getStoreAlertsRoute,
  isSetupKnown,
  normalizeDataObservabilityOverview,
} from "../../Components/DataObservability/OverviewAttention";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  DataObservabilityOverview,
  DataObservabilityOverviewChange,
  DataObservabilitySourceSuggestion,
  DataObservabilityStoreSummary,
  SCHEMA_CHANGE_WINDOW_IN_DAYS,
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
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ProductShowcase, {
  getProductStartButton,
} from "../../Components/ProductOnboarding/ProductShowcase";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";

/*
 * THE STATE OF THE PROJECT'S DATA, FIRST.
 *
 * What a person opening Data Observability needs, in the order they need
 * it: until everything is set up, the steps that make it useful (alerts
 * on, owners named, a check, the pipelines' runs); how many tables are
 * watched and how many need someone; then what needs someone now - what is
 * broken, late or drifting, worst first, who owns it, and whether anyone
 * was told (OverviewNeedsAttention); what changed in the schemas; and each
 * database, how its last read went and whether its alerts are on. How well
 * Data Observability itself is doing comes last. A project with no
 * database yet sees how it works, and connects one in one click.
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
  const [hasSetup, setHasSetup] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [readCount, setReadCount] = useState<number>(0);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [suggestion, setSuggestion] = useState<
    DataObservabilitySourceSuggestion | undefined
  >(undefined);
  const hasLoaded: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(!hasLoaded.current);

      try {
        const raw: DataObservabilityOverview =
          await DataObservabilityApi.getOverview();
        const result: DataObservabilityOverview =
          normalizeDataObservabilityOverview(raw);
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
        setHasSetup(isSetupKnown(raw));
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

  // A database just connected opens on its alerts: its tables tell nobody until they are on.
  const connectModal: ReactElement = isConnecting ? (
    <ConnectDatabaseModal
      suggestion={suggestion}
      onClose={() => {
        setIsConnecting(false);
      }}
      onConnected={(dataStoreId: ObjectID) => {
        setIsConnecting(false);
        Navigation.navigate(getStoreAlertsRoute(dataStoreId.toString()));
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
        <ProductShowcase
          product={ProductKey.DataObservability}
          startButton={getProductStartButton({
            modelType: DatabaseServer,
            button: {
              title: "Connect a Database",
              onClick: () => {
                setSuggestion(undefined);
                setIsConnecting(true);
              },
            },
          })}
        />
        <DataSourceSuggestionsCard
          onConnect={(chosen: DataObservabilitySourceSuggestion) => {
            setSuggestion(chosen);
            setIsConnecting(true);
          }}
        />
        {connectModal}
      </>
    );
  }

  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  return (
    <div className="space-y-5">
      {projectId && hasSetup ? (
        <OverviewSetupSteps projectId={projectId} setup={overview.setup} />
      ) : (
        <></>
      )}

      {/*
       * Laid out by the bar's own width: beside the side menu, four tiles
       * share a row only once each has room for its label on one line.
       */}
      <EventStatBar
        columns={4}
        ariaLabel="Data health"
        isLaidOutByOwnWidth={true}
      >
        <EventStatTile
          variant="segment"
          label="Tables Watched"
          value={translator.formatNumber(overview.assetCount)}
          icon={IconProp.TableCells}
          description={translator.translatePlural(
            {
              one: "In {{count}} connected database.",
              other: "In {{count}} connected databases.",
            },
            overview.storeCount,
          )}
        />
        <EventStatTile
          variant="segment"
          label="Needs Attention"
          value={translator.formatNumber(overview.attentionCount)}
          icon={IconProp.Alert}
          description={translator.translateText(
            "Broken, late or drifting now.",
          )}
        />
        <EventStatTile
          variant="segment"
          label="Late Tables"
          value={translator.formatNumber(overview.lateAssetCount)}
          icon={IconProp.Clock}
          description={translator.translateText(
            "Tables that have gone well past their usual interval without a change.",
          )}
        />
        <EventStatTile
          variant="segment"
          label="Failing Checks"
          value={translator.formatNumber(overview.failingCheckCount)}
          icon={IconProp.CheckCircle}
          description={translator.translateText("Checks whose alert is open.")}
        />
      </EventStatBar>

      <OverviewNeedsAttention
        items={overview.attention}
        totalCount={overview.attentionCount}
        stores={overview.stores}
      />

      {/*
       * Half the page each, so headers are stacked, as Data Security's
       * Overview has them: the button on the title's line, the description
       * under both, across the card.
       */}
      <CardGrid columns={2}>
        <Card
          title="Recent Schema Changes"
          headerLayout="stacked"
          description={translator.translatePlural(
            {
              one: "{{count}} column added, removed, renamed or retyped in the last {{days}} days.",
              other:
                "{{count}} columns added, removed, renamed or retyped in the last {{days}} days.",
            },
            overview.schemaChangeCount,
            {
              days: translator.formatNumber(SCHEMA_CHANGE_WINDOW_IN_DAYS),
            },
          )}
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
            <p className="text-sm text-gray-500">
              {translator.translateText("No schema changes yet.")}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
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

        <Card
          title="Databases"
          headerLayout="stacked"
          description="Each connected database, how its last read went, and whether its alerts are on."
          buttons={[
            {
              title: "Connect a Database",
              phoneTitle: "Connect",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Add,
              onClick: () => {
                setSuggestion(undefined);
                setIsConnecting(true);
              },
            },
          ]}
        >
          {/*
           * A database's name and facts, and how its last read went: side
           * by side in a card wide enough for both, one under the other in
           * a narrow one (a phone, or beside the side menu) - keyed to the
           * card's width, not the window's.
           */}
          <ul className="divide-y divide-gray-100 [container-type:inline-size]">
            {overview.stores.map(
              (store: DataObservabilityStoreSummary): ReactElement => {
                return (
                  <li
                    key={store.dataStoreId}
                    data-testid="data-observability-store-row"
                    className="flex flex-col gap-1 py-2 [@container(min-width:24rem)]:flex-row [@container(min-width:24rem)]:items-center [@container(min-width:24rem)]:justify-between [@container(min-width:24rem)]:gap-3"
                  >
                    <div className="min-w-0 [@container(min-width:24rem)]:flex-1">
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
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                        <span>{store.kind}</span>
                        <StoreAlertStatus store={store} />
                      </span>
                    </div>
                    <span
                      className={`text-sm [@container(min-width:24rem)]:flex-none ${
                        store.status === "Failed"
                          ? "font-medium text-red-600"
                          : "text-gray-600"
                      }`}
                    >
                      {/*
                       * A database just connected has no table to count
                       * until its first read: it says so, not "0 tables".
                       */}
                      {!store.isTableHealthEnabled
                        ? translator.translateText("Not watched")
                        : store.status === "Failed"
                          ? translator.translateText("Collection failed")
                          : isStoreWaitingForFirstRead(store)
                            ? translator.translateText(
                                "Waiting for first collection",
                              )
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
      </CardGrid>

      {overview.unusedAssetCount > 0 ? (
        <Card
          title="Unused Tables"
          description="Tables nobody has read for 90 days: candidates to archive or drop."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
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
              to={route(PageMap.DATA_OBSERVABILITY_TABLES_UNUSED)}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              <span>{translator.translateText("See them")}</span>
            </AppLink>
          </div>
        </Card>
      ) : (
        <></>
      )}

      <WatchedTablesCost />

      {quality && quality.issueCount > 0 ? (
        <EventStatBar
          columns={4}
          ariaLabel="How well it is working"
          isLaidOutByOwnWidth={true}
        >
          <EventStatTile
            variant="segment"
            label="Useful Issues a Week"
            value={translator.formatNumber(quality.usefulIssuesPerWeek)}
            icon={IconProp.CheckCircle}
            description={translator.translateTemplate(
              "Issues someone acted on or called useful, less those called noise, over the last {{days}} days.",
              { days: translator.formatNumber(quality.windowInDays) },
            )}
          />
          <EventStatTile
            variant="segment"
            label="Precision"
            value={formatPercent(quality.precisionPercent)}
            icon={IconProp.Filter}
            description={translator.translateText(
              "The share of issues not marked expected or not an issue.",
            )}
          />
          <EventStatTile
            variant="segment"
            label="Caught First"
            value={formatPercent(quality.caughtFirstPercent)}
            icon={IconProp.Bolt}
            description={translator.translateText(
              "The share of problems people reported that OneUptime had already raised.",
            )}
          />
          <EventStatTile
            variant="segment"
            label="Cause Found"
            value={formatPercent(quality.causeFoundPercent)}
            icon={IconProp.Search}
            description={translator.translateText(
              "The share of answered issues whose likely cause was the real one.",
            )}
          />
        </EventStatBar>
      ) : (
        <></>
      )}

      {connectModal}
    </div>
  );
};

export default DataObservabilityOverviewPage;
