import WorkflowElement from "../../Components/Workflow/WorkflowElement";
import PageComponentProps from "../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import WorkflowLogModal from "Common/UI/Components/Workflow/WorkflowLogModal";
import {
  WorkflowStepTrace,
  emptyTrace,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import { JSONValue } from "Common/Types/JSON";
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
  const [stepTrace, setStepTrace] = useState<WorkflowStepTrace>(emptyTrace());

  return (
    <Fragment>
      <>
        <ModelTable<WorkflowLog>
          modelType={WorkflowLog}
          id="workflow-logs-table"
          userPreferencesKey="workflow-logs-table"
          saveFilterProps={{
            tableId: "workflow-logs-table",
          }}
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
                setStepTrace(
                  parseTrace((item["stepTrace"] as JSONValue) || null),
                );
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
            stepTrace: true,
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
          <WorkflowLogModal
            title="Workflow Run"
            description="Here is what happened when this workflow ran."
            logs={logs}
            stepTrace={stepTrace}
            onClose={() => {
              setShowViewLogsModal(false);
            }}
          />
        )}
      </>
    </Fragment>
  );
};

export default Workflows;
