import PageMap from "../../Utils/PageMap";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerHostOwnerTeam from "Common/Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostOwnerUser from "Common/Models/DatabaseModels/DockerHostOwnerUser";
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
import {
  getDisplayNameFormField,
  getIdentityFormField,
  getNameFromIdentityField,
} from "../../Utils/Form/DiscoveredResourceFormFields";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DockerDocumentationCard from "../../Components/Docker/DocumentationCard";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const DockerHosts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [hostCount, setHostCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<DockerHost>({ modelType: DockerHost });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<DockerHost>({
      ownerUserModelType: DockerHostOwnerUser,
      ownerTeamModelType: DockerHostOwnerTeam,
      resourceIdField: "dockerHostId",
    });

  const { archiveBulkActions } = useBulkArchiveActions<DockerHost>({
    modelType: DockerHost,
  });

  const dockerExtraFacets: Array<ResourceFacet> = [
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
  } = useResourceOwners<DockerHost>({
    persistKey: "docker-hosts-table",
    ownerUserModelType: DockerHostOwnerUser,
    ownerTeamModelType: DockerHostOwnerTeam,
    resourceIdField: "dockerHostId",
    showLabelsFacet: true,
    extraFacets: dockerExtraFacets,
  });

  const fetchHostCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: DockerHost,
        query: {},
      });
      setHostCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchHostCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  /*
   * The create form asks for the one thing a Docker host cannot be created
   * without: the host.name its agent reports. The display name follows it -
   * a host added here is named like a discovered one - and folds under
   * Advanced with the description and the labels, so the form is two rows
   * (DiscoveredResourceFormFields).
   */
  const advancedSection: FormFieldCollapsibleSection<DockerHost> =
    getAdvancedFormSection<DockerHost>();

  return (
    <Fragment>
      <ModelTable<DockerHost>
        modelType={DockerHost}
        id="docker-hosts-table"
        userPreferencesKey="docker-hosts-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<DockerHost>) => {
          onResourcesFetched(data);
        }}
        onCreateSuccess={(item: DockerHost): Promise<DockerHost> => {
          setHostCount((currentCount: number | null): number => {
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
        name="Docker Hosts"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Docker Hosts",
          description:
            "Hosts being monitored in this project. Install the OneUptime Docker Agent to connect a host.",
        }}
        showViewIdButton={true}
        formFields={[
          getIdentityFormField<DockerHost>({
            field: {
              hostIdentifier: true,
            },
            title: "Host Name (host.name)",
            placeholder: "docker-host-prod-1",
            description:
              "Exactly as the OneUptime Docker Agent reports it. Telemetry is matched to this host by its host name.",
          }),
          getDisplayNameFormField<DockerHost>({
            getDefaultName: getNameFromIdentityField<DockerHost>("hostIdentifier"),
            placeholder: "Production Docker host",
            description:
              "Starts as the host name, the way discovered hosts are named. Type a name of your own to show it instead. Telemetry is still matched by the host name.",
            collapsibleSection: advancedSection,
          }),
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Docker host running in US East",
            collapsibleSection: advancedSection,
          },
          getLabelsFormField<DockerHost>({
            collapsibleSection: advancedSection,
          }),
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: DockerHost): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.DOCKER_HOST_VIEW] as Route,
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
              hostIdentifier: true,
            },
            title: "Host Identifier",
            type: FieldType.Text,
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: DockerHost): ReactElement => {
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
            getElement: (item: DockerHost): ReactElement => {
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
            getElement: (item: DockerHost): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: DockerHost): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.DOCKER_HOST_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {hostCount === 0 && (
        <DockerDocumentationCard
          title="Getting Started with Docker Monitoring"
          description="No Docker hosts connected yet. Install the agent using the guide below and your host will appear here automatically."
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default DockerHosts;
