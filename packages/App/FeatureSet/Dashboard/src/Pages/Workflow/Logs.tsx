import WorkflowElement from "../../Components/Workflow/WorkflowElement";
import PageComponentProps from "../PageComponentProps";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getWorkflowRunAgainAction } from "Common/UI/Components/Workflow/RunAgain/RunAgainAction";
import WorkflowRunWindow, {
  OpenWorkflowRun,
} from "Common/UI/Components/Workflow/RunAgain/WorkflowRunWindow";
import { getWorkflowRunDownloadActions } from "Common/UI/Components/Workflow/DownloadWorkflowRun";
import {
  getWorkflowRunExportFromWorkflowLog,
  getWorkflowRunStartedBy,
} from "Common/UI/Components/Workflow/WorkflowRunExport";
import FieldType from "Common/UI/Components/Types/FieldType";
import WorkflowStatusElement, {
  getWorkflowStatusFilterOptions,
} from "Common/UI/Components/Workflow/WorkflowStatus";
import Navigation from "Common/UI/Utils/Navigation";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const Workflows: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // The run open in the modal: what it shows, and what Download saves.
  const [openRun, setOpenRun] = useState<OpenWorkflowRun | null>(null);
  // Changed when a new run starts from the open run, so the list shows it.
  const [refreshToggle, setRefreshToggle] = useState<string>("");

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
                setOpenRun({ run: getWorkflowRunExportFromWorkflowLog(item) });

                onCompleteAction();
              },
            },
            // Run again, in the row's ⋯ menu, on a run that can be.
            getWorkflowRunAgainAction({
              onStarted: (run: WorkflowLog) => {
                setOpenRun({
                  run: getWorkflowRunExportFromWorkflowLog(run),
                  isNewRun: true,
                });
              },
            }),
            // Download log and Download run as JSON, in the row's ⋯ menu.
            ...getWorkflowRunDownloadActions(),
          ]}
          isEditable={false}
          isCreateable={false}
          name="Workflow Logs"
          /*
           * The menu calls this page Runs (in its Logs section), so the card
           * and the row count say runs too, not "Workflow Logs".
           */
          singularName="Workflow Run"
          pluralName="Workflow Runs"
          isViewable={false}
          /*
           * The log and the steps are what View Logs shows and the downloads
           * save; the workflow's id heads a downloaded log. A test run is
           * marked beside its status, with who started it.
           */
          selectMoreFields={{
            logs: true,
            stepTrace: true,
            workflowId: true,
            isTestRun: true,
            startedByUser: {
              name: true,
              email: true,
            },
            // Whether the row and the run's window offer Run again.
            canRunAgain: true,
          }}
          cardProps={{
            title: "Runs",
            description:
              "Every run of every workflow in this project, from the last 30 days.",
          }}
          noItemsMessage={
            "Looks like no workflow ran so far in the last 30 days."
          }
          showRefreshButton={true}
          refreshToggle={refreshToggle}
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
              // Each status in the words its pill draws: "Executed", never "Success".
              filterDropdownOptions: getWorkflowStatusFilterOptions(),
            },
            {
              field: {
                isTestRun: true,
              },
              title: "Test Run",
              type: FieldType.Boolean,
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

                /*
                 * A person ran it from the Builder while the workflow was
                 * off: marked beside its status, so it is not read as a run
                 * its trigger started.
                 */
                return (
                  <WorkflowStatusElement
                    status={item["workflowStatus"] as WorkflowStatus}
                    isTestRun={item.isTestRun === true}
                    testRunStartedBy={getWorkflowRunStartedBy(
                      item.startedByUser,
                    )}
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

        {openRun && (
          <WorkflowRunWindow
            openRun={openRun}
            onRunStarted={() => {
              setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
            }}
            onClose={() => {
              setOpenRun(null);
            }}
          />
        )}
      </>
    </Fragment>
  );
};

export default Workflows;
