import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import PodmanHostOwnerTeam from "Common/Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerUser from "Common/Models/DatabaseModels/PodmanHostOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEnumFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import IconProp from "Common/Types/Icon/IconProp";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
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
import PodmanDocumentationCard from "../../Components/Podman/DocumentationCard";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const PodmanHosts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<PodmanHost>({
    modelType: PodmanHost,
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<PodmanHost>({ modelType: PodmanHost });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<PodmanHost>({
      ownerUserModelType: PodmanHostOwnerUser,
      ownerTeamModelType: PodmanHostOwnerTeam,
      resourceIdField: "podmanHostId",
    });

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<PodmanHost>({
      modelType: PodmanHost,
    });

  const podmanExtraFacets: Array<ResourceFacet> = [
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
  } = useResourceOwners<PodmanHost>({
    persistKey: "podman-hosts-table",
    ownerUserModelType: PodmanHostOwnerUser,
    ownerTeamModelType: PodmanHostOwnerTeam,
    resourceIdField: "podmanHostId",
    showLabelsFacet: true,
    extraFacets: podmanExtraFacets,
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
   * The create form asks for the one thing a Podman host cannot be created
   * without: the host.name its agent reports. The display name follows it -
   * a host added here is named like a discovered one - and folds under
   * Advanced with the description and the labels, so the form is two rows
   * (DiscoveredResourceFormFields).
   */
  const advancedSection: FormFieldCollapsibleSection<PodmanHost> =
    getAdvancedFormSection<PodmanHost>();

  return (
    <Fragment>
      <ModelTable<PodmanHost>
        modelType={PodmanHost}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={firstRecordWatch.refreshToken}
        id="podman-hosts-table"
        userPreferencesKey="podman-hosts-table"
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
        onFetchSuccess={(data: Array<PodmanHost>) => {
          onResourcesFetched(data);
        }}
        onCreateSuccess={(item: PodmanHost): Promise<PodmanHost> => {
          firstRecordWatch.onRecordCreated();
          return Promise.resolve(item);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
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
        name="Podman Hosts"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "Podman Hosts",
          description:
            "Hosts being monitored in this project. Install the OneUptime Podman Agent to connect a host.",
        }}
        showViewIdButton={true}
        formFields={[
          getIdentityFormField<PodmanHost>({
            field: {
              hostIdentifier: true,
            },
            title: "Host Name (host.name)",
            placeholder: "podman-host-prod-1",
            description:
              "Exactly as the OneUptime Podman Agent reports it. Telemetry is matched to this host by its host name.",
          }),
          getDisplayNameFormField<PodmanHost>({
            getDefaultName:
              getNameFromIdentityField<PodmanHost>("hostIdentifier"),
            placeholder: "Production Podman host",
            description:
              "Starts as the host name. Type your own name to show instead; telemetry is still matched by the host name.",
            collapsibleSection: advancedSection,
          }),
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Podman host running in US East",
            collapsibleSection: advancedSection,
          },
          getLabelsFormField<PodmanHost>({
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
            getElement: (item: PodmanHost): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.PODMAN_HOST_VIEW] as Route,
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
            title: "Host Name (host.name)",
            type: FieldType.Text,
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: PodmanHost): ReactElement => {
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
            getElement: (item: PodmanHost): ReactElement => {
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
            getElement: (item: PodmanHost): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: PodmanHost): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.PODMAN_HOST_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {firstRecordWatch.count === 0 && (
        <PodmanDocumentationCard
          title="Getting Started with Podman Monitoring"
          description={FIRST_RUN_GUIDE_DESCRIPTION}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default PodmanHosts;
