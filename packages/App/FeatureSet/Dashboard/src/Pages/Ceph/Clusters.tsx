import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
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
  FIRST_RUN_GUIDE_DESCRIPTION,
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AddResourceGuide from "../../Components/ResourceOnboarding/AddResourceGuide";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import CEPH_CLUSTER_ONBOARDING from "../../Components/Ceph/CephClusterOnboarding";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import { CEPH_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/CephMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

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
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<CephCluster>({
    modelType: CephCluster,
  });
  const [isAddClusterOpen, setIsAddClusterOpen] = useState<boolean>(false);
  // Clusters connected from the Add dialog show in the list at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<CephCluster>({ modelType: CephCluster });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<CephCluster>({
      ownerUserModelType: CephClusterOwnerUser,
      ownerTeamModelType: CephClusterOwnerTeam,
      resourceIdField: "cephClusterId",
    });

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<CephCluster>({
      modelType: CephCluster,
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
    emptyState: facetEmptyState,
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
   * A Ceph cluster is added by running the agent beside it (Add Ceph
   * Cluster): the guide asks for the cluster's name, writes it into the
   * commands, and the cluster registers itself under it when the agent
   * connects. There is no form: a cluster typed in by hand would only wait
   * for telemetry that nothing sends.
   */
  return (
    <Fragment>
      <ModelTable<CephCluster>
        modelType={CephCluster}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}
        id="ceph-clusters-table"
        userPreferencesKey="ceph-clusters-table"
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
        onFetchSuccess={(data: Array<CephCluster>) => {
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
        name="Ceph Clusters"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Ceph Clusters",
          description:
            "Clusters being monitored in this project. Install the OneUptime Ceph Agent to connect a cluster.",
          buttons: [
            {
              title: CEPH_CLUSTER_ONBOARDING.addTitle,
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setIsAddClusterOpen(true);
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
            headerTooltip: CEPH_METRIC_DESCRIPTIONS.health,
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
              osdCount: true,
            },
            title: "OSDs",
            headerTooltip: CEPH_METRIC_DESCRIPTIONS.clusterOsds,
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
                  {translator.translateTemplate(
                    "{{up}} up / {{in}} in / {{total}} total",
                    { up: up, in: inCount, total: total },
                  )}
                </span>
              );
            },
          },
          {
            field: {
              monCount: true,
            },
            title: "Mons",
            headerTooltip: CEPH_METRIC_DESCRIPTIONS.clusterMons,
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
            headerTooltip: CEPH_METRIC_DESCRIPTIONS.pools,
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
            headerTooltip: CEPH_METRIC_DESCRIPTIONS.clusterCapacity,
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
      {firstRecordWatch.count === 0 && (
        <AddResourceGuide
          onboarding={CEPH_CLUSTER_ONBOARDING}
          title={CEPH_CLUSTER_ONBOARDING.firstRunTitle}
          description={FIRST_RUN_GUIDE_DESCRIPTION}
          onConnected={() => {
            // The guide gives way, and the table reads the new cluster.
            firstRecordWatch.onRecordCreated();
            setConnectedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      )}
      {isAddClusterOpen && (
        <AddResourceModal
          onboarding={CEPH_CLUSTER_ONBOARDING}
          onClose={() => {
            setIsAddClusterOpen(false);
          }}
          onConnected={() => {
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

export default CephClusters;
