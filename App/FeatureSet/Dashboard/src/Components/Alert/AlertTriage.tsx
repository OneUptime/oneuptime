import EventTriage, { EventTriageConfig } from "../EventView/EventTriage";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import React, { FunctionComponent, ReactElement } from "react";

/**
 * Alert adapter for the shared keyboard-first triage view. All the triage
 * behaviour lives in EventView/EventTriage; this only maps Alert fields onto
 * the config.
 */
const AlertTriage: FunctionComponent = (): ReactElement => {
  const config: EventTriageConfig<Alert, AlertState, AlertStateTimeline> = {
    modelType: Alert,
    stateModelType: AlertState,
    timelineModelType: AlertStateTimeline,
    listQuery: {
      projectId: ProjectUtil.getCurrentProjectId()!,
      currentAlertState: {
        isResolvedState: false,
      },
    } as Query<Alert>,
    listSelect: {
      _id: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
      title: true,
      createdAt: true,
      currentAlertState: {
        name: true,
        color: true,
        order: true,
      },
      alertSeverity: {
        name: true,
        color: true,
      },
    },
    listSort: {
      createdAt: SortOrder.Descending,
    },
    stateSelect: {
      _id: true,
      name: true,
      order: true,
      isAcknowledgedState: true,
      isResolvedState: true,
    },
    stateSort: {
      order: SortOrder.Ascending,
    },
    viewPageMapKey: PageMap.ALERT_VIEW,
    emptyTitle: "No active alerts",
    emptyDescription:
      "Nothing firing right now. New alerts will appear here for fast triage.",
    getId: (model: Alert): ObjectID | undefined => {
      return model.id || undefined;
    },
    getNumberLabel: (model: Alert): string => {
      return (
        model.alertNumberWithPrefix ||
        (model.alertNumber ? `#${model.alertNumber}` : "")
      );
    },
    getTitle: (model: Alert): string => {
      return model.title || "Untitled alert";
    },
    getCreatedAt: (model: Alert): Date | undefined => {
      return model.createdAt;
    },
    getStateName: (model: Alert): string => {
      return model.currentAlertState?.name || "Unknown";
    },
    getStateColor: (model: Alert): string | undefined => {
      return model.currentAlertState?.color?.toString();
    },
    getStateOrder: (model: Alert): number => {
      return model.currentAlertState?.order || 0;
    },
    getSeverityName: (model: Alert): string | undefined => {
      return model.alertSeverity?.name;
    },
    getSeverityColor: (model: Alert): string | undefined => {
      return model.alertSeverity?.color?.toString();
    },
    isAckState: (state: AlertState): boolean | undefined => {
      return state.isAcknowledgedState;
    },
    isResolvedState: (state: AlertState): boolean | undefined => {
      return state.isResolvedState;
    },
    getStateId: (state: AlertState): ObjectID | undefined => {
      return state.id || undefined;
    },
    getStateOrderFromState: (state: AlertState): number => {
      return state.order || 0;
    },
    buildTimeline: (args: {
      modelId: ObjectID;
      stateId: ObjectID;
      projectId: ObjectID;
    }): AlertStateTimeline => {
      const timeline: AlertStateTimeline = new AlertStateTimeline();
      timeline.alertId = args.modelId;
      timeline.alertStateId = args.stateId;
      timeline.projectId = args.projectId;
      return timeline;
    },
  };

  return <EventTriage config={config} />;
};

export default AlertTriage;
