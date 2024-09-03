import DashboardNavigation from "../../../Utils/Navigation";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import PullRequestViewElement from "../../CodeRepository/PullRequestView";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import Query from "Common/Types/BaseDatabase/Query";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import Columns from "Common/UI/Components/ModelTable/Columns";
import CopilotActionStatusElement from "./CopilotActionStatusElement";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import SimpleLogViewer from "Common/UI/Components/SimpleLogViewer/SimpleLogViewer";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  query: Query<CopilotAction>;
  repoOrganizationName: string;
  repoName: string;
  repoType: CodeRepositoryType;
  title: string;
  description: string;
}

const CopilotActionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");

  const [showStatusMessageModal, setShowStatusMessageModal] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  let isPullRequestTable: boolean = false;

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
          <CopilotActionStatusElement
            copilotActionStatus={item.copilotActionStatus}
          />
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
              pullRequestStatus={
                item.copilotPullRequest.copilotPullRequestStatus!
              }
            />
          </Fragment>
        );
      },
    });
  }

  return (
    <div>
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
          ...props.query,
        }}
        actionButtons={[
          {
            title: "View Logs",
            buttonStyleType: ButtonStyleType.NORMAL,
            isVisible: (item: CopilotAction) => {
              return Boolean(item.logs);
            },
            icon: IconProp.List,
            onClick: async (
              item: CopilotAction,
              onCompleteAction: VoidFunction,
            ) => {
              setLogs(item["logs"] as string);
              setShowViewLogsModal(true);

              onCompleteAction();
            },
          },
          // status message
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            isVisible: (item: CopilotAction) => {
              return Boolean(item.statusMessage);
            },
            onClick: async (
              item: CopilotAction,
              onCompleteAction: VoidFunction,
            ) => {
              setStatusMessage(item["statusMessage"] as string);
              setShowStatusMessageModal(true);

              onCompleteAction();
            },
          },
        ]}
        selectMoreFields={{
          copilotPullRequest: {
            pullRequestId: true,
            copilotPullRequestStatus: true,
          },
        }}
        cardProps={{
          title: props.title,
          description: props.description,
        }}
        noItemsMessage={"No items found."}
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
          },
        ]}
        columns={columns}
      />

      {showViewLogsModal && (
        <Modal
          title={"Workflow Logs"}
          description="Here are the logs for this workflow"
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setShowViewLogsModal(false);
          }}
          submitButtonText={"Close"}
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <SimpleLogViewer>
            {logs.split("\n").map((log: string, i: number) => {
              return <div key={i}>{log}</div>;
            })}
          </SimpleLogViewer>
        </Modal>
      )}

      {/** Status Message */}

      {showStatusMessageModal && (
        <Modal
          title={"Status Message"}
          description="Here is the status message for this action"
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setShowStatusMessageModal(false);
          }}
          submitButtonText={"Close"}
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <p>{statusMessage}</p>
        </Modal>
      )}
    </div>
  );
};

export default CopilotActionTable;
