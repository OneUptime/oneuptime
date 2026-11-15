import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ProjectUtil from "Common/UI/Utils/Project";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookExecutionTriggerCell, {
  RUNBOOK_EXECUTION_TRIGGER_CELL_SELECT,
  TRIGGERED_BY_MAX_WIDTH_CLASS_NAME,
  TRIGGERED_BY_MIN_WIDTH_CLASS_NAME,
} from "../../Components/Runbook/Triggers/RunbookExecutionTriggerCell";
import { getTriggerFilterOptions } from "../../Components/Runbook/Triggers/RunbookExecutionTrigger";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  getRunStatusColor,
  getRunStatusFilterOptions,
  getRunStatusLabel,
} from "../../Components/Runbook/RunbookRunStatus";

// In the words the Status filter offers it in.
function statusPill(status: RunbookExecutionStatus): ReactElement {
  return (
    <Pill
      text={getRunStatusLabel(status)}
      color={getRunStatusColor(status)}
      isMinimal={true}
    />
  );
}

const RunbooksExecutions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<RunbookExecution>
        modelType={RunbookExecution}
        id="runbook-executions-table"
        userPreferencesKey="runbook-executions-table"
        saveFilterProps={{
          tableId: "runbook-executions-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        name="Runbook Executions"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        isViewable={false}
        actionButtons={[
          {
            title: "View",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: RunbookExecution,
              onCompleteAction: VoidFunction,
            ) => {
              if (item.runbookId && item._id) {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
                    {
                      modelId: item.runbookId,
                      subModelId: item._id as unknown as string,
                    },
                  ),
                );
              }
              onCompleteAction();
            },
          },
        ]}
        cardProps={{
          title: "All Runbook Executions",
          description:
            "Every runbook execution in this project, across all runbooks.",
        }}
        noItemsMessage={"No runbook executions yet."}
        showRefreshButton={true}
        filters={[
          {
            field: { _id: true },
            title: "Execution ID",
            type: FieldType.ObjectID,
          },
          {
            field: { runbookNameSnapshot: true },
            title: "Runbook",
            type: FieldType.Text,
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Dropdown,
            // "Waiting", never the stored "WaitingForManualStep".
            filterDropdownOptions: getRunStatusFilterOptions(),
          },
          {
            field: { triggerType: true },
            title: "Triggered by",
            type: FieldType.Dropdown,
            filterDropdownOptions: getTriggerFilterOptions(),
          },
          {
            field: { createdAt: true },
            title: "Started At",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: { runbookNameSnapshot: true },
            title: "Runbook",
            type: FieldType.Text,
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: RunbookExecution): ReactElement => {
              return statusPill(item.status as RunbookExecutionStatus);
            },
          },
          {
            field: RUNBOOK_EXECUTION_TRIGGER_CELL_SELECT,
            title: "Triggered by",
            type: FieldType.Element,
            hideOnMobile: true,
            /*
             * An incident's title, a long due time: they wrap in the
             * column rather than push the table past its card.
             */
            wrapContent: true,
            // Wide enough that a person's name never breaks over two lines.
            contentClassName: TRIGGERED_BY_MIN_WIDTH_CLASS_NAME,
            wrapMaxWidthClassName: TRIGGERED_BY_MAX_WIDTH_CLASS_NAME,
            getElement: (item: RunbookExecution): ReactElement => {
              return <RunbookExecutionTriggerCell execution={item} />;
            },
          },
          {
            field: { startedAt: true },
            title: "Started At",
            type: FieldType.DateTime,
          },
          {
            field: { completedAt: true },
            title: "Completed At",
            type: FieldType.DateTime,
            hideOnMobile: true,
            /*
             * Triggered by took its place: with both, the list ran past
             * its card at 1280px and hid each row's View. Status says
             * whether a run ended; Customize Columns brings this back.
             */
            isHiddenByDefault: true,
          },
        ]}
      />
    </Fragment>
  );
};

export default RunbooksExecutions;
