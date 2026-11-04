import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import ConnectDatabaseModal from "../../Components/DataObservability/ConnectDatabaseModal";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import DataSourceSuggestionsCard from "../../Components/DataObservability/DataSourceSuggestionsCard";
import StoreStatusPill from "../../Components/DataObservability/StoreStatusPill";
import WatchedTablesCost from "../../Components/DataObservability/WatchedTablesCost";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  DataObservabilityCollector,
  DataObservabilitySourceSuggestion,
  DataObservabilityStoreSummary,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The databases whose tables are watched, with who collects each - OneUptime,
 * or a probe in the customer's network - how the last collection went and
 * why one failed. Connect a Database adds one; Collect Now reads one again
 * without waiting for its next turn; Recommended Alerts opens the monitors
 * recommended for its tables. Below them, the databases the project already
 * knows of that nobody has connected.
 */
const DataObservabilityStoresPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [stores, setStores] = useState<Array<DataObservabilityStoreSummary>>(
    [],
  );
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [readCount, setReadCount] = useState<number>(0);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [suggestion, setSuggestion] = useState<
    DataObservabilitySourceSuggestion | undefined
  >(undefined);
  const [collecting, setCollecting] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getStores()
      .then((result: Array<DataObservabilityStoreSummary>): void => {
        if (isCurrent) {
          setStores(result);
          setError("");
        }
      })
      .catch((err: unknown): void => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally((): void => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  const readAgain: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  const collectNow: (
    store: DataObservabilityStoreSummary,
  ) => Promise<void> = async (
    store: DataObservabilityStoreSummary,
  ): Promise<void> => {
    setActionError("");
    setCollecting((previous: Set<string>): Set<string> => {
      return new Set([...previous, store.dataStoreId]);
    });

    try {
      await DataObservabilityApi.collectNow(new ObjectID(store.dataStoreId));
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setCollecting((previous: Set<string>): Set<string> => {
      const next: Set<string> = new Set(previous);
      next.delete(store.dataStoreId);
      return next;
    });
  };

  if (error) {
    return <ErrorMessage message={error} onRefreshClick={readAgain} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  const storeRoute: (
    store: DataObservabilityStoreSummary,
    page: PageMap,
  ) => Route = (store: DataObservabilityStoreSummary, page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: new ObjectID(store.dataStoreId),
    });
  };

  return (
    <>
      <Card
        title="Databases"
        description="The databases whose tables Data Observability watches. Databases connected for Data Security are watched too."
        buttons={[
          {
            title: "Connect a Database",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Add,
            onClick: () => {
              setSuggestion(undefined);
              setIsConnecting(true);
            },
          },
          {
            title: "Refresh",
            buttonStyle: ButtonStyleType.OUTLINE,
            icon: IconProp.Refresh,
            onClick: readAgain,
          },
        ]}
      >
        <div className="px-6 pb-6">
          {actionError ? (
            <p className="mb-3 text-sm text-red-600">{actionError}</p>
          ) : (
            <></>
          )}
          {stores.length === 0 ? (
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "No database yet. Connect one, and its tables show up within a few minutes.",
              )}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {stores.map(
                (store: DataObservabilityStoreSummary): ReactElement => {
                  return (
                    <li
                      key={store.dataStoreId}
                      className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <AppLink
                            to={storeRoute(
                              store,
                              PageMap.DATA_OBSERVABILITY_STORE_VIEW,
                            )}
                            className="font-medium text-gray-900 hover:underline"
                          >
                            <span>{store.name}</span>
                          </AppLink>
                          <StoreStatusPill store={store} />
                        </div>
                        <div className="text-xs text-gray-500">
                          {store.kind}
                          {" · "}
                          {store.collector === DataObservabilityCollector.Probe
                            ? translator.translateTemplate(
                                "Collected by probe {{probe}}",
                                { probe: store.probeName || "" },
                              )
                            : translator.translateText(
                                "Collected by OneUptime",
                              )}
                          {store.collectedAt ? " · " : ""}
                          {store.collectedAt
                            ? translator.translateTemplate(
                                "Last collected {{time}}",
                                {
                                  time: OneUptimeDate.fromNow(
                                    OneUptimeDate.fromString(store.collectedAt),
                                  ),
                                },
                              )
                            : ""}
                        </div>
                        <div className="text-xs text-gray-600">
                          {translator.translatePlural(
                            {
                              one: "{{count}} table watched",
                              other: "{{count}} tables watched",
                            },
                            store.assetCount,
                          )}
                          {store.lateAssetCount > 0 ? " · " : ""}
                          {store.lateAssetCount > 0 ? (
                            <span className="font-medium text-red-600">
                              {translator.translatePlural(
                                {
                                  one: "{{count}} late",
                                  other: "{{count}} late",
                                },
                                store.lateAssetCount,
                              )}
                            </span>
                          ) : (
                            <></>
                          )}
                        </div>
                        {store.message ? (
                          <p
                            className={`whitespace-pre-line text-xs ${
                              store.status === "Failed"
                                ? "text-red-600"
                                : "text-amber-700"
                            }`}
                          >
                            {store.message}
                          </p>
                        ) : (
                          <></>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          title="Recommended Alerts"
                          buttonStyle={ButtonStyleType.NORMAL}
                          icon={IconProp.Alert}
                          onClick={() => {
                            Navigation.navigate(
                              storeRoute(
                                store,
                                PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
                              ),
                            );
                          }}
                        />
                        <Button
                          title="Collect Now"
                          buttonStyle={ButtonStyleType.NORMAL}
                          icon={IconProp.Refresh}
                          isLoading={collecting.has(store.dataStoreId)}
                          disabled={!store.isTableHealthEnabled}
                          onClick={() => {
                            void collectNow(store);
                          }}
                        />
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>
      </Card>

      <WatchedTablesCost refreshToken={readCount} />

      <DataSourceSuggestionsCard
        refreshToken={readCount}
        onConnect={(chosen: DataObservabilitySourceSuggestion) => {
          setSuggestion(chosen);
          setIsConnecting(true);
        }}
      />

      {isConnecting ? (
        <ConnectDatabaseModal
          suggestion={suggestion}
          onClose={() => {
            setIsConnecting(false);
          }}
          onConnected={() => {
            setIsConnecting(false);
            readAgain();
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DataObservabilityStoresPage;
