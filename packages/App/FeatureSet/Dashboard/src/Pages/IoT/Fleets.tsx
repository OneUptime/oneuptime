import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import IoTFleetOwnerTeam from "Common/Models/DatabaseModels/IoTFleetOwnerTeam";
import IoTFleetOwnerUser from "Common/Models/DatabaseModels/IoTFleetOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEnumFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import {
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import IOT_FLEET_ONBOARDING from "../../Components/IoT/IoTFleetOnboarding";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import IOT_FLEET_SHOWCASE from "../../Components/IoT/IoTFleetShowcase";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import { IOT_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/IoTMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const IoTFleets: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<IoTFleet>({
    modelType: IoTFleet,
  });
  const [isAddFleetOpen, setIsAddFleetOpen] = useState<boolean>(false);
  // Fleets connected from the Add dialog show in the list at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<IoTFleet>({ modelType: IoTFleet });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<IoTFleet>({
      ownerUserModelType: IoTFleetOwnerUser,
      ownerTeamModelType: IoTFleetOwnerTeam,
      resourceIdField: "iotFleetId",
    });

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<IoTFleet>({
      modelType: IoTFleet,
    });

  const iotExtraFacets: Array<ResourceFacet> = [
    {
      key: "otelCollectorStatus",
      label: "Status",
      icon: IconProp.Wifi,
      isMultiSelect: false,
      options: [
        { value: "connected", label: "Connected" },
        { value: "disconnected", label: "Disconnected" },
      ],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, false);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<IoTFleet>({
    persistKey: "iot-fleets-table",
    ownerUserModelType: IoTFleetOwnerUser,
    ownerTeamModelType: IoTFleetOwnerTeam,
    resourceIdField: "iotFleetId",
    showLabelsFacet: true,
    extraFacets: iotExtraFacets,
  });

  if (firstRecordWatch.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (firstRecordWatch.error) {
    return (
      <ErrorMessage
        message={firstRecordWatch.error}
        onRefreshClick={firstRecordWatch.retry}
      />
    );
  }

  /*
   * A fleet is added by sending its first reading (Add IoT Fleet): the
   * guide asks for the fleet's name, writes it into the snippets, and the
   * fleet registers itself under it when the reading arrives. There is no
   * form: a fleet typed in by hand would only wait for readings that
   * nothing sends.
   */
  return (
    <Fragment>
      <ModelTable<IoTFleet>
        modelType={IoTFleet}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}
        id="iot-fleets-table"
        userPreferencesKey="iot-fleets-table"
        topContent={getFirstRunTopContent({
          topContent: filterBar,
          count: firstRecordWatch.count,
        })}
        emptyState={getFirstRunEmptyState({
          emptyState: facetEmptyState,
          count: firstRecordWatch.count,
        })}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<IoTFleet>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={false}
        showRefreshButton={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="IoT Fleets"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "IoT Fleets",
          description:
            "IoT device fleets being monitored in this project. Connect your devices to OneUptime to register a fleet.",
          buttons: [
            {
              title: IOT_FLEET_ONBOARDING.addTitle,
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setIsAddFleetOpen(true);
              },
            },
          ],
        }}
        showViewIdButton={true}
        formFields={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: IoTFleet): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.IOT_FLEET_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
                </AppLink>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: IoTFleet): ReactElement => {
              const isConnected: boolean =
                item.otelCollectorStatus === "connected";
              return (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      isConnected ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      isConnected ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {isConnected
                      ? translator.translateText("Connected")
                      : translator.translateText("Disconnected")}
                  </span>
                </div>
              );
            },
          },
          {
            field: {
              deviceCount: true,
              onlineDeviceCount: true,
            },
            title: "Devices",
            headerTooltip: IOT_METRIC_DESCRIPTIONS.fleetDevices,
            type: FieldType.Element,
            getElement: (item: IoTFleet): ReactElement => {
              /*
               * Snapshot columns written by the ingest path from the
               * same buffer that populates the IoTDevice inventory — no
               * ClickHouse round-trip here (WI-3).
               */
              const total: number = item.deviceCount || 0;
              if (total <= 0) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              const online: number = item.onlineDeviceCount || 0;
              const allOnline: boolean = online >= total;
              return (
                <span
                  className={`text-sm font-medium ${
                    allOnline ? "text-gray-900" : "text-red-700"
                  }`}
                >
                  {translator.translateTemplate("{{online}}/{{total}} online", {
                    online: online,
                    total: total,
                  })}
                </span>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: IoTFleet): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IoTFleet): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: IoTFleet): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.IOT_FLEET_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {firstRecordWatch.count === 0 && (
        <ResourceShowcaseCard
          showcase={IOT_FLEET_SHOWCASE}
          addButton={{
            title: IOT_FLEET_ONBOARDING.addTitle,
            onClick: () => {
              setIsAddFleetOpen(true);
            },
          }}
        />
      )}
      {isAddFleetOpen && (
        <AddResourceModal
          onboarding={IOT_FLEET_ONBOARDING}
          onClose={() => {
            setIsAddFleetOpen(false);
          }}
          onConnected={() => {
            // The showcase gives way, and the table reads the new fleet.
            firstRecordWatch.onRecordCreated();
            setConnectedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default IoTFleets;
