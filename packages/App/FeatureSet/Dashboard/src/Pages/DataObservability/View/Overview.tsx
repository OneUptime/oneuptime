import PageComponentProps from "../../PageComponentProps";
import DataObservabilityApi from "../../../Components/DataObservability/DataObservabilityApi";
import StoreStatusPill from "../../../Components/DataObservability/StoreStatusPill";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { StoreViewOutletContext, useStoreView } from "./StoreViewContext";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { DataObservabilityCollector } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * One database at a glance: how many of its tables are watched and late,
 * who reads its catalog and how the last read went - with Collect Now - and
 * the way to its recommended monitors.
 */
const StoreOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId, store, refresh }: StoreViewOutletContext =
    useStoreView();
  const [isCollecting, setIsCollecting] = useState<boolean>(false);
  const [isConfirmingStop, setIsConfirmingStop] = useState<boolean>(false);
  const [isChangingWatch, setIsChangingWatch] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");

  if (!store) {
    return <></>;
  }

  const collectNow: () => Promise<void> = async (): Promise<void> => {
    setActionError("");
    setIsCollecting(true);

    try {
      await DataObservabilityApi.collectNow(dataStoreId);
      refresh();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsCollecting(false);
  };

  const setWatched: (isWatched: boolean) => Promise<void> = async (
    isWatched: boolean,
  ): Promise<void> => {
    setActionError("");
    setIsChangingWatch(true);

    try {
      await DataObservabilityApi.setStoreWatched(dataStoreId, isWatched);
      refresh();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsChangingWatch(false);
    setIsConfirmingStop(false);
  };

  return (
    <div className="space-y-5">
      <EventStatBar columns={3} ariaLabel="Database health">
        <EventStatTile
          label="Tables Watched"
          value={translator.formatNumber(store.assetCount)}
          icon={IconProp.TableCells}
          description="Tables and views in this database."
        />
        <EventStatTile
          label="Late Tables"
          value={translator.formatNumber(store.lateAssetCount)}
          icon={IconProp.Clock}
          description="Tables that have gone well past their usual interval without a change."
        />
        <EventStatTile
          label="Last Collected"
          value={
            store.collectedAt
              ? OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(store.collectedAt),
                )
              : "-"
          }
          icon={IconProp.Refresh}
          description="The catalog is read every few minutes."
        />
      </EventStatBar>

      <Card
        title="Collection"
        description="Who reads this database's catalog, and how the last read went."
        buttons={[
          {
            title: "Collect Now",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            isLoading: isCollecting,
            disabled: !store.isTableHealthEnabled,
            onClick: () => {
              void collectNow();
            },
          },
          store.isTableHealthEnabled
            ? {
                title: "Stop Watching",
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.Close,
                onClick: () => {
                  setIsConfirmingStop(true);
                },
              }
            : {
                title: "Watch Again",
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.Play,
                isLoading: isChangingWatch,
                onClick: () => {
                  void setWatched(true);
                },
              },
        ]}
      >
        <div className="space-y-2 px-6 pb-6 text-sm text-gray-700">
          <div className="flex flex-wrap items-center gap-2">
            <StoreStatusPill store={store} />
            <span className="text-gray-500">{store.kind}</span>
          </div>
          <p>
            {store.collector === DataObservabilityCollector.Probe
              ? translator.translateTemplate("Collected by probe {{probe}}", {
                  probe: store.probeName || "",
                })
              : translator.translateText("Collected by OneUptime")}
          </p>
          {store.message ? (
            <p
              className={`whitespace-pre-line ${
                store.status === "Failed" ? "text-red-600" : "text-amber-700"
              }`}
            >
              {store.message}
            </p>
          ) : (
            <></>
          )}
          {actionError ? <p className="text-red-600">{actionError}</p> : <></>}
        </div>
      </Card>

      <Card
        title="Alerts"
        description="Monitors recommended for this database: late tables, sharp drops in rows, schema changes, and a collection that stopped."
        buttons={[
          {
            title: "View Recommendations",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Alert,
            onClick: () => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[
                    PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS
                  ] as Route,
                  { modelId: dataStoreId },
                ),
              );
            },
          },
        ]}
      >
        <p className="px-6 pb-6 text-sm text-gray-600">
          {translator.translateText(
            "Each is one monitor for the whole database that alerts once per table, so tables created later are watched too.",
          )}
        </p>
      </Card>

      {isConfirmingStop ? (
        <ConfirmModal
          title="Stop watching this database?"
          description="Its tables stop being read and stop counting toward the bill. Their history stays, and so do its monitors, which you can delete."
          submitButtonText="Stop Watching"
          isLoading={isChangingWatch}
          onSubmit={() => {
            void setWatched(false);
          }}
          onClose={() => {
            setIsConfirmingStop(false);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default StoreOverviewPage;
