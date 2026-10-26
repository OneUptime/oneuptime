import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmClusterOwnerTeam from "Common/Models/DatabaseModels/DockerSwarmClusterOwnerTeam";
import DockerSwarmClusterOwnerUser from "Common/Models/DatabaseModels/DockerSwarmClusterOwnerUser";
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
import DOCKER_SWARM_CLUSTER_ONBOARDING from "../../Components/DockerSwarm/DockerSwarmClusterOnboarding";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import DOCKER_SWARM_CLUSTER_SHOWCASE from "../../Components/DockerSwarm/DockerSwarmClusterShowcase";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/DockerSwarmMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const DockerSwarmClusters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch =
    useFirstRecordWatch<DockerSwarmCluster>({
      modelType: DockerSwarmCluster,
    });
  const [isAddClusterOpen, setIsAddClusterOpen] = useState<boolean>(false);
  // Clusters connected from the Add dialog show in the list at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<DockerSwarmCluster>({ modelType: DockerSwarmCluster });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<DockerSwarmCluster>({
      ownerUserModelType: DockerSwarmClusterOwnerUser,
      ownerTeamModelType: DockerSwarmClusterOwnerTeam,
      resourceIdField: "dockerSwarmClusterId",
    });

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<DockerSwarmCluster>({
      modelType: DockerSwarmCluster,
    });

  const dockerSwarmExtraFacets: Array<ResourceFacet> = [
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
  } = useResourceOwners<DockerSwarmCluster>({
    persistKey: "docker-swarm-clusters-table",
    ownerUserModelType: DockerSwarmClusterOwnerUser,
    ownerTeamModelType: DockerSwarmClusterOwnerTeam,
    resourceIdField: "dockerSwarmClusterId",
    showLabelsFacet: true,
    extraFacets: dockerSwarmExtraFacets,
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
   * A Swarm cluster is added by deploying the agent to it (Add Docker
   * Swarm Cluster): the guide asks for the cluster's name, writes it into
   * the commands, and the cluster registers itself under it when the agent
   * connects. There is no form: a cluster typed in by hand would only wait
   * for telemetry that nothing sends.
   */
  return (
    <Fragment>
      <ModelTable<DockerSwarmCluster>
        modelType={DockerSwarmCluster}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}
        id="docker-swarm-clusters-table"
        userPreferencesKey="docker-swarm-clusters-table"
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
        onFetchSuccess={(data: Array<DockerSwarmCluster>) => {
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
        name="Docker Swarm Clusters"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Docker Swarm Clusters",
          description:
            "Clusters being monitored in this project. Install the OneUptime Docker Swarm Agent to connect a cluster.",
          buttons: [
            {
              title: DOCKER_SWARM_CLUSTER_ONBOARDING.addTitle,
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
            getElement: (item: DockerSwarmCluster): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW] as Route,
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
            getElement: (item: DockerSwarmCluster): ReactElement => {
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
              nodeCount: true,
              readyNodeCount: true,
            },
            title: "Nodes",
            type: FieldType.Element,
            headerTooltip: DOCKER_SWARM_METRIC_DESCRIPTIONS.clusterListNodes,
            getElement: (item: DockerSwarmCluster): ReactElement => {
              /*
               * Snapshot columns written by the ingest path from the
               * same buffer that populates the DockerSwarmResource
               * inventory — no ClickHouse round-trip here.
               */
              const total: number = item.nodeCount || 0;
              if (total <= 0) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              const ready: number = item.readyNodeCount || 0;
              const allReady: boolean = ready >= total;
              return (
                <span
                  className={`text-sm font-medium ${
                    allReady ? "text-gray-900" : "text-red-700"
                  }`}
                >
                  {translator.translateTemplate("{{ready}}/{{total}} ready", {
                    ready: ready,
                    total: total,
                  })}
                </span>
              );
            },
          },
          {
            field: {
              serviceCount: true,
            },
            title: "Services",
            type: FieldType.Element,
            hideOnMobile: true,
            headerTooltip: DOCKER_SWARM_METRIC_DESCRIPTIONS.clusterListServices,
            getElement: (item: DockerSwarmCluster): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {item.serviceCount || 0}
                </span>
              );
            },
          },
          {
            field: {
              taskCount: true,
              runningTaskCount: true,
            },
            title: "Tasks",
            type: FieldType.Element,
            hideOnMobile: true,
            headerTooltip: DOCKER_SWARM_METRIC_DESCRIPTIONS.clusterListTasks,
            getElement: (item: DockerSwarmCluster): ReactElement => {
              const total: number = item.taskCount || 0;
              if (total <= 0) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              const running: number = item.runningTaskCount || 0;
              return (
                <span className="text-sm text-gray-700">
                  {translator.translateTemplate(
                    "{{running}}/{{total}} running",
                    { running: running, total: total },
                  )}
                </span>
              );
            },
          },
          {
            field: {
              dockerVersion: true,
            },
            title: "Docker Version",
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
            getElement: (item: DockerSwarmCluster): ReactElement => {
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
            getElement: (item: DockerSwarmCluster): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: DockerSwarmCluster): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW] as Route,
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
          showcase={DOCKER_SWARM_CLUSTER_SHOWCASE}
          addButton={{
            title: DOCKER_SWARM_CLUSTER_ONBOARDING.addTitle,
            onClick: () => {
              setIsAddClusterOpen(true);
            },
          }}
        />
      )}
      {isAddClusterOpen && (
        <AddResourceModal
          onboarding={DOCKER_SWARM_CLUSTER_ONBOARDING}
          onClose={() => {
            setIsAddClusterOpen(false);
          }}
          onConnected={() => {
            // The showcase gives way, and the table reads the new cluster.
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

export default DockerSwarmClusters;
