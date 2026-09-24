import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerOwnerTeam from "Common/Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerUser from "Common/Models/DatabaseModels/DatabaseServerOwnerUser";
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
import Pill from "Common/UI/Components/Pill/Pill";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { getDatabaseServerDiscoverySourceLabel } from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import DatabaseDocumentationCard from "../../Components/DatabaseServer/DocumentationCard";
import DatabaseServerSummaryStrip from "../../Components/DatabaseServer/DatabaseServerSummaryStrip";
import {
  DatabaseEngineMetricsStatus,
  DatabaseOption,
  getDatabaseDiscoverySourceOptions,
  getDatabaseEngineLabel,
  getDatabaseEngineMetricsStatus,
  getDatabaseEngineMetricsStatusLabel,
  getDatabaseEndpointLabel,
  getDatabaseEngineOptions,
  getDatabaseRunsOnLabel,
} from "./Utils/DatabaseServerPresentation";

const ENGINE_OPTIONS: Array<DatabaseOption> = getDatabaseEngineOptions();
const DISCOVERY_SOURCE_OPTIONS: Array<DatabaseOption> =
  getDatabaseDiscoverySourceOptions();

const ENGINE_METRICS_STATUS_COLORS: Record<DatabaseEngineMetricsStatus, Color> =
  {
    [DatabaseEngineMetricsStatus.Connected]: Green,
    [DatabaseEngineMetricsStatus.Disconnected]: Red,
    [DatabaseEngineMetricsStatus.NotConnected]: Gray500,
  };

