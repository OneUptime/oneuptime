import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ServiceCodeRepository from "Common/Models/DatabaseModels/ServiceCodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUtil from "Common/UI/Utils/Project";
import Service from "Common/Models/DatabaseModels/Service";
import FieldType from "Common/UI/Components/Types/FieldType";
import BadDataException from "Common/Types/Exception/BadDataException";

const CodeRepositoryServices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ServiceCodeRepository>
        modelType={ServiceCodeRepository}
        id="table-code-repository-service"
        userPreferencesKey="code-repository-service-table"
        name="Code Repository > Service"
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
          item: ServiceCodeRepository,
        ): Promise<ServiceCodeRepository> => {
          item.codeRepositoryId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Services",
          description:
            "Link services from your service catalog to this code repository. Specify the path where each service's code lives.",
        }}
        noItemsMessage={
          "No services linked to this repository. Link a service to get started."
        }
        formFields={[
          {
            field: {
              service: true,
            },
            title: "Service",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Service",
            dropdownModal: {
              type: Service,
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
              service: true,
            },
            type: FieldType.Entity,
            title: "Service",
            filterEntityType: Service,
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
              service: {
                name: true,
                description: true,
              },
            },
            title: "Service",
            type: FieldType.Entity,
            getElement: (item: ServiceCodeRepository): ReactElement => {
              if (!item["service"]) {
                throw new BadDataException("Service not found");
              }

              const service: Service = item["service"] as Service;

              return (
                <div>
                  <div className="font-medium">{service.name}</div>
                  {service.description && (
                    <div className="text-gray-500 text-sm truncate max-w-xs">
                      {service.description}
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
            getElement: (item: ServiceCodeRepository): ReactElement => {
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

export default CodeRepositoryServices;
