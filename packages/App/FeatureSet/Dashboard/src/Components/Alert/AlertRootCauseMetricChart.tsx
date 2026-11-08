import React, { FunctionComponent, ReactElement } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
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
  getAlertRootCauseEvent,
} from "../../Utils/EventRootCauseMetrics";

export interface ComponentProps {
  alertId: ObjectID;
}

/*
 * How the Root Cause card reads an alert: the columns that decide what it
 * charts and when it was created, with its one monitor - only what the
 * card reads of it - in one read; then, for a card there is, its state
 * timeline and the project's alert states, as its Overview reads them.
 */
export const ALERT_ROOT_CAUSE_READER: RootCauseEventReader = {
  subject: EventMetricSubject.Alert,
  stateList: StateListType.AlertState,
  readEvent: async (alertId: ObjectID): Promise<RootCauseEvent | null> => {
    const alert: Alert | null = await ModelAPI.getItem<Alert>({
      modelType: Alert,
      id: alertId,
      select: {
        createdAt: true,
        impactStartedAt: true,
        telemetryQuery: true,
        seriesLabels: true,
        createdCriteriaId: true,
        monitor: {
          _id: true,
          monitorType: true,
          monitorSteps: true,
        },
      },
    });

    return alert ? getAlertRootCauseEvent(alert) : null;
  },
  readMoments: async (alertId: ObjectID): Promise<RootCauseMoments> => {
    const [timelines, states]: [
      ListResult<AlertStateTimeline>,
      ListResult<AlertState>,
    ] = await Promise.all([
      ModelAPI.getList<AlertStateTimeline>({
        modelType: AlertStateTimeline,
        query: {
          alertId: alertId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          startsAt: true,
          alertStateId: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
      }),
      ModelAPI.getList<AlertState>({
        modelType: AlertState,
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
        (timeline: AlertStateTimeline) => {
          return {
            stateId: timeline.alertStateId?.toString(),
            startsAt: timeline.startsAt,
          };
        },
      ),
      states: (states.data || []) as Array<AlertState>,
    };
  },
};

/**
 * The metrics behind an alert, beside its root cause (issue #6304): the
 * Root Cause card an incident's page shows (EventRootCauseMetricChart),
 * reading the alert - what its Overview charts when it kept a metric
 * snapshot, its monitor's metrics as the monitor reads them now when it
 * kept none, and nothing for an alert with no metrics behind it.
 */
const AlertRootCauseMetricChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EventRootCauseMetricChart
      eventId={props.alertId}
      reader={ALERT_ROOT_CAUSE_READER}
    />
  );
};

export default AlertRootCauseMetricChart;
