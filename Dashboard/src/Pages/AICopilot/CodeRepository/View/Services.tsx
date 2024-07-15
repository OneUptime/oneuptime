import ServiceCatalogElement from "../../../../Components/ServiceCatalog/ServiceElement";
import DashboardNavigation from "../../../../Utils/Navigation";
import PageComponentProps from "../../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import ServiceCatalog from "Model/Models/ServiceCatalog";
import ServiceCopilotCodeRepository from "Model/Models/ServiceCopilotCodeRepository";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceCopilotCodeRepositoryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const codeRepositoryId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<ServiceCopilotCodeRepository>
        modelType={ServiceCopilotCodeRepository}
        id="table-service-repository-page"
        name="Code Repository > Service Repository"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isEditable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          codeRepositoryId: codeRepositoryId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        onBeforeCreate={(
          item: ServiceCopilotCodeRepository,
        ): Promise<ServiceCopilotCodeRepository> => {
          item.codeRepositoryId = codeRepositoryId;
          item.projectId = DashboardNavigation.getProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Services",
          description:
            "List of services that are associated with this code repository.",
        }}
        noItemsMessage={
          "No services associated with this code repository so far. Please add some to activate copilot."
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
            description:
              "Select the service that this repository is for. You can add a service from the Service Catalog.",
            dropdownModal: {
              type: ServiceCatalog,
              labelField: "name",
              valueField: "_id",
            },
            doNotShowWhenEditing: true,
          },
          {
            field: {
              servicePathInRepository: true,
            },
            title: "Service Path in Repository",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description:
              "If this repository is a mono-repo, please provide the path to the service in the repository. If this repository is a single service repository, please provide /.",
            placeholder: "/",
          },
          {
            field: {
              limitNumberOfOpenPullRequestsCount: true,
            },
            title: "Number of Open Pull Requests for this service",
            fieldType: FormFieldSchemaType.Number,
            defaultValue: 5,
            required: true,
            description:
              "OneUptime will not create a new pull request if the number of open pull requests for this service is more than the limit specified here.",
            placeholder: "/",
          },
          {
            field: {
              enablePullRequests: true,
            },
            title: "Enable Pull Requests",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
            description:
              "If enabled, OneUptime will create pull requests for this service and automatically improve code.",
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
              projectId: DashboardNavigation.getProjectId()?.toString(),
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              servicePathInRepository: true,
            },
            title: "Service Path in Repository",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              serviceCatalog: {
                name: true,
                serviceColor: true,
              },
            },
            title: "Service",
            type: FieldType.Entity,

            getElement: (item: ServiceCopilotCodeRepository): ReactElement => {
              if (!item["serviceCatalog"]) {
                throw new BadDataException("Service not found");
              }

              return (
                <ServiceCatalogElement
                  serviceCatalog={item["serviceCatalog"] as ServiceCatalog}
                />
              );
            },
          },
          {
            field: {
              servicePathInRepository: true,
            },
            title: "Service Path in Repository",
            type: FieldType.Text,
          },
          {
            field: {
              limitNumberOfOpenPullRequestsCount: true,
            },
            title: "Number of Open Pull Requests",
            type: FieldType.Number,
          },
          {
            field: {
              enablePullRequests: true,
            },
            title: "Enable Pull Requests",
            type: FieldType.Boolean,
          },
        ]}
      />
    </Fragment>
  );
};

export default ServiceCopilotCodeRepositoryPage;
