import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayOwnerTeam from "Common/Models/DatabaseModels/StorageArrayOwnerTeam";
import StorageArrayOwnerUser from "Common/Models/DatabaseModels/StorageArrayOwnerUser";
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
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import StorageArrayDocumentationCard from "../../Components/StorageArray/DocumentationCard";
import StorageArrayHealthPill from "../../Components/StorageArray/StorageArrayHealthPill";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import StorageSystem, {
  StorageSystemUtil,
} from "Common/Types/StorageArray/StorageSystem";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import StorageArrayResourceUtils from "./Utils/StorageArrayResourceUtils";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Pure raises its own capacity alerts at 80% and 90% used, so the bar
 * turns amber and red at the same levels.
 */
const renderCapacityBar: (
  capacityUsedPercent: number | undefined,
) => ReactElement = (capacityUsedPercent: number | undefined): ReactElement => {
  if (
    capacityUsedPercent === null ||
    capacityUsedPercent === undefined ||
    !Number.isFinite(Number(capacityUsedPercent))
  ) {
    return <span className="text-gray-400">—</span>;
  }

  const pct: number = Number(capacityUsedPercent);
  const clamped: number = Math.min(100, Math.max(0, pct));
  const barColor: string =
    pct >= 90 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 whitespace-nowrap w-12 text-right">
        {pct.toFixed(1)}%
      </span>
    </div>
  );
};

