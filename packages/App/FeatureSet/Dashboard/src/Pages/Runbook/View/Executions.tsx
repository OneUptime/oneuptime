import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookExecutionTriggerCell, {
  RUNBOOK_EXECUTION_TRIGGER_CELL_SELECT,
} from "../../../Components/Runbook/Triggers/RunbookExecutionTriggerCell";
import { getTriggerFilterOptions } from "../../../Components/Runbook/Triggers/RunbookExecutionTrigger";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  getRunStatusColor,
  getRunStatusFilterOptions,
  getRunStatusLabel,
} from "../../../Components/Runbook/RunbookRunStatus";

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

const RunbookExecutionsList: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<RunbookExecution>
        modelType={RunbookExecution}
        id="runbook-view-executions-table"
        userPreferencesKey="runbook-view-executions-table"
        saveFilterProps={{
          tableId: "runbook-view-executions-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        name="Executions"
        query={{
          runbookId: modelId,
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
              if (item._id) {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
                    {
                      modelId,
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
          title: "Executions",
          description: "All runs of this runbook.",
        }}
        noItemsMessage={'No executions yet. Click "Run Now" to start one.'}
        showRefreshButton={true}
        filters={[
          {
            field: { _id: true },
            title: "Execution ID",
            type: FieldType.ObjectID,
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
            field: { _id: true },
            title: "Execution ID",
            type: FieldType.ObjectID,
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
          },
        ]}
      />
    </Fragment>
  );
};

export default RunbookExecutionsList;
