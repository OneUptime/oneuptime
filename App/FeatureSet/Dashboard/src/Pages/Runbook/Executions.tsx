import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ProjectUtil from "Common/UI/Utils/Project";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  Gray500,
  Green500,
  Red500,
  Yellow500,
  Blue500,
} from "Common/Types/BrandColors";

function statusPill(status: RunbookExecutionStatus): ReactElement {
  switch (status) {
    case RunbookExecutionStatus.Completed:
      return <Pill text="Completed" color={Green500} isMinimal={true} />;
    case RunbookExecutionStatus.Failed:
      return <Pill text="Failed" color={Red500} isMinimal={true} />;
    case RunbookExecutionStatus.Running:
      return <Pill text="Running" color={Blue500} isMinimal={true} />;
    case RunbookExecutionStatus.WaitingForManualStep:
      return <Pill text="Waiting" color={Yellow500} isMinimal={true} />;
    case RunbookExecutionStatus.Cancelled:
      return <Pill text="Cancelled" color={Gray500} isMinimal={true} />;
    case RunbookExecutionStatus.Scheduled:
    default:
      return (
        <Pill text={status || "Scheduled"} color={Gray500} isMinimal={true} />
      );
  }
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
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              RunbookExecutionStatus,
            ),
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
            field: { startedAt: true },
            title: "Started At",
            type: FieldType.DateTime,
          },
          {
            field: { completedAt: true },
            title: "Completed At",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />
    </Fragment>
  );
};

export default RunbooksExecutions;
