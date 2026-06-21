import LabelsElement from "Common/UI/Components/Label/Labels";
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
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceOwnerTeam from "Common/Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "Common/Models/DatabaseModels/ServiceOwnerUser";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
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
      resourceIdField: "primaryEntityId",
    });

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Service>({
    persistKey: "service-table",
    ownerUserModelType: ServiceOwnerUser,
    ownerTeamModelType: ServiceOwnerTeam,
    resourceIdField: "primaryEntityId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<Service>
        modelType={Service}
        id="service-table"
        userPreferencesKey="service-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<Service>) => {
          onResourcesFetched(data);
        }}
        saveFilterProps={{
          tableId: "service-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
        }}
        name="Services"
        isViewable={true}
        cardProps={{
          title: "Services",
          description: "List and manage services for this project here.",
        }}
        showViewIdButton={true}
        noItemsMessage={"No services found."}
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
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Service Name",
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
            placeholder: "Description",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description:
              "Labels help you categorize and organize your services.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: false,
            placeholder: "Labels",
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
          },
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
            noValueMessage: "-",
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
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default ServicesPage;
