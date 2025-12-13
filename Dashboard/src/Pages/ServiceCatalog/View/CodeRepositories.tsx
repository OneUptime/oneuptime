import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ServiceCatalogCodeRepository from "Common/Models/DatabaseModels/ServiceCatalogCodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUtil from "Common/UI/Utils/Project";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import FieldType from "Common/UI/Components/Types/FieldType";
import BadDataException from "Common/Types/Exception/BadDataException";

const ServiceCatalogCodeRepositories: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ServiceCatalogCodeRepository>
        modelType={ServiceCatalogCodeRepository}
        id="table-service-catalog-code-repository"
        userPreferencesKey="service-catalog-code-repository-table"
        name="Service Catalog > Code Repositories"
        singularName="Code Repository"
        isDeleteable={true}
        createVerb={"Link"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          serviceCatalogId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ServiceCatalogCodeRepository,
        ): Promise<ServiceCatalogCodeRepository> => {
          item.serviceCatalogId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Code Repositories",
          description:
            "Link code repositories to this service. Specify the path where the service code lives in each repository.",
        }}
        noItemsMessage={
          "No code repositories linked to this service. Link a code repository to get started."
        }
        formFields={[
          {
            field: {
              codeRepository: true,
            },
            title: "Code Repository",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Code Repository",
            dropdownModal: {
              type: CodeRepository,
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
              "The path in the repository where this service's code lives. Leave empty if the service is at the root of the repository.",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              codeRepository: true,
            },
            type: FieldType.Entity,
            title: "Code Repository",
            filterEntityType: CodeRepository,
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
              codeRepository: {
                name: true,
                repositoryHostedAt: true,
                organizationName: true,
                repositoryName: true,
              },
            },
            title: "Code Repository",
            type: FieldType.Entity,
            getElement: (item: ServiceCatalogCodeRepository): ReactElement => {
              if (!item["codeRepository"]) {
                throw new BadDataException("Code Repository not found");
              }

              const codeRepository: CodeRepository = item[
                "codeRepository"
              ] as CodeRepository;

              return (
                <div>
                  <div className="font-medium">{codeRepository.name}</div>
                  <div className="text-gray-500 text-sm">
                    {codeRepository.organizationName}/{codeRepository.repositoryName}
                  </div>
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

export default ServiceCatalogCodeRepositories;
