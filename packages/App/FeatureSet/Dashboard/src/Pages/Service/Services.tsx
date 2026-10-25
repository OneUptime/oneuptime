import LabelsElement from "Common/UI/Components/Label/Labels";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import ServiceElement from "../../Components/Service/ServiceElement";
import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  detectServiceLanguage,
  SERVICE_LANGUAGE_DISPLAY_NAMES,
  ServiceLanguage,
} from "../../Components/TelemetryResource/serviceGoldenMetrics";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ObjectID from "Common/Types/ObjectID";
import ServiceAddedModal from "../../Components/Service/ServiceAddedModal";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import Route from "Common/Types/API/Route";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SERVICE_NAME_HELP,
  SERVICES_EMPTY_DESCRIPTION,
  SET_UP_TELEMETRY_ACTION,
} from "../../Components/Service/ServiceListCopy";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceOwnerTeam from "Common/Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "Common/Models/DatabaseModels/ServiceOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";

const ServicesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Service>({ modelType: Service });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Service>({
      ownerUserModelType: ServiceOwnerUser,
      ownerTeamModelType: ServiceOwnerTeam,
      resourceIdField: "serviceId",
    });

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<Service>({
      modelType: Service,
    });

  /*
   * The service Create Service just saved: the OpenTelemetry guide opens on
   * its own (ServiceAddedModal), with its service.name in every snippet.
   */
  const [addedService, setAddedService] = useState<{
    id: ObjectID;
    name: string;
  } | null>(null);

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Service>({
    persistKey: "service-table",
    ownerUserModelType: ServiceOwnerUser,
    ownerTeamModelType: ServiceOwnerTeam,
    resourceIdField: "serviceId",
    showLabelsFacet: true,
  });

  // Description and labels fold together under one Advanced section.
  const moreFields: FormFieldCollapsibleSection<Service> =
    getAdvancedFormSection<Service>();

  return (
    <Fragment>
      <ModelTable<Service>
        modelType={Service}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        id="service-table"
        userPreferencesKey="service-table"
        topContent={filterBar}
        /*
         * A service appears by itself when telemetry with a new service.name
         * arrives, so an empty list says so, with the setup guide beside the
         * Create button for a service made by hand.
         */
        emptyState={{
          ...facetEmptyState,
          description: SERVICES_EMPTY_DESCRIPTION,
          actions: [
            {
              title: SET_UP_TELEMETRY_ACTION,
              icon: IconProp.Book,
              dataTestId: "services-set-up-telemetry",
              onClick: (): void => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
                  ),
                );
              },
            },
          ],
        }}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<Service>) => {
          onResourcesFetched(data);
        }}
        saveFilterProps={{
          tableId: "service-table",
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={true}
        onCreateSuccess={(
          item: Service,
          modalType?: ModalType,
        ): Promise<Service> => {
          if (item._id && modalType !== ModalType.Edit) {
            setAddedService({
              id: new ObjectID(item._id.toString()),
              name: item.name || "",
            });
          }
          return Promise.resolve(item);
        }}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Services"
        isViewable={true}
        cardProps={{
          title: "Services",
          description:
            "The applications and microservices you run. Each service brings together its logs, traces, metrics, exceptions, incidents and owners in one place.",
        }}
        showViewIdButton={true}
        selectMoreFields={{
          serviceColor: true,
          // Inputs for the auto-detected Technology column.
          telemetrySdkLanguage: true,
          runtimeName: true,
          techStack: true,
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            /*
             * What telemetry is matched on: a service made by hand only
             * fills when its name is the service.name the apps send.
             */
            description: SERVICE_NAME_HELP,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g., checkout-api",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "What this service does",
            collapsibleSection: moreFields,
          },
          getLabelsFormField<Service>({ collapsibleSection: moreFields }),
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        searchableFields={["name", "description"]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (service: Service): ReactElement => {
              return (
                <Fragment>
                  <ServiceElement service={service} />
                </Fragment>
              );
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              telemetrySdkLanguage: true,
            },
            title: "Technology",
            type: FieldType.Element,
            getElement: (item: Service): ReactElement => {
              const language: ServiceLanguage | null = detectServiceLanguage({
                telemetrySdkLanguage: item.telemetrySdkLanguage,
                runtimeName: item.runtimeName,
                techStack: item.techStack,
              });
              if (!language) {
                return <span className="text-gray-400">—</span>;
              }
              return (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700">
                  <Icon
                    icon={IconProp.Code}
                    className="h-3 w-3 text-gray-500"
                  />
                  {SERVICE_LANGUAGE_DISPLAY_NAMES[language]}
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

            getElement: (item: Service): ReactElement => {
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
            getElement: (item: Service): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />
      {addedService && (
        <ServiceAddedModal
          serviceId={addedService.id}
          name={addedService.name}
          onClose={() => {
            setAddedService(null);
          }}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default ServicesPage;
