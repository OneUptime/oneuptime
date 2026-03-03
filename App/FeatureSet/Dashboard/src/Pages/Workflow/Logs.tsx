import WorkflowElement from "../../Components/Workflow/WorkflowElement";
import PageComponentProps from "../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import SimpleLogViewer from "Common/UI/Components/SimpleLogViewer/SimpleLogViewer";
import FieldType from "Common/UI/Components/Types/FieldType";
import WorkflowStatusElement from "Common/UI/Components/Workflow/WorkflowStatus";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const Workflows: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");

  return (
    <Fragment>
      <>
        <ModelTable<WorkflowLog>
          modelType={WorkflowLog}
          id="workflow-logs-table"
          userPreferencesKey="workflow-logs-table"
          isDeleteable={false}
          actionButtons={[
            {
              title: "View Logs",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.List,
              onClick: async (
                item: WorkflowLog,
                onCompleteAction: VoidFunction,
              ) => {
                setLogs(item["logs"] as string);
                setShowViewLogsModal(true);

                onCompleteAction();
              },
            },
          ]}
          isEditable={false}
          isCreateable={false}
          name="Workflow Logs"
          isViewable={false}
          selectMoreFields={{
            logs: true,
          }}
          cardProps={{
            title: "Workflow Logs",
            description:
              "List of logs in the last 30 days for all your workflows",
          }}
          noItemsMessage={
            "Looks like no workflow ran so far in the last 30 days."
          }
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[
            {
              field: {
                workflow: {
                  name: true,
                },
              },
              title: "Workflow Name",
              type: FieldType.Text,
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
                workflow: {
                  name: true,
                },
              },
              title: "Workflow Name",
              type: FieldType.Text,

              getElement: (item: WorkflowLog): ReactElement => {
                return <WorkflowElement workflow={item.workflow!} />;
              },
            },
            {
              field: {
                workflowStatus: true,
              },

              title: "Workflow Status",
              type: FieldType.Text,
              getElement: (item: WorkflowLog): ReactElement => {
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
              hideOnMobile: true,
            },
            {
              field: {
                startedAt: true,
              },
              title: "Started At",
              type: FieldType.DateTime,
              hideOnMobile: true,
            },
            {
              field: {
                completedAt: true,
              },
              title: "Completed At",
              type: FieldType.DateTime,
              hideOnMobile: true,
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

export default Workflows;
