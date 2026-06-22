import PageMap from "../../Utils/PageMap";
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
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DockerSwarmDocumentationCard from "../../Components/DockerSwarm/DocumentationCard";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";

/*
 * WI-18: while the project has no clusters yet, re-count on this
 * cadence so the page flips from the install guide to the table the
 * moment the first agent batch lands — no hard refresh.
 */
const FIRST_DATA_POLL_INTERVAL_MS: number = 10 * 1000;

const DockerSwarmClusters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [clusterCount, setClusterCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<DockerSwarmCluster>({ modelType: DockerSwarmCluster });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<DockerSwarmCluster>({
      ownerUserModelType: DockerSwarmClusterOwnerUser,
      ownerTeamModelType: DockerSwarmClusterOwnerTeam,
      resourceIdField: "dockerSwarmClusterId",
    });

  const { archiveBulkActions } = useBulkArchiveActions<DockerSwarmCluster>({
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

  const fetchClusterCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: DockerSwarmCluster,
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
   * Live first-data poll (WI-18): the one-shot count above paints the
   * empty state; this effect keeps quietly re-counting every 10s while
   * the count is zero and flips the page to the table on the first
   * nonzero result. The interval is cleared on unmount and is not
   * re-armed once a cluster exists (the effect re-runs with a nonzero
   * count and bails). Background failures keep the empty state rather
   * than replacing the install guide with an error.
   */
  useEffect(() => {
    if (clusterCount !== 0) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      ModelAPI.count({
        modelType: DockerSwarmCluster,
        query: {},
      })
        .then((count: number) => {
          if (count > 0) {
            setClusterCount(count);
          }
        })
        .catch(() => {
          // Transient background-poll failure — keep polling.
        });
    }, FIRST_DATA_POLL_INTERVAL_MS);
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
        <DockerSwarmDocumentationCard
          title="Getting Started with Docker Swarm Monitoring"
          description="No Docker Swarm clusters connected yet. Install the agent using the guide below and your cluster will appear here automatically."
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ModelTable<DockerSwarmCluster>
        modelType={DockerSwarmCluster}
        id="docker-swarm-clusters-table"
        userPreferencesKey="docker-swarm-clusters-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<DockerSwarmCluster>) => {
          onResourcesFetched(data);
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
        name="Docker Swarm Clusters"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Docker Swarm Clusters",
          description:
            "Clusters being monitored in this project. Install the OneUptime Docker Swarm Agent to connect a cluster.",
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
            placeholder: "swarm-production",
            description:
              "This should match the docker.swarm.cluster.name resource attribute reported by the Docker Swarm Agent.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Docker Swarm cluster running in US East",
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
                    {isConnected ? "Connected" : "Disconnected"}
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
                  {ready}/{total} ready
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
            getElement: (item: DockerSwarmCluster): ReactElement => {
              const total: number = item.taskCount || 0;
              if (total <= 0) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              const running: number = item.runningTaskCount || 0;
              return (
                <span className="text-sm text-gray-700">
                  {running}/{total} running
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
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default DockerSwarmClusters;
