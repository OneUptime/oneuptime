import DashboardNavigation from "../../../../Utils/Navigation";
import PageComponentProps from "../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import CopilotPullRequest from "Model/Models/CopilotPullRequest";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import CopilotPullRequestStatus from "Common/Types/Copilot/CopilotPullRequestStatus";
import PullRequestStatusElement from "../../../../Components/CodeRepository/PullRequestStatus";

const CopilotPullRequestPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const codeRepositoryId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<CopilotPullRequest>
        modelType={CopilotPullRequest}
        id="table-copiolt-pull-requests"
        name="Code Repository > Pull Requests"
        isDeleteable={false}
        createVerb={"Add"}
        isCreateable={false}
        isEditable={false}
        isViewable={false}
        showViewIdButton={false}
        query={{
          codeRepositoryId: codeRepositoryId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        cardProps={{
          title: "Pull Requests",
          description:
            "List of pull requests created by OneUptime Copilot for this code repository.",
        }}
        noItemsMessage={
          "No pull requests found. OneUptime Copilot has not created any pull requests for this code repository."
        }
        showRefreshButton={true}
        filters={[
          {
            field: {
              pullRequestId: true,
            },
            type: FieldType.Text,
            title: "Pull Request ID",
          },
          {
            field: {
              createdAt: true,
            },
            type: FieldType.DateTime,
            title: "Created At",
          },
          {
            field: {
              copilotPullRequestStatus: true,
            },
            title: "Pull Request Status",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              CopilotPullRequestStatus,
            ),
          },
        ]}
        columns={[
          {
            field: {
              pullRequestId: true,
            },
            title: "Pull Request ID",
            type: FieldType.Text,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
          },
          {
            field: {
              copilotPullRequestStatus: true,
            },
            title: "Pull Request Status",
            type: FieldType.Element,
            getElement: (item: CopilotPullRequest): ReactElement => {
              if (!item.copilotPullRequestStatus) {
                return <p>-</p>;
              }

              return (
                <PullRequestStatusElement
                  pullRequestStatus={item.copilotPullRequestStatus}
                />
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default CopilotPullRequestPage;
