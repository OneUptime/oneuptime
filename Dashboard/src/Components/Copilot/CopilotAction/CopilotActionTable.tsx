import DashboardNavigation from "../../../Utils/Navigation";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
} from "react";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import PullRequestViewElement from "../../CodeRepository/PullRequestView";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import Query from "Common/Types/BaseDatabase/Query";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import Columns from "Common/UI/Components/ModelTable/Columns";
import CopilotActionStatusElement from "./CopilotActionStatusElement";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";


export interface ComponentProps {
    query: Query<CopilotAction>;
    repoOrganizationName: string;
    repoName: string;
    repoType: CodeRepositoryType;
}

const LabelElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {

    let isPullRequestTable = false;

    if (props.query.copilotActionStatus === CopilotActionStatus.PR_CREATED) {
        isPullRequestTable = true;
    }

    const columns: Columns<CopilotAction> = [
        {
            field: {
                copilotActionType: true,
            },
            title: "Action Type",
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
                copilotActionStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: CopilotAction): ReactElement => {
                if (!item.copilotActionStatus) {
                    return <p>-</p>;
                }

                return (
                    <CopilotActionStatusElement copilotActionStatus={item.copilotActionStatus} />
                );
            },
        },
    ];

    if (isPullRequestTable) {
        // then 
        columns.push({
            field: {
                copilotPullRequest: {
                    pullRequestId: true,
                    copilotPullRequestStatus: true,

                },
            },
            title: "Pull Request",
            type: FieldType.Element,
            getElement: (item: CopilotAction): ReactElement => {
                if (!item.copilotPullRequest) {
                    return <p>-</p>;
                }

                return (
                    <Fragment>
                        <PullRequestViewElement
                            pullRequestId={item.copilotPullRequest.pullRequestId!}
                            organizationName={props.repoOrganizationName}
                            repositoryName={props.repoName}
                            repoType={props.repoType}
                            pullRequestStatus={item.copilotPullRequest.copilotPullRequestStatus!}
                        />
                    </Fragment>
                );
            }
        });
    }

    return (
        <ModelTable<CopilotAction>
            modelType={CopilotAction}
            id="table-copiolt-pull-requests"
            name="Code Repository > Pull Requests"
            isDeleteable={false}
            isCreateable={false}
            isEditable={false}
            isViewable={false}
            showViewIdButton={false}
            query={{
                projectId: DashboardNavigation.getProjectId()!,
                ...props.query
            }}
            selectMoreFields={{
                copilotPullRequest: {
                    pullRequestId: true,
                    copilotPullRequestStatus: true
                }
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
                        copilotActionType: true,
                    },
                    type: FieldType.Text,
                    title: "Action",
                },
                {
                    field: {
                        createdAt: true,
                    },
                    type: FieldType.DateTime,
                    title: "Created At",
                }
            ]}
            columns={columns}
        />
    );
};

export default LabelElement;
