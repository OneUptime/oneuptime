import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephClusterOwnerTeam from "Common/Models/DatabaseModels/CephClusterOwnerTeam";
import CephClusterOwnerUser from "Common/Models/DatabaseModels/CephClusterOwnerUser";
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
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import CephDocumentationCard from "../../Components/Ceph/DocumentationCard";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";

/*
 * Health pill rendered from the CephCluster.healthStatus snapshot column
 * (0 = HEALTH_OK, 1 = HEALTH_WARN, 2 = HEALTH_ERR, null = no batch with
 * ceph_health_status seen yet). The column is written by the metrics
 * ingest scan, so the list page never hits ClickHouse — same pattern as
 * Pages/Kubernetes/Clusters.tsx snapshot columns.
 */
const renderHealthPill: (healthStatus: number | undefined) => ReactElement = (
  healthStatus: number | undefined,
): ReactElement => {
  const pill: { label: string; badge: string; dot: string } = (() => {
    if (healthStatus === null || healthStatus === undefined) {
      return {
        label: "Unknown",
        badge: "bg-gray-50 text-gray-600 ring-gray-200",
        dot: "bg-gray-400",
      };
    }
    if (healthStatus >= 2) {
      return {
        label: "ERR",
        badge: "bg-red-50 text-red-700 ring-red-200",
        dot: "bg-red-500",
      };
    }
    if (healthStatus >= 1) {
      return {
        label: "WARN",
        badge: "bg-amber-50 text-amber-700 ring-amber-200",
        dot: "bg-amber-500",
      };
    }
    return {
      label: "OK",
      badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      dot: "bg-emerald-500",
    };
  })();

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${pill.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
      {pill.label}
    </span>
  );
};

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
    pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";

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

const CephClusters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [clusterCount, setClusterCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<CephCluster>({ modelType: CephCluster });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<CephCluster>({
      ownerUserModelType: CephClusterOwnerUser,
      ownerTeamModelType: CephClusterOwnerTeam,
      resourceIdField: "cephClusterId",
    });

  const cephExtraFacets: Array<ResourceFacet> = [
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
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<CephCluster>({
    persistKey: "ceph-clusters-table",
    ownerUserModelType: CephClusterOwnerUser,
    ownerTeamModelType: CephClusterOwnerTeam,
    resourceIdField: "cephClusterId",
    showLabelsFacet: true,
    extraFacets: cephExtraFacets,
  });

  const fetchClusterCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: CephCluster,
        query: {},
      });
      setClusterCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchClusterCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * Live first-data flip (WI-18): while the project has zero clusters the
   * user is staring at the install guide after pasting the agent command —
   * re-count every 10s so the page flips to the table on first data
   * without a hard refresh. The effect re-runs when clusterCount changes,
   * so the interval is cleared as soon as the count goes nonzero (and on
   * unmount). Poll failures are swallowed — the next tick retries.
   */
  useEffect(() => {
    if (clusterCount !== 0) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      ModelAPI.count({
        modelType: CephCluster,
        query: {},
      })
        .then((count: number) => {
          if (count > 0) {
            setClusterCount(count);
          }
        })
        .catch(() => {
          // Best-effort poll — keep showing the install guide.
        });
    }, 10 * 1000);

    return () => {
      clearInterval(timer);
    };
  }, [clusterCount]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (clusterCount === 0) {
    return (
      <Fragment>
        <CephDocumentationCard
          title="Getting Started with Ceph Monitoring"
          description="No Ceph clusters connected yet. Install the agent using the guide below and your cluster will appear here automatically."
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ModelTable<CephCluster>
        modelType={CephCluster}
        id="ceph-clusters-table"
        userPreferencesKey="ceph-clusters-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<CephCluster>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        showRefreshButton={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        name="Ceph Clusters"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Ceph Clusters",
          description:
            "Clusters being monitored in this project. Install the OneUptime Ceph Agent to connect a cluster.",
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
            placeholder: "production-ceph-cluster",
            description:
              "This is the join key — it must match the ceph.cluster.name resource attribute reported by the Ceph Agent (the CEPH_CLUSTER_NAME environment variable).",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Ceph cluster running in US East",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: CephCluster): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.CEPH_CLUSTER_VIEW] as Route,
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
              healthStatus: true,
            },
            title: "Health",
            type: FieldType.Element,
            getElement: (item: CephCluster): ReactElement => {
              return renderHealthPill(item.healthStatus);
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: CephCluster): ReactElement => {
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
                    {isConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>
              );
            },
          },
          {
            field: {
              osdCount: true,
            },
            title: "OSDs",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CephCluster): ReactElement => {
              const total: number = item.osdCount || 0;
              if (total === 0) {
                return <span className="text-gray-400">—</span>;
              }
              const up: number = item.osdUpCount || 0;
              const inCount: number = item.osdInCount || 0;
              const allUp: boolean = up >= total && inCount >= total;
              return (
                <span
                  className={`text-sm font-medium ${
                    allUp ? "text-gray-900" : "text-amber-700"
                  }`}
                >
                  {up} up / {inCount} in / {total} total
                </span>
              );
            },
          },
          {
            field: {
              monCount: true,
            },
            title: "Mons",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CephCluster): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {item.monCount ? String(item.monCount) : "—"}
                </span>
              );
            },
          },
          {
            field: {
              poolCount: true,
            },
            title: "Pools",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CephCluster): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {item.poolCount ? String(item.poolCount) : "—"}
                </span>
              );
            },
          },
          {
            field: {
              capacityUsedPercent: true,
            },
            title: "Capacity",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CephCluster): ReactElement => {
              return renderCapacityBar(item.capacityUsedPercent);
            },
          },
          {
            field: {
              cephVersion: true,
            },
            title: "Version",
            type: FieldType.Text,
            hideOnMobile: true,
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
            getElement: (item: CephCluster): ReactElement => {
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
            getElement: (item: CephCluster): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: CephCluster): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.CEPH_CLUSTER_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default CephClusters;
