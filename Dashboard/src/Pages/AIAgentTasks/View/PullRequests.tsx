import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import AIAgentTaskPullRequest from "Common/Models/DatabaseModels/AIAgentTaskPullRequest";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import PullRequestStatusElement from "../../../Components/CodeRepository/PullRequestStatus";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Link from "Common/UI/Components/Link/Link";

const AIAgentTaskPullRequestsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <ModelTable<AIAgentTaskPullRequest>
      modelType={AIAgentTaskPullRequest}
      id="ai-agent-task-pull-requests-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      userPreferencesKey="ai-agent-task-pull-requests-table"
      name="Pull Requests"
      query={{
        aiAgentTaskId: modelId,
      }}
      isViewable={false}
      cardProps={{
        title: "Pull Requests",
        description:
          "Pull requests created by the AI agent during this task execution.",
      }}
      noItemsMessage={"No pull requests have been created for this task yet."}
      showRefreshButton={true}
      viewPageRoute={Navigation.getCurrentRoute()}
      filters={[
        {
          field: {
            title: true,
          },
          title: "Title",
          type: FieldType.Text,
        },
        {
          field: {
            pullRequestState: true,
          },
          title: "State",
          type: FieldType.Dropdown,
          filterDropdownOptions:
            DropdownUtil.getDropdownOptionsFromEnum(PullRequestState),
        },
        {
          field: {
            pullRequestNumber: true,
          },
          title: "PR Number",
          type: FieldType.Number,
        },
        {
          field: {
            repoName: true,
          },
          title: "Repository",
          type: FieldType.Text,
        },
        {
          field: {
            createdAt: true,
          },
          title: "Created At",
          type: FieldType.Date,
        },
      ]}
      columns={[
        {
          field: {
            pullRequestNumber: true,
          },
          title: "PR #",
          type: FieldType.Text,
          getElement: (item: AIAgentTaskPullRequest): ReactElement => {
            if (item.pullRequestUrl) {
              return (
                <Link
                  to={item.pullRequestUrl}
                  className="hover:underline"
                  openInNewTab={true}
                >
                  <>#{item.pullRequestNumber}</>
                </Link>
              );
            }
            return <>#{item.pullRequestNumber}</>;
          },
        },
        {
          field: {
            title: true,
          },
          title: "Title",
          type: FieldType.Text,
          getElement: (item: AIAgentTaskPullRequest): ReactElement => {
            if (item.pullRequestUrl) {
              return (
                <Link
                  to={item.pullRequestUrl}
                  className="hover:underline"
                  openInNewTab={true}
                >
                  <>{item.title}</>
                </Link>
              );
            }
            return <>{item.title}</>;
          },
        },
        {
          field: {
            pullRequestState: true,
          },
          title: "State",
          type: FieldType.Text,
          getElement: (item: AIAgentTaskPullRequest): ReactElement => {
            return (
              <PullRequestStatusElement
                pullRequestStatus={
                  item.pullRequestState || PullRequestState.Open
                }
              />
            );
          },
        },
        {
          field: {
            repoOrganizationName: true,
          },
          title: "Repository",
          type: FieldType.Text,
          getElement: (item: AIAgentTaskPullRequest): ReactElement => {
            const repoFullName: string = `${item.repoOrganizationName || ""}/${item.repoName || ""}`;
            return <>{repoFullName}</>;
          },
        },
        {
          field: {
            headRefName: true,
          },
          title: "Branch",
          type: FieldType.Text,
        },
        {
          field: {
            createdAt: true,
          },
          title: "Created At",
          type: FieldType.DateTime,
        },
      ]}
    />
  );
};

export default AIAgentTaskPullRequestsPage;
