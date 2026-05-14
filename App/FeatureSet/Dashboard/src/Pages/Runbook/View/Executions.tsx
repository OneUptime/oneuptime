import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import User from "Common/Models/DatabaseModels/User";
import IncidentElement from "../../../Components/Incident/Incident";
import AlertElement from "../../../Components/Alert/Alert";
import UserElement from "../../../Components/User/User";
import AppLink from "../../../Components/AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
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

function triggerCell(item: RunbookExecution): ReactElement {
  if (item.incident) {
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">Incident</span>
        <IncidentElement incident={item.incident as Incident} />
      </div>
    );
  }
  if (item.alert) {
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">Alert</span>
        <AlertElement alert={item.alert as Alert} />
      </div>
    );
  }
  if (item.scheduledMaintenance) {
    const sm: ScheduledMaintenance =
      item.scheduledMaintenance as ScheduledMaintenance;
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">Maintenance</span>
        {sm._id ? (
          <AppLink
            className="hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
              { modelId: new ObjectID(sm._id as string) },
            )}
          >
            <span>{sm.title || "View"}</span>
          </AppLink>
        ) : (
          <span>{sm.title || "—"}</span>
        )}
      </div>
    );
  }
  if (item.triggeredByUser) {
    return (
      <div className="flex flex-col">
        <span className="text-xs text-gray-500">Manual run by</span>
        <UserElement user={item.triggeredByUser as User} />
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500">Trigger</span>
      <span className="text-sm text-gray-500">Manual / unknown</span>
    </div>
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
            field: {
              incident: { _id: true, title: true },
              alert: { _id: true, title: true },
              scheduledMaintenance: { _id: true, title: true },
              triggeredByUser: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "Triggered by",
            type: FieldType.Element,
            getElement: (item: RunbookExecution): ReactElement => {
              return triggerCell(item);
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
