import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import SimpleLogViewer from "Common/UI/Components/SimpleLogViewer/SimpleLogViewer";
import FieldType from "Common/UI/Components/Types/FieldType";
import WorkflowStatusElement from "Common/UI/Components/Workflow/WorkflowStatus";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import WorkflowLogs from "Common/Models/DatabaseModels/WorkflowLog";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const Delete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");

  return (
    <Fragment>
      <>
        <ModelTable<WorkflowLogs>
          modelType={WorkflowLogs}
          id="workflow-logs-table"
          isDeleteable={false}
          isEditable={false}
          userPreferencesKey="workflow-logs-table"
          isCreateable={false}
          name="Workflow Logs"
          query={{
            workflowId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          selectMoreFields={{
            logs: true,
          }}
          actionButtons={[
            {
              title: "View Logs",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (
                item: WorkflowLogs,
                onCompleteAction: VoidFunction,
              ) => {
                setLogs(item["logs"] as string);
                setShowViewLogsModal(true);

                onCompleteAction();
              },
            },
          ]}
          isViewable={false}
          cardProps={{
            title: "Workflow Logs",
            description: "List of logs in the last 30 days for this workflow",
          }}
          noItemsMessage={
            "Looks like this workflow did not run so far in the last 30 days."
          }
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[
            {
              field: {
                _id: true,
              },
              title: "Run ID",
              type: FieldType.ObjectID,
            },
            {
              field: {
                workflowStatus: true,
              },
              title: "Workflow Status",
              type: FieldType.Dropdown,
              filterDropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(WorkflowStatus),
            },
            {
              field: {
                createdAt: true,
              },
              title: "Scheduled At",
              type: FieldType.Date,
            },
            {
              field: {
                startedAt: true,
              },
              title: "Started At",
              type: FieldType.Date,
            },
            {
              field: {
                completedAt: true,
              },
              title: "Completed At",
              type: FieldType.Date,
            },
          ]}
          columns={[
            {
              field: {
                _id: true,
              },
              title: "Run ID",
              type: FieldType.ObjectID,
            },
            {
              field: {
                workflowStatus: true,
              },

              title: "Workflow Status",
              type: FieldType.Text,
              getElement: (item: WorkflowLogs): ReactElement => {
                if (!item["workflowStatus"]) {
                  throw new BadDataException("Workflow Status not found");
                }

                return (
                  <WorkflowStatusElement
                    status={item["workflowStatus"] as WorkflowStatus}
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Scheduled At",
              type: FieldType.DateTime,
            },
            {
              field: {
                startedAt: true,
              },
              title: "Started At",
              type: FieldType.DateTime,
            },
            {
              field: {
                completedAt: true,
              },
              title: "Completed At",
              type: FieldType.DateTime,
            },
          ]}
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
            <SimpleLogViewer title="Workflow Execution Log" height="500px">
              {logs}
            </SimpleLogViewer>
          </Modal>
        )}
      </>
    </Fragment>
  );
};

export default Delete;
