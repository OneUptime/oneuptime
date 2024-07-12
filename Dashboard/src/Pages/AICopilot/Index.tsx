import Banner from "CommonUI/src/Components/Banner/Banner";
import LabelsElement from "../../Components/Label/Labels";
import DashboardNavigation from "../../Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Page from "CommonUI/src/Components/Page/Page";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import Navigation from "CommonUI/src/Utils/Navigation";
import CodeRepository from "Model/Models/CopilotCodeRepository";
import Label from "Model/Models/Label";
import React, { FunctionComponent, ReactElement } from "react";
import URL from "Common/Types/API/URL";

const CodeRepositoryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Page
      title={"Reliability Copilot"}
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Reliability Copilot",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.RELIABILITY_COPILOT] as Route,
          ),
        },
      ]}
    >
      <Banner
        title="Beta Software"
        description="Reliability Copilot is a beta software. Please let us know your feedback and report any bugs on GitHub."
        openInNewTab={true}
        link={URL.fromString("https://github.com/OneUptime/oneuptime/issues")}
      />
      <ModelTable<CodeRepository>
        modelType={CodeRepository}
        id="service-catalog-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        createVerb="Add"
        name="Git Repositories"
        isViewable={true}
        cardProps={{
          title: "Git Repository",
          description:
            "Git repositores where the Reliability Copilot can improve your code.",
        }}
        viewPageRoute={
          new Route(
            Navigation.getCurrentRoute().toString() + "/code-repository",
          )
        }
        showViewIdButton={true}
        noItemsMessage={"No repositories found."}
        formSteps={[
          {
            title: "Repository Info",
            id: "repository-info",
          },
          {
            title: "Details",
            id: "details",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Friendly Name",
            validation: {
              minLength: 2,
            },
            stepId: "repository-info",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Description",
            stepId: "repository-info",
          },
          {
            field: {
              mainBranchName: true,
            },
            title: "Main Branch Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "master",
            validation: {
              minLength: 2,
              noSpaces: true,
              noSpecialCharacters: true,
            },
            stepId: "details",
          },
          {
            field: {
              repositoryHostedAt: true,
            },
            title: "Repository Hosted At",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(CodeRepositoryType),
            stepId: "details",
          },
          {
            field: {
              organizationName: true,
            },
            title: "Organization Name (on GitHub, GitLab, etc.)",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "org-name",
            stepId: "details",
          },
          {
            field: {
              repositoryName: true,
            },
            title: "Repository Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "repo-name",
            stepId: "details",
          },
        ]}
        showRefreshButton={true}
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
            type: FieldType.Text,
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
            filterEntityType: Label,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()?.toString(),
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
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
            type: FieldType.Text,
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

            getElement: (item: CodeRepository): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
    </Page>
  );
};

export default CodeRepositoryPage;
