import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ServiceCatalogCodeRepository from "Common/Models/DatabaseModels/ServiceCatalogCodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUtil from "Common/UI/Utils/Project";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";
import FieldType from "Common/UI/Components/Types/FieldType";
import BadDataException from "Common/Types/Exception/BadDataException";

const CodeRepositoryServiceCatalogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ServiceCatalogCodeRepository>
        modelType={ServiceCatalogCodeRepository}
        id="table-code-repository-service-catalog"
        userPreferencesKey="code-repository-service-catalog-table"
        name="Code Repository > Service Catalog"
        singularName="Service"
        isDeleteable={true}
        createVerb={"Link"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          codeRepositoryId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ServiceCatalogCodeRepository,
        ): Promise<ServiceCatalogCodeRepository> => {
          item.codeRepositoryId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Service Catalog",
          description:
            "Link services from your service catalog to this code repository. Specify the path where each service's code lives.",
        }}
        noItemsMessage={
          "No services linked to this repository. Link a service to get started."
        }
        formFields={[
          {
            field: {
              serviceCatalog: true,
            },
            title: "Service",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Service",
            dropdownModal: {
              type: ServiceCatalog,
              labelField: "name",
              valueField: "_id",
            },
          },
          {
            field: {
              servicePathInRepository: true,
            },
            title: "Service Path in Repository",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "/services/api or /src/backend",
            description:
              "The path in this repository where the service's code lives. Leave empty if the service is at the root of the repository.",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              serviceCatalog: true,
            },
            type: FieldType.Entity,
            title: "Service",
            filterEntityType: ServiceCatalog,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Linked At",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              serviceCatalog: {
                name: true,
                description: true,
              },
            },
            title: "Service",
            type: FieldType.Entity,
            getElement: (item: ServiceCatalogCodeRepository): ReactElement => {
              if (!item["serviceCatalog"]) {
                throw new BadDataException("Service Catalog not found");
              }

              const serviceCatalog: ServiceCatalog = item[
                "serviceCatalog"
              ] as ServiceCatalog;

              return (
                <div>
                  <div className="font-medium">{serviceCatalog.name}</div>
                  {serviceCatalog.description && (
                    <div className="text-gray-500 text-sm truncate max-w-xs">
                      {serviceCatalog.description}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              servicePathInRepository: true,
            },
            title: "Service Path",
            type: FieldType.Text,
            getElement: (item: ServiceCatalogCodeRepository): ReactElement => {
              return (
                <span className="font-mono text-sm">
                  {item.servicePathInRepository || "/"}
                </span>
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Linked At",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default CodeRepositoryServiceCatalogs;
