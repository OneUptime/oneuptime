import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import WorkflowLogModal from "Common/UI/Components/Workflow/WorkflowLogModal";
import { getWorkflowRunDownloadActions } from "Common/UI/Components/Workflow/DownloadWorkflowRun";
import {
  WorkflowRunExport,
  getWorkflowRunExportFromWorkflowLog,
} from "Common/UI/Components/Workflow/WorkflowRunExport";
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

  // The run open in the modal: what it shows, and what Download saves.
  const [openRun, setOpenRun] = useState<WorkflowRunExport | null>(null);

  return (
    <Fragment>
      <>
        <ModelTable<WorkflowLogs>
          modelType={WorkflowLogs}
          id="workflow-logs-table"
          saveFilterProps={{
            tableId: "workflow-view-logs-table",
          }}
          isDeleteable={false}
          isEditable={false}
          userPreferencesKey="workflow-logs-table"
          isCreateable={false}
          name="Workflow Logs"
          /*
           * The menu calls this page Runs (in its Logs section), so the card
           * and the row count say runs too, not "Workflow Logs".
           */
          singularName="Workflow Run"
          pluralName="Workflow Runs"
          query={{
            workflowId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          /*
           * The log and the steps are what View Logs shows and the downloads
           * save. The workflow's name and id name a downloaded run and head
           * its log; this list has no column that asks for them.
           */
          selectMoreFields={{
            logs: true,
            stepTrace: true,
            workflowId: true,
            workflow: {
              name: true,
            },
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
                setOpenRun(getWorkflowRunExportFromWorkflowLog(item));

                onCompleteAction();
              },
            },
            // Download log and Download run as JSON, in the row's ⋯ menu.
            ...getWorkflowRunDownloadActions(),
          ]}
          isViewable={false}
          cardProps={{
            title: "Runs",
            description: "Every run of this workflow, from the last 30 days.",
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

        {openRun && (
          <WorkflowLogModal
            title="Workflow Run"
            description="Here is what happened when this workflow ran."
            logs={openRun.logs}
            stepTrace={openRun.stepTrace}
            run={openRun}
            onClose={() => {
              setOpenRun(null);
            }}
          />
        )}
      </>
    </Fragment>
  );
};

export default Delete;