const StorageArrays: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [arrayCount, setArrayCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<StorageArray>({ modelType: StorageArray });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<StorageArray>({
      ownerUserModelType: StorageArrayOwnerUser,
      ownerTeamModelType: StorageArrayOwnerTeam,
      resourceIdField: "storageArrayId",
    });

  const { archiveBulkActions } = useBulkArchiveActions<StorageArray>({
    modelType: StorageArray,
  });

  const storageArrayExtraFacets: Array<ResourceFacet> = [
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
    {
      key: "storageSystem",
      label: "Platform",
      icon: IconProp.StorageArray,
      isMultiSelect: true,
      options: StorageSystemUtil.getAllSystems().map(
        (system: StorageSystem): { value: string; label: string } => {
          return {
            value: system,
            label: StorageSystemUtil.getDisplayName(system),
          };
        },
      ),
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, true);
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
  } = useResourceOwners<StorageArray>({
    persistKey: "storage-arrays-table",
    ownerUserModelType: StorageArrayOwnerUser,
    ownerTeamModelType: StorageArrayOwnerTeam,
    resourceIdField: "storageArrayId",
    showLabelsFacet: true,
    extraFacets: storageArrayExtraFacets,
  });

  const fetchArrayCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: StorageArray,
        query: {},
      });
      setArrayCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchArrayCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * Live first-data flip: while the project has zero storage arrays the
   * user is staring at the install guide after starting the agent —
   * re-count every 10s so the page flips to the table on first data
   * without a hard refresh. The effect re-runs when arrayCount changes, so
   * the interval is cleared as soon as the count goes nonzero (and on
   * unmount). Poll failures are swallowed — the next tick retries.
   */
  useEffect(() => {
    if (arrayCount !== 0) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      ModelAPI.count({
        modelType: StorageArray,
        query: {},
      })
        .then((count: number) => {
          if (count > 0) {
            setArrayCount(count);
          }
        })
        .catch(() => {
          // Best-effort poll — keep showing the install guide.
        });
    }, 10 * 1000);

    return () => {
      clearInterval(timer);
    };
  }, [arrayCount]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <ModelTable<StorageArray>
        modelType={StorageArray}
        id="storage-arrays-table"
        userPreferencesKey="storage-arrays-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<StorageArray>) => {
          onResourcesFetched(data);
        }}
        onCreateSuccess={(item: StorageArray): Promise<StorageArray> => {
          setArrayCount((currentCount: number | null): number => {
            return (currentCount || 0) + 1;
          });
          return Promise.resolve(item);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        showRefreshButton={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Storage Arrays"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Storage Arrays",
          description:
            "Storage arrays being monitored in this project, such as Pure Storage FlashArray and FlashBlade. Install the OneUptime Storage Array Agent to connect an array.",
        }}
        showViewIdButton={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "pure-prod-01",
            description:
              "This is the join key — it must match the storage.array.name resource attribute reported by the Storage Array Agent (the STORAGE_ARRAY_NAME environment variable).",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Production FlashArray backing block storage in US East",
          },
          getLabelsFormField<StorageArray>(),
        ]}
        selectMoreFields={{
          storageSystem: true,
          volumeCount: true,
          hostCount: true,
          fileSystemCount: true,
          bucketCount: true,
          criticalAlertCount: true,
          warningAlertCount: true,
          osName: true,
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: StorageArray): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route,
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
              storageSystem: true,
            },
            title: "Platform",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: StorageArray): ReactElement => {
              if (!item.storageSystem) {
                return <span className="text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-700">
                  {StorageSystemUtil.getDisplayName(item.storageSystem)}
                </span>
              );
            },
          },
          {
            field: {
              healthStatus: true,
            },
            title: "Health",
            headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.health,
            type: FieldType.Element,
            getElement: (item: StorageArray): ReactElement => {
              /*
               * Read from the StorageArray.healthStatus snapshot column the
               * metrics ingest scan writes, so the list never hits
               * ClickHouse — same pattern as Pages/Ceph/Clusters.tsx.
               */
              return (
                <StorageArrayHealthPill healthStatus={item.healthStatus} />
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: StorageArray): ReactElement => {
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
              capacityUsedPercent: true,
            },
            title: "Capacity",
            headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.arrayCapacity,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: StorageArray): ReactElement => {
              return renderCapacityBar(item.capacityUsedPercent);
            },
          },
          {
            field: {
              dataReductionRatio: true,
            },
            title: "Data Reduction",
            headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.arrayDataReduction,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: StorageArray): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {StorageArrayResourceUtils.formatRatio(
                    item.dataReductionRatio === null ||
                      item.dataReductionRatio === undefined
                      ? null
                      : Number(item.dataReductionRatio),
                  )}
                </span>
              );
            },
          },
          {
            field: {
              volumeCount: true,
            },
            title: "Inventory",
            headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.arrayInventory,
            type: FieldType.Element,
            hideOnMobile: true,
            // Volumes on a FlashArray, file systems on a FlashBlade.
            disableSort: true,
            getElement: (item: StorageArray): ReactElement => {
              if (StorageSystemUtil.isFlashBlade(item.storageSystem)) {
                if (
                  item.fileSystemCount === null ||
                  item.fileSystemCount === undefined
                ) {
                  return <span className="text-gray-400">—</span>;
                }
                return (
                  <span className="text-sm text-gray-700">
                    {translator.translatePlural(
                      {
                        one: "{{count}} file system",
                        other: "{{count}} file systems",
                      },
                      item.fileSystemCount,
                    )}
                  </span>
                );
              }
              if (item.volumeCount === null || item.volumeCount === undefined) {
                return <span className="text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-700">
                  {translator.translatePlural(
                    { one: "{{count}} volume", other: "{{count}} volumes" },
                    item.volumeCount,
                  )}
                  <span className="text-gray-400"> · </span>
                  {translator.translatePlural(
                    { one: "{{count}} host", other: "{{count}} hosts" },
                    item.hostCount || 0,
                  )}
                </span>
              );
            },
          },
          {
            field: {
              openAlertCount: true,
            },
            title: "Open Alerts",
            headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.arrayOpenAlerts,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: StorageArray): ReactElement => {
              if (
                item.openAlertCount === null ||
                item.openAlertCount === undefined
              ) {
                return <span className="text-gray-400">—</span>;
              }
              const critical: number = item.criticalAlertCount || 0;
              if (item.openAlertCount === 0) {
                return <span className="text-sm text-gray-700">0</span>;
              }
              return (
                <span
                  className={`text-sm font-medium ${
                    critical > 0 ? "text-red-700" : "text-amber-700"
                  }`}
                >
                  {translator.translateTemplate(
                    "{{open}} open, {{critical}} critical",
                    { open: item.openAlertCount, critical: critical },
                  )}
                </span>
              );
            },
          },
          {
            field: {
              osVersion: true,
            },
            title: "Version",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: StorageArray): ReactElement => {
              if (!item.osVersion) {
                return <span className="text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-700">
                  {[item.osName, item.osVersion].filter(Boolean).join(" ")}
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
            getElement: (item: StorageArray): ReactElement => {
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
            getElement: (item: StorageArray): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: StorageArray): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {arrayCount === 0 && (
        <StorageArrayDocumentationCard
          title="Getting Started with Storage Array Monitoring"
          description="No storage arrays connected yet. Install the agent using the guide below and your array will appear here automatically."
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default StorageArrays;
