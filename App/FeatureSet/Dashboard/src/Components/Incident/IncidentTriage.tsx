import EventTriage, { EventTriageConfig } from "../EventView/EventTriage";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import React, { FunctionComponent, ReactElement } from "react";

/**
 * Incident adapter for the shared keyboard-first triage view. All the triage
 * behaviour lives in EventView/EventTriage; this only maps Incident fields onto
 * the config.
 */
const IncidentTriage: FunctionComponent = (): ReactElement => {
  const config: EventTriageConfig<
    Incident,
    IncidentState,
    IncidentStateTimeline
  > = {
    modelType: Incident,
    stateModelType: IncidentState,
    timelineModelType: IncidentStateTimeline,
    listQuery: {
      projectId: ProjectUtil.getCurrentProjectId()!,
      currentIncidentState: {
        isResolvedState: false,
      },
    } as Query<Incident>,
    listSelect: {
      _id: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      title: true,
      createdAt: true,
      currentIncidentState: {
        name: true,
        color: true,
        order: true,
      },
      incidentSeverity: {
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
    viewPageMapKey: PageMap.INCIDENT_VIEW,
    emptyTitle: "No active incidents",
    emptyDescription:
      "Nice work — the queue is clear. New incidents will appear here for fast triage.",
    getId: (model: Incident): ObjectID | undefined => {
      return model.id || undefined;
    },
    getNumberLabel: (model: Incident): string => {
      return (
        model.incidentNumberWithPrefix ||
        (model.incidentNumber ? `#${model.incidentNumber}` : "")
      );
    },
    getTitle: (model: Incident): string => {
      return model.title || "Untitled incident";
    },
    getCreatedAt: (model: Incident): Date | undefined => {
      return model.createdAt;
    },
    getStateName: (model: Incident): string => {
      return model.currentIncidentState?.name || "Unknown";
    },
    getStateColor: (model: Incident): string | undefined => {
      return model.currentIncidentState?.color?.toString();
    },
    getStateOrder: (model: Incident): number => {
      return model.currentIncidentState?.order || 0;
    },
    getSeverityName: (model: Incident): string | undefined => {
      return model.incidentSeverity?.name;
    },
    getSeverityColor: (model: Incident): string | undefined => {
      return model.incidentSeverity?.color?.toString();
    },
    isAckState: (state: IncidentState): boolean | undefined => {
      return state.isAcknowledgedState;
    },
    isResolvedState: (state: IncidentState): boolean | undefined => {
      return state.isResolvedState;
    },
    getStateId: (state: IncidentState): ObjectID | undefined => {
      return state.id || undefined;
    },
    getStateOrderFromState: (state: IncidentState): number => {
      return state.order || 0;
    },
    buildTimeline: (args: {
      modelId: ObjectID;
      stateId: ObjectID;
      projectId: ObjectID;
    }): IncidentStateTimeline => {
      const timeline: IncidentStateTimeline = new IncidentStateTimeline();
      timeline.incidentId = args.modelId;
      timeline.incidentStateId = args.stateId;
      timeline.projectId = args.projectId;
      return timeline;
    },
  };

  return <EventTriage config={config} />;
};

export default IncidentTriage;
