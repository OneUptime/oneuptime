import React, { FunctionComponent, ReactElement } from "react";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { StateListType } from "Common/Utils/StateOrder";
import EventRootCauseMetricChart, {
  RootCauseEventReader,
  RootCauseMoments,
} from "../Telemetry/EventRootCauseMetricChart";
import { EventMetricSubject } from "../../Utils/EventMetricInvestigation";
import {
  RootCauseEvent,
  getIncidentRootCauseEvent,
} from "../../Utils/EventRootCauseMetrics";

export interface ComponentProps {
  incidentId: ObjectID;
}

/*
 * How the Root Cause card reads an incident: the columns that decide what it
 * charts and when it was declared, with the monitors it is on, in one read;
 * then, for a card there is, its state timeline and the project's incident
 * states, as its Overview reads them.
 */
export const INCIDENT_ROOT_CAUSE_READER: RootCauseEventReader = {
  subject: EventMetricSubject.Incident,
  stateList: StateListType.IncidentState,
  readEvent: async (incidentId: ObjectID): Promise<RootCauseEvent | null> => {
    const incident: Incident | null = await ModelAPI.getItem<Incident>({
      modelType: Incident,
      id: incidentId,
      select: {
        declaredAt: true,
        impactStartedAt: true,
        telemetryQuery: true,
        seriesLabels: true,
        createdCriteriaId: true,
        monitors: {
          _id: true,
          monitorType: true,
          monitorSteps: true,
        } as never,
      },
    });

    return incident ? getIncidentRootCauseEvent(incident) : null;
  },
  readMoments: async (incidentId: ObjectID): Promise<RootCauseMoments> => {
    const [timelines, states]: [
      ListResult<IncidentStateTimeline>,
      ListResult<IncidentState>,
    ] = await Promise.all([
      ModelAPI.getList<IncidentStateTimeline>({
        modelType: IncidentStateTimeline,
        query: {
          incidentId: incidentId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          startsAt: true,
          incidentStateId: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
      }),
      ModelAPI.getList<IncidentState>({
        modelType: IncidentState,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
          isAcknowledgedState: true,
          isResolvedState: true,
          order: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
      }),
    ]);

    return {
      stateTimeline: (timelines.data || []).map(
        (timeline: IncidentStateTimeline) => {
          return {
            stateId: timeline.incidentStateId?.toString(),
            startsAt: timeline.startsAt,
          };
        },
      ),
      states: (states.data || []) as Array<IncidentState>,
    };
  },
};

/**
 * The metrics behind an incident, beside its root cause (issue #6249): the
 * Root Cause card (EventRootCauseMetricChart), reading the incident. An
 * alert's Root Cause page shows the same card, reading the alert.
 */
const IncidentRootCauseMetricChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EventRootCauseMetricChart
      eventId={props.incidentId}
      reader={INCIDENT_ROOT_CAUSE_READER}
    />
  );
};

export default IncidentRootCauseMetricChart;