const Databases: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<DatabaseServer>({ modelType: DatabaseServer });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<DatabaseServer>({
      ownerUserModelType: DatabaseServerOwnerUser,
      ownerTeamModelType: DatabaseServerOwnerTeam,
      resourceIdField: "databaseServerId",
    });

  const { archiveBulkActions } = useBulkArchiveActions<DatabaseServer>({
    modelType: DatabaseServer,
  });

  const databaseExtraFacets: Array<ResourceFacet> = [
    {
      key: "dbSystem",
      label: "Engine",
      icon: IconProp.Database,
      isMultiSelect: true,
      options: ENGINE_OPTIONS,
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, true);
      },
    },
    {
      key: "discoverySource",
      label: "Discovered from",
      icon: IconProp.Search,
      isMultiSelect: true,
      options: DISCOVERY_SOURCE_OPTIONS,
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, true);
      },
    },
    {
      key: "otelCollectorStatus",
      label: "Engine metrics",
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
  } = useResourceOwners<DatabaseServer>({
    persistKey: "database-servers-table",
    ownerUserModelType: DatabaseServerOwnerUser,
    ownerTeamModelType: DatabaseServerOwnerTeam,
    resourceIdField: "databaseServerId",
    showLabelsFacet: true,
    extraFacets: databaseExtraFacets,
  });

  useEffect(() => {
    /*
     * Count first: the setup guide below the table is shown only while the
     * project has no database at all, archived ones included.
     */
    ModelAPI.count({
      modelType: DatabaseServer,
      query: {},
    })
      .then(setCount)
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (count === null) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      <DatabaseServerSummaryStrip refreshToken={count} />
      <ModelTable<DatabaseServer>
        modelType={DatabaseServer}
        id="database-servers-table"
        userPreferencesKey="database-servers-table"
        isCreateable={true}
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<DatabaseServer>) => {
          onResourcesFetched(data);
        }}
        onBeforeCreate={(
          item: DatabaseServer,
          _miscDataProps: JSONObject,
        ): Promise<DatabaseServer> => {
          /*
           * The server derives everything that makes the row findable —
           * the canonical endpoint, the identifier, the "manual" source and
           * a default name — from the engine and address typed here. Only
           * trim, and leave an empty name out so the server names it
           * "PostgreSQL db.prod:5432" like every discovered database.
           */
          item.serverAddress = String(item.serverAddress || "").trim();
          const name: string = String(item.name || "").trim();
          if (name) {
            item.name = name;
          } else {
            delete item.name;
          }
          return Promise.resolve(item);
        }}
        onCreateSuccess={(item: DatabaseServer): Promise<DatabaseServer> => {
          setCount((currentCount: number | null): number => {
            return (currentCount || 0) + 1;
          });
          return Promise.resolve(item);
        }}
        isDeleteable={false}
        isEditable={false}
        isViewable={true}
        showRefreshButton={true}
        showViewIdButton={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Databases"
        searchableFields={["name", "description", "serverAddress"]}
        cardProps={{
          title: "Databases",
          description:
            "Every database server this project runs or talks to — discovered from the queries in your application traces, database workloads on your Kubernetes clusters and Docker / Podman hosts, and the OneUptime Database Agent — or added by hand.",
        }}
        formFields={[
          {
            field: {
              dbSystem: true,
            },
            title: "Engine",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: ENGINE_OPTIONS,
            required: true,
            placeholder: "Select an engine",
            description:
              "The database engine. Its default port is used when you leave the port empty.",
          },
          {
            field: {
              serverAddress: true,
            },
            title: "Server Address",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "db.prod.internal",
            description:
              "The host name or IP your applications connect to — what their traces report as server.address. Never localhost.",
          },
          {
            field: {
              serverPort: true,
            },
            title: "Server Port",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "5432",
            description:
              "Leave empty to use the engine's default port (5432 for PostgreSQL, 3306 for MySQL, 6379 for Redis, ...).",
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "PostgreSQL db.prod.internal:5432",
            description:
              "Leave empty to name it like a discovered database: the engine, then the endpoint.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Primary PostgreSQL cluster for the checkout stack",
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
        filters={[]}
        columns={[
          {
            field: {
              name: true,
              serverAddress: true,
              serverPort: true,
              kubernetesNamespace: true,
              workloadKind: true,
              workloadName: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: DatabaseServer): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              const subtitle: string = getDatabaseEndpointLabel(item);
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {(item.name as string) || "—"}
                  </AppLink>
                  {subtitle && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {subtitle}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              dbSystem: true,
              dbVersion: true,
            },
            title: "Engine",
            type: FieldType.Element,
            getElement: (item: DatabaseServer): ReactElement => {
              const version: string = ((item.dbVersion as string) || "").trim();
              return (
                <div className="text-sm text-gray-700">
                  <span>{getDatabaseEngineLabel(item.dbSystem)}</span>
                  {version && (
                    <span className="ml-1.5 text-xs text-gray-500 font-mono">
                      {version}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              discoverySource: true,
              kubernetesClusterId: true,
              kubernetesCluster: {
                name: true,
              },
              dockerHostId: true,
              dockerHost: {
                name: true,
              },
              podmanHostId: true,
              podmanHost: {
                name: true,
              },
            },
            title: "Runs on",
            type: FieldType.Element,
            hideOnMobile: true,
            disableSort: true,
            getElement: (item: DatabaseServer): ReactElement => {
              const label: string = getDatabaseRunsOnLabel(item);
              return label === "—" ? (
                <span className="text-sm text-gray-400">—</span>
              ) : (
                <span className="text-sm text-gray-700">{label}</span>
              );
            },
          },
          {
            field: {
              discoverySource: true,
            },
            title: "Discovered from",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DatabaseServer): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {getDatabaseServerDiscoverySourceLabel(item.discoverySource)}
                </span>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
              collectorLastSeenAt: true,
            },
            title: "Engine metrics",
            type: FieldType.Element,
            getElement: (item: DatabaseServer): ReactElement => {
              const status: DatabaseEngineMetricsStatus =
                getDatabaseEngineMetricsStatus(item);
              return (
                <Pill
                  text={getDatabaseEngineMetricsStatusLabel(status)}
                  color={ENGINE_METRICS_STATUS_COLORS[status]}
                />
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
            getElement: (item: DatabaseServer): ReactElement => {
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
            getElement: (item: DatabaseServer): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: DatabaseServer): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {count === 0 && (
        <DatabaseDocumentationCard
          title="Getting Started with Databases"
          description="No databases yet. Databases appear here on their own as soon as your instrumented applications query them, or when OneUptime finds one on a monitored Kubernetes cluster or Docker / Podman host. Add one by hand above, or connect engine metrics with the Database Agent using the guide below."
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default Databases;
